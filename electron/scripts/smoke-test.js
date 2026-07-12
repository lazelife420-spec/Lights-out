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
const jsFiles = ['main.js', 'preload.js', 'renderer-utils.js', 'renderer-profiles.js', 'renderer-calendar.js', 'renderer-receipts.js', 'renderer-family-remote.js', 'renderer-ritual-focus.js', 'renderer-settings.js', 'renderer-lastlight-alarm.js', 'renderer-onboarding-updater.js', 'renderer.js', 'settings.js', 'smartLights.js', 'profiles.js', 'calendar.js', 'lastLight.js'];
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

check('profiles: markUsed stamps lastUsedAt and persists to disk', () => {
  const profiles = require(path.join(root, 'profiles.js'));
  const created = profiles.create({ name: 'Last-Used Smoke Test' });
  assert(created.success, 'setup: profile creation failed');
  assert(created.profile.lastUsedAt === null, 'freshly created profile should have no lastUsedAt yet');

  const before = Date.now() - 1000;
  const updated = profiles.markUsed(created.profile.id);
  assert(updated && updated.lastUsedAt, 'markUsed did not return a stamped profile');
  assert(new Date(updated.lastUsedAt).getTime() >= before, 'lastUsedAt not a recent timestamp');

  // Reload from disk to confirm the stamp was actually persisted, not just cached.
  profiles.reload();
  const reloaded = profiles.getById(created.profile.id);
  assert(reloaded && reloaded.lastUsedAt === updated.lastUsedAt, 'lastUsedAt not persisted to disk');

  assert(profiles.markUsed('does-not-exist') === null, 'markUsed should return null for an unknown id');
});

check('main.js: profiles-apply handler stamps lastUsedAt via markUsed on success', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assertMatch(mainSrc, /profiles-apply[\s\S]{0,200}profiles\.markUsed\(id\)/, 'profiles-apply IPC handler should call profiles.markUsed on success');
});

check('streaks: export/import round-trip restores event history', () => {
  const streaks = require(path.join(root, 'streaks.js'));
  streaks._reset();
  streaks.replaceAll({
    events: [{ date: '2026-07-01', bedTime: '22:15', action: 'shutdown', snoozed: false }],
    streak: 1,
    bestStreak: 3,
    achievements: ['first_light']
  });
  const exported = streaks.exportData();
  streaks.replaceAll({ events: [], streak: 0, bestStreak: 0, achievements: [] });
  streaks.replaceAll(exported);
  const restored = streaks.exportData();
  assert(restored.events.length === 1, 'streak events were not restored');
  assert(restored.bestStreak === 3, 'best streak was not restored');
});

check('streaks: getTrend aggregates events into weekly and monthly buckets', () => {
  const streaks = require(path.join(root, 'streaks.js'));
  streaks._reset();
  // Two nights in the same ISO week (Mon 2026-06-01) and one in the next
  // month (2026-07-01), so week/month bucketing produce different bucket
  // counts against the same underlying data.
  streaks.replaceAll({
    events: [
      { date: '2026-06-01', bedTime: '22:00', action: 'shutdown', snoozed: false },
      { date: '2026-06-02', bedTime: '23:30', action: 'shutdown', snoozed: true },
      { date: '2026-07-01', bedTime: '22:15', action: 'sleep', snoozed: false }
    ],
    streak: 1,
    bestStreak: 1,
    achievements: []
  });

  const weekly = streaks.getTrend('week');
  assert(weekly.length === 2, `expected 2 week buckets, got ${weekly.length}`);
  const juneWeek = weekly.find(w => w.nights === 2);
  assert(juneWeek, 'the two June nights should land in the same week bucket');
  assert(juneWeek.avgBedTime === '22:45', `expected avg bedtime 22:45, got ${juneWeek.avgBedTime}`);
  assert(juneWeek.onTimePercent === 50, `expected 50% on-time (one of two nights before 23:00), got ${juneWeek.onTimePercent}`);
  assert(juneWeek.snoozeRate === 50, `expected 50% snooze rate, got ${juneWeek.snoozeRate}`);
  assert(juneWeek.periodLength === 7, 'week bucket periodLength should be 7');

  const monthly = streaks.getTrend('month');
  assert(monthly.length === 2, `expected 2 month buckets, got ${monthly.length}`);
  const june = monthly.find(m => m.key === '2026-06');
  assert(june && june.nights === 2, 'June bucket should have 2 nights');
  assert(june.periodLength === 30, `June has 30 days, got periodLength ${june.periodLength}`);
  assert(monthly[0].key < monthly[1].key, 'monthly buckets should be chronologically sorted');

  assert(streaks.getTrend('week', 1).length === 1, 'limit should cap the number of returned buckets');

  streaks.replaceAll({ events: [], streak: 0, bestStreak: 0, achievements: [] });
  assert(streaks.getTrend('week').length === 0, 'no events should yield no buckets');
});

