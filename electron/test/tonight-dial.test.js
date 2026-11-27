'use strict';

// The Tonight dial (tonightDial.js + its renderer.js wiring): the idle
// instrument is a slider for tonight's duration. Pure helpers run directly;
// the controller runs against EventTarget fakes; the renderer wiring
// (tonightDialInteractive, createTonightDial, the shared stepper path
// applyTonightDuration) is extracted from renderer.js and run in a vm with
// spies. No Electron, no window, no timer, no power action.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const espree = require('espree');
// Node's own DOM-style events (the lint config lists Node globals only).
const { EventTarget, Event } = globalThis;

const root = path.join(__dirname, '..');
const Dial = require('../tonightDial.js');
const dialSource = fs.readFileSync(path.join(root, 'tonightDial.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Any function declaration by name, nested ones included (applyTonightDuration
// lives inside wireEvents).
function functionSource(source, name) {
  const ast = espree.parse(source, { ecmaVersion: 'latest', range: true });
  let found = null;
  (function walk(node) {
    if (found || !node || typeof node.type !== 'string') return;
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) { found = source.slice(...node.range); return; }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === 'string') walk(value);
    }
  })(ast);
  if (!found) throw new Error(`function ${name} not found`);
  return found;
}

// ---- Pure helpers -----------------------------------------------------------

test('the dial clamps to the duration stepper\'s own bounds (1..480 min)', () => {
  assert.equal(Dial.MIN_MINUTES, 1);
  assert.equal(Dial.MAX_MINUTES, 480);
  // The stepper: inputValue() clamps 1..480 min (1..28800 s, the same 8 h).
  assert.match(functionSource(rendererSource, 'inputValue'), /clamp\(parseInt\(els\.timerInput\.value, 10\) \|\| 1, 1, state\.unit === 'min' \? 480 : 28800\)/);
  assert.equal(Dial.MAX_MINUTES * 60, 28800);
  assert.match(htmlSource, /<input type="number" id="timer-input" value="28" min="1" max="480"/);
  assert.equal(Dial.clampMinutes(0), 1);
  assert.equal(Dial.clampMinutes(-30), 1);
  assert.equal(Dial.clampMinutes(481), 480);
  assert.equal(Dial.clampMinutes(45.4), 45);
  assert.equal(Dial.clampMinutes(45.5), 46);
  assert.equal(Dial.clampMinutes(NaN), 1);
  assert.equal(Dial.clampMinutes('nope'), 1);
  assert.equal(Dial.minutesFromSeconds(2700), 45);
  assert.equal(Dial.minutesFromSeconds(90), 2, 'a sec-unit plan rounds to whole minutes');
  assert.equal(Dial.minutesFromSeconds(0), 1);
  assert.equal(Dial.minutesFromSeconds(99999), 480);
});

test('drag maps about 6 px to a minute: up is longer, down shorter, Shift is 5-minute steps', () => {
  assert.equal(Dial.PX_PER_STEP, 6);
  assert.equal(Dial.dragMinutes(45, -6), 46);
  assert.equal(Dial.dragMinutes(45, -5), 45, 'less than a full step never changes the value');
  assert.equal(Dial.dragMinutes(45, 5), 45);
  assert.equal(Dial.dragMinutes(45, -60), 55);
  assert.equal(Dial.dragMinutes(45, 60), 35);
  assert.equal(Dial.dragMinutes(45, -6, true), 50);
  assert.equal(Dial.dragMinutes(45, 12, true), 35);
  assert.equal(Dial.dragMinutes(470, -600), 480, 'clamped at the stepper max');
  assert.equal(Dial.dragMinutes(3, 600), 1, 'clamped at the stepper min');
  assert.ok(Number.isInteger(Dial.dragMinutes(45.7, -13)), 'always whole minutes');
});

