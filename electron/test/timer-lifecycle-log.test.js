'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = source.indexOf('function writeTimerLifecycle(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
function sandbox(overrides = {}) {
  const entries = [];
  const context = { process: { pid: 123 }, timerState: { running: false, paused: false, remainingSeconds: 0, endsAt: null, action: 'shutdown', dryRun: false }, QA_POWER_LOCK: false, activeReceiptId: null, mainWindow: null,
    writeStartupLog: (message, data) => entries.push({ message, data }),
    settingsStore: { getSection() { throw Error('Diagnostics must not read or initialize settings'); } }, ...overrides };
  vm.createContext(context); vm.runInContext(fn + '\nthis.log = writeTimerLifecycle;', context);
  return { context, entries };
}
test('completion logs the actual run mode even after running becomes false', () => {
  const { context, entries } = sandbox({ activeReceiptId: 'r_original' });
  context.log('Timer complete');
  assert.equal(entries[0].data.dryRun, false);
  assert.equal(entries[0].data.receiptId, 'r_original');
  assert.deepEqual(Object.keys(entries[0].data).sort(), ['action','dryRun','endsAt','paused','pid','qaPowerLock','receiptId','remainingSeconds','running','windowVisible'].sort());
});
test('idle lifecycle logging does not initialize settings or invent a run mode', () => {
  const { context, entries } = sandbox(); context.log('App quitting');
  assert.equal(entries.length, 1); assert.equal(entries[0].data.dryRun, null);
});
test('window and log failures cannot change timer state or escape into execution', () => {
  for (const overrides of [{ mainWindow: { isDestroyed() { throw Error('window gone'); } } }, { writeStartupLog() { throw Error('disk unavailable'); } }]) {
    const { context } = sandbox(overrides); const before = JSON.stringify(context.timerState);
    assert.doesNotThrow(() => context.log('Timer progress checkpoint'));
    assert.equal(JSON.stringify(context.timerState), before);
  }
});
