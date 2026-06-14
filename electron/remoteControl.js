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

// Companion (phone PWA) uses a slightly different action vocabulary than the
// family LAN protocol. Validate + sanitize it against the same safety bounds.
// Returns { ok: true, message } with a sanitized message, or { ok: false, error }.
const COMPANION_ACTIONS = ['start', 'togglePause', 'snooze', 'cancel'];

function validateCompanionMessage(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'malformed message' };
  const action = msg.action;
  if (!COMPANION_ACTIONS.includes(action)) return { ok: false, error: 'unknown action' };

  if (action === 'start') {
    const timerAction = msg.timerAction || 'shutdown';
    if (!ALLOWED_ACTIONS.includes(timerAction)) return { ok: false, error: 'action not allowed' };
    const duration = Number(msg.durationSeconds);
    if (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) {
      return { ok: false, error: 'duration out of bounds' };
    }
    return { ok: true, message: { action, timerAction, durationSeconds: duration } };
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

module.exports = {
  ALLOWED_COMMANDS,
  ALLOWED_ACTIONS,
  COMPANION_ACTIONS,
  DURATION_MIN,
  DURATION_MAX,
  SNOOZE_MIN,
  SNOOZE_MAX,
  generateToken,
  tokensMatch,
  validateCommand,
  validateCompanionMessage
};
