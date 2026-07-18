'use strict';

const test = require('node:test');
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

function dateDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

test('Estimated Bedtime Deficit is explicitly an app-timer estimate', () => {
  assert.equal(deficit.estimateSleepHours('23:30', '07:00'), 7.5);
  const entry = deficit.recordNight('23:30', '07:00', 7.5);
  assert.equal(entry.debt, 0.5);
  assert.equal(entry.measurement, 'timer_estimate');
  const summary = deficit.getDebtSummary();
  assert.equal(summary.isMeasuredSleep, false);
  assert.match(summary.basis, /not measured sleep/i);
});

test('Completion count, completion streak, and routine score come only from app events', () => {
  const events = [
    { date: dateDaysAgo(2), bedTime: '22:30', snoozed: false, action: 'dry_run' },
    { date: dateDaysAgo(1), bedTime: '22:45', snoozed: true, action: 'dry_run' },
    { date: dateDaysAgo(0), bedTime: '22:50', snoozed: false, action: 'dry_run' }
  ];
  streaks.replaceAll({ events, streak: 3, bestStreak: 3, achievements: [] });
  const summary = streaks.getSummary();
  assert.equal(summary.totalNights, 3, 'Completed Runs must equal stored completion events');
  assert.equal(summary.streak, 3, 'Completion Streak must come from completion-event state');
  const score = streaks.getSleepScore();
  assert.ok(Number.isInteger(score.score));
  assert.deepEqual(Object.keys(score.breakdown), ['consistency', 'onTime', 'noSnooze', 'ritual']);
});

test('Before 11 PM and weekly on-time use the real 23:00 boundary', () => {
  const events = [
    { date: dateDaysAgo(2), bedTime: '22:59', snoozed: false },
    { date: dateDaysAgo(1), bedTime: '23:00', snoozed: false },
    { date: dateDaysAgo(0), bedTime: '23:01', snoozed: false }
  ];
  const week = streaks.getWeekStats(events);
  assert.deepEqual(week.days.map(day => day.onTime), [true, false, false]);
  assert.equal(week.onTimePercent, 33);
  streaks.replaceAll({ events, streak: 0, bestStreak: 0, achievements: [] });
  assert.equal(streaks.getTrend('week', 1)[0].onTimePercent, 33);
});
