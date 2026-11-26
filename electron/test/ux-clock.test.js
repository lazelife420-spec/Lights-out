'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const espree = require('espree');
// Test-process timezone only; no Windows clock/timezone configuration changes.
process.env.TZ = 'America/Vancouver';
const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
function functions(source) {
  return Object.fromEntries(espree.parse(source, { ecmaVersion: 'latest', range: true }).body
    .filter(n => n.type === 'FunctionDeclaration').map(n => [n.id.name, source.slice(...n.range)]));
}
const rf = functions(renderer), uf = functions(utils);
const at = value => new Date(value).getTime();
const classes = () => { const values = new Set(); return { add: (...n) => n.forEach(x => values.add(x)), remove: (...n) => n.forEach(x => values.delete(x)), toggle(n, on) { if (on) values.add(n); else values.delete(n); }, contains: n => values.has(n) }; };
const element = () => ({ textContent: '', hidden: false, title: '', style: {}, classList: classes() });
function fixture(overrides = {}, now = at('2026-10-19T23:50:00-07:00')) {
  const clock = { now }, elements = Object.fromEntries(['timer-readout-label', 'timer-wall-clock', 'clock-face-controls', 'plan-out-at', 'plan-out-at-label', 'ns-hero-label', 'session-phase', 'session-ends'].map(id => [id, element()]));
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const state = { running: false, paused: false, remainingSeconds: 1320, totalSeconds: 1320, clockMode: false, clockFace: 'digital', clockFormat: '12h', action: 'shutdown', dryRun: false, settingsLoaded: true, unit: 'min', bedtime: '22:00', ...overrides };
  const body = { classList: classes(), style: {} };
  const els = { body, timerDisplay: element(), timerMain: element(), timerLabel: element(), timerSub: element(), timerInput: { value: '22' } };
  const context = vm.createContext({ state, els, document: { getElementById: id => elements[id] || null, querySelectorAll: () => [] }, Date: FakeDate, Intl,
    formatTime: seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    clamp: (x, min, max) => Math.max(min, Math.min(max, x)), updateIdleBezel() {}, updateAnalogHands() {} });
  const presentation = rf.render.slice(0, rf.render.indexOf('  // Briefly label')) + '\n}';
  vm.runInContext([
    ...['formatIdleClockTime', 'formatIdleClockDate', 'formatClock', 'formatClockTarget'].map(n => uf[n] || rf[n]),
    ...['actionLabel', 'setTextIfChanged', 'inputValue', 'inputSeconds', 'planSecondsNow', 'idleBezelLabel', 'planEndsPastBedtime', 'countdownRingLabel', 'updatePlanFacts', 'updateWallClock'].map(n => rf[n]),
    presentation, 'this.render = render; this.updatePlanFacts = updatePlanFacts; this.formatClockTarget = formatClockTarget;'
  ].join('\n'), context);
  return { clock, state, elements, els, context, render: context.render, facts: context.updatePlanFacts };
}
test('legacy clock OFF still shows real idle time; 22-minute plan is not used as a clock', () => {
  const t = fixture(); const before = JSON.stringify(t.state); t.render(); t.facts();
  assert.equal(t.els.timerMain.textContent, '11:50 PM');
  assert.equal(t.elements['timer-readout-label'].textContent, 'Ready · not started');
  assert.equal(t.elements['plan-out-at'].textContent, '12:12 AM · tomorrow');
  assert.equal(t.elements['plan-out-at-label'].textContent, 'If started now');
  assert.equal(JSON.stringify(t.state), before, 'presentation cannot modify plan or legacy settings');
});
test('running primary reads the engine snapshot and Now reads wall time', () => {
  const t = fixture({ running: true, remainingSeconds: 987, endsAt: '2026-10-20T00:12:00-07:00' }); t.render();
  assert.equal(t.els.timerMain.textContent, '16:27');
  assert.equal(t.elements['timer-wall-clock'].textContent, 'Now 11:50 PM');
  assert.equal(t.elements['timer-wall-clock'].hidden, false);
  assert.equal(t.els.timerLabel.textContent, 'Shutdown at 12:12 AM · tomorrow');
});
test('paused remaining freezes across wall-clock ticks, manual clock jumps and midnight', () => {
  const t = fixture({ paused: true, remainingSeconds: 987, endsAt: null }); t.render();
  t.clock.now += 17 * 60 * 1000; t.render();
  assert.equal(t.els.timerMain.textContent, '16:27'); assert.equal(t.elements['timer-wall-clock'].textContent, 'Now 12:07 AM');
  t.clock.now -= 2 * 3600 * 1000; t.render();
  assert.equal(t.els.timerMain.textContent, '16:27'); assert.equal(t.elements['timer-wall-clock'].textContent, 'Now 10:07 PM');
  assert.equal(t.state.remainingSeconds, 987); assert.equal(t.els.timerLabel.textContent, 'On hold until you resume');
});
test('a wall-clock jump cannot invent an active deadline or advance remaining time', () => {
  const endsAt = '2026-10-20T00:12:00-07:00', t = fixture({ running: true, remainingSeconds: 100, endsAt });
  t.clock.now += 3600 * 1000; t.render();
  assert.equal(t.els.timerMain.textContent, '1:40'); assert.equal(t.state.endsAt, endsAt);
  assert.equal(t.els.timerLabel.textContent, 'Shutdown at 12:12 AM · today');
});
test('24-hour and 12-hour formats are shared, with explicit AM/PM', () => {
  const t = fixture({ clockFormat: '24h' }); t.render(); assert.equal(t.els.timerMain.textContent, '23:50');
  t.state.clockFormat = '12h'; t.clock.now = at('2026-10-20T00:06:00-07:00'); t.render(); assert.equal(t.els.timerMain.textContent, '12:06 AM');
});
test('an explicit analog face survives legacy clock OFF and keeps a readable local-time line', () => {
  const t = fixture({ clockFace: 'analog' }); t.render();
  assert.equal(t.els.timerMain.textContent, ''); assert.equal(t.state.clockFace, 'analog');
  assert.equal(t.elements['timer-wall-clock'].textContent, 'Now 11:50 PM'); assert.equal(t.elements['timer-wall-clock'].hidden, false);
});
test('idle prediction refreshes, including an armed mode, without changing its plan', () => {
  const t = fixture({ armedNightMode: { durationSeconds: 1320, action: 'sleep' } }); t.facts();
  assert.equal(t.elements['plan-out-at'].textContent, '12:12 AM · tomorrow');
  t.clock.now += 60 * 1000; t.facts(); assert.equal(t.elements['plan-out-at'].textContent, '12:13 AM · tomorrow');
  assert.equal(t.state.armedNightMode.durationSeconds, 1320); assert.equal(t.state.running, false);
});
for (const [now, target, expected] of [
  ['2026-03-08T01:50:00-08:00', '2026-03-08T03:10:00-07:00', /3:10 AM.*(?:PDT|GMT-7).*today/],
  ['2026-11-01T01:50:00-07:00', '2026-11-01T01:10:00-08:00', /1:10 AM.*(?:PST|GMT-8).*today/]
]) test('DST target remains a real local instant: ' + now, () => {
  const t = fixture({}, at(now)); t.context.target = new Date(target); t.context.now = new Date(now);
  const value = vm.runInContext('formatClockTarget(target, now)', t.context); assert.match(value, expected);
});
test('a test-only timezone change is reflected on the next presentation tick', () => {
  const t = fixture({}, at('2026-10-20T07:06:00Z')); t.render(); assert.equal(t.els.timerMain.textContent, '12:06 AM');
  try { process.env.TZ = 'America/New_York'; t.render(); assert.equal(t.els.timerMain.textContent, '3:06 AM'); }
  finally { process.env.TZ = 'America/Vancouver'; }
  assert.equal(t.state.remainingSeconds, 1320);
});
test('the one wall-clock interval renders paused/running/idle without mutating countdown state', () => {
  let callback, calls = 0, wallClockCalls = 0; const state = { running: true, paused: true, remainingSeconds: 21, endsAt: 'engine-deadline' };
  const start = renderer.indexOf('(function setupClockTick()'); const end = renderer.indexOf('})();', start) + 5;
  vm.runInNewContext(renderer.slice(start, end), { state, setInterval(fn, ms) { assert.equal(ms, 1000); callback = fn; }, render() { calls++; }, updateWallClock() { wallClockCalls++; }, updateSessionHead() {} });
  const before = JSON.stringify(state); callback(); state.paused = false; callback(); state.running = false; callback();
  assert.equal(calls, 1); assert.equal(wallClockCalls, 2); state.running = true; state.paused = true; assert.equal(JSON.stringify(state), before);
});
test('Start and Resume consume engine snapshots rather than a locally constructed deadline', async () => {
  const deadline = '2026-10-20T02:34:56-07:00', updates = [], state = { settingsLoaded: true, paused: true, running: false, remainingSeconds: 9, graceMinutes: 2 };
  const context = vm.createContext({ state, els: {}, SoundSystem: { playStart() {}, playPause() {} }, outcomeTimer: null,
    api: { startTimer: async () => ({ success: true, state: { running: true, paused: false, remainingSeconds: 1301, totalSeconds: 1320, endsAt: deadline } }),
      resumeTimer: async () => ({ success: true, state: { running: true, paused: false, remainingSeconds: 9, endsAt: deadline } }) },
    applyTimerPayload(data) { updates.push(data); Object.assign(state, data); }, notify() {}, render() {}, dismissSessionOutcomeToasts() {}, setOutcomeBodyClass() {} });
  vm.runInContext(rf.startTimer + '\n' + rf.togglePause, context);
  await context.startTimer(1320); assert.equal(state.endsAt, deadline); assert.equal(state.remainingSeconds, 1301);
  state.paused = true; await context.togglePause(); assert.equal(state.endsAt, deadline); assert.equal(state.remainingSeconds, 9);
  assert.equal(updates.length, 2);
});
