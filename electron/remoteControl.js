// Shared validation + token helpers for LAN remote control (family + companion).
// Pure, dependency-light (Node core only) so it is unit-testable without Electron.

const crypto = require('crypto');

const ALLOWED_COMMANDS = ['start', 'pause', 'resume', 'snooze', 'cancel'];
// Remote control may only trigger these actions. Notably excludes 'logout',
// 'hibernate', and never permits a forced shutdown.
const ALLOWED_ACTIONS = ['shutdown', 'sleep', 'restart'];
const DURATION_MIN = 60;            // 1 minute
const DURATION_MAX = 24 * 60 * 60;  // 24 hours
const SNOOZE_MIN = 60;              // 1 minute
const SNOOZE_MAX = 60 * 60;         // 1 hour

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Constant-time token comparison. Rejects empty/missing/type-mismatched tokens.
function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (provided.length === 0 || expected.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Validate + normalize an inbound remote command.
// Returns { ok: true, command } with a sanitized command, or { ok: false, error }.
function validateCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: 'malformed command' };
  const command = cmd.command;
  if (!ALLOWED_COMMANDS.includes(command)) return { ok: false, error: 'unknown command' };

  if (command === 'start') {
    const action = cmd.action || 'shutdown';
    if (!ALLOWED_ACTIONS.includes(action)) return { ok: false, error: 'action not allowed' };
    const duration = Number(cmd.durationSeconds);
    if (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) {
      return { ok: false, error: 'duration out of bounds' };
    }
    // Remote control never forces a shutdown.
    return { ok: true, command: { command, action, durationSeconds: duration, forceShutdown: false } };
  }

  if (command === 'snooze') {
    const seconds = Number(cmd.seconds);
    if (!Number.isInteger(seconds) || seconds < SNOOZE_MIN || seconds > SNOOZE_MAX) {
      return { ok: false, error: 'snooze out of bounds' };
    }
    return { ok: true, command: { command, seconds } };
  }

  // pause / resume / cancel take no parameters.
  return { ok: true, command: { command } };
}

const REJECTION_REASONS = Object.freeze({
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
  UNSUPPORTED_PROTOCOL_VERSION: 'unsupported_protocol_version',
  INVALID_PROTOCOL_VERSION: 'invalid_protocol_version',
  INTERNAL_ERROR: 'internal_error'
});

const ACK_STATUSES = Object.freeze({
  ACCEPTED: 'accepted',
  COMPLETED: 'completed',
  REJECTED: 'rejected'
});

const COMPANION_ACTIONS = ['start', 'startNightMode', 'getNightModes', 'pause', 'resume', 'togglePause', 'snooze', 'cancel'];
const MUTATING_COMPANION_ACTIONS = ['start', 'startNightMode', 'pause', 'resume', 'togglePause', 'snooze', 'cancel'];
const DEFAULT_V3_ENABLED_ACTIONS = ['start', 'startNightMode', 'getNightModes', 'togglePause', 'snooze', 'cancel']; // pause/resume excluded by default!

const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{16,64}$/;

function createRequestId(cryptoSource = (typeof globalThis !== 'undefined' ? globalThis.crypto : (typeof window !== 'undefined' ? window.crypto : undefined))) {
  if (cryptoSource?.randomUUID) {
    return cryptoSource.randomUUID().toLowerCase();
  }
  if (cryptoSource?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 Variant 10xx
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
  }
  if (cryptoSource === undefined && typeof crypto !== 'undefined' && crypto.randomBytes) {
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
  }
  throw new Error('No secure crypto source available');
}

