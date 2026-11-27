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
  // Once the timer step has run, leaving the ritual keeps that countdown
  // (main's ritualMode.onCancel restores only an idle run), so the button says
  // so instead of reading as a cancel of the whole bedtime.
  if (els.btnRitualCancel) {
    const countdownStarted = Array.isArray(state.completedSteps) && state.completedSteps.includes('timer');
    els.btnRitualCancel.textContent = countdownStarted ? 'End ritual · countdown keeps running' : 'Cancel ritual';
  }

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

// The deficit is estimated against a wake time and a target the user sets on
// the card itself; both persist at once through sleepDebt's own store.
function hydrateSleepDebtControls(debt) {
  const wake = document.getElementById('sleep-wake-time');
  const target = document.getElementById('sleep-target-hours');
  if (wake && debt && typeof debt.wakeTime === 'string' && document.activeElement !== wake) wake.value = debt.wakeTime;
  if (target && debt && Number.isFinite(Number(debt.targetHours)) && document.activeElement !== target) target.value = String(debt.targetHours);
  if (wake && !wake.dataset.bound) {
    wake.dataset.bound = '1';
    wake.addEventListener('change', async () => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(wake.value)) return;
      try {
        wake.value = await api.setWakeTime(wake.value);
        await loadSleepDebt();
      } catch (e) {
        if (typeof notify === 'function') notify(`Wake time was not saved: ${e?.message || e}`, 'warning');
      }
    });
  }
  if (target && !target.dataset.bound) {
    target.dataset.bound = '1';
    target.addEventListener('change', async () => {
      const hours = Number(target.value);
      if (!Number.isFinite(hours)) return;
      try {
        target.value = String(await api.setSleepTarget(hours));
        await loadSleepDebt();
      } catch (e) {
        if (typeof notify === 'function') notify(`Sleep target was not saved: ${e?.message || e}`, 'warning');
      }
    });
  }
}

// Load the timer-derived bedtime-deficit estimate on init.
async function loadSleepDebt() {
  try {
    const debt = await api.getSleepDebt?.();
    hydrateSleepDebtControls(debt);
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
      const targetHours = Number(debt.targetHours) > 0 ? Number(debt.targetHours) : 8;
      const debtVal = Number(d.debt) || 0;
      const surplusVal = Number(d.surplus) || 0;
      const barW = Math.min(100, Math.abs(debtVal || surplusVal) / targetHours * 100);
      const isDebt = debtVal > 0;
      return `<div class="debt-day" style="display:flex;align-items:center;gap:4px;font-size:10px">
        <span style="width:28px;color:var(--text-muted)">${escapeHtml(dayLabel)}</span>
        <div style="flex:1;height:4px;background:var(--bg-card);border-radius:2px;overflow:hidden">
          <div style="width:${barW.toFixed(1)}%;height:100%;background:${isDebt ? 'var(--accent-amber)' : 'var(--pf-teal)'};border-radius:2px"></div>
        </div>
        <span style="width:36px;color:${isDebt ? 'var(--accent-amber)' : 'var(--pf-teal)'}">${isDebt ? '-' : '+'}${(isDebt ? debtVal : surplusVal).toFixed(1)}h</span>
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
