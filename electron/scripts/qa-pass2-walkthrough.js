#!/usr/bin/env node
// Pass 2 QA evidence walkthrough: launches the real source Electron runtime
// (not a browser-preview fallback) against an isolated, throwaway userData
// directory, seeded with dryRun:true, and takes real screenshots via the
// Chrome DevTools Protocol as it navigates the shell read-only.
//
// Safety: this script never clicks Play/Start/Power/Shutdown/Sleep/Restart/
// Hibernate/Lock. It only clicks sidebar/tab/settings-category navigation
// elements, so no timer is ever started and no power action can occur even
// though --desktop-ux-proof + dryRun:true are also set as belt-and-suspenders.
//
// Evidence is written OUTSIDE the repo (a temp directory), never committed.
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
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass2-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

function log(msg) { console.log(`[qa-pass2] ${msg}`); }

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
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
  }
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

async function main() {
  if (!fs.existsSync(ELECTRON_EXE)) throw new Error(`Electron binary missing: ${ELECTRON_EXE}`);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass2-userdata-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { dryRun: true, nsActiveTab: 'lib', onboarded: true }
  }));

  // Seed a couple of dry-run-completed receipts so Proof's History/Last Run/
  // Activity tabs can be captured populated, not just in their empty state.
  // Fixture data in an isolated throwaway profile -- never touches the real
  // installed app's userData.
  const now = Date.now();
  const seedReceipt = (offsetMs, action, result) => ({
    id: `qa_${offsetMs}`,
    version: 1,
    startedAt: new Date(now - offsetMs).toISOString(),
    endedAt: new Date(now - offsetMs + 20 * 60000).toISOString(),
    action,
    profileId: null,
    profileName: null,
    nightModeId: null,
    nightModeTitle: null,
    nightModeVersion: null,
    durationSeconds: 1200,
    dryRun: true,
    forceShutdown: false,
    gracefulClose: true,
    result,
    pauseCount: 0,
    snoozeCount: 0,
    cancelReason: null
  });
  fs.writeFileSync(path.join(userData, 'run-receipts.json'), JSON.stringify({
    receipts: [
      seedReceipt(2 * 3600000, 'shutdown', 'dry_run_completed'),
      seedReceipt(26 * 3600000, 'sleep', 'dry_run_completed'),
      seedReceipt(50 * 3600000, 'shutdown', 'dry_run_completed')
    ]
  }, null, 2));

  const port = 9333 + Math.floor(Math.random() * 500);
  log(`launching source Electron runtime (isolated userData, dryRun:true, port ${port})`);
  const child = spawn(ELECTRON_EXE, [
    ELECTRON_ROOT,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-sandbox',
    '--disable-gpu',
    '--no-auto-start',
    '--desktop-ux-proof'
  ], { windowsHide: true, env: { ...process.env, LIGHTS_OUT_DESKTOP_UX_GATE: '1' } });

  let session;
  try {
    let list = [];
    for (let i = 0; i < 60; i++) {
      try { list = await cdpList(port); if (list.length) break; } catch { /* retry */ }
      await WAIT(250);
    }
    if (!list.length) throw new Error('Electron never exposed CDP');
    const page = list.find(x => x.type === 'page') || list[0];
    session = new CdpSession(page.webSocketDebuggerUrl);
    await session.connect();
    await session.waitForReady();
    log('renderer ready');

    // 1. Tonight (initial lobby state)
    await session.screenshot('01-tonight.png');

    // 2. Modes
    await session.eval(`document.querySelector('[data-ns-tab="modes"]').click()`);
    await WAIT(400);
    await session.screenshot('02-modes.png');

    // 3. Schedule (default sub-tab)
    await session.eval(`document.querySelector('[data-ns-tab="sch"]').click()`);
    await WAIT(400);
    await session.screenshot('03-schedule.png');

    // 4. Schedule -> Automations / First Light
    await session.eval(`document.querySelector('.tab-btn[data-tab="automations"]')?.click();`);
    await WAIT(400);
    await session.screenshot('04-schedule-automations-firstlight.png');

    // 5. Devices
    await session.eval(`document.querySelector('[data-ns-tab="dev"]').click()`);
    await WAIT(400);
    await session.screenshot('05-devices.png');

    // 6. Proof
    await session.eval(`document.querySelector('[data-ns-tab="stats"]').click()`);
    await WAIT(400);
    await session.screenshot('06-proof.png');

    // 7. Proof -> History (empty state, no seeded receipts)
    await session.eval(`document.querySelector('.tab-btn[data-tab="proof-history"]')?.click();`);
    await WAIT(400);
    await session.screenshot('07a-proof-history.png');

    // 7b. Proof -> Activity (relocated Streaks)
    await session.eval(`document.querySelector('.tab-btn[data-tab="proof-activity"]')?.click();`);
    await WAIT(400);
    await session.screenshot('07-proof-activity-streaks.png');

    // 8. Settings
    await session.eval(`document.querySelector('[data-ns-tab="set"]').click()`);
    await WAIT(400);
    await session.screenshot('08-settings.png');

    // 9. Back to Tonight
    await session.eval(`document.getElementById('modal-close')?.click();`);
    await WAIT(300);
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click();`);
    await WAIT(400);
    await session.screenshot('09-tonight-return.png');

    log(`done. Evidence dir: ${evidenceDir}`);
  } finally {
    if (session) session.close();
    try { child.kill(); } catch { /* best-effort */ }
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

main().catch(err => {
  console.error('[qa-pass2] FAILED:', err);
  process.exit(1);
});
