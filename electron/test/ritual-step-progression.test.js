'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { decideRitualStepAction, decideWorkareaControlAction } = require('../scripts/ritual-step-progression');

function baseObservation(overrides = {}) {
  return {
    ritualActive: true,
    overlayActive: true,
    totalSteps: 5,
    currentStep: 0,
    currentStepId: 'breathe',
    controlExists: true,
    controlVisible: true,
    controlLabel: 'Next',
    controlHitTestOk: true,
    clickedFingerprints: new Set(),
    attempt: 0,
    realPowerActionsCount: 0,
    ...overrides
  };
}

test('one-step overlay: single native progression, then overlay dismissed', () => {
  const clicked = new Set();
  const first = decideRitualStepAction(baseObservation({ totalSteps: 1, currentStep: 0, currentStepId: 'only', clickedFingerprints: clicked, attempt: 0 }));
  assert.equal(first.action, 'click');
  assert.equal(first.fingerprint, '0:only');
  clicked.add(first.fingerprint);

  const second = decideRitualStepAction(baseObservation({ ritualActive: false, overlayActive: false, totalSteps: 1, currentStep: 0, currentStepId: 'only', clickedFingerprints: clicked, attempt: 1 }));
  assert.equal(second.action, 'done');
});

test('multiple sequential steps: each distinct step activated exactly once before dismissal', () => {
  const clicked = new Set();
  const stepA = decideRitualStepAction(baseObservation({ totalSteps: 2, currentStep: 0, currentStepId: 'block', clickedFingerprints: clicked, attempt: 0 }));
  assert.equal(stepA.action, 'click');
  clicked.add(stepA.fingerprint);

  const stepB = decideRitualStepAction(baseObservation({ totalSteps: 2, currentStep: 1, currentStepId: 'timer', clickedFingerprints: clicked, attempt: 1 }));
  assert.equal(stepB.action, 'click');
  assert.notEqual(stepB.fingerprint, stepA.fingerprint);
  clicked.add(stepB.fingerprint);

  const done = decideRitualStepAction(baseObservation({ ritualActive: false, overlayActive: false, totalSteps: 2, clickedFingerprints: clicked, attempt: 2 }));
  assert.equal(done.action, 'done');
});

test('three or more distinct steps: each processed once, within the configured bound', () => {
  const clicked = new Set();
  const stepIds = ['breathe', 'block', 'dim', 'timer', 'lights'];
  stepIds.forEach((id, index) => {
    const decision = decideRitualStepAction(baseObservation({ totalSteps: 5, currentStep: index, currentStepId: id, clickedFingerprints: clicked, attempt: index }));
    assert.equal(decision.action, 'click', `step ${id} should be clicked`);
    clicked.add(decision.fingerprint);
  });
  const done = decideRitualStepAction(baseObservation({ ritualActive: false, overlayActive: false, totalSteps: 5, clickedFingerprints: clicked, attempt: stepIds.length }));
  assert.equal(done.action, 'done');
  assert.equal(clicked.size, 5);
});

test('immediate repeat A -> A: fingerprint unchanged after its click fails with no duplicate activation', () => {
  const clicked = new Set();
  const firstAttempt = decideRitualStepAction(baseObservation({ currentStep: 3, currentStepId: 'timer', clickedFingerprints: clicked, attempt: 0 }));
  assert.equal(firstAttempt.action, 'click');
  clicked.add(firstAttempt.fingerprint);

  // Ritual state never advanced (stuck) -- same fingerprint observed again.
  const secondAttempt = decideRitualStepAction(baseObservation({ currentStep: 3, currentStepId: 'timer', clickedFingerprints: clicked, attempt: 1 }));
  assert.equal(secondAttempt.action, 'fail');
  assert.match(secondAttempt.reason, /reappeared after already being activated/);
});

