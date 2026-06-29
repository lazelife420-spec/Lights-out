// Ritual Mode: guided bedtime ritual that chains actions into a single flow.
// Steps: Breathing → Content Block → Focus wind-down → Timer start → Last Light.
// Each step transitions automatically or on user acknowledgment.
// The ritual is fully configurable and skippable.

const settingsStore = require('./settings');

// Default ritual steps (order matters).
const DEFAULT_STEPS = [
  { id: 'breathe', label: 'Guided Breathing', durationSeconds: 60, skippable: true, auto: false },
  { id: 'block', label: 'Block Distractions', durationSeconds: 0, skippable: true, auto: true },
  { id: 'dim', label: 'Dim Environment', durationSeconds: 0, skippable: true, auto: true },
  { id: 'timer', label: 'Start Wind-down Timer', durationSeconds: 0, skippable: false, auto: true },
  { id: 'lights', label: 'Smart Lights to Night Mode', durationSeconds: 0, skippable: true, auto: true }
];

let ritualState = {
  active: false,
  currentStep: 0,
  steps: [],
  startedAt: null,
  completedSteps: [],
  skippedSteps: []
};

let onStepCallback = null;
let onCompleteCallback = null;
let stepTimer = null;

function getConfig() {
  const ritualConfig = settingsStore.getSection('ritual') || {};
  return {
    enabled: ritualConfig.enabled !== false,
    steps: ritualConfig.steps || DEFAULT_STEPS,
    autoAdvance: ritualConfig.autoAdvance !== false,
    timerDuration: ritualConfig.timerDuration || 28 * 60,
    timerAction: ritualConfig.timerAction || 'shutdown'
  };
}

function startRitual(customSteps) {
  const config = getConfig();
  if (!config.enabled) return { active: false, reason: 'disabled' };

  const steps = customSteps || config.steps;
  ritualState = {
    active: true,
    currentStep: 0,
    steps: steps.map(s => ({ ...s })),
    startedAt: new Date().toISOString(),
    completedSteps: [],
    skippedSteps: []
  };

  emitStep();
  return getState();
}

function advanceStep(skipped = false) {
  if (!ritualState.active) return getState();

  const current = ritualState.steps[ritualState.currentStep];
  if (skipped) {
    ritualState.skippedSteps.push(current.id);
  } else {
    ritualState.completedSteps.push(current.id);
  }

  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }

  ritualState.currentStep++;
  if (ritualState.currentStep >= ritualState.steps.length) {
    // Ritual complete.
    ritualState.active = false;
    if (onCompleteCallback) onCompleteCallback(getState());
    return getState();
  }

  emitStep();
  return getState();
}

function skipStep() {
  return advanceStep(true);
}

function cancelRitual() {
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
  ritualState.active = false;
  return getState();
}

function getState() {
  const current = ritualState.active ? ritualState.steps[ritualState.currentStep] : null;
  return {
    active: ritualState.active,
    currentStep: ritualState.currentStep,
    totalSteps: ritualState.steps.length,
    currentStepInfo: current,
    completedSteps: ritualState.completedSteps,
    skippedSteps: ritualState.skippedSteps,
    startedAt: ritualState.startedAt,
    progress: ritualState.steps.length > 0
      ? Math.round((ritualState.currentStep / ritualState.steps.length) * 100)
      : 0
  };
}

function emitStep() {
  const current = ritualState.steps[ritualState.currentStep];
  if (!current) return;

  if (onStepCallback) onStepCallback(current, getState());

  // Auto-advance timed steps.
  if (current.auto && current.durationSeconds > 0) {
    stepTimer = setTimeout(() => {
      advanceStep(false);
    }, current.durationSeconds * 1000);
  }
}

function onStep(cb) { onStepCallback = cb; }
function onComplete(cb) { onCompleteCallback = cb; }

function updateConfig(updates) {
  const current = settingsStore.getSection('ritual') || {};
  settingsStore.updateSection('ritual', { ...current, ...updates });
  return getConfig();
}

module.exports = {
  DEFAULT_STEPS,
  getConfig,
  startRitual,
  advanceStep,
  skipStep,
  cancelRitual,
  getState,
  onStep,
  onComplete,
  updateConfig
};
