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
const tls = require('tls');
const dgram = require('dgram');
const crypto = require('crypto');
const wizLights = require('./wizLights');
const { isPrivateOrLocal } = require('./capabilityTruth');
const lightExperience = require('./lightExperience');
// lightCues requires nothing, so this cannot form a cycle.
const lightCues = require('./lightCues');
const isExperience = mode => ['hourglass','orbit','ember'].includes(mode);

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
  timerBeacon: false,
  // Opt-in light cues (lightCues.js); never part of configurationKey, so a
  // toggle cannot cost the user their verification.
  cues: { ...lightCues.DEFAULT_CUE_SETTINGS },
  // Cue D: a short beacon on the already-dimmed WiZ lights when the grace
  // warning fires. Opt-in, never brighter than the dim level, never in Test
  // Mode (main does not tick the lights for a Test Mode run).
  imminentBeacon: false,
  // Hue settings
  hueBridgeIp: '',         // private/local IP literal, optionally with :port
  hueUsername: '',
  hueLightIds: [],         // array of light IDs (empty = all)
  hueGroupId: '',          // group/room ID (optional)
  hueAllowLegacyHttp: false, // explicit opt-in for pre-HTTPS firmware only
  // SHA-256 fingerprint of the bridge certificate (trust on first use). Not a
  // secret: anyone who connects to the bridge sees the same certificate. It is
  // pinned at Register, or on the first good HTTPS answer for a setup paired
  // before pinning existed, and is not part of configurationKey().
  hueCertFingerprint: '',
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

// Digest of a credential-bearing field. verifiedConfigKey is stored in plain
// settings, sent to the renderer and compared only for equality, so it holds
// the Hue key, webhook URL and body template only in this form.
function secretDigest(value) {
  return '#' + crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

// The certificate pin is deliberately not part of this key: pinning a setup
// that was verified before pinning existed must not un-verify it. A different
// bridge changes the address or (after Register) the key, and loadConfig drops
// the verification when a pin is replaced by a different one.
function configurationKey(value = config) {
  const provider = value.provider || 'none';
  if (provider === 'wiz') {
    const ips = wizLights.normalizeAddresses(value.wizAddresses);
    return ips.length ? `wiz:${ips.join(',')}` : '';
  }
  if (provider === 'hue') return `hue:${value.hueBridgeIp || ''}:${secretDigest(value.hueUsername)}:${value.hueGroupId || ''}`;
  if (provider === 'http') return `http:${value.httpMethod || 'POST'}:${secretDigest(value.httpUrl)}:${httpHeadersDigest(value.httpHeaders)}:${secretDigest(value.httpBodyTemplate)}`;
  return '';
}

// The key format saved by builds before 11.3: the same fields with the Hue
// key, webhook URL and body template in plaintext. Only ever compared.
function legacyConfigurationKey(value = config) {
  const provider = value.provider || 'none';
  if (provider === 'hue') return `hue:${value.hueBridgeIp || ''}:${value.hueUsername || ''}:${value.hueGroupId || ''}`;
  if (provider === 'http') return `http:${value.httpMethod || 'POST'}:${value.httpUrl || ''}:${httpHeadersDigest(value.httpHeaders)}:${value.httpBodyTemplate || ''}`;
  return '';
}

const DIGEST_KEY_FORMS = [
  /^hue:.*:#[0-9a-f]{16}:[^:]*$/,
  /^http:[^:]*:#[0-9a-f]{16}:(none|[0-9a-f]{16}):#[0-9a-f]{16}$/
];

// A saved key that still matches this exact setup in the old plaintext form
// becomes the digest form, so the verification survives the upgrade. An
// old-form Hue / webhook key that matches nothing is dropped rather than kept
// with credentials in it (it could not enable anything anyway).
function migrateVerifiedConfigKey(key, value, currentKey = configurationKey(value)) {
  if (!key || key === currentKey) return key;
  if (key === legacyConfigurationKey(value)) return currentKey;
  if (/^(hue|http):/.test(key) && !DIGEST_KEY_FORMS.some(form => form.test(key))) return '';
  return key;
}

// Runtime state
let state = {
  dimStarted: false,
  // Hue dim targets captured at dim start: [{id, on, bri, ct, colormode, xy,
  // hue, sat, lastBri, lastCt, changed, colorChanged, released}]
  originalLightState: null,
  hueSnapshotPending: null,
  hueSnapshotAttemptAt: 0,
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

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// fetch() does not honor a `timeout` RequestInit — bound every outbound call
// with AbortSignal so a blackholed endpoint fails truthfully.
function fetchBounded(url, options = {}, timeoutMs = 5000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hue transport
//
// Philips Hue firmware after the EU RED change serves the local API over
// HTTPS only; older bridges still answer HTTP, which is used only with the
// explicit "Allow legacy HTTP bridge" opt-in.
//
// A bridge certificate is issued by the bridge itself or by the Hue CA, so
// chain validation can never succeed — and when it fails Node skips
// checkServerIdentity altogether, so a CN check there never ran. Bridge
// identity is trust on first use instead: the certificate's SHA-256
// fingerprint is pinned at Register (or on the first good HTTPS answer for a
// setup paired before pinning existed). Every credentialed request opens the
// TLS connection itself, compares the fingerprint on secureConnect and only
// then hands the socket to https.request, so nothing — not the Hue key in the
// path, not a body — is written to a bridge whose certificate does not match.
// The unauthenticated discovery probe (/api/config) carries no credential and
// is not pinned.
//
// Every request has an absolute deadline covering the TCP connect, the TLS
// handshake and the response body, so a bridge that accepts the connection and
// never answers fails within timeoutMs.
// ─────────────────────────────────────────────────────────────────────────────

const HUE_DEFAULT_PORTS = { https: 443, http: 80 };
const HUE_MAX_RESPONSE = 256 * 1024;
const hueTransportCache = new Map(); // host -> 'https' | 'http'
const sessionHuePins = new Map();     // host key -> fingerprint, for bridges other than the configured one
const registeredHuePins = new Map();  // host key -> { fingerprint, username } from a successful Register
let persistConfigPatch = null;

const CERT_CHANGED_MESSAGE = 'The Hue Bridge presented a different security certificate than the one Lights Out paired with, so nothing was sent to it. If you replaced or reset the bridge, Register the bridge again: press its link button, then Register.';
const HUE_UNAUTHORIZED_MESSAGE = 'The Hue Bridge no longer accepts the key Lights Out registered. Register the bridge again: press its link button, then Register.';

// Parse a Hue bridge host ("192.168.1.5", "127.0.0.1:8080", "fd00::1",
// "[::1]:8080") and enforce that it resolves to a private/local IP literal.
function parseHueHost(rawHost) {
  const raw = String(rawHost || '').trim();
  if (!raw) return null;
  let hostname = raw;
  let port = null;
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close <= 1) return null;
    hostname = raw.slice(1, close);
    const rest = raw.slice(close + 1);
    if (rest) {
      if (!/^:\d{1,5}$/.test(rest)) return null;
      port = Number(rest.slice(1));
    }
  } else if (net.isIP(raw) === 6) {
    hostname = raw;
  } else {
    const colon = raw.lastIndexOf(':');
    if (colon > 0 && raw.indexOf(':') === colon) {
      const candidateHost = raw.slice(0, colon);
      const candidatePort = raw.slice(colon + 1);
      if (!/^\d{1,5}$/.test(candidatePort)) return null;
      hostname = candidateHost;
      port = Number(candidatePort);
    }
  }
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
  if (net.isIP(hostname) === 0 || !isPrivateOrLocal(hostname)) return null;
  return { hostname, port };
}

function hueHostKey(host) {
  const parsed = parseHueHost(host);
  return parsed ? `${parsed.hostname.toLowerCase()}#${parsed.port || ''}` : '';
}

// Node reports fingerprint256 as "AB:CD:…" (32 colon-separated bytes).
function normalizeFingerprint(value) {
  const text = String(value || '').trim().toUpperCase();
  if (/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(text)) return text;
  if (/^[0-9A-F]{64}$/.test(text)) return text.match(/../g).join(':');
  return '';
}

function hueError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  return Object.assign(error, extra);
}

function safeHueSegment(value, label) {
  const cleaned = String(value == null ? '' : value).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(cleaned)) {
    throw hueError('INVALID_INPUT', `Invalid Hue ${label}`);
  }
  return encodeURIComponent(cleaned);
}

