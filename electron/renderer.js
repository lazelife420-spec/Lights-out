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
    closeWindow: () => {},
    quitApp: () => {},
    toggleMiniMode: () => {},
    toggleWidget: () => {},
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
    getStreaks: async () => ({ streak: 0, bestStreak: 0, totalNights: 0, achievements: [], weekAvg: '--:--', weekOnTime: 0, weekDays: [] }),
    getAchievementsCatalog: async () => [],
    getWeeklyReport: async () => null,
    getSleepScore: async () => ({ score: null, label: 'Preview', breakdown: {} }),
    getStreaksHistory: async () => [],
    getCompanionStatus: async () => ({ running: false, port: 0, clients: 0, url: '' }),
    getRemoteControl: async () => ({ enabled: false, mode: 'off', token: '', port: 0, lanIp: '', url: '', pcName: 'Preview PC', clients: 0, connected: false, failed: false, statusLabel: 'Off' }),
    setRemoteControlMode: async () => ({ enabled: false, mode: 'off', token: '', url: '', statusLabel: 'Off' }),
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
      enabled: false, blockOnDim: true, unblockOnComplete: true, blocklist: [], useDefault: true
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
    clearReceipts: async () => ({ cleared: true }),
    getReceiptStats: async () => ({ total: 0, completed: 0, cancelled: 0, dryRun: 0, blocked: 0 }),
    getIdleSeconds: async () => 0,
    setIdleThreshold: async () => ({ threshold: 300 }),
    onIdleDetected: (cb) => {},
    onUserReturned: (cb) => {},
    setBedtimeReminder: async () => ({ minutesBefore: 15 }),
    onBedtimeReminder: (cb) => {},
    onMorningBriefing: (cb) => {},
    setCalendarAutoStart: async () => ({ autoStartFromEvents: false }),
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

const els = {
  body: document.body,
  timerDisplay: document.querySelector('.timer-display'),
  timerMain: document.getElementById('timer-main'),
  timerLabel: document.getElementById('timer-label'),
  timerSub: document.getElementById('timer-sub'),
  timerName: document.getElementById('timer-name'),
  ringProgress: document.querySelector('.ring-progress'),
  timerInput: document.getElementById('timer-input'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnPause: document.getElementById('btn-pause'),
  btnSnooze: document.getElementById('btn-snooze'),
  btnMinimize: document.getElementById('btn-minimize'),
  btnClose: document.getElementById('btn-close'),
  btnMini: document.getElementById('btn-mini'),
  btnPlus: document.getElementById('btn-plus'),
  btnMinus: document.getElementById('btn-minus'),
  optionsModal: document.getElementById('options-modal'),
  modalClose: document.getElementById('modal-close'),
  btnCancelOpt: document.getElementById('btn-cancel-opt'),
  btnSaveOpt: document.getElementById('btn-save-opt'),
  selAction: document.getElementById('sel-action'),
  graceMinutes: document.getElementById('grace-minutes'),
  chkForceShutdown: document.getElementById('chk-forceshutdown'),
  chkMute: document.getElementById('chk-mute'),
  chkRunLogin: document.getElementById('chk-run-login'),
  focusBlocklist: document.getElementById('focus-blocklist'),
  chkDryRun: document.getElementById('chk-dryrun'),
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
  httpConfig: document.getElementById('http-config'),
  hueBridgeIp: document.getElementById('hue-bridge-ip'),
  hueUsername: document.getElementById('hue-username'),
  hueGroupId: document.getElementById('hue-group-id'),
  btnDiscoverHue: document.getElementById('btn-discover-hue'),
  btnRegisterHue: document.getElementById('btn-register-hue'),
  btnLoadGroups: document.getElementById('btn-load-groups'),
  httpUrl: document.getElementById('http-url'),
  httpMethod: document.getElementById('http-method'),
  httpTemplate: document.getElementById('http-template'),
  btnTestLights: document.getElementById('btn-test-lights'),
  lightTestResult: document.getElementById('light-test-result'),
  // Profiles elements
  profilesGrid: document.getElementById('profiles-grid'),
  btnManageProfiles: document.getElementById('btn-manage-profiles'),
  btnSaveCurrentProfile: document.getElementById('btn-save-current-profile'),
  profileSavePreview: document.getElementById('profile-save-preview'),
  profilesModal: document.getElementById('profiles-modal'),
  profilesModalClose: document.getElementById('profiles-modal-close'),
  btnCloseProfiles: document.getElementById('btn-close-profiles'),
  newProfileName: document.getElementById('new-profile-name'),
  newProfileAutostart: document.getElementById('new-profile-autostart'),
  btnSaveProfile: document.getElementById('btn-save-profile'),
  scheduleHint: document.getElementById('schedule-hint'),
  // Clock face elements
  czClockFace: document.getElementById('cz-clockface'),
  analogClock: document.getElementById('analog-clock'),
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
  // Streaks
  streakCount: document.getElementById('streak-count'),
  streakBest: document.getElementById('streak-best'),
  streakTotal: document.getElementById('streak-total'),
  streakWeekAvg: document.getElementById('streak-weekavg'),
  streakOnTime: document.getElementById('streak-ontime'),
  sleepHistoryGrid: document.getElementById('sleep-history-grid'),
  streakCallout: document.getElementById('streak-callout'),
  streakCalloutCount: document.getElementById('streak-callout-count'),
  streakCalloutBest: document.getElementById('streak-callout-best'),
  achievementsGrid: document.getElementById('achievements-grid'),
  // Sleep score
  scoreValue: document.getElementById('score-value'),
  scoreLabel: document.getElementById('score-label'),
  scoreBreakdown: document.getElementById('score-breakdown'),
  scoreRingFill: document.getElementById('score-ring-fill'),
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
  remoteUrl: document.getElementById('remote-url'),
  remoteToken: document.getElementById('remote-token'),
  remoteQr: document.getElementById('remote-qr'),
  remoteQrWrap: document.getElementById('remote-qr-wrap'),
  btnRegenToken: document.getElementById('btn-regen-token'),
  btnTurnOffCompanion: document.getElementById('btn-turn-off-companion'),
  btnCopyUrl: document.getElementById('btn-copy-url'),
  companionStatusPill: document.getElementById('companion-status-pill'),
  companionConnectedBadge: document.getElementById('companion-connected-badge'),
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

  // Guided Breathing
  breathingOverlay: document.getElementById('breathing-overlay'),
  breathingCircle: document.getElementById('breathing-circle'),
  breathingLabel: document.getElementById('breathing-label'),
  breathingCount: document.getElementById('breathing-count'),
  breathingInstruction: document.getElementById('breathing-instruction'),
  breathingCycles: document.getElementById('breathing-cycles'),
  btnBreathingStop: document.getElementById('btn-breathing-stop'),

  // Focus Sessions
  focusActive: document.getElementById('focus-active'),
  focusRing: document.getElementById('focus-ring'),
  focusRemaining: document.getElementById('focus-remaining'),
  focusPhaseLabel: document.getElementById('focus-phase-label'),
  focusCycleDots: document.getElementById('focus-cycle-dots'),
  btnFocusPause: document.getElementById('btn-focus-pause'),
  btnFocusStop: document.getElementById('btn-focus-stop'),

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
  btnProofClose: document.getElementById('btn-proof-close'),
  btnProofDismiss: document.getElementById('btn-proof-dismiss'),
  receiptsModal: document.getElementById('receipts-modal'),
  receiptsModalClose: document.getElementById('receipts-modal-close'),
  receiptStats: document.getElementById('receipt-stats'),
  receiptsList: document.getElementById('receipts-list'),
  btnClearReceipts: document.getElementById('btn-clear-receipts'),
  // Northstar sidebar destinations (LIB/SCH/STATS)
  panelLib: document.getElementById('ns-panel-lib'),
  panelSch: document.getElementById('ns-panel-sch'),
  panelStats: document.getElementById('ns-panel-stats'),
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
  calCfgBuiltin: document.getElementById('cal-cfg-builtin'),
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
  nextEventCard: document.getElementById('next-event-card'),
  nextEventName: document.getElementById('next-event-name'),
  nextEventTime: document.getElementById('next-event-time'),
  btnStartFromEvent: document.getElementById('btn-start-from-event')
};

const state = {
  running: false,
  paused: false,
  totalSeconds: 0,
  remainingSeconds: 28 * 60,
  action: 'shutdown',
  unit: 'min',
  dryRun: false,
  sound: true,
  gracefulClose: true,
  forceShutdown: false,
  muteSystem: false,
  graceMinutes: 2,
  runAtLogin: false,
  miniMode: false,
  endsAt: null,
  selectedCard: null,
  // Smart Lights state
  smartLights: {
    enabled: false,
    provider: 'none',
    mode: 'gradual_dim',
    dimMinutes: 10,
    hueBridgeIp: '',
    hueUsername: '',
    hueGroupId: '',
    httpUrl: '',
    httpMethod: 'POST',
    httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}'
  },
  // Customization state
  customization: {
    accent: '#5b8cff',
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
  // Clock face style when idle: 'digital' | 'analog' | 'hybrid'. Hybrid is the default.
  clockFace: 'hybrid',
  // Analog/hybrid clock customization.
  clockStyle: 'modern',
  clockDial: 'bars',
  clockFormat: '24h',
  clockScale: 1,
  clockShowDate: false,
  clockHandColor: '#76c9ff',
  clockSeconds: true,
  // Smooth sweeping second hand (premium watch glide) vs. a per-second tick.
  clockSweep: true,
  // Tracks whether clock mode was dismissed by profile application (restore on cancel).
  _clockDismissedByProfile: false,
  // Custom timer name
  timerName: 'Last Call',
  // Profiles state
  profiles: [],
  currentProfileId: null,
  profileSearchQuery: '',
  profileActiveFilter: 'all',
  // Calendar state
  calendarEvents: [],
  calendarSource: null,
  // Transient outcome of the last session, shown briefly on the idle face:
  // 'completed' | 'dryrun' | 'cancelled' | null.
  lastOutcome: null
};

if (previewMode) {
  state.dryRun = true;
}

const SoundSystem = {
  ctx: null,
  enabled: true,
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
    logout: 'Log out'
  }[action] || 'Power action';
}

