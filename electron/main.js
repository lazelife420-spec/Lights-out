const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, globalShortcut, shell, screen, clipboard, session, dialog } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const smartLights = require('./smartLights');
const profiles = require('./profiles');
const profileIdentity = require('./profileIdentity');
const calendar = require('./calendar');
const settingsStore = require('./settings');
const lastLight = require('./lastLight');
const streaks = require('./streaks');
const alarm = require('./alarm');
const updater = require('./updater');
const calProviders = require('./calendarProviders');
const companion = require('./companion');
const companionNetwork = require('./companionNetwork');
const companionFirewall = require('./companionFirewall');
const capabilityTruth = require('./capabilityTruth');
const media = require('./media');
const unsavedGuard = require('./unsavedGuard');
const family = require('./family');
const remoteControl = require('./remoteControl');
const wifiGuard = require('./wifiGuard');
const contentBlocker = require('./contentBlocker');
const accountability = require('./accountability');
const focusSessions = require('./focusSessions');
const screenTime = require('./screenTime');
const sleepDebt = require('./sleepDebt');
const emergencyOverride = require('./emergencyOverride');
const runReceipts = require('./runReceipts');
const idleDetection = require('./idleDetection');
const bedtimeReminder = require('./bedtimeReminder');
const overrideTax = require('./overrideTax');
const autopilot = require('./autopilot');
const ritualMode = require('./ritualMode');
const profileRitualContext = require('./profileRitualContext');
const statsDashboard = require('./statsDashboard');
const smartSuggestions = require('./smartSuggestions');
const windowGeometry = require('./windowGeometry');
const nightModes = require('./nightModes');
const startDecision = require('./startDecision');
const routineModel = require('./routineModel');
const routineLedger = require('./routineLedger').createFileLedger(() => path.join(app.getPath('userData'), 'routine-outcomes.json'));
const routineFiles = require('./routineInterchangeStore').createStore({
  read: () => settingsStore.getSection('calendar'),
  write: calendar => settingsStore.updateSection('calendar', calendar, { requireSave: true }),
  getProfiles: () => profiles.getAll()
});
const handoffService = require('./handoffService');
handoffService.configure(() => require('./handoffController').createController({
  identity: require('./handoffIdentityWindows').createIdentity({directory:path.join(app.getPath('userData'),'routine-handoff')}),
  store: routineFiles
}));
app.on('before-quit', () => handoffService.close());

// Desktop UX Functional Gate instrumentation: only active when an explicit
// proof flag is supplied. Never records in normal production runs.
const DESKTOP_UX_PROOF = process.argv.includes('--desktop-ux-proof') || process.env.LIGHTS_OUT_DESKTOP_UX_GATE === '1';
const SUPPRESS_AUTOMATION_TRAY = DESKTOP_UX_PROOF || process.env.LIGHTS_OUT_SUPPRESS_TRAY === '1';
// QA power lock: automated proof/QA launches must never power-cycle the host,
// even if a run reaches executePowerAction with Test Mode off. It can only
// remove capability (block a real action); it never enables one.
const QA_POWER_LOCK = DESKTOP_UX_PROOF || process.env.LIGHTS_OUT_QA_POWER_LOCK === '1';
const startInvocationLog = [];
const realPowerActionLog = [];

const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
const TRAY_ICON = path.join(__dirname, 'assets', 'tray-32.png');

// Pre-built tray icon variants (generated on first use).
let trayIcons = null;

function writeStartupLog(message, extra) {
  try {
    const logPath = path.join(app.getPath('userData'), 'startup.log');
    const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {
    // Best effort only; startup diagnostics should never block launch.
  }
}

// Without these, an uncaught exception or unhandled promise rejection anywhere
// in the main process (a timer callback, a fire-and-forget network call, a
// stray `await` outside an IPC handler's own try/catch) crashes the entire
// app with no warning -- silently killing whatever shutdown countdown the
// user had running. Node's default for an unhandled 'uncaughtException' is to
// terminate the process; installing a handler suppresses that default and
// keeps the app alive, trading "might run in a slightly inconsistent state"
// for "definitely doesn't lose the user's active timer over an unrelated bug
// in, say, the calendar-fetch code." Log-and-continue is deliberately chosen
// over log-and-exit for that reason.
process.on('uncaughtException', (err) => {
  writeStartupLog('uncaughtException', { message: err && err.message, stack: err && err.stack });
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  writeStartupLog('unhandledRejection', { message: err.message, stack: err.stack });
});

function getPortableExtractionRoot() {
  const exePath = process.execPath;
  const exeDir = path.dirname(exePath);
  const tmpRoot = path.resolve(os.tmpdir());
  const rel = path.relative(tmpRoot, exeDir);
  const exeName = path.basename(exePath).toLowerCase();
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (exeName !== 'lights out.exe') return null;
  if (!fs.existsSync(path.join(exeDir, 'resources', 'app.asar'))) return null;
  return exeDir;
}

function cleanupStalePortableExtracts() {
  const currentRoot = getPortableExtractionRoot();
  if (!currentRoot) return;

  const tmpRoot = path.resolve(os.tmpdir());
  const currentName = path.basename(currentRoot);
  let removed = 0;

  try {
    const entries = fs.readdirSync(tmpRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^3F/i.test(entry.name) || entry.name === currentName) continue;
      const candidate = path.join(tmpRoot, entry.name);
      const candidateExe = path.join(candidate, 'Lights Out.exe');
      const candidateAsar = path.join(candidate, 'resources', 'app.asar');
      if (!fs.existsSync(candidateExe) || !fs.existsSync(candidateAsar)) continue;
      try {
        fs.rmSync(candidate, { recursive: true, force: true });
        removed++;
      } catch (error) {
        writeStartupLog('Failed to remove stale portable extraction', {
          candidate,
          message: error.message
        });
      }
    }
  } catch (error) {
    writeStartupLog('Portable extraction cleanup scan failed', { message: error.message });
    return;
  }

  if (removed > 0) {
    writeStartupLog('Removed stale portable extractions', { removed });
  }
}

async function ensureTrayIcons() {
  if (trayIcons) return trayIcons;
  try {
    const sharp = require('sharp');
    const base16 = await sharp(TRAY_ICON).resize(16, 16).png().toBuffer();

    async function withDot(color, opacity) {
      const dotSvg = `<svg width="16" height="16"><circle cx="13" cy="13" r="3" fill="${color}" opacity="${opacity || 0.9}"/></svg>`;
      const dotBuf = await sharp(Buffer.from(dotSvg)).png().toBuffer();
      return await sharp(base16).composite([{ input: dotBuf, blend: 'over' }]).png().toBuffer();
    }

    // The dot encodes the truth of the active run, not its phase: amber is a
    // Test Mode run (nothing will power off), red is a REAL power action.
    // Phase and pause live in the tooltip.
    const [idle, test, real] = await Promise.all([
      withDot('#6b7685', 0.5),
      withDot('#f5b83d', 0.95),
      withDot('#ff5c7a', 0.95)
    ]);

    trayIcons = {
      idle: nativeImage.createFromBuffer(idle, { width: 16, height: 16 }),
      test: nativeImage.createFromBuffer(test, { width: 16, height: 16 }),
      real: nativeImage.createFromBuffer(real, { width: 16, height: 16 })
    };
  } catch {
    // Fallback: just use the base icon for all states.
    const base = nativeImage.createFromPath(APP_ICON);
    trayIcons = { idle: base, test: base, real: base };
  }
  return trayIcons;
}

let mainWindow;
let widgetWindow = null;
let tray = null;
let miniMode = false;
let widgetMode = false;
let timerInterval = null;
let activeReceiptId = null;
let companionFailureDetails = null;
let companionFailureLookupKey = '';
let companionNetworkFailure = null;
let companionNetworkFingerprint = '';
let companionNetworkMonitor = null;
let companionNetworkPollActive = false;
let remoteControlOperation = Promise.resolve();
let companionFirewallState = { configured: false, error: '', guidance: '' };

const launchOptions = parseLaunchOptions(process.argv);

const timerState = {
  running: false,
  paused: false,
  totalSeconds: 0,
  remainingSeconds: 0,
  action: 'shutdown',
  dryRun: false,
  forceShutdown: false,
  muteSystem: false,
  gracePeriod: 2,
  endsAt: null,
  phase: 'idle',       // idle | focus | dim | lastlight
  origin: 'this-pc',   // display only: where the run was started
  profileId: null,
  profileName: null,
  nightModeId: null,
  nightModeTitle: null,
  nightModeVersion: null
};

// Whether a Content Blocker recurring schedule currently has sites blocked --
// tracked so checkContentBlockerSchedules() only calls block/unblock on an
// actual state transition, not every 60s tick.
let contentBlockerScheduleActive = false;

// Wind-down phase boundaries (fraction of total time remaining).
// Focus: 100% → 25%, Dim: 25% → gracePeriod, Last Light: gracePeriod → 0.
function computePhase(remaining, total, gracePeriod) {
  if (remaining <= 0 || total <= 0) return 'lastlight';
  const graceSeconds = Math.max(0, (gracePeriod || 0) * 60);
  if (remaining <= graceSeconds) return 'lastlight';
  if (remaining / total <= 0.25) return 'dim';
  return 'focus';
}

function parseLaunchOptions(argv) {
  const options = {
    minimized: false,
    noAutoStart: false,
    timerMinutes: 0,
    action: 'shutdown',
    wakeAlarm: false,
    firstLight: false,
    quitAfterStart: false
  };

  for (const arg of argv) {
    const lower = String(arg).toLowerCase();
    if (lower === '--minimized' || lower === '--minimized-to-tray') options.minimized = true;
    if (lower === '--no-auto-start') options.noAutoStart = true;
    if (lower.startsWith('--timer=')) options.timerMinutes = Number(lower.split('=')[1]) || 0;
    if (lower.startsWith('--action=')) options.action = lower.split('=')[1] || 'shutdown';
    if (lower === '--wake-alarm' || lower === '--first-light') options.firstLight = true;
    if (lower === '--test-quit-after-start' || lower.startsWith('--test-quit-after-start=')) {
      options.quitAfterStart = lower === '--test-quit-after-start' ? 1000 : Number(lower.split('=')[1]) || 1000;
    }
  }

  return options;
}

function getRestoredWindowState() {
  const saved = settingsStore.getSection('window') || {};
  return {
    bounds: windowGeometry.clampNormalBounds(saved.bounds, screen),
    maximized: Boolean(saved.maximized)
  };
}

function createWindow() {
  let startupActionsApplied = false;
  let saveWindowStateTimer = null;

  function applyLaunchPresentation(source) {
    if (!mainWindow || mainWindow.isDestroyed() || startupActionsApplied) return;
    startupActionsApplied = true;
    writeStartupLog('Applying launch presentation', { source, minimized: launchOptions.minimized });

    if (launchOptions.minimized) {
      mainWindow.minimize();
      mainWindow.hide();
    } else {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }

    if (launchOptions.timerMinutes > 0 && !launchOptions.noAutoStart) {
      startQuickTimer({ minutes: launchOptions.timerMinutes, action: launchOptions.action, origin: 'launch' });
    }
  }

  const restoredWindowState = miniMode ? { bounds: null, maximized: false } : getRestoredWindowState();
  const windowConfig = miniMode ? {
    width: windowGeometry.MINI_GEOMETRY.width,
    height: windowGeometry.MINI_GEOMETRY.height,
    minWidth: windowGeometry.MINI_GEOMETRY.width,
    minHeight: windowGeometry.MINI_GEOMETRY.height,
    maxWidth: 340,
    maxHeight: 420,
    alwaysOnTop: true,
    resizable: true,
    // UI-R3 Fire 03: the puck's top strip is a drag region, and a Windows
    // double-click on a drag region maximizes -- never for the puck.
    maximizable: false
  } : {
    width: 520,
    height: 800,
    minWidth: windowGeometry.NORMAL_MINIMUM.width,
    minHeight: windowGeometry.NORMAL_MINIMUM.height,
    alwaysOnTop: false,
    resizable: true
  };

  mainWindow = new BrowserWindow({
    ...windowConfig,
    frame: false,
    // Keep the native Windows resize border even though the app draws its own
    // title bar. Without an explicit thick frame, frameless resize handles can
    // be effectively impossible to grab on some Windows configurations.
    thickFrame: true,
    title: 'Lights Out',
    autoHideMenuBar: true,
    show: false,
    // Match the first painted pixels to the night UI so Windows never exposes
    // a bright native surface while Chromium/CSS is still loading.
    backgroundColor: '#0b0f14',
    icon: APP_ICON,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false
    }
  });

  mainWindow.miniMode = miniMode;
  mainWindow.restoredBounds = Boolean(restoredWindowState.bounds);
  if (restoredWindowState.bounds) windowGeometry.applyNormalBounds(mainWindow, restoredWindowState.bounds, screen);
  if (restoredWindowState.maximized) mainWindow.maximize();

  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.miniMode || mainWindow.isFullScreen()) return;
    const maximized = mainWindow.isMaximized();
    const patch = { maximized };
    if (!maximized) patch.bounds = mainWindow.getBounds();
    settingsStore.updateSection('window', patch);
  };
  const scheduleWindowStateSave = () => {
    clearTimeout(saveWindowStateTimer);
    saveWindowStateTimer = setTimeout(saveWindowState, 250);
  };
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('maximize', scheduleWindowStateSave);
  mainWindow.on('unmaximize', scheduleWindowStateSave);

  mainWindow.loadFile('index.html').catch(error => {
    writeStartupLog('loadFile failed', { message: error.message });
  });

  // Hardening: never open arbitrary content in-app. External http(s) links go
  // to the default browser; everything else is denied.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => applyLaunchPresentation('ready-to-show'));
  mainWindow.webContents.once('did-finish-load', () => {
    writeStartupLog('Renderer finished load');
    setTimeout(() => applyLaunchPresentation('did-finish-load-fallback'), 150);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    writeStartupLog('Renderer failed load', { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    writeStartupLog('Renderer process gone', details);
  });
  mainWindow.webContents.on('unresponsive', () => {
    writeStartupLog('Renderer unresponsive');
  });

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || launchOptions.minimized || startupActionsApplied) return;
    applyLaunchPresentation('startup-timeout-fallback');
  }, 3000);

  mainWindow.on('close', event => {
    if (app.isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    refreshTrayMenu();
  });

  // Keep the renderer's fullscreen-clock UI state in sync however fullscreen
  // was exited -- our own Esc/exit-button handler, or an OS-level shortcut
  // (e.g. the taskbar, Alt+Tab away and back) that never went through IPC.
  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('fullscreen-changed', false);
  });

  mainWindow.on('closed', () => {
    clearTimeout(saveWindowStateTimer);
    mainWindow = null;
    if (app.isQuitting) clearTimerInterval();
  });
}

async function createTray() {
  if (SUPPRESS_AUTOMATION_TRAY) return;
  if (tray && !tray.isDestroyed()) return;
  await ensureTrayIcons();
  tray = new Tray(trayIcons.idle);
  refreshTrayMenu();

  updateTrayText();
  tray.on('click', toggleMainWindow);
}

function refreshTrayMenu() {
  if (!tray) return;

  const active = timerState.running || timerState.paused;
  const appDryRun = Boolean((settingsStore.getSection('app') || {}).dryRun);
  const phaseLabel = timerState.phase === 'dim' ? 'Winding Down' : timerState.phase === 'lastlight' ? 'Last Light' : '';
  const statusLine = active
    ? (timerState.paused ? 'Paused' : (phaseLabel || 'Running'))
    : 'Idle';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Lights Out  ·  ${statusLine}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: mainWindow && mainWindow.isVisible() ? 'Hide to Tray' : 'Show Lights Out',
      click: toggleMainWindow
    },
    {
      label: 'Open Settings',
      click: () => {
        if (!mainWindow) return;
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.webContents.send('open-settings');
      }
    },
    { type: 'separator' },
    ...active ? [
      {
        label: timerState.paused ? 'Resume' : 'Pause',
        click: () => (timerState.paused ? resumeTimer() : pauseTimer())
      },
      {
        label: (() => {
          const cost = overrideTax.assessSnoozeCost();
          if (cost.level === 0) return 'Snooze +5 min';
          if (cost.level === 1) return 'Snooze +5 min (logged)';
          if (cost.level >= 2) return `Snooze +5 min (tightens -${cost.tomorrowDebt + 15}m)`;
          return 'Snooze +5 min';
        })(),
        click: () => snoozeTimer(300)
      },
      {
        label: 'Cancel Timer',
        click: cancelTimer
      }
    ] : [
      {
        label: appDryRun ? 'Test Mode · quick starts won’t power off' : 'Real actions on · quick starts shut down',
        enabled: false
      },
      { label: 'Start 28 min', click: () => startQuickTimer({ minutes: 28, origin: 'tray' }) },
      { label: 'Start 1 hour', click: () => startQuickTimer({ minutes: 60, origin: 'tray' }) }
    ],
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function toggleMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  refreshTrayMenu();
}

