// Renderer: Wake-up Alarm (First Light) and Last Light finale (custom
// sequence builder, playback, timer-recovery banner). Loaded as a classic
// sibling <script>, after the seven existing shards and before renderer.js.
//
// None of these 9 functions were nested inside wireEvents() -- verified via
// typeof at global scope before extracting. `lastLightTimers` was a
// module-level `let` used only by clearLastLightTimers/playLastLight (both
// here); hoisted alongside them, same pattern as calEvents/wifiSelectedDevices
// in earlier slices. Two top-level wiring blocks that sat between these
// functions in the original file (northstar PLAY-button alias, sidebar tab
// persistence, timer-name input persistence) are unrelated core UI wiring,
// not Last-Light-specific, and stay in renderer.js untouched.
function setupAlarmHandlers() {
  els.chkAlarm?.addEventListener('change', () => {
    if (els.alarmConfig) els.alarmConfig.style.display = els.chkAlarm.checked ? 'block' : 'none';
  });

  els.btnSetAlarm?.addEventListener('click', async () => {
    const time = els.alarmTime?.value;
    if (!time) return;
    const result = await api.scheduleWakeAlarm(time);
    if (result.success) {
      notify(`First Light set for ${time}`, 'success');
      refreshAlarmStatus();
    } else {
      notify(`Alarm failed: ${result.error}`, 'error');
    }
  });

  els.btnRemoveAlarm?.addEventListener('click', async () => {
    await api.removeWakeAlarm();
    notify('First Light removed', 'info');
    refreshAlarmStatus();
  });

  // Sunrise alarm visual feedback.
  api.onFirstLightStarted?.(() => {
    notify('First Light rising', 'success');
    document.body.classList.add('first-light-rising');
  });
  api.onFirstLightTick?.((data) => {
    // Gradually warm the UI during First Light.
    const warmth = Math.round(data.progress * 20);
    document.body.style.filter = `sepia(${warmth}%) brightness(${0.6 + data.progress * 0.4})`;
  });
  api.onFirstLightEnded?.(() => {
    document.body.classList.remove('first-light-rising');
    document.body.style.filter = '';
    notify('First Light complete. Good morning.', 'success', 5000);
  });

  refreshAlarmStatus();
}

