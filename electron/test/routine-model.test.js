'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const model = require('../routineModel');
const weekly = { id: 'week', label: 'Night', time: '22:00', days: ['mon'], durationMinutes: 10, action: 'sleep' };
test('legacy Windows rule migrates without changing its saved fields', () => {
  const before = JSON.stringify(weekly), plan = model.fromWindowsRule(weekly);
  assert.equal(JSON.stringify(weekly), before); assert.equal(plan.schemaVersion, 1);
  assert.deepEqual(plan.owner, { platform: 'windows', deviceId: 'local' });
  assert.deepEqual(plan.schedule.weekdays, [1]); assert.equal(plan.actions[0].parameters.seconds, 600);
});
test('Android and Windows share recurrence and stable occurrence keys', () => {
  const phone = model.fromPhoneRoutine({ id: 'routine', name: 'Phone', seconds: 600, targets: [], brightness: 0 },
    { id: 'week', kind: 'weekly', time: '22:00', weekdays: [1] });
  const pc = model.fromWindowsRule(weekly);
  assert.equal(model.matchesDate(phone.schedule, '2026-10-19'), true);
  assert.equal(model.matchesDate(pc.schedule, '2026-10-19'), true);
  const key = model.occurrenceKey(pc, '2026-10-19');
  pc.schedule.time = '23:00'; pc.actions[0].parameters.seconds = 900;
  assert.equal(model.occurrenceKey(pc, '2026-10-19'), key);
  assert.notEqual(model.occurrenceKey(phone, '2026-10-19'), key);
});
test('monthly last day, missing days, selected months and individual dates', () => {
  const schedule = { kind: 'monthly', monthDays: [-1], months: [2] };
  assert.equal(model.matchesDate(schedule, '2028-02-29'), true);
  assert.equal(model.matchesDate(schedule, '2028-03-31'), false);
  assert.equal(model.matchesDate({ ...schedule, monthDays: [31] }, '2028-02-29'), false);
  assert.equal(model.matchesDate({ kind: 'once', date: '2199-12-31' }, '2199-12-31'), true);
  assert.equal(model.matchesDate({ kind: 'weekly', weekdays: [1], months: [12] }, '2026-10-19'), false);
});
test('future versions, remote ownership, unsafe powers and fake adapters fail closed', () => {
  const plan = model.fromWindowsRule(weekly);
  for (const mutate of [p => { p.schemaVersion = 2; }, p => { p.owner.deviceId = 'phone'; },
    p => { p.actions[0].target = 'another-pc'; }, p => { p.actions[0].type = 'router.disable'; },
    p => { p.actions[0].parameters.endAction = 'force-shutdown'; }]) {
    const copy = structuredClone(plan); mutate(copy); assert.throws(() => model.validate(copy));
  }
  assert.equal(model.availability(plan, 'android').available, false);
  assert.equal(model.availability(plan, 'windows').available, true);
});
test('Android WiZ actions are explicit and require saved local targets', () => {
  const p = model.fromPhoneRoutine({ id: 'phone', name: 'Warm', seconds: 60, targets: ['192.168.0.2'], brightness: 30, offAtEnd: true });
  assert.deepEqual(p.actions.map(a => a.type), ['timer.start', 'wiz.warm', 'wiz.off']);
  assert.equal(p.actions[2].phase, 'timer-complete');
  assert.throws(() => model.fromPhoneRoutine({ id: 'phone', name: 'Bad', seconds: 60, targets: ['8.8.8.8'], brightness: 30 }));
});
test('bundled Android JS is the exact common model, with no network/runtime dependency', () => {
  assert.deepEqual(fs.readFileSync(path.join(__dirname, '../routineModel.js')),
    fs.readFileSync(path.join(__dirname, '../../companion-android/app/src/main/assets/phone/routine-model.js')));
});
