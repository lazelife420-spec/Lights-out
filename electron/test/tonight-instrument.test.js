'use strict';

// UI-R3 P06: the Tonight instrument. The idle bezel, the plan facts and the
// session console head are pure renderer functions; their real bodies are
// extracted from renderer.js (and ORIGIN_LABELS from renderer-utils.js) and
// run in a vm sandbox with a fixed clock and a minimal DOM. No Electron, no
// window, no power action.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-utils.js'), 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found`);
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

function extractLine(source, re) {
  const m = source.match(re);
  if (!m) throw new Error(`declaration not found: ${re}`);
  return m[0];
}

function createClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(n => values.add(n)),
    remove: (...names) => names.forEach(n => values.delete(n)),
    toggle: (name, force) => {
      const on = force === undefined ? !values.has(name) : Boolean(force);
      if (on) values.add(name); else values.delete(name);
      return on;
    },
    contains: name => values.has(name),
    list: () => [...values].sort()
  };
}

function el(text = '') {
  return { textContent: text, style: {}, classList: createClassList(), writes: 0 };
}

// A Date whose "now" is fixed; explicit constructor arguments behave normally.
function fixedDate(ms) {
  return class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(ms); else super(...args); }
    static now() { return ms; }
  };
}

const C = 2 * Math.PI * 90;
const at = (h, m, s = 0) => new Date(2026, 9, 6, h, m, s).getTime();

function createInstrument({ now = at(23, 40), state: stateOverrides = {} } = {}) {
  const ids = ['plan-out-at', 'plan-out-at-label', 'ns-hero-label', 'session-phase', 'session-ends', 'ns-meta-reach'];
  const elements = Object.fromEntries(ids.map(id => [id, el()]));
  const frames = [];
  const body = { classList: createClassList(), style: {} };
  const state = {
    action: 'shutdown',
    unit: 'min',
    dryRun: true,
    settingsLoaded: true,
    clockFormat: '24h',
    armedNightMode: null,
    running: false,
    paused: false,
    phase: 'idle',
    origin: undefined,
    endsAt: null,
    ...stateOverrides
  };
  const sandbox = {
    state,
    els: {
      ringProgress: { style: {} },
      ringHead: { style: {} },
      timerInput: { value: '28' },
      scheduleCheck: null,
      scheduleTime: null
    },
    document: { body, getElementById: id => elements[id] || null },
    requestAnimationFrame: cb => frames.push(cb),
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    secondsUntilClockValue: () => 0,
    Date: fixedDate(now),
    console
  };
  vm.createContext(sandbox);
  const source = [
    extractLine(utilsSource, /const ORIGIN_LABELS = Object\.freeze\(\{[\s\S]*?\}\);/),
    extractLine(rendererSource, /const BEZEL_HOUR_SCALE_FROM = [^\n]*/),
    extractLine(rendererSource, /const BEZEL_MAX_SECONDS = [^\n]*/),
    extractLine(rendererSource, /let bezelKey = [^\n]*/),
    extractLine(rendererSource, /let bezelPlan = [^\n]*/),
    extractLine(rendererSource, /const SESSION_PHASE_LABELS = [^\n]*/),
    // One clock (UI-R3 Fire 02): the formatters live in renderer-utils.js.
    ...['formatIdleClockTime', 'formatClock', 'formatClockTarget'].map(n => extractFunction(utilsSource, n)),
    ...['actionLabel', 'formatEndTime', 'inputValue', 'inputSeconds', 'planSecondsNow',
      'updateIdleBezel', 'clearIdleBezel', 'idleBezelLabel', 'planEndsPastBedtime', 'setTextIfChanged',
      'updatePlanFacts', 'updateSessionHead', 'countdownRingLabel', 'planReachText'].map(n => extractFunction(rendererSource, n))
  ].join('\n');
  vm.runInContext(`${source}
this.__t = { ORIGIN_LABELS, updateIdleBezel, clearIdleBezel, idleBezelLabel, planEndsPastBedtime, updatePlanFacts, updateSessionHead, countdownRingLabel, planReachText, formatEndTime, get bezelKey() { return bezelKey; } };`, sandbox);
  const flushFrames = () => { while (frames.length) frames.shift()(); };
  return { ...sandbox.__t, state, elements, body, els: sandbox.els, flushFrames, frames, Date: sandbox.Date };
}