function showNativeNotification(title, body) {
  if (!Notification.isSupported()) return null;

  const notification = new Notification({
    title,
    body,
    icon: APP_ICON,
    silent: false,
    timeoutType: 'default'
  });
  notification.show();
  return notification;
}

function notifyRemoteAction(message) {
  showNativeNotification('Lights Out', message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('remote-action', { message });
  }
}

function setTaskbarProgress(percent, mode = 'normal') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mode === 'none') {
    mainWindow.setProgressBar(-1);
    return;
  }
  mainWindow.setProgressBar(Math.max(0, Math.min(1, percent / 100)), { mode });
}

function emitTimerUpdate(type, data = {}) {
  const payload = {
    type,
    running: timerState.running,
    paused: timerState.paused,
    totalSeconds: timerState.totalSeconds,
    remainingSeconds: timerState.remainingSeconds,
    total: timerState.totalSeconds,
    remaining: timerState.remainingSeconds,
    action: timerState.action,
    dryRun: timerState.dryRun,
    forceShutdown: timerState.forceShutdown,
    gracePeriod: timerState.gracePeriod,
    endsAt: timerState.endsAt,
    phase: timerState.phase,
    origin: timerState.origin,
    ...data
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer-update', payload);
  }

  updateWidget();
  updateTrayText();
  // Only rebuild the tray context menu on real state transitions, not every
  // tick. Replacing the menu every second can drop a click on an open menu
  // (e.g. Pause), leaving the timer running and the menu stuck on "Pause".
  if (type !== 'tick') refreshTrayMenu();
}

function updateTrayText() {
  if (!tray) return;

  if (!timerState.running && !timerState.paused) {
    const appDryRun = Boolean((settingsStore.getSection('app') || {}).dryRun);
    tray.setToolTip(`Lights Out - idle · ${appDryRun ? 'Test Mode' : 'Real actions on'}`);
    if (trayIcons) tray.setImage(trayIcons.idle);
    return;
  }

  const phaseTag = timerState.phase === 'dim' ? 'Winding Down' : timerState.phase === 'lastlight' ? 'Last Light' : '';
  const prefix = timerState.paused ? 'Paused' : (phaseTag || 'Running');
  tray.setToolTip(`Lights Out - ${prefix}, ${formatTime(timerState.remainingSeconds)} left · ${timerState.dryRun ? 'Test Mode' : 'REAL ' + formatAction(timerState.action)}`);
  if (trayIcons) tray.setImage(timerState.dryRun ? trayIcons.test : trayIcons.real);
}

function clearTimerInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function persistActiveTimer() {
  if (!timerState.running && !timerState.paused) {
    settingsStore.setActiveTimer(null);
    return;
  }
  settingsStore.setActiveTimer({
    action: timerState.action,
    dryRun: timerState.dryRun,
    forceShutdown: timerState.forceShutdown,
    muteSystem: timerState.muteSystem,
    gracePeriod: timerState.gracePeriod,
    totalSeconds: timerState.totalSeconds,
    remainingSeconds: timerState.remainingSeconds,
    paused: timerState.paused,
    endsAt: timerState.endsAt,
    origin: timerState.origin,
    routineOccurrenceKey: timerState.routineOccurrenceKey || null,
    savedAt: new Date().toISOString(),
    // Correlates this recovery snapshot to its run receipt so startup
    // reconciliation can tell a still-recoverable run apart from a truly
    // orphaned one, and so resuming it reuses the same receipt.
    receiptId: activeReceiptId
  });
}

function getRecoverableTimer() {
  const snapshot = settingsStore.getActiveTimer();
  if (!snapshot || !snapshot.endsAt) return null;
  const remainingMs = new Date(snapshot.endsAt).getTime() - Date.now();
  const remainingSeconds = snapshot.paused
    ? Math.max(0, Math.round(snapshot.remainingSeconds || 0))
    : Math.max(0, Math.round(remainingMs / 1000));
  if (remainingSeconds <= 0) {
    settingsStore.setActiveTimer(null);
    return null;
  }
  return { ...snapshot, remainingSeconds };
}

function normalizeTimerOptions(input, legacyAction) {
  // Where a run came from, for display only (no behavior depends on it).
  // Inline on purpose: test/test-mode-inheritance.test.js runs this function
  // in a vm context that only provides settingsStore.
  const RUN_ORIGINS = ['this-pc', 'schedule', 'calendar', 'autopilot', 'shortcut', 'tray', 'launch', 'ritual', 'phone', 'family', 'resume'];
  if (typeof input === 'number') {
    // The legacy numeric form follows the same Test Mode rule as an object
    // that omits dryRun: it inherits the persisted setting, never REAL by default.
    return {
      durationSeconds: Math.max(1, Math.round(input * 60)),
      action: legacyAction || 'shutdown',
      dryRun: Boolean((settingsStore.getSection('app') || {}).dryRun),
      forceShutdown: false,
      origin: 'this-pc'
    };
  }

  const options = input || {};
  const durationSeconds = Number(options.durationSeconds)
    || (Number(options.minutes) * 60)
    || (Number(options.seconds))
    || 60;

  return {
    durationSeconds: Math.max(1, Math.round(durationSeconds)),
    action: options.action || legacyAction || 'shutdown',
    // An omitted dryRun inherits the user's Test Mode setting. It used to
    // become false, so calendar auto-start, the Schedule "Start" buttons, the
    // tray quick starts, the global quick-start shortcuts and the launch
    // timer armed REAL power actions even with Test Mode on.
    dryRun: options.dryRun === undefined
      ? Boolean((settingsStore.getSection('app') || {}).dryRun)
      : Boolean(options.dryRun),
    forceShutdown: Boolean(options.forceShutdown),
    muteSystem: Boolean(options.muteSystem),
    // An omitted grace stays undefined so beginValidatedCountdown inherits the
    // user's graceMinutes setting (quick starts and calendar auto-start used to
    // get a fixed 2 min here, while Begin Ritual and autopilot honoured it).
    gracePeriod: options.gracePeriod !== undefined && options.gracePeriod !== null && Number.isFinite(Number(options.gracePeriod))
      ? Math.max(0, Number(options.gracePeriod))
      : undefined,
    profileId: typeof options.profileId === 'string' ? options.profileId : null,
    source: options.source === 'remote' ? 'remote' : 'local',
    startOrigin: typeof options.startOrigin === 'string' ? options.startOrigin : null,
    nightModeId: typeof options.nightModeId === 'string' ? options.nightModeId : null,
    origin: RUN_ORIGINS.includes(options.origin) ? options.origin : 'this-pc',
    // Set only by resume-recoverable-timer, to reuse the original receipt
    // instead of creating a duplicate for the same run.
    resumeReceiptId: typeof options.resumeReceiptId === 'string' ? options.resumeReceiptId : null
  };
}

function resolveTimerProfileIdentity(profileId, source, origin) {
  const appSettings = settingsStore.getSection('app') || {};
  return profileIdentity.resolveTimerProfileIdentity({
    source,
    requestedProfileId: profileId,
    fallbackProfileId: ['calendar', 'schedule'].includes(origin) ? null : appSettings.lastSelectedProfileId,
    getProfileById: profiles.getById
  });
}

// Delegate to nightModes module (single source of truth for canonical resolution).
const resolveNightModeStart = nightModes.resolveNightModeStart;

// A guided ritual counts as an active run only until its timer step hands off
// to a countdown. From then on the countdown itself (timerState) is the run.
// ritualMode keeps the ritual 'active' on its timer and lights steps until
// someone clicks through the overlay, so without this a ritual whose countdown
// had already completed or been cancelled kept refusing autopilot, calendar,
// tray and shortcut starts with a false "already active" message.
function ritualAwaitingCountdown() {
  const ritual = ritualMode.getState() || {};
  if (!ritual.active) return false;
  const currentId = ritual.currentStepInfo && ritual.currentStepInfo.id;
  const passed = [...(ritual.completedSteps || []), ...(ritual.skippedSteps || [])];
  return currentId !== 'timer' && !passed.includes('timer');
}

// One Lights Out run at a time: a countdown (running or paused) or a guided
// ritual that has not reached its timer step yet.
function isRunActive() {
  return Boolean(timerState.running || timerState.paused || ritualAwaitingCountdown());
}

const UNATTENDED_RUN_ORIGINS = ['calendar', 'autopilot', 'shortcut', 'tray', 'launch'];

function startTimer(input, legacyAction, routineOccurrenceKey = null) {
  const options = normalizeTimerOptions(input, legacyAction);
  // Internal dispatcher argument only; renderer/remote input cannot attach
  // an arbitrary run to a claimed calendar occurrence.
  options.routineOccurrenceKey = routineOccurrenceKey;
  if (['calendar','schedule'].includes(options.origin) && options.profileId && !profiles.getById(options.profileId)) {
    return { success: false, code: 'PROFILE_UNAVAILABLE', error: 'The scheduled routine is no longer available. Choose another routine.' };
  }
  // Single-run policy: no start may silently replace an active countdown, and
  // an unattended start (calendar, autopilot, shortcut, tray, launch) never
  // replaces a ritual someone is walking through. A person's own local start
  // still supersedes a ritual that has no countdown yet (see below).
  // (Ritual timer steps never come through here: they call
  // beginValidatedCountdown directly, so every caller of startTimer is refused.)
  if (timerState.running || timerState.paused
    || (UNATTENDED_RUN_ORIGINS.includes(options.origin) && ritualAwaitingCountdown())) {
    return { success: false, code: 'RUN_ACTIVE', error: 'A Lights Out run is already active. Stop it before starting another.' };
  }
  const identity = resolveTimerProfileIdentity(options.profileId, options.source, options.origin);
  const profile = profiles.getById(identity.profileId);
  const nmIdentity = resolveNightModeStart(options);
  const decision = startDecision.resolveStartDecision({ options, identity, profile, nmIdentity });

  // Standard Ritual Gateway: the canonical Night Mode (or profile fallback)
  // decides the execution path. The selected mode controls 'what happens';
  // the profile only supplies 'who' when no mode is armed.
  if (decision.useRitualGateway) {
    profileRitualContext.clear();
    const runToken = profileRitualContext.createContext({
      durationSeconds: options.durationSeconds,
      action: options.action,
      dryRun: options.dryRun,
      forceShutdown: options.forceShutdown,
      muteSystem: options.muteSystem,
      gracePeriod: options.gracePeriod,
      profileId: identity.profileId,
      profileName: identity.profileName,
      nightModeId: nmIdentity.nightModeId,
      nightModeTitle: nmIdentity.nightModeTitle,
      nightModeVersion: nmIdentity.nightModeVersion,
      origin: options.origin,
      routineOccurrenceKey: options.routineOccurrenceKey
    });
    // Start the standard ritual with run metadata binding the token to this
    // exact run. The ritual's onStep/onComplete callbacks receive the meta.
    // remoteOrigin marks runs with nobody physically at the desktop to click
    // through the guided overlay (every step, including "auto" ones, normally
    // requires a click) -- ritualMode fast-forwards those instead of getting
    // stuck on the first step forever.
    const ritual = ritualMode.startRitual(null, { profileRitualToken: runToken, routineOccurrenceKey, waitForTimedSteps: options.origin === 'calendar',
      remoteOrigin: options.source === 'remote' || options.origin === 'calendar' });
    // UI-R3 Fire 08: a ritual that did not start is an honest failure, never
    // a phantom countdown: the pending context is dropped and the caller
    // hears why. Nothing else in this path (the single-run policy, the direct
    // path) changes.
    // "Started" is judged from evidence, not from the post-call active flag
    // alone: a remote-origin run fast-forwards every step synchronously inside
    // startRitual (its timer step really arms the countdown), so it returns
    // active:false having run. The countdown that is now live proves it.
    const ritualStarted = Boolean(ritual && ritual.active === true)
      || Boolean(timerState.running || timerState.paused);
    if (!ritualStarted) {
      profileRitualContext.clear();
      if (!ritual || ritual.reason === 'disabled') {
        return {
          success: false,
          code: 'RITUAL_DISABLED',
          error: 'The guided ritual is turned off in Settings › Automations. Turn it on, or pick a mode that starts directly.'
        };
      }
      return {
        success: false,
        code: 'RITUAL_NOT_STARTED',
        error: 'The guided ritual could not start its countdown. Nothing is running.'
      };
    }
    return { success: true, ritualStarted: true };
  }

  // Direct timer supersession: if a profile ritual is in progress, a genuine
  // non-ritual direct start cancels it and clears pending context.
  // The ritual's own timer step uses beginValidatedCountdown() directly and
  // never reaches this path.
  if (options.source !== 'ritual' && ritualMode.getState().active) {
    ritualMode.cancelRitual();
  }
  if (options.source !== 'ritual') {
    profileRitualContext.clear();
  }

  // Direct countdown: canonical Night Mode (ritualId: none) or no mode at all.
  return beginValidatedCountdown(options, identity, nmIdentity);
}

// Quick starts with nobody looking at the main window (tray items, global
// shortcuts, the launch timer). They refuse while a run is active and announce
// a start only when it really started, stating Test Mode or the REAL action.
function startQuickTimer({ minutes, action = 'shutdown', origin }) {
  if (isRunActive()) {
    showNativeNotification('Lights Out', 'A Lights Out run is already active. Pause or cancel it first.');
    return { success: false, code: 'RUN_ACTIVE' };
  }
  const result = startTimer({ durationSeconds: minutes * 60, action, origin });
  if (result && result.success) {
    const dryRun = result.state && typeof result.state.dryRun === 'boolean'
      ? result.state.dryRun
      : Boolean((settingsStore.getSection('app') || {}).dryRun);
    showNativeNotification('Lights Out', dryRun
      ? `${minutes} min Test Mode timer started. Nothing will power off.`
      : `${formatAction(action)} in ${minutes} min. Cancel with Ctrl+Shift+X or the tray.`);
  }
  return result;
}

