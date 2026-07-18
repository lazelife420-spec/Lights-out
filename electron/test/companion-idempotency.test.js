// Unit tests for Companion V2 C3-A protocol primitives and idempotency registry.
// Run with: node --test  (or cd electron && npm test)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const rc = require('../remoteControl');
const IdempotencyRegistry = require('../idempotencyRegistry');

// ─────────────────────────────────────────────────────────────────────────────
// C3-A Request ID Generator Tests
// ─────────────────────────────────────────────────────────────────────────────

test('createRequestId returns a valid 36-char lowercase UUID string', () => {
  const id1 = rc.createRequestId();
  const id2 = rc.createRequestId();
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(id1, id2);
});

test('createRequestId supports injectable cryptoSource and fallback paths', () => {
  // Test getRandomValues fallback path
  const fakeCrypto = {
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = i * 17;
      return arr;
    }
  };
  const id = rc.createRequestId(fakeCrypto);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('createRequestId throws explicit error when no secure crypto source exists', () => {
  assert.throws(() => {
    rc.createRequestId({});
  }, /No secure crypto source available/);
});

// ─────────────────────────────────────────────────────────────────────────────
// ACK DTO Schema & Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

test('createCommandAck constructs a valid targeted commandAck DTO', () => {
  const reqId = rc.createRequestId();
  const ack = rc.createCommandAck({
    requestId: reqId,
    action: 'snooze',
    status: rc.ACK_STATUSES.ACCEPTED,
    duplicate: false,
    reason: null,
    stateRevision: 42
  });

  assert.deepEqual(ack, {
    type: 'commandAck',
    protocolVersion: 3,
    requestId: reqId,
    action: 'snooze',
    status: 'accepted',
    duplicate: false,
    reason: null,
    stateRevision: 42
  });
});

test('createCommandAck throws on invalid inputs', () => {
  const reqId = rc.createRequestId();

  // Invalid requestId
  assert.throws(() => rc.createCommandAck({ requestId: 'short', action: 'cancel', status: 'accepted' }), TypeError);

  // Invalid action
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'nuke', status: 'accepted' }), TypeError);

  // Invalid status
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'pending' }), TypeError);

  // Rejected status missing valid reason
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'rejected', reason: null }), TypeError);

  // Accepted status carrying arbitrary non-null reason
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'accepted', reason: 'some error' }), TypeError);

  // Negative stateRevision
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'accepted', stateRevision: -1 }), TypeError);
});

// ─────────────────────────────────────────────────────────────────────────────
// Canonicalization & Payload Hash Tests
// ─────────────────────────────────────────────────────────────────────────────

test('canonicalization handles key order equivalence', () => {
  const p1 = { action: 'snooze', seconds: 300 };
  const p2 = { seconds: 300, action: 'snooze' };

  assert.equal(rc.canonicalStringify(p1), rc.canonicalStringify(p2));
});

test('forged extra fields sanitize to identical canonical operation', () => {
  const raw1 = { protocolVersion: 3, requestId: rc.createRequestId(), action: 'snooze', seconds: 300 };
  const raw2 = { protocolVersion: 3, requestId: rc.createRequestId(), action: 'snooze', seconds: 300, forceShutdown: true, profileId: 'forged' };

  const v1 = rc.validateCompanionV3Message(raw1);
  const v2 = rc.validateCompanionV3Message(raw2);

  assert.deepEqual(v1.canonicalPayload, v2.canonicalPayload);
  assert.equal(rc.canonicalStringify(v1.canonicalPayload), rc.canonicalStringify(v2.canonicalPayload));
});

// ─────────────────────────────────────────────────────────────────────────────
// IdempotencyRegistry Concurrency, Lifecycle & Capacity Tests
// ─────────────────────────────────────────────────────────────────────────────

test('1. Existing identical duplicate resolves from record even when capacity is full', () => {
  const reg = new IdempotencyRegistry({ maxEntries: 2 });
  const token = 'token-1';
  const req1 = rc.createRequestId();
  const req2 = rc.createRequestId();

  reg.register(token, req1, 'pause', { action: 'pause' });
  reg.register(token, req2, 'pause', { action: 'pause' });
  assert.equal(reg.getStats().size, 2);

  // Duplicate for req1 while at capacity
  const dup = reg.register(token, req1, 'pause', { action: 'pause' });
  assert.equal(dup.state, 'in_progress_duplicate');
});

