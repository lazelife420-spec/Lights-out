#!/usr/bin/env node
// Real Electron Main/Preload/IPC/DOM proof for Night Modes.
// Runs with isolated userData, Dry Run enabled, and a proof-process-only
// accelerated 1-second timer interval. No production hooks or power actions.

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const electronRoot = path.resolve(__dirname, '..');
const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-night-modes-proof-'));
const mainJsPath = path.join(electronRoot, 'main.js');
const settingsPath = path.join(electronRoot, 'settings.js');
const ritualModePath = path.join(electronRoot, 'ritualMode.js');
const receiptsPath = path.join(electronRoot, 'runReceipts.js');

console.log('\nReal Electron Runtime Proof — Night Modes');
console.log(`Isolated userData: ${isolatedDir}`);
console.log('Dry Run: ENABLED');
console.log('Timer acceleration: proof process only\n');

const proofMain = `
'use strict';
const electron = require('electron');
const app = electron.app;

app.setPath('userData', ${JSON.stringify(isolatedDir)});
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
process.argv.push('--minimized');
process.argv.push('--no-auto-start');
process.chdir(${JSON.stringify(electronRoot)});
app.setAppPath(${JSON.stringify(electronRoot)});

// Accelerate only main-process intervals whose production cadence is exactly
// one second. This makes a canonical 15-minute mode complete in under 2s while
// leaving the shipped source and renderer clock untouched.
const nativeSetInterval = global.setInterval;
global.setInterval = (callback, delay, ...args) => {
  if (delay !== 1000) return nativeSetInterval(callback, delay, ...args);
  return nativeSetInterval(() => {
    for (let tick = 0; tick < 50; tick++) callback(...args);
  }, 10);
};

let resolveWindow;
const windowReady = new Promise(resolve => { resolveWindow = resolve; });
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => setTimeout(() => resolveWindow(win), 800));
});

require(${JSON.stringify(mainJsPath)});

windowReady.then(async mainWindow => {
  let passed = 0;
  let failed = 0;
  let dryRunCompletionVerified = false;
  const results = [];

  async function check(label, fn) {
    try {
      await fn();
      results.push('  PASS  ' + label);
      passed++;
    } catch (error) {
      results.push('  FAIL  ' + label + ' -> ' + (error.message || error));
      failed++;
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion failed');
  }

  const settingsStore = require(${JSON.stringify(settingsPath)});
  const ritualMode = require(${JSON.stringify(ritualModePath)});
  const receipts = require(${JSON.stringify(receiptsPath)});
  const appSettings = settingsStore.getSection('app') || {};
  settingsStore.updateSection('app', { ...appSettings, dryRun: true });
  settingsStore.updateSection('ritual', { enabled: true });
  settingsStore.updateSection('lastLight', { enabled: false });
  receipts.clearReceipts();

  const evaluate = code => mainWindow.webContents.executeJavaScript(code);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function armMode(id) {
    const selector = '.nm-card[data-mode-id="' + id + '"]';
    return evaluate(\`(async () => {
      state.dryRun = true;
      document.querySelector('[data-ns-tab="modes"]').click();
      const card = document.querySelector(\${JSON.stringify(selector)});
      if (!card) throw new Error('mode card missing: ' + \${JSON.stringify(id)});
      card.click();
      document.getElementById('nm-btn-use-tonight').click();
      await new Promise(resolve => setTimeout(resolve, 80));
      return {
        armed: state.armedNightMode ? { ...state.armedNightMode } : null,
        running: state.running,
        duration: document.getElementById('timer-input').value,
        action: state.action
      };
    })()\`);
  }

  async function clickStart() {
    await evaluate(\`(async () => {
      document.getElementById('btn-start').click();
      await new Promise(resolve => setTimeout(resolve, 80));
    })()\`);
  }

  async function cancelEverything() {
    await evaluate(\`Promise.all([
      window.electronAPI.cancelTimer(),
      window.electronAPI.ritualCancel()
    ])\`);
    await wait(60);
  }

  await check('real index.html and preload bridge load', async () => {
    const loaded = await evaluate(\`({
      title: document.title,
      api: typeof window.electronAPI,
      start: Boolean(document.getElementById('btn-start')),
      cards: document.querySelectorAll('.nm-card').length,
      running: state.running
    })\`);
    assert(loaded.title, 'document title missing');
    assert(loaded.api === 'object', 'preload bridge missing');
    assert(loaded.start, 'start button missing');
    assert(loaded.cards === 6, 'expected 6 rendered cards, got ' + loaded.cards);
    assert(!loaded.running, 'timer auto-started');
  });

  await check('catalogue crosses renderer-preload-IPC-main boundary', async () => {
    const catalogue = await evaluate('window.electronAPI.getNightModesCatalogue()');
    assert(Array.isArray(catalogue) && catalogue.length === 6, 'catalogue IPC failed');
    assert(catalogue.filter(mode => mode.status === 'ready').length === 4, 'ready-mode count changed');
  });

  await check('Quick Sleep arms through real DOM without auto-start', async () => {
    const stateAfterArm = await armMode('quick-sleep');
    assert(stateAfterArm.armed?.nightModeId === 'quick-sleep', 'Quick Sleep not armed');
    assert(stateAfterArm.duration === '15', 'Quick Sleep duration not loaded');
    assert(stateAfterArm.action === 'sleep', 'Quick Sleep action not loaded');
    assert(!stateAfterArm.running, 'Use Tonight auto-started timer');
  });

  await check('Quick Sleep reaches a real dry-run completion receipt', async () => {
    receipts.clearReceipts();
    await clickStart();
    const deadline = Date.now() + 7000;
    let receipt = null;
    while (Date.now() < deadline) {
      receipt = receipts.getLatestReceipt();
      if (receipt?.result === 'dry_run_completed') break;
      await wait(50);
    }
    assert(receipt, 'Quick Sleep receipt missing');
    assert(receipt.result === 'dry_run_completed', 'completion result: ' + receipt.result);
    assert(receipt.dryRun === true, 'receipt is not Dry Run');
    assert(receipt.nightModeId === 'quick-sleep', 'receipt mode identity missing');
    assert(receipt.nightModeTitle === 'Quick Sleep', 'receipt title missing');
    assert(receipt.nightModeVersion === 1, 'receipt version missing');
    assert(receipt.durationSeconds === 900, 'canonical duration changed');
    assert(receipt.action === 'sleep', 'canonical action changed');
    dryRunCompletionVerified = true;
  });
  await cancelEverything();

  const ritualModes = [
    { id: 'lights-down', title: 'Lights Down', duration: 2700, action: 'sleep' },
    { id: 'movie-wind-down', title: 'Movie Wind-Down', duration: 5400, action: 'sleep' },
    { id: 'full-shutdown', title: 'Full Shutdown', duration: 3600, action: 'shutdown' }
  ];

  for (const mode of ritualModes) {
    await check(mode.title + ' arms, hands off to ritual, records identity, and cancels', async () => {
      receipts.clearReceipts();
      ritualMode.cancelRitual();
      const armed = await armMode(mode.id);
      assert(armed.armed?.nightModeId === mode.id, 'mode not armed');
      assert(!armed.running, 'arming auto-started countdown');

      await clickStart();
      assert(ritualMode.getState().active, 'standard ritual did not start');

      const steps = ritualMode.getConfig().steps;
      const timerIndex = steps.findIndex(step => step.id === 'timer');
      assert(timerIndex >= 0, 'timer ritual step missing');
      for (let index = 0; index < timerIndex; index++) {
        await evaluate('window.electronAPI.ritualAdvance()');
      }
      await evaluate('window.electronAPI.ritualAdvance()');
      await wait(80);

      const receipt = receipts.getLatestReceipt();
      assert(receipt, 'countdown receipt missing');
      assert(receipt.result === 'running', 'countdown was not running before cancel');
      assert(receipt.dryRun === true, 'receipt is not Dry Run');
      assert(receipt.nightModeId === mode.id, 'receipt mode id mismatch');
      assert(receipt.nightModeTitle === mode.title, 'receipt title mismatch');
      assert(receipt.nightModeVersion === 1, 'receipt version mismatch');
      assert(receipt.durationSeconds === mode.duration, 'receipt duration mismatch');
      assert(receipt.action === mode.action, 'receipt action mismatch');

      await cancelEverything();
      assert(receipts.getLatestReceipt()?.result === 'cancelled', 'cancel was not recorded');
      assert(!ritualMode.getState().active, 'ritual remained active after cancel');
    });
  }

  await check('unavailable mode clears prior selection and cannot be used', async () => {
    await armMode('quick-sleep');
    const unavailable = await evaluate(\`(async () => {
      document.querySelector('[data-ns-tab="modes"]').click();
      document.querySelector('.nm-card[data-mode-id="quiet-house"]').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        armed: state.armedNightMode,
        disabled: document.getElementById('nm-btn-use-tonight').disabled,
        status: document.getElementById('nm-detail-status').textContent
      };
    })()\`);
    assert(unavailable.armed === null, 'prior ready mode stayed armed');
    assert(unavailable.disabled === true, 'unavailable action is enabled');
    assert(unavailable.status.includes('not yet supported'), 'honest reason missing');
  });

  await cancelEverything();
  console.log('');
  results.forEach(result => console.log(result));
  console.log('');
  console.log('Night Modes Electron proof: ' + passed + ' passed, ' + failed + ' failed');
  console.log('Dry Run completion: ' + (dryRunCompletionVerified ? 'verified' : 'FAILED'));
  console.log('Real power actions: 0');

  app.quit();
  process.exit(failed > 0 ? 1 : 0);
}).catch(error => {
  console.error('Night Modes Electron proof fatal error:', error.stack || error.message);
  app.quit();
  process.exit(1);
});
`;

const proofPath = path.join(isolatedDir, 'night-modes-proof-main.js');
fs.writeFileSync(proofPath, proofMain, 'utf8');

const electronBin = require(path.join(electronRoot, 'node_modules', 'electron'));
if (!fs.existsSync(electronBin)) {
  console.error('Cannot find Electron binary at:', electronBin);
  process.exit(1);
}

const child = spawn(electronBin, [proofPath], {
  cwd: electronRoot,
  env: {
    ...process.env,
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

child.stdout.on('data', data => process.stdout.write(data.toString()));
child.stderr.on('data', data => {
  const output = data.toString();
  if (!output.includes('[GPU') && !output.includes('crashpad') && !output.includes('DevTools')
      && !output.includes('vulkan') && !output.includes('ANGLE') && !output.includes('viz')) {
    process.stderr.write(output);
  }
});

child.on('close', code => {
  try { fs.rmSync(isolatedDir, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(code ?? 1);
});

setTimeout(() => {
  console.error('\nTimeout: Night Modes Electron proof did not complete in 45s');
  child.kill();
  process.exit(1);
}, 45000);
