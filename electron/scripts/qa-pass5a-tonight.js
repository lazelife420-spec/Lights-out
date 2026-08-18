#!/usr/bin/env node
// Pass 5A QA evidence walkthrough: real source Electron runtime, isolated
// userData, dryRun:true, CDP screenshots. Covers the Tonight Session
// Coherence Pass specifically:
//   Tonight (custom timer, no mode armed) -> Library -> Use Tonight ->
//   Tonight (armed) -> clear armed mode -> Tonight (custom timer again)
// plus a second short launch with clockMode:false seeded, to show the
// ring's PREVIEW badge (which only appears when the orange ring itself is
// showing, not the blue ambient clock).
//
// Safety: never clicks Start Custom Timer, Begin Ritual, chips, or any
// Play/Power control -- only navigation, mode selection, Use Tonight (arms
// a plan, does not start it), and the armed-mode clear (x) button.
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
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5a-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

function log(msg) { console.log(`[qa-pass5a] ${msg}`); }

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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5a-userdata-'));
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

  // Run 1: default settings (clockMode:true, the DEFAULTS value) --
  // covers Tonight's custom-timer summary, arming/clearing a Night Mode,
  // and the participating-features chip row.
  log('launching run 1 (default clockMode -- ambient clock idle view)');
  let ctx = await launch({});
  try {
    const { session } = ctx;

    // 1. Tonight directly, nothing armed -- Custom Timer plan summary.
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click()`);
    await WAIT(400);
    await session.screenshot('01-tonight-custom-timer.png');

    // 2. Library -> select Movie Wind-Down (has a real ritual + duration)
    // -> Use Tonight (arms it, bridges back to Tonight).
    await session.eval(`document.querySelector('[data-ns-tab="modes"]').click()`);
    await WAIT(400);
    await session.eval(`document.querySelector('.nm-tile[data-mode-id="movie-wind-down"]')?.click()`);
    await WAIT(400);
    await session.eval(`document.getElementById('nm-btn-use-tonight')?.click()`);
    await WAIT(500);
    await session.screenshot('02-tonight-armed-mode.png');

    // 3. Clear the armed mode via its own (x) -- confirms the banner
    // falls back to the Custom Timer summary again, not just on first
    // load.
    await session.eval(`document.getElementById('armed-mode-clear')?.click()`);
    await WAIT(400);
    await session.screenshot('03-tonight-cleared-back-to-custom.png');

    // 4. Sanity: confirm running/paused controls and Quick Plans/Session
    // cards below are unaffected -- scroll state, not clicked.
    const snap = await session.eval(`JSON.stringify({
      startBtnExists: !!document.getElementById('btn-start-custom'),
      startBtnWired: document.getElementById('btn-start-custom')?.textContent.includes('Start Custom Timer'),
      ringBadgeText: document.getElementById('ring-state-badge')?.textContent,
      running: state.running
    })`);
    log(`sanity: ${snap}`);
  } finally {
    await teardown(ctx);
  }

  // Run 2: clockMode:false forces the idle view to show the orange ring
  // (configured-duration preview) instead of the blue ambient clock --
  // this is the ONLY idle state where the new PREVIEW badge is visible.
  log('launching run 2 (clockMode:false -- ring preview view)');
  ctx = await launch({ clockMode: false });
  try {
    const { session } = ctx;
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click()`);
    await WAIT(400);
    await session.screenshot('04-tonight-ring-preview-badge.png');
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
}

main().catch(err => {
  console.error('[qa-pass5a] FAILED:', err);
  process.exit(1);
});
