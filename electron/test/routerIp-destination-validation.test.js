// Regression test for DEF-002: routerIp destination trust boundary.
//
// Adjudication proof (2026-09-14, HEAD 268e6b0) demonstrated that a DNS name,
// URL-with-path, or other non-IP value in routerIp causes router credentials to
// be sent to an attacker-controlled host.
//
// PRE-FIX: sanitizeWifiGuard accepted any non-empty string as routerIp.
// POST-FIX: sanitizeWifiGuard enforces PRIVATE_LAN_ONLY policy — only
//   RFC 1918, loopback, link-local, and ULA IPv6 addresses are accepted.
//   Globally routable IPs are rejected to prevent credential exfiltration
//   even when the attacker cannot control DNS resolution.
//
// ROUTER_DESTINATION_POLICY = PRIVATE_LAN_ONLY

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeWifiGuard, isPrivateOrLocal } = require('../capabilityTruth');

const VALID_BASE = {
  enabled: true,
  provider: 'tplink',
  deviceMacs: ['AA:BB:CC:DD:EE:FF']
};

// --- POSITIVE CASES: valid IP addresses must be accepted ---

test('routerIp: valid IPv4 private address is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '192.168.0.1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
  assert.strictEqual(result.setupError, '');
});

test('routerIp: valid IPv4 10.x address is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '10.0.0.1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp: valid IPv6 loopback is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '::1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp: valid IPv6 link-local is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: 'fe80::1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp: IPv4 loopback is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '127.0.0.1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

// --- NEGATIVE CASES: non-IP values must be REJECTED ---
// These are the exact attack vectors proven in the adjudication.

test('routerIp: DNS hostname is rejected (credential exfiltration vector)', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: 'evil.example.com' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
  assert.ok(result.setupError.length > 0, 'must produce error message');
});

test('routerIp: hostname with port is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: 'evil.com:8080' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: IP with embedded path is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '10.0.0.1/../../etc' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: IP with embedded port is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '192.168.0.1:8080' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: full URL is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: 'http://192.168.0.1' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: embedded credentials in URL format is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: 'admin:pass@192.168.0.1' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: whitespace-padded IP is accepted (trimmed)', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '  192.168.0.1  ' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp: empty string is rejected (not configured)', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: whitespace-only is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '   ' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: Unicode homoglyph is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '192\u0660168.0.1' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: multicast address is rejected (not private/local)', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '224.0.0.1' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
  assert.ok(result.setupError.includes('private/local'));
});

test('routerIp: broadcast address is rejected (not private/local)', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '255.255.255.255' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

// --- DESTINATION TRUST: globally routable IPs must be REJECTED ---
// These close the residual exfiltration vector where an attacker tricks
// the user into entering a public IP as their "router address".

test('routerIp: globally routable 8.8.8.8 is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '8.8.8.8' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
  assert.ok(result.setupError.includes('private/local'));
});

test('routerIp: globally routable 1.1.1.1 is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '1.1.1.1' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: documentation range 203.0.113.50 is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '203.0.113.50' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: globally routable IPv6 (2001:db8::1) is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '2001:db8::1' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

// --- DESTINATION TRUST: private/local ranges must be ACCEPTED ---

test('routerIp: 172.16.0.1 (RFC 1918) is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '172.16.0.1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp: 172.31.255.254 (RFC 1918 upper) is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '172.31.255.254' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp: 172.32.0.1 (outside RFC 1918) is rejected', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '172.32.0.1' });
  assert.strictEqual(result.configured, false);
  assert.strictEqual(result.enabled, false);
});