const dash = els => els.ringProgress.style.strokeDasharray.split(' ').map(Number);
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('minute scale: 28 min at 23:40 starts at the minute hand and wraps past 12 o\'clock', () => {
  const t = createInstrument();
  t.updateIdleBezel(new t.Date(), 28 * 60);
  const [L, gap] = dash(t.els);
  near(L, (1680 / 3600) * C);
  near(L + gap, C);                       // period-C pattern: the arc wraps instead of being cut
  near(Number(t.els.ringProgress.style.strokeDashoffset), -(40 / 60) * C);
  near(parseFloat(t.els.ringHead.style.transform.slice(7)), ((40 / 60) + (1680 / 3600)) * 360);
  assert.ok(t.body.classList.contains('bezel'));
  assert.ok(!t.body.classList.contains('bezel-hour'));
  assert.ok(!t.body.classList.contains('bezel-empty'));
});

test('hour scale at 60 min and above: the arc starts at the hour hand, with hour ticks', () => {
  const t = createInstrument();
  t.updateIdleBezel(new t.Date(), 2 * 3600);
  const [L] = dash(t.els);
  near(L, (7200 / 43200) * C);
  near(Number(t.els.ringProgress.style.strokeDashoffset), -((11 + 40 / 60) / 12) * C);
  assert.ok(t.body.classList.contains('bezel-hour'));
  const t45 = createInstrument();
  t45.updateIdleBezel(new t45.Date(), 45 * 60);
  assert.ok(!t45.body.classList.contains('bezel-hour'), '45 min stays on the minute scale');
});

test('over 12 h there is no arc and no head, only the label', () => {
  const t = createInstrument();
  t.updateIdleBezel(new t.Date(), 13 * 3600);
  assert.ok(t.body.classList.contains('bezel-empty'));
  assert.equal(t.els.ringProgress.style.strokeDasharray, undefined);
  assert.equal(t.els.ringHead.style.transform, undefined);
});

test('a full 60-minute minute-scale sweep never closes the ring (L < C)', () => {
  const t = createInstrument();
  t.updateIdleBezel(new t.Date(), 3599);
  const [L, gap] = dash(t.els);
  assert.ok(L < C && gap > 0);
});

test('updates are key-deduped to ~5 s; only a plan change on the same scale tweens', () => {
  const t = createInstrument();
  const now = new t.Date();
  t.updateIdleBezel(now, 28 * 60);
  assert.ok(!t.body.classList.contains('bezel-tween'), 'the first bezel frame is instant');
  t.els.ringProgress.style.strokeDasharray = 'sentinel';
  t.updateIdleBezel(new Date(now.getTime() + 2000), 28 * 60);
  assert.equal(t.els.ringProgress.style.strokeDasharray, 'sentinel', 'same 5 s window: no rewrite');
  t.updateIdleBezel(now, 45 * 60);
  assert.ok(t.body.classList.contains('bezel-tween'), 'a plan change tweens');
  t.updateIdleBezel(new Date(now.getTime() + 6000), 45 * 60);
  assert.ok(!t.body.classList.contains('bezel-tween'), 'a clock tick (or an hour wrap) is instant');
  t.updateIdleBezel(new Date(now.getTime() + 6000), 90 * 60);
  assert.ok(!t.body.classList.contains('bezel-tween'), 'a scale change is instant');
});

test('leaving the bezel clears its classes and key and holds ring transitions for one frame', () => {
  const t = createInstrument();
  t.updateIdleBezel(new t.Date(), 2 * 3600);
  t.clearIdleBezel();
  assert.equal(t.bezelKey, '');
  for (const c of ['bezel', 'bezel-hour', 'bezel-empty', 'bezel-tween']) assert.ok(!t.body.classList.contains(c), c);
  assert.ok(t.body.classList.contains('ring-instant'));
  t.flushFrames();
  assert.ok(!t.body.classList.contains('ring-instant'));
  t.clearIdleBezel();
  assert.ok(!t.body.classList.contains('ring-instant'), 'clearing with no bezel is a no-op');
});

test('the bezel label is truthful by mode and follows the user clock format', () => {
  const test24 = createInstrument({ state: { dryRun: true } });
  assert.equal(test24.idleBezelLabel(28 * 60), 'If started now · 00:08 · tomorrow');
  const real = createInstrument({ state: { dryRun: false } });
  assert.equal(real.idleBezelLabel(28 * 60), 'If started now · 00:08 · tomorrow');
  const real12 = createInstrument({ state: { dryRun: false, clockFormat: '12h', action: 'sleep' } });
  assert.equal(real12.idleBezelLabel(28 * 60), 'If started now · 12:08 AM · tomorrow');
  const armed = createInstrument({ state: { dryRun: false, armedNightMode: { action: 'hibernate', durationSeconds: 5400 } } });
  assert.equal(armed.idleBezelLabel(5400), 'If started now · 01:10 · tomorrow');
  const checking = createInstrument({ state: { settingsLoaded: false, dryRun: false } });
  assert.equal(checking.idleBezelLabel(28 * 60), 'If started now · 00:08 · tomorrow', 'no power claim before the mode is known');
  assert.doesNotMatch(test24.idleBezelLabel(28 * 60), /Shutdown|Sleep|Restart|Hibernate|Lock/);
});

