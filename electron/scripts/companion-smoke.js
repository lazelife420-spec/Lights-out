// Companion Easy Connect integration smoke test.
// Starts the real HTTP + WebSocket companion bridge, validates the connection
// contract, and proves token gating works end-to-end. Uses raw Node HTTP so
// the test can inspect the exact WebSocket close frame sent on bad tokens.

const http = require('http');
const companion = require('../companion');
const remoteControl = require('../remoteControl');

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name} -> ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// Perform a raw HTTP upgrade to the companion WebSocket and return the
// handshake response plus the first close frame (if any). The server may accept
// the handshake and then immediately send a close frame for bad tokens.
function wsUpgrade({ port, host, path }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      port,
      host,
      path,
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13'
      }
    });

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('upgrade timeout'));
    }, 2000);

    req.on('response', (res) => {
      clearTimeout(timer);
      resolve({ status: res.statusCode, closed: null, socket: null });
    });

    req.on('upgrade', (res, socket, head) => {
      let buf = head ? Buffer.from(head) : Buffer.alloc(0);
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const onData = (chunk) => {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        if (buf.length >= 4) {
          socket.off('data', onData);
          const opcode = buf[0] & 0x0f;
          const closeCode = buf.readUInt16BE(2);
          settle({ status: res.statusCode, opcode, closeCode, socket });
        }
      };
      // Valid connections may not send data immediately; treat a clean handshake
      // with no immediate close as a successful connection.
      const idleTimer = setTimeout(() => {
        socket.off('data', onData);
        settle({ status: res.statusCode, opcode: null, closeCode: null, socket });
      }, 300);
      socket.on('data', onData);
      socket.on('close', () => {
        clearTimeout(idleTimer);
        settle({ status: res.statusCode, opcode: null, closeCode: null, socket });
      });
      socket.on('error', (err) => {
        clearTimeout(idleTimer);
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      if (buf.length >= 4) onData(Buffer.alloc(0));
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

// Build a masked client->server WebSocket close frame with the given code.
function encodeCloseFrame(code) {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  const header = Buffer.from([0x88, 0x82, ...mask]);
  return Buffer.concat([header, payload]);
}

(async () => {
  try {
    // Ensure a clean state even if a previous run crashed.
    await companion.stop();
    await wait(100);

    const token = remoteControl.generateToken();
    const badToken = remoteControl.generateToken();

    await check('companion: off by default', () => {
      const status = companion.getStatus();
      assert(!status.running, 'server should not be running by default');
      assert(!status.connected, 'should not be connected by default');
      assert(status.clients === 0, 'no clients by default');
    });

    companion.start({ token, host: '127.0.0.1' });
    await wait(600);

    await check('companion: same-wifi starts and reports running', () => {
      const status = companion.getStatus();
      assert(status.running, 'server should be running');
      assert(status.host === '127.0.0.1', 'host should match');
      assert(!status.connected, 'no clients yet');
    });

    await check('companion: HTTP page served as inert pairing shell without token', async () => {
      const res = await httpGet(`http://127.0.0.1:${companion.PWA_PORT}/`);
      assert(res.status === 200, `expected 200 pairing shell, got ${res.status}`);
      assert(res.body.includes('Lights Out PC Companion'), 'page title missing');
      assert(res.body.includes('pair-input'), 'pairing input missing');
    });

    await check('companion: HTTP page with invalid token still served as inert shell', async () => {
      const res = await httpGet(`http://127.0.0.1:${companion.PWA_PORT}/?t=${badToken}`);
      assert(res.status === 200, `expected 200 pairing shell, got ${res.status}`);
      assert(res.body.includes('pair-input'), 'pairing input missing');
    });

    await check('companion: HTTP page with valid token served as inert shell', async () => {
      const res = await httpGet(`http://127.0.0.1:${companion.PWA_PORT}/?t=${token}`);
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.body.includes('pair-input'), 'pairing input missing');
    });

    await check('companion: WebSocket without token rejected with 401', async () => {
      const result = await wsUpgrade({ port: companion.PWA_PORT, host: '127.0.0.1', path: '/' });
      assert(result.status === 401, `expected 401, got ${result.status}`);
      if (result.socket) result.socket.destroy();
    });

    await check('companion: WebSocket with invalid token rejected with 403', async () => {
      const result = await wsUpgrade({
        port: companion.PWA_PORT,
        host: '127.0.0.1',
        path: `/?t=${badToken}`
      });
      assert(result.status === 403, `expected 403, got ${result.status}`);
      if (result.socket) result.socket.destroy();
    });

    await check('companion: WebSocket with valid token connects', async () => {
      const result = await wsUpgrade({
        port: companion.PWA_PORT,
        host: '127.0.0.1',
        path: `/?t=${token}`
      });
      assert(result.status === 101, 'valid token should upgrade');
      assert(result.opcode !== 0x8, 'valid token should not receive an immediate close');
      const status = companion.getStatus();
      assert(status.clients === 1, 'server should record one connected client');
      if (result.socket) {
        try { result.socket.write(encodeCloseFrame(1000)); } catch {}
        await wait(150);
        result.socket.destroy();
      }
    });

    const newToken = remoteControl.generateToken();
    await companion.stop();
    await wait(400);
    companion.start({ token: newToken, host: '127.0.0.1' });
    await wait(600);

    await check('companion: old token invalidated after rotation', async () => {
      const result = await wsUpgrade({
        port: companion.PWA_PORT,
        host: '127.0.0.1',
        path: `/?t=${token}`
      });
      assert(result.status === 403, `old token should be rejected with 403, got ${result.status}`);
      if (result.socket) result.socket.destroy();
    });

    await check('companion: new token accepted after rotation', async () => {
      const result = await wsUpgrade({
        port: companion.PWA_PORT,
        host: '127.0.0.1',
        path: `/?t=${newToken}`
      });
      assert(result.status === 101, 'new token should upgrade');
      assert(result.opcode !== 0x8, 'new token should not receive an immediate close');
      if (result.socket) {
        try { result.socket.write(encodeCloseFrame(1000)); } catch {}
        await wait(150);
        result.socket.destroy();
      }
    });

    await companion.stop();
    await wait(200);

    await check('companion: stop closes listener and rejects connections', async () => {
      const status = companion.getStatus();
      assert(!status.running, 'server should be stopped');
      let err;
      try { await httpGet(`http://127.0.0.1:${companion.PWA_PORT}/`); }
      catch (e) { err = e; }
      assert(err && err.code === 'ECONNREFUSED', `expected ECONNREFUSED, got ${err && err.code}`);
    });

    console.log(`\nCompanion Smoke Results: ${passed} passed, ${failed} failed\n`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.error('Companion smoke runner error:', e.message);
    await companion.stop().catch(() => {});
    process.exitCode = 1;
  }
})();
