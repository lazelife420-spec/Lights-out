'use strict';

// UI-R3 P10: Schedule as one honest page. The real functions are pulled out
// of renderer-calendar.js / renderer.js by source text and run in a vm
// sandbox against small DOM-like fixtures, so these tests exercise behaviour:
// the rule-line arithmetic, main's eligibility rule as the renderer reads it,
// the Next lights-out hero, and the One night only hint + Tonight note.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const calendarSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-calendar.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-utils.js'), 'utf8');

function extractFunction(source, name) {
  const head = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!head) throw new Error(`function ${name} not found`);
  let i = source.indexOf(')', head.index + head[0].length - 1);
  i = source.indexOf('{', i);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(head.index, i + 1);
}

function el(extra = {}) {
  return {
    textContent: '',
    hidden: false,
    dataset: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    ...extra
  };
}

function localInput(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const CAL_HELPERS = ['calendarArmed', 'isAutoStartEligible', 'eventEnd', 'schClockParts', 'schClock', 'addMinutes', 'ruleEventMinutes', 'ruleCountdownMinutes', 'schClockFromHHMM', 'schDayLabel', 'schDuration', 'setCalText', 'scheduleSpanAction', 'renderScheduleNext', 'renderArmState', 'rulesActionPhrase', 'ruleTruthLine', 'ruleClock', 'ruleDeleteClick', 'calStatusLine', 'calEmptyCopy', 'initialProviderPanel', 'showProviderPanel', 'loadCalendarConfig', 'renderSchedulePage'];

function calendarSandbox({ events = [], armed = false, dryRun = true, running = false, paused = false, settingsLoaded = true } = {}) {
  const ids = ['sch-next', 'sch-next-eyebrow', 'sch-next-when', 'sch-next-ampm', 'sch-next-day', 'sch-next-span', 'sch-next-detail', 'sch-next-consequence', 'sch-next-in', 'sch-next-arc', 'sch-arm-hint', 'sch-arm-mode',
    'sch-cal-status-ical', 'sch-cal-status-google', 'sch-cal-status-outlook', 'sch-cal-status-calendly'];
  const byId = Object.fromEntries(ids.map(id => [id, el()]));
  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    state: { settingsLoaded, dryRun, running, paused, clockFormat: '12h' },
    els: { btnStartFromEvent: el(), timerInput: { max: '480' } },
    document: { getElementById: id => byId[id] || null },
    calEvents: events,
    calNextEvent: null,
    calBuiltinAction: null,
    scheduleRules: [{ id: 'r', enabled: true, action: 'shutdown' }],
    calConfigEnabled: true,
    calAutoStartArmed: armed,
    calProviderChoice: null,
    calLastFetchAt: 0,
    CAL_REFETCH_MS: 5 * 60000,
    CAL_AUTOSTART_MIN_MINUTES: 5,
    CAL_EXTERNAL_PROVIDERS: ['ical', 'google', 'outlook', 'calendly'],
    SCHEDULE_ACTION_LABELS: { shutdown: 'Shutdown', sleep: 'Sleep', hibernate: 'Hibernate' },
    CAL_STATUS_WINDOW_DAYS: 14,
    RULE_DELETE_MS: 4000,
    escapeHtml: v => String(v).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
  };
  vm.createContext(sandbox);
  // Fire 09: ruleDeleteClick delegates to the shared twoStepNext (renderer-utils.js).
  vm.runInContext([extractFunction(rendererSource, 'actionLabel'), extractFunction(utilsSource, 'twoStepNext'), ...CAL_HELPERS.map(n => extractFunction(calendarSource, n)),
    'this.__cal = { addMinutes, ruleEventMinutes, ruleCountdownMinutes, ruleTruthLine, ruleClock, ruleDeleteClick, calStatusLine, calEmptyCopy, isAutoStartEligible, renderScheduleNext, renderArmState, calendarArmed, initialProviderPanel, loadCalendarConfig, renderSchedulePage };'].join('\n'), sandbox);
  return { sandbox, byId, ...sandbox.__cal };
}

