'use strict';

// User-facing truth for the lead's behaviour changes in this release (Wi-Fi
// Guard durable recovery, slept-through deadlines, fail-closed completion
// checks) and the remaining docs-truth wording. Where the docs make a
// promise about behaviour, the promise is exercised against the module itself
// (wifiGuardLifecycle, unsavedGuard); where the docs quote a number, the number
// is read from the code, so a later code change that makes the copy false
// fails here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const mainJs = read('electron/main.js');
const indexHtml = read('electron/index.html');
const readme = read('README.md');
const readmeTxt = read('README.txt');
const electronReadme = read('electron/README.md');
const site = read('docs/index.html');
const landing = read('docs/LANDING.md');
const powerTruth = read('docs/POWER_ACTION_TRUTH.md');
const roadmap = read('docs/ROADMAP.md');
const rc3 = read('docs/LO_RC3_FINAL_BOUNDARY_1.md');
const closeout = read('docs/LO_FINAL_CLOSEOUT_1.md');

function extractFunction(source, name) {
  const head = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  assert.ok(head, `function ${name} not found`);
  let i = source.indexOf('{', head.index + head[0].length);
  for (let depth = 0, j = i; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(head.index, j + 1);
  }
  throw new Error(`function ${name} is unterminated`);
}

const flat = text => text.replace(/\s+/g, ' ');

