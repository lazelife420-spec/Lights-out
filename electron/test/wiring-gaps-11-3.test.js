'use strict';
// v11.3 wiring audit: each control, setting and channel below did something
// different from what the UI said (or nothing at all). Every test runs the
// real function body from the shipped source where it can, so it fails if the
// fix is reverted.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const mainSource = read('main.js');
const rendererSource = read('renderer.js');
const html = read('index.html');

function extractFunction(source, name) {
  const head = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!head) throw new Error(`function ${name} not found`);
  let i = head.index + head[0].length;
  for (let depth = 1; depth > 0 && i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') depth--;
  }
  while (i < source.length && source[i] !== '{') i++;
  i++;
  for (let depth = 1; depth > 0 && i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
  }
  return source.slice(head.index, i);
}

function handler(channel) {
  const at = mainSource.indexOf(`ipcMain.handle('${channel}'`);
  assert.ok(at >= 0, `${channel} handler exists`);
  return mainSource.slice(at, mainSource.indexOf('\n});', at) + 4);
}

// ------------------------------------------------------------------ W01
test('saving a Content Blocker schedule keeps the blocker on and its custom blocklist', () => {
  const capabilityTruth = require('../capabilityTruth');
  const store = { contentBlocker: { enabled: true, useDefault: false, blocklist: ['x.com', 'y.com'], schedules: [] } };
  const settingsStore = {
    getSection: name => store[name],
    updateSection: (name, value) => { store[name] = { ...store[name], ...value }; }
  };
  const box = { settingsStore, capabilityTruth };
  vm.runInNewContext(`${extractFunction(mainSource, 'mergedContentBlockerSettings')}\nthis.merge = mergedContentBlockerSettings;`, box);
  const rule = { id: 'r1', label: 'Weeknights', days: ['mon'], start: '22:00', end: '06:00', enabled: true };
  const saved = box.merge({ schedules: [rule] });
  assert.equal(saved.enabled, true, 'a schedules-only save never switches the blocker off');
  assert.equal(saved.useDefault, false);
  assert.deepEqual([...saved.blocklist], ['x.com', 'y.com'], 'the custom blocklist survives');
  assert.equal(saved.schedules[0].id, 'r1');
  // The bare patch is what the old handler sanitized: it read as off.
  assert.equal(capabilityTruth.sanitizeContentBlocker({ schedules: [rule] }).enabled, false, 'control: the unmerged patch is the bug');
  assert.match(handler('save-content-blocker-settings'), /const sanitized = mergedContentBlockerSettings\(s\);/);
  assert.match(handler('save-app-settings'), /mergedContentBlockerSettings\(settings\.contentBlocker\)/);
});

// ------------------------------------------------------------------ W03
test('the soft blue finish beacon is restored at startup and on Settings Cancel', () => {
  const box = {};
  vm.runInNewContext(`${extractFunction(rendererSource, 'smartLightsStateFromPublicConfig')}\nthis.map = smartLightsStateFromPublicConfig;`, box);
  assert.equal(box.map({ provider: 'wiz', timerBeacon: true }).timerBeacon, true);
  assert.equal(box.map({ provider: 'wiz' }).timerBeacon, false);
  assert.equal(box.map(null).provider, 'none', 'a missing config still maps');
  const uses = rendererSource.match(/state\.smartLights = smartLightsStateFromPublicConfig\(lightConfig\);/g) || [];
  assert.equal(uses.length, 2, 'startup hydration and discardSettingsPanelChanges share one mapping');
  assert.doesNotMatch(rendererSource, /state\.smartLights = \{\n\s+enabled: lightConfig\.enabled/, 'no hand-built literal can drop a field again');
});

// ------------------------------------------------------------------ W04
function loadSettings(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-wiring-gaps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(root, 'settings.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  m.require = request => request === 'electron' ? { app: { getPath: () => dir }, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from('fixture:' + text),
    decryptString: bytes => bytes.toString().slice(8)
  } } : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  return { settings: m.exports, primary: path.join(dir, 'settings.json') };
}

