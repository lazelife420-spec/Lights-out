// Regression test for NEW-001: timer must derive remaining time from wall-clock.
//
// Adjudication (2026-09-14, HEAD 268e6b0) discovered that the timer tick
// handler used `remainingSeconds - 1` (linear decrement) instead of deriving
// from the authoritative `endsAt` timestamp. After system sleep/wake, the
// countdown showed incorrect (too high) remaining time because setInterval
// callbacks pause during sleep.
//
// PRE-FIX: remainingSeconds = Math.max(0, remainingSeconds - 1)
//   → after 10-minute sleep, timer shows 10 minutes too many
// POST-FIX: remainingSeconds = Math.max(0, Math.round((endsAt - now) / 1000))
//   → self-correcting on every tick
//
// This test extracts and validates the derivation formula directly, plus
// verifies it via source-text inspection to ensure main.js uses the
// wall-clock pattern rather than linear decrement.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// --- SOURCE-LEVEL PROOF: tick handler uses endsAt derivation ---

test('tick handler derives remainingSeconds from endsAt, not linear decrement', () => {
  // The old defective pattern:
  const linearDecrement = /remainingSeconds\s*=\s*Math\.max\s*\(\s*0\s*,\s*(?:timerState\.)?remainingSeconds\s*-\s*1\s*\)/;
  assert.ok(!linearDecrement.test(mainSource), 'linear decrement pattern must NOT exist in main.js');

  // The fixed pattern (wall-clock derivation from endsAt):
  const wallClockDerivation = /remainingSeconds\s*=\s*Math\.max\s*\(\s*0\s*,\s*Math\.round\s*\(\s*\(new Date\(.*endsAt.*\)\.getTime\(\)\s*-\s*Date\.now\(\)\)\s*\/\s*1000\s*\)/;
  assert.ok(wallClockDerivation.test(mainSource), 'tick handler must derive remainingSeconds from endsAt wall-clock');
});

// --- FORMULA VALIDATION: the derivation produces correct values ---

test('normal ticking: derivation matches expected remaining seconds', () => {
  const totalSeconds = 1800; // 30 minutes
  const endsAt = new Date(Date.now() + totalSeconds * 1000).toISOString();
  // Simulate 1 second later.
  const oneSecLater = new Date(endsAt).getTime() - (Date.now() + 1000);
  const remaining = Math.max(0, Math.round(oneSecLater / 1000));
  assert.ok(remaining >= totalSeconds - 2 && remaining <= totalSeconds, `expected ~${totalSeconds - 1}, got ${remaining}`);
});

test('wake after short sleep: derivation skips elapsed sleep time', () => {
  const totalSeconds = 1800;
  const sleepSeconds = 600; // 10 minutes
  const endsAt = new Date(Date.now() + totalSeconds * 1000).toISOString();
  // Simulate waking up 10 minutes later (Date.now() has advanced).
  const simulatedNow = Date.now() + sleepSeconds * 1000;
  const remaining = Math.max(0, Math.round((new Date(endsAt).getTime() - simulatedNow) / 1000));
  assert.ok(remaining >= totalSeconds - sleepSeconds - 2 && remaining <= totalSeconds - sleepSeconds + 1,
    `expected ~${totalSeconds - sleepSeconds}, got ${remaining}`);
});

test('wake after deadline: derivation clamps to 0 (not negative)', () => {
  const endsAt = new Date(Date.now() - 60000).toISOString(); // 1 minute in the past
  const remaining = Math.max(0, Math.round((new Date(endsAt).getTime() - Date.now()) / 1000));
  assert.strictEqual(remaining, 0, 'must be 0 when deadline has passed');
});

test('wake exactly at deadline: derivation returns 0', () => {
  const endsAt = new Date(Date.now()).toISOString();
  const remaining = Math.max(0, Math.round((new Date(endsAt).getTime() - Date.now()) / 1000));
  assert.strictEqual(remaining, 0);
});

test('short event-loop stall: derivation self-corrects', () => {
  const totalSeconds = 300; // 5 minutes
  const stallMs = 3000; // 3 second stall
  const endsAt = new Date(Date.now() + totalSeconds * 1000).toISOString();
  const simulatedNow = Date.now() + stallMs;
  const remaining = Math.max(0, Math.round((new Date(endsAt).getTime() - simulatedNow) / 1000));
  assert.ok(remaining >= totalSeconds - 4 && remaining <= totalSeconds - 2,
    `expected ~${totalSeconds - 3}, got ${remaining}`);
});

// --- COMPLETION PATH: only one completion even if wake-after-deadline ---

test('source: completeTimer is called exactly when remainingSeconds <= 0', () => {
  // Verify the completion check exists and uses <= 0.
  const completionPattern = /if\s*\(\s*timerState\.remainingSeconds\s*<=\s*0\s*\)\s*\{?\s*\n?\s*completeTimer\s*\(/;
  assert.ok(completionPattern.test(mainSource), 'completion guard must check remainingSeconds <= 0');
});

test('source: completeTimer clears interval to prevent duplicate execution', () => {
  // Verify completeTimer calls clearTimerInterval.
  const fnMatch = mainSource.match(/function completeTimer\s*\(\)/);
  assert.ok(fnMatch, 'completeTimer function must exist');
  const fnStart = fnMatch.index;
  const fnBody = mainSource.slice(fnStart, fnStart + 2000);
  assert.ok(fnBody.includes('clearTimerInterval'), 'completeTimer must clear the interval');
});

// --- PAUSE/RESUME INTERACTION ---

test('resumeTimer recalculates endsAt from current remainingSeconds', () => {
  const resumePattern = /function resumeTimer[\s\S]*?endsAt\s*=\s*new Date\(Date\.now\(\)\s*\+\s*timerState\.remainingSeconds\s*\*\s*1000\)/;
  assert.ok(resumePattern.test(mainSource), 'resumeTimer must set endsAt = now + remainingSeconds * 1000');
});

// --- NEGATIVE CONTROL: wall-clock change ---

test('wall-clock forward jump (NTP correction) is equivalent to sleep', () => {
  const totalSeconds = 1800;
  const jumpSeconds = 120; // 2-minute NTP forward jump
  const endsAt = new Date(Date.now() + totalSeconds * 1000).toISOString();
  const simulatedNow = Date.now() + jumpSeconds * 1000;
  const remaining = Math.max(0, Math.round((new Date(endsAt).getTime() - simulatedNow) / 1000));
  assert.ok(remaining >= totalSeconds - jumpSeconds - 2 && remaining <= totalSeconds - jumpSeconds + 1,
    'forward clock jump reduces remaining time correctly');
});

test('wall-clock backward jump (NTP correction) temporarily adds time', () => {
  const totalSeconds = 1800;
  const jumpSeconds = 30; // 30-second backward jump
  const endsAt = new Date(Date.now() + totalSeconds * 1000).toISOString();
  const simulatedNow = Date.now() - jumpSeconds * 1000;
  const remaining = Math.max(0, Math.round((new Date(endsAt).getTime() - simulatedNow) / 1000));
  assert.ok(remaining >= totalSeconds + jumpSeconds - 1 && remaining <= totalSeconds + jumpSeconds + 1,
    'backward clock jump temporarily shows more remaining time');
});
