'use strict';

const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const {
  assertOwnedEndpoint,
  exerciseMenuContract,
  waitForAuthoritativeReadiness
} = require('./packaged-proof-readiness');
const {
  attachCleanupDiagnostics,
  cleanupOwnedResources,
  injectFailure,
  rendererRedactionInstallExpression,
  rendererRedactionRestoreExpression,
  sanitizeValue,
  verifyOwnedCleanup
} = require('./proof-lifecycle');

const execFileAsync = promisify(execFile);

const root = path.resolve(__dirname, '..', '..');
const executable = path.join(root, 'dist', 'win-unpacked', 'Lights Out.exe');
const proofDir = path.join(root, 'dist', 'review-proof');
const lifecycleStartedAt = Date.now();
const lifecycle = [];

function progress(message) {
  lifecycle.push({ event: message, elapsedMs: Date.now() - lifecycleStartedAt });
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

async function removeFirewallRules(ruleNames) {
  if (process.platform !== 'win32' || !ruleNames?.length) return;
  const encodedNames = Buffer.from(JSON.stringify(ruleNames), 'utf8').toString('base64');
  const command = `$ProgressPreference = 'SilentlyContinue'; $names = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedNames}'))); foreach ($name in @($names)) { $rule = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue; if ($rule) { $rule | Remove-NetFirewallRule -ErrorAction Stop } }; exit 0`;
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
    windowsHide: true,
    timeout: 15000
  });
}

async function countFirewallRules(ruleNames) {
  if (process.platform !== 'win32' || !ruleNames?.length) return 0;
  const encodedNames = Buffer.from(JSON.stringify(ruleNames), 'utf8').toString('base64');
  const command = `$ProgressPreference = 'SilentlyContinue'; $names = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedNames}'))); $count = 0; foreach ($name in @($names)) { $count += @(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue).Count }; Write-Output $count; exit 0`;
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
    windowsHide: true,
    timeout: 15000
  });
  return Number.parseInt(result.stdout.trim(), 10) || 0;
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
    this.consoleErrors = [];
    this.pageErrors = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push({
          timestamp: message.params.timestamp,
          text: (message.params.args || []).map(arg => arg.value ?? arg.description ?? arg.type).join(' ')
        });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails || {};
        this.pageErrors.push({
          text: details.text || 'Uncaught exception',
          url: details.url || null,
          line: details.lineNumber,
          column: details.columnNumber,
          exception: details.exception?.description || details.exception?.value || null
        });
      }
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
    if (response.exceptionDetails) {
      console.error('CDP Exception details:', JSON.stringify(response.exceptionDetails, null, 2));
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime evaluation failed');
    }
    return response.result.value;
  }

  async screenshot(name, directory = proofDir) {
    const result = await this.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, name), Buffer.from(result.data, 'base64'));
    return path.join(directory, name);
  }

  async click(selector) {
    const rect = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || !element.isConnected) return null;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`);
    assert.ok(rect, `Missing or detached element: ${selector}`);
    await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  }

  async moveTo(selector) {
    const point = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || !element.isConnected) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 12) };
    })()`);
    assert.ok(point, `Missing pointer target: ${selector}`);
    await this.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  }

  async pressEscape() {
    const params = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await this.command('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
    await this.command('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }

  close() { this.socket.close(); }
}

async function processOwnership(pid, port) {
  if (process.platform !== 'win32') {
    return { spawnedPid: pid, listeningPid: pid, executablePath: executable, commandLine: `--user-data-dir=` };
  }
  const command = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}"; $l = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction Stop | Select-Object -First 1; [pscustomobject]@{ spawnedPid = [int]$p.ProcessId; listeningPid = [int]$l.OwningProcess; executablePath = [string]$p.ExecutablePath; commandLine = [string]$p.CommandLine } | ConvertTo-Json -Compress`;
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    timeout: 15000
  });
  return JSON.parse(result.stdout.trim());
}

