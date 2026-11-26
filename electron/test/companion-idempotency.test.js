// Unit tests for Companion V2 C3-A protocol primitives and idempotency registry.
// Run with: node --test  (or cd electron && npm test)

'use strict';

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
  assert.throws(() => {
    rc.createRequestId(null);
  }, /No secure crypto source available/);
  assert.throws(() => {
    rc.createRequestId({ randomUUID: 'not-a-function', getRandomValues: 123 });
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

  // Negative or non-number stateRevision (must reject booleans, strings, floats, NaN)
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'accepted', stateRevision: -1 }), TypeError);
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'accepted', stateRevision: 1.5 }), TypeError);
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'accepted', stateRevision: '' }), TypeError);
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'accepted', stateRevision: false }), TypeError);
  assert.throws(() => rc.createCommandAck({ requestId: reqId, action: 'cancel', status: 'accepted', stateRevision: '42' }), TypeError);
});

// ─────────────────────────────────────────────────────────────────────────────
// Canonicalization & Payload Hash Tests
// ─────────────────────────────────────────────────────────────────────────────

test('canonicalization handles key order equivalence', () => {
  const p1 = { action: 'snooze', seconds: 300 };
  const p2 = { seconds: 300, action: 'snooze' };

  assert.equal(rc.canonicalStringify(p1), rc.canonicalStringify(p2));
});

test('canonicalize rejects cyclic objects cleanly', () => {
  const cyclic = { action: 'snooze' };
  cyclic.self = cyclic;
  assert.throws(() => rc.canonicalize(cyclic), TypeError);
});

