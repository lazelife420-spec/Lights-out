// WiFi Guard: shut down internet access for kids at bedtime.
// Supports router API integration (TP-Link, ASUS, Netgear) and
// Windows Firewall rules as a fallback. Can also disable the
// local WiFi adapter as a nuclear option.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { spawn } = require('child_process');
const { isPrivateOrLocal, formatHostForUrl } = require(path.join(__dirname, 'capabilityTruth'));
const durableJsonStore = require(path.join(__dirname, 'durableJsonStore'));
const { runBounded } = require('./boundedProcess');

const MAX_HTTP_RESPONSE_BYTES = 256 * 1024;
const ADAPTER_STATE_FILE = 'wifi-guard-state.json';

function quotePS(value) {
  return `'${String(value || '').replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`;
}

function getAdapterStatePath(overridePath) {
  if (overridePath) return overridePath;
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), ADAPTER_STATE_FILE);
    }
  } catch { /* outside Electron (unit tests) */ }
  return null;
}

function readAdapterState(overridePath) {
  const filePath = getAdapterStatePath(overridePath);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const { data } = durableJsonStore.safeLoadJson(filePath);
  return data && typeof data.adapterName === 'string' && data.adapterName.trim()
    ? { adapterName: data.adapterName.trim(), disabledAt: data.disabledAt || null }
    : null;
}

function writeAdapterState(adapterName, overridePath) {
  const filePath = getAdapterStatePath(overridePath);
  if (!filePath) return;
  try {
    durableJsonStore.writeTmpVerifyRename(filePath, {
      adapterName: String(adapterName).trim(),
      disabledAt: new Date().toISOString()
    });
  } catch { /* best-effort persistence */ }
}