// Internal canonical countdown entry. Used by both startTimer (after gateway
// resolution and supersession) and the ritual timer step (directly, without
// re-entering profile ritual gating or supersession logic).
// nmIdentity: main-resolved { nightModeId, nightModeTitle, nightModeVersion }.
function beginValidatedCountdown(options, identity, nmIdentity) {
  clearTimerInterval();

  // Override Tax: reset session snooze count for this new run.
  overrideTax.resetSession();

  // Override Tax: apply yesterday's debt (timer tightening from past snooze abuse).
  const debtSeconds = overrideTax.consumeDebt() * 60;
  if (debtSeconds > 0 && options.durationSeconds > debtSeconds + 300) {
    // Only apply if it leaves at least 5 min — never make the timer useless.
    options.durationSeconds -= debtSeconds;
  }

  timerState.running = true;
  timerState.paused = false;
  timerState.totalSeconds = options.durationSeconds;
  timerState.remainingSeconds = options.durationSeconds;
  timerState.action = options.action;
  // Defense in depth at the single countdown entry: a countdown can never
  // carry a non-boolean dryRun (the renderer ignores one and would keep
  // showing the old mode). Anything not stated inherits Test Mode, and the
  // grace warning falls back to the user's setting.
  const appSettings = settingsStore.getSection('app') || {};
  timerState.dryRun = typeof options.dryRun === 'boolean' ? options.dryRun : Boolean(appSettings.dryRun);
  timerState.forceShutdown = Boolean(options.forceShutdown);
  timerState.muteSystem = Boolean(options.muteSystem);
  const graceOption = options.gracePeriod === undefined || options.gracePeriod === null ? NaN : Number(options.gracePeriod);
  const graceSetting = appSettings.graceMinutes === undefined || appSettings.graceMinutes === null ? NaN : Number(appSettings.graceMinutes);
  timerState.gracePeriod = Number.isFinite(graceOption) ? Math.max(0, graceOption)
    : Number.isFinite(graceSetting) ? Math.max(0, graceSetting) : 2;
  timerState.origin = typeof options.origin === 'string' ? options.origin : 'this-pc';
  timerState.routineOccurrenceKey = options.routineOccurrenceKey || null;
  timerState.profileId = identity.profileId;
  timerState.profileName = identity.profileName;
  const nm = nmIdentity || { nightModeId: null, nightModeTitle: null, nightModeVersion: null };
  timerState.nightModeId = nm.nightModeId || null;
  timerState.nightModeTitle = nm.nightModeTitle || null;
  timerState.nightModeVersion = nm.nightModeVersion || null;
  timerState.endsAt = new Date(Date.now() + options.durationSeconds * 1000).toISOString();
  timerState.phase = 'focus';

  emitTimerUpdate('started');
  // Create a run receipt for this timer session -- unless this is
  // resume-recoverable-timer resuming a run whose receipt is still
  // 'running' from before a restart, in which case reuse it rather than
  // creating a duplicate receipt for the same run.
  const resumedReceipt = options.resumeReceiptId ? runReceipts.getReceiptById(options.resumeReceiptId) : null;
  // Safety net: the single-run guards should make this unreachable, but a
  // receipt that is still 'running' and is not the one being resumed must be
  // closed honestly rather than left orphaned.
  if (activeReceiptId && (!resumedReceipt || resumedReceipt.id !== activeReceiptId)) {
    const previous = runReceipts.getReceiptById(activeReceiptId);
    if (previous && previous.result === 'running') {
      runReceipts.updateRunReceipt(activeReceiptId, { result: 'cancelled', cancelReason: 'superseded', endedAt: new Date().toISOString() });
    }
    activeReceiptId = null;
  }
  if (resumedReceipt && resumedReceipt.result === 'running') {
    activeReceiptId = resumedReceipt.id;
  } else {
    const receipt = runReceipts.createRunReceipt(timerState);
    activeReceiptId = receipt.id;
  }
  if (timerState.routineOccurrenceKey) {
    try { routineLedger.timerStarted(timerState.routineOccurrenceKey, activeReceiptId); }
    catch (error) { console.error('[routine-timer-correlation]', error); }
  }
  // Send screen time reality check to renderer.
  screenTime.getScreenTimeToday().then(st => {
    const msg = screenTime.getRealityCheckMessage(st);
    if (msg && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reality-check', { message: msg, screenTime: st });
    }
  }).catch(() => {});
  // Accountability: notify partner that wind-down started.
  sendAccountability('TIMER_STARTED');
  persistActiveTimer();
  setTaskbarProgress(100, 'normal');

  timerInterval = setInterval(() => {
    if (!timerState.running || timerState.paused) return;

    timerState.remainingSeconds = Math.max(0, Math.round((new Date(timerState.endsAt).getTime() - Date.now()) / 1000));
    const percent = timerState.totalSeconds > 0
      ? (timerState.remainingSeconds / timerState.totalSeconds) * 100
      : 0;

    // Phase transition detection
    const prevPhase = timerState.phase;
    timerState.phase = computePhase(timerState.remainingSeconds, timerState.totalSeconds, timerState.gracePeriod);
    if (timerState.phase !== prevPhase) {
      emitTimerUpdate('phase', { phase: timerState.phase, from: prevPhase, percent });
      if (timerState.phase === 'dim') applyDimPhase(timerState.remainingSeconds, timerState.totalSeconds);
      updateTrayText();
    }

    // During dim phase, progressively reduce window opacity for a visual wind-down.
    if (timerState.phase === 'dim' && mainWindow && !mainWindow.isDestroyed()) {
      const dimFraction = timerState.remainingSeconds / (timerState.totalSeconds * 0.25);
      // Floor 0.88 (was 0.55): the in-app .env-dark layer does the darkening,
      // so the window never goes see-through behind the truth pill or dialogs.
      const opacity = 0.88 + 0.12 * Math.max(0, Math.min(1, dimFraction));
      mainWindow.setOpacity(opacity);
    }

    // Smart Lights integration
    if (smartLights.shouldStartDim(timerState.remainingSeconds)) {
      smartLights.startSmartLightDim(timerState.remainingSeconds);
    }
    if (smartLights.getConfig().enabled) {
      smartLights.updateSmartLightTick(timerState.remainingSeconds);
    }

    emitTimerUpdate('tick', { percent, phase: timerState.phase });
    updateWidget();
    // Red taskbar only for a REAL action; a Test Mode run never turns it red.
    setTaskbarProgress(percent, !timerState.dryRun && percent <= 10 ? 'error' : 'normal');

    if (timerState.gracePeriod > 0 && timerState.remainingSeconds === timerState.gracePeriod * 60) {
      const warningMessage = timerState.dryRun
        ? `Test Mode: ${formatAction(timerState.action)} would run in ${timerState.gracePeriod} min. Nothing will power off.`
        : `${formatAction(timerState.action)} in ${timerState.gracePeriod} minutes`;
      emitTimerUpdate('warning', {
        message: warningMessage
      });
      // Record warning in receipt.
      if (activeReceiptId) runReceipts.receiptWarning(activeReceiptId);
      // Fire-and-forget browser awareness check.
      getOpenBrowsers().then(browsers => {
        if (browsers.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
          const names = browsers.map(b => `${b.name} (${b.windowCount})`).join(', ');
          mainWindow.webContents.send('browser-warning', { browsers, message: `Open browsers detected: ${names}. Save your work!` });
        }
      }).catch(() => {});
    }

    if (timerState.remainingSeconds <= 0) {
      completeTimer();
    }
  }, 1000);

  return { success: true, state: { ...timerState } };
}

function pauseTimer() {
  if (!timerState.running || timerState.paused) return { success: false };
  timerState.paused = true;
  if (activeReceiptId) runReceipts.receiptPaused(activeReceiptId);
  emitTimerUpdate('paused');
  persistActiveTimer();
  setTaskbarProgress(
    timerState.totalSeconds > 0 ? (timerState.remainingSeconds / timerState.totalSeconds) * 100 : 0,
    'paused'
  );
  return { success: true, state: { ...timerState } };
}

function resumeTimer() {
  if (!timerState.running || !timerState.paused) return { success: false };
  timerState.paused = false;
  timerState.endsAt = new Date(Date.now() + timerState.remainingSeconds * 1000).toISOString();
  if (activeReceiptId) runReceipts.updateRunReceipt(activeReceiptId, { notes: 'Resumed' });
  emitTimerUpdate('resumed');
  persistActiveTimer();
  return { success: true, state: { ...timerState } };
}

function snoozeTimer(seconds = 300, reason) {
  if (!timerState.running && !timerState.paused) return { success: false };
  const addSeconds = Math.max(1, Math.round(Number(seconds) || 300));

  // Override Tax: record snooze and apply escalating costs.
  const taxResult = overrideTax.recordSnooze(reason);

  timerState.totalSeconds += addSeconds;
  timerState.remainingSeconds += addSeconds;
  timerState.endsAt = new Date(Date.now() + timerState.remainingSeconds * 1000).toISOString();
  emitTimerUpdate('snoozed', { addedSeconds: addSeconds, tax: taxResult });
  if (activeReceiptId) runReceipts.receiptSnoozed(activeReceiptId);

  // Override Tax: notify accountability partner on escalated snoozes.
  if (taxResult.level >= 1) {
    sendAccountability('TIMER_SNOOZED', { addedSeconds: addSeconds, snoozeNumber: taxResult.snoozeNumber, taxLevel: taxResult.level });
  } else {
    sendAccountability('TIMER_SNOOZED', { addedSeconds: addSeconds });
  }

  return { success: true, state: { ...timerState }, tax: taxResult };
}

function cancelTimer() {
  clearTimerInterval();
  timerState.running = false;
  timerState.paused = false;
  timerState.remainingSeconds = 0;
  timerState.endsAt = null;
  timerState.phase = 'idle';
  setTaskbarProgress(0, 'none');
  if (smartLights.getConfig().enabled && smartLights.getConfig().provider === 'wiz') {
    smartLights.restoreWizOriginalState().then(res => {
      if (!res.success) console.warn('Some WiZ lights could not be restored after cancel.');
    }).catch(() => console.warn('WiZ restore after cancel failed.'));
  }
  // Cancellation restores the Hue state captured at dim start (desktop or
  // phone cancel alike — they converge here). Failure is surfaced, not fatal.
  if (smartLights.getConfig().enabled && smartLights.getConfig().provider === 'hue') {
    smartLights.restoreHueOriginalState().then(res => {
      if (!res.success) console.warn(`Smart light restore after cancel: ${res.message}`);
    }).catch(err => console.warn('Smart light restore after cancel failed:', err.message));
  }
  smartLights.resetSmartLightState();
  persistActiveTimer();
  restoreAfterTimer();
  emitTimerUpdate('cancelled');
  // Update receipt: cancelled.
  if (activeReceiptId) {
    runReceipts.updateRunReceipt(activeReceiptId, {
      endedAt: new Date().toISOString(),
      remainingSeconds: timerState.remainingSeconds,
      result: 'cancelled'
    });
    activeReceiptId = null;
  }
  sendAccountability('TIMER_CANCELLED');
  return { success: true };
}

async function completeTimer() {
  clearTimerInterval();
  timerState.running = false;
  timerState.paused = false;
  timerState.remainingSeconds = 0;
  timerState.endsAt = null;
  timerState.phase = 'idle';
  setTaskbarProgress(0, 'none');
  persistActiveTimer();
  restoreAfterTimer();
  
  // Turn off smart lights at timer completion
  if (smartLights.getConfig().enabled) {
    await smartLights.invokeSmartLightOff();
    smartLights.resetSmartLightState();
  }
  
  emitTimerUpdate('complete', { message: 'Timer complete' });
  showNativeNotification('Lights Out', timerState.dryRun
    ? `Test Mode complete: ${formatAction(timerState.action)} skipped.`
    : `Timer complete: ${formatAction(timerState.action)} now.`);

  let rec = null;
  try { rec = activeReceiptId ? runReceipts.getReceiptById(activeReceiptId) : null; } catch { /* best-effort */ }
  // Record a streak event for the completed ritual.
  // Only REAL completions feed the routine record (streak, completed runs,
  // achievements, bedtime-deficit estimate). Test Mode runs stay in Proof via
  // their dry_run_completed receipt below and never count as a kept night.
  if (!timerState.dryRun) {
    try { streaks.recordEvent(null, timerState.action, Boolean(rec && rec.snoozeCount > 0)); } catch (e) {
      console.error('Failed to record streak event:', e);
    }
    // Record an app-timer estimate only; this is not measured sleep.
    try {
      const appSettings = settingsStore.getSection('app') || {};
      const bedTime = new Date().toTimeString().slice(0, 5);
      const estimated = sleepDebt.estimateSleepHours(bedTime, appSettings.wakeTime || '07:00');
      sleepDebt.recordNight(bedTime, appSettings.wakeTime || '07:00', estimated);
    } catch (e) {
      console.error('Failed to record estimated bedtime deficit:', e);
    }
  }
  // Update receipt: completing.
  if (activeReceiptId) {
    runReceipts.updateRunReceipt(activeReceiptId, {
      endedAt: new Date().toISOString(),
      remainingSeconds: 0,
      result: timerState.dryRun ? 'dry_run_completed' : 'completing',
      lastLightSequence: settingsStore.getSection('lastLight')?.sequence || null
    });
  }
  sendAccountability('TIMER_COMPLETE');

  // Unsaved work guardian: check for unsaved work before power action.
  if (!timerState.dryRun) {
    try {
      const unsaved = await unsavedGuard.scanUnsavedWork();
      if (unsaved.length > 0) {
        const titles = unsaved.map(w => `"${w.title}" (${w.process})`).join(', ');
        showNativeNotification('Lights Out', `Unsaved work detected: ${titles}. Save before shutdown!`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('unsaved-work-warning', { warnings: unsaved });
        }
        // Delay the power action by 10 seconds to give the user time to save.
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } catch { /* best-effort */ }
  }

  await playLastLightRitual(timerState.dryRun);
  await executePowerAction({ ...timerState });
}

// Plays the Last Light finale in the renderer before the power action fires.
// Only delays when enabled and the window is visible, so a hidden/idle app
// never holds up the shutdown.
function playLastLightRitual(dryRun) {
  const cfg = settingsStore.getSection('lastLight') || {};
  if (!cfg.enabled) return Promise.resolve();
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return Promise.resolve();

  const sequence = lastLight.normalizeId(cfg.sequence);
  const durationMs = lastLight.getDurationMs(sequence, Boolean(dryRun));
  // action/forceShutdown let the finale state the real consequence
  // ("REAL ACTION · Shutdown when this ends") instead of guessing.
  mainWindow.webContents.send('play-last-light', {
    sequence,
    dryRun: Boolean(dryRun),
    sound: cfg.sound,
    action: timerState.action,
    forceShutdown: Boolean(timerState.forceShutdown)
  });
  return new Promise(resolve => setTimeout(resolve, durationMs + 300));
}

// What this run's wind-down actually changed, so restoreAfterTimer undoes only
// that. The media key is a play/pause TOGGLE: restoreAfterTimer used to send it
// on every stop, cancel and completion, so when Lights Out had paused nothing
// it paused whatever the user was playing. Removing the Night Light value when
// this app never set it could likewise switch off the user's own Night Light.
// mediaPause holds this run's pause attempt (resolves to { count }).
const windDownChanges = { mediaPause: null, nightLightSet: false };

// Applies the dim-phase visual wind-down.
// Enables Windows Night Light (blue-light filter) via registry if the
// customization setting is on, and tells the renderer to warm the UI.
function applyDimPhase(remainingSeconds, totalSeconds) {
  const appSettings = settingsStore.getSection('app') || {};
  if (appSettings.nightLightOnDim === true) {
    windDownChanges.nightLightSet = true;
    // Enable Windows Night Light (blue-light filter) during dim phase.
    executePowerShell(
      'Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.bluelightreduction\\windows.data.bluelightreduction.bluelightreductionstate" -Name "Data" -Value ([byte[]](2,0,0,0) ) -ErrorAction SilentlyContinue'
    ).catch(() => { /* Night Light registry path may not exist on all systems */ });
  }
  // Focus mode: close distracting apps during dim phase.
  applyFocusMode(true);
  // Media auto-pause: pause detected media players during dim phase.
  if (appSettings.pauseMediaOnDim === true && !windDownChanges.mediaPause) {
    windDownChanges.mediaPause = media.pauseAllDetectedMedia().then(result => {
      if (result.count > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media-paused', { players: result.paused });
      }
      return result;
    }).catch(() => ({ count: 0 }));
  }
  // WiFi Guard: block internet for kids during dim phase.
  const wifiConfig = settingsStore.getSection('wifiGuard');
  if (wifiConfig && wifiConfig.enabled && wifiConfig.blockOnDim !== false) {
    wifiGuard.blockInternet(wifiConfig).then(result => {
      if (result.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wifi-guard-status', { blocked: true, provider: result.provider });
      }
    }).catch(() => {});
  }
  // Content Blocker: block distracting websites during dim phase.
  const cbConfig = settingsStore.getSection('contentBlocker');
  if (cbConfig && cbConfig.enabled && cbConfig.blockOnDim !== false) {
    const sites = (cbConfig.useDefault !== false) ? contentBlocker.DEFAULT_BLOCKLIST : (cbConfig.blocklist || []);
    contentBlocker.blockSites(sites).then(result => {
      if (result.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('content-blocked', { sites: result.sites, blocked: true });
      }
    }).catch(() => {});
  }
  // Progressive screen lockout: make window always-on-top and hide menu during dim.
  if (appSettings.lockoutOnDim === true && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setMenuBarVisibility(false);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dim-phase-started', { remainingSeconds, totalSeconds });
  }
}

// Focus mode: close configurable distracting apps during wind-down.
function applyFocusMode(enable) {
  const appSettings = settingsStore.getSection('app') || {};
  const blocklist = appSettings.focusBlocklist || [];
  if (!blocklist.length) return;

  if (enable) {
    // Gracefully close each blocked app. Process names are interpolated into a
    // PowerShell string, and the blocklist can arrive via imported config, so
    // restrict each entry to safe process-name characters to prevent injection.
    const safe = blocklist
      .filter(proc => typeof proc === 'string' && /^[A-Za-z0-9 ._-]+$/.test(proc));
    if (!safe.length) return;
    const cmd = safe.map(proc =>
      `Get-Process -Name '${proc}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { $_.CloseMainWindow() | Out-Null }`
    ).join('; ');
    executePowerShell(cmd).catch(() => {});
  }
  // On disable, we don't restart the apps (the user will reopen what they need).
}

function restoreAfterTimer() {
  // Restore window opacity.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(1);
  // Tell renderer to end dim phase.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dim-phase-ended');
  // Disable Windows Night Light, only if this run's wind-down turned it on.
  if (windDownChanges.nightLightSet) {
    windDownChanges.nightLightSet = false;
    executePowerShell(
      'Remove-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.bluelightreduction\\windows.data.bluelightreduction.bluelightreductionstate" -Name "Data" -ErrorAction SilentlyContinue'
    ).catch(() => {});
  }
  // Resume media only if this run's wind-down actually paused a player. The
  // pause may still be in flight (cancel right after dim starts), so wait for it.
  const mediaPause = windDownChanges.mediaPause;
  windDownChanges.mediaPause = null;
  if (mediaPause) {
    mediaPause.then(result => (result && result.count > 0 ? media.resumeAllMedia() : null)).catch(() => {});
  }
  // Restore WiFi access if WiFi Guard was active.
  const wifiConfig = settingsStore.getSection('wifiGuard');
  if (wifiConfig && wifiConfig.enabled && wifiConfig.unblockOnCancel !== false) {
    wifiGuard.unblockInternet(wifiConfig).then(result => {
      if (result.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wifi-guard-status', { blocked: false, provider: result.provider });
      }
    }).catch(() => {});
  }
  // Unblock distracting websites -- but not if a recurring schedule
  // (independent of this timer) still wants them blocked right now.
  const cbConfig = settingsStore.getSection('contentBlocker');
  if (cbConfig && cbConfig.enabled && cbConfig.unblockOnComplete !== false) {
    if (!contentBlocker.isAnyScheduleActive(cbConfig.schedules, new Date())) {
      contentBlocker.unblockSites().catch(() => {});
    }
  }
  // Undo progressive lockout: restore normal window behavior. The window is
  // created with autoHideMenuBar:true, so re-show the bar (Alt-accessible) here
  // rather than leaving it force-hidden from the dim-phase lockout.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMenuBarVisibility(true);
  }
}

