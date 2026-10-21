'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), Module = require('node:module');
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-secret-fixture-'));
  t.after(() => {
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('lo-secret-fixture-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const state = { available: true, failEncryption: false, ...options };
  const file = path.join(__dirname, '..', 'settings.js'), m = new Module(file, module);
  m.filename = file; m.paths = module.paths;
  m.require = request => request === 'electron' ? { app: { getPath: () => dir }, safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: text => { if (state.failEncryption) throw Error('fixture encryption failure'); return Buffer.from('fixture:' + text); },
    decryptString: bytes => { if (!state.available) throw Error('fixture locked'); return bytes.toString().slice(8); }
  } } : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  return { settings: m.exports, dir, state, primary: path.join(dir, 'settings.json') };
}
test('credential URLs, headers, array partner credentials and HTTP bodies encrypt and round-trip', t => {
  const f = fixture(t), token = 'synthetic-sensitive-value';
  f.settings.updateSection('wifiGuard', { routerPass: token, routerUser: token, webhookUrl: token, webhookHeaders: { Authorization: token } });
  f.settings.updateSection('calendar', { ical: { url: token } });
  f.settings.updateSection('accountability', { partners: [{ type: 'webhook', url: token, headers: { Authorization: token } }, { type: 'discord', webhookId: token, webhookToken: token }, { type: 'slack', webhookUrl: token }] });
  f.settings.updateSection('smartLights', { httpUrl: token, httpHeaders: { Authorization: token }, httpBodyTemplate: token });
  for (const file of [f.primary, f.primary + '.bak']) assert.equal(fs.readFileSync(file, 'utf8').includes(token), false);
  f.settings.load(); assert.equal(f.settings.getSection('wifiGuard').routerPass, token);
  assert.equal(f.settings.getSection('accountability').partners[1].webhookToken, token);
  assert.equal(f.settings.getSection('smartLights').httpBodyTemplate, token);
});
test('legacy plaintext migrates in both primary and backup without losing unknown settings', t => {
  const f = fixture(t), token = 'legacy-fixture-value';
  fs.writeFileSync(f.primary, JSON.stringify({ wifiGuard: { webhookUrl: token }, accountability: { partners: [{ type: 'webhook', url: token }] }, ownerExtension: { keep: 42 } }));
  f.settings.load(); f.settings.updateSection('app', { timerName: 'Fixture' });
  for (const file of [f.primary, f.primary + '.bak']) assert.equal(fs.readFileSync(file, 'utf8').includes(token), false);
  assert.equal(f.settings.getAll().ownerExtension.keep, 42);
});
test('unavailable encryption rejects credential edits and preserves primary, backup and cache', t => {
  const f = fixture(t); f.settings.updateSection('wifiGuard', { routerPass: 'old-fixture' }); f.settings.updateSection('app', { timerName: 'saved' });
  const before = [f.primary, f.primary + '.bak'].map(file => fs.readFileSync(file, 'utf8')); f.state.available = false;
  assert.throws(() => f.settings.updateSection('wifiGuard', { routerPass: 'new-fixture' }), { code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
  assert.deepEqual([f.primary, f.primary + '.bak'].map(file => fs.readFileSync(file, 'utf8')), before);
  assert.equal(f.settings.getSection('wifiGuard').routerPass, 'old-fixture');
});
test('an encryption API failure never falls back to plaintext', t => {
  const f = fixture(t, { failEncryption: true });
  assert.throws(() => f.settings.updateSection('remoteControl', { token: 'fixture-token' }), { code: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
  assert.equal(fs.existsSync(f.primary), false); assert.equal(f.settings.getSection('remoteControl').token, '');
});
test('locked ciphertext survives unrelated edits and is removed only by an explicit clear', t => {
  const f = fixture(t); f.settings.updateSection('wifiGuard', { routerPass: 'fixture-token' }); const ciphertext = JSON.parse(fs.readFileSync(f.primary)).wifiGuard.routerPass;
  f.state.available = false; f.settings.load(); assert.equal(f.settings.getSection('wifiGuard').routerPass, '');
  f.settings.updateSection('app', { timerName: 'still usable without credentials' });
  assert.equal(JSON.parse(fs.readFileSync(f.primary)).wifiGuard.routerPass, ciphertext);
  f.settings.updateSection('wifiGuard', { routerPass: '' }); assert.equal(JSON.parse(fs.readFileSync(f.primary)).wifiGuard.routerPass, '');
});
test('a literal encryption-looking credential is not mistaken for already encrypted input', t => {
  const f = fixture(t), token = 'enc:v1:literal-fixture'; f.settings.updateSection('remoteControl', { token }); f.settings.load();
  assert.equal(f.settings.getSection('remoteControl').token, token);
});
