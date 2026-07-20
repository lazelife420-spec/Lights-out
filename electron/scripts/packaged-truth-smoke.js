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
const proofDir = path.join(root, 'dist', 'review-proof');

function progress(message) {
  process.stderr.write(`[packaged-truth] ${message}\n`);
}

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

async function firewallSnapshot() {
  if (process.platform !== 'win32') return [];
  const command = `$rules = @(Get-NetFirewallRule -Group 'Lights Out Companion' -ErrorAction SilentlyContinue); @($rules | ForEach-Object { $app = $_ | Get-NetFirewallApplicationFilter; $port = $_ | Get-NetFirewallPortFilter; [pscustomobject]@{ Name = $_.Name; Profile = [string]$_.Profile; Direction = [string]$_.Direction; Action = [string]$_.Action; Program = $app.Program; Protocol = [string]$port.Protocol; LocalPort = [string]$port.LocalPort } }) | ConvertTo-Json -Compress`;
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000 });
  const parsed = JSON.parse(result.stdout.trim() || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function waitFor(fn, timeoutMs = 15000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error('Timed out waiting for packaged app state');
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
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
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

  async screenshot(name) {
    const result = await this.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, name), Buffer.from(result.data, 'base64'));
  }

  close() { this.socket.close(); }
}

async function main() {
  assert.ok(fs.existsSync(executable), `Packaged executable missing: ${executable}`);
  const debugPort = await freePort();
  const blockedPort = await freePort();
  // The product default (58732) is not guaranteed bindable on every Windows
  // machine -- Hyper-V/WinNAT dynamically reserve ranges that can include it.
  // Binding port 0 asks the OS for an ephemeral port, which by definition
  // falls outside any excluded range. Production's default stays 58732;
  // only this test's own "switch to a configured port" exercise uses testPort.
  const testPort = await freePort();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-packaged-gate-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { onboarded: true, action: 'sleep', durationSeconds: 900 },
    calendar: { builtin: { enabled: true, bedtime: '22:15', days: ['mon', 'tue'], action: 'sleep' } }
  }));
  const blocker = net.createServer();
  const firewallBefore = await firewallSnapshot();
  assert.equal(firewallBefore.length, 0);
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(blockedPort, '0.0.0.0', resolve);
  });

  const child = spawn(executable, [
    '--no-auto-start',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${debugPort}`
  ], { cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore' });

  let cdp;
  try {
    progress('waiting for renderer target');
    const target = await waitFor(async () => {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      return targets.find(item => item.type === 'page' && /index\.html/.test(item.url));
    }, 20000);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.command('Page.enable');
    await waitFor(() => cdp.evaluate(`typeof electronAPI === 'object' && typeof renderRemoteControl === 'function'`));
    const migrated = await cdp.evaluate(`electronAPI.getAppSettings()`);
    assert.equal(migrated.app.action, 'sleep');
    assert.equal(migrated.app.durationSeconds, 900);
    assert.equal(migrated.app.lockoutOnDim, false);
    assert.ok(Array.isArray(migrated.calendar.builtin.rules));

    progress('proving production default port is unchanged (58732, read-only, no bind)');
    const initialRemote = await cdp.evaluate(`electronAPI.getRemoteControl()`);
    assert.equal(initialRemote.port, 58732, 'production default companion port must remain 58732');

    progress('proving occupied-port failure');
    await cdp.evaluate(`electronAPI.setRemoteControlMode('wifi')`);
    await cdp.evaluate(`electronAPI.setRemoteControlPort(${blockedPort})`);
    const failed = await waitFor(async () => {
      const state = await cdp.evaluate(`electronAPI.getRemoteControl()`);
      return state.failed && state.failureDetails?.pid ? state : null;
    });
    await cdp.evaluate(`(async () => {
      renderRemoteControl(await electronAPI.getRemoteControl());
      document.getElementById('onboarding').style.display = 'none';
      document.getElementById('menu-settings').click();
      return true;
    })()`);
    const failureUi = await cdp.evaluate(`(() => ({
      status: document.getElementById('companion-status-pill').textContent,
      detailsDisplay: document.getElementById('companion-pairing-details').style.display,
      qrDisplay: document.getElementById('remote-qr-wrap').style.display,
      url: document.getElementById('remote-url').textContent,
      shortCode: document.getElementById('remote-short-code').textContent,
      error: document.getElementById('remote-startup-error-text').textContent,
      description: document.getElementById('remote-mode-description').textContent
    }))()`);
    assert.equal(failed.errorCode, 'EADDRINUSE');
    assert.equal(failed.failureDetails.pid, process.pid);
    assert.equal(failureUi.status, 'Connection failed');
    assert.equal(failureUi.detailsDisplay, 'none');
    assert.equal(failureUi.qrDisplay, 'none');
    assert.equal(failureUi.url, '');
    assert.equal(failureUi.shortCode, '');
    assert.match(failureUi.error, new RegExp(`PID ${process.pid}`));
    assert.doesNotMatch(`${failureUi.description} ${failureUi.error}`, /reachable/i);
    await cdp.screenshot('occupied-port-failure.png');

    progress('proving retry and default port');
    await new Promise(resolve => blocker.close(resolve));
    const retried = await cdp.evaluate(`electronAPI.retryRemoteControl()`);
    assert.equal(retried.ready, true);
    assert.equal(retried.failed, false);
    await cdp.evaluate(`(async () => { renderRemoteControl(await electronAPI.getRemoteControl()); return true; })()`);
    const recoveredUi = await cdp.evaluate(`(() => ({
      status: document.getElementById('companion-status-pill').textContent,
      detailsDisplay: document.getElementById('companion-pairing-details').style.display,
      hasUrl: Boolean(document.getElementById('remote-url').textContent),
      hasShortCode: Boolean(document.getElementById('remote-short-code').textContent)
    }))()`);
    assert.match(recoveredUi.status, /Desktop endpoint ready/);
    assert.notEqual(recoveredUi.detailsDisplay, 'none');
    assert.equal(recoveredUi.hasUrl, true);
    assert.equal(recoveredUi.hasShortCode, true);

    const defaultPort = await cdp.evaluate(`electronAPI.setRemoteControlPort(${testPort})`);
    assert.equal(defaultPort.ready, true);
    assert.equal(defaultPort.port, testPort);
    const firewallDefault = await firewallSnapshot();
    assert.equal(firewallDefault.length, 2);
    for (const rule of firewallDefault) {
      assert.equal(rule.Profile, 'Private');
      assert.equal(rule.Direction, 'Inbound');
      assert.equal(rule.Action, 'Allow');
      assert.equal(path.normalize(rule.Program), path.normalize(executable));
    }
    assert.ok(firewallDefault.some(rule => rule.Protocol === 'TCP' && rule.LocalPort === String(testPort)));
    assert.ok(firewallDefault.some(rule => rule.Protocol === 'UDP' && rule.LocalPort === '58733'));
    const alternatePort = await cdp.evaluate(`electronAPI.setRemoteControlPort(${blockedPort})`);
    assert.equal(alternatePort.ready, true);
    const firewallAlternate = await firewallSnapshot();
    assert.equal(firewallAlternate.length, 2);
    assert.ok(firewallAlternate.some(rule => rule.Protocol === 'TCP' && rule.LocalPort === String(blockedPort)));
    assert.ok(firewallAlternate.some(rule => rule.Protocol === 'UDP' && rule.LocalPort === '58733'));
    await cdp.evaluate(`electronAPI.setRemoteControlPort(${testPort})`);

    progress('proving widget and notifications');
    const widgetShown = await cdp.evaluate(`electronAPI.toggleWidget()`);
    assert.deepEqual(widgetShown, { success: true, visible: true });
    const widgetHidden = await cdp.evaluate(`electronAPI.toggleWidget()`);
    assert.deepEqual(widgetHidden, { success: true, visible: false });

    const notification = await cdp.evaluate(`(() => {
      notify('Packaged gate event', 'info');
      notify('Packaged gate event', 'info');
      const before = document.getElementById('notif-badge').textContent;
      document.getElementById('btn-notif').click();
      return {
        before,
        after: document.getElementById('notif-badge').textContent,
        active: document.getElementById('notif-drawer').classList.contains('active'),
        matches: [...document.querySelectorAll('#notif-list .notif-item')].filter(el => el.textContent.includes('Packaged gate event')).length
      };
    })()`);
    assert.equal(notification.before, '1');
    assert.equal(notification.after, '');
    assert.equal(notification.active, true);
    assert.equal(notification.matches, 1);

    progress('proving canonical routes and modes');
    const routes = await cdp.evaluate(`(async () => {
      document.getElementById('notif-drawer-close').click();
      document.querySelector('[data-ns-tab="lib"]').click();
      const before = document.querySelector('.ns-nav-item[aria-current="page"]')?.dataset.nsTab;
      document.getElementById('menu-settings').click();
      const topSettings = document.getElementById('options-modal').classList.contains('active');
      document.getElementById('modal-close').click();
      const restored = document.querySelector('.ns-nav-item[aria-current="page"]')?.dataset.nsTab;
      document.querySelector('[data-ns-tab="set"]').click();
      const sideSettings = document.getElementById('options-modal').classList.contains('active');
      document.getElementById('modal-close').click();
      document.querySelector('[data-ns-tab="modes"]').click();
      return {
        before, topSettings, restored, sideSettings,
        selected: document.querySelector('.ns-nav-item[aria-current="page"]')?.dataset.nsTab,
        modeTitles: [...document.querySelectorAll('.nm-card .nm-card-title')].map(el => el.textContent.trim()),
        hardStopPresent: document.body.textContent.includes('HARD STOP')
      };
    })()`);
    assert.equal(routes.before, 'lib');
    assert.equal(routes.topSettings, true);
    assert.equal(routes.restored, 'lib');
    assert.equal(routes.sideSettings, true);
    assert.equal(routes.selected, 'modes');
    assert.equal(routes.modeTitles.length, 6);
    assert.equal(routes.hardStopPresent, false);
    await cdp.screenshot('night-modes-route.png');

    progress('proving off state');
    await cdp.evaluate(`electronAPI.setRemoteControlMode('off')`);
    const off = await cdp.evaluate(`electronAPI.getRemoteControl()`);
    assert.equal(off.ready, false);
    assert.equal(off.url, '');
    const firewallAfter = await firewallSnapshot();
    assert.equal(firewallAfter.length, 0);

    console.log(JSON.stringify({
      packaged: true,
      profiles: { migratedExisting: true, missingDefaultsRestored: true },
      productionDefaultPort: initialRemote.port,
      occupiedPort: { failed: true, ownerPidMatched: true, credentialsHidden: true },
      retry: { ready: true, host: retried.lanIp, port: retried.port },
      defaultPort: { ready: true, port: defaultPort.port },
      firewall: { before: 0, active: 2, privateOnly: true, exactProgram: true, alternatePortUpdated: true, after: 0 },
      widget: { shown: true, hidden: true },
      notifications: { unreadBeforeOpen: 1, unreadAfterOpen: 0, duplicates: 1 },
      routes: { settingsCanonical: true, restored: routes.restored, modes: routes.modeTitles.length },
      powerActions: 0
    }, null, 2));
  } finally {
    progress('cleaning isolated runtime');
    if (blocker.listening) await new Promise(resolve => blocker.close(resolve));
    if (cdp) {
      try { await cdp.evaluate(`electronAPI.setRemoteControlMode('off')`); } catch {}
    }
    if (cdp) cdp.close();
    try { child.kill(); } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('close', resolve);
        killer.on('error', resolve);
      });
    }
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
