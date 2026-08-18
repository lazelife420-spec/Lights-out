#!/usr/bin/env node
// Pass 5D-B QA evidence walkthrough: real source Electron runtime, isolated
// userData, CDP screenshots. Covers the Command Clarity pass:
//   top menu renamed labels -> footer status pill (Dry Run vs Live Ready,
//   both runs) -> Schedule TOOLS divider (plain label, not a fake tab) ->
//   Save Profile modal (no stray emoji) -> ritual overlay icon (SVG, not
//   emoji).
//
// Safety: never clicks Start Custom Timer, Begin Ritual, chips, Quick
// plans/Saved plans cards, or any Play/Power control. The ritual overlay
// is verified by calling showRitualOverlay()/updateRitualOverlay()
// directly with a synthetic step object -- both are pure DOM-rendering
// functions (icon/title/desc/progress-dots only, no startTimer/api.* call
// anywhere in them), so this renders the real icon fix without going
// through the real ritual trigger path at all.
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
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5db-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

function log(msg) { console.log(`[qa-pass5d-b] ${msg}`); }

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

async function launch(extraAppSettings) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5db-userdata-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { dryRun: true, forceShutdown: false, nsActiveTab: 'home', onboarded: true, ...extraAppSettings }
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

  // Run 1: dryRun:true (default) -- top menu labels, footer Dry Run pill,
  // Schedule divider, Save Profile modal, ritual icon.
  log('launching run 1 (dryRun:true)');
  let ctx = await launch({});
  try {
    const { session } = ctx;

    // 1. Top menu: open Status & Safety, screenshot.
    await session.eval(`document.getElementById('menu-settings').click()`);
    await WAIT(200);
    await session.screenshot('01-top-menu-status-safety.png');
    await session.eval(`document.getElementById('menu-settings').click()`); // close

    // 2. Footer status pill: dry run.
    const dryRunSnap = await session.eval(`JSON.stringify({ text: document.getElementById('status-text')?.textContent, cls: document.getElementById('status-pill')?.className })`);
    log(`footer pill (dryRun:true): ${dryRunSnap}`);
    await session.screenshot('02-footer-dryrun-pill.png');

    // 3. Schedule TOOLS divider.
    await session.eval(`document.querySelector('[data-ns-tab="sch"]').click()`);
    await WAIT(300);
    await session.screenshot('03-schedule-tools-divider.png');

    // 4. Save Profile modal (opens the modal only -- no timer/power action).
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click()`);
    await WAIT(200);
    await session.eval(`document.getElementById('btn-manage-profiles')?.click()`);
    await WAIT(200);
    await session.screenshot('04-save-profile-modal.png');
    await session.eval(`document.getElementById('btn-close-profiles')?.click()`);

    // 5. Ritual overlay icon: call the pure-rendering functions directly
    // with a synthetic step -- never clicks Begin Ritual.
    await session.eval(`showRitualOverlay({ currentStepInfo: { id: 'breathe', label: 'Guided Breathing', skippable: true, auto: false }, totalSteps: 5, currentStep: 0 })`);
    await WAIT(150);
    const ritualSnap = await session.eval(`JSON.stringify({ iconIsSvg: document.getElementById('ritual-step-icon')?.innerHTML.includes('<svg'), running: state.running })`);
    log(`ritual overlay icon: ${ritualSnap}`);
    await session.screenshot('05-ritual-overlay-icon.png');
    await session.eval(`hideRitualOverlay()`);

    const finalSnap1 = await session.eval(`JSON.stringify({ running: state.running, dryRun: state.dryRun })`);
    log(`run 1 final sanity: ${finalSnap1}`);
  } finally {
    await teardown(ctx);
  }

  // Run 2: dryRun:false -- footer status pill should say "Live Ready",
  // colored distinctly (not the same muted default as before this pass).
  log('launching run 2 (dryRun:false)');
  ctx = await launch({ dryRun: false });
  try {
    const { session } = ctx;
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click()`);
    await WAIT(300);
    const liveSnap = await session.eval(`JSON.stringify({ text: document.getElementById('status-text')?.textContent, cls: document.getElementById('status-pill')?.className, running: state.running })`);
    log(`footer pill (dryRun:false): ${liveSnap}`);
    await session.screenshot('06-footer-live-ready-pill.png');
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
}

main().catch(err => {
  console.error('[qa-pass5d-b] FAILED:', err);
  process.exit(1);
});
