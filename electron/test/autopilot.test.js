'use strict';

// Autopilot Bedtime: the learned pattern must actually be reachable and the
// schedule must re-arm after firing.
//
// schedule() used to pick `autopilotBedtime || app.bedtime || learned`, which
// made the learned bedtime dead code -- app.bedtime is always populated, so
// the learned value was unreachable and autopilot aimed at the generic
// reminder bedtime instead of the pattern it had learned (settings.js
// documents autopilotBedtime=null as "use learned bedtime or configured
// bedtime", i.e. learned first). The fire callback also never re-armed, so a
// single fire (or a refused start) left autopilot spent until the app
// restarted -- silently disabling the feature on any machine that stayed up.

const assert = require('node:assert/strict');
const test = require('node:test');

const settingsPath = require.resolve('../settings');
const streaksPath = require.resolve('../streaks');
const autopilotPath = require.resolve('../autopilot');

let sections;
let weekDays;

function loadAutopilot(app = {}, days = []) {
  sections = { app: { autopilotEnabled: true, ...app } };
  weekDays = days;
  require.cache[settingsPath] = {
    id: settingsPath, filename: settingsPath, loaded: true,
    exports: {
      getSection: (name) => sections[name] || {},
      updateSection: (name, val) => { sections[name] = val; }
    }
  };
  require.cache[streaksPath] = {
    id: streaksPath, filename: streaksPath, loaded: true,
    exports: { getSummary: () => ({ weekDays }) }
  };
  delete require.cache[autopilotPath];
  return require('../autopilot');
}

const daysAt = (...times) => times.map((bedTime, i) => ({ date: `2026-10-${10 + i}`, bedTime }));
const fakeWindow = () => ({ isDestroyed: () => false, webContents: { send: () => {} } });

function withFakeTimers(fn) {
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  const timers = [];
  global.setTimeout = (cb, ms) => { const t = { cb, ms }; timers.push(t); return t; };
  global.clearTimeout = (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
  try {
    return fn(timers);
  } finally {
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
}

test('learned bedtime wins over the generic configured bedtime', () => {
  const autopilot = loadAutopilot({ bedtime: '22:00' }, daysAt('01:55', '02:00', '02:05'));
  const status = autopilot.schedule(() => ({ success: true }), fakeWindow());
  assert.equal(status.targetBedtime, '02:00');
  autopilot.cancel();
});

test('explicit autopilot override still wins over the learned bedtime', () => {
  const autopilot = loadAutopilot({ bedtime: '22:00', autopilotBedtime: '23:45' }, daysAt('02:00', '02:00', '02:00'));
  const status = autopilot.schedule(() => ({ success: true }), fakeWindow());
  assert.equal(status.targetBedtime, '23:45');
  autopilot.cancel();
});

test('configured bedtime is the fallback when there is nothing learned', () => {
  const autopilot = loadAutopilot({ bedtime: '23:15' }, daysAt('02:00', '02:00')); // <3 samples
  const status = autopilot.schedule(() => ({ success: true }), fakeWindow());
  assert.equal(status.targetBedtime, '23:15');
  autopilot.cancel();
});

test('hard default holds when neither learned nor configured exists', () => {
  const autopilot = loadAutopilot({ bedtime: null });
  const status = autopilot.schedule(() => ({ success: true }), fakeWindow());
  assert.equal(status.targetBedtime, '22:30');
  autopilot.cancel();
});

test('getStatus reports the same effective bedtime the schedule will use', () => {
  const autopilot = loadAutopilot({ bedtime: '22:00' }, daysAt('02:10', '02:00', '01:50'));
  const status = autopilot.getStatus();
  assert.equal(status.bedtime, '02:00');
  autopilot.cancel();
});

test('a fired autopilot re-arms for the next night instead of going spent', () => {
  const autopilot = loadAutopilot({ bedtime: '22:00', durationSeconds: 600 }, daysAt('02:00', '02:00', '02:00'));
  const starts = [];
  withFakeTimers((timers) => {
    autopilot.schedule((opts) => { starts.push(opts); return { success: true }; }, fakeWindow());
    assert.equal(timers.length, 2); // warning + fire
    const fire = timers[timers.length - 1];
    fire.cb();
    assert.equal(starts.length, 1);
    assert.equal(starts[0].origin, 'autopilot');
    assert.equal(timers.length, 2, 'fire must leave a fresh warning + fire pair armed');
    assert.ok(timers[timers.length - 1].ms > 0);
    assert.equal(autopilot.getStatus().scheduled, true);
  });
  autopilot.cancel();
});

test('a refused start also re-arms rather than disabling the feature', () => {
  const autopilot = loadAutopilot({ bedtime: '22:00' }, daysAt('02:00', '02:00', '02:00'));
  withFakeTimers((timers) => {
    autopilot.schedule(() => ({ success: false }), fakeWindow());
    timers[timers.length - 1].cb();
    assert.equal(timers.length, 2, 're-arm must happen even when the start was refused');
  });
  autopilot.cancel();
});
