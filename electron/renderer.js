// Lights Out Electron - renderer process

const fallbackApi = (() => {
  let interval = null;
  const listeners = new Set();
  const state = {
    running: false,
    paused: false,
    totalSeconds: 0,
    remainingSeconds: 0,
    action: 'shutdown',
    dryRun: true,
    endsAt: null
  };
  const previewNightModes = [
    { id: 'quick-sleep', version: 1, title: 'Quick Sleep', subtitle: 'A short countdown, then sleep this PC.', artworkId: 'quick-sleep', status: 'ready', availability: { supported: true, reason: null }, timer: { durationSeconds: 900, action: 'sleep', ritualId: 'none' } },
    { id: 'lights-down', version: 1, title: 'Lights Down', subtitle: 'Wind down with a guided ritual before sleep.', artworkId: 'lights-down', status: 'ready', availability: { supported: true, reason: null }, timer: { durationSeconds: 2700, action: 'sleep', ritualId: 'standard' } },
    { id: 'movie-wind-down', version: 1, title: 'Movie Wind-Down', subtitle: 'Finish watching, then let this PC sleep.', artworkId: 'movie-wind-down', status: 'ready', availability: { supported: true, reason: null }, timer: { durationSeconds: 5400, action: 'sleep', ritualId: 'standard' } },
    { id: 'full-shutdown', version: 1, title: 'Full Shutdown', subtitle: 'A firm end to the night with a guided ritual.', artworkId: 'full-shutdown', status: 'ready', availability: { supported: true, reason: null }, timer: { durationSeconds: 3600, action: 'shutdown', ritualId: 'standard' } },
    { id: 'quiet-house', version: 1, title: 'Quiet House', subtitle: 'Silence networked devices and settle the house.', artworkId: 'quiet-house', status: 'coming_soon', availability: { supported: false, reason: 'A house-wide mode that settles every device at once is not built yet.' }, timer: { durationSeconds: 1800, action: 'sleep', ritualId: 'none' } },
    { id: 'school-night', version: 1, title: 'School Night', subtitle: 'Enforce bedtime with scheduled shutdown and content blocking.', artworkId: 'school-night', status: 'needs_router_setup', availability: { supported: false, reason: 'Needs router-level Wi-Fi control, which Lights Out does not have yet.' }, timer: { durationSeconds: 1800, action: 'shutdown', ritualId: 'standard' } }
  ];

  function emit(type, extra = {}) {
    const payload = {
      type,
      running: state.running,
      paused: state.paused,
      totalSeconds: state.totalSeconds,
      remainingSeconds: state.remainingSeconds,
      total: state.totalSeconds,
      remaining: state.remainingSeconds,
      action: state.action,
      dryRun: state.dryRun,
      endsAt: state.endsAt,
      ...extra
    };
    listeners.forEach(listener => listener(payload));
  }

  function clear() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  return {
    startTimer: async options => {
      clear();
      state.running = true;
      state.paused = false;
      state.totalSeconds = Math.max(1, Number(options.durationSeconds) || 60);
      state.remainingSeconds = state.totalSeconds;
      state.action = options.action || 'shutdown';
      state.dryRun = true;
      state.endsAt = new Date(Date.now() + state.remainingSeconds * 1000).toISOString();
      emit('started');

      interval = setInterval(() => {
        if (!state.running || state.paused) return;
        state.remainingSeconds = Math.max(0, state.remainingSeconds - 1);
        emit('tick');
        if (state.remainingSeconds <= 0) {
          clear();
          state.running = false;
          emit('complete', { message: 'Preview complete' });
        }
      }, 1000);

      return { success: true };
    },
    cancelTimer: async () => {
      clear();
      state.running = false;
      state.paused = false;
      state.remainingSeconds = 0;
      emit('cancelled');
      return { success: true };
    },
    pauseTimer: async () => {
      state.paused = true;
      emit('paused');
      return { success: true };
    },
    resumeTimer: async () => {
      state.paused = false;
      emit('resumed');
      return { success: true };
    },
    snoozeTimer: async seconds => {
      const addSeconds = Math.max(1, Number(seconds) || 300);
      state.totalSeconds += addSeconds;
      state.remainingSeconds += addSeconds;
      state.endsAt = new Date(Date.now() + state.remainingSeconds * 1000).toISOString();
      emit('snoozed', { addedSeconds: addSeconds });
      return { success: true };
    },
    getSystemInfo: async () => ({ battery: 'N/A', powerPlan: 'Preview' }),
    getSmartLightConfig: async () => ({ enabled: false, provider: 'none', mode: 'gradual_dim', dimMinutes: 10 }),
    saveSmartLightConfig: async () => ({ success: true }),
    getNightModesCatalogue: async () => previewNightModes.map(mode => ({
      ...mode,
      availability: { ...mode.availability },
      timer: { ...mode.timer }
    })),
    useNightModeTonight: async id => {
      const mode = previewNightModes.find(item => item.id === id);
      if (!mode || mode.status !== 'ready') return { success: false, error: 'Night mode is not available in preview.' };
      return {
        success: true,
        nightModeId: mode.id,
        nightModeTitle: mode.title,
        durationSeconds: mode.timer.durationSeconds,
        action: mode.timer.action,
        ritualId: mode.timer.ritualId
      };
    },
    getAppSettings: async () => {
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem('lightsout-settings') || '{}'); } catch { stored = {}; }
      return {
        runAtLogin: false,
        startupBehavior: 'Starts minimized and idle',
        app: stored.app || null,
        customization: stored.customization || null,
        recoverableTimer: null
      };
    },
    saveAppSettings: async settings => {
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem('lightsout-settings') || '{}'); } catch { stored = {}; }
      if (settings.app) stored.app = { ...(stored.app || {}), ...settings.app };
      if (settings.customization) stored.customization = { ...(stored.customization || {}), ...settings.customization };
      try { localStorage.setItem('lightsout-settings', JSON.stringify(stored)); } catch { /* ignore */ }
      return { runAtLogin: Boolean(settings.runAtLogin), startupBehavior: 'Starts minimized and idle', app: stored.app, customization: stored.customization };
    },
    resumeRecoverableTimer: async () => ({ success: false }),
    discardRecoverableTimer: async () => ({ success: true }),
    minimizeWindow: () => {},
    toggleMaximizeWindow: () => {},
    closeWindow: () => {},
    quitApp: () => {},
    toggleMiniMode: () => {},
    toggleWidget: async () => ({ success: false, visible: false }),
    setWindowOpacity: () => {},
    showNotification: () => {},
    playSound: () => {},
    setProgress: () => {},
    onTimerUpdate: callback => listeners.add(callback),
    onMiniModeChanged: () => {},
    onPlaySound: () => {},
    onPlayLastLight: () => {},
    onDimPhaseStarted: () => {},
    onDimPhaseEnded: () => {},
    onOpenSettings: () => {},
    setFullScreenClock: async () => ({ fullScreen: false }),
    onFullScreenChanged: () => {},
    getStreaks: async () => ({ streak: 0, bestStreak: 0, totalNights: 0, achievements: [], weekAvg: '--:--', weekOnTime: 0, weekDays: [] }),
    getAchievementsCatalog: async () => [],
    getWeeklyReport: async () => null,
    getSleepScore: async () => ({ score: null, label: 'Preview', breakdown: {} }),
    getStreaksHistory: async () => [],
    getStreaksTrend: async () => [],
    getCompanionStatus: async () => ({ running: false, port: 0, clients: 0, url: '' }),
    getRemoteControl: async () => ({ enabled: false, mode: 'off', token: '', port: 0, lanIp: '', url: '', pcName: 'Preview PC', clients: 0, connected: false, failed: false, statusLabel: 'Off' }),
    setRemoteControlMode: async () => ({ enabled: false, mode: 'off', token: '', url: '', statusLabel: 'Off' }),
    setRemoteControlPort: async () => ({ enabled: false, mode: 'off', token: '', url: '', statusLabel: 'Off' }),
    retryRemoteControl: async () => ({ enabled: false, mode: 'off', token: '', url: '', statusLabel: 'Off' }),
    regenerateRemoteToken: async () => ({ enabled: false, mode: 'off', token: '', url: '', statusLabel: 'Off' }),
    generateQr: async () => '',
    onRemoteControlStatus: () => {},
    getFamilyPeers: async () => [],
    familyRemoteStart: async () => ({ success: true }),
    familyRemotePause: async () => ({ success: true }),
    familyRemoteResume: async () => ({ success: true }),
    familyRemoteCancel: async () => ({ success: true }),
    familyRemoteSnooze: async () => ({ success: true }),
    getMediaSessions: async () => [],
    onMediaPaused: (cb) => {},
    onUnsavedWorkWarning: (cb) => {},
    onWifiGuardStatus: (cb) => {},
    wifiGuardScan: async () => [],
    wifiGuardBlock: async () => ({ success: true }),
    wifiGuardUnblock: async () => ({ success: true }),
    saveWifiGuardSettings: async () => {},
    getWifiGuardSettings: async () => ({
      enabled: false, provider: 'firewall', routerIp: '', routerUser: 'admin',
      routerPass: '', deviceMacs: [], deviceIps: [], webhookUrl: '', webhookHeaders: {},
      blockOnDim: true, unblockOnCancel: true
    }),
    contentBlock: async () => ({ success: true }),
    contentUnblock: async () => ({ success: true }),
    contentBlockStatus: async () => ({ blocked: false, sites: [] }),
    saveContentBlockerSettings: async () => {},
    getContentBlockerSettings: async () => ({
      enabled: false, blockOnDim: true, unblockOnComplete: true, blocklist: [], useDefault: true, schedules: []
    }),
    onContentBlocked: (cb) => {},
    saveAccountabilitySettings: async () => {},
    getAccountabilitySettings: async () => ({
      enabled: false, notifyOnStart: true, notifyOnSnooze: true, notifyOnCancel: true,
      notifyOnComplete: true, partners: []
    }),
    testAccountabilityPartner: async () => ({ success: true }),
    focusStart: async () => ({}),
    focusPause: async () => ({}),
    focusResume: async () => ({}),
    focusStop: async () => ({}),
    focusState: async () => ({ active: false, preset: 'pomodoro', cycle: 0, remainingSeconds: 0 }),
    onFocusTick: (cb) => {},
    onFocusPhase: (cb) => {},
    onFocusComplete: (cb) => {},
    getScreenTime: async () => null,
    getRealityCheck: async () => null,
    onRealityCheck: (cb) => {},
    getSleepDebt: async () => null,
    setSleepTarget: async () => 8,
    setWakeTime: async () => '07:00',
    getOverrideConsequences: async () => ({ allowed: true, consequences: [] }),
    executeOverride: async () => ({ overridden: true }),
    getLatestReceipt: async () => null,
    listReceipts: async () => [],
    exportReceipts: async () => [],
    clearReceipts: async () => ({ cleared: true }),
    getReceiptStats: async () => ({ total: 0, completed: 0, cancelled: 0, dryRun: 0, blocked: 0, interrupted: 0, other: 0 }),
    getIdleSeconds: async () => 0,
    setIdleThreshold: async () => ({ threshold: 300 }),
    onIdleDetected: (cb) => {},
    onUserReturned: (cb) => {},
    setBedtimeReminder: async () => ({ minutesBefore: 15 }),
    onBedtimeReminder: (cb) => {},
    onMorningBriefing: (cb) => {},
    setCalendarAutoStart: async enabled => ({ autoStartFromEvents: Boolean(enabled) }),
    addCustomSequence: async () => null,
    removeCustomSequence: async () => ({ success: true }),
    getOpenBrowsers: async () => [],
    onBrowserWarning: () => {},
    scheduleWakeAlarm: async () => ({ success: false, error: 'Preview mode' }),
    removeWakeAlarm: async () => ({ success: true }),
    getWakeAlarmStatus: async () => ({ active: false }),
    onFirstLightStarted: () => {},
    onFirstLightTick: () => {},
    onFirstLightEnded: () => {},
    checkForUpdate: async () => ({ available: false }),
    getUpdateStatus: async () => ({ available: false }),
    onUpdateAvailable: () => {},
    getAppVersion: async () => null,
    exportAllData: async () => ({ success: false, error: 'Preview mode' }),
    importAllData: async () => ({ success: false, error: 'Preview mode' }),
    getCalendarProviders: async () => [],
    fetchCalendarEvents: async () => [],
    getCalendarFetchStatus: async () => ({}),
    saveCalendarSettings: async () => ({ success: true }),
    getCalendarSettings: async () => ({ enabled: true, provider: 'builtin', builtin: { enabled: true, bedtime: '22:30', days: ['sun','mon','tue','wed','thu','fri','sat'], action: 'shutdown' } }),
    openExternal: url => window.open(url, '_blank', 'noopener'),
    // Profiles fallbacks
    getAllProfiles: async () => [],
    getProfileById: async () => null,
    createProfile: async () => ({ success: false, error: 'Preview mode' }),
    updateProfile: async () => ({ success: false, error: 'Preview mode' }),
    deleteProfile: async () => ({ success: false, error: 'Preview mode' }),
    reorderProfiles: async () => ({ success: false }),
    applyProfile: async () => ({ success: false, error: 'Preview mode' }),
    getProfileHint: async () => '',
    exportProfiles: async () => '[]',
    importProfiles: async () => ({ success: false, error: 'Preview mode' }),
    createDefaultProfiles: async () => [],
    // Calendar fallbacks
    calendarParseText: async () => ({ success: false, error: 'Preview mode', events: [] }),
    calendarImportUrl: async () => ({ success: false, error: 'Preview mode', events: [] }),
    calendarTestUrl: async () => false,
    calendarGetUpcoming: async () => [],
    calendarCreateTimer: async () => ({ success: false, error: 'Preview mode' }),
    calendarFormatTime: async () => 'Unknown'
  };
})();

const api = window.electronAPI || fallbackApi;
const previewMode = !window.electronAPI;
const desktopUxProofBridge = api.desktopUxProof;

// Created before renderer initialization starts, then marked ready only after
// DOM wiring, state restoration, Settings migration, menu wiring, first hero
// render, and IPC listener registration have all completed.
if (desktopUxProofBridge?.enabled) {
  const startupSettingsPanel = document.getElementById('ns-panel-set');
  const startupObservations = {
    settingsEverVisible: false,
    settingsVisibility: [],
    completedAt: null
  };
  const recordStartupSettingsVisibility = phase => {
    const visible = Boolean(startupSettingsPanel && getComputedStyle(startupSettingsPanel).display !== 'none');
    startupObservations.settingsEverVisible ||= visible;
    startupObservations.settingsVisibility.push({ phase, visible, at: Date.now() });
  };
  recordStartupSettingsVisibility('renderer-created');
  const startupObserver = new MutationObserver(() => recordStartupSettingsVisibility('mutation'));
  if (startupSettingsPanel) {
    startupObserver.observe(startupSettingsPanel, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  window.__desktopUxProof = {
    ready: false,
    version: desktopUxProofBridge.version || 1,
    phase: 'renderer-created',
    error: null,
    startup: startupObservations,
    finishStartupObservation: () => {
      recordStartupSettingsVisibility('renderer-ready');
      startupObservations.completedAt = Date.now();
      startupObserver.disconnect();
    },
    getStartInvocations: () => desktopUxProofBridge.getStartInvocations(),
    clearStartInvocations: () => desktopUxProofBridge.clearStartInvocations(),
    getRealPowerActions: () => desktopUxProofBridge.getRealPowerActions(),
    snapshot: () => ({
      ready: window.__desktopUxProof.ready,
      version: window.__desktopUxProof.version,
      phase: window.__desktopUxProof.phase,
      error: window.__desktopUxProof.error,
      documentReadyState: document.readyState,
      route: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null,
      visiblePanel: Array.from(document.querySelectorAll('.ns-main-panel')).find(panel => getComputedStyle(panel).display !== 'none')?.id || null,
      activeNav: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null,
      activeModal: document.querySelector('.modal.active')?.id || null,
      running: state.running,
      paused: state.paused,
      heroTitle: document.getElementById('ns-hero-title')?.textContent || null
    })
  };
}

function setDesktopUxProofPhase(phase, error = null) {
  if (!window.__desktopUxProof) return;
  window.__desktopUxProof.phase = phase;
  window.__desktopUxProof.error = error ? String(error?.stack || error) : null;
}

function markDesktopUxProofReady() {
  if (!window.__desktopUxProof) return;
  window.__desktopUxProof.finishStartupObservation();
  setDesktopUxProofPhase('ready');
  window.__desktopUxProof.ready = true;
}

const els = {
  body: document.body,
  timerDisplay: document.querySelector('.timer-display'),
  timerMain: document.getElementById('timer-main'),
  timerLabel: document.getElementById('timer-label'),
  timerSub: document.getElementById('timer-sub'),
  timerName: document.getElementById('timer-name'),
  ringProgress: document.querySelector('.ring-progress'),
  ringHead: document.getElementById('ring-head'),
  // The header wordmark's broken O (UI-R3 P07): it counts the session down.
  brandOLive: document.querySelector('#brand-wordmark .wm-o-live'),
  brandOHalo: document.querySelector('#brand-wordmark .wm-o-halo'),
  timerInput: document.getElementById('timer-input'),
  btnStop: document.getElementById('btn-stop'),
  btnPause: document.getElementById('btn-pause'),
  btnSnooze: document.getElementById('btn-snooze'),
  btnMinimize: document.getElementById('btn-minimize'),
  btnMaximize: document.getElementById('btn-maximize'),
  btnClose: document.getElementById('btn-close'),
  btnMini: document.getElementById('btn-mini'),
  btnPlus: document.getElementById('btn-plus'),
  btnMinus: document.getElementById('btn-minus'),
  panelSet: document.getElementById('ns-panel-set'),
  modalClose: document.getElementById('modal-close'),
  btnCancelOpt: document.getElementById('btn-cancel-opt'),
  btnSaveOpt: document.getElementById('btn-save-opt'),
  selAction: document.getElementById('sel-action'),
  graceMinutes: document.getElementById('grace-minutes'),
  chkForceShutdown: document.getElementById('chk-forceshutdown'),
  chkMute: document.getElementById('chk-mute'),
  chkGraceful: document.getElementById('chk-graceful'),
  testmodePill: document.getElementById('testmode-pill'),
  rdyPhone: document.getElementById('rdy-phone'),
  rdyLights: document.getElementById('rdy-lights'),
  rdyNetwork: document.getElementById('rdy-network'),
  rdySafety: document.getElementById('rdy-safety'),
  chkRunLogin: document.getElementById('chk-run-login'),
  focusBlocklist: document.getElementById('focus-blocklist'),
  chkDryRun: document.getElementById('chk-dryrun'),
  // UI-R3 P13: Settings truth (safety hero, honest save footer).
  setSafetyHero: document.getElementById('set-safety-hero'),
  setDryrunDesc: document.getElementById('set-dryrun-desc'),
  setForceDesc: document.getElementById('set-force-desc'),
  setDirtyNote: document.getElementById('set-dirty-note'),
  settingsCategories: document.querySelector('#ns-panel-set .settings-categories'),
  // Status pill (replaces old badges)
  statusPill: document.getElementById('status-pill'),
  batteryLevel: document.getElementById('battery-level'),
  powerPlan: document.getElementById('power-plan'),
  actionName: document.getElementById('action-name'),
  endTime: document.getElementById('end-time'),
  warningCard: document.getElementById('warning-card'),
  warningText: document.getElementById('warning-text'),
  scheduleCheck: document.getElementById('chk-schedule'),
  scheduleTime: document.getElementById('schedule-time'),
  // Smart Lights elements
  chkSmartLights: document.getElementById('chk-smart-lights'),
  lightsConfig: document.getElementById('lights-config'),
  selLightProvider: document.getElementById('sel-light-provider'),
  selLightMode: document.getElementById('sel-light-mode'),
  lightDimMinutes: document.getElementById('light-dim-minutes'),
  hueConfig: document.getElementById('hue-config'),
  wizConfig: document.getElementById('wiz-config'),
  wizAddresses: document.getElementById('wiz-addresses'),
  httpConfig: document.getElementById('http-config'),
  hueBridgeIp: document.getElementById('hue-bridge-ip'),
  hueUsername: document.getElementById('hue-username'),
  hueGroupId: document.getElementById('hue-group-id'),
  hueLegacyHttp: document.getElementById('hue-legacy-http'),
  btnDiscoverHue: document.getElementById('btn-discover-hue'),
  btnRegisterHue: document.getElementById('btn-register-hue'),
  btnLoadGroups: document.getElementById('btn-load-groups'),
  httpUrl: document.getElementById('http-url'),
  httpMethod: document.getElementById('http-method'),
  httpTemplate: document.getElementById('http-template'),
  btnTestLights: document.getElementById('btn-test-lights'),
  btnTestAction: document.getElementById('btn-test-action'),
  lightTestResult: document.getElementById('light-test-result'),
  lightsStatePill: document.getElementById('lights-state-pill'),
  lightProviderSegments: document.getElementById('light-provider-segments'),
  hueLegacyWarning: document.getElementById('hue-legacy-warning'),
  lightsVerifyNote: document.getElementById('lights-verify-note'),
  // Profiles elements
  profilesGrid: document.getElementById('profiles-grid'),
  btnManageProfiles: document.getElementById('btn-manage-profiles'),
  btnSaveCurrentProfile: document.getElementById('btn-save-current-profile'),
  profileSavePreview: document.getElementById('profile-save-preview'),
  profilesModal: document.getElementById('profiles-modal'),
  profilesModalClose: document.getElementById('profiles-modal-close'),
  btnCloseProfiles: document.getElementById('btn-close-profiles'),
  newProfileName: document.getElementById('new-profile-name'),
  newProfileKind: document.getElementById('new-profile-kind'),
  newProfileAvatar: document.getElementById('new-profile-avatar'),
  newProfileNotes: document.getElementById('new-profile-notes'),
  btnSaveProfile: document.getElementById('btn-save-profile'),
  scheduleHint: document.getElementById('schedule-hint'),
  // Clock face elements
  czClockFace: document.getElementById('cz-clockface'),
  analogClock: document.getElementById('analog-clock'),
  btnFullscreenClock: document.getElementById('btn-fullscreen-clock'),
  btnFullscreenClockExit: document.getElementById('btn-fullscreen-clock-exit'),
  analogTicks: document.getElementById('analog-ticks'),
  analogNumerals: document.getElementById('analog-numerals'),
  analogArabic: document.getElementById('analog-arabic'),
  clockHour: document.getElementById('clock-hour'),
  clockMinute: document.getElementById('clock-minute'),
  clockSecond: document.getElementById('clock-second'),
  analogDigital: document.getElementById('analog-digital'),
  analogDate: document.getElementById('analog-date'),
  czClockStyle: document.getElementById('cz-clock-style'),
  czClockDial: document.getElementById('cz-clock-dial'),
  czClockFormat: document.getElementById('cz-clock-format'),
  czClockScale: document.getElementById('cz-clock-scale'),
  czClockScaleVal: document.getElementById('cz-clock-scale-val'),
  czClockHands: document.getElementById('cz-clock-hands'),
  czClockDate: document.getElementById('cz-clock-date'),
  czClockSeconds: document.getElementById('cz-clock-seconds'),
  czClockSweep: document.getElementById('cz-clock-sweep'),
  clockStyleGroup: document.getElementById('clock-style-group'),
  profilesList: document.getElementById('profiles-list'),
  btnExportProfiles: document.getElementById('btn-export-profiles'),
  btnImportProfiles: document.getElementById('btn-import-profiles'),
  importFileInput: document.getElementById('import-file-input'),
  // Calendar elements
  calendarFileInput: document.getElementById('calendar-file-input'),
  btnImportFile: document.getElementById('btn-import-file'),
  calendarUrlInput: document.getElementById('calendar-url-input'),
  btnImportUrl: document.getElementById('btn-import-url'),
  calendarEvents: document.getElementById('calendar-events'),
  importTabBtns: document.querySelectorAll('.import-tab-btn'),
  importPanels: document.querySelectorAll('.import-panel'),
  // Customization elements
  czAccent: document.getElementById('cz-accent'),
  czSwatches: document.getElementById('cz-swatches'),
  czTheme: document.getElementById('cz-theme'),
  czRing: document.getElementById('cz-ring'),
  czOpacity: document.getElementById('cz-opacity'),
  czOpacityVal: document.getElementById('cz-opacity-val'),
  czVolume: document.getElementById('cz-volume'),
  czVolumeVal: document.getElementById('cz-volume-val'),
  czWarmShift: document.getElementById('cz-warmshift'),
  czSoundscape: document.getElementById('cz-soundscape'),
  czAmbient: document.getElementById('cz-ambient'),
  chkIdleDetect: document.getElementById('chk-idle-detect'),
  chkBedtimeReminder: document.getElementById('chk-bedtime-reminder'),
  chkCalendarAutostart: document.getElementById('chk-calendar-autostart'),
  chkNightlightDim: document.getElementById('chk-nightlight-dim'),
  chkPauseMediaDim: document.getElementById('chk-pausemedia-dim'),
  chkLockoutDim: document.getElementById('chk-lockout-dim'),
  chkClockMode: document.getElementById('chk-clock-mode'),
  ambientCanvas: document.getElementById('ambient-canvas'),
  btnResetCustomize: document.getElementById('btn-reset-customize'),
  // Last Light elements
  chkLastLight: document.getElementById('chk-lastlight'),
  lastLightConfig: document.getElementById('lastlight-config'),
  selLastLightSequence: document.getElementById('sel-lastlight-sequence'),
  selLastLightSound: document.getElementById('sel-lastlight-sound'),
  btnPreviewLastLight: document.getElementById('btn-preview-lastlight'),
  lastLightOverlay: document.getElementById('last-light-overlay'),
  llTitle: document.getElementById('ll-title'),
  llHeadline: document.getElementById('ll-headline'),
  llLine: document.getElementById('ll-line'),
  llStamp: document.getElementById('ll-stamp'),
  llRingArc: document.getElementById('ll-ring-arc'),
  llRingTime: document.getElementById('ll-ring-time'),
  llFavorBarFill: document.getElementById('ll-flavor-bar-fill'),
  llUnplugBtn: document.getElementById('ll-unplug-btn'),
  llUnplugSub: document.getElementById('ll-unplug-sub'),
  // Warning modal
  warningModal: document.getElementById('warning-modal'),
  warningModalText: document.getElementById('warning-modal-text'),
  warningSnooze: document.getElementById('warning-snooze'),
  warningCancel: document.getElementById('warning-cancel'),
  warningDismiss: document.getElementById('warning-dismiss'),
  warningOverride: document.getElementById('warning-override'),
  // Status pill status/dot/text (statusPill itself declared once above)
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  statusTime: document.getElementById('status-time'),
  // Streaks
  streakCount: document.getElementById('streak-count'),
  streakBest: document.getElementById('streak-best'),
  streakTotal: document.getElementById('streak-total'),
  streakWeekAvg: document.getElementById('streak-weekavg'),
  streakOnTime: document.getElementById('streak-ontime'),
  weeklyReportText: document.getElementById('weekly-report-text'),
  btnCopyWeeklyReport: document.getElementById('btn-copy-weekly-report'),
  streakCallout: document.getElementById('streak-callout'),
  streakCalloutCount: document.getElementById('streak-callout-count'),
  streakCalloutBest: document.getElementById('streak-callout-best'),
  trendList: document.getElementById('trend-list'),
  trendGranularityToggle: document.getElementById('trend-granularity-toggle'),
  // Sleep score
  scoreValue: document.getElementById('score-value'),
  scoreLabel: document.getElementById('score-label'),
  scoreBreakdown: document.getElementById('score-breakdown'),
  // Custom Last Light sequences
  customSeqList: document.getElementById('custom-seq-list'),
  btnAddCustomSeq: document.getElementById('btn-add-custom-seq'),
  customSeqBuilder: document.getElementById('custom-seq-builder'),
  customSeqName: document.getElementById('custom-seq-name'),
  customSeqSteps: document.getElementById('custom-seq-steps'),
  btnAddStep: document.getElementById('btn-add-step'),
  btnSaveCustomSeq: document.getElementById('btn-save-custom-seq'),
  btnCancelCustomSeq: document.getElementById('btn-cancel-custom-seq'),
  // Widget
  btnWidget: document.getElementById('btn-widget'),
  btnCompanion: document.getElementById('btn-companion'),
  // Remote control
  chkRemoteControl: document.getElementById('chk-remote-control'),
  remoteControlConfig: document.getElementById('remote-control-config'),
  remoteModeDescription: document.getElementById('remote-mode-description'),
  remoteUrl: document.getElementById('remote-url'),
  remoteToken: document.getElementById('remote-token'),
  remoteQr: document.getElementById('remote-qr'),
  remoteQrWrap: document.getElementById('remote-qr-wrap'),
  btnRegenToken: document.getElementById('btn-regen-token'),
  btnTurnOffCompanion: document.getElementById('btn-turn-off-companion'),
  btnCopyUrl: document.getElementById('btn-copy-url'),
  companionStatusPill: document.getElementById('companion-status-pill'),
  companionConnectedBadge: document.getElementById('companion-connected-badge'),
  companionPairingDetails: document.getElementById('companion-pairing-details'),
  remoteStartupError: document.getElementById('remote-startup-error'),
  remoteStartupErrorText: document.getElementById('remote-startup-error-text'),
  remoteFirewallWarning: document.getElementById('remote-firewall-warning'),
  remoteFirewallWarningText: document.getElementById('remote-firewall-warning-text'),
  remotePort: document.getElementById('remote-port'),
  btnSaveCompanionPort: document.getElementById('btn-save-companion-port'),
  btnRetryCompanion: document.getElementById('btn-retry-companion'),
  remoteFailedAttempts: document.getElementById('remote-failed-attempts'),
  remoteFailedAttemptsText: document.getElementById('remote-failed-attempts-text'),
  remoteShortCode: document.getElementById('remote-short-code'),

  // Family mode
  btnFamilyScan: document.getElementById('btn-family-scan'),
  familyStatus: document.getElementById('family-status'),
  familyPeers: document.getElementById('family-peers'),

  // WiFi Guard
  chkWifiGuard: document.getElementById('chk-wifi-guard'),
  wifiGuardConfig: document.getElementById('wifi-guard-config'),
  selWifiProvider: document.getElementById('sel-wifi-provider'),
  wifiRouterCfg: document.getElementById('wifi-router-cfg'),
  wifiWebhookCfg: document.getElementById('wifi-webhook-cfg'),
  wifiRouterIp: document.getElementById('wifi-router-ip'),
  wifiRouterUser: document.getElementById('wifi-router-user'),
  wifiRouterPass: document.getElementById('wifi-router-pass'),
  wifiWebhookUrl: document.getElementById('wifi-webhook-url'),
  btnWifiScan: document.getElementById('btn-wifi-scan'),
  wifiDeviceList: document.getElementById('wifi-device-list'),
  chkWifiBlockDim: document.getElementById('chk-wifi-block-dim'),
  chkWifiUnblockCancel: document.getElementById('chk-wifi-unblock-cancel'),
  btnWifiBlockTest: document.getElementById('btn-wifi-block-test'),
  btnWifiUnblockTest: document.getElementById('btn-wifi-unblock-test'),
  wifiTestResult: document.getElementById('wifi-test-result'),

  // Content Blocker
  chkContentBlocker: document.getElementById('chk-content-blocker'),
  contentBlockerConfig: document.getElementById('content-blocker-config'),
  chkContentDefault: document.getElementById('chk-content-default'),
  contentCustomBlocklist: document.getElementById('content-custom-blocklist'),
  chkContentBlockDim: document.getElementById('chk-content-block-dim'),
  chkContentUnblockComplete: document.getElementById('chk-content-unblock-complete'),
  btnContentBlockTest: document.getElementById('btn-content-block-test'),
  btnContentUnblockTest: document.getElementById('btn-content-unblock-test'),
  contentTestResult: document.getElementById('content-test-result'),
  cbSchedulesList: document.getElementById('cb-schedules-list'),
  btnAddCbSchedule: document.getElementById('btn-add-cb-schedule'),
  cbScheduleForm: document.getElementById('cb-schedule-form'),
  cbRuleLabel: document.getElementById('cb-rule-label'),
  cbRuleStart: document.getElementById('cb-rule-start'),
  cbRuleEnd: document.getElementById('cb-rule-end'),
  cbRuleDays: document.getElementById('cb-rule-days'),
  btnCancelCbRule: document.getElementById('btn-cancel-cb-rule'),
  btnSaveCbRule: document.getElementById('btn-save-cb-rule'),

  // Accountability
  chkAccountability: document.getElementById('chk-accountability'),
  accountabilityConfig: document.getElementById('accountability-config'),
  chkAccNotifyStart: document.getElementById('chk-acc-notify-start'),
  chkAccNotifySnooze: document.getElementById('chk-acc-notify-snooze'),
  chkAccNotifyCancel: document.getElementById('chk-acc-notify-cancel'),
  chkAccNotifyComplete: document.getElementById('chk-acc-notify-complete'),
  accWebhookUrl: document.getElementById('acc-webhook-url'),
  accPartnerName: document.getElementById('acc-partner-name'),
  btnAccTest: document.getElementById('btn-acc-test'),
  accTestResult: document.getElementById('acc-test-result'),

  // Override Tax
  chkOverrideTax: document.getElementById('chk-override-tax'),
  overrideTaxConfig: document.getElementById('override-tax-config'),
  taxFreeSnoozes: document.getElementById('tax-free-snoozes'),
  taxTightenMin: document.getElementById('tax-tighten-min'),
  taxMaxTighten: document.getElementById('tax-max-tighten'),
  taxReasonAfter: document.getElementById('tax-reason-after'),
  taxSessionCount: document.getElementById('tax-session-count'),
  taxTomorrowDebt: document.getElementById('tax-tomorrow-debt'),

  // Autopilot Bedtime
  chkAutopilot: document.getElementById('chk-autopilot'),
  autopilotConfig: document.getElementById('autopilot-config'),
  autopilotLearned: document.getElementById('autopilot-learned'),
  autopilotConfidence: document.getElementById('autopilot-confidence'),
  autopilotSample: document.getElementById('autopilot-sample'),
  autopilotOverrideTime: document.getElementById('autopilot-override-time'),

  // Ritual Mode
  ritualOverlay: document.getElementById('ritual-overlay'),
  ritualStepIcon: document.getElementById('ritual-step-icon'),
  ritualStepTitle: document.getElementById('ritual-step-title'),
  ritualStepDesc: document.getElementById('ritual-step-desc'),
  ritualProgress: document.getElementById('ritual-progress'),
  ritualStepContent: document.getElementById('ritual-step-content'),
  btnRitualSkip: document.getElementById('btn-ritual-skip'),
  btnRitualNext: document.getElementById('btn-ritual-next'),
  btnRitualCancel: document.getElementById('btn-ritual-cancel'),
  btnRitual: document.getElementById('btn-ritual'),

  // Sleep Debt
  debtAmount: document.getElementById('debt-amount'),
  debtLabel: document.getElementById('debt-label'),
  debtWeek: document.getElementById('debt-week'),

  // Emergency Override
  overrideModal: document.getElementById('override-modal'),
  overrideConsequences: document.getElementById('override-consequences'),
  overrideReasonInput: document.getElementById('override-reason-input'),
  btnOverrideConfirm: document.getElementById('btn-override-confirm'),
  btnOverrideCancel: document.getElementById('btn-override-cancel'),

  // Morning Proof / Run Receipts
  morningProofSection: document.getElementById('morning-proof-section'),
  proofCard: document.getElementById('proof-card'),
  proofIcon: document.getElementById('proof-icon'),
  proofBadge: document.getElementById('proof-badge'),
  proofBody: document.getElementById('proof-body'),
  btnWarningLedger: document.getElementById('btn-warning-ledger'),
  btnProofDetails: document.getElementById('btn-proof-details'),
  btnProofCopy: document.getElementById('btn-proof-copy'),
  receiptsModal: document.getElementById('receipts-modal'),
  receiptsModalClose: document.getElementById('receipts-modal-close'),
  receiptStats: document.getElementById('receipt-stats'),
  receiptsList: document.getElementById('receipts-list'),
  btnClearReceipts: document.getElementById('btn-clear-receipts'),
  btnExportReceipts: document.getElementById('btn-export-receipts'),
  // Northstar sidebar destinations (LIB/MODES/SCH/DEVICES/STATS=Proof)
  panelLib: document.getElementById('ns-panel-lib'),
  panelModes: document.getElementById('ns-panel-modes'),
  panelSch: document.getElementById('ns-panel-sch'),
  panelDevices: document.getElementById('ns-panel-devices'),
  panelStats: document.getElementById('ns-panel-stats'),
  devicePcCard: document.getElementById('device-card-pc'),
  devicePcName: document.getElementById('device-pc-name'),
  devicePcStatus: document.getElementById('device-pc-status'),
  devicePcMode: document.getElementById('device-pc-mode'),
  devicePhoneCard: document.getElementById('device-card-phone'),
  deviceFamilyCard: document.getElementById('device-card-family'),
  deviceFamilyStatus: document.getElementById('device-family-status'),
  deviceFamilyDiscovery: document.getElementById('device-family-discovery'),
  deviceFamilyCount: document.getElementById('device-family-count'),
  deviceFamilyPeers: document.getElementById('device-family-peers'),
  deviceLightsCard: document.getElementById('device-card-lights'),
  deviceLightsProvider: document.getElementById('device-lights-provider'),
  deviceLightsStatus: document.getElementById('device-lights-status'),
  deviceLightsConnection: document.getElementById('device-lights-connection'),
  deviceLightsBehavior: document.getElementById('device-lights-behavior'),
  deviceLightsLegacy: document.getElementById('device-lights-legacy'),
  deviceWifiCard: document.getElementById('device-card-wifi'),
  deviceWifiStatus: document.getElementById('device-wifi-status'),
  deviceWifiMethod: document.getElementById('device-wifi-method'),
  deviceWifiCount: document.getElementById('device-wifi-count'),
  deviceWifiNow: document.getElementById('device-wifi-now'),
  btnDeviceWifiRestore: document.getElementById('btn-device-wifi-restore'),
  deviceWifiRestoreResult: document.getElementById('device-wifi-restore-result'),
  btnDeviceLightsCheck: document.getElementById('btn-device-lights-check'),
  deviceLightsCheckResult: document.getElementById('device-lights-check-result'),
  devicePhoneRejectedRow: document.getElementById('device-phone-rejected-row'),
  devicePhoneRejected: document.getElementById('device-phone-rejected'),
  devicePcPlanRow: document.getElementById('device-pc-plan-row'),
  // UI-R3 Fire 07: real facts only (battery row, Wi-Fi Guard truth, Test
  // Mode scope notes, the phone's failure reason).
  devicePcBatteryRow: document.getElementById('device-pc-battery-row'),
  deviceWifiCountLabel: document.getElementById('device-wifi-count-label'),
  deviceWifiAdapterNote: document.getElementById('device-wifi-adapter-note'),
  deviceLightsScope: document.getElementById('device-lights-scope'),
  deviceWifiScope: document.getElementById('device-wifi-scope'),
  devicePhoneError: document.getElementById('device-phone-error'),
  btnDevicesRefresh: document.getElementById('btn-devices-refresh'),
  statsCompanionMode: document.getElementById('stats-companion-mode'),
  statsCompanionStatus: document.getElementById('stats-companion-status'),
  statsCompanionNetwork: document.getElementById('stats-companion-network'),
  statsCompanionClients: document.getElementById('stats-companion-clients'),
  statsSessionSummary: document.getElementById('stats-session-summary'),
  btnStatsViewLedger: document.getElementById('btn-stats-view-ledger'),
  aboutModal: document.getElementById('about-modal'),
  aboutModalClose: document.getElementById('about-modal-close'),
  // Version display (footer + About modal). HTML carries a static fallback string;
  // applyAppVersion() overrides it at runtime from electron/package.json.
  version: document.getElementById('version'),
  aboutVersion: document.getElementById('about-version'),
  // Updater status (in About modal)
  updaterStatus: document.getElementById('updater-status'),
  updaterStatusText: document.getElementById('updater-status-text'),
  btnCheckUpdate: document.getElementById('btn-check-update'),
  updaterDownload: document.getElementById('updater-download'),
  // Settings › General: the same version and updater line as About (own ids).
  setAppVersion: document.getElementById('set-app-version'),
  setUpdaterStatus: document.getElementById('set-updater-status'),
  setUpdaterStatusText: document.getElementById('set-updater-status-text'),
  setBtnCheckUpdate: document.getElementById('btn-set-check-update'),
  setBtnShortcuts: document.getElementById('btn-set-shortcuts'),
  // Alarm
  chkAlarm: document.getElementById('chk-alarm'),
  alarmConfig: document.getElementById('alarm-config'),
  alarmTime: document.getElementById('alarm-time'),
  btnSetAlarm: document.getElementById('btn-set-alarm'),
  btnRemoveAlarm: document.getElementById('btn-remove-alarm'),
  alarmStatus: document.getElementById('alarm-status'),
  // Update badge
  badgeUpdate: document.getElementById('badge-update'),
  // Data export/import
  btnExportAllData: document.getElementById('btn-export-all-data'),
  btnImportAllData: document.getElementById('btn-import-all-data'),
  importAllDataInput: document.getElementById('import-all-data-input'),
  // Onboarding
  onboarding: document.getElementById('onboarding'),
  onboardBack: document.getElementById('onboard-back'),
  onboardNext: document.getElementById('onboard-next'),
  // Calendar providers
  selCalendarProvider: document.getElementById('sel-calendar-provider'),
  calCfgIcal: document.getElementById('cal-cfg-ical'),
  calCfgGoogle: document.getElementById('cal-cfg-google'),
  calCfgOutlook: document.getElementById('cal-cfg-outlook'),
  calCfgCalendly: document.getElementById('cal-cfg-calendly'),
  calAutoStart: document.getElementById('cal-auto-start'),
  calIcalUrl: document.getElementById('cal-ical-url'),
  calGoogleApikey: document.getElementById('cal-google-apikey'),
  calGoogleCalid: document.getElementById('cal-google-calid'),
  calOutlookToken: document.getElementById('cal-outlook-token'),
  calCalendlyToken: document.getElementById('cal-calendly-token'),
  btnCalIcalFetch: document.getElementById('btn-cal-ical-fetch'),
  btnCalGoogleFetch: document.getElementById('btn-cal-google-fetch'),
  btnCalOutlookFetch: document.getElementById('btn-cal-outlook-fetch'),
  btnCalCalendlyFetch: document.getElementById('btn-cal-calendly-fetch'),
  btnStartFromEvent: document.getElementById('btn-start-from-event'),
  // Schedule › One night only, mirrored on Tonight (UI-R3 P10)
  schOnceAction: document.getElementById('sch-once-action'),
  tonightTargetNote: document.getElementById('tonight-target-note'),
  tonightTargetWhen: document.getElementById('tonight-target-when'),
  btnTonightTargetClear: document.getElementById('btn-tonight-target-clear'),
  focusPresets: document.getElementById('focus-presets')
};

const state = {
  running: false,
  paused: false,
  totalSeconds: 0,
  remainingSeconds: 28 * 60,
  action: 'shutdown',
  unit: 'min',
  dryRun: false,
  // False until the persisted app settings (Test Mode above all) have been
  // applied. Until then the UI says "Checking mode…" and Start is refused, so
  // nothing can start on the in-memory default.
  settingsLoaded: false,
  sound: false,
  gracefulClose: true,
  forceShutdown: false,
  muteSystem: false,
  graceMinutes: 2,
  runAtLogin: false,
  miniMode: false,
  endsAt: null,
  // Smart Lights state
  smartLights: {
    enabled: false,
    provider: 'none',
    wizAddresses: [],
    mode: 'gradual_dim',
    dimMinutes: 10,
    hueBridgeIp: '',
    hueUsername: '',
    hasHueCredential: false,
    hueGroupId: '',
    hueAllowLegacyHttp: false,
    httpUrl: '',
    httpMethod: 'POST',
    httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}',
    verifiedConfigKey: ''
  },
  // Customization state
  customization: {
    accent: '#9b93d6',
    theme: 'midnight',
    ringStyle: 'glow',
    opacity: 1,
    volume: 1,
    warmShift: true,
    soundscape: 'off',
    ambientVisual: 'off'
  },
  // Last Light state
  lastLight: {
    enabled: false,
    sequence: 'ClassicFade',
    sound: 'Off'
  },
  // Wind-down phase state
  phase: 'idle',
  // Clock Mode: show current time when idle
  clockMode: true,
  // Full screen clock mode (reuses the main window, no separate BrowserWindow)
  fullscreenClock: false,
  // The countdown ring is the default; analog is available for the idle clock.
  clockFace: 'digital',
  // Analog/hybrid clock customization.
  clockStyle: 'modern',
  clockDial: 'bars',
  clockFormat: '24h',
  clockScale: 1,
  clockShowDate: false,
  clockHandColor: '#9b93d6',
  clockSeconds: true,
  // Smooth sweeping second hand (premium watch glide) vs. a per-second tick.
  clockSweep: true,
  // Tracks whether clock mode was dismissed by profile application (restore on cancel).
  _clockDismissedByProfile: false,
  // Custom timer name
  timerName: 'Last Call',
  // The active run's grace (minutes) as main reports it in the timer payload
  // (UI-R3 Fire 04: the ring's winding-down station); null when unknown.
  runGraceMinutes: null,
  // Profiles state
  profiles: [],
  currentProfileId: null,
  profileSearchQuery: '',
  profileActiveFilter: 'all',
  // Streaks trend view (Weekly/Monthly toggle)
  trendGranularity: 'week',
  // Calendar state
  calendarEvents: [],
  calendarSource: null,
  // Transient outcome of the last session, shown briefly on the idle face:
  // 'completed' | 'dryrun' | 'cancelled' | null.
  lastOutcome: null,
  // The Test Mode setting when that outcome was recorded (UI-R3 Fire 02):
  // the footer shows the outcome only while the current mode agrees.
  lastOutcomeTestMode: false,
  // True only once main's own 'dryrun' (Test Mode skipped the power action)
  // event has arrived for the current 'dryrun' outcome (UI-R3 P07).
  outcomeSkipConfirmed: false,
  // Armed Night Mode: set by Use Tonight, cleared on any lobby edit or non-PLAY start.
  // Contains { nightModeId, nightModeTitle, durationSeconds, action } or null.
  // This is untrusted presentation state; main is authoritative at START time.
  armedNightMode: null
};

if (previewMode) {
  state.dryRun = true;
}

const SoundSystem = {
  ctx: null,
  enabled: false,
  master: 1,

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },

  getCtx() {
    this.init();
    return this.ctx;
  },

  playTone(freq, duration, type = 'sine', volume = 0.25) {
    if (!this.enabled) return;
    this.init();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(Math.max(0.0001, volume * this.master), this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + duration);
  },

  playStart() {
    this.playTone(523.25, 0.1, 'sine', 0.18);
    setTimeout(() => this.playTone(659.25, 0.1, 'sine', 0.18), 100);
    setTimeout(() => this.playTone(783.99, 0.2, 'sine', 0.24), 200);
  },

  playPause() {
    this.playTone(440, 0.12, 'triangle', 0.18);
  },

  playComplete() {
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.25, 'sine', 0.25), i * 130);
    });
  },

  playWarning() {
    this.playTone(300, 0.25, 'sawtooth', 0.16);
  },

  playCancel() {
    this.playTone(440, 0.08, 'sine', 0.16);
    setTimeout(() => this.playTone(349.23, 0.12, 'sine', 0.16), 90);
  }
};