test('addMinutes: plain, midnight wrap, and a full day', () => {
  const { addMinutes } = calendarSandbox();
  assert.deepEqual({ ...addMinutes('22:30', 60) }, { time: '23:30', nextDay: false, dayOffset: 0 });
  assert.deepEqual({ ...addMinutes('23:30', 60) }, { time: '00:30', nextDay: true, dayOffset: 1 });
  assert.deepEqual({ ...addMinutes('00:00', 1440) }, { time: '00:00', nextDay: true, dayOffset: 1 });
  assert.deepEqual({ ...addMinutes('06:05', 0) }, { time: '06:05', nextDay: false, dayOffset: 0 });
  assert.deepEqual({ ...addMinutes('22:00', 2.5) }, { time: '22:02', nextDay: false, dayOffset: 0 }, 'a fractional minute floors, like a clock');
  assert.deepEqual({ ...addMinutes('22:00', 3000) }, { time: '00:00', nextDay: true, dayOffset: 3 });
});

test("rule minutes use main's arithmetic: event Math.max(1, d || 60), auto-start at least 5 min, no 1440 clamp", () => {
  const { ruleEventMinutes, ruleCountdownMinutes } = calendarSandbox();
  // calendarProviders.getDefaultCalendarEvents
  assert.equal(ruleEventMinutes(undefined), 60);
  assert.equal(ruleEventMinutes(0), 60);
  assert.equal(ruleEventMinutes(-5), 1);
  assert.equal(ruleEventMinutes(5000), 5000);
  assert.equal(ruleEventMinutes(45), 45);
  // checkCalendarAutoStart: Math.max(300 s, end - now)
  assert.equal(ruleCountdownMinutes(2), 5);
  assert.equal(ruleCountdownMinutes(-5), 5);
  assert.equal(ruleCountdownMinutes(45), 45);
  assert.equal(ruleCountdownMinutes(5000), 5000);
});

test('rule line: where the auto-started action really lands, including the 5 min floor', () => {
  const { ruleTruthLine, sandbox } = calendarSandbox();
  sandbox.state.clockFormat = '24h';
  assert.equal(ruleTruthLine({ time: '22:30', durationMinutes: 60, action: 'sleep' }), '22:30 · 60 min countdown → <strong>Sleep</strong> at 23:30');
  assert.equal(ruleTruthLine({ time: '23:30', durationMinutes: 90, action: 'shutdown' }), '23:30 · 90 min countdown → <strong>Shutdown</strong> at 01:00 (next day)');
  assert.equal(ruleTruthLine({ time: '22:00', durationMinutes: 2, action: 'shutdown' }), '22:00 · 5 min countdown → <strong>Shutdown</strong> at 22:05 (auto-start runs at least 5 min)');
  assert.equal(ruleTruthLine({ time: '22:00', durationMinutes: 3000, action: 'hibernate' }), '22:00 · 3000 min countdown → <strong>Hibernate</strong> at 00:00 (+3 days)');
});

test('arm state matches main exactly: calendar.enabled must be truthy, not merely "not false"', async () => {
  for (const [enabled, expected] of [[true, true], [undefined, false], [null, false], [0, false], [false, false]]) {
    const { sandbox, calendarArmed, loadCalendarConfig } = calendarSandbox();
    Object.assign(sandbox, {
      api: { getCalendarSettings: async () => ({ enabled, autoStartFromEvents: true, builtin: { rules: [] } }) },
      syncAutoStartSwitches() {},
      renderScheduleState() {}
    });
    sandbox.els.selCalendarProvider = { value: 'ical' };
    await loadCalendarConfig();
    assert.equal(calendarArmed(), expected, `enabled: ${enabled}`);
  }
});

test('provider panel: the session pick sticks; otherwise the configured provider wins over a stale saved value', () => {
  const { sandbox, initialProviderPanel } = calendarSandbox();
  assert.equal(initialProviderPanel({ provider: 'builtin' }), 'ical', 'legacy builtin shows iCal');
  assert.equal(initialProviderPanel({ provider: 'builtin', google: { apiKey: 'k' } }), 'google', 'the configured provider is shown');
  assert.equal(initialProviderPanel({ provider: 'outlook', google: { calendarId: 'c' } }), 'google', 'a saved but empty provider does not hide the configured one');
  assert.equal(initialProviderPanel({ provider: 'calendly', calendly: { personalToken: 't' }, ical: { url: 'u' } }), 'calendly');
  assert.equal(initialProviderPanel({ provider: 'outlook' }), 'outlook', 'nothing configured: the saved external provider');
  sandbox.calProviderChoice = 'outlook';
  assert.equal(initialProviderPanel({ provider: 'builtin', google: { apiKey: 'k' } }), 'outlook', "the user's pick this session is never snapped back");
});

