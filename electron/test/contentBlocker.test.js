// Unit tests for contentBlocker. Focus on the input-validation that keeps a
// crafted blocklist entry from injecting arbitrary lines into the hosts file.
// Run with: node --test  (or npm test)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

test('permission denial reports failure and leaves an isolated prior hosts file intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-hosts-denied-'));
  const target = path.join(dir, 'hosts');
  const original = '127.0.0.1 localhost\n# existing content\n';
  fs.writeFileSync(target, original, 'utf8');
  try {
    const denied = Object.assign(new Error('access denied'), { code: 'EACCES' });
    const success = await cb.__writeHosts('replacement content', {
      hostsPath: target,
      runCommand: async () => { throw denied; },
      fileSystem: { writeFileSync: () => { throw denied; } }
    });
    assert.equal(success, false);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// isScheduleActive/isAnyScheduleActive: recurring blocking windows,
// independent of the shutdown timer. Fixed `now` values throughout so the
// overnight-crossing edge cases (the whole reason this needs its own
// function instead of a naive time-range check) are deterministic.
const WED_2PM = new Date('2026-07-08T14:00:00'); // Wednesday, same-day window territory
const WED_11PM = new Date('2026-07-08T23:00:00'); // Wednesday night, before midnight
const THU_2AM = new Date('2026-07-09T02:00:00'); // Thursday early morning, after midnight
const THU_2PM = new Date('2026-07-09T14:00:00'); // Thursday afternoon, well outside any overnight window

test('isScheduleActive: same-day window is active only inside [start, end)', () => {
  const rule = { startTime: '13:00', endTime: '17:00', days: ['wed'], enabled: true };
  assert.equal(cb.isScheduleActive(rule, WED_2PM), true);
  assert.equal(cb.isScheduleActive(rule, THU_2PM), false, 'wrong day should not match');
  assert.equal(cb.isScheduleActive({ ...rule, startTime: '15:00' }, WED_2PM), false, 'before window start');
});

test('isScheduleActive: overnight window spans midnight correctly on both sides', () => {
  const rule = { startTime: '22:00', endTime: '07:00', days: ['wed'], enabled: true };
  assert.equal(cb.isScheduleActive(rule, WED_11PM), true, 'before-midnight portion on the scheduled day');
  assert.equal(cb.isScheduleActive(rule, THU_2AM), true, 'after-midnight portion the morning after the scheduled day');
  assert.equal(cb.isScheduleActive(rule, THU_2PM), false, 'well outside the overnight window');
  assert.equal(cb.isScheduleActive(rule, WED_2PM), false, 'daytime on the scheduled day itself is not inside 22:00-07:00');
});

test('isScheduleActive: overnight window does not leak into the wrong day-after', () => {
  // Schedule only runs Mon nights -- Thursday morning must NOT inherit
  // Wednesday's (unscheduled) overnight window.
  const rule = { startTime: '22:00', endTime: '07:00', days: ['mon'], enabled: true };
  assert.equal(cb.isScheduleActive(rule, THU_2AM), false);
});

test('isScheduleActive: disabled, zero-length, and malformed inputs are all inactive', () => {
  assert.equal(cb.isScheduleActive({ startTime: '22:00', endTime: '07:00', days: ['wed'], enabled: false }, WED_11PM), false);
  assert.equal(cb.isScheduleActive({ startTime: '10:00', endTime: '10:00', days: ['wed'], enabled: true }, WED_2PM), false, 'zero-length window');
  assert.equal(cb.isScheduleActive(null, WED_2PM), false);
  assert.equal(cb.isScheduleActive(undefined, WED_2PM), false);
});

test('isScheduleActive: missing/empty days defaults to every day', () => {
  const rule = { startTime: '13:00', endTime: '17:00', enabled: true };
  assert.equal(cb.isScheduleActive(rule, WED_2PM), true);
  assert.equal(cb.isScheduleActive({ ...rule, days: [] }, WED_2PM), true);
});

test('isAnyScheduleActive: true if any schedule in the list is active, false for empty/non-array', () => {
  const schedules = [
    { startTime: '22:00', endTime: '07:00', days: ['mon'], enabled: true },  // not today
    { startTime: '13:00', endTime: '17:00', days: ['wed'], enabled: true }   // active now
  ];
  assert.equal(cb.isAnyScheduleActive(schedules, WED_2PM), true);
  assert.equal(cb.isAnyScheduleActive(schedules, THU_2PM), false);
  assert.equal(cb.isAnyScheduleActive([], WED_2PM), false);
  assert.equal(cb.isAnyScheduleActive(null, WED_2PM), false);
  assert.equal(cb.isAnyScheduleActive(undefined, WED_2PM), false);
});