// First Light: the morning bookend to Last Light.
// Gradually increases window opacity from 0 to 1 over FIRST_LIGHT_DURATION
// seconds, simulating a sunrise. Called when the app launches via the
// --first-light scheduled task.
const FIRST_LIGHT_DURATION = 60; // 60 seconds of gradual brightening

function playFirstLight() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.setOpacity(0);
  mainWindow.webContents.send('first-light-started');

  // Smart Light Sunrise: gradually brighten room lights during First Light.
  const slConfig = smartLights.getConfig();
  if (slConfig.enabled) {
    const sunriseTickSeconds = 5;
    const totalSunriseSteps = Math.max(1, Math.ceil(FIRST_LIGHT_DURATION / sunriseTickSeconds));
    let sunriseStep = 0;
    const sunriseManualOff = new Set();
    const slInterval = setInterval(() => {
      sunriseStep++;
      const progress = Math.min(1, sunriseStep / totalSunriseSteps);
      const brightness = Math.round(progress * 254);
      const colorTemp = Math.round(500 - (progress * 250));
      smartLights.invokeSmartLightAction({
        on: true,
        brightness,
        colorTemp,
        preservePower: sunriseStep > 1,
        released: sunriseManualOff,
        transitionTime: sunriseTickSeconds * 10
      }).catch(() => {});
      if (sunriseStep >= totalSunriseSteps) clearInterval(slInterval);
    }, sunriseTickSeconds * 1000);
  }

  // Morning Routine: send briefing data to renderer.
  setTimeout(async () => {
    try {
      const calSettings = settingsStore.getSection('calendar') || {};
      const events = await calProviders.fetchAllEvents(calSettings, new Date(), 1);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('morning-briefing', {
          events: (events || []).slice(0, 5),
          sleepDebt: sleepDebt.getDebtSummary(),
          streaks: streaks.getSummary()
        });
      }
    } catch (e) {
      console.error('Failed to send morning briefing:', e);
    }
  }, 5000);

  let elapsed = 0;
  const interval = setInterval(() => {
    elapsed++;
    const progress = Math.min(1, elapsed / FIRST_LIGHT_DURATION);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setOpacity(progress);
      mainWindow.webContents.send('first-light-tick', { progress, elapsed });
    }
    if (elapsed >= FIRST_LIGHT_DURATION) {
      clearInterval(interval);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(1);
        mainWindow.webContents.send('first-light-ended');
      }
      // Clean up the scheduled task after it fires.
      alarm.removeWakeAlarm().catch(() => {});
    }
  }, 1000);
}

function formatAction(action) {
  const labels = {
    shutdown: 'Shutdown',
    restart: 'Restart',
    sleep: 'Sleep',
    hibernate: 'Hibernate',
    lock: 'Lock',
    logout: 'Log out'
  };
  return labels[action] || 'Power action';
}

// ─────────────────────────────────────────────────────────────────────────────
// Accountability Partner: notify on timer events
// ─────────────────────────────────────────────────────────────────────────────

function sendAccountability(eventType, extra = {}) {
  const accConfig = settingsStore.getSection('accountability');
  if (!accConfig || !accConfig.enabled) return;
  // Only send for events the user has enabled.
  const eventMap = {
    'TIMER_STARTED': accConfig.notifyOnStart,
    'TIMER_SNOOZED': accConfig.notifyOnSnooze,
    'TIMER_CANCELLED': accConfig.notifyOnCancel,
    'TIMER_COMPLETE': accConfig.notifyOnComplete
  };
  if (eventMap[eventType] === false) return;
  const appSettings = settingsStore.getSection('app') || {};
  accountability.notifyPartner(eventType, {
    config: accConfig,
    timerName: appSettings.timerName || 'Last Call',
    remainingSeconds: timerState.remainingSeconds,
    phase: timerState.phase,
    // Partners must never read a Test Mode run as a real completion.
    testMode: timerState.dryRun === true,
    ...extra
  }).catch(() => {}); // best-effort, never block
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Auto-Start: zero-friction timer from calendar events.
// ─────────────────────────────────────────────────────────────────────────────

// Only auto-start for events that are clearly Lights Out / bedtime events.
// Matches title containing these keywords (case-insensitive).
const AUTO_START_KEYWORDS = ['lights out', 'bedtime', 'wind down', 'shutdown', 'sleep timer', 'goodnight', 'lights off'];

function getEventTitle(event) {
  return String(event?.summary || event?.title || '').trim();
}

function isBedtimeEvent(event) {
  const title = getEventTitle(event).toLowerCase();
  // Must contain a keyword to qualify.
  return AUTO_START_KEYWORDS.some(kw => title.includes(kw));
}

// Content Blocker recurring schedules: independent of the shutdown timer's
// own dim-phase blocking, so this can (for example) keep social media
// blocked all night whether or not a Lights Out timer happens to be
// running. Only calls block/unblock on an actual on/off transition.
function checkContentBlockerSchedules() {
  const cbConfig = settingsStore.getSection('contentBlocker');
  if (!cbConfig || !cbConfig.enabled) {
    contentBlockerScheduleActive = false;
    return;
  }

  const scheduleWantsBlock = contentBlocker.isAnyScheduleActive(cbConfig.schedules, new Date());
  if (scheduleWantsBlock === contentBlockerScheduleActive) return;
  contentBlockerScheduleActive = scheduleWantsBlock;

  if (scheduleWantsBlock) {
    const sites = (cbConfig.useDefault !== false) ? contentBlocker.DEFAULT_BLOCKLIST : (cbConfig.blocklist || []);
    contentBlocker.blockSites(sites).then(result => {
      if (result.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('content-blocked', { sites: result.sites, blocked: true, source: 'schedule' });
      }
    }).catch(() => {});
  } else {
    // Schedule window just ended -- don't unblock if the shutdown timer's
    // own dim-phase blocking still wants it blocked right now.
    const timerAlsoWantsBlock = timerState.running && !timerState.paused &&
      (timerState.phase === 'dim' || timerState.phase === 'lastlight') &&
      cbConfig.blockOnDim !== false;
    if (!timerAlsoWantsBlock) {
      contentBlocker.unblockSites().then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('content-blocked', { blocked: false, source: 'schedule' });
        }
      }).catch(() => {});
    }
  }
}

let calendarAutoStartBusy = false;
const calendarStartedOccurrences = new Set();

