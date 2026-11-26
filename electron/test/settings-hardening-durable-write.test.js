'use strict';
// Regression guards for credentials-4 (settings.js side): settings.json and
// its backup are flushed to disk before the rename, a rename briefly refused
// by antivirus / the indexer (EPERM, EBUSY, EACCES) is retried, a lasting
// failure is still reported, and replaceBackup leaves no previous state.

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
  m.require = request => request === 'electron' ? { app: { getPath: () => dir } } : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  const primary = path.join(dir, 'settings.json');
  return { settings: m.exports, primary, backup: primary + '.bak', read: f => JSON.parse(fs.readFileSync(f, 'utf8')) };
}

function patchFs(t, name, replacement) {
  const original = fs[name];
  fs[name] = replacement(original);
  t.after(() => { fs[name] = original; });
  return () => { fs[name] = original; };
}

test('primary and backup are fsynced before they replace the previous files', t => {
  const f = loadSettings(t);
  f.settings.updateSection('app', { timerName: 'first' });
  let syncs = 0;
  patchFs(t, 'fsyncSync', original => function (...args) { syncs++; return original.apply(this, args); });
  f.settings.updateSection('app', { timerName: 'second' });
  assert.equal(syncs, 2, 'settings.json.tmp and settings.json.bak.tmp are both flushed');
  assert.equal(f.read(f.primary).app.timerName, 'second');
  assert.equal(f.read(f.backup).app.timerName, 'first');
});

test('a rename briefly held by antivirus is retried and the save succeeds', t => {
  const f = loadSettings(t);
  f.settings.updateSection('app', { dryRun: false });
  let refusals = 0;
  patchFs(t, 'renameSync', original => function (from, to) {
    if (to === f.primary && refusals < 2) {
      refusals++;
      throw Object.assign(new Error('fixture: file in use'), { code: 'EPERM' });
    }
    return original.call(this, from, to);
  });
  f.settings.updateSection('app', { dryRun: true }, { requireSave: true });
  assert.equal(refusals, 2);
  assert.equal(f.read(f.primary).app.dryRun, true, 'Test Mode reached disk');
});

test('a lasting rename failure is still reported and rolls back the requested change', t => {
  const f = loadSettings(t);
  f.settings.updateSection('app', { dryRun: false });
  let attempts = 0;
  const restore = patchFs(t, 'renameSync', original => function (from, to) {
    if (to === f.primary) {
      attempts++;
      throw Object.assign(new Error('fixture: locked'), { code: 'EBUSY' });
    }
    return original.call(this, from, to);
  });
  assert.throws(() => f.settings.updateSection('app', { dryRun: true }, { requireSave: true }), /Could not save settings/);
  assert.ok(attempts > 1 && attempts <= 6, `bounded retries (${attempts})`);
  assert.equal(f.settings.getSection('app').dryRun, false);
  restore();
  assert.equal(f.read(f.primary).app.dryRun, false);
  assert.equal(fs.existsSync(f.primary + '.tmp'), false, 'no temp file is left behind');
});

test('replaceBackup writes the backup from the new state', t => {
  const f = loadSettings(t);
  f.settings.updateSection('app', { timerName: 'previous state' });
  f.settings.updateSection('app', { timerName: 'current state' }, { replaceBackup: true });
  assert.equal(f.read(f.backup).app.timerName, 'current state');
  assert.deepEqual(f.read(f.backup), f.read(f.primary));
  f.settings.updateSection('app', { timerName: 'next' });
  assert.equal(f.read(f.backup).app.timerName, 'current state', 'ordinary saves keep the previous state as the backup');
});
