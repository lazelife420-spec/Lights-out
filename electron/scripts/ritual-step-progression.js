'use strict';
// Pure decision helper for advancing a ritual overlay through its distinct
// visible steps in desktop-ux-functional-gate.js's armAndStartMode(). Given a
// single observation of current state, decides whether progression is
// complete, whether to click the visible control once more, or whether to
// fail -- with no I/O, no native input, and no DOM access of its own. The
// harness performs all real observation (ritualState()/overlay classes/
// hit-test) and native clicks; this module only encodes the bounded,
// fingerprint-tracked decision logic so it can be tested without a live
// Electron/CDP session.

function stepFingerprint(currentStep, stepId) {
  return `${currentStep ?? 'unknown'}:${stepId ?? 'unknown'}`;
}

function decideRitualStepAction({
  ritualActive,
  overlayActive,
  totalSteps,
  currentStep,
  currentStepId,
  controlExists,
  controlVisible,
  controlLabel,
  controlHitTestOk,
  clickedFingerprints,
  attempt,
  realPowerActionsCount
}) {
  if (!ritualActive && !overlayActive) {
    return { action: 'done' };
  }

  if (realPowerActionsCount > 0) {
    return { action: 'fail', reason: 'real power action recorded during ritual progression' };
  }

  const maxAttempts = (totalSteps || 5) + 2;
  if (attempt >= maxAttempts) {
    return { action: 'fail', reason: `exceeded bounded step limit (${maxAttempts}) without the overlay dismissing` };
  }

  const fingerprint = stepFingerprint(currentStep, currentStepId);
  if (clickedFingerprints.has(fingerprint)) {
    return { action: 'fail', reason: `ritual step ${fingerprint} reappeared after already being activated`, fingerprint };
  }

  if (!controlExists || !controlVisible) {
    return { action: 'fail', reason: `ritual step ${fingerprint} has no visible supported progression control`, fingerprint };
  }

  if (controlLabel !== 'Next' && controlLabel !== 'Done') {
    return { action: 'fail', reason: `ritual step ${fingerprint} showed an unexpected control label: ${controlLabel}`, fingerprint };
  }

  if (!controlHitTestOk) {
    return { action: 'fail', reason: `ritual step ${fingerprint} progression control failed hit-test`, fingerprint };
  }

  return { action: 'click', fingerprint };
}

module.exports = { decideRitualStepAction, stepFingerprint };
