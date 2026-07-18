// Unit tests for Companion V2 C3-A protocol primitives and idempotency registry.
// Run with: node --test  (or cd electron && npm test)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const rc = require('../remoteControl');
const IdempotencyRegistry = require('../idempotencyRegistry');

// ─────────────────────────────────────────────────────────────────────────────
// C3-A Primitive Helpers (createRequestId, createCommandAck, REJECTION_REASONS)
// ─────────────────────────────────────────────────────────────────────────────

test('createRequestId returns a valid 36-char UUID string', () => {
  const id1 = rc.createRequestId();
  const id2 = rc.createRequestId();
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(id1, id2);
});

test('createRequestId secure fallback works when crypto.randomUUID is absent', () => {
  const originalRandomUUID = globalThis.crypto ? globalThis.crypto.randomUUID : null;
  if (globalThis.crypto) globalThis.crypto.randomUUID = undefined;
  try {
    const id = rc.createRequestId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } finally {
    if (globalThis.crypto) globalThis.crypto.randomUUID = originalRandomUUID;
  }
});

test('createCommandAck constructs a valid targeted commandAck DTO', () => {
  const ack = rc.createCommandAck({
    requestId: 'req-1234567890123456',
    action: 'snooze',
    status: 'applied',
    duplicate: false,
    reason: null,
    stateRevision: 42
  });

  assert.deepEqual(ack, {
    type: 'commandAck',
    protocolVersion: 3,
    requestId: 'req-1234567890123456',
    action: 'snooze',
    status: 'applied',
    duplicate: false,
    reason: null,
    stateRevision: 42
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateCompanionMessage Protocol V3 Rules
// ─────────────────────────────────────────────────────────────────────────────

test('validateCompanionMessage requires protocolVersion: 3 on mutating commands', () => {
  const result = rc.validateCompanionMessage({
    action: 'snooze',
    requestId: 'req-1234567890123456',
    seconds: 300
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, rc.REJECTION_REASONS.UPGRADE_REQUIRED);
});

test('validateCompanionMessage requires a valid requestId on mutating commands', () => {
  const missingReq = rc.validateCompanionMessage({
    protocolVersion: 3,
    action: 'snooze',
    seconds: 300
  });
  assert.equal(missingReq.ok, false);
  assert.equal(missingReq.reason, rc.REJECTION_REASONS.INVALID_REQUEST_ID);

  const badFormatReq = rc.validateCompanionMessage({
    protocolVersion: 3,
    action: 'snooze',
    requestId: 'short', // under 16 chars
    seconds: 300
  });
  assert.equal(badFormatReq.ok, false);
  assert.equal(badFormatReq.reason, rc.REJECTION_REASONS.INVALID_REQUEST_ID);
});

test('validateCompanionMessage accepts explicit pause and resume', () => {
  const reqId = rc.createRequestId();
  const pause = rc.validateCompanionMessage({ protocolVersion: 3, requestId: reqId, action: 'pause' });
  const resume = rc.validateCompanionMessage({ protocolVersion: 3, requestId: reqId, action: 'resume' });
  assert.equal(pause.ok, true);
  assert.equal(pause.message.action, 'pause');
  assert.equal(resume.ok, true);
  assert.equal(resume.message.action, 'resume');
});

test('validateCompanionMessage accepts getNightModes with optional correlationId', () => {
  const readQuery = rc.validateCompanionMessage({ action: 'getNightModes', correlationId: 'q-9876543210123456' });
  assert.equal(readQuery.ok, true);
  assert.equal(readQuery.message.action, 'getNightModes');
  assert.equal(readQuery.message.correlationId, 'q-9876543210123456');
});

// ─────────────────────────────────────────────────────────────────────────────
// IdempotencyRegistry Core Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

test('1. Original request gets non-terminal accepted before terminal result', () => {
  const reg = new IdempotencyRegistry();
  const token = 'user-token-123';
  const requestId = rc.createRequestId();

  const regResult = reg.register(token, requestId, 'snooze', { seconds: 900 });
  assert.equal(regResult.state, 'new');
  assert.equal(regResult.ack.status, 'accepted');
  assert.equal(regResult.ack.duplicate, false);

  const appliedAck = rc.createCommandAck({ requestId, action: 'snooze', status: 'applied', stateRevision: 5 });
  reg.resolve(token, requestId, appliedAck);

  const stats = reg.getStats();
  assert.equal(stats.inProgress, 0);
  assert.equal(stats.size, 1);
});

test('2. In-progress duplicate gets immediate duplicate accepted', () => {
  const reg = new IdempotencyRegistry();
  const token = 'user-token-123';
  const requestId = rc.createRequestId();

  const first = reg.register(token, requestId, 'snooze', { seconds: 900 });
  assert.equal(first.state, 'new');

  const second = reg.register(token, requestId, 'snooze', { seconds: 900 });
  assert.equal(second.state, 'in_progress_duplicate');
  assert.equal(second.ack.status, 'accepted');
  assert.equal(second.ack.duplicate, true);
});

test('3. All connected waiters receive single terminal result upon completion', async () => {
  const reg = new IdempotencyRegistry();
  const token = 'user-token-123';
  const requestId = rc.createRequestId();

  const first = reg.register(token, requestId, 'snooze', { seconds: 900 });
  const second = reg.register(token, requestId, 'snooze', { seconds: 900 });

  let waiter1Ack = null;
  let waiter2Ack = null;

  reg.addWaiter(first.record, ack => { waiter1Ack = ack; });
  reg.addWaiter(second.record, ack => { waiter2Ack = ack; });

  const terminalAck = rc.createCommandAck({ requestId, action: 'snooze', status: 'applied', stateRevision: 10 });
  reg.resolve(token, requestId, terminalAck);

  assert.notEqual(waiter1Ack, null);
  assert.notEqual(waiter2Ack, null);
  assert.equal(waiter1Ack.status, 'applied');
  assert.equal(waiter1Ack.duplicate, true);
  assert.equal(waiter2Ack.status, 'applied');
  assert.equal(waiter2Ack.duplicate, true);
});

test('4. Disconnected waiter is safely removed without throwing', () => {
  const reg = new IdempotencyRegistry();
  const token = 'user-token-123';
  const requestId = rc.createRequestId();

  const first = reg.register(token, requestId, 'snooze', { seconds: 900 });
  
  let called = false;
  const unregister = reg.addWaiter(first.record, () => { called = true; });

  // Simulate socket disconnect before resolution
  unregister();

  const terminalAck = rc.createCommandAck({ requestId, action: 'snooze', status: 'applied' });
  reg.resolve(token, requestId, terminalAck);

  assert.equal(called, false);
});

test('5. Terminal delivery failure to a waiter does not crash', () => {
  const reg = new IdempotencyRegistry();
  const token = 'user-token-123';
  const requestId = rc.createRequestId();

  const first = reg.register(token, requestId, 'snooze', { seconds: 900 });
  
  reg.addWaiter(first.record, () => {
    throw new Error('Socket closed forcibly');
  });

  const terminalAck = rc.createCommandAck({ requestId, action: 'snooze', status: 'applied' });
  assert.doesNotThrow(() => {
    reg.resolve(token, requestId, terminalAck);
  });
});

test('6. Legacy / unsupported clients receive stable upgrade_required', () => {
  const legacyMsg = { action: 'startNightMode', nightModeId: 'quick-sleep' };
  const res = rc.validateCompanionMessage(legacyMsg);
  assert.equal(res.ok, false);
  assert.equal(res.reason, rc.REJECTION_REASONS.UPGRADE_REQUIRED);
});

test('7. Same ID with conflicting payload returns request_id_conflict', () => {
  const reg = new IdempotencyRegistry();
  const token = 'user-token-123';
  const requestId = rc.createRequestId();

  reg.register(token, requestId, 'snooze', { seconds: 900 });

  const conflict = reg.register(token, requestId, 'snooze', { seconds: 1800 });
  assert.equal(conflict.state, 'conflict');
  assert.equal(conflict.ack.reason, rc.REJECTION_REASONS.REQUEST_ID_CONFLICT);
});

test('8. Capacity limit enforcement returns idempotency_capacity and preserves unexpired records', () => {
  const reg = new IdempotencyRegistry({ maxEntries: 3 });
  const token = 'user-token-123';

  for (let i = 0; i < 3; i++) {
    const id = rc.createRequestId();
    const res = reg.register(token, id, 'pause', {});
    reg.resolve(token, id, rc.createCommandAck({ requestId: id, action: 'pause', status: 'applied' }));
    assert.equal(res.state, 'new');
  }

  // Attempting 4th entry when 3 unexpired entries exist
  const overflowId = rc.createRequestId();
  const overflowRes = reg.register(token, overflowId, 'pause', {});
  assert.equal(overflowRes.state, 'capacity_exceeded');
  assert.equal(overflowRes.ack.reason, rc.REJECTION_REASONS.IDEMPOTENCY_CAPACITY);
  assert.equal(reg.getStats().size, 3);
});

test('9. Protocol field is consistently protocolVersion = 3', () => {
  const ack = rc.createCommandAck({ requestId: rc.createRequestId(), action: 'pause', status: 'applied' });
  assert.equal(ack.protocolVersion, 3);
  assert.equal('v' in ack, false);
});
