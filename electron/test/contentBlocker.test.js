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

// buildWriteHostsCommand is not exported historically; skip gracefully if absent.
const buildWriteHostsCommand = cb.__buildWriteHostsCommand;

test('buildWriteHostsCommand round-trips multi-line content through base64, preserving real newlines', { skip: !buildWriteHostsCommand }, () => {
  const content = '127.0.0.1 localhost\n# === LIGHTS OUT BLOCK START ===\n0.0.0.0 tiktok.com\n0.0.0.0 reddit.com\n# === LIGHTS OUT BLOCK END ===\n';
  const command = buildWriteHostsCommand(content);
  const match = /FromBase64String\('([^']*)'\)/.exec(command);
  assert.ok(match, 'command should embed a base64 payload');
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  assert.equal(decoded, content, 'decoded payload must match the original content, including real newlines');
  assert.ok(decoded.split('\n').length > 1, 'content must actually be multi-line, not collapsed');
});

test('buildWriteHostsCommand never embeds a raw single-quote from content (base64 alphabet is quote-free)', { skip: !buildWriteHostsCommand }, () => {
  // A single quote in content used to be escaped by doubling ('') in the old
  // string-interpolation version; verify the base64 payload contains none,
  // since that is what actually gets embedded in the single-quoted PS string.
  const content = "some 'quoted' content\nwith `backticks` and\nnewlines";
  const command = buildWriteHostsCommand(content);
  const match = /FromBase64String\('([^']*)'\)/.exec(command);
  assert.ok(match, 'command should embed a base64 payload');
  assert.doesNotMatch(match[1], /['`\n]/, 'base64 payload must contain no quotes, backticks, or newlines');
  assert.equal(Buffer.from(match[1], 'base64').toString('utf8'), content);
});
