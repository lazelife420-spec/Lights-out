// Idempotency registry for mutating companion commands (C3-A).
// Pure, Node core only (no external dependencies).
// Bounds size at 500 entries. Unexpired entries (in_progress or terminal) are NEVER evicted.

'use strict';

const crypto = require('crypto');
const {
  MUTATING_COMPANION_ACTIONS,
  REQUEST_ID_REGEX,
  createCommandAck,
  canonicalStringify,
  REJECTION_REASONS,
  ACK_STATUSES
} = require('./remoteControl');

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

class IdempotencyRegistry {
  constructor(options = {}) {
    this.maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_MAX_ENTRIES;
    this.ttlMs = Number.isInteger(options.ttlMs) && options.ttlMs > 0
      ? options.ttlMs
      : DEFAULT_TTL_MS;
    this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
    // Map<string, IdempotencyRecord>
    // Key: `${tokenHash}:${requestId}`
    this.records = new Map();
  }

  now() {
    return this.clock();
  }

  hashToken(token) {
    if (typeof token !== 'string' || !token) return 'unauthenticated';
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
  }

  hashPayload(canonicalPayload) {
    let json;
    if (canonicalPayload === undefined) {
      json = 'undefined';
    } else {
      const stringified = canonicalStringify(canonicalPayload);
      json = stringified === undefined ? String(typeof canonicalPayload) : stringified;
    }
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  makeKey(token, requestId) {
    return `${this.hashToken(token)}:${requestId}`;
  }

  // Returns { state: 'new' | 'in_progress_duplicate' | 'completed_duplicate' | 'conflict' | 'capacity_exceeded' | 'invalid', ack?, record? }
  register(token, requestId, action, canonicalPayload = {}) {
    if (typeof requestId !== 'string' || !REQUEST_ID_REGEX.test(requestId)) {
      return {
        state: 'invalid',
        ack: null
      };
    }
    if (typeof action !== 'string' || !MUTATING_COMPANION_ACTIONS.includes(action)) {
      return {
        state: 'invalid',
        ack: null
      };
    }

    const key = this.makeKey(token, requestId);
    const currentTime = this.now();
    let existing = this.records.get(key);
    if (existing && existing.status !== 'in_progress' && currentTime >= existing.expiresAt) {
      this.records.delete(key);
      existing = undefined;
    }

    const payloadHash = this.hashPayload(canonicalPayload);

    if (existing) {
      // Check for conflict (same ID, different action or payload hash)
      if (existing.action !== action || existing.payloadHash !== payloadHash) {
        return {
          state: 'conflict',
          ack: createCommandAck({
            requestId,
            action,
            status: ACK_STATUSES.REJECTED,
            duplicate: true,
            reason: REJECTION_REASONS.REQUEST_ID_CONFLICT,
            stateRevision: existing.terminalAck ? existing.terminalAck.stateRevision : null
          })
        };
      }

      // In-progress identical duplicate
      if (existing.status === 'in_progress') {
        const immediateAck = createCommandAck({
          requestId,
          action,
          status: ACK_STATUSES.ACCEPTED,
          duplicate: true
        });
        return {
          state: 'in_progress_duplicate',
          record: existing,
          ack: immediateAck
        };
      }

      // Terminal duplicate (completed or rejected)
      return {
        state: 'completed_duplicate',
        record: existing,
        ack: {
          ...existing.terminalAck,
          duplicate: true
        }
      };
    }

    // New request: purge expired entries before checking capacity.
    this.sweep(currentTime);

    // Capacity bound check: Unexpired records MUST NEVER be evicted.
    if (this.records.size >= this.maxEntries) {
      return {
        state: 'capacity_exceeded',
        ack: createCommandAck({
          requestId,
          action,
          status: ACK_STATUSES.REJECTED,
          reason: REJECTION_REASONS.IDEMPOTENCY_CAPACITY
        })
      };
    }

    // Build ACK before mutating records so validation errors can never leak an orphan record.
    const initialAck = createCommandAck({
      requestId,
      action,
      status: ACK_STATUSES.ACCEPTED,
      duplicate: false
    });

    // Register new in_progress record
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    // Handle unhandled rejection avoidance on execution failure
    promise.catch(() => {});

    const record = {
      key,
      requestId,
      action,
      payloadHash,
      status: 'in_progress',
      createdAt: currentTime,
      expiresAt: currentTime + this.ttlMs,
      promise,
      resolvePromise,
      waiters: new Set(),
      terminalAck: null
    };

    this.records.set(key, record);

    return {
      state: 'new',
      record,
      ack: initialAck
    };
  }

  // Register a waiter callback for an in-progress record.
  // If the record is already terminal, delivers the duplicate terminal ACK immediately without leaking a waiter.
  // Returns an unregister function to safely handle waiter disconnects.
  addWaiter(record, callback) {
    if (!record || typeof callback !== 'function') return () => {};
    if (record.status !== 'in_progress') {
      if (record.terminalAck) {
        try {
          callback({ ...record.terminalAck, duplicate: true });
        } catch {
          // ignore socket write errors on disconnected waiters
        }
      }
      return () => {};
    }
    record.waiters.add(callback);
    return () => {
      if (record && record.waiters) {
        record.waiters.delete(callback);
      }
    };
  }

  // Resolve an in-progress record with its terminal result (completed or rejected).
  resolve(token, requestId, terminalAck) {
    const key = this.makeKey(token, requestId);
    const record = this.records.get(key);
    if (!record || record.status !== 'in_progress') return false;
    if (!terminalAck || (terminalAck.status !== ACK_STATUSES.COMPLETED && terminalAck.status !== ACK_STATUSES.REJECTED)) {
      return false;
    }

    const resultAck = createCommandAck({
      requestId: record.requestId,
      action: record.action,
      status: terminalAck.status,
      duplicate: false,
      reason: terminalAck.status === ACK_STATUSES.REJECTED ? terminalAck.reason : null,
      stateRevision: terminalAck.stateRevision ?? null
    });

    record.status = resultAck.status;
    record.terminalAck = resultAck;
    record.expiresAt = Math.max(record.expiresAt, this.now() + this.ttlMs);

    const duplicateAck = { ...resultAck, duplicate: true };

    // Notify all connected waiters with duplicate terminal ACK
    const currentWaiters = Array.from(record.waiters);
    record.waiters.clear();

    for (const waiter of currentWaiters) {
      try {
        waiter(duplicateAck);
      } catch {
        // ignore socket write errors on disconnected waiters
      }
    }

    if (record.resolvePromise) {
      record.resolvePromise(duplicateAck);
    }

    return true;
  }

  sweep(currentTime = this.now()) {
    for (const [key, record] of this.records.entries()) {
      // Never sweep in_progress or unexpired records
      if (record.status !== 'in_progress' && currentTime >= record.expiresAt) {
        this.records.delete(key);
      }
    }
  }

  clear() {
    this.records.clear();
  }

  getStats() {
    const currentTime = this.now();
    let inProgress = 0;
    let expired = 0;
    for (const record of this.records.values()) {
      if (record.status === 'in_progress') {
        inProgress++;
      } else if (currentTime >= record.expiresAt) {
        expired++;
      }
    }
    return {
      size: this.records.size,
      maxEntries: this.maxEntries,
      inProgress,
      expired
    };
  }
}

module.exports = IdempotencyRegistry;
