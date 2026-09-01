#!/usr/bin/env node
// Running-state navigation rail QA: real source Electron runtime, isolated
// userData, dryRun:true, CDP screenshots + eval-based interaction proof.
// Proves the running-nav-rail tranche:
//   lobby = full 208px rail; RUNNING/PAUSED = compact 84px icon rail that
//   still navigates between pages; fullscreen clock and mini mode hide the
//   rail; navigating mid-run never mutates timer state; pause/resume/
//   snooze/cancel keep working; the selected power action never changes.
//
// Safety: dryRun:true for the whole session; the only timer started is a
// Dry Run timer, cancelled long before it could end; Dry Run never executes
// a real power path. No packaging, no packaged-exe launch, no provider ops.
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
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-running-nav-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}

function log(msg) { console.log(`[qa-running-nav-rail] ${msg}`); }

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
  async pressKey(key, modifiers = {}) {
    await this.eval(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, altKey: ${!!modifiers.alt}, bubbles: true, cancelable: true
    }))`);
  }
  sidebarMetrics() {
    return this.eval(`(() => {
      const el = document.querySelector('.ns-sidebar');
      if (!el) return JSON.stringify({ exists: false });
      const cs = getComputedStyle(el);
      return JSON.stringify({
        exists: true,
        display: cs.display,
        width: cs.width,
        lobby: document.body.classList.contains('ns-lobby'),
        running: document.body.classList.contains('is-running'),
        paused: document.body.classList.contains('is-paused'),
        fullscreen: document.body.classList.contains('fullscreen-clock-mode'),
        mini: document.body.classList.contains('mini-mode'),
        activeTab: document.querySelector('.ns-nav-item.active')?.dataset.nsTab || null,
        running_: state.running, paused_: state.paused,
        action: state.action, dryRun: state.dryRun,
        endsAt: state.endsAt, remaining: state.remainingSeconds
      });
    })()`).then(s => JSON.parse(s));
  }
  close() { this.ws.close(); }
}

async function launch() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-running-nav-userdata-'));
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

async function teardown(ctx) {
  if (!ctx) return;
  if (ctx.session) ctx.session.close();
  try { ctx.child.kill(); } catch { /* best-effort */ }
  try { fs.rmSync(ctx.userData, { recursive: true, force: true }); } catch { /* best-effort */ }
}

async function main() {
  if (!fs.existsSync(ELECTRON_EXE)) throw new Error(`Electron binary missing: ${ELECTRON_EXE}`);

  log('launching (dryRun:true, nsActiveTab:home)');
  const ctx = await launch();
  try {
    const { session } = ctx;

    // 1. LOBBY: full 208px rail visible.
    let s = await session.sidebarMetrics();
    check('lobby: rail visible', s.exists && s.display === 'flex' && !s.running && s.lobby, JSON.stringify(s));
    check('lobby: rail is full width (208px)', parseFloat(s.width) === 208, `width=${s.width}`);
    await session.screenshot('01-lobby-full-rail.png');

    // 2. Start a Dry Run session through the real start path (origin 'play'
    //    also exercises the app's own navigate-to-Tonight behavior).
    const started = await session.eval(`startTimer(1800, 'play').then(() => JSON.stringify({ ok: true, running: state.running, dryRun: state.dryRun, action: state.action }))`).then(v => JSON.parse(v));
    check('run: dry-run timer started', started.ok && started.running && started.dryRun, JSON.stringify(started));
    await WAIT(400);
    const preNav = await session.sidebarMetrics();
    check('run: is-running present, ns-lobby removed', preNav.running && !preNav.lobby, JSON.stringify(preNav));
    check('run: compact rail visible', preNav.display === 'flex', `display=${preNav.display}`);
    check('run: compact rail width (84px)', parseFloat(preNav.width) === 84, `width=${preNav.width}`);
    check('run: landed on Tonight', preNav.activeTab === 'lib', `activeTab=${preNav.activeTab}`);
    await session.screenshot('02-running-compact-rail.png');

    // 3. Navigate during the run: Library, Devices, back to Tonight. Timer
    //    identity (endsAt/action/dryRun) must never change; remaining time
    //    may only tick down (never reset or grow before snooze).
    const endsAtBefore = preNav.endsAt;
    const actionBefore = preNav.action;
    const remainingBefore = preNav.remaining;
    log(`identity baseline: ${JSON.stringify({ endsAt: endsAtBefore, action: actionBefore, remaining: remainingBefore })}`);
    for (const tab of ['modes', 'dev', 'lib']) {
      await session.eval(`handleSidebarNavigation('${tab}')`);
      await WAIT(250);
      const during = await session.sidebarMetrics();
      check(`nav:${tab} rail still visible + compact`, during.display === 'flex' && parseFloat(during.width) === 84 && during.running_, JSON.stringify(during));
      const detail = JSON.stringify({
        before: { endsAt: endsAtBefore, action: actionBefore, remaining: remainingBefore },
        after: { endsAt: during.endsAt, action: during.action, remaining: during.remaining, running: during.running_, dryRun: during.dryRun }
      });
      // endsAt: the renderer computes a provisional deadline with its own
      // clock; main's canonical payload (sub-100ms clock skew) replaces it
      // when the first update lands. Anything beyond 1s would mean a real
      // reschedule. remaining must only tick down, never reset or grow.
      const endsAtSkewMs = Math.abs(new Date(during.endsAt).getTime() - new Date(endsAtBefore).getTime());
      check(`nav:${tab} timer identity unchanged`,
        during.running_ === true && during.action === actionBefore && during.dryRun === true &&
        endsAtSkewMs < 1000 && Number(during.remaining) <= Number(remainingBefore),
        detail);
    }
    check('nav: back on Tonight with same session', (await session.sidebarMetrics()).activeTab === 'lib');
    await session.screenshot('03-running-after-navigation.png');

    // 4. PAUSED: Space toggles pause; rail stays reachable. NOTE: the app
    //    keeps state.running true while paused (resume flips paused off),
    //    so body.is-running legitimately coexists with body.is-paused.
    await session.pressKey(' ');
    await WAIT(250);
    let p = await session.sidebarMetrics();
    check('paused: is-paused present, rail still visible', p.paused_ === true && p.paused && p.display === 'flex' && parseFloat(p.width) === 84, JSON.stringify(p));
    await session.screenshot('04-paused-compact-rail.png');
    await session.pressKey(' ');
    await WAIT(250);
    p = await session.sidebarMetrics();
    check('resume: running again after Space', p.running && !p.paused, JSON.stringify(p));

    // 5. Snooze still works during the run.
    const snoozed = await session.eval(`snooze(300).then(() => JSON.stringify({ running: state.running, paused: state.paused, remaining: state.remainingSeconds }))`).then(v => JSON.parse(v));
    check('snooze: session still running after snooze', snoozed.running && !snoozed.paused, JSON.stringify(snoozed));

    // 6. Cancel: returns to lobby with the full rail restored.
    await session.eval(`cancelTimer()`);
    await WAIT(400);
    s = await session.sidebarMetrics();
    check('cancel: back to lobby', !s.running && !s.paused && s.lobby, JSON.stringify(s));
    check('cancel: full rail width restored (208px)', parseFloat(s.width) === 208, `width=${s.width}`);
    await session.screenshot('05-lobby-restored.png');

    // 7. Fullscreen clock: rail intentionally hidden (must stay hidden).
    await session.eval(`document.getElementById('btn-fullscreen-clock').click()`);
    await WAIT(300);
    s = await session.sidebarMetrics();
    check('fullscreen: rail hidden', s.fullscreen && s.display === 'none', JSON.stringify(s));
    await session.screenshot('06-fullscreen-no-rail.png');
    await session.eval(`document.getElementById('btn-fullscreen-clock-exit').click()`);
    await WAIT(300);

    // 8. Mini mode: rail intentionally hidden (must stay hidden).
    await session.eval(`document.getElementById('btn-mini').click()`);
    await WAIT(300);
    s = await session.sidebarMetrics();
    check('mini: rail hidden', s.mini && s.display === 'none', JSON.stringify(s));
    await session.screenshot('07-mini-no-rail.png');
    await session.eval(`document.getElementById('btn-mini').click()`);
    await WAIT(300);

    // 9. Final sanity: dry run held to the end, nothing left running.
    const finalSnap = await session.sidebarMetrics();
    check('final: dry run held, no session left running', finalSnap.dryRun === true && !finalSnap.running && !finalSnap.paused, JSON.stringify(finalSnap));
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
  if (failed > 0) {
    console.error(`[qa-running-nav-rail] FAILED: ${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`[qa-running-nav-rail] ALL GREEN: ${passed} passed`);
}

main().catch(err => {
  console.error('[qa-running-nav-rail] FAILED:', err);
  process.exit(1);
});