test('entering Schedule refetches events only when the last fetch is stale', async () => {
  const { sandbox, renderSchedulePage } = calendarSandbox();
  let fetches = 0;
  let clock = 0;
  Object.assign(sandbox, {
    loadCalendarConfig: async () => {},
    fetchAndRenderEvents: async () => { fetches++; sandbox.calLastFetchAt = Date.now(); },
    startScheduleClock: () => { clock++; }
  });
  await renderSchedulePage();
  assert.equal(fetches, 1, 'never fetched: fetch');
  await renderSchedulePage();
  assert.equal(fetches, 1, 'fresh cache: no refetch');
  sandbox.calLastFetchAt = Date.now() - 6 * 60000;
  await renderSchedulePage();
  assert.equal(fetches, 2, 'stale cache: refetch');
  assert.equal(clock, 3);
});

test('eligibility: built-in rules and main-tagged bedtime events only; unknown is never eligible', () => {
  const { isAutoStartEligible } = calendarSandbox();
  assert.equal(isAutoStartEligible({ source: 'builtin' }), true);
  assert.equal(isAutoStartEligible({ source: 'google', autoStartEligible: true }), true);
  assert.equal(isAutoStartEligible({ source: 'google', autoStartEligible: false }), false);
  assert.equal(isAutoStartEligible({ source: 'ical' }), false);
  assert.equal(isAutoStartEligible(null), false);
});

test('hero: shows the END (action) time of the next eligible event, unarmed in Test Mode', () => {
  const now = Date.now();
  const start = new Date(now + 2 * 3600000);
  const end = new Date(start.getTime() + 60 * 60000);
  const { byId, sandbox, renderScheduleNext } = calendarSandbox({
    events: [
      { uid: 'x', summary: 'Dentist', source: 'google', autoStartEligible: false, start: new Date(now + 3600000).toISOString(), end: null, action: 'shutdown' },
      { uid: 'b', summary: 'Bedtime', source: 'builtin', start: start.toISOString(), end: end.toISOString(), action: 'sleep' }
    ]
  });
  renderScheduleNext();
  assert.equal(byId['sch-next'].dataset.state, 'unarmed');
  assert.equal(sandbox.calNextEvent.uid, 'b', 'a non-eligible imported event is never the next lights-out');
  const h = end.getHours() % 12 || 12;
  assert.equal(byId['sch-next-when'].textContent, `${h}:${String(end.getMinutes()).padStart(2, '0')}`);
  assert.equal(byId['sch-next-ampm'].textContent, end.getHours() >= 12 ? 'PM' : 'AM');
  assert.equal(byId['sch-next-detail'].textContent, 'Bedtime · 60 min countdown');
  assert.equal(byId['sch-next-detail'].title, 'Override Tax debt from an earlier run may shorten a countdown.', 'the caveat stays on a visible element');
  // Fire 09: unarmed reads 'Next bedtime' (nothing happens by itself) and the
  // span spells out start -> end without naming a real action in Test Mode.
  assert.equal(byId['sch-next-eyebrow'].textContent, 'Next bedtime');
  assert.equal(byId['sch-next-span'].hidden, false);
  const fmt = d => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
  assert.equal(byId['sch-next-span'].textContent, `Countdown from ${fmt(start)} · Test ends ${fmt(end)}`);
  assert.doesNotMatch(byId['sch-next-span'].textContent, /Shutdown|Sleep|Hibernate/, 'Test Mode never states a bare real action');
  assert.equal(byId['sch-next-consequence'].hidden, false);
  assert.equal(byId['sch-next-consequence'].textContent, 'Test Mode · no power action');
  assert.equal(byId['sch-next-consequence'].dataset.tone, 'test');
  assert.match(byId['sch-next-in'].textContent, /^starts in (1h 5\dm|2h 00m)$/);
  assert.equal(sandbox.els.btnStartFromEvent.hidden, false, '3 h to the action fits the 8 h Tonight cap');
});