test('non-adjacent cycle A -> B -> A: a previously clicked step fails without reactivation', () => {
  const clicked = new Set();
  const stepZero = decideRitualStepAction(baseObservation({ currentStep: 0, currentStepId: 'breathe', clickedFingerprints: clicked, attempt: 0 }));
  assert.equal(stepZero.action, 'click');
  clicked.add(stepZero.fingerprint);

  const stepOne = decideRitualStepAction(baseObservation({ currentStep: 1, currentStepId: 'block', clickedFingerprints: clicked, attempt: 1 }));
  assert.equal(stepOne.action, 'click');
  clicked.add(stepOne.fingerprint);

  // Cycles back to step 0 -- must fail, not be treated as fresh progression.
  const cycled = decideRitualStepAction(baseObservation({ currentStep: 0, currentStepId: 'breathe', clickedFingerprints: clicked, attempt: 2 }));
  assert.equal(cycled.action, 'fail');
  assert.match(cycled.reason, /reappeared after already being activated/);
});

test('overlay active without a supported visible control fails', () => {
  const decision = decideRitualStepAction(baseObservation({ controlExists: false, controlVisible: false }));
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /no visible supported progression control/);
});

test('unexpected control label fails as a terminal-state mismatch', () => {
  const decision = decideRitualStepAction(baseObservation({ controlLabel: 'Continue Anyway' }));
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /unexpected control label/);
});

test('a nonzero real power ledger fails immediately, ahead of every other check', () => {
  const decision = decideRitualStepAction(baseObservation({
    realPowerActionsCount: 1,
    controlExists: false, // would also fail on its own -- power check must win
    attempt: 999 // would also fail the bound check -- power check must win
  }));
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /real power action/);
});

test('full-shutdown under Dry Run: bounded 5-step progression succeeds with zero real power actions throughout', () => {
  const clicked = new Set();
  const stepIds = ['breathe', 'block', 'dim', 'timer', 'lights'];
  stepIds.forEach((id, index) => {
    const decision = decideRitualStepAction(baseObservation({
      totalSteps: 5,
      currentStep: index,
      currentStepId: id,
      clickedFingerprints: clicked,
      attempt: index,
      realPowerActionsCount: 0
    }));
    assert.equal(decision.action, 'click');
    clicked.add(decision.fingerprint);
  });
  const done = decideRitualStepAction(baseObservation({ ritualActive: false, overlayActive: false, totalSteps: 5, clickedFingerprints: clicked, attempt: stepIds.length, realPowerActionsCount: 0 }));
  assert.equal(done.action, 'done');
});

test('bounded step limit is derived from totalSteps plus a small margin, not unbounded', () => {
  const clicked = new Set();
  // totalSteps=2 => maxAttempts=4; attempt index 4 should already be out of bounds.
  const decision = decideRitualStepAction(baseObservation({ totalSteps: 2, currentStep: 9, currentStepId: 'never-seen', clickedFingerprints: clicked, attempt: 4 }));
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /exceeded bounded step limit/);
});

function workareaObservation(overrides = {}) {
  return baseObservation({
    pauseCoveredByActiveOverlay: true,
    pauseTargetExists: true,
    pauseTargetVisible: true,
    pauseTargetHitTestOk: false,
    ...overrides
  });
}

test('workarea overlay inactive: Pause is the one permitted native action', () => {
  const decision = decideWorkareaControlAction(workareaObservation({
    ritualActive: false,
    overlayActive: false,
    pauseCoveredByActiveOverlay: false,
    pauseTargetHitTestOk: true
  }));
  assert.deepEqual(decision, { action: 'pause', target: 'pause' });
});

