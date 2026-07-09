// Renderer: Ritual Mode overlay, Guided Breathing (4-7-8), Focus Sessions,
// Sleep Debt, and Emergency Override modal. Loaded as a classic sibling
// <script>, after the five existing shards and before renderer.js.
//
// SCOPE CHANGE, same pattern as renderer-receipts.js / renderer-family-remote.js:
// all 10 functions here were nested inside wireEvents() in renderer.js.
// Verified via wireEvents.toString() before touching anything (same
// ground-truth technique that caught the setupRemoteControlHandlers bug in
// the previous slice). Their bootstrap-adjacent call sites
// (startGuidedBreathing from an api.onPlayLastLight callback, showOverrideModal
// from an addEventListener callback) are both deferred event/IPC callbacks,
// not synchronous top-level bootstrap statements, so unlike the previous
// slice this extraction is a straightforward scope hoist with no additional
// "throws on every launch" bug attached.
//
// RITUAL_ICONS/RITUAL_DESCS/BREATHING_PHASES/BREATHING_CYCLES/breathingActive/
// breathingTimer were also wireEvents()-local; hoisted here alongside the
// functions that use them (updateRitualOverlay reads the first two;
// startGuidedBreathing/stopGuidedBreathing read and mutate the rest).
const RITUAL_ICONS = {
  breathe: '\u{1F4A8}', block: '\u{1F6AB}', dim: '\u{1F319}',
  timer: '\u{23F0}', lights: '\u{1F4A1}'
};
const RITUAL_DESCS = {
  breathe: 'Take a moment to breathe deeply and relax.',
  block: 'Blocking distracting websites and apps.',
  dim: 'Dimming your environment for sleep.',
  timer: 'Starting your wind-down countdown.',
  lights: 'Setting lights to night mode.'
};

function showRitualOverlay(state) {
  if (!els.ritualOverlay) return;
  els.ritualOverlay.style.display = '';
  updateRitualOverlay(state);
}

function updateRitualOverlay(state) {
  if (!els.ritualOverlay || !state) return;
  const step = state.currentStepInfo;
  if (!step) { hideRitualOverlay(); return; }

  els.ritualStepIcon.textContent = RITUAL_ICONS[step.id] || '\u{1F319}';
  els.ritualStepTitle.textContent = step.label;
  els.ritualStepDesc.textContent = RITUAL_DESCS[step.id] || '';
  els.btnRitualSkip.style.display = step.skippable ? '' : 'none';
  els.btnRitualNext.textContent = step.auto ? 'Done' : 'Next';

  // Progress dots.
  if (els.ritualProgress) {
    els.ritualProgress.innerHTML = Array.from({ length: state.totalSteps }, (_, i) => {
      const done = i < state.currentStep;
      const active = i === state.currentStep;
      return `<span style="width:8px;height:8px;border-radius:50%;background:${done ? 'var(--accent)' : active ? '#fff' : 'var(--bg-card)'};border:1px solid ${active ? 'var(--accent)' : 'transparent'}"></span>`;
    }).join('');
  }
}

function hideRitualOverlay() {
  if (els.ritualOverlay) els.ritualOverlay.style.display = 'none';
}

const BREATHING_PHASES = [
  { name: 'Inhale', duration: 4 },
  { name: 'Hold', duration: 7 },
  { name: 'Exhale', duration: 8 }
];
const BREATHING_CYCLES = 4;
let breathingActive = false;
let breathingTimer = null;

function startGuidedBreathing() {
  if (breathingActive) return;
  breathingActive = true;
  let cycle = 0;
  let phaseIdx = 0;
  let count = BREATHING_PHASES[0].duration;

  function tick() {
    if (!breathingActive) return;
    const phase = BREATHING_PHASES[phaseIdx];

    if (els.breathingOverlay) els.breathingOverlay.classList.add('active');
    if (els.breathingLabel) els.breathingLabel.textContent = phase.name;
    if (els.breathingCount) els.breathingCount.textContent = count;
    if (els.breathingInstruction) els.breathingInstruction.textContent = phase.name.toUpperCase();
    if (els.breathingCycles) els.breathingCycles.textContent = `Cycle ${cycle + 1} of ${BREATHING_CYCLES}`;

    // Animate the breathing circle.
    if (els.breathingCircle) {
      els.breathingCircle.classList.remove('inhale', 'hold', 'exhale');
      if (phase.name === 'Inhale') els.breathingCircle.classList.add('inhale');
      else if (phase.name === 'Hold') els.breathingCircle.classList.add('hold');
      else els.breathingCircle.classList.add('exhale');
    }

    count--;
    if (count < 0) {
      phaseIdx++;
      if (phaseIdx >= BREATHING_PHASES.length) {
        phaseIdx = 0;
        cycle++;
        if (cycle >= BREATHING_CYCLES) {
          if (typeof stopGuidedBreathing === 'function') stopGuidedBreathing();
          return;
        }
      }
      count = BREATHING_PHASES[phaseIdx].duration;
    }
    breathingTimer = setTimeout(tick, 1000);
  }
  tick();
}

