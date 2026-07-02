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
    const str = data.toString();
    if (!str.startsWith(FAMILY_MAGIC)) return;
    const parts = str.split('|');
    if (parts.length < 2) return;
    const peerIp = rinfo.address;
    const peerLabel = parts[1] || peerIp;

    // Don't add ourselves (same IP).
    const localIps = getLocalIPs();
    if (localIps.includes(peerIp)) return;

    knownPeers.set(peerIp, { ip: peerIp, name: peerLabel, lastSeen: Date.now() });
    emitter.emit('peer-found', { ip: peerIp, name: peerLabel });
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
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve({ success: true }); }
      });
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

function reject(res, code, error) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error }));
}

// onCommand receives ONLY sanitized, validated commands. The handler enforces
// the pairing token and command validation before anything is dispatched.
function startCommandServer(onCommand) {
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

      onCommand(result.command);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
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

  commandServer.listen(COMMAND_PORT, '0.0.0.0', () => {
    console.log('Family command server listening (LAN remote control enabled)');
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
  startCommandServer(onCommand);
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
  getLocalIPs,
  filterAndRankLocalIPs,
  sendRemoteCommand,
  remoteStart,
  remotePause,
  remoteResume,
  remoteCancel,
  remoteSnooze,
  onPeerFound: (callback) => emitter.on('peer-found', callback)
};
