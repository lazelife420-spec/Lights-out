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

// Checks that must await (vm-sandboxed async renderer code). Counted before the summary.
const asyncChecks = [];
function checkAsync(name, fn) {
  asyncChecks.push(Promise.resolve().then(fn).then(() => {
    passed++;
    console.log(`  PASS  ${name}`);
  }, err => {
    failed++;
    console.log(`  FAIL  ${name} -> ${err.message}`);
  }));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertMatch(src, pattern, msg) {
  assert(pattern.test(src), msg || `missing pattern: ${pattern}`);
}

// 1. Syntax-check every first-party JS file.
const jsFiles = ['main.js', 'preload.js', 'renderer-utils.js', 'renderer-profiles.js', 'renderer-calendar.js', 'renderer-receipts.js', 'renderer-family-remote.js', 'renderer-ritual-focus.js', 'renderer-settings.js', 'renderer-lastlight-alarm.js', 'renderer-onboarding-updater.js', 'renderer.js', 'settings.js', 'smartLights.js', 'profiles.js', 'profileIdentity.js', 'profileRitualContext.js', 'startDecision.js', 'updater.js', 'updaterPolicy.js', 'windowGeometry.js', 'calendar.js', 'lastLight.js', 'companionNetwork.js', 'companionFirewall.js', 'capabilityTruth.js'];
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
  assert(all.customization.accent === '#9b93d6', 'unexpected default accent');
  assert(all.app.clockFace === 'digital', 'clock face default should be the countdown ring');
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
    events: [
      { date: '2026-06-30', bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' },
      // A legacy event as an old build wrote it for the night of 2026-07-01:
      // the UTC date of the write, with the local bedTime of that moment.
      { date: new Date(2026, 6, 1, 22, 15).toISOString().slice(0, 10), bedTime: '22:15', action: 'shutdown', snoozed: false },
      { date: '2026-07-02', bedTime: '22:20', action: 'shutdown', snoozed: false, testMode: true }
    ],
    streak: 9,
    bestStreak: 9,
    truthVersion: 2,
    achievements: ['first_light', '7_night_streak']
  });
  const exported = streaks.exportData();
  streaks.replaceAll({ events: [], streak: 0, bestStreak: 0, achievements: [] });
  streaks.replaceAll(exported);
  const restored = streaks.exportData();
  assert(restored.events.length === 3, 'streak events were not restored');
  assert(restored.events[0].source === 'real', 'event source was not round-tripped');
  assert(restored.events[2].testMode === true, 'event testMode flag was not round-tripped');
  assert(restored.truthVersion === 2, 'truthVersion was not round-tripped');
  // Imported streak values are recomputed from counted events, never trusted.
  assert(restored.bestStreak === 2, `best streak should be recomputed from counted events, got ${restored.bestStreak}`);
  assert(!restored.achievements.includes('7_night_streak'), 'imported achievements must be rebuilt, not trusted');
});

check('streaks: getTrend aggregates events into weekly and monthly buckets', () => {
  const streaks = require(path.join(root, 'streaks.js'));
  streaks._reset();
  // Two nights in the same ISO week (Mon 2026-06-01) and one in the next
  // month (2026-07-01), so week/month bucketing produce different bucket
  // counts against the same underlying data.
  streaks.replaceAll({
    events: [
      { date: '2026-06-01', bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' },
      { date: '2026-06-02', bedTime: '23:30', action: 'shutdown', snoozed: true, source: 'real' },
      { date: '2026-07-01', bedTime: '22:15', action: 'sleep', snoozed: false, source: 'real' }
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

  // Local night keys relative to the real clock (tonight, last night, ...),
  // shifted by whole local calendar days so DST never skips a night.
  const tonight = streaks.nightKey();
  const night = (daysAgo) => {
    const [y, m, d] = tonight.split('-').map(Number);
    const x = new Date(y, m - 1, d - daysAgo);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  streaks.replaceAll({
    events: [
      { date: night(2), bedTime: '22:00', action: 'shutdown', snoozed: false, source: 'real' },
      { date: night(1), bedTime: '22:30', action: 'shutdown', snoozed: true, source: 'real' },
      { date: night(0), bedTime: '22:15', action: 'sleep', snoozed: false, source: 'real' }
    ],
    streak: 3,
    bestStreak: 5,
    achievements: ['first_light']
  });

  const report = streaks.getWeeklyReport();
  assert(report.nightsThisWeek === 3, `expected 3 nights this week, got ${report.nightsThisWeek}`);
  assert(typeof report.narrative === 'string' && report.narrative.length > 0, 'getWeeklyReport should include a narrative field');
  assert(report.narrative.includes('3 of the last 7 nights logged'), `narrative should state the real night count, got: ${report.narrative}`);
  assert(report.narrative.includes('Current streak: 3 nights (best ever: 3)'), `narrative should state the real (recomputed) streak numbers, got: ${report.narrative}`);
  assert(report.narrative.includes('Snoozed on 33% of logged nights'), `narrative should state the real snooze rate, got: ${report.narrative}`);
  assert(report.narrative.includes('Real-mode completions: 2 shutdown, 1 sleep'), `narrative should break down real action counts, got: ${report.narrative}`);
  assert(!/Actions taken/.test(report.narrative), 'narrative must not claim power actions ran');
  // UI-R3 Fire 10: Routine shows no achievements, so the narrative never
  // mentions them (the rebuilt count itself is still pinned above).
  assert(!/achievement/i.test(report.narrative), `the weekly narrative must not mention achievements, got: ${report.narrative}`);
  assert(Array.isArray(report.achievements) && report.achievements.length === 2, 'the report still carries the rebuilt achievements (read-out change only)');

  // A Test-Mode-only week is acknowledged honestly and counts for nothing.
  streaks.replaceAll({ events: [{ date: night(0), bedTime: '22:15', action: 'shutdown', snoozed: false, testMode: true }] });
  const testOnly = streaks.getWeeklyReport();
  assert(testOnly.nightsThisWeek === 0 && testOnly.totalNights === 0 && testOnly.streak === 0, 'Test Mode events must not count');
  assert(testOnly.testModeRunsThisWeek === 1, `expected 1 Test Mode run this week, got ${testOnly.testModeRunsThisWeek}`);
  assert(testOnly.narrative.startsWith('No real completions this week. Test Mode runs are recorded in Proof but don\'t count toward your routine.'), `Test-Mode-only narrative wrong, got: ${testOnly.narrative}`);

  // Per night, never per event: a daily 23:00 user's last legacy week plus
  // tonight's REAL run never reads "8 of the last 7 nights".
  {
    streaks._reset();
    const [ty, tm, td] = streaks.nightKey().split('-').map(Number);
    const legacyWeek = [];
    for (let i = 7; i >= 1; i--) {
      const at = new Date(ty, tm - 1, td - i, 23, 0); // an old build: UTC date + local bedTime
      legacyWeek.push({ date: at.toISOString().slice(0, 10), bedTime: '23:00', action: 'shutdown', snoozed: false });
    }
    streaks.replaceAll({ events: legacyWeek });
    streaks.recordEvent('23:00', 'shutdown', false);
    const week = streaks.getWeeklyReport();
    const n = Number((/(\d+) of the last 7 nights/.exec(week.narrative) || [])[1]);
    assert(week.nightsThisWeek <= 7 && n <= 7, `weekly report counts events, not nights: ${week.narrative}`);
    assert(streaks.exportData().events.length === 8, 'legacy events must never be deleted');
    assert(streaks.getSummary().streak === 8 && streaks.getSummary().weekDays.length <= 7, 'legacy nights must map to their own local night');
  }
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
  // P01: both tooltips state the mode (Test Mode / REAL), not just the phase.
  assertMatch(mainSrc, /if \(!timerState\.running && !timerState\.paused\) \{[\s\S]{0,160}tray\.setToolTip\(`Lights Out - idle · \$\{appDryRun \? 'Test Mode' : 'Real actions on'\}`\);/s, 'idle tray tooltip missing');
  assertMatch(mainSrc, /tray\.setToolTip\(`Lights Out - \$\{prefix\}, \$\{formatTime\(timerState\.remainingSeconds\)\} left · \$\{timerState\.dryRun \? 'Test Mode' : 'REAL ' \+ formatAction\(timerState\.action\)\}`\);/, 'active tray tooltip missing');
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
  assertMatch(smartLightsSrc, /async function invokeSmartLightAction\(\{ on = true, brightness = 254, colorTemp = 366, transitionTime = 10, preservePower = false, released \} = \{\}\)/, 'smart-light action helper missing');
  assertMatch(smartLightsSrc, /module\.exports = \{[\s\S]*invokeSmartLightAction,/s, 'smart-light action helper not exported');
  assertMatch(mainSrc, /const sunriseTickSeconds = 5;/, 'First Light sunrise tick constant missing');
  assertMatch(mainSrc, /preservePower: sunriseStep > 1,\s*released: sunriseManualOff,/, 'Sunrise must yield to manual off after its initial wake action');
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

check('F2: Settings › General is a real page (startup truth, idle clock, About & updates, data)', () => {
  const rendererF2 = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const genAt = htmlSrc.search(/<div class="option-section[^"]*" data-settings-category="general">/);
  const general = htmlSrc.slice(genAt, htmlSrc.indexOf('<div class="option-section', genAt + 10));
  const ids = ['chk-run-login', 'set-startup-note', 'chk-clock-mode', 'cz-clock-format', 'set-app-version', 'set-updater-status', 'btn-set-check-update', 'btn-set-shortcuts', 'set-data-note'];
  let last = -1;
  for (const id of ids) {
    const at = general.indexOf(`id="${id}"`);
    assert(at > last, `#${id} must be in Settings › General, in order`);
    last = at;
  }
  const appAt = htmlSrc.search(/<div class="option-section[^"]*" data-settings-category="appearance">/);
  const appearance = htmlSrc.slice(appAt, htmlSrc.indexOf('<div class="option-section', appAt + 10));
  assert(!appearance.includes('id="chk-clock-mode"') && !appearance.includes('id="cz-clock-format"'), 'the idle-clock toggle and Time Format moved out of Appearance');
  assert(appearance.includes('id="cz-clockface"') && appearance.includes('id="cz-clock-scale"'), 'clock face and size stay in Appearance');
  // #chk-clock-mode: live, applied and persisted on change (it used to be dead until a Save that dropped it).
  assertMatch(rendererF2, /els\.chkClockMode\.addEventListener\('change', async \(\) => \{\s*state\.clockMode = els\.chkClockMode\.checked;[\s\S]*?render\(\);[\s\S]*?api\.saveAppSettings\(\{ app: \{ clockMode: state\.clockMode \} \}\)/, '#chk-clock-mode applies and persists on change');
  assertMatch(rendererF2, /els\.setBtnCheckUpdate\?\.addEventListener\('click', runUpdateCheck\);/, 'General uses the same update check as About');
  assert((htmlSrc.match(/id="updater-status"/g) || []).length === 1 && (htmlSrc.match(/id="btn-check-update"/g) || []).length === 1, 'General does not duplicate About ids');
});

check('layout: Settings migrates persisted nsActiveTab "set"/"help" to Tonight on launch', () => {
  const rendererSettingsSrc = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  assertMatch(rendererSettingsSrc, /app\.nsActiveTab === 'set' \|\| app\.nsActiveTab === 'help'/, 'a persisted nsActiveTab of "set" or "help" must never be restored on launch');
});

check('ui: icon-only navigation and footer buttons have accessible labels', () => {
  assertMatch(htmlSrc, /data-ns-tab="lib"[^>]*aria-label="Open tonight"/, 'TONIGHT aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="sch"[^>]*aria-label="Open schedule"/, 'SCH aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="set"[^>]*aria-label="Open settings"/, 'SET aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="help"[^>]*aria-label="Open help and about"/, 'Help aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="stats"[^>]*aria-label="Open proof"/, 'Proof (stats) aria-label missing');
  assertMatch(htmlSrc, /data-ns-tab="devices"[^>]*aria-label="Open devices"/, 'Devices aria-label missing');
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
  // P03: the running/paused footer names the mode in words both ways
  // (never colour alone): 'Test Mode · …' or 'Real · …'.
  assertMatch(rendererSrc, /state\.dryRun \? `Test Mode · \$\{phaseLabel\}` : `Real · \$\{phaseLabel\}`/, 'active Test Mode / REAL status must remain prominent');
  assertMatch(rendererSrc, /state\.dryRun \? 'Test Mode · Paused' : 'Real · Paused'/, 'paused Test Mode / REAL status must remain prominent');
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
  assertMatch(rendererSrc, /if \(await saveSettingsPanel\(\)\) closeSettingsPanel\(\);/, 'Save button must close only after successful persistence');
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
  assertMatch(rendererSrc, /function handleSidebarNavigation\(tab, \{ persist = true, restoreTarget = null, focusNav = true \} = \{\}\) \{/, 'sidebar navigation router missing');
  assertMatch(rendererSrc, /if \(tab === 'lib'\) \{[\s\S]*applyMainPanelVisibility\('lib'\);[\s\S]*handled = true;/s, 'LIB routing missing');
  assertMatch(rendererSrc, /if \(tab === 'sch'\) \{[\s\S]*applyMainPanelVisibility\('sch'\);[\s\S]*handled = true;/s, 'SCH routing missing');
  assertMatch(rendererSrc, /if \(tab === 'set'\) \{[\s\S]*openSettingsPanel\(\);[\s\S]*handled = true;/s, 'SET routing missing');
  assertMatch(rendererSrc, /if \(tab === 'help'\) \{[\s\S]*openHelpPanel\(restoreTarget\);[\s\S]*handled = true;/s, 'Help routing missing');
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
  assertMatch(rendererSrc, /els\.btnWidget\?\.addEventListener\('click', async \(\) => \{[\s\S]*const result = await api\.toggleWidget\?\.\(\);[\s\S]*Desktop widget shown[\s\S]*Desktop widget hidden/s, 'widget feedback must follow an acknowledged main-process state');
  assert(!rendererSrc.includes('Desktop widget toggled'), 'fire-and-forget widget success copy must not return');
  assertMatch(rendererSrc, /els\.btnCompanion\?\.addEventListener\('click', async \(\) => \{[\s\S]*if \(rc\?\.ready && rc\.url\)[\s\S]*Companion pairing page opened[\s\S]*handleSidebarNavigation\('set'\)/s, 'companion button must require verified readiness, avoid exposing the tokenized URL in feedback, and route Settings through the central navigation entry point (not a direct openSettingsPanel() bypass)');
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
  // Fire 06: one name for the wifi mode on both sides ('Same Wi-Fi').
  assertMatch(htmlSrc, /data-mode="wifi" id="btn-mode-wifi"[^>]*>Same Wi-Fi<\/button>/, 'the wifi mode button reads Same Wi-Fi');
  assert(!htmlSrc.includes('Connect Phone'), "no 'Connect Phone' left in index.html (the mode is called Same Wi-Fi)");
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
  // Fire 06: one lamp, the wordmark (the .pair-icon tile is gone).
  assert(!companionSrc.includes('pair-icon'), 'no pair-icon left in companion.html (markup or CSS)');
  assertMatch(companionSrc, /<polygon class="wm-beam" points="144,153\s+165,146\s+636,52\s+636,158"/, 'the wordmark beam carries class wm-beam');
  assertMatch(companionSrc, /<g class="wm-o" transform="translate\(467, 108\)">/, 'the wordmark O group carries class wm-o');
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
  assertMatch(mainSrc, /code: 'RUN_ACTIVE'/, 'remote generic start does not return structured RUN_ACTIVE rejection');
  assertMatch(mainSrc, /timerState\.running \|\| timerState\.paused \|\| ritualActive/, 'remote generic start does not reject while a run is active');
  assertMatch(mainSrc, /case 'getNightModes':/, 'handleCompanionMessage missing getNightModes case');
  assertMatch(mainSrc, /companion\.sendToClient\(client, \{ type: 'nightModes', modes: nmCatalogue \}\)/, 'getNightModes does not send catalogue via sendToClient');
});

check('companion: rejected remote commands return a structured result to the phone', () => {
  const companionSrc = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  assertMatch(mainSrc, /type: 'commandResult',[\s\S]*success: false,[\s\S]*code: 'RUN_ACTIVE'/, 'main must send commandResult RUN_ACTIVE on duplicate start');
  assertMatch(companionSrc, /data\.type === 'commandResult'[\s\S]*lastCommandResult = data[\s\S]*setPendingMessage\(data\.message \|\| 'The PC rejected the request', true\)/, 'PWA must surface commandResult rejections on the pending operation');
});

check('companion: phone timer actions are attributed on the desktop', () => {
  assertMatch(mainSrc, /function notifyRemoteAction\(message\)[\s\S]*showNativeNotification\('Lights Out', message\)[\s\S]*webContents\.send\('remote-action', \{ message \}\)/, 'main must emit native and renderer feedback for remote actions');
  assertMatch(mainSrc, /case 'start':[\s\S]*notifyRemoteAction\(`\$\{formatAction\(timerAction\)\} started from your phone/, 'remote timer start attribution missing');
  assertMatch(mainSrc, /case 'startNightMode':[\s\S]*notifyRemoteAction\(`\$\{resolution\.resolved\.nightModeTitle\} started from your phone/, 'remote Night Mode start attribution missing');
  assertMatch(mainSrc, /case 'togglePause':[\s\S]*Timer resumed from your phone[\s\S]*Timer paused from your phone/, 'remote pause/resume attribution missing');
  assertMatch(mainSrc, /case 'snooze':[\s\S]*Timer snoozed from your phone/, 'remote snooze attribution missing');
  assertMatch(mainSrc, /case 'cancel': \{[\s\S]*const wasActive = timerState\.running \|\| timerState\.paused;[\s\S]*cancelTimer\(\);[\s\S]*if \(wasActive\)[\s\S]*Timer cancelled from your phone/, 'remote cancel must preserve unconditional command execution while only reporting active cancellation');
  assertMatch(preloadSrc, /onRemoteAction: \(callback\) => \{[\s\S]*ipcRenderer\.on\('remote-action'/, 'preload remote-action bridge missing');
  assertMatch(rendererSrc, /api\.onRemoteAction\?\.\(data => \{[\s\S]*notify\(data\.message, 'info'\)/, 'renderer remote-action toast missing');
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
  assertMatch(htmlSrc, /id="btn-mode-wifi"[^>]*title="[^"]*Attempts to start/, 'Same Wi-Fi tooltip must describe an attempted, verified start rather than claim reachability');
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
  // P01: system info is no longer part of this Promise.all (its PowerShell
  // queries must not delay Test Mode truth); the same intent holds.
  assertMatch(rendererSrc, /const \[appSettings, lightConfig, wifiConfig, cbConfig, accConfig\] = await Promise\.all\(\[/, 'loadInitialData must fetch wifiGuard/contentBlocker/accountability via their own calls, not assume they are nested in appSettings');
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

// UI-R3 P11: the Proof hero is the page's own evidence, not an overlay: it has
// no dismiss controls, Escape never hides it, and it always states the mode.
check('morning proof: the Proof hero has no dismiss controls and always states Test Mode / REAL', () => {
  assert(!htmlSrc.includes('id="btn-proof-close"') && !htmlSrc.includes('id="btn-proof-dismiss"'), 'the Proof hero must not have Close / dismiss buttons');
  assert(!/btn-proof-close|btn-proof-dismiss|btnProofClose|btnProofDismiss|function dismissMorningProof/.test(rendererSrc), 'no dismiss wiring or els lookups for the Proof hero');
  assert(!/key === 'Escape'[^}]*morningProofSection/.test(rendererSrc), 'Escape must not hide the Proof hero');
  const receiptSrc = fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8');
  const truthFn = p03FnBody(receiptSrc, 'receiptTruth');
  assertMatch(truthFn, /if \(receipt && receipt\.dryRun\) return \{ text: 'TEST MODE · nothing ran'/, '#ns-proof-truth reads TEST MODE from receipt.dryRun first');
  const truthTexts = [...truthFn.matchAll(/text: [`']([^`']+)[`']/g)].map(m => m[1]);
  assert(truthTexts.length >= 4 && truthTexts.slice(1).every(t => t.startsWith('REAL ACTION')), `every non-dry-run path reads REAL ACTION, got ${truthTexts.join(' | ')}`);
  assert(/command sent/.test(truthFn) && (truthFn.match(/command sent/g) || []).length === 1 && /result === 'power_executed'\) return \{ text: `REAL ACTION · \$\{action\} command sent`/.test(truthFn), "'command sent' only for power_executed");
  const hero = p03FnBody(receiptSrc, 'renderMorningProof');
  assertMatch(hero, /truthEl\.textContent = truth\.text;/, 'renderMorningProof writes #ns-proof-truth for every receipt');
  assert(!/proofBadge\.style\.|\.style\.color|\.style\.borderColor/.test(hero), 'no style.color writes on #proof-badge (colour comes from data-tone)');
  assertMatch(htmlSrc, /<span class="ns-proof-truth" id="ns-proof-truth"><\/span>/, '#ns-proof-truth missing from the hero');
});

check('morning proof: Play Tonight Again still works', () => {
  assertMatch(rendererSrc, /document\.getElementById\('btn-proof-again'\)\?\.addEventListener\('click', \(\) => \{/, 'Play Tonight Again button missing');
  // UI-R3 Fire 10: Start from Proof lands on Tonight first, then delegates to
  // the shared start function; a refused navigation starts nothing, and
  // render() (not the handler) hides the hero while a run is active.
  assertMatch(rendererSrc, /getElementById\('btn-proof-again'\)\?\.addEventListener\('click', \(\) => \{\s*void handleSidebarNavigation\('lib', \{ persist: false \}\)\.then\(ok => \{ if \(ok === true\) startTonightPlan\(\); \}\);\s*\}\);/, 'Play Tonight Again navigates to Tonight, then delegates to the shared start function');
  const again = rendererSrc.slice(rendererSrc.indexOf("getElementById('btn-proof-again')"), rendererSrc.indexOf("getElementById('btn-proof-again')") + 300);
  assert(!/morningProofSection/.test(again), 'no manual hero hide in the Start from Proof handler');
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
  assertMatch(mainSrc, /if \(mode === 'wifi'\) \{[\s\S]*await companion\.start\(\{ token: rc\.token, host: lanIp, port, probeHost: lanIp \}\)/s, 'wifi mode must bind the selected LAN interface only');
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
  assertMatch(mainSrc, /await companionNetwork\.getDefaultRouteLanIp\(\)/, 'same-wifi host selection must read the OS route table, not an Internet hint');
  assertMatch(mainSrc, /code: 'RUN_ACTIVE'[\s\S]*A Lights Out run is already active/, 'family start must reject while a run is active');
  assertMatch(mainSrc.match(/function familyCommandHandler\([^]*?\n\}/)[0], /dryRun: Boolean\(appSettings\.dryRun\)[\s\S]*?case 'pause'/, 'family start must inherit the desktop Dry Run policy');
  assertMatch(mainSrc, /bindHost: lanIp/, 'family command server must bind the selected LAN interface');
  const familySrc = fs.readFileSync(path.join(root, 'family.js'), 'utf8');
  assertMatch(familySrc, /outcome && outcome\.success === false/, 'family command server must report real outcomes, not unconditional success');
  assertMatch(familySrc, /commandServer\.listen\(COMMAND_PORT, bindHost/, 'family command server must bind a specific host');
  assertMatch(mainSrc, /startCompanionNetworkMonitor\(\)/, 'network changes must trigger stale-pairing recovery');
  assertMatch(rendererSrc, /generation !== remoteQrGeneration \|\| els\.remoteUrl\?\.textContent !== url/, 'stale async QR results must be discarded');
  assertMatch(mainSrc, /shortCode: ready && rc\.token/, 'short code must remain hidden before readiness');
  assert(!/\n\s*token: rc\.token \|\| ''/.test(mainSrc), 'raw token must not be returned as a separate renderer field');
});

check('production truth: UI feedback follows observable state', () => {
  assertMatch(preloadSrc, /toggleWidget: \(\) => ipcRenderer\.invoke\('toggle-widget'\)/, 'widget must use acknowledged IPC');
  assertMatch(rendererSrc, /duplicate = \[\.\.\.container\.querySelectorAll\('\.toast'\)\][\s\S]*duplicate\._dismissTimer/, 'duplicate toasts must be coalesced');
  // UI-R1: the top Power/Settings/Help menus were removed -- the sidebar is
  // the single navigation authority. Guard the removal, the unified nav
  // model, and the new Tonight/session chrome.
  assert(!/main-menu|menu-power|menu-settings|menu-help|submenu-item/.test(htmlSrc), 'top-menu markup must not remain in index.html');
  assert(!/wireTopMenus|closeAllTopMenus/.test(rendererSrc), 'top-menu wiring must not remain in renderer.js');
  assertMatch(htmlSrc, /id="nav-lib" data-ns-tab="lib"/, 'nav items need stable ids for native targeting');
  assertMatch(htmlSrc, /id="nav-stats" data-ns-tab="stats"/, 'every nav item needs a stable id');
  assert((htmlSrc.match(/class="ns-nav-item/g) || []).length === 7, 'unified shell must have exactly 7 nav items');
  assertMatch(htmlSrc, /id="readiness-strip"/, 'Tonight must expose the readiness strip');
  for (const rdy of ['rdy-phone', 'rdy-lights', 'rdy-network', 'rdy-safety']) {
    assertMatch(htmlSrc, new RegExp(`id="${rdy}"`), `readiness strip missing ${rdy}`);
  }
  assertMatch(htmlSrc, /id="testmode-pill"/, 'TEST MODE/REAL ACTION truth pill must exist');
  assertMatch(rendererSrc, /TEST MODE · No PC power action will run/, 'TEST MODE pill must state the no-power-action truth');
  assertMatch(rendererSrc, /REAL ACTION · \$\{actionLabel\(\)\} will run at end/, 'REAL ACTION pill must name the real ending');
  assertMatch(htmlSrc, /class="snooze-chip" data-snooze="(300|900|1800)"/, 'explicit snooze chips must exist');
  // P06: #btn-snooze is the +5m segment, so the duplicate 300 s chip is gone.
  assert(!htmlSrc.includes('data-snooze="300"'), 'the duplicate data-snooze="300" chip must be removed (#btn-snooze is +5m)');
  assertMatch(htmlSrc, /<button class="action-btn secondary" id="btn-snooze" aria-label="Snooze 5 minutes">/, '#btn-snooze must be labelled "Snooze 5 minutes"');
  assertMatch(rendererSrc, /function updateReadiness/, 'readiness strip must be populated from real status sources');
  assertMatch(htmlSrc, /id="chk-graceful"/, 'Graceful Close must have a Settings checkbox (its only toggle was in the removed menu)');
  assertMatch(rendererSrc, /chkGraceful/, 'chk-graceful must be wired in renderer.js');
  assertMatch(rendererSrc, /if \(event\.defaultPrevented\) return;/, 'global shortcuts must not override handled keyboard navigation');
  const cssSrcForMenus = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert(!/\.menu-item|\.main-menu|\.submenu/.test(cssSrcForMenus), 'top-menu CSS must not remain in styles.css');
  assertMatch(cssSrcForMenus, /#9b93d6/i, 'Lights Out violet must be the product accent');
  assertMatch(rendererSrc, /notifDrawer\.classList\.toggle\('active', opening\)/, 'notification drawer must use the modal active state');
  assertMatch(mainSrc, /backgroundColor: '#0b0f14'/, 'main window needs a dark native background to prevent startup flash');
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

check('ui-r2: nav model is Tonight/Night Modes/Schedule/Devices/Proof with Settings/About as utilities', () => {
  const primary = htmlSrc.match(/<nav class="ns-sidebar-nav">([\s\S]*?)<\/nav>/);
  const utility = htmlSrc.match(/<div class="ns-sidebar-footer">([\s\S]*?)<\/div>/);
  assert(primary && utility, 'sidebar nav groups missing');
  const tabs = src => [...src.matchAll(/data-ns-tab="([a-z-]+)"/g)].map(m => m[1]).join(',');
  assert(tabs(primary[1]) === 'lib,modes,sch,devices,stats', `primary nav order wrong: ${tabs(primary[1])}`);
  assert(tabs(utility[1]) === 'set,help', `utility nav order wrong: ${tabs(utility[1])}`);
  assertMatch(htmlSrc, /<div class="ns-main-panel" id="ns-panel-devices" style="display:none">/, 'Devices must be a hidden-by-default main panel');
  assertMatch(rendererSrc, /if \(els\.panelDevices\) els\.panelDevices\.style\.display = panel === 'devices' \? '' : 'none';/, 'applyMainPanelVisibility must own the Devices panel');
  assertMatch(rendererSrc, /if \(tab === 'devices'\) \{[\s\S]*?applyMainPanelVisibility\('devices'\);[\s\S]*?handled = true;/, 'Devices routing missing');
  assertMatch(rendererSrc, /\['lib', 'modes', 'sch', 'devices', 'stats'\]\.includes\(tab\)/, 'Devices must persist as a restorable tab');
});

check('ui-r2: Devices shows only real local status and deep-links into owning Settings', () => {
  for (const id of ['device-card-pc', 'device-card-phone', 'device-card-family', 'device-card-lights', 'device-card-wifi']) {
    assertMatch(htmlSrc, new RegExp(`id="${id}"`), `Devices card missing: ${id}`);
  }
  const categories = new Set([...htmlSrc.matchAll(/class="settings-rail-btn" data-settings-category="([a-z-]+)"/g)].map(m => m[1]));
  const links = [...htmlSrc.matchAll(/data-devices-settings="([a-z-]+)"/g)].map(m => m[1]);
  assert(links.length >= 5, 'every device card needs a Settings deep-link');
  for (const link of links) assert(categories.has(link), `Devices deep-link targets unknown Settings category: ${link}`);
  const fnStart = rendererSrc.indexOf('async function renderDevicesPanel()');
  assert(fnStart > 0, 'renderDevicesPanel missing');
  const fnSrc = rendererSrc.slice(fnStart, rendererSrc.indexOf('\n}\n', fnStart));
  for (const source of ['getRemoteControl', 'getSmartLightConfig', 'getWifiGuardSettings', 'getFamilyPeers', 'getSystemInfo']) {
    assert(fnSrc.includes(`api.${source}`), `Devices must read ${source}`);
  }
  assert(!/routerPass|webhookHeaders|hueUsername|token/.test(fnSrc), 'Devices must never read secret-bearing fields');
  assert(!/Math\.random|fake|placeholder/i.test(fnSrc), 'Devices must not fabricate status');
  // Companion/system status cards moved here: their ids must exist exactly once.
  for (const id of ['stats-companion-status', 'battery-level', 'power-plan', 'action-name', 'end-time', 'warning-card']) {
    assert((htmlSrc.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1, `${id} must exist exactly once`);
  }
});

check('ui-r2: brand lockup uses the real wordmark and logo-derived motifs', () => {
  // UI-R3 P07: the real wordmark is inlined (two stacked copies of its art
  // box) so the lamp and the broken O can live. The asset stays: About and
  // the tray use it.
  const wmAt = htmlSrc.indexOf('<span class="brand-wordmark" id="brand-wordmark" role="img" aria-label="Lights Out">');
  assert(wmAt > 0, 'header must use the inline living wordmark (span.brand-wordmark role=img aria-label="Lights Out")');
  const wm = htmlSrc.slice(wmAt, htmlSrc.indexOf('</span>', wmAt));
  assertMatch(wm, /<svg class="wm-static" viewBox="44 88 556 116" aria-hidden="true" focusable="false">/, 'svg.wm-static missing');
  assertMatch(wm, /<svg class="wm-live" viewBox="44 88 556 116" aria-hidden="true" focusable="false">/, 'svg.wm-live missing');
  assert(wm.indexOf('class="wm-static"') < wm.indexOf('class="wm-live"'), 'svg.wm-live must stack above svg.wm-static');
  assert(!/\sfilter=|<filter\b|href=|<use\b|<image\b|<title\b|<text\b/.test(wm), 'the inline wordmark has no SVG filter, href, use, image, title or text');
  for (const id of ['wm-beam', 'wm-lamp', 'wm-lamp-hl', 'wm-lamp-glow']) {
    assert((htmlSrc.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1, `gradient #${id} must appear exactly once`);
  }
  assert(!/id="(?!wm-)[^"]+"/.test(wm.replace('id="brand-wordmark"', '')), 'every id inside the wordmark is wm- prefixed');
  const liveSvg = wm.slice(wm.indexOf('class="wm-live"'));
  for (const cls of ['wm-beam', 'wm-rim', 'wm-lens', 'wm-o-track', 'wm-o-halo', 'wm-o-live', 'wm-o-sparks']) assert(liveSvg.includes(`class="${cls}"`), `svg.wm-live missing .${cls}`);
  assertMatch(liveSvg, /<g class="wm-o" transform="translate\(460, 108\)">/, 'the O sits at translate(460,108): 7 units left of the asset so its 6-unit stroke and halo clear the U (Fire 03)');
  assertMatch(liveSvg, /class="wm-o-halo"[^>]*pathLength="100"/, 'the O halo uses pathLength 100');
  assertMatch(liveSvg, /class="wm-o-live"[^>]*pathLength="100"/, 'the live O uses pathLength 100');
  const staticSvg = wm.slice(0, wm.indexOf('class="wm-live"'));
  for (const cls of ['wm-lamp', 'wm-lights']) assert(staticSvg.includes(`class="${cls}"`), `svg.wm-static missing .${cls}`);
  assert(fs.existsSync(path.join(root, 'assets', 'brand', 'lights-out-wordmark-transparent.svg')), 'wordmark asset missing');
  assertMatch(rendererSrc, /document\.body\.style\.setProperty\('--lights-level', lightLevel\.toFixed\(3\)\);\s*(?:\/\/[^\n]*\n\s*)*document\.body\.style\.setProperty\('--session-ratio'/, 'the renderer sets --session-ratio next to --lights-level');
  const wmCss = p03CssRules(fs.readFileSync(path.join(root, 'styles.css'), 'utf8'));
  for (const r of wmCss) {
    if (!/\.wm-static\b/.test(r.selector)) continue;
    assert(!/(^|;)\s*(animation|transition)(-[a-z-]+)?\s*:/.test(r.body), `no rule under .wm-static may animate or transition (${r.selector})`);
  }
  assertMatch(htmlSrc, /<div class="night-env" aria-hidden="true">/, 'night environment layer must be decorative (aria-hidden)');
  assertMatch(htmlSrc, /<g class="ring-head" id="ring-head">/, 'ring particle head missing');
  assertMatch(rendererSrc, /els\.ringHead\.style\.transform = `rotate\(/, 'ring head must follow the arc');
  assertMatch(rendererSrc, /document\.body\.style\.setProperty\('--lights-level'/, 'beam must dim with the session');
  // A filtered SVG arc renders a visible box behind the ring; the default
  // glow style must stay filter-free.
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assertMatch(css, /\.ring-progress,\s*body\[data-ring="glow"\] \.ring-progress \{[^}]*filter: none;/, 'default ring arc must not use an SVG filter');
});

check('ui-r2: emoji chrome removed from primary controls', () => {
  const emoji = /&#x1F[0-9A-F]{3};|&#x2[3-7][0-9A-F]{2};|[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}]/u;
  const chips = htmlSrc.match(/<div class="action-chips-row"[\s\S]*?<\/div>/)[0];
  assert(!emoji.test(chips), 'action chips must use SVG glyphs, not emoji');
  // P06: the console opens with a session head, so capture through the end
  // of the #btn-stop button and prove every control is inside the capture.
  const runBarAt = htmlSrc.indexOf('<div class="action-bar" id="action-bar-running"');
  const stopAt = htmlSrc.indexOf('id="btn-stop"', runBarAt);
  assert(runBarAt >= 0 && stopAt > runBarAt, 'running action bar or #btn-stop missing');
  const runBar = htmlSrc.slice(runBarAt, htmlSrc.indexOf('</button>', stopAt) + '</button>'.length);
  for (const id of ['btn-pause', 'btn-snooze', 'btn-stop']) assert(runBar.includes(`id="${id}"`), `running action bar capture must contain #${id}`);
  assert(!emoji.test(runBar), 'running action bar must use SVG glyphs, not emoji/media symbols');
  const footer = htmlSrc.match(/<div class="footer-right">[\s\S]*?<\/div>/)[0];
  assert(!emoji.test(footer), 'footer actions must use SVG glyphs, not emoji');
  const nmSrc = fs.readFileSync(path.join(root, 'renderer-night-modes.js'), 'utf8');
  assert(!/'\\u\{1F[0-9A-F]{3}\}'/.test(nmSrc), 'Night Mode artwork must be SVG glyphs, not emoji');
});

check('ui-r2: reduced motion is one global contract', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const block = css.match(/\/\* -- Reduced motion: one global contract[\s\S]*$/);
  assert(block, 'global reduced-motion block missing');
  assertMatch(block[0], /@media \(prefers-reduced-motion: reduce\)/, 'reduced-motion media query missing');
  assertMatch(block[0], /\*\s*,\s*\*::before/, 'reduced motion covers all app surfaces');
  assertMatch(block[0], /\.night-beam::after,\s*\.night-particles,\s*\.ns-preview-orbit,\s*\.device-card \.dev-dot::after \{ animation: none !important; \}/, 'decorative loops must be removed under reduced motion');
  // Idle-cost guard: no per-frame CSS animation on SVG children of the clock.
  assertMatch(css, /\.analog-clock\.sweep \.analog-hand\.second \{ animation: none; \}/, 'second-hand glide must not be a per-frame SVG CSS animation');
  assertMatch(rendererSrc, /secondHandGlideTimer = setInterval\(beat, 125\);/, 'second-hand glide must run at 8 beats/s');
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
  assert(humanizeReceiptResult('dry_run_completed') === 'Test Mode Completed', 'dry_run_completed should read "Test Mode Completed"');
  assert(humanizeReceiptResult('cancelled') === 'Cancelled', 'cancelled should read "Cancelled"');
  assert(humanizeReceiptResult(null) === 'Unknown', 'null/undefined result should read "Unknown", not crash');
  // Unmapped codes still get title-cased with underscores turned to spaces,
  // instead of leaking a raw snake_case enum into "proof" a user reads.
  assert(humanizeReceiptResult('some_new_result') === 'Some New Result', 'unmapped codes should title-case, not leak snake_case');

  // And confirm both clipboard-copy call sites actually use it instead of
  // the raw result/timestamp fields (the bug this fixes).
  // UI-R3 Fire 10: Copy proof builds its text in renderer-receipts.js
  // (buildProofText: the truth line first, the tone title as Result, never a
  // bare 'Completed' for Test Mode; behaviour in test/proof-evidence.test.js).
  const receiptsOnly = fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8');
  const coreOnly = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  assertMatch(receiptsOnly, /function buildProofText\(receipt\) \{/, 'renderer-receipts.js defines buildProofText');
  assertMatch(coreOnly, /const text = buildProofText\(receipt\);/, 'the Copy Proof handler calls buildProofText(...)');
  assert(!/Lights Out - Morning Proof/.test(coreOnly), 'the stale Copy Proof template is gone');
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
  // P03: fullscreen never hides truth. A run never stays behind the clock,
  // Space leaves it before starting/pausing, and the pill is never hidden.
  assertMatch(rendererSrc, /const idleClockVisible = [^\n]*\n[\s\S]{0,400}?if \(state\.fullscreenClock && !isIdle && !fullscreenExitPending\) \{ fullscreenExitPending = true; exitFullscreenClock\(\); \}/, 'render() must leave the fullscreen clock as soon as a session is active');
  assertMatch(rendererSrc, /function applyFullscreenClockState\(isFullScreen\) \{[\s\S]{0,200}?if \(!state\.fullscreenClock\) fullscreenExitPending = false;/, 'the exit guard must reset when fullscreen actually ends');
  assertMatch(rendererSrc, /event\.code === 'Space'\) \{[\s\S]{0,250}?if \(spaceOwnedByFocus\(event\.target\) \|\| timerShortcutSurfaceBlocked\(\)\) return;\s*event\.preventDefault\(\);[\s\S]{0,200}?if \(state\.fullscreenClock\) exitFullscreenClock\(\);\s*if \(state\.running \|\| state\.paused\) togglePause\(\);/, 'Space must yield to a focused button / onboarding / an open dialog, then leave the fullscreen clock before it starts or pauses');
  assertMatch(rendererSrc, /presets\[event\.key\] && !state\.running && !state\.paused && !timerShortcutSurfaceBlocked\(\)/, 'preset shortcuts 1-6 must not start a run behind onboarding or an open dialog');
  assertMatch(rendererSrc, /function exitFullscreenClock\(\) \{[\s\S]{0,400}?setTimeout\([\s\S]{0,200}?fullscreenExitPending = false; render\(\);/, 'a lost fullscreen-exit IPC must be retried, not leave the run behind the clock');
  const fsCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert(fsCss.includes('body.fullscreen-clock-mode #ns-panel-lib > *:not(.timer-section):not(#testmode-pill),'), 'fullscreen must keep the Test Mode / REAL pill visible');
  assertMatch(fsCss, /body\.fullscreen-clock-mode #testmode-pill \{[^}]*position: fixed;[^}]*opacity: 1;[^}]*transition: none;[^}]*animation: none;/, 'the fullscreen pill must be fixed, full opacity and static');

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
  assertMatch(rendererSrc, /function enterFullscreenClock\(\) \{\s*[\s\S]*?handleSidebarNavigation\('lib', \{ persist: false, focusNav: false \}\);/, 'enterFullscreenClock must force the lib panel active (without a rail focus ring) before entering fullscreen');
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

// UI-R3 P01: every start path honors Test Mode, one run at a time, and live
// state tells the truth.
check('P01 truth: start paths, single run, and truthful live surfaces', () => {
  const fnBody = (src, name) => {
    const head = src.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
    assert(head, `function ${name} missing`);
    let i = head.index + head[0].length;
    let parens = 1;
    for (; i < src.length && parens > 0; i++) {
      if (src[i] === '(') parens++;
      else if (src[i] === ')') parens--;
    }
    i = src.indexOf('{', i);
    const start = i;
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1);
  };
  const calSrc = fs.readFileSync(path.join(root, 'renderer-calendar.js'), 'utf8');
  const autopilotSrc = fs.readFileSync(path.join(root, 'autopilot.js'), 'utf8');
  const widgetSrc = fs.readFileSync(path.join(root, 'widget.html'), 'utf8');
  const companionSrc = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');

  // Test Mode on every start path.
  assertMatch(mainSrc, /if \(typeof input === 'number'\) \{[\s\S]{0,400}dryRun: Boolean\(\(settingsStore\.getSection\('app'\) \|\| \{\}\)\.dryRun\)/, 'numeric normalize branch must inherit Test Mode');
  assertMatch(mainSrc, /const app = settingsStore\.getSection\('app'\) \|\| \{\};\s*const config = ritualMode\.getConfig\(\);\s*beginValidatedCountdown\(\s*\{[^}]*dryRun: Boolean\(app\.dryRun\)[^}]*gracePeriod:[^}]*\}/, 'manual ritual fallback must carry dryRun and gracePeriod');
  const begin = fnBody(mainSrc, 'beginValidatedCountdown');
  const dryAssignments = begin.match(/timerState\.dryRun = [^;]*;/g) || [];
  assert(dryAssignments.length === 1 && /^timerState\.dryRun = typeof options\.dryRun === 'boolean' \?/.test(dryAssignments[0]), 'beginValidatedCountdown must assign dryRun only through a typeof boolean check');
  const fireIndex = autopilotSrc.indexOf('autopilotTimeout = setTimeout(');
  assert(fireIndex > 0 && /settingsStore\.getSection\('app'\)/.test(autopilotSrc.slice(fireIndex, autopilotSrc.indexOf('}, msUntilTarget);', fireIndex))), 'autopilot must read app settings inside the timeout');

  // One run at a time.
  const start = fnBody(mainSrc, 'startTimer');
  assert(start.indexOf("code: 'RUN_ACTIVE'") > 0 && start.indexOf("code: 'RUN_ACTIVE'") < start.indexOf('resolveStartDecision'), 'startTimer needs the RUN_ACTIVE guard before resolveStartDecision');
  const quick = fnBody(mainSrc, 'startQuickTimer');
  assert(quick.indexOf('isRunActive()') > 0 && quick.indexOf('isRunActive()') < quick.indexOf('startTimer('), 'startQuickTimer must check isRunActive() before startTimer');
  assertMatch(quick, /if \(result && result\.success\) \{[\s\S]*timer started\. Nothing will power off\./, 'startQuickTimer may announce a start only inside its success branch');
  assert(!/started/.test(quick.slice(0, quick.indexOf('if (result && result.success)'))), 'nothing may say "started" before the success check');
  for (const key of ['L', '1', '2', '3', '4']) {
    const reg = mainSrc.indexOf(`globalShortcut.register('Ctrl+Shift+${key}'`);
    assert(reg > 0, `Ctrl+Shift+${key} missing`);
    const handler = mainSrc.slice(reg, mainSrc.indexOf('\n  });', reg));
    assert(/startQuickTimer\(/.test(handler) && !/\bstartTimer\(/.test(handler), `Ctrl+Shift+${key} must go through startQuickTimer`);
  }
  assertMatch(mainSrc, /label: 'Start 28 min', click: \(\) => startQuickTimer\(/, 'tray 28 min must go through startQuickTimer');
  assertMatch(mainSrc, /label: 'Start 1 hour', click: \(\) => startQuickTimer\(/, 'tray 1 hour must go through startQuickTimer');
  assertMatch(mainSrc, /ipcMain\.handle\('ritual-start'[\s\S]{0,400}if \(timerState\.running \|\| timerState\.paused\) return \{ active: false, reason: 'run-active' \};/, 'ritual-start must refuse while a countdown is active');
  const cal = fnBody(mainSrc, 'checkCalendarAutoStart');
  assertMatch(cal, /if \(isRunActive\(\)\) return;/, 'calendar auto-start must use isRunActive()');
  assertMatch(cal, /startTimer\(\{[^}]*dryRun: Boolean\(appSettings\.dryRun \|\| profile\?\.dryRun \|\| event\.testMode\)/, 'calendar auto-start must preserve app, routine or per-rule Test Mode');

  // Truthful OS surfaces.
  assertMatch(mainSrc, /setTaskbarProgress\(percent, !timerState\.dryRun && percent <= 10 \? 'error' : 'normal'\);/, 'red taskbar must be gated on a REAL run');
  assertMatch(mainSrc, /trayIcons = \{\s*idle:[^}]*test:[^}]*real:[^}]*\};/, 'tray icons need test and real keys');
  assertMatch(mainSrc, /trayIcons = \{ idle: base, test: base, real: base \};/, 'tray icon fallback needs test and real keys');
  assertMatch(mainSrc, /Nothing will power off\.`\s*: `\$\{formatAction\(timerState\.action\)\} in \$\{timerState\.gracePeriod\} minutes`/, 'warning must have a dryRun branch');
  assertMatch(fnBody(mainSrc, 'updateWidget'), /\bdryRun,/, 'updateWidget must send dryRun');
  assert(!/&#x1F534;|&#x263E;|@keyframes pulse/.test(widgetSrc), 'widget must use the SVG ring, no emoji, no pulse');
  assertMatch(widgetSrc, /data\.dryRun/, 'widget must read data.dryRun');
  assert(!/innerHTML/.test(widgetSrc), 'widget writes text with textContent only');
  assert(!rendererSrc.includes('`${actionLabel()} started.`'), 'renderer must not send a duplicate completion notification');

  // One honest Schedule start: api.startTimer( only inside startFromScheduleEvent.
  const schedStart = fnBody(calSrc, 'startFromScheduleEvent');
  const calStartCount = (calSrc.match(/api\.startTimer\(/g) || []).length;
  const insideCount = (schedStart.match(/api\.startTimer\(/g) || []).length;
  assert(insideCount === 1 && calStartCount === insideCount, 'api.startTimer( may appear only inside startFromScheduleEvent');
  assertMatch(schedStart, /const dryRun = Boolean\(state\.dryRun \|\| profile\?\.dryRun \|\| evt\.testMode\);/, 'Schedule start preserves app, assigned routine or per-rule Test Mode');
  assertMatch(schedStart, /api\.startTimer\(\{[^}]*dryRun,/, 'Schedule start passes the resolved Test Mode value');
  assert(/forceShutdown: false/.test(schedStart) && !/forceShutdown: (?!false)/.test(schedStart), 'Schedule start never enables forced shutdown');

  // Renderer truth state.
  assertMatch(rendererSrc, /document\.getElementById\('snooze-tax-modal'\)\?\.classList\.contains\('active'\)\) \{\s*document\.getElementById\('btn-snooze-tax-cancel'\)\?\.click\(\);/, 'Escape on the snooze-tax modal must resolve it via its cancel button');
  assertMatch(rendererSrc, /settingsLoaded: false,/, 'state must start with settingsLoaded false');
  const rStart = fnBody(rendererSrc, 'startTimer');
  assert(rStart.indexOf('if (!state.settingsLoaded)') > 0 && rStart.indexOf('if (!state.settingsLoaded)') < rStart.indexOf('SoundSystem.playStart'), 'renderer startTimer must return early until settings load');
  assertMatch(rendererSrc, /els\.body\.classList\.toggle\('test-mode', state\.settingsLoaded && state\.dryRun === true\);\s*els\.body\.classList\.toggle\('real-action', state\.settingsLoaded && state\.dryRun === false\);/, 'render() must toggle test-mode and real-action');
  const ringLabel = fnBody(rendererSrc, 'countdownRingLabel');
  assertMatch(ringLabel, /if \(state\.dryRun\) return[\s\S]*Test ends/, 'Test Mode countdown must label the test end without promising a power action');
  assertMatch(rendererSrc, /state\.running \|\| state\.paused \? countdownRingLabel\(\)/, 'running ring must use the authoritative end-time label');
  // Fire 05 migrated the phone label to 'Test · no …' / 'then …' (phoneRingLabel), still keyed on the run's own dryRun.
  assertMatch(companionSrc, /if \(dryRun === true\) return `Test · no \$\{words \? words\.noun : 'power action'\}`;\s*if \(dryRun === false\) return words \? `then \$\{words\.verb\}` : 'until end';/, "companion's 'then …' template must sit inside a dryRun === false conditional");
  assertMatch(companionSrc, /timerLabel\.textContent = phoneRingLabel\(running, paused, data\.dryRun, data\.action\);/, "companion's ring label must read the run's own data.dryRun");
  const readiness = fnBody(rendererSrc, 'updateReadinessSafety');
  assertMatch(fnBody(rendererSrc, 'updateReadiness'), /updateReadinessSafety\(\);/, 'updateReadiness must still refresh the Safety tile');
  assert(!/'Clear'/.test(readiness), "readiness Safety must not say 'Clear'");
  assertMatch(readiness, /classList\.toggle\('real',/, 'readiness Safety must toggle real');
  assertMatch(fnBody(rendererSrc, 'renderDevicesPanel'), /classList\.toggle\('real',/, 'Devices PC mode must toggle real');
  assert(!rendererSrc.includes('AC Power'), "renderer must never infer 'AC Power'");
  assert(!companionSrc.includes('Plugged In'), "companion must never infer 'Plugged In'");
  // P01's own block ends at the next UI-R3 package block (or the global
  // reduced-motion contract), so later packages' blocks are judged by their own checks.
  const p01Css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8').match(/\/\* -- UI-R3 · P01[\s\S]*?(?=\/\* -- UI-R3 · P(?!01)|\/\* -- Reduced motion: one global contract)/);
  assert(p01Css && !/animation|transition/.test(p01Css[0].replace(/\/\*[\s\S]*?\*\//g, '')), 'P01 truth CSS must be static');
});

// UI-R3 P02: the routine record counts only real completions, and partner
// messages never report a Test Mode run as a success.
check('P02 records: only real completions count; Test Mode never leaves as a success', () => {
  const completeBody = mainSrc.match(/async function completeTimer\(\) \{[\s\S]*?\n\}\n/);
  assert(completeBody, 'completeTimer not found');
  const body = completeBody[0];
  assertMatch(body, /if \(!timerState\.dryRun\) \{\s*try \{ streaks\.recordEvent\(null, timerState\.action, Boolean\(rec && rec\.snoozeCount > 0\)\)[\s\S]*?sleepDebt\.recordNight\([\s\S]*?\n {2}\}\n/, 'completeTimer must guard recordEvent and recordNight with !timerState.dryRun and pass the receipt snooze flag');
  assert((body.match(/streaks\.recordEvent\(/g) || []).length === 1 && (body.match(/sleepDebt\.recordNight\(/g) || []).length === 1, 'completeTimer must record streak/deficit exactly once (inside the guard)');
  assertMatch(body, /runReceipts\.getReceiptById\(activeReceiptId\)/, 'completeTimer must read the receipt for the real snooze flag');
  assertMatch(body, /await playLastLightRitual\(timerState\.dryRun\);\s*await executePowerAction\(\{ \.\.\.timerState \}\);\s*\}\s*$/, 'playLastLightRitual-then-executePowerAction order changed');
  assert(body.indexOf("result: timerState.dryRun ? 'dry_run_completed' : 'completing'") > body.indexOf('if (!timerState.dryRun) {'), 'receipt update must stay unconditional after the guard');

  const overrideSrc = fs.readFileSync(path.join(root, 'emergencyOverride.js'), 'utf8');
  assertMatch(overrideSrc, /if \(!timerState\?\.dryRun\) \{[\s\S]*?streaks\.recordEvent\(null, 'override', true\)[\s\S]*?sleepDebt\.recordNight\(/, 'executeOverride must skip streak and deficit records in Test Mode');
  assertMatch(overrideSrc, /testMode: timerState\?\.dryRun === true/, 'executeOverride must pass testMode to the partner OVERRIDE message');

  const streaksSrc = fs.readFileSync(path.join(root, 'streaks.js'), 'utf8');
  const streaksMod = require(path.join(root, 'streaks.js'));
  assert(typeof streaksMod.nightKey === 'function' && typeof streaksMod.currentStreak === 'function', 'streaks.js must export nightKey and currentStreak');
  assertMatch(streaksSrc, /function getSummary\(\) \{[\s\S]*?streak: currentStreak\(data\.events\)/, 'getSummary must compute the streak at read time');
  assertMatch(streaksSrc, /function checkAchievements\(data\) \{[\s\S]*?const unlocked = \[\];/, 'checkAchievements must start from an empty list');
  assert(!/data\.achievements \|\| \[\]/.test(streaksSrc), 'stale stored achievements must never be unioned or returned');
  // Legacy events (no source) are never deleted: recordEvent replaces only an
  // earlier REAL event for the same night key.
  assertMatch(streaksSrc, /function recordEvent\([\s\S]*?data\.events = data\.events\.filter\(e => !\(e && e\.source === 'real' && e\.date === tonight\)\)/, 'recordEvent must only replace same-night REAL events, never legacy ones');
  assertMatch(streaksSrc, /function buildWeeklyNarrative[\s\S]*?Object\.entries\(report\.realActionCounts/, 'Real-mode completions must come from source:real events only');
  // Counts are per night, never per event: legacy UTC-keyed events map to
  // their local night at read time, so a week can never read "8 of the last 7".
  assertMatch(streaksSrc, /function getWeeklyReport\([\s\S]*?const counted = countedNights\(data\.events\);/, 'getWeeklyReport must count nights, not events');
  // Owner decision: no one-time reconciliation rewrites existing streak data.
  assert(!/reconcileWithReceipts/.test(mainSrc + streaksSrc), 'no one-time streak reconciliation (owner decision)');

  assertMatch(rendererSrc, /function showStreakCelebration\(count\) \{\s*\/\/[^\n]*\n\s*if \(state\.dryRun \|\| !\(Number\(count\) >= 1\)\) return;/, 'showStreakCelebration must refuse Test Mode and non-streaks');

  const accSrc = fs.readFileSync(path.join(root, 'accountability.js'), 'utf8');
  for (const legacy of ['#5b8cff', '#4caf50', '#ff4d4d', '#ff9800', '#d4a50a']) {
    assert(!accSrc.toLowerCase().includes(legacy), `accountability.js still uses off-grammar colour ${legacy}`);
  }
  assertMatch(mainSrc, /function sendAccountability[\s\S]*?testMode: timerState\.dryRun === true/, 'sendAccountability must pass testMode');
  const acc = require(path.join(root, 'accountability.js'));
  const testComplete = acc.describeEvent('TIMER_COMPLETE', true);
  assert(testComplete.label.startsWith('Test Mode: ') && !/Completed/.test(testComplete.label) && testComplete.icon !== '✅', 'Test Mode completion must never say Completed');
  for (const id of Object.keys(acc.EVENTS)) {
    assert(acc.describeEvent(id, true).label.startsWith('Test Mode: '), `Test Mode ${id} label must be prefixed`);
  }
  assert(acc.describeEvent('TIMER_COMPLETE', false).label === 'Completed', 'REAL completion keeps its wording');
});

// UI-R3 P03: nothing hides or misstates Test Mode / REAL during a session or
// at first run; nothing on screen is fabricated.
function p03FnBody(src, name) {
  const head = src.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  assert(head, `function ${name} missing`);
  let i = src.indexOf('{', src.indexOf(')', head.index + head[0].length - 1));
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
// Fire-pass block convention: a package CSS block runs from its marker to the
// next package block marker ("/* -- UI-R3 · " or "/* -- F<digit>"), or to the
// reduced-motion contract, so each block is judged only by its own checks.
function cssBlockEnd(css, at) {
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  const re = /\/\* -- (?:UI-R3 · |F\d)/g;
  re.lastIndex = at + 6;
  const m = re.exec(css);
  return m && m.index < rmAt ? m.index : rmAt;
}
function p03CssRules(css) {
  const rules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) rules.push({ selector: m[1].trim(), body: m[2] });
  return rules;
}
check('P03 truth: honest finale, footer truth bar, real hero facts, honest About and first run', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const emoji = /&#x1F[0-9A-F]{3};|&#x2[3-7][0-9A-F]{2};|[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}]/u;

  // Last Light: no fabricated telemetry, no fake cancel, truth set first.
  assert(!htmlSrc.includes('GRID STABILITY') && !htmlSrc.includes('id="ll-stat-value"'), 'Last Light must not show fabricated telemetry');
  assert(!/EMERGENCY CANCEL[\s\S]{0,80}Ctrl\+Shift\+S/.test(htmlSrc), 'Last Light must not advertise Ctrl+Shift+S (show/hide) as a cancel');
  const stage = htmlSrc.slice(htmlSrc.indexOf('<div class="ll-stage">'), htmlSrc.indexOf('<div class="ll-panel-right">'));
  assert(stage.includes('id="ll-truth"'), '#ll-truth must live inside .ll-stage (visible in mini mode)');
  const play = p03FnBody(rendererSrc, 'playLastLight');
  const truthAt = play.indexOf("getElementById('ll-truth')");
  assert(truthAt > 0 && truthAt < play.indexOf("classList.add('active')"), 'playLastLight must set #ll-truth before the overlay becomes active');
  assertMatch(play, /const mode = dryRun \? 'test' : 'real';/, 'the finale mode must come from the payload dryRun');
  assertMatch(play, /llTruth\.dataset\.mode = mode;/, '#ll-truth data-mode must follow the payload');
  assertMatch(p03FnBody(mainSrc, 'playLastLightRitual'), /action: timerState\.action,/, 'the play-last-light payload must carry the real action');
  const preview = mainSrc.slice(mainSrc.indexOf("globalShortcut.register('Ctrl+Shift+P'"), mainSrc.indexOf("globalShortcut.register('Ctrl+Shift+Space'"));
  assertMatch(preview, /dryRun: true,[\s\S]*action:/, 'the Ctrl+Shift+P preview stays dryRun and names the configured action');

  // Truth bands and the footer truth bar.
  assertMatch(rendererSrc, /document\.querySelectorAll\('\[data-truth-band\]'\)/, 'render() must write the truth bands');
  assertMatch(rendererSrc, /pill\.dataset\.truth = !state\.settingsLoaded \? 'checking' : \(state\.dryRun \? 'test' : 'real'\);/, 'render() must set the footer data-truth from settingsLoaded and state.dryRun');
  assertMatch(htmlSrc, /<button type="button" class="status-pill" id="status-pill">/, '#status-pill must be a button');
  const statusText = (htmlSrc.match(/<span[^>]*id="status-text"[^>]*>/) || [''])[0];
  assert(statusText && !/role=|aria-live/.test(statusText), '#status-text must carry no role=status / aria-live (#testmode-pill is the one truth live region)');
  assert(htmlSrc.includes('id="status-time"'), '#status-time missing');
  const clickAt = rendererSrc.indexOf("els.statusPill?.addEventListener('click'");
  assert(clickAt > 0, 'footer pill click handler missing');
  const click = rendererSrc.slice(clickAt, rendererSrc.indexOf('\n});', clickAt));
  assert(click.includes("openSettingsCategory('power-safety')") && !/state\.dryRun\s*=[^=]/.test(click), 'the footer pill opens Power & Safety and never changes the mode itself');
  assertMatch(rendererSrc, /pill\.disabled = !state\.settingsLoaded \|\| \(!isIdle && tonightVisible\);/, 'the footer pill is enabled with settings loaded, and mid-run only while Tonight is off screen (Fire 03)');
  // UI-R3 Fire 02: the outcome is a word in the time slot; the mode stays in #status-text.
  assertMatch(rendererSrc, /dryrun: \{ cls: 'dryrun', slot: 'Done' \}/, 'a Test Mode completion is never shown as a green success');
  assertMatch(rendererSrc, /completed: \{ cls: state\.dryRun \? 'dryrun' : 'complete', slot: 'Done' \}/, "'complete' is only ever a REAL completion");
  assertMatch(css, /\.status-pill\.dryrun \{[^}]*color: var\(--accent-amber\)/, '.status-pill.dryrun must be amber');
  assert(!/\.status-pill\.[a-z]+ \.status-dot \{[^}]*statusPulse/.test(css), 'footer status dots must not pulse');
  assertMatch(htmlSrc, /id="notif-badge" style="display:none"/, '#notif-badge keeps its inline display:none (renderer shows it by clearing it)');
  const badgeRules = p03CssRules(css).filter(r => /(^|[\s,])\.notif-badge\b/.test(r.selector));
  assert(badgeRules.length > 0 && badgeRules.every(r => !/display:\s*none/.test(r.body)), '.notif-badge CSS must not hide the badge');

  // Tonight hero: no fabricated facts.
  assert(!htmlSrc.includes('ns-meta-clearance') && !htmlSrc.includes('Tomorrow morning'), 'hero must not show fabricated Clearance / Proof facts');
  assertMatch(p03FnBody(rendererSrc, 'renderTonightHero'), /getElementById\('ns-meta-ending'\)[\s\S]*endingEl\.textContent = actionLabel\(effectiveAction\)/, 'renderTonightHero must write the real ending');

  // About: true copy, readable by assistive tech, no emoji.
  // Anchored on the id: P05 gave the container role=dialog attributes.
  const about = htmlSrc.slice(htmlSrc.indexOf('<div class="modal" id="about-modal"'), htmlSrc.indexOf('<!-- Last Light finale overlay -->'));
  for (const stale of ['Bedtime shutdown timer for Windows', 'FINAL CONFIRM', 'LOCAL ONLY', 'Everything stays on this PC', 'Instantly']) {
    assert(!about.includes(stale), `About must not claim "${stale}"`);
  }
  assertMatch(about, /<ul class="about-guarantees">/, 'About guarantees missing (and must not be aria-hidden)');
  assert(!emoji.test(about), 'About must use SVG glyphs, not emoji');

  // Wind-down darkens the room, not the truth.
  for (const r of p03CssRules(css)) {
    if (/\.cockpit\b/.test(r.selector) && /warm-shift|phase-dim|phase-lastlight/.test(r.selector)) {
      assert(!/filter:\s*(?!none)/.test(r.body), `no wind-down rule may filter .cockpit (${r.selector})`);
    }
  }
  assertMatch(css, /--env-dark: min\((?:0)?\.45,/, '--env-dark must be capped at .45');
  assert(!mainSrc.includes('0.55 + 0.45'), 'the dim-phase window must not fade to 0.55');
  assert(!/document\.body\.style\.filter = `/.test(rendererSrc), 'First Light must not filter the whole body');

  // First run states the power truth.
  const onboarding = htmlSrc.slice(htmlSrc.indexOf('id="onboarding"'), htmlSrc.indexOf('<!-- Main Cockpit Container -->'));
  assert(onboarding.includes('id="onboard-mode"') && onboarding.includes('data-run-mode="test"') && onboarding.includes('data-run-mode="real"'), 'onboarding must offer both run modes');
  assert(!onboarding.includes('aria-pressed="true"'), 'no run mode may be preselected');
  const step1 = onboarding.slice(onboarding.indexOf('id="onboard-step-1"'), onboarding.indexOf('id="onboard-step-2"'));
  assert(!step1.includes('&#x1F319;'), 'onboarding hero must be the lamp, not a moon emoji');
  const onboardSrc = fs.readFileSync(path.join(root, 'renderer-onboarding-updater.js'), 'utf8');
  assertMatch(p03FnBody(onboardSrc, 'hideOnboarding'), /app\.dryRun = onboardData\.runMode === 'test';[\s\S]*api\.saveAppSettings\(\{ app \}\);/, 'hideOnboarding must save the chosen dryRun with onboarded:true');
  assertMatch(p03FnBody(onboardSrc, 'updateOnboardingUI'), /els\.onboardNext\.disabled = onboardStep >= 3 && !onboardData\.runMode;/, "\"Let's go\" stays disabled until a run mode is chosen");

  // Ring colours tell the mode.
  assertMatch(css, /body\.phase-lastlight\.test-mode \.ring-progress \{ stroke: var\(--accent-amber\); \}/, 'Test Mode last light must be amber, never red');
  assertMatch(css, /body\.is-paused\.is-paused \.ring-progress \{ stroke: var\(--accent-amber\); \}/, 'paused must be amber in every phase');
});

// The P03 truth surfaces are a contract for every later package (P05 overlay
// shell, P07 completion hold): they may restyle around these surfaces but
// never move, fade or animate them.
check('P03 truth contract: truth bands, finale chip and pill stay first, textContent-only and static', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const firstChildTag = (from) => {
    let i = htmlSrc.indexOf('>', from) + 1;
    for (;;) {
      while (/\s/.test(htmlSrc[i])) i++;
      if (htmlSrc.startsWith('<!--', i)) { i = htmlSrc.indexOf('-->', i) + 3; continue; }
      return htmlSrc.slice(i, htmlSrc.indexOf('>', i) + 1);
    }
  };
  for (const id of ['warning-modal', 'override-modal', 'snooze-tax-modal', 'ritual-overlay']) {
    const at = htmlSrc.indexOf(`id="${id}"`);
    assert(at > 0, `${id} missing`);
    const card = htmlSrc.indexOf('class="modal-content', at);
    assert(/data-truth-band/.test(firstChildTag(card)), `the first child of #${id} .modal-content must be its truth band`);
  }
  assert(!htmlSrc.includes('id="breathing-overlay"'), 'the removed breathing guide must stay absent');
  assert(/id="ll-truth"/.test(firstChildTag(htmlSrc.indexOf('<div class="ll-stage">'))), '#ll-truth must be the first child of .ll-stage');
  for (const id of ['warning-modal-title', 'warning-modal-text', 'warning-snooze', 'warning-cancel', 'warning-dismiss', 'warning-override']) {
    assert((htmlSrc.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1, `${id} must exist exactly once`);
  }
  const bandWrite = rendererSrc.match(/document\.querySelectorAll\('\[data-truth-band\]'\)\.forEach\(band => \{[\s\S]*?\n {2}\}\);/);
  assert(bandWrite && /band\.textContent = /.test(bandWrite[0]) && !/innerHTML|insertAdjacentHTML|outerHTML/.test(bandWrite[0]), 'truth bands are written with textContent only');
  assert(!/llTruth\.(innerHTML|outerHTML)|band\.innerHTML/.test(rendererSrc), 'truth chips are written with textContent only');
  for (const r of p03CssRules(css)) {
    if (!/\[data-truth-band\]|\.ov-truth\b|\.ll-truth\b|#testmode-pill\b/.test(r.selector)) continue;
    for (const d of r.body.matchAll(/(?:^|;)\s*(animation|transition)(?:-[a-z-]+)?\s*:\s*([^;]+)/g)) {
      assert(/^none\b/.test(d[2].trim()), `${r.selector} must not ${d[1]} (found "${d[2].trim()}")`);
    }
  }
});

// Mini mode is a 260x320 window: a safety dialog taller than that must
// scroll from its top edge (truth band first) instead of being flex-centred
// past the window, where the band was cut off beyond scroll reach.
check('P03 truth: mini-mode safety dialogs scroll from the top, never clip the truth band', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rules = p03CssRules(css);
  const ids = ['#warning-modal', '#override-modal', '#snooze-tax-modal', '#ritual-overlay'];
  const names = sel => /body\.mini-mode/.test(sel) && ids.every(id => sel.includes(id));
  const overlay = rules.find(r => names(r.selector) && /\.active\b/.test(r.selector));
  assert(overlay && /overflow-y:\s*auto/.test(overlay.body) && /align-items:\s*flex-start/.test(overlay.body), 'mini-mode safety overlays must scroll (overflow-y:auto) and align to flex-start');
  const card = rules.find(r => names(r.selector) && /> \.modal-content/.test(r.selector));
  assert(card && /margin:\s*auto/.test(card.body), 'mini-mode safety cards must centre with margin:auto (safe centring)');
});

// UI-R3 P04: one token/type system, no leftover blue, glyph constants, the
// CSS nest + markup bugs fixed, and Appearance choices that cannot hijack the
// colour grammar (behaviour: test/accent-grammar.test.js, contrast:
// test/truth-contrast.test.js).
check('P04 foundations: tokens, blue purge, glyphs, nest fix and the Appearance grammar guard', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const companionHtml = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  const companionSrc = fs.readFileSync(path.join(root, 'companion.js'), 'utf8');
  const czSrc = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  const utilsSrc = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
  const legacyBlue = /rgba\(\s*91\s*,\s*140\s*,\s*255|rgba\(\s*118\s*,\s*201\s*,\s*255|#1a4fd6/i;
  assert(!legacyBlue.test(css), 'styles.css still contains the legacy blue (91,140,255 / 118,201,255 / #1a4fd6)');
  assert(!legacyBlue.test(companionHtml), 'companion.html still contains the legacy blue');
  assertMatch(companionHtml, /<meta name="theme-color" content="#0b0f14">/, 'companion theme-color must be the #0b0f14 field');
  assertMatch(companionSrc, /background_color: '#0b0f14',\s*theme_color: '#0b0f14'/, 'companion manifest colours must be #0b0f14');
  const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map(m => m[1]).join('\n');
  assertMatch(rootBlocks, /--accent:\s*var\(--accent-cyan\)/, ':root must define --accent');
  assertMatch(rootBlocks, /--border-soft:\s*var\(--border-color\)/, ':root must define --border-soft');
  assertMatch(rootBlocks, /--accent-rgb:\s*155,\s*147,\s*214/, ':root must define --accent-rgb');
  const mono = /--font-mono:\s*([^;]+);/.exec(rootBlocks);
  assert(mono && !/^'SF Mono'/.test(mono[1].trim()), 'the first --font-mono family must not be SF Mono (Courier New on Windows 10)');
  assertMatch(css, /\.lights-section \.btn-small:hover \{\s*background: var\(--bg-hover\);\s*color: var\(--text-primary\);\s*\}/, '.lights-section .btn-small:hover must be a closed rule');
  assertMatch(css, /\n\.btn-tiny \{[^}]*border: 1px solid var\(--border-color\);/, '.btn-tiny must be top-level with the defined border token');
  assertMatch(css, /\.btn-danger\.btn-tiny:hover \{[^}]*color: #fff;/, 'danger tiny buttons stay red with white text on hover');
  const taxAt = htmlSrc.indexOf('<div id="override-tax-config">');
  const taxDetailsEnd = htmlSrc.indexOf('</details>', taxAt);
  const taxBody = htmlSrc.slice(taxAt, taxDetailsEnd);
  assert(taxAt > 0 && (taxBody.match(/<div\b/g) || []).length === (taxBody.match(/<\/div>/g) || []).length, '#override-tax-config must close before </details>');
  const apply = czSrc.match(/function applyCustomization\(c\) \{[\s\S]*?\n\}/)[0];
  assert(/sanitizeAccent\(/.test(apply) && /sanitizeRingStyle\(/.test(apply), 'applyCustomization must call sanitizeAccent and sanitizeRingStyle');
  const reserved = /^#(f59e0b|fb7185|22d3ee|34d399|00d1b2|f5b83d|ff5c7a|5b8cff)$/i;
  for (const m of htmlSrc.matchAll(/class="swatch"[^>]*data-color="([^"]+)"/g)) {
    assert(!reserved.test(m[1]), `reserved accent swatch ${m[1]} is still offered`);
  }
  assert(/const LEGACY_DEFAULT_ACCENT = '#5b8cff';/.test(czSrc) && /n === LEGACY_DEFAULT_ACCENT\) return fallback;/.test(czSrc), 'the saved v11.1.3 default blue accent must render violet');
  assertMatch(css, /body\[data-theme="dawn"\] :is\(\.ns-sidebar, \.chrome-header\) \{[^}]*--text-muted: #808b90;/, 'the dark Dawn rail and header must keep the night inks');
  const ring = htmlSrc.match(/<select id="cz-ring">[\s\S]*?<\/select>/)[0];
  assert(!/value="(sunset|ember|aurora)"/.test(ring), '#cz-ring must not offer Sunset, Ember or Aurora');
  assert(!/@keyframes (emberGlow|auroraShift|neonFlicker)\b/.test(css), 'per-frame ring-style keyframes must be gone');
  const dawn = [...css.matchAll(/body\[data-theme="dawn"\]\s*\{([^}]*)\}/g)].map(m => m[1]).join('\n');
  for (const t of ['--accent-amber', '--accent-red', '--pf-teal']) assert(new RegExp(`${t}:`).test(dawn), `Dawn must override ${t}`);
  assert((css.match(/(^|\n)\.help-text\s*\{/g) || []).length === 1, '.help-text must be defined exactly once');
  const glyphs = utilsSrc.match(/const LO_GLYPHS = Object\.freeze\(\{[\s\S]*?\n\}\);/);
  assert(glyphs, 'LO_GLYPHS must be a frozen constant map in renderer-utils.js');
  assert(!/href|<script/i.test(glyphs[0]), 'LO_GLYPHS strings must not contain href or <script');
  assert(htmlSrc.indexOf('src="renderer-utils.js"') < htmlSrc.indexOf('src="renderer-settings.js"') && htmlSrc.indexOf('src="renderer-utils.js"') < htmlSrc.indexOf('src="renderer.js"'), 'renderer-utils.js must load before the feature renderers');
});

// UI-R3 P05: dialogs are real (alert)dialogs with reachable truth, one
// announcer instead of a per-second live region, the heads-up instrument,
// repaired snooze-tax / LAN dialogs, night toasts and the on-brand finale.
// Behaviour: test/p05-dialogs.test.js (inert + focus, announcer cadence).
check('P05 dialogs: semantics, announcer, heads-up instrument, repaired dialogs, toasts and finale', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rules = p03CssRules(css);
  const openTag = id => (htmlSrc.match(new RegExp(`<div[^>]*\\bid="${id}"[^>]*>`)) || [''])[0];
  const truthBand = { 'warning-modal': 'warning-truth', 'override-modal': 'override-truth', 'snooze-tax-modal': 'snooze-tax-truth' };
  for (const [id, band] of Object.entries(truthBand)) {
    const tag = openTag(id);
    assert(/role="alertdialog"/.test(tag) && /aria-modal="true"/.test(tag), `#${id} must be role=alertdialog aria-modal`);
    const labelled = (tag.match(/aria-labelledby="([^"]+)"/) || [])[1];
    assert(labelled && htmlSrc.includes(`id="${labelled}"`), `#${id} aria-labelledby must name a real title`);
    const described = ((tag.match(/aria-describedby="([^"]+)"/) || [])[1] || '').split(/\s+/);
    assert(described.includes(band) && htmlSrc.includes(`id="${band}"`), `#${id} aria-describedby must include its truth band #${band}`);
  }
  for (const id of ['profiles-modal', 'lan-warning-modal', 'receipts-modal', 'about-modal', 'notif-drawer', 'streak-celebration-modal', 'ritual-overlay']) {
    const tag = openTag(id);
    assert(/role="dialog"/.test(tag) && /aria-modal="true"/.test(tag), `#${id} must be role=dialog aria-modal`);
    const labelled = (tag.match(/aria-labelledby="([^"]+)"/) || [])[1];
    assert((labelled && htmlSrc.includes(`id="${labelled}"`)) || /aria-label="[^"]+"/.test(tag), `#${id} needs an accessible name`);
  }
  assertMatch(openTag('ritual-overlay'), /aria-labelledby="ritual-step-title"/, 'the ritual dialog is named by its step title');
  // One announcer, no per-second live region.
  const timerMain = (htmlSrc.match(/<div[^>]*id="timer-main"[^>]*>/) || [''])[0];
  assert(/role="timer"/.test(timerMain) && !/aria-live/.test(timerMain), '#timer-main must be role=timer with no aria-live');
  const bodyOpen = htmlSrc.indexOf('<body>');
  const announcerAt = htmlSrc.indexOf('id="session-announcer"');
  assert(announcerAt > bodyOpen && announcerAt < htmlSrc.indexOf('<div class="cockpit">'), '#session-announcer must be a direct child of <body>, outside .cockpit');
  assertMatch(openTag('session-announcer'), /aria-live="polite"/, '#session-announcer must be aria-live polite');
  const announceCalls = [...rendererSrc.matchAll(/\bannounce\(/g)].map(m => m.index);
  const announcer = p03FnBody(rendererSrc, 'announceSessionEvent');
  const announcerAtSrc = rendererSrc.indexOf(announcer);
  assert(announceCalls.length > 1 && announceCalls.every(i => (i >= announcerAtSrc && i < announcerAtSrc + announcer.length) || /function announce\($/.test(rendererSrc.slice(i - 9, i + 9))), 'announce() may only be called from announceSessionEvent');
  assert((rendererSrc.match(/announceSessionEvent\(/g) || []).length === 2 && /render\(\);\s*announceSessionEvent\(data\);/.test(p03FnBody(rendererSrc, 'applyTimerPayload')), 'announceSessionEvent is driven only by applyTimerPayload events');
  assert(!/case 'tick':[\s\S]*?break;/.exec(announcer)?.[0].includes('remainingSeconds %'), 'tick announcements are minute crossings, not per-second');

  // The heads-up instrument.
  const warn = htmlSrc.slice(htmlSrc.indexOf('id="warning-modal"'), htmlSrc.indexOf('<!-- Emergency Override Modal -->'));
  for (const id of ['warning-modal-countdown', 'warning-modal-ring', 'warning-dismiss', 'warning-override']) assert(warn.includes(`id="${id}"`), `#warning-modal must contain #${id}`);
  assert(!warn.includes('&#x26A0;') && !/id="warning-override"[^>]*style=/.test(warn), 'the heads-up dialog has no text warning glyph and no inline override style');
  assert(/class="wi-track"[^>]*pathLength="100"/.test(warn) && /id="warning-modal-ring"[^>]*pathLength="100"/.test(warn), 'the instrument track and arc must use pathLength=100');
  const cadence = (css.match(/\.wi-track \{[^}]*stroke-dasharray: ([^;]+);/) || [])[1];
  assert(cadence && cadence.split(/\s+/).reduce((s, n) => s + Number(n), 0) === 100, 'the broken-O track cadence must sum to 100');
  const renderBody = p03FnBody(rendererSrc, 'render');
  assertMatch(renderBody, /els\.warningModal\?\.classList\.contains\('active'\)[\s\S]*?formatTime\(remaining\)[\s\S]*?warning-modal-ring/, 'render() fills the heads-up countdown with formatTime and drives the ring while the dialog is open');
  assertMatch(renderBody, /Test Mode: \$\{actionLabel\(\)\} would run when this reaches 0:00\. Nothing will power off\./, 'the Test Mode heads-up copy comes from state');
  assert(/btn\.setAttribute\('aria-pressed', String\(pressed\)\)/.test(renderBody), '.unit-btn aria-pressed is synced in render()');
  assertMatch(css, /#warning-modal, #snooze-tax-modal, #lan-warning-modal \{ --ov-tone: 245, 184, 61; \}/, '#warning-modal must define the amber --ov-tone');
  assertMatch(css, /#override-modal \{ --ov-tone: 255, 92, 122; \}/, '#override-modal must define the red --ov-tone');
  assert(!rules.some(r => /(^|[\s,>])\.modal\b/.test(r.selector) && /backdrop-filter/.test(r.body)), 'the overlay shell must not blur the backdrop');

  // Snooze-tax + LAN repair.
  const tax = p03FnBody(rendererSrc, 'showSnoozeTaxModal');
  assert(!/\$\{c\.(icon|message|severity)\b/.test(tax), 'snooze-tax rows must not interpolate raw consequence fields');
  assertMatch(tax, /escapeHtml\(String\(c\?\.message \?\? ''\)\)/, 'snooze-tax messages must be escaped');
  assertMatch(tax, /data-sev="\$\{escapeHtml\(sev\)\}"/, 'snooze-tax data-sev must be escaped');
  assert(!/#ff4d4d/.test(tax) && /classList\.add\('ov-invalid'\)/.test(tax), 'the reason error uses .ov-invalid, not an inline colour');
  const confirmTag = (htmlSrc.match(/<button[^>]*id="btn-snooze-tax-confirm"[^>]*>/) || [''])[0];
  assert(confirmTag && !/btn-danger/.test(confirmTag), '#btn-snooze-tax-confirm must not be btn-danger');
  assertMatch(htmlSrc, /<div id="snooze-tax-reason-wrap" class="ov-field" style="display:none">/, '#snooze-tax-reason-wrap keeps its JS-toggled inline display');
  const lan = htmlSrc.slice(htmlSrc.indexOf('id="lan-warning-modal"'), htmlSrc.indexOf('<!-- Notification Center Drawer -->'));
  assert(!/style="[^"]*font-size:\s*1[01]px/.test(lan) && !/&#x1F/.test(lan), 'the LAN dialog has no 10-11px inline text and no emoji');
  assert(lan.indexOf('btn-lan-warning-confirm') < lan.indexOf('btn-lan-warning-cancel'), 'the LAN buttons keep their order');

  // Night toasts.
  assert(!/#toast-container \{[^}]*top: 64px/.test(css) && !/#338442|#a87f08|#2d7fa7/i.test(css), '#toast-container must not sit at top:64px or use the old saturated toast colours');
  const toastRule = rules.filter(r => r.selector === '#toast-container').pop();
  const zi = Number((toastRule?.body.match(/z-index:\s*(\d+)/) || [])[1]);
  assert(zi > 0 && zi < 1500, 'toasts must stack below every dialog (#warning-modal is 1500)');
  assert(rules.some(r => r.selector === '.toast' && /pointer-events:\s*none/.test(r.body)), '.toast must never be a hit target');

  // The finale on the brand.
  const ll = htmlSrc.slice(htmlSrc.indexOf('<!-- Last Light finale overlay -->'), htmlSrc.indexOf('<script src="lastLight.js">'));
  const emoji = /&#x1F[0-9A-F]{3};|&#x2[3-7][0-9A-F]{2};|[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}]/u;
  assert(!emoji.test(ll), 'the Last Light overlay markup must have no emoji');
  for (const r of rules) {
    if (/\.ll-truth\b|\.ll-stamp\b/.test(r.selector)) assert(!/var\(--ll-light/.test(r.body), `${r.selector} must not read --ll-light`);
  }
  const play = p03FnBody(rendererSrc, 'playLastLight');
  const resetAt = play.indexOf("classList.remove('ll-out');");
  assert(resetAt > 0 && resetAt < play.indexOf("style.setProperty('--ll-light', '1')") && play.indexOf("style.setProperty('--ll-light', '1')") < play.indexOf("classList.add('active')"), 'playLastLight resets ll-out and --ll-light before the overlay shows');
  assert(!/\.ll-ring-arc \{[^}]*filter: (?!none)/.test(css), 'the finale arc has no SVG filter');
});

// UI-R3 P06: Tonight is one instrument (ring) plus one console (plan or
// session). Behaviour: test/tonight-instrument.test.js (bezel geometry, labels
// by mode, plan facts, session head, origin map, Controls).
check('P06 Tonight instrument: one ring, one console, a plan you can read', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const utilsSrc = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
  const rendererOnly = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

  // Markup: the child order of #ns-panel-lib, and the plan owns its setup.
  const panelAt = htmlSrc.indexOf('<div class="ns-main-panel" id="ns-panel-lib">');
  const panelEnd = htmlSrc.indexOf('<!-- /LIB panel -->', panelAt);
  assert(panelAt > 0 && panelEnd > panelAt, '#ns-panel-lib missing');
  const panel = htmlSrc.slice(panelAt, panelEnd);
  const order = ['id="armed-mode-banner"', 'id="testmode-pill"', 'id="ns-hero-card"', '<div class="action-bar" id="action-bar-running" style="display:none">', '<section class="timer-section">', 'id="readiness-strip"'];
  const positions = order.map(t => panel.indexOf(t));
  assert(positions.every(p => p > 0), `#ns-panel-lib is missing one of: ${order.filter((t, i) => positions[i] < 0).join(', ')}`);
  assert(positions.every((p, i) => i === 0 || p > positions[i - 1]), '#ns-panel-lib children must be ordered banner, pill, plan, console, ring, readiness');
  const hero = panel.slice(panel.indexOf('id="ns-hero-card"'), panel.indexOf('id="action-bar-running"'));
  assert(hero.includes('id="setup-controls"') && hero.includes('id="ns-play-btn"') && hero.includes('id="btn-ritual"'), '#setup-controls, the CTA and Begin Ritual must live inside #ns-hero-card');
  for (const id of ['ns-hero-label', 'ns-preview-time', 'plan-out-at', 'ns-meta-ending', 'ns-meta-reach']) assert(hero.includes(`id="${id}"`), `plan column missing #${id}`);
  assertMatch(hero, /<dl class="plan-facts">[\s\S]*<dd id="ns-preview-time">[\s\S]*<dd id="plan-out-at">[\s\S]*<dd id="ns-meta-ending"><\/dd>/, 'plan facts must be a <dl> of Runs / Ends at / Ends with');
  assert(!hero.includes('ns-preview-ring') && !hero.includes('ns-hero-right'), 'the second (preview) ring must be gone');
  assert(!/&#x25B6;|▶/.test(hero), 'the CTA play glyph must be an inline SVG, not a text glyph');
  assert(!htmlSrc.includes('Clearance'), "no 'Clearance' anywhere");
  for (const [id, label] of [['btn-minus', 'Decrease duration'], ['btn-plus', 'Increase duration'], ['timer-input', 'Timer duration']]) {
    assertMatch(htmlSrc, new RegExp(`id="${id}"[^>]*aria-label="${label}"`), `#${id} must be labelled "${label}"`);
  }
  assertMatch(hero, /class="chips-row" role="group" aria-labelledby="plan-quick-label"/, 'the duration chips are the labelled "Quick start" group');
  assert((hero.match(/<button class="chip" data-min="\d+" aria-label="[^"]+">/g) || []).length === 6, 'every quick-start chip needs an aria-label');

  // Console: session head, labelled snooze group, Cancel session.
  const consoleAt = panel.indexOf('id="action-bar-running"');
  const consoleSrc = panel.slice(consoleAt, panel.indexOf('<section class="timer-section">'));
  assertMatch(consoleSrc, /<div class="session-head" aria-live="off"><div class="session-eyebrow" id="session-phase"><\/div><div class="session-ends" id="session-ends"><\/div><\/div>/, 'session head missing');
  assertMatch(consoleSrc, /<div class="snooze-group" role="group" aria-label="Snooze">/, 'snooze controls must be one labelled group');
  assertMatch(consoleSrc, /id="btn-stop">[\s\S]*?<span>Cancel session<\/span>/, '#btn-stop must read "Cancel session"');
  assertMatch(consoleSrc, /id="btn-pause">[\s\S]*?<\/span>\s*<span>Pause<\/span>\s*<\/button>/, "#btn-pause's label span must stay last (render() writes span:last-child)");

  // render(): plan facts from the same plan Start reads, mode-aware dt.
  const facts = p03FnBody(rendererOnly, 'updatePlanFacts');
  assertMatch(facts, /const secs = planSecondsNow\(\);/, 'Ends at must use the plan duration');
  assertMatch(p03FnBody(rendererOnly, 'planSecondsNow'), /state\.armedNightMode \? state\.armedNightMode\.durationSeconds : inputSeconds\(\)/, 'plan duration = armed Night Mode or inputSeconds()');
  assertMatch(facts, /getElementById\('plan-out-at'\), `~\$\{formatIdleClockTime\(new Date\(Date\.now\(\) \+ secs \* 1000\), true\)\}`/, '#plan-out-at must come from formatIdleClockTime');
  assertMatch(facts, /getElementById\('plan-out-at-label'\), state\.settingsLoaded && state\.dryRun \? 'Test ends' : 'Ends at'/, 'the Ends at dt must follow the mode');
  assert(!/plan-out-at|formatIdleClockTime/.test(p03FnBody(rendererOnly, 'renderTonightHero')), 'renderTonightHero must not compute clock facts (contract sandbox)');
  const render = p03FnBody(rendererOnly, 'render');
  assertMatch(render, /if \(isIdle\) updatePlanFacts\(\);\s*else updateSessionHead\(\);/, 'render() writes plan facts idle and the session head while active');
  assertMatch(rendererOnly, /if \(state\.clockMode\) render\(\);\s*else updatePlanFacts\(\);/, 'the idle tick must refresh Ends at with clock mode off');

  // The bezel: one call site, in the idle analog/hybrid branch; updateRing
  // otherwise. updateRing's body is unchanged by P06 (P07 extends it).
  assert((rendererOnly.match(/updateIdleBezel\(/g) || []).length === 2, 'updateIdleBezel must be defined once and called once');
  const clockBranch = render.slice(render.indexOf('if (idleClockVisible) {'), render.indexOf('} else {\n    if (els.analogClock) {'));
  assertMatch(clockBranch, /if \(showAnalog\) \{\s*\/\/[^\n]*\n\s*const planSeconds = planSecondsNow\(\);\s*updateIdleBezel\(now, planSeconds\);\s*bezelDrawn = true;/, 'updateIdleBezel must be called only in the idle analog/hybrid branch');
  assertMatch(render, /if \(bezelDrawn\) \{[\s\S]*?'--lights-level'[\s\S]*?\} else \{\s*clearIdleBezel\(\);\s*updateRing\(displaySeconds, totalSeconds\);\s*\}/, 'render() must run either the bezel or updateRing, and clear the bezel on every other path');
  assertMatch(p03FnBody(rendererOnly, 'clearIdleBezel'), /bezelKey = '';[\s\S]*classList\.remove\('bezel', 'bezel-hour', 'bezel-empty', 'bezel-tween'\)/, 'clearIdleBezel must clear the bezel classes and key');
  const ringBody = p03FnBody(rendererOnly, 'updateRing').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');
  // P07 extended updateRing: the completion-hold light level, --session-ratio
  // and the wordmark O's dash (the same real remaining/total ratio).
  const ringBaseline = "{ if (!els.ringProgress) return; const circumference = 2 * Math.PI * 90; const ratio = total > 0 ? clamp(remaining / total, 0, 1) : 0; els.ringProgress.style.strokeDasharray = `${circumference}`; els.ringProgress.style.strokeDashoffset = `${circumference - ratio * circumference}`; if (els.ringHead) els.ringHead.style.transform = `rotate(${(ratio * 360).toFixed(2)}deg)`; const active = state.running || state.paused; const outcomeHold = !active && (state.lastOutcome === 'completed' || state.lastOutcome === 'dryrun'); const lightLevel = active ? 0.25 + 0.75 * ratio : outcomeHold ? 0.12 : 1; document.body.style.setProperty('--lights-level', lightLevel.toFixed(3)); document.body.style.setProperty('--session-ratio', (active ? ratio : 1).toFixed(4)); const oDash = active ? `${(ratio * 100).toFixed(2)} 100` : ''; for (const arc of [els.brandOLive, els.brandOHalo]) { if (arc && arc.dataset.dash !== oDash) { arc.dataset.dash = oDash; arc.style.strokeDasharray = oDash; } } }";
  assert(ringBody === ringBaseline, 'updateRing body changed: P06 left it untouched and P07 owns its extension (update this baseline deliberately)');
  assert(!/teal|0, 209, 178|0, 255, 209/.test((css.match(/body\.bezel \.ring-head-particle \{[^}]*\}/) || [''])[0]), 'the bezel head must never be teal');

  // Origin labels: a frozen map, textContent only.
  assertMatch(utilsSrc, /const ORIGIN_LABELS = Object\.freeze\(\{/, 'ORIGIN_LABELS must be a frozen map in renderer-utils.js');
  const head = p03FnBody(rendererOnly, 'updateSessionHead');
  assertMatch(head, /Object\.prototype\.hasOwnProperty\.call\(ORIGIN_LABELS, state\.origin\)/, 'origin phrases come only from ORIGIN_LABELS keys');
  assertMatch(head, /setTextIfChanged\(document\.getElementById\('session-phase'\)/, '#session-phase must be written via setTextIfChanged');
  assertMatch(p03FnBody(rendererOnly, 'setTextIfChanged'), /el\.textContent = text/, 'setTextIfChanged writes textContent only');
  assert(!/session-(phase|ends)[^\n]*innerHTML/.test(rendererOnly), 'no innerHTML on the session head');

  // CSS: grid areas, instrument numerals, REAL hairlines, block placement.
  // P06's own block ends at the next UI-R3 package block (P07 sits between
  // it and the contract), so later packages' blocks are judged by their own checks.
  const p06 = css.match(/\/\* -- UI-R3 · P06[\s\S]*?(?=\/\* -- UI-R3 · P(?!06)|\/\* -- Reduced motion: one global contract)/);
  assert(p06, 'the UI-R3 · P06 block must sit before the reduced-motion contract');
  assertMatch(p06[0], /#ns-panel-lib > #action-bar-running \{ grid-area: plan;/, '#action-bar-running must take grid-area plan');
  assertMatch(p06[0], /grid-template-areas: 'banner banner' '\. \.' 'ring truth' 'ring plan' '\. \.' 'ready ready';/, 'two-column instrument + console grid (with its F1 fill spacer rows) missing');
  assertMatch(p06[0], /\.time-main \{[^}]*font-family: var\(--font-instrument\);/, '.time-main must use var(--font-instrument)');
  assertMatch(p06[0], /body\.real-action #action-chips-row \.action-chip\.selected \{ box-shadow: inset 0 0 0 1px rgba\(255, 92, 122, 0\.6\); \}/, 'REAL hairline on the selected ending missing');
  assertMatch(p06[0], /body\.real-action \.ns-play-btn \{[^}]*box-shadow: 0 0 0 1px rgba\(255, 92, 122, 0\.55\)[^}]*transition: background var\(--dur-fast\) ease, transform var\(--dur-fast\) ease;/, 'REAL CTA hairline must be static (no box-shadow transition)');
  assertMatch(p06[0], /body\.mini-mode #ns-panel-lib \.timer-section \{ order: 1; \}/, 'mini mode keeps the ring before the console');
  // UI-R3 Fire 04: the fullscreen ring is laid out at real size (no scale).
  assertMatch(p06[0], /body\.fullscreen-clock-mode \.ring-container \{ width: min\(76vmin, 620px\); height: auto; aspect-ratio: 1; \}/, 'the fullscreen clock ring is sized by layout: min(76vmin, 620px), aspect-ratio 1');
  assert(!p03CssRules(css).some(r => /fullscreen-clock-mode[^,{]*\.timer-section/.test(r.selector) && /transform:\s*scale\(/.test(r.body)), 'no fullscreen .timer-section scale transform remains');
  for (const r of p03CssRules(p06[0])) {
    assert(!/(^|[\s;{])animation\s*:/.test(r.body) || /animation:\s*none/.test(r.body), `P06 adds no animation (${r.selector})`);
    if (/#testmode-pill/.test(r.selector)) assert(!/transition|animation|opacity/.test(r.body), '#testmode-pill is never animated or faded by P06');
  }
  assert(!/\.ring-container \{ width: 214px; height: 214px; \}/.test(css), 'the 214px max-height ring override must be gone');
});

// F1: the Tonight composition fills the window. A small cascade evaluator
// (media at a given viewport, selector matching against the real ancestor
// chain and body classes, specificity, !important, source order, shorthands)
// decides which declaration actually wins, so a later or more specific rule
// that undoes the fill fails here, not just a missing rule.
function f1SplitTop(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// Whitespace split that keeps parenthesised groups together.
function f1SplitWs(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text.trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function f1CssRules(css) {
  const out = [];
  let order = 0;
  const walk = (src, media) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const prelude = src.slice(i, open).split(';').pop().trim();
      let depth = 0;
      let j = open;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) break;
      }
      const body = src.slice(open + 1, j);
      if (/^@media\b/.test(prelude)) {
        const cond = prelude.slice(6).trim();
        walk(body, media ? [...media, cond] : [cond]);
      } else if (/^@supports\b/.test(prelude)) {
        walk(body, media);
      } else if (!prelude.startsWith('@')) {
        out.push({ selectors: f1SplitTop(prelude), body, media, order: order++ });
      }
      i = j + 1;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return out;
}
function f1MediaMatches(media, vp) {
  if (!media) return true;
  return media.every(cond => f1SplitTop(cond).some(alt => alt.split(/\s+and\s+/i).every(part => {
    const p = part.trim();
    if (/^(screen|all)$/i.test(p)) return true;
    const m = p.match(/^\(\s*(max|min)-(width|height)\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/);
    if (!m) return false; // print, prefers-reduced-motion, etc.: not this viewport
    return m[1] === 'max' ? vp[m[2]] <= Number(m[3]) : vp[m[2]] >= Number(m[3]);
  })));
}
function f1Specificity(sel) {
  const spec = [0, 0, 0];
  const add = (s) => { spec[0] += s[0]; spec[1] += s[1]; spec[2] += s[2]; };
  let s = sel.replace(/:(not|is|has|where)\(((?:[^()]|\([^()]*\))*)\)/g, (_, fn, args) => {
    if (fn !== 'where') add(f1SplitTop(args).map(f1Specificity).sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]).pop());
    return ' ';
  });
  s = s.replace(/::[\w-]+(\([^)]*\))?/g, () => { spec[2]++; return ' '; });
  s = s.replace(/\[[^\]]*\]/g, () => { spec[1]++; return ' '; });
  s = s.replace(/#[\w-]+/g, () => { spec[0]++; return ' '; });
  s = s.replace(/\.[\w-]+/g, () => { spec[1]++; return ' '; });
  s = s.replace(/:[\w-]+(\([^)]*\))?/g, () => { spec[1]++; return ' '; });
  spec[2] += (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return spec;
}
function f1CompoundMatches(compound, el) {
  if (/::/.test(compound)) return false; // a pseudo-element is not the element
  let ok = true;
  let rest = compound.replace(/:(not|is|where)\(((?:[^()]|\([^()]*\))*)\)/g, (_, fn, args) => {
    const any = f1SplitTop(args).some(arg => f1CompoundMatches(arg, el));
    if (fn === 'not' ? any : !any) ok = false;
    return '';
  });
  // :has(), state pseudo-classes and attribute selectors are assumed to match:
  // the conservative direction (a rule that might apply is counted).
  rest = rest.replace(/:[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, '').replace(/\[[^\]]*\]/g, '');
  rest = rest.replace(/#([\w-]+)/g, (_, id) => { if (el.id !== id) ok = false; return ''; });
  rest = rest.replace(/\.([\w-]+)/g, (_, c) => { if (!el.classes.includes(c)) ok = false; return ''; });
  const tag = rest.trim();
  if (tag && tag !== '*' && tag !== el.tag) ok = false;
  return ok;
}
function f1SelectorMatches(sel, chain) {
  // Space out top-level combinators only (never the "+" inside :nth-child(2n + 1)).
  let spaced = '';
  let depth = 0;
  for (const ch of sel) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    spaced += depth === 0 && /[>+~]/.test(ch) ? ` ${ch} ` : ch;
  }
  const parts = f1SplitWs(spaced);
  const compounds = [];
  const combs = [];
  for (const p of parts) {
    if (/^[>+~]$/.test(p)) combs[compounds.length - 1] = p;
    else { compounds.push(p); if (combs.length < compounds.length - 1) combs.push(' '); }
  }
  const match = (ci, ei) => {
    if (!f1CompoundMatches(compounds[ci], chain[ei])) return false;
    if (ci === 0) return true;
    const comb = combs[ci - 1] || ' ';
    if (comb === '+' || comb === '~') return match(ci - 1, ei); // siblings not modelled: conservative
    if (comb === '>') return ei > 0 && match(ci - 1, ei - 1);
    for (let k = ei - 1; k >= 0; k--) if (match(ci - 1, k)) return true;
    return false;
  };
  return match(compounds.length - 1, chain.length - 1);
}
function f1Decls(body) {
  return body.split(';').map(d => d.trim()).filter(Boolean).map(d => {
    const at = d.indexOf(':');
    const raw = d.slice(at + 1).trim();
    return { name: d.slice(0, at).trim(), value: raw.replace(/\s*!important$/, ''), important: /!important$/.test(raw) };
  });
}
// Longhand -> the shorthands that also set it, and how to read it back out.
// A grid / grid-template shorthand is reported as-is so a check against the
// longhand value fails loudly instead of being skipped.
const F1_SHORTHANDS = {
  'margin-top': [['margin', t => t[0]]],
  'margin-bottom': [['margin', t => t[t.length >= 3 ? 2 : 0]]],
  'row-gap': [['gap', t => t[0]]],
  'align-self': [['place-self', t => t[0]]],
  'flex-direction': [['flex-flow', t => t[0]]],
  'padding-left': [['padding', t => t[t.length === 4 ? 3 : t.length >= 2 ? 1 : 0]]],
  'grid-template-rows': [['grid-template', t => `SHORTHAND ${t.join(' ')}`], ['grid', t => `SHORTHAND ${t.join(' ')}`]],
  'grid-template-areas': [['grid-template', t => `SHORTHAND ${t.join(' ')}`], ['grid', t => `SHORTHAND ${t.join(' ')}`]],
};
function f1CompareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
// The declaration of `prop` that wins on the last element of `chain` at
// viewport `vp`: !important first, then specificity, then source order.
function f1Computed(rules, chain, prop, vp) {
  let best = null;
  const shorthands = F1_SHORTHANDS[prop] || [];
  for (const r of rules) {
    if (!f1MediaMatches(r.media, vp)) continue;
    let decl = null;
    for (const d of f1Decls(r.body)) {
      const sh = shorthands.find(([name]) => name === d.name);
      if (d.name !== prop && !sh) continue;
      if (decl && decl.important && !d.important) continue;
      decl = sh ? { ...d, value: sh[1](f1SplitWs(d.value)) } : d;
    }
    if (!decl) continue;
    for (const sel of r.selectors) {
      if (!f1SelectorMatches(sel, chain)) continue;
      const key = [decl.important ? 1 : 0, ...f1Specificity(sel), r.order];
      if (!best || f1CompareKeys(key, best.key) > 0) best = { key, value: decl.value, sel, media: r.media };
    }
  }
  return best;
}
check('F1 Tonight fills the window: the panel fills .dashboard, the console centres, the rail rests on the bottom', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(rmAt > 0, 'reduced-motion contract missing');
  const rules = f1CssRules(css);
  assert(rules.length > 500, `the cascade evaluator must parse styles.css (got ${rules.length} rules)`);

  // Evaluator self-test: specificity and matching behave like the browser.
  assert(f1Specificity('body:not(.mini-mode):not(.fullscreen-clock-mode) #ns-panel-lib > #readiness-strip').join() === '2,2,1', 'specificity of the fill selectors is (2,2,1)');
  assert(f1Specificity('body.mini-mode #readiness-strip').join() === '1,1,1', 'specificity of the mini rail rule is (1,1,1)');
  const probe = [{ tag: 'body', id: '', classes: [] }, { tag: 'div', id: 'a', classes: ['b'] }];
  const probeVp = { width: 900, height: 800 };
  assert(f1Computed(f1CssRules('.b#a { margin-top: 2px } #a { margin: 3px }'), probe, 'margin-top', probeVp).value === '2px', 'evaluator: specificity beats source order');
  assert(f1Computed(f1CssRules('#a { margin-top: 1px } div#a { margin: 0 0 5px }'), probe, 'margin-top', probeVp).value === '0', 'evaluator: a later, stronger shorthand overrides');
  assert(f1Computed(f1CssRules('#a { margin-top: 1px !important } .b#a { margin-top: 2px }'), probe, 'margin-top', probeVp).value === '1px', 'evaluator: !important wins');
  assert(f1Computed(f1CssRules('#a { margin-top: 1px } @media (max-height: 700px) { #a { margin-top: 2px } }'), probe, 'margin-top', probeVp).value === '1px', 'evaluator: a non-matching media query is ignored');
  assert(f1Computed(f1CssRules('#a { margin-top: 1px } body:not(.x) > #a { margin-top: 2px }'), probe, 'margin-top', probeVp).value === '2px', 'evaluator: :not() and child combinators match');
  // Mutation: a later override of the rail margin must be caught, not just the rule's presence.
  const mutated = f1CssRules(`${css}\nbody:not(.mini-mode):not(.fullscreen-clock-mode) #ns-panel-lib > #readiness-strip { margin: 0; }`);
  const mutatedChain = [{ tag: 'html', id: '', classes: [] }, { tag: 'body', id: '', classes: ['ns-lobby'] }, { tag: 'main', id: '', classes: ['dashboard'] }, { tag: 'div', id: 'ns-panel-lib', classes: ['ns-main-panel'] }, { tag: 'section', id: 'readiness-strip', classes: ['readiness-strip'] }];
  assert(f1Computed(mutated, mutatedChain, 'margin-top', probeVp).value === '0', 'evaluator: an appended override of the rail margin is detected');

  // Markup chain the rules are evaluated against.
  assert(/<main class="dashboard">/.test(htmlSrc) && htmlSrc.indexOf('<div class="cockpit">') < htmlSrc.indexOf('<main class="dashboard">'), 'main.dashboard sits inside .cockpit');
  assertMatch(htmlSrc, /<div class="ns-main-panel" id="ns-panel-lib">/, '#ns-panel-lib keeps its id and class');
  assertMatch(htmlSrc, /<section class="readiness-strip" id="readiness-strip" aria-label="Readiness">/, '#readiness-strip keeps its id and class');
  assertMatch(htmlSrc, /<div class="testmode-pill checking" id="testmode-pill" role="status">/, '#testmode-pill keeps its id and class');
  const el = (tag, id, classes) => ({ tag, id, classes });
  const chainFor = (bodyClasses, leaf) => {
    if (leaf === 'sidebar') return [el('html', '', []), el('body', '', bodyClasses), el('div', '', ['cockpit']), el('aside', '', ['ns-sidebar'])];
    const c = [el('html', '', []), el('body', '', bodyClasses), el('div', '', ['cockpit']), el('main', '', ['dashboard'])];
    if (leaf === 'dashboard') return c;
    c.push(el('div', 'ns-panel-lib', ['ns-main-panel']));
    if (leaf === 'panel') return c;
    if (leaf === 'strip') c.push(el('section', 'readiness-strip', ['readiness-strip']));
    if (leaf === 'pill') c.push(el('div', 'testmode-pill', ['testmode-pill', 'test-mode']));
    if (leaf === 'banner') c.push(el('div', 'armed-mode-banner', ['armed-mode-banner']));
    return c;
  };
  const val = (bodyClasses, leaf, prop, vp) => (f1Computed(rules, chainFor(bodyClasses, leaf), prop, vp) || {}).value;
  const DEFAULT = { width: 900, height: 800 };
  const MIN = { width: 900, height: 640 };
  const ROWS = 'auto minmax(0, 1fr) auto auto minmax(var(--tonight-gap), 1fr) auto';
  const AREAS = "'banner banner' '. .' 'ring truth' 'ring plan' '. .' 'ready ready'";
  // UI-R3 Fire 03: a real session has no ns-lobby (render() keeps it idle-only),
  // so the running / paused states are also evaluated without it.
  const SESSION_STATES = [['is-running'], ['is-paused'], ['is-running', 'bezel']];
  const states = [['ns-lobby'], ['ns-lobby', 'is-running'], ['ns-lobby', 'is-paused'], ['ns-lobby', 'is-running', 'bezel'], ['ns-lobby', 'test-mode'], ['ns-lobby', 'real-action'], ...SESSION_STATES];

  for (const vp of [DEFAULT, MIN]) {
    const tag = `${vp.width}x${vp.height}`;
    for (const st of states) {
      const at = `${st.join('.')} @ ${tag}`;
      // The dashboard is a scrolling flex column, so a too-tall panel scrolls instead of overlapping.
      assert(val(st, 'dashboard', 'display', vp) === 'flex' && val(st, 'dashboard', 'flex-direction', vp) === 'column', `.dashboard must stay a flex column (${at})`);
      assert(val(st, 'dashboard', 'overflow-y', vp) === 'auto', `.dashboard must scroll when the panel is taller than the window (${at})`);
      // The panel fills the dashboard height and is the fill grid.
      assert(val(st, 'panel', 'display', vp) === 'grid', `#ns-panel-lib must be the grid (${at})`);
      assert(val(st, 'panel', 'flex', vp) === '1 0 auto', `#ns-panel-lib must fill the dashboard: flex 1 0 auto (${at}; got ${val(st, 'panel', 'flex', vp)})`);
      assert(val(st, 'panel', 'grid-template-rows', vp) === ROWS, `#ns-panel-lib rows must carry the two 1fr spacers (${at}; got ${val(st, 'panel', 'grid-template-rows', vp)})`);
      assert(val(st, 'panel', 'grid-template-areas', vp) === AREAS, `#ns-panel-lib areas must put spacers around the instrument + console (${at})`);
      assert(val(st, 'panel', 'row-gap', vp) === '0', `#ns-panel-lib row-gap must be 0 so empty spacers cost nothing at the minimum (${at})`);
      // The readiness rail rests on the bottom of the panel.
      assert(val(st, 'strip', 'grid-area', vp) === 'ready', `#readiness-strip must sit in the ready row (${at})`);
      assert(val(st, 'strip', 'margin-top', vp) === 'auto', `#readiness-strip margin-top must win as auto (${at}; got ${val(st, 'strip', 'margin-top', vp)})`);
      assert(val(st, 'strip', 'align-self', vp) === 'end', `#readiness-strip must align to the panel bottom (${at})`);
      assert(val(st, 'strip', 'display', vp) !== 'none', `#readiness-strip stays visible outside mini mode (${at})`);
      // The truth pill keeps its place and its visibility; the spacing moved into its margin.
      assert(val(st, 'pill', 'grid-area', vp) === 'truth', `#testmode-pill stays in the truth area (${at})`);
      assert(val(st, 'pill', 'margin-bottom', vp) === 'var(--tonight-gap)', `#testmode-pill carries the console spacing (${at})`);
      assert(val(st, 'pill', 'display', vp) !== 'none' && val(st, 'pill', 'visibility', vp) !== 'hidden', `#testmode-pill is never hidden (${at})`);
      assert(val(st, 'banner', 'margin-bottom', vp) === 'var(--tonight-gap)', `the Night Mode banner carries its own spacing (${at})`);
      // The panel itself is never transformed (position:fixed descendants).
      const tf = val(st, 'panel', 'transform', vp);
      assert(tf === undefined || tf === 'none', `#ns-panel-lib must not be transformed (${at}; got ${tf})`);
      // UI-R3 Fire 03: the rail and its padding hold idle and through a session.
      assert(val(st, 'sidebar', 'display', vp) === 'flex', `the nav rail stays shown (${at}; got ${val(st, 'sidebar', 'display', vp)})`);
      assert(val(st, 'sidebar', 'bottom', vp) === 'var(--footer-h)', `the rail stops above the footer pill (${at})`);
      assert(val(st, 'dashboard', 'padding-left', vp) === 'calc(80px + var(--section-gap))', `.dashboard keeps the rail padding (${at}; got ${val(st, 'dashboard', 'padding-left', vp)})`);
    }
    // Mini mode and the fullscreen clock stay rail-less, idle or in a session.
    for (const extra of [[], ['is-running'], ['is-paused']]) {
      assert(val(['mini-mode', ...extra], 'sidebar', 'display', vp) === 'none', `mini mode: no rail (${extra.join('.') || 'idle'} @ ${tag})`);
      assert(val(['mini-mode', ...extra], 'dashboard', 'padding-left', vp) === '12px', `mini mode: no rail padding (${extra.join('.') || 'idle'} @ ${tag})`);
      assert(val(['fullscreen-clock-mode', ...extra], 'sidebar', 'display', vp) === 'none', `fullscreen clock: no rail (${extra.join('.') || 'idle'} @ ${tag})`);
      assert(val(['fullscreen-clock-mode', ...extra], 'dashboard', 'padding-left', vp) === '0', `fullscreen clock: no rail padding (${extra.join('.') || 'idle'} @ ${tag})`);
    }
    // The spacing token per height: 14px at the default, 10px at the minimum.
    const gap = val(['ns-lobby'], 'panel', '--tonight-gap', vp);
    assert(gap === (vp.height <= 700 ? '10px' : '14px'), `--tonight-gap must be ${vp.height <= 700 ? '10px' : '14px'} at ${tag} (got ${gap})`);
  }

  // Row count and area count agree in both layouts (a mismatch silently adds implicit rows).
  const areaRows = (areas) => (areas.match(/'[^']*'/g) || []).length;
  const rowCount = (rows) => f1SplitWs(rows).length;
  assert(areaRows(AREAS) === rowCount(ROWS), 'wide layout: one row size per area row');
  const NARROW = { width: 700, height: 800 };
  const nRows = val(['ns-lobby'], 'panel', 'grid-template-rows', NARROW);
  const nAreas = val(['ns-lobby'], 'panel', 'grid-template-areas', NARROW);
  assert(nRows && nAreas && /'\.'/.test(nAreas) && areaRows(nAreas) === rowCount(nRows), `narrow layout: spacer rows and one row size per area row (got ${nRows} / ${nAreas})`);
  assert(val(['ns-lobby'], 'strip', 'margin-top', NARROW) === 'auto', 'narrow layout: the rail still rests on the bottom');

  // Mini mode keeps its compact flex column: none of the fill rules apply.
  for (const vp of [DEFAULT, { width: 260, height: 320 }]) {
    assert(val(['mini-mode'], 'panel', 'display', vp) === 'flex', 'mini mode: #ns-panel-lib stays the flex column');
    assert(val(['mini-mode'], 'panel', 'grid-template-rows', vp) === undefined, 'mini mode: no fill rows');
    assert(val(['mini-mode'], 'strip', 'display', vp) === 'none', 'mini mode: the readiness rail stays dropped');
    assert(val(['mini-mode'], 'strip', 'margin-top', vp) !== 'auto', 'mini mode: the fill margin does not apply');
  }
  // Fullscreen clock keeps its own centred flex layout; the rail is hidden there.
  const fsState = ['fullscreen-clock-mode', 'is-running'];
  assert(val(fsState, 'panel', 'display', DEFAULT) === 'flex', 'fullscreen clock: #ns-panel-lib stays its centred flex box');
  assert(val(fsState, 'panel', 'grid-template-rows', DEFAULT) === undefined, 'fullscreen clock: no fill rows');
  assert(val(fsState, 'strip', 'display', DEFAULT) === 'none', 'fullscreen clock: the readiness rail stays hidden');
  assert(val(fsState, 'pill', 'display', DEFAULT) !== 'none', 'fullscreen clock: the truth pill stays visible');

  // The panel fade stays opacity-only.
  const anim = val(['ns-lobby'], 'panel', 'animation', DEFAULT) || '';
  const name = (anim.match(/\b(ns[A-Za-z]+)\b/) || [])[1];
  assert(name, `#ns-panel-lib panel animation expected (got ${anim})`);
  const frames = (css.match(new RegExp(`@keyframes ${name} \\{[^\\n]*\\}|@keyframes ${name} \\{[\\s\\S]*?\\n\\}`)) || [''])[0];
  assert(frames && /opacity/.test(frames) && !/transform/.test(frames), `the ${name} panel animation must be opacity-only`);

  // The fill rules live above the reduced-motion contract.
  const fillAt = css.indexOf('grid-template-rows: auto minmax(0, 1fr) auto auto minmax(var(--tonight-gap), 1fr) auto;');
  assert(fillAt > 0 && fillAt < rmAt, 'the fill rows sit above the reduced-motion contract');
});

// UI-R3 P07: the brand comes alive (living wordmark, ignition, arrival,
// lights-out completion, nav rail, window chrome, mini exit). Behaviour:
// test/brand-alive.test.js (vm sandbox of the renderer helpers).
check('P07 moments: honest lamp moments, scoped arrival, window chrome and the mini exit', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rendererOnly = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

  // Ignition: once, reduced-motion early return, opacity on the room + lamp only.
  assertMatch(p03FnBody(rendererOnly, 'igniteLamp'), /if \(window\.matchMedia && window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/, 'igniteLamp must return early under prefers-reduced-motion');
  assert(!/visibilitychange[^\n]*igniteLamp|igniteLamp[^\n]*visibilitychange/.test(rendererOnly), 'ignition keys off focus, not visibilitychange (backgroundThrottling is off)');

  // Outcome classes: one owner, called from every path the spec names.
  const start = p03FnBody(rendererOnly, 'startTimer');
  assertMatch(start, /if \(outcomeTimer\) clearTimeout\(outcomeTimer\);\s*setOutcomeBodyClass\(null\);\s*render\(\);/, 'the startTimer success path must clear the outcome classes');
  const outcome = p03FnBody(rendererOnly, 'setSessionOutcome');
  assertMatch(outcome, /setOutcomeBodyClass\(kind\);/, 'setSessionOutcome must set the outcome class');
  assertMatch(outcome, /setTimeout\(\(\) => \{[\s\S]*?setOutcomeBodyClass\(null, \{ fade: true \}\);[\s\S]*?\}, 8000\)/, 'the 8 s timeout must end the hold with the plain fade back');
  const payload = p03FnBody(rendererOnly, 'applyTimerPayload');
  const branch = (type) => {
    const at = payload.indexOf(`} else if (data.type === '${type}'`);
    assert(at > 0, `applyTimerPayload '${type}' branch missing`);
    return payload.slice(at, payload.indexOf('} else if', at + 10) > 0 ? payload.indexOf('} else if', at + 10) : payload.indexOf('render();', at));
  };
  const started = branch('started');
  assertMatch(started, /setOutcomeBodyClass\(null\);/, "the 'started' branch must clear the outcome classes");
  assertMatch(started, /playSessionArrival\(\);/, "the arrival plays from the 'started' branch");
  assert((rendererOnly.match(/playSessionArrival\(/g) || []).length === 2, 'playSessionArrival is defined once and called only from the started branch');
  assertMatch(branch('error'), /dropOutcomeHold\(\);/, "an 'error' payload must drop the completion hold");
  assertMatch(branch('dryrun'), /if \(state\.dryRun\) \{[\s\S]*?outcomeSkipConfirmed = true;[\s\S]*?\} else \{\s*dropOutcomeHold\(\);\s*\}/, "a 'dryrun' payload for a REAL run (blocked) must drop the hold; a Test Mode one confirms the skip");
  assertMatch(p03FnBody(rendererOnly, 'dropOutcomeHold'), /state\.lastOutcome = null;[\s\S]*setOutcomeBodyClass\(null\);/, 'dropping the hold clears the outcome and the classes at once');
  const render = p03FnBody(rendererOnly, 'render');
  assertMatch(render, /const outcomeHold = isIdle && \(state\.lastOutcome === 'completed' \|\| state\.lastOutcome === 'dryrun'\);/, 'render() derives the hold from the outcome');
  assertMatch(render, /'no power action ran'/, "'no power action ran' comes only from the confirmed skip");
  assertMatch(render, /state\.lastOutcome === 'dryrun' && state\.outcomeSkipConfirmed \? 'no power action ran' : ''/, "'no power action ran' requires main's skip event");
  assertMatch(render, /completed: 'session complete', dryrun: 'test mode complete'/, 'outcome labels make no past-tense power claim');

  // CSS: the P07 block, the darkness cap, no new layer, scoped arrival.
  const p07 = css.match(/\/\* -- UI-R3 · P07[\s\S]*?(?=\/\* -- UI-R3 · P(?!07)|\/\* -- Reduced motion: one global contract)/);
  assert(p07, 'the UI-R3 · P07 block must sit before the reduced-motion contract');
  assert(css.indexOf('/* -- UI-R3 · P07') < css.indexOf('/* -- Reduced motion: one global contract'), 'P07 CSS sits above the contract');
  const rules = p03CssRules(p07[0]);
  const darkRules = rules.filter(r => /--env-dark\s*:/.test(r.body));
  assert(darkRules.length >= 1, 'the outcome hold must darken the room through --env-dark');
  for (const r of darkRules) {
    const v = Number((r.body.match(/--env-dark\s*:\s*([0-9.]+)/) || [])[1]);
    assert(/outcome-(completed|dryrun)/.test(r.selector) && v > 0 && v <= 0.45, `--env-dark in the hold must be a number <= .45 (${r.selector}: ${v})`);
  }
  assert((htmlSrc.match(/class="env-dark"/g) || []).length === 1, 'P07 adds no new darkness layer');
  assert(!rules.some(r => /(^|;)\s*content\s*:/.test(r.body)), 'P07 adds no pseudo-element layer');
  assert(!/infinite/.test(p07[0]), 'P07 adds no loop');
  for (const r of rules) {
    assert(!/#testmode-pill|data-truth-band|\.ov-truth|\.ll-truth/.test(r.selector), `P07 never names a truth surface (${r.selector})`);
    assert(!(/wm-/.test(r.selector) && /\.test-mode|\.real-action/.test(r.selector)), `the mark never encodes Test Mode / REAL (${r.selector})`);
    if (/wm-o/.test(r.selector)) assert(!/accent-red/.test(r.body), `the wordmark O is never red (${r.selector})`);
    if (/lo-ignite/.test(r.selector)) {
      for (const sel of r.selector.split(',')) assert(/\.night-env$|\.wm-beam$|\.wm-lens$/.test(sel.trim()), `ignition animates only the room, beam and lens (${sel.trim()})`);
    }
    if (!/session-arrive/.test(r.selector)) continue;
    for (const sel of r.selector.split(',').map(x => x.trim())) {
      if (/:nth-child/.test(sel)) assert(/^body\.session-arrive #action-bar-running > :nth-child\(/.test(sel), `arrival stagger must be fully qualified (${sel})`);
      assert(!/testmode-pill|readiness-strip|time-label|modal|overlay|truth/.test(sel), `arrival must not target truth surfaces or dialogs (${sel})`);
    }
    if (/#action-bar-running/.test(r.selector) && /animation\s*:/.test(r.body)) {
      const name = (r.body.match(/animation\s*:\s*([a-zA-Z-]+)/) || [])[1];
      const frames = (p07[0].match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`)) || [''])[0];
      assert(frames && !/opacity/.test(frames), 'the console rises by transform only (Pause and Cancel never start hidden)');
    }
  }
  assertMatch(p07[0], /body\.session-arrive \.time-main \{ animation: digitsArrive/, 'the digits arrival exists');
  assertMatch(p07[0], /@keyframes digitsArrive \{\s*from \{ opacity: 0\.4;/, 'the digits start at opacity >= .4');
  for (const r of rules) {
    if (/2\.4s/.test(r.body) && /transition/.test(r.body)) assert(/outcome-(completed|dryrun)/.test(r.selector), `the 2.4 s fade is scoped to the outcome classes (${r.selector})`);
  }
  assertMatch(css, /\.night-beam \{[^}]*transition: opacity 1\.2s linear;/, 'the base beam keeps its plain 1.2 s fade');

  // Window chrome: SVG glyphs only, grammar-correct hovers, no transition: all.
  const winBtns = htmlSrc.match(/<button class="win-btn[^"]*"[\s\S]*?<\/button>/g) || [];
  assert(winBtns.length === 4, 'four window buttons expected');
  for (const b of winBtns) {
    assertMatch(b, /<svg class="chip-glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">/, 'every .win-btn holds svg.chip-glyph');
    assert(b.replace(/<[^>]+>/g, '').trim() === '', 'no text glyph inside a .win-btn');
  }
  for (const id of ['btn-fullscreen-clock', 'btn-fullscreen-clock-exit']) {
    const at = htmlSrc.indexOf(`id="${id}"`);
    const btn = htmlSrc.slice(at, htmlSrc.indexOf('</button>', at));
    assert(/<svg class="chip-glyph"/.test(btn) && !/&#x/.test(btn), `#${id} uses an SVG glyph`);
  }
  const allRules = p03CssRules(css);
  for (const r of allRules) {
    if (/\.win-btn\.close:hover/.test(r.selector)) assert(!/accent-red/.test(r.body), 'close-to-tray hover is neutral, never REAL red');
    if (/\.win-btn\.mini:hover/.test(r.selector)) assert(!/accent-amber/.test(r.body), 'mini hover is violet, never Test Mode amber');
    if (/^\.win-btn$/.test(r.selector)) assert(!/transition:\s*all/.test(r.body) && !/font-size/.test(r.body), '.win-btn uses token transitions and no dead font-size');
  }
  assert(allRules.some(r => /\.win-btn:focus-visible/.test(r.selector)), '.win-btn needs a :focus-visible ring');

  // Mini exit: outside the transformed ring section, wired, below dialogs.
  const miniAt = htmlSrc.indexOf('<button class="mini-exit" id="btn-mini-exit" title="Back to full view (Ctrl+M)" aria-label="Exit mini mode">');
  assert(miniAt > 0 && miniAt < htmlSrc.indexOf('<section class="timer-section">'), '#btn-mini-exit must exist before (outside) .timer-section');
  assertMatch(rendererOnly, /document\.getElementById\('btn-mini-exit'\)\?\.addEventListener\('click', toggleMiniMode\);/, '#btn-mini-exit must toggle mini mode');
  const miniRule = rules.find(r => r.selector === 'body.mini-mode .mini-exit');
  assert(miniRule && /z-index:\s*1400/.test(miniRule.body) && /width:\s*26px/.test(miniRule.body), 'the mini exit is a 26px button at z-index 1400 (below every safety dialog)');
  assert(rules.some(r => /body\.mini-mode:has\(\.modal\.active/.test(r.selector) && /(\.mini-exit|:is\(\.mini-exit, \.mini-grab\))$/.test(r.selector) && /display:\s*none/.test(r.body)), 'the mini exit hides while any dialog is open');
  assert(allRules.some(r => /body\.mini-mode \.readiness-strip/.test(r.selector) && /body\.mini-mode \.armed-mode-banner/.test(r.selector) && /display:\s*none/.test(r.body)), 'mini mode drops the readiness rail and the Night Mode banner');
  const miniPill = allRules.find(r => r.selector === 'body.mini-mode #testmode-pill');
  assert(miniPill && Number((miniPill.body.match(/font-size:\s*([0-9.]+)px/) || [])[1]) >= 10.5 && /white-space:\s*normal/.test(miniPill.body) && !/display:\s*none|opacity|ellipsis/.test(miniPill.body), 'the mini truth pill is >= 10.5px, wraps, and is never hidden or truncated');
  assert(allRules.some(r => r.selector === 'body.mini-mode .ring-container' && /width:\s*176px/.test(r.body)), 'the mini ring is 176px');
});

// UI-R3 P08: Devices is the hub. This PC is the host strip, home PCs get
// honest Pause / Resume / Stop with the real answer, the pairing token only
// goes to announced peers, and live signals come from real events.
check('P08 Devices: host strip, honest family control, live signals', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rendererOnly = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const familyRemoteSrc = fs.readFileSync(path.join(root, 'renderer-family-remote.js'), 'utf8');
  const familySrc = fs.readFileSync(path.join(root, 'family.js'), 'utf8');
  const rcModule = require(path.join(root, 'remoteControl.js'));

  // LAN protocol unchanged (a read-only status command needs owner sign-off).
  assert(!rcModule.ALLOWED_COMMANDS.includes('status'), "the LAN protocol must not grow a 'status' command without owner sign-off");
  assert(!/familyPeerStatus|family-peer-status/.test(preloadSrc + mainSrc), 'no new family status IPC/preload channel without owner sign-off');

  // Known peers only: every family-remote-* handler refuses before sending.
  const handlers = [...mainSrc.matchAll(/ipcMain\.handle\('(family-remote-[a-z]+)', async \(e, ip[^)]*\) => \{([\s\S]*?)\n\}\);/g)];
  assert(handlers.length === 5, `expected 5 family-remote-* handlers, found ${handlers.length}`);
  for (const [, name, body] of handlers) {
    const guardAt = body.indexOf('if (!family.isKnownPeer(ip)) return { ...UNKNOWN_FAMILY_PEER };');
    const sendAt = body.search(/family\.remote[A-Z]/);
    assert(guardAt >= 0 && sendAt > guardAt, `${name} must check family.isKnownPeer(ip) before sending`);
  }
  assertMatch(mainSrc, /const UNKNOWN_FAMILY_PEER = Object\.freeze\(\{ success: false, error: 'unknown peer' \}\);/, 'unknown peers resolve {success:false, error:"unknown peer"}');
  assertMatch(familySrc, /function isKnownPeer\(ip\) \{[\s\S]*?return getPeers\(\)\.some\(peer => peer\.ip === ip\);/, 'isKnownPeer must read the live (expiring) peer list');
  // Never fabricate success from a peer answer.
  const answer = p03FnBody(familySrc, 'interpretCommandAnswer');
  assertMatch(answer, /if \(ok2xx && parsed\.success === true\)/, 'success only for a 2xx answer that says success:true');
  assert(!/resolve\(\{ success: true \}\)/.test(familySrc), 'sendRemoteCommand must never resolve a bare success');
  assertMatch(p03FnBody(familySrc, 'sendRemoteCommand'), /res\.on\('end', \(\) => resolve\(interpretCommandAnswer\(res\.statusCode, body\)\)\);/, 'sendRemoteCommand must interpret the status code and body');

  // One result interpreter; familyRemote reports through it.
  const interp = p03FnBody(familyRemoteSrc, 'interpretPeerResult');
  assertMatch(interp, /if \(r\.success === true\)/, 'interpretPeerResult must read .success');
  assertMatch(interp, /\/Timeout\/\.test\(message\)[\s\S]*?'No answer \(timed out\)'[\s\S]*?'Could not reach that PC'/, 'timeouts and unreachable peers read as errors');
  for (const code of ['PAUSED', 'RESUMED', 'CANCELLED', 'NOT_RUNNING', 'NOT_PAUSED', 'RUN_ACTIVE', 'STARTED', 'START_REJECTED', 'STATUS', 'INVALID', 'UNKNOWN_COMMAND']) {
    assert(new RegExp(`\\b${code}: '`).test(familyRemoteSrc), `PEER_RESULT must cover ${code}`);
  }
  assertMatch(familyRemoteSrc, /unauthorized: \{ text: 'Pairing code differs on that PC'/, 'unauthorized must read as a pairing mismatch');
  assertMatch(familyRemoteSrc, /'unknown peer': \{ text: 'That PC is no longer announcing itself'/, 'unknown peer must be explained');
  assert(!rendererSrc.includes('Command sent to'), "no 'Command sent to' anywhere: report the real answer");
  const remoteFnAt = familyRemoteSrc.indexOf('window.familyRemote = async function(ip, action, duration) {');
  assert(remoteFnAt > 0, 'window.familyRemote signature must stay');
  const remoteFn = familyRemoteSrc.slice(remoteFnAt, familyRemoteSrc.indexOf('\n};', remoteFnAt));
  assertMatch(remoteFn, /answer = await call\(\);[\s\S]*?const outcome = interpretPeerResult\(answer, failure\);/, 'familyRemote must await and interpret the answer');

  // Settings: Start only through the inline confirm, Keep idle focused.
  const settingsWire = p03FnBody(familyRemoteSrc, 'setupFamilyPeerSettingsHandlers');
  assertMatch(settingsWire, /if \(action === 'start'\) openFamilyStartConfirm\(ip\);/, 'Settings Start must open the confirm row');
  const startCalls = settingsWire.match(/familyRemote\(ip, 'start'/g) || [];
  assert(startCalls.length === 1 && /if \(confirmed\) void window\.familyRemote\(ip, 'start', 30\);/.test(settingsWire), 'the only start call is behind the confirmed IP');
  const openConfirm = p03FnBody(familyRemoteSrc, 'openFamilyStartConfirm');
  assertMatch(openConfirm, /keep\.textContent = 'Keep idle';[\s\S]*?keep\.focus\(\);/, "the confirm focuses 'Keep idle'");
  assertMatch(openConfirm, /text\.textContent = familyStartConfirmText\(name, ip, null\);/, 'the confirm never claims a peer mode it has not read');
  assertMatch(p03FnBody(familyRemoteSrc, 'renderFamilyPeers'), /familyStartConfirmIp = null;/, 'a re-render cancels a pending confirm');
  assert(!/&#x1F5A5;|&#x25B6;|&#x23F8;|&#x274C;|&#x1F4F1;/.test(familyRemoteSrc), 'family and Wi-Fi rows carry no emoji');

  // Devices peer rows: pause / resume / cancel only, text-only DOM, one listener.
  const actionsAt = rendererOnly.indexOf('const DEVICE_PEER_ACTIONS = Object.freeze([');
  assert(actionsAt > 0, 'DEVICE_PEER_ACTIONS missing');
  const actions = rendererOnly.slice(actionsAt, rendererOnly.indexOf(']);', actionsAt));
  const acts = [...actions.matchAll(/act: '([a-z]+)'/g)].map(m => m[1]);
  assert(JSON.stringify(acts) === JSON.stringify(['pause', 'resume', 'cancel']), `Devices peer actions must be pause/resume/cancel only, got ${acts}`);
  assert(!/familyRemoteStart|'start'/.test(actions + p03FnBody(rendererOnly, 'runDevicePeerAction')), 'Devices never starts a run on another PC');
  for (const fn of ['buildDevicePeerRow', 'updateDevicePeerRow', 'applyFamilyPeers']) {
    assert(!/innerHTML/.test(p03FnBody(rendererOnly, fn)), `${fn} writes text only (a peer name comes from the LAN)`);
  }
  const devicesFn = p03FnBody(rendererOnly, 'renderDevicesPanel');
  assert(!/addEventListener/.test(devicesFn), 'renderDevicesPanel binds no listeners');
  assertMatch(rendererOnly, /els\.deviceFamilyPeers\?\.addEventListener\('click',/, 'one delegated peer listener');
  // The 5 s refresh starts with Devices and stops with any other panel.
  const visibility = p03FnBody(rendererOnly, 'applyMainPanelVisibility');
  assertMatch(visibility, /if \(panel === 'devices'\) \{\s*if \(typeof startFamilyPeerRefresh === 'function'\) startFamilyPeerRefresh\(\);\s*\} else if \(typeof stopFamilyPeerRefresh === 'function'\) \{\s*stopFamilyPeerRefresh\(\);/, 'the peer refresh hooks are typeof-guarded in applyMainPanelVisibility');
  assertMatch(p03FnBody(rendererOnly, 'handleSidebarNavigation'), /if \(tab === 'devices'\) \{[\s\S]*?if \(typeof startFamilyPeerRefresh === 'function'\) startFamilyPeerRefresh\(\);/, 'the Devices branch starts the refresh, typeof-guarded');
  assertMatch(rendererOnly, /const FAMILY_PEER_REFRESH_MS = 5000;/, 'peer refresh every 5 s');

  // Shared lights reading.
  assertMatch(p03FnBody(rendererOnly, 'updateReadiness'), /describeLightsReadiness\(lights\)/, 'updateReadiness must use describeLightsReadiness');
  assertMatch(devicesFn, /describeLightsReadiness\(lights\)/, 'renderDevicesPanel must use describeLightsReadiness');
  // Lights check is passive only and never saved.
  const checkAt = rendererOnly.indexOf("els.btnDeviceLightsCheck?.addEventListener('click'");
  assert(checkAt > 0, 'lights check listener missing');
  const check = rendererOnly.slice(checkAt, rendererOnly.indexOf('\n});', checkAt));
  assert(/api\.testSmartLightConnection\?\.\(\)/.test(check) && !/testSmartLightAction|saveSmartLightConfig|verifiedConfigKey|setDeviceCard/.test(check), 'the lights check is passive, unsaved, and leaves the card state alone');

  // Wi-Fi Guard 'Right now': only events and real successes.
  const liveSets = rendererSrc.match(/window\.wifiGuardLive\s*=/g) || [];
  assert(liveSets.length === 1 && /function noteWifiGuardLive\(blocked\) \{\s*window\.wifiGuardLive = \{ blocked: Boolean\(blocked\), at: Date\.now\(\) \};/.test(rendererOnly), 'wifiGuardLive is written only by noteWifiGuardLive');
  const noteCalls = [...rendererSrc.matchAll(/^.*noteWifiGuardLive\((?!blocked\)).*$/gm)].map(m => m[0].trim());
  for (const line of noteCalls) {
    assert(/^noteWifiGuardLive\(Boolean\(data\.blocked\)\);$|^if \(result\?\.success\) noteWifiGuardLive\((true|false)\);$|^if \(restored\) noteWifiGuardLive\(false\);$/.test(line), `noteWifiGuardLive only from the event or a real success: ${line}`);
  }
  assertMatch(rendererOnly, /api\.onWifiGuardStatus\?\.\(data => \{[\s\S]*?noteWifiGuardLive\(Boolean\(data\.blocked\)\);/, 'the wifi-guard-status event feeds the live row');
  assertMatch(rendererOnly, /if \(r\?\.success\) \{\s*restored = true;/, 'Restore succeeds only on a real success');
  assertMatch(rendererOnly, /els\.btnDeviceWifiRestore\.hidden = !blockedNow \|\| runActive;/, 'Restore shows only while paused and no run is active');
  assertMatch(rendererOnly, /'Wi-Fi Guard not configured'/, 'an error-less failure reads as not configured');

  // Ids exactly once; off hints are static HTML only.
  for (const id of ['device-wifi-now', 'btn-device-wifi-restore', 'btn-device-lights-check', 'device-phone-rejected-row', 'wifi-selected-summary', 'device-pc-plan-row', 'power-plan',
    // UI-R3 Fire 07
    'device-pc-battery-row', 'device-wifi-adapter-note', 'device-wifi-count-label', 'device-lights-scope', 'device-wifi-scope', 'device-phone-error']) {
    assert((htmlSrc.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1, `${id} must exist exactly once`);
  }
  // Fire 07: the hints say what each satellite does (the status pill still
  // says 'Off'), so none repeats the 'Off.' prefix.
  const hints = [...htmlSrc.matchAll(/<p class="device-off-hint">([^<]+)<\/p>/g)].map(m => m[1]);
  assert(hints.length === 4, `four static off hints expected, found ${hints.length}`);
  assert(hints.every(h => !/^Off\./.test(h)), 'no off hint starts with "Off."');
  const familyHint = htmlSrc.slice(htmlSrc.indexOf('id="device-card-family"'), htmlSrc.indexOf('id="device-card-lights"')).match(/<p class="device-off-hint">([^<]+)<\/p>/);
  assert(familyHint && /Same Wi-Fi/.test(familyHint[1]), 'the Family hint names the real requirement (Same Wi-Fi)');
  assert(!/device-off-hint/.test(rendererSrc), 'off hints are static HTML; the renderer never writes them');

  // CSS: the host strip can never be hidden, the block sits above reduced motion.
  const p08At = css.indexOf('/* -- UI-R3 · P08');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(p08At > 0 && p08At < rmAt, 'the P08 block sits above the reduced-motion contract');
  // P08's own block ends at the next UI-R3 package block (or the contract),
  // so later packages' blocks are judged by their own checks (as for P01).
  const p08Next = css.indexOf('/* -- UI-R3 · P', p08At + 10);
  const p08Block = css.slice(p08At, p08Next > p08At && p08Next < rmAt ? p08Next : rmAt);
  assert(!/animation|@keyframes/.test(p08Block), 'P08 adds no animation');
  for (const r of p03CssRules(css)) {
    if (!/display:\s*none/.test(r.body)) continue;
    for (const sel of r.selector.split(',').map(x => x.trim())) {
      if (/\.device-rows$/.test(sel)) assert(/:not\(#device-card-pc\)|#device-card-(phone|family|lights|wifi)/.test(sel), `no rule may hide #device-card-pc .device-rows: ${sel}`);
    }
  }
  const pcValue = p03CssRules(css).find(r => r.selector === '#device-card-pc .device-rows .status-row > span:last-child');
  assert(pcValue && !/color:/.test(pcValue.body), 'the strip sets no value colour, so Test Mode amber and REAL red win');
  assert(p03CssRules(css).some(r => r.selector === '.device-grid' && /repeat\(2, minmax\(0, 1fr\)\)/.test(r.body)), 'two-column device grid');
  assert(p03CssRules(css).some(r => r.selector === '#device-card-pc' && /grid-column:\s*1 \/ -1/.test(r.body)), 'This PC spans the full width');
  assert(p03CssRules(css).some(r => r.selector === '.device-peers .device-peer' && /display:\s*grid/.test(r.body)), '.device-peer must beat .device-peers li{display:flex}');

  // Wi-Fi Guard selection truth.
  assert(!/BLOCKED|click to block/.test(familyRemoteSrc), "a selected device is never labelled 'BLOCKED'");
  const wifiFn = p03FnBody(familyRemoteSrc, 'renderWifiDevices');
  assertMatch(wifiFn, /<button type="button" class="wifi-device set-device\$\{selected \? ' is-selected' : ''\}"[^>]*aria-pressed=/, 'scanned devices are aria-pressed buttons');
  assert(!/style="/.test(wifiFn), 'no inline style in the device rows');
  assertMatch(wifiFn, /selected \? 'Selected' : 'Select'/, "rows say 'Selected' / 'Select'");
  assert(!/\.wifi-guard-section \.wifi-device/.test(css), 'the dead .wifi-guard-section .wifi-device rules are gone');
  assert(p03CssRules(css).some(r => r.selector === '.set-device:focus-visible'), '.set-device needs a focus ring');
});

// UI-R3 P09: the phone reads like the desktop. One link bar, a ring that
// shows pause truthfully, an honest "Last known" offline state, a branded
// pairing screen, real control semantics and Night Modes up front with the
// same unavailable vocabulary as the desktop.
check('P09 phone: link bar, ring truth, honest stale, pairing, controls and Night Modes', () => {
  const html = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  const nmDesktop = fs.readFileSync(path.join(root, 'renderer-night-modes.js'), 'utf8');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const rules = p03CssRules(style);
  const reducedAt = style.indexOf('@media (prefers-reduced-motion: reduce)');
  const p09At = style.indexOf('UI-R3 · P09 phone');
  assert(p09At > 0 && reducedAt > p09At, 'the P09 CSS block must sit above the companion reduced-motion block');
  assertMatch(style.slice(reducedAt), /\*, \*::before, \*::after \{ animation: none !important; transition-duration: 0\.01ms !important; \}/, 'companion reduced-motion contract must still cover every animation');

  // Ring and beam truth.
  assertMatch(html, /const PHASE_COLORS = \{[^}]*paused: '#f5b83d'[^}]*\};/, 'PHASE_COLORS needs an amber paused entry');
  // Fire 05: the paused branch lives in ringPhaseKey (paused wins first).
  assertMatch(html, /setRing\(running && total > 0 \? remaining \/ total : 0, ringPhaseKey\(running, paused, phase, data\.dryRun\)\);/, 'setRing must use a paused branch and keep the remaining fraction');
  assertMatch(p03FnBody(html, 'ringPhaseKey'), /^\{\s*if \(paused\) return 'paused';/, 'ringPhaseKey: paused wins first');
  assert(!rules.some(r => /is-paused/.test(r.selector) && /ring-progress/.test(r.selector) && /stroke-dasharray/.test(r.body)), 'no stroke-dasharray rule on .ring-progress under is-paused');
  assert(rules.some(r => r.selector === 'body.is-paused.ring-live .ring-head' && /opacity:\s*0/.test(r.body)), 'paused hides the ring head');
  assert(rules.some(r => r.selector === 'body::before' && /opacity:\s*calc\(0\.35 \+ 0\.65 \* var\(--lights-level, 1\)\)/.test(r.body)), 'the beam lives on body::before and follows --lights-level');
  assert(!rules.some(r => /saturate/.test(r.body)), 'no saturate filter on the phone');
  assertMatch(html, /Math\.min\(1, Math\.max\(0\.25, level\)\) : 1;/, '--lights-level is clamped to [.25, 1] with a NaN fallback of 1');

  // Link bar.
  const barAt = html.indexOf('<div class="link-bar" id="link-bar">');
  const ringAt = html.indexOf('<div class="ring-wrap">');
  assert(barAt > html.indexOf('<div class="brand"') && barAt < ringAt, '#link-bar must sit after .brand and before .ring-wrap');
  const bar = html.slice(barAt, ringAt);
  for (const id of ['status-pill', 'pc-name', 'freshness']) assert(bar.includes(`id="${id}"`), `#link-bar must contain #${id}`);
  assert(html.includes("' · older protocol'") && html.includes("' · older desktop'"), "the 'older protocol' and 'older desktop' caveats must stay");
  const pcLabel = p03FnBody(html, 'refreshPcLabel');
  assert(/pcEl\.replaceChildren\(/.test(pcLabel) && !/innerHTML/.test(pcLabel), 'the PC label (LAN data) is built with replaceChildren/textContent only');
  assertMatch(pcLabel, /'Target PC: '/, "the PC label keeps 'Target PC:'");
  assert(html.includes('id="pc-version"'), 'the plain desktop version moves to #pc-version in Details');
  assert(!/live/i.test(p03FnBody(html, 'updateFreshness').replace(/\/\/.*$/gm, '')), "freshness never says 'live'");
  assertMatch(html, /'Updated just now' : `Updated \$\{ageSeconds\}s ago`/, "freshness keeps the 'Updated' prefix");
  assert(!rules.some(r => /stale-state/.test(r.selector) && /link-bar|status-pill|pc-name|freshness|safety-row|safety-badge/.test(r.selector)), 'stale-state never dims the link bar or the safety badge');

  // Honest stale.
  assert(!/line-through/.test(style), 'no line-through on the stale reading');
  assertMatch(html, /<div class="stale-tag" id="stale-tag" hidden>Last known<\/div>/, '#stale-tag markup missing');
  assertMatch(p03FnBody(html, 'syncStaleTag'), /classList\.contains\('stale-state'\) && latestState/, "'Last known' shows only while stale with a real state");
  for (const fn of ['stateIsAuthoritative', 'syncMutationControls']) assert(!/lastSeenAt/.test(p03FnBody(html, fn)), `${fn} must never read lastSeenAt`);
  assertMatch(html, /lastStateReceivedAt = Date\.now\(\);\s*lastSeenAt = lastStateReceivedAt;/, 'lastSeenAt is set beside lastStateReceivedAt');
  assertMatch(p03FnBody(html, 'forgetLastKnownState'), /latestState = null;\s*lastSeenAt = 0;/, 'a pairing reset clears latestState and lastSeenAt');
  assertMatch(p03FnBody(html, 'showPairing'), /forgetLastKnownState\(\);/, 'showPairing forgets the last reading');
  assertMatch(html, /<div class="timer-main" id="timer-main">—<\/div>/, "never-received state shows '—', not '--:--'");
  assert(!/id="timer-label">Idle</.test(html), "never-received state never says 'Idle'");
  const staleLast = style.lastIndexOf('.stale-state .ring');
  assert(staleLast > style.indexOf('body.is-paused.ring-live .ring-head') && staleLast > style.indexOf('body::before'), 'stale rules come after the new ring/beam rules');

  // Pairing.
  assertMatch(p03FnBody(html, 'setPairingVisible'), /document\.body\.classList\.toggle\('is-pairing', visible\);/, 'one helper keeps body.is-pairing in sync with the pair card');
  assertMatch(p03FnBody(html, 'setConnectionState'), /if \(state === 'connected'\) \{\s*setPairingVisible\(false\);/, 'is-pairing must be cleared on the connected path');
  const pairHide = rules.find(r => /\.ring-wrap/.test(r.selector) && /display:\s*none/.test(r.body) && /is-pairing/.test(r.selector));
  assert(pairHide && pairHide.selector.split(',').every(s => s.trim().startsWith('body.is-pairing ')), 'the pairing hide rule is scoped to body.is-pairing');
  assert(!/pair-status/.test(pairHide.selector), 'the role=alert pairing status is never hidden while pairing');
  assert(html.includes('Phone Companion → Same Wi-Fi') && !html.includes('Remote Control settings'), 'pairing copy names Settings › Phone Companion › Same Wi-Fi');

  // Accessibility meta and the ending selector.
  assert(!/user-scalable=no|maximum-scale/.test(html), 'the viewport must allow pinch-zoom');
  assertMatch(html, /<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">/, 'viewport-fit=cover for safe areas');
  // Fire 06: re-anchored on the seg's own closing tag (the Quick start label is gone).
  const segAt = html.indexOf('id="action-seg"');
  const seg = html.slice(segAt, html.indexOf('</div>', segAt));
  const segButtons = seg.match(/<button class="seg-btn[^"]*"[^>]*>/g) || [];
  assert(segButtons.length === 3 && segButtons.every(b => /aria-pressed="(true|false)"/.test(b)), 'every #action-seg button carries aria-pressed');
  assert(/class="seg-btn active" data-action="shutdown"[^>]*aria-pressed="true"/.test(seg), "the 'shutdown' default is pressed");
  assertMatch(p03FnBody(html, 'syncActionSegTruth'), /latestState\.dryRunPolicy === false && stateIsAuthoritative\(\)/, 'is-real only for an authoritative REAL policy');
  assert(rules.some(r => r.selector === '#action-seg.is-real .seg-btn.active' && /var\(--danger\)/.test(r.body)), 'REAL policy draws a red underline on the active ending');

  // Active controls.
  const addButtons = html.match(/<button class="btn btn-addtime timer-mutation" data-add-seconds="\d+"[^>]*>\+\d+<\/button>/g) || [];
  assert(addButtons.length === 3 && addButtons.every(b => /aria-label="Add \d+ minutes"/.test(b)), 'add-time buttons are violet .btn-addtime with exact +N text and an aria-label');
  assert(!/btn-amber/.test(html), 'no amber add-time buttons');
  assert(!/btnPause\.textContent\s*=/.test(html), 'handleUpdate sets only the Pause label span, never btnPause.textContent');
  assertMatch(html, /btnPause\.classList\.toggle\('btn-primary', paused\);/, 'Resume becomes the primary action');
  assertMatch(html, /id="btn-cancel" type="button"><svg class="btn-glyph"[^>]*><rect[^>]*\/><\/svg>Stop tonight’s run<\/button>/, "Stop keeps its exact (sentence-case, Fire 05) text with a text-free glyph");

  // Night Modes up front, one vocabulary.
  assert(html.includes('let nmGridVisible = true;'), 'Night Modes are visible by default');
  assertMatch(html, /class="night-mode-grid visible" id="night-mode-grid"/, 'the grid ships with the visible class');
  const nmAt = html.indexOf('id="night-mode-section"');
  // Fire 06: the plan card (with 'Ends with' inside it) comes first, then
  // the Night Modes, so the ending visibly applies only to the plan.
  const planAt = html.indexOf('<section class="plan-card" id="plan-card"');
  const planEnd = html.indexOf('</section>', planAt);
  assert(planAt > html.indexOf('id="idle-safety-banner"') && planAt < nmAt, 'the plan card sits below the safety banner and precedes #night-mode-section');
  assert(html.indexOf('id="action-seg"') > planAt && html.indexOf('id="action-seg"') < planEnd, '#action-seg sits inside #plan-card');
  assert(html.includes('id="nm-unavailable"'), '#nm-unavailable missing');
  assert(!/role="list"[^>]*id="night-mode-grid"|id="night-mode-grid"[^>]*role="list"/.test(html), 'the grid no longer claims list semantics without listitems');
  const grid = p03FnBody(html, 'renderNightModeGrid');
  assertMatch(grid, /mode\.status === 'ready'/, 'only ready modes become cards');
  assert(!/\bbtn\b/.test(grid.replace(/createElement\('button'\)/g, '')), 'Night Mode cards carry no .btn class');
  assert(!/&#x1F525;/.test(html) && !/\\u26A0/.test(html), 'no emoji in companion.html');
  assert(!rules.some(r => /night-mode-tag\.status/.test(r.selector) && /amber|#d4a50a|245,\s*184,\s*61/.test(r.body)), 'no amber unavailable status tag');
  const label = p03FnBody(html, 'getNmStatusLabel');
  assert(!/availability/.test(label) && /'Coming later'/.test(label), "the status tag never returns availability.reason, and says 'Coming later'");
  for (const text of ["'Coming later'", "'Needs router control'", "'Needs device setup'", "'Unavailable'"]) {
    assert(label.includes(text), `phone label ${text} missing`);
    assert(nmDesktop.includes(text.replace(/'/g, '')), `desktop label ${text} missing (parity)`);
  }
  assert(!/COMING SOON|Coming soon|NEEDS SETUP<|COMING LATER/.test(`${html}\n${nmDesktop}`), 'old unavailable wording is gone on both surfaces');
  assertMatch(html, /'Loading bedtime modes…'/, 'loading copy only while refreshing');
  assertMatch(html, /'No Night Modes are ready on this PC'/, 'truthful empty state');
  assert(!/textContent = availability|innerHTML = [^;]*reason/.test(html), 'reasons are rendered with textContent only');

  // Sheets and motion: open-only entrance, opacity/transform keyframes.
  for (const name of ['p09ScrimIn', 'p09SheetIn']) {
    const kf = style.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\}\\s*\\}`));
    assert(kf && !/(?:^|[{;\s])(?!opacity|transform)[a-z-]+\s*:/.test(kf[1].replace(/(from|to)\s*\{/g, '')), `${name} animates only opacity/transform`);
  }
  assert(rules.filter(r => /animation:/.test(r.body) && /p09/.test(r.body)).every(r => r.selector.split(',').every(s => /\.show\b/.test(s))), 'sheet animations play only while opening (.show)');
  // Fire 06: 'Lights out ≈' lives only in the Start sheet (the start-now
  // estimate of a plan the user is about to start), never in the ring.
  const approxLights = html.match(/Lights out ≈/g) || [];
  assert(!/grabber/.test(style) && approxLights.length === 2 && html.indexOf('Lights out ≈') > html.indexOf('id="start-sheet"') && p03FnBody(html, 'renderStartSheet').includes("'Lights out ≈'"), 'no grabber, and "Lights out ≈" only in the Start sheet');
  assert(rules.some(r => r.selector === '.btn' && /border-color/.test(r.body) && /var\(--dur-fast\)/.test(r.body)), '.btn transition keeps border-color on the motion tokens');

  // Fix round 1: Details warn beats the neutral value rule in the cascade.
  const spec = sel => (sel.match(/#[\w-]+/g) || []).length * 100 + (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const indexed = rules.map((r, i) => ({ ...r, i }));
  const warnSels = indexed.filter(r => /color:\s*var\(--amber\)/.test(r.body)).flatMap(r => r.selector.split(',').map(s => s.trim()).filter(s => /\.comp-metric--warn$/.test(s)).map(s => ({ s, i: r.i })));
  const neutralSels = indexed.filter(r => /(?:^|[;\s])color:/.test(r.body)).flatMap(r => r.selector.split(',').map(s => s.trim()).filter(s => /\.comp-metric-value$/.test(s) && !/comp-metric--warn/.test(s)).map(s => ({ s, i: r.i })));
  assert(warnSels.length && neutralSels.length, 'Details needs both a neutral value colour and an amber warn rule');
  const beats = (a, b) => spec(a.s) > spec(b.s) || (spec(a.s) === spec(b.s) && a.i > b.i);
  assert(warnSels.some(w => neutralSels.every(n => beats(w, n))), '.comp-metric--warn must beat the neutral .comp-metric-value colour in the cascade');
  // The Test/REAL ring label is never faded by the stale dim.
  assert(!rules.some(r => /stale-state/.test(r.selector) && /timer-label/.test(r.selector) && /opacity/.test(r.body)), 'stale-state never fades the Test/REAL ring label');
  // The ticking last-seen age stays out of the polite live region.
  assertMatch(html, /freshnessAge\.setAttribute\('aria-hidden', 'true'\);/, 'the last-seen age is aria-hidden');
  assert(!/withLastSeen|freshnessEl\.textContent\s*=/.test(html), 'freshness text goes through setFreshness (static live text, aria-hidden age)');
  assert(rules.some(r => r.selector === '.nm-unavailable .night-mode-tag.status' && /text-transform:\s*none/.test(r.body)), "the phone shows 'Coming later' in sentence case like the desktop");
  const forget = p03FnBody(html, 'forgetLastKnownState');
  assert(/desktopHello = null;/.test(forget) && /pcVersionEl\.hidden = true;/.test(forget), "a pairing reset forgets the previous PC's hello and version");

  // P01's dryRun-keyed ring label rule is still present (Fire 05 copy:
  // Test -> 'Test · no …', REAL -> 'then …', unknown -> 'until end').
  const ringLabel = p03FnBody(html, 'phoneRingLabel');
  assertMatch(ringLabel, /if \(dryRun === true\) return `Test · no \$\{words \? words\.noun : 'power action'\}`;/, "P01's dryRun-keyed ring label: Test reads 'Test · no …'");
  assertMatch(ringLabel, /if \(dryRun === false\) return words \? `then \$\{words\.verb\}` : 'until end';\s*return 'until end';/, "P01's dryRun-keyed ring label: REAL reads 'then …', unknown 'until end'");
});

// UI-R3 Fire 05: the phone run is the desktop's instrument in the hand. A
// thin arc with the broken O outside it, a masked paused cut, phase colours
// that never paint a Test Mode Last Light red, the instrument face, phone
// clocks in the phone's format, a thumb dock scoped to a run, the PC name as
// the hero, a calm paused state and an honest receipt after a stop.
// Behaviour: test/companion.test.js ('Fire 05' tests).
check('Fire 05 phone run: instrument ring, phase truth, phone clock, thumb dock, calm pause, honest stop', () => {
  const vm = require('vm');
  const html = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const rules = p03CssRules(style);
  const fireAt = style.indexOf('UI-R3 · Fire 05: phone run');
  const staleAt = style.indexOf('Stale wins (kept last)');
  const reducedAt = style.indexOf('@media (prefers-reduced-motion: reduce)');
  assert(fireAt > style.indexOf('UI-R3 · P09 phone') && fireAt < staleAt && staleAt < reducedAt, 'the Fire 05 block sits after P09, above the stale block and the reduced-motion contract');
  const fire06At = style.indexOf('UI-R3 · Fire 06: phone at rest');
  const fire = style.slice(style.lastIndexOf('/*', fireAt), style.lastIndexOf('/*', fire06At > fireAt ? fire06At : staleAt));
  const fireRules = p03CssRules(fire);

  // Type: system fonts only, the instrument face on the digits.
  assertMatch(style, /button, input, select, textarea \{ font-family: inherit; \}/, 'the companion form-control font-family inherit reset is missing');
  const instrument = style.match(/--font-instrument:\s*([^;]+);/);
  assert(instrument && /'Bahnschrift'/.test(instrument[1]) && !/url\(/.test(instrument[1]), '--font-instrument must be a system-font stack led by Bahnschrift');
  assert(!/@font-face/.test(style), 'no @font-face (no downloaded fonts)');
  assert(fireRules.some(r => r.selector === '.timer-main' && /font-family:\s*var\(--font-instrument\)/.test(r.body)), '.timer-main uses the instrument face');
  const tag = fireRules.filter(r => r.selector === '.night-mode-tag').pop();
  assert(tag && parseFloat((tag.body.match(/font-size:\s*([\d.]+)px/) || [])[1]) >= 10.5 && /text-transform:\s*none/.test(tag.body), '.night-mode-tag is >= 10.5px in sentence case');

  // The ring: thin arc, broken O just outside it, a masked paused cut.
  for (const cls of ['.ring-track', '.ring-progress']) {
    const widths = rules.filter(r => r.selector === cls && /stroke-width/.test(r.body)).map(r => r.body.match(/stroke-width:\s*([\d.]+)/)[1]);
    assert(widths.length && widths.every(w => w === '4'), `${cls} stroke-width must be 4 (was ${widths})`);
  }
  assertMatch(html, /<circle class="ring-segments" cx="60" cy="60" r="58\.5"><\/circle>/, '.ring-segments sits at r="58.5", just outside the arc');
  assertMatch(style, /\.ring-segments \{[^}]*stroke-dasharray: 121\.4 19\.5 102\.9 14\.1 60\.7 48\.97;/, 'the broken O cadence is rescaled to r=58.5');
  const ringSvg = html.slice(html.indexOf('<svg class="ring"'), html.indexOf('</svg>', html.indexOf('<svg class="ring"')));
  assertMatch(ringSvg, /<mask id="ring-cut-mask" maskUnits="userSpaceOnUse"[\s\S]*stroke-dasharray="0 118\.8 4\.2 105\.9 4\.2 81\.6 4\.2 20\.39"/, '#ring-cut-mask lives in the ring svg with the desktop cut pattern x0.6');
  assert(rules.some(r => r.selector === 'body.is-paused:not(.stale-state) .ring-progress' && /mask:\s*url\(#ring-cut-mask\)/.test(r.body)), 'the paused cut is a CSS mask under body.is-paused:not(.stale-state)');

  // Phase colours: winding down is violet-dimmed, a Test Last Light amber.
  const phaseLiteral = html.match(/const PHASE_COLORS = (\{[^}]*\});/);
  assert(phaseLiteral, 'PHASE_COLORS missing');
  const colors = vm.runInNewContext(`(${phaseLiteral[1]})`);
  assert(colors.dim !== '#f5b83d' && /155,\s*147,\s*214/.test(colors.dim), 'PHASE_COLORS.dim is the dimmed violet, never amber');
  assert(colors['lastlight-test'] === '#f5b83d' && colors.paused === '#f5b83d' && colors.lastlight === '#ff5c7a', "'lastlight-test' and paused are amber; only REAL Last Light is red");

  // Clocks follow the phone.
  const clock = p03FnBody(html, 'clockAt');
  assert(/toLocaleTimeString\(\[\], \{ hour: 'numeric', minute: '2-digit' \}\)/.test(clock) && !/AM|PM/.test(clock), 'clockAt formats in the phone locale (no hard-coded 12-hour clock)');

  // Thumb dock: scoped to a shown run; never an overlay. Fix round 2: the
  // layout keys on body.has-run, not is-running / is-paused, because
  // markStale clears those on every stale flash (a phone wake) and the ring
  // and controls jumped under the thumb. Only handleUpdate and
  // forgetLastKnownState write has-run; markStale never does.
  const scoped = sel => sel.split(',').every(s => /^body\.has-run[.:\s]/.test(s.trim()));
  const dockRules = fireRules.filter(r => /#active-controls|\.pwa\b|\.ring-wrap|#safety-row/.test(r.selector) && /position|display:\s*flex|margin/.test(r.body));
  assert(dockRules.length >= 3 && dockRules.every(r => scoped(r.selector)), 'every dock rule is scoped to body.has-run');
  // Review round 3: body is a definite-height flex column, so a .pwa with an
  // explicit min-height must not shrink below its content on short phones.
  const pwaDock = fireRules.filter(r => r.selector === 'body.has-run .pwa').pop();
  assert(pwaDock && /flex-shrink:\s*0/.test(pwaDock.body), 'the run column never shrinks below its content (flex-shrink: 0)');
  assert(!fireRules.some(r => /body\.is-(running|paused)/.test(r.selector) && /\.pwa\b|\.ring-wrap|#active-controls/.test(r.selector)), 'no dock layout rule keys on the run classes a stale flash clears');
  for (const fn of ['markStale', 'applyRunClasses', 'clearRunClasses', 'updateFreshness']) {
    assert(!/has-run|setRunLayout/.test(p03FnBody(html, fn)), `${fn} must never touch the dock layout (has-run)`);
  }
  assertMatch(p03FnBody(html, 'handleUpdate'), /else clearRunClasses\(\);\s*setRunLayout\(active\);/, 'handleUpdate sets the dock layout from the authoritative state');
  assertMatch(p03FnBody(html, 'forgetLastKnownState'), /setRunLayout\(false\);/, 'a pairing reset drops the dock layout');
  // The head particle's halo stays inside the broken O (inner edge 57.9).
  const head = fireRules.filter(r => r.selector === '.ring-head-particle').pop();
  assert(head && parseFloat((head.body.match(/stroke-width:\s*([\d.]+)/) || [])[1]) <= 1.2 && /stroke-linejoin:\s*round/.test(head.body), 'the head halo is <= 1.2 wide with a round join so it clears the O');
  // Fix round 1: a sticky dock covered the TEST MODE / REAL badge and the
  // ring on short, landscape and zoomed screens. The dock is plain flow:
  // margin-top: auto, never sticky / fixed / absolute, no backdrop layer.
  assert(fireRules.some(r => /#active-controls$/.test(r.selector) && /margin-top:\s*auto/.test(r.body)), 'the dock sits at the bottom of the column via margin-top: auto');
  assert(!rules.some(r => /#active-controls/.test(r.selector) && /position:\s*(sticky|fixed|absolute)/.test(r.body)), 'the dock is never sticky, fixed or absolute (no overlay on the badge or ring)');
  assert(!rules.some(r => /#active-controls::(before|after)/.test(r.selector)), 'the dock has no overlay backdrop layer');
  assert(!/@media[^{]*height[^{]*\{[^}]*#active-controls[^}]*position/.test(style), 'no height-gated sticky/fixed dock either');
  assert(html.indexOf('id="details-panel"') > html.indexOf('id="active-controls"'), 'Details stays after the dock in the DOM');

  // The PC name is the hero; freshness is a static dot keyed on .is-fresh.
  const dot = fireRules.find(r => r.selector === '.link-bar .freshness.is-fresh');
  assert(dot && /border-radius:\s*50%/.test(dot.body) && !/display:\s*none/.test(dot.body) && !/animation/.test(dot.body), 'the fresh dot keys on .is-fresh, stays in the layout and is static');
  assertMatch(p03FnBody(html, 'updateFreshness'), /freshnessEl\.classList\.remove\('stale'\);\s*freshnessEl\.classList\.add\('is-fresh'\);/, 'a fresh reading adds .is-fresh where it removes .stale');
  assertMatch(p03FnBody(html, 'markStale'), /freshnessEl\.classList\.remove\('is-fresh'\);/, 'markStale removes .is-fresh');
  const pcLabel = p03FnBody(html, 'refreshPcLabel');
  assertMatch(pcLabel, /label\.className = pcName \? 'pc-label sr-only' : 'pc-label';/, "'Target PC:' is screen-reader-only only when a name exists");
  assert(/createElementNS/.test(p03FnBody(html, 'pcGlyph')) && !/innerHTML/.test(pcLabel), 'the PC glyph is built with createElementNS');

  // Paused is calm: scoped so stale wins, never the badge row.
  const pausedRules = fireRules.filter(r => /is-paused/.test(r.selector) && /\.ring-progress|\.ring(?![\w-])|\.ring-segments|\.timer-main/.test(r.selector));
  assert(pausedRules.length >= 4 && pausedRules.every(r => r.selector.split(',').every(s => /:not\(\.stale-state\)/.test(s))), 'the paused ring/digit rules carry :not(.stale-state)');
  assert(!fireRules.some(r => /is-paused/.test(r.selector) && /safety-badge|safety-row/.test(r.selector)), 'paused styling never names .safety-badge or #safety-row');
  assert(!fireRules.some(r => /is-paused/.test(r.selector) && /ring-progress/.test(r.selector) && /stroke-dasharray/.test(r.body)), 'no dasharray on paused progress (the cut is the mask)');
  assert(!/infinite/.test(fire), 'Fire 05 adds no loops');
  for (const kf of fire.matchAll(/@keyframes (\w+) \{([\s\S]*?)\}\s*\}/g)) {
    assert(!/(?:^|[{;\s])(?!opacity|transform)[a-z-]+\s*:/.test(kf[2].replace(/(from|to)\s*\{/g, '')), `${kf[1]} animates only opacity/transform`);
  }

  // The outcome strip: a sibling after the link bar, textContent only,
  // hidden while pairing, gated on a safe margin.
  const barEnd = html.indexOf('<div class="ring-wrap">');
  const stripAt = html.indexOf('<div class="outcome-strip" id="outcome-strip" hidden>');
  assert(stripAt > html.indexOf('<div class="link-bar" id="link-bar">') && stripAt < barEnd, '#outcome-strip sits after #link-bar and before the ring');
  const bar = html.slice(html.indexOf('<div class="link-bar" id="link-bar">'), stripAt);
  assert(!bar.includes('outcome'), '#outcome-strip is not inside #link-bar');
  const show = p03FnBody(html, 'showOutcome');
  assert(/outcomeText\.textContent = /.test(show) && !/innerHTML/.test(show), 'the outcome text is set with textContent only');
  assert(rules.some(r => /body\.is-pairing #outcome-strip/.test(r.selector) && /display:\s*none/.test(r.body)), 'the outcome strip is hidden under body.is-pairing');
  assertMatch(p03FnBody(html, 'outcomeEligible'), /kind !== 'cancel'[\s\S]*remaining >= 15 && snapshot\.phase !== 'lastlight'/, 'the strip speaks only after a cancel with a safe margin');
  assert(!/from this phone/.test(p03FnBody(html, 'outcomeStripText')), "the strip never claims 'from this phone'");
  assertMatch(html, /<div id="toast" class="feedback-toast" role="status" aria-live="polite"><\/div>/, 'the toast is a polite status');

  // Names and honest copy.
  assert(!html.includes('Custom Timer'), "no 'Custom Timer' in companion.html");
  assertMatch(p03FnBody(html, 'phoneSessionTitle'), /\|\| 'Countdown';/, "the default session reads 'Countdown'");
  assert(!/live/i.test(p03FnBody(html, 'updateFreshness').replace(/\/\/.*$/gm, '')), "freshness never says 'live'");
  const copy = p03FnBody(html, 'cancelCopyText');
  assert(/remaining on/.test(copy) && /This will stop the timer/.test(copy) && /if \(state\.dryRun === true\)/.test(copy), 'the stop sheet keeps remaining / stop the timer and gates the Test sentence on dryRun === true');
  for (const text of ['>Stop tonight’s run?<', '>Keep running<', '>Stop tonight’s run<']) assert(html.includes(text), `sentence-case ${text} missing`);
  assert(!/planned either way/.test(copy), 'the Test Mode stop copy never implies a planned action');

  // Fix round 1: the paused target line fits the ring and is clipped on
  // compact rings (the label already says "Paused").
  assertMatch(p03FnBody(html, 'handleUpdate'), /\? 'Clock stopped'\s*:/, "the paused target line is the short 'Clock stopped'");
  assert(fireRules.some(r => r.selector === '.ring-center .target' && /max-width:\s*7\d%/.test(r.body)), 'the target line is held inside the arc chord');
  assertMatch(fire, /@media \(max-height: 700px\), \(max-width: 300px\) \{\s*[^{]*body\.is-paused \.ring-center \.target \{[^}]*clip-path: inset\(50%\)/, 'compact rings clip the target line while paused too');
  assertMatch(fire, /@media \(max-height: 700px\) and \(min-width: 300px\) \{\s*\.add-time-grid \.btn \{ min-height: 48px; \}/, 'the joined add-time bar still compacts on short phones');
  assertMatch(html, /<button class="btn btn-secondary outcome-dismiss" type="button" id="outcome-dismiss" aria-label="Dismiss">/, 'the dismiss control rides the shared .btn classes');
});

// UI-R3 Fire 06: the phone at rest. The ring previews tonight's plan; one
// plan card; every start through the branded Start sheet (no browser
// confirm); the Night Mode sheet is a real modal that states the plan once;
// Night Mode cards lose the teal lip; pairing has one lamp that lights only
// when the PC really answers. Behaviour: test/companion.test.js ('Fire 06').
check('Fire 06 phone idle: plan preview, plan card, Start sheet, Night Mode modal, one lamp', () => {
  const html = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const script = html.slice(html.indexOf('<script>'), html.lastIndexOf('</script>'));
  const rules = p03CssRules(style);
  const f06At = style.indexOf('UI-R3 · Fire 06: phone at rest');
  const staleAt = style.indexOf('Stale wins (kept last)');
  const reducedAt = style.indexOf('@media (prefers-reduced-motion: reduce)');
  assert(f06At > style.indexOf('UI-R3 · Fire 05: phone run') && f06At < staleAt && staleAt < reducedAt, 'the Fire 06 block sits after Fire 05, above the stale block and the reduced-motion contract');
  const block = style.slice(style.lastIndexOf('/*', f06At), style.lastIndexOf('/*', staleAt));
  const blockRules = p03CssRules(block);

  // No browser confirm; one start path.
  assert(!/\bconfirm\(/.test(script), 'no confirm( in the companion script');
  assert(!/function startTimer\(/.test(script), 'the old startTimer is gone');
  const sends = script.match(/send\(\{ action: 'start'/g) || [];
  const go = p03FnBody(html, 'confirmStartSheet');
  assert(sends.length === 1 && /send\(\{ action: 'start'/.test(go), "the only send({ action: 'start' lives in confirmStartSheet (#start-go)");
  assertMatch(script, /startGo\.addEventListener\('click', confirmStartSheet\);/, '#start-go runs confirmStartSheet');
  assertMatch(go, /if \(!stateIsAuthoritative\(\) \|\| !planPolicyKnown\(\)\) \{\s*closeStartSheet\(\);\s*return;\s*\}/, '#start-go re-checks authority and the boolean policy at click time');
  assertMatch(go, /const dryRun = latestState\.dryRunPolicy === true;\s*const timerAction = selectedAction;/, '#start-go reads the policy and the ending at click time');
  assertMatch(go, /Math\.max\(60, Math\.min\(24 \* 60 \* 60, Math\.round\(startSheetSeconds\)\)\)/, 'the send keeps the 60 s .. 24 h clamp');
  const open = p03FnBody(html, 'openStartSheet');
  assertMatch(open, /^\{\s*if \(!stateIsAuthoritative\(\) \|\| !planPolicyKnown\(\)\) return false;/, 'openStartSheet refuses unless authoritative with a boolean dryRunPolicy');
  assertMatch(p03FnBody(html, 'planPolicyKnown'), /typeof latestState\.dryRunPolicy === 'boolean'/, 'planPolicyKnown means a boolean policy');
  assert(/appShell\.inert = true;/.test(open) && /startCancel\.focus\(\);/.test(open) && !/startGo\.focus/.test(open), 'the Start sheet makes the page inert and focuses Not now, never Start');
  assertMatch(html, /<div class="confirm-backdrop" id="start-sheet" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="start-title"/, '#start-sheet is a labelled modal dialog');
  const sheetMarkup = html.slice(html.indexOf('id="start-sheet"'), html.indexOf('id="start-cancel"'));
  assert(sheetMarkup.indexOf('id="start-run-type"') > 0 && sheetMarkup.indexOf('id="start-run-type"') < sheetMarkup.indexOf('id="start-go"'), 'the truth band sits above Start');
  const render = p03FnBody(html, 'renderStartSheet');
  assert(!/innerHTML/.test(render) && /setText\(startEyebrow, `TONIGHT’S PLAN · \$\{pcName \|\| 'this PC'\}`\)/.test(render), 'the eyebrow (pcName is LAN data) is set with textContent');
  assert(/startGo\.classList\.toggle\('is-real', policy === false\)/.test(render) && /'Start test run'/.test(render), "Start reads 'Start test run' in Test Mode and carries the REAL edge only for a REAL policy");
  const edge = rules.find(r => r.selector === '#start-go.is-real');
  assert(edge && /inset 0 -3px 0 var\(--danger\)/.test(edge.body) && !/animation|transition/.test(edge.body), 'the REAL edge is a static inset red line');
  assert(!rules.some(r => /night-mode-run-type|idle-safety|start-run-type/.test(r.selector) && /animation|transition/.test(r.body)), 'the truth bands never animate');
  const handle = p03FnBody(html, 'handleUpdate');
  assertMatch(handle, /if \(active && startSheet\.classList\.contains\('show'\)\) closeStartSheet\(\);/, 'a running or paused state closes the Start sheet');
  assertMatch(p03FnBody(html, 'setConnectionState'), /if \(startSheet\.classList\.contains\('show'\)\) closeStartSheet\(\);/, 'a disconnect or expiry closes the Start sheet');
  assertMatch(p03FnBody(html, 'forgetLastKnownState'), /document\.body\.classList\.remove\('is-plan'\);\s*closeStartSheet\(\);\s*setLampOff\(\);/, 'a pairing reset drops the preview, closes the sheet and unlights the lamp');

  // The idle preview: violet, no glow, no animation, stale still wins.
  const idle = p03FnBody(html, 'renderIdlePlan');
  assertMatch(idle, /const on = stateIsAuthoritative\(\) && planPolicyKnown\(\);/, 'the preview needs an authoritative state and a boolean policy');
  assertMatch(idle, /setText\(timerMain, '—'\);/, "otherwise it keeps '—'");
  assert(/setRing\(1, 'idle'\);/.test(idle) && !/applyRunClasses/.test(idle), "the preview draws setRing(1, 'idle') without run classes");
  assertMatch(idle, /test \? 'Test run · no power action' : `then \$\{/, "Test Mode never reads 'then …'");
  assertMatch(html, /const PHASE_COLORS = \{[^}]*idle: '#9b93d6'[^}]*\};/, 'the idle (preview) stroke is the violet accent');
  const planRules = rules.filter(r => /is-plan/.test(r.selector));
  assert(planRules.length && planRules.every(r => !/animation|transition|filter|teal|0,\s*209,\s*178|0,\s*255,\s*209/.test(r.body)), 'the is-plan rules carry no animation, glow filter or teal');
  assert(style.indexOf('body.is-plan .ring-progress') < staleAt, 'the preview rule sits before the stale rules');
  assert(!/Idle/.test(idle), "the preview never says 'Idle'");

  // One plan card; chips and the Start pill.
  const plan = html.slice(html.indexOf('<section class="plan-card" id="plan-card"'), html.indexOf('</section>'));
  const chips = plan.match(/<button class="btn plan-chip" type="button" data-min="(\d+)" aria-pressed="(true|false)"/g) || [];
  assert(chips.length === 5 && ['15', '30', '45', '60', '90'].every(m => plan.includes(`data-min="${m}"`)), 'the plan card holds the 15 / 30 / 45 / 1h / 90 chips');
  assert(/id="custom-min"/.test(plan) && /id="custom-minus"/.test(plan) && /id="custom-plus"/.test(plan) && /id="plan-start"/.test(plan), 'the plan card holds the Custom stepper and the Start pill');
  assert(!/quick-grid|custom-start/.test(html), 'the four quick-start buttons and #custom-start are gone');
  assertMatch(html, /<span class="night-mode-title" id="night-mode-title">Or pick a Night Mode<\/span>/, "Night Modes follow under 'Or pick a Night Mode'");

  // The Night Mode sheet: one plan statement, a real modal.
  assert(!/nm-detail-timeline|buildNightModeTimeline|night-mode-timeline|night-mode-meta-row/.test(html), 'the timeline and its dead CSS are gone');
  for (const id of ['nm-detail-meta', 'nm-detail-duration', 'nm-detail-ends', 'nm-detail-facts', 'nm-detail-ritual']) assert(html.includes(`id="${id}"`), `#${id} missing`);
  const nmOpen = p03FnBody(html, 'openNightModeDetail');
  assert(/if \(alreadyOpen\) return;\s*nmDialogOpener = document\.activeElement;/.test(nmOpen) && /appShell\.inert = true;/.test(nmOpen), 'the Night Mode sheet stores the opener once and makes the page inert');
  assertMatch(nmOpen, /document\.addEventListener\('keydown', handleNightModeKeydown, true\);/, 'the Night Mode sheet traps focus');
  const nmClose = p03FnBody(html, 'closeNightModeDetail');
  assert(/releaseShellIfNoDialog\(\);/.test(nmClose) && /focusFirstUsable\(\[opener,/.test(nmClose) && /removeEventListener\('keydown', handleNightModeKeydown, true\)/.test(nmClose), 'closing releases the page only when no dialog shows and restores focus');
  assert((script.match(/e\.key === 'Escape' && nightModeBackdrop/g) || []).length === 0, 'one Escape path for the Night Mode sheet');
  const release = p03FnBody(html, 'anyDialogOpen');
  assert(['cancelConfirm', 'startSheet', 'nightModeBackdrop'].every(n => release.includes(n)), 'inert is released only when none of the three dialogs shows');
  assertMatch(p03FnBody(html, 'closeCancelConfirmation'), /releaseShellIfNoDialog\(\);/, 'the stop sheet uses the same release rule');
  const ends = p03FnBody(html, 'nmEndsLine');
  assert(/if \(mode\.ritualId === 'standard'\) return 'after a guided wind-down';/.test(ends) && /if \(typeof policy !== 'boolean'\) return '';/.test(ends), 'ritual modes show no clock; an unknown policy shows no end line');

  // One Test Mode sentence.
  const band = p03FnBody(html, 'truthBand');
  assert(band.includes("' · No PC power action will run.'") && band.includes("'TEST MODE'") && band.includes("'REAL ACTION'") && band.includes("'CHECKING'"), 'the phone uses the desktop sentence (TEST MODE · No PC power action will run.)');

  // Night Mode cards: no teal lip.
  assert(!rules.some(r => /night-mode-card/.test(r.selector) && /box-shadow[^;]*(0,\s*209,\s*178|0,\s*255,\s*209|--teal)/.test(r.body)), 'no teal inset on the Night Mode cards');

  // The lamp: unlit until the PC really answers, lit once (opacity only).
  const removes = script.match(/classList\.remove\('lamp-off'\)/g) || [];
  assert(removes.length === 1, 'lamp-off is removed in exactly one place');
  const stateAt = handle.indexOf("if (data.type === 'state') {");
  const guardAt = handle.indexOf("if (connectionState !== 'connected' || !ws || ws.readyState !== WebSocket.OPEN) return;", stateAt);
  const removeAt = handle.indexOf("classList.remove('lamp-off')");
  assert(stateAt > 0 && guardAt > stateAt && removeAt > guardAt && handle.lastIndexOf('stateIsAuthoritative()', removeAt) > guardAt && removeAt < handle.indexOf("if (data.type === 'nightModes')"), 'lamp-off is removed only inside the authoritative state branch');
  for (const fn of ['applyPairToken', 'hidePairing', 'connect', 'setConnectionState']) assert(!/lamp-on|remove\('lamp-off'\)/.test(p03FnBody(html, fn)), `${fn} never lights the lamp`);
  assertMatch(p03FnBody(html, 'showPairing'), /setLampOff\(\);/, 'showPairing unlights the lamp');
  assertMatch(script, /if \(!pairToken \|\| pairTokenFromLink\) setLampOff\(\);/, 'boot with no token, or with a ?t= link, starts unlit');
  const lampRules = blockRules.filter(r => /wm-beam|wm-o|wm-bulb/.test(r.selector));
  assert(lampRules.length >= 3 && lampRules.every(r => r.selector.split(',').every(s => /^body\.lamp-(off|on) /.test(s.trim()))), 'the lamp rules key only on body.lamp-off / body.lamp-on');
  const lampOn = lampRules.find(r => /transition/.test(r.body));
  assert(lampOn && /transition:\s*opacity 600ms var\(--ease-out\);/.test(lampOn.body), 'the lamp transition is opacity-only');
  assert(!/infinite/.test(block) && !/@keyframes/.test(block), 'Fire 06 adds no loops and no keyframes');
  assert(!lampRules.some(r => /fill|stroke|color/.test(r.body)), 'the lamp only changes opacity (teal stays teal)');
  const pairInput = blockRules.find(r => r.selector === '#pair-input');
  assert(pairInput && /text-align:\s*center/.test(pairInput.body) && /font-size:\s*20px/.test(pairInput.body) && !blockRules.some(r => /#pair-host/.test(r.selector) && /text-align:\s*center/.test(r.body)), 'only the code field is large and centred');
  assertMatch(html, /<span class="pair-footer"><svg class="pair-wifi"[^>]*aria-hidden="true"/, 'the pairing footer has a decorative Wi-Fi glyph');
});

// UI-R3 P10: Schedule is one honest page; Focus moved to Settings ›
// Automations and Streaks + the deficit estimate to Proof › Routine.
// Behaviour: test/schedule-page.test.js and navigation-foundation.test.js.
check('P10 schedule: one page, one Auto-start switch, honest hero, moves to Settings and Proof', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const calSrc = fs.readFileSync(path.join(root, 'renderer-calendar.js'), 'utf8');
  const settingsSrc = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  const rules = p03CssRules(css);
  const emoji = /&#x1F[0-9A-F]{3};|&#x2[3-7][0-9A-F]{2};|[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}]/u;

  // The six-tab junk drawer is gone (class-anchored, so #btn-fullscreen-clock's
  // fullscreen-clock-btn class does not count).
  const hasClass = cls => new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`).test(htmlSrc);
  for (const cls of ['tonight-card', 'clock-btn', 'cd-btn', 'tab-btn', 'tab-panel', 'tabs-section', 'next-event-card']) assert(!hasClass(cls), `.${cls} must be gone from index.html`);
  assert(hasClass('fullscreen-clock-btn'), 'the fullscreen clock button keeps its class');
  assert(!/data-tab=/.test(htmlSrc), 'no data-tab sub-tab keys');
  assert(!/id="cal-cfg-builtin"|value="builtin"/.test(htmlSrc), 'built-in rules no longer hide behind the provider select');

  // Page skeleton, in order: head, hero, rules, one night, calendars.
  const schAt = htmlSrc.indexOf('id="ns-panel-sch"');
  const schEnd = htmlSrc.indexOf('<!-- DEVICES: operational center');
  assert(schAt > 0 && schEnd > schAt, '#ns-panel-sch missing');
  const sch = htmlSrc.slice(schAt, schEnd);
  assertMatch(htmlSrc, /<section class="ns-main-panel sch-page" id="ns-panel-sch" style="display:none" aria-labelledby="sch-title">/, 'Schedule is one labelled page section');
  const order = ['id="sch-title"', 'id="sch-next"', 'id="sch-rules"', 'id="sch-once"', 'id="sch-calendars"'].map(t => sch.indexOf(t));
  assert(order.every(p => p > 0) && order.every((p, i) => i === 0 || p > order[i - 1]), 'Schedule order: head, sch-next, sch-rules, sch-once, sch-calendars');
  assert(!emoji.test(sch), 'no emoji in the Schedule markup');

  // Exactly one Auto-start switch, in the #sch-next hero (Fire 09), outside
  // every cal-cfg-* panel, with its hint and Test / REAL line.
  assert((htmlSrc.match(/id="cal-auto-start"/g) || []).length === 1, 'exactly one #cal-auto-start');
  const heroSlice = sch.slice(sch.indexOf('id="sch-next"'), sch.indexOf('id="sch-rules"'));
  for (const id of ['cal-auto-start', 'sch-arm-hint', 'sch-arm-mode']) assert(heroSlice.includes(`id="${id}"`), `#sch-next must hold #${id}`);
  assert(!heroSlice.includes('id="cal-cfg-'), '#cal-auto-start lives in #sch-next, outside every cal-cfg-* panel');
  assert(!/id="sch-next-armed"/.test(htmlSrc) && !/sch-next-armed/.test(calSrc), 'the duplicate armed pill is gone (the switch is the arm state)');
  const rulesSlice = sch.slice(sch.indexOf('id="sch-rules"'), sch.indexOf('id="sch-once"'));
  for (const id of ['schedule-rules-list', 'btn-add-schedule-rule', 'schedule-rule-form']) assert(rulesSlice.includes(`id="${id}"`), `#sch-rules must hold #${id}`);
  // Both switches write the one persisted field and mirror main's answer.
  assertMatch(calSrc, /els\.calAutoStart\?\.addEventListener\('change', \(\) => \{ void setScheduleAutoStart\(els\.calAutoStart\.checked\); \}\);/, '#cal-auto-start must write through setScheduleAutoStart');
  assertMatch(p03FnBody(calSrc, 'setScheduleAutoStart'), /api\.setCalendarAutoStart\?\.\(armed\)[\s\S]*syncAutoStartSwitches\(\);/, 'setScheduleAutoStart persists calendar.autoStartFromEvents and syncs both switches');
  assertMatch(p03FnBody(calSrc, 'syncAutoStartSwitches'), /els\.calAutoStart\.checked = calAutoStartArmed;[\s\S]*els\.chkCalendarAutostart\.checked = calAutoStartArmed;/, 'both switches mirror one value');
  assertMatch(settingsSrc, /els\.chkCalendarAutostart\?\.addEventListener\('change', \(\) => \{\s*if \(typeof setScheduleAutoStart === 'function'\) void setScheduleAutoStart\(els\.chkCalendarAutostart\.checked\);/, 'Settings Auto-start must share the Schedule write path');
  assert(!/app\.calendarAutoStart|calendarAutoStart:/.test(settingsSrc), 'Settings must not read or write the stale app.calendarAutoStart');
  assert(!/autoStartFromEvents|provider:/.test(p03FnBody(calSrc, 'saveCalendarConfig')), 'saveCalendarConfig must not write Auto-start or the display-only provider');

  // main tags eligibility with its own rule; the renderer never guesses.
  assertMatch(mainSrc, /autoStartEligible: e\.source === 'builtin' \|\| isBedtimeEvent\(e\)/, 'fetch-calendar-events must carry autoStartEligible');
  assertMatch(p03FnBody(calSrc, 'isAutoStartEligible'), /evt\.source === 'builtin' \|\| evt\.autoStartEligible === true/, 'unknown eligibility is never "Will auto-start"');

  // Hero: the END time, armed from persisted state, static consequence pill,
  // the single manual start via startFromScheduleEvent.
  const next = p03FnBody(calSrc, 'renderScheduleNext');
  assertMatch(next, /const end = eventEnd\(evt\);[\s\S]*schClockParts\(end\)/, 'the hero shows the action (END) time');
  assertMatch(next, /const armed = calendarArmed\(\);/, 'the hero arm state comes from the persisted arm state');
  assertMatch(next, /state\.dryRun \? 'Test Mode · no power action' : `Real \$\{actionLabel\(action\)\}`/, 'the consequence pill follows the persisted Test Mode');
  assertMatch(calSrc, /els\.btnStartFromEvent\?\.addEventListener\('click', async \(\) => \{[\s\S]*?await startFromScheduleEvent\(calNextEvent\);[\s\S]*?handleSidebarNavigation\('lib'\)/, 'the hero start calls startFromScheduleEvent and lands on Tonight');
  assert(!/event-start-btn/.test(calSrc), 'no per-row Start buttons');
  assert(!/\\u\{1F|sourceIcons/.test(calSrc), 'no emoji source icons');
  assertMatch(p03FnBody(calSrc, 'renderCalendarEvents'), /e\.source !== 'builtin'[\s\S]*escapeHtml\(e\.summary/, 'the event list shows imported events only, escaped');
  assertMatch(p03FnBody(calSrc, 'startScheduleClock'), /if \(calScheduleClock\) return;[\s\S]*setInterval\([\s\S]*60000\)/, 'the schedule clock is idempotent and 60 s');
  assertMatch(p03FnBody(rendererSrc, 'applyMainPanelVisibility'), /if \(panel === 'sch'\) \{\s*if \(typeof startScheduleClock === 'function'\) startScheduleClock\(\);\s*\} else if \(typeof stopScheduleClock === 'function'\) \{\s*stopScheduleClock\(\);\s*\}/, 'the Schedule clock runs only while Schedule is visible');
  assertMatch(rendererSrc, /if \(tab === 'sch'\) \{[\s\S]*?if \(typeof renderSchedulePage === 'function'\) void renderSchedulePage\(\);[\s\S]*?handled = true;/, 'the sch branch renders the page, typeof-guarded');

  // One night only: action word from state, hint + Tonight note from the same
  // value inputSeconds() reads, hidden while a run is active.
  const once = sch.slice(sch.indexOf('id="sch-once"'), sch.indexOf('id="sch-calendars"'));
  for (const id of ['chk-schedule', 'schedule-time', 'schedule-hint', 'sch-once-action']) assert(once.includes(`id="${id}"`), `#sch-once must hold #${id}`);
  assert(!/Shut down at a specific/.test(htmlSrc), "no hard-coded 'Shut down' label");
  const hint = p03FnBody(rendererSrc, 'updateScheduleHint');
  assertMatch(hint, /const target = scheduleOverrideTarget\(\);/, 'the hint reads the One night only target');
  assertMatch(hint, /setTextIfChanged\(els\.schOnceAction, actionLabel\(\)\);/, 'the label uses actionLabel()');
  assertMatch(hint, /That time has passed\. Start would run in 1 min\. Clear or pick a new time\./, 'a past target says so');
  assertMatch(hint, /const showNote = Boolean\(target\) && !armed && !state\.running && !state\.paused/, 'the Tonight note hides while a run is active or a Night Mode is armed');
  // One night only and an armed Night Mode are exclusive, so the note never
  // promises an end time that the armed plan would not use.
  assertMatch(p03FnBody(rendererSrc, 'selectClockTarget'), /if \(state\.armedNightMode\) clearArmedNightMode\(\);/, 'setting a One night only target clears the armed Night Mode');
  assertMatch(p03FnBody(rendererSrc, 'armNightMode'), /if \(els\.scheduleCheck\?\.checked\) els\.scheduleCheck\.checked = false;/, 'arming a Night Mode drops the One night only target');
  assertMatch(p03FnBody(rendererSrc, 'scheduleOverrideTarget'), /els\.scheduleCheck\?\.checked[\s\S]*els\.scheduleTime\?\.value/, 'the target is read from the inputs inputSeconds() reads');
  assertMatch(p03FnBody(rendererSrc, 'render'), /updateScheduleHint\(\);/, 'render() refreshes the hint and the note');
  const setupAt = htmlSrc.indexOf('id="setup-controls"');
  const noteAt = htmlSrc.indexOf('<p class="tonight-target-note" id="tonight-target-note" hidden>');
  assert(setupAt > 0 && noteAt > setupAt && noteAt < htmlSrc.indexOf('id="btn-ritual"'), 'the Tonight note sits inside #setup-controls, hidden by default');
  const noteRule = rules.find(r => r.selector === '.tonight-target-note');
  assert(noteRule && /accent-cyan|accent-rgb/.test(noteRule.body) && !/amber/.test(noteRule.body), 'the Tonight note is violet, never amber');
  assertMatch(rendererSrc, /els\.btnTonightTargetClear\?\.addEventListener\('click', \(\) => \{[\s\S]*?els\.scheduleCheck\.checked = false;\s*els\.scheduleCheck\.dispatchEvent\(new Event\('change'\)\);/, 'Clear unchecks #chk-schedule and dispatches change');

  // Mini mode never shows Schedule.
  assert(rules.some(r => /body\.mini-mode #ns-panel-sch/.test(r.selector) && /display:\s*none/.test(r.body)), 'body.mini-mode #ns-panel-sch must be hidden');

  // Focus → Settings › Automations.
  const focusAt = htmlSrc.indexOf('<div class="option-section focus-section" data-settings-category="automations">');
  assert(focusAt > 0, 'Focus must be an Automations settings section');
  const focusEnd = htmlSrc.indexOf('<!-- First Light Section -->', focusAt);
  const focus = htmlSrc.slice(focusAt, focusEnd);
  assert((focus.match(/class="focus-preset-btn" data-preset="/g) || []).length === 3 && (htmlSrc.match(/class="focus-preset-btn"/g) || []).length === 3, 'all three .focus-preset-btn live inside the Automations focus section');
  assert(focus.includes('class="help-text"') && /Never runs a power action\./.test(focus), 'Focus carries its starts-now / no-power-action note');
  assertMatch(focus, /<div class="focus-active" id="focus-active" style="display:none">/, '#focus-active keeps its inline display:none');
  assertMatch(focus, /class="btn-secondary focus-stop" id="btn-focus-stop"/, '#btn-focus-stop is a classed secondary button');
  assert(!/style=/.test(focus.replace('id="focus-active" style="display:none"', '')) && !emoji.test(focus), 'Focus has no inline styles or emoji');
  assert(!rules.some(r => /\.focus-(hero|icon|panel)\b/.test(r.selector)), 'legacy .focus-hero/.focus-icon/.focus-panel rules are gone');

  // Streaks + deficit → Proof › Routine (every id unchanged).
  const statsAt = htmlSrc.indexOf('id="ns-panel-stats"');
  const stats = htmlSrc.slice(statsAt, htmlSrc.indexOf('id="ns-panel-set"'));
  for (const id of ['proof-routine', 'proof-routine-title', 'streak-count', 'debt-amount', 'sleep-debt-section', 'btn-copy-weekly-report', 'btn-export-streaks', 'score-value', 'weekly-report-text']) {
    assert(stats.includes(`id="${id}"`), `#ns-panel-stats must contain #${id}`);
    assert(!sch.includes(`id="${id}"`), `#ns-panel-sch must not contain #${id}`);
  }
  assert(stats.indexOf('id="proof-routine"') > stats.indexOf('id="btn-stats-view-ledger"'), 'Routine sits after the history and the ledger button');
  assertMatch(stats, /<h3 class="proof-routine-title" id="proof-routine-title" tabindex="-1">Routine<\/h3>/, 'the Routine title is a focusable h3');
  const routine = stats.slice(stats.indexOf('id="proof-routine"'));
  assert(!emoji.test(routine), 'no emoji in Proof › Routine');
  assert(!emoji.test(p03FnBody(rendererSrc, 'renderStreaks')), 'Routine renders no emoji');
  assert(!/style="/.test(routine), 'Routine markup has no inline styles');
  // UI-R3 Fire 10: no trophies, no 30-day 'Missed' grid, no score ring.
  assert(!/achievements-grid|sleep-history-grid|Completion History|score-ring/.test(routine), 'Routine has no achievements, no 30-day grid and no score ring');
  const streaksFn = p03FnBody(rendererSrc, 'renderStreaks');
  assert(!/achievement-card|\?\?\?|history-block|strokeDashoffset/.test(streaksFn), 'renderStreaks draws no achievement cards, locked ??? cards, 30-day blocks or ring');
  assert(!/getAchievementsCatalog/.test(p03FnBody(rendererSrc, 'loadStreaks')), 'loadStreaks no longer reads the achievements catalog');
  for (const id of ['btn-copy-weekly-report', 'btn-export-streaks']) assertMatch(routine, new RegExp(`class="btn-secondary btn-compact[^"]*" id="${id}"><svg class="chip-glyph"`), `#${id} is a compact glyph button`);
  assert(/Estimated Bedtime Deficit/.test(routine) && /Routine Consistency Score/.test(routine) && /not measured sleep/.test(routine), 'the deficit, score and not-measured-sleep wording stay visible');
  const streakNum = rules.find(r => r.selector === '.proof-routine .streak-number');
  assert(streakNum && !/amber/.test(streakNum.body), 'the Routine streak number is not amber');
  const streakClick = rendererSrc.slice(rendererSrc.indexOf("els.streakCallout?.addEventListener('click'"), rendererSrc.indexOf("document.getElementById('btn-celebration-dismiss')"));
  assert(!/'sch'|data-tab/.test(streakClick) && /handleSidebarNavigation\('stats'\)/.test(streakClick) && /proof-routine-title'\)\?\.focus\(/.test(streakClick), "the streak callout lands on Routine's title");
  assertMatch(htmlSrc, /id="streak-callout"[^>]*title="Jump to Routine"/, 'the streak callout says where it goes');
  assertMatch(rendererSrc, /if \(tab === 'stats'\) \{[\s\S]*?renderStatusPanel\(\);[\s\S]*?if \(typeof loadStreaks === 'function'\) loadStreaks\(\);[\s\S]*?if \(typeof loadSleepDebt === 'function'\) loadSleepDebt\(\);[\s\S]*?handled = true;/, 'the stats branch refreshes Routine, typeof-guarded');

  // CSS: one P10 block above the contract; truth pills static; no loops.
  const p10At = css.indexOf('/* -- UI-R3 · P10');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(p10At > 0 && p10At < rmAt, 'the P10 block sits above the reduced-motion contract');
  const p10Next = css.indexOf('/* -- UI-R3 · P', p10At + 10);
  const p10Rules = p03CssRules(css.slice(p10At, p10Next > p10At && p10Next < rmAt ? p10Next : rmAt));
  assert(!p10Rules.some(r => /infinite/.test(r.body)), 'P10 adds no looping animation');
  assert(!p10Rules.some(r => /\.sch-pill|sch-arm-mode/.test(r.selector) && /transition|animation|opacity/.test(r.body)), 'Test Mode / REAL pills are static');
  assert(!rules.some(r => /^\.(tabs-section|tab-btn|tab-panel|tonight-card|next-event-card|calendar-header|cal-provider-select|calendar-event-title)\b/.test(r.selector)), 'dead Schedule CSS is gone');
});

// UI-R3 P11: Proof reads as evidence (seal hero, tagged history rows, a night-
// grouped ledger with a two-step Delete all, a 14-night strip from real
// receipts) and Tonight's morning note. Behaviour: test/proof-evidence.test.js.
check('P11 proof: one result vocabulary, honest marks, a safe Delete all, the strip and the morning note', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const receiptSrc = fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8');
  const rendererOnly = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const emoji = /&#x1F[0-9A-F]{3};|&#x2[3-7][0-9A-F]{2};|[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

  // One shared tone map; every result main writes has an entry.
  const toneAt = receiptSrc.indexOf('const RECEIPT_TONE = Object.freeze({');
  assert(toneAt > 0, 'RECEIPT_TONE missing from renderer-receipts.js');
  const toneSrc = receiptSrc.slice(toneAt, receiptSrc.indexOf('\n});', toneAt) + 4);
  const RECEIPT_TONE = new Function(`${toneSrc}; return RECEIPT_TONE;`)();
  for (const result of ['power_executed', 'completed', 'dry_run_completed', 'cancelled', 'interrupted', 'completing', 'running', 'blocked', 'error']) {
    assert(RECEIPT_TONE[result] && RECEIPT_TONE[result].tone && RECEIPT_TONE[result].glyph, `RECEIPT_TONE must cover ${result}`);
  }
  assert(RECEIPT_TONE.dry_run_completed.tone === 'test' && RECEIPT_TONE.interrupted.tone === 'warn' && RECEIPT_TONE.blocked.tone === 'bad' && RECEIPT_TONE.error.tone === 'bad', 'tone grammar: test / warn / bad');
  assert(RECEIPT_TONE.running.tone === 'running' && RECEIPT_TONE.completing.tone === 'running', 'running / completing never read as done');
  assert(!/success|complete/i.test(RECEIPT_TONE.running.title + RECEIPT_TONE.completing.title), 'unfinished runs never claim completion');

  // No emoji: the receipts renderer, the hero markup, the ledger footer.
  assert(!emoji.test(receiptSrc), 'renderer-receipts.js renders line glyphs, never emoji');
  const statsPanel = htmlSrc.slice(htmlSrc.indexOf('id="ns-panel-stats"'), htmlSrc.indexOf('id="ns-panel-set"'));
  const heroHtml = statsPanel.slice(statsPanel.indexOf('id="morning-proof-section"'), statsPanel.indexOf('<section class="status-section">'));
  assert(heroHtml.length > 100 && !emoji.test(heroHtml), 'the Proof hero markup has no emoji');
  const ledgerHtml = htmlSrc.slice(htmlSrc.indexOf('id="receipts-modal"'), htmlSrc.indexOf('<!-- Streak Celebration Modal -->'));
  assert(!emoji.test(ledgerHtml), 'the ledger markup has no emoji (Export uses the download glyph)');
  assertMatch(heroHtml, /<span class="ns-proof-seal" id="proof-icon" aria-hidden="true"><svg viewBox="0 0 64 64"/, '#proof-icon is the seal svg');
  assertMatch(heroHtml, /class="ns-proof-eyebrow" id="ns-proof-eyebrow"/, 'the eyebrow has an id and keeps its class');
  for (const id of ['ns-proof-sub', 'ns-proof-truth', 'ns-pill-action-note', 'ns-pill-start', 'ns-pill-end', 'proof-again-truth', 'btn-proof-again']) assert(heroHtml.includes(`id="${id}"`), `hero missing #${id}`);
  // UI-R3 Fire 10: the pills the strip replaced are removed, not hidden.
  for (const id of ['ns-pill-pauses', 'ns-pill-snoozes', 'ns-pill-runs', 'ns-proof-timestamp']) assert(!htmlSrc.includes(`id="${id}"`), `#${id} is gone from index.html`);

  // History rows: buttons into the ledger, tagged by mode; ledger rows carry ids.
  const status = p03FnBody(rendererOnly, 'renderStatusPanel');
  assertMatch(status, /api\.listReceipts\?\.\(5\)/, 'history keeps listReceipts(5)');
  assertMatch(status, /<button type="button" class="proof-row" data-tone="\$\{toneOf\(r\)\}"\$\{id \? ` data-receipt-id="\$\{escapeHtml\(id\)\}"` : ''\}/, 'history rows are buttons with data-tone and an escaped data-receipt-id');
  assertMatch(status, /const mode = r\.dryRun \? 'test' : \(r\.dryRun === false && r\.result === 'power_executed' \? 'real' : ''\);/, 'TEST MODE for every dryRun receipt; REAL only for a confirmed command');
  assertMatch(rendererOnly, /els\.statsSessionSummary\?\.addEventListener\('click', async \(event\) => \{[\s\S]*?if \(await openReceiptsLedger\(\) !== true \|\| !id\) return;[\s\S]*?focusLedgerReceipt\(id\);\s*\}\);/, 'a history row opens the ledger and lands on its receipt');
  const focusFn = p03FnBody(receiptSrc, 'focusLedgerReceipt');
  assert(/target\.scrollIntoView\(\{ block: 'center', behavior: reduce \? 'auto' : 'smooth' \}\);/.test(focusFn) && /target\.classList\.add\('is-focus'\);/.test(focusFn) && /setTimeout\(\(\) => target\.classList\.remove\('is-focus'\), 900\);/.test(focusFn), 'focusLedgerReceipt scrolls (smooth unless reduced motion) and outlines the row for 900 ms');
  const ledger = p03FnBody(receiptSrc, 'renderReceiptsModal');
  assertMatch(ledger, /data-receipt-id="\$\{escapeHtml\(id\)\}"/, 'ledger rows carry an escaped data-receipt-id');
  assertMatch(ledger, /class="receipt-night"/, 'the ledger groups rows by night');
  assertMatch(ledger, /r\.dryRun === true \? '<span class="receipt-meta-chip chip-test">Test Mode<\/span>'/, 'every dryRun receipt keeps its Test Mode chip (the same r.dryRun === true rule as the Test Mode count)');
  assertMatch(ledger, /humanizeReceiptResult\(r\.result\)/, 'the ledger keeps the humanized result text (Interrupted)');
  assert(statsPanel.indexOf('id="btn-stats-view-ledger"') > statsPanel.indexOf('Session History') && statsPanel.indexOf('id="btn-stats-view-ledger"') < statsPanel.indexOf('id="stats-session-summary"'), '#btn-stats-view-ledger sits in the Session History card header');

  // Delete all: two steps; only the confirm button deletes.
  const rendererAll = RENDERER_FILES.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  assert((rendererAll.match(/api\.clearReceipts\b/g) || []).length === 1, 'exactly one api.clearReceipts call in the renderer');
  assertMatch(p03FnBody(receiptSrc, 'confirmClearReceipts'), /confirmBtn\.disabled = true;[\s\S]*?await api\.clearReceipts\(\)/, 'only confirmClearReceipts deletes, disabled in flight');
  assertMatch(rendererOnly, /document\.getElementById\('btn-clear-receipts-confirm'\)\?\.addEventListener\('click', confirmClearReceipts\);/, 'confirmClearReceipts is wired only to #btn-clear-receipts-confirm');
  assertMatch(rendererOnly, /els\.btnClearReceipts\.addEventListener\('click', \(\) => \{ void openReceiptsClearConfirm\(\); \}\);/, 'the first click only opens the confirm');
  assertMatch(rendererOnly, /getElementById\('receipts-confirm'\)\?\.addEventListener\('keydown', \(event\) => \{\s*if \(event\.key !== 'Escape'\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/, 'Escape on the confirm has its own listener (preventDefault + stopPropagation)');
  assertMatch(ledgerHtml, /class="receipts-confirm" id="receipts-confirm" role="alertdialog"[^>]*hidden>/, 'the confirm is an inline alertdialog, hidden by default');
  assertMatch(ledgerHtml, /class="btn-quiet btn-quiet--danger btn-compact" id="btn-clear-receipts">Delete all receipts&hellip;</, '#btn-clear-receipts is a quiet danger button');
  assertMatch(p03FnBody(receiptSrc, 'openReceiptsClearConfirm'), /getElementById\('btn-clear-receipts-keep'\)\?\.focus\(\)/, 'Keep receipts is focused first');

  // The Routine strip.
  const strip = p03FnBody(receiptSrc, 'renderNightStrip');
  assertMatch(strip, /api\.listReceipts\?\.\(100\)/, 'renderNightStrip reads api.listReceipts(100)');
  const outcome = p03FnBody(receiptSrc, 'nightOutcomeOf');
  assertMatch(outcome, /if \(result === 'dry_run_completed'\) return 'test';/, 'dry_run_completed maps to test, first');
  assert(!/dry_run_completed[^\n]*'real'/.test(outcome), 'dry_run_completed never maps to real');
  assert(statsPanel.includes('id="proof-routine"') && statsPanel.includes('id="night-strip"') && statsPanel.includes('<details class="routine-details" id="routine-details">'), '#proof-routine (with the strip and Routine details) sits inside #ns-panel-stats');
  assertMatch(rendererOnly, /if \(tab === 'stats'\) \{[\s\S]*?renderStatusPanel\(\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(typeof renderNightStrip === 'function'\) void renderNightStrip\(\);\s*\n\s*if \(typeof loadMorningProof === 'function'\) void loadMorningProof\(\);/, 'the stats branch refreshes the strip and the hero, typeof-guarded');
  const callout = p03FnBody(rendererOnly, 'updateStreakCallout');
  assert(!/streakCallout\.style\.display = ''/.test(callout) && /els\.streakCallout\.style\.display = 'none';\s*\}$/.test(callout), 'updateStreakCallout never unhides the callout on Proof');

  // The morning note: power_executed only, hidden while running.
  const noteFn = p03FnBody(receiptSrc, 'morningNoteFor');
  assertMatch(noteFn, /if \(!receipt \|\| receipt\.result !== 'power_executed' \|\| receipt\.dryRun === true\) return null;/, 'the morning note needs a confirmed REAL command');
  assertMatch(htmlSrc, /<p class="morning-note" id="morning-note" hidden>/, '#morning-note is hidden by default');
  const plan = htmlSrc.slice(htmlSrc.indexOf('id="ns-hero-card"'), htmlSrc.indexOf('id="action-bar-running"'));
  assert(plan.includes('id="morning-note"'), 'the morning note lives in the Tonight plan column');
  assertMatch(p03FnBody(rendererOnly, 'render'), /if \(morningNote && !isIdle\) morningNote\.hidden = true;/, 'render() hides the morning note while a run is active');
  assertMatch(p03FnBody(rendererOnly, 'refreshMorningNote'), /if \(!info \|\| state\.running \|\| state\.paused\) \{\s*note\.hidden = true;/, 'refreshMorningNote never shows the note during a run');
  // Owner decision: no new preload/IPC channel and no powerMonitor listener.
  assert(!/onSessionResumed|session-resumed/.test(preloadSrc + rendererAll), 'no new session-resumed channel (owner decision)');

  // CSS: one P11 block above the contract; no loops; truth marks static.
  const p11At = css.indexOf('/* -- UI-R3 · P11');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(p11At > 0 && p11At < rmAt, 'the P11 block sits above the reduced-motion contract');
  const p11Next = css.indexOf('/* -- UI-R3 · P', p11At + 10);
  const p11Rules = p03CssRules(css.slice(p11At, p11Next > p11At && p11Next < rmAt ? p11Next : rmAt));
  assert(!p11Rules.some(r => /infinite|animation:(?!\s*none\s*(;|$))/.test(r.body)), 'P11 adds no animation');
  assert(!p11Rules.some(r => /ns-proof-truth|proof-tag|btn-truth|chip-test|ns-proof-seal|seal-|night-/.test(r.selector) && /transition:(?!\s*none\s*(;|$))|animation|opacity/.test(r.body)), 'the seal, the strip and every Test Mode / REAL mark are static');
  // The Start truth chip is a fixed dark pill: it must pin the NIGHT inks so
  // Dawn's dark amber / red never land on it (~2.4:1 before the fix).
  const btnTruth = p11Rules.find(r => r.selector.trim() === '.btn-truth');
  assert(btnTruth && /--accent-amber:\s*#f5b83d/i.test(btnTruth.body) && /--accent-red:\s*#ff5c7a/i.test(btnTruth.body), '.btn-truth pins the night amber / red on its dark pill in every theme');
  // Routine legend: the rarer cell states have entries, shown only when used.
  assert(['bad', 'active', 'nodata'].every(k => htmlSrc.includes(`<li data-legend="${k}" hidden>`)) && /\.routine-legend li\[hidden\]\s*\{\s*display:\s*none;/.test(css), 'the Routine legend covers blocked / unfinished / no-data cells, hidden until used');
  assert(!/receipt-row--(completed|cancelled|blocked)\s*\{[^}]*#/.test(css) && !/#76c9ff|#ff9800/.test(css.slice(css.indexOf('/* Receipts Modal */'), css.indexOf('/* ───────────── Imminent-action warning modal'))), 'the hard-coded ledger colours are gone');
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
  // P01: a Test Mode run says so; the REAL wording is kept verbatim.
  assertMatch(mainSrc, /const warningMessage = timerState\.dryRun\s*\? `Test Mode: \$\{formatAction\(timerState\.action\)\} would run in \$\{timerState\.gracePeriod\} min\. Nothing will power off\.`\s*: `\$\{formatAction\(timerState\.action\)\} in \$\{timerState\.gracePeriod\} minutes`;/, 'warning message content regressed');
  assertMatch(mainSrc, /emitTimerUpdate\('warning', \{\s*message: warningMessage\s*\}\);/, 'warning must emit the mode-aware message');
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
  assertMatch(rendererSrc, /els\.aboutVersion\.textContent = `v\$\{version\}`/, 'About modal version chip is not updated from the runtime version');
  assertMatch(rendererSrc, /applyAppVersion\(\);\s*$/m, 'applyAppVersion must run on startup');
});

check('version: HTML fallback text matches electron/package.json (fails the build if someone bumps one and not the other)', () => {
  const pkgVersion = require(path.join(root, 'package.json')).version;
  const escaped = pkgVersion.replace(/\./g, '\\.');
  assertMatch(htmlSrc, new RegExp(`id="version"[^>]*>v${escaped}<`), `footer #version fallback text does not match package.json version (${pkgVersion})`);
  assertMatch(htmlSrc, new RegExp(`<span class="about-version-chip" id="about-version">v${escaped}<`), `About modal fallback version chip does not match package.json version (${pkgVersion})`);
});

// 22. The dead "Lights Out PC / Bedtime Mode for Windows" wordmark row is gone
// (it duplicated the header lockup and stated the old positioning).
check('layout: dead ns-header-wordmark row removed from HTML and CSS', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert(!htmlSrc.includes('ns-header-wordmark'), 'ns-header-wordmark markup must stay deleted');
  assert(!css.includes('ns-header-wordmark') && !css.includes('.ns-wordmark-'), 'ns-header-wordmark / .ns-wordmark-* CSS must stay deleted');
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
  assertMatch(nightModesSrc, /house-wide mode[\s\S]*not built yet/, 'quiet-house reason missing');
  assertMatch(nightModesSrc, /router-level Wi-Fi control/, 'school-night reason missing');
  // UI-R3 Fire 08: the browser-preview fallback catalogue carries the same
  // reasons word for word (the two catalogues cannot drift apart).
  const catalogueReasons = [...nightModesSrc.matchAll(/reason: '([^']+)'/g)].map(m => m[1]);
  const fallbackReasons = [...rendererSrc.matchAll(/availability: \{ supported: false, reason: '([^']+)' \}/g)].map(m => m[1]);
  assert(catalogueReasons.length === 2 && JSON.stringify(fallbackReasons) === JSON.stringify(catalogueReasons), `fallback reasons match nightModes.js (${fallbackReasons.join(' | ')})`);
  assert(!/not yet supported|Multi-device control/.test(nightModesSrc + rendererSrc), 'no shelf reason denies multi-device control');
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
  // UI-R3 P12 replaced the 680px stack: at <=760px the rail hides and the
  // detail panel goes static at full width.
  assertMatch(stylesSrc, /@media \(max-width: 760px\) \{\s*\.nm-library-body \{ flex-direction: column;/, 'responsive breakpoint for detail panel missing');
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

// UI-R3 P12: Night Modes page head, honest tiers, scene cards, the detail
// spread with a static Test Mode / REAL line, the real ritual timeline, the
// designed failure/empty states and My Modes truth chips. Behavioral where it
// matters (vm sandbox over the real functions), source shape elsewhere.
check('P12 Night Modes: page head, tiers, scenes, truthful detail, states and My Modes chips', () => {
  const vm = require('vm');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const nmSrc = fs.readFileSync(path.join(root, 'renderer-night-modes.js'), 'utf8');
  const profSrc = fs.readFileSync(path.join(root, 'renderer-profiles.js'), 'utf8');
  const fnSrc = (src, name) => {
    const head = src.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\([^)]*\\)`));
    assert(head, `function ${name} missing`);
    return `${head[0]} ${p03FnBody(src, name)}`;
  };
  const constSrc = (src, name) => {
    const at = src.indexOf(`const ${name} = `);
    assert(at >= 0, `const ${name} missing`);
    return src.slice(at).match(/^[\s\S]*?;[^\n]*\n/)[0];
  };

  // Page head first, the old library header gone, My Modes after the library.
  const panelOpen = '<div class="ns-main-panel" id="ns-panel-modes" style="display:none">';
  const panelAt = htmlSrc.indexOf(panelOpen);
  assert(panelAt > 0, '#ns-panel-modes missing');
  const panelEnd = htmlSrc.indexOf('<!-- /MODES panel -->', panelAt);
  const panel = htmlSrc.slice(panelAt + panelOpen.length, panelEnd);
  assert(panel.replace(/^\s*(<!--[\s\S]*?-->\s*)*/, '').startsWith('<header class="page-head">'), '#ns-panel-modes must start with header.page-head');
  assert(!htmlSrc.includes('nm-library-header') && !css.includes('.nm-library-header'), 'nm-library-header must be gone');
  const head = panel.slice(0, panel.indexOf('</header>'));
  assert(head.includes('id="btn-save-current-profile"'), 'the save button lives in the page head');
  assert(!/nm-library-title/.test(head), 'the page title carries no nm-library-title class');
  // UI-R3 Fire 08: My Modes sits in the library flow, Ready < My Modes <
  // Not available yet, all inside .nm-tiers (the opening tag is unchanged).
  {
    const tiersAt = panel.indexOf('class="nm-tiers"');
    const gridAt = panel.indexOf('id="nm-cards-grid"');
    const mineAt = panel.indexOf('<section class="profiles-section" id="profiles-section">');
    const laterAt = panel.indexOf('id="nm-later-section"');
    const detailAt = panel.indexOf('id="nm-detail-panel"');
    assert(tiersAt > 0 && tiersAt < gridAt && gridAt < mineAt && mineAt < laterAt && laterAt < detailAt, 'nm-cards-grid < profiles-section < nm-later-section inside .nm-tiers, before the detail');
  }
  assertMatch(panel, /id="btn-manage-profiles"[^>]*aria-label="Manage profiles"[^>]*>[\s\S]*?<\/svg>Manage<\/button>/, '#btn-manage-profiles shows the visible text Manage');
  assertMatch(rendererSrc, /if \(profilesSection\) profilesSection\.style\.display = isIdle \? '' : 'none';\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(els\.btnSaveCurrentProfile\) els\.btnSaveCurrentProfile\.style\.display = isIdle \? '' : 'none';/, 'the save button is idle-gated next to My Modes');
  for (const id of ['nm-later-section', 'nm-later-grid', 'nm-ready-count', 'nm-detail-truth', 'nm-detail-tier']) {
    assert((htmlSrc.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1, `#${id} must exist exactly once`);
  }
  assert(panel.indexOf('id="nm-later-section"') < panel.indexOf('id="nm-detail-panel"') && panel.indexOf('class="nm-tiers"') < panel.indexOf('id="nm-cards-grid"'), 'tiers sit in one left column before the detail');

  // P12 CSS block: above the contract, no keyframes, the scene and ring never
  // animate, the truth lines never animate or transition.
  const blockAt = css.indexOf('/* -- UI-R3 · P12');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(blockAt > 0 && blockAt < rmAt, 'P12 CSS sits above the reduced-motion contract');
  const block = css.slice(blockAt, cssBlockEnd(css, blockAt));
  assert(!/@keyframes/.test(block), 'P12 adds no keyframes');
  const rules = p03CssRules(block);
  for (const r of rules) {
    if (/nm-card-scene|nm-ring/.test(r.selector)) assert(!/(^|;)\s*animation(-[a-z-]+)?\s*:/.test(r.body), `no animation on ${r.selector}`);
    if (/nm-detail-truth|nm-tl-truth/.test(r.selector)) assert(!/(^|;)\s*(animation|transition)(-[a-z-]+)?\s*:/.test(r.body), `the truth line never animates (${r.selector})`);
  }
  assert(rules.some(r => r.selector === '.nm-detail-scroll > :not(.nm-has-truth)' && /nsRise/.test(r.body)), 'the rise applies only to scroll children without truth');
  assertMatch(panel, /class="nm-detail-section nm-has-truth"[\s\S]*?id="nm-detail-timeline"/, 'the timeline section is excluded from the rise');
  assert(rules.some(r => /^body\.real-action \.nm-card-tag:is\(\.act-shutdown, \.act-restart, \.act-logout, \.act-hibernate\)$/.test(r.selector)), 'power-action tags are tinted only under body.real-action');
  assert(!rules.some(r => /status-needs-setup|status-coming-soon/.test(r.selector) && /amber|245,\s*184/.test(r.body)), 'no amber unavailable tag');
  assert(!/#4caf50|#ff9800|#ff6b6b/i.test(css.slice(css.indexOf('Night Modes Library'), css.indexOf('Armed Night Mode banner'))), 'off-palette status colours replaced at the source');
  assert(rules.some(r => r.selector === '.nm-card.disabled.nm-card--later' && /opacity:\s*1/.test(r.body) && /display:\s*flex/.test(r.body)), 'ghost rows are full-opacity flex rows');
  assert(rules.some(r => r.selector === '.nm-card:hover' && /transform:\s*none/.test(r.body)), 'card hover never moves');
  assert(rules.some(r => r.selector === '.nm-card-tag' && /font-size:\s*10\.5px/.test(r.body)), 'tags are at least 10.5px');
  assertMatch(block, /@media \(max-width: 760px\) \{\s*\.nm-library-body \{[^}]*\}\s*\.nm-library-body\.has-detail \.nm-tiers \{ display: none; \}\s*\.nm-detail-panel \{ position: static;/, 'below 760px the rail hides and the panel goes static');
  assert(!/@media \(max-width: 680px\)/.test(css), 'the old 680px stack is deleted');
  // Dawn: the always-dark scene band keeps night inks (ring label legible),
  // and the REAL power tag on the light card takes Dawn's darkened red.
  const dawnScene = rules.find(r => r.selector === 'body[data-theme="dawn"] .nm-card-scene');
  assert(dawnScene && /--text-primary:\s*#f4f7f8/.test(dawnScene.body), 'Dawn scene band keeps the night text ink');
  assert(rules.some(r => r.selector === 'body[data-theme="dawn"].real-action .nm-card-tag:is(.act-shutdown, .act-restart, .act-logout, .act-hibernate)' && /color:\s*var\(--accent-red\)/.test(r.body)), 'Dawn REAL power tag uses the Dawn red ink');
  assert(rules.some(r => r.selector === '.nm-req-row' && /border-bottom:\s*1px solid var\(--border-color\)/.test(r.body)), 'requires divider follows the theme border');
  assert(rules.some(r => r.selector === '.nm-tier-head[hidden]' && /display:\s*none/.test(r.body)), 'a hidden tier head really hides');

  // Scene ring: clamped numbers only, '>2h' past the cap, no particle, no teal.
  const ringBox = { escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.createContext(ringBox);
  vm.runInContext(`${constSrc(nmSrc, 'NM_RING_CAP_SECONDS')} ${constSrc(nmSrc, 'NM_RING_TRACK')} ${fnSrc(nmSrc, 'formatDuration')} ${fnSrc(nmSrc, 'nmRingParts')} ${fnSrc(nmSrc, 'nmRingSvg')} this.ring = nmRingSvg;`, ringBox);
  const ring = ringBox.ring;
  // UI-R3 Fire 08: a numeral over its unit ('15' / 'MIN').
  assertMatch(ring(900), /stroke-dasharray="17 999"[\s\S]*>15<\/text>[\s\S]*>MIN<\/text>/, 'Quick Sleep ring: 15 / MIN of 2h');
  assertMatch(ring(7200), /stroke-dasharray="136 999"[\s\S]*>120<\/text>[\s\S]*>MIN</, 'the 2h ring is full and reads 120 / MIN');
  assertMatch(ring(10800), /stroke-dasharray="136 999"[\s\S]*>&gt;2<\/text>[\s\S]*>HRS</, 'past 2h the ring reads >2 / HRS');
  assertMatch(ring('x" onload="y'), />0<\/text>[\s\S]*>MIN</, 'non-numbers read 0 / MIN');
  assertMatch(ring(20), />1<\/text>[\s\S]*>MIN</, 'a positive sub-minute duration never reads 0');
  assertMatch(ring('x" onload="y'), /stroke-dasharray="0 999"/, 'non-numbers draw an empty arc');
  assert(/aria-hidden="true" focusable="false"/.test(ring(60)) && !/<rect|teal/.test(ring(60)), 'the ring is decorative: no particle, no teal');
  assert(nmSrc.includes('nmRingSvg(mode.timer.durationSeconds)'), 'the ring is built from mode.timer.durationSeconds');

  // The action tag class comes from a whitelist only.
  const tagBox = { escapeHtml: ringBox.escapeHtml, loGlyph: () => '<svg></svg>' };
  vm.createContext(tagBox);
  vm.runInContext(`${constSrc(nmSrc, 'NM_ACTION_CLASS')} ${constSrc(nmSrc, 'NM_POWER_ACTIONS')} ${fnSrc(nmSrc, 'formatAction')} ${fnSrc(nmSrc, 'nmActionTagHtml')} this.tag = nmActionTagHtml;`, tagBox);
  assertMatch(tagBox.tag('shutdown'), /class="nm-card-tag nm-act act-shutdown"><svg><\/svg>Shutdown</, 'shutdown tag carries its class and the power glyph');
  assertMatch(tagBox.tag('sleep'), /class="nm-card-tag nm-act act-sleep">Sleep</, 'sleep tag has no power glyph');
  assertMatch(tagBox.tag('x" onclick="y'), /class="nm-card-tag nm-act act-other"/, 'unknown actions fall back to act-other');

  // Detail spread: one closeDetail, has-detail toggled in all three places,
  // and no new Escape branch.
  for (const name of ['selectMode', 'renderDetail', 'closeDetail']) assertMatch(p03FnBody(nmSrc, name), /classList\.(add|remove)\('has-detail'\)/, `${name} toggles has-detail`);
  assertMatch(p03FnBody(nmSrc, 'renderDetail'), /if \(!panel \|\| !mode\) \{ closeDetail\(\); return; \}/, 'renderDetail closes through closeDetail');
  assertMatch(p03FnBody(nmSrc, 'initNightModes'), /closeDetail\(\);/, 'Back closes through closeDetail');
  assert(!/Escape/.test(nmSrc), 'Night Modes adds no Escape listener');

  // Static truth line from the canonical state.dryRun (no hard-coded TEST).
  const truthBox = { state: null };
  vm.createContext(truthBox);
  vm.runInContext(`${constSrc(nmSrc, 'NM_ACTION_VERB')} ${fnSrc(nmSrc, 'formatAction')} ${fnSrc(nmSrc, 'nmTruthFor')} this.truth = nmTruthFor;`, truthBox);
  const mode = (action, status = 'ready') => ({ status, timer: { action } });
  truthBox.state = { settingsLoaded: false, dryRun: true };
  assert(truthBox.truth(mode('shutdown')) === null, 'nothing is claimed before settings load');
  truthBox.state = { settingsLoaded: true, dryRun: true, forceShutdown: true };
  assert(truthBox.truth(mode('shutdown')).text === "Test Mode: this mode won't power off this PC" && truthBox.truth(mode('shutdown')).tone === 'test', 'Test Mode line');
  truthBox.state = { settingsLoaded: true, dryRun: false, forceShutdown: false };
  assert(truthBox.truth(mode('shutdown')).text === 'Real Shutdown: this PC will shut down when the countdown ends, unless you cancel', 'REAL line');
  assert(truthBox.truth(mode('logout')).text === 'Real Log out: this PC will log out when the countdown ends, unless you cancel', 'logout verb');
  assert(truthBox.truth(mode('sleep', 'coming_soon')) === null, 'unavailable modes show no truth line');
  truthBox.state = { settingsLoaded: true, dryRun: false, forceShutdown: true };
  assert(truthBox.truth(mode('restart')).text === 'Real Force restart: this PC will force restart when the countdown ends, unless you cancel', 'forced wording');
  assert(truthBox.truth(mode('sleep')).text === 'Real Sleep: this PC will sleep when the countdown ends, unless you cancel', 'force applies to shutdown/restart only');
  truthBox.state = { settingsLoaded: true };
  assert(truthBox.truth(mode('sleep')) === null, 'an unknown dryRun claims nothing');
  assert(!/dryRun\s*=(?!=)|dryRun:\s*true/.test(nmSrc), 'no hard-coded Test Mode default in Night Modes');
  assertMatch(rendererSrc, /if \(els\.panelModes && els\.panelModes\.style\.display !== 'none' && typeof renderDetailTruth === 'function'\) renderDetailTruth\(\);/, 'render() refreshes the open detail truth');
  const truthFn = p03FnBody(nmSrc, 'renderDetailTruth');
  assertMatch(truthFn, /state\.armedNightMode\.nightModeId === mode\.id/, 'the armed label reads state.armedNightMode');
  for (const label of ["'Use Tonight'", "'Armed: Go to Tonight'", "'Not Available'"]) assert(truthFn.includes(label), `CTA label ${label} missing`);
  assert(!/innerHTML/.test(truthFn), 'the truth line and CTA label are written with textContent');

  // Timeline: the real ritual steps from api.ritualConfig, never defaults.
  assert(nmSrc.includes('api.ritualConfig') && !/automatic/.test(nmSrc), 'timeline reads api.ritualConfig and never says automatic');
  const tlBox = { nmFacts: null };
  vm.createContext(tlBox);
  vm.runInContext(`${fnSrc(nmSrc, 'formatDuration')} ${fnSrc(nmSrc, 'formatAction')} ${fnSrc(nmSrc, 'nmStepSetting')} ${fnSrc(nmSrc, 'nmStepSeconds')} ${fnSrc(nmSrc, 'nmRitualSteps')} ${fnSrc(nmSrc, 'buildTimeline')}
    this.build = (facts, m) => { nmFacts = facts; return buildTimeline(m); };`, tlBox);
  const full = { status: 'ready', timer: { durationSeconds: 3600, action: 'shutdown', ritualId: 'standard' } };
  const steps = [
    { id: 'breathe', label: 'Guided Breathing', durationSeconds: 60 },
    { id: 'block', label: 'Block Distractions', durationSeconds: 0 },
    { id: 'dim', label: 'Dim Environment', durationSeconds: 0 },
    { id: 'timer', label: 'Start Wind-down Timer', durationSeconds: 0 },
    { id: 'lights', label: 'Smart Lights to Night Mode', durationSeconds: 0 }
  ];
  const nodes = tlBox.build({ ritual: { enabled: true, steps }, contentBlocker: { enabled: true }, app: { nightLightOnDim: false }, lights: null }, full);
  assert(JSON.stringify(nodes.map(n => n.label)) === JSON.stringify(['Guided Breathing', 'Block Distractions', 'Dim Environment', '1h countdown starts', 'Smart Lights to Night Mode', 'Shutdown this PC']), `real order: ${nodes.map(n => n.label)}`);
  assert(JSON.stringify(nodes.map(n => n.meta)) === JSON.stringify(['1 min', 'tap to continue', 'Off', 'tap to continue', 'if enabled in Settings', 'when the countdown ends']), `step meta: ${nodes.map(n => n.meta)}`);
  const lit = tlBox.build({ ritual: { enabled: true, steps }, contentBlocker: { enabled: true }, app: { nightLightOnDim: true }, lights: { enabled: true } }, full);
  assert(lit[4].meta === 'during the countdown' && lit[5].kind === 'action', 'the lights step runs during the countdown; the action is last');
  for (const ritual of [{ enabled: false, steps }, { enabled: true, steps: [] }]) {
    const off = tlBox.build({ ritual, contentBlocker: null, app: null, lights: null }, full);
    assert(off.length === 2 && off[1].kind === 'warn' && off[1].label === 'Ritual is turned off in Settings', 'ritual off: fallback + warn');
    assert(!off.some(n => /Guided Breathing|Block Distractions/.test(n.label)), 'never the built-in defaults');
  }
  const failed = tlBox.build({ ritual: null, contentBlocker: null, app: null, lights: null }, full);
  assert(failed.length === 2 && failed[1].kind === 'warn' && !/Breathing/.test(JSON.stringify(failed)), 'unreadable ritual: fallback + warn, no defaults');
  const direct = tlBox.build({ ritual: undefined }, { status: 'ready', timer: { durationSeconds: 900, action: 'sleep', ritualId: 'none' } });
  assert(direct.map(n => n.label).join('|') === '15 min countdown starts|Sleep this PC', 'direct modes: countdown then action');
  assert(!/\d{1,2}:\d{2}/.test(JSON.stringify(nodes.concat(direct))), 'no absolute clock times');

  // Requires: no emoji, the shared lights reading, the reason kept in status.
  assert(!/[✅⚠]|\\u2705|\\u26A0/.test(nmSrc), 'no check-mark or warning emoji in Night Modes');
  assert(/describeLightsReadiness\(nmFacts\.lights\)/.test(p03FnBody(nmSrc, 'renderDetailRequires')), 'Smart Lights reuse describeLightsReadiness');
  assertMatch(p03FnBody(nmSrc, 'renderDetailRequires'), /availability\.reason/, 'the availability reason stays in #nm-detail-status');

  // Failure state in the catch only, with a once-guarded init.
  const load = p03FnBody(nmSrc, 'loadNightModes');
  const catchAt = load.indexOf('} catch (');
  assert(catchAt > 0, 'loadNightModes needs a catch');
  assert(!load.slice(0, catchAt).includes('nm-retry') && load.slice(catchAt).includes("retry.id = 'nm-retry'"), '#nm-retry is built only in the catch');
  assert(/setAttribute\('role', 'status'\)/.test(load.slice(catchAt)) && !/err\.message|'nm-card[ ']/.test(load.slice(catchAt)) && load.slice(catchAt).includes("nmText('div', 'nm-empty')"), 'failure is .nm-empty role=status, no error text, not a card');
  assertMatch(load.slice(catchAt), /retry\.disabled = true;\s*void loadNightModes\(\);/, 'Try again is disabled while fetching and only re-fetches');
  assert(load.slice(catchAt).includes('nmSetReadyHeadHidden(true)') && p03FnBody(nmSrc, 'renderCards').includes('nmSetReadyHeadHidden(false)'), 'a failed load hides the Ready eyebrow; a successful render shows it');
  const headEl = { hidden: false };
  const headBox = { document: { getElementById: id => (id === 'nm-ready-count' ? { closest: sel => (sel === '.nm-tier-head' ? headEl : null) } : null) } };
  vm.createContext(headBox);
  vm.runInContext(`${fnSrc(nmSrc, 'nmSetReadyHeadHidden')} this.setHead = nmSetReadyHeadHidden;`, headBox);
  headBox.setHead(true);
  assert(headEl.hidden === true, 'failure hides the Ready tier head');
  headBox.setHead(false);
  assert(headEl.hidden === false, 'success shows the Ready tier head again');
  const init = p03FnBody(nmSrc, 'initNightModes').replace(/\/\/[^\n]*/g, '');
  assert(init.indexOf('nmWired = true') > 0 && init.indexOf('nmWired = true') < init.indexOf('await'), 'the once-guard is set before the first await');

  // My Modes: an inert create card, honest chips, no emoji.
  const renderProfilesBody = p03FnBody(profSrc, 'renderProfiles');
  const emptyBranch = renderProfilesBody.slice(renderProfilesBody.indexOf('if (state.profiles.length === 0)'), renderProfilesBody.indexOf('return;', renderProfilesBody.indexOf('if (state.profiles.length === 0)')));
  assert(emptyBranch.includes('id="profiles-empty-create"') && !emptyBranch.includes('data-profile-id'), 'the create card has no data-profile-id');
  const create = p03FnBody(profSrc, 'openProfileCreate');
  assert(/openProfilesModal\(\)/.test(create) && /new-profile-name/.test(create) && !/applyProfile|startTimer/.test(create), 'the create card only opens the manager');
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(profSrc), 'renderer-profiles.js has no emoji');
  // UI-R3 Fire 02: the chips show the effective truth. Loading a mode never
  // turns Test Mode off, so under Test Mode every card reads TEST (no FORCE).
  const chipBox = { state: null };
  vm.createContext(chipBox);
  vm.runInContext(`let lastChipTruth = null; ${fnSrc(profSrc, 'profileRealChipTitle')} ${fnSrc(profSrc, 'getProfileChips')} ${fnSrc(profSrc, 'syncProfileChipTitles')} this.chips = getProfileChips; this.syncTitles = syncProfileChipTitles;`, chipBox);
  chipBox.state = { settingsLoaded: true, dryRun: true };
  assert(chipBox.chips({ dryRun: false, forceShutdown: true, action: 'shutdown' }, true).map(c => c.cls).join(',') === 'loaded,test', 'under Test Mode a REAL mode reads LOADED + TEST, no FORCE');
  chipBox.state = { settingsLoaded: true, dryRun: false };
  const real = chipBox.chips({ dryRun: false, forceShutdown: true, action: 'shutdown' }, true);
  assert(real.map(c => c.cls).join(',') === 'loaded,real,force', 'LOADED + REAL + FORCE');
  assert(real[1].title === 'Runs for real.', 'the REAL chip title is the constant');
  assert(chipBox.chips({ dryRun: false, forceShutdown: true, action: 'sleep' }, false).map(c => c.cls).join(',') === 'real', 'FORCE only for shutdown/restart');
  assert(chipBox.chips({ dryRun: true, forceShutdown: true, action: 'shutdown' }, false).map(c => c.cls).join(',') === 'test', 'FORCE only beside REAL');
  chipBox.state = { settingsLoaded: false, dryRun: true };
  assert(chipBox.chips({ dryRun: undefined, action: 'sleep' }, false).map(c => c.cls).join(',') === 'real', 'before settings load the chip follows profile.dryRun only');
  // The cards re-render only when the effective truth changes.
  let renders = 0;
  chipBox.renderProfiles = () => { renders++; };
  chipBox.state = { settingsLoaded: true, dryRun: false };
  chipBox.syncTitles();
  chipBox.syncTitles();
  assert(renders === 1, `one re-render for one truth (got ${renders})`);
  chipBox.state = { settingsLoaded: true, dryRun: true };
  chipBox.syncTitles();
  chipBox.syncTitles();
  assert(renders === 2, 'Test Mode turning on re-renders once');
  chipBox.state = { settingsLoaded: true, dryRun: false };
  chipBox.syncTitles();
  assert(renders === 3, 'Test Mode turning off re-renders once');
  assertMatch(rendererSrc, /if \(typeof syncProfileChipTitles === 'function'\) syncProfileChipTitles\(\);/, 'render() keeps the REAL chip titles in step with Test Mode');
  assert(rules.some(r => r.selector === '.profile-chip' && /font-size:\s*10\.5px/.test(r.body)), 'My Modes chips are at least 10.5px');
  assert(!/'(LOADED|TEST|REAL|FORCE)'/.test(profSrc), 'chip labels are uppercased by CSS only');
  assert(rules.some(r => r.selector === '.profile-chip' && /text-transform:\s*uppercase/.test(r.body)), 'chip labels uppercase via CSS');
  assert(rules.some(r => r.selector === '.profile-card .profile-hint'), 'hint rule scoped as .profile-card .profile-hint');
  assertMatch(p03FnBody(profSrc, 'openProfilesModal'), /resetProfileFilters\(\);/, 'openProfilesModal reuses resetProfileFilters');
  assertMatch(p03FnBody(profSrc, 'renderProfilesList'), /No modes match[\s\S]*resetProfileFilters\(\);/, 'Clear search reuses resetProfileFilters');
});

check('P13 settings: safety hero, honest saves, smart lights truth, dark fields, phone grammar, blocker copy', () => {
  const vm = require('vm');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const settingsJs = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  const familyJs = fs.readFileSync(path.join(root, 'renderer-family-remote.js'), 'utf8');
  const emoji = /&#x1F[0-9A-F]{3};|&#x2[3-7][0-9A-F]{2};|[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}]/u;

  // Safety hero: Test Mode is the first option-group of Power & Safety.
  const psOpen = '<div class="option-section" data-settings-category="power-safety">';
  const psAt = htmlSrc.indexOf(psOpen);
  assert(psAt > 0, 'power-safety section missing');
  const firstGroupAt = htmlSrc.indexOf('<div class="option-group', psAt);
  const firstGroup = htmlSrc.slice(firstGroupAt, htmlSrc.indexOf('</div>', firstGroupAt));
  assert(firstGroup.startsWith('<div class="option-group set-safety-hero" id="set-safety-hero">'), 'the first option-group of Power & Safety must be #set-safety-hero');
  assert(firstGroup.includes('id="chk-dryrun"'), '#set-safety-hero must contain #chk-dryrun');
  assert(/<input type="checkbox" id="chk-dryrun"/.test(firstGroup), '#chk-dryrun stays a real checkbox');
  assertMatch(htmlSrc, /id="set-dryrun-desc"/, '#set-dryrun-desc missing');
  const psSection = htmlSrc.slice(psAt, htmlSrc.indexOf('<div class="option-section', psAt + psOpen.length));
  const order = ['chk-dryrun', 'sel-action', 'grace-minutes', 'chk-graceful', 'chk-mute', 'chk-forceshutdown'].map(id => psSection.indexOf(`id="${id}"`));
  assert(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), 'Power & Safety order: Test Mode, Action, Grace, Graceful, Mute, Force');
  assertMatch(psSection, /id="chk-forceshutdown"[^>]*aria-describedby="set-force-desc"/, 'Force shutdown is described by its consequence');
  assert(!/Mute system[^<]*\(|Graceful close[^<]*\(/.test(psSection), 'Mute and Graceful close carry no behaviour description');

  // renderSafetyTruth: canonical state only, outside the Dry Run sync span, never from setAction.
  const truthBody = p03FnBody(rendererJs, 'renderSafetyTruth');
  assert(/actionLabel\(\)/.test(truthBody) && /state\.dryRun/.test(truthBody), 'renderSafetyTruth uses state.dryRun and actionLabel()');
  assert(!/els\.chk|\.checked|selAction/.test(truthBody), 'renderSafetyTruth reads no form control');
  const syncAt = rendererJs.indexOf('// Dry Run is an immediate-commit field');
  const guardAt = rendererJs.indexOf('if (els.panelSet?.style.display', syncAt);
  let gi = rendererJs.indexOf('{', guardAt) + 1;
  for (let depth = 1; depth > 0; gi++) {
    if (rendererJs[gi] === '{') depth++;
    else if (rendererJs[gi] === '}') depth--;
  }
  assert(!rendererJs.slice(syncAt, gi).includes('renderSafetyTruth'), 'renderSafetyTruth must not sit inside the Dry Run sync span');
  const renderBody = p03FnBody(rendererJs, 'render');
  assert(renderBody.includes('renderSafetyTruth();'), 'render() calls renderSafetyTruth()');
  assert(!p03FnBody(rendererJs, 'setAction').includes('renderSafetyTruth'), 'setAction never calls renderSafetyTruth directly');
  const truthBox = { state: { dryRun: true, action: 'shutdown' }, els: {} };
  const heroClasses = new Set();
  truthBox.els = {
    setDryrunDesc: { textContent: '' },
    setForceDesc: { textContent: '' },
    setSafetyHero: { classList: { toggle: (n, on) => (on ? heroClasses.add(n) : heroClasses.delete(n)) } }
  };
  vm.createContext(truthBox);
  vm.runInContext(`${rendererJs.match(/const FORCE_SHUTDOWN_NO_EFFECT = [^\n]*\n/)[0]} function actionLabel(action = state.action) { return { shutdown: 'Shutdown', sleep: 'Sleep' }[action]; } function renderSafetyTruth() ${truthBody} this.run = renderSafetyTruth;`, truthBox);
  truthBox.run();
  assert(truthBox.els.setDryrunDesc.textContent === 'On: the timer runs, but no power action will happen.' && !heroClasses.has('is-real'), 'Test Mode on reads On and is not REAL');
  truthBox.state.dryRun = false;
  truthBox.run();
  assert(truthBox.els.setDryrunDesc.textContent.startsWith('Off: Shutdown will really run when the timer ends') && heroClasses.has('is-real'), 'Test Mode off names the real action and marks the hero REAL');
  // main warns only when grace > 0 (and the countdown reaches it): never promise a warning that will not come.
  truthBox.state.graceMinutes = 0;
  truthBox.run();
  assert(truthBox.els.setDryrunDesc.textContent === 'Off: Shutdown will really run when the timer ends, with no warning.', 'grace 0: REAL text promises no warning');
  truthBox.state.graceMinutes = 3;
  truthBox.run();
  assert(truthBox.els.setDryrunDesc.textContent === 'Off: Shutdown will really run when the timer ends, after a 3-minute warning (none if the timer is shorter than that).', 'grace 3: REAL text names the warning and when it is skipped');
  assert(/state\.graceMinutes/.test(truthBody) && !/els\.graceMinutes/.test(truthBody), 'the warning wording reads canonical state.graceMinutes, not the form');
  truthBox.state.action = 'sleep';
  truthBox.run();
  assert(/No effect for Sleep/.test(truthBox.els.setForceDesc.textContent), 'Force shutdown says it has no effect for Sleep');

  // Honest save model: data-live + "Applies now", a dirty note, one delegated listener.
  const liveIds = ['chk-dryrun', 'chk-clock-mode', 'chk-forceshutdown', 'chk-mute', 'chk-graceful', 'grace-minutes', 'cz-clockface', 'cz-clock-style', 'cz-clock-dial', 'cz-clock-format', 'cz-clock-scale', 'cz-clock-hands', 'cz-clock-seconds', 'cz-clock-date', 'cz-clock-sweep', 'chk-idle-detect', 'chk-bedtime-reminder', 'chk-calendar-autostart', 'chk-override-tax', 'tax-free-snoozes', 'tax-tighten-min', 'tax-max-tighten', 'tax-reason-after', 'chk-autopilot', 'autopilot-override-time', 'cb-schedules-list'];
  for (const id of liveIds) {
    const tag = (htmlSrc.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`)) || [''])[0];
    assert(/data-live="1"/.test(tag), `#${id} must be marked data-live`);
    const at = htmlSrc.indexOf(`id="${id}"`);
    const groupAt = Math.max(htmlSrc.lastIndexOf('<div class="option-group', at), htmlSrc.lastIndexOf('<div class="option-section', at));
    const sectionAt = htmlSrc.lastIndexOf('<div class="option-section', at);
    const near = htmlSrc.slice(groupAt, at + 300);
    const section = htmlSrc.slice(sectionAt, at + 300);
    assert(near.includes('Applies now') || section.includes('<span class="set-live-tag">Applies now</span>'), `#${id} needs an "Applies now" tag`);
  }
  for (const id of ['chk-dryrun', 'chk-forceshutdown', 'chk-mute', 'chk-graceful', 'grace-minutes']) {
    const at = htmlSrc.indexOf(`id="${id}"`);
    assert(htmlSrc.slice(htmlSrc.lastIndexOf('<div class="option-group', at), at).includes('<span class="set-live-tag">Applies now</span>'), `#${id} row carries its own Applies now tag`);
  }
  for (const id of ['remote-control-config', 'alarm-config', 'cb-schedule-form', 'custom-seq-builder']) {
    assertMatch(htmlSrc, new RegExp(`id="${id}"[^>]*data-action-scoped="1"`), `#${id} must be data-action-scoped`);
  }
  assertMatch(htmlSrc, /<span class="set-footer-note" id="set-dirty-note" role="status" aria-live="polite">No unsaved changes<\/span>\s*<button class="btn-secondary" id="btn-cancel-opt">/, '#set-dirty-note (role=status) sits before Cancel/Save');
  assertMatch(rendererJs, /target\.closest\('\[data-live\], \[data-action-scoped\], \[data-preview-only\]'\)/, 'the delegated listener ignores live settings, action controls and screen previews');
  assertMatch(rendererJs, /\['input', 'change'\]\.forEach\(type => \{\s*els\.settingsCategories\?\.addEventListener\(type,/, 'one delegated input/change listener on .settings-categories');
  for (const fn of ['openSettingsPanel', 'saveSettingsPanel', 'discardSettingsPanelChanges']) {
    assert(/els\.panelSet\?\.classList\?\.remove\('is-dirty'\)/.test(p03FnBody(rendererJs, fn)), `${fn} clears the dirty state`);
  }
  const saveBody = p03FnBody(rendererJs, 'saveSettingsPanel');
  assert(/let ok = true;/.test(saveBody) && (saveBody.match(/ok = false;/g) || []).length === 2 && /if \(ok\) \{\s*els\.panelSet\?\.classList\?\.remove\('is-dirty'\)/.test(saveBody), 'Save clears the dirty note only when both writes succeeded');
  assertMatch(rendererJs, /const persistAdvancedOptions = async patch => \{\s*try \{\s*await api\.saveAppSettings\(\{ app: patch \}\)/, 'persistAdvancedOptions awaits the write of its own patch only');
  // Live controls write only their own keys: a live toggle never flushes staged
  // form values (Action, focus blocklist, the wind-down *OnDim switches).
  const liveCalls = [...rendererJs.matchAll(/persistAdvancedOptions\((\{[^)]*\})?\);/g)];
  assert(liveCalls.length === 5, `five live Power & Safety writes (got ${liveCalls.length})`);
  const liveAllowed = new Set(['dryRun', 'forceShutdown', 'muteSystem', 'gracefulClose', 'graceMinutes']);
  for (const [call, obj] of liveCalls) {
    const keys = obj ? [...obj.matchAll(/(\w+):/g)].map(m => m[1]) : [];
    assert(keys.length === 1 && liveAllowed.has(keys[0]), `${call} writes exactly one Power & Safety key`);
  }
  assert(!/collectAppSettings/.test(rendererJs.slice(rendererJs.indexOf('const persistAdvancedOptions'), rendererJs.indexOf('els.scheduleCheck?.addEventListener'))), 'the live Power & Safety writes never send collectAppSettings()');
  assert(!/collectAppSettings/.test(p03FnBody(rendererJs, 'cycleClockFace')), 'the clock-face shortcut writes only clockFace');
  assert(!/<button class="btn-primary" id="btn-save-opt"[^>]*disabled/.test(htmlSrc), 'Save stays enabled');

  // Smart lights: a saved-config pill, split verify / physical test, no .btn-mode.
  assert(!htmlSrc.includes('REQUIRES SETUP'), 'the hard-coded REQUIRES SETUP pill is gone');
  assertMatch(htmlSrc, /<span class="set-state-pill[^"]*" id="lights-state-pill">/, '#lights-state-pill missing');
  const lightsAt = htmlSrc.indexOf('<div class="option-section lights-section"');
  const lights = htmlSrc.slice(lightsAt, htmlSrc.indexOf('<!-- Focus Sessions', lightsAt));
  const manualHelp = lights.match(/<details class="settings-help-details wiz-manual-details">[\s\S]*?<\/details>/g) || [];
  assert(manualHelp.length === 1 && manualHelp[0].includes('id="wiz-addresses"') && !/<details/.test(lights.replace(manualHelp[0], '')), 'only manual addressing/help is collapsed; primary lighting controls remain exposed');
  assert(!/btn-mode/.test(lights), 'no .btn-mode inside .lights-section (renderRemoteControl owns .btn-mode)');
  const testBlock = lights.slice(lights.indexOf('<div class="set-test-action"'));
  assert(testBlock.includes('id="btn-test-action"') && /physically changes/.test(testBlock), '#btn-test-action sits in .set-test-action with "physically changes"');
  assert(lights.indexOf('id="lights-config"') < lights.indexOf('class="set-test-action"'), 'the test-action block lives inside #lights-config');
  assertMatch(lights, /id="light-test-result" aria-live="polite"/, 'the verify result is announced politely');
  assertMatch(lights, /<select id="sel-light-provider" class="sr-only" aria-hidden="true" tabindex="-1">/, 'the provider select is visually hidden and driven by segments');
  const pillBody = p03FnBody(rendererJs, 'smartLightsPillState');
  assert(!/hueUsername|httpHeaders|chkSmartLights|\.checked/.test(pillBody + p03FnBody(rendererJs, 'renderLightsStatePill')), 'the pill reads only the saved config, never secrets or the live checkbox');
  const pillBox = {};
  vm.createContext(pillBox);
  vm.runInContext(`function smartLightsPillState(config) ${pillBody} this.pill = smartLightsPillState;`, pillBox);
  const pillCases = [
    [{ provider: 'none', enabled: true, verifiedConfigKey: 'k' }, 'Not configured', 'muted'],
    [{ provider: 'hue', enabled: false, verifiedConfigKey: '' }, 'Not configured', 'muted'],
    [{ provider: 'hue', enabled: false, hueBridgeIp: '10.0.0.2', hueGroupId: '1', verifiedConfigKey: 'hue:10.0.0.2:u:1' }, 'Verified · off', 'muted'],
    [{ provider: 'http', enabled: false, httpMethod: 'PUT', httpUrl: 'http://h/x', httpBodyTemplate: '{}', verifiedConfigKey: 'http:PUT:http://h/x:d:{}' }, 'Verified · off', 'muted'],
    // A stale key (main keeps it, forcing enabled off) is never "Verified".
    [{ provider: 'hue', enabled: false, hueBridgeIp: '10.0.0.9', hueGroupId: '1', verifiedConfigKey: 'hue:10.0.0.2:u:1' }, 'Not verified · off', 'muted'],
    [{ provider: 'hue', enabled: false, hueBridgeIp: '10.0.0.2', hueGroupId: '2', verifiedConfigKey: 'hue:10.0.0.2:u:1' }, 'Not verified · off', 'muted'],
    [{ provider: 'http', enabled: false, httpUrl: 'http://h/x', verifiedConfigKey: 'hue:10.0.0.2:u:1' }, 'Not verified · off', 'muted'],
    [{ provider: 'http', enabled: true, verifiedConfigKey: '' }, 'Not verified', 'warn'],
    [{ provider: 'hue', enabled: true, verifiedConfigKey: 'k', hueAllowLegacyHttp: true }, 'Ready · legacy HTTP allowed', 'warn'],
    [{ provider: 'hue', enabled: true, verifiedConfigKey: 'k' }, 'Ready', 'ready']
  ];
  for (const [cfg, text, tone] of pillCases) {
    const got = pillBox.pill(cfg);
    assert(got.text === text && got.tone === tone, `pill for ${JSON.stringify(cfg)} should be ${text}`);
  }
  assert((rendererJs.match(/renderLightsStatePill\(state\.smartLights\);/g) || []).length >= 2, 'both test handlers re-render the pill from the saved config');
  assert(!/state\.smartLights\.(hueUsername|provider|hueBridgeIp|hueGroupId|httpUrl|httpMethod|httpBodyTemplate) = /.test(rendererJs), 'staged edits (provider, Discover, Register) stay in the form; state.smartLights stays the config main last returned, so Save can spot a changed setup');
  assert(/renderLightsStatePill\(lightConfig\)/.test(rendererJs), 'settings load renders the pill from the loaded config');

  // Dark field system.
  const fieldRule = rules => rules.find(r => r.selector.startsWith('.settings-categories :is(input[type="text"]') && !/:hover|:focus/.test(r.selector));
  const p13At = css.indexOf('/* -- UI-R3 · P13');
  const p13 = p13At > 0 && p13At < css.indexOf('/* -- Reduced motion: one global contract') ? [css.slice(p13At, cssBlockEnd(css, p13At))] : null;
  assert(p13, 'P13 CSS block must sit above the reduced-motion contract');
  const p13Rules = p03CssRules(p13[0]);
  const fr = fieldRule(p13Rules);
  assert(fr && /min-height:\s*40px/.test(fr.body) && /color-scheme:\s*var\(--control-scheme\)/.test(fr.body), 'the settings control rule has min-height 40px and a theme-aware color-scheme');
  assert(p13Rules.indexOf(p13Rules.find(r => r.selector === '.settings-categories input.set-num')) > p13Rules.indexOf(fr), '.set-num comes after the general field rule');
  // Cascade, not just presence: the :is() field rule takes input[type="text"]
  // specificity (0,2,1). If it used the background shorthand, or if the
  // select/textarea rules were weaker or earlier, every Settings dropdown lost
  // its chevron and padding, and textareas lost their padding and mono font.
  assert(!/(^|[;\s])background\s*:/.test(fr.body) && /background-color:\s*var\(--bg-secondary\)/.test(fr.body), 'the general field rule sets background-color, never the background shorthand');
  const selectRule = p13Rules.find(r => r.selector === '.settings-categories select:not(.sr-only)');
  const textareaRule = p13Rules.find(r => r.selector === '.settings-categories textarea:not(.sr-only)');
  assert(selectRule && /background-image:\s*url\("data:image\/svg\+xml/.test(selectRule.body) && /padding-right:\s*36px/.test(selectRule.body), 'the (0,2,1) select rule carries the chevron and its padding');
  assert(p13Rules.indexOf(selectRule) > p13Rules.indexOf(fr), 'the select rule comes after the general field rule');
  assert(textareaRule && /padding:\s*10px 12px/.test(textareaRule.body) && p13Rules.indexOf(textareaRule) > p13Rules.indexOf(fr), 'the (0,2,1) textarea rule comes after the general field rule');
  assert(!/animation\s*:/.test(p13[0].replace(/\/\*[\s\S]*?\*\//g, '')), 'P13 adds no animations');
  assert(p13Rules.some(r => /\.set-safety-hero .checkbox-label$/.test(r.selector) && /transition:\s*none/.test(r.body)), 'the safety hero row never transitions');
  const setPanelAt = htmlSrc.indexOf('id="ns-panel-set"');
  const setPanel = htmlSrc.slice(setPanelAt, htmlSrc.indexOf('id="set-dirty-note"', setPanelAt) + 400);
  assert(!/style="[^"]*font-size:\s*(8|9|10)px/.test(setPanel), 'no inline 8-10px font sizes inside #ns-panel-set');
  assert(!/style="[^"]*width:\s*60px/.test(setPanel) && !/seq-dwell[^>]*style=/.test(fs.readFileSync(path.join(root, 'renderer-lastlight-alarm.js'), 'utf8')), 'no inline 60px number widths (they use .set-num)');
  assertMatch(css, /\.settings-categories \.checkbox-label input\[type="checkbox"\] \{[^}]*background: var\(--bg-elevated\);/, 'the switch track uses --bg-elevated');

  // Phone & Network grammar.
  const phoneAt = htmlSrc.indexOf('<div class="option-section remote-control-section"');
  const phone = htmlSrc.slice(phoneAt, htmlSrc.indexOf('<!-- Family Mode Section -->', phoneAt));
  assert(!emoji.test(phone), 'no emoji in the Phone Companion section');
  assert(!/style="[^"]*#(ff7b7b|ffc66d|d4a50a)/i.test(phone), 'no off-palette inline callout colours');
  assertMatch(phone, /<div id="remote-startup-error" class="callout callout--danger" role="alert" style="display:none">/, '#remote-startup-error is a danger callout');
  assertMatch(phone, /<div id="remote-firewall-warning" class="callout callout--warn" role="status" style="display:none">/, '#remote-firewall-warning is a warn callout');
  assertMatch(phone, /class="callout callout--quiet set-trouble"/, 'Having trouble is a quiet callout');
  const offTag = (phone.match(/<button[^>]*id="btn-turn-off-companion"[^>]*>/) || [''])[0];
  assert(offTag && !/btn-danger-outline/.test(offTag) && /btn-secondary/.test(offTag), '#btn-turn-off-companion is a secondary button (off is the safe direction)');
  assertMatch(phone, /id="btn-copy-url"[^>]*aria-label="Copy companion URL"><svg/, '#btn-copy-url uses an SVG glyph and an aria-label');
  assert(phone.includes('Scan with your phone camera to pair'), 'QR hint copy');
  assert(!/style="display:grid/.test(phone), 'the mode selector has no inline grid');
  assertMatch(familyJs, /btn\.setAttribute\('aria-pressed', active \? 'true' : 'false'\);/, 'renderRemoteControl sets aria-pressed from rc.mode');
  assert(!/role="radio/.test(phone), 'no radio roles without arrow-key support');
  assert(p03CssRules(css).some(r => r.selector === '.status-connected' && /var\(--pf-teal\)/.test(r.body)), '.status-connected is teal');
  assert(!p03CssRules(css).some(r => r.selector === '.mode-selector .btn-mode.active' && /box-shadow:\s*0 0 12px/.test(r.body)), 'the old mode glow is gone');
  assert(!p03CssRules(css).some(r => r.selector === '.mode-selector .btn-mode-primary' && /accent-green|pf-teal/.test(r.body)), 'the Same Wi-Fi button has no permanent teal/green border');

  // Content Blocker truth.
  assert(!htmlSrc.includes('this IS the list'), 'the contradictory blocklist helper is gone');
  assert(htmlSrc.includes('Used only when “Use default blocklist” is off. With the default list on, only the default sites are blocked.'), 'truthful custom blocklist helper');
  assert(htmlSrc.includes('<p class="help-text">Runs on its own schedule, whether or not a timer is running.</p>'), 'blocking schedule note moved out of the label');
  const cbBox = {
    els: {
      chkContentBlocker: { checked: false },
      contentBlockerConfig: { style: {} },
      chkContentDefault: { checked: false },
      contentCustomBlocklist: { value: '', disabled: false },
      chkContentBlockDim: { checked: true },
      chkContentUnblockComplete: { checked: true }
    },
    renderContentBlockerSchedules: () => {}
  };
  vm.createContext(cbBox);
  vm.runInContext(`function applyContentBlockerSettings(cb) ${p03FnBody(settingsJs, 'applyContentBlockerSettings')} this.apply = applyContentBlockerSettings;`, cbBox);
  cbBox.apply({ enabled: true, useDefault: true, blocklist: ['a.example', 'b.example'] });
  assert(cbBox.els.contentCustomBlocklist.disabled === true && cbBox.els.contentCustomBlocklist.value === 'a.example\nb.example', 'default list on: custom list disabled, value kept');
  cbBox.apply({ enabled: true, useDefault: false, blocklist: ['a.example'] });
  assert(cbBox.els.contentCustomBlocklist.disabled === false, 'default list off: custom list editable');
  assertMatch(settingsJs, /els\.chkContentDefault\?\.addEventListener\('change', \(\) => \{\s*if \(els\.contentCustomBlocklist\) els\.contentCustomBlocklist\.disabled = els\.chkContentDefault\.checked;/, 'toggling the default list updates the custom list state');
});

checkAsync('P13 settings fix: live writes carry only their own keys; Save drops a stale lights verification', async () => {
  const vm = require('vm');
  const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const settingsJs = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  // persistClockPrefs sends only the clock keys and reports a failed write.
  const clockAt = rendererJs.indexOf('const persistClockPrefs = async () => {');
  assert(clockAt > 0, 'persistClockPrefs is async (awaits and reports a failed write)');
  let ci = rendererJs.indexOf('{', clockAt);
  const clockStart = ci;
  for (let depth = 0; ci < rendererJs.length; ci++) {
    if (rendererJs[ci] === '{') depth++;
    else if (rendererJs[ci] === '}' && --depth === 0) break;
  }
  const clockBox = { sent: [], notes: [] };
  clockBox.collectAppSettings = () => ({ action: 'restart', focusBlocklist: ['x.example'], nightLightOnDim: true, pauseMediaOnDim: true, lockoutOnDim: true, dryRun: false, clockFace: 'analog', clockStyle: 'modern', clockDial: 'bars', clockFormat: '12h', clockScale: 1.1, clockShowDate: true, clockHandColor: '#9b93d6', clockSeconds: true, clockSweep: false });
  clockBox.api = { saveAppSettings: async payload => { clockBox.sent.push(payload); return {}; } };
  clockBox.notify = msg => clockBox.notes.push(msg);
  vm.createContext(clockBox);
  vm.runInContext(`${rendererJs.match(/const CLOCK_PREF_KEYS = [^\n]*\n/)[0]} this.run = async () => ${rendererJs.slice(clockStart, ci + 1)};`, clockBox);
  await clockBox.run();
  const clockApp = clockBox.sent[0]?.app || {};
  assert(Object.keys(clockApp).every(k => /^clock/.test(k)) && Object.keys(clockApp).length === 9, 'persistClockPrefs sends only the nine clock keys');
  assert(!('action' in clockApp) && !('focusBlocklist' in clockApp) && !Object.keys(clockApp).some(k => /OnDim$/.test(k)), 'persistClockPrefs never sends action, focusBlocklist or *OnDim');
  clockBox.api.saveAppSettings = async () => { throw new Error('disk full'); };
  await clockBox.run();
  assert(clockBox.notes.some(n => /not saved/.test(n)), 'a failed clock write is said out loud');

  // Save never re-sends a verification for a setup that changed since main last returned it.
  const runSave = async (prevLights, form) => {
    const sent = [];
    const field = v => ({ value: v });
    const box = {
      state: { action: 'shutdown', dryRun: true, graceMinutes: 2, smartLights: prevLights, lastLight: {} },
      document: { getElementById: () => null }, wizDeviceDraft: [],
      els: {
        selAction: field('shutdown'), graceMinutes: field('2'), chkForceShutdown: { checked: false }, chkMute: { checked: false },
        chkRunLogin: { checked: false }, chkSmartLights: { checked: true }, selLightMode: field('gradual_dim'), lightDimMinutes: field('10'),
        hueLegacyHttp: { checked: false }, chkLastLight: { checked: false }, selLastLightSequence: field('ClassicFade'), selLastLightSound: field('Off'),
        selLightProvider: field(form.provider), hueBridgeIp: field(form.ip || ''), hueUsername: field(form.user || ''), hueGroupId: field(form.group || ''),
        httpUrl: field(form.url || ''), httpMethod: field(form.method || 'POST'), httpTemplate: field(form.template || '')
      },
      clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
      collectAppSettings: () => ({}), collectWifiGuardSettings: () => ({}), collectContentBlockerSettings: () => ({}), collectAccountabilitySettings: () => ({}),
      applyWifiGuardSettings: () => {}, applyContentBlockerSettings: () => {}, applyAccountabilitySettings: () => {},
      setAction: () => {}, render: () => {}, notify: () => {}, console,
      api: { saveAppSettings: async () => ({}), saveSmartLightConfig: async cfg => { sent.push(cfg); const out = { ...cfg }; delete out.hueUsername; return out; } }
    };
    vm.createContext(box);
    vm.runInContext(`function collectWizSettings() ${p03FnBody(settingsJs, 'collectWizSettings')}`, box);
    vm.runInContext(`async function saveSettingsPanel() ${p03FnBody(rendererJs, 'saveSettingsPanel')} this.save = saveSettingsPanel;`, box);
    await box.save();
    return { sent: sent[0], state: box.state };
  };
  const huePrev = { provider: 'hue', enabled: true, hueBridgeIp: '10.0.0.2', hueGroupId: '1', httpMethod: 'POST', httpUrl: '', httpBodyTemplate: 'T', hueUsername: '', verifiedConfigKey: 'hue:10.0.0.2:u:1' };
  const hueForm = { provider: 'hue', ip: '10.0.0.2', group: '1', template: 'T' };
  assert((await runSave(huePrev, hueForm)).sent.verifiedConfigKey === 'hue:10.0.0.2:u:1', 'an untouched verified setup keeps its verification on Save');
  assert((await runSave(huePrev, { ...hueForm, ip: '10.0.0.9' })).sent.verifiedConfigKey === '', 'a changed bridge IP drops the stale verification');
  assert((await runSave(huePrev, { ...hueForm, group: '2' })).sent.verifiedConfigKey === '', 'a changed group drops the stale verification');
  assert((await runSave(huePrev, { ...hueForm, provider: 'http' })).sent.verifiedConfigKey === '', 'switching provider drops the stale verification');
  assert((await runSave(huePrev, { ...hueForm, user: 'newkey' })).sent.verifiedConfigKey === '', 'a newly typed / registered Hue key drops the stale verification');
  assert((await runSave(huePrev, { ...hueForm, url: 'http://unrelated', template: 'U' })).sent.verifiedConfigKey === 'hue:10.0.0.2:u:1', 'webhook fields do not touch a Hue verification');
  assert((await runSave(huePrev, { ...hueForm, group: '' })).sent.verifiedConfigKey === 'hue:10.0.0.2:u:1', 'a cleared group is kept by main, so it is not a changed setup');
  assert((await runSave(huePrev, { ...hueForm, ip: '' })).sent.verifiedConfigKey === 'hue:10.0.0.2:u:1', 'a cleared bridge IP is kept by main, so it is not a changed setup');
  const typed = await runSave({ ...huePrev, hueUsername: 'k1' }, { ...hueForm, user: 'k1' });
  assert(typed.sent.verifiedConfigKey === 'hue:10.0.0.2:u:1' && typed.state.smartLights.hueUsername === 'k1', 'the key that was last sent is not a change, and is remembered after Save');
  const httpPrev = { provider: 'http', enabled: true, hueBridgeIp: '', hueGroupId: '', httpMethod: 'POST', httpUrl: 'http://h/x', httpBodyTemplate: 'T', verifiedConfigKey: 'http:POST:http://h/x:d:T' };
  const httpForm = { provider: 'http', url: 'http://h/x', method: 'POST', template: 'T' };
  assert((await runSave(httpPrev, httpForm)).sent.verifiedConfigKey === 'http:POST:http://h/x:d:T', 'an untouched webhook keeps its verification');
  assert((await runSave(httpPrev, { ...httpForm, url: 'http://h/y' })).sent.verifiedConfigKey === '', 'a changed webhook URL drops the stale verification');
  assert((await runSave(httpPrev, { ...httpForm, url: '' })).sent.verifiedConfigKey === 'http:POST:http://h/x:d:T', 'a cleared webhook URL is kept by main, so it is not a changed setup');
  assert((await runSave(httpPrev, { ...httpForm, method: 'PUT' })).sent.verifiedConfigKey === '', 'a changed webhook method drops the stale verification');
  assert((await runSave(httpPrev, { ...httpForm, template: 'U' })).sent.verifiedConfigKey === '', 'a changed body template drops the stale verification');
});

checkAsync('P13 settings fix 2: Autopilot override is really saved; Hue Discover / Register mark Settings dirty', async () => {
  const vm = require('vm');
  // Node's built-in DOM-style events (no jsdom); read off globalThis for the linter.
  const { Event, EventTarget } = globalThis;
  const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const settingsJs = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  // Extract the arrow-function body that follows `marker` (brace-matched).
  const arrowBody = marker => {
    const at = rendererJs.indexOf(marker);
    assert(at > 0, `${marker} not found`);
    let i = rendererJs.indexOf('{', at + marker.length - 1);
    const start = i;
    for (let depth = 0; i < rendererJs.length; i++) {
      if (rendererJs[i] === '{') depth++;
      else if (rendererJs[i] === '}' && --depth === 0) break;
    }
    return rendererJs.slice(start, i + 1);
  };

  // Autopilot override: nested under app (main ignores unknown top-level keys),
  // re-armed when autopilot is on, a failed write is said out loud.
  const apBody = arrowBody("els.autopilotOverrideTime.addEventListener('change', async () => {");
  const apBox = { sent: [], enabled: [], notes: [], refreshed: 0 };
  apBox.els = { autopilotOverrideTime: { value: '21:45' }, chkAutopilot: { checked: true } };
  apBox.api = {
    saveAppSettings: async payload => { apBox.sent.push(payload); return {}; },
    enableAutopilot: async on => { apBox.enabled.push(on); return {}; }
  };
  apBox.refreshAutopilotStatus = () => { apBox.refreshed++; };
  apBox.notify = msg => apBox.notes.push(msg);
  vm.createContext(apBox);
  vm.runInContext(`this.run = async () => ${apBody};`, apBox);
  await apBox.run();
  assert(apBox.sent.length === 1 && apBox.sent[0].app && apBox.sent[0].app.autopilotBedtime === '21:45'
    && !('autopilotBedtime' in apBox.sent[0]) && Object.keys(apBox.sent[0]).length === 1, 'the override time is written as { app: { autopilotBedtime } }');
  assert(apBox.enabled.length === 1 && apBox.enabled[0] === true, 'an enabled autopilot is re-armed so the new time applies now');
  apBox.els.autopilotOverrideTime.value = '';
  apBox.els.chkAutopilot.checked = false;
  await apBox.run();
  assert(apBox.sent[1].app.autopilotBedtime === null && apBox.enabled.length === 1, 'clearing the field saves null (use learned) and does not enable a disabled autopilot');
  apBox.api.saveAppSettings = async () => { throw new Error('disk full'); };
  await apBox.run();
  assert(apBox.notes.some(n => /not saved/.test(n)), 'a failed override write is said out loud');
  assertMatch(settingsJs, /els\.autopilotOverrideTime\.value = typeof app\.autopilotBedtime === 'string'/, 'applyAppSettings loads the saved override time (load and Cancel)');

  // Hue Discover / Register stage values in the form and announce them with a
  // bubbling input event, so the delegated listener marks the panel dirty.
  const lightsAt = htmlSrc.indexOf('id="lights-config"');
  const lightsSection = htmlSrc.slice(htmlSrc.lastIndexOf('<div class="option-section', lightsAt), htmlSrc.indexOf('id="hue-username"'));
  assert(!/data-live|data-action-scoped/.test(lightsSection), 'the Hue fields are staged edits (no data-live / data-action-scoped ancestor)');
  const runHue = async (marker, apiName, apiResult, fieldKey) => {
    const events = [];
    const field = { value: '', dispatchEvent: ev => { events.push(ev); return true; } };
    const box = {
      Event, notes: [],
      els: { hueBridgeIp: { ...field, value: fieldKey === 'hueBridgeIp' ? '' : '10.0.0.2' }, hueUsername: { ...field } },
      api: { [apiName]: async () => apiResult },
      notify: () => {}
    };
    box.els[fieldKey].dispatchEvent = ev => { events.push(ev); return true; };
    vm.createContext(box);
    vm.runInContext(`this.run = async () => ${arrowBody(marker)};`, box);
    await box.run();
    return { events, value: box.els[fieldKey].value };
  };
  const disc = await runHue("els.btnDiscoverHue.addEventListener('click', async () => {", 'discoverHueBridge', { ip: '10.0.0.7' }, 'hueBridgeIp');
  assert(disc.value === '10.0.0.7' && disc.events.length === 1 && disc.events[0].type === 'input' && disc.events[0].bubbles === true, 'Discover stages the IP and fires a bubbling input event');
  const reg = await runHue("els.btnRegisterHue.addEventListener('click', async () => {", 'registerHueBridge', { username: 'fresh-key' }, 'hueUsername');
  assert(reg.value === 'fresh-key' && reg.events.length === 1 && reg.events[0].type === 'input' && reg.events[0].bubbles === true, 'Register stages the key and fires a bubbling input event');
  const miss = await runHue("els.btnDiscoverHue.addEventListener('click', async () => {", 'discoverHueBridge', {}, 'hueBridgeIp');
  assert(miss.events.length === 0, 'a failed Discover stages nothing and stays clean');

  // The delegated listener turns that event into "Unsaved changes".
  const dirtyAt = rendererJs.indexOf('const markSettingsDirty = () => {');
  const dirtyEnd = rendererJs.indexOf('// Persist these advanced options immediately', dirtyAt);
  const dirtySrc = rendererJs.slice(dirtyAt, dirtyEnd);
  const panelClasses = new Set();
  const categories = new EventTarget();
  const dBox = {
    els: { panelSet: { style: { display: '' }, classList: { add: c => panelClasses.add(c) } }, setDirtyNote: { textContent: 'No unsaved changes' }, settingsCategories: categories }
  };
  vm.createContext(dBox);
  vm.runInContext(dirtySrc, dBox);
  const ev = new Event('input', { bubbles: true });
  Object.defineProperty(ev, 'target', { value: { closest: () => null } });
  categories.dispatchEvent(ev);
  assert(panelClasses.has('is-dirty') && dBox.els.setDirtyNote.textContent === 'Unsaved changes', 'a staged Hue value makes #ns-panel-set .is-dirty with "Unsaved changes"');

  // The pill makes no claim before the saved config arrives.
  assertMatch(htmlSrc, /<span class="set-state-pill is-muted" id="lights-state-pill">Checking…<\/span>/, 'the static pill text is a neutral "Checking…"');
  assert(htmlSrc.includes('Test Block also saves this Content Blocker setup.') && htmlSrc.includes('Test Block also saves this Wi-Fi Guard setup.'), 'Test Block says it also saves the setup');
});

checkAsync('Fire 01 craft system: inherited fonts, one pill system, working hovers, one dark field, one chip, My Modes', async () => {
  const vm = require('vm');
  const crypto = require('crypto');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const czSrc = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  const profSrc = fs.readFileSync(path.join(root, 'renderer-profiles.js'), 'utf8');
  const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const all = p03CssRules(css);

  // The block: above the contract, judged on its own, no loops.
  const fireAt = css.indexOf('/* -- UI-R3 · Fire 01: craft system');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(fireAt > 0 && fireAt < rmAt, 'the Fire 01 block sits above the reduced-motion contract');
  const fire = css.slice(fireAt, cssBlockEnd(css, fireAt));
  const fireRules = p03CssRules(fire);
  assert(!/infinite/.test(fire) && !/@keyframes/.test(fire), 'Fire 01 adds no loop and no keyframes');
  assert(!fireRules.some(r => /proof-tag|chip-test|chip-forced|ns-proof-truth|sch-pill|sch-arm-mode/.test(r.selector) && /(^|;)\s*(transition|animation|opacity)(-[a-z-]+)?\s*:/.test(r.body)), 'no truth chip transitions, animates or fades');

  // Controls inherit the UI font.
  assertMatch(css, /\nbutton, input, select, textarea \{ font-family: inherit; \}/, 'buttons, inputs, selects and textareas inherit the UI font');

  // One pill system: violet primary with dark ink, a hover that changes.
  assert(!/#3d8be6/i.test(css), 'the legacy #3d8be6 hover is gone');
  assert(!/border-radius:\s*4px;\s*cursor:\s*pointer;\s*transition:\s*all 0\.15s ease;/.test(css), 'no legacy 4px button geometry block remains');
  const primary = fireRules.find(r => r.selector === '.btn-primary');
  assert(primary && /background:\s*var\(--accent-cyan\)/.test(primary.body) && /color:\s*#14101f/.test(primary.body), 'the global .btn-primary is the violet fill with #14101f ink');
  assert(fireRules.some(r => r.selector === '.btn-primary:hover' && /background:\s*var\(--accent-blue\)/.test(r.body)), 'the .btn-primary hover is var(--accent-blue)');
  assert(!all.some(r => r.selector !== '.btn-primary' && /^\.btn-primary$/.test(r.selector)) && all.filter(r => r.selector === '.btn-primary').length === 1, 'exactly one bare .btn-primary rule');
  const base = fireRules.find(r => r.selector === ':where(.btn-primary, .btn-secondary, .btn-danger):where(:not(.btn-tiny))');
  assert(base && /min-height:\s*36px/.test(base.body) && /border-radius:\s*var\(--radius-pill\)/.test(base.body), 'one pill base (36px, pill radius) at zero specificity');
  assert(fireRules.some(r => r.selector === ':is(.btn-primary, .btn-secondary, .btn-danger)[hidden]' && /display:\s*none !important/.test(r.body)), 'hidden buttons stay hidden under the inline-flex base');
  const secondary = all.filter(r => r.selector === '.btn-secondary');
  assert(secondary.length === 1 && /background:\s*var\(--bg-secondary\)/.test(secondary[0].body) && /color:\s*var\(--text-secondary\)/.test(secondary[0].body), 'exactly one .btn-secondary rule, on var(--bg-secondary) / var(--text-secondary)');
  const danger = all.filter(r => r.selector === '.btn-danger');
  assert(danger.length >= 1 && danger.every(r => !/border-radius|padding/.test(r.body)) && danger.some(r => /background:\s*var\(--danger-fill\)/.test(r.body)), '.btn-danger is colour only, on the deepened red');
  assert(all.filter(r => /^\.btn-compact$/.test(r.selector)).length === 1, 'one .btn-compact rule');
  assertMatch(htmlSrc, /<button class="btn-danger" id="warning-cancel">Cancel timer<\/button>/, '"Cancel timer" in the heads-up dialog stays the red .btn-danger');
  // Hovers follow the accent: --accent-blue is the darkened accent, never the raw accent.
  const apply = p03FnBody(czSrc, 'applyCustomization');
  assertMatch(apply, /setProperty\('--accent-blue', `color-mix\(in srgb, \$\{accent\} \$\{ACCENT_HOVER_SHADE\}%, #000\)`\)/, 'applyCustomization sets --accent-blue through color-mix');
  assert(!/setProperty\('--accent-blue', accent\)/.test(apply), '--accent-blue is never the raw accent');
  assertMatch(czSrc, /const ACCENT_HOVER_SHADE = \d+;/, 'one hover shade constant');

  // One CTA voice.
  assert(fireRules.some(r => /^\.ns-play-btn,\s*\.nm-cta-main$/.test(r.selector) && /text-transform:\s*none/.test(r.body) && /font-weight:\s*650/.test(r.body)), 'the hero CTA and the Night Mode CTA read in sentence case at 650');

  // Display voice on titles; never on truth text.
  for (const sel of ['.page-title', '.ov-head h2', '.modal .modal-header h2', '.onboarding-container h2']) {
    assert(all.some(r => r.selector === sel && /font-family:\s*var\(--font-instrument\)/.test(r.body)), `${sel} uses the instrument display face`);
  }
  assert(!all.some(r => /#testmode-pill|\.ov-truth|\.sch-pill|\.proof-tag|chip-test/.test(r.selector) && /--font-instrument/.test(r.body)), 'no Test Mode / REAL text uses the display face');

  // One dark field system at zero specificity; the P13 Settings rules are byte-identical.
  const field = fireRules.find(r => r.selector.startsWith(':where(input[type="text"]') && !/:hover|:focus/.test(r.selector));
  assert(field && /:where\(:not\(\.sr-only\):not\(#timer-input\)\)$/.test(field.selector), 'the field base is a zero-specificity :where() rule that skips .sr-only and #timer-input');
  assert(/color-scheme:\s*var\(--control-scheme\)/.test(field.body) && /background-color:\s*var\(--bg-secondary\)/.test(field.body) && !/(^|[;\s])background\s*:/.test(field.body), 'the field base sets background-color and the theme color-scheme, never the background shorthand');
  assert(!/color-scheme:\s*dark/.test(css), 'no literal dark color-scheme (Dawn keeps light pickers)');
  const p13Start = css.indexOf('.settings-categories :is(input[type="text"], input[type="url"], input[type="password"], input[type="number"], input[type="time"], select, textarea) {');
  const p13End = css.indexOf('\n', css.indexOf('.settings-categories select.sr-only', p13Start)) + 1;
  const p13Hash = crypto.createHash('sha256').update(css.slice(p13Start, p13End).replace(/\r\n/g, '\n')).digest('hex');
  assert(p13Start > 0 && p13Hash === 'f168929e95385f659c6c9f96df6dbf168638bbd2a25063edc933cfaa3a149ef5', 'the P13 Settings field rules are byte-identical');

  // One chip shape: a single bare .nm-card-tag rule carries the neutral fill.
  const tags = all.filter(r => r.selector === '.nm-card-tag');
  assert(tags.length === 1 && /font-size:\s*10\.5px/.test(tags[0].body) && /background:\s*rgba\(255, 255, 255, 0\.04\)/.test(tags[0].body) && /border:\s*1px solid var\(--border-color\)/.test(tags[0].body), 'exactly one bare .nm-card-tag rule (10.5px, the neutral fill)');
  assert(fireRules.some(r => /^:is\(\.proof-tag, \.receipt-meta-chip, \.sch-pill, \.set-state-pill, \.tag-pill, \.ns-proof-badge, \.nm-card-tag\)$/.test(r.selector) && /border-radius:\s*var\(--radius-pill\)/.test(r.body)), 'every chip class shares the pill radius');
  assert(fireRules.some(r => r.selector === '.proof-tag,\n.receipt-meta-chip:is(.chip-test, .chip-forced)' && /text-transform:\s*uppercase/.test(r.body)), 'Test Mode / Forced chips read uppercase through CSS');
  assertMatch(fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8'), /<span class="receipt-meta-chip chip-test">Test Mode<\/span>/, 'the chip DOM text stays "Test Mode"');

  // My Modes: the manager's name, dark fields, no emoji, no inline styles, class-only filters.
  const modalAt = htmlSrc.indexOf('<div class="modal" id="profiles-modal"');
  const modal = htmlSrc.slice(modalAt, htmlSrc.indexOf('<!-- Imminent-action warning dialog -->', modalAt));
  assertMatch(modal, /<h2 id="profiles-modal-title" tabindex="-1">My Modes<\/h2>/, '#profiles-modal-title reads My Modes');
  for (const old of ['Saved Profiles', 'Save Profile', 'Your Profiles']) assert(!htmlSrc.includes(old), `index.html no longer says "${old}"`);
  for (const copy of ['Save tonight’s plan as a mode', '>Name</label>', '>Kind</label>', '>Save mode</button>', '<h3>Your modes</h3>', 'placeholder="Search modes…"', 'aria-label="Close My Modes"']) assert(modal.includes(copy), `My Modes shows ${copy}`);
  assertMatch(modal, /<select id="new-profile-kind">\s*<option value="timer">Routine<\/option>\s*<option value="family">Family member<\/option>/, 'Routine is the first kind');
  const emoji = /&#x1F[0-9A-F]{3};|&#x2[3-7][0-9A-F]{2};|[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}]/u;
  assert(!emoji.test(modal), 'no emoji in #profiles-modal');
  assert(!/id="profile-search"[^>]*style=/.test(modal) && !/<button[^>]*class="filter-btn[^"]*"[^>]*style=/.test(modal) && !/style="[^"]*"[^>]*class="filter-btn/.test(modal), '#profile-search and .filter-btn carry no style attribute');
  assertMatch(modal, /data-filter="pinned" aria-pressed="false"><svg class="chip-glyph"[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Pinned<\/button>/, 'Pinned shows the pin glyph (decorative) and the word');
  const filterAt = rendererJs.indexOf("const filterContainer = document.getElementById('profile-filters');");
  const filterHandler = rendererJs.slice(filterAt, rendererJs.indexOf('renderProfilesList();', filterAt));
  const reset = p03FnBody(profSrc, 'resetProfileFilters');
  assert(filterAt > 0 && !filterHandler.includes('.style.') && !reset.includes('.style.'), 'the filter handler and resetProfileFilters write no inline styles');
  // Behaviour: reset leaves only "all" active, by class and aria-pressed.
  const mkBtn = f => { const cls = new Set(f === 'pinned' ? ['filter-btn', 'active'] : ['filter-btn']); const attrs = {}; return { dataset: { filter: f }, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: c => cls.has(c) }, setAttribute: (k, v) => { attrs[k] = v; }, attrs, style: {} }; };
  const btns = ['all', 'duration', 'clock', 'pinned'].map(mkBtn);
  const box = { state: {}, document: { getElementById: id => (id === 'profile-filters' ? { querySelectorAll: () => btns } : id === 'profile-search' ? { value: 'x' } : null) } };
  vm.createContext(box);
  vm.runInContext(`function resetProfileFilters() ${reset} resetProfileFilters();`, box);
  assert(btns.every(b => b.classList.has('active') === (b.dataset.filter === 'all') && b.attrs['aria-pressed'] === String(b.dataset.filter === 'all')) && btns.every(b => Object.keys(b.style).length === 0), 'reset activates only "all" (class + aria-pressed, no inline style)');
  assert(box.state.profileActiveFilter === 'all' && box.state.profileSearchQuery === '', 'reset clears the search and the filter state');
  // Behaviour: a new mode defaults to a Routine; only an explicit Family member choice saves family.
  const save = p03FnBody(profSrc, 'saveNewProfile');
  const saved = [];
  for (const kind of ['', 'timer', 'family', 'other']) {
    const sBox = {
      els: { newProfileName: { value: 'School nights' }, newProfileKind: { value: kind }, newProfileAvatar: { value: '' }, newProfileNotes: { value: '' } },
      state: { action: 'sleep', dryRun: true, forceShutdown: false, muteSystem: false, graceMinutes: 2, smartLights: { enabled: false, mode: 'off' }, profiles: [] },
      document: { getElementById: () => null },
      inputSeconds: () => 1800,
      // Fire 08: no native confirm(); the overwrite two-step's reset is a stub.
      clearProfileSaveConfirm: () => {},
      notify: () => {},
      loadProfiles: async () => {},
      renderProfilesList: () => {},
      api: { createProfile: async p => { saved.push(p.kind); return { success: true, action: 'created', profile: { name: p.name } }; } }
    };
    vm.createContext(sBox);
    vm.runInContext(`async function saveNewProfile() ${save} this.done = saveNewProfile();`, sBox);
    await sBox.done;
  }
  assert(saved.join(',') === 'timer,timer,family,timer', `new modes default to Routine (got ${saved.join(',')})`);
});

// UI-R3 Fire 02: honest values and names. One clock, a footer that always
// names the mode, one name per session, Test Mode that says what still runs
// (tied to main's real wind-down), toasts above the rail, My Modes that never
// switch Test Mode off, Ctrl+digit that never starts a timer.
check('Fire 02 truth and names', () => {
  const vm = require('vm');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const utilsJs = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
  const receiptsJs = fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8');

  // The block: above the contract, judged on its own, no loops.
  const fireAt = css.indexOf('/* -- UI-R3 · Fire 02: truth and names');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(fireAt > 0 && fireAt < rmAt, 'the Fire 02 block sits above the reduced-motion contract');
  const fire = css.slice(fireAt, cssBlockEnd(css, fireAt));
  const fireRules = p03CssRules(fire);
  assert(!/infinite/.test(fire) && !/@keyframes/.test(fire), 'Fire 02 adds no loop and no keyframes');

  // Toasts on Tonight sit above the readiness rail.
  assert(fireRules.some(r => /body\[data-view="lib"\]:not\(\.mini-mode\):not\(\.fullscreen-clock-mode\) #toast-container/.test(r.selector) && /bottom:\s*calc\(var\(--footer-h\) \+ var\(--rail-clear\)\)/.test(r.body)), 'the Tonight toast rule clears the rail with var(--rail-clear)');
  assertMatch(p03FnBody(rendererJs, 'applyMainPanelVisibility'), /if \(document\.body\) document\.body\.dataset\.view = panel;/, 'the visible panel is a body hook');
  // Pause / resume on Tonight go to the feed only; a failure still toasts.
  const pause = p03FnBody(rendererJs, 'togglePause');
  assert(/notify\('Timer resumed', 'success', 3000, \{ toast: !tonightVisible \}\)/.test(pause) && /notify\('Timer paused', 'warning', 3000, \{ toast: !tonightVisible \}\)/.test(pause), 'togglePause passes a { toast } option');
  assert(/notify\(`Pause failed: [^`]*`, 'error'\);/.test(pause), "'Pause failed' still toasts");
  assertMatch(p03FnBody(rendererJs, 'notify'), /if \(toast\) showToast\(message, type, duration\);/, 'notify skips only the toast');

  // The footer: no pill-wide teal 'complete'; the outcome word is the hook.
  assert(!/\.app-footer \.status-pill\.complete \{/.test(css), 'the pill-wide teal complete override is gone');
  assert(fireRules.some(r => r.selector === '.app-footer .status-pill.complete .status-time[data-phase="outcome"]' && /color:\s*var\(--pf-teal\)/.test(r.body)), 'only the word of a REAL completion is teal');
  const footer = p03FnBody(rendererJs, 'renderFooterTruth');
  assertMatch(footer, /state\.lastOutcomeTestMode === \(state\.dryRun === true\)/, 'an outcome shows only while it agrees with the mode');
  assert(!/state\.lastOutcome\s*=[^=]/.test(footer), 'the footer never writes the outcome back');
  assertMatch(p03FnBody(rendererJs, 'render'), /renderFooterTruth\(isIdle\);/, 'render() draws the footer');

  // Ctrl / Meta / Alt + digit is never a preset start.
  const keydownAt = rendererJs.indexOf("const presets = { '1': 5, '2': 10, '3': 15, '4': 30, '5': 60, '6': 120 };");
  const presetLine = rendererJs.slice(keydownAt, rendererJs.indexOf('{\n', rendererJs.indexOf('if (presets[event.key]', keydownAt)));
  assert(/!event\.ctrlKey && !event\.metaKey && !event\.altKey/.test(presetLine) && /!typingTarget/.test(presetLine), 'the preset branch requires no Ctrl/Meta/Alt and no text target');
  assert(!/state\.profiles\[index\]/.test(rendererJs), 'Ctrl+N never indexes the unsorted state.profiles');

  // One name per session.
  for (const [src, name] of [[rendererJs, 'renderTonightHero'], [rendererJs, 'renderStatusPanel'], [receiptsJs, 'renderMorningProof']]) {
    assert(!/Custom Timer|Manual timer/.test(p03FnBody(src, name)), `${name} says Countdown, not Custom Timer / Manual timer`);
  }
  const phases = (rendererJs.match(/const SESSION_PHASE_LABELS = Object\.freeze\(\{[^}]*\}\);/) || [''])[0];
  assert(phases && !/Focus/.test(phases), "SESSION_PHASE_LABELS has no 'Focus' (Focus Sessions own the word)");
  assert(!/focus: 'Focus'/.test(footer), "the footer's first phase reads Running");

  // Source guard: Test Mode does not hold back the wind-down in main. If main
  // ever gates one of these, windDownEffects and its copy must change too.
  const dim = p03FnBody(mainSrc, 'applyDimPhase');
  for (const needle of ['nightLightOnDim', 'applyFocusMode(true)', 'pauseMediaOnDim', 'wifiGuard.blockInternet', 'contentBlocker.blockSites', 'lockoutOnDim']) {
    assert(dim.includes(needle), `applyDimPhase still runs ${needle}`);
  }
  assert(!/dryRun/.test(dim), 'applyDimPhase has no Test Mode check (the Test Mode notes depend on it)');
  const lightAt = mainSrc.indexOf('smartLights.startSmartLightDim(timerState.remainingSeconds)');
  const tickAt = mainSrc.lastIndexOf('timerInterval = setInterval(', lightAt);
  assert(lightAt > 0 && tickAt > 0 && !/dryRun/.test(mainSrc.slice(tickAt, lightAt)), 'the countdown tick starts the smart-light dim with no Test Mode condition');

  // windDownEffects knows exactly the seven effects; pickWindDownFacts keeps
  // no credential-shaped field (behaviour, in a sandbox).
  const box = {};
  vm.createContext(box);
  vm.runInContext([
    (utilsJs.match(/const WIND_DOWN_APP_NAME = [^\n]*/) || [''])[0],
    (utilsJs.match(/const WIND_DOWN_LAN_PROVIDERS = [^\n]*/) || [''])[0],
    `function pickWindDownFacts({ app, contentBlocker, wifiGuard, lights } = {}) ${p03FnBody(utilsJs, 'pickWindDownFacts')}`,
    `function windDownEffects(facts) ${p03FnBody(utilsJs, 'windDownEffects')}`,
    'this.pick = pickWindDownFacts; this.effects = windDownEffects;'
  ].join('\n'), box);
  const everything = box.pick({
    app: { nightLightOnDim: true, pauseMediaOnDim: true, lockoutOnDim: true, focusBlocklist: ['chrome'] },
    contentBlocker: { enabled: true },
    wifiGuard: { enabled: true, provider: 'adapter', routerPass: 'x', routerUser: 'y', webhookUrl: 'z', webhookHeaders: { a: 1 }, deviceMacs: ['m'], deviceIps: ['i'] },
    lights: { enabled: true, hueUsername: 'k', httpUrl: 'u' }
  });
  const effectIds = Array.from(box.effects(everything).effects, e => e.id);
  assert(effectIds.join(',') === 'night-light,close-apps,pause-media,on-top,wifi,sites,lights', `windDownEffects knows exactly the seven effects (got ${effectIds.join(',')})`);
  const keys = [];
  (function walk(v) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } })(everything);
  assert(keys.every(k => !/url|token|key|secret|password|username|mac|ip/i.test(k)), `pickWindDownFacts names no credential-shaped field (${keys.join(',')})`);
  assert(!/routerPass|webhookHeaders|hueUsername|token/.test(p03FnBody(utilsJs, 'pickWindDownFacts')), 'pickWindDownFacts never names a secret field');

  // The Test Mode notes never animate or transition.
  const noteRules = p03CssRules(css).filter(r => /#set-testmode-scope|#plan-scope-note|\.set-scope-note|\.plan-scope-note/.test(r.selector));
  assert(noteRules.length > 0 && noteRules.every(r => !/(^|;)\s*(transition|animation)(-[a-z-]+)?\s*:/.test(r.body)), 'the Test Mode scope notes carry no animation or transition');
  assert(htmlSrc.includes('<p class="set-scope-note" id="set-testmode-scope" hidden></p>') && /id="chk-dryrun"[^>]*aria-describedby="set-dryrun-desc set-testmode-scope"/.test(htmlSrc), 'Settings names what still runs, described by the Test Mode box');
  const hero = htmlSrc.slice(htmlSrc.indexOf('id="ns-hero-card"'), htmlSrc.indexOf('id="ns-play-btn"'));
  assert(hero.indexOf('class="plan-reach"') < hero.indexOf('id="plan-scope-note"'), "Tonight's note sits between the reach line and Start");

  // One clock: no locale time on the desktop surfaces this package owns.
  for (const [src, name] of [[rendererJs, 'formatEndTime'], [rendererJs, 'formatScheduleWhen'], [rendererJs, 'refreshMorningNote'], [rendererJs, 'renderStatusPanel'], [receiptsJs, 'renderMorningProof'], [receiptsJs, 'renderReceiptsModal']]) {
    assert(!/toLocaleTimeString|toLocaleString\(/.test(p03FnBody(src, name)), `${name} uses formatClock, not a locale time`);
  }
  assertMatch(receiptsJs, /`Night of \$\{d\.toLocaleDateString/, "ledger groups read 'Night of …'");
});

// UI-R3 Fire 03: the shell. The rail stays through a session, the footer
// pill leads back to it, the header is an open frame, the O reads OUT, dust
// only in the beam, a calm launch, one-line rail labels, a movable mini puck
// that never swallows a safety click, readiness cells that lead somewhere,
// and an About that fits. Behaviour: test/navigation-foundation.test.js.
check('Fire 03 shell', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const settingsJs = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
  const geometry = require(path.join(root, 'windowGeometry.js'));
  const all = p03CssRules(css);

  // The block: above the contract, judged on its own, no loops, no truth surface.
  const fireAt = css.indexOf('/* -- UI-R3 · Fire 03: shell');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(fireAt > 0 && fireAt < rmAt, 'the Fire 03 block sits above the reduced-motion contract');
  const fire = css.slice(fireAt, cssBlockEnd(css, fireAt));
  const fireRules = p03CssRules(fire);
  assert(!/infinite/.test(fire) && !/@keyframes/.test(fire) && !fireRules.some(r => /(^|;)\s*animation(-[a-z-]+)?\s*:/.test(r.body)), 'Fire 03 adds no loop, keyframes or animation');
  assert(!fireRules.some(r => /#testmode-pill|data-truth|\.ov-truth|\.ll-truth|status-pill/.test(r.selector)), 'Fire 03 never names a Test Mode / REAL truth surface');

  // The rail: shown outside mini / fullscreen through a session; never keyed off ns-lobby.
  const rail = all.find(r => r.selector === 'body:not(.mini-mode):not(.fullscreen-clock-mode) .ns-sidebar');
  assert(rail && /display:\s*flex/.test(rail.body) && /bottom:\s*var\(--footer-h\)/.test(rail.body), 'the rail shows outside mini mode and the fullscreen clock, above the footer');
  assert(all.some(r => r.selector === 'body:not(.mini-mode):not(.fullscreen-clock-mode) .dashboard' && /padding-left:\s*calc\(80px \+ var\(--section-gap\)\)/.test(r.body)), 'the dashboard keeps the rail padding outside mini / fullscreen');
  assert(!all.some(r => /body\.ns-lobby[^,]*\.(ns-sidebar|dashboard)\b/.test(r.selector)), 'no rail or dashboard-padding rule keys off ns-lobby any more');
  assert(all.some(r => r.selector === 'body:not(.mini-mode):not(.fullscreen-clock-mode) #toast-container' && /left:\s*calc\(50% \+ 40px\)/.test(r.body)), 'toasts centre on the content column whenever the rail shows');
  assert(all.some(r => r.selector === '.ns-sidebar-logo' && /display:\s*none/.test(r.body)) && !all.some(r => /\.ns-sidebar-logo/.test(r.selector) && /visibility:\s*hidden/.test(r.body)), '.ns-sidebar-logo is display:none (no spacer)');
  assert(fireRules.some(r => r.selector === '.ns-sidebar' && /top:\s*var\(--header-height\)/.test(r.body)), 'the rail starts under the header');
  assertMatch(p03FnBody(rendererJs, 'render'), /document\.body\.classList\.toggle\('ns-lobby', isIdle\);/, 'ns-lobby still means idle lobby content');

  // A live Tonight icon: static, teal running, amber paused, never red.
  const lib = fireRules.filter(r => /\.ns-nav-item\[data-ns-tab="lib"\] \.ns-nav-icon$/.test(r.selector));
  assert(lib.some(r => /^body\.is-running /.test(r.selector) && /color:\s*var\(--pf-teal\)/.test(r.body)) && lib.some(r => /^body\.is-paused /.test(r.selector) && /color:\s*var\(--accent-amber\)/.test(r.body)), 'the Tonight icon is teal while running and amber while paused');
  assert(lib.every(r => !/accent-red|transition|animation|opacity/.test(r.body)), 'the Tonight tint is static and never red');

  // The footer pill leads back to the session.
  const footer = p03FnBody(rendererJs, 'renderFooterTruth');
  assertMatch(footer, /const tonightVisible = !els\.panelLib \|\| els\.panelLib\.style\.display !== 'none';/, 'the pill reads whether Tonight is on screen');
  assertMatch(footer, /if \(!pill\.disabled\) pillLabel \+= isIdle \? ', change in Settings' : ', open Tonight';/, "the pill's name says where it goes");
  const clickAt = rendererJs.indexOf("els.statusPill?.addEventListener('click'");
  const click = rendererJs.slice(clickAt, rendererJs.indexOf('\n});', clickAt));
  const activeAt = click.indexOf("if (state.running || state.paused) { await handleSidebarNavigation('lib'); return; }");
  assert(activeAt > 0 && activeAt > click.indexOf('if (els.statusPill.disabled) return;') && activeAt < click.indexOf("openSettingsCategory('power-safety')"), 'mid-run the pill opens Tonight and returns before the Settings path');
  assert(!/dryRun\s*=[^=]|setDryRun/.test(click), 'the pill never writes the mode');
  assertMatch(p03FnBody(rendererJs, 'applyMainPanelVisibility'), /if \(typeof renderFooterTruth === 'function'[^\n]*renderFooterTruth\(!state\.running && !state\.paused\);/, 'a panel change re-reads the pill at once (typeof-guarded)');

  // The open frame; Dawn keeps its solid header; the drag region stays.
  const header = all.filter(r => r.selector === '.chrome-header');
  assert(header.some(r => /background:\s*transparent/.test(r.body) && /border-bottom-color:\s*transparent/.test(r.body)) && !header.some(r => /border-bottom:\s*0/.test(r.body)), 'the night header is an open frame (transparent background and hairline colour)');
  assert(header.some(r => /-webkit-app-region:\s*drag/.test(r.body)) && all.some(r => r.selector === '.window-buttons' && /-webkit-app-region:\s*no-drag/.test(r.body)), 'the header keeps its drag region and the window buttons stay no-drag');
  const dawnHeader = all.find(r => r.selector === 'body[data-theme="dawn"] .chrome-header');
  assert(dawnHeader && /background:\s*#0f1821/.test(dawnHeader.body) && /border-bottom-color:\s*#263746/.test(dawnHeader.body), 'Dawn keeps its opaque header and hairline');
  const fade = fireRules.find(r => r.selector === 'body:not(.fullscreen-clock-mode):not(.mini-mode) .dashboard');
  assert(fade && /-webkit-mask-image:\s*linear-gradient\(to bottom, transparent 0, #000 10px\)/.test(fade.body) && /(^|;)\s*mask-image:\s*linear-gradient\(to bottom, transparent 0, #000 10px\)/.test(fade.body), 'the scroller fade is 10px and scoped off fullscreen / mini');

  // The O reads OUT: 6 units, the halo clears the U stem, the word space stays wider.
  assert(all.some(r => r.selector === '.brand-wordmark .wm-o-live' && /stroke-width:\s*6;/.test(r.body)), '.wm-o-live stroke-width is 6');
  const halo = all.find(r => r.selector === '.brand-wordmark .wm-o-halo' && /stroke-width/.test(r.body));
  const track = all.find(r => r.selector === '.brand-wordmark .wm-o-track');
  assert(halo && Number((halo.body.match(/stroke-opacity:\s*([0-9.]+)/) || [])[1]) <= 0.2 && track && Number((track.body.match(/stroke-opacity:\s*([0-9.]+)/) || [])[1]) <= 0.22, 'halo and track stay quiet (<= .2 / .22)');
  const tx = Number((htmlSrc.match(/<g class="wm-o" transform="translate\((\d+(?:\.\d+)?), 108\)">/) || [])[1]);
  const haloOuter = tx + 28 + 25 + Number(halo.body.match(/stroke-width:\s*([0-9.]+)/)[1]) / 2;
  const liveOuterLeft = tx + 28 - 25 - 3;
  assert(524 - haloOuter >= 4, `the O halo clears the U stem (x 524) by >= 4 units (got ${524 - haloOuter})`);
  assert(liveOuterLeft - 437 > 524 - (tx + 28 + 25 + 3), 'the LIGHTS|OUT word space stays wider than the O|U letter gap');

  // Light in the beam: shared tokens, a stronger core, dust masked to the cone.
  assertMatch(css, /\.night-beam \{[^}]*conic-gradient\(from var\(--beam-from, 96deg\) at var\(--beam-x, 50px\) var\(--beam-y, 24px\),\s*transparent 0deg,\s*rgba\(0, 255, 209, 0\.10\) 10deg/, 'the beam reads the tokens and its core is .10');
  assertMatch(css, /\.night-beam \{[^}]*transition: opacity 1\.2s linear;/, 'the beam keeps its plain 1.2 s fade');
  assertMatch(htmlSrc, /<div class="night-beam"><\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div class="night-dust" aria-hidden="true">\s*<div class="night-particles night-particles-a"><\/div>\s*<div class="night-particles night-particles-b"><\/div>\s*<\/div>[\s\S]*?<div class="env-dark"><\/div>\s*<\/div>/, '.night-dust wraps both particle layers, between the beam and .env-dark');
  const dust = fireRules.find(r => r.selector === '.night-dust');
  assert(dust && /-webkit-mask-composite:\s*source-in/.test(dust.body) && /(^|;)\s*mask-composite:\s*intersect/.test(dust.body) && /conic-gradient\(from calc\(var\(--beam-from\) - 4deg\) at var\(--beam-x\) var\(--beam-y\)/.test(dust.body) && /radial-gradient\(circle at var\(--beam-x\) var\(--beam-y\)/.test(dust.body), '.night-dust has a static cone x falloff mask');
  assert(!/(^|;)\s*(transition|animation)(-[a-z-]+)?\s*:/.test(dust.body), '.night-dust is static');

  // A calm launch: the startup restore and the fullscreen entry paint no rail focus ring.
  assert((settingsJs.match(/handleSidebarNavigation\([^;]*\{ persist: false, focusNav: false \}\);/g) || []).length === 2, 'the startup restore passes focusNav: false on both branches');
  assertMatch(p03FnBody(rendererJs, 'handleSidebarNavigation'), /if \(focusNav\) document\.querySelector\(`\.ns-nav-item\[data-ns-tab="\$\{tab\}"\]`\)\?\.focus\(\);/, 'the router focuses the nav item only when focusNav');

  // One-line rail labels, one item height.
  const label = all.filter(r => r.selector === '.ns-nav-label').pop();
  assert(label && /font-family:\s*var\(--font-ui\)/.test(label.body) && /white-space:\s*nowrap/.test(label.body) && /font-size:\s*11px/.test(label.body) && /overflow:\s*hidden/.test(label.body), 'rail labels: readable 11px UI face on one line, without overflow');
  const item = all.filter(r => r.selector === '.ns-nav-item' && /height:/.test(r.body)).pop();
  assert(item && /height:\s*54px/.test(item.body) && Number((item.body.match(/width:\s*(\d+)px/) || [])[1]) <= 76, 'one 54px item height, at most 76px wide inside the 80px rail');

  // The mini puck: a guarded grab strip that cannot maximize.
  const exitAt = htmlSrc.indexOf('<button class="mini-exit" id="btn-mini-exit"');
  const grabAt = htmlSrc.indexOf('<div class="mini-grab" aria-hidden="true"></div>');
  assert(exitAt > 0 && grabAt > htmlSrc.indexOf('</button>', exitAt) && grabAt < htmlSrc.indexOf('<section class="timer-section">'), '.mini-grab sits after #btn-mini-exit and before (outside) .timer-section');
  const grabDrag = all.filter(r => /mini-grab/.test(r.selector) && /-webkit-app-region:\s*drag/.test(r.body));
  assert(grabDrag.length === 1 && grabDrag[0].selector === 'body.mini-mode .mini-grab' && /height:\s*22px/.test(grabDrag[0].body) && /right:\s*40px/.test(grabDrag[0].body), 'the grab strip drags only under body.mini-mode (22px, clear of the exit)');
  assert(all.some(r => r.selector === '.mini-grab' && /display:\s*none/.test(r.body)) && all.some(r => r.selector === 'body.fullscreen-clock-mode .mini-grab' && /display:\s*none/.test(r.body)), 'the strip exists only in the puck, never in the fullscreen clock');
  const guard = all.find(r => /^body\.mini-mode:has\(/.test(r.selector) && /:is\(\.mini-exit, \.mini-grab\)$/.test(r.selector));
  assert(guard && /display:\s*none/.test(guard.body) && ['.modal.active', '.last-light-overlay.active', '.context-menu', '.onboarding-overlay:not('].every(s => guard.selector.includes(s)), 'one guard hides the exit and the strip under every dialog, overlay, onboarding and context menu');
  assert(fireRules.some(r => /(^|,)\s*\.modal-content\s*(,|$)/.test(r.selector) && /(^|,)\s*\.context-menu\s*(,|$)/.test(r.selector) && /-webkit-app-region:\s*no-drag/.test(r.body)), 'dialog content and the context menu are no-drag (belt and braces)');
  assert(all.some(r => /::after$/.test(r.selector) && /mini-grab/.test(r.selector) && /background:\s*var\(--border-color\)/.test(r.body) && !/animation|transition/.test(r.body)), 'the grabber is a static token colour');
  assertMatch(mainSrc, /const windowConfig = miniMode \? \{[^}]*maximizable: false\s*\}/, 'the mini window config is not maximizable');
  const calls = [];
  const fakeWin = { isMaximized: () => false, getBounds: () => ({ x: 0, y: 0, width: 900, height: 800 }), getMinimumSize: () => [900, 640], unmaximize: () => {}, maximize: () => calls.push('maximize'), setMinimumSize: () => {}, setSize: () => {}, setBounds: () => {}, setMaximizable: v => calls.push(`maximizable:${v}`) };
  geometry.enterMiniMode(fakeWin);
  assert(calls.join() === 'maximizable:false', `enterMiniMode turns maximizable off (got ${calls.join()})`);
  geometry.exitMiniMode(fakeWin, null);
  assert(calls[1] === 'maximizable:true', `exitMiniMode turns it back on first (got ${calls.join()})`);

  // Readiness cells: four buttons whose targets exist; idle-only; never the mode.
  const stripAt = htmlSrc.indexOf('<section class="readiness-strip" id="readiness-strip" aria-label="Readiness">');
  const strip = htmlSrc.slice(stripAt, htmlSrc.indexOf('</section>', stripAt));
  const rows = [...strip.matchAll(/<button type="button" class="rdy-row" data-rdy-go="([^"]+)">([\s\S]*?)<\/button>/g)];
  assert(rows.length === 4 && !/<div class="rdy-row"/.test(strip), 'the four readiness rows are buttons');
  const want = { 'rdy-phone': 'device-card-phone', 'rdy-lights': 'device-card-lights', 'rdy-network': 'device-card-phone', 'rdy-safety': 'settings:power-safety' };
  for (const [, go, inner] of rows) {
    const id = (inner.match(/<span class="rdy-value" id="(rdy-[a-z]+)">/) || [])[1];
    assert(id && want[id] === go, `${id} opens ${want[id]} (got ${go})`);
    if (go.startsWith('device-card-')) assert(htmlSrc.includes(`id="${go}"`), `${go} exists`);
    assert(/<\/span><svg class="chip-glyph rdy-go"[^>]*aria-hidden="true"/.test(inner) && /<span class="sr-only">, open [^<]+<\/span>$/.test(inner), `${id}: the chevron follows the value span; a hidden suffix keeps the live value in the name`);
  }
  assertMatch(rendererJs, /const RDY_DEVICE_TARGETS = \['device-card-phone', 'device-card-lights'\];/, 'device targets are a fixed list');
  const go = p03FnBody(rendererJs, 'openReadinessTarget');
  assertMatch(go, /if \(state\.running \|\| state\.paused\) return false;/, 'a cell does nothing during a session');
  assertMatch(go, /if \(await handleSidebarNavigation\('devices'\) !== true\) return false;/, 'the strip handler awaits handleSidebarNavigation and checks === true');
  assertMatch(go, /await openSettingsCategory\('power-safety'\);/, 'Safety takes the idle Power & Safety path');
  assert(!/dryRun/.test(go), 'the strip handler never references dryRun');
  assert((rendererJs.match(/getElementById\('readiness-strip'\)\?\.addEventListener\('click'/g) || []).length === 1 && !/readiness-strip'\)\?\.addEventListener/.test(p03FnBody(rendererJs, 'render')), 'one delegated listener, wired once at module scope');
  assertMatch(p03FnBody(rendererJs, 'render'), /const rdyLocked = !\(isIdle && state\.settingsLoaded\);\s*document\.querySelectorAll\('\.rdy-row\[data-rdy-go\]'\)\.forEach\(row => \{\s*if \(row\.disabled !== rdyLocked\) row\.disabled = rdyLocked;/, 'render() disables the rows unless idle with settings loaded');
  const disabled = fireRules.find(r => r.selector === 'button.rdy-row:disabled');
  assert(disabled && /opacity:\s*1/.test(disabled.body) && /cursor:\s*default/.test(disabled.body), 'disabled rows keep full-strength values');
  assert(fireRules.some(r => r.selector === 'button.rdy-row:focus-visible' && /outline-offset:\s*-2px/.test(r.body)), 'the row focus ring sits inside the rail');
  const landing = all.filter(r => /\.device-card\.is-focus/.test(r.selector));
  assert(landing.length >= 1 && landing.every(r => /outline:\s*2px solid var\(--accent-cyan\)/.test(r.body) && !/(^|;)\s*(animation|transition)(-[a-z-]+)?\s*:/.test(r.body)), '.device-card.is-focus is a static outline');

  // About fits one screen: neutral tiles, one version chip, two-column keys.
  const aboutAt = htmlSrc.indexOf('<div class="modal" id="about-modal"');
  const about = htmlSrc.slice(aboutAt, htmlSrc.indexOf('<!-- Last Light finale overlay -->', aboutAt));
  assertMatch(about, /<h2 id="about-modal-title" class="sr-only" tabindex="-1">About<\/h2>/, 'the About title stays for assistive tech and focus (visually hidden)');
  assertMatch(about, /<button class="modal-close about-close" id="about-modal-close" aria-label="Close about dialog">/, 'the close button keeps its id and name');
  assert((htmlSrc.match(/id="about-version"/g) || []).length === 1 && /<span class="about-version-chip" id="about-version">/.test(about), 'the version appears once, as a chip');
  assertMatch(about, /<button class="btn-quiet btn-compact updater-check-btn" id="btn-check-update">/, 'Check for updates is a quiet compact button');
  assert(about.includes('id="updater-download"'), '#updater-download stays in the updater row');
  const icons = all.filter(r => r.selector === '.about-guarantees svg').pop();
  assert(icons && /color:\s*var\(--text-secondary\)/.test(icons.body) && /stroke-width:\s*1\.6/.test(icons.body), "About's value-tile icons use var(--text-secondary)");
  assert(all.some(r => r.selector === '.about-keys' && /grid-template-columns:\s*1fr 1fr/.test(r.body) && /column-gap:\s*20px/.test(r.body)), 'the key map runs in two columns');
  assertMatch(css, /@media \(max-width: 440px\) \{[^}]*\}\s*\.about-keys \{ grid-template-columns: 1fr; \}/, 'the key map collapses to one column on narrow windows');
  assert(all.some(r => r.selector === '#about-modal .about-close' && /position:\s*absolute/.test(r.body) && /width:\s*32px/.test(r.body) && /z-index:\s*2/.test(r.body)), 'the close sits top-right with a 32px hit area');
});

// UI-R3 Fire 04: the Tonight instrument. A thin arc over a proportional
// scale, the broken O outside it while a run is active, phase looks inside
// the colour grammar, an honest station, one name per session, one Pause
// rule, opaque surfaces, a fullscreen clock at real size and a widget that
// matches. Behaviour: test/tonight-instrument.test.js (vm sandbox).
check('Fire 04 Tonight instrument', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const widgetSrc = fs.readFileSync(path.join(root, 'widget.html'), 'utf8');
  const all = p03CssRules(css);

  // The block: above the contract, judged on its own, no loops.
  const fireAt = css.indexOf('/* -- UI-R3 · Fire 04: Tonight instrument');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(fireAt > 0 && fireAt < rmAt, 'the Fire 04 block sits above the reduced-motion contract');
  const fire = css.slice(fireAt, cssBlockEnd(css, fireAt));
  const fireRules = p03CssRules(fire);
  assert(!/@keyframes/.test(fire) && !fireRules.some(r => /(^|;)\s*animation(-[a-z-]+)?\s*:/.test(r.body)), 'Fire 04 adds no animation and no keyframes');
  assert(!fireRules.some(r => /#testmode-pill|data-truth|\.ov-truth|\.ll-truth|status-pill/.test(r.selector)), 'Fire 04 never restyles a Test Mode / REAL truth surface');

  // Markup: mask, scale, outer O and station inside svg.timer-ring, in order, #ring-head last.
  const svgAt = htmlSrc.indexOf('<svg class="timer-ring" viewBox="0 0 200 200" aria-hidden="true" focusable="false">');
  assert(svgAt > 0, 'svg.timer-ring is decorative (aria-hidden, focusable=false)');
  const svg = htmlSrc.slice(svgAt, htmlSrc.indexOf('</svg>', htmlSrc.indexOf('id="ring-head"', svgAt)));
  const order = ['<mask id="ring-cut-mask" maskUnits="userSpaceOnUse"', 'class="ring-bg"', 'class="ring-ticks"', 'class="ring-ticks-major"', 'class="ring-segments"', 'class="ring-o"', 'class="ring-progress"', 'class="ring-station"', 'id="ring-head"'];
  const at = order.map(t => svg.indexOf(t));
  assert(at.every(p => p > 0) && at.every((p, i) => i === 0 || p > at[i - 1]), `svg.timer-ring holds ${order.join(' < ')} in that order`);
  assert(/<circle cx="100" cy="100" r="90" fill="none" stroke="#000" stroke-width="12" stroke-dasharray="0 198 7 176\.5 7 136 7 33\.99" stroke-dashoffset="36"\/>/.test(svg), 'the mask cuts the three logo-O gaps (pattern sums to 565.49)');
  assert(/<g class="ring-head" id="ring-head">[\s\S]*<\/g>\s*$/.test(svg), '#ring-head is the last node, so the particle stays on top');

  // The arc, the scale, the outer O.
  assert(all.some(r => r.selector === '.ring-bg, .ring-progress' && /stroke-width:\s*5;/.test(r.body)) && !all.some(r => r.selector === '.ring-bg, .ring-progress' && /stroke-width:\s*8;/.test(r.body)), '.ring-bg, .ring-progress { stroke-width: 5; }');
  for (const sel of ['.ring-ticks', '.ring-ticks-major', '.ring-o', '.ring-station']) {
    const rules = all.filter(r => r.selector.split(',').map(s => s.trim()).includes(sel));
    assert(rules.some(r => /pointer-events:\s*none/.test(r.body)), `${sel} has pointer-events: none`);
    assert(!all.some(r => new RegExp(`(^|[\\s,])${sel.replace(/\./g, '\\.')}(?![\\w-])`).test(r.selector) && /(^|;)\s*(animation|transition)(-[a-z-]+)?\s*:/.test(r.body)), `${sel} never animates or transitions`);
  }
  assert(fireRules.some(r => r.selector === 'body.bezel :is(.ring-ticks, .ring-ticks-major)' && /opacity:\s*0/.test(r.body)), 'the analog bezel hides the scale (it draws its own)');
  assert(fireRules.some(r => r.selector === 'body:is(.is-running, .is-paused):not(.bezel) .ring-o' && /opacity:\s*1/.test(r.body)) && fireRules.some(r => r.selector === 'body:is(.is-running, .is-paused):not(.bezel) .ring-segments' && /opacity:\s*0/.test(r.body)), 'exactly one broken O per state: the outer O replaces the track while a run is active');
  assert(fireRules.some(r => r.selector === '.ring-o' && /opacity:\s*0/.test(r.body)), 'the outer O is hidden by default (idle, bezel, outcome hold)');
  const tick = fireRules.find(r => r.selector === '.ring-ticks');
  assert(tick && /stroke:\s*var\(--ring-tick\)/.test(tick.body) && fireRules.some(r => r.selector === 'body[data-theme="dawn"]' && /--ring-tick:/.test(r.body)), 'the scale ink is a token with a Dawn value');
  for (const [ring, w] of [['neon', 7], ['midnight', 5], ['minimal', 3.5]]) {
    assert(fireRules.some(r => r.selector === `body[data-ring="${ring}"] .ring-progress` && new RegExp(`stroke-width:\\s*${w};`).test(r.body)), `the ${ring} arc is ${w} units`);
  }

  // Phases: winding down is never amber; paused cuts the arc; Last Light thins.
  assert(!all.some(r => /body\.phase-dim/.test(r.selector) && /stroke:\s*var\(--accent-amber\)/.test(r.body)), 'no rule pairs body.phase-dim with an amber stroke');
  assert(!all.some(r => /body\.phase-dim[^,]*\.timer-ring/.test(r.selector) && /245, 184, 61/.test(r.body)), 'winding down never gets the amber halo');
  assert(fireRules.some(r => r.selector === 'body.phase-dim:not(.is-paused) .ring-progress' && /stroke:\s*rgba\(var\(--accent-rgb\), 0\.62\)/.test(r.body)), 'winding down dims the violet');
  assert(fireRules.some(r => r.selector === 'body.is-paused .ring-progress' && /mask:\s*url\(#ring-cut-mask\)/.test(r.body)) && htmlSrc.includes('<mask id="ring-cut-mask"'), 'a paused arc is cut by #ring-cut-mask, which exists');
  assert(fireRules.some(r => r.selector === 'body.phase-lastlight .ring-progress' && /stroke-width:\s*3\.5;/.test(r.body)), 'Last Light thins the arc');
  assertMatch(css, /body\.phase-lastlight\.test-mode \.ring-progress \{ stroke: var\(--accent-amber\); \}/, 'Test Mode last light stays amber');

  // The station: toggled in render() from canonical state, never in updateRing.
  const render = p03FnBody(rendererJs, 'render');
  assertMatch(render, /document\.body\.classList\.toggle\('has-station', hasWindingDownStation\(\)\);/, 'render() toggles body.has-station');
  assert(!/has-station|hasWindingDownStation/.test(p03FnBody(rendererJs, 'updateRing')), 'updateRing never touches the station');
  assertMatch(p03FnBody(rendererJs, 'hasWindingDownStation'), /return 0\.25 \* total > grace \* 60;/, 'the station needs a real winding-down phase (grace before the 25% mark)');
  assertMatch(p03FnBody(rendererJs, 'applyTimerPayload'), /state\.runGraceMinutes = /, 'applyTimerPayload stores the run grace from the payload');
  assert(fireRules.some(r => /^body\.has-station:not\(\.bezel\):not\(\.mini-mode\):not\(\.fullscreen-clock-mode\) \.ring-station$/.test(r.selector) && /opacity:\s*1/.test(r.body)), 'the station shows only with body.has-station, outside the bezel, mini and fullscreen');

  // Digits in a box that no longer wraps.
  const display = fireRules.find(r => r.selector === '.timer-display');
  assert(display && /min-width:\s*\d+cqw/.test(display.body), '.timer-display has a cqw min-width');
  assert(!all.some(r => /(^|[\s,])\.timer-display$/.test(r.selector) && /inset:\s*0/.test(r.body)), '.timer-display never uses inset: 0 (it would cover the full-screen button)');
  assert(fireRules.some(r => r.selector === '.time-main' && /white-space:\s*nowrap/.test(r.body)) && !all.some(r => /(\.time-main|\.time-label|\.time-sub)/.test(r.selector) && /text-overflow:\s*ellipsis/.test(r.body)), 'digits never wrap and no truth label is ever ellipsized');
  assertMatch(css, /\.time-main \{[^}]*font-size: clamp\(56px, 25cqw, 104px\);/, 'the digits scale with the ring (25cqw)');

  // One name per session.
  assert(fireRules.some(r => r.selector === 'body:is(.is-running, .is-paused) .timer-name.is-default' && /display:\s*none/.test(r.body)), 'the default name never shows during a run');
  assert(fireRules.some(r => r.selector === 'body.fullscreen-clock-mode .timer-name.is-default' && /display:\s*none/.test(r.body)), 'the default name never shows on the fullscreen clock');
  assert(!/timerName\.textContent\s*=[^=]|state\.timerName\s*=[^=]/.test(render), 'render() never writes the timer name');
  assertMatch(render, /syncTimerNameDefault\(\);/, 'render() marks the default name');
  assertMatch(htmlSrc, /id="timer-name"[^>]*title="Name this session"/, '#timer-name says it can be named');

  // The fullscreen clock at real size.
  assert(!all.some(r => /fullscreen-clock-mode[^,{]*\.timer-section/.test(r.selector) && /transform:\s*scale\(/.test(r.body)), 'no fullscreen .timer-section scale transform');
  assert(fireRules.some(r => r.selector === 'body.fullscreen-clock-mode .dashboard' && /overflow:\s*hidden/.test(r.body)), 'the fullscreen .dashboard never scrolls');
  assert(fireRules.some(r => r.selector === 'body.fullscreen-clock-mode :is(.night-beam, .night-dust)' && /display:\s*none/.test(r.body)), 'no beam or dust from an empty corner in fullscreen');
  assert(fireRules.some(r => r.selector === 'body.fullscreen-clock-mode .timer-display.clock-idle .time-main' && /var\(--clock-scale, 1\)/.test(r.body)), "the fullscreen digits keep the user's clock size");

  // The full-screen label under the dial.
  assertMatch(htmlSrc, /id="btn-fullscreen-clock"[^>]*title="Full screen clock" aria-label="Full screen clock"[^>]*>[\s\S]*?<\/svg><span>Full screen<\/span><\/button>/, 'the full-screen button reads "Full screen" (title and aria-label agree)');
  assert(all.some(r => r.selector === '.fullscreen-clock-btn' && /display:\s*none/.test(r.body)), 'the button keeps its base display:none (render() sets flex)');
  assert(all.some(r => r.selector === 'body.mini-mode .fullscreen-clock-btn' && /display:\s*none !important/.test(r.body)), 'never in the mini puck');

  // One Pause rule; opaque surfaces.
  const pause = fireRules.find(r => r.selector === '#action-bar-running #btn-pause');
  assert(pause && /background:\s*linear-gradient\(rgba\(var\(--accent-rgb\), 0\.14\), rgba\(var\(--accent-rgb\), 0\.14\)\), var\(--bg-primary\);/.test(pause.body), 'Pause is violet-tinted over an opaque base while running');
  const resume = fireRules.find(r => r.selector === 'body.is-paused #action-bar-running #btn-pause');
  assert(resume && /background:\s*var\(--accent-cyan\)/.test(resume.body) && /color:\s*var\(--accent-ink\)/.test(resume.body), 'Resume is the filled violet primary while paused');
  assert(!all.some(r => /#btn-pause/.test(r.selector) && !/is-paused/.test(r.selector) && /background:\s*var\(--accent-cyan\)/.test(r.body)), 'the violet fill is only ever under body.is-paused');
  const lastLayer = (sel) => {
    const r = fireRules.filter(x => x.selector === sel && /(^|;)\s*background:/.test(x.body)).pop();
    const bg = r && (r.body.match(/(?:^|;)\s*background:\s*([^;]+)/) || [])[1];
    return bg ? bg.trim() : '';
  };
  for (const sel of ['.snooze-group', '#action-bar-running #btn-stop', '.ring-container::before']) {
    assert(/var\(--bg-(primary|secondary|card)\)\)?$/.test(lastLayer(sel)), `${sel} ends on an opaque bg token (got ${lastLayer(sel)})`);
  }

  // The widget speaks the instrument.
  const wStyle = widgetSrc.slice(widgetSrc.indexOf('<style>'), widgetSrc.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const wTokens = wStyle.slice(wStyle.indexOf(':root {'), wStyle.indexOf('}', wStyle.indexOf(':root {')) + 1);
  assert(wTokens && /--w-violet: #9b93d6;/.test(wTokens), 'widget.html has its token block');
  assert(!/#[0-9a-f]{3,8}\b/i.test(wStyle.replace(wTokens, '')), 'widget.html has no hex colour outside its token block');
  assert(/\.widget\.running\.phase-dim \.widget-ring \.ring-arc \{ stroke: color-mix\(in srgb, var\(--w-violet\)/.test(wStyle), 'the widget winds down in a dimmed violet, never amber');
  assert(/class="ring-track"[^>]*pathLength="100" stroke-dasharray="30 4 24 4 18 20"/.test(widgetSrc), "the widget track is the logo's broken O");
  assert(/'Bahnschrift'/.test(wStyle) && !/animation|@keyframes/.test(wStyle), 'the widget uses the instrument face and never animates');
});

// UI-R3 Fire 07: Devices. Off satellites invite (one violet CTA, the whole
// card is the link), ready/live satellites carry the teal beam, This PC is the
// branded hub, peers read as instruments, and every value stays honest.
// Behaviour: test/devices-family.test.js ('Fire 07' tests).
check('Fire 07 devices', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rendererOnly = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const fireAt = css.indexOf('/* -- UI-R3 · Fire 07: Devices');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(fireAt > 0 && fireAt < rmAt, 'the Fire 07 block sits above the reduced-motion contract');
  const fire = css.slice(fireAt, cssBlockEnd(css, fireAt));
  const fireRules = p03CssRules(fire);
  assert(!/infinite/.test(fire) && !/@keyframes/.test(fire) && !fireRules.some(r => /(^|;)\s*animation(-[a-z-]+)?\s*:/.test(r.body)), 'Fire 07 adds no loop, keyframes or animation');

  // Every satellite link carries both labels; the PC link carries none.
  for (const id of ['device-card-phone', 'device-card-family', 'device-card-lights', 'device-card-wifi']) {
    const at = htmlSrc.indexOf(`id="${id}"`);
    const card = htmlSrc.slice(at, htmlSrc.indexOf('</article>', at));
    const link = card.match(/<button type="button" class="device-link" data-devices-settings="[a-z-]+">([\s\S]*?)<\/button>/);
    assert(link && /class="dl-off"/.test(link[1]) && /class="dl-on"/.test(link[1]) && /class="dl-chev" aria-hidden="true"/.test(link[1]), `${id}: the link holds .dl-off, .dl-on and the chevron`);
  }
  assert(/data-devices-settings="phone"><span class="dl-off">Set up phone<\/span><span class="dl-on">Pair &amp; manage<\/span><span class="dl-err">Fix in Phone settings<\/span>/.test(htmlSrc), 'the phone link has its error label and still opens Phone settings');
  const pc = htmlSrc.slice(htmlSrc.indexOf('id="device-card-pc"'), htmlSrc.indexOf('</article>', htmlSrc.indexOf('id="device-card-pc"')));
  assert(!/dl-off|dl-on/.test(pc), 'the PC link has no off/on labels');
  const rule = sel => fireRules.find(r => r.selector === sel);
  assert(rule('.device-link .dl-off,\n.device-link .dl-on,\n.device-link .dl-err') && /display:\s*none/.test(rule('.device-link .dl-off,\n.device-link .dl-on,\n.device-link .dl-err').body), 'labels are hidden by default at a specificity above .device-link span');
  assert(/display:\s*inline/.test((rule('.device-card:not(#device-card-pc)[data-state="off"] .device-link .dl-off') || {}).body || ''), 'off cards show .dl-off');
  assert(/display:\s*inline/.test((rule('.device-card:not(#device-card-pc):not([data-state="off"]) .device-link .dl-on') || {}).body || ''), 'other states show .dl-on (so .dl-on is hidden while off)');
  // The stretched target exists only under the off state, with no z-index.
  const stretched = fireRules.filter(r => /\.device-link::after/.test(r.selector));
  assert(stretched.length === 1 && stretched[0].selector === '.device-card:not(#device-card-pc)[data-state="off"] .device-link::after' && /inset:\s*0/.test(stretched[0].body) && !/z-index/.test(stretched[0].body), 'the whole-card link layer is off-only and never raised');
  assert(fireRules.some(r => r.selector === '.device-card:not(#device-card-pc)[data-state="off"]:has(.device-link:focus-visible)' && /outline:\s*2px solid/.test(r.body)), 'the focus ring is scoped to off cards');
  // Hover only where the card is clickable.
  assert(!p03CssRules(css).some(r => r.selector === '.device-card:hover'), 'no bare .device-card:hover (only clickable off satellites get a hover)');
  assert(p03CssRules(css).some(r => r.selector === '.device-card:not(#device-card-pc)[data-state="off"]:hover' && /var\(--bg-hover\)/.test(r.body)), 'the off-card hover uses the theme hover token');
  assert(!/#17222c/.test(css), 'no hard-coded dark hover');
  // Lit grammar: the beam and wash key on ok/live only and exclude the PC.
  const lit = fireRules.filter(r => /rgba\(var\(--teal-rgb\)/.test(r.body) && /\.device-card:not\(#device-card-pc\)/.test(r.selector));
  assert(lit.length >= 3 && lit.some(r => /::before$/.test(r.selector)), 'lit satellites carry the beam and wash');
  for (const r of lit) {
    assert(!/"off"|"warn"|"error"/.test(r.selector) && /\[data-state="(ok|live)"\]/.test(r.selector), `the glow follows ok/live only: ${r.selector}`);
  }
  // The hub ring: static, state-coloured, with the strip value colourless.
  assertMatch(pc, /<svg class="device-hub-ring" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle class="hub-track" cx="32" cy="32" r="26" pathLength="100"\/>/, 'This PC shows the broken-O hub ring');
  assert(!/device-hub-arc|hub-arc/.test(htmlSrc + rendererOnly + css), 'no countdown arc on the hub (Tonight owns time)');
  const hubRules = p03CssRules(css).filter(r => /device-hub-ring|hub-track|hub-glyph/.test(r.selector));
  assert(hubRules.length >= 4 && !hubRules.some(r => /animation|transition/.test(r.body)), 'the hub ring is static');
  assert(hubRules.some(r => r.selector === '.device-hub-ring .hub-track' && /stroke-dasharray:\s*30 4 24 4 18 20/.test(r.body)), "the track is the logo's broken O");
  assert(!hubRules.some(r => /\.hub-track$/.test(r.selector) && /var\(--pf-teal\)/.test(r.body) && !/data-state="ok"/.test(r.selector)), 'the track is teal only for ok/live');
  for (const r of p03CssRules(css).filter(x => x.selector === '#device-card-pc .device-rows .status-row > span:last-child')) {
    assert(!/color:/.test(r.body), 'no strip value rule sets a colour: Test Mode amber and REAL red win');
  }
  assert(!fireRules.some(r => /#device-card-pc/.test(r.selector) && /overflow:\s*hidden/.test(r.body)), 'the hub never clips its top-edge beam');
  assert(p03CssRules(css).some(r => r.selector === '#device-card-pc .device-rows' && /display:\s*flex/.test(r.body)), 'the host strip is a flex row (hidden cells reflow)');
  assert(!/#device-card-pc \.device-rows:has\(> #device-pc-plan-row\[hidden\]\)/.test(css), 'the per-hidden-row grid override is gone');

  // Host strip facts.
  assertMatch(htmlSrc, /<span>Ending<\/span><span id="action-name">/, "'Ending' label");
  assertMatch(htmlSrc, /<span>Ends at<\/span><span id="end-time">Not running<\/span>/, "'Ends at' with an honest first paint");
  const renderFn = p03FnBody(rendererOnly, 'render');
  assert(!/els\.endTime\.textContent = [^;]*'Idle'\s*;/.test(renderFn) && /endsAtText === 'Idle' \? 'Not set' : endsAtText/.test(renderFn), "render() never writes a bare 'Idle' into #end-time");
  assertMatch(p03FnBody(rendererOnly, 'applySystemInfo'), /els\.devicePcBatteryRow\.hidden = batteryUnknown;/, 'an unreported battery hides its row');

  // Phone failure: one plain line, text only, no address or pairing code.
  const devicesFn = p03FnBody(rendererOnly, 'renderDevicesPanel');
  assertMatch(devicesFn, /setTextIfChanged\(els\.devicePhoneError, reason\)/, 'the phone reason is written as text, on change');
  assert(!/devicePhoneError\.innerHTML/.test(rendererOnly), 'never innerHTML for the phone reason');
  const reasonFn = p03FnBody(rendererOnly, 'describePhoneFailure');
  assert(!/\.url|shortCode|failureDetails|errorMessage|lanIp/.test(reasonFn), 'the phone reason never reads the URL, pairing code, process details, address or raw error text');
  assert(!/\.url\b|shortCode|failureDetails/.test(devicesFn), 'renderDevicesPanel reads no URL, pairing code or process details');

  // Test Mode scope notes from Fire 02's one helper.
  for (const id of ['device-lights-scope', 'device-wifi-scope']) {
    assertMatch(htmlSrc, new RegExp(`<p class="device-scope-note" id="${id}" hidden>Runs in Test Mode too\\.`), `#${id} is static, hidden by default`);
  }
  const syncFn = p03FnBody(rendererOnly, 'syncDeviceScopeNotes');
  assert(/windDownEffects\(facts\)/.test(syncFn) && /state\.settingsLoaded === true && state\.dryRun === true/.test(syncFn), 'the notes read windDownEffects and show only in loaded Test Mode');
  assert(!/blockOnDim|enabled|deviceMacs/.test(syncFn), 'no second copy of main\'s conditions in syncDeviceScopeNotes');
  assertMatch(devicesFn, /pickWindDownFacts\(\{ wifiGuard: wifi, lights \}\)/, 'Devices feeds its fresh reads into the shared facts');
  assertMatch(renderFn, /typeof syncDeviceScopeNotes === 'function'\) syncDeviceScopeNotes\(\);/, 'render() keeps the notes in step with a Test Mode switch');
  for (const f of ['wifiGuard.js', 'smartLights.js']) {
    assert(!/dryRun/.test(fs.readFileSync(path.join(root, f), 'utf8')), `${f} has started handling dryRun: reword or remove the Devices Test Mode note`);
  }
  assert(fireRules.some(r => r.selector === '.device-scope-note[hidden]' && /display:\s*none/.test(r.body)), 'a hidden scope note takes no space');
  assert(!fireRules.some(r => /device-scope-note/.test(r.selector) && /transition|opacity/.test(r.body)), 'the scope note is static truth');

  // Wi-Fi Guard: only the non-secret boolean is added.
  assertMatch(devicesFn, /blockOnDim: wifi\.blockOnDim !== false/, 'devicesWifiSettings keeps blockOnDim (as main reads it)');

  // Peer rows stay a grid; their pills and the hairlines follow every theme.
  assert(p03CssRules(css).some(r => r.selector === '.device-peers .device-peer' && /display:\s*grid/.test(r.body)), 'peer rows stay a grid');
  assert(fireRules.some(r => r.selector === '.device-peer-actions .peer-act--stop' && /var\(--accent-red\)/.test(r.body)), 'peer Stop uses the red outline grammar');
  for (const sel of ['.device-rows .status-row', '#device-card-pc .device-rows', '#device-card-pc .device-rows .status-row', '.device-peers .device-peer', '.set-peer']) {
    const r = p03CssRules(css).find(x => x.selector === sel && /border/.test(x.body));
    assert(r && /color-mix\(in srgb, var\(--border-color\) 60%, transparent\)/.test(r.body) && !/rgba\(38, 55, 70/.test(r.body), `${sel} hairline follows the theme`);
  }
});

check('Fire 08 night modes', () => {
  const vm = require('vm');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const nmSrc = fs.readFileSync(path.join(root, 'renderer-night-modes.js'), 'utf8');
  const profSrc = fs.readFileSync(path.join(root, 'renderer-profiles.js'), 'utf8');
  const utilsSrc = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
  const coreSrc = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const fireAt = css.indexOf('/* -- UI-R3 · Fire 08: Night Modes');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(fireAt > 0 && fireAt < rmAt, 'the Fire 08 block sits above the reduced-motion contract');
  const fire = css.slice(fireAt, cssBlockEnd(css, fireAt));
  const fireRules = p03CssRules(fire);
  const allRules = p03CssRules(css);
  const rule = sel => fireRules.find(r => r.selector === sel);
  assert(!/infinite/.test(fire) && !/@keyframes/.test(fire) && !fireRules.some(r => /(^|;)\s*animation(-[a-z-]+)?\s*:(?!\s*none\s*(;|$))/.test(r.body)), 'Fire 08 adds no loop, keyframes or animation');
  const fnSrc = (src, name) => {
    const head = src.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\([^)]*\\)`));
    assert(head, `function ${name} missing`);
    return `${head[0]} ${p03FnBody(src, name)}`;
  };

  // Scene posters: four static, trusted, decorative SVGs; no truth colours.
  const sceneAt = nmSrc.indexOf('const nmScene = ');
  const sceneSrc = nmSrc.slice(sceneAt, nmSrc.indexOf('});', nmSrc.indexOf('const SCENE_MAP = ')) + 3);
  const sceneBox = {};
  vm.createContext(sceneBox);
  vm.runInContext(`${sceneSrc} this.SCENE_MAP = SCENE_MAP;`, sceneBox);
  const scenes = sceneBox.SCENE_MAP;
  assert(Object.isFrozen(scenes), 'SCENE_MAP is frozen');
  assert(JSON.stringify(Object.keys(scenes).sort()) === JSON.stringify(['full-shutdown', 'lights-down', 'movie-wind-down', 'quick-sleep']), `SCENE_MAP holds the four Ready posters (${Object.keys(scenes)})`);
  for (const [id, svg] of Object.entries(scenes)) {
    assert(svg.startsWith('<svg class="nm-scene-art"') && /aria-hidden="true" focusable="false"/.test(svg), `${id}: a decorative nm-scene-art svg`);
    assert(!/<script|\son\w+=|#00d1b2|#f5b83d|#ff5c7a|teal|<image|href=|<defs|\sid=|<text|<title/i.test(svg), `${id}: no script, handler, truth colour, image, link, defs, id or text`);
  }
  assert(!/broken-O|play/i.test(scenes['full-shutdown'] + scenes['movie-wind-down']), 'no duplicate broken-O gauge and no play mark in the posters');
  const cards = p03FnBody(nmSrc, 'renderCards');
  assertMatch(cards, /<div class="nm-card-scene">\$\{SCENE_MAP\[mode\.artworkId\] \|\| ''\}\s*<div class="nm-card-artwork">[\s\S]*?\$\{nmRingSvg\(mode\.timer\.durationSeconds\)\}\s*<\/div>/, 'renderCards puts the poster first in the scene (unknown ids: none) and keeps the ring last');
  const artRule = rule('.nm-card-scene > .nm-scene-art');
  assert(artRule && /position:\s*absolute/.test(artRule.body) && /z-index:\s*0/.test(artRule.body) && /pointer-events:\s*none/.test(artRule.body), 'the poster lies under the tile and the ring');
  assert(/display:\s*none/.test((rule('.nm-library-body.has-detail .nm-scene-art') || {}).body || ''), 'the rail hides the posters');
  assert(!fireRules.some(r => /nm-scene-art/.test(r.selector) && /transition:/.test(r.body) && !/transition:\s*opacity/.test(r.body)), 'the posters only ever lift their opacity on hover');

  // The ring: a numeral and a unit (>= 9px, never muted); one duration per full card.
  const unit = allRules.find(r => r.selector === '.nm-ring-unit');
  const unitPx = unit && Number((unit.body.match(/font:\s*\d+\s+([\d.]+)px/) || [])[1]);
  assert(unitPx >= 9 && !/text-muted/.test(unit.body), '.nm-ring-unit is >= 9px and never muted');
  assert(!allRules.some(r => /\.nm-ring-label/.test(r.selector)), 'the dead .nm-ring-label rule is gone');
  assert(/display:\s*none/.test((rule('.nm-library-body:not(.has-detail) .nm-cards-grid .nm-card-tag.nm-dur') || {}).body || ''), 'the duplicate duration chip hides on full Ready cards only');
  assert(!fireRules.some(r => /nm-act|nm-ritual/.test(r.selector) && /display:\s*none/.test(r.body) && !/nm-ritual-label/.test(r.selector)), 'the action and ritual tags are never hidden');
  assertMatch(cards, /card\.setAttribute\('aria-label', nmReadyCardLabel\(mode\)\)/, 'the Ready card label is set as an attribute');

  // Ritual tag: only for standard-ritual modes, static, with a Dawn ink.
  const tagBox = { loGlyph: () => '<svg></svg>' };
  vm.createContext(tagBox);
  vm.runInContext(`${fnSrc(nmSrc, 'nmIsRitualMode')} ${fnSrc(nmSrc, 'nmRitualTagHtml')} ${fnSrc(nmSrc, 'formatDuration')} ${fnSrc(nmSrc, 'formatAction')} ${fnSrc(nmSrc, 'nmReadyCardLabel')} this.tag = nmRitualTagHtml; this.label = nmReadyCardLabel;`, tagBox);
  assert(tagBox.tag({ timer: { ritualId: 'standard' } }) === '<span class="nm-card-tag nm-ritual"><svg></svg><span class="nm-ritual-label">Ritual</span></span>', 'a standard-ritual mode gets the literal Ritual tag');
  for (const ritualId of ['none', undefined, 'standard"><img']) assert(tagBox.tag({ timer: { ritualId } }) === '', `no tag for ritualId ${ritualId}`);
  assert(tagBox.label({ title: 'Lights Down', timer: { durationSeconds: 2700, action: 'sleep', ritualId: 'standard' } }) === 'Lights Down: 45 min, then Sleep, with a guided ritual', 'the ritual card label');
  assert(tagBox.label({ title: 'Quick Sleep', timer: { durationSeconds: 900, action: 'sleep', ritualId: 'none' } }) === 'Quick Sleep: 15 min, then Sleep', 'the direct card label');
  assert(cards.indexOf('nmActionTagHtml(mode.timer.action)') < cards.indexOf('nmRitualTagHtml(mode)') && !cards.slice(cards.indexOf('for (const mode of later)')).includes('nmRitualTagHtml'), 'the ritual tag follows the action tag, on Ready cards only');
  assert(/color:\s*var\(--accent-cyan\)/.test((rule('.nm-card-tag.nm-ritual') || {}).body || ''), 'the ritual tag is violet (you act), never teal');
  assert(/color:\s*var\(--chip-ink-act\)/.test((rule('body[data-theme="dawn"] .nm-card-tag.nm-ritual') || {}).body || ''), 'the Dawn ritual ink exists');
  assert(!fireRules.some(r => /nm-ritual/.test(r.selector) && /(animation|transition)\s*:/.test(r.body)), 'the ritual tag is static');

  // The detail spread: one scene, no Details table, the hero ring from the mode.
  assert((htmlSrc.match(/id="nm-detail-scene"/g) || []).length === 1, '#nm-detail-scene exists once');
  assert(!/id="nm-detail-meta"|id="nm-detail-artwork"|nm-detail-hero/.test(htmlSrc.slice(htmlSrc.indexOf('id="ns-panel-modes"'), htmlSrc.indexOf('<!-- /MODES panel -->'))), 'the Details table and the old hero are gone');
  for (const id of ['nm-detail-truth', 'nm-detail-tier', 'nm-detail-timeline']) assert(htmlSrc.includes(`id="${id}"`), `#${id} is kept`);
  const sceneFn = p03FnBody(nmSrc, 'renderDetailScene');
  assertMatch(sceneFn, /nmRingSvg\(mode\.timer\.durationSeconds, 'nm-ring--hero'\)/, 'the hero ring comes from mode.timer.durationSeconds');
  assert(/SCENE_MAP\[mode\.artworkId\] \|\| ''/.test(sceneFn) && /ARTWORK_MAP\[mode\.artworkId\] \|\| ARTWORK_FALLBACK/.test(sceneFn) && !/mode\.(title|subtitle)/.test(sceneFn), 'the scene is built from the static maps only');
  assertMatch(sceneFn, /arc\.style\.strokeDasharray = '0 999';\s*void arc\.getBoundingClientRect\(\);\s*arc\.style\.strokeDasharray = final;/, 'the hero arc draws once from 0 to its static value');
  assert(!/nm-detail-artwork|nm-detail-meta/.test(nmSrc), 'renderDetail no longer writes the removed elements');
  assert(allRules.some(r => /(^|,\s*)\.nm-library-body\.has-detail \.nm-tiers \.nm-ring(\s*,|$)/m.test(r.selector) && /display:\s*none/.test(r.body)), 'the rail ring-hide is scoped to the tiers');
  assert(!allRules.some(r => /(^|,\s*)\.nm-library-body\.has-detail \.nm-ring(\s*,|$)/m.test(r.selector)), 'no has-detail rule hides the hero ring');
  const heroMotion = fireRules.filter(r => /nm-detail-scene|nm-ring--hero|nm-detail-art/.test(r.selector) && /(transition|animation)\s*:/.test(r.body));
  assert(heroMotion.length === 2 && heroMotion.some(r => r.selector === '.nm-ring--hero .nm-ring-arc' && /transition:\s*stroke-dasharray 700ms var\(--ease-out\)/.test(r.body)) && heroMotion.some(r => r.selector === '.nm-detail-scroll > .nm-detail-scene' && /animation:\s*none/.test(r.body)), 'the only motion in the hero is the stroke-dasharray transition');
  assert(/--text-primary:\s*#f4f7f8/.test((rule('body[data-theme="dawn"] .nm-detail-scene') || {}).body || ''), 'Dawn keeps the night ink on the always-dark band');
  const specFn = p03FnBody(nmSrc, 'nmDetailSpec');
  assert(/'Direct start'/.test(specFn) && /nmRitualSteps\(\) \? 'Guided ritual' : 'Ritual mode'/.test(specFn), "the spec line never contradicts the ritual timeline");
  assert(/spec\.textContent = text/.test(p03FnBody(nmSrc, 'renderDetailSpec')), 'the spec line is textContent');
  assert(!/<path d="M6 4\.5v9l7\.5-4\.5z"/.test(htmlSrc) && /<svg class="chip-glyph nm-cta-glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M7 4\.5L11\.5 9 7 13\.5"\/><\/svg><span class="nm-cta-main">Use Tonight<\/span>/.test(htmlSrc), 'the CTA carries a static chevron, never a play glyph');
  assert(/display:\s*none/.test((rule('.nm-btn-use-tonight:disabled .nm-cta-glyph') || {}).body || ''), 'the chevron hides while disabled');

  // Test Mode scope: windDownEffects, loaded Test Mode only, static amber.
  assertMatch(htmlSrc, /<p class="nm-detail-truth" id="nm-detail-truth" hidden><\/p>\s*<p class="nm-detail-scope" id="nm-detail-scope" hidden><\/p>/, '#nm-detail-scope sits under the truth line, hidden by default');
  const truthFn = p03FnBody(nmSrc, 'renderDetailTruth');
  assert(/windDownEffects\(facts\)/.test(truthFn) && /typeof getWindDownFacts === 'function'/.test(truthFn) && /mode\.status === 'ready'/.test(truthFn) && /state\.settingsLoaded === true && state\.dryRun === true/.test(truthFn), 'the scope line reads windDownEffects only in loaded Test Mode on a ready mode');
  assert(/Wind-down still runs in Test Mode: \$\{effects\.map\(e => e\.label\)\.join\(', '\)\}\./.test(truthFn) && /scope\.textContent !== text/.test(truthFn) && !/scope\.innerHTML/.test(truthFn), 'the scope line is text, written on change');
  assert(!allRules.some(r => /nm-detail-scope/.test(r.selector) && /(animation|transition)\s*:/.test(r.body)), 'the scope line never moves');
  assert(/color:\s*var\(--accent-amber\)/.test((rule('.nm-detail-scope') || {}).body || ''), 'the scope line is amber');

  // My Modes in the flow: the children hide under a detail, never the section.
  assert(/display:\s*none/.test((rule('.nm-library-body.has-detail .profiles-section > *') || {}).body || ''), 'a detail hides My Modes children');
  assert(!allRules.some(r => /(^|,\s*)\.nm-library-body\.has-detail (\.nm-tiers > )?\.profiles-section(\s*,|$)/m.test(r.selector) && /display:\s*none/.test(r.body)), 'the section itself is never display:none (the desktop gate reads it)');
  assert(/margin-top:\s*-10px/.test((rule('.nm-library-body.has-detail .nm-tiers > .profiles-section') || {}).body || '') && /\.nm-tiers \{[^}]*gap:\s*10px/.test(css), 'the emptied section cancels its own .nm-tiers gap in the rail');
  assertMatch(htmlSrc, /<span class="nm-tier-eyebrow profiles-title">My Modes<\/span>\s*<span class="nm-tier-count nm-tier-count--neutral" id="my-modes-count" hidden><\/span>/, 'My Modes carries the tier eyebrow and a neutral count');
  const neutral = rule('.nm-tier-count.nm-tier-count--neutral');
  assert(neutral && !/teal/.test(neutral.body) && /var\(--border-color\)/.test(neutral.body), 'the My Modes count is neutral, never teal');
  const countFn = p03FnBody(profSrc, 'renderMyModesCount');
  assert(/state\.profiles\.length/.test(countFn) && /`\$\{n\} saved`/.test(countFn) && /count\.hidden !== \(n === 0\)/.test(countFn) && !/innerHTML/.test(countFn), "the count is 'N saved' from state.profiles, hidden at 0");
  // Plan rule 5: no CSS-hidden node that JS keeps writing. The later card has
  // no reason node; its aria-label carries the full reason.
  assert(!/nm-card-reason/.test(nmSrc) && !/nm-card-reason/.test(css), 'the later shelf has no hidden reason node or rule');
  assert(/card\.setAttribute\('aria-label', `\$\{mode\.title\} \(unavailable: \$\{reason\}\)`\)/.test(p03FnBody(nmSrc, 'renderCards')), 'the later card aria-label carries the full reason');
  assert(/border-radius:\s*var\(--radius-pill\)/.test((rule('.nm-library-body:not(.has-detail) .nm-card.disabled.nm-card--later') || {}).body || ''), 'the shelf is one row of ghost pills while no detail is open');
  assert(/min-height:\s*36px/.test((rule('.nm-library-body:not(.has-detail) .nm-card.disabled.nm-card--later') || {}).body || ''), 'the pills keep a 36px target');
  assert(!fireRules.some(r => /nm-card--later/.test(r.selector) && /teal|accent-cyan/.test(r.body)), 'the shelf is never teal or primary');

  // My Mode cards: keyboard-reachable, navigate only after a successful idle load.
  const renderProfilesFn = p03FnBody(profSrc, 'renderProfiles');
  assertMatch(renderProfilesFn, /data-profile-id="\$\{profile\.id\}" role="button" tabindex="0"/, 'My Mode cards carry role=button and tabindex=0');
  assertMatch(renderProfilesFn, /<span class="profile-dur">\$\{escapeHtml\(profileDurationText\(profile\)\)\}<\/span>/, 'the right-hand duration uses the shared vocabulary');
  const bindFn = p03FnBody(profSrc, 'bindProfileCard');
  assert(/addEventListener\('keydown'/.test(bindFn) && /e\.target !== card \|\| e\.repeat/.test(bindFn) && /e\.key === 'Enter' \|\| e\.key === ' '/.test(bindFn) && /e\.preventDefault\(\)/.test(bindFn), 'Enter / Space on the card itself, no repeats, Space never scrolls');
  assert(/setAttribute\('aria-pressed'/.test(bindFn) && /setAttribute\('aria-label', profileCardLabel\(profile, chips\)\)/.test(bindFn), 'aria-pressed and the accessible name are attributes');
  assertMatch(p03FnBody(profSrc, 'onProfileCardActivate'), /applyProfile\(profileId, \{ navigate: true \}\)/, 'only the card path asks to navigate');
  const applyFn = p03FnBody(profSrc, 'applyProfile');
  assertMatch(applyFn, /if \(opts\.navigate === true && !state\.running && !state\.paused\) \{\s*if \(state\.armedNightMode && typeof clearArmedNightMode === 'function'\) clearArmedNightMode\(\);\s*if \(typeof handleSidebarNavigation === 'function'\) handleSidebarNavigation\('lib'\);/, 'navigation after a load sits behind opts.navigate and the idle check');
  assert(applyFn.indexOf('opts.navigate') > applyFn.indexOf("notify(heldBackReal") && applyFn.indexOf('opts.navigate') < applyFn.lastIndexOf('return true;'), 'navigation runs only on the success path');
  assert(/applyProfile\(profile\.id\);/.test(p03FnBody(profSrc, 'onMyModesShortcut')) && !/navigate/.test(p03FnBody(profSrc, 'onMyModesShortcut')), 'Ctrl+N never navigates');
  assert(/await applyProfile\(profileId\);\s*closeProfilesModal\(\);/.test(p03FnBody(profSrc, 'renderProfilesList')), "the manager's Load never navigates");
  assert(/display:\s*grid/.test((rule('.profiles-grid .profile-card:not(.profile-card--create)') || {}).body || '') && /repeat\(2, minmax\(0, 1fr\)\)/.test((rule('.profiles-grid') || {}).body || ''), 'My Mode cards sit two across');
  assert(/outline:\s*2px solid var\(--accent-cyan\)/.test((rule('.profile-card:focus-visible') || {}).body || ''), 'a visible focus ring');
  const badgeRule = rule('.profile-card .profile-badge');
  assert(badgeRule && /var\(--text-secondary\)/.test(badgeRule.body) && !/red|teal/.test(badgeRule.body), 'the action badge is neutral');

  // The context menu never deletes in one click.
  assert(coreSrc.includes("{ label: 'Delete…', danger: true, action: () => deleteProfileFromMenu(profileId) }") && !/action: \(\) => deleteProfile\(/.test(coreSrc), "the context menu's Delete… only opens the manager with Delete armed");
  assertMatch(p03FnBody(profSrc, 'deleteProfileFromMenu'), /openProfilesModal\(\);[\s\S]*requestProfileDelete\(row\.querySelector\('\.delete-btn'\), profileId\)/, 'Delete… arms the row through the two-step');

  // The manager: no native dialogs, glyph reorder, one two-step machine.
  for (const file of RENDERER_FILES) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!/(^|[^.\w])confirm\(/m.test(src), `${file} still calls confirm(`);
  }
  assert(/function twoStepNext\(pending, key, now, windowMs = 4000\)/.test(utilsSrc) && /twoStepNext \*\//.test(utilsSrc), 'twoStepNext lives in renderer-utils.js and is exported');
  const listFn = p03FnBody(profSrc, 'renderProfilesList');
  assert(!/&#9650;|&#9660;|▲|▼/.test(profSrc), 'no dingbat reorder triangles');
  assert(/data-action="up"[^>]*aria-label="Move \$\{profileAttr\(profile\.name\)\} up"/.test(listFn) && /data-action="down"[^>]*aria-label="Move \$\{profileAttr\(profile\.name\)\} down"/.test(listFn) && /\$\{profileMoveGlyph\(\)\}/.test(listFn), 'reorder buttons are labelled glyph buttons');
  assert(/loGlyph\('chevron'/.test(p03FnBody(profSrc, 'profileMoveGlyph')), 'the reorder glyph is the LO chevron');
  assert(!/confirm/.test(p03FnBody(profSrc, 'deleteProfile')) && /requestProfileDelete\(btn, profileId\)/.test(listFn), 'deleteProfile only deletes; the row goes through the two-step');
  assert(/twoStepNext\(profileDeletePending, `delete:\$\{profileId\}`/.test(p03FnBody(profSrc, 'requestProfileDelete')) && /twoStepNext\(profileSavePending, `save:/.test(p03FnBody(profSrc, 'saveNewProfile')), 'delete and overwrite share twoStepNext');
  assertMatch(p03FnBody(profSrc, 'saveNewProfile'), /note\.textContent = `A mode named "\$\{name\}" exists\. Press Save mode again to replace it\.`/, 'the overwrite note is text');
  assert(/grid-template-areas:\s*'name actions'\s*'hint hint'\s*'fields fields'\s*'notes notes'/.test((rule('#profiles-modal .profile-item') || {}).body || ''), 'manager rows are a grid that never overlaps');
  const armed = rule('#profiles-modal .profile-item-btn.btn-quiet.delete-btn.is-confirming');
  assert(armed && /color:\s*var\(--accent-red\)/.test(armed.body) && rule('body[data-theme="dawn"] #profiles-modal .profile-item-btn.btn-quiet.delete-btn.is-confirming'), 'the armed Delete uses the red outline grammar, with a Dawn ink');
  assert(/min-width:\s*68px/.test((rule('#profiles-modal .profile-item-btn.delete-btn') || {}).body || ''), "Delete reserves its width for 'Delete?'");
  assert(/transform:\s*none/.test((rule('#profiles-modal .btn-quiet:active .chip-glyph') || {}).body || '') && fire.indexOf('#profiles-modal .btn-quiet:active .chip-glyph') < fire.indexOf('#profiles-modal .profile-item-btn.move-btn[data-action="up"] .profile-move-glyph'), 'manager glyphs (the pin flag included) never take the quiet press spin; the chevron rules still win');

  // Main: a disabled ritual is an honest failure, and the phone hears it.
  assertMatch(mainSrc, /const ritual = ritualMode\.startRitual\(null, \{ profileRitualToken: runToken,[\s\S]*?remoteOrigin: options\.source === 'remote' \|\| options\.origin === 'calendar' \}\);\s*\/\/[\s\S]*?const ritualStarted = Boolean\(ritual && ritual\.active === true\)\s*\|\| Boolean\(timerState\.running \|\| timerState\.paused\);\s*if \(!ritualStarted\) \{\s*profileRitualContext\.clear\(\);\s*if \(!ritual \|\| ritual\.reason === 'disabled'\) \{\s*return \{\s*success: false,\s*code: 'RITUAL_DISABLED'/, 'the gateway judges a ritual start from evidence (active, or a live countdown after a remote fast-forward)');
});

// UI-R3 Fire 09: Schedule as one instrument page. The hero carries the one
// Auto-start switch and a broken-O dial; rule deletes take two presses on the
// shared machine; calendar checks report what happened without error text.
// Behaviour: test/schedule-page.test.js, test/calendarProviders.test.js and
// test/truth-contrast.test.js ('Fire 09' tests).
check('Fire 09 schedule', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const calSrc = fs.readFileSync(path.join(root, 'renderer-calendar.js'), 'utf8');
  const coreSrc = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const cpSrc = fs.readFileSync(path.join(root, 'calendarProviders.js'), 'utf8');
  const fireAt = css.indexOf('/* -- UI-R3 · Fire 09: Schedule instrument');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(fireAt > 0 && fireAt < rmAt, 'the Fire 09 block sits above the reduced-motion contract');
  const fire = css.slice(fireAt, cssBlockEnd(css, fireAt));
  const fireRules = p03CssRules(fire);
  const rule = sel => fireRules.find(r => r.selector === sel);
  assert(!/infinite/.test(fire) && !/@keyframes/.test(fire) && !fireRules.some(r => /(^|;)\s*animation(-[a-z-]+)?\s*:/.test(r.body)), 'Fire 09 adds no loop, keyframes or animation');
  assert(!fireRules.some(r => /\.sch-pill|sch-arm-mode|sch-cal-status|sch-next-particles/.test(r.selector) && /(^|;)\s*(transition|animation)(-[a-z-]+)?\s*:/.test(r.body)), 'truth marks and particles never transition or animate');
  assert(!fireRules.some(r => /\.sch-pill|sch-arm-mode|sch-cal-status/.test(r.selector) && /(^|;)\s*opacity\s*:/.test(r.body)), 'truth marks are never faded');
  // Shared classes are never restyled globally (the content blocker uses them).
  for (const r of fireRules) {
    if (/\.(schedule-rule-item|schedule-rule-form|day-toggle|profile-item-btn|schedule-rule-actions)\b/.test(r.selector)) {
      assert(r.selector.split(',').every(part => /#sch-rules|#schedule-rule-form/.test(part)), `${r.selector} must be scoped to #sch-rules`);
    }
  }
  const sch = htmlSrc.slice(htmlSrc.indexOf('id="ns-panel-sch"'), htmlSrc.indexOf('<!-- DEVICES: operational center'));

  // Page head: one honest line, no auto-start claim; the arm truth is in the hero.
  assertMatch(sch, /<p class="page-sub">Repeat bedtimes, one-off nights and calendar events, counted down on this PC while Lights Out is running\.<\/p>/, 'the Schedule page-sub is the one-line purpose');
  assert(rule('.sch-page .page-sub') && /max-width:\s*none/.test(rule('.sch-page .page-sub').body), 'the page-sub may use the full column (one line at 900px)');

  // Hero: a 120-unit broken-O dial, static teal particles shown only when armed.
  const hero = sch.slice(sch.indexOf('id="sch-next"'), sch.indexOf('id="sch-rules"'));
  assertMatch(hero, /<svg class="sch-next-ring" viewBox="0 0 120 120"/, 'the dial is drawn in a 120-unit box');
  assertMatch(hero, /<circle class="sch-next-track" cx="60" cy="60" r="50" pathLength="100"\/>/, 'the broken-O track is r=50, pathLength 100');
  assertMatch(hero, /<circle class="sch-next-arc" id="sch-next-arc" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="0 100"/, 'the arc ships empty (no fake progress)');
  assert((hero.match(/<g class="sch-next-particles">((?:<rect [^>]*\/>){3})<\/g>/) || []).length === 2, 'three static particle rects');
  assert(/opacity:\s*0\s*;?\s*$/.test((rule('.sch-next:not([data-state="armed"]) .sch-next-particles') || {}).body || ''), 'the particles are hidden unless armed');
  assert(!p03CssRules(css).some(r => /sch-next-particles/.test(r.selector) && /(^|;)\s*(transition|animation)(-[a-z-]+)?\s*:/.test(r.body)), 'the particles are static everywhere');
  assertMatch((rule('.sch-next-when') || {}).body || '', /font:\s*300 64px\/0\.95 var\(--font-instrument\)/, 'the next lights-out is 64px instrument numerals');
  assert(/color:\s*var\(--text-secondary\)/.test((rule('.sch-next[data-state="unarmed"] .sch-next-when') || {}).body || ''), 'unarmed numerals never overclaim (secondary ink)');
  assertMatch(hero, /<label class="checkbox-label sch-arm sch-arm--hero" for="cal-auto-start">[\s\S]*?<input type="checkbox" id="cal-auto-start" aria-describedby="sch-arm-hint sch-arm-mode">/, 'the hero switch keeps its label and describes itself by the hint and mode lines');
  assertMatch(hero, /<p class="sch-next-arm"><span id="sch-arm-hint">[^<]+<\/span><span class="sch-arm-mode" id="sch-arm-mode" hidden><\/span><\/p>\s*<\/article>/, 'the hint and the Test / REAL line sit in the full-width row under the hero grid');
  assert(/grid-column:\s*1 \/ -1/.test((rule('.sch-next-arm') || {}).body || ''), 'the arm row spans the hero');
  const side = hero.slice(hero.indexOf('class="sch-next-side"'), hero.indexOf('class="sch-next-arm"'));
  const sideOrder = ['id="cal-auto-start"', 'id="sch-next-consequence"', 'id="sch-next-in"', 'id="btn-start-from-event"'].map(t => side.indexOf(t));
  assert(sideOrder.every((p, i) => p > 0 && (i === 0 || p > sideOrder[i - 1])), 'side column order: switch, consequence pill, starts in, Start countdown now');
  const heroCss = rule('.sch-page .sch-arm.sch-arm--hero');
  assert(heroCss && /background:\s*transparent/.test(heroCss.body) && /border-color:\s*var\(--border-strong\)/.test(heroCss.body), 'the hero switch out-specifies the P10 arm row');
  assert(!p03CssRules(css).some(r => /^#sch-rules \.sch-arm\b/.test(r.selector)), 'no #sch-rules .sch-arm rules are left');
  const next = p03FnBody(calSrc, 'renderScheduleNext');
  assertMatch(next, /setCalText\(eyebrowEl, armed \? 'Next lights-out' : 'Next bedtime'\);/, "the eyebrow says 'Next lights-out' only when armed");
  assertMatch(next, /card\.dataset\.state = 'none';\s*setCalText\(eyebrowEl, 'Next bedtime'\);/, "nothing scheduled reads 'Next bedtime'");
  assertMatch(next, /setCalText\(spanEl, ''\);\s*if \(spanEl\) spanEl\.hidden = true;/, 'state none hides and clears the span');
  assertMatch(next, /'All rules are off\. Turn one on below\.'/, 'all rules off says so');
  assert(!/\.sch-arm|sch-next-side|cal-auto-start/.test(next), 'the hero never hides the switch row');
  assertMatch(p03FnBody(calSrc, 'scheduleSpanAction'), /if \(!state\.settingsLoaded\) return 'ends';\s*return state\.dryRun \? 'Test ends' : `\$\{actionLabel\(action\)\} at`;/, 'the span names a real action only in REAL mode');

  // Rule cards: the action time leads, the full truth line stays for readers.
  const card = p03FnBody(calSrc, 'ruleCardHtml');
  assertMatch(card, /<span class="sr-only">\$\{ruleTruthLine\(rule\)\}<\/span>/, 'the full ruleTruthLine stays in an sr-only span');
  assert(/rule-enabled-toggle/.test(card) && /btn-quiet sch-rule-icon rule-edit-btn/.test(card) && /btn-quiet btn-quiet--danger sch-rule-icon rule-delete-btn/.test(card) && (card.match(/data-rule-id="\$\{id\}"/g) || []).length === 4, 'the stable classes and data-rule-id stay');
  assert(/aria-label="Edit \$\{ruleAttr\(label\)\}" title="Edit \$\{ruleAttr\(label\)\}">\$\{loGlyph\('edit'\)\}/.test(card) && /aria-label="Delete \$\{ruleAttr\(label\)\}" title="Delete \$\{ruleAttr\(label\)\}">\$\{loGlyph\('trash'\)\}/.test(card), 'Edit / Delete are labelled LO glyph buttons');
  assert(/c\.dayNote, c\.floorNote/.test(card), 'the day and floor notes stay visible');
  assertMatch(p03FnBody(calSrc, 'ruleDayDots'), /data-d="\$\{SCHEDULE_DAY_LABELS\[d\]\.charAt\(0\)\}"[\s\S]*aria-current="date"/, 'the day track letters come from SCHEDULE_DAY_LABELS; today is aria-current');
  const dayAfter = rule('#sch-rules .sch-day::after');
  assert(dayAfter && /content:\s*attr\(data-d\)/.test(dayAfter.body) && /position:\s*absolute/.test(dayAfter.body), 'the day letter sits under its pill');
  assert(/opacity:\s*1/.test((rule('#sch-rules .schedule-rule-item.disabled') || {}).body || '') && rule('#sch-rules .sch-rule.disabled .sch-rule-clock,\n#sch-rules .sch-rule.disabled .sch-rule-days'), 'an off rule dims only its clock and track');

  // Two-step delete on the shared machine.
  assertMatch(p03FnBody(calSrc, 'ruleDeleteClick'), /twoStepNext\(st\.pending, `rule:\$\{ruleId\}`, now, RULE_DELETE_MS\)/, 'ruleDeleteClick delegates to twoStepNext');
  const listFn = p03FnBody(calSrc, 'renderScheduleRules');
  assertMatch(listFn, /^\{\s*\/\/[^\n]*\n\s*disarmRuleDelete\(\);/, 'every re-render disarms first');
  const delClick = listFn.slice(listFn.indexOf("list.querySelectorAll('.rule-delete-btn')"));
  assert(/requestRuleDelete\(btn\)/.test(delClick) && !/persistScheduleRules/.test(delClick), 'the Delete click goes through requestRuleDelete, never straight to persistScheduleRules');
  assert(/'Escape'/.test(delClick) && /'blur'/.test(delClick) && !/mouseleave/.test(delClick), 'Escape and blur disarm; mouseleave does not');
  const req = p03FnBody(calSrc, 'requestRuleDelete');
  assert(req.indexOf('ruleDeleteClick(') > 0 && req.indexOf('ruleDeleteClick(') < req.indexOf('persistScheduleRules()') && /if \(decision === 'delete'\) \{[\s\S]*?persistScheduleRules\(\)\.then\(saved => \{ if \(saved\) notify\(`Deleted "\$\{label\}"`, 'info'\);/.test(req), 'only a confirmed press persists, then an info toast after a successful save');
  const armed = rule('#sch-rules .rule-delete-btn.is-confirming');
  assert(armed && /color:\s*var\(--accent-red\)/.test(armed.body) && /min-width:\s*72px/.test(armed.body) && rule('body[data-theme="dawn"] #sch-rules .rule-delete-btn.is-confirming'), 'the armed Delete is red, sized, with a Dawn ink');
  assert(/min-width:\s*148px/.test((rule('#sch-rules .sch-rule .schedule-rule-actions') || {}).body || ''), "the actions reserve room for 'Delete?'");

  // The rule editor: real labels, a named days group, a dark two-column grid.
  const form = sch.slice(sch.indexOf('id="schedule-rule-form"'), sch.indexOf('id="sch-once"'));
  for (const id of ['rule-label', 'rule-time', 'rule-duration', 'rule-action']) assert(form.includes(`<label for="${id}">`) && form.includes(`id="${id}"`), `#${id} has a label[for]`);
  assertMatch(form, /<div class="day-toggle-grid" id="rule-days" role="group" aria-label="Active days">/, 'the days group is a named group');
  assert(/>Save rule<\/button>/.test(form) && /Start a timer · minutes/.test(form), 'sentence-case Save, explicit timer action label');
  const grid = rule('#sch-rules #schedule-rule-form');
  assert(grid && /display:\s*grid/.test(grid.body) && /grid-template-columns:\s*minmax\(0, 1\.4fr\) minmax\(0, 1fr\)/.test(grid.body), 'the editor is a two-column grid');
  assertMatch(p03FnBody(calSrc, 'openRuleForm'), /form\.style\.display = '';/, "openRuleForm clears the inline none (the CSS grid applies)");
  assertMatch(p03FnBody(calSrc, 'closeRuleForm'), /form\.style\.display = 'none';/, 'closeRuleForm hides it');
  assert(/@media \(max-width: 560px\)\s*\{\s*#sch-rules #schedule-rule-form \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(fire), 'single column under 560px');

  // One night only: no empty native box while off; an honest toast.
  const once = sch.slice(sch.indexOf('id="sch-once"'), sch.indexOf('id="sch-calendars"'));
  assertMatch(once, /<input type="datetime-local" id="schedule-time"/, '#schedule-time keeps its id, type and place');
  assert(/display:\s*none/.test((rule('#sch-once .schedule-controls:not(:has(#chk-schedule:checked)) #schedule-time') || {}).body || ''), '#schedule-time is hidden while #chk-schedule is unchecked');
  assertMatch(once, /One time only\. Not saved, starts nothing by itself\./, 'the One night only note');
  const sel = p03FnBody(coreSrc, 'selectClockTarget');
  assert(!/Schedule target selected/.test(sel) && /state\.dryRun \? `Test Mode countdown to \$\{when\}` : `\$\{actionLabel\(\)\} at \$\{when\}`/.test(sel) && /target > new Date\(\)/.test(sel), 'the toast names Test Mode or the action, and skips a past target');

  // Calendar checks: an additive, argument-free, read-only status channel.
  const preloadText = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assertMatch(preloadText, /getCalendarFetchStatus: \(\) => ipcRenderer\.invoke\('get-calendar-fetch-status'\),/, 'preload exposes getCalendarFetchStatus with no arguments');
  assertMatch(mainSrc, /ipcMain\.handle\('get-calendar-fetch-status', \(\) => calProviders\.getLastFetchStatus\(\)\);/, 'main answers it argument-free from getLastFetchStatus');
  assertMatch(mainSrc, /calProviders\.fetchAllEvents\(calConfig, new Date\(\), withinDays \|\| 14, \{ recordStatus: true \}\)/, 'only the renderer fetch records a status');
  assert((mainSrc.match(/calProviders\.fetchAllEvents\(calSettings, new Date\((?:Date\.now\(\) - 60000)?\), 1\)/g) || []).length === 2, 'the 1-day background fetches record nothing');
  assertMatch(coreSrc, /getCalendarFetchStatus: async \(\) => \(\{\}\),/, 'the browser preview has a fallback');
  const cpOutsideClassifier = cpSrc.replace(p03FnBody(cpSrc, 'fetchFailureReason'), '').replace(/\/\/[^\n]*/g, '');
  assert(!/err\.message/.test(cpOutsideClassifier) && /console\.error\('ICS feed fetch failed:', reason\);/.test(cpSrc), 'only fetchFailureReason reads err.message; nothing logs or stores it (feed URLs and tokens are secrets)');
  assertMatch(cpSrc, /const FETCH_STATUS_REASON = \/\^\(timeout\|http-\\d\{3\}\|too-large\|not-https\|parse\|unexpected-response\|network\)\$\/;/, 'the reasons are a fixed allowlist');
  for (const prov of ['ical', 'google', 'outlook', 'calendly']) {
    assertMatch(sch, new RegExp(`id="btn-cal-${prov}-fetch" type="button">Check (feed|calendar)</button>\\s*<p class="sch-cal-status" id="sch-cal-status-${prov}" role="status" hidden></p>`), `#btn-cal-${prov}-fetch reads Check and has its status line`);
  }
  assert(!/Fetch Events/.test(htmlSrc), "no 'Fetch Events' buttons are left");
  const check = p03FnBody(calSrc, 'checkCalendarFeeds');
  assert(/btn\.textContent = 'Checking…';/.test(check) && /await calConfigSaving;\s*if \(!\(await fetchAndRenderEvents\(\)\)\) notify\(/.test(check) && /finally \{\s*btn\.disabled = false;\s*btn\.textContent = label;/.test(check), "Check waits for the save, says 'Checking…' and always restores");
  const statusFn = p03FnBody(calSrc, 'renderCalendarFetchStatus');
  assert(/setCalText\(el, line\.text\)/.test(statusFn) && !/innerHTML/.test(statusFn), 'status lines are written as text');
  assert(/return false;/.test(p03FnBody(calSrc, 'fetchAndRenderEvents')) && /return true;/.test(p03FnBody(calSrc, 'fetchAndRenderEvents')), 'fetchAndRenderEvents reports whether the list arrived');
  assertMatch(p03FnBody(calSrc, 'renderCalendarEvents'), /calEmptyCopy\(calConfiguredProviders\(\), calFetchStatus\)/, 'the empty list copy follows the recorded status');
  assertMatch(p03FnBody(calSrc, 'saveCalendarConfig'), /calFetchStatus = \{\};/, 'a changed configuration drops the old status');

  // The keyword note only quotes words main's bedtime rule really matches.
  const kw = (mainSrc.match(/const AUTO_START_KEYWORDS = \[([^\]]+)\];/) || [])[1] || '';
  const keywords = [...kw.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const note = (sch.match(/With Auto-start on, imported events start a countdown when the title includes a bedtime word such as ([^<]+)\.<\/span>/) || [])[1];
  assert(note, 'the calendar note names its bedtime words');
  const quoted = note.split(/, | or /).map(w => w.trim()).filter(Boolean);
  assert(quoted.length === 3 && quoted.every(w => keywords.includes(w)), `every quoted word is in AUTO_START_KEYWORDS (${quoted.join(' / ')})`);
});

// UI-R3 Fire 10: Proof keeps its promise. What actually ran, a ledger that
// separates Real / Test Mode from the outcome, one hero strip, a quiet
// Routine, an honest empty page. Behaviour: test/proof-evidence.test.js and
// test/runReceipts.test.js; inks: test/truth-contrast.test.js.
check('Fire 10 proof', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const receiptSrc = fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8');
  const coreSrc = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const fireAt = css.indexOf('/* -- UI-R3 · Fire 10: Proof');
  const rmAt = css.indexOf('/* -- Reduced motion: one global contract');
  assert(fireAt > 0 && fireAt < rmAt, 'the Fire 10 block sits above the reduced-motion contract');
  const fire = css.slice(fireAt, cssBlockEnd(css, fireAt));
  const fireRules = p03CssRules(fire);
  const rule = sel => fireRules.find(r => r.selector === sel);
  assert(!/infinite/.test(fire) && !/@keyframes/.test(fire) && !fireRules.some(r => /(^|;)\s*animation(-[a-z-]+)?\s*:/.test(r.body)), 'Fire 10 adds no loop, keyframes or animation');
  assert(!fireRules.some(r => /ns-proof-truth|proof-mini|proof-tag|chip-test|receipt-mode-line|routine-streak|ns-proof-badge/.test(r.selector) && /(^|;)\s*(transition|animation|opacity)(-[a-z-]+)?\s*:/.test(r.body)), 'truth marks never transition, animate or fade');
  const transitions = fireRules.filter(r => /(^|;)\s*transition\s*:/.test(r.body));
  assert(transitions.length === 1 && transitions[0].selector === '.proof-copy-btn .proof-copy-swap > *' && /opacity 120ms/.test(transitions[0].body), "the only motion is Copy proof's 120 ms label swap");

  // The ledger: hatched means Test Mode; Interrupted is a solid square.
  assert(/repeating-linear-gradient\(135deg, var\(--accent-amber\)/.test((rule('.receipt-legend li[data-tone="test"]::before') || {}).body || ''), 'the Test legend dot is hatched like its segment');
  assert(/border-radius:\s*0/.test((rule('.receipt-legend li[data-tone="warn"]::before') || {}).body || ''), 'the Interrupted dot is a solid square');
  // The mode line: colours only through data-truth, never inline.
  const stats = p03FnBody(receiptSrc, 'receiptStatsMarkup');
  assert(/<b data-truth="real"/.test(stats) && /<b data-truth="test">/.test(stats) && !/style="color|\.style\.color/.test(stats), 'the mode-line numbers carry data-truth and no inline colour');
  assert(/color:\s*var\(--accent-red\)/.test((rule('.receipt-mode-line b[data-truth="real"]') || {}).body || '') && /color:\s*var\(--text-muted\)/.test((rule('.receipt-mode-line b[data-truth="real"][data-zero]') || {}).body || '') && /color:\s*var\(--accent-amber\)/.test((rule('.receipt-mode-line b[data-truth="test"]') || {}).body || ''), 'real is red only when > 0 (muted at 0); Test Mode is amber');
  assert(/Number\.isFinite/.test(stats), 'mode counts render only from finite numbers');
  assertMatch(coreSrc, /async function openReceiptsLedger\(\) \{[\s\S]*?api\.listReceipts\?\.\(100\)/, 'the ledger lists every stored receipt (100)');
  assertMatch(p03FnBody(receiptSrc, 'confirmClearReceipts'), /api\.listReceipts\?\.\(100\)/, 'the re-render after Delete all lists 100 too');

  // The page: the head meta and the honest empty state.
  const statsPanel = htmlSrc.slice(htmlSrc.indexOf('id="ns-panel-stats"'), htmlSrc.indexOf('id="ns-panel-set"'));
  assertMatch(statsPanel, /<span class="page-meta" id="proof-page-meta" hidden><\/span>/, '#proof-page-meta ships hidden in the Proof page head');
  assertMatch(statsPanel, /<div class="proof-empty" id="proof-empty" hidden>/, '#proof-empty ships hidden');
  assert(statsPanel.indexOf('id="proof-empty"') < statsPanel.indexOf('id="stats-session-summary"'), 'the empty state sits above the history');
  assertMatch(statsPanel, /class="btn-secondary proof-empty-cta" id="btn-proof-empty-plan">Plan tonight<\/button>/, "'Plan tonight' is a secondary pill");
  assert(rule('.proof-empty[hidden]') && rule('.page-meta[hidden]'), 'the hidden attribute wins over the display rules');
  const planAt = coreSrc.indexOf("getElementById('btn-proof-empty-plan')");
  assert(planAt > 0, "the 'Plan tonight' handler is wired");
  const plan = coreSrc.slice(planAt, coreSrc.indexOf('});', coreSrc.indexOf('});', planAt) + 3) + 3);
  assert(/handleSidebarNavigation\('lib'\)/.test(plan) && /ns-play-btn'\)\?\.focus\(\)/.test(plan), "'Plan tonight' opens Tonight and focuses Start");
  assert(!/startTonightPlan|startTimer/.test(plan), "'Plan tonight' never starts anything");
  const load = p03FnBody(receiptSrc, 'loadMorningProof');
  assert(/emptyEl\.hidden = receipt !== null;/.test(load) && /catch \(e\) \{\s*if \(emptyEl\) emptyEl\.hidden = true;/.test(load), 'the empty state shows only for a null receipt, never on a failed read');

  // The hero strip, Open receipt, Copy proof.
  const hero = p03FnBody(receiptSrc, 'renderMorningProof');
  assert(!/ns-pill-pauses|ns-pill-snoozes|ns-pill-runs|ns-proof-timestamp/.test(hero), 'the removed pills have no writers left');
  assert(/grid-auto-flow:\s*column/.test((rule('#proof-card .ns-proof-pills') || {}).body || '') && /grid-auto-columns:\s*minmax\(0, 1fr\)/.test((rule('#proof-card .ns-proof-pills') || {}).body || ''), 'the strip flows only the shown cells');
  assert(/display:\s*none/.test((rule('#proof-card:not([data-tone="running"]):not([data-tone="bad"]) .ns-proof-badge') || {}).body || ''), 'the result badge shows only while running or bad');
  assert(!fireRules.some(r => /ns-proof-truth/.test(r.selector) && /display:\s*none/.test(r.body)), '#ns-proof-truth is never hidden');
  assertMatch(coreSrc, /if \(els\.btnProofDetails\) \{\s*els\.btnProofDetails\.addEventListener\('click', async \(\) => \{\s*const id = els\.btnProofDetails\.dataset\.receiptId \|\| '';\s*if \(await openReceiptsLedger\(\) === true && id\) focusLedgerReceipt\(id\);/, "'Open receipt' opens the ledger on its row");
  assertMatch(htmlSrc, /id="btn-proof-details">Open receipt<\/button>/, "#btn-proof-details reads 'Open receipt'");
  assertMatch(htmlSrc, /<span class="sr-only" id="proof-copy-status" role="status" aria-live="polite"><\/span>/, 'Copy proof announces through a polite live region');
  assert(/clearTimeout\(proofCopiedTimer\)/.test(p03FnBody(coreSrc, 'showProofCopied')) && /, 1600\);/.test(p03FnBody(coreSrc, 'showProofCopied')), "'Copied' lasts 1600 ms and a re-click restarts it");

  // Routine: quiet until real, one merged note, no source li.
  assert(!htmlSrc.includes('routine-src') && !p03CssRules(css).some(r => /routine-src/.test(r.selector)), 'the legend source item and its CSS are gone');
  assertMatch(htmlSrc, /<p class="proof-routine-note">From local receipts on this PC\. Streaks count completed real runs only, not measured sleep\.<\/p>/, 'one merged Routine note');
  assert(/color:\s*var\(--text-muted\)/.test((rule('.routine-streak') || {}).body || '') && /color:\s*var\(--pf-teal\)/.test((rule('.routine-streak[data-state="live"]') || {}).body || ''), 'the streak line is muted until live (teal)');
  assertMatch(htmlSrc, /<span class="routine-cell-val streak-number" id="streak-count">0<\/span>/, '#streak-count keeps .streak-number');
  assertMatch(htmlSrc, /<span class="routine-cell-note" id="score-label">Routine Consistency Score<\/span>/, '#score-label keeps its honest initial text');
  assert(/>Before 11 PM · last 7 nights</.test(htmlSrc) && /Avg lights-out/.test(htmlSrc), 'the on-time threshold is stated; Avg lights-out is the one name');
  assertMatch(p03FnBody(coreSrc, 'renderStreaks'), /part\(bd\.ritual, 'Ritual'\)/, "the score's fourth part keeps the honest name 'Ritual'");
});

// Cleanup.
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

Promise.all(asyncChecks).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
