'use strict';
// Regression guards for the v11.3.0 production audit power-path fixes. The
// tick, completion and cancel helpers run for real in a sandbox; only their
// leaves (notifications, receipts, dispatch) are recorded.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function liftFunction(source, name) {
  const head = source.match(new RegExp(`(?:async )?function ${name}\\s*\\(`));
  if (!head) throw new Error(`function ${name} not found`);
  // Skip the parameter list (it may hold a destructuring { ... } default).
  let i = head.index + head[0].length;
  for (let parens = 1; parens > 0; i++) {
    if (source[i] === '(') parens++;
    else if (source[i] === ')') parens--;
  }
  i = source.indexOf('{', i);
  let depth = 0;
  const start = head.index;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

function between(startMarker, endMarker) {
  const a = mainSource.indexOf(startMarker);
  const b = mainSource.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, `markers present: ${startMarker}`);
  return mainSource.slice(a, b);
}

function powerSandbox() {
  const calls = { notices: [], receipts: [], updates: [], dispatched: [], accountability: [], restoreReasons: [], logs: [] };
  const sandbox = {
    console, Date, Number, Math, Boolean, JSON, Promise,
    autopilot: { MAX_FIRE_LATENESS_MS: 5 * 60 * 1000 },
    timerState: { running: true, paused: false, dryRun: false, action: 'shutdown', endsAt: null, remainingSeconds: 0, totalSeconds: 3600, phase: 'focus', gracePeriod: 2 },
    activeReceiptId: 'r1',
    completionGuardController: null,
    formatAction: a => a,
    showNativeNotification: (_title, body) => calls.notices.push(body),
    writeStartupLog: message => calls.logs.push(message),
    refreshShellSurfaces() {},
    clearTimerInterval() {},
    setTaskbarProgress() {},
    persistActiveTimer() {},
    smartLights: { getConfig: () => ({ enabled: false }), resetSmartLightState() {} },
    restoreAfterTimer: ({ reason } = {}) => { calls.restoreReasons.push(reason); return Promise.resolve({ success: true }); },
    emitTimerUpdate: (type, data) => calls.updates.push({ type, data }),
    runReceipts: { updateRunReceipt: (id, patch) => calls.receipts.push({ id, ...patch }) },
    sendAccountability: type => calls.accountability.push(type),
    executePowerAction: async options => calls.dispatched.push(options)
  };
  const context = vm.createContext(sandbox);
  vm.runInContext([
    'const LATE_COMPLETION_LIMIT_MS = autopilot.MAX_FIRE_LATENESS_MS;',
    ...['isCompletionStale', 'missedRunMessage', 'finishMissedRun', 'cancelTimer', 'isCompletionInFlight', 'hasCancellableRun']
      .map(name => liftFunction(mainSource, name)),
    'this.api = { isCompletionStale, finishMissedRun, cancelTimer, hasCancellableRun };'
  ].join('\n'), context);
  return { calls, context, api: context.api };
}

test('a deadline slept through by more than 5 minutes is missed: no power request, honest receipt, no partner "cancelled"', () => {
  const s = powerSandbox();
  s.context.timerState.endsAt = new Date(Date.now() - 8 * 3600 * 1000).toISOString();
  assert.equal(s.api.isCompletionStale(s.context.timerState.endsAt), true);
  s.api.finishMissedRun();
  assert.equal(s.calls.dispatched.length, 0, 'nothing is dispatched');
  assert.equal(s.calls.receipts.at(-1).result, 'missed');
  assert.match(s.calls.receipts.at(-1).notes, /asleep/);
  assert.deepEqual(s.calls.accountability, [], 'partners are not told the user cancelled');
  assert.deepEqual(s.calls.restoreReasons, ['missed'], 'wind-down is undone without restarting media');
  assert.equal(s.calls.updates.at(-1).type, 'cancelled');
  assert.equal(s.calls.updates.at(-1).data.reason, 'missed');
  assert.match(s.calls.notices.at(-1), /passed while this PC was asleep\. Nothing was run/);
  assert.equal(s.context.timerState.running, false);
  assert.equal(s.context.activeReceiptId, null);
});

