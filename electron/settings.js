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
  if (typeof value !== 'string' || value === '' || value.startsWith(ENC_PREFIX)) return value;
  if (!encryptionAvailable()) return value; // fall back to plaintext rather than lose data
  try {
    return ENC_PREFIX + electron.safeStorage.encryptString(value).toString('base64');
  } catch {
    return value;
  }
}

function decryptSecret(value) {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;
  if (!encryptionAvailable()) return ''; // cannot recover; surface as empty so the user re-enters
  try {
    return electron.safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}

// Apply fn to each present secret field in `tree`, mutating it in place.
function transformSecrets(tree, fn) {
  if (!tree || typeof tree !== 'object') return tree;
  for (const segments of SECRET_PATHS) {
    let node = tree;
    for (let i = 0; i < segments.length - 1; i++) {
      node = node && node[segments[i]];
    }
    const leaf = segments[segments.length - 1];
    if (node && typeof node === 'object' && typeof node[leaf] === 'string') {
      node[leaf] = fn(node[leaf]);
    }
  }
  return tree;
}

let configPath = null;
let cache = null;

const DEFAULTS = {
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
    timerName: 'Witching Hour',
    bedtimeReminderEnabled: true,
    bedtimeReminderMinutes: 15,
    idleDetectionEnabled: false,
    idleThresholdSeconds: 300,
    calendarAutoStart: false,
    // Wind-down system actions. Default OFF so the app never touches the OS unasked.
    nightLightOnDim: false,
    pauseMediaOnDim: false,
    lockoutOnDim: false,
    // Clock Mode: show current time when idle instead of countdown input.
    clockMode: true,
    // Clock face style when idle in Clock Mode: 'digital' | 'analog' | 'hybrid'.
    clockFace: 'hybrid',
    // Analog/hybrid clock customization.
    clockStyle: 'modern',          // 'modern' | 'bold' | 'minimal' | 'neon' | 'classic'
    clockDial: 'bars',             // 'bars' | 'minutes' | 'arabic' | 'roman' | 'auto'
    clockFormat: '24h',            // '24h' | '12h'
    clockScale: 1,                 // 0.8 - 1.35
    clockShowDate: false,
    clockHandColor: '#76c9ff',     // hand + cap accent color
    clockSeconds: true,            // show the second hand
    clockSweep: true,              // smooth sweep vs per-second tick
    // Northstar UI state
    nsActiveTab: 'lib',            // last active sidebar tab
    nsSelectedMode: ''             // last selected lobby mode card
  },
  calendar: {
    enabled: true,
    provider: 'builtin',
    syncIntervalMin: 30,
    autoStartFromEvents: false,
    builtin: {
      enabled: true,
      bedtime: '22:30',
      days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
      action: 'shutdown'
    },
    ical: { url: '' },
    google: { apiKey: '', calendarId: '' },
    outlook: { accessToken: '' },
    calendly: { personalToken: '' }
  },
  smartLights: {
    enabled: false,
    provider: 'none',
    mode: 'gradual_dim',
    dimMinutes: 10,
    hueBridgeIp: '',
    hueUsername: '',
    hueLightIds: [],
    hueGroupId: '',
    httpUrl: '',
    httpMethod: 'POST',
    httpHeaders: {},
    httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}'
  },
  customization: {
    accent: '#5b8cff',
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
    provider: 'firewall',
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
    useDefault: true
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

function load() {
  try {
    const file = getConfigPath();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = deepMerge(DEFAULTS, parsed);
      transformSecrets(cache, decryptSecret); // in-memory cache holds plaintext secrets
      return cache;
    }
  } catch (error) {
    console.error('Failed to load settings:', error.message);
  }
  cache = clone(DEFAULTS);
  return cache;
}

function ensureLoaded() {
  if (!cache) load();
  return cache;
}

function save() {
  try {
    // Serialize an encrypted copy; keep the in-memory cache as plaintext so the
    // rest of the app keeps reading usable values.
    const toWrite = transformSecrets(clone(ensureLoaded()), encryptSecret);
    fs.writeFileSync(getConfigPath(), JSON.stringify(toWrite, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error.message);
    return false;
  }
}

function getAll() {
  return clone(ensureLoaded());
}

function getSection(section) {
  return clone(ensureLoaded()[section]);
}

function updateSection(section, patch) {
  ensureLoaded();
  if (!cache[section] || typeof cache[section] !== 'object' || Array.isArray(cache[section])) {
    cache[section] = clone(patch);
  } else {
    cache[section] = deepMerge(cache[section], patch || {});
  }
  save();
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
