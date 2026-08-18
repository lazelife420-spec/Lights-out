#!/usr/bin/env node
// Pass 5E-C QA evidence walkthrough: real source Electron runtime, isolated
// userData, CDP screenshots. Covers Connected Settings Context:
//   Devices -> Smart Lights (breadcrumb + correct category) -> Devices ->
//   Phone Companion -> Home glance tile -> Wi-Fi Guard -> Status & Safety ->
//   Power & Safety -> Close returns to the origin page each time.
//
// Safety: only opens Settings from real navigation entry points and closes
// it -- never touches Start Custom Timer, Begin Ritual, chips, Quick
// plans, or any Play/Power control.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const ELECTRON_ROOT = path.resolve(__dirname, '..');
const ELECTRON_EXE = path.join(ELECTRON_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const WAIT = ms => new Promise(r => setTimeout(r, ms));

const evidenceDir = process.env.LIGHTS_OUT_QA_EVIDENCE_DIR
  ? path.resolve(process.env.LIGHTS_OUT_QA_EVIDENCE_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5ec-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

function log(msg) { console.log(`[qa-pass5e-c] ${msg}`); }

function cdpList(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.setTimeout(2000, () => { req.destroy(); reject(new Error('cdp list timeout')); });
    req.on('error', reject);
  });
}

class CdpSession {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 1; this.pending = new Map(); }
  async connect() {
    await new Promise((resolve, reject) => { this.ws.on('open', resolve); this.ws.on('error', reject); });
    this.ws.on('message', d => this.onMessage(d));
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  onMessage(data) {
    const m = JSON.parse(data);
    if (m.id && this.pending.has(m.id)) {
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message)); else res(m.result);
    }
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const i = this.id++;
      this.pending.set(i, { res, rej });
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  eval(expr) {
    return this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      .then(r => r.result.value);
  }
  async screenshot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(r.data, 'base64');
    const p = path.join(evidenceDir, name);
    fs.writeFileSync(p, buf);
    log(`captured ${name} (${buf.length} bytes)`);
    return p;
  }
  async waitForReady(timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ready = await this.eval(`window.__desktopUxProof ? window.__desktopUxProof.ready === true : (document.readyState === 'complete' && typeof handleSidebarNavigation === 'function')`);
      if (ready) return;
      await WAIT(150);
    }
    throw new Error('renderer never became ready');
  }
  close() { this.ws.close(); }
}

async function launch() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5ec-userdata-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { dryRun: true, forceShutdown: false, nsActiveTab: 'home', onboarded: true }
  }));
  fs.writeFileSync(path.join(userData, 'run-receipts.json'), JSON.stringify({ receipts: [] }, null, 2));

  const port = 9333 + Math.floor(Math.random() * 500);
  const child = spawn(ELECTRON_EXE, [
    ELECTRON_ROOT,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-sandbox', '--disable-gpu', '--no-auto-start', '--desktop-ux-proof'
  ], { windowsHide: true, env: { ...process.env, LIGHTS_OUT_DESKTOP_UX_GATE: '1' } });

  let list = [];
  for (let i = 0; i < 60; i++) {
    try { list = await cdpList(port); if (list.length) break; } catch { /* retry */ }
    await WAIT(250);
  }
  if (!list.length) throw new Error('Electron never exposed CDP');
  const page = list.find(x => x.type === 'page') || list[0];
  const session = new CdpSession(page.webSocketDebuggerUrl);
  await session.connect();
  await session.waitForReady();
  return { session, child, userData };
}

async function teardown({ session, child, userData }) {
  if (session) session.close();
  try { child.kill(); } catch { /* best-effort */ }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* best-effort */ }
}

