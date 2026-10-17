'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const model = require('../routineModel'), { createLedger } = require('../routineLedger');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const check = source.match(/async function checkCalendarAutoStart\(\) \{[\s\S]*?\n\}/)[0];
const now = Date.UTC(2026, 9, 19, 22), startAt = new Date(now - 1000);
const plan = model.fromWindowsRule({ id: 'night', label: 'Night', time: '22:00', days: ['mon'], durationMinutes: 10, action: 'sleep' });
function setup(options = {}) {
  const disk = options.disk || { value: null }, starts = [], calendar = { enabled: true, autoStartFromEvents: true, ...options.calendar };
  const ledger = createLedger({ read: () => disk.value, write: data => { if (options.failWrite) return false; disk.value = structuredClone(data); return true; } });
  const Clock = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const event = { uid: 'local', source: 'builtin', start: startAt.toISOString(), end: new Date(now + 600000).toISOString(),
    action: 'sleep', routinePlan: options.plan || plan, profileId: options.profileId || null };
  const sandbox = { Date: Clock, String, Set, Boolean, Math, calendarAutoStartBusy: false, calendarStartedOccurrences: new Set(),
    routineModel: model, routineLedger: ledger, settingsStore: { getSection: name => name === 'calendar' ? calendar : { dryRun: true },
      updateSection: (_, patch) => Object.assign(calendar, patch) },
    isRunActive: () => !!options.busy, calProviders: { fetchAllEvents: async () => [event] }, isBedtimeEvent: () => true,
    profiles: { getById: () => null }, timerState: { running: false }, activeReceiptId: 'run-1',
    startTimer: input => { assert.equal(disk.value.entries[0].status, 'claimed', 'must persist BEFORE dispatch'); starts.push(input); sandbox.timerState.running = true; return { success: true }; },
    showNativeNotification() {}, getEventTitle: () => 'Night' };
  vm.runInNewContext(check + ';globalThis.check=checkCalendarAutoStart;', sandbox);
  return { disk, starts, sandbox, ledger, event };
}
test('v1 actual main dispatcher claims before existing timer start and cannot replay after restart/edit', async () => {
  const first = setup(); await first.sandbox.check(); assert.equal(first.starts.length, 1);
  assert.equal(first.starts[0].dryRun, true); assert.equal(first.starts[0].forceShutdown, false);
  assert.equal(first.ledger.list()[0].timerReceiptId, 'run-1');
  const edited = structuredClone(plan); edited.schedule.time = '23:00';
  const next = setup({ disk: first.disk, plan: edited }); await next.sandbox.check(); assert.equal(next.starts.length, 0);
});
test('v1 storage failure prevents any timer start', async () => {
  const r = setup({ failWrite: true }); await r.sandbox.check(); assert.equal(r.starts.length, 0); assert.equal(r.disk.value, null);
});
test('busy and removed-profile occurrences are visibly skipped, never substituted', async () => {
  for (const options of [{ busy: true }, { profileId: 'deleted' }]) {
    const r = setup(options); await r.sandbox.check(); assert.equal(r.starts.length, 0);
    assert.equal(r.ledger.list()[0].status, 'skipped'); await r.sandbox.check(); assert.equal(r.ledger.list().length, 1);
  }
});
test('foreign owner and unsupported adapter cannot dispatch on this PC', async () => {
  const phone = model.fromPhoneRoutine({ id: 'phone', name: 'Phone', seconds: 60, targets: [] });
  const r = setup({ plan: phone }); await r.sandbox.check(); assert.equal(r.starts.length, 0); assert.equal(r.disk.value, null);
});
test('legacy consumed occurrence keys remain honored after the model upgrade', async () => {
  const r = setup({ calendar: { lastStartedOccurrences: ['local@' + startAt.toISOString()] } });
  await r.sandbox.check(); assert.equal(r.starts.length, 0); assert.equal(r.disk.value, null);
});