test('a drag starts only past the threshold, and Shift re-anchors without a jump', () => {
  let d = Dial.startDrag(45, 100);
  d = Dial.moveDrag(d, 98);
  assert.equal(d.moved, false);
  assert.equal(d.minutes, 45);
  d = Dial.moveDrag(d, 96);
  assert.equal(d.moved, true, '4 px is a drag');
  assert.equal(d.minutes, 45, 'but not yet a step');
  d = Dial.moveDrag(d, 40);
  assert.equal(d.minutes, 55);
  d = Dial.moveDrag(d, 40, true);
  assert.equal(d.minutes, 55, 'pressing Shift keeps the value');
  d = Dial.moveDrag(d, 34, true);
  assert.equal(d.minutes, 60);
  d = Dial.moveDrag(d, 34, false);
  assert.equal(d.minutes, 60, 'releasing Shift keeps the value');
  d = Dial.moveDrag(d, 28, false);
  assert.equal(d.minutes, 61);
  assert.equal(d.startMinutes, 45, 'the starting value is kept for Escape');
});

test('keyboard: arrows +/-1 (Shift 5), PageUp/PageDown +/-5, Home/End min/max, others are not the dial\'s', () => {
  assert.equal(Dial.keyMinutes(45, 'ArrowUp'), 46);
  assert.equal(Dial.keyMinutes(45, 'ArrowRight'), 46);
  assert.equal(Dial.keyMinutes(45, 'ArrowDown'), 44);
  assert.equal(Dial.keyMinutes(45, 'ArrowLeft'), 44);
  assert.equal(Dial.keyMinutes(45, 'ArrowUp', true), 50);
  assert.equal(Dial.keyMinutes(45, 'ArrowDown', true), 40);
  assert.equal(Dial.keyMinutes(45, 'PageUp'), 50);
  assert.equal(Dial.keyMinutes(45, 'PageDown'), 40);
  assert.equal(Dial.keyMinutes(45, 'Home'), 1);
  assert.equal(Dial.keyMinutes(45, 'End'), 480);
  assert.equal(Dial.keyMinutes(1, 'ArrowDown'), 1);
  assert.equal(Dial.keyMinutes(478, 'PageUp'), 480);
  for (const key of [' ', 'Enter', 'Escape', 'Tab', '5', 'a']) assert.equal(Dial.keyMinutes(45, key), null, key);
});

test('wheel: one notch is one step; touchpad deltas accumulate; a direction change starts over', () => {
  assert.deepEqual(Dial.wheelSteps(0, -100, 0), { steps: 1, accumulated: 0 });
  assert.deepEqual(Dial.wheelSteps(0, 120, 0), { steps: -1, accumulated: 0 });
  assert.deepEqual(Dial.wheelSteps(0, -3, 1), { steps: 1, accumulated: 0 }, 'a line-mode wheel steps per event');
  assert.deepEqual(Dial.wheelSteps(0, 0, 0), { steps: 0, accumulated: 0 });
  let r = Dial.wheelSteps(0, -20, 0);
  assert.equal(r.steps, 0);
  r = Dial.wheelSteps(r.accumulated, -20, 0);
  assert.equal(r.steps, 0);
  r = Dial.wheelSteps(r.accumulated, -20, 0);
  assert.equal(r.steps, 1);
  assert.equal(r.accumulated, 0);
  r = Dial.wheelSteps(-40, 20, 0);
  assert.deepEqual(r, { steps: 0, accumulated: 20 }, 'reversing discards the other direction');
});

test('the countdown-face preview arc: the first hour is half the ring, the max is a full ring', () => {
  assert.equal(Dial.previewRatio(60), 0.5);
  assert.equal(Dial.previewRatio(30), 0.25);
  assert.equal(Dial.previewRatio(480), 1);
  assert.equal(Dial.previewRatio(1), 1 / 120);
  assert.equal(Dial.previewRatio(9999), 1);
  let last = 0;
  for (let m = 1; m <= 480; m++) {
    const r = Dial.previewRatio(m);
    assert.ok(r > last && r <= 1, `monotonic at ${m}`);
    assert.ok(r - last < 0.01, `continuous at ${m}`);
    last = r;
  }
});

