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
  ['wifiGuard', 'routerUser'],
  ['wifiGuard', 'routerPass'],
  ['wifiGuard', 'webhookUrl'],
  ['wifiGuard', 'webhookHeaders'],
  ['calendar', 'ical', 'url'],
  ['calendar', 'google', 'apiKey'],
  ['calendar', 'outlook', 'accessToken'],
  ['calendar', 'calendly', 'personalToken'],
  ['smartLights', 'hueUsername'],
  // Credential-bearing header map (e.g. Authorization) for the HTTP webhook
  // provider. Stored encrypted as a serialized JSON object.
  ['smartLights', 'httpHeaders'],
  ['smartLights', 'httpUrl'],
  ['smartLights', 'httpBodyTemplate'],
  ['accountability', 'partners', '*', 'url'],
  ['accountability', 'partners', '*', 'webhookUrl'],
  ['accountability', 'partners', '*', 'webhookId'],
  ['accountability', 'partners', '*', 'webhookToken'],
  ['accountability', 'partners', '*', 'headers'],
  ['remoteControl', 'token']
];
// Secrets whose value is an object (a header map). They are serialized to
// JSON before encryption and parsed back on load. Every other secret is a
// string and comes back exactly as decrypted, even when it looks like JSON
// (a router password such as '[2468]', or a JSON webhook body template).
const OBJECT_SECRET_PATHS = [
  ['wifiGuard', 'webhookHeaders'],
  ['smartLights', 'httpHeaders'],
  ['accountability', 'partners', '*', 'headers']
];
// Credentials that only work together (a URL and its headers, a router user
// and password, each bound to its destination). A real new value for one of
// them retires the locked ciphertext of the others, so an old Authorization
// header can never be re-attached to a newly entered URL. Unlisted secrets
// group with their parent object; each accountability partner is a group.
const SECRET_GROUPS = {
  'wifiGuard.routerIp': 'wifiGuard.router',
  'wifiGuard.routerUser': 'wifiGuard.router',
  'wifiGuard.routerPass': 'wifiGuard.router',
  'wifiGuard.webhookUrl': 'wifiGuard.webhook',
  'wifiGuard.webhookHeaders': 'wifiGuard.webhook',
  'smartLights.hueBridgeIp': 'smartLights.hue',
  'smartLights.hueUsername': 'smartLights.hue',
  'smartLights.httpUrl': 'smartLights.http',
  'smartLights.httpHeaders': 'smartLights.http',
  'smartLights.httpBodyTemplate': 'smartLights.http'
};
// Non-secret destinations a credential is bound to.
const CREDENTIAL_DESTINATIONS = [['wifiGuard', 'routerIp'], ['smartLights', 'hueBridgeIp']];
const ENC_PREFIX = 'enc:v1:';
// Ciphertext that cannot currently be decrypted stays recoverable on disk.
// It is never returned as a usable credential to a caller. Keyed by the
// JSON of its path, e.g. '["wifiGuard","routerPass"]'.
const unavailableSecrets = new Map();
let lastSaveErrorCode = null;

function matchesSecretPattern(segments, pattern) {
  return segments.length === pattern.length && pattern.every((part, i) => part === '*' || part === String(segments[i]));
}

function isObjectSecretPath(segments) {
  return OBJECT_SECRET_PATHS.some(pattern => matchesSecretPattern(segments, pattern));
}

function secretGroup(segments) {
  if (segments[0] === 'accountability' && segments[1] === 'partners') return segments.slice(0, 3).join('.');
  return SECRET_GROUPS[segments.join('.')] || segments.slice(0, -1).join('.');
}

function valueAtPath(tree, segments) {
  return segments.reduce((node, segment) => (node && typeof node === 'object' ? node[segment] : undefined), tree);
}

// What a form sends back for a credential it could not show: '', {} or the
// public default ('admin', the stock body template). For a locked credential
// that is never a deliberate edit.
function isUntouchedSecretValue(value, segments) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  const fallback = valueAtPath(DEFAULTS, segments);
  return typeof fallback === 'string' && fallback !== '' && value === fallback;
}

