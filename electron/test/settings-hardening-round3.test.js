'use strict';
// v11.3 settings re-review (round 3): two locked partners sharing an identity
// (both left at the form's default name) must not both be retired by one new
// credential, and an import carrying null or wrong-shaped credential values
// must never null out or overwrite this PC's credentials.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const capabilityTruth = require('../capabilityTruth');

const root = path.join(__dirname, '..');

// settings.js with a fake safeStorage. state.locked makes decryption fail
// while encryption still works.
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

const NEW_URL = 'https://hooks.example/new';

function lockedAccountability(t, partners) {
  const f = loadSettings(t);
  f.settings.updateSection('accountability', { enabled: true, partners });
  f.sealed = f.read(f.primary).accountability.partners;
  f.state.locked = true;
  f.settings.load();
  return f;
}

// What save-app-settings sends: renderer-settings collectAccountabilitySettings()
// puts the primary partner (first webhook) first and echoes the extras as
// loaded; main runs capabilityTruth.sanitizeAccountability, which drops every
// partner without a usable URL (each locked one loads with url '').
function settingsSave(s, partners) {
  s.updateSection('accountability', capabilityTruth.sanitizeAccountability({ enabled: true, partners }));
}

test('one new credential for a shared-identity partner replaces only one locked partner', t => {
  const A = { type: 'webhook', name: 'Partner', url: 'https://hooks.example/a', headers: { 'X-A': 'a' } };
  const B = { type: 'webhook', name: 'Partner', url: 'https://hooks.example/b', headers: { 'X-B': 'b' } };
  const f = lockedAccountability(t, [A, B]);
  settingsSave(f.settings, [{ type: 'webhook', name: 'Partner', url: NEW_URL }]);
  f.state.locked = false;
  f.settings.load();
  const partners = f.settings.getSection('accountability').partners;
  assert.equal(partners.length, 2, 'the second shared-name partner is kept');
  assert.equal(partners[0].url, NEW_URL);
  assert.deepEqual({ url: partners[1].url, headers: partners[1].headers }, { url: B.url, headers: B.headers }, 'B keeps its own credentials');
});

test('an import with null or wrong-shaped credential values never touches this PC’s credentials', t => {
  const f = loadSettings(t);
  f.settings.updateSection('wifiGuard', { provider: 'webhook', routerPass: 'pc-pass', webhookUrl: 'https://hooks.example/pc', webhookHeaders: { A: 'pc' } });
  f.settings.updateSection('calendar', { ical: { url: 'https://cal.example/pc' }, google: { apiKey: 'pc-key' } });
  f.settings.updateSection('smartLights', { hueUsername: 'pc-hue' });
  for (const [section, value] of [
    ['wifiGuard', { routerPass: null, webhookUrl: null, webhookHeaders: null, deviceMacs: [] }],
    ['calendar', { ical: null, google: 'not-an-object', syncIntervalMin: 30 }],
    ['smartLights', { hueUsername: null, dimMinutes: 7 }]
  ]) {
    const patch = f.settings.importableSection(section, value);
    for (const key of ['routerPass', 'webhookUrl', 'webhookHeaders', 'ical', 'google', 'hueUsername']) {
      assert.equal(Object.prototype.hasOwnProperty.call(patch, key), false, section + '.' + key + ' is stripped');
    }
    f.settings.updateSection(section, patch);
  }
  f.settings.load();
  assert.equal(f.settings.getSection('wifiGuard').routerPass, 'pc-pass');
  assert.equal(f.settings.getSection('wifiGuard').webhookUrl, 'https://hooks.example/pc');
  assert.deepEqual(f.settings.getSection('wifiGuard').webhookHeaders, { A: 'pc' });
  assert.equal(f.settings.getSection('calendar').ical.url, 'https://cal.example/pc');
  assert.equal(f.settings.getSection('calendar').google.apiKey, 'pc-key');
  assert.equal(f.settings.getSection('calendar').syncIntervalMin, 30, 'non-credential preferences still import');
  assert.equal(f.settings.getSection('smartLights').hueUsername, 'pc-hue');
  assert.equal(f.settings.getSection('smartLights').dimMinutes, 7);
});
