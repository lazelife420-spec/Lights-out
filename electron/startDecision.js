// Canonical start-decision resolver: decides direct countdown vs standard ritual.
// Main-process only. The renderer supplies lookup keys; main decides execution.
//
// Precedence:
// 1. A valid, unchanged, ready Night Mode controls ritual semantics.
// 2. When no canonical Night Mode applies, fall back to the selected Family
//    Profile's ritual preference.
// 3. Family Profile identity must not override an armed Night Mode's ritual semantics.

'use strict';

const profileRitualContext = require('./profileRitualContext');

const EMPTY_NM = { nightModeId: null, nightModeTitle: null, nightModeVersion: null, ritualId: null };

function resolveEffectiveRitualId({ nightModeIdentity, profileRitualId }) {
  if (nightModeIdentity && nightModeIdentity.nightModeId) {
    return nightModeIdentity.ritualId || 'none';
  }
  return profileRitualId === 'standard' ? 'standard' : 'none';
}

function resolveStartDecision({ options, identity, profile, nmIdentity }) {
  const normalizedOptions = options || {};
  const normalizedIdentity = identity || { profileId: null, profileName: null };
  const normalizedProfile = profile || null;
  const normalizedNm = nmIdentity || EMPTY_NM;

  const profileRitualId = normalizedProfile && normalizedProfile.ritualId === 'standard' ? 'standard' : 'none';
  const effectiveRitualId = resolveEffectiveRitualId({
    nightModeIdentity: normalizedNm,
    profileRitualId
  });

  const useRitualGateway = effectiveRitualId === 'standard'
    && profileRitualContext.isEligibleOrigin(normalizedOptions.startOrigin)
    && normalizedOptions.source !== 'remote';

  return {
    options: normalizedOptions,
    identity: normalizedIdentity,
    profile: normalizedProfile,
    nmIdentity: normalizedNm,
    effectiveRitualId,
    useRitualGateway
  };
}

module.exports = {
  resolveEffectiveRitualId,
  resolveStartDecision,
  EMPTY_NM
};
