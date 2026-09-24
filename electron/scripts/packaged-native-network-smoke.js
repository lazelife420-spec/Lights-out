'use strict';

const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { discoverAdapterRoles, readWindowsAdapterInventory } = require('./adapterRoles');
const companionNetwork = require('../companionNetwork');
const { requirePackagedArtifact } = require('./packaged-artifact-resolver');

const execFileAsync = promisify(execFile);
const { executable } = requirePackagedArtifact();

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

// Confirms nothing is bound to `port` right now -- used post-cleanup instead
// of parsing netstat output.
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', err => reject(new Error(`port ${port} still bound after cleanup: ${err.message}`)));
    server.listen(port, '0.0.0.0', () => server.close(() => resolve()));
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
  throw lastError || new Error('Timed out waiting for packaged network readiness');
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

async function firewallSnapshot() {
  const command = `$rules = @(Get-NetFirewallRule -Group 'Lights Out Companion' -ErrorAction SilentlyContinue); @($rules | ForEach-Object { $app = $_ | Get-NetFirewallApplicationFilter; $port = $_ | Get-NetFirewallPortFilter; [pscustomobject]@{ Name = $_.Name; Profile = [string]$_.Profile; Direction = [string]$_.Direction; Action = [string]$_.Action; Program = $app.Program; Protocol = [string]$port.Protocol; LocalPort = [string]$port.LocalPort } }) | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000 });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// Read-only observation of the machine's real adapters, classified by role
// (connected/disconnected, physical/virtual, default-route) rather than by
// Windows display name. Never issues a connect/disconnect/enable/disable
// call -- this test uses whatever the machine is already doing right now.
async function observeRealAdapterRoles() {
  const inventory = await readWindowsAdapterInventory({ getRoutedLanIp: companionNetwork.getDefaultRouteLanIp });
  const roles = discoverAdapterRoles(inventory);
  console.log('Connected test adapter:');
  if (roles.connectedAdapter) {
    const a = roles.connectedAdapter;
    console.log(`  - name: ${a.name}\n  - interface index: ${a.index}\n  - status: ${a.status}\n  - IPv4: ${a.ipv4}`);
  } else {
    console.log('  - none found');
  }
  console.log('Disconnected test adapter:');
  if (roles.disconnectedAdapter) {
    const a = roles.disconnectedAdapter;
    console.log(`  - name: ${a.name}\n  - interface index: ${a.index}\n  - status: ${a.status}`);
  } else {
    console.log('  - none found (machine has only one usable adapter right now -- not a failure)');
  }
  return roles;
}

async function main() {
  assert.ok(fs.existsSync(executable));

  const roles = await observeRealAdapterRoles();
  assert.ok(roles.connectedAdapter, 'no connected LAN-capable adapter found on this machine -- cannot run the packaged network gate');
  const expectedLanIp = roles.connectedAdapter.ipv4;
  if (roles.disconnectedAdapter) {
    assert.notEqual(roles.disconnectedAdapter.ipv4, expectedLanIp, 'disconnected adapter must never share the selected LAN IP');
  }

  const firewallBefore = await firewallSnapshot();
  assert.equal(firewallBefore.length, 0, 'no Lights Out Companion firewall rule should exist before the app has run');

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-network-gate-'));
  const debugPort = await freePort();
  let child;
  let cdp;
  let testPort;
  try {
    child = spawn(executable, [
      '--no-auto-start',
      `--user-data-dir=${userData}`,
      `--remote-debugging-port=${debugPort}`
    ], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1' }
    });
    const target = await waitFor(async () => {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      return targets.find(item => item.type === 'page' && /index\.html/.test(item.url));
    }, 20000);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await waitFor(() => cdp.evaluate(`typeof electronAPI === 'object'`));

    const initialRemote = await cdp.evaluate(`electronAPI.getRemoteControl()`);
    assert.equal(initialRemote.port, 58732, 'production default companion port must remain 58732');

    // The product default (58732) is not guaranteed bindable on every Windows
    // machine -- Hyper-V/WinNAT dynamically reserve ranges that can include
    // it. setRemoteControlMode does not reset a previously-set port, so
    // picking an OS-assigned ephemeral port here keeps this test immune to
    // that class of failure. Production's own default stays 58732.
    testPort = await freePort();
    await cdp.evaluate(`electronAPI.setRemoteControlPort(${testPort})`);

    // Role grounding: the app must land on the real connected adapter's IP,
    // regardless of what Windows happens to call that adapter.
    const wifi = await cdp.evaluate(`electronAPI.setRemoteControlMode('wifi')`);
    assert.equal(wifi.ready, true);
    assert.equal(wifi.lanIp, expectedLanIp, `app selected ${wifi.lanIp}, expected the role-selected connected adapter's IP ${expectedLanIp}`);
    assert.match(wifi.url, new RegExp(`^http://${expectedLanIp.replace(/\./g, '\\.')}:${testPort}/`));

    await cdp.evaluate(`(async () => { renderRemoteControl(await electronAPI.getRemoteControl()); return true; })()`);
    const rendered = await cdp.evaluate(`document.getElementById('remote-url').textContent`);
    assert.match(rendered, new RegExp(expectedLanIp.replace(/\./g, '\\.')), 'rendered QR/manual URL must use the selected adapter\'s current address');

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
      connectedAdapter: { name: roles.connectedAdapter.name, index: roles.connectedAdapter.index, ipv4: roles.connectedAdapter.ipv4 },
      disconnectedAdapter: roles.disconnectedAdapter
        ? { name: roles.disconnectedAdapter.name, index: roles.disconnectedAdapter.index, status: roles.disconnectedAdapter.status }
        : null,
      roleSelectionUsedDisplayName: false,
      wifiMode: { ready: true, address: wifi.lanIp },
      localMode: { ready: true, host: '127.0.0.1' },
      off: { listener: false, pairingData: false },
      physicalAdaptersModified: false,
      powerActions: 0
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    if (child) {
      try { child.kill(); } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
      await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    }
    fs.rmSync(userData, { recursive: true, force: true });
  }

  await new Promise(resolve => setTimeout(resolve, 500));
  if (testPort) await assertPortFree(testPort);
  const firewallAfter = await firewallSnapshot();
  assert.equal(firewallAfter.length, 0, 'no Lights Out Companion firewall rule should survive app quit');
  console.log('Listener cleanup: confirmed. Firewall cleanup: confirmed.');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
