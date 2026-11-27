'use strict';
// Taskbar presence: the overlay badge (amber = Test Mode, rose = REAL, like the
// tray dot) and the thumbnail toolbar (Pause/Resume, Snooze +5 min, Cancel) for
// an active run, cleared when idle. The module runs against a stubbed
// BrowserWindow; main.js's real timer functions run in a vm sandbox, so the
// buttons provably call pauseTimer/resumeTimer/snoozeTimer/cancelTimer and the
// tray/taskbar never keep offering a cancel after the run is over.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const taskbar = require('../taskbarPresence');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

// ── Stubs ────────────────────────────────────────────────────────────────────

// nativeImage that loads the committed PNGs (empty when a file is missing).
const nativeImage = {
  createFromPath: file => ({ file: path.basename(file), isEmpty: () => !fs.existsSync(file) })
};

function stubWindow({ thumbarResult = true } = {}) {
  const calls = { overlay: [], thumbar: [], progress: [] };
  let destroyed = false;
  return {
    calls,
    destroy() { destroyed = true; },
    isDestroyed: () => destroyed,
    getBounds: () => ({ x: 0, y: 0, width: 520, height: 800 }),
    isVisible: () => true,
    webContents: { send() {} },
    setOverlayIcon(image, description) {
      calls.overlay.push({ file: image ? image.file : null, description });
    },
    setThumbarButtons(buttons) {
      calls.thumbar.push(buttons.map(button => ({ file: button.icon.file, tooltip: button.tooltip, click: button.click })));
      return typeof thumbarResult === 'function' ? thumbarResult() : thumbarResult;
    },
    setProgressBar(value, options) { calls.progress.push({ value, mode: options && options.mode }); }
  };
}

const plain = value => JSON.parse(JSON.stringify(value));
const files = buttons => buttons.map(button => button.file);
const tips = buttons => buttons.map(button => button.tooltip);

// ── Pure model ───────────────────────────────────────────────────────────────

test('state model: idle -> Test Mode run -> REAL run -> paused -> completion -> idle', () => {
  const d = taskbar.describeTaskbarState;
  assert.deepEqual(d({}), { overlay: null, buttons: [] }, 'idle shows nothing');

  const testRun = d({ running: true, dryRun: true, actionLabel: 'Shutdown', snoozeLabel: 'Snooze +5 min' });
  assert.equal(testRun.overlay.kind, 'test');
  assert.equal(testRun.overlay.paused, false);
  assert.match(testRun.overlay.description, /Test Mode run in progress\. Nothing will power off\./);
  assert.deepEqual(testRun.buttons.map(b => b.id), ['pause', 'snooze', 'cancel']);

  const realRun = d({ running: true, dryRun: false, actionLabel: 'Hibernate', snoozeLabel: 'Snooze +5 min (logged)' });
  assert.equal(realRun.overlay.kind, 'real');
  assert.match(realRun.overlay.description, /REAL Hibernate countdown running/);
  assert.deepEqual(realRun.buttons.map(b => b.tooltip), ['Pause', 'Snooze +5 min (logged)', 'Cancel Timer'], 'snooze tooltip carries the tray cost label');

  const paused = d({ running: true, paused: true, dryRun: false, actionLabel: 'Shutdown' });
  assert.equal(paused.overlay.paused, true);
  assert.match(paused.overlay.description, /REAL Shutdown countdown paused/);
  assert.deepEqual(paused.buttons.map(b => b.id), ['resume', 'snooze', 'cancel']);

  const completing = d({ running: false, completing: true, dryRun: false, actionLabel: 'Sleep' });
  assert.equal(completing.overlay.kind, 'real', 'the rose badge stays through the unsaved-work wait and Last Light');
  assert.match(completing.overlay.description, /REAL Sleep pending\. It can still be cancelled\./);
  assert.deepEqual(plain(completing.buttons), [{ id: 'cancel', tooltip: 'Cancel pending power action' }], 'only Cancel, like the tray');

  const testFinish = d({ completing: true, dryRun: true });
  assert.deepEqual(plain(testFinish.buttons), [{ id: 'cancel', tooltip: 'Cancel Test Mode run' }]);
  assert.match(testFinish.overlay.description, /Nothing will power off/);

  assert.deepEqual(d({ running: false, paused: false, completing: false, dryRun: false }), { overlay: null, buttons: [] }, 'idle again');
});

