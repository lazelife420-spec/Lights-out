// Renderer: Updater status display and the first-run Onboarding wizard.
// Loaded as a classic sibling <script>, after the nine existing shards and
// before renderer.js.
//
// None of these 8 functions were nested inside wireEvents() -- verified via
// typeof at global scope before extracting. `onboardStep`/`onboardData` were
// module-level `let`s used only by the onboarding functions (all here);
// hoisted alongside them, same pattern as lastLightTimers/wifiSelectedDevices
// in earlier slices.
//
// IMPORTANT: the bootstrap sequence (wireEvents(); ...; loadInitialData()...;
// refreshStreakCallout(); checkOnboarding();) sits physically *between* the
// updater group and the onboarding group in the original file, and stays in
// renderer.js untouched -- it's the app's kickoff code and must run only
// after every shard (including this one) has finished loading. The bare
// `els.btnCheckUpdate?.addEventListener('click', runUpdateCheck);` wiring
// statement also stays in renderer.js for the same reason (it needs `els`,
// declared there, to already exist).
function renderUpdaterStatus(result) {
  if (!els.updaterStatus || !els.updaterStatusText) return;
  const dl = els.updaterDownload;
  if (dl) { dl.style.display = 'none'; dl.onclick = null; }

  let state = 'idle';
  let text = 'Check for the latest version';

  if (result === 'checking') {
    state = 'checking';
    text = 'Checking for updates...';
  } else if (result && result.error) {
    state = 'error';
    text = "Couldn't check for updates";
  } else if (result && result.available) {
    state = 'available';
    text = `Update available: v${result.latestVersion}`;
    if (dl) {
      const url = result.downloadUrl || result.releaseUrl;
      dl.style.display = url ? '' : 'none';
      dl.onclick = (e) => { e.preventDefault(); if (url) api.openExternal?.(url); };
    }
  } else if (result && result.available === false) {
    state = 'uptodate';
    text = result.currentVersion ? `You're on the latest version (v${result.currentVersion})` : "You're on the latest version";
  }

  els.updaterStatus.dataset.state = state;
  els.updaterStatusText.textContent = text;
}

async function runUpdateCheck() {
  if (els.btnCheckUpdate) els.btnCheckUpdate.disabled = true;
  renderUpdaterStatus('checking');
  try {
    const result = await api.checkForUpdate?.();
    renderUpdaterStatus(result || { available: false });
  } catch (err) {
    renderUpdaterStatus({ error: err?.message || String(err) });
  } finally {
    if (els.btnCheckUpdate) els.btnCheckUpdate.disabled = false;
  }
}

// Show the last known result (no network) when About opens; never block on it.
async function refreshUpdaterStatus() {
  try {
    const last = await api.getUpdateStatus?.();
    renderUpdaterStatus(last || null);
  } catch {
    renderUpdaterStatus(null);
  }
}

let onboardStep = 1;
let onboardData = { bedtime: null, focus: null, sequence: null, sound: true };

function showOnboarding() {
  if (!els.onboarding) return;
  els.onboarding.style.display = 'flex';
}

function hideOnboarding() {
  if (!els.onboarding) return;
  els.onboarding.style.display = 'none';
  // Persist onboarded flag.
  const app = { onboarded: true };
  if (onboardData.bedtime) app.bedtime = onboardData.bedtime;
  if (onboardData.focus) app.focusBlocklist = onboardData.focus.split(',').map(s => s.trim()).filter(Boolean);
  api.saveAppSettings({ app });
  // Apply selected ritual.
  if (onboardData.sequence) {
    const custom = { lastLightEnabled: true, lastLightSequence: onboardData.sequence, lastLightSound: onboardData.sound ? 'Soft' : 'Off' };
    api.saveAppSettings({ lastLight: custom });
    state.lastLight.enabled = true;
    state.lastLight.sequence = onboardData.sequence;
    state.lastLight.sound = onboardData.sound ? 'Soft' : 'Off';
    updateLastLightUIFromState();
  }
  // Apply soundscape.
  if (onboardData.sound) {
    state.customization.soundscape = 'rain';
    api.saveAppSettings({ customization: { soundscape: 'rain' } });
  }
  // Set timer from bedtime if not already running.
  if (onboardData.bedtime && !state.running) {
    const [h, m] = onboardData.bedtime.split(':').map(Number);
    const now = new Date();
    let target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const diffSec = Math.round((target - now) / 1000);
    if (diffSec > 60 && diffSec < 24 * 3600) {
      state.remainingSeconds = diffSec;
      state.totalSeconds = diffSec;
      setInputFromSeconds(diffSec);
      render();
    }
  }
}

function updateOnboardingUI() {
  // Update step dots.
  document.querySelectorAll('.onboarding-step-dot').forEach(dot => {
    dot.classList.toggle('active', parseInt(dot.dataset.step) === onboardStep);
  });
  // Show/hide panels.
  document.querySelectorAll('.onboarding-panel').forEach(panel => panel.classList.remove('active'));
  const activePanel = document.getElementById(`onboard-step-${onboardStep}`);
  if (activePanel) activePanel.classList.add('active');
  // Back button visibility.
  if (els.onboardBack) els.onboardBack.style.visibility = onboardStep > 1 ? 'visible' : 'hidden';
  // Next button text.
  if (els.onboardNext) els.onboardNext.textContent = onboardStep >= 3 ? "Let's go" : 'Continue';
}

function setupOnboarding() {
  if (!els.onboarding) return;

  // Choice button clicks (step 1 & 2).
  document.querySelectorAll('.onboard-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.onboarding-choice-grid').querySelectorAll('.onboard-choice').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (btn.dataset.bed) onboardData.bedtime = btn.dataset.bed;
      if (btn.dataset.focus !== undefined) onboardData.focus = btn.dataset.focus;
    });
  });

  // Ritual button clicks (step 3).
  document.querySelectorAll('.onboard-ritual').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.onboard-ritual').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      onboardData.sequence = btn.dataset.seq;
    });
  });

  // Sound toggle.
  const soundToggle = document.getElementById('onboard-sound');
  if (soundToggle) {
    soundToggle.addEventListener('change', () => {
      onboardData.sound = soundToggle.checked;
    });
  }

  // Custom bedtime override.
  const customBed = document.getElementById('onboard-custom-bed');
  if (customBed) {
    customBed.addEventListener('change', () => {
      if (customBed.value) onboardData.bedtime = customBed.value;
    });
  }

  // Custom focus override.
  const customFocus = document.getElementById('onboard-custom-focus');
  if (customFocus) {
    customFocus.addEventListener('input', () => {
      if (customFocus.value.trim()) onboardData.focus = customFocus.value.trim();
    });
  }

  // Nav buttons.
  els.onboardBack?.addEventListener('click', () => {
    if (onboardStep > 1) { onboardStep--; updateOnboardingUI(); }
  });

  els.onboardNext?.addEventListener('click', () => {
    if (onboardStep < 3) {
      onboardStep++;
      updateOnboardingUI();
    } else {
      hideOnboarding();
    }
  });

  updateOnboardingUI();
}

// Check if onboarding should show.
async function checkOnboarding() {
  try {
    const settings = await api.getAppSettings();
    if (!settings?.app?.onboarded) {
      showOnboarding();
      setupOnboarding();
    }
  } catch {
    // If settings can't load, skip onboarding.
  }
}
