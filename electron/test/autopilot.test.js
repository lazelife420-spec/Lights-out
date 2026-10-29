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
const receiptsPath = require.resolve('../runReceipts');
const watchdogPath = require.resolve('../watchdog');
const autopilotPath = require.resolve('../autopilot');

let sections;
let weekDays;
let receipts;
let watchdogCalls;

function loadAutopilot(app = {}, days = []) {
  sections = { app: { autopilotEnabled: true, ...app } };
  weekDays = days;
  receipts = [];
  watchdogCalls = [];
  require.cache[settingsPath] = {
    id: settingsPath, filename: settingsPath, loaded: true,
    exports: {
      getSection: (name) => sections[name] || {},
      updateSection: (name, val) => { Object.assign(sections[name] = sections[name] || {}, val); }
    }
  };
  require.cache[streaksPath] = {
    id: streaksPath, filename: streaksPath, loaded: true,
    exports: { getSummary: () => ({ weekDays }) }
  };
  require.cache[receiptsPath] = {
    id: receiptsPath, filename: receiptsPath, loaded: true,
    exports: {
      createRunReceipt: (state) => {
        const r = { id: `r_${receipts.length}`, result: 'running', startedAt: new Date().toISOString(), endedAt: null, notes: null, ...state };
        receipts.push(r);
        return r;
      },
      updateRunReceipt: (id, updates) => {
        const r = receipts.find(x => x.id === id);
        if (r) Object.assign(r, updates);
        return r || null;
      }
    }
  };
  require.cache[watchdogPath] = {
    id: watchdogPath, filename: watchdogPath, loaded: true,
    exports: { sync: (target) => { watchdogCalls.push(target); } }
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

// ─────────────────────────────────────────────────────────────────────────────
// Persisted arm + missed-fire receipt: an in-process timer cannot fire while
// the app is dead, so the arm is written to settings at schedule time and the
// next launch turns a stale arm into an honest 'missed' receipt.
// ─────────────────────────────────────────────────────────────────────────────

test('scheduling persists the armed fire time and syncs the watchdog', () => {
  const autopilot = loadAutopilot({ bedtime: '23:59' });
  autopilot.schedule(() => ({ success: true }), fakeWindow());
  assert.ok(sections.app.autopilotNextFireAt, 'nextFireAt must be persisted');
  assert.equal(new Date(sections.app.autopilotNextFireAt).getHours(), 23);
  assert.equal(watchdogCalls.length >= 1, true);
  assert.ok(watchdogCalls[watchdogCalls.length - 1] instanceof Date, 'watchdog armed with the fire time');
  autopilot.cancel();
});

test('cancel clears the persisted arm and disarms the watchdog', () => {
  const autopilot = loadAutopilot({ bedtime: '23:59' });
  autopilot.schedule(() => ({ success: true }), fakeWindow());
  assert.ok(sections.app.autopilotNextFireAt);
  autopilot.cancel();
  assert.equal(sections.app.autopilotNextFireAt, null);
  assert.equal(watchdogCalls[watchdogCalls.length - 1], null, 'watchdog disarmed on cancel');
});

test('a fired autopilot clears its arm before re-arming (no false missed receipt)', () => {
  const autopilot = loadAutopilot({ bedtime: '23:59' }, daysAt('02:00', '02:00', '02:00'));
  withFakeTimers((timers) => {
    autopilot.schedule(() => ({ success: true }), fakeWindow());
    timers[timers.length - 1].cb(); // fire
    assert.ok(sections.app.autopilotNextFireAt, 're-arm writes a fresh fire time');
    assert.equal(receipts.filter(r => r.result === 'missed').length, 0, 'the just-fired night must not be recorded as missed');
  });
  autopilot.cancel();
});

test('a stale persisted arm at launch records an honest missed receipt', () => {
  const pastArm = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const autopilot = loadAutopilot({ bedtime: '23:59', autopilotNextFireAt: pastArm });
  const status = autopilot.schedule(() => ({ success: true }), fakeWindow());
  const missed = receipts.filter(r => r.result === 'missed');
  assert.equal(missed.length, 1);
  assert.equal(missed[0].startedAt, pastArm, 'receipt documents the armed fire time that was missed');
  assert.equal(missed[0].notes.includes('not running'), true);
  assert.equal(status.missedReceiptId, missed[0].id);
  autopilot.cancel();
});

test('a future persisted arm is not treated as missed', () => {
  const futureArm = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const autopilot = loadAutopilot({ bedtime: '23:59', autopilotNextFireAt: futureArm });
  autopilot.schedule(() => ({ success: true }), fakeWindow());
  assert.equal(receipts.filter(r => r.result === 'missed').length, 0);
  autopilot.cancel();
});
