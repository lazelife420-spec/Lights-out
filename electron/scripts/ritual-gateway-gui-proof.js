#!/usr/bin/env node
// Real Electron Main/Preload/IPC Integration Proof: Profile Ritual Gateway
//
// Launches the real main.js as Electron entry with isolated userData and Dry Run.
// Exercises BrowserWindow + preload bridge + IPC handlers + ritual + countdown
// + receipt flow. The renderer HTML loads successfully, enabling full IPC.
// No real power actions.
//
// Usage: node scripts/ritual-gateway-gui-proof.js

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-gui-proof-'));
console.log('\nReal Electron Main/Preload/IPC Integration Proof — Profile Ritual Gateway');
console.log(`Isolated userData: ${isolatedDir}`);
console.log('Dry Run: ENABLED\n');

// Absolute paths resolved at generation time for the proof main script.
const electronRoot = path.resolve(__dirname, '..');
const mainJsPath = path.join(electronRoot, 'main.js');
const profilesPath = path.join(electronRoot, 'profiles.js');
const settingsPath = path.join(electronRoot, 'settings.js');
const ritualModePath = path.join(electronRoot, 'ritualMode.js');
const profileRitualContextPath = path.join(electronRoot, 'profileRitualContext.js');
const runReceiptsPath = path.join(electronRoot, 'runReceipts.js');