function storageUnavailable() {
  return Object.assign(new Error('Credential encryption is unavailable. Settings were not saved.'), { code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
}

function encryptionAvailable() {
  try {
    return !!(electron.safeStorage && electron.safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function encryptSecret(value, segments = [], restoreLocked = true) {
  const key = JSON.stringify(segments);
  // A credential this PC cannot decrypt is written back unchanged until a
  // real new value or an explicit clear replaces it.
  if (restoreLocked && unavailableSecrets.has(key) && isUntouchedSecretValue(value, segments)) return unavailableSecrets.get(key);
  const isObject = value !== null && typeof value === 'object';
  const str = isObject ? JSON.stringify(value) : value;
  // Public built-in defaults (admin / the standard HTTP body template) are
  // not secrets. Custom values at those paths receive the same protection.
  const defaultValue = segments.reduce((node, segment) => node?.[segment], DEFAULTS);
  if (typeof str !== 'string' || str === '' || str === '{}' || str === '[]' || value === defaultValue) return value;
  if (!encryptionAvailable()) throw storageUnavailable();
  try {
    return ENC_PREFIX + electron.safeStorage.encryptString(str).toString('base64');
  } catch {
    throw storageUnavailable();
  }
}

function decryptSecret(value, segments = []) {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;
  try {
    if (!encryptionAvailable()) throw storageUnavailable();
    const plain = electron.safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
    // Object-valued secrets were serialized before encryption; restore shape.
    // A string secret stays a string whatever its text looks like.
    if (isObjectSecretPath(segments) && (plain.startsWith('{') || plain.startsWith('['))) {
      try { return JSON.parse(plain); } catch { /* fall through */ }
    }
    return plain;
  } catch {
    unavailableSecrets.set(JSON.stringify(segments), value);
    return '';
  }
}

// Returned by a transformSecrets callback to delete that field instead.
const REMOVE_SECRET = Symbol('remove-secret');

// Apply fn to each present secret field in `tree`, mutating it in place.
// Object-valued secrets (e.g. a header map) are serialized to JSON before
// encryption and parsed back on decrypt.
function transformSecrets(tree, fn) {
  if (!tree || typeof tree !== 'object') return tree;
  function visit(node, remaining, segments) {
    if (!node || typeof node !== 'object') return;
    const [part, ...rest] = remaining;
    for (const leaf of part === '*' ? Object.keys(node) : [part]) {
      if (node[leaf] === undefined || node[leaf] === null) continue;
      const resolved = [...segments, leaf];
      if (rest.length) visit(node[leaf], rest, resolved);
      else {
        const next = fn(node[leaf], resolved);
        if (next === REMOVE_SECRET) delete node[leaf];
        else node[leaf] = next;
      }
    }
  }
  for (const segments of SECRET_PATHS) visit(tree, segments, []);
  return tree;
}

// A backup file is plaintext in Downloads, so it never carries credentials
// (or an in-flight timer). Restoring it keeps this PC's existing credentials.
function exportSnapshot() {
  const tree = clone(ensureLoaded());
  delete tree.activeTimer;
  let redactedCredentials = 0;
  transformSecrets(tree, (value, segments) => {
    // Public defaults (routerUser 'admin', the stock body template) and empty
    // values are not credentials: they are left out but not counted.
    if (!isUntouchedSecretValue(value, segments)) redactedCredentials++;
    return REMOVE_SECRET;
  });
  // A lights verification is proof of a live test on this PC (and a key saved
  // by an earlier build embeds the Hue key / webhook URL), so it stays here.
  // The Hue certificate pin is this PC's trust-on-first-use record of its own
  // bridge; it is not a secret, but it is never carried to another PC.
  if (tree.smartLights && typeof tree.smartLights === 'object') {
    delete tree.smartLights.verifiedConfigKey;
    delete tree.smartLights.hueCertFingerprint;
  }
  return { settings: tree, redactedCredentials };
}

// Shape one imported backup section so it cannot carry credentials in or
// replace this PC's own. Every credential field (SECRET_PATHS) is removed,
// whatever the file holds: a v11.2.0 backup carries them in plaintext, and a
// crafted file could point a webhook anywhere. Missing fields keep this PC's
// current values via updateSection's deep merge. The pairing token is
// device-local and never imported. So are the destinations credentials are
// bound to (router IP, Hue bridge IP): this PC's router password or Hue key
// is never re-pointed at another address. Accountability partners are
// defined by their webhook credentials, so with those removed an imported
// partner list (including an empty one) never replaces this PC's partners.
// Delete every SECRET_PATHS field present in an imported section, whatever
// its value: null, a string where an object belongs, an array where a map
// belongs. (transformSecrets skips null leaves and non-object containers, so
// it cannot be used here: a backup holding routerPass: null or calendar.ical:
// null would otherwise be merged over this PC's credential.)
function stripSecretPaths(section, patch) {
  function visit(node, [part, ...more]) {
    for (const key of part === '*' ? Object.keys(node) : [part]) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const child = node[key];
      if (!more.length || !child || typeof child !== 'object' || (Array.isArray(child) && more[0] !== '*')) delete node[key];
      else visit(child, more);
    }
  }
  for (const segments of SECRET_PATHS) if (segments[0] === section) visit(patch, segments.slice(1));
}

function importableSection(section, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const patch = clone(value);
  if (section === 'remoteControl') return importableRemoteControl(patch);
  stripSecretPaths(section, patch);
  for (const destination of CREDENTIAL_DESTINATIONS) {
    if (destination[0] !== section || !Object.prototype.hasOwnProperty.call(patch, destination[1])) continue;
    if (JSON.stringify(patch[destination[1]]) !== JSON.stringify(valueAtPath(ensureLoaded(), destination))) delete patch[destination[1]];
  }
  if (section === 'smartLights') {
    delete patch.verifiedConfigKey;
    // A pin imported from another PC must never replace this PC's pin.
    delete patch.hueCertFingerprint;
    // A backup never opts this PC into light cues: consent stays local.
    delete patch.cues;
    delete patch.imminentBeacon;
  }
  // The armed Autopilot fire time belongs to this PC's schedule; a backup's
  // value would read as a missed fire here.
  if (section === 'app') delete patch.autopilotNextFireAt;
  if (section === 'calendar') return migrateLegacyCalendar(patch);
  if (section === 'accountability') delete patch.partners;
  return patch;
}

// Companion exposure (enabled, mode, LAN address) is local to this device like
// the pairing token: a backup never turns a LAN listener on at the next launch.
// Only a valid port is restored; Companion is switched on again from the UI,
// which shows the LAN warning first.
function importableRemoteControl(patch) {
  const port = patch.port;
  return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535 ? { port } : {};
}

const ALL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Builds before multi-rule scheduling (v11.0.0) stored one built-in schedule
// as builtin { bedtime, days, action } with no rules array. Merging that over
// DEFAULTS would silently replace it with the default every-day 22:30
// shutdown rule, so it becomes one rule (id 'legacy') first, with the same
// mapping as calendarProviders.normalizeScheduleRules. A builtin that has a
// rules array (even an empty one) is returned unchanged. Pure: returns a copy.
function migrateLegacyCalendar(calendar) {
  if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar)) return calendar;
  const builtin = calendar.builtin;
  if (!builtin || typeof builtin !== 'object' || Array.isArray(builtin) || Array.isArray(builtin.rules)) return calendar;
  const has = key => Object.prototype.hasOwnProperty.call(builtin, key) && builtin[key] !== undefined;
  if (!has('bedtime') && !has('days') && !has('action')) return calendar;
  const days = builtin.days || ALL_DAYS;
  return {
    ...calendar,
    builtin: {
      ...builtin,
      rules: [{
        id: 'legacy',
        label: 'Bedtime',
        time: builtin.bedtime || '22:30',
        days: Array.isArray(days) ? [...days] : days,
        action: builtin.action || 'shutdown',
        durationMinutes: 60,
        enabled: true
      }]
    }
  };
}

// Onboarding before 11.3 saved the Last Light choice under the profile field
// names (lastLightEnabled/Sequence/Sound), which nothing reads. Map them onto
// the section's own keys when those are absent, and drop the stray keys.
const LEGACY_LAST_LIGHT_KEYS = { lastLightEnabled: 'enabled', lastLightSequence: 'sequence', lastLightSound: 'sound' };
function migrateLegacyLastLight(section) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
  if (!Object.keys(LEGACY_LAST_LIGHT_KEYS).some(key => key in section)) return section;
  const next = { ...section };
  for (const [legacy, canonical] of Object.entries(LEGACY_LAST_LIGHT_KEYS)) {
    if (!(legacy in next)) continue;
    if (!(canonical in next) && next[legacy] !== undefined && next[legacy] !== null) {
      next[canonical] = canonical === 'enabled' ? next[legacy] === true : String(next[legacy]);
    }
    delete next[legacy];
  }
  return next;
}

function migrateLegacySettings(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  let next = parsed;
  if (parsed.calendar) next = { ...next, calendar: migrateLegacyCalendar(parsed.calendar) };
  if (parsed.lastLight) {
    const lastLight = migrateLegacyLastLight(parsed.lastLight);
    if (lastLight !== parsed.lastLight) next = { ...next, lastLight };
  }
  return next;
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
    forceShutdown: false,
    // Ctrl+Shift+L / Ctrl+Shift+1..4 start a timer from inside any app. Off by
    // default: they collide with common app shortcuts (main.js).
    globalQuickStartShortcuts: false,
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
    autopilotNextFireAt: null, // epoch ms of armed fire time so a missed fire while closed becomes a missed receipt
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
    timerBeacon: false,
    // Opt-in light cues; every one is off until the user turns it on here.
    cues: { bedtime: false, autopilotSoon: false, remote: false },
    imminentBeacon: false,
    mode: 'gradual_dim',
    dimMinutes: 10,
    hueBridgeIp: '',
    hueUsername: '',
    hueLightIds: [],
    hueGroupId: '',
    hueAllowLegacyHttp: false,
    // Kept on load (pruneSmartLightsSection drops keys missing here), so the
    // Hue certificate pin survives a restart instead of re-pinning each launch.
    hueCertFingerprint: '',
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

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return clone(base);
  const out = clone(base);
  for (const key of Object.keys(override)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
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
  unavailableSecrets.clear();
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
      cache = deepMerge(DEFAULTS, migrateLegacySettings(parsed));
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
      cache = deepMerge(DEFAULTS, migrateLegacySettings(parsed));
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

// A smart-lights verification key saved before 11.3 embeds the Hue key or
// the webhook URL and body template in plaintext (smartLights
// legacyConfigurationKey). smartLights.loadConfig rewrites the live key to
// its digest form and main re-saves it with replaceBackup. Until then, a
// rebuilt backup never copies the plaintext form: losing it there only means
// lights must be verified again after a recovery from the backup. Same
// digest forms as smartLights.DIGEST_KEY_FORMS.
const DIGEST_VERIFICATION_KEYS = [
  /^hue:.*:#[0-9a-f]{16}:[^:]*$/,
  /^http:[^:]*:#[0-9a-f]{16}:(none|[0-9a-f]{16}):#[0-9a-f]{16}$/
];

function dropPlaintextVerificationKey(tree) {
  const section = tree && tree.smartLights;
  if (!section || typeof section !== 'object' || typeof section.verifiedConfigKey !== 'string') return;
  const key = section.verifiedConfigKey;
  if (/^(hue|http):/.test(key) && !DIGEST_VERIFICATION_KEYS.some(form => form.test(key))) section.verifiedConfigKey = '';
}

function ensureLoaded() {
  if (!cache) load();
  return cache;
}

// Same write discipline as durableJsonStore (flush the data to disk before
// the rename, retry a rename briefly held by antivirus or the indexer). Kept
// local so settings.js loads with no sibling-module dependency.
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* bounded spin fallback */ }
  }
}

