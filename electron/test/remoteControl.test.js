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

test('validateCompanionMessage strips desktop-owned identity and safety fields', () => {
  const result = rc.validateCompanionMessage({
    action: 'start',
    timerAction: 'shutdown',
    durationSeconds: 900,
    nightModeId: 'full-shutdown',
    nightModeTitle: 'Forged title',
    nightModeVersion: 99,
    profileId: 'forged-profile',
    profileName: 'Forged profile',
    dryRun: true,
    forceShutdown: true
  });
  assert.deepEqual(result.message, {
    action: 'start',
    timerAction: 'shutdown',
    durationSeconds: 900
  });
});

test('validateCompanionMessage keeps force shutdown, logout, and hibernate impossible', () => {
  for (const timerAction of ['logout', 'hibernate']) {
    assert.equal(rc.validateCompanionMessage({ action: 'start', timerAction, durationSeconds: 900 }).ok, false);
  }
  const shutdown = rc.validateCompanionMessage({
    action: 'start',
    timerAction: 'shutdown',
    durationSeconds: 900,
    forceShutdown: true
  });
  assert.equal(shutdown.ok, true);
  assert.equal('forceShutdown' in shutdown.message, false);
});

test('validateCompanionMessage clamps snooze and passes through togglePause', () => {
  assert.equal(rc.validateCompanionMessage({ action: 'snooze', seconds: rc.SNOOZE_MAX + 1 }).ok, false);
  assert.deepEqual(rc.validateCompanionMessage({ action: 'togglePause', x: 1 }).message, { action: 'togglePause' });
});