// Ambient soundscape engine. Generates continuous rain/white-noise/brown-noise/
// crickets/ocean audio using the Web Audio API, fading with the timer.
const Soundscape = {
  active: false,
  type: 'off',
  nodes: null,
  gain: null,
  fadeInterval: null,

  start(type) {
    this.stop();
    if (!type || type === 'off') return;
    if (!SoundSystem.enabled) return;
    this.type = type;
    this.active = true;

    const ctx = SoundSystem.getCtx();
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0, ctx.currentTime);
    this.gain.connect(ctx.destination);

    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);

    switch (type) {
      case 'rain':
        this._fillPinkNoise(buffer);
        break;
      case 'whitenoise':
        this._fillWhiteNoise(buffer);
        break;
      case 'brownnoise':
        this._fillBrownNoise(buffer);
        break;
      case 'crickets':
        this._fillCrickets(buffer);
        break;
      case 'ocean':
        this._fillOcean(buffer);
        break;
      default:
        this._fillWhiteNoise(buffer);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.gain);
    source.start();
    this.nodes = { source };

    // Fade in.
    this.gain.gain.linearRampToValueAtTime(0.18 * SoundSystem.master, ctx.currentTime + 2);
  },

  stop() {
    if (this.fadeInterval) { clearInterval(this.fadeInterval); this.fadeInterval = null; }
    if (this.nodes?.source) { try { this.nodes.source.stop(); } catch { } }
    if (this.gain) { try { this.gain.disconnect(); } catch { } }
    this.nodes = null;
    this.gain = null;
    this.active = false;
    this.type = 'off';
  },

  fadeToZero(durationSec) {
    if (!this.gain || !this.active) { this.stop(); return; }
    const ctx = SoundSystem.getCtx();
    this.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);
    setTimeout(() => this.stop(), durationSec * 1000 + 200);
  },

  setVolume(level) {
    if (!this.gain || !this.active) return;
    const ctx = SoundSystem.getCtx();
    this.gain.gain.linearRampToValueAtTime(Math.max(0, level) * SoundSystem.master, ctx.currentTime + 0.5);
  },

  _fillWhiteNoise(buffer) {
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
  },

  _fillBrownNoise(buffer) {
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + 0.02 * white) / 1.02;
        last = data[i];
        data[i] *= 3.5;
      }
    }
  },

  _fillPinkNoise(buffer) {
    // Voss-McCartney approximation for rain-like sound.
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
  },

  _fillCrickets(buffer) {
    // Sparse chirps: short bursts of high-frequency tone with random gaps.
    const sampleRate = buffer.sampleRate;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      let pos = 0;
      while (pos < data.length) {
        const chirpLen = Math.floor(sampleRate * (0.008 + Math.random() * 0.015));
        const gapLen = Math.floor(sampleRate * (0.05 + Math.random() * 0.2));
        const freq = 4000 + Math.random() * 2000;
        for (let i = 0; i < chirpLen && pos < data.length; i++, pos++) {
          data[pos] = Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.3 * (1 - i / chirpLen);
        }
        for (let i = 0; i < gapLen && pos < data.length; i++, pos++) {
          data[pos] = 0;
        }
      }
    }
  },

  _fillOcean(buffer) {
    // Low-frequency filtered noise with slow amplitude modulation.
    const sampleRate = buffer.sampleRate;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      const modPeriod = sampleRate * 6; // 6-second wave cycle
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        const mod = 0.5 + 0.5 * Math.sin(2 * Math.PI * i / modPeriod);
        data[i] = last * 3.5 * mod;
      }
    }
  }
};

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function actionLabel(action = state.action) {
  return {
    shutdown: 'Shutdown',
    restart: 'Restart',
    sleep: 'Sleep',
    hibernate: 'Hibernate',
    lock: 'Lock',
    logout: 'Log out'
  }[action] || 'Power action';
}

// The keys persistClockPrefs writes (a live clock control never carries the
// rest of collectAppSettings()).
const CLOCK_PREF_KEYS = ['clockFace', 'clockStyle', 'clockDial', 'clockFormat', 'clockScale', 'clockShowDate', 'clockHandColor', 'clockSeconds', 'clockSweep'];

// -- What still runs in Test Mode (UI-R3 Fire 02) ------------------------------
// Test Mode holds back only the power action; the wind-down still runs (see
// pickWindDownFacts / windDownEffects in renderer-utils.js). windDownFacts holds
// only those non-secret facts; other scripts read it through the getter.
let windDownFacts = null;
/* exported getWindDownFacts -- read by Devices / Night Modes (FIRE07, FIRE08) */
function getWindDownFacts() { return windDownFacts; }
function setWindDownFacts(f) {
  windDownFacts = f;
  renderWindDownScope();
}

// Re-read the four sections the facts come from. A failed read is null (the
// note then says that setting could not be read); never throws.
async function refreshWindDownFacts() {
  const read = async fn => { try { return (await fn()) || null; } catch { return null; } };
  const [appSettings, lightConfig, wifiConfig, cbConfig] = await Promise.all([
    read(() => api.getAppSettings?.()),
    read(() => api.getSmartLightConfig?.()),
    read(() => api.getWifiGuardSettings?.()),
    read(() => api.getContentBlockerSettings?.())
  ]);
  setWindDownFacts(pickWindDownFacts({ app: appSettings && appSettings.app, contentBlocker: cbConfig, wifiGuard: wifiConfig, lights: lightConfig }));
}

// Settings › Power & Safety (both modes; amber in Test Mode) and Tonight's
// plan (Test Mode only) say which wind-down effects still run. Static text,
// written only on change; hidden while settings load or when nothing runs.
function renderWindDownScope() {
  const scope = windDownFacts ? windDownEffects(windDownFacts) : { effects: [], unknown: [] };
  const labels = scope.effects.map(e => e.label);
  const loaded = state.settingsLoaded === true;
  const testOn = loaded && state.dryRun === true;
  const write = (el, show, text, tone) => {
    if (!el) return;
    if (el.hidden !== !show) el.hidden = !show;
    // A hidden note is emptied too: #chk-dryrun's aria-describedby still
    // reads a hidden element's text, so it must never describe a stale list.
    const next = show ? text : '';
    if (el.textContent !== next) el.textContent = next;
    if (!show) return;
    if (tone !== undefined && el.dataset.tone !== tone) el.dataset.tone = tone;
  };
  const k = scope.unknown.length;
  const unread = k ? ` · ${k} setting${k === 1 ? '' : 's'} could not be read` : '';
  write(document.getElementById('set-testmode-scope'), loaded && labels.length > 0,
    `Test Mode holds back only the power action. Wind-down still runs: ${labels.join(' · ')}${unread}.`,
    testOn ? 'test' : 'muted');
  // The short lead: it has to fit above the Start button at 900x640.
  write(document.getElementById('plan-scope-note'), testOn && labels.length > 0,
    `Still runs in Test Mode: ${labels.join(' · ')}.`);
}

// UI-R3 P13: Settings › Power & Safety tells the truth about the end of the
// timer. Reads only canonical state (dryRun, action, graceMinutes). Static:
// the hero never animates (no transition on it in CSS either).
const FORCE_SHUTDOWN_NO_EFFECT = ['sleep', 'hibernate', 'lock', 'logout'];
function renderSafetyTruth() {
  // Until the saved settings are read, claim neither mode (as the footer).
  const known = state.settingsLoaded !== false;
  const real = known && !state.dryRun;
  // main shows the warning only when grace > 0 and the countdown reaches it
  // (remaining === grace * 60): grace 0, or a shorter timer, gets none.
  const graceRaw = Number(state.graceMinutes);
  const grace = Number.isFinite(graceRaw) ? Math.max(0, graceRaw) : 2;
  const warning = grace > 0
    ? `, after a ${grace}-minute warning (none if the timer is shorter than that).`
    : ', with no warning.';
  if (els.setDryrunDesc) {
    const text = !known
      ? 'Checking mode…'
      : state.dryRun
        ? 'On: the timer runs, but no power action will happen.'
        : `Off: ${actionLabel()} will really run when the timer ends${warning}`;
    if (els.setDryrunDesc.textContent !== text) els.setDryrunDesc.textContent = text;
  }
  els.setSafetyHero?.classList.toggle('is-real', real);
  if (els.setForceDesc) {
    const base = 'Shutdown and Restart close apps without waiting. Unsaved work can be lost.';
    const text = FORCE_SHUTDOWN_NO_EFFECT.includes(state.action)
      ? `${base} No effect for Sleep, Hibernate, Lock or Log out (the action is ${actionLabel()}).`
      : base;
    if (els.setForceDesc.textContent !== text) els.setForceDesc.textContent = text;
  }
}

function formatEndTime(isoDate) {
  if (!isoDate) return 'Idle';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Idle';
  // The 'Idle' sentinel stays (updateSessionHead compares it); the time
  // follows the 12h/24h setting (formatClock, renderer-utils.js).
  return formatClock(date);
}

function inputValue() {
  return clamp(parseInt(els.timerInput.value, 10) || 1, 1, state.unit === 'min' ? 480 : 28800);
}

function inputSeconds() {
  if (els.scheduleCheck?.checked && els.scheduleTime?.value) {
    return secondsUntilClockValue(els.scheduleTime.value);
  }
  return state.unit === 'sec' ? inputValue() : inputValue() * 60;
}

function setInputFromSeconds(seconds) {
  const safeSeconds = Math.max(1, Math.round(Number(seconds) || 60));
  if (state.unit === 'sec') {
    els.timerInput.value = safeSeconds;
  } else {
    els.timerInput.value = Math.max(1, Math.round(safeSeconds / 60));
  }
  if (!state.running) {
    state.remainingSeconds = inputSeconds();
    state.totalSeconds = state.remainingSeconds;
  }
  render();
}

function secondsUntilClockValue(timeValue) {
  const raw = String(timeValue || '');
  // datetime-local value ("YYYY-MM-DDTHH:MM") = an absolute date and time.
  if (raw.includes('T')) {
    const target = new Date(raw);
    if (Number.isNaN(target.getTime())) return inputValue() * 60;
    return Math.max(60, Math.round((target - new Date()) / 1000));
  }
  // Time-only value ("HH:MM") = next occurrence today or tomorrow.
  const [hours, minutes] = raw.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return inputValue() * 60;

  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return Math.max(60, Math.round((target - now) / 1000));
}

function setAction(action) {
  state.action = action;
  if (els.selAction) els.selAction.value = action;
  document.querySelectorAll('[data-action]').forEach(item => {
    item.classList.toggle('selected', item.dataset.action === action);
  });
  checkArmedModeMatch();
  checkProfileMatch();
  render();
}

function updateRing(remaining, total) {
  if (!els.ringProgress) return;
  const circumference = 2 * Math.PI * 90;
  const ratio = total > 0 ? clamp(remaining / total, 0, 1) : 0;
  els.ringProgress.style.strokeDasharray = `${circumference}`;
  els.ringProgress.style.strokeDashoffset = `${circumference - ratio * circumference}`;
  // Brand motion (UI-R2): the logo's flicker particle rides the end of the
  // arc, and the lamp-beam environment dims as the session runs down.
  if (els.ringHead) els.ringHead.style.transform = `rotate(${(ratio * 360).toFixed(2)}deg)`;
  // UI-R3 P07: in the completion hold the lamp is out (.12, the beam only;
  // the room darkens through --env-dark, capped at .45 in CSS).
  const active = state.running || state.paused;
  const outcomeHold = !active && (state.lastOutcome === 'completed' || state.lastOutcome === 'dryrun');
  const lightLevel = active ? 0.25 + 0.75 * ratio : outcomeHold ? 0.12 : 1;
  document.body.style.setProperty('--lights-level', lightLevel.toFixed(3));
  // The wordmark's broken O shows the same real remaining/total ratio as the
  // ring (pathLength 100). Idle clears it back to the logo's own cadence.
  document.body.style.setProperty('--session-ratio', (active ? ratio : 1).toFixed(4));
  const oDash = active ? `${(ratio * 100).toFixed(2)} 100` : '';
  for (const arc of [els.brandOLive, els.brandOHalo]) {
    if (arc && arc.dataset.dash !== oDash) { arc.dataset.dash = oDash; arc.style.strokeDasharray = oDash; }
  }
}

// -- Idle bezel (UI-R3 P06) ---------------------------------------------------
// With an analog or hybrid face idle, the ring is a dive-watch bezel: the arc
// starts where the minute hand points (hour hand at 1 h and above) and sweeps
// the plan's duration; the head sits on the moment the plan would end. Every
// value comes from the clock and the same plan Start reads. updateRing() is
// untouched: render() calls exactly one of the two. Clock-driven updates are
// instant (no tween), so a wrap at the hour / 12 h boundary never spins the
// arc backwards; only a plan change (same scale) tweens, via .bezel-tween.
const BEZEL_HOUR_SCALE_FROM = 3600;   // seconds: minute scale below, hour scale at and above
const BEZEL_MAX_SECONDS = 43200;      // 12 h: past this the bezel shows no arc or head
let bezelKey = '';
let bezelPlan = '';

function planSecondsNow() {
  return state.armedNightMode ? state.armedNightMode.durationSeconds : inputSeconds();
}

function updateIdleBezel(now, planSeconds) {
  if (!els.ringProgress) return;
  const secs = Math.max(0, Number(planSeconds) || 0);
  const hourScale = secs >= BEZEL_HOUR_SCALE_FROM;
  const empty = secs <= 0 || secs > BEZEL_MAX_SECONDS;
  const scale = empty ? 'none' : (hourScale ? 'hour' : 'minute');
  // ~5 s granularity: the arc moves under a degree per 5 s on the minute scale.
  const key = `${scale}:${secs}:${Math.floor(now.getTime() / 5000)}`;
  if (key === bezelKey) return;
  bezelKey = key;
  const body = document.body;
  const plan = `${scale}:${secs}`;
  // Tween only when the plan itself changed on the same scale (28 -> 45 min);
  // a clock tick, a wrap or a scale change applies instantly.
  const tween = Boolean(bezelPlan) && plan !== bezelPlan && bezelPlan.split(':')[0] === scale;
  bezelPlan = plan;
  body.classList.toggle('bezel-tween', tween);
  body.classList.add('bezel');
  body.classList.toggle('bezel-hour', scale === 'hour');
  body.classList.toggle('bezel-empty', empty);
  if (empty) return;
  const C = 2 * Math.PI * 90;
  const startFrac = hourScale
    ? ((now.getHours() % 12) + now.getMinutes() / 60) / 12
    : (now.getMinutes() + now.getSeconds() / 60) / 60;
  const sweep = Math.min(1, secs / (hourScale ? BEZEL_MAX_SECONDS : BEZEL_HOUR_SCALE_FROM));
  // Period-C dash pattern: one dash of length L per circumference, so an arc
  // that crosses 12 o'clock wraps instead of being cut off.
  const L = Math.min(sweep * C, C - 0.01);
  els.ringProgress.style.strokeDasharray = `${L.toFixed(2)} ${(C - L).toFixed(2)}`;
  els.ringProgress.style.strokeDashoffset = `${(-startFrac * C).toFixed(2)}`;
  // Not wrapped to 360: a tweened plan change crossing 12 o'clock must turn
  // forward (342 -> 396 deg), never back the long way.
  if (els.ringHead) els.ringHead.style.transform = `rotate(${((startFrac + sweep) * 360).toFixed(2)}deg)`;
}

// Leaving the bezel (a run starts, the face changes, clock mode goes off):
// clear its classes and keys; the caller's updateRing() then restores the
// full-circle dash. One frame without ring transitions, so the arc and head
// jump to the countdown instead of spinning there from the bezel position.
function clearIdleBezel() {
  const body = document.body;
  const had = body.classList.contains('bezel');
  bezelKey = '';
  bezelPlan = '';
  body.classList.remove('bezel', 'bezel-hour', 'bezel-empty', 'bezel-tween');
  if (!had) return;
  body.classList.add('ring-instant');
  requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('ring-instant')));
}

// Truthful by mode: Test Mode never names a power action as if it will run.
function idleBezelLabel(planSeconds) {
  const eff = state.armedNightMode?.action || state.action;
  const at = formatIdleClockTime(new Date(Date.now() + planSeconds * 1000), true);
  if (!state.settingsLoaded) return `Would end ${at}`;
  return state.dryRun ? `Test · would end ${at}` : `${actionLabel(eff)} at ${at} if started now`;
}

// True when the plan would end after the most recent bedtime occurrence, and
// within 12 h of it (midnight-safe: 22:30 counts for an end at 00:10).
function planEndsPastBedtime(endAt, bedtime) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(bedtime || ''));
  if (!m) return false;
  const occurrence = new Date(endAt);
  occurrence.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (occurrence > endAt) occurrence.setDate(occurrence.getDate() - 1);
  const after = endAt - occurrence;
  return after > 0 && after <= 12 * 3600 * 1000;
}

// Idle plan facts (render() and the idle tick; never renderTonightHero, whose
// contract sandbox has no clock helpers). textContent only, written only when
// the text changes, so the minute-granular "Ends at" costs nothing per tick.
function setTextIfChanged(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function updatePlanFacts() {
  const secs = planSecondsNow();
  setTextIfChanged(document.getElementById('plan-out-at'), `~${formatIdleClockTime(new Date(Date.now() + secs * 1000), true)}`);
  // dt follows the mode: a Test Mode run ends without a power action.
  setTextIfChanged(document.getElementById('plan-out-at-label'), state.settingsLoaded && state.dryRun ? 'Test ends' : 'Ends at');
  const hour = new Date().getHours();
  setTextIfChanged(document.getElementById('ns-hero-label'), (hour >= 17 || hour < 5) ? "TONIGHT'S PLAN" : 'NEXT RUN');
}

// Session console head: phase (+ origin from the frozen map), then the real
// end. textContent only.
// 'Focus' belongs to Focus Sessions only (Fire 02): a session's first phase is Running.
const SESSION_PHASE_LABELS = Object.freeze({ focus: 'Running', dim: 'Winding down', lastlight: 'Last light' });
function updateSessionHead() {
  // Only a key of the frozen ORIGIN_LABELS map (renderer-utils.js) adds a
  // phrase; 'this-pc' and any unknown value add nothing.
  const origin = typeof ORIGIN_LABELS !== 'undefined' && typeof state.origin === 'string'
    && Object.prototype.hasOwnProperty.call(ORIGIN_LABELS, state.origin) ? ORIGIN_LABELS[state.origin] : '';
  const phase = state.paused ? 'Paused' : (SESSION_PHASE_LABELS[state.phase] || 'Running');
  setTextIfChanged(document.getElementById('session-phase'), origin ? `${phase} · ${origin}` : phase);
  const endText = formatEndTime(state.endsAt);
  const known = endText !== 'Idle';
  const ends = state.paused ? 'On hold until you resume'
    : !known ? (state.dryRun ? 'Test Mode session' : `${actionLabel()} at the end`)
      : (state.dryRun ? `Test ends ${endText}` : `${actionLabel()} at ${endText}`);
  setTextIfChanged(document.getElementById('session-ends'), ends);
}

function countdownRingLabel() {
  if (state.paused) return 'On hold until you resume';
  const end = formatEndTime(state.endsAt);
  if (state.dryRun) return end === 'Idle' ? 'Test Mode · no power action' : `Test ends ${end}`;
  return end === 'Idle' ? `${actionLabel()} when timer ends` : `${actionLabel()} at ${end}`;
}

function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toastKey = `${type}:${message}`;
  const duplicate = [...container.querySelectorAll('.toast')].find(item => item.dataset.toastKey === toastKey);
  if (duplicate) {
    clearTimeout(duplicate._dismissTimer);
    clearTimeout(duplicate._removeTimer);
    duplicate.classList.add('visible');
    duplicate._dismissTimer = setTimeout(() => {
      duplicate.classList.remove('visible');
      duplicate._removeTimer = setTimeout(() => duplicate.remove(), 220);
    }, duration);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.dataset.toastKey = toastKey;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));
  toast._dismissTimer = setTimeout(() => {
    toast.classList.remove('visible');
    toast._removeTimer = setTimeout(() => toast.remove(), 220);
  }, duration);
}

const notificationFeed = [];
const MAX_NOTIFICATIONS = 50;

// { toast: false } records a feed-only entry (UI-R3 Fire 02): the
// notification centre and its badge still get it, but nothing pops over a
// surface that already shows the change (the ring and console on Tonight).
function notify(message, type = 'info', duration = 3000, { toast = true } = {}) {
  if (toast) showToast(message, type, duration);
  const now = Date.now();
  const latest = notificationFeed[0];
  if (latest && latest.message === message && latest.type === type && now - new Date(latest.time).getTime() < 2000) {
    latest.time = new Date(now).toISOString();
    latest.read = false;
  } else {
    notificationFeed.unshift({ message, type, time: new Date(now).toISOString(), read: false });
  }
  if (notificationFeed.length > MAX_NOTIFICATIONS) notificationFeed.length = MAX_NOTIFICATIONS;
  renderNotificationBadge();
}

function renderNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  const unread = notificationFeed.filter(n => !n.read).length;
  if (badge) {
    badge.textContent = unread > 9 ? '9+' : unread || '';
    badge.style.display = unread ? '' : 'none';
  }
}

function renderNotificationFeed() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (!notificationFeed.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 0">No notifications yet.</p>';
    return;
  }
  list.innerHTML = notificationFeed.slice(0, 30).map(n => {
    const time = new Date(n.time);
    const ago = formatTimeAgo(time);
    const typeColor = { success: '#4caf50', warning: '#ff9800', error: '#ff4d4d', info: 'var(--text-muted)' }[n.type] || 'var(--text-muted)';
    return `<div class="notif-item" style="padding:8px 10px;border-bottom:1px solid var(--bg-card);display:flex;align-items:flex-start;gap:8px">
      <span style="width:6px;height:6px;border-radius:50%;background:${typeColor};margin-top:5px;flex-shrink:0"></span>
      <div style="flex:1;min-width:0">
        <p style="margin:0;font-size:11px;color:var(--text-primary);word-break:break-word">${escapeHtml(n.message)}</p>
        <span style="font-size:9px;color:var(--text-muted)">${ago}</span>
      </div>
    </div>`;
  }).join('');
  // Mark all as read.
  notificationFeed.forEach(n => n.read = true);
  renderNotificationBadge();
}

// Notification drawer open/close.
const btnNotif = document.getElementById('btn-notif');
const notifDrawer = document.getElementById('notif-drawer');
const notifDrawerClose = document.getElementById('notif-drawer-close');
if (btnNotif && notifDrawer) {
  btnNotif.addEventListener('click', () => {
    const opening = !notifDrawer.classList.contains('active');
    notifDrawer.classList.toggle('active', opening);
    notifDrawer.style.display = '';
    btnNotif.setAttribute('aria-expanded', String(opening));
    if (opening) renderNotificationFeed();
  });
}
if (notifDrawerClose && notifDrawer) {
  notifDrawerClose.addEventListener('click', () => {
    notifDrawer.classList.remove('active');
    btnNotif?.setAttribute('aria-expanded', 'false');
  });
}

