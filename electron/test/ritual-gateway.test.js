'use strict';

// UI-R3 Fire 08: the Standard Ritual Gateway never reports a phantom start.
//
// Before this, main.js startTimer's gateway branch returned
// { success: true, ritualStarted: true } even when ritualMode.startRitual
// answered { active: false, reason: 'disabled' } (the ritual turned off in
// Settings › Automations). Nothing ran, yet the renderer showed a countdown
// and the phone said it had started.
//
// The real normalizeTimerOptions / ritualAwaitingCountdown / startTimer
// bodies run in a vm sandbox whose ritualMode, profileRitualContext and
// beginValidatedCountdown are recording stubs: no ritual, timer or power
// action can run from this file.

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

function sandboxFor(opts = {}) {
  const { useRitualGateway = true, timerState } = opts;
  const ritualResult = Object.prototype.hasOwnProperty.call(opts, 'ritualResult') ? opts.ritualResult : { active: true };
  const calls = { startRitual: [], clear: 0, createContext: [], begin: [], cancelRitual: 0, events: [] };
  let token = null;
  const sandbox = {
    timerState: timerState || { running: false, paused: false, dryRun: true, action: 'shutdown' },
    settingsStore: { getSection: section => (section === 'app' ? { dryRun: true } : null) },
    ritualMode: {
      getState: () => ({ active: false, completedSteps: [], skippedSteps: [] }),
      cancelRitual: () => { calls.cancelRitual++; },
      startRitual: (steps, meta) => { calls.startRitual.push({ steps, meta }); calls.events.push('startRitual'); return ritualResult; }
    },
    profileRitualContext: {
      clear: () => { calls.clear++; token = null; calls.events.push('clear'); },
      createContext: ctx => { calls.createContext.push(ctx); token = 'tok-1'; calls.events.push('create'); return token; }
    },
    resolveTimerProfileIdentity: () => ({ profileId: null, profileName: null }),
    profiles: { getById: () => null },
    resolveNightModeStart: () => ({ nightModeId: 'lights-down', nightModeTitle: 'Lights Down', nightModeVersion: 1 }),
    startDecision: { resolveStartDecision: () => ({ useRitualGateway }) },
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
  return { calls, startTimer: context.startTimer, token: () => token };
}

const RITUAL_START = { durationSeconds: 2700, action: 'sleep', dryRun: true, nightModeId: 'lights-down' };

test('ritual turned off: an honest RITUAL_DISABLED failure, and the pending context is cleared', () => {
  const s = sandboxFor({ ritualResult: { active: false, reason: 'disabled' } });
  const result = s.startTimer(RITUAL_START);
  assert.equal(result.success, false);
  assert.equal(result.code, 'RITUAL_DISABLED');
  assert.equal(result.ritualStarted, undefined, 'never claims a ritual started');
  assert.match(result.error, /turned off in Settings › Automations/);
  assert.equal(s.calls.startRitual.length, 1, 'the ritual was asked once');
  assert.equal(s.calls.createContext.length, 1);
  assert.equal(s.token(), null, 'the context token created for this run is cleared');
  assert.deepEqual(s.calls.events, ['clear', 'create', 'startRitual', 'clear']);
  assert.equal(s.calls.begin.length, 0, 'no countdown starts in its place');
});

test('a malformed ritual answer with no live countdown is treated as not started, never as success', () => {
  for (const [answer, code] of [[undefined, 'RITUAL_DISABLED'], [null, 'RITUAL_DISABLED'], [{}, 'RITUAL_NOT_STARTED'], [{ active: 'yes' }, 'RITUAL_NOT_STARTED']]) {
    const s = sandboxFor({ ritualResult: answer });
    const result = s.startTimer(RITUAL_START);
    assert.equal(result.success, false, JSON.stringify(answer));
    assert.equal(result.code, code, JSON.stringify(answer));
    assert.equal(result.ritualStarted, undefined);
    assert.equal(s.token(), null);
  }
});

test('a finished (inactive) ritual answer whose countdown is live is a real start, not RITUAL_DISABLED', () => {
  // The remote fast-forward shape: startRitual returns getState() with
  // active:false after its timer step armed the countdown.
  const timerState = { running: false, paused: false, dryRun: true, action: 'shutdown' };
  const s = sandboxFor({ timerState, ritualResult: { active: false, completedSteps: ['timer'] } });
  // The stub cannot arm the timer itself, so arm it when startRitual is asked.
  const before = s.calls.startRitual.length;
  timerState.running = false;
  const realPush = s.calls.startRitual.push.bind(s.calls.startRitual);
  s.calls.startRitual.push = entry => { timerState.running = true; return realPush(entry); };
  const result = s.startTimer(RITUAL_START);
  assert.equal(s.calls.startRitual.length, before + 1);
  assert.deepEqual({ ...result }, { success: true, ritualStarted: true });
});

test('ritual on: the gateway still reports a started ritual and keeps its context', () => {
  const s = sandboxFor({ ritualResult: { active: true, currentStep: 0 } });
  const result = s.startTimer(RITUAL_START);
  assert.deepEqual({ ...result }, { success: true, ritualStarted: true });
  assert.equal(s.token(), 'tok-1', 'the run token stays bound to the ritual');
  assert.equal(s.calls.startRitual[0].meta.profileRitualToken, 'tok-1');
  assert.equal(s.calls.begin.length, 0, 'the ritual, not startTimer, starts the countdown later');
});

test('a direct-start decision never calls startRitual', () => {
  const s = sandboxFor({ useRitualGateway: false, ritualResult: { active: false, reason: 'disabled' } });
  const result = s.startTimer({ durationSeconds: 900, action: 'sleep', dryRun: true });
  assert.equal(result.success, true);
  assert.equal(s.calls.startRitual.length, 0);
  assert.equal(s.calls.begin.length, 1);
});

test('a running or paused timer still returns RUN_ACTIVE first (single-run policy untouched)', () => {
  for (const timerState of [{ running: true, paused: false }, { running: true, paused: true }]) {
    const s = sandboxFor({ timerState, ritualResult: { active: false, reason: 'disabled' } });
    const result = s.startTimer(RITUAL_START);
    assert.equal(result.code, 'RUN_ACTIVE');
    assert.equal(s.calls.startRitual.length, 0);
    assert.equal(s.calls.createContext.length, 0);
  }
});

test('the phone hears a failed Night Mode start through the existing commandResult', () => {
  const at = mainSource.indexOf("case 'startNightMode': {");
  const body = mainSource.slice(at, mainSource.indexOf("case 'getNightModes':", at));
  assert.match(body, /\} else if \(client\) \{[\s\S]*type: 'commandResult',\s*action: 'startNightMode',\s*success: false,\s*code: result\.code \|\| 'START_REJECTED',\s*message: result\.error/);
});

// ---------------------------------------------------------------------------
// End to end with the REAL ritualMode, profileRitualContext, startDecision
// and nightModes modules, plus main.js's real setupRitualCallbacks,
// startTimer and handleCompanionMessage. Only the leaves are stubs:
// beginValidatedCountdown records the countdown it was asked to arm (and marks
// timerState running, as the real one does); companion.sendToClient and
// notifyRemoteAction record what the phone and the desktop would hear.
// A phone start runs with remoteOrigin, so ritualMode fast-forwards every step
// synchronously inside startRitual and returns active:false having really
// armed the countdown. That must be a success, never RITUAL_DISABLED.

function loadModule(file, requireMap = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const mod = { exports: {} };
  const req = name => {
    if (Object.prototype.hasOwnProperty.call(requireMap, name)) return requireMap[name];
    throw new Error(`unexpected require ${name} from ${file}`);
  };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: req, setTimeout, clearTimeout, console });
  return mod.exports;
}

