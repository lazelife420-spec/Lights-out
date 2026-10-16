'use strict';

// Single-run policy (P01): one Lights Out run at a time.
//
// Before this, the tray quick starts, Ctrl+Shift+L / Ctrl+Shift+1..4, the
// launch timer, autopilot, calendar auto-start and Begin Ritual all started a
// new countdown on top of an active one: beginValidatedCountdown() replaced
// the interval and left the old receipt 'running' forever. The shortcut
// notifications also said "timer started" even when nothing started, and
// never said whether it was Test Mode or REAL.
//
// These tests run the real main.js functions in a vm sandbox with stubbed
// collaborators (same technique as test-mode-inheritance.test.js).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

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

function extractConstLine(source, name) {
  const match = source.match(new RegExp(`const ${name} = [^\\n]*;`));
  if (!match) throw new Error(`const ${name} not found`);
  return match[0];
}

function baseTimerState(overrides = {}) {
  return { running: false, paused: false, dryRun: false, action: 'shutdown', ...overrides };
}

// --- startQuickTimer ---------------------------------------------------------

function ritualStateFor(ritualActive, ritualStep) {
  if (!ritualActive) return { active: false, completedSteps: [], skippedSteps: [] };
  const order = ['breathe', 'block', 'dim', 'timer', 'lights'];
  const index = ritualStep ? order.indexOf(ritualStep) : 0;
  return {
    active: true,
    currentStepInfo: { id: order[index] },
    completedSteps: order.slice(0, index),
    skippedSteps: []
  };
}

