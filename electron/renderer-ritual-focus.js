// Renderer: ritual overlay, focus sessions, sleep debt, and override.
// Loaded before renderer.js; event handlers use its shared state and elements.
const RITUAL_ICONS = {
  block: 'block', dim: 'moon',
  timer: 'clock', lights: 'lamp'
};
const RITUAL_DESCS = {
  block: 'Blocking distracting websites and apps.',
  dim: 'Dimming your environment for sleep.',
  timer: 'Starting your wind-down countdown.',
  lights: 'Setting lights to night mode.'
};

function showRitualOverlay(state) {
  if (!els.ritualOverlay) return;
  els.ritualOverlay.style.display = '';
  els.ritualOverlay.classList.add('active');
  els.ritualOverlay.setAttribute('aria-hidden', 'false');
  updateRitualOverlay(state);
}

function updateRitualOverlay(state) {
  if (!els.ritualOverlay || !state) return;
  const step = state.currentStepInfo;
  if (!step) { hideRitualOverlay(); return; }

  // Main-process ritual steps can arrive without the manual Begin Ritual
  // button path (for example, Use Tonight with a standard Night Mode). Make
  // every active step establish the same visible modal lifecycle.
  els.ritualOverlay.style.display = '';
  els.ritualOverlay.classList.add('active');
  els.ritualOverlay.setAttribute('aria-hidden', 'false');

  const glyphName = Object.prototype.hasOwnProperty.call(RITUAL_ICONS, step.id) ? RITUAL_ICONS[step.id] : 'moon';
  // typeof-guarded: the ritual lifecycle tests load this file without
  // renderer-utils.js.
  if (typeof loGlyph === 'function') els.ritualStepIcon.innerHTML = loGlyph(glyphName, 'ritual-step-glyph');
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
  if (!els.ritualOverlay) return;
  els.ritualOverlay.classList.remove('active');
  els.ritualOverlay.style.display = 'none';
  els.ritualOverlay.setAttribute('aria-hidden', 'true');
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

// Load the timer-derived bedtime-deficit estimate on init.
async function loadSleepDebt() {
  try {
    const debt = await api.getSleepDebt?.();
    if (debt) renderSleepDebt(debt);
  } catch (e) {
    console.error('Failed to load estimated bedtime deficit:', e);
  }
}

function renderSleepDebt(debt) {
  if (!debt) return;
  const label = debt.netDebt <= 0 ? 'No estimated deficit' :
    debt.netDebt <= 2 ? 'Small estimate' :
    debt.netDebt <= 5 ? 'Moderate estimate' : 'Large estimate';
  // Grammar: no deficit reads teal (steady); any estimated deficit reads
  // amber (attention), never red -- it is an estimate, not a failure.
  const colors = { 'No estimated deficit': 'var(--pf-teal)', 'Small estimate': 'var(--accent-amber)', 'Moderate estimate': 'var(--accent-amber)', 'Large estimate': 'var(--accent-amber)' };
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
          <div style="width:${barW}%;height:100%;background:${isDebt ? 'var(--accent-amber)' : 'var(--pf-teal)'};border-radius:2px"></div>
        </div>
        <span style="width:36px;color:${isDebt ? 'var(--accent-amber)' : 'var(--pf-teal)'}">${isDebt ? '-' : '+'}${isDebt ? d.debt?.toFixed(1) : d.surplus?.toFixed(1)}h</span>
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
/* exported showRitualOverlay, renderFocusSession, loadSleepDebt, showOverrideModal, hideOverrideModal */