test('on-time, slightly late and unknown deadlines are not treated as missed', () => {
  const s = powerSandbox();
  assert.equal(s.api.isCompletionStale(new Date(Date.now() - 2000).toISOString()), false, 'normal tick jitter');
  assert.equal(s.api.isCompletionStale(new Date(Date.now() - 4 * 60 * 1000).toISOString()), false, 'within the 5-minute autopilot bound');
  assert.equal(s.api.isCompletionStale(null), false);
  assert.equal(s.api.isCompletionStale('not a date'), false);
  assert.equal(require('../autopilot').MAX_FIRE_LATENESS_MS, 5 * 60 * 1000, 'one shared lateness bound');
  assert.match(mainSource, /const LATE_COMPLETION_LIMIT_MS = autopilot\.MAX_FIRE_LATENESS_MS;/);
});

test('the tick and completion both refuse a stale real run before any power step', () => {
  const tick = between('timerInterval = setInterval(() => {', 'function pauseTimer()');
  const staleAt = tick.indexOf('if (!timerState.dryRun && timerState.remainingSeconds <= 0 && isCompletionStale(timerState.endsAt))');
  assert.ok(staleAt > 0, 'tick checks staleness');
  assert.ok(staleAt < tick.indexOf('computePhase('), 'before phase transitions and dim side effects');
  assert.ok(staleAt < tick.indexOf('completeTimer('), 'before completion');
  const complete = liftFunction(mainSource, 'completeTimer');
  const recheck = complete.indexOf('if (!completionOptions.dryRun && isCompletionStale(completionOptions.endsAt))');
  assert.ok(recheck > complete.indexOf('await playLastLightRitual('), 'suspend during the final steps is re-checked after Last Light');
  assert.ok(recheck < complete.indexOf('await executePowerAction('), 'and before dispatch');
});

test('a plain cancel keeps its existing receipt, restore reason and partner message', () => {
  const s = powerSandbox();
  s.api.cancelTimer();
  assert.equal(s.calls.receipts.at(-1).result, 'cancelled');
  assert.equal(s.calls.receipts.at(-1).notes, undefined);
  assert.deepEqual(s.calls.restoreReasons, ['cancel']);
  assert.deepEqual(s.calls.accountability, ['TIMER_CANCELLED']);
  assert.equal(s.calls.updates.at(-1).type, 'cancelled');
  assert.deepEqual(Object.keys(s.calls.updates.at(-1).data), []);
});

