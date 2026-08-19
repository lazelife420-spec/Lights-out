#!/usr/bin/env node
// Tiny QA capture: real source Electron runtime, isolated userData, CDP
// screenshot. Confirms the .dashboard bottom-padding fix -- scrolls
// Tonight all the way down and checks the last Quick Plans row sits
// clear of the footer instead of appearing cut off behind it.
//
// Safety: only navigation and scrolling -- never touches Start Custom
// Timer/Start Now, Begin Ritual, Arm Tonight, chips, or any Play/Power
// control.
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
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-footer-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

function log(msg) { console.log(`[qa-footer] ${msg}`); }

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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-footer-userdata-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { dryRun: true, forceShutdown: false, nsActiveTab: 'lib', onboarded: true }
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

  log('launching (dryRun:true, Tonight)');
  const ctx = await launch();
  try {
    const { session } = ctx;
    await WAIT(200);
    // Scroll the dashboard all the way down.
    await session.eval(`document.querySelector('.dashboard').scrollTo(0, document.querySelector('.dashboard').scrollHeight)`);
    await WAIT(200);
    await session.screenshot('01-tonight-scrolled-to-bottom.png');
    const snap = await session.eval(`(() => {
      const dash = document.querySelector('.dashboard');
      const footer = document.querySelector('.app-footer');
      const dashRect = dash.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const lastCard = document.querySelector('.profiles-grid')?.lastElementChild;
      const lastCardRect = lastCard ? lastCard.getBoundingClientRect() : null;
      return JSON.stringify({
        scrollReachedBottom: Math.ceil(dash.scrollTop + dash.clientHeight) >= dash.scrollHeight - 1,
        dashBottomEdge: dashRect.bottom,
        footerTopEdge: footerRect.top,
        lastCardBottom: lastCardRect ? lastCardRect.bottom : null,
        lastCardClearOfFooter: lastCardRect ? lastCardRect.bottom <= footerRect.top : null,
        running: state.running
      });
    })()`);
    log(`scroll/clearance check: ${snap}`);
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
}

main().catch(err => {
  console.error('[qa-footer] FAILED:', err);
  process.exit(1);
});