function formatEndTime(isoDate) {
  if (!isoDate) return 'Idle';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Idle';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  render();
}

function updateRing(remaining, total) {
  if (!els.ringProgress) return;
  const circumference = 2 * Math.PI * 90;
  const ratio = total > 0 ? clamp(remaining / total, 0, 1) : 0;
  els.ringProgress.style.strokeDasharray = `${circumference}`;
  els.ringProgress.style.strokeDashoffset = `${circumference - ratio * circumference}`;
}

function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

const notificationFeed = [];
const MAX_NOTIFICATIONS = 50;

function notify(message, type = 'info') {
  showToast(message, type);
  notificationFeed.unshift({ message, type, time: new Date().toISOString() });
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
    notifDrawer.style.display = notifDrawer.style.display === 'none' ? '' : 'none';
    if (notifDrawer.style.display !== 'none') renderNotificationFeed();
  });
}
if (notifDrawerClose && notifDrawer) {
  notifDrawerClose.addEventListener('click', () => { notifDrawer.style.display = 'none'; });
}

function setSidebarSelection(tab) {
  document.querySelectorAll('.ns-nav-item').forEach(btn => {
    const isActive = btn.dataset.nsTab === tab;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function activateTopTab(tab) {
  const button = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!button) return false;
  button.click();
  return true;
}

async function openReceiptsLedger() {
  try {
    const [receipts, stats] = await Promise.all([
      api.listReceipts?.(50),
      api.getReceiptStats?.()
    ]);
    renderReceiptsModal(receipts || [], stats);
    if (els.receiptsModal) els.receiptsModal.classList.add('active');
    return true;
  } catch (e) {
    console.error('Failed to load receipts:', e);
    notify('Ledger is unavailable right now', 'warning');
    return false;
  }
}

function openSettingsPanel() {
  syncCustomizeUI();
  updateLastLightUIFromState();
  loadRemoteControlState();
  els.optionsModal?.classList.add('active');
}

function openHelpPanel() {
  els.aboutModal?.classList.add('active');
  refreshUpdaterStatus();
  notify('Open Settings for controls and About for version/update details.', 'info', 4200);
}

// Exactly one of LIB / SCH / STATS is visible at a time. Each child element's
// own conditional display logic (isIdle, has-streak, has-proof, etc.) keeps
// working independently underneath — this only toggles the panel-level wrapper.
function applyMainPanelVisibility(panel) {
  if (els.panelLib) els.panelLib.style.display = panel === 'lib' ? '' : 'none';
  if (els.panelSch) els.panelSch.style.display = panel === 'sch' ? '' : 'none';
  if (els.panelStats) els.panelStats.style.display = panel === 'stats' ? '' : 'none';
  if (panel === 'sch') activateTopTab('schedule');
}

// Pulls only data that already exists elsewhere in the app (companion status,
// receipt history) — no new tracking, no fabricated numbers.
async function renderStatusPanel() {
  try {
    const rc = await api.getRemoteControl?.();
    const modeLabels = { off: 'Off', local: 'This PC only', wifi: 'Same Wi-Fi' };
    const mode = rc?.mode || 'off';
    if (els.statsCompanionMode) els.statsCompanionMode.textContent = modeLabels[mode] || 'Off';
    if (els.statsCompanionStatus) els.statsCompanionStatus.textContent = rc?.statusLabel || 'Off';
    if (els.statsCompanionNetwork) {
      els.statsCompanionNetwork.textContent = mode === 'wifi' ? `${rc.lanIp}:${rc.port}`
        : mode === 'local' ? `127.0.0.1:${rc.port}`
        : '—';
    }
    if (els.statsCompanionClients) els.statsCompanionClients.textContent = String(rc?.clients || 0);
  } catch {
    if (els.statsCompanionStatus) els.statsCompanionStatus.textContent = 'Unavailable';
  }

  if (!els.statsSessionSummary) return;
  try {
    const receipts = await api.listReceipts?.(5);
    if (!receipts || !receipts.length) {
      els.statsSessionSummary.innerHTML = '<p class="empty-state">No session history yet.</p>';
      return;
    }
    els.statsSessionSummary.innerHTML = receipts.map(r => {
      const when = r.startedAt ? new Date(r.startedAt).toLocaleDateString() : '—';
      return `<div class="status-row"><span>${escapeHtml(when)}</span><span>${escapeHtml(r.result || '')} &middot; ${escapeHtml(r.action || '')}</span></div>`;
    }).join('');
  } catch {
    els.statsSessionSummary.innerHTML = '<p class="empty-state">No session history yet.</p>';
  }
}

async function handleSidebarNavigation(tab, { persist = true } = {}) {
  let handled = false;

  if (tab === 'lib') {
    applyMainPanelVisibility('lib');
    handled = true;
  }
  if (tab === 'sch') {
    applyMainPanelVisibility('sch');
    handled = true;
  }
  if (tab === 'set') {
    openSettingsPanel();
    handled = true;
  }
  if (tab === 'help') {
    openHelpPanel();
    handled = true;
  }
  if (tab === 'stats') {
    applyMainPanelVisibility('stats');
    renderStatusPanel();
    handled = true;
  }

  if (!handled) {
    notify('Coming soon', 'info');
    return false;
  }

  setSidebarSelection(tab);
  if (persist) {
    try { api.saveAppSettings({ app: { nsActiveTab: tab } }); } catch (_) {}
  }
  return true;
}

els.btnStatsViewLedger?.addEventListener('click', () => openReceiptsLedger());

function formatIdleClockTime(now, compact = false) {
  const use12Hour = state.clockFormat === '12h';
  const minutes = now.getMinutes().toString().padStart(2, '0');

  if (!use12Hour) {
    const hours24 = now.getHours().toString().padStart(2, '0');
    return `${hours24}:${minutes}`;
  }

  const hours12 = now.getHours() % 12 || 12;
  const meridiem = now.getHours() >= 12 ? 'PM' : 'AM';
  return compact ? `${hours12}:${minutes}${meridiem.charAt(0).toLowerCase()}` : `${hours12}:${minutes} ${meridiem}`;
}

function formatIdleClockDate(now, compact = false) {
  return now.toLocaleDateString('en-US', compact
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric' });
}

function render() {
  const isIdle = !state.running && !state.paused;
  const displaySeconds = state.running || state.paused ? state.remainingSeconds : inputSeconds();
  const totalSeconds = state.running || state.paused ? state.totalSeconds : displaySeconds;
  const idleClockVisible = isIdle && state.clockMode;

  els.body.classList.toggle('is-running', state.running);
  els.body.classList.toggle('is-paused', state.paused);
  els.body.classList.toggle('mini-mode', state.miniMode);
  els.timerDisplay?.classList.toggle('clock-idle', idleClockVisible);

  // Clock Mode: show current time when idle instead of countdown input.
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
      // Hybrid: show digital readout inside the analog clock face.
      if (els.analogDigital) els.analogDigital.textContent = face === 'hybrid' ? compactTimeText : '';
      if (els.analogDate) els.analogDate.textContent = compactDateText;
    }
    // Pure analog hides the digital text; hybrid keeps the readout inside the SVG; digital shows the full time.
    els.timerMain.textContent = face === 'analog' || face === 'hybrid' ? '' : timeText;
    els.timerMain.classList.remove('hybrid-readout');
    if (els.timerSub) els.timerSub.textContent = showAnalog ? '' : dateText;
    // Show next bedtime reminder if configured.
    const bedtime = state.bedtime || '';
    if (bedtime && els.timerLabel) {
      els.timerLabel.textContent = `Bedtime ${bedtime}`;
    } else {
      els.timerLabel.textContent = 'ready';
    }
  } else {
    if (els.analogClock) {
      els.analogClock.style.display = 'none';
      els.analogClock.classList.remove('sweep');
    }
    if (els.analogDigital) els.analogDigital.textContent = '';
    if (els.analogDate) els.analogDate.textContent = '';
    els.timerMain.classList.remove('hybrid-readout');
    els.timerMain.textContent = formatTime(displaySeconds);
    els.timerLabel.textContent = state.paused
      ? `${actionLabel()} paused`
      : state.running
        ? `until ${actionLabel().toLowerCase()}`
        : 'ready';
    if (els.timerSub) els.timerSub.textContent = '';
  }

  // Briefly label how the last session ended, overriding the idle/clock label.
  if (isIdle && state.lastOutcome && els.timerLabel) {
    const outcomeLabels = { completed: 'session complete', dryrun: 'dry run complete', cancelled: 'session cancelled' };
    if (outcomeLabels[state.lastOutcome]) els.timerLabel.textContent = outcomeLabels[state.lastOutcome];
  }

  updateRing(displaySeconds, totalSeconds);

  els.btnStart.style.display = state.running || state.paused ? 'none' : 'flex';
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
  const nsHero = document.getElementById('ns-hero-card');
  const nsTrust = document.getElementById('ns-trust-bar');
  if (nsHero) nsHero.style.display = isIdle ? '' : 'none';
  if (nsTrust) nsTrust.style.display = isIdle ? '' : 'none';
  document.body.classList.toggle('ns-lobby', isIdle);

  els.timerInput.disabled = state.running || state.paused;
  els.btnPlus.disabled = state.running || state.paused;
  els.btnMinus.disabled = state.running || state.paused;

  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.unit === state.unit);
  });

  document.getElementById('toggle-dryrun')?.querySelector('.toggle-indicator')?.replaceChildren(document.createTextNode(state.dryRun ? 'ON' : 'OFF'));
  document.getElementById('toggle-mute')?.querySelector('.toggle-indicator')?.replaceChildren(document.createTextNode(state.sound ? 'ON' : 'OFF'));
  document.getElementById('toggle-graceful')?.querySelector('.toggle-indicator')?.replaceChildren(document.createTextNode(state.gracefulClose ? 'ON' : 'OFF'));

  // Status pill: single animated indicator replacing badge soup
  if (els.statusPill) {
    const pill = els.statusPill;
    pill.className = 'status-pill';
    if (!state.running && !state.paused) {
      const outcomePill = state.lastOutcome && {
        completed: { cls: 'complete', text: 'Completed' },
        dryrun: { cls: 'complete', text: 'Dry Run Complete' },
        cancelled: { cls: 'cancelled', text: 'Cancelled' }
      }[state.lastOutcome];
      if (outcomePill) {
        pill.classList.add(outcomePill.cls);
        els.statusText.textContent = outcomePill.text;
      } else {
        els.statusText.textContent = state.dryRun ? 'Dry Run' : 'Idle';
        if (state.dryRun) pill.classList.add('dryrun');
      }
    } else if (state.paused) {
      pill.classList.add('paused');
      els.statusText.textContent = 'Paused';
    } else {
      const phaseClass = state.phase === 'dim' ? 'dim' : state.phase === 'lastlight' ? 'lastlight' : 'running';
      pill.classList.add(phaseClass);
      if (state.dryRun) pill.classList.add('dryrun');
      const labels = { focus: 'Focus', dim: 'Winding Down', lastlight: 'Last Light', idle: 'Running' };
      els.statusText.textContent = labels[state.phase] || 'Running';
    }
  }

  // Phase class on body for ring animations + warm shift.
  document.body.className = document.body.className.replace(/phase-\w+/g, '').trim();
  if (state.running && state.phase && state.phase !== 'idle') {
    document.body.classList.add('phase-' + state.phase);
  }
  if (state.paused) document.body.classList.add('is-paused');
  else if (state.running) document.body.classList.add('is-running');

  els.actionName.textContent = actionLabel();
  els.endTime.textContent = state.running || state.paused ? formatEndTime(state.endsAt) : 'Idle';

  // Don't clobber the user's in-progress edits while the options modal is open.
  if (!els.optionsModal?.classList.contains('active')) {
    if (els.chkDryRun) els.chkDryRun.checked = state.dryRun;
    if (els.chkForceShutdown) els.chkForceShutdown.checked = state.forceShutdown;
    if (els.chkMute) els.chkMute.checked = state.muteSystem;
    if (els.chkRunLogin) els.chkRunLogin.checked = state.runAtLogin;
    if (els.graceMinutes) els.graceMinutes.value = state.graceMinutes;
  }

  document.querySelectorAll('.tonight-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.card === state.selectedCard);
  });
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
      // Add the class + seed the animation-delay only on the transition into sweep,
      // so we don't restart (and stutter) the animation every render tick.
      if (!els.analogClock.classList.contains('sweep')) {
        const secFrac = sec + now.getMilliseconds() / 1000;
        els.clockSecond.removeAttribute('transform');
        els.clockSecond.style.animationDelay = `-${secFrac.toFixed(3)}s`;
        els.analogClock.classList.add('sweep');
      }
    } else {
      els.analogClock.classList.remove('sweep');
      els.clockSecond.style.animationDelay = '';
      els.clockSecond.setAttribute('transform', `rotate(${secDeg} 50 50)`);
    }
  }
}

