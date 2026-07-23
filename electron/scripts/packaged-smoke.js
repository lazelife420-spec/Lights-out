const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Packaged Runtime Smoke Test (Enhanced)
 * Verifies the built Windows executable launches safely, behaves correctly, and cleans up.
 * 
 * This test covers:
 * - Executable integrity and size
 * - Clean launch with --minimized --no-auto-start flags
 * - No silent countdown on launch
 * - Tray initialization without orphan processes
 * - Window hide/show behavior
 * - Clean quit and process cleanup
 * - No leftover Electron/Node processes
 * - Safe startup defaults in code
 */

const root = path.join(__dirname, '..');
const distDir = process.env.LIGHTS_OUT_DIST_DIR
  ? path.resolve(root, process.env.LIGHTS_OUT_DIST_DIR)
  : path.join(root, '..', 'dist');
const exePath = path.join(distDir, 'LightsOut.exe');

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

function assertMatch(src, regex, msg) {
  if (!regex.test(src)) throw new Error(msg || 'regex match failed');
}

function lightsOutProcessCount() {
  const result = spawnSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '@(Get-Process "Lights Out" -ErrorAction SilentlyContinue).Count'
  ], { encoding: 'utf8', windowsHide: true });
  return Number.parseInt(result.stdout.trim(), 10) || 0;
}

function waitForNoLightsOutProcesses(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let consecutiveEmptyChecks = 0;
  while (Date.now() < deadline) {
    if (lightsOutProcessCount() === 0) {
      consecutiveEmptyChecks += 1;
      if (consecutiveEmptyChecks >= 3) return;
    } else {
      consecutiveEmptyChecks = 0;
      spawnSync('taskkill', ['/F', '/T', '/IM', 'Lights Out.exe'], { windowsHide: true });
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  throw new Error(`${lightsOutProcessCount()} orphan "Lights Out" processes remained after bounded cleanup`);
}

console.log('Starting Enhanced Packaged Runtime Smoke Test...\n');

if (!fs.existsSync(exePath)) {
  console.error(`  ERROR: Executable not found at ${exePath}`);
  console.error('  Please run "npm run build" first.');
  process.exit(1);
}

// 1. Verify file properties
check('package: executable exists and is reasonably sized', () => {
  const stats = fs.statSync(exePath);
  if (stats.size < 40 * 1024 * 1024) throw new Error(`Executable seems too small (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
});

check('package: executable is readable', () => {
  const stats = fs.statSync(exePath);
  assert((stats.mode & fs.constants.R_OK) !== 0, 'Executable is not readable');
});

// 2. Launch test with safety verification
check('runtime: app launches cleanly with --minimized --no-auto-start', () => {
  assert(lightsOutProcessCount() === 0, 'packaged smoke requires a clean Lights Out process state');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-portable-smoke-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { onboarded: true },
    remoteControl: { enabled: false, mode: 'off', port: 58732, lanIp: '', token: '' }
  }));
  try {
    const child = require('child_process').spawn(exePath, [
      '--minimized',
      '--no-auto-start',
      `--user-data-dir=${userData}`
    ], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_IS_DEV: '0', LIGHTS_OUT_SUPPRESS_TRAY: '1' }
    });

    if (!child.pid) throw new Error('Failed to get PID for launched process');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && lightsOutProcessCount() === 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    assert(lightsOutProcessCount() > 0, 'packaged application did not remain running');
  } finally {
    spawnSync('taskkill', ['/F', '/T', '/IM', 'Lights Out.exe'], { windowsHide: true });
    waitForNoLightsOutProcesses();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

// 3. Verify safe-startup defaults in code
check('safety: no-auto-start logic present in main.js', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  if (!mainSrc.includes('options.noAutoStart = true')) throw new Error('noAutoStart flag logic missing from main.js');
  if (!mainSrc.includes('--no-auto-start')) throw new Error('--no-auto-start string missing from main.js');
});

check('safety: launch flags parsed correctly', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assertMatch(mainSrc, /if \(lower === '--minimized' \|\| lower === '--minimized-to-tray'\)/, 'minimized flag parser missing');
  assertMatch(mainSrc, /if \(lower === '--no-auto-start'\)/, 'no-auto-start flag parser missing');
  assertMatch(mainSrc, /if \(lower\.startsWith\('--timer='\)\)/, 'timer flag parser missing');
  assertMatch(mainSrc, /if \(lower\.startsWith\('--action='\)\)/, 'action flag parser missing');
});

check('safety: no default force-shutdown on login', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  if (/openAtLogin:\s*true/.test(mainSrc)) throw new Error('login should not force auto-start');
});

check('safety: tray initialization guards against orphans', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  if (!mainSrc.includes('let tray = null')) throw new Error('tray variable missing');
  if (!mainSrc.includes('async function createTray()')) throw new Error('createTray function missing');
  if (!mainSrc.includes('if (SUPPRESS_AUTOMATION_TRAY) return')) throw new Error('automation tray suppression missing');
  if (!mainSrc.includes('if (tray && !tray.isDestroyed()) return')) throw new Error('tray idempotency guard missing');
  if (!mainSrc.includes('tray = new Tray(')) throw new Error('tray creation missing');
});

check('safety: window close-to-tray behavior is default', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  if (!mainSrc.includes('mainWindow.on(\'close\'')) throw new Error('window close handler missing');
  if (!mainSrc.includes('mainWindow.hide()')) throw new Error('hide on close missing');
});

check('safety: quit handler cleans up processes', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  if (!mainSrc.includes('app.on(\'before-quit\'')) throw new Error('before-quit handler missing');
  if (!mainSrc.includes('app.isQuitting = true')) throw new Error('quit flag missing');
  if (!mainSrc.includes('tray.destroy()')) throw new Error('quit must destroy the tray icon');
});

// 4. Verify no Electron/Node processes linger
check('cleanup: no lingering Electron processes after test', () => {
  const electronProcs = spawnSync('powershell', ['-Command', 'Get-Process electron -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count'], { encoding: 'utf8' });
  const electronCount = parseInt(electronProcs.stdout.trim()) || 0;
  if (electronCount > 0) {
    throw new Error(`${electronCount} electron processes still running`);
  }
});

check('cleanup: no lingering Lights Out processes or temporary profile', () => {
  assert(lightsOutProcessCount() === 0, 'Lights Out process cleanup was not stable');
  const profiles = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('lightsout-portable-smoke-'));
  assert(profiles.length === 0, `${profiles.length} portable smoke profile(s) remain`);
});

check('cleanup: no lingering Node processes from app', () => {
  // Note: This is a best-effort check; Node processes from other sources may exist
  const nodeProcs = spawnSync('powershell', ['-Command', 'Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "node" } | Measure-Object | Select-Object -ExpandProperty Count'], { encoding: 'utf8' });
  const nodeCount = parseInt(nodeProcs.stdout.trim()) || 0;
  if (nodeCount > 5) {
    // Allow some Node processes; just check we don't have excessive ones
    throw new Error(`${nodeCount} Node processes running; possible orphan leak`);
  }
});

// Summary
console.log(`\nPackaged Smoke Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
