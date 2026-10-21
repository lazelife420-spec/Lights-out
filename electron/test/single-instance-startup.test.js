'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual queued startup and second-instance handlers. Resolving
// readiness after quit reproduces the observed lock-loser startup race without
// launching Electron or allowing any OS, network or device actions.
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const lock = source.slice(source.indexOf('const gotTheLock = app.requestSingleInstanceLock();'),
  source.indexOf('function setupRitualCallbacks()'));
const ready = source.slice(source.indexOf('app.whenReady().then(async () => {'),
  source.indexOf("app.on('window-all-closed'"));

function startup(acquired) {
  const calls = [], handlers = new Map();
  let queuedReady;
  const record = name => (...args) => { calls.push(name); return args; };
  const window = {
    isDestroyed: () => false, isMinimized: () => true,
    restore: record('restore'), show: record('show'), focus: record('focus')
  };
  const context = {
    app: {
      requestSingleInstanceLock: () => acquired,
      quit: record('quit'),
      whenReady: () => ({ then: callback => { queuedReady = callback; } }),
      on: (name, callback) => { calls.push('listener:' + name); handlers.set(name, callback); }
    },
    console: { log() {} }, mainWindow: window,
    session: { defaultSession: {
      setPermissionRequestHandler: record('permissionRequest'),
      setPermissionCheckHandler: record('permissionCheck')
    } },
    settingsStore: { load: record('settings'), getSection: () => ({
      widgetVisible: false, idleDetectionEnabled: false, bedtimeReminderEnabled: false
    }) },
    smartLights: { loadConfig: record('lightsConfig') },
    getRecoverableTimer: () => null,
    runReceipts: { reconcileOrphanedRunningReceipts: record('receiptReconcile') },
    routineLedger: { interruptPending: record('routineReconcile') },
    lastLight: {}, profiles: { initialize: () => { calls.push('profiles'); return 0; } },
    launchOptions: {}, updater: { startPeriodicCheck: record('updater') },
    companion: { onMessage: record('listener:companionMessage'),
      onConnect: record('listener:companionConnect'), onStatus: record('listener:companionStatus') },
    focusSessions: { onTick: record('listener:focusTick'), onPhase: record('listener:focusPhase'),
      onComplete: record('listener:focusComplete') },
    idleDetection: { startMonitoring: record('idle') },
    bedtimeReminder: { startReminder: record('bedtime') },
    autopilot: { schedule: record('autopilot') },
    BrowserWindow: { getAllWindows: () => [window] },
    startTimer: record('timerStart'),
    setInterval: record('interval'), setTimeout: record('timeout')
  };
  for (const name of ['cleanupStalePortableExtracts', 'setupRitualCallbacks', 'createWindow',
    'createTray', 'setupJumpList', 'registerGlobalShortcuts', 'createWidgetWindow',
    'writeStartupLog', 'refreshTrayMenu', 'broadcastCompanionState', 'queueRemoteControlRestart',
    'startCompanionNetworkMonitor', 'checkCalendarAutoStart', 'checkContentBlockerSchedules']) {
    context[name] = record(name);
  }
  vm.runInNewContext(lock + '\n' + ready, context, { filename: 'main-startup.js' });
  return { calls, handlers, context, ready: () => queuedReady() };
}

test('primary startup creates one window/tray, registers services and remains idle', async () => {
  const primary = startup(true);
  await primary.ready();
  assert.equal(primary.calls.filter(c => c === 'createWindow').length, 1);
  assert.equal(primary.calls.filter(c => c === 'createTray').length, 1);
  assert.ok(primary.handlers.has('second-instance'));
  assert.ok(primary.handlers.has('activate'));
  assert.ok(primary.calls.includes('listener:companionMessage'));
  assert.ok(primary.calls.includes('receiptReconcile'));
  assert.ok(primary.calls.includes('routineReconcile'));
  assert.ok(!primary.calls.includes('timerStart'));
  assert.ok(!primary.calls.includes('quit'));
});

test('lock loser does no queued startup work even when readiness resolves after quit', async () => {
  const secondary = startup(false);
  assert.deepEqual(secondary.calls, ['quit']);
  await secondary.ready();
  // This covers windows, trays, timer intervals/starts, startup listeners and
  // receipt reconciliation, along with every other startup subsystem above.
  assert.deepEqual(secondary.calls, ['quit']);
  assert.equal(secondary.handlers.size, 0);
});

test('second-instance focus reuses the primary window without starting another timer', async () => {
  const primary = startup(true);
  await primary.ready();
  primary.calls.length = 0;
  primary.handlers.get('second-instance')();
  assert.deepEqual(primary.calls, ['restore', 'show', 'focus', 'refreshTrayMenu']);
});

test('second-instance can recreate a missing primary window without starting a timer', async () => {
  const primary = startup(true);
  await primary.ready();
  primary.context.mainWindow = null;
  primary.calls.length = 0;
  primary.handlers.get('second-instance')();
  assert.deepEqual(primary.calls, ['writeStartupLog', 'createWindow']);
});
