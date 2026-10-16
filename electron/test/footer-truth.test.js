'use strict';

// UI-R3 Fire 02: the footer truth bar never drops the mode. The real
// renderFooterTruth() body (plus actionLabel / formatTime) runs in a vm
// sandbox with stub elements, for every outcome x mode x settings-loaded
// combination. No Electron, no DOM library, no app launch.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

function extractFunction(source, name) {
  const head = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!head) throw new Error(`function ${name} not found`);
  let i = head.index + head[0].length;
  let parens = 1;
  while (parens > 0 && i < source.length) {
    if (source[i] === '(') parens++;
    else if (source[i] === ')') parens--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(head.index, i + 1);
}

function classList() {
  const values = new Set();
  return {
    add: (...n) => n.forEach(x => values.add(x)),
    remove: (...n) => n.forEach(x => values.delete(x)),
    contains: n => values.has(n),
    toggle: (n, force) => { const on = force === undefined ? !values.has(n) : Boolean(force); if (on) values.add(n); else values.delete(n); return on; },
    get size() { return values.size; },
    reset: () => values.clear()
  };
}

function createFooter(state, { panelLib } = {}) {
  const attrs = {};
  const pillClasses = classList();
  const pill = {
    dataset: {},
    disabled: false,
    classList: pillClasses,
    set className(v) { pillClasses.reset(); String(v).split(/\s+/).filter(Boolean).forEach(c => pillClasses.add(c)); },
    get className() { return ''; },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: k => (k in attrs ? attrs[k] : null)
  };
  const statusText = { textContent: 'Idle' };
  const statusTime = { textContent: '', hidden: true, dataset: {} };
  const sandbox = { state, els: { statusPill: pill, statusText, statusTime, panelLib } };
  vm.createContext(sandbox);
  vm.runInContext([
    extractFunction(rendererSource, 'formatTime'),
    extractFunction(rendererSource, 'actionLabel'),
    extractFunction(rendererSource, 'renderFooterTruth'),
    'this.renderFooterTruth = renderFooterTruth;'
  ].join('\n'), sandbox);
  return { pill, statusText, statusTime, attrs, run: sandbox.renderFooterTruth };
}

const MODES = {
  test: { settingsLoaded: true, dryRun: true },
  real: { settingsLoaded: true, dryRun: false },
  checking: { settingsLoaded: false, dryRun: false }
};
const OUTCOMES = [null, 'completed', 'dryrun', 'cancelled'];

test('idle: #status-text always names the mode, whatever the last outcome was', () => {
  for (const [modeName, mode] of Object.entries(MODES)) {
    for (const lastOutcome of OUTCOMES) {
      for (const outcomeTest of [true, false]) {
        const f = createFooter({ ...mode, action: 'sleep', running: false, paused: false, phase: 'idle', lastOutcome, lastOutcomeTestMode: outcomeTest, remainingSeconds: 0 });
        f.run(true);
        const text = f.statusText.textContent;
        const label = `${modeName} / ${lastOutcome} / outcome in test ${outcomeTest}`;
        if (modeName === 'checking') assert.equal(text, 'Checking mode…', label);
        else if (modeName === 'test') assert.equal(text, 'Test Mode', label);
        else assert.equal(text, 'Real · Sleep', label);
        assert.equal(f.pill.dataset.truth, modeName, label);
      }
    }
  }
});

test('an outcome shows in the time slot only while it agrees with the current mode', () => {
  for (const [modeName, mode] of Object.entries(MODES)) {
    for (const lastOutcome of OUTCOMES.slice(1)) {
      for (const outcomeTest of [true, false]) {
        const f = createFooter({ ...mode, action: 'shutdown', running: false, paused: false, phase: 'idle', lastOutcome, lastOutcomeTestMode: outcomeTest, remainingSeconds: 0 });
        f.run(true);
        const agrees = modeName !== 'checking' && outcomeTest === (mode.dryRun === true);
        const label = `${modeName} / ${lastOutcome} / outcome in test ${outcomeTest}`;
        if (agrees) {
          assert.equal(f.statusTime.hidden, false, label);
          assert.equal(f.statusTime.dataset.phase, 'outcome', label);
          assert.equal(f.statusTime.textContent, lastOutcome === 'cancelled' ? 'Cancelled' : 'Done', label);
        } else {
          assert.equal(f.statusTime.hidden, true, label);
          assert.notEqual(f.statusTime.dataset.phase, 'outcome', label);
        }
      }
    }
  }
});

test("a Test Mode outcome never gets the REAL 'complete' class; a REAL completion does", () => {
  const testDone = createFooter({ ...MODES.test, action: 'shutdown', running: false, paused: false, lastOutcome: 'completed', lastOutcomeTestMode: true });
  testDone.run(true);
  assert.equal(testDone.pill.classList.contains('complete'), false);
  assert.equal(testDone.pill.classList.contains('dryrun'), true);
  const dry = createFooter({ ...MODES.test, action: 'shutdown', running: false, paused: false, lastOutcome: 'dryrun', lastOutcomeTestMode: true });
  dry.run(true);
  assert.equal(dry.pill.classList.contains('complete'), false);
  assert.equal(dry.pill.classList.contains('dryrun'), true);
  const realDone = createFooter({ ...MODES.real, action: 'shutdown', running: false, paused: false, lastOutcome: 'completed', lastOutcomeTestMode: false });
  realDone.run(true);
  assert.equal(realDone.pill.classList.contains('complete'), true);
  assert.equal(realDone.pill.dataset.truth, 'real', 'the pill stays REAL');
  const cancelled = createFooter({ ...MODES.real, action: 'shutdown', running: false, paused: false, lastOutcome: 'cancelled', lastOutcomeTestMode: false });
  cancelled.run(true);
  assert.equal(cancelled.pill.classList.contains('cancelled'), true);
});