function integrated({ ritualEnabled }) {
  const ritualSettingsStore = {
    getSection: s => (s === 'ritual' ? { enabled: ritualEnabled } : null),
    updateSection() {}
  };
  const realRitual = loadModule('ritualMode.js', { './settings': ritualSettingsStore });
  const profileRitualContext = loadModule('profileRitualContext.js');
  const startDecision = loadModule('startDecision.js', { './profileRitualContext': profileRitualContext });
  const nightModes = loadModule('nightModes.js');
  const calls = { begin: [], sent: [], notices: [], steps: [] };
  const timerState = { running: false, paused: false, dryRun: true, action: 'shutdown', remainingSeconds: 0, totalSeconds: 0 };
  // main's own onStep handler runs; this wrapper only records the step ids.
  const ritualMode = {
    ...realRitual,
    onStep: cb => realRitual.onStep((step, ...rest) => { calls.steps.push(step.id); return cb(step, ...rest); })
  };
  const sandbox = {
    console,
    // handleCompanionMessage schedules a state broadcast after every command;
    // record it, never run it.
    setTimeout: () => 0,
    broadcastCompanionState: () => {},
    timerState,
    mainWindow: null,
    settingsStore: {
      getSection: s => {
        if (s === 'app') return { dryRun: true, graceMinutes: 2 };
        if (s === 'remoteControl') return { mode: 'local' };
        return null;
      }
    },
    ritualMode,
    profileRitualContext,
    startDecision,
    nightModes,
    resolveNightModeStart: nightModes.resolveNightModeStart,
    resolveTimerProfileIdentity: () => ({ profileId: null, profileName: null }),
    profiles: { getById: () => null },
    beginValidatedCountdown: (options, identity, nm) => {
      calls.begin.push({ options, identity, nm });
      timerState.running = true;
      timerState.dryRun = options.dryRun;
      return { success: true };
    },
    companion: { sendToClient: (client, payload) => { calls.sent.push(payload); } },
    notifyRemoteAction: message => { calls.notices.push(message); },
    contentBlocker: { DEFAULT_BLOCKLIST: [], blockSites: () => Promise.resolve() },
    smartLights: { applyScene: () => Promise.resolve() },
    applyDimPhase: () => {}
  };
  const context = vm.createContext(sandbox);
  vm.runInContext([
    extractConstLine(mainSource, 'UNATTENDED_RUN_ORIGINS'),
    extractFunction(mainSource, 'ritualAwaitingCountdown'),
    extractFunction(mainSource, 'normalizeTimerOptions'),
    extractFunction(mainSource, 'startTimer'),
    extractFunction(mainSource, 'setupRitualCallbacks'),
    extractFunction(mainSource, 'handleCompanionMessage'),
    'setupRitualCallbacks();',
    'this.startTimer = startTimer;',
    'this.handleCompanionMessage = handleCompanionMessage;'
  ].join('\n'), context);
  return { calls, timerState, realRitual, nightModes, startTimer: context.startTimer, handle: context.handleCompanionMessage };
}

