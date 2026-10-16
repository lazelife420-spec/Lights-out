// Family mode: LAN-based remote control of multiple Lights Out instances.
// Uses UDP broadcast for discovery and WebSocket for commands.

const dgram = require('dgram');
const http = require('http');
const { EventEmitter } = require('events');
const remoteControl = require('./remoteControl');

const DISCOVERY_PORT = 58733;
const COMMAND_PORT = 58734;
const BROADCAST_INTERVAL = 10000; // 10s beacon
const FAMILY_MAGIC = 'LIGHTSOUT_FAMILY_V1';
const TOKEN_HEADER = 'x-lightsout-token';

let discoverySocket = null;
let beaconTimer = null;
let localToken = ''; // pairing secret; required on every inbound/outbound command
const emitter = new EventEmitter();
const knownPeers = new Map(); // ip -> { ip, port, lastSeen }

// ─────────────────────────────────────────────────────────────────────────────
// Discovery: broadcast presence on LAN and listen for other instances.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LABEL_LEN = 64; // cap untrusted peer names from the LAN

// Parse a discovery beacon received over UDP. Pure so it can be unit-tested
// without opening a socket. `data` is the raw datagram, `senderIp` the source
// address, `localIps` the set of our own addresses (to skip our own beacons).
// Returns a normalized { ip, name } peer or null if the datagram should be
// ignored. The name comes from an untrusted sender, so it is stripped of
// control characters and length-capped before we keep it.
function parseDiscoveryBeacon(data, senderIp, localIps = []) {
  const str = Buffer.isBuffer(data) ? data.toString() : String(data || '');
  if (!str.startsWith(FAMILY_MAGIC)) return null;
  const parts = str.split('|');
  if (parts.length < 2) return null;
  if (!senderIp || localIps.includes(senderIp)) return null;

  const rawLabel = parts[1] || '';
  const label = rawLabel.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MAX_LABEL_LEN);
  return { ip: senderIp, name: label || senderIp };
}

function startDiscovery(peerName) {
  if (discoverySocket) return;
  const name = peerName || require('os').hostname();

  discoverySocket = dgram.createSocket('udp4');
  discoverySocket.bind(DISCOVERY_PORT, () => {
    discoverySocket.setBroadcast(true);

    // Periodically broadcast presence.
    const msg = Buffer.from(`${FAMILY_MAGIC}|${name}|${DISCOVERY_PORT}`);
    beaconTimer = setInterval(() => {
      try {
        discoverySocket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255');
      } catch { /* socket may be closed */ }
    }, BROADCAST_INTERVAL);

    // Also send immediately.
    try {
      discoverySocket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255');
    } catch {}
  });

  discoverySocket.on('message', (data, rinfo) => {
    const peer = parseDiscoveryBeacon(data, rinfo.address, getLocalIPs());
    if (!peer) return;
    knownPeers.set(peer.ip, { ip: peer.ip, name: peer.name, lastSeen: Date.now() });
    emitter.emit('peer-found', { ip: peer.ip, name: peer.name });
  });

  discoverySocket.on('error', () => { /* ignore */ });
}

function stopDiscovery() {
  if (beaconTimer) { clearInterval(beaconTimer); beaconTimer = null; }
  if (discoverySocket) {
    try { discoverySocket.close(); } catch {}
    discoverySocket = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote commands: send timer actions to a peer via HTTP.
// ─────────────────────────────────────────────────────────────────────────────

// A peer's answer is untrusted LAN data. Only these fields are kept, as short
// strings, so a misbehaving peer can never inject anything else.
const MAX_ANSWER_FIELD = 160;
function answerField(value) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, MAX_ANSWER_FIELD) : '';
}

// Turn the peer's HTTP answer into a truthful outcome. Success is reported
// ONLY for a 2xx answer whose JSON body says success:true. A non-2xx status,
// an empty body or non-JSON never becomes a success.
function interpretCommandAnswer(statusCode, body) {
  const status = Number(statusCode) || 0;
  const ok2xx = status >= 200 && status < 300;
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { success: false, statusCode: status, error: ok2xx ? 'bad response' : `HTTP ${status}` };
  }
  const code = answerField(parsed.code);
  const error = answerField(parsed.error);
  if (ok2xx && parsed.success === true) {
    return { success: true, statusCode: status, ...(code ? { code } : {}) };
  }
  return {
    success: false,
    statusCode: status,
    ...(code ? { code } : {}),
    error: error || (ok2xx ? 'bad response' : `HTTP ${status}`)
  };
}

// Only an address that announced itself on this network (and has not expired)
// may receive a command carrying the pairing token.
function isKnownPeer(ip) {
  if (typeof ip !== 'string' || !ip) return false;
  return getPeers().some(peer => peer.ip === ip);
}

function sendRemoteCommand(peerIp, command, payload = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ command, ...payload });
    const options = {
      hostname: peerIp,
      port: COMMAND_PORT, // Family command port (separate from PWA)
      path: '/command',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        [TOKEN_HEADER]: localToken // peer must share the same pairing token
      },
      // One fresh connection per command: a pooled keep-alive socket to a peer
      // that restarted would fail with a reset instead of reaching it.
      agent: false,
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
        // A real answer is a few dozen bytes; never buffer an unbounded body.
        if (body.length > 8192) {
          res.destroy();
          resolve({ success: false, statusCode: res.statusCode || 0, error: 'bad response' });
        }
      });
      res.on('end', () => resolve(interpretCommandAnswer(res.statusCode, body)));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

async function remoteStart(peerIp, durationSeconds, action = 'shutdown') {
  return sendRemoteCommand(peerIp, 'start', { durationSeconds, action });
}

