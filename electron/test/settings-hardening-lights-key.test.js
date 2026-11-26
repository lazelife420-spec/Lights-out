'use strict';
// Regression guards for credentials-1: smartLights.verifiedConfigKey is stored
// as plain settings (not a SECRET_PATHS field), exported, and sent to the
// renderer, so it must never carry the Hue key, webhook URL or body template.
// A key saved by an earlier build in the plaintext form stays valid through
// the upgrade and is rewritten, in the primary and the backup.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const smartLights = require('../smartLights');

const root = path.join(__dirname, '..');

function loadSettings(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-settings-hardening-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(root, 'settings.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  m.require = request => request === 'electron' ? { app: { getPath: () => dir }, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from('fixture:' + text),
    decryptString: bytes => bytes.toString().slice(8)
  } } : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  const primary = path.join(dir, 'settings.json');
  return { settings: m.exports, primary, backup: primary + '.bak', text: f => fs.readFileSync(f, 'utf8') };
}

function resetLights(t) {
  t.after(() => smartLights.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '', hueBridgeIp: '', hueUsername: '', hueGroupId: '', httpUrl: '', httpHeaders: {}, httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}' }));
}

const HUE = { provider: 'hue', enabled: true, hueBridgeIp: '192.168.0.2', hueUsername: 'hue-secret-user', hueGroupId: '1' };
const HTTP = { provider: 'http', enabled: true, httpMethod: 'POST', httpUrl: 'https://ha.example/api/webhook/secret-hook-id', httpHeaders: { Authorization: 'Bearer secret-header' }, httpBodyTemplate: '{"secret-body": {{ON}}}' };

test('the verification key carries no Hue key, webhook URL or body template and still tracks every change', () => {
  const hueKey = smartLights.configurationKey(HUE);
  assert.equal(hueKey.includes('hue-secret-user'), false);
  assert.ok(hueKey.startsWith('hue:192.168.0.2:') && hueKey.endsWith(':1'), 'bridge IP and group stay readable');
  assert.notEqual(smartLights.configurationKey({ ...HUE, hueUsername: 'other-user' }), hueKey, 'a new Hue key invalidates the verification');

  const httpKey = smartLights.configurationKey(HTTP);
  for (const secret of ['secret-hook-id', 'ha.example', 'secret-body', 'secret-header']) assert.equal(httpKey.includes(secret), false, `no ${secret} in the key`);
  assert.notEqual(smartLights.configurationKey({ ...HTTP, httpUrl: HTTP.httpUrl + '2' }), httpKey);
  assert.notEqual(smartLights.configurationKey({ ...HTTP, httpBodyTemplate: '{}' }), httpKey);
  assert.notEqual(smartLights.configurationKey({ ...HTTP, httpMethod: 'PUT' }), httpKey);
  assert.equal(smartLights.configurationKey({ provider: 'wiz', wizAddresses: ['192.168.0.18'] }), 'wiz:192.168.0.18', 'WiZ keys hold only addresses and are unchanged');
});

// What v11.2.0 left on disk after a successful Hue Verify: the key in
// plaintext in settings.json, and a verbatim copy of it in the backup.
function writeV1120Profile(f, legacyKey) {
  const tree = { smartLights: { ...HUE, verifiedConfigKey: legacyKey } };
  fs.writeFileSync(f.primary, JSON.stringify(tree));
  fs.writeFileSync(f.backup, JSON.stringify(tree));
}

test('a plaintext key saved by v11.2.0 survives the upgrade and leaves neither settings.json nor its backup', t => {
  resetLights(t);
  const f = loadSettings(t);
  const legacyKey = 'hue:192.168.0.2:hue-secret-user:1';
  writeV1120Profile(f, legacyKey);

  // Startup: main loads settings, rehydrates the lights module, and re-saves
  // the migrated key with the backup replaced.
  f.settings.load();
  const result = smartLights.loadConfig(f.settings.getSection('smartLights'));
  assert.deepEqual(result, { migrated: true });
  assert.equal(smartLights.getConfig().enabled, true, 'the verification still holds after the upgrade');
  f.settings.updateSection('smartLights', { verifiedConfigKey: smartLights.getConfig().verifiedConfigKey }, { replaceBackup: true });
  for (const file of [f.primary, f.backup]) assert.equal(f.text(file).includes('hue-secret-user'), false, `${path.basename(file)} has no plaintext Hue key`);

  // Next launch: nothing left to migrate, lights still verified.
  f.settings.load();
  assert.deepEqual(smartLights.loadConfig(f.settings.getSection('smartLights')), { migrated: false });
  assert.equal(smartLights.getConfig().enabled, true);
});