test('valuetext: "45 minutes, ends 23:45", with the day only when it is not today', () => {
  assert.equal(Dial.valueText(2700, '23:45 · today'), '45 minutes, ends 23:45');
  assert.equal(Dial.valueText(60, '23:01 · today'), '1 minute, ends 23:01');
  assert.equal(Dial.valueText(5400, '00:30 · tomorrow'), '1 hour 30 minutes, ends 00:30 tomorrow');
  assert.equal(Dial.valueText(7200, '1:15 AM · tomorrow'), '2 hours, ends 1:15 AM tomorrow');
  assert.equal(Dial.valueText(90, ''), '1 minute 30 seconds', 'a sec-unit plan is stated exactly; no end, no clause');
  assert.equal(Dial.spokenEnd('02:30 GMT+1 · Oct 9'), '02:30 GMT+1 Oct 9');
  assert.equal(Dial.spokenEnd('23:45'), '23:45');
  assert.equal(Dial.durationWords(0), '0 seconds');
});

test('only the dial\'s circle counts, not the square container\'s corners', () => {
  const rect = { left: 10, top: 20, width: 200, height: 200 };
  assert.equal(Dial.withinDial(110, 120, rect), true);
  assert.equal(Dial.withinDial(110, 21, rect), true);
  assert.equal(Dial.withinDial(12, 22, rect), false);
  assert.equal(Dial.withinDial(110, 120, { left: 0, top: 0, width: 0, height: 0 }), false);
  assert.equal(Dial.withinDial(110, 120, null), false);
});

// ---- Controller (EventTarget fakes) ------------------------------------------

class FakeEl extends EventTarget {
  constructor(rect = { left: 0, top: 0, width: 200, height: 200 }) {
    super();
    this.attrs = new Map();
    this.classes = new Set();
    this.textContent = '';
    this.rect = rect;
    this.captured = new Set();
    this.focusCount = 0;
    const classes = this.classes;
    this.classList = {
      add: (...n) => n.forEach(x => classes.add(x)),
      remove: (...n) => n.forEach(x => classes.delete(x)),
      toggle: (n, on) => { const v = on === undefined ? !classes.has(n) : Boolean(on); if (v) classes.add(n); else classes.delete(n); return v; },
      contains: n => classes.has(n)
    };
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  closest() { return null; }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  focus() { this.focusCount++; }
}

function fire(target, type, props = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}

const pointer = (props = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 100, clientY: 100, shiftKey: false, ...props });

function createHarness({ seconds = 2700, interactive = true, applyResult = true } = {}) {
  const container = new FakeEl();
  const dial = new FakeEl();
  const body = new FakeEl();
  const win = new EventTarget();
  const readout = { value: new FakeEl(), ends: new FakeEl() };
  const plan = { seconds, interactive };
  const calls = { apply: [], dragChange: [] };
  const controller = Dial.createController({
    container, dial, readout, win, body,
    isInteractive: () => plan.interactive,
    getSeconds: () => plan.seconds,
    apply: next => { calls.apply.push(next); if (applyResult) plan.seconds = next; return applyResult; },
    describe: s => ({ duration: `${s / 60} min`, target: '23:45 · today' }),
    onDragChange: active => calls.dragChange.push(active)
  });
  const drag = (fromY, toY, props = {}) => {
    fire(container, 'pointerdown', pointer({ clientY: fromY, ...props }));
    const dir = Math.sign(toY - fromY);
    for (let y = fromY + dir * 2; dir ? (dir < 0 ? y >= toY : y <= toY) : false; y += dir * 2) fire(container, 'pointermove', pointer({ clientY: y, ...props }));
  };
  return { container, dial, body, win, readout, plan, calls, controller, drag };
}

test('idle drag up: whole-minute steps go through apply(), the readout shows the plan, release keeps it', () => {
  const h = createHarness();
  h.drag(160, 100);
  assert.equal(h.controller.isDragging(), true);
  assert.ok(h.container.classes.has('is-dragging') && h.body.classes.has('dial-dragging'));
  assert.deepEqual(h.calls.dragChange, [true]);
  assert.deepEqual(h.calls.apply, Array.from({ length: 10 }, (_, i) => (46 + i) * 60), 'one apply per whole minute, never a repeat');
  assert.equal(h.readout.value.textContent, '55 min');
  assert.equal(h.readout.ends.textContent, 'Ends 23:45 · today');
  assert.equal(h.dial.focusCount, 1, 'the slider takes focus on press');
  assert.equal(h.dial.getAttribute('data-pointer-focus'), '', 'pointer focus: no keyboard focus ring after a drag');
  assert.ok(h.container.captured.has(1), 'pointer capture on the instrument');
  fire(h.container, 'pointerup', pointer({ clientY: 100 }));
  assert.equal(h.controller.isDragging(), false);
  assert.ok(!h.container.classes.has('is-dragging') && !h.body.classes.has('dial-dragging'));
  assert.deepEqual(h.calls.dragChange, [true, false]);
  assert.equal(h.plan.seconds, 55 * 60, 'release keeps the value');
  assert.ok(!h.container.captured.has(1));
  fire(h.dial, 'keydown', { key: 'Shift' });
  assert.equal(h.dial.getAttribute('data-pointer-focus'), null, 'any key brings the keyboard focus ring back');
});