function writeAndFsyncSync(target, text) {
  const fd = fs.openSync(target, 'w');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function renameWithRetrySync(from, to, maxAttempts = 6) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (!error || !RETRYABLE_RENAME_CODES.has(error.code) || attempt >= maxAttempts - 1) throw error;
      sleepSync(15 * (attempt + 1));
    }
  }
}

function writeBackup(file, bakFile, json, options) {
  let backupJson = null;
  if (options.replaceBackup) {
    backupJson = json;
  } else {
    let backupTree = null;
    try { backupTree = tryParseSettingsFile(file); } catch { /* retain valid backup below */ }
    if (!backupTree) {
      try { backupTree = tryParseSettingsFile(bakFile); } catch { /* no recoverable backup */ }
    }
    if (backupTree) {
      pruneSmartLightsSection(backupTree);
      dropPlaintextVerificationKey(backupTree);
      transformSecrets(backupTree, (value, segments) => typeof value === 'string' && value.startsWith(ENC_PREFIX)
        ? value : encryptSecret(value, segments, false));
      backupJson = JSON.stringify(backupTree, null, 2);
    }
  }
  if (backupJson === null) return;
  writeAndFsyncSync(bakFile + '.tmp', backupJson);
  JSON.parse(fs.readFileSync(bakFile + '.tmp', 'utf8'));
  renameWithRetrySync(bakFile + '.tmp', bakFile);
}

