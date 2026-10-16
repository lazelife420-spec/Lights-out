'use strict';

// Test Mode inheritance for timer starts that do not state dryRun.
//
// normalizeTimerOptions() used to turn an omitted dryRun into false, so every
// start path that did not pass it -- calendar auto-start, the Schedule
// "Start" buttons, the tray "Start 28 min / 1 hour" items, the Ctrl+Shift+L
// and Ctrl+Shift+1..4 quick starts, and the launch-option timer -- armed a
// REAL power action even while the user had Test Mode on. An omitted flag now
// inherits the persisted Test Mode setting; an explicit flag still wins.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const calendarSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-calendar.js'), 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found`);
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

function normalizeWith(appSettings) {
  const context = vm.createContext({
    settingsStore: { getSection: section => (section === 'app' ? appSettings : null) }
  });
  vm.runInContext(`${extractFunction(mainSource, 'normalizeTimerOptions')}\nthis.normalize = normalizeTimerOptions;`, context);
  return context.normalize;
}

test('an omitted dryRun inherits Test Mode ON from settings', () => {
  const normalize = normalizeWith({ dryRun: true });
  assert.equal(normalize({ durationSeconds: 60, action: 'shutdown' }).dryRun, true);
});

test('an omitted dryRun with Test Mode OFF stays a real run', () => {
  const normalize = normalizeWith({ dryRun: false });
  assert.equal(normalize({ durationSeconds: 60, action: 'shutdown' }).dryRun, false);
});

test('an explicit dryRun always wins over the setting', () => {
  assert.equal(normalizeWith({ dryRun: true })({ durationSeconds: 60, dryRun: false }).dryRun, false);
  assert.equal(normalizeWith({ dryRun: false })({ durationSeconds: 60, dryRun: true }).dryRun, true);
});

test('with no app settings section the documented default (Test Mode off) applies', () => {
  assert.equal(normalizeWith(null)({ durationSeconds: 60 }).dryRun, false);
});

test('the legacy numeric form inherits Test Mode ON, like an object that omits dryRun', () => {
  const normalized = normalizeWith({ dryRun: true })(15);
  assert.equal(normalized.dryRun, true);
  assert.equal(normalized.forceShutdown, false);
  assert.equal(normalized.durationSeconds, 900);
});

test('the legacy numeric form with Test Mode OFF stays a real run', () => {
  assert.equal(normalizeWith({ dryRun: false })(15).dryRun, false);
});

test('an explicit dryRun:false object stays false while the setting is on', () => {
  assert.equal(normalizeWith({ dryRun: true })({ durationSeconds: 600, action: 'shutdown', dryRun: false }).dryRun, false);
});

test('run origin defaults to this-pc and an unknown origin falls back to it', () => {
  const normalize = normalizeWith({ dryRun: true });
  assert.equal(normalize({ durationSeconds: 60 }).origin, 'this-pc');
  assert.equal(normalize({ durationSeconds: 60, origin: 'nonsense' }).origin, 'this-pc');
  assert.equal(normalize({ durationSeconds: 60, origin: 42 }).origin, 'this-pc');
  assert.equal(normalize({ durationSeconds: 60, origin: 'schedule' }).origin, 'schedule');
  assert.equal(normalize({ durationSeconds: 60, origin: 'phone' }).origin, 'phone');
  assert.equal(normalize(15).origin, 'this-pc');
});

test('calendar auto-start passes Test Mode read from the app settings', () => {
  const body = extractFunction(mainSource, 'checkCalendarAutoStart');
  assert.match(body, /const appSettings = settingsStore\.getSection\('app'\) \|\| \{\};/);
  assert.match(body, /startTimer\(\{[^}]*dryRun: Boolean\(appSettings\.dryRun \|\| profile\?\.dryRun\)[^}]*\}\)/);
  assert.match(body, /if \(isRunActive\(\)\) return;/);
});

test('the manual Begin Ritual fallback countdown carries Test Mode and the grace warning from app settings', () => {
  const block = mainSource.match(/const app = settingsStore\.getSection\('app'\) \|\| \{\};\s*const config = ritualMode\.getConfig\(\);\s*beginValidatedCountdown\(\s*\{[^}]*\}/);
  assert.ok(block, 'manual ritual fallback literal not found');
  assert.match(block[0], /dryRun: Boolean\(app\.dryRun\)/);
  assert.match(block[0], /forceShutdown: false/);
  assert.match(block[0], /gracePeriod: Number\.isFinite\(Number\(app\.graceMinutes\)\) \? Number\(app\.graceMinutes\) : 2/);
  assert.match(block[0], /origin: 'ritual'/);
});

test('autopilot reads the app settings at fire time, inside the timeout', () => {
  const autopilotSource = fs.readFileSync(path.join(__dirname, '..', 'autopilot.js'), 'utf8');
  const fireIndex = autopilotSource.indexOf('autopilotTimeout = setTimeout(');
  assert.ok(fireIndex > 0, 'autopilot timeout not found');
  const fireBody = autopilotSource.slice(fireIndex, autopilotSource.indexOf('}, msUntilTarget);', fireIndex));
  assert.match(fireBody, /settingsStore\.getSection\('app'\)/);
  assert.match(fireBody, /dryRun: Boolean\(fireSettings\.dryRun\)/);
  assert.match(fireBody, /if \(result && result\.success/, 'autopilot-started must only be sent for a real start');
});

test('no start path hard-codes REAL, and startTimer still normalizes through the inheriting rule', () => {
  // The quick starts now go through startQuickTimer() (which omits dryRun and
  // so inherits Test Mode); no literal anywhere may force dryRun:false.
  assert.doesNotMatch(mainSource, /startTimer\(\{[^}]*dryRun:\s*false/);
  assert.doesNotMatch(calendarSource, /api\.startTimer\(\{[^}]*dryRun:\s*false/);
  assert.match(extractFunction(mainSource, 'startTimer'), /normalizeTimerOptions\(input, legacyAction\)/);
});

test('an omitted grace period stays undefined so the countdown inherits the graceMinutes setting', () => {
  const normalize = normalizeWith({ dryRun: true, graceMinutes: 5 });
  assert.equal(normalize({ durationSeconds: 600 }).gracePeriod, undefined);
  assert.equal(normalize({ durationSeconds: 600, gracePeriod: null }).gracePeriod, undefined);
  assert.equal(normalize({ durationSeconds: 600, gracePeriod: 'soon' }).gracePeriod, undefined);
  assert.equal(normalize({ durationSeconds: 600, gracePeriod: 0 }).gracePeriod, 0, 'an explicit 0 (no warning) is kept');
  assert.equal(normalize({ durationSeconds: 600, gracePeriod: 7 }).gracePeriod, 7);
  // beginValidatedCountdown is the one place an undefined grace resolves:
  // the explicit option, else the user's graceMinutes, else 2.
  const begin = extractFunction(mainSource, 'beginValidatedCountdown');
  assert.match(begin, /Number\.isFinite\(graceOption\)[\s\S]*Number\.isFinite\(graceSetting\)[\s\S]*: 2;/);
});
