'use strict';
// Regression guards for credential storage in settings.js:
// - credentials-0: only header maps are JSON-parsed on decrypt; every other
//   secret (a JSON body template, a JSON-looking password) stays a string.
// - credentials-2: ciphertext this PC cannot decrypt survives the shapes the
//   real Save / smart-lights save / import paths send ('' / {} / the default),
//   and is replaced only by a real new value or an explicit clear.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');

// settings.js with a fake safeStorage. state.locked makes decryption fail while
// encryption still works (a profile moved to another Windows account / PC).
function loadSettings(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-settings-hardening-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = { available: true, locked: false };
  const file = path.join(root, 'settings.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  m.require = request => request === 'electron' ? { app: { getPath: () => dir }, safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: text => Buffer.from('fixture:' + text),
    decryptString: bytes => { if (state.locked) throw new Error('fixture: key mismatch'); return bytes.toString().slice(8); }
  } } : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  const primary = path.join(dir, 'settings.json');
  return { settings: m.exports, state, primary, backup: primary + '.bak', read: f => JSON.parse(fs.readFileSync(f, 'utf8')) };
}

test('JSON-looking string secrets come back as strings; header maps come back as objects', t => {
  const f = loadSettings(t);
  const s = f.settings;
  const template = '{"entity_id":"light.bedroom","brightness":"{{BRIGHTNESS}}"}';
  s.updateSection('smartLights', { provider: 'http', httpUrl: 'https://lights.example/hook', httpBodyTemplate: template, httpHeaders: { Authorization: 'Bearer lights' } });
  s.updateSection('wifiGuard', { routerPass: '[2468]', webhookHeaders: { 'X-Key': 'wifi' } });
  s.updateSection('accountability', { partners: [
    { type: 'webhook', name: 'Sam', url: 'https://hooks.example/sam', headers: { Authorization: 'Bearer partner' } },
    { type: 'discord', name: 'Kit', webhookId: '[1,2]', webhookToken: '{"looks":"like json"}' }
  ] });
  const disk = f.read(f.primary);
  assert.ok(disk.smartLights.httpBodyTemplate.startsWith('enc:v1:'), 'a custom template is stored encrypted');
  assert.ok(disk.wifiGuard.routerPass.startsWith('enc:v1:'));

  s.load();
  assert.equal(s.getSection('smartLights').httpBodyTemplate, template, 'a valid-JSON body template stays the exact string');
  assert.equal(s.getSection('wifiGuard').routerPass, '[2468]', 'a JSON-looking password stays a string');
  const partners = s.getSection('accountability').partners;
  assert.equal(partners[1].webhookToken, '{"looks":"like json"}', 'a wildcard string path stays a string');
  assert.equal(partners[1].webhookId, '[1,2]');
  assert.deepEqual(s.getSection('wifiGuard').webhookHeaders, { 'X-Key': 'wifi' }, 'WiFi Guard headers are an object');
  assert.deepEqual(s.getSection('smartLights').httpHeaders, { Authorization: 'Bearer lights' }, 'smart-light headers are an object');
  assert.deepEqual(partners[0].headers, { Authorization: 'Bearer partner' }, 'partner headers are an object');
});

test('a verified webhook with a JSON body template stays verified after a restart', t => {
  const f = loadSettings(t);
  const smartLights = require('../smartLights');
  t.after(() => smartLights.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '', httpUrl: '', httpHeaders: {}, httpBodyTemplate: f.settings.DEFAULTS.smartLights.httpBodyTemplate }));
  const config = { provider: 'http', enabled: true, httpMethod: 'POST', httpUrl: 'http://10.0.0.5/hook', httpHeaders: {}, httpBodyTemplate: '{"scene":"night"}' };
  f.settings.updateSection('smartLights', { ...config, verifiedConfigKey: smartLights.configurationKey(config) });
  f.settings.load();
  smartLights.loadConfig(f.settings.getSection('smartLights'));
  assert.equal(smartLights.getConfig().httpBodyTemplate, '{"scene":"night"}');
  assert.equal(smartLights.getConfig().enabled, true, 'the same setup is still verified');
});

