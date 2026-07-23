'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const test = require('node:test');
const os = require('node:os');
const path = require('node:path');
const {
  assertOwnedEndpoint,
  exerciseMenuContract,
  waitForAuthoritativeReadiness
} = require('../scripts/packaged-proof-readiness');
const {
  applySensitiveDomRedaction,
  attachCleanupDiagnostics,
  cleanupOwnedResources,
  isPortFree,
  sanitizeText,
  selectOwnedProcessTree,
  verifyOwnedCleanup
} = require('../scripts/proof-lifecycle');

const ready = generation => ({
  generation,
  documentReadyState: 'complete',
  proofExists: true,
  proofReady: true,
  menusReady: true,
  openModal: null
});

test('packaged proof waits through delayed renderer initialization', async () => {
  const states = [
    { ...ready('a'), proofReady: false, menusReady: false },
    { ...ready('a'), menusReady: false },
    ready('a'),
    ready('a')
  ];
  const result = await waitForAuthoritativeReadiness(
    async () => states.shift() || ready('a'),
    { intervalMs: 0, sleep: async () => {} }
  );
  assert.equal(result.generation, 'a');
});

test('packaged proof rejects stale generation and confirms the replacement', async () => {
  const states = [
    ready('old'),
    { ...ready('new'), proofReady: false },
    ready('new'),
    ready('new')
  ];
  const result = await waitForAuthoritativeReadiness(
    async () => states.shift() || ready('new'),
    { intervalMs: 0, sleep: async () => {} }
  );
  assert.equal(result.generation, 'new');
});

test('packaged proof cannot attach to the wrong CDP listener process', () => {
  assert.throws(() => assertOwnedEndpoint({
    spawnedPid: 100,
    listeningPid: 200,
    expectedExecutable: 'C:\\app\\Lights Out.exe',
    actualExecutable: 'C:\\app\\Lights Out.exe',
    expectedUserData: 'C:\\temp\\profile',
    commandLine: '"C:\\app\\Lights Out.exe" --user-data-dir=C:\\temp\\profile'
  }), /different process/);
});

test('menu interaction starts only after readiness and proves open, pointer, Escape, and focus', async () => {
  const actions = [];
  let state = {
    connected: true,
    visible: true,
    enabled: true,
    ariaExpanded: 'false',
    open: false,
    menuVisible: false,
    focusedId: null
  };
  const result = await exerciseMenuContract({
    menuId: 'menu-power',
    readReadiness: async () => {
      actions.push('ready');
      return { menusReady: true };
    },
    readMenu: async () => ({ ...state }),
    clickTrigger: async () => {
      actions.push('click');
      state = { ...state, ariaExpanded: 'true', open: true, menuVisible: true, focusedId: 'first-item' };
    },
    moveToFirstItem: async () => actions.push('move'),
    pressEscape: async () => {
      actions.push('escape');
      state = { ...state, ariaExpanded: 'false', open: false, menuVisible: false, focusedId: 'menu-power' };
    },
    full: true
  });
  assert.deepEqual(actions, ['ready', 'click', 'move', 'escape']);
  assert.equal(result.opened.open, true);
  assert.equal(result.pointerTransfer.open, true);
  assert.equal(result.closed.focusedId, 'menu-power');
});

test('handled menu keys do not invoke timer shortcuts', async () => {
  let timerStarts = 0;
  let state = {
    connected: true,
    visible: true,
    enabled: true,
    ariaExpanded: 'false',
    open: false,
    menuVisible: false,
    focusedId: null
  };
  await exerciseMenuContract({
    menuId: 'menu-help',
    readReadiness: async () => ({ menusReady: true }),
    readMenu: async () => ({ ...state }),
    clickTrigger: async () => {
      state = { ...state, ariaExpanded: 'true', open: true, menuVisible: true };
    },
    moveToFirstItem: async () => {},
    pressEscape: async () => {
      state = { ...state, ariaExpanded: 'false', open: false, menuVisible: false, focusedId: 'menu-help' };
    }
  });
  assert.equal(timerStarts, 0);
});