test('the pre-rendered size follows the display scale (16/20/24/32 px)', () => {
  assert.equal(taskbar.pickIconSize(1), 16);
  assert.equal(taskbar.pickIconSize(1.25), 20);
  assert.equal(taskbar.pickIconSize(1.5), 24);
  assert.equal(taskbar.pickIconSize(1.75), 32);
  assert.equal(taskbar.pickIconSize(2), 32);
  assert.equal(taskbar.pickIconSize(3), 32, 'largest asset beyond 200%');
  assert.equal(taskbar.pickIconSize(undefined), 16);
  assert.equal(taskbar.pickIconSize(-1), 16);
});

// ── Applier against a stubbed BrowserWindow ──────────────────────────────────

function presence(window, extra = {}) {
  const handled = [];
  const logs = [];
  const api = taskbar.createTaskbarPresence({
    platform: 'win32',
    nativeImage,
    appRoot: root,
    getWindow: () => window,
    getScaleFactor: () => 1,
    useDarkGlyphs: () => false,
    handlers: {
      pauseOrResume: () => handled.push('pauseOrResume'),
      snooze: () => handled.push('snooze'),
      cancel: () => handled.push('cancel')
    },
    log: (message, data) => logs.push({ message, data }),
    ...extra
  });
  return { api, handled, logs };
}

test('applier: overlay and thumbnail toolbar follow the run and clear when idle', () => {
  const win = stubWindow();
  const { api, handled } = presence(win);

  api.apply({});
  assert.equal(win.calls.overlay.length, 0, 'an idle window is left alone');
  assert.equal(win.calls.thumbar.length, 0, 'no empty toolbar is ever added to an idle window');

  api.apply({ running: true, dryRun: true, actionLabel: 'Shutdown', snoozeLabel: 'Snooze +5 min' });
  assert.equal(win.calls.overlay.at(-1).file, 'overlay-test-16.png');
  assert.match(win.calls.overlay.at(-1).description, /Test Mode/);
  assert.deepEqual(files(win.calls.thumbar.at(-1)), ['thumb-pause-white-16.png', 'thumb-snooze-white-16.png', 'thumb-cancel-white-16.png']);

  api.apply({ running: true, dryRun: true, actionLabel: 'Shutdown', snoozeLabel: 'Snooze +5 min' });
  assert.equal(win.calls.overlay.length, 1, 'an unchanged state is not re-sent');
  assert.equal(win.calls.thumbar.length, 1);

  api.apply({ running: true, dryRun: false, actionLabel: 'Shutdown', snoozeLabel: 'Snooze +5 min' });
  assert.equal(win.calls.overlay.at(-1).file, 'overlay-real-16.png');
  assert.match(win.calls.overlay.at(-1).description, /REAL Shutdown/);
  assert.equal(win.calls.thumbar.length, 1, 'same buttons, no toolbar update');

  api.apply({ running: true, paused: true, dryRun: false, actionLabel: 'Shutdown', snoozeLabel: 'Snooze +5 min' });
  assert.equal(win.calls.overlay.at(-1).file, 'overlay-real-paused-16.png');
  assert.deepEqual(tips(win.calls.thumbar.at(-1)), ['Resume', 'Snooze +5 min', 'Cancel Timer']);

  api.apply({ running: false, completing: true, dryRun: false, actionLabel: 'Shutdown' });
  assert.equal(win.calls.overlay.at(-1).file, 'overlay-real-16.png');
  assert.deepEqual(files(win.calls.thumbar.at(-1)), ['thumb-cancel-white-16.png']);

  // The buttons call the handlers they name.
  win.calls.thumbar.at(-1)[0].click();
  assert.deepEqual(handled, ['cancel']);

  api.apply({});
  assert.deepEqual(win.calls.overlay.at(-1), { file: null, description: '' }, 'overlay cleared');
  assert.deepEqual(win.calls.thumbar.at(-1), [], 'toolbar buttons removed');
});

test('applier: every button calls its handler (pause and resume share the toggle)', () => {
  const win = stubWindow();
  const { api, handled } = presence(win);
  api.apply({ running: true, dryRun: true });
  for (const button of win.calls.thumbar.at(-1)) button.click();
  api.apply({ running: true, paused: true, dryRun: true });
  win.calls.thumbar.at(-1)[0].click();
  assert.deepEqual(handled, ['pauseOrResume', 'snooze', 'cancel', 'pauseOrResume']);
});

test('applier: nothing is set when the window is destroyed, missing, or not on Windows', () => {
  const destroyed = stubWindow();
  destroyed.destroy();
  const a = presence(destroyed).api;
  assert.equal(a.apply({ running: true, dryRun: false }), false);
  assert.equal(a.apply({}, { force: true }), false);
  assert.deepEqual(destroyed.calls, { overlay: [], thumbar: [], progress: [] });

  assert.equal(presence(null).api.apply({ running: true }), false);
  const throwing = taskbar.createTaskbarPresence({ platform: 'win32', nativeImage, appRoot: root, getWindow: () => { throw new Error('gone'); } });
  assert.equal(throwing.apply({ running: true }), false, 'a throwing window getter never escapes');

  const mac = stubWindow();
  assert.equal(presence(mac, { platform: 'darwin' }).api.apply({ running: true, dryRun: false }, { force: true }), false);
  assert.deepEqual(mac.calls, { overlay: [], thumbar: [], progress: [] }, 'a no-op off Windows');
});