// options.replaceBackup: write the backup from the new state instead of the
// previous primary file, so nothing of the previous state survives on disk
// (used after a migration that removes plaintext from it).
function save(options = {}) {
  lastSaveErrorCode = null;
  try {
    const file = getConfigPath();
    const tmpFile = file + '.tmp';
    const bakFile = file + '.bak';

    // Serialize an encrypted copy; keep the in-memory cache as plaintext so the
    // rest of the app keeps reading usable values.
    const toWrite = transformSecrets(clone(ensureLoaded()), encryptSecret);
    const json = JSON.stringify(toWrite, null, 2);

    // 1. Write to temp file and flush it to storage.
    writeAndFsyncSync(tmpFile, json);

    // 2. Verify the temp file is valid JSON.
    const verification = fs.readFileSync(tmpFile, 'utf8');
    JSON.parse(verification);

    // 3. Migrate the previous valid state into an encrypted backup too.
    // Copying the old JSON verbatim would leave newly covered legacy secrets
    // exposed. Locked ciphertext is not injected here: the previous file
    // already holds its own. A backup that cannot be written (.bak held open
    // or read-only, a full disk) never blocks the primary save: the previous
    // .bak stays on disk either way. Only replaceBackup, whose caller needs
    // the previous state gone, reports it as a failed save.
    try {
      writeBackup(file, bakFile, json, options);
    } catch (error) {
      try { fs.unlinkSync(bakFile + '.tmp'); } catch { /* best effort */ }
      if (options.replaceBackup) throw error;
      console.warn('Settings backup not updated:', error.message);
    }

    // 4. Replace primary with verified temp.
    renameWithRetrySync(tmpFile, file);
    return true;
  } catch (error) {
    lastSaveErrorCode = error.code || null;
    console.error('Failed to save settings:', error.message);
    // Clean up failed temp file.
    try { fs.unlinkSync(getConfigPath() + '.tmp'); } catch { /* best effort */ }
    try { fs.unlinkSync(getConfigPath() + '.bak.tmp'); } catch { /* best effort */ }
    return false;
  }
}

