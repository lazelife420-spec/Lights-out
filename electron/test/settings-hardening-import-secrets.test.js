'use strict';
// Regression guards for review:settings import / export findings:
// - a v11.2.0 backup (settingsStore.getAll(): credentials decrypted to
//   plaintext) or a crafted file never overwrites, clears or redirects this
//   PC's credentials: importableSection removes every SECRET_PATHS field and
//   never imports the accountability partner list;
// - the destinations credentials are bound to (wifiGuard.routerIp,
//   smartLights.hueBridgeIp) are device-local: an import never re-points this
//   PC's router password or Hue key at another address;
// - exportSnapshot does not count public defaults (routerUser 'admin', the
//   stock body template) as redacted credentials.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const capabilityTruth = require('../capabilityTruth');

const root = path.join(__dirname, '..');

function loadSettings(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-settings-hardening-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = { locked: false };
  const file = path.join(root, 'settings.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  m.require = request => request === 'electron' ? { app: { getPath: () => dir }, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from('fixture:' + text),
    decryptString: bytes => { if (state.locked) throw new Error('fixture: key mismatch'); return bytes.toString().slice(8); }
  } } : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  const primary = path.join(dir, 'settings.json');
  return { settings: m.exports, state, primary, backup: primary + '.bak', read: f => JSON.parse(fs.readFileSync(f, 'utf8')) };
}

// The settings loop of main.js import-all-data (pinned by
// release-hardening-11-3.test.js), applied to a backup's settings tree.
const ALLOWED_SECTIONS = new Set(['window', 'app', 'calendar', 'smartLights', 'customization', 'lastLight',
  'wifiGuard', 'contentBlocker', 'accountability', 'remoteControl', 'ritual']);
function importBackup(s, tree) {
  for (const [section, raw] of Object.entries(tree)) {
    if (section === 'activeTimer' || raw === undefined || !ALLOWED_SECTIONS.has(section)) continue;
    const value = s.importableSection(section, raw);
    if (section === 'wifiGuard') s.updateSection(section, capabilityTruth.sanitizeWifiGuard({ ...s.getSection(section), ...value }));
    else if (section === 'accountability') s.updateSection(section, capabilityTruth.sanitizeAccountability({ ...s.getSection(section), ...value }));
    else s.updateSection(section, value);
  }
}

const THIS_PC = {
  wifiGuard: { enabled: false, provider: 'webhook', routerIp: '192.168.0.1', routerUser: 'owner', routerPass: 'pc-pass',
    webhookUrl: 'https://hooks.example/pc-wifi', webhookHeaders: { Authorization: 'Bearer pc-wifi' } },
  calendar: { ical: { url: 'https://cal.example/pc.ics' }, google: { apiKey: 'pc-google', calendarId: 'pc-cal' },
    outlook: { accessToken: 'pc-outlook' }, calendly: { personalToken: 'pc-calendly' } },
  smartLights: { provider: 'http', hueBridgeIp: '192.168.0.2', hueUsername: 'pc-hue', httpUrl: 'https://lights.example/pc',
    httpHeaders: { Authorization: 'Bearer pc-lights' }, httpBodyTemplate: 'pc {{ON}}' },
  accountability: { enabled: true, partners: [{ type: 'webhook', name: 'Sam', url: 'https://hooks.example/pc-sam', headers: { Authorization: 'Bearer pc-sam' } }] },
  remoteControl: { token: 'pc-token' }
};

// A v11.2.0 export: settingsStore.getAll() with every credential decrypted,
// the pairing token, an in-flight timer and the plaintext lights key.
const V11_2_0_FILE = {
  version: '11.2.0',
  settings: {
    app: { timerName: 'From the file' },
    wifiGuard: { enabled: true, provider: 'webhook', routerIp: '10.9.9.1', routerUser: 'file-user', routerPass: 'file-pass',
      webhookUrl: 'https://attacker.example/wifi', webhookHeaders: { Authorization: 'Bearer file-wifi' }, blockOnDim: false },
    calendar: { syncIntervalMin: 15, ical: { url: 'https://attacker.example/cal.ics' }, google: { apiKey: 'file-google', calendarId: 'file-cal' },
      outlook: { accessToken: 'file-outlook' }, calendly: { personalToken: 'file-calendly' } },
    smartLights: { provider: 'http', dimMinutes: 20, hueBridgeIp: '10.9.9.2', hueUsername: 'file-hue', httpUrl: 'https://attacker.example/lights',
      httpHeaders: { Authorization: 'Bearer file-lights' }, httpBodyTemplate: 'file {{ON}}',
      verifiedConfigKey: 'http:POST:https://attacker.example/lights:d:file {{ON}}' },
    accountability: { enabled: true, notifyOnCancel: false,
      partners: [{ type: 'webhook', name: 'Mallory', url: 'https://attacker.example/partner', headers: { Authorization: 'Bearer file-partner' } }] },
    remoteControl: { enabled: true, mode: 'wifi', token: 'file-token', port: 50001 },
    activeTimer: { endsAt: '2026-11-25T23:00:00.000Z', action: 'shutdown' }
  }
};
const FILE_VALUES = /file-|attacker\.example|10\.9\.9\./;

