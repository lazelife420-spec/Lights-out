// Regression test for DEF-006: settings persistence must survive corruption.
//
// Adjudication proof (2026-09-14, HEAD 268e6b0) demonstrated that bare
// writeFileSync produces zero-length or truncated files on power loss, causing
// complete settings loss with silent fallback to DEFAULTS. The fix implements
// write-tmp-verify-rename with .bak recovery.
//
// PRE-FIX: zero-length or truncated settings.json → silent DEFAULTS fallback,
//          all user configuration lost, no recovery path.
// POST-FIX: .bak file preserves previous valid state; load distinguishes
//           PRIMARY_VALID, PRIMARY_CORRUPT_BACKUP_VALID, PRIMARY_AND_BACKUP_CORRUPT,
//           and FIRST_RUN.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// Create isolated tmp dir and mock electron before requiring settings.
let tmpDir;
let settingsModule;
const origLoad = Module._load;
const settingsPath = path.resolve(path.join(__dirname, '..', 'settings.js'));

function installMock() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => tmpDir },
        safeStorage: { isEncryptionAvailable: () => false }
      };
    }
    return origLoad.apply(this, arguments);
  };
}

function freshSetup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-def006-'));
  delete require.cache[settingsPath];
  installMock();
  settingsModule = require(settingsPath);
}

function reloadSettings() {
  delete require.cache[settingsPath];
  installMock();
  settingsModule = require(settingsPath);
}