test('onboarding saves Last Light under the keys main reads', () => {
  const saves = [];
  const box = {
    els: { onboarding: { style: {} } },
    onboardData: { sequence: 'ExitTheGrid', sound: false },
    api: { saveAppSettings: patch => { saves.push(patch); return Promise.resolve({}); } },
    state: { lastLight: {}, customization: {} },
    render() {}, updateLastLightUIFromState() {}, setInputFromSeconds() {}, notify() {}
  };
  vm.runInNewContext(`${extractFunction(read('renderer-onboarding-updater.js'), 'hideOnboarding')}\nhideOnboarding();`, box);
  const lastLight = saves.find(p => p.lastLight).lastLight;
  assert.deepEqual({ ...lastLight }, { enabled: true, sequence: 'ExitTheGrid', sound: 'Off' });
});

test('a Last Light choice saved under the old onboarding keys is migrated on load', t => {
  const { settings, primary } = loadSettings(t);
  fs.writeFileSync(primary, JSON.stringify({ lastLight: { lastLightEnabled: true, lastLightSequence: 'ExitTheGrid', lastLightSound: 'Soft' } }));
  settings.load();
  const ll = settings.getSection('lastLight');
  assert.equal(ll.enabled, true);
  assert.equal(ll.sequence, 'ExitTheGrid');
  assert.equal(ll.sound, 'Soft');
  for (const key of ['lastLightEnabled', 'lastLightSequence', 'lastLightSound']) assert.equal(key in ll, false, `${key} is dropped`);
  // A canonical value the user saved wins over a stray legacy key.
  assert.deepEqual(settings.migrateLegacyLastLight({ enabled: false, lastLightEnabled: true, sequence: 'ClassicFade' }), { enabled: false, sequence: 'ClassicFade' });
});

// ------------------------------------------------------------------ W05
test('a profile’s Last Light reaches its run, and never becomes the global setting', async () => {
  const sent = [];
  const box = {
    settingsStore: { getSection: name => (name === 'lastLight' ? { enabled: false, sequence: 'ClassicFade', sound: 'Off' } : {}) },
    lastLight: { normalizeId: id => id || 'ClassicFade', getDurationMs: () => 0 },
    mainWindow: { isDestroyed: () => false, isVisible: () => true, webContents: { send: (c, d) => sent.push({ c, d }) } },
    timerState: { action: 'lock', forceShutdown: false },
    setTimeout: fn => fn(),
    Promise
  };
  vm.runInNewContext([
    extractFunction(mainSource, 'profileLastLight'),
    extractFunction(mainSource, 'runLastLightSettings'),
    extractFunction(mainSource, 'playLastLightRitual'),
    'this.profileLastLight = profileLastLight; this.play = playLastLightRitual;'
  ].join('\n'), box);
  assert.equal(box.profileLastLight(null), null);
  assert.equal(box.profileLastLight({ lastLightEnabled: false }), null, 'an off profile defers to the setting');
  const own = box.profileLastLight({ lastLightEnabled: true, lastLightSequence: 'ExitTheGrid', lastLightSound: 'Soft' });
  assert.deepEqual({ ...own }, { enabled: true, sequence: 'ExitTheGrid', sound: 'Soft' });
  await box.play(true, own);
  assert.equal(sent.length, 1, 'the profile turns Last Light on for its run although the setting is off');
  assert.equal(sent[0].d.sequence, 'ExitTheGrid');
  await box.play(true, null);
  assert.equal(sent.length, 1, 'without a profile choice the off setting applies');

  assert.match(extractFunction(mainSource, 'beginValidatedCountdown'), /timerState\.lastLight = profileLastLight\(identity\.profileId \? profiles\.getById\(identity\.profileId\) : null\);/);
  assert.match(extractFunction(mainSource, 'completeTimer'), /await playLastLightRitual\(completionOptions\.dryRun, completionOptions\.lastLight\);/);
  assert.doesNotMatch(read('renderer-profiles.js'), /state\.lastLight\.(enabled|sequence|sound) =/, 'loading a profile cannot change what Save persists');
});

// ------------------------------------------------------------------ W06
test('the unwired Graceful close toggle is gone and receipts no longer claim it', () => {
  assert.doesNotMatch(html, /id="chk-graceful"|Graceful close/);
  assert.doesNotMatch(rendererSource, /gracefulClose|chkGraceful/);
  assert.doesNotMatch(read('renderer-settings.js'), /gracefulClose/);
  assert.doesNotMatch(read('runReceipts.js'), /gracefulClose: timerState/);
  assert.equal('gracefulClose' in require('../settings').DEFAULTS.app, false);
});

