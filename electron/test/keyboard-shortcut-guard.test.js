'use strict';

// P03 fix: the global timer shortcuts (Space, presets 1-6) must never start a
// run from behind something that owns the keyboard. A focused button keeps
// its native Space activation (the onboarding Test Mode / Real choices, the
// footer truth bar), and first-run onboarding or any open dialog blocks the
// shortcuts entirely -- otherwise Space on the onboarding "Real" choice armed
// a REAL countdown hidden behind the overlay before any mode was chosen.
//
// renderer.js is a single shared-scope browser script, so (same approach as
// navigation-foundation.test.js) this extracts the real document keydown
// handler and the two guard functions by source text and runs them in a vm
// sandbox with a minimal fake DOM.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

function balancedFrom(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces');
}

function extractFunction(source, name) {
  const start = source.search(new RegExp(`function ${name}\\s*\\(`));
  if (start < 0) throw new Error(`function ${name} not found`);
  return source.slice(start, balancedFrom(source, source.indexOf('{', start)));
}

function extractKeydownHandler(source) {
  const marker = "document.addEventListener('keydown', async event => {";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('document keydown handler not found');
  const open = start + marker.length - 1;
  return source.slice(open, balancedFrom(source, open));
}

function makeTarget(tagName, { roleButton = false, contentEditable = false } = {}) {
  return {
    nodeType: 1,
    tagName,
    isContentEditable: contentEditable,
    blur() {},
    closest: selector => (roleButton && selector.includes('[role="button"]') ? {} : null)
  };
}

function createSandbox({ running = false, paused = false, fullscreenClock = false, onboardingVisible = false, modalOpen = false } = {}) {
  const calls = { start: 0, togglePause: 0, exitFullscreen: 0, startTimer: 0 };
  const onboarding = { style: { display: onboardingVisible ? 'flex' : 'none' } };
  const fakeDocument = {
    getElementById: id => (id === 'onboarding' ? onboarding : null),
    querySelector: selector => (modalOpen && selector.includes('.modal.active') ? { id: 'warning-modal' } : null)
  };
  const state = { running, paused, fullscreenClock, unit: 'min' };
  const sandbox = {
    state,
    document: fakeDocument,
    els: { panelSet: { style: { display: 'none' } }, btnPlus: { click() {} }, btnMinus: { click() {} } },
    api: {},
    startTonightPlan: () => { calls.start++; },
    togglePause: () => { calls.togglePause++; },
    exitFullscreenClock: () => { calls.exitFullscreen++; },
    startTimer: () => { calls.startTimer++; },
    setInputFromSeconds: () => {},
    clearArmedNightMode: () => {},
    clearCurrentProfile: () => {},
    cancelTimer: () => {},
    toggleMiniMode: () => {},
    console
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    `${extractFunction(rendererSource, 'timerShortcutSurfaceBlocked')}\n` +
    `${extractFunction(rendererSource, 'spaceOwnedByFocus')}\n` +
    `this.__onKeydown = async function onKeydown(event) ${extractKeydownHandler(rendererSource)};`,
    context
  );
  return { calls, onboarding, state, onKeydown: context.__onKeydown };
}

function keyEvent(key, target) {
  const event = {
    key,
    code: key === ' ' ? 'Space' : `Digit${key}`,
    target,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() { event.defaultPrevented = true; }
  };
  return event;
}

test('Space on a focused button keeps native activation and never starts a run', async () => {
  const sb = createSandbox();
  const event = keyEvent(' ', makeTarget('BUTTON'));
  await sb.onKeydown(event);
  assert.equal(sb.calls.start, 0, 'Space on a focused button must not reach the shared start command');
  assert.equal(event.defaultPrevented, false, 'the button must keep its native Space activation');
});

function makeRunStartChip() {
  return {
    nodeType: 1,
    tagName: 'BUTTON',
    isContentEditable: false,
    blur() {},
    closest: selector => (selector.includes('.chip[data-min]') || selector.includes('button') ? {} : null)
  };
}

test('Space on a focused duration chip pauses an active run instead of re-clicking the chip', async () => {
  for (const flags of [{ running: true }, { paused: true }]) {
    const sb = createSandbox(flags);
    const event = keyEvent(' ', makeRunStartChip());
    await sb.onKeydown(event);
    assert.equal(sb.calls.togglePause, 1, 'Space on the chip that started the run must pause/resume it');
    assert.equal(sb.calls.start, 0);
    assert.equal(event.defaultPrevented, true, 'the chip must not also receive a native click (a refused second start)');
  }
});

test('Space on a focused duration chip while idle keeps its native activation (one-tap start)', async () => {
  const sb = createSandbox();
  const event = keyEvent(' ', makeRunStartChip());
  await sb.onKeydown(event);
  assert.equal(sb.calls.start, 0, 'the shared start command is not used; the chip itself starts its preset');
  assert.equal(sb.calls.togglePause, 0);
  assert.equal(event.defaultPrevented, false);
});

test('Space on a run-start control still yields to an open dialog', async () => {
  const sb = createSandbox({ running: true, modalOpen: true });
  const event = keyEvent(' ', makeRunStartChip());
  await sb.onKeydown(event);
  assert.equal(sb.calls.togglePause, 0);
});