async function remotePause(peerIp) {
  return sendRemoteCommand(peerIp, 'pause');
}

async function remoteResume(peerIp) {
  return sendRemoteCommand(peerIp, 'resume');
}

async function remoteCancel(peerIp) {
  return sendRemoteCommand(peerIp, 'cancel');
}

async function remoteSnooze(peerIp, seconds = 300) {
  return sendRemoteCommand(peerIp, 'snooze', { seconds });
}

// ─────────────────────────────────────────────────────────────────────────────
// Family command server: receives commands from other instances.
// Runs on port 58734, separate from the companion PWA server.
// ─────────────────────────────────────────────────────────────────────────────

let commandServer = null;

function reject(res, httpStatus, error, code) {
  res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error, ...(code ? { code } : {}) }));
}

// onCommand receives ONLY sanitized, validated commands. The handler enforces
// the pairing token and command validation before anything is dispatched.
// onCommand must return a truthful outcome object ({success, code, error,
// httpStatus}); a falsy return is reported as success for backward compat.
function startCommandServer(onCommand, bindHost = '0.0.0.0') {
  if (commandServer) return;
  commandServer = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/command') {
      res.writeHead(404);
      res.end();
      return;
    }

    // Cap body size to avoid abuse.
    let body = '';
    let tooBig = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 4096) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;

      // 1. Authenticate: pairing token must match (header or body).
      let parsed;
      try { parsed = JSON.parse(body); } catch { return reject(res, 400, 'invalid json'); }
      const provided = req.headers[TOKEN_HEADER] || parsed.token;
      if (!remoteControl.tokensMatch(provided, localToken)) {
        return reject(res, 401, 'unauthorized');
      }

      // 2. Validate + sanitize the command.
      const result = remoteControl.validateCommand(parsed);
      if (!result.ok) return reject(res, 400, result.error);

      // 3. Dispatch and report the REAL outcome — never unconditional success.
      const outcome = onCommand(result.command);
      if (outcome && outcome.success === false) {
        return reject(res, outcome.httpStatus || 409, outcome.error || outcome.code || 'rejected', outcome.code);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: (outcome && outcome.code) || 'OK' }));
    });
  });

  // Degrade gracefully if the port is taken instead of crashing the main process.
  commandServer.on('error', (err) => {
    commandServer = null;
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`Family command port ${COMMAND_PORT} already in use - family remote disabled for this instance.`);
    } else {
      console.warn(`Family command server error: ${err && (err.message || err.code)}`);
    }
  });

  // Bind the selected LAN interface only — the same address the companion
  // advertises — rather than every interface on the host.
  commandServer.listen(COMMAND_PORT, bindHost, () => {
    console.log(`Family command server listening on ${bindHost}:${COMMAND_PORT}`);
  });
}

function stopCommandServer() {
  if (commandServer) {
    try { commandServer.close(); } catch {}
    commandServer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle: nothing binds unless explicitly enabled with a pairing token.
// ─────────────────────────────────────────────────────────────────────────────

function start(opts, onCommand) {
  if (!opts || !opts.enabled || !opts.token) return false;
  localToken = String(opts.token);
  startDiscovery(opts.peerName);
  startCommandServer(onCommand, opts.bindHost || '127.0.0.1');
  return true;
}

function stop() {
  stopDiscovery();
  stopCommandServer();
  localToken = '';
}

function isRunning() {
  return !!(commandServer || discoverySocket);
}

// ─────────────────────────────────────────────────────────────────────────────
// Peer management
// ─────────────────────────────────────────────────────────────────────────────

function getPeers() {
  // Expire peers not seen in 30s.
  const now = Date.now();
  for (const [ip, peer] of knownPeers) {
    if (now - peer.lastSeen > 30000) knownPeers.delete(ip);
  }
  return [...knownPeers.values()];
}

// Pure helper exposed for unit testing. Filters out loopback, link-local, and
// obvious virtual adapters, then ranks private LAN ranges.
function filterAndRankLocalIPs(interfaces) {
  const candidates = [];
  const virtualKeywords = /vEthernet|Virtual|VMware|VirtualBox|Hyper-V|WSL|Docker|Tailscale|ZeroTier|hamachi/i;

  function rank(ip) {
    if (ip.startsWith('192.168.')) return 300;
    if (ip.startsWith('10.')) return 200;
    const parts = ip.split('.').map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 100;
    return 0;
  }

  for (const name of Object.keys(interfaces)) {
    if (virtualKeywords.test(name)) continue;
    for (const iface of interfaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      if (ip.startsWith('127.')) continue;
      if (ip.startsWith('169.254.')) continue;
      candidates.push({ ip, name, score: rank(ip) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function getLocalIPs() {
  const os = require('os');
  const candidates = filterAndRankLocalIPs(os.networkInterfaces());
  if (candidates.length) {
    console.log(`Selected LAN IP: ${candidates[0].ip} (${candidates[0].name})`);
  }
  return candidates.map((c) => c.ip);
}

// ─────────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  start,
  stop,
  isRunning,
  startDiscovery,
  stopDiscovery,
  startCommandServer,
  stopCommandServer,
  getPeers,
  isKnownPeer,
  getLocalIPs,
  sendRemoteCommand,
  interpretCommandAnswer,
  remoteStart,
  remotePause,
  remoteResume,
  remoteCancel,
  remoteSnooze,
  onPeerFound: (callback) => emitter.on('peer-found', callback),
  // Exposed for unit testing the untrusted-beacon parser.
  parseDiscoveryBeacon,
  FAMILY_MAGIC,
  MAX_LABEL_LEN,
  filterAndRankLocalIPs
};
