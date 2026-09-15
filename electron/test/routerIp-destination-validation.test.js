// Regression test for DEF-002: routerIp must be a valid IP address.
//
// Adjudication proof (2026-09-14, HEAD 268e6b0) demonstrated that a DNS name,
// URL-with-path, or other non-IP value in routerIp causes router credentials to
// be sent to an attacker-controlled host. The fix validates routerIp with
// net.isIP() at the sanitization trust boundary (capabilityTruth.sanitizeWifiGuard).
//
// PRE-FIX: sanitizeWifiGuard accepted any non-empty string as routerIp, returned
//          configured=true and enabled=true for DNS names, URLs, etc.
// POST-FIX: sanitizeWifiGuard rejects non-IP values, returns configured=false,
//           enabled=false, and a user-facing error message.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeWifiGuard } = require('../capabilityTruth');

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

test('routerIp: multicast address is accepted (net.isIP passes; router unlikely but valid IP)', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '224.0.0.1' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
});

test('routerIp: broadcast address is accepted (valid IP syntax)', () => {
  const result = sanitizeWifiGuard({ ...VALID_BASE, routerIp: '255.255.255.255' });
  assert.strictEqual(result.configured, true);
  assert.strictEqual(result.enabled, true);
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
