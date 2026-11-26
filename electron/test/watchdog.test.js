'use strict';

// Autopilot watchdog: the scheduled task exists so a dead app relaunches
// before the armed bedtime. These tests pin down exactly what gets registered
// (exe + safe launch flags + the quiet-relaunch arg), when it disarms, and that
// the task itself can never carry a power action.

const assert = require('node:assert/strict');
const test = require('node:test');

const watchdog = require('../watchdog');

function captureRunner({ registered = null } = {}) {
  const calls = [];
  const runner = (file, args, opts, cb) => {
    calls.push({ file, args });
    if (args[0] === '/Query') {
      if (!registered) return cb(Object.assign(new Error('not found'), { code: 1 }), '', 'ERROR: task not found');
      return cb(null, `<?xml version="1.0" encoding="UTF-16"?>
<Task><Actions><Exec><Command>"${registered}"</Command><Arguments>--minimized --no-auto-start ${watchdog.RELAUNCH_ARG}</Arguments></Exec></Actions></Task>`, '');
    }
    cb(null, '', '');
  };
  return { calls, runner };
}

const packaged = { platform: 'win32', isPackaged: true, exePath: 'C:\\Apps\\Lights Out.exe' };

test('arming registers a daily task 15 minutes before the armed fire', async () => {
  const { calls, runner } = captureRunner();
  const fire = new Date('2026-10-30T01:40:00');
  const r = await watchdog.sync(fire, { ...packaged, runner });
  assert.equal(r.armed, true);
  assert.equal(r.at, '01:25');
  assert.equal(calls.length, 1);
  const { file, args } = calls[0];
  assert.equal(file, 'schtasks.exe');
  assert.equal(args[0], '/Create');
  const tn = args.indexOf('/TN');
  assert.equal(args[tn + 1], watchdog.TASK_NAME);
  const tr = args.indexOf('/TR');
  assert.ok(args[tr + 1].startsWith('"C:\\Apps\\Lights Out.exe"'), 'task runs the packaged exe');
  assert.ok(args[tr + 1].includes('--minimized'));
  assert.ok(args[tr + 1].includes('--no-auto-start'));
  assert.ok(args[tr + 1].includes(watchdog.RELAUNCH_ARG), 'relaunch arg lets the first instance stay quiet');
  assert.ok(!args[tr + 1].includes('shutdown'), 'watchdog must never carry a power action');
  assert.equal(args[args.indexOf('/SC') + 1], 'DAILY');
  assert.equal(args[args.indexOf('/ST') + 1], '01:25');
  assert.ok(args.includes('/F'), 're-arm overwrites the previous registration');
});

test('disarming deletes the task only when it launches this executable', async () => {
  const { calls, runner } = captureRunner({ registered: 'c:\\apps\\LIGHTS OUT.exe' });
  const r = await watchdog.sync(null, { ...packaged, runner });
  assert.equal(r.armed, false);
  assert.deepEqual(calls.map(c => c.args[0]), ['/Query', '/Delete']);
  assert.deepEqual(calls[1].args, ['/Delete', '/TN', watchdog.TASK_NAME, '/F']);
});

test('disarming tolerates the task not existing', async () => {
  const { calls, runner } = captureRunner();
  const r = await watchdog.sync(null, { ...packaged, runner });
  assert.equal(r.armed, false);
  assert.deepEqual(calls.map(c => c.args[0]), ['/Query'], 'nothing to delete');
});

test('a task armed by another installation is never deleted by this one', async () => {
  const { calls, runner } = captureRunner({ registered: 'C:\\Program Files\\Lights Out\\Lights Out.exe' });
  const r = await watchdog.sync(null, { ...packaged, exePath: 'D:\\Portable\\Lights Out.exe', runner });
  assert.equal(r.armed, false);
  assert.ok(!calls.some(c => c.args[0] === '/Delete'), 'a portable/QA build must not remove the installed app task');
});

test('non-Windows platforms never call schtasks', async () => {
  const { calls, runner } = captureRunner({ registered: packaged.exePath });
  const r = await watchdog.sync(new Date('2026-10-30T01:40:00'), { ...packaged, platform: 'linux', runner });
  assert.equal(r.armed, false);
  assert.equal(calls.length, 0);
});

test('unpackaged (dev) runs never register a task and never delete the installed app task', async () => {
  const { calls, runner } = captureRunner({ registered: packaged.exePath });
  const r = await watchdog.sync(new Date('2026-10-30T01:40:00'), {
    ...packaged, isPackaged: false, exePath: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe', runner });
  assert.equal(r.armed, false);
  assert.ok(!calls.some(c => c.args[0] === '/Create' || c.args[0] === '/Delete'));
});

test('an unpackaged run of the same exe path may still clean up its own task', async () => {
  const { calls, runner } = captureRunner({ registered: packaged.exePath });
  await watchdog.sync(new Date('2026-10-30T01:40:00'), { ...packaged, isPackaged: false, runner });
  assert.deepEqual(calls.map(c => c.args[0]), ['/Query', '/Delete']);
});

test('a missing exe path never registers or deletes', async () => {
  const { calls, runner } = captureRunner({ registered: packaged.exePath });
  const r = await watchdog.sync(new Date('2026-10-30T01:40:00'), { ...packaged, exePath: null, runner });
  assert.equal(r.armed, false);
  assert.equal(calls.length, 0);
});

test('an invalid target disarms (owned task only) rather than registering garbage', async () => {
  const { calls, runner } = captureRunner({ registered: packaged.exePath });
  const r = await watchdog.sync('not-a-date', { ...packaged, runner });
  assert.equal(r.armed, false);
  assert.deepEqual(calls.map(c => c.args[0]), ['/Query', '/Delete']);
});

test('QA and proof launches never touch the scheduled task', async (t) => {
  t.after(() => watchdog.setEnabled(true));
  watchdog.setEnabled(false);
  const { calls, runner } = captureRunner({ registered: packaged.exePath });
  const armed = await watchdog.sync(new Date('2026-10-30T01:40:00'), { ...packaged, runner });
  const disarmed = await watchdog.sync(null, { ...packaged, runner });
  assert.equal(armed.skipped, true);
  assert.equal(disarmed.skipped, true);
  assert.equal(calls.length, 0);
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("watchdog.setEnabled(!(QA_POWER_LOCK || process.env.LIGHTS_OUT_INSTALLER_QA === '1'));"), 'main gates the watchdog for QA launches');
});
