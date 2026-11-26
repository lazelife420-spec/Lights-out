'use strict';
// Regression guards for persisted feature data:
// - features-6: a v11.2.0 bedtime-deficit entry (keyed by UTC date) is not
//   overwritten by the next night's entry west of UTC.
// - features-7: a 33rd custom Last Light finale is refused up front instead
//   of being dropped at the next launch; longer lists saved by older builds
//   load in full.
// - features-9: a profile id from an older build that is not path-safe gets
//   the same replacement id on every launch, written back once.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-settings-hardening-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Runs sleepDebt.js in a child process pinned to a time zone, with electron's
// userData pointed at `dir` and the clock fixed at `nowIso`.
function runSleepDebt(dir, tz, nowIso, body) {
  const script = `
    const Module = require('module');
    const load = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'electron') return { app: { getPath: () => ${JSON.stringify(dir)} } };
      return load.call(this, request, ...rest);
    };
    Date.now = () => Date.parse(${JSON.stringify(nowIso)});
    const sleepDebt = require(${JSON.stringify(path.join(root, 'sleepDebt.js'))});
    ${body}
    const file = require('path').join(${JSON.stringify(dir)}, 'sleepDebt.json');
    process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(file, 'utf8')).dailyLog));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function legacyEntry(date, bedTime) {
  return { date, bedTime, wakeTime: '07:00', actualHours: 7.8, estimatedHours: 7.8, measurement: 'timer_estimate', targetHours: 8, debt: 0.2, surplus: 0 };
}

test('the first night after the upgrade does not overwrite the previous night (New York)', t => {
  const dir = tempDir(t);
  // v11.2.0 stored a 23:15 Nov 24 New York completion under the UTC date Nov 25.
  fs.writeFileSync(path.join(dir, 'sleepDebt.json'), JSON.stringify({ targetHours: 8, wakeTime: '07:00', dailyLog: [legacyEntry('2026-11-25', '23:15')] }));
  const log = runSleepDebt(dir, 'America/New_York', '2026-11-26T04:10:00.000Z', "sleepDebt.recordNight('23:10', '07:00', 7.8);");
  assert.deepEqual(log.map(e => [e.date, e.bedTime, e.nightKeyVersion]), [
    ['2026-11-24', '23:15', 2],
    ['2026-11-25', '23:10', 2]
  ]);
});

test('entries already keyed by night are never shifted again, and east of UTC nothing moves', t => {
  const marked = tempDir(t);
  fs.writeFileSync(path.join(marked, 'sleepDebt.json'), JSON.stringify({ dailyLog: [{ ...legacyEntry('2026-11-25', '23:10'), nightKeyVersion: 2 }] }));
  assert.deepEqual(runSleepDebt(marked, 'America/New_York', '2026-11-27T04:00:00.000Z', 'sleepDebt._load();').map(e => e.date), ['2026-11-25']);

  const east = tempDir(t);
  // Berlin 23:15 on Nov 24 is 22:15 UTC, still Nov 24.
  fs.writeFileSync(path.join(east, 'sleepDebt.json'), JSON.stringify({ dailyLog: [legacyEntry('2026-11-24', '23:15')] }));
  const log = runSleepDebt(east, 'Europe/Berlin', '2026-11-25T22:10:00.000Z', "sleepDebt.recordNight('23:10', '07:00', 7.8);");
  assert.deepEqual(log.map(e => e.date), ['2026-11-24', '2026-11-25']);
});

test('a 33rd custom finale is refused instead of vanishing at the next launch', () => {
  const lastLight = require('../lastLight');
  const make = i => ({ name: `Finale ${i}`, steps: [{ headline: 'H', line: `line ${i}`, dwellMs: 1000 }] });
  lastLight.loadCustomSequences([]);
  for (let i = 0; i < lastLight.MAX_CUSTOM_SEQUENCES; i++) assert.ok(lastLight.addCustomSequence(make(i)), `finale ${i} is added`);
  assert.equal(lastLight.addCustomSequence(make(99)), null, 'the limit is enforced when adding');
  const persisted = JSON.parse(JSON.stringify(lastLight.getCustomSequences()));
  lastLight.loadCustomSequences(persisted);
  assert.equal(lastLight.getCustomSequences().length, persisted.length, 'everything that was added survives a restart');

  // A list saved by a build without the add limit loads in full, so the next
  // add/remove (which persists the in-memory list) cannot drop entries.
  const older = Array.from({ length: 40 }, (_, i) => ({ ...make(i), id: `custom_legacy${String(i).padStart(4, '0')}` }));
  lastLight.loadCustomSequences(older);
  assert.equal(lastLight.getCustomSequences().length, 40);
  lastLight.removeCustomSequence('custom_legacy0000');
  assert.equal(lastLight.getCustomSequences().length, 39);
  lastLight.loadCustomSequences([]);
});

function loadProfiles(t, dir) {
  const file = path.join(root, 'profiles.js');
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return { app: { getPath: () => dir } };
    return original.call(this, request, ...rest);
  };
  t.after(() => { Module._load = original; delete require.cache[file]; });
  delete require.cache[file];
  return require(file);
}

test('a legacy profile id gets the same safe replacement on every launch and is written back once', t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'profiles.json');
  fs.writeFileSync(file, JSON.stringify([
    { id: 'wind.down', name: 'Wind Down' },
    { id: 'Wind Down', name: 'Spaced' },
    { id: 7, name: 'Numbered' },
    { id: '../evil', name: 'Traversal' },
    { id: 'already-safe_1', name: 'Safe' }
  ]));
  const profiles = loadProfiles(t, dir);
  assert.equal(profiles.initialize(), 5);
  const first = profiles.getAll().map(p => p.id);
  const migrations = profiles.getIdMigrations();
  assert.deepEqual(migrations.map(m => m.from), ['wind.down', 'Wind Down', 7, '../evil']);
  for (const id of first) assert.match(id, /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(first.some(id => id.includes('..')), false);
  assert.equal(first[2], '7');
  assert.equal(first[4], 'already-safe_1');
  assert.equal(new Set(first).size, first.length, 'replacement ids stay distinct');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).map(p => p.id), first, 'the new ids were written back');

  // Next launch: same ids, nothing left to migrate.
  profiles.reload();
  assert.deepEqual(profiles.getAll().map(p => p.id), first);
  assert.deepEqual(profiles.getIdMigrations(), []);
  // Even without the write-back the replacement is deterministic.
  assert.equal(profiles.normalize({ id: 'wind.down', name: 'Wind Down' }).id, first[0]);
});

test('a calendar rule naming a replaced profile id still finds that profile, and only that one', t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify([{ id: 'wind.down', name: 'Wind Down' }, { id: 'other', name: 'Other' }]));
  const profiles = loadProfiles(t, dir);
  profiles.initialize();
  // checkCalendarAutoStart: profiles.getById(event.profileId) with the old id.
  assert.equal(profiles.getById('wind.down')?.name, 'Wind Down');
  assert.equal(profiles.getById(' wind.down ')?.name, 'Wind Down');
  assert.equal(profiles.getById('other')?.name, 'Other');
  assert.equal(profiles.getById('wind,down'), null, 'a different legacy id does not resolve');
  assert.equal(profiles.getById(''), null);
  assert.equal(profiles.getById(null), null);
});

function loadSettingsFor(t) {
  const dir = tempDir(t);
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
  return { settings: m.exports, primary: path.join(dir, 'settings.json') };
}

test('settings references to a replaced profile id are re-pointed once and saved', t => {
  const f = loadSettingsFor(t);
  const s = f.settings;
  s.updateSection('calendar', { builtin: { rules: [
    { id: 'r1', time: '22:00', days: ['mon'], action: 'sleep', profileId: 'wind.down' },
    { id: 'r2', time: '23:00', days: ['tue'], action: 'shutdown', profileId: 'keep-me' },
    { id: 'r3', time: '23:30', days: ['wed'], action: 'shutdown' }
  ] } });
  s.updateSection('app', { lastSelectedProfileId: 'Wind Down' });
  const migrations = [
    { from: 'wind.down', to: 'wind-down-1a2b3c4d' },
    { from: 'Wind Down', to: 'Wind-Down-5e6f7a8b' },
    { from: 7, to: '7' },
    { from: null, to: 'fresh' }
  ];
  assert.equal(s.remapProfileReferences(migrations), 2);
  const disk = JSON.parse(fs.readFileSync(f.primary, 'utf8'));
  assert.deepEqual(disk.calendar.builtin.rules.map(r => r.profileId), ['wind-down-1a2b3c4d', 'keep-me', undefined]);
  assert.equal(disk.app.lastSelectedProfileId, 'Wind-Down-5e6f7a8b');
  assert.equal(s.remapProfileReferences(migrations), 0, 'nothing is left to re-point');
  assert.equal(s.remapProfileReferences([]), 0);
  assert.equal(s.remapProfileReferences(undefined), 0);
});

test('a stored finale without a valid id gets the same id on every launch; ids stay unique', () => {
  const lastLight = require('../lastLight');
  const stored = [
    { id: 'my.finale', name: 'Hand edited', steps: [{ headline: 'H', line: 'one', dwellMs: 1000 }] },
    { id: 'custom_dupe0001', name: 'First', steps: [{ line: 'a' }] },
    { id: 'custom_dupe0001', name: 'Second', steps: [{ line: 'b' }] }
  ];
  lastLight.loadCustomSequences(JSON.parse(JSON.stringify(stored)));
  const first = lastLight.getCustomSequences().map(s => s.id);
  lastLight.loadCustomSequences(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(lastLight.getCustomSequences().map(s => s.id), first, 'same ids on the next launch');
  assert.match(first[0], /^custom_[A-Za-z0-9_-]+$/);
  assert.equal(first[1], 'custom_dupe0001');
  assert.equal(new Set(first).size, 3, 'a duplicate id is made unique');
  lastLight.removeCustomSequence('custom_dupe0001');
  assert.deepEqual(lastLight.getCustomSequences().map(s => s.name), ['Hand edited', 'Second'], 'removing one finale removes only that one');
  // A new finale never takes an id the caller supplies.
  const added = lastLight.addCustomSequence({ id: first[0], name: 'New', steps: [{ line: 'n' }] });
  assert.notEqual(added.id, first[0]);
  lastLight.loadCustomSequences([]);
});

test('deficit-log entries that are not dated objects are dropped instead of breaking the next night', t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'sleepDebt.json'), JSON.stringify({ dailyLog: [null, 'x', { bedTime: '23:00' }, legacyEntry('2026-11-20', '12:00')] }));
  const log = runSleepDebt(dir, 'Europe/Berlin', '2026-11-25T22:10:00.000Z', "sleepDebt.recordNight('23:10', '07:00', 7.8);");
  assert.deepEqual(log.map(e => e.date), ['2026-11-20', '2026-11-25']);
});
