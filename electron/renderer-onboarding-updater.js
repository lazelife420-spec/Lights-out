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
// About and Settings › General show one updater line (separate ids, same
// result). The download link lives in About only, so General points there.
function writeUpdaterLine(stateName, text, generalText = text) {
  if (els.updaterStatus) els.updaterStatus.dataset.state = stateName;
  if (els.updaterStatusText) els.updaterStatusText.textContent = text;
  if (els.setUpdaterStatus) els.setUpdaterStatus.dataset.state = stateName;
  if (els.setUpdaterStatusText) els.setUpdaterStatusText.textContent = generalText;
}

function renderUpdaterStatus(result) {
  if (!els.updaterStatusText && !els.setUpdaterStatusText) return;
  const dl = els.updaterDownload;
  if (dl) { dl.style.display = 'none'; dl.onclick = null; dl.textContent = 'Download verified ZIP'; }

  let state = 'idle';
  let text = 'Check for the latest version';

  if (result === 'checking') {
    state = 'checking';
    text = 'Checking for updates...';
  } else if (result && result.error) {
    state = 'error';
    text = result.code ? `Couldn't check for updates (${result.code})` : "Couldn't check for updates";
  } else if (result && result.available) {
    state = 'available';
    text = `Update available: v${result.latestVersion}`;
    if (dl) {
      dl.style.display = result.distribution === 'portable-zip' && result.downloadUrl ? '' : 'none';
      dl.onclick = async (e) => {
        e.preventDefault();
        dl.style.pointerEvents = 'none';
        writeUpdaterLine('checking', 'Downloading and verifying portable ZIP...');
        const downloaded = await api.downloadPortableUpdate?.();
        dl.style.pointerEvents = '';
        if (downloaded?.success) {
          writeUpdaterLine('uptodate', 'Verified ZIP saved. Extract it to its own folder, close Lights Out, then run Lights Out.exe from the extracted folder.');
          dl.style.display = 'none';
        } else {
          writeUpdaterLine('error', `Update download failed (${downloaded?.code || 'UNKNOWN_ERROR'})`);
        }
      };
    }
  } else if (result && result.available === false) {
    state = 'uptodate';
    text = result.currentVersion ? `You're on the latest version (v${result.currentVersion})` : "You're on the latest version";
  }

  const downloadInAbout = Boolean(dl) && dl.style.display !== 'none';
  writeUpdaterLine(state, text, downloadInAbout ? `${text}. Download it from About.` : text);
}

async function runUpdateCheck() {
  // About and Settings › General run this same check; both buttons wait for it.
  const buttons = [els.btnCheckUpdate, els.setBtnCheckUpdate].filter(Boolean);
  buttons.forEach(btn => { btn.disabled = true; });
  renderUpdaterStatus('checking');
  try {
    const result = await api.checkForUpdate?.();
    renderUpdaterStatus(result || { available: false });
  } catch (err) {
    renderUpdaterStatus({ error: err?.message || String(err) });
  } finally {
    buttons.forEach(btn => { btn.disabled = false; });
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

// Overrides the static "v10.3.0" text baked into index.html with the real
// electron/package.json version. Leaves the static fallback in place (rather
// than writing "undefined") when the bridge is unavailable, e.g. offline/static preview.
async function applyAppVersion() {
  try {
    const version = await api.getAppVersion?.();
    if (!version) return;
    if (els.version) els.version.textContent = `v${version}`;
    // UI-R3 Fire 03: About shows the version once, as a chip.
    if (els.aboutVersion) els.aboutVersion.textContent = `v${version}`;
    if (els.setAppVersion) els.setAppVersion.textContent = `v${version}`;
  } catch { /* keep static fallback text */ }
}

let onboardStep = 1;
// runMode: 'test' | 'real' | null -- step 3 requires an explicit choice.
let onboardData = { bedtime: null, focus: null, sequence: null, runMode: null, sound: false };

function showOnboarding() {
  if (!els.onboarding) return;
  els.onboarding.style.display = 'flex';
}

function hideOnboarding() {
  if (!els.onboarding) return;
  els.onboarding.style.display = 'none';
  // Persist onboarded flag together with the explicit run-mode choice
  // (dryRun is an immediate-commit field, so it rides in the same save).
  const app = { onboarded: true };
  if (onboardData.runMode === 'test' || onboardData.runMode === 'real') app.dryRun = onboardData.runMode === 'test';
  if (onboardData.bedtime) app.bedtime = onboardData.bedtime;
  if (onboardData.focus) app.focusBlocklist = onboardData.focus.split(',').map(s => s.trim()).filter(Boolean);
  api.saveAppSettings({ app });
  if (typeof app.dryRun === 'boolean') {
    state.dryRun = app.dryRun;
    render();
  }
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

// What the REAL choice really does, in words that match the configured action.
function onboardRealActionSentence(action = state.action) {
  return {
    shutdown: 'This PC really shuts down.',
    restart: 'This PC really restarts.',
    sleep: 'This PC really goes to sleep.',
    hibernate: 'This PC really hibernates.',
    lock: 'This PC really locks.',
    logout: 'This PC really logs you out.'
  }[action] || `This PC really runs ${actionLabel(action)}.`;
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
  // Next button text. Step 3 cannot finish until a run mode is chosen.
  if (els.onboardNext) {
    els.onboardNext.textContent = onboardStep >= 3 ? "Let's go" : 'Continue';
    els.onboardNext.disabled = onboardStep >= 3 && !onboardData.runMode;
  }
  // The REAL choice names the action this PC will actually run.
  const realLabel = document.getElementById('onboard-mode-real-label');
  if (realLabel) realLabel.textContent = `Real: ${actionLabel()} when the timer ends`;
  const realSub = document.getElementById('onboard-mode-real-sub');
  if (realSub) realSub.textContent = onboardRealActionSentence();
  document.querySelectorAll('.onboard-mode-choice').forEach(btn => {
    const selected = btn.dataset.runMode === onboardData.runMode;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-pressed', String(selected));
  });
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

  // Run mode (step 3): an explicit Test Mode / Real choice, neither preselected.
  document.querySelectorAll('.onboard-mode-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.runMode;
      if (mode !== 'test' && mode !== 'real') return;
      onboardData.runMode = mode;
      updateOnboardingUI();
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
    } else if (onboardData.runMode) {
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
/* exported runUpdateCheck, refreshUpdaterStatus, applyAppVersion, checkOnboarding */
