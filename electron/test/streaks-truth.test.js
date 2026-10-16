'use strict';

// Honest records (UI-R3 P02): the routine record -- streak, completed runs,
// achievements, snooze rate, bedtime-deficit estimate -- counts only REAL
// completions. Test Mode runs stay in Proof (their receipts) and never become
// a kept night.
//
// The real completeTimer() body from main.js runs in a vm sandbox whose
// playLastLightRitual/executePowerAction are recording mocks: no power action
// can execute from this file. All clocks are frozen at local times.

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-streaks-truth-'));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => tempDir } };
  return originalLoad.call(this, request, parent, isMain);
};
const streaks = require('../streaks');
const sleepDebt = require('../sleepDebt');
const emergencyOverride = require('../emergencyOverride');

// Modules resolve require('electron') lazily on save, so the mock stays in
// place for the whole file: every write lands in tempDir, never os.tmpdir().
test.after(() => {
  Module._load = originalLoad;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found in main.js`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length;
  let parenDepth = 1;
  while (parenDepth > 0 && i < source.length) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') parenDepth--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

// Frozen LOCAL wall-clock instants (month is 0-based).
const LOCAL_NOON = new Date(2024, 0, 10, 12, 0, 0).getTime();
function freeze(ms) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: ms });
}

function key(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const pad = n => String(n).padStart(2, '0');

// How an OLD build stored a run (before source:'real'): date = the UTC date of
// the moment it was written, bedTime = the local time of that same moment.
// Fixtures built this way mean the same thing in every time zone.
function legacyAt(y, m, d, hh, mm, extra = {}) {
  const at = new Date(y, m - 1, d, hh, mm);
  return { date: at.toISOString().slice(0, 10), bedTime: `${pad(hh)}:${pad(mm)}`, action: 'shutdown', snoozed: false, ...extra };
}

function resetStores() {
  streaks.replaceAll({ events: [], streak: 0, bestStreak: 0, achievements: [] });
  const debt = sleepDebt._load();
  debt.dailyLog = [];
}

function runCompleteTimer({ dryRun, receipt }) {
  const calls = [];
  const receipts = new Map(receipt ? [[receipt.id, { ...receipt }]] : []);
  const sandbox = {
    console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout,
    timerState: { running: true, paused: false, remainingSeconds: 3, endsAt: 'x', phase: 'warning', action: 'shutdown', dryRun },
    activeReceiptId: receipt ? receipt.id : null,
    mainWindow: null,
    clearTimerInterval: () => {},
    setTaskbarProgress: () => {},
    persistActiveTimer: () => {},
    restoreAfterTimer: () => {},
    smartLights: { getConfig: () => ({ enabled: false }) },
    emitTimerUpdate: () => {},
    showNativeNotification: () => {},
    formatAction: a => a,
    sendAccountability: type => calls.push(`accountability:${type}`),
    settingsStore: { getSection: section => (section === 'app' ? { wakeTime: '07:00' } : {}) },
    runReceipts: {
      getReceiptById: id => receipts.get(id) || null,
      updateRunReceipt: (id, updates) => { calls.push(`receipt:${updates.result}`); Object.assign(receipts.get(id) || {}, updates); }
    },
    unsavedGuard: { scanUnsavedWork: async () => [] },
    streaks,
    sleepDebt,
    playLastLightRitual: async flag => { calls.push(`lastLight:${flag}`); },
    executePowerAction: async state => { calls.push(`power:${state.dryRun}`); }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(`${extractFunction(mainSource, 'completeTimer')}\nthis.__run = completeTimer;`, context);
  return context.__run().then(() => ({ calls, receipts }));
}

test('a Test Mode completion adds no streak event and no deficit night, but keeps its receipt and power order', async () => {
  freeze(LOCAL_NOON);
  try {
    resetStores();
    const before = streaks.getSummary();
    const { calls, receipts } = await runCompleteTimer({ dryRun: true, receipt: { id: 'r1', snoozeCount: 0 } });
    const after = streaks.getSummary();
    assert.equal(streaks.exportData().events.length, 0, 'no event recorded for a Test Mode run');
    assert.equal(after.streak, before.streak);
    assert.equal(after.totalNights, before.totalNights);
    assert.deepEqual(after.achievements, before.achievements);
    assert.equal(sleepDebt._load().dailyLog.length, 0, 'no deficit night recorded for a Test Mode run');
    assert.equal(receipts.get('r1').result, 'dry_run_completed');
    assert.deepEqual(calls, ['receipt:dry_run_completed', 'accountability:TIMER_COMPLETE', 'lastLight:true', 'power:true']);
  } finally {
    mock.timers.reset();
  }
});

test('a real completion records one source:real event with the receipt snooze flag', async () => {
  freeze(LOCAL_NOON);
  try {
    resetStores();
    const { calls } = await runCompleteTimer({ dryRun: false, receipt: { id: 'r2', snoozeCount: 2 } });
    const events = streaks.exportData().events;
    assert.equal(events.length, 1);
    assert.deepEqual({ ...events[0], bedTime: 'x' }, { date: key(2024, 1, 10), bedTime: 'x', action: 'shutdown', snoozed: true, source: 'real' });
    assert.ok(streaks.getWeeklyReport().snoozeRate > 0, 'a snoozed real night shows in the snooze rate');
    assert.equal(sleepDebt._load().dailyLog.length, 1, 'a real night records its deficit estimate');
    assert.deepEqual(calls, ['receipt:completing', 'accountability:TIMER_COMPLETE', 'lastLight:false', 'power:false']);

    resetStores();
    await runCompleteTimer({ dryRun: false, receipt: { id: 'r3', snoozeCount: 0 } });
    assert.equal(streaks.exportData().events[0].snoozed, false);
  } finally {
    mock.timers.reset();
  }
});

test('executeOverride writes no streak or deficit record for a Test Mode run, but does for a real one', async () => {
  freeze(LOCAL_NOON);
  try {
    resetStores();
    await emergencyOverride.executeOverride('testing', { dryRun: true, remainingSeconds: 60, phase: 'warning' });
    assert.equal(streaks.exportData().events.length, 0);
    assert.equal(sleepDebt._load().dailyLog.length, 0);

    await emergencyOverride.executeOverride('staying up', { dryRun: false, remainingSeconds: 60, phase: 'warning' });
    const events = streaks.exportData().events;
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'override');
    assert.equal(sleepDebt._load().dailyLog.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('a 00:30 run counts for the previous night', () => {
  assert.equal(streaks.nightKey(new Date(2024, 0, 11, 0, 30)), key(2024, 1, 10));
  assert.equal(streaks.nightKey(new Date(2024, 0, 11, 5, 59)), key(2024, 1, 10));
  assert.equal(streaks.nightKey(new Date(2024, 0, 11, 6, 0)), key(2024, 1, 11));
  assert.equal(streaks.nightKey(new Date(2024, 0, 10, 23, 30)), key(2024, 1, 10));

  freeze(new Date(2024, 0, 11, 0, 30).getTime());
  try {
    resetStores();
    streaks.recordEvent('00:30', 'shutdown', false);
    assert.equal(streaks.exportData().events[0].date, key(2024, 1, 10));
  } finally {
    mock.timers.reset();
  }
});

test('the streak is computed at read time: a run whose newest night is older than yesterday reads 0', () => {
  const events = [
    { date: key(2024, 1, 5), bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' },
    { date: key(2024, 1, 6), bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' },
    { date: key(2024, 1, 7), bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' }
  ];
  const now = new Date(LOCAL_NOON); // night of 2024-01-10
  assert.equal(streaks.currentStreak(events, now), 0, 'three nights ago is a broken streak');
  assert.equal(streaks.currentStreak(events, new Date(2024, 0, 8, 12)), 3, 'last night keeps it alive');
  assert.equal(streaks.currentStreak(events, new Date(2024, 0, 7, 21)), 3, 'tonight keeps it alive');

  freeze(LOCAL_NOON);
  try {
    // A stale stored streak value is never returned.
    streaks.replaceAll({ events, streak: 3, bestStreak: 3, achievements: [] });
    const cached = streaks._load();
    cached.streak = 3; // simulate a value frozen at write time by an old build
    assert.equal(streaks.getSummary().streak, 0);
    assert.equal(streaks.getWeeklyReport().streak, 0);
    assert.equal(streaks.getSummary().bestStreak, 3, 'bestStreak survives a broken streak');
  } finally {
    mock.timers.reset();
  }
});

test('a Test-Mode-only history gives totalNights 0, streak 0, no achievements and no filled history cells', () => {
  freeze(LOCAL_NOON);
  try {
    const events = [8, 9, 10].map(d => ({ date: key(2024, 1, d), bedTime: '22:00', action: 'lastlight', snoozed: false, testMode: true }));
    streaks.replaceAll({ events, streak: 3, bestStreak: 3, achievements: ['first_light', '3_night_streak'] });
    // Simulate a file written by an old build: stale stored numbers.
    Object.assign(streaks._load(), { streak: 3, bestStreak: 3, achievements: ['first_light', '3_night_streak'] });
    const summary = streaks.getSummary();
    assert.equal(summary.totalNights, 0);
    assert.equal(summary.streak, 0);
    assert.equal(summary.bestStreak, 0, 'a stored bestStreak the counted events cannot back is not shown');
    assert.deepEqual(summary.achievements, []);
    const report = streaks.getWeeklyReport();
    assert.equal(report.nightsThisWeek, 0);
    assert.deepEqual(report.actionCounts, {});
    assert.equal(report.testModeRunsThisWeek, 3);
    assert.match(report.narrative, /^No real completions this week\. Test Mode runs are recorded in Proof but don't count toward your routine\./);
    assert.equal(streaks.getHistory30().filter(day => day.hasEvent).length, 0, 'a Test-Mode-only night is not a filled cell');
    assert.equal(streaks.getTrend('week').length, 0);
    assert.equal(streaks.getSleepScore().score, null);
    // The flagged events are kept, never deleted.
    assert.equal(streaks.exportData().events.length, 3);
  } finally {
    mock.timers.reset();
  }
});

test('Test Mode receipts this week are acknowledged in the report without counting as nights', () => {
  freeze(LOCAL_NOON);
  try {
    resetStores();
    const receipts = [
      { result: 'dry_run_completed', dryRun: true, endedAt: new Date(2024, 0, 9, 22, 0).toISOString() },
      { result: 'dry_run_completed', dryRun: true, endedAt: new Date(2023, 11, 1, 22, 0).toISOString() }, // outside the week
      { result: 'cancelled', dryRun: true, endedAt: new Date(2024, 0, 9, 21, 0).toISOString() },
      { result: 'completing', dryRun: false, endedAt: new Date(2024, 0, 8, 22, 0).toISOString() }
    ];
    const report = streaks.getWeeklyReport({ receipts });
    assert.equal(report.testModeRunsThisWeek, 1);
    assert.equal(report.nightsThisWeek, 0);
    assert.match(report.narrative, /^No real completions this week\./);
    // With no Test Mode runs at all, the original empty wording stays.
    assert.match(streaks.getWeeklyReport().narrative, /^No nights logged this week/);
  } finally {
    mock.timers.reset();
  }
});

test('legacy events (no source) stay counted and keep their dates; achievements are rebuilt, never unioned', () => {
  freeze(LOCAL_NOON);
  try {
    const legacy = [legacyAt(2024, 1, 8, 22, 0), legacyAt(2024, 1, 9, 22, 0)];
    streaks.replaceAll({ events: legacy, streak: 0, bestStreak: 0, achievements: [] });
    const cached = streaks._load();
    cached.achievements = ['centurion', '30_night_streak']; // stale union from an old build
    const summary = streaks.getSummary();
    assert.equal(summary.totalNights, 2);
    assert.equal(summary.streak, 2);
    assert.deepEqual(summary.achievements, ['first_light']);

    streaks.recordEvent('22:15', 'shutdown', false);
    const events = streaks.exportData().events;
    assert.deepEqual(events.slice(0, 2), legacy, 'legacy events are never rewritten');
    assert.equal(events[2].source, 'real');
    assert.equal(streaks.getSummary().streak, 3);
    assert.deepEqual(streaks.getSummary().achievements, ['first_light', '3_night_streak'], 'read-time achievements rebuilt from an empty list');
    // The stored list is never narrowed by a write (older builds read it);
    // it only gains newly earned ids, and reads never show the stale ones.
    assert.deepEqual(streaks.exportData().achievements, ['centurion', '30_night_streak', 'first_light', '3_night_streak']);
  } finally {
    mock.timers.reset();
  }
});

test('a real completion never deletes a legacy event whose UTC key collides with tonight, and every count is per night', () => {
  // An old build keyed a 23:00 run in a UTC-negative zone to the NEXT UTC
  // day, so last night's legacy event can carry tonight's local night key.
  // Read-time night mapping keeps it on its own night: nothing is deleted and
  // nothing is counted twice.
  freeze(LOCAL_NOON); // night of 2024-01-10
  try {
    const legacy = [legacyAt(2024, 1, 7, 23, 0), legacyAt(2024, 1, 8, 23, 0), legacyAt(2024, 1, 9, 23, 0)];
    streaks.replaceAll({ events: legacy });
    assert.equal(streaks.getSummary().totalNights, 3);
    assert.equal(streaks.getSummary().streak, 3);

    streaks.recordEvent('19:15', 'shutdown', false);
    let events = streaks.exportData().events;
    assert.deepEqual(events.slice(0, 3), legacy, 'every legacy event is still on disk, unchanged');
    assert.equal(events.length, 4);
    assert.deepEqual({ ...events[3], bedTime: 'x' }, { date: key(2024, 1, 10), bedTime: 'x', action: 'shutdown', snoozed: false, source: 'real' });
    const summary = streaks.getSummary();
    assert.equal(summary.totalNights, 4, 'four distinct nights');
    assert.equal(summary.streak, 4, 'last night\'s legacy run keeps the streak going');
    assert.deepEqual(summary.weekDays.map(d => d.date), [key(2024, 1, 7), key(2024, 1, 8), key(2024, 1, 9), key(2024, 1, 10)]);
    const report = streaks.getWeeklyReport();
    assert.equal(report.nightsThisWeek, 4);
    assert.equal(report.legacyNightsThisWeek, 3);
    assert.match(report.narrative, /^4 of the last 7 nights logged \(4 total since you started\)\./);

    // A later REAL completion the same night still replaces only the earlier
    // REAL event (one real event per night), never a legacy one.
    streaks.recordEvent('21:40', 'sleep', true);
    events = streaks.exportData().events;
    assert.equal(events.length, 4);
    assert.deepEqual(events.slice(0, 3), legacy);
    assert.equal(events[3].action, 'sleep');
    assert.equal(events.filter(e => e.source === 'real').length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('a legacy run and a real run on the SAME night count as one night (the real one)', () => {
  freeze(LOCAL_NOON);
  try {
    const legacy = [legacyAt(2024, 1, 10, 11, 0, { action: 'sleep' })]; // written earlier tonight by an old build
    streaks.replaceAll({ events: legacy });
    streaks.recordEvent('12:00', 'shutdown', false);
    assert.equal(streaks.exportData().events.length, 2, 'both stay on disk');
    const summary = streaks.getSummary();
    assert.equal(summary.totalNights, 1);
    assert.equal(summary.streak, 1);
    assert.equal(summary.weekDays.length, 1);
    const report = streaks.getWeeklyReport();
    assert.equal(report.nightsThisWeek, 1);
    assert.deepEqual(report.realActionCounts, { shutdown: 1 });
    assert.equal(report.legacyNightsThisWeek, 0);
    assert.equal(streaks.getHistory30().filter(d => d.hasEvent).length, 1);
  } finally {
    mock.timers.reset();
  }
});

// The reviewer's repro: a daily 23:00 user upgrades, then runs once more.
// Spawned per time zone (TZ must be set before the process starts).
const TZ_CHILD = `
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-streaks-tz-'));
const ol = Module._load;
Module._load = function (r, p, i) { if (r === 'electron') return { app: { getPath: () => dir } }; return ol.call(this, r, p, i); };
const { mock } = require('node:test');
mock.timers.enable({ apis: ['Date'], now: new Date(2024, 0, 10, 20, 0).getTime() });
try {
  const streaks = require(process.env.STREAKS_PATH);
  const events = [];
  for (let i = 7; i >= 1; i--) {
    const at = new Date(2024, 0, 10 - i, 23, 0);
    events.push({ date: at.toISOString().slice(0, 10), bedTime: '23:00', action: 'shutdown', snoozed: false });
  }
  streaks.replaceAll({ events });
  streaks.recordEvent('20:00', 'shutdown', false);
  const r = streaks.getWeeklyReport();
  const s = streaks.getSummary();
  process.stdout.write('\\nRESULT ' + JSON.stringify({ nightsThisWeek: r.nightsThisWeek, legacy: r.legacyNightsThisWeek, narrative: r.narrative, streak: s.streak, total: s.totalNights, weekDays: s.weekDays.length, stored: streaks.exportData().events.length }) + '\\n');
} finally {
  mock.timers.reset();
  fs.rmSync(dir, { recursive: true, force: true });
}
`;

for (const tz of ['America/New_York', 'America/Adak', 'UTC', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
  test(`TZ=${tz}: a week of legacy nights plus tonight's real run never reads more than 7 of the last 7 nights`, () => {
    const { spawnSync } = require('node:child_process');
    const out = spawnSync(process.execPath, ['-e', TZ_CHILD], {
      env: { ...process.env, TZ: tz, STREAKS_PATH: path.join(__dirname, '..', 'streaks.js') },
      encoding: 'utf8'
    });
    assert.equal(out.status, 0, out.stderr);
    const line = out.stdout.split('\n').find(l => l.startsWith('RESULT '));
    assert.ok(line, out.stdout);
    const r = JSON.parse(line.slice('RESULT '.length));
    assert.equal(r.stored, 8, 'nothing deleted');
    assert.ok(r.nightsThisWeek <= 7, `nightsThisWeek ${r.nightsThisWeek}`);
    assert.equal(r.nightsThisWeek, 7);
    assert.equal(r.legacy, 6);
    assert.ok(r.weekDays <= 7);
    assert.equal(r.total, 8);
    assert.equal(r.streak, 8, 'eight consecutive nights');
    const m = /(\d+) of the last 7 nights/.exec(r.narrative);
    assert.ok(m && Number(m[1]) <= 7, r.narrative);
    assert.match(r.narrative, /^7 of the last 7 nights logged \(8 total since you started\)\./);
    assert.match(r.narrative, /Real-mode completions: 1 shutdown\./);
    assert.match(r.narrative, /6 logged nights were recorded before Test Mode tracking\./);
  });
}