async function main() {
  if (!fs.existsSync(ELECTRON_EXE)) throw new Error(`Electron binary missing: ${ELECTRON_EXE}`);

  log('launching (dryRun:true)');
  const ctx = await launch();
  try {
    const { session } = ctx;

    // 1. Devices -> Smart Lights.
    await session.eval(`document.querySelector('[data-ns-tab="dev"]').click()`);
    await WAIT(300);
    await session.eval(`document.getElementById('btn-dev-lights')?.click()`);
    await WAIT(200);
    await session.screenshot('01-devices-smart-lights-context.png');
    let snap = await session.eval(`JSON.stringify({
      breadcrumb: document.getElementById('settings-context-breadcrumb')?.textContent,
      breadcrumbVisible: document.getElementById('settings-context-breadcrumb')?.style.display !== 'none',
      activeCategory: document.querySelector('.settings-rail-btn.active')?.dataset.settingsCategory
    })`);
    log(`Devices -> Smart Lights: ${snap}`);

    // 2. Close -- must return to Devices, not Home/Tonight.
    await session.eval(`document.getElementById('modal-close')?.click()`);
    await WAIT(200);
    snap = await session.eval(`JSON.stringify({ activePanel: document.querySelector('.ns-nav-item.active')?.dataset.nsTab })`);
    log(`after Close: ${snap}`);
    await session.screenshot('02-closed-returns-to-devices.png');

    // 3. Devices -> Phone Companion.
    await session.eval(`document.getElementById('btn-dev-companion')?.click()`);
    await WAIT(200);
    await session.screenshot('03-devices-phone-companion-context.png');
    snap = await session.eval(`JSON.stringify({
      breadcrumb: document.getElementById('settings-context-breadcrumb')?.textContent,
      activeCategory: document.querySelector('.settings-rail-btn.active')?.dataset.settingsCategory
    })`);
    log(`Devices -> Phone Companion: ${snap}`);
    await session.eval(`document.getElementById('modal-close')?.click()`);

    // 4. Home glance tile -> Wi-Fi Guard.
    await session.eval(`document.querySelector('[data-ns-tab="home"]').click()`);
    await WAIT(200);
    await session.eval(`document.getElementById('ta-glance-wifi')?.click()`);
    await WAIT(200);
    await session.screenshot('04-home-glance-wifi-context.png');
    snap = await session.eval(`JSON.stringify({
      breadcrumb: document.getElementById('settings-context-breadcrumb')?.textContent,
      activeCategory: document.querySelector('.settings-rail-btn.active')?.dataset.settingsCategory
    })`);
    log(`Home glance -> Wi-Fi Guard: ${snap}`);
    await session.eval(`document.getElementById('modal-close')?.click()`);
    await WAIT(200);
    snap = await session.eval(`JSON.stringify({ activePanel: document.querySelector('.ns-nav-item.active')?.dataset.nsTab })`);
    log(`after Close (from Home): ${snap}`);

    // 5. Status & Safety -> Open full Settings -> Power & Safety.
    await session.eval(`document.getElementById('menu-settings').click()`);
    await WAIT(150);
    await session.eval(`document.getElementById('open-options')?.click()`);
    await WAIT(200);
    await session.screenshot('05-status-safety-power-safety-context.png');
    snap = await session.eval(`JSON.stringify({
      breadcrumb: document.getElementById('settings-context-breadcrumb')?.textContent,
      activeCategory: document.querySelector('.settings-rail-btn.active')?.dataset.settingsCategory
    })`);
    log(`Status & Safety -> Power & Safety: ${snap}`);

    // 6. Direct entry (sidebar Settings) must show NO breadcrumb.
    await session.eval(`document.getElementById('modal-close')?.click()`);
    await WAIT(150);
    await session.eval(`document.querySelector('[data-ns-tab="set"]').click()`);
    await WAIT(200);
    await session.screenshot('06-direct-settings-no-breadcrumb.png');
    snap = await session.eval(`JSON.stringify({
      breadcrumbVisible: document.getElementById('settings-context-breadcrumb')?.style.display !== 'none',
      activeCategory: document.querySelector('.settings-rail-btn.active')?.dataset.settingsCategory
    })`);
    log(`direct sidebar Settings entry: ${snap}`);

    const finalSnap = await session.eval(`JSON.stringify({ running: state.running, dryRun: state.dryRun })`);
    log(`final sanity: ${finalSnap}`);
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
}

main().catch(err => {
  console.error('[qa-pass5e-c] FAILED:', err);
  process.exit(1);
});
