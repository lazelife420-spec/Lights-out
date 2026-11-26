// Idle Detection: notices when you walk away from the computer
// and nudges wind-down. Uses Electron's native powerMonitor.getSystemIdleTime()
// in-process so it never spawns PowerShell/C# compilers in the background.

let idleCheckInterval = null;
let lastIdleSeconds = 0;
let idleThresholdSeconds = 300; // 5 min default
let onIdleCallback = null;
let onReturnCallback = null;
let wasIdle = false;

function normalizeThreshold(seconds, fallback = 300) {
  const num = Number(seconds);
  if (!Number.isFinite(num)) return fallback;
  if (num <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(60, num);
}

// Start monitoring idle time. When disabled (threshold <= 0 -> Infinity), does
// not run a background timer at all.
function startMonitoring(options = {}) {
  idleThresholdSeconds = normalizeThreshold(options.thresholdSeconds, 300);
  onIdleCallback = options.onIdle || null;
  onReturnCallback = options.onReturn || null;
  wasIdle = false;

  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
  if (Number.isFinite(idleThresholdSeconds)) {
    idleCheckInterval = setInterval(checkIdle, 15000); // check every 15s
  }
}

function stopMonitoring() {
  if (idleCheckInterval) { clearInterval(idleCheckInterval); idleCheckInterval = null; }
}

async function checkIdle() {
  if (!Number.isFinite(idleThresholdSeconds)) return;
  try {
    const idleSec = await getIdleSeconds();
    lastIdleSeconds = idleSec;

    if (!wasIdle && idleSec >= idleThresholdSeconds) {
      wasIdle = true;
      if (onIdleCallback) onIdleCallback(idleSec);
    } else if (wasIdle && idleSec < 10) {
      wasIdle = false;
      if (onReturnCallback) onReturnCallback();
    }
  } catch { /* best effort */ }
}

// Get system idle time in seconds natively via Electron's powerMonitor.
async function getIdleSeconds() {
  try {
    const { powerMonitor } = require('electron');
    if (powerMonitor && typeof powerMonitor.getSystemIdleTime === 'function') {
      const sec = Number(powerMonitor.getSystemIdleTime());
      return Number.isFinite(sec) && sec >= 0 ? sec : 0;
    }
  } catch { /* non-Electron test environment */ }
  return 0;
}

function setThreshold(seconds) {
  idleThresholdSeconds = normalizeThreshold(seconds, idleThresholdSeconds);
  if (Number.isFinite(idleThresholdSeconds)) {
    if (!idleCheckInterval) idleCheckInterval = setInterval(checkIdle, 15000);
  } else {
    stopMonitoring();
    wasIdle = false;
  }
}

function getThreshold() {
  return Number.isFinite(idleThresholdSeconds) ? idleThresholdSeconds : 0;
}

function isIdle() {
  return wasIdle;
}

function getLastIdleSeconds() {
  return lastIdleSeconds;
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  getIdleSeconds,
  setThreshold,
  getThreshold,
  isIdle,
  getLastIdleSeconds
};
