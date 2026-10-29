'use strict';

// Autopilot watchdog: the scheduled task exists so a dead app relaunches
// before the armed bedtime. These tests pin down exactly what gets registered
// (exe + safe launch flags + the quiet-relaunch arg), when it disarms, and that
// the task itself can never carry a power action.

const assert = require('node:assert/strict');
const test = require('node:test');

const watchdog = require('../watchdog');

function captureRunner() {
  const calls = [];
  const runner = (file, args, opts, cb) => {
    calls.push({ file, args });
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

test('disarming deletes the task and tolerates it not existing', async () => {
  const { calls, runner } = captureRunner();
  const r = await watchdog.sync(null, { ...packaged, runner });
  assert.equal(r.armed, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['/Delete', '/TN', watchdog.TASK_NAME, '/F']);
});

test('non-Windows platforms only ever disarm', async () => {
  const { calls, runner } = captureRunner();
  const r = await watchdog.sync(new Date('2026-10-30T01:40:00'), { ...packaged, platform: 'linux', runner });
  assert.equal(r.armed, false);
  assert.equal(calls[0].args[0], '/Delete');
});

test('unpackaged (dev) runs only ever disarm — dev must not register tasks', async () => {
  const { calls, runner } = captureRunner();
  const r = await watchdog.sync(new Date('2026-10-30T01:40:00'), { ...packaged, isPackaged: false, runner });
  assert.equal(r.armed, false);
  assert.equal(calls[0].args[0], '/Delete');
});

test('a missing exe path only ever disarms', async () => {
  const { calls, runner } = captureRunner();
  const r = await watchdog.sync(new Date('2026-10-30T01:40:00'), { ...packaged, exePath: null, runner });
  assert.equal(r.armed, false);
  assert.equal(calls[0].args[0], '/Delete');
});

test('an invalid target disarms rather than registering garbage', async () => {
  const { calls, runner } = captureRunner();
  const r = await watchdog.sync('not-a-date', { ...packaged, runner });
  assert.equal(r.armed, false);
  assert.equal(calls[0].args[0], '/Delete');
});