function setSidebarSelection(tab) {
  document.querySelectorAll('.ns-nav-item').forEach(btn => {
    const isActive = btn.dataset.nsTab === tab;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

async function openReceiptsLedger() {
  try {
    // Every stored receipt (runReceipts keeps at most 100, MAX_RECEIPTS), so
    // the list never shows fewer rows than the summary's total (Fire 10).
    const [receipts, stats] = await Promise.all([
      api.listReceipts?.(100),
      api.getReceiptStats?.()
    ]);
    // A reopened ledger never shows a leftover Delete-all confirm.
    if (typeof resetReceiptsClearConfirm === 'function') resetReceiptsClearConfirm();
    renderReceiptsModal(receipts || [], stats);
    if (els.receiptsModal) els.receiptsModal.classList.add('active');
    return true;
  } catch (e) {
    console.error('Failed to load receipts:', e);
    notify('Ledger is unavailable right now', 'warning');
    return false;
  }
}

let settingsReturnTab = 'lib';

// Desktop settings page: a fixed category rail beside a single visible
// content panel, instead of one long scrolling list covering every domain
// (power/safety, wind-down, phone companion, protection, accountability,
// automations, appearance, advanced). Not persisted -- always reopens on
// the first category, same reasoning as the nsActiveTab restore guard in
// renderer-settings.js: a modal's internal navigation is transient session
// state, not something that should leak into the next launch.
function switchSettingsCategory(categoryId) {
  document.querySelectorAll('.settings-rail-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.settingsCategory === categoryId);
    if (btn.dataset.settingsCategory === categoryId) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
    btn.setAttribute('aria-current', btn.dataset.settingsCategory === categoryId ? 'page' : 'false');
  });
  document.querySelectorAll('.settings-categories .option-section[data-settings-category]').forEach(section => {
    section.classList.toggle('settings-category-active', section.dataset.settingsCategory === categoryId);
  });
  if (typeof renderSettingsCategoryInfo === 'function') renderSettingsCategoryInfo(categoryId);
}

// Display names for the Back button's accessible name -- must match
// settingsReturnTab's possible values (lib/modes/sch/devices/stats), not
// just assume "Tonight".
const NS_TAB_DISPLAY_NAME = { lib: 'Tonight', modes: 'Night Modes', sch: 'Schedule', devices: 'Devices', stats: 'Proof' };

function openSettingsPanel() {
  const activeTab = document.querySelector('.ns-nav-item.active')?.dataset?.nsTab;
  if (activeTab && !['set', 'help'].includes(activeTab)) settingsReturnTab = activeTab;
  syncCustomizeUI();
  updateLastLightUIFromState();
  loadRemoteControlState();
  setSidebarSelection('set');
  switchSettingsCategory('general');
  applyMainPanelVisibility('set');
  // The Back button always returns to settingsReturnTab (see
  // closeSettingsPanel()), which is not always Tonight -- keep its
  // accessible name honest about the actual destination.
  const returnLabel = NS_TAB_DISPLAY_NAME[settingsReturnTab] || 'Tonight';
  els.modalClose?.setAttribute('aria-label', `Back to ${returnLabel}`);
  // UI-R3 P13: a freshly opened panel holds no unsaved edits.
  els.panelSet?.classList?.remove('is-dirty');
  if (els.setDirtyNote) els.setDirtyNote.textContent = 'No unsaved changes';
  // General's updater line shows the last known result (no network).
  if (typeof refreshUpdaterStatus === 'function') refreshUpdaterStatus();
  // Fire 02: Power & Safety's Test Mode note re-reads the persisted wind-down.
  if (typeof refreshWindDownFacts === 'function') void refreshWindDownFacts();
}

// Returns to whichever primary view (Tonight/Modes/Schedule/Stats) was
// showing before Settings was opened -- a real panel switch, not dismissing
// an overlay, so leaving Settings must re-show that panel's content, not
// just its sidebar highlight.
function closeSettingsPanel() {
  const returnTab = settingsReturnTab || 'lib';
  applyMainPanelVisibility(returnTab);
  setSidebarSelection(returnTab);
  render();
  // Back/Cancel/Save all live inside #ns-panel-set, which
  // applyMainPanelVisibility() above just hid out from under whichever
  // one had focus -- same underlying class of bug as Help/About (see
  // isSensibleFocusTarget()/closeHelpPanel() above): losing a hidden
  // element's focus lands the browser on BODY. Land it on the return
  // destination's own sidebar control instead; fall back to Tonight's if
  // that's somehow unavailable too, and do nothing (never force BODY,
  // never anything still inside the now-hidden Settings panel) if
  // neither is available.
  const destinationTarget = document.querySelector(`.ns-nav-item[data-ns-tab="${returnTab}"]`);
  const target = isSensibleFocusTarget(destinationTarget)
    ? destinationTarget
    : document.querySelector('.ns-nav-item[data-ns-tab="lib"]');
  if (isSensibleFocusTarget(target)) target.focus();
}

// Persist everything currently shown in the Settings panel to the desktop.
async function saveSettingsPanel() {
  state.action = els.selAction.value;
  state.graceMinutes = clamp(Number(els.graceMinutes.value) || 0, 0, 10);
  state.forceShutdown = els.chkForceShutdown.checked;
  state.muteSystem = els.chkMute.checked;
  // Dry Run is deliberately NOT re-read from the checkbox here. It's an
  // always-live, immediately-committed value (its own 'change' listener
  // below, and the top-menu quick toggle, both write state.dryRun and
  // persist on the spot) -- state.dryRun is already correct by the time
  // Save runs. Re-reading the checkbox here previously let a stale DOM
  // value (present whenever Dry Run had just been changed through the
  // OTHER editor while Settings stayed open) silently overwrite a newer
  // canonical value on Save.
  state.runAtLogin = Boolean(els.chkRunLogin?.checked);

  // Save Smart Lights config. A verification belongs to one exact setup: if
  // any field main's configurationKey() is built from differs from the last
  // config main returned (or a Hue key was typed / registered since), the old
  // verifiedConfigKey is not sent, so the saved state can never read
  // "Verified" for a setup that was not verified.
  const prevLights = state.smartLights || {};
  const nextLights = {
    enabled: els.chkSmartLights?.checked || false,
    provider: els.selLightProvider?.value || 'none',
    ...collectWizSettings(),
    mode: els.selLightMode?.value || 'gradual_dim',
    timerBeacon: document.getElementById('chk-wiz-timer-beacon')?.checked === true,
    dimMinutes: clamp(Number(els.lightDimMinutes?.value) || 10, 1, 60),
    hueBridgeIp: els.hueBridgeIp?.value || '',
    // Blank means "keep the stored credential" — the renderer never sees the
    // existing secret, so an untouched field must not overwrite it.
    hueUsername: els.hueUsername?.value || '',
    hueGroupId: els.hueGroupId?.value || '',
    hueAllowLegacyHttp: Boolean(els.hueLegacyHttp?.checked),
    httpUrl: els.httpUrl?.value || '',
    httpMethod: els.httpMethod?.value || 'POST',
    httpBodyTemplate: els.httpTemplate?.value || '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}',
    verifiedConfigKey: ''
  };
  // main's loadConfig treats an empty field as "keep the existing value", so a
  // cleared field is compared by what main will really store (next || prev).
  const changedAfterKeep = (next, prev) => (next || prev || '') !== (prev || '');
  const lightsSetupChanged = nextLights.provider !== (prevLights.provider || 'none')
    || (nextLights.provider === 'wiz' && JSON.stringify(nextLights.wizAddresses) !== JSON.stringify([...(prevLights.wizAddresses || [])].sort()))
    || (nextLights.provider === 'hue' && (
      changedAfterKeep(nextLights.hueBridgeIp.trim(), prevLights.hueBridgeIp)
      || changedAfterKeep(nextLights.hueGroupId, prevLights.hueGroupId)
      || (nextLights.hueUsername !== '' && nextLights.hueUsername !== (prevLights.hueUsername || ''))))
    || (nextLights.provider === 'http' && (
      changedAfterKeep(nextLights.httpUrl, prevLights.httpUrl)
      || nextLights.httpMethod !== (prevLights.httpMethod || 'POST')
      || changedAfterKeep(nextLights.httpBodyTemplate, prevLights.httpBodyTemplate)));
  nextLights.verifiedConfigKey = lightsSetupChanged ? '' : (prevLights.verifiedConfigKey || '');
  state.smartLights = nextLights;

  state.lastLight = {
    enabled: els.chkLastLight?.checked || false,
    sequence: els.selLastLightSequence?.value || 'ClassicFade',
    sound: els.selLastLightSound?.value || 'Off'
  };

  // UI-R3 P13: the footer may say "No unsaved changes" only when both
  // persistence calls below really succeeded.
  let ok = true;
  try {
    const saved = await api.saveAppSettings({
      runAtLogin: state.runAtLogin,
      app: collectAppSettings(),
      customization: state.customization,
      lastLight: state.lastLight,
      wifiGuard: collectWifiGuardSettings(),
      contentBlocker: collectContentBlockerSettings(),
      accountability: collectAccountabilitySettings()
    });
    if (typeof saved?.runAtLogin === 'boolean') state.runAtLogin = saved.runAtLogin;
    applyWifiGuardSettings(saved?.wifiGuard);
    applyContentBlockerSettings(saved?.contentBlocker);
    applyAccountabilitySettings(saved?.accountability);
  } catch (error) {
    ok = false;
    notify(`Login settings failed: ${error.message || error}`, 'warning', 4500);
  }

  try {
    const requestedLights = state.smartLights.enabled;
    const sentUser = state.smartLights.hueUsername || '';
    // Remember the key the form sent (main never returns it), so the next
    // Save can tell an untouched field from a newly typed key.
    state.smartLights = { ...(await api.saveSmartLightConfig(state.smartLights)), hueUsername: sentUser };
    if (els.chkSmartLights) els.chkSmartLights.checked = Boolean(state.smartLights.enabled);
    if (typeof renderLightsStatePill === 'function') renderLightsStatePill(state.smartLights);
    if (requestedLights && !state.smartLights.enabled) {
      notify('Settings saved. Smart lights stay off until this exact setup is verified: WiZ or Hue with Verify connection, a webhook with Send test action.', 'warning');
    } else {
      notify('Settings saved', 'success');
    }
  } catch (error) {
    ok = false;
    notify(`Smart lights save failed: ${error.message || error}`, 'error');
  }

  if (ok) {
    els.panelSet?.classList?.remove('is-dirty');
    if (els.setDirtyNote) els.setDirtyNote.textContent = 'No unsaved changes';
  }
  // Fire 02: the Test Mode notes follow what is now persisted (a partial
  // failure re-reads too, so they never describe the unsaved form). typeof-
  // guarded: Settings sandboxes extract this function alone.
  if (typeof refreshWindDownFacts === 'function') void refreshWindDownFacts();

  setAction(state.action);
  render();
  return ok;
}

// Revert the Settings form to the last persisted values without restarting
// the renderer or reattaching listeners.
async function discardSettingsPanelChanges() {
  try {
    const [appSettings, lightConfig, wifiConfig, cbConfig, accConfig] = await Promise.all([
      api.getAppSettings(),
      api.getSmartLightConfig(),
      api.getWifiGuardSettings?.(),
      api.getContentBlockerSettings?.(),
      api.getAccountabilitySettings?.()
    ]);
    if (typeof appSettings.runAtLogin === 'boolean') state.runAtLogin = appSettings.runAtLogin;
    if (appSettings.app) await applyAppSettings(appSettings.app, { skipNavigation: true });
    if (appSettings.customization) {
      state.customization = { ...state.customization, ...appSettings.customization };
    }
    applyCustomization(state.customization);
    if (appSettings.lastLight) {
      state.lastLight = { ...state.lastLight, ...appSettings.lastLight };
    }
    updateLastLightUIFromState();
    syncCustomizeUI();
    loadRemoteControlState();
    if (lightConfig) {
      state.smartLights = {
        enabled: lightConfig.enabled || false,
        provider: lightConfig.provider || 'none',
        mode: lightConfig.mode || 'gradual_dim',
        dimMinutes: lightConfig.dimMinutes || 10,
        hueBridgeIp: lightConfig.hueBridgeIp || '',
        hueUsername: '',
        hasHueCredential: Boolean(lightConfig.hasHueCredential),
        hueGroupId: lightConfig.hueGroupId || '',
        hueAllowLegacyHttp: Boolean(lightConfig.hueAllowLegacyHttp),
        httpUrl: lightConfig.httpUrl || '',
        httpMethod: lightConfig.httpMethod || 'POST',
        httpBodyTemplate: lightConfig.httpBodyTemplate || '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}',
        verifiedConfigKey: lightConfig.verifiedConfigKey || ''
      };
      updateLightsUIFromState();
      if (typeof renderLightsStatePill === 'function') renderLightsStatePill(lightConfig);
    }
    if (wifiConfig) applyWifiGuardSettings(wifiConfig);
    if (cbConfig) applyContentBlockerSettings(cbConfig);
    if (accConfig) applyAccountabilitySettings(accConfig);
    // Fire 02: the Test Mode notes describe the persisted values just read.
    if (typeof setWindDownFacts === 'function' && typeof pickWindDownFacts === 'function') {
      setWindDownFacts(pickWindDownFacts({ app: appSettings.app, contentBlocker: cbConfig, wifiGuard: wifiConfig, lights: lightConfig }));
    }
    // UI-R3 P13: the form now shows the persisted values again.
    els.panelSet?.classList?.remove('is-dirty');
    if (els.setDirtyNote) els.setDirtyNote.textContent = 'No unsaved changes';
  } catch (error) {
    console.error('discardSettingsPanelChanges failed:', error);
    notify('Could not restore persisted settings', 'warning');
  }
}

// Help/About is a modal action, not a persistent page destination -- it
// never replaces whatever page (Tonight/Modes/Schedule/Settings) is
// actually current underneath it (see handleSidebarNavigation(), which
// deliberately never calls setSidebarSelection('help')). helpOpenerElement
// remembers what had focus right before it opened, so closing it restores
// focus/context there instead of leaving it stranded on a hidden modal --
// for a normal sidebar click that's the Help button itself; the point is
// closing About never needs to guess, and never touches Settings'
// Save/Cancel state either way.
//
// Other callers (e.g. a badge or tray-initiated About) can pass an explicit
// restoreTarget when activeElement can't be trusted; the sidebar path keeps
// using activeElement, since a sidebar click never hides its own button.
let helpOpenerElement = null;

// Whether `el` is currently worth returning keyboard focus to. Guards
// openHelpPanel()/closeHelpPanel() and closeSettingsPanel() (see below)
// against landing on something disconnected, hidden, disabled, or BODY
// itself -- BODY is what the browser falls back to on its own when a
// focused element disappears, never a destination worth choosing on purpose.
function isSensibleFocusTarget(el) {
  if (!el || typeof el.focus !== 'function') return false;
  if (el === document.body) return false;
  if ('isConnected' in el && !el.isConnected) return false;
  if (el.disabled) return false;
  if (!isRendered(el)) return false;
  return true;
}

// Whether `el` actually has a rendered, visible layout box right now --
// not just whether ITS OWN inline style says so. CSS `display` set on a
// PARENT never shows up in the child's own style (inline or computed --
// each element's `display` is independent of its ancestors'; only the
// element's LAYOUT reflects an ancestor being hidden), so a bare
// style-property read can't catch e.g. body.mini-mode hiding
// .chrome-header/.ns-sidebar wholesale while the sidebar
// Help button's own style is never touched. checkVisibility() is
// Chromium's purpose-built answer to "is this actually visible right
// now," including ancestor display/visibility -- called with no options
// so it stays conservative (it does not additionally reject on
// opacity/clip-path by default, so a dimmed-but-reachable control is
// never wrongly rejected). Falls back to the classic no-layout-box check
// for any environment where checkVisibility isn't available.
function isRendered(el) {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  if (typeof el.getClientRects === 'function') return el.getClientRects().length > 0;
  return !(el.style && el.style.display === 'none');
}

function openHelpPanel(restoreTarget) {
  const candidate = isSensibleFocusTarget(restoreTarget) ? restoreTarget : document.activeElement;
  helpOpenerElement = isSensibleFocusTarget(candidate) ? candidate : null;
  els.aboutModal?.classList.add('active');
  refreshUpdaterStatus();
}

function closeHelpPanel() {
  els.aboutModal?.classList.remove('active');
  // Re-validate right before use -- the recorded opener can go stale while
  // About was open -- and fall back to the sidebar Help control (always
  // present) rather than focusing something invalid or leaving focus on
  // BODY.
  const target = isSensibleFocusTarget(helpOpenerElement)
    ? helpOpenerElement
    : document.querySelector('.ns-nav-item[data-ns-tab="help"]');
  if (isSensibleFocusTarget(target)) target.focus();
  helpOpenerElement = null;
}

// Exactly one of LIB / SCH / STATS is visible at a time. Each child element's
// own conditional display logic (isIdle, has-streak, has-proof, etc.) keeps
// working independently underneath — this only toggles the panel-level wrapper.
function applyMainPanelVisibility(panel) {
  // UI-R3 Fire 02: the visible panel as a body hook (Tonight lifts toasts
  // above its readiness rail). Settings opens and closes through here too.
  if (document.body) document.body.dataset.view = panel;
  if (els.panelLib) els.panelLib.style.display = panel === 'lib' ? '' : 'none';
  if (els.panelModes) els.panelModes.style.display = panel === 'modes' ? '' : 'none';
  if (els.panelSch) els.panelSch.style.display = panel === 'sch' ? '' : 'none';
  if (els.panelDevices) els.panelDevices.style.display = panel === 'devices' ? '' : 'none';
  if (els.panelStats) els.panelStats.style.display = panel === 'stats' ? '' : 'none';
  // Settings is a full sibling panel too (see openSettingsPanel/closeSettingsPanel)
  // -- not a modal overlay, so it must be hidden here exactly like the others
  // whenever a different panel is selected by any path (sidebar, top menu, or
  // this function called directly).
  if (els.panelSet) els.panelSet.style.display = panel === 'set' ? '' : 'none';
  // UI-R3 Fire 03: mid-run the footer pill is the way back to Tonight and is
  // enabled only while Tonight is off screen, so it re-reads the visible panel
  // now (render() does not tick while paused). typeof-guarded: navigation
  // sandboxes extract this without the footer.
  if (typeof renderFooterTruth === 'function' && typeof state === 'object' && state) renderFooterTruth(!state.running && !state.paused);
  // The Schedule clock (the hero's "starts in" line) ticks only while
  // Schedule is visible. typeof-guarded like the Devices refresh below.
  if (panel === 'sch') {
    if (typeof startScheduleClock === 'function') startScheduleClock();
  } else if (typeof stopScheduleClock === 'function') {
    stopScheduleClock();
  }
  // The Devices peer refresh runs only while Devices is the visible panel.
  // typeof-guarded: navigation sandboxes extract this without the Devices code.
  if (panel === 'devices') {
    if (typeof startFamilyPeerRefresh === 'function') startFamilyPeerRefresh();
  } else if (typeof stopFamilyPeerRefresh === 'function') {
    stopFamilyPeerRefresh();
  }
}

// Proof: recent run receipts only (companion status now lives on Devices).
// Pulls only data that already exists — no new tracking, no fabricated numbers.
async function renderStatusPanel() {
  if (!els.statsSessionSummary) return;
  try {
    const receipts = await api.listReceipts?.(5);
    if (!receipts || !receipts.length) {
      els.statsSessionSummary.innerHTML = '<p class="empty-state">No session history yet.</p>';
      return;
    }
    // UI-R3 P11: each row is a button into its ledger receipt, coloured by
    // the shared RECEIPT_TONE map (renderer-receipts.js) and tagged with its
    // mode: TEST MODE for every dryRun receipt, REAL only for a command main
    // confirmed (power_executed). Clicks are delegated (#stats-session-summary).
    const toneOf = r => (typeof receiptToneOf === 'function' ? receiptToneOf(r.result).tone : 'neutral');
    els.statsSessionSummary.innerHTML = receipts.map(r => {
      const started = r.startedAt ? new Date(r.startedAt) : null;
      const valid = started && !Number.isNaN(started.getTime());
      const date = valid ? started.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—';
      const time = valid ? formatClock(started) : '';
      const name = r.nightModeTitle || r.profileName || 'Countdown';
      const mins = Math.round((Number(r.durationSeconds) || 0) / 60);
      // UI-R3 Fire 10: what actually ran ('ran <1m of 25m' / '25m' / '25m
      // planned', receiptRunDetail in renderer-receipts.js); the planned
      // length alone is the fallback.
      const duration = typeof receiptRunDetail === 'function'
        ? receiptRunDetail(r)
        : (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);
      const label = typeof humanizeReceiptResult === 'function' ? humanizeReceiptResult(r.result) : (r.result || '');
      const action = typeof receiptActionName === 'function' ? receiptActionName(r.action) : actionLabel(r.action);
      const details = [action, duration,
        r.pauseCount ? `${r.pauseCount} pause${r.pauseCount === 1 ? '' : 's'}` : '',
        r.snoozeCount ? `${r.snoozeCount} snooze${r.snoozeCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      const mode = r.dryRun ? 'test' : (r.dryRun === false && r.result === 'power_executed' ? 'real' : '');
      const tag = mode === 'test' ? '<span class="proof-tag" data-truth="test">TEST MODE</span>'
        : mode === 'real' ? '<span class="proof-tag" data-truth="real">REAL</span>'
          : '<span class="proof-tag-slot" aria-hidden="true"></span>';
      const id = typeof safeReceiptId === 'function' ? safeReceiptId(r.id) : '';
      const aria = ['Open receipt', [date, time].filter(Boolean).join(' '), name, mode === 'test' ? 'Test Mode' : (mode === 'real' ? 'Real action' : ''), label].filter(Boolean).join(', ');
      return `<button type="button" class="proof-row" data-tone="${toneOf(r)}"${id ? ` data-receipt-id="${escapeHtml(id)}"` : ''} aria-label="${escapeHtml(aria).replace(/"/g, '&quot;')}">`
        + `<span class="proof-when"><b>${escapeHtml(date)}</b><small>${escapeHtml(time)}</small></span>`
        + '<span class="proof-dot" aria-hidden="true"></span>'
        + `<span class="proof-name">${escapeHtml(name)}<small>${escapeHtml(details)}</small></span>`
        + tag
        + `<span class="proof-result">${escapeHtml(label)}</span></button>`;
    }).join('');
  } catch {
    els.statsSessionSummary.innerHTML = '<p class="empty-state">No session history yet.</p>';
  }
}

// Devices: the operational center. Each card reads one existing local status
// source; a source that fails renders "Unavailable", never a guessed value.
// data-state drives the status dot: live (connected, pulsing) | ok | warn |
// off | error.
const DEVICE_CARD_STATES = ['live', 'ok', 'warn', 'off', 'error'];
const WIFI_GUARD_METHOD_LABEL = { adapter: 'Wi-Fi adapter', tplink: 'TP-Link router', asus: 'ASUS router', netgear: 'Netgear router', webhook: 'Custom webhook', firewall: 'Unavailable' };
const LIGHTS_BEHAVIOR_LABEL = { gradual_dim: 'Gradual dim', warm_dim: 'Warm shift + dim', off_at_end: 'Off at end only' };

// One lights-readiness reading for every surface (Tonight readiness strip,
// the Last Light facts cache, the Devices card; Night Modes reuses it). It
// describes CONFIGURATION only: verified is not the same as actuated.
// tone: ok | warn | off | error.
function describeLightsReadiness(cfg) {
  if (!cfg || typeof cfg !== 'object') return { label: 'Unavailable', tone: 'error' };
  if (!cfg.enabled || !cfg.provider || cfg.provider === 'none') return { label: 'Off', tone: 'off' };
  if (cfg.verifiedConfigKey) {
    const legacy = cfg.provider === 'hue' && Boolean(cfg.hueAllowLegacyHttp);
    return {
      label: `${cfg.provider === 'wiz' ? 'WiZ' : cfg.provider === 'hue' ? 'Hue' : 'HTTP'} Ready${legacy ? ' · legacy' : ''}`,
      tone: legacy ? 'warn' : 'ok'
    };
  }
  return { label: 'Needs setup', tone: 'warn' };
}

function setDeviceCard(card, statusEl, deviceState, label) {
  if (card) card.dataset.state = DEVICE_CARD_STATES.includes(deviceState) ? deviceState : 'off';
  if (statusEl) statusEl.textContent = label;
}

// Keep badges short; endpoint readiness alone does not prove a phone connected.
// The full diagnostic remains below the Phone heading and in the rail tooltip.
function describePhoneReadiness(rc) {
  if (!rc) return { label: 'Unavailable', tone: 'error' };
  if (!rc.mode || rc.mode === 'off') return { label: 'Off', tone: 'off' };
  if (rc.failed) return { label: 'Connection failed', tone: 'error' };
  if (!rc.ready) return { label: 'Starting…', tone: 'warn' };
  if (rc.mode === 'local') return { label: 'This PC only', tone: 'ok' };
  const clients = Math.max(0, Math.floor(Number(rc.clients) || 0));
  return clients > 0 ? { label: `${clients} connected`, tone: 'live' }
    : { label: 'Waiting for phone', tone: 'ok' };
}

async function openSettingsCategory(categoryId) {
  if (!(await handleSidebarNavigation('set'))) return;
  switchSettingsCategory(categoryId);
}

let devicesRenderSeq = 0;
async function renderDevicesPanel() {
  const seq = ++devicesRenderSeq;
  const [rc, lights, wifi, peers, systemInfo] = await Promise.all([
    api.getRemoteControl?.().catch(() => null),
    api.getSmartLightConfig?.().catch(() => null),
    api.getWifiGuardSettings?.().catch(() => null),
    api.getFamilyPeers?.().catch(() => null),
    api.getSystemInfo?.().catch(() => null)
  ]);
  // A slower, older render must not overwrite a newer one.
  if (seq !== devicesRenderSeq) return;

  // This PC: the host that owns the timer and every power action.
  const warned = els.warningCard && els.warningCard.style.display !== 'none';
  const pcState = warned ? 'warn' : state.paused ? 'warn' : state.running ? 'live' : 'ok';
  const pcLabel = warned ? 'Check warnings' : state.paused ? 'Paused' : state.running ? 'Session running' : 'Ready';
  setDeviceCard(els.devicePcCard, els.devicePcStatus, pcState, pcLabel);
  if (els.devicePcName) {
    els.devicePcName.textContent = rc?.pcName || 'Host';
    // Fire 07: a real host name reads as an identifier (mono); the generic
    // fallback keeps the proportional face.
    els.devicePcName.classList.toggle('is-fallback', !rc?.pcName);
  }
  const forced = state.forceShutdown && (state.action === 'shutdown' || state.action === 'restart');
  if (els.devicePcMode) {
    els.devicePcMode.textContent = !state.settingsLoaded ? 'Checking…'
      : state.dryRun ? 'Test Mode, none will run'
      : `REAL · ${actionLabel()}${forced ? ' (forced)' : ''} at the end`;
  }
  els.devicePcMode?.classList.toggle('warn', state.settingsLoaded && state.dryRun);
  els.devicePcMode?.classList.toggle('real', state.settingsLoaded && !state.dryRun);
  if (systemInfo) applySystemInfo(systemInfo);

  // Phone Companion.
  const mode = rc?.mode || 'off';
  const phoneReadiness = describePhoneReadiness(rc);
  setDeviceCard(els.devicePhoneCard, els.statsCompanionStatus, phoneReadiness.tone, phoneReadiness.label);
  const phoneDetail = document.getElementById('device-phone-detail');
  if (phoneDetail) {
    const detail = mode !== 'off' && !rc?.failed ? rc?.statusLabel || '' : '';
    setTextIfChanged(phoneDetail, detail);
    phoneDetail.hidden = !detail;
  }
  if (els.statsCompanionMode) els.statsCompanionMode.textContent = ({ off: 'Off', local: 'This PC only', wifi: 'Same Wi-Fi' })[mode] || 'Off';
  if (els.statsCompanionNetwork) {
    els.statsCompanionNetwork.textContent = mode === 'wifi' ? `${rc.lanIp}:${rc.port}`
      : mode === 'local' ? `127.0.0.1:${rc.port}` : '—';
  }
  if (els.statsCompanionClients) els.statsCompanionClients.textContent = String(rc?.clients || 0);
  // Fire 07: a failed companion says why, in one plain line (text only,
  // written on change; cleared in every other state after the seq guard).
  if (els.devicePhoneError) {
    const reason = rc && mode !== 'off' && rc.failed ? describePhoneFailure(rc) : '';
    setTextIfChanged(els.devicePhoneError, reason);
    const tone = reason ? 'bad' : '';
    if (els.devicePhoneError.dataset.tone !== tone) els.devicePhoneError.dataset.tone = tone;
  }

  // Rejected pairing attempts: information only, the card state never changes.
  if (els.devicePhoneRejectedRow) {
    const rejected = describeRejectedPairing(rc);
    els.devicePhoneRejectedRow.hidden = !rejected;
    if (els.devicePhoneRejected) els.devicePhoneRejected.textContent = rejected;
  }

  // Family LAN: discovery only runs alongside the Same Wi-Fi companion.
  // Rows are updated in place (applyFamilyPeers) so a refresh never drops
  // an in-flight command, its result or keyboard focus.
  const familyOn = mode === 'wifi' && Boolean(rc?.ready);
  familyPeersSeq++;
  applyFamilyPeers(peers, familyOn);

  // Smart Lights: configured is not verified, and verified is not actuated.
  // The card and the Tonight readiness strip share one reading.
  const lightsReadiness = describeLightsReadiness(lights);
  setDeviceCard(els.deviceLightsCard, els.deviceLightsStatus, lightsReadiness.tone, lightsReadiness.label);
  if (els.deviceLightsProvider) {
    els.deviceLightsProvider.textContent = !lights?.enabled ? 'Not configured'
      : lights.provider === 'hue' ? `Philips Hue${lights.hueBridgeIp ? ` · ${lights.hueBridgeIp}` : ''}`
      : lights.provider === 'wiz' ? `WiZ · ${(lights.wizAddresses || []).length} light(s)`
      : lights.provider === 'http' ? 'HTTP webhook' : 'Not configured';
  }
  if (els.deviceLightsConnection) {
    els.deviceLightsConnection.textContent = !lights?.enabled ? '—'
      : lights.verifiedConfigKey ? (lights.provider === 'hue' ? (lights.hueAllowLegacyHttp ? 'Verified · HTTP' : 'Verified · HTTPS') : 'Verified')
      : 'Not verified yet';
  }
  if (els.deviceLightsBehavior) {
    els.deviceLightsBehavior.textContent = !lights?.enabled ? '—'
      : `${LIGHTS_BEHAVIOR_LABEL[lights.mode] || 'Dim'} · ${lights.dimMinutes || 10} min`;
  }
  if (els.deviceLightsLegacy) els.deviceLightsLegacy.style.display = lights?.enabled && lights.provider === 'hue' && lights.hueAllowLegacyHttp ? '' : 'none';
  applyLightsCheckVisibility(Boolean(lights?.enabled && ['hue','wiz'].includes(lights.provider)));

  // Wi-Fi Guard: only non-secret fields are read (and kept) here.
  devicesWifiSettings = wifi ? {
    enabled: Boolean(wifi.enabled),
    provider: wifi.provider,
    deviceMacs: Array.isArray(wifi.deviceMacs) ? wifi.deviceMacs : [],
    deviceIps: Array.isArray(wifi.deviceIps) ? wifi.deviceIps : [],
    unblockOnCancel: wifi.unblockOnCancel,
    // main.js applyDimPhase: anything but an explicit false blocks at wind-down.
    blockOnDim: wifi.blockOnDim !== false
  } : null;
  applyWifiGuardCard();

  // Fire 07: these fresh lights / Wi-Fi Guard reads also feed Fire 02's
  // wind-down facts (the other two sections keep their last reading), so
  // Devices, Settings and Tonight state one scope from one helper.
  if (typeof pickWindDownFacts === 'function' && typeof setWindDownFacts === 'function') {
    const known = getWindDownFacts();
    const fresh = pickWindDownFacts({ wifiGuard: wifi, lights });
    setWindDownFacts({
      app: known ? known.app : null,
      contentBlocker: known ? known.contentBlocker : null,
      wifiGuard: fresh.wifiGuard,
      lights: fresh.lights
    });
  }
  syncDeviceScopeNotes();
}

// ─── Devices helpers (outside renderDevicesPanel; listeners bound once) ─────

function describeRejectedPairing(rc) {
  const count = Number(rc?.failedAttempts) || 0;
  if (count <= 0) return '';
  return `${count}${rc.lastFailedIp ? ` · last from ${rc.lastFailedIp}` : ''}`;
}

// UI-R3 Fire 07: why the phone companion failed, in one calm line. Reads only
// rc.errorCode and rc.port: never the address, the pairing code, the raw
// error text or the port owner's process details (Settings › Phone & Network
// keeps the full detail; the card's link opens it).
const PHONE_ANSWER_FAILURES = Object.freeze(['HTTP_HEALTH_FAILED', 'PAIR_CHECK_FAILED', 'WEBSOCKET_UPGRADE_FAILED']);
function describePhoneFailure(rc) {
  const code = String((rc && rc.errorCode) || '');
  if (code === 'EADDRINUSE') {
    const port = Number(rc.port);
    return Number.isInteger(port) && port > 0
      ? `Port ${port} is already used by another app. Change the port in Phone settings.`
      : 'Its port is already used by another app. Change the port in Phone settings.';
  }
  if (PHONE_ANSWER_FAILURES.includes(code)) return 'The companion started but could not answer on this network. Check the firewall, then retry.';
  // main.js (NO_LAN_ADDRESS) says exactly this.
  if (code === 'NO_LAN_ADDRESS') return 'No usable LAN address is available. Reconnect Wi-Fi, then retry.';
  return 'The companion could not start on this network.';
}

// UI-R3 Fire 07: in Test Mode, the Lights and Wi-Fi Guard cards say that they
// still act. Visibility comes only from Fire 02's windDownEffects (main's own
// applyDimPhase / smart-light tick conditions), never from a second copy.
// Static text, written on change; hidden while settings load or outside
// Test Mode.
function syncDeviceScopeNotes() {
  const lightsNote = els.deviceLightsScope;
  const wifiNote = els.deviceWifiScope;
  if (!lightsNote && !wifiNote) return;
  const facts = typeof getWindDownFacts === 'function' ? getWindDownFacts() : null;
  const ids = facts && typeof windDownEffects === 'function' ? windDownEffects(facts).effects.map(e => e.id) : [];
  const testOn = state.settingsLoaded === true && state.dryRun === true;
  const show = (el, on) => { if (el && el.hidden !== !on) el.hidden = !on; };
  show(lightsNote, testOn && ids.includes('lights'));
  if (wifiNote) {
    const adapter = Boolean(facts && facts.wifiGuard && facts.wifiGuard.provider === 'adapter');
    const text = adapter
      ? "Runs in Test Mode too. This PC's Wi-Fi still turns off at wind-down."
      : 'Runs in Test Mode too. Chosen devices still lose internet at wind-down.';
    if (wifiNote.textContent !== text) wifiNote.textContent = text;
    show(wifiNote, testOn && ids.includes('wifi'));
  }
}

// Family peers. Commands go through main, which only sends to an address
// that announced itself. There is deliberately no Start here: starting a run
// on another PC can end in a shutdown, so it stays in Settings behind a confirm.
const DEVICE_PEER_ACTIONS = Object.freeze([
  Object.freeze({ act: 'pause', label: 'Pause', aria: 'Pause the run on', call: 'familyRemotePause' }),
  Object.freeze({ act: 'resume', label: 'Resume', aria: 'Resume the run on', call: 'familyRemoteResume' }),
  Object.freeze({ act: 'cancel', label: 'Stop run', aria: 'Stop the run on', call: 'familyRemoteCancel' })
]);
const PEER_RESULT_HOLD_MS = 6000;
const FAMILY_PEER_REFRESH_MS = 5000;
const familyPeerUi = new Map(); // ip -> { busy, result: {text, tone} | null, clearTimer }
let devicesFamilyOn = false;
let lastFamilyPeers = [];
let familyPeersSeq = 0;
let familyPeerRefreshTimer = null;
let familyPeerRefreshBusy = false;

function peerSeenText(lastSeen, now = Date.now()) {
  const t = Number(lastSeen);
  if (!Number.isFinite(t) || t <= 0) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'seen just now';
  if (s < 60) return `seen ${s}s ago`;
  return `seen ${Math.round(s / 60)} min ago`;
}

function familyPeerUiFor(ip) {
  let ui = familyPeerUi.get(ip);
  if (!ui) {
    ui = { busy: false, result: null, clearTimer: null };
    familyPeerUi.set(ip, ui);
  }
  return ui;
}

function buildDevicePeerRow(ip) {
  const li = document.createElement('li');
  li.className = 'device-peer';
  li.dataset.peerIp = ip;
  const dot = document.createElement('span');
  dot.className = 'dev-dot';
  dot.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'device-peer-name';
  const addr = document.createElement('span');
  addr.className = 'device-peer-ip';
  const seen = document.createElement('span');
  seen.className = 'device-peer-seen';
  const actions = document.createElement('span');
  actions.className = 'device-peer-actions';
  for (const a of DEVICE_PEER_ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = a.act === 'cancel' ? 'peer-act peer-act--stop' : 'peer-act';
    btn.dataset.peerAct = a.act;
    btn.textContent = a.label;
    actions.appendChild(btn);
  }
  const result = document.createElement('span');
  result.className = 'device-peer-result';
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  li.append(dot, name, addr, seen, actions, result);
  return li;
}

// Text only (textContent / setAttribute): a peer name comes from the LAN.
function updateDevicePeerRow(li, peer, familyOn) {
  const name = peer.name || 'Lights Out PC';
  const ui = familyPeerUi.get(peer.ip) || { busy: false, result: null };
  setTextIfChanged(li.querySelector('.device-peer-name'), name);
  setTextIfChanged(li.querySelector('.device-peer-ip'), peer.ip);
  setTextIfChanged(li.querySelector('.device-peer-seen'), peerSeenText(peer.lastSeen));
  const actions = li.querySelector('.device-peer-actions');
  if (actions) actions.hidden = !familyOn;
  li.querySelectorAll('button[data-peer-act]').forEach(btn => {
    const spec = DEVICE_PEER_ACTIONS.find(a => a.act === btn.dataset.peerAct);
    if (spec) btn.setAttribute('aria-label', `${spec.aria} ${name}`);
    // aria-disabled (not disabled) keeps keyboard focus on the pressed button.
    btn.setAttribute('aria-disabled', ui.busy ? 'true' : 'false');
  });
  li.classList.toggle('is-busy', Boolean(ui.busy));
  const result = li.querySelector('.device-peer-result');
  if (result) {
    setTextIfChanged(result, ui.result ? ui.result.text : '');
    result.dataset.tone = ui.result ? ui.result.tone : '';
  }
}

function devicePeerRow(ip) {
  if (!els.deviceFamilyPeers) return null;
  return [...els.deviceFamilyPeers.children].find(li => li.dataset.peerIp === ip) || null;
}

function applyFamilyPeers(peers, familyOn) {
  devicesFamilyOn = Boolean(familyOn);
  const peerList = (Array.isArray(peers) ? peers : [])
    .filter(p => p && typeof p.ip === 'string' && p.ip);
  lastFamilyPeers = peerList;
  setDeviceCard(els.deviceFamilyCard, els.deviceFamilyStatus,
    !devicesFamilyOn ? 'off' : peerList.length ? 'live' : 'ok',
    !devicesFamilyOn ? 'Off' : peerList.length ? `${peerList.length} found` : 'Listening');
  setTextIfChanged(els.deviceFamilyDiscovery, devicesFamilyOn ? 'On this network' : 'Needs Same Wi-Fi companion');
  setTextIfChanged(els.deviceFamilyCount, String(peerList.length));
  const list = els.deviceFamilyPeers;
  if (!list) return;
  const existing = new Map([...list.children].map(li => [li.dataset.peerIp, li]));
  const keep = new Set();
  peerList.forEach((peer, index) => {
    let li = existing.get(peer.ip);
    if (!li) li = buildDevicePeerRow(peer.ip);
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] || null);
    updateDevicePeerRow(li, peer, devicesFamilyOn);
    keep.add(peer.ip);
  });
  for (const [ip, li] of existing) if (!keep.has(ip)) li.remove();
  // An expired peer's UI state goes too, unless its command is still in flight.
  for (const [ip, ui] of familyPeerUi) {
    if (!keep.has(ip) && !ui.busy) {
      clearTimeout(ui.clearTimer);
      familyPeerUi.delete(ip);
    }
  }
}