test('applier: a window destroyed mid-run is never touched again', () => {
  const win = stubWindow();
  const { api } = presence(win);
  api.apply({ running: true, dryRun: true });
  win.destroy();
  api.apply({}, { force: true });
  assert.equal(win.calls.overlay.length, 1);
  assert.equal(win.calls.thumbar.length, 1);
});

test('applier: Windows API failures never throw and are retried on the next apply', () => {
  let failOverlay = true;
  let thumbarOk = false;
  const win = stubWindow({ thumbarResult: () => thumbarOk });
  const setOverlay = win.setOverlayIcon;
  win.setOverlayIcon = (...args) => { if (failOverlay) throw new Error('no taskbar'); return setOverlay.apply(win, args); };
  const { api, logs } = presence(win);

  assert.doesNotThrow(() => api.apply({ running: true, dryRun: false }));
  assert.equal(win.calls.overlay.length, 0);
  assert.equal(win.calls.thumbar.length, 1, 'refused by Windows (no taskbar button yet)');
  assert.ok(logs.some(entry => entry.message === 'Taskbar overlay unavailable'));

  failOverlay = false;
  thumbarOk = true;
  api.apply({ running: true, dryRun: false });
  assert.equal(win.calls.overlay.at(-1).file, 'overlay-real-16.png', 'overlay retried');
  assert.equal(win.calls.thumbar.length, 2, 'toolbar retried');
  api.apply({ running: true, dryRun: false });
  assert.equal(win.calls.thumbar.length, 2, 'and then cached');
});

test('applier: force re-sends an unchanged state (taskbar button recreated on show)', () => {
  const win = stubWindow();
  const { api } = presence(win);
  api.apply({ running: true, dryRun: true });
  api.apply({ running: true, dryRun: true }, { force: true });
  assert.equal(win.calls.overlay.length, 2);
  assert.equal(win.calls.thumbar.length, 2);
});

test('applier: display scale and system theme pick the asset size and glyph ink', () => {
  const win = stubWindow();
  let scale = 1.5;
  let lightTheme = true;
  const { api } = presence(win, { getScaleFactor: () => scale, useDarkGlyphs: () => lightTheme });
  api.apply({ running: true, dryRun: true });
  assert.equal(win.calls.overlay.at(-1).file, 'overlay-test-24.png');
  assert.deepEqual(files(win.calls.thumbar.at(-1)), ['thumb-pause-black-24.png', 'thumb-snooze-black-24.png', 'thumb-cancel-black-24.png']);
  lightTheme = false;
  scale = 1.25;
  api.apply({ running: true, dryRun: true });
  assert.equal(win.calls.overlay.at(-1).file, 'overlay-test-20.png');
  assert.deepEqual(files(win.calls.thumbar.at(-1)), ['thumb-pause-white-20.png', 'thumb-snooze-white-20.png', 'thumb-cancel-white-20.png']);
});

test('applier: a missing asset degrades to no badge/button, logged once, never a throw', () => {
  const win = stubWindow();
  const { api, logs } = presence(win, { appRoot: path.join(root, 'no-such-dir') });
  assert.doesNotThrow(() => api.apply({ running: true, dryRun: false }));
  assert.deepEqual(win.calls.overlay, [], 'no overlay was ever set, so nothing to clear');
  assert.deepEqual(win.calls.thumbar, [], 'no buttons without glyphs, and no empty toolbar');
  api.apply({ running: true, paused: true, dryRun: false });
  const missing = logs.filter(entry => entry.message === 'Taskbar asset unavailable').map(entry => entry.data.file);
  assert.equal(new Set(missing).size, missing.length, 'each missing file is logged once');
});

test('applier: a recreated window starts from a clean state', () => {
  let current = stubWindow();
  const first = current;
  const { api } = presence(null, { getWindow: () => current });
  api.apply({ running: true, dryRun: true });
  current = stubWindow();
  api.apply({ running: true, dryRun: true });
  assert.equal(first.calls.overlay.length, 1);
  assert.equal(current.calls.overlay.length, 1, 'the new window gets the badge without waiting for a state change');
  assert.equal(current.calls.thumbar.length, 1);
});