test('the full Settings / smart-lights / import save shapes keep locked ciphertext in primary and backup', t => {
  const f = loadSettings(t);
  const s = f.settings;
  const DEFAULT_TEMPLATE = s.DEFAULTS.smartLights.httpBodyTemplate;
  s.updateSection('wifiGuard', { provider: 'webhook', enabled: true, routerIp: '192.168.0.1', routerUser: 'owner', routerPass: 'pass-A', webhookUrl: 'https://hooks.example/A', webhookHeaders: { Authorization: 'Bearer A' } });
  s.updateSection('smartLights', { provider: 'http', hueBridgeIp: '192.168.0.2', hueUsername: 'hue-A', httpUrl: 'https://lights.example/A', httpHeaders: { Authorization: 'Bearer L' }, httpBodyTemplate: 'custom {{ON}}' });
  s.updateSection('calendar', { ical: { url: 'https://cal.example/A' }, google: { apiKey: 'google-A', calendarId: 'c' } });
  s.updateSection('remoteControl', { token: 'token-A' });
  const sealed = f.read(f.primary);

  f.state.locked = true;
  s.load();
  const wifi = s.getSection('wifiGuard');
  assert.equal(wifi.routerPass, '');
  assert.equal(wifi.webhookHeaders, '', 'a locked header map loads as an empty value');

  // renderer-settings collectWifiGuardSettings(): '' secrets, 'admin' for a
  // blank user, {} for headers it could not load; capabilityTruth then
  // switches WiFi Guard off because the URL is not valid.
  s.updateSection('wifiGuard', { ...wifi, enabled: false, routerUser: wifi.routerUser || 'admin', routerPass: '', webhookUrl: '', webhookHeaders: {} });
  // save-smartlight-config writes smartLights.getConfig(): '' for the Hue key
  // and URL, '' for headers, the stock template the form falls back to.
  s.updateSection('smartLights', { ...s.getSection('smartLights'), hueUsername: '', httpUrl: '', httpHeaders: '', httpBodyTemplate: DEFAULT_TEMPLATE });
  // import-all-data / set-calendar-auto-start echo the whole current section.
  s.updateSection('calendar', { ...s.getSection('calendar'), ...s.importableSection('calendar', { syncIntervalMin: 15 }) });
  s.updateSection('remoteControl', { ...s.getSection('remoteControl'), ...s.importableSection('remoteControl', { mode: 'wifi' }) });
  s.updateSection('app', { timerName: 'rotates the backup' });
  s.updateSection('app', { timerName: 'rotates it again' });

  for (const file of [f.primary, f.backup]) {
    const tree = f.read(file);
    for (const [section, key] of [['wifiGuard', 'routerUser'], ['wifiGuard', 'routerPass'], ['wifiGuard', 'webhookUrl'], ['wifiGuard', 'webhookHeaders'],
      ['smartLights', 'hueUsername'], ['smartLights', 'httpUrl'], ['smartLights', 'httpHeaders'], ['smartLights', 'httpBodyTemplate'], ['remoteControl', 'token']]) {
      assert.equal(tree[section][key], sealed[section][key], `${path.basename(file)} keeps ${section}.${key}`);
    }
    assert.equal(tree.calendar.ical.url, sealed.calendar.ical.url, `${path.basename(file)} keeps calendar.ical.url`);
    assert.equal(tree.calendar.google.apiKey, sealed.calendar.google.apiKey, `${path.basename(file)} keeps calendar.google.apiKey`);
  }

  // Back under the original key, every credential is still there.
  f.state.locked = false;
  s.load();
  assert.equal(s.getSection('wifiGuard').routerUser, 'owner');
  assert.equal(s.getSection('wifiGuard').routerPass, 'pass-A');
  assert.equal(s.getSection('wifiGuard').webhookUrl, 'https://hooks.example/A');
  assert.deepEqual(s.getSection('wifiGuard').webhookHeaders, { Authorization: 'Bearer A' });
  assert.equal(s.getSection('smartLights').hueUsername, 'hue-A');
  assert.equal(s.getSection('smartLights').httpBodyTemplate, 'custom {{ON}}');
  assert.equal(s.getSection('calendar').ical.url, 'https://cal.example/A');
  assert.equal(s.getSection('remoteControl').token, 'token-A');
});

