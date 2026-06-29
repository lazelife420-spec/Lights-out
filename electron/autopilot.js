// Autopilot Bedtime: learns your bedtime pattern and auto-starts the timer.
// Reads streak history to compute your average and most consistent bedtime,
// then schedules a timer start at that time (with a 5-min warning).
// Fully opt-in — does nothing unless enabled in settings.

const settingsStore = require('./settings');
const streaks = require('./streaks');

let autopilotTimeout = null;
let warningTimeout = null;
let mainWindowRef = null;

// ─────────────────────────────────────────────────────────────────────────────
// Learn the user's bedtime from history
// ─────────────────────────────────────────────────────────────────────────────

function learnBedtime() {
  const data = streaks.getSummary();
  const days = data.weekDays || [];
  if (days.length < 3) return null; // need at least 3 data points

  // Convert bedtimes to minutes-since-midnight.
  const mins = days.map(d => {
    const [h, m] = (d.bedTime || '22:30').split(':').map(Number);
    return h * 60 + m;
  });

  // Median bedtime (more robust than mean).
  const sorted = [...mins].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Standard deviation.
  const mean = mins.reduce((s, v) => s + v, 0) / mins.length;
  const stdDev = Math.sqrt(mins.reduce((s, v) => s + (v - mean) ** 2, 0) / mins.length);

  // Confidence: lower std dev = higher confidence.
  const confidence = stdDev < 15 ? 'high' : stdDev < 30 ? 'medium' : 'low';

  const h = Math.floor(median / 60) % 24;
  const m = median % 60;
  const bedtime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  return {
    bedtime,
    medianMinutes: median,
    stdDevMinutes: Math.round(stdDev),
    confidence,
    sampleSize: days.length
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule: sets a timeout for tonight's auto-start
// ─────────────────────────────────────────────────────────────────────────────

function schedule(startTimerFn, win) {
  cancel(); // clear any existing schedule
  mainWindowRef = win;

  const appSettings = settingsStore.getSection('app') || {};
  if (!appSettings.autopilotEnabled) return null;

  // Use user-configured bedtime or learned one.
  const learned = learnBedtime();
  const targetBedtime = appSettings.autopilotBedtime || appSettings.bedtime || learned?.bedtime || '22:30';
  const [th, tm] = targetBedtime.split(':').map(Number);

  // Calculate ms until target time today.
  const now = new Date();
  const target = new Date(now);
  target.setHours(th, tm, 0, 0);

  // If target is already past, schedule for tomorrow.
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const msUntilTarget = target - now;
  const warningMs = Math.max(0, msUntilTarget - 5 * 60 * 1000); // 5 min before

  // Warning notification.
  warningTimeout = setTimeout(() => {
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
    const duration = appSettings.durationSeconds || 28 * 60;
    const action = appSettings.action || 'shutdown';
    startTimerFn({
      durationSeconds: duration,
      action,
      dryRun: Boolean(appSettings.dryRun),
      forceShutdown: Boolean(appSettings.forceShutdown),
      muteSystem: Boolean(appSettings.muteSystem),
      gracePeriod: appSettings.graceMinutes ?? 2,
      source: 'autopilot'
    });
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('autopilot-started', {
        bedtime: targetBedtime,
        duration
      });
    }
  }, msUntilTarget);

  return {
    targetBedtime,
    msUntilTarget,
    learned,
    scheduledAt: now.toISOString()
  };
}

function cancel() {
  if (autopilotTimeout) { clearTimeout(autopilotTimeout); autopilotTimeout = null; }
  if (warningTimeout) { clearTimeout(warningTimeout); warningTimeout = null; }
}

function getStatus() {
  const appSettings = settingsStore.getSection('app') || {};
  return {
    enabled: Boolean(appSettings.autopilotEnabled),
    bedtime: appSettings.autopilotBedtime || appSettings.bedtime || null,
    learned: learnBedtime(),
    scheduled: autopilotTimeout !== null
  };
}

module.exports = {
  learnBedtime,
  schedule,
  cancel,
  getStatus
};
