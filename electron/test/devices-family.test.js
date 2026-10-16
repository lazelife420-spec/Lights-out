'use strict';

// UI-R3 P08: Devices family rows, the peer result interpreter, the shared
// lights reading and the Wi-Fi Guard selection summary.
//
// The real renderer functions run in a vm sandbox with a tiny fake DOM and
// a recording api: nothing here touches the network, Electron or the app.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const familyRemoteSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-family-remote.js'), 'utf8');

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

// `const NAME = ...;` with balanced brackets (Object.freeze({...}) etc.).
function extractConst(source, name) {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`const ${name} not found`);
  let i = source.indexOf('=', start) + 1;
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) break;
  }
  return source.slice(start, i + 1);
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attrs = {};
    this.className = '';
    this.hidden = false;
    this.type = '';
    this._text = '';
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  insertBefore(c, ref) {
    if (c.parent) c.remove();
    c.parent = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(c); else this.children.splice(at, 0, c);
    return c;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  get classList() {
    const self = this;
    const names = () => self.className.split(/\s+/).filter(Boolean);
    return {
      toggle(n, on) {
        const set = new Set(names());
        if (on) set.add(n); else set.delete(n);
        self.className = [...set].join(' ');
      },
      contains(n) { return names().includes(n); }
    };
  }
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    if (sel.startsWith('.')) return this.descendants().filter(e => e.classList.contains(sel.slice(1)));
    if (sel === 'button[data-peer-act]') return this.descendants().filter(e => e.tagName === 'BUTTON' && e.dataset.peerAct);
    throw new Error(`unsupported selector ${sel}`);
  }
}

