#!/usr/bin/env node
// Mini-mode exit QA: real source Electron runtime, isolated userData,
// dryRun:true, CDP screenshots + eval-based interaction proof.
// Proves the mini-mode-exit tranche:
//   normal -> mini by mouse (btn-mini); mini -> normal by MOUSE via the new
//   #btn-mini-exit control; Ctrl+M keeps toggling both ways; mini geometry
//   is the exact 260x320 shell; normal geometry restores; a running or
//   paused Dry Run timer survives both directions without reset (endsAt,
//   action, dryRun identity); pause/resume/snooze/cancel keep working; no
//   real power path can run.
//
// Safety: dryRun:true for the whole session; the only timer started is a
// Dry Run timer, cancelled long before it could end; Dry Run never executes
// a real power action. No packaging, no packaged-exe launch, no provider ops.
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
const MINI = { width: 260, height: 320 }; // must match windowGeometry.js MINI_GEOMETRY

const evidenceDir = process.env.LIGHTS_OUT_QA_EVIDENCE_DIR
  ? path.resolve(process.env.LIGHTS_OUT_QA_EVIDENCE_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-mini-exit-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}

function log(msg) { console.log(`[qa-mini-mode-exit] ${msg}`); }

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
  async pressCtrlM() {
    // Ctrl+M through the renderer's real keydown contract (ctrlKey + 'm').
    await this.eval(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'm', ctrlKey: true, bubbles: true, cancelable: true
    }))`);
  }
  click(id) {
    return this.eval(`document.getElementById(${JSON.stringify(id)}).click()`);
  }
  async waitFor(expr, timeout = 5000, label = expr) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.eval(expr)) return true;
      await WAIT(120);
    }
    throw new Error(`condition never became true: ${label}`);
  }
  snapshot() {
    return this.eval(`(() => {
      const exitBtn = document.getElementById('btn-mini-exit');
      const exitCs = exitBtn ? getComputedStyle(exitBtn) : null;
      const exitRect = exitBtn ? exitBtn.getBoundingClientRect() : null;
      const header = document.querySelector('.chrome-header');
      return JSON.stringify({
        mini: document.body.classList.contains('mini-mode'),
        running: state.running, paused: state.paused,
        action: state.action, dryRun: state.dryRun,
        endsAt: state.endsAt, remaining: state.remainingSeconds,
        exitDisplay: exitCs ? exitCs.display : 'missing',
        exitRectW: exitRect ? Math.round(exitRect.width) : -1,
        headerDisplay: header ? getComputedStyle(header).display : 'missing',
        innerW: window.innerWidth, innerH: window.innerHeight,
        activeTab: document.querySelector('.ns-nav-item.active')?.dataset.nsTab || null
      });
    })()`).then(s => JSON.parse(s));
  }
  close() { this.ws.close(); }
}

async function launch() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-mini-exit-userdata-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { dryRun: true, forceShutdown: false, nsActiveTab: 'home', onboarded: true }
  }));
  fs.writeFileSync(path.join(userData, 'run-receipts.json'), JSON.stringify({ receipts: [] }, null, 2));

  const port = 9833 + Math.floor(Math.random() * 500);
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

async function teardown(ctx) {
  if (!ctx) return;
  if (ctx.session) ctx.session.close();
  try { ctx.child.kill(); } catch { /* best-effort */ }
  try { fs.rmSync(ctx.userData, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function closeTo(a, b, tol) { return Math.abs(a - b) <= tol; }

async function main() {
  if (!fs.existsSync(ELECTRON_EXE)) throw new Error(`Electron binary missing: ${ELECTRON_EXE}`);

  log('launching (dryRun:true, nsActiveTab:home)');
  const ctx = await launch();
  try {
    const { session } = ctx;

    // ---- 1. NORMAL BASELINE ---------------------------------------------
    let s = await session.snapshot();
    check('normal: exit control exists but hidden outside mini mode', s.exitDisplay === 'none', `display=${s.exitDisplay}`);
    check('normal: chrome header visible (entry toggle reachable)', s.headerDisplay !== 'none', `display=${s.headerDisplay}`);
    check('normal: dry run enforced from launch', s.dryRun === true, `dryRun=${s.dryRun}`);
    const normalGeom = { w: s.innerW, h: s.innerH };
    check('normal: geometry captured as restore baseline', normalGeom.w >= 1024, JSON.stringify(normalGeom));
    await session.screenshot('01-normal-baseline.png');

    // ---- 2. CTRL+M ROUND TRIP (idle) ------------------------------------
    await session.pressCtrlM();
    await session.waitFor(`document.body.classList.contains('mini-mode')`);
    s = await session.snapshot();
    check('ctrl+m: mini mode entered', s.mini === true, JSON.stringify(s));
    check('ctrl+m: exit control now VISIBLE by CSS', s.exitDisplay === 'flex' && s.exitRectW > 0, `display=${s.exitDisplay} rectW=${s.exitRectW}`);
    check('ctrl+m: chrome header still hidden in mini (no clutter)', s.headerDisplay === 'none', `display=${s.headerDisplay}`);
    check('ctrl+m: mini geometry is the 260x320 shell', closeTo(s.innerW, MINI.width, 12) && closeTo(s.innerH, MINI.height, 12), `inner=${s.innerW}x${s.innerH}`);
    await session.screenshot('02-mini-via-ctrl-m.png');

    await session.pressCtrlM();
    await session.waitFor(`!document.body.classList.contains('mini-mode')`);
    s = await session.snapshot();
    check('ctrl+m: mini mode exited', s.mini === false, JSON.stringify(s));
    check('ctrl+m: exit control hidden again outside mini', s.exitDisplay === 'none', `display=${s.exitDisplay}`);
    check('ctrl+m: normal geometry restored', closeTo(s.innerW, normalGeom.w, 12) && closeTo(s.innerH, normalGeom.h, 12), `inner=${s.innerW}x${s.innerH} baseline=${normalGeom.w}x${normalGeom.h}`);

    // ---- 3. MOUSE ROUND TRIP (idle) --------------------------------------
    await session.click('btn-mini');
    await session.waitFor(`document.body.classList.contains('mini-mode')`);
    s = await session.snapshot();
    check('mouse: btn-mini enters mini mode', s.mini === true, JSON.stringify(s));
    await session.screenshot('03-mini-via-mouse.png');

    await session.click('btn-mini-exit');
    await session.waitFor(`!document.body.classList.contains('mini-mode')`);
    s = await session.snapshot();
    check('mouse: #btn-mini-exit returns to full view (the trap is closed)', s.mini === false && s.exitDisplay === 'none', JSON.stringify(s));
    check('mouse: geometry restored after exit', closeTo(s.innerW, normalGeom.w, 12) && closeTo(s.innerH, normalGeom.h, 12), `inner=${s.innerW}x${s.innerH}`);

    // ---- 4. RUNNING TIMER SURVIVES THE ROUND TRIP -----------------------
    const started = await session.eval(`startTimer(1800, 'play').then(() => JSON.stringify({ ok: true, running: state.running, dryRun: state.dryRun, action: state.action, endsAt: state.endsAt }))`).then(v => JSON.parse(v));
    check('run: dry-run timer started', started.ok && started.running && started.dryRun, JSON.stringify(started));
    await WAIT(400);
    s = await session.snapshot();
    const runId = { endsAt: s.endsAt, action: s.action, remaining: s.remaining };
    log(`running identity baseline: ${JSON.stringify(runId)}`);

    await session.click('btn-mini');
    await session.waitFor(`document.body.classList.contains('mini-mode')`);
    await WAIT(300);
    s = await session.snapshot();
    const skewMs1 = Math.abs(new Date(s.endsAt).getTime() - new Date(runId.endsAt).getTime());
    check('run: entered mini while running', s.mini && s.running && !s.paused, JSON.stringify(s));
    check('run: exit control reachable while timer runs', s.exitDisplay === 'flex' && s.exitRectW > 0, `display=${s.exitDisplay} rectW=${s.exitRectW}`);
    check('run: timer identity unchanged inside mini', s.action === runId.action && s.dryRun === true && skewMs1 < 1000 && Number(s.remaining) <= Number(runId.remaining), JSON.stringify({ before: runId, after: { endsAt: s.endsAt, action: s.action, remaining: s.remaining }, skewMs: skewMs1 }));
    await session.screenshot('04-mini-running.png');

    await session.click('btn-mini-exit');
    await session.waitFor(`!document.body.classList.contains('mini-mode')`);
    await WAIT(300);
    s = await session.snapshot();
    const skewMs2 = Math.abs(new Date(s.endsAt).getTime() - new Date(runId.endsAt).getTime());
    check('run: exited mini while running via mouse', s.mini === false && s.running && !s.paused, JSON.stringify(s));
    check('run: timer identity unchanged after exit', s.action === runId.action && s.dryRun === true && skewMs2 < 1000 && Number(s.remaining) <= Number(runId.remaining), JSON.stringify({ before: runId, after: { endsAt: s.endsAt, action: s.action, remaining: s.remaining }, skewMs: skewMs2 }));
    check('run: normal geometry restored after running round trip', closeTo(s.innerW, normalGeom.w, 12) && closeTo(s.innerH, normalGeom.h, 12), `inner=${s.innerW}x${s.innerH}`);
    await session.screenshot('05-normal-after-running-exit.png');

    // ---- 5. PAUSED TIMER SURVIVES THE ROUND TRIP ------------------------
    await session.click('btn-pause');
    await WAIT(300);
    s = await session.snapshot();
    check('paused: pause works in normal mode', s.running && s.paused, JSON.stringify(s));

    await session.click('btn-mini');
    await session.waitFor(`document.body.classList.contains('mini-mode')`);
    await WAIT(300);
    s = await session.snapshot();
    check('paused: entered mini while paused, state intact', s.mini && s.paused && s.action === runId.action, JSON.stringify(s));
    await session.screenshot('06-mini-paused.png');

    await session.click('btn-mini-exit');
    await session.waitFor(`!document.body.classList.contains('mini-mode')`);
    await WAIT(300);
    s = await session.snapshot();
    check('paused: exited mini while paused, still paused', s.mini === false && s.running && s.paused, JSON.stringify(s));
    check('paused: identity still unchanged', s.action === runId.action && skewCheck(s.endsAt, runId.endsAt), JSON.stringify({ endsAt: s.endsAt }));

    // ---- 6. RESUME / SNOOZE / CANCEL STILL WORK -------------------------
    await session.click('btn-pause');
    await WAIT(300);
    s = await session.snapshot();
    check('resume: timer running again after pause toggle', s.running && !s.paused, JSON.stringify(s));

    const snoozed = await session.eval(`snooze(300).then(() => JSON.stringify({ running: state.running, paused: state.paused, remaining: state.remainingSeconds }))`).then(v => JSON.parse(v));
    check('snooze: session still running after snooze', snoozed.running && !snoozed.paused, JSON.stringify(snoozed));

    await session.click('btn-stop');
    await WAIT(400);
    s = await session.snapshot();
    check('cancel: back to lobby, nothing left running', !s.running && !s.paused && s.exitDisplay === 'none', JSON.stringify(s));
    await session.screenshot('07-normal-final.png');

    // ---- 7. FINAL SAFETY -------------------------------------------------
    const finalSnap = await session.snapshot();
    check('final: dry run held the whole session', finalSnap.dryRun === true, `dryRun=${finalSnap.dryRun}`);
    check('final: no session left running', !finalSnap.running && !finalSnap.paused, JSON.stringify(finalSnap));
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
  if (failed > 0) {
    console.error(`[qa-mini-mode-exit] FAILED: ${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`[qa-mini-mode-exit] ALL GREEN: ${passed} passed`);
}

function skewCheck(now, before) {
  return Math.abs(new Date(now).getTime() - new Date(before).getTime()) < 1000;
}

main().catch(err => {
  console.error('[qa-mini-mode-exit] FAILED:', err);
  process.exit(1);
});
