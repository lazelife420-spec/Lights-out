// WiFi Guard: shut down internet access for kids at bedtime.
// Supports router API integration (TP-Link, ASUS, Netgear) and
// Windows Firewall rules as a fallback. Can also disable the
// local WiFi adapter as a nuclear option.

const http = require('http');
const https = require('https');
const net = require('net');
const { spawn } = require('child_process');
const { runBounded } = require('./boundedProcess');

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

// TP-Link routers (common modern models: Archer, Deco).
async function tplinkBlock(routerIp, username, password, deviceMacs) {
  // TP-Link uses a session-based API.
  const base = `http://${routerIp}`;
  try {
    // Login. (Response is not consumed today; the call establishes the session.)
    await httpPost(`${base}/cgi-bin/luci/admin/login`, {
      username, password, operation: 'write'
    });
    // Set parental control rules for each MAC.
    for (const mac of deviceMacs) {
      await httpPost(`${base}/cgi-bin/luci/admin/parental_control`, {
        mac, enable: 1, description: 'Lights Out Bedtime Block'
      });
    }
    return { success: true, provider: 'tplink' };
  } catch (e) {
    return { success: false, provider: 'tplink', error: e.message };
  }
}

async function tplinkUnblock(routerIp, username, password, deviceMacs) {
  const base = `http://${routerIp}`;
  try {
    await httpPost(`${base}/cgi-bin/luci/admin/login`, { username, password, operation: 'write' });
    for (const mac of deviceMacs) {
      await httpPost(`${base}/cgi-bin/luci/admin/parental_control`, {
        mac, enable: 0
      });
    }
    return { success: true, provider: 'tplink' };
  } catch (e) {
    return { success: false, provider: 'tplink', error: e.message };
  }
}

// ASUS routers (uses the AiProtection / Parental Control API).
async function asusBlock(routerIp, username, password, deviceMacs) {
  const base = `http://${routerIp}`;
  try {
    // ASUS uses a token-based auth on their web UI.
    // (Response is not consumed today; the call establishes the session.)
    await httpPost(`${base}/login.cgi`, {
      login_authorization: Buffer.from(`${username}:${password}`).toString('base64')
    });
    for (const mac of deviceMacs) {
      await httpPost(`${base}/apply.cgi`, {
        action_mode: 'apply',
        current_page: 'ParentalControl.asp',
        blocked_mac: mac,
        blocked_desc: 'Lights Out'
      });
    }
    return { success: true, provider: 'asus' };
  } catch (e) {
    return { success: false, provider: 'asus', error: e.message };
  }
}

async function asusUnblock(routerIp, username, password, deviceMacs) {
  const base = `http://${routerIp}`;
  try {
    await httpPost(`${base}/login.cgi`, {
      login_authorization: Buffer.from(`${username}:${password}`).toString('base64')
    });
    for (const mac of deviceMacs) {
      await httpPost(`${base}/apply.cgi`, {
        action_mode: 'apply',
        current_page: 'ParentalControl.asp',
        unblocked_mac: mac
      });
    }
    return { success: true, provider: 'asus' };
  } catch (e) {
    return { success: false, provider: 'asus', error: e.message };
  }
}

// Netgear routers (uses SOAP API over HTTP).
async function netgearBlock(routerIp, username, password, deviceMacs) {
  const base = `http://${routerIp}`;
  try {
    // Netgear uses a SOAP body for auth.
    const authBody = `<?xml version="1.0"?><SOAP-ENV:Envelope><SOAP-ENV:Body><Login><Username>${xmlEscape(username)}</Username><Password>${xmlEscape(password)}</Password></Login></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    await httpPost(`${base}/soap/server_sa/`, authBody, { 'SOAPAction': 'Login' });
    for (const mac of deviceMacs) {
      const blockBody = `<?xml version="1.0"?><SOAP-ENV:Envelope><SOAP-ENV:Body><SetBlockDeviceByMAC><MAC>${xmlEscape(mac)}</MAC><Enable>1</Enable></SetBlockDeviceByMAC></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
      await httpPost(`${base}/soap/server_sa/`, blockBody, { 'SOAPAction': 'SetBlockDeviceByMAC' });
    }
    return { success: true, provider: 'netgear' };
  } catch (e) {
    return { success: false, provider: 'netgear', error: e.message };
  }
}