async function checkCalendarAutoStart() {
  const calSettings = settingsStore.getSection('calendar') || {};
  if (!calSettings.enabled || !calSettings.autoStartFromEvents) return;
  if (calendarAutoStartBusy) return;
  calendarAutoStartBusy = true;

  try {
    // Include the last polling minute, and never start before the chosen time.
    const events = await calProviders.fetchAllEvents(calSettings, new Date(Date.now() - 60000), 1);
    if (!events || !events.length) return;

    const now = new Date();
    for (const event of events) {
      // Events from the built-in schedule (source: 'builtin') are rules the
      // user explicitly configured in the Schedule tab -- e.g. a "Movie
      // Night" rule whose label has no bedtime keyword in it -- so they skip
      // the keyword filter. That filter exists only to keep auto-start from
      // firing on random, unrelated entries pulled in from an *imported*
      // external calendar (Google/Outlook/iCal), where intent is ambiguous.
      if (event.source !== 'builtin' && !isBedtimeEvent(event)) continue;
      const start = new Date(event.start);
      if (!Number.isFinite(start.getTime())) continue;
      const end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60 * 1000);
      const diffMin = (start - now) / 60000;
      const occurrence = `${event.uid || ''}@${start.toISOString()}`;
      if (calendarStartedOccurrences.has(occurrence) || (calSettings.lastStartedOccurrences || []).includes(occurrence)) continue;
      if (diffMin >= -1 && diffMin <= 0) {
        const duration = Math.max(300, Math.round((end - now) / 1000));
        const action = event.action || calSettings.builtin?.action || 'shutdown';
        // Test Mode is read from the app section at fire time, like autopilot.
        const appSettings = settingsStore.getSection('app') || {};
        const profile = event.profileId ? profiles.getById(event.profileId) : null;
        // Claim the local day before dispatch. A failed write blocks execution;
        // a claimed-but-interrupted dispatch is never silently retried.
        let claimed = null;
        if (event.routinePlan) {
          const available = routineModel.availability(event.routinePlan, 'windows');
          if (!available.available) continue;
          const day = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
          claimed = routineLedger.claim(event.routinePlan, day, start.toISOString());
          if (!claimed) continue;
          if (isRunActive() || (event.profileId && !profile)) {
            routineLedger.update(claimed.occurrenceKey, { status: 'skipped', reason: isRunActive() ? 'timer-active' : 'routine-unavailable',
              actions: claimed.actions.map(a => ({ ...a, status: 'skipped' })) });
            break;
          }
        } else if (isRunActive()) return;
        // A removed saved routine must not silently fall back to another one.
        if (event.profileId && !profile) continue;
        const result = startTimer({ durationSeconds: duration, action,
          profileId: profile?.id || null, dryRun: Boolean(appSettings.dryRun || profile?.dryRun || event.testMode),
          forceShutdown: false, muteSystem: Boolean(profile?.muteSystem),
          gracePeriod: profile?.gracePeriod, startOrigin: 'calendar', origin: 'calendar' }, undefined, claimed?.occurrenceKey || null);
        if (claimed) routineLedger.dispatchResult(claimed.occurrenceKey, result,
          result?.success && timerState.running ? activeReceiptId : null);
        if (result && result.success) {
          calendarStartedOccurrences.add(occurrence);
          if (calendarStartedOccurrences.size > 128) calendarStartedOccurrences.delete(calendarStartedOccurrences.values().next().value);
          const recent = [...(calSettings.lastStartedOccurrences || []), occurrence].slice(-128);
          settingsStore.updateSection('calendar', { lastStartedOccurrences: recent });
          showNativeNotification('Lights Out', `Auto-started from calendar: ${getEventTitle(event) || 'Bedtime'}`);
        }
        break;
      }
    }
  } catch { /* best effort - calendar offline does not crash app */ }
  finally { calendarAutoStartBusy = false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Companion PWA message handling
// ─────────────────────────────────────────────────────────────────────────────

function handleCompanionMessage(msg, client) {
  if (!msg || !msg.action) return;
  
  // Hard safety: if companion mode is OFF, reject all messages even if they reached here.
  const rc = settingsStore.getSection('remoteControl') || {};
  if (!rc.mode || rc.mode === 'off') return;

  switch (msg.action) {
    case 'start': {
      const ritualActive = ritualMode.getState().active;
      if (timerState.running || timerState.paused || ritualActive) {
        if (client) {
          companion.sendToClient(client, {
            type: 'commandResult',
            action: 'start',
            success: false,
            code: 'RUN_ACTIVE',
            message: 'A Lights Out run is already active. Stop it before starting another.',
            state: {
              running: timerState.running,
              paused: timerState.paused,
              ritualActive,
              remainingSeconds: timerState.remainingSeconds,
              totalSeconds: timerState.totalSeconds,
              action: timerState.action,
              dryRun: timerState.dryRun,
              nightModeId: timerState.nightModeId,
              nightModeTitle: timerState.nightModeTitle
            }
          });
        }
        break;
      }
      // Desktop remains authoritative over Dry Run: the phone protocol never
      // carries a dryRun field (validateCompanionMessage strips it), so this
      // reads the desktop's own persisted setting rather than trusting the client.
      const appSettings = settingsStore.getSection('app') || {};
      const durationSeconds = msg.durationSeconds || 1800;
      const timerAction = msg.timerAction || 'shutdown';
      const result = startTimer({
        durationSeconds,
        action: timerAction,
        source: 'remote',
        origin: 'phone',
        dryRun: Boolean(appSettings.dryRun)
      });
      if (result.success) {
        notifyRemoteAction(`${formatAction(timerAction)} started from your phone (${Math.round(durationSeconds / 60)} min)${appSettings.dryRun ? ' · Test Mode, nothing will power off' : ' · REAL'}`);
      } else if (client) {
        companion.sendToClient(client, {
          type: 'commandResult',
          action: 'start',
          success: false,
          code: 'START_REJECTED',
          message: result.error || 'The desktop rejected the start request.'
        });
      }
      break;
    }
    case 'startNightMode': {
      const ritualActive = ritualMode.getState().active;
      if (timerState.running || timerState.paused || ritualActive) {
        if (client) {
          companion.sendToClient(client, {
            type: 'commandResult',
            action: 'startNightMode',
            success: false,
            code: 'RUN_ACTIVE',
            message: 'A Lights Out run is already active. Stop it before starting another.',
            state: {
              running: timerState.running,
              paused: timerState.paused,
              ritualActive,
              remainingSeconds: timerState.remainingSeconds,
              totalSeconds: timerState.totalSeconds,
              action: timerState.action,
              dryRun: timerState.dryRun,
              nightModeId: timerState.nightModeId,
              nightModeTitle: timerState.nightModeTitle
            }
          });
        }
        break;
      }
      const resolution = nightModes.resolveForExecution(msg.nightModeId);
      if (!resolution.success) break;
      // Desktop remains authoritative over Dry Run (see note above) — the phone
      // supplies only the canonical nightModeId; policy comes from settingsStore.
      const appSettings = settingsStore.getSection('app') || {};
      const result = startTimer({
        ...resolution.resolved,
        source: 'remote',
        startOrigin: 'companion-night-mode',
        origin: 'phone',
        dryRun: Boolean(appSettings.dryRun)
      });
      if (result.success) {
        notifyRemoteAction(`${resolution.resolved.nightModeTitle} started from your phone (${Math.round(resolution.resolved.durationSeconds / 60)} min)${appSettings.dryRun ? ' · Test Mode, nothing will power off' : ' · REAL'}`);
      } else if (client) {
        // UI-R3 Fire 08: the same commandResult the RUN_ACTIVE branch above
        // sends (no new command, no new field), so the phone shows why --
        // e.g. a ritual mode while the ritual is turned off.
        companion.sendToClient(client, {
          type: 'commandResult',
          action: 'startNightMode',
          success: false,
          code: result.code || 'START_REJECTED',
          message: result.error || 'The desktop rejected the start request.'
        });
      }
      break;
    }
    case 'getNightModes':
      if (client) {
        const nmCatalogue = nightModes.getCatalogue();
        companion.sendToClient(client, { type: 'nightModes', modes: nmCatalogue });
      }
      break;
    case 'togglePause':
      if (timerState.paused) {
        if (resumeTimer().success) notifyRemoteAction('Timer resumed from your phone');
      } else if (timerState.running) {
        if (pauseTimer().success) notifyRemoteAction('Timer paused from your phone');
      }
      break;
    case 'snooze': {
      const seconds = msg.seconds || 300;
      if (snoozeTimer(seconds).success) {
        notifyRemoteAction(`Timer snoozed from your phone (+${Math.round(seconds / 60)} min)`);
      }
      break;
    }
    case 'cancel': {
      const wasActive = timerState.running || timerState.paused;
      cancelTimer();
      if (wasActive) notifyRemoteAction('Timer cancelled from your phone');
      break;
    }
  }
  // Immediately broadcast updated state after action.
  setTimeout(broadcastCompanionState, 300);
}

function updateSystemInfoCacheAsync() {
  if (systemInfoCache && Date.now() - systemInfoCachedAt < SYSTEM_INFO_TTL_MS) {
    return;
  }
  (async () => {
    try {
      const battery = await executePowerShell('(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).EstimatedChargeRemaining');
      const powerPlan = await executePowerShell('(Get-CimInstance -Namespace "root\\cimv2\\power" -ClassName Win32_PowerPlan | Where-Object { $_.IsActive }).ElementName');
      systemInfoCache = { battery: battery || 'N/A', powerPlan: powerPlan || 'Unknown' };
      systemInfoCachedAt = Date.now();
    } catch {
      // ignore
    }
  })();
}

function broadcastCompanionState() {
  updateSystemInfoCacheAsync();
  const appSettings = settingsStore.getSection('app') || {};
  const taxStats = overrideTax.getStats();
  companion.broadcast({
    type: 'state',
    running: timerState.running,
    paused: timerState.paused,
    remainingSeconds: timerState.remainingSeconds,
    totalSeconds: timerState.totalSeconds,
    action: timerState.action,
    phase: timerState.phase,
    timerName: appSettings.timerName || 'Last Call',
    pcName: require('os').hostname(),
    dryRun: timerState.dryRun,
    // Authoritative Dry Run policy, independent of whether a timer is active —
    // lets the phone UI show correct DRY RUN / REAL ACTION copy before starting.
    dryRunPolicy: Boolean(appSettings.dryRun),
    nightModeId: timerState.nightModeId,
    nightModeTitle: timerState.nightModeTitle,
    nightModeVersion: timerState.nightModeVersion,
    profileId: timerState.profileId,
    profileName: timerState.profileName,
    systemInfo: {
      battery: systemInfoCache ? systemInfoCache.battery : 'N/A',
      powerPlan: systemInfoCache ? systemInfoCache.powerPlan : 'Unknown'
    },
    overrideTax: {
      sessionSnoozeCount: taxStats.sessionSnoozeCount,
      tomorrowDebt: taxStats.tomorrowDebt,
      nextSnoozeCost: overrideTax.assessSnoozeCost()
    },
    stats: {
      sleepScore: streaks.getSleepScore(),
      sleepDebt: sleepDebt.getDebtSummary(),
      streak: (streaks.getSummary() || {}).streak || 0,
      tomorrowDebt: taxStats.tomorrowDebt,
      autopilotEnabled: (appSettings.autopilotEnabled === true)
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote control gating (companion PWA + family LAN). OFF by default: no network
// listener binds unless the user explicitly enables it AND a pairing token exists.
// Every inbound command is token-authenticated and validated before dispatch.
// ─────────────────────────────────────────────────────────────────────────────

function familyCommandHandler(cmd) {
  if (!cmd || !cmd.command) return { success: false, code: 'INVALID', error: 'Empty command' };
  switch (cmd.command) {
    case 'start': {
      // Same safety authority as the phone path: an active run cannot be
      // superseded, and Dry Run policy comes from desktop settings — the LAN
      // client is never authoritative over it.
      if (timerState.running || timerState.paused || ritualMode.getState().active) {
        return { success: false, code: 'RUN_ACTIVE', error: 'A Lights Out run is already active. Stop it before starting another.' };
      }
      const appSettings = settingsStore.getSection('app') || {};
      const r = startTimer({
        durationSeconds: cmd.durationSeconds || 1800,
        action: cmd.action || 'shutdown',
        source: 'remote',
        origin: 'family',
        dryRun: Boolean(appSettings.dryRun)
      });
      return r.success
        ? { success: true, code: 'STARTED' }
        : { success: false, code: 'START_REJECTED', error: r.error || 'The desktop rejected the start request.' };
    }
    case 'pause':
      if (!timerState.running || timerState.paused) return { success: false, code: 'NOT_RUNNING', error: 'No running timer to pause' };
      pauseTimer();
      return { success: true, code: 'PAUSED' };
    case 'resume':
      if (!timerState.running || !timerState.paused) return { success: false, code: 'NOT_PAUSED', error: 'No paused timer to resume' };
      resumeTimer();
      return { success: true, code: 'RESUMED' };
    case 'snooze':
      if (!timerState.running) return { success: false, code: 'NOT_RUNNING', error: 'No running timer to snooze' };
      snoozeTimer(cmd.seconds || 300);
      return { success: true, code: 'SNOOZED' };
    case 'cancel':
      if (!timerState.running) return { success: false, code: 'NOT_RUNNING', error: 'No running timer to cancel' };
      cancelTimer();
      return { success: true, code: 'CANCELLED' };
    default:
      return { success: false, code: 'UNKNOWN_COMMAND', error: `Unsupported command: ${cmd.command}` };
  }
}

function getRemoteControlState() {
  const rc = settingsStore.getSection('remoteControl') || {};
  const network = companionNetwork.selectLanIp(family.getLocalIPs(), rc.lanIp);
  const ips = network.candidates;
  const lanIp = network.lanIp;
  const mode = rc.mode || (rc.enabled ? 'wifi' : 'off');
  const pcName = os.hostname();
  const port = normalizeCompanionPort(rc.port);
  const status = companion.getStatus();
  const connected = status.connected && status.clients > 0;
  const ready = Boolean(status.ready && status.running && !status.failed && !companionNetworkFailure);
  const failed = Boolean(status.failed || companionNetworkFailure);

  let url = '';
  if (ready && mode === 'wifi' && rc.token) {
    // Include the desktop host as a separate parameter so packaged Android
    // companions (which load the UI locally) know where to open the WebSocket.
    url = `http://${lanIp}:${port}/?t=${rc.token}&host=${encodeURIComponent(`${lanIp}:${port}`)}`;
  } else if (ready && mode === 'local' && rc.token) {
    url = `http://127.0.0.1:${port}/?t=${rc.token}`;
  }

  return {
    enabled: mode !== 'off',
    mode,
    shortCode: ready && rc.token ? rc.token.slice(0, 6).toUpperCase() : '',
    port,
    lanIp,
    candidateIps: ips,
    url,
    pcName,
    clients: status.clients || 0,
    connected,
    ready,
    running: Boolean(status.running),
    failed,
    statusLabel: getCompanionStatusLabel(mode, status),
    errorCode: companionNetworkFailure?.errorCode || status.errorCode || '',
    errorMessage: companionNetworkFailure?.errorMessage || status.errorMessage || '',
    failureDetails: failed ? companionFailureDetails : null,
    firewall: { ...companionFirewallState },
    failedAttempts: status.failedAttempts || 0,
    lastFailedIp: status.lastFailedIp || ''
  };
}

function normalizeCompanionPort(value) {
  const port = Number(value || companion.PWA_PORT);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : companion.PWA_PORT;
}

function getCompanionStatusLabel(mode, status) {
  if (mode === 'off') return 'Off';
  if (status.failed || companionNetworkFailure) return 'Connection failed';
  if (!status.ready || !status.running) return 'Starting companion';
  // Listener is up but phones may still be blocked: surface the firewall gap
  // as a real status instead of a console warning only.
  if (mode === 'wifi' && companionFirewallState && companionFirewallState.configured === false) {
    return 'Firewall action required';
  }
  if (status.connected || status.clients > 0) return 'Phone connected';
  if (mode === 'local') return 'Ready on this PC only';
  return 'Desktop endpoint ready — waiting for phone';
}

function broadcastRemoteControlState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('remote-control-status', getRemoteControlState());
}

// True only while THIS process has opened the app-owned firewall rules.
// Removal is gated on it: a launch or quit with Phone Companion off must never
// run a firewall change, and one Lights Out instance (e.g. a dev build) must
// never delete rules another instance (e.g. the installed app) opened.
// companionFirewall also scopes creation, rollback and removal to unique
// per-process rule names, including when two instances use the same executable.
let firewallRulesOpenedByThisProcess = false;

async function configureFirewallRules(open, port = companion.PWA_PORT) {
  try {
    if (open) {
      await executePowerShell(companionFirewall.configureOwnedRulesCommand(process.execPath, normalizeCompanionPort(port)));
      firewallRulesOpenedByThisProcess = true;
    } else {
      await executePowerShell(companionFirewall.removeOwnedRulesCommand());
      firewallRulesOpenedByThisProcess = false;
    }
    companionFirewallState = { configured: open, error: '', guidance: '' };
    return { ...companionFirewallState };
  } catch (err) {
    console.warn('Windows Firewall configuration skipped or failed:', err.message);
    companionFirewallState = {
      configured: false,
      error: err.message || 'Firewall configuration failed',
      guidance: open
        ? `Windows did not allow Lights Out to create its private-network rule for ${process.execPath}. Allow that exact app on Private networks, then retry. Lights Out did not request elevation.`
        : 'Lights Out could not remove its app-owned firewall rules. Remove rules in the “Lights Out Companion” group from Windows Firewall if needed.'
    };
    return { ...companionFirewallState };
  }
}

async function stopRemoteControl() {
  try { await companion.stop(); } catch {}
  try { family.stop(); } catch {}
  if (firewallRulesOpenedByThisProcess) await configureFirewallRules(false);
}

async function findCompanionPortOwner(port) {
  const safePort = normalizeCompanionPort(port);
  try {
    const raw = await executePowerShell(
      `$connection = Get-NetTCPConnection -LocalPort ${safePort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($connection) { $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{ pid = $connection.OwningProcess; name = $process.ProcessName; path = $process.Path } | ConvertTo-Json -Compress }`
    );
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function enrichCompanionFailure(status) {
  if (!status.failed || status.errorCode !== 'EADDRINUSE') return;
  const key = `${status.errorCode}:${status.port}`;
  if (companionFailureLookupKey === key) return;
  companionFailureLookupKey = key;
  companionFailureDetails = await findCompanionPortOwner(status.port);
  broadcastRemoteControlState();
}

async function startRemoteControl() {
  // Always rebuild from a clean state so token changes take effect.
  await stopRemoteControl();
  companionFailureDetails = null;
  companionFailureLookupKey = '';
  companionNetworkFailure = null;
  const rc = settingsStore.getSection('remoteControl') || {};
  const mode = rc.mode || (rc.enabled ? 'wifi' : 'off');
  const port = normalizeCompanionPort(rc.port);
  const assignedIps = family.getLocalIPs();
  // Route-table truth, not an Internet probe: no packet is emitted, and an
  // isolated LAN with no default route simply yields no hint — the LAN
  // candidates still apply.
  const routedIp = await companionNetwork.getDefaultRouteLanIp();
  const network = companionNetwork.selectLanIp(assignedIps, rc.lanIp, routedIp);
  const lanIp = network.lanIp;
  companionNetworkFingerprint = companionNetwork.networkFingerprint(assignedIps, routedIp);
  
  if (mode === 'off' || !rc.token) return getRemoteControlState();
  
  if (mode === 'wifi') {
    if (!network.hasLanIp) {
      companionNetworkFailure = {
        errorCode: 'NO_LAN_ADDRESS',
        errorMessage: 'No usable LAN address is available. Reconnect Wi-Fi, then retry.'
      };
      broadcastRemoteControlState();
      return getRemoteControlState();
    }
    if (rc.lanIp !== lanIp) settingsStore.updateSection('remoteControl', { lanIp });
    const firewall = await configureFirewallRules(true, port);
    // Bind only the selected LAN interface + nothing else: the advertised URL,
    // the listener, and the firewall-scoped Private-network surface all agree.
    const result = await companion.start({ token: rc.token, host: lanIp, port, probeHost: lanIp });
    if (result.ready) {
      family.start({ enabled: true, token: rc.token, peerName: os.hostname(), bindHost: lanIp }, familyCommandHandler);
    }
    if (!firewall.configured && result.ready) {
      console.warn(`Companion is locally ready, but the firewall rule could not be verified: ${firewall.error}`);
    }
  } else if (mode === 'local') {
    await companion.start({ token: rc.token, host: '127.0.0.1', port });
    // Family mode (LAN discovery) is disabled in "This PC only" mode. Any
    // rules this process had opened were already removed by stopRemoteControl.
    if (firewallRulesOpenedByThisProcess) await configureFirewallRules(false);
  }

  return getRemoteControlState();
}

function queueRemoteControlRestart() {
  const operation = remoteControlOperation.then(() => startRemoteControl());
  remoteControlOperation = operation.catch(() => {});
  return operation;
}

function startCompanionNetworkMonitor() {
  if (companionNetworkMonitor) return;
  companionNetworkMonitor = setInterval(async () => {
    if (companionNetworkPollActive) return;
    companionNetworkPollActive = true;
    try {
      const rc = settingsStore.getSection('remoteControl') || {};
      const mode = rc.mode || (rc.enabled ? 'wifi' : 'off');
      const assignedIps = family.getLocalIPs();
      // Fingerprint on interface truth only; route-table flaps (VPN metric
      // churn without an address change) must not churn the listener.
      const nextFingerprint = companionNetwork.networkFingerprint(assignedIps);
      if (nextFingerprint === companionNetworkFingerprint) return;
      companionNetworkFingerprint = nextFingerprint;
      if (mode !== 'wifi') return;

      // A changed route invalidates every previously rendered pairing URL.
      // stop() immediately clears readiness and causes the renderer to hide the
      // QR while the serialized restart re-selects and re-probes the endpoint.
      companionNetworkFailure = null;
      await companion.stop();
      broadcastRemoteControlState();
      await queueRemoteControlRestart();
    } catch (err) {
      console.warn('Companion network-change recovery failed:', err.message);
    } finally {
      companionNetworkPollActive = false;
    }
  }, 3000);
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

async function executePowerShell(command) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    let error = '';
    ps.stdout.on('data', data => {
      output += data.toString();
    });
    ps.stderr.on('data', data => {
      error += data.toString();
    });
    ps.on('error', reject);
    ps.on('close', code => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(error.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

// Detect running browsers that may have unsaved work.
// Returns an array of { name, windowCount } for each detected browser.
async function getOpenBrowsers() {
  const browsers = [
    { process: 'chrome', name: 'Chrome' },
    { process: 'msedge', name: 'Edge' },
    { process: 'firefox', name: 'Firefox' },
    { process: 'brave', name: 'Brave' },
    { process: 'opera', name: 'Opera' },
    { process: 'vivaldi', name: 'Vivaldi' }
  ];
  const results = [];
  const cmd = browsers.map(b =>
    `$p = Get-Process -Name '${b.process}' -ErrorAction SilentlyContinue; if ($p) { '${b.name}:' + $p.Count }`
  ).join('; ');
  try {
    const raw = await executePowerShell(cmd);
    if (!raw) return [];
    for (const part of raw.split(';').map(s => s.trim()).filter(Boolean)) {
      const [name, count] = part.split(':');
      if (name && count && parseInt(count) > 0) {
        results.push({ name, windowCount: parseInt(count) });
      }
    }
  } catch { /* best-effort */ }
  return results;
}

async function executePowerAction(options = {}) {
  const action = options.action || 'shutdown';
  const dryRun = Boolean(options.dryRun);
  const forceShutdown = Boolean(options.forceShutdown);
  const muteSystem = Boolean(options.muteSystem);

  if (dryRun) {
    emitTimerUpdate('dryrun', { action, message: `Test Mode: ${formatAction(action)} skipped` });
    // Update receipt: dry run completed.
    if (activeReceiptId) {
      runReceipts.updateRunReceipt(activeReceiptId, {
        result: 'dry_run_completed',
        endedAt: new Date().toISOString(),
        notes: 'Test Mode - no power action executed'
      });
      activeReceiptId = null;
    }
    return { success: true, dryRun: true };
  }

  if (DESKTOP_UX_PROOF) {
    realPowerActionLog.push({
      at: Date.now(),
      action,
      forceShutdown,
      muteSystem
    });
  }

  if (QA_POWER_LOCK) {
    emitTimerUpdate('dryrun', { action, message: `QA power lock: ${formatAction(action)} blocked` });
    if (activeReceiptId) {
      runReceipts.updateRunReceipt(activeReceiptId, {
        result: 'blocked',
        endedAt: new Date().toISOString(),
        notes: 'QA power lock - no power action executed'
      });
      activeReceiptId = null;
    }
    return { success: false, blocked: true, error: 'QA power lock' };
  }

  try {
    // Volume/mute manipulation is intentionally disabled; the app no longer
    // touches the system volume during power actions.

    switch (action) {
      case 'shutdown':
        spawn('shutdown.exe', forceShutdown ? ['/s', '/f', '/t', '0'] : ['/s', '/t', '0'], { detached: true, stdio: 'ignore' }).unref();
        break;
      case 'restart':
        spawn('shutdown.exe', forceShutdown ? ['/r', '/f', '/t', '0'] : ['/r', '/t', '0'], { detached: true, stdio: 'ignore' }).unref();
        break;
      case 'sleep':
        spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { detached: true, stdio: 'ignore' }).unref();
        break;
      case 'hibernate':
        spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '1,1,0'], { detached: true, stdio: 'ignore' }).unref();
        break;
      case 'lock':
        spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore' }).unref();
        break;
      case 'logout':
        spawn('shutdown.exe', ['/l'], { detached: true, stdio: 'ignore' }).unref();
        break;
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }

    // Update receipt: power executed.
    if (activeReceiptId) {
      runReceipts.updateRunReceipt(activeReceiptId, {
        result: 'power_executed',
        powerCommand: action + (forceShutdown ? ' /f' : ''),
        endedAt: new Date().toISOString()
      });
      activeReceiptId = null;
    }
    return { success: true };
  } catch (error) {
    emitTimerUpdate('error', { message: error.message });
    // Update receipt: blocked/error.
    if (activeReceiptId) {
      runReceipts.updateRunReceipt(activeReceiptId, {
        result: 'error',
        notes: error.message,
        endedAt: new Date().toISOString()
      });
      activeReceiptId = null;
    }
    return { success: false, error: error.message };
  }
}

function getLoginSettings() {
  const loginSettings = app.getLoginItemSettings();
  return {
    runAtLogin: Boolean(loginSettings.openAtLogin),
    startupBehavior: 'Starts minimized and idle'
  };
}

function setRunAtLogin(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: false,
    args: ['--minimized', '--no-auto-start']
  });
  return getLoginSettings();
}

ipcMain.handle('start-timer', async (event, options, legacyAction) => {
  const invokedAt = Date.now();
  const result = await startTimer(options, legacyAction);
  if (DESKTOP_UX_PROOF) {
    startInvocationLog.push({
      at: invokedAt,
      options: JSON.parse(JSON.stringify(options || null)),
      legacyAction: legacyAction || null,
      result: JSON.parse(JSON.stringify(result || null)),
      senderId: event.sender.id
    });
  }
  return result;
});
ipcMain.handle('get-start-invocations', async () => (DESKTOP_UX_PROOF ? startInvocationLog.slice() : []));
ipcMain.handle('clear-start-invocations', async () => { if (DESKTOP_UX_PROOF) startInvocationLog.length = 0; return true; });
ipcMain.handle('get-real-power-actions', async () => (DESKTOP_UX_PROOF ? realPowerActionLog.slice() : []));
ipcMain.handle('cancel-timer', async () => cancelTimer());
ipcMain.handle('pause-timer', async () => pauseTimer());
ipcMain.handle('resume-timer', async () => resumeTimer());
ipcMain.handle('snooze-timer', async (event, seconds, reason) => snoozeTimer(seconds, reason));

let systemInfoCache = null;
let systemInfoCachedAt = 0;
const SYSTEM_INFO_TTL_MS = 15000;

ipcMain.handle('get-system-info', async () => {
  if (systemInfoCache && Date.now() - systemInfoCachedAt < SYSTEM_INFO_TTL_MS) {
    return systemInfoCache;
  }
  try {
    const battery = await executePowerShell('(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).EstimatedChargeRemaining');
    const powerPlan = await executePowerShell('(Get-CimInstance -Namespace "root\\cimv2\\power" -ClassName Win32_PowerPlan | Where-Object { $_.IsActive }).ElementName');
    systemInfoCache = { battery: battery || 'N/A', powerPlan: powerPlan || 'Unknown' };
    systemInfoCachedAt = Date.now();
    return systemInfoCache;
  } catch {
    return { battery: 'N/A', powerPlan: 'Unknown' };
  }
});

ipcMain.on('set-window-opacity', (event, value) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const v = Math.max(0.5, Math.min(1, Number(value) || 1));
  mainWindow.setOpacity(v);
});

ipcMain.handle('get-app-settings', async () => ({
  ...getLoginSettings(),
  app: settingsStore.getSection('app'),
  customization: settingsStore.getSection('customization'),
  lastLight: settingsStore.getSection('lastLight'),
  calendar: settingsStore.getSection('calendar'),
  recoverableTimer: getRecoverableTimer()
}));
ipcMain.handle('save-app-settings', async (event, settings = {}) => {
  if (typeof settings.runAtLogin === 'boolean') setRunAtLogin(settings.runAtLogin);
  if (settings.app) {
    settingsStore.updateSection('app', settings.app);
    // A Test Mode toggle reaches the tray and the desktop widget immediately.
    updateTrayText();
    refreshTrayMenu();
    updateWidget();
  }
  if (settings.customization) settingsStore.updateSection('customization', settings.customization);
  if (settings.lastLight) settingsStore.updateSection('lastLight', settings.lastLight);
  if (settings.calendar) settingsStore.updateSection('calendar', settings.calendar);
  if (settings.wifiGuard) settingsStore.updateSection('wifiGuard', capabilityTruth.sanitizeWifiGuard(settings.wifiGuard));
  if (settings.contentBlocker) settingsStore.updateSection('contentBlocker', capabilityTruth.sanitizeContentBlocker(settings.contentBlocker));
  if (settings.accountability) settingsStore.updateSection('accountability', capabilityTruth.sanitizeAccountability(settings.accountability));
  return {
    ...getLoginSettings(),
    app: settingsStore.getSection('app'),
    customization: settingsStore.getSection('customization'),
    lastLight: settingsStore.getSection('lastLight'),
    calendar: settingsStore.getSection('calendar'),
    wifiGuard: settingsStore.getSection('wifiGuard'),
    contentBlocker: settingsStore.getSection('contentBlocker'),
    accountability: settingsStore.getSection('accountability')
  };
});
ipcMain.handle('discard-recoverable-timer', async () => {
  // Finalize the abandoned receipt honestly instead of leaving it stuck at
  // result:'running' forever once the user has explicitly said not to
  // resume it.
  const snapshot = settingsStore.getActiveTimer();
  if (snapshot && snapshot.receiptId) {
    const receipt = runReceipts.getReceiptById(snapshot.receiptId);
    if (receipt && receipt.result === 'running') {
      const now = new Date().toISOString();
      runReceipts.updateRunReceipt(snapshot.receiptId, {
        result: 'interrupted',
        endedAt: now,
        reconciliationReason: 'discarded-by-user',
        reconciledAt: now
      });
    }
  }
  settingsStore.setActiveTimer(null);
  return { success: true };
});
ipcMain.handle('get-streaks', async () => {
  try { return streaks.getSummary(); } catch { return { streak: 0, bestStreak: 0, totalNights: 0, achievements: [], weekAvg: '--:--', weekOnTime: 0, weekDays: [] }; }
});
ipcMain.handle('get-achievements-catalog', async () => {
  try { return streaks.getAchievementCatalog(); } catch { return []; }
});
ipcMain.handle('get-weekly-report', async () => {
  // Receipts let the report acknowledge Test Mode runs that never count.
  try {
    let receipts = [];
    try { receipts = runReceipts.getAllReceiptsForExport(); } catch { /* report still works without them */ }
    return streaks.getWeeklyReport({ receipts });
  } catch { return null; }
});
ipcMain.handle('get-sleep-score', async () => {
  try { return streaks.getSleepScore(); } catch { return { score: null, label: 'Error', breakdown: {} }; }
});
ipcMain.handle('get-streaks-history', async () => {
  try { return streaks.getHistory30(); } catch { return []; }
});
ipcMain.handle('get-streaks-trend', async (event, granularity) => {
  try { return streaks.getTrend(granularity); } catch { return []; }
});
ipcMain.handle('add-custom-sequence', async (event, seq) => {
  const entry = lastLight.addCustomSequence(seq);
  if (entry) {
    const ll = settingsStore.getSection('lastLight') || {};
    ll.customSequences = lastLight.getCustomSequences();
    settingsStore.updateSection('lastLight', ll);
  }
  return entry;
});
ipcMain.handle('remove-custom-sequence', async (event, id) => {
  lastLight.removeCustomSequence(id);
  const ll = settingsStore.getSection('lastLight') || {};
  ll.customSequences = lastLight.getCustomSequences();
  settingsStore.updateSection('lastLight', ll);
  return { success: true };
});
ipcMain.handle('get-open-browsers', async () => {
  try { return await getOpenBrowsers(); } catch { return []; }
});

// Wake-up alarm IPC
ipcMain.handle('schedule-wake-alarm', async (event, alarmTime) => {
  const appExePath = process.execPath;
  return alarm.scheduleWakeAlarm(alarmTime, appExePath);
});
ipcMain.handle('remove-wake-alarm', async () => {
  return alarm.removeWakeAlarm();
});
ipcMain.handle('get-wake-alarm-status', async () => {
  return alarm.getWakeAlarmStatus();
});

// Auto-update checker
ipcMain.handle('check-for-update', async () => {
  return updater.checkForUpdate();
});
ipcMain.handle('get-update-status', async () => {
  return updater.getLastCheckResult();
});
ipcMain.handle('download-portable-update', async () => {
  const result = await updater.downloadPortableUpdate(app.getPath('downloads'));
  if (result.success && result.filePath) shell.showItemInFolder(result.filePath);
  return result;
});

// App version. Single source of truth is electron/package.json (via updater.currentVersion)
// so the UI never carries a second, driftable copy of the version string.
ipcMain.handle('get-app-version', async () => updater.currentVersion);

// Data export/import
ipcMain.handle('export-all-data', async () => {
  try {
    const data = {
      version: updater.currentVersion,
      exportedAt: new Date().toISOString(),
      settings: settingsStore.getAll(),
      streaks: streaks.exportData(),
      profiles: profiles.getAll()
    };
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('import-all-data', async (event, jsonData) => {
  try {
    const parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    if (!parsed || typeof parsed !== 'object') return { success: false, error: 'Invalid data format' };
    if (parsed.settings) {
      const ALLOWED_SECTIONS = new Set([
        'window', 'app', 'calendar', 'smartLights', 'customization', 'lastLight',
        'wifiGuard', 'contentBlocker', 'accountability', 'remoteControl', 'ritual'
      ]);
      for (const [section, value] of Object.entries(parsed.settings)) {
        if (section === 'activeTimer') settingsStore.setActiveTimer(value || null);
        else if (value !== undefined && ALLOWED_SECTIONS.has(section)) settingsStore.updateSection(section, value);
      }
    }
    if (parsed.profiles && Array.isArray(parsed.profiles)) {
      const importedProfiles = profiles.import(JSON.stringify(parsed.profiles));
      if (!importedProfiles.success) return importedProfiles;
      profileIdentity.reconcilePersistedSelection(settingsStore, profiles);
    }
    if (parsed.streaks && typeof parsed.streaks === 'object') streaks.replaceAll(parsed.streaks);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Calendar providers
ipcMain.handle('get-calendar-providers', async () => {
  return calProviders.getProviders();
});
ipcMain.handle('fetch-calendar-events', async (event, withinDays) => {
  try {
    const calConfig = settingsStore.getSection('calendar') || {};
    // recordStatus: this renderer-initiated fetch records whether each feed
    // answered (getLastFetchStatus); the 1-day background fetches never do.
    const events = await calProviders.fetchAllEvents(calConfig, new Date(), withinDays || 14, { recordStatus: true });
    return events.map(e => ({
      uid: e.uid,
      summary: e.summary,
      start: e.start.toISOString(),
      end: e.end?.toISOString() || null,
      location: e.location || '',
      source: e.source,
      action: e.action || 'shutdown',
      // The same rule checkCalendarAutoStart applies, so Schedule can say
      // "Will auto-start" vs "Listed only" from main's own logic.
      autoStartEligible: e.source === 'builtin' || isBedtimeEvent(e)
    }));
  } catch (err) {
    return [];
  }
});
// UI-R3 Fire 09: additive, read-only, argument-free. Per configured provider,
// whether the last Schedule fetch reached it ({ ok, at } or { ok:false, reason,
// at }); the reason is a fixed category, never error text, a URL or a token.
ipcMain.handle('get-calendar-fetch-status', () => calProviders.getLastFetchStatus());
ipcMain.handle('save-calendar-settings', async (event, calSettings) => {
  const patch = { ...calSettings };
  if (Array.isArray(calSettings?.builtin?.rules)) {
    patch.builtin = { ...calSettings.builtin, rules: calSettings.builtin.rules.map(rule => ({ ...rule, plan: routineModel.fromWindowsRule(rule) })) };
  }
  settingsStore.updateSection('calendar', patch, { requireSave: true });
  return { success: true };
});
ipcMain.handle('get-calendar-settings', async () => {
  let routineOutcomes = [];
  try { routineOutcomes = routineLedger.list(id => runReceipts.getReceiptById(id), key => runReceipts.getReceiptByOccurrence(key)).slice(0, 12); }
  catch { routineOutcomes = [{ name: 'Routine history', status: 'unavailable', reason: 'History could not be read; new calendar dispatch is blocked until storage is repaired.' }]; }
  return { ...settingsStore.getSection('calendar'), routineOutcomes };
});
ipcMain.handle('routine-file-list', () => routineFiles.list());
ipcMain.handle('handoff-action', (event, action, options) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return {ok:false,error:'Pairing controls are available only in the primary local app window.'};
  if (typeof action !== 'string' || action.length > 32 || !options || typeof options !== 'object' || Array.isArray(options) || JSON.stringify(options).length > 16384) return {ok:false,error:'Invalid pairing request.'};
  return handoffService.get().handle(action, options);
});
ipcMain.handle('routine-file-preview', (event, text) => routineFiles.preview(text));
ipcMain.handle('routine-file-import', (event, text, policy) => routineFiles.import(text, policy));
ipcMain.handle('routine-file-adopt', (event, options) => routineFiles.adopt(options));
ipcMain.handle('routine-file-start', (event, id) => startTimer(routineFiles.timerOptions(id)));
ipcMain.handle('routine-file-open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Open routine file', properties: ['openFile'], filters: [{ name: 'Routine JSON', extensions: ['json'] }] });
  if (result.canceled || result.filePaths.length !== 1) return { cancelled: true };
  const file = result.filePaths[0], info = fs.statSync(file);
  if (!info.isFile() || info.size > routineModel.interchange.maxBytes) throw Error('Choose a JSON routine file up to 256 KiB');
  const bytes = fs.readFileSync(file);
  if (bytes.length > routineModel.interchange.maxBytes) throw Error('Routine file grew beyond 256 KiB');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw Error('Routine files must use UTF-8 text'); }
  routineFiles.preview(text); return { text };
});
ipcMain.handle('routine-file-export', async (event, selection) => {
  const text = JSON.stringify(routineFiles.export(selection), null, 2);
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Export routine file', defaultPath: 'lights-out-routines.json', filters: [{ name: 'Routine JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return { cancelled: true };
  if (!require('./durableJsonStore').writeTmpVerifyRename(result.filePath, text)) throw Error('Could not save the routine file');
  return { saved: true };
});
ipcMain.handle('get-companion-status', async () => {
  return companion.getStatus();
});
ipcMain.handle('get-remote-control', async () => {
  return getRemoteControlState();
});
// Render the companion pairing URL as a scannable QR data URL so the phone can
// pair by camera instead of typing a long URL + token. Returns '' on failure
// (the URL + code are still shown as text as a fallback).
ipcMain.handle('generate-qr', async (e, text) => {
  const state = getRemoteControlState();
  if (!state.ready || typeof text !== 'string' || !text || text !== state.url) return '';
  try {
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(text, {
      margin: 1,
      width: 220,
      color: { dark: '#0d0e11ff', light: '#ffffffff' }
    });
  } catch (err) {
    console.warn('QR generation failed:', err && err.message);
    return '';
  }
});
ipcMain.handle('set-remote-control-mode', async (e, mode) => {
  if (!['off', 'local', 'wifi'].includes(mode)) throw new Error('Invalid companion mode');
  const rc = settingsStore.getSection('remoteControl') || {};
  const patch = { mode, enabled: mode !== 'off' };
  // Generate a pairing token the first time remote control is turned on.
  if (mode !== 'off' && !rc.token) patch.token = remoteControl.generateToken();
  settingsStore.updateSection('remoteControl', patch);
  const state = await queueRemoteControlRestart();
  broadcastRemoteControlState();
  return state;
});
ipcMain.handle('regenerate-remote-token', async () => {
  const previous = settingsStore.getSection('remoteControl') || {};
  const previousToken = String(previous.token || '');
  await companion.revokeClients();
  settingsStore.updateSection('remoteControl', { token: remoteControl.generateToken() });
  if (previousToken) {
    try {
      if (clipboard.readText().includes(previousToken)) clipboard.clear();
    } catch { /* clipboard access is best effort */ }
  }
  const state = await queueRemoteControlRestart();
  broadcastRemoteControlState();
  return state;
});
ipcMain.handle('set-remote-control-port', async (e, requestedPort) => {
  const port = Number(requestedPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be a whole number from 1024 to 65535');
  }
  settingsStore.updateSection('remoteControl', { port });
  const state = await queueRemoteControlRestart();
  broadcastRemoteControlState();
  return state;
});
ipcMain.handle('retry-remote-control', async () => {
  const state = await queueRemoteControlRestart();
  broadcastRemoteControlState();
  return state;
});
ipcMain.handle('get-family-peers', async () => {
  return family.getPeers();
});
// The pairing token travels with every family command, so a command is only
// ever sent to an address that announced itself on this network (and has not
// expired). Any other address is refused here, before anything is sent.
const UNKNOWN_FAMILY_PEER = Object.freeze({ success: false, error: 'unknown peer' });
ipcMain.handle('family-remote-start', async (e, ip, durationSeconds, action) => {
  if (!family.isKnownPeer(ip)) return { ...UNKNOWN_FAMILY_PEER };
  return family.remoteStart(ip, durationSeconds, action);
});
ipcMain.handle('family-remote-pause', async (e, ip) => {
  if (!family.isKnownPeer(ip)) return { ...UNKNOWN_FAMILY_PEER };
  return family.remotePause(ip);
});
ipcMain.handle('family-remote-resume', async (e, ip) => {
  if (!family.isKnownPeer(ip)) return { ...UNKNOWN_FAMILY_PEER };
  return family.remoteResume(ip);
});
ipcMain.handle('family-remote-cancel', async (e, ip) => {
  if (!family.isKnownPeer(ip)) return { ...UNKNOWN_FAMILY_PEER };
  return family.remoteCancel(ip);
});
ipcMain.handle('family-remote-snooze', async (e, ip, seconds) => {
  if (!family.isKnownPeer(ip)) return { ...UNKNOWN_FAMILY_PEER };
  return family.remoteSnooze(ip, seconds || 300);
});
ipcMain.handle('get-media-sessions', async () => {
  try { return await media.detectMediaSessions(); } catch { return []; }
});
ipcMain.handle('wifi-guard-scan', async () => {
  try { return await wifiGuard.scanDevices(); } catch { return []; }
});
ipcMain.handle('wifi-guard-block', async () => {
  const config = settingsStore.getSection('wifiGuard');
  if (!config || !config.enabled) return { success: false, error: 'WiFi Guard not enabled' };
  return wifiGuard.blockInternet(config);
});
ipcMain.handle('wifi-guard-unblock', async () => {
  const config = settingsStore.getSection('wifiGuard');
  if (!config) return { success: false };
  return wifiGuard.unblockInternet(config);
});
ipcMain.handle('save-wifi-guard-settings', async (e, wifiSettings) => {
  const sanitized = capabilityTruth.sanitizeWifiGuard(wifiSettings);
  settingsStore.updateSection('wifiGuard', sanitized);
  return { saved: true, settings: sanitized };
});
ipcMain.handle('get-wifi-guard-settings', async () => {
  return settingsStore.getSection('wifiGuard');
});
ipcMain.handle('content-block', async (e, blocklist) => {
  return contentBlocker.blockSites(blocklist);
});
ipcMain.handle('content-unblock', async () => {
  return contentBlocker.unblockSites();
});
ipcMain.handle('content-block-status', async () => {
  return { blocked: contentBlocker.isBlocked(), sites: contentBlocker.getActiveBlocklist() };
});
ipcMain.handle('save-content-blocker-settings', async (e, s) => {
  const sanitized = capabilityTruth.sanitizeContentBlocker(s);
  settingsStore.updateSection('contentBlocker', sanitized);
  checkContentBlockerSchedules(); // re-evaluate immediately, don't wait up to 60s
  return { saved: true, settings: sanitized };
});
ipcMain.handle('get-content-blocker-settings', async () => {
  return settingsStore.getSection('contentBlocker');
});
ipcMain.handle('save-accountability-settings', async (e, s) => {
  const sanitized = capabilityTruth.sanitizeAccountability(s);
  settingsStore.updateSection('accountability', sanitized);
  return { saved: true, settings: sanitized };
});
ipcMain.handle('get-accountability-settings', async () => {
  return settingsStore.getSection('accountability');
});
ipcMain.handle('test-accountability-partner', async (e, partner) => {
  return accountability.testPartner(partner);
});

// Focus Sessions IPC.
ipcMain.handle('focus-start', async (e, preset, customConfig) => {
  return focusSessions.startFocusSession(preset, customConfig);
});
ipcMain.handle('focus-pause', async () => {
  return focusSessions.pauseFocusSession();
});
ipcMain.handle('focus-resume', async () => {
  return focusSessions.resumeFocusSession();
});
ipcMain.handle('focus-stop', async () => {
  return focusSessions.stopFocusSession();
});
ipcMain.handle('focus-state', async () => {
  return focusSessions.getFocusState();
});

// Screen Time IPC.
ipcMain.handle('get-screen-time', async () => {
  try { return await screenTime.getScreenTimeToday(); } catch { return null; }
});
ipcMain.handle('get-reality-check', async () => {
  try {
    const st = await screenTime.getScreenTimeToday();
    return screenTime.getRealityCheckMessage(st);
  } catch { return null; }
});

// Legacy IPC name retained for compatibility; payload is an estimated bedtime deficit.
ipcMain.handle('get-sleep-debt', async () => {
  try { return sleepDebt.getDebtSummary(); } catch { return null; }
});
ipcMain.handle('set-sleep-target', async (e, hours) => {
  return sleepDebt.setTargetHours(hours);
});
ipcMain.handle('set-wake-time', async (e, time) => {
  return sleepDebt.setWakeTime(time);
});

// Emergency Override IPC.
ipcMain.handle('get-override-consequences', async () => {
  return emergencyOverride.getOverrideConsequences(timerState);
});
ipcMain.handle('execute-override', async (e, reason) => {
  const result = await emergencyOverride.executeOverride(reason, timerState);
  // Overriding means "stay up" — authoritatively stop the timer and its pending
  // power action here in the main process, rather than depending on the renderer
  // to also call cancel. A snapshot of the pre-cancel state is returned so the UI
  // can still show what was overridden.
  const overridden = { ...timerState };
  if (timerState.running || timerState.paused) cancelTimer();
  return { ...result, timerState: overridden };
});

// Run Receipts IPC.
ipcMain.handle('get-latest-receipt', async () => {
  return runReceipts.getLatestReceipt();
});
ipcMain.handle('list-receipts', async (e, limit) => {
  return runReceipts.listReceipts(limit || 20);
});
ipcMain.handle('export-receipts', async () => {
  return runReceipts.getAllReceiptsForExport();
});
ipcMain.handle('clear-receipts', async () => {
  return runReceipts.clearReceipts();
});
ipcMain.handle('get-receipt-stats', async () => {
  return runReceipts.getReceiptStats();
});
// Night Modes IPC.
ipcMain.handle('get-night-modes-catalogue', async () => {
  return nightModes.getCatalogue();
});
ipcMain.handle('get-night-mode', async (e, id) => {
  return nightModes.getById(id);
});
ipcMain.handle('resolve-night-mode', async (e, nightModeId) => {
  return nightModes.resolveForExecution(nightModeId);
});
// "Use Tonight" — resolves the mode and returns canonical timer options
// without starting anything. The renderer loads these into the lobby.
ipcMain.handle('use-night-mode-tonight', async (e, nightModeId) => {
  const resolution = nightModes.resolveForExecution(nightModeId);
  if (!resolution.success) return resolution;
  // Return resolved options for the renderer to display in lobby.
  // The timer is NOT started here — selection remains inert.
  return {
    success: true,
    nightModeId: resolution.resolved.nightModeId,
    nightModeTitle: resolution.resolved.nightModeTitle,
    nightModeVersion: resolution.resolved.nightModeVersion,
    durationSeconds: resolution.resolved.durationSeconds,
    action: resolution.resolved.action,
    ritualId: resolution.resolved.ritualId
  };
});

// Override Tax IPC.
ipcMain.handle('assess-snooze-cost', async () => {
  return overrideTax.assessSnoozeCost();
});
ipcMain.handle('get-override-tax-stats', async () => {
  return overrideTax.getStats();
});
ipcMain.handle('get-override-tax-config', async () => {
  return overrideTax.getConfig();
});
ipcMain.handle('update-override-tax-config', async (e, updates) => {
  return overrideTax.updateConfig(updates);
});

// Autopilot Bedtime IPC.
ipcMain.handle('get-autopilot-status', async () => {
  return autopilot.getStatus();
});
ipcMain.handle('get-learned-bedtime', async () => {
  return autopilot.learnBedtime();
});
ipcMain.handle('enable-autopilot', async (e, enabled) => {
  const app = settingsStore.getSection('app') || {};
  settingsStore.updateSection('app', { ...app, autopilotEnabled: Boolean(enabled) });
  if (enabled) autopilot.schedule(startTimer, mainWindow);
  else autopilot.cancel();
  return autopilot.getStatus();
});

// Ritual Mode IPC.
ipcMain.handle('ritual-start', async (e, customSteps) => {
  // Manual Begin Ritual clears any pending profile-sourced context so it cannot
  // leak into this independently triggered ritual (unconditional clear).
  profileRitualContext.clear();
  // One run at a time: Begin Ritual never replaces an active countdown.
  if (timerState.running || timerState.paused) return { active: false, reason: 'run-active' };
  return ritualMode.startRitual(customSteps);
});
ipcMain.handle('ritual-advance', async () => {
  return ritualMode.advanceStep(false);
});
ipcMain.handle('ritual-skip', async () => {
  return ritualMode.skipStep();
});
ipcMain.handle('ritual-cancel', async () => {
  // User-initiated cancel: unconditional clear (no stale context left behind).
  profileRitualContext.clear();
  return ritualMode.cancelRitual();
});
ipcMain.handle('ritual-state', async () => {
  return ritualMode.getState();
});
ipcMain.handle('ritual-config', async () => {
  return ritualMode.getConfig();
});
ipcMain.handle('ritual-update-config', async (e, updates) => {
  return ritualMode.updateConfig(updates);
});

// Stats Dashboard IPC.
ipcMain.handle('get-full-dashboard', async () => {
  return statsDashboard.getFullDashboard();
});

// Smart Suggestions IPC.
ipcMain.handle('get-suggestions', async () => {
  return smartSuggestions.getSuggestions();
});

ipcMain.handle('get-idle-seconds', async () => {
  try { return await idleDetection.getIdleSeconds(); } catch { return 0; }
});
ipcMain.handle('set-idle-threshold', async (e, sec) => {
  idleDetection.setThreshold(sec);
  return { threshold: idleDetection.getThreshold() };
});
ipcMain.handle('set-bedtime-reminder', async (e, min) => {
  bedtimeReminder.setMinutesBefore(min);
  return { minutesBefore: bedtimeReminder.getMinutesBefore() };
});
ipcMain.handle('set-calendar-auto-start', async (e, enabled) => {
  const cal = settingsStore.getSection('calendar') || {};
  cal.autoStartFromEvents = !!enabled;
  settingsStore.updateSection('calendar', cal);
  return { autoStartFromEvents: cal.autoStartFromEvents };
});
ipcMain.handle('resume-recoverable-timer', async () => {
  const snapshot = getRecoverableTimer();
  if (!snapshot) return { success: false };
  // Same pre-upgrade fallback as the startup reconciliation pass: a
  // snapshot saved before receiptId existed can't name its receipt
  // directly, so fall back to the most recently running one.
  const resumeReceiptId = snapshot.receiptId || runReceipts.getMostRecentRunningReceiptId();
  const result = startTimer({
    durationSeconds: snapshot.remainingSeconds,
    action: snapshot.action,
    dryRun: snapshot.dryRun,
    forceShutdown: snapshot.forceShutdown,
    muteSystem: snapshot.muteSystem,
    gracePeriod: snapshot.gracePeriod,
    origin: 'resume',
    resumeReceiptId
  }, undefined, snapshot.routineOccurrenceKey || runReceipts.getReceiptById(resumeReceiptId)?.routineOccurrenceKey || null);
  return result;
});

// Smart Lights IPC handlers
ipcMain.handle('get-smartlight-config', async () => smartLights.getPublicConfig());
ipcMain.handle('save-smartlight-config', async (event, settings) => {
  smartLights.loadConfig(settings);
  const merged = smartLights.getConfig();
  settingsStore.updateSection('smartLights', merged);
  return smartLights.getPublicConfig();
});
ipcMain.handle('test-smartlight-connection', async () => smartLights.verifySmartLightConnection());
ipcMain.handle('test-smartlight-action', async () => smartLights.testSmartLightAction());
ipcMain.handle('discover-hue-bridge', async () => smartLights.findHueBridge());
ipcMain.handle('discover-wiz-lights', async () => smartLights.discoverWizLights());
ipcMain.handle('register-hue-bridge', async (event, bridgeIp) => smartLights.registerHueBridge(bridgeIp));
ipcMain.handle('get-hue-lights', async (event, bridgeIp, username) => smartLights.getHueLights(bridgeIp, username));
ipcMain.handle('get-hue-groups', async (event, bridgeIp, username) => smartLights.getHueGroups(bridgeIp, username));

// Profiles IPC handlers
ipcMain.handle('profiles-get-all', async () => profiles.getAll());
ipcMain.handle('profiles-get-by-id', async (event, id) => profiles.getById(id));
ipcMain.handle('profiles-create', async (event, data) => profiles.create(data));
ipcMain.handle('profiles-update', async (event, id, data) => profiles.update(id, data));
ipcMain.handle('profiles-delete', async (event, id) => {
  const result = profiles.delete(id);
  if (result.success) profileIdentity.reconcilePersistedSelection(settingsStore, profiles);
  return result;
});
ipcMain.handle('profiles-reorder', async (event, orderedIds) => profiles.reorder(orderedIds));
ipcMain.handle('profiles-apply', async (event, id) => {
  const result = profiles.apply(id);
  if (result.success) {
    const updated = profiles.markUsed(id);
    if (updated) result.profile = updated;
  }
  return result;
});
ipcMain.handle('profiles-get-hint', async (event, profile) => profiles.getHint(profile));
ipcMain.handle('profiles-export', async () => profiles.export());
ipcMain.handle('profiles-import', async (event, jsonString) => {
  const result = profiles.import(jsonString);
  if (result.success) profileIdentity.reconcilePersistedSelection(settingsStore, profiles);
  return result;
});
ipcMain.handle('profiles-create-defaults', async () => profiles.createDefaults());

// Calendar IPC handlers
ipcMain.handle('calendar-parse-text', async (event, text) => {
  try {
    const result = calendar.importIcsFromText(text);
    // Convert Date objects to ISO strings for IPC serialization
    result.events = result.events.map(e => ({
      ...e,
      start: e.start ? e.start.toISOString() : null,
      end: e.end ? e.end.toISOString() : null
    }));
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('calendar-import-url', async (event, url) => {
  try {
    const result = await calendar.importIcsFromUrl(url);
    // Convert Date objects to ISO strings for IPC serialization
    result.events = result.events.map(e => ({
      ...e,
      start: e.start ? e.start.toISOString() : null,
      end: e.end ? e.end.toISOString() : null
    }));
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('calendar-test-url', async (event, url) => calendar.testCalendarFeedUrl(url));

ipcMain.handle('calendar-get-upcoming', async (event, events, from, withinDays, maxCount) => {
  // Convert ISO strings back to Date objects
  const parsedEvents = events.map(e => ({
    ...e,
    start: e.start ? new Date(e.start) : null,
    end: e.end ? new Date(e.end) : null
  }));
  const fromDate = from ? new Date(from) : new Date();
  const upcoming = calendar.getUpcomingEvents(parsedEvents, fromDate, withinDays, maxCount);
  return upcoming.map(e => ({
    ...e,
    start: e.start ? e.start.toISOString() : null,
    end: e.end ? e.end.toISOString() : null
  }));
});

ipcMain.handle('calendar-create-timer', async (event, evt, action, options) => {
  try {
    // Convert ISO strings back to Date objects
    const eventObj = {
      ...evt,
      start: evt.start ? new Date(evt.start) : null,
      end: evt.end ? new Date(evt.end) : null
    };
    const result = calendar.createTimerFromEvent(eventObj, action, options);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('calendar-format-time', async (event, isoString) => calendar.formatEventTime(isoString ? new Date(isoString) : null));

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('toggle-maximize-window', () => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.miniMode) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on('toggle-mini-mode', () => {
  if (!mainWindow) return;
  const enteringMiniMode = !miniMode;
  if (enteringMiniMode) windowGeometry.enterMiniMode(mainWindow);

  miniMode = enteringMiniMode;
  mainWindow.miniMode = miniMode;

  if (miniMode) {
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else {
    mainWindow.setAlwaysOnTop(false);
    windowGeometry.exitMiniMode(mainWindow, screen);
  }

  mainWindow.webContents.send('mini-mode-changed', miniMode);
});

// Desktop widget: tiny always-on-top "bed in N min" clock.
function persistWidgetVisibility(visible) {
  settingsStore.updateSection('app', { widgetVisible: Boolean(visible) });
}

async function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    updateWidget();
    const visible = widgetWindow.isVisible();
    if (visible) persistWidgetVisibility(true);
    return visible;
  }
  widgetWindow = new BrowserWindow({
    // Wide enough for the static Test Mode / REAL line ('REAL · HIBERNATE AT
    // END', 'REAL · FORCED SHUTDOWN') next to the ring and the close button.
    width: 232,
    height: 52,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  widgetWindow.setVisibleOnAllWorkspaces(true);
  widgetWindow.setPosition(20, 20); // top-left corner
  widgetWindow.on('closed', () => {
    widgetWindow = null;
    widgetMode = false;
    if (!app.isQuitting) persistWidgetVisibility(false);
  });
  try {
    await widgetWindow.loadFile('widget.html');
    if (!widgetWindow || widgetWindow.isDestroyed()) return false;
    widgetMode = true;
    updateWidget();
    widgetWindow.show();
    const visible = widgetWindow.isVisible();
    if (visible) persistWidgetVisibility(true);
    return visible;
  } catch (err) {
    console.error('Desktop widget failed to load:', err.message);
    closeWidgetWindow();
    return false;
  }
}

function closeWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
  widgetWindow = null;
  widgetMode = false;
  if (!app.isQuitting) persistWidgetVisibility(false);
  return false;
}

function updateWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const running = timerState.running || timerState.paused;
  const remaining = running ? formatTime(timerState.remainingSeconds) : '';
  const phase = timerState.phase || 'idle';
  // The run's own mode while a run is active; the setting while idle.
  const dryRun = running ? Boolean(timerState.dryRun) : Boolean((settingsStore.getSection('app') || {}).dryRun);
  const ratio = running && timerState.totalSeconds > 0
    ? Math.max(0, Math.min(1, timerState.remainingSeconds / timerState.totalSeconds))
    : 0;
  widgetWindow.webContents.send('widget-update', {
    running,
    paused: timerState.paused,
    remaining,
    phase,
    action: timerState.action,
    dryRun,
    forceShutdown: Boolean(timerState.forceShutdown),
    ratio
  });
}

ipcMain.handle('toggle-widget', async () => {
  if (widgetMode) return { success: true, visible: closeWidgetWindow() };
  const visible = await createWidgetWindow();
  return { success: visible, visible };
});

ipcMain.on('close-widget', () => {
  closeWidgetWindow();
});

ipcMain.on('show-notification', (event, title, body) => {
  showNativeNotification(title, body);
});

ipcMain.on('play-sound', (event, soundType) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('play-sound', soundType);
  }
});

ipcMain.on('set-progress', (event, percent, mode) => {
  setTaskbarProgress(percent, mode);
});

ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.hide();
  refreshTrayMenu();
});

ipcMain.on('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});

ipcMain.on('open-external', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    shell.openExternal(url);
  }
});

// Auto-fit the window height to the renderer's content (idle/full view only),
// clamped to a sensible floor and the current display's work area.
ipcMain.on('fit-window-height', (event, contentHeight) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.miniMode) return;
  if (mainWindow.restoredBounds) return;
  if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
  const desired = Math.round(Number(contentHeight) || 0);
  if (desired < 200) return;
  const [w, curH] = mainWindow.getContentSize();
  const work = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
  const maxH = Math.max(600, work.height - 48);
  const target = Math.max(600, Math.min(desired, maxH));
  if (Math.abs(curH - target) > 2) mainWindow.setContentSize(w, target);
});

// Full-screen clock mode: reuses the existing main window (no new
// BrowserWindow, no multi-monitor picker) -- the renderer hides all other
// chrome and enlarges the analog clock via CSS. Disabled in mini mode,
// where the window is deliberately small and always-on-top instead.
ipcMain.handle('set-fullscreen-clock', (event, flag) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.miniMode) return { fullScreen: false };
  mainWindow.setFullScreen(!!flag);
  return { fullScreen: mainWindow.isFullScreen() };
});

function setupJumpList() {
  if (!app.setUserTasks) return;

  app.setUserTasks([
    {
      program: process.execPath,
      arguments: '--timer=5',
      iconPath: process.execPath,
      iconIndex: 0,
      title: 'Start 5 min timer',
      description: 'Start a 5 minute shutdown timer'
    },
    {
      program: process.execPath,
      arguments: '--timer=15',
      iconPath: process.execPath,
      iconIndex: 0,
      title: 'Start 15 min timer',
      description: 'Start a 15 minute shutdown timer'
    },
    {
      program: process.execPath,
      arguments: '--timer=30',
      iconPath: process.execPath,
      iconIndex: 0,
      title: 'Start 30 min timer',
      description: 'Start a 30 minute shutdown timer'
    }
  ]);
}

function registerGlobalShortcuts() {
  // Ctrl+Shift+L: Quick 15-min timer
  globalShortcut.register('Ctrl+Shift+L', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      startQuickTimer({ minutes: 15, origin: 'shortcut' });
    }
  });

  // Ctrl+Shift+S: Show/hide window
  globalShortcut.register('Ctrl+Shift+S', toggleMainWindow);

  // Ctrl+Shift+P: Preview Last Light
  globalShortcut.register('Ctrl+Shift+P', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      const cfg = settingsStore.getSection('lastLight') || {};
      const appCfg = settingsStore.getSection('app') || {};
      mainWindow.webContents.send('play-last-light', {
        sequence: lastLight.normalizeId(cfg.sequence),
        dryRun: true,
        sound: cfg.sound || 'Off',
        // Preview only (still dryRun): the facts panel names the configured ending.
        action: typeof appCfg.action === 'string' ? appCfg.action : undefined
      });
    }
  });

  // Ctrl+Shift+Space: Pause/Resume toggle
  globalShortcut.register('Ctrl+Shift+Space', () => {
    if (timerState.paused) {
      resumeTimer();
      showNativeNotification('Lights Out', 'Timer resumed');
    } else if (timerState.running) {
      pauseTimer();
      showNativeNotification('Lights Out', 'Timer paused');
    }
  });

  // Ctrl+Shift+Z: Snooze +5 min
  globalShortcut.register('Ctrl+Shift+Z', () => {
    if (timerState.running || timerState.paused) {
      snoozeTimer(300);
      showNativeNotification('Lights Out', 'Snoozed +5 minutes');
    }
  });

  // Ctrl+Shift+X: Cancel timer
  globalShortcut.register('Ctrl+Shift+X', () => {
    if (timerState.running || timerState.paused) {
      cancelTimer();
      showNativeNotification('Lights Out', 'Timer cancelled');
    }
  });

  // Ctrl+Shift+1: 30-min timer
  globalShortcut.register('Ctrl+Shift+1', () => {
    startQuickTimer({ minutes: 30, origin: 'shortcut' });
  });

  // Ctrl+Shift+2: 45-min timer
  globalShortcut.register('Ctrl+Shift+2', () => {
    startQuickTimer({ minutes: 45, origin: 'shortcut' });
  });

  // Ctrl+Shift+3: 60-min timer
  globalShortcut.register('Ctrl+Shift+3', () => {
    startQuickTimer({ minutes: 60, origin: 'shortcut' });
  });

  // Ctrl+Shift+4: 90-min timer
  globalShortcut.register('Ctrl+Shift+4', () => {
    startQuickTimer({ minutes: 90, origin: 'shortcut' });
  });

  // Ctrl+Shift+W: Toggle widget
  globalShortcut.register('Ctrl+Shift+W', () => {
    if (widgetMode) closeWidgetWindow();
    else createWidgetWindow();
  });

  // Ctrl+Shift+A: Toggle alarm
  globalShortcut.register('Ctrl+Shift+A', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('toggle-alarm-focus');
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      writeStartupLog('Second instance requested window recreation');
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    refreshTrayMenu();
  });
}