function assertThisPcCredentials(s, label) {
  const wifi = s.getSection('wifiGuard');
  for (const key of ['routerIp', 'routerUser', 'routerPass', 'webhookUrl']) assert.equal(wifi[key], THIS_PC.wifiGuard[key], `${label}: wifiGuard.${key}`);
  assert.deepEqual(wifi.webhookHeaders, THIS_PC.wifiGuard.webhookHeaders, `${label}: wifiGuard.webhookHeaders`);
  const calendar = s.getSection('calendar');
  assert.equal(calendar.ical.url, THIS_PC.calendar.ical.url, `${label}: calendar.ical.url`);
  assert.equal(calendar.google.apiKey, 'pc-google', `${label}: calendar.google.apiKey`);
  assert.equal(calendar.outlook.accessToken, 'pc-outlook', `${label}: calendar.outlook.accessToken`);
  assert.equal(calendar.calendly.personalToken, 'pc-calendly', `${label}: calendar.calendly.personalToken`);
  const lights = s.getSection('smartLights');
  for (const key of ['hueBridgeIp', 'hueUsername', 'httpUrl', 'httpBodyTemplate']) assert.equal(lights[key], THIS_PC.smartLights[key], `${label}: smartLights.${key}`);
  assert.deepEqual(lights.httpHeaders, THIS_PC.smartLights.httpHeaders, `${label}: smartLights.httpHeaders`);
  assert.deepEqual(s.getSection('accountability').partners, THIS_PC.accountability.partners, `${label}: accountability partners`);
  assert.equal(s.getSection('remoteControl').token, 'pc-token', `${label}: pairing token`);
}

function configureThisPc(s) {
  for (const [section, value] of Object.entries(THIS_PC)) s.updateSection(section, value);
}

test('importing a v11.2.0 plaintext backup keeps every credential of this PC, in memory and on disk', t => {
  const f = loadSettings(t);
  const s = f.settings;
  configureThisPc(s);
  importBackup(s, JSON.parse(JSON.stringify(V11_2_0_FILE.settings)));

  assertThisPcCredentials(s, 'in memory');
  // The non-credential preferences of the backup are still restored.
  assert.equal(s.getSection('app').timerName, 'From the file');
  assert.equal(s.getSection('wifiGuard').blockOnDim, false);
  assert.equal(s.getSection('calendar').syncIntervalMin, 15);
  assert.equal(s.getSection('calendar').google.calendarId, 'file-cal', 'a calendar id is not a credential');
  assert.equal(s.getSection('smartLights').dimMinutes, 20);
  assert.equal(s.getSection('accountability').notifyOnCancel, false);
  assert.equal(s.getSection('remoteControl').port, 50001);
  assert.equal(s.getActiveTimer(), null);

  s.updateSection('app', { timerName: 'From the file' });
  for (const file of [f.primary, f.backup]) {
    const text = fs.readFileSync(file, 'utf8').replace('file-cal', '');
    assert.doesNotMatch(text, FILE_VALUES, `${path.basename(file)} holds no credential or destination from the file`);
  }
  s.load();
  assertThisPcCredentials(s, 'after reload');
});

test('a v11.2.0 plaintext backup never replaces credentials this PC holds locked', t => {
  const f = loadSettings(t);
  configureThisPc(f.settings);
  const sealed = f.read(f.primary);
  f.state.locked = true;
  f.settings.load();
  importBackup(f.settings, JSON.parse(JSON.stringify(V11_2_0_FILE.settings)));
  const disk = f.read(f.primary);
  for (const [section, key] of [['wifiGuard', 'routerUser'], ['wifiGuard', 'routerPass'], ['wifiGuard', 'webhookUrl'], ['wifiGuard', 'webhookHeaders'],
    ['smartLights', 'hueUsername'], ['smartLights', 'httpUrl'], ['smartLights', 'httpHeaders'], ['smartLights', 'httpBodyTemplate'], ['remoteControl', 'token']]) {
    assert.equal(disk[section][key], sealed[section][key], `${section}.${key} ciphertext is kept`);
  }
  assert.equal(disk.calendar.ical.url, sealed.calendar.ical.url);
  assert.equal(disk.accountability.partners[0].url, sealed.accountability.partners[0].url);
  f.state.locked = false;
  f.settings.load();
  assertThisPcCredentials(f.settings, 'back under the original key');
});