async function rendererSnapshot(cdp) {
  return cdp.evaluate(`(() => {
    const proof = window.__desktopUxProof || null;
    if (proof && !proof.generation) {
      Object.defineProperty(proof, 'generation', {
        value: crypto.randomUUID(),
        configurable: false,
        enumerable: true,
        writable: false
      });
    }
    const menus = Array.from(document.querySelectorAll('.menu-item'));
    const menusReady = Boolean(
      proof?.ready === true &&
      menus.length >= 3 &&
      menus.every(menu => menu.isConnected && menu.getAttribute('aria-expanded') !== null)
    );
    if (proof) proof.menusReady = menusReady;
    const visiblePanel = Array.from(document.querySelectorAll('.ns-main-panel'))
      .find(panel => getComputedStyle(panel).display !== 'none');
    return {
      generation: proof?.generation || null,
      documentReadyState: document.readyState,
      proofExists: Boolean(proof),
      proofReady: proof?.ready === true,
      proofPhase: proof?.phase || null,
      proofError: proof?.error || null,
      menusReady,
      view: document.querySelector('.ns-nav-item[aria-current="page"]')?.dataset?.nsTab || visiblePanel?.id || null,
      openModal: document.querySelector('.modal.active')?.id || null,
      openMenu: document.querySelector('.menu-item.open')?.id || null,
      focusedElement: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName || null,
      href: location.href
    };
  })()`);
}

async function menuState(cdp, menuId) {
  return cdp.evaluate(`(() => {
    const trigger = document.getElementById(${JSON.stringify(menuId)});
    const menu = trigger?.querySelector('.submenu');
    const triggerBox = trigger?.getBoundingClientRect();
    const menuBox = menu?.getBoundingClientRect();
    const visible = element => Boolean(element && getComputedStyle(element).display !== 'none' &&
      getComputedStyle(element).visibility !== 'hidden' && element.getBoundingClientRect().width > 0 &&
      element.getBoundingClientRect().height > 0);
    return {
      connected: Boolean(trigger?.isConnected),
      visible: visible(trigger),
      enabled: Boolean(trigger && !trigger.hasAttribute('disabled') && trigger.getAttribute('aria-disabled') !== 'true'),
      triggerRect: triggerBox ? { x: triggerBox.x, y: triggerBox.y, width: triggerBox.width, height: triggerBox.height } : null,
      menuRect: menuBox ? { x: menuBox.x, y: menuBox.y, width: menuBox.width, height: menuBox.height } : null,
      ariaExpanded: trigger?.getAttribute('aria-expanded') || null,
      open: Boolean(trigger?.classList.contains('open')),
      menuVisible: visible(menu),
      focusedId: document.activeElement?.id || null
    };
  })()`);
}

async function proveTopMenu(cdp, readiness, menuId, full = false) {
  const result = await exerciseMenuContract({
    menuId,
    readReadiness: async () => {
      const current = await rendererSnapshot(cdp);
      assert.equal(current.generation, readiness.generation, 'renderer generation changed before menu interaction');
      return current;
    },
    readMenu: () => menuState(cdp, menuId),
    clickTrigger: () => cdp.click(`#${menuId}`),
    moveToFirstItem: () => cdp.moveTo(`#${menuId} .submenu-item`),
    pressEscape: () => cdp.pressEscape(),
    full
  });
  const after = await rendererSnapshot(cdp);
  assert.equal(after.generation, readiness.generation, 'renderer generation changed during menu interaction');
  return result;
}

async function boundedDiagnostics(cdp, child, debugPort, userData, target, readiness = null) {
  let state = null;
  try { state = await rendererSnapshot(cdp); } catch (error) { state = { evaluationError: error.message }; }
  return {
    executable,
    pid: child?.pid || null,
    cdpPort: debugPort,
    userData,
    rendererUrl: target?.url || state?.href || null,
    windowCount: target?.windowCount ?? null,
    rendererGeneration: state?.generation || readiness?.generation || null,
    documentReadyState: state?.documentReadyState || null,
    proofExists: state?.proofExists ?? false,
    proofReady: state?.proofReady ?? false,
    menusReady: state?.menusReady ?? false,
    currentView: state?.view || null,
    openModal: state?.openModal || null,
    openMenu: state?.openMenu || null,
    focusedElement: state?.focusedElement || null,
    power: cdp ? await menuState(cdp, 'menu-power').catch(() => null) : null,
    consoleErrors: cdp?.consoleErrors.slice(-20) || [],
    pageErrors: cdp?.pageErrors.slice(-20) || [],
    lifecycle: lifecycle.slice(-30)
  };
}

