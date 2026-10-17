'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createLedger } = require('../routineLedger');
const model = require('../routineModel');
const plan = model.fromWindowsRule({ id: 'test', label: 'Test', time: '22:00', days: ['mon'], durationMinutes: 5, action: 'sleep' });
test('claim is persisted before dispatch and prevents duplicates across restart and edits', () => {
  let disk = null;
  const options = { read: () => structuredClone(disk), write: value => { disk = structuredClone(value); return true; } };
  const first = createLedger(options), claim = first.claim(plan, '2026-10-19', '2026-10-19T22:00:00Z');
  assert.equal(disk.entries.length, 1); assert.equal(claim.status, 'claimed');
  assert.equal(createLedger(options).claim(plan, '2026-10-19', '2026-10-19T23:00:00Z'), null);
  first.update(claim.occurrenceKey, { status: 'accepted', timerReceiptId: 'timer-1' });
  assert.equal(createLedger(options).list()[0].timerReceiptId, 'timer-1');
});
test('a failed durable write prevents acceptance and does not consume an occurrence in memory', () => {
  let fail = true, disk = null;
  const ledger = createLedger({ read: () => disk, write: value => { if (fail) return false; disk = value; return true; } });
  assert.throws(() => ledger.claim(plan, '2026-10-19', '2026-10-19T22:00:00Z'), /persist/i);
  fail = false; assert.ok(ledger.claim(plan, '2026-10-19', '2026-10-19T22:00:00Z'));
});
test('receipt acceptance, simulated completion and cancellation remain distinct', () => {
  let disk;
  const ledger = createLedger({ read: () => disk, write: value => { disk = value; return true; } });
  const claim = ledger.claim(plan, '2026-10-19', '2026-10-19T22:00:00Z');
  ledger.update(claim.occurrenceKey, { status: 'accepted', timerReceiptId: 'run' });
  assert.equal(ledger.list(() => ({ result: 'dry_run_completed' }))[0].status, 'simulated');
  assert.equal(ledger.list(() => ({ result: 'cancelled' }))[0].status, 'cancelled');
  assert.equal(ledger.list(() => null)[0].status, 'accepted');
});
test('unreadable/corrupt ledgers fail closed instead of replaying actions', () => {
  const ledger = createLedger({ read: () => { throw Error('corrupt'); }, write: () => true });
  assert.throws(() => ledger.claim(plan, '2026-10-19', '2026-10-19T22:00:00Z'), /corrupt/);
});