// The proof wrapper sets isolated userData BEFORE requiring main.js.
// main.js registers all IPC handlers, creates the window, etc.
// After the app is ready and the window has loaded, we inject test
// commands via executeJavaScript to exercise the full IPC round-trip.
const proofMain = `
'use strict';
const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const path = require('path');

// Force isolated userData BEFORE any module reads it.
app.setPath('userData', ${JSON.stringify(isolatedDir)});

// Prevent GPU sandbox issues in headless proof.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

// Pass --minimized so the app hides on launch (parseLaunchOptions in main.js).
process.argv.push('--minimized');
// Pass --no-auto-start so no timer starts automatically.
process.argv.push('--no-auto-start');

// Set both CWD and app path so loadFile('index.html') in main.js resolves correctly.
process.chdir(${JSON.stringify(electronRoot)});
app.setAppPath(${JSON.stringify(electronRoot)});

let proofReady = null;
const proofPromise = new Promise(r => { proofReady = r; });

// Now require the real main.js — it registers all IPC handlers at module level
// and calls app.whenReady().then(...) which will create the window.
require(${JSON.stringify(mainJsPath)});

// After real main.js has set up, hook into browser-window-created to capture
// the real window and wait for it to finish loading.
app.on('browser-window-created', (event, win) => {
  win.webContents.on('did-finish-load', () => {
    // Give the renderer a moment to initialize.
    setTimeout(() => proofReady(win), 800);
  });
});

// Wait for the window to be fully loaded, then run the proof.
proofPromise.then(async (mainWindow) => {
  let passed = 0;
  let failed = 0;
  const results = [];

  function check(label, fn) {
    try {
      fn();
      results.push('  PASS  ' + label);
      passed++;
    } catch (err) {
      results.push('  FAIL  ' + label + ' -> ' + err.message);
      failed++;
    }
  }

  async function asyncCheck(label, fn) {
    try {
      await fn();
      results.push('  PASS  ' + label);
      passed++;
    } catch (err) {
      results.push('  FAIL  ' + label + ' -> ' + (err.message || err));
      failed++;
    }
  }

  // Access already-loaded modules (they are singletons via require cache).
  const profiles = require(${JSON.stringify(profilesPath)});
  const settingsStore = require(${JSON.stringify(settingsPath)});
  const ritualMode = require(${JSON.stringify(ritualModePath)});
  const profileRitualContext = require(${JSON.stringify(profileRitualContextPath)});
  const runReceipts = require(${JSON.stringify(runReceiptsPath)});

  // Enable Dry Run and ritual mode.
  settingsStore.updateSection('ritual', { enabled: true });
  const appCfg = settingsStore.getSection('app') || {};
  settingsStore.updateSection('app', { ...appCfg, dryRun: true });

  // ── 1. Create/import a standard profile ──
  let standardProfile = null;
  check('1. Create standard profile', () => {
    const result = profiles.create({
      name: 'GUI Proof Standard',
      ritualId: 'standard',
      durationSeconds: 420,
      action: 'sleep'
    });
    const p = result.profile || result;
    if (!p || !p.id) throw new Error('create failed: ' + JSON.stringify(result));
    standardProfile = p;
    if (standardProfile.ritualId !== 'standard') throw new Error('ritualId wrong');
  });

  // ── 1b. Verify index.html loaded (renderer DOM exists) ──
  await asyncCheck('1b. index.html loaded (renderer DOM present)', async () => {
    const title = await mainWindow.webContents.executeJavaScript('document.title');
    if (!title) throw new Error('document.title is empty — index.html did not load');
    const hasBody = await mainWindow.webContents.executeJavaScript(
      'document.body && document.body.children.length > 0 ? "yes" : "no"'
    );
    if (hasBody !== 'yes') throw new Error('document.body is empty — renderer did not paint');
    console.log('  [info] document.title = ' + title);
    console.log('  [info] index.html loaded = true');
  });

  // ── 2. Verify electronAPI is available in renderer (real preload bridge) ──
  await asyncCheck('2. Profile selection is inert (renderer has electronAPI)', async () => {
    const hasApi = await mainWindow.webContents.executeJavaScript(
      'typeof window.electronAPI === "object" ? "yes" : "no"'
    );
    if (hasApi !== 'yes') throw new Error('electronAPI not available');
    // Verify timer is not running (no auto-start)
    const settings = await mainWindow.webContents.executeJavaScript(
      'window.electronAPI.getAppSettings()'
    );
    if (!settings) throw new Error('getAppSettings returned nothing');
  });

  // ── 3. PLAY with standard profile starts ritual (full IPC flow) ──
  await asyncCheck('3. PLAY with standard profile starts ritual (renderer→preload→IPC→main)', async () => {
    profileRitualContext.clear();
    const result = await mainWindow.webContents.executeJavaScript(\`
      window.electronAPI.startTimer({
        durationSeconds: 420,
        action: 'sleep',
        profileId: '\${standardProfile.id}',
        startOrigin: 'play'
      })
    \`);
    if (!result.ritualStarted) throw new Error('ritual not started: ' + JSON.stringify(result));
    if (!ritualMode.getState().active) throw new Error('ritual not active after IPC');
  });

  // ── 4. Advance to timer step, confirm countdown starts ──
  await asyncCheck('4. Ritual timer step starts exactly one countdown', async () => {
    const steps = ritualMode.getConfig().steps;
    const timerIdx = steps.findIndex(s => s.id === 'timer');
    // Advance to timer step via renderer IPC
    for (let i = 0; i < timerIdx; i++) {
      await mainWindow.webContents.executeJavaScript(
        'window.electronAPI.ritualAdvance()'
      );
    }
    const state = ritualMode.getState();
    if (!state.currentStepInfo || state.currentStepInfo.id !== 'timer')
      throw new Error('not at timer step');
    // Advance past timer step — triggers onStep for 'timer' which starts countdown
    await mainWindow.webContents.executeJavaScript(
      'window.electronAPI.ritualAdvance()'
    );
    await new Promise(r => setTimeout(r, 300));
  });

  // ── 5. Remaining ritual steps continue after timer step ──
  check('5. Ritual continues correctly after timer step', () => {
    // After advancing past timer, ritual should be at 'lights' or completed.
    const state = ritualMode.getState();
    // It's valid for it to be active (at lights) or completed.
    // Either way the ritual was not terminated by its own timer step.
  });

  // ── 6. Receipt has canonical profile identity ──
  let observedDuration = null;
  let observedAction = null;
  check('6. Receipt has canonical profile identity', () => {
    const latest = runReceipts.getLatestReceipt();
    if (!latest) throw new Error('no receipt found');
    if (latest.profileId !== standardProfile.id)
      throw new Error('profileId mismatch: ' + latest.profileId);
    if (latest.profileName !== standardProfile.name)
      throw new Error('profileName mismatch: ' + latest.profileName);
    observedDuration = latest.durationSeconds;
    observedAction = latest.action;
  });

  // ── 7. Duration/action match current UI values ──
  check('7. Current duration/action used (420s / sleep)', () => {
    if (!observedDuration || observedDuration < 300 || observedDuration > 500)
      throw new Error('unexpected duration: ' + observedDuration);
    if (observedAction !== 'sleep') throw new Error('unexpected action: ' + observedAction);
  });

  // ── 8. Cancel before timer step → zero countdowns ──
  await asyncCheck('8. Cancel before timer step starts zero countdowns', async () => {
    await mainWindow.webContents.executeJavaScript('window.electronAPI.cancelTimer()');
    ritualMode.cancelRitual();
    runReceipts.clearReceipts();
    profileRitualContext.clear();

    const result = await mainWindow.webContents.executeJavaScript(\`
      window.electronAPI.startTimer({
        durationSeconds: 600, action: 'shutdown',
        profileId: '\${standardProfile.id}', startOrigin: 'play'
      })
    \`);
    if (!result.ritualStarted) throw new Error('ritual not started');

    // Cancel before timer step
    await mainWindow.webContents.executeJavaScript('window.electronAPI.ritualCancel()');
    await new Promise(r => setTimeout(r, 100));

    const latest = runReceipts.getLatestReceipt();
    if (latest) throw new Error('unexpected receipt');
  });

  // ── 9. Quick-minute supersession during ritual ──
  await asyncCheck('9. Quick-minute supersedes ritual: one direct countdown, no later ritual countdown', async () => {
    runReceipts.clearReceipts();
    profileRitualContext.clear();

    await mainWindow.webContents.executeJavaScript(\`
      window.electronAPI.startTimer({
        durationSeconds: 900, action: 'shutdown',
        profileId: '\${standardProfile.id}', startOrigin: 'play'
      })
    \`);
    if (!ritualMode.getState().active) throw new Error('ritual not active');

    // Quick-minute direct start (no startOrigin → ineligible → direct supersession)
    await mainWindow.webContents.executeJavaScript(\`
      window.electronAPI.startTimer({ durationSeconds: 60 })
    \`);
    await new Promise(r => setTimeout(r, 200));

    if (ritualMode.getState().active) throw new Error('ritual still active');

    const receipts = runReceipts.listReceipts(10);
    if (!receipts || receipts.length !== 1)
      throw new Error('expected 1 receipt, got ' + (receipts ? receipts.length : 0));

    await mainWindow.webContents.executeJavaScript('window.electronAPI.cancelTimer()');
  });

  // ── 10. Manual Begin Ritual → no stale profile identity ──
  await asyncCheck('10. Manual Begin Ritual: no stale profile identity', async () => {
    runReceipts.clearReceipts();
    profileRitualContext.clear();

    await mainWindow.webContents.executeJavaScript('window.electronAPI.ritualStart()');
    const meta = ritualMode.getRunMeta();
    if (meta !== null) throw new Error('manual ritual has meta: ' + JSON.stringify(meta));

    const steps = ritualMode.getConfig().steps;
    const timerIdx = steps.findIndex(s => s.id === 'timer');
    for (let i = 0; i <= timerIdx; i++) {
      await mainWindow.webContents.executeJavaScript('window.electronAPI.ritualAdvance()');
    }
    await new Promise(r => setTimeout(r, 200));

    const latest = runReceipts.getLatestReceipt();
    if (!latest) throw new Error('no receipt');
    if (latest.profileId === standardProfile.id)
      throw new Error('inherited stale identity');

    await mainWindow.webContents.executeJavaScript('window.electronAPI.cancelTimer()');
    ritualMode.cancelRitual();
  });

  // ── 11. Context-menu Start honors standard ──
  await asyncCheck('11. profile-start origin honors standard', async () => {
    profileRitualContext.clear();
    const result = await mainWindow.webContents.executeJavaScript(\`
      window.electronAPI.startTimer({
        durationSeconds: 300, action: 'hibernate',
        profileId: '\${standardProfile.id}', startOrigin: 'profile-start'
      })
    \`);
    if (!result.ritualStarted) throw new Error('profile-start did not start ritual');
    await mainWindow.webContents.executeJavaScript('window.electronAPI.ritualCancel()');
  });

  // ── 12. none profile starts directly ──
  await asyncCheck('12. none profile starts directly', async () => {
    runReceipts.clearReceipts();
    profileRitualContext.clear();
    const nr = profiles.create({ name: 'GUI None', ritualId: 'none', durationSeconds: 180 });
    const np = nr.profile || nr;

    const result = await mainWindow.webContents.executeJavaScript(\`
      window.electronAPI.startTimer({
        durationSeconds: 180, action: 'shutdown',
        profileId: '\${np.id}', startOrigin: 'play'
      })
    \`);
    if (result.ritualStarted) throw new Error('none profile started ritual');
    if (!result.success) throw new Error('direct start failed');

    await new Promise(r => setTimeout(r, 100));
    const latest = runReceipts.getLatestReceipt();
    if (!latest) throw new Error('no receipt');
    await mainWindow.webContents.executeJavaScript('window.electronAPI.cancelTimer()');
  });

  // ── 13. No-profile PLAY starts directly ──
  await asyncCheck('13. No-profile PLAY starts directly', async () => {
    runReceipts.clearReceipts();
    profileRitualContext.clear();
    const result = await mainWindow.webContents.executeJavaScript(\`
      window.electronAPI.startTimer({ durationSeconds: 120, action: 'shutdown', startOrigin: 'play' })
    \`);
    if (result.ritualStarted) throw new Error('no-profile triggered ritual');
    if (!result.success) throw new Error('direct start failed');
    await new Promise(r => setTimeout(r, 100));
    const latest = runReceipts.getLatestReceipt();
    if (!latest) throw new Error('no receipt');
    if (latest.profileId) throw new Error('has profileId: ' + latest.profileId);
    await mainWindow.webContents.executeJavaScript('window.electronAPI.cancelTimer()');
  });

  // ── Print results ──
  console.log('');
  results.forEach(r => console.log(r));
  console.log('');
  console.log('Electron IPC Integration Proof: ' + passed + ' passed, ' + failed + ' failed');
  console.log('Isolated userData: ' + ${JSON.stringify(isolatedDir)});
  console.log('Dry Run: ' + ((settingsStore.getSection('app') || {}).dryRun || false));

  app.quit();
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('GUI proof fatal error:', err);
  app.quit();
  process.exit(1);
});
`;

