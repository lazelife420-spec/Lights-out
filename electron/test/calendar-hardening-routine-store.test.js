'use strict';
// Routine file import/adopt/export hardening (features-1, features-8).
// features-1: the store must write only the subtrees it changes. Echoing the
// whole calendar section back through settings.updateSection wiped a locked
// (undecryptable) calendar credential for good.
// features-8: a monthly rule with days 1-31 plus 'Last' (-1), which the
// Schedule form can save, must still export.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), Module = require('node:module');
const { createStore } = require('../routineInterchangeStore');
const model = require('../routineModel');
const recurrence = require('../calendarRecurrence');

const doc = () => JSON.stringify({ format: 'lights-out.routines', schemaVersion: 1,
  routines: [{ id: 'night', name: 'Night', actions: [{ id: 'my-timer', type: 'timer.start', phase: 'start', parameters: { seconds: 600, endAction: 'sleep' } }] }],
  rules: [{ id: 'weekday', routineId: 'night', name: 'Weeknights', schedule: { kind: 'weekly', time: '22:00', weekdays: [1, 2, 3, 4, 5], monthDays: [], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], date: null, timezone: 'device-local', dstPolicy: 'shift-forward-first' } }] });

const SECRET_KEYS = [['ical', 'url'], ['google', 'apiKey'], ['outlook', 'accessToken'], ['calendly', 'personalToken']];