test('a mixed legacy + Test Mode receipt week is reported neutrally, never as Real-mode or double-counted', () => {
  freeze(LOCAL_NOON);
  try {
    // An old build wrote an unflagged event for tonight's Test Mode run,
    // keyed by the run's UTC date; its dry-run receipt describes the same run.
    const endedAt = new Date(2024, 0, 10, 11, 0).toISOString();
    streaks.replaceAll({ events: [{ date: endedAt.slice(0, 10), bedTime: '11:00', action: 'shutdown', snoozed: false }] });
    const receipts = [{ result: 'dry_run_completed', dryRun: true, startedAt: endedAt, endedAt }];
    const report = streaks.getWeeklyReport({ receipts });
    assert.equal(report.legacyNightsThisWeek, 1);
    assert.deepEqual(report.realActionCounts, {});
    assert.equal(report.testModeRunsThisWeek, 0, 'the receipt is the same run as the counted legacy night');
    assert.doesNotMatch(report.narrative, /Real-mode completions/);
    assert.doesNotMatch(report.narrative, /not counted/);
    assert.match(report.narrative, /1 logged night was recorded before Test Mode tracking\./);

    // Add a REAL run on the NEXT night: only that one is called Real-mode.
    // (A real run on the same night as the legacy one would count as that
    // night instead; see the same-night test above.)
    freeze(new Date(2024, 0, 11, 12, 0).getTime());
    streaks.recordEvent('22:00', 'sleep', false);
    const mixed = streaks.getWeeklyReport({ receipts });
    assert.deepEqual(mixed.realActionCounts, { sleep: 1 });
    assert.match(mixed.narrative, /Real-mode completions: 1 sleep\./);
    assert.match(mixed.narrative, /1 logged night was recorded before Test Mode tracking\./);

    // A later Test Mode run the same UTC day (a different run: the legacy
    // event's bedTime is the moment it was written) is still acknowledged,
    // and each legacy event accounts for at most one receipt.
    const later = new Date(2024, 0, 10, 11, 20).toISOString();
    const sameDay = streaks.getWeeklyReport({ receipts: [...receipts, { result: 'dry_run_completed', dryRun: true, endedAt: later }, { result: 'dry_run_completed', dryRun: true, endedAt: endedAt }] });
    assert.equal(sameDay.testModeRunsThisWeek, 2);

    // A Test Mode receipt on a night with no legacy event is still acknowledged.
    const other = new Date(2024, 0, 8, 21, 0).toISOString();
    const withOther = streaks.getWeeklyReport({ receipts: [...receipts, { result: 'dry_run_completed', dryRun: true, endedAt: other }] });
    assert.equal(withOther.testModeRunsThisWeek, 1);
    assert.match(withOther.narrative, /1 Test Mode run this week is recorded in Proof and not counted\./);
  } finally {
    mock.timers.reset();
  }
});

