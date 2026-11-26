'use strict';

// Product-page screenshots from the real packaged app (or --source).
//
// Safety: an isolated throwaway profile (--user-data-dir), the QA power lock
// (every real power action is blocked and receipted as blocked), Test Mode
// seeded on, tray suppressed, and no LAN features enabled. The only timer it
// starts is a Test Mode countdown that it cancels a second later. Input events
// are ignored so the owner's mouse/keyboard never drives the QA window.
//
// Output: docs/assets/product/<name>.png and .webp (resized with sharp).
// Usage: node scripts/capture-product-screenshots.js [--source] [--out <dir>]

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const source = process.argv.includes('--source');
const outIndex = process.argv.indexOf('--out');
const outDir = path.resolve(outIndex > 0 ? process.argv[outIndex + 1] : path.join(__dirname, '..', '..', 'docs', 'assets', 'product'));
const VIEWPORT = { width: 1180, height: 1000, deviceScaleFactor: 2 };
const OUTPUT_WIDTH = 1600;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function executable() {
  if (source) return require('electron');
  return require('./packaged-artifact-resolver').requirePackagedArtifact().executable;
}

// Two weeks of illustrative history for the Proof screen (sample data in a
// throwaway profile; it never touches a real profile).
function sampleReceipts(now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  const plan = [
    [1, 'command_returned_success', false, 'sleep', 'Quick Sleep', 0],
    [2, 'command_returned_success', false, 'sleep', 'Movie Wind-Down', 1],
    [3, 'dry_run_completed', true, 'sleep', 'Lights Down', 0],
    [4, 'command_returned_success', false, 'shutdown', 'Full Shutdown', 0],
    [5, 'cancelled', false, 'sleep', 'Quick Sleep', 0],
    [6, 'command_returned_success', false, 'sleep', 'Lights Down', 0],
    [7, 'command_returned_success', false, 'sleep', 'Quick Sleep', 2],
    [9, 'command_returned_success', false, 'shutdown', 'Full Shutdown', 0],
    [10, 'missed', false, 'sleep', null, 0],
    [11, 'command_returned_success', false, 'sleep', 'Movie Wind-Down', 0],
    [12, 'command_returned_success', false, 'sleep', 'Quick Sleep', 1],
    [13, 'dry_run_completed', true, 'sleep', 'Quick Sleep', 0]
  ];
  // The app treats the last receipt as the latest, so oldest first.
  return plan.slice().reverse().map(([ago, result, dryRun, action, title, snoozes], i) => {
    const start = new Date(now - ago * day);
    start.setHours(22, 40 + (i % 3) * 10, 0, 0);
    const ended = new Date(start.getTime() + 45 * 60 * 1000);
    return {
      id: `r_${start.getTime()}_${(0x5f3a1 + i * 7919).toString(36)}`, version: 2, startedAt: start.toISOString(), plannedEndsAt: ended.toISOString(),
      timerElapsedAt: result === 'cancelled' || result === 'missed' ? null : ended.toISOString(),
      endedAt: ended.toISOString(), action, profileId: null, profileName: null,
      nightModeId: null, nightModeTitle: title, nightModeVersion: null, durationSeconds: 2700,
      origin: title ? 'night-mode' : 'calendar', routineOccurrenceKey: null, remainingSeconds: result === 'cancelled' ? 900 : 0,
      dryRun, forceShutdown: false, gracefulClose: true, result, pauseCount: 0, snoozeCount: snoozes,
      cancelReason: null, warningsShown: 1, lastLightSequence: null, powerCommand: null, notes: null
    };
  });
}