async function startTimer(seconds = inputSeconds()) {
  const durationSeconds = Math.max(1, Math.round(seconds));

  try {
    SoundSystem.playStart();
    const result = await api.startTimer({
      durationSeconds,
      action: state.action,
      dryRun: state.dryRun,
      forceShutdown: state.forceShutdown,
      muteSystem: state.muteSystem,
      gracePeriod: state.graceMinutes
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
    if (outcomeTimer) clearTimeout(outcomeTimer);
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
    if (state.paused) {
      await api.resumeTimer();
      state.paused = false;
      state.running = true;
      state.endsAt = new Date(Date.now() + state.remainingSeconds * 1000).toISOString();
      notify('Timer resumed', 'success');
    } else {
      await api.pauseTimer();
      state.paused = true;
      notify('Timer paused', 'warning');
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
    const list = document.getElementById('snooze-tax-consequences');
    if (list) {
      list.innerHTML = cost.consequences.map(c => `
        <div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--bg-card)">
          <span style="font-size:16px">${c.icon}</span>
          <div>
            <span style="font-size:11px;color:var(--text-primary)">${c.message}</span>
            <span style="font-size:9px;color:${c.severity === 'high' ? '#ff4d4d' : 'var(--text-muted)'};display:block;margin-top:1px">${c.severity?.toUpperCase() || ''}</span>
          </div>
        </div>
      `).join('');
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

    function cleanup() {
      modal.classList.remove('active');
      confirmBtn?.removeEventListener('click', onConfirm);
      cancelBtn?.removeEventListener('click', onCancel);
    }
    function onConfirm() {
      if (cost.requireReason && reasonInput) {
        state._snoozeTaxReason = reasonInput.value.trim();
        if (!state._snoozeTaxReason) {
          reasonInput.focus();
          reasonInput.style.borderColor = '#ff4d4d';
          return; // must give a reason
        }
      }
      cleanup();
      resolve(true);
    }
    function onCancel() { cleanup(); resolve(false); }

    confirmBtn?.addEventListener('click', onConfirm);
    cancelBtn?.addEventListener('click', onCancel);
  });
}

let outcomeTimer = null;
// Briefly surface how the last session ended on the idle face, then auto-clear
// back to the normal idle/clock state. Renderer-only; the timer authority in
// main is unaffected.
function setSessionOutcome(kind) {
  state.lastOutcome = kind;
  if (outcomeTimer) clearTimeout(outcomeTimer);
  outcomeTimer = setTimeout(() => {
    state.lastOutcome = null;
    render();
  }, 8000);
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

  if (data.type === 'complete') {
    state.running = false;
    state.paused = false;
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
    api.showNotification('Lights Out', state.dryRun ? 'Dry run complete.' : `${actionLabel()} started.`);
    notify(data.message || 'Timer complete', 'success', 5000);
    setSessionOutcome(state.dryRun ? 'dryrun' : 'completed');
    if (typeof stopGuidedBreathing === 'function') stopGuidedBreathing();
    if (typeof AmbientVisuals !== 'undefined') AmbientVisuals.stop();
  } else if (data.type === 'cancelled') {
    state.running = false;
    state.paused = false;
    state.endsAt = null;
    state.phase = 'idle';
    Soundscape.stop();
    hideWarningModal();
    removeWarmFilter();
    setSessionOutcome('cancelled');
    notify('Session cancelled', 'info');
    if (typeof stopGuidedBreathing === 'function') stopGuidedBreathing();
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
    const sc = state.customization.soundscape || 'off';
    if (sc !== 'off') Soundscape.start(sc);
  } else if (data.type === 'tick' && state.remainingSeconds <= 10 && state.remainingSeconds > 0) {
    SoundSystem.playTone(800, 0.04, 'sine', 0.08);
  } else if (data.type === 'dryrun') {
    notify(data.message || 'Dry run skipped the power action', 'info');
  } else if (data.type === 'error') {
    notify(data.message || 'Timer error', 'error');
  }

  render();
}

async function loadStreaks() {
  try {
    const summary = await api.getStreaks();
    const catalog = await api.getAchievementsCatalog();
    const report = await api.getWeeklyReport();
    const sleepScore = await api.getSleepScore();
    const history = await api.getStreaksHistory?.() || [];
    renderStreaks(summary, catalog, report, sleepScore, history);
  } catch { /* streaks are decorative, never block */ }
}

// Home streak callout: show the current streak above Saved Profiles, but only
// when there actually is one. A zero/absent streak stays hidden so the home
// screen never displays a "0-night streak" or any unearned claim.
function updateStreakCallout(summary) {
  if (!els.streakCallout) return;
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
  els.streakCallout.style.display = '';
}

// Fetch just the streak summary (cheap) to drive the home callout, independent
// of the Streaks tab being opened.
async function refreshStreakCallout() {
  try {
    updateStreakCallout(await api.getStreaks());
  } catch { /* decorative, never block */ }
}

function showStreakCelebration(count) {
  const modal = document.getElementById('streak-celebration-modal');
  const num = document.getElementById('celebration-streak-number');
  if (modal && num) {
    num.textContent = count;
    modal.classList.add('active');
  }
}

function renderStreaks(summary, catalog, report, sleepScore, history) {
  if (!summary) return;

  // Sleep Score.
  if (sleepScore && sleepScore.score !== null) {
    if (els.scoreValue) els.scoreValue.textContent = sleepScore.score;
    if (els.scoreLabel) els.scoreLabel.textContent = sleepScore.label || 'Sleep Score';
    // Animate the ring fill (circumference = 2 * PI * 52 = ~327).
    const pct = sleepScore.score / 100;
    const offset = 327 - (327 * pct);
    if (els.scoreRingFill) {
      els.scoreRingFill.style.strokeDashoffset = offset;
      const colors = { 'Legendary': '#4caf50', 'Excellent': '#76c9ff', 'Good': '#d4a50a', 'Fair': '#ff9800', 'Needs Work': '#ff4d4d' };
      els.scoreRingFill.style.stroke = colors[sleepScore.label] || '#5b8cff';
    }
    // Breakdown bars.
    if (els.scoreBreakdown) {
      const bd = sleepScore.breakdown || {};
      els.scoreBreakdown.innerHTML = [
        bd.consistency ? `<div class="score-bar"><span class="score-bar-label">Consistency</span><div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.round(bd.consistency.score/bd.consistency.max*100)}%"></div></div><span class="score-bar-val">${bd.consistency.score}/${bd.consistency.max}</span></div>` : '',
        bd.onTime ? `<div class="score-bar"><span class="score-bar-label">On-time</span><div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.round(bd.onTime.score/bd.onTime.max*100)}%"></div></div><span class="score-bar-val">${bd.onTime.score}/${bd.onTime.max}</span></div>` : '',
        bd.noSnooze ? `<div class="score-bar"><span class="score-bar-label">No Snooze</span><div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.round(bd.noSnooze.score/bd.noSnooze.max*100)}%"></div></div><span class="score-bar-val">${bd.noSnooze.score}/${bd.noSnooze.max}</span></div>` : '',
        bd.ritual ? `<div class="score-bar"><span class="score-bar-label">Ritual</span><div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.round(bd.ritual.score/bd.ritual.max*100)}%"></div></div><span class="score-bar-val">${bd.ritual.score}/${bd.ritual.max}</span></div>` : ''
      ].join('');
    }
  } else if (els.scoreValue) {
    els.scoreValue.textContent = '--';
    if (els.scoreLabel) els.scoreLabel.textContent = 'Sleep Score (need 3+ nights)';
  }

  updateStreakCallout(summary);

  if (els.streakCount) els.streakCount.textContent = summary.streak || 0;
  if (els.streakBest) els.streakBest.textContent = summary.bestStreak || 0;
  if (els.streakTotal) els.streakTotal.textContent = summary.totalNights || 0;
  if (els.streakWeekAvg) els.streakWeekAvg.textContent = summary.weekAvg || '--:--';
  if (els.streakOnTime) els.streakOnTime.textContent = `${summary.weekOnTime || 0}%`;

  // Week consistency + snooze from report.
  if (report) {
    if (els.streakOnTime) els.streakOnTime.textContent = `${100 - (report.snoozeRate || 0)}% on-time`;
  }

  // Sleep History Grid (30 Days)
  if (els.sleepHistoryGrid && history) {
    els.sleepHistoryGrid.innerHTML = history.map(d => {
      let stateClass = 'neutral';
      let tooltip = `${d.date}: Missed (No timer)`;
      let icon = '';
      if (d.hasEvent) {
        if (d.snoozed) {
          stateClass = 'snoozed';
          tooltip = `${d.date}: Bedtime met @ ${d.bedTime} (Snoozed) [${d.action}]`;
          icon = '&#x26A0;';
        } else {
          stateClass = 'on-time';
          tooltip = `${d.date}: Bedtime met @ ${d.bedTime} [${d.action}]`;
          icon = '&#x2714;';
        }
      }
      return `<div class="history-block ${stateClass}" data-tooltip="${escapeHtml(tooltip)}">${icon || d.date.slice(-2)}</div>`;
    }).join('');
  }

  // Achievements grid.
  if (els.achievementsGrid && catalog?.length) {
    const unlocked = summary.achievements || [];
    els.achievementsGrid.innerHTML = catalog.map(a => {
      const isUnlocked = unlocked.includes(a.id);
      const icons = {
        first_light: '&#x1F319;',
        weekly_warrior: '&#x1F4AA;',
        '3_night_streak': '&#x1F525;',
        '7_night_streak': '&#x2B50;',
        '14_night_streak': '&#x1F31F;',
        '30_night_streak': '&#x1F451;',
        centurion: '&#x1F396;',
        no_snooze_7: '&#x23F0;',
        last_light_activated: '&#x1F4A1;'
      };
      const icon = isUnlocked ? (icons[a.id] || '&#x1F4E6;') : '&#x1F512;';
      return `<div class="achievement-card ${isUnlocked ? 'unlocked' : 'locked'}">
        <div class="ach-icon">${icon}</div>
        <div class="ach-name">${isUnlocked ? escapeHtml(a.name) : '???'}</div>
        <div class="ach-desc">${isUnlocked ? escapeHtml(a.desc) : 'Not yet unlocked'}</div>
      </div>`;
    }).join('');
  }
}

function toggleMiniMode() {
  state.miniMode = !state.miniMode;
  api.toggleMiniMode();
  render();
  notify(state.miniMode ? 'Mini mode' : 'Full view', 'info');
}

function selectClockTarget(timeValue) {
  const seconds = secondsUntilClockValue(timeValue);
  state.unit = 'min';
  setInputFromSeconds(seconds);
  updateScheduleHint(seconds, timeValue);
  notify('Schedule target selected', 'info');
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

// Show a plain-language summary of when a scheduled action will fire.
function updateScheduleHint(seconds, timeValue) {
  if (!els.scheduleHint) return;
  if (!timeValue) { els.scheduleHint.textContent = ''; return; }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  const parts = [];
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  const when = String(timeValue).includes('T') ? new Date(timeValue).toLocaleString() : timeValue;
  els.scheduleHint.textContent = `${actionLabel()} in ${parts.join(' ')} \u2014 ${when}`;
}

function applyTonightCard(card) {
  state.selectedCard = card.dataset.card || null;
  if (card.dataset.action) setAction(card.dataset.action);
  if (card.dataset.force) state.forceShutdown = card.dataset.force === 'true';
  if (card.dataset.minutes) {
    state.unit = 'min';
    setInputFromSeconds(Number(card.dataset.minutes) * 60);
  }
  notify(`Selected: ${card.querySelector('.card-title')?.textContent || 'Timer'}`, 'info');
}
function wireEvents() {
  els.btnStart.addEventListener('click', () => startTimer());
  els.btnStop.addEventListener('click', cancelTimer);
  els.btnPause.addEventListener('click', togglePause);
  els.btnSnooze.addEventListener('click', () => snooze(5 * 60));
  els.btnMinimize.addEventListener('click', () => api.minimizeWindow());
  els.btnClose.addEventListener('click', () => api.closeWindow());
  els.btnMini?.addEventListener('click', toggleMiniMode);
  els.btnWidget?.addEventListener('click', () => {
    api.toggleWidget?.();
    notify('Desktop widget toggled', 'info');
  });
  els.btnCompanion?.addEventListener('click', async () => {
    try {
      const rc = await api.getRemoteControl?.();
      if (rc?.enabled && rc.url) {
        await api.openExternal?.(rc.url);
        notify(`Companion at ${rc.url}`, 'info');
      } else {
        openSettingsPanel();
        setSidebarSelection('set');
        notify('Enable Remote Control in settings before opening the Companion PWA', 'info');
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
    els.wifiGuardConfig.style.display = els.chkWifiGuard.checked ? '' : 'none';
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
    els.btnWifiScan.textContent = 'Scan Network';
    els.btnWifiScan.disabled = false;
  });
}

if (els.btnWifiBlockTest) {
  els.btnWifiBlockTest.addEventListener('click', async () => {
    els.wifiTestResult.textContent = 'Blocking...';
    try {
      const result = await api.wifiGuardBlock?.();
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
      els.wifiTestResult.textContent = result.success ? 'Unblocked!' : `Failed: ${result.error}`;
      els.wifiTestResult.style.color = result.success ? '#4caf50' : '#ff4d4d';
    } catch { els.wifiTestResult.textContent = 'Error'; }
  });
}

// WiFi Guard status notification.
api.onWifiGuardStatus?.(data => {
  if (data?.blocked) notify('WiFi Guard: Internet blocked', 'warning');
  else if (data && !data.blocked) notify('WiFi Guard: Internet restored', 'info');
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
    els.contentBlockerConfig.style.display = els.chkContentBlocker.checked ? '' : 'none';
  });
}

if (els.btnContentBlockTest) {
  els.btnContentBlockTest.addEventListener('click', async () => {
    els.contentTestResult.textContent = 'Blocking...';
    try {
      const result = await api.contentBlock?.();
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
    els.accountabilityConfig.style.display = els.chkAccountability.checked ? '' : 'none';
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
  els.autopilotOverrideTime.addEventListener('change', async () => {
    const val = els.autopilotOverrideTime.value || null;
    await api.saveAppSettings?.({ autopilotBedtime: val });
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
// Guided Breathing: 4-7-8 technique with ring pulse
// ─────────────────────────────────────────────────────────────────────────────

if (els.btnBreathingStop) {
  els.btnBreathingStop.addEventListener('click', () => {
    if (typeof stopGuidedBreathing === 'function') stopGuidedBreathing();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus Sessions: Pomodoro-style deep work
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll('.focus-preset-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const preset = btn.dataset.preset;
    const result = await api.focusStart?.(preset);
    if (result) {
      renderFocusSession(result);
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
    notify('Focus session ended', 'info');
  });
}

api.onFocusTick?.(fs => {
  renderFocusSession(fs);
});

api.onFocusPhase?.(data => {
  renderFocusSession(data);
  const labels = { focus: 'Focus', break: 'Break', longbreak: 'Long Break' };
  notify(`${labels[data.phase] || data.phase} phase`, 'info');
});

api.onFocusComplete?.(fs => {
  if (els.focusActive) els.focusActive.style.display = 'none';
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

// View receipts modal.
if (els.btnProofDetails) {
  els.btnProofDetails.addEventListener('click', () => openReceiptsLedger());
}

if (els.btnWarningLedger) {
  els.btnWarningLedger.addEventListener('click', () => openReceiptsLedger());
}

if (els.receiptsModalClose) {
  els.receiptsModalClose.addEventListener('click', () => {
    if (els.receiptsModal) els.receiptsModal.classList.remove('active');
  });
}

// Copy proof to clipboard.
if (els.btnProofCopy) {
  els.btnProofCopy.addEventListener('click', async () => {
    try {
      const receipt = await api.getLatestReceipt?.();
      if (!receipt) return;
      const text = [
        `Lights Out - Morning Proof`,
        `Result: ${receipt.result}`,
        `Action: ${receipt.action}${receipt.forceShutdown ? ' (Force)' : ''}${receipt.dryRun ? ' (Dry Run)' : ''}`,
        `Duration: ${Math.floor(receipt.durationSeconds / 60)}m`,
        `Started: ${receipt.startedAt}`,
        `Ended: ${receipt.endedAt || 'N/A'}`,
        `Pauses: ${receipt.pauseCount}, Snoozes: ${receipt.snoozeCount}, Warnings: ${receipt.warningsShown}`,
        receipt.powerCommand ? `Command: ${receipt.powerCommand}` : '',
        receipt.notes ? `Notes: ${receipt.notes}` : ''
      ].filter(Boolean).join('\n');
      await navigator.clipboard.writeText(text);
      notify('Proof copied to clipboard', 'success');
    } catch { notify('Copy failed', 'error'); }
  });
}

// Northstar proof hero: Play Tonight Again — delegates to existing start flow.
document.getElementById('btn-proof-again')?.addEventListener('click', () => {
  if (els.morningProofSection) els.morningProofSection.style.display = 'none';
  document.getElementById('btn-start')?.click();
});

// Northstar proof hero: Dismiss — hides the card.
function dismissMorningProof() {
  if (els.morningProofSection) els.morningProofSection.style.display = 'none';
}

document.getElementById('btn-proof-dismiss')?.addEventListener('click', dismissMorningProof);
document.getElementById('btn-proof-close')?.addEventListener('click', dismissMorningProof);

// Escape closes the Mission Complete overlay when it is visible.
if (els.morningProofSection) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.morningProofSection.style.display !== 'none') {
      dismissMorningProof();
    }
  });
}

// Clear receipts.
if (els.btnClearReceipts) {
  els.btnClearReceipts.addEventListener('click', async () => {
    try {
      await api.clearReceipts?.();
      if (els.receiptsList) els.receiptsList.innerHTML = '<p style="font-size:11px;color:var(--text-muted)">No receipts.</p>';
      if (els.receiptStats) els.receiptStats.innerHTML = '';
      notify('All receipts cleared', 'info');
    } catch (e) {
      console.error('Failed to clear receipts:', e);
    }
  });
}
  els.btnPlus.addEventListener('click', () => {
    els.timerInput.value = inputValue() + 1;
    setInputFromSeconds(inputSeconds());
  });

  els.btnMinus.addEventListener('click', () => {
    els.timerInput.value = Math.max(1, inputValue() - 1);
    setInputFromSeconds(inputSeconds());
  });

  els.timerInput.addEventListener('input', () => {
    if (!state.running && !state.paused) {
      state.remainingSeconds = inputSeconds();
      state.totalSeconds = state.remainingSeconds;
      render();
    }
  });

  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.running || state.paused) return;
      const seconds = inputSeconds();
      state.unit = btn.dataset.unit;
      setInputFromSeconds(seconds);
    });
  });

  document.querySelectorAll('.submenu-item').forEach(item => {
    item.addEventListener('click', event => {
      event.stopPropagation();

      if (item.dataset.action) {
        setAction(item.dataset.action);
        notify(`${actionLabel()} selected`, 'info');
        return;
      }

      if (item.dataset.minutes) {
        state.unit = 'min';
        setInputFromSeconds(Number(item.dataset.minutes) * 60);
        startTimer(Number(item.dataset.minutes) * 60);
        return;
      }

      if (item.classList.contains('toggle')) {
        if (item.id === 'toggle-dryrun') state.dryRun = !state.dryRun;
        if (item.id === 'toggle-mute') {
          state.sound = !state.sound;
          SoundSystem.enabled = state.sound;
        }
        if (item.id === 'toggle-graceful') state.gracefulClose = !state.gracefulClose;
        render();
        // Persist these quick toggles so they survive a relaunch.
        api.saveAppSettings({ app: collectAppSettings() });
        return;
      }

      if (item.id === 'open-options') {
        openSettingsPanel();
        setSidebarSelection('set');
        return;
      }

      if (item.id === 'open-about') {
        openHelpPanel();
        setSidebarSelection('help');
        return;
      }

      if (item.dataset.external) {
        api.openExternal(item.dataset.external);
        return;
      }

      if (item.dataset.help) {
        notify(item.dataset.help, 'info', 4200);
      }
    });
  });

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const minutes = Number(chip.dataset.min);
      state.unit = 'min';
      setInputFromSeconds(minutes * 60);
      startTimer(minutes * 60);
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
      if (btn.dataset.tab === 'library') setSidebarSelection('lib');
      if (btn.dataset.tab === 'schedule') setSidebarSelection('sch');
      if (btn.dataset.tab === 'streaks') setSidebarSelection('stats');
      if (btn.dataset.tab === 'streaks') loadStreaks();
      if (btn.dataset.tab === 'focus') loadSleepDebt();
    });
  });

  // Northstar hero card PLAY button starts the timer.
  document.getElementById('ns-play-btn')?.addEventListener('click', () => startTimer());

  // Home streak callout jumps to the Streaks tab for the full breakdown.
  els.streakCallout?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="streaks"]')?.click();
  });

  document.getElementById('btn-celebration-dismiss')?.addEventListener('click', () => {
    document.getElementById('streak-celebration-modal')?.classList.remove('active');
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

  els.modalClose.addEventListener('click', () => {
    els.optionsModal.classList.remove('active');
    render();
  });
  els.btnCancelOpt.addEventListener('click', () => {
    els.optionsModal.classList.remove('active');
    render();
  });
  els.optionsModal.addEventListener('click', event => {
    if (event.target === els.optionsModal) {
      els.optionsModal.classList.remove('active');
      render();
    }
  });

  if (els.aboutModalClose) {
    els.aboutModalClose.addEventListener('click', () => els.aboutModal.classList.remove('active'));
  }
  if (els.aboutModal) {
    els.aboutModal.addEventListener('click', event => {
      if (event.target === els.aboutModal) els.aboutModal.classList.remove('active');
    });
  }

  els.btnSaveOpt.addEventListener('click', async () => {
    state.action = els.selAction.value;
    state.graceMinutes = clamp(Number(els.graceMinutes.value) || 0, 0, 10);
    state.forceShutdown = els.chkForceShutdown.checked;
    state.muteSystem = els.chkMute.checked;
    state.dryRun = Boolean(els.chkDryRun?.checked);
    state.runAtLogin = Boolean(els.chkRunLogin?.checked);

    // Save Smart Lights config
    state.smartLights = {
      enabled: els.chkSmartLights?.checked || false,
      provider: els.selLightProvider?.value || 'none',
      mode: els.selLightMode?.value || 'gradual_dim',
      dimMinutes: clamp(Number(els.lightDimMinutes?.value) || 10, 1, 60),
      hueBridgeIp: els.hueBridgeIp?.value || '',
      hueUsername: els.hueUsername?.value || '',
      hueGroupId: els.hueGroupId?.value || '',
      httpUrl: els.httpUrl?.value || '',
      httpMethod: els.httpMethod?.value || 'POST',
      httpBodyTemplate: els.httpTemplate?.value || '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}'
    };

    state.lastLight = {
      enabled: els.chkLastLight?.checked || false,
      sequence: els.selLastLightSequence?.value || 'ClassicFade',
      sound: els.selLastLightSound?.value || 'Off'
    };

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
    } catch (error) {
      notify(`Login settings failed: ${error.message || error}`, 'warning', 4500);
    }

    try {
      await api.saveSmartLightConfig(state.smartLights);
      notify('Settings saved', 'success');
    } catch (error) {
      notify(`Smart lights save failed: ${error.message || error}`, 'error');
    }

    els.optionsModal.classList.remove('active');
    setAction(state.action);
    render();
  });

  els.selAction.addEventListener('change', () => setAction(els.selAction.value));
  els.chkDryRun?.addEventListener('change', () => {
    state.dryRun = els.chkDryRun.checked;
    render();
  });

  document.querySelectorAll('.tonight-card').forEach(card => {
    card.addEventListener('click', () => applyTonightCard(card));
  });

  document.querySelectorAll('.clock-btn').forEach(btn => {
    btn.addEventListener('click', () => selectClockTarget(btn.dataset.time));
  });

  document.querySelectorAll('.cd-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const hours = Number(btn.dataset.hours);
      state.unit = 'min';
      setInputFromSeconds(hours * 3600);
      notify(`${hours} hour countdown selected`, 'info');
    });
  });

  els.scheduleCheck?.addEventListener('change', () => {
    if (els.scheduleCheck.checked) {
      if (els.scheduleTime && !els.scheduleTime.value) {
        els.scheduleTime.value = defaultScheduleDateTime(state.bedtime || '22:30');
      }
      selectClockTarget(els.scheduleTime.value);
    } else if (els.scheduleHint) {
      els.scheduleHint.textContent = '';
    }
    render();
  });

  els.scheduleTime?.addEventListener('change', () => {
    if (els.scheduleCheck.checked) selectClockTarget(els.scheduleTime.value);
  });

  // Persist clock preferences immediately on change so they survive a relaunch
  // without requiring an explicit Save.
  const persistClockPrefs = () => {
    try { api.saveAppSettings({ app: collectAppSettings() }); } catch (_) { /* no-op */ }
  };

  if (els.czClockFace) {
    els.czClockFace.addEventListener('change', () => {
      state.clockFace = els.czClockFace.value || 'hybrid';
      updateClockStyleVisibility();
      render();
      persistClockPrefs();
    });
  }

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
      state.clockHandColor = els.czClockHands.value || '#76c9ff';
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

  document.addEventListener('keydown', event => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') {
      if (event.key === 'Escape') event.target.blur();
      return;
    }

    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      if (state.running || state.paused) togglePause();
      else startTimer();
      return;
    }

    if (event.key === 'Escape') {
      // Close the topmost active modal/drawer.
      if (els.optionsModal.classList.contains('active')) {
        els.optionsModal.classList.remove('active');
      } else if (els.profilesModal?.classList.contains('active')) {
        els.profilesModal.classList.remove('active');
      } else if (els.receiptsModal?.classList.contains('active')) {
        els.receiptsModal.classList.remove('active');
      } else if (els.aboutModal?.classList.contains('active')) {
        els.aboutModal.classList.remove('active');
      } else if (document.getElementById('notif-drawer')?.style.display !== 'none') {
        document.getElementById('notif-drawer').style.display = 'none';
      } else if (document.getElementById('ritual-overlay')?.classList.contains('active')) {
        document.getElementById('ritual-overlay').classList.remove('active');
      } else if (document.getElementById('warning-modal')?.classList.contains('active')) {
        document.getElementById('warning-modal').classList.remove('active');
      } else if (document.getElementById('override-modal')?.classList.contains('active')) {
        document.getElementById('override-modal').classList.remove('active');
      } else if (document.getElementById('snooze-tax-modal')?.classList.contains('active')) {
        document.getElementById('snooze-tax-modal').classList.remove('active');
      } else if (document.getElementById('streak-celebration-modal')?.classList.contains('active')) {
        document.getElementById('streak-celebration-modal').classList.remove('active');
      } else if (state.running || state.paused) {
        cancelTimer();
      }
      return;
    }

    const presets = { '1': 5, '2': 10, '3': 15, '4': 30, '5': 60, '6': 120 };
    if (presets[event.key] && !state.running && !state.paused) {
      state.unit = 'min';
      setInputFromSeconds(presets[event.key] * 60);
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
      showContextMenu(event.clientX, event.clientY, [
        { label: '\u25B6  Start', action: () => applyProfile(profileId, { start: true }) },
        { label: '\u270E  Edit\u2026', action: () => openProfilesModal() },
        { label: '\u2715  Delete', danger: true, action: () => deleteProfile(profileId) }
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
    els.selLightProvider.addEventListener('change', () => {
      state.smartLights.provider = els.selLightProvider.value;
      updateLightsUI();
    });
  }

  if (els.btnDiscoverHue) {
    els.btnDiscoverHue.addEventListener('click', async () => {
      try {
        const result = await api.discoverHueBridge();
        if (result?.ip) {
          els.hueBridgeIp.value = result.ip;
          state.smartLights.hueBridgeIp = result.ip;
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
          els.hueUsername.value = result.username;
          state.smartLights.hueUsername = result.username;
          notify('Registered successfully!', 'success');
        } else if (result?.error) {
          notify(`Registration failed: ${result.error}`, 'error');
        }
      } catch (error) {
        notify(`Registration failed: ${error.message}`, 'error');
      }
    });
  }

  if (els.btnTestLights) {
    els.btnTestLights.addEventListener('click', async () => {
      // Save current config first
      const testConfig = {
        enabled: true,
        provider: els.selLightProvider.value,
        mode: els.selLightMode.value,
        dimMinutes: Number(els.lightDimMinutes.value) || 10,
        hueBridgeIp: els.hueBridgeIp.value,
        hueUsername: els.hueUsername.value,
        hueGroupId: els.hueGroupId.value,
        httpUrl: els.httpUrl.value,
        httpMethod: els.httpMethod.value,
        httpBodyTemplate: els.httpTemplate.value
      };
      
      try {
        await api.saveSmartLightConfig(testConfig);
        const result = await api.testSmartLightConnection();
        if (els.lightTestResult) {
          els.lightTestResult.textContent = result.message;
          els.lightTestResult.className = result.success ? 'success' : 'error';
        }
        notify(result.message, result.success ? 'success' : 'warning');
      } catch (error) {
        notify(`Test failed: ${error.message}`, 'error');
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
      filterContainer.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted)';
      });
      btn.classList.add('active');
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.color = '#fff';
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

  // Keyboard shortcuts for profiles (Ctrl+1, Ctrl+2, etc.)
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && /^[1-9]$/.test(event.key)) {
      const index = parseInt(event.key, 10) - 1;
      const profile = state.profiles[index];
      if (profile) {
        event.preventDefault();
        applyProfile(profile.id);
      }
    }
  });

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
}

