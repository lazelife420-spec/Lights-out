'use strict';

// User-facing truth: README/README.txt, the public site and landing/sales copy,
// the power-truth record, the Android README and in-app copy must match what
// the code does. Each check reads the claim AND the code it describes, so a
// later code change that makes the copy false fails here too.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const electronDir = path.join(__dirname, '..');
const repo = path.join(electronDir, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

const mainJs = read('electron/main.js');
const indexHtml = read('electron/index.html');
const readme = read('README.md');
const readmeTxt = read('README.txt');
const electronReadme = read('electron/README.md');
const site = read('docs/index.html');
const landing = read('docs/LANDING.md');
const sales = read('docs/SALES_COPY.md');
const powerTruth = read('docs/POWER_ACTION_TRUTH.md');
const androidReadme = read('companion-android/README.md');
const phoneHtml = read('companion-android/app/src/main/assets/phone/index.html');

function extractFunction(source, name) {
  const head = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  assert.ok(head, `function ${name} not found`);
  let i = head.index + head[0].length;
  for (let depth = 1; depth > 0 && i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') depth--;
  }
  i = source.indexOf('{', i);
  for (let depth = 0, j = i; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(head.index, j + 1);
  }
  throw new Error(`function ${name} is unterminated`);
}

function htmlText(fragment) {
  return fragment.replace(/<[^>]+>/g, ' ').replace(/&rsaquo;|&mdash;|&amp;|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- docs-truth-0
test('Devices Test Mode notes say the effect is skipped, matching main.js gates', () => {
  for (const id of ['device-lights-scope', 'device-wifi-scope']) {
    const m = indexHtml.match(new RegExp(`<p class="device-scope-note" id="${id}" hidden>([^<]*)</p>`));
    assert.ok(m, `#${id} present`);
    assert.match(m[1], /^Skipped in Test Mode\./, `#${id} says skipped`);
  }
  assert.doesNotMatch(indexHtml, /Runs in Test Mode too/, 'no Devices card may claim an effect runs in Test Mode');
  // The code the notes describe.
  const dim = extractFunction(mainJs, 'applyDimPhase');
  const gate = dim.indexOf('if (dryRun)');
  assert.ok(gate > 0 && gate < dim.indexOf('wifiLifecycle.block'), 'applyDimPhase returns in Test Mode before Wi-Fi Guard');
  assert.match(mainJs, /if \(!timerState\.dryRun && smartLights\.shouldStartDim\(/, 'smart-light dim skips Test Mode');
  assert.match(mainJs, /if \(!timerState\.dryRun && smartLights\.getConfig\(\)\.enabled\) \{\s*smartLights\.updateSmartLightTick/, 'smart-light tick skips Test Mode');
});

test('renderer.js rewrites the Wi-Fi note with Test Mode skip wording too', () => {
  const sync = extractFunction(read('electron/renderer.js'), 'syncDeviceScopeNotes');
  assert.doesNotMatch(sync, /Runs in Test Mode too/);
  assert.match(sync, /Skipped in Test Mode\./);
});

// ---------------------------------------------------------------- docs-truth-1
test('docs name Ctrl+Shift+X as the cancel, never Ctrl+Shift+S', () => {
  assert.match(mainJs, /globalShortcut\.register\('Ctrl\+Shift\+S', toggleMainWindow\)/, 'Ctrl+Shift+S is show/hide');
  assert.match(mainJs, /globalShortcut\.register\('Ctrl\+Shift\+X', \(\) => \{\s*if \(hasCancellableRun\(\)\) \{\s*cancelTimer\(\);/, 'Ctrl+Shift+X cancels');
  const docs = { 'README.md': readme, 'README.txt': readmeTxt, 'docs/index.html': site, 'docs/LANDING.md': landing, 'electron/README.md': electronReadme };
  for (const [name, text] of Object.entries(docs)) {
    // Any sentence (or list item) that names Ctrl+Shift+S next to "cancel"
    // must be the one saying it only shows/hides the window.
    for (const sentence of text.split(/(?<=[.;])\s+|\n\s*[-*]\s+|\n{2,}/)) {
      if (/Ctrl\+Shift\+S\b/.test(sentence) && /cancel/i.test(sentence)) {
        assert.match(sentence, /show/i, `${name} presents Ctrl+Shift+S as a cancel: "${sentence.trim()}"`);
      }
    }
  }
  for (const [name, text] of Object.entries({ 'README.md': readme, 'README.txt': readmeTxt, 'docs/index.html': site })) {
    assert.match(text, /Ctrl\+Shift\+X/, `${name} names the real cancel`);
  }
});

// ---------------------------------------------------------------- docs-truth-3
test('onboarding does not promise Sleep/Hibernate unconditionally', () => {
  const src = read('electron/renderer-onboarding-updater.js');
  const ctx = vm.createContext({ state: { action: 'hibernate' }, actionLabel: a => a });
  vm.runInContext(`${extractFunction(src, 'onboardRealActionSentence')}; this.fn = onboardRealActionSentence;`, ctx);
  const hibernate = ctx.fn('hibernate');
  assert.notEqual(hibernate, 'This PC really hibernates.');
  assert.match(hibernate, /hibernation is turned on in Windows/);
  assert.match(hibernate, /otherwise nothing runs/);
  assert.match(ctx.fn('sleep'), /otherwise nothing runs/);
  assert.equal(ctx.fn('shutdown'), 'This PC really shuts down.');
  // Why: the native helper refuses Hibernate without S4 and a full hiberfile.
  assert.match(read('electron/native/WindowsSuspend.cs'), /hibernate = s4 && file && fileType == 2/);
});

// ---------------------------------------------------------------- docs-truth-4
test('update-check disclosure names exactly the hosts and cadence the updater uses', () => {
  const policy = require('../updaterPolicy');
  const updaterSrc = read('electron/updater.js');
  const interval = updaterSrc.match(/const CHECK_INTERVAL_MS = (\d+) \* 60 \* 60 \* 1000;/);
  assert.ok(interval, 'updater interval is hours-based');
  const hours = Number(interval[1]);
  assert.match(mainJs, /updater\.startPeriodicCheck\(/, 'the check starts with the app');
  assert.doesNotMatch(updaterSrc, /api\.github\.com|releases\/latest/, 'the updater has no GitHub source');
  assert.match(readme, new RegExp(policy.TRUTH_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
  assert.match(readme, new RegExp(`every ${hours} hours`));
  assert.ok(readme.includes(policy.DOWNLOAD_HOST), 'README names the download host');
  assert.doesNotMatch(readme, /fallback to the GitHub Releases API/);
  assert.match(site, new RegExp(`every ${hours} hours`));
  assert.match(indexHtml, new RegExp(`update check \\(at launch and every ${hours} hours\\)`), 'About guarantee states the cadence');
});

// ---------------------------------------------------------------- docs-truth-6
test('public smoke counts are only the v11.2.0 qualification record, never a stale number', () => {
  const record = read('docs/RELEASE_QUALIFICATION_11.2.0.md');
  const smoke = Number(record.match(/(\d+) smoke checks/)[1]);
  const unit = record.match(/([\d,]+) unit tests/)[1];
  for (const [name, text] of Object.entries({ 'README.md': readme, 'docs/index.html': site, 'docs/LANDING.md': landing, 'docs/SALES_COPY.md': sales })) {
    for (const m of text.matchAll(/(\d[\d,]*)\s*(?:\/\s*\d+\s*passing|smoke checks|checks\b)|Smoke(?: suite)?[^.\n\d]{0,12}(\d[\d,]*)/gi)) {
      const n = Number((m[1] || m[2]).replace(/,/g, ''));
      if (n < 50) continue; // e.g. "60 installed settings-layout checks" is not quoted on these pages
      assert.equal(n, smoke, `${name} quotes a smoke count (${m[0]}) other than the v11.2.0 record's ${smoke}`);
    }
    assert.doesNotMatch(text, /\b(?:332|357)\b/, `${name} carries a stale smoke number`);
  }
  assert.doesNotMatch(site, /Smoke \d+ passing/, 'the proof bar does not hard-code a count');
  // A page may quote unit-test totals only from a named release's record
  // (v11.2.0 here); it never has to quote one.
  for (const text of [readme, landing, sales]) {
    for (const m of text.matchAll(/(\d[\d,]*) unit tests/g)) assert.equal(m[1], unit, 'unit count matches the record');
  }
});

// ---------------------------------------------------------------- docs-truth-7
test('the RC3 record carries a dated supersession note while main.js allows blocking', () => {
  const rc3 = read('docs/LO_RC3_FINAL_BOUNDARY_1.md');
  assert.match(rc3, /New Wi-Fi blocking is disabled in the main-process lifecycle/, 'history is kept as written');
  const note = rc3.slice(rc3.indexOf('## Superseded (2026-11-25)'));
  assert.ok(note.startsWith('## Superseded'), 'appended supersession note');
  assert.match(note, /blockingAllowed: true/);
  assert.match(mainJs, /blockingAllowed: true,/, 'if main.js disables blocking again, revisit the supersession note');
});

// ---------------------------------------------------------------- docs-truth-8
test('public streak copy counts emergency overrides like the code does', () => {
  assert.match(read('electron/emergencyOverride.js'), /streaks\.recordEvent\(null, 'override', true\)/, 'overrides write a streak event');
  assert.doesNotMatch(site, /Each night you complete a timer session, your streak grows/);
  assert.doesNotMatch(site, /nights you actually followed through/);
  assert.match(site, /emergency override/);
  assert.match(readme, /emergency override/);
});

// --------------------------------------------------------------- docs-truth-10
test('POWER_ACTION_TRUTH describes the native WindowsSuspend.exe dispatch', () => {
  const dispatcher = require('../powerActionDispatcher');
  assert.doesNotMatch(powerTruth, /The existing `rundll32` mappings are preserved/);
  assert.doesNotMatch(powerTruth, /No helper is implemented, compiled or invoked/);
  assert.doesNotMatch(powerTruth, /same six command mappings/);
  assert.match(powerTruth, /native\/WindowsSuspend\.exe/);
  assert.match(powerTruth, /`missed`/);
  assert.match(mainJs, /helperPath: path\.join\(__dirname, 'native', 'WindowsSuspend\.exe'\)/);
  // Behaviour: no command mapping for suspend; without the adapter it is blocked.
  const dispatch = dispatcher.createDispatcher({ spawn: () => { throw new Error('must not spawn'); } });
  return dispatch({ action: 'hibernate' }).then(r => {
    assert.equal(r.status, 'blocked');
    assert.equal(r.reason, 'native-suspend-adapter-unavailable');
  });
});

// --------------------------------------------------------------- docs-truth-11
test('Android README uses the phone UI labels and documents First Light', () => {
  const tabs = [...phoneHtml.matchAll(/<button type="button" data-tab="[^"]+"[^>]*>[\s\S]*?<span>([^<]+)<\/span><\/button>/g)].map(m => m[1]);
  assert.deepEqual(tabs, ['Tonight', 'Lights', 'Routines', 'Schedule']);
  for (const tab of tabs) assert.ok(androidReadme.includes(`**${tab}**`), `README names the ${tab} tab`);
  assert.match(phoneHtml, />Start reminder </);
  assert.match(phoneHtml, />Pair PC</);
  assert.ok(androidReadme.includes('**Start reminder**') && androidReadme.includes('**Pair PC**'));
  for (const stale of ['Start phone timer', 'Pair a PC', 'Open **Lighting**', 'Open **Calendar**']) {
    assert.ok(!androidReadme.includes(stale), `stale label: ${stale}`);
  }
  assert.match(phoneHtml, /id="first-light-card"/);
  assert.match(androidReadme, /## First Light morning wake/);
  assert.match(androidReadme, /off\s+by default/);
});

// --------------------------------------------------------------- docs-truth-12
test('electron/README describes the real window, pages and power plumbing', () => {
  assert.doesNotMatch(electronReadme, /Menu Bar/);
  assert.doesNotMatch(electronReadme, /Library, Schedule, Clock, Countdown tabs/);
  assert.doesNotMatch(electronReadme, /Standard Windows frame/);
  assert.match(mainJs, /frame: false,/);
  const pages = [...indexHtml.matchAll(/<span class="ns-nav-label">([^<]+)<\/span>/g)].map(m => m[1]);
  assert.ok(pages.length >= 7);
  assert.ok(electronReadme.includes(pages.join(', ')), `README lists the sidebar pages: ${pages.join(', ')}`);
  assert.match(electronReadme, /native\/WindowsSuspend\.exe/);
});

// --------------------------------------------------------------- docs-truth-13
test('site and landing name the clock faces and Night Modes that exist', () => {
  const nightModes = read('electron/nightModes.js');
  const ready = [...nightModes.matchAll(/title: '([^']+)',[\s\S]*?status: '([a-z_]+)'/g)].filter(m => m[2] === 'ready').map(m => m[1]);
  assert.deepEqual(ready, ['Quick Sleep', 'Lights Down', 'Movie Wind-Down', 'Full Shutdown']);
  const cards = [...site.matchAll(/<div class="profile-name">([^<]+)<\/div>/g)].map(m => m[1]);
  for (const card of cards) assert.ok(ready.includes(card) || card === 'My Modes', `site card "${card}" is a real Night Mode`);
  assert.doesNotMatch(site, /Mission complete/, 'the app never says "Mission complete"');
  assert.doesNotMatch(indexHtml, /Mission complete/);
  const faces = [...(indexHtml.match(/<select id="cz-clockface"[\s\S]*?<\/select>/) || [''])[0].matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(faces, ['digital', 'analog']);
  assert.doesNotMatch(landing, /digital, analog, or hybrid clock face/);
});

// --------------------------------------------------------------- docs-truth-14
test('README lists every theme and README.txt lists only files that exist', () => {
  const select = (indexHtml.match(/<select id="cz-theme">[\s\S]*?<\/select>/) || [''])[0];
  const themes = [...select.matchAll(/<option value="[^"]+">([^<]+)<\/option>/g)].map(m => m[1]);
  assert.ok(themes.length >= 6);
  const line = readme.slice(readme.indexOf('theme ('), readme.indexOf(')', readme.indexOf('theme (')));
  for (const theme of themes) assert.ok(line.includes(theme), `README theme list includes ${theme}`);
  const other = readmeTxt.slice(readmeTxt.indexOf('OTHER FILES'), readmeTxt.indexOf('Settings:'));
  for (const m of other.matchAll(/^\s{2}(\S+)\s+-/gm)) {
    assert.ok(fs.existsSync(path.join(repo, m[1].replace(/\\$/, ''))), `README.txt lists ${m[1]}, which must exist`);
  }
});

// ------------------------------------------- lead changes 6, 7, 9 and Autopilot
test('docs describe opt-in quick-start hotkeys and credential-free exports', () => {
  assert.match(read('electron/settings.js'), /globalQuickStartShortcuts: false,/);
  assert.match(mainJs, /globalQuickStartShortcuts === true\) registerQuickStartShortcuts\(\);/);
  for (const text of [readme, readmeTxt, electronReadme]) {
    assert.match(text, /globalQuickStartShortcuts/);
    assert.match(text, /off by default/i);
  }
  assert.match(mainJs, /credentialsIncluded: false,/);
  assert.match(readme, /Export all data[\s\S]{0,200}leaves out/);
  assert.match(readmeTxt, /Export all data leaves out credentials/);
});

test('in-app copy: jump list, Autopilot task, media pause and the finale cancel', () => {
  const startup = htmlText((indexHtml.match(/<p class="help-text" id="set-startup-note">([\s\S]*?)<\/p>/) || [])[1] || '');
  assert.match(startup, /only when no run is active, using your Test Mode setting and never as a force shutdown/);
  assert.match(mainJs, /if \(isRunActive\(\)\) \{[\s\S]{0,200}code: 'RUN_ACTIVE'/, 'quick starts are idle-only');

  const watchdog = read('electron/watchdog.js');
  const task = watchdog.match(/const TASK_NAME = '([^']+)'/)[1];
  const lead = watchdog.match(/const LEAD_MINUTES = (\d+);/)[1];
  const autopilot = htmlText((indexHtml.match(/<div class="option-section autopilot-section"[\s\S]*?<p class="help-text">([\s\S]*?)<\/p>/) || [])[1] || '');
  assert.ok(autopilot.includes(task), 'Autopilot names its Scheduled Task');
  assert.ok(autopilot.includes(`${lead} minutes before bedtime`));
  assert.match(autopilot, /never runs a power action/);

  assert.match(indexHtml, /<input type="checkbox" id="chk-pausemedia-dim">\s*Pause media that is playing when wind-down starts/);
  assert.doesNotMatch(indexHtml, /Nothing can abort the finale once it plays/, 'cancel works during the finale (hasCancellableRun)');
  assert.match(mainJs, /function hasCancellableRun\(\) \{\s*return Boolean\(timerState\.running \|\| timerState\.paused \|\| isCompletionInFlight\(\)\);/);
});
