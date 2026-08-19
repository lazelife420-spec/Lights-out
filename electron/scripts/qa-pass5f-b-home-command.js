#!/usr/bin/env node
// Pass 5F-B QA evidence walkthrough: real source Electron runtime, isolated
// userData, CDP screenshots. Covers the Home Command Dashboard pass:
//   Home unarmed ("Choose Tonight") -> Library -> Use Tonight (arms a
//   Night Mode) -> Home armed ("Start Tonight") -> synthetic running state
//   ("Continue Tonight").
//
// Safety: never clicks Start Custom Timer, Begin Ritual, chips, Quick
// plans, or any Play/Power control. The "Continue Tonight" / running
// capture is produced by setting state.running = true directly and
// calling render() -- a pure client-side display mutation, the same
// technique already used for the ritual-overlay screenshot in Phase 5D-B
// -- never by calling startTimer() or any api.* IPC function. The process
// is torn down immediately after, nothing is persisted.
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
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5fb-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

function log(msg) { console.log(`[qa-pass5f-b] ${msg}`); }

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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5fb-userdata-'));
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

    // 1. Home, nothing armed -- "Choose Tonight" state.
    await WAIT(200);
    await session.screenshot('01-home-choose-tonight.png');
    let snap = await session.eval(`JSON.stringify({
      cta: document.getElementById('ns-home-cta-label')?.textContent,
      status: document.getElementById('ns-home-command-status')?.textContent,
      plan: document.getElementById('ns-home-tonight-plan')?.textContent,
      running: state.running
    })`);
    log(`Home unarmed: ${snap}`);

    // 2. Library -> select Movie Wind-Down -> Use Tonight (arms it, does
    // not start it) -> back to Home.
    await session.eval(`document.querySelector('[data-ns-tab="modes"]').click()`);
    await WAIT(300);
    await session.eval(`document.querySelector('.nm-tile[data-mode-id="movie-wind-down"]')?.click()`);
    await WAIT(300);
    await session.eval(`document.getElementById('nm-btn-use-tonight')?.click()`);
    await WAIT(300);
    await session.eval(`document.querySelector('[data-ns-tab="home"]').click()`);
    await WAIT(200);
    await session.screenshot('02-home-armed-start-tonight.png');
    snap = await session.eval(`JSON.stringify({
      cta: document.getElementById('ns-home-cta-label')?.textContent,
      status: document.getElementById('ns-home-command-status')?.textContent,
      plan: document.getElementById('ns-home-tonight-plan')?.textContent,
      running: state.running
    })`);
    log(`Home armed: ${snap}`);

    // 3. Synthetic running state for the "Continue Tonight" visual --
    // direct state mutation + render(), never startTimer()/api.*.
    await session.eval(`(() => { state.running = true; state.endsAt = new Date(Date.now() + 30*60000).toISOString(); render(); })()`);
    await WAIT(150);
    await session.screenshot('03-home-continue-tonight-synthetic.png');
    snap = await session.eval(`JSON.stringify({
      cta: document.getElementById('ns-home-cta-label')?.textContent,
      running: state.running
    })`);
    log(`Home synthetic running: ${snap}`);

    const finalSnap = await session.eval(`JSON.stringify({ dryRun: state.dryRun })`);
    log(`final sanity (running was synthetic, never real): ${finalSnap}`);
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
}

main().catch(err => {
  console.error('[qa-pass5f-b] FAILED:', err);
  process.exit(1);
});