// The pin to enforce for a request to this host. A fresh Register wins for the
// key it produced (the bridge may have been reset and present a new
// certificate); otherwise the configured bridge uses its persisted pin and any
// other host the pin it presented first in this session.
function knownHuePin(hostKey, credential) {
  if (!hostKey) return '';
  const registered = registeredHuePins.get(hostKey);
  if (registered && credential && registered.username === credential) return registered.fingerprint;
  if (hostKey === hueHostKey(config.hueBridgeIp) && config.hueCertFingerprint) return config.hueCertFingerprint;
  return sessionHuePins.get(hostKey) || '';
}

// Trust on first use. A pin is never replaced at runtime — only Register (via
// loadConfig) can move it to a new certificate.
function commitHuePin(hostKey, fingerprint) {
  if (!hostKey || !fingerprint) return false;
  if (hostKey === hueHostKey(config.hueBridgeIp)) {
    if (config.hueCertFingerprint) return false;
    config.hueCertFingerprint = fingerprint;
    if (persistConfigPatch) {
      try { persistConfigPatch({ hueCertFingerprint: fingerprint }); }
      catch (error) { console.warn('Smart lights: could not save the Hue certificate pin:', error && error.message); }
    }
    return true;
  }
  if (sessionHuePins.has(hostKey)) return false;
  sessionHuePins.set(hostKey, fingerprint);
  return true;
}

// Main registers how a non-secret config change made at runtime (the
// first-use certificate pin) reaches the settings store. Without it the pin
// stays in getConfig() and is saved with the next settings save.
function setConfigPersistence(handler) {
  persistConfigPatch = typeof handler === 'function' ? handler : null;
}

// Errors that mean "the other side is plain HTTP, not TLS".
function isTlsMismatchError(err) {
  const code = err && (err.code || '');
  const msg = (err && err.message) || '';
  return code === 'EPROTO' || code === 'ECONNRESET' || code === 'ERR_SSL_WRONG_VERSION_NUMBER'
    || /wrong version|ssl routines|unknown protocol|packet length too long/i.test(msg);
}

// An HTTPS attempt that failed before any request byte was written (refused,
// reset, plain HTTP on the port, or no handshake in time) — the only failures
// that may fall back to legacy HTTP. A certificate mismatch never does.
function isHttpsSetupFailure(err) {
  if (!err || err.phase !== 'connect') return false;
  if (err.code === 'CERT_CHANGED' || err.code === 'CERT_UNAVAILABLE') return false;
  return err.handshakeTimeout === true || err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || isTlsMismatchError(err);
}

function isHueUnauthorized(data) {
  return Array.isArray(data) && data.some(entry => entry && entry.error && Number(entry.error.type) === 1);
}

function rawHueRequest(transport, host, method, path, bodyObj, timeoutMs, { expectedFingerprint = '', handshakeMs = timeoutMs, ports = null } = {}) {
  return new Promise((resolve, reject) => {
    const parsedHost = parseHueHost(host);
    if (!parsedHost) {
      reject(hueError('INVALID_BRIDGE_ADDRESS', 'Hue bridge address must be a private/local IP address'));
      return;
    }
    const { hostname } = parsedHost;
    const port = parsedHost.port || Number(ports && ports[transport]) || HUE_DEFAULT_PORTS[transport];
    const payload = bodyObj !== undefined && bodyObj !== null ? JSON.stringify(bodyObj) : null;
    let settled = false;
    let tlsVerified = false;
    let socket = null;
    let req = null;
    let fingerprint = '';
    let identity = '';
    const timers = [];
    const cleanup = () => {
      try { if (req) req.destroy(); } catch { /* already gone */ }
      try { if (socket) socket.destroy(); } catch { /* already gone */ }
    };
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      cleanup();
      if (err) reject(err);
      else resolve(value);
    };
    timers.push(setTimeout(() => finish(hueError('TIMEOUT', `Hue Bridge timed out after ${formatDuration(timeoutMs)}`,
      { phase: transport === 'https' && !tlsVerified ? 'connect' : 'response' })), timeoutMs));
    if (transport === 'https' && handshakeMs < timeoutMs) {
      timers.push(setTimeout(() => {
        if (!tlsVerified) finish(hueError('TIMEOUT', `Hue Bridge did not complete the HTTPS handshake within ${formatDuration(handshakeMs)}`, { phase: 'connect', handshakeTimeout: true }));
      }, handshakeMs));
    }

    const send = (createConnection) => {
      const headers = { 'Content-Type': 'application/json' };
      if (payload !== null) headers['Content-Length'] = Buffer.byteLength(payload);
      const options = { hostname, port, path, method, headers };
      if (createConnection) options.createConnection = createConnection;
      else options.agent = false;
      try {
        req = (transport === 'https' ? https : http).request(options, (res) => {
          let data = '';
          let size = 0;
          res.setEncoding('utf8');
          res.on('data', chunk => {
            size += chunk.length;
            if (size > HUE_MAX_RESPONSE) {
              finish(hueError('RESPONSE_TOO_LARGE', 'Hue Bridge response too large'));
              return;
            }
            data += chunk;
          });
          res.on('end', () => finish(null, { status: res.statusCode || 0, body: data, fingerprint, identity }));
          res.on('error', err => finish(err));
        });
      } catch (err) {
        finish(err);
        return;
      }
      req.on('error', err => finish(err));
      if (payload !== null) req.write(payload);
      req.end();
    };

    if (transport !== 'https') {
      send(null);
      return;
    }

    try {
      socket = tls.connect({ host: hostname, port, rejectUnauthorized: false });
    } catch (err) {
      finish(Object.assign(err, { phase: 'connect' }));
      return;
    }
    const tlsSocket = socket;
    tlsSocket.on('error', err => finish(tlsVerified ? err : Object.assign(err, { phase: 'connect' })));
    tlsSocket.once('secureConnect', () => {
      if (settled) return;
      let cert = null;
      try { cert = tlsSocket.getPeerCertificate(); } catch { cert = null; }
      fingerprint = normalizeFingerprint(cert && cert.fingerprint256);
      if (!fingerprint) {
        finish(hueError('CERT_UNAVAILABLE', 'The Hue Bridge presented no certificate, so nothing was sent to it.', { phase: 'connect' }));
        return;
      }
      if (expectedFingerprint && fingerprint !== expectedFingerprint) {
        finish(hueError('CERT_CHANGED', CERT_CHANGED_MESSAGE, { phase: 'connect' }));
        return;
      }
      tlsVerified = true;
      identity = isHueBridgeCertificate(cert).reason;
      send(() => tlsSocket);
    });
  });
}

