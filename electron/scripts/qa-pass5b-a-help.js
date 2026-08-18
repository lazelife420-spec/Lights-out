#!/usr/bin/env node
// Pass 5B-A QA evidence walkthrough: real source Electron runtime, isolated
// userData, dryRun:true, CDP screenshots. Covers the Shared Help Foundation +
// Highest-Risk Clarity Fixes pass:
//   Run 1 (real default built-in schedule rule present): Tonight -> hover
//     the bottom time label (real "Next action: HH:MM"), hover the Start
//     Custom Timer button, hover a chip preset, hover the Quick plans hint.
//   Run 2 (calendar.builtin.rules emptied): Tonight -> bottom time label
//     shows the honest "No time scheduled" fallback.
//   Run 3 (clockMode:false, ring preview visible): hover the PREVIEW badge.
//
// Safety: never clicks Start Custom Timer, Begin Ritual, chips, Quick
// plans cards, or any Play/Power control -- only navigation and
// dispatchEvent('mouseover'/'mouseout') to trigger tooltip display, which
// does not activate click handlers.
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
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5ba-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

function log(msg) { console.log(`[qa-pass5b-a] ${msg}`); }

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
  // Hover simulation: real mouseover/mouseout dispatch (what
  // renderer-help.js's delegated listeners actually key off), not a click
  // -- never activates a click handler.
  async hover(selector) {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return true;
    })()`);
  }
  async unhover(selector) {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    })()`);
  }
  close() { this.ws.close(); }
}

async function launch(extraAppSettings, extraTopLevelSettings) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5ba-userdata-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { dryRun: true, forceShutdown: false, nsActiveTab: 'home', onboarded: true, ...extraAppSettings },
    ...extraTopLevelSettings
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

  // Run 1: default settings -- the real default built-in schedule rule
  // ("Bedtime", 22:30, all days, enabled) is present, so calNextEvent
  // should be populated and the bottom label should read "Next action:".
  log('launching run 1 (default schedule -- Next action: label + tooltips)');
  let ctx = await launch({});
  try {
    const { session } = ctx;
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click()`);
    await WAIT(500); // allow the proactive fetchAndRenderEvents() call to resolve
    await session.screenshot('01-tonight-next-action-label.png');

    await session.hover('#timer-label');
    await WAIT(150);
    await session.screenshot('02-tooltip-timer-label.png');
    await session.unhover('#timer-label');

    await session.hover('#btn-start-custom');
    await WAIT(150);
    await session.screenshot('03-tooltip-start-custom.png');
    await session.unhover('#btn-start-custom');

    await session.hover('.chip[data-min="15"]');
    await WAIT(150);
    await session.screenshot('04-tooltip-chip.png');
    await session.unhover('.chip[data-min="15"]');

    const snap = await session.eval(`JSON.stringify({
      timerLabelText: document.getElementById('timer-label')?.textContent,
      chipsHintText: document.querySelector('.ns-setup-hint')?.textContent,
      running: state.running,
      dryRun: state.dryRun
    })`);
    log(`run 1 sanity: ${snap}`);
  } finally {
    await teardown(ctx);
  }

  // Run 2: calendar.builtin.rules emptied -- no real schedule exists, so
  // the label must honestly say so instead of showing any time at all.
  log('launching run 2 (no schedule configured -- No time scheduled)');
  ctx = await launch({}, { calendar: { enabled: true, provider: 'builtin', builtin: { enabled: true, rules: [] } } });
  try {
    const { session } = ctx;
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click()`);
    await WAIT(500);
    await session.screenshot('05-tonight-no-time-scheduled.png');
    const snap = await session.eval(`JSON.stringify({ timerLabelText: document.getElementById('timer-label')?.textContent, running: state.running })`);
    log(`run 2 sanity: ${snap}`);
  } finally {
    await teardown(ctx);
  }

  // Run 3: clockMode:false -- ring preview visible, PREVIEW badge tooltip.
  log('launching run 3 (clockMode:false -- ring PREVIEW badge tooltip)');
  ctx = await launch({ clockMode: false });
  try {
    const { session } = ctx;
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click()`);
    await WAIT(400);
    await session.hover('#ring-state-badge');
    await WAIT(150);
    await session.screenshot('06-tooltip-ring-badge.png');
    const snap = await session.eval(`JSON.stringify({ running: state.running, ringBadgeVisible: document.getElementById('ring-state-badge')?.classList.contains('visible') })`);
    log(`run 3 sanity: ${snap}`);
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
}

main().catch(err => {
  console.error('[qa-pass5b-a] FAILED:', err);
  process.exit(1);
});
