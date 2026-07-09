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
