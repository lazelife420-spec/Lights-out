// Orphaned-receipt reconciliation behavioral tests.
// A receipt can be left at result:'running' forever if the process that
// started it ended (crash, force-kill, power loss) before a terminal
// update ever landed. reconcileOrphanedRunningReceipts() is the startup
// pass that finalizes those as 'interrupted' without touching a receipt
// still protected by a live, recoverable timer snapshot.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runReceipts = require('../runReceipts');

function reset() {
  runReceipts.clearReceipts();
  runReceipts._reset();
}

function makeRunningReceipt(overrides = {}) {
  return runReceipts.createRunReceipt({
    action: 'sleep',
    dryRun: true,
    totalSeconds: 900,
    profileId: null,
    profileName: null,
    nightModeId: 'quick-sleep',
    nightModeTitle: 'Quick Sleep',
    nightModeVersion: 1,
    ...overrides
  });
}

test('orphaned running receipt with no protected id becomes interrupted', () => {
  reset();
  const receipt = makeRunningReceipt();
  const reconciled = runReceipts.reconcileOrphanedRunningReceipts(null, '2026-07-19T22:00:00.000Z');
  assert.deepEqual(reconciled, [receipt.id]);
  const after = runReceipts.getReceiptById(receipt.id);
  assert.equal(after.result, 'interrupted');
  assert.equal(after.endedAt, '2026-07-19T22:00:00.000Z');
  assert.equal(after.reconciliationReason, 'orphaned-running-receipt');
  assert.equal(after.reconciledAt, '2026-07-19T22:00:00.000Z');
});

test('receipt preserves original evidence through reconciliation', () => {
  reset();
  const receipt = makeRunningReceipt({ action: 'shutdown', dryRun: false, profileId: 'p1', profileName: 'Work Focus' });
  const startedAt = receipt.startedAt;
  runReceipts.reconcileOrphanedRunningReceipts(null);
  const after = runReceipts.getReceiptById(receipt.id);
  assert.equal(after.id, receipt.id);
  assert.equal(after.startedAt, startedAt);
  assert.equal(after.action, 'shutdown');
  assert.equal(after.dryRun, false);
  assert.equal(after.profileId, 'p1');
  assert.equal(after.profileName, 'Work Focus');
  assert.equal(after.nightModeId, 'quick-sleep');
});

test('protected receipt id is left running (matching persisted/in-memory timer)', () => {
  reset();
  const protectedReceipt = makeRunningReceipt();
  const orphan = makeRunningReceipt();
  const reconciled = runReceipts.reconcileOrphanedRunningReceipts(protectedReceipt.id);
  assert.deepEqual(reconciled, [orphan.id]);
  assert.equal(runReceipts.getReceiptById(protectedReceipt.id).result, 'running');
  assert.equal(runReceipts.getReceiptById(orphan.id).result, 'interrupted');
});

test('multiple orphaned receipts are all reconciled deterministically', () => {
  reset();
  const a = makeRunningReceipt();
  const b = makeRunningReceipt();
  const c = makeRunningReceipt();
  const reconciled = runReceipts.reconcileOrphanedRunningReceipts(null);
  assert.deepEqual(reconciled.sort(), [a.id, b.id, c.id].sort());
  for (const id of [a.id, b.id, c.id]) {
    assert.equal(runReceipts.getReceiptById(id).result, 'interrupted');
  }
});

test('second reconciliation pass is a no-op (idempotent, no timestamp rewrite)', () => {
  reset();
  const receipt = makeRunningReceipt();
  const first = runReceipts.reconcileOrphanedRunningReceipts(null, '2026-07-19T22:00:00.000Z');
  assert.deepEqual(first, [receipt.id]);
  const second = runReceipts.reconcileOrphanedRunningReceipts(null, '2026-07-19T23:00:00.000Z');
  assert.deepEqual(second, [], 'second pass should find nothing left to reconcile');
  const after = runReceipts.getReceiptById(receipt.id);
  assert.equal(after.endedAt, '2026-07-19T22:00:00.000Z', 'timestamp must not be rewritten by a later pass');
  assert.equal(after.reconciledAt, '2026-07-19T22:00:00.000Z');
});