test('hero: armed + REAL reads "Next lights-out" and a red Real <action>; no Start while a run is active', () => {
  const start = new Date(Date.now() + 30 * 60000);
  const end = new Date(start.getTime() + 45 * 60000);
  const events = [{ uid: 'b', summary: 'Weeknight', source: 'builtin', start: start.toISOString(), end: end.toISOString(), action: 'hibernate' }];
  const { byId, sandbox, renderScheduleNext } = calendarSandbox({ events, armed: true, dryRun: false, running: true });
  renderScheduleNext();
  assert.equal(byId['sch-next'].dataset.state, 'armed');
  assert.equal(byId['sch-next-eyebrow'].textContent, 'Next lights-out', 'armed: the eyebrow names the lights-out');
  assert.match(byId['sch-next-span'].textContent, /^Countdown from .+ · Hibernate at .+$/, 'REAL: the span names the action');
  assert.equal(byId['sch-next-consequence'].textContent, 'Real Hibernate');
  assert.equal(byId['sch-next-consequence'].dataset.tone, 'real');
  assert.equal(sandbox.els.btnStartFromEvent.hidden, true, 'one run at a time: no manual start while running');
});

test('hero: nothing scheduled says so and hides the span, the pill and the Start', () => {
  const { byId, sandbox, renderScheduleNext } = calendarSandbox({ events: [] });
  sandbox.scheduleRules = [];
  byId['sch-next-span'].textContent = 'stale';
  renderScheduleNext();
  assert.equal(byId['sch-next'].dataset.state, 'none');
  assert.equal(byId['sch-next-eyebrow'].textContent, 'Next bedtime');
  assert.equal(byId['sch-next-when'].textContent, '--:--');
  assert.equal(byId['sch-next-detail'].textContent, 'No bedtime scheduled. Add a rule below.');
  assert.equal(byId['sch-next-span'].hidden, true);
  assert.equal(byId['sch-next-span'].textContent, '', 'state none clears the span');
  assert.equal(byId['sch-next-consequence'].hidden, true);
  assert.equal(sandbox.els.btnStartFromEvent.hidden, true);
});

test('hero (Fire 09): rules that are all off say so; enabled rules out of range say that', () => {
  const off = calendarSandbox({ events: [] });
  off.sandbox.scheduleRules = [{ id: 'a', enabled: false }, { id: 'b', enabled: false }];
  off.renderScheduleNext();
  assert.equal(off.byId['sch-next-detail'].textContent, 'All rules are off. Turn one on below.');
  const far = calendarSandbox({ events: [] });
  far.sandbox.scheduleRules = [{ id: 'a', enabled: false }, { id: 'b', enabled: true }];
  far.renderScheduleNext();
  assert.equal(far.byId['sch-next-detail'].textContent, 'No rule falls in the next 14 days.');
});

test('hero (Fire 09): before settings load the span says a neutral "ends", never an action', () => {
  const start = new Date(Date.now() + 2 * 3600000);
  const end = new Date(start.getTime() + 30 * 60000);
  const events = [{ uid: 'b', summary: 'Bedtime', source: 'builtin', start: start.toISOString(), end: end.toISOString(), action: 'shutdown' }];
  const { byId, renderScheduleNext } = calendarSandbox({ events, settingsLoaded: false, dryRun: false });
  renderScheduleNext();
  assert.match(byId['sch-next-span'].textContent, /^Countdown from .+ · ends .+$/);
  assert.equal(byId['sch-next-consequence'].textContent, 'Checking mode…');
});

test('arm row (Fire 09): the hint and the Test / REAL line say what Auto-start really does', () => {
  const unarmed = calendarSandbox({ armed: false });
  unarmed.byId['sch-arm-mode'].textContent = 'Real shutdown at the end of each run.';
  unarmed.renderArmState();
  assert.equal(unarmed.byId['sch-arm-hint'].textContent, 'Off: rules are listed but never start a countdown.');
  assert.equal(unarmed.byId['sch-arm-mode'].hidden, true);
  assert.equal(unarmed.byId['sch-arm-mode'].textContent, '', 'a hidden mode line is cleared (aria-describedby reads it)');

  const testMode = calendarSandbox({ armed: true, dryRun: true });
  testMode.renderArmState();
  assert.match(testMode.byId['sch-arm-hint'].textContent, /^On: rules/);
  assert.equal(testMode.byId['sch-arm-mode'].hidden, false);
  assert.equal(testMode.byId['sch-arm-mode'].dataset.tone, 'test');
  assert.equal(testMode.byId['sch-arm-mode'].textContent, 'Test Mode: auto-started runs will not power off.');

  const real = calendarSandbox({ armed: true, dryRun: false });
  real.renderArmState();
  assert.equal(real.byId['sch-arm-mode'].dataset.tone, 'real');
  assert.equal(real.byId['sch-arm-mode'].textContent, 'Real shutdown at the end of each run.');

  // Nothing scheduled never hides the arm truth.
  const none = calendarSandbox({ events: [], armed: true });
  none.renderScheduleNext();
  assert.equal(none.byId['sch-next'].dataset.state, 'none');
  none.renderArmState();
  assert.equal(none.byId['sch-arm-mode'].hidden, false, 'armed with nothing scheduled still shows the mode line');
});

