// Estimated bedtime-deficit tracker. Values are inferred from a completed
// Lights Out timer to a configured wake time; they are not measured sleep.

const path = require('path');
const { writeTmpVerifyRename, safeLoadJson } = require('./durableJsonStore');

const DEBT_FILE = 'sleepDebt.json';
let cache = null;

// Target sleep hours (configurable, default 8).
const DEFAULT_TARGET_HOURS = 8;

function getConfigPath() {
  let userDataDir;
  try {
    const { app } = require('electron');
    userDataDir = app.getPath('userData');
  } catch {
    const os = require('os');
    userDataDir = os.tmpdir();
  }
  return path.join(userDataDir, DEBT_FILE);
}

function load() {
  if (cache) return cache;
  const DEFAULTS = {
    targetHours: DEFAULT_TARGET_HOURS,
    wakeTime: '07:00',
    dailyLog: [] // [{ date, bedTime, wakeTime, actualHours, targetHours, debt }]
  };
  try {
    const file = getConfigPath();
    const { data, recovered } = safeLoadJson(file);
    if (data && typeof data === 'object') {
      cache = { ...DEFAULTS, ...data };
      if (!Array.isArray(cache.dailyLog)) cache.dailyLog = [];
      const migrated = migrateLegacyNightKeys(cache.dailyLog);
      cache.dailyLog = migrated.log;
      if (recovered || migrated.changed) save();
    } else {
      cache = structuredClone(DEFAULTS);
    }
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

function save() {
  if (!cache) return;
  try {
    writeTmpVerifyRename(getConfigPath(), cache);
  } catch { /* best effort */ }
}

// Local "night" key (local date minus 6 hours, matching streaks.js so a 00:30
// timer completion counts toward the evening before rather than tomorrow UTC).
function localNightKey(ms = Date.now()) {
  const d = new Date(ms - 6 * 3600 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isValidTimeHHMM(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// Entries keyed by localNightKey() carry this marker. v11.2.0 entries have
// none: they were keyed by the UTC date of the completion, while bedTime is
// the LOCAL time of that same moment. West of UTC an evening completion got
// the next day's key, so the next night's entry would overwrite it.
const NIGHT_KEY_VERSION = 2;

// The local night of a v11.2.0 entry (same method as streaks.js
// legacyNightKey): find the local date whose bedTime instant has the stored
// UTC date. An entry that cannot be resolved keeps its stored date.
function legacyNightKey(entry) {
  const date = String(entry.date);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(entry.bedTime || ''));
  if (!dm || !tm) return date;
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (h > 23 || mi > 59) return date;
  for (const k of [0, -1, 1]) {
    const local = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]) + k, h, mi);
    if (!Number.isNaN(local.getTime()) && local.toISOString().slice(0, 10) === date) return localNightKey(local.getTime());
  }
  return date;
}

// Rewrite unmarked (v11.2.0) entries to their local night once, keeping one
// entry per night (the later one, as recordNight does). An entry that is not
// an object with a YYYY-MM-DD date is dropped: it can never be matched or
// aged out, and recordNight would fail on it.
function migrateLegacyNightKeys(log) {
  let changed = false;
  const out = [];
  for (const raw of log) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date))) {
      changed = true;
      continue;
    }
    let entry = raw;
    if (raw.nightKeyVersion !== NIGHT_KEY_VERSION) {
      entry = { ...raw, date: legacyNightKey(raw), nightKeyVersion: NIGHT_KEY_VERSION };
      changed = true;
    }
    const same = out.findIndex(e => e.date === entry.date);
    if (same >= 0) { out[same] = entry; changed = true; } else out.push(entry);
  }
  return { log: out, changed };
}

// Record a night's sleep. Called when a timer completes.
function recordNight(bedTime, wakeTime, estimatedHours) {
  const data = load();
  const today = localNightKey();
  const safeEstimated = Number.isFinite(Number(estimatedHours)) ? Math.max(0, Math.min(24, Number(estimatedHours))) : 0;

  // Calculate debt for this night.
  const debt = Math.max(0, data.targetHours - safeEstimated);
  const surplus = Math.max(0, safeEstimated - data.targetHours);

  // Update or add entry for today.
  const existing = data.dailyLog.findIndex(e => e.date === today);
  const entry = {
    date: today,
    bedTime: isValidTimeHHMM(bedTime) ? bedTime : '23:00',
    wakeTime: isValidTimeHHMM(wakeTime) ? wakeTime : (data.wakeTime || '07:00'),
    // actualHours is retained for backwards-compatible data import only.
    actualHours: Math.round(safeEstimated * 10) / 10,
    estimatedHours: Math.round(safeEstimated * 10) / 10,
    measurement: 'timer_estimate',
    nightKeyVersion: NIGHT_KEY_VERSION,
    targetHours: data.targetHours,
    debt: Math.round(debt * 10) / 10,
    surplus: Math.round(surplus * 10) / 10
  };

  if (existing >= 0) data.dailyLog[existing] = entry;
  else data.dailyLog.push(entry);

  // Keep only last 90 days.
  const cutoff = localNightKey(Date.now() - 90 * 86400000);
  data.dailyLog = data.dailyLog.filter(e => e.date >= cutoff);

  save();
  return entry;
}