function createCommandAck({ requestId, action, status, duplicate = false, reason = null, stateRevision = null }) {
  if (typeof requestId !== 'string' || !REQUEST_ID_REGEX.test(requestId)) {
    throw new TypeError('Invalid requestId for commandAck');
  }
  if (typeof action !== 'string' || !COMPANION_ACTIONS.includes(action)) {
    throw new TypeError('Invalid action for commandAck');
  }
  if (!Object.values(ACK_STATUSES).includes(status)) {
    throw new TypeError('Invalid status for commandAck');
  }

  const isDup = Boolean(duplicate);

  let finalReason = null;
  if (status === ACK_STATUSES.REJECTED) {
    if (typeof reason !== 'string' || !Object.values(REJECTION_REASONS).includes(reason)) {
      throw new TypeError('Rejected commandAck requires valid rejection reason');
    }
    finalReason = reason;
  } else {
    if (reason !== null && reason !== undefined) {
      throw new TypeError('Accepted or completed commandAck must have null reason');
    }
  }

  let finalRevision = null;
  if (stateRevision !== null && stateRevision !== undefined) {
    const revNum = Number(stateRevision);
    if (!Number.isInteger(revNum) || revNum < 0) {
      throw new TypeError('stateRevision must be a non-negative integer or null');
    }
    finalRevision = revNum;
  }

  return {
    type: 'commandAck',
    protocolVersion: 3,
    requestId,
    action,
    status,
    duplicate: isDup,
    reason: finalReason,
    stateRevision: finalRevision
  };
}

function canonicalize(obj, seen = new WeakSet()) {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'function' || typeof obj === 'symbol') {
      return undefined;
    }
    return obj;
  }
  if (seen.has(obj)) {
    throw new TypeError('Cyclic object cannot be canonicalized');
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    const res = obj.map(item => canonicalize(item, seen));
    seen.delete(obj);
    return res;
  }

  const sortedKeys = Object.keys(obj).sort();
  const res = {};
  for (const key of sortedKeys) {
    if (key === 'requestId' || key === 'protocolVersion') continue;
    const val = canonicalize(obj[key], seen);
    if (val !== undefined) {
      res[key] = val;
    }
  }
  seen.delete(obj);
  return res;
}

function canonicalStringify(validatedPayload) {
  return JSON.stringify(canonicalize(validatedPayload));
}

// Legacy shipping companion validator (preserves current shipped v11.1 behavior without requiring protocolVersion/requestId)
const LEGACY_COMPANION_ACTIONS = ['start', 'startNightMode', 'getNightModes', 'togglePause', 'snooze', 'cancel'];

function validateCompanionMessage(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'malformed message' };
  const action = msg.action;
  if (!LEGACY_COMPANION_ACTIONS.includes(action)) return { ok: false, error: 'unknown action' };

  if (action === 'start') {
    const timerAction = msg.timerAction || 'shutdown';
    if (!ALLOWED_ACTIONS.includes(timerAction)) return { ok: false, error: 'action not allowed' };
    const duration = Number(msg.durationSeconds);
    if (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) {
      return { ok: false, error: 'duration out of bounds' };
    }
    return { ok: true, message: { action, timerAction, durationSeconds: duration } };
  }

  if (action === 'startNightMode') {
    const nightModeId = msg.nightModeId;
    if (typeof nightModeId !== 'string' || nightModeId.length === 0) {
      return { ok: false, error: 'missing or invalid nightModeId' };
    }
    return { ok: true, message: { action, nightModeId } };
  }

  if (action === 'getNightModes') {
    return { ok: true, message: { action } };
  }

  if (action === 'snooze') {
    const seconds = Number(msg.seconds);
    if (!Number.isInteger(seconds) || seconds < SNOOZE_MIN || seconds > SNOOZE_MAX) {
      return { ok: false, error: 'snooze out of bounds' };
    }
    return { ok: true, message: { action, seconds } };
  }

  // togglePause / cancel take no parameters.
  return { ok: true, message: { action } };
}