test('importableSection removes every credential field a crafted section carries', t => {
  const { settings } = loadSettings(t);
  const wifi = settings.importableSection('wifiGuard', V11_2_0_FILE.settings.wifiGuard);
  for (const key of ['routerUser', 'routerPass', 'webhookUrl', 'webhookHeaders']) assert.equal(key in wifi, false, `wifiGuard.${key}`);
  const calendar = settings.importableSection('calendar', V11_2_0_FILE.settings.calendar);
  assert.deepEqual([calendar.ical, calendar.google, calendar.outlook, calendar.calendly], [{}, { calendarId: 'file-cal' }, {}, {}]);
  const lights = settings.importableSection('smartLights', V11_2_0_FILE.settings.smartLights);
  for (const key of ['hueUsername', 'httpUrl', 'httpHeaders', 'httpBodyTemplate', 'verifiedConfigKey']) assert.equal(key in lights, false, `smartLights.${key}`);
  assert.equal(lights.dimMinutes, 20);
  const discord = settings.importableSection('accountability', { partners: [{ type: 'discord', name: 'D', webhookId: 'file-id', webhookToken: 'file-token' }] });
  assert.equal('partners' in discord, false, 'no partner list is imported');
  assert.equal(V11_2_0_FILE.settings.wifiGuard.routerPass, 'file-pass', 'the input is not mutated');
});

test('an imported empty partner list does not remove this PC’s partners', t => {
  const f = loadSettings(t);
  const s = f.settings;
  configureThisPc(s);
  importBackup(s, { accountability: { enabled: true, partners: [] } });
  assert.deepEqual(s.getSection('accountability').partners, THIS_PC.accountability.partners);
  assert.equal(s.getSection('accountability').enabled, true);
});

test('a router or Hue bridge address from a backup never re-points this PC’s credentials', t => {
  const f = loadSettings(t);
  const s = f.settings;
  s.updateSection('wifiGuard', capabilityTruth.sanitizeWifiGuard({ provider: 'tplink', routerIp: '192.168.0.1', routerUser: 'owner', routerPass: 'pc-pass', deviceIps: ['192.168.0.50'] }));
  s.updateSection('smartLights', { provider: 'hue', hueBridgeIp: '192.168.0.2', hueUsername: 'pc-hue' });
  // A redacted (11.3) backup: no credentials, but the other PC's destinations.
  importBackup(s, { wifiGuard: { provider: 'tplink', routerIp: '10.9.9.1', blockOnDim: false }, smartLights: { provider: 'hue', hueBridgeIp: '10.9.9.2', mode: 'warm_dim' } });
  const wifi = s.getSection('wifiGuard');
  assert.equal(wifi.routerIp, '192.168.0.1');
  assert.equal(wifi.routerPass, 'pc-pass');
  assert.equal(wifi.blockOnDim, false, 'the rest of the section is imported');
  const lights = s.getSection('smartLights');
  assert.equal(lights.hueBridgeIp, '192.168.0.2');
  assert.equal(lights.hueUsername, 'pc-hue');
  assert.equal(lights.mode, 'warm_dim');
  s.load();
  assert.equal(s.getSection('wifiGuard').routerIp, '192.168.0.1', 'on disk too');
  assert.equal(s.getSection('smartLights').hueBridgeIp, '192.168.0.2', 'on disk too');
  // The same address as this PC's is harmless and passes through.
  assert.equal(s.importableSection('wifiGuard', { routerIp: '192.168.0.1' }).routerIp, '192.168.0.1');
  assert.equal('hueBridgeIp' in s.importableSection('smartLights', { hueBridgeIp: '' }), false);
});

test('a backup address never retires router or Hue credentials this PC holds locked', t => {
  const f = loadSettings(t);
  f.settings.updateSection('wifiGuard', { provider: 'tplink', routerIp: '192.168.0.1', routerUser: 'owner', routerPass: 'pc-pass' });
  f.settings.updateSection('smartLights', { provider: 'hue', hueBridgeIp: '192.168.0.2', hueUsername: 'pc-hue' });
  f.state.locked = true;
  f.settings.load();
  importBackup(f.settings, { wifiGuard: { routerIp: '10.9.9.1' }, smartLights: { hueBridgeIp: '10.9.9.2' } });
  f.state.locked = false;
  f.settings.load();
  assert.equal(f.settings.getSection('wifiGuard').routerPass, 'pc-pass');
  assert.equal(f.settings.getSection('wifiGuard').routerUser, 'owner');
  assert.equal(f.settings.getSection('smartLights').hueUsername, 'pc-hue');
});

test('export does not count public defaults as redacted credentials', t => {
  const { settings } = loadSettings(t);
  assert.equal(settings.exportSnapshot().redactedCredentials, 0, 'a fresh install has nothing to redact (admin, stock template)');
  settings.updateSection('wifiGuard', { routerUser: 'owner' });
  settings.updateSection('smartLights', { httpBodyTemplate: 'custom {{ON}}' });
  const { settings: exported, redactedCredentials } = settings.exportSnapshot();
  assert.equal(redactedCredentials, 2, 'custom values at those paths are counted');
  assert.equal('routerUser' in exported.wifiGuard, false);
  assert.equal('httpBodyTemplate' in exported.smartLights, false);
});