test('ruleClock (Fire 09) agrees with ruleTruthLine on every fixture', () => {
  const { ruleClock, ruleTruthLine, sandbox } = calendarSandbox();
  sandbox.state.clockFormat = '24h';
  const fixtures = [
    [{ time: '22:30', durationMinutes: 60, action: 'sleep' }, { start: '22:30', end: '23:30', minutes: 60, dayNote: '', floorNote: '', action: 'Sleep' }],
    [{ time: '23:30', durationMinutes: 90, action: 'shutdown' }, { start: '23:30', end: '01:00', minutes: 90, dayNote: 'next day', floorNote: '', action: 'Shutdown' }],
    [{ time: '22:00', durationMinutes: 2, action: 'shutdown' }, { start: '22:00', end: '22:05', minutes: 5, dayNote: '', floorNote: 'auto-start runs at least 5 min', action: 'Shutdown' }],
    [{ time: '22:00', durationMinutes: 3000, action: 'hibernate' }, { start: '22:00', end: '00:00', minutes: 3000, dayNote: '+3 days', floorNote: '', action: 'Hibernate' }]
  ];
  for (const [rule, expected] of fixtures) {
    const c = ruleClock(rule);
    assert.deepEqual({ ...c }, expected);
    // The same facts, rebuilt into the line format, equal ruleTruthLine exactly.
    const rebuilt = `${c.start} · ${c.minutes} min countdown → <strong>${c.action}</strong> at ${c.end}${c.dayNote ? ` (${c.dayNote})` : ''}${c.floorNote ? ` (${c.floorNote})` : ''}`;
    assert.equal(rebuilt, ruleTruthLine(rule));
  }
});

test('rule delete (Fire 09): arm, then only a second press on the same rule within 4 s deletes', () => {
  const { ruleDeleteClick } = calendarSandbox();
  const st = { pending: null };
  assert.equal(ruleDeleteClick(st, 'a', 1000), 'arm');
  assert.equal(ruleDeleteClick(st, 'a', 4999), 'delete');
  assert.equal(st.pending, null, 'a delete disarms');
  assert.equal(ruleDeleteClick(st, 'a', 6000), 'arm', 'after a delete the next press arms again');
  assert.equal(ruleDeleteClick(st, 'b', 6500), 'arm', 'another rule re-arms on that rule');
  assert.equal(ruleDeleteClick(st, 'a', 6600), 'arm', 'the first rule is no longer armed');
  assert.equal(ruleDeleteClick(st, 'a', 10601), 'arm', 'past the window: arms again, never deletes');
  assert.equal(ruleDeleteClick(st, 'a', 10700), 'delete');
});

