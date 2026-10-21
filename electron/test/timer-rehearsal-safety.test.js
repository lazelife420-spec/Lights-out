'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const parser = require('espree');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const ast = parser.parse(source, { ecmaVersion: 'latest', sourceType: 'script', range: true });
function load(names, values) {
  const context = vm.createContext({ console, Date, ...values });
  const functions = names.map(name => {
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
    if (!node) throw Error('Missing function: ' + name);
    return source.slice(...node.range);
  }).join('\n');
  vm.runInContext(functions, context); return context;
}
const windowStub = () => ({ isDestroyed: () => false, webContents: { send() {} }, setOpacity() {}, setAlwaysOnTop() {}, setMenuBarVisibility() {} });

test('Test Mode dim keeps the scene in-app and never invokes enabled external effects', () => {
  let external = 0, visuals = 0; const effect = () => { external++; throw Error('Forbidden external effect'); };
  const c = load(['applyDimPhase'], { timerState: { dryRun: true }, mainWindow: { ...windowStub(), webContents: { send: () => { visuals++; } } }, settingsStore: { getSection: effect }, executePowerShell: effect, applyFocusMode: effect, media: { pauseAllDetectedMedia: effect }, wifiLifecycle: { block: effect }, contentBlocker: { blockSites: effect } });
  c.applyDimPhase(30, 120); assert.equal(external, 0); assert.equal(visuals, 1);
});

test('ritual rehearsal uses immutable run mode even before the countdown exists', () => {
  let callback, external = 0, dimMode;
  const c = load(['setupRitualCallbacks'], {
    timerState: { dryRun: false, running: false }, mainWindow: windowStub(),
    ritualMode: { onStep: fn => { callback = fn; }, onComplete() {}, onCancel() {} },
    settingsStore: { getSection: () => ({ enabled: true, nightLightOnDim: true, dryRun: false }) },
    contentBlocker: { blockSites: () => { external++; } }, smartLights: { applyScene: () => { external++; } },
    applyDimPhase: (_r, _t, mode) => { dimMode = mode.dryRun; }
  });
  c.setupRitualCallbacks();
  for (const id of ['block', 'dim', 'lights']) callback({ id }, {}, { dryRun: true }, 1);
  assert.equal(external, 0); assert.equal(dimMode, true);
});

test('Test Mode accountability returns before provider configuration is read', () => {
  const c = load(['sendAccountability'], { timerState: { dryRun: true }, settingsStore: { getSection: () => { throw Error('Provider reached'); } } });
  assert.equal(c.sendAccountability('TIMER_STARTED'), undefined);
});

function completionContext(restore) {
  const events = [], calls = [];
  const c = load(['completeTimer'], {
    timerState: { running: true, dryRun: false, action: 'sleep' }, activeReceiptId: 'owned',
    clearTimerInterval() {}, setTaskbarProgress() {}, persistActiveTimer() {}, restoreAfterTimer: () => restore,
    runReceipts: { recordActionEvent: (_id, event) => { events.push(event); return {}; }, getReceiptById: () => ({}), updateRunReceipt() {} },
    smartLights: { getConfig: () => ({ enabled: false }) }, emitTimerUpdate() {}, showNativeNotification() {}, formatAction: () => 'Sleep',
    streaks: { recordEvent() {} }, sleepDebt: { estimateSleepHours: () => 0, recordNight() {} }, settingsStore: { getSection: () => ({}) },
    sendAccountability() {}, unsavedGuard: { scanUnsavedWork: async () => [] }, completionGuardController: null, AbortController: globalThis.AbortController,
    playLastLightRitual: async () => {}, executePowerAction: async options => { calls.push(options); }
  });
  return { c, events, calls };
}
test('a power request waits until Wi-Fi restoration has completed', async () => {
  let finish; const gate = new Promise(resolve => { finish = resolve; }), { c, calls } = completionContext(gate);
  const done = c.completeTimer(); await Promise.resolve(); assert.equal(calls.length, 0);
  finish({ success: true }); await done; assert.equal(calls.length, 1);
});
test('unconfirmed Wi-Fi restoration writes a blocked receipt and dispatches no power request', async () => {
  const { c, events, calls } = completionContext(Promise.resolve({ success: false })); await c.completeTimer();
  assert.equal(calls.length, 0); assert.equal(events.at(-1).state, 'blocked'); assert.equal(events.at(-1).reason, 'wifi-restoration-unconfirmed');
});
test('cancel during Wi-Fi restoration keeps ownership and prevents late power dispatch', async () => {
  let finish; const gate = new Promise(resolve => { finish = resolve; }), { c, calls } = completionContext(gate);
  const done = c.completeTimer(); c.activeReceiptId = null; finish({ success: true }); await done; assert.equal(calls.length, 0);
});