// Get sleep debt summary.
function getDebtSummary() {
  const data = load();
  const weekAgo = localNightKey(Date.now() - 7 * 86400000);
  const recent = data.dailyLog.filter(e => e.date >= weekAgo);

  const weekDebt = recent.reduce((sum, e) => sum + (e.debt || 0), 0);
  const weekSurplus = recent.reduce((sum, e) => sum + (e.surplus || 0), 0);
  const weekAvg = recent.length ? (recent.reduce((sum, e) => sum + (e.estimatedHours ?? e.actualHours ?? 0), 0) / recent.length) : 0;

  const totalDebt = data.dailyLog.reduce((sum, e) => sum + (e.debt || 0), 0);
  const totalSurplus = data.dailyLog.reduce((sum, e) => sum + (e.surplus || 0), 0);

  return {
    targetHours: data.targetHours,
    wakeTime: data.wakeTime || '07:00',
    weekDebt: Math.round(weekDebt * 10) / 10,
    weekSurplus: Math.round(weekSurplus * 10) / 10,
    weekAvg: Math.round(weekAvg * 10) / 10,
    totalDebt: Math.round(totalDebt * 10) / 10,
    totalSurplus: Math.round(totalSurplus * 10) / 10,
    nightsTracked: data.dailyLog.length,
    weekNights: recent.length,
    dailyLog: data.dailyLog.slice(-7).reverse(),
    netDebt: Math.round((totalDebt - totalSurplus) * 10) / 10,
    basis: 'Estimated from timer completion to configured wake time; not measured sleep.',
    isMeasuredSleep: false
  };
}

// Set target hours.
function setTargetHours(hours) {
  const data = load();
  const numeric = Number(hours);
  if (!Number.isFinite(numeric)) return data.targetHours;
  data.targetHours = Math.max(4, Math.min(12, Math.round(numeric * 2) / 2));
  save();
  return data.targetHours;
}

// The wake time nights are estimated against (set-wake-time).
function getWakeTime() {
  const data = load();
  return isValidTimeHHMM(data.wakeTime) ? data.wakeTime : '07:00';
}

// Set wake time.
function setWakeTime(time) {
  const data = load();
  if (!isValidTimeHHMM(time)) return data.wakeTime || '07:00';
  data.wakeTime = time;
  save();
  return data.wakeTime;
}

// Calculate estimated actual sleep hours from bed time to wake time.
function estimateSleepHours(bedTime, wakeTime) {
  const safeBed = isValidTimeHHMM(bedTime) ? bedTime : '23:00';
  const safeWake = isValidTimeHHMM(wakeTime) ? wakeTime : '07:00';
  const [bh, bm] = safeBed.split(':').map(Number);
  const [wh, wm] = safeWake.split(':').map(Number);
  const bedMin = bh * 60 + bm;
  let wakeMin = wh * 60 + wm;
  if (wakeMin <= bedMin) wakeMin += 24 * 60; // crossed midnight
  return (wakeMin - bedMin) / 60;
}

// Get debt status label.
function getDebtLabel(netDebt) {
  if (netDebt <= 0) return { label: 'No estimated deficit', color: '#4caf50', icon: '\u{2713}' };
  if (netDebt <= 2) return { label: 'Small estimate', color: '#8bc34a', icon: '\u{223C}' };
  if (netDebt <= 5) return { label: 'Moderate estimate', color: '#ff9800', icon: '\u{223C}' };
  return { label: 'Large estimate', color: '#ff5722', icon: '\u{223C}' };
}

module.exports = {
  getWakeTime,
  recordNight,
  getDebtSummary,
  setTargetHours,
  setWakeTime,
  estimateSleepHours,
  getDebtLabel,
  // Testing helpers.
  _load: load,
  _legacyNightKey: legacyNightKey,
  _reset: () => { cache = null; }
};
