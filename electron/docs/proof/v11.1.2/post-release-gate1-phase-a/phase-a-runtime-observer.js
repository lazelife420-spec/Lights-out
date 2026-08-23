#!/usr/bin/env node
'use strict';

const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require(path.join(process.env.LIGHTS_OUT_NODE_MODULES, 'ws'));

const mode = process.argv[2];
const exe = path.resolve(process.argv[3]);
const outputDir = path.resolve(process.argv[4]);
if (!['first-launch', 'updater'].includes(mode) || !fs.existsSync(exe)) {
  throw new Error('Usage: phase-a-runtime-observer.js <first-launch|updater> <exe> <output-dir>');
}
fs.mkdirSync(outputDir, { recursive: true });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const get = url => new Promise((resolve, reject) => {
  http.get(url, response => {
    let body = '';
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve(body));
  }).on('error', reject);
});
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 15000).unref();
    });
  }
  async eval(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'evaluation failed');
    return response.result.value;
  }
  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outputDir, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return { file, bytes: fs.statSync(file).size, sha256: sha256(file) };
  }
}

async function connect(port) {
  let targets;
  for (let i = 0; i < 720; i++) {
    try {
      targets = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
      if (targets.some(target => target.type === 'page' && target.webSocketDebuggerUrl)) break;
    } catch {}
    await delay(250);
  }
  const target = targets?.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!target) throw new Error('Renderer target was not available');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  await cdp.eval(`new Promise(resolve => {
    const done = () => document.readyState === 'complete' && document.body ? resolve(true) : setTimeout(done, 100);
    done();
  })`);
  return cdp;
}

async function launch(userData) {
  const startedAt = Date.now();
  const port = await freePort();
  const child = spawn(exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-auto-start',
    '--no-force',
    '--dry-run'
  ], {
    detached: true,
    windowsHide: true,
    env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1' },
    stdio: 'ignore'
  });
  child.unref();
  const cdp = await connect(port);
  return { child, port, cdp, startupMs: Date.now() - startedAt };
}