// ------------------------------------------------------------------ W07
test('every main-to-renderer channel has a preload listener, and Ctrl+Shift+A is not taken', () => {
  const senders = [mainSource, read('autopilot.js')].join('\n');
  const sent = new Set([...senders.matchAll(/webContents\.send\('([^']+)'/g)].map(m => m[1]));
  const preloads = [read('preload.js'), read('widget-preload.js')].join('\n');
  const listened = new Set([...preloads.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map(m => m[1]));
  assert.ok(sent.size > 30, 'the scan found the channels');
  assert.deepEqual([...sent].filter(c => !listened.has(c)), [], 'no message is sent into the void');
  assert.doesNotMatch(mainSource, /globalShortcut\.register\('Ctrl\+Shift\+A'/);
});

// ------------------------------------------------------------------ W08
function fakeInput(value) {
  const listeners = {};
  return {
    value, dataset: {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
    fire: type => listeners[type](),
    listeners
  };
}

test('the deficit card sets the wake time and target the estimate really uses', async () => {
  const wake = fakeInput('07:00');
  const target = fakeInput('8');
  const calls = [];
  const box = {
    document: { getElementById: id => ({ 'sleep-wake-time': wake, 'sleep-target-hours': target })[id] || null, activeElement: null },
    api: {
      setWakeTime: async t => { calls.push(['wake', t]); return t; },
      setSleepTarget: async h => { calls.push(['target', h]); return h; },
      getSleepDebt: async () => null
    },
    Number, String
  };
  vm.runInNewContext(`${extractFunction(read('renderer-ritual-focus.js'), 'hydrateSleepDebtControls')}\nasync function loadSleepDebt() {}\nthis.hydrate = hydrateSleepDebtControls;`, box);
  box.hydrate({ wakeTime: '06:15', targetHours: 7.5 });
  assert.equal(wake.value, '06:15');
  assert.equal(target.value, '7.5');
  box.hydrate({ wakeTime: '06:15', targetHours: 7.5 });
  wake.value = '05:45';
  await wake.fire('change');
  target.value = '9';
  await target.fire('change');
  assert.deepEqual(calls, [['wake', '05:45'], ['target', 9]], 'each change persists once, even after a second hydrate');
  assert.match(html, /id="sleep-wake-time"/);
  assert.match(html, /id="sleep-target-hours"/);
  const complete = extractFunction(mainSource, 'completeTimer');
  assert.match(complete, /const wakeTime = sleepDebt\.getWakeTime\(\);/);
  assert.doesNotMatch(complete, /appSettings\.wakeTime/, 'never the app key nothing writes');
});

test('sleepDebt.getWakeTime returns the wake time set-wake-time stored', () => {
  const sleepDebt = require('../sleepDebt');
  assert.equal(typeof sleepDebt.getWakeTime, 'function');
  assert.match(handler('set-wake-time'), /sleepDebt\.setWakeTime\(time\)/);
  assert.match(read('sleepDebt.js'), /function getWakeTime\(\) \{\s*const data = load\(\);\s*return isValidTimeHHMM\(data\.wakeTime\) \? data\.wakeTime : '07:00';/);
});

// ------------------------------------------------------------------ W09
test('Import all data reloads main’s caches, and the renderer re-reads instead of asking for a restart', () => {
  const calls = [];
  const sections = { smartLights: { provider: 'wiz' }, lastLight: { customSequences: [{ id: 'c' }] }, app: { bedtimeReminderMinutes: 20, idleDetectionEnabled: true, idleThresholdSeconds: 600 } };
  const box = {
    settingsStore: { getSection: name => sections[name] },
    smartLights: { loadConfig: c => calls.push(['lights', c.provider]) },
    lastLight: { loadCustomSequences: s => calls.push(['finales', s.length]) },
    bedtimeReminder: { setMinutesBefore: m => calls.push(['reminder', m]) },
    idleDetection: { setThreshold: s => calls.push(['idle', s]) },
    autopilot: { schedule: () => calls.push(['autopilot']) },
    startTimer() { throw new Error('import never starts a timer'); },
    mainWindow: {},
    checkContentBlockerSchedules: () => calls.push(['blocker']),
    updateTrayText() {}, refreshTrayMenu() {}, updateWidget: () => calls.push(['shell']),
    writeStartupLog: () => calls.push(['failed'])
  };
  vm.runInNewContext(`${extractFunction(mainSource, 'rehydrateAfterImport')}\nrehydrateAfterImport();`, box);
  assert.deepEqual(calls, [['lights', 'wiz'], ['finales', 1], ['reminder', 20], ['idle', 600], ['autopilot'], ['blocker'], ['shell']]);
  const body = handler('import-all-data');
  assert.ok(body.indexOf('rehydrateAfterImport();') > body.indexOf('streaks.replaceAll'), 'after every section landed');
  assert.doesNotMatch(extractFunction(mainSource, 'rehydrateAfterImport'), /startRemoteControl|remoteControl\.start/);
  assert.doesNotMatch(rendererSource, /Restart to see all changes/);
  assert.match(rendererSource, /await reloadAfterImport\(\);/);
  assert.match(extractFunction(rendererSource, 'reloadAfterImport'), /await discardSettingsPanelChanges\(\);/);
});

test('a backup never carries this PC’s armed Autopilot fire time', t => {
  const { settings } = loadSettings(t);
  assert.deepEqual(settings.importableSection('app', { autopilotNextFireAt: 1767225600000, bedtime: '23:00' }), { bedtime: '23:00' });
});

// ------------------------------------------------------------------ W10
function restoreSandbox({ opacity = 0.8, miniMode = false } = {}) {
  const calls = { opacity: [], onTop: [], menu: [] };
  const box = {
    miniMode,
    settingsStore: { getSection: name => (name === 'customization' ? { opacity } : name === 'app' ? { lockoutOnDim: true } : null) },
    mainWindow: {
      isDestroyed: () => false,
      setOpacity: v => calls.opacity.push(v),
      setAlwaysOnTop: (...a) => calls.onTop.push(a),
      setMenuBarVisibility: v => calls.menu.push(v),
      webContents: { send() {} }
    },
    media: { resumeAllMedia: async () => {} },
    executePowerShell: async () => '',
    contentBlocker: { isAnyScheduleActive: () => false, unblockSites: async () => {} },
    Promise
  };
  const windDown = mainSource.slice(mainSource.indexOf('const windDownChanges = '), mainSource.indexOf(';\n', mainSource.indexOf('const windDownChanges = ')) + 1);
  vm.runInNewContext([windDown, extractFunction(mainSource, 'userWindowOpacity'), extractFunction(mainSource, 'restoreAfterTimer'),
    'this.windDownChanges = windDownChanges; this.restore = restoreAfterTimer; this.userWindowOpacity = userWindowOpacity;'].join('\n'), box);
  return { box, calls };
}

test('a run’s end returns the window to the user’s opacity and keeps mini mode on top', () => {
  const plain = restoreSandbox({ opacity: 0.8, miniMode: true });
  plain.box.restore({ reason: 'cancel' });
  assert.deepEqual(plain.calls.opacity, [0.8], 'Appearance opacity, not 1');
  assert.deepEqual(plain.calls.onTop, [], 'no lockout ran, so always-on-top is left alone');
  assert.deepEqual(plain.calls.menu, []);

  const locked = restoreSandbox({ opacity: 1, miniMode: true });
  locked.box.windDownChanges.lockoutApplied = true;
  locked.box.restore({ reason: 'complete' });
  assert.deepEqual(locked.calls.onTop.map(a => [...a]), [[true, 'floating']], 'mini mode stays floating after a lockout');
  assert.equal(locked.box.windDownChanges.lockoutApplied, false, 'undone once');

  assert.equal(restoreSandbox({ opacity: 0.2 }).box.userWindowOpacity(), 0.5, 'clamped like set-window-opacity');
  assert.equal(restoreSandbox({ opacity: 'x' }).box.userWindowOpacity(), 1);
  assert.match(extractFunction(mainSource, 'applyDimPhase'), /windDownChanges\.lockoutApplied = true;/);
  assert.match(extractFunction(mainSource, 'playFirstLight'), /mainWindow\.setOpacity\(userWindowOpacity\(\)\);/);
  assert.doesNotMatch(mainSource, /setOpacity\(1\)/);
});

// ------------------------------------------------------------------ CT-01..CT-06
test('the Idle clock explanation is not a click target', () => {
  const at = html.indexOf('<span class="set-row-title">Idle clock</span>');
  const open = html.lastIndexOf('<', html.lastIndexOf('<span class="set-row-text">', at) - 1);
  assert.match(html.slice(open, open + 60), /^<div class="checkbox-label set-row-static">/);
  assert.match(read('styles.css'), /\.settings-categories \.set-row-static \{ cursor: default; \}/);
});

test('the First Light box shows whether an alarm really exists, including after Cancel', async () => {
  const els = { chkAlarm: { checked: true }, alarmConfig: { style: { display: 'block' } }, alarmStatus: { textContent: '', style: {} } };
  let status = { active: false };
  const box = { els, api: { getWakeAlarmStatus: async () => status } };
  vm.runInNewContext(`${extractFunction(read('renderer-lastlight-alarm.js'), 'refreshAlarmStatus')}\nthis.refresh = refreshAlarmStatus;`, box);
  await box.refresh();
  assert.equal(els.chkAlarm.checked, false, 'a tick that scheduled nothing is cleared');
  assert.equal(els.alarmConfig.style.display, 'none');
  status = { active: true, alarmTime: '06:30' };
  await box.refresh();
  assert.equal(els.chkAlarm.checked, true);
  assert.equal(els.alarmConfig.style.display, 'block', 'the status line is in view');
  assert.match(els.alarmStatus.textContent, /06:30/);
  assert.match(extractFunction(rendererSource, 'discardSettingsPanelChanges'), /await refreshAlarmStatus\(\);/);
});

test('the multi-tap signatures are text, not buttons that do nothing', () => {
  assert.match(html, /<span class="footer-branding brand-secret" id="brand-signature">/);
  assert.match(html, /<span id="version" class="brand-secret">v\d+\.\d+\.\d+<\/span>/);
  assert.doesNotMatch(html, /<button[^>]*id="(brand-signature|version)"/);
});

test('the ledger buttons say they copy, because they copy', () => {
  assert.doesNotMatch(html, /Export ledger/);
  for (const id of ['btn-export-streaks', 'btn-export-receipts']) {
    const at = html.indexOf(`id="${id}"`);
    assert.match(html.slice(at, html.indexOf('</button>', at)), /Copy ledger$/, `${id} reads Copy ledger`);
  }
});

test('the LAN address is logged when it changes, not on every status poll', () => {
  const osModule = require('node:os');
  const family = require('../family');
  const original = osModule.networkInterfaces;
  const originalLog = console.log;
  const logs = [];
  let nets = { 'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.20' }] };
  osModule.networkInterfaces = () => nets;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    for (let i = 0; i < 5; i++) family.getLocalIPs();
    assert.equal(logs.filter(l => l.startsWith('Selected LAN IP')).length, 1);
    nets = { Ethernet: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }] };
    family.getLocalIPs();
    assert.equal(logs.filter(l => l.startsWith('Selected LAN IP')).length, 2, 'a new address is logged');
  } finally {
    osModule.networkInterfaces = original;
    console.log = originalLog;
  }
});

test('once the countdown has started, leaving the ritual says the countdown keeps running', () => {
  const button = { textContent: 'Cancel ritual' };
  const els = {
    ritualOverlay: { style: {}, classList: { add() {} }, setAttribute() {} },
    ritualStepIcon: {}, ritualStepTitle: {}, ritualStepDesc: {},
    btnRitualSkip: { style: {} }, btnRitualNext: {}, btnRitualCancel: button
  };
  const src = read('renderer-ritual-focus.js');
  const box = { els, RITUAL_ICONS: {}, RITUAL_DESCS: {}, hideRitualOverlay() {} };
  vm.runInNewContext(`${extractFunction(src, 'updateRitualOverlay')}\nthis.update = updateRitualOverlay;`, box);
  const step = { id: 'lights', label: 'Lights', skippable: true, auto: true };
  box.update({ currentStepInfo: step, totalSteps: 4, currentStep: 1, completedSteps: ['block'] });
  assert.equal(button.textContent, 'Cancel ritual');
  box.update({ currentStepInfo: step, totalSteps: 4, currentStep: 3, completedSteps: ['block', 'dim', 'timer'] });
  assert.equal(button.textContent, 'End ritual · countdown keeps running');
});