test('Escape while dragging restores the starting value through the same apply()', () => {
  const h = createHarness();
  h.drag(100, 160);
  assert.equal(h.plan.seconds, 35 * 60);
  const esc = fire(h.win, 'keydown', { key: 'Escape' });
  assert.equal(esc.defaultPrevented, true, 'the global Escape handler never sees it');
  assert.equal(h.calls.apply.at(-1), 2700);
  assert.equal(h.plan.seconds, 2700);
  assert.equal(h.controller.isDragging(), false);
  const later = fire(h.win, 'keydown', { key: 'Escape' });
  assert.equal(later.defaultPrevented, false, 'after the drag, Escape is not the dial\'s');
});

test('inert while running or paused: no drag, wheel or key reaches apply() and global keys keep their meaning', () => {
  const h = createHarness({ interactive: false });
  h.drag(160, 60);
  fire(h.container, 'pointerup', pointer({ clientY: 60 }));
  const wheel = fire(h.container, 'wheel', { clientX: 100, clientY: 100, deltaY: -100, deltaX: 0, deltaMode: 0, shiftKey: false });
  const keys = ['ArrowUp', 'PageUp', 'Home', 'End', ' '].map(key => fire(h.dial, 'keydown', { key, code: key === ' ' ? 'Space' : key }));
  assert.deepEqual(h.calls.apply, []);
  assert.deepEqual(h.calls.dragChange, []);
  assert.equal(h.controller.isDragging(), false);
  assert.equal(wheel.defaultPrevented, false, 'the page may still scroll');
  assert.ok(keys.every(e => !e.defaultPrevented), 'Space and the arrows fall through to the global shortcuts');
  assert.equal(h.dial.focusCount, 0);
  assert.equal(h.container.captured.size, 0);
  h.controller.sync();
  assert.equal(h.dial.getAttribute('aria-disabled'), 'true');
  assert.equal(h.dial.getAttribute('tabindex'), '-1');
  assert.equal(h.dial.getAttribute('aria-valuetext'), '45 minutes', 'no end-time claim while inert');
  assert.ok(!h.container.classes.has('dial-live'));
});

test('a run that starts mid-drag ends the drag at once and writes nothing more, not even on Escape', () => {
  const h = createHarness();
  h.drag(160, 130);
  const before = h.calls.apply.length;
  assert.ok(before > 0);
  h.plan.interactive = false; // e.g. a countdown started from the phone or the tray
  fire(h.container, 'pointermove', pointer({ clientY: 40 }));
  assert.equal(h.calls.apply.length, before);
  assert.equal(h.controller.isDragging(), false);
  assert.ok(!h.body.classes.has('dial-dragging'));
  fire(h.win, 'keydown', { key: 'Escape' });
  assert.equal(h.calls.apply.length, before, 'no restore write once the dial is inert');
  // A press made while idle never becomes a drag preview once a run starts.
  const p = createHarness();
  fire(p.container, 'pointerdown', pointer({ clientY: 160 }));
  p.plan.interactive = false;
  for (let y = 158; y >= 100; y -= 2) fire(p.container, 'pointermove', pointer({ clientY: y }));
  assert.deepEqual(p.calls.dragChange, [], 'no readout or preview arc over a run');
  assert.deepEqual(p.calls.apply, []);
  assert.equal(p.container.captured.size, 0, 'the pointer is released at once');
  // sync() (every render) also ends a drag the moment the gate closes.
  const g = createHarness();
  g.drag(160, 130);
  const n = g.calls.apply.length;
  g.plan.interactive = false;
  g.controller.sync();
  assert.equal(g.controller.isDragging(), false);
  assert.equal(g.calls.apply.length, n);
});

