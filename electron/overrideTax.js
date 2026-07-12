// Override Tax: escalating snooze cost system.
// First snooze is free. Each subsequent snooze raises the stakes:
// - 2nd: logged to accountability partner
// - 3rd: tomorrow's timer auto-tightens by 15 min
// - 4th+: must type a reason (like emergency override)
// Override (cancel via override) breaks streak + all above.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const TAX_FILE = 'override-tax.json';

let configPath = null;
let cache = null;

const DEFAULTS = {
  // Per-session snooze escalation tracking (reset on timer start).
  sessionSnoozeCount: 0,
  // Accumulated "debt" — how many minutes tomorrow's timer should be shortened.
  tomorrowDebt: 0,
  // History of override tax events for auditing.
  history: [],
  // Settings (user-configurable).
  config: {
    enabled: true,
    freeSnoozes: 1,           // first N snoozes are free (no cost)
    notifyOnEscalation: true, // notify accountability partner on 2nd+ snooze
    tightenMinutes: 15,       // minutes to subtract from tomorrow's timer per escalation
    maxTighten: 60,           // cap on total tightening (never make timer < 5 min)
    requireReasonAfter: 3,    // require typed reason after N snoozes
    streakBreakOnOverride: true // override always breaks streak
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

function getPath() {
  if (!configPath) configPath = path.join(app.getPath('userData'), TAX_FILE);
  return configPath;
}

function load() {
  if (cache) return cache;
  try {
    const p = getPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      cache = { ...structuredClone(DEFAULTS), ...raw, config: { ...DEFAULTS.config, ...(raw.config || {}) } };
    } else {
      cache = structuredClone(DEFAULTS);
    }
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

function save() {
  try {
    fs.writeFileSync(getPath(), JSON.stringify(cache, null, 2), 'utf8');
  } catch { /* best-effort */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

// Call on timer start — resets session snooze count.
function resetSession() {
  const data = load();
  data.sessionSnoozeCount = 0;
  save();
}

// Call before allowing a snooze. Returns the cost assessment.
function assessSnoozeCost() {
  const data = load();
  const cfg = data.config;
  if (!cfg.enabled) return { allowed: true, cost: 'free', level: 0, consequences: [] };

  const count = data.sessionSnoozeCount + 1; // the snooze about to happen
  const level = Math.max(0, count - cfg.freeSnoozes);

  const consequences = [];

  if (level === 0) {
    // Free snooze — no cost.
    return { allowed: true, cost: 'free', level: 0, consequences: [], snoozeNumber: count };
  }

  if (level >= 1) {
    consequences.push({
      type: 'logged',
      severity: 'medium',
      message: `Snooze #${count} will be logged.`,
      icon: '\u{1F4DD}'
    });
  }

  if (level >= 1 && cfg.notifyOnEscalation) {
    consequences.push({
      type: 'accountability',
      severity: 'high',
      message: `Your accountability partner will be notified of snooze #${count}.`,
      icon: '\u{1F4E2}'
    });
  }

  if (level >= 2) {
    const debt = Math.min(cfg.tightenMinutes * (level - 1), cfg.maxTighten);
    consequences.push({
      type: 'tighten',
      severity: 'high',
      message: `Tomorrow's timer will start ${debt} min earlier.`,
      icon: '\u23F0'
    });
  }

  const requireReason = count >= cfg.requireReasonAfter;
  if (requireReason) {
    consequences.push({
      type: 'reason',
      severity: 'high',
      message: `You must type a reason to snooze.`,
      icon: '\u270D\uFE0F'
    });
  }

  return {
    allowed: true,
    cost: level >= 2 ? 'heavy' : 'medium',
    level,
    snoozeNumber: count,
    consequences,
    requireReason
  };
}

// Call after snooze is confirmed. Records the cost and applies penalties.
function recordSnooze(reason) {
  const data = load();
  const cfg = data.config;
  data.sessionSnoozeCount++;

  const level = Math.max(0, data.sessionSnoozeCount - cfg.freeSnoozes);

  // Apply tomorrow's tightening debt.
  if (level >= 2) {
    const addDebt = Math.min(cfg.tightenMinutes, cfg.maxTighten - data.tomorrowDebt);
    data.tomorrowDebt += addDebt;
  }

  // Record in history.
  data.history.push({
    date: new Date().toISOString(),
    type: 'snooze',
    snoozeNumber: data.sessionSnoozeCount,
    level,
    reason: reason || null,
    tomorrowDebt: data.tomorrowDebt
  });

  // Keep last 90 days of history.
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  data.history = data.history.filter(h => h.date >= cutoff);

  save();
  return { level, snoozeNumber: data.sessionSnoozeCount, tomorrowDebt: data.tomorrowDebt };
}

// Get the tightening debt for today's timer (call on timer start to adjust duration).
function getTomorrowDebt() {
  const data = load();
  return data.tomorrowDebt;
}

// Consume the debt (apply it to today's timer start, then zero it out).
function consumeDebt() {
  const data = load();
  const debt = data.tomorrowDebt;
  data.tomorrowDebt = 0;
  save();
  return debt;
}

// Get override tax config.
function getConfig() {
  return load().config;
}

// Update override tax config.
function updateConfig(updates) {
  const data = load();
  Object.assign(data.config, updates);
  save();
  return data.config;
}

// Get tax stats for the UI.
function getStats() {
  const data = load();
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const weekHistory = data.history.filter(h => h.date >= weekAgo);
  const totalSnoozes = weekHistory.filter(h => h.type === 'snooze').length;
  const taxedSnoozes = weekHistory.filter(h => h.type === 'snooze' && h.level > 0).length;

  return {
    sessionSnoozeCount: data.sessionSnoozeCount,
    tomorrowDebt: data.tomorrowDebt,
    weekSnoozes: totalSnoozes,
    weekTaxedSnoozes: taxedSnoozes,
    config: data.config
  };
}

module.exports = {
  resetSession,
  assessSnoozeCost,
  recordSnooze,
  getTomorrowDebt,
  consumeDebt,
  getConfig,
  updateConfig,
  getStats,
  // Testing helpers.
  _load: load,
  _reset: () => { cache = null; configPath = null; }
};
