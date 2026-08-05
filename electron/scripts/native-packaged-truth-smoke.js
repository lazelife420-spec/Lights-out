'use strict';

// Native Windows packaging truth smoke.
// Validates dist-native/win-unpacked/Lights Out.exe branding and clean launch/exit.

const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distNative = path.join(root, '..', 'dist-native', 'win-unpacked');
const executable = path.join(distNative, 'Lights Out.exe');
const expected = {
  CompanyName: 'The Proof Foundry',
  FileDescription: 'Lights Out',
  FileVersion: '11.1.2.0',
  InternalName: 'Lights Out',
  OriginalFilename: 'Lights Out.exe',
  ProductName: 'Lights Out',
  ProductVersion: '11.1.2',
  LegalCopyright: 'Copyright (C) 2026 The Proof Foundry. All rights reserved.'
};

function runPowerShell(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true
  });
}

function getVersionInfo(exePath) {
  const out = runPowerShell(`$vi = (Get-ItemProperty -Path '${exePath}').VersionInfo; [PSCustomObject]@{ CompanyName = $vi.CompanyName; FileDescription = $vi.FileDescription; FileVersion = $vi.FileVersion; InternalName = $vi.InternalName; OriginalFilename = $vi.OriginalFilename; ProductName = $vi.ProductName; ProductVersion = $vi.ProductVersion; LegalCopyright = $vi.LegalCopyright } | ConvertTo-Json`);
  return JSON.parse(out.trim());
}

function lightsOutProcessCount() {
  try {
    const out = runPowerShell('(Get-Process "Lights Out" -ErrorAction SilentlyContinue).Count');
    return Number.parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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

console.log('Starting Native Packaged Truth Smoke Test...\n');

check('native: dist-native/win-unpacked/Lights Out.exe exists', () => {
  assert(fs.existsSync(executable), `Executable missing: ${executable}`);
  const resolved = fs.realpathSync(executable);
  assert(resolved === executable, `Packaged executable resolved unexpectedly: ${resolved}`);
  assert(path.basename(resolved).toLowerCase() === 'lights out.exe', `Unexpected executable name: ${resolved}`);
  assert(!resolved.toLowerCase().includes(`${path.sep}node_modules${path.sep}electron${path.sep}`), 'Source Electron runtime was substituted');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  assert(/^[a-f0-9]{64}$/.test(digest), 'Packaged executable hash was not produced');
  console.log(`    packaged executable SHA-256: ${digest}`);
});

check('native: executable is reasonably sized', () => {
  const stats = fs.statSync(executable);
  assert(stats.size >= 40 * 1024 * 1024, `Executable too small (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
});

let versionInfo;
check('native: executable metadata is branded', () => {
  versionInfo = getVersionInfo(executable);
  for (const [key, value] of Object.entries(expected)) {
    assert(versionInfo[key] === value, `${key} expected "${value}", got "${versionInfo[key]}"`);
  }
});

check('native: app launches and exits cleanly via supported test Quit path', () => {
  assert(lightsOutProcessCount() === 0, 'packaged truth smoke requires a clean Lights Out process state');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-native-truth-'));
  try {
    const child = spawn(executable, [
      '--minimized',
      '--no-auto-start',
      '--test-quit-after-start=2000',
      `--user-data-dir=${userData}`
    ], {
      cwd: distNative,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_IS_DEV: '0', LIGHTS_OUT_SUPPRESS_TRAY: '1' }
    });
    assert(child.pid, 'Failed to get PID for launched process');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && lightsOutProcessCount() === 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    assert(lightsOutProcessCount() > 0, 'packaged application did not start');
    const exitDeadline = Date.now() + 15000;
    while (Date.now() < exitDeadline && lightsOutProcessCount() > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
    assert(lightsOutProcessCount() === 0, 'packaged application did not exit cleanly');
  } finally {
    try { spawn('taskkill', ['/F', '/T', '/IM', 'Lights Out.exe'], { windowsHide: true }); } catch {}
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

check('native: no orphan Lights Out processes remain', () => {
  assert(lightsOutProcessCount() === 0, `orphan Lights Out processes remained`);
});

console.log(`\nNative Packaged Truth Smoke Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
