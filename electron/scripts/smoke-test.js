// Lightweight smoke checks for the Electron edition.
// Covers what can be verified without a display: JS syntax, settings persistence
// round-trip, smart-light config round-trip, icon validity, safe-startup wording,
// and presence of the core UI controls from the AGENTS.md checklist.
// Run with: node scripts/smoke-test.js  (or npm run smoke)

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name} -> ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertMatch(src, pattern, msg) {
  assert(pattern.test(src), msg || `missing pattern: ${pattern}`);
}

// 1. Syntax-check every first-party JS file.
const jsFiles = ['main.js', 'preload.js', 'renderer.js', 'settings.js', 'smartLights.js', 'profiles.js', 'calendar.js', 'lastLight.js'];
for (const file of jsFiles) {
  check(`syntax: ${file}`, () => {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  });
}

// 2. Mock electron so main-process modules load under plain Node.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-smoke-'));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => tmpDir } };
  }
  return origLoad.apply(this, arguments);
};

// 3. settings.js persistence round-trip.
check('settings: defaults load', () => {
  const settings = require(path.join(root, 'settings.js'));
  const all = settings.getAll();
  assert(all.app && all.customization, 'missing default sections');
  assert(all.customization.accent === '#5b8cff', 'unexpected default accent');
  assert(all.app.clockFace === 'hybrid', 'clock face default should be hybrid');
  assert(all.app.clockDial === 'bars', 'clock dial default should be hour markers');
});

check('settings: updateSection persists to disk', () => {
  const settings = require(path.join(root, 'settings.js'));
  settings.updateSection('customization', { accent: '#a855f7', volume: 0.5 });
  const file = path.join(tmpDir, 'settings.json');
  assert(fs.existsSync(file), 'settings.json not written');
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(disk.customization.accent === '#a855f7', 'accent not persisted');
  assert(disk.customization.theme === 'midnight', 'merge dropped sibling key');
});

check('settings: active-timer round-trip', () => {
  const settings = require(path.join(root, 'settings.js'));
  const endsAt = new Date(Date.now() + 600000).toISOString();
  settings.setActiveTimer({ action: 'shutdown', endsAt, remainingSeconds: 600, paused: false });
  const got = settings.getActiveTimer();
  assert(got && got.endsAt === endsAt, 'active timer not stored');
  settings.setActiveTimer(null);
  assert(settings.getActiveTimer() === null, 'active timer not cleared');
});

// 4. smartLights config round-trip.
check('smartLights: loadConfig/getConfig round-trip', () => {
  const smartLights = require(path.join(root, 'smartLights.js'));
  smartLights.loadConfig({ enabled: true, provider: 'hue', dimMinutes: 7 });
  const cfg = smartLights.getConfig();
  assert(cfg.enabled === true && cfg.provider === 'hue' && cfg.dimMinutes === 7, 'config not applied');
});

check('settings: lastLight defaults present', () => {
  const settings = require(path.join(root, 'settings.js'));
  const ll = settings.getSection('lastLight');
  assert(ll && ll.sequence === 'ClassicFade' && ll.enabled === false, 'lastLight defaults wrong');
});

// 4b. profiles normalize lastLight fields (pure logic, no disk I/O).
check('profiles: lastLight fields in normalized profile', () => {
  const profiles = require(path.join(root, 'profiles.js'));
  const norm = profiles.normalize({ name: 'Test LL', lastLightEnabled: true, lastLightSequence: 'ExitTheGrid', lastLightSound: 'Soft' });
  assert(norm && norm.lastLightEnabled === true && norm.lastLightSequence === 'ExitTheGrid' && norm.lastLightSound === 'Soft', 'lastLight fields not preserved');
});

Module._load = origLoad;

// 4b. lastLight sequence catalog + timing.
check('lastLight: catalog, steps, and duration', () => {
  const ll = require(path.join(root, 'lastLight.js'));
  assert(ll.getCatalog().length === 4, 'expected 4 sequences');
  assert(ll.normalizeId('exit_the grid') === 'ExitTheGrid', 'normalizeId failed');
  assert(ll.getSteps('ExitTheGrid', false).length >= 4, 'missing steps');
  const full = ll.getDurationMs('ExitTheGrid', false);
  const dry = ll.getDurationMs('ExitTheGrid', true);
  assert(full > 0 && dry > 0 && dry < full, 'dry-run should be shorter');
});

// 5. Icon validity.
check('icon: assets/icon.ico is a valid multi-size ICO', () => {
  const ico = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
  assert(ico.length > 1000, 'icon too small');
  assert(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, 'bad ICO header');
  assert(ico.readUInt16LE(4) >= 5, 'expected multiple icon sizes');
});

// 6. Safe-startup guarantees (guards against AGENTS.md "Do Not Reintroduce").
const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
check('startup: login wording stays "minimized and idle"', () => {
  assert(/Starts minimized and idle/.test(mainSrc), 'login wording changed');
});
check('startup: login args use --minimized --no-auto-start', () => {
  assert(/--minimized'/.test(mainSrc) && /--no-auto-start'/.test(mainSrc), 'login args regressed');
});
check('startup: no default force-shutdown auto-start', () => {
  assert(!/openAtLogin:\s*true/.test(mainSrc), 'login should not be forced on');
});

check('startup: launch flags still parse minimized, no-auto-start, timer, and action', () => {
  assertMatch(mainSrc, /if \(lower === '--minimized' \|\| lower === '--minimized-to-tray'\) options\.minimized = true;/, 'minimized flag parser changed');
  assertMatch(mainSrc, /if \(lower === '--no-auto-start'\) options\.noAutoStart = true;/, 'no-auto-start flag parser changed');
  assertMatch(mainSrc, /if \(lower\.startsWith\('--timer='\)\) options\.timerMinutes = Number\(lower\.split\('='\)\[1\]\) \|\| 0;/, 'timer flag parser changed');
  assertMatch(mainSrc, /if \(lower\.startsWith\('--action='\)\) options\.action = lower\.split\('='\)\[1\] \|\| 'shutdown';/, 'action flag parser changed');
});