test("a running session's first phase reads Running, never Focus", () => {
  const run = createFooter({ ...MODES.test, action: 'shutdown', running: true, paused: false, phase: 'focus', remainingSeconds: 754 });
  run.run(false);
  assert.equal(run.statusText.textContent, 'Test Mode · Running');
  assert.equal(run.statusTime.textContent, '12:34');
  assert.equal(run.statusTime.hidden, false);
  assert.equal(run.statusTime.dataset.phase, 'running');
  assert.doesNotMatch(run.statusText.textContent, /Focus/);
  const real = createFooter({ ...MODES.real, action: 'shutdown', running: true, paused: false, phase: 'dim', remainingSeconds: 60 });
  real.run(false);
  assert.equal(real.statusText.textContent, 'Real · Winding Down');
  assert.equal(real.pill.disabled, true, 'the pill is only the idle shortcut');
});

test('the aria-label names the mode exactly once', () => {
  const count = (s, re) => (s.match(re) || []).length;
  for (const [modeName, mode] of Object.entries(MODES)) {
    for (const lastOutcome of OUTCOMES) {
      const f = createFooter({ ...mode, action: 'restart', running: false, paused: false, lastOutcome, lastOutcomeTestMode: mode.dryRun === true });
      f.run(true);
      const label = f.attrs['aria-label'];
      if (modeName === 'test') assert.equal(count(label, /Test Mode/g), 1, label);
      if (modeName === 'real') assert.equal(count(label, /\bReal\b/g), 1, label);
      if (modeName === 'checking') assert.doesNotMatch(label, /Test Mode|Real/);
      if (lastOutcome && modeName !== 'checking') assert.match(label, /, last session (done|cancelled)/, label);
      assert.equal(label.endsWith(', change in Settings'), modeName !== 'checking', label);
    }
  }
  const running = createFooter({ ...MODES.test, action: 'restart', running: true, paused: false, phase: 'focus', remainingSeconds: 90 });
  running.run(false);
  assert.equal(count(running.attrs['aria-label'], /Test Mode/g), 1);
  assert.ok(!running.attrs['aria-label'].includes('change in Settings'));
});

// UI-R3 Fire 03: mid-run the pill is the way back to Tonight -- enabled only
// while Tonight is off screen, named for where it goes, and the mode words
// and phase time are unchanged.
test('during a session the pill is enabled only while Tonight is off screen, and says it opens Tonight', () => {
  for (const paused of [false, true]) {
    const onTonight = createFooter({ ...MODES.test, action: 'shutdown', running: !paused, paused, phase: 'focus', remainingSeconds: 90 }, { panelLib: { style: { display: '' } } });
    onTonight.run(false);
    assert.equal(onTonight.pill.disabled, true, 'Tonight on screen: nothing to go back to');
    assert.ok(!onTonight.attrs['aria-label'].includes('open Tonight') && !onTonight.attrs['aria-label'].includes('change in Settings'));

    const away = createFooter({ ...MODES.test, action: 'shutdown', running: !paused, paused, phase: 'focus', remainingSeconds: 90 }, { panelLib: { style: { display: 'none' } } });
    away.run(false);
    assert.equal(away.pill.disabled, false, 'another page: the pill leads back');
    assert.ok(away.attrs['aria-label'].endsWith(', open Tonight'), away.attrs['aria-label']);
    assert.equal((away.attrs['aria-label'].match(/Test Mode/g) || []).length, 1, 'the mode words still appear once');
    assert.equal(away.statusText.textContent, paused ? 'Test Mode · Paused' : 'Test Mode · Running');
    assert.equal(away.statusTime.textContent, '1:30');
    assert.equal(away.pill.dataset.truth, 'test');
  }
  const checking = createFooter({ ...MODES.checking, action: 'shutdown', running: true, paused: false, phase: 'focus', remainingSeconds: 90 }, { panelLib: { style: { display: 'none' } } });
  checking.run(false);
  assert.equal(checking.pill.disabled, true, 'never before settings load');
  const idleAway = createFooter({ ...MODES.real, action: 'shutdown', running: false, paused: false }, { panelLib: { style: { display: 'none' } } });
  idleAway.run(true);
  assert.equal(idleAway.pill.disabled, false);
  assert.ok(idleAway.attrs['aria-label'].endsWith(', change in Settings'), 'idle keeps the Settings shortcut on every page');
});

test('values are written only on change', () => {
  const f = createFooter({ ...MODES.test, action: 'shutdown', running: false, paused: false, lastOutcome: 'dryrun', lastOutcomeTestMode: true });
  f.run(true);
  let writes = 0;
  let value = f.statusTime.textContent;
  Object.defineProperty(f.statusTime, 'textContent', { get: () => value, set: v => { writes++; value = v; } });
  f.run(true);
  f.run(true);
  assert.equal(writes, 0);
});