test('2. Existing conflicting duplicate returns request_id_conflict at capacity', () => {
  const reg = new IdempotencyRegistry({ maxEntries: 2 });
  const token = 'token-1';
  const req1 = rc.createRequestId();
  const req2 = rc.createRequestId();

  reg.register(token, req1, 'snooze', { action: 'snooze', seconds: 300 });
  reg.register(token, req2, 'pause', { action: 'pause' });

  // Conflicting payload for req1 at capacity
  const conflict = reg.register(token, req1, 'snooze', { action: 'snooze', seconds: 900 });
  assert.equal(conflict.state, 'conflict');
  assert.equal(conflict.ack.reason, rc.REJECTION_REASONS.REQUEST_ID_CONFLICT);
});

test('3. Only a genuinely new request receives idempotency_capacity', () => {
  const reg = new IdempotencyRegistry({ maxEntries: 1 });
  const token = 'token-1';
  const req1 = rc.createRequestId();
  const req2 = rc.createRequestId();

  reg.register(token, req1, 'pause', { action: 'pause' });

  const overflow = reg.register(token, req2, 'pause', { action: 'pause' });
  assert.equal(overflow.state, 'capacity_exceeded');
  assert.equal(overflow.ack.reason, rc.REJECTION_REASONS.IDEMPOTENCY_CAPACITY);
});

test('4. Expired entries are removed using an injected clock', () => {
  let mockNow = 1000;
  const reg = new IdempotencyRegistry({ ttlMs: 500, clock: () => mockNow });
  const token = 'token-1';
  const req1 = rc.createRequestId();

  reg.register(token, req1, 'pause', { action: 'pause' });
  reg.resolve(token, req1, rc.createCommandAck({ requestId: req1, action: 'pause', status: rc.ACK_STATUSES.COMPLETED }));

  assert.equal(reg.getStats().size, 1);

  // Advance time past TTL
  mockNow = 2000;
  reg.sweep();
  assert.equal(reg.getStats().size, 0);
});

test('5. In-progress entries never expire while execution is unresolved', () => {
  let mockNow = 1000;
  const reg = new IdempotencyRegistry({ ttlMs: 500, clock: () => mockNow });
  const token = 'token-1';
  const req1 = rc.createRequestId();

  reg.register(token, req1, 'pause', { action: 'pause' });
  
  // Advance time past TTL while in_progress
  mockNow = 2000;
  reg.sweep();
  assert.equal(reg.getStats().size, 1);
  assert.equal(reg.getStats().inProgress, 1);
});

test('6. Terminal execution rejection is stored and replayed consistently', () => {
  const reg = new IdempotencyRegistry();
  const token = 'token-1';
  const req1 = rc.createRequestId();

  reg.register(token, req1, 'snooze', { action: 'snooze', seconds: 300 });

  const rejectedAck = rc.createCommandAck({
    requestId: req1,
    action: 'snooze',
    status: rc.ACK_STATUSES.REJECTED,
    reason: rc.REJECTION_REASONS.NOT_IDLE
  });

  reg.resolve(token, req1, rejectedAck);

  const dup = reg.register(token, req1, 'snooze', { action: 'snooze', seconds: 300 });
  assert.equal(dup.state, 'completed_duplicate');
  assert.equal(dup.ack.status, 'rejected');
  assert.equal(dup.ack.reason, rc.REJECTION_REASONS.NOT_IDLE);
  assert.equal(dup.ack.duplicate, true);
});

test('7. Waiter cleanup does not delete the underlying execution record', () => {
  const reg = new IdempotencyRegistry();
  const token = 'token-1';
  const req1 = rc.createRequestId();

  const first = reg.register(token, req1, 'pause', { action: 'pause' });
  const unregister = reg.addWaiter(first.record, () => {});

  unregister();

  assert.equal(reg.getStats().size, 1);
  assert.equal(first.record.waiters.size, 0);
});

test('8. Socket write failure on one waiter callback does not block remaining waiters', () => {
  const reg = new IdempotencyRegistry();
  const token = 'token-1';
  const req1 = rc.createRequestId();

  const first = reg.register(token, req1, 'pause', { action: 'pause' });

  let waiter2Received = false;

  reg.addWaiter(first.record, () => {
    throw new Error('Socket write failed');
  });

  reg.addWaiter(first.record, () => {
    waiter2Received = true;
  });

  const termAck = rc.createCommandAck({ requestId: req1, action: 'pause', status: rc.ACK_STATUSES.COMPLETED });
  reg.resolve(token, req1, termAck);

  assert.equal(waiter2Received, true);
});
