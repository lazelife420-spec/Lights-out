'use strict';
// v11.3 audit: main.js / renderer.js wiring for the area fixes (settings,
// calendar, smart lights, profiles) and the QA login-item hazard.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

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
  const start = head.index;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

function handler(channel) {
  const at = mainSource.indexOf(`ipcMain.handle('${channel}'`);
  assert.ok(at >= 0, `${channel} handler exists`);
  return mainSource.slice(at, mainSource.indexOf('\n});', at) + 4);
}

test('QA, proof and installer-verification launches never add or delete the owner’s login item', () => {
  for (const [label, env, lock] of [['QA power lock', {}, true], ['installer QA', { LIGHTS_OUT_INSTALLER_QA: '1' }, false]]) {
    const writes = [];
    const context = {
      QA_POWER_LOCK: lock,
      process: { env },
      app: { setLoginItemSettings: s => writes.push(s), getLoginItemSettings: () => ({ openAtLogin: true }) },
      Boolean
    };
    vm.runInNewContext(`${liftFunction(mainSource, 'getLoginSettings')}\n${liftFunction(mainSource, 'setRunAtLogin')}\nthis.result = setRunAtLogin(false);`, context);
    assert.deepEqual(writes, [], `${label}: no login-item write`);
    assert.equal(context.result.runAtLogin, true, `${label}: reports the existing state`);
  }
  const writes = [];
  const context = { QA_POWER_LOCK: false, process: { env: {} }, app: { setLoginItemSettings: s => writes.push(s), getLoginItemSettings: () => ({ openAtLogin: false }) }, Boolean };
  vm.runInNewContext(`${liftFunction(mainSource, 'getLoginSettings')}\n${liftFunction(mainSource, 'setRunAtLogin')}\nsetRunAtLogin(true);`, context);
  assert.equal(writes.length, 1, 'a normal launch still writes it');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].args)), ['--minimized', '--no-auto-start'], 'Run at login stays minimized and idle');
});

test('a failed Test Mode / Force write is reported and the toggle shows what is really in force', () => {
  assert.match(handler('save-app-settings'), /settingsStore\.updateSection\('app', settings\.app, \{ requireSave: true \}\);/);
  const persist = rendererSource.slice(rendererSource.indexOf('const persistAdvancedOptions = async patch => {'), rendererSource.indexOf("els.chkDryRun?.addEventListener('change'"));
  assert.match(persist, /notify\(`That setting was not saved/);
  assert.match(persist, /await api\.getAppSettings\(\)/);
  assert.match(persist, /state\.dryRun = current\.dryRun; if \(els\.chkDryRun\) els\.chkDryRun\.checked = current\.dryRun;/);
  assert.match(persist, /state\.forceShutdown = current\.forceShutdown;/);
});

test('startup persists a migrated smart-lights key and remaps migrated profile ids', () => {
  const ready = mainSource.slice(mainSource.indexOf('app.whenReady().then(async () => {'));
  assert.match(ready, /const lightsLoad = smartLights\.loadConfig\(settingsStore\.getSection\('smartLights'\)\);\s*[\s\S]{0,400}if \(lightsLoad && lightsLoad\.migrated\) \{\s*try \{ settingsStore\.updateSection\('smartLights', \{ verifiedConfigKey: smartLights\.getConfig\(\)\.verifiedConfigKey \}, \{ replaceBackup: true \}\); \}/);
  assert.match(ready, /const profileCount = profiles\.initialize\(\);[\s\S]{0,300}settingsStore\.remapProfileReferences\(profiles\.getIdMigrations\(\)\);/);
  for (const channel of ['import-all-data', 'profiles-import']) {
    const body = handler(channel);
    const remap = body.indexOf('settingsStore.remapProfileReferences(profiles.getIdMigrations());');
    assert.ok(remap > 0, `${channel} remaps migrated ids`);
    assert.ok(remap < body.indexOf('profileIdentity.reconcilePersistedSelection(settingsStore, profiles);'), `${channel} remaps before reconciling the selection`);
  }
});

test('toggling calendar auto-start writes only that key', () => {
  const body = handler('set-calendar-auto-start');
  assert.match(body, /settingsStore\.updateSection\('calendar', \{ autoStartFromEvents: !!enabled \}\);/);
  assert.doesNotMatch(body, /getSection\('calendar'\)/, 'never echoes the whole section back');
});

test('an imported event with an unresolved time zone is listed, never auto-started', () => {
  const check = liftFunction(mainSource, 'checkCalendarAutoStart');
  const filter = check.indexOf("if (event.source !== 'builtin' && !isBedtimeEvent(event)) continue;");
  const gate = check.indexOf('if (!calProviders.eventTimeIsTrusted(event)) continue;');
  assert.ok(filter > 0 && gate > filter, 'trusted-time gate follows the bedtime filter');
  assert.ok(gate < check.indexOf('startTimer('), 'and runs before any start');
  assert.match(handler('fetch-calendar-events'), /autoStartEligible: e\.source === 'builtin' \|\| isBedtimeEvent\(e\) && calProviders\.eventTimeIsTrusted\(e\)/,
    'Schedule labels match what auto-start will really do');
  const calProviders = require('../calendarProviders');
  assert.equal(calProviders.eventTimeIsTrusted({ timeZoneUnresolved: true }), false);
  assert.equal(calProviders.eventTimeIsTrusted({ start: '2026-11-25T22:00:00Z' }), true);
});

test('the smart-lights pill trusts main’s verifiedForSetup verdict for digest keys', () => {
  const pill = liftFunction(rendererSource, 'smartLightsPillState');
  const box = {};
  vm.runInNewContext(`${pill}\nthis.pill = smartLightsPillState;`, box);
  assert.equal(box.pill({ provider: 'http', enabled: false, verifiedConfigKey: 'http:POST:#0123456789abcdef', verifiedForSetup: true }).text, 'Verified · off');
  assert.equal(box.pill({ provider: 'http', enabled: false, verifiedConfigKey: 'http:POST:#0123456789abcdef', verifiedForSetup: false }).text, 'Not verified · off');
  assert.equal(box.pill({ provider: 'hue', enabled: false, verifiedConfigKey: '', verifiedForSetup: true }).text, 'Not configured', 'no key is never verified');
});

test('the custom-finale limit is said out loud instead of failing silently', () => {
  const src = fs.readFileSync(path.join(root, 'renderer-lastlight-alarm.js'), 'utf8');
  assert.match(src, /\} else if \(typeof notify === 'function'\) \{\s*notify\('You can keep up to 32 custom finales\. Delete one to add another\.', 'warning'\);/);
});

test('Settings says Sleep and Hibernate run only when Windows offers them', () => {
  const truth = liftFunction(rendererSource, 'renderSafetyTruth');
  assert.match(truth, /runs only if Windows offers it on this PC; otherwise it is blocked and nothing runs\./);
});