test('apply() refusing a write (the shared path\'s run guard) ends the drag', () => {
  const h = createHarness({ applyResult: false });
  h.drag(160, 140);
  assert.equal(h.calls.apply.length, 1);
  assert.equal(h.controller.isDragging(), false);
});

test('a click is not a drag; right button, secondary pointers, own controls and the corners are ignored', () => {
  const h = createHarness();
  fire(h.container, 'pointerdown', pointer());
  fire(h.container, 'pointermove', pointer({ clientY: 99 }));
  fire(h.container, 'pointerup', pointer({ clientY: 99 }));
  assert.deepEqual(h.calls.apply, []);
  assert.deepEqual(h.calls.dragChange, [], 'no readout for a click');

  const right = fire(h.container, 'pointerdown', pointer({ button: 2 }));
  assert.equal(right.defaultPrevented, false);
  const second = fire(h.container, 'pointerdown', pointer({ isPrimary: false, pointerType: 'touch', pointerId: 7 }));
  assert.equal(second.defaultPrevented, false);
  const corner = fire(h.container, 'pointerdown', pointer({ clientX: 2, clientY: 2 }));
  assert.equal(corner.defaultPrevented, false);
  const name = new FakeEl();
  name.closest = selector => (selector.includes('.timer-name') ? name : null);
  const onName = fire(h.container, 'pointerdown', pointer({ target: name }));
  assert.equal(onName.defaultPrevented, false, 'the session name stays editable');
  for (let y = 98; y >= 40; y -= 2) fire(h.container, 'pointermove', pointer({ clientY: y }));
  assert.deepEqual(h.calls.apply, []);

  const touch = createHarness();
  touch.drag(160, 148, { pointerType: 'touch', pointerId: 4 });
  assert.deepEqual(touch.calls.apply, [46 * 60, 47 * 60], 'touch and pen drag like the mouse');
});

test('keyboard and wheel step through apply(); Space is swallowed so the slider never starts a run', () => {
  const h = createHarness();
  const up = fire(h.dial, 'keydown', { key: 'ArrowUp' });
  assert.equal(up.defaultPrevented, true, 'the global ArrowUp (+1 via the stepper) does not also fire');
  assert.equal(h.plan.seconds, 46 * 60);
  fire(h.dial, 'keydown', { key: 'PageDown' });
  assert.equal(h.plan.seconds, 41 * 60);
  fire(h.dial, 'keydown', { key: 'ArrowRight', shiftKey: true });
  assert.equal(h.plan.seconds, 46 * 60);
  fire(h.dial, 'keydown', { key: 'Home' });
  assert.equal(h.plan.seconds, 60);
  fire(h.dial, 'keydown', { key: 'ArrowDown' });
  assert.equal(h.calls.apply.length, 4, 'no write when the value cannot change');
  fire(h.dial, 'keydown', { key: 'End' });
  assert.equal(h.plan.seconds, 480 * 60);
  const space = fire(h.dial, 'keydown', { key: ' ', code: 'Space' });
  assert.equal(space.defaultPrevented, true);
  const ctrl = fire(h.dial, 'keydown', { key: 'ArrowDown', ctrlKey: true });
  assert.equal(ctrl.defaultPrevented, false, 'modified keys stay global');
  const digit = fire(h.dial, 'keydown', { key: '3' });
  assert.equal(digit.defaultPrevented, false);
  assert.equal(h.calls.apply.length, 5);

  const w = createHarness();
  const wheelUp = fire(w.container, 'wheel', { clientX: 100, clientY: 100, deltaY: -100, deltaX: 0, deltaMode: 0, shiftKey: false });
  assert.equal(wheelUp.defaultPrevented, true);
  assert.equal(w.plan.seconds, 46 * 60);
  fire(w.container, 'wheel', { clientX: 100, clientY: 100, deltaY: 0, deltaX: 100, deltaMode: 0, shiftKey: true });
  assert.equal(w.plan.seconds, 41 * 60, 'Shift+wheel (Chromium sends deltaX) steps 5');
  const outside = fire(w.container, 'wheel', { clientX: 1, clientY: 1, deltaY: -100, deltaX: 0, deltaMode: 0, shiftKey: false });
  assert.equal(outside.defaultPrevented, false);
  assert.equal(w.plan.seconds, 41 * 60);
});