function clearAdapterState(overridePath) {
  const filePath = getAdapterStatePath(overridePath);
  if (!filePath) return;
  for (const p of [filePath, `${filePath}.bak`]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

// Only ever interpolate strictly-validated values into PowerShell command
// strings. Device IPs and MACs may originate from imported/shared config, so a
// crafted value like `'; <evil> ; '` must never reach the shell. net.isIP
// rejects anything that is not a clean IPv4/IPv6 literal.
function validIps(list) {
  return (list || []).filter(ip => typeof ip === 'string' && net.isIP(ip) !== 0);
}

// Escape values before embedding them in a SOAP/XML body so credentials or MAC
// strings containing <, >, & or quotes cannot break out of their element.
function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Router API providers
// ─────────────────────────────────────────────────────────────────────────────

// Router-provider calls send real credentials over plaintext HTTP. The
// save/import sanitizers run at persistence time, but a stored config can also
// reach here via a bulk settings import or a hand-edited settings.json — so the
// request path re-validates the destination itself and refuses anything that is
// not a private/local IP literal (the same rule sanitizeWifiGuard enforces).
function safeRouterTarget(routerIp) {
  const ip = String(routerIp || '').trim();
  return (net.isIP(ip) !== 0 && isPrivateOrLocal(ip)) ? ip : null;
}

const ROUTER_PROVIDERS = new Set(['tplink', 'asus', 'netgear']);

function extractCookieHeader(setCookie) {
  if (!setCookie) return '';
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list
    .map(c => String(c || '').split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

// TP-Link routers (common modern models: Archer, Deco).
async function tplinkBlock(routerIp, username, password, deviceMacs) {
  // TP-Link uses a session-based API.
  const base = `http://${formatHostForUrl(routerIp)}`;
  try {
    const login = await httpPostWithMeta(`${base}/cgi-bin/luci/admin/login`, {
      username, password, operation: 'write'
    });
    const headers = login.cookieHeader ? { Cookie: login.cookieHeader } : {};
    // Set parental control rules for each MAC.
    for (const mac of deviceMacs) {
      await httpPost(`${base}/cgi-bin/luci/admin/parental_control`, {
        mac, enable: 1, description: 'Lights Out Bedtime Block'
      }, headers);
    }
    return { success: true, provider: 'tplink' };
  } catch (e) {
    return { success: false, provider: 'tplink', error: e.message };
  }
}

async function tplinkUnblock(routerIp, username, password, deviceMacs) {
  const base = `http://${formatHostForUrl(routerIp)}`;
  try {
    const login = await httpPostWithMeta(`${base}/cgi-bin/luci/admin/login`, { username, password, operation: 'write' });
    const headers = login.cookieHeader ? { Cookie: login.cookieHeader } : {};
    for (const mac of deviceMacs) {
      await httpPost(`${base}/cgi-bin/luci/admin/parental_control`, {
        mac, enable: 0
      }, headers);
    }
    return { success: true, provider: 'tplink' };
  } catch (e) {
    return { success: false, provider: 'tplink', error: e.message };
  }
}

// ASUS routers (uses the AiProtection / Parental Control API).
async function asusBlock(routerIp, username, password, deviceMacs) {
  const base = `http://${formatHostForUrl(routerIp)}`;
  try {
    // ASUS uses a cookie/token-based auth on their web UI.
    const login = await httpPostWithMeta(`${base}/login.cgi`, {
      login_authorization: Buffer.from(`${username}:${password}`).toString('base64')
    });
    const headers = login.cookieHeader ? { Cookie: login.cookieHeader } : {};
    for (const mac of deviceMacs) {
      await httpPost(`${base}/apply.cgi`, {
        action_mode: 'apply',
        current_page: 'ParentalControl.asp',
        blocked_mac: mac,
        blocked_desc: 'Lights Out'
      }, headers);
    }
    return { success: true, provider: 'asus' };
  } catch (e) {
    return { success: false, provider: 'asus', error: e.message };
  }
}

async function asusUnblock(routerIp, username, password, deviceMacs) {
  const base = `http://${formatHostForUrl(routerIp)}`;
  try {
    const login = await httpPostWithMeta(`${base}/login.cgi`, {
      login_authorization: Buffer.from(`${username}:${password}`).toString('base64')
    });
    const headers = login.cookieHeader ? { Cookie: login.cookieHeader } : {};
    for (const mac of deviceMacs) {
      await httpPost(`${base}/apply.cgi`, {
        action_mode: 'apply',
        current_page: 'ParentalControl.asp',
        unblocked_mac: mac
      }, headers);
    }
    return { success: true, provider: 'asus' };
  } catch (e) {
    return { success: false, provider: 'asus', error: e.message };
  }
}

// Netgear routers (uses SOAP API over HTTP).
async function netgearBlock(routerIp, username, password, deviceMacs) {
  const base = `http://${formatHostForUrl(routerIp)}`;
  try {
    // Netgear uses a SOAP body for auth.
    const authBody = `<?xml version="1.0"?><SOAP-ENV:Envelope><SOAP-ENV:Body><Login><Username>${xmlEscape(username)}</Username><Password>${xmlEscape(password)}</Password></Login></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    const login = await httpPostWithMeta(`${base}/soap/server_sa/`, authBody, { 'SOAPAction': 'Login' });
    const cookieExtra = login.cookieHeader ? { Cookie: login.cookieHeader } : {};
    for (const mac of deviceMacs) {
      const blockBody = `<?xml version="1.0"?><SOAP-ENV:Envelope><SOAP-ENV:Body><SetBlockDeviceByMAC><MAC>${xmlEscape(mac)}</MAC><Enable>1</Enable></SetBlockDeviceByMAC></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
      await httpPost(`${base}/soap/server_sa/`, blockBody, { 'SOAPAction': 'SetBlockDeviceByMAC', ...cookieExtra });
    }
    return { success: true, provider: 'netgear' };
  } catch (e) {
    return { success: false, provider: 'netgear', error: e.message };
  }
}

async function netgearUnblock(routerIp, username, password, deviceMacs) {
  const base = `http://${formatHostForUrl(routerIp)}`;
  try {
    const authBody = `<?xml version="1.0"?><SOAP-ENV:Envelope><SOAP-ENV:Body><Login><Username>${xmlEscape(username)}</Username><Password>${xmlEscape(password)}</Password></Login></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    const login = await httpPostWithMeta(`${base}/soap/server_sa/`, authBody, { 'SOAPAction': 'Login' });
    const cookieExtra = login.cookieHeader ? { Cookie: login.cookieHeader } : {};
    for (const mac of deviceMacs) {
      const unblockBody = `<?xml version="1.0"?><SOAP-ENV:Envelope><SOAP-ENV:Body><SetBlockDeviceByMAC><MAC>${xmlEscape(mac)}</MAC><Enable>0</Enable></SetBlockDeviceByMAC></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
      await httpPost(`${base}/soap/server_sa/`, unblockBody, { 'SOAPAction': 'SetBlockDeviceByMAC', ...cookieExtra });
    }
    return { success: true, provider: 'netgear' };
  } catch (e) {
    return { success: false, provider: 'netgear', error: e.message };
  }
}

// Generic HTTP webhook (for any router with a REST API or automation hook).
async function webhookBlock(url, deviceMacs, headers) {
  try {
    await httpPost(url, { action: 'block', macs: deviceMacs }, headers);
    return { success: true, provider: 'webhook' };
  } catch (e) {
    return { success: false, provider: 'webhook', error: e.message };
  }
}

async function webhookUnblock(url, deviceMacs, headers) {
  try {
    await httpPost(url, { action: 'unblock', macs: deviceMacs }, headers);
    return { success: true, provider: 'webhook' };
  } catch (e) {
    return { success: false, provider: 'webhook', error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup for rules created by the retired Windows Firewall provider. That
// provider could affect only this PC and could not enforce access for another
// LAN device, so new block/unblock attempts reject it below.
// ─────────────────────────────────────────────────────────────────────────────

const FW_RULE_PREFIX = 'LightsOut_WiFiGuard';

// Remove ALL Lights Out firewall rules (cleanup).
async function firewallCleanup() {
  try {
    await executePS(`Remove-NetFirewallRule -DisplayName '${FW_RULE_PREFIX}*' -ErrorAction SilentlyContinue`);
    return { success: true };
  } catch { return { success: false }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Nuclear option: disable the local WiFi adapter entirely.
// Use with caution -- this kills WiFi for ALL devices connected
// to this machine's hosted network, and for this machine itself.
// ─────────────────────────────────────────────────────────────────────────────

function validAdapterId(value) {
  return typeof value === 'string' && /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(value);
}

async function disableWiFiAdapter(opts, hooks = {}) {
  if (opts && typeof opts === 'object' && (opts.runner || opts.statePath)) {
    const { statePath, runner } = opts;
    const run = typeof runner === 'function' ? runner : executePS;
    try {
      const adapterName = await run(
        `$ErrorActionPreference = 'Stop'; $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless|802.11|WLAN' -and $_.Status -eq 'Up' } | Select-Object -First 1; if (-not $adapter) { exit 2 }; Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop; Write-Output $adapter.Name`
      );
      const cleaned = String(adapterName || '').trim().split(/\r?\n/)[0].trim();
      if (!cleaned) {
        return { success: false, provider: 'adapter', error: 'No active Wi-Fi adapter was disabled (check administrator permissions).' };
      }
      writeAdapterState(cleaned, statePath);
      return { success: true, provider: 'adapter', adapterName: cleaned };
    } catch (e) {
      return { success: false, provider: 'adapter', error: e.message };
    }
  }
  let adapterId = null;
  try {
    // Capture identity before changing anything. Restoration must never pick
    // some other adapter that was already disabled before this run.
    adapterId = await executePS(`$adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless|802.11|WLAN' -and $_.Status -eq 'Up' } | Select-Object -First 1; if ($adapter) { Write-Output $adapter.InterfaceGuid }`);
    if (!validAdapterId(adapterId)) return { success: false, provider: 'adapter', mutationAttempted: false, error: 'No active Wi-Fi adapter found' };
    // Let the caller durably record the identity before anything changes. If
    // it cannot, refuse: a disabled adapter nobody can identify later is
    // exactly the stranded-offline case this record exists to prevent.
    if (typeof hooks.beforeMutation === 'function') {
      try { await hooks.beforeMutation({ adapterId }); }
      catch { return { success: false, provider: 'adapter', adapterId: null, mutationAttempted: false, code: 'WIFI_RECOVERY_UNSAVED', error: 'Wi-Fi Guard could not save its recovery record. No network change was requested.' }; }
    }
    await executePS(`$adapter = Get-NetAdapter | Where-Object { $_.InterfaceGuid -eq [Guid]'${adapterId}' }; if (-not $adapter) { throw 'Adapter unavailable' }; Disable-NetAdapter -InputObject $adapter -Confirm:$false -ErrorAction Stop`);
    return { success: true, provider: 'adapter', adapterId };
  } catch {
    // No identity captured means the disable command never ran: nothing to
    // compensate. With an identity, the disable may have taken effect.
    return validAdapterId(adapterId)
      ? { success: false, provider: 'adapter', adapterId, error: 'Wi-Fi adapter change was not confirmed' }
      : { success: false, provider: 'adapter', adapterId: null, mutationAttempted: false, error: 'No active Wi-Fi adapter could be identified. No network change was requested.' };
  }
}

async function enableWiFiAdapter(arg) {
  if (arg && typeof arg === 'object' && (arg.runner || arg.statePath)) {
    const { statePath, runner } = arg;
    const run = typeof runner === 'function' ? runner : executePS;
    const saved = readAdapterState(statePath);
    try {
      const cmd = saved
        ? `$ErrorActionPreference = 'Stop'; $adapter = Get-NetAdapter -Name ${quotePS(saved.adapterName)} -ErrorAction SilentlyContinue; if (-not $adapter) { $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless|802.11|WLAN' -and $_.Status -ne 'Up' } | Select-Object -First 1 }; if ($adapter) { Enable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop; Write-Output $adapter.Name }`
        : `$ErrorActionPreference = 'Stop'; $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless|802.11|WLAN' -and $_.Status -ne 'Up' } | Select-Object -First 1; if ($adapter) { Enable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop; Write-Output $adapter.Name }`;
      const adapterName = await run(cmd);
      const cleaned = String(adapterName || '').trim().split(/\r?\n/)[0].trim();
      if (!cleaned && !saved) {
        return { success: false, provider: 'adapter', error: 'No disabled Wi-Fi adapter found to re-enable.' };
      }
      clearAdapterState(statePath);
      return { success: true, provider: 'adapter', adapterName: cleaned || saved.adapterName };
    } catch (e) {
      return { success: false, provider: 'adapter', error: e.message };
    }
  }
  const adapterId = arg;
  if (!validAdapterId(adapterId)) return { success: false, provider: 'adapter', error: 'No timer-owned adapter identity is available. Restore Wi-Fi in Windows settings.' };
  try {
    await executePS(`$adapter = Get-NetAdapter | Where-Object { $_.InterfaceGuid -eq [Guid]'${adapterId}' }; if (-not $adapter) { throw 'Adapter unavailable' }; Enable-NetAdapter -InputObject $adapter -Confirm:$false -ErrorAction Stop`);
    return { success: true, provider: 'adapter' };
  } catch (e) {
    return { success: false, provider: 'adapter', error: e.message };
  }
}

// Called at app startup: if a previous run disabled the local Wi-Fi adapter
// and exited abnormally (crash/shutdown/power loss) before restoring it,
// automatically re-enable the persisted adapter and clear the state marker.
async function reconcileInterruptedAdapterBlock({ statePath, runner } = {}) {
  const saved = readAdapterState(statePath);
  if (!saved) return { reconciled: false };
  const result = await enableWiFiAdapter({ statePath, runner });
  return { reconciled: result.success, adapterName: saved.adapterName, ...result };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified block/unblock: uses the configured provider.
// ─────────────────────────────────────────────────────────────────────────────

async function blockInternet(config, hooks = {}) {
  const { provider, routerIp, routerUser, routerPass, deviceMacs, webhookUrl, webhookHeaders } = config;
  if (ROUTER_PROVIDERS.has(provider)) {
    const target = safeRouterTarget(routerIp);
    if (!target) {
      return { success: false, provider, error: 'Router address refused: must be a private/local IP (e.g. 192.168.x.x). Credentials are never sent to other hosts.' };
    }
    if (provider === 'tplink') return tplinkBlock(target, routerUser, routerPass, deviceMacs || []);
    if (provider === 'asus') return asusBlock(target, routerUser, routerPass, deviceMacs || []);
    return netgearBlock(target, routerUser, routerPass, deviceMacs || []);
  }
  switch (provider) {
    case 'webhook':
      return webhookBlock(webhookUrl, deviceMacs || [], webhookHeaders || {});
    case 'firewall':
      return { success: false, provider: 'firewall', error: 'Windows Firewall on this PC cannot enforce access for another LAN device. Choose a router or webhook provider.' };
    case 'adapter':
      return disableWiFiAdapter(undefined, hooks);
    default:
      return { success: false, error: `Unknown provider: ${provider}` };
  }
}

async function unblockInternet(config) {
  const { provider, routerIp, routerUser, routerPass, deviceMacs, webhookUrl, webhookHeaders } = config;
  if (ROUTER_PROVIDERS.has(provider)) {
    const target = safeRouterTarget(routerIp);
    if (!target) {
      return { success: false, provider, error: 'Router address refused: must be a private/local IP (e.g. 192.168.x.x). Credentials are never sent to other hosts.' };
    }
    if (provider === 'tplink') return tplinkUnblock(target, routerUser, routerPass, deviceMacs || []);
    if (provider === 'asus') return asusUnblock(target, routerUser, routerPass, deviceMacs || []);
    return netgearUnblock(target, routerUser, routerPass, deviceMacs || []);
  }
  switch (provider) {
    case 'webhook':
      return webhookUnblock(webhookUrl, deviceMacs || [], webhookHeaders || {});
    case 'firewall':
      return { success: false, provider: 'firewall', error: 'Windows Firewall LAN-device mode is unsupported; no remote-device rule was changed.' };
    case 'adapter':
      return enableWiFiAdapter(config.adapterId);
    default:
      return { success: false, error: `Unknown provider: ${provider}` };
  }
}

// Scan the local network for connected devices (arp table).
async function scanDevices() {
  try {
    const raw = await executePS(
      `Get-NetNeighbor -State Reachable | Where-Object { $_.IPAddress -notmatch '^(127|0.|169.254|ff00)' } | Select-Object IPAddress, LinkLayerAddress, InterfaceAlias | ConvertTo-Json -Compress`
    );
    if (!raw || raw === 'null') return [];
    const entries = JSON.parse(raw);
    const list = Array.isArray(entries) ? entries : [entries];
    return list.map(e => ({
      ip: e.IPAddress,
      mac: e.LinkLayerAddress,
      interface: e.InterfaceAlias
    }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────────────────

// `allowSelfSigned` opts a single call out of TLS certificate validation. It is
// reserved for LAN router endpoints (which commonly ship self-signed certs) and
// is NOT applied to user-supplied webhook URLs, where a forged cert would let a
// MITM capture router credentials.
function httpPostWithMeta(url, body, extraHeaders = {}, { allowSelfSigned = false } = {}) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try { urlObj = new URL(url); } catch { reject(new Error('Invalid URL')); return; }
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      reject(new Error('Only http:// and https:// URLs are supported'));
      return;
    }
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : http;
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const safeExtra = {};
    if (extraHeaders && typeof extraHeaders === 'object') {
      for (const [k, v] of Object.entries(extraHeaders)) {
        const lower = String(k || '').toLowerCase().trim();
        if (!lower || lower === 'content-length' || lower === 'host' || lower === 'transfer-encoding') continue;
        if (v !== undefined && v !== null) safeExtra[k] = String(v);
      }
    }
    const options = {
      hostname: urlObj.hostname.replace(/^\[|\]$/g, ''),
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': typeof body === 'string' ? 'text/xml' : 'application/json',
        ...safeExtra,
        'Content-Length': Buffer.byteLength(data)
      },
      rejectUnauthorized: !allowSelfSigned
    };
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    const req = mod.request(options, (res) => {
      let bytes = 0;
      const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_HTTP_RESPONSE_BYTES) {
          req.destroy();
          done(new Error('Response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const result = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          done(null, { body: result, cookieHeader: extractCookieHeader(res.headers['set-cookie']) });
        } else {
          done(new Error(`HTTP ${res.statusCode || 'error'}`));
        }
      });
      res.on('aborted', () => done(new Error('Router response interrupted')));
      res.on('error', () => done(new Error('Router response failed')));
    });
    const deadline = setTimeout(() => { req.destroy(); done(new Error('Router request deadline exceeded')); }, 8000);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', err => done(err));
    req.setTimeout(8000, () => { req.destroy(); done(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

async function httpPost(url, body, extraHeaders = {}, options = {}) {
  const res = await httpPostWithMeta(url, body, extraHeaders, options);
  return res.body;
}

// ─────────────────────────────────────────────────────────────────────────────
// PowerShell helper
// ─────────────────────────────────────────────────────────────────────────────

function executePS(command) {
  return runBounded({ spawn, file: 'powershell.exe', args: [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], timeoutMs: 8000, maxBytes: 256 * 1024, errorPrefix: 'WIFI_GUARD' });
}

module.exports = {
  blockInternet,
  unblockInternet,
  firewallCleanup,
  scanDevices,
  disableWiFiAdapter,
  enableWiFiAdapter,
  reconcileInterruptedAdapterBlock,
  // Exposed for unit testing the input sanitizers that guard PowerShell
  // firewall-rule interpolation and SOAP/XML router request bodies, and the
  // request-path router destination check.
  validIps,
  xmlEscape,
  safeRouterTarget
};
