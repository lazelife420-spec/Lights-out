# Companion V2 C3 — Request IDs, Authoritative Acknowledgements, and Idempotency Audit & Plan

**Repository:** `Lights-out`
**Status:** Architecture Audit & Specification Document (C3-A Additive Primitives + C3-B Live Protocol V3 Wiring Landed & Verified)

---

## 1. Scope & Purpose

This document provides the architecture specification for **Companion V2 C3 (Request IDs, Authoritative Acknowledgements, and Idempotency)**.

The primary objective of C3 is to elevate companion remote control from indirect state-polling locks to **authoritative server-side deduplication and targeted command acknowledgements**.

C3 is staged cleanly into:
- **C3-A (Additive Primitives):** `electron/idempotencyRegistry.js`, `validateCompanionV3Message()`, `createRequestId()`, `createCommandAck()`, `canonicalize()`/`canonicalStringify()`, `REJECTION_REASONS`, `ACK_STATUSES`, dormant opt-in `pause`/`resume`, and unit + runtime coverage — with zero disruption to shipping unversioned companion clients.
- **C3-B (Server/Client Cutover):** Wiring Protocol V3 dispatch, authoritative `commandAck` correlation, and explicit `pause`/`resume` handlers into `companion.js`, `main.js`, and `companion.html`.

---

## 2. Request-ID Contract & Protocol Versioning

### Protocol Field Specification
- Protocol version field name: `protocolVersion` (MUST be used consistently; never use `v`).
- Protocol version value: `3`.

### Example Mutating Command (Protocol V3)
```json
{
  "protocolVersion": 3,
  "action": "snooze",
  "requestId": "9b1deb4d-3b7d-414d-9076-24a919379899",
  "seconds": 900
}
```

### Request-ID Constraints & Sanitization
- **Allowed Character Set:** Alphanumeric characters `[a-zA-Z0-9]`, hyphen `-`, and underscore `_`.
- **Length Bounds:** Minimum 16 characters, maximum 64 characters.
- **Format Validation Regex:** `/^[a-zA-Z0-9_-]{16,64}$/`
- **Generator:** `remoteControl.createRequestId()` uses `crypto.randomUUID()` when available, RFC 4122 v4 via `crypto.getRandomValues()` or Node `crypto.randomBytes()` fallback, and never uses `Math.random()`.
- **Malformed Handling:** Any mutating command with a missing, non-string, or invalid `requestId` is rejected with `reason: 'invalid_request_id'`.

### Query Correlation IDs vs. Mutating Request IDs
- **Mutating Commands:** Require `protocolVersion: 3` and `requestId`.
- **Read-Only Queries:** `getNightModes` uses an optional `correlationId` field (1–64 chars). Read query correlation IDs are NOT stored in the mutating idempotency registry.

---

## 3. Acknowledgement Semantics & Lifecycle

### Targeted `commandAck` DTO Structure
```json
{
  "type": "commandAck",
  "protocolVersion": 3,
  "requestId": "9b1deb4d-3b7d-414d-9076-24a919379899",
  "action": "snooze",
  "status": "accepted",
  "duplicate": false,
  "reason": null,
  "stateRevision": 42
}
```

### ACK Status Lifecycle
- `accepted`: Non-terminal status. Schema validated and `requestId` reserved.
- `completed`: Terminal status. Authoritative desktop state transition completed.
- `rejected`: Terminal status. Execution blocked by validation, policy, conflict, capacity, or main-process guard; always carries a stable `REJECTION_REASONS` code.

### Duplicate Handling Matrix
- **New Request:** Registers `in_progress` record, returns `{ status: 'accepted', duplicate: false }`.
- **In-Progress Identical Duplicate:** Returns `{ status: 'accepted', duplicate: true }` and attaches waiter to original execution promise.
- **Completed Identical Duplicate:** Replays stored terminal ACK with `duplicate: true`; never re-executes.
- **Conflicting Duplicate:** Same `requestId` with different `action` or canonical payload hash returns `{ status: 'rejected', duplicate: true, reason: 'request_id_conflict' }`; original record remains untouched.

---

## 4. Server-Side Idempotency Registry Bounds

- **Capacity Bound:** 500 entries default (`DEFAULT_MAX_ENTRIES = 500`).
- **Eviction Rule:** Unexpired records (whether `in_progress` or terminal) **MUST NEVER be evicted** by capacity limits.
- **Capacity Exceeded Behavior:** After sweeping expired terminal entries, if registry is still at capacity, new distinct requests are rejected with `reason: 'idempotency_capacity'`. Existing duplicates and conflicts still resolve against their stored records even at full capacity.
- **TTL:** 10 minutes (`600,000 ms`). In-progress records never expire while unresolved.
