'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const releaseGates = require('../releaseGates');

function createFakeElement(id = '', tag = 'div') {
  return {
    id,
    tagName: tag.toUpperCase(),
    hidden: false,
    disabled: false,
    checked: false,
    open: false,
    value: '',
    textContent: '',
    className: '',
    dataset: {},
    children: [],
    style: {},
    attributes: {},
    classList: {
      _set: new Set(),
      add(...c) { c.forEach(x => this._set.add(x)); },
      remove(...c) { c.forEach(x => this._set.delete(x)); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); }
    },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    scrollIntoView() {},
    getClientRects() { return this.hidden ? [] : [{}]; },
    closest() { return null; }
  };
}

function collectText(node) {
  if (!node) return '';
  return [node.textContent || '', ...(node.children || []).map(collectText)].join(' ');
}

function extractBalancedCall(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `expected ${marker}`);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (!inDouble && !inTemplate && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && !inTemplate && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && ch === '`') { inTemplate = !inTemplate; continue; }
    if (inSingle || inDouble || inTemplate) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        const end = src[i + 1] === ';' ? i + 2 : i + 1;
        return src.slice(start, end);
      }
    }
  }
  throw new Error(`unterminated call for ${marker}`);
}

test('desktop releaseGates exports frozen HANDOFF_PAIRING=false in both CommonJS and browser globals', () => {
  assert.equal(releaseGates.HANDOFF_PAIRING, false);
  assert.equal(typeof releaseGates.HANDOFF_UNAVAILABLE_MESSAGE, 'string');
  assert.ok(releaseGates.HANDOFF_UNAVAILABLE_MESSAGE.length > 0);
  assert.equal(Object.isFrozen(releaseGates), true);

  const src = fs.readFileSync(path.join(root, 'releaseGates.js'), 'utf8');
  const browserSandbox = {};
  browserSandbox.globalThis = browserSandbox;
  vm.runInNewContext(src, browserSandbox);
  assert.equal(browserSandbox.ReleaseGates.HANDOFF_PAIRING, false);
  assert.equal(browserSandbox.ReleaseGates.HANDOFF_UNAVAILABLE_MESSAGE, releaseGates.HANDOFF_UNAVAILABLE_MESSAGE);
});