function stopGuidedBreathing() {
  breathingActive = false;
  if (breathingTimer) { clearTimeout(breathingTimer); breathingTimer = null; }
  if (els.breathingOverlay) els.breathingOverlay.classList.remove('active');
  if (els.breathingCircle) els.breathingCircle.classList.remove('inhale', 'hold', 'exhale');
}

function renderFocusSession(fs) {
  if (!fs || !els.focusActive) return;
  els.focusActive.style.display = '';
  const min = Math.floor(fs.remainingSeconds / 60);
  const sec = fs.remainingSeconds % 60;
  if (els.focusRemaining) els.focusRemaining.textContent = `${min}:${String(sec).padStart(2, '0')}`;
  const phaseLabels = { focus: 'Focus', break: 'Break', longbreak: 'Long Break' };
  if (els.focusPhaseLabel) els.focusPhaseLabel.textContent = phaseLabels[fs.inBreak ? 'break' : fs.inLongBreak ? 'longbreak' : 'focus'];

  // Cycle dots.
  if (els.focusCycleDots) {
    const dots = [];
    for (let i = 0; i < fs.totalCycles; i++) {
      const done = i < fs.completedCycles;
      const active = i === fs.cycle && !fs.inBreak && !fs.inLongBreak;
      dots.push(`<span class="cycle-dot${done ? ' done' : ''}${active ? ' active' : ''}">${done ? '✓' : '○'}</span>`);
    }
    els.focusCycleDots.innerHTML = dots.join('');
  }

  // Ring color by phase.
  if (els.focusRing) {
    els.focusRing.classList.remove('focus-phase', 'break-phase');
    if (fs.inBreak || fs.inLongBreak) els.focusRing.classList.add('break-phase');
    else els.focusRing.classList.add('focus-phase');
  }
}

// Load sleep debt on init.
async function loadSleepDebt() {
  try {
    const debt = await api.getSleepDebt?.();
    if (debt) renderSleepDebt(debt);
  } catch (e) {
    console.error('Failed to load sleep debt:', e);
  }
}

function renderSleepDebt(debt) {
  if (!debt) return;
  const label = debt.netDebt <= 0 ? 'Sleep Rich' :
    debt.netDebt <= 2 ? 'Slight Deficit' :
    debt.netDebt <= 5 ? 'In Debt' :
    debt.netDebt <= 10 ? 'Deep Debt' : 'Critical';
  const colors = { 'Sleep Rich': '#4caf50', 'Slight Deficit': '#8bc34a', 'In Debt': '#ff9800', 'Deep Debt': '#ff5722', 'Critical': '#ff4d4d' };
  if (els.debtAmount) {
    els.debtAmount.textContent = `${debt.netDebt > 0 ? '+' : ''}${debt.netDebt}h`;
    els.debtAmount.style.color = colors[label] || 'var(--text-primary)';
  }
  if (els.debtLabel) els.debtLabel.textContent = label;
  if (els.debtWeek) {
    const days = debt.dailyLog || [];
    els.debtWeek.innerHTML = days.length ? days.map(d => {
      const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'short' });
      const barW = Math.min(100, Math.abs(d.debt || d.surplus || 0) / debt.targetHours * 100);
      const isDebt = (d.debt || 0) > 0;
      return `<div class="debt-day" style="display:flex;align-items:center;gap:4px;font-size:10px">
        <span style="width:28px;color:var(--text-muted)">${dayLabel}</span>
        <div style="flex:1;height:4px;background:var(--bg-card);border-radius:2px;overflow:hidden">
          <div style="width:${barW}%;height:100%;background:${isDebt ? '#ff9800' : '#4caf50'};border-radius:2px"></div>
        </div>
        <span style="width:36px;color:${isDebt ? '#ff9800' : '#4caf50'}">${isDebt ? '-' : '+'}${isDebt ? d.debt?.toFixed(1) : d.surplus?.toFixed(1)}h</span>
      </div>`;
    }).join('') : '<p style="font-size:10px;color:var(--text-muted)">No data yet</p>';
  }
}

async function showOverrideModal() {
  try {
    const consequences = await api.getOverrideConsequences?.();
    if (!consequences || !consequences.consequences?.length) return;

    if (els.overrideConsequences) {
      els.overrideConsequences.innerHTML = consequences.consequences.map(c => `
        <div class="override-consequence" style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--bg-card)">
          <span style="font-size:18px">${escapeHtml(c.icon)}</span>
          <div>
            <span style="font-size:12px;color:var(--text-primary)">${escapeHtml(c.message)}</span>
            <span style="font-size:9px;color:${c.severity === 'high' ? '#ff4d4d' : 'var(--text-muted)'};display:block;margin-top:2px">${escapeHtml(c.severity?.toUpperCase() || '')}</span>
          </div>
        </div>
      `).join('');
    }
    if (els.overrideModal) els.overrideModal.classList.add('active');
    if (els.overrideReasonInput) els.overrideReasonInput.value = '';
  } catch {}
}

function hideOverrideModal() {
  if (els.overrideModal) els.overrideModal.classList.remove('active');
}
