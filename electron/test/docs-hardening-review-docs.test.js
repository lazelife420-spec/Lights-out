'use strict';

// review:docs follow-ups. Each check pairs a docs claim with the code it
// describes, so a later code change that makes the copy false fails here:
//   1. every Esc-cancel claim says Esc closes an open dialog first
//   2. the media-pause sentence covers the cancel-time resume
//   3. the slept-through heading carries the code's lateness bound
//   4. POWER_ACTION_TRUTH separates the two `missed` paths
//   5. settings.json edits: quit first; the portable location is given
//   6. override nights use the app's own term (snoozed), not "not clean"

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..', '..');
// Windows CI checks out with core.autocrlf=true: compare on LF so exact
// multi-line lookups work on either checkout.
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8').replace(/\r\n/g, '\n');
const flat = text => text.replace(/\s+/g, ' ');

const mainJs = read('electron/main.js');
const rendererJs = read('electron/renderer.js');
const indexHtml = read('electron/index.html');
const mediaJs = read('electron/media.js');
const readme = read('README.md');
const readmeTxt = read('README.txt');
const electronReadme = read('electron/README.md');
const site = read('docs/index.html');
const landing = read('docs/LANDING.md');
const sales = read('docs/SALES_COPY.md');
const powerTruth = read('docs/POWER_ACTION_TRUTH.md');
const androidReadme = read('companion-android/README.md');

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

// ------------------------------------------------------- 1. Esc qualifier
test('Esc closes an open dialog (the grace warning included) before it cancels', () => {
  const start = rendererJs.indexOf("if (event.key === 'Escape') {\n      // Close the topmost");
  assert.ok(start > 0, 'the renderer Escape handler is where the docs say');
  const block = rendererJs.slice(start, rendererJs.indexOf('return;', rendererJs.indexOf('cancelTimer();', start)));
  const warning = block.indexOf("getElementById('warning-modal')?.classList.contains('active')");
  const cancel = block.indexOf('} else if (state.running || state.paused) {\n        cancelTimer();');
  assert.ok(warning > 0 && cancel > warning, 'the warning dialog is closed before the cancel branch is reached');
  assert.match(indexHtml, /<dt><kbd>Esc<\/kbd><\/dt><dd>Cancel the timer \(closes an open dialog first\)<\/dd>/);
  assert.match(indexHtml, /<button class="btn-danger" id="warning-cancel">Cancel timer<\/button>/);
});

test('every Esc-cancel claim in the docs carries the dialog-first qualifier', () => {
  const docs = {
    'README.md': readme, 'README.txt': readmeTxt, 'electron/README.md': electronReadme,
    'docs/index.html': site, 'docs/LANDING.md': landing, 'docs/SALES_COPY.md': sales,
    'companion-android/README.md': androidReadme
  };
  for (const [name, text] of Object.entries(docs)) {
    const t = flat(text);
    const hits = [...t.matchAll(/`?\bEsc\b`?/g)];
    if (['README.md', 'README.txt', 'electron/README.md'].includes(name)) {
      assert.ok(hits.length > 0, `${name} documents Esc`);
    }
    for (const hit of hits) {
      const near = t.slice(Math.max(0, hit.index - 240), hit.index + 360);
      assert.match(near, /closes an open dialog(?: or panel)? first/, `${name}: Esc near "${t.slice(hit.index, hit.index + 60)}" says a dialog closes first`);
      assert.match(near, /imminent-action warning/, `${name}: names the grace warning`);
      assert.match(near, /Cancel timer/, `${name}: points at the warning's Cancel timer button`);
      assert.match(near, /Ctrl\+Shift\+X/, `${name}: points at Ctrl+Shift+X`);
    }
  }
  assert.doesNotMatch(flat(readme), /or `Esc` while the Lights Out window has focus and the countdown is running\)/);
  assert.doesNotMatch(flat(readmeTxt), /or Esc in the window while the countdown runs/);
});