function updateLightsUI() {
  if (els.lightsConfig) {
    els.lightsConfig.style.display = state.smartLights.enabled ? 'block' : 'none';
  }
  if (els.hueConfig) {
    els.hueConfig.style.display = state.smartLights.provider === 'hue' ? 'block' : 'none';
  }
  if (els.httpConfig) {
    els.httpConfig.style.display = state.smartLights.provider === 'http' ? 'block' : 'none';
  }
}

async function loadInitialData() {
  try {
    const [systemInfo, appSettings, lightConfig] = await Promise.all([
      api.getSystemInfo(),
      api.getAppSettings(),
      api.getSmartLightConfig()
    ]);

    // --- Critical: rehydrate persisted settings FIRST. A failure in any
    // non-critical loader below must never prevent saved preferences (clock
    // face/style/sweep/seconds, customization, Last Light) from being applied. ---
    if (typeof appSettings.runAtLogin === 'boolean') {
      state.runAtLogin = appSettings.runAtLogin;
    }
    if (appSettings.app) applyAppSettings(appSettings.app);
    if (appSettings.customization) {
      state.customization = { ...state.customization, ...appSettings.customization };
    }
    applyCustomization(state.customization);
    if (appSettings.lastLight) {
      state.lastLight = { ...state.lastLight, ...appSettings.lastLight };
    }
    updateLastLightUIFromState();

    // System info (non-critical display).
    els.batteryLevel.textContent = systemInfo.battery === 'N/A' ? 'N/A' : `${systemInfo.battery}%`;
    const pp = systemInfo.powerPlan;
    els.powerPlan.textContent = (!pp || pp === 'Unknown') ? (systemInfo.battery === 'N/A' ? 'AC Power' : 'Unknown') : pp;

    // Non-critical loaders: isolate each so one failure cannot abort the rest.
    // (Sleep debt and morning proof load from wireEvents, where they are scoped.)
    try { await loadProfiles(); } catch (e) { console.error('loadProfiles failed:', e); }
    try { loadStreaks(); } catch (e) { console.error('loadStreaks failed:', e); }

    // Offer recovery of an interrupted timer
    if (appSettings.recoverableTimer) {
      promptTimerRecovery(appSettings.recoverableTimer);
    }

    // Load Smart Lights config
    if (lightConfig) {
      state.smartLights = {
        enabled: lightConfig.enabled || false,
        provider: lightConfig.provider || 'none',
        mode: lightConfig.mode || 'gradual_dim',
        dimMinutes: lightConfig.dimMinutes || 10,
        hueBridgeIp: lightConfig.hueBridgeIp || '',
        hueUsername: lightConfig.hueUsername || '',
        hueGroupId: lightConfig.hueGroupId || '',
        httpUrl: lightConfig.httpUrl || '',
        httpMethod: lightConfig.httpMethod || 'POST',
        httpBodyTemplate: lightConfig.httpBodyTemplate || '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}'
      };
      updateLightsUIFromState();
    }

    // Load WiFi Guard config
    if (appSettings.wifiGuard) {
      applyWifiGuardSettings(appSettings.wifiGuard);
    }
    // Load Content Blocker config
    if (appSettings.contentBlocker) {
      applyContentBlockerSettings(appSettings.contentBlocker);
    }
    // Load Accountability config
    if (appSettings.accountability) {
      applyAccountabilitySettings(appSettings.accountability);
    }
  } catch (e) {
    console.error('loadInitialData failed:', e);
    els.batteryLevel.textContent = 'N/A';
    els.powerPlan.textContent = previewMode ? 'Preview' : 'AC Power';
  }
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
});