function setupRitualCallbacks() {
  // Register before the renderer becomes interactive. Previously these were
  // installed only after remote-control startup and several other async
  // services, leaving a launch window where Use Tonight could start a ritual
  // whose timer step had no side-effect handler.
  ritualMode.onStep((step, state, runMeta, runId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ritual-step', { step, state });
    }
    const runToken = runMeta && runMeta.profileRitualToken ? runMeta.profileRitualToken : null;
    try {
      if (step.id === 'block') {
        const cbConfig = settingsStore.getSection('contentBlocker');
        if (cbConfig && cbConfig.enabled) {
          const sites = contentBlocker.DEFAULT_BLOCKLIST;
          contentBlocker.blockSites(sites).catch(() => {});
        }
      } else if (step.id === 'dim') {
        const appSettings = settingsStore.getSection('app') || {};
        if (appSettings.nightLightOnDim) applyDimPhase(0, 0);
      } else if (step.id === 'timer') {
        const ctx = profileRitualContext.consume(runToken);
        if (runToken && !ctx) throw Error('Ritual timer context is unavailable');
        if (ctx) {
          beginValidatedCountdown(
            { durationSeconds: ctx.durationSeconds, action: ctx.action, dryRun: ctx.dryRun,
              forceShutdown: ctx.forceShutdown, muteSystem: ctx.muteSystem, gracePeriod: ctx.gracePeriod,
              source: 'ritual', origin: ctx.origin || 'ritual', routineOccurrenceKey: ctx.routineOccurrenceKey },
            { profileId: ctx.profileId, profileName: ctx.profileName },
            { nightModeId: ctx.nightModeId || null, nightModeTitle: ctx.nightModeTitle || null, nightModeVersion: ctx.nightModeVersion || null }
          );
        } else {
          const app = settingsStore.getSection('app') || {};
          const config = ritualMode.getConfig();
          beginValidatedCountdown(
            { durationSeconds: config.timerDuration, action: config.timerAction, source: 'ritual',
              dryRun: Boolean(app.dryRun), forceShutdown: false, muteSystem: false,
              gracePeriod: Number.isFinite(Number(app.graceMinutes)) ? Number(app.graceMinutes) : 2, origin: 'ritual' },
            { profileId: null, profileName: null },
            null
          );
        }
      } else if (step.id === 'lights') {
        const lightsConfig = settingsStore.getSection('smartLights');
        if (lightsConfig && lightsConfig.enabled) {
          smartLights.applyScene('night').catch(() => {});
        }
      }
    } catch (err) {
      if (runMeta?.routineOccurrenceKey) {
        try { routineLedger.finishPending(runMeta.routineOccurrenceKey, 'failed', 'ritual-step-failed'); } catch { /* history unavailable */ }
      }
      if (runToken) profileRitualContext.clearIfOwned(runToken);
      ritualMode.cancelIfCurrent(runId);
      console.error('[ritual-step-error]', err);
    }
  });
  ritualMode.onComplete((state, runMeta) => {
    if (runMeta?.routineOccurrenceKey) {
      try { routineLedger.finishPending(runMeta.routineOccurrenceKey, 'failed', 'ritual-ended-without-timer'); } catch { /* history unavailable */ }
    }
    const runToken = runMeta && runMeta.profileRitualToken ? runMeta.profileRitualToken : null;
    if (runToken) profileRitualContext.clearIfOwned(runToken);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ritual-complete', state);
    }
  });
  ritualMode.onCancel?.((state, runMeta) => {
    if (runMeta?.profileRitualToken) profileRitualContext.clearIfOwned(runMeta.profileRitualToken);
    if (runMeta?.routineOccurrenceKey) {
      try { routineLedger.finishPending(runMeta.routineOccurrenceKey, 'cancelled', 'ritual-cancelled'); } catch { /* history unavailable */ }
    }
  });
}