check('streaks: buildWeeklyNarrative summarizes only real computed fields (no invented claims)', () => {
  const streaks = require(path.join(root, 'streaks.js'));
  streaks._reset();

  // No nights logged this week -- must say so honestly, not fabricate a claim.
  const empty = streaks.buildWeeklyNarrative({ nightsThisWeek: 0 });
  assert(/No nights logged this week/.test(empty), 'empty report should admit no nights logged');

  const today = new Date();
  const iso = (daysAgo) => new Date(today - daysAgo * 86400000).toISOString().slice(0, 10);
  streaks.replaceAll({
    events: [
      { date: iso(2), bedTime: '22:00', action: 'shutdown', snoozed: false },
      { date: iso(1), bedTime: '22:30', action: 'shutdown', snoozed: true },
      { date: iso(0), bedTime: '22:15', action: 'sleep', snoozed: false }
    ],
    streak: 3,
    bestStreak: 5,
    achievements: ['first_light']
  });

  const report = streaks.getWeeklyReport();
  assert(report.nightsThisWeek === 3, `expected 3 nights this week, got ${report.nightsThisWeek}`);
  assert(typeof report.narrative === 'string' && report.narrative.length > 0, 'getWeeklyReport should include a narrative field');
  assert(report.narrative.includes('3 of the last 7 nights logged'), `narrative should state the real night count, got: ${report.narrative}`);
  assert(report.narrative.includes('Current streak: 3 nights (best ever: 5)'), 'narrative should state the real streak numbers');
  assert(report.narrative.includes('Snoozed on 33% of logged nights'), `narrative should state the real snooze rate, got: ${report.narrative}`);
  assert(report.narrative.includes('2 shutdown, 1 sleep'), 'narrative should break down real action counts');
  assert(report.narrative.includes('1 achievement unlocked'), 'narrative should state the real achievement count');

  streaks.replaceAll({ events: [], streak: 0, bestStreak: 0, achievements: [] });
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

check('calendar: runtime uses the provider API that actually exists', () => {
  assertMatch(mainSrc, /const events = await calProviders\.fetchAllEvents\(calSettings, new Date\(\), 1\);/, 'calendar runtime should use fetchAllEvents');
  assert(!/calProviders\.fetchEvents\(calSettings, 1\)/.test(mainSrc), 'stale fetchEvents runtime call still present in main.js');
});

check('calendar: bedtime matching and notifications use normalized event titles', () => {
  assertMatch(mainSrc, /function getEventTitle\(event\) \{[\s\S]*event\?\.summary \|\| event\?\.title/s, 'event title helper missing');
  assertMatch(mainSrc, /function isBedtimeEvent\(event\) \{[\s\S]*getEventTitle\(event\)\.toLowerCase\(\)/s, 'bedtime matcher should read normalized event title');
  assertMatch(mainSrc, /showNativeNotification\('Lights Out', `Auto-started from calendar: \$\{getEventTitle\(event\) \|\| 'Bedtime'\}`\);/, 'calendar notification should use normalized event title');
});

check('first-light: morning briefing uses live calendar and sleep-debt APIs', () => {
  assertMatch(mainSrc, /const events = await calProviders\.fetchAllEvents\(calSettings, new Date\(\), 1\);/, 'First Light briefing should fetch live calendar events');
  assertMatch(mainSrc, /sleepDebt: sleepDebt\.getDebtSummary\(\)/, 'First Light briefing should use getDebtSummary');
  assert(!/sleepDebt\.getSummary\(\)/.test(mainSrc), 'stale sleepDebt.getSummary call still present');
});

check('first-light: smart-light sunrise uses exported helper with bounded timing', () => {
  const smartLightsSrc = fs.readFileSync(path.join(root, 'smartLights.js'), 'utf8');
  assertMatch(smartLightsSrc, /async function invokeSmartLightAction\(\{ on = true, brightness = 254, colorTemp = 366, transitionTime = 10 \} = \{\}\)/, 'smart-light action helper missing');
  assertMatch(smartLightsSrc, /module\.exports = \{[\s\S]*invokeSmartLightAction,/s, 'smart-light action helper not exported');
  assertMatch(mainSrc, /const sunriseTickSeconds = 5;/, 'First Light sunrise tick constant missing');
  assertMatch(mainSrc, /const totalSunriseSteps = Math\.max\(1, Math\.ceil\(FIRST_LIGHT_DURATION \/ sunriseTickSeconds\)\);/, 'First Light sunrise step bound missing');
  assertMatch(mainSrc, /smartLights\.invokeSmartLightAction\(\{[\s\S]*transitionTime: sunriseTickSeconds \* 10[\s\S]*\}\)\.catch\(\(\) => \{\}\);/s, 'First Light should use the exported smart-light action helper');
});

check('idle-detection: disabled state is honored at startup and at runtime', () => {
  const idleSrc = fs.readFileSync(path.join(root, 'idleDetection.js'), 'utf8');
  assertMatch(idleSrc, /function normalizeThreshold\(seconds, fallback = 300\) \{[\s\S]*if \(num <= 0\) return Number\.POSITIVE_INFINITY;/s, 'idle threshold normalization should allow disabled state');
  assertMatch(idleSrc, /function getThreshold\(\) \{[\s\S]*Number\.isFinite\(idleThresholdSeconds\) \? idleThresholdSeconds : 0/s, 'idle threshold getter should surface disabled state as 0');
  assertMatch(mainSrc, /thresholdSeconds: appSettings\.idleDetectionEnabled === false \? 0 : \(appSettings\.idleThresholdSeconds \|\| 300\)/, 'idle detection startup should honor saved enabled state');
  assertMatch(mainSrc, /const currentApp = settingsStore\.getSection\('app'\) \|\| \{\};[\s\S]*if \(currentApp\.idleDetectionEnabled === false\) return;/s, 'idle callback should re-check enabled state');
});

check('bedtime-reminder: runtime honors disabled state and avoids duplicate renderer push', () => {
  const reminderSrc = fs.readFileSync(path.join(root, 'bedtimeReminder.js'), 'utf8');
  assertMatch(reminderSrc, /function normalizeReminderMinutes\(value, fallback = 15\) \{[\s\S]*if \(num <= 0\) return 0;/s, 'bedtime reminder normalization should allow disabled state');
  assertMatch(reminderSrc, /if \(reminderMinutesBefore <= 0\) return;/, 'bedtime reminder should short-circuit when disabled');
  assertMatch(reminderSrc, /Start-Sleep -Milliseconds 100/, 'bedtime reminder PowerShell warm-up should use valid Start-Sleep');
  assert(!/BrowserWindow\.getAllWindows\(\)\[0\][\s\S]*bedtime-reminder/.test(reminderSrc), 'bedtime reminder module should not double-push directly to renderer');
  assertMatch(mainSrc, /minutesBefore: appSettings\.bedtimeReminderEnabled === false \? 0 : \(appSettings\.bedtimeReminderMinutes \|\| 15\)/, 'bedtime reminder startup should honor saved enabled state');
});

check('settings: save-app-settings persists the auxiliary protection sections', () => {
  assertMatch(mainSrc, /if \(settings\.wifiGuard\) settingsStore\.updateSection\('wifiGuard', settings\.wifiGuard\);/, 'wifiGuard save missing');
  assertMatch(mainSrc, /if \(settings\.contentBlocker\) settingsStore\.updateSection\('contentBlocker', settings\.contentBlocker\);/, 'contentBlocker save missing');
  assertMatch(mainSrc, /if \(settings\.accountability\) settingsStore\.updateSection\('accountability', settings\.accountability\);/, 'accountability save missing');
});

check('backup: export/import all-data uses the live profile API and restores streaks', () => {
  assertMatch(mainSrc, /streaks: streaks\.exportData\(\),/, 'streak export missing');
  assertMatch(mainSrc, /profiles: profiles\.getAll\(\)/, 'profile export should use public getAll API');
  assertMatch(mainSrc, /const importedProfiles = profiles\.import\(JSON\.stringify\(parsed\.profiles\)\);/, 'profile import should replace from exported array');
  assertMatch(mainSrc, /if \(parsed\.streaks && typeof parsed\.streaks === 'object'\) streaks\.replaceAll\(parsed\.streaks\);/, 'streak import missing');
});

check('mini-mode: toggling keeps the auto-fit guard in sync', () => {
  assertMatch(mainSrc, /ipcMain\.on\('toggle-mini-mode', \(\) => \{[\s\S]*miniMode = !miniMode;[\s\S]*mainWindow\.miniMode = miniMode;/s, 'mainWindow.miniMode sync missing');
  assertMatch(mainSrc, /ipcMain\.on\('fit-window-height', \(event, contentHeight\) => \{[\s\S]*mainWindow\.miniMode\) return;/s, 'fit-window-height mini-mode guard missing');
});

check('widget: updates on lifecycle changes, not just timer ticks', () => {
  assertMatch(mainSrc, /function emitTimerUpdate\(type, data = \{\}\) \{[\s\S]*updateWidget\(\);[\s\S]*updateTrayText\(\);/s, 'widget not refreshed during state broadcasts');
  assertMatch(mainSrc, /if \(widgetWindow && !widgetWindow\.isDestroyed\(\)\) \{[\s\S]*widgetWindow\.show\(\);[\s\S]*updateWidget\(\);/s, 'widget reopen refresh missing');
  assertMatch(mainSrc, /widgetWindow\.webContents\.once\('did-finish-load', \(\) => \{[\s\S]*updateWidget\(\);[\s\S]*\}\);/s, 'widget initial refresh missing');
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

// The renderer is split across sibling <script> files sharing one global
// scope (no bundler). Keep this list in the same order as their <script src>
// tags in index.html, and add new renderer-*.js shards here as they're split
// out, so these content assertions keep matching regardless of which shard
// the checked code physically lives in.
const RENDERER_FILES = ['renderer-utils.js', 'renderer-profiles.js', 'renderer-calendar.js', 'renderer-receipts.js', 'renderer-family-remote.js', 'renderer-ritual-focus.js', 'renderer-settings.js', 'renderer-lastlight-alarm.js', 'renderer-onboarding-updater.js', 'renderer.js'];
const rendererSrc = RENDERER_FILES.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
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
  assertMatch(rendererSrc, /if \(tab === 'lib'\) \{[\s\S]*applyMainPanelVisibility\('lib'\);[\s\S]*handled = true;/s, 'LIB routing missing');
  assertMatch(rendererSrc, /if \(tab === 'sch'\) \{[\s\S]*applyMainPanelVisibility\('sch'\);[\s\S]*handled = true;/s, 'SCH routing missing');
  assertMatch(rendererSrc, /if \(tab === 'set'\) \{[\s\S]*openSettingsPanel\(\);[\s\S]*handled = true;/s, 'SET routing missing');
  assertMatch(rendererSrc, /if \(tab === 'help'\) \{[\s\S]*openHelpPanel\(\);[\s\S]*handled = true;/s, 'Help routing missing');
  assertMatch(rendererSrc, /if \(tab === 'stats'\) \{[\s\S]*applyMainPanelVisibility\('stats'\);[\s\S]*renderStatusPanel\(\);[\s\S]*handled = true;/s, 'STATS routing missing');
  assertMatch(rendererSrc, /document\.querySelectorAll\('\.ns-nav-item'\)\.forEach\(btn => \{[\s\S]*handleSidebarNavigation\(btn\.dataset\.nsTab\);/s, 'sidebar click handler missing');
});

check('renderer: LIB/SCH/STATS panels are mutually exclusive, single-visible destinations', () => {
  assertMatch(rendererSrc, /function applyMainPanelVisibility\(panel\) \{/, 'panel visibility switcher missing');
  assertMatch(rendererSrc, /els\.panelLib\.style\.display = panel === 'lib' \? '' : 'none';/, 'LIB panel toggle missing');
  assertMatch(rendererSrc, /els\.panelSch\.style\.display = panel === 'sch' \? '' : 'none';/, 'SCH panel toggle missing');
  assertMatch(rendererSrc, /els\.panelStats\.style\.display = panel === 'stats' \? '' : 'none';/, 'STATS panel toggle missing');
  assertMatch(htmlSrc, /id="ns-panel-lib"/, 'LIB panel container missing from HTML');
  assertMatch(htmlSrc, /id="ns-panel-sch"[^>]*style="display:none"/, 'SCH panel should start hidden in HTML');
  assertMatch(htmlSrc, /id="ns-panel-stats"[^>]*style="display:none"/, 'STATS panel should start hidden in HTML');
});

check('renderer: STATS panel shows only real companion/session data, honest empty state', () => {
  assertMatch(rendererSrc, /async function renderStatusPanel\(\) \{/, 'status panel renderer missing');
  assertMatch(rendererSrc, /api\.getRemoteControl\?\.\(\)/, 'STATS should read real companion status, not fabricate it');
  assertMatch(rendererSrc, /api\.listReceipts\?\.\(5\)/, 'STATS should read real receipt history, not fabricate it');
  assertMatch(rendererSrc, /No session history yet\./, 'STATS must show an honest empty state when there is no history');
});

check('renderer: footer and ledger controls provide real feedback', () => {
  assertMatch(rendererSrc, /els\.btnWidget\?\.addEventListener\('click', \(\) => \{[\s\S]*api\.toggleWidget\?\.\(\);[\s\S]*notify\('Desktop widget toggled', 'info'\);/s, 'widget button feedback missing');
  assertMatch(rendererSrc, /els\.btnCompanion\?\.addEventListener\('click', async \(\) => \{[\s\S]*notify\(`Companion at \$\{rc\.url\}`, 'info'\);[\s\S]*openSettingsPanel\(\);[\s\S]*notify\('Enable Remote Control in settings before opening the Companion PWA', 'info'\);[\s\S]*notify\('Companion setup is unavailable right now', 'warning'\);/s, 'companion button behavior missing');
  assertMatch(rendererSrc, /const btnNotif = document\.getElementById\('btn-notif'\);[\s\S]*notifDrawer\.style\.display = notifDrawer\.style\.display === 'none' \? '' : 'none';/s, 'notifications button handler missing');
  assertMatch(rendererSrc, /if \(els\.btnWarningLedger\) \{[\s\S]*openReceiptsLedger\(\)/s, 'warning ledger button wiring missing');
  assertMatch(rendererSrc, /if \(els\.btnProofDetails\) \{[\s\S]*openReceiptsLedger\(\)/s, 'proof ledger button wiring missing');
});

check('renderer: advanced options immediate persistence wiring', () => {
  assertMatch(rendererSrc, /els\.chkDryRun\?\.addEventListener\('change'[\s\S]*persistAdvancedOptions/, 'chkDryRun immediate persistence missing');
  assertMatch(rendererSrc, /els\.chkForceShutdown\?\.addEventListener\('change'[\s\S]*persistAdvancedOptions/, 'chkForceShutdown immediate persistence missing');
  assertMatch(rendererSrc, /els\.chkMute\?\.addEventListener\('change'[\s\S]*persistAdvancedOptions/, 'chkMute immediate persistence missing');
  assertMatch(rendererSrc, /els\.graceMinutes\?\.addEventListener\('change'[\s\S]*persistAdvancedOptions/, 'graceMinutes immediate persistence missing');
});

// Companion Easy Connect UI contract.
check('companion: mode buttons present in settings', () => {
  assert(htmlSrc.includes('data-mode="off"'), 'off mode button missing');
  assert(htmlSrc.includes('data-mode="local"'), 'local mode button missing');
  assert(htmlSrc.includes('data-mode="wifi"'), 'wifi mode button missing');
  assert(htmlSrc.includes('Connect Phone'), 'Connect Phone button missing');
});

check('companion: mode buttons have explanatory tooltips, and a live description reflects the selected mode', () => {
  // "This PC only" reads like it enables remote control from your phone --
  // it actually means the opposite (loopback-only). Tooltips + a dynamic
  // description line are the fix; regression-guard both.
  assertMatch(htmlSrc, /id="btn-mode-local"[^>]*title="[^"]*not reachable from your phone/, 'This PC only button needs a tooltip clarifying it is loopback-only, not phone-reachable');
  assertMatch(htmlSrc, /id="btn-mode-wifi"[^>]*title="[^"]*reachable from other devices/, 'Connect Phone button needs a tooltip clarifying LAN exposure');
  assert(htmlSrc.includes('id="remote-mode-description"'), 'remote-mode-description element missing from HTML');
  assertMatch(rendererSrc, /REMOTE_MODE_DESCRIPTIONS = \{[\s\S]*?off:[\s\S]*?local:[\s\S]*?wifi:/, 'REMOTE_MODE_DESCRIPTIONS map missing an off/local/wifi entry');
  assertMatch(rendererSrc, /els\.remoteModeDescription\.textContent = REMOTE_MODE_DESCRIPTIONS\[mode\]/, 'renderRemoteControl must update the mode description text');
});

check('content-blocker: recurring schedules -- settings default, IPC wiring, HTML, and renderer wiring', () => {
  const settingsSrc = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  assertMatch(settingsSrc, /contentBlocker:\s*\{[\s\S]*?schedules:\s*\[\]/, 'contentBlocker settings defaults missing schedules: []');

  // save-content-blocker-settings / get-content-blocker-settings are
  // pre-existing IPC channels (this feature is their first real caller) --
  // guard there's still exactly one handler each, since ipcMain.handle()
  // throws at startup on a second registration for the same channel.
  const saveMatches = mainSrc.match(/ipcMain\.handle\('save-content-blocker-settings'/g) || [];
  const getMatches = mainSrc.match(/ipcMain\.handle\('get-content-blocker-settings'/g) || [];
  assert(saveMatches.length === 1, `expected exactly 1 save-content-blocker-settings handler, found ${saveMatches.length} (a second ipcMain.handle() registration for the same channel throws at startup)`);
  assert(getMatches.length === 1, `expected exactly 1 get-content-blocker-settings handler, found ${getMatches.length}`);
  assertMatch(mainSrc, /ipcMain\.handle\('save-content-blocker-settings'[\s\S]*?checkContentBlockerSchedules\(\);/, 'save-content-blocker-settings should re-evaluate schedules immediately, not wait up to 60s');
  assertMatch(mainSrc, /setInterval\(checkContentBlockerSchedules, 60000\);/, 'checkContentBlockerSchedules should run on a periodic timer');
  assertMatch(mainSrc, /restoreAfterTimer[\s\S]*?contentBlocker\.isAnyScheduleActive\(cbConfig\.schedules/, 'restoreAfterTimer must not unblock while a recurring schedule is still active');

  assert(htmlSrc.includes('id="cb-schedules-list"'), 'cb-schedules-list missing from HTML');
  assert(htmlSrc.includes('id="cb-schedule-form"'), 'cb-schedule-form missing from HTML');
  assert(htmlSrc.includes('id="cb-rule-start"') && htmlSrc.includes('id="cb-rule-end"'), 'cb-rule-start/end time inputs missing from HTML');

  assertMatch(rendererSrc, /function renderContentBlockerSchedules\(\)/, 'renderContentBlockerSchedules missing');
  assertMatch(rendererSrc, /function persistCbSchedules\(\)/, 'persistCbSchedules missing');
  assertMatch(rendererSrc, /api\.saveContentBlockerSettings\?\.\(\{ schedules: cbSchedules \}\)/, 'persistCbSchedules must save only the schedules key, not clobber the rest of the section');
  assertMatch(rendererSrc, /cbSchedules = Array\.isArray\(cb\.schedules\) \? cb\.schedules : \[\]/, 'applyContentBlockerSettings must load schedules from settings on open');
});

check('settings: WiFi Guard / Content Blocker / Accountability settings actually rehydrate on launch', () => {
  // Real pre-existing bug, found via manual runtime testing while building
  // the content-blocker-schedules feature: loadInitialData() checked
  // `appSettings.wifiGuard` / `appSettings.contentBlocker` /
  // `appSettings.accountability`, but get-app-settings never returns those
  // keys (only app/customization/lastLight/calendar/recoverableTimer) --
  // so those three sections' saved state, including the enable checkboxes,
  // never reloaded on app launch. Re-saving the Options modal from that
  // stale (always-unchecked) state would have silently disabled them.
  // Fixed by fetching each via its own dedicated getter, same pattern as
  // smartLights/getSmartLightConfig already used correctly.
  assertMatch(rendererSrc, /const \[systemInfo, appSettings, lightConfig, wifiConfig, cbConfig, accConfig\] = await Promise\.all\(\[/, 'loadInitialData must fetch wifiGuard/contentBlocker/accountability via their own calls, not assume they are nested in appSettings');
  assertMatch(rendererSrc, /api\.getWifiGuardSettings\?\.\(\)/, 'loadInitialData missing api.getWifiGuardSettings() call');
  assertMatch(rendererSrc, /api\.getContentBlockerSettings\?\.\(\)/, 'loadInitialData missing api.getContentBlockerSettings() call');
  assertMatch(rendererSrc, /api\.getAccountabilitySettings\?\.\(\)/, 'loadInitialData missing api.getAccountabilitySettings() call');
  assertMatch(rendererSrc, /if \(wifiConfig\) applyWifiGuardSettings\(wifiConfig\);/, 'applyWifiGuardSettings must be driven by the dedicated getter result, not appSettings.wifiGuard (always undefined)');
  assertMatch(rendererSrc, /if \(cbConfig\) applyContentBlockerSettings\(cbConfig\);/, 'applyContentBlockerSettings must be driven by the dedicated getter result, not appSettings.contentBlocker (always undefined)');
  assertMatch(rendererSrc, /if \(accConfig\) applyAccountabilitySettings\(accConfig\);/, 'applyAccountabilitySettings must be driven by the dedicated getter result, not appSettings.accountability (always undefined)');
  // Guard against the bug's exact shape ever coming back.
  assert(!/if \(appSettings\.wifiGuard\)/.test(rendererSrc), 'regression: appSettings.wifiGuard check reintroduced (always undefined, get-app-settings never returns it)');
  assert(!/if \(appSettings\.contentBlocker\)/.test(rendererSrc), 'regression: appSettings.contentBlocker check reintroduced');
  assert(!/if \(appSettings\.accountability\)/.test(rendererSrc), 'regression: appSettings.accountability check reintroduced');
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

check('companion: reconnects cannot let stale sockets replace a healthy connection', () => {
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  assert(companionHtml.includes('if (ws !== socket) return;'), 'stale WebSocket callbacks must be ignored');
  assertMatch(companionHtml, /socket\.onopen = \(\) => \{\s*if \(ws !== socket\) return;\s*if \(reconnectTimer\) clearTimeout\(reconnectTimer\);\s*reconnectTimer = null;/, 'a successful connection must cancel its pending reconnect timer');
  assert(companionHtml.includes('reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 3000);'), 'reconnect timer state must clear before a new connection attempt');
  assert(companionHtml.includes("fetch(`/pair-check?t=${encodeURIComponent(pairToken)}`"), 'companion should preflight pairing so an expired token is not reported as an offline PC');
  assert(companionHtml.includes("if (connectionState !== 'offline') setConnectionState('connecting', 'Connecting…');"), 'background retries must keep the actionable offline state visible');
  assert(companionHtml.includes('signal: AbortSignal.timeout(5000)'), 'pair-check preflight must not hang forever on an unreachable old PC address');
  assert(companionHtml.includes('id="pair-status" role="alert"'), 'pairing form must have a visible status region');
  assert(companionHtml.includes("showPairing('Pairing expired. Enter the current pairing code from the desktop app.')"), 'expired pairing must remain visible after the pairing form opens');
  assert((companionHtml.match(/function showToast\(msg\)/g) || []).length === 1, 'companion page must not contain duplicate function declarations');
});

check('companion: host query cannot override location.host for the pairing token', () => {
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  // location.host must be checked and returned before the URL `host` param is
  // ever read, so a crafted link can't redirect the pairing token to a
  // different origin when the page is served by the real PC.
  assertMatch(companionHtml, /function resolveHost\(\) \{\s*\n(?:[^\n]*\n)*?\s*if \(location\.host\) return location\.host;/, 'resolveHost must prefer location.host before reading the URL host param');
  assertMatch(companionHtml, /function isValidHost\(h\) \{/, 'host values must be validated before use');
  assertMatch(companionHtml, /if \(fromUrl && isValidHost\(fromUrl\)\)/, 'URL host param must be validated, not trusted as-is');
});

check('companion: no dangling getElementById reference crashes the page on load', () => {
  // Regression test for two real bugs found via live device testing (phone
  // physically paired to a running desktop instance): a 2026-07-03 merge
  // (3042de6) dropped the #pair-reset button from the markup but left
  // `const pairReset = document.getElementById('pair-reset')` and an
  // unguarded `pairReset.addEventListener(...)` behind, and a separate,
  // older redesign dropped the entire #disconnected/#disconnected-msg
  // status block while five call sites across every connection-state-change
  // path (setConnectionState, showPairing, ws.onclose, ws.onerror) kept
  // referencing it unguarded. Both are always-null references, so both threw
  // an uncaught TypeError on page load / on first WebSocket state change --
  // which silently aborted the rest of that top-level script. Concretely:
  // the pair-reset crash meant connect() never even ran, so the phone
  // companion was stuck on the static "Connecting..." placeholder forever,
  // for every user, regardless of a correct token/network -- the entire
  // remote-control-from-phone feature was non-functional. The status pill
  // already carries the identical message via setConnectionState(state,
  // msg), so the fix was deleting the redundant dead block rather than
  // resurrecting removed UI (same call made for pair-reset: reconnection is
  // already automatic via scheduleReconnect()).
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  assert(!/pairReset|pair-reset/.test(companionHtml), 'a dead pairReset/pair-reset reference has reappeared with no corresponding element -- this crashes the page on load');
  assert(!/\bconst disconnected\b|disconnected-msg|disconnected\.style/.test(companionHtml), 'a dead #disconnected/#disconnected-msg reference has reappeared with no corresponding element -- this crashes every connection-state change');
});

check('companion: no const-bound getElementById references an id missing from the markup', () => {
  // General guard for the whole bug class the two checks above document by
  // name: `const x = document.getElementById('foo')` where 'foo' doesn't
  // exist in the markup is always either dead code (delete it) or a crash
  // waiting to happen the next time x.something runs unguarded -- there's no
  // third option. A third real instance of this (an already-guarded
  // `const bat = document.getElementById('comp-battery')` with no matching
  // element, silently disabling the phone's battery display -- non-crashing
  // only because it happened to be guarded) was found by exactly this audit
  // and fixed by adding the missing #comp-battery element rather than
  // deleting the code, since the feature was wanted, just never wired up.
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  const declared = [...companionHtml.matchAll(/const\s+(\w+)\s*=\s*document\.getElementById\('([^']+)'\)/g)];
  const ids = new Set([...companionHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const dead = declared.filter(([, , id]) => !ids.has(id)).map(([, varName, id]) => `${varName} -> #${id}`);
  assert(dead.length === 0, `dead getElementById reference(s) found: ${dead.join(', ')}`);
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

check('companion: dead setRemoteControlEnabled IPC surface removed', () => {
  assert(!/setRemoteControlEnabled/.test(preloadSrc), 'preload should not expose the removed set-remote-control-enabled channel');
  assert(!/ipcMain\.handle\('set-remote-control-enabled'/.test(mainSrc), 'main should not register a handler for the removed channel');
  assertMatch(preloadSrc, /setRemoteControlMode: \(mode\) => ipcRenderer\.invoke\('set-remote-control-mode', mode\)/, 'the real set-remote-control-mode bridge must still be exposed');
});

check('ipc: execute-action power-action channel removed (unvalidated, unused renderer-facing surface)', () => {
  assert(!/executeAction/.test(preloadSrc), 'preload should not expose an executeAction bridge');
  assert(!/'execute-action'/.test(preloadSrc), 'preload should not reference the execute-action channel');
  assert(!/ipcMain\.handle\('execute-action'/.test(mainSrc), 'main should not register a handler for execute-action');
  assert(!/executeAction/.test(rendererSrc), 'renderer (including the offline-preview fallback) should not reference executeAction');
});

check('companion: same-wifi URL includes token and host for Android APK', () => {
  // The URL must carry the token and a host parameter so packaged Android
  // companions (which load the UI locally) know where to connect.
  const wifiUrlMatch = mainSrc.match(/url = `http:\/\/\$\{lanIp\}:\$\{companion\.PWA_PORT\}\/\?t=\$\{rc\.token\}&host=\$\{encodeURIComponent\(`\$\{lanIp\}:\$\{companion\.PWA_PORT\}`\)\}`;/);
  assert(wifiUrlMatch, 'wifi URL construction not found or malformed');
  const wifiUrl = wifiUrlMatch[0];
  assert(wifiUrl.includes('t=${rc.token}'), 'wifi URL missing token');
  assert(wifiUrl.includes('host='), 'wifi URL missing host parameter');
  assert(wifiUrl.includes('encodeURIComponent'), 'wifi URL must encode the host parameter');
  assert(wifiUrl.includes('${lanIp}:${companion.PWA_PORT}'), 'wifi URL host must include the selected LAN IP and port');
});

check('companion: QR URL has no host in off or local mode', () => {
  // Off and local modes intentionally omit the LAN host parameter.
  const localUrlMatch = mainSrc.match(/url = `http:\/\/127\.0\.0\.1:\$\{companion\.PWA_PORT\}\/\?t=\$\{rc\.token\}`;/);
  assert(localUrlMatch, 'local URL construction not found');
  assert(!localUrlMatch[0].includes('host='), 'local URL should not include a host parameter');
});

check('companion: same-wifi status shows Waiting for phone before client connects', () => {
  // getCompanionStatusLabel must return 'Waiting for phone' when wifi mode is
  // enabled but no client has connected yet.
  assertMatch(mainSrc, /if \(mode === 'off'\) return 'Off';/, 'Off label missing');
  assertMatch(mainSrc, /if \(mode === 'local'\) return 'This PC only';/, 'local label missing');
  assertMatch(mainSrc, /if \(failed\) return 'Connection failed';/, 'failed label missing');
  assertMatch(mainSrc, /if \(connected\) return 'Phone connected';/, 'connected label missing');
  assertMatch(mainSrc, /if \(clients > 0\) return 'Phone connected';/, 'clients label missing');
  assertMatch(mainSrc, /return 'Waiting for phone';/, 'Waiting for phone fallback missing');
});

check('companion: failed pairing attempts are surfaced to the desktop UI, calmly', () => {
  // Informational only -- see recordFailedAttempt's comment in companion.js
  // for why this is deliberately not a lockout/rate-limit. Guards that the
  // wiring from companion.js's counter through main.js to the renderer stays
  // intact, and that the copy stays factual rather than alarmist (no "ALERT",
  // no red/danger styling class beyond the existing muted text color).
  assertMatch(mainSrc, /failedAttempts: status\.failedAttempts \|\| 0/, 'getRemoteControlState must forward failedAttempts from companion.getStatus()');
  assertMatch(mainSrc, /lastFailedIp: status\.lastFailedIp \|\| ''/, 'getRemoteControlState must forward lastFailedIp from companion.getStatus()');
  assert(htmlSrc.includes('id="remote-failed-attempts"'), 'remote-failed-attempts element missing from HTML');
  assert(htmlSrc.includes('id="remote-failed-attempts-text"'), 'remote-failed-attempts-text element missing from HTML');
  assert(!/ALERT|SECURITY WARNING|danger/i.test(htmlSrc.match(/<p id="remote-failed-attempts"[\s\S]*?<\/p>/)?.[0] || ''), 'failed-attempts copy should stay calm/factual, not alarmist');
  assertMatch(rendererSrc, /els\.remoteFailedAttempts\.style\.display = count > 0 \? '' : 'none'/, 'renderer must show/hide the failed-attempts line based on a real count');
});

check('trusted-lan: explicit warning modal exists and states the real exposure/limits', () => {
  assert(htmlSrc.includes('id="lan-warning-modal"'), 'lan-warning-modal missing from HTML');
  assert(htmlSrc.includes('id="btn-lan-warning-confirm"'), 'lan-warning confirm button missing');
  assert(htmlSrc.includes('id="btn-lan-warning-cancel"'), 'lan-warning cancel button missing');
  assertMatch(htmlSrc, /Any device on this Wi-Fi network[\s\S]*pairing code can start, pause, snooze, or cancel/, 'warning copy must state exactly what is exposed');
  assertMatch(htmlSrc, /never<\/strong> force a shutdown, log you out, or hibernate/, 'warning copy must state what stays off-limits');
});

check('trusted-lan: enabling wifi mode is gated behind the warning modal, other modes are not', () => {
  assertMatch(rendererSrc, /function showLanWarningModal\(\)/, 'showLanWarningModal helper missing');
  assertMatch(rendererSrc, /if \(mode === 'wifi' && !btn\.classList\.contains\('active'\)\) \{\s*const confirmed = await showLanWarningModal\(\);\s*if \(!confirmed\) return;/, 'wifi mode click must await confirmation before proceeding, and bail out if cancelled');
});

check('trusted-lan: Escape cancels the warning modal without silently enabling wifi mode', () => {
  assertMatch(rendererSrc, /document\.getElementById\('lan-warning-modal'\)\?\.classList\.contains\('active'\)[\s\S]{0,40}document\.getElementById\('btn-lan-warning-cancel'\)\?\.click\(\)/, 'Escape must click the cancel button (resolving the confirmation promise as false), not just hide the modal');
});

check('weekly-report: "This Week" UI is wired to the real backend field, not a placeholder', () => {
  assert(htmlSrc.includes('id="weekly-report-text"'), 'weekly-report-text element missing from HTML');
  assert(htmlSrc.includes('id="btn-copy-weekly-report"'), 'copy-weekly-report button missing from HTML');
  assertMatch(rendererSrc, /els\.weeklyReportText\.textContent = report\?\.narrative/, 'renderer must populate the narrative from the real report field');
  assertMatch(rendererSrc, /els\.btnCopyWeeklyReport\?\.addEventListener\('click'/, 'copy-weekly-report button is not wired to a click handler');
  assertMatch(mainSrc, /ipcMain\.handle\('get-weekly-report'/, 'get-weekly-report IPC handler missing');
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

  check('receipts: getAllReceiptsForExport returns the full ledger, not just the display-limited list', () => {
    rr.clearReceipts();
    const r1 = rr.createRunReceipt({ action: 'shutdown', totalSeconds: 1800 });
    const r2 = rr.createRunReceipt({ action: 'sleep', totalSeconds: 900 });
    const all = rr.getAllReceiptsForExport();
    assert(Array.isArray(all) && all.length === 2, `expected 2 receipts, got ${all.length}`);
    assert(all[0].id === r1.id && all[1].id === r2.id, 'export should be oldest-first, matching storage order');
    // Mutating the returned array must not corrupt the live cache.
    all.pop();
    assert(rr.getAllReceiptsForExport().length === 2, 'export should return a copy, not the live array');
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

check('receipts: export-receipts IPC handler and preload bridge wired', () => {
  assertMatch(mainSrc, /ipcMain\.handle\('export-receipts'.*\n.*runReceipts\.getAllReceiptsForExport\(\)/, 'export-receipts IPC handler missing or not wired to runReceipts.getAllReceiptsForExport');
  assertMatch(preloadSrc, /exportReceipts:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('export-receipts'\)/, 'preload exportReceipts bridge missing');
  assert(htmlSrc.includes('id="btn-export-receipts"'), 'btn-export-receipts missing from HTML');
  assertMatch(rendererSrc, /els\.btnExportReceipts/, 'renderer does not wire up btnExportReceipts');
});

check('receipts: humanizeReceiptResult turns raw result codes into readable proof text', () => {
  // Extract and eval the pure function directly (no DOM deps) so this
  // actually exercises the mapping logic, not just source-text presence.
  const fnMatch = rendererSrc.match(/function humanizeReceiptResult\([\s\S]*?\n}/);
  assert(fnMatch, 'humanizeReceiptResult function not found in renderer-receipts.js');
  const humanizeReceiptResult = new Function(`${fnMatch[0]}; return humanizeReceiptResult;`)();

  assert(humanizeReceiptResult('power_executed') === 'Completed', 'power_executed should read "Completed"');
  assert(humanizeReceiptResult('dry_run_completed') === 'Dry Run Completed', 'dry_run_completed should read "Dry Run Completed"');
  assert(humanizeReceiptResult('cancelled') === 'Cancelled', 'cancelled should read "Cancelled"');
  assert(humanizeReceiptResult(null) === 'Unknown', 'null/undefined result should read "Unknown", not crash');
  // Unmapped codes still get title-cased with underscores turned to spaces,
  // instead of leaking a raw snake_case enum into "proof" a user reads.
  assert(humanizeReceiptResult('some_new_result') === 'Some New Result', 'unmapped codes should title-case, not leak snake_case');

  // And confirm both clipboard-copy call sites actually use it instead of
  // the raw result/timestamp fields (the bug this fixes).
  assertMatch(rendererSrc, /Result: \$\{humanizeReceiptResult\(receipt\.result\)\}/, 'Copy Proof handler should humanize the result, not dump the raw code');
  assertMatch(rendererSrc, /Started: \$\{receipt\.startedAt \? new Date\(receipt\.startedAt\)\.toLocaleString\(\)/, 'Copy Proof handler should format startedAt, not paste the raw ISO string');
  assertMatch(rendererSrc, /Result: \$\{humanizeReceiptResult\(r\.result\)\}/, 'Export Ledger handler should humanize the result, not dump the raw code');
});

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

check('fullscreen-clock: IPC handler, window sync, preload, HTML, and renderer wiring', () => {
  assertMatch(mainSrc, /ipcMain\.handle\('set-fullscreen-clock', \(event, flag\) => \{[\s\S]*?mainWindow\.miniMode\) return \{ fullScreen: false \};[\s\S]*?mainWindow\.setFullScreen\(!!flag\);/, 'set-fullscreen-clock IPC handler missing or not disabled in mini mode');
  assertMatch(mainSrc, /mainWindow\.on\('enter-full-screen', \(\) => \{[\s\S]*?send\('fullscreen-changed', true\)/, 'enter-full-screen -> fullscreen-changed(true) missing');
  assertMatch(mainSrc, /mainWindow\.on\('leave-full-screen', \(\) => \{[\s\S]*?send\('fullscreen-changed', false\)/, 'leave-full-screen -> fullscreen-changed(false) missing, OS-level exits would desync the renderer');
  assertMatch(preloadSrc, /setFullScreenClock:\s*\(flag\)\s*=>\s*ipcRenderer\.invoke\('set-fullscreen-clock', flag\)/, 'preload setFullScreenClock bridge missing');
  assertMatch(preloadSrc, /onFullScreenChanged:\s*\(cb\)\s*=>\s*ipcRenderer\.on\('fullscreen-changed'/, 'preload onFullScreenChanged bridge missing');
  assert(htmlSrc.includes('id="btn-fullscreen-clock"'), 'btn-fullscreen-clock missing from HTML');
  assert(htmlSrc.includes('id="btn-fullscreen-clock-exit"'), 'btn-fullscreen-clock-exit missing from HTML');
  assertMatch(rendererSrc, /fullscreenClock: false,/, 'state.fullscreenClock missing');
  assertMatch(rendererSrc, /if \(state\.fullscreenClock\) \{\s*exitFullscreenClock\(\);/, 'Escape should exit fullscreen clock mode before any other action');
  assertMatch(rendererSrc, /els\.body\.classList\.toggle\('fullscreen-clock-mode', state\.fullscreenClock\)/, 'applyFullscreenClockState should drive the body class from main-process state, not a local guess');

  // Regression coverage for three bugs a manual runtime pass caught (the
  // whole point of this feature's "Ship only if: Manual runtime proof
  // exists" gate) that static wiring checks alone would have missed:

  // 1. .fullscreen-clock-btn defaults to display:none in CSS, so toggling
  //    the inline style to '' falls back to that CSS default (still
  //    hidden) instead of showing the button -- must set an explicit value.
  assertMatch(rendererSrc, /btnFullscreenClock\.style\.display = \(idleClockVisible && !state\.fullscreenClock\) \? 'flex' : 'none'/, "fullscreen button must toggle to an explicit 'flex', not '' (falls back to the CSS class's display:none), and must hide itself once already fullscreen");

  // 2. The exit button must NOT be a descendant of the transformed
  //    .timer-section: a transformed ancestor turns a descendant's
  //    position:fixed into "fixed relative to that ancestor," so the
  //    2.8x scale would blow up its size and reposition it off in a corner
  //    of the scaled ring instead of the actual screen corner.
  const exitBtnIdx = htmlSrc.indexOf('id="btn-fullscreen-clock-exit"');
  const timerSectionIdx = htmlSrc.indexOf('<section class="timer-section">');
  assert(exitBtnIdx >= 0 && timerSectionIdx >= 0 && exitBtnIdx < timerSectionIdx, 'btn-fullscreen-clock-exit must be defined before/outside .timer-section, not nested inside the transformed ring section');

  // 3. Entering fullscreen must force the Library tab active first -- the
  //    fullscreen CSS only hides content within #ns-panel-lib, so a stale
  //    nsActiveTab left on Schedule/Stats from a prior session would leak
  //    that panel's content into the fullscreen view instead of the clock.
  assertMatch(rendererSrc, /function enterFullscreenClock\(\) \{\s*[\s\S]*?handleSidebarNavigation\('lib', \{ persist: false \}\);/, 'enterFullscreenClock must force the lib panel active before entering fullscreen');
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

check('ritual-mode: lights step uses a real smart-lights scene helper', () => {
  const smartLightsSrc = fs.readFileSync(path.join(root, 'smartLights.js'), 'utf8');
  assertMatch(smartLightsSrc, /async function applyScene\(sceneId\) \{/, 'smart-lights scene helper missing');
  assertMatch(smartLightsSrc, /module\.exports = \{[\s\S]*applyScene,/s, 'smart-lights scene helper not exported');
  assertMatch(mainSrc, /smartLights\.applyScene\('night'\)\.catch\(\(\) => \{\}\);/, 'ritual lights step should use exported applyScene helper');
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

check('ux: ns-play-btn has exactly one click handler (no duplicate startTimer)', () => {
  const matches = rendererSrc.match(/getElementById\('ns-play-btn'\)\?\.addEventListener\('click'/g) || [];
  assert(matches.length === 1, `ns-play-btn should have exactly one click handler, found ${matches.length}`);
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

// 21. Version display sync (drift prevention)
check('version: get-app-version IPC is sourced from package.json, not a second hardcoded string', () => {
  assertMatch(mainSrc, /ipcMain\.handle\('get-app-version', async \(\) => updater\.currentVersion\)/, 'get-app-version handler must return updater.currentVersion (package.json-derived)');
  assertMatch(preloadSrc, /getAppVersion: \(\) => ipcRenderer\.invoke\('get-app-version'\)/, 'preload must expose a getAppVersion bridge');
});

check('version: renderer overrides the static footer/About text from the runtime version', () => {
  assertMatch(rendererSrc, /async function applyAppVersion\(\)/, 'applyAppVersion is missing');
  assertMatch(rendererSrc, /api\.getAppVersion\?\.\(\)/, 'renderer must call api.getAppVersion()');
  assertMatch(rendererSrc, /els\.version\.textContent = `v\$\{version\}`/, 'footer #version is not updated from the runtime version');
  assertMatch(rendererSrc, /els\.aboutVersion\.textContent = `Version \$\{version\}`/, 'About modal version is not updated from the runtime version');
  assertMatch(rendererSrc, /applyAppVersion\(\);\s*$/m, 'applyAppVersion must run on startup');
});

check('version: HTML fallback text matches electron/package.json (fails the build if someone bumps one and not the other)', () => {
  const pkgVersion = require(path.join(root, 'package.json')).version;
  const escaped = pkgVersion.replace(/\./g, '\\.');
  assertMatch(htmlSrc, new RegExp(`id="version">v${escaped}<`), `footer #version fallback text does not match package.json version (${pkgVersion})`);
  assertMatch(htmlSrc, new RegExp(`id="about-version">Version ${escaped}<`), `About modal fallback version text does not match package.json version (${pkgVersion})`);
});

// 22. Wordmark overlap layout prevention
check('layout: wordmark positioned outside header to avoid menu overlap', () => {
  assert(htmlSrc.indexOf('</header>') < htmlSrc.indexOf('class="ns-header-wordmark"'), 'ns-header-wordmark should be placed after header closes');
});

// Cleanup.
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
