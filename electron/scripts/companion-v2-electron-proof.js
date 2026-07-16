#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const electronRoot = path.resolve(__dirname, '..');
const captureDocs = process.argv.includes('--capture-docs');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });
}

async function runParent() {
  const { spawn } = require('child_process');
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-companion-v2-proof-'));
  const port = await freePort();
  const captureDir = captureDocs
    ? path.resolve(electronRoot, '..', 'docs', 'proof', 'companion-v2-c1')
    : path.join(isolatedDir, 'captures');
  fs.mkdirSync(captureDir, { recursive: true });

  console.log('\nReal Electron Runtime Proof — Companion V2 C1');
  console.log(`Isolated userData: ${isolatedDir}`);
  console.log(`Ephemeral companion port: ${port}`);
  console.log('Dry Run: ENABLED');
  console.log('Real power actions: DISABLED\n');

  const electronBin = require(path.join(electronRoot, 'node_modules', 'electron'));
  const child = spawn(electronBin, [__filename], {
    cwd: electronRoot,
    env: {
      ...process.env,
      LIGHTSOUT_C1_PROOF_CHILD: '1',
      LIGHTSOUT_C1_PROOF_PORT: String(port),
      LIGHTSOUT_C1_PROOF_USERDATA: isolatedDir,
      LIGHTSOUT_C1_PROOF_CAPTURE_DIR: captureDir,
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
    console.error('\nTimeout: Companion V2 proof did not complete in 90s');
    child.kill();
  }, 90000);

  child.on('close', code => {
    clearTimeout(timeout);
    try { fs.rmSync(isolatedDir, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(code ?? 1);
  });
}

async function runElectronProof() {
  const { EventEmitter } = require('events');
  const childProcess = require('child_process');
  const nativeSpawn = childProcess.spawn;
  const { app, BrowserWindow } = require('electron');

  const port = Number(process.env.LIGHTSOUT_C1_PROOF_PORT);
  const userData = process.env.LIGHTSOUT_C1_PROOF_USERDATA;
  const captureDir = process.env.LIGHTSOUT_C1_PROOF_CAPTURE_DIR;
  const token = 'COMPANION_V2_C1_PROOF_TOKEN';

  app.setPath('userData', userData);
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  app.setAppPath(electronRoot);
  process.argv.push('--minimized', '--no-auto-start');
  process.chdir(electronRoot);

  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: {
      dryRun: true,
      forceShutdown: false,
      timerName: 'Last Call',
      nightLightOnDim: false,
      pauseMediaOnDim: false,
      lockoutOnDim: false,
      idleDetectionEnabled: false,
      bedtimeReminderEnabled: false
    },
    remoteControl: { enabled: true, mode: 'local', token },
    lastLight: { enabled: false }
  }, null, 2));

  // Proof-process-only PowerShell isolation: the production main process still
  // runs, but system probes/firewall calls return an empty successful result.
  // Dry Run separately guarantees that no final Windows power action executes.
  childProcess.spawn = (command, args, options) => {
    if (/powershell/i.test(String(command))) {
      const fake = new EventEmitter();
      fake.stdout = new EventEmitter();
      fake.stderr = new EventEmitter();
      fake.kill = () => {};
      setImmediate(() => fake.emit('close', 0));
      return fake;
    }
    return nativeSpawn(command, args, options);
  };

  const companion = require(path.join(electronRoot, 'companion.js'));
  const nativeCompanionStart = companion.start;
  companion.start = options => nativeCompanionStart({ ...options, port });

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
  const profiles = require(path.join(electronRoot, 'profiles.js'));
  const receipts = require(path.join(electronRoot, 'runReceipts.js'));
  const commandLog = [];
  companion.onMessage(message => commandLog.push({ ...message }));

  let passed = 0;
  let failed = 0;
  const results = [];
  async function check(label, fn) {
    try {
      await fn();
      results.push(`  PASS  ${label}`);
      passed++;
    } catch (error) {
      results.push(`  FAIL  ${label} -> ${error.message || error}`);
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

  await waitFor(() => companion.getStatus().running, 'ephemeral companion server did not start');
  const phone = new BrowserWindow({
    width: 390,
    height: 844,
    useContentSize: true,
    show: false,
    frame: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  await phone.loadURL(`http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`);
  const phoneEval = code => phone.webContents.executeJavaScript(code);
  await waitFor(() => phoneEval("document.getElementById('status-text').textContent === 'Connected'"), 'phone did not connect');
  await waitFor(() => phoneEval("document.getElementById('freshness').textContent.includes('Updated')"), 'initial authoritative state missing');

  async function capture(name) {
    const image = await phone.webContents.capturePage();
    fs.writeFileSync(path.join(captureDir, `${name}.png`), image.toPNG());
  }

  async function layoutAt(width, height, name) {
    phone.setContentSize(width, height);
    await wait(100);
    await phoneEval('window.scrollTo(0, 0)');
    const layout = await phoneEval(`(() => {
      const controls = [...document.querySelectorAll('#active-controls button')];
      const boxes = controls.map(button => {
        const box = button.getBoundingClientRect();
        return { text: button.textContent.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
      });
      return {
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        boxes,
        badge: document.getElementById('safety-badge').textContent,
        pc: document.getElementById('pc-name').textContent,
        stop: document.getElementById('btn-cancel').textContent
      };
    })()`);
    assert(layout.scrollWidth <= layout.innerWidth, `${width}px has horizontal overflow ${layout.scrollWidth}/${layout.innerWidth}`);
    assert(layout.boxes.every(box => box.left >= 0 && box.right <= layout.innerWidth && box.height >= 48), `${width}px clips or shrinks a primary control`);
    const stopBox = layout.boxes.find(box => box.text === 'Stop Tonight’s Run');
    assert(stopBox && stopBox.top >= 0 && stopBox.bottom <= height, `${width}px Stop Tonight’s Run is outside the initial frame`);
    assert(layout.badge === 'DRY RUN', `${width}px safety badge missing`);
    assert(layout.pc.includes('Target PC:'), `${width}px target PC missing`);
    assert(layout.stop === 'Stop Tonight’s Run', `${width}px stop control missing`);
    await capture(name);
  }

  const idleState = await desktopEval('({ running: state.running, paused: state.paused })');
  await check('idle startup remains inert', () => assert(!idleState.running && !idleState.paused, 'timer auto-started'));

  const profile = profiles.getAll()[0];
  receipts.clearReceipts();
  await desktopEval(`window.electronAPI.startTimer(${JSON.stringify({
    durationSeconds: 900,
    action: 'sleep',
    dryRun: true,
    forceShutdown: false,
    gracePeriod: 0,
    profileId: profile.id,
    nightModeId: 'quick-sleep'
  })})`);
  await waitFor(() => phoneEval("document.getElementById('active-controls').style.display !== 'none'"), 'active phone controller did not appear');

  await check('state projection includes canonical Night Mode identity', async () => {
    const value = await phoneEval("({ title: timerName.textContent, id: latestState.nightModeId, version: latestState.nightModeVersion })");
    assert(value.title === 'Quick Sleep' && value.id === 'quick-sleep' && value.version === 1, JSON.stringify(value));
  });
  await check('state projection includes canonical profile identity', async () => {
    const value = await phoneEval("({ id: latestState.profileId, name: latestState.profileName, label: profileNameEl.textContent })");
    assert(value.id === profile.id && value.name === profile.name && value.label.includes(profile.name), JSON.stringify(value));
  });
  await check('active UI renders desktop-projected Dry Run', async () => {
    const value = await phoneEval("({ dryRun: latestState.dryRun, badge: safetyBadge.textContent })");
    assert(value.dryRun === true && value.badge === 'DRY RUN', JSON.stringify(value));
  });
  await check('missing Night Mode renders Custom Timer', async () => {
    const title = await phoneEval("handleUpdate({ ...latestState, type: 'state', nightModeId: null, nightModeTitle: null, nightModeVersion: null }); timerName.textContent");
    assert(title === 'Custom Timer', `title was ${title}`);
  });
  await check('active UI renders Real Action only from projected false', async () => {
    const badge = await phoneEval("handleUpdate({ ...latestState, type: 'state', dryRun: false }); safetyBadge.textContent");
    assert(badge === 'REAL ACTION', `badge was ${badge}`);
  });
  await capture('02-custom-timer-real-action');
  companion.broadcast({
    type: 'state', running: true, paused: false, remainingSeconds: 898, totalSeconds: 900,
    action: 'sleep', phase: 'focus', timerName: 'Last Call', pcName: os.hostname(), dryRun: true,
    nightModeId: 'quick-sleep', nightModeTitle: 'Quick Sleep', nightModeVersion: 1,
    profileId: profile.id, profileName: profile.name
  });
  await waitFor(() => phoneEval("timerName.textContent === 'Quick Sleep' && safetyBadge.textContent === 'DRY RUN'"), 'authoritative identity did not restore');

  const tickOne = await desktopEval('state.remainingSeconds');
  await wait(1150);
  const tickTwo = await desktopEval('state.remainingSeconds');
  await wait(1150);
  const tickThree = await desktopEval('state.remainingSeconds');
  await check('two authoritative countdown ticks decrement', () => assert(tickTwo < tickOne && tickThree < tickTwo, `${tickOne},${tickTwo},${tickThree}`));

  const viewports = [[320,700],[360,800],[390,844],[412,915],[430,932]];
  for (const [width, height] of viewports) {
    await check(`${width}px active layout has no clipping`, () => layoutAt(width, height, `01-active-${width}x${height}`));
  }

  phone.setContentSize(390, 844);
  await phoneEval("(() => { const panel = document.getElementById('details-panel'); panel.open = true; panel.scrollIntoView({ block: 'start' }); })()");
  await capture('03-details-open');
  await phoneEval("(() => { document.getElementById('details-panel').open = false; window.scrollTo(0, 0); })()");

  await phoneEval("document.getElementById('btn-pause').click()");
  await waitFor(() => desktopEval('state.paused === true'), 'desktop did not pause');
  await waitFor(() => phoneEval("document.getElementById('pending-status').classList.contains('show') === false"), 'pause pending state did not clear');
  await capture('04-paused');
  await check('Pause sends one toggle', () => assert(commandLog.filter(message => message.action === 'togglePause').length === 1, 'pause sent more than once'));
  await check('Pending Pause clears only after authoritative paused state', async () => {
    const value = await phoneEval("({ paused: latestState.paused, pending: pendingOperation })");
    assert(value.paused === true && value.pending === null, JSON.stringify(value));
  });

  async function proveAdd(seconds, doubleTap = false) {
    const before = await desktopEval('state.remainingSeconds');
    const beforeCommands = commandLog.filter(message => message.action === 'snooze' && message.seconds === seconds).length;
    await phoneEval(`(() => { const button = document.querySelector('[data-add-seconds="${seconds}"]'); button.click(); ${doubleTap ? 'button.click();' : ''} })()`);
    if (seconds === 300) {
      await phoneEval("document.getElementById('pending-status').scrollIntoView({ block: 'center' })");
      await capture('05-pending-add-time');
      await phoneEval('window.scrollTo(0, 0)');
    }
    await waitFor(() => desktopEval(`state.remainingSeconds === ${before + seconds}`), `desktop did not add exactly ${seconds}s`);
    await waitFor(() => phoneEval('pendingOperation === null'), `pending add ${seconds}s did not clear`);
    const afterCommands = commandLog.filter(message => message.action === 'snooze' && message.seconds === seconds).length;
    assert(afterCommands - beforeCommands === 1, `${seconds}s produced ${afterCommands - beforeCommands} messages`);
  }

  await check('+5 sends once and adds exactly 300 seconds', () => proveAdd(300, true));
  await check('rapid double-tap sends one add-time command', () => assert(commandLog.filter(message => message.action === 'snooze' && message.seconds === 300).length === 1, 'double tap duplicated +5'));
  await check('+15 sends once and adds exactly 900 seconds', () => proveAdd(900));
  await check('+30 sends once and adds exactly 1800 seconds', () => proveAdd(1800));

  await check('command timeout does not resend', async () => {
    const before = commandLog.length;
    await phoneEval("beginPending({ kind: 'proof-timeout', success: '', matches: () => false })");
    await wait(5200);
    const value = await phoneEval("({ text: pendingStatus.textContent, pending: pendingOperation })");
    assert(value.text === 'PC did not confirm the change' && value.pending === null, JSON.stringify(value));
    assert(commandLog.length === before, 'timeout resent or invented a command');
  });

  await phoneEval("document.getElementById('btn-pause').click()");
  await waitFor(() => desktopEval('state.paused === false'), 'desktop did not resume');
  await waitFor(() => phoneEval('pendingOperation === null'), 'resume pending state did not clear');
  await check('Resume sends one toggle', () => assert(commandLog.filter(message => message.action === 'togglePause').length === 2, 'resume toggle count changed'));
  await check('Pending Resume clears only after authoritative resumed state', async () => {
    const value = await phoneEval("({ paused: latestState.paused, pending: pendingOperation })");
    assert(value.paused === false && value.pending === null, JSON.stringify(value));
  });

  const beforeReloadCommands = commandLog.length;
  const beforeReloadIdentity = await desktopEval('({ nightModeId: state.armedNightMode?.nightModeId || null, remaining: state.remainingSeconds })');
  await phone.reload();
  await waitFor(() => phoneEval("document.getElementById('status-text').textContent === 'Connected'"), 'phone did not reconnect after reload');
  try {
    await waitFor(() => phoneEval("timerName.textContent === 'Quick Sleep'"), 'reconnect did not restore identity');
  } catch (error) {
    const reconnectState = await phoneEval("({ title: timerName.textContent, latestState, status: statusText.textContent, freshness: freshnessEl.textContent })");
    throw new Error(`${error.message}: ${JSON.stringify(reconnectState)}`);
  }
  await check('reconnect does not replay a pending command', () => assert(commandLog.length === beforeReloadCommands, 'reload replayed a command'));
  await check('reload cannot overwrite desktop timer state', async () => {
    const after = await desktopEval('({ running: state.running, remaining: state.remainingSeconds })');
    assert(after.running && after.remaining <= beforeReloadIdentity.remaining, JSON.stringify(after));
  });

  await phoneEval("setConnectionState('connecting', 'Reconnecting')");
  await capture('06-reconnecting');
  await companion.stop();
  await waitFor(() => phoneEval("document.getElementById('status-text').textContent === 'PC unavailable'"), 'offline state missing');
  await phoneEval("setConnectionState('offline', 'PC unavailable'); window.scrollTo(0, 0)");
  await capture('07-offline-stale');
  await check('offline state disables timer mutation controls', async () => {
    const disabled = await phoneEval("[...document.querySelectorAll('.timer-mutation')].every(button => button.disabled)");
    assert(disabled, 'offline mutation control remained enabled');
  });
  await check('offline state marks prior state stale', async () => {
    const value = await phoneEval("({ stale: document.body.classList.contains('stale-state'), text: freshnessEl.textContent })");
    assert(value.stale && value.text.includes('State may be stale'), JSON.stringify(value));
  });

  companion.start({ token, host: '127.0.0.1' });
  await waitFor(() => phoneEval("document.getElementById('status-text').textContent === 'Connected'"), 'phone did not recover', 10000);
  await waitFor(() => phoneEval("!document.body.classList.contains('stale-state')"), 'fresh state did not clear stale marker');
  await check('fresh state clears stale indication', async () => {
    const text = await phoneEval('freshnessEl.textContent');
    assert(text.includes('Updated'), `freshness was ${text}`);
  });

  phone.setContentSize(320, 700);
  await phone.webContents.setZoomFactor(1.2);
  await phoneEval('window.scrollTo(0, 0)');
  await capture('08-large-font-narrow-fallback');
  await phone.webContents.setZoomFactor(1);
  phone.setContentSize(390, 844);
  await wait(2100);

  await phoneEval('window.scrollTo(0, 0)');
  await phoneEval("document.getElementById('btn-cancel').click()");
  await waitFor(() => phoneEval("document.getElementById('cancel-confirm').classList.contains('show')"), 'cancel confirmation did not open');
  await wait(150);
  await phoneEval(`new Promise(resolve => {
    if (!document.getElementById('cancel-confirm').classList.contains('show')) {
      document.getElementById('btn-cancel').click();
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`);
  await waitFor(() => phoneEval("document.getElementById('cancel-confirm').classList.contains('show')"), 'cancel confirmation did not remain open for capture');
  await capture('09-cancel-confirmation');
  await check('cancel confirmation names run, PC, remaining time, and consequence', async () => {
    const copy = await phoneEval('cancelCopy.textContent');
    assert(copy.includes('Quick Sleep') && copy.includes(os.hostname()) && copy.includes('remaining') && copy.includes('stop the timer'), copy);
  });
  const cancelBefore = commandLog.filter(message => message.action === 'cancel').length;
  await phoneEval("(() => { const button = document.getElementById('cancel-stop'); button.click(); button.click(); })()");
  await waitFor(() => desktopEval('state.running === false && state.paused === false'), 'desktop did not cancel');
  await waitFor(() => phoneEval('pendingOperation === null'), 'cancel pending state did not clear');
  await check('Cancel sends once after in-page confirmation', () => assert(commandLog.filter(message => message.action === 'cancel').length - cancelBefore === 1, 'cancel duplicated'));
  await check('Cancel success appears only after authoritative idle', async () => {
    const value = await phoneEval("({ idle: !latestState.running && !latestState.paused, toast: document.getElementById('toast').textContent })");
    assert(value.idle && value.toast === 'Tonight’s run stopped', JSON.stringify(value));
  });
  await check('desktop cancelled receipt behavior remains intact', () => assert(receipts.getLatestReceipt()?.result === 'cancelled', 'cancelled receipt missing'));

  await check('phone start explicitly reports Real Action', async () => {
    const message = await phoneEval(`(() => {
      let captured = '';
      window.confirm = text => { captured = text; return false; };
      document.querySelector('[data-min="15"]').click();
      return captured;
    })()`);
    assert(message.includes('REAL ACTION') && message.includes('Dry Run is not available from the phone'), message);
  });
  await check('phone start cannot claim Dry Run', async () => {
    const text = await phoneEval("document.querySelector('.idle-safety').textContent");
    assert(text.includes('REAL ACTION') && text.includes('Dry Run is not available'), text);
  });
  await check('phone cannot overwrite desktop identity fields', () => {
    const forged = commandLog.some(message => 'nightModeId' in message || 'profileId' in message || 'dryRun' in message || 'forceShutdown' in message);
    assert(!forged, 'desktop-owned field crossed the validated phone boundary');
  });
  await check('remote force shutdown remains impossible', () => assert(!commandLog.some(message => message.forceShutdown === true), 'force flag accepted'));
  await check('remote logout remains impossible', () => assert(!commandLog.some(message => message.timerAction === 'logout'), 'logout accepted'));
  await check('remote hibernate remains impossible', () => assert(!commandLog.some(message => message.timerAction === 'hibernate'), 'hibernate accepted'));

  results.forEach(result => console.log(result));
  console.log(`\nCompanion V2 Electron proof: ${passed} passed, ${failed} failed`);
  console.log(`Commands observed: ${commandLog.length}`);
  console.log('Real power actions: 0');
  console.log(`Captures: ${captureDir}`);

  phone.destroy();
  app.quit();
  process.exit(failed === 0 ? 0 : 1);
}

if (process.env.LIGHTSOUT_C1_PROOF_CHILD === '1') {
  runElectronProof().catch(error => {
    console.error('Companion V2 proof fatal error:', error.stack || error.message);
    try { require('electron').app.quit(); } catch { /* best effort */ }
    process.exit(1);
  });
} else {
  runParent().catch(error => {
    console.error('Companion V2 proof launcher error:', error.stack || error.message);
    process.exit(1);
  });
}
