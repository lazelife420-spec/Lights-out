'use strict';
// Regression guard for review:settings (credentials-4 durability): a backup
// (settings.json.bak) that cannot be replaced, for example held open longer
// than the rename retry or set read-only, never blocks the primary save. The
// previous .bak stays on disk, the temp file is cleaned up, and only a
// replaceBackup save (whose caller needs the previous state gone) fails.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

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
  return { settings: m.exports, primary, backup: primary + '.bak', read: f => JSON.parse(fs.readFileSync(f, 'utf8')) };
}

// renameSync refuses the .bak target with EPERM on every attempt.
function refuseBackupRename(t, f) {
  const original = fs.renameSync;
  const counter = { attempts: 0 };
  fs.renameSync = function (from, to) {
    if (to === f.backup) {
      counter.attempts++;
      throw Object.assign(new Error('fixture: settings.json.bak is in use'), { code: 'EPERM' });
    }
    return original.call(this, from, to);
  };
  const restore = () => { fs.renameSync = original; };
  t.after(restore);
  return { counter, restore };
}

test('a backup that cannot be replaced does not block the primary save', t => {
  const f = loadSettings(t);
  const s = f.settings;
  s.updateSection('app', { timerName: 'first' });
  s.updateSection('app', { timerName: 'second' });
  assert.equal(f.read(f.backup).app.timerName, 'first');
  const { counter } = refuseBackupRename(t, f);

  assert.doesNotThrow(() => s.updateSection('app', { dryRun: true }, { requireSave: true }), 'a required save still succeeds');
  assert.ok(counter.attempts > 1 && counter.attempts <= 6, `the .bak rename was retried a bounded number of times (${counter.attempts})`);
  assert.equal(f.read(f.primary).app.dryRun, true, 'Test Mode reached settings.json');
  assert.equal(f.read(f.backup).app.timerName, 'first', 'the previous backup stays on disk');
  assert.equal(fs.existsSync(f.backup + '.tmp'), false, 'no backup temp file is left behind');
  assert.equal(fs.existsSync(f.primary + '.tmp'), false, 'no primary temp file is left behind');

  // A credential edit and the crash-recovery snapshot are saved as well.
  assert.doesNotThrow(() => s.updateSection('wifiGuard', { routerPass: 'new-pass' }));
  assert.ok(f.read(f.primary).wifiGuard.routerPass.startsWith('enc:v1:'));
  s.setActiveTimer({ endsAt: '2026-11-25T23:00:00.000Z', action: 'shutdown' });
  assert.equal(f.read(f.primary).activeTimer.action, 'shutdown');
  s.load();
  assert.equal(s.getSection('wifiGuard').routerPass, 'new-pass');
});

test('replaceBackup still reports a backup it could not replace', t => {
  const f = loadSettings(t);
  const s = f.settings;
  s.updateSection('app', { timerName: 'previous state' });
  s.updateSection('app', { timerName: 'current state' });
  const before = fs.readFileSync(f.primary, 'utf8');
  const { restore } = refuseBackupRename(t, f);

  assert.equal(s.save({ replaceBackup: true }), false, 'the save that must replace the backup fails');
  assert.throws(() => s.updateSection('app', { timerName: 'migrated' }, { replaceBackup: true, requireSave: true }), /Could not save settings/);
  assert.equal(fs.readFileSync(f.primary, 'utf8'), before, 'the primary is unchanged when the backup could not be replaced');
  assert.equal(s.getSection('app').timerName, 'current state', 'the requested change is rolled back');
  assert.equal(fs.existsSync(f.backup + '.tmp'), false);
  restore();
  s.updateSection('app', { timerName: 'migrated' }, { replaceBackup: true });
  assert.deepEqual(f.read(f.backup), f.read(f.primary), 'once the backup can be written it is replaced');
});