// ------------------------------------------------- lead change 14: Wi-Fi Guard
test('Wi-Fi Guard: nothing is blocked when the recovery record cannot be saved (as the docs say)', async () => {
  const { createLifecycle } = require('../wifiGuardLifecycle');
  const calls = [];
  const lifecycle = createLifecycle({
    block: async () => { calls.push('provider-block'); return { success: true }; },
    unblock: async () => ({ success: true }),
    journal: { record: () => { calls.push('record'); return false; }, clear: () => true, read: () => null }
  });
  const session = lifecycle.begin({ dryRun: false });
  const result = await lifecycle.block(session, { provider: 'tplink', routerPass: 'secret' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'WIFI_RECOVERY_UNSAVED');
  assert.deepEqual(calls, ['record'], 'the provider is never called without a saved record');
});

test('Wi-Fi Guard: the record is written before the provider and holds no credentials', async () => {
  const { createLifecycle, createFileJournal } = require('../wifiGuardLifecycle');
  const files = new Map();
  const order = [];
  const store = {
    writeTmpVerifyRename: (file, data) => { order.push(`write:${data.active}`); files.set(file, JSON.parse(JSON.stringify(data))); return true; },
    safeLoadJson: file => ({ data: files.get(file) || null })
  };
  const journal = createFileJournal({ getFilePath: () => 'wifi-guard-recovery.json', store });
  const lifecycle = createLifecycle({
    block: async () => { order.push('provider-block'); return { success: true }; },
    unblock: async () => { order.push('provider-unblock'); return { success: true }; },
    journal
  });
  const session = lifecycle.begin({ dryRun: false });
  await lifecycle.block(session, { provider: 'tplink', routerUser: 'admin', routerPass: 'hunter2', webhookUrl: 'https://example.invalid/x' });
  assert.equal(order[0], 'write:true', 'record precedes the network change');
  assert.ok(order.indexOf('provider-block') > 0);
  const saved = JSON.stringify(files.get('wifi-guard-recovery.json'));
  for (const secret of ['admin', 'hunter2', 'example.invalid']) assert.ok(!saved.includes(secret), `record carries no ${secret}`);
  assert.equal(journal.read().provider, 'tplink');
  await lifecycle.finish(session, { reason: 'complete' });
  assert.equal(journal.read(), null, 'a confirmed restore clears the record');
});

test('Wi-Fi Guard recovery is documented, with the code\'s file name and quit bound, as unit-tested only', () => {
  assert.match(mainJs, /'wifi-guard-recovery\.json'/);
  const seconds = Number(mainJs.match(/const QUIT_WIFI_RESTORE_TIMEOUT_MS = (\d+);/)[1]) / 1000;
  assert.match(mainJs, /recoverInterruptedWifiBlock\(\)\.catch/, 'startup runs the recovery');
  assert.match(extractFunction(mainJs, 'recoverInterruptedWifiBlock'), /retainedByChoice[\s\S]*showNativeNotification/, 'a kept block is reported, not undone');

  for (const [name, text] of Object.entries({ 'README.md': readme, 'README.txt': readmeTxt, 'electron/README.md': electronReadme })) {
    const t = flat(text);
    assert.match(t, /wifi-guard-recovery\.json/, `${name} names the recovery record`);
    assert.match(t, /[Uu]nit[- ]tested only|unit tests only/, `${name} says unit-tested only`);
    assert.match(t, /experimental/i, `${name} keeps Wi-Fi Guard experimental`);
    assert.match(t, /chose to keep/, `${name} says a kept block stays`);
  }
  assert.match(flat(readme), new RegExp(`up to ${seconds} seconds`));
  assert.match(flat(electronReadme), new RegExp(`bounded to ${seconds} s`));
  assert.match(flat(readme), /if that record cannot be saved, nothing is blocked/);

  // In-app: the Wi-Fi Guard settings help says the same, without new structure.
  const help = flat((indexHtml.match(/<div class="option-section wifi-guard-section"[\s\S]*?<p class="help-text">([\s\S]*?)<\/p>/) || [])[1] || '');
  assert.match(help, /recovery note on this PC before each block \(nothing is blocked if it cannot\)/);
  assert.match(help, /unless you chose to keep it/);
});

test('the RC3 and closeout records keep their history and carry dated recovery notes', () => {
  const rc3Note = flat(rc3.slice(rc3.indexOf('## Superseded (2026-11-25)')));
  assert.match(rc3, /This is prevention,\s+not implemented durable recovery\./, 'RC3 history kept as written');
  assert.match(rc3Note, /durable recovery this record said did not exist/);
  assert.match(rc3Note, /unit-tested only/);

  const at = closeout.indexOf('## Note (2026-11-25): durable Wi-Fi Guard recovery now exists in source');
  assert.ok(at > 0, 'closeout note appended');
  const history = closeout.slice(0, at);
  assert.match(history, /durable cross-restart recovery remains unfinished/, 'closeout history kept as written');
  assert.match(history, /^# LO-FINAL-CLOSEOUT-1/);
  const note = flat(closeout.slice(at));
  assert.match(note, /This is unit-tested only\./);
  assert.match(note, /opt-in and experimental/);
  assert.match(note, /must not be advertised as generally reliable/);
});

// ---------------------------------------------- lead change 1: missed deadline
test('a slept-through deadline is documented with the code\'s lateness bound', () => {
  const minutes = Number(read('electron/autopilot.js').match(/const MAX_FIRE_LATENESS_MS = (\d+) \* 60 \* 1000;/)[1]);
  assert.match(mainJs, /const LATE_COMPLETION_LIMIT_MS = autopilot\.MAX_FIRE_LATENESS_MS;/);
  assert.match(flat(readme), new RegExp(`more than ${minutes} minutes late, the run ends as \\*\\*missed\\*\\*`));
  assert.match(flat(electronReadme), new RegExp(`more than ${minutes} minutes earlier .* ends as \`missed\``));
  assert.match(flat(powerTruth), new RegExp(`\\| \`missed\` \\| A non-Test countdown whose deadline passed more than ${minutes} minutes earlier`));
});

test('streak copy matches which endings record a streak event', () => {
  // Cancelled and slept-through (finishMissedRun -> cancelTimer) runs never
  // reach streaks.recordEvent; only completeTimer and overrides do.
  assert.ok(!extractFunction(mainJs, 'cancelTimer').includes('streaks.recordEvent'));
  assert.match(extractFunction(mainJs, 'finishMissedRun'), /cancelTimer\(\{\s*result: 'missed'/);
  assert.match(extractFunction(mainJs, 'completeTimer'), /streaks\.recordEvent\(/);
  const t = flat(readme);
  assert.match(t, /a night counts when a non-Test timer reaches zero or you log an emergency override/);
  assert.match(t, /cancelled runs and countdowns the PC slept through before zero do not count/);
  assert.doesNotMatch(t, /missed runs do not count/, 'a completion that slept in its final steps still recorded its streak event');
});

// ------------------------------------- lead change 8: fail-closed completion
test('fail-closed completion checks are documented with the code\'s bounds', () => {
  const { SCAN_TIMEOUT_MS } = require('../unsavedGuard');
  const complete = extractFunction(mainJs, 'completeTimer');
  assert.match(complete, /reason: 'unsaved-scan-unavailable'/);
  assert.match(complete, /reason: 'wifi-restoration-unconfirmed'/);
  const delay = Number(complete.match(/Delay the power action by (\d+) seconds[\s\S]*?setTimeout\(resolve, (\d+)\)/)[2]) / 1000;
  const t = flat(readme);
  assert.match(t, new RegExp(`waits ${delay} seconds if it finds one`));
  assert.match(t, new RegExp(`takes longer than ${SCAN_TIMEOUT_MS / 1000} seconds, or Wi-Fi Guard cannot confirm it undid its block, the action is blocked`));
  assert.match(flat(powerTruth), new RegExp(`passed its ${SCAN_TIMEOUT_MS / 1000}-second bound, or a Wi-Fi Guard restore that could not be confirmed`));
});

// ---------------------------------------------------- docs-truth-4 follow-up
test('"only automatic connection" claims name the features that also connect once set up', () => {
  for (const [name, text] of Object.entries({ 'docs/index.html': site, 'docs/LANDING.md': landing })) {
    const t = flat(text);
    const at = t.indexOf('only automatic connection');
    assert.ok(at > 0, `${name} states the default connection`);
    assert.match(t.slice(Math.max(0, at - 120), at), /Until you set up calendar feeds, smart lights, webhooks or Wi-Fi Guard/, `${name} qualifies "only"`);
  }
});

// -------------------------------------------- docs-truth-1 / -12 follow-ups
test('README does not promise a cancel after the power request is sent', () => {
  assert.doesNotMatch(readme, /Emergency cancel\s+is always available/);
  assert.match(flat(readme), /You can cancel right up until the power request is sent to Windows\./);
  assert.match(extractFunction(mainJs, 'isCompletionInFlight'), /activeReceiptId/, 'the cancel window ends when the receipt is released at dispatch');
});

test('electron/README describes Ctrl+Shift+A as what it does', () => {
  assert.match(mainJs, /globalShortcut\.register\('Ctrl\+Shift\+A'[\s\S]{0,200}send\('toggle-alarm-focus'\)/);
  const listened = ['electron/preload.js', 'electron/renderer.js'].some(f => read(f).includes('toggle-alarm-focus'));
  const line = electronReadme.split('\n').find(l => l.includes('Ctrl+Shift+A')) || '';
  if (!listened) {
    assert.doesNotMatch(line, /`Ctrl\+Shift\+A` alarm/);
    assert.match(line, /only brings the window forward/);
  }
  assert.match(flat(readme), /`Ctrl\+Shift\+W` toggles the desktop widget/);
  assert.match(mainJs, /globalShortcut\.register\('Ctrl\+Shift\+W', \(\) => \{\s*if \(widgetMode\) closeWidgetWindow\(\);/);
});

// ---------------------------------------------------- docs-truth-3 follow-up
// A Sleep/Hibernate capability probe reaching the renderer: a suspend/hibernate
// name joined to probe/capability (either order, camelCase or kebab-case IPC
// channel), or the helper's own name. Unrelated probes (a WiZ bulb or network
// probe) are not this roadmap line's concern and must not trip it.
const SUSPEND_PROBE_SURFACE = /(?:suspend|hibernat)[\w-]*(?:probe|capabilit)|probe[\w-]*(?:suspend|hibernat)|WindowsSuspend/i;

test('ROADMAP lists the unqualified surfaces and the missing pre-Start suspend check', () => {
  const open = flat(roadmap.slice(roadmap.indexOf('## Open Qualification'), roadmap.indexOf('## Product Pillars')));
  assert.match(open, /native\/WindowsSuspend\.exe/);
  assert.match(open, /Wi-Fi Guard durable recovery .* unit-tested only/);
  assert.match(open, /`--probe` is not exposed to the UI yet/);
  // If a capability probe reaches the renderer, this roadmap line (and the
  // README/onboarding wording) must be revisited.
  assert.doesNotMatch(read('electron/preload.js'), SUSPEND_PROBE_SURFACE);
  assert.match(read('electron/native/WindowsSuspend.cs'), /--probe\s*(?:\/\/\s*)?only reads capabilities/);
});

test('the preload suspend-probe tripwire fires only on the suspend capability surface', () => {
  for (const name of ['probeWizBulb', "ipcRenderer.invoke('probe-network')", 'hueBridgeProbe', 'lanProbe: () => {}', 'calendarCapabilities']) {
    assert.doesNotMatch(name, SUSPEND_PROBE_SURFACE, `${name} is not a suspend probe`);
  }
  for (const name of ['suspendProbe', 'probeSuspend', 'getSuspendCapabilities', "ipcRenderer.invoke('suspend-capabilities')",
    "ipcRenderer.invoke('probe-suspend')", 'hibernateCapability', 'runWindowsSuspendProbe']) {
    assert.match(name, SUSPEND_PROBE_SURFACE, `${name} exposes the suspend probe`);
  }
});
