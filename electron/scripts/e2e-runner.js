#!/usr/bin/env node
// Consolidated Lights Out E2E runner.
// Runs the proven real-Electron/packaged harnesses sequentially and reports
// which lanes passed. Dry-run safety is preserved; no real power actions.

'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { requirePackagedArtifact } = require('./packaged-artifact-resolver');

const ELECTRON_ROOT = path.resolve(__dirname, '..');
const IS_CI_MODE = process.argv.includes('--ci');

function runLane(script, args, label, required) {
  const kind = required ? 'required' : 'advisory';
  console.log(`\n==> E2E lane (${kind}): ${label}`);
  const result = spawnSync(process.execPath, [path.join('scripts', script), ...args], {
    cwd: ELECTRON_ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_IS_DEV: '0',
      LIGHTS_OUT_SUPPRESS_TRAY: '1'
    }
  });
  const exit = result.status ?? (result.error ? 1 : 0);
  if (exit !== 0) {
    if (exit === 2) {
      console.log(`\n<== E2E lane INTERACTIVE_DESKTOP_REQUIRED: ${label} (exit ${exit})`);
      return { ok: false, exit, environmentUnsupported: true };
    }
    if (required) {
      console.log(`\n<== E2E lane FAILED: ${label} (exit ${exit})`);
      return { ok: false, exit };
    }
    console.log(`\n<== E2E lane ADVISORY FAILURE (non-blocking): ${label} (exit ${exit})`);
    return { ok: false, exit, advisory: true };
  }
  console.log(`\n<== E2E lane PASSED: ${label}`);
  return { ok: true, exit };
}

function main() {
  try {
    requirePackagedArtifact();
  } catch (error) {
    console.error(error.message);
    console.error('Run `npm run build` first, or set LIGHTS_OUT_PACKAGED_EXE.');
    process.exit(1);
  }

  const results = {};

  if (IS_CI_MODE) {
    console.log('\n========================================');
    console.log('Running Unattended-Safe E2E Suite (--ci)');
    console.log('========================================');
    console.log('Note: Native desktop input gate requires unlocked interactive Windows desktop.');
    console.log('      Run `npm run test:e2e:desktop` in interactive desktop session for full release qualification.');
    
    results.desktopUx = { ok: false, exit: 2, environmentUnsupported: true, skippedForCi: true };
  } else {
    results.desktopUx = runLane(
      'desktop-ux-functional-gate.js',
      ['--desktop-ux-proof'],
      'desktop-ux-functional-gate',
      true
    );
  }

  results.packagedTruth = runLane(
    'packaged-truth-smoke.js',
    [],
    'packaged-truth-smoke',
    true
  );

  // The night-modes proof is intentionally run as an advisory lane because its
  // Quick Sleep wall-clock completion assertion has a known timing limitation
  // (the harness cannot accelerate the real system clock, only the tick loop).
  results.nightModes = runLane(
    'night-modes-electron-proof.js',
    [],
    'night-modes-electron-proof',
    false
  );

  console.log('\n========================================');
  console.log('Lights Out E2E Summary');
  console.log('========================================');
  if (results.desktopUx.skippedForCi) {
    console.log('desktop-ux-functional-gate: INTERACTIVE_DESKTOP_REQUIRED (skipped in --ci mode)');
  } else if (results.desktopUx.environmentUnsupported) {
    console.log('desktop-ux-functional-gate: INTERACTIVE_DESKTOP_REQUIRED (requires interactive desktop session)');
  } else {
    console.log(`desktop-ux-functional-gate: ${results.desktopUx.ok ? 'PASS' : 'FAIL'}`);
  }
  console.log(`packaged-truth-smoke:        ${results.packagedTruth.ok ? 'PASS' : 'FAIL'}`);
  console.log(`night-modes-electron-proof:  ${results.nightModes.ok ? 'PASS' : 'FAIL (advisory)'}`);
  console.log('Real power actions: 0 (enforced by dry-run in harnesses)');
  console.log('========================================');

  if (IS_CI_MODE) {
    if (!results.packagedTruth.ok) {
      process.exit(1);
    }
    console.log('\nUnattended CI E2E PASSED (packaged-truth-smoke). Full release qualification requires `npm run test:e2e:desktop`.');
    return;
  }

  if (!results.packagedTruth.ok || (!results.desktopUx.ok && !results.desktopUx.environmentUnsupported)) {
    process.exit(1);
  }

  if (results.desktopUx.environmentUnsupported) {
    console.log('\nNotice: Unsupported execution environment for desktop-ux-functional-gate.');
    console.log('To run interactive desktop E2E, use `npm run test:e2e:desktop` from an unlocked Windows desktop.');
    process.exit(2);
  }
}

main();
