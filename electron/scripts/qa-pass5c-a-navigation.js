#!/usr/bin/env node
// Pass 5C-A QA evidence walkthrough: real source Electron runtime, isolated
// userData, dryRun:true, CDP screenshots + eval-based interaction proof.
// Covers the Navigation Contract pass:
//   sidebar arrow-key roving focus -> Alt+Left/Alt+Right history back/forward
//   -> mouse-button-4/5 back/forward (synthetic mouseup, same handler path
//   real hardware buttons hit) -> Library tile grid arrow nav -> Settings
//   rail arrow nav.
//
// Safety: only navigation, focus movement, and dispatched keydown/mouseup
// events -- never clicks Start Custom Timer, Begin Ritual, chips, Quick
// plans cards, or any Play/Power control. Enter/Space are only dispatched
// at sidebar/tab/rail buttons (pure navigation), never at a start control.
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
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5ca-evidence-'));
fs.mkdirSync(evidenceDir, { recursive: true });

function log(msg) { console.log(`[qa-pass5c-a] ${msg}`); }

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
  // Real key dispatch at the currently-focused element (or document if
  // nothing is focused) -- exactly what renderer-nav.js's delegated
  // listeners key off (event.target via bubbling).
  async pressKey(key, modifiers = {}) {
    await this.eval(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, altKey: ${!!modifiers.alt}, bubbles: true, cancelable: true
    }))`);
  }
  // Synthetic side-button mouseup -- the same event renderer-nav.js listens
  // for; real hardware back/forward buttons produce the same button index.
  async pressMouseButton(button) {
    await this.eval(`document.dispatchEvent(new MouseEvent('mouseup', { button: ${button}, bubbles: true, cancelable: true }))`);
  }
  close() { this.ws.close(); }
}

async function launch(extraAppSettings) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-pass5ca-userdata-'));
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

  log('launching (dryRun:true, default nsActiveTab:home)');
  const ctx = await launch({});
  try {
    const { session } = ctx;

    // 1. Sidebar arrow-key roving focus: focus Home, ArrowDown twice should
    // land on Library (Home -> Tonight -> Library).
    await session.eval(`document.querySelector('[data-ns-tab="home"]').focus()`);
    await session.pressKey('ArrowDown');
    await session.pressKey('ArrowDown');
    let snap = await session.eval(`JSON.stringify({ focusedTab: document.activeElement?.dataset.nsTab })`);
    log(`sidebar ArrowDown x2 from Home: ${snap}`);
    await session.screenshot('01-sidebar-arrow-focus.png');

    // 2. Real navigation: click Tonight, then Library -- builds history.
    await session.eval(`document.querySelector('[data-ns-tab="lib"]').click()`);
    await WAIT(300);
    await session.eval(`document.querySelector('[data-ns-tab="modes"]').click()`);
    await WAIT(300);
    await session.screenshot('02-library-before-back.png');

    // 3. Alt+Left twice: modes -> lib -> home (or lib, depending on
    // bootstrap's own initial navigation -- captured either way).
    await session.pressKey('ArrowLeft', { alt: true });
    await WAIT(250);
    snap = await session.eval(`JSON.stringify({ activePanel: document.querySelector('.ns-nav-item.active')?.dataset.nsTab })`);
    log(`Alt+Left once: ${snap}`);
    await session.screenshot('03-after-alt-left.png');

    // 4. Alt+Right: should return to Library.
    await session.pressKey('ArrowRight', { alt: true });
    await WAIT(250);
    snap = await session.eval(`JSON.stringify({ activePanel: document.querySelector('.ns-nav-item.active')?.dataset.nsTab })`);
    log(`Alt+Right after Alt+Left: ${snap}`);
    await session.screenshot('04-after-alt-right.png');

    // 5. Mouse button 4 (back, MouseEvent.button===3) -- same handler path
    // a real side mouse button hits.
    await session.pressMouseButton(3);
    await WAIT(250);
    snap = await session.eval(`JSON.stringify({ activePanel: document.querySelector('.ns-nav-item.active')?.dataset.nsTab, running: state.running })`);
    log(`mouse button 4 (back): ${snap}`);
    await session.screenshot('05-after-mouse-back.png');

    // 6. Mouse button 5 (forward, MouseEvent.button===4).
    await session.pressMouseButton(4);
    await WAIT(250);
    snap = await session.eval(`JSON.stringify({ activePanel: document.querySelector('.ns-nav-item.active')?.dataset.nsTab, running: state.running })`);
    log(`mouse button 5 (forward): ${snap}`);

    // 7. Library tile grid arrow nav: focus first ready tile, ArrowRight.
    await session.eval(`document.querySelector('[data-ns-tab="modes"]').click()`);
    await WAIT(300);
    await session.eval(`document.querySelector('#nm-ready-grid .nm-tile')?.focus()`);
    const beforeTile = await session.eval(`document.activeElement?.dataset.modeId`);
    await session.pressKey('ArrowRight');
    const afterTile = await session.eval(`document.activeElement?.dataset.modeId`);
    log(`Library tile ArrowRight: ${beforeTile} -> ${afterTile}`);
    await session.screenshot('06-library-tile-arrow-focus.png');

    // 8. Settings rail arrow nav: open Settings, focus first category,
    // ArrowDown.
    await session.eval(`document.querySelector('[data-ns-tab="set"]').click()`);
    await WAIT(300);
    await session.eval(`document.querySelector('.settings-rail-btn')?.focus()`);
    const beforeCat = await session.eval(`document.activeElement?.dataset.settingsCategory`);
    await session.pressKey('ArrowDown');
    const afterCat = await session.eval(`document.activeElement?.dataset.settingsCategory`);
    log(`Settings rail ArrowDown: ${beforeCat} -> ${afterCat}`);
    await session.screenshot('07-settings-rail-arrow-focus.png');

    // 9. Final sanity: no accidental timer start, dry run held throughout.
    const finalSnap = await session.eval(`JSON.stringify({ running: state.running, dryRun: state.dryRun })`);
    log(`final sanity: ${finalSnap}`);
  } finally {
    await teardown(ctx);
  }

  log(`done. Evidence dir: ${evidenceDir}`);
}

main().catch(err => {
  console.error('[qa-pass5c-a] FAILED:', err);
  process.exit(1);
});
