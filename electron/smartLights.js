// Smart Lights Module for Lights Out Electron
// Shipped providers: WiZ local UDP, Philips Hue Bridge, Generic HTTP webhook.
// MQTT / Home Assistant / IFTTT were advertised in earlier revisions but were
// never reachable through the live config path (configurationKey() never
// produced a key for them, so loadConfig could never enable them). They are
// deliberately not part of the shipped provider surface — re-adding one means
// wiring config, verification, credentials-at-rest, and runtime end to end.

const https = require('https');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');
const wizLights = require('./wizLights');

const SHIPPED_PROVIDERS = ['none', 'wiz', 'hue', 'http'];

// Configuration state. Only fields for shipped providers live here; unknown
// persisted keys are pruned by loadConfig.
let config = {
  provider: 'none',        // 'none', 'hue', 'http'
  mode: 'gradual_dim',     // 'gradual_dim', 'warm_dim', 'off_at_end'
  dimMinutes: 10,          // minutes before end to start dimming
  enabled: false,
  wizAddresses: [],
  wizDevices: [],
  wizLook: wizLights.normalizeLook(),
  // Hue settings
  hueBridgeIp: '',
  hueUsername: '',
  hueLightIds: [],         // array of light IDs (empty = all)
  hueGroupId: '',          // group/room ID (optional)
  hueAllowLegacyHttp: false, // explicit opt-in for pre-HTTPS firmware only
  // HTTP settings
  httpUrl: '',
  httpMethod: 'POST',
  httpHeaders: {},
  httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}',
  verifiedConfigKey: ''
};

// Secret-bearing config fields → renderer-safe presence indicators.
// getPublicConfig() drops each secret and sets its indicator instead.
const SECRET_INDICATORS = {
  hueUsername: 'hasHueCredential',
  httpHeaders: 'hasHttpHeaders'
};