function devicesSandbox(api) {
  const timers = [];
  const els = {
    deviceFamilyPeers: new FakeEl('ul'),
    deviceFamilyCard: new FakeEl('article'),
    deviceFamilyStatus: new FakeEl('span'),
    deviceFamilyDiscovery: new FakeEl('span'),
    deviceFamilyCount: new FakeEl('span')
  };
  const ctx = vm.createContext({
    els,
    api,
    document: { createElement: tag => new FakeEl(tag) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    Date,
    Map,
    Set,
    Object,
    Number,
    String,
    Math,
    Boolean,
    Error
  });
  const code = [
    extractConst(familyRemoteSource, 'PEER_RESULT'),
    extractConst(familyRemoteSource, 'PEER_ERROR'),
    extractFunction(familyRemoteSource, 'interpretPeerResult'),
    extractConst(rendererSource, 'DEVICE_CARD_STATES'),
    extractFunction(rendererSource, 'setDeviceCard'),
    extractFunction(rendererSource, 'setTextIfChanged'),
    extractConst(rendererSource, 'DEVICE_PEER_ACTIONS'),
    extractConst(rendererSource, 'PEER_RESULT_HOLD_MS'),
    extractConst(rendererSource, 'familyPeerUi'),
    'let devicesFamilyOn = false;',
    'let lastFamilyPeers = [];',
    extractFunction(rendererSource, 'peerSeenText'),
    extractFunction(rendererSource, 'familyPeerUiFor'),
    extractFunction(rendererSource, 'buildDevicePeerRow'),
    extractFunction(rendererSource, 'updateDevicePeerRow'),
    extractFunction(rendererSource, 'devicePeerRow'),
    extractFunction(rendererSource, 'applyFamilyPeers'),
    extractFunction(rendererSource, 'refreshDevicePeerRow'),
    extractFunction(rendererSource, 'runDevicePeerAction'),
    'this.__t = { applyFamilyPeers, runDevicePeerAction, familyPeerUi, peerSeenText };'
  ].join('\n');
  vm.runInContext(code, ctx);
  return { t: ctx.__t, els, timers };
}

function rowParts(li) {
  return {
    name: li.querySelector('.device-peer-name').textContent,
    ip: li.querySelector('.device-peer-ip').textContent,
    seen: li.querySelector('.device-peer-seen').textContent,
    actionsHidden: li.querySelector('.device-peer-actions').hidden,
    buttons: li.querySelectorAll('button[data-peer-act]'),
    result: li.querySelector('.device-peer-result')
  };
}

test('peer rows show the escaped-by-textContent name, IP and a real seen age, with pause/resume/stop only', () => {
  const { t, els } = devicesSandbox({});
  t.applyFamilyPeers([{ ip: '10.0.0.2', name: 'Den <b>PC</b>', lastSeen: Date.now() - 12000 }], true);
  assert.equal(els.deviceFamilyPeers.children.length, 1);
  const li = els.deviceFamilyPeers.children[0];
  assert.equal(li.dataset.peerIp, '10.0.0.2');
  const parts = rowParts(li);
  assert.equal(parts.name, 'Den <b>PC</b>', 'the LAN name is text, never markup');
  assert.equal(parts.ip, '10.0.0.2');
  assert.equal(parts.seen, 'seen 12s ago');
  assert.equal(parts.actionsHidden, false);
  assert.deepEqual(parts.buttons.map(b => b.dataset.peerAct), ['pause', 'resume', 'cancel']);
  assert.deepEqual(parts.buttons.map(b => b.textContent), ['Pause', 'Resume', 'Stop run']);
  assert.equal(parts.buttons[0].getAttribute('aria-label'), 'Pause the run on Den <b>PC</b>');
  assert.equal(els.deviceFamilyCard.dataset.state, 'live');
  assert.equal(els.deviceFamilyStatus.textContent, '1 found');
  assert.equal(els.deviceFamilyCount.textContent, '1');
});

test('without the Same Wi-Fi companion the run controls are hidden and the card is off', () => {
  const { t, els } = devicesSandbox({});
  t.applyFamilyPeers([{ ip: '10.0.0.3', name: 'Office', lastSeen: Date.now() }], false);
  assert.equal(rowParts(els.deviceFamilyPeers.children[0]).actionsHidden, true);
  assert.equal(rowParts(els.deviceFamilyPeers.children[0]).seen, 'seen just now');
  assert.equal(els.deviceFamilyCard.dataset.state, 'off');
  assert.equal(els.deviceFamilyDiscovery.textContent, 'Needs Same Wi-Fi companion');
});

test('a refresh keeps the same row, its in-flight state and then the real result', async () => {
  let release;
  const calls = [];
  const api = {
    familyRemotePause: (ip) => { calls.push(['pause', ip]); return new Promise(r => { release = r; }); }
  };
  const { t, els } = devicesSandbox(api);
  const peer = { ip: '10.0.0.4', name: 'Kids', lastSeen: Date.now() };
  t.applyFamilyPeers([peer], true);
  const li = els.deviceFamilyPeers.children[0];
  const pending = t.runDevicePeerAction('10.0.0.4', 'pause');
  assert.equal(li.classList.contains('is-busy'), true);
  assert.equal(rowParts(li).result.textContent, 'Sending…');
  // A 5 s refresh lands while the command is in flight.
  t.applyFamilyPeers([{ ...peer, lastSeen: Date.now() - 6000 }], true);
  assert.equal(els.deviceFamilyPeers.children[0], li, 'the row is updated in place, never rebuilt');
  assert.equal(li.classList.contains('is-busy'), true);
  assert.ok(rowParts(li).buttons.every(b => b.getAttribute('aria-disabled') === 'true'));
  // A second press while busy sends nothing.
  await t.runDevicePeerAction('10.0.0.4', 'pause');
  assert.equal(calls.length, 1);
  release({ success: true, code: 'PAUSED' });
  await pending;
  assert.equal(li.classList.contains('is-busy'), false);
  assert.equal(rowParts(li).result.textContent, 'Paused');
  assert.equal(rowParts(li).result.dataset.tone, 'ok');
});

test('refusals read amber and failures read red; Start is never sent from Devices', async () => {
  const sent = [];
  const api = {
    familyRemoteCancel: async () => ({ success: false, statusCode: 409, code: 'NOT_RUNNING', error: 'No running timer to cancel' }),
    familyRemoteResume: async () => { throw new Error("Error invoking remote method 'family-remote-resume': Error: Timeout"); },
    familyRemoteStart: async () => { sent.push('start'); return { success: true, code: 'STARTED' }; }
  };
  const { t, els } = devicesSandbox(api);
  t.applyFamilyPeers([{ ip: '10.0.0.5', name: 'Den', lastSeen: Date.now() }], true);
  const li = els.deviceFamilyPeers.children[0];
  await t.runDevicePeerAction('10.0.0.5', 'cancel');
  assert.equal(rowParts(li).result.textContent, 'No run active there');
  assert.equal(rowParts(li).result.dataset.tone, 'warn');
  await t.runDevicePeerAction('10.0.0.5', 'resume');
  assert.equal(rowParts(li).result.textContent, 'No answer (timed out)');
  assert.equal(rowParts(li).result.dataset.tone, 'bad');
  await t.runDevicePeerAction('10.0.0.5', 'start');
  assert.deepEqual(sent, [], 'Devices has no Start');
});

test('an expired peer row and its idle UI state go away', () => {
  const { t, els } = devicesSandbox({});
  t.applyFamilyPeers([{ ip: '10.0.0.6', name: 'A', lastSeen: Date.now() }, { ip: '10.0.0.7', name: 'B', lastSeen: Date.now() }], true);
  t.familyPeerUi.set('10.0.0.6', { busy: false, result: { text: 'Paused', tone: 'ok' }, clearTimer: null });
  t.applyFamilyPeers([{ ip: '10.0.0.7', name: 'B', lastSeen: Date.now() }], true);
  assert.deepEqual(els.deviceFamilyPeers.children.map(li => li.dataset.peerIp), ['10.0.0.7']);
  assert.equal(t.familyPeerUi.has('10.0.0.6'), false);
  t.applyFamilyPeers([], true);
  assert.equal(els.deviceFamilyPeers.children.length, 0);
  assert.equal(els.deviceFamilyStatus.textContent, 'Listening');
});

function interpreter() {
  const ctx = vm.createContext({ Object, String });
  vm.runInContext([
    extractConst(familyRemoteSource, 'PEER_RESULT'),
    extractConst(familyRemoteSource, 'PEER_ERROR'),
    extractFunction(familyRemoteSource, 'interpretPeerResult'),
    extractFunction(familyRemoteSource, 'familyStartConfirmText'),
    'this.__t = { interpretPeerResult, familyStartConfirmText };'
  ].join('\n'), ctx);
  return ctx.__t;
}

test('interpretPeerResult never reports a success it did not get', () => {
  const { interpretPeerResult: read } = interpreter();
  const plain = (r, e) => ({ ...read(r, e) });
  assert.deepEqual(plain({ success: true, code: 'CANCELLED' }), { text: 'Run stopped', tone: 'ok' });
  assert.deepEqual(plain({ success: true, code: 'SOMETHING_NEW' }), { text: 'Done', tone: 'ok' });
  assert.deepEqual(plain({ success: false, code: 'NOT_PAUSED' }), { text: 'Not paused', tone: 'warn' });
  assert.deepEqual(plain({ success: false, code: 'RUN_ACTIVE' }), { text: 'A run is already active there', tone: 'warn' });
  assert.deepEqual(plain({ success: false, error: 'unauthorized' }), { text: 'Pairing code differs on that PC', tone: 'bad' });
  assert.deepEqual(plain({ success: false, error: 'unknown command' }), { text: 'State not shared (older Lights Out)', tone: 'warn' });
  assert.deepEqual(plain({ success: false, error: 'unknown peer' }), { text: 'That PC is no longer announcing itself', tone: 'bad' });
  assert.deepEqual(plain({ success: false, error: 'HTTP 404' }), { text: 'That PC answered HTTP 404', tone: 'bad' });
  assert.deepEqual(plain({ success: false, error: 'bad response' }), { text: 'Unexpected answer from that PC', tone: 'bad' });
  assert.deepEqual(plain(undefined), { text: 'Could not reach that PC', tone: 'bad' });
  assert.deepEqual(plain(undefined, new Error('Timeout')), { text: 'No answer (timed out)', tone: 'bad' });
  assert.deepEqual(plain(undefined, new Error('connect ECONNREFUSED')), { text: 'Could not reach that PC', tone: 'bad' });
  assert.equal(plain({ success: 'yes', code: 'PAUSED' }).tone, 'warn', 'only success === true is a success');
});

test('the Start confirm names a mode only when one was read', () => {
  const { familyStartConfirmText: text } = interpreter();
  assert.equal(text('Den', '10.0.0.2', null), "Start a 30-minute Shutdown timer on Den (10.0.0.2)? That PC's own Test Mode setting applies; its mode is unknown.");
  assert.match(text('Den', '10.0.0.2', 'test'), /Den is in Test Mode, so nothing will power off\.$/);
  assert.match(text('Den', '10.0.0.2', 'real'), /Den will really shut down when it ends\.$/);
});

test('describeLightsReadiness is one reading for every surface', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${extractFunction(rendererSource, 'describeLightsReadiness')}\nthis.__d = describeLightsReadiness;`, ctx);
  const d = (cfg) => ({ ...ctx.__d(cfg) });
  assert.deepEqual(d(null), { label: 'Unavailable', tone: 'error' });
  assert.deepEqual(d({ enabled: false, provider: 'hue', verifiedConfigKey: 'k' }), { label: 'Off', tone: 'off' });
  assert.deepEqual(d({ enabled: true, provider: 'none' }), { label: 'Off', tone: 'off' });
  assert.deepEqual(d({ enabled: true, provider: 'hue' }), { label: 'Needs setup', tone: 'warn' });
  assert.deepEqual(d({ enabled: true, provider: 'hue', verifiedConfigKey: 'k' }), { label: 'Hue Ready', tone: 'ok' });
  assert.deepEqual(d({ enabled: true, provider: 'hue', verifiedConfigKey: 'k', hueAllowLegacyHttp: true }), { label: 'Hue Ready · legacy', tone: 'warn' });
  assert.deepEqual(d({ enabled: true, provider: 'http', verifiedConfigKey: 'k' }), { label: 'HTTP Ready', tone: 'ok' });
});

test('the Wi-Fi Guard summary says what the selection really does', () => {
  const summary = new FakeEl('p');
  const els = {
    selWifiProvider: { value: 'tplink' },
    chkWifiGuard: { checked: true },
    chkWifiBlockDim: { checked: true },
    chkWifiUnblockCancel: { checked: true }
  };
  const ctx = vm.createContext({
    els,
    Math,
    Boolean,
    wifiSelectedDevices: { macs: ['aa', 'bb'], ips: ['1', '2'] },
    document: { getElementById: id => (id === 'wifi-selected-summary' ? summary : null) }
  });
  vm.runInContext([
    extractConst(familyRemoteSource, 'WIFI_ROUTER_PROVIDERS'),
    extractFunction(familyRemoteSource, 'wifiSelectedCount'),
    extractFunction(familyRemoteSource, 'renderWifiSelectedSummary'),
    'this.__s = renderWifiSelectedSummary;'
  ].join('\n'), ctx);
  ctx.__s();
  assert.equal(summary.textContent, '2 selected · sent to your router when the dim phase starts · restored if you cancel');
  els.chkWifiUnblockCancel.checked = false;
  els.selWifiProvider.value = 'webhook';
  ctx.__s();
  assert.equal(summary.textContent, '2 selected · sent to your webhook when the dim phase starts · not restored automatically');
  els.chkWifiBlockDim.checked = false;
  ctx.__s();
  assert.equal(summary.textContent, '2 selected · not blocked automatically');
  els.chkWifiBlockDim.checked = true;
  els.chkWifiGuard.checked = false;
  ctx.__s();
  assert.equal(summary.textContent, '2 selected · not blocked automatically');
  els.chkWifiGuard.checked = true;
  els.selWifiProvider.value = 'adapter';
  ctx.__s();
  assert.match(summary.textContent, /^2 selected · Wi-Fi adapter mode ignores this list/);
});

// ---- UI-R3 Fire 07: Devices truth -------------------------------------------
// The real renderer functions in a vm sandbox (no DOM, no Electron, no app).

const utilsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-utils.js'), 'utf8');

function wifiCardSandbox({ settings, live = null, running = false } = {}) {
  const els = {};
  for (const k of ['deviceWifiCard', 'deviceWifiStatus', 'deviceWifiMethod', 'deviceWifiCount', 'deviceWifiCountLabel', 'deviceWifiAdapterNote', 'deviceWifiNow', 'btnDeviceWifiRestore', 'deviceWifiRestoreResult']) {
    els[k] = new FakeEl(k === 'deviceWifiCard' ? 'article' : 'span');
  }
  els.deviceWifiAdapterNote.hidden = true;
  els.deviceWifiCountLabel.textContent = 'Devices listed';
  const ctx = vm.createContext({
    els,
    state: { running, paused: false },
    window: { wifiGuardLive: live },
    formatEndTime: () => '10:00 PM',
    Date, Math, Array, Boolean, String, Object
  });
  vm.runInContext([
    extractConst(utilsSource, 'WIND_DOWN_LAN_PROVIDERS'),
    extractConst(rendererSource, 'DEVICE_CARD_STATES'),
    extractConst(rendererSource, 'WIFI_GUARD_METHOD_LABEL'),
    extractFunction(rendererSource, 'setDeviceCard'),
    extractFunction(rendererSource, 'setTextIfChanged'),
    'var devicesWifiSettings; var wifiRestoreBusy = false;',
    extractFunction(rendererSource, 'applyWifiGuardCard'),
    'this.__set = s => { devicesWifiSettings = s; applyWifiGuardCard(); };'
  ].join('\n'), ctx);
  if (settings !== undefined) ctx.__set(settings);
  return { els, set: ctx.__set };
}

const wifiCard = els => ({
  state: els.deviceWifiCard.dataset.state,
  label: els.deviceWifiStatus.textContent,
  countLabel: els.deviceWifiCountLabel.textContent,
  count: els.deviceWifiCount.textContent,
  note: !els.deviceWifiAdapterNote.hidden
});

test('Fire 07: Wi-Fi Guard says Armed only when main would really block', () => {
  const base = { enabled: true, provider: 'tplink', deviceMacs: [], deviceIps: [], blockOnDim: true };
  // Adapter: the list is ignored; this PC's Wi-Fi turns off.
  let { els } = wifiCardSandbox({ settings: { ...base, provider: 'adapter' } });
  assert.deepEqual({ ...wifiCard(els) }, { state: 'ok', label: "Armed · this PC's Wi-Fi", countLabel: 'Turns off', count: "This PC's Wi-Fi", note: true });
  ({ els } = wifiCardSandbox({ settings: { ...base, provider: 'adapter', blockOnDim: false } }));
  assert.deepEqual({ ...wifiCard(els) }, { state: 'warn', label: 'Manual only', countLabel: 'Turns off', count: "This PC's Wi-Fi", note: false });
  // Router with blockOnDim off: nothing is blocked automatically.
  ({ els } = wifiCardSandbox({ settings: { ...base, deviceMacs: ['a', 'b'], deviceIps: ['1', '2'], blockOnDim: false } }));
  assert.equal(els.deviceWifiCard.dataset.state, 'warn');
  assert.equal(els.deviceWifiStatus.textContent, 'Manual only');
  // Router, 0 and 2 devices.
  ({ els } = wifiCardSandbox({ settings: base }));
  assert.deepEqual({ ...wifiCard(els) }, { state: 'warn', label: 'No devices listed', countLabel: 'Devices listed', count: '0', note: false });
  ({ els } = wifiCardSandbox({ settings: { ...base, deviceMacs: ['a', 'b'], deviceIps: ['1', '2'] } }));
  assert.deepEqual({ ...wifiCard(els) }, { state: 'ok', label: 'Armed for wind-down', countLabel: 'Devices listed', count: '2', note: false });
  // A provider that cannot block another device is never Armed.
  ({ els } = wifiCardSandbox({ settings: { ...base, provider: 'firewall', deviceMacs: ['a'], deviceIps: ['1'] } }));
  assert.equal(els.deviceWifiCard.dataset.state, 'warn');
  assert.doesNotMatch(els.deviceWifiStatus.textContent, /Armed/);
  // Disabled.
  ({ els } = wifiCardSandbox({ settings: { ...base, enabled: false, provider: 'adapter' } }));
  assert.deepEqual({ ...wifiCard(els) }, { state: 'off', label: 'Off', countLabel: 'Devices listed', count: '0', note: false });
});

test('Fire 07: blocked-now wins, and the adapter note and count label reset on every path', () => {
  const adapter = { enabled: true, provider: 'adapter', deviceMacs: [], deviceIps: [], blockOnDim: true };
  const { els, set } = wifiCardSandbox({ settings: adapter, live: { blocked: true, at: Date.now() } });
  assert.equal(els.deviceWifiCard.dataset.state, 'warn');
  assert.equal(els.deviceWifiStatus.textContent, 'Internet paused');
  assert.equal(els.deviceWifiAdapterNote.hidden, false, 'the adapter cost stays stated while paused');
  // Back to a router: label and value reset, note hidden.
  set({ ...adapter, provider: 'asus', deviceMacs: ['a'], deviceIps: ['1'] });
  assert.equal(els.deviceWifiCountLabel.textContent, 'Devices listed');
  assert.equal(els.deviceWifiCount.textContent, '1');
  assert.equal(els.deviceWifiAdapterNote.hidden, true);
  // A failed read hides the note too.
  set(adapter);
  assert.equal(els.deviceWifiAdapterNote.hidden, false);
  set(null);
  assert.equal(els.deviceWifiAdapterNote.hidden, true);
  assert.equal(els.deviceWifiCountLabel.textContent, 'Devices listed');
  // Off also hides it.
  set(adapter);
  set({ ...adapter, enabled: false });
  assert.equal(els.deviceWifiAdapterNote.hidden, true);
});

function scopeSandbox({ facts, settingsLoaded = true, dryRun = true }) {
  const els = { deviceLightsScope: new FakeEl('p'), deviceWifiScope: new FakeEl('p') };
  els.deviceLightsScope.hidden = true;
  els.deviceWifiScope.hidden = true;
  const ctx = vm.createContext({ els, state: { settingsLoaded, dryRun }, Math, Number, Array, Boolean, Object });
  vm.runInContext([
    extractConst(utilsSource, 'WIND_DOWN_APP_NAME'),
    extractConst(utilsSource, 'WIND_DOWN_LAN_PROVIDERS'),
    extractFunction(utilsSource, 'pickWindDownFacts'),
    extractFunction(utilsSource, 'windDownEffects'),
    'var __facts = null; function getWindDownFacts() { return __facts; }',
    extractFunction(rendererSource, 'syncDeviceScopeNotes'),
    'this.__run = (raw, s) => { __facts = raw ? pickWindDownFacts(raw) : null; Object.assign(state, s || {}); syncDeviceScopeNotes(); };'
  ].join('\n'), ctx);
  ctx.__run(facts);
  return { els, run: ctx.__run };
}

test('Fire 07: the Test Mode scope notes show only in loaded Test Mode, when the effect is listed', () => {
  const on = {
    lights: { enabled: true },
    wifiGuard: { enabled: true, provider: 'netgear', deviceMacs: ['a'], deviceIps: ['1'] }
  };
  const { els, run } = scopeSandbox({ facts: on });
  assert.equal(els.deviceLightsScope.hidden, false);
  assert.equal(els.deviceWifiScope.hidden, false);
  assert.equal(els.deviceWifiScope.textContent, 'Runs in Test Mode too. Chosen devices still lose internet at wind-down.');
  run(on, { dryRun: false });
  assert.equal(els.deviceLightsScope.hidden, true, 'hidden outside Test Mode');
  assert.equal(els.deviceWifiScope.hidden, true);
  run(on, { dryRun: true, settingsLoaded: false });
  assert.equal(els.deviceLightsScope.hidden, true, 'hidden while settings load');
  run({ lights: { enabled: false }, wifiGuard: { ...on.wifiGuard, blockOnDim: false } }, { settingsLoaded: true });
  assert.equal(els.deviceLightsScope.hidden, true, 'lights off: no note');
  assert.equal(els.deviceWifiScope.hidden, true, 'blockOnDim off: no note');
  run({ lights: { enabled: true }, wifiGuard: { ...on.wifiGuard, deviceMacs: [], deviceIps: [] } });
  assert.equal(els.deviceWifiScope.hidden, true, 'a router with nothing listed blocks nothing');
  run({ wifiGuard: { enabled: true, provider: 'adapter' } });
  assert.equal(els.deviceWifiScope.hidden, false);
  assert.equal(els.deviceWifiScope.textContent, "Runs in Test Mode too. This PC's Wi-Fi still turns off at wind-down.");
  assert.equal(els.deviceLightsScope.hidden, true, 'an unread lights section claims nothing');
  run(null);
  assert.equal(els.deviceWifiScope.hidden, true, 'no facts: no claim');
});

test('Fire 07: an unreported battery hides its row; a real reading (0% too) shows it', () => {
  const els = { batteryLevel: new FakeEl('span'), powerPlan: new FakeEl('span'), devicePcPlanRow: new FakeEl('div'), devicePcBatteryRow: new FakeEl('div') };
  const ctx = vm.createContext({ els });
  vm.runInContext(`${extractFunction(rendererSource, 'applySystemInfo')}\nthis.__a = applySystemInfo;`, ctx);
  ctx.__a({ battery: 'N/A', powerPlan: 'Balanced' });
  assert.equal(els.devicePcBatteryRow.hidden, true);
  assert.equal(els.batteryLevel.textContent, 'Not reported');
  for (const battery of [undefined, null, '']) {
    ctx.__a({ battery, powerPlan: 'Balanced' });
    assert.equal(els.devicePcBatteryRow.hidden, true);
  }
  ctx.__a({ battery: 0, powerPlan: 'Balanced' });
  assert.equal(els.devicePcBatteryRow.hidden, false);
  assert.equal(els.batteryLevel.textContent, '0%');
  ctx.__a({ battery: 87, powerPlan: 'Unknown' });
  assert.equal(els.devicePcBatteryRow.hidden, false);
  assert.equal(els.devicePcPlanRow.hidden, true);
});

test('Fire 07: a failed phone companion explains itself without its address or pairing code', () => {
  const ctx = vm.createContext({ Object, String, Number });
  vm.runInContext([
    extractConst(rendererSource, 'PHONE_ANSWER_FAILURES'),
    extractFunction(rendererSource, 'describePhoneFailure'),
    'this.__d = describePhoneFailure;'
  ].join('\n'), ctx);
  const leak = {
    failed: true, url: 'http://192.168.1.20:8765/?t=SECRETVALUE', shortCode: 'ABCD-1234', lanIp: '192.168.1.20',
    errorMessage: 'Readiness check failed: Health probe for 192.168.1.20 failed: connect ECONNREFUSED',
    failureDetails: { pid: 4321, name: 'node', path: 'C:\\Tools\\node.exe' }
  };
  const d = rc => ctx.__d({ ...leak, ...rc });
  assert.equal(d({ errorCode: 'EADDRINUSE', port: 8765 }), 'Port 8765 is already used by another app. Change the port in Phone settings.');
  for (const code of ['HTTP_HEALTH_FAILED', 'PAIR_CHECK_FAILED', 'WEBSOCKET_UPGRADE_FAILED']) {
    assert.equal(d({ errorCode: code }), 'The companion started but could not answer on this network. Check the firewall, then retry.');
  }
  assert.equal(d({ errorCode: 'NO_LAN_ADDRESS' }), 'No usable LAN address is available. Reconnect Wi-Fi, then retry.');
  assert.equal(d({ errorCode: 'SERVER_ERROR' }), 'The companion could not start on this network.');
  assert.equal(d({ errorCode: '' }), 'The companion could not start on this network.');
  for (const code of ['EADDRINUSE', 'HTTP_HEALTH_FAILED', 'NO_LAN_ADDRESS', 'X']) {
    const text = d({ errorCode: code, port: 8765 });
    assert.doesNotMatch(text, /192\.168|SECRETVALUE|ABCD-1234|4321|node\.exe|ECONNREFUSED/, `no leak for ${code}`);
  }
});

test('phone badges distinguish endpoint readiness, connections, local scope and failure', () => {
  const ctx = vm.createContext({ Math, Number });
  vm.runInContext(`${extractFunction(rendererSource, 'describePhoneReadiness')}\nthis.read = describePhoneReadiness;`, ctx);
  const read = rc => ({ ...ctx.read(rc) });
  assert.deepEqual(read(null), { label: 'Unavailable', tone: 'error' });
  assert.deepEqual(read({ mode: 'off', ready: true, clients: 2 }), { label: 'Off', tone: 'off' });
  assert.deepEqual(read({ mode: 'wifi', ready: true, failed: true, clients: 2 }), { label: 'Connection failed', tone: 'error' });
  assert.deepEqual(read({ mode: 'wifi', ready: false, clients: 2 }), { label: 'Starting…', tone: 'warn' });
  assert.deepEqual(read({ mode: 'local', ready: true, clients: 2 }), { label: 'This PC only', tone: 'ok' });
  assert.deepEqual(read({ mode: 'wifi', ready: true, clients: 0 }), { label: 'Waiting for phone', tone: 'ok' });
  assert.deepEqual(read({ mode: 'wifi', ready: true, clients: 2 }), { label: '2 connected', tone: 'live' });
  assert.deepEqual(read({ mode: 'wifi', ready: true, clients: -1 }), { label: 'Waiting for phone', tone: 'ok' });
});