async function captureRedactedFailureEvidence(cdp, stagingDirectory) {
  if (!cdp || !stagingDirectory) return { screenshot: null, screenshotStatus: 'skipped-no-renderer' };
  let installed = false;
  try {
    const redaction = await cdp.evaluate(rendererRedactionInstallExpression());
    installed = Boolean(redaction?.confirmed && redaction?.qrMasked);
    if (!installed) {
      return {
        screenshot: null,
        screenshotStatus: 'skipped-redaction-unconfirmed',
        redaction: sanitizeValue(redaction)
      };
    }
    const screenshot = await cdp.screenshot('packaged-truth-failure-redacted.png', stagingDirectory);
    return {
      screenshot,
      screenshotStatus: 'captured-redacted',
      redaction: sanitizeValue(redaction)
    };
  } finally {
    if (installed) {
      try { await cdp.evaluate(rendererRedactionRestoreExpression); } catch {}
    }
  }
}

async function main() {
  const failureStage = process.env.LIGHTS_OUT_PACKAGED_PROOF_FAIL_STAGE || '';
  const resources = {
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
  let debugPort;
  let blockedPort;
  let testPort;
  let userData;
  let child;
  let cdp;
  let target;
  let readiness;
  let successReport;
  let primaryError = null;
  let cleanupReport = { cleaned: [], errors: [] };
  let cleanupVerification = { ok: true, leaks: [] };

  try {
    assert.ok(fs.existsSync(executable), `Packaged executable missing: ${executable}`);
    debugPort = await freePort();
    blockedPort = await freePort();
    // The product default (58732) is not guaranteed bindable on every Windows
    // machine -- Hyper-V/WinNAT dynamically reserve ranges that can include it.
    // Binding port 0 asks the OS for an ephemeral port, which by definition
    // falls outside any excluded range. Production's default stays 58732;
    // only this test's own "switch to a configured port" exercise uses testPort.
    testPort = await freePort();
    resources.cdpPort = debugPort;
    resources.blockerPort = blockedPort;

    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-packaged-gate-'));
    resources.tempProfile = userData;
    resources.tempProfileOriginal = userData;
    resources.diagnosticStaging = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-packaged-diagnostics-'));
    resources.diagnosticStagingOriginal = resources.diagnosticStaging;
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
      app: { onboarded: true, action: 'sleep', durationSeconds: 900 },
      calendar: { builtin: { enabled: true, bedtime: '22:15', days: ['mon', 'tue'], action: 'sleep' } }
    }));
    injectFailure(failureStage, 'after-profile-created');

    resources.blocker = net.createServer();
    const firewallBefore = await firewallSnapshot();
    assert.equal(firewallBefore.length, 0);
    await new Promise((resolve, reject) => {
      resources.blocker.once('error', reject);
      resources.blocker.listen(blockedPort, '0.0.0.0', resolve);
    });
    injectFailure(failureStage, 'after-blocker-created');

    child = spawn(executable, [
      '--no-auto-start',
      '--desktop-ux-proof',
      `--user-data-dir=${userData}`,
      `--remote-debugging-port=${debugPort}`
    ], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        LIGHTS_OUT_SUPPRESS_TRAY: '1',
        LIGHTS_OUT_DESKTOP_UX_GATE: '1'
      }
    });
    resources.originalAppPid = child.pid;
    resources.appProcess = {
      child,
      pid: child.pid,
      executable,
      ownershipToken: `--user-data-dir=${userData}`,
      startedAt: Date.now()
    };
    injectFailure(failureStage, 'after-process-launched');

    progress('waiting for renderer target');
    target = await waitFor(async () => {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = targets.find(item => item.type === 'page' && /index\.html/.test(item.url));
      return page ? { ...page, windowCount: targets.filter(item => item.type === 'page').length } : null;
    }, 20000);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    resources.browser = cdp;
    await cdp.command('Runtime.enable');
    await cdp.command('Page.enable');
    if (process.env.LIGHTS_OUT_PACKAGED_PROOF_SEED_FAKE_SECRET === '1') {
      await cdp.evaluate(`(() => {
        document.getElementById('remote-url').textContent = 'http://192.0.2.16:62731/?t=SEEDED_FAKE_SECRET';
        document.getElementById('remote-short-code').textContent = 'SEEDED-4821';
        document.getElementById('remote-qr-wrap').innerHTML = '<canvas>SEEDED_FAKE_QR</canvas>';
        return true;
      })()`);
    }
    injectFailure(failureStage, 'after-cdp-connected');
    progress('verifying packaged process and CDP ownership');
    const ownership = await waitFor(() => processOwnership(child.pid, debugPort), 15000);
    assertOwnedEndpoint({
      spawnedPid: child.pid,
      listeningPid: ownership.listeningPid,
      expectedExecutable: executable,
      actualExecutable: ownership.executablePath,
      expectedUserData: userData,
      commandLine: ownership.commandLine
    });
    progress('waiting for authoritative renderer and menu readiness');
    readiness = await waitForAuthoritativeReadiness(
      () => rendererSnapshot(cdp),
      { onMilestone: event => lifecycle.push({ ...event, elapsedMs: Date.now() - lifecycleStartedAt }) }
    );
    assert.equal(target.windowCount, 1, 'packaged proof must attach to exactly one renderer window');
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
    await new Promise((resolve, reject) => resources.blocker.close(error => error ? reject(error) : resolve()));
    resources.blocker = null;
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
    resources.firewallRuleNames = firewallDefault.map(rule => rule.Name).filter(Boolean);
    for (const rule of firewallDefault) {
      assert.equal(rule.Profile, 'Private');
      assert.equal(rule.Direction, 'Inbound');
      assert.equal(rule.Action, 'Allow');
      assert.equal(path.normalize(rule.Program), path.normalize(executable));
    }
    assert.ok(firewallDefault.some(rule => rule.Protocol === 'TCP' && rule.LocalPort === String(testPort)));
    assert.ok(firewallDefault.some(rule => rule.Protocol === 'UDP' && rule.LocalPort === '58733'));
    injectFailure(failureStage, 'after-firewall-rule-created');
    const alternatePort = await cdp.evaluate(`electronAPI.setRemoteControlPort(${blockedPort})`);
    assert.equal(alternatePort.ready, true);
    const firewallAlternate = await firewallSnapshot();
    assert.equal(firewallAlternate.length, 2);
    resources.firewallRuleNames = firewallAlternate.map(rule => rule.Name).filter(Boolean);
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
    await cdp.click('#notif-drawer-close');
    await waitFor(() => cdp.evaluate(`!document.getElementById('notif-drawer').classList.contains('active')`));

    progress('proving native top-menu interaction contract');
    await cdp.evaluate(`window.__desktopUxProof.clearStartInvocations()`);
    const powerMenu = await proveTopMenu(cdp, readiness, 'menu-power', true);
    const settingsMenu = await proveTopMenu(cdp, readiness, 'menu-settings');
    const helpMenu = await proveTopMenu(cdp, readiness, 'menu-help');
    const menuStartInvocations = await cdp.evaluate(`window.__desktopUxProof.getStartInvocations()`);
    const menuPowerActions = await cdp.evaluate(`window.__desktopUxProof.getRealPowerActions()`);
    assert.deepEqual(menuStartInvocations, [], 'handled menu input triggered the timer shortcut');
    assert.deepEqual(menuPowerActions, [], 'menu proof triggered a real power action');
    injectFailure(failureStage, 'during-proof');

    progress('proving canonical routes and modes');
    await cdp.evaluate(`(() => {
      document.querySelector('[data-ns-tab="lib"]').click();
      return true;
    })()`);
    const before = await cdp.evaluate(`document.querySelector('.ns-nav-item[aria-current="page"]')?.dataset.nsTab`);
    await cdp.click('#menu-settings');
    await waitFor(async () => {
      const state = await menuState(cdp, 'menu-settings');
      return state.ariaExpanded === 'true' && state.open && state.menuVisible;
    });
    await cdp.click('#open-options');
    const routes = await cdp.evaluate(`(async () => {
      // Settings is a real panel (applyMainPanelVisibility), not a
      // .active-toggled modal -- visibility is the inline display style.
      const topSettings = document.getElementById('ns-panel-set').style.display !== 'none';
      document.getElementById('modal-close').click();
      await new Promise(resolve => setTimeout(resolve, 300));
      const restored = document.querySelector('.ns-nav-item[aria-current="page"]')?.dataset.nsTab;
      document.querySelector('[data-ns-tab="set"]').click();
      const sideSettings = document.getElementById('ns-panel-set').style.display !== 'none';
      document.getElementById('modal-close').click();
      document.querySelector('[data-ns-tab="modes"]').click();
      return {
        topSettings, restored, sideSettings,
        selected: document.querySelector('.ns-nav-item[aria-current="page"]')?.dataset.nsTab,
        modeTitles: [...document.querySelectorAll('.nm-card .nm-card-title')].map(el => el.textContent.trim()),
        hardStopPresent: document.body.textContent.includes('HARD STOP')
      };
    })()`);
    assert.equal(before, 'lib');
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
    assert.deepEqual(cdp.consoleErrors, [], 'renderer emitted console errors');
    assert.deepEqual(cdp.pageErrors, [], 'renderer emitted uncaught page errors');
    const finalSnapshot = await rendererSnapshot(cdp);
    assert.equal(finalSnapshot.generation, readiness.generation, 'renderer generation changed before proof completion');

    successReport = {
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
      menus: {
        power: { opened: powerMenu.opened.open, pointerTransfer: powerMenu.pointerTransfer.open, escapeFocus: powerMenu.closed.focusedId },
        settings: { opened: settingsMenu.opened.open, escapeFocus: settingsMenu.closed.focusedId },
        help: { opened: helpMenu.opened.open, escapeFocus: helpMenu.closed.focusedId }
      },
      menuSafety: { timerStarts: menuStartInvocations.length, realPowerActions: menuPowerActions.length },
      runtime: {
        pid: child.pid,
        executable,
        userData,
        cdpPort: debugPort,
        rendererUrl: target.url,
        windowCount: target.windowCount,
        generation: readiness.generation,
        proofReady: readiness.proofReady,
        menusReady: readiness.menusReady,
        consoleErrors: cdp.consoleErrors.length,
        pageErrors: cdp.pageErrors.length,
        lifecycle
      },
      powerActions: 0
    };
  } catch (error) {
    primaryError = error;
    try {
      const liveRules = await firewallSnapshot();
      const exactOwnedNames = liveRules
        .filter(rule => path.normalize(rule.Program || '').toLowerCase() === path.normalize(executable).toLowerCase())
        .map(rule => rule.Name)
        .filter(Boolean);
      resources.firewallRuleNames = Array.from(new Set([
        ...resources.firewallRuleNames,
        ...exactOwnedNames
      ]));
    } catch {}
    let evidence = { screenshot: null, screenshotStatus: 'skipped-no-renderer' };
    try {
      evidence = await captureRedactedFailureEvidence(cdp, resources.diagnosticStaging);
    } catch (evidenceError) {
      evidence = {
        screenshot: null,
        screenshotStatus: 'skipped-redaction-error',
        error: evidenceError.message
      };
    }
    const diagnostics = sanitizeValue(
      await boundedDiagnostics(cdp, child, debugPort, userData, target, readiness)
    );
    Object.assign(diagnostics, sanitizeValue(evidence));
    console.error(`[packaged-truth] failure diagnostics\n${JSON.stringify(diagnostics, null, 2)}`);
  } finally {
    progress('cleaning isolated runtime');
    resources.firewallRuleNamesAtCleanup = resources.firewallRuleNames.slice();
    cleanupReport = await cleanupOwnedResources(resources, { removeFirewallRules });
    cleanupVerification = await verifyOwnedCleanup(resources, { countFirewallRules });
  }

  if (primaryError) throw attachCleanupDiagnostics(primaryError, cleanupReport, cleanupVerification);
  if (cleanupReport.errors.length || !cleanupVerification.ok) {
    const cleanupError = new Error('Packaged proof cleanup failed');
    throw attachCleanupDiagnostics(cleanupError, cleanupReport, cleanupVerification);
  }
  successReport.cleanup = {
    ownedProcesses: 0,
    blockerPortFree: true,
    cdpPortFree: true,
    firewallRules: 0,
    tempProfileRemoved: true,
    diagnosticStagingRemoved: true,
    elapsedMs: cleanupVerification.elapsedMs
  };
  console.log(JSON.stringify(sanitizeValue(successReport), null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
