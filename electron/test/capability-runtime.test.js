'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const wifiGuard = require('../wifiGuard');
const accountability = require('../accountability');

async function withServer(statusCode, callback) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(statusCode);
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await callback(`http://127.0.0.1:${server.address().port}/test`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('WiFi Guard webhook reports real configured success and HTTP failure', async () => {
  await withServer(204, async url => {
    const result = await wifiGuard.blockInternet({ provider: 'webhook', webhookUrl: url, deviceMacs: [] });
    assert.deepEqual(result, { success: true, provider: 'webhook' });
  });
  await withServer(500, async url => {
    const result = await wifiGuard.blockInternet({ provider: 'webhook', webhookUrl: url, deviceMacs: [] });
    assert.equal(result.success, false);
    assert.match(result.error, /HTTP 500/);
  });
});

test('Accountability webhook reports real configured success and HTTP failure', async () => {
  await withServer(204, async url => {
    const [result] = await accountability.testPartner({ type: 'webhook', url });
    assert.equal(result.success, true);
    assert.equal(result.status, 204);
  });
  await withServer(500, async url => {
    const [result] = await accountability.testPartner({ type: 'webhook', url });
    assert.equal(result.success, false);
    assert.equal(result.status, 500);
  });
});