test('past bedtime compares only with the most recent bedtime within 12 h (midnight-safe)', () => {
  const t = createInstrument();
  assert.equal(t.planEndsPastBedtime(new Date(at(0, 8) + 86400000), '22:30'), true);
  assert.equal(t.planEndsPastBedtime(new Date(at(23, 0)), '22:30'), true);
  assert.equal(t.planEndsPastBedtime(new Date(at(15, 28)), '22:30'), false);
  assert.equal(t.planEndsPastBedtime(new Date(at(22, 30)), '22:30'), false, 'exactly at bedtime is not past it');
  assert.equal(t.planEndsPastBedtime(new Date(at(23, 0)), ''), false);
  assert.equal(t.planEndsPastBedtime(new Date(at(23, 0)), 'soon'), false);
});

test('plan facts: Ends at from the same plan Start reads, a mode-aware dt, and a time-of-day eyebrow', () => {
  const t = createInstrument();
  t.updatePlanFacts();
  assert.equal(t.elements['plan-out-at'].textContent, '00:08 · tomorrow');
  assert.equal(t.elements['plan-out-at-label'].textContent, 'If started now');
  assert.equal(t.elements['ns-hero-label'].textContent, "TONIGHT'S PLAN");

  const real = createInstrument({ now: at(10, 0), state: { dryRun: false, armedNightMode: { action: 'sleep', durationSeconds: 5400 } } });
  real.updatePlanFacts();
  assert.equal(real.elements['plan-out-at'].textContent, '11:30 · today', 'an armed Night Mode uses its own duration');
  assert.equal(real.elements['plan-out-at-label'].textContent, 'If started now');
  assert.equal(real.elements['ns-hero-label'].textContent, 'NEXT RUN');

  // textContent only, and only when it changes.
  let writes = 0;
  const target = t.elements['plan-out-at'];
  let value = target.textContent;
  Object.defineProperty(target, 'textContent', { get: () => value, set: v => { writes++; value = v; } });
  t.updatePlanFacts();
  t.updatePlanFacts();
  assert.equal(writes, 0);
});

test('formatEndTime follows the 12h/24h setting and keeps its Idle sentinel (Fire 02)', () => {
  const ends = new Date(at(1, 8) + 86400000).toISOString();
  const h24 = createInstrument({ state: { clockFormat: '24h' } });
  assert.equal(h24.formatEndTime(ends), '01:08');
  const h12 = createInstrument({ state: { clockFormat: '12h' } });
  assert.equal(h12.formatEndTime(ends), '1:08 AM', 'never the compact form, never a leading zero');
  const unset = createInstrument({ state: { clockFormat: undefined } });
  assert.equal(unset.formatEndTime(ends), '01:08', 'an unset format reads 24h, as schClockParts');
  assert.equal(h12.formatEndTime(null), 'Idle');
  assert.equal(h12.formatEndTime('not a date'), 'Idle');
  const run = createInstrument({ state: { running: true, phase: 'focus', dryRun: true, clockFormat: '12h', endsAt: ends } });
  run.updateSessionHead();
  assert.equal(run.elements['session-ends'].textContent, 'Test ends 1:08 AM · tomorrow');
});

test('countdown ring states the actual end in the chosen time format without promising power actions in Test Mode', () => {
  const endsAt = new Date(at(22, 45)).toISOString();
  const t = createInstrument({ state: { running: true, dryRun: true, action: 'sleep', endsAt } });
  assert.equal(t.countdownRingLabel(), 'Test ends 22:45 · today');
  t.state.clockFormat = '12h';
  assert.equal(t.countdownRingLabel(), 'Test ends 10:45 PM · today');
  t.state.dryRun = false;
  assert.equal(t.countdownRingLabel(), 'Sleep at 10:45 PM · today');
  t.state.endsAt = null;
  assert.equal(t.countdownRingLabel(), 'Sleep when timer ends');
  t.state.dryRun = true;
  assert.equal(t.countdownRingLabel(), 'Test Mode · no power action');
});

