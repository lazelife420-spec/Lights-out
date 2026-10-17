// Stateful settings persistence for the Electron edition.
// Stores all user-facing settings (app, smart lights, customization, active timer)
// in userData\settings.json. Mirrors the persistence pattern used by profiles.js.

const electron = require('electron');
const { app } = electron;
const path = require('path');
const fs = require('fs');

const SETTINGS_FILE = 'settings.json';

// Credential-bearing fields that should not sit in plaintext on disk. Each is a
// path within the settings tree. Values are encrypted with the OS keystore
// (DPAPI on Windows) via Electron's safeStorage when available, and transparently
// decrypted back into memory on load. Legacy plaintext values still load fine.
const SECRET_PATHS = [
  ['wifiGuard', 'routerPass'],
  ['calendar', 'google', 'apiKey'],
  ['calendar', 'outlook', 'accessToken'],
  ['calendar', 'calendly', 'personalToken'],
  ['smartLights', 'hueUsername'],
  // Credential-bearing header map (e.g. Authorization) for the HTTP webhook
  // provider. Stored encrypted as a serialized JSON object.
  ['smartLights', 'httpHeaders'],
  ['remoteControl', 'token']
];
const ENC_PREFIX = 'enc:v1:';

function encryptionAvailable() {
  try {
    return !!(electron.safeStorage && electron.safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function encryptSecret(value) {
  const isObject = value !== null && typeof value === 'object';
  const str = isObject ? JSON.stringify(value) : value;
  if (typeof str !== 'string' || str === '' || str === '{}' || str.startsWith(ENC_PREFIX)) return value;
  if (!encryptionAvailable()) return value; // fall back to plaintext rather than lose data
  try {
    return ENC_PREFIX + electron.safeStorage.encryptString(str).toString('base64');
  } catch {
    return value;
  }
}

function decryptSecret(value) {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;
  if (!encryptionAvailable()) return ''; // cannot recover; surface as empty so the user re-enters
  try {
    const plain = electron.safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
    // Object-valued secrets were serialized before encryption; restore shape.
    if (plain.startsWith('{') || plain.startsWith('[')) {
      try { return JSON.parse(plain); } catch { /* fall through */ }
    }
    return plain;
  } catch {
    return '';
  }
}

// Apply fn to each present secret field in `tree`, mutating it in place.
// Object-valued secrets (e.g. a header map) are serialized to JSON before
// encryption and parsed back on decrypt.
function transformSecrets(tree, fn) {
  if (!tree || typeof tree !== 'object') return tree;
  for (const segments of SECRET_PATHS) {
    let node = tree;
    for (let i = 0; i < segments.length - 1; i++) {
      node = node && node[segments[i]];
    }
    const leaf = segments[segments.length - 1];
    if (node && typeof node === 'object' && node[leaf] !== undefined && node[leaf] !== null) {
      node[leaf] = fn(node[leaf]);
    }
  }
  return tree;
}

let configPath = null;
let cache = null;

const DEFAULTS = {
  window: {
    bounds: null,
    maximized: false
  },
  app: {
    action: 'shutdown',
    unit: 'min',
    durationSeconds: 28 * 60,
    sound: true,
    gracefulClose: true,
    forceShutdown: false,
    muteSystem: false,
    graceMinutes: 2,
    dryRun: false,
    focusBlocklist: [],
    onboarded: false,
    bedtime: '22:30',
    timerName: 'Last Call',
    bedtimeReminderEnabled: true,
    bedtimeReminderMinutes: 15,
    idleDetectionEnabled: false,
    idleThresholdSeconds: 300,
    calendarAutoStart: false,
    // Autopilot Bedtime: learns your pattern and auto-starts the timer. OFF by default.
    autopilotEnabled: false,
    autopilotBedtime: null,   // null = use learned bedtime or configured bedtime
    // Wind-down system actions. Default OFF so the app never touches the OS unasked.
    nightLightOnDim: false,
    pauseMediaOnDim: false,
    lockoutOnDim: false,
    // Clock Mode: show current time when idle instead of countdown input.
    clockMode: true,
    // Countdown ring is the default; analog is an optional idle clock face.
    clockFace: 'digital',
    // Analog/hybrid clock customization.
    clockStyle: 'modern',          // 'modern' | 'bold' | 'minimal' | 'neon' | 'classic'
    clockDial: 'bars',             // 'bars' | 'minutes' | 'arabic' | 'roman' | 'auto'
    clockFormat: '24h',            // '24h' | '12h'
    clockScale: 1,                 // 0.8 - 1.35
    clockShowDate: false,
    clockHandColor: '#9b93d6',     // hand + cap accent color (violet; legacy #76c9ff maps to violet at render time)
    clockSeconds: true,            // show the second hand
    clockSweep: true,              // smooth sweep vs per-second tick
    // Northstar UI state
    nsActiveTab: 'lib',            // last active sidebar tab
    nsSelectedMode: '',            // last selected lobby mode card
    widgetVisible: false,          // restore only after a confirmed widget show
    // Identity only: restoring this selection never applies or starts a timer.
    lastSelectedProfileId: null
  },
  calendar: {
    enabled: true,
    provider: 'builtin',
    syncIntervalMin: 30,
    autoStartFromEvents: false,
    builtin: {
      enabled: true,
      // Multiple recurring rules, each an independent "at this time, on these
      // days, do this" trigger (e.g. weeknights vs. weekends can differ).
      // See calendarProviders.js normalizeScheduleRules for the legacy
      // single-schedule shape this superseded.
      rules: [
        { id: 'default', label: 'Bedtime', time: '22:30', days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], action: 'shutdown', durationMinutes: 60, enabled: true }
      ]
    },
    ical: { url: '' },
    google: { apiKey: '', calendarId: '' },
    outlook: { accessToken: '' },
    calendly: { personalToken: '' }
  },
  smartLights: {
    enabled: false,
    provider: 'none',
    wizAddresses: [],
    wizDevices: [],
    wizLook: { mode: 'current', brightness: 50, temperature: 2700, color: '#ff9f43', sceneId: 14 },
    mode: 'gradual_dim',
    dimMinutes: 10,
    hueBridgeIp: '',
    hueUsername: '',
    hueLightIds: [],
    hueGroupId: '',
    hueAllowLegacyHttp: false,
    httpUrl: '',
    httpMethod: 'POST',
    httpHeaders: {},
    httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}',
    verifiedConfigKey: ''
  },
  customization: {
    accent: '#9b93d6',
    theme: 'midnight',
    ringStyle: 'glow',
    opacity: 1,
    volume: 1,
    warmShift: true,
    soundscape: 'off',
    ambientVisual: 'off'
  },
  lastLight: {
    enabled: false,
    sequence: 'ClassicFade',
    sound: 'Off',
    customSequences: []
  },
  wifiGuard: {
    enabled: false,
    provider: 'webhook',
    routerIp: '',
    routerUser: 'admin',
    routerPass: '',
    deviceMacs: [],
    deviceIps: [],
    webhookUrl: '',
    webhookHeaders: {},
    blockOnDim: true,
    unblockOnCancel: true
  },
  contentBlocker: {
    enabled: false,
    blockOnDim: true,
    unblockOnComplete: true,
    blocklist: [],
    useDefault: true,
    // Recurring blocking windows independent of the shutdown timer, e.g.
    // "block social media 22:00-07:00 every night". Each entry:
    // { id, label, startTime, endTime, days: ['sun',...], enabled }.
    schedules: []
  },
  accountability: {
    enabled: false,
    notifyOnStart: true,
    notifyOnSnooze: true,
    notifyOnCancel: true,
    notifyOnComplete: true,
    partners: []
  },
  // LAN remote / family control. OFF by default: when disabled, no network
  // listener (family command server, UDP discovery, companion PWA) ever starts.
  // When enabled, a pairing token is required on every remote command.
  remoteControl: {
    enabled: false,
    mode: 'off',
    port: 58732,
    lanIp: '',
    token: ''
  },
  // Persisted running-timer snapshot for crash/quit recovery. null when idle.
  activeTimer: null
};

function getConfigPath() {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), SETTINGS_FILE);
  }
  return configPath;
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return clone(base);
  const out = clone(base);
  for (const key of Object.keys(override)) {
    const val = override[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], val);
    } else if (val !== undefined) {
      out[key] = clone(val);
    }
  }
  return out;
}

