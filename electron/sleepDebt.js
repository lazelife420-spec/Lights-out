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
      if (recovered) save();
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

// Record a night's sleep. Called when a timer completes.
function recordNight(bedTime, wakeTime, estimatedHours) {
  const data = load();
  const today = new Date().toISOString().slice(0, 10);

  // Calculate debt for this night.
  const debt = Math.max(0, data.targetHours - estimatedHours);
  const surplus = Math.max(0, estimatedHours - data.targetHours);

  // Update or add entry for today.
  const existing = data.dailyLog.findIndex(e => e.date === today);
  const entry = {
    date: today,
    bedTime: bedTime || '23:00',
    wakeTime: wakeTime || data.wakeTime || '07:00',
    // actualHours is retained for backwards-compatible data import only.
    actualHours: Math.round(estimatedHours * 10) / 10,
    estimatedHours: Math.round(estimatedHours * 10) / 10,
    measurement: 'timer_estimate',
    targetHours: data.targetHours,
    debt: Math.round(debt * 10) / 10,
    surplus: Math.round(surplus * 10) / 10
  };

  if (existing >= 0) data.dailyLog[existing] = entry;
  else data.dailyLog.push(entry);

  // Keep only last 90 days.
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  data.dailyLog = data.dailyLog.filter(e => e.date >= cutoff);

  save();
  return entry;
}

// Get sleep debt summary.
function getDebtSummary() {
  const data = load();
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
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
  data.targetHours = Math.max(4, Math.min(12, hours));
  save();
  return data.targetHours;
}

// Set wake time.
function setWakeTime(time) {
  const data = load();
  data.wakeTime = time;
  save();
  return data.wakeTime;
}

// Calculate estimated actual sleep hours from bed time to wake time.
function estimateSleepHours(bedTime, wakeTime) {
  const [bh, bm] = bedTime.split(':').map(Number);
  const [wh, wm] = (wakeTime || '07:00').split(':').map(Number);
  let bedMin = bh * 60 + bm;
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

function reset() {
  cache = null;
}

module.exports = {
  recordNight,
  getDebtSummary,
  setTargetHours,
  setWakeTime,
  estimateSleepHours,
  getDebtLabel,
  // Testing helpers.
  _load: load,
  _reset: () => { cache = null; }
};
