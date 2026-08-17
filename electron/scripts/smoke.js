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
const jsFiles = ['main.js', 'preload.js', 'renderer-utils.js', 'renderer-profiles.js', 'renderer-calendar.js', 'renderer-receipts.js', 'renderer-family-remote.js', 'renderer-ritual-focus.js', 'renderer-settings.js', 'renderer-lastlight-alarm.js', 'renderer-onboarding-updater.js', 'renderer.js', 'settings.js', 'smartLights.js', 'profiles.js', 'profileIdentity.js', 'profileRitualContext.js', 'startDecision.js', 'windowGeometry.js', 'calendar.js', 'lastLight.js', 'companionNetwork.js', 'companionFirewall.js', 'capabilityTruth.js'];
for (const file of jsFiles) {
  check(`syntax: ${file}`, () => {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  });
}

check('package: local main-process modules are included in the build', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packagedFiles = new Set(packageJson.build?.files || []);
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const localRequires = [...mainSrc.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)]
    .map(match => path.extname(match[1]) ? match[1] : `${match[1]}.js`);

  for (const requiredFile of localRequires) {
    assert(packagedFiles.has(requiredFile), `${requiredFile} is required by main.js but missing from build.files`);
  }
});

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

check('settings: selected profile persists and reloads from disk', () => {
  const settings = require(path.join(root, 'settings.js'));
  settings.updateSection('app', { lastSelectedProfileId: 'profile-alex' });
  settings.load();
  assert(settings.getSection('app').lastSelectedProfileId === 'profile-alex', 'selected profile did not reload');
  settings.updateSection('app', { lastSelectedProfileId: null });
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
  const requested = { enabled: true, provider: 'hue', hueBridgeIp: '192.168.0.2', hueUsername: 'verified-user', dimMinutes: 7 };
  requested.verifiedConfigKey = smartLights.configurationKey(requested);
  smartLights.loadConfig(requested);
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

check('profiles: family identity metadata is safe and legacy-compatible', () => {
  const profiles = require(path.join(root, 'profiles.js'));
  const family = profiles.normalize({ name: 'Alex', kind: 'family', avatar: 'A' });
  const legacy = profiles.normalize({ name: 'Movie Night' });
  assert(family.kind === 'family' && family.avatar === 'A', 'family identity fields not preserved');
  assert(legacy.kind === 'timer' && legacy.avatar === '', 'legacy profile identity defaults changed');
});

check('profiles: display-only accents normalize and round-trip through profile import/export', () => {
  const profiles = require(path.join(root, 'profiles.js'));
  const imported = profiles.import(JSON.stringify([
    { name: 'Accent Valid', kind: 'family', accent: '#a855f7' },
    { name: 'Accent Invalid', kind: 'family', accent: 'red' },
    { name: 'Accent Legacy' }
  ]));
  assert(imported.success && imported.count === 3, 'accent profile import failed');
  const exported = JSON.parse(profiles.export());
  assert(exported.find(p => p.name === 'Accent Valid')?.accent === '#a855f7', 'valid accent did not round-trip');
  assert(exported.find(p => p.name === 'Accent Invalid')?.accent === null, 'invalid accent survived import');
  assert(exported.find(p => p.name === 'Accent Legacy')?.accent === null, 'legacy accent default changed');

  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assertMatch(mainSrc, /const importedProfiles = profiles\.import\(JSON\.stringify\(parsed\.profiles\)\);/, 'full-data import bypasses profile normalization');
});

check('profiles: accent presentation stays element-scoped and selection stays inert', () => {
  const rendererProfilesSrc = fs.readFileSync(path.join(root, 'renderer-profiles.js'), 'utf8');
  const profileStylesSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assertMatch(rendererProfilesSrc, /element\.style\.setProperty\('--profile-accent', accent\)/, 'profile accent is not element-scoped');
  assertMatch(profileStylesSrc, /\.profile-card\.has-profile-accent::before[\s\S]*var\(--profile-accent\)/, 'profile card accent styling missing');
  assertMatch(profileStylesSrc, /\.profile-item\.has-profile-accent[\s\S]*var\(--profile-accent\)/, 'profile row accent styling missing');
  assert(!rendererProfilesSrc.includes('applyCustomization'), 'profile accents call global customization');
  assert(!rendererProfilesSrc.includes('settings.customization'), 'profile accents write customization settings');
  assert(!rendererProfilesSrc.includes('document.documentElement'), 'profile accents write root theme variables');
  assert(!rendererProfilesSrc.includes('body.dataset.theme'), 'profile accents change the global theme');
  const startFnMatch = rendererProfilesSrc.match(/function shouldStartOnProfileSelection\(options = \{\}\) \{[\s\S]*?\n\}/);
  const shouldStart = Function(`return (${startFnMatch[0]})`)();
  assert(shouldStart({ accent: '#a855f7', autoStart: true }) === false, 'accented selection starts a timer');
  assert(!/ritualStart/.test(rendererProfilesSrc), 'profile selection gained ritual behavior');
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

check('family profiles: selection stays inert and identity reaches receipts', () => {
  const familySettingsSrc = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  const familyMainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const familyRendererSrc = ['renderer-profiles.js', 'renderer-receipts.js', 'renderer.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assertMatch(familySettingsSrc, /lastSelectedProfileId:\s*null/, 'selected profile default missing');
  assertMatch(familyRendererSrc, /await persistSelectedProfile\(profileId\)/, 'profile selection is not persisted');
  const startFnMatch = familyRendererSrc.match(/function shouldStartOnProfileSelection\(options = \{\}\) \{[\s\S]*?\n\}/);
  assert(startFnMatch, 'selection start policy helper missing');
  const shouldStart = Function(`return (${startFnMatch[0]})`)();
  assert(shouldStart({ autoStart: true }) === false, 'legacy autoStart starts a timer on selection');
  assert(shouldStart({ start: true }) === true, 'explicit Start Profile action is blocked');
  assertMatch(familyRendererSrc, /profileId:\s*state\.currentProfileId/, 'selected profile ID is not sent with timer start');
  assert(!/profileName:\s*state\.profiles/.test(familyRendererSrc), 'renderer profile name still crosses the trust boundary');
  assertMatch(familyMainSrc, /timerState\.profileId = identity\.profileId;[\s\S]*timerState\.profileName = identity\.profileName;/, 'main timer state does not use canonical identity');
  assertMatch(familyMainSrc, /source:\s*'remote'/, 'remote starts are not explicitly marked unattributed');
  assertMatch(familyMainSrc, /profileIdentity\.resolveTimerProfileIdentity\(/, 'main does not use the tested attribution policy');
});

check('profiles: deleting or replacing the selected profile clears persisted selection', () => {
  const settings = require(path.join(root, 'settings.js'));
  const profiles = require(path.join(root, 'profiles.js'));
  const identity = require(path.join(root, 'profileIdentity.js'));

  const created = profiles.create({ name: 'Temporary Family Member', kind: 'family' });
  settings.updateSection('app', { lastSelectedProfileId: created.profile.id });
  profiles.delete(created.profile.id);
  identity.reconcilePersistedSelection(settings, profiles);
  assert(settings.getSection('app').lastSelectedProfileId === null, 'delete left a stale selected profile');

  settings.updateSection('app', { lastSelectedProfileId: 'removed-by-import' });
  profiles.import(JSON.stringify([{ name: 'Imported Routine' }]));
  identity.reconcilePersistedSelection(settings, profiles);
  assert(settings.getSection('app').lastSelectedProfileId === null, 'import left a stale selected profile');
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
const windowGeometrySrc = fs.readFileSync(path.join(root, 'windowGeometry.js'), 'utf8');
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
  assertMatch(mainSrc, /const SUPPRESS_AUTOMATION_TRAY = DESKTOP_UX_PROOF \|\| process\.env\.LIGHTS_OUT_SUPPRESS_TRAY === '1';/, 'automation tray suppression contract missing');
  assertMatch(mainSrc, /async function createTray\(\) \{/, 'createTray function missing');
  assertMatch(mainSrc, /if \(SUPPRESS_AUTOMATION_TRAY\) return;/, 'automation must not create real Windows tray icons');
  assertMatch(mainSrc, /if \(tray && !tray\.isDestroyed\(\)\) return;/, 'tray creation must be idempotent within one app process');
  assertMatch(mainSrc, /tray = new Tray\(trayIcons\.idle\);/, 'tray creation missing');
  assertMatch(mainSrc, /before-quit[\s\S]{0,200}tray\.destroy\(\);[\s\S]{0,100}tray = null;/, 'quit must explicitly destroy the tray icon');
  for (const runner of [
    'desktop-ux-functional-gate.js',
    'settings-native-proof.js',
    'packaged-truth-smoke.js',
    'packaged-network-smoke.js',
    'native-walkthrough.js',
    'companion-v2-electron-proof.js',
    'receipt-recovery-electron-proof.js'
  ]) {
    const runnerSrc = fs.readFileSync(path.join(root, 'scripts', runner), 'utf8');
    assertMatch(runnerSrc, /LIGHTS_OUT_(?:DESKTOP_UX_GATE|SUPPRESS_TRAY)/, `${runner} can create orphan tray icons`);
  }
});

check('tray: hide/show and toggle logic', () => {
  assertMatch(mainSrc, /function toggleMainWindow\(\) \{/, 'toggleMainWindow function missing');
  assertMatch(mainSrc, /if \(mainWindow\.isVisible\(\)\) \{[\s\S]*mainWindow\.hide\(\);/s, 'toggleMainWindow hide logic missing');
  assertMatch(mainSrc, /\} else \{[\s\S]*mainWindow\.show\(\);/s, 'toggleMainWindow show logic missing');
  assertMatch(mainSrc, /tray\.on\('click', toggleMainWindow\);/, 'tray click event not wired to toggle');
});

check('mini-mode: toggle and resizing', () => {
  assertMatch(mainSrc, /let miniMode = false;/, 'miniMode variable missing');
  assertMatch(mainSrc, /ipcMain\.on\('toggle-mini-mode', \(\) => \{[\s\S]*const enteringMiniMode = !miniMode;[\s\S]*miniMode = enteringMiniMode;/s, 'miniMode toggle missing');
  assertMatch(mainSrc, /if \(enteringMiniMode\) windowGeometry\.enterMiniMode\(mainWindow\);/, 'mini-mode geometry transition missing');
  assertMatch(windowGeometrySrc, /setMinimumSize\(MINI_GEOMETRY\.width, MINI_GEOMETRY\.height\);[\s\S]*setSize\(MINI_GEOMETRY\.width, MINI_GEOMETRY\.height\);/s, 'mini-mode minimum must change before resize');
  assertMatch(mainSrc, /mainWindow\.webContents\.send\('mini-mode-changed', miniMode\);/, 'mini-mode-changed event missing');
});

check('window chrome: frameless window remains movable and resizable', () => {
  const windowHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const windowRenderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const windowCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assertMatch(mainSrc, /frame: false,[\s\S]*thickFrame: true,/s, 'native frameless resize border missing');
  assertMatch(mainSrc, /const windowConfig = miniMode \?[\s\S]*resizable: true[\s\S]*resizable: true/s, 'main window must remain resizable in both modes');
  assertMatch(mainSrc, /ipcMain\.on\('toggle-maximize-window',[\s\S]*mainWindow\.isMaximized\(\)[\s\S]*mainWindow\.unmaximize\(\)[\s\S]*mainWindow\.maximize\(\)/s, 'maximize/restore IPC missing');
  assert(windowHtml.includes('id="btn-maximize"'), 'maximize/restore button missing');
  assertMatch(windowRenderer, /btnMaximize\?\.addEventListener\('click', \(\) => api\.toggleMaximizeWindow\(\)\)/, 'maximize/restore button not wired');
  assertMatch(windowCss, /\.window-controls\s*\{[\s\S]*-webkit-app-region:\s*drag;/s, 'title area must remain draggable');
});

check('window state: normal bounds persist safely across launches and mini mode', () => {
  const settingsSrc = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  assertMatch(settingsSrc, /window:\s*\{\s*bounds: null,\s*maximized: false\s*\}/, 'window-state defaults missing');
  assertMatch(mainSrc, /bounds: windowGeometry\.clampNormalBounds\(saved\.bounds, screen\)/, 'startup must use shared display clamping');
  assertMatch(windowGeometrySrc, /screenApi\.getDisplayMatching\(candidate\)\.workArea[\s\S]*Math\.min\(Math\.max\(candidate\.x[\s\S]*Math\.min\(Math\.max\(candidate\.y/s, 'restored bounds must be clamped to a visible display');
  assertMatch(mainSrc, /mainWindow\.on\('move', scheduleWindowStateSave\);[\s\S]*mainWindow\.on\('resize', scheduleWindowStateSave\);/s, 'move/resize persistence wiring missing');
  assertMatch(mainSrc, /if \(!maximized\) patch\.bounds = mainWindow\.getBounds\(\);[\s\S]*settingsStore\.updateSection\('window', patch\);/s, 'normal bounds persistence missing');
  assertMatch(windowGeometrySrc, /win\.normalModeBounds = win\.isMaximized\(\) \? win\.getNormalBounds\(\) : win\.getBounds\(\);[\s\S]*applyNormalBounds\(win, win\.normalModeBounds, screenApi\)/s, 'mini mode must preserve and safely restore normal window bounds');
  assertMatch(mainSrc, /if \(mainWindow\.restoredBounds\) return;/, 'initial auto-fit must not overwrite restored height');
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

check('ipc: shared Start architecture and timer/login handlers remain exposed', () => {
  const rendererStartSrc = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const startHtmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const startHandler = mainSrc.match(/ipcMain\.handle\('start-timer', async \(event, options, legacyAction\) => \{([\s\S]*?)\n\}\);/);
  assert(startHandler, 'start-timer IPC handler missing');
  const startDispatches = startHandler[1].match(/(?:await\s+)?startTimer\(options, legacyAction\)/g) || [];
  assert(startDispatches.length === 1, `start-timer IPC must dispatch exactly once, found ${startDispatches.length}`);

  const visibleHeroStarts = startHtmlSrc.match(/id="ns-play-btn"/g) || [];
  assert(visibleHeroStarts.length === 1, `expected one semantic hero Start control, found ${visibleHeroStarts.length}`);
  assert(!/id="btn-start"/.test(startHtmlSrc), 'hidden or competing #btn-start control must not return');
  assertMatch(rendererStartSrc, /function startTonightPlan\(\)\s*\{\s*return startTimer\(inputSeconds\(\), 'play'\);\s*\}/, 'shared startTonightPlan command missing');
  const explicitPlayPayloads = rendererStartSrc.match(/startTimer\(inputSeconds\(\), 'play'\)/g) || [];
  assert(explicitPlayPayloads.length === 1, `expected one authoritative play payload, found ${explicitPlayPayloads.length}`);
  const sharedStartReferences = rendererStartSrc.match(/startTonightPlan\(\)/g) || [];
  assert(sharedStartReferences.length === 4, `hero, keyboard, and replay must share startTonightPlan; found ${sharedStartReferences.length - 1} callers`);
  assertMatch(rendererStartSrc, /getElementById\('ns-play-btn'\)\?\.addEventListener\('click', \(\) => startTonightPlan\(\)\)/, 'hero CTA bypasses shared Start command');
  assertMatch(rendererStartSrc, /event\.code === 'Space'[\s\S]*else startTonightPlan\(\);/s, 'Space shortcut bypasses shared Start command');
  assertMatch(rendererStartSrc, /getElementById\('btn-proof-again'\)[\s\S]*startTonightPlan\(\);/s, 'proof replay bypasses shared Start command');
  assert(!/getElementById\('ns-play-btn'\)[\s\S]{0,160}startTimer\(/.test(rendererStartSrc), 'hero CTA carries a competing start payload');

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
  assertMatch(mainSrc, /if \(settings\.wifiGuard\) settingsStore\.updateSection\('wifiGuard', capabilityTruth\.sanitizeWifiGuard\(settings\.wifiGuard\)\);/, 'wifiGuard truth-gated save missing');
  assertMatch(mainSrc, /if \(settings\.contentBlocker\) settingsStore\.updateSection\('contentBlocker', capabilityTruth\.sanitizeContentBlocker\(settings\.contentBlocker\)\);/, 'contentBlocker truth-gated save missing');
  assertMatch(mainSrc, /if \(settings\.accountability\) settingsStore\.updateSection\('accountability', capabilityTruth\.sanitizeAccountability\(settings\.accountability\)\);/, 'accountability truth-gated save missing');
});

check('backup: export/import all-data uses the live profile API and restores streaks', () => {
  assertMatch(mainSrc, /streaks: streaks\.exportData\(\),/, 'streak export missing');
  assertMatch(mainSrc, /profiles: profiles\.getAll\(\)/, 'profile export should use public getAll API');
  assertMatch(mainSrc, /const importedProfiles = profiles\.import\(JSON\.stringify\(parsed\.profiles\)\);/, 'profile import should replace from exported array');
  assertMatch(mainSrc, /if \(parsed\.streaks && typeof parsed\.streaks === 'object'\) streaks\.replaceAll\(parsed\.streaks\);/, 'streak import missing');
});

check('mini-mode: toggling keeps the auto-fit guard in sync', () => {
  assertMatch(mainSrc, /ipcMain\.on\('toggle-mini-mode', \(\) => \{[\s\S]*miniMode = enteringMiniMode;[\s\S]*mainWindow\.miniMode = miniMode;/s, 'mainWindow.miniMode sync missing');
  assertMatch(mainSrc, /ipcMain\.on\('fit-window-height', \(event, contentHeight\) => \{[\s\S]*mainWindow\.miniMode\) return;/s, 'fit-window-height mini-mode guard missing');
});

check('widget: updates on lifecycle changes, not just timer ticks', () => {
  assertMatch(mainSrc, /function emitTimerUpdate\(type, data = \{\}\) \{[\s\S]*updateWidget\(\);[\s\S]*updateTrayText\(\);/s, 'widget not refreshed during state broadcasts');
  assertMatch(mainSrc, /if \(widgetWindow && !widgetWindow\.isDestroyed\(\)\) \{[\s\S]*widgetWindow\.show\(\);[\s\S]*updateWidget\(\);/s, 'widget reopen refresh missing');
  assertMatch(mainSrc, /await widgetWindow\.loadFile\('widget\.html'\);[\s\S]*updateWidget\(\);[\s\S]*widgetWindow\.show\(\);/s, 'widget must confirm load before showing and reporting success');
  assertMatch(mainSrc, /persistWidgetVisibility\(true\)/, 'confirmed widget visibility must be persisted');
  assertMatch(mainSrc, /getSection\('app'\)\?\.widgetVisible[\s\S]*await createWidgetWindow\(\)/s, 'persisted widget visibility must restore on startup');
  assertMatch(mainSrc, /if \(!app\.isQuitting\) persistWidgetVisibility\(false\)/, 'explicit widget close must persist hidden without overwriting state during app quit');
});

// 7. Core UI controls exist (start/pause/resume/snooze/cancel/mini + customize).
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['ns-play-btn', 'btn-stop', 'btn-pause', 'btn-snooze', 'btn-mini', 'btn-warning-ledger', 'btn-notif', 'btn-widget', 'btn-companion', 'cz-accent', 'cz-theme', 'cz-ring', 'cz-opacity', 'cz-volume', 'cz-clock-format', 'cz-clock-scale', 'cz-clock-dial', 'cz-clock-date', 'chk-lastlight', 'sel-lastlight-sequence', 'warning-modal', 'last-light-overlay', 'morning-proof-section', 'proof-card', 'receipts-modal']) {
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

check('layout: Settings is a real in-flow dashboard view, not a modal overlaying Tonight', () => {
  const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rendererJsSrc = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  // Settings must be a sibling of #ns-panel-lib/modes/sch/stats -- shown and
  // hidden by applyMainPanelVisibility() like the others -- not a
  // classList.add('active') modal with a backdrop.
  assertMatch(htmlSrc, /<div class="ns-main-panel" id="ns-panel-set" style="display:none">/, 'Settings must be an ns-main-panel, not a .modal overlay');
  assert(!/<div class="modal" id="ns-panel-set">/.test(htmlSrc), 'Settings must not use the .modal overlay class');
  assertMatch(rendererJsSrc, /if \(els\.panelSet\) els\.panelSet\.style\.display = panel === 'set' \? '' : 'none';/, 'applyMainPanelVisibility must treat Settings as a real panel');
  assertMatch(rendererJsSrc, /function openSettingsPanel\(\)\s*\{[\s\S]*applyMainPanelVisibility\('set'\);/, 'openSettingsPanel must show the panel via applyMainPanelVisibility, not toggle a modal class');
  assertMatch(rendererJsSrc, /function closeSettingsPanel\(\)\s*\{[\s\S]*applyMainPanelVisibility\(returnTab\);/, 'closeSettingsPanel must restore the previous panel via applyMainPanelVisibility');
  assert(!/els\.panelSet\?\.classList\.add\('active'\)/.test(rendererJsSrc), 'no code path may still toggle a modal .active class for Settings');
  assert(!/els\.panelSet\.addEventListener\('click', event => \{\s*if \(event\.target === els\.panelSet\)/.test(rendererJsSrc), 'Settings must not have backdrop-click-to-close (it is not an overlay)');
  assertMatch(cssSrc, /#ns-panel-set\.ns-main-panel\s*\{[\s\S]*height:\s*100%;[\s\S]*display:\s*flex;/, 'Settings panel must size itself as an in-flow view, not a centered dialog');
  assertMatch(cssSrc, /\.settings-panel\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*1100px;/, 'Settings content must fill the dashboard width up to a desktop cap, not a narrow modal column');
  assertMatch(cssSrc, /\.settings-panel \.modal-body\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*0;[\s\S]*max-height:\s*none;/, 'Settings body is not independently scrollable');
  // Category rail + stable content panel, so changing one setting never
  // requires scrolling through every other domain (lights, companion,
  // wifi guard, accountability, ...) to find it.
  assertMatch(htmlSrc, /<nav class="settings-rail"/, 'Settings needs a category rail, not one long scrolling list');
  const categories = ['general', 'power-safety', 'wind-down', 'phone', 'protection', 'accountability', 'automations', 'appearance', 'advanced'];
  for (const cat of categories) {
    assertMatch(htmlSrc, new RegExp(`data-settings-category="${cat}"`), `settings category "${cat}" missing from rail or content`);
  }
  assertMatch(rendererJsSrc, /function switchSettingsCategory\(categoryId\)/, 'settings category switching must be wired in JS');
  assertMatch(cssSrc, /\.settings-rail\s*\{[\s\S]*flex:\s*0 0 200px;/, 'settings rail must be a fixed-width column, not squeezed into the content flow');
});

check('layout: Settings migrates persisted nsActiveTab "set"/"help" to Tonight on launch', () => {
  const rendererSettingsSrc = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  assertMatch(rendererSettingsSrc, /app\.nsActiveTab === 'set' \|\| app\.nsActiveTab === 'help'/, 'a persisted nsActiveTab of "set" or "help" must never be restored on launch');
});

check('ui: icon-only navigation and footer buttons have accessible labels', () => {
  assertMatch(htmlSrc, /data-ns-tab="lib"[^>]*aria-label="Open tonight"/, 'TONIGHT aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="sch"[^>]*aria-label="Open schedule"/, 'SCH aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="dev"[^>]*aria-label="Open devices"/, 'DEVICES aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="set"[^>]*aria-label="Open settings"/, 'SET aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="help"[^>]*aria-label="Open help and about"/, 'Help aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="stats"[^>]*aria-label="Open proof"/, 'PROOF aria-label missing');
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
  assertMatch(preloadSrc, /desktopUxProof:\s*\{[\s\S]*enabled: true,[\s\S]*version: 1,[\s\S]*getStartInvocations:/s, 'proof-only preload bridge missing');
});

// The renderer is split across sibling <script> files sharing one global
// scope (no bundler). Keep this list in the same order as their <script src>
// tags in index.html, and add new renderer-*.js shards here as they're split
// out, so these content assertions keep matching regardless of which shard
// the checked code physically lives in.
const RENDERER_FILES = ['renderer-utils.js', 'renderer-profiles.js', 'renderer-calendar.js', 'renderer-receipts.js', 'renderer-family-remote.js', 'renderer-ritual-focus.js', 'renderer-settings.js', 'renderer-lastlight-alarm.js', 'renderer-onboarding-updater.js', 'renderer.js'];
const rendererSrc = RENDERER_FILES.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
check('renderer: running-state controls still swap stop-pause visibility and label', () => {
  // Start is no longer a separate setup-controls button toggled here -- the
  // hero CTA (#ns-play-btn) is shown/hidden by the isIdle ns-hero-card
  // visibility logic instead (see the "focused active-run screen" check).
  assertMatch(rendererSrc, /els\.btnStop\.style\.display = state\.running \|\| state\.paused \? 'flex' : 'none';/, 'renderer stop visibility changed');
  assertMatch(rendererSrc, /els\.btnPause\.style\.display = state\.running \|\| state\.paused \? 'flex' : 'none';/, 'renderer pause visibility changed');
  assertMatch(rendererSrc, /els\.btnPause\.querySelector\('span:last-child'\)\.textContent = state\.paused \? 'Resume' : 'Pause';/, 'renderer pause/resume label changed');
  assertMatch(rendererSrc, /state\.dryRun \? `Dry Run · \$\{phaseLabel\}` : phaseLabel/, 'active Dry Run status must remain prominent');
  assertMatch(rendererSrc, /state\.dryRun \? 'Dry Run · Paused' : 'Paused'/, 'paused Dry Run status must remain prominent');
});

check('renderer: keyboard shortcuts - Space (Start/Pause)', () => {
  assertMatch(rendererSrc, /if \(event\.key === ' ' \|\| event\.code === 'Space'\) \{[\s\S]*if \(state\.running \|\| state\.paused\) togglePause\(\);[\s\S]*else startTonightPlan\(\);/s, 'space shortcut changed');
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

// Settings panel consolidation regression checks.
check('settings: saveSettingsPanel is defined exactly once and Save calls it', () => {
  const matches = [...rendererSrc.matchAll(/function saveSettingsPanel\(\)/g)];
  assert(matches.length === 1, `expected one saveSettingsPanel definition, found ${matches.length}`);
  assertMatch(rendererSrc, /els\.btnSaveOpt\.addEventListener\('click', async \(\) => \{\s*await saveSettingsPanel\(\);\s*closeSettingsPanel\(\);\s*\}\)/, 'Save button must call saveSettingsPanel once and then close');
  const saveListeners = [...rendererSrc.matchAll(/els\.btnSaveOpt\.addEventListener/g)];
  assert(saveListeners.length === 1, `expected one Save listener, found ${saveListeners.length}`);
});

check('settings: Cancel reloads persisted values before closing', () => {
  assertMatch(rendererSrc, /async function discardSettingsPanelChanges\(\)/, 'discardSettingsPanelChanges must be defined');
  assertMatch(rendererSrc, /els\.btnCancelOpt\.addEventListener\('click', async \(\) => \{\s*await discardSettingsPanelChanges\(\);\s*closeSettingsPanel\(\);\s*\}\)/, 'Cancel must discard changes before closing');
});

check('settings: Back to Tonight discards edits and does not save', () => {
  assertMatch(rendererSrc, /els\.modalClose\.addEventListener\('click', async \(\) => \{\s*await discardSettingsPanelChanges\(\);\s*closeSettingsPanel\(\);\s*\}\)/, 'Back (modalClose) must discard changes, not call saveSettingsPanel');
  assert(!/els\.modalClose\.addEventListener\('click', async \(\) => \{[^}]*saveSettingsPanel/.test(rendererSrc), 'Back button listener body must not invoke saveSettingsPanel');
});

check('settings: Settings panel listeners are attached exactly once', () => {
  const modalCloseListeners = [...rendererSrc.matchAll(/els\.modalClose\.addEventListener/g)];
  const cancelListeners = [...rendererSrc.matchAll(/els\.btnCancelOpt\.addEventListener/g)];
  const saveListeners = [...rendererSrc.matchAll(/els\.btnSaveOpt\.addEventListener/g)];
  assert(modalCloseListeners.length === 1, `expected one modalClose listener, found ${modalCloseListeners.length}`);
  assert(cancelListeners.length === 1, `expected one Cancel listener, found ${cancelListeners.length}`);
  assert(saveListeners.length === 1, `expected one Save listener, found ${saveListeners.length}`);
});

check('settings: persisted nsActiveTab "set" migrates to Tonight on launch', () => {
  assertMatch(rendererSrc, /app\.nsActiveTab === 'set' \|\| app\.nsActiveTab === 'help'/, 'a persisted nsActiveTab of "set" or "help" must be detected');
  assertMatch(rendererSrc, /await api\.saveAppSettings\(\{\s*app:\s*\{\s*nsActiveTab:\s*'lib'\s*\}\s*\}\)\.catch\(/, 'migration to Tonight must complete before renderer readiness');
  assertMatch(rendererSrc, /window\.__desktopUxProof = \{[\s\S]*ready: false,[\s\S]*version:/s, 'renderer proof readiness object must exist before initialization');
  assertMatch(rendererSrc, /await loadInitialData\(\)[\s\S]*render\(\);[\s\S]*markDesktopUxProofReady\(\);/s, 'proof readiness must follow state restoration and first render');
});

check('settings: legacy options-modal/optionsModal references are fully removed', () => {
  assert(!rendererSrc.includes('options-modal'), 'renderer must not contain "options-modal" references');
  assert(!rendererSrc.includes('optionsModal'), 'renderer must not contain "optionsModal" references');
  assert(!/class="modal" id="ns-panel-set"/.test(htmlSrc), 'Settings must not use legacy .modal overlay markup');
});

check('settings: exactly one Settings panel binding exists', () => {
  const panelSetBindings = [...rendererSrc.matchAll(/panelSet\s*[:=]\s*document\.getElementById\('ns-panel-set'\)/g)];
  assert(panelSetBindings.length === 1, `expected one panelSet binding, found ${panelSetBindings.length}`);
  const htmlMatches = [...htmlSrc.matchAll(/id="ns-panel-set"/g)];
  assert(htmlMatches.length === 1, `expected one #ns-panel-set element, found ${htmlMatches.length}`);
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
  assertMatch(rendererSrc, /getSmartLightConfig: async \(\) => \(\{ enabled: false, provider: 'none'/, 'fallback must supply the smart-light getter used by loadInitialData');
  assertMatch(rendererSrc, /getNightModesCatalogue: async \(\) => previewNightModes\.map/, 'fallback must supply Night Modes catalogue data for layout testing');
  assertMatch(rendererSrc, /useNightModeTonight: async id =>/, 'fallback must support arming an available Night Mode');
});

check('renderer: visible sidebar navigation routes to a real tab or modal', () => {
  assertMatch(rendererSrc, /function handleSidebarNavigation\(tab, \{ persist = true \} = \{\}\) \{/, 'sidebar navigation router missing');
  assertMatch(rendererSrc, /if \(tab === 'lib'\) \{[\s\S]*applyMainPanelVisibility\('lib'\);[\s\S]*handled = true;/s, 'LIB routing missing');
  assertMatch(rendererSrc, /if \(tab === 'sch'\) \{[\s\S]*applyMainPanelVisibility\('sch'\);[\s\S]*handled = true;/s, 'SCH routing missing');
  assertMatch(rendererSrc, /if \(tab === 'set'\) \{[\s\S]*openSettingsPanel\(\);[\s\S]*handled = true;/s, 'SET routing missing');
  assertMatch(rendererSrc, /if \(tab === 'help'\) \{[\s\S]*openHelpPanel\(\);[\s\S]*handled = true;/s, 'Help routing missing');
  assertMatch(rendererSrc, /if \(tab === 'dev'\) \{[\s\S]*applyMainPanelVisibility\('dev'\);[\s\S]*renderDevicesPanel\(\);[\s\S]*handled = true;/s, 'DEVICES routing missing');
  assertMatch(rendererSrc, /if \(tab === 'stats'\) \{[\s\S]*applyMainPanelVisibility\('stats'\);[\s\S]*renderStatusPanel\(\);[\s\S]*handled = true;/s, 'PROOF routing missing');
  assertMatch(rendererSrc, /document\.querySelectorAll\('\.ns-nav-item'\)\.forEach\(btn => \{[\s\S]*handleSidebarNavigation\(btn\.dataset\.nsTab\);/s, 'sidebar click handler missing');
});

check('renderer: LIB/SCH/DEV/STATS panels are mutually exclusive, single-visible destinations', () => {
  assertMatch(rendererSrc, /function applyMainPanelVisibility\(panel\) \{/, 'panel visibility switcher missing');
  assertMatch(rendererSrc, /els\.panelLib\.style\.display = panel === 'lib' \? '' : 'none';/, 'LIB panel toggle missing');
  assertMatch(rendererSrc, /els\.panelSch\.style\.display = panel === 'sch' \? '' : 'none';/, 'SCH panel toggle missing');
  assertMatch(rendererSrc, /els\.panelDev\.style\.display = panel === 'dev' \? '' : 'none';/, 'DEVICES panel toggle missing');
  assertMatch(rendererSrc, /els\.panelStats\.style\.display = panel === 'stats' \? '' : 'none';/, 'PROOF panel toggle missing');
  assertMatch(htmlSrc, /id="ns-panel-lib"/, 'LIB panel container missing from HTML');
  assertMatch(htmlSrc, /id="ns-panel-sch"[^>]*style="display:none"/, 'SCH panel should start hidden in HTML');
  assertMatch(htmlSrc, /id="ns-panel-dev"[^>]*style="display:none"/, 'DEVICES panel should start hidden in HTML');
  assertMatch(htmlSrc, /id="ns-panel-stats"[^>]*style="display:none"/, 'PROOF panel should start hidden in HTML');
});

check('renderer: PROOF panel shows only real session/receipt history, honest empty state', () => {
  assertMatch(rendererSrc, /async function renderStatusPanel\(\) \{/, 'status panel renderer missing');
  assertMatch(rendererSrc, /api\.listReceipts\?\.\(5\)/, 'PROOF should read real receipt history, not fabricate it');
  assertMatch(rendererSrc, /No session history yet\./, 'PROOF must show an honest empty state when there is no history');
  // Companion/phone status belongs to the Devices panel, not Proof.
  assert(!rendererSrc.includes('statsCompanionMode'), 'Proof panel should not retain statsCompanionMode binding');
  assert(!rendererSrc.includes('statsCompanionStatus'), 'Proof panel should not retain statsCompanionStatus binding');
});

check('renderer: DEVICES panel shows real device data without inventing state', () => {
  assertMatch(rendererSrc, /async function renderDevicesPanel\(\) \{/, 'devices panel renderer missing');
  assertMatch(rendererSrc, /api\.getRemoteControl\?\.\(\)/, 'DEVICES should read real companion status, not fabricate it');
  assertMatch(rendererSrc, /api\.getFamilyPeers\?\.\(\)/, 'DEVICES should read real family peers, not fabricate them');
  assertMatch(rendererSrc, /api\.getSmartLightConfig\?\.\(\)/, 'DEVICES should read real smart-light config');
  assertMatch(rendererSrc, /api\.getWifiGuardSettings\?\.\(\)/, 'DEVICES should read real WiFi Guard config');
  assertMatch(rendererSrc, /updateCompanionStatus\(/, 'DEVICES should have a shared companion status updater');
  assertMatch(rendererSrc, /function renderFamilyPeers\(/, 'DEVICES should use one shared peer-list renderer');
});

check('renderer: DEVICES panel routes to existing Settings categories', () => {
  assertMatch(rendererSrc, /function openDeviceSettings\(category\)/, 'openDeviceSettings helper missing');
  assertMatch(rendererSrc, /els\.btnDevCompanion\?\.addEventListener\('click', \(\) => openDeviceSettings\('phone'\)\)/, 'Phone Companion button must route to the phone category');
  assertMatch(rendererSrc, /els\.btnDevLights\?\.addEventListener\('click', \(\) => openDeviceSettings\('wind-down'\)\)/, 'Smart Lights button must route to the wind-down category');
  assertMatch(rendererSrc, /els\.btnDevWifi\?\.addEventListener\('click', \(\) => openDeviceSettings\('protection'\)\)/, 'Wi-Fi Guard button must route to the protection category');
});

check('renderer: DEVICES panel live-updates volatile PC status only', () => {
  assertMatch(rendererSrc, /function updateDevicesPcStatus\(\)/, 'updateDevicesPcStatus helper missing');
  assertMatch(rendererSrc, /if \(els\.panelDev && els\.panelDev\.style\.display !== 'none'\) \{\s*updateDevicesPcStatus\(\);\s*\}/, 'render() must update Devices PC status only while visible');
});

check('renderer: DEVICES PC status uses canonical idle/focus/dim/lastlight phases', () => {
  // The main status text already maps phases to these labels; the Devices
  // dashboard must derive PC status from the same canonical state.phase values.
  assertMatch(rendererSrc, /const labels = \{ focus: 'Focus', dim: 'Winding Down', lastlight: 'Last Light', idle: 'Running' \};/, 'main status phase labels missing');
  assertMatch(rendererSrc, /const phaseLabels = \{ focus: 'Focus', dim: 'Winding Down', lastlight: 'Last Light', idle: 'Running' \};/, 'Devices phase labels must match main status text');
  assertMatch(rendererSrc, /isIdle \? 'Idle'[\s\S]*state\.paused \? 'Paused'[\s\S]*\(phaseLabels\[state\.phase\] \|\| 'Running'\)/, 'Devices PC status derivation missing');
});

check('renderer: footer and ledger controls provide real feedback', () => {
  assertMatch(rendererSrc, /els\.btnWidget\?\.addEventListener\('click', async \(\) => \{[\s\S]*const result = await api\.toggleWidget\?\.\(\);[\s\S]*Desktop widget shown[\s\S]*Desktop widget hidden/s, 'widget feedback must follow an acknowledged main-process state');
  assert(!rendererSrc.includes('Desktop widget toggled'), 'fire-and-forget widget success copy must not return');
  assertMatch(rendererSrc, /els\.btnCompanion\?\.addEventListener\('click', async \(\) => \{[\s\S]*if \(rc\?\.ready && rc\.url\)[\s\S]*Companion pairing page opened[\s\S]*openSettingsPanel\(\)/s, 'companion button must require verified readiness and avoid exposing the tokenized URL in feedback');
  assertMatch(rendererSrc, /const btnNotif = document\.getElementById\('btn-notif'\);[\s\S]*notifDrawer\.classList\.toggle\('active', opening\)/s, 'notifications button must activate the modal, not only clear an inline display value');
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

check('companion: pairing UI layout classes exist in HTML and CSS', () => {
  const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assertMatch(htmlSrc, /class="pairing-qr-wrap"/, 'pairing-qr-wrap class missing in index.html');
  assertMatch(htmlSrc, /class="pairing-code"/, 'pairing-code class missing in index.html');
  assertMatch(htmlSrc, /class="pairing-code-short"/, 'pairing-code-short class missing in index.html');
  assertMatch(cssSrc, /\.pairing-qr-card/, 'pairing-qr-card styles missing in styles.css');
  assertMatch(cssSrc, /\.pairing-code-short/, 'pairing-code-short styles missing in styles.css');
});

check('companion: PWA pairing card and stats sections use classes', () => {
  const companionSrc = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  assertMatch(companionSrc, /class="pair-card"/, 'pair-card class missing in companion.html');
  assertMatch(companionSrc, /class="pair-icon"/, 'pair-icon class missing in companion.html');
  assertMatch(companionSrc, /class="comp-stats"/, 'comp-stats class missing in companion.html');
  assertMatch(companionSrc, /class="comp-metrics"/, 'comp-metrics class missing in companion.html');
});

check('companion C2: Night Mode picker and detail overlay exist in PWA', () => {
  const companionSrc = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  assertMatch(companionSrc, /id="night-mode-section"/, 'night-mode-section missing in companion.html');
  assertMatch(companionSrc, /id="night-mode-grid"/, 'night-mode-grid missing in companion.html');
  assertMatch(companionSrc, /id="night-mode-backdrop"/, 'night-mode-backdrop missing in companion.html');
  assertMatch(companionSrc, /id="nm-detail-start"/, 'nm-detail-start missing in companion.html');
  assertMatch(companionSrc, /id="nm-detail-close"/, 'nm-detail-close missing in companion.html');
  assertMatch(companionSrc, /id="nm-detail-run-type"/, 'nm-detail-run-type missing in companion.html');
});

check('companion C2: main handles startNightMode and getNightModes', () => {
  assertMatch(mainSrc, /case 'startNightMode':/, 'handleCompanionMessage missing startNightMode case');
  assertMatch(mainSrc, /case 'getNightModes':/, 'handleCompanionMessage missing getNightModes case');
  assertMatch(mainSrc, /companion\.sendToClient\(client, \{ type: 'nightModes', modes: nmCatalogue \}\)/, 'getNightModes does not send catalogue via sendToClient');
});

check('companion C2: protocol validates startNightMode and getNightModes', () => {
  const remoteControlSrc = fs.readFileSync(path.join(root, 'remoteControl.js'), 'utf8');
  assertMatch(remoteControlSrc, /['"]startNightMode['"]/, 'startNightMode missing from COMPANION_ACTIONS');
  assertMatch(remoteControlSrc, /['"]getNightModes['"]/, 'getNightModes missing from COMPANION_ACTIONS');
  assertMatch(remoteControlSrc, /if \(typeof nightModeId !== 'string' \|\| nightModeId\.length === 0\)/, 'startNightMode does not validate nightModeId');
});

check('companion: mode buttons have explanatory tooltips, and a live description reflects the selected mode', () => {
  // "This PC only" reads like it enables remote control from your phone --
  // it actually means the opposite (loopback-only). Tooltips + a dynamic
  // description line are the fix; regression-guard both.
  assertMatch(htmlSrc, /id="btn-mode-local"[^>]*title="[^"]*not reachable from your phone/, 'This PC only button needs a tooltip clarifying it is loopback-only, not phone-reachable');
  assertMatch(htmlSrc, /id="btn-mode-wifi"[^>]*title="[^"]*Attempts to start/, 'Connect Phone tooltip must describe an attempted, verified start rather than claim reachability');
  assert(htmlSrc.includes('id="remote-mode-description"'), 'remote-mode-description element missing from HTML');
  assertMatch(rendererSrc, /REMOTE_MODE_DESCRIPTIONS = \{[\s\S]*?off:[\s\S]*?local:[\s\S]*?wifi:/, 'REMOTE_MODE_DESCRIPTIONS map missing an off/local/wifi entry');
  assertMatch(rendererSrc, /els\.remoteModeDescription\.textContent = rc\.failed[\s\S]*companionFailureMessage\(rc\)[\s\S]*rc\.ready/, 'renderRemoteControl must derive its description from failed/ready truth');
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
  assertMatch(rendererSrc, /updateRemoteQr\(rc\.ready && mode === 'wifi' \? rc\.url : ''\)/, 'QR should require verified readiness and wifi mode');
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

check('companion: status pill class updates by readiness and connection state', () => {
  assertMatch(rendererSrc, /const statusClass = rc\.failed \? 'status-failed' : rc\.connected \? 'status-connected' : rc\.ready \? `status-\${mode}` : 'status-starting'/, 'status pill class must distinguish failed, connected, ready, and starting');
});

check('companion: Off hides QR and manual LAN URL', () => {
  assertMatch(rendererSrc, /if \(els\.remoteControlConfig\) els\.remoteControlConfig\.style\.display = mode === 'off' \? 'none' : '';/, 'Off mode should hide the remote control config');
  assertMatch(rendererSrc, /updateRemoteQr\(rc\.ready && mode === 'wifi' \? rc\.url : ''\)/, 'QR should require readiness and wifi mode');
});

check('companion: phone page has explicit connection states', () => {
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  assert(companionHtml.includes('Connecting…'), 'companion page missing Connecting state');
  assert(companionHtml.includes("setConnectionState('connected', 'Connected — waiting for current PC state…')"), 'companion page missing pre-authoritative Connected state');
  assert(companionHtml.includes("statusText.textContent = 'Connected'"), 'companion page missing authoritative Connected state');
  assert(companionHtml.includes('Reconnecting'), 'companion page missing Reconnecting state');
  assert(companionHtml.includes('Pairing expired'), 'companion page missing Pairing expired state');
  assert(companionHtml.includes('PC unavailable'), 'companion page missing unavailable state');
  assert(companionHtml.includes('State may be stale'), 'companion page missing stale-state warning');
});

check('companion: reconnects cannot let stale sockets replace a healthy connection', () => {
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  assert(companionHtml.includes('if (ws !== socket || generation !== socketGeneration) return;'), 'stale WebSocket callbacks must be ignored by socket identity and generation');
  assertMatch(companionHtml, /socket\.onopen = \(\) => \{\s*if \(ws !== socket \|\| generation !== socketGeneration\) return;\s*if \(reconnectTimer\) clearTimeout\(reconnectTimer\);\s*reconnectTimer = null;/, 'a successful current-generation connection must cancel its pending reconnect timer');
  assert(companionHtml.includes('authoritativeGeneration === socketGeneration'), 'mutation availability must require current-generation authoritative state');
  assert(companionHtml.includes('awaitingInitialState'), 'reconnect must wait for current PC state');
  assert(companionHtml.includes('reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 3000);'), 'reconnect timer state must clear before a new connection attempt');
  assert(companionHtml.includes("fetch(`/pair-check?t=${encodeURIComponent(pairToken)}`"), 'companion should preflight pairing so an expired token is not reported as an offline PC');
  assert(companionHtml.includes("setConnectionState('connecting', reconnecting ? 'Reconnecting' : 'Connecting…');"), 'background retries must expose their reconnecting state');
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
  assertMatch(rendererSrc, /if \(els\.morningProofSection\) els\.morningProofSection\.style\.display = 'none';\s*\n\s*startTonightPlan\(\);/, 'Play Tonight Again should delegate to the shared start function, not a separate button');
});

check('ux: focused active-run screen hides idle-only lobby clutter while a run is active', () => {
  // Saved Profiles, the streak callout, and last night's completed-run proof
  // card must never sit alongside a countdown that's currently in progress.
  assertMatch(htmlSrc, /<section class="profiles-section" id="profiles-section">/, 'profiles-section needs an id to be gated by render()');
  assertMatch(rendererSrc, /const profilesSection = document\.getElementById\('profiles-section'\);\s*\n\s*if \(profilesSection\) profilesSection\.style\.display = isIdle \? '' : 'none';/, 'render() must hide Saved Profiles while a run is active');
  assertMatch(rendererSrc, /if \(els\.streakCallout && !isIdle\) els\.streakCallout\.style\.display = 'none';/, 'render() must hide the streak callout while a run is active');
  assertMatch(rendererSrc, /if \(els\.morningProofSection && !isIdle\) els\.morningProofSection\.style\.display = 'none';/, 'render() must hide the last-run proof card while a run is active');
});

check('companion: default settings are off with no token', () => {
  const settingsSrc = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  assertMatch(settingsSrc, /remoteControl:\s*\{[\s\S]*enabled:\s*false,[\s\S]*token:\s*''\s*\}/, 'remoteControl defaults should be off with empty token');
});

check('companion: main mode contract maps to correct host binding', () => {
  assertMatch(mainSrc, /if \(mode === 'wifi'\) \{[\s\S]*await companion\.start\(\{ token: rc\.token, host: '0\.0\.0\.0', port, probeHost: lanIp \}\)/s, 'wifi mode should bind 0.0.0.0 and probe the selected LAN address');
  assertMatch(mainSrc, /\} else if \(mode === 'local'\) \{[\s\S]*await companion\.start\(\{ token: rc\.token, host: '127\.0\.0\.1', port \}\)/s, 'local mode should bind 127.0.0.1');
  assertMatch(mainSrc, /if \(mode === 'off' \|\| !rc\.token\) return getRemoteControlState\(\);/, 'off mode should not start listener');
});

check('production truth: companion publishes pairing data only after readiness', () => {
  assertMatch(mainSrc, /if \(ready && mode === 'wifi' && rc\.token\)/, 'wifi URL must be gated by verified readiness');
  assertMatch(mainSrc, /if \(!state\.ready \|\| typeof text !== 'string' \|\| !text \|\| text !== state\.url\) return '';/, 'QR generation must reject stale or unverified URLs');
  assertMatch(mainSrc, /const ready = Boolean\(status\.ready && status\.running && !status\.failed && !companionNetworkFailure\);/, 'renderer state needs an explicit readiness field');
  assertMatch(mainSrc, /ipcMain\.handle\('set-remote-control-port'/, 'configurable-port recovery IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('retry-remote-control'/, 'companion retry IPC missing');
  assertMatch(mainSrc, /Get-NetTCPConnection -LocalPort \$\{safePort\}[\s\S]*Get-Process -Id \$connection\.OwningProcess/, 'occupied-port diagnostics must identify the listener owner when Windows allows it');
  assert(htmlSrc.includes('id="remote-startup-error"'), 'bind/readiness failure region missing');
  assert(htmlSrc.includes('id="remote-port"'), 'configurable companion port input missing');
  assertMatch(mainSrc, /await companionNetwork\.getRoutedLanIp\(\)/, 'same-wifi host selection must use the current routed source address');
  assertMatch(mainSrc, /startCompanionNetworkMonitor\(\)/, 'network changes must trigger stale-pairing recovery');
  assertMatch(rendererSrc, /generation !== remoteQrGeneration \|\| els\.remoteUrl\?\.textContent !== url/, 'stale async QR results must be discarded');
  assertMatch(mainSrc, /shortCode: ready && rc\.token/, 'short code must remain hidden before readiness');
  assert(!/\n\s*token: rc\.token \|\| ''/.test(mainSrc), 'raw token must not be returned as a separate renderer field');
});

check('production truth: UI feedback follows observable state', () => {
  assertMatch(preloadSrc, /toggleWidget: \(\) => ipcRenderer\.invoke\('toggle-widget'\)/, 'widget must use acknowledged IPC');
  assertMatch(rendererSrc, /duplicate = \[\.\.\.container\.querySelectorAll\('\.toast'\)\][\s\S]*duplicate\._dismissTimer/, 'duplicate toasts must be coalesced');
  // Power/Settings/Help are click-toggled dropdowns (wireTopMenus), not a
  // hover-only reveal and not a label that jumps straight to a modal --
  // clicking the label must open/close its own submenu.
  assertMatch(rendererSrc, /function wireTopMenus\(\)/, 'top menu bar needs click-toggle wiring, not hover-only dropdowns');
  assertMatch(rendererSrc, /if \(menu\.classList\.contains\('open'\)\) closeAllTopMenus\(\);/, 'top menu label click must toggle its own dropdown open/closed');
  assertMatch(rendererSrc, /if \(event\.defaultPrevented\) return;/, 'global shortcuts must not override handled top-menu keyboard navigation');
  const cssSrcForMenus = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assertMatch(cssSrcForMenus, /\.menu-item\.open \.submenu\s*\{/, 'submenu visibility must be driven by a click-toggled class, not :hover');
  assertMatch(rendererSrc, /notifDrawer\.classList\.toggle\('active', opening\)/, 'notification drawer must use the modal active state');
  assertMatch(mainSrc, /backgroundColor: '#0d0e11'/, 'main window needs a dark native background to prevent startup flash');
});

check('production truth: legacy labels and unsupported claims are removed', () => {
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  const focusRenderer = fs.readFileSync(path.join(root, 'renderer-ritual-focus.js'), 'utf8');
  for (const legacy of ['WITCHCRAFT', 'MONEY', 'HARD STOP', 'BEASTMODE']) {
    assert(!htmlSrc.includes(legacy), `legacy quick-start label still exposed: ${legacy}`);
  }
  assertMatch(htmlSrc, /Estimated Bedtime Deficit/, 'estimated bedtime metric must not claim measured sleep debt');
  assertMatch(htmlSrc, /Routine Consistency Score/, 'app-use score must not claim to be a sleep score');
  assert(!/Sleep Score|Sleep Rich|Critical Debt|Deep Debt/.test(`${companionHtml}\n${focusRenderer}`), 'companion/focus surfaces must not infer sleep quality from timer receipts');
  assert(!/100 - \(report\.snoozeRate \|\| 0\).*on-time/.test(rendererSrc), 'no-snooze percentage must not be relabeled as on-time');
  assertMatch(htmlSrc, /Windows Firewall[^<]*unavailable for other devices/, 'unsupported LAN-device firewall provider must be visibly unavailable');
  assertMatch(fs.readFileSync(path.join(root, 'wifiGuard.js'), 'utf8'), /Windows Firewall on this PC cannot enforce access for another LAN device/, 'unsupported firewall executor must fail honestly');
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
  const wifiUrlMatch = mainSrc.match(/url = `http:\/\/\$\{lanIp\}:\$\{port\}\/\?t=\$\{rc\.token\}&host=\$\{encodeURIComponent\(`\$\{lanIp\}:\$\{port\}`\)\}`;/);
  assert(wifiUrlMatch, 'wifi URL construction not found or malformed');
  const wifiUrl = wifiUrlMatch[0];
  assert(wifiUrl.includes('t=${rc.token}'), 'wifi URL missing token');
  assert(wifiUrl.includes('host='), 'wifi URL missing host parameter');
  assert(wifiUrl.includes('encodeURIComponent'), 'wifi URL must encode the host parameter');
  assert(wifiUrl.includes('${lanIp}:${port}'), 'wifi URL host must include the selected LAN IP and configured port');
});

check('companion: QR URL has no host in off or local mode', () => {
  // Off and local modes intentionally omit the LAN host parameter.
  const localUrlMatch = mainSrc.match(/url = `http:\/\/127\.0\.0\.1:\$\{port\}\/\?t=\$\{rc\.token\}`;/);
  assert(localUrlMatch, 'local URL construction not found');
  assert(!localUrlMatch[0].includes('host='), 'local URL should not include a host parameter');
});

check('companion: same-wifi status distinguishes desktop readiness from phone reachability', () => {
  assertMatch(mainSrc, /if \(mode === 'off'\) return 'Off';/, 'Off label missing');
  assertMatch(mainSrc, /if \(status\.failed \|\| companionNetworkFailure\) return 'Connection failed';/, 'failed label missing');
  assertMatch(mainSrc, /if \(!status\.ready \|\| !status\.running\) return 'Starting companion';/, 'starting label must cover unverified listeners');
  assertMatch(mainSrc, /if \(status\.connected \|\| status\.clients > 0\) return 'Phone connected';/, 'connected label missing');
  assertMatch(mainSrc, /if \(mode === 'local'\) return 'Ready on this PC only';/, 'verified local label missing');
  assertMatch(mainSrc, /return 'Desktop endpoint ready — waiting for phone';/, 'desktop-only readiness wording missing');
  assertMatch(rendererSrc, /Phone reachability is confirmed only after an authenticated phone connects/, 'renderer must not claim phone reachability from a desktop self-probe');
});

check('companion: firewall changes are narrowly owned and failure is honest', () => {
  const firewallSrc = fs.readFileSync(path.join(root, 'companionFirewall.js'), 'utf8');
  assertMatch(firewallSrc, /RULE_GROUP = 'Lights Out Companion'/, 'app-owned firewall group missing');
  assertMatch(firewallSrc, /-Profile Private/, 'firewall rules must be private-only');
  assertMatch(firewallSrc, /-Program \$\{program\}/, 'firewall rules must be scoped to the exact executable');
  assert(!/Public|Profile Any|-Program Any/i.test(firewallSrc), 'firewall helper contains a public or unscoped rule');
  assertMatch(mainSrc, /Lights Out did not request elevation/, 'denied firewall setup needs honest non-elevation guidance');
  assert(htmlSrc.includes('id="remote-firewall-warning"'), 'firewall verification warning missing');
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
    const r = rr.createRunReceipt({
      action: 'shutdown', totalSeconds: 1800, dryRun: true, forceShutdown: false,
      profileId: 'profile-alex', profileName: 'Alex'
    });
    assert(r.id, 'receipt needs id');
    assert(r.result === 'running', 'initial result should be running');
    assert(r.profileId === 'profile-alex' && r.profileName === 'Alex', 'profile identity not snapshotted');
    const updated = rr.updateRunReceipt(r.id, { result: 'dry_run_completed', endedAt: new Date().toISOString() });
    assert(updated.result === 'dry_run_completed', 'update failed');
  });

  check('receipts: legacy timer state remains compatible without profile identity', () => {
    const r = rr.createRunReceipt({ action: 'sleep', totalSeconds: 600 });
    assert(r.profileId === null && r.profileName === null, 'legacy receipt identity defaults changed');
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

check('receipts: profile label renders only when canonical identity exists', () => {
  const receiptRendererSrc = fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8');
  const fnMatch = receiptRendererSrc.match(/function getReceiptProfileLabel\(receipt\) \{[\s\S]*?\n\}/);
  assert(fnMatch, 'getReceiptProfileLabel function not found');
  const getLabel = Function(`return (${fnMatch[0]})`)();
  assert(getLabel({}) === '', 'legacy receipt should omit Profile label');
  assert(getLabel({ profileName: null }) === '', 'null identity should omit Profile label');
  assert(getLabel({ profileName: 'Alex' }) === 'Profile: Alex', 'profile receipt label is wrong');
});

check('receipts: Night Mode label renders only when canonical identity exists', () => {
  const receiptRendererSrc = fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8');
  const fnMatch = receiptRendererSrc.match(/function getReceiptNightModeLabel\(receipt\) \{[\s\S]*?\n\}/);
  assert(fnMatch, 'getReceiptNightModeLabel function not found');
  const getLabel = Function(`return (${fnMatch[0]})`)();
  assert(getLabel({}) === '', 'manual receipt should omit Mode label');
  assert(getLabel({ nightModeTitle: null }) === '', 'modified-mode receipt should omit Mode label');
  assert(getLabel({ nightModeTitle: 'Quick Sleep' }) === 'Mode: Quick Sleep', 'Night Mode receipt label is wrong');
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

// 16b. Profile Ritual Gateway.
check('profile-ritual-gateway: context module loaded and ritual gateway in startTimer', () => {
  assert(mainSrc.includes("require('./profileRitualContext')"), 'profileRitualContext not required in main');
  assert(mainSrc.includes("require('./startDecision')"), 'startDecision not required in main');
  assertMatch(mainSrc, /startDecision\.resolveStartDecision\(/, 'startTimer does not use canonical decision resolver');
  assertMatch(mainSrc, /decision\.useRitualGateway/, 'startTimer does not route by decision.useRitualGateway');
  assertMatch(mainSrc, /profileRitualContext\.createContext\(/, 'ritual gateway does not create pending context');
  assertMatch(mainSrc, /ritualMode\.startRitual\(null, \{ profileRitualToken: runToken,/, 'ritual gateway does not pass token as run metadata');
  assertMatch(mainSrc, /setupRitualCallbacks\(\);\s*createWindow\(\);/, 'ritual side-effect callbacks must be registered before the renderer becomes interactive');
});

// 16c. Remote-origin ritual fast-forward (fix/v11.1.1-night-mode-remote-ritual).
// Every ritual step, including "auto" ones, normally advances only via a
// click on the desktop's guided-overlay UI. A phone-triggered ritual has no
// one at the desktop to click through it, so it must fast-forward instead of
// getting stuck "active" forever -- which previously blocked ALL further
// Night Mode starts via the ritualMode.getState().active guard.
check('ritual-mode: remote-originated rituals are marked and fast-forwarded, not left stuck active', () => {
  assertMatch(mainSrc, /remoteOrigin: options\.source === 'remote'/, 'startTimer does not mark remote-origin ritual runs');
  const ritualModeSrc = fs.readFileSync(path.join(root, 'ritualMode.js'), 'utf8');
  assertMatch(ritualModeSrc, /ritualState\.runMeta\.remoteOrigin/, 'ritualMode does not fast-forward remote-origin runs');
});

check('profile-ritual-gateway: timer step uses run-owned token from runMeta', () => {
  assertMatch(mainSrc, /profileRitualContext\.consume\(runToken\)/, 'timer step does not use run-owned token');
  assert(!mainSrc.includes('consumeAny'), 'consumeAny reference still in main.js');
  assertMatch(mainSrc, /beginValidatedCountdown\(/, 'timer step does not call beginValidatedCountdown');
  assertMatch(mainSrc, /ritualMode\.getConfig\(\)[\s\S]{0,80}beginValidatedCountdown/, 'timer step fallback to global config missing');
});

check('profile-ritual-gateway: beginValidatedCountdown split from startTimer', () => {
  assertMatch(mainSrc, /function beginValidatedCountdown\(options, identity, nmIdentity\)/, 'beginValidatedCountdown function not found');
  // Ritual timer step must not re-enter startTimer (would cause self-cancel).
  const timerStepBlock = mainSrc.match(/step\.id === 'timer'[\s\S]{0,1500}step\.id === 'lights'/);
  assert(timerStepBlock, 'timer step block not found');
  assert(!timerStepBlock[0].includes('startTimer('), 'timer step re-enters startTimer — should use beginValidatedCountdown');
});

check('profile-ritual-gateway: direct supersession only for non-ritual source', () => {
  assertMatch(mainSrc, /options\.source !== 'ritual' && ritualMode\.getState\(\)\.active/, 'direct supersession is not guarded by source !== ritual');
  assertMatch(mainSrc, /options\.source !== 'ritual'[\s\S]{0,80}profileRitualContext\.clear\(\)/, 'supersession unconditional clear not guarded by source !== ritual');
});

check('profile-ritual-gateway: context cleared on cancel, complete, and manual start', () => {
  // Cancel clears context (unconditional)
  assertMatch(mainSrc, /ritual-cancel[\s\S]{0,150}profileRitualContext\.clear\(\)/, 'cancel does not clear profile ritual context');
  // Manual Begin Ritual clears context (unconditional)
  assertMatch(mainSrc, /ritual-start[\s\S]{0,250}profileRitualContext\.clear\(\)/, 'manual ritual-start does not clear pending context');
  // Completion uses token-safe clearIfOwned (guarded by runToken)
  assertMatch(mainSrc, /ritualMode\.onComplete[\s\S]{0,400}profileRitualContext\.clearIfOwned\(runToken\)/, 'ritual completion does not use token-safe clearIfOwned');
});

check('profile-ritual-gateway: renderer sends startOrigin without ritual branching', () => {
  const rendererSrc = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const rendererProfilesSrc = fs.readFileSync(path.join(root, 'renderer-profiles.js'), 'utf8');
  assertMatch(rendererSrc, /startOrigin:\s*origin/, 'renderer startTimer does not send startOrigin');
  assertMatch(rendererProfilesSrc, /'profile-start'/, 'renderer-profiles does not pass profile-start origin');
  assert(!/ritualStart/.test(rendererProfilesSrc), 'renderer-profiles gained ritual branching');
  assert(!/ritualId/.test(rendererProfilesSrc), 'renderer-profiles inspects ritualId');
  // renderer.js may reference ritualId for armed-mode banner display (presentation only),
  // but must not use it for execution routing decisions.
  assert(!/profile\.ritualId/.test(rendererSrc), 'renderer.js inspects profile.ritualId for routing');
  // Default origin must not be 'play' — only explicit callers should be eligible.
  assertMatch(rendererSrc, /origin = null\)/, 'renderer startTimer default origin should be null, not play');
  // Only the shared startTonightPlan() wrapper passes 'play' explicitly --
  // exactly one copy of the literal call, instead of three independent
  // copies (hero CTA, the old #btn-start, Space key) that could drift.
  const playExplicit = (rendererSrc.match(/startTimer\(inputSeconds\(\), 'play'\)/g) || []).length;
  assert(playExplicit === 1, `expected exactly 1 explicit 'play' caller (inside startTonightPlan), found ${playExplicit}`);
  // And exactly the hero CTA, Space shortcut, and "Play Tonight Again" call
  // that shared wrapper (this count excludes its own definition line).
  const planCallSites = (rendererSrc.match(/startTonightPlan\(\)/g) || []).length - 1;
  assert(planCallSites === 3, `expected exactly 3 callers of startTonightPlan(), found ${planCallSites}`);
});

check('profile-ritual-gateway: remote source cannot trigger profile ritual', () => {
  const startDecisionSrc = fs.readFileSync(path.join(root, 'startDecision.js'), 'utf8');
  assertMatch(startDecisionSrc, /normalizedOptions\.source !== 'remote'/, 'startDecision does not block remote ritual gateway');
});

check('profile-ritual-gateway: companion Night Mode origin is eligible for ritual gateway', () => {
  const profileRitualContextSrc = fs.readFileSync(path.join(root, 'profileRitualContext.js'), 'utf8');
  assertMatch(profileRitualContextSrc, /['"]companion-night-mode['"]/, 'companion-night-mode is not in ELIGIBLE_ORIGINS');
});

check('profile-ritual-gateway: normalizeTimerOptions accepts startOrigin field', () => {
  assertMatch(mainSrc, /startOrigin:\s*typeof options\.startOrigin === 'string'/, 'normalizeTimerOptions does not parse startOrigin');
});

check('profile-ritual-gateway: run-owned token via ritualMode metadata', () => {
  const ritualSrc = fs.readFileSync(path.join(root, 'ritualMode.js'), 'utf8');
  assertMatch(ritualSrc, /runMeta: meta && typeof meta === 'object'/, 'ritualMode does not store run metadata');
  assertMatch(ritualSrc, /Object\.freeze\(\{ \.\.\.meta \}\)/, 'ritualMode does not freeze run metadata');
  assertMatch(ritualSrc, /onStepCallback\(current, getState\(\), ritualState\.runMeta, ritualState\.runId\)/, 'onStep does not pass runMeta+runId');
  assertMatch(ritualSrc, /onCompleteCallback\(getState\(\), ritualState\.runMeta, ritualState\.runId\)/, 'onComplete does not pass runMeta+runId');
});

check('profile-ritual-gateway: error uses runId-owned cancellation and token-owned cleanup', () => {
  assertMatch(mainSrc, /catch \(err\)[\s\S]{0,400}ritualMode\.cancelIfCurrent\(runId\)/, 'step error does not use cancelIfCurrent(runId)');
  assertMatch(mainSrc, /catch \(err\)[\s\S]{0,400}profileRitualContext\.clearIfOwned\(runToken\)/, 'step error does not use clearIfOwned(runToken)');
  assert(!mainSrc.match(/catch \(err\)[\s\S]{0,400}ritualMode\.cancelRitual\(\)/), 'step error uses unconditional cancelRitual');
  assert(!mainSrc.match(/catch \(err\)[\s\S]{0,400}ritualMode\.cancelIfOwned/), 'step error still uses deprecated cancelIfOwned');
});

check('profile-ritual-gateway: cancelIfCurrent exported from ritualMode', () => {
  const ritualSrc = fs.readFileSync(path.join(root, 'ritualMode.js'), 'utf8');
  assertMatch(ritualSrc, /function cancelIfCurrent\(runId\)/, 'cancelIfCurrent not found in ritualMode');
  assertMatch(ritualSrc, /cancelIfCurrent,/, 'cancelIfCurrent not exported from ritualMode');
  assert(!ritualSrc.includes('cancelIfOwned'), 'deprecated cancelIfOwned still exists in ritualMode');
});

check('profile-ritual-gateway: onStep callback receives runId as 4th param', () => {
  assertMatch(mainSrc, /onStep\(\(step, state, runMeta, runId\)/, 'onStep does not receive runId as 4th param');
});

check('profile-ritual-gateway: getRunId exported from ritualMode', () => {
  const ritualSrc = fs.readFileSync(path.join(root, 'ritualMode.js'), 'utf8');
  assertMatch(ritualSrc, /function getRunId/, 'getRunId not found');
  assertMatch(ritualSrc, /getRunId,/, 'getRunId not exported');
});

check('profile-ritual-gateway: auto-advance timer captures runId for staleness', () => {
  const ritualSrc = fs.readFileSync(path.join(root, 'ritualMode.js'), 'utf8');
  assertMatch(ritualSrc, /const capturedRunId = ritualState\.runId/, 'auto-advance timer does not capture runId');
  assertMatch(ritualSrc, /ritualState\.runId !== capturedRunId/, 'auto-advance timer does not check runId staleness');
});

check('profile-ritual-gateway: shutdown cleanup', () => {
  assertMatch(mainSrc, /app\.on\('before-quit',[\s\S]*?profileRitualContext\.clear\(\)/, 'app shutdown does not clear context');
});

check('profile-ritual-gateway: no activeRitualRunToken global', () => {
  assert(!mainSrc.includes('activeRitualRunToken'), 'mutable global activeRitualRunToken still exists in main.js');
});

check('profile-ritual-gateway: consumeAny completely removed', () => {
  const ctxSrc = fs.readFileSync(path.join(root, 'profileRitualContext.js'), 'utf8');
  assert(!ctxSrc.includes('consumeAny'), 'consumeAny still exists in profileRitualContext.js');
  assert(!ctxSrc.includes('_consumeAny'), '_consumeAny still exists in profileRitualContext.js');
  assert(!mainSrc.includes('consumeAny'), 'consumeAny still referenced in main.js');
});

// 17. Stats Dashboard.
check('stats-dashboard: module and IPC', () => {
  assert(mainSrc.includes("require('./statsDashboard')"), 'statsDashboard not required');
  assertMatch(mainSrc, /ipcMain\.handle\('get-full-dashboard'/, 'get-full-dashboard IPC missing');
  assertMatch(preloadSrc, /getFullDashboard:/, 'preload getFullDashboard missing');
});

// 18. Runtime UX truth: every visible nav/control has a real action or is disabled.
check('ux: ns-play-btn is wired to the shared start function', () => {
  assertMatch(rendererSrc, /getElementById\('ns-play-btn'\)\?\.addEventListener\('click', \(\) => startTonightPlan\(\)\)/, 'ns-play-btn not wired');
});

check('ux: ns-play-btn has exactly one click handler (no duplicate startTimer)', () => {
  const matches = rendererSrc.match(/getElementById\('ns-play-btn'\)\?\.addEventListener\('click'/g) || [];
  assert(matches.length === 1, `ns-play-btn should have exactly one click handler, found ${matches.length}`);
});

check('ux: ns-play-btn has aria-label', () => {
  assertMatch(htmlSrc, /id="ns-play-btn"[^>]*aria-label="Start tonight/, 'ns-play-btn aria-label missing');
});

check('ux: exactly one Start control exists -- no hidden or duplicate #btn-start', () => {
  // There used to be two buttons (#btn-start in setup-controls, #ns-play-btn
  // in the hero) that fired the identical startTimer(inputSeconds(), 'play')
  // call. The fix is not a hidden duplicate kept alive for callers -- it is
  // one element, one shared function (startTonightPlan), used by every
  // caller: the hero CTA, "Play Tonight Again", and the Space shortcut.
  assert(!/id="btn-start"/.test(htmlSrc), '#btn-start must not exist in the DOM at all -- no hidden duplicate control');
  assert(!/getElementById\('btn-start'\)/.test(rendererSrc), 'no code may reference a #btn-start element anymore');
  assertMatch(rendererSrc, /function startTonightPlan\(\)\s*\{\s*return startTimer\(inputSeconds\(\), 'play'\);\s*\}/, 'a single shared startTonightPlan() function must exist');
  const startCallers = (rendererSrc.match(/startTonightPlan\(\)/g) || []).length;
  assert(startCallers >= 4, `expected startTonightPlan() to be called by the hero CTA, Play Tonight Again, and the Space shortcut (plus its own definition), found ${startCallers} references`);
  assertMatch(rendererSrc, /getElementById\('ns-play-btn'\)\?\.addEventListener\('click', \(\) => startTonightPlan\(\)\)/, 'the hero CTA must call the shared start function');
});

check('ux: Escape closes all modals (profiles, receipts, about, notif-drawer)', () => {
  assertMatch(rendererSrc, /els\.profilesModal\?\.classList\.contains\('active'\)/, 'Escape does not check profilesModal');
  assertMatch(rendererSrc, /els\.receiptsModal\?\.classList\.contains\('active'\)/, 'Escape does not check receiptsModal');
  assertMatch(rendererSrc, /els\.aboutModal\?\.classList\.contains\('active'\)/, 'Escape does not check aboutModal');
  assertMatch(rendererSrc, /getElementById\('notif-drawer'\)\?\.classList\.contains\('active'\)/, 'Escape does not check the active notification drawer');
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
  assertMatch(mainSrc, /ipcMain\.on\('toggle-mini-mode'[\s\S]*miniMode = enteringMiniMode;/s, 'miniMode toggle missing');
  assertMatch(mainSrc, /if \(enteringMiniMode\) windowGeometry\.enterMiniMode\(mainWindow\);/, 'mini-mode enter transition missing');
  assertMatch(mainSrc, /windowGeometry\.exitMiniMode\(mainWindow, screen\);/, 'mini-mode exit transition missing');
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

// 23. Night Modes library vertical slice.
const nightModesSrc = fs.readFileSync(path.join(root, 'nightModes.js'), 'utf8');

check('night-modes: module exists and exports catalogue', () => {
  assert(mainSrc.includes("require('./nightModes')"), 'nightModes not required in main');
  assertMatch(nightModesSrc, /function getCatalogue\(\)/, 'getCatalogue missing');
  assertMatch(nightModesSrc, /function resolveForExecution\(/, 'resolveForExecution missing');
  assertMatch(nightModesSrc, /function validateMode\(/, 'validateMode missing');
});

check('night-modes: six built-in modes with unique IDs', () => {
  assertMatch(nightModesSrc, /id: 'quick-sleep'/, 'quick-sleep missing');
  assertMatch(nightModesSrc, /id: 'lights-down'/, 'lights-down missing');
  assertMatch(nightModesSrc, /id: 'movie-wind-down'/, 'movie-wind-down missing');
  assertMatch(nightModesSrc, /id: 'full-shutdown'/, 'full-shutdown missing');
  assertMatch(nightModesSrc, /id: 'quiet-house'/, 'quiet-house missing');
  assertMatch(nightModesSrc, /id: 'school-night'/, 'school-night missing');
});

check('night-modes: disabled modes have honest unavailability reasons', () => {
  assertMatch(nightModesSrc, /quiet-house[\s\S]*?status: 'coming_soon'/s, 'quiet-house not marked coming_soon');
  assertMatch(nightModesSrc, /school-night[\s\S]*?status: 'needs_router_setup'/s, 'school-night not marked needs_router_setup');
  assertMatch(nightModesSrc, /Multi-device control is not yet supported/, 'quiet-house reason missing');
  assertMatch(nightModesSrc, /router-level Wi-Fi control/, 'school-night reason missing');
});

check('night-modes: only allowed execution paths (no arbitrary scripts)', () => {
  assertMatch(nightModesSrc, /ALLOWED_EXECUTION_PATHS.*Object\.freeze\(\[/, 'execution paths not frozen');
  assertMatch(nightModesSrc, /'start-timer'/, 'start-timer path missing');
  assertMatch(nightModesSrc, /'start-standard-ritual'/, 'start-standard-ritual path missing');
  assert(!nightModesSrc.includes('run-script'), 'arbitrary script execution path present');
  assert(!nightModesSrc.includes('shell'), 'shell execution path present');
});

check('night-modes: IPC handlers registered in main', () => {
  assertMatch(mainSrc, /ipcMain\.handle\('get-night-modes-catalogue'/, 'catalogue IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('get-night-mode'/, 'get-night-mode IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('resolve-night-mode'/, 'resolve IPC missing');
  assertMatch(mainSrc, /ipcMain\.handle\('use-night-mode-tonight'/, 'use-tonight IPC missing');
});

check('night-modes: preload exposes night mode API', () => {
  assertMatch(preloadSrc, /getNightModesCatalogue:/, 'preload getNightModesCatalogue missing');
  assertMatch(preloadSrc, /getNightMode:/, 'preload getNightMode missing');
  assertMatch(preloadSrc, /resolveNightMode:/, 'preload resolveNightMode missing');
  assertMatch(preloadSrc, /useNightModeTonight:/, 'preload useNightModeTonight missing');
});

check('night-modes: receipt creation includes nightModeId field', () => {
  const receiptsSrc = fs.readFileSync(path.join(root, 'runReceipts.js'), 'utf8');
  assertMatch(receiptsSrc, /nightModeId: timerState\.nightModeId/, 'nightModeId missing from receipt');
  assertMatch(receiptsSrc, /nightModeTitle: timerState\.nightModeTitle/, 'nightModeTitle missing from receipt');
});

check('night-modes: timerState carries nightModeId, nightModeTitle, and nightModeVersion', () => {
  assertMatch(mainSrc, /nightModeId: null/, 'timerState nightModeId init missing');
  assertMatch(mainSrc, /nightModeTitle: null/, 'timerState nightModeTitle init missing');
  assertMatch(mainSrc, /nightModeVersion: null/, 'timerState nightModeVersion init missing');
  assertMatch(mainSrc, /timerState\.nightModeId = nm\.nightModeId/, 'timerState nightModeId assignment from resolved nm missing');
  assertMatch(mainSrc, /timerState\.nightModeTitle = nm\.nightModeTitle/, 'timerState nightModeTitle assignment from resolved nm missing');
  assertMatch(mainSrc, /timerState\.nightModeVersion = nm\.nightModeVersion/, 'timerState nightModeVersion assignment missing');
});

check('night-modes: MODES panel exists in HTML', () => {
  assertMatch(htmlSrc, /id="ns-panel-modes"/, 'MODES panel missing from HTML');
  assertMatch(htmlSrc, /id="nm-cards-grid"/, 'cards grid missing from HTML');
  assertMatch(htmlSrc, /id="nm-detail-panel"/, 'detail panel missing from HTML');
  assertMatch(htmlSrc, /id="nm-btn-use-tonight"/, 'Use Tonight button missing from HTML');
});

check('night-modes: sidebar has MODES nav item', () => {
  assertMatch(htmlSrc, /data-ns-tab="modes"/, 'MODES sidebar nav missing');
});

check('night-modes: renderer handles modes panel visibility', () => {
  assertMatch(rendererSrc, /panelModes:.*getElementById\('ns-panel-modes'\)/, 'panelModes element reference missing');
  assertMatch(rendererSrc, /els\.panelModes[\s\S]*display.*=.*panel === 'modes'/, 'modes visibility toggle missing');
});

check('night-modes: Use Tonight does not auto-start timer', () => {
  assertMatch(mainSrc, /use-night-mode-tonight[\s\S]*?timer is NOT started here/s, 'use-tonight comment about non-start missing');
});

check('night-modes: resolveNightModeStart exported from nightModes module', () => {
  assertMatch(nightModesSrc, /function resolveNightModeStart\(/, 'resolveNightModeStart missing');
  assertMatch(nightModesSrc, /resolveNightModeStart/, 'resolveNightModeStart not in exports');
});

check('night-modes: main delegates to nightModes.resolveNightModeStart', () => {
  assertMatch(mainSrc, /nightModes\.resolveNightModeStart/, 'main does not delegate to nightModes.resolveNightModeStart');
});

check('night-modes: normalizeTimerOptions preserves nightModeId only', () => {
  assertMatch(mainSrc, /nightModeId: typeof options\.nightModeId === 'string'/, 'normalizeTimerOptions does not preserve nightModeId');
  assert(!mainSrc.includes("nightModeTitle: typeof options.nightModeTitle"), 'normalizeTimerOptions should NOT preserve nightModeTitle');
});

check('night-modes: renderer sends only nightModeId (not title) in startTimer', () => {
  const rendNm = fs.readFileSync(path.join(root, 'renderer-night-modes.js'), 'utf8');
  assert(!rendererSrc.includes('nightModeTitle: nmSel'), 'renderer sends nightModeTitle — trust violation');
  assert(!rendNm.includes('window.__nightModeSelection'), 'renderer-night-modes still uses window.__nightModeSelection');
});

check('night-modes: armed mode state replaces window.__nightModeSelection', () => {
  assertMatch(rendererSrc, /armedNightMode: null/, 'armedNightMode state init missing');
  assertMatch(rendererSrc, /function clearArmedNightMode\(\)/, 'clearArmedNightMode function missing');
  assertMatch(rendererSrc, /function armNightMode\(/, 'armNightMode function missing');
  assertMatch(rendererSrc, /function checkArmedModeMatch\(\)/, 'checkArmedModeMatch function missing');
  assert(!rendererSrc.includes('window.__nightModeSelection'), 'renderer.js still uses window.__nightModeSelection');
  assert(!/const result = await api\.startTimer\([\s\S]{0,700}clearArmedNightMode\(\);/.test(rendererSrc), 'starting the selected plan must not erase restart restoration');
  assertMatch(rendererSrc, /const restoredArmedMode = app\.armedNightMode[\s\S]*state\.action = restoredArmedMode\.action;[\s\S]*const restoredDuration = restoredArmedMode\?\.durationSeconds \?\? app\.durationSeconds;/s, 'restored selected plan must override stale custom action/duration controls');
});

check('night-modes: armed mode banner in HTML', () => {
  assertMatch(htmlSrc, /id="armed-mode-banner"/, 'armed-mode-banner missing from HTML');
  assertMatch(htmlSrc, /id="armed-mode-title"/, 'armed-mode-title missing from HTML');
  assertMatch(htmlSrc, /id="armed-mode-clear"/, 'armed-mode-clear button missing from HTML');
});

check('night-modes: cards have keyboard accessibility', () => {
  const rendNm = fs.readFileSync(path.join(root, 'renderer-night-modes.js'), 'utf8');
  assertMatch(rendNm, /role.*button/, 'cards missing role=button');
  assertMatch(rendNm, /tabindex.*0/, 'cards missing tabindex=0');
  assertMatch(rendNm, /aria-pressed/, 'cards missing aria-pressed');
  assertMatch(rendNm, /keydown/, 'cards missing keydown handler');
});

check('night-modes: receipt includes nightModeVersion', () => {
  const receiptsSrc = fs.readFileSync(path.join(root, 'runReceipts.js'), 'utf8');
  assertMatch(receiptsSrc, /nightModeVersion: timerState\.nightModeVersion/, 'nightModeVersion missing from receipt');
});

check('night-modes: profileRitualContext preserves night mode identity', () => {
  const ctxSrc = fs.readFileSync(path.join(root, 'profileRitualContext.js'), 'utf8');
  assertMatch(ctxSrc, /nightModeId:/, 'nightModeId missing from profileRitualContext');
  assertMatch(ctxSrc, /nightModeTitle:/, 'nightModeTitle missing from profileRitualContext');
  assertMatch(ctxSrc, /nightModeVersion:/, 'nightModeVersion missing from profileRitualContext');
});

check('night-modes: responsive breakpoint for detail panel', () => {
  const stylesSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assertMatch(stylesSrc, /@media.*max-width.*680px/, 'responsive breakpoint for detail panel missing');
});

check('night-modes: resolveNightModeStart returns canonical ritualId', () => {
  assertMatch(nightModesSrc, /ritualId: mode\.timer\.ritualId/, 'resolveNightModeStart does not return ritualId');
});

check('night-modes: startTimer delegates canonical ritual decision to startDecision', () => {
  assertMatch(mainSrc, /startDecision\.resolveStartDecision\(/, 'startTimer does not use startDecision');
  assertMatch(mainSrc, /decision\.useRitualGateway/, 'startTimer does not use decision.useRitualGateway');
});

check('night-modes: startDecision gives Night Mode precedence over profile ritual', () => {
  const startDecisionSrc = fs.readFileSync(path.join(root, 'startDecision.js'), 'utf8');
  assertMatch(startDecisionSrc, /resolveEffectiveRitualId/, 'startDecision missing resolveEffectiveRitualId');
  assertMatch(startDecisionSrc, /nightModeIdentity.*nightModeId/, 'startDecision does not prefer Night Mode identity');
  assertMatch(startDecisionSrc, /profileRitualId/, 'startDecision does not fall back to profile ritualId');
});

check('night-modes: armed mode banner shows ritual state (presentation only)', () => {
  assertMatch(rendererSrc, /ritualId === 'standard'.*Standard ritual/, 'banner does not show ritual state');
});

check('night-modes: normal-mode minimum width supports library detail panel', () => {
  const windowGeometrySrc = fs.readFileSync(path.join(root, 'windowGeometry.js'), 'utf8');
  assertMatch(windowGeometrySrc, /NORMAL_MINIMUM = Object\.freeze\(\{ width: 900/, 'NORMAL_MINIMUM width too small for library');
});

// Cleanup.
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