function clone(value) {
  return value === null || typeof value !== 'object'
    ? value
    : JSON.parse(JSON.stringify(value));
}

function tryParseSettingsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw || !raw.trim()) return null;
  return JSON.parse(raw);
}

function load() {
  let file;
  try {
    file = getConfigPath();
  } catch (error) {
    console.error('Failed to load settings:', error.message);
    cache = clone(DEFAULTS);
    return cache;
  }
  const bakFile = file + '.bak';
  const tmpFile = file + '.tmp';

  // Clean stale temp file from a previous interrupted save.
  try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch { /* best effort */ }

  // PRIMARY_VALID: normal case.
  try {
    const parsed = tryParseSettingsFile(file);
    if (parsed) {
      cache = deepMerge(DEFAULTS, parsed);
      pruneSmartLightsSection(cache);
      transformSecrets(cache, decryptSecret);
      return cache;
    }
  } catch (error) {
    console.error('Failed to load settings (primary):', error.message);
  }

  // PRIMARY_CORRUPT_BACKUP_VALID: recover from backup.
  try {
    const parsed = tryParseSettingsFile(bakFile);
    if (parsed) {
      console.warn('Settings: primary corrupt or missing, recovered from backup.');
      cache = deepMerge(DEFAULTS, parsed);
      pruneSmartLightsSection(cache);
      transformSecrets(cache, decryptSecret);
      save();
      return cache;
    }
  } catch (error) {
    console.error('Failed to load settings (backup):', error.message);
  }

  // PRIMARY_AND_BACKUP_CORRUPT or FIRST_RUN: use DEFAULTS.
  if (fs.existsSync(file) || fs.existsSync(bakFile)) {
    console.error('Settings: both primary and backup are corrupt. Starting with defaults.');
  }
  cache = clone(DEFAULTS);
  return cache;
}

