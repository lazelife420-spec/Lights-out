// Idempotency registry for mutating companion commands (C3-A).
// Pure, Node core only (no external dependencies).
// Bounds size at 500 entries. Unexpired entries (in_progress or terminal) are NEVER evicted.

const crypto = require('crypto');
const { createCommandAck, REJECTION_REASONS } = require('./remoteControl');

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

class IdempotencyRegistry {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    // Map<string, IdempotencyRecord>
    // Key: `${tokenHash}:${requestId}`
    this.records = new Map();
  }

  hashToken(token) {
    if (typeof token !== 'string' || !token) return 'unauthenticated';
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
  }

  hashPayload(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const norm = { ...payload };
    delete norm.requestId;
    delete norm.protocolVersion;
    return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
  }

  makeKey(token, requestId) {
    return `${this.hashToken(token)}:${requestId}`;
  }

  // Returns { state: 'new' | 'in_progress_duplicate' | 'completed_duplicate' | 'conflict' | 'capacity_exceeded' | 'invalid', ack?, record? }
  register(token, requestId, action, payload = {}) {
    if (!requestId || typeof requestId !== 'string') {
      return {
        state: 'invalid',
        ack: createCommandAck({ requestId, action, status: 'rejected', reason: REJECTION_REASONS.INVALID_REQUEST_ID })
      };
    }

    const key = this.makeKey(token, requestId);
    const existing = this.records.get(key);
    const payloadHash = this.hashPayload(payload);

    if (existing) {
      // Check for conflict (same ID, different action or payload hash)
      if (existing.action !== action || existing.payloadHash !== payloadHash) {
        return {
          state: 'conflict',
          ack: createCommandAck({
            requestId,
            action,
            status: 'rejected',
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
          status: 'accepted',
          duplicate: true
        });
        return {
          state: 'in_progress_duplicate',
          record: existing,
          ack: immediateAck
        };
      }

      // Terminal duplicate (applied or rejected)
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
    this.sweep();

    // Capacity bound check: Unexpired records MUST NEVER be evicted.
    if (this.records.size >= this.maxEntries) {
      return {
        state: 'capacity_exceeded',
        ack: createCommandAck({
          requestId,
          action,
          status: 'rejected',
          reason: REJECTION_REASONS.IDEMPOTENCY_CAPACITY
        })
      };
    }

    // Register new in_progress record
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const record = {
      key,
      requestId,
      action,
      payloadHash,
      status: 'in_progress',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
      promise,
      resolvePromise,
      waiters: new Set(),
      terminalAck: null
    };

    this.records.set(key, record);

    const initialAck = createCommandAck({
      requestId,
      action,
      status: 'accepted',
      duplicate: false
    });

    return {
      state: 'new',
      record,
      ack: initialAck
    };
  }

  // Register a waiter callback for an in-progress record.
  // Returns an unregister function to safely handle waiter disconnects.
  addWaiter(record, callback) {
    if (!record || typeof callback !== 'function') return () => {};
    record.waiters.add(callback);
    return () => {
      if (record && record.waiters) {
        record.waiters.delete(callback);
      }
    };
  }

  // Resolve an in-progress record with its terminal result (applied or rejected).
  resolve(token, requestId, terminalAck) {
    const key = this.makeKey(token, requestId);
    const record = this.records.get(key);
    if (!record || record.status !== 'in_progress') return false;

    const resultAck = {
      ...terminalAck,
      type: 'commandAck',
      protocolVersion: 3,
      requestId: record.requestId,
      action: record.action
    };

    record.status = resultAck.status;
    record.terminalAck = resultAck;

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

  sweep() {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      // Never sweep in_progress or unexpired records
      if (record.status !== 'in_progress' && now > record.expiresAt) {
        this.records.delete(key);
      }
    }
  }

  clear() {
    this.records.clear();
  }

  getStats() {
    const now = Date.now();
    let inProgress = 0;
    let expired = 0;
    for (const record of this.records.values()) {
      if (record.status === 'in_progress') inProgress++;
      if (now > record.expiresAt) expired++;
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