// Strict Protocol V3 Companion Validator
function validateCompanionV3Message(raw, options = {}) {
  const enabledActions = options.enabledActions || DEFAULT_V3_ENABLED_ACTIONS;

  if (!raw || typeof raw !== 'object') {
    return { ok: false, command: null, canonicalPayload: null, error: 'malformed payload', reason: REJECTION_REASONS.INVALID_PAYLOAD };
  }

  const action = raw.action;
  if (typeof action !== 'string' || !COMPANION_ACTIONS.includes(action)) {
    return { ok: false, command: null, canonicalPayload: null, error: 'unknown action', reason: REJECTION_REASONS.UNSUPPORTED_ACTION };
  }

  if (!enabledActions.includes(action)) {
    return { ok: false, command: null, canonicalPayload: null, error: 'action disabled in current configuration', reason: REJECTION_REASONS.UNSUPPORTED_ACTION };
  }

  // Read-only query: getNightModes
  if (action === 'getNightModes') {
    let correlationId = null;
    if (raw.correlationId !== undefined && raw.correlationId !== null) {
      if (typeof raw.correlationId === 'string' && raw.correlationId.length > 0 && raw.correlationId.length <= 64) {
        correlationId = raw.correlationId;
      }
    }
    const command = { action: 'getNightModes', correlationId };
    const canonicalPayload = canonicalize(command);
    return { ok: true, command, canonicalPayload, error: null, reason: null };
  }

  // Mutating V3 commands check protocolVersion and requestId
  const pv = raw.protocolVersion;
  if (pv === undefined || pv === null) {
    return { ok: false, command: null, canonicalPayload: null, error: 'missing protocol version', reason: REJECTION_REASONS.UPGRADE_REQUIRED };
  }
  if (typeof pv !== 'number') {
    return { ok: false, command: null, canonicalPayload: null, error: 'invalid protocol version type', reason: REJECTION_REASONS.INVALID_PROTOCOL_VERSION };
  }
  if (pv < 3) {
    return { ok: false, command: null, canonicalPayload: null, error: 'upgrade required', reason: REJECTION_REASONS.UPGRADE_REQUIRED };
  }
  if (pv > 3) {
    return { ok: false, command: null, canonicalPayload: null, error: 'unsupported protocol version', reason: REJECTION_REASONS.UNSUPPORTED_PROTOCOL_VERSION };
  }

  const requestId = raw.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID_REGEX.test(requestId)) {
    return { ok: false, command: null, canonicalPayload: null, error: 'invalid request id', reason: REJECTION_REASONS.INVALID_REQUEST_ID };
  }

  let command = null;
  let canonicalPayload = null;

  if (action === 'start') {
    const timerAction = raw.timerAction || 'shutdown';
    if (!ALLOWED_ACTIONS.includes(timerAction)) {
      return { ok: false, command: null, canonicalPayload: null, error: 'action not allowed', reason: REJECTION_REASONS.INVALID_PAYLOAD };
    }
    const duration = Number(raw.durationSeconds);
    if (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) {
      return { ok: false, command: null, canonicalPayload: null, error: 'duration out of bounds', reason: REJECTION_REASONS.INVALID_PAYLOAD };
    }
    command = { protocolVersion: 3, requestId, action, timerAction, durationSeconds: duration };
    canonicalPayload = canonicalize({ action, timerAction, durationSeconds: duration });
    return { ok: true, command, canonicalPayload, error: null, reason: null };
  }

  if (action === 'startNightMode') {
    const nightModeId = raw.nightModeId;
    if (typeof nightModeId !== 'string' || nightModeId.length === 0) {
      return { ok: false, command: null, canonicalPayload: null, error: 'missing or invalid nightModeId', reason: REJECTION_REASONS.INVALID_PAYLOAD };
    }
    command = { protocolVersion: 3, requestId, action, nightModeId };
    canonicalPayload = canonicalize({ action, nightModeId });
    return { ok: true, command, canonicalPayload, error: null, reason: null };
  }

  if (action === 'snooze') {
    const seconds = Number(raw.seconds);
    if (!Number.isInteger(seconds) || seconds < SNOOZE_MIN || seconds > SNOOZE_MAX) {
      return { ok: false, command: null, canonicalPayload: null, error: 'snooze out of bounds', reason: REJECTION_REASONS.INVALID_PAYLOAD };
    }
    command = { protocolVersion: 3, requestId, action, seconds };
    canonicalPayload = canonicalize({ action, seconds });
    return { ok: true, command, canonicalPayload, error: null, reason: null };
  }

  // pause / resume / togglePause / cancel
  command = { protocolVersion: 3, requestId, action };
  canonicalPayload = canonicalize({ action });
  return { ok: true, command, canonicalPayload, error: null, reason: null };
}

module.exports = {
  ALLOWED_COMMANDS,
  ALLOWED_ACTIONS,
  COMPANION_ACTIONS,
  MUTATING_COMPANION_ACTIONS,
  DURATION_MIN,
  DURATION_MAX,
  SNOOZE_MIN,
  SNOOZE_MAX,
  REJECTION_REASONS,
  ACK_STATUSES,
  createRequestId,
  createCommandAck,
  canonicalize,
  canonicalStringify,
  generateToken,
  tokensMatch,
  validateCommand,
  validateCompanionMessage,
  validateCompanionV3Message
};