test('canonicalize preserves own __proto__ property without mutating prototype or colliding', () => {
  const withProto = JSON.parse('{"__proto__":{"a":1},"action":"snooze"}');
  const withoutProto = { action: 'snooze' };
  const canon = rc.canonicalize(withProto);

  assert.equal(Object.getPrototypeOf(canon), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(canon, '__proto__'), true);
  assert.notEqual(rc.canonicalStringify(withProto), rc.canonicalStringify(withoutProto));
  assert.equal(rc.canonicalStringify(withProto), '{"__proto__":{"a":1},"action":"snooze"}');
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
  assert.equal(dup.ack.status, rc.ACK_STATUSES.ACCEPTED);
  assert.equal(dup.ack.duplicate, true);
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

test('8. Socket write failure on one waiter callback does not block remaining waiters', async () => {
  const reg = new IdempotencyRegistry();
  const token = 'token-1';
  const req1 = rc.createRequestId();

  const first = reg.register(token, req1, 'pause', { action: 'pause' });

  let waiter2Ack = null;

  reg.addWaiter(first.record, () => {
    throw new Error('Socket write failed');
  });

  reg.addWaiter(first.record, (ack) => {
    waiter2Ack = ack;
  });

  const termAck = rc.createCommandAck({ requestId: req1, action: 'pause', status: rc.ACK_STATUSES.COMPLETED, stateRevision: 7 });
  assert.equal(reg.resolve(token, req1, termAck), true);

  assert.equal(waiter2Ack?.status, rc.ACK_STATUSES.COMPLETED);
  assert.equal(waiter2Ack?.duplicate, true);
  assert.equal(waiter2Ack?.stateRevision, 7);

  const promisedAck = await first.record.promise;
  assert.equal(promisedAck.status, rc.ACK_STATUSES.COMPLETED);
  assert.equal(promisedAck.duplicate, true);
});

test('9. Invalid requestId or action returns invalid without leaking an orphan record', () => {
  const reg = new IdempotencyRegistry();
  const token = 'token-1';

  assert.deepEqual(reg.register(token, 'short', 'pause', { action: 'pause' }), { state: 'invalid', ack: null });
  assert.deepEqual(reg.register(token, null, 'pause', { action: 'pause' }), { state: 'invalid', ack: null });
  assert.deepEqual(reg.register(token, rc.createRequestId(), 'nuke', { action: 'nuke' }), { state: 'invalid', ack: null });
  assert.equal(reg.getStats().size, 0);
});

test('10. Expired completed record is evicted on direct re-registration even without explicit sweep', () => {
  let mockNow = 1000;
  const reg = new IdempotencyRegistry({ ttlMs: 500, clock: () => mockNow });
  const token = 'token-1';
  const req1 = rc.createRequestId();

  reg.register(token, req1, 'pause', { action: 'pause' });
  reg.resolve(token, req1, rc.createCommandAck({ requestId: req1, action: 'pause', status: rc.ACK_STATUSES.COMPLETED }));

  mockNow = 2000;
  const reRegistered = reg.register(token, req1, 'pause', { action: 'pause' });
  assert.equal(reRegistered.state, 'new');
  assert.equal(reRegistered.ack.duplicate, false);
});

test('11. Records are isolated across distinct pairing tokens', () => {
  const reg = new IdempotencyRegistry();
  const req1 = rc.createRequestId();

  const first = reg.register('token-alpha', req1, 'pause', { action: 'pause' });
  const second = reg.register('token-beta', req1, 'pause', { action: 'pause' });

  assert.equal(first.state, 'new');
  assert.equal(second.state, 'new');
  assert.equal(reg.getStats().size, 2);
});

test('12. Read-only getNightModes is rejected by mutating IdempotencyRegistry', () => {
  const reg = new IdempotencyRegistry();
  const req1 = rc.createRequestId();

  assert.deepEqual(reg.register('token-1', req1, 'getNightModes', { action: 'getNightModes' }), { state: 'invalid', ack: null });
  assert.equal(reg.getStats().size, 0);
});

test('13. In-progress records are never reported as expired in getStats, while terminal records expire at exact TTL boundary', () => {
  let mockNow = 1000;
  const reg = new IdempotencyRegistry({ ttlMs: 500, clock: () => mockNow });
  const reqInProg = rc.createRequestId();
  const reqDone = rc.createRequestId();

  reg.register('token-1', reqInProg, 'pause', { action: 'pause' });
  reg.register('token-1', reqDone, 'cancel', { action: 'cancel' });
  reg.resolve('token-1', reqDone, rc.createCommandAck({ requestId: reqDone, action: 'cancel', status: rc.ACK_STATUSES.COMPLETED }));

  // Exact TTL boundary: created/resolved at 1000 with ttlMs 500 -> expires at 1500
  mockNow = 1500;
  assert.deepEqual(reg.getStats(), { size: 2, maxEntries: 500, inProgress: 1, expired: 1 });

  reg.sweep();
  assert.deepEqual(reg.getStats(), { size: 1, maxEntries: 500, inProgress: 1, expired: 0 });
});

test('14. addWaiter on an already-resolved record delivers terminal duplicate ACK immediately without leaking waiters', () => {
  const reg = new IdempotencyRegistry();
  const req1 = rc.createRequestId();

  const first = reg.register('token-1', req1, 'pause', { action: 'pause' });
  reg.resolve('token-1', req1, {
    status: rc.ACK_STATUSES.COMPLETED,
    duplicate: true,
    stateRevision: 9
  });

  // Stored authoritative primary ACK keeps duplicate: false
  assert.equal(first.record.terminalAck.duplicate, false);

  let received = null;
  const unreg = reg.addWaiter(first.record, (ack) => { received = ack; });
  assert.equal(typeof unreg, 'function');
  assert.equal(first.record.waiters.size, 0);
  assert.equal(received?.status, rc.ACK_STATUSES.COMPLETED);
  assert.equal(received?.duplicate, true);
  assert.equal(received?.stateRevision, 9);
});

test('15. Distinct non-object payloads hash differently and trigger conflict instead of colliding', () => {
  const reg = new IdempotencyRegistry();
  const req1 = rc.createRequestId();

  const first = reg.register('token-1', req1, 'snooze', null);
  assert.equal(first.state, 'new');
  const second = reg.register('token-1', req1, 'snooze', 12345);
  assert.equal(second.state, 'conflict');
  assert.equal(second.ack.reason, rc.REJECTION_REASONS.REQUEST_ID_CONFLICT);
});

// ─────────────────────────────────────────────────────────────────────────────
// C3-B Live Companion Server Wiring Tests (companion.js + IdempotencyRegistry)
// ─────────────────────────────────────────────────────────────────────────────

const companion = require('../companion');

function makeMaskedTextFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = body.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  }
  header[0] = 0x81;
  const mask = Buffer.from([0x1a, 0x2b, 0x3c, 0x4d]);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = body[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function decodeServerJsonFrames(writes) {
  const decoded = [];
  for (const buf of writes) {
    const opcode = buf[0] & 0x0f;
    if (opcode !== 0x1) continue;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      len = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    decoded.push(JSON.parse(buf.slice(offset, offset + len).toString('utf8')));
  }
  return decoded;
}

function makeFakeClient(token = 'c3b-test-token') {
  const writes = [];
  const client = {
    alive: true,
    buf: Buffer.alloc(0),
    token,
    waiterCleanups: new Set(),
    socket: {
      write: (b) => { writes.push(Buffer.from(b)); return true; },
      end: () => {},
      destroy: () => {}
    }
  };
  return { client, writes };
}

test('C3-B: live V3 dispatch sends accepted + completed ACKs, coalesces in-flight duplicates, and replays completed duplicates', () => {
  companion.resetIdempotencyRegistry({ maxEntries: 10 });
  companion.setStateRevision(10);

  const dispatches = [];
  const handler = (msg, client, v3Context) => {
    dispatches.push({ msg, client, v3Context });
  };
  companion.onMessage(handler);
  try {
    const reqId = rc.createRequestId();
    const { client: c1, writes: w1 } = makeFakeClient('tok-live-1');
    const { client: c2, writes: w2 } = makeFakeClient('tok-live-1');

    // First request -> accepted + dispatched
    c1.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: reqId, action: 'pause' });
    companion.consumeFrames(c1);
    assert.equal(dispatches.length, 1);
    assert.deepEqual(dispatches[0].msg, { protocolVersion: 3, requestId: reqId, action: 'pause' });
    const c1Initial = decodeServerJsonFrames(w1);
    assert.equal(c1Initial.length, 1);
    assert.equal(c1Initial[0].type, 'commandAck');
    assert.equal(c1Initial[0].status, 'accepted');
    assert.equal(c1Initial[0].duplicate, false);
    assert.equal(c1Initial[0].stateRevision, 10);

    // Second identical request while in-flight -> coalesced, not re-dispatched
    c2.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: reqId, action: 'pause' });
    companion.consumeFrames(c2);
    assert.equal(dispatches.length, 1, 'in-flight duplicate must not re-dispatch');
    const c2Initial = decodeServerJsonFrames(w2);
    assert.equal(c2Initial.length, 1);
    assert.equal(c2Initial[0].status, 'accepted');
    assert.equal(c2Initial[0].duplicate, true);

    // Resolve original -> primary receives duplicate:false, waiter receives duplicate:true
    dispatches[0].v3Context.resolve({ status: rc.ACK_STATUSES.COMPLETED, stateRevision: 11 });
    const c1All = decodeServerJsonFrames(w1);
    const c2All = decodeServerJsonFrames(w2);
    assert.equal(c1All.length, 2);
    assert.equal(c1All[1].status, 'completed');
    assert.equal(c1All[1].duplicate, false);
    assert.equal(c1All[1].stateRevision, 11);
    assert.equal(c2All.length, 2);
    assert.equal(c2All[1].status, 'completed');
    assert.equal(c2All[1].duplicate, true);
    assert.equal(c2All[1].stateRevision, 11);

    // Third identical request after completion -> immediate replay, never re-dispatched
    const { client: c3, writes: w3 } = makeFakeClient('tok-live-1');
    c3.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: reqId, action: 'pause' });
    companion.consumeFrames(c3);
    assert.equal(dispatches.length, 1, 'completed duplicate must not re-dispatch');
    const c3All = decodeServerJsonFrames(w3);
    assert.equal(c3All.length, 1);
    assert.equal(c3All[0].status, 'completed');
    assert.equal(c3All[0].duplicate, true);
    assert.equal(c3All[0].stateRevision, 11);
  } finally {
    companion.offMessage(handler);
    companion.resetIdempotencyRegistry();
  }
});