function seedProfile(dir) {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    app: { dryRun: true, onboarded: true, sound: 'Off', durationSeconds: 45 * 60, action: 'sleep', graceMinutes: 2 },
    calendar: {
      enabled: true, autoStartFromEvents: false,
      builtin: { rules: [
        { id: 'weeknights', label: 'Weeknights', time: '23:00', days: ['sun', 'mon', 'tue', 'wed', 'thu'], action: 'sleep', durationMinutes: 45, enabled: true },
        { id: 'weekend', label: 'Weekend', time: '00:30', days: ['fri', 'sat'], action: 'sleep', durationMinutes: 60, enabled: true },
        { id: 'early', label: 'Early start', time: '22:15', days: ['tue'], action: 'shutdown', durationMinutes: 30, enabled: false }
      ] }
    },
    companion: { enabled: false }, family: { enabled: false }, remoteControl: { enabled: false, mode: 'off' },
    smartLights: { enabled: false }, wifiGuard: { enabled: false }, contentBlocker: { enabled: false }
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'run-receipts.json'), JSON.stringify({ receipts: sampleReceipts() }, null, 2));
}

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await wait(100); }
  throw new Error(message);
}

async function main() {
  const sharp = require('sharp');
  fs.mkdirSync(outDir, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-product-shots-'));
  seedProfile(userData);
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--no-auto-start', '--disable-features=CalculateNativeWinOcclusion'];
  if (source) args.unshift(path.resolve(__dirname, '..'));
  const env = { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1', LIGHTS_OUT_QA_POWER_LOCK: '1' };
  if (env.LIGHTS_OUT_QA_POWER_LOCK !== '1') throw new Error('refusing to run without the QA power lock');
  const child = spawn(executable(), args, { windowsHide: true, stdio: 'ignore', env });
  let ws;
  try {
    let page;
    await until(async () => {
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page'); return Boolean(page); }
      catch { return false; }
    }, 'Lights Out page did not become ready');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    let id = 0;
    const pending = new Map();
    ws.on('message', data => {
      const message = JSON.parse(data);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result?.value;
    };
    await send('Runtime.enable');
    await send('Input.setIgnoreInputEvents', { ignore: true });
    await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false });
    await until(() => evaluate(`typeof api !== 'undefined' && state.settingsLoaded === true`), 'Settings did not load');
    // Hide transient toasts so a shot never shows a notification.
    await evaluate(`(() => { const s = document.createElement('style'); s.textContent = '.toast, .toast-stack, .notify, .notification-toast, [class*="toast"] { display: none !important; }'; document.head.appendChild(s); })()`);

    const shoot = async name => {
      await wait(700);
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const raw = Buffer.from(data, 'base64');
      const resized = sharp(raw).resize({ width: OUTPUT_WIDTH });
      await resized.clone().png({ compressionLevel: 9, palette: false }).toFile(path.join(outDir, `${name}.png`));
      await resized.clone().webp({ quality: 84 }).toFile(path.join(outDir, `${name}.webp`));
      const meta = await sharp(path.join(outDir, `${name}.png`)).metadata();
      console.log(`  ${name}: ${meta.width}x${meta.height}`);
      return meta;
    };
    const tab = async name => { await evaluate(`document.querySelector('[data-ns-tab="${name}"]').click()`); await wait(400); };

    const sizes = {};
    await tab('lib');
    sizes.tonight = await shoot('tonight');
    await tab('modes');
    sizes['night-modes'] = await shoot('night-modes');
    await tab('sch');
    sizes.schedule = await shoot('schedule');
    await tab('stats');
    sizes.proof = await shoot('proof');
    // A Test Mode countdown (QA power lock also on), cancelled right after.
    await tab('lib');
    await evaluate(`window.electronAPI.startTimer({ durationSeconds: 2700, action: 'sleep', dryRun: true, forceShutdown: false })`);
    await until(() => evaluate(`state.running === true`), 'Test Mode countdown did not start');
    await wait(1500);
    sizes.running = await shoot('running');
    await evaluate(`window.electronAPI.cancelTimer()`);
    console.log(`  sizes: ${Object.entries(sizes).map(([k, m]) => `${k} ${m.width}x${m.height}`).join(', ')}`);
    console.log(`Product screenshots written to ${outDir}`);
  } finally {
    try { ws?.close(); } catch {}
    try { child.kill(); } catch {}
    await wait(500);
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
