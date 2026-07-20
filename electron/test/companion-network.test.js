'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCandidateIps, selectLanIp, networkFingerprint } = require('../companionNetwork');
const { discoverAdapterRoles } = require('../scripts/adapterRoles');

test('selectLanIp preserves a preferred address only while it is still present', () => {
  assert.equal(selectLanIp(['192.168.0.11', '192.168.0.16'], '192.168.0.16').lanIp, '192.168.0.16');
  assert.equal(selectLanIp(['192.168.0.11'], '192.168.0.111').lanIp, '192.168.0.11');
});

test('selectLanIp prefers the current routed source over a stale assigned preference', () => {
  const selected = selectLanIp(['192.168.0.111', '192.168.0.11'], '192.168.0.111', '192.168.0.11');
  assert.equal(selected.lanIp, '192.168.0.11');
});

test('selectLanIp reports no LAN endpoint instead of substituting loopback', () => {
  assert.deepEqual(selectLanIp([], '192.168.0.111'), { candidates: [], lanIp: '', hasLanIp: false });
  assert.deepEqual(selectLanIp(['127.0.0.1']), { candidates: [], lanIp: '', hasLanIp: false });
});

test('networkFingerprint detects address-set changes but ignores enumeration order', () => {
  assert.equal(networkFingerprint(['192.168.0.16', '192.168.0.11']), '::192.168.0.11|192.168.0.16');
  assert.equal(networkFingerprint(['192.168.0.11', '192.168.0.16']), '::192.168.0.11|192.168.0.16');
  assert.notEqual(networkFingerprint(['192.168.0.111']), networkFingerprint(['192.168.0.11']));
  assert.notEqual(networkFingerprint(['192.168.0.11'], '192.168.0.111'), networkFingerprint(['192.168.0.11'], '192.168.0.11'));
});

test('normalizeCandidateIps trims, deduplicates, and drops invalid values', () => {
  assert.deepEqual(normalizeCandidateIps([' 192.168.0.11 ', '192.168.0.11', '', null]), ['192.168.0.11']);
});

// ═══════════════════════════════════════════════════════════════════════════
// discoverAdapterRoles: fix/v11.1.1-packaged-network-adapter-roles
//
// packaged-network-smoke.js used to assert 'Wi-Fi 2' is connected and
// 'Wi-Fi' is disconnected by literal name -- true on the machine it was
// written on, false on any machine (or any day) where the OS assigned those
// labels the other way around. discoverAdapterRoles() classifies adapters by
// observed state (status/IPv4/virtual/default-route) instead of by name, so
// these are synthetic-inventory tests: pure data in, pure data out, no real
// adapter is read or touched. The failover/transition proof that used to
// require physically disconnecting hardware lives here now instead.
// ═══════════════════════════════════════════════════════════════════════════

const PHYSICAL_UP = { status: 'connected', isVirtual: false };
const PHYSICAL_DOWN = { status: 'disconnected', ipv4: null, isVirtual: false };

test('1&2. connected adapter is selected by observed state, not display name -- swapping names changes nothing', () => {
  const facts = (connectedName, disconnectedName) => [
    { ...PHYSICAL_UP, name: connectedName, index: 14, ipv4: '192.168.0.16', hasDefaultRoute: true },
    { ...PHYSICAL_DOWN, name: disconnectedName, index: 21 }
  ];
  const a = discoverAdapterRoles(facts('Wi-Fi', 'Wi-Fi 2'));
  const b = discoverAdapterRoles(facts('Wi-Fi 2', 'Wi-Fi')); // same facts, names swapped
  assert.equal(a.connectedAdapter.ipv4, '192.168.0.16');
  assert.equal(b.connectedAdapter.ipv4, '192.168.0.16');
  assert.equal(a.connectedAdapter.ipv4, b.connectedAdapter.ipv4, 'swapping display names must not change which adapter is selected');
  // The selected adapter's own name legitimately differs -- it follows the
  // fact (which one is actually connected), which is the whole point.
  assert.equal(a.connectedAdapter.name, 'Wi-Fi');
  assert.equal(b.connectedAdapter.name, 'Wi-Fi 2');
});

test('3. the disconnected adapter is never selected as the LAN endpoint', () => {
  const roles = discoverAdapterRoles([
    { ...PHYSICAL_UP, name: 'Wi-Fi', index: 14, ipv4: '192.168.0.16', hasDefaultRoute: true },
    { ...PHYSICAL_DOWN, name: 'Wi-Fi 2', index: 21 }
  ]);
  assert.equal(roles.connectedAdapter.name, 'Wi-Fi');
  assert.equal(roles.disconnectedAdapter.name, 'Wi-Fi 2');
  assert.notEqual(roles.disconnectedAdapter.ipv4, roles.connectedAdapter.ipv4);
});