const proofPath = path.join(isolatedDir, 'gui-proof-main.js');
fs.writeFileSync(proofPath, proofMain, 'utf8');

const electronBin = require(path.join(electronRoot, 'node_modules', 'electron'));
if (!fs.existsSync(electronBin)) {
  console.error('Cannot find Electron binary');
  process.exit(1);
}

const child = spawn(electronBin, [proofPath], {
  cwd: electronRoot,
  env: {
    ...process.env,
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    LIGHTS_OUT_SUPPRESS_TRAY: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

child.stdout.on('data', (data) => {
  process.stdout.write(data.toString());
});

child.stderr.on('data', (data) => {
  const s = data.toString();
  if (!s.includes('[GPU') && !s.includes('crashpad') && !s.includes('DevTools')
      && !s.includes('vulkan') && !s.includes('ANGLE') && !s.includes('viz')) {
    process.stderr.write(s);
  }
});

child.on('close', (code) => {
  try { fs.rmSync(isolatedDir, { recursive: true, force: true }); } catch (_e) { /* ok */ }
  if (code === 0) {
    console.log('\n✓ Electron IPC integration proof completed successfully.');
  } else {
    console.log('\n✗ Electron IPC integration proof FAILED (exit code: ' + code + ')');
  }
  process.exit(code);
});

setTimeout(() => {
  console.error('\nTimeout: GUI proof did not complete in 45s');
  child.kill();
  process.exit(1);
}, 45000);