// ---------------------------------------------------- 2. media resume copy
test('the media sentence covers the cancel-time resume, matching media.js', () => {
  const t = flat(readme);
  assert.match(t, /so the pause never starts paused media/);
  // The resume gate compares the app id, not one browser tab, so the copy
  // says "same app" and names the browser case.
  assert.match(t, /If you cancel, it resumes only the same app, and only while Windows still reports its current session paused: music you started again, or another app's paused video, gets no key\. A browser counts as one app, whichever tab is current\./);
  assert.doesNotMatch(t, /resumes only that same player/, 'no per-player claim the app-id gate cannot keep');
  assert.match(t, /A run that ends without a cancel never restarts it\./);
  assert.doesNotMatch(t, /so it never starts paused media/, 'the old claim covered the pause only');

  const media = require('../media');
  assert.match(media.RESUME_PAUSED_MEDIA_COMMAND, /if \(\$status -cne 'Paused'\)[\s\S]*if \(\$app -cne \$expected\)[\s\S]*SendKeys\(\[char\]179\)/);
  assert.match(extractFunction(mediaJs, 'pauseAllDetectedMedia'), /appId: appId \|\| null/);
  assert.ok(!mediaJs.includes('resumes on cancel only what'), 'the media.js comment no longer claims main.js filters the resume');
});

// ------------------------------------------------------ 3. missed heading
test('the slept-through heading carries the code\'s lateness bound', () => {
  const minutes = Number(read('electron/autopilot.js').match(/const MAX_FIRE_LATENESS_MS = (\d+) \* 60 \* 1000;/)[1]);
  assert.match(mainJs, /const LATE_COMPLETION_LIMIT_MS = autopilot\.MAX_FIRE_LATENESS_MS;/);
  assert.ok(readme.includes(`**A deadline slept through by more than ${minutes} minutes never fires.**`));
  assert.ok(!readme.includes('**A slept-through deadline never fires.**'), 'no absolute heading');
});

// ----------------------------------------------- 4. the two missed paths
test('POWER_ACTION_TRUTH splits the tick and pre-dispatch missed paths', () => {
  const row = flat(powerTruth.split('\n').find(l => l.startsWith('| `missed` |')) || '');
  assert.match(row, /Caught on the tick, the run ends like a cancel: smart lights are restored, Wi-Fi Guard's block is undone/);
  assert.match(row, /paused media is not restarted, and no partner message is sent/);
  assert.match(row, /Caught just before dispatch, the completion side effects have already happened \(the streak and bedtime-estimate events, the completion partner message and, if enabled, the Last Light finale\) and only the power request is skipped; the smart lights are switched off only after this check, just before the power request, so here the lights the countdown dimmed are restored instead/);
  assert.doesNotMatch(row, /the run ends like a cancel and no power action is requested/);

  // Tick path: a cancel with no partner message and the 'missed' restore.
  const missed = extractFunction(mainJs, 'finishMissedRun');
  assert.match(missed, /cancelTimer\(\{[\s\S]*restoreReason: 'missed'[\s\S]*accountabilityEvent: null/);
  assert.match(extractFunction(mainJs, 'cancelTimer'), /restoreWizOriginalState[\s\S]*restoreHueOriginalState[\s\S]*restoreAfterTimer\(\{ reason: restoreReason \}\)/);
  // Pre-dispatch path: every completion side effect precedes the stale check.
  const complete = extractFunction(mainJs, 'completeTimer');
  const stale = complete.indexOf('isCompletionStale(completionOptions.endsAt)');
  assert.ok(stale > 0 && stale < complete.indexOf('await executePowerAction('));
  for (const effect of ['streaks.recordEvent(', 'sleepDebt.recordNight(', "sendAccountability('TIMER_COMPLETE')", 'await playLastLightRitual(']) {
    const at = complete.indexOf(effect);
    assert.ok(at > 0 && at < stale, `${effect} has already run when the pre-dispatch check finds the deadline missed`);
  }
  // The lights go off only after the stale check, just before dispatch; a
  // missed completion restores them instead.
  const off = complete.indexOf('await switchRunLightsOff()');
  assert.ok(off > stale && off < complete.indexOf('await executePowerAction('), 'lights off after the stale check, before dispatch');
  assert.match(complete.slice(stale, off), /restoreRunLights\('missed'\)/);
});

// ------------------------------------------------ 5. settings.json edits
test('settings.json edit steps say to quit first and give the portable location', () => {
  assert.match(mainJs, /label: 'Quit',\s*click: \(\) => \{\s*app\.isQuitting = true;/, 'the tray has Quit');
  assert.match(mainJs, /mainWindow\.on\('move', scheduleWindowStateSave\);/, 'a running app rewrites settings.json (window state)');
  assert.match(extractFunction(mainJs, 'createWindow'), /settingsStore\.updateSection\('window', patch\)/);
  assert.match(read('electron/portableStartup.js'), /root = path\.dirname\(exeDir\), expected = path\.join\(root, 'user-data'\)/);
  assert.match(read('electron/portableStartup.js'), /app\.setPath\('userData', profile\)/);

  const md = flat(readme);
  const quit = md.indexOf('quit Lights Out first (tray › **Quit**');
  const set = md.indexOf('`"globalQuickStartShortcuts": true`');
  const again = md.indexOf('then start Lights Out again');
  assert.ok(quit > 0 && set > quit && again > set, 'README.md: quit, edit, then start again');
  assert.ok(md.includes('portable: `<extracted folder>\\user-data\\settings.json`'));
  assert.doesNotMatch(md, /`userData\\settings\.json` and restart Lights Out/);

  const txt = flat(readmeTxt);
  assert.ok(txt.includes('portable: <extracted folder>\\user-data\\settings.json'), 'README.txt gives the portable location');
  assert.ok(txt.includes('Quit Lights Out (tray > Quit) before editing it'));
  const tq = txt.indexOf('quit Lights Out (tray > Quit), set "globalQuickStartShortcuts": true');
  assert.ok(tq > 0 && txt.indexOf('then start Lights Out again', tq) > tq, 'README.txt: quit, edit, then start again');
  assert.doesNotMatch(txt, /settings\.json and restart to turn them on/);

  const er = flat(electronReadme);
  assert.ok(er.includes('Quit Lights Out (tray > Quit) before editing settings.json, then start it again'));
  assert.ok(er.includes('`<extracted folder>\\user-data\\settings.json`'));
});

// ------------------------------------------------ 6. override nights wording
test('override nights are described with the app\'s term: snoozed', () => {
  assert.match(read('electron/emergencyOverride.js'), /streaks\.recordEvent\(null, 'override', true\)/);
  assert.match(extractFunction(read('electron/streaks.js'), 'recordEvent'), /^function recordEvent\(bedTime, action, snoozed\)[\s\S]*snoozed: Boolean\(snoozed\)/);
  assert.match(rendererJs, /d\.snoozed \? 'SNOOZED' : 'ON-TIME'/);
  for (const [name, text, phrase] of [
    ['README.md', readme, 'override nights are recorded as snoozed nights'],
    ['docs/index.html', site, 'override nights are recorded as snoozed nights'],
    ['docs/SALES_COPY.md', sales, 'emergency override (recorded as a snoozed night)']
  ]) {
    assert.ok(flat(text).includes(phrase), `${name} uses the snoozed term`);
    assert.doesNotMatch(text, /not clean/i, `${name} has no "not clean" label the app never shows`);
  }
  assert.doesNotMatch(landing, /not clean/i);
});
