// Renderer: Settings collect/apply (app settings, clock style, WiFi Guard,
// Content Blocker, Accountability), Customization panel, and the Warning
// modal (imminent-shutdown grace period). Loaded as a classic sibling
// <script>, after the six existing shards and before renderer.js.
//
// Unlike renderer-receipts.js/renderer-family-remote.js/renderer-ritual-focus.js,
// none of these 18 functions were nested inside wireEvents() -- verified via
// `typeof` at global scope before extracting (all already "function"). This
// is a straightforward top-level move, same risk profile as slices 1-3.
//
// Load-order requirement: must come after renderer-family-remote.js
// (collectWifiGuardSettings/applyWifiGuardSettings read/write the
// wifiSelectedDevices global declared there) and after renderer-ritual-focus.js
// (setupWarningHandlers calls showOverrideModal, declared there).
function collectAppSettings() {
  const blocklistStr = els.focusBlocklist?.value?.trim() || '';
  const focusBlocklist = blocklistStr ? blocklistStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  return {
    action: state.action,
    unit: state.unit,
    durationSeconds: state.remainingSeconds,
    sound: state.sound,
    gracefulClose: state.gracefulClose,
    forceShutdown: state.forceShutdown,
    muteSystem: state.muteSystem,
    graceMinutes: state.graceMinutes,
    dryRun: state.dryRun,
    focusBlocklist,
    nightLightOnDim: els.chkNightlightDim?.checked || false,
    pauseMediaOnDim: els.chkPauseMediaDim?.checked || false,
    lockoutOnDim: els.chkLockoutDim?.checked || false,
    // Clock prefs come from applied state (the source of truth), not raw control
    // values, so a save can never clobber restored prefs with stale UI defaults.
    clockMode: typeof state.clockMode === 'boolean' ? state.clockMode : (els.chkClockMode?.checked || false),
    clockFace: state.clockFace || els.czClockFace?.value || 'hybrid',
    clockStyle: state.clockStyle || els.czClockStyle?.value || 'modern',
    clockDial: state.clockDial || els.czClockDial?.value || 'bars',
    clockFormat: state.clockFormat || els.czClockFormat?.value || '24h',
    clockScale: Number.isFinite(Number(state.clockScale)) ? Number(state.clockScale) : Number(els.czClockScale?.value || 1),
    clockShowDate: Boolean(state.clockShowDate),
    clockHandColor: state.clockHandColor || els.czClockHands?.value || '#76c9ff',
    clockSeconds: state.clockSeconds !== false,
    clockSweep: state.clockSweep !== false,
    timerName: els.timerName?.textContent?.trim() || state.timerName || 'Last Call',
    nsActiveTab: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || 'lib',
    nsSelectedMode: document.querySelector('.ns-mode-card.selected')?.dataset?.nsMode || ''
  };
}

