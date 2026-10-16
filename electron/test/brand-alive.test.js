'use strict';

// UI-R3 P07: the brand comes alive. The renderer's lamp moments (completion
// hold, its honest withdrawal, arrival, launch ignition) and the living
// wordmark's ring writer are extracted from renderer.js by source text and
// run in a vm sandbox with a fake body, fake timers and a fixed clock. No
// Electron, no DOM library, no app launch.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

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
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

function extractConstLine(source, name) {
  const m = source.match(new RegExp(`^const ${name} = [^\\n]*;$`, 'm'));
  if (!m) throw new Error(`const ${name} not found in renderer.js`);
  return m[0];
}

function createClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(n => values.add(n)),
    remove: (...names) => names.forEach(n => values.delete(n)),
    contains: n => values.has(n),
    toggle: (n, force) => { const on = force === undefined ? !values.has(n) : Boolean(force); if (on) values.add(n); else values.delete(n); return on; },
    list: () => [...values].sort()
  };
}

function createStyle() {
  const props = {};
  return {
    props,
    setProperty: (k, v) => { props[k] = v; },
    getPropertyValue: k => props[k] || ''
  };
}

function createSandbox({ state = {}, reducedMotion = false } = {}) {
  const clock = { now: 1_000_000 };
  const timers = [];
  let nextId = 1;
  const setTimeout = (fn, ms) => { const id = nextId++; timers.push({ id, at: clock.now + ms, fn }); return id; };
  const clearTimeout = id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const advance = ms => {
    const end = clock.now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      clock.now = t.at;
      t.fn();
    }
    clock.now = end;
  };
  const body = { classList: createClassList(), style: createStyle(), offsetWidth: 900 };
  const arc = () => ({ dataset: {}, style: {} });
  const els = {
    ringProgress: { style: {} },
    ringHead: { style: {} },
    brandOLive: arc(),
    brandOHalo: arc()
  };
  const calls = { render: 0 };
  const sandbox = {
    state: { running: false, paused: false, lastOutcome: null, outcomeSkipConfirmed: false, totalSeconds: 0, remainingSeconds: 0, ...state },
    els,
    document: { body },
    window: { matchMedia: q => ({ matches: reducedMotion && q === '(prefers-reduced-motion: reduce)' }) },
    Date: { now: () => clock.now },
    Math,
    Number,
    setTimeout,
    clearTimeout,
    clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    render: () => { calls.render++; }
  };
  const context = vm.createContext(sandbox);
  const source = [
    'let outcomeTimer = null;',
    extractConstLine(rendererSource, 'OUTCOME_BODY_CLASSES'),
    'let outcomeReleaseTimer = null;',
    'let arrivalTimer = null;',
    'let lastArrivalAt = 0;',
    'let lampIgnited = false;',
    extractFunction(rendererSource, 'updateRing'),
    extractFunction(rendererSource, 'setSessionOutcome'),
    extractFunction(rendererSource, 'setOutcomeBodyClass'),
    extractFunction(rendererSource, 'dropOutcomeHold'),
    extractFunction(rendererSource, 'releaseOutcomeHold'),
    extractFunction(rendererSource, 'playSessionArrival'),
    extractFunction(rendererSource, 'igniteLamp'),
    'this.__p07 = { updateRing, setSessionOutcome, setOutcomeBodyClass, dropOutcomeHold, releaseOutcomeHold, playSessionArrival, igniteLamp };'
  ].join('\n');
  vm.runInContext(source, context);
  return { ...context.__p07, state: sandbox.state, body, els, calls, advance, timers };
}

test('a Test Mode completion holds the room dark for 8 s, then fades back for ~1 s and clears', () => {
  const s = createSandbox({ state: { dryRun: true } });
  s.setSessionOutcome('dryrun');
  assert.deepEqual(s.body.classList.list(), ['outcome-dryrun']);
  assert.equal(s.state.lastOutcome, 'dryrun');
  s.advance(7999);
  assert.deepEqual(s.body.classList.list(), ['outcome-dryrun'], 'the hold lasts the full 8 s');
  s.advance(1);
  assert.equal(s.state.lastOutcome, null);
  assert.deepEqual(s.body.classList.list(), ['outcome-dryrun', 'outcome-release'], 'the hold ends with the plain fade back');
  assert.equal(s.calls.render, 1);
  s.advance(1000);
  assert.deepEqual(s.body.classList.list(), [], 'every outcome class is gone after the fade');
});

test('a cancelled session gets no dark hold and no fade: its class just clears', () => {
  const s = createSandbox();
  s.setSessionOutcome('cancelled');
  assert.deepEqual(s.body.classList.list(), ['outcome-cancelled']);
  s.advance(8000);
  assert.deepEqual(s.body.classList.list(), []);
});

test('an error or blocked action after completion withdraws the payoff at once', () => {
  const s = createSandbox({ state: { dryRun: false } });
  s.setSessionOutcome('completed');
  s.state.outcomeSkipConfirmed = true;
  s.dropOutcomeHold();
  assert.equal(s.state.lastOutcome, null, 'the idle face no longer says the session completed');
  assert.equal(s.state.outcomeSkipConfirmed, false);
  assert.deepEqual(s.body.classList.list(), [], 'no fade, no assembled O: classes off immediately');
  s.advance(10_000);
  assert.deepEqual(s.body.classList.list(), [], 'the stale 8 s timer was cancelled');
  assert.equal(s.calls.render, 0);
});

