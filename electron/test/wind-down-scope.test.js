'use strict';

// UI-R3 Fire 02: Test Mode says what still runs. The real pickWindDownFacts /
// windDownEffects (renderer-utils.js) and renderWindDownScope (renderer.js)
// run in a vm sandbox with stub elements. Pure functions only: no settings
// are read from disk, no IPC, no app launch.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

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

function line(source, re) {
  const m = source.match(re);
  if (!m) throw new Error(`missing ${re}`);
  return m[0];
}

function createSandbox(state = {}) {
  const el = () => ({ hidden: true, textContent: '', dataset: {} });
  const elements = { 'set-testmode-scope': el(), 'plan-scope-note': el() };
  const sandbox = {
    state: { settingsLoaded: true, dryRun: true, ...state },
    document: { getElementById: id => elements[id] || null }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    line(utilsSource, /const WIND_DOWN_APP_NAME = [^\n]*/),
    line(utilsSource, /const WIND_DOWN_LAN_PROVIDERS = [^\n]*/),
    extractFunction(utilsSource, 'pickWindDownFacts'),
    extractFunction(utilsSource, 'windDownEffects'),
    line(rendererSource, /let windDownFacts = null;/),
    extractFunction(rendererSource, 'getWindDownFacts'),
    extractFunction(rendererSource, 'setWindDownFacts'),
    extractFunction(rendererSource, 'renderWindDownScope'),
    'this.api = { pickWindDownFacts, windDownEffects, setWindDownFacts, getWindDownFacts, renderWindDownScope };'
  ].join('\n'), sandbox);
  return { ...sandbox.api, elements, state: sandbox.state };
}

// Array.from: arrays built inside the vm realm are copied into this one for deepEqual.
const ids = r => Array.from(r.effects, e => e.id);
const labels = r => Array.from(r.effects, e => e.label);

function keysDeep(value, out = []) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); keysDeep(v, out); }
  }
  return out;
}

test('pickWindDownFacts keeps only the listed non-secret fields', () => {
  const s = createSandbox();
  const facts = s.pickWindDownFacts({
    app: { nightLightOnDim: true, pauseMediaOnDim: false, lockoutOnDim: true, focusBlocklist: ['chrome', 'steam'], timerName: 'x', bedtime: '22:30' },
    contentBlocker: { enabled: true, blockOnDim: true, blocklist: ['a.com'], useDefault: false },
    wifiGuard: { enabled: true, blockOnDim: true, provider: 'tplink', routerIp: '192.168.0.1', routerUser: 'admin', routerPass: 'hunter2', deviceMacs: ['AA:BB:CC:DD:EE:FF', '11:22:33:44:55:66'], deviceIps: ['192.168.0.9'], webhookUrl: 'http://x', webhookHeaders: { Authorization: 'Bearer abc' } },
    lights: { enabled: true, hueUsername: 'secret-key', httpUrl: 'http://lights', provider: 'hue' }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(facts)), {
    app: { nightLightOnDim: true, pauseMediaOnDim: false, lockoutOnDim: true, closeApps: 2 },
    contentBlocker: { enabled: true, blockOnDim: true },
    wifiGuard: { enabled: true, blockOnDim: true, provider: 'tplink', listed: 2 },
    lights: { enabled: true }
  });
  const flat = JSON.stringify(facts);
  for (const secret of ['hunter2', 'admin', '192.168', 'Bearer', 'secret-key', 'http://', 'AA:BB']) assert.ok(!flat.includes(secret), secret);
  for (const key of keysDeep(facts)) assert.doesNotMatch(key, /url|token|key|secret|pass|user|mac|ip$|ips|header/i, key);
});

test('pickWindDownFacts: a missing or malformed section becomes null', () => {
  const s = createSandbox();
  const facts = s.pickWindDownFacts({ app: null, contentBlocker: 'nope', wifiGuard: undefined, lights: { enabled: 'yes' } });
  assert.equal(facts.app, null);
  assert.equal(facts.contentBlocker, null);
  assert.equal(facts.wifiGuard, null);
  assert.deepEqual(JSON.parse(JSON.stringify(facts.lights)), { enabled: false });
  assert.deepEqual(JSON.parse(JSON.stringify(s.pickWindDownFacts())), { app: null, contentBlocker: null, wifiGuard: null, lights: null });
});

test("windDownEffects follows main's conditions, in a fixed order", () => {
  const s = createSandbox();
  const all = s.windDownEffects(s.pickWindDownFacts({
    app: { nightLightOnDim: true, pauseMediaOnDim: true, lockoutOnDim: true, focusBlocklist: ['chrome', 'bad;rm'] },
    contentBlocker: { enabled: true },
    wifiGuard: { enabled: true, provider: 'adapter' },
    lights: { enabled: true }
  }));
  assert.deepEqual(ids(all), ['night-light', 'close-apps', 'pause-media', 'on-top', 'wifi', 'sites', 'lights']);
  assert.deepEqual(labels(all), ['turns on Night Light', 'closes 1 app', 'pauses media', 'keeps Lights Out on top', "turns off this PC's Wi-Fi", 'blocks sites', 'changes your smart lights']);
  assert.deepEqual([...all.unknown], []);
});

test('windDownEffects: the blocklist counts only names main accepts', () => {
  const s = createSandbox();
  const r = s.windDownEffects(s.pickWindDownFacts({ app: { focusBlocklist: ['chrome', 'bad;rm', 'Discord.exe', '', 42, 'two words'] }, contentBlocker: {}, wifiGuard: {}, lights: {} }));
  assert.deepEqual(labels(r), ['closes 3 apps']);
});

