// Bedtime Reminder: gentle nudge 15 minutes before your configured bedtime.
// Not a timer, just a notification. The #1 feature of every sleep app.

const { spawn } = require('child_process');

let reminderInterval = null;
let lastReminderDate = null;
let reminderMinutesBefore = 15;
let onReminderCallback = null;

function normalizeReminderMinutes(value, fallback = 15) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num <= 0) return 0;
  return Math.max(1, Math.round(num));
}

// Start checking if it's almost bedtime.
function startReminder(options = {}) {
  // Read persisted settings if no override.
  const appSettings = getAppSettings();
  reminderMinutesBefore = normalizeReminderMinutes(
    options.minutesBefore !== undefined ? options.minutesBefore : appSettings.bedtimeReminderMinutes,
    15
  );
  onReminderCallback = options.onReminder || null;

  if (reminderInterval) clearInterval(reminderInterval);
  reminderInterval = setInterval(checkBedtime, 60000); // check every minute
  checkBedtime(); // check immediately
}

function stopReminder() {
  if (reminderInterval) { clearInterval(reminderInterval); reminderInterval = null; }
}

function checkBedtime() {
  const bedtime = getBedtimeFromSettings();
  if (!bedtime) return;
  if (reminderMinutesBefore <= 0) return;

  const now = new Date();
  const [bh, bm] = bedtime.split(':').map(Number);
  const bedtimeMin = bh * 60 + bm;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const minutesUntil = bedtimeMin - nowMin;

  // Only remind once per day.
  const today = now.toISOString().slice(0, 10);
  if (lastReminderDate === today) return;

  if (minutesUntil > 0 && minutesUntil <= reminderMinutesBefore) {
    lastReminderDate = today;
    const message = `Your bedtime is in ${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}. Start winding down?`;

    // Show native notification.
    showNativeNotification('Lights Out', message);

    // Fire callback for renderer.
    if (onReminderCallback) onReminderCallback({ minutesUntil, bedtime, message });

  }
}

function getBedtimeFromSettings() {
  try {
    const settingsStore = require('./settings');
    const app = settingsStore.getSection('app') || {};
    // Don't remind if disabled.
    if (app.bedtimeReminderEnabled === false) return null;
    return app.bedtime || null;
  } catch { return null; }
}

function getAppSettings() {
  try {
    const settingsStore = require('./settings');
    return settingsStore.getSection('app') || {};
  } catch { return {}; }
}

function showNativeNotification(title, body) {
  const escapedTitle = String(title).replace(/'/g, "''");
  const escapedBody = String(body).replace(/'/g, "''");
  const cmd = `
    [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
    Start-Sleep -Milliseconds 100
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = '${escapedTitle}'
    $notify.BalloonTipText = '${escapedBody}'
    $notify.Visible = $true
    $notify.ShowBalloonTip(5000)
    Start-Sleep -Milliseconds 5500
    $notify.Dispose()
  `;
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { detached: true, stdio: 'ignore' }).unref();
}

function setMinutesBefore(min) {
  reminderMinutesBefore = normalizeReminderMinutes(min, reminderMinutesBefore);
}

function getMinutesBefore() {
  return reminderMinutesBefore;
}

module.exports = {
  startReminder,
  stopReminder,
  setMinutesBefore,
  getMinutesBefore
};
