// Ritual Mode: guided bedtime ritual that chains actions into a single flow.
// Steps: Content Block → Focus wind-down → Timer start → Last Light.
// Each step transitions automatically or on user acknowledgment.
// The ritual is fully configurable and skippable.

const settingsStore = require('./settings');

// Default ritual steps (order matters).
const DEFAULT_STEPS = [
  { id: 'block', label: 'Block Distractions', durationSeconds: 0, skippable: true, auto: true },
  { id: 'dim', label: 'Dim Environment', durationSeconds: 0, skippable: true, auto: true },
  { id: 'timer', label: 'Start Wind-down Timer', durationSeconds: 0, skippable: false, auto: true },
  { id: 'lights', label: 'Smart Lights to Night Mode', durationSeconds: 0, skippable: true, auto: true }
];

// Monotonically increasing run ID so delayed callbacks can detect staleness.
let runIdCounter = 0;

let ritualState = {
  active: false,
  currentStep: 0,
  steps: [],
  startedAt: null,
  completedSteps: [],
  skippedSteps: [],
  runMeta: null,  // immutable per-run metadata (e.g. { profileRitualToken })
  runId: 0        // unique identity for this run
};

let onStepCallback = null;
let onCompleteCallback = null;
let stepTimer = null;

function getConfig() {
  const ritualConfig = settingsStore.getSection('ritual') || {};
  return {
    enabled: ritualConfig.enabled !== false,
    // Old saved routines may still contain the removed breathing step.
    steps: (Array.isArray(ritualConfig.steps) ? ritualConfig.steps : DEFAULT_STEPS).filter(step => step && step.id !== 'breathe'),
    autoAdvance: ritualConfig.autoAdvance !== false,
    timerDuration: ritualConfig.timerDuration || 28 * 60,
    timerAction: ritualConfig.timerAction || 'shutdown'
  };
}

function startRitual(customSteps, meta) {
  const config = getConfig();
  if (!config.enabled) return { active: false, reason: 'disabled' };

  // Clear any pending auto-advance timer from a previous run.
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }

  const steps = (Array.isArray(customSteps) ? customSteps : config.steps).filter(step => step && step.id !== 'breathe');
  if (!steps.length) { cancelRitual(); return { active: false, reason: 'no-steps' }; }
  runIdCounter++;
  ritualState = {
    active: true,
    currentStep: 0,
    steps: steps.map(s => ({ ...s })),
    startedAt: new Date().toISOString(),
    completedSteps: [],
    skippedSteps: [],
    runMeta: meta && typeof meta === 'object' ? Object.freeze({ ...meta }) : null,
    runId: runIdCounter
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
    if (onCompleteCallback) onCompleteCallback(getState(), ritualState.runMeta, ritualState.runId);
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

// Run-ID-owned cancellation: cancels only when the supplied runId
// matches the currently active ritual's internal run ID. Works for
// both profile and manual/global rituals.
function cancelIfCurrent(runId) {
  if (!runId) return false;
  if (!ritualState.active) return false;
  if (ritualState.runId !== runId) return false;
  cancelRitual();
  return true;
}

function getRunMeta() {
  return ritualState.runMeta;
}

function getRunId() {
  return ritualState.runId;
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

  if (onStepCallback) onStepCallback(current, getState(), ritualState.runMeta, ritualState.runId);

  // Remote-originated runs (started from the phone companion) have nobody
  // physically at the desktop to click through the guided overlay -- every
  // step there, even "auto" ones, normally advances only on a click (auto
  // just changes the button label from "Next" to "Done"). Fast-forward
  // through the whole sequence instead of getting stuck on the first step
  // forever; each step's real side effect (block/dim/timer/lights) still
  // runs via the onStepCallback above.
  if (ritualState.runMeta && ritualState.runMeta.remoteOrigin) {
    advanceStep(false);
    return;
  }

  // Auto-advance timed steps. The closure captures this run's ID so it
  // becomes a no-op if a new ritual has started in the meantime.
  if (current.auto && current.durationSeconds > 0) {
    const capturedRunId = ritualState.runId;
    stepTimer = setTimeout(() => {
      if (ritualState.runId !== capturedRunId) return;
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
  cancelIfCurrent,
  getState,
  getRunMeta,
  getRunId,
  onStep,
  onComplete,
  updateConfig
};