// Canonicalized digest of the webhook headers — included in configurationKey
// so rotating an Authorization header invalidates the verification without the
// secret itself ever appearing in the key.
function httpHeadersDigest(headers) {
  if (!headers || typeof headers !== 'object') return 'none';
  const canonical = Object.entries(headers)
    .filter(([k, v]) => k && v !== undefined && v !== null)
    .map(([k, v]) => [String(k).toLowerCase().trim(), String(v)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

function configurationKey(value = config) {
  const provider = value.provider || 'none';
  if (provider === 'wiz') {
    const ips = wizLights.normalizeAddresses(value.wizAddresses);
    return ips.length ? `wiz:${ips.join(',')}` : '';
  }
  if (provider === 'hue') return `hue:${value.hueBridgeIp || ''}:${value.hueUsername || ''}:${value.hueGroupId || ''}`;
  if (provider === 'http') return `http:${value.httpMethod || 'POST'}:${value.httpUrl || ''}:${httpHeadersDigest(value.httpHeaders)}:${value.httpBodyTemplate || ''}`;
  return '';
}

// Runtime state
let state = {
  dimStarted: false,
  originalLightState: null,  // [{id, on, bri, ct}] captured at dim start (Hue)
  dimStartTime: null,
  dimDurationMs: 0
};
let wizBatchBusy = false;
let wizGeneration = 0;
let wizOperationChain = Promise.resolve();
function queueWizOperation(operation) {
  const next = wizOperationChain.then(operation);
  wizOperationChain = next.catch(() => {});
  return next;
}
async function restoreWizOriginalState() {
  wizGeneration++;
  const snapshot = state.wizOriginalState;
  const pending = state.wizSnapshotPending;
  return queueWizOperation(async () => wizLights.restoreStates(snapshot || (pending ? await pending : [])));
}

function result(provider, success, code, message, extra = {}) {
  return { provider, success, code, message, ...extra };
}

function failure(provider, code, message) {
  return result(provider, false, code, message);
}

// fetch() does not honor a `timeout` RequestInit — bound every outbound call
// with AbortSignal so a blackholed endpoint fails truthfully.
function fetchBounded(url, options = {}, timeoutMs = 5000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hue transport
//
// Philips Hue firmware after the EU RED change serves the local API over
// HTTPS only; older bridges still answer HTTP. hueRequest() tries HTTPS first
// (rejectUnauthorized:false — the bridge cert is self-signed/Hue-CA; the cert
// is inspected and reported, not blindly trusted) and falls back to HTTP for
// legacy bridges, reporting the negotiated transport truthfully.
// ─────────────────────────────────────────────────────────────────────────────

const hueTransportCache = new Map(); // host -> 'https' | 'http'

// Errors that mean "the other side is plain HTTP, not TLS".
function isTlsMismatchError(err) {
  const code = err && (err.code || '');
  const msg = (err && err.message) || '';
  return code === 'EPROTO' || code === 'ECONNRESET' || code === 'ERR_SSL_WRONG_VERSION_NUMBER'
    || /wrong version|ssl routines|unknown protocol|packet length too long/i.test(msg);
}

function rawHueRequest(transport, host, method, path, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const [hostname, portStr] = host.split(':');
    const client = transport === 'https' ? https : http;
    const req = client.request({
      hostname,
      port: portStr ? Number(portStr) : (transport === 'https' ? 443 : 80),
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: timeoutMs,
      // CA validation can't work for bridge-issued certs, so hostname/CA checks
      // are off — but identity IS enforced: checkServerIdentity runs BEFORE the
      // request bytes (and the Hue credential in the path) leave the socket.
      rejectUnauthorized: transport === 'https' ? false : undefined,
      checkServerIdentity: transport === 'https'
        ? (name, cert) => {
            const check = isHueBridgeCertificate(cert);
            return check.trusted ? undefined : new Error(`Unrecognized bridge certificate: ${check.reason}`);
          }
        : undefined
    }, (res) => {
      let data = '';
      res.on('data', c => { if (data.length < 256 * 1024) data += c; });
      res.on('end', () => {
        let cert = null;
        try {
          const c = res.socket && res.socket.getPeerCertificate && res.socket.getPeerCertificate();
          if (c && c.subject) cert = { subject: c.subject, issuer: c.issuer };
        } catch { /* not a TLS socket */ }
        resolve({ status: res.statusCode || 0, body: data, certificate: cert });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (bodyObj !== undefined && bodyObj !== null) req.write(JSON.stringify(bodyObj));
    req.end();
  });
}

// Heuristic: a real Hue bridge cert is issued for the bridge (CN is typically
// the 16-hex-digit bridgeid) by the Hue chain. Returns {trusted, reason}.
function isHueBridgeCertificate(cert) {
  if (!cert || !cert.subject) return { trusted: false, reason: 'no peer certificate' };
  const cn = String(cert.subject.CN || cert.subject.commonName || '');
  const issuerBlob = JSON.stringify(cert.issuer || {});
  if (/^[0-9a-fA-F]{16}$/.test(cn)) return { trusted: true, reason: 'bridgeid CN' };
  if (/hue|philips/i.test(cn) || /hue|philips/i.test(issuerBlob)) {
    return { trusted: true, reason: 'Hue/Philips identity' };
  }
  return { trusted: false, reason: `unrecognized identity (CN=${cn || '?'})` };
}

// allowLegacyHttp defaults to the configured opt-in. Pass true explicitly for
// credential-free probes (discovery fingerprinting) where reporting the legacy
// transport is the goal, not sending secrets.
async function hueRequest(host, method, path, bodyObj, timeoutMs = 5000, { allowLegacyHttp = config.hueAllowLegacyHttp } = {}) {
  const cached = hueTransportCache.get(host);
  const order = cached ? [cached] : ['https', 'http'];
  let lastErr = null;
  for (const transport of order) {
    if (transport === 'http' && !allowLegacyHttp) {
      const e = new Error('Bridge answered HTTP only — enable "Allow legacy HTTP bridge" to use pre-HTTPS firmware');
      e.code = 'HTTPS_REQUIRED';
      throw e;
    }
    try {
      const r = await rawHueRequest(transport, host, method, path, bodyObj, timeoutMs);
      if (!cached) hueTransportCache.set(host, transport);
      let parsed = null;
      try { parsed = JSON.parse(r.body); } catch { /* keep raw */ }
      const certCheck = transport === 'https' ? isHueBridgeCertificate(r.certificate) : null;
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        data: parsed !== null ? parsed : r.body,
        transport,
        tls: transport === 'https'
          ? { trusted: certCheck.trusted, reason: certCheck.reason }
          : { legacy: true }
      };
    } catch (err) {
      lastErr = err;
      // A TLS-handshake mismatch on an old bridge means "speak HTTP" — retry
      // only when legacy mode was explicitly allowed for this call.
      if (transport === 'https' && isTlsMismatchError(err)) continue;
      throw err;
    }
  }
  throw lastErr;
}

function hueFailureFromError(error) {
  const msg = error && error.message ? error.message : String(error);
  const code = error && error.code === 'HTTPS_REQUIRED' ? 'HTTPS_REQUIRED'
    : /unrecognized bridge certificate/i.test(msg) ? 'CERT_UNRECOGNIZED'
    : /timeout/i.test(msg) ? 'TIMEOUT' : 'NETWORK_ERROR';
  return failure('hue', code, msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hue Bridge Discovery & Registration
// ─────────────────────────────────────────────────────────────────────────────

// Build a minimal mDNS PTR query for _hue._tcp.local — the discovery method
// Philips Hue currently supports (UPnP/SSDP discovery was deprecated by Philips).
function buildMdnsQuery() {
  const header = Buffer.alloc(12); // id=0, flags=0, qdcount set below
  header.writeUInt16BE(1, 4);
  const name = Buffer.from([4, ...Buffer.from('_hue'), 4, ...Buffer.from('_tcp'), 5, ...Buffer.from('local'), 0]);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(12, 0); // QTYPE PTR
  tail.writeUInt16BE(1, 2);  // QCLASS IN
  return Buffer.concat([header, name, tail]);
}

// Read a possibly-compressed DNS name at offset; returns {name, next}.
function readDnsName(buf, offset) {
  const labels = [];
  let pos = offset;
  let jumped = false;
  let next = offset;
  for (let guard = 0; guard < 128; guard++) {
    const len = buf[pos];
    if (len === 0) { if (!jumped) next = pos + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) next = pos + 2;
      jumped = true;
      pos = ptr;
      continue;
    }
    labels.push(buf.slice(pos + 1, pos + 1 + len).toString());
    pos += 1 + len;
    if (!jumped) next = pos;
  }
  return { name: labels.join('.'), next };
}

// Parse an mDNS response: returns {ptrNames:[], ips:[], bridgeIds:[]}.
function parseMdnsResponse(buf) {
  const out = { ptrNames: [], ips: [], bridgeIds: [] };
  if (!Buffer.isBuffer(buf) || buf.length < 12) return out;
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) {
    const q = readDnsName(buf, pos);
    pos = q.next + 4;
  }
  for (let i = 0; i < an && pos + 10 <= buf.length; i++) {
    const rr = readDnsName(buf, pos);
    pos = rr.next;
    const type = buf.readUInt16BE(pos);
    const rdlen = buf.readUInt16BE(pos + 8);
    const rdata = pos + 10;
    if (type === 12) { // PTR
      const t = readDnsName(buf, rdata);
      out.ptrNames.push(t.name);
    } else if (type === 1 && rdlen === 4) { // A
      out.ips.push(`${buf[rdata]}.${buf[rdata + 1]}.${buf[rdata + 2]}.${buf[rdata + 3]}`);
    } else if (type === 16) { // TXT
      let t = rdata;
      const end = rdata + rdlen;
      while (t < end) {
        const l = buf[t];
        const s = buf.slice(t + 1, t + 1 + l).toString();
        const m = s.match(/^bridgeid=(.+)$/i);
        if (m) out.bridgeIds.push(m[1]);
        t += 1 + l;
      }
    }
    pos = rdata + rdlen;
  }
  return out;
}

// LAN-native discovery: mDNS _hue._tcp.local, then verify each candidate by
// asking the bridge itself for its config (bridgeid present = real Hue).
// No Internet route required — multicast never leaves the LAN.
function discoverHueBridgeLocal(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const seen = new Set();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      resolve(value);
    };

    socket.on('message', async (msg) => {
      const parsed = parseMdnsResponse(msg);
      const hueish = parsed.ptrNames.some(n => /_hue\._tcp/i.test(n)) || parsed.bridgeIds.length > 0;
      if (!hueish) return;
      for (const ip of parsed.ips) {
        if (!net.isIP(ip) || seen.has(ip)) continue;
        seen.add(ip);
        try {
          // Fingerprint probe carries no credentials — legacy-allowed here so
          // an old bridge is still found (and labeled), even though credentialed
          // API calls to it require the explicit opt-in.
          const r = await hueRequest(ip, 'GET', '/api/config', null, 2500, { allowLegacyHttp: true });
          if (r.data && r.data.bridgeid) {
            done({ ip, id: r.data.bridgeid, source: 'mdns', transport: r.transport });
          }
        } catch { /* not a Hue responder */ }
      }
    });
    socket.on('error', () => done(null));

    socket.bind(0, () => {
      try {
        socket.addMembership('224.0.0.251');
        const query = buildMdnsQuery();
        socket.send(query, 0, query.length, 5353, '224.0.0.251');
      } catch { done(null); }
    });
    setTimeout(() => done(null), timeoutMs).unref?.();
  });
}

// Cloud-assisted discovery — optional fallback only. Returns source:'cloud' so
// callers/UI can distinguish it from LAN discovery.
async function discoverHueBridgeCloud() {
  try {
    const response = await fetchBounded('https://discovery.meethue.com', {}, 5000);
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0 && data[0].internalipaddress) {
      return { ip: data[0].internalipaddress, id: data[0].id, source: 'cloud' };
    }
  } catch (error) {
    console.error('Hue cloud discovery failed:', error.message);
  }
  return null;
}

// Discovery order: LAN mDNS first, cloud only as a labeled fallback.
async function findHueBridge() {
  const local = await discoverHueBridgeLocal().catch(() => null);
  if (local) return local;
  return discoverHueBridgeCloud();
}

async function registerHueBridge(bridgeIp) {
  try {
    const r = await hueRequest(bridgeIp, 'POST', '/api', { devicetype: 'LightsOut#SleepTimer' }, 10000);
    const data = r.data;
    if (Array.isArray(data) && data[0]?.success?.username) {
      return { username: data[0].success.username, transport: r.transport };
    }
    if (Array.isArray(data) && data[0]?.error) {
      return { error: data[0].error.description };
    }
    return { error: `Unexpected bridge response (HTTP ${r.status})` };
  } catch (error) {
    return { error: error.message };
  }
}

// Hue read helpers return { success, ... } — transport failures are truthful,
// never silently converted into an empty list that looks like "no lights".
async function getHueLights(bridgeIp, username) {
  try {
    const r = await hueRequest(bridgeIp, 'GET', `/api/${username}/lights`, null, 5000);
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Bridge returned HTTP ${r.status}`);
    const data = r.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return failure('hue', 'INVALID_RESPONSE', 'Unexpected bridge response');
    }
    const lights = [];
    for (const [id, light] of Object.entries(data)) {
      if (!light || !light.state) continue;
      lights.push({
        id: id,
        name: light.name,
        on: Boolean(light.state.on),
        bri: light.state.bri || 0,
        ct: light.state.ct || 0,
        type: light.type
      });
    }
    return result('hue', true, 'OK', `${lights.length} lights`, { lights, transport: r.transport, tls: r.tls });
  } catch (error) {
    return hueFailureFromError(error);
  }
}

async function getHueGroups(bridgeIp, username) {
  try {
    const r = await hueRequest(bridgeIp, 'GET', `/api/${username}/groups`, null, 5000);
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Bridge returned HTTP ${r.status}`);
    const data = r.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return failure('hue', 'INVALID_RESPONSE', 'Unexpected bridge response');
    }
    const groups = [];
    for (const [id, group] of Object.entries(data)) {
      groups.push({ id: id, name: group.name, type: group.type, lights: group.lights });
    }
    return result('hue', true, 'OK', `${groups.length} groups`, { groups, transport: r.transport });
  } catch (error) {
    return hueFailureFromError(error);
  }
}