function refreshDevicePeerRow(ip) {
  const li = devicePeerRow(ip);
  const peer = lastFamilyPeers.find(p => p.ip === ip);
  if (li && peer) updateDevicePeerRow(li, peer, devicesFamilyOn);
}

async function runDevicePeerAction(ip, act) {
  const spec = DEVICE_PEER_ACTIONS.find(a => a.act === act);
  if (!spec) return;
  const ui = familyPeerUiFor(ip);
  if (ui.busy) return;
  ui.busy = true;
  clearTimeout(ui.clearTimer);
  ui.result = { text: 'Sending…', tone: 'muted' };
  refreshDevicePeerRow(ip);
  let answer;
  let failure = null;
  try {
    answer = await api[spec.call]?.(ip);
  } catch (err) {
    failure = err || new Error('failed');
  }
  ui.busy = false;
  ui.result = interpretPeerResult(answer, failure);
  ui.clearTimer = setTimeout(() => {
    ui.result = null;
    refreshDevicePeerRow(ip);
  }, PEER_RESULT_HOLD_MS);
  refreshDevicePeerRow(ip);
}

els.deviceFamilyPeers?.addEventListener('click', (event) => {
  const btn = event.target.closest?.('button[data-peer-act]');
  if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
  const ip = btn.closest('.device-peer')?.dataset.peerIp;
  if (ip) void runDevicePeerAction(ip, btn.dataset.peerAct);
});

// While Devices is visible: re-read the peer list every 5 s so 'seen' times
// and expiry stay true. Stopped as soon as another panel is shown.
async function refreshFamilyPeers() {
  if (!els.panelDevices || els.panelDevices.style.display === 'none') {
    stopFamilyPeerRefresh();
    return;
  }
  if (document.hidden || familyPeerRefreshBusy) return;
  // No IPC: keeps Restore in step with a run that started or ended.
  applyWifiGuardCard();
  familyPeerRefreshBusy = true;
  const seq = ++familyPeersSeq;
  try {
    const peers = await api.getFamilyPeers?.();
    // A failed read changes nothing; a newer read wins.
    if (seq === familyPeersSeq && Array.isArray(peers)) applyFamilyPeers(peers, devicesFamilyOn);
  } catch {
    // keep the rows as they are
  } finally {
    familyPeerRefreshBusy = false;
  }
}

function startFamilyPeerRefresh() {
  if (familyPeerRefreshTimer) return;
  familyPeerRefreshTimer = setInterval(() => { void refreshFamilyPeers(); }, FAMILY_PEER_REFRESH_MS);
}

function stopFamilyPeerRefresh() {
  if (!familyPeerRefreshTimer) return;
  clearInterval(familyPeerRefreshTimer);
  familyPeerRefreshTimer = null;
}

// Smart Lights connection check: PASSIVE only (api.testSmartLightConnection
// reads the bridge and never changes a light). The result is shown, never
// saved, and never changes the card state.
let lightsCheckBusy = false;

function applyLightsCheckVisibility(available) {
  if (els.btnDeviceLightsCheck) els.btnDeviceLightsCheck.hidden = !available;
  if (!available && els.deviceLightsCheckResult) {
    els.deviceLightsCheckResult.textContent = '';
    els.deviceLightsCheckResult.dataset.tone = '';
  }
}

els.btnDeviceLightsCheck?.addEventListener('click', async () => {
  if (lightsCheckBusy) return;
  lightsCheckBusy = true;
  const btn = els.btnDeviceLightsCheck;
  const out = els.deviceLightsCheckResult;
  btn.setAttribute('aria-disabled', 'true');
  btn.textContent = 'Checking…';
  if (out) { out.textContent = ''; out.dataset.tone = ''; }
  let text = 'Could not check the bridge';
  let tone = 'bad';
  try {
    const r = await api.testSmartLightConnection?.();
    if (r && typeof r.message === 'string' && r.message) text = r.message;
    tone = r?.success ? 'ok' : 'warn';
  } catch {
    // text/tone stay at the failure reading
  }
  if (out) { out.textContent = text; out.dataset.tone = tone; }
  btn.textContent = 'Check connection';
  btn.setAttribute('aria-disabled', 'false');
  lightsCheckBusy = false;
});

// Wi-Fi Guard "Right now": what actually happened this session. Set ONLY by
// a wifi-guard-status event from main or a successful block/unblock result
// (noteWifiGuardLive); settings alone never claim that internet is paused.
let devicesWifiSettings; // undefined until Devices first reads it; null = the read failed
let wifiRestoreBusy = false;

function noteWifiGuardLive(blocked) {
  window.wifiGuardLive = { blocked: Boolean(blocked), at: Date.now() };
  applyWifiGuardCard();
}

function applyWifiGuardCard() {
  const wifi = devicesWifiSettings;
  const live = window.wifiGuardLive;
  const blockedNow = Boolean(live && live.blocked);
  // Fire 07: 'Armed' only when main's applyDimPhase would really block:
  // enabled, blockOnDim not false, and the adapter or a LAN provider with a
  // listed device. The adapter ignores the list and turns off this PC's own
  // Wi-Fi, so its row and note say that instead.
  let adapterNote = false;
  let adapterRow = false;
  if (wifi === undefined) {
    // Not read yet: only the live row below is written.
  } else if (!wifi) {
    setDeviceCard(els.deviceWifiCard, els.deviceWifiStatus, blockedNow ? 'warn' : 'error', blockedNow ? 'Internet paused' : 'Unavailable');
  } else {
    // A selected device is stored as a MAC + IP pair: count devices, not fields.
    const listed = Math.max(Array.isArray(wifi.deviceMacs) ? wifi.deviceMacs.length : 0, Array.isArray(wifi.deviceIps) ? wifi.deviceIps.length : 0);
    const autoBlock = wifi.blockOnDim !== false;
    const adapter = wifi.provider === 'adapter';
    adapterRow = Boolean(wifi.enabled) && adapter;
    adapterNote = adapterRow && autoBlock;
    let cardState;
    let cardLabel;
    if (blockedNow) { cardState = 'warn'; cardLabel = 'Internet paused'; }
    else if (!wifi.enabled) { cardState = 'off'; cardLabel = 'Off'; }
    else if (adapter) { cardState = autoBlock ? 'ok' : 'warn'; cardLabel = autoBlock ? "Armed · this PC's Wi-Fi" : 'Manual only'; }
    else if (!autoBlock) { cardState = 'warn'; cardLabel = 'Manual only'; }
    else if (!WIND_DOWN_LAN_PROVIDERS.includes(wifi.provider)) { cardState = 'warn'; cardLabel = 'Method not supported'; }
    else { cardState = listed ? 'ok' : 'warn'; cardLabel = listed ? 'Armed for wind-down' : 'No devices listed'; }
    setDeviceCard(els.deviceWifiCard, els.deviceWifiStatus, cardState, cardLabel);
    if (els.deviceWifiCard) els.deviceWifiCard.dataset.listed = listed > 0 ? '1' : '0';
    setTextIfChanged(els.deviceWifiMethod, wifi.enabled ? (WIFI_GUARD_METHOD_LABEL[wifi.provider] || wifi.provider || '—') : '—');
    setTextIfChanged(els.deviceWifiCount, adapterRow ? "This PC's Wi-Fi" : String(listed));
  }
  // The label follows the provider in every path (reset unless the adapter).
  setTextIfChanged(els.deviceWifiCountLabel, adapterRow ? 'Turns off' : 'Devices listed');
  if (els.deviceWifiAdapterNote && els.deviceWifiAdapterNote.hidden !== !adapterNote) els.deviceWifiAdapterNote.hidden = !adapterNote;
  if (els.deviceWifiNow) {
    els.deviceWifiNow.textContent = !live ? '— (no change this session)'
      : live.blocked ? `Internet paused since ${formatEndTime(new Date(live.at).toISOString())}`
      : `Internet restored ${formatEndTime(new Date(live.at).toISOString())}`;
    els.deviceWifiNow.classList.toggle('warn', blockedNow);
  }
  // Restore only while paused AND no run is active: during a run the run
  // owns the guard, so point to Cancel instead.
  const runActive = Boolean(state.running || state.paused);
  if (els.btnDeviceWifiRestore) els.btnDeviceWifiRestore.hidden = !blockedNow || runActive;
  if (els.deviceWifiRestoreResult && blockedNow && runActive && !wifiRestoreBusy) {
    // main restores on cancel or end only when the guard is on with
    // 'Restore internet when timer is cancelled' checked.
    els.deviceWifiRestoreResult.textContent = wifi && wifi.enabled && wifi.unblockOnCancel !== false
      ? 'A run is active. Cancelling it, or its end, restores internet.'
      : 'A run is active. Restore here once it ends.';
    els.deviceWifiRestoreResult.dataset.tone = 'muted';
  } else if (els.deviceWifiRestoreResult && els.deviceWifiRestoreResult.dataset.tone === 'muted') {
    els.deviceWifiRestoreResult.textContent = '';
    els.deviceWifiRestoreResult.dataset.tone = '';
  }
}

els.btnDeviceWifiRestore?.addEventListener('click', async () => {
  if (wifiRestoreBusy) return;
  wifiRestoreBusy = true;
  const btn = els.btnDeviceWifiRestore;
  const out = els.deviceWifiRestoreResult;
  btn.setAttribute('aria-disabled', 'true');
  btn.textContent = 'Restoring…';
  if (out) { out.textContent = ''; out.dataset.tone = ''; }
  let text = 'Could not restore internet';
  let tone = 'bad';
  let restored = false;
  try {
    const r = await api.wifiGuardUnblock?.();
    if (r?.success) {
      restored = true;
      text = 'Internet restored';
      tone = 'ok';
    } else {
      text = r?.error ? `Not restored: ${r.error}` : 'Wi-Fi Guard not configured';
      tone = 'warn';
    }
  } catch {
    // text/tone stay at the failure reading
  }
  btn.textContent = 'Restore internet now';
  btn.setAttribute('aria-disabled', 'false');
  wifiRestoreBusy = false;
  // Never optimistic: the live state changes only on a real success.
  if (restored) noteWifiGuardLive(false);
  if (out) { out.textContent = text; out.dataset.tone = tone; }
});

els.btnDevicesRefresh?.addEventListener('click', () => { void renderDevicesPanel(); });
// Live: re-read when the companion broadcasts a change while Devices is open.
api.onRemoteControlStatus?.(() => {
  if (els.panelDevices && els.panelDevices.style.display !== 'none') void renderDevicesPanel();
});
document.querySelectorAll('[data-devices-settings]').forEach(btn => {
  btn.addEventListener('click', () => openSettingsCategory(btn.dataset.devicesSettings));
});

// Footer truth bar: a shortcut to where the mode is changed. It never toggles
// state.dryRun itself -- switching to REAL stays an explicit act in Settings.
// UI-R3 Fire 03: during a session it is the way back to the session instead
// (enabled only while Tonight is off screen; see renderFooterTruth): it opens
// Tonight and returns, never Settings and never the mode switch mid-run.
// render() keeps it disabled until settings are loaded.
els.statusPill?.addEventListener('click', async () => {
  if (els.statusPill.disabled) return;
  if (state.running || state.paused) { await handleSidebarNavigation('lib'); return; }
  await openSettingsCategory('power-safety');
  if (els.panelSet && els.panelSet.style.display !== 'none') els.chkDryRun?.focus();
});

// UI-R3 Fire 03: a readiness cell opens the place where you fix it. Phone and
// Network land on the Phone card (Network's value is the companion's remote
// mode), Lights on the Lights card, each with a brief static outline; Safety
// takes the footer pill's idle path (Power & Safety, focus on Test Mode).
// Idle only: render() disables the rows during a session and this re-checks.
// It navigates and never reads or writes the mode.
const RDY_DEVICE_TARGETS = ['device-card-phone', 'device-card-lights'];
let rdyFocusTimer = null;
let rdyFocusCard = null;
async function openReadinessTarget(go) {
  if (state.running || state.paused) return false;
  if (go === 'settings:power-safety') {
    await openSettingsCategory('power-safety');
    if (els.panelSet && els.panelSet.style.display !== 'none') els.chkDryRun?.focus();
    return true;
  }
  if (!RDY_DEVICE_TARGETS.includes(go)) return false;
  if (await handleSidebarNavigation('devices') !== true) return false;
  const card = document.getElementById(go);
  if (!card) return false;
  if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  card.focus?.({ preventScroll: true });
  // One highlight at a time: a repeat click restarts it on the new card.
  clearTimeout(rdyFocusTimer);
  rdyFocusCard?.classList.remove('is-focus');
  card.classList.add('is-focus');
  rdyFocusCard = card;
  rdyFocusTimer = setTimeout(() => {
    card.classList.remove('is-focus');
    if (rdyFocusCard === card) rdyFocusCard = null;
    rdyFocusTimer = null;
  }, 1200);
  return true;
}
document.getElementById('readiness-strip')?.addEventListener('click', (event) => {
  const row = event.target?.closest?.('.rdy-row[data-rdy-go]');
  if (!row || row.disabled) return;
  void openReadinessTarget(row.dataset.rdyGo);
});

// UI-R1 readiness strip: Phone/Lights/Network/Safety from REAL status
// sources — same data the stats panel already uses, no new telemetry.
// Async + debounced (render() runs every tick while a timer is active).
let readinessFetchedAt = 0;
// Smart-lights CONFIGURATION summary for the Last Light facts panel
// (renderer-lastlight-alarm.js). Describes setup only, never actuation.
let lastLightsSummary = '—'; // eslint-disable-line no-unused-vars -- read by renderer-lastlight-alarm.js
// Set while an exit from the fullscreen clock is in flight (render() asks for
// it once a session is active); cleared when fullscreen actually ends, or by
// the retry timer below if the IPC was lost, so render() asks again.
let fullscreenExitPending = false;
let fullscreenExitRetryTimer = null;
const FULLSCREEN_EXIT_RETRY_MS = 1500;

