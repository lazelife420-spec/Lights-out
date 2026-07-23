#!/usr/bin/env node
'use strict';

// Real Electron Runtime Proof — Orphaned Receipt Reconciliation
//
// A run receipt can be left at result:'running' forever if the process that
// started it ends (crash, force-kill, power loss) before a terminal update
// ever lands. This proves the startup reconciliation pass finalizes those as
// 'interrupted' -- without touching a receipt still protected by a live,
// recoverable persisted timer snapshot -- and that resume/discard reuse or
// honestly finalize the original receipt rather than leaving a duplicate or
// a permanent false "Running" entry.

const fs = require('fs');
const os = require('os');
const path = require('path');

const electronRoot = path.resolve(__dirname, '..');

function runChildScenario(scenario) {
  const { spawn } = require('child_process');
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), `lightsout-receipt-recovery-proof-${scenario}-`));
  const electronBin = require(path.join(electronRoot, 'node_modules', 'electron'));
  return new Promise(resolve => {
    const child = spawn(electronBin, [__filename], {
      cwd: electronRoot,
      env: {
        ...process.env,
        LIGHTSOUT_RECEIPT_PROOF_CHILD: '1',
        LIGHTSOUT_RECEIPT_PROOF_SCENARIO: scenario,
        LIGHTSOUT_RECEIPT_PROOF_USERDATA: isolatedDir,
        LIGHTS_OUT_SUPPRESS_TRAY: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ELECTRON_NO_ATTACH_CONSOLE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => {
      const output = data.toString();
      if (!/\[(GPU|ERROR:.*(vulkan|ANGLE|viz|crashpad))/.test(output)) process.stderr.write(output);
    });

    const timeout = setTimeout(() => {
      console.error(`\nTimeout: Receipt recovery proof (${scenario}) did not complete in 60s`);
      child.kill();
    }, 60000);

    child.on('close', code => {
      clearTimeout(timeout);
      try { fs.rmSync(isolatedDir, { recursive: true, force: true }); } catch { /* best effort */ }
      resolve(code ?? 1);
    });
  });
}

async function runParent() {
  console.log('\nReal Electron Runtime Proof — Orphaned Receipt Reconciliation');
  console.log('Real power actions: DISABLED\n');

  console.log('--- scenario: main (orphan/protected/terminal, resume, discard, new-start, viewer) ---');
  const mainCode = await runChildScenario('main');

  console.log('\n--- scenario: legacy-startup (pre-upgrade receiptId-less snapshot protected at real app.whenReady()) ---');
  const legacyCode = await runChildScenario('legacy-startup');

  process.exit(mainCode === 0 && legacyCode === 0 ? 0 : 1);
}

async function runElectronProof() {
  const { app } = require('electron');

  const userData = process.env.LIGHTSOUT_RECEIPT_PROOF_USERDATA;
  app.setPath('userData', userData);
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  app.setAppPath(electronRoot);
  process.argv.push('--minimized', '--no-auto-start');
  process.chdir(electronRoot);

  const scenario = process.env.LIGHTSOUT_RECEIPT_PROOF_SCENARIO || 'main';
  const now = Date.now();
  const orphanId = 'r_test_orphan_1';
  const protectedId = 'r_test_protected_1';
  const terminalId = 'r_test_terminal_1';
  const legacyReceiptId = 'r_test_legacy_1';

  const baseSettings = {
    app: { dryRun: true, forceShutdown: false, onboarded: true },
    remoteControl: { enabled: false, mode: 'off' },
    lastLight: { enabled: false },
    ritual: { enabled: true }
  };

  if (scenario === 'main') {
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
      ...baseSettings,
      // A still-valid, still-recoverable persisted timer snapshot, correlated
      // by receiptId to protectedId -- this one must survive startup
      // reconciliation untouched, pending the user's Resume/Dismiss choice.
      activeTimer: {
        action: 'sleep',
        dryRun: true,
        forceShutdown: false,
        muteSystem: false,
        gracePeriod: 2,
        totalSeconds: 900,
        remainingSeconds: 900,
        paused: false,
        endsAt: new Date(now + 15 * 60 * 1000).toISOString(),
        savedAt: new Date(now - 5000).toISOString(),
        receiptId: protectedId
      }
    }, null, 2));

    fs.writeFileSync(path.join(userData, 'run-receipts.json'), JSON.stringify({
      receipts: [
        {
          id: orphanId, version: 1,
          startedAt: new Date(now - 3600000).toISOString(), endedAt: null,
          action: 'shutdown', profileId: 'mqyy8ffe0wr3amg', profileName: 'Work Focus',
          nightModeId: null, nightModeTitle: null, nightModeVersion: null,
          durationSeconds: 734669, remainingSeconds: null,
          dryRun: false, forceShutdown: false, gracefulClose: true,
          result: 'running', pauseCount: 0, snoozeCount: 0, cancelReason: null,
          warningsShown: 0, lastLightSequence: null, powerCommand: null, notes: null
        },
        {
          id: protectedId, version: 1,
          startedAt: new Date(now - 5000).toISOString(), endedAt: null,
          action: 'sleep', profileId: null, profileName: null,
          nightModeId: 'quick-sleep', nightModeTitle: 'Quick Sleep', nightModeVersion: 1,
          durationSeconds: 900, remainingSeconds: null,
          dryRun: true, forceShutdown: false, gracefulClose: true,
          result: 'running', pauseCount: 0, snoozeCount: 0, cancelReason: null,
          warningsShown: 0, lastLightSequence: null, powerCommand: null, notes: null
        },
        {
          id: terminalId, version: 1,
          startedAt: new Date(now - 7200000).toISOString(), endedAt: new Date(now - 7100000).toISOString(),
          action: 'shutdown', profileId: null, profileName: null,
          nightModeId: null, nightModeTitle: null, nightModeVersion: null,
          durationSeconds: 1800, remainingSeconds: 0,
          dryRun: false, forceShutdown: false, gracefulClose: true,
          result: 'cancelled', pauseCount: 0, snoozeCount: 0, cancelReason: null,
          warningsShown: 0, lastLightSequence: null, powerCommand: null, notes: null
        }
      ]
    }, null, 2));
  } else if (scenario === 'legacy-startup') {
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
      ...baseSettings,
      // Shape saved by a build that predates the receiptId field -- no
      // receiptId key at all. Real app.whenReady() must still protect the
      // matching receipt via the getMostRecentRunningReceiptId() fallback.
      activeTimer: {
        action: 'shutdown',
        dryRun: false,
        forceShutdown: false,
        muteSystem: false,
        gracePeriod: 2,
        totalSeconds: 1800,
        remainingSeconds: 1800,
        paused: false,
        endsAt: new Date(now + 30 * 60 * 1000).toISOString(),
        savedAt: new Date(now - 5000).toISOString()
      }
    }, null, 2));

    fs.writeFileSync(path.join(userData, 'run-receipts.json'), JSON.stringify({
      receipts: [
        {
          id: legacyReceiptId, version: 1,
          startedAt: new Date(now - 5000).toISOString(), endedAt: null,
          action: 'shutdown', profileId: null, profileName: null,
          nightModeId: null, nightModeTitle: null, nightModeVersion: null,
          durationSeconds: 1800, remainingSeconds: null,
          dryRun: false, forceShutdown: false, gracefulClose: true,
          result: 'running', pauseCount: 0, snoozeCount: 0, cancelReason: null,
          warningsShown: 0, lastLightSequence: null, powerCommand: null, notes: null
        }
      ]
    }, null, 2));
  }

  let mainWindow = null;
  const mainReady = new Promise(resolve => {
    app.on('browser-window-created', (_event, win) => {
      if (mainWindow) return;
      mainWindow = win;
      win.webContents.once('did-finish-load', () => setTimeout(() => resolve(win), 500));
    });
  });

  require(path.join(electronRoot, 'main.js'));
  const desktop = await mainReady;
  const receipts = require(path.join(electronRoot, 'runReceipts.js'));
  const settingsStore = require(path.join(electronRoot, 'settings.js'));

  let passed = 0;
  let failed = 0;
  async function check(label, fn) {
    try {
      await fn();
      console.log(`  PASS  ${label}`);
      passed++;
    } catch (error) {
      console.log(`  FAIL  ${label} -> ${error.message || error}`);
      failed++;
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion failed');
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(fn, message, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const value = await fn();
        if (value) return value;
      } catch (error) { lastError = error; }
      await wait(50);
    }
    throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
  }
  const desktopEval = code => desktop.webContents.executeJavaScript(code);

  await waitFor(() => desktopEval("typeof electronAPI === 'object'"), 'renderer did not initialize electronAPI');
  await wait(300); // let app.whenReady()'s reconciliation pass settle

  if (scenario === 'main') {
  await check('startup reconciliation finalizes the orphaned receipt as interrupted', () => {
    const r = receipts.getReceiptById(orphanId);
    assert(r && r.result === 'interrupted', JSON.stringify(r));
    assert(r.endedAt, 'orphan receipt missing endedAt');
    assert(r.reconciliationReason === 'orphaned-running-receipt', r.reconciliationReason);
    assert(r.reconciledAt, 'orphan receipt missing reconciledAt');
  });

  await check('orphaned receipt keeps original evidence (id, start time, profile, action, dryRun)', () => {
    const r = receipts.getReceiptById(orphanId);
    assert(r.id === orphanId, 'receipt id changed');
    assert(r.profileName === 'Work Focus', 'profile name lost');
    assert(r.action === 'shutdown', 'action lost');
    assert(r.dryRun === false, 'dryRun value lost');
  });

  await check('protected receipt (matching persisted active timer) is left running', () => {
    const r = receipts.getReceiptById(protectedId);
    assert(r && r.result === 'running', JSON.stringify(r));
  });

  await check('already-terminal receipt is untouched by reconciliation', () => {
    const r = receipts.getReceiptById(terminalId);
    assert(r && r.result === 'cancelled', JSON.stringify(r));
    assert(r.endedAt === new Date(now - 7100000).toISOString(), 'terminal receipt endedAt was rewritten');
  });

  await check('second reconciliation pass at this same runtime is a no-op', () => {
    const before = receipts.getReceiptById(orphanId).reconciledAt;
    const reconciled = receipts.reconcileOrphanedRunningReceipts(protectedId);
    assert(reconciled.length === 0, `second pass touched receipts: ${JSON.stringify(reconciled)}`);
    assert(receipts.getReceiptById(orphanId).reconciledAt === before, 'reconciledAt was rewritten on a second pass');
  });

  await check('recoverable timer snapshot exposed via get-app-settings still points at the protected receipt', async () => {
    const settings = await desktopEval('window.electronAPI.getAppSettings()');
    assert(settings.recoverableTimer && settings.recoverableTimer.receiptId === protectedId, JSON.stringify(settings.recoverableTimer));
    assert(settings.recoverableTimer.remainingSeconds > 0, 'recoverable timer should still have time left');
  });

  await check('resuming the recoverable timer reuses the original receipt, no duplicate', async () => {
    const beforeCount = receipts.getAllReceiptsForExport().length;
    const result = await desktopEval('window.electronAPI.resumeRecoverableTimer()');
    assert(result && result.success !== false, JSON.stringify(result));
    await waitFor(() => desktopEval('state.running === true'), 'resumed timer did not start');
    const afterCount = receipts.getAllReceiptsForExport().length;
    assert(afterCount === beforeCount, `receipt count changed on resume: ${beforeCount} -> ${afterCount}`);
    assert(receipts.getReceiptById(protectedId).result === 'running', 'reused receipt should still be running while the resumed timer is active');
    const liveAction = await desktopEval('state.action');
    assert(liveAction === 'sleep', `live timer does not reflect the resumed run's action: ${liveAction}`);
  });

  await desktopEval('window.electronAPI.cancelTimer()');
  await waitFor(() => desktopEval('!state.running && !state.paused'), 'desktop did not return to idle after resumed run');

  await check('pre-upgrade snapshot with no receiptId falls back to most-recent-running and resumes without a duplicate', async () => {
    // Simulates upgrading mid-crash-recovery: an activeTimer snapshot saved
    // by a build that predates the receiptId field. persistActiveTimer()
    // always writes receiptId now, so this shape can only exist from a
    // pre-upgrade save -- the fallback correlation must still protect it.
    const legacyReceipt = receipts.createRunReceipt({ action: 'shutdown', dryRun: false, totalSeconds: 600 });
    settingsStore.setActiveTimer({
      action: 'shutdown', dryRun: false, forceShutdown: false, muteSystem: false, gracePeriod: 2,
      totalSeconds: 600, remainingSeconds: 600, paused: false,
      endsAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      savedAt: new Date().toISOString()
      // no receiptId -- matches a pre-upgrade snapshot shape
    });
    assert(receipts.getMostRecentRunningReceiptId() === legacyReceipt.id, 'fallback did not identify the legacy receipt as most-recent-running');

    const beforeCount = receipts.getAllReceiptsForExport().length;
    const result = await desktopEval('window.electronAPI.resumeRecoverableTimer()');
    assert(result && result.success !== false, JSON.stringify(result));
    await waitFor(() => desktopEval('state.running === true'), 'legacy-snapshot resume did not start');
    const afterCount = receipts.getAllReceiptsForExport().length;
    assert(afterCount === beforeCount, `receipt count changed resuming a pre-upgrade snapshot: ${beforeCount} -> ${afterCount}`);
    assert(receipts.getReceiptById(legacyReceipt.id).result === 'running', 'legacy receipt should have been reused, not orphaned then duplicated');

    await desktopEval('window.electronAPI.cancelTimer()');
    await waitFor(() => desktopEval('!state.running && !state.paused'), 'desktop did not return to idle after legacy-snapshot resume');
  });

  await check('discarding a recoverable timer finalizes its receipt honestly as interrupted', async () => {
    // Seed a second, independent orphan scenario at runtime (this Electron
    // process is already past its one-time startup reconciliation, so this
    // exercises discard-recoverable-timer directly rather than re-triggering
    // app.whenReady()).
    const discardReceipt = receipts.createRunReceipt({ action: 'sleep', dryRun: true, totalSeconds: 300 });
    settingsStore.setActiveTimer({
      action: 'sleep', dryRun: true, forceShutdown: false, muteSystem: false, gracePeriod: 2,
      totalSeconds: 300, remainingSeconds: 300, paused: false,
      endsAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      savedAt: new Date().toISOString(), receiptId: discardReceipt.id
    });
    const result = await desktopEval('window.electronAPI.discardRecoverableTimer()');
    assert(result && result.success === true, JSON.stringify(result));
    const after = receipts.getReceiptById(discardReceipt.id);
    assert(after.result === 'interrupted', JSON.stringify(after));
    assert(after.reconciliationReason === 'discarded-by-user', after.reconciliationReason);
    assert(settingsStore.getActiveTimer() === null, 'activeTimer snapshot should be cleared after discard');
  });

  await check('a historical interrupted receipt does not block a brand-new timer start', async () => {
    const result = await desktopEval("window.electronAPI.startTimer({ durationSeconds: 60, action: 'sleep', dryRun: true })");
    assert(result && result.success !== false, JSON.stringify(result));
    await waitFor(() => desktopEval('state.running === true'), 'new timer did not start after historical interruptions');
    await desktopEval('window.electronAPI.cancelTimer()');
    await waitFor(() => desktopEval('!state.running && !state.paused'), 'desktop did not return to idle');
  });

  await check('receipt viewer displays "Interrupted", never "Running", for the orphaned receipt', async () => {
    await desktopEval('openReceiptsLedger()');
    await wait(200);
    const listText = await desktopEval("document.getElementById('receipts-list').textContent");
    assert(listText.includes('Interrupted'), 'receipts list does not show Interrupted');
    const label = await desktopEval("humanizeReceiptResult('interrupted')");
    assert(label === 'Interrupted', `humanizeReceiptResult('interrupted') = ${label}`);
  });
  } else if (scenario === 'legacy-startup') {
    // Proves the STARTUP call site's fallback specifically: real
    // app.whenReady() runs against a receiptId-less activeTimer snapshot,
    // not a runtime-fabricated one (unlike the 'main' scenario's resume-only
    // fallback check).
    await check('real app.whenReady() protects a pre-upgrade (receiptId-less) snapshot\'s receipt via fallback', () => {
      const r = receipts.getReceiptById(legacyReceiptId);
      assert(r && r.result === 'running', `legacy receipt was wrongly orphaned at real startup: ${JSON.stringify(r)}`);
    });

    await check('resuming that legacy-protected receipt reuses it, no duplicate', async () => {
      const beforeCount = receipts.getAllReceiptsForExport().length;
      const result = await desktopEval('window.electronAPI.resumeRecoverableTimer()');
      assert(result && result.success !== false, JSON.stringify(result));
      await waitFor(() => desktopEval('state.running === true'), 'legacy-snapshot resume did not start at real startup');
      const afterCount = receipts.getAllReceiptsForExport().length;
      assert(afterCount === beforeCount, `receipt count changed: ${beforeCount} -> ${afterCount}`);
      assert(receipts.getReceiptById(legacyReceiptId).result === 'running', 'legacy receipt should have been reused');
      await desktopEval('window.electronAPI.cancelTimer()');
      await waitFor(() => desktopEval('!state.running && !state.paused'), 'desktop did not return to idle');
    });
  }

  console.log(`\nReceipt recovery Electron proof (${scenario}): ${passed} passed, ${failed} failed`);
  console.log('Real power actions: 0');

  app.quit();
  process.exit(failed === 0 ? 0 : 1);
}

if (process.env.LIGHTSOUT_RECEIPT_PROOF_CHILD === '1') {
  runElectronProof().catch(error => {
    console.error('Receipt recovery proof fatal error:', error.stack || error.message);
    try { require('electron').app.quit(); } catch { /* best effort */ }
    process.exit(1);
  });
} else {
  runParent().catch(error => {
    console.error('Receipt recovery proof launcher error:', error.stack || error.message);
    process.exit(1);
  });
}