test('sync() keeps the slider semantics in step with the plan and the gate', () => {
  const h = createHarness({ seconds: 2700 });
  h.controller.sync();
  assert.equal(h.dial.getAttribute('aria-valuemin'), '1');
  assert.equal(h.dial.getAttribute('aria-valuemax'), '480');
  assert.equal(h.dial.getAttribute('aria-valuenow'), '45');
  assert.equal(h.dial.getAttribute('aria-valuetext'), '45 minutes, ends 23:45');
  assert.equal(h.dial.getAttribute('aria-disabled'), 'false');
  assert.equal(h.dial.getAttribute('tabindex'), '0');
  assert.ok(h.container.classes.has('dial-live'));
  h.plan.seconds = 90 * 60;
  h.controller.sync();
  assert.equal(h.dial.getAttribute('aria-valuenow'), '90');
});

// ---- Renderer wiring (vm) -------------------------------------------------------

function createRendererDial({ state: overrides = {}, dom = {} } = {}) {
  const state = { running: false, paused: false, settingsLoaded: true, miniMode: false, fullscreenClock: false, unit: 'min', ...overrides };
  const container = new FakeEl();
  const dial = new FakeEl();
  const body = new FakeEl();
  const ritualOverlay = new FakeEl();
  if (dom.ritualActive) ritualOverlay.classes.add('active');
  const panel = { style: { display: dom.panelHidden ? 'none' : '' } };
  const calls = [];
  const els = { timerInput: { value: '45' }, ritualOverlay };
  const sandbox = {
    state, els, TonightDial: Dial, window: new EventTarget(),
    document: {
      body,
      querySelector: sel => (sel === '.ring-container' ? container : null),
      getElementById: id => ({ 'tonight-dial': dial, 'ns-panel-lib': panel }[id] || new FakeEl())
    },
    timerShortcutSurfaceBlocked: () => Boolean(dom.modalOpen),
    scheduleOverrideTarget: () => (dom.scheduleTarget ? new Date() : null),
    inputSeconds: () => (parseInt(els.timerInput.value, 10) || 1) * (state.unit === 'sec' ? 1 : 60),
    inputValue: () => parseInt(els.timerInput.value, 10) || 1,
    setInputFromSeconds: s => calls.push(['setInputFromSeconds', s]),
    checkArmedModeMatch: () => calls.push(['checkArmedModeMatch']),
    checkProfileMatch: edited => calls.push(['checkProfileMatch', edited]),
    persistTonightDuration: () => calls.push(['persistTonightDuration']),
    releaseOutcomeHold: () => calls.push(['releaseOutcomeHold']),
    render: () => calls.push(['render']),
    formatDuration: s => `${Math.round(s / 60)} min`,
    formatClockTarget: () => '23:45 · today',
    // Never reachable from the dial; any call fails the test.
    startTimer: () => { throw new Error('the dial started a timer'); },
    startTonightPlan: () => { throw new Error('the dial started a timer'); },
    togglePause: () => { throw new Error('the dial paused a run'); },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext([
    functionSource(rendererSource, 'tonightDialInteractive'),
    functionSource(rendererSource, 'createTonightDial'),
    functionSource(rendererSource, 'applyTonightDuration'),
    'this.__t = { tonightDialInteractive, controller: createTonightDial(applyTonightDuration), applyTonightDuration };'
  ].join('\n'), sandbox);
  return { ...sandbox.__t, state, els, calls, container, dial, body };
}

test('the dial writes through the stepper\'s own path (applyTonightDuration), idle', () => {
  const r = createRendererDial();
  fire(r.container, 'pointerdown', pointer({ clientY: 160 }));
  for (let y = 158; y >= 148; y -= 2) fire(r.container, 'pointermove', pointer({ clientY: y }));
  fire(r.container, 'pointerup', pointer({ clientY: 148 }));
  assert.equal(r.els.timerInput.value, 47, 'the duration input follows the dial');
  const chain = r.calls.filter(([name]) => name !== 'render' && name !== 'releaseOutcomeHold');
  assert.deepEqual(chain, [
    ['setInputFromSeconds', 46 * 60], ['checkArmedModeMatch'], ['checkProfileMatch', true], ['persistTonightDuration'],
    ['setInputFromSeconds', 47 * 60], ['checkArmedModeMatch'], ['checkProfileMatch', true], ['persistTonightDuration']
  ], 'each whole minute runs the stepper chain: input, plan, identity checks, durationSeconds save');
  assert.ok(r.calls.some(([name]) => name === 'releaseOutcomeHold'), 'a drag ends the completion hold like any setup edit');

  const sec = createRendererDial({ state: { unit: 'sec' } });
  sec.els.timerInput.value = '2700';
  fire(sec.dial, 'keydown', { key: 'ArrowUp' });
  assert.equal(sec.els.timerInput.value, 2760, 'a sec-unit input is written in seconds');
});

test('the renderer dial is inert while running, paused, in a ritual, mini, fullscreen, before settings load and more', () => {
  const cases = {
    running: { state: { running: true } },
    paused: { state: { paused: true } },
    'settings not loaded': { state: { settingsLoaded: false } },
    'mini mode': { state: { miniMode: true } },
    'fullscreen clock': { state: { fullscreenClock: true } },
    ritual: { dom: { ritualActive: true } },
    'a dialog or onboarding': { dom: { modalOpen: true } },
    'Tonight not on screen': { dom: { panelHidden: true } },
    'One night only owns the duration': { dom: { scheduleTarget: true } }
  };
  for (const [label, options] of Object.entries(cases)) {
    const r = createRendererDial(options);
    assert.equal(r.tonightDialInteractive(), false, label);
    fire(r.container, 'pointerdown', pointer({ clientY: 160 }));
    for (let y = 158; y >= 60; y -= 2) fire(r.container, 'pointermove', pointer({ clientY: y }));
    fire(r.container, 'pointerup', pointer({ clientY: 60 }));
    fire(r.container, 'wheel', { clientX: 100, clientY: 100, deltaY: -100, deltaX: 0, deltaMode: 0, shiftKey: false });
    for (const key of ['ArrowUp', 'PageUp', 'End', ' ']) fire(r.dial, 'keydown', { key });
    assert.equal(r.els.timerInput.value, '45', `${label}: the input is untouched`);
    assert.deepEqual(r.calls, [], `${label}: nothing on the stepper path ran`);
  }
  assert.equal(createRendererDial().tonightDialInteractive(), true, 'idle with everything in reach: live');
});

test('applyTonightDuration refuses to touch a run, whoever calls it', () => {
  for (const state of [{ running: true }, { paused: true }]) {
    const r = createRendererDial({ state });
    assert.equal(r.applyTonightDuration(60), false);
    assert.equal(r.els.timerInput.value, '45');
    assert.deepEqual(r.calls, []);
  }
  const idle = createRendererDial();
  assert.equal(idle.applyTonightDuration(60), true);
  assert.equal(idle.els.timerInput.value, 60);
});

// ---- Source contracts -------------------------------------------------------------

test('one edit path: +/- and the dial both go through applyTonightDuration; the dial never starts or pauses', () => {
  const shared = functionSource(rendererSource, 'applyTonightDuration');
  assert.match(shared, /if \(state\.running \|\| state\.paused\) return false;[\s\S]*els\.timerInput\.value = value;[\s\S]*setInputFromSeconds\(inputSeconds\(\)\);[\s\S]*checkArmedModeMatch\(\);[\s\S]*checkProfileMatch\(true\);[\s\S]*persistTonightDuration\(\);[\s\S]*render\(\);/);
  assert.match(rendererSource, /els\.btnPlus\.addEventListener\('click', \(\) => \{\s*applyTonightDuration\(inputValue\(\) \+ 1\);\s*\}\);/);
  assert.match(rendererSource, /els\.btnMinus\.addEventListener\('click', \(\) => \{\s*applyTonightDuration\(Math\.max\(1, inputValue\(\) - 1\)\);\s*\}\);/);
  assert.match(rendererSource, /tonightDial = createTonightDial\(applyTonightDuration\);/);
  const wiring = functionSource(rendererSource, 'createTonightDial');
  assert.match(wiring, /isInteractive: tonightDialInteractive/);
  assert.match(wiring, /getSeconds: inputSeconds/);
  const forbidden = /startTimer|startTonightPlan|togglePause|cancelTimer|snooze|saveAppSettings|api\.|electronAPI|ipcRenderer/;
  assert.doesNotMatch(wiring, forbidden);
  assert.doesNotMatch(dialSource.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''), forbidden, 'tonightDial.js has no route to a run or to settings');
  const gate = functionSource(rendererSource, 'tonightDialInteractive');
  for (const needle of ['state.settingsLoaded', 'state.running', 'state.paused', 'state.miniMode', 'state.fullscreenClock', "ritualOverlay?.classList.contains('active')", 'timerShortcutSurfaceBlocked()', 'scheduleOverrideTarget()']) {
    assert.ok(gate.includes(needle), `the gate checks ${needle}`);
  }
});