const RITUAL_NIGHT_MODE = 'lights-down';

test('real modules: the night mode under test is a standard-ritual mode', () => {
  const resolution = loadModule('nightModes.js').resolveForExecution(RITUAL_NIGHT_MODE);
  assert.equal(resolution.success, true);
  assert.equal(resolution.resolved.ritualId, 'standard');
});

test('real modules: a phone start of a ritual mode with the ritual ON arms the countdown and reports success to both sides', () => {
  const s = integrated({ ritualEnabled: true });
  s.handle({ action: 'startNightMode', nightModeId: RITUAL_NIGHT_MODE }, { id: 'phone-1' });
  assert.ok(s.calls.steps.includes('timer'), `the ritual reached its timer step (${s.calls.steps.join(',')})`);
  assert.equal(s.calls.begin.length, 1, 'the ritual timer step armed exactly one countdown');
  assert.equal(s.calls.begin[0].options.source, 'ritual');
  assert.equal(s.calls.begin[0].options.dryRun, true, 'the desktop Test Mode setting carried through');
  assert.equal(s.timerState.running, true);
  assert.equal(s.realRitual.getState().active, false, 'the remote run fast-forwarded to completion');
  const failures = s.calls.sent.filter(p => p.type === 'commandResult' && p.success === false);
  assert.deepEqual(failures, [], 'the phone hears no failure while a countdown runs');
  assert.equal(s.calls.notices.length, 1, 'the desktop is told the phone started it');
  assert.match(s.calls.notices[0], /started from your phone/);
  assert.match(s.calls.notices[0], /Test Mode/);
});

test('real modules: the gateway itself returns success for a remote-origin ritual start', () => {
  const s = integrated({ ritualEnabled: true });
  const resolved = s.nightModes.resolveForExecution(RITUAL_NIGHT_MODE).resolved;
  const result = s.startTimer({ ...resolved, source: 'remote', startOrigin: 'companion-night-mode', origin: 'phone', dryRun: true });
  assert.deepEqual({ ...result }, { success: true, ritualStarted: true });
  assert.equal(s.calls.begin.length, 1);
});

test('real modules: a local start with the ritual ON stays an active guided ritual (success)', () => {
  const s = integrated({ ritualEnabled: true });
  const result = s.startTimer({ durationSeconds: 2700, action: 'sleep', dryRun: true, nightModeId: RITUAL_NIGHT_MODE, startOrigin: 'play', origin: 'local' });
  assert.deepEqual({ ...result }, { success: true, ritualStarted: true });
  assert.equal(s.realRitual.getState().active, true, 'the local ritual waits on its guided overlay');
  assert.equal(s.calls.begin.length, 0, 'no countdown yet: the timer step comes later');
});

test('real modules: a phone start with the ritual OFF is an honest failure and nothing runs', () => {
  const s = integrated({ ritualEnabled: false });
  s.handle({ action: 'startNightMode', nightModeId: RITUAL_NIGHT_MODE }, { id: 'phone-1' });
  assert.equal(s.calls.begin.length, 0, 'no countdown');
  assert.equal(s.timerState.running, false);
  assert.equal(s.calls.notices.length, 0, 'the desktop does not claim a phone start');
  const failures = s.calls.sent.filter(p => p.type === 'commandResult' && p.success === false);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'RITUAL_DISABLED');
  assert.match(failures[0].message, /turned off in Settings › Automations/);
});

test('real modules: a local start with the ritual OFF is RITUAL_DISABLED', () => {
  const s = integrated({ ritualEnabled: false });
  const result = s.startTimer({ durationSeconds: 2700, action: 'sleep', dryRun: true, nightModeId: RITUAL_NIGHT_MODE, startOrigin: 'play', origin: 'local' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'RITUAL_DISABLED');
  assert.equal(s.calls.begin.length, 0);
});
