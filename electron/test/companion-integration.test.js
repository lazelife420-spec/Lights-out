
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const companion = require('../companion');

// These integration cases exercise one process-wide companion singleton.
// Node may schedule top-level tests concurrently, so explicitly serialize
// ownership of that listener instead of allowing tests to stop each other.
let integrationQueue = Promise.resolve();
function serialTest(name, run) {
  test(name, async (t) => {
    const previous = integrationQueue;
    let release;
    integrationQueue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await run(t);
    } finally {
      release();
    }
  });
}

// Pick a free ephemeral port so the suite is portable across hosts where the
// app's production port (58732) may be reserved by the OS (e.g. Windows
// Hyper-V/WinNAT exclusions).
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function getResponse(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, (res) => {
      const result = { statusCode: res.statusCode, headers: res.headers };
      res.resume();
      res.on('end', () => resolve(result));
    }).on('error', reject);
  });
}

serialTest('Companion integration: Off mode (no listener)', async (t) => {
  await companion.stop();
  await companion.start({ token: '', host: '127.0.0.1' });

  const status = companion.getStatus();
  assert.equal(status.running, false, 'Should not be running without a token');
  await companion.stop();
});

serialTest('Companion integration: Token authentication', async (t) => {
  const token = 'test-token-123';
  await companion.stop();
  const port = await freePort();
  await companion.start({ token, host: '127.0.0.1', port });

  const status = companion.getStatus();
  assert.equal(status.running, true, 'Should be running with a token');
  assert.equal(status.ready, true, 'HTTP and WebSocket readiness probes should pass before start resolves');

  // 1. Valid token request (HTTP part)
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/?t=${token}`, { agent: false }, (res) => {
      assert.equal(res.statusCode, 200, 'Valid token should allow page access');
      res.resume();
      res.on('close', resolve);
    }).on('error', reject);
  });

  // 2. Invalid token upgrade request (WebSocket part) must be rejected before
  // the handshake with HTTP 403 so the browser can distinguish a bad token from
  // a network failure.
  await new Promise((resolve) => {
    const req = http.request({
      port,
      host: '127.0.0.1',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13'
      },
      path: '/?t=wrong-token'
    });

    req.on('response', (res) => {
      assert.equal(res.statusCode, 403, 'Invalid token should return 403');
      res.resume();
      res.on('close', resolve);
    });

    req.on('upgrade', () => {
      assert.fail('Should not complete WebSocket handshake for invalid token');
    });

    req.on('error', () => {
      // Some node versions might just close the connection which is also fine
      resolve();
    });

    req.end();
  });

  await companion.stop();
});

serialTest('Companion integration: occupied port reports a truthful bind failure', async () => {
  await companion.stop();
  const blocker = http.createServer((req, res) => res.end('occupied'));
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  const port = blocker.address().port;

  try {
    const status = await companion.start({ token: 'bind-failure-token', host: '127.0.0.1', port });
    assert.equal(status.failed, true);
    assert.equal(status.ready, false);
    assert.equal(status.running, false);
    assert.equal(status.errorCode, 'EADDRINUSE');
    assert.match(status.errorMessage, /EADDRINUSE|address already in use/i);
  } finally {
    await companion.stop();
    await new Promise(resolve => blocker.close(resolve));
  }
});

serialTest('Companion integration: Pair-check reports stale and rotated tokens', async () => {
  const originalToken = 'original-token';
  const rotatedToken = 'rotated-token';
  const port = await freePort();

  await companion.stop();
  await companion.start({ token: originalToken, host: '127.0.0.1', port });

  const valid = await getResponse(`http://127.0.0.1:${port}/pair-check?t=${originalToken}`);
  assert.equal(valid.statusCode, 204, 'Current pairing token should pass preflight');
  assert.equal(valid.headers['cache-control'], 'no-store', 'Pairing decisions must never be cached');

  const missing = await getResponse(`http://127.0.0.1:${port}/pair-check`);
  assert.equal(missing.statusCode, 403, 'Missing token should be rejected');

  const stale = await getResponse(`http://127.0.0.1:${port}/pair-check?t=stale-token`);
  assert.equal(stale.statusCode, 403, 'Stale token should be reported as expired');

  await companion.stop();
  await companion.start({ token: rotatedToken, host: '127.0.0.1', port });

  const revoked = await getResponse(`http://127.0.0.1:${port}/pair-check?t=${originalToken}`);
  assert.equal(revoked.statusCode, 403, 'Rotating the token should revoke the previous token');

  const replacement = await getResponse(`http://127.0.0.1:${port}/pair-check?t=${rotatedToken}`);
  assert.equal(replacement.statusCode, 204, 'Rotated token should pass preflight');

  await companion.stop();
});

serialTest('Companion integration: Host binding (Local vs LAN)', async (t) => {
  // This test only verifies the configuration in companion.js
  const token = 'test-token';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const port = await freePort();

  // Local mode
  await companion.stop();
  await companion.start({ token, host: '127.0.0.1', port });
  await wait(100);
  assert.equal(companion.getStatus().host, '127.0.0.1');

  // LAN mode
  await companion.stop();
  await companion.start({ token, host: '0.0.0.0', port, probeHost: '127.0.0.1' });
  await wait(100);
  assert.equal(companion.getStatus().host, '0.0.0.0');

  await companion.stop();
});

for (const errorCode of ['HTTP_HEALTH_FAILED', 'PAIR_CHECK_FAILED', 'WEBSOCKET_UPGRADE_FAILED']) {
  serialTest(`Companion integration: ${errorCode} blocks readiness`, async () => {
    const port = await freePort();
    const status = await companion.start({
      token: 'readiness-failure-token',
      host: '127.0.0.1',
      port,
      readinessProbe: async () => {
        const error = new Error(`controlled ${errorCode}`);
        error.code = errorCode;
        throw error;
      }
    });
    assert.equal(status.running, false);
    assert.equal(status.ready, false);
    assert.equal(status.failed, true);
    assert.equal(status.errorCode, errorCode);
    await companion.stop();
  });
}

serialTest('Companion integration: repeated token-rotation restarts release the same port', async () => {
  const port = await freePort();
  for (let i = 0; i < 5; i++) {
    await companion.stop();
    const status = await companion.start({ token: `rotation-${i}`, host: '127.0.0.1', port });
    assert.equal(status.ready, true);
    assert.notEqual(status.errorCode, 'EADDRINUSE');
  }
  await companion.stop();
});