// Dead-provider cleanup: earlier revisions advertised MQTT / Home Assistant /
// IFTTT fields that were never reachable through the live config path. Their
// persisted keys (including any plaintext credentials) are dropped on load so
// they are never re-saved.
function pruneSmartLightsSection(tree) {
  const section = tree && tree.smartLights;
  if (!section || typeof section !== 'object') return;
  for (const key of Object.keys(section)) {
    if (!(key in DEFAULTS.smartLights)) delete section[key];
  }
}

function ensureLoaded() {
  if (!cache) load();
  return cache;
}

function save() {
  try {
    const file = getConfigPath();
    const tmpFile = file + '.tmp';
    const bakFile = file + '.bak';

    // Serialize an encrypted copy; keep the in-memory cache as plaintext so the
    // rest of the app keeps reading usable values.
    const toWrite = transformSecrets(clone(ensureLoaded()), encryptSecret);
    const json = JSON.stringify(toWrite, null, 2);

    // 1. Write to temp file.
    fs.writeFileSync(tmpFile, json, 'utf8');

    // 2. Verify the temp file is valid JSON.
    const verification = fs.readFileSync(tmpFile, 'utf8');
    JSON.parse(verification);

    // 3. Backup the current file (if it exists and is non-empty).
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        fs.copyFileSync(file, bakFile);
      }
    } catch (bakErr) {
      console.warn('Settings: failed to create backup:', bakErr.message);
    }

    // 4. Replace primary with verified temp.
    fs.renameSync(tmpFile, file);
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error.message);
    // Clean up failed temp file.
    try { fs.unlinkSync(getConfigPath() + '.tmp'); } catch { /* best effort */ }
    return false;
  }
}

function getAll() {
  return clone(ensureLoaded());
}

function getSection(section) {
  return clone(ensureLoaded()[section]);
}

function updateSection(section, patch, options = {}) {
  ensureLoaded();
  const previous = clone(cache[section]);
  if (!cache[section] || typeof cache[section] !== 'object' || Array.isArray(cache[section])) {
    cache[section] = clone(patch);
  } else {
    cache[section] = deepMerge(cache[section], patch || {});
  }
  if (!save() && options.requireSave) {
    cache[section] = previous;
    throw new Error('Could not save settings. Previous settings are still active.');
  }
  return clone(cache[section]);
}

function setActiveTimer(snapshot) {
  ensureLoaded();
  cache.activeTimer = snapshot ? clone(snapshot) : null;
  save();
  return cache.activeTimer;
}

function getActiveTimer() {
  return clone(ensureLoaded().activeTimer);
}

module.exports = {
  DEFAULTS,
  load,
  save,
  getAll,
  getSection,
  updateSection,
  setActiveTimer,
  getActiveTimer
};