test('a real new value replaces a locked credential and retires the locked rest of its group only', t => {
  const f = loadSettings(t);
  const s = f.settings;
  s.updateSection('wifiGuard', { routerUser: 'owner', routerPass: 'pass-A', webhookUrl: 'https://hooks.example/A', webhookHeaders: { Authorization: 'Bearer A' } });
  f.state.locked = true;
  s.load();
  // A new webhook URL typed while the old headers could not be shown.
  s.updateSection('wifiGuard', { routerUser: 'admin', routerPass: '', webhookUrl: 'https://hooks.example/B', webhookHeaders: {} });
  f.state.locked = false;
  s.load();
  const wifi = s.getSection('wifiGuard');
  assert.equal(wifi.webhookUrl, 'https://hooks.example/B');
  assert.deepEqual(wifi.webhookHeaders, {}, 'the old Authorization header is never re-attached to the new URL');
  assert.equal(wifi.routerUser, 'owner', 'router credentials are a separate group and are kept');
  assert.equal(wifi.routerPass, 'pass-A');
});

test('a new router address retires the locked router credentials bound to the old one', t => {
  const f = loadSettings(t);
  const s = f.settings;
  s.updateSection('wifiGuard', { routerIp: '192.168.0.1', routerUser: 'owner', routerPass: 'pass-A' });
  f.state.locked = true;
  s.load();
  s.updateSection('wifiGuard', { routerIp: '192.168.0.254', routerUser: 'admin', routerPass: '' });
  f.state.locked = false;
  s.load();
  assert.equal(s.getSection('wifiGuard').routerPass, '', 'the old password is not sent to a different router');
  assert.equal(s.getSection('wifiGuard').routerUser, 'admin');
});

test('a visible credential cleared in the form is still cleared, and a locked one clears only explicitly', t => {
  const f = loadSettings(t);
  const s = f.settings;
  s.updateSection('wifiGuard', { webhookUrl: 'https://hooks.example/visible' });
  s.updateSection('wifiGuard', { webhookUrl: '' });
  assert.equal(f.read(f.primary).wifiGuard.webhookUrl, '', 'the existing Settings clear path ("" for a readable value) still clears');

  s.updateSection('smartLights', { hueUsername: 'hue-A', httpHeaders: { Authorization: 'Bearer L' } });
  const sealed = f.read(f.primary).smartLights;
  f.state.locked = true;
  s.load();
  s.updateSection('smartLights', { hueUsername: '', httpHeaders: {} });
  assert.equal(f.read(f.primary).smartLights.hueUsername, sealed.hueUsername);
  s.updateSection('smartLights', { hueUsername: '' }, { clearSecrets: ['hueUsername'] });
  assert.equal(f.read(f.primary).smartLights.hueUsername, '', 'a listed path is cleared');
  assert.equal(f.read(f.primary).smartLights.httpHeaders, sealed.httpHeaders, 'an unlisted locked path is kept');
  s.updateSection('smartLights', { httpHeaders: {} }, { clearSecrets: true });
  assert.deepEqual(f.read(f.primary).smartLights.httpHeaders, {}, 'clearSecrets: true clears every secret present in the patch');
});

test('a partner slot that now holds a different partner does not inherit its locked credentials', t => {
  const f = loadSettings(t);
  const s = f.settings;
  s.updateSection('accountability', { partners: [{ type: 'webhook', name: 'Sam', url: 'https://hooks.example/sam', headers: { Authorization: 'Bearer sam' } }] });
  f.state.locked = true;
  s.load();
  // The same partner echoed back unchanged keeps its ciphertext.
  s.updateSection('accountability', { partners: s.getSection('accountability').partners });
  assert.ok(f.read(f.primary).accountability.partners[0].url.startsWith('enc:v1:'));
  // A different partner in the same slot, without a URL of its own.
  s.updateSection('accountability', { partners: [{ type: 'webhook', name: 'Pat', url: '', headers: {} }] });
  f.state.locked = false;
  s.load();
  const [partner, kept] = s.getSection('accountability').partners;
  assert.equal(partner.name, 'Pat');
  assert.equal(partner.url, '', 'Sam’s webhook is not attached to Pat');
  assert.deepEqual(partner.headers, {}, 'Sam’s headers are not attached to Pat');
  // Pat brought no credential of its own, so Sam was not replaced either.
  assert.equal(kept.name, 'Sam');
  assert.equal(kept.url, 'https://hooks.example/sam');
  assert.deepEqual(kept.headers, { Authorization: 'Bearer sam' });
});

