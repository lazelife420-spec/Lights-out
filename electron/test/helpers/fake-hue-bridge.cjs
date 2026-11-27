'use strict';
// Loopback-only fake Philips Hue Bridge (local v1 API) for the smart-lights
// regression tests. It never contacts a real device or the LAN: it listens on
// 127.0.0.1 only, with throwaway self-signed certificates made per run.
//
// HTTPS mode terminates TLS in front of a plain HTTP backend and records every
// decrypted byte per certificate label, so a test can prove that NOTHING (no
// path, no Hue key, no body) reached a server that presented the wrong
// certificate — the TLS handshake happens, the request never does.
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const OPENSSL = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';

// specs: { label: commonName } → { label: { key, cert, fingerprint } }
function makeCertificates(specs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-hue-certs-'));
  try {
    const out = {};
    for (const [label, commonName] of Object.entries(specs)) {
      const keyFile = path.join(dir, `${label}.key`);
      const certFile = path.join(dir, `${label}.crt`);
      execFileSync(OPENSSL, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-days', '1', '-subj', `/CN=${commonName}`, '-keyout', keyFile, '-out', certFile], { windowsHide: true, stdio: 'ignore' });
      const cert = fs.readFileSync(certFile, 'utf8');
      out[label] = { key: fs.readFileSync(keyFile, 'utf8'), cert, fingerprint: new crypto.X509Certificate(cert).fingerprint256 };
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// A light that is off rejects every attribute but `on` with error 201, like a
// real bridge. `on` is applied first, so {on:true, bri} switches it on.
function applyState(light, body, address) {
  const out = [];
  if ('on' in body) {
    light.state.on = Boolean(body.on);
    out.push({ success: { [`${address}/on`]: light.state.on } });
  }
  for (const [key, value] of Object.entries(body)) {
    if (key === 'on' || key === 'transitiontime') continue;
    if (!light.state.on) {
      out.push({ error: { type: 201, address: `${address}/${key}`, description: `parameter, ${key}, is not modifiable. Device is set to off.` } });
      continue;
    }
    light.state[key] = value;
    out.push({ success: { [`${address}/${key}`]: value } });
  }
  return out;
}

function route(bridge, method, url, body) {
  const parts = url.split('?')[0].split('/').filter(Boolean);
  const unavailable = address => [{ error: { type: 3, address, description: `resource, ${address}, not available` } }];
  if (parts[0] !== 'api') return [{ error: { type: 4, address: url, description: 'method, not available' } }];
  if (parts.length === 1 && method === 'POST') {
    if (!bridge.linkButton) return [{ error: { type: 101, address: '', description: 'link button not pressed' } }];
    bridge.users.add(bridge.registerAs);
    return [{ success: { username: bridge.registerAs } }];
  }
  if (parts[1] === 'config' && parts.length === 2) return { name: 'Fake bridge', bridgeid: bridge.bridgeid };
  if (!bridge.users.has(parts[1])) {
    return [{ error: { type: 1, address: '/' + parts.slice(2).join('/'), description: 'unauthorized user' } }];
  }
  const [, , kind, id, leaf] = parts;
  if (kind === 'lights') {
    if (!id && method === 'GET') return bridge.lights;
    const light = bridge.lights[id];
    if (!light) return unavailable(`/lights/${id}`);
    if (!leaf && method === 'GET') return light;
    if (leaf === 'state' && method === 'PUT') return applyState(light, body || {}, `/lights/${id}/state`);
  }
  if (kind === 'groups') {
    if (!id && method === 'GET') return bridge.groups;
    const group = bridge.groups[id];
    if (!group) return unavailable(`/groups/${id}`);
    if (!leaf && method === 'GET') return group;
    if (leaf === 'action' && method === 'PUT') {
      for (const member of group.lights) if (bridge.lights[member]) applyState(bridge.lights[member], body || {}, `/lights/${member}/state`);
      return Object.entries(body || {}).map(([key, value]) => ({ success: { [`/groups/${id}/action/${key}`]: value } }));
    }
  }
  return [{ error: { type: 4, address: url, description: 'method, not available' } }];
}

// certificate: { key, cert } for HTTPS, or null for a plain-HTTP (legacy) bridge.
async function startFakeBridge({ certificate = null, label = 'bridge', users = ['user-1'], lights = {}, groups = {},
  linkButton = false, registerAs = 'registered-user', bridgeid = '001788FFFE00AB12' } = {}) {
  const bridge = {
    lights: structuredClone(lights), groups: structuredClone(groups), users: new Set(users),
    linkButton, registerAs, bridgeid, label: certificate ? label : 'plain',
    requests: [],   // parsed HTTP requests: { method, url, body, label }
    raw: [],        // decrypted bytes per TLS connection: { label, text }
    connections: [], // accepted TCP connections on the bridge port, by label
    handshakes: [], // TLS handshakes the server completed, by label
    hold: null      // optional async (request) => void, delays the reply
  };
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); };
  const backend = http.createServer((req, res) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { text += chunk; });
    req.on('end', async () => {
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      const entry = { method: req.method, url: req.url, body, label: bridge.label };
      bridge.requests.push(entry);
      const payload = route(bridge, req.method, req.url, body);
      if (bridge.hold) await bridge.hold(entry);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  backend.on('connection', track);
  const backendPort = await listen(backend);
  let front = backend;
  let port = backendPort;
  if (certificate) {
    front = tls.createServer({ key: certificate.key, cert: certificate.cert }, secure => {
      const connectionLabel = bridge.label;
      bridge.handshakes.push(connectionLabel);
      const upstream = net.connect(backendPort, '127.0.0.1');
      track(secure);
      track(upstream);
      secure.on('data', chunk => bridge.raw.push({ label: connectionLabel, text: chunk.toString('latin1') }));
      secure.pipe(upstream).pipe(secure);
      const drop = () => { secure.destroy(); upstream.destroy(); };
      secure.on('close', drop);
      upstream.on('close', drop);
    });
    front.on('connection', socket => { bridge.connections.push(bridge.label); track(socket); });
    front.on('tlsClientError', () => {});
    port = await listen(front);
  }
  bridge.port = port;
  bridge.host = `127.0.0.1:${port}`;
  // Swap the certificate new connections get (an impostor, or a reset bridge).
  bridge.useCertificate = (nextLabel, cert) => {
    bridge.label = nextLabel;
    front.setSecureContext({ key: cert.key, cert: cert.cert });
  };
  bridge.close = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => backend.close(() => resolve()));
    if (front !== backend) await new Promise(resolve => front.close(() => resolve()));
  };
  return bridge;
}

// Listeners for transport-failure tests (loopback only).
async function startSilentListener() {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('error', () => {}); });
  const port = await listen(server);
  return { port, accepted: () => sockets.size, close: () => { for (const s of sockets) s.destroy(); return new Promise(r => server.close(() => r())); } };
}

async function startResettingListener() {
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    if (typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy();
    else socket.destroy();
  });
  const port = await listen(server);
  return { port, close: () => new Promise(r => server.close(() => r())) };
}

async function closedPort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise(r => server.close(() => r()));
  return port;
}

module.exports = { makeCertificates, startFakeBridge, startSilentListener, startResettingListener, closedPort, listen };