test('desktop renderer-handoff.js hides #handoff-pairing, collapses it, and never mounts real HandoffUI or polls when gated off or in preview mode', () => {
  const rendererSrc = fs.readFileSync(path.join(root, 'renderer-handoff.js'), 'utf8');
  const handoffUiSrc = fs.readFileSync(path.join(root, 'handoff-ui.js'), 'utf8');
  const handoffCss = fs.readFileSync(path.join(root, 'handoff.css'), 'utf8');
  assert.match(handoffCss, /#handoff-pairing\[hidden\]\s*\{\s*display:\s*none\s*!important\s*\}/);

  function runDesktopRenderer({ gates, hasApi = true }) {
    const section = createFakeElement('handoff-pairing', 'details');
    section.hidden = false;
    section.open = true;
    const body = createFakeElement('handoff-body', 'div');
    let ipcCalls = 0;
    const intervals = [];
    const cleared = [];
    const sandbox = {
      window: {},
      document: {
        hidden: false,
        getElementById: (id) => (id === 'handoff-pairing' ? section : id === 'handoff-body' ? body : null),
        createElement: (tag) => createFakeElement('', tag),
        createTextNode: (text) => ({ textContent: text })
      },
      api: hasApi ? { handoffAction: () => { ipcCalls++; return Promise.resolve({ ok: false, error: releaseGates.HANDOFF_UNAVAILABLE_MESSAGE }); } } : {},
      Promise,
      Error,
      Map,
      Set,
      Date,
      JSON,
      setInterval: (_fn, ms) => { const id = intervals.length + 1; intervals.push({ id, ms }); return id; },
      clearInterval: (id) => { cleared.push(id); }
    };
    sandbox.globalThis = sandbox;
    if (gates !== undefined) sandbox.ReleaseGates = gates;
    vm.runInNewContext(handoffUiSrc, sandbox);
    vm.runInNewContext(rendererSrc, sandbox);
    return { section, body, sandbox, ipcCalls: () => ipcCalls, intervals, cleared };
  }

  // 1. Shipping default: HANDOFF_PAIRING = false.
  const gatedOff = runDesktopRenderer({ gates: releaseGates, hasApi: true });
  assert.equal(gatedOff.section.hidden, true, '#handoff-pairing must stay hidden when gated off');
  assert.equal(gatedOff.section.open, false, '#handoff-pairing must collapse when gated off');
  assert.equal(gatedOff.body.children.length, 0, '#handoff-body must remain empty when gated off');
  assert.doesNotMatch(collectText(gatedOff.body), /Loading local pairing/);
  assert.equal(gatedOff.ipcCalls(), 0, 'handoffAction IPC must not be invoked when gated off');
  assert.equal(gatedOff.intervals.length, 0, 'no polling interval may start when gated off');
  assert.equal(gatedOff.sandbox.window.handoffUI, undefined);

  // 2. Fail-closed when ReleaseGates global is absent.
  const missingGlobal = runDesktopRenderer({ gates: undefined, hasApi: true });
  assert.equal(missingGlobal.section.hidden, true);
  assert.equal(missingGlobal.section.open, false);
  assert.equal(missingGlobal.ipcCalls(), 0);
  assert.equal(missingGlobal.intervals.length, 0);

  // 3. Browser preview mode (no api.handoffAction) must stay hidden even if gate is true.
  const previewMode = runDesktopRenderer({ gates: { HANDOFF_PAIRING: true }, hasApi: false });
  assert.equal(previewMode.section.hidden, true, 'browser preview must not show an empty #handoff-pairing card');
  assert.equal(previewMode.section.open, false);
  assert.equal(previewMode.intervals.length, 0);
  assert.equal(previewMode.sandbox.window.handoffUI, undefined);

  // 4. Enabled with native api mounts cleanly and stops polling on destroy().
  const enabled = runDesktopRenderer({ gates: { HANDOFF_PAIRING: true }, hasApi: true });
  assert.equal(enabled.section.hidden, false);
  assert.ok(enabled.sandbox.window.handoffUI);
  assert.equal(enabled.intervals.length, 1);
  assert.equal(enabled.intervals[0].ms, 2000);
  enabled.sandbox.window.handoffUI.destroy();
  assert.deepEqual(enabled.cleared, [enabled.intervals[0].id]);
});

test('desktop main.js leaves handoffService unconfigured and refuses every handoff-action IPC call when gated off', () => {
  // Fresh handoffService instance must fail closed if configure() is never called.
  const servicePath = require.resolve('../handoffService');
  delete require.cache[servicePath];
  const freshService = require('../handoffService');
  assert.throws(() => freshService.get(), /Pairing authority is unavailable/);
  assert.doesNotThrow(() => freshService.close());

  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  // Verify the startup block in main.js does not configure handoffService or hook before-quit when HANDOFF_PAIRING is false.
  const startupStart = mainSrc.indexOf('if (releaseGates.HANDOFF_PAIRING) {');
  assert.ok(startupStart >= 0, 'main.js must guard handoffService startup with releaseGates.HANDOFF_PAIRING');
  const startupEnd = mainSrc.indexOf('\n}', startupStart) + 2;
  const startupBlock = mainSrc.slice(startupStart, startupEnd);
  let configureCalls = 0;
  let beforeQuitHooks = 0;
  vm.runInNewContext(startupBlock, {
    releaseGates,
    handoffService: { configure: () => { configureCalls++; }, close: () => {} },
    app: { on: () => { beforeQuitHooks++; }, getPath: () => '' },
    path,
    routineFiles: {},
    require: () => { throw new Error('handoffController must not be required when gated off'); }
  });
  assert.equal(configureCalls, 0);
  assert.equal(beforeQuitHooks, 0);

  // Verify ipcMain.handle('handoff-action', ...) rejects every operation before sender/options validation or handoffService.get().
  const handlerRegistration = extractBalancedCall(mainSrc, "ipcMain.handle('handoff-action'");
  let registeredHandler = null;
  let serviceGetCalls = 0;
  const mainWebContents = { mainFrame: {} };
  const sandbox = {
    ipcMain: { handle: (_ch, fn) => { registeredHandler = fn; } },
    releaseGates,
    mainWindow: { webContents: mainWebContents },
    handoffService: {
      get: () => {
        serviceGetCalls++;
        throw new Error('handoffService.get must never be called when gated off');
      }
    }
  };
  vm.runInNewContext(handlerRegistration, sandbox);
  assert.equal(typeof registeredHandler, 'function');

  const actions = [
    'status', 'setup', 'replace', 'invite', 'open', 'listen', 'connect',
    'disconnect', 'approve', 'reject', 'revoke', 'receive', 'offer',
    'accept', 'rejectOffer', 'save', 'dismiss'
  ];
  for (const action of actions) {
    const res = registeredHandler(
      { sender: mainWebContents, senderFrame: mainWebContents.mainFrame },
      action,
      { confirmed: true }
    );
    assert.deepEqual({ ...res }, { ok: false, error: releaseGates.HANDOFF_UNAVAILABLE_MESSAGE });
  }
  // Missing options or untrusted event also fail closed with the gate message.
  assert.deepEqual(
    { ...registeredHandler({ sender: null, senderFrame: null }, 'status', undefined) },
    { ok: false, error: releaseGates.HANDOFF_UNAVAILABLE_MESSAGE }
  );
  assert.equal(serviceGetCalls, 0);
});

test('Android home.js hides #handoff-pairing and never mounts real HandoffUI, calls handoff bridge, or starts polling when gated off', async () => {
  const androidRoot = path.join(repoRoot, 'companion-android', 'app', 'src', 'main');
  const html = fs.readFileSync(path.join(androidRoot, 'assets', 'phone', 'index.html'), 'utf8');
  const manifest = fs.readFileSync(path.join(androidRoot, 'AndroidManifest.xml'), 'utf8');
  const homeJs = fs.readFileSync(path.join(androidRoot, 'assets', 'phone', 'home.js'), 'utf8');
  const handoffUiJs = fs.readFileSync(path.join(androidRoot, 'assets', 'phone', 'handoff-ui.js'), 'utf8');
  const releaseGatesKt = fs.readFileSync(path.join(androidRoot, 'java', 'com', 'lightsout', 'companion', 'ReleaseGates.kt'), 'utf8');

  assert.match(releaseGatesKt, /const val HANDOFF_PAIRING = false/);
  assert.match(html, /<details class="control-card" id="handoff-pairing" hidden>/);
  assert.equal(manifest.includes('android:scheme="lightsout-handoff"'), false);

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, createFakeElement(id));
    return elements.get(id);
  };
  const handoffSection = getEl('handoff-pairing');
  handoffSection.hidden = true;
  const handoffBody = getEl('handoff-body');

  const postedMessages = [];
  const intervals = [];
  const clearedIntervals = [];

  const sandbox = {
    window: {
      phoneUI: { error() {} },
      phoneNative: { postMessage: (msg) => { postedMessages.push(JSON.parse(msg)); } },
      RoutineModel: { fromPhoneRoutine: () => ({}) }
    },
    document: {
      hidden: false,
      getElementById: getEl,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => createFakeElement('', tag),
      createTextNode: (text) => ({ textContent: text })
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
    setInterval: (_fn, ms) => { const id = intervals.length + 1; intervals.push({ id, ms }); return id; },
    clearInterval: (id) => { clearedIntervals.push(id); }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(handoffUiJs, sandbox);
  vm.runInNewContext(homeJs, sandbox);

  assert.equal(handoffSection.hidden, true);
  assert.equal(handoffSection.open, false);
  assert.equal(handoffBody.children.length, 0);
  assert.doesNotMatch(collectText(handoffBody), /Loading local pairing/);
  assert.equal(intervals.length, 0);
  assert.equal(postedMessages.filter(m => m.action === 'handoff').length, 0);
  assert.equal(sandbox.window.handoffUI, undefined);

  // Update with explicit handoffPairing: false AND omitted handoffPairing must both remain gated off.
  sandbox.window.phoneHome.update({ exact: true, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [], handoffPairing: false });
  sandbox.window.phoneHome.update({ exact: true, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [] });
  assert.equal(handoffSection.hidden, true);
  assert.equal(handoffSection.open, false);
  assert.equal(handoffBody.children.length, 0);
  assert.equal(intervals.length, 0);
  assert.equal(postedMessages.filter(m => m.action === 'handoff').length, 0);

  // Flipping handoffPairing: true mounts real HandoffUI once (starting its 2000ms poll);
  // re-sending true does not double-mount; flipping back to false destroys it and clears the timer/DOM/class.
  sandbox.window.phoneHome.update({ exact: true, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [], handoffPairing: true });
  await new Promise(resolve => setImmediate(resolve));
  handoffSection.open = true;
  assert.equal(handoffSection.hidden, false);
  assert.ok(sandbox.window.handoffUI);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 2000);
  assert.equal(handoffBody.classList.contains('handoff-panel'), true);
  assert.match(collectText(handoffBody), /Loading local pairing/);
  assert.equal(postedMessages.filter(m => m.action === 'handoff').length, 1);
  assert.equal(postedMessages.filter(m => m.action === 'handoff')[0].operation, 'status');

  sandbox.window.phoneHome.update({ exact: true, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [], handoffPairing: true });
  assert.equal(intervals.length, 1);

  sandbox.window.phoneHome.update({ exact: true, home: { lights: [], routines: [], rules: [] }, upcoming: [], routineOutcomes: [], handoffPairing: false });
  assert.equal(handoffSection.hidden, true);
  assert.equal(handoffSection.open, false);
  assert.deepEqual(clearedIntervals, [intervals[0].id]);
  assert.equal(sandbox.window.handoffUI, null);
  assert.equal(handoffBody.classList.contains('handoff-panel'), false);
  assert.equal(handoffBody.children.length, 0);
});