test('routerIp: 169.254.1.1 (link-local) is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '169.254.1.1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp: fd12::1 (ULA IPv6) is accepted', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: 'fd12::1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

// --- isPrivateOrLocal direct unit tests ---

test('isPrivateOrLocal: comprehensive range coverage', () => {
  // ACCEPT: private/local
  assert.strictEqual(isPrivateOrLocal('10.0.0.1'), true, '10.x RFC 1918');
  assert.strictEqual(isPrivateOrLocal('10.255.255.255'), true, '10.x upper');
  assert.strictEqual(isPrivateOrLocal('172.16.0.1'), true, '172.16.x');
  assert.strictEqual(isPrivateOrLocal('172.31.255.254'), true, '172.31.x');
  assert.strictEqual(isPrivateOrLocal('192.168.0.1'), true, '192.168.x');
  assert.strictEqual(isPrivateOrLocal('192.168.255.255'), true, '192.168.x upper');
  assert.strictEqual(isPrivateOrLocal('127.0.0.1'), true, 'loopback');
  assert.strictEqual(isPrivateOrLocal('127.255.255.255'), true, 'loopback upper');
  assert.strictEqual(isPrivateOrLocal('169.254.1.1'), true, 'link-local');
  assert.strictEqual(isPrivateOrLocal('::1'), true, 'IPv6 loopback');
  assert.strictEqual(isPrivateOrLocal('fe80::1'), true, 'IPv6 link-local');
  assert.strictEqual(isPrivateOrLocal('fd00::1'), true, 'IPv6 ULA fd');
  assert.strictEqual(isPrivateOrLocal('fc00::1'), true, 'IPv6 ULA fc');

  // REJECT: globally routable
  assert.strictEqual(isPrivateOrLocal('8.8.8.8'), false, 'Google DNS');
  assert.strictEqual(isPrivateOrLocal('1.1.1.1'), false, 'Cloudflare DNS');
  assert.strictEqual(isPrivateOrLocal('203.0.113.50'), false, 'documentation range');
  assert.strictEqual(isPrivateOrLocal('172.32.0.1'), false, 'just outside 172.16-31');
  assert.strictEqual(isPrivateOrLocal('172.15.255.255'), false, 'just below 172.16');
  assert.strictEqual(isPrivateOrLocal('11.0.0.1'), false, 'just above 10.x');
  assert.strictEqual(isPrivateOrLocal('2001:db8::1'), false, 'documentation IPv6');
  assert.strictEqual(isPrivateOrLocal('2600::1'), false, 'globally routable IPv6');

  // REJECT: not an IP at all
  assert.strictEqual(isPrivateOrLocal('evil.com'), false, 'hostname');
  assert.strictEqual(isPrivateOrLocal(''), false, 'empty');
});

// --- IMPORT / LEGACY COMPAT: existing valid-IP configs must survive ---

test('routerIp: imported config with valid IP passes through', () => {
  const imported = { enabled: true, provider: 'asus', routerIp: '10.0.0.1', routerUser: 'admin', routerPass: 'secret', deviceMacs: ['11:22:33:44:55:66'] };
  const result = sanitizeWifiGuard(imported);
  assert.strictEqual(result.enabled, true);
  assert.strictEqual(result.configured, true);
});

test('routerIp: imported config with DNS name is blocked', () => {
  const imported = { enabled: true, provider: 'netgear', routerIp: 'router.local', routerUser: 'admin', routerPass: 'secret', deviceMacs: ['11:22:33:44:55:66'] };
  const result = sanitizeWifiGuard(imported);
  assert.strictEqual(result.enabled, false);
  assert.strictEqual(result.configured, false);
  assert.ok(result.setupError.includes('valid IP address'), 'error message guides user');
});

// --- PROVIDER ISOLATION: webhook/adapter providers are not affected ---

test('routerIp validation does not affect webhook provider', () => {
  const result = sanitizeWifiGuard({ enabled: true, provider: 'webhook', webhookUrl: 'https://example.com/block', routerIp: 'evil.com' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp validation does not affect adapter provider', () => {
  const result = sanitizeWifiGuard({ enabled: true, provider: 'adapter', routerIp: 'evil.com' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});