test('already-terminal receipts are left unchanged by reconciliation', () => {
  reset();
  const completed = makeRunningReceipt();
  runReceipts.updateRunReceipt(completed.id, { result: 'power_executed', endedAt: '2026-07-19T20:00:00.000Z' });
  const cancelled = makeRunningReceipt();
  runReceipts.updateRunReceipt(cancelled.id, { result: 'cancelled', endedAt: '2026-07-19T20:05:00.000Z' });
  const dryRunCompleted = makeRunningReceipt();
  runReceipts.updateRunReceipt(dryRunCompleted.id, { result: 'dry_run_completed', endedAt: '2026-07-19T20:10:00.000Z' });
  const alreadyInterrupted = makeRunningReceipt();
  runReceipts.updateRunReceipt(alreadyInterrupted.id, {
    result: 'interrupted', endedAt: '2026-07-19T20:15:00.000Z',
    reconciliationReason: 'orphaned-running-receipt', reconciledAt: '2026-07-19T20:15:00.000Z'
  });

  const reconciled = runReceipts.reconcileOrphanedRunningReceipts(null, '2026-07-19T22:00:00.000Z');
  assert.deepEqual(reconciled, [], 'no terminal receipt should be touched');
  assert.equal(runReceipts.getReceiptById(completed.id).endedAt, '2026-07-19T20:00:00.000Z');
  assert.equal(runReceipts.getReceiptById(cancelled.id).endedAt, '2026-07-19T20:05:00.000Z');
  assert.equal(runReceipts.getReceiptById(dryRunCompleted.id).endedAt, '2026-07-19T20:10:00.000Z');
  assert.equal(runReceipts.getReceiptById(alreadyInterrupted.id).endedAt, '2026-07-19T20:15:00.000Z');
});

test('reconciliation does not change receipt count or drop history', () => {
  reset();
  makeRunningReceipt();
  makeRunningReceipt();
  const before = runReceipts.getAllReceiptsForExport().length;
  runReceipts.reconcileOrphanedRunningReceipts(null);
  const after = runReceipts.getAllReceiptsForExport().length;
  assert.equal(after, before, 'no receipt should disappear during reconciliation');
});

test('getReceiptById returns null for an unknown id', () => {
  reset();
  makeRunningReceipt();
  assert.equal(runReceipts.getReceiptById('does-not-exist'), null);
  assert.equal(runReceipts.getReceiptById(null), null);
});

test('getMostRecentRunningReceiptId falls back correctly for pre-upgrade snapshots without receiptId', () => {
  reset();
  makeRunningReceipt();
  runReceipts.updateRunReceipt(runReceipts.getAllReceiptsForExport()[0].id, { result: 'cancelled', endedAt: '2026-07-19T20:00:00.000Z' });
  const stillRunning = makeRunningReceipt();
  assert.equal(runReceipts.getMostRecentRunningReceiptId(), stillRunning.id);

  // A pre-upgrade activeTimer snapshot has no receiptId; the caller must
  // fall back to this helper rather than treating the run as orphaned.
  const protectedId = runReceipts.getMostRecentRunningReceiptId();
  const reconciled = runReceipts.reconcileOrphanedRunningReceipts(protectedId);
  assert.deepEqual(reconciled, [], 'the only running receipt should have been protected via fallback');
  assert.equal(runReceipts.getReceiptById(stillRunning.id).result, 'running');
});

test('getMostRecentRunningReceiptId returns null when nothing is running', () => {
  reset();
  const r = makeRunningReceipt();
  runReceipts.updateRunReceipt(r.id, { result: 'cancelled' });
  assert.equal(runReceipts.getMostRecentRunningReceiptId(), null);
});

test('getReceiptStats is unaffected by reconciliation labeling (interrupted is not miscounted)', () => {
  reset();
  const orphan = makeRunningReceipt();
  const before = runReceipts.getReceiptStats();
  runReceipts.reconcileOrphanedRunningReceipts(null);
  const after = runReceipts.getReceiptStats();
  assert.equal(after.total, before.total, 'total count must be unchanged by reconciliation');
  assert.equal(after.completed, before.completed);
  assert.equal(after.cancelled, before.cancelled);
  assert.equal(after.dryRun, before.dryRun);
  assert.equal(after.blocked, before.blocked);
  assert.equal(runReceipts.getReceiptById(orphan.id).result, 'interrupted');
});
