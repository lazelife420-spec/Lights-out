# Companion V2 C3 — Request IDs, Authoritative Acknowledgements, and Idempotency Audit & Plan

**Repository:** `C:\Users\KickA\Desktop\Lights Out`  
**Base Head:** `ffff1302e6df46fd32f33013405737765b334c85` (Locked PR #32 C2)  
**Branch:** `audit/companion-v2-c3-request-acks`  
**Status:** Architecture Audit & Specification Document (Final Contract Correction)

---

## 1. Scope & Purpose

This document provides the final, corrected architecture specification for **Companion V2 C3 (Request IDs, Authoritative Acknowledgements, and Idempotency)**.

The primary objective of C3 is to elevate companion remote control from indirect state-polling locks to **authoritative server-side deduplication and targeted command acknowledgements**.

---

## 2. Current Command Path Audit

### End-to-End Command Trace

Every companion interaction follows this workflow:

```text
User Physical Gesture (Tap / Key)
  │
  ▼
companion.html UI Handler (validates local stateIsAuthoritative())
  │
  ▼
ws.send(JSON.stringify({ protocolVersion: 3, action: ... }))  [Client WebSocket]
  │
  ▼
TCP Transport (LAN Wi-Fi)
  │
  ▼
companion.js consumeFrames()  [RFC 6455 Frame Reader & Unmasking]
  │
  ▼
remoteControl.validateCompanionMessage()  [Action & Range Sanitization]
  │
  ▼
idempotencyRegistry.process()  [Request ID Claim & Duplicate Check]
  │
  ▼
companion.js EventEmitter ('message' event)
  │
  ▼
main.js handleCompanionMessage()  [Main Process Handler & Execution]
  │
  ▼
startTimer() / pauseTimer() / resumeTimer() / cancelTimer()  [State Mutation]
  │
  ▼
companion.sendToClient(client, commandAck)  [Targeted ACK (accepted -> applied/rejected)]
  │
  ▼
broadcastCompanionState()  [Desktop State Broadcast (type: 'state')]
```

### Supported Companion Messages & Classification

| Action / Message | Category | Description / Parameters | Desktop Effect |
| :--- | :--- | :--- | :--- |
| `getNightModes` | Read-Only Query | `{ action: 'getNightModes', correlationId }` | Returns `type: 'nightModes'` with catalogue and `correlationId`. |
| `start` | Mutating Command | `{ protocolVersion: 3, action: 'start', requestId, durationSeconds, timerAction }` | Starts timer with specified duration and action. |
| `startNightMode` | Mutating Command | `{ protocolVersion: 3, action: 'startNightMode', requestId, nightModeId }` | Resolves canonical mode in main process and starts timer. |
| `pause` | Mutating Command | `{ protocolVersion: 3, action: 'pause', requestId }` | Explicitly pauses active timer (idempotent). |
| `resume` | Mutating Command | `{ protocolVersion: 3, action: 'resume', requestId }` | Explicitly resumes paused timer (idempotent). |
| `snooze` | Mutating Command | `{ protocolVersion: 3, action: 'snooze', requestId, seconds }` | Adds seconds to active timer. |
| `cancel` | Mutating Command | `{ protocolVersion: 3, action: 'cancel', requestId }` | Stops active timer/ritual back to IDLE. |
| `type: 'state'` | Server-to-Client | Broadcast from main process | Delivers full companion projection update. |
| `type: 'nightModes'` | Server-to-Client | Targeted response from main process | Delivers Night Mode catalogue array with `correlationId`. |
| Local UI Toggles | Local UI-Only | Accordion, modal open/close, action segment | Updates DOM view state without WS transmission. |

---

## 3. Request-ID Contract & Protocol Versioning

### Protocol Field Specification
- Protocol version field name: `protocolVersion` (MUST be used consistently; never use `v`).
- Protocol version value: `3`.

### Example Mutating Command (Protocol V3):
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
- **Validation Function:** Integrated directly into `remoteControl.validateCompanionMessage()`.
- **Malformed Handling:** Any mutating command with a missing, non-string, or invalid `requestId` is rejected with `reason: 'invalid_request_id'`.

### Secure Fallback Generator Function
```javascript
function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 Variant 10xx
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
```
*Note: `Math.random()` MUST NEVER be used.*

### Query Correlation IDs vs. Mutating Request IDs
- **Mutating Commands:** Require `requestId`.
- **Read-Only Queries:** `getNightModes` uses an optional `correlationId` field (e.g. `{ action: 'getNightModes', correlationId: 'q-98765' }`). The server echoes `correlationId` in `type: 'nightModes'`. Read query correlation IDs are NOT stored in the mutating idempotency registry.

---

## 4. Acknowledgement Semantics & Lifecycle

### Targeted `commandAck` DTO Structure

The server sends targeted `commandAck` frames directly to the client socket:

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

The `status` field has three explicit values:
- `accepted`: Non-terminal status. Authentication passed, schema validated, `requestId` claimed, and command entered authoritative execution processing.
- `applied`: Terminal status. Authoritative desktop state transition occurred.
- `rejected`: Terminal status. Execution blocked by policy, validation, or main process guard. Contains stable `reason`.

### Duplicate Handling Matrix

| Scenario | Received Frame | Immediate Response | Subsequent / Secondary Action |
| :--- | :--- | :--- | :--- |
| **New Request** | `{ protocolVersion: 3, action: 'snooze', requestId: 'req-1', seconds: 900 }` | `{ status: 'accepted', duplicate: false }` | Command executes. On completion, returns `{ status: 'applied', duplicate: false }` to socket. |
| **In-Progress Identical Duplicate** | Duplicate `req-1` with same payload while original is still processing | `{ status: 'accepted', duplicate: true }` | Client registered as waiter for original execution promise. When original completes, waiter receives stored terminal result (`applied` or `rejected`) with `duplicate: true`. Command executes ONCE. |
| **Completed Identical Duplicate** | Duplicate `req-1` after original completed | Stored terminal result (`status: 'applied'` or `'rejected'`, `duplicate: true`) | No main-process action is executed. |
| **Conflicting Duplicate** | Same `requestId` `req-1` with different action or payload | `{ status: 'rejected', duplicate: true, reason: 'request_id_conflict' }` | Neither command is executed; original record remains unchanged. |

---

## 5. Stable Rejection Reason Enum

```javascript
const REJECTION_REASONS = {
  INVALID_REQUEST_ID: 'invalid_request_id',
  REQUEST_ID_CONFLICT: 'request_id_conflict',
  INVALID_PAYLOAD: 'invalid_payload',
  UNSUPPORTED_ACTION: 'unsupported_action',
  NOT_AUTHENTICATED: 'not_authenticated',
  NOT_IDLE: 'not_idle',
  NO_ACTIVE_TIMER: 'no_active_timer',
  ALREADY_PAUSED: 'already_paused',
  ALREADY_RUNNING: 'already_running',
  MODE_UNKNOWN: 'mode_unknown',
  MODE_UNAVAILABLE: 'mode_unavailable',
  RITUAL_ACTIVE: 'ritual_active',
  STALE_STATE: 'stale_state',
  IDEMPOTENCY_CAPACITY: 'idempotency_capacity',
  UPGRADE_REQUIRED: 'upgrade_required',
  INTERNAL_ERROR: 'internal_error'
};
```

---

## 6. Server-Side Idempotency Engine Specification

### In-Memory Registry Bounds
- **Capacity Bound:** 500 entries (Initial maximum size, justified for personal LAN companion usage).
- **Eviction Rule:** Unexpired records (whether `in_progress` or terminal) **MUST NEVER be evicted** by ordinary capacity limits.
- **Capacity Exceeded Behavior:** If registry reaches 500 entries and ALL entries are unexpired, new distinct requests are rejected with `reason: 'idempotency_capacity'`.
- **TTL:** 10 minutes (600,000 ms). Expired records (`Date.now() > record.expiresAt`) are purged via a 60-second periodic sweep timer.

---

## 7. Authoritative State Correlation

- `stateRevision`: Monotonic integer tracking mutations across the **complete companion projection** (timer state, active Night Mode, ritual state, profile state, system & power settings).
- **Targeted ACK Resolution Only:** Client pending state MUST be resolved **exclusively** by receiving a targeted `commandAck` frame matching its active `requestId`. Generic `type: 'state'` broadcasts update UI display values but NEVER clear command pending locks.

---

## 8. Protocol V3 Compatibility, Android Impact & Cached-Client Audit

### Protocol Compatibility & Legacy PWA Strategy
- Legacy client frames without `requestId` or `protocolVersion: 3` are rejected with `reason: 'upgrade_required'`.
- Targeted `type: 'upgradeRequired'` frame is sent to socket to trigger client PWA refresh.

### Android Impact Classification
- **Native Android source impact:** None expected (`companion-android` Kotlin source remains untouched).
- **Runtime WebView compatibility:** Validation required (verify Web Crypto API support across Android System WebView versions).

### Cached-Client Verification Requirements
- Verify HTTP `Cache-Control: no-cache, no-store, must-revalidate` headers for `companion.html`.
- Verify browser manual/auto refresh retrieves updated `v3` `companion.html`.
- Verify Android wrapper WebView reload retrieves updated `companion.html`.
- Verify stale v2 companion page receives `reason: 'upgrade_required'` and displays update prompt.
- Verify `createRequestId()` fallback executes correctly in WebView contexts lacking `crypto.randomUUID()`.

---

## 9. Test Plan Additions

The test suite must include proof for:
1. Original request receives non-terminal `accepted` before terminal result (`applied` / `rejected`).
2. In-progress duplicate receives immediate `accepted` with `duplicate: true`.
3. All connected waiters receive the single terminal result upon execution completion.
4. Disconnected waiter client socket is safely removed from the waiter list without throwing errors.
5. Terminal ACK delivery failure to a disconnected socket does NOT re-execute the command.
6. Legacy/unsupported clients receive stable `reason: 'upgrade_required'`.
7. Secure fallback `createRequestId()` generates valid UUIDs on runtimes without `crypto.randomUUID`.
8. Registry capacity limit enforcement returns stable `reason: 'idempotency_capacity'`.
9. Protocol field is consistently `protocolVersion` (value `3`).
10. Generic `type: 'state'` broadcasts DO NOT clear or resolve correlated pending commands.

---

## 10. Explicitly Retained Open Design Questions

1. **Accepted ACK Timing:** Should `accepted` ACK be emitted synchronously inside `dispatchFrame()` before main process event loop queueing?
2. **Waiter Disconnect Lifecycle:** How should server clean up pending waiters if a socket disconnects mid-flight?
3. **Terminal ACK Delivery Failure:** If socket write fails on terminal ACK, does main process retry socket write or rely on state broadcast fallback?
4. **State Revision Increment Boundaries:** Should `stateRevision` increment on transient periodic battery/powerPlan updates or only on explicit user/system state mutations?
5. **Capability Handshake Shape:** Should `protocolVersion` handshake be exchanged during WS open or embedded per frame?
6. **Cached-Client Migration:** How many release cycles should desktop main process support legacy fallback before strictly enforcing `upgrade_required`?
7. **Command-Status Query:** Is a `getCommandStatus(requestId)` query permanently deferred or reserved for C4?
8. **Timeout Tuning:** What is the optimal client pending timeout under high Wi-Fi latency (5000ms vs 8000ms)?
9. **Snooze Bounds:** Should `snooze` allow arbitrary seconds (60-3600) or only fixed standard steps?
10. **Cancel Application Point:** Does `applied` for `cancel` fire immediately on `timerState` clear or after background process/media pause completes?