// Heuristic: a real Hue bridge cert is issued for the bridge (CN is typically
// the 16-hex-digit bridgeid) by the Hue chain. Returns {trusted, reason}.
// Informational only — never a trust decision: anyone can mint a certificate
// with a 16-hex CN. Identity is the pinned fingerprint (see rawHueRequest).
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
// pin: 'enforce' (default — compare with the known pin, or pin on first use),
// 'capture' (Register: report the fingerprint, enforce nothing) or 'none'
// (the unauthenticated discovery probe). credential: the Hue key in the path,
// so a freshly registered key is checked against its own Register pin.
// transportPorts: { https, http } for a host given without a port (tests).
async function hueRequest(host, method, path, bodyObj, timeoutMs = 5000, { allowLegacyHttp = config.hueAllowLegacyHttp, cacheTransport = true, pin = 'enforce', credential = '', transportPorts = null } = {}) {
  if (!parseHueHost(host)) {
    throw hueError('INVALID_BRIDGE_ADDRESS', 'Hue bridge address refused: must be a private/local IP address');
  }
  const budget = Math.max(1, Math.round(Number(timeoutMs) || 5000));
  const deadline = performance.now() + budget;
  const hostKey = hueHostKey(host);
  const knownPin = pin === 'none' ? '' : knownHuePin(hostKey, credential);
  const expected = pin === 'enforce' ? knownPin : '';
  // A bridge with a pin has proven it speaks HTTPS: never downgrade it.
  const legacyAllowed = Boolean(allowLegacyHttp) && !knownPin;

  const attempt = async (transport, canFallBack) => {
    const remaining = Math.max(1, Math.round(deadline - performance.now()));
    const r = await rawHueRequest(transport, host, method, path, bodyObj, remaining, {
      expectedFingerprint: transport === 'https' ? expected : '',
      // Leave time for the legacy HTTP attempt when it is allowed.
      handshakeMs: canFallBack ? Math.max(1, Math.floor(remaining / 2)) : remaining,
      ports: transportPorts
    });
    if (cacheTransport) hueTransportCache.set(host, transport);
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { /* keep raw */ }
    const ok = r.status >= 200 && r.status < 300;
    let firstUse = false;
    if (transport === 'https' && pin === 'enforce' && !expected && ok && parsed !== null && typeof parsed === 'object' && !isHueUnauthorized(parsed)) {
      firstUse = commitHuePin(hostKey, r.fingerprint);
    }
    return {
      ok,
      status: r.status,
      data: parsed !== null ? parsed : r.body,
      transport,
      tls: transport === 'https'
        ? { pinned: Boolean(expected) || firstUse, firstUse, identity: r.identity }
        : { legacy: true },
      certificateFingerprint: transport === 'https' ? r.fingerprint : ''
    };
  };

  if (hueTransportCache.get(host) === 'http' && legacyAllowed) return attempt('http', false);
  try {
    return await attempt('https', legacyAllowed);
  } catch (err) {
    if (!isHttpsSetupFailure(err)) throw err;
    if (!legacyAllowed) {
      if (isTlsMismatchError(err) && err.code !== 'ECONNRESET') {
        throw hueError('HTTPS_REQUIRED', knownPin
          ? 'This Hue Bridge was paired over HTTPS and now answers only plain HTTP, so nothing was sent. Register the bridge again if you replaced it.'
          : 'Bridge answered HTTP only — enable "Allow legacy HTTP bridge" to use pre-HTTPS firmware');
      }
      throw err;
    }
    if (deadline - performance.now() < 1) throw err;
    // Refused, reset, plain HTTP on 443 or no handshake in time: a pre-HTTPS
    // bridge, and the user opted into legacy HTTP for it.
    return attempt('http', false);
  }
}

function hueFailureFromError(error) {
  const msg = error && error.message ? error.message : String(error);
  const known = ['HTTPS_REQUIRED', 'INVALID_BRIDGE_ADDRESS', 'CERT_CHANGED', 'CERT_UNAVAILABLE', 'TIMEOUT', 'RESPONSE_TOO_LARGE', 'INVALID_INPUT'];
  const code = error && known.includes(error.code) ? error.code
    : /timeout|timed out/i.test(msg) ? 'TIMEOUT' : 'NETWORK_ERROR';
  return failure('hue', code, msg);
}

// Bridge-level error array → truthful failure. Type 1 is an unknown/revoked
// key; type 201 means the light is switched off (it rejects bri/ct while off).
function hueBridgeFailure(data, fallbackMessage) {
  if (!Array.isArray(data)) return null;
  const errors = data.filter(entry => entry && entry.error).map(entry => entry.error);
  if (!errors.length) return null;
  if (errors.some(e => Number(e.type) === 1)) return failure('hue', 'UNAUTHORIZED', HUE_UNAUTHORIZED_MESSAGE);
  if (errors.every(e => Number(e.type) === 201)) {
    return result('hue', false, 'LIGHT_OFF', 'The light is switched off, so it was left under manual control.', { released: true });
  }
  return failure('hue', 'BRIDGE_ERROR', errors[0].description || fallbackMessage);
}

