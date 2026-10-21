'use strict';

// F2: Settings › General is a real page built only from features that exist.
//
// - Run at login stays first; a truthful Startup note sits under it and its
//   claims are pinned to the code (login passes --no-auto-start, launch only
//   auto-starts with an explicit --timer=, Schedule auto-start and Autopilot
//   default off).
// - "Show current time when idle" (#chk-clock-mode) and Time Format
//   (#cz-clock-format) moved here from Appearance, ids kept.
// - #chk-clock-mode used to have no change handler and collectAppSettings()
//   saved state.clockMode, so toggling it said "Unsaved changes" but Save
//   never persisted or applied it. It is now live (data-live), like its clock
//   neighbours: the real listener runs here in a vm sandbox.
// - About & updates reuses the existing version source and the same updater
//   check as About, with its own ids.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const settingsJs = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
const updaterJs = fs.readFileSync(path.join(root, 'renderer-onboarding-updater.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function blockFrom(source, startIndex) {
  let i = source.indexOf('{', startIndex);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(startIndex, i + 1);
}

function extractFunction(source, name) {
  const match = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!match) throw new Error(`function ${name} not found`);
  return blockFrom(source, match.index);
}

test('countdown ring replaces the former hybrid default while an explicit analog preference survives', () => {
  const normalize = vm.runInNewContext('(' + extractFunction(settingsJs, 'normalizeClockFace') + ')');
  assert.equal(normalize('analog'), 'analog');
  for (const value of [undefined, null, '', 'hybrid', 'digital', 'unknown']) assert.equal(normalize(value), 'digital');
});

function settingsSection(category) {
  const sections = [];
  const re = /<div class="option-section[^"]*" data-settings-category="([^"]+)">/g;
  let m;
  while ((m = re.exec(html))) sections.push({ category: m[1], at: m.index });
  const out = [];
  sections.forEach((s, idx) => {
    if (s.category !== category) return;
    const end = idx + 1 < sections.length ? sections[idx + 1].at : html.indexOf('</div>\n      <div class="modal-footer', s.at);
    out.push(html.slice(s.at, end));
  });
  return out.join('\n');
}

test('General holds Run at login first, the startup note, the idle clock, About & updates and Your data', () => {
  const general = settingsSection('general');
  const order = ['id="chk-run-login"', 'id="set-startup-note"', 'Idle clock', 'id="cz-clock-format"',
    'id="set-app-version"', 'id="set-updater-status"', 'id="btn-set-check-update"', 'id="btn-set-shortcuts"', 'id="set-data-note"'];
  let last = -1;
  for (const needle of order) {
    const at = general.indexOf(needle);
    assert.ok(at > last, `${needle} is in General, in order`);
    last = at;
  }
  assert.ok(general.indexOf('<input') === general.indexOf('<input type="checkbox" id="chk-run-login"'), 'Run at login is the first control');
  assert.match(general, /Run at login \(start minimized and idle\)/);
  assert.match(general, /The ring shows local time until you start/);
  assert.doesNotMatch(html, /id="chk-clock-mode"/, 'the obsolete clock-hiding toggle is not offered');
  assert.match(general, /<select id="cz-clock-format" data-live="1">/, '#cz-clock-format stays live');
  assert.ok(!/style="/.test(general), 'no inline styles in General');
});

test('the clock toggle and Time Format left Appearance; clock face/style/size stayed', () => {
  const appearance = settingsSection('appearance');
  assert.ok(!appearance.includes('id="chk-clock-mode"'));
  assert.ok(!appearance.includes('id="cz-clock-format"'));
  for (const id of ['cz-clockface', 'cz-clock-scale', 'cz-clock-date', 'cz-clock-style', 'cz-clock-dial', 'cz-clock-hands']) {
    assert.ok(appearance.includes(`id="${id}"`), `#${id} stays in Appearance`);
  }
});

test('every id in the document is unique (General does not duplicate About ids)', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dupes)], []);
  for (const id of ['updater-status', 'updater-status-text', 'btn-check-update', 'about-version']) {
    assert.equal(ids.filter(x => x === id).length, 1, `#${id} exists once (About)`);
  }
  // UI-R3 Fire 03: About states the version once, as a chip.
  assert.match(html, /<span class="about-version-chip" id="about-version">v\d+\.\d+\.\d+<\/span>/);
});