function quickSandbox({ timerState = baseTimerState(), ritualActive = false, ritualStep, appDryRun = true, startResult } = {}) {
  const calls = { startTimer: [], notifications: [] };
  const sandbox = {
    timerState,
    ritualMode: { getState: () => ritualStateFor(ritualActive, ritualStep) },
    settingsStore: { getSection: section => (section === 'app' ? { dryRun: appDryRun } : null) },
    showNativeNotification: (title, body) => { calls.notifications.push(body); },
    formatAction: action => ({ shutdown: 'Shutdown', sleep: 'Sleep', restart: 'Restart' })[action] || 'Power action',
    startTimer: options => {
      calls.startTimer.push(options);
      return startResult || { success: true, state: { dryRun: appDryRun } };
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext([
    extractFunction(mainSource, 'ritualAwaitingCountdown'),
    extractFunction(mainSource, 'isRunActive'),
    extractFunction(mainSource, 'startQuickTimer'),
    'this.startQuickTimer = startQuickTimer;'
  ].join('\n'), context);
  return { calls, startQuickTimer: context.startQuickTimer };
}

for (const [label, setup] of [
  ['a countdown is running', { timerState: baseTimerState({ running: true }) }],
  ['a countdown is paused', { timerState: baseTimerState({ running: true, paused: true }) }],
  ['a ritual is active', { ritualActive: true }]
]) {
  test(`startQuickTimer refuses while ${label}, without calling startTimer or announcing a start`, () => {
    const { calls, startQuickTimer } = quickSandbox(setup);
    const result = startQuickTimer({ minutes: 15, origin: 'shortcut' });
    assert.equal(result.success, false);
    assert.equal(result.code, 'RUN_ACTIVE');
    assert.equal(calls.startTimer.length, 0, 'startTimer must not be called');
    assert.equal(calls.notifications.length, 1);
    assert.match(calls.notifications[0], /already active/);
    assert.doesNotMatch(calls.notifications[0], /started/i);
  });
}

test('startQuickTimer announces a Test Mode start truthfully', () => {
  const { calls, startQuickTimer } = quickSandbox({ appDryRun: true });
  const result = startQuickTimer({ minutes: 30, origin: 'shortcut' });
  assert.equal(result.success, true);
  assert.equal(calls.startTimer.length, 1);
  assert.equal(calls.startTimer[0].durationSeconds, 1800);
  assert.equal(calls.startTimer[0].action, 'shutdown');
  assert.equal(calls.startTimer[0].origin, 'shortcut');
  assert.equal('dryRun' in calls.startTimer[0], false, 'quick starts omit dryRun so the normalizer inherits Test Mode');
  assert.deepEqual([...calls.notifications], ['30 min Test Mode timer started. Nothing will power off.']);
});

test('startQuickTimer announces a REAL start with the action and how to cancel', () => {
  const { calls, startQuickTimer } = quickSandbox({ appDryRun: false });
  startQuickTimer({ minutes: 28, origin: 'tray' });
  assert.deepEqual([...calls.notifications], ['Shutdown in 28 min. Cancel with Ctrl+Shift+X or the tray.']);
});

test('startQuickTimer wording follows the run that started, not just the setting', () => {
  const { calls, startQuickTimer } = quickSandbox({ appDryRun: false, startResult: { success: true, state: { dryRun: true } } });
  startQuickTimer({ minutes: 45, origin: 'shortcut' });
  assert.match(calls.notifications[0], /Test Mode/);
});

test('when startTimer returns success:false, nothing says "started"', () => {
  const { calls, startQuickTimer } = quickSandbox({ startResult: { success: false, code: 'RUN_ACTIVE', error: 'busy' } });
  const result = startQuickTimer({ minutes: 60, origin: 'launch', action: 'sleep' });
  assert.equal(result.success, false);
  assert.equal(calls.startTimer.length, 1);
  assert.equal(calls.notifications.length, 0);
});

// --- startTimer RUN_ACTIVE guard --------------------------------------------

function startSandbox({ timerState = baseTimerState(), ritualActive = false, ritualStep } = {}) {
  const calls = { begin: [], cancelRitual: 0, clear: 0, startRitual: 0 };
  const sandbox = {
    timerState,
    settingsStore: { getSection: section => (section === 'app' ? { dryRun: true } : null) },
    ritualMode: {
      getState: () => ritualStateFor(ritualActive, ritualStep),
      cancelRitual: () => { calls.cancelRitual++; ritualActive = false; },
      startRitual: () => { calls.startRitual++; }
    },
    profileRitualContext: { clear: () => { calls.clear++; }, createContext: () => 'tok' },
    resolveTimerProfileIdentity: () => ({ profileId: null, profileName: null }),
    profiles: { getById: () => null },
    resolveNightModeStart: () => ({ nightModeId: null, nightModeTitle: null, nightModeVersion: null }),
    startDecision: { resolveStartDecision: () => ({ useRitualGateway: false }) },
    beginValidatedCountdown: options => { calls.begin.push(options); return { success: true, state: { dryRun: options.dryRun } }; }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext([
    extractConstLine(mainSource, 'UNATTENDED_RUN_ORIGINS'),
    extractFunction(mainSource, 'ritualAwaitingCountdown'),
    extractFunction(mainSource, 'normalizeTimerOptions'),
    extractFunction(mainSource, 'startTimer'),
    'this.startTimer = startTimer;'
  ].join('\n'), context);
  return { calls, startTimer: context.startTimer };
}

test('startTimer returns RUN_ACTIVE for a new start while a countdown is running', () => {
  const { calls, startTimer } = startSandbox({ timerState: baseTimerState({ running: true }) });
  const result = startTimer({ durationSeconds: 600, action: 'shutdown', dryRun: true });
  assert.equal(result.success, false);
  assert.equal(result.code, 'RUN_ACTIVE');
  assert.equal(calls.begin.length, 0, 'no countdown may be replaced');
});

test('startTimer returns RUN_ACTIVE while a countdown is paused', () => {
  const { calls, startTimer } = startSandbox({ timerState: baseTimerState({ running: true, paused: true }) });
  assert.equal(startTimer({ durationSeconds: 600, origin: 'calendar' }).code, 'RUN_ACTIVE');
  assert.equal(calls.begin.length, 0);
});

test('startTimer refuses an unattended (autopilot) start while a ritual is active, and leaves the ritual alone', () => {
  for (const origin of ['autopilot', 'calendar', 'shortcut', 'tray', 'launch']) {
    const { calls, startTimer } = startSandbox({ ritualActive: true });
    const result = startTimer({ durationSeconds: 600, origin });
    assert.equal(result.code, 'RUN_ACTIVE', origin);
    assert.equal(calls.cancelRitual, 0, `${origin} must not cancel the ritual`);
    assert.equal(calls.begin.length, 0, origin);
  }
});

// A ritual stays 'active' in ritualMode on its timer and lights steps until
// someone clicks through the overlay. Once its timer step has handed off to a
// countdown, the countdown is the run: when that countdown has completed or
// been cancelled, the leftover ritual must not keep refusing the next start.
for (const ritualStep of ['timer', 'lights']) {
  test(`a ritual left on its ${ritualStep} step with no countdown does not block an autopilot start`, () => {
    const { calls, startTimer } = startSandbox({ ritualActive: true, ritualStep });
    const result = startTimer({ durationSeconds: 600, origin: 'autopilot' });
    assert.equal(result.success, true);
    assert.equal(calls.begin.length, 1);
    assert.equal(calls.begin[0].origin, 'autopilot');
  });

  test(`startQuickTimer starts while a ritual is left on its ${ritualStep} step with no countdown`, () => {
    const { calls, startQuickTimer } = quickSandbox({ ritualActive: true, ritualStep });
    const result = startQuickTimer({ minutes: 15, origin: 'tray' });
    assert.equal(result.success, true);
    assert.equal(calls.startTimer.length, 1);
    assert.doesNotMatch(calls.notifications.join(' '), /already active/);
  });
}

test('a ritual still before its timer step blocks unattended starts', () => {
  for (const ritualStep of ['breathe', 'block', 'dim']) {
    const { calls, startTimer } = startSandbox({ ritualActive: true, ritualStep });
    assert.equal(startTimer({ durationSeconds: 600, origin: 'autopilot' }).code, 'RUN_ACTIVE', ritualStep);
    assert.equal(calls.begin.length, 0, ritualStep);
  }
});

test('the ritual countdown it owns still blocks starts while it runs', () => {
  const { calls, startQuickTimer } = quickSandbox({ ritualActive: true, ritualStep: 'timer', timerState: baseTimerState({ running: true }) });
  assert.equal(startQuickTimer({ minutes: 15, origin: 'tray' }).code, 'RUN_ACTIVE');
  assert.equal(calls.startTimer.length, 0);
});

test('a person\'s own local start still supersedes an active ritual that has no countdown', () => {
  const { calls, startTimer } = startSandbox({ ritualActive: true });
  const result = startTimer({ durationSeconds: 600, action: 'shutdown', dryRun: true });
  assert.equal(result.success, true);
  assert.equal(calls.cancelRitual, 1, 'the ritual is superseded');
  assert.equal(calls.begin.length, 1);
  assert.equal(calls.begin[0].origin, 'this-pc');
});

test('the guard sits before the start decision, and the supersession line is kept', () => {
  const body = extractFunction(mainSource, 'startTimer');
  const guard = body.indexOf("code: 'RUN_ACTIVE'");
  assert.ok(guard > 0, 'RUN_ACTIVE guard missing');
  assert.ok(guard < body.indexOf('resolveStartDecision'), 'guard must run before resolveStartDecision');
  assert.match(body, /options\.source !== 'ritual' && ritualMode\.getState\(\)\.active/);
});
