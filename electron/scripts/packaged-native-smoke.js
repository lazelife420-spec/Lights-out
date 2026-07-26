'use strict';

// Packaged runtime smoke test for the native Windows build.
// Validates dist-native/win-unpacked/Lights Out.exe launches safely and cleans up.

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = process.env.LIGHTS_OUT_DIST_DIR
  ? path.resolve(root, process.env.LIGHTS_OUT_DIST_DIR)
  : path.join(root, '..', 'dist-native', 'win-unpacked');
const exePath = path.join(distDir, 'Lights Out.exe');

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

console.log('Starting Native Packaged Runtime Smoke Test...\n');

if (!fs.existsSync(exePath)) {
  console.error(`  ERROR: Executable not found at ${exePath}`);
  console.error('  Please run "npm run build" first.');
  process.exit(1);
}

check('package: executable exists and is reasonably sized', () => {
  const stats = fs.statSync(exePath);
  if (stats.size < 40 * 1024 * 1024) throw new Error(`Executable seems too small (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
});

check('package: executable is readable', () => {
  const stats = fs.statSync(exePath);
  assert((stats.mode & fs.constants.R_OK) !== 0, 'Executable is not readable');
});

check('runtime: app launches cleanly with --minimized --no-auto-start', () => {
  assert(lightsOutProcessCount() === 0, 'packaged smoke requires a clean Lights Out process state');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-native-smoke-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { onboarded: true },
    remoteControl: { enabled: false, mode: 'off', port: 58732, lanIp: '', token: '' }
  }));
  try {
    const child = spawn(exePath, [
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

check('cleanup: no lingering Lights Out processes or temporary profile', () => {
  assert(lightsOutProcessCount() === 0, 'Lights Out process cleanup was not stable');
  const profiles = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('lightsout-native-smoke-'));
  assert(profiles.length === 0, `${profiles.length} native smoke profile(s) remain`);
});

console.log(`\nNative Packaged Smoke Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