// One credentialed Hue API call. Never throws.
async function hueApi(bridgeIp, username, method, subpath, body, timeoutMs = 5000) {
  const safeUser = safeHueSegment(username, 'username');
  return hueRequest(bridgeIp, method, `/api/${safeUser}${subpath}`, body, timeoutMs, { credential: String(username).trim() });
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
  const visited = new Set();
  for (let guard = 0; guard < 128; guard++) {
    if (pos < 0 || pos >= buf.length || visited.has(pos)) {
      return { name: labels.join('.'), next: buf.length };
    }
    visited.add(pos);
    const len = buf[pos];
    if (len === 0) { if (!jumped) next = pos + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) return { name: labels.join('.'), next: buf.length };
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) next = pos + 2;
      jumped = true;
      pos = ptr;
      continue;
    }
    if ((len & 0xc0) !== 0 || pos + 1 + len > buf.length) {
      return { name: labels.join('.'), next: buf.length };
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
  for (let i = 0; i < qd && pos < buf.length; i++) {
    const q = readDnsName(buf, pos);
    if (q.next + 4 > buf.length) return out;
    pos = q.next + 4;
  }
  for (let i = 0; i < an && pos < buf.length; i++) {
    const rr = readDnsName(buf, pos);
    pos = rr.next;
    if (pos + 10 > buf.length) break;
    const type = buf.readUInt16BE(pos);
    const rdlen = buf.readUInt16BE(pos + 8);
    const rdata = pos + 10;
    if (rdata + rdlen > buf.length) break;
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
        if (t + 1 + l > end) break;
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
      let parsed;
      try { parsed = parseMdnsResponse(msg); } catch { return; }
      const hueish = parsed.ptrNames.some(n => /_hue\._tcp/i.test(n)) || parsed.bridgeIds.length > 0;
      if (!hueish) return;
      for (const ip of parsed.ips) {
        if (!net.isIP(ip) || !isPrivateOrLocal(ip) || seen.has(ip)) continue;
        seen.add(ip);
        try {
          // Fingerprint probe carries no credentials — legacy-allowed and
          // unpinned here so an old bridge is still found (and labeled),
          // without caching plain HTTP or a pin for later credentialed requests.
          const r = await hueRequest(ip, 'GET', '/api/config', null, 2500, { allowLegacyHttp: true, cacheTransport: false, pin: 'none' });
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
      const ip = String(data[0].internalipaddress).trim();
      if (net.isIP(ip) !== 0 && isPrivateOrLocal(ip)) {
        return { ip, id: data[0].id, source: 'cloud' };
      }
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

// Register is the trust-on-first-use moment: the user pressed the link button
// on the bridge, so the certificate that answered is pinned for the key it
// returned. loadConfig adopts that pin when this key is saved.
async function registerHueBridge(bridgeIp) {
  try {
    const r = await hueRequest(bridgeIp, 'POST', '/api', { devicetype: 'LightsOut#SleepTimer' }, 10000, { pin: 'capture' });
    const data = r.data;
    if (Array.isArray(data) && data[0]?.success?.username) {
      const username = String(data[0].success.username);
      const certificatePinned = r.transport === 'https' && Boolean(r.certificateFingerprint);
      if (certificatePinned) {
        const hostKey = hueHostKey(bridgeIp);
        registeredHuePins.delete(hostKey);
        registeredHuePins.set(hostKey, { fingerprint: r.certificateFingerprint, username });
        while (registeredHuePins.size > 16) registeredHuePins.delete(registeredHuePins.keys().next().value);
      }
      return { username, transport: r.transport, certificatePinned };
    }
    if (Array.isArray(data) && data[0]?.error) {
      return { error: data[0].error.description };
    }
    return { error: `Unexpected bridge response (HTTP ${r.status})` };
  } catch (error) {
    return { error: error.message };
  }
}

function hueLightFromApi(id, light) {
  const s = light.state;
  return {
    id: String(id),
    name: light.name,
    on: Boolean(s.on),
    bri: s.bri || 0,
    ct: s.ct || 0,
    colormode: typeof s.colormode === 'string' ? s.colormode : '',
    xy: Array.isArray(s.xy) ? s.xy.slice(0, 2) : null,
    hue: Number.isFinite(s.hue) ? s.hue : null,
    sat: Number.isFinite(s.sat) ? s.sat : null,
    reachable: s.reachable !== false,
    type: light.type
  };
}

// Hue read helpers return { success, ... } — transport failures are truthful,
// never silently converted into an empty list that looks like "no lights".
function hueTimeout(options, fallback = 5000) {
  const value = Number(options && options.timeoutMs);
  return Number.isFinite(value) && value > 0 ? Math.min(fallback, Math.round(value)) : fallback;
}

async function getHueLights(bridgeIp, username, options = {}) {
  try {
    const r = await hueApi(bridgeIp, username, 'GET', '/lights', null, hueTimeout(options));
    const bridgeError = hueBridgeFailure(r.data, 'Bridge rejected the request');
    if (bridgeError) return bridgeError;
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Bridge returned HTTP ${r.status}`);
    const data = r.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return failure('hue', 'INVALID_RESPONSE', 'Unexpected bridge response');
    }
    const lights = [];
    for (const [id, light] of Object.entries(data)) {
      if (!light || !light.state) continue;
      lights.push(hueLightFromApi(id, light));
    }
    return result('hue', true, 'OK', `${lights.length} lights`, { lights, transport: r.transport, tls: r.tls });
  } catch (error) {
    return hueFailureFromError(error);
  }
}

// Live state of one light (restore and power-preserving actions read it
// immediately before writing).
async function getHueLight(bridgeIp, username, lightId) {
  try {
    const safeLight = safeHueSegment(lightId, 'light ID');
    const r = await hueApi(bridgeIp, username, 'GET', `/lights/${safeLight}`, null);
    const bridgeError = hueBridgeFailure(r.data, `Light ${lightId} could not be read`);
    if (bridgeError) return bridgeError;
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Light ${lightId} returned HTTP ${r.status}`);
    if (!r.data || typeof r.data !== 'object' || !r.data.state) return failure('hue', 'INVALID_RESPONSE', 'Unexpected bridge response');
    return result('hue', true, 'OK', `Light ${lightId} read`, { light: hueLightFromApi(lightId, r.data) });
  } catch (error) {
    return hueFailureFromError(error);
  }
}

async function getHueGroups(bridgeIp, username, options = {}) {
  try {
    const r = await hueApi(bridgeIp, username, 'GET', '/groups', null, hueTimeout(options));
    const bridgeError = hueBridgeFailure(r.data, 'Bridge rejected the request');
    if (bridgeError) return bridgeError;
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

// Member light IDs of one group/room.
async function getHueGroupMembers(bridgeIp, username, groupId) {
  try {
    const safeGroup = safeHueSegment(groupId, 'group ID');
    const r = await hueApi(bridgeIp, username, 'GET', `/groups/${safeGroup}`, null);
    const bridgeError = hueBridgeFailure(r.data, `Group ${groupId} could not be read`);
    if (bridgeError) return bridgeError;
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Group ${groupId} returned HTTP ${r.status}`);
    if (!r.data || typeof r.data !== 'object' || !Array.isArray(r.data.lights)) return failure('hue', 'INVALID_RESPONSE', 'Unexpected bridge response');
    return result('hue', true, 'OK', `Group ${groupId} read`, { lights: r.data.lights.map(String) });
  } catch (error) {
    return hueFailureFromError(error);
  }
}

async function setHueLightState(bridgeIp, username, lightId, lightState, options = {}) {
  try {
    const safeLight = safeHueSegment(lightId, 'light ID');
    const r = await hueApi(bridgeIp, username, 'PUT', `/lights/${safeLight}/state`, lightState, hueTimeout(options));
    const bridgeError = hueBridgeFailure(r.data, 'Bridge rejected the state');
    if (bridgeError) return bridgeError;
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Light ${lightId} returned HTTP ${r.status}`);
    return result('hue', true, 'OK', `Light ${lightId} updated`);
  } catch (error) {
    return hueFailureFromError(error);
  }
}

async function setHueGroupState(bridgeIp, username, groupId, groupState) {
  try {
    const safeGroup = safeHueSegment(groupId, 'group ID');
    const r = await hueApi(bridgeIp, username, 'PUT', `/groups/${safeGroup}/action`, groupState);
    const bridgeError = hueBridgeFailure(r.data, 'Bridge rejected the state');
    if (bridgeError) return bridgeError;
    if (!r.ok) return failure('hue', 'HTTP_' + r.status, `Group ${groupId} returned HTTP ${r.status}`);
    return result('hue', true, 'OK', `Group ${groupId} updated`);
  } catch (error) {
    return hueFailureFromError(error);
  }
}

// Snapshot ONLY the dim targets: the configured light IDs, else the members of
// the configured group, else (no selection) every light — and of those only
// the lights that are on, so a light that is off is never touched. Returns the
// snapshot, or null when the bridge could not be read.
async function saveHueCurrentState(bridgeIp, username) {
  let scope = null;
  if (config.hueLightIds.length) scope = new Set(config.hueLightIds.map(String));
  else if (config.hueGroupId) {
    const group = await getHueGroupMembers(bridgeIp, username, config.hueGroupId);
    if (!group.success) return null;
    scope = new Set(group.lights);
  }
  const res = await getHueLights(bridgeIp, username);
  if (!res.success || !Array.isArray(res.lights)) return null;
  return res.lights
    .filter(l => l.on && (!scope || scope.has(String(l.id))))
    .map(l => ({
      id: String(l.id), on: true, bri: l.bri, ct: l.ct, colormode: l.colormode, xy: l.xy, hue: l.hue, sat: l.sat,
      lastBri: l.bri, lastCt: l.ct, changed: false, colorChanged: false, released: false
    }));
}

// The state a cancel puts back: brightness (and colour only if warm dimming
// changed it). Never `on` — a restore must not switch a light on.
function hueRestoreState(light) {
  const body = {};
  const bri = Math.round(Number(light.bri));
  if (bri > 0) body.bri = Math.max(1, Math.min(254, bri));
  if (light.colorChanged !== false) {
    if (light.colormode === 'xy' && Array.isArray(light.xy)) body.xy = light.xy;
    else if (light.colormode === 'hs' && Number.isFinite(light.hue)) {
      body.hue = light.hue;
      if (Number.isFinite(light.sat)) body.sat = light.sat;
    } else if (Number(light.ct) > 0) body.ct = light.ct;
  }
  if (!Object.keys(body).length) return null;
  body.transitiontime = 10;
  return body;
}

// Replay a captured snapshot onto a bridge. Pure w.r.t. module state — the
// caller owns the snapshot. Each light is read live first: a light that is now
// off, or was released (switched off mid-run), stays off. Truthful per-light
// results; never throws.
async function restoreLightSnapshot(bridgeIp, username, snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return result('hue', true, 'NOTHING_TO_RESTORE', 'No captured light state');
  }
  if (!bridgeIp || !username) {
    return failure('hue', 'NOT_CONFIGURED', 'Hue not configured — captured state discarded');
  }
  const targets = snapshot.filter(l => l && l.on !== false && !l.released && l.changed !== false);
  if (!targets.length) {
    return result('hue', true, 'NOTHING_TO_RESTORE', 'No dimmed light to restore');
  }
  let restored = 0;
  let manual = 0;
  const failed = [];
  const results = await forEachHueLight(targets.map(l => l.id), async (id) => {
    const light = targets.find(l => l.id === id);
    const live = await getHueLight(bridgeIp, username, id);
    if (!live.success) { failed.push(id); return live; }
    if (!live.light.on) { light.released = true; manual++; return { success: true, skipped: true }; }
    const body = hueRestoreState(light);
    if (!body) return { success: true, skipped: true };
    const res = await setHueLightState(bridgeIp, username, id, body);
    if (res.released) { light.released = true; manual++; return { success: true, skipped: true }; }
    if (!res.success) failed.push(id);
    else restored++;
    return res;
  });
  const fatal = hueFatal(results);
  for (const r of results) if (r.unattempted && !failed.includes(r.id)) failed.push(r.id);
  if (fatal) return failure('hue', fatal.code, fatal.message);
  if (failed.length) {
    return failure('hue', 'RESTORE_PARTIAL', `Could not restore ${failed.length} light(s): ${failed.join(', ')}`);
  }
  return result('hue', true, 'RESTORED', `Restored ${restored} light(s)${manual ? `; ${manual} switched off by hand stayed off` : ''}`);
}

// Restore the snapshot captured at dim start. Returns a truthful result —
// restoration failure is surfaced, never hidden, and never throws.
async function restoreHueOriginalState() {
  hueGeneration++;
  const snapshot = state.originalLightState;
  const pending = state.hueSnapshotPending;
  const bridgeIp = config.hueBridgeIp;
  const username = config.hueUsername;
  state.originalLightState = null;
  state.hueSnapshotPending = null;
  return queueHueOperation(async () => restoreLightSnapshot(bridgeIp, username, snapshot || (pending ? await pending : null)));
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Webhook
// ─────────────────────────────────────────────────────────────────────────────

// Trust model: the webhook is a user-configured LAN automation endpoint, so
// private/localhost targets are allowed by design. What is enforced: http(s)
// scheme only, method allowlist, bounded response, absolute deadline, and
// only a 2xx answer counts as success.
const HTTP_METHODS = ['GET', 'POST', 'PUT'];
const HTTP_MAX_RESPONSE = 64 * 1024;
const HTTP_TIMEOUT_MS = 5000;
let httpInFlight = null; // the dim tick request still on the wire

function validateHttpTarget(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return { error: 'Invalid webhook URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Webhook URL must be http:// or https://' };
  }
  return { url };
}

// The webhook URL path and query often carry the secret (a Home Assistant
// webhook id, a token): messages show scheme://host only.
function webhookOrigin(rawUrl) {
  const target = validateHttpTarget(rawUrl);
  return target.url ? `${target.url.protocol}//${target.url.host}` : 'the webhook';
}

async function invokeHttpLightAction(brightness = 254, colorTemp = 366, on = true, { timeoutMs = HTTP_TIMEOUT_MS } = {}) {
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

  const sendBody = method !== 'GET';
  const headers = sendBody
    ? { 'Content-Type': 'application/json', ...config.httpHeaders }
    : { ...config.httpHeaders };

  const options = {
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers
  };

  const client = url.protocol === 'https:' ? https : http;
  const budget = Math.max(1, Math.round(Number(timeoutMs) || HTTP_TIMEOUT_MS));
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      let req = null;
      function finish(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          try { if (req) req.destroy(); } catch { /* already gone */ }
          reject(err);
        } else resolve();
      }
      // Absolute deadline: connect, TLS handshake and response included.
      const timer = setTimeout(() => finish(new Error(`Webhook timed out after ${formatDuration(budget)}`)), budget);
      try {
        req = client.request(options, (res) => {
          let bytes = 0;
          let tooBig = false;
          res.on('data', chunk => {
            if (tooBig) return;
            bytes += chunk.length;
            if (bytes > HTTP_MAX_RESPONSE) {
              tooBig = true;
              finish(new Error('Webhook response too large'));
            }
          });
          res.on('end', () => {
            if (tooBig) return finish(new Error('Webhook response too large'));
            // A redirect (3xx) is not a delivered light command either.
            if (!(res.statusCode >= 200 && res.statusCode < 300)) {
              return finish(new Error(`Webhook returned HTTP ${res.statusCode}`));
            }
            finish();
          });
          res.on('error', err => finish(err));
        });
      } catch (err) {
        finish(err);
        return;
      }
      req.on('error', err => finish(err));
      if (sendBody) req.write(bodyStr);
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
let hueGeneration = 0;
let hueOperationChain = Promise.resolve();
const HUE_LIGHT_PACE_MS = 120;
const HUE_SNAPSHOT_RETRY_MS = 10000;
// Failures of the bridge itself: every other light on it would fail the same
// way, so a batch stops at the first one instead of waiting out each light.
const HUE_SETUP_FAILURES = new Set(['CERT_CHANGED', 'CERT_UNAVAILABLE', 'UNAUTHORIZED', 'HTTPS_REQUIRED', 'INVALID_BRIDGE_ADDRESS']);
const HUE_BRIDGE_FAILURES = new Set([...HUE_SETUP_FAILURES, 'TIMEOUT', 'NETWORK_ERROR']);

function queueHueOperation(operation) {
  const next = hueOperationChain.then(operation);
  hueOperationChain = next.catch(() => {});
  return next;
}

function hueFatal(results) {
  return results.find(r => r && !r.success && !r.released && HUE_SETUP_FAILURES.has(r.code));
}

// Run fn per light, paced. Stops when the run is superseded, and at the first
// bridge-level failure (the remaining lights are reported as not attempted).
async function forEachHueLight(ids, fn, { isCurrent = () => true } = {}) {
  const results = [];
  for (let i = 0; i < ids.length; i++) {
    if (!isCurrent()) break;
    const res = (await fn(ids[i])) || { success: true, skipped: true };
    results.push(res);
    if (!res.success && !res.released && HUE_BRIDGE_FAILURES.has(res.code)) {
      for (const id of ids.slice(i + 1)) results.push({ ...failure('hue', res.code, res.message), id, unattempted: true });
      break;
    }
    if (!res.skipped && i < ids.length - 1 && isCurrent()) await sleep(HUE_LIGHT_PACE_MS);
  }
  return results;
}

async function sendToHueTargets(ids, lightState, { isCurrent = () => true } = {}) {
  return forEachHueLight(ids, id => setHueLightState(config.hueBridgeIp, config.hueUsername, id, lightState), { isCurrent });
}

function countFailures(results) {
  return results.filter(r => !r.success && !r.released).length;
}

// Light IDs an explicit action addresses: the configured IDs, else the
// configured group's members, else every light on the bridge.
async function resolveHueTargetIds() {
  if (config.hueLightIds.length) return { success: true, ids: config.hueLightIds.map(String) };
  if (config.hueGroupId) {
    const group = await getHueGroupMembers(config.hueBridgeIp, config.hueUsername, config.hueGroupId);
    return group.success ? { success: true, ids: group.lights } : group;
  }
  const all = await getHueLights(config.hueBridgeIp, config.hueUsername);
  return all.success ? { success: true, ids: all.lights.map(light => light.id) } : all;
}

// One dim step for one light: scaled from the brightness it had when dimming
// began (never above it, never below 1 — the final off is a separate command),
// warmed from its own colour temperature in warm_dim. null = nothing changes.
function hueDimState(light, progress, warm) {
  const body = {};
  const bri0 = Math.round(Number(light.bri));
  if (bri0 > 0) {
    const bri = Math.max(1, Math.min(bri0, Math.round(bri0 * (1 - progress))));
    if (bri !== light.lastBri) body.bri = bri;
  }
  if (warm) {
    const ct0 = Math.round(Number(light.ct));
    if (ct0 > 0) {
      const ct = Math.max(ct0, Math.min(500, Math.round(ct0 + (500 - ct0) * progress)));
      if (ct !== light.lastCt) body.ct = ct;
    }
  }
  if (body.bri === undefined && body.ct === undefined) return null;
  body.transitiontime = 10;
  return body;
}

async function dimHueLights(lights, progress, warm, { isCurrent }) {
  const bridgeIp = config.hueBridgeIp;
  const username = config.hueUsername;
  return forEachHueLight(lights.map(l => l.id), async (id) => {
    const light = lights.find(l => l.id === id);
    if (!light || light.released) return null;
    const body = hueDimState(light, progress, warm);
    if (!body) return null;
    // No `on` in a dim step: a light switched off mid-run answers error 201
    // and is released for the rest of the run, like WiZ.
    const res = await setHueLightState(bridgeIp, username, id, body);
    if (res.released) light.released = true;
    else if (res.success) {
      light.changed = true;
      if (body.bri !== undefined) light.lastBri = body.bri;
      if (body.ct !== undefined) { light.lastCt = body.ct; light.colorChanged = true; }
    }
    return res;
  }, { isCurrent });
}

function queueHueSnapshot(generation) {
  const bridgeIp = config.hueBridgeIp;
  const username = config.hueUsername;
  state.hueSnapshotAttemptAt = Date.now();
  const pending = queueHueOperation(async () => {
    if (generation !== hueGeneration) return null;
    const snapshot = await saveHueCurrentState(bridgeIp, username);
    if (snapshot && generation === hueGeneration) state.originalLightState = snapshot;
    return snapshot;
  }).catch(() => null);
  state.hueSnapshotPending = pending;
  pending.then(() => { if (state.hueSnapshotPending === pending) state.hueSnapshotPending = null; });
  return pending;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer Integration
// ─────────────────────────────────────────────────────────────────────────────

function startSmartLightDim(remainingSeconds) {
  if (!config.enabled || state.dimStarted) return;

  state.dimStarted = true;
  state.dimStartTime = Date.now();
  const safeRemaining = Math.max(1, Number(remainingSeconds) || 1);
  const safeDimMinutes = Math.max(1, Number(config.dimMinutes) || 1);
  // Fixed for the run. A snooze adds countdown time, not dim time.
  state.dimDurationMs = Math.max(1000, (isExperience(config.mode) ? safeRemaining : Math.min(safeRemaining, safeDimMinutes * 60)) * 1000);
  if (config.provider === 'wiz' && (config.mode !== 'off_at_end' || config.timerBeacon)) {
    const generation = ++wizGeneration;
    const addresses = [...config.wizAddresses];
    state.wizSnapshotPending = queueWizOperation(() => wizLights.readStates(addresses)).then(snapshot => {
      if (generation === wizGeneration) state.wizOriginalState = snapshot;
      return snapshot;
    }).catch(() => []);
  }

  // off_at_end never dims, so it needs no snapshot: the final off addresses
  // the configured targets like an explicit off.
  if (config.provider === 'hue' && config.mode !== 'off_at_end' && config.hueBridgeIp && config.hueUsername) {
    queueHueSnapshot(++hueGeneration);
  }
}

// Dim progress from the COUNTDOWN, never the wall clock: 0 at dim start, 1
// only when no time remains. A pause freezes it (no ticks, same remaining), a
// snooze lowers it (more remaining: lights brighten back toward where they
// started).
function dimProgress(remainingSeconds) {
  const durationMs = Math.max(1000, Number(state.dimDurationMs) || 1000);
  const remaining = Math.max(0, remainingSeconds);
  return Math.min(1, Math.max(0, 1 - remaining * 1000 / durationMs));
}

// Just under 1: the dim reaches its lowest level (WiZ floors at 10) but a
// tick never sends state:false.
const WIZ_TICK_MAX_PROGRESS = 0.999;
const IMMINENT_BEACON_SECONDS = 6;

// Cue D: the grace warning fired for a real run. Only WiZ lights the countdown
// is already dimming take part; nothing happens before the dim has begun, in
// Off at End (nothing is dimmed) or for another provider. main never calls
// this for a Test Mode run, and smartLights is never ticked for one.
function signalImminentAction(remainingSeconds) {
  const remaining = Number(remainingSeconds);
  if (!config.enabled || config.imminentBeacon !== true || config.provider !== 'wiz'
      || config.mode === 'off_at_end' || !state.dimStarted || !state.wizOriginalState
      || !Number.isFinite(remaining) || remaining <= 0) {
    return false;
  }
  state.imminentAt = remaining;
  return true;
}

// A six-second soft blue beacon from the moment the grace warning fired. Each
// frame is capped at the level the dim (or the experience) shows this tick,
// so it never makes a light brighter.
function imminentOverlay(remaining) {
  if (config.imminentBeacon !== true || !Number.isFinite(state.imminentAt)) return undefined;
  const elapsed = state.imminentAt - remaining;
  if (elapsed < 0 || elapsed >= IMMINENT_BEACON_SECONDS) return undefined;
  return (index, count, level) => {
    const cap = Math.max(10, Math.min(100, Math.round(Number(level) || 10)));
    const frame = lightExperience.beacon({ elapsedSeconds: elapsed, index, count, brightness: cap });
    return frame ? { r: frame.r, g: frame.g, b: frame.b, dimming: Math.min(cap, frame.dimming) } : null;
  };
}

function updateSmartLightTick(remainingSeconds) {
  if (!config.enabled || !state.dimStarted) return;
  const remaining = Number(remainingSeconds);
  if (!Number.isFinite(remaining)) return;
  if (config.mode === 'off_at_end' && !(config.provider==='wiz'&&config.timerBeacon&&remaining<=6)) return;

  const progress = dimProgress(remaining);

  switch (config.provider) {
    case 'wiz': {
      if (!wizBatchBusy && state.wizOriginalState) {
        wizBatchBusy = true;
        const generation = wizGeneration;
        const snapshot = state.wizOriginalState;
        const finishBeacon = config.timerBeacon && remaining<=6 && remaining>0;
        const overlay = finishBeacon ? undefined : imminentOverlay(remaining);
        const warm = config.mode === 'warm_dim' && !(config.timerBeacon&&remaining<=6);
        const look = config.wizLook;
        const seconds=state.dimDurationMs/1000-remaining;
        const frame = finishBeacon
          ? (index,count)=>lightExperience.beacon({elapsedSeconds:6-remaining,index,count,brightness:look.brightness})
          : isExperience(config.mode) ? (index,count)=>lightExperience.frame(config.mode,{progress,elapsedSeconds:seconds,index,count,brightness:look.brightness}) : undefined;
        // The countdown's own ticks never switch a WiZ light off: the final
        // off is invokeSmartLightOff, sent just before the power request, so
        // a cancel during the completion steps can still restore the room.
        const wizProgress = Math.min(progress, WIZ_TICK_MAX_PROGRESS);
        queueWizOperation(() => generation === wizGeneration ? wizLights.dimStates(snapshot, wizProgress, warm, undefined,
          { look, frame, overlay, isCurrent: () => generation === wizGeneration && config.enabled }) : null)
          .catch(() => {})
          .finally(() => { wizBatchBusy = false; });
      }
      break;
    }
    case 'hue': {
      const snapshot = state.originalLightState;
      if (!Array.isArray(snapshot)) {
        // The snapshot failed (bridge busy or unreachable at dim start): try
        // again now and then; nothing is dimmed without a baseline.
        if (!state.hueSnapshotPending && Date.now() - (state.hueSnapshotAttemptAt || 0) >= HUE_SNAPSHOT_RETRY_MS
            && config.hueBridgeIp && config.hueUsername) {
          queueHueSnapshot(hueGeneration);
        }
        break;
      }
      const targets = snapshot.filter(l => l.on && !l.released);
      if (hueBatchBusy || !targets.length) break;
      hueBatchBusy = true;
      const generation = hueGeneration;
      const isCurrent = () => generation === hueGeneration && config.enabled;
      const warm = config.mode === 'warm_dim';
      queueHueOperation(() => isCurrent() ? dimHueLights(targets, progress, warm, { isCurrent }) : null)
        .catch(() => {})
        .finally(() => { hueBatchBusy = false; });
      break;
    }
    case 'http': {
      // A webhook can only write — there is no light state to read — so it
      // keeps an absolute level: full (254) at dim start down to 1, with the
      // final off sent at the end. A light that was dimmer than full gets
      // brighter first; the UI should say so (follow-up).
      // One request at a time: a tick while one is still pending is skipped.
      if (httpInFlight) break;
      const brightness = Math.max(1, Math.round(254 * (1 - progress)));
      const colorTemp = config.mode === 'warm_dim' ? Math.round(366 + (134 * progress)) : 366;
      const request = invokeHttpLightAction(brightness, colorTemp, true).catch(() => null);
      httpInFlight = request;
      request.finally(() => { if (httpInFlight === request) httpInFlight = null; });
      break;
    }
  }
}

async function invokeSmartLightAction({ on = true, brightness = 254, colorTemp = 366, transitionTime = 10, preservePower = false, released } = {}) {
  if (!config.enabled) return failure(config.provider || 'none', 'DISABLED', 'Smart Lights not enabled');
  return sendSmartLightAction({ on, brightness, colorTemp, transitionTime, preservePower, released }, { requireEnabled: true });
}

function summarizeHueAction(results) {
  const fatal = hueFatal(results);
  if (fatal) return failure('hue', fatal.code, fatal.message);
  const failedCount = countFailures(results);
  if (failedCount === results.length && results.length > 0) {
    return failure('hue', 'ALL_FAILED', `All ${failedCount} light updates failed`);
  }
  if (failedCount > 0) {
    return failure('hue', 'PARTIAL', `${failedCount} of ${results.length} light updates failed`);
  }
  const skipped = results.filter(r => r.skipped || r.released).length;
  return result('hue', true, 'OK', `${results.length - skipped} light(s) updated${skipped ? `; ${skipped} left under manual control` : ''}`);
}

// preservePower: adjust only lights that are on right now (read live), never
// switch one on; a light found off joins `released` and is left alone for the
// rest of the sequence (First Light sunrise, ritual scenes).
async function sendSmartLightAction({ on = true, brightness = 254, colorTemp = 366, transitionTime = 10, preservePower = false, released } = {}, { requireEnabled = false } = {}) {

  const targetBri = Math.max(0, Math.min(254, Math.round(Number(brightness) || 0)));
  const targetCt = Math.max(153, Math.min(500, Math.round(Number(colorTemp) || 366)));
  const powerOn = Boolean(on) && targetBri > 0;
  const transition = Math.max(0, Math.round(Number(transitionTime) || 0));
  // Hue bri is 1..254; an off command carries no brightness.
  const hueState = powerOn
    ? { on: true, bri: Math.max(1, targetBri), ct: targetCt, transitiontime: transition }
    : { on: false, transitiontime: transition };
  const releasedSet = released instanceof Set ? released : new Set();

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
      const generation = hueGeneration;
      const isCurrent = () => generation === hueGeneration && (!requireEnabled || config.enabled);
      // Serialized with dim steps, restores and the final off; an action
      // queued before a newer run, cancel or off is dropped.
      return queueHueOperation(async () => {
        if (!isCurrent()) return failure('hue', 'SUPERSEDED', 'A newer light change replaced this one');
        const bridgeIp = config.hueBridgeIp;
        const username = config.hueUsername;
        if (config.hueGroupId && !(preservePower && powerOn)) {
          return setHueGroupState(bridgeIp, username, config.hueGroupId, hueState);
        }
        const targets = await resolveHueTargetIds();
        if (!targets.success) return targets;
        const results = await forEachHueLight(targets.ids, async (id) => {
          if (!(preservePower && powerOn)) return setHueLightState(bridgeIp, username, id, hueState);
          if (releasedSet.has(id)) return { success: true, skipped: true };
          const live = await getHueLight(bridgeIp, username, id);
          if (!live.success) return live;
          if (!live.light.on) { releasedSet.add(id); return { success: true, skipped: true }; }
          if (!isCurrent()) return { success: true, skipped: true };
          const { on: _on, ...body } = hueState;
          const res = await setHueLightState(bridgeIp, username, id, body);
          if (res.released) { releasedSet.add(id); return { success: true, skipped: true }; }
          return res;
        }, { isCurrent });
        return summarizeHueAction(results);
      });
    }
    case 'http':
      // The webhook cannot report whether its light is on. When the caller
      // must not switch a light on, it is left alone instead of risking an
      // on:true for a light someone switched off.
      if (powerOn && (preservePower || releasedSet.has('http'))) {
        return result('http', true, 'SKIPPED', 'Webhook left alone: it cannot report whether its light is on, so Lights Out does not risk switching it on.');
      }
      return invokeHttpLightAction(targetBri, targetCt, powerOn);
    default:
      return failure(config.provider || 'none', 'NO_PROVIDER', 'No supported provider configured');
  }
}

// Scenes adjust lights that are already on; they never switch on a light that
// is off (preservePower).
async function applyScene(sceneId) {
  switch (String(sceneId || '').toLowerCase()) {
    case 'night':
      return invokeSmartLightAction({ on: true, brightness: 48, colorTemp: 460, transitionTime: 20, preservePower: true });
    case 'dim':
      return invokeSmartLightAction({ on: true, brightness: 96, colorTemp: 410, transitionTime: 15, preservePower: true });
    case 'off':
      return invokeSmartLightOff();
    default:
      return invokeSmartLightAction({});
  }
}

async function invokeSmartLightOff() {
  if (!config.enabled) return failure(config.provider || 'none', 'DISABLED', 'Smart Lights not enabled');
  // No dim step may start once the final off has begun.
  state.dimStarted = false;

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
      hueGeneration++;
      const lightState = { on: false, transitiontime: 10 };
      const snapshot = state.originalLightState;
      const pending = state.hueSnapshotPending;
      res = await queueHueOperation(async () => {
        if (!config.hueBridgeIp || !config.hueUsername) {
          return failure('hue', 'NOT_CONFIGURED', 'Hue bridge/credential not configured');
        }
        const captured = snapshot || (pending ? await pending : null);
        let ids;
        if (Array.isArray(captured)) {
          // A dim ran: off only the dimmed targets that were on, minus the
          // ones switched off by hand (released) — like WiZ.
          ids = captured.filter(l => l.on && !l.released).map(l => l.id);
          if (!ids.length) {
            return result('hue', true, 'SKIPPED', captured.length
              ? 'Selected lights were left under manual control.'
              : 'No selected light was on when dimming began.');
          }
        } else if (config.hueGroupId) {
          return setHueGroupState(config.hueBridgeIp, config.hueUsername, config.hueGroupId, lightState);
        } else {
          ids = config.hueLightIds.length > 0 ? config.hueLightIds.map(String) : [];
          if (ids.length === 0) {
            const live = await getHueLights(config.hueBridgeIp, config.hueUsername);
            if (!live.success) return live;
            ids = live.lights.filter(l => l.on).map(l => l.id);
          }
        }
        const results = await sendToHueTargets(ids, lightState);
        const fatal = hueFatal(results);
        if (fatal) return failure('hue', fatal.code, fatal.message);
        const failedCount = countFailures(results);
        return failedCount === 0
          ? result('hue', true, 'OK', 'Lights off')
          : failure('hue', failedCount === results.length && results.length ? 'ALL_FAILED' : 'PARTIAL', `${failedCount} of ${results.length} lights failed to turn off`);
      });
      break;
    }
    case 'http': {
      // A dim step still on the wire must land before the off, never after.
      const inFlight = httpInFlight;
      if (inFlight) await inFlight;
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
  hueGeneration++;
  state.wizOriginalState = null;
  state.wizSnapshotPending = null;
  state.dimStarted = false;
  state.originalLightState = null;
  state.hueSnapshotPending = null;
  state.hueSnapshotAttemptAt = 0;
  state.dimStartTime = null;
  state.dimDurationMs = 0;
  state.imminentAt = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Light cues (lightCues.js) wiring helpers. main.js builds the engine from
// these; the engine never sees the bridge address or key.
// ─────────────────────────────────────────────────────────────────────────────

// True only while the countdown is actually changing the lights. dimStarted
// alone is not enough: Off at End sets it for the last dimMinutes but writes
// nothing until the finish beacon's final seconds.
function isDrivingLights(remainingSeconds) {
  if (!config.enabled || state.dimStarted !== true) return false;
  if (config.mode !== 'off_at_end') return true;
  return config.provider === 'wiz' && config.timerBeacon === true && Number(remainingSeconds) <= 15;
}

function isVerifiedForSetup() {
  return Boolean(config.verifiedConfigKey && config.verifiedConfigKey === configurationKey(config));
}

// The provider's own operation queue, so a cue never interleaves with a dim
// snapshot, a cancel restore or the final off. Returns the task's promise.
function runExclusive(provider, task) {
  if (provider === 'wiz') return queueWizOperation(task);
  if (provider === 'hue') return queueHueOperation(task);
  return Promise.resolve().then(task);
}

let hueCueScope = { key: null, ids: null, at: 0 };
const HUE_CUE_SCOPE_TTL_MS = 60000;

// Lights in the configured scope with their live on/off state: one bridge GET
// per round, group membership cached for a minute.
async function listHueCueLights({ timeoutMs } = {}) {
  if (!config.hueBridgeIp || !config.hueUsername) return failure('hue', 'NOT_CONFIGURED', 'Hue not configured');
  const opts = { timeoutMs: Math.min(Number(timeoutMs) || 1900, 1900) };
  let scope = null;
  if (config.hueGroupId) {
    const key = `${config.hueBridgeIp}|${config.hueGroupId}`;
    if (hueCueScope.key !== key || Date.now() - hueCueScope.at > HUE_CUE_SCOPE_TTL_MS) {
      const groups = await getHueGroups(config.hueBridgeIp, config.hueUsername, opts);
      if (!groups.success) return groups;
      const group = groups.groups.find(g => String(g.id) === String(config.hueGroupId));
      hueCueScope = { key, ids: new Set(((group && group.lights) || []).map(String)), at: Date.now() };
    }
    scope = hueCueScope.ids;
  } else if (config.hueLightIds.length) {
    scope = new Set(config.hueLightIds.map(String));
  }
  const res = await getHueLights(config.hueBridgeIp, config.hueUsername, opts);
  if (!res.success) return res;
  return result('hue', true, 'OK', 'lights', {
    lights: res.lights.filter(l => !scope || scope.has(String(l.id))).map(l => ({ id: String(l.id), on: l.on === true }))
  });
}

// Only ever the bridge's native breathe: whatever state is passed, exactly
// { alert: 'select' } is sent, which changes no light state.
function setHueCueAlert(id, _state, { timeoutMs } = {}) {
  return setHueLightState(config.hueBridgeIp, config.hueUsername, id, { ...lightCues.HUE_ALERT },
    { timeoutMs: Math.min(Number(timeoutMs) || 900, 900) });
}

// Resolves once every queued light operation and the in-flight webhook
// request have settled (tests; a quit path that must not cut a restore short).
async function whenIdle() {
  for (let i = 0; i < 4; i++) {
    await Promise.all([hueOperationChain, wizOperationChain, httpInFlight || Promise.resolve()]);
    await new Promise(resolve => setImmediate(resolve));
  }
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
      return result('http', true, 'ACTION_SENT', `Sent test action to ${webhookOrigin(config.httpUrl)}`,
        { verifiedConfigKey: configurationKey() });
    }
    default:
      return failure('none', 'NO_PROVIDER', 'No provider selected');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Management
// ─────────────────────────────────────────────────────────────────────────────

let lastRejectedFields = [];

// Returns { migrated }: true when the stored verifiedConfigKey was rewritten
// from the pre-11.3 plaintext form, so the caller should persist the section
// again (with the backup replaced) to take the plaintext off disk. Adds
// rejected: ['hueBridgeIp'] when an address was refused (the previous one is
// kept; getPublicConfig() reports the same list as rejectedFields).
function loadConfig(newConfig) {
  if (!newConfig) return { migrated: false };
  const rejected = [];
  let nextHueIp = config.hueBridgeIp;
  if (newConfig.hueBridgeIp !== undefined) {
    const trimmed = String(newConfig.hueBridgeIp || '').trim();
    if (trimmed === '') {
      nextHueIp = '';
    } else if (parseHueHost(trimmed)) {
      // A private/local IP literal, optionally with a port ("192.168.1.5:8080").
      nextHueIp = trimmed;
    } else {
      rejected.push('hueBridgeIp');
    }
  }
  const merged = {
    ...config,
    provider: newConfig.provider !== undefined
      ? (SHIPPED_PROVIDERS.includes(newConfig.provider) ? newConfig.provider : 'none')
      : config.provider,
    mode: newConfig.mode || config.mode,
    dimMinutes: newConfig.dimMinutes !== undefined && Number.isFinite(Number(newConfig.dimMinutes))
      ? Math.max(1, Math.min(180, Math.round(Number(newConfig.dimMinutes))))
      : config.dimMinutes,
    enabled: newConfig.enabled !== undefined ? Boolean(newConfig.enabled) : config.enabled,
    wizAddresses: newConfig.wizAddresses !== undefined ? wizLights.normalizeAddresses(newConfig.wizAddresses) : config.wizAddresses,
    wizDevices: wizLights.normalizeDevices(newConfig.wizDevices ?? config.wizDevices, newConfig.wizAddresses ?? config.wizAddresses),
    wizLook: wizLights.normalizeLook(newConfig.wizLook ?? config.wizLook),
    timerBeacon: newConfig.timerBeacon !== undefined ? newConfig.timerBeacon === true : config.timerBeacon,
    // Not part of configurationKey: toggling a cue never costs the verification.
    cues: lightCues.normalizeCueSettings(newConfig.cues !== undefined ? newConfig.cues : config.cues),
    imminentBeacon: newConfig.imminentBeacon !== undefined ? newConfig.imminentBeacon === true : config.imminentBeacon,
    hueBridgeIp: nextHueIp,
    hueAllowLegacyHttp: newConfig.hueAllowLegacyHttp !== undefined ? Boolean(newConfig.hueAllowLegacyHttp) : config.hueAllowLegacyHttp,
    // Empty string means "keep existing" so a redacted (blanked) renderer field
    // never clobbers the stored credential.
    hueUsername: newConfig.hueUsername || config.hueUsername,
    hueLightIds: Array.isArray(newConfig.hueLightIds)
      ? newConfig.hueLightIds.map(id => String(id).trim()).filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id))
      : config.hueLightIds,
    hueGroupId: newConfig.hueGroupId !== undefined ? String(newConfig.hueGroupId || '') : config.hueGroupId,
    httpUrl: newConfig.httpUrl !== undefined ? String(newConfig.httpUrl || '') : config.httpUrl,
    httpMethod: newConfig.httpMethod || config.httpMethod,
    httpHeaders: newConfig.httpHeaders || config.httpHeaders,
    httpBodyTemplate: newConfig.httpBodyTemplate !== undefined ? String(newConfig.httpBodyTemplate || '') : config.httpBodyTemplate,
    verifiedConfigKey: ''
  };

  // Certificate pin. It belongs to the bridge address: a new address starts
  // unpinned (the next HTTPS answer pins it) unless this session already met
  // that bridge; a persisted pin is accepted as saved; a Register for this
  // exact address and key wins. An empty or malformed value never clears an
  // existing pin — Register is the way to move it to a new certificate.
  const previousHost = hueHostKey(config.hueBridgeIp);
  const nextHost = hueHostKey(merged.hueBridgeIp);
  let nextPin = nextHost && nextHost === previousHost ? config.hueCertFingerprint : '';
  const requestedPin = newConfig.hueCertFingerprint !== undefined ? normalizeFingerprint(newConfig.hueCertFingerprint) : '';
  if (requestedPin) nextPin = requestedPin;
  const registered = registeredHuePins.get(nextHost);
  if (registered && registered.username === String(merged.hueUsername || '').trim()) nextPin = registered.fingerprint;
  if (!nextPin && nextHost && sessionHuePins.has(nextHost)) nextPin = sessionHuePins.get(nextHost);
  merged.hueCertFingerprint = nextHost ? nextPin : '';
  // Pinning a setup that had no pin keeps its verification; a pin replaced by
  // a different certificate for the same address is a changed bridge.
  const pinReplaced = Boolean(config.hueCertFingerprint && merged.hueCertFingerprint
    && nextHost === previousHost && merged.hueCertFingerprint !== config.hueCertFingerprint);

  const requestedKey = typeof newConfig.verifiedConfigKey === 'string' ? newConfig.verifiedConfigKey : '';
  const currentKey = configurationKey(merged);
  merged.verifiedConfigKey = pinReplaced && merged.provider === 'hue' ? '' : migrateVerifiedConfigKey(requestedKey, merged, currentKey);
  merged.enabled = Boolean(merged.enabled && merged.verifiedConfigKey && merged.verifiedConfigKey === currentKey);
  if(merged.provider!=='wiz'&&isExperience(merged.mode))merged.mode='gradual_dim';
  if (!merged.enabled || configurationKey(merged) !== configurationKey(config) || merged.mode !== config.mode
      || pinReplaced || JSON.stringify(merged.hueLightIds) !== JSON.stringify(config.hueLightIds)
      || JSON.stringify(merged.wizLook) !== JSON.stringify(config.wizLook)) resetSmartLightState();
  config = merged;
  lastRejectedFields = rejected;
  return rejected.length
    ? { migrated: merged.verifiedConfigKey !== requestedKey, rejected }
    : { migrated: merged.verifiedConfigKey !== requestedKey };
}

// Full config — main-process only. Never send to the renderer.
function getConfig() {
  return { ...config, cues: { ...config.cues } };
}

// Renderer-safe config: secret fields are replaced by presence indicators.
function getPublicConfig() {
  const publicConfig = { ...config, cues: { ...config.cues } };
  for (const [field, indicator] of Object.entries(SECRET_INDICATORS)) {
    const value = publicConfig[field];
    const present = typeof value === 'string' ? value.length > 0
      : (value && typeof value === 'object' ? Object.keys(value).length > 0 : false);
    publicConfig[indicator] = Boolean(present);
    delete publicConfig[field];
  }
  // Main owns the certificate pin; the renderer never sees or sends it.
  delete publicConfig.hueCertFingerprint;
  // The key is opaque (digests), so the renderer cannot match it against the
  // visible setup fields itself; this says whether it belongs to this setup.
  publicConfig.verifiedForSetup = Boolean(config.verifiedConfigKey && config.verifiedConfigKey === configurationKey(config));
  if (lastRejectedFields.length) publicConfig.rejectedFields = [...lastRejectedFields];
  return publicConfig;
}

function shouldStartDim(remainingSeconds) {
  return config.enabled && !state.dimStarted && (config.provider==='wiz'&&isExperience(config.mode) || remainingSeconds <= config.dimMinutes * 60);
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
  legacyConfigurationKey,
  migrateVerifiedConfigKey,
  setConfigPersistence,
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
  whenIdle,
  signalImminentAction,

  // Light cues wiring (lightCues.js)
  isDrivingLights,
  isVerifiedForSetup,
  runExclusive,
  listHueCueLights,
  setHueCueAlert,

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
