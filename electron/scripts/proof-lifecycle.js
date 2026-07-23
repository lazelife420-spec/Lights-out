'use strict';

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const FAILURE_STAGES = Object.freeze([
  'after-profile-created',
  'after-blocker-created',
  'after-process-launched',
  'after-cdp-connected',
  'after-firewall-rule-created',
  'during-proof'
]);

function injectFailure(configuredStage, currentStage) {
  if (!configuredStage) return;
  if (!FAILURE_STAGES.includes(configuredStage)) {
    throw new Error(`Unknown packaged proof failure stage: ${configuredStage}`);
  }
  if (configuredStage === currentStage) {
    const error = new Error(`Controlled packaged proof failure: ${currentStage}`);
    error.code = 'PACKAGED_PROOF_CONTROLLED_FAILURE';
    error.stage = currentStage;
    throw error;
  }
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]*[?&](?:t|token|auth|key)=[^\s"'<>]*/gi, '[REDACTED_PAIRING_URL]')
    .replace(/([?&](?:t|token|auth|key)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/\b(token|secret|credential|short[\s_-]?code)\b(\s*[:=]\s*|["']?\s*:\s*["'])([^,\s"'<>}]+)/gi, '$1$2[REDACTED]');
}

function sanitizeValue(value, key = '') {
  if (typeof value === 'string' && /(token|secret|credential|short.?code|pairing.?url)/i.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, item]) => [childKey, sanitizeValue(item, childKey)])
    );
  }
  return value;
}

function applySensitiveDomRedaction(documentRef) {
  const groups = [
    {
      kind: 'qr',
      selectors: [
        '#remote-qr-wrap',
        '#remote-qr',
        '[data-sensitive="qr"]',
        '[id*="qr" i][id*="remote" i]',
        '[id*="qr" i][id*="pair" i]'
      ]
    },
    {
      kind: 'field',
      selectors: [
        'input[id*="token" i]',
        'input[name*="token" i]',
        'input[id*="secret" i]',
        'input[name*="secret" i]',
        'input[id*="credential" i]',
        'input[name*="credential" i]',
        '[data-sensitive="field"]'
      ]
    },
    {
      kind: 'text',
      selectors: [
        '#remote-url',
        '#remote-short-code',
        '[data-sensitive="pairing"]',
        '[id*="pairing-url" i]',
        '[id*="short-code" i]',
        '[id*="token" i]:not(input)',
        '[id*="credential" i]:not(input)'
      ]
    }
  ];
  const records = [];
  const seen = new Set();
  for (const group of groups) {
    for (const selector of group.selectors) {
      for (const element of Array.from(documentRef.querySelectorAll(selector) || [])) {
        if (!element || seen.has(element)) continue;
        seen.add(element);
        records.push({
          element,
          kind: group.kind,
          innerHTML: element.innerHTML,
          textContent: element.textContent,
          value: 'value' in element ? element.value : undefined,
          style: element.getAttribute?.('style') ?? null,
          ariaLabel: element.getAttribute?.('aria-label') ?? null
        });
      }
    }
  }

  for (const record of records) {
    const { element, kind } = record;
    if (kind === 'field' && 'value' in element) element.value = '[REDACTED]';
    if (kind !== 'field') {
      if (typeof element.replaceChildren === 'function') element.replaceChildren();
      element.textContent = kind === 'qr' ? '[REDACTED QR]' : '[REDACTED]';
    }
    if (kind === 'qr') {
      element.setAttribute?.(
        'style',
        'display:flex!important;align-items:center!important;justify-content:center!important;' +
        'min-width:180px!important;min-height:180px!important;background:#000!important;' +
        'color:#fff!important;filter:none!important;opacity:1!important;'
      );
    }
    element.setAttribute?.('data-proof-redacted', kind);
    element.setAttribute?.('aria-label', kind === 'qr' ? 'Redacted QR code' : 'Redacted sensitive value');
  }

  return {
    confirmed: records.length > 0 && records.every(record =>
      record.element.getAttribute?.('data-proof-redacted') === record.kind
    ),
    maskedCount: records.length,
    qrMasked: records.some(record => record.kind === 'qr'),
    restore() {
      for (const record of records) {
        const { element } = record;
        if ('innerHTML' in element) element.innerHTML = record.innerHTML;
        else element.textContent = record.textContent;
        if (record.value !== undefined && 'value' in element) element.value = record.value;
        if (record.style === null) element.removeAttribute?.('style');
        else element.setAttribute?.('style', record.style);
        if (record.ariaLabel === null) element.removeAttribute?.('aria-label');
        else element.setAttribute?.('aria-label', record.ariaLabel);
        element.removeAttribute?.('data-proof-redacted');
      }
    }
  };
}