test('dropping the hold leaves a cancelled outcome alone', () => {
  const s = createSandbox();
  s.setSessionOutcome('cancelled');
  s.dropOutcomeHold();
  assert.equal(s.state.lastOutcome, 'cancelled');
  assert.deepEqual(s.body.classList.list(), ['outcome-cancelled']);
});

test('a new outcome or a new run replaces the release fade cleanly', () => {
  const s = createSandbox();
  s.setSessionOutcome('completed');
  s.advance(8000);
  assert.ok(s.body.classList.contains('outcome-release'));
  s.setOutcomeBodyClass(null);
  assert.deepEqual(s.body.classList.list(), [], 'a start clears every outcome class at once');
  s.setSessionOutcome('dryrun');
  s.advance(8500);
  s.setSessionOutcome('cancelled');
  assert.deepEqual(s.body.classList.list(), ['outcome-cancelled']);
  s.advance(2000);
  assert.deepEqual(s.body.classList.list(), ['outcome-cancelled'], 'the old release timer cannot strip the new outcome');
});

test('an idle setup interaction ends the hold early with the fade; never while a run is active', () => {
  const s = createSandbox();
  s.setSessionOutcome('completed');
  s.releaseOutcomeHold();
  assert.equal(s.state.lastOutcome, null);
  assert.deepEqual(s.body.classList.list(), ['outcome-completed', 'outcome-release']);
  assert.equal(s.calls.render, 1);

  const running = createSandbox({ state: { running: true, lastOutcome: 'completed' } });
  running.releaseOutcomeHold();
  assert.equal(running.state.lastOutcome, 'completed');
  assert.equal(running.calls.render, 0);
});

test('updateRing: the lamp dims with the real ratio, is out in the hold, and the wordmark O follows the ring', () => {
  const s = createSandbox({ state: { running: true } });
  s.updateRing(300, 600);
  assert.equal(s.body.style.props['--lights-level'], '0.625');
  assert.equal(s.body.style.props['--session-ratio'], '0.5000');
  assert.equal(s.els.brandOLive.style.strokeDasharray, '50.00 100');
  assert.equal(s.els.brandOHalo.style.strokeDasharray, '50.00 100');
  assert.equal(s.els.ringProgress.style.strokeDashoffset, `${2 * Math.PI * 90 - 0.5 * 2 * Math.PI * 90}`);

  s.state.running = false;
  s.state.lastOutcome = 'dryrun';
  s.updateRing(0, 1);
  assert.equal(s.body.style.props['--lights-level'], '0.120', 'the hold puts the lamp out');
  assert.equal(s.body.style.props['--session-ratio'], '1.0000');
  assert.equal(s.els.brandOLive.style.strokeDasharray, '', 'idle hands the O back to the logo cadence');

  s.state.lastOutcome = 'cancelled';
  s.updateRing(1680, 1680);
  assert.equal(s.body.style.props['--lights-level'], '1.000', 'no hold after a cancel');

  s.state.lastOutcome = null;
  s.state.paused = true;
  s.state.running = true;
  s.updateRing(60, 600);
  assert.equal(s.els.brandOLive.style.strokeDasharray, '10.00 100', 'paused keeps the real ratio');
});

test('arrival plays only at the very start of a running countdown, once per 1.5 s, for 1.2 s', () => {
  const s = createSandbox({ state: { running: true, paused: false, totalSeconds: 1680, remainingSeconds: 1680 } });
  s.playSessionArrival();
  assert.ok(s.body.classList.contains('session-arrive'));
  s.advance(1200);
  assert.ok(!s.body.classList.contains('session-arrive'), 'the class clears after 1.2 s');
  s.advance(200);
  s.playSessionArrival();
  assert.ok(!s.body.classList.contains('session-arrive'), 'guarded within 1.5 s');
  s.advance(200);
  s.playSessionArrival();
  assert.ok(s.body.classList.contains('session-arrive'));

  const late = createSandbox({ state: { running: true, totalSeconds: 1680, remainingSeconds: 1500 } });
  late.playSessionArrival();
  assert.ok(!late.body.classList.contains('session-arrive'), 'a restored mid-session run does not "arrive"');
  const paused = createSandbox({ state: { running: true, paused: true, totalSeconds: 600, remainingSeconds: 600 } });
  paused.playSessionArrival();
  assert.ok(!paused.body.classList.contains('session-arrive'));
  const idle = createSandbox({ state: { running: false, totalSeconds: 600, remainingSeconds: 600 } });
  idle.playSessionArrival();
  assert.ok(!idle.body.classList.contains('session-arrive'));
});

test('ignition plays once per run and never under reduced motion', () => {
  const s = createSandbox();
  s.igniteLamp();
  assert.ok(s.body.classList.contains('lo-ignite'));
  s.advance(1000);
  assert.ok(!s.body.classList.contains('lo-ignite'));
  s.igniteLamp();
  assert.ok(!s.body.classList.contains('lo-ignite'), 'once per app run');

  const calm = createSandbox({ reducedMotion: true });
  calm.igniteLamp();
  assert.ok(!calm.body.classList.contains('lo-ignite'));
  assert.equal(calm.timers.length, 0);
});