// Global timer shortcuts (Space, presets 1-6) must never start a run from
// behind something that owns the keyboard: first-run onboarding (where the
// Test Mode / Real choice has not been made yet) or any open dialog.
function timerShortcutSurfaceBlocked(doc = document) {
  const onboarding = doc.getElementById('onboarding');
  if (onboarding && onboarding.style.display !== 'none') return true;
  return Boolean(doc.querySelector('.modal.active'));
}
// Space is a timer shortcut only when the focused element does not own it:
// buttons (incl. the footer truth bar and the onboarding mode choices),
// links, summaries, text fields and editable or role=button elements keep
// their native Space activation. One exception: a run-start control (a
// duration chip or the Tonight Start button) keeps focus after its one-tap
// start, but while a run is active it has nothing to do (the single-run guard
// refuses a second start), so Space there falls through to pause/resume.
function spaceOwnedByFocus(target) {
  if (!target || target.nodeType !== 1) return false;
  if ((state.running || state.paused) && target.closest?.('.chips-row > .chip[data-min], #ns-play-btn')) return false;
  if (/^(BUTTON|A|SUMMARY|TEXTAREA|INPUT|SELECT)$/.test(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.('button, a[href], summary, textarea, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="radio"]'));
}
// Readiness Safety tile: synchronous, no IPC, so render() can keep it truthful
// on every frame without polling the network status below.
function updateReadinessSafety() {
  if (!els.rdySafety) return;
  // One truth grammar: Test Mode is amber, a REAL action is red. Before the
  // saved settings are applied it reads "Checking…" in muted text.
  const warned = els.warningCard && els.warningCard.style.display !== 'none';
  const eff = state.armedNightMode?.action || state.action;
  const safetyText = !state.settingsLoaded ? 'Checking…'
    : warned ? (state.dryRun ? 'Warnings · Test Mode' : 'Warnings · REAL')
    : (state.dryRun ? 'Test Mode' : `REAL · ${actionLabel(eff)}`);
  if (els.rdySafety.textContent !== safetyText) els.rdySafety.textContent = safetyText;
  els.rdySafety.classList.toggle('warn', state.settingsLoaded && state.dryRun);
  els.rdySafety.classList.toggle('real', state.settingsLoaded && !state.dryRun);
}

async function updateReadiness(force = false) {
  if (!els.rdyPhone) return;
  updateReadinessSafety();
  const now = Date.now();
  if (!force && now - readinessFetchedAt < 5000) return;
  readinessFetchedAt = now;
  // "Controls" on the plan (P06): what can operate this plan, from the same
  // two verified reads. It never claims the power action reaches another PC.
  let reachRc = null;
  let reachLights = null;
  try {
    const rc = await api.getRemoteControl?.();
    reachRc = rc || null;
    const mode = rc?.mode || 'off';
    if (els.rdyPhone) {
      const phone = describePhoneReadiness(rc);
      els.rdyPhone.textContent = phone.label;
      els.rdyPhone.title = rc?.statusLabel || phone.label;
      els.rdyPhone.classList.toggle('ok', phone.tone === 'ok' || phone.tone === 'live');
      els.rdyPhone.classList.toggle('warn', phone.tone === 'warn');
      els.rdyPhone.classList.toggle('real', phone.tone === 'error');
    }
    if (els.rdyNetwork) {
      els.rdyNetwork.textContent = mode === 'wifi' ? `Local · ${rc.lanIp}`
        : mode === 'local' ? 'This PC only' : 'Local only';
    }
  } catch {
    if (els.rdyPhone) {
      els.rdyPhone.textContent = 'Unavailable';
      els.rdyPhone.title = 'Phone status could not be read';
      els.rdyPhone.classList.remove('ok', 'warn');
      els.rdyPhone.classList.add('real');
    }
  }
  try {
    const lights = await api.getSmartLightConfig?.();
    reachLights = lights || null;
    // Same reading as the Devices card (describeLightsReadiness).
    const lightsReadiness = describeLightsReadiness(lights);
    lastLightsSummary = lightsReadiness.label;
    if (els.rdyLights) {
      els.rdyLights.textContent = lightsReadiness.label;
      els.rdyLights.classList.toggle('ok', lightsReadiness.tone === 'ok');
      els.rdyLights.classList.toggle('warn', lightsReadiness.tone === 'warn');
    }
  } catch {
    const lightsReadiness = describeLightsReadiness(null);
    lastLightsSummary = lightsReadiness.label;
    if (els.rdyLights) {
      els.rdyLights.textContent = lightsReadiness.label;
      els.rdyLights.classList.remove('ok', 'warn');
    }
  }
  setTextIfChanged(document.getElementById('ns-meta-reach'), planReachText(reachRc, reachLights));
}

function planReachText(rc, lights) {
  try {
    const clients = Number(rc?.clients) || 0;
    return 'This PC'
      + (rc && rc.mode && rc.mode !== 'off' && clients > 0 ? ` + ${clients} connected device${clients > 1 ? 's' : ''}` : '')
      + (lights?.enabled && lights.verifiedConfigKey ? ' + Lights' : '');
  } catch {
    return 'This PC';
  }
}

// v11.2 Navigation Foundation: the set of modal/drawer overlays that a
// top-level navigation request may close deterministically before
// switching the underlying screen. Each entry is safe to dismiss with no
// side effect beyond hiding it (or, for the LAN warning, clicking its own
// Cancel/decline button -- the same non-destructive outcome Escape
// already gives it).
//
// Deliberately EXCLUDED, and left untouched by navigation: warning-modal
// (an active, time-sensitive countdown toward a real power action),
// override-modal and snooze-tax-modal (consequence-acknowledgment flows
// tied to that same real countdown), and ritual-overlay (an in-progress
// guided ritual that Escape only ever dismisses via an explicit, awaited
// api.ritualCancel() call). Navigating to a different sidebar tab must
// never silently discard any of those -- so it doesn't touch them at
// all; they keep their pre-existing Escape-only handling, completely
// unchanged. Unlike the modals below, though, navigation doesn't just
// leave them alone while switching the screen underneath -- see
// NAV_BLOCKING_MODAL_IDS and findActiveBlockingModal() further down:
// while any of these is active, page-level navigation is refused
// outright, so the user can never lose track of an active safety
// decision by switching screens out from under it.
const NAV_DISMISSIBLE_MODALS = [
  { get: () => els.profilesModal, close: el => el.classList.remove('active') },
  {
    get: () => els.receiptsModal,
    close: el => {
      el.classList.remove('active');
      // UI-R3 P11: navigation also cancels an open Delete-all confirm.
      if (typeof resetReceiptsClearConfirm === 'function') resetReceiptsClearConfirm();
    }
  },
  { get: () => els.aboutModal, close: el => el.classList.remove('active') },
  {
    get: () => document.getElementById('notif-drawer'),
    close: el => {
      el.classList.remove('active');
      document.getElementById('btn-notif')?.setAttribute('aria-expanded', 'false');
    }
  },
  { get: () => document.getElementById('streak-celebration-modal'), close: el => el.classList.remove('active') },
  // Matches Escape's existing lan-warning-modal handling: decline, don't
  // just hide -- clicking Cancel is the safe, non-destructive outcome
  // (it never enables the LAN-exposed companion server).
  { get: () => document.getElementById('lan-warning-modal'), close: () => document.getElementById('btn-lan-warning-cancel')?.click() }
];

// Closes every currently-open dismissible modal/drawer (see
// NAV_DISMISSIBLE_MODALS above), and if keyboard focus was inside one of
// them, moves it off the now-hidden element so it doesn't stay trapped on
// something no longer visible. Returns the list of ids actually closed
// (empty if nothing was open) -- used by tests and available for callers
// that want to know whether anything happened.
//
// This is the ONE place navigation-triggered modal dismissal is
// implemented -- handleSidebarNavigation() below calls it once, rather
// than every individual nav control independently deciding to close
// modals itself.
function closeAnyDismissibleModal() {
  const closed = [];
  for (const modal of NAV_DISMISSIBLE_MODALS) {
    const el = modal.get();
    if (!el || !el.classList.contains('active')) continue;
    const hadFocusInside = typeof el.contains === 'function' && document.activeElement && el.contains(document.activeElement);
    modal.close(el);
    if (hadFocusInside && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    closed.push(el.id || null);
  }
  return closed;
}

// The four modals representing active power-safety, confirmation,
// snooze-tax, or in-progress ritual state (see NAV_DISMISSIBLE_MODALS'
// comment above for why each one specifically cannot be auto-dismissed).
// handleSidebarNavigation() refuses to navigate at all while any of these
// is open -- see findActiveBlockingModal() below.
const NAV_BLOCKING_MODAL_IDS = ['warning-modal', 'override-modal', 'snooze-tax-modal', 'ritual-overlay'];

// Returns the first currently-active blocking modal element (see
// NAV_BLOCKING_MODAL_IDS), or null if none is open.
function findActiveBlockingModal() {
  for (const id of NAV_BLOCKING_MODAL_IDS) {
    const el = document.getElementById(id);
    if (el?.classList.contains('active')) return el;
  }
  return null;
}

async function handleSidebarNavigation(tab, { persist = true, restoreTarget = null, focusNav = true } = {}) {
  // Required navigation invariant: if a modal represents active
  // power-safety, confirmation, snooze-tax, or in-progress ritual state
  // that cannot be safely dismissed automatically (see
  // NAV_BLOCKING_MODAL_IDS below), page-level navigation is refused
  // outright until the user resolves it through the modal's own
  // controls -- underlying destination, nav indicator, modal, and
  // plan/power state all stay exactly as they were. Checked before
  // anything else runs, so a blocked request has zero side effects.
  const blockingModal = findActiveBlockingModal();
  if (blockingModal) {
    notify('Finish or dismiss the current alert before navigating', 'warning');
    return false;
  }

  // Required navigation invariant: before a page-level transition
  // completes, any dismissible blocking modal/drawer left open from
  // wherever the user was is cleared first -- deterministically, from
  // this one central path, not by scattering modal-close calls across
  // every nav control. See NAV_DISMISSIBLE_MODALS above for exactly what
  // this does and does not close.
  closeAnyDismissibleModal();

  let handled = false;

  if (tab === 'lib') {
    applyMainPanelVisibility('lib');
    // typeof-guarded: navigation unit-test sandboxes extract this handler
    // without the readiness machinery.
    if (typeof updateReadiness === 'function') void updateReadiness(true);
    // Fire 02: Tonight's Test Mode note re-reads what the wind-down will do.
    if (typeof refreshWindDownFacts === 'function') void refreshWindDownFacts();
    handled = true;
  }
  if (tab === 'modes') {
    applyMainPanelVisibility('modes');
    // An open detail re-reads Test Mode / REAL and the armed label.
    if (typeof renderDetailTruth === 'function') renderDetailTruth();
    handled = true;
  }
  if (tab === 'sch') {
    applyMainPanelVisibility('sch');
    // typeof-guarded: navigation sandboxes extract this router without the
    // Schedule renderer (renderer-calendar.js).
    if (typeof renderSchedulePage === 'function') void renderSchedulePage();
    handled = true;
  }
  if (tab === 'set') {
    openSettingsPanel();
    handled = true;
  }
  if (tab === 'help') {
    // Help/About is a modal action, not a page destination -- it must
    // never claim current-view truth. Whatever page is actually current
    // underneath (Tonight/Modes/Schedule/Settings) stays current, both
    // visually (.active) and for assistive tech (aria-current); this
    // deliberately returns before the setSidebarSelection(tab) call
    // below, which every real destination still goes through.
    openHelpPanel(restoreTarget);
    return true;
  }
  if (tab === 'devices') {
    applyMainPanelVisibility('devices');
    // typeof-guarded like updateReadiness above: navigation sandboxes
    // extract this router without the device-status machinery.
    if (typeof renderDevicesPanel === 'function') void renderDevicesPanel();
    if (typeof startFamilyPeerRefresh === 'function') startFamilyPeerRefresh();
    handled = true;
  }
  if (tab === 'stats') {
    applyMainPanelVisibility('stats');
    renderStatusPanel();
    // UI-R3 P11: the hero and the 14-night strip re-read the receipts every
    // time Proof opens (the hero still un-hides only while idle).
    if (typeof renderNightStrip === 'function') void renderNightStrip();
    if (typeof loadMorningProof === 'function') void loadMorningProof();
    // Proof › Routine (streaks + the deficit estimate) refreshes on arrival.
    // typeof-guarded: navigation sandboxes extract this router without them.
    if (typeof loadStreaks === 'function') loadStreaks();
    if (typeof loadSleepDebt === 'function') loadSleepDebt();
    handled = true;
  }

  if (!handled) {
    notify('Coming soon', 'info');
    return false;
  }

  setSidebarSelection(tab);
  if (persist && ['lib', 'modes', 'sch', 'devices', 'stats'].includes(tab)) {
    try { api.saveAppSettings({ app: { nsActiveTab: tab } }); } catch (_) {}
  }
  // Land focus on the now-current nav item -- covers the case where
  // closeAnyDismissibleModal() above just blurred focus off a closed
  // modal (or navigation was triggered some other way than a direct
  // mouse click, which would already have focused this button itself).
  // UI-R3 Fire 03: the launch restore and the fullscreen entry pass
  // focusNav: false, so no keyboard focus ring is painted on the rail
  // before the user has touched anything. Every other path keeps it.
  if (focusNav) document.querySelector(`.ns-nav-item[data-ns-tab="${tab}"]`)?.focus();
  return true;
}

els.btnStatsViewLedger?.addEventListener('click', () => openReceiptsLedger());

// UI-R3 P11: a Session History row opens the ledger and lands on its receipt
// with a short focus outline (static; the outline itself never animates).
els.statsSessionSummary?.addEventListener('click', async (event) => {
  const row = event.target && typeof event.target.closest === 'function' ? event.target.closest('.proof-row') : null;
  if (!row) return;
  const id = row.dataset.receiptId || '';
  if (await openReceiptsLedger() !== true || !id) return;
  // Scroll, outline for 900 ms (renderer-receipts.js, shared with Open receipt).
  focusLedgerReceipt(id);
});

// One refresh for every Proof surface that reads receipts: the history rows,
// the hero, the 14-night strip and Tonight's morning note. Each piece is
// typeof-guarded (navigation sandboxes extract parts of this file alone).
function refreshProofSurfaces() {
  if (typeof renderStatusPanel === 'function') void renderStatusPanel();
  if (typeof loadMorningProof === 'function') void loadMorningProof();
  if (typeof renderNightStrip === 'function') void renderNightStrip();
  if (typeof refreshMorningNote === 'function') void refreshMorningNote();
}

// formatIdleClockTime / formatClock live in renderer-utils.js (UI-R3 Fire 02):
// every desktop clock string follows the 12h/24h setting from one place.

function formatIdleClockDate(now, compact = false) {
  return now.toLocaleDateString('en-US', compact
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric' });
}

// Footer truth bar: the mode (data-truth: test amber / real red / checking
// neutral), the phase, and the real remaining time. className is reset on
// every render, so the truth styling hangs off the id + data attributes.
// UI-R3 Fire 02: idle, #status-text always names the mode, and a recent
// outcome is only a word in the time slot ('Done' / 'Cancelled'), shown only
// while it agrees with the current mode (a run's outcome never sits beside a
// mode it did not have). The agreement is computed here, never written back.
function renderFooterTruth(isIdle) {
  if (!els.statusPill) return;
  const pill = els.statusPill;
  pill.className = 'status-pill';
  pill.dataset.truth = !state.settingsLoaded ? 'checking' : (state.dryRun ? 'test' : 'real');
  // Idle: the shortcut to Settings › Power & Safety. UI-R3 Fire 03: during a
  // session it is the way back to Tonight, so it is enabled only while Tonight
  // is off screen (no panel element counts as on screen: stays disabled).
  const tonightVisible = !els.panelLib || els.panelLib.style.display !== 'none';
  pill.disabled = !state.settingsLoaded || (!isIdle && tonightVisible);
  const outcomeKind = isIdle && state.settingsLoaded && state.lastOutcome && state.lastOutcomeTestMode === (state.dryRun === true) ? state.lastOutcome : null;
  // The class is a styling hook: 'complete' only for a REAL completion.
  const outcomePill = outcomeKind && {
    completed: { cls: state.dryRun ? 'dryrun' : 'complete', slot: 'Done' },
    dryrun: { cls: 'dryrun', slot: 'Done' },
    cancelled: { cls: 'cancelled', slot: 'Cancelled' }
  }[outcomeKind];
  if (els.statusTime) {
    let hidden = isIdle;
    let timeText = isIdle ? '' : formatTime(state.remainingSeconds);
    let phase = state.paused ? 'paused' : ({ dim: 'dim', lastlight: 'lastlight' }[state.phase] || 'running');
    if (outcomePill) {
      hidden = false;
      timeText = outcomePill.slot;
      phase = 'outcome';
    }
    if (els.statusTime.hidden !== hidden) els.statusTime.hidden = hidden;
    if (els.statusTime.textContent !== timeText) els.statusTime.textContent = timeText;
    if (els.statusTime.dataset.phase !== phase) els.statusTime.dataset.phase = phase;
  }
  let statusText;
  if (isIdle) {
    statusText = !state.settingsLoaded ? 'Checking mode…'
      : state.dryRun ? 'Test Mode' : `Real · ${actionLabel()}`;
    if (outcomePill) pill.classList.add(outcomePill.cls);
    else if (state.settingsLoaded && state.dryRun) pill.classList.add('dryrun');
  } else if (state.paused) {
    pill.classList.add('paused');
    if (state.dryRun) pill.classList.add('dryrun');
    statusText = state.dryRun ? 'Test Mode · Paused' : 'Real · Paused';
  } else {
    const phaseClass = state.phase === 'dim' ? 'dim' : state.phase === 'lastlight' ? 'lastlight' : 'running';
    pill.classList.add(phaseClass);
    if (state.dryRun) pill.classList.add('dryrun');
    // 'Focus' belongs to Focus Sessions only: a session's first phase is Running.
    const labels = { focus: 'Running', dim: 'Winding Down', lastlight: 'Last Light', idle: 'Running' };
    const phaseLabel = labels[state.phase] || 'Running';
    statusText = state.dryRun ? `Test Mode · ${phaseLabel}` : `Real · ${phaseLabel}`;
  }
  if (els.statusText && els.statusText.textContent !== statusText) els.statusText.textContent = statusText;
  // The accessible name names the mode exactly once, then the phase / time or
  // the last outcome, plus, only while the pill is enabled, where it goes:
  // Settings when idle, Tonight during a session.
  const modeWords = !state.settingsLoaded ? '' : (state.dryRun ? 'Test Mode on' : 'Real actions on');
  let pillLabel;
  if (outcomePill) {
    pillLabel = `${modeWords}, last session ${outcomePill.slot.toLowerCase()}`;
  } else {
    const visibleLabel = [statusText, els.statusTime && !els.statusTime.hidden ? els.statusTime.textContent : ''].filter(Boolean).join(' ');
    const namesMode = !modeWords || visibleLabel.startsWith(state.dryRun ? 'Test Mode' : 'Real');
    pillLabel = `${visibleLabel}${namesMode ? '' : ` · ${modeWords}`}`;
  }
  if (!pill.disabled) pillLabel += isIdle ? ', change in Settings' : ', open Tonight';
  if (pill.getAttribute('aria-label') !== pillLabel) pill.setAttribute('aria-label', pillLabel);
}

// UI-R3 Fire 04: main's computePhase checks grace first, so a run has a
// winding-down phase only when its 25% mark comes before the grace window.
// Unknown grace (null) draws nothing.
function hasWindingDownStation() {
  if (!(state.running || state.paused)) return false;
  if (state.runGraceMinutes === null || state.runGraceMinutes === undefined) return false;
  const total = Number(state.totalSeconds);
  const grace = Number(state.runGraceMinutes);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(grace) || grace < 0) return false;
  return 0.25 * total > grace * 60;
}

// UI-R3 Fire 04: one name per session. Marks #timer-name .is-default while
// its text is empty or the stored default; presentation only (never writes
// the name, state.timerName or settings) and leaves a focused edit alone.
function syncTimerNameDefault() {
  const nameEl = els.timerName;
  if (!nameEl) return;
  if (typeof document !== 'undefined' && document.activeElement === nameEl) return;
  const text = String(nameEl.textContent || '').trim();
  nameEl.classList.toggle('is-default', text === '' || text === DEFAULT_TIMER_NAME);
}

function render() {
  const isIdle = !state.running && !state.paused;
  // UI-R3 P07 completion hold: for 8 s after main reports a completion the
  // face reads 0:00 on an empty arc (no bezel, no clock) while the lamp is out.
  const outcomeHold = isIdle && (state.lastOutcome === 'completed' || state.lastOutcome === 'dryrun');
  const displaySeconds = state.running || state.paused ? state.remainingSeconds : (outcomeHold ? 0 : inputSeconds());
  const totalSeconds = state.running || state.paused ? state.totalSeconds : (outcomeHold ? 1 : displaySeconds);
  const idleClockVisible = isIdle && state.clockMode && !outcomeHold;
  // The fullscreen clock is idle-only: it hides the controls, so a session
  // that starts while it is up (Space, schedule, phone, tray) leaves it at once.
  if (state.fullscreenClock && !isIdle && !fullscreenExitPending) { fullscreenExitPending = true; exitFullscreenClock(); }

  els.body.classList.toggle('is-running', state.running);
  els.body.classList.toggle('is-paused', state.paused);
  els.body.classList.toggle('mini-mode', state.miniMode);
  setTextIfChanged(document.getElementById('studio-tonight-title'), state.paused ? 'Stay a little longer.' : state.running ? 'Let the day fade.' : 'Leave the day behind.');
  setTextIfChanged(document.getElementById('studio-tonight-copy'), state.paused ? 'Paused on this PC. Pick up when you’re ready.' : state.running ? 'Your countdown is running on this PC.' : 'A little more time. Then a softer landing.');
  els.timerDisplay?.classList.toggle('clock-idle', idleClockVisible);
  // Full screen only makes sense over the idle clock face -- once a timer's
  // running the ring switches to a countdown, and setup-controls/action-bar
  // (hidden in fullscreen-clock-mode) are what pause/snooze/cancel live in.
  if (els.btnFullscreenClock) els.btnFullscreenClock.style.display = (idleClockVisible && !state.fullscreenClock) ? 'flex' : 'none';
  const faceControls = document.getElementById('clock-face-controls');
  if (faceControls) faceControls.hidden = !idleClockVisible;
  document.querySelectorAll('[data-clock-choice]').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.clockChoice === state.clockFace ? 'true' : 'false');
  });
  setTextIfChanged(document.getElementById('timer-readout-label'), state.paused ? 'Paused'
    : state.running ? 'Time remaining' : outcomeHold ? 'Complete' : idleClockVisible ? 'Clock' : 'Ready');

  // Clock Mode: show current time when idle instead of countdown input.
  let bezelDrawn = false;
  if (idleClockVisible) {
    const now = new Date();
    const face = state.clockFace || 'digital';
    const showAnalog = face === 'analog' || face === 'hybrid';
    const timeText = formatIdleClockTime(now, false);
    const compactTimeText = formatIdleClockTime(now, true);
    const dateText = state.clockShowDate ? formatIdleClockDate(now, false) : '';
    const compactDateText = state.clockShowDate ? formatIdleClockDate(now, true) : '';
    if (els.analogClock) {
      els.analogClock.style.display = showAnalog ? '' : 'none';
      // Drop the sweep class while hidden so it re-syncs to real time on re-show.
      if (!showAnalog) els.analogClock.classList.remove('sweep');
    }
    if (showAnalog) {
      updateAnalogHands(now);
      // The hybrid readout moved off the hands (P06): it reads "Now HH:MM"
      // under the dial instead, so nothing is drawn over the hands.
      if (els.analogDigital) els.analogDigital.textContent = '';
      if (els.analogDate) els.analogDate.textContent = compactDateText;
    }
    // Pure analog and hybrid draw no digital text in the disc; digital shows the full time.
    els.timerMain.textContent = face === 'analog' || face === 'hybrid' ? '' : timeText;
    els.timerMain.classList.remove('hybrid-readout', 'tm-long');
    els.timerMain.classList.toggle('tm-clock-long', timeText.length > 5);
    if (showAnalog) {
      // The bezel: the ring draws tonight's plan from the hand to its end.
      const planSeconds = planSecondsNow();
      updateIdleBezel(now, planSeconds);
      bezelDrawn = true;
      setTextIfChanged(els.timerLabel, idleBezelLabel(planSeconds));
      const past = planEndsPastBedtime(new Date(Date.now() + planSeconds * 1000), state.bedtime);
      const sub = [face === 'hybrid' ? `Now ${compactTimeText}` : '', past ? 'past bedtime' : ''].filter(Boolean).join(' · ');
      setTextIfChanged(els.timerSub, sub);
    } else {
      if (els.timerSub) els.timerSub.textContent = dateText;
      // Show next bedtime reminder if configured.
      const bedtime = state.bedtime || '';
      if (bedtime && els.timerLabel) {
        els.timerLabel.textContent = `Bedtime ${bedtime}`;
      } else {
        els.timerLabel.textContent = 'ready';
      }
    }
  } else {
    if (els.analogClock) {
      els.analogClock.style.display = 'none';
      els.analogClock.classList.remove('sweep');
    }
    if (els.analogDigital) els.analogDigital.textContent = '';
    if (els.analogDate) els.analogDate.textContent = '';
    els.timerMain.classList.remove('hybrid-readout', 'tm-clock-long');
    const countdownText = formatTime(displaySeconds);
    els.timerMain.textContent = countdownText;
    // H:MM:SS gets a smaller size so a 1:30:00 countdown fits the ring.
    els.timerMain.classList.toggle('tm-long', countdownText.length > 5);
    // Short enough to stay on one line inside the desktop ring (the full
    // 'test · no power action' wrapped at 900x800). The pill states it in full.
    els.timerLabel.textContent = state.running || state.paused ? countdownRingLabel() : 'ready';
    if (els.timerSub) els.timerSub.textContent = '';
  }

  // Briefly label how the last session ended, overriding the idle/clock label.
  if (isIdle && state.lastOutcome && els.timerLabel) {
    const outcomeLabels = { completed: 'session complete', dryrun: 'test mode complete', cancelled: 'session cancelled' };
    if (outcomeLabels[state.lastOutcome]) els.timerLabel.textContent = outcomeLabels[state.lastOutcome];
  }
  // 'no power action ran' only after main's own Test Mode skip event (the
  // 'dryrun' type, sent after the completion); never assumed from the mode.
  if (outcomeHold && els.timerSub) {
    setTextIfChanged(els.timerSub, state.lastOutcome === 'dryrun' && state.outcomeSkipConfirmed ? 'no power action ran' : '');
  }

  // Exactly one of the two ring writers runs: the idle bezel (analog / hybrid
  // face) or the countdown ring. The bezel path keeps the room fully lit.
  if (bezelDrawn) {
    if (document.body.style.getPropertyValue('--lights-level') !== '1.000') document.body.style.setProperty('--lights-level', '1.000');
  } else {
    clearIdleBezel();
    updateRing(displaySeconds, totalSeconds);
  }
  if (isIdle) updatePlanFacts();
  else updateSessionHead();

  els.btnStop.style.display = state.running || state.paused ? 'flex' : 'none';
  els.btnPause.style.display = state.running || state.paused ? 'flex' : 'none';
  els.btnSnooze.disabled = !(state.running || state.paused);
  els.btnPause.querySelector('span:last-child').textContent = state.paused ? 'Resume' : 'Pause';

  // Toggle between setup controls and running action bar.
  const setupEl = document.getElementById('setup-controls');
  const runEl = document.getElementById('action-bar-running');
  if (setupEl) setupEl.style.display = (state.running || state.paused) ? 'none' : '';
  if (runEl) runEl.style.display = (state.running || state.paused) ? '' : 'none';

  // Northstar lobby elements: show on idle, hide while running/paused.
  // body.ns-lobby means "idle lobby content" only. UI-R3 Fire 03: the nav
  // rail no longer keys off it -- the rail stays through a session (mini
  // mode and the fullscreen clock stay rail-less).
  const nsHero = document.getElementById('ns-hero-card');
  if (nsHero) nsHero.style.display = isIdle ? '' : 'none';
  document.body.classList.toggle('ns-lobby', isIdle);
  renderTonightHero();
  renderArmedModeBanner();

  // Focused active-run screen: while a run is active, hide the idle-only
  // lobby content (Saved Profiles, the streak callout, last night's
  // completed-run proof card) so Tonight shows only the running countdown,
  // its controls, and the current mode/action -- not a stale "complete"
  // panel sitting alongside a run that's still in progress. The rail and
  // every other page stay reachable during the run.
  const profilesSection = document.getElementById('profiles-section');
  if (profilesSection) profilesSection.style.display = isIdle ? '' : 'none';
  // Saving tonight's plan as a mode is an idle-only action, like My Modes.
  if (els.btnSaveCurrentProfile) els.btnSaveCurrentProfile.style.display = isIdle ? '' : 'none';
  if (els.streakCallout && !isIdle) els.streakCallout.style.display = 'none';
  if (els.morningProofSection && !isIdle) els.morningProofSection.style.display = 'none';
  // UI-R3 P11: Tonight's morning note never sits beside an active run.
  const morningNote = document.getElementById('morning-note');
  if (morningNote && !isIdle) morningNote.hidden = true;
  // The Proof hero's Start button says what it will do before you press it,
  // from the same live state Start reads. Static text, never animated.
  const againTruth = document.getElementById('proof-again-truth');
  if (againTruth) {
    const forced = state.forceShutdown && (state.action === 'shutdown' || state.action === 'restart');
    setTextIfChanged(againTruth, !state.settingsLoaded ? 'Checking mode…'
      : state.dryRun ? 'Test Mode' : `Real · ${actionLabel()}${forced ? ' · Forced' : ''}`);
    againTruth.classList.toggle('real', state.settingsLoaded && !state.dryRun);
  }

  els.timerInput.disabled = state.running || state.paused;
  els.btnPlus.disabled = state.running || state.paused;
  els.btnMinus.disabled = state.running || state.paused;

  document.querySelectorAll('.unit-btn').forEach(btn => {
    const pressed = btn.dataset.unit === state.unit;
    btn.classList.toggle('active', pressed);
    btn.setAttribute('aria-pressed', String(pressed));
  });

  // Test Mode / REAL ACTION truth pill — always shown under the timer.
  // Until the saved settings are applied it says so, neutrally, instead of
  // guessing from the in-memory default.
  // The same words go to the truth band inside every session-critical dialog
  // (warning, override, snooze-tax, ritual): textContent only, and
  // only when it changes. The bands carry no live region; the pill is the one.
  const truthText = state.dryRun
    ? 'TEST MODE · No PC power action will run'
    : `REAL ACTION · ${actionLabel()} will run at end`;
  const pillText = !state.settingsLoaded ? 'Checking mode…' : truthText;
  if (els.testmodePill) {
    if (els.testmodePill.textContent !== pillText) els.testmodePill.textContent = pillText;
    els.testmodePill.classList.toggle('checking', !state.settingsLoaded);
    els.testmodePill.classList.toggle('real', state.settingsLoaded && !state.dryRun);
  }
  document.querySelectorAll('[data-truth-band]').forEach(band => {
    if (band.textContent !== pillText) band.textContent = pillText;
    band.classList.toggle('checking', !state.settingsLoaded);
    band.classList.toggle('real', state.settingsLoaded && !state.dryRun);
  });
  els.body.classList.toggle('test-mode', state.settingsLoaded && state.dryRun === true);
  els.body.classList.toggle('real-action', state.settingsLoaded && state.dryRun === false);
  // UI-R3 P12: the open Night Mode detail states the same Test Mode / REAL
  // truth (renderer-night-modes.js; writes only on change).
  if (els.panelModes && els.panelModes.style.display !== 'none' && typeof renderDetailTruth === 'function') renderDetailTruth();
  // My Modes REAL chip tooltips follow the live Test Mode setting (writes only on change).
  if (typeof syncProfileChipTitles === 'function') syncProfileChipTitles();

  // Heads-up instrument (UI-R3 P05): while the dialog is open its countdown,
  // ring and copy come from the live timer state, so it makes one time claim
  // and it is the true one. Paused freezes the time and says so.
  if (els.warningModal?.classList.contains('active')) {
    const remaining = Number(state.remainingSeconds);
    const known = Number.isFinite(remaining) && remaining >= 0;
    // A snooze (phone, tray, hotkey) can raise the time left: the ring rescales.
    if (known && (!(state._warnStart > 0) || remaining > state._warnStart)) state._warnStart = Math.max(1, remaining);
    const countdown = document.getElementById('warning-modal-countdown');
    const countdownText = known ? formatTime(remaining) : '--:--';
    if (countdown && countdown.textContent !== countdownText) countdown.textContent = countdownText;
    const ring = document.getElementById('warning-modal-ring');
    if (ring) {
      const ratio = known ? clamp(remaining / state._warnStart, 0, 1) : 0;
      ring.style.strokeDashoffset = String(Math.round((100 - ratio * 100) * 100) / 100);
    }
    const pausedLabel = document.getElementById('warning-modal-state');
    if (pausedLabel) pausedLabel.hidden = !state.paused;
    els.warningModal.classList.toggle('is-paused', Boolean(state.paused));
    const warnText = state.dryRun
      ? `Test Mode: ${actionLabel()} would run when this reaches 0:00. Nothing will power off.`
      : `${actionLabel()} runs when this reaches 0:00.`;
    if (els.warningModalText && els.warningModalText.textContent !== warnText) els.warningModalText.textContent = warnText;
  }
  // Readiness Safety follows the same truth on every render. Only the sync
  // tile: the network part of updateReadiness keeps its own refresh points.
  if (typeof updateReadinessSafety === 'function') updateReadinessSafety();

  // Footer truth bar (UI-R3 Fire 02: its own function, below).
  renderFooterTruth(isIdle);
  // UI-R3 Fire 03: the readiness cells lead somewhere only while idle with
  // settings loaded (the same gate as the pill's idle shortcut). Disabled
  // rows keep their values at full strength (CSS); only the chevron hides.
  const rdyLocked = !(isIdle && state.settingsLoaded);
  document.querySelectorAll('.rdy-row[data-rdy-go]').forEach(row => {
    if (row.disabled !== rdyLocked) row.disabled = rdyLocked;
  });

  // Phase class on body for ring animations + warm shift.
  document.body.className = document.body.className.replace(/phase-\w+/g, '').trim();
  if (state.running && state.phase && state.phase !== 'idle') {
    document.body.classList.add('phase-' + state.phase);
  }
  if (state.paused) document.body.classList.add('is-paused');
  else if (state.running) document.body.classList.add('is-running');
  // UI-R3 Fire 04: the ring's station marks where winding down begins, only
  // when this run really has a winding-down phase (never in updateRing).
  document.body.classList.toggle('has-station', hasWindingDownStation());
  // One name per session: the default name is marked, never rewritten.
  syncTimerNameDefault();

  els.actionName.textContent = actionLabel();
  // Fire 07: 'Ends at' holds a time or a plain fact, never 'Idle'.
  // formatEndTime keeps its 'Idle' sentinel (updateSessionHead reads it); a
  // run without a readable endsAt reads 'Not set' here.
  const endsAtText = state.running || state.paused ? formatEndTime(state.endsAt) : 'Not running';
  els.endTime.textContent = endsAtText === 'Idle' ? 'Not set' : endsAtText;

  // Dry Run is an immediate-commit field -- this checkbox's 'change'
  // listener (and any other immediate editor: companion, family, IPC) writes
  // canonical state.dryRun directly -- so unlike the fields below, there is
  // no "in-progress unsaved edit" on it for a background render() to
  // protect. It must stay synced to canonical state.dryRun even while the
  // Settings panel is open, or an external edit while Settings is already
  // open leaves this checkbox showing a stale value -- and Save used to
  // silently re-read and persist that stale value over the newer one (see
  // saveSettingsPanel(), which no longer re-reads this checkbox at all).
  if (els.chkDryRun) els.chkDryRun.checked = state.dryRun;

  // Don't clobber the user's other in-progress edits while the Settings panel is open.
  if (els.panelSet?.style.display === 'none') {
    if (els.chkForceShutdown) els.chkForceShutdown.checked = state.forceShutdown;
    if (els.chkMute) els.chkMute.checked = state.muteSystem;
  if (els.chkGraceful) els.chkGraceful.checked = state.gracefulClose;
    if (els.chkRunLogin) els.chkRunLogin.checked = state.runAtLogin;
    if (els.graceMinutes) els.graceMinutes.value = state.graceMinutes;
  }

  // Settings › Power & Safety: the Test Mode / REAL consequence, from the
  // canonical state only (never from a form control).
  renderSafetyTruth();
  // Fire 02: what Test Mode does not hold back (Settings and Tonight's plan).
  renderWindDownScope();
  // Fire 07: the Devices Test Mode notes follow a Test Mode switch at once.
  if (els.panelDevices && els.panelDevices.style.display !== 'none' && typeof syncDeviceScopeNotes === 'function') syncDeviceScopeNotes();

  // Schedule › One night only and its Tonight note, from the same value
  // inputSeconds() reads; then Schedule's static Test Mode / REAL truth.
  updateScheduleHint();
  if (typeof renderScheduleTruth === 'function') renderScheduleTruth();
}

function resolveClockDial() {
  if (state.clockDial === 'auto') {
    return state.clockStyle === 'classic' ? 'roman' : 'bars';
  }
  return state.clockDial || 'bars';
}

// Build the analog dial markers for the current clock-dial mode.
function buildAnalogTicks() {
  if (!els.analogTicks) return;
  const dial = resolveClockDial();
  if (els.analogTicks.dataset.variant === dial) return;
  els.analogTicks.dataset.variant = dial;
  els.analogTicks.innerHTML = '';
  if (dial === 'roman' || dial === 'arabic') return;
  const ns = 'http://www.w3.org/2000/svg';
  const count = dial === 'minutes' ? 60 : 12;
  for (let i = 0; i < count; i++) {
    const angle = (i * (360 / count)) * Math.PI / 180;
    const major = dial === 'minutes' ? i % 5 === 0 : i % 3 === 0;
    const inner = dial === 'minutes'
      ? (major ? 36 : 41.5)
      : (major ? 37 : 41);
    const outer = 45;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', (50 + inner * Math.sin(angle)).toFixed(2));
    line.setAttribute('y1', (50 - inner * Math.cos(angle)).toFixed(2));
    line.setAttribute('x2', (50 + outer * Math.sin(angle)).toFixed(2));
    line.setAttribute('y2', (50 - outer * Math.cos(angle)).toFixed(2));
    line.setAttribute('class', major ? 'tick major' : 'tick');
    els.analogTicks.appendChild(line);
  }
  buildAnalogNumerals();
  buildAnalogArabic();
}

