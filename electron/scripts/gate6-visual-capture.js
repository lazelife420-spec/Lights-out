#!/usr/bin/env node
// Gate 6 visual capture helper: walk major surfaces and save screenshots.
// Usage: node scripts/gate6-visual-capture.js [out-dir]

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const EXE_PATH = process.env.LIGHTS_OUT_NATIVE_EXE
  ? path.resolve(process.env.LIGHTS_OUT_NATIVE_EXE)
  : path.resolve(__dirname, '..', '..', 'dist-native', 'win-unpacked', 'Lights Out.exe');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function getCdpList(port) {
  const raw = await httpGet(`http://127.0.0.1:${port}/json/list`);
  return JSON.parse(raw);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function directoryIdentity(rootDir) {
  const entries = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) walk(absolute);
      else if (item.isFile()) {
        entries.push({
          path: path.relative(rootDir, absolute).split(path.sep).join('/'),
          bytes: fs.statSync(absolute).size,
          sha256: sha256(absolute)
        });
      }
    }
  }
  walk(rootDir);
  const digest = crypto.createHash('sha256');
  for (const entry of entries) digest.update(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`);
  return { root: rootDir, fileCount: entries.length, sha256: digest.digest('hex').toUpperCase() };
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.on('message', data => this.onMessage(data));
  }
  onMessage(data) {
    const msg = JSON.parse(data);
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) { const e = new Error(msg.error.message); e.cdpError = msg.error; p.reject(e); }
        else p.resolve(msg.result);
      }
    }
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async screenshot() {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(r.data, 'base64');
  }
  close() { try { this.ws.close(); } catch {} }
}

async function connectCdp(port) {
  const deadline = Date.now() + 20000;
  let page = null;
  while (Date.now() < deadline) {
    try {
      const list = await getCdpList(port);
      page = list.find(p => p.type === 'page' && /index\.html/.test(p.url));
      if (page) break;
    } catch {}
    await wait(250);
  }
  if (!page) throw new Error('No renderer page target found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  const session = new CdpSession(ws);
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  return session;
}

async function stopApp(child) {
  return new Promise(resolve => {
    if (!child) return resolve();
    try { child.kill(); } catch {}
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
    killer.on('error', () => {});
    killer.on('close', () => resolve());
    setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch {} resolve(); }, 1200);
  });
}

async function main() {
  if (!fs.existsSync(EXE_PATH)) throw new Error(`Packaged exe not found: ${EXE_PATH}`);
  const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-gate6-visual-'));
  fs.mkdirSync(outDir, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-gate6-userdata-'));
  const port = 9722;

  const child = spawn(EXE_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox'
  ], { detached: true, env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1' } });

  const session = await connectCdp(port);
  await wait(1500);

  // This proof uses an isolated profile so the app's real user data is never
  // touched. Dismiss the first-run overlay for the walkthrough without saving
  // invented onboarding answers into that profile; Gate 6 captures product
  // surfaces, while onboarding has its own canonical coverage.
  await session.eval(`{
    const onboarding = document.getElementById('onboarding');
    if (onboarding) onboarding.style.display = 'none';
  }`);
  await wait(250);

  const routeMap = {
    home: 'home',
    lib: 'tonight',
    modes: 'library',
    sch: 'schedule',
    dev: 'devices',
    stats: 'proof',
    set: 'settings',
    help: 'help'
  };

  const captureLog = [];
  async function capture(name, setupExpr) {
    if (setupExpr) await session.eval(setupExpr);
    await wait(400);
    const buf = await session.screenshot();
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, buf);
    captureLog.push({ name, file, sha256: sha256(file), bytes: buf.length });
  }

  // Resize to a normal desktop size for consistency.
  await session.eval('window.resizeTo(1180, 820)');
  await wait(500);

  await capture('01-home');

  for (const [tab, label] of Object.entries(routeMap)) {
    if (tab === 'home') continue;
    await session.eval(`{ const el = document.querySelector('.ns-nav-item[data-ns-tab="${tab}"]'); if (el) el.click(); }`);
    await wait(600);
    await capture(`02-${label}`);
  }

  // Help opens the branded About surface. Close it before capturing Settings
  // categories and minimum-size page layouts so modal state cannot leak into
  // unrelated evidence.
  await session.eval(`{
    const close = document.getElementById('about-modal-close');
    if (close) close.click();
    const settings = document.querySelector('.ns-nav-item[data-ns-tab="set"]');
    if (settings) settings.click();
  }`);
  await wait(250);

  // Settings categories
  const categories = await session.eval(`Array.from(document.querySelectorAll('.settings-rail-btn')).map(b => ({ id: b.dataset.settingsCategory, label: b.textContent.trim() }))`);
  for (const cat of categories) {
    await session.eval(`{ const b = document.querySelector('.settings-rail-btn[data-settings-category="${cat.id}"]'); if (b) b.click(); }`);
    await wait(400);
    await capture(`03-settings-${cat.id}`);
  }

  // Secondary product destinations required by the Gate 6 walkthrough.
  await session.eval(`{
    const schedule = document.querySelector('.ns-nav-item[data-ns-tab="sch"]');
    if (schedule) schedule.click();
    const automations = document.querySelector('.tab-btn[data-tab="automations"]');
    if (automations) automations.click();
  }`);
  await wait(500);
  await capture('03-schedule-first-light');

  await session.eval(`{
    const proof = document.querySelector('.ns-nav-item[data-ns-tab="stats"]');
    if (proof) proof.click();
    const history = document.querySelector('.tab-btn[data-tab="proof-history"]');
    if (history) history.click();
  }`);
  await wait(400);
  await capture('03-proof-history');
  await session.eval(`{
    const activity = document.querySelector('.tab-btn[data-tab="proof-activity"]');
    if (activity) activity.click();
  }`);
  await wait(400);
  await capture('03-proof-activity');

  // Exercise the real arming and timer paths in explicit Dry Run mode. This
  // isolated profile never executes a Windows power action, and the running
  // timer is cancelled immediately after its visual evidence is captured.
  await session.eval(`{
    const tonight = document.querySelector('.ns-nav-item[data-ns-tab="lib"]');
    if (tonight) tonight.click();
    state.dryRun = true;
    render();
    const arm = document.getElementById('btn-arm-custom');
    if (arm) arm.click();
  }`);
  await wait(500);
  await capture('03-tonight-armed-dry-run');
  await session.eval(`{
    const start = document.getElementById('btn-start-custom');
    if (start) start.click();
  }`);
  await wait(1000);
  await capture('03-tonight-running-dry-run');
  await session.eval(`(async () => {
    await api.cancelTimer();
    state.running = false;
    state.paused = false;
    state.endsAt = null;
    render();
    return true;
  })()`);
  await wait(400);

  // Minimum practical size
  await session.eval('window.resizeTo(780, 600)');
  await wait(400);
  await session.eval(`{ const el = document.querySelector('.ns-nav-item[data-ns-tab="home"]'); if (el) el.click(); }`);
  await wait(400);
  await capture('04-home-minimum');

  await session.eval(`{ const el = document.querySelector('.ns-nav-item[data-ns-tab="lib"]'); if (el) el.click(); }`);
  await wait(400);
  await capture('05-lib-minimum');

  // Proof empty state (no artificial data)
  await session.eval(`{ const el = document.querySelector('.ns-nav-item[data-ns-tab="stats"]'); if (el) el.click(); }`);
  await wait(400);
  await capture('06-proof-empty');

  // About/help modal
  await session.eval(`{ const el = document.getElementById('menu-help'); if (el) el.click(); }`);
  await wait(400);
  await capture('07-help-menu');

  session.close();
  await stopApp(child);
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const manifest = {
    exePath: EXE_PATH,
    exeSha256: sha256(EXE_PATH),
    packagedApp: directoryIdentity(path.join(path.dirname(EXE_PATH), 'resources', 'app')),
    realPowerActions: 0,
    outDir,
    captures: captureLog
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Gate 6 visual baseline captured to: ${outDir}`);
  console.log(`Captures: ${captureLog.map(c => c.name).join(', ')}`);
}

main().catch(error => {
  console.error('Visual capture failed:', error);
  process.exit(1);
});