function applyAppSettings(app) {
  if (!app) return;
  if (app.action) state.action = app.action;
  if (app.unit) state.unit = app.unit;
  if (typeof app.sound === 'boolean') { state.sound = app.sound; SoundSystem.enabled = app.sound; }
  if (typeof app.gracefulClose === 'boolean') state.gracefulClose = app.gracefulClose;
  if (typeof app.forceShutdown === 'boolean') state.forceShutdown = app.forceShutdown;
  if (typeof app.muteSystem === 'boolean') state.muteSystem = app.muteSystem;
  if (Number.isFinite(Number(app.graceMinutes))) state.graceMinutes = Number(app.graceMinutes);
  if (typeof app.dryRun === 'boolean') state.dryRun = app.dryRun;
  if (Array.isArray(app.focusBlocklist)) {
    if (els.focusBlocklist) els.focusBlocklist.value = app.focusBlocklist.join(',');
  }
  if (Number.isFinite(Number(app.durationSeconds)) && Number(app.durationSeconds) > 0 && !state.running) {
    state.remainingSeconds = Number(app.durationSeconds);
    setInputFromSeconds(state.remainingSeconds);
  }
  setAction(state.action);
  // Restore persisted toggle states for new features.
  if (els.chkIdleDetect) els.chkIdleDetect.checked = !!app.idleDetectionEnabled;
  if (els.chkBedtimeReminder) els.chkBedtimeReminder.checked = app.bedtimeReminderEnabled !== false;
  if (els.chkCalendarAutostart) els.chkCalendarAutostart.checked = !!app.calendarAutoStart;
  if (els.chkNightlightDim) els.chkNightlightDim.checked = !!app.nightLightOnDim;
  if (els.chkPauseMediaDim) els.chkPauseMediaDim.checked = !!app.pauseMediaOnDim;
  if (els.chkLockoutDim) els.chkLockoutDim.checked = !!app.lockoutOnDim;
  if (els.chkClockMode) els.chkClockMode.checked = app.clockMode !== false;
  state.clockMode = app.clockMode !== false;
  if (state.clockMode) state._clockDismissedByProfile = false; // explicit re-enable clears dismissal
  state.clockFace = app.clockFace || 'hybrid';
  if (els.czClockFace) els.czClockFace.value = state.clockFace;
  state.clockStyle = app.clockStyle || 'modern';
  state.clockDial = app.clockDial || 'bars';
  state.clockFormat = app.clockFormat || '24h';
  state.clockScale = Number.isFinite(Number(app.clockScale)) ? clamp(Number(app.clockScale), 0.8, 1.35) : 1;
  state.clockShowDate = !!app.clockShowDate;
  state.clockHandColor = app.clockHandColor || '#76c9ff';
  state.clockSeconds = app.clockSeconds !== false;
  state.clockSweep = app.clockSweep !== false;
  if (els.czClockStyle) els.czClockStyle.value = state.clockStyle;
  if (els.czClockDial) els.czClockDial.value = state.clockDial;
  if (els.czClockFormat) els.czClockFormat.value = state.clockFormat;
  if (els.czClockScale) els.czClockScale.value = String(state.clockScale);
  if (els.czClockScaleVal) els.czClockScaleVal.textContent = `${Math.round(state.clockScale * 100)}%`;
  if (els.czClockHands) els.czClockHands.value = state.clockHandColor;
  if (els.czClockDate) els.czClockDate.checked = state.clockShowDate;
  if (els.czClockSeconds) els.czClockSeconds.checked = state.clockSeconds;
  if (els.czClockSweep) els.czClockSweep.checked = state.clockSweep;
  applyClockStyle();
  updateClockStyleVisibility();
  state.bedtime = app.bedtime || '';
  // Restore timer name.
  if (app.timerName && els.timerName) {
    els.timerName.textContent = app.timerName;
    state.timerName = app.timerName;
  }
  // Restore northstar sidebar tab.
  if (app.nsActiveTab) {
    document.querySelectorAll('.ns-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nsTab === app.nsActiveTab);
    });
  }
  // Restore northstar selected mode card.
  if (app.nsSelectedMode) {
    document.querySelectorAll('.ns-mode-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.nsMode === app.nsSelectedMode);
    });
  }
  render();
}

// Apply the clock style preset, hand color, and second-hand visibility to the analog SVG.
function applyClockStyle() {
  if (!els.analogClock) return;
  const style = state.clockStyle || 'modern';
  els.analogClock.classList.remove('style-modern', 'style-bold', 'style-minimal', 'style-neon', 'style-classic');
  els.analogClock.classList.add('style-' + style);
  els.analogClock.classList.toggle('hide-seconds', state.clockSeconds === false);
  els.analogClock.dataset.dial = resolveClockDial();
  els.analogClock.style.setProperty('--clock-hand-color', state.clockHandColor || '#76c9ff');
  const clockScale = String(clamp(Number(state.clockScale) || 1, 0.8, 1.35));
  els.analogClock.style.setProperty('--clock-scale', clockScale);
  els.timerDisplay?.style.setProperty('--clock-scale', clockScale);
  buildAnalogTicks();
  buildAnalogNumerals();
  buildAnalogArabic();
}