// Build the 12 Roman numerals for the analog clock face once.
function buildAnalogNumerals() {
  if (!els.analogNumerals || els.analogNumerals.childNodes.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  // Index 0 = 12 o'clock, going clockwise. IIII (not IV) is the horological convention.
  const roman = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  const r = 38;
  for (let i = 0; i < 12; i++) {
    const angle = (i * 30) * Math.PI / 180;
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', (50 + r * Math.sin(angle)).toFixed(2));
    t.setAttribute('y', (50 - r * Math.cos(angle)).toFixed(2));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('class', 'analog-numeral');
    t.textContent = roman[i];
    els.analogNumerals.appendChild(t);
  }
}

function buildAnalogArabic() {
  if (!els.analogArabic || els.analogArabic.childNodes.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  const numbers = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  const r = 38;
  for (let i = 0; i < 12; i++) {
    const angle = (i * 30) * Math.PI / 180;
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', (50 + r * Math.sin(angle)).toFixed(2));
    t.setAttribute('y', (50 - r * Math.cos(angle)).toFixed(2));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('class', 'analog-arabic-numeral');
    t.textContent = numbers[i];
    els.analogArabic.appendChild(t);
  }
}

// Rotate the analog clock hands to match the given time.
function updateAnalogHands(now) {
  buildAnalogTicks();
  buildAnalogNumerals();
  buildAnalogArabic();
  const sec = now.getSeconds();
  const min = now.getMinutes();
  const hr = now.getHours() % 12;
  const secDeg = sec * 6;
  const minDeg = min * 6 + sec * 0.1;
  const hrDeg = hr * 30 + min * 0.5;
  if (els.clockHour) els.clockHour.setAttribute('transform', `rotate(${hrDeg} 50 50)`);
  if (els.clockMinute) els.clockMinute.setAttribute('transform', `rotate(${minDeg} 50 50)`);

  // Second hand: a CSS-driven smooth sweep (premium watch glide) when enabled and
  // the second hand is shown; otherwise the classic per-second tick via attribute.
  // Under prefers-reduced-motion, fall back to ticking so the hand still advances
  // (a disabled sweep animation would otherwise freeze it at 12 o'clock).
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sweepOn = state.clockSweep !== false && state.clockSeconds !== false && !prefersReduced;
  if (els.clockSecond && els.analogClock) {
    if (sweepOn) {
      els.analogClock.classList.add('sweep');
      startSecondHandGlide();
    } else {
      stopSecondHandGlide();
      els.analogClock.classList.remove('sweep');
      els.clockSecond.setAttribute('transform', `rotate(${secDeg} 50 50)`);
    }
  }
}

// Mechanical-watch glide at 8 beats/s. A CSS animation on an SVG child forces
// style + layout on every frame (measured ~5% of the renderer main thread
// while the idle clock sits open); 8 attribute writes per second is ~8x less
// and reads as a premium sweep.
let secondHandGlideTimer = null;
function startSecondHandGlide() {
  if (secondHandGlideTimer) return;
  const beat = () => {
    if (!els.clockSecond || !els.analogClock || els.analogClock.style.display === 'none') {
      stopSecondHandGlide();
      return;
    }
    const t = new Date();
    const beats = Math.floor((t.getSeconds() * 1000 + t.getMilliseconds()) / 125);
    els.clockSecond.setAttribute('transform', `rotate(${(beats * 0.75).toFixed(2)} 50 50)`);
  };
  beat();
  secondHandGlideTimer = setInterval(beat, 125);
}
function stopSecondHandGlide() {
  if (!secondHandGlideTimer) return;
  clearInterval(secondHandGlideTimer);
  secondHandGlideTimer = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Armed Night Mode: explicit presentation state for the selected Night Mode.
// Main is authoritative — this is cleared on any lobby edit so stale identity
// cannot leak into unrelated starts.
// ─────────────────────────────────────────────────────────────────────────────

async function persistArmedNightMode() {
  try {
    await api.saveAppSettings({ app: { armedNightMode: state.armedNightMode } });
  } catch (e) {
    console.error('persistArmedNightMode failed:', e);
  }
}

function clearArmedNightMode() {
  state.armedNightMode = null;
  renderArmedModeBanner();
  persistArmedNightMode();
}

function armNightMode(mode) { // eslint-disable-line no-unused-vars -- called from renderer-night-modes.js
  // Arming a Night Mode replaces a One night only target (the two are
  // exclusive; see selectClockTarget). Unchecked silently: render() then
  // hides the Tonight note and clears the Schedule hint.
  if (els.scheduleCheck?.checked) els.scheduleCheck.checked = false;
  state.armedNightMode = {
    nightModeId: mode.nightModeId,
    nightModeTitle: mode.nightModeTitle,
    durationSeconds: mode.durationSeconds,
    action: mode.action,
    ritualId: mode.ritualId || 'none'
  };
  releaseOutcomeHold();
  renderArmedModeBanner();
  persistArmedNightMode();
}

// Tonight's hero card: derives every displayed field (title, duration,
// action, preview ring, CTA label) from the same state.armedNightMode /
// state.action / inputSeconds() that the armed-mode banner and the
// countdown ring already read. Previously this card's title/preview/CTA
// were static markup, never bound to anything, so "Use Tonight" updated
// the banner and the ring but left this card showing whatever had been
// hardcoded in index.html -- two contradictory plans on screen at once.
// Called from render() so it always stays in the same single pass as
// every other lobby surface.
//
// v11.2 Tonight's Plan: this is now the single authoritative "this is what
// will happen" surface regardless of source -- manual setup, a saved
// profile, or a Night Mode. A loaded profile credits itself in both the
// title (e.g. "Hard Stop · 15 min · Shutdown", the same pattern Night Modes
// already used) and the separate ns-hero-source line ("From: Hard Stop"),
// so the source is never ambiguous. checkProfileMatch() (below) is what
// keeps that credit honest: the moment the lobby no longer matches the
// loaded profile's saved values, the profile identity is cleared before
// this function ever runs again.
function renderTonightHero() {
  const titleEl = document.getElementById('ns-hero-title');
  const previewEl = document.getElementById('ns-preview-time');
  const playLabelEl = document.getElementById('ns-play-label');
  const sourceEl = document.getElementById('ns-hero-source');
  const sourceNameEl = document.getElementById('ns-hero-source-name');
  if (!titleEl && !previewEl && !playLabelEl && !sourceEl) return;

  const armed = state.armedNightMode;
  const profile = (!armed && state.currentProfileId) ? state.profiles.find(p => p.id === state.currentProfileId) : null;
  // One name per session (Fire 02): Night Mode, else My Mode, else the name
  // typed on the ring, else 'Countdown' (sessionDisplayName, renderer-utils.js).
  const planTitle = armed ? armed.nightModeTitle : (profile ? profile.name : sessionDisplayName({ timerName: state.timerName }));
  const durationSeconds = armed ? armed.durationSeconds : inputSeconds();
  const durationMin = Math.max(1, Math.round(durationSeconds / 60));
  const effectiveAction = armed ? armed.action : state.action;

  if (titleEl) titleEl.textContent = `${planTitle} · ${durationMin} min`;
  if (previewEl) previewEl.textContent = formatTime(durationSeconds);
  if (playLabelEl) playLabelEl.textContent = planTitle === 'Countdown' ? 'Start countdown' : `Start ${planTitle}`;
  // "Ends with": the action this plan really runs, plus the Last Light finale
  // only when one is enabled. Mode (Test/REAL) is stated by the truth pill.
  const endingEl = document.getElementById('ns-meta-ending');
  if (endingEl) {
    const seqSel = document.getElementById('sel-lastlight-sequence');
    const seqOption = seqSel && seqSel.options ? seqSel.options[seqSel.selectedIndex] : null;
    const finaleName = seqOption && seqOption.textContent ? seqOption.textContent.replace(/\s*\*$/, '').trim() : '';
    const finaleSuffix = state.lastLight?.enabled && finaleName ? ' · ' + finaleName : '';
    endingEl.textContent = actionLabel(effectiveAction) + finaleSuffix;
  }
  if (sourceEl) {
    if (profile) {
      if (sourceNameEl) sourceNameEl.textContent = profile.name;
      sourceEl.style.display = '';
    } else {
      sourceEl.style.display = 'none';
    }
  }

  // Manual action selector: reflects whichever action is actually in effect
  // right now (a Night Mode's fixed action while one is armed, otherwise
  // state.action), independent of whether every code path that can arm a
  // Night Mode also happens to call setAction() itself.
  // aria-pressed is derived from the exact same isSelected value as the
  // visual .selected class, in the same pass, so the two can never diverge.
  document.querySelectorAll('#action-chips-row [data-action]').forEach(btn => {
    const isSelected = btn.dataset.action === effectiveAction;
    btn.classList.toggle('selected', isSelected);
    btn.setAttribute('aria-pressed', String(isSelected));
  });
}

function renderArmedModeBanner() {
  const banner = document.getElementById('armed-mode-banner');
  if (!banner) return;
  if (!state.armedNightMode) {
    banner.style.display = 'none';
    return;
  }
  const m = state.armedNightMode;
  const durMin = Math.round(m.durationSeconds / 60);
  const actionLabel = { shutdown: 'Shutdown', sleep: 'Sleep', restart: 'Restart', hibernate: 'Hibernate', lock: 'Lock', logout: 'Log out' }[m.action] || m.action;
  banner.style.display = '';
  const titleEl = document.getElementById('armed-mode-title');
  const metaEl = document.getElementById('armed-mode-meta');
  if (titleEl) titleEl.textContent = m.nightModeTitle;
  const ritualLabel = m.ritualId === 'standard' ? 'Standard ritual' : 'Direct';
  if (metaEl) metaEl.textContent = `${durMin} min \u00B7 ${actionLabel} \u00B7 ${ritualLabel}`;
}

// Check whether the current lobby values still match the armed mode's canonical values.
// If not, the user has edited the execution → clear the armed mode.
function checkArmedModeMatch() {
  if (!state.armedNightMode) return;
  const armed = state.armedNightMode;
  const currentSeconds = inputSeconds();
  if (currentSeconds !== armed.durationSeconds || state.action !== armed.action) {
    clearArmedNightMode();
  }
}

// v11.2 Tonight's Plan: the loaded-profile analog of checkArmedModeMatch
// above. A profile stays credited ("From: <name>" on the hero, .active on
// its card) only while the lobby's action/duration still match what that
// profile actually saved. The moment either is edited manually, the profile
// identity is cleared so the displayed source can never claim a profile is
// active when its values no longer match it -- the same contract Night
// Modes already have, extended to profiles.
//
// durationEdited: true only when this call follows an actual manual
// duration mutation (+/-, typed value, or a unit change) -- every other
// call site (action edits, and plain re-renders) passes the default false.
//
// Clock-mode profiles specify a time-of-day ("end at 23:00"), not a fixed
// countdown. The duration shown right after loading one is a one-time
// snapshot -- "seconds until 23:00 as of the moment it was applied" -- not
// a value the profile itself stores or that stays meaningful as real time
// passes. So this deliberately does NOT compare inputSeconds() against
// profile.seconds for clock-mode profiles (that field isn't the profile's
// duration and drifting further from a stale snapshot every tick, with no
// user action at all, would clear it spuriously). Instead: a manual
// duration edit on a clock-mode profile always clears it, unconditionally,
// even if the edited value happens to numerically coincide with the
// original snapshot -- editing duration changes what kind of plan this is
// ("end at 23:00" -> "run for N minutes"), regardless of the numbers.
// Passive calls (durationEdited left false) never touch clock-mode
// profiles, so simply loading one and re-rendering can't clear it.
function checkProfileMatch(durationEdited = false) {
  if (!state.currentProfileId) return;
  const profile = state.profiles.find(p => p.id === state.currentProfileId);
  if (!profile) { clearCurrentProfile(); return; }
  if (state.action !== profile.action) { clearCurrentProfile(); return; }
  if (profile.mode === 'clock') {
    if (durationEdited) clearCurrentProfile();
    return;
  }
  if (inputSeconds() !== profile.seconds) clearCurrentProfile();
}

function clearCurrentProfile() {
  if (!state.currentProfileId) return;
  state.currentProfileId = null;
  persistSelectedProfile(null);
  renderProfiles();
}

// Single shared entry point for "start whatever is currently on Tonight" --
// the armed Night Mode if one is selected, otherwise the custom timer
// controls. Every caller that means "press the one primary Start action"
// (the hero CTA, the Space keyboard shortcut, and "Play Tonight Again"
// replaying last night's plan) goes through this one function, so there is
// exactly one code path and no duplicate/competing start control.
function startTonightPlan() {
  return startTimer(inputSeconds(), 'play');
}

async function startTimer(seconds = inputSeconds(), origin = null) {
  const durationSeconds = Math.max(1, Math.round(seconds));
  // Never start on the in-memory default before Test Mode is known. This
  // covers the hero, Space, the duration chips and the 1-6 keys.
  if (!state.settingsLoaded) {
    notify('Loading your settings…', 'info');
    return;
  }

  try {
    SoundSystem.playStart();
    // Only genuine PLAY origins may carry the armed Night Mode ID.
    // All other callers (chips, presets, quick-minute) clear the armed mode
    // before reaching here, so armedNightMode is already null for those paths.
    const isPlayOrigin = origin === 'play';
    const nightModeId = (isPlayOrigin && state.armedNightMode) ? state.armedNightMode.nightModeId : undefined;
    const result = await api.startTimer({
      durationSeconds,
      action: state.action,
      dryRun: state.dryRun,
      forceShutdown: state.forceShutdown,
      muteSystem: state.muteSystem,
      gracePeriod: state.graceMinutes,
      profileId: state.currentProfileId,
      startOrigin: origin,
      nightModeId
    });

    if (result?.success === false) {
      notify(result.error || 'Timer could not start', 'error');
      return;
    }

    state.running = true;
    state.paused = false;
    state.totalSeconds = durationSeconds;
    state.remainingSeconds = durationSeconds;
    state.endsAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
    state.lastOutcome = null;
    state.outcomeSkipConfirmed = false;
    if (outcomeTimer) clearTimeout(outcomeTimer);
    setOutcomeBodyClass(null);
    render();
  } catch (error) {
    notify(`Failed to start timer: ${error.message || error}`, 'error');
  }
}

async function cancelTimer() {
  try {
    SoundSystem.playCancel();
    await api.cancelTimer();
    state.running = false;
    state.paused = false;
    state.remainingSeconds = inputSeconds();
    state.totalSeconds = state.remainingSeconds;
    state.endsAt = null;
    // Restore clock mode if it was dismissed by applying a profile.
    if (state._clockDismissedByProfile) {
      state.clockMode = true;
      state._clockDismissedByProfile = false;
    }
    render();
  } catch (error) {
    notify(`Error cancelling timer: ${error.message || error}`, 'error');
  }
}

async function togglePause() {
  try {
    SoundSystem.playPause();
    // On Tonight the ring and the console already show paused / running, so
    // the change goes to the notification centre only; elsewhere it toasts.
    const tonightVisible = Boolean(els.panelLib) && els.panelLib.style.display !== 'none';
    if (state.paused) {
      await api.resumeTimer();
      state.paused = false;
      state.running = true;
      state.endsAt = new Date(Date.now() + state.remainingSeconds * 1000).toISOString();
      notify('Timer resumed', 'success', 3000, { toast: !tonightVisible });
    } else {
      await api.pauseTimer();
      state.paused = true;
      notify('Timer paused', 'warning', 3000, { toast: !tonightVisible });
    }
    render();
  } catch (error) {
    notify(`Pause failed: ${error.message || error}`, 'error');
  }
}

async function snooze(seconds = 5 * 60) {
  if (!state.running && !state.paused) return;

  try {
    // Override Tax: assess cost before allowing snooze.
    const cost = await api.assessSnoozeCost?.();
    if (cost && cost.level > 0) {
      // Show escalation warning — user must acknowledge cost.
      const proceed = await showSnoozeTaxModal(cost, seconds);
      if (!proceed) return; // user backed out
    }

    const reason = cost?.requireReason ? state._snoozeTaxReason : undefined;
    const result = await api.snoozeTimer(seconds, reason);
    if (result?.state) {
      applyTimerPayload({ type: 'snoozed', ...result.state });
    }
    render();

    // Notify with escalation context.
    if (result?.tax?.level >= 2) {
      notify(`Snooze #${result.tax.snoozeNumber} — tomorrow tightens by ${result.tax.tomorrowDebt}m`, 'warning');
    } else if (result?.tax?.level >= 1) {
      notify(`Snooze #${result.tax.snoozeNumber} logged`, 'warning');
    } else {
      notify(`Snoozed +${Math.round(seconds / 60)} minutes`, 'success');
    }
  } catch (error) {
    notify(`Snooze failed: ${error.message || error}`, 'error');
  }
}

// Override Tax: snooze escalation modal.
function showSnoozeTaxModal(cost, seconds) {
  return new Promise((resolve) => {
    state._snoozeTaxReason = '';

    const modal = document.getElementById('snooze-tax-modal');
    if (!modal) { resolve(true); return; } // no modal in DOM, allow snooze

    // Populate consequences.
    // Every field is escaped, severity is mapped only from known values, and
    // the glyph comes from the static LO_GLYPHS set by consequence type
    // (main's emoji c.icon is not rendered).
    const list = document.getElementById('snooze-tax-consequences');
    if (list) {
      const SNOOZE_TAX_GLYPHS = { logged: 'note', accountability: 'bell', tighten: 'clock', reason: 'edit' };
      const SNOOZE_TAX_SEVERITIES = { low: 'low', medium: 'medium', high: 'high' };
      list.innerHTML = (Array.isArray(cost.consequences) ? cost.consequences : []).map(c => {
        const type = String(c?.type ?? '');
        const glyph = Object.prototype.hasOwnProperty.call(SNOOZE_TAX_GLYPHS, type) ? SNOOZE_TAX_GLYPHS[type] : 'dot';
        const sev = Object.prototype.hasOwnProperty.call(SNOOZE_TAX_SEVERITIES, c?.severity) ? SNOOZE_TAX_SEVERITIES[c.severity] : '';
        return `
        <div class="ov-consequence" data-sev="${escapeHtml(sev)}">
          <span class="ov-cq-icon">${loGlyph(glyph, 'ov-cq-glyph')}</span>
          <div>
            <span class="ov-cq-msg">${escapeHtml(String(c?.message ?? ''))}</span>
            ${sev ? `<span class="ov-cq-sev">${escapeHtml(sev.toUpperCase())}</span>` : ''}
          </div>
        </div>`;
      }).join('');
    }

    // Title.
    const title = document.getElementById('snooze-tax-title');
    if (title) title.textContent = `Snooze #${cost.snoozeNumber} has a cost`;

    // Reason input visibility.
    const reasonWrap = document.getElementById('snooze-tax-reason-wrap');
    const reasonInput = document.getElementById('snooze-tax-reason');
    if (reasonWrap) reasonWrap.style.display = cost.requireReason ? '' : 'none';

    modal.classList.add('active');

    // Button handlers (one-time).
    const confirmBtn = document.getElementById('btn-snooze-tax-confirm');
    const cancelBtn = document.getElementById('btn-snooze-tax-cancel');

    const reasonError = document.getElementById('snooze-tax-reason-error');
    function clearReasonError() {
      reasonInput?.classList.remove('ov-invalid');
      reasonInput?.removeAttribute('aria-invalid');
      if (reasonError) reasonError.hidden = true;
    }
    clearReasonError();
    function cleanup() {
      modal.classList.remove('active');
      clearReasonError();
      confirmBtn?.removeEventListener('click', onConfirm);
      cancelBtn?.removeEventListener('click', onCancel);
      reasonInput?.removeEventListener('input', clearReasonError);
    }
    function onConfirm() {
      if (cost.requireReason && reasonInput) {
        state._snoozeTaxReason = reasonInput.value.trim();
        if (!state._snoozeTaxReason) {
          reasonInput.focus();
          reasonInput.classList.add('ov-invalid');
          reasonInput.setAttribute('aria-invalid', 'true');
          if (reasonError) reasonError.hidden = false;
          return; // must give a reason
        }
      }
      cleanup();
      resolve(true);
    }
    function onCancel() { cleanup(); resolve(false); }

    confirmBtn?.addEventListener('click', onConfirm);
    cancelBtn?.addEventListener('click', onCancel);
    reasonInput?.addEventListener('input', clearReasonError);
  });
}

let outcomeTimer = null;
// Briefly surface how the last session ended on the idle face, then auto-clear
// back to the normal idle/clock state. Renderer-only; the timer authority in
// main is unaffected.
function setSessionOutcome(kind) {
  state.lastOutcome = kind;
  // The mode the outcome happened in: the footer shows it only while it agrees.
  state.lastOutcomeTestMode = state.dryRun === true;
  state.outcomeSkipConfirmed = false;
  if (outcomeTimer) clearTimeout(outcomeTimer);
  setOutcomeBodyClass(kind);
  outcomeTimer = setTimeout(() => {
    state.lastOutcome = null;
    state.outcomeSkipConfirmed = false;
    setOutcomeBodyClass(null, { fade: true });
    render();
  }, 8000);
}

// -- The lamp's moments (UI-R3 P07) -------------------------------------------
// Renderer-only and decorative: body classes drive one-shot CSS moments. They
// never touch the timer authority in main, never claim a power action ran,
// and every one of them is an instant end state under reduced motion.

// The one owner of the outcome body classes. A completed / Test Mode outcome
// holds the room dark (CSS caps it at P03's .45); cancelled gets no hold.
// { fade: true } ends a hold with a plain ~1 s fade back (outcome-release);
// without it every class is removed at once (a new run, or a hold dropped
// because main reported an error or a blocked action).
const OUTCOME_BODY_CLASSES = ['outcome-completed', 'outcome-dryrun', 'outcome-cancelled', 'outcome-release'];
let outcomeReleaseTimer = null;
function setOutcomeBodyClass(kind, { fade = false } = {}) {
  const body = document.body;
  if (outcomeReleaseTimer) { clearTimeout(outcomeReleaseTimer); outcomeReleaseTimer = null; }
  const held = body.classList.contains('outcome-completed') || body.classList.contains('outcome-dryrun');
  if (!kind && fade && held && !body.classList.contains('outcome-release')) {
    body.classList.add('outcome-release');
    outcomeReleaseTimer = setTimeout(() => {
      outcomeReleaseTimer = null;
      body.classList.remove(...OUTCOME_BODY_CLASSES);
    }, 1000);
    return;
  }
  body.classList.remove(...OUTCOME_BODY_CLASSES);
  if (kind === 'completed' || kind === 'dryrun' || kind === 'cancelled') body.classList.add(`outcome-${kind}`);
}

// main emits 'complete' BEFORE it runs the power action. If main then reports
// an error, or a 'dryrun' (blocked) event for a REAL run, the success payoff
// is withdrawn at once: classes off, lights back to 1, no assembled O, and
// the idle face no longer says the session completed.
function dropOutcomeHold() {
  if (state.lastOutcome !== 'completed' && state.lastOutcome !== 'dryrun') return;
  state.lastOutcome = null;
  state.outcomeSkipConfirmed = false;
  if (outcomeTimer) clearTimeout(outcomeTimer);
  setOutcomeBodyClass(null);
}

// Any idle setup interaction ends the hold early, with the plain fade back.
function releaseOutcomeHold() {
  if (state.running || state.paused) return;
  if (state.lastOutcome !== 'completed' && state.lastOutcome !== 'dryrun') return;
  state.lastOutcome = null;
  state.outcomeSkipConfirmed = false;
  if (outcomeTimer) clearTimeout(outcomeTimer);
  setOutcomeBodyClass(null, { fade: true });
  render();
}

// Arrival: only from main's 'started' event (a countdown really began, from
// any origin), only at the very start of a running countdown, at most once
// per 1.5 s. Pause and Cancel are never hidden by it (transform only in CSS).
let arrivalTimer = null;
let lastArrivalAt = 0;
function playSessionArrival() {
  if (!state.running || state.paused) return;
  const total = Number(state.totalSeconds);
  const remaining = Number(state.remainingSeconds);
  if (!(total > 0) || !(remaining / total >= 0.99)) return;
  const now = Date.now();
  if (now - lastArrivalAt < 1500) return;
  lastArrivalAt = now;
  const body = document.body;
  body.classList.remove('session-arrive');
  void body.offsetWidth;
  body.classList.add('session-arrive');
  if (arrivalTimer) clearTimeout(arrivalTimer);
  arrivalTimer = setTimeout(() => { arrivalTimer = null; body.classList.remove('session-arrive'); }, 1200);
}

// Launch ignition: once per app run, on the first window focus (a login
// start is minimized and idle, so it plays when the user first opens the
// window). Opacity only, on the room and the lamp's beam and lens.
let lampIgnited = false;
function igniteLamp() {
  if (lampIgnited) return;
  lampIgnited = true;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const body = document.body;
  body.classList.add('lo-ignite');
  setTimeout(() => body.classList.remove('lo-ignite'), 1000);
}

// -- The morning after (UI-R3 P11) ---------------------------------------------
// After a REAL Sleep, Hibernate or Shutdown that main confirmed
// (power_executed, ended < 16 h ago; morningNoteFor in renderer-receipts.js),
// Tonight's plan column greets you with one line and a link to the receipt.
// Never for Test Mode, blocked, failed, interrupted or cancelled runs; hidden
// while a run is active (render()) and in mini / fullscreen mode (CSS). The
// lamp plays once per receipt, only when the window really has focus
// (igniteLamp itself is once per app run and honours reduced motion).
let lastMorningNoteId = null;
async function refreshMorningNote() {
  const note = document.getElementById('morning-note');
  if (!note || typeof morningNoteFor !== 'function') return;
  let receipt = null;
  try { receipt = await api.getLatestReceipt?.(); } catch { receipt = null; }
  const info = morningNoteFor(receipt, Date.now());
  if (!info || state.running || state.paused) {
    note.hidden = true;
    return;
  }
  const textEl = document.getElementById('morning-note-text');
  const at = formatClock(info.endedAt);
  if (textEl) textEl.textContent = `${info.lead || 'Latest'}: ${info.action} at ${at} · receipt ${info.shortId}`;
  note.hidden = false;
  if (info.id !== lastMorningNoteId) {
    lastMorningNoteId = info.id;
    if (typeof document.hasFocus === 'function' && document.hasFocus()) igniteLamp();
  }
}

// -- Session announcer (UI-R3 P05) --------------------------------------------
// #session-announcer is the one live region for session events. It speaks
// only when main reports an event (applyTimerPayload below), never per
// second: phase changes, start / pause / resume / snooze / cancel /
// complete, and minute marks at 5 minutes and below. Every sentence comes
// from state and the payload; completion never claims a power action ran.
let lastAnnouncedMinute = null;
let lastAnnouncement = { text: '', at: 0 };

function spokenDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const part = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (h) parts.push(part(h, 'hour'));
  if (m) parts.push(part(m, 'minute'));
  if (!h && sec && (!m || m < 5)) parts.push(part(sec, 'second'));
  return parts.length ? parts.join(' ') : part(0, 'second');
}

function announce(message) {
  const el = document.getElementById('session-announcer');
  if (!el || !message) return;
  const now = Date.now();
  // The local call and main's echo of one event say it once.
  if (message === lastAnnouncement.text && now - lastAnnouncement.at < 2000) return;
  lastAnnouncement = { text: message, at: now };
  el.textContent = '';
  setTimeout(() => { el.textContent = message; }, 50);
}

function announceSessionEvent(data) {
  const remaining = Number(state.remainingSeconds);
  const minutesLeft = Number.isFinite(remaining) ? Math.ceil(remaining / 60) : null;
  const realWords = `REAL ${actionLabel()}`;
  switch (data.type) {
    case 'started':
      lastAnnouncedMinute = minutesLeft;
      announce(state.dryRun
        ? `Test Mode session started, ${spokenDuration(state.totalSeconds)}, no power action`
        : `${realWords} session started, ${spokenDuration(state.totalSeconds)}`);
      break;
    case 'paused':
      announce(state.dryRun ? 'Test Mode session paused' : `${realWords} session paused`);
      break;
    case 'resumed':
      announce(`Session resumed, ${spokenDuration(remaining)} left`);
      break;
    case 'snoozed':
      lastAnnouncedMinute = minutesLeft;
      if (Number.isFinite(Number(data.addedSeconds)) && Number(data.addedSeconds) > 0) {
        announce(`Snoozed ${spokenDuration(Number(data.addedSeconds))}, ${spokenDuration(remaining)} left`);
      }
      break;
    case 'phase': {
      const phaseLabel = { dim: 'Winding Down', lastlight: 'Last Light' }[data.phase];
      if (phaseLabel) announce(state.dryRun ? `${phaseLabel}, Test Mode` : `${phaseLabel}, ${realWords} at the end`);
      break;
    }
    case 'cancelled':
      lastAnnouncedMinute = null;
      announce('Session cancelled');
      break;
    case 'complete':
      lastAnnouncedMinute = null;
      announce(state.dryRun ? 'Test Mode session complete' : 'Session complete');
      break;
    case 'tick':
      // Minute-boundary crossings at 5 minutes and below; never while paused.
      if (!state.paused && state.running && minutesLeft !== null && remaining > 0 && minutesLeft <= 5 && minutesLeft !== lastAnnouncedMinute) {
        lastAnnouncedMinute = minutesLeft;
        announce(`${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} left${state.dryRun ? ', Test Mode' : ''}`);
      }
      break;
    default:
      break;
  }
}

// After Start, keyboard focus moves to Pause; after Cancel / completion, back
// to Tonight's Start. Only when this window has focus, focus was lost (BODY or
// a control that just hid), and no dialog, onboarding or Settings is open.
function moveSessionFocus(id) {
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;
  if (timerShortcutSurfaceBlocked()) return;
  if (els.panelSet && els.panelSet.style.display !== 'none') return;
  const active = document.activeElement;
  if (active && active !== document.body && isRendered(active)) return;
  const target = document.getElementById(id);
  if (isSensibleFocusTarget(target)) target.focus({ preventScroll: true });
}

function applyTimerPayload(data) {
  if (!data || typeof data !== 'object') return;

  if (typeof data.running === 'boolean') state.running = data.running;
  if (typeof data.paused === 'boolean') state.paused = data.paused;
  if (Number.isFinite(Number(data.totalSeconds ?? data.total))) {
    state.totalSeconds = Number(data.totalSeconds ?? data.total);
  }
  if (Number.isFinite(Number(data.remainingSeconds ?? data.remaining))) {
    state.remainingSeconds = Number(data.remainingSeconds ?? data.remaining);
  }
  if (data.action) state.action = data.action;
  if (typeof data.dryRun === 'boolean') state.dryRun = data.dryRun;
  if (data.endsAt !== undefined) state.endsAt = data.endsAt;
  // Display only: where the run started (P06/P11 show it).
  if (typeof data.origin === 'string') state.origin = data.origin;
  // Display only (UI-R3 Fire 04): the run's grace, for the winding-down station.
  if (data.gracePeriod !== undefined) {
    state.runGraceMinutes = data.gracePeriod !== null && Number.isFinite(Number(data.gracePeriod)) && Number(data.gracePeriod) >= 0 ? Number(data.gracePeriod) : null;
  }

  if (data.type === 'complete') {
    state.running = false;
    state.paused = false;
    state.runGraceMinutes = null;
    state.remainingSeconds = inputSeconds();
    state.totalSeconds = state.remainingSeconds;
    state.endsAt = null;
    if (state._clockDismissedByProfile) { state.clockMode = true; state._clockDismissedByProfile = false; }
    state.phase = 'idle';
    SoundSystem.playComplete();
    Soundscape.fadeToZero(2);
    hideWarningModal();
    removeWarmFilter();
    loadStreaks();
    if (data.streaks && data.streaks.streak >= 1) {
      showStreakCelebration(data.streaks.streak);
    }
    // main's completeTimer() sends the one native notification for this.
    notify(data.message || 'Timer complete', 'success', 5000);
    setSessionOutcome(state.dryRun ? 'dryrun' : 'completed');
    if (typeof AmbientVisuals !== 'undefined') AmbientVisuals.stop();
  } else if (data.type === 'cancelled') {
    state.running = false;
    state.paused = false;
    state.runGraceMinutes = null;
    state.endsAt = null;
    state.phase = 'idle';
    Soundscape.stop();
    hideWarningModal();
    removeWarmFilter();
    setSessionOutcome('cancelled');
    notify('Session cancelled', 'info');
    if (typeof AmbientVisuals !== 'undefined') AmbientVisuals.stop();
  } else if (data.type === 'warning') {
    SoundSystem.playWarning();
    if (data.message) {
      els.warningCard.style.display = '';
      els.warningText.textContent = data.message;
      api.showNotification('Lights Out', data.message);
      showWarningModal(data.message);
    }
  } else if (data.type === 'phase') {
    state.phase = data.phase || 'idle';
    if (data.phase === 'dim') {
      applyWarmFilter();
      // Start ambient visual during dim phase.
      const vis = state.customization.ambientVisual || 'off';
      if (vis !== 'off' && typeof AmbientVisuals !== 'undefined') {
        AmbientVisuals.init(els.ambientCanvas);
        AmbientVisuals.start(vis);
      }
    }
    if (data.phase === 'lastlight') Soundscape.fadeToZero(3);
  } else if (data.type === 'started') {
    state.phase = 'focus';
    // A countdown really began (any origin): the last outcome is over.
    state.lastOutcome = null;
    state.outcomeSkipConfirmed = false;
    if (outcomeTimer) clearTimeout(outcomeTimer);
    setOutcomeBodyClass(null);
    playSessionArrival();
    const sc = state.customization.soundscape || 'off';
    if (sc !== 'off') Soundscape.start(sc);
  } else if (data.type === 'tick' && state.remainingSeconds <= 10 && state.remainingSeconds > 0) {
    SoundSystem.playTone(800, 0.04, 'sine', 0.08);
  } else if (data.type === 'dryrun') {
    notify(data.message || 'Test Mode skipped the power action', 'info');
    // Test Mode: main confirms it skipped the action. A REAL run reported as
    // 'dryrun' was blocked (QA power lock): withdraw the completion payoff.
    if (state.dryRun) {
      if (state.lastOutcome === 'dryrun') state.outcomeSkipConfirmed = true;
    } else {
      dropOutcomeHold();
    }
  } else if (data.type === 'error') {
    notify(data.message || 'Timer error', 'error');
    dropOutcomeHold();
  }

  render();
  announceSessionEvent(data);
  // Deferred one task: a dialog this event just closed (heads-up) first
  // releases .cockpit (renderer-utils dialog layers, a microtask) and gets
  // its own focus restore.
  const focusTarget = data.type === 'started' ? 'btn-pause'
    : (data.type === 'cancelled' || data.type === 'complete') ? 'ns-play-btn' : null;
  if (focusTarget) setTimeout(() => moveSessionFocus(focusTarget), 0);
  // UI-R3 P11: a run that ended wrote its receipt; Proof re-reads it (never
  // assumes the result).
  if (data.type === 'complete' || data.type === 'cancelled' || data.type === 'dryrun' || data.type === 'error') {
    setTimeout(() => { if (typeof refreshProofSurfaces === 'function') refreshProofSurfaces(); }, 400);
  }
}

async function loadStreaks() {
  try {
    // UI-R3 Fire 10: Routine shows no achievements and no 30-day grid, so it
    // reads neither the catalog nor the 30-day history (the IPC stays).
    const summary = await api.getStreaks();
    const report = await api.getWeeklyReport();
    const sleepScore = await api.getSleepScore();
    const trend = await api.getStreaksTrend?.(state.trendGranularity) || [];
    renderStreaks(summary, report, sleepScore, trend);
  } catch { /* streaks are decorative, never block */ }
}

// Re-fetches and re-renders just the trend rows, without a full loadStreaks()
// round trip -- used by the Weekly/Monthly toggle.
async function refreshTrend() {
  try {
    const trend = await api.getStreaksTrend?.(state.trendGranularity) || [];
    renderTrend(trend);
  } catch { /* decorative, never block */ }
}

function renderTrend(trend) {
  if (!els.trendList) return;

  if (!trend || !trend.length) {
    els.trendList.innerHTML = '<div class="trend-empty">Not enough history yet.</div>';
    return;
  }

  // Most recent period first; bar width relative to the period's own length
  // (7 days for a week, actual days for a month) so a partial current period
  // doesn't look like a slump next to full past periods.
  const rows = [...trend].reverse();
  els.trendList.innerHTML = rows.map(t => {
    const pct = Math.round(clamp(t.nights / t.periodLength, 0, 1) * 100);
    return `
      <div class="trend-row">
        <span class="trend-row-label">${escapeHtml(t.label)}</span>
        <div class="trend-row-track"><div class="trend-row-fill" style="width:${pct}%"></div></div>
        <span class="trend-row-val">${t.nights}/${t.periodLength} runs · avg lights-out ${t.avgBedTime} · ${t.onTimePercent}% before 11 PM</span>
      </div>
    `;
  }).join('');
}

// Home streak callout: show the current streak above Saved Profiles, but only
// when there actually is one. A zero/absent streak stays hidden so the home
// screen never displays a "0-night streak" or any unearned claim.
function updateStreakCallout(summary) {
  if (!els.streakCallout) return;
  // Never resurface it mid-run (e.g. a First Light morning briefing arriving
  // while a run is still active) -- render()'s focused active-run screen
  // owns hiding it, this just keeps that guarantee even for callers that
  // don't go through render() first.
  if (state.running || state.paused) { els.streakCallout.style.display = 'none'; return; }
  const streak = Number(summary && summary.streak) || 0;
  if (streak < 1) {
    els.streakCallout.style.display = 'none';
    return;
  }
  if (els.streakCalloutCount) els.streakCalloutCount.textContent = streak;
  if (els.streakCalloutBest) {
    const best = Number(summary.bestStreak) || 0;
    els.streakCalloutBest.textContent = best > streak ? `· best ${best}` : '';
  }
  // UI-R3 P11: Proof › Routine now states the real streak itself
  // (#routine-streak, beside the 14-night strip), so the callout stays in the
  // DOM (ids kept) but is never shown on Proof.
  els.streakCallout.style.display = 'none';
}

// Fetch just the streak summary (cheap) to drive the home callout, independent
// of the Streaks tab being opened.
async function refreshStreakCallout() {
  try {
    updateStreakCallout(await api.getStreaks());
  } catch { /* decorative, never block */ }
}

function showStreakCelebration(count) {
  // Never celebrate a Test Mode run or a non-streak: that claim would be false.
  if (state.dryRun || !(Number(count) >= 1)) return;
  const modal = document.getElementById('streak-celebration-modal');
  const num = document.getElementById('celebration-streak-number');
  if (modal && num) {
    num.textContent = count;
    modal.classList.add('active');
  }
}

// UI-R3 Fire 10: Routine is one spec strip of real numbers (no ring, no
// trophies, no 30-day 'Missed' grid). The score and its breakdown are plain
// text; the breakdown's 'Ritual' part is streak plus milestones, so it keeps
// that name (calling it 'Streak' would hide part of the score).
function renderStreaks(summary, report, sleepScore, trend) {
  if (!summary) return;

  // App-use routine score. This is deliberately not presented as measured sleep.
  if (sleepScore && sleepScore.score !== null) {
    if (els.scoreValue) els.scoreValue.textContent = sleepScore.score;
    if (els.scoreLabel) els.scoreLabel.textContent = sleepScore.label || 'Scored';
    // Breakdown: plain 'x/max' text (numbers only, no fills, no colour).
    if (els.scoreBreakdown) {
      const bd = sleepScore.breakdown || {};
      const part = (p, name) => {
        if (!p || !Number.isFinite(Number(p.score)) || !Number.isFinite(Number(p.max))) return '';
        return `<li class="routine-bd-item"><span class="routine-bd-label">${name}</span><b class="routine-bd-val">${Number(p.score)}/${Number(p.max)}</b></li>`;
      };
      els.scoreBreakdown.innerHTML = [
        part(bd.consistency, 'Consistency'),
        part(bd.onTime, 'Earlier timing'),
        part(bd.noSnooze, 'No snooze'),
        part(bd.ritual, 'Ritual')
      ].join('');
    }
  } else if (els.scoreValue) {
    els.scoreValue.textContent = '--';
    if (els.scoreLabel) els.scoreLabel.textContent = 'needs 3 real runs';
    if (els.scoreBreakdown) els.scoreBreakdown.innerHTML = '';
  }

  updateStreakCallout(summary);

  if (els.streakCount) els.streakCount.textContent = summary.streak || 0;
  if (els.streakBest) els.streakBest.textContent = summary.bestStreak || 0;
  if (els.streakTotal) els.streakTotal.textContent = summary.totalNights || 0;
  if (els.streakWeekAvg) els.streakWeekAvg.textContent = summary.weekAvg || '--:--';
  if (els.streakOnTime) els.streakOnTime.textContent = `${summary.weekOnTime || 0}%`;

  if (els.weeklyReportText) {
    els.weeklyReportText.textContent = report?.narrative || 'No nights logged this week yet. Start a timer tonight to begin this week\'s report.';
  }

  renderTrend(trend);
}

function toggleMiniMode() {
  state.miniMode = !state.miniMode;
  api.toggleMiniMode();
  render();
  notify(state.miniMode ? 'Mini mode' : 'Full view', 'info');
}

// Full screen clock mode: reuses the existing window (main.js setFullScreen),
// no separate BrowserWindow. state.fullscreenClock is only ever set from
// applyFullscreenClockState() -- the main process's isFullScreen() is the
// single source of truth, reached either by these calls or by an OS-level
// exit (Alt+Tab, taskbar) that never goes through our IPC.
function enterFullscreenClock() {
  // The fullscreen CSS only hides content within #ns-panel-lib; force that
  // panel active first so a stale nsActiveTab (e.g. left on Schedule/Stats
  // from a prior session) can't leak its content into the fullscreen view.
  handleSidebarNavigation('lib', { persist: false, focusNav: false });
  api.setFullScreenClock?.(true);
}
function exitFullscreenClock() {
  // If the exit IPC is lost or fails, drop the pending flag so render() asks
  // again: a session must never stay stuck behind the fullscreen clock.
  clearTimeout(fullscreenExitRetryTimer);
  fullscreenExitRetryTimer = setTimeout(() => {
    fullscreenExitRetryTimer = null;
    if (state.fullscreenClock && fullscreenExitPending) { fullscreenExitPending = false; render(); }
  }, FULLSCREEN_EXIT_RETRY_MS);
  Promise.resolve(api.setFullScreenClock?.(false)).catch(() => { fullscreenExitPending = false; });
}
function applyFullscreenClockState(isFullScreen) {
  state.fullscreenClock = !!isFullScreen;
  if (!state.fullscreenClock) fullscreenExitPending = false;
  if (!state.fullscreenClock) { clearTimeout(fullscreenExitRetryTimer); fullscreenExitRetryTimer = null; }
  els.body.classList.toggle('fullscreen-clock-mode', state.fullscreenClock);
  render();
}

function selectClockTarget(timeValue) {
  const seconds = secondsUntilClockValue(timeValue);
  // One night only and an armed Night Mode are exclusive: setting a target is
  // a lobby duration edit, so the armed mode (whose fixed duration the hero
  // and banner would keep claiming) is cleared, never left beside the target.
  if (state.armedNightMode) clearArmedNightMode();
  state.unit = 'min';
  // setInputFromSeconds() renders, and render() rewrites the hint and note.
  setInputFromSeconds(seconds);
  // Fire 09: an honest toast (Test Mode never names a real action). Skipped
  // for an invalid or past target: render() already says so in the hint.
  const target = String(timeValue || '').includes('T') ? new Date(timeValue) : null;
  if (target && !Number.isNaN(target.getTime()) && target > new Date()) {
    const when = formatScheduleWhen(target);
    notify(state.dryRun ? `Test Mode countdown to ${when}` : `${actionLabel()} at ${when}`, 'info');
  }
}

// Format a "YYYY-MM-DDTHH:MM" default for the schedule picker: next occurrence of bedtime.
function defaultScheduleDateTime(hhmm) {
  const [h, m] = String(hhmm || '22:30').split(':').map(Number);
  const t = new Date();
  t.setHours(Number.isFinite(h) ? h : 22, Number.isFinite(m) ? m : 30, 0, 0);
  if (t <= new Date()) t.setDate(t.getDate() + 1);
  const pad = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

// Schedule \u203a One night only: the target Tonight's Start counts down to, read
// from the very inputs inputSeconds() reads (#chk-schedule + #schedule-time).
function scheduleOverrideTarget() {
  if (!els.scheduleCheck?.checked || !els.scheduleTime?.value) return null;
  const target = new Date(els.scheduleTime.value);
  return Number.isNaN(target.getTime()) ? null : target;
}

// "22:30 today" / "10:30 PM tomorrow" / "22:30 Thu, Oct 9": the time follows
// the 12h/24h setting (formatClock); the date part stays locale-formatted.
function formatScheduleWhen(target, now = new Date()) {
  const time = formatClock(target);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (target.toDateString() === now.toDateString()) return `${time} today`;
  if (target.toDateString() === tomorrow.toDateString()) return `${time} tomorrow`;
  return `${time} ${target.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

// Runs on every render(): the One night only label and hint, and the Tonight
// note that says Start will count down to that time (never a silent override).
function updateScheduleHint() {
  const target = scheduleOverrideTarget();
  const now = new Date();
  const past = Boolean(target) && target <= now;
  // Defensive: the two are kept exclusive (selectClockTarget / armNightMode),
  // but if a Night Mode is armed, no line here may promise an end time.
  const armed = Boolean(state.armedNightMode);
  let hint = '';
  if (target && armed) {
    hint = `${state.armedNightMode.nightModeTitle || 'A Night Mode'} is armed on Tonight. Pick the time again to use it instead.`;
  } else if (target && past) {
    hint = 'That time has passed. Start would run in 1 min. Clear or pick a new time.';
  } else if (target) {
    const totalMinutes = Math.max(1, Math.round(secondsUntilClockValue(els.scheduleTime.value) / 60));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const inText = h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    const when = formatScheduleWhen(target, now);
    hint = state.dryRun
      ? `Test Mode countdown to ${when}, in ${inText}. Nothing will power off.`
      : `${actionLabel()} at ${when}, in ${inText}.`;
  }
  setTextIfChanged(els.schOnceAction, actionLabel());
  if (els.scheduleHint) {
    setTextIfChanged(els.scheduleHint, hint);
    if (past && !armed) els.scheduleHint.dataset.state = 'past';
    else delete els.scheduleHint.dataset.state;
  }

  const note = els.tonightTargetNote;
  if (!note) return;
  const showNote = Boolean(target) && !armed && !state.running && !state.paused && !state.miniMode && !state.fullscreenClock;
  if (note.hidden === showNote) note.hidden = !showNote;
  if (showNote) setTextIfChanged(els.tonightTargetWhen, past ? 'a time that has passed (1 min)' : formatScheduleWhen(target, now));
  if (els.timerInput) {
    if (showNote) els.timerInput.setAttribute('aria-describedby', 'tonight-target-note');
    else els.timerInput.removeAttribute('aria-describedby');
  }
}
// UI-R1: the top Power/Settings/Help menus were removed -- the sidebar is
// the single navigation authority. Their behaviors re-homed: action
// selection -> action chips / "Change ending", toggles -> Settings
// checkboxes (chk-dryrun/chk-mute/chk-graceful), Advanced Options ->
// sidebar Settings, About/docs -> sidebar About + about-modal.

function wireEvents() {
  els.btnStop.addEventListener('click', cancelTimer);
  els.btnPause.addEventListener('click', togglePause);
  els.btnSnooze.addEventListener('click', () => snooze(5 * 60));
  // UI-R1 snooze chips: same snooze() path as the main button — same
  // Override Tax assessment and receipt attribution, just explicit amounts.
  document.querySelectorAll('.snooze-chip').forEach(btn => {
    btn.addEventListener('click', () => snooze(Number(btn.dataset.snooze) || 300));
  });
  els.btnMinimize.addEventListener('click', () => api.minimizeWindow());
  els.btnMaximize?.addEventListener('click', () => api.toggleMaximizeWindow());
  els.btnClose.addEventListener('click', () => api.closeWindow());
  els.btnMini?.addEventListener('click', toggleMiniMode);
  document.getElementById('btn-mini-exit')?.addEventListener('click', toggleMiniMode);
  els.btnFullscreenClock?.addEventListener('click', enterFullscreenClock);
  els.btnFullscreenClockExit?.addEventListener('click', exitFullscreenClock);
  api.onFullScreenChanged?.(applyFullscreenClockState);
  // Top menus removed in UI-R1 (single nav authority).
  document.querySelectorAll('.settings-rail-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSettingsCategory(btn.dataset.settingsCategory));
  });
  setupSettingsSearch();
  setupBrandSignature();
  els.btnWidget?.addEventListener('click', async () => {
    try {
      const result = await api.toggleWidget?.();
      if (!result?.success) throw new Error('Widget did not confirm its state');
      notify(result?.visible ? 'Desktop widget shown' : 'Desktop widget hidden', 'info');
    } catch (error) {
      notify(`Desktop widget failed: ${error.message || error}`, 'error');
    }
  });
  els.btnCompanion?.addEventListener('click', async () => {
    try {
      const rc = await api.getRemoteControl?.();
      if (rc?.ready && rc.url) {
        await api.openExternal?.(rc.url);
        notify('Companion pairing page opened', 'info');
      } else {
        // Routed through the central navigation entry point (see
        // handleSidebarNavigation() above) instead of calling
        // openSettingsPanel() directly -- that bypassed the blocking-modal
        // refusal and dismissible-modal cleanup every other Settings
        // opener already goes through. Only shows this button's own
        // guidance message if Settings actually opened -- otherwise
        // handleSidebarNavigation() has already shown its own refusal
        // notice, and stacking a second, contradictory "go to Settings"
        // message on top of it would be misleading.
        const opened = await handleSidebarNavigation('set');
        if (opened) {
          notify(rc?.failed ? 'Companion is unavailable; review the connection error in Settings' : 'Enable and verify Phone Companion in Settings first', rc?.failed ? 'error' : 'info');
        }
      }
    } catch {
      notify('Companion setup is unavailable right now', 'warning');
    }
  });

  // Family mode scan and remote controls.
  els.btnFamilyScan?.addEventListener('click', async () => {
    try {
      els.familyStatus.textContent = 'Scanning...';
      const peers = await api.getFamilyPeers?.();
      renderFamilyPeers(peers || []);
      els.familyStatus.textContent = peers?.length ? `${peers.length} peer(s) found` : 'No peers found';
    } catch {
      els.familyStatus.textContent = 'Scan failed';
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// WiFi Guard: block internet for kids at bedtime
// ─────────────────────────────────────────────────────────────────────────────

if (els.chkWifiGuard) {
  els.chkWifiGuard.addEventListener('change', () => {
    const requested = els.chkWifiGuard.checked;
    const config = collectWifiGuardSettings();
    const hasSetup = config.provider === 'adapter' || (config.provider === 'webhook'
      ? /^https?:\/\//i.test(config.webhookUrl)
      : Boolean(config.routerIp && (config.deviceMacs.length || config.deviceIps.length)));
    if (requested && !hasSetup) {
      els.chkWifiGuard.checked = false;
      els.wifiGuardConfig.style.display = '';
      if (els.wifiTestResult) els.wifiTestResult.textContent = 'Complete provider setup before enabling WiFi Guard.';
      return;
    }
    els.wifiGuardConfig.style.display = requested ? '' : 'none';
  });
}

if (els.selWifiProvider) {
  els.selWifiProvider.addEventListener('change', () => {
    const p = els.selWifiProvider.value;
    els.wifiRouterCfg.style.display = ['tplink', 'asus', 'netgear'].includes(p) ? '' : 'none';
    els.wifiWebhookCfg.style.display = p === 'webhook' ? '' : 'none';
  });
}

if (els.btnWifiScan) {
  els.btnWifiScan.addEventListener('click', async () => {
    els.btnWifiScan.textContent = 'Scanning...';
    els.btnWifiScan.disabled = true;
    try {
      const devices = await api.wifiGuardScan?.();
      renderWifiDevices(devices || []);
    } catch { renderWifiDevices([]); }
    els.btnWifiScan.textContent = 'Scan network';
    els.btnWifiScan.disabled = false;
  });
}

if (els.btnWifiBlockTest) {
  els.btnWifiBlockTest.addEventListener('click', async () => {
    els.wifiTestResult.textContent = 'Blocking...';
    try {
      const saved = await api.saveWifiGuardSettings?.(collectWifiGuardSettings());
      if (!saved?.settings?.enabled) {
        applyWifiGuardSettings(saved?.settings);
        return;
      }
      const result = await api.wifiGuardBlock?.();
      if (result?.success) noteWifiGuardLive(true);
      els.wifiTestResult.textContent = result.success ? 'Blocked!' : `Failed: ${result.error}`;
      els.wifiTestResult.style.color = result.success ? '#4caf50' : '#ff4d4d';
    } catch { els.wifiTestResult.textContent = 'Error'; }
  });
}

if (els.btnWifiUnblockTest) {
  els.btnWifiUnblockTest.addEventListener('click', async () => {
    els.wifiTestResult.textContent = 'Unblocking...';
    try {
      const result = await api.wifiGuardUnblock?.();
      if (result?.success) noteWifiGuardLive(false);
      els.wifiTestResult.textContent = result.success ? 'Unblocked!' : `Failed: ${result.error}`;
      els.wifiTestResult.style.color = result.success ? '#4caf50' : '#ff4d4d';
    } catch { els.wifiTestResult.textContent = 'Error'; }
  });
}

// WiFi Guard status notification.
api.onWifiGuardStatus?.(data => {
  if (!data || typeof data !== 'object') return;
  // A real event from main: the only push source for the Devices 'Right now' row.
  noteWifiGuardLive(Boolean(data.blocked));
  if (data.blocked) notify('WiFi Guard: Internet blocked', 'warning');
  else notify('WiFi Guard: Internet restored', 'info');
});

// Bedtime Reminder notification.
api.onBedtimeReminder?.(data => {
  if (data?.message) {
    notify(data.message, 'info', 10000);
  }
});

// Idle detection notification.
api.onIdleDetected?.(data => {
  notify(`You've been idle for ${Math.round(data.idleSeconds / 60)} minutes. Still there?`, 'warning');
});

// Morning briefing (from First Light).
api.onMorningBriefing?.(data => {
  if (!data) return;
  // Main sends a fresh streak summary with the briefing — keep the home streak
  // callout in sync with it.
  if (data.streaks) updateStreakCallout(data.streaks);

  // Build an honest one-line briefing: lead with the streak only when there is
  // one, then the next scheduled event if any.
  const parts = [];
  const streak = Number(data.streaks && data.streaks.streak) || 0;
  if (streak >= 1) parts.push(`${streak}-night streak`);
  const next = data.events && data.events[0];
  if (next) parts.push(`next: ${next.title || 'nothing scheduled'}`);
  if (parts.length) notify(`Good morning! ${parts.join(' · ')}`, 'info', 8000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Content Blocker: block social media during wind-down
// ─────────────────────────────────────────────────────────────────────────────

if (els.chkContentBlocker) {
  els.chkContentBlocker.addEventListener('change', () => {
    const requested = els.chkContentBlocker.checked;
    const config = collectContentBlockerSettings();
    if (requested && !config.useDefault && !config.blocklist.length) {
      els.chkContentBlocker.checked = false;
      els.contentBlockerConfig.style.display = '';
      if (els.contentTestResult) els.contentTestResult.textContent = 'Choose the default list or add at least one site before enabling.';
      return;
    }
    els.contentBlockerConfig.style.display = requested ? '' : 'none';
  });
}

if (els.btnContentBlockTest) {
  els.btnContentBlockTest.addEventListener('click', async () => {
    els.contentTestResult.textContent = 'Blocking...';
    try {
      const config = collectContentBlockerSettings();
      const saved = await api.saveContentBlockerSettings?.(config);
      if (!saved?.settings?.enabled) {
        applyContentBlockerSettings(saved?.settings);
        return;
      }
      const result = await api.contentBlock?.(config.useDefault ? undefined : config.blocklist);
      els.contentTestResult.textContent = result.success ? `Blocked ${result.sites} sites!` : `Failed: ${result.error}`;
      els.contentTestResult.style.color = result.success ? '#4caf50' : '#ff4d4d';
    } catch { els.contentTestResult.textContent = 'Error (may need admin)'; }
  });
}

if (els.btnContentUnblockTest) {
  els.btnContentUnblockTest.addEventListener('click', async () => {
    els.contentTestResult.textContent = 'Unblocking...';
    try {
      const result = await api.contentUnblock?.();
      els.contentTestResult.textContent = result.success ? 'Unblocked!' : `Failed: ${result.error}`;
      els.contentTestResult.style.color = result.success ? '#4caf50' : '#ff4d4d';
    } catch { els.contentTestResult.textContent = 'Error'; }
  });
}

api.onContentBlocked?.(data => {
  if (data?.blocked) notify(`Content blocked: ${data.sites} sites`, 'warning');
});

// ─────────────────────────────────────────────────────────────────────────────
// Accountability Partner: notify on timer events
// ─────────────────────────────────────────────────────────────────────────────

if (els.chkAccountability) {
  els.chkAccountability.addEventListener('change', () => {
    const requested = els.chkAccountability.checked;
    const hasWebhook = /^https?:\/\//i.test(els.accWebhookUrl?.value?.trim() || '');
    if (requested && !hasWebhook) {
      els.chkAccountability.checked = false;
      els.accountabilityConfig.style.display = '';
      if (els.accTestResult) els.accTestResult.textContent = 'Enter and test a webhook before enabling notifications.';
      return;
    }
    els.accountabilityConfig.style.display = requested ? '' : 'none';
  });
}

if (els.btnAccTest) {
  els.btnAccTest.addEventListener('click', async () => {
    els.accTestResult.textContent = 'Sending...';
    try {
      const url = els.accWebhookUrl?.value;
      const name = els.accPartnerName?.value || 'Partner';
      if (!url) { els.accTestResult.textContent = 'Enter a webhook URL first'; return; }
      const results = await api.testAccountabilityPartner?.({
        type: 'webhook', url, name
      });
      const ok = results?.[0]?.success;
      els.accTestResult.textContent = ok ? 'Notification sent!' : 'Failed to send';
      els.accTestResult.style.color = ok ? '#4caf50' : '#ff4d4d';
    } catch { els.accTestResult.textContent = 'Error'; }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Override Tax: settings panel wiring
// ─────────────────────────────────────────────────────────────────────────────

if (els.chkOverrideTax) {
  els.chkOverrideTax.addEventListener('change', async () => {
    const enabled = els.chkOverrideTax.checked;
    if (els.overrideTaxConfig) els.overrideTaxConfig.style.display = enabled ? '' : 'none';
    await api.updateOverrideTaxConfig?.({ enabled });
  });
}

// Sync tax config inputs on change.
for (const [elId, key] of [['taxFreeSnoozes', 'freeSnoozes'], ['taxTightenMin', 'tightenMinutes'], ['taxMaxTighten', 'maxTighten'], ['taxReasonAfter', 'requireReasonAfter']]) {
  if (els[elId]) {
    els[elId].addEventListener('change', async () => {
      await api.updateOverrideTaxConfig?.({ [key]: Number(els[elId].value) });
    });
  }
}

// Refresh tax stats periodically.
setInterval(refreshTaxStats, 5000);
refreshTaxStats();

// ─────────────────────────────────────────────────────────────────────────────
// Autopilot Bedtime: settings panel wiring
// ─────────────────────────────────────────────────────────────────────────────

if (els.chkAutopilot) {
  els.chkAutopilot.addEventListener('change', async () => {
    const enabled = els.chkAutopilot.checked;
    if (els.autopilotConfig) els.autopilotConfig.style.display = enabled ? '' : 'none';
    await api.enableAutopilot?.(enabled);
    if (enabled) refreshAutopilotStatus();
  });
}

if (els.autopilotOverrideTime) {
  // UI-R3 P13: the row claims "Applies now", so make it true. autopilotBedtime
  // lives in the app section (settings.js; autopilot.js reads app.autopilotBedtime)
  // and main's save-app-settings ignores unknown top-level keys, so the patch
  // must be nested under `app`. Autopilot computes its timeout when it is
  // scheduled, so an enabled autopilot is re-armed through the existing
  // enable-autopilot channel to pick up the new time now. A failed write is
  // said out loud.
  els.autopilotOverrideTime.addEventListener('change', async () => {
    const val = els.autopilotOverrideTime.value || null;
    try {
      await api.saveAppSettings?.({ app: { autopilotBedtime: val } });
      if (els.chkAutopilot?.checked) await api.enableAutopilot?.(true);
      refreshAutopilotStatus();
    } catch (error) {
      notify(`Autopilot bedtime was not saved: ${error?.message || error}`, 'error');
    }
  });
}
refreshAutopilotStatus();

// ─────────────────────────────────────────────────────────────────────────────
// Ritual Mode: guided bedtime ritual flow
// ─────────────────────────────────────────────────────────────────────────────

if (els.btnRitual) {
  els.btnRitual.addEventListener('click', async () => {
    const result = await api.ritualStart?.();
    if (result?.active) showRitualOverlay(result);
    else if (result?.reason === 'run-active') notify('A run is already active. Pause or cancel it first.', 'warning');
    else if (result?.reason === 'disabled') notify('The ritual is turned off in Settings.', 'info');
  });
}

if (els.btnRitualNext) {
  els.btnRitualNext.addEventListener('click', async () => {
    const state = await api.ritualAdvance?.();
    if (state?.active) updateRitualOverlay(state);
    else hideRitualOverlay();
  });
}

if (els.btnRitualSkip) {
  els.btnRitualSkip.addEventListener('click', async () => {
    const state = await api.ritualSkip?.();
    if (state?.active) updateRitualOverlay(state);
    else hideRitualOverlay();
  });
}

if (els.btnRitualCancel) {
  els.btnRitualCancel.addEventListener('click', async () => {
    await api.ritualCancel?.();
    hideRitualOverlay();
  });
}

api.onRitualStep?.((data) => {
  if (data?.state?.active) updateRitualOverlay(data.state);
});

api.onRitualComplete?.(() => {
  hideRitualOverlay();
  notify('Bedtime ritual complete. Sweet dreams.', 'success');
});

// ─────────────────────────────────────────────────────────────────────────────
// Focus Sessions: Pomodoro-style deep work
// ─────────────────────────────────────────────────────────────────────────────

// Settings › Automations (UI-R3 P10). While a session runs the presets hide,
// so a second tap can never silently restart it; they return when it ends.
function setFocusPresetsHidden(hidden) {
  if (els.focusPresets) els.focusPresets.hidden = hidden;
}

document.querySelectorAll('.focus-preset-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (els.focusActive && els.focusActive.style.display !== 'none') return;
    const preset = btn.dataset.preset;
    const result = await api.focusStart?.(preset);
    if (result) {
      renderFocusSession(result);
      setFocusPresetsHidden(true);
      notify(`Focus session started: ${preset}`, 'info');
    }
  });
});

if (els.btnFocusPause) {
  els.btnFocusPause.addEventListener('click', async () => {
    const state = await api.focusState?.();
    if (state?.paused) {
      await api.focusResume?.();
      els.btnFocusPause.textContent = 'Pause';
    } else {
      await api.focusPause?.();
      els.btnFocusPause.textContent = 'Resume';
    }
  });
}

if (els.btnFocusStop) {
  els.btnFocusStop.addEventListener('click', async () => {
    await api.focusStop?.();
    if (els.focusActive) els.focusActive.style.display = 'none';
    setFocusPresetsHidden(false);
    notify('Focus session ended', 'info');
  });
}

api.onFocusTick?.(fs => {
  renderFocusSession(fs);
  if (fs) setFocusPresetsHidden(true);
});

api.onFocusPhase?.(data => {
  renderFocusSession(data);
  if (data) setFocusPresetsHidden(true);
  const labels = { focus: 'Focus', break: 'Break', longbreak: 'Long Break' };
  notify(`${labels[data.phase] || data.phase} phase`, 'info');
});

api.onFocusComplete?.(fs => {
  if (els.focusActive) els.focusActive.style.display = 'none';
  setFocusPresetsHidden(false);
  notify(`All done! ${Math.round(fs.totalFocusTime / 60)} min of deep work.`, 'success');
});

// Reality check notification.
api.onRealityCheck?.(data => {
  if (data?.message) notify(data.message, 'warning', 8000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Emergency Override: stay up but it costs
// ─────────────────────────────────────────────────────────────────────────────

if (els.btnOverrideConfirm) {
  els.btnOverrideConfirm.addEventListener('click', async () => {
    const reason = els.overrideReasonInput?.value?.trim() || 'No reason given';
    // The main process cancels the active timer as part of executeOverride, so
    // the shutdown is stopped authoritatively even if this handler errors after.
    await api.executeOverride?.(reason);
    hideOverrideModal();
    notify('Override recorded. Sleep well... eventually.', 'warning');
  });
}

if (els.btnOverrideCancel) {
  els.btnOverrideCancel.addEventListener('click', () => {
    hideOverrideModal();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Morning Proof / Run Receipts
// ─────────────────────────────────────────────────────────────────────────────

// Open receipt (UI-R3 Fire 10): the ledger opens on this receipt's row.
// renderMorningProof sets data-receipt-id from safeReceiptId only; with no
// id the button reads 'View ledger' and just opens the ledger.
if (els.btnProofDetails) {
  els.btnProofDetails.addEventListener('click', async () => {
    const id = els.btnProofDetails.dataset.receiptId || '';
    if (await openReceiptsLedger() === true && id) focusLedgerReceipt(id);
  });
}

if (els.btnWarningLedger) {
  els.btnWarningLedger.addEventListener('click', () => openReceiptsLedger());
}

if (els.receiptsModalClose) {
  els.receiptsModalClose.addEventListener('click', () => {
    if (els.receiptsModal) els.receiptsModal.classList.remove('active');
    resetReceiptsClearConfirm();
  });
}

// Copy proof to clipboard (UI-R3 Fire 10): a complete, honest receipt from
// buildProofText (renderer-receipts.js). On success only the button's own
// label swaps to a check + 'Copied' for 1600 ms (a stacked label, so the
// width never changes) and a polite live region says so; a re-click restarts
// the timer. A missing receipt or a failed write still notifies.
let proofCopiedTimer = null;
function showProofCopied() {
  const btn = els.btnProofCopy;
  const status = document.getElementById('proof-copy-status');
  if (!btn) return;
  clearTimeout(proofCopiedTimer);
  btn.classList.add('is-copied');
  if (status) status.textContent = 'Receipt copied';
  proofCopiedTimer = setTimeout(() => {
    btn.classList.remove('is-copied');
    if (status) status.textContent = '';
    proofCopiedTimer = null;
  }, 1600);
}
if (els.btnProofCopy) {
  els.btnProofCopy.addEventListener('click', async () => {
    try {
      const receipt = await api.getLatestReceipt?.();
      if (!receipt) {
        notify('No receipt to copy yet', 'info');
        return;
      }
      const text = buildProofText(receipt);
      if (!text) throw new Error('empty receipt text');
      await navigator.clipboard.writeText(text);
      showProofCopied();
    } catch { notify('Copy failed', 'error'); }
  });
}

// Start from Proof (UI-R3 Fire 10): land on Tonight first, then start there
// through the one shared start command. A refused navigation starts nothing.
// render() hides the Proof hero while a run is active, so no manual hide.
document.getElementById('btn-proof-again')?.addEventListener('click', () => {
  void handleSidebarNavigation('lib', { persist: false }).then(ok => { if (ok === true) startTonightPlan(); });
});

// The empty Proof page's 'Plan tonight' (UI-R3 Fire 10): opens Tonight and
// focuses its Start control. It never starts anything.
document.getElementById('btn-proof-empty-plan')?.addEventListener('click', () => {
  void handleSidebarNavigation('lib').then(ok => { if (ok === true) document.getElementById('ns-play-btn')?.focus(); });
});

// UI-R3 P11: the Proof hero is the page's own evidence, not an overlay, so it
// has no Close / dismiss control and Escape does not hide it.

// Export the full receipts ledger (not just the modal's visible/limited
// list) as a readable text summary, copied to clipboard -- mirrors the
// Streaks tab's "Export Ledger" pattern.
if (els.btnExportReceipts) {
  els.btnExportReceipts.addEventListener('click', async () => {
    try {
      const receipts = await api.exportReceipts?.() || [];
      if (!receipts.length) {
        notify('No receipts to export', 'info');
        return;
      }

      let ledger = `LIGHTS OUT RUN RECEIPTS\n`;
      ledger += `=========================\n`;
      ledger += `Generated: ${new Date().toLocaleString()}\n`;
      ledger += `Total Runs: ${receipts.length}\n\n`;

      [...receipts].reverse().forEach(r => {
        const start = r.startedAt ? new Date(r.startedAt).toLocaleString() : 'N/A';
        const end = r.endedAt ? new Date(r.endedAt).toLocaleString() : 'N/A';
        const durMin = r.durationSeconds ? Math.floor(r.durationSeconds / 60) : 0;
        ledger += `${start}\n`;
        ledger += `  Result: ${humanizeReceiptResult(r.result)}\n`;
        if (getReceiptProfileLabel(r)) ledger += `  ${getReceiptProfileLabel(r)}\n`;
        ledger += `  Action: ${r.action || 'N/A'}${r.forceShutdown ? ' (Force)' : ''}${r.dryRun ? ' (Test Mode)' : ''}\n`;
        // durationSeconds is the planned length (Fire 10), never 'Duration'.
        ledger += `  Planned: ${durMin}m | Ended: ${end}\n`;
        ledger += `  Pauses: ${r.pauseCount || 0}, Snoozes: ${r.snoozeCount || 0}, Warnings: ${r.warningsShown || 0}\n`;
        if (r.notes) ledger += `  Notes: ${r.notes}\n`;
        ledger += `\n`;
      });

      await navigator.clipboard.writeText(ledger);
      notify(`${receipts.length} receipts copied to clipboard`, 'success', 3000);
    } catch (e) {
      notify('Failed to export receipts', 'error');
    }
  });
}

// Delete all receipts (UI-R3 P11): two steps. 'Delete all receipts…' only
// opens the inline confirm (Keep focused); only #btn-clear-receipts-confirm
// deletes (confirmClearReceipts, renderer-receipts.js). Escape inside the
// confirm cancels just the confirm: its own listener stops the event before
// the global handler (which would close the whole ledger) sees it.
if (els.btnClearReceipts) {
  els.btnClearReceipts.addEventListener('click', () => { void openReceiptsClearConfirm(); });
}
document.getElementById('btn-clear-receipts-keep')?.addEventListener('click', () => resetReceiptsClearConfirm({ restoreFocus: true }));
document.getElementById('btn-clear-receipts-confirm')?.addEventListener('click', confirmClearReceipts);
document.getElementById('receipts-confirm')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  resetReceiptsClearConfirm({ restoreFocus: true });
});
  els.btnPlus.addEventListener('click', () => {
    els.timerInput.value = inputValue() + 1;
    setInputFromSeconds(inputSeconds());
    checkArmedModeMatch();
    checkProfileMatch(true);
    render();
  });

  els.btnMinus.addEventListener('click', () => {
    els.timerInput.value = Math.max(1, inputValue() - 1);
    setInputFromSeconds(inputSeconds());
    checkArmedModeMatch();
    checkProfileMatch(true);
    render();
  });

  els.timerInput.addEventListener('input', () => {
    if (!state.running && !state.paused) {
      state.remainingSeconds = inputSeconds();
      state.totalSeconds = state.remainingSeconds;
      checkArmedModeMatch();
      checkProfileMatch(true);
      render();
    }
  });

  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.running || state.paused) return;
      const seconds = inputSeconds();
      state.unit = btn.dataset.unit;
      setInputFromSeconds(seconds);
      // A unit change (min <-> sec) is a manual duration mutation just like
      // +/-/typing -- same clearing semantics apply.
      checkArmedModeMatch();
      checkProfileMatch(true);
      render();
    });
  });

  document.querySelectorAll('#action-chips-row [data-action]').forEach(btn => {
    btn.addEventListener('click', () => setAction(btn.dataset.action));
  });

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const minutes = Number(chip.dataset.min);
      state.unit = 'min';
      setInputFromSeconds(minutes * 60);
      clearArmedNightMode();
      clearCurrentProfile();
      startTimer(minutes * 60);
    });
  });

  // The Tonight hero CTA is the one primary Start control.
  document.getElementById('ns-play-btn')?.addEventListener('click', () => startTonightPlan());

  // Armed Night Mode clear button.
  document.getElementById('armed-mode-clear')?.addEventListener('click', clearArmedNightMode);

  // Streak callout (on Proof) jumps to Proof › Routine, the full breakdown,
  // and lands focus on its title.
  els.streakCallout?.addEventListener('click', async () => {
    const ok = await handleSidebarNavigation('stats');
    if (ok === false) return;
    const routine = document.getElementById('proof-routine');
    if (!routine) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    routine.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    document.getElementById('proof-routine-title')?.focus({ preventScroll: true });
  });

  document.getElementById('btn-celebration-dismiss')?.addEventListener('click', () => {
    document.getElementById('streak-celebration-modal')?.classList.remove('active');
  });

  els.trendGranularityToggle?.querySelectorAll('.trend-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const granularity = btn.dataset.granularity;
      if (!granularity || granularity === state.trendGranularity) return;
      state.trendGranularity = granularity;
      els.trendGranularityToggle.querySelectorAll('.trend-toggle-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
      refreshTrend();
    });
  });

  document.getElementById('btn-export-streaks')?.addEventListener('click', async () => {
    try {
      const summary = await api.getStreaks();
      const history = await api.getStreaksHistory();
      
      let ledger = `LIGHTS OUT BEDTIME LEDGER\n`;
      ledger += `=========================\n`;
      ledger += `Generated: ${new Date().toLocaleString()}\n`;
      ledger += `Current Streak: ${summary.streak} nights\n`;
      ledger += `Best Streak: ${summary.bestStreak} nights\n`;
      ledger += `Total Rituals: ${summary.totalNights}\n`;
      ledger += `Avg Bedtime (7d): ${summary.weekAvg}\n`;
      ledger += `On-Time Rate (7d): ${summary.weekOnTime}%\n\n`;
      
      ledger += `DAILY HISTORY (30 DAYS):\n`;
      ledger += `------------------------\n`;
      history.forEach(d => {
        const status = d.hasEvent ? (d.snoozed ? 'SNOOZED' : 'ON-TIME') : 'MISSED';
        ledger += `${d.date}: ${status}${d.bedTime ? ` @ ${d.bedTime}` : ''} [${d.action || 'N/A'}]\n`;
      });
      
      await navigator.clipboard.writeText(ledger);
      notify('Streak ledger copied to clipboard!', 'success', 3000);
    } catch (err) {
      notify('Failed to export ledger.', 'error');
    }
  });

  els.btnCopyWeeklyReport?.addEventListener('click', async () => {
    try {
      const text = els.weeklyReportText?.textContent || '';
      await navigator.clipboard.writeText(text);
      notify('Weekly report copied to clipboard!', 'success', 3000);
    } catch (err) {
      notify('Failed to copy weekly report.', 'error');
    }
  });

  // Back to Tonight and Cancel both discard the staged (unsaved) edits and
  // return to the previous dashboard panel; Save persists them. Controls
  // marked data-live (Test Mode, the other Power & Safety switches, clock
  // prefs, Override Tax, Autopilot, blocking schedules, ...) persist the moment
  // they change and are tagged "Applies now", so Cancel does not revert them.
  // data-action-scoped controls apply only through their own buttons.
  els.modalClose.addEventListener('click', async () => {
    await discardSettingsPanelChanges();
    closeSettingsPanel();
  });
  els.btnCancelOpt.addEventListener('click', async () => {
    await discardSettingsPanelChanges();
    closeSettingsPanel();
  });
  // No backdrop-click-to-close: Settings is an in-flow panel, not an overlay,
  // so clicking its own background is just clicking the page.

  if (els.aboutModalClose) {
    els.aboutModalClose.addEventListener('click', () => closeHelpPanel());
  }
  if (els.aboutModal) {
    els.aboutModal.addEventListener('click', event => {
      if (event.target === els.aboutModal) closeHelpPanel();
    });
  }

  els.btnSaveOpt.addEventListener('click', async () => {
    if (els.btnSaveOpt.disabled) return;
    els.btnSaveOpt.disabled = true;
    els.btnSaveOpt.textContent = 'Saving…';
    try {
      if (await saveSettingsPanel()) closeSettingsPanel();
    } finally {
      els.btnSaveOpt.disabled = false;
      els.btnSaveOpt.textContent = 'Save changes';
    }
  });

  els.selAction.addEventListener('change', () => setAction(els.selAction.value));

  // UI-R3 P13: one delegated listener tracks real unsaved edits. Edits inside
  // [data-live] (persisted at once) or [data-action-scoped] (applied by their
  // own buttons), or screen-only previews never make the panel dirty;
  // everything else waits for Save.
  const markSettingsDirty = () => {
    if (!els.panelSet || els.panelSet.style.display === 'none') return;
    els.panelSet.classList.add('is-dirty');
    if (els.setDirtyNote) els.setDirtyNote.textContent = 'Unsaved changes';
  };
  const isStagedSettingsEdit = target => Boolean(target?.closest)
    && !target.closest('[data-live], [data-action-scoped], [data-preview-only]');
  ['input', 'change'].forEach(type => {
    els.settingsCategories?.addEventListener(type, event => {
      if (isStagedSettingsEdit(event.target)) markSettingsDirty();
    });
  });
  // Staged edits made by clicking (accent swatches, Wi-Fi Guard devices,
  // Reset to defaults) are only persisted by Save, too.
  els.settingsCategories?.addEventListener('click', event => {
    const staged = event.target?.closest?.('#cz-swatches .swatch, .wifi-device, #btn-reset-customize');
    if (staged && isStagedSettingsEdit(staged)) markSettingsDirty();
  });

  // Persist these advanced options immediately when changed (data-live).
  // A failed write is said out loud: the row claims "Applies now".
  // Each live control writes ONLY its own key (main deep-merges `app`), so a
  // live toggle never flushes staged, unsaved form values (Action, the focus
  // blocklist, the wind-down *OnDim switches) past Save / Cancel.
  const persistAdvancedOptions = async patch => {
    try {
      await api.saveAppSettings({ app: patch });
    } catch (error) {
      notify(`That setting was not saved: ${error?.message || error}`, 'error');
    }
  };

  els.chkDryRun?.addEventListener('change', () => {
    state.dryRun = els.chkDryRun.checked;
    render();
    persistAdvancedOptions({ dryRun: state.dryRun });
  });

  els.chkForceShutdown?.addEventListener('change', () => {
    state.forceShutdown = els.chkForceShutdown.checked;
    render();
    persistAdvancedOptions({ forceShutdown: state.forceShutdown });
  });

  els.chkMute?.addEventListener('change', () => {
    state.muteSystem = els.chkMute.checked;
    render();
    persistAdvancedOptions({ muteSystem: state.muteSystem });
  });

  els.chkGraceful?.addEventListener('change', () => {
    state.gracefulClose = els.chkGraceful.checked;
    render();
    persistAdvancedOptions({ gracefulClose: state.gracefulClose });
  });

  els.graceMinutes?.addEventListener('change', () => {
    state.graceMinutes = clamp(Number(els.graceMinutes.value) || 0, 0, 10);
    // render() refreshes the Test Mode / REAL consequence (it names the warning).
    render();
    persistAdvancedOptions({ graceMinutes: state.graceMinutes });
  });


  els.scheduleCheck?.addEventListener('change', () => {
    if (els.scheduleCheck.checked) {
      if (els.scheduleTime && !els.scheduleTime.value) {
        els.scheduleTime.value = defaultScheduleDateTime(state.bedtime || '22:30');
      }
      selectClockTarget(els.scheduleTime.value);
    }
    // render() rewrites the hint and the Tonight note (cleared when unchecked).
    render();
  });

  els.scheduleTime?.addEventListener('change', () => {
    if (els.scheduleCheck.checked) selectClockTarget(els.scheduleTime.value);
    else render();
  });

  // Tonight's note Clear: drop the One night only target the same way the
  // Schedule checkbox does (its own change path), with no target toast.
  els.btnTonightTargetClear?.addEventListener('click', () => {
    if (!els.scheduleCheck) return;
    els.scheduleCheck.checked = false;
    els.scheduleCheck.dispatchEvent(new Event('change'));
    // The note (and this button) just hid: keep focus on the duration it frees.
    if (els.timerInput && !els.timerInput.disabled) els.timerInput.focus();
  });

  // Persist clock preferences immediately on change so they survive a relaunch
  // without requiring an explicit Save. Only the clock keys are written: the
  // staged Settings form (Action, focus blocklist, *OnDim) still waits for Save.
  const persistClockPrefs = async () => {
    const all = collectAppSettings();
    const app = {};
    for (const key of CLOCK_PREF_KEYS) app[key] = all[key];
    try {
      await api.saveAppSettings({ app });
    } catch (error) {
      notify(`That setting was not saved: ${error?.message || error}`, 'error');
    }
  };

  if (els.czClockFace) {
    els.czClockFace.addEventListener('change', () => {
      state.clockFace = els.czClockFace.value === 'analog' ? 'analog' : 'digital';
      updateClockStyleVisibility();
      render();
      persistClockPrefs();
    });
  }

  document.querySelectorAll('[data-clock-choice]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.clockChoice !== state.clockFace) cycleClockFace();
    });
  });

  if (els.czClockStyle) {
    els.czClockStyle.addEventListener('change', () => {
      state.clockStyle = els.czClockStyle.value || 'modern';
      applyClockStyle();
      render();
      persistClockPrefs();
    });
  }

  if (els.czClockDial) {
    els.czClockDial.addEventListener('change', () => {
      state.clockDial = els.czClockDial.value || 'bars';
      applyClockStyle();
      render();
      persistClockPrefs();
    });
  }

  if (els.czClockFormat) {
    els.czClockFormat.addEventListener('change', () => {
      state.clockFormat = els.czClockFormat.value || '24h';
      render();
      persistClockPrefs();
    });
  }

  // Show current time when idle (General): live like the clock prefs beside
  // it (data-live, "Applies now"), so the dirty note never claims it and
  // Cancel never pretends to revert it. Writes ONLY clockMode.
  if (els.chkClockMode) {
    els.chkClockMode.addEventListener('change', async () => {
      state.clockMode = els.chkClockMode.checked;
      // An explicit choice replaces a loaded profile's temporary dismissal.
      state._clockDismissedByProfile = false;
      render();
      try {
        await api.saveAppSettings({ app: { clockMode: state.clockMode } });
      } catch (error) {
        notify(`That setting was not saved: ${error?.message || error}`, 'error');
      }
    });
  }

  if (els.czClockScale) {
    els.czClockScale.addEventListener('input', () => {
      state.clockScale = clamp(Number(els.czClockScale.value) || 1, 0.8, 1.35);
      applyClockStyle();
      if (els.czClockScaleVal) els.czClockScaleVal.textContent = `${Math.round(state.clockScale * 100)}%`;
      render();
    });
    els.czClockScale.addEventListener('change', persistClockPrefs);
  }

  if (els.czClockHands) {
    els.czClockHands.addEventListener('input', () => {
      state.clockHandColor = els.czClockHands.value || '#9b93d6';
      applyClockStyle();
    });
    // Persist on commit (not on every drag frame).
    els.czClockHands.addEventListener('change', persistClockPrefs);
  }

  if (els.czClockSeconds) {
    els.czClockSeconds.addEventListener('change', () => {
      state.clockSeconds = els.czClockSeconds.checked;
      applyClockStyle();
      render();
      persistClockPrefs();
    });
  }

  if (els.czClockDate) {
    els.czClockDate.addEventListener('change', () => {
      state.clockShowDate = els.czClockDate.checked;
      render();
      persistClockPrefs();
    });
  }

  if (els.czClockSweep) {
    els.czClockSweep.addEventListener('change', () => {
      state.clockSweep = els.czClockSweep.checked;
      // Force a clean re-sync of the sweep animation on the next render.
      if (els.analogClock) els.analogClock.classList.remove('sweep');
      render();
      persistClockPrefs();
    });
  }

  document.addEventListener('keydown', async event => {
    if (event.defaultPrevented) return;

    if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') {
      if (event.key === 'Escape') event.target.blur();
      return;
    }

    if (event.key === ' ' || event.code === 'Space') {
      // A focused button keeps its native activation, and nothing starts or
      // pauses a run from behind onboarding or an open dialog.
      if (spaceOwnedByFocus(event.target) || timerShortcutSurfaceBlocked()) return;
      event.preventDefault();
      // A run is never left behind the fullscreen clock, which hides Pause
      // and Cancel: leave it first.
      if (state.fullscreenClock) exitFullscreenClock();
      if (state.running || state.paused) togglePause();
      else startTonightPlan();
      return;
    }

    if (event.key === 'Escape') {
      // Close the topmost active modal/drawer.
      if (state.fullscreenClock) {
        exitFullscreenClock();
      } else if (els.panelSet && els.panelSet.style.display !== 'none') {
        await discardSettingsPanelChanges();
        closeSettingsPanel();
      } else if (els.profilesModal?.classList.contains('active')) {
        els.profilesModal.classList.remove('active');
      } else if (els.receiptsModal?.classList.contains('active')) {
        els.receiptsModal.classList.remove('active');
        if (typeof resetReceiptsClearConfirm === 'function') resetReceiptsClearConfirm();
      } else if (els.aboutModal?.classList.contains('active')) {
        closeHelpPanel();
      } else if (document.getElementById('notif-drawer')?.classList.contains('active')) {
        document.getElementById('notif-drawer').classList.remove('active');
        document.getElementById('btn-notif')?.setAttribute('aria-expanded', 'false');
      } else if (document.getElementById('ritual-overlay')?.classList.contains('active')) {
        event.preventDefault();
        await api.ritualCancel?.();
        hideRitualOverlay();
      } else if (document.getElementById('warning-modal')?.classList.contains('active')) {
        document.getElementById('warning-modal').classList.remove('active');
      } else if (document.getElementById('override-modal')?.classList.contains('active')) {
        document.getElementById('override-modal').classList.remove('active');
      } else if (document.getElementById('snooze-tax-modal')?.classList.contains('active')) {
        document.getElementById('btn-snooze-tax-cancel')?.click();
      } else if (document.getElementById('lan-warning-modal')?.classList.contains('active')) {
        document.getElementById('btn-lan-warning-cancel')?.click();
      } else if (document.getElementById('streak-celebration-modal')?.classList.contains('active')) {
        document.getElementById('streak-celebration-modal').classList.remove('active');
      } else if (state.running || state.paused) {
        cancelTimer();
      }
      return;
    }

    // Plain digits only: Ctrl/Cmd/Alt + digit belongs to My Modes (load, never
    // start), and a digit typed into the session name or a text area is text.
    const presets = { '1': 5, '2': 10, '3': 15, '4': 30, '5': 60, '6': 120 };
    const typingTarget = event.target && (event.target.isContentEditable || event.target.tagName === 'TEXTAREA');
    if (presets[event.key] && !state.running && !state.paused && !timerShortcutSurfaceBlocked() && !event.ctrlKey && !event.metaKey && !event.altKey && !typingTarget) {
      state.unit = 'min';
      setInputFromSeconds(presets[event.key] * 60);
      clearArmedNightMode();
      clearCurrentProfile();
      startTimer(presets[event.key] * 60);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      switch (event.key.toLowerCase()) {
        case 'm':
          event.preventDefault();
          toggleMiniMode();
          break;
        case 'q':
          event.preventDefault();
          api.quitApp();
          break;
        case '0':
          event.preventDefault();
          api.closeWindow();
          break;
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      els.btnPlus.click();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      els.btnMinus.click();
    }
  });

  document.addEventListener('contextmenu', event => {
    if (previewMode) return; // browser fallback: leave the native menu alone
    event.preventDefault();

    const card = event.target.closest ? event.target.closest('.profile-card') : null;
    if (card && card.dataset.profileId) {
      const profileId = card.dataset.profileId;
      // Words only, no glyph prefixes. 'Load and start' goes through
      // applyProfile, so it inherits Test Mode like any load.
      showContextMenu(event.clientX, event.clientY, [
        { label: 'Load and start', action: () => applyProfile(profileId, { start: true }) },
        { label: 'Edit…', action: () => editProfileFromMenu(profileId) },
        // Never a one-click delete: opens the manager at the row, Delete armed.
        { label: 'Delete…', danger: true, action: () => deleteProfileFromMenu(profileId) }
      ]);
      return;
    }

    const clock = event.target.closest ? event.target.closest('.timer-display') : null;
    if (clock && state.clockMode && !state.running && !state.paused) {
      cycleClockFace();
    }
  });

  // Dismiss the custom context menu on outside interaction.
  document.addEventListener('mousedown', event => {
    if (contextMenuEl && !contextMenuEl.contains(event.target)) closeContextMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeContextMenu();
  });
  window.addEventListener('blur', closeContextMenu);
  window.addEventListener('scroll', closeContextMenu, true);

  // Smart Lights event handlers
  if (els.chkSmartLights) {
    els.chkSmartLights.addEventListener('change', () => {
      state.smartLights.enabled = els.chkSmartLights.checked;
      updateLightsUI();
    });
  }

  if (els.selLightProvider) {
    // The form owns the staged provider; state.smartLights stays the config
    // main last returned, so Save can tell whether the verified setup changed.
    els.selLightProvider.addEventListener('change', () => updateLightsUI());
  }

  // UI-R3 P13: the provider segments drive the (visually hidden) select, so
  // the save path and its 'change' listener stay exactly as they were.
  els.lightProviderSegments?.addEventListener('click', event => {
    const seg = event.target?.closest?.('[data-light-provider]');
    if (!seg || !els.selLightProvider) return;
    const value = seg.dataset.lightProvider;
    if (els.selLightProvider.value === value) return;
    els.selLightProvider.value = value;
    els.selLightProvider.dispatchEvent(new Event('change', { bubbles: true }));
  });

  els.hueLegacyHttp?.addEventListener('change', () => updateLightsUI());

  if (els.btnDiscoverHue) {
    els.btnDiscoverHue.addEventListener('click', async () => {
      try {
        const result = await api.discoverHueBridge();
        if (result?.ip) {
          // Staged in the form only (Save compares it with the saved setup).
          // A scripted .value write fires no event, so announce the staged
          // edit: the footer must say "Unsaved changes" until Save.
          els.hueBridgeIp.value = result.ip;
          els.hueBridgeIp.dispatchEvent(new Event('input', { bubbles: true }));
          notify(`Found Hue Bridge at ${result.ip}`, 'success');
        } else {
          notify('No Hue Bridge found on network', 'warning');
        }
      } catch (error) {
        notify(`Discovery failed: ${error.message}`, 'error');
      }
    });
  }

  if (els.btnRegisterHue) {
    els.btnRegisterHue.addEventListener('click', async () => {
      const bridgeIp = els.hueBridgeIp.value;
      if (!bridgeIp) {
        notify('Enter Bridge IP first', 'warning');
        return;
      }
      try {
        notify('Press link button on Hue Bridge now...', 'info', 3000);
        const result = await api.registerHueBridge(bridgeIp);
        if (result?.username) {
          // Only the form holds the new key until Save / Verify sends it:
          // state.smartLights.hueUsername means "the key main last received",
          // so a fresh registration counts as a changed setup on Save.
          els.hueUsername.value = result.username;
          // Staged, not saved: mark the panel dirty so Back / Cancel never
          // silently drops a freshly registered key.
          els.hueUsername.dispatchEvent(new Event('input', { bubbles: true }));
          notify('Registered successfully!', 'success');
        } else if (result?.error) {
          notify(`Registration failed: ${result.error}`, 'error');
        }
      } catch (error) {
        notify(`Registration failed: ${error.message}`, 'error');
      }
    });
  }

  const collectSmartLightForm = () => ({
    enabled: false,
    provider: els.selLightProvider.value,
    ...collectWizSettings(),
    mode: els.selLightMode.value,
    timerBeacon: document.getElementById('chk-wiz-timer-beacon')?.checked === true,
    dimMinutes: Number(els.lightDimMinutes.value) || 10,
    hueBridgeIp: els.hueBridgeIp.value,
    hueUsername: els.hueUsername.value,
    hueGroupId: els.hueGroupId.value,
    hueAllowLegacyHttp: Boolean(els.hueLegacyHttp?.checked),
    httpUrl: els.httpUrl.value,
    httpMethod: els.httpMethod.value,
    httpBodyTemplate: els.httpTemplate.value,
    verifiedConfigKey: ''
  });

  const applyTestResult = async (result) => {
    if (els.lightTestResult) {
      els.lightTestResult.textContent = result.message;
      els.lightTestResult.className = result.success ? 'success' : 'error';
    }
    notify(result.message, result.success ? 'success' : 'warning');
  };

  if (els.btnTestLights) {
    els.btnTestLights.addEventListener('click', async () => {
      // Passive verification only — never changes a real light.
      const testConfig = collectSmartLightForm();
      try {
        await api.saveSmartLightConfig(testConfig);
        const result = await api.testSmartLightConnection();
        if (result.success && result.verifiedConfigKey) {
          state.smartLights = {
            ...(await api.saveSmartLightConfig({
              ...testConfig,
              enabled: Boolean(els.chkSmartLights?.checked),
              verifiedConfigKey: result.verifiedConfigKey
            })),
            hueUsername: testConfig.hueUsername || ''
          };
        } else {
          state.smartLights = { ...(await api.saveSmartLightConfig(testConfig)), hueUsername: testConfig.hueUsername || '' };
          if (result.success === false && els.chkSmartLights) els.chkSmartLights.checked = false;
        }
        renderLightsStatePill(state.smartLights);
        await applyTestResult(result);
      } catch (error) {
        notify(`Verification failed: ${error.message}`, 'error');
      }
    });
  }

  if (els.btnTestAction) {
    els.btnTestAction.addEventListener('click', async () => {
      // Explicit actuation: the button is labeled so the user knows a real
      // command fires. Only a truthful success earns verifiedConfigKey.
      const testConfig = collectSmartLightForm();
      try {
        await api.saveSmartLightConfig(testConfig);
        const result = await api.testSmartLightAction();
        if (result.success && result.verifiedConfigKey) {
          state.smartLights = {
            ...(await api.saveSmartLightConfig({
              ...testConfig,
              enabled: Boolean(els.chkSmartLights?.checked),
              verifiedConfigKey: result.verifiedConfigKey
            })),
            hueUsername: testConfig.hueUsername || ''
          };
        } else {
          state.smartLights = { ...(await api.saveSmartLightConfig(testConfig)), hueUsername: testConfig.hueUsername || '' };
          if (els.chkSmartLights) els.chkSmartLights.checked = false;
        }
        renderLightsStatePill(state.smartLights);
        await applyTestResult(result);
      } catch (error) {
        notify(`Test action failed: ${error.message}`, 'error');
      }
    });
  }

  // Profiles event handlers
  if (els.btnManageProfiles) {
    els.btnManageProfiles.addEventListener('click', () => {
      openProfilesModal();
    });
  }

  if (els.btnSaveCurrentProfile) {
    els.btnSaveCurrentProfile.addEventListener('click', () => {
      openProfilesModal();
      setTimeout(() => els.newProfileName?.focus(), 50);
    });
  }

  if (els.profilesModalClose) {
    els.profilesModalClose.addEventListener('click', closeProfilesModal);
  }

  if (els.btnCloseProfiles) {
    els.btnCloseProfiles.addEventListener('click', closeProfilesModal);
  }

  if (els.profilesModal) {
    els.profilesModal.addEventListener('click', event => {
      if (event.target === els.profilesModal) closeProfilesModal();
    });
  }

  // Profile search listener
  const searchInput = document.getElementById('profile-search');
  searchInput?.addEventListener('input', () => {
    state.profileSearchQuery = searchInput.value;
    renderProfilesList();
  });

  // Profile filter button listeners
  const filterContainer = document.getElementById('profile-filters');
  filterContainer?.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Class + aria-pressed only: the chip look lives in CSS (UI-R3 Fire 01).
      filterContainer.querySelectorAll('.filter-btn').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      state.profileActiveFilter = btn.dataset.filter;
      renderProfilesList();
    });
  });

  if (els.btnSaveProfile) {
    els.btnSaveProfile.addEventListener('click', saveNewProfile);
  }

  if (els.btnExportProfiles) {
    els.btnExportProfiles.addEventListener('click', exportProfiles);
  }

  if (els.btnImportProfiles) {
    els.btnImportProfiles.addEventListener('click', () => {
      if (els.importFileInput) els.importFileInput.click();
    });
  }

  if (els.importFileInput) {
    els.importFileInput.addEventListener('change', importProfiles);
  }

  // All-data export/import
  els.btnExportAllData?.addEventListener('click', async () => {
    const result = await api.exportAllData();
    if (result.success && result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lights-out-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify('Data exported successfully', 'success');
    } else {
      notify('Export failed: ' + (result.error || 'Unknown error'), 'error');
    }
  });
  els.btnImportAllData?.addEventListener('click', () => {
    els.importAllDataInput?.click();
  });
  els.importAllDataInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await api.importAllData(text);
      if (result.success) {
        notify('Data imported successfully. Restart to see all changes.', 'success');
      } else {
        notify('Import failed: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      notify('Import error: ' + err.message, 'error');
    }
    e.target.value = '';
  });

  // My Modes shortcuts: Ctrl+1..9 loads the card in that position (pinned
  // first, as shown). Load only, never start (renderer-profiles.js).
  document.addEventListener('keydown', onMyModesShortcut);

  // Calendar event handlers
  // Import tab switching
  els.importTabBtns?.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.importTab;
      els.importTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      els.importPanels.forEach(p => p.classList.remove('active'));
      document.getElementById(`import-${tab}-panel`)?.classList.add('active');
    });
  });

  // File import
  if (els.btnImportFile) {
    els.btnImportFile.addEventListener('click', () => {
      els.calendarFileInput?.click();
    });
  }

  if (els.calendarFileInput) {
    els.calendarFileInput.addEventListener('change', importCalendarFile);
  }

  // URL import
  if (els.btnImportUrl) {
    els.btnImportUrl.addEventListener('click', importCalendarUrl);
  }

  // loadSleepDebt/loadMorningProof are declared in this function's scope, so
  // they must be invoked here (wireEvents runs before loadInitialData). Calling
  // them from the global loadInitialData throws a ReferenceError, which the
  // bedtime-loader catch previously swallowed, silently aborting settings
  // rehydration (e.g. clock preferences). Run them here, isolated.
  try { loadSleepDebt(); } catch (e) { console.error('loadSleepDebt failed:', e); }
  try { loadMorningProof(); } catch (e) { console.error('loadMorningProof failed:', e); }

  // UI-R3 P11: the morning note link opens Proof and lands on the hero.
  document.getElementById('morning-note-link')?.addEventListener('click', async () => {
    const ok = await handleSidebarNavigation('stats');
    if (ok === false) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    els.morningProofSection?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  });
}

