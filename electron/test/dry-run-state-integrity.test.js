'use strict';

// v11.2 Slice 0A: Dry Run state-integrity remediation.
//
// Reproduced defect (live, pre-fix): Dry Run had two independent,
// immediate-commit editors for the same canonical state.dryRun -- the
// top-menu quick toggle (#toggle-dryrun) and the Settings panel's own
// checkbox (#chk-dryrun). render()'s checkbox sync was gated to only run
// while the Settings panel was CLOSED ("don't clobber in-progress edits"),
// so toggling Dry Run via the top menu while Settings stayed open left the
// visible checkbox showing a stale value. saveSettingsPanel() then
// re-read that stale checkbox and persisted it, silently reverting the
// user's newer change.
//
// Fix (renderer.js): the checkbox's render() sync is now unconditional
// (moved out of the "panel closed" guard -- Dry Run has no in-progress
// unsaved state to protect, since its editors commit immediately);
// saveSettingsPanel() no longer re-reads the checkbox for state.dryRun at
// all, since it's already correct by the time Save runs.
//
// UI-R1: the top-menu quick toggle is gone with the menus -- #chk-dryrun
// inside Settings is now the single canonical editor (plus non-DOM editors
// like companion/IPC, which still commit immediately). The sync property
// below is therefore still load-bearing.
//
// Same source-extraction + vm sandbox technique as
// tonights-plan-contract.test.js / power-action-lock-parity.test.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererPath = path.join(__dirname, '..', 'renderer.js');
const rendererSource = fs.readFileSync(rendererPath, 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-settings.js'), 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found in renderer.js`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length;
  let parenDepth = 1;
  while (parenDepth > 0 && i < source.length) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') parenDepth--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  if (source[i] !== '{') throw new Error(`function ${name}: no body found after parameter list`);
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

// The render()-body block that syncs the Settings checkboxes from state.
// render() itself is a ~250-line function wired to the full DOM (clock
// face, SVG rings, etc.) -- not practical to extract whole. This pulls
// just the self-contained span this fix touches, anchored on its own
// leading comment through the closing brace of the "other fields" guard,
// and wraps it as a standalone function for sandboxed execution.
function extractDryRunSyncBlock(source) {
  const startMarker = "// Dry Run is an immediate-commit field";
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error('Dry Run sync block comment not found in renderer.js');
  const guardOpen = source.indexOf('if (els.panelSet?.style.display', start);
  if (guardOpen === -1) throw new Error('panelSet visibility guard not found after Dry Run sync block');
  let i = source.indexOf('{', guardOpen);
  i++;
  let depth = 1;
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(start, i);
}

function createElement(overrides = {}) {
  return { checked: overrides.checked ?? false, value: overrides.value ?? '' };
}

function createSyncSandbox({ state, elsOverrides = {} } = {}) {
  const els = {
    panelSet: { style: { display: 'none' } },
    chkDryRun: createElement({ checked: false }),
    chkForceShutdown: createElement({ checked: false }),
    chkMute: createElement({ checked: false }),
    chkRunLogin: createElement({ checked: false }),
    graceMinutes: createElement({ value: '2' }),
    ...elsOverrides
  };

  const sandbox = { state, els, console };
  const context = vm.createContext(sandbox);
  const block = extractDryRunSyncBlock(rendererSource);
  vm.runInContext(`this.__sync = function syncSettingsCheckboxes() {\n${block}\n};`, context);
  return { els, sync: context.__sync };
}

// --- Read-only structural invariants -----------------------------------

test('saveSettingsPanel() no longer re-reads the Dry Run checkbox (the corrupting write is gone)', () => {
  const saveSource = extractFunction(rendererSource, 'saveSettingsPanel');
  assert.doesNotMatch(
    saveSource,
    /els\.chkDryRun/,
    'saveSettingsPanel() must not reference the Dry Run checkbox at all -- state.dryRun is already canonical by the time Save runs'
  );
  // The sibling fields this slice deliberately leaves untouched must still
  // be re-read on Save, exactly as before -- proving this is a narrow,
  // Dry-Run-specific fix, not a broader rewrite of Save's semantics.
  assert.match(saveSource, /els\.chkForceShutdown\.checked/);
  assert.match(saveSource, /els\.chkMute\.checked/);
  assert.match(saveSource, /els\.chkRunLogin\?\.checked/);
});

test('the Dry Run checkbox sync in render() is unconditional -- not gated by Settings-panel visibility', () => {
  const block = extractDryRunSyncBlock(rendererSource);
  const guardIndex = block.indexOf("if (els.panelSet?.style.display === 'none')");
  const syncIndex = block.indexOf('els.chkDryRun.checked = state.dryRun');
  assert.ok(syncIndex !== -1, 'Dry Run checkbox sync line not found');
  assert.ok(guardIndex !== -1, 'panelSet visibility guard not found');
  assert.ok(syncIndex < guardIndex, 'the Dry Run checkbox sync must run BEFORE (outside) the "panel closed" guard, not inside it');
});

test('no duplicate Dry Run state was introduced -- state.dryRun remains the single canonical field', () => {
  // Every renderer.js reference to a Dry-Run-flavored field must be the
  // one canonical `state.dryRun` -- guards against a fix that "solves" the
  // sync problem by adding a second field (e.g. a pending/draft value)
  // instead of correcting the sync direction.
  const dryRunFieldRefs = [...rendererSource.matchAll(/state\.(\w*[dD]ry[rR]un\w*)/g)].map(m => m[1]);
  const uniqueFieldNames = [...new Set(dryRunFieldRefs)];
  assert.deepEqual(uniqueFieldNames, ['dryRun'], `expected only state.dryRun, found: ${uniqueFieldNames.join(', ')}`);
});

test('the checkbox\'s own change listener still writes canonical state.dryRun and persists immediately (the menu quick-toggle is gone)', () => {
  assert.doesNotMatch(
    rendererSource,
    /toggle-dryrun/,
    'UI-R1 removed the top menu -- its #toggle-dryrun branch must not remain'
  );
  assert.match(
    rendererSource,
    /els\.chkDryRun\?\.addEventListener\('change', \(\) => \{\s*state\.dryRun = els\.chkDryRun\.checked;/,
    'chkDryRun change listener must still write state.dryRun immediately on user interaction'
  );
});

// --- Behavioral: the checkbox-sync block in isolation --------------------

test('menu -> Settings synchronization: the checkbox reflects state.dryRun even while the Settings panel is open', () => {
  const state = { dryRun: true, forceShutdown: false, muteSystem: false, runAtLogin: false, graceMinutes: 2 };
  const { els, sync } = createSyncSandbox({ state, elsOverrides: { panelSet: { style: { display: '' } }, chkDryRun: createElement({ checked: true }) } });

  // Settings is open (display: '' = visible). Simulate the top-menu toggle
  // flipping canonical state, then the render() pass that follows it.
  state.dryRun = false;
  sync();

  assert.equal(els.chkDryRun.checked, false, 'the Settings checkbox must pick up the new canonical value even while the panel is open');
});

test('Settings -> canonical synchronization: toggling the checkbox itself keeps state.dryRun correct across renders', () => {
  const state = { dryRun: false, forceShutdown: false, muteSystem: false, runAtLogin: false, graceMinutes: 2 };
  const { els, sync } = createSyncSandbox({ state, elsOverrides: { panelSet: { style: { display: '' } } } });

  // The checkbox's own change listener (tested structurally above) is what
  // writes state.dryRun when the user clicks it directly; this test proves
  // the OTHER direction still holds afterward -- a subsequent render()
  // pass doesn't fight back and revert the checkbox to a stale value.
  state.dryRun = true; // what the (real, untested-here) change listener would have set
  els.chkDryRun.checked = true;
  sync();

  assert.equal(els.chkDryRun.checked, true);
  assert.equal(state.dryRun, true);
});

test('a panel-closed render() still syncs Dry Run correctly (no regression to the pre-existing, already-correct case)', () => {
  const state = { dryRun: true, forceShutdown: true, muteSystem: false, runAtLogin: false, graceMinutes: 5 };
  const { els, sync } = createSyncSandbox({ state, elsOverrides: { panelSet: { style: { display: 'none' } } } });

  sync();

  assert.equal(els.chkDryRun.checked, true);
  // The sibling fields' "only while closed" behavior is unchanged.
  assert.equal(els.chkForceShutdown.checked, true);
  assert.equal(els.graceMinutes.value, 5);
});

test('a panel-open render() no longer syncs the OTHER fields (unchanged, narrow-scope guard)', () => {
  const state = { dryRun: true, forceShutdown: true, muteSystem: true, runAtLogin: true, graceMinutes: 7 };
  const { els, sync } = createSyncSandbox({
    state,
    elsOverrides: {
      panelSet: { style: { display: '' } },
      chkForceShutdown: createElement({ checked: false }),
      chkMute: createElement({ checked: false }),
      chkRunLogin: createElement({ checked: false }),
      graceMinutes: createElement({ value: '2' })
    }
  });

  sync();

  // Dry Run: always synced (the fix).
  assert.equal(els.chkDryRun.checked, true);
  // Everything else: still frozen while the panel is open (unchanged scope).
  assert.equal(els.chkForceShutdown.checked, false);
  assert.equal(els.chkMute.checked, false);
  assert.equal(els.chkRunLogin.checked, false);
  assert.equal(els.graceMinutes.value, '2');
});

// --- Behavioral: saveSettingsPanel() no longer reverts a newer Dry Run ---

function createSaveSettingsPanelSandbox({ state, checkboxChecked, failLights = false }) {
  const calls = { saveAppSettings: [], notify: [], render: 0 };
  const els = {
    selAction: { value: state.action },
    graceMinutes: { value: String(state.graceMinutes) },
    chkForceShutdown: { checked: state.forceShutdown },
    chkMute: { checked: state.muteSystem },
    // The stale DOM value: simulates the checkbox NOT having been synced
    // to the newer canonical state.dryRun before Save runs.
    chkDryRun: { checked: checkboxChecked },
    chkRunLogin: { checked: false },
    chkSmartLights: { checked: false },
    selLightProvider: { value: 'none' },
    selLightMode: { value: 'gradual_dim' },
    lightDimMinutes: { value: '10' },
    hueBridgeIp: { value: '' },
    hueUsername: { value: '' },
    hueGroupId: { value: '' },
    httpUrl: { value: '' },
    httpMethod: { value: 'POST' },
    httpTemplate: { value: '' },
    chkLastLight: { checked: false },
    selLastLightSequence: { value: 'ClassicFade' },
    selLastLightSound: { value: 'Off' }
  };

  const sandbox = {
    state,
    els,
    document: { getElementById: () => null },
    wizDeviceDraft: [],
    console,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    collectAppSettings: () => ({ dryRun: state.dryRun, forceShutdown: state.forceShutdown }),
    collectWifiGuardSettings: () => ({}),
    collectContentBlockerSettings: () => ({}),
    collectAccountabilitySettings: () => ({}),
    applyWifiGuardSettings: () => {},
    applyContentBlockerSettings: () => {},
    applyAccountabilitySettings: () => {},
    setAction: () => {},
    render: () => { calls.render++; },
    notify: (...args) => { calls.notify.push(args); },
    api: {
      saveAppSettings: async payload => { calls.saveAppSettings.push(payload); return {}; },
      saveSmartLightConfig: async cfg => { if (failLights) throw new Error('disk full'); return cfg; }
    }
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(extractFunction(settingsSource, 'collectWizSettings'), context);
  const source = extractFunction(rendererSource, 'saveSettingsPanel');
  vm.runInContext(`${source}\nthis.__saveSettingsPanel = saveSettingsPanel;`, context);
  return { saveSettingsPanel: context.__saveSettingsPanel, calls, els };
}

test('unrelated Settings Save cannot revert a newer Dry Run change (the reproduced defect, now fixed)', async () => {
  // Canonical state was already correctly flipped to false by the
  // top-menu toggle. The checkbox is stale (still true) because -- in the
  // OLD code -- render() would never have re-synced it while the panel
  // was open. With the render()-sync fix in place this staleness can no
  // longer actually occur, but saveSettingsPanel() itself must also, on
  // its own, never re-derive state.dryRun from the checkbox at all --
  // this proves that independently, at the unit that used to do the
  // reverting.
  const state = { action: 'shutdown', dryRun: false, forceShutdown: false, muteSystem: false, graceMinutes: 2, smartLights: {}, lastLight: {} };
  const { saveSettingsPanel, calls } = createSaveSettingsPanelSandbox({ state, checkboxChecked: true });

  await saveSettingsPanel();

  assert.equal(state.dryRun, false, 'Save must not revert Dry Run back to the stale checkbox value');
  assert.equal(calls.saveAppSettings.length, 1);
  assert.equal(calls.saveAppSettings[0].app.dryRun, false, 'the persisted payload must carry the newer canonical value, not the stale checkbox');
});

test('Save still persists whatever Dry Run genuinely is when the checkbox and canonical state agree', async () => {
  const state = { action: 'shutdown', dryRun: true, forceShutdown: false, muteSystem: false, graceMinutes: 2, smartLights: {}, lastLight: {} };
  const { saveSettingsPanel, calls } = createSaveSettingsPanelSandbox({ state, checkboxChecked: true });

  await saveSettingsPanel();

  assert.equal(state.dryRun, true);
  assert.equal(calls.saveAppSettings[0].app.dryRun, true);
});

test('Settings Save reports failure so the view stays open with unsaved edits', async () => {
  const state = { action: 'shutdown', dryRun: true, forceShutdown: false, muteSystem: false, graceMinutes: 2, smartLights: {}, lastLight: {} };
  const failed = createSaveSettingsPanelSandbox({ state, checkboxChecked: true, failLights: true });
  assert.equal(await failed.saveSettingsPanel(), false);
  assert.ok(failed.calls.notify.some(([message]) => message.includes('disk full')));
  const saved = createSaveSettingsPanelSandbox({ state, checkboxChecked: true });
  assert.equal(await saved.saveSettingsPanel(), true);
});

// --- Cancel / reload semantics (unchanged, verified not to regress) -----

test('discardSettingsPanelChanges() reloads Dry Run from persisted settings via applyAppSettings (unchanged Cancel/Escape path)', () => {
  const discardSource = extractFunction(rendererSource, 'discardSettingsPanelChanges');
  assert.match(discardSource, /applyAppSettings\(appSettings\.app/, 'Cancel/Escape must still reload via applyAppSettings, not re-derive from any form control');
});

test('applyAppSettings() persistence/reload path is untouched: a single direct assignment from the persisted value', () => {
  const settingsPath = path.join(__dirname, '..', 'renderer-settings.js');
  const settingsSource = fs.readFileSync(settingsPath, 'utf8');
  assert.match(
    settingsSource,
    /if \(typeof app\.dryRun === 'boolean'\) state\.dryRun = app\.dryRun;/,
    'startup/reload path must remain a single, direct, unconditional-on-type assignment from the persisted value'
  );
});

// Power-action Dry Run gate (main.js executePowerAction): unmodified by
// this slice -- already covered exhaustively by the pre-existing
// test/power-action-lock-parity.test.js ("Dry Run blocks the real lock
// operation" and the dryRun-checked-before-switch structure, unchanged
// here). Re-asserted at the source level as a lightweight guard that this
// slice truly left main.js's power dispatch untouched.
test('main.js executePowerAction() is untouched by this slice (Dry Run gate remains exactly where it was)', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(
    mainSource,
    /const dryRun = Boolean\(options\.dryRun\);\s*\n\s*const forceShutdown/,
    'executePowerAction()\'s dryRun read must be unchanged'
  );
});
