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
// Legacy Shipping validateCompanionMessage (Unversioned / Phone Compatibility)
// ─────────────────────────────────────────────────────────────────────────────

test('legacy validateCompanionMessage accepts all currently shipped companion frames without V3 fields', () => {
  assert.deepEqual(rc.validateCompanionMessage({ action: 'togglePause' }).message, { action: 'togglePause' });
  assert.deepEqual(rc.validateCompanionMessage({ action: 'snooze', seconds: 300 }).message, { action: 'snooze', seconds: 300 });
  assert.deepEqual(rc.validateCompanionMessage({ action: 'cancel' }).message, { action: 'cancel' });
  assert.deepEqual(rc.validateCompanionMessage({ action: 'start', durationSeconds: 1800, timerAction: 'shutdown' }).message, { action: 'start', timerAction: 'shutdown', durationSeconds: 1800 });
  assert.deepEqual(rc.validateCompanionMessage({ action: 'startNightMode', nightModeId: 'quick-sleep' }).message, { action: 'startNightMode', nightModeId: 'quick-sleep' });
  assert.deepEqual(rc.validateCompanionMessage({ action: 'getNightModes' }).message, { action: 'getNightModes' });
});

test('legacy validateCompanionMessage rejects unknown actions and malformed input', () => {
  assert.equal(rc.validateCompanionMessage({ action: 'nuke' }).ok, false);
  assert.equal(rc.validateCompanionMessage(null).ok, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Strict Protocol V3 Companion Validator (validateCompanionV3Message)
// ─────────────────────────────────────────────────────────────────────────────

const validReqId = 'req-1234567890123456';

test('validateCompanionV3Message requires protocolVersion: 3 and valid requestId', () => {
  const missingPv = rc.validateCompanionV3Message({ action: 'cancel', requestId: validReqId });
  assert.equal(missingPv.ok, false);
  assert.equal(missingPv.reason, rc.REJECTION_REASONS.UPGRADE_REQUIRED);

  const pv2 = rc.validateCompanionV3Message({ protocolVersion: 2, action: 'cancel', requestId: validReqId });
  assert.equal(pv2.ok, false);
  assert.equal(pv2.reason, rc.REJECTION_REASONS.UPGRADE_REQUIRED);

  const pv4 = rc.validateCompanionV3Message({ protocolVersion: 4, action: 'cancel', requestId: validReqId });
  assert.equal(pv4.ok, false);
  assert.equal(pv4.reason, rc.REJECTION_REASONS.UNSUPPORTED_PROTOCOL_VERSION);

  const stringPv = rc.validateCompanionV3Message({ protocolVersion: '3', action: 'cancel', requestId: validReqId });
  assert.equal(stringPv.ok, false);
  assert.equal(stringPv.reason, rc.REJECTION_REASONS.INVALID_PROTOCOL_VERSION);

  const missingReq = rc.validateCompanionV3Message({ protocolVersion: 3, action: 'cancel' });
  assert.equal(missingReq.ok, false);
  assert.equal(missingReq.reason, rc.REJECTION_REASONS.INVALID_REQUEST_ID);

  const badReq = rc.validateCompanionV3Message({ protocolVersion: 3, action: 'cancel', requestId: 'short' });
  assert.equal(badReq.ok, false);
  assert.equal(badReq.reason, rc.REJECTION_REASONS.INVALID_REQUEST_ID);
});

test('validateCompanionV3Message rejects pause and resume by default', () => {
  const p = rc.validateCompanionV3Message({ protocolVersion: 3, requestId: validReqId, action: 'pause' });
  assert.equal(p.ok, false);
  assert.equal(p.reason, rc.REJECTION_REASONS.UNSUPPORTED_ACTION);

  const r = rc.validateCompanionV3Message({ protocolVersion: 3, requestId: validReqId, action: 'resume' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, rc.REJECTION_REASONS.UNSUPPORTED_ACTION);
});

test('validateCompanionV3Message accepts pause and resume when explicitly enabled in options', () => {
  const opts = { enabledActions: ['pause', 'resume', 'cancel'] };
  const p = rc.validateCompanionV3Message({ protocolVersion: 3, requestId: validReqId, action: 'pause' }, opts);
  assert.equal(p.ok, true);
  assert.equal(p.command.action, 'pause');

  const r = rc.validateCompanionV3Message({ protocolVersion: 3, requestId: validReqId, action: 'resume' }, opts);
  assert.equal(r.ok, true);
  assert.equal(r.command.action, 'resume');
});

test('validateCompanionV3Message strips forged fields and returns canonical payload', () => {
  const res = rc.validateCompanionV3Message({
    protocolVersion: 3,
    requestId: validReqId,
    action: 'snooze',
    seconds: 300,
    forceShutdown: true,
    profileId: 'forged',
    nightModeTitle: 'Forged'
  });

  assert.equal(res.ok, true);
  assert.deepEqual(res.command, {
    protocolVersion: 3,
    requestId: validReqId,
    action: 'snooze',
    seconds: 300
  });
  assert.deepEqual(res.canonicalPayload, {
    action: 'snooze',
    seconds: 300
  });
});