function updateLightsUI() {
  // UI-R3 P13: the staged provider lives in the (hidden) select, not in
  // state.smartLights, which stays the config main last returned.
  const provider = els.selLightProvider?.value || state.smartLights.provider || 'none';
  els.selLightMode?.querySelectorAll('option').forEach(option=>{if(['hourglass','orbit','ember'].includes(option.value))option.disabled=provider!=='wiz';});
  if(provider!=='wiz'&&['hourglass','orbit','ember'].includes(els.selLightMode?.value))els.selLightMode.value='gradual_dim';
  if (els.lightsConfig) {
    els.lightsConfig.style.display = 'block';
  }
  if (els.wizConfig) els.wizConfig.style.display = provider === 'wiz' ? 'block' : 'none';
  const wizTargets = document.getElementById('wiz-targets');
  if (wizTargets) wizTargets.hidden = provider !== 'wiz';
  if (els.hueConfig) {
    els.hueConfig.style.display = provider === 'hue' ? 'block' : 'none';
  }
  if (els.httpConfig) {
    els.httpConfig.style.display = provider === 'http' ? 'block' : 'none';
  }
  // Segments mirror the select (two-way), the legacy-HTTP warning shows only
  // for Hue with the box checked, and Verify says what it can do.
  els.lightProviderSegments?.querySelectorAll('[data-light-provider]').forEach(seg => {
    seg.setAttribute('aria-pressed', seg.dataset.lightProvider === provider ? 'true' : 'false');
  });
  if (els.hueLegacyWarning) els.hueLegacyWarning.hidden = !(provider === 'hue' && els.hueLegacyHttp?.checked);
  if (els.lightsVerifyNote) {
    els.lightsVerifyNote.textContent = provider === 'http'
      ? 'A webhook cannot be checked without firing it, so it is verified only by Send test action below.'
      : provider === 'hue'
        ? 'Checks the bridge without changing any light. Checking also saves this light setup.'
        : provider === 'wiz' ? 'Reads each WiZ light’s status without changing it. Checking also saves this setup.'
        : 'Choose WiZ, Philips Hue or HTTP webhook first.';
  }
}

