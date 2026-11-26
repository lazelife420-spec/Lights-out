'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { runBounded } = require('../boundedProcess');
const { createDelivery } = require('../firstLightDelivery');
const { createAlarm } = require('../alarm');

function child() { const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kills = 0; c.kill = () => { c.kills++; c.emit('close', 0); }; return c; }
test('hung scanner settles as timeout even if kill synchronously reports success', async () => {
  const c = child();
  await assert.rejects(runBounded({ spawn: () => c, file: 'fake', args: [], timeoutMs: 10, errorPrefix: 'UNSAVED_SCAN' }), { code: 'UNSAVED_SCAN_TIMEOUT' });
  assert.equal(c.kills, 1);
});
test('scanner spawn throw and nonzero completion never mean a successful empty scan', async () => {
  await assert.rejects(runBounded({ spawn() { throw Object.assign(new Error('no'), { code: 'EACCES' }); }, file: 'fake', args: [] }), { code: 'EACCES' });
  const c = child(); queueMicrotask(() => c.emit('close', 5));
  await assert.rejects(runBounded({ spawn: () => c, file: 'fake', args: [], errorPrefix: 'UNSAVED_SCAN' }), { code: 'UNSAVED_SCAN_FAILED' });
});
test('scanner cancellation before and during execution is bounded and never successful', async () => {
  const before = new globalThis.AbortController(); before.abort(); let calls = 0;
  await assert.rejects(runBounded({ spawn() { calls++; }, file: 'fake', args: [], signal: before.signal }), { code: 'PROCESS_ABORTED' }); assert.equal(calls, 0);
  const during = new globalThis.AbortController(), c = child(); const pending = runBounded({ spawn: () => c, file: 'fake', args: [], signal: during.signal }); during.abort();
  await assert.rejects(pending, { code: 'PROCESS_ABORTED' }); assert.equal(c.kills, 1);
});
test('successful scanner retains warnings; interrupted output cannot masquerade as complete', async () => {
  const context = { module: { exports: {} }, require(name) {
    if (name === './boundedProcess') return { runBounded };
    assert.equal(name, 'child_process'); return { spawn() { const c = child(); queueMicrotask(() => { c.stdout.write('123|Editor|Save changes to document'); c.emit('close', 0); }); return c; } };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../unsavedGuard.js'), 'utf8'), context);
  const warnings = await context.module.exports.scanUnsavedWork(); assert.equal(warnings.length, 1); assert.equal(warnings[0].pid, 123);
});
test('First Light queues before readiness, deduplicates delivery and persists claim across restart', () => {
  let ready = false, starts = 0; const claims = new Set();
  const options = { ready: () => ready, busy: () => false, claim: id => { if (claims.has(id)) return false; claims.add(id); return true; }, start: () => starts++, onError: error => { throw error; } };
  const delivery = createDelivery(options), argv = ['app', '--first-light', '--first-light-request=fixture-1'];
  delivery.request(argv); delivery.request(argv); assert.equal(starts, 0);
  ready = true; delivery.flush(); delivery.request(argv); assert.equal(starts, 1);
  createDelivery(options).request(argv); assert.equal(starts, 1);
  assert.equal(delivery.request(['--first-light', '--first-light-request=bad!']), false);
});
test('First Light failed durable claim blocks sunrise and can be retried explicitly', () => {
  let fail = true, starts = 0, errors = 0;
  const d = createDelivery({ ready: () => true, busy: () => false, claim() { if (fail) throw Error('write failed'); return true; }, start: () => starts++, onError: () => errors++ });
  const args = ['--first-light', '--first-light-request=retry']; d.request(args); assert.equal(starts, 0); assert.equal(errors, 1);
  fail = false; d.request(args); assert.equal(starts, 1);
});
function alarmFixture(task) {
  const scripts = []; let removalFails = false;
  const alarm = createAlarm({ taskName: 'LightsOut_FirstLight_QA_unit', exists: () => true, now: () => Date.parse('2026-10-19T00:00:00Z'), executor(file, args) {
    assert.equal(file, 'powershell.exe'); const script = args.at(-1); scripts.push(script); const c = child();
    queueMicrotask(() => { if (script.includes('Register-ScheduledTask')) { task.exists = true; task.executable = 'C:\\fixture\\app.exe'; task.arguments = '--first-light --first-light-request=fixture'; }
      if (script.includes('Get-ScheduledTaskInfo')) c.stdout.write(JSON.stringify(task));
      c.emit('close', removalFails && script.includes('Unregister-ScheduledTask') ? 1 : 0); }); return c;
  } });
  return { alarm, scripts, failRemoval: () => { removalFails = true; } };
}
test('Ready First Light task needs a real target, enabled future trigger and correct action', async () => {
  const task = { exists: true, state: 'Ready', enabled: true, targetExists: false, nextRunTime: '2026-10-20T07:00:00Z', arguments: '--first-light' }, f = alarmFixture(task);
  assert.equal((await f.alarm.getWakeAlarmStatus()).code, 'TARGET_MISSING');
  task.targetExists = true; task.nextRunTime = null; assert.equal((await f.alarm.getWakeAlarmStatus()).code, 'NO_FUTURE_RUN');
  task.nextRunTime = '2026-10-20T07:00:00Z'; task.enabled = false; assert.equal((await f.alarm.getWakeAlarmStatus()).active, false);
  task.enabled = true; task.arguments = ''; assert.equal((await f.alarm.getWakeAlarmStatus()).code, 'INVALID_ACTION');
  task.arguments = '--first-light'; assert.equal((await f.alarm.getWakeAlarmStatus()).active, true);
});
test('First Light validates before mutation, preserves profile, verifies new task and reports failed removal', async () => {
  const f = alarmFixture({ exists: false, state: 'Ready', enabled: true, targetExists: true, nextRunTime: '2026-10-20T07:00:00Z' });
  assert.equal((await f.alarm.scheduleWakeAlarm('99:99', 'C:\\fixture\\app.exe')).success, false); assert.equal(f.scripts.length, 0);
  const result = await f.alarm.scheduleWakeAlarm('07:00', 'C:\\fixture\\app.exe', 'C:\\fixture\\profile'); assert.equal(result.success, true);
  assert.ok(f.scripts[0].includes('--first-light-request=')); assert.ok(f.scripts[0].includes('--user-data-dir=C:\\fixture\\profile'));
  assert.ok(!f.scripts[0].includes('Unregister-ScheduledTask'));
  f.failRemoval(); assert.equal((await f.alarm.removeWakeAlarm()).success, false);
});