function updateLightsUIFromState() {
  if (els.chkSmartLights) els.chkSmartLights.checked = state.smartLights.enabled;
  if (els.selLightProvider) els.selLightProvider.value = state.smartLights.provider;
  if (els.selLightMode) els.selLightMode.value = state.smartLights.mode;
  if (els.lightDimMinutes) els.lightDimMinutes.value = state.smartLights.dimMinutes;
  if (els.hueBridgeIp) els.hueBridgeIp.value = state.smartLights.hueBridgeIp;
  if (els.hueUsername) els.hueUsername.value = state.smartLights.hueUsername;
  if (els.hueGroupId) els.hueGroupId.value = state.smartLights.hueGroupId;
  if (els.httpUrl) els.httpUrl.value = state.smartLights.httpUrl;
  if (els.httpMethod) els.httpMethod.value = state.smartLights.httpMethod;
  if (els.httpTemplate) els.httpTemplate.value = state.smartLights.httpBodyTemplate;
  updateLightsUI();
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Functions
// ─────────────────────────────────────────────────────────────────────────────

function cycleClockFace() {
  const order = ['digital', 'analog', 'hybrid'];
  const idx = order.indexOf(state.clockFace);
  const next = order[(idx + 1) % order.length];
  state.clockFace = next;
  if (els.czClockFace) els.czClockFace.value = next;
  updateClockStyleVisibility();
  render();
  try { api.saveAppSettings({ app: collectAppSettings() }); } catch (_) { /* no-op */ }
  notify(`Clock face: ${next.charAt(0).toUpperCase() + next.slice(1)}`, 'info');
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
  // Start guided breathing alongside Last Light.
  startGuidedBreathing();
});
api.onOpenSettings(() => {
  syncCustomizeUI();
  updateLastLightUIFromState();
  if (els.optionsModal) els.optionsModal.classList.add('active');
});
api.onBrowserWarning?.(data => {
  if (data?.message) notify(data.message, 'warning', 8000);
});