test('calendar status (Fire 09): reached with N events, or a fixed reason, never error text', () => {
  const { calStatusLine, calEmptyCopy } = calendarSandbox();
  assert.deepEqual({ ...calStatusLine('ical', { ok: true }, 3, '23:41') }, { tone: 'live', text: 'Reached · 3 events in the next 14 days · checked 23:41' });
  assert.equal(calStatusLine('google', { ok: true }, 1, '').text, 'Reached · 1 event in the next 14 days');
  assert.equal(calStatusLine('ical', { ok: true }, 0, '').text, 'Reached · no events in the next 14 days');
  assert.equal(calStatusLine('ical', { ok: false, reason: 'timeout' }, 0, '').text, "Couldn't reach this feed (timed out). Rules above still work.");
  for (const code of ['401', '403']) {
    const line = calStatusLine('outlook', { ok: false, reason: `http-${code}` }, 0, '');
    assert.equal(line.tone, 'attn');
    assert.match(line.text, /^Sign-in expired or not allowed\./);
  }
  for (const reason of ['http-500', 'too-large', 'not-https', 'parse', 'unexpected-response', 'network', 'whatever']) {
    const line = calStatusLine('calendly', { ok: false, reason }, 0, '');
    assert.equal(line.tone, 'attn', reason);
    assert.match(line.text, /Rules above still work\.$/, reason);
  }
  // The empty list never looks healthy unless every configured feed answered.
  assert.equal(calEmptyCopy([], {}), 'No calendar connected. Bedtime rules above work without one.');
  assert.equal(calEmptyCopy(['ical'], { ical: { ok: true } }), 'No imported events in the next 14 days.');
  assert.equal(calEmptyCopy(['ical', 'google'], { ical: { ok: true }, google: { ok: false, reason: 'timeout' } }), 'A calendar could not be reached; see above.');
  assert.equal(calEmptyCopy(['ical'], {}), 'Not checked since the last change. Use Check to fetch.');
});

function hintSandbox({ checked = true, value = '', running = false, paused = false, dryRun = false, armedNightMode = null, clockFormat = '24h' } = {}) {
  const els = {
    scheduleCheck: { checked },
    scheduleTime: { value },
    scheduleHint: el(),
    schOnceAction: el(),
    tonightTargetNote: el({ hidden: true }),
    tonightTargetWhen: el(),
    timerInput: el()
  };
  const sandbox = {
    Date, Math, Number, String, Boolean,
    els,
    state: { action: 'sleep', dryRun, running, paused, miniMode: false, fullscreenClock: false, unit: 'min', armedNightMode, clockFormat },
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  };
  vm.createContext(sandbox);
  // One clock (UI-R3 Fire 02): the formatters come from renderer-utils.js.
  vm.runInContext(['formatIdleClockTime', 'formatClock'].map(n => extractFunction(utilsSource, n)).join('\n'), sandbox);
  vm.runInContext(['actionLabel', 'inputValue', 'secondsUntilClockValue', 'setTextIfChanged', 'scheduleOverrideTarget', 'formatScheduleWhen', 'updateScheduleHint']
    .map(n => extractFunction(rendererSource, n)).join('\n') + '\nthis.__run = updateScheduleHint;', sandbox);
  return { els, sandbox, run: sandbox.__run };
}

test('One night only: the label names the real action and the Tonight note shows the target', () => {
  const target = new Date(Date.now() + 90 * 60000);
  const { els, run } = hintSandbox({ value: localInput(target) });
  run();
  assert.equal(els.schOnceAction.textContent, 'Sleep');
  assert.match(els.scheduleHint.textContent, /^Sleep at .+, in 1h (29|30)m\.$/);
  assert.equal(els.tonightTargetNote.hidden, false);
  assert.ok(els.tonightTargetWhen.textContent.length > 0);
  assert.equal(els.timerInput.getAttribute('aria-describedby'), 'tonight-target-note');
});

test('One night only: the hint follows the 12h/24h setting (Fire 02)', () => {
  const target = new Date(Date.now() + 90 * 60000);
  const h24 = hintSandbox({ value: localInput(target), clockFormat: '24h' });
  h24.run();
  assert.match(h24.els.scheduleHint.textContent, /at \d{2}:\d{2} /);
  assert.doesNotMatch(h24.els.scheduleHint.textContent, /AM|PM/);
  assert.match(h24.els.scheduleHint.textContent, /^Sleep at .+, in 1h (29|30)m\.$/);
  assert.doesNotMatch(h24.els.tonightTargetWhen.textContent, /AM|PM/);
  const h12 = hintSandbox({ value: localInput(target), clockFormat: '12h' });
  h12.run();
  assert.match(h12.els.scheduleHint.textContent, /(AM|PM)/);
  assert.doesNotMatch(h12.els.scheduleHint.textContent, /\b0\d:\d\d [AP]M/, 'no leading zero in 12h');
  assert.match(h12.els.scheduleHint.textContent, /^Sleep at .+, in 1h (29|30)m\.$/);
});