test('a paused countdown gives no moving finish-time claim', () => {
  for (const dryRun of [true, false]) {
    const t = createInstrument({ state: { running: true, paused: true, dryRun, endsAt: new Date(at(22, 45)).toISOString() } });
    assert.equal(t.countdownRingLabel(), 'On hold until you resume');
    t.state.endsAt = new Date(at(23, 15)).toISOString();
    assert.equal(t.countdownRingLabel(), 'On hold until you resume');
  }
});

test('session head: phase, origin only from the frozen map, and the real end', () => {
  const ends = new Date(at(0, 8) + 86400000).toISOString();
  const run = createInstrument({ state: { running: true, phase: 'focus', origin: 'phone', dryRun: true, endsAt: ends } });
  run.updateSessionHead();
  assert.equal(run.elements['session-phase'].textContent, 'Running · from your phone');
  assert.equal(run.elements['session-ends'].textContent, `Test ends ${run.formatEndTime(ends)} · tomorrow`);

  const real = createInstrument({ state: { running: true, phase: 'dim', origin: 'this-pc', dryRun: false, endsAt: ends } });
  real.updateSessionHead();
  assert.equal(real.elements['session-phase'].textContent, 'Winding down');
  assert.equal(real.elements['session-ends'].textContent, `Shutdown at ${real.formatEndTime(ends)} · tomorrow`);

  const paused = createInstrument({ state: { paused: true, phase: 'focus', origin: 'schedule', endsAt: ends } });
  paused.updateSessionHead();
  assert.equal(paused.elements['session-phase'].textContent, 'Paused · from Schedule');
  assert.equal(paused.elements['session-ends'].textContent, 'On hold until you resume');

  for (const origin of ['<img src=x onerror=alert(1)>', 'constructor', '__proto__', 'toString', 42, null]) {
    const odd = createInstrument({ state: { running: true, phase: 'lastlight', origin, endsAt: ends } });
    odd.updateSessionHead();
    assert.equal(odd.elements['session-phase'].textContent, 'Last light', `origin ${String(origin)} must add nothing`);
  }
  const unknownEnd = createInstrument({ state: { running: true, phase: 'focus', dryRun: false, endsAt: null } });
  unknownEnd.updateSessionHead();
  assert.equal(unknownEnd.elements['session-ends'].textContent, 'Shutdown at the end', 'never "at Idle"');
});

test('ORIGIN_LABELS is a frozen map with the agreed phrases', () => {
  const { ORIGIN_LABELS } = createInstrument();
  assert.ok(Object.isFrozen(ORIGIN_LABELS));
  assert.deepEqual({ ...ORIGIN_LABELS }, {
    phone: 'from your phone',
    family: 'from another PC',
    schedule: 'from Schedule',
    calendar: 'from your calendar',
    autopilot: 'by Autopilot',
    shortcut: 'from a shortcut',
    tray: 'from the tray',
    launch: 'at launch',
    ritual: 'after the ritual',
    resume: 'resumed after a restart'
  });
});

// ---- UI-R3 Fire 04: one name per session, an honest station -------------

