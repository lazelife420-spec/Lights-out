'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const phoneDir = path.join(repoRoot, 'companion-android', 'app', 'src', 'main', 'assets', 'phone');

const indexHtml = fs.readFileSync(path.join(phoneDir, 'index.html'), 'utf8');
const phoneJs = fs.readFileSync(path.join(phoneDir, 'phone.js'), 'utf8');
const homeJs = fs.readFileSync(path.join(phoneDir, 'home.js'), 'utf8');
const phoneCss = fs.readFileSync(path.join(phoneDir, 'phone.css'), 'utf8');
const studioCss = fs.readFileSync(path.join(phoneDir, 'studio.css'), 'utf8');
const lightExperienceCss = fs.readFileSync(path.join(phoneDir, 'light-experience.css'), 'utf8');

function makeElement(id = '', tag = 'div', extra = {}) {
  const attrs = Object.assign({}, extra.attrs || {});
  const classes = new Set((extra.className || '').split(/\s+/).filter(Boolean));
  const listeners = new Map();
  const node = {
    id,
    tagName: tag.toUpperCase(),
    hidden: Boolean(extra.hidden),
    disabled: Boolean(extra.disabled),
    checked: Boolean(extra.checked),
    open: Boolean(extra.open),
    selected: Boolean(extra.selected),
    value: extra.value !== undefined ? String(extra.value) : '',
    textContent: extra.textContent || '',
    className: extra.className || '',
    dataset: Object.assign({}, extra.dataset || {}),
    children: [],
    style: {},
    onclick: null,
    onchange: null,
    oninput: null,
    onsubmit: null,
    classList: {
      add(...names) { names.forEach(n => classes.add(n)); },
      remove(...names) { names.forEach(n => classes.delete(n)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      }
    },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of listeners.get(type) || []) fn(event);
      if (typeof this['on' + type] === 'function') this['on' + type](event);
    },
    querySelectorAll(sel) {
      if (sel === 'input:checked') {
        const found = [];
        const walk = (nodes) => {
          for (const child of nodes || []) {
            if (child.tagName === 'INPUT' && child.checked) found.push(child);
            if (child.children) walk(child.children);
          }
        };
        walk(this.children);
        return found;
      }
      return [];
    },
    querySelector() { return null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    scrollIntoView() {}
  };
  return node;
}

function createPhoneSandbox() {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const body = makeElement('', 'body');
  const scopeEl = makeElement('', 'p', { className: 'scope' });
  const dialInner = makeElement('', 'div', { className: 'dial-inner' });
  const clockChoice = makeElement('', 'div', { className: 'clock-choice' });
  const lightConnection = makeElement('', 'details', { className: 'phone-light-connection' });
  const presetButtons = [15, 30, 60, 90].map(m => makeElement('', 'button', { dataset: { minutes: String(m) } }));
  const tabButtons = ['timer', 'lighting', 'routines', 'calendar'].map(t => makeElement('', 'button', { dataset: { tab: t } }));

  const storage = new Map();
  const posted = [];
  const sandbox = {
    window: {
      phoneNative: { postMessage: raw => posted.push(JSON.parse(raw)) },
      RoutineModel: { fromPhoneRoutine: r => ({ id: r.id, name: r.name, seconds: r.seconds }) }
    },
    document: {
      body,
      hidden: false,
      getElementById: getEl,
      createElement: tag => makeElement('', tag),
      createTextNode: text => ({ textContent: String(text) }),
      querySelector(sel) {
        if (sel === '.scope') return scopeEl;
        if (sel === '.dial-inner') return dialInner;
        if (sel === '.clock-choice') return clockChoice;
        if (sel === '.phone-light-connection') return lightConnection;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '[data-minutes]') return presetButtons;
        if (sel === '[data-tab]') return tabButtons;
        return [];
      }
    },
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); }
    },
    RoutineTransferUI: { mount: () => ({ refresh: () => Promise.resolve() }) },
    PhoneLightUI: { mount: () => ({ refresh: () => Promise.resolve() }) },
    Date,
    Set,
    Map,
    Array,
    Number,
    String,
    Boolean,
    Math,
    JSON,
    Promise,
    Error,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(phoneJs, sandbox);
  vm.runInNewContext(homeJs, sandbox);
  return { sandbox, elements, getEl, posted, body, clockChoice, dialInner, tabButtons, lightConnection };
}