test('every cancel path still works while a completion prepares its power request', () => {
  const s = powerSandbox();
  s.context.timerState.running = false;
  assert.equal(s.api.hasCancellableRun(), true, 'countdown done, receipt still owned by the completion');
  s.context.activeReceiptId = null;
  assert.equal(s.api.hasCancellableRun(), false, 'truly idle');
  s.context.completionGuardController = {};
  assert.equal(s.api.hasCancellableRun(), true, 'native Sleep/Hibernate pre-commit can be aborted');
  const shortcut = between("globalShortcut.register('Ctrl+Shift+X'", "globalShortcut.register('Ctrl+Shift+W'");
  assert.match(shortcut, /if \(hasCancellableRun\(\)\) \{\s*cancelTimer\(\);/);
  assert.match(liftFunction(mainSource, 'familyCommandHandler'), /case 'cancel':\s*if \(!hasCancellableRun\(\)\)/);
  assert.match(mainSource, /case 'cancel': \{\s*const wasActive = hasCancellableRun\(\);/);
  assert.match(mainSource, /label: 'Cancel pending power action'/);
  assert.match(mainSource, /label: 'Cancel Timer',\s*click: \(\) => cancelTimer\(\)/, 'the MenuItem is never passed as cancel options');
  assert.match(liftFunction(mainSource, 'isRunActive'), /isCompletionInFlight\(\)/, 'no new quick start supersedes a pending action');
});

test('Emergency Override cancels before contacting partners', () => {
  const handler = between("ipcMain.handle('execute-override'", '// Run Receipts IPC.');
  const cancelAt = handler.indexOf('cancelTimer()');
  const notifyAt = handler.indexOf('emergencyOverride.executeOverride(reason, overridden)');
  assert.ok(cancelAt > 0 && notifyAt > 0, 'both steps present');
  assert.ok(cancelAt < notifyAt, 'cancel happens first');
  assert.ok(handler.indexOf('const overridden = { ...timerState };') < cancelAt, 'the record uses the pre-cancel snapshot');
});

test('completion never restarts paused media; only a cancel resumes it', () => {
  const restore = liftFunction(mainSource, 'restoreAfterTimer');
  assert.match(restore, /if \(reason === 'cancel'\) \{[\s\S]*?media\.resumeAllMedia\(result\.appId\)/, 'only the session this wind-down paused is resumed');
  assert.equal((restore.match(/resumeAllMedia/g) || []).length, 1, 'no other resume path');
  const complete = liftFunction(mainSource, 'completeTimer');
  assert.ok(complete.indexOf('windDownChanges.mediaPause = null;') > 0, 'the kept pause is dropped');
  assert.ok(complete.lastIndexOf('windDownChanges.mediaPause = null;') < complete.indexOf('await executePowerAction('), 'before dispatch');
});

test('the grace warning fires on crossing the threshold, not on exact equality', () => {
  const tick = between('timerInterval = setInterval(() => {', 'function pauseTimer()');
  assert.match(tick, /const previousRemaining = timerState\.remainingSeconds;/);
  assert.match(tick, /previousRemaining > graceSeconds && timerState\.remainingSeconds <= graceSeconds && timerState\.remainingSeconds > 0/);
  assert.doesNotMatch(tick, /remainingSeconds === timerState\.gracePeriod \* 60/);
});

test('quick-start global shortcuts are opt-in; cancel, pause, snooze and show stay registered', () => {
  const register = liftFunction(mainSource, 'registerGlobalShortcuts');
  assert.match(register, /globalQuickStartShortcuts === true\) registerQuickStartShortcuts\(\);/);
  for (const key of ['L', '1', '2', '3', '4']) {
    assert.doesNotMatch(register, new RegExp(`'Ctrl\\+Shift\\+${key}'`), `Ctrl+Shift+${key} is not registered by default`);
  }
  for (const key of ['X', 'Space', 'Z', 'S']) assert.match(register, new RegExp(`'Ctrl\\+Shift\\+${key}'`));
  const quick = liftFunction(mainSource, 'registerQuickStartShortcuts');
  for (const key of ['L', '1', '2', '3', '4']) assert.match(quick, new RegExp(`'Ctrl\\+Shift\\+${key}'`));
  const settingsSource = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  assert.match(settingsSource, /globalQuickStartShortcuts: false,/);
});

test('a jump-list timer reaches a running app, limited to the jump-list presets', () => {
  const lock = between('const gotTheLock = app.requestSingleInstanceLock();', 'function setupRitualCallbacks()');
  const starts = [];
  const handlers = new Map();
  const window = { isDestroyed: () => false, isMinimized: () => false, restore() {}, show() {}, focus() {} };
  const context = {
    app: { requestSingleInstanceLock: () => true, isReady: () => true, quit() {}, on: (name, cb) => handlers.set(name, cb) },
    mainWindow: window,
    firstLightDelivery: { request() {} },
    refreshTrayMenu() {},
    writeStartupLog() {},
    createWindow() {},
    watchdog: { RELAUNCH_ARG: '--watchdog-relaunch' },
    JUMP_LIST_TIMER_MINUTES: [5, 15, 30],
    startQuickTimer: options => starts.push(options)
  };
  vm.runInNewContext(lock, context);
  const second = handlers.get('second-instance');
  second({}, ['Lights Out.exe', '--timer=15']);
  assert.deepEqual(JSON.parse(JSON.stringify(starts)), [{ minutes: 15, origin: 'launch' }]);
  for (const argv of [['x', '--timer=999'], ['x', '--timer=15', '--no-auto-start'], ['x', '--timer=15', '--watchdog-relaunch'], ['x'], undefined]) {
    second({}, argv);
  }
  assert.equal(starts.length, 1, 'other values, no-auto-start, watchdog relaunch and plain focus never start a timer');
  assert.match(mainSource, /const JUMP_LIST_TIMER_MINUTES = Object\.freeze\(\[5, 15, 30\]\);/);
  for (const minutes of [5, 15, 30]) assert.match(mainSource, new RegExp(`arguments: '--timer=${minutes}'`));
});

test('the unsaved-work scan bound tolerates slow PCs but stays bounded', () => {
  assert.equal(require('../unsavedGuard').SCAN_TIMEOUT_MS, 15000);
});