// Clock customization controls only apply to analog/hybrid faces; hide them for digital.
function updateClockStyleVisibility() {
  if (!els.clockStyleGroup) return;
  const showsAnalog = state.clockFace === 'analog' || state.clockFace === 'hybrid';
  els.clockStyleGroup.style.display = showsAnalog ? '' : 'none';
}

function collectWifiGuardSettings() {
  return {
    enabled: els.chkWifiGuard?.checked || false,
    provider: els.selWifiProvider?.value || 'firewall',
    routerIp: els.wifiRouterIp?.value || '',
    routerUser: els.wifiRouterUser?.value || 'admin',
    routerPass: els.wifiRouterPass?.value || '',
    deviceMacs: [...wifiSelectedDevices.macs],
    deviceIps: [...wifiSelectedDevices.ips],
    webhookUrl: els.wifiWebhookUrl?.value || '',
    webhookHeaders: {},
    blockOnDim: els.chkWifiBlockDim?.checked ?? true,
    unblockOnCancel: els.chkWifiUnblockCancel?.checked ?? true
  };
}

function collectContentBlockerSettings() {
  const customStr = els.contentCustomBlocklist?.value?.trim() || '';
  const customList = customStr ? customStr.split('\n').map(s => s.trim()).filter(Boolean) : [];
  return {
    enabled: els.chkContentBlocker?.checked || false,
    blockOnDim: els.chkContentBlockDim?.checked ?? true,
    unblockOnComplete: els.chkContentUnblockComplete?.checked ?? true,
    blocklist: customList,
    useDefault: els.chkContentDefault?.checked ?? true
  };
}

function collectAccountabilitySettings() {
  const url = els.accWebhookUrl?.value?.trim() || '';
  const name = els.accPartnerName?.value?.trim() || 'Partner';
  const partners = url ? [{ type: 'webhook', url, name }] : [];
  return {
    enabled: els.chkAccountability?.checked || false,
    notifyOnStart: els.chkAccNotifyStart?.checked ?? true,
    notifyOnSnooze: els.chkAccNotifySnooze?.checked ?? true,
    notifyOnCancel: els.chkAccNotifyCancel?.checked ?? true,
    notifyOnComplete: els.chkAccNotifyComplete?.checked ?? false,
    partners
  };
}

function applyWifiGuardSettings(wifi) {
  if (!wifi) return;
  if (els.chkWifiGuard) els.chkWifiGuard.checked = !!wifi.enabled;
  if (els.wifiGuardConfig) els.wifiGuardConfig.style.display = wifi.enabled ? '' : 'none';
  if (els.selWifiProvider) {
    els.selWifiProvider.value = wifi.provider || 'firewall';
    els.selWifiProvider.dispatchEvent(new Event('change'));
  }
  if (els.wifiRouterIp) els.wifiRouterIp.value = wifi.routerIp || '';
  if (els.wifiRouterUser) els.wifiRouterUser.value = wifi.routerUser || 'admin';
  if (els.wifiRouterPass) els.wifiRouterPass.value = wifi.routerPass || '';
  if (els.wifiWebhookUrl) els.wifiWebhookUrl.value = wifi.webhookUrl || '';
  if (els.chkWifiBlockDim) els.chkWifiBlockDim.checked = wifi.blockOnDim !== false;
  if (els.chkWifiUnblockCancel) els.chkWifiUnblockCancel.checked = wifi.unblockOnCancel !== false;
  wifiSelectedDevices.macs = wifi.deviceMacs || [];
  wifiSelectedDevices.ips = wifi.deviceIps || [];
}

