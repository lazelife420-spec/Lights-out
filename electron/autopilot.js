// Autopilot Bedtime: learns your bedtime pattern and auto-starts the timer.
// Reads streak history to compute your average and most consistent bedtime,
// then schedules a timer start at that time (with a 5-min warning).
// Fully opt-in — does nothing unless enabled in settings.

const settingsStore = require('./settings');
const streaks = require('./streaks');
const runReceipts = require('./runReceipts');
const watchdog = require('./watchdog');

let autopilotTimeout = null;
let warningTimeout = null;
let mainWindowRef = null;

// ─────────────────────────────────────────────────────────────────────────────
// Learn the user's bedtime from history
// ─────────────────────────────────────────────────────────────────────────────

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_FIRE_LATENESS_MS = 5 * 60 * 1000; // 5 min grace for timer jitter; older means PC slept through bedtime

function parseValidHHMM(raw) {
  if (typeof raw !== 'string') return null;
  const match = HHMM_RE.exec(raw.trim());
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]), text: `${match[1]}:${match[2]}` };
}

function learnBedtime() {
  const data = streaks.getSummary();
  const days = data.weekDays || [];
  if (days.length < 3) return null; // need at least 3 data points

  // Convert bedtimes to midnight-wrapped night minutes (00:00-05:59 follow 23:59)
  // so 23:45..00:15 averages to 00:00 instead of 12:00 noon.
  const mins = [];
  for (const d of days) {
    const parsed = parseValidHHMM(d && d.bedTime ? d.bedTime : '22:30');
    if (!parsed) continue;
    mins.push((parsed.h < 6 ? parsed.h + 24 : parsed.h) * 60 + parsed.m);
  }
  if (mins.length < 3) return null;

  // Median bedtime (more robust than mean).
  const sorted = [...mins].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Standard deviation.
  const mean = mins.reduce((s, v) => s + v, 0) / mins.length;
  const stdDev = Math.sqrt(mins.reduce((s, v) => s + (v - mean) ** 2, 0) / mins.length);

  // Confidence: lower std dev = higher confidence.
  const confidence = stdDev < 15 ? 'high' : stdDev < 30 ? 'medium' : 'low';

  const wrappedMedian = ((median % 1440) + 1440) % 1440;
  const h = Math.floor(wrappedMedian / 60);
  const m = wrappedMedian % 60;
  const bedtime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  return {
    bedtime,
    medianMinutes: wrappedMedian,
    stdDevMinutes: Math.round(stdDev),
    confidence,
    sampleSize: mins.length
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule: sets a timeout for tonight's auto-start
// ─────────────────────────────────────────────────────────────────────────────

// The armed fire time is persisted so the NEXT launch can tell whether an
// armed bedtime passed while the app was not running. Without this the miss
// is silent — the user finds the PC still on in the morning with no record.
// An honest 'missed' receipt is recorded once, then the slot is re-armed.
function recordMissedFireIfAny(appSettings) {
  const priorFireAt = appSettings.autopilotNextFireAt;
  if (!priorFireAt) return null;
  const priorMs = new Date(priorFireAt).getTime();
  if (!Number.isFinite(priorMs) || priorMs >= Date.now()) return null;
  try {
    const receipt = runReceipts.createRunReceipt({
      action: appSettings.action || 'shutdown',
      totalSeconds: appSettings.durationSeconds || 0,
      origin: 'autopilot',
      dryRun: Boolean(appSettings.dryRun)
    });
    runReceipts.updateRunReceipt(receipt.id, {
      result: 'missed',
      startedAt: priorFireAt,
      endedAt: priorFireAt,
      notes: 'Autopilot bedtime was armed but the app was not running at fire time; nothing happened.'
    });
    return receipt.id;
  } catch {
    return null; // missed-fire bookkeeping must never break scheduling
  }
}

function schedule(startTimerFn, win) {
  // Read settings first: the missed-fire check needs the persisted arm before
  // cancel() clears it.
  const appSettings = settingsStore.getSection('app') || {};
  const missedReceiptId = appSettings.autopilotEnabled ? recordMissedFireIfAny(appSettings) : null;

  cancel(); // clear any existing schedule (also clears the persisted arm)
  mainWindowRef = win;

  if (!appSettings.autopilotEnabled) return { missedReceiptId };

  // Explicit autopilot override wins, then the learned pattern, then the
  // generic configured bedtime (settings.js documents this same order).
  // Strictly validate HH:MM so malformed input can never produce setTimeout(NaN).
  const learned = learnBedtime();
  const parsedTarget = parseValidHHMM(appSettings.autopilotBedtime)
    || parseValidHHMM(learned && learned.bedtime)
    || parseValidHHMM(appSettings.bedtime)
    || { h: 22, m: 30, text: '22:30' };
  const targetBedtime = parsedTarget.text;
  const th = parsedTarget.h;
  const tm = parsedTarget.m;

  // Calculate ms until target time today.
  const now = new Date();
  const target = new Date(now);
  target.setHours(th, tm, 0, 0);

  // If target is already past, schedule for tomorrow.
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const msUntilTarget = Math.max(1000, target.getTime() - now.getTime());
  const targetMs = target.getTime();
  const targetIso = target.toISOString();
  const warningMs = Math.max(0, msUntilTarget - 5 * 60 * 1000); // 5 min before

  // Persist the arm so a future launch can detect a missed fire, and arm the
  // scheduled-task watchdog that relaunches the app if it is not running.
  try {
    settingsStore.updateSection('app', { autopilotNextFireAt: targetIso });
  } catch { /* best effort: persistence failure must not break the arm */ }
  watchdog.sync(target);

  // Warning notification.
  warningTimeout = setTimeout(() => {
    if (Date.now() - targetMs > MAX_FIRE_LATENESS_MS) return;
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('autopilot-warning', {
        bedtime: targetBedtime,
        minutesUntil: 5,
        learned: learned?.confidence || 'manual'
      });
    }
  }, warningMs);

  // Auto-start timer.
  autopilotTimeout = setTimeout(() => {
    const fireSettings = settingsStore.getSection('app') || {};
    // If the laptop slept past bedtime and woke up hours later (e.g. 08:00 AM),
    // never fire a stale real shutdown — record an honest 'missed' receipt and
    // re-arm for tonight instead.
    if (Date.now() - targetMs > MAX_FIRE_LATENESS_MS) {
      recordMissedFireIfAny({ ...fireSettings, autopilotNextFireAt: targetIso });
      try { settingsStore.updateSection('app', { autopilotNextFireAt: null }); } catch { /* best effort */ }
      schedule(startTimerFn, mainWindowRef);
      return;
    }
    // The arm for tonight is consumed — clear the persisted slot BEFORE
    // re-arming, or schedule()'s missed-fire check would see tonight's
    // (now past) arm as a miss.
    try {
      settingsStore.updateSection('app', { autopilotNextFireAt: null });
    } catch { /* best effort */ }
    // Read the settings at fire time, hours after scheduling: Test Mode,
    // action, duration and grace must be what the user has set NOW.
    const duration = fireSettings.durationSeconds || 28 * 60;
    const action = fireSettings.action || 'shutdown';
    const result = startTimerFn({
      durationSeconds: duration,
      action,
      dryRun: Boolean(fireSettings.dryRun),
      forceShutdown: Boolean(fireSettings.forceShutdown),
      muteSystem: Boolean(fireSettings.muteSystem),
      gracePeriod: fireSettings.graceMinutes ?? 2,
      source: 'autopilot',
      origin: 'autopilot'
    });
    // Announce only a start that really happened (it is refused while
    // another run is active).
    if (result && result.success && mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('autopilot-started', {
        bedtime: targetBedtime,
        duration
      });
    }
    // Re-arm for the next night. Without this the first fire (or a refused
    // start) leaves autopilot permanently spent while the app keeps running.
    schedule(startTimerFn, mainWindowRef);
  }, msUntilTarget);

  return {
    targetBedtime,
    msUntilTarget,
    learned,
    missedReceiptId,
    scheduledAt: now.toISOString()
  };
}

function cancel() {
  if (autopilotTimeout) { clearTimeout(autopilotTimeout); autopilotTimeout = null; }
  if (warningTimeout) { clearTimeout(warningTimeout); warningTimeout = null; }
  try {
    settingsStore.updateSection('app', { autopilotNextFireAt: null });
  } catch { /* best effort */ }
  watchdog.sync(null);
}

function getStatus() {
  const appSettings = settingsStore.getSection('app') || {};
  const learned = learnBedtime();
  return {
    enabled: Boolean(appSettings.autopilotEnabled),
    bedtime: appSettings.autopilotBedtime || learned?.bedtime || appSettings.bedtime || null,
    nextFireAt: appSettings.autopilotNextFireAt || null,
    learned,
    scheduled: autopilotTimeout !== null
  };
}

module.exports = {
  learnBedtime,
  schedule,
  cancel,
  getStatus,
  MAX_FIRE_LATENESS_MS
};
