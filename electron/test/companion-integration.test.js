
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const companion = require('../companion');
const remoteControl = require('../remoteControl');

test('Companion integration: Off mode (no listener)', async (t) => {
  companion.stop();
  companion.start({ token: '', host: '127.0.0.1' });
  
  const status = companion.getStatus();
  assert.equal(status.running, false, 'Should not be running without a token');
});

test('Companion integration: Token authentication', async (t) => {
  const token = 'test-token-123';
  companion.stop();
  companion.start({ token, host: '127.0.0.1' });
  
  const status = companion.getStatus();
  assert.equal(status.running, true, 'Should be running with a token');

  // 1. Valid token request (HTTP part)
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${companion.PWA_PORT}/?t=${token}`, (res) => {
      assert.equal(res.statusCode, 200, 'Valid token should allow page access');
      resolve();
    }).on('error', reject);
  });

  // 2. Invalid token upgrade request (WebSocket part)
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
      assert.equal(res.statusCode, 401, 'Invalid token should return 401');
      resolve();
    });
    
    req.on('upgrade', (res, socket) => {
      assert.fail('Should not upgrade with wrong token');
      socket.destroy();
      resolve();
    });
    
    req.on('error', () => {
      // Some node versions might just close the connection which is also fine
      resolve();
    });
    
    req.end();
  });

  companion.stop();
});

test('Companion integration: Host binding (Local vs LAN)', async (t) => {
  // This test only verifies the configuration in companion.js
  const token = 'test-token';
  
  // Local mode
  companion.stop();
  companion.start({ token, host: '127.0.0.1' });
  assert.equal(companion.getStatus().host, '127.0.0.1');
  
  // LAN mode
  companion.stop();
  companion.start({ token, host: '0.0.0.0' });
  assert.equal(companion.getStatus().host, '0.0.0.0');
  
  companion.stop();
});