function getAll() {
  return clone(ensureLoaded());
}

function getSection(section) {
  return clone(ensureLoaded()[section]);
}

// options.clearSecrets names the locked credentials a caller deliberately
// removes: true for every secret field present in the patch, or a list of
// section-relative paths ('routerPass', 'ical.url', 'partners.*.headers').
function clearPatterns(section, clearSecrets) {
  if (!Array.isArray(clearSecrets)) return [];
  return clearSecrets
    .map(entry => (Array.isArray(entry) ? entry.map(String) : String(entry || '').split('.').filter(Boolean)))
    .filter(rel => rel.length)
    .map(rel => [section, ...rel]);
}

const PARTNER_SECRET_FIELDS = SECRET_PATHS.filter(p => p[0] === 'accountability' && p[1] === 'partners').map(p => p[3]);

function partnerFieldPath(index, field) {
  return ['accountability', 'partners', String(index), field];
}

function samePartner(a, b) {
  return Boolean(a && b && typeof a === 'object' && typeof b === 'object'
    && a.type === b.type && (a.name || '') === (b.name || ''));
}

// Accountability partners are a list the Settings form rebuilds. It cannot
// show a partner whose webhook is locked, so it leaves that partner out, and
// sanitizeAccountability drops any partner without a usable URL. A locked
// partner therefore follows its identity (type + name), not its array index:
// - echoed back with its locked fields untouched, it keeps its ciphertext
//   wherever it now sits;
// - otherwise it is kept after the listed ones (an unrelated Save, an import
//   of a redacted backup, a new credential for a different partner);
// - it goes only when a listed partner with the same identity brings new
//   credentials, on an explicit clear, or when it held the form's primary
//   slot (the first webhook partner, the only one the form edits) and the
//   list's first webhook partner is an identity no current partner has,
//   bringing new credentials (the user typed a new partner over it).
// Returns the patch to merge and whether locked ciphertext was retired.
function reconcileLockedPartners(patch, options, patterns) {
  if (!patch || typeof patch !== 'object' || !Array.isArray(patch.partners)) return { patch, retired: false };
  const locks = new Map();
  for (const [key, value] of unavailableSecrets) {
    const segments = JSON.parse(key);
    if (segments.length !== 4 || segments[0] !== 'accountability' || segments[1] !== 'partners') continue;
    if (!locks.has(segments[2])) locks.set(segments[2], []);
    locks.get(segments[2]).push({ key, field: segments[3], value });
  }
  if (!locks.size) return { patch, retired: false };
  const current = Array.isArray(cache.accountability?.partners) ? cache.accountability.partners : [];
  const partners = patch.partners.map(p => (p && typeof p === 'object' && !Array.isArray(p) ? { ...p } : p));
  // A real value in a credential field that none of `existing` already holds
  // (a readable partner echoed back still holds its own).
  const bringsNewCredential = (partner, index, existing) => Boolean(partner && typeof partner === 'object' && !Array.isArray(partner))
    && PARTNER_SECRET_FIELDS.some(field => !isUntouchedSecretValue(partner[field], partnerFieldPath(index, field))
      && !existing.some(other => other && JSON.stringify(other[field]) === JSON.stringify(partner[field])));
  const isWebhook = p => Boolean(p && typeof p === 'object' && p.type === 'webhook');
  const primarySlot = current.findIndex(isWebhook);
  const firstListed = partners.findIndex(isWebhook);
  const claimed = new Set();
  // Each listed entry replaces at most one lock (two partners can share an
  // identity, e.g. both left at the default name): the lowest lock wins.
  const replacements = new Set();
  const reattached = [];
  const moves = [];
  let retired = false;
  for (const [oldIndex, entries] of [...locks].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const old = current[Number(oldIndex)];
    const isEcho = index => !claimed.has(index) && samePartner(partners[index], old)
      && entries.every(({ field }) => isUntouchedSecretValue(partners[index][field], partnerFieldPath(index, field)));
    const target = isEcho(Number(oldIndex)) ? Number(oldIndex) : partners.findIndex((_, index) => isEcho(index));
    if (target >= 0) {
      claimed.add(target);
      // The echo keeps the field, so the ciphertext has a place to stay.
      for (const { field } of entries) if (partners[target][field] === undefined || partners[target][field] === null) partners[target][field] = '';
      moves.push({ entries, to: target });
      continue;
    }
    const cleared = options.clearSecrets === true
      || entries.some(({ field }) => patterns.some(pattern => matchesSecretPattern(partnerFieldPath(oldIndex, field), pattern)));
    const replacement = partners.findIndex((p, index) => !replacements.has(index) && samePartner(p, old) && bringsNewCredential(p, index, [old]));
    const replacedByIdentity = replacement >= 0;
    const replacedInPrimarySlot = Number(oldIndex) === primarySlot && firstListed >= 0
      && !current.some(existing => samePartner(existing, partners[firstListed]))
      && bringsNewCredential(partners[firstListed], firstListed, current);
    if (!old || cleared || replacedByIdentity || replacedInPrimarySlot) {
      if (replacedByIdentity && !cleared) replacements.add(replacement);
      retired = true;
      continue;
    }
    reattached.push(clone(old));
    moves.push({ entries, to: partners.length + reattached.length - 1 });
  }
  for (const entries of locks.values()) for (const { key } of entries) unavailableSecrets.delete(key);
  for (const { entries, to } of moves) {
    for (const { field, value } of entries) unavailableSecrets.set(JSON.stringify(partnerFieldPath(to, field)), value);
  }
  return { patch: { ...patch, partners: [...partners, ...reattached] }, retired };
}