test('Android LO-UX-R1 markup & CSS enforce locked copy, 4-tab nav, safe-area insets, rem root, and >=12px floor', () => {
  assert.match(indexHtml, /viewport-fit=cover/);
  assert.match(indexHtml, /THIS PHONE/);
  assert.match(indexHtml, /Alerts when time is up\. Does not switch off this phone\./);
  assert.match(indexHtml, /data-tab="timer"[\s\S]*Tonight/);
  assert.match(indexHtml, /data-tab="lighting"[\s\S]*Lights/);
  assert.match(indexHtml, /data-tab="routines"[\s\S]*Routines/);
  assert.match(indexHtml, /data-tab="calendar"[\s\S]*Schedule/);
  assert.match(indexHtml, /<details class="control-card" id="handoff-pairing" hidden>/);

  // Safe-area insets carried forward from M1.5
  assert.match(phoneCss, /env\(safe-area-inset-top/);
  assert.match(phoneCss, /env\(safe-area-inset-bottom/);
  assert.match(studioCss, /env\(safe-area-inset-bottom/);

  // Root font-size must not hardcode px (would block user/browser 200% font scaling)
  assert.doesNotMatch(phoneCss, /:root\s*\{[^}]*font-size:\s*\d+px/);
  assert.match(phoneCss, /:root\s*\{[^}]*font-size:\s*100%/);

  // Multiline WiZ outcome preservation
  assert.match(phoneCss, /\.outcome\s*\{[^}]*white-space:\s*pre-line/);

  // No sub-12px hardcoded px font sizes in light-experience.css
  const tinyPx = [...lightExperienceCss.matchAll(/font(?:-size)?:\s*(?:[0-9]+\s+)?(\d+(?:\.\d+)?)px/g)]
    .map(m => Number(m[1]))
    .filter(n => n < 12);
  assert.deepEqual(tinyPx, [], `light-experience.css must not use <12px font sizes, found: ${tinyPx}`);
});

test('Android phone.js hides .clock-choice when running/paused/finished, keeps REMAINING phase, and dispatches single pc op', () => {
  const { sandbox, getEl, posted, clockChoice } = createPhoneSandbox();

  // Idle: clock-choice visible, permissions shown when exact/alerts false
  sandbox.window.phoneUI.update({ phase: 'idle', remainingSeconds: 0, totalSeconds: 0, exact: false, alerts: false, paired: false, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [] });
  assert.equal(clockChoice.hidden, false);
  assert.equal(getEl('permissions').hidden, false);
  assert.equal(getEl('exact').hidden, false);
  assert.equal(getEl('alerts').hidden, false);
  assert.equal(getEl('pc').textContent, 'Pair PC');

  // Running: clock-choice hidden, #phase contains REMAINING (lifecycle proof contract), permissions hidden when both granted
  sandbox.window.phoneUI.update({ phase: 'running', remainingSeconds: 900, totalSeconds: 1800, exact: true, alerts: true, paired: true, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [] });
  assert.equal(clockChoice.hidden, true);
  assert.equal(getEl('setup').hidden, true);
  assert.equal(getEl('active').hidden, false);
  assert.match(getEl('phase').textContent, /REMAINING/);
  assert.equal(getEl('permissions').hidden, true);
  assert.equal(getEl('pc').textContent, 'Open PC controls');

  // Finished: clock-choice stays hidden
  sandbox.window.phoneUI.update({ phase: 'finished', remainingSeconds: 0, totalSeconds: 1800, exact: true, alerts: true, paired: true, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [] });
  assert.equal(clockChoice.hidden, true);
  assert.equal(getEl('finished').hidden, false);

  // Single PC button click emits exactly one 'pc' action
  posted.length = 0;
  getEl('pc').onclick();
  assert.deepEqual(posted.filter(m => m.action === 'pc'), [{ action: 'pc' }]);
});

test('Android home.js disables room controls with 0 saved lights and refuses to send lightCommand', () => {
  const { sandbox, getEl, posted } = createPhoneSandbox();

  sandbox.window.phoneUI.update({ phase: 'idle', remainingSeconds: 0, totalSeconds: 0, exact: true, alerts: true, paired: false, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [] });
  for (const id of ['strip-warm', 'strip-off', 'light-status', 'light-on', 'light-off', 'light-warm', 'light-brightness']) {
    assert.equal(getEl(id).disabled, true, `#${id} must be disabled with 0 saved lights`);
  }
  posted.length = 0;
  for (const id of ['light-status', 'light-on', 'light-off', 'light-warm', 'strip-warm', 'strip-off']) {
    getEl(id).onclick();
  }
  assert.equal(posted.filter(m => m.action === 'lightCommand').length, 0, '0-lights state must not post lightCommand');

  // Empty routines produces an explicit placeholder option in #rule-routine
  assert.equal(getEl('rule-routine').children.length, 1);
  assert.match(getEl('rule-routine').children[0].textContent, /No routines yet/);

  // Adding saved lights re-enables controls and sends typed lightCommand payload
  sandbox.window.phoneUI.update({ phase: 'idle', remainingSeconds: 0, totalSeconds: 0, exact: true, alerts: true, paired: false, home: { lights: ['192.168.1.10', '192.168.1.11'], routines: [], rules: [] }, upcoming: [], routineOutcomes: [] });
  assert.equal(getEl('light-warm').disabled, false);
  getEl('light-brightness').value = '45';
  getEl('light-warm').onclick();
  assert.deepEqual(posted.filter(m => m.action === 'lightCommand'), [
    { action: 'lightCommand', command: 'warm', targets: ['192.168.1.10', '192.168.1.11'], brightness: 45 }
  ]);
});

test('Android home.js classifies WiZ failure/timeout/not-found/pending/ok outcomes accurately and ignores generic save events', () => {
  const { sandbox, getEl } = createPhoneSandbox();
  const base = { phase: 'idle', remainingSeconds: 0, totalSeconds: 0, exact: true, alerts: true, paired: false, home: { lights: ['192.168.1.10'], routines: [], rules: [] }, upcoming: [], routineOutcomes: [] };

  const cases = [
    ['Saved on this phone.', '', 'muted outcome'],
    ['Waiting for WiZ acknowledgement…', 'Waiting for WiZ acknowledgement…', 'muted outcome pending'],
    ['Looking for WiZ lights…', 'Looking for WiZ lights…', 'muted outcome pending'],
    ['No WiZ lights found. Use the same Wi-Fi, enable WiZ Local communication, or enter an IP address.', 'No WiZ lights found. Use the same Wi-Fi, enable WiZ Local communication, or enter an IP address.', 'muted outcome fail'],
    ['192.168.1.10: timed out — check Wi-Fi and WiZ Local communication', '192.168.1.10: timed out — check Wi-Fi and WiZ Local communication', 'muted outcome fail'],
    ['192.168.1.10: acknowledged\n192.168.1.11: no acknowledgement', '192.168.1.10: acknowledged\n192.168.1.11: no acknowledgement', 'muted outcome fail'],
    ['WiZ check timed out. Check the phone\'s Wi-Fi and WiZ Local communication.', 'WiZ check timed out. Check the phone\'s Wi-Fi and WiZ Local communication.', 'muted outcome fail'],
    ['192.168.1.10: acknowledged', '192.168.1.10: acknowledged', 'muted outcome ok'],
    ['192.168.1.10: on', '192.168.1.10: on', 'muted outcome ok']
  ];

  for (const [eventText, expectedText, expectedClass] of cases) {
    sandbox.window.phoneUI.update({ ...base, event: eventText });
    assert.equal(getEl('light-result').textContent, expectedText, `light-result text for "${eventText}"`);
    assert.equal(getEl('light-result').className, expectedClass, `light-result class for "${eventText}"`);
  }
});

test('Android M6 First Light markup, safe defaults, exact-alarm disclosure, WiZ gating, and bridge commands', () => {
  // Markup and honest disclosure checks
  assert.match(indexHtml, /id="first-light-card"/);
  assert.match(indexHtml, /FIRST LIGHT · THIS PHONE/);
  assert.match(indexHtml, /Works with your PC off\./);
  assert.match(indexHtml, /cannot wake a powered-off phone/);
  assert.match(indexHtml, /Manual off always wins\./);

  // Zero CSS double-insetting: phone.css has exactly one env(safe-area-inset-bottom) on main
  const phoneBottomInsets = phoneCss.match(/env\(safe-area-inset-bottom/g) || [];
  assert.equal(phoneBottomInsets.length, 1, 'phone.css must not double-inset safe-area-inset-bottom');

  const { sandbox, getEl, posted } = createPhoneSandbox();
  const baseHome = { lights: [], routines: [], rules: [] };

  // Defaults OFF with 0 saved lights -> sunrise disabled
  sandbox.window.phoneUI.update({
    phase: 'idle',
    remainingSeconds: 0,
    totalSeconds: 0,
    exact: false,
    alerts: false,
    paired: false,
    handoffPairing: false,
    home: baseHome,
    upcoming: [],
    routineOutcomes: [],
    firstLight: {
      config: { enabled: false, time: '07:00', weekdays: [1, 2, 3, 4, 5], sunriseEnabled: false, sunriseMinutes: 15, startBrightness: 10, endBrightness: 80, lightTargets: [] },
      armed: false,
      nextWakeEpochMs: 0,
      nextTriggerEpochMs: 0,
      rampActive: false,
      rampStep: 0,
      rampTotalSteps: 0,
      lastEvent: ''
    }
  });
  assert.equal(getEl('fl-state').textContent, 'Off');
  assert.equal(getEl('fl-enabled').checked, false);
  assert.equal(getEl('fl-sunrise-enabled').disabled, true);
  assert.equal(getEl('fl-sunrise-fields').hidden, true);
  assert.equal(getEl('fl-stop-ramp').hidden, true);
  assert.equal(getEl('handoff-pairing').hidden, true, 'handoff gate must stay OFF');

  // Enabled without exact-alarm access -> honest "Needs alarm access" warning
  sandbox.window.phoneUI.update({
    phase: 'idle',
    remainingSeconds: 0,
    totalSeconds: 0,
    exact: false,
    alerts: true,
    paired: false,
    handoffPairing: false,
    home: baseHome,
    upcoming: [],
    routineOutcomes: [],
    firstLight: {
      config: { enabled: true, time: '07:00', weekdays: [1, 2, 3, 4, 5], sunriseEnabled: false, sunriseMinutes: 15, startBrightness: 10, endBrightness: 80, lightTargets: [] },
      armed: false,
      nextWakeEpochMs: 0,
      nextTriggerEpochMs: 0,
      rampActive: false,
      rampStep: 0,
      rampTotalSteps: 0,
      lastEvent: ''
    }
  });
  assert.equal(getEl('fl-state').textContent, 'Needs alarm access');
  assert.match(getEl('fl-next').textContent, /precise alerts/);

  // Armed with saved WiZ lights + active sunrise ramp -> shows Stop sunrise & posts stopFirstLight
  const wakeTs = Date.UTC(2026, 10, 26, 12, 0, 0);
  sandbox.window.phoneUI.update({
    phase: 'idle',
    remainingSeconds: 0,
    totalSeconds: 0,
    exact: true,
    alerts: true,
    paired: false,
    handoffPairing: false,
    home: { lights: ['192.168.1.25'], routines: [], rules: [] },
    upcoming: [],
    routineOutcomes: [],
    firstLight: {
      config: { enabled: true, time: '07:00', weekdays: [1, 2, 3, 4, 5], sunriseEnabled: true, sunriseMinutes: 15, startBrightness: 10, endBrightness: 80, lightTargets: ['192.168.1.25'] },
      armed: true,
      nextWakeEpochMs: wakeTs,
      nextTriggerEpochMs: wakeTs - 15 * 60_000,
      rampActive: true,
      rampStep: 3,
      rampTotalSteps: 15,
      lastEvent: 'First Light sunrise started (1 local WiZ light(s)).'
    }
  });
  assert.equal(getEl('fl-state').textContent, 'Sunrise active');
  assert.equal(getEl('fl-stop-ramp').hidden, false);
  assert.equal(getEl('fl-sunrise-enabled').disabled, false);
  assert.equal(getEl('fl-sunrise-fields').hidden, false);

  posted.length = 0;
  getEl('fl-stop-ramp').onclick();
  assert.deepEqual(posted, [{ action: 'stopFirstLight' }]);

  // Submitting First Light form posts typed saveFirstLight payload
  posted.length = 0;
  getEl('first-light-form').onsubmit({ preventDefault() {} });
  const savedMsg = posted.find(m => m.action === 'saveFirstLight');
  assert.ok(savedMsg, 'saveFirstLight payload must be posted');
  assert.equal(savedMsg.firstLight.enabled, true);
  assert.equal(savedMsg.firstLight.time, '07:00');
  assert.deepEqual(savedMsg.firstLight.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(savedMsg.firstLight.sunriseEnabled, true);
  assert.equal(savedMsg.firstLight.sunriseMinutes, 15);
  assert.deepEqual(savedMsg.firstLight.lightTargets, ['192.168.1.25']);
});