test('One night only: a past target warns; Test Mode says nothing will power off', () => {
  const past = hintSandbox({ value: localInput(new Date(Date.now() - 3600000)) });
  past.run();
  assert.equal(past.els.scheduleHint.textContent, 'That time has passed. Start would run in 1 min. Clear or pick a new time.');
  assert.equal(past.els.scheduleHint.dataset.state, 'past');

  const testMode = hintSandbox({ value: localInput(new Date(Date.now() + 3 * 3600000)), dryRun: true });
  testMode.run();
  assert.match(testMode.els.scheduleHint.textContent, /^Test Mode countdown to .+\. Nothing will power off\.$/);
});

test('One night only: the Tonight note hides while a run is active and when unchecked', () => {
  const value = localInput(new Date(Date.now() + 3600000));
  for (const opts of [{ running: true }, { paused: true }, { checked: false }]) {
    const { els, run } = hintSandbox({ value, ...opts });
    els.tonightTargetNote.hidden = false;
    run();
    assert.equal(els.tonightTargetNote.hidden, true, JSON.stringify(opts));
    assert.equal(els.timerInput.getAttribute('aria-describedby'), null);
  }
  const unchecked = hintSandbox({ value, checked: false });
  unchecked.run();
  assert.equal(unchecked.els.scheduleHint.textContent, '');
});

test('One night only + an armed Night Mode: no line promises an end time the armed plan would not use', () => {
  const armedNightMode = { nightModeId: 'wind', nightModeTitle: 'Wind Down', durationSeconds: 5400, action: 'shutdown' };
  const { els, run } = hintSandbox({ value: localInput(new Date(Date.now() + 3 * 3600000)), armedNightMode });
  els.tonightTargetNote.hidden = false;
  run();
  assert.equal(els.tonightTargetNote.hidden, true, 'the Tonight note never sits beside an armed Night Mode');
  assert.equal(els.timerInput.getAttribute('aria-describedby'), null);
  assert.equal(els.scheduleHint.textContent, 'Wind Down is armed on Tonight. Pick the time again to use it instead.');
  assert.doesNotMatch(els.scheduleHint.textContent, /\bat\b.+\bin\b/, 'no end time is promised');
});