function applyContentBlockerSettings(cb) {
  if (!cb) return;
  if (els.chkContentBlocker) els.chkContentBlocker.checked = !!cb.enabled;
  if (els.contentBlockerConfig) els.contentBlockerConfig.style.display = cb.enabled ? '' : 'none';
  if (els.chkContentDefault) els.chkContentDefault.checked = cb.useDefault !== false;
  if (els.contentCustomBlocklist) els.contentCustomBlocklist.value = (cb.blocklist || []).join('\n');
  if (els.chkContentBlockDim) els.chkContentBlockDim.checked = cb.blockOnDim !== false;
  if (els.chkContentUnblockComplete) els.chkContentUnblockComplete.checked = cb.unblockOnComplete !== false;
}

function applyAccountabilitySettings(acc) {
  if (!acc) return;
  if (els.chkAccountability) els.chkAccountability.checked = !!acc.enabled;
  if (els.accountabilityConfig) els.accountabilityConfig.style.display = acc.enabled ? '' : 'none';
  if (els.chkAccNotifyStart) els.chkAccNotifyStart.checked = acc.notifyOnStart !== false;
  if (els.chkAccNotifySnooze) els.chkAccNotifySnooze.checked = acc.notifyOnSnooze !== false;
  if (els.chkAccNotifyCancel) els.chkAccNotifyCancel.checked = acc.notifyOnCancel !== false;
  if (els.chkAccNotifyComplete) els.chkAccNotifyComplete.checked = !!acc.notifyOnComplete;
  if (acc.partners?.[0]) {
    if (els.accWebhookUrl) els.accWebhookUrl.value = acc.partners[0].url || '';
    if (els.accPartnerName) els.accPartnerName.value = acc.partners[0].name || 'Partner';
  }
}

function applyCustomization(c) {
  if (!c) return;
  const root = document.documentElement;
  if (c.accent) {
    root.style.setProperty('--accent', c.accent);
    root.style.setProperty('--accent-cyan', c.accent);
    root.style.setProperty('--accent-blue', c.accent);
    root.style.setProperty('--ring-fill', c.accent);
    root.style.setProperty('--accent-glow', hexToRgba(c.accent, 0.45));
  }
  if (c.theme) document.body.dataset.theme = c.theme;
  if (c.ringStyle) document.body.dataset.ring = c.ringStyle;
  if (Number.isFinite(Number(c.opacity))) {
    const op = clamp(Number(c.opacity), 0.5, 1);
    if (previewMode) {
      root.style.setProperty('--app-opacity', op);
    } else {
      api.setWindowOpacity(op);
    }
  }
  if (Number.isFinite(Number(c.volume))) {
    SoundSystem.master = clamp(Number(c.volume), 0, 1);
  }
}

const CUSTOMIZE_DEFAULTS = { accent: '#5b8cff', theme: 'midnight', ringStyle: 'glow', opacity: 1, volume: 1, warmShift: true, soundscape: 'off', ambientVisual: 'off' };

function syncCustomizeUI() {
  const c = state.customization;
  if (els.czAccent) els.czAccent.value = c.accent;
  if (els.czTheme) els.czTheme.value = c.theme;
  if (els.czRing) els.czRing.value = c.ringStyle;
  if (els.czOpacity) els.czOpacity.value = c.opacity;
  if (els.czOpacityVal) els.czOpacityVal.textContent = `${Math.round(c.opacity * 100)}%`;
  if (els.czVolume) els.czVolume.value = c.volume;
  if (els.czVolumeVal) els.czVolumeVal.textContent = `${Math.round(c.volume * 100)}%`;
  if (els.czWarmShift) els.czWarmShift.checked = c.warmShift !== false;
  if (els.czSoundscape) els.czSoundscape.value = c.soundscape || 'off';
  if (els.czAmbient) els.czAmbient.value = c.ambientVisual || 'off';
  if (els.czSwatches) {
    els.czSwatches.querySelectorAll('.swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color.toLowerCase() === c.accent.toLowerCase());
    });
  }
  renderCustomSequences();
}

