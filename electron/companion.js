// Companion PWA server.
// Serves a mobile-friendly web app and communicates via WebSocket
// so users can start/pause/snooze/cancel the timer from their phone.

const http = require('http');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

const remoteControl = require('./remoteControl');

const PWA_PORT = 58732;
const MAX_CLIENTS = 8;              // companion is a personal LAN tool; cap connections
const MAX_MESSAGE = 64 * 1024;      // reject any single frame larger than this
const MAX_BUFFER = 256 * 1024;      // reject a client that buffers without completing a frame
const HEARTBEAT_MS = 5000;           // remove network-disconnected phones from truthful client state
const APP_VERSION = require('./package.json').version;
let server = null;
let clients = new Set();
let heartbeatTimer = null;
const emitter = new EventEmitter();
let startGeneration = 0;

// Pairing token required from every client. Empty = no listener may bind.
let expectedToken = '';
let bindHost = '127.0.0.1';

// Connection status exposed to the desktop UI. Updated on each connect/disconnect.
let status = {
  running: false,
  port: PWA_PORT,
  host: '127.0.0.1',
  clients: 0,
  connected: false,
  ready: false,
  failed: false,
  errorCode: '',
  errorMessage: '',
  failedAttempts: 0,
  lastFailedIp: ''
};

// Failed-pairing-attempt counter, purely informational -- not a lockout. Resets
// whenever the server (re)starts, e.g. after the user regenerates the pairing
// code, so a burst of failures from the user's own device reconnecting with a
// now-stale cached token doesn't linger as a false "someone's trying to get
// in" signal after they've already moved on. Deliberately no rate limiting or
// IP banning here: the 192-bit token already makes guessing infeasible, and a
// hard lockout would risk locking out the user's own device on a fat-fingered
// pairing code. This exists purely so the desktop UI can surface the fact
// that *something* has been failing, for the user to react to (e.g. by
// regenerating) if it's unexpected.
let failedAttempts = 0;
let lastFailedIp = '';

// Computes the RFC 6455 Sec-WebSocket-Accept value for a client key. The magic
// GUID must be exactly this string — a wrong GUID produces an accept that every
// strict client (real browsers, the `ws` library) rejects, so the socket opens
// at the TCP level but the browser aborts the handshake (close 1006).
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function computeAccept(key) {
  return require('crypto').createHash('sha1').update(key + WS_GUID).digest('base64');
}

function tokenFromUrl(url) {
  const i = String(url || '').indexOf('?');
  if (i === -1) return '';
  try { return new URLSearchParams(url.slice(i + 1)).get('t') || ''; }
  catch { return ''; }
}

function pairCheckStatus(provided, expected) {
  if (!expected) return 401;
  if (!provided || !remoteControl.tokensMatch(provided, expected)) return 403;
  return 204;
}

function computeStatus(patch = {}) {
  return {
    ...status,
    clients: clients.size,
    connected: clients.size > 0,
    ...patch
  };
}