test('import and adopt write only the portable library and the rules they add, never a credential path', () => {
  const section = { enabled: true, autoStartFromEvents: false, builtin: { enabled: true, rules: [] },
    ical: { url: '' }, google: { apiKey: '', calendarId: 'me' }, outlook: { accessToken: '' }, calendly: { personalToken: '' }, lastStartedOccurrences: ['x'] };
  const writes = [];
  const store = createStore({ read: () => section, write: patch => { writes.push(structuredClone(patch)); } });

  assert.equal(store.import(doc()).count, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ['portable']);
  assert.equal(writes[0].portable.routines[0].adopted, false);
  for (const [top] of SECRET_KEYS) assert.equal(Object.hasOwn(writes[0], top), false, `import must not write calendar.${top}`);

  // The fake does not apply the patch, so feed the library back for adopt.
  section.portable = writes[0].portable;
  assert.equal(store.adopt({ id: 'night', seconds: 600, endAction: 'sleep' }).count, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(Object.keys(writes[1]).sort(), ['builtin', 'portable']);
  assert.deepEqual(Object.keys(writes[1].builtin), ['rules']);
  const [rule] = writes[1].builtin.rules;
  assert.equal(rule.enabled, false); assert.equal(rule.testMode, true); // still an inactive draft
  for (const [top] of SECRET_KEYS) assert.equal(Object.hasOwn(writes[1], top), false, `adopt must not write calendar.${top}`);
  assert.equal(writes[1].portable.routines[0].adopted, true);
});

// The real settings.js with a safeStorage that is available but cannot
// decrypt values written under another DPAPI context (a profile moved to
// another PC). Same loading pattern as settings-secret-coverage.test.js.
function settingsFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-calendar-hardening-'));
  t.after(() => {
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('lo-calendar-hardening-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const state = { locked: false };
  const file = path.join(__dirname, '..', 'settings.js'), m = new Module(file, module);
  m.filename = file; m.paths = module.paths;
  m.require = request => request === 'electron' ? { app: { getPath: () => dir }, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from('fixture:' + text),
    decryptString: bytes => { if (state.locked) throw Error('fixture: another DPAPI context'); return bytes.toString().slice(8); }
  } } : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  return { settings: m.exports, state, primary: path.join(dir, 'settings.json') };
}

test('a locked calendar credential survives routine file import and adoption through the real settings store', t => {
  const f = settingsFixture(t);
  f.settings.updateSection('calendar', { ical: { url: 'https://feed.invalid/fixture.ics' }, google: { apiKey: 'fixture-api-key', calendarId: 'me' } });
  const onDisk = () => JSON.parse(fs.readFileSync(f.primary, 'utf8')).calendar;
  const before = onDisk();
  assert.ok(before.ical.url.startsWith('enc:v1:') && before.google.apiKey.startsWith('enc:v1:'));

  f.state.locked = true; f.settings.load();
  assert.equal(f.settings.getSection('calendar').google.apiKey, '', 'a locked credential reads as empty');
  // The same wiring main.js uses for routineFiles.
  const store = createStore({ read: () => f.settings.getSection('calendar'),
    write: calendar => f.settings.updateSection('calendar', calendar, { requireSave: true }) });

  assert.equal(store.import(doc()).count, 1);
  assert.equal(onDisk().google.apiKey, before.google.apiKey, 'import kept the locked ciphertext');
  assert.equal(onDisk().ical.url, before.ical.url);
  assert.equal(store.adopt({ id: 'night', seconds: 600, endAction: 'sleep' }).count, 1);
  assert.equal(onDisk().google.apiKey, before.google.apiKey, 'adopt kept the locked ciphertext');
  assert.equal(onDisk().ical.url, before.ical.url);
  assert.equal(onDisk().google.calendarId, 'me');
  assert.equal(onDisk().builtin.rules.length, 2, 'the default rule stays and the adopted rule is added');
  assert.equal(onDisk().builtin.rules[1].enabled, false);

  // Back in the original context the credential is still recoverable.
  f.state.locked = false; f.settings.load();
  assert.equal(f.settings.getSection('calendar').google.apiKey, 'fixture-api-key');
  assert.equal(f.settings.getSection('calendar').ical.url, 'https://feed.invalid/fixture.ics');
});

const EVERY_DAY_AND_LAST = [...Array.from({ length: 31 }, (_, i) => i + 1), -1];

test('a monthly rule with every day plus Last exports, validates on both platforms and keeps the same nights', () => {
  const rules = [
    { id: 'monthly-all', label: 'Every night', repeat: 'monthly', time: '22:15', days: [], monthDays: EVERY_DAY_AND_LAST, durationMinutes: 30, action: 'sleep', enabled: true },
    // Switched to weekly after the month days were saved.
    { id: 'weekly-stale', label: 'Weeknights', repeat: 'weekly', time: '22:00', days: ['mon'], monthDays: EVERY_DAY_AND_LAST, durationMinutes: 30, action: 'sleep', enabled: true, profileId: 'p1' }
  ];
  const store = createStore({ read: () => ({ builtin: { rules } }), write: () => {},
    getProfiles: () => [{ id: 'p1', name: 'Short', mode: 'duration', seconds: 1800, action: 'sleep' }] });
  // Saving accepts the 32 values (fromWindowsRule), so export must too.
  assert.equal(model.fromWindowsRule(rules[0]).schedule.monthDays.length, 32);

  const out = store.export([{ kind: 'rule', id: 'monthly-all' }]);
  const exported = out.rules[0].schedule;
  assert.deepEqual(exported.monthDays, EVERY_DAY_AND_LAST.slice(0, 31));
  assert.doesNotThrow(() => model.interchange.parse(JSON.stringify(out)));
  for (const day of ['2026-02-28', '2028-02-29', '2026-04-30', '2026-12-31', '2026-01-01']) {
    assert.equal(model.matchesDate(exported, day), true, `${day} is still selected`);
  }
  // A profile export pulls in every rule that uses the profile.
  assert.doesNotThrow(() => store.export([{ kind: 'profile', id: 'p1' }]));
  assert.doesNotThrow(() => store.export([{ kind: 'rule', id: 'weekly-stale' }, { kind: 'rule', id: 'monthly-all' }]));

  // Round trip: import elsewhere and adopt; the adopted rule runs every day.
  let calendar = { builtin: { rules: [] } };
  const other = createStore({ read: () => calendar, write: patch => { calendar = { ...calendar, ...structuredClone(patch) }; } });
  other.import(JSON.stringify(out));
  other.adopt({ id: out.routines[0].id, seconds: 1800, endAction: 'sleep' });
  const adopted = calendar.builtin.rules[0];
  for (const [y, m, d] of [[2026, 1, 28], [2026, 3, 30], [2026, 11, 31]]) {
    assert.equal(recurrence.matchesDate({ ...adopted, enabled: true }, new Date(y, m, d, 12)), true);
  }
});

test('a partial month-day selection with Last is exported unchanged', () => {
  const rule = { id: 'm', label: 'Month end', repeat: 'monthly', time: '22:15', days: [], monthDays: [1, 15, -1], durationMinutes: 30, action: 'sleep' };
  const store = createStore({ read: () => ({ builtin: { rules: [rule] } }), write: () => {} });
  assert.deepEqual(store.export([{ kind: 'rule', id: 'm' }]).rules[0].schedule.monthDays, [-1, 1, 15]);
});
