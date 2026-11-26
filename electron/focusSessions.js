// Focus Sessions: daytime Pomodoro-style deep work sessions.
// Reuses the wind-down engine but inverted: focus phase is deep work,
// break phase is a short rest. Same ring, same phases, same sounds.

// Default focus presets.
const PRESETS = {
  pomodoro:   { focus: 25 * 60, break: 5 * 60, longBreak: 15 * 60, cycles: 4 },
  deep:       { focus: 50 * 60, break: 10 * 60, longBreak: 20 * 60, cycles: 3 },
  sprint:     { focus: 15 * 60, break: 3 * 60, longBreak: 10 * 60, cycles: 6 },
  custom:     { focus: 25 * 60, break: 5 * 60, longBreak: 15 * 60, cycles: 4 }
};

let focusInterval = null;

let focusState = {
  active: false,
  paused: false,
  preset: 'pomodoro',
  cycle: 0,
  totalCycles: 4,
  inBreak: false,
  inLongBreak: false,
  remainingSeconds: 0,
  totalSeconds: 0,
  focusSeconds: 25 * 60,
  breakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
  completedCycles: 0,
  totalFocusTime: 0
};

let onTickCallback = null;
let onPhaseCallback = null;
let onCompleteCallback = null;

function publicState() {
  return {
    active: focusState.active,
    paused: focusState.paused,
    preset: focusState.preset,
    cycle: focusState.cycle,
    totalCycles: focusState.totalCycles,
    inBreak: focusState.inBreak,
    inLongBreak: focusState.inLongBreak,
    remainingSeconds: focusState.remainingSeconds,
    totalSeconds: focusState.totalSeconds,
    focusSeconds: focusState.focusSeconds,
    breakSeconds: focusState.breakSeconds,
    longBreakSeconds: focusState.longBreakSeconds,
    completedCycles: focusState.completedCycles,
    totalFocusTime: focusState.totalFocusTime
  };
}

function positiveInt(value, fallback, min = 1, max = 24 * 60 * 60) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min ? Math.min(max, n) : fallback;
}

function startFocusSession(preset = 'pomodoro', customConfig) {
  const base = PRESETS[preset] || PRESETS.pomodoro;
  const custom = customConfig && typeof customConfig === 'object' ? customConfig : null;
  const config = {
    focus: positiveInt(custom ? custom.focus : base.focus, base.focus),
    break: positiveInt(custom ? custom.break : base.break, base.break),
    longBreak: positiveInt(custom ? custom.longBreak : base.longBreak, base.longBreak),
    cycles: positiveInt(custom ? custom.cycles : base.cycles, base.cycles, 1, 24)
  };
  stopFocusSession(); // clean up any existing session

  focusState = {
    active: true,
    paused: false,
    preset: PRESETS[preset] ? preset : 'pomodoro',
    cycle: 0,
    totalCycles: config.cycles,
    inBreak: false,
    inLongBreak: false,
    remainingSeconds: config.focus,
    totalSeconds: config.focus,
    focusSeconds: config.focus,
    breakSeconds: config.break,
    longBreakSeconds: config.longBreak,
    completedCycles: 0,
    totalFocusTime: 0
  };

  // Notify phase change.
  if (onPhaseCallback) onPhaseCallback('focus', publicState());

  focusInterval = setInterval(() => {
    if (!focusState.active || focusState.paused) return;
    focusState.remainingSeconds--;

    if (onTickCallback) onTickCallback(publicState());

    if (focusState.remainingSeconds <= 0) {
      handlePhaseEnd();
    }
  }, 1000);

  return publicState();
}

function handlePhaseEnd() {
  if (focusState.inBreak || focusState.inLongBreak) {
    // Break ended, start new focus cycle.
    focusState.inBreak = false;
    focusState.inLongBreak = false;
    focusState.cycle++;
    focusState.remainingSeconds = focusState.focusSeconds;
    focusState.totalSeconds = focusState.focusSeconds;
    if (onPhaseCallback) onPhaseCallback('focus', publicState());
  } else {
    // Focus ended, start break or finish after final cycle.
    focusState.completedCycles++;
    focusState.totalFocusTime += focusState.focusSeconds;
    const isLast = focusState.cycle >= focusState.totalCycles - 1;

    if (isLast) {
      // All cycles done.
      const finished = { ...publicState(), active: false, paused: false, remainingSeconds: 0 };
      stopFocusSession();
      if (onCompleteCallback) onCompleteCallback(finished);
      return;
    }

    // Long break occurs on a repeatable mid/4-cycle cadence before the final cycle.
    const longBreakCadence = focusState.totalCycles >= 4
      ? Math.min(4, Math.max(2, Math.floor(focusState.totalCycles / 2)))
      : 0;
    const isLongBreak = longBreakCadence > 0 && (focusState.completedCycles % longBreakCadence === 0);
    if (isLongBreak) {
      focusState.inLongBreak = true;
      focusState.remainingSeconds = focusState.longBreakSeconds;
      focusState.totalSeconds = focusState.longBreakSeconds;
      if (onPhaseCallback) onPhaseCallback('longbreak', publicState());
    } else {
      focusState.inBreak = true;
      focusState.remainingSeconds = focusState.breakSeconds;
      focusState.totalSeconds = focusState.breakSeconds;
      if (onPhaseCallback) onPhaseCallback('break', publicState());
    }
  }
}

function pauseFocusSession() {
  focusState.paused = true;
  return publicState();
}

function resumeFocusSession() {
  focusState.paused = false;
  return publicState();
}

function stopFocusSession() {
  if (focusInterval) { clearInterval(focusInterval); focusInterval = null; }
  const wasActive = focusState.active;
  focusState.active = false;
  focusState.paused = false;
  focusState.remainingSeconds = 0;
  return { wasActive, completedCycles: focusState.completedCycles, totalFocusTime: focusState.totalFocusTime };
}

function getFocusState() {
  return publicState();
}

function onTick(cb) { onTickCallback = cb; }
function onPhase(cb) { onPhaseCallback = cb; }
function onComplete(cb) { onCompleteCallback = cb; }

// Get daily focus stats.
function getFocusStats() {
  return {
    completedCycles: focusState.completedCycles,
    totalFocusTime: focusState.totalFocusTime,
    active: focusState.active
  };
}

module.exports = {
  startFocusSession,
  pauseFocusSession,
  resumeFocusSession,
  stopFocusSession,
  getFocusState,
  getFocusStats,
  onTick,
  onPhase,
  onComplete,
  PRESETS
};