// "HH:MM" (24h, as stored by <input type="time">) -> "7:30 AM". Falls back
// to the raw string if it isn't in that shape, so it never fabricates a time.
function formatClockTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return hhmm || 'scheduled';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${suffix}`;
}

async function refreshAlarmStatus() {
  try {
    const status = await api.getWakeAlarmStatus();
    if (els.alarmStatus) {
      if (status.active) {
        els.alarmStatus.textContent = `First Light at ${status.alarmTime || 'scheduled'}`;
        els.alarmStatus.style.color = 'var(--accent-green)';
      } else {
        els.alarmStatus.textContent = 'No First Light scheduled';
        els.alarmStatus.style.color = 'var(--text-muted)';
      }
    }
    // Drive the Tonight's Automation summary from the same real status, so
    // First Light is discoverable outside Settings.
    const summaryText = status.active ? `First Light at ${status.alarmTime || 'scheduled'}` : 'Not set';
    if (els.taAlarmStatus) els.taAlarmStatus.textContent = summaryText;

    // Schedule > Automations: a real First Light feature card instead of a
    // buried settings line.
    if (els.firstlightHeroState) {
      els.firstlightHeroState.textContent = status.active
        ? formatClockTime(status.alarmTime)
        : 'No morning alarm set';
    }
    if (els.firstlightHeroSub) {
      els.firstlightHeroSub.textContent = status.active
        ? 'Morning alarm ready.'
        : 'Set a morning wake alarm for tomorrow.';
    }
    if (els.firstlightHeroBtn) {
      els.firstlightHeroBtn.textContent = status.active ? 'Edit' : 'Set First Light';
    }

    // Schedule header "Next tonight" summary.
    if (els.schNextFirstlight) {
      els.schNextFirstlight.textContent = status.active
        ? `First Light: ${formatClockTime(status.alarmTime)}`
        : 'First Light: not set';
    }
  } catch {}
}

function updateLastLightUIFromState() {
  if (els.chkLastLight) els.chkLastLight.checked = state.lastLight.enabled;
  if (els.selLastLightSequence) els.selLastLightSequence.value = state.lastLight.sequence;
  if (els.selLastLightSound) els.selLastLightSound.value = state.lastLight.sound;
  if (els.lastLightConfig) els.lastLightConfig.style.display = state.lastLight.enabled ? 'block' : 'none';
}

function setupLastLightHandlers() {
  els.chkLastLight?.addEventListener('change', () => {
    if (els.lastLightConfig) els.lastLightConfig.style.display = els.chkLastLight.checked ? 'block' : 'none';
  });
  els.btnPreviewLastLight?.addEventListener('click', () => {
    playLastLight({
      sequence: els.selLastLightSequence?.value || 'ClassicFade',
      sound: els.selLastLightSound?.value || 'Off',
      dryRun: true
    });
  });

  // Custom sequence builder.
  els.btnAddCustomSeq?.addEventListener('click', () => {
    if (els.customSeqBuilder) els.customSeqBuilder.style.display = 'block';
    if (els.customSeqName) els.customSeqName.value = '';
    if (els.customSeqSteps) {
      els.customSeqSteps.innerHTML = makeStepRow();
    }
  });
  els.btnCancelCustomSeq?.addEventListener('click', () => {
    if (els.customSeqBuilder) els.customSeqBuilder.style.display = 'none';
  });
  els.btnAddStep?.addEventListener('click', () => {
    if (els.customSeqSteps) els.customSeqSteps.insertAdjacentHTML('beforeend', makeStepRow());
  });
  els.btnSaveCustomSeq?.addEventListener('click', async () => {
    const name = els.customSeqName?.value?.trim();
    if (!name) return;
    const rows = els.customSeqSteps?.querySelectorAll('.seq-step-row') || [];
    const steps = [];
    rows.forEach(row => {
      const headline = row.querySelector('.seq-headline')?.value?.trim() || '';
      const line = row.querySelector('.seq-line')?.value?.trim() || '';
      const dwellMs = parseInt(row.querySelector('.seq-dwell')?.value) || 1500;
      if (line || headline) steps.push({ headline, line, dwellMs });
    });
    if (!steps.length) return;
    const entry = await api.addCustomSequence({ name, steps });
    if (entry) {
      if (els.customSeqBuilder) els.customSeqBuilder.style.display = 'none';
      renderCustomSequences();
      // Add to sequence selector.
      const opt = document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.name + ' *';
      els.selLastLightSequence?.appendChild(opt);
    }
  });
}

function makeStepRow() {
  return `<div class="seq-step-row">
    <input type="text" placeholder="Headline" class="seq-headline" maxlength="40">
    <input type="text" placeholder="Line" class="seq-line" maxlength="80">
    <input type="number" placeholder="ms" class="seq-dwell" value="1500" min="200" max="5000" style="width:60px">
  </div>`;
}

async function renderCustomSequences() {
  if (!els.customSeqList) return;
  const LL = (typeof window !== 'undefined' && window.LastLight) ? window.LastLight : null;
  let customs = [];
  if (LL?.getCustomSequences) customs = LL.getCustomSequences();
  // In Electron mode, the catalog from IPC includes custom entries.
  // For preview mode, just use what's in the LL module.
  if (!customs.length && api.getStreaks) {
    // Try loading from settings via app-settings.
    try {
      const settings = await api.getAppSettings();
      customs = settings?.lastLight?.customSequences || [];
    } catch (e) {
      console.error('Failed to load custom sequences from settings:', e);
    }
  }
  els.customSeqList.innerHTML = customs.length
    ? customs.map(s => `<div class="custom-seq-item">
        <span class="seq-item-name">${escapeHtml(s.name)}</span>
        <button class="seq-item-share" data-id="${escapeHtml(s.id)}" title="Share (copy JSON)">&#x1F517;</button>
        <button class="seq-item-delete" data-id="${escapeHtml(s.id)}" title="Delete">&times;</button>
      </div>`).join('')
    : '<span style="color:var(--text-muted);font-size:11px">No custom sequences yet.</span>';
  els.customSeqList.querySelectorAll('.seq-item-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.removeCustomSequence(btn.dataset.id);
      const opt = els.selLastLightSequence?.querySelector(`option[value="${btn.dataset.id}"]`);
      if (opt) opt.remove();
      renderCustomSequences();
    });
  });
  els.customSeqList.querySelectorAll('.seq-item-share').forEach(btn => {
    btn.addEventListener('click', () => {
      const seq = customs.find(s => s.id === btn.dataset.id);
      if (!seq) return;
      const json = JSON.stringify({ lightsOutSequence: seq }, null, 2);
      navigator.clipboard.writeText(json).then(() => {
        notify('Sequence JSON copied to clipboard', 'success');
      }).catch(() => {
        // Fallback: open a small text area.
        notify('Copy failed - check console', 'warning');
        console.log(json);
      });
    });
  });
}

let lastLightTimers = [];

function clearLastLightTimers() {
  lastLightTimers.forEach(t => {
    if (t && t._interval) clearInterval(t._interval);
    else clearTimeout(t);
  });
  lastLightTimers = [];
}

function playLastLight(payload) {
  const LL = (typeof window !== 'undefined' && window.LastLight) ? window.LastLight : null;
  if (!LL || !els.lastLightOverlay) return;

  const sequence = LL.normalizeId(payload && payload.sequence);
  const dryRun = Boolean(payload && payload.dryRun);
  const soundMode = LL.normalizeSoundId(payload && payload.sound);
  const steps = LL.getSteps(sequence, dryRun);
  const meta = LL.getMeta(sequence, dryRun);
  const totalMs = steps.reduce((s, st) => s + Number(st.dwellMs || 0), 0);
  const CIRCUMFERENCE = 503; // 2π × r(80)

  clearLastLightTimers();

  // Reset northstar ring + UNPLUG
  if (els.llRingArc) els.llRingArc.style.strokeDashoffset = '0';
  if (els.llRingTime) els.llRingTime.textContent = '—';
  if (els.llFavorBarFill) els.llFavorBarFill.style.width = '0%';
  if (els.llUnplugBtn) els.llUnplugBtn.style.display = 'none';
  if (els.llUnplugSub) els.llUnplugSub.style.display = 'none';

  els.llTitle.textContent = meta.sequenceLabel || meta.cinematicTitle;
  els.lastLightOverlay.classList.add('active');
  els.lastLightOverlay.setAttribute('aria-hidden', 'false');

  // Countdown ring ticker (1-second intervals)
  let llRingInterval = null;
  if (totalMs > 0 && els.llRingArc && els.llRingTime) {
    const totalSec = Math.ceil(totalMs / 1000);
    let secLeft = totalSec;
    function fmtSec(s) {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }
    els.llRingTime.textContent = fmtSec(secLeft);
    llRingInterval = setInterval(() => {
      secLeft = Math.max(0, secLeft - 1);
      els.llRingTime.textContent = fmtSec(secLeft);
      const progress = secLeft / totalSec;
      els.llRingArc.style.strokeDashoffset = String(CIRCUMFERENCE * progress);
      if (els.llFavorBarFill) els.llFavorBarFill.style.width = String((1 - progress) * 100) + '%';
      if (secLeft === 0) clearInterval(llRingInterval);
    }, 1000);
    lastLightTimers.push({ _interval: llRingInterval });
  }

  let elapsed = 0;
  steps.forEach(step => {
    lastLightTimers.push(setTimeout(() => {
      els.llHeadline.textContent = step.headline || '';
      els.llLine.textContent = step.line || '';
      els.llStamp.textContent = '';
      if (soundMode === 'Soft') {
        SoundSystem.playTone(880, 0.08, 'sine', 0.1);
        setTimeout(() => SoundSystem.playTone(660, 0.12, 'sine', 0.08), 120);
      }
    }, elapsed));
    elapsed += Number(step.dwellMs || 0);
  });

  // Final stamp + show UNPLUG
  lastLightTimers.push(setTimeout(() => {
    els.llStamp.textContent = meta.stampLine || '';
    if (els.llUnplugBtn) els.llUnplugBtn.style.display = '';
    if (els.llUnplugSub) els.llUnplugSub.style.display = '';
  }, Math.max(0, elapsed - 600)));

  lastLightTimers.push(setTimeout(() => {
    if (llRingInterval) clearInterval(llRingInterval);
    els.lastLightOverlay.classList.remove('active');
    els.lastLightOverlay.setAttribute('aria-hidden', 'true');
    if (els.llUnplugBtn) els.llUnplugBtn.style.display = 'none';
    if (els.llUnplugSub) els.llUnplugSub.style.display = 'none';
  }, elapsed + 250));
}

function promptTimerRecovery(snapshot) {
  const mins = Math.ceil((snapshot.remainingSeconds || 0) / 60);
  const label = `${actionLabel(snapshot.action)} timer was interrupted with ~${mins}m left.`;
  const banner = document.createElement('div');
  banner.className = 'recovery-banner';
  banner.innerHTML = `
    <span class="recovery-text">${escapeHtml(label)}</span>
    <button class="recovery-btn resume">Resume</button>
    <button class="recovery-btn dismiss">Dismiss</button>
  `;
  banner.querySelector('.resume').addEventListener('click', async () => {
    const res = await api.resumeRecoverableTimer();
    if (res?.success) notify('Timer resumed', 'success');
    banner.remove();
  });
  banner.querySelector('.dismiss').addEventListener('click', async () => {
    await api.discardRecoverableTimer();
    banner.remove();
  });
  document.body.appendChild(banner);
}
/* exported setupAlarmHandlers, updateLastLightUIFromState, setupLastLightHandlers, promptTimerRecovery */