function createFire04({ text = 'Last Call', focused = false, state: stateOverrides = {} } = {}) {
  const nameEl = el(text);
  let writes = 0;
  let value = text;
  Object.defineProperty(nameEl, 'textContent', { get: () => value, set: v => { writes++; value = v; } });
  const state = { running: false, paused: false, totalSeconds: 0, runGraceMinutes: null, timerName: text, ...stateOverrides };
  const sandbox = {
    state,
    els: { timerName: nameEl },
    document: { activeElement: focused ? nameEl : null },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext([
    extractLine(utilsSource, /const DEFAULT_TIMER_NAME = [^\n]*/),
    extractFunction(rendererSource, 'syncTimerNameDefault'),
    extractFunction(rendererSource, 'hasWindingDownStation'),
    'this.__t = { syncTimerNameDefault, hasWindingDownStation };'
  ].join('\n'), sandbox);
  return { ...sandbox.__t, nameEl, state, sandbox, writes: () => writes };
}

test('syncTimerNameDefault marks the stored default and an empty name, never a chosen one', () => {
  for (const text of ['Last Call', '', '   ', '  Last Call  ']) {
    const t = createFire04({ text });
    t.syncTimerNameDefault();
    assert.ok(t.nameEl.classList.contains('is-default'), `"${text}" is the default`);
  }
  const custom = createFire04({ text: 'Movie night' });
  custom.syncTimerNameDefault();
  assert.ok(!custom.nameEl.classList.contains('is-default'), 'a chosen name is not the default');
  // A chosen name that later becomes the default again (and back) follows it.
  const t = createFire04({ text: 'Movie night' });
  t.syncTimerNameDefault();
  t.nameEl.textContent = 'Last Call';
  t.syncTimerNameDefault();
  assert.ok(t.nameEl.classList.contains('is-default'));
});

test('syncTimerNameDefault leaves a focused edit alone and never writes the name', () => {
  const t = createFire04({ text: 'Last Call', focused: true });
  t.syncTimerNameDefault();
  assert.ok(!t.nameEl.classList.contains('is-default'), 'no class change while the element has focus');
  const before = t.writes();
  const blurred = createFire04({ text: 'Last Call' });
  blurred.syncTimerNameDefault();
  assert.equal(t.writes(), before, 'presentation only: textContent is never assigned');
  assert.equal(blurred.writes(), 0);
  assert.equal(blurred.state.timerName, 'Last Call', 'state.timerName is untouched');
  assert.doesNotMatch(extractFunction(rendererSource, 'syncTimerNameDefault'), /textContent\s*=[^=]|state\.timerName\s*=|saveAppSettings/);
});

test('the station appears only when the run really has a winding-down phase', () => {
  const show = createFire04({ state: { running: true, totalSeconds: 28 * 60, runGraceMinutes: 2 } });
  assert.equal(show.hasWindingDownStation(), true, 'grace 2 min on a 28 min run: winding down starts at 7:00 left');
  const paused = createFire04({ state: { paused: true, totalSeconds: 28 * 60, runGraceMinutes: 2 } });
  assert.equal(paused.hasWindingDownStation(), true, 'a paused run keeps its station');
  const none = createFire04({ state: { running: true, totalSeconds: 30 * 60, runGraceMinutes: 10 } });
  assert.equal(none.hasWindingDownStation(), false, 'grace 10 min on a 30 min run: grace comes first, no winding down');
  const equal = createFire04({ state: { running: true, totalSeconds: 8 * 60, runGraceMinutes: 2 } });
  assert.equal(equal.hasWindingDownStation(), false, '25% exactly at the grace mark: no winding-down phase');
  for (const grace of [null, undefined, NaN, -1]) {
    const missing = createFire04({ state: { running: true, totalSeconds: 28 * 60, runGraceMinutes: grace } });
    assert.equal(missing.hasWindingDownStation(), false, `grace ${String(grace)}: nothing is drawn`);
  }
  const idle = createFire04({ state: { running: false, paused: false, totalSeconds: 28 * 60, runGraceMinutes: 2 } });
  assert.equal(idle.hasWindingDownStation(), false, 'idle: no station');
  const zero = createFire04({ state: { running: true, totalSeconds: 0, runGraceMinutes: 0 } });
  assert.equal(zero.hasWindingDownStation(), false, 'no total: no station');
});

test('the run grace comes only from the timer payload and is cleared when the run ends', () => {
  const body = extractFunction(rendererSource, 'applyTimerPayload');
  assert.match(body, /if \(data\.gracePeriod !== undefined\) \{\s*state\.runGraceMinutes = data\.gracePeriod !== null && Number\.isFinite\(Number\(data\.gracePeriod\)\) && Number\(data\.gracePeriod\) >= 0 \? Number\(data\.gracePeriod\) : null;/);
  const complete = body.slice(body.indexOf("if (data.type === 'complete')"), body.indexOf("} else if (data.type === 'cancelled')"));
  const cancelled = body.slice(body.indexOf("} else if (data.type === 'cancelled')"), body.indexOf("} else if (data.type === 'warning')"));
  assert.match(complete, /state\.runGraceMinutes = null;/);
  assert.match(cancelled, /state\.runGraceMinutes = null;/);
  const ring = extractFunction(rendererSource, 'updateRing');
  assert.doesNotMatch(ring, /has-station|runGraceMinutes/, 'updateRing never draws the station');
});

test('Controls lists only verified sources and never implies the power action reaches them', () => {
  const t = createInstrument();
  assert.equal(t.planReachText(null, null), 'This PC');
  assert.equal(t.planReachText({ mode: 'off', clients: 3 }, null), 'This PC');
  assert.equal(t.planReachText({ mode: 'local', clients: 1 }, null), 'This PC + 1 connected device');
  assert.equal(t.planReachText({ mode: 'wifi', clients: 2 }, { enabled: true, verifiedConfigKey: 'k' }), 'This PC + 2 connected devices + Lights');
  assert.equal(t.planReachText({ mode: 'wifi', clients: 0 }, { enabled: true, verifiedConfigKey: '' }), 'This PC', 'unverified lights are not listed');
});