// ── Committed assets ─────────────────────────────────────────────────────────

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${file} is a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('every overlay and thumbnail glyph is a committed PNG at its size, listed in build.files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const assets = taskbar.allTaskbarAssetFiles();
  assert.equal(assets.length, 2 * 2 * 4 + 4 * 2 * 4, 'test/real x running/paused overlays + 4 glyphs x 2 inks, at 4 sizes');
  for (const rel of assets) {
    const size = Number(rel.match(/-(\d+)\.png$/)[1]);
    assert.deepEqual(pngSize(path.join(root, rel)), { width: size, height: size }, rel);
    assert.ok(pkg.build.files.includes(rel), `${rel} ships (build.files)`);
  }
  assert.ok(pkg.build.files.includes('taskbarPresence.js'));
  assert.ok(pkg.build.files.includes('assets/icon-256.png'), 'the toast logo ships');
  assert.deepEqual(pngSize(path.join(root, 'assets', 'icon-256.png')), { width: 256, height: 256 });
});

test('overlay badges use the tray dot colours: amber for Test Mode, rose for REAL', async () => {
  const sharp = require('sharp');
  const centre = async file => {
    const { data, info } = await sharp(path.join(root, 'assets', 'taskbar', file)).raw().toBuffer({ resolveWithObject: true });
    // A pixel on the disc between the glyph and the keyline (2 o'clock-ish, outside the strike).
    const x = Math.round(info.width * 0.78), y = Math.round(info.height * 0.62);
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const near = (rgb, hex) => {
    const target = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
    return rgb.every((value, index) => Math.abs(value - target[index]) <= 24);
  };
  for (const size of taskbar.TASKBAR_ICON_SIZES) {
    assert.ok(near(await centre(`overlay-test-${size}.png`), '#f5b83d'), `test ${size} is amber`);
    assert.ok(near(await centre(`overlay-real-${size}.png`), '#ff5c7a'), `real ${size} is rose`);
  }
  const make = fs.readFileSync(path.join(root, 'scripts', 'make-icons.js'), 'utf8');
  assert.match(make, /OVERLAY_COLORS = Object\.freeze\(\{ test: '#f5b83d', real: '#ff5c7a' \}\)/);
  assert.match(make, /\['tray-test-16\.png', OVERLAY_COLORS\.test,/, 'tray dot and badge share one colour source');
  assert.match(make, /\['tray-real-16\.png', OVERLAY_COLORS\.real,/);
});

// ── main.js wiring (real functions in a sandbox) ─────────────────────────────

function liftFunction(source, name) {
  const head = source.match(new RegExp(`(?:async )?function ${name}\\s*\\(`));
  if (!head) throw new Error(`function ${name} not found`);
  let i = head.index + head[0].length;
  for (let parens = 1; parens > 0; i++) {
    if (source[i] === '(') parens++;
    else if (source[i] === ')') parens--;
  }
  i = source.indexOf('{', i);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(head.index, i + 1);
}

function liftStatement(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`statement ${marker} not found`);
  let i = source.indexOf('(', start + marker.length - 1);
  for (let parens = 0; i < source.length; i++) {
    if (source[i] === '(') parens++;
    else if (source[i] === ')' && --parens === 0) break;
  }
  return source.slice(start, i + 2);
}

const WIRED = ['isCompletionInFlight', 'hasCancellableRun', 'refreshTrayMenu', 'snoozeMenuLabel', 'emitTimerUpdate',
  'setTaskbarProgress', 'applyTaskbarPresence', 'cancelFromTaskbar', 'refreshShellSurfaces', 'reapplyTaskbarAfterShow',
  'pauseTimer', 'resumeTimer', 'snoozeTimer', 'cancelTimer', 'executePowerAction', 'completeTimer', 'formatAction'];

function mainSandbox({ qaPowerLock = false, dispatch } = {}) {
  const win = stubWindow();
  const log = { menus: [], notices: [], dispatched: [], timers: [] };
  const context = {
    console, Date, Math, Number, Boolean, JSON, String, Promise, AbortController: globalThis.AbortController,
    process: { platform: 'win32' },
    require: id => {
      assert.equal(id, './taskbarPresence');
      return { createTaskbarPresence: deps => taskbar.createTaskbarPresence({ ...deps, platform: 'win32' }) };
    },
    __dirname: root,
    nativeImage,
    nativeTheme: { shouldUseDarkColorsForSystemIntegratedUI: true },
    screen: { getDisplayMatching: () => ({ scaleFactor: 1 }) },
    setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; },
    clearTimeout() {},
    mainWindow: win,
    tray: { setContextMenu: menu => log.menus.push(menu) },
    Menu: { buildFromTemplate: template => template.filter(item => item.label).map(item => item.label) },
    app: {},
    timerState: { running: false, paused: false, dryRun: true, action: 'shutdown', totalSeconds: 0, remainingSeconds: 0, endsAt: null, phase: 'idle', gracePeriod: 2 },
    activeReceiptId: null,
    completionGuardController: null,
    lastLifecycleCheckpointAt: 0,
    lastTaskbarProgress: null,
    taskbarReapplyTimer: null,
    DESKTOP_UX_PROOF: false,
    QA_POWER_LOCK: qaPowerLock,
    realPowerActionLog: [],
    settingsStore: { getSection: () => ({ dryRun: true }) },
    overrideTax: { assessSnoozeCost: () => ({ level: 1 }), recordSnooze: () => ({ allowed: true, level: 0 }) },
    smartLights: { getConfig: () => ({ enabled: false }), resetSmartLightState() {} },
    runReceipts: {
      updateRunReceipt() {}, getReceiptById: () => null, receiptPaused() {}, receiptSnoozed() {},
      recordActionEvent: () => ({ persistence: { saved: true } })
    },
    restoreAfterTimer: () => Promise.resolve({ success: true }),
    sendAccountability() {},
    clearTimerInterval() {},
    persistActiveTimer() {},
    bumpCompanionStateRevision() {},
    writeTimerLifecycle() {},
    writeStartupLog() {},
    updateWidget() {},
    updateTrayText() {},
    toggleMainWindow() {},
    startQuickTimer() {},
    showNativeNotification: (_title, body) => log.notices.push(body),
    dispatchPowerAction: dispatch || (async options => { log.dispatched.push(options.action); return { success: true }; }),
    streaks: { recordEvent() {} },
    sleepDebt: { estimateSleepHours: () => 8, recordNight() {} },
    windDownChanges: { mediaPause: null },
    isCompletionStale: () => false,
    playLastLightRitual: async () => {},
    unsavedGuard: { scanUnsavedWork: async () => [] }
  };
  vm.createContext(context);
  vm.runInContext([
    ...WIRED.map(name => liftFunction(mainSource, name)),
    liftStatement(mainSource, "const taskbarPresence = require('./taskbarPresence').createTaskbarPresence("),
    'this.run = { emitTimerUpdate, applyTaskbarPresence, cancelTimer, executePowerAction, completeTimer, hasCancellableRun, reapplyTaskbarAfterShow };'
  ].join('\n'), context);
  const lastMenu = () => log.menus.at(-1) || [];
  return { context, win, log, run: context.run, lastMenu };
}

function startRun(s, { dryRun }) {
  Object.assign(s.context.timerState, {
    running: true, paused: false, dryRun, action: 'shutdown', totalSeconds: 1800, remainingSeconds: 1500,
    endsAt: new Date(Date.now() + 1500 * 1000).toISOString(), phase: 'focus'
  });
  s.context.activeReceiptId = 'r-' + (dryRun ? 'test' : 'real');
  s.run.emitTimerUpdate('started');
}

test('main.js: the thumbnail toolbar drives the real pause/resume/snooze/cancel, and cancel clears everything', () => {
  const s = mainSandbox();
  s.run.applyTaskbarPresence();
  assert.equal(s.win.calls.overlay.length + s.win.calls.thumbar.length, 0, 'idle: nothing set');

  startRun(s, { dryRun: true });
  assert.equal(s.win.calls.overlay.at(-1).file, 'overlay-test-16.png', 'amber badge for Test Mode');
  assert.deepEqual(tips(s.win.calls.thumbar.at(-1)), ['Pause', 'Snooze +5 min (logged)', 'Cancel Timer'], 'snooze cost label shared with the tray');

  s.win.calls.thumbar.at(-1)[0].click();
  assert.equal(s.context.timerState.paused, true, 'Pause ran pauseTimer');
  assert.equal(s.win.calls.overlay.at(-1).file, 'overlay-test-paused-16.png');
  assert.equal(s.win.calls.progress.at(-1).mode, 'paused', 'taskbar progress behaviour kept');
  assert.deepEqual(tips(s.win.calls.thumbar.at(-1)), ['Resume', 'Snooze +5 min (logged)', 'Cancel Timer']);

  s.win.calls.thumbar.at(-1)[0].click();
  assert.equal(s.context.timerState.paused, false, 'Resume ran resumeTimer');
  assert.equal(s.win.calls.overlay.at(-1).file, 'overlay-test-16.png');

  const total = s.context.timerState.totalSeconds;
  s.win.calls.thumbar.at(-1)[1].click();
  assert.equal(s.context.timerState.totalSeconds, total + 300, 'Snooze ran snoozeTimer(300)');

  s.win.calls.thumbar.at(-1)[2].click();
  assert.equal(s.context.timerState.running, false, 'Cancel ran cancelTimer');
  assert.equal(s.context.activeReceiptId, null);
  assert.deepEqual(s.win.calls.overlay.at(-1), { file: null, description: '' }, 'badge cleared');
  assert.deepEqual(s.win.calls.thumbar.at(-1), [], 'buttons removed');
  assert.ok(s.lastMenu().includes('Start 28 min'), 'the tray offers quick starts again');
  assert.ok(!s.lastMenu().includes('Cancel pending power action'), 'and no stale pending-cancel item');
  assert.deepEqual(s.log.notices, [], 'a countdown cancel does not toast (the tray does not either)');
});

test('main.js: a REAL completion keeps the rose badge with only Cancel, which works like the tray', () => {
  const s = mainSandbox();
  startRun(s, { dryRun: false });
  assert.equal(s.win.calls.overlay.at(-1).file, 'overlay-real-16.png', 'rose badge for a REAL action');
  assert.match(s.win.calls.overlay.at(-1).description, /REAL Shutdown countdown running/);

  s.context.timerState.running = false; // countdown reached zero; the completion owns the receipt
  s.run.emitTimerUpdate('complete', { message: 'Timer complete' });
  assert.equal(s.run.hasCancellableRun(), true);
  assert.equal(s.win.calls.overlay.at(-1).file, 'overlay-real-16.png');
  assert.match(s.win.calls.overlay.at(-1).description, /REAL Shutdown pending/);
  assert.deepEqual(tips(s.win.calls.thumbar.at(-1)), ['Cancel pending power action']);
  assert.deepEqual(plain(s.lastMenu().filter(label => /Cancel/.test(label))), ['Cancel pending power action']);

  s.win.calls.thumbar.at(-1)[0].click();
  assert.equal(s.context.activeReceiptId, null, 'cancelTimer released the run');
  assert.deepEqual(s.log.notices, ['Timer cancelled'], 'same confirmation as the tray and Ctrl+Shift+X');
  assert.deepEqual(s.win.calls.thumbar.at(-1), []);
  assert.deepEqual(s.win.calls.overlay.at(-1), { file: null, description: '' });
  assert.ok(!s.lastMenu().includes('Cancel pending power action'));
});

test('main.js: cancelling a countdown goes straight to idle, never flashing the pending-cancel badge/toolbar', () => {
  for (const dryRun of [true, false]) {
    for (const cancel of ['thumbar', 'tray/shortcut']) {
      const s = mainSandbox();
      startRun(s, { dryRun });
      const overlays = s.win.calls.overlay.length;
      const toolbars = s.win.calls.thumbar.length;
      if (cancel === 'thumbar') s.win.calls.thumbar.at(-1)[2].click();
      else s.run.cancelTimer();
      const label = `${dryRun ? 'Test Mode' : 'REAL'} via ${cancel}`;
      assert.deepEqual(s.win.calls.overlay.slice(overlays), [{ file: null, description: '' }], `${label}: one overlay update, to none`);
      assert.deepEqual(s.win.calls.thumbar.slice(toolbars), [[]], `${label}: one toolbar update, to no buttons`);
    }
  }
});

test('main.js: a cancel click after the run already ended does nothing', () => {
  const s = mainSandbox();
  startRun(s, { dryRun: false });
  const cancel = s.win.calls.thumbar.at(-1)[2];
  s.run.cancelTimer();
  const overlays = s.win.calls.overlay.length;
  cancel.click();
  assert.equal(s.win.calls.overlay.length, overlays, 'guarded by hasCancellableRun');
  assert.deepEqual(s.log.notices, []);
});

test('main.js: a Test Mode completion clears the badge, the toolbar and the tray pending-cancel item', async () => {
  const s = mainSandbox();
  startRun(s, { dryRun: true });
  s.context.timerState.running = false;
  s.run.emitTimerUpdate('complete', { message: 'Timer complete' });
  assert.deepEqual(tips(s.win.calls.thumbar.at(-1)), ['Cancel Test Mode run']);

  await s.run.executePowerAction({ action: 'shutdown', dryRun: true });
  assert.equal(s.context.activeReceiptId, null);
  assert.deepEqual(s.win.calls.overlay.at(-1), { file: null, description: '' });
  assert.deepEqual(s.win.calls.thumbar.at(-1), []);
  assert.ok(s.lastMenu().includes('Start 28 min') && !s.lastMenu().includes('Cancel pending power action'),
    'the tray menu built last is the idle one');
  assert.deepEqual(s.log.dispatched, [], 'nothing was dispatched');
});

test('main.js: a QA-locked REAL completion clears everything too', async () => {
  const s = mainSandbox({ qaPowerLock: true });
  startRun(s, { dryRun: false });
  s.context.timerState.running = false;
  s.run.emitTimerUpdate('complete', { message: 'Timer complete' });
  await s.run.executePowerAction({ action: 'shutdown', dryRun: false });
  assert.deepEqual(s.log.dispatched, [], 'blocked');
  assert.deepEqual(s.win.calls.thumbar.at(-1), []);
  assert.ok(!s.lastMenu().includes('Cancel pending power action'));
});

test('main.js: Sleep keeps Cancel through its native pre-commit, then clears when the request settles', async () => {
  let duringDispatch = null;
  const s = mainSandbox({
    dispatch: async () => {
      duringDispatch = { cancellable: s.run.hasCancellableRun(), buttons: tips(s.win.calls.thumbar.at(-1)) };
      return { success: true };
    }
  });
  startRun(s, { dryRun: false });
  s.context.timerState.action = 'sleep';
  s.context.timerState.running = false;
  s.run.emitTimerUpdate('complete', { message: 'Timer complete' });
  await s.run.executePowerAction({ action: 'sleep', dryRun: false, receiptId: 'r-real' });
  assert.deepEqual(duringDispatch, { cancellable: true, buttons: ['Cancel pending power action'] });
  assert.equal(s.context.completionGuardController, null);
  assert.deepEqual(s.win.calls.thumbar.at(-1), [], 'no Cancel left once the guard is released');
  assert.deepEqual(s.win.calls.overlay.at(-1), { file: null, description: '' });
  assert.ok(!s.lastMenu().includes('Cancel pending power action'));
});

test('main.js: a cancel during the unsaved-work scan leaves nothing pending once the scan unwinds', async () => {
  let releaseScan;
  const s = mainSandbox();
  s.context.unsavedGuard = {
    scanUnsavedWork: ({ signal }) => new Promise((resolve, reject) => {
      releaseScan = resolve;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORTED' })));
    })
  };
  startRun(s, { dryRun: false });
  const completion = s.run.completeTimer();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(s.context.completionGuardController, 'the scan is running');
  assert.deepEqual(tips(s.win.calls.thumbar.at(-1)), ['Cancel pending power action']);

  s.win.calls.thumbar.at(-1)[0].click();
  await completion;
  assert.equal(typeof releaseScan, 'function');
  assert.equal(s.context.completionGuardController, null);
  assert.deepEqual(s.log.dispatched, [], 'the cancelled run never reaches dispatch');
  assert.deepEqual(s.win.calls.thumbar.at(-1), [], 'no stale Cancel after the scan unwound');
  assert.deepEqual(s.win.calls.overlay.at(-1), { file: null, description: '' });
  assert.ok(!s.lastMenu().includes('Cancel pending power action'));
});

test('main.js: once the countdown ends, the awaited completion steps offer only Cancel (no dead Pause/Snooze)', async () => {
  let releaseRestore;
  const s = mainSandbox();
  // completeTimer awaits the Wi-Fi restore before it emits 'complete' (the
  // cancel's own restore call settles at once).
  s.context.restoreAfterTimer = () => (releaseRestore
    ? Promise.resolve({ success: true })
    : new Promise(resolve => { releaseRestore = resolve; }));
  startRun(s, { dryRun: false });
  assert.deepEqual(tips(s.win.calls.thumbar.at(-1)), ['Pause', 'Snooze +5 min (logged)', 'Cancel Timer']);

  const completion = s.run.completeTimer();
  assert.equal(typeof releaseRestore, 'function', 'completion is waiting on the restore');
  assert.equal(s.context.timerState.running, false);
  assert.deepEqual(tips(s.win.calls.thumbar.at(-1)), ['Cancel pending power action'],
    'Pause/Snooze would be no-ops now (pauseTimer/snoozeTimer refuse a finished countdown)');
  assert.equal(s.win.calls.overlay.at(-1).file, 'overlay-real-16.png', 'the rose badge stays while the run is pending');
  assert.ok(s.lastMenu().includes('Cancel pending power action') && !s.lastMenu().includes('Pause'), 'the tray agrees');

  s.win.calls.thumbar.at(-1)[0].click();
  releaseRestore({ success: true });
  await completion;
  assert.deepEqual(s.log.dispatched, [], 'a cancel during the restore wins; nothing is dispatched');
  assert.deepEqual(s.win.calls.thumbar.at(-1), []);
  assert.deepEqual(s.win.calls.overlay.at(-1), { file: null, description: '' });
});

test('main.js: a tray or taskbar refresh failure never escapes into the timer or power-action paths', async () => {
  // The tray breaks while the power request is out, so only the refresh in
  // executePowerAction's finally meets it.
  const s = mainSandbox({
    dispatch: async () => {
      s.context.tray = { setContextMenu() { throw new Error('Tray is destroyed'); } };
      return { success: true, outcome: 'dispatched' };
    }
  });
  const logs = [];
  s.context.writeStartupLog = message => logs.push(message);
  startRun(s, { dryRun: false });

  s.context.overrideTax.assessSnoozeCost = () => { throw new Error('override tax unreadable'); };
  assert.doesNotThrow(() => s.run.applyTaskbarPresence());
  assert.ok(logs.includes('Taskbar presence update failed'));
  s.context.overrideTax.assessSnoozeCost = () => ({ level: 0 });

  s.context.timerState.running = false;
  s.run.emitTimerUpdate('complete', { message: 'Timer complete' });
  const result = await s.run.executePowerAction({ action: 'shutdown', dryRun: false, receiptId: 'r-real' });
  assert.deepEqual(plain(result), { success: true, outcome: 'dispatched' }, 'the dispatch result is not replaced by the refresh failure');
  assert.ok(logs.includes('Tray menu refresh failed'));
  assert.deepEqual(s.win.calls.thumbar.at(-1), [], 'the taskbar is still cleared');
  assert.deepEqual(s.win.calls.overlay.at(-1), { file: null, description: '' });
});

test('main.js: nothing is set and nothing throws once the main window is destroyed or gone', () => {
  const s = mainSandbox();
  s.win.destroy();
  assert.doesNotThrow(() => startRun(s, { dryRun: false }));
  assert.doesNotThrow(() => s.run.reapplyTaskbarAfterShow());
  s.context.mainWindow = null;
  assert.doesNotThrow(() => s.run.cancelTimer());
  assert.deepEqual(s.win.calls, { overlay: [], thumbar: [], progress: [] });
});

test('main.js: showing the window again re-sends the badge and progress to the new taskbar button', () => {
  const s = mainSandbox();
  startRun(s, { dryRun: true });
  s.win.calls.thumbar.at(-1)[0].click(); // paused: progress is not re-sent by ticks
  const overlays = s.win.calls.overlay.length;
  const progress = s.win.calls.progress.length;
  s.run.reapplyTaskbarAfterShow();
  assert.equal(s.win.calls.overlay.length, overlays + 1, 'badge re-sent immediately');
  assert.equal(s.win.calls.progress.at(-1).mode, 'paused');
  assert.equal(s.log.timers.at(-1).ms, 500, 'and again once Explorer has created the button');
  s.log.timers.at(-1).fn();
  assert.equal(s.win.calls.overlay.length, overlays + 2);
  assert.equal(s.win.calls.progress.length, progress + 2);
  assert.match(mainSource, /mainWindow\.on\('show', reapplyTaskbarAfterShow\);/, 'wired to the window show event');
});

test('main.js: the taskbar refresh is wired into every transition and the window/notification icons are the brand mark', () => {
  const emit = liftFunction(mainSource, 'emitTimerUpdate');
  assert.match(emit, /if \(type !== 'tick'\) refreshTrayMenu\(\);[\s\S]{0,300}if \(type !== 'tick' && type !== 'cancelled'\) applyTaskbarPresence\(\);/,
    'never on ticks; a cancel is applied by cancelTimer once its receipt is closed');
  assert.match(liftFunction(mainSource, 'cancelTimer'), /activeReceiptId = null;\s*\}\s*\/\/[^\n]*\n\s*refreshShellSurfaces\(\);/);
  const power = liftFunction(mainSource, 'executePowerAction');
  assert.equal((power.match(/refreshShellSurfaces\(\);/g) || []).length, 3, 'Test Mode, QA lock and the dispatch finally');
  assert.match(liftFunction(mainSource, 'completeTimer'), /finally \{\s*if \(completionGuardController === guardController\) completionGuardController = null;[\s\S]{0,120}refreshShellSurfaces\(\);/);
  assert.match(mainSource, /const NOTIFICATION_ICON = path\.join\(__dirname, 'assets', 'icon-256\.png'\);/);
  assert.match(liftFunction(mainSource, 'showNativeNotification'), /icon: NOTIFICATION_ICON,/);
  assert.match(liftFunction(mainSource, 'createWidgetWindow'), /skipTaskbar: true,[\s\S]{0,200}icon: APP_ICON,/);
  assert.match(liftFunction(mainSource, 'createWindow'), /icon: APP_ICON,/);
  assert.doesNotMatch(mainSource, /setAppUserModelId/, 'the AppUserModelId (and the Run-at-login value name) is untouched');
});
