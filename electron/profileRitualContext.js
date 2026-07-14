// Profile Ritual Context: manages a one-use pending timer context when a
// profile-sourced standard ritual is started. Main process only.
//
// The pending context holds validated timer options that the ritual's 'timer'
// step will consume exactly once. It is cleared on consumption, cancellation,
// completion without timer start, error, new ritual start, or app shutdown.

'use strict';

// Eligible start origins that may trigger a profile ritual gateway.
const ELIGIBLE_ORIGINS = Object.freeze(['play', 'profile-start']);

let pendingContext = null;

function createContext(validated) {
  if (!validated || typeof validated !== 'object') return null;

  const token = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  pendingContext = {
    token,
    durationSeconds: validated.durationSeconds,
    action: validated.action,
    dryRun: Boolean(validated.dryRun),
    forceShutdown: Boolean(validated.forceShutdown),
    muteSystem: Boolean(validated.muteSystem),
    gracePeriod: validated.gracePeriod,
    profileId: validated.profileId,
    profileName: validated.profileName,
    createdAt: Date.now()
  };
  return pendingContext.token;
}

function consume(token) {
  if (!pendingContext || pendingContext.token !== token) return null;
  const ctx = { ...pendingContext };
  pendingContext = null;
  return ctx;
}

// consumeAny is intentionally not exported. The timer step must use
// token-verified consume(token) to prove ownership of the active run.
function _consumeAny() {
  if (!pendingContext) return null;
  const ctx = { ...pendingContext };
  pendingContext = null;
  return ctx;
}

function clear() {
  pendingContext = null;
}

function hasPending() {
  return pendingContext !== null;
}

function getPendingToken() {
  return pendingContext ? pendingContext.token : null;
}

function isEligibleOrigin(origin) {
  return ELIGIBLE_ORIGINS.includes(origin);
}

module.exports = {
  ELIGIBLE_ORIGINS,
  createContext,
  consume,
  clear,
  hasPending,
  getPendingToken,
  isEligibleOrigin
};