api.onUpdateAvailable?.(data => {
  if (data?.available && els.badgeUpdate) {
    els.badgeUpdate.style.display = '';
    els.badgeUpdate.textContent = `v${data.latestVersion}`;
    els.badgeUpdate.style.cursor = 'pointer';
    els.badgeUpdate.addEventListener('click', () => {
      api.openExternal?.(data.downloadUrl || data.releaseUrl);
    }, { once: true });
  }
  // Reflect the same result in the About modal's updater status.
  if (data) renderUpdaterStatus(data);
});

els.btnCheckUpdate?.addEventListener('click', runUpdateCheck);

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
setAction(state.action);
loadInitialData().finally(render);
applyAppVersion();
refreshStreakCallout();

checkOnboarding();

// ───────────── Auto-fit window height to content ─────────────
// Keeps the window sized to what is actually shown (no dead space, no forced
// scroll) within a sensible floor and the display work area. Electron only.
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

  let scheduled = false;
  const fit = () => {
    if (scheduled || document.body.classList.contains('mini-mode')) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const h = measure();
      if (h > 0) window.electronAPI.fitWindowHeight(h);
    });
  };

  const dashboard = document.querySelector('.dashboard');
  if (dashboard && 'MutationObserver' in window) {
    let debounce = null;
    const obs = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(fit, 120);
    });
    obs.observe(dashboard, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
  setTimeout(fit, 150);
})();

// Clock Mode: tick the displayed time every second while idle.
(function setupClockTick() {
  setInterval(() => {
    if (!state.running && !state.paused && state.clockMode) render();
  }, 1000);
})();
