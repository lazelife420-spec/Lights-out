'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createPersistence } = require('../receiptPersistence');
const { createDispatcher } = require('../powerActionDispatcher');
const { EventEmitter } = require('node:events');

function isolatedStore({ io = fs, directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-action-receipts-')), appPathError = false } = {}) {
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, console: { warn() {} }, Date, Math, process: appPathError ? { versions: { electron: 'test' } } : process, require(name) {
    if (name === 'path') return path;
    if (name === 'electron') return { app: { getPath: () => { if (appPathError) throw new Error('fake unavailable profile'); return directory; } } };
    if (name === './receiptPersistence') return { createPersistence: (file, options) => createPersistence(file, { ...options, fs: io }) };
    throw new Error('Unexpected dependency: ' + name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../runReceipts.js'), 'utf8'), sandbox);
  return { store: module.exports, directory, file: path.join(directory, 'run-receipts.json') };
}
const plain = value => JSON.parse(JSON.stringify(value));

for (const state of ['action_requested', 'command_spawned', 'completing']) {
  test(`restart after ${state} preserves evidence and reports Windows outcome unknown`, () => {
    const { store, directory } = isolatedStore();
    const receipt = store.createRunReceipt({ action: 'shutdown', dryRun: false, totalSeconds: 60 });
    store.updateRunReceipt(receipt.id, { result: state, notes: 'preserve me' });
    const reopened = isolatedStore({ directory }).store;
    assert.deepEqual(plain(reopened.reconcileOrphanedRunningReceipts(null)), [receipt.id]);
    const recovered = reopened.getReceiptById(receipt.id);
    assert.equal(recovered.result, 'outcome_unverified');
    assert.equal(recovered.lastActionState, state);
    assert.equal(recovered.notes, 'preserve me');
    assert.equal(recovered.powerEvidence.systemOutcome, 'unverified');
    assert.equal(reopened.getReceiptStats().systemOutcomesObserved, 0);
    assert.deepEqual(plain(reopened.reconcileOrphanedRunningReceipts(null)), [], 'reconciliation is idempotent');
  });
}

test('historical receipt records retain every original field after writing v2 receipts', () => {
  const { directory, file } = isolatedStore();
  const legacy = { id: 'r_legacy', version: 1, result: 'power_executed', dryRun: false, powerCommand: 'sleep', action: 'sleep', oldField: { nested: 42 } };
  fs.writeFileSync(file, JSON.stringify({ receipts: [legacy] }));
  const { store } = isolatedStore({ directory });
  const receipt = store.createRunReceipt({ action: 'shutdown', dryRun: false, totalSeconds: 60 });
  store.recordActionEvent(receipt.id, { state: 'action_requested', at: new Date().toISOString(), command: 'shutdown.exe', arguments: ['/s', '/t', '0'] });
  assert.equal(store.getReceiptById(receipt.id).powerCommand, 'shutdown.exe /s /t 0');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).receipts[0], legacy);
  const stats = store.getReceiptStats();
  assert.equal(stats.legacyUnverified, 1);
  assert.equal(stats.systemOutcomesObserved, 0);
});

test('a successful pre-dispatch proof transition is on disk before the injected executor is called', async () => {
  const { store, file } = isolatedStore();
  const receipt = store.createRunReceipt({ action: 'shutdown', dryRun: false });
  let invocations = 0;
  const dispatch = createDispatcher({ spawn() {
    invocations++;
    const saved = JSON.parse(fs.readFileSync(file)).receipts.find(r => r.id === receipt.id);
    assert.equal(saved.result, 'action_requested');
    assert.equal(saved.powerEvidence.events.at(-1).state, 'action_requested');
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => { child.emit('spawn'); child.emit('exit', 0, null); });
    return child;
  } });
  const result = await dispatch({ action: 'shutdown', onEvidence: event => store.recordActionEvent(receipt.id, event) });
  assert.equal(invocations, 1);
  assert.equal(result.systemOutcome, 'unverified');
});