async function setHueLightState(bridgeIp, username, lightId, lightState) {
  try {
    const r = await hueRequest(bridgeIp, 'PUT', `/api/${username}/lights/${lightId}/state`, lightState, 5000);
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Light ${lightId} returned HTTP ${r.status}`);
    const data = r.data;
    if (Array.isArray(data) && data.some(e => e && e.error)) {
      return failure('hue', 'BRIDGE_ERROR', data.find(e => e.error).error.description || 'Bridge rejected the state');
    }
    return result('hue', true, 'OK', `Light ${lightId} updated`);
  } catch (error) {
    return hueFailureFromError(error);
  }
}

async function setHueGroupState(bridgeIp, username, groupId, groupState) {
  try {
    const r = await hueRequest(bridgeIp, 'PUT', `/api/${username}/groups/${groupId}/action`, groupState, 5000);
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Group ${groupId} returned HTTP ${r.status}`);
    const data = r.data;
    if (Array.isArray(data) && data.some(e => e && e.error)) {
      return failure('hue', 'BRIDGE_ERROR', data.find(e => e.error).error.description || 'Bridge rejected the state');
    }
    return result('hue', true, 'OK', `Group ${groupId} updated`);
  } catch (error) {
    return hueFailureFromError(error);
  }
}

// Snapshot the current state of every light that is ON so a later cancel can
// put them back exactly where they were.
async function saveHueCurrentState(bridgeIp, username) {
  const res = await getHueLights(bridgeIp, username);
  if (res.success && Array.isArray(res.lights)) {
    state.originalLightState = res.lights
      .filter(l => l.on)
      .map(l => ({ id: l.id, on: true, bri: l.bri, ct: l.ct }));
  }
}

