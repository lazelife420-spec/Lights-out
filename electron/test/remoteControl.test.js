// Unit tests for the LAN remote-control trust boundary (family + companion).
// This module is the gate every inbound network command passes through, so its
// token check and validation/clamping logic is worth locking down with tests.
// Run with: node --test  (or npm test)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const rc = require('../remoteControl');

// ─────────────────────────────────────────────────────────────────────────────
// generateToken
// ─────────────────────────────────────────────────────────────────────────────

test('generateToken returns a 48-char hex string', () => {
  const t = rc.generateToken();
  assert.match(t, /^[0-9a-f]{48}$/);
});

test('generateToken is unique across calls', () => {
  assert.notEqual(rc.generateToken(), rc.generateToken());
});

// ─────────────────────────────────────────────────────────────────────────────
// tokensMatch
// ─────────────────────────────────────────────────────────────────────────────

test('tokensMatch accepts identical non-empty tokens', () => {
  assert.equal(rc.tokensMatch('abc123', 'abc123'), true);
});

test('tokensMatch rejects differing tokens', () => {
  assert.equal(rc.tokensMatch('abc123', 'abc124'), false);
});

test('tokensMatch rejects empty / missing tokens', () => {
  assert.equal(rc.tokensMatch('', ''), false);
  assert.equal(rc.tokensMatch('abc', ''), false);
  assert.equal(rc.tokensMatch('', 'abc'), false);
});

test('tokensMatch rejects non-string and length-mismatched input', () => {
  assert.equal(rc.tokensMatch(null, 'abc'), false);
  assert.equal(rc.tokensMatch('abc', undefined), false);
  assert.equal(rc.tokensMatch(123, 123), false);
  assert.equal(rc.tokensMatch('abc', 'abcd'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// validateCommand (family LAN protocol)
// ─────────────────────────────────────────────────────────────────────────────

test('validateCommand rejects malformed input', () => {
  assert.equal(rc.validateCommand(null).ok, false);
  assert.equal(rc.validateCommand('start').ok, false);
  assert.equal(rc.validateCommand({}).ok, false);
  assert.equal(rc.validateCommand({ command: 'explode' }).ok, false);
});

test('validateCommand accepts a valid start and never forces shutdown', () => {
  const r = rc.validateCommand({ command: 'start', action: 'shutdown', durationSeconds: 1800 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.command, { command: 'start', action: 'shutdown', durationSeconds: 1800, forceShutdown: false });
});

test('validateCommand defaults start action to shutdown', () => {
  const r = rc.validateCommand({ command: 'start', durationSeconds: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.command.action, 'shutdown');
});

test('validateCommand blocks dangerous actions (logout, hibernate)', () => {
  for (const action of ['logout', 'hibernate', 'bogus']) {
    assert.equal(rc.validateCommand({ command: 'start', action, durationSeconds: 60 }).ok, false, action);
  }
});

test('validateCommand enforces duration bounds', () => {
  assert.equal(rc.validateCommand({ command: 'start', durationSeconds: rc.DURATION_MIN - 1 }).ok, false);
  assert.equal(rc.validateCommand({ command: 'start', durationSeconds: rc.DURATION_MAX + 1 }).ok, false);
  assert.equal(rc.validateCommand({ command: 'start', durationSeconds: 1.5 }).ok, false);
  assert.equal(rc.validateCommand({ command: 'start', durationSeconds: 'oops' }).ok, false);
  assert.equal(rc.validateCommand({ command: 'start', durationSeconds: rc.DURATION_MIN }).ok, true);
  assert.equal(rc.validateCommand({ command: 'start', durationSeconds: rc.DURATION_MAX }).ok, true);
});

test('validateCommand enforces snooze bounds', () => {
  assert.equal(rc.validateCommand({ command: 'snooze', seconds: rc.SNOOZE_MIN - 1 }).ok, false);
  assert.equal(rc.validateCommand({ command: 'snooze', seconds: rc.SNOOZE_MAX + 1 }).ok, false);
  const r = rc.validateCommand({ command: 'snooze', seconds: 300 });
  assert.deepEqual(r.command, { command: 'snooze', seconds: 300 });
});

test('validateCommand strips extra fields from parameterless commands', () => {
  const r = rc.validateCommand({ command: 'cancel', action: 'logout', evil: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.command, { command: 'cancel' });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateCompanionMessage (phone PWA protocol)
// ─────────────────────────────────────────────────────────────────────────────

test('validateCompanionMessage rejects unknown actions', () => {
  assert.equal(rc.validateCompanionMessage({ action: 'nuke' }).ok, false);
  assert.equal(rc.validateCompanionMessage(null).ok, false);
});

test('validateCompanionMessage validates a start and blocks bad actions', () => {
  const ok = rc.validateCompanionMessage({ action: 'start', timerAction: 'sleep', durationSeconds: 600 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.message, { action: 'start', timerAction: 'sleep', durationSeconds: 600 });
  assert.equal(rc.validateCompanionMessage({ action: 'start', timerAction: 'logout', durationSeconds: 600 }).ok, false);
});

test('validateCompanionMessage clamps snooze and passes through togglePause', () => {
  assert.equal(rc.validateCompanionMessage({ action: 'snooze', seconds: rc.SNOOZE_MAX + 1 }).ok, false);
  assert.deepEqual(rc.validateCompanionMessage({ action: 'togglePause', x: 1 }).message, { action: 'togglePause' });
});