test('4. an adapter reporting connected but with no usable IPv4 is rejected as a connected candidate', () => {
  const roles = discoverAdapterRoles([
    { ...PHYSICAL_UP, name: 'Ethernet', index: 8, ipv4: null, hasDefaultRoute: false }
  ]);
  assert.equal(roles.connectedAdapter, null);
});

test('5. loopback is never selected for either role', () => {
  const roles = discoverAdapterRoles([
    { name: 'Loopback Pseudo-Interface 1', index: 1, status: 'connected', ipv4: null, isVirtual: false, hasDefaultRoute: false },
    { ...PHYSICAL_UP, name: 'Wi-Fi', index: 14, ipv4: '192.168.0.16', hasDefaultRoute: true }
  ]);
  assert.equal(roles.connectedAdapter.name, 'Wi-Fi');
  assert.notEqual(roles.disconnectedAdapter?.name, 'Loopback Pseudo-Interface 1');
});

test('6. a virtual adapter ranks below a valid physical LAN adapter', () => {
  const roles = discoverAdapterRoles([
    { name: 'vEthernet (Default Switch)', index: 52, status: 'connected', ipv4: '172.21.160.1', isVirtual: true, hasDefaultRoute: false },
    { ...PHYSICAL_UP, name: 'Wi-Fi', index: 14, ipv4: '192.168.0.16', hasDefaultRoute: true }
  ]);
  assert.equal(roles.connectedAdapter.name, 'Wi-Fi');
});

test('6b. a virtual adapter is used when it is the only connected candidate', () => {
  const roles = discoverAdapterRoles([
    { name: 'vEthernet (Default Switch)', index: 52, status: 'connected', ipv4: '172.21.160.1', isVirtual: true, hasDefaultRoute: false },
    { ...PHYSICAL_DOWN, name: 'Wi-Fi', index: 14 }
  ]);
  assert.equal(roles.connectedAdapter.name, 'vEthernet (Default Switch)');
});

test('7. the default-route adapter wins when multiple physical connected candidates exist', () => {
  const roles = discoverAdapterRoles([
    { ...PHYSICAL_UP, name: 'Wi-Fi', index: 14, ipv4: '192.168.0.16', hasDefaultRoute: false },
    { ...PHYSICAL_UP, name: 'Ethernet', index: 9, ipv4: '10.0.0.5', hasDefaultRoute: true }
  ]);
  assert.equal(roles.connectedAdapter.name, 'Ethernet');
  assert.equal(roles.connectedAdapter.ipv4, '10.0.0.5');
});

test('8. total adapter disappearance produces a truthful degraded state, not a stale/fake selection', () => {
  const roles = discoverAdapterRoles([]);
  assert.equal(roles.connectedAdapter, null);
  assert.equal(roles.disconnectedAdapter, null);
  const selection = selectLanIp(normalizeCandidateIps([]), '192.168.0.16');
  assert.equal(selection.hasLanIp, false, 'losing the adapter must not leave a stale IP behind');
});

test('9&10. connected -> disconnected -> reconnected is reflected by role selection and by the production fingerprint', () => {
  const before = discoverAdapterRoles([
    { ...PHYSICAL_UP, name: 'Wi-Fi', index: 14, ipv4: '192.168.0.16', hasDefaultRoute: true }
  ]);
  assert.equal(before.connectedAdapter.ipv4, '192.168.0.16');
  const fingerprintBefore = networkFingerprint(['192.168.0.16'], '192.168.0.16');

  // Adapter drops.
  const during = discoverAdapterRoles([
    { ...PHYSICAL_DOWN, name: 'Wi-Fi', index: 14 }
  ]);
  assert.equal(during.connectedAdapter, null);
  const fingerprintDuring = networkFingerprint([], '');
  assert.notEqual(fingerprintDuring, fingerprintBefore, 'a real disconnect must change the fingerprint main.js uses to detect network changes');

  // Same adapter reconnects with the same routed IP.
  const after = discoverAdapterRoles([
    { ...PHYSICAL_UP, name: 'Wi-Fi', index: 14, ipv4: '192.168.0.16', hasDefaultRoute: true }
  ]);
  assert.equal(after.connectedAdapter.ipv4, '192.168.0.16');
  const fingerprintAfter = networkFingerprint(['192.168.0.16'], '192.168.0.16');
  assert.equal(fingerprintAfter, fingerprintBefore, 'reconnecting to the same routed IP must be recognized as returning to the prior known-good state');
});