function emptyResources() {
  return {
    tempProfile: null,
    tempProfileOriginal: null,
    blocker: null,
    blockerPort: null,
    cdpPort: null,
    appProcess: null,
    originalAppPid: null,
    browser: null,
    firewallRuleNames: [],
    firewallRuleNamesAtCleanup: [],
    diagnosticStaging: null,
    diagnosticStagingOriginal: null,
    ownedPids: []
  };
}

function acquireProfile(resources) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-lifecycle-test-'));
  resources.tempProfile = profile;
  resources.tempProfileOriginal = profile;
  return profile;
}

async function acquireListener(resources) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  resources.blocker = server;
  resources.blockerPort = server.address().port;
  return resources.blockerPort;
}

async function acquireChild(resources) {
  const ownershipToken = `lightsout-proof-owner-${randomUUID()}`;
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ownershipToken], {
    windowsHide: true,
    stdio: 'ignore'
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  resources.originalAppPid = child.pid;
  resources.appProcess = {
    child,
    pid: child.pid,
    executable: process.execPath,
    ownershipToken,
    startedAt: Date.now()
  };
  return child.pid;
}

async function failWithCleanup(resources, acquire, adapters = {}) {
  const original = new Error('controlled primary proof error');
  let primary;
  try {
    await acquire();
    throw original;
  } catch (error) {
    primary = error;
  }
  resources.firewallRuleNamesAtCleanup = resources.firewallRuleNames.slice();
  const cleanup = await cleanupOwnedResources(resources, adapters);
  const verification = await verifyOwnedCleanup(resources, adapters);
  if (primary) throw attachCleanupDiagnostics(primary, cleanup, verification);
}

test('profile-created failure removes the real temporary directory', async () => {
  const resources = emptyResources();
  let profile;
  await assert.rejects(
    failWithCleanup(resources, async () => { profile = acquireProfile(resources); }),
    error => error.message.startsWith('controlled primary proof error')
  );
  assert.equal(fs.existsSync(profile), false);
});

test('listener-created failure releases a real loopback port for immediate reuse', async () => {
  const resources = emptyResources();
  let port;
  await assert.rejects(
    failWithCleanup(resources, async () => { port = await acquireListener(resources); }),
    error => error.message.startsWith('controlled primary proof error')
  );
  assert.equal(await isPortFree(port), true);
});

test('child-process failure terminates the owned process', async () => {
  const resources = emptyResources();
  let pid;
  await assert.rejects(
    failWithCleanup(resources, async () => { pid = await acquireChild(resources); }),
    error => error.message.startsWith('controlled primary proof error')
  );
  assert.throws(() => process.kill(pid, 0));
});

test('combined partial initialization cleans profile, listener, and child', async () => {
  const resources = emptyResources();
  let profile;
  let port;
  let pid;
  await assert.rejects(
    failWithCleanup(resources, async () => {
      profile = acquireProfile(resources);
      port = await acquireListener(resources);
      pid = await acquireChild(resources);
    }),
    error => error.message.startsWith('controlled primary proof error')
  );
  assert.equal(fs.existsSync(profile), false);
  assert.equal(await isPortFree(port), true);
  assert.throws(() => process.kill(pid, 0));
});

test('cleanup errors are secondary and do not stop remaining cleanup', async () => {
  const resources = emptyResources();
  let profile;
  let port;
  const original = new Error('original proof failure stays primary');
  let primary = original;
  profile = acquireProfile(resources);
  port = await acquireListener(resources);
  const cleanup = await cleanupOwnedResources(resources, {
    closeServer: async server => {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      throw new Error('controlled cleanup warning');
    }
  });
  const verification = await verifyOwnedCleanup(resources);
  primary = attachCleanupDiagnostics(primary, cleanup, verification);
  assert.equal(primary, original);
  assert.match(primary.message, /^original proof failure stays primary/);
  assert.match(primary.message, /controlled cleanup warning/);
  assert.equal(fs.existsSync(profile), false);
  assert.equal(await isPortFree(port), true);
});

