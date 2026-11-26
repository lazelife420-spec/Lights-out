'use strict';
// Regression guard for review:settings credentials-2 (multi-partner case):
// with two or more locked accountability partners (a profile moved to another
// Windows account), a new credential for one partner must not retire the
// untouched others. A locked partner that is not echoed back goes only when
// a listed partner with its identity brings new credentials, on an explicit
// clear, or when it held the form's primary slot and a different partner with
// new credentials was typed over it.

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

const KIT = { type: 'webhook', name: 'Kit', url: 'https://hooks.example/kit', headers: { 'X-Kit': 'kit' } };
const SAM = { type: 'webhook', name: 'Sam', url: 'https://hooks.example/sam', headers: { Authorization: 'Bearer sam' } };
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

function unlockedPartners(f) {
  f.state.locked = false;
  f.settings.load();
  return f.settings.getSection('accountability').partners;
}

test('a new URL for the primary partner keeps the untouched locked extra partner', t => {
  for (const [label, form] of [
    ['form with Sam as loaded', loaded => [{ type: 'webhook', name: 'Kit', url: NEW_URL }, loaded[1]]],
    ['list without Sam', () => [{ type: 'webhook', name: 'Kit', url: NEW_URL }]]
  ]) {
    const f = lockedAccountability(t, [KIT, SAM]);
    settingsSave(f.settings, form(f.settings.getSection('accountability').partners));
    const text = fs.readFileSync(f.primary, 'utf8');
    assert.equal(text.includes(f.sealed[0].headers), false, `${label}: Kit's old header ciphertext is retired`);
    assert.equal(f.read(f.primary).accountability.partners[1].url, f.sealed[1].url, `${label}: Sam's webhook ciphertext is kept`);
    assert.deepEqual(unlockedPartners(f), [{ type: 'webhook', name: 'Kit', url: NEW_URL }, SAM],
      `${label}: Kit has the new URL and no old headers; Sam is intact`);
  }
});

test('a different partner typed over the primary slot replaces it and keeps the extra partner', t => {
  const f = lockedAccountability(t, [KIT, SAM]);
  settingsSave(f.settings, [{ type: 'webhook', name: 'Pat', url: NEW_URL }, f.settings.getSection('accountability').partners[1]]);
  assert.deepEqual(unlockedPartners(f), [{ type: 'webhook', name: 'Pat', url: NEW_URL }, SAM]);
});

test('a new credential for the extra partner keeps the untouched locked primary partner', t => {
  const f = lockedAccountability(t, [KIT, SAM]);
  // The primary is left as loaded (blank URL, so the form omits it) and Sam's
  // own entry carries a new URL.
  f.settings.updateSection('accountability', { partners: [{ type: 'webhook', name: 'Sam', url: NEW_URL }] });
  assert.deepEqual(unlockedPartners(f), [{ type: 'webhook', name: 'Sam', url: NEW_URL }, KIT],
    'Sam is replaced by its own new credential; Kit keeps its webhook and headers');
});

test('an unrelated Save keeps every locked partner (primary and backup)', t => {
  const f = lockedAccountability(t, [KIT, SAM]);
  settingsSave(f.settings, f.settings.getSection('accountability').partners);
  f.settings.updateSection('app', { timerName: 'rotates the backup' });
  for (const file of [f.primary, f.backup]) {
    const partners = f.read(file).accountability.partners;
    assert.deepEqual(partners.map(p => p.url), f.sealed.map(p => p.url), `${path.basename(file)} keeps both webhooks`);
  }
  assert.deepEqual(unlockedPartners(f), [KIT, SAM]);
});