// Decide which locked ciphertext a patch supersedes, before it is merged.
// Clearing a field the user can see ('' for a credential that decrypted
// fine) still clears it. A locked credential cannot be shown, so a form
// sends '' / {} / the default for it: that keeps the ciphertext. It is
// replaced only by a real new value or an explicit clear (options.clearSecrets),
// and a real change to a credential retires the locked rest of its group.
// Returns the patch to merge (accountability may keep a locked partner the
// form left out) and whether the patch edits any credential.
function applySecretEdits(section, rawPatch, options) {
  const clearAll = options.clearSecrets === true;
  const patterns = clearPatterns(section, options.clearSecrets);
  const retiredGroups = new Set();
  let edited = false;
  let patch = rawPatch;
  if (section === 'accountability') {
    const reconciled = reconcileLockedPartners(rawPatch, options, patterns);
    patch = reconciled.patch;
    edited = reconciled.retired;
  }
  transformSecrets({ [section]: clone(patch) }, (value, segments) => {
    const key = JSON.stringify(segments);
    const locked = unavailableSecrets.has(key);
    const explicit = clearAll || patterns.some(pattern => matchesSecretPattern(segments, pattern));
    const untouched = isUntouchedSecretValue(value, segments);
    if (locked && untouched && !explicit) return value;
    edited = true;
    unavailableSecrets.delete(key);
    if (!untouched && JSON.stringify(value) !== JSON.stringify(valueAtPath(cache, segments))) retiredGroups.add(secretGroup(segments));
    return value;
  });
  if (patch && typeof patch === 'object') {
    for (const destination of CREDENTIAL_DESTINATIONS) {
      if (destination[0] !== section) continue;
      const next = valueAtPath({ [section]: patch }, destination);
      if (next !== undefined && JSON.stringify(next) !== JSON.stringify(valueAtPath(cache, destination))) retiredGroups.add(secretGroup(destination));
    }
  }
  for (const key of [...unavailableSecrets.keys()]) {
    const segments = JSON.parse(key);
    if (segments[0] !== section) continue;
    if (retiredGroups.has(secretGroup(segments)) || patterns.some(pattern => matchesSecretPattern(segments, pattern))) {
      unavailableSecrets.delete(key);
      edited = true;
    }
  }
  return { patch, edited };
}

