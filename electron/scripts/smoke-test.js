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

// 7. Core UI controls exist (start/pause/resume/snooze/cancel/mini + customize).
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['btn-start', 'btn-stop', 'btn-pause', 'btn-snooze', 'btn-mini', 'cz-accent', 'cz-theme', 'cz-ring', 'cz-opacity', 'cz-volume', 'chk-lastlight', 'sel-lastlight-sequence', 'warning-modal', 'last-light-overlay', 'morning-proof-section', 'proof-card', 'receipts-modal']) {
  check(`ui: #${id} present`, () => {
    assert(htmlSrc.includes(`id="${id}"`), `missing #${id}`);
  });
}

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

// Cleanup.
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