function rendererRedactionInstallExpression() {
  return `(() => {
    const apply = ${applySensitiveDomRedaction.toString()};
    try { window.__packagedProofRedaction?.restore?.(); } catch {}
    const handle = apply(document);
    window.__packagedProofRedaction = handle;
    return { confirmed: handle.confirmed, maskedCount: handle.maskedCount, qrMasked: handle.qrMasked };
  })()`;
}

const rendererRedactionRestoreExpression = `(() => {
  const handle = window.__packagedProofRedaction;
  if (!handle) return false;
  try { handle.restore(); } finally { delete window.__packagedProofRedaction; }
  return true;
})()`;

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function isPortFree(port, host = '127.0.0.1') {
  if (!port) return Promise.resolve(true);
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function waitForCondition(check, timeoutMs = 5000, intervalMs = 100) {
  const startedAt = Date.now();
  let last = false;
  while (Date.now() - startedAt < timeoutMs) {
    last = await check();
    if (last) return { ok: true, elapsedMs: Date.now() - startedAt };
    await wait(intervalMs);
  }
  return { ok: false, elapsedMs: Date.now() - startedAt, last };
}

async function windowsProcessTree(rootPid) {
  if (process.platform !== 'win32' || !rootPid) return [rootPid].filter(Boolean);
  const command = `$all = @(Get-CimInstance Win32_Process); $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add(${Number(rootPid)}); for ($i = 0; $i -lt $ids.Count; $i++) { $parent = $ids[$i]; @($all | Where-Object { $_.ParentProcessId -eq $parent }) | ForEach-Object { if (-not $ids.Contains([int]$_.ProcessId)) { $ids.Add([int]$_.ProcessId) } } }; @($ids) | ConvertTo-Json -Compress`;
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    timeout: 15000
  });
  const parsed = JSON.parse(result.stdout.trim() || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
}

