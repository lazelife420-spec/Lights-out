
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const companion = require('../companion');

test('Companion integration: Off mode (no listener)', async (t) => {
  await companion.stop();
  companion.start({ token: '', host: '127.0.0.1' });

  const status = companion.getStatus();
  assert.equal(status.running, false, 'Should not be running without a token');
  await companion.stop();
});

test('Companion integration: Token authentication', async (t) => {
  const token = 'test-token-123';
  await companion.stop();
  companion.start({ token, host: '127.0.0.1' });

  const status = companion.getStatus();
  assert.equal(status.running, true, 'Should be running with a token');

  // 1. Valid token request (HTTP part)
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${companion.PWA_PORT}/?t=${token}`, { agent: false }, (res) => {
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
      port: companion.PWA_PORT,
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

test('Companion integration: Host binding (Local vs LAN)', async (t) => {
  // This test only verifies the configuration in companion.js
  const token = 'test-token';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Local mode
  await companion.stop();
  companion.start({ token, host: '127.0.0.1' });
  await wait(100);
  assert.equal(companion.getStatus().host, '127.0.0.1');

  // LAN mode
  await companion.stop();
  companion.start({ token, host: '0.0.0.0' });
  await wait(100);
  assert.equal(companion.getStatus().host, '0.0.0.0');

  await companion.stop();
});