async function stop(run) {
  try { await run.cdp.eval(`window.api?.quitApp?.()`); } catch {}
  try { run.cdp.ws.close(); } catch {}
  for (let i = 0; i < 40; i++) {
    try { process.kill(run.child.pid, 0); await delay(100); } catch { return; }
  }
  if (process.platform === 'win32') {
    try { execFileSync('taskkill.exe', ['/PID', String(run.child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  } else {
    try { process.kill(-run.child.pid); } catch {}
  }
  await delay(300);
}

async function firstLaunch() {
  const attachPort = Number(process.env.LIGHTS_OUT_ATTACH_PORT || 0);
  const attachPid = Number(process.env.LIGHTS_OUT_ATTACH_PID || 0);
  const userData = process.env.LIGHTS_OUT_ATTACH_USERDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-phasea-first-'));
  const report = { mode, exe, exeSha256: sha256(exe), userData, screenshots: [], observations: {}, realPowerActions: 0 };
  const first = attachPort && attachPid
    ? { child: { pid: attachPid }, port: attachPort, cdp: await connect(attachPort), startupMs: null }
    : await launch(userData);
  report.observations.attachedAfterColdStartup = Boolean(attachPort && attachPid);
  report.observations.firstStartupMs = first.startupMs;
  try {
    await first.cdp.eval(`new Promise(resolve => {
      const ready = () => getComputedStyle(document.getElementById('onboarding')).display === 'flex' ? resolve(true) : setTimeout(ready, 100);
      ready();
    })`);
    report.screenshots.push(await first.cdp.screenshot('01-genuine-first-launch.png'));
    report.observations.firstLaunch = await first.cdp.eval(`({
      title: document.title,
      onboardingDisplay: getComputedStyle(document.getElementById('onboarding')).display,
      onboardingHeading: document.querySelector('#onboard-step-1 h2')?.textContent?.trim(),
      onboardingCopy: document.querySelector('#onboard-step-1 .onboarding-sub')?.textContent?.trim(),
      nextLabel: document.getElementById('onboard-next')?.textContent?.trim(),
      version: document.getElementById('version')?.textContent?.trim(),
      nav: [...document.querySelectorAll('.ns-nav-item')].map(x => x.textContent.trim()),
      bodyOverflow: getComputedStyle(document.body).overflow
    })`);
    await first.cdp.eval(`document.querySelector('[data-bed="22:00"]').click(); document.getElementById('onboard-next').click(); true`);
    report.screenshots.push(await first.cdp.screenshot('02-onboarding-focus.png'));
    await first.cdp.eval(`document.querySelector('[data-focus=""]').click(); document.getElementById('onboard-next').click(); true`);
    report.screenshots.push(await first.cdp.screenshot('03-onboarding-ritual.png'));
    await first.cdp.eval(`document.querySelector('[data-seq="ClassicFade"]').click(); document.getElementById('onboard-next').click(); true`);
    await delay(600);
    report.screenshots.push(await first.cdp.screenshot('04-first-home.png'));
    report.observations.afterOnboarding = await first.cdp.eval(`({
      onboardingDisplay: getComputedStyle(document.getElementById('onboarding')).display,
      version: document.getElementById('version')?.textContent?.trim(),
      activeRoute: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab,
      running: typeof state !== 'undefined' && Boolean(state.running),
      bodyTextHasMissing: /undefined|null|module not found/i.test(document.body.innerText)
    })`);
    report.observations.firstEvents = first.cdp.events.filter(event => ['Runtime.exceptionThrown', 'Log.entryAdded'].includes(event.method));
  } finally {
    await stop(first);
  }
  const second = await launch(userData);
  report.observations.relaunchStartupMs = second.startupMs;
  try {
    await delay(750);
    report.screenshots.push(await second.cdp.screenshot('05-relaunch-persisted.png'));
    report.observations.relaunch = await second.cdp.eval(`(async () => ({
      onboardingDisplay: getComputedStyle(document.getElementById('onboarding')).display,
      version: document.getElementById('version')?.textContent?.trim(),
      settings: await api.getAppSettings(),
      running: typeof state !== 'undefined' && Boolean(state.running)
    }))()`);
    report.observations.secondEvents = second.cdp.events.filter(event => ['Runtime.exceptionThrown', 'Log.entryAdded'].includes(event.method));
  } finally {
    await stop(second);
  }
  fs.writeFileSync(path.join(outputDir, 'first-launch-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

async function updater() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-phasea-updater-'));
  const report = { mode, exe, exeSha256: sha256(exe), userData, screenshots: [], observations: {}, realPowerActions: 0 };
  const run = await launch(userData);
  report.startupMs = run.startupMs;
  try {
    const result = await run.cdp.eval(`(async () => {
      const onboarding = document.getElementById('onboarding');
      if (onboarding) onboarding.style.display = 'none';
      const update = await api.checkForUpdate();
      renderUpdaterStatus(update);
      const modal = document.getElementById('about-modal');
      if (modal) modal.style.display = 'flex';
      return {
        update,
        runtimeVersion: await api.getAppVersion(),
        visibleVersion: document.getElementById('about-version')?.textContent?.trim(),
        updaterText: document.getElementById('updater-status-text')?.textContent?.trim(),
        downloadHref: document.getElementById('updater-download')?.href,
        downloadVisible: getComputedStyle(document.getElementById('updater-download')).display
      };
    })()`);
    report.observations = result;
    report.screenshots.push(await run.cdp.screenshot('v11.1.0-updater-result.png'));
    report.events = run.cdp.events.filter(event => ['Runtime.exceptionThrown', 'Log.entryAdded'].includes(event.method));
  } finally {
    await stop(run);
  }
  fs.writeFileSync(path.join(outputDir, 'updater-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

(mode === 'first-launch' ? firstLaunch() : updater()).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