function updateStatus(patch = {}) {
  status = computeStatus(patch);
  emitter.emit('status', status);
  return status;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal WebSocket server (no external deps)
// ─────────────────────────────────────────────────────────────────────────────

function writeHttpResponse(socket, status, headers = {}, body = '') {
  const head = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
  const prefix = head ? `${head}\r\n` : '';
  try {
    socket.write(`HTTP/1.1 ${status}\r\n${prefix}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  } catch { /* socket may already be gone */ }
  try { socket.end(); } catch {}
}

function recordFailedAttempt(socket) {
  failedAttempts++;
  lastFailedIp = (socket.remoteAddress || '').replace(/^::ffff:/, '');
  updateStatus({ failedAttempts, lastFailedIp });
}

function upgradeHandler(req, socket, head) {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }

  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  // Origin is not authentication (the token is), but a browser page from a
  // different host should never be allowed to drive the control plane. Non-
  // browser clients (health probes, the Android WebView without an Origin)
  // send none and are unaffected.
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { originHost = ''; }
    if (!originHost || originHost !== req.headers.host) {
      recordFailedAttempt(socket);
      writeHttpResponse(socket, '403 Forbidden', {}, 'Forbidden');
      return;
    }
  }

  const token = tokenFromUrl(req.url);

  // Reject any client that does not present the correct pairing token before
  // the WebSocket handshake, so the browser sees a proper HTTP 401/403 instead
  // of an ambiguous WebSocket close code.
  if (!expectedToken) {
    writeHttpResponse(socket, '401 Unauthorized', { 'WWW-Authenticate': 'Bearer' }, 'Unauthorized');
    return;
  }
  if (!token) {
    recordFailedAttempt(socket);
    writeHttpResponse(socket, '401 Unauthorized', { 'WWW-Authenticate': 'Bearer' }, 'Unauthorized');
    return;
  }
  if (!remoteControl.tokensMatch(token, expectedToken)) {
    recordFailedAttempt(socket);
    writeHttpResponse(socket, '403 Forbidden', {}, 'Forbidden');
    return;
  }

  const accept = computeAccept(key);

  // Startup readiness probes exercise the real HTTP upgrade path without
  // briefly appearing as a connected phone in the desktop UI.
  if (req.headers['x-lights-out-health-probe'] === '1') {
    socket.end(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    return;
  }

  // Cap concurrent clients so a misbehaving LAN device can't exhaust sockets.
  if (clients.size >= MAX_CLIENTS) {
    writeHttpResponse(socket, '503 Service Unavailable', {}, 'Service Unavailable');
    return;
  }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const client = { socket, alive: true, awaitingPong: false, buf: Buffer.alloc(0) };
  clients.add(client);

  // Protocol hello: lets the phone detect a too-old desktop instead of
  // silently assuming every advertised behavior exists. Unknown messages are
  // ignored by older companions, so this is backward compatible.
  try {
    sendToClient(client, {
      type: 'hello',
      protocol: 2,
      desktopVersion: APP_VERSION,
      capabilities: [
        'command-result',
        'run-active-rejection',
        'night-modes',
        'test-mode-authority',
        'origin-check'
      ]
    });
  } catch { /* hello is best-effort */ }

  socket.on('data', (chunk) => {
    if (!client.alive) return;
    client.awaitingPong = false;
    client.buf = client.buf.length ? Buffer.concat([client.buf, chunk]) : chunk;
    if (client.buf.length > MAX_BUFFER) { closeClient(client, 1009); return; }
    consumeFrames(client);
  });

  socket.on('close', () => { client.alive = false; clients.delete(client); updateStatus(); });
  socket.on('error', () => { client.alive = false; clients.delete(client); updateStatus(); });

  updateStatus();
  emitter.emit('connect', client);
}

// Minimal RFC 6455 frame reader. Consumes every complete frame currently held in
// client.buf, leaving any partial frame for the next chunk. Enforces masking
// (required for client→server frames), handles control frames (close/ping/pong),
// and bounds payload size.
function consumeFrames(client) {
  let buf = client.buf;
  while (client.alive) {
    if (buf.length < 2) break;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(MAX_MESSAGE)) { closeClient(client, 1009); return; }
      len = Number(big);
      offset = 10;
    }
    if (len > MAX_MESSAGE) { closeClient(client, 1009); return; }
    if (!masked) { closeClient(client, 1002); return; } // unmasked client frame is a protocol error
    if (buf.length < offset + 4 + len) break;            // wait for the rest of the frame

    const mask = buf.slice(offset, offset + 4);
    offset += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i & 3];
    buf = buf.slice(offset + len);
    client.buf = buf;
    dispatchFrame(client, opcode, fin, payload);
  }
  client.buf = buf;
}

function dispatchFrame(client, opcode, fin, payload) {
  switch (opcode) {
    case 0x1: // text — the only message type the companion sends
      if (!fin) return; // fragmented messages are not used; ignore safely
      try {
        const result = remoteControl.validateCompanionMessage(JSON.parse(payload.toString('utf8')));
        if (result.ok) emitter.emit('message', result.message, client);
      } catch { /* ignore malformed */ }
      break;
    case 0x8: // close — echo and tear down
      closeClient(client, 1000);
      break;
    case 0x9: // ping — reply pong
      try { client.socket.write(encodeFrame(0xA, payload)); } catch {}
      break;
    // 0x0 continuation, 0x2 binary, 0xA pong: ignored.
  }
}

function closeClient(client, code) {
  try {
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code || 1000, 0);
    client.socket.write(encodeFrame(0x8, body));
  } catch { /* socket may already be gone */ }
  client.alive = false;
  clients.delete(client);
  try { client.socket.end(); } catch {}
  updateStatus();
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      if (!client.alive || client.awaitingPong) {
        closeClient(client, 1001);
        continue;
      }
      client.awaitingPong = true;
      try { client.socket.write(encodeFrame(0x9, Buffer.alloc(0))); }
      catch { closeClient(client, 1001); }
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref?.();
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// Build a server→client frame (unmasked, single, FIN set).
function encodeFrame(opcode, payloadBuf) {
  const payload = payloadBuf || Buffer.alloc(0);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

function encodeWS(data) {
  return encodeFrame(0x1, Buffer.from(data));
}

function broadcast(data) {
  const msg = encodeWS(JSON.stringify(data));
  for (const client of clients) {
    if (client.alive) {
      try { client.socket.write(msg); } catch { client.alive = false; clients.delete(client); }
    }
  }
}

async function revokeClients() {
  const targets = [...clients].filter(client => client.alive);
  const notice = encodeWS(JSON.stringify({ type: 'pairing-revoked' }));
  await Promise.all(targets.map(client => new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      closeClient(client, 1008);
      resolve();
    };
    try {
      client.socket.write(notice, done);
      setTimeout(done, 250).unref?.();
    } catch {
      done();
    }
  })));
}

function sendToClient(client, data) {
  if (!client || !client.alive || !client.socket) return false;
  try {
    client.socket.write(encodeWS(JSON.stringify(data)));
    return true;
  } catch {
    client.alive = false;
    clients.delete(client);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP server for the PWA page
// ─────────────────────────────────────────────────────────────────────────────

function requestHandler(req, res) {
  const pathOnly = String(req.url || '').split('?')[0];
  if (pathOnly === '/health') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  } else if (pathOnly === '/pair-check') {
    // Browsers intentionally hide the HTTP status of a failed WebSocket
    // upgrade and surface it only as close code 1006. This same-origin
    // preflight lets the phone distinguish an expired pairing code from an
    // offline PC without exposing state or accepting an unauthenticated
    // WebSocket connection.
    const statusCode = pairCheckStatus(tokenFromUrl(req.url), expectedToken);
    if (statusCode !== 204) recordFailedAttempt(req.socket || {});
    res.writeHead(statusCode, { 'Cache-Control': 'no-store' });
    res.end();
  } else if (pathOnly === '/' || pathOnly === '/index.html') {
    // Serve the static shell as an inert pairing-only view. It contains no
    // secrets and all controls are disabled until the WebSocket control plane
    // (upgradeHandler) validates the pairing token. This lets a phone load the
    // app to type a pairing code manually while keeping remote actions gated.
    const htmlPath = path.join(__dirname, 'companion.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html',
        // The page is fully inline (script + style), so inline is allowed.
        // Server-provided data is rendered via textContent / createElement.
        // The value of this CSP is locking down where the page may connect/load from.
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'"
      });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end('Companion page not found');
    }
  } else if (req.url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: '/',
      name: 'Lights Out Companion',
      short_name: 'Lights Out',
      description: 'Control the Lights Out sleep timer on your PC from your phone.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#0b0f14',
      theme_color: '#0b0f14',
      // A real 512px PNG so the Add-to-Home-Screen shortcut is crisp. Declared
      // both 'any' and 'maskable' so Android adaptive icons render cleanly.
      // Note: over plain LAN HTTP this stays a shortcut (not a standalone
      // WebAPK) because installability requires a secure context.
      icons: [
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    }));
  } else if (req.url === '/icon-512.png') {
    const iconPath = path.join(__dirname, 'assets', 'icon-512.png');
    try {
      const icon = fs.readFileSync(iconPath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(icon);
    } catch {
      res.writeHead(404);
      res.end();
    }
  } else if (req.url === '/icon') {
    // Legacy icon route kept for backward compatibility.
    const iconPath = path.join(__dirname, 'assets', 'icon.ico');
    try {
      const icon = fs.readFileSync(iconPath);
      res.writeHead(200, { 'Content-Type': 'image/x-icon' });
      res.end(icon);
    } catch {
      res.writeHead(404);
      res.end();
    }
  } else {
    res.writeHead(404);
    res.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

function readinessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function probeHttpStatus(host, port, pathName, expectedStatus, errorCode, label) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: pathName, timeout: 3000, agent: false }, res => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === expectedStatus) resolve();
        else reject(readinessError(errorCode, `${label} for ${host} returned HTTP ${res.statusCode}`));
      });
    });
    req.on('timeout', () => req.destroy(readinessError(errorCode, `${label} for ${host} timed out`)));
    req.on('error', err => reject(readinessError(errorCode, `${label} for ${host} failed: ${err.message}`)));
  });
}

function probeWebSocket(host, port, token) {
  return new Promise((resolve, reject) => {
    const key = Buffer.from(require('crypto').randomBytes(16)).toString('base64');
    const req = http.request({
      host,
      port,
      path: `/?t=${encodeURIComponent(token)}`,
      timeout: 3000,
      agent: false,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        'X-Lights-Out-Health-Probe': '1'
      }
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      if (res.statusCode === 101) resolve();
      else reject(readinessError('WEBSOCKET_UPGRADE_FAILED', `WebSocket probe for ${host} returned HTTP ${res.statusCode}`));
    });
    req.on('response', res => {
      res.resume();
      reject(readinessError('WEBSOCKET_UPGRADE_FAILED', `WebSocket probe for ${host} returned HTTP ${res.statusCode}`));
    });
    req.on('timeout', () => req.destroy(readinessError('WEBSOCKET_UPGRADE_FAILED', `WebSocket probe for ${host} timed out`)));
    req.on('error', err => reject(readinessError('WEBSOCKET_UPGRADE_FAILED', `WebSocket probe for ${host} failed: ${err.message}`)));
    req.end();
  });
}

async function probeHostReadiness(host, port, token) {
  await probeHttpStatus(host, port, '/health', 204, 'HTTP_HEALTH_FAILED', 'Health probe');
  await probeHttpStatus(host, port, `/pair-check?t=${encodeURIComponent(token)}`, 204, 'PAIR_CHECK_FAILED', 'Pairing preflight');
  await probeWebSocket(host, port, token);
}

function probeReadiness(port, token, probeHost, bindHost = '127.0.0.1') {
  // Probe only what the listener actually claims to serve. A wildcard bind is
  // proven via loopback plus the advertised LAN address; a single-IP bind is
  // proven on that address (loopback correctly refuses there).
  const hosts = bindHost === '0.0.0.0'
    ? ['127.0.0.1', ...(probeHost && probeHost !== '127.0.0.1' ? [probeHost] : [])]
    : [bindHost];
  return Promise.all(hosts.map(host => probeHostReadiness(host, port, token)));
}

function start(opts = {}) {
  if (server) return Promise.resolve(getStatus());
  const generation = ++startGeneration;
  expectedToken = String(opts.token || '');
  bindHost = opts.host || '127.0.0.1';
  const port = opts.port || PWA_PORT;
  const probeHost = opts.probeHost || '';
  const readinessProbe = typeof opts.readinessProbe === 'function' ? opts.readinessProbe : probeReadiness;
  // Fresh start (including a regenerated token) clears the failed-attempt
  // count -- see recordFailedAttempt's comment for why this isn't a lockout.
  failedAttempts = 0;
  lastFailedIp = '';
  // Never expose a listener without a pairing token.
  if (!expectedToken) return Promise.resolve(getStatus());
  const instance = http.createServer(requestHandler);
  server = instance;
  instance.on('upgrade', upgradeHandler);
  updateStatus({
    running: false,
    ready: false,
    failed: false,
    host: bindHost,
    port,
    errorCode: '',
    errorMessage: '',
    failedAttempts,
    lastFailedIp
  });

  // Degrade gracefully if the port is already taken (most commonly another
  // Lights Out instance, or a leftover dev build). Without this handler the
  // server emits an unhandled 'error' that crashes the whole main process.
  return new Promise(resolve => {
    instance.once('error', (err) => {
      if (server === instance) server = null;
      stopHeartbeat();
      if (generation !== startGeneration) return resolve(getStatus());
      const errorCode = String(err && err.code || 'SERVER_ERROR');
      const errorMessage = String(err && (err.message || err.code) || 'Companion server failed to start');
      updateStatus({ failed: true, running: false, ready: false, errorCode, errorMessage, host: bindHost, port });
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`Companion PWA port ${port} is already in use - companion features disabled for this instance.`);
      } else {
        console.warn(`Companion PWA server error: ${errorMessage}`);
      }
      resolve(getStatus());
    });

    instance.listen(port, bindHost, async () => {
      if (generation !== startGeneration || server !== instance) return resolve(getStatus());
      console.log(`Companion PWA bound on ${bindHost}:${port}; verifying HTTP and WebSocket readiness.`);
      updateStatus({ running: true, ready: false, host: bindHost, port, failed: false, errorCode: '', errorMessage: '' });
      startHeartbeat();
      try {
        await readinessProbe(port, expectedToken, probeHost, bindHost);
        if (generation !== startGeneration || server !== instance) return resolve(getStatus());
        console.log(`Companion PWA ready on ${bindHost}:${port}`);
        updateStatus({ running: true, ready: true, host: bindHost, port, failed: false, connected: clients.size > 0, failedAttempts, lastFailedIp });
      } catch (err) {
        if (server === instance) {
          server = null;
          stopHeartbeat();
          await new Promise(resolveClose => {
            try {
              instance.close(resolveClose);
              if (typeof instance.closeAllConnections === 'function') instance.closeAllConnections();
            } catch {
              resolveClose();
            }
          });
        }
        const errorMessage = `Readiness check failed: ${err.message}`;
        updateStatus({ running: false, ready: false, failed: true, errorCode: err.code || 'READINESS_FAILED', errorMessage, host: bindHost, port });
        console.warn(`Companion PWA ${errorMessage}`);
      }
      resolve(getStatus());
    });
  });
}

function stop() {
  startGeneration++;
  const instance = server;
  server = null;
  expectedToken = '';
  stopHeartbeat();
  for (const client of clients) {
    try { client.socket.destroy(); } catch {}
  }
  clients.clear();
  updateStatus({ running: false, ready: false, clients: 0, connected: false, failed: false, errorCode: '', errorMessage: '' });
  if (!instance) return Promise.resolve();

  // A completed stop must mean the OS has released the listener. Token
  // rotation and Retry both restart immediately; resolving before the close
  // callback creates a race where the app can collide with its own old server.
  return new Promise(resolve => {
    try {
      instance.close(resolve);
      if (typeof instance.closeAllConnections === 'function') instance.closeAllConnections();
    } catch {
      resolve();
    }
  });
}

function getStatus() {
  return computeStatus();
}

function onMessage(callback) {
  emitter.on('message', callback);
}

function offMessage(callback) {
  emitter.off('message', callback);
}

function onConnect(callback) {
  emitter.on('connect', callback);
}

function onStatus(callback) {
  emitter.on('status', callback);
}

module.exports = {
  start,
  stop,
  broadcast,
  revokeClients,
  sendToClient,
  getStatus,
  onMessage,
  offMessage,
  onConnect,
  onStatus,
  PWA_PORT,
  // Exposed for unit testing the WebSocket handshake.
  computeAccept,
  pairCheckStatus,
  // Exposed for unit testing the hand-rolled RFC 6455 frame codec. These are
  // pure with respect to the (test-supplied) client object; consumeFrames /
  // dispatchFrame only read/write client.buf, client.alive, and client.socket.
  encodeFrame,
  consumeFrames,
  // Exposed for unit testing the failed-pairing-attempt counter (needs only
  // a socket-shaped object with .remoteAddress, no real server/port).
  recordFailedAttempt
};