function teardown() {
  Module._load = origLoad;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

const settingsFile = () => path.join(tmpDir, 'settings.json');
const bakFile = () => path.join(tmpDir, 'settings.json.bak');
const tmpFile = () => path.join(tmpDir, 'settings.json.tmp');

// --- ORDINARY SAVE/LOAD ---

test('checked calendar save rolls back live state and reports a failed durable write', () => {
  freshSetup();
  const rename = fs.renameSync;
  try {
    settingsModule.updateSection('calendar', { builtin: { rules: [{ id: 'saved' }] } });
    const before = settingsModule.getSection('calendar');
    fs.renameSync = function(from, to) {
      if (to === settingsFile()) throw new Error('isolated simulated disk failure');
      return rename.apply(this, arguments);
    };
    assert.throws(() => settingsModule.updateSection('calendar', { builtin: { rules: [{ id: 'unsaved' }] } }, { requireSave: true }), /Could not save/);
    assert.deepEqual(settingsModule.getSection('calendar'), before);
    fs.renameSync = rename; reloadSettings();
    assert.deepEqual(settingsModule.getSection('calendar'), before);
  } finally { fs.renameSync = rename; teardown(); }
});

test('ordinary save creates settings.json and backup', () => {
  freshSetup();
  try {
    const all = settingsModule.getAll();
    assert.strictEqual(all.app.action, 'shutdown');
    settingsModule.updateSection('customization', { accent: '#ff0000' });
    assert.ok(fs.existsSync(settingsFile()), 'settings.json exists');
    // Second save should create a backup.
    settingsModule.updateSection('customization', { accent: '#00ff00' });
    assert.ok(fs.existsSync(bakFile()), 'settings.json.bak exists after second save');
    // Primary should have latest value.
    const primary = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    assert.strictEqual(primary.customization.accent, '#00ff00');
    // Backup should have previous value.
    const backup = JSON.parse(fs.readFileSync(bakFile(), 'utf8'));
    assert.strictEqual(backup.customization.accent, '#ff0000');
  } finally { teardown(); }
});

test('save does not leave .tmp file on success', () => {
  freshSetup();
  try {
    settingsModule.updateSection('app', { action: 'sleep' });
    assert.ok(!fs.existsSync(tmpFile()), 'no .tmp file after successful save');
  } finally { teardown(); }
});

// --- ZERO-BYTE PRIMARY ---

test('zero-byte primary recovers from backup', () => {
  freshSetup();
  try {
    settingsModule.updateSection('customization', { accent: '#abcdef' });
    settingsModule.updateSection('customization', { accent: '#123456' });
    // Corrupt primary.
    fs.writeFileSync(settingsFile(), '', 'utf8');
    // Reload.
    reloadSettings();
    const all = settingsModule.getAll();
    assert.strictEqual(all.customization.accent, '#abcdef', 'recovered previous accent from backup');
  } finally { teardown(); }
});

// --- TRUNCATED JSON ---

test('truncated JSON primary recovers from backup', () => {
  freshSetup();
  try {
    settingsModule.updateSection('app', { bedtime: '23:00' });
    settingsModule.updateSection('app', { bedtime: '23:30' });
    // Truncate primary.
    const content = fs.readFileSync(settingsFile(), 'utf8');
    fs.writeFileSync(settingsFile(), content.slice(0, 20), 'utf8');
    // Reload.
    reloadSettings();
    const all = settingsModule.getAll();
    assert.strictEqual(all.app.bedtime, '23:00', 'recovered previous bedtime from backup');
  } finally { teardown(); }
});

// --- INVALID JSON ---

test('invalid JSON primary recovers from backup', () => {
  freshSetup();
  try {
    settingsModule.updateSection('customization', { theme: 'aurora' });
    settingsModule.updateSection('customization', { theme: 'midnight' });
    // Corrupt primary with invalid JSON.
    fs.writeFileSync(settingsFile(), '{this is not json}', 'utf8');
    reloadSettings();
    const all = settingsModule.getAll();
    assert.strictEqual(all.customization.theme, 'aurora', 'recovered theme from backup');
  } finally { teardown(); }
});

// --- CORRUPT BACKUP ---

test('corrupt backup with valid primary loads primary', () => {
  freshSetup();
  try {
    settingsModule.updateSection('customization', { accent: '#111111' });
    settingsModule.updateSection('customization', { accent: '#222222' });
    // Corrupt backup only.
    fs.writeFileSync(bakFile(), '{broken', 'utf8');
    reloadSettings();
    const all = settingsModule.getAll();
    assert.strictEqual(all.customization.accent, '#222222', 'primary is fine, backup ignored');
  } finally { teardown(); }
});

// --- BOTH CORRUPT ---

test('both primary and backup corrupt falls back to DEFAULTS', () => {
  freshSetup();
  try {
    settingsModule.updateSection('customization', { accent: '#aaa' });
    settingsModule.updateSection('customization', { accent: '#bbb' });
    fs.writeFileSync(settingsFile(), '', 'utf8');
    fs.writeFileSync(bakFile(), '{broken', 'utf8');
    reloadSettings();
    const all = settingsModule.getAll();
    assert.strictEqual(all.customization.accent, '#9b93d6', 'fell back to default accent');
  } finally { teardown(); }
});

// --- FIRST RUN (no files) ---

test('first run with no files returns DEFAULTS', () => {
  freshSetup();
  try {
    const all = settingsModule.getAll();
    assert.strictEqual(all.app.action, 'shutdown');
    assert.strictEqual(all.customization.accent, '#9b93d6');
    assert.ok(!fs.existsSync(bakFile()), 'no backup on first run');
  } finally { teardown(); }
});

// --- STALE .TMP CLEANUP ---

test('stale .tmp file from interrupted save is cleaned on load', () => {
  freshSetup();
  try {
    fs.writeFileSync(tmpFile(), '{"stale":"data"}', 'utf8');
    reloadSettings();
    settingsModule.getAll(); // triggers load() which cleans stale .tmp
    assert.ok(!fs.existsSync(tmpFile()), 'stale .tmp removed');
  } finally { teardown(); }
});

// --- ENCRYPTION PRESERVATION ---

test('secret encryption round-trip preserved through save/load', () => {
  freshSetup();
  try {
    settingsModule.updateSection('wifiGuard', { routerPass: 'mysecret' });
    // In-memory cache should have plaintext.
    const section = settingsModule.getSection('wifiGuard');
    assert.strictEqual(section.routerPass, 'mysecret');
    // On disk, since safeStorage.isEncryptionAvailable returns false in test,
    // the value should be stored as plaintext fallback.
    const disk = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    assert.strictEqual(disk.wifiGuard.routerPass, 'mysecret', 'plaintext fallback when encryption unavailable');
    // Reload and verify.
    reloadSettings();
    const reloaded = settingsModule.getSection('wifiGuard');
    assert.strictEqual(reloaded.routerPass, 'mysecret', 'survives reload');
  } finally { teardown(); }
});

// --- BACKUP RECOVERY RESTORES PRIMARY ---

test('backup recovery writes recovered data back to primary', () => {
  freshSetup();
  try {
    settingsModule.updateSection('app', { action: 'hibernate' });
    settingsModule.updateSection('app', { action: 'sleep' });
    // Corrupt primary, backup should have 'hibernate'.
    fs.writeFileSync(settingsFile(), '', 'utf8');
    reloadSettings();
    const all = settingsModule.getAll(); // triggers load → backup recovery → save
    assert.strictEqual(all.app.action, 'hibernate', 'recovered action from backup');
    // Recovery should have written recovered data back to primary.
    assert.ok(fs.existsSync(settingsFile()), 'primary recreated from backup');
    const repaired = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    assert.strictEqual(repaired.app.action, 'hibernate', 'primary has recovered data');
  } finally { teardown(); }
});

// --- CLOCK HAND COLOUR (UI-R3 P04) ---
// The old light-blue default (#76c9ff) is mapped to violet at RENDER time
// (renderer-settings.js effectiveClockHandColor; see accent-grammar.test.js).
// Owner decision: saved settings are never rewritten, so load() must hand
// back exactly what was stored, on the primary and on the backup path.

test('clock hand: new installs default to violet, not the old blue', () => {
  freshSetup();
  try {
    assert.strictEqual(settingsModule.DEFAULTS.app.clockHandColor, '#9b93d6');
    assert.strictEqual(settingsModule.getSection('app').clockHandColor, '#9b93d6');
  } finally { teardown(); }
});

test('clock hand: a saved legacy #76c9ff is preserved on load (no data rewrite)', () => {
  freshSetup();
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ app: { clockHandColor: '#76c9ff' } }), 'utf8');
    reloadSettings();
    const app = settingsModule.getSection('app');
    assert.strictEqual(app.clockHandColor, '#76c9ff');
    assert.ok(!('clockHandColorMigratedV1' in app), 'no migration flag is invented');
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).app.clockHandColor, '#76c9ff', 'file untouched');
  } finally { teardown(); }
});

test('clock hand: a custom colour is untouched on load', () => {
  freshSetup();
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ app: { clockHandColor: '#ff8800' } }), 'utf8');
    reloadSettings();
    assert.strictEqual(settingsModule.getSection('app').clockHandColor, '#ff8800');
  } finally { teardown(); }
});

test('clock hand: the backup recovery path preserves a saved legacy colour too', () => {
  freshSetup();
  try {
    fs.writeFileSync(bakFile(), JSON.stringify({ app: { clockHandColor: '#76c9ff' } }), 'utf8');
    fs.writeFileSync(settingsFile(), '', 'utf8');
    reloadSettings();
    assert.strictEqual(settingsModule.getSection('app').clockHandColor, '#76c9ff');
  } finally { teardown(); }
});