async function inspectProcess(pid) {
  if (!pid) return null;
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0);
      return { pid };
    } catch {
      return null;
    }
  }
  const command = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{ pid = [int]$p.ProcessId; executablePath = [string]$p.ExecutablePath; commandLine = [string]$p.CommandLine; creationDate = [string]$p.CreationDate } | ConvertTo-Json -Compress }`;
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    timeout: 15000
  });
  return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
}

async function terminateOwnedProcess(ownedProcess) {
  if (!ownedProcess?.pid) return { ownedPids: [] };
  const info = await inspectProcess(ownedProcess.pid);
  if (!info) return { ownedPids: [ownedProcess.pid] };
  if (
    ownedProcess.executable &&
    info.executablePath &&
    path.normalize(info.executablePath).toLowerCase() !== path.normalize(ownedProcess.executable).toLowerCase()
  ) {
    throw new Error(`Refusing to terminate PID ${ownedProcess.pid}: executable ownership changed`);
  }
  if (ownedProcess.ownershipToken && !String(info.commandLine || '').includes(ownedProcess.ownershipToken)) {
    throw new Error(`Refusing to terminate PID ${ownedProcess.pid}: ownership token missing`);
  }
  const ownedPids = await windowsProcessTree(ownedProcess.pid);
  try { ownedProcess.child?.kill?.(); } catch {}
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(ownedProcess.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.on('close', resolve);
      killer.on('error', resolve);
    });
  } else {
    try { process.kill(ownedProcess.pid, 'SIGKILL'); } catch {}
  }
  await waitForCondition(async () => !(await inspectProcess(ownedProcess.pid)), 5000, 100);
  return { ownedPids };
}

async function cleanupOwnedResources(resources, adapters = {}) {
  const errors = [];
  const cleaned = [];
  const run = async (name, action) => {
    try {
      await action();
      cleaned.push(name);
    } catch (error) {
      errors.push({ resource: name, message: sanitizeText(error?.message || error) });
    }
  };

  await run('browser', async () => {
    if (!resources.browser) return;
    try { await resources.browser.evaluate?.(`electronAPI.setRemoteControlMode('off')`); } catch {}
    await resources.browser.close?.();
    resources.browser = null;
  });

  await run('app-process', async () => {
    const result = await (adapters.terminateProcess || terminateOwnedProcess)(resources.appProcess);
    resources.ownedPids = result?.ownedPids || resources.ownedPids || [];
    resources.appProcess = null;
  });

  await run('blocker', async () => {
    await (adapters.closeServer || closeServer)(resources.blocker);
    resources.blocker = null;
  });

  await run('firewall-rules', async () => {
    if (!resources.firewallRuleNames?.length) return;
    await adapters.removeFirewallRules?.(resources.firewallRuleNames);
    resources.firewallRuleNames = [];
  });

  await run('temp-profile', async () => {
    if (resources.tempProfile) fs.rmSync(resources.tempProfile, { recursive: true, force: true });
    resources.tempProfile = null;
  });

  await run('diagnostic-staging', async () => {
    if (resources.diagnosticStaging) fs.rmSync(resources.diagnosticStaging, { recursive: true, force: true });
    resources.diagnosticStaging = null;
  });

  return { cleaned, errors };
}

async function verifyOwnedCleanup(resources, adapters = {}) {
  const startedAt = Date.now();
  const leaks = [];
  const pids = Array.from(new Set([...(resources.ownedPids || []), resources.originalAppPid].filter(Boolean)));
  const processResult = await waitForCondition(async () => {
    for (const pid of pids) if (await inspectProcess(pid)) return false;
    return true;
  }, 5000, 100);
  if (!processResult.ok) leaks.push({ resource: 'owned-processes', pids, elapsedMs: processResult.elapsedMs });

  for (const [label, port] of [['blocker-port', resources.blockerPort], ['cdp-port', resources.cdpPort]]) {
    if (!port) continue;
    const result = await waitForCondition(() => isPortFree(port), 5000, 100);
    if (!result.ok) leaks.push({ resource: label, port, elapsedMs: result.elapsedMs });
  }

  if (resources.firewallRuleNamesAtCleanup?.length && adapters.countFirewallRules) {
    const count = await adapters.countFirewallRules(resources.firewallRuleNamesAtCleanup);
    if (count !== 0) leaks.push({ resource: 'firewall-rules', count });
  }
  if (resources.tempProfileOriginal && fs.existsSync(resources.tempProfileOriginal)) {
    leaks.push({ resource: 'temp-profile', path: resources.tempProfileOriginal });
  }
  if (resources.diagnosticStagingOriginal && fs.existsSync(resources.diagnosticStagingOriginal)) {
    leaks.push({ resource: 'diagnostic-staging', path: resources.diagnosticStagingOriginal });
  }
  return { ok: leaks.length === 0, leaks, elapsedMs: Date.now() - startedAt };
}

function attachCleanupDiagnostics(primaryError, cleanupReport, verification) {
  const secondary = [
    ...(cleanupReport?.errors || []),
    ...(verification?.leaks || []).map(leak => ({
      resource: leak.resource,
      message: sanitizeText(JSON.stringify(leak))
    }))
  ];
  if (secondary.length) {
    primaryError.cleanupDiagnostics = secondary;
    primaryError.message = `${primaryError.message} (secondary cleanup diagnostics: ${JSON.stringify(secondary)})`;
  }
  return primaryError;
}

module.exports = {
  FAILURE_STAGES,
  applySensitiveDomRedaction,
  attachCleanupDiagnostics,
  cleanupOwnedResources,
  injectFailure,
  isPortFree,
  rendererRedactionInstallExpression,
  rendererRedactionRestoreExpression,
  sanitizeText,
  sanitizeValue,
  terminateOwnedProcess,
  verifyOwnedCleanup,
  waitForCondition
};