test('Space on a role=button / contenteditable / textarea target is left alone', async () => {
  for (const target of [makeTarget('DIV', { roleButton: true }), makeTarget('DIV', { contentEditable: true }), makeTarget('TEXTAREA')]) {
    const sb = createSandbox();
    const event = keyEvent(' ', target);
    await sb.onKeydown(event);
    assert.equal(sb.calls.start, 0);
    assert.equal(event.defaultPrevented, false);
  }
});

test('Space while first-run onboarding is shown never starts a run (even with no button focused)', async () => {
  const sb = createSandbox({ onboardingVisible: true });
  await sb.onKeydown(keyEvent(' ', makeTarget('BODY')));
  assert.equal(sb.calls.start, 0);
  assert.equal(sb.calls.togglePause, 0);
});

test('Space while a dialog is open neither starts nor pauses a run', async () => {
  const idle = createSandbox({ modalOpen: true });
  await idle.onKeydown(keyEvent(' ', makeTarget('BODY')));
  assert.equal(idle.calls.start, 0);
  const running = createSandbox({ modalOpen: true, running: true });
  await running.onKeydown(keyEvent(' ', makeTarget('BODY')));
  assert.equal(running.calls.togglePause, 0);
});

test('Space with nothing focused still starts the run, and leaves the fullscreen clock first', async () => {
  const sb = createSandbox({ fullscreenClock: true });
  const event = keyEvent(' ', makeTarget('BODY'));
  await sb.onKeydown(event);
  assert.equal(sb.calls.exitFullscreen, 1, 'Space in fullscreen must leave the clock');
  assert.equal(sb.calls.start, 1, 'Space with no focused control must start tonight\'s plan');
  assert.equal(event.defaultPrevented, true);
});

test('Space with nothing focused pauses a running session', async () => {
  const sb = createSandbox({ running: true });
  await sb.onKeydown(keyEvent(' ', makeTarget('BODY')));
  assert.equal(sb.calls.togglePause, 1);
  assert.equal(sb.calls.start, 0);
});

test('preset keys 1-6 never start a run behind onboarding or an open dialog', async () => {
  const onboarding = createSandbox({ onboardingVisible: true });
  await onboarding.onKeydown(keyEvent('1', makeTarget('BODY')));
  assert.equal(onboarding.calls.startTimer, 0);
  const dialog = createSandbox({ modalOpen: true });
  await dialog.onKeydown(keyEvent('3', makeTarget('BODY')));
  assert.equal(dialog.calls.startTimer, 0);
  const free = createSandbox();
  await free.onKeydown(keyEvent('2', makeTarget('BODY')));
  assert.equal(free.calls.startTimer, 1, 'presets still work when nothing blocks them');
});

test('Ctrl/Cmd/Alt + digit never starts a preset; a plain digit still does (UI-R3 Fire 02)', async () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    const sb = createSandbox();
    const event = keyEvent('1', makeTarget('BODY'));
    event[mod] = true;
    await sb.onKeydown(event);
    assert.equal(sb.calls.startTimer, 0, `${mod}+1 belongs to My Modes (load only), never a timer start`);
  }
  const plain = createSandbox();
  await plain.onKeydown(keyEvent('1', makeTarget('BODY')));
  assert.equal(plain.calls.startTimer, 1, 'a plain 1 still starts the 5 min preset');
});

test('a digit typed into the session name or a text area is text, never a preset start (UI-R3 Fire 02)', async () => {
  for (const target of [makeTarget('DIV', { contentEditable: true }), makeTarget('TEXTAREA')]) {
    const sb = createSandbox();
    await sb.onKeydown(keyEvent('2', target));
    assert.equal(sb.calls.startTimer, 0, target.tagName);
  }
});

test('a lost fullscreen-exit IPC is retried: the pending flag clears and render() asks again', async () => {
  const timers = [];
  let renders = 0;
  let ipcCalls = 0;
  const sandbox = {
    state: { fullscreenClock: true },
    api: { setFullScreenClock: () => { ipcCalls++; } }, // IPC "lost": fullscreen never ends
    render: () => { renders++; },
    els: { body: { classList: { toggle() {} } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(
    'var fullscreenExitPending = true; var fullscreenExitRetryTimer = null; var FULLSCREEN_EXIT_RETRY_MS = 1500;\n' +
    `${extractFunction(rendererSource, 'exitFullscreenClock')}\n${extractFunction(rendererSource, 'applyFullscreenClockState')}\n` +
    'this.__exit = exitFullscreenClock; this.__apply = applyFullscreenClockState; this.__pending = () => fullscreenExitPending;',
    sandbox
  );
  sandbox.__exit();
  assert.equal(ipcCalls, 1);
  assert.equal(timers.length, 1, 'exitFullscreenClock must arm a retry timer');
  timers[0].fn();
  assert.equal(sandbox.__pending(), false, 'the retry must clear fullscreenExitPending so render() asks again');
  assert.equal(renders, 1, 'the retry must re-render');
  // Once fullscreen really ends, the guard resets and no retry fires.
  sandbox.__apply(false);
  assert.equal(sandbox.__pending(), false);
});