// What save-app-settings / import-all-data send for accountability while a
// partner's webhook is locked: renderer-settings collectAccountabilitySettings()
// leaves out a primary partner whose URL field is blank, and main runs
// capabilityTruth.sanitizeAccountability, which drops any partner without a
// usable URL, so the list arrives without the locked partner.
const capabilityTruth = require('../capabilityTruth');
const SAM = { type: 'webhook', name: 'Sam', url: 'https://hooks.example/sam', headers: { Authorization: 'Bearer sam' } };
const KIT = { type: 'webhook', name: 'Kit', url: 'https://hooks.example/kit', headers: { 'X-Kit': 'kit' } };

function lockedAccountability(t, partners = [SAM]) {
  const f = loadSettings(t);
  f.settings.updateSection('accountability', { enabled: true, partners });
  f.sealed = f.read(f.primary).accountability.partners;
  f.state.locked = true;
  f.settings.load();
  return f;
}

function settingsSave(s, form) {
  s.updateSection('accountability', capabilityTruth.sanitizeAccountability(form));
}

test('an ordinary Settings Save and a redacted-backup import keep a locked partner (primary and backup)', t => {
  const f = lockedAccountability(t);
  const s = f.settings;
  // Save button: the form could not show Sam's URL, so Sam is not in the list.
  settingsSave(s, { enabled: true, notifyOnStart: false, partners: [] });
  // Import of a backup (partners redacted by exportSnapshot) merges the current section.
  const imported = s.importableSection('accountability', { notifyOnCancel: false, partners: [{ type: 'webhook', name: 'Sam' }] });
  s.updateSection('accountability', capabilityTruth.sanitizeAccountability({ ...s.getSection('accountability'), ...imported }));
  s.updateSection('app', { timerName: 'rotates the backup' });

  for (const file of [f.primary, f.backup]) {
    const [partner] = f.read(file).accountability.partners;
    assert.equal(partner.url, f.sealed[0].url, `${path.basename(file)} keeps Sam's webhook ciphertext`);
    assert.equal(partner.headers, f.sealed[0].headers, `${path.basename(file)} keeps Sam's header ciphertext`);
  }
  const live = s.getSection('accountability');
  assert.equal(live.enabled, false, 'notifications stay off while the webhook cannot be read');
  assert.equal(live.notifyOnStart, false, 'the unrelated edit was saved');
  assert.equal(live.notifyOnCancel, false, 'the import was applied');

  f.state.locked = false;
  s.load();
  assert.deepEqual(s.getSection('accountability').partners, [SAM], 'back under the original key, Sam is intact');
});

test('a locked partner is replaced by new partner credentials or an explicit clear, never kept beside them', t => {
  const newUrl = 'https://hooks.example/new';
  for (const [label, form] of [
    ['same partner, new URL', { partners: [{ type: 'webhook', name: 'Sam', url: newUrl }] }],
    ['a different new partner', { partners: [{ type: 'webhook', name: 'Pat', url: newUrl }] }]
  ]) {
    const f = lockedAccountability(t);
    settingsSave(f.settings, form);
    f.state.locked = false;
    f.settings.load();
    const partners = f.settings.getSection('accountability').partners;
    assert.equal(partners.length, 1, label);
    assert.equal(partners[0].url, newUrl, label);
    assert.equal(partners[0].headers, undefined, `${label}: Sam's Authorization header is not re-attached`);
    assert.equal(fs.readFileSync(f.primary, 'utf8').includes(f.sealed[0].url), false, `${label}: Sam's ciphertext is gone`);
  }

  const f = lockedAccountability(t);
  f.settings.updateSection('accountability', { partners: [] }, { clearSecrets: ['partners.*.url'] });
  assert.deepEqual(f.read(f.primary).accountability.partners, [], 'an explicit clear removes the locked partner');
});

test('a locked partner echoed at another position keeps its own credentials', t => {
  const f = lockedAccountability(t, [SAM, KIT]);
  const s = f.settings;
  const [, kit] = s.getSection('accountability').partners;
  // Kit is echoed first; Sam is left out.
  s.updateSection('accountability', { partners: [kit] });
  f.state.locked = false;
  s.load();
  assert.deepEqual(s.getSection('accountability').partners, [KIT, SAM], 'each partner keeps its own webhook and headers');
});