async function netgearUnblock(routerIp, username, password, deviceMacs) {
  const base = `http://${routerIp}`;
  try {
    const authBody = `<?xml version="1.0"?><SOAP-ENV:Envelope><SOAP-ENV:Body><Login><Username>${xmlEscape(username)}</Username><Password>${xmlEscape(password)}</Password></Login></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    await httpPost(`${base}/soap/server_sa/`, authBody, { 'SOAPAction': 'Login' });
    for (const mac of deviceMacs) {
      const unblockBody = `<?xml version="1.0"?><SOAP-ENV:Envelope><SOAP-ENV:Body><SetBlockDeviceByMAC><MAC>${xmlEscape(mac)}</MAC><Enable>0</Enable></SetBlockDeviceByMAC></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
      await httpPost(`${base}/soap/server_sa/`, unblockBody, { 'SOAPAction': 'SetBlockDeviceByMAC' });
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

async function disableWiFiAdapter() {
  let adapterId = null;
  try {
    // Capture identity before changing anything. Restoration must never pick
    // some other adapter that was already disabled before this run.
    adapterId = await executePS(`$adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless|802.11|WLAN' -and $_.Status -eq 'Up' } | Select-Object -First 1; if ($adapter) { Write-Output $adapter.InterfaceGuid }`);
    if (!validAdapterId(adapterId)) return { success: false, provider: 'adapter', error: 'No active Wi-Fi adapter found' };
    await executePS(`$adapter = Get-NetAdapter | Where-Object { $_.InterfaceGuid -eq [Guid]'${adapterId}' }; if (-not $adapter) { throw 'Adapter unavailable' }; Disable-NetAdapter -InputObject $adapter -Confirm:$false -ErrorAction Stop`);
    return { success: true, provider: 'adapter', adapterId };
  } catch {
    return { success: false, provider: 'adapter', adapterId, error: 'Wi-Fi adapter change was not confirmed' };
  }
}

function validAdapterId(value) {
  return typeof value === 'string' && /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(value);
}

async function enableWiFiAdapter(adapterId) {
  if (!validAdapterId(adapterId)) return { success: false, provider: 'adapter', error: 'No timer-owned adapter identity is available. Restore Wi-Fi in Windows settings.' };
  try {
    await executePS(`$adapter = Get-NetAdapter | Where-Object { $_.InterfaceGuid -eq [Guid]'${adapterId}' }; if (-not $adapter) { throw 'Adapter unavailable' }; Enable-NetAdapter -InputObject $adapter -Confirm:$false -ErrorAction Stop`);
    return { success: true, provider: 'adapter' };
  } catch (e) {
    return { success: false, provider: 'adapter', error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified block/unblock: uses the configured provider.
// ─────────────────────────────────────────────────────────────────────────────

async function blockInternet(config) {
  const { provider, routerIp, routerUser, routerPass, deviceMacs, webhookUrl, webhookHeaders } = config;
  switch (provider) {
    case 'tplink':
      return tplinkBlock(routerIp, routerUser, routerPass, deviceMacs || []);
    case 'asus':
      return asusBlock(routerIp, routerUser, routerPass, deviceMacs || []);
    case 'netgear':
      return netgearBlock(routerIp, routerUser, routerPass, deviceMacs || []);
    case 'webhook':
      return webhookBlock(webhookUrl, deviceMacs || [], webhookHeaders || {});
    case 'firewall':
      return { success: false, provider: 'firewall', error: 'Windows Firewall on this PC cannot enforce access for another LAN device. Choose a router or webhook provider.' };
    case 'adapter':
      return disableWiFiAdapter();
    default:
      return { success: false, error: `Unknown provider: ${provider}` };
  }
}

async function unblockInternet(config) {
  const { provider, routerIp, routerUser, routerPass, deviceMacs, webhookUrl, webhookHeaders } = config;
  switch (provider) {
    case 'tplink':
      return tplinkUnblock(routerIp, routerUser, routerPass, deviceMacs || []);
    case 'asus':
      return asusUnblock(routerIp, routerUser, routerPass, deviceMacs || []);
    case 'netgear':
      return netgearUnblock(routerIp, routerUser, routerPass, deviceMacs || []);
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
function httpPost(url, body, extraHeaders = {}, { allowSelfSigned = false } = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : http;
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': typeof body === 'string' ? 'text/xml' : 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders
      },
      rejectUnauthorized: !allowSelfSigned
    };
    const req = mod.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(result);
        else reject(new Error(`HTTP ${res.statusCode || 'error'}`));
      });
      res.on('aborted', () => reject(new Error('Router response interrupted')));
      res.on('error', () => reject(new Error('Router response failed')));
    });
    // Inactivity alone does not bound a peer that trickles data indefinitely.
    const deadline = setTimeout(() => { req.destroy(); reject(new Error('Router request deadline exceeded')); }, 8000);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
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
  // Exposed for unit testing the input sanitizers that guard PowerShell
  // firewall-rule interpolation and SOAP/XML router request bodies.
  validIps,
  xmlEscape
};
