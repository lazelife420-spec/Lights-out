const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { filterAndRankLocalIPs } = require('../family');

describe('family.filterAndRankLocalIPs', () => {
  test('prefers 192.168 over virtual 172.21', () => {
    const candidates = filterAndRankLocalIPs({
      'vEthernet (Wi-Fi)': [{ family: 'IPv4', internal: false, address: '172.21.96.1' }],
      'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.0.11' }]
    });
    const ips = candidates.map((c) => c.ip);
    assert.equal(ips[0], '192.168.0.11', '192.168 should beat virtual 172.21');
    assert.ok(!ips.includes('172.21.96.1'), 'virtual adapter should be excluded');
  });

  test('prefers 10.x over invalid/loopback/link-local', () => {
    const candidates = filterAndRankLocalIPs({
      'lo': [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      'eth0': [{ family: 'IPv4', internal: false, address: '169.254.1.5' }],
      'wlan0': [{ family: 'IPv4', internal: false, address: '10.0.0.5' }]
    });
    const ips = candidates.map((c) => c.ip);
    assert.equal(ips[0], '10.0.0.5', '10.x should be preferred');
    assert.ok(!ips.includes('127.0.0.1'), 'loopback should be excluded');
    assert.ok(!ips.includes('169.254.1.5'), 'link-local should be excluded');
  });

  test('prefers 192.168 over 10.x and 172.16-31', () => {
    const candidates = filterAndRankLocalIPs({
      'tap': [{ family: 'IPv4', internal: false, address: '172.30.0.2' }],
      'eth1': [{ family: 'IPv4', internal: false, address: '10.0.0.2' }],
      'eth2': [{ family: 'IPv4', internal: false, address: '192.168.1.2' }]
    });
    const ips = candidates.map((c) => c.ip);
    assert.equal(ips[0], '192.168.1.2', '192.168 should be first');
    assert.ok(ips.includes('10.0.0.2'), '10.x should be included');
    assert.ok(ips.includes('172.30.0.2'), '172.16-31 should be included');
  });

  test('rejects virtual adapter names', () => {
    const candidates = filterAndRankLocalIPs({
      'VMware Network Adapter': [{ family: 'IPv4', internal: false, address: '192.168.100.5' }],
      'Realtek': [{ family: 'IPv4', internal: false, address: '192.168.0.5' }]
    });
    const ips = candidates.map((c) => c.ip);
    assert.ok(!ips.includes('192.168.100.5'), 'VMware adapter should be excluded');
    assert.equal(ips[0], '192.168.0.5', 'real adapter should be selected');
  });
});

describe('family command server truthfulness', () => {
  const family = require('../family');
  const http = require('node:http');

  function postCommand(body, token) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1', port: 58734, path: '/command', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-lightsout-token': token },
        timeout: 3000
      }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(data);
      req.end();
    });
  }

  test('rejected commands report the real outcome, not unconditional success', async (t) => {
    const started = family.start({ enabled: true, token: 'test-tok', peerName: 'test', bindHost: '127.0.0.1' }, (cmd) => {
      if (cmd.command === 'start') return { success: false, code: 'RUN_ACTIVE', error: 'A Lights Out run is already active. Stop it before starting another.' };
      return { success: false, code: 'NOT_RUNNING', error: 'No running timer' };
    });
    t.after(() => family.stop());
    assert.equal(started, true);
    await new Promise(r => setTimeout(r, 150)); // let the server bind

    const denied = await postCommand({ command: 'start', durationSeconds: 120, action: 'shutdown' }, 'test-tok');
    assert.equal(denied.status, 409, 'RUN_ACTIVE must surface as a real rejection');
    assert.equal(denied.body.success, false);
    assert.match(denied.body.error, /already active/i);

    const badToken = await postCommand({ command: 'cancel' }, 'wrong-tok');
    assert.equal(badToken.status, 401);
  });

  test('accepted commands report success with the handler code', async (t) => {
    family.stop();
    const started = family.start({ enabled: true, token: 'test-tok', peerName: 'test', bindHost: '127.0.0.1' }, () => ({ success: true, code: 'STARTED' }));
    t.after(() => family.stop());
    assert.equal(started, true);
    await new Promise(r => setTimeout(r, 150));

    const ok = await postCommand({ command: 'start', durationSeconds: 120, action: 'shutdown' }, 'test-tok');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.code, 'STARTED');
  });
});
