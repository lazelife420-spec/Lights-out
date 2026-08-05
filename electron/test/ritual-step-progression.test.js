'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { decideRitualStepAction } = require('../scripts/ritual-step-progression');

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

test('stuck step: fingerprint unchanged after its click fails bounded, with no second click issued', () => {
  const clicked = new Set();
  const firstAttempt = decideRitualStepAction(baseObservation({ currentStep: 3, currentStepId: 'timer', clickedFingerprints: clicked, attempt: 0 }));
  assert.equal(firstAttempt.action, 'click');
  clicked.add(firstAttempt.fingerprint);

  // Ritual state never advanced (stuck) -- same fingerprint observed again.
  const secondAttempt = decideRitualStepAction(baseObservation({ currentStep: 3, currentStepId: 'timer', clickedFingerprints: clicked, attempt: 1 }));
  assert.equal(secondAttempt.action, 'fail');
  assert.match(secondAttempt.reason, /reappeared after already being activated/);
});

test('repeated/cyclic fingerprint: a previously clicked step reappearing later fails without retry', () => {
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