test('C3-B: live V3 dispatch rejects conflicts, capacity overflow, invalid protocol/requestId, and forbidden power actions', () => {
  companion.resetIdempotencyRegistry({ maxEntries: 1 });
  const dispatches = [];
  const handler = (msg, _client, v3Context) => dispatches.push({ msg, v3Context });
  companion.onMessage(handler);
  try {
    const req1 = rc.createRequestId();
    const req2 = rc.createRequestId();
    const { client, writes } = makeFakeClient('tok-cap');

    // Fill capacity with 1 in-progress snooze
    client.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: req1, action: 'snooze', seconds: 300 });
    companion.consumeFrames(client);
    assert.equal(dispatches.length, 1);

    // Same requestId with different payload -> request_id_conflict
    client.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: req1, action: 'snooze', seconds: 900 });
    companion.consumeFrames(client);
    assert.equal(dispatches.length, 1);

    // Distinct new requestId at capacity -> idempotency_capacity
    client.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: req2, action: 'resume' });
    companion.consumeFrames(client);
    assert.equal(dispatches.length, 1);

    // Invalid protocolVersion & forbidden actions -> rejected ACKs, zero dispatch
    client.buf = makeMaskedTextFrame({ protocolVersion: 4, requestId: rc.createRequestId(), action: 'cancel' });
    companion.consumeFrames(client);
    client.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: 'bad', action: 'cancel' });
    companion.consumeFrames(client);
    client.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: rc.createRequestId(), action: 'start', timerAction: 'hibernate', durationSeconds: 600 });
    companion.consumeFrames(client);
    assert.equal(dispatches.length, 1);

    const acks = decodeServerJsonFrames(writes);
    assert.equal(acks[0].status, 'accepted');
    assert.equal(acks[1].status, 'rejected');
    assert.equal(acks[1].reason, rc.REJECTION_REASONS.REQUEST_ID_CONFLICT);
    assert.equal(acks[2].status, 'rejected');
    assert.equal(acks[2].reason, rc.REJECTION_REASONS.IDEMPOTENCY_CAPACITY);
    assert.equal(acks[3].status, 'rejected');
    assert.equal(acks[3].reason, rc.REJECTION_REASONS.UNSUPPORTED_PROTOCOL_VERSION);
    assert.equal(acks[4].status, 'rejected');
    assert.equal(acks[4].reason, rc.REJECTION_REASONS.INVALID_REQUEST_ID);
    assert.equal(acks[5].status, 'rejected');
    assert.equal(acks[5].reason, rc.REJECTION_REASONS.INVALID_PAYLOAD);

    // Read-only getNightModes passes through even at full mutating capacity and does not enter registry
    client.buf = makeMaskedTextFrame({ protocolVersion: 3, action: 'getNightModes', correlationId: 'corr-1' });
    companion.consumeFrames(client);
    assert.equal(dispatches.length, 2);
    assert.deepEqual(dispatches[1].msg, { action: 'getNightModes', correlationId: 'corr-1' });
    assert.equal(companion.getIdempotencyRegistry().getStats().size, 1);
  } finally {
    companion.offMessage(handler);
    companion.resetIdempotencyRegistry();
  }
});