test('workarea one remaining step: one ritual activation precedes one Pause action', () => {
  const clicked = new Set();
  let ritualActivations = 0;
  let pauseActivations = 0;
  const step = decideWorkareaControlAction(workareaObservation({ totalSteps: 1, currentStepId: 'breathe', clickedFingerprints: clicked }));
  assert.equal(step.action, 'ritual-click');
  clicked.add(step.fingerprint);
  ritualActivations++;
  const pause = decideWorkareaControlAction(workareaObservation({ ritualActive: false, overlayActive: false, clickedFingerprints: clicked, attempt: 1, pauseCoveredByActiveOverlay: false, pauseTargetHitTestOk: true }));
  assert.equal(pause.action, 'pause');
  pauseActivations++;
  assert.equal(ritualActivations, 1);
  assert.equal(pauseActivations, 1);
});

test('workarea multiple remaining steps: every distinct fingerprint precedes Pause', () => {
  const clicked = new Set();
  const ids = ['breathe', 'block', 'dim'];
  ids.forEach((id, index) => {
    const decision = decideWorkareaControlAction(workareaObservation({ totalSteps: ids.length, currentStep: index, currentStepId: id, controlLabel: index === 0 ? 'Next' : 'Done', clickedFingerprints: clicked, attempt: index }));
    assert.equal(decision.action, 'ritual-click');
    clicked.add(decision.fingerprint);
  });
  const pause = decideWorkareaControlAction(workareaObservation({ ritualActive: false, overlayActive: false, clickedFingerprints: clicked, attempt: ids.length, pauseCoveredByActiveOverlay: false, pauseTargetHitTestOk: true }));
  assert.equal(pause.action, 'pause');
  assert.equal(clicked.size, ids.length);
});

test('workarea Pause covered by active overlay: only ritual progression is permitted', () => {
  const decision = decideWorkareaControlAction(workareaObservation());
  assert.equal(decision.action, 'ritual-click');
  assert.equal(decision.target, 'ritual');
  assert.notEqual(decision.action, 'pause');
});

test('workarea stuck ritual step: fail boundedly with no Pause action', () => {
  const clicked = new Set(['0:breathe']);
  const decision = decideWorkareaControlAction(workareaObservation({ clickedFingerprints: clicked, attempt: 1 }));
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /reappeared/);
  assert.notEqual(decision.action, 'pause');
});

test('workarea cyclic fingerprint: fail with no duplicate ritual activation and no Pause', () => {
  const clicked = new Set(['0:breathe', '1:block']);
  const decision = decideWorkareaControlAction(workareaObservation({ currentStep: 0, currentStepId: 'breathe', clickedFingerprints: clicked, attempt: 2 }));
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /reappeared/);
  assert.equal(clicked.size, 2);
  assert.notEqual(decision.action, 'pause');
});

test('workarea real-power ledger change: fail immediately even after overlay dismissal', () => {
  const decision = decideWorkareaControlAction(workareaObservation({
    ritualActive: false,
    overlayActive: false,
    realPowerActionsCount: 1,
    pauseCoveredByActiveOverlay: false,
    pauseTargetHitTestOk: true
  }));
  assert.equal(decision.action, 'fail');
  assert.match(decision.reason, /real power action/);
  assert.notEqual(decision.action, 'pause');
});

test('workarea full-shutdown Dry Run: five distinct steps complete before safe Pause', () => {
  const clicked = new Set();
  const ids = ['breathe', 'block', 'dim', 'timer', 'lights'];
  ids.forEach((id, index) => {
    const decision = decideWorkareaControlAction(workareaObservation({ totalSteps: 5, currentStep: index, currentStepId: id, controlLabel: index === 0 ? 'Next' : 'Done', clickedFingerprints: clicked, attempt: index, realPowerActionsCount: 0 }));
    assert.equal(decision.action, 'ritual-click');
    clicked.add(decision.fingerprint);
  });
  const pause = decideWorkareaControlAction(workareaObservation({ ritualActive: false, overlayActive: false, clickedFingerprints: clicked, attempt: 5, realPowerActionsCount: 0, pauseCoveredByActiveOverlay: false, pauseTargetHitTestOk: true }));
  assert.equal(pause.action, 'pause');
  assert.equal(clicked.size, 5);
});
