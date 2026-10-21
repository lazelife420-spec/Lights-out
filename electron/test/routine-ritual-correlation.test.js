'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createLedger } = require('../routineLedger'), model = require('../routineModel');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
function runtime({ failStep = false, steps, dryRun = !failStep } = {}) {
  let disk, timerCallback;
  const ledger = createLedger({ read: () => disk, write: value => { disk = value; return true; } });
  const plan = model.fromWindowsRule({ id: 'night', label: 'Night', days: ['mon'], time: '22:00', durationMinutes: 5 });
  const key = ledger.claim(plan, '2026-10-19', '2026-10-19T22:00:00Z').occurrenceKey;
  const settingsStore = { getSection: name => name === 'ritual' ? { enabled: true, steps: steps || [
    { id: 'block', auto: true, durationSeconds: 2 }, { id: 'timer', auto: true, durationSeconds: 0 }
  ] } : name === 'contentBlocker' ? { enabled: failStep } : { dryRun } };
  const module = { exports: {} }, scheduled = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ritualMode.js'), 'utf8'), {
    module, require: () => settingsStore, setTimeout: callback => { scheduled.push(callback); return scheduled.length; }, clearTimeout() {}
  });
  const context = require('../profileRitualContext'); context.clear();
  const receipts = [];
  const sandbox = { console: { error() {} }, Date, Math, Boolean, Number, settingsStore, routineLedger: ledger,
    timerState: {}, activeReceiptId: null, completionGuardController: null, timerInterval: null, mainWindow: null,
    ritualMode: module.exports, profileRitualContext: context,
    windDownChanges: { wifiSession: null },
    wifiLifecycle: require('../wifiGuardLifecycle').createLifecycle({ block: async () => ({ success: true }), unblock: async () => ({ success: true }) }),
    restoreAfterTimer: async () => ({ success: true }),
    profiles: { getById: () => ({ id: 'profile', ritualId: 'standard' }) },
    resolveTimerProfileIdentity: () => ({ profileId: 'profile', profileName: 'Night' }), resolveNightModeStart: () => ({}),
    startDecision: { resolveStartDecision: () => ({ useRitualGateway: true }) },
    overrideTax: { resetSession() {}, consumeDebt: () => 0 }, clearTimerInterval() {}, emitTimerUpdate() {},
    runReceipts: { getReceiptById: id => receipts.find(r => r.id === id), createRunReceipt: state => {
      const receipt = { id: 'run-' + receipts.length, result: 'running', routineOccurrenceKey: state.routineOccurrenceKey }; receipts.push(receipt); return receipt;
    } }, screenTime: { getScreenTimeToday: () => Promise.resolve(null), getRealityCheckMessage: () => null },
    sendAccountability() {}, persistActiveTimer() {}, setTaskbarProgress() {}, setInterval: callback => { timerCallback = callback; return 1; },
    contentBlocker: { DEFAULT_BLOCKLIST: [], blockSites: () => { throw Error('isolated adapter failure'); } }
  };
  const functions = ['normalizeTimerOptions', 'ritualAwaitingCountdown', 'startTimer', 'beginValidatedCountdown', 'setupRitualCallbacks'];
  vm.runInNewContext("const UNATTENDED_RUN_ORIGINS=['calendar'];\n" + functions.map(name => source.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0]).join('\n') + '\nsetupRitualCallbacks();globalThis.start=startTimer;', sandbox);
  const start = () => { const result = sandbox.start({ origin: 'calendar', startOrigin: 'calendar', profileId: 'profile', dryRun, durationSeconds: 300 }, undefined, key); ledger.dispatchResult(key, result); return result; };
  return { key, ledger, start, sandbox, receipts, scheduled, timerCallback: () => timerCallback };
}

test('actual delayed ritual -> countdown entry carries one stable occurrence into its real receipt creation', () => {
  const r = runtime(); assert.equal(r.start().success, true);
  assert.equal(r.ledger.list()[0].status, 'accepted'); assert.equal(r.receipts.length, 0);
  r.scheduled[0]();
  assert.equal(r.receipts.length, 1); assert.equal(r.receipts[0].routineOccurrenceKey, r.key);
  assert.equal(r.ledger.list()[0].timerReceiptId, r.receipts[0].id);
  assert.equal(r.ledger.list()[0].status, 'running'); assert.equal(typeof r.timerCallback(), 'function');
  r.sandbox.ritualMode.cancelRitual(); assert.equal(r.ledger.list()[0].status, 'running');
});
test('cancelling a pending ritual consumes its context and cannot start a later countdown', () => {
  const r = runtime(); r.start(); r.sandbox.ritualMode.cancelRitual(); r.scheduled[0]();
  assert.equal(r.ledger.list()[0].status, 'cancelled'); assert.equal(r.receipts.length, 0);
});
test('a preparation step failure remains failed even when cancellation and dispatch callbacks follow', () => {
  const r = runtime({ failStep: true }); assert.equal(r.start().success, false);
  assert.equal(r.ledger.list()[0].status, 'failed'); assert.equal(r.ledger.list()[0].reason, 'ritual-step-failed'); assert.equal(r.receipts.length, 0);
});
test('a ritual without a timer is failed, never completed', () => {
  const r = runtime({ steps: [{ id: 'dim', auto: true, durationSeconds: 0 }] }); r.start();
  assert.equal(r.ledger.list()[0].status, 'failed'); assert.equal(r.receipts.length, 0);
});

test('the actual recovery snapshot retains occurrence identity alongside its timer receipt', () => {
  let saved;
  const sandbox = { Date, activeReceiptId: 'receipt', timerState: { running: true, routineOccurrenceKey: 'v1:windows:local:night:2026-10-19' },
    settingsStore: { setActiveTimer: value => { saved = value; } } };
  vm.runInNewContext(source.match(/function persistActiveTimer\([^]*?\n\}/)[0]+';persistActiveTimer();', sandbox);
  assert.equal(saved.routineOccurrenceKey, sandbox.timerState.routineOccurrenceKey);
  assert.equal(saved.receiptId, 'receipt');
});