app.whenReady().then(async () => {
  // Readiness may already be queued when a secondary instance calls quit.
  if (!gotTheLock) return;

  cleanupStalePortableExtracts();

  // Deny all browser permissions by default. Lights Out loads only local
  // content and does not require camera, microphone, geolocation, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  // Load persisted settings and rehydrate the smart-lights module.
  settingsStore.load();
  smartLights.loadConfig(settingsStore.getSection('smartLights'));

  // Finalize any run receipt left at result:'running' by a process that
  // ended (crash, force-kill, power loss) before it reached a terminal
  // update. The one still-recoverable timer (if any) stays protected until
  // the user resumes, discards, or it plays out via the recovery banner.
  {
    const recoverable = getRecoverableTimer();
    // A snapshot persisted by a pre-upgrade build won't carry receiptId --
    // fall back to correlating by "most recently running" so a genuinely
    // still-recoverable run isn't wrongly finalized as orphaned.
    const protectedReceiptId = recoverable
      ? (recoverable.receiptId || runReceipts.getMostRecentRunningReceiptId())
      : null;
    runReceipts.reconcileOrphanedRunningReceipts(protectedReceiptId);
    try { routineLedger.interruptPending(); } catch (error) { console.error('[routine-history-recovery]', error); }
  }

  // Load custom Last Light sequences from settings.
  const llSettings = settingsStore.getSection('lastLight') || {};
  if (llSettings.customSequences) lastLight.loadCustomSequences(llSettings.customSequences);

  // Initialize profiles module
  const profileCount = profiles.initialize();
  console.log(`Loaded ${profileCount} profiles`);

  setupRitualCallbacks();
  createWindow();
  await createTray();
  setupJumpList();
  registerGlobalShortcuts();

  if (settingsStore.getSection('app')?.widgetVisible) {
    await createWidgetWindow();
  }

  // Test-only: clean deterministic exit for automated packaging/uninstall proofs.
  if (launchOptions.quitAfterStart && Number.isFinite(launchOptions.quitAfterStart)) {
    setTimeout(() => {
      writeStartupLog(`test-quit-after-start triggered after ${launchOptions.quitAfterStart}ms`);
      app.quit();
    }, Math.max(1, Number(launchOptions.quitAfterStart)));
  }

  // If launched via --first-light, run the First Light sunrise sequence.
  if (launchOptions.firstLight) {
    playFirstLight();
  }

  // Start periodic update checker.
  updater.startPeriodicCheck((result) => {
    if (result.available) {
      showNativeNotification('Lights Out Update', `v${result.latestVersion} available. Click to download.`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', result);
      }
    }
  });

  // Companion + family remote control. Listeners are registered once; the
  // servers only bind when the user explicitly enables remote control.
  companion.onMessage((msg, client) => {
    handleCompanionMessage(msg, client);
  });
  companion.onConnect(() => {
    // Send initial state + streaks on connect.
    setTimeout(() => {
      broadcastCompanionState();
      try {
        const summary = streaks.getSummary();
        companion.broadcast({ type: 'streaks', streak: summary.streak || 0, bestStreak: summary.bestStreak || 0 });
      } catch (e) {
        console.error('Failed to broadcast streaks to companion:', e);
      }
    }, 500);
  });
  companion.onStatus((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote-control-status', getRemoteControlState());
    }
    enrichCompanionFailure(status);
  });

  // Broadcast timer state to connected companion clients periodically.
  setInterval(broadcastCompanionState, 2000);

  // Start remote control only if enabled in settings (off by default).
  await queueRemoteControlRestart();
  startCompanionNetworkMonitor();

  // Focus Sessions: forward ticks and phase changes to renderer.
  focusSessions.onTick((fs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('focus-tick', fs);
    }
  });
  focusSessions.onPhase((phase, fs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('focus-phase', { phase, ...fs });
    }
    // Play sound on phase transitions.
    if (phase === 'break' || phase === 'longbreak') {
      showNativeNotification('Focus Session', 'Break time! Rest your eyes.');
    } else if (phase === 'focus') {
      showNativeNotification('Focus Session', 'Focus time! Get back to work.');
    }
  });
  focusSessions.onComplete((fs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('focus-complete', fs);
    }
    showNativeNotification('Focus Session', `All cycles done! ${Math.round(fs.totalFocusTime / 60)} min of deep work.`);
  });

  // Idle Detection: nudge when user walks away during wind-down.
  const appSettings = settingsStore.getSection('app') || {};
  idleDetection.startMonitoring({
    thresholdSeconds: appSettings.idleDetectionEnabled === false ? 0 : (appSettings.idleThresholdSeconds || 300),
    onIdle: (idleSec) => {
      const currentApp = settingsStore.getSection('app') || {};
      if (currentApp.idleDetectionEnabled === false) return;
      if (timerState.running && !timerState.paused) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('idle-detected', { idleSeconds: idleSec });
        }
      }
    },
    onReturn: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('user-returned');
      }
    }
  });

  // Bedtime Reminder: gentle nudge 15 min before bedtime.
  bedtimeReminder.startReminder({
    minutesBefore: appSettings.bedtimeReminderEnabled === false ? 0 : (appSettings.bedtimeReminderMinutes || 15),
    onReminder: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bedtime-reminder', data);
      }
    }
  });

  // Autopilot Bedtime: schedule learned bedtime auto-start.
  autopilot.schedule(startTimer, mainWindow);

  // Calendar Auto-Start: check for upcoming events and auto-start timer.
  setInterval(checkCalendarAutoStart, 60000);

  // Content Blocker recurring schedules: check every minute, plus once
  // immediately so a schedule that's already active doesn't wait up to a
  // minute after launch to take effect.
  setInterval(checkContentBlockerSchedules, 60000);
  checkContentBlockerSchedules();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray.
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
  if (companionNetworkMonitor) {
    clearInterval(companionNetworkMonitor);
    companionNetworkMonitor = null;
  }
  clearTimerInterval();
  profileRitualContext.clear();
  globalShortcut.unregisterAll();
  stopRemoteControl();
  idleDetection.stopMonitoring();
  bedtimeReminder.stopReminder();
});