test('an ordinary save never copies a plaintext verification key into the rebuilt backup', t => {
  resetLights(t);
  const f = loadSettings(t);
  const legacyKey = `http:POST:${HTTP.httpUrl}:${smartLights.httpHeadersDigest(HTTP.httpHeaders)}:${HTTP.httpBodyTemplate}`;
  writeV1120Profile(f, legacyKey);
  f.settings.load();
  // Saves before main has re-saved the migrated key (a timer start, a move).
  f.settings.updateSection('app', { timerName: 'first' });
  f.settings.updateSection('app', { timerName: 'second' });
  assert.equal(f.text(f.backup).includes('secret-hook-id'), false, 'the backup holds no webhook URL');
  assert.equal(JSON.parse(f.text(f.backup)).smartLights.verifiedConfigKey, '');
  // A digest-form key is a normal value and is kept in the backup.
  const digestKey = smartLights.configurationKey(HUE);
  f.settings.updateSection('smartLights', { ...HUE, verifiedConfigKey: digestKey });
  f.settings.updateSection('app', { timerName: 'third' });
  assert.equal(JSON.parse(f.text(f.backup)).smartLights.verifiedConfigKey, digestKey);
});

test('a legacy webhook key migrates, and a stale legacy key with plaintext in it is dropped', t => {
  resetLights(t);
  const legacy = `http:POST:${HTTP.httpUrl}:${smartLights.httpHeadersDigest(HTTP.httpHeaders)}:${HTTP.httpBodyTemplate}`;
  assert.deepEqual(smartLights.loadConfig({ ...HTTP, verifiedConfigKey: legacy }), { migrated: true });
  assert.equal(smartLights.getConfig().enabled, true);
  assert.equal(smartLights.getConfig().verifiedConfigKey, smartLights.configurationKey(HTTP));

  const stale = `http:POST:https://old.example/old-hook:none:${HTTP.httpBodyTemplate}`;
  assert.deepEqual(smartLights.loadConfig({ ...HTTP, verifiedConfigKey: stale }), { migrated: true });
  assert.equal(smartLights.getConfig().verifiedConfigKey, '', 'an old-form key for another setup is not kept');
  assert.equal(smartLights.getConfig().enabled, false);

  // A current-form key for another setup is kept as is (it still cannot enable).
  const otherCurrent = smartLights.configurationKey({ ...HTTP, httpUrl: 'https://other.example/x' });
  assert.deepEqual(smartLights.loadConfig({ ...HTTP, verifiedConfigKey: otherCurrent }), { migrated: false });
  assert.equal(smartLights.getConfig().verifiedConfigKey, otherCurrent);
  assert.equal(smartLights.getConfig().enabled, false);
});

test('the renderer copy holds no Hue key and says whether the key belongs to this setup', t => {
  resetLights(t);
  smartLights.loadConfig({ ...HUE, enabled: false, verifiedConfigKey: smartLights.configurationKey(HUE) });
  let pub = smartLights.getPublicConfig();
  assert.equal(JSON.stringify(pub).includes('hue-secret-user'), false);
  assert.equal(pub.verifiedForSetup, true, 'verified but switched off');
  // The renderer sends the key it was given back on Save: still verified.
  smartLights.loadConfig({ ...pub, enabled: true, hueUsername: '' });
  assert.equal(smartLights.getConfig().enabled, true);
  smartLights.loadConfig({ hueGroupId: '2', enabled: true, verifiedConfigKey: pub.verifiedConfigKey });
  pub = smartLights.getPublicConfig();
  assert.equal(pub.verifiedForSetup, false, 'a changed setup is not verified');
  assert.equal(pub.enabled, false);
});

test('a data export carries no verification key, and an imported one is ignored', t => {
  resetLights(t);
  const f = loadSettings(t);
  f.settings.updateSection('smartLights', { ...HTTP, verifiedConfigKey: smartLights.configurationKey(HTTP) });
  const { settings: exported } = f.settings.exportSnapshot();
  assert.equal('verifiedConfigKey' in exported.smartLights, false);
  assert.equal(JSON.stringify(exported).includes('secret-hook-id'), false);
  assert.equal(f.settings.getSection('smartLights').verifiedConfigKey, smartLights.configurationKey(HTTP), 'export does not touch live settings');

  // An old full backup still holds a plaintext key; it never reaches settings.
  const imported = f.settings.importableSection('smartLights', { mode: 'warm_dim', verifiedConfigKey: 'hue:10.0.0.9:someone-else:1' });
  assert.deepEqual(imported, { mode: 'warm_dim' });
  f.settings.updateSection('smartLights', imported);
  assert.equal(f.settings.getSection('smartLights').verifiedConfigKey, smartLights.configurationKey(HTTP), 'this PC keeps its own verification');
});