check('startup: portable temp cleanup only targets stale Lights Out extractions', () => {
  assertMatch(mainSrc, /function getPortableExtractionRoot\(\) \{[\s\S]*os\.tmpdir\(\)[\s\S]*exeName !== 'lights out\.exe'[\s\S]*resources', 'app\.asar'/s, 'portable extraction detector missing');
  assertMatch(mainSrc, /function cleanupStalePortableExtracts\(\) \{[\s\S]*!\/\^3F\/i\.test\(entry\.name\)[\s\S]*candidateExe = path\.join\(candidate, 'Lights Out\.exe'\)[\s\S]*candidateAsar = path\.join\(candidate, 'resources', 'app\.asar'\)/s, 'portable cleanup scope changed');
  assertMatch(mainSrc, /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*cleanupStalePortableExtracts\(\);/s, 'portable cleanup not called at startup');
});

check('tray: initialization and cleanup', () => {
  assertMatch(mainSrc, /let tray = null;/, 'tray variable missing');
  assertMatch(mainSrc, /async function createTray\(\) \{/, 'createTray function missing');
  assertMatch(mainSrc, /tray = new Tray\(trayIcons\.idle\);/, 'tray creation missing');
});

check('tray: hide/show and toggle logic', () => {
  assertMatch(mainSrc, /function toggleMainWindow\(\) \{/, 'toggleMainWindow function missing');
  assertMatch(mainSrc, /if \(mainWindow\.isVisible\(\)\) \{[\s\S]*mainWindow\.hide\(\);/s, 'toggleMainWindow hide logic missing');
  assertMatch(mainSrc, /\} else \{[\s\S]*mainWindow\.show\(\);/s, 'toggleMainWindow show logic missing');
  assertMatch(mainSrc, /tray\.on\('click', toggleMainWindow\);/, 'tray click event not wired to toggle');
});

check('mini-mode: toggle and resizing', () => {
  assertMatch(mainSrc, /let miniMode = false;/, 'miniMode variable missing');
  assertMatch(mainSrc, /ipcMain\.on\('toggle-mini-mode', \(\) => \{[\s\S]*miniMode = !miniMode;/s, 'miniMode toggle missing');
  assertMatch(mainSrc, /if \(miniMode\) \{[\s\S]*mainWindow\.setSize\(260, 320\);/s, 'mini-mode resize missing');
  assertMatch(mainSrc, /mainWindow\.webContents\.send\('mini-mode-changed', miniMode\);/, 'mini-mode-changed event missing');
});

check('tray: close-to-tray behavior remains the default window close action', () => {
  assertMatch(mainSrc, /mainWindow\.on\('close', event => \{\s+if \(app\.isQuitting\) return;\s+event\.preventDefault\(\);\s+mainWindow\.hide\(\);\s+refreshTrayMenu\(\);\s+\}\);/s, 'window close no longer hides to tray');
});

check('tray: menu keeps show-hide, settings, timer controls, and quick starts', () => {
  assertMatch(mainSrc, /label: mainWindow && mainWindow\.isVisible\(\) \? 'Hide to Tray' : 'Show Lights Out'/, 'tray show/hide label missing');
  assertMatch(mainSrc, /label: 'Open Settings'[\s\S]*mainWindow\.webContents\.send\('open-settings'\);/s, 'tray settings action missing');
  assertMatch(mainSrc, /label: timerState\.paused \? 'Resume' : 'Pause'/, 'tray pause/resume action missing');
  assertMatch(mainSrc, /Snooze \+5 min/, 'tray snooze action missing');
  assertMatch(mainSrc, /label: 'Cancel Timer'/, 'tray cancel action missing');
  assertMatch(mainSrc, /label: 'Start 28 min'/, 'tray 28 min quick start missing');
  assertMatch(mainSrc, /label: 'Start 1 hour'/, 'tray 1 hour quick start missing');
  assertMatch(mainSrc, /label: 'Quit'/, 'tray quit action missing');
});

check('tray: tooltip updates and menu rebuild guard still exist', () => {
  assertMatch(mainSrc, /if \(!timerState\.running && !timerState\.paused\) \{\s+tray\.setToolTip\('Lights Out - idle'\);/s, 'idle tray tooltip missing');
  assertMatch(mainSrc, /tray\.setToolTip\(`Lights Out - \$\{prefix\}, \$\{formatTime\(timerState\.remainingSeconds\)\} left`\);/, 'active tray tooltip missing');
  assertMatch(mainSrc, /Only rebuild the tray context menu on real state transitions, not every[\s\S]*if \(type !== 'tick'\) refreshTrayMenu\(\);/s, 'per-tick tray menu rebuild guard missing');
});

check('timer: pause, resume, snooze, and cancel state transitions remain wired in main', () => {
  assertMatch(mainSrc, /function pauseTimer\(\) \{[\s\S]*timerState\.paused = true;[\s\S]*emitTimerUpdate\('paused'\);/s, 'pause timer flow changed');
  assertMatch(mainSrc, /function resumeTimer\(\) \{[\s\S]*timerState\.paused = false;[\s\S]*emitTimerUpdate\('resumed'\);/s, 'resume timer flow changed');
  assertMatch(mainSrc, /function snoozeTimer\(seconds = 300, reason\) \{[\s\S]*timerState\.totalSeconds \+= addSeconds;[\s\S]*timerState\.remainingSeconds \+= addSeconds;[\s\S]*emitTimerUpdate\('snoozed', \{ addedSeconds: addSeconds, tax: taxResult \}\);/s, 'snooze timer flow changed');
  assertMatch(mainSrc, /function cancelTimer\(\) \{[\s\S]*timerState\.running = false;[\s\S]*timerState\.phase = 'idle';[\s\S]*emitTimerUpdate\('cancelled'\);/s, 'cancel timer flow changed');
});

check('ipc: timer and login handlers remain exposed from main', () => {
  assertMatch(mainSrc, /ipcMain\.handle\('start-timer', async \(event, options, legacyAction\) => startTimer\(options, legacyAction\)\);/, 'start-timer IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('cancel-timer', async \(\) => cancelTimer\(\)\);/, 'cancel-timer IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('pause-timer', async \(\) => pauseTimer\(\)\);/, 'pause-timer IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('resume-timer', async \(\) => resumeTimer\(\)\);/, 'resume-timer IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('snooze-timer', async \(event, seconds, reason\) => snoozeTimer\(seconds, reason\)\);/, 'snooze-timer IPC missing');
  assertMatch(mainSrc, /app\.setLoginItemSettings\(\{[\s\S]*openAtLogin: Boolean\(enabled\),[\s\S]*openAsHidden: false,[\s\S]*args: \['--minimized', '--no-auto-start'\]/s, 'run-at-login settings changed');
});

// 7. Core UI controls exist (start/pause/resume/snooze/cancel/mini + customize).
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['btn-start', 'btn-stop', 'btn-pause', 'btn-snooze', 'btn-mini', 'btn-warning-ledger', 'btn-notif', 'btn-widget', 'btn-companion', 'cz-accent', 'cz-theme', 'cz-ring', 'cz-opacity', 'cz-volume', 'cz-clock-format', 'cz-clock-scale', 'cz-clock-dial', 'cz-clock-date', 'chk-lastlight', 'sel-lastlight-sequence', 'warning-modal', 'last-light-overlay', 'morning-proof-section', 'proof-card', 'receipts-modal']) {
  check(`ui: #${id} present`, () => {
    assert(htmlSrc.includes(`id="${id}"`), `missing #${id}`);
  });
}

check('ui: login wording stays aligned with safe startup behavior', () => {
  assertMatch(htmlSrc, /Run at login \(start minimized and idle\)/, 'login checkbox wording changed');
});

check('ui: warning modal keeps snooze and cancel choices', () => {
  assertMatch(htmlSrc, /id="warning-snooze"/, 'warning snooze button missing');
  assertMatch(htmlSrc, /id="warning-cancel"/, 'warning cancel button missing');
});

check('ui: icon-only navigation and footer buttons have accessible labels', () => {
  assertMatch(htmlSrc, /data-ns-tab="lib"[^>]*aria-label="Open library"/, 'LIB aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="sch"[^>]*aria-label="Open schedule"/, 'SCH aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="set"[^>]*aria-label="Open settings"/, 'SET aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="help"[^>]*aria-label="Open help and about"/, 'Help aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="stats"[^>]*aria-label="Open stats"/, 'Stats aria-label missing');
  assertMatch(htmlSrc, /id="btn-notif"[^>]*aria-label="Open notifications"/, 'Notifications aria-label missing');
  assertMatch(htmlSrc, /id="btn-widget"[^>]*aria-label="Toggle desktop widget"/, 'Widget aria-label missing');
  assertMatch(htmlSrc, /id="btn-companion"[^>]*aria-label="Open companion setup"/, 'Companion aria-label missing');
});

const preloadSrc = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
check('preload: timer, mini-mode, and tray-settings bridge APIs remain exposed', () => {
  assertMatch(preloadSrc, /startTimer: \(options, action\) => ipcRenderer\.invoke\('start-timer', options, action\)/, 'preload startTimer bridge missing');
  assertMatch(preloadSrc, /cancelTimer: \(\) => ipcRenderer\.invoke\('cancel-timer'\)/, 'preload cancelTimer bridge missing');
  assertMatch(preloadSrc, /pauseTimer: \(\) => ipcRenderer\.invoke\('pause-timer'\)/, 'preload pauseTimer bridge missing');
  assertMatch(preloadSrc, /resumeTimer: \(\) => ipcRenderer\.invoke\('resume-timer'\)/, 'preload resumeTimer bridge missing');
  assertMatch(preloadSrc, /snoozeTimer: \(seconds, reason\) => ipcRenderer\.invoke\('snooze-timer', seconds, reason\)/, 'preload snoozeTimer bridge missing');
  assertMatch(preloadSrc, /toggleMiniMode: \(\) => ipcRenderer\.send\('toggle-mini-mode'\)/, 'preload toggleMiniMode bridge missing');
  assertMatch(preloadSrc, /onMiniModeChanged: \(callback\) => \{[\s\S]*'mini-mode-changed'/s, 'preload onMiniModeChanged bridge missing');
  assertMatch(preloadSrc, /onOpenSettings: \(callback\) => \{[\s\S]*'open-settings'/s, 'preload onOpenSettings bridge missing');
});

const rendererSrc = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
check('renderer: running-state controls still swap start-stop-pause visibility and label', () => {
  assertMatch(rendererSrc, /els\.btnStart\.style\.display = state\.running \|\| state\.paused \? 'none' : 'flex';/, 'renderer start visibility changed');
  assertMatch(rendererSrc, /els\.btnStop\.style\.display = state\.running \|\| state\.paused \? 'flex' : 'none';/, 'renderer stop visibility changed');
  assertMatch(rendererSrc, /els\.btnPause\.style\.display = state\.running \|\| state\.paused \? 'flex' : 'none';/, 'renderer pause visibility changed');
  assertMatch(rendererSrc, /els\.btnPause\.querySelector\('span:last-child'\)\.textContent = state\.paused \? 'Resume' : 'Pause';/, 'renderer pause/resume label changed');
});

check('renderer: keyboard shortcuts - Space (Start/Pause)', () => {
  assertMatch(rendererSrc, /if \(event\.key === ' ' \|\| event\.code === 'Space'\) \{[\s\S]*if \(state\.running \|\| state\.paused\) togglePause\(\);[\s\S]*else startTimer\(\);/s, 'space shortcut changed');
});

check('renderer: keyboard shortcuts - Escape (Cancel/Modals)', () => {
  assertMatch(rendererSrc, /if \(event\.key === 'Escape'\) \{[\s\S]*else if \(state\.running \|\| state\.paused\) \{[\s\S]*cancelTimer\(\);/s, 'escape cancel shortcut changed');
});

check('renderer: keyboard shortcuts - Ctrl+M (Mini Mode)', () => {
  assertMatch(rendererSrc, /case 'm':[\s\S]*toggleMiniMode\(\);/s, 'Ctrl+M mini-mode shortcut changed');
});

check('renderer: keyboard shortcuts - Ctrl+Shift+S (Show/Hide)', () => {
  // Ctrl+Shift+S is mapped to show/hide in main.js, not emergency cancel
  // This is verified in main.js at line 1968: globalShortcut.register('Ctrl+Shift+S', toggleMainWindow);
  assertMatch(mainSrc, /globalShortcut\.register\('Ctrl\+Shift\+S', toggleMainWindow\)/, 'Ctrl+Shift+S show/hide mapping missing in main.js');
});

check('renderer: keyboard shortcuts - Ctrl+Shift+X (Emergency Cancel)', () => {
  // Emergency cancel is on Ctrl+Shift+X in main.js
  assertMatch(mainSrc, /globalShortcut\.register\('Ctrl\+Shift\+X', \(\) => \{[\s\S]*cancelTimer\(\);/s, 'Ctrl+Shift+X emergency cancel mapping missing in main.js');
});

check('renderer: keyboard shortcuts - Presets (1-9)', () => {
  assertMatch(rendererSrc, /const presets = \{ '1': 5, '2': 10, '3': 15, '4': 30, '5': 60, '6': 120 \};/, 'preset shortcut map changed');
});

check('ux: focus-visible and accessibility', () => {
  const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  // Accept grouped selectors like "button:focus-visible, [role=\"button\"]:focus-visible" as valid
  assertMatch(cssSrc, /button:focus-visible[^{]*\{[\s\S]*outline:/, 'focus-visible outline missing in CSS');
  assertMatch(htmlSrc, /aria-label=/, 'accessibility aria-labels missing in HTML');
  assertMatch(cssSrc, /button\[aria-disabled="true"\]/, 'disabled button styling missing in CSS');
});

check('renderer fallback: preview mode stays safe and idle by default', () => {
  assertMatch(rendererSrc, /runAtLogin: false,[\s\S]*startupBehavior: 'Starts minimized and idle'/s, 'fallback startup behavior changed');
  assertMatch(rendererSrc, /state\.dryRun = true;/, 'fallback should remain dry-run');
});

check('renderer: visible sidebar navigation routes to a real tab or modal', () => {
  assertMatch(rendererSrc, /function handleSidebarNavigation\(tab, \{ persist = true \} = \{\}\) \{/, 'sidebar navigation router missing');
  assertMatch(rendererSrc, /if \(tab === 'lib'\) handled = activateTopTab\('library'\);/, 'LIB routing missing');
  assertMatch(rendererSrc, /if \(tab === 'sch'\) handled = activateTopTab\('schedule'\);/, 'SCH routing missing');
  assertMatch(rendererSrc, /if \(tab === 'set'\) \{[\s\S]*openSettingsPanel\(\);[\s\S]*handled = true;/s, 'SET routing missing');
  assertMatch(rendererSrc, /if \(tab === 'help'\) \{[\s\S]*openHelpPanel\(\);[\s\S]*handled = true;/s, 'Help routing missing');
  assertMatch(rendererSrc, /if \(tab === 'stats'\) handled = activateTopTab\('streaks'\);/, 'STATS routing missing');
  assertMatch(rendererSrc, /document\.querySelectorAll\('\.ns-nav-item'\)\.forEach\(btn => \{[\s\S]*handleSidebarNavigation\(btn\.dataset\.nsTab\);/s, 'sidebar click handler missing');
});

check('renderer: footer and ledger controls provide real feedback', () => {
  assertMatch(rendererSrc, /els\.btnWidget\?\.addEventListener\('click', \(\) => \{[\s\S]*api\.toggleWidget\?\.\(\);[\s\S]*notify\('Desktop widget toggled', 'info'\);/s, 'widget button feedback missing');
  assertMatch(rendererSrc, /els\.btnCompanion\?\.addEventListener\('click', async \(\) => \{[\s\S]*notify\(`Companion at \$\{rc\.url\}`, 'info'\);[\s\S]*openSettingsPanel\(\);[\s\S]*notify\('Enable Remote Control in settings before opening the Companion PWA', 'info'\);[\s\S]*notify\('Companion setup is unavailable right now', 'warning'\);/s, 'companion button behavior missing');
  assertMatch(rendererSrc, /const btnNotif = document\.getElementById\('btn-notif'\);[\s\S]*notifDrawer\.style\.display = notifDrawer\.style\.display === 'none' \? '' : 'none';/s, 'notifications button handler missing');
  assertMatch(rendererSrc, /if \(els\.btnWarningLedger\) \{[\s\S]*openReceiptsLedger\(\)/s, 'warning ledger button wiring missing');
  assertMatch(rendererSrc, /if \(els\.btnProofDetails\) \{[\s\S]*openReceiptsLedger\(\)/s, 'proof ledger button wiring missing');
});

// Companion Easy Connect UI contract.
check('companion: mode buttons present in settings', () => {
  assert(htmlSrc.includes('data-mode="off"'), 'off mode button missing');
  assert(htmlSrc.includes('data-mode="local"'), 'local mode button missing');
  assert(htmlSrc.includes('data-mode="wifi"'), 'wifi mode button missing');
  assert(htmlSrc.includes('Connect Phone'), 'Connect Phone button missing');
});

check('companion: settings panel loads remote control state on open', () => {
  assertMatch(rendererSrc, /function openSettingsPanel\(\) \{[\s\S]*?loadRemoteControlState\(\)/s, 'openSettingsPanel must load remote control state');
  assertMatch(rendererSrc, /async function loadRemoteControlState\(\) \{\s*if \(!els\.remoteControlConfig\) return;\s*try \{ renderRemoteControl\(await api\.getRemoteControl\?\.\(\)\); \} catch \{\}/, 'loadRemoteControlState should not bail on missing checkbox');
});

check('companion: QR only shown for same-wifi mode', () => {
  assertMatch(rendererSrc, /updateRemoteQr\(mode === 'wifi' \? rc\.url : ''\)/, 'QR should only render for wifi mode');
});

check('companion: copy, regenerate, and off buttons wired', () => {
  assertMatch(rendererSrc, /els\.btnCopyUrl\?\.addEventListener\('click', /, 'copy URL button not wired');
  assertMatch(rendererSrc, /els\.btnRegenToken\?\.addEventListener\('click', async \(\) => \{/, 'regenerate token button not wired');
  assertMatch(rendererSrc, /els\.btnTurnOffCompanion\?\.addEventListener\('click', async \(\) => \{/, 'turn off companion button not wired');
});

check('companion: status pill is visible near the heading and listens to pushed state', () => {
  assert(htmlSrc.includes('id="companion-status-pill"'), 'companion status pill missing in HTML');
  assertMatch(rendererSrc, /api\.onRemoteControlStatus\?\.\(renderRemoteControl\)/, 'renderer not subscribed to remote-control-status pushes');
  assertMatch(rendererSrc, /renderRemoteControl\(rc\)/, 'renderRemoteControl missing');
  assertMatch(rendererSrc, /els\.companionStatusPill\.textContent = rc\.statusLabel \|\| \(mode === 'off' \? 'Off' : \(mode === 'local' \? 'This PC only' : 'Same Wi-Fi'\)\)/, 'status pill text must use Off / This PC only / Same Wi-Fi labels');
});

check('companion: status pill class updates by mode and connection state', () => {
  assertMatch(rendererSrc, /const statusClass = rc\.failed \? 'status-failed' : rc\.connected \? 'status-connected' : `status-\${mode}`/, 'status pill class must reflect failed/connected/mode');
});

check('companion: Off hides QR and manual LAN URL', () => {
  assertMatch(rendererSrc, /if \(els\.remoteControlConfig\) els\.remoteControlConfig\.style\.display = mode === 'off' \? 'none' : '';/, 'Off mode should hide the remote control config');
  assertMatch(rendererSrc, /updateRemoteQr\(mode === 'wifi' \? rc\.url : ''\)/, 'QR should only render for wifi mode');
});

check('companion: phone page has explicit connection states', () => {
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  assert(companionHtml.includes('Connecting…'), 'companion page missing Connecting state');
  assert(companionHtml.includes('Connected to'), 'companion page missing Connected to PC state');
  assert(companionHtml.includes('Disconnected'), 'companion page missing Disconnected state');
  assert(companionHtml.includes('Pairing expired'), 'companion page missing Pairing expired state');
  assert(companionHtml.includes('Wrong network or PC offline'), 'companion page missing offline state');
});

check('morning proof: Mission Complete overlay has accessible close affordances', () => {
  assert(htmlSrc.includes('id="btn-proof-close"'), 'visible Close button missing');
  assert(htmlSrc.includes('id="btn-proof-dismiss"'), 'dismiss X button missing');
  assert(/btn-proof-dismiss[^>]*aria-label="[^"]*"/.test(htmlSrc), 'dismiss X should have an aria-label');
  assertMatch(rendererSrc, /function dismissMorningProof\(\)/, 'dismissMorningProof helper missing');
  assertMatch(rendererSrc, /document\.getElementById\('btn-proof-close'\)\?\.addEventListener\('click', dismissMorningProof\)/, 'Close button not wired to dismiss');
  assertMatch(rendererSrc, /document\.getElementById\('btn-proof-dismiss'\)\?\.addEventListener\('click', dismissMorningProof\)/, 'dismiss X not wired to dismiss');
  assertMatch(rendererSrc, /e\.key === 'Escape'[^}]*morningProofSection\.style\.display !== 'none'/, 'Escape handler for Mission Complete overlay missing');
});

check('morning proof: Play Tonight Again still works', () => {
  assertMatch(rendererSrc, /document\.getElementById\('btn-proof-again'\)\?\.addEventListener\('click', \(\) => \{/, 'Play Tonight Again button missing');
  assertMatch(rendererSrc, /document\.getElementById\('btn-start'\)\?\.click\(\)/, 'Play Tonight Again should delegate to start button');
});

check('companion: default settings are off with no token', () => {
  const settingsSrc = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  assertMatch(settingsSrc, /remoteControl:\s*\{[\s\S]*enabled:\s*false,[\s\S]*token:\s*''\s*\}/, 'remoteControl defaults should be off with empty token');
});

check('companion: main mode contract maps to correct host binding', () => {
  assertMatch(mainSrc, /if \(mode === 'wifi'\) \{[\s\S]*companion\.start\(\{ token: rc\.token, host: '0\.0\.0\.0' \}\)/s, 'wifi mode should bind 0.0.0.0');
  assertMatch(mainSrc, /\} else if \(mode === 'local'\) \{[\s\S]*companion\.start\(\{ token: rc\.token, host: '127\.0\.0\.1' \}\)/s, 'local mode should bind 127.0.0.1');
  assertMatch(mainSrc, /if \(mode === 'off' \|\| !rc\.token\) return false;/, 'off mode should not start listener');
});

check('companion: same-wifi URL includes token and host for Android APK', () => {
  // The URL must carry the token and a host parameter so packaged Android
  // companions (which load the UI locally) know where to connect.
  const wifiUrlMatch = mainSrc.match(/if \(mode === 'wifi' && rc\.token\) \{[\s\S]*?url = `([^`]+)`/);
  assert(wifiUrlMatch, 'wifi URL construction not found');
  const wifiUrl = wifiUrlMatch[1];
  assert(wifiUrl.includes('t=${rc.token}'), 'wifi URL missing token');
  assert(wifiUrl.includes('host='), 'wifi URL missing host parameter');
  assert(wifiUrl.includes('encodeURIComponent'), 'wifi URL must encode the host parameter');
  assert(wifiUrl.includes('${lanIp}:${companion.PWA_PORT}'), 'wifi URL host must include the selected LAN IP and port');
});

check('companion: QR URL has no host in off or local mode', () => {
  // Off and local modes intentionally omit the LAN host parameter.
  const localUrlMatch = mainSrc.match(/\} else if \(mode === 'local' && rc\.token\) \{[\s\S]*?url = `([^`]+)`/);
  assert(localUrlMatch, 'local URL construction not found');
  assert(!localUrlMatch[1].includes('host='), 'local URL should not include a host parameter');
});

// 8. Run Receipts module logic.
const rrPath = path.join(root, 'runReceipts.js');
if (fs.existsSync(rrPath)) {
  // runReceipts lazily loads electron, so it works outside Electron too.
  const rr = require(rrPath);

  check('receipts: create + update receipt', () => {
    const r = rr.createRunReceipt({ action: 'shutdown', totalSeconds: 1800, dryRun: true, forceShutdown: false });
    assert(r.id, 'receipt needs id');
    assert(r.result === 'running', 'initial result should be running');
    const updated = rr.updateRunReceipt(r.id, { result: 'dry_run_completed', endedAt: new Date().toISOString() });
    assert(updated.result === 'dry_run_completed', 'update failed');
  });

  check('receipts: list and latest', () => {
    const list = rr.listReceipts(10);
    assert(Array.isArray(list), 'list should be array');
    const latest = rr.getLatestReceipt();
    assert(latest && latest.id, 'latest should exist');
  });

  check('receipts: pause/snooze/warning increments', () => {
    const r = rr.createRunReceipt({ action: 'sleep', totalSeconds: 600 });
    rr.receiptPaused(r.id);
    rr.receiptPaused(r.id);
    rr.receiptSnoozed(r.id);
    rr.receiptWarning(r.id);
    rr.receiptWarning(r.id);
    rr.receiptWarning(r.id);
    const updated = rr._load().receipts.find(x => x.id === r.id);
    assert(updated.pauseCount === 2, `pauseCount should be 2, got ${updated.pauseCount}`);
    assert(updated.snoozeCount === 1, `snoozeCount should be 1, got ${updated.snoozeCount}`);
    assert(updated.warningsShown === 3, `warningsShown should be 3, got ${updated.warningsShown}`);
  });

  check('receipts: clear and prune', () => {
    rr.clearReceipts();
    const after = rr.listReceipts();
    assert(after.length === 0, 'should be empty after clear');
    assert(rr.MAX_RECEIPTS === 100, 'max should be 100');
  });

  check('receipts: malformed file recovery', () => {
    // Find where runReceipts stores its file (os.tmpdir when not in Electron).
    const rrFile = path.join(os.tmpdir(), 'run-receipts.json');
    fs.writeFileSync(rrFile, '{bad json', 'utf8');
    rr._reset();
    const data = rr._load();
    assert(Array.isArray(data.receipts), 'should recover from malformed file');
    rr.clearReceipts();
  });
}

// 14. Override Tax integration.
check('override-tax: module exists and exports expected API', () => {
  assert(mainSrc.includes("require('./overrideTax')"), 'overrideTax not required in main');
  assertMatch(mainSrc, /overrideTax\.resetSession\(\)/, 'overrideTax.resetSession not called on timer start');
  assertMatch(mainSrc, /overrideTax\.consumeDebt\(\)/, 'overrideTax.consumeDebt not applied to timer duration');
  assertMatch(mainSrc, /overrideTax\.recordSnooze\(reason\)/, 'overrideTax.recordSnooze not called in snoozeTimer');
});
check('override-tax: IPC handlers registered', () => {
  assertMatch(mainSrc, /ipcMain\.handle\('assess-snooze-cost'/, 'assess-snooze-cost IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('get-override-tax-stats'/, 'get-override-tax-stats IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('get-override-tax-config'/, 'get-override-tax-config IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('update-override-tax-config'/, 'update-override-tax-config IPC missing');
});
check('override-tax: preload exposes assessSnoozeCost', () => {
  assertMatch(preloadSrc, /assessSnoozeCost:/, 'preload assessSnoozeCost bridge missing');
  assertMatch(preloadSrc, /getOverrideTaxStats:/, 'preload getOverrideTaxStats bridge missing');
});
check('override-tax: snooze-tax-modal in HTML', () => {
  assert(htmlSrc.includes('id="snooze-tax-modal"'), 'snooze-tax-modal missing from HTML');
  assert(htmlSrc.includes('id="btn-snooze-tax-confirm"'), 'snooze-tax-confirm button missing');
  assert(htmlSrc.includes('id="btn-snooze-tax-cancel"'), 'snooze-tax-cancel button missing');
});
check('override-tax: renderer assesses cost before snooze', () => {
  assertMatch(rendererSrc, /api\.assessSnoozeCost/, 'renderer does not call assessSnoozeCost');
  assertMatch(rendererSrc, /showSnoozeTaxModal/, 'renderer does not show snooze tax modal');
});

// 15. Autopilot Bedtime integration.
check('autopilot: module exists and is scheduled', () => {
  assert(mainSrc.includes("require('./autopilot')"), 'autopilot not required in main');
  assertMatch(mainSrc, /autopilot\.schedule\(startTimer, mainWindow\)/, 'autopilot.schedule not called on ready');
});
check('autopilot: IPC handlers registered', () => {
  assertMatch(mainSrc, /ipcMain\.handle\('get-autopilot-status'/, 'get-autopilot-status IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('get-learned-bedtime'/, 'get-learned-bedtime IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('enable-autopilot'/, 'enable-autopilot IPC missing');
});
check('autopilot: preload exposes autopilot API', () => {
  assertMatch(preloadSrc, /getAutopilotStatus:/, 'preload getAutopilotStatus bridge missing');
  assertMatch(preloadSrc, /getLearnedBedtime:/, 'preload getLearnedBedtime bridge missing');
  assertMatch(preloadSrc, /enableAutopilot:/, 'preload enableAutopilot bridge missing');
});
check('autopilot: settings default is OFF', () => {
  const settingsSrc = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  assertMatch(settingsSrc, /autopilotEnabled: false/, 'autopilotEnabled default should be false');
});

check('override-tax: settings UI elements in HTML', () => {
  assert(htmlSrc.includes('id="chk-override-tax"'), 'chk-override-tax missing');
  assert(htmlSrc.includes('id="tax-free-snoozes"'), 'tax-free-snoozes missing');
  assert(htmlSrc.includes('id="tax-tighten-min"'), 'tax-tighten-min missing');
  assert(htmlSrc.includes('id="tax-session-count"'), 'tax-session-count missing');
  assert(htmlSrc.includes('id="tax-tomorrow-debt"'), 'tax-tomorrow-debt missing');
});

check('autopilot: settings UI elements in HTML', () => {
  assert(htmlSrc.includes('id="chk-autopilot"'), 'chk-autopilot missing');
  assert(htmlSrc.includes('id="autopilot-learned"'), 'autopilot-learned missing');
  assert(htmlSrc.includes('id="autopilot-confidence"'), 'autopilot-confidence missing');
  assert(htmlSrc.includes('id="autopilot-override-time"'), 'autopilot-override-time missing');
});

// 16. Ritual Mode integration.
check('ritual-mode: module exists and IPC registered', () => {
  assert(mainSrc.includes("require('./ritualMode')"), 'ritualMode not required in main');
  assertMatch(mainSrc, /ipcMain\.handle\('ritual-start'/, 'ritual-start IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('ritual-advance'/, 'ritual-advance IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('ritual-cancel'/, 'ritual-cancel IPC missing');
});
check('ritual-mode: preload exposes ritual API', () => {
  assertMatch(preloadSrc, /ritualStart:/, 'preload ritualStart missing');
  assertMatch(preloadSrc, /ritualAdvance:/, 'preload ritualAdvance missing');
  assertMatch(preloadSrc, /onRitualStep:/, 'preload onRitualStep missing');
});
check('ritual-mode: UI overlay in HTML', () => {
  assert(htmlSrc.includes('id="ritual-overlay"'), 'ritual-overlay missing');
  assert(htmlSrc.includes('id="btn-ritual"'), 'btn-ritual missing');
  assert(htmlSrc.includes('id="btn-ritual-next"'), 'btn-ritual-next missing');
});

// 17. Stats Dashboard.
check('stats-dashboard: module and IPC', () => {
  assert(mainSrc.includes("require('./statsDashboard')"), 'statsDashboard not required');
  assertMatch(mainSrc, /ipcMain\.handle\('get-full-dashboard'/, 'get-full-dashboard IPC missing');
  assertMatch(preloadSrc, /getFullDashboard:/, 'preload getFullDashboard missing');
});

// 18. Runtime UX truth: every visible nav/control has a real action or is disabled.
check('ux: ns-play-btn is wired to startTimer', () => {
  assertMatch(rendererSrc, /getElementById\('ns-play-btn'\)\?\.addEventListener\('click', \(\) => startTimer\(\)\)/, 'ns-play-btn not wired');
});

check('ux: ns-play-btn has aria-label', () => {
  assertMatch(htmlSrc, /id="ns-play-btn"[^>]*aria-label="Start tonight/, 'ns-play-btn aria-label missing');
});

check('ux: Escape closes all modals (profiles, receipts, about, notif-drawer)', () => {
  assertMatch(rendererSrc, /els\.profilesModal\?\.classList\.contains\('active'\)/, 'Escape does not check profilesModal');
  assertMatch(rendererSrc, /els\.receiptsModal\?\.classList\.contains\('active'\)/, 'Escape does not check receiptsModal');
  assertMatch(rendererSrc, /els\.aboutModal\?\.classList\.contains\('active'\)/, 'Escape does not check aboutModal');
  assertMatch(rendererSrc, /getElementById\('notif-drawer'\)\?\.style\.display !== 'none'/, 'Escape does not check notif-drawer');
});

check('ux: sidebar sets aria-current on active item', () => {
  assertMatch(rendererSrc, /btn\.setAttribute\('aria-current', 'page'\)/, 'aria-current not set on active sidebar item');
  assertMatch(rendererSrc, /btn\.removeAttribute\('aria-current'\)/, 'aria-current not removed on inactive sidebar item');
});

const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
check('ux: global focus-visible ring defined', () => {
  assertMatch(cssSrc, /button:focus-visible[\s\S]*outline:.*rgba\(107, 211, 255/, 'global button:focus-visible missing');
});

check('ux: disabled button styling defined', () => {
  assertMatch(cssSrc, /button\[aria-disabled="true"\][\s\S]*opacity:/, 'disabled button style missing');
  assertMatch(cssSrc, /button\[aria-disabled="true"\][\s\S]*cursor: not-allowed/, 'disabled button cursor missing');
});

check('warning: dialog timing and emergency cancel', () => {
  assertMatch(mainSrc, /if \(timerState\.gracePeriod > 0 && timerState\.remainingSeconds === timerState\.gracePeriod \* 60\) \{/, 'warning dialog trigger timing regressed');
  assertMatch(mainSrc, /emitTimerUpdate\('warning', \{[\s\S]*message: `\$\{formatAction\(timerState\.action\)\} in \$\{timerState\.gracePeriod\} minutes`/s, 'warning message content regressed');
  assertMatch(mainSrc, /ipcMain\.handle\('cancel-timer'/, 'emergency cancel IPC handler missing');
});

check('session: receipt and morning proof rendering', () => {
  assertMatch(mainSrc, /const receipt = runReceipts\.createRunReceipt\(timerState\);/, 'run receipt creation missing in main');
  assertMatch(htmlSrc, /id="morning-proof-section"/, 'morning proof section missing in HTML');
  assertMatch(htmlSrc, /id="proof-card"/, 'proof card missing in HTML');
  // The canonical function is renderMorningProof(receipt), not showMorningProof(receipt)
  assertMatch(rendererSrc, /function renderMorningProof\(receipt\) \{/, 'renderMorningProof function missing in renderer');
});

check('session: recovery banner and tax safety', () => {
  assertMatch(mainSrc, /function getRecoverableTimer\(\) \{/, 'recoverable timer logic missing');
  // The canonical function is promptTimerRecovery(snapshot), not showRecoveryBanner(snapshot)
  assertMatch(rendererSrc, /function promptTimerRecovery\(snapshot\) \{/, 'promptTimerRecovery function missing in renderer');
  assertMatch(mainSrc, /const taxResult = overrideTax\.recordSnooze\(reason\);/, 'override tax recording missing');
  assertMatch(mainSrc, /emitTimerUpdate\('snoozed', \{ addedSeconds: addSeconds, tax: taxResult \}\);/, 'snooze tax update broadcast missing');
});

// 19. Priority 2 & 3: Tray and Mini-Mode Expansion
check('tray: quick-action menu items are present', () => {
  assertMatch(mainSrc, /label: 'Start 28 min'/, 'tray 28 min quick start missing');
  assertMatch(mainSrc, /label: 'Start 1 hour'/, 'tray 1 hour quick start missing');
  // Snooze label can vary with override-tax level, so check for the base pattern
  assertMatch(mainSrc, /Snooze \+5 min/, 'tray snooze action missing');
});

check('tray: no duplicate tray icons on state change', () => {
  assertMatch(mainSrc, /Only rebuild the tray context menu on real state transitions, not every[\s\S]*if \(type !== 'tick'\) refreshTrayMenu\(\);/s, 'per-tick tray menu rebuild guard missing');
});

check('mini-mode: toggle and window resize logic', () => {
  assertMatch(mainSrc, /let miniMode = false;/, 'miniMode variable missing');
  assertMatch(mainSrc, /ipcMain\.on\('toggle-mini-mode'[\s\S]*miniMode = !miniMode;/s, 'miniMode toggle missing');
  assertMatch(mainSrc, /if \(miniMode\) \{[\s\S]*mainWindow\.setSize\(260, 320\);/s, 'mini-mode resize missing');
});

check('mini-mode: state broadcast to renderer', () => {
  assertMatch(mainSrc, /mainWindow\.webContents\.send\('mini-mode-changed', miniMode\);/, 'mini-mode-changed event missing');
});

check('keyboard: global shortcuts registered for quick actions', () => {
  assertMatch(mainSrc, /globalShortcut\.register\('Ctrl\+Shift\+L'[\s\S]*startTimer/, 'Ctrl+Shift+L quick timer missing');
  assertMatch(mainSrc, /globalShortcut\.register\('Ctrl\+Shift\+Space'[\s\S]*pauseTimer\(\)|resumeTimer\(\)/, 'Ctrl+Shift+Space pause/resume missing');
  assertMatch(mainSrc, /globalShortcut\.register\('Ctrl\+Shift\+Z'[\s\S]*snoozeTimer\(300\)/, 'Ctrl+Shift+Z snooze missing');
});

check('keyboard: Escape closes modals in renderer', () => {
  assertMatch(rendererSrc, /if \(event\.key === 'Escape'\) \{[\s\S]*profilesModal.*classList.*remove\('active'\)/s, 'Escape close profiles missing');
  assertMatch(rendererSrc, /if \(event\.key === 'Escape'\) \{[\s\S]*receiptsModal.*classList.*remove\('active'\)/s, 'Escape close receipts missing');
});

check('keyboard: disabled controls do not activate', () => {
  assertMatch(cssSrc, /button\[aria-disabled="true"\][\s\S]*pointer-events: none/, 'disabled button pointer-events missing');
});

// 20. Priority 4: Warning and Session Proof
check('warning: emergency cancel is always available', () => {
  assertMatch(mainSrc, /ipcMain\.handle\('cancel-timer'/, 'cancel-timer IPC missing');
  assertMatch(rendererSrc, /if \(event\.key === 'Escape'\)[\s\S]*cancelTimer\(\)/, 'Escape cancel in renderer missing');
});

check('session: receipt creation on timer start', () => {
  assertMatch(mainSrc, /const receipt = runReceipts\.createRunReceipt\(timerState\);/, 'receipt creation missing');
});

check('session: morning proof section renders on app load', () => {
  assertMatch(htmlSrc, /id="morning-proof-section"/, 'morning-proof-section missing');
  assertMatch(rendererSrc, /function renderMorningProof\(receipt\) \{/, 'renderMorningProof missing');
});

check('session: recovery banner flow on resume', () => {
  assertMatch(rendererSrc, /function promptTimerRecovery\(snapshot\) \{/, 'promptTimerRecovery missing');
  assertMatch(mainSrc, /function getRecoverableTimer\(\) \{/, 'getRecoverableTimer missing');
});

check('session: override tax applied to snooze', () => {
  assertMatch(mainSrc, /const taxResult = overrideTax\.recordSnooze\(reason\);/, 'override tax recording missing');
  assertMatch(mainSrc, /emitTimerUpdate\('snoozed', \{ addedSeconds: addSeconds, tax: taxResult \}\);/, 'snooze tax broadcast missing');
});

// Cleanup.
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