// Replay a captured snapshot onto a bridge. Pure w.r.t. module state — the
// caller owns the snapshot. Truthful per-light results; never throws.
async function restoreLightSnapshot(bridgeIp, username, snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return result('hue', true, 'NOTHING_TO_RESTORE', 'No captured light state');
  }
  if (!bridgeIp || !username) {
    return failure('hue', 'NOT_CONFIGURED', 'Hue not configured — captured state discarded');
  }
  const failed = [];
  for (const light of snapshot) {
    const body = { on: true, bri: light.bri, transitiontime: 10 };
    if (light.ct) body.ct = light.ct;
    const res = await setHueLightState(bridgeIp, username, light.id, body);
    if (!res.success) failed.push(light.id);
  }
  if (failed.length) {
    return failure('hue', 'RESTORE_PARTIAL', `Could not restore ${failed.length} light(s): ${failed.join(', ')}`);
  }
  return result('hue', true, 'RESTORED', `Restored ${snapshot.length} light(s)`);
}

// Restore the snapshot captured at dim start. Returns a truthful result —
// restoration failure is surfaced, never hidden, and never throws.
async function restoreHueOriginalState() {
  const snapshot = state.originalLightState;
  state.originalLightState = null;
  return restoreLightSnapshot(config.hueBridgeIp, config.hueUsername, snapshot);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Webhook
// ─────────────────────────────────────────────────────────────────────────────

// Trust model: the webhook is a user-configured LAN automation endpoint, so
// private/localhost targets are allowed by design. What is enforced: http(s)
// scheme only, method allowlist, bounded response, bounded timeout.
const HTTP_METHODS = ['GET', 'POST', 'PUT'];
const HTTP_MAX_RESPONSE = 64 * 1024;

function validateHttpTarget(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return { error: 'Invalid webhook URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Webhook URL must be http:// or https://' };
  }
  return { url };
}

