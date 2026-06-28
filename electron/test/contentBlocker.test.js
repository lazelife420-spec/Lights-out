// Unit tests for contentBlocker. Focus on the input-validation that keeps a
// crafted blocklist entry from injecting arbitrary lines into the hosts file.
// Run with: node --test  (or npm test)

const { test } = require('node:test');
const assert = require('node:assert/strict');

// contentBlocker requires no Electron APIs at module load, so it imports cleanly
// under plain node for testing.
const cb = require('../contentBlocker');

test('exposes a non-empty default blocklist of clean hostnames', () => {
  assert.ok(Array.isArray(cb.DEFAULT_BLOCKLIST));
  assert.ok(cb.DEFAULT_BLOCKLIST.length > 0);
  for (const site of cb.DEFAULT_BLOCKLIST) {
    assert.doesNotMatch(site, /\s/, `default entry has whitespace: ${site}`);
  }
});

// sanitizeSites is the guard; it is not exported, so exercise it via the test
// hook if present, otherwise skip gracefully.
const sanitize = cb.__sanitizeSites;

test('sanitizeSites drops newline-injection and non-hostname entries', { skip: !sanitize }, () => {
  const dirty = [
    'tiktok.com',                       // valid
    'evil.com\n1.2.3.4 bank.com',       // newline injection attempt
    '0.0.0.0 attacker.com',             // space / hosts-line attempt
    "x.com'; calc.exe; '",              // shell metacharacters
    '192.168.0.1',                      // bare IP, not a hostname
    'not a host',                       // whitespace
    'GOOD.COM',                         // valid, normalized to lowercase
    'tiktok.com'                        // duplicate
  ];
  const clean = sanitize(dirty);
  assert.deepEqual(clean, ['tiktok.com', 'good.com']);
});

test('sanitizeSites returns [] for non-array / empty input', { skip: !sanitize }, () => {
  assert.deepEqual(sanitize(null), []);
  assert.deepEqual(sanitize(undefined), []);
  assert.deepEqual(sanitize([]), []);
  assert.deepEqual(sanitize([123, {}, '']), []);
});