test('windDownEffects: Wi-Fi Guard adapter vs a router with 0 or 2 devices, blockOnDim false, firewall', () => {
  const s = createSandbox();
  const wifi = wg => labels(s.windDownEffects(s.pickWindDownFacts({ app: {}, contentBlocker: {}, wifiGuard: wg, lights: {} })));
  assert.deepEqual(wifi({ enabled: true, provider: 'adapter' }), ["turns off this PC's Wi-Fi"]);
  assert.deepEqual(wifi({ enabled: true, provider: 'asus', deviceMacs: [], deviceIps: [] }), []);
  assert.deepEqual(wifi({ enabled: true, provider: 'asus', deviceMacs: ['a', 'b'], deviceIps: ['c', 'd'] }), ['pauses internet for 2 devices']);
  assert.deepEqual(wifi({ enabled: true, provider: 'webhook', deviceMacs: ['a'] }), ['pauses internet for 1 device']);
  assert.deepEqual(wifi({ enabled: true, provider: 'adapter', blockOnDim: false }), []);
  assert.deepEqual(wifi({ enabled: false, provider: 'adapter' }), []);
  assert.deepEqual(wifi({ enabled: true, provider: 'firewall', deviceMacs: ['a'] }), [], 'main cannot pause a LAN device through the firewall provider');
});

test('windDownEffects: the content blocker needs enabled and blockOnDim; lights need enabled', () => {
  const s = createSandbox();
  const e = (cb, li) => ids(s.windDownEffects(s.pickWindDownFacts({ app: {}, contentBlocker: cb, wifiGuard: {}, lights: li })));
  assert.deepEqual(e({ enabled: false }, { enabled: false }), []);
  assert.deepEqual(e({ enabled: true, blockOnDim: false }, { enabled: false }), []);
  assert.deepEqual(e({ enabled: true, blockOnDim: true }, { enabled: true }), ['sites', 'lights']);
});

test('windDownEffects: null sections land in unknown', () => {
  const s = createSandbox();
  const r = s.windDownEffects(s.pickWindDownFacts({ app: { nightLightOnDim: true } }));
  assert.deepEqual(ids(r), ['night-light']);
  assert.deepEqual([...r.unknown], ['contentBlocker', 'wifiGuard', 'lights']);
  assert.deepEqual([...s.windDownEffects(null).unknown], ['app', 'contentBlocker', 'wifiGuard', 'lights']);
});

const CONFIGURED = { app: { focusBlocklist: ['chrome', 'steam'] }, contentBlocker: { enabled: true }, wifiGuard: { enabled: false }, lights: { enabled: false } };

test('renderWindDownScope: Settings note in both modes (amber only in Test Mode), Tonight note only in Test Mode', () => {
  const test = createSandbox({ dryRun: true });
  test.setWindDownFacts(test.pickWindDownFacts(CONFIGURED));
  const set = test.elements['set-testmode-scope'];
  const plan = test.elements['plan-scope-note'];
  assert.equal(set.hidden, false);
  assert.equal(set.textContent, 'Test Mode holds back only the power action. Wind-down still runs: closes 2 apps · blocks sites.');
  assert.equal(set.dataset.tone, 'test');
  assert.equal(plan.hidden, false);
  assert.equal(plan.textContent, 'Still runs in Test Mode: closes 2 apps · blocks sites.');

  const real = createSandbox({ dryRun: false });
  real.setWindDownFacts(real.pickWindDownFacts(CONFIGURED));
  assert.equal(real.elements['set-testmode-scope'].hidden, false);
  assert.equal(real.elements['set-testmode-scope'].dataset.tone, 'muted');
  assert.equal(real.elements['plan-scope-note'].hidden, true, 'Tonight says it only in Test Mode');
});

test('renderWindDownScope: hides both when nothing runs or settings have not loaded', () => {
  const none = createSandbox({ dryRun: true });
  none.setWindDownFacts(none.pickWindDownFacts({ app: {}, contentBlocker: {}, wifiGuard: {}, lights: {} }));
  assert.equal(none.elements['set-testmode-scope'].hidden, true);
  assert.equal(none.elements['plan-scope-note'].hidden, true);

  const loading = createSandbox({ settingsLoaded: false, dryRun: true });
  loading.setWindDownFacts(loading.pickWindDownFacts(CONFIGURED));
  assert.equal(loading.elements['set-testmode-scope'].hidden, true);
  assert.equal(loading.elements['plan-scope-note'].hidden, true);

  const unread = createSandbox({ dryRun: true });
  unread.renderWindDownScope();
  assert.equal(unread.elements['set-testmode-scope'].hidden, true, 'no facts yet: nothing is claimed');

  // Shown, then the effects are switched off: hidden AND emptied, so the Test
  // Mode box's aria-describedby never reads a stale list.
  const was = createSandbox({ dryRun: true });
  was.setWindDownFacts(was.pickWindDownFacts(CONFIGURED));
  assert.equal(was.elements['set-testmode-scope'].hidden, false);
  was.setWindDownFacts(was.pickWindDownFacts({ app: {}, contentBlocker: {}, wifiGuard: {}, lights: {} }));
  assert.equal(was.elements['set-testmode-scope'].hidden, true);
  assert.equal(was.elements['set-testmode-scope'].textContent, '');
  assert.equal(was.elements['plan-scope-note'].textContent, '');
});

test('renderWindDownScope: an unreadable section is named, never guessed', () => {
  const s = createSandbox({ dryRun: true });
  s.setWindDownFacts(s.pickWindDownFacts({ app: { nightLightOnDim: true }, contentBlocker: null, wifiGuard: null, lights: { enabled: false } }));
  assert.equal(s.elements['set-testmode-scope'].textContent, 'Test Mode holds back only the power action. Wind-down still runs: turns on Night Light · 2 settings could not be read.');
});