async function invokeHttpLightAction(brightness = 254, colorTemp = 366, on = true) {
  if (!config.httpUrl) return failure('http', 'NOT_CONFIGURED', 'No webhook URL configured');
  const target = validateHttpTarget(config.httpUrl);
  if (target.error) return failure('http', 'INVALID_URL', target.error);
  const url = target.url;
  const method = HTTP_METHODS.includes(String(config.httpMethod).toUpperCase())
    ? String(config.httpMethod).toUpperCase() : 'POST';

  const bodyStr = config.httpBodyTemplate
    .replace(/\{\{BRIGHTNESS\}\}/g, brightness)
    .replace(/\{\{COLOR_TEMP\}\}/g, colorTemp)
    .replace(/\{\{ON\}\}/g, on ? 'true' : 'false');

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...config.httpHeaders
    },
    timeout: 5000
  };

  const client = url.protocol === 'https:' ? https : http;
  try {
    await new Promise((resolve, reject) => {
      const req = client.request(options, (res) => {
        let data = '';
        let tooBig = false;
        res.on('data', chunk => {
          if (tooBig) return;
          data += chunk;
          if (data.length > HTTP_MAX_RESPONSE) { tooBig = true; req.destroy(); }
        });
        res.on('end', () => {
          if (tooBig) return reject(new Error('Webhook response too large'));
          if (res.statusCode >= 400) {
            return reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
          }
          resolve();
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(bodyStr);
      req.end();
    });
  } catch (error) {
    return failure('http', 'TRANSPORT_ERROR', error.message);
  }
  return result('http', true, 'OK', `Sent ${method} to ${url.hostname}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate pacing: Philips documents ~10 light commands/sec and ~1 group
// command/sec. A dim tick fires once per second per LIGHT, so without
// serialization 12 selected lights would exceed the per-light budget. Sends
// are serialized with 120ms pacing; a tick that arrives while a batch is
// still draining is dropped rather than piled into an unbounded queue.
// ─────────────────────────────────────────────────────────────────────────────

let hueBatchBusy = false;
const HUE_LIGHT_PACE_MS = 120;

async function sendToHueTargets(ids, lightState) {
  const results = [];
  for (let i = 0; i < ids.length; i++) {
    results.push(await setHueLightState(config.hueBridgeIp, config.hueUsername, ids[i], lightState));
    if (i < ids.length - 1) await new Promise(r => setTimeout(r, HUE_LIGHT_PACE_MS));
  }
  return results;
}

function countFailures(results) {
  return results.filter(r => !r.success).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer Integration
// ─────────────────────────────────────────────────────────────────────────────

function startSmartLightDim(remainingSeconds) {
  if (!config.enabled || state.dimStarted) return;

  state.dimStarted = true;
  state.dimStartTime = Date.now();
  state.dimDurationMs = Math.min(remainingSeconds, config.dimMinutes * 60) * 1000;
  if (config.provider === 'wiz' && config.mode !== 'off_at_end') {
    const generation = ++wizGeneration;
    const addresses = [...config.wizAddresses];
    state.wizSnapshotPending = queueWizOperation(() => wizLights.readStates(addresses)).then(snapshot => {
      if (generation === wizGeneration) state.wizOriginalState = snapshot;
      return snapshot;
    }).catch(() => []);
  }

  if (config.provider === 'hue' && config.hueBridgeIp && config.hueUsername) {
    // Fire-and-forget snapshot; dim ticks proceed even if the snapshot is slow.
    saveHueCurrentState(config.hueBridgeIp, config.hueUsername)
      .catch(() => {});
  }
}

function updateSmartLightTick(remainingSeconds) {
  if (!config.enabled || !state.dimStarted) return;
  if (config.mode === 'off_at_end') return;

  const elapsedMs = Date.now() - state.dimStartTime;
  const progress = Math.min(1.0, Math.max(0.0, elapsedMs / state.dimDurationMs));

  // Calculate target brightness (254 -> 0)
  const targetBri = Math.round(254 * (1.0 - progress));

  // Calculate color temp for warm_dim mode (neutral 366 -> warm 500)
  const targetCt = config.mode === 'warm_dim'
    ? Math.round(366 + (134 * progress))
    : 366;

  // Transition time in 100ms units (smooth 1-second steps = 10)
  const transition = 10;

  switch (config.provider) {
    case 'wiz': {
      if (!wizBatchBusy && state.wizOriginalState) {
        wizBatchBusy = true;
        const generation = wizGeneration;
        const snapshot = state.wizOriginalState;
        const warm = config.mode === 'warm_dim';
        const look = config.wizLook;
        queueWizOperation(() => generation === wizGeneration ? wizLights.dimStates(snapshot, progress, warm, undefined,
          { look, isCurrent: () => generation === wizGeneration && config.enabled }) : null)
          .catch(() => {})
          .finally(() => { wizBatchBusy = false; });
      }
      break;
    }
    case 'hue': {
      const lightState = { bri: targetBri, transitiontime: transition };
      if (config.mode === 'warm_dim') lightState.ct = targetCt;
      if (targetBri <= 0) lightState.on = false;

      if (config.hueGroupId) {
        setHueGroupState(config.hueBridgeIp, config.hueUsername, config.hueGroupId, lightState)
          .catch(() => {});
      } else if (!hueBatchBusy) {
        const ids = config.hueLightIds.length > 0
          ? config.hueLightIds
          : (state.originalLightState || []).map(l => l.id);
        if (ids.length) {
          hueBatchBusy = true;
          sendToHueTargets(ids, lightState)
            .catch(() => {})
            .finally(() => { hueBatchBusy = false; });
        }
      }
      break;
    }
    case 'http': {
      invokeHttpLightAction(targetBri, targetCt, targetBri > 0)
        .catch(() => {});
      break;
    }
  }
}

async function invokeSmartLightAction({ on = true, brightness = 254, colorTemp = 366, transitionTime = 10, preservePower = false, released } = {}) {
  if (!config.enabled) return failure(config.provider || 'none', 'DISABLED', 'Smart Lights not enabled');
  return sendSmartLightAction({ on, brightness, colorTemp, transitionTime, preservePower, released });
}

async function sendSmartLightAction({ on = true, brightness = 254, colorTemp = 366, transitionTime = 10, preservePower = false, released } = {}) {

  const targetBri = Math.max(0, Math.min(254, Math.round(Number(brightness) || 0)));
  const targetCt = Math.max(153, Math.min(500, Math.round(Number(colorTemp) || 366)));
  const hueState = {
    on: Boolean(on) && targetBri > 0,
    bri: targetBri,
    transitiontime: Math.max(0, Math.round(Number(transitionTime) || 0))
  };
  if (targetCt) hueState.ct = targetCt;

  switch (config.provider) {
    case 'wiz': {
      const generation = wizGeneration, addresses = [...config.wizAddresses];
      return { provider: 'wiz', ...(await queueWizOperation(() => wizLights.setLights(addresses,
        { on, brightness: targetBri, colorTemp: targetCt }, undefined,
        { preservePower, released, isCurrent: () => generation === wizGeneration && config.enabled }))) };
    }
    case 'hue': {
      if (!config.hueBridgeIp || !config.hueUsername) {
        return failure('hue', 'NOT_CONFIGURED', 'Hue bridge/credential not configured');
      }
      if (config.hueGroupId) {
        return setHueGroupState(config.hueBridgeIp, config.hueUsername, config.hueGroupId, hueState);
      }
      let ids = config.hueLightIds.length > 0 ? [...config.hueLightIds] : [];
      if (ids.length === 0) {
        const res = await getHueLights(config.hueBridgeIp, config.hueUsername);
        if (!res.success) return res;
        ids = res.lights.map(light => light.id);
      }
      const results = await sendToHueTargets(ids, hueState);
      const failedCount = results.filter(r => !r.success).length;
      if (failedCount === results.length && results.length > 0) {
        return failure('hue', 'ALL_FAILED', `All ${failedCount} light updates failed`);
      }
      if (failedCount > 0) {
        return failure('hue', 'PARTIAL', `${failedCount} of ${results.length} light updates failed`);
      }
      return result('hue', true, 'OK', `${results.length} light(s) updated`);
    }
    case 'http':
      return invokeHttpLightAction(targetBri, targetCt, Boolean(on) && targetBri > 0);
    default:
      return failure(config.provider || 'none', 'NO_PROVIDER', 'No supported provider configured');
  }
}

async function applyScene(sceneId) {
  switch (String(sceneId || '').toLowerCase()) {
    case 'night':
      return invokeSmartLightAction({ on: true, brightness: 48, colorTemp: 460, transitionTime: 20 });
    case 'dim':
      return invokeSmartLightAction({ on: true, brightness: 96, colorTemp: 410, transitionTime: 15 });
    case 'off':
      return invokeSmartLightOff();
    default:
      return invokeSmartLightAction({});
  }
}

async function invokeSmartLightOff() {
  if (!config.enabled) return failure(config.provider || 'none', 'DISABLED', 'Smart Lights not enabled');

  let res;
  switch (config.provider) {
    case 'wiz': {
      wizGeneration++;
      const addresses = [...config.wizAddresses];
      const snapshot = state.wizOriginalState;
      res = await queueWizOperation(async () => {
        const active = snapshot ? addresses.filter(ip => snapshot.some(item => item.ip === ip && item.pilot.state && !item.released)) : addresses;
        return active.length ? { provider: 'wiz', ...(await wizLights.setLights(active, { on: false })) }
          : result('wiz', true, 'SKIPPED', 'Selected lights were left under manual control.');
      });
      break;
    }
    case 'hue': {
      const lightState = { on: false, transitiontime: 10 };
      if (config.hueGroupId) {
        res = await setHueGroupState(config.hueBridgeIp, config.hueUsername, config.hueGroupId, lightState);
      } else {
        const ids = config.hueLightIds.length > 0
          ? config.hueLightIds
          : (state.originalLightState || []).map(l => l.id);
        const results = await sendToHueTargets(ids, lightState);
        const failedCount = countFailures(results);
        res = failedCount === 0
          ? result('hue', true, 'OK', 'Lights off')
          : failure('hue', failedCount === results.length && results.length ? 'ALL_FAILED' : 'PARTIAL', `${failedCount} of ${results.length} lights failed to turn off`);
      }
      break;
    }
    case 'http': {
      res = await invokeHttpLightAction(0, 366, false);
      break;
    }
    default:
      res = failure(config.provider || 'none', 'NO_PROVIDER', 'No supported provider configured');
  }
  state.dimStarted = false;
  return res;
}

function resetSmartLightState() {
  wizGeneration++;
  state.wizOriginalState = null;
  state.wizSnapshotPending = null;
  state.dimStarted = false;
  state.originalLightState = null;
  state.dimStartTime = null;
  state.dimDurationMs = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification vs actuation
//
// verifySmartLightConnection() is PASSIVE: it must never change a light.
// testSmartLightAction() is the explicit actuating operation — it sends a real
// command and only a real success can produce verifiedConfigKey.
// ─────────────────────────────────────────────────────────────────────────────

async function verifySmartLightConnection() {
  switch (config.provider) {
    case 'wiz': {
      const verified = await wizLights.verify(config.wizAddresses);
      return { provider: 'wiz', ...verified, ...(verified.success ? { verifiedConfigKey: configurationKey() } : {}) };
    }
    case 'hue': {
      if (!config.hueBridgeIp || !config.hueUsername) {
        return failure('hue', 'NOT_CONFIGURED', 'Hue Bridge not configured');
      }
      const res = await getHueLights(config.hueBridgeIp, config.hueUsername);
      if (!res.success) return res;
      if (res.lights.length === 0) {
        return failure('hue', 'NO_LIGHTS', 'No lights found - check bridge IP/username');
      }
      const legacy = res.transport === 'http';
      return result('hue', true, 'VERIFIED',
        legacy ? `Connected: ${res.lights.length} lights found (legacy HTTP bridge — update firmware for HTTPS)` : `Connected: ${res.lights.length} lights found`,
        { verifiedConfigKey: configurationKey(), legacyHttp: legacy });
    }
    case 'http': {
      // A webhook cannot be verified passively: ANY request to it (GET, HEAD,
      // OPTIONS) may actuate a poorly-designed endpoint. Verify URL shape only
      // and require an explicit actuation test for enablement.
      const target = config.httpUrl ? validateHttpTarget(config.httpUrl) : { error: 'No webhook URL configured' };
      if (target.error) return failure('http', 'INVALID_URL', target.error);
      return failure('http', 'ACTUATION_REQUIRED',
        'HTTP webhooks cannot be verified without sending a request. Use "Send test action" — it will fire the webhook once.');
    }
    default:
      return failure('none', 'NO_PROVIDER', 'No provider selected');
  }
}

// Explicit actuating test. For Hue, turns configured lights (or all lights)
// on at full brightness. For HTTP, fires
// the configured webhook once with on=true/brightness=254.
async function testSmartLightAction() {
  switch (config.provider) {
    case 'wiz': {
      const look = config.wizLook;
      const sent = await queueWizOperation(() => wizLights.setLights(config.wizAddresses,
        { on: true, brightness: Math.round(look.brightness / 100 * 254), look }));
      return { provider: 'wiz', ...sent, ...(sent.success ? { verifiedConfigKey: configurationKey() } : {}) };
    }
    case 'hue': {
      if (!config.hueBridgeIp || !config.hueUsername) {
        return failure('hue', 'NOT_CONFIGURED', 'Hue Bridge not configured');
      }
      const res = await sendSmartLightAction({ on: true, brightness: 254, transitionTime: 5 });
      if (!res.success) return res;
      return result('hue', true, 'ACTION_SENT', 'Test action sent to Hue lights',
        { verifiedConfigKey: configurationKey() });
    }
    case 'http': {
      if (!config.httpUrl) return failure('http', 'NOT_CONFIGURED', 'No webhook URL configured');
      const res = await invokeHttpLightAction(254, 366, true);
      if (!res.success) return res;
      return result('http', true, 'ACTION_SENT', `Sent test action to ${config.httpUrl}`,
        { verifiedConfigKey: configurationKey() });
    }
    default:
      return failure('none', 'NO_PROVIDER', 'No provider selected');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Management
// ─────────────────────────────────────────────────────────────────────────────

function loadConfig(newConfig) {
  if (!newConfig) return;
  const merged = {
    ...config,
    provider: newConfig.provider !== undefined
      ? (SHIPPED_PROVIDERS.includes(newConfig.provider) ? newConfig.provider : 'none')
      : config.provider,
    mode: newConfig.mode || config.mode,
    dimMinutes: newConfig.dimMinutes !== undefined ? Number(newConfig.dimMinutes) : config.dimMinutes,
    enabled: newConfig.enabled !== undefined ? Boolean(newConfig.enabled) : config.enabled,
    wizAddresses: newConfig.wizAddresses !== undefined ? wizLights.normalizeAddresses(newConfig.wizAddresses) : config.wizAddresses,
    wizDevices: wizLights.normalizeDevices(newConfig.wizDevices ?? config.wizDevices, newConfig.wizAddresses ?? config.wizAddresses),
    wizLook: wizLights.normalizeLook(newConfig.wizLook ?? config.wizLook),
    hueBridgeIp: (newConfig.hueBridgeIp && net.isIP(String(newConfig.hueBridgeIp).trim()) !== 0) ? String(newConfig.hueBridgeIp).trim() : config.hueBridgeIp,
    hueAllowLegacyHttp: newConfig.hueAllowLegacyHttp !== undefined ? Boolean(newConfig.hueAllowLegacyHttp) : config.hueAllowLegacyHttp,
    // Empty string means "keep existing" so a redacted (blanked) renderer field
    // never clobbers the stored credential.
    hueUsername: newConfig.hueUsername || config.hueUsername,
    hueLightIds: newConfig.hueLightIds || config.hueLightIds,
    hueGroupId: newConfig.hueGroupId || config.hueGroupId,
    httpUrl: newConfig.httpUrl || config.httpUrl,
    httpMethod: newConfig.httpMethod || config.httpMethod,
    httpHeaders: newConfig.httpHeaders || config.httpHeaders,
    httpBodyTemplate: newConfig.httpBodyTemplate || config.httpBodyTemplate,
    verifiedConfigKey: newConfig.verifiedConfigKey || ''
  };
  merged.enabled = Boolean(merged.enabled && merged.verifiedConfigKey && merged.verifiedConfigKey === configurationKey(merged));
  if (!merged.enabled || configurationKey(merged) !== configurationKey(config) || merged.mode !== config.mode
      || JSON.stringify(merged.wizLook) !== JSON.stringify(config.wizLook)) resetSmartLightState();
  config = merged;
}

// Full config — main-process only. Never send to the renderer.
function getConfig() {
  return { ...config };
}

// Renderer-safe config: secret fields are replaced by presence indicators.
function getPublicConfig() {
  const publicConfig = { ...config };
  for (const [field, indicator] of Object.entries(SECRET_INDICATORS)) {
    const value = publicConfig[field];
    const present = typeof value === 'string' ? value.length > 0
      : (value && typeof value === 'object' ? Object.keys(value).length > 0 : false);
    publicConfig[indicator] = Boolean(present);
    delete publicConfig[field];
  }
  return publicConfig;
}

function shouldStartDim(remainingSeconds) {
  return config.enabled && !state.dimStarted && remainingSeconds <= config.dimMinutes * 60;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Configuration
  loadConfig,
  getConfig,
  getPublicConfig,
  configurationKey,
  SHIPPED_PROVIDERS,
  discoverWizLights: wizLights.discover,

  // Hue functions
  findHueBridge,
  discoverHueBridgeLocal,
  registerHueBridge,
  getHueLights,
  getHueGroups,

  // Timer integration
  startSmartLightDim,
  updateSmartLightTick,
  invokeSmartLightAction,
  applyScene,
  invokeSmartLightOff,
  restoreHueOriginalState,
  restoreWizOriginalState,
  restoreLightSnapshot,
  resetSmartLightState,
  shouldStartDim,

  // Verification (passive) vs actuation (explicit)
  verifySmartLightConnection,
  testSmartLightAction,
  // Back-compat alias for existing callers/tests; now passive, never actuates.
  testSmartLightConnection: verifySmartLightConnection,

  // Direct control (truthful results)
  setHueLightState,
  setHueGroupState,
  invokeHttpLightAction,

  // Exposed for unit tests
  buildMdnsQuery,
  parseMdnsResponse,
  isHueBridgeCertificate,
  hueRequest,
  httpHeadersDigest,
  validateHttpTarget
};