test('render() keeps the dial in sync and previews only an idle drag', () => {
  const render = functionSource(rendererSource, 'render');
  assert.match(render, /if \(typeof tonightDial !== 'undefined' && tonightDial\) tonightDial\.sync\(\);\s*\}$/, 'sync() is the last thing render() does');
  assert.match(render, /if \(!bezelDrawn && isIdle && typeof tonightDial !== 'undefined' && tonightDial\?\.isDragging\(\)\) \{\s*updateRing\(TonightDial\.previewRatio\(tonightDial\.previewMinutes\(\)\), 1\);\s*\}/);
});

test('markup: one focusable role=slider inside the instrument, loaded before renderer.js and packaged', () => {
  const ring = htmlSource.slice(htmlSource.indexOf('<div class="ring-container">'), htmlSource.indexOf('<div class="clock-face-controls"'));
  assert.match(ring, /<div class="tonight-dial" id="tonight-dial" role="slider" tabindex="-1" aria-label="Tonight's duration" aria-orientation="vertical" aria-valuemin="1" aria-valuemax="480" aria-valuenow="\d+" aria-valuetext="[^"]+" aria-disabled="true" aria-describedby="tonight-dial-desc">/);
  assert.match(ring, /id="tonight-dial-readout" aria-hidden="true"[\s\S]*id="tonight-dial-value"[\s\S]*id="tonight-dial-ends"/);
  assert.match(ring, /class="tonight-dial-hint" aria-hidden="true">[\s\S]*Drag to set<\/span>/);
  assert.equal((htmlSource.match(/role="slider"/g) || []).length, 1);
  const dialAt = htmlSource.indexOf('<script src="tonightDial.js"></script>');
  assert.ok(dialAt > 0 && dialAt < htmlSource.indexOf('<script src="renderer.js"></script>'));
  assert.ok(pkg.build.files.includes('tonightDial.js'), 'tonightDial.js ships in the build');
});

test('styles: no drag region, no selection, a grab cursor, the preview only while dragging, reduced motion respected', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const block = css.slice(css.indexOf('/* -- UI-R3 · Tonight dial'), css.indexOf('/* -- Reduced motion: one global contract'));
  assert.ok(block.length > 100, 'the Tonight dial block sits before the reduced-motion contract');
  assert.match(block, /\.ring-container\.dial-live \{[^}]*cursor: grab;[^}]*touch-action: none;[^}]*user-select: none;[^}]*-webkit-app-region: no-drag;/);
  assert.match(block, /\.tonight-dial \{[^}]*pointer-events: none;/, 'the overlay never steals the pointer from the name or the buttons');
  assert.match(block, /body\.dial-dragging \* \{ cursor: grabbing !important; \}/);
  assert.match(block, /body\.dial-dragging:not\(\.is-running\):not\(\.is-paused\) \.timer-section \.ring-progress \{[^}]*opacity: 1;/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(block, /-webkit-app-region: drag/);
});