// UI-R3 P13: the Smart lights state pill, computed only from a SAVED config
// object (what main returned from load / save / verify / test). It never reads
// the live checkbox and never reads credential fields.
//
// main keeps whatever verifiedConfigKey it is sent and only forces enabled
// off when the key no longer matches the setup, so a key alone is not proof:
// - enabled === true  -> main already matched the key to this exact setup.
// - enabled === false -> the key must still agree with the saved public setup
//   fields (provider, bridge IP, group / method, URL, body template), the same
//   fields main's configurationKey() is built from; a stale key is not
//   "Verified".
function smartLightsPillState(config) {
  const provider = config?.provider || 'none';
  const enabled = Boolean(config?.enabled);
  const key = typeof config?.verifiedConfigKey === 'string' ? config.verifiedConfigKey : '';
  let keyMatchesSetup = false;
  if (key && provider === 'hue') {
    keyMatchesSetup = key.startsWith(`hue:${config.hueBridgeIp || ''}:`) && key.endsWith(`:${config.hueGroupId || ''}`);
  } else if (key && provider === 'wiz') {
    keyMatchesSetup = key === `wiz:${[...new Set(config.wizAddresses || [])].sort().join(',')}`;
  } else if (key && provider === 'http') {
    keyMatchesSetup = key.startsWith(`http:${config.httpMethod || 'POST'}:${config.httpUrl || ''}:`)
      && key.endsWith(`:${config.httpBodyTemplate || ''}`);
  }
  const verified = enabled ? Boolean(key) : keyMatchesSetup;
  if (provider !== 'none' && !enabled && key && !keyMatchesSetup) return { text: 'Not verified · off', tone: 'muted' };
  if (provider === 'none' || (!enabled && !verified)) return { text: 'Not configured', tone: 'muted' };
  if (verified && !enabled) return { text: 'Verified · off', tone: 'muted' };
  if (enabled && !verified) return { text: 'Not verified', tone: 'warn' };
  if (provider === 'hue' && config.hueAllowLegacyHttp) return { text: 'Ready · legacy HTTP allowed', tone: 'warn' };
  return { text: 'Ready', tone: 'ready' };
}

function renderLightsStatePill(config) {
  const pill = els.lightsStatePill;
  if (!pill) return;
  const { text, tone } = smartLightsPillState(config);
  pill.textContent = text;
  pill.dataset.loaded = '1';
  pill.classList.remove('is-muted', 'is-warn', 'is-ready');
  pill.classList.add(`is-${tone}`);
}

// Battery and power plan exactly as the PC reports them. Main returns 'N/A'
// when the query fails or its cache is cold, so nothing (AC power or
// otherwise) is inferred from it.
function applySystemInfo(systemInfo) {
  const battery = systemInfo?.battery;
  const batteryUnknown = battery === undefined || battery === null || battery === '' || battery === 'N/A';
  if (els.batteryLevel) {
    els.batteryLevel.textContent = batteryUnknown ? 'Not reported' : `${battery}%`;
  }
  // Fire 07: an unreported battery (a desktop) is not a fact worth a row; a
  // real reading (0% included) brings the row back.
  if (els.devicePcBatteryRow) els.devicePcBatteryRow.hidden = batteryUnknown;
  const plan = systemInfo?.powerPlan || 'Unknown';
  if (els.powerPlan) els.powerPlan.textContent = plan;
  // An unknown plan is not a fact worth a row: hide the row, keep #power-plan.
  if (els.devicePcPlanRow) els.devicePcPlanRow.hidden = plan === 'Unknown';
}

async function loadInitialData() {
  try {
    // Settings only: the PowerShell system-info queries are fetched on their
    // own below, so they never delay Test Mode truth or Start.
    // wifiGuard/contentBlocker/accountability come from their own getters.
    const [appSettings, lightConfig, wifiConfig, cbConfig, accConfig] = await Promise.all([
      api.getAppSettings(),
      api.getSmartLightConfig(),
      api.getWifiGuardSettings?.(),
      api.getContentBlockerSettings?.(),
      api.getAccountabilitySettings?.()
    ]);

    // --- Critical: rehydrate persisted settings FIRST. A failure in any
    // non-critical loader below must never prevent saved preferences (clock
    // face/style/sweep/seconds, customization, Last Light) from being applied. ---
    if (typeof appSettings.runAtLogin === 'boolean') {
      state.runAtLogin = appSettings.runAtLogin;
    }
    if (appSettings.app) await applyAppSettings(appSettings.app);
    state.settingsLoaded = true;
    render();
    // System info (non-critical display), without blocking anything.
    void (async () => {
      try {
        applySystemInfo(await api.getSystemInfo());
      } catch (e) {
        console.error('getSystemInfo failed:', e);
        applySystemInfo(previewMode ? { battery: 'N/A', powerPlan: 'Preview' } : null);
      }
    })();
    if (appSettings.customization) {
      state.customization = { ...state.customization, ...appSettings.customization };
    }
    applyCustomization(state.customization);
    if (appSettings.lastLight) {
      state.lastLight = { ...state.lastLight, ...appSettings.lastLight };
    }
    updateLastLightUIFromState();

    // Non-critical loaders: isolate each so one failure cannot abort the rest.
    // (Sleep debt and morning proof load from wireEvents, where they are scoped.)
    try {
      await loadProfiles();
      await restoreSelectedProfile(appSettings.app?.lastSelectedProfileId);
    } catch (e) { console.error('loadProfiles failed:', e); }
    try { loadStreaks(); } catch (e) { console.error('loadStreaks failed:', e); }
    try { if (typeof initNightModes === 'function') await initNightModes(); } catch (e) { console.error('initNightModes failed:', e); }

    // Offer recovery of an interrupted timer
    if (appSettings.recoverableTimer) {
      promptTimerRecovery(appSettings.recoverableTimer);
    }

    // Load Smart Lights config
    if (lightConfig) {
      state.smartLights = {
        enabled: lightConfig.enabled || false,
        provider: lightConfig.provider || 'none',
        wizAddresses: lightConfig.wizAddresses || [],
        wizDevices: lightConfig.wizDevices || [],
        wizLook: lightConfig.wizLook || {},
        mode: lightConfig.mode || 'gradual_dim',
        dimMinutes: lightConfig.dimMinutes || 10,
        hueBridgeIp: lightConfig.hueBridgeIp || '',
        hueUsername: '',
        hasHueCredential: Boolean(lightConfig.hasHueCredential),
        hueGroupId: lightConfig.hueGroupId || '',
        hueAllowLegacyHttp: Boolean(lightConfig.hueAllowLegacyHttp),
        httpUrl: lightConfig.httpUrl || '',
        httpMethod: lightConfig.httpMethod || 'POST',
        httpBodyTemplate: lightConfig.httpBodyTemplate || '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}',
        verifiedConfigKey: lightConfig.verifiedConfigKey || ''
      };
      updateLightsUIFromState();
      renderLightsStatePill(lightConfig);
    } else if (els.lightsStatePill && !els.lightsStatePill.dataset.loaded) {
      els.lightsStatePill.textContent = 'Status unavailable';
    }

    // Load WiFi Guard / Content Blocker / Accountability config. These live
    // in their own settings sections (not nested under appSettings, which
    // only carries app/customization/lastLight/calendar) -- fetched above
    // via their own dedicated getters, same pattern as smartLights/lightConfig.
    // PRE-EXISTING BUG fixed here: this used to check `appSettings.wifiGuard`
    // etc., which was always undefined, so these three sections' saved state
    // (including the enable checkboxes) never rehydrated into the UI on
    // launch -- reopening Settings always showed them unchecked/default even
    // when actually enabled, and re-saving the Options modal from that state
    // would have silently disabled them.
    if (wifiConfig) applyWifiGuardSettings(wifiConfig);
    if (cbConfig) applyContentBlockerSettings(cbConfig);
    if (accConfig) applyAccountabilitySettings(accConfig);
    // Fire 02: the wind-down facts Test Mode does not hold back (non-secret only).
    setWindDownFacts(pickWindDownFacts({ app: appSettings.app, contentBlocker: cbConfig, wifiGuard: wifiConfig, lights: lightConfig }));
  } catch (e) {
    console.error('loadInitialData failed:', e);
    // The Smart lights pill makes no claim it has no data for: if the saved
    // config never arrived, it says so instead of "Checking…" forever.
    if (els.lightsStatePill && !els.lightsStatePill.dataset.loaded) {
      els.lightsStatePill.textContent = 'Status unavailable';
      els.lightsStatePill.classList.remove('is-warn', 'is-ready');
      els.lightsStatePill.classList.add('is-muted');
    }
    // Settings could not be read: stop saying "Checking mode…" and fall back
    // to the conservative REAL wording (state.dryRun stays as it is).
    if (!state.settingsLoaded) {
      state.settingsLoaded = true;
      render();
      applySystemInfo(previewMode ? { battery: 'N/A', powerPlan: 'Preview' } : null);
    }
    return { ok: false, error: e };
  }
  return { ok: true };
}

// Northstar sidebar tab: toggle active class + persist.
document.querySelectorAll('.ns-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    handleSidebarNavigation(btn.dataset.nsTab);
  });
});

// Timer name: sync state and persist on every edit.
els.timerName?.addEventListener('input', () => {
  state.timerName = els.timerName.textContent.trim();
  try { api.saveAppSettings({ app: { timerName: state.timerName } }); } catch (_) {}
  // Tonight's plan title follows the typed name as you type.
  renderTonightHero();
  // UI-R3 Fire 04: is-default follows the name (skipped while focused; the
  // blur below settles it once the edit ends).
  syncTimerNameDefault();
});
els.timerName?.addEventListener('blur', () => syncTimerNameDefault());

function updateLightsUIFromState() {
  if (els.chkSmartLights) els.chkSmartLights.checked = state.smartLights.enabled;
  if (els.selLightProvider) els.selLightProvider.value = state.smartLights.provider;
  if (els.wizAddresses) els.wizAddresses.value = (state.smartLights.wizAddresses || []).join(', ');
  applyWizSettings(state.smartLights);
  if (els.selLightMode) els.selLightMode.value = state.smartLights.mode;
  const beacon=document.getElementById('chk-wiz-timer-beacon');if(beacon)beacon.checked=state.smartLights.timerBeacon===true;
  if (els.lightDimMinutes) els.lightDimMinutes.value = state.smartLights.dimMinutes;
  if (els.hueBridgeIp) els.hueBridgeIp.value = state.smartLights.hueBridgeIp;
  if (els.hueUsername) {
    // The credential itself never round-trips through the renderer. A saved
    // credential is shown as a placeholder; typing a new value replaces it.
    els.hueUsername.value = '';
    els.hueUsername.placeholder = state.smartLights.hasHueCredential
      ? 'Saved — leave blank to keep, or enter a new key'
      : 'Press link button, then Register';
  }
  if (els.hueGroupId) els.hueGroupId.value = state.smartLights.hueGroupId;
  if (els.hueLegacyHttp) els.hueLegacyHttp.checked = Boolean(state.smartLights.hueAllowLegacyHttp);
  if (els.httpUrl) els.httpUrl.value = state.smartLights.httpUrl;
  if (els.httpMethod) els.httpMethod.value = state.smartLights.httpMethod;
  if (els.httpTemplate) els.httpTemplate.value = state.smartLights.httpBodyTemplate;
  updateLightsUI();
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Functions
// ─────────────────────────────────────────────────────────────────────────────

function cycleClockFace() {
  const order = ['digital', 'analog'];
  const idx = order.indexOf(state.clockFace);
  const next = order[(idx + 1) % order.length];
  state.clockFace = next;
  if (els.czClockFace) els.czClockFace.value = next;
  updateClockStyleVisibility();
  render();
  // Only the clock face: never flush a staged Settings form from a shortcut.
  try { api.saveAppSettings({ app: { clockFace: next } }); } catch (_) { /* no-op */ }
}

api.onTimerUpdate(applyTimerPayload);
api.onMiniModeChanged(isMini => {
  state.miniMode = Boolean(isMini);
  render();
});
api.onPlaySound(soundType => {
  if (SoundSystem[soundType]) SoundSystem[soundType]();
});
api.onPlayLastLight(payload => {
  playLastLight(payload);
});
api.onOpenSettings(() => {
  // Routed through the central navigation entry point -- see
  // handleSidebarNavigation() and the els.btnCompanion handler above for
  // the same reasoning. No DOM "opener" element is needed for this path:
  // handleSidebarNavigation('set') determines settingsReturnTab from
  // whichever tab is *currently* active, not from whatever triggered the
  // call, so a tray-menu/global-shortcut invocation works identically to
  // a real click.
  handleSidebarNavigation('set');
});
api.onBrowserWarning?.(data => {
  if (data?.message) notify(data.message, 'warning', 8000);
});
api.onRemoteAction?.(data => {
  if (data?.message) notify(data.message, 'info');
});

api.onUpdateAvailable?.(data => {
  if (data?.available && els.badgeUpdate) {
    els.badgeUpdate.style.display = '';
    els.badgeUpdate.textContent = `v${data.latestVersion}`;
    els.badgeUpdate.style.cursor = 'pointer';
    els.badgeUpdate.addEventListener('click', openHelpPanel, { once: true });
  }
  // Reflect the same result in the About modal's updater status.
  if (data) renderUpdaterStatus(data);
});

els.btnCheckUpdate?.addEventListener('click', runUpdateCheck);
// Settings › General: the same update check as About, and a way to the key
// map About already shows.
els.setBtnCheckUpdate?.addEventListener('click', runUpdateCheck);
els.setBtnShortcuts?.addEventListener('click', () => {
  openHelpPanel(els.setBtnShortcuts);
  els.aboutModal?.querySelector('.about-keys')?.scrollIntoView({ block: 'nearest' });
});

// Media auto-paused notification.
api.onMediaPaused?.(data => {
  if (data?.players?.length) {
    notify(`Media paused: ${data.players.join(', ')}`, 'info');
  }
});

// Unsaved work warning notification.
api.onUnsavedWorkWarning?.(data => {
  if (data?.warnings?.length) {
    const apps = data.warnings.map(w => w.process).join(', ');
    notify(`Unsaved work in ${apps}. Save now! Shutdown delayed 10s.`, 'warning');
  }
});

wireEvents();
setupCustomizeHandlers();
setupLastLightHandlers();
setupWarningHandlers();
setupAlarmHandlers();
setupCalendarHandlers();
setupRemoteControlHandlers();
setupCbScheduleHandlers();
setAction(state.action);
applyAppVersion();
refreshStreakCallout();

checkOnboarding();

void (async function initializeRenderer() {
  setDesktopUxProofPhase('restoring-state');
  const result = await loadInitialData();
  render();
  // UI-R3 P11: a REAL Shutdown comes back as a fresh launch, so the morning
  // note and the Routine strip are read here, after state is restored.
  if (typeof refreshMorningNote === 'function') void refreshMorningNote();
  if (typeof renderNightStrip === 'function') void renderNightStrip();
  if (!result.ok) {
    setDesktopUxProofPhase('initialization-failed', result.error);
    return;
  }
  // Yield once so style/layout and the initial Tonight projection reflect the
  // restored state before proof automation is allowed to interact.
  await new Promise(resolve => requestAnimationFrame(() => resolve()));
  markDesktopUxProofReady();
})().catch(error => {
  console.error('Renderer initialization failed:', error);
  setDesktopUxProofPhase('initialization-failed', error);
});

// UI-R3 P07: the lamp strikes on once per app run, on first focus. Not
// visibilitychange: backgroundThrottling is off, so a hidden window would
// play it unseen.
(function setupLampIgnition() {
  if (typeof document.hasFocus === 'function' && document.hasFocus()) igniteLamp();
  else window.addEventListener('focus', igniteLamp, { once: true });
})();

// UI-R3 P11: coming back to the window (for example after the PC wakes from a
// REAL Sleep or Hibernate) re-reads the receipts through the existing
// receipt bridge, at most once a minute. No power-event listener and no new
// IPC channel: owner decision.
(function setupProofRefreshOnReturn() {
  let lastRefreshAt = 0;
  window.addEventListener('focus', () => {
    const now = Date.now();
    if (now - lastRefreshAt < 60000) return;
    lastRefreshAt = now;
    if (state.running || state.paused) return;
    refreshProofSurfaces();
  });
  // Timers resume after the PC wakes, so the one-line morning note (a single
  // receipt read) is also re-checked every two minutes while idle.
  setInterval(() => {
    if (!state.running && !state.paused) void refreshMorningNote();
  }, 120000);
})();

// UI-R3 P07: an idle setup interaction (duration input, +/-, unit, quick
// chips, ending chips, Begin Ritual, a profile card) ends the completion hold
// early. Capture phase, so the hold is gone before the control's own handler.
(function setupOutcomeHoldRelease() {
  const onSetupInteraction = (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('#setup-controls, #profiles-section')) releaseOutcomeHold();
  };
  document.addEventListener('input', onSetupInteraction, true);
  document.addEventListener('click', onSetupInteraction, true);
})();

// ───────────── Initial window height fit ─────────────
// Pick a useful starting height once. Subsequent sizing belongs to the user;
// reacting to every DOM mutation made a manually resized window snap back.
(function setupAutoFitWindow() {
  if (!window.electronAPI || typeof window.electronAPI.fitWindowHeight !== 'function') return;

  const measure = () => {
    const header = document.querySelector('.chrome-header');
    const dashboard = document.querySelector('.dashboard');
    const footer = document.querySelector('.app-footer');
    if (!dashboard) return 0;
    const ds = getComputedStyle(dashboard);
    const gap = parseFloat(ds.rowGap || ds.gap || '0') || 0;
    let inner = (parseFloat(ds.paddingTop) || 0) + (parseFloat(ds.paddingBottom) || 0);
    let visible = 0;
    for (const child of dashboard.children) {
      if (getComputedStyle(child).display === 'none') continue;
      inner += child.offsetHeight;
      visible++;
    }
    if (visible > 1) inner += gap * (visible - 1);
    return Math.ceil((header ? header.offsetHeight : 0) + inner + (footer ? footer.offsetHeight : 0));
  };

  const fit = () => {
    if (document.body.classList.contains('mini-mode')) return;
    requestAnimationFrame(() => {
      const h = measure();
      if (h > 0) window.electronAPI.fitWindowHeight(h);
    });
  };
  setTimeout(fit, 150);
})();

// Clock Mode: tick the displayed time every second while idle. With clock
// mode off, only the plan's "Ends at" fact is refreshed (textContent, and only
// when its minute-granular text actually changes).
(function setupClockTick() {
  setInterval(() => {
    if (state.running || state.paused) return;
    if (state.clockMode) render();
    else updatePlanFacts();
  }, 1000);
})();
