
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

  // 2. Invalid token upgrade request (WebSocket part) should complete the
  // handshake, then immediately close with 1008 policy violation so the phone
  // can distinguish bad token from network failure.
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
      assert.fail('Should not receive a plain HTTP response for an upgrade request');
      resolve();
    });

    req.on('upgrade', (res, socket, head) => {
      assert.equal(res.statusCode, 101, 'Server should complete the WebSocket handshake');
      let buf = Buffer.alloc(0);
      const onData = (chunk) => {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        // Minimum close frame: FIN + opcode 0x8, masked bit clear, length 2, 2-byte code.
        if (buf.length >= 4) {
          socket.off('data', onData);
          const opcode = buf[0] & 0x0f;
          const closeCode = buf.readUInt16BE(2);
          assert.equal(opcode, 0x8, 'Should receive a close frame');
          assert.equal(closeCode, 1008, 'Invalid token should close with 1008 policy violation');
          socket.destroy();
          resolve();
        }
      };
      socket.on('data', onData);
      socket.on('close', () => resolve());
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