test('the override modal claims no streak consequence in Test Mode and does not overstate one in Real mode', () => {
  freeze(LOCAL_NOON);
  try {
    streaks.replaceAll({
      events: [9, 10].map(d => ({ date: key(2024, 1, d), bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' }))
    });
    assert.equal(streaks.getSummary().streak, 2);
    const test = emergencyOverride.getOverrideConsequences({ dryRun: true });
    assert.equal(test.consequences.filter(c => c.type === 'streak').length, 0, 'a Test Mode override writes nothing to the record');
    // The modal never opens on an empty list, so Test Mode always carries its
    // own labelled line (and the modal states its mode itself).
    const testLine = test.consequences.find(c => c.type === 'testMode');
    assert.ok(testLine && /^Test Mode: nothing is written/.test(testLine.message));
    const real = emergencyOverride.getOverrideConsequences({ dryRun: false });
    assert.equal(real.consequences.filter(c => c.type === 'testMode').length, 0);
    const streakLine = real.consequences.find(c => c.type === 'streak');
    assert.ok(streakLine, 'a real override is logged');
    assert.doesNotMatch(streakLine.message, /broken/i, 'a real override keeps the streak going');
    assert.match(streakLine.message, /logged as an override/);
  } finally {
    mock.timers.reset();
  }
});

test('getWeekStats() with no argument reads the stored counted events', () => {
  freeze(LOCAL_NOON);
  try {
    streaks.replaceAll({
      events: [
        { date: key(2024, 1, 9), bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' },
        { date: key(2024, 1, 10), bedTime: '22:30', action: 'shutdown', snoozed: false, testMode: true }
      ]
    });
    const week = streaks.getWeekStats();
    assert.equal(week.days.length, 1);
    assert.equal(week.avgBedTime, '22:00');
  } finally {
    mock.timers.reset();
  }
});

test('replaceAll round-trips source, testMode and truthVersion and recomputes imported streak values', () => {
  freeze(LOCAL_NOON);
  try {
    const input = {
      events: [
        { date: key(2024, 1, 1), bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' },
        { date: key(2024, 1, 2), bedTime: '22:00', action: 'shutdown', snoozed: false, testMode: true },
        legacyAt(2024, 1, 9, 22, 0, { snoozed: true }),
        { date: key(2024, 1, 10), bedTime: '22:00', action: 'sleep', snoozed: false, source: 'real' }
      ],
      streak: 40,
      bestStreak: 120,
      truthVersion: 2,
      achievements: ['centurion']
    };
    streaks.replaceAll(input);
    const exported = streaks.exportData();
    assert.equal(exported.truthVersion, 2);
    assert.equal(exported.events[0].source, 'real');
    assert.equal(exported.events[1].testMode, true);
    assert.equal(exported.bestStreak, 2, 'bestStreak recomputed from counted events, never trusted');
    assert.equal(exported.streak, 2);
    assert.deepEqual(exported.achievements, ['first_light']);

    streaks.replaceAll({ events: [] });
    streaks.replaceAll(exported);
    assert.deepEqual(streaks.exportData(), exported, 'export -> import is lossless');
  } finally {
    mock.timers.reset();
  }
});
