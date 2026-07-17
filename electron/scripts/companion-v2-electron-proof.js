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
  const NodeWebSocket = globalThis.WebSocket;

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
  const nativeCompanionBroadcast = companion.broadcast;
  let suppressStateBroadcast = false;
  companion.start = options => nativeCompanionStart({ ...options, port });
  companion.broadcast = data => {
    if (suppressStateBroadcast && data?.type === 'state') return;
    nativeCompanionBroadcast(data);
  };

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
      const result = `  PASS  ${label}`;
      results.push(result);
      console.log(result);
      passed++;
    } catch (error) {
      const result = `  FAIL  ${label} -> ${error.message || error}`;
      results.push(result);
      console.log(result);
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

  async function sendRealWebSocketFrame(message) {
    assert(typeof NodeWebSocket === 'function', 'Node WebSocket client is unavailable');
    return new Promise((resolve, reject) => {
      const client = new NodeWebSocket(`ws://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`);
      const timeout = setTimeout(() => {
        try { client.close(); } catch {}
        reject(new Error('forged-frame WebSocket timed out'));
      }, 5000);
      client.addEventListener('open', () => {
        client.send(JSON.stringify(message));
        setTimeout(() => {
          clearTimeout(timeout);
          try { client.close(); } catch {}
          resolve();
        }, 150);
      }, { once: true });
      client.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('forged-frame WebSocket failed'));
      }, { once: true });
    });
  }

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

  async function assertReachableLayout(label) {
    const layout = await phoneEval(`(() => {
      const ids = ['timer-main', 'safety-badge', 'pc-name', 'freshness', 'btn-pause', 'btn-cancel', 'details-panel'];
      const elements = ids.map(id => document.getElementById(id));
      const addButtons = [...document.querySelectorAll('[data-add-seconds]')];
      const project = element => {
        const box = element.getBoundingClientRect();
        return { id: element.id || element.textContent.trim(), left: box.left, right: box.right,
          top: box.top + scrollY, bottom: box.bottom + scrollY, height: box.height,
          visible: getComputedStyle(element).display !== 'none' };
      };
      return {
        innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        items: [...elements, ...addButtons].map(project),
        stopBottom: project(document.getElementById('btn-cancel')).bottom,
        detailsTop: project(document.getElementById('details-panel')).top
      };
    })()`);
    assert(layout.scrollWidth <= layout.innerWidth, `${label} has horizontal overflow ${layout.scrollWidth}/${layout.innerWidth}`);
    assert(layout.items.every(item => item.visible && item.left >= 0 && item.right <= layout.innerWidth), `${label} clips a required item`);
    assert(layout.items.filter(item => ['btn-pause', 'btn-cancel', '+5', '+15', '+30'].includes(item.id)).every(item => item.height >= 48), `${label} shrinks a control below 48px`);
    assert(layout.items.every(item => item.bottom <= layout.scrollHeight + 1), `${label} has an unreachable item`);
    assert(layout.detailsTop >= layout.stopBottom, `${label} Details displaced primary controls`);
    assert(layout.scrollHeight >= layout.innerHeight, `${label} vertical layout is invalid`);
  }

  async function sendKey(keyCode, modifiers = []) {
    phone.show();
    phone.focus();
    phone.webContents.focus();
    if (!phone.webContents.debugger.isAttached()) phone.webContents.debugger.attach('1.3');
    const keys = {
      Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
      Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
      Tab: { key: 'Tab', code: 'Tab', vk: 9, text: '' },
      Escape: { key: 'Escape', code: 'Escape', vk: 27, text: '' }
    };
    const key = keys[keyCode];
    assert(key, `unsupported proof key ${keyCode}`);
    const modifierMask = modifiers.includes('shift') ? 8 : 0;
    const payload = { key: key.key, code: key.code, windowsVirtualKeyCode: key.vk,
      nativeVirtualKeyCode: key.vk, modifiers: modifierMask };
    await phone.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { ...payload, type: 'rawKeyDown' });
    if (key.text) {
      await phone.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        ...payload, type: 'char', text: key.text, unmodifiedText: key.text
      });
    }
    await phone.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { ...payload, type: 'keyUp' });
    await wait(25);
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

  await check('real masked WebSocket frames discard forged trusted fields', async () => {
    const before = await desktopEval('({ remaining: state.remainingSeconds, dryRun: state.dryRun, nightModeId: state.armedNightMode?.nightModeId || null, profileId: state.profileId })');
    const logBefore = commandLog.length;
    await sendRealWebSocketFrame({
      action: 'snooze', seconds: 300, dryRun: true,
      nightModeId: 'forged-mode', nightModeTitle: 'Forged Mode', nightModeVersion: 999,
      profileId: 'forged-profile', profileName: 'Forged Profile', forceShutdown: true,
      logout: true, hibernate: true
    });
    await waitFor(() => commandLog.length === logBefore + 1, 'validated forged frame did not reach main');
    const accepted = commandLog[logBefore];
    assert(JSON.stringify(accepted) === JSON.stringify({ action: 'snooze', seconds: 300 }), JSON.stringify(accepted));
    await waitFor(() => desktopEval(`state.remainingSeconds >= ${before.remaining + 298}`), 'allowed snooze did not execute');
    const after = await desktopEval('({ dryRun: state.dryRun, nightModeId: state.armedNightMode?.nightModeId || null, profileId: state.profileId })');
    assert(after.dryRun === before.dryRun && after.nightModeId === before.nightModeId && after.profileId === before.profileId, JSON.stringify(after));
  });

  await check('real WebSocket rejects unsupported remote power actions', async () => {
    const before = commandLog.length;
    for (const message of [
      { action: 'logout' },
      { action: 'hibernate' },
      { action: 'forceShutdown' },
      { action: 'force-shutdown' },
      { action: 'start', timerAction: 'logout', durationSeconds: 900 },
      { action: 'start', timerAction: 'hibernate', durationSeconds: 900 },
      { action: 'start', timerAction: 'force-shutdown', durationSeconds: 900, forceShutdown: true }
    ]) await sendRealWebSocketFrame(message);
    await wait(250);
    assert(commandLog.length === before, `unsupported frame crossed boundary: ${JSON.stringify(commandLog.slice(before))}`);
  });

  const viewports = [[320,700],[360,800],[390,844],[412,915],[430,932]];
  for (const [width, height] of viewports) {
    await check(`${width}px active layout has no clipping`, () => layoutAt(width, height, `01-active-${width}x${height}`));
  }

  phone.setContentSize(390, 844);
  await phoneEval("(() => { const panel = document.getElementById('details-panel'); panel.open = true; panel.scrollIntoView({ block: 'start' }); })()");
  await capture('03-details-open');
  await phoneEval("(() => { document.getElementById('details-panel').open = false; window.scrollTo(0, 0); })()");

  await phoneEval("(() => { const button = document.getElementById('btn-pause'); button.click(); button.click(); })()");
  await waitFor(() => desktopEval('state.paused === true'), 'desktop did not pause');
  await waitFor(() => phoneEval("document.getElementById('pending-status').classList.contains('show') === false"), 'pause pending state did not clear');
  await capture('04-paused');
  await check('Pause sends one toggle', () => assert(commandLog.filter(message => message.action === 'togglePause').length === 1, 'pause sent more than once'));
  await check('Pending Pause clears only after authoritative paused state', async () => {
    const value = await phoneEval("({ paused: latestState.paused, pending: pendingOperation })");
    assert(value.paused === true && value.pending === null, JSON.stringify(value));
  });

  let lastAddCommandDelta = 0;
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
    lastAddCommandDelta = afterCommands - beforeCommands;
    assert(lastAddCommandDelta === 1, `${seconds}s produced ${lastAddCommandDelta} messages`);
  }

  await check('+5 sends once and adds exactly 300 seconds', () => proveAdd(300, true));
  await check('rapid double-tap sends one add-time command', () => assert(lastAddCommandDelta === 1, 'double tap duplicated +5'));
  await check('+15 sends once and adds exactly 900 seconds', () => proveAdd(900));
  await check('+30 sends once and adds exactly 1800 seconds', () => proveAdd(1800));

  phone.show();
  phone.focus();
  await check('Snooze tap followed by Enter sends exactly once', async () => {
    const beforeRemaining = await desktopEval('state.remainingSeconds');
    const beforeCommands = commandLog.filter(message => message.action === 'snooze' && message.seconds === 900).length;
    await phoneEval("(() => { const button = document.querySelector('[data-add-seconds=\"900\"]'); button.focus(); button.click(); })()");
    await sendKey('Enter');
    await waitFor(() => desktopEval(`state.remainingSeconds === ${beforeRemaining + 900}`), 'Enter-race snooze did not apply once');
    await waitFor(() => phoneEval('pendingOperation === null'), 'Enter-race pending did not clear');
    const afterCommands = commandLog.filter(message => message.action === 'snooze' && message.seconds === 900).length;
    assert(afterCommands - beforeCommands === 1, `Enter race sent ${afterCommands - beforeCommands}`);
  });

  await check('touch event plus synthetic click sends exactly one Snooze', async () => {
    const beforeRemaining = await desktopEval('state.remainingSeconds');
    const beforeCommands = commandLog.filter(message => message.action === 'snooze' && message.seconds === 300).length;
    await phoneEval("(() => { const button = document.querySelector('[data-add-seconds=\"300\"]'); button.dispatchEvent(new Event('touchend', { bubbles: true })); button.click(); button.click(); })()");
    await waitFor(() => desktopEval(`state.remainingSeconds === ${beforeRemaining + 300}`), 'touch/synthetic snooze did not apply once');
    await waitFor(() => phoneEval('pendingOperation === null'), 'touch/synthetic pending did not clear');
    const afterCommands = commandLog.filter(message => message.action === 'snooze' && message.seconds === 300).length;
    assert(afterCommands - beforeCommands === 1, `touch/synthetic race sent ${afterCommands - beforeCommands}`);
  });

  await check('command timeout does not resend', async () => {
    const before = commandLog.length;
    await phoneEval("beginPending({ kind: 'proof-timeout', success: '', matches: () => false })");
    await wait(5200);
    const value = await phoneEval("({ text: pendingStatus.textContent, pending: pendingOperation })");
    assert(value.text === 'PC did not confirm the change' && value.pending === null, JSON.stringify(value));
    assert(commandLog.length === before, 'timeout resent or invented a command');
  });

  const resumeBefore = commandLog.filter(message => message.action === 'togglePause').length;
  await phoneEval("(() => { const button = document.getElementById('btn-pause'); button.focus(); button.click(); })()");
  await sendKey('Space');
  await sendKey('Space');
  await waitFor(() => desktopEval('state.paused === false'), 'desktop did not resume');
  await waitFor(() => phoneEval('pendingOperation === null'), 'resume pending state did not clear');
  await check('Resume tap plus repeated Space sends one toggle', () => assert(commandLog.filter(message => message.action === 'togglePause').length - resumeBefore === 1, 'resume toggle count changed'));
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

  const beforeGenerationState = await phoneEval("({ generation: socketGeneration, title: timerName.textContent, remaining: latestState.remainingSeconds })");
  await phoneEval('window.__proofOldOnMessage = ws.onmessage; true');
  suppressStateBroadcast = true;
  await phoneEval('connect()');
  await waitFor(() => phoneEval("statusText.textContent.includes('waiting for current PC state')"), 'replacement socket did not enter waiting state');
  await capture('06-reconnecting');
  await check('socket open without state remains stale and disabled', async () => {
    const value = await phoneEval("({ awaitingInitialState, authoritativeGeneration, lastStateReceivedAt, stale: document.body.classList.contains('stale-state'), disabled: [...document.querySelectorAll('.timer-mutation')].every(button => button.disabled), status: statusText.textContent, freshness: freshnessEl.textContent })");
    assert(value.awaitingInitialState && value.authoritativeGeneration === null && value.lastStateReceivedAt === 0, JSON.stringify(value));
    assert(value.stale && value.disabled && value.status.includes('waiting for current PC state') && value.freshness.includes('Waiting for current PC state'), JSON.stringify(value));
  });
  await check('replacement socket never inherits old freshness', async () => {
    const value = await phoneEval("({ generation: socketGeneration, authoritativeGeneration, fresh: stateIsAuthoritative() })");
    assert(value.generation > beforeGenerationState.generation && value.authoritativeGeneration === null && !value.fresh, JSON.stringify(value));
  });
  await check('obsolete socket message is ignored', async () => {
    await phoneEval(`window.__proofOldOnMessage({ data: JSON.stringify({ type: 'state', running: true, paused: false,
      remainingSeconds: 99999, totalSeconds: 99999, nightModeTitle: 'Obsolete Socket', dryRun: false, pcName: 'OLD-PC' }) })`);
    const value = await phoneEval("({ title: timerName.textContent, remaining: latestState.remainingSeconds, stale: document.body.classList.contains('stale-state'), pending: pendingOperation, fresh: stateIsAuthoritative() })");
    assert(value.title !== 'Obsolete Socket' && value.remaining === beforeGenerationState.remaining && value.stale && value.pending === null && !value.fresh, JSON.stringify(value));
  });
  suppressStateBroadcast = false;
  await waitFor(() => phoneEval("statusText.textContent === 'Connected' && stateIsAuthoritative()"), 'first current-generation state did not restore trust', 10000);
  await check('first current-generation state enables controls', async () => {
    const value = await phoneEval("({ fresh: stateIsAuthoritative(), stale: document.body.classList.contains('stale-state'), enabled: [...document.querySelectorAll('.timer-mutation')].every(button => !button.disabled) })");
    assert(value.fresh && !value.stale && value.enabled, JSON.stringify(value));
  });

  suppressStateBroadcast = true;
  const pauseDisconnectBefore = commandLog.filter(message => message.action === 'togglePause').length;
  await phoneEval("document.getElementById('toast').classList.remove('show'); document.getElementById('toast').textContent = ''; document.getElementById('btn-pause').click()");
  await waitFor(() => desktopEval('state.paused === true'), 'pause-before-disconnect did not reach desktop');
  await companion.stop();
  await waitFor(() => phoneEval("statusText.textContent === 'PC unavailable'"), 'pause disconnect did not go offline');
  await check('pending Pause disconnect never resends or claims success', async () => {
    await wait(350);
    const value = await phoneEval("({ pending: pendingOperation, toast: document.getElementById('toast').textContent, shown: document.getElementById('toast').classList.contains('show') })");
    const count = commandLog.filter(message => message.action === 'togglePause').length - pauseDisconnectBefore;
    assert(value.pending === null && !value.shown && value.toast !== 'Paused' && count === 1, JSON.stringify({ value, count }));
  });
  suppressStateBroadcast = false;
  companion.start({ token, host: '127.0.0.1' });
  await waitFor(() => phoneEval("stateIsAuthoritative() && latestState.paused === true"), 'reconnect did not show processed Pause', 10000);

  suppressStateBroadcast = true;
  const resumeDisconnectBefore = commandLog.filter(message => message.action === 'togglePause').length;
  await phoneEval("document.getElementById('toast').classList.remove('show'); document.getElementById('toast').textContent = ''; document.getElementById('btn-pause').click()");
  await waitFor(() => desktopEval('state.paused === false'), 'resume-before-disconnect did not reach desktop');
  await companion.stop();
  await waitFor(() => phoneEval("statusText.textContent === 'PC unavailable'"), 'resume disconnect did not go offline');
  await check('pending Resume disconnect never resends or claims success', async () => {
    await wait(350);
    const value = await phoneEval("({ pending: pendingOperation, toast: document.getElementById('toast').textContent, shown: document.getElementById('toast').classList.contains('show') })");
    const count = commandLog.filter(message => message.action === 'togglePause').length - resumeDisconnectBefore;
    assert(value.pending === null && !value.shown && value.toast !== 'Resumed' && count === 1, JSON.stringify({ value, count }));
  });
  suppressStateBroadcast = false;
  companion.start({ token, host: '127.0.0.1' });
  await waitFor(() => phoneEval("stateIsAuthoritative() && latestState.paused === false"), 'reconnect did not show processed Resume', 10000);

  const staleRemainingBeforeDesktopChange = await phoneEval('latestState.remainingSeconds');
  await companion.stop();
  await waitFor(() => phoneEval("statusText.textContent === 'PC unavailable'"), 'desktop-change proof did not go offline');
  await desktopEval(`window.electronAPI.startTimer(${JSON.stringify({ durationSeconds: 1200, action: 'sleep', dryRun: true, profileId: profile.id, nightModeId: 'quick-sleep' })})`);
  companion.start({ token, host: '127.0.0.1' });
  await waitFor(() => phoneEval("stateIsAuthoritative() && latestState.running && latestState.remainingSeconds <= 1200"), 'desktop-changed timer did not replace stale phone state', 10000);
  await check('desktop timer change while disconnected replaces old phone state', async () => {
    const value = await phoneEval("({ remaining: latestState.remainingSeconds, title: timerName.textContent, stale: document.body.classList.contains('stale-state') })");
    assert(value.remaining < staleRemainingBeforeDesktopChange && value.remaining <= 1200 && !value.stale, JSON.stringify(value));
  });

  await companion.stop();
  await waitFor(() => phoneEval("statusText.textContent === 'PC unavailable'"), 'completion proof did not go offline');
  await desktopEval('window.electronAPI.cancelTimer()');
  companion.start({ token, host: '127.0.0.1' });
  await waitFor(() => phoneEval("stateIsAuthoritative() && !latestState.running && !latestState.paused"), 'completed timer did not restore idle', 10000);
  await check('timer completion while disconnected restores honest idle', async () => {
    const value = await phoneEval("({ idle: timerLabel.textContent === 'Idle', activeHidden: activeControls.style.display === 'none', stale: document.body.classList.contains('stale-state') })");
    assert(value.idle && value.activeHidden && !value.stale, JSON.stringify(value));
  });

  await desktopEval(`window.electronAPI.startTimer(${JSON.stringify({ durationSeconds: 900, action: 'sleep', dryRun: true, profileId: profile.id, nightModeId: 'quick-sleep' })})`);
  await waitFor(() => phoneEval("stateIsAuthoritative() && latestState.running"), 'late-transition timer did not start');
  suppressStateBroadcast = true;
  const lateBefore = commandLog.filter(message => message.action === 'togglePause').length;
  await phoneEval("document.getElementById('toast').classList.remove('show'); document.getElementById('toast').textContent = ''; document.getElementById('btn-pause').click()");
  await waitFor(() => desktopEval('state.paused === true'), 'late transition did not reach desktop');
  await wait(5200);
  await check('timeout sends nothing further and remains uncertain', async () => {
    const value = await phoneEval("({ pending: pendingOperation, text: pendingStatus.textContent, shown: document.getElementById('toast').classList.contains('show') })");
    const count = commandLog.filter(message => message.action === 'togglePause').length - lateBefore;
    assert(value.pending === null && value.text === 'PC did not confirm the change' && !value.shown && count === 1, JSON.stringify({ value, count }));
  });
  suppressStateBroadcast = false;
  await waitFor(() => phoneEval("stateIsAuthoritative() && latestState.paused === true"), 'late authoritative transition did not render', 10000);
  await check('late authoritative transition renders without retrospective success', async () => {
    const value = await phoneEval("({ paused: latestState.paused, toast: document.getElementById('toast').textContent, shown: document.getElementById('toast').classList.contains('show') })");
    assert(value.paused && !value.shown && value.toast !== 'Paused', JSON.stringify(value));
  });

  await phoneEval("setConnectionState('connecting', 'Reconnecting')");
  await capture('07-offline-stale');
  await check('offline state disables timer mutation controls', async () => {
    const disabled = await phoneEval("[...document.querySelectorAll('.timer-mutation')].every(button => button.disabled)");
    assert(disabled, 'offline mutation control remained enabled');
  });
  await check('offline state marks prior state stale', async () => {
    const value = await phoneEval("({ stale: document.body.classList.contains('stale-state'), text: freshnessEl.textContent })");
    assert(value.stale && value.text.includes('State may be stale'), JSON.stringify(value));
  });
  await phoneEval('connect()');
  await waitFor(() => phoneEval("stateIsAuthoritative()"), 'phone did not recover after explicit reconnect', 10000);

  phone.setContentSize(320, 700);
  await phone.webContents.setZoomFactor(2);
  await wait(150);
  await phoneEval('window.scrollTo(0, 0)');
  await check('200% layout keeps every primary element reachable', () => assertReachableLayout('200% 320x700'));
  await capture('08-large-font-narrow-fallback');
  await phone.webContents.setZoomFactor(1);

  for (const [width, height] of [[844, 390], [700, 320]]) {
    phone.setContentSize(width, height);
    await wait(100);
    await phoneEval('window.scrollTo(0, 0)');
    await check(`${width}x${height} landscape keeps controls reachable`, () => assertReachableLayout(`${width}x${height}`));
    await phoneEval("document.getElementById('btn-cancel').click()");
    await waitFor(() => phoneEval("cancelConfirm.classList.contains('show')"), `${width}x${height} cancel dialog did not open`);
    await check(`${width}x${height} cancel dialog fits or scrolls safely`, async () => {
      const value = await phoneEval(`(() => {
        const card = document.querySelector('.confirm-card');
        const box = card.getBoundingClientRect();
        const stop = document.getElementById('cancel-stop').getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, innerHeight, scrollable: card.scrollHeight >= card.clientHeight,
          stopLeft: stop.left, stopRight: stop.right, innerWidth };
      })()`);
      assert(value.top >= 0 && value.bottom <= value.innerHeight && value.stopLeft >= 0 && value.stopRight <= value.innerWidth && value.scrollable, JSON.stringify(value));
    });
    await capture(`10-landscape-${width}x${height}`);
    await phoneEval("document.getElementById('cancel-keep').click()");
  }

  phone.setContentSize(390, 844);
  await wait(2100);

  await phoneEval('window.scrollTo(0, 0)');
  const cancelBeforeKeyboardDismiss = commandLog.filter(message => message.action === 'cancel').length;
  await phoneEval("document.getElementById('btn-cancel').focus()");
  await sendKey('Enter');
  await waitFor(() => phoneEval("cancelConfirm.classList.contains('show')"), 'keyboard did not open cancel confirmation');
  await check('cancel modal starts inside dialog and makes background inert', async () => {
    const value = await phoneEval("({ focus: document.activeElement.id, inert: appShell.inert, hidden: appShell.getAttribute('aria-hidden'), dialogHidden: cancelConfirm.getAttribute('aria-hidden') })");
    assert(value.focus === 'cancel-keep' && value.inert && value.hidden === 'true' && value.dialogHidden === 'false', JSON.stringify(value));
  });
  await sendKey('Tab');
  await waitFor(() => phoneEval("document.activeElement.id === 'cancel-stop'"), 'Tab did not move to Stop');
  await sendKey('Tab');
  await waitFor(() => phoneEval("document.activeElement.id === 'cancel-keep'"), 'Tab escaped dialog');
  await sendKey('Tab', ['shift']);
  await waitFor(() => phoneEval("document.activeElement.id === 'cancel-stop'"), 'Shift+Tab did not reverse within dialog');
  await check('Tab and Shift+Tab remain inside the two modal actions', async () => {
    const value = await phoneEval("({ focus: document.activeElement.id, backgroundFocused: document.activeElement.closest('#app-shell') !== null })");
    assert(value.focus === 'cancel-stop' && !value.backgroundFocused, JSON.stringify(value));
  });
  await sendKey('Escape');
  await waitFor(() => phoneEval("!cancelConfirm.classList.contains('show')"), 'Escape did not close dialog');
  await check('Escape sends nothing and restores focus to opener', async () => {
    const focus = await phoneEval('document.activeElement.id');
    const count = commandLog.filter(message => message.action === 'cancel').length - cancelBeforeKeyboardDismiss;
    assert(focus === 'btn-cancel' && count === 0, JSON.stringify({ focus, count }));
  });

  await phoneEval("document.getElementById('btn-cancel').focus()");
  await sendKey('Enter');
  await waitFor(() => phoneEval("cancelConfirm.classList.contains('show')"), 'connection-loss dialog did not open');
  await companion.stop();
  await waitFor(() => phoneEval("statusText.textContent === 'PC unavailable'"), 'dialog connection-loss state missing');
  await check('connection loss keeps modal contained and disables Stop', async () => {
    const value = await phoneEval("({ open: cancelConfirm.classList.contains('show'), inert: appShell.inert, disabled: document.getElementById('cancel-stop').disabled, unavailable: !cancelConnectionStatus.hidden, focus: document.activeElement.id })");
    assert(value.open && value.inert && value.disabled && value.unavailable && value.focus === 'cancel-keep', JSON.stringify(value));
  });
  companion.start({ token, host: '127.0.0.1' });
  await waitFor(() => phoneEval("stateIsAuthoritative() && !document.getElementById('cancel-stop').disabled"), 'dialog did not recover after current state', 10000);
  await check('current state re-enables modal Stop without leaving dialog', async () => {
    const value = await phoneEval("({ open: cancelConfirm.classList.contains('show'), inert: appShell.inert, unavailable: !cancelConnectionStatus.hidden })");
    assert(value.open && value.inert && !value.unavailable, JSON.stringify(value));
  });
  await phoneEval("document.getElementById('cancel-keep').click()");
  await waitFor(() => phoneEval("document.activeElement.id === 'btn-cancel'"), 'Keep Running did not restore opener focus');

  await phoneEval("document.getElementById('btn-cancel').focus()");
  await sendKey('Enter');
  await waitFor(() => phoneEval("cancelConfirm.classList.contains('show') && document.activeElement.id === 'cancel-keep'"), 'final keyboard dialog did not open');
  await capture('09-cancel-confirmation');
  await check('cancel confirmation names run, PC, remaining time, and consequence', async () => {
    const copy = await phoneEval('cancelCopy.textContent');
    assert(copy.includes('Quick Sleep') && copy.includes(os.hostname()) && copy.includes('remaining') && copy.includes('stop the timer'), copy);
  });
  const cancelBefore = commandLog.filter(message => message.action === 'cancel').length;
  await sendKey('Tab');
  await waitFor(() => phoneEval("document.activeElement.id === 'cancel-stop'"), 'keyboard did not reach final Stop');
  await sendKey('Enter');
  await sendKey('Enter');
  await sendKey('Space');
  await waitFor(() => desktopEval('state.running === false && state.paused === false'), 'desktop did not cancel');
  await waitFor(() => phoneEval('pendingOperation === null'), 'cancel pending state did not clear');
  await check('keyboard and repeated activation send one Cancel', () => assert(commandLog.filter(message => message.action === 'cancel').length - cancelBefore === 1, 'cancel duplicated'));
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