test('C3-B: zero listeners or throwing listener settles V3 record as internal_error instead of wedging in_progress', () => {
  companion.resetIdempotencyRegistry();
  try {
    // Case 1: no message listener registered
    const { client: c1, writes: w1 } = makeFakeClient('tok-nolistener');
    const req1 = rc.createRequestId();
    c1.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: req1, action: 'pause' });
    companion.consumeFrames(c1);
    const acks1 = decodeServerJsonFrames(w1);
    assert.equal(acks1.length, 2);
    assert.equal(acks1[0].status, 'accepted');
    assert.equal(acks1[1].status, 'rejected');
    assert.equal(acks1[1].reason, rc.REJECTION_REASONS.INTERNAL_ERROR);
    assert.equal(companion.getIdempotencyRegistry().getStats().inProgress, 0);

    // Case 2: synchronous throw in listener before settling
    const throwingHandler = () => { throw new Error('boom'); };
    companion.onMessage(throwingHandler);
    try {
      const { client: c2, writes: w2 } = makeFakeClient('tok-throw');
      const req2 = rc.createRequestId();
      c2.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: req2, action: 'resume' });
      companion.consumeFrames(c2);
      const acks2 = decodeServerJsonFrames(w2);
      assert.equal(acks2.length, 2);
      assert.equal(acks2[0].status, 'accepted');
      assert.equal(acks2[1].status, 'rejected');
      assert.equal(acks2[1].reason, rc.REJECTION_REASONS.INTERNAL_ERROR);
      assert.equal(companion.getIdempotencyRegistry().getStats().inProgress, 0);
    } finally {
      companion.offMessage(throwingHandler);
    }
  } finally {
    companion.resetIdempotencyRegistry();
  }
});

test('C3-B: sendToClient write error cleans up duplicate client waiters', () => {
  companion.resetIdempotencyRegistry();
  let capturedCtx = null;
  const handler = (_msg, _client, v3Context) => { capturedCtx = v3Context; };
  companion.onMessage(handler);
  try {
    const reqId = rc.createRequestId();
    const { client: c1 } = makeFakeClient('tok-drop');
    c1.buf = makeMaskedTextFrame({ protocolVersion: 3, requestId: reqId, action: 'pause' });
    companion.consumeFrames(c1);

    // Second client joins as in-progress waiter, then its socket throws on next write
    let writeCount = 0;
    const flakyClient = {
      alive: true,
      buf: makeMaskedTextFrame({ protocolVersion: 3, requestId: reqId, action: 'pause' }),
      token: 'tok-drop',
      waiterCleanups: new Set(),
      socket: {
        write() {
          writeCount++;
          if (writeCount > 1) throw new Error('EPIPE');
        },
        end() {},
        destroy() {}
      }
    };
    companion.consumeFrames(flakyClient);
    assert.equal(flakyClient.waiterCleanups.size, 1);

    // Triggering a failed write on flakyClient must clean up its waiter before resolution
    assert.equal(companion.sendToClient(flakyClient, { type: 'state' }), false);
    assert.equal(flakyClient.alive, false);
    assert.equal(flakyClient.waiterCleanups.size, 0);

    // Resolving primary request must not crash and must settle cleanly
    assert.equal(capturedCtx.resolve({ status: rc.ACK_STATUSES.COMPLETED, stateRevision: 20 }), true);
    assert.equal(companion.getIdempotencyRegistry().getStats().inProgress, 0);
  } finally {
    companion.offMessage(handler);
    companion.resetIdempotencyRegistry();
  }
});