// Locked ciphertext whose field no longer exists (a shortened partner list)
// is forgotten rather than re-attached to a later entry at the same path.
function dropDetachedLocks(section) {
  for (const key of [...unavailableSecrets.keys()]) {
    const segments = JSON.parse(key);
    if (segments[0] !== section) continue;
    const value = valueAtPath(cache, segments);
    if (value === undefined || value === null) unavailableSecrets.delete(key);
  }
}

function updateSection(section, patch, options = {}) {
  ensureLoaded();
  const previous = clone(cache[section]);
  const previousUnavailable = new Map(unavailableSecrets);
  const { patch: effectivePatch, edited: secretEdited } = applySecretEdits(section, patch, options);
  if (!cache[section] || typeof cache[section] !== 'object' || Array.isArray(cache[section])) {
    cache[section] = clone(effectivePatch);
  } else {
    cache[section] = deepMerge(cache[section], effectivePatch || {});
  }
  dropDetachedLocks(section);
  if (!save(options) && (options.requireSave || secretEdited || lastSaveErrorCode === 'CREDENTIAL_STORAGE_UNAVAILABLE')) {
    cache[section] = previous;
    unavailableSecrets.clear();
    for (const [key, value] of previousUnavailable) unavailableSecrets.set(key, value);
    if (lastSaveErrorCode === 'CREDENTIAL_STORAGE_UNAVAILABLE') throw storageUnavailable();
    throw new Error('Could not save settings. Previous settings are still active.');
  }
  return clone(cache[section]);
}

// profiles.js replaces a profile id an older build accepted ('wind.down',
// 'Wind Down', 7) with a path-safe one derived from it and reports it in
// getIdMigrations(): [{ from, to }]. Point the references settings hold at
// the new id: each calendar rule's profileId (so its routine still
// auto-starts) and the persisted profile selection. Returns how many
// references changed; saves only when something changed.
function remapProfileReferences(migrations) {
  ensureLoaded();
  const map = new Map();
  for (const migration of Array.isArray(migrations) ? migrations : []) {
    if (!migration || migration.from === null || migration.from === undefined || typeof migration.to !== 'string' || !migration.to) continue;
    if (String(migration.from) !== migration.to) map.set(String(migration.from), migration.to);
  }
  if (!map.size) return 0;
  const target = value => ((typeof value === 'string' || typeof value === 'number') && map.has(String(value)) ? map.get(String(value)) : null);
  let changed = 0;
  const rules = cache.calendar && cache.calendar.builtin && cache.calendar.builtin.rules;
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      const next = rule && typeof rule === 'object' ? target(rule.profileId) : null;
      if (next) { rule.profileId = next; changed++; }
    }
  }
  const selected = cache.app ? target(cache.app.lastSelectedProfileId) : null;
  if (selected) { cache.app.lastSelectedProfileId = selected; changed++; }
  if (changed) save();
  return changed;
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
  getActiveTimer,
  exportSnapshot,
  importableSection,
  migrateLegacyCalendar,
  migrateLegacyLastLight,
  remapProfileReferences
};
