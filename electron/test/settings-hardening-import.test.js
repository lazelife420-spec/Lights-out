'use strict';
// Regression guards for settings import / legacy load shaping:
// - credentials-6: a backup never restores Companion exposure (enabled, mode,
//   LAN address) or the pairing token; only a valid port survives.
// - features-0: a pre-v11 single-schedule calendar (builtin {bedtime, days,
//   action}, no rules) keeps its schedule instead of being replaced by the
//   default every-day 22:30 shutdown rule, on primary load, backup recovery
//   and import.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const calendarProviders = require('../calendarProviders');

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
  return { settings: m.exports, primary, backup: primary + '.bak' };
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const LEGACY_CALENDAR = { enabled: true, autoStartFromEvents: true, builtin: { enabled: true, bedtime: '21:45', days: WEEKDAYS, action: 'sleep' } };

function assertLegacyRule(calendar) {
  assert.equal(calendar.builtin.rules.length, 1);
  const [rule] = calendar.builtin.rules;
  assert.deepEqual(rule, { id: 'legacy', label: 'Bedtime', time: '21:45', days: WEEKDAYS, action: 'sleep', durationMinutes: 60, enabled: true });
  // What calendar auto-start would fire over the next week (from a Saturday).
  const events = calendarProviders.getDefaultCalendarEvents(calendar.builtin, new Date(2026, 10, 28, 12, 0), 7);
  assert.ok(events.length > 0);
  for (const event of events) {
    assert.equal(event.action, 'sleep', 'the legacy action is kept, not escalated to shutdown');
    assert.equal(event.start.getHours() * 60 + event.start.getMinutes(), 21 * 60 + 45);
    assert.ok(![0, 6].includes(event.start.getDay()), 'no weekend events for a weekday schedule');
  }
}

test('a backup never turns Companion on or carries its token; only a valid port is restored', t => {
  const { settings } = loadSettings(t);
  assert.deepEqual(settings.importableSection('remoteControl', { enabled: true, mode: 'wifi', lanIp: '10.1.2.3', port: 50000, token: 'file-token', bindAll: true }), { port: 50000 });
  for (const port of [80, 70000, '50000', 50000.5, null]) {
    assert.deepEqual(settings.importableSection('remoteControl', { mode: 'local', port }), {}, `port ${port} is not restored`);
  }
  settings.updateSection('remoteControl', { enabled: false, mode: 'off', token: 'this-pc-token' });
  settings.updateSection('remoteControl', settings.importableSection('remoteControl', { enabled: true, mode: 'wifi', lanIp: '10.1.2.3', token: 'x' }));
  const rc = settings.getSection('remoteControl');
  assert.equal(rc.mode, 'off');
  assert.equal(rc.enabled, false);
  assert.equal(rc.lanIp, '');
  assert.equal(rc.token, 'this-pc-token');
});

test('a legacy single-schedule settings.json keeps its schedule on load', t => {
  const f = loadSettings(t);
  fs.writeFileSync(f.primary, JSON.stringify({ calendar: LEGACY_CALENDAR }));
  f.settings.load();
  const calendar = f.settings.getSection('calendar');
  assert.equal(calendar.autoStartFromEvents, true);
  assertLegacyRule(calendar);
  f.settings.updateSection('app', { timerName: 'persists the migrated rule' });
  f.settings.load();
  assertLegacyRule(f.settings.getSection('calendar'));
});

test('backup recovery migrates a legacy schedule too', t => {
  const f = loadSettings(t);
  fs.writeFileSync(f.primary, '{ truncated');
  fs.writeFileSync(f.backup, JSON.stringify({ calendar: LEGACY_CALENDAR }));
  f.settings.load();
  assertLegacyRule(f.settings.getSection('calendar'));
});

test('a legacy schedule in an imported backup replaces the rules instead of being ignored', t => {
  const { settings } = loadSettings(t);
  const input = JSON.parse(JSON.stringify(LEGACY_CALENDAR));
  const patch = settings.importableSection('calendar', input);
  assert.deepEqual(input, LEGACY_CALENDAR, 'the input is not mutated');
  settings.updateSection('calendar', patch);
  assertLegacyRule(settings.getSection('calendar'));
  assert.deepEqual(settings.migrateLegacyCalendar(LEGACY_CALENDAR).builtin.rules, patch.builtin.rules, 'the helper main can call directly gives the same rules');
});

test('settings that already have a rules array are never touched', t => {
  const f = loadSettings(t);
  const own = [{ id: 'mine', label: 'Late', time: '23:10', days: ['sat'], action: 'hibernate', durationMinutes: 30, enabled: true }];
  fs.writeFileSync(f.primary, JSON.stringify({ calendar: { builtin: { bedtime: '21:45', days: WEEKDAYS, action: 'sleep', rules: own } } }));
  f.settings.load();
  assert.deepEqual(f.settings.getSection('calendar').builtin.rules, own, 'stale legacy fields beside a rules array do not win');
  fs.writeFileSync(f.primary, JSON.stringify({ calendar: { builtin: { rules: [] } } }));
  f.settings.load();
  assert.deepEqual(f.settings.getSection('calendar').builtin.rules, [], 'a deliberately empty schedule stays empty');
  fs.writeFileSync(f.primary, JSON.stringify({ calendar: { builtin: { enabled: false } } }));
  f.settings.load();
  assert.equal(f.settings.getSection('calendar').builtin.rules[0].id, 'default', 'a builtin with no legacy fields keeps the default rule');
  assert.equal(f.settings.migrateLegacyCalendar(null), null);
});
