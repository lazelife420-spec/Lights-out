// Profile Ritual Context: manages a one-use pending timer context when a
// profile-sourced standard ritual is started. Main process only.
//
// The pending context holds validated timer options that the ritual's 'timer'
// step will consume exactly once. It is cleared on consumption, cancellation,
// completion without timer start, error, new ritual start, or app shutdown.

'use strict';

// Eligible start origins that may trigger a profile ritual gateway.
const ELIGIBLE_ORIGINS = Object.freeze(['play', 'profile-start', 'companion-night-mode', 'calendar']);

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
    nightModeId: validated.nightModeId || null,
    nightModeTitle: validated.nightModeTitle || null,
    nightModeVersion: validated.nightModeVersion || null,
    // Display-only run origin (e.g. 'phone'), carried to the ritual timer step.
    origin: typeof validated.origin === 'string' ? validated.origin : null,
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

// Unconditional clear: use only for manual Begin Ritual, direct supersession,
// and app shutdown. Run-owned callbacks should prefer clearIfOwned(token).
function clear() {
  pendingContext = null;
}

// Token-safe clear: clears pending context only if it belongs to the given
// token. An old run's callback cannot clear a newer run's context.
function clearIfOwned(token) {
  if (pendingContext && pendingContext.token === token) {
    pendingContext = null;
    return true;
  }
  return false;
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
  clearIfOwned,
  hasPending,
  getPendingToken,
  isEligibleOrigin
};
