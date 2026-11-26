// Bedtime Reminder: gentle nudge 15 minutes before your configured bedtime.
// Not a timer, just a notification. The #1 feature of every sleep app.

let reminderInterval = null;
let lastReminderDate = null;
let reminderMinutesBefore = 15;
let onReminderCallback = null;

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minutesUntilBedtime(bedtime, now = new Date()) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(bedtime || '').trim());
  if (!match) return null;
  const bedtimeMin = Number(match[1]) * 60 + Number(match[2]);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Wrap across midnight so e.g. bedtime 00:00 at 23:45 yields 15 minutes.
  return ((bedtimeMin - nowMin) + 1440) % 1440;
}

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

function checkBedtime(now = new Date()) {
  const bedtime = getBedtimeFromSettings();
  if (!bedtime) return;
  if (reminderMinutesBefore <= 0) return;

  const minutesUntil = minutesUntilBedtime(bedtime, now);
  if (minutesUntil === null) return;

  // Key on the target bedtime's local date so a 23:50 reminder for 00:00 does
  // not collide with the previous night or use UTC date rollovers.
  const targetAt = new Date(now.getTime() + minutesUntil * 60000);
  const targetKey = `${localDateKey(targetAt)}@${bedtime}`;
  if (lastReminderDate === targetKey) return;

  if (minutesUntil > 0 && minutesUntil <= reminderMinutesBefore) {
    lastReminderDate = targetKey;
    const message = `Your bedtime is in ${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}. Start winding down?`;

    // Show native notification via Electron (never spawning PowerShell WinForms).
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
  try {
    const { Notification } = require('electron');
    if (Notification && Notification.isSupported()) {
      const n = new Notification({ title: String(title || 'Lights Out'), body: String(body || ''), silent: true });
      n.show();
    }
  } catch { /* non-Electron test environment */ }
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
  getMinutesBefore,
  __minutesUntilBedtime: minutesUntilBedtime
};