function exclusivitySandbox({ armedNightMode = null, checked = false, dryRun = false } = {}) {
  const calls = { cleared: 0, rendered: 0, toasts: [] };
  const sandbox = {
    Date, Math, Number, String, Boolean, Object,
    els: { scheduleCheck: { checked }, timerInput: { value: '30' } },
    state: { unit: 'min', armedNightMode, running: false, dryRun, action: 'shutdown', clockFormat: '24h' },
    clearArmedNightMode() { calls.cleared++; sandbox.state.armedNightMode = null; },
    secondsUntilClockValue: () => 3600,
    setInputFromSeconds: () => { calls.rendered++; },
    notify(msg, tone) { calls.toasts.push([msg, tone]); },
    releaseOutcomeHold() {},
    renderArmedModeBanner() {},
    persistArmedNightMode() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(['formatIdleClockTime', 'formatClock'].map(n => extractFunction(utilsSource, n)).join('\n'), sandbox);
  vm.runInContext(['actionLabel', 'formatScheduleWhen', 'selectClockTarget', 'armNightMode'].map(n => extractFunction(rendererSource, n)).join('\n')
    + '\nthis.__fns = { selectClockTarget, armNightMode };', sandbox);
  return { sandbox, calls, ...sandbox.__fns };
}

test('setting a One night only target clears an armed Night Mode (the two are exclusive)', () => {
  const armed = exclusivitySandbox({ armedNightMode: { nightModeId: 'wind', durationSeconds: 5400, action: 'shutdown' }, checked: true });
  armed.selectClockTarget('2030-01-01T23:00');
  assert.equal(armed.calls.cleared, 1);
  assert.equal(armed.sandbox.state.armedNightMode, null);
  assert.equal(armed.calls.rendered, 1, 'the target is still applied');

  const plain = exclusivitySandbox({ checked: true });
  plain.selectClockTarget('2030-01-01T23:00');
  assert.equal(plain.calls.cleared, 0, 'nothing armed: nothing cleared');
});

test('arming a Night Mode drops a One night only target', () => {
  const { sandbox, armNightMode } = exclusivitySandbox({ checked: true });
  armNightMode({ nightModeId: 'wind', nightModeTitle: 'Wind Down', durationSeconds: 5400, action: 'shutdown' });
  assert.equal(sandbox.els.scheduleCheck.checked, false);
  assert.equal(sandbox.state.armedNightMode.nightModeId, 'wind');
});

test('One night only (Fire 09): the toast names Test Mode or the real action, and is skipped for a past or invalid target', () => {
  const real = exclusivitySandbox({ checked: true });
  real.selectClockTarget('2030-01-01T23:00');
  assert.equal(real.calls.toasts.length, 1);
  assert.match(real.calls.toasts[0][0], /^Shutdown at 23:00 /);
  const testMode = exclusivitySandbox({ checked: true, dryRun: true });
  testMode.selectClockTarget('2030-01-01T23:00');
  assert.match(testMode.calls.toasts[0][0], /^Test Mode countdown to 23:00 /);
  assert.doesNotMatch(testMode.calls.toasts[0][0], /Shutdown/);
  for (const value of ['2000-01-01T23:00', 'not-a-date', '']) {
    const skip = exclusivitySandbox({ checked: true });
    skip.selectClockTarget(value);
    assert.equal(skip.calls.toasts.length, 0, `no toast for ${JSON.stringify(value)}`);
    assert.equal(skip.calls.rendered, 1, 'the duration is still applied (render() warns)');
  }
});

// Fire 09: the click path behind a rule's Delete, with a fake clock and timer.
test('rule delete (Fire 09): one press never deletes or saves; the timeout disarms; a second press in the window deletes once', async () => {
  const timers = [];
  let saves = 0;
  const toasts = [];
  const classes = new Set();
  const btn = el({
    dataset: { ruleId: 'r2' },
    innerHTML: '',
    classList: {
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); return on; },
      contains(c) { return classes.has(c); }
    }
  });
  const sandbox = {
    console, String, Number, Boolean, Object,
    __now: 1000,
    scheduleRules: [{ id: 'r1', label: 'Weeknight' }, { id: 'r2', label: 'Late & loud' }],
    ruleDeleteState: { pending: null, timer: null },
    RULE_DELETE_MS: 4000,
    document: { querySelectorAll: () => (classes.has('is-confirming') ? [btn] : []) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    loGlyph: name => `<svg data-g="${name}"></svg>`,
    persistScheduleRules: async () => { saves++; return true; },
    notify: (msg, tone) => toasts.push([msg, tone])
  };
  sandbox.Date = { now: () => sandbox.__now };
  vm.createContext(sandbox);
  vm.runInContext([extractFunction(utilsSource, 'twoStepNext'), ...['ruleDeleteClick', 'setRuleDeleteArmed', 'disarmRuleDelete', 'requestRuleDelete'].map(n => extractFunction(calendarSource, n)),
    'this.__fns = { requestRuleDelete, disarmRuleDelete };'].join('\n'), sandbox);
  const { requestRuleDelete } = sandbox.__fns;

  assert.equal(requestRuleDelete(btn), 'arm');
  assert.equal(sandbox.scheduleRules.length, 2, 'the first press deletes nothing');
  assert.equal(saves, 0, 'and saves nothing');
  assert.equal(btn.innerHTML, 'Delete?');
  assert.equal(btn.getAttribute('aria-label'), 'Confirm delete Late & loud');
  assert.equal(timers.at(-1).ms, 4000);

  // The window lapses: the timer disarms; a later single press only re-arms.
  timers.at(-1).fn();
  assert.equal(classes.has('is-confirming'), false);
  assert.equal(btn.getAttribute('aria-label'), 'Delete Late & loud');
  assert.equal(btn.innerHTML, '<svg data-g="trash"></svg>');
  sandbox.__now = 9000;
  assert.equal(requestRuleDelete(btn), 'arm');
  assert.equal(saves, 0);

  sandbox.__now = 11000;
  assert.equal(requestRuleDelete(btn), 'delete');
  assert.deepEqual(sandbox.scheduleRules.map(r => r.id), ['r1'], 'exactly that rule goes');
  assert.equal(saves, 1, 'persisted once');
  assert.equal(toasts.length, 0, 'no success toast before persistence confirms');
  await Promise.resolve();
  assert.deepEqual(toasts, [['Deleted "Late & loud"', 'info']], 'the raw label, info tone');
});
