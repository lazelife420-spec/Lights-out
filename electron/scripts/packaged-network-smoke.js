'use strict';

const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..', '..');
const executable = path.join(root, 'dist', 'win-unpacked', 'Lights Out.exe');
const ssid = 'BMW ONLY! 5G';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function waitFor(fn, timeoutMs = 30000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error('Timed out waiting for packaged network transition');
}

class CdpClient {
  constructor(url) {
    this.socket = new globalThis.WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = message.id && this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timeout); resolve(value); },
        reject: error => { clearTimeout(timeout); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed');
    return response.result.value;
  }
  close() { this.socket.close(); }
}

async function netsh(...args) {
  const result = await execFileAsync('netsh.exe', ['wlan', ...args], { timeout: 20000, windowsHide: true });
  return result.stdout;
}

async function interfaceState(name) {
  const output = await netsh('show', 'interfaces');
  const blocks = output.split(/\r?\n\s*\r?\n/);
  const block = blocks.find(item => new RegExp(`Name\\s*:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(item));
  if (!block) return null;
  return {
    state: (/State\s*:\s*(.+)/i.exec(block)?.[1] || '').trim().toLowerCase(),
    ssid: (/^\s*SSID\s*:\s*(.+)$/mi.exec(block)?.[1] || '').trim()
  };
}

async function connectAdapter(name) {
  await netsh('connect', `name=${ssid}`, `interface=${name}`);
  await waitFor(async () => (await interfaceState(name))?.state === 'connected', 30000, 500);
}

async function disconnectAdapter(name) {
  await netsh('disconnect', `interface=${name}`);
  await waitFor(async () => (await interfaceState(name))?.state === 'disconnected', 20000, 500);
}

async function main() {
  assert.ok(fs.existsSync(executable));
  assert.equal((await interfaceState('Wi-Fi 2'))?.state, 'connected');
  assert.equal((await interfaceState('Wi-Fi'))?.state, 'disconnected');

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-network-gate-'));
  const debugPort = await freePort();
  let child;
  let cdp;
  let secondaryConnected = false;
  try {
    await connectAdapter('Wi-Fi');
    secondaryConnected = true;

    child = spawn(executable, [
      '--no-auto-start',
      `--user-data-dir=${userData}`,
      `--remote-debugging-port=${debugPort}`
    ], { cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore' });
    const target = await waitFor(async () => {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      return targets.find(item => item.type === 'page' && /index\.html/.test(item.url));
    }, 20000);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await waitFor(() => cdp.evaluate(`typeof electronAPI === 'object'`));
    await cdp.evaluate(`window.__networkGateEvents = []; electronAPI.onRemoteControlStatus(state => window.__networkGateEvents.push({ ready: state.ready, failed: state.failed, lanIp: state.lanIp, url: state.url })); true`);

    const initialRemote = await cdp.evaluate(`electronAPI.getRemoteControl()`);
    assert.equal(initialRemote.port, 58732, 'production default companion port must remain 58732');

    // The product default (58732) is not guaranteed bindable on every Windows
    // machine -- Hyper-V/WinNAT dynamically reserve ranges that can include
    // it. setRemoteControlMode does not reset a previously-set port, so
    // picking an OS-assigned ephemeral port here keeps this test immune to
    // that class of failure. Production's own default stays 58732.
    const testPort = await freePort();
    await cdp.evaluate(`electronAPI.setRemoteControlPort(${testPort})`);

    const initial = await cdp.evaluate(`electronAPI.setRemoteControlMode('wifi')`);
    assert.equal(initial.ready, true);
    assert.match(initial.lanIp, /^192\.168\.0\.(11|16)$/);
    const hostA = initial.lanIp;
    const activeAdapter = hostA === '192.168.0.16' ? 'Wi-Fi' : 'Wi-Fi 2';
    const remainingAdapter = activeAdapter === 'Wi-Fi' ? 'Wi-Fi 2' : 'Wi-Fi';

    await disconnectAdapter(activeAdapter);
    if (activeAdapter === 'Wi-Fi') secondaryConnected = false;
    const switched = await waitFor(async () => {
      const state = await cdp.evaluate(`electronAPI.getRemoteControl()`);
      return state.ready && state.lanIp !== hostA ? state : null;
    }, 30000);
    assert.match(switched.lanIp, /^192\.168\.0\.\d+$/);
    assert.doesNotMatch(switched.url, new RegExp(hostA.replace(/\./g, '\\.')));
    await cdp.evaluate(`(async () => { renderRemoteControl(await electronAPI.getRemoteControl()); return true; })()`);
    const rendered = await cdp.evaluate(`document.getElementById('remote-url').textContent`);
    assert.match(rendered, new RegExp(switched.lanIp.replace(/\./g, '\\.')));
    assert.doesNotMatch(rendered, new RegExp(hostA.replace(/\./g, '\\.')));
    const transitions = await cdp.evaluate(`window.__networkGateEvents`);
    assert.ok(transitions.some(event => !event.ready && !event.url));

    await disconnectAdapter(remainingAdapter);
    if (remainingAdapter === 'Wi-Fi') secondaryConnected = false;
    const offline = await waitFor(async () => {
      const state = await cdp.evaluate(`electronAPI.getRemoteControl()`);
      return state.failed && !state.ready ? state : null;
    }, 30000);
    assert.equal(offline.errorCode, 'NO_LAN_ADDRESS');
    assert.equal(offline.url, '');
    assert.equal(offline.shortCode, '');

    await connectAdapter('Wi-Fi 2');
    const restored = await waitFor(async () => {
      const state = await cdp.evaluate(`electronAPI.getRemoteControl()`);
      return state.ready && state.lanIp === '192.168.0.11' ? state : null;
    }, 30000);
    assert.equal(restored.url.includes(restored.lanIp), true);

    const local = await cdp.evaluate(`electronAPI.setRemoteControlMode('local')`);
    assert.equal(local.ready, true);
    assert.match(local.url, new RegExp(`^http://127\\.0\\.0\\.1:${testPort}/`));
    const off = await cdp.evaluate(`electronAPI.setRemoteControlMode('off')`);
    assert.equal(off.running, false);
    assert.equal(off.ready, false);
    assert.equal(off.url, '');
    assert.equal(off.shortCode, '');

    console.log(JSON.stringify({
      packaged: true,
      productionDefaultPort: initialRemote.port,
      multipleAdapters: true,
      addressA: hostA,
      addressB: switched.lanIp,
      startingTransitionObserved: true,
      staleAddressRemoved: true,
      noLanAddress: { failed: true, credentialsHidden: true },
      networkReturn: { ready: true, address: restored.lanIp },
      loopbackOnly: { ready: true, host: '127.0.0.1' },
      off: { listener: false, pairingData: false },
      originalAdaptersRestored: true,
      powerActions: 0
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    if (child) {
      try { child.kill(); } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
      await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    }
    await connectAdapter('Wi-Fi 2').catch(() => {});
    if (secondaryConnected || (await interfaceState('Wi-Fi'))?.state === 'connected') {
      await disconnectAdapter('Wi-Fi').catch(() => {});
    }
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