test('firewall cleanup dispatcher removes only exact owned rule names', async () => {
  const resources = emptyResources();
  const rules = new Set(['proof-rule-a', 'proof-rule-b', 'unrelated-rule']);
  resources.firewallRuleNames = ['proof-rule-a', 'proof-rule-b'];
  resources.firewallRuleNamesAtCleanup = resources.firewallRuleNames.slice();
  const adapters = {
    removeFirewallRules: async names => names.forEach(name => rules.delete(name)),
    countFirewallRules: async names => names.filter(name => rules.has(name)).length
  };
  const cleanup = await cleanupOwnedResources(resources, adapters);
  const verification = await verifyOwnedCleanup(resources, adapters);
  assert.deepEqual(cleanup.errors, []);
  assert.equal(verification.ok, true);
  assert.deepEqual([...rules], ['unrelated-rule']);
});

test('owned process tree excludes stale parent-PID collisions from before the proof run', () => {
  const startedAt = 50_000;
  const processes = [
    { pid: 100, parentPid: 1, creationTime: 50_100 },
    { pid: 101, parentPid: 100, creationTime: 50_200 },
    { pid: 102, parentPid: 101, creationTime: 50_300 },
    { pid: 900, parentPid: 101, creationTime: 10_000 }
  ];
  assert.deepEqual(selectOwnedProcessTree(processes, 100, startedAt), [100, 101, 102]);
});

class FakeElement {
  constructor({ text = '', html = '', value } = {}) {
    this._textContent = '';
    this._innerHTML = '';
    if (html) this.innerHTML = html;
    else this.textContent = text;
    this.attributes = new Map();
    if (value !== undefined) this.value = value;
  }
  get textContent() { return this._textContent; }
  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = String(value);
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this._textContent = String(value).replace(/<[^>]*>/g, '');
  }
  replaceChildren() { this.innerHTML = ''; this.textContent = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
}

test('failure evidence masks QR, URL/token, and short code, then restores the DOM', () => {
  const fakeUrl = 'http://192.168.0.16:62731/?t=SECRET_TOKEN';
  const fakeCode = 'FAKE-SHORT-4821';
  const qr = new FakeElement({ html: '<canvas>FAKE_QR_PAYLOAD</canvas>' });
  const url = new FakeElement({ text: fakeUrl });
  const code = new FakeElement({ text: fakeCode });
  const tokenInput = new FakeElement({ value: 'SECRET_TOKEN' });
  const normal = new FakeElement({ text: 'Normal status label' });
  const matches = new Map([
    ['#remote-qr-wrap', [qr]],
    ['#remote-url', [url]],
    ['#remote-short-code', [code]],
    ['input[id*="token" i]', [tokenInput]]
  ]);
  const documentRef = { querySelectorAll: selector => matches.get(selector) || [] };
  let captured;
  let handle;
  try {
    handle = applySensitiveDomRedaction(documentRef);
    assert.equal(handle.confirmed, true);
    assert.equal(handle.qrMasked, true);
    assert.match(qr.getAttribute('style'), /background:#000!important/);
    captured = [qr.textContent, qr.innerHTML, url.textContent, code.textContent, tokenInput.value, normal.textContent].join('|');
    throw new Error('controlled screenshot failure');
  } catch (error) {
    assert.match(error.message, /controlled screenshot failure/);
    assert.doesNotMatch(captured, /SECRET_TOKEN|FAKE-SHORT-4821|FAKE_QR_PAYLOAD/);
    assert.match(captured, /Normal status label/);
  } finally {
    handle.restore();
  }
  assert.equal(url.textContent, fakeUrl);
  assert.equal(code.textContent, fakeCode);
  assert.equal(tokenInput.value, 'SECRET_TOKEN');
  assert.equal(qr.innerHTML, '<canvas>FAKE_QR_PAYLOAD</canvas>');
  assert.equal(sanitizeText(fakeUrl), '[REDACTED_PAIRING_URL]');
});