test('timer completion, command acceptance, failures, mode and OS evidence remain separate counters', () => {
  const { store } = isolatedStore();
  for (const state of ['command_returned_success', 'command_returned_failure', 'spawn_failed', 'outcome_unverified']) {
    const receipt = store.createRunReceipt({ action: 'shutdown', dryRun: false, totalSeconds: 1 });
    store.recordActionEvent(receipt.id, { state: 'timer_elapsed', at: new Date().toISOString() });
    store.recordActionEvent(receipt.id, { state, at: new Date().toISOString() });
  }
  const stats = store.getReceiptStats();
  assert.equal(stats.timerFinished, 4);
  assert.equal(stats.blocked, 2);
  assert.equal(stats.completed, 2, 'compatibility key counts unverified endings, not Windows outcomes');
  assert.equal(stats.systemOutcomesObserved, 0);
  assert.equal(stats.realRuns, 4);
});

test('a failed save is visible in every receipt read and export, while legacy disk history is unchanged', () => {
  const { directory, file } = isolatedStore();
  fs.writeFileSync(file, JSON.stringify({ receipts: [{ id: 'old', result: 'power_executed', dryRun: false }] }));
  const before = fs.readFileSync(file);
  const fake = Object.create(fs);
  fake.openSync = () => { throw Object.assign(new Error('fake disk full'), { code: 'ENOSPC' }); };
  const { store } = isolatedStore({ directory, io: fake });
  const receipt = store.createRunReceipt({ action: 'shutdown', dryRun: false });
  store.recordActionEvent(receipt.id, { state: 'action_requested', at: new Date().toISOString() });
  assert.equal(receipt.persistence.saved, false);
  assert.equal(store.getLatestReceipt().persistence.saved, false);
  assert.equal(store.listReceipts()[0].persistence.saved, false);
  assert.equal(store.getAllReceiptsForExport()[0].persistence.saved, false);
  assert.equal(store.getReceiptStats().persistence.saved, false);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('no receipt API can promote subprocess events to an independently observed Windows outcome', () => {
  const { store } = isolatedStore();
  const r = store.createRunReceipt({ dryRun: false });
  assert.throws(() => store.recordActionEvent(r.id, { state: 'system_outcome_observed' }), /Unknown action evidence/);
  assert.equal(store.getReceiptStats().systemOutcomesObserved, 0);
});

test('an unavailable Electron user-data path reports memory-only proof without writing an alternate profile', () => {
  const { store, file } = isolatedStore({ appPathError: true });
  assert.throws(() => store.getLatestReceipt(), /Receipts unavailable/);
  assert.throws(() => store.listReceipts(), /Receipts unavailable/);
  assert.throws(() => store.getReceiptStats(), /Receipts unavailable/);
  const receipt = store.createRunReceipt({ dryRun: false });
  store.recordActionEvent(receipt.id, { state: 'action_requested', at: new Date().toISOString() });
  assert.equal(store.getLatestReceipt().persistence.saved, false);
  assert.equal(store.getLatestReceipt().persistence.errorCode, 'USERDATA_UNAVAILABLE');
  assert.equal(fs.existsSync(file), false);
});

test('a failed history deletion retains the in-memory and on-disk ledger, including after restart', () => {
  const { directory, file } = isolatedStore();
  fs.writeFileSync(file, JSON.stringify({ receipts: [{ id: 'keep', result: 'power_executed', dryRun: false }] }));
  const fake = Object.create(fs);
  fake.renameSync = (from, to) => { if (to === file) throw Object.assign(new Error('fake busy'), { code: 'EPERM' }); return fs.renameSync(from, to); };
  const { store } = isolatedStore({ directory, io: fake });
  assert.equal(store.clearReceipts().cleared, false);
  assert.equal(store.getLatestReceipt().id, 'keep');
  assert.equal(isolatedStore({ directory }).store.getLatestReceipt().id, 'keep');
});

test('the existing 100-receipt retention limit remains, with the previous file retained as backup', () => {
  const { directory, file } = isolatedStore();
  fs.writeFileSync(file, JSON.stringify({ receipts: Array.from({ length: 100 }, (_, i) => ({ id: 'old_' + i, result: 'cancelled' })) }));
  const { store } = isolatedStore({ directory });
  const created = store.createRunReceipt({ dryRun: true });
  assert.equal(store.listReceipts(1000).length, 100);
  assert.equal(store.getLatestReceipt().id, created.id);
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak')).receipts[0].id, 'old_0');
});