function setupCustomizeHandlers() {
  els.czAccent?.addEventListener('input', () => {
    state.customization.accent = els.czAccent.value;
    applyCustomization(state.customization);
    syncCustomizeUI();
  });
  els.czSwatches?.querySelectorAll('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      state.customization.accent = sw.dataset.color;
      applyCustomization(state.customization);
      syncCustomizeUI();
    });
  });
  els.czTheme?.addEventListener('change', () => {
    state.customization.theme = els.czTheme.value;
    applyCustomization(state.customization);
  });
  els.czRing?.addEventListener('change', () => {
    state.customization.ringStyle = els.czRing.value;
    applyCustomization(state.customization);
  });
  els.czOpacity?.addEventListener('input', () => {
    state.customization.opacity = Number(els.czOpacity.value);
    applyCustomization(state.customization);
    if (els.czOpacityVal) els.czOpacityVal.textContent = `${Math.round(state.customization.opacity * 100)}%`;
  });
  els.czVolume?.addEventListener('input', () => {
    state.customization.volume = Number(els.czVolume.value);
    applyCustomization(state.customization);
    if (els.czVolumeVal) els.czVolumeVal.textContent = `${Math.round(state.customization.volume * 100)}%`;
  });
  els.btnResetCustomize?.addEventListener('click', () => {
    state.customization = { ...CUSTOMIZE_DEFAULTS };
    applyCustomization(state.customization);
    syncCustomizeUI();
    Soundscape.stop();
  });
  els.czWarmShift?.addEventListener('change', () => {
    state.customization.warmShift = els.czWarmShift.checked;
  });
  els.czSoundscape?.addEventListener('change', () => {
    state.customization.soundscape = els.czSoundscape.value;
    if (state.running) Soundscape.start(els.czSoundscape.value);
    else Soundscape.stop();
  });
  els.czAmbient?.addEventListener('change', () => {
    state.customization.ambientVisual = els.czAmbient.value;
    if (AmbientVisuals.isActive()) AmbientVisuals.start(els.czAmbient.value);
  });
  els.chkIdleDetect?.addEventListener('change', () => {
    api.setIdleThreshold?.(els.chkIdleDetect.checked ? 300 : 0);
    // Persist only the changed key; saveAppSettings deep-merges on the main side.
    api.saveAppSettings?.({ app: { idleDetectionEnabled: els.chkIdleDetect.checked } });
  });
  els.chkBedtimeReminder?.addEventListener('change', () => {
    api.setBedtimeReminder?.(els.chkBedtimeReminder.checked ? 15 : 0);
    api.saveAppSettings?.({ app: { bedtimeReminderEnabled: els.chkBedtimeReminder.checked } });
  });
  els.chkCalendarAutostart?.addEventListener('change', () => {
    api.setCalendarAutoStart?.(els.chkCalendarAutostart.checked);
    api.saveAppSettings?.({ app: { calendarAutoStart: els.chkCalendarAutostart.checked } });
  });
}

function showWarningModal(message) {
  if (!els.warningModal) return;
  if (els.warningModalText) els.warningModalText.textContent = message;
  els.warningModal.classList.add('active');
}

function hideWarningModal() {
  els.warningModal?.classList.remove('active');
}

// Warm shift filter: applies a sepia/amber tint to the cockpit UI during the
// dim phase to simulate a blue-light reduction.  In Electron the main process
// also enables the Windows Night Light registry key; this CSS filter is the
// in-app complement.
function applyWarmFilter() {
  if (state.customization.warmShift === false) return;
  document.body.classList.add('warm-shift');
}

function removeWarmFilter() {
  document.body.classList.remove('warm-shift');
}

function setupWarningHandlers() {
  els.warningSnooze?.addEventListener('click', () => {
    snooze(5 * 60);
    hideWarningModal();
  });
  els.warningCancel?.addEventListener('click', () => {
    cancelTimer();
    hideWarningModal();
  });
  els.warningDismiss?.addEventListener('click', hideWarningModal);
  els.warningOverride?.addEventListener('click', () => {
    hideWarningModal();
    showOverrideModal();
  });
  els.warningModal?.addEventListener('click', event => {
    if (event.target === els.warningModal) hideWarningModal();
  });
}