test('validateCompanionMessage accepts startNightMode with a valid nightModeId', () => {
  const result = rc.validateCompanionMessage({ action: 'startNightMode', nightModeId: 'quick-sleep' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.message, { action: 'startNightMode', nightModeId: 'quick-sleep' });
});

test('validateCompanionMessage rejects startNightMode with missing or invalid id', () => {
  assert.equal(rc.validateCompanionMessage({ action: 'startNightMode' }).ok, false);
  assert.equal(rc.validateCompanionMessage({ action: 'startNightMode', nightModeId: '' }).ok, false);
  assert.equal(rc.validateCompanionMessage({ action: 'startNightMode', nightModeId: 123 }).ok, false);
});

test('validateCompanionMessage strips smuggled fields from startNightMode', () => {
  const result = rc.validateCompanionMessage({
    action: 'startNightMode',
    nightModeId: 'quick-sleep',
    timerAction: 'shutdown',
    actionName: 'logout',
    durationSeconds: 9999,
    ritualId: 'standard',
    startOrigin: 'companion-night-mode',
    source: 'remote',
    dryRun: true,
    nightModeTitle: 'Forged',
    nightModeVersion: 99,
    profileId: 'kid',
    profileName: 'Kid',
    forceShutdown: true,
    force: true,
    logout: true,
    hibernate: true,
    command: 'start',
    steps: ['shutdown'],
    actions: ['hibernate']
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.message, { action: 'startNightMode', nightModeId: 'quick-sleep' });
});

test('validateCompanionMessage passes through getNightModes', () => {
  assert.deepEqual(rc.validateCompanionMessage({ action: 'getNightModes' }).message, { action: 'getNightModes' });
});

// UI-R3 P08: the LAN protocol is unchanged. A read-only 'status' command is a
// trust-boundary change that needs owner sign-off before it is added.
test('ALLOWED_COMMANDS is exactly the five reviewed commands', () => {
  assert.deepEqual([...rc.ALLOWED_COMMANDS].sort(), ['cancel', 'pause', 'resume', 'snooze', 'start']);
});

test('validateCommand refuses an unreviewed status command', () => {
  assert.deepEqual(rc.validateCommand({ command: 'status', token: 'x', extra: 1 }), { ok: false, error: 'unknown command' });
});

test('validateCommand strips extra fields from parameterless commands', () => {
  assert.deepEqual(rc.validateCommand({ command: 'pause', durationSeconds: 999999, action: 'logout', forceShutdown: true }), { ok: true, command: { command: 'pause' } });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strict Protocol V3 Companion Validator (validateCompanionV3Message, C3-A)
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

  const nanPv = rc.validateCompanionV3Message({ protocolVersion: Number.NaN, action: 'cancel', requestId: validReqId });
  assert.equal(nanPv.ok, false);
  assert.equal(nanPv.reason, rc.REJECTION_REASONS.INVALID_PROTOCOL_VERSION);

  const floatPv = rc.validateCompanionV3Message({ protocolVersion: 3.5, action: 'cancel', requestId: validReqId });
  assert.equal(floatPv.ok, false);
  assert.equal(floatPv.reason, rc.REJECTION_REASONS.INVALID_PROTOCOL_VERSION);

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

test('validateCompanionV3Message handles getNightModes correlationId without requiring requestId', () => {
  const withCorr = rc.validateCompanionV3Message({ action: 'getNightModes', correlationId: 'q-98765' });
  assert.equal(withCorr.ok, true);
  assert.deepEqual(withCorr.command, { action: 'getNightModes', correlationId: 'q-98765' });

  const withoutCorr = rc.validateCompanionV3Message({ action: 'getNightModes' });
  assert.equal(withoutCorr.ok, true);
  assert.deepEqual(withoutCorr.command, { action: 'getNightModes', correlationId: null });
});

test('validateCompanionV3Message validates start and startNightMode bounds and strips forged fields', () => {
  const badStart = rc.validateCompanionV3Message({
    protocolVersion: 3,
    requestId: validReqId,
    action: 'start',
    timerAction: 'hibernate',
    durationSeconds: 600
  });
  assert.equal(badStart.ok, false);
  assert.equal(badStart.reason, rc.REJECTION_REASONS.INVALID_PAYLOAD);

  const okStart = rc.validateCompanionV3Message({
    protocolVersion: 3,
    requestId: validReqId,
    action: 'start',
    timerAction: 'sleep',
    durationSeconds: 900,
    forceShutdown: true,
    dryRun: true
  });
  assert.equal(okStart.ok, true);
  assert.deepEqual(okStart.command, {
    protocolVersion: 3,
    requestId: validReqId,
    action: 'start',
    timerAction: 'sleep',
    durationSeconds: 900
  });

  const okNm = rc.validateCompanionV3Message({
    protocolVersion: 3,
    requestId: validReqId,
    action: 'startNightMode',
    nightModeId: 'quick-sleep',
    dryRun: true,
    forceShutdown: true
  });
  assert.equal(okNm.ok, true);
  assert.deepEqual(okNm.command, {
    protocolVersion: 3,
    requestId: validReqId,
    action: 'startNightMode',
    nightModeId: 'quick-sleep'
  });
});

test('validateCompanionV3Message rejects arrays, coerced numeric types, empty timerAction, and bad getNightModes protocolVersion', () => {
  const arr = rc.validateCompanionV3Message([]);
  assert.equal(arr.ok, false);
  assert.equal(arr.reason, rc.REJECTION_REASONS.INVALID_PAYLOAD);

  const arraySeconds = rc.validateCompanionV3Message({
    protocolVersion: 3,
    requestId: validReqId,
    action: 'snooze',
    seconds: [300]
  });
  assert.equal(arraySeconds.ok, false);
  assert.equal(arraySeconds.reason, rc.REJECTION_REASONS.INVALID_PAYLOAD);

  const stringDuration = rc.validateCompanionV3Message({
    protocolVersion: 3,
    requestId: validReqId,
    action: 'start',
    timerAction: 'sleep',
    durationSeconds: '600'
  });
  assert.equal(stringDuration.ok, false);
  assert.equal(stringDuration.reason, rc.REJECTION_REASONS.INVALID_PAYLOAD);

  const emptyTimerAction = rc.validateCompanionV3Message({
    protocolVersion: 3,
    requestId: validReqId,
    action: 'start',
    timerAction: '',
    durationSeconds: 600
  });
  assert.equal(emptyTimerAction.ok, false);
  assert.equal(emptyTimerAction.reason, rc.REJECTION_REASONS.INVALID_PAYLOAD);

  const badGetNmPv = rc.validateCompanionV3Message({ protocolVersion: 4, action: 'getNightModes' });
  assert.equal(badGetNmPv.ok, false);
  assert.equal(badGetNmPv.reason, rc.REJECTION_REASONS.UNSUPPORTED_PROTOCOL_VERSION);

  const okGetNmPv = rc.validateCompanionV3Message({ protocolVersion: 3, action: 'getNightModes', correlationId: 'c-1' });
  assert.equal(okGetNmPv.ok, true);
  assert.deepEqual(okGetNmPv.command, { action: 'getNightModes', correlationId: 'c-1' });
});