test('the startup note is true to the launch, login, schedule and autopilot code', () => {
  const note = (html.match(/<p class="help-text" id="set-startup-note">([\s\S]*?)<\/p>/) || [])[1] || '';
  assert.match(note, /never starts a countdown by itself/);
  assert.match(note, /Schedule auto-start and Autopilot/);
  assert.match(note, /jump list/);
  // Login: minimized, and --no-auto-start blocks any --timer= launch start.
  assert.match(mainJs, /args: \['--minimized', '--no-auto-start'\]/);
  assert.match(mainJs, /if \(launchOptions\.timerMinutes > 0 && !launchOptions\.noAutoStart\) \{/);
  // The only launch-time start paths are the explicit --timer= jump-list tasks.
  assert.deepEqual([...mainJs.matchAll(/arguments: '(--[^']+)'/g)].map(m => m[1]), ['--timer=5', '--timer=15', '--timer=30']);
  // Schedule auto-start and Autopilot are opt-in and default off.
  assert.match(mainJs, /if \(!calSettings\.enabled \|\| !calSettings\.autoStartFromEvents\) return;/);
  assert.match(fs.readFileSync(path.join(root, 'autopilot.js'), 'utf8'), /if \(!appSettings\.autopilotEnabled\) return null;/);
  const defaults = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  assert.match(defaults, /autopilotEnabled: false,/);
  assert.match(defaults, /autoStartFromEvents: false,/);
});

test('the data note is true: receipts export from Proof › Full ledger', () => {
  assert.match(html, /id="set-data-note">Settings and run receipts are stored only on this PC\. No account, no cloud sync\. Export your receipts from Proof › Full ledger\.</);
  const stats = html.slice(html.indexOf('id="ns-panel-stats"'), html.indexOf('id="ns-panel-set"'));
  assert.match(stats, /id="btn-stats-view-ledger">Full ledger/);
  assert.match(html, /<div class="modal" id="receipts-modal"[\s\S]*?id="btn-export-receipts"/);
  assert.match(rendererJs, /els\.btnExportReceipts\.addEventListener\('click'/);
});

function runClockModeListener({ checked, dismissed = false, failWrite = false }) {
  const at = rendererJs.indexOf('if (els.chkClockMode) {');
  assert.ok(at > 0, 'the #chk-clock-mode listener exists');
  const listeners = {};
  const box = {
    sent: [],
    notes: [],
    renders: 0,
    state: { clockMode: !checked, _clockDismissedByProfile: dismissed },
    els: { chkClockMode: { checked, addEventListener: (type, fn) => { listeners[type] = fn; } } },
    api: {},
    render: () => { box.renders++; },
    notify: msg => box.notes.push(msg)
  };
  box.api.saveAppSettings = async payload => {
    if (failWrite) throw new Error('disk full');
    box.sent.push(payload);
    return {};
  };
  vm.createContext(box);
  vm.runInContext(blockFrom(rendererJs, at), box);
  assert.equal(typeof listeners.change, 'function', 'a change listener is wired');
  return { box, fire: () => listeners.change() };
}

test('toggling #chk-clock-mode applies at once and persists only clockMode', async () => {
  const off = runClockModeListener({ checked: false });
  await off.fire();
  assert.equal(off.box.state.clockMode, false, 'the idle clock reads the new value');
  assert.ok(off.box.renders >= 1, 'render() runs, so the idle clock reflects it now');
  assert.equal(JSON.stringify(off.box.sent), JSON.stringify([{ app: { clockMode: false } }]), 'only clockMode is written');

  const on = runClockModeListener({ checked: true, dismissed: true });
  await on.fire();
  assert.equal(on.box.state.clockMode, true);
  assert.equal(on.box.state._clockDismissedByProfile, false, 'an explicit choice clears a profile dismissal');
  assert.equal(JSON.stringify(on.box.sent), JSON.stringify([{ app: { clockMode: true } }]));

  const failed = runClockModeListener({ checked: false, failWrite: true });
  await failed.fire();
  assert.ok(failed.box.notes.some(n => /not saved/.test(n)), 'a failed write is said out loud');
});

test('the honest-save footer never marks #chk-clock-mode or #cz-clock-format as unsaved', () => {
  // The delegated dirty listener skips anything inside [data-live].
  assert.match(rendererJs, /const isStagedSettingsEdit = target => Boolean\(target\?\.closest\)\s*&& !target\.closest\('\[data-live\], \[data-action-scoped\], \[data-preview-only\]'\);/);
  for (const id of ['cz-clock-format']) {
    const tag = (html.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`)) || [''])[0];
    assert.match(tag, /data-live="1"/, `#${id} is data-live`);
  }
});

function collectClockMode(state, checkboxChecked) {
  const box = {
    state: { clockFace: 'hybrid', clockStyle: 'modern', clockDial: 'bars', clockFormat: '24h', clockScale: 1, ...state },
    els: { chkClockMode: { checked: checkboxChecked }, timerName: { textContent: 'Last Call' } },
    document: { querySelector: () => null },
    settingsReturnTab: 'lib'
  };
  vm.createContext(box);
  vm.runInContext(`${extractFunction(settingsJs, 'collectAppSettings')} this.out = collectAppSettings();`, box);
  return box.out.clockMode;
}

test('Save persists the clock preference, never a profile\'s temporary dismissal', () => {
  assert.equal(collectClockMode({ clockMode: false }, false), false, 'off is saved as off');
  assert.equal(collectClockMode({ clockMode: true }, true), true, 'on is saved as on');
  assert.equal(collectClockMode({ clockMode: false, _clockDismissedByProfile: true }, true), true, 'a profile hiding the clock is not saved as off');
});

function updaterBox() {
  const el = () => ({ dataset: {}, textContent: '', disabled: false, style: {} });
  const box = {
    els: {
      updaterStatus: el(), updaterStatusText: el(), btnCheckUpdate: el(), updaterDownload: el(),
      setUpdaterStatus: el(), setUpdaterStatusText: el(), setBtnCheckUpdate: el(),
      version: el(), aboutVersion: el(), setAppVersion: el()
    },
    api: { checks: 0 }
  };
  box.api.checkForUpdate = async () => {
    box.api.checks++;
    box.disabledDuring = [box.els.btnCheckUpdate.disabled, box.els.setBtnCheckUpdate.disabled];
    return { available: false, currentVersion: '11.1.3' };
  };
  box.api.getAppVersion = async () => '11.1.3';
  vm.createContext(box);
  vm.runInContext(['writeUpdaterLine', 'renderUpdaterStatus', 'runUpdateCheck', 'applyAppVersion']
    .map(name => extractFunction(updaterJs, name)).join('\n') + '\nthis.check = runUpdateCheck; this.render = renderUpdaterStatus; this.version = applyAppVersion;', box);
  return box;
}

test('General runs the same update check as About and shows the same result', async () => {
  const box = updaterBox();
  await box.check();
  assert.equal(box.api.checks, 1, 'one check through the existing api.checkForUpdate');
  assert.deepEqual(box.disabledDuring, [true, true], 'both buttons wait for the check');
  assert.equal(box.els.btnCheckUpdate.disabled, false);
  assert.equal(box.els.setBtnCheckUpdate.disabled, false);
  assert.equal(box.els.setUpdaterStatus.dataset.state, 'uptodate');
  assert.equal(box.els.setUpdaterStatusText.textContent, "You're on the latest version (v11.1.3)");
  assert.equal(box.els.updaterStatusText.textContent, box.els.setUpdaterStatusText.textContent);

  box.render({ available: true, latestVersion: '11.2.0', distribution: 'portable-zip', downloadUrl: 'x' });
  assert.equal(box.els.updaterStatusText.textContent, 'Update available: v11.2.0');
  assert.equal(box.els.setUpdaterStatusText.textContent, 'Update available: v11.2.0. Download it from About.', 'General points at the download that lives in About');

  await box.version();
  assert.equal(box.els.setAppVersion.textContent, 'v11.1.3', 'General shows the same version as the footer');
  assert.equal(box.els.aboutVersion.textContent, 'v11.1.3', 'the About chip uses the same v-prefixed version');
  assert.equal(box.els.version.textContent, 'v11.1.3');

  assert.match(rendererJs, /els\.setBtnCheckUpdate\?\.addEventListener\('click', runUpdateCheck\);/);
  assert.match(rendererJs, /els\.setBtnShortcuts\?\.addEventListener\('click', \(\) => \{\s*openHelpPanel\(els\.setBtnShortcuts\);/, 'Keyboard shortcuts opens the existing About panel');
});
