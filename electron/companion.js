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
let server = null;
let wss = null;
let clients = new Set();
const emitter = new EventEmitter();

// Pairing token required from every client. Empty = no listener may bind.
let expectedToken = '';
let bindHost = '127.0.0.1';

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

// ─────────────────────────────────────────────────────────────────────────────
// Minimal WebSocket server (no external deps)
// ─────────────────────────────────────────────────────────────────────────────

function upgradeHandler(req, socket, head) {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }

  // Reject any client that does not present the correct pairing token.
  if (!remoteControl.tokensMatch(tokenFromUrl(req.url), expectedToken)) {
    socket.destroy(); return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  // Cap concurrent clients so a misbehaving LAN device can't exhaust sockets.
  if (clients.size >= MAX_CLIENTS) { socket.destroy(); return; }

  const accept = computeAccept(key);

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const client = { socket, alive: true, buf: Buffer.alloc(0) };
  clients.add(client);

  socket.on('data', (chunk) => {
    if (!client.alive) return;
    client.buf = client.buf.length ? Buffer.concat([client.buf, chunk]) : chunk;
    if (client.buf.length > MAX_BUFFER) { closeClient(client, 1009); return; }
    consumeFrames(client);
  });

  socket.on('close', () => { client.alive = false; clients.delete(client); });
  socket.on('error', () => { client.alive = false; clients.delete(client); });

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

// ─────────────────────────────────────────────────────────────────────────────
// HTTP server for the PWA page
// ─────────────────────────────────────────────────────────────────────────────

function requestHandler(req, res) {
  const pathOnly = String(req.url || '').split('?')[0];
  if (pathOnly === '/' || pathOnly === '/index.html') {
    // Serve the static shell unauthenticated. It contains no secrets, and the
    // WebSocket control plane (upgradeHandler) is what enforces the pairing
    // token. Gating the page itself broke the installed-PWA launch, whose
    // manifest start_url ('/') carries no token.
    const htmlPath = path.join(__dirname, 'companion.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html',
        // The page is fully inline (script + style), so inline is allowed; it
        // renders server data only via textContent, never innerHTML. The value
        // of this CSP is locking down where the page may connect/load from.
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
      background_color: '#0d0e11',
      theme_color: '#0d0e11',
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

function start(opts = {}) {
  if (server) return;
  expectedToken = String(opts.token || '');
  bindHost = opts.host || '127.0.0.1';
  // Never expose a listener without a pairing token.
  if (!expectedToken) return;
  server = http.createServer(requestHandler);
  server.on('upgrade', upgradeHandler);

  // Degrade gracefully if the port is already taken (most commonly another
  // Lights Out instance, or a leftover dev build). Without this handler the
  // server emits an unhandled 'error' that crashes the whole main process.
  server.on('error', (err) => {
    server = null;
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`Companion PWA port ${PWA_PORT} is already in use - companion features disabled for this instance.`);
    } else {
      console.warn(`Companion PWA server error: ${err && (err.message || err.code)}`);
    }
  });

  server.listen(PWA_PORT, bindHost, () => {
    console.log(`Companion PWA running on ${bindHost}:${PWA_PORT}`);
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
  expectedToken = '';
  for (const client of clients) {
    try { client.socket.destroy(); } catch {}
  }
  clients.clear();
}

function getStatus() {
  return {
    running: !!server,
    port: PWA_PORT,
    clients: clients.size,
    host: bindHost
  };
}

function onMessage(callback) {
  emitter.on('message', callback);
}

function onConnect(callback) {
  emitter.on('connect', callback);
}

module.exports = {
  start,
  stop,
  broadcast,
  getStatus,
  onMessage,
  onConnect,
  PWA_PORT,
  // Exposed for unit testing the WebSocket handshake.
  computeAccept
};
