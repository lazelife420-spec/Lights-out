'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const smartLights = require('../smartLights');

test('Smart Lights cannot remain enabled without verification of the exact configuration', async () => {
  smartLights.loadConfig({ provider: 'hue', hueBridgeIp: '', hueUsername: '', enabled: true, verifiedConfigKey: 'invented' });
  assert.equal(smartLights.getConfig().enabled, false);
  const result = await smartLights.testSmartLightConnection();
  assert.equal(result.success, false);
});

test('Smart Lights enables only after a real successful test and disables after configuration changes', async (t) => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(204); res.end(); });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/lights`;

  smartLights.loadConfig({ provider: 'http', httpUrl: url, httpMethod: 'POST', enabled: false, verifiedConfigKey: '' });
  const result = await smartLights.testSmartLightConnection();
  assert.equal(result.success, true);
  assert.ok(result.verifiedConfigKey);

  smartLights.loadConfig({ enabled: true, verifiedConfigKey: result.verifiedConfigKey });
  assert.equal(smartLights.getConfig().enabled, true);

  smartLights.loadConfig({ httpUrl: `${url}/changed`, enabled: true, verifiedConfigKey: result.verifiedConfigKey });
  assert.equal(smartLights.getConfig().enabled, false);
});
