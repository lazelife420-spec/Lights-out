// Unit tests for wifiGuard input-validation guards. These keep crafted IP/MAC
// values (from imported or shared config) out of PowerShell firewall commands
// and router API request bodies.
// Run with: node --test  (or npm test)

const { test } = require('node:test');
const assert = require('node:assert/strict');

// wifiGuard loads only Node core modules at module scope, so it imports cleanly
// under plain node without Electron.
const wifiGuard = require('../wifiGuard');
const validIps = wifiGuard.__validIps;
const validMacs = wifiGuard.__validMacs;

test('validIps keeps clean IPv4/IPv6 and drops everything else', () => {
  const dirty = [
    '192.168.1.10',                 // valid v4
    '::1',                          // valid v6
    '10.0.0.1; shutdown /s',        // command-injection attempt
    "1.2.3.4' ; calc ; '",          // shell metacharacters
    '999.999.999.999',              // not a valid IP
    'not-an-ip',
    '',
    123                             // non-string
  ];
  assert.deepEqual(validIps(dirty), ['192.168.1.10', '::1']);
});

test('validIps handles null/undefined/non-array safely', () => {
  assert.deepEqual(validIps(null), []);
  assert.deepEqual(validIps(undefined), []);
  assert.deepEqual(validIps([]), []);
});

test('validMacs accepts colon, hyphen, and bare-hex forms and trims', () => {
  const input = [
    'AA:BB:CC:DD:EE:FF',            // colon form
    'aa-bb-cc-dd-ee-ff',            // hyphen form
    '  001122334455  ',             // bare 12-hex, padded
  ];
  assert.deepEqual(validMacs(input), [
    'AA:BB:CC:DD:EE:FF',
    'aa-bb-cc-dd-ee-ff',
    '001122334455'
  ]);
});

test('validMacs drops malformed / injection / non-string entries', () => {
  const dirty = [
    'AA:BB:CC:DD:EE',               // too short
    'GG:BB:CC:DD:EE:FF',            // non-hex
    "AA:BB:CC:DD:EE:FF'; rm -rf",   // injection attempt
    'AABBCCDDEEFF00',               // too long
    'not a mac',
    '',
    null,
    {}
  ];
  assert.deepEqual(validMacs(dirty), []);
});

test('validMacs handles null/undefined/non-array safely', () => {
  assert.deepEqual(validMacs(null), []);
  assert.deepEqual(validMacs(undefined), []);
  assert.deepEqual(validMacs([]), []);
});
