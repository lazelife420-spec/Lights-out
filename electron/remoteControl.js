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
  INTERNAL_ERROR: 'internal_error'
});

function createRequestId() {
  const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    crypto.randomBytes(16).copy(bytes);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 Variant 10xx
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createCommandAck({ requestId, action, status, duplicate = false, reason = null, stateRevision = null }) {
  return {
    type: 'commandAck',
    protocolVersion: 3,
    requestId: requestId || null,
    action: action || null,
    status: status || 'rejected',
    duplicate: Boolean(duplicate),
    reason: reason || null,
    stateRevision: stateRevision !== null && stateRevision !== undefined ? Number(stateRevision) : null
  };
}

// Companion (phone PWA) uses a slightly different action vocabulary than the
// family LAN protocol. Validate + sanitize it against the same safety bounds.
// Returns { ok: true, message } with a sanitized message, or { ok: false, error, reason }.
const COMPANION_ACTIONS = ['start', 'startNightMode', 'getNightModes', 'pause', 'resume', 'togglePause', 'snooze', 'cancel'];
const MUTATING_COMPANION_ACTIONS = ['start', 'startNightMode', 'pause', 'resume', 'togglePause', 'snooze', 'cancel'];

const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{16,64}$/;

function validateCompanionMessage(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'malformed message', reason: REJECTION_REASONS.INVALID_PAYLOAD };
  const action = msg.action;
  if (!COMPANION_ACTIONS.includes(action)) return { ok: false, error: 'unknown action', reason: REJECTION_REASONS.UNSUPPORTED_ACTION };

  // Read-only query: getNightModes
  if (action === 'getNightModes') {
    let correlationId = null;
    if (msg.correlationId !== undefined && msg.correlationId !== null) {
      if (typeof msg.correlationId === 'string' && msg.correlationId.length > 0 && msg.correlationId.length <= 64) {
        correlationId = msg.correlationId;
      }
    }
    return { ok: true, message: { action, correlationId } };
  }

  // Mutating companion commands require protocolVersion: 3 and valid requestId
  if (MUTATING_COMPANION_ACTIONS.includes(action)) {
    if (msg.protocolVersion !== 3) {
      return { ok: false, error: 'upgrade_required', reason: REJECTION_REASONS.UPGRADE_REQUIRED };
    }

    const requestId = msg.requestId;
    if (typeof requestId !== 'string' || !REQUEST_ID_REGEX.test(requestId)) {
      return { ok: false, error: 'invalid_request_id', reason: REJECTION_REASONS.INVALID_REQUEST_ID };
    }

    if (action === 'start') {
      const timerAction = msg.timerAction || 'shutdown';
      if (!ALLOWED_ACTIONS.includes(timerAction)) return { ok: false, error: 'action not allowed', reason: REJECTION_REASONS.INVALID_PAYLOAD };
      const duration = Number(msg.durationSeconds);
      if (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) {
        return { ok: false, error: 'duration out of bounds', reason: REJECTION_REASONS.INVALID_PAYLOAD };
      }
      return { ok: true, message: { protocolVersion: 3, requestId, action, timerAction, durationSeconds: duration } };
    }

    if (action === 'startNightMode') {
      const nightModeId = msg.nightModeId;
      if (typeof nightModeId !== 'string' || nightModeId.length === 0) {
        return { ok: false, error: 'missing or invalid nightModeId', reason: REJECTION_REASONS.INVALID_PAYLOAD };
      }
      return { ok: true, message: { protocolVersion: 3, requestId, action, nightModeId } };
    }

    if (action === 'snooze') {
      const seconds = Number(msg.seconds);
      if (!Number.isInteger(seconds) || seconds < SNOOZE_MIN || seconds > SNOOZE_MAX) {
        return { ok: false, error: 'snooze out of bounds', reason: REJECTION_REASONS.INVALID_PAYLOAD };
      }
      return { ok: true, message: { protocolVersion: 3, requestId, action, seconds } };
    }

    // pause / resume / togglePause / cancel take no parameters.
    return { ok: true, message: { protocolVersion: 3, requestId, action } };
  }

  return { ok: false, error: 'unknown action', reason: REJECTION_REASONS.UNSUPPORTED_ACTION };
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
  createRequestId,
  createCommandAck,
  generateToken,
  tokensMatch,
  validateCommand,
  validateCompanionMessage
};

