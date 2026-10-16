'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-metrics-'));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => tempDir } };
  return originalLoad.call(this, request, parent, isMain);
};
const streaks = require('../streaks');
const deficit = require('../sleepDebt');
Module._load = originalLoad;

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('Estimated Bedtime Deficit is explicitly an app-timer estimate', () => {
  assert.equal(deficit.estimateSleepHours('23:30', '07:00'), 7.5);
  const entry = deficit.recordNight('23:30', '07:00', 7.5);
  assert.equal(entry.debt, 0.5);
  assert.equal(entry.measurement, 'timer_estimate');
  const summary = deficit.getDebtSummary();
  assert.equal(summary.isMeasuredSleep, false);
  assert.match(summary.basis, /not measured sleep/i);
});

// Local night key N whole calendar nights before the (frozen) current night.
function nightDaysAgo(days) {
  const [y, m, d] = streaks.nightKey().split('-').map(Number);
  const x = new Date(y, m - 1, d - days);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

test('Completion count, completion streak, and routine score come only from app events', () => {
  // Frozen local noon: no midnight/6 AM boundary can shift the night keys.
  mock.timers.enable({ apis: ['Date'], now: new Date(2024, 0, 10, 12, 0, 0).getTime() });
  try {
    const events = [
      { date: nightDaysAgo(2), bedTime: '22:30', snoozed: false, action: 'shutdown', source: 'real' },
      { date: nightDaysAgo(1), bedTime: '22:45', snoozed: true, action: 'shutdown', source: 'real' },
      { date: nightDaysAgo(0), bedTime: '22:50', snoozed: false, action: 'shutdown', source: 'real' }
    ];
    // Seed a deliberately wrong stored streak: the read-time value must ignore it.
    streaks.replaceAll({ events, streak: 99, bestStreak: 0, achievements: [] });
    const expectedStreak = streaks.currentStreak(events);
    assert.equal(expectedStreak, 3, 'three consecutive nights ending tonight form a 3-night streak');
    const summary = streaks.getSummary();
    assert.equal(summary.totalNights, 3, 'Completed Runs must equal stored completion events');
    assert.equal(summary.streak, expectedStreak, 'Completion Streak must be derived from the events at read time');
    const score = streaks.getSleepScore();
    assert.ok(Number.isInteger(score.score));
    assert.deepEqual(Object.keys(score.breakdown), ['consistency', 'onTime', 'noSnooze', 'ritual']);
    assert.equal(score.breakdown.ritual.streak, expectedStreak);
  } finally {
    mock.timers.reset();
  }
});

test('Before 11 PM and weekly on-time use the real 23:00 boundary', () => {
  // getTrend() buckets by ISO week (Monday-start); three consecutive nights
  // only land in a single bucket if tonight isn't within 2 days of a Monday.
  // Freeze the clock to local noon on Wed 2024-01-10, so the nights are
  // Mon-Wed in every time zone and this never fails on real-world timing.
  mock.timers.enable({ apis: ['Date'], now: new Date(2024, 0, 10, 12, 0, 0).getTime() });
  try {
    const events = [
      { date: nightDaysAgo(2), bedTime: '22:59', snoozed: false, source: 'real' },
      { date: nightDaysAgo(1), bedTime: '23:00', snoozed: false, source: 'real' },
      { date: nightDaysAgo(0), bedTime: '23:01', snoozed: false, source: 'real' }
    ];
    const week = streaks.getWeekStats(events);
    assert.deepEqual(week.days.map(day => day.onTime), [true, false, false]);
    assert.equal(week.onTimePercent, 33);
    streaks.replaceAll({ events, streak: 0, bestStreak: 0, achievements: [] });
    assert.equal(streaks.getTrend('week', 1)[0].onTimePercent, 33);
  } finally {
    mock.timers.reset();
  }
});
