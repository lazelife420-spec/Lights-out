#!/usr/bin/env node
// Desktop UX Functional Gate: native Electron proof for top menus, shared Start,
// Use Tonight (two Night Modes with restart), and active-run visual focus.
//
// v5 Home/Library/Modes redesign boundary: this proof targets the current
// tile-based Night Modes library, the Home panel as the canonical landing
// route, and the Tonight panel's Start Now CTA. Obsolete .nm-card and
// #ns-hero-title selectors were removed, not the product.
'use strict';

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const ELECTRON_ROOT = path.resolve(__dirname, '..');
const SOURCE_ELECTRON_EXE = path.join(ELECTRON_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const EXE_PATH = process.env.LIGHTS_OUT_DESKTOP_EXE
  ? path.resolve(process.env.LIGHTS_OUT_DESKTOP_EXE)
  : SOURCE_ELECTRON_EXE;
const SOURCE_RUNTIME = path.resolve(EXE_PATH) === path.resolve(SOURCE_ELECTRON_EXE);
const ROOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-desktop-ux-gate-'));
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const WAIT = ms => new Promise(r => setTimeout(r, ms));
const runtimeSessions = [];

function redactArtifactValue(value) {
  if (typeof value === 'string') {
    return value
      .split(ROOT_DIR).join('<gate-root>')
      .split(path.resolve(__dirname, '..', '..')).join('<repo>')
      .split(os.homedir()).join('<home>');
  }
  if (Array.isArray(value)) return value.map(redactArtifactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactArtifactValue(item)]));
  }
  return value;
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8' }).trim(); } catch { return ''; }
}

function requireGate(condition, message, details = null) {
  if (condition) return;
  const suffix = details === null ? '' : `: ${JSON.stringify(details, null, 2)}`;
  throw new Error(`${message}${suffix}`);
}

function cdpList(port) {
  return new Promise((res, rej) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.setTimeout(2000, () => { req.destroy(); rej(new Error('cdp timeout')); });
    req.on('error', rej);
  });
}

class CdpSession {
  constructor(wsUrl, port) {
    this.ws = new WebSocket(wsUrl);
    this.port = port;
    this.pending = new Map();
    this.id = 1;
    this.consoleMessages = [];
    this.exceptions = [];
  }
  async connect() {
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', d => this.onMessage(d));
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  onMessage(data) {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.consoleAPICalled') {
      this.consoleMessages.push({
        type: m.params.type,
        timestamp: m.params.timestamp,
        text: (m.params.args || []).map(arg => arg.value ?? arg.description ?? arg.type).join(' ')
      });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const details = m.params.exceptionDetails || {};
      this.exceptions.push({
        text: details.text || 'Uncaught exception',
        url: details.url || null,
        line: details.lineNumber,
        column: details.columnNumber,
        exception: details.exception?.description || details.exception?.value || null
      });
    }
    if (m.id) {
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
    }
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const i = this.id++;
      this.pending.set(i, { res, rej });
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  eval(expr) { return this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result.value); }
  async click(sel) {
    let rect = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const current = await this.eval(`(function(){const el=document.querySelector('${sel}'); if(!el) return null; el.scrollIntoView({block:'center',inline:'center'}); const r=el.getBoundingClientRect(); const x=r.x+r.width/2; const y=r.y+r.height/2; return {x,y,w:r.width,h:r.height,hit:document.elementFromPoint(x,y)?.closest('${sel}') === el};})()`);
      if (!current || current.w <= 0 || current.h <= 0 || !current.hit) { await WAIT(50); continue; }
      await WAIT(50);
      const settled = await this.eval(`(function(){const el=document.querySelector('${sel}'); if(!el) return null; const r=el.getBoundingClientRect(); const x=r.x+r.width/2; const y=r.y+r.height/2; return {x,y,w:r.width,h:r.height,hit:document.elementFromPoint(x,y)?.closest('${sel}') === el};})()`);
      if (settled && settled.w > 0 && settled.h > 0 && settled.hit && Math.abs(settled.x - current.x) < 0.5 && Math.abs(settled.y - current.y) < 0.5) {
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: settled.x, y: settled.y });
        await WAIT(50);
        const hovered = await this.eval(`(function(){const el=document.querySelector('${sel}'); if(!el) return false; const r=el.getBoundingClientRect(); const x=r.x+r.width/2; const y=r.y+r.height/2; return document.elementFromPoint(x,y)?.closest('${sel}') === el;})()`);
        if (hovered) { rect = settled; break; }
      }
    }
    if (!rect) throw new Error(`missing or unstable ${sel}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await WAIT(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await WAIT(120);
  }
  async clickXY(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await WAIT(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await WAIT(120);
  }
  async movePointer(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await WAIT(80);
  }
  async key(k) {
    const map = { Escape: ['Escape', 27], Enter: ['Enter', 13], ' ': ['Space', 32], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Tab: ['Tab', 9] };
    const [code, keyCode] = map[k] || [k, k.charCodeAt(0)];
    const down = { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    if (k.length === 1 && k.charCodeAt(0) >= 32) down.text = k;
    await this.send('Input.dispatchKeyEvent', down);
    await WAIT(60);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await WAIT(150);
  }
  async screenshot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(r.data, 'base64');
    const p = path.join(SCREENSHOTS_DIR, name);
    fs.writeFileSync(p, buf);
    return { path: p, name, size: buf.length, sha256: sha256(p) };
  }
  async metrics() {
    return this.eval(`({display:{width:window.screen.width,height:window.screen.height},workArea:{width:window.screen.availWidth,height:window.screen.availHeight},outer:{width:window.outerWidth,height:window.outerHeight},inner:{width:window.innerWidth,height:window.innerHeight},dpr:window.devicePixelRatio})`);
  }
  async resize(w, h) {
    try { await this.send('Browser.setWindowBounds', { windowId: 1, bounds: { width: w, height: h } }); } catch {}
    await this.eval(`window.resizeTo(${w}, ${h})`);
    await WAIT(300);
  }
  async waitFor(sel, timeout = 5000) {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      if (await this.eval(`!!document.querySelector('${sel}')`)) return true;
      await WAIT(100);
    }
    throw new Error(`timeout waiting for ${sel}`);
  }
  async condition(fnExpr, timeout = 5000) {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      if (await this.eval(fnExpr)) return true;
      await WAIT(100);
    }
    throw new Error(`timeout condition ${fnExpr}`);
  }
  async rendererDiagnostics() {
    let state = null;
    try {
      state = await this.eval(`({
        href: location.href,
        title: document.title,
        documentReadyState: document.readyState,
        proof: window.__desktopUxProof ? {
          ready: window.__desktopUxProof.ready,
          version: window.__desktopUxProof.version,
          phase: window.__desktopUxProof.phase,
          error: window.__desktopUxProof.error
        } : null,
        route: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null,
        visiblePanels: Array.from(document.querySelectorAll('.ns-main-panel'))
          .filter(panel => getComputedStyle(panel).display !== 'none')
          .map(panel => panel.id),
        openMenus: Array.from(document.querySelectorAll('.menu-item.open')).map(menu => menu.id),
        activeModals: Array.from(document.querySelectorAll('.modal.active')).map(modal => modal.id),
        hero: {
          exists: Boolean(document.getElementById('ns-home-tonight-plan')),
          display: document.getElementById('ns-home-tonight-plan') ? getComputedStyle(document.getElementById('ns-home-tonight-plan')).display : null,
          title: document.getElementById('ns-home-tonight-plan')?.textContent || null
        }
      })`);
    } catch (error) {
      state = { diagnosticEvaluationError: error.message };
    }
    return {
      state,
      consoleMessages: this.consoleMessages.slice(-30),
      exceptions: this.exceptions.slice(-30)
    };
  }
  async waitForRendererReady(timeout = 10000) {
    const startedAt = Date.now();
    let objectObserved = false;
    while (Date.now() - startedAt < timeout) {
      const status = await this.eval(`window.__desktopUxProof ? {
        exists: true,
        ready: window.__desktopUxProof.ready === true,
        version: window.__desktopUxProof.version,
        phase: window.__desktopUxProof.phase,
        error: window.__desktopUxProof.error
      } : { exists: false }`);
      objectObserved ||= status.exists;
      if (status.ready) return status;
      if (status.error || status.phase === 'initialization-failed') {
        const diagnostics = await this.rendererDiagnostics();
        throw new Error(`renderer initialization failed: ${JSON.stringify(diagnostics, null, 2)}`);
      }
      await WAIT(100);
    }
    const diagnostics = await this.rendererDiagnostics();
    throw new Error(`renderer-ready timeout (proof object observed: ${objectObserved}): ${JSON.stringify(diagnostics, null, 2)}`);
  }
}

async function stopApp(child) {
  if (!child) return;
  try { child.cdpSession?.ws?.terminate(); } catch {}
  const exited = await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(true);
    };
    child.once('exit', finish);
    try { child.kill(); } catch { finish(); }
    setTimeout(() => {
      if (settled) return;
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true });
      killer.once('error', finish);
      killer.once('close', finish);
    }, 1000);
    setTimeout(finish, 3000);
  });
  return exited;
}

async function spawnApp(userDataDir, seed = {}, { preserveSettings = false } = {}) {
  const port = await getAvailablePort();
  fs.mkdirSync(userDataDir, { recursive: true });
  const settingsPath = path.join(userDataDir, 'settings.json');
  if (!preserveSettings || !fs.existsSync(settingsPath)) {
    const base = { app: { dryRun: true, nsActiveTab: 'lib', onboarded: true } };
    if (seed.app) Object.assign(base.app, seed.app);
    fs.writeFileSync(settingsPath, JSON.stringify(base, null, 2));
  }
  const launchArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-gpu'
  ];
  if (SOURCE_RUNTIME) launchArgs.push(ELECTRON_ROOT);
  launchArgs.push('--desktop-ux-proof');
  const child = spawn(EXE_PATH, launchArgs, { detached: true, windowsHide: true, env: { ...process.env, LIGHTS_OUT_DESKTOP_UX_GATE: '1' } });
  let list = [];
  for (let i = 0; i < 40; i++) {
    try { list = await cdpList(port); if (list.length) break; } catch {}
    await WAIT(250);
  }
  if (!list.length) { try { child.kill(); } catch {} throw new Error('Electron did not expose CDP'); }
  const page = list.find(x => x.type === 'page' || x.title === 'Lights Out') || list[0];
  const session = new CdpSession(page.webSocketDebuggerUrl, port);
  await session.connect();
  const renderer = await session.waitForRendererReady();
  child.cdpSession = session;
  runtimeSessions.push({ label: path.basename(userDataDir), userDataDir, port, renderer, session });
  return { child, session, userDataDir, port, renderer };
}

const report = {
  startTime: new Date().toISOString(),
  branch: git('rev-parse --abbrev-ref HEAD'),
  sha: git('rev-parse HEAD'),
  runtime: SOURCE_RUNTIME ? 'source-electron' : 'packaged',
  exe: EXE_PATH,
  exeSha256: sha256(EXE_PATH),
  phases: {},
  screenshots: []
};

function addShot(phase, s) {
  report.screenshots.push({ phase, ...s });
  return s;
}

async function clearStarts(s) { await s.eval('window.__desktopUxProof?.clearStartInvocations()'); }
async function getStarts(s) { return s.eval('window.__desktopUxProof?.getStartInvocations()'); }
async function getRealPowerActions(s) { return s.eval('window.__desktopUxProof?.getRealPowerActions()'); }
async function getDebug(s) { return s.eval(`({ running: state.running, paused: state.paused, action: state.action, dryRun: state.dryRun, input: document.getElementById('timer-input').value, invocations: window.__desktopUxProof?.getStartInvocations() })`); }
async function getTopMenuKeyboardState(s) {
  return s.eval(`({
    focusedElement: { id: document.activeElement?.id || null, text: document.activeElement?.textContent?.trim() || null, role: document.activeElement?.getAttribute('role') || null },
    settingsMenuOpen: document.getElementById('menu-settings')?.classList.contains('open') || false,
    settingsAriaExpanded: document.getElementById('menu-settings')?.getAttribute('aria-expanded') || null,
    selectedMenuItem: document.activeElement?.closest?.('.submenu-item')?.id || null,
    route: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null,
    visiblePanels: Array.from(document.querySelectorAll('.ns-main-panel')).filter(panel => getComputedStyle(panel).display !== 'none').map(panel => panel.id),
    settingsVisible: getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none',
    recentEvents: (window.__desktopUxGateEvents || []).slice(-20)
  })`);
}

async function installTopMenuEventTrace(s) {
  await s.eval(`(() => {
    const events = [];
    const add = event => events.push({
      type: event.type,
      target: event.target?.id || event.target?.className || event.target?.tagName || null,
      activeElement: document.activeElement?.id || null,
      openMenus: Array.from(document.querySelectorAll('.menu-item.open')).map(menu => menu.id),
      settingsAriaExpanded: document.getElementById('menu-settings')?.getAttribute('aria-expanded') || null,
      at: performance.now()
    });
    ['blur', 'focus', 'focusin', 'focusout', 'mousedown', 'mouseup', 'click', 'mouseenter', 'mouseleave', 'mousemove'].forEach(type => window.addEventListener(type, add, true));
    window.__desktopUxGateEvents = events;
  })()`);
}

async function getStartupSnapshot(s) {
  return s.eval(`({
    route: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null,
    visiblePanel: Array.from(document.querySelectorAll('.ns-main-panel')).find(panel => getComputedStyle(panel).display !== 'none')?.id || null,
    settingsVisible: getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none',
    settingsEverVisible: window.__desktopUxProof.startup.settingsEverVisible,
    startupVisibility: window.__desktopUxProof.startup.settingsVisibility,
    dryRun: state.dryRun,
    heroTitle: document.getElementById('ns-home-tonight-plan')?.textContent || null
  })`);
}

async function runStartupGate() {
  const phase = 'startup';
  const results = [];
  for (const scenario of [
    { name: 'normal', nsActiveTab: 'home' },
    { name: 'legacy-settings', nsActiveTab: 'set' },
    { name: 'legacy-help', nsActiveTab: 'help' }
  ]) {
    const userData = path.join(ROOT_DIR, `userdata-startup-${scenario.name}`);
    const { child, session: s } = await spawnApp(userData, { app: { nsActiveTab: scenario.nsActiveTab } });
    try {
      const snapshot = await getStartupSnapshot(s);
      const persisted = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
      const result = { scenario: scenario.name, seeded: scenario.nsActiveTab, snapshot, persistedTab: persisted.app?.nsActiveTab };
      requireGate(snapshot.route === 'home', `${scenario.name} did not land on Home`, result);
      requireGate(snapshot.visiblePanel === 'ns-panel-home', `${scenario.name} did not show the Home panel`, result);
      requireGate(!snapshot.settingsVisible && !snapshot.settingsEverVisible, `${scenario.name} flashed or showed Settings during startup`, result);
      requireGate(snapshot.dryRun === true, `${scenario.name} did not preserve Dry Run`, result);
      requireGate(persisted.app?.nsActiveTab === 'home', `${scenario.name} did not persist the safe Home route`, result);
      results.push(result);
    } finally {
      await stopApp(child);
    }
  }

  const returnUserData = path.join(ROOT_DIR, 'userdata-startup-settings-return');
  const first = await spawnApp(returnUserData, { app: { nsActiveTab: 'home' } });
  try {
    await first.session.click('[data-ns-tab="set"]');
    await first.session.condition(`getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none'`);
    await first.session.click('#modal-close');
    await first.session.condition(`getComputedStyle(document.getElementById('ns-panel-home')).display !== 'none'`);
  } finally {
    await stopApp(first.child);
  }
  const second = await spawnApp(returnUserData, {}, { preserveSettings: true });
  try {
    const snapshot = await getStartupSnapshot(second.session);
    requireGate(snapshot.route === 'home' && snapshot.visiblePanel === 'ns-panel-home', 'closing Settings altered the next startup route', snapshot);
    requireGate(!snapshot.settingsVisible && !snapshot.settingsEverVisible, 'Settings flashed after a prior open/close cycle', snapshot);
    results.push({ scenario: 'settings-close-restart', snapshot });
  } finally {
    await stopApp(second.child);
  }
  report.phases[phase] = { status: 'passed', results };
}

async function runTopMenuGate() {
  const phase = 'top-menu';
  const userData = path.join(ROOT_DIR, 'userdata-topmenu');
  const { child, session: s } = await spawnApp(userData);
  const results = { mouse: [], keyboard: [], assertions: [] };
  report.phases[phase] = { status: 'running', results };
  try {
    await s.resize(1280, 720);
    await s.waitFor('#menu-power');
    await WAIT(400);
    await installTopMenuEventTrace(s);

    await s.click('#menu-power > span');
    await WAIT(200);
    const powerAfterClick = await s.eval(`({
      open: document.getElementById('menu-power').classList.contains('open'),
      ariaExpanded: document.getElementById('menu-power').getAttribute('aria-expanded'),
      focusedElement: document.activeElement?.id || null,
      recentEvents: (window.__desktopUxGateEvents || []).slice(-20)
    })`);
    let open = powerAfterClick.open;
    results.mouse.push({ step: 'click-power', ...powerAfterClick });
    requireGate(open, 'Power menu did not open on click', powerAfterClick);
    addShot(phase, await s.screenshot('topmenu-power-mouse-open.png'));

    await s.click('#menu-power > span');
    await WAIT(200);
    open = await s.eval(`!document.querySelector('.menu-item.open')`);
    results.mouse.push({ step: 'click-power-again', closed: open });
    requireGate(open, 'Power trigger did not toggle closed');

    await s.click('#menu-settings > span');
    await WAIT(200);
    open = await s.eval(`document.getElementById('menu-settings').classList.contains('open')`);
    addShot(phase, await s.screenshot('topmenu-settings-mouse-open.png'));
    results.mouse.push({ step: 'click-settings', open });
    requireGate(open, 'Settings menu did not open on click');

    await s.click('#menu-help > span');
    await WAIT(200);
    const settingsClosed = await s.eval(`!document.getElementById('menu-settings').classList.contains('open')`);
    const helpOpen = await s.eval(`document.getElementById('menu-help').classList.contains('open')`);
    results.mouse.push({ step: 'click-help-closes-settings', settingsClosed, helpOpen });
    requireGate(settingsClosed && helpOpen, 'opening Help did not close Settings');
    addShot(phase, await s.screenshot('topmenu-help-mouse-open.png'));

    await s.click('#menu-settings > span');
    await s.condition(`document.getElementById('menu-settings').classList.contains('open')`);
    const menuRect = await s.eval(`(r=document.querySelector('#menu-settings .submenu').getBoundingClientRect(),{x:r.x+r.width/2,y:r.y+10})`);
    const beforePointerTransfer = await getTopMenuKeyboardState(s);
    await s.movePointer(menuRect.x, menuRect.y);
    await WAIT(200);
    const afterPointerTransfer = await getTopMenuKeyboardState(s);
    const stillOpen = afterPointerTransfer.settingsMenuOpen;
    results.mouse.push({ step: 'pointer-transfer-stays-open', menuRect, beforePointerTransfer, afterPointerTransfer, stillOpen });
    requireGate(stillOpen, 'menu closed while pointer entered its submenu', afterPointerTransfer);
    await s.movePointer(20, 20);
    await WAIT(200);
    const afterPointerAway = await getTopMenuKeyboardState(s);
    const stillOpen2 = afterPointerAway.settingsMenuOpen;
    results.mouse.push({ step: 'pointer-away-stays-open', afterPointerAway, stillOpen2 });
    requireGate(stillOpen2, 'menu closed before an outside click', afterPointerAway);

    await s.click('#open-options');
    await WAIT(300);
    const settingsVisible = await s.eval(`document.getElementById('ns-panel-set').style.display !== 'none'`);
    results.mouse.push({ step: 'advanced-options-opens-settings', settingsVisible });
    requireGate(settingsVisible, 'Advanced Options did not open the Settings workspace');
    addShot(phase, await s.screenshot('topmenu-settings-panel.png'));
    await s.eval(`document.getElementById('modal-close').click()`);
    await WAIT(300);
    const restored = await s.eval(`document.querySelector('.ns-nav-item.active')?.dataset.nsTab`);
    results.mouse.push({ step: 'close-restores-route', restored });
    requireGate(restored === 'lib', 'closing Settings did not restore Tonight', restored);

    await s.click('#menu-settings > span');
    await s.click('#toggle-dryrun');
    await WAIT(200);
    const dryRunIndicator = await s.eval(`document.querySelector('#toggle-dryrun .toggle-indicator').textContent`);
    results.mouse.push({ step: 'toggle-dryrun', dryRunIndicator });
    requireGate(dryRunIndicator === 'OFF', 'enabled Settings toggle did not activate', dryRunIndicator);
    await s.click('#menu-settings > span');
    await s.click('#toggle-dryrun');
    await s.condition(`state.dryRun === true`);

    await s.click('#menu-power > span');
    const outside = await s.eval(`(r=document.getElementById('ns-home-tonight-plan').getBoundingClientRect(), {x:r.x+r.width/2, y:r.y+r.height/2})`);
    await s.clickXY(outside.x, outside.y);
    await WAIT(200);
    const allClosed = await s.eval(`!document.querySelector('.menu-item.open')`);
    results.mouse.push({ step: 'outside-click-closes', allClosed });
    requireGate(allClosed, 'outside click did not close top menu');

    await clearStarts(s);
    await s.click('#menu-power > span');
    await s.click('#menu-power [data-action="shutdown"]');
    const powerSelection = await s.eval(`({ action: state.action, dryRun: state.dryRun, warningOpen: document.getElementById('warning-modal')?.classList.contains('active') || false })`);
    const startsAfterPowerSelection = await getStarts(s);
    const realPowerActions = await getRealPowerActions(s);
    requireGate(powerSelection.action === 'shutdown' && powerSelection.dryRun === true, 'Power selection changed safety state', powerSelection);
    requireGate(startsAfterPowerSelection.length === 0 && realPowerActions.length === 0, 'Power menu selection bypassed the shared Start/confirmation path', { startsAfterPowerSelection, realPowerActions });
    results.mouse.push({ step: 'power-selects-plan-without-execution', powerSelection, starts: startsAfterPowerSelection.length, realPowerActions: realPowerActions.length });

    await s.click('#menu-help > span');
    await s.click('#open-about');
    const aboutOpen = await s.eval(`document.getElementById('about-modal')?.classList.contains('active') || false`);
    requireGate(aboutOpen, 'enabled Help item did not activate');
    await s.eval(`document.getElementById('about-modal')?.classList.remove('active')`);
    results.mouse.push({ step: 'help-item-activates', aboutOpen });

    // Keyboard navigation
    await s.eval(`document.getElementById('menu-power').focus()`);
    await s.key('Enter');
    await WAIT(200);
    const powerOpen = await s.eval(`document.getElementById('menu-power').classList.contains('open')`);
    addShot(phase, await s.screenshot('topmenu-power-keyboard-open.png'));
    results.keyboard.push({ step: 'enter-opens-power', powerOpen });
    requireGate(powerOpen, 'Enter did not open Power');

    await s.key('ArrowDown');
    await WAIT(200);
    const focusedItem = await s.eval(`({ text: document.activeElement?.textContent?.trim(), action: document.activeElement?.dataset?.action || null })`);
    results.keyboard.push({ step: 'arrow-down-to-item', focusedItem });
    requireGate(focusedItem.action === 'restart', 'ArrowDown did not move to the next Power item', focusedItem);
    await s.key('ArrowUp');
    await WAIT(200);
    const focusedAfterUp = await s.eval(`({ text: document.activeElement?.textContent?.trim(), action: document.activeElement?.dataset?.action || null })`);
    results.keyboard.push({ step: 'arrow-up', focusedItem: focusedAfterUp });
    requireGate(focusedAfterUp.action === 'shutdown', 'ArrowUp did not move to the previous Power item', focusedAfterUp);
    await s.key('Escape');
    await WAIT(200);
    const closedByEscape = await s.eval(`!document.querySelector('.menu-item.open') && document.activeElement?.id === 'menu-power'`);
    results.keyboard.push({ step: 'escape-closes-and-focuses-trigger', closedByEscape });
    requireGate(closedByEscape, 'Escape did not close Power and return focus');

    await clearStarts(s);
    await s.eval(`document.getElementById('menu-settings').focus()`);
    await s.key('ArrowDown');
    await s.condition(`document.getElementById('menu-settings').classList.contains('open') && document.activeElement?.id === 'toggle-dryrun'`);
    const settingsOpen = await getTopMenuKeyboardState(s);
    results.keyboard.push({ step: 'arrow-down-opens-settings', ...settingsOpen });
    requireGate(settingsOpen.settingsMenuOpen && settingsOpen.settingsAriaExpanded === 'true' && settingsOpen.selectedMenuItem === 'toggle-dryrun', 'ArrowDown did not open Settings and focus the first menu item', settingsOpen);
    await s.key('ArrowUp');
    const beforeEnter = await getTopMenuKeyboardState(s);
    results.keyboard.push({ step: 'before-enter-on-open-options', ...beforeEnter });
    requireGate(beforeEnter.settingsMenuOpen && beforeEnter.settingsAriaExpanded === 'true' && beforeEnter.selectedMenuItem === 'open-options', 'Advanced Options was not focused before Enter', beforeEnter);
    await s.key('Enter');
    await s.condition(`getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none' && document.querySelector('.ns-nav-item.active')?.dataset?.nsTab === 'set'`);
    const afterEnter = await getTopMenuKeyboardState(s);
    const startsAfterKeyboard = await getStarts(s);
    const realPowerActionsAfterKeyboard = await getRealPowerActions(s);
    results.keyboard.push({ step: 'enter-on-open-options', ...afterEnter, starts: startsAfterKeyboard.length, realPowerActions: realPowerActionsAfterKeyboard.length });
    requireGate(afterEnter.settingsVisible && afterEnter.route === 'set', 'Enter did not activate the focused Advanced Options item', afterEnter);
    requireGate(startsAfterKeyboard.length === 0 && realPowerActionsAfterKeyboard.length === 0, 'menu keyboard input started a timer or attempted a power action', { startsAfterKeyboard, realPowerActionsAfterKeyboard });
    addShot(phase, await s.screenshot('topmenu-settings-keyboard-open.png'));

    report.phases[phase] = { status: 'passed', results };
  } finally {
    await stopApp(child);
  }
}

async function runSharedStartGate() {
  const phase = 'shared-start';
  const userData = path.join(ROOT_DIR, 'userdata-shared');
  const { child, session: s } = await spawnApp(userData);
  try {
    await s.resize(1280, 720);
    await s.waitFor('#btn-start-custom');
    await clearStarts(s);
    await WAIT(400);
    const results = [];

    await s.eval(`document.getElementById('timer-input').value = '2'; document.getElementById('timer-input').dispatchEvent(new Event('input'));`);
    await WAIT(200);
    await clearStarts(s);
    await s.click('#btn-start-custom');
    let running = false;
    for (let i = 0; i < 30; i++) { await WAIT(200); running = await s.eval('state.running'); if (running) break; }
    if (!running) {
      const debug = await getDebug(s);
      console.error('hero click did not start:', JSON.stringify(debug, null, 2));
      throw new Error('btn-start-custom did not start timer: ' + JSON.stringify(debug));
    }
    const heroInvocations = await getStarts(s);
    requireGate(heroInvocations.length === 1, 'hero Start dispatched a duplicate or missing payload', heroInvocations);
    requireGate(heroInvocations[0]?.options?.startOrigin === 'play' && heroInvocations[0]?.options?.dryRun === true, 'hero Start payload violated shared Start/Dry Run contract', heroInvocations[0]);
    let heroReceipt = null;
    try { heroReceipt = await s.eval('window.electronAPI.getLatestReceipt()'); } catch {}
    results.push({ control: 'btn-start-custom', invocations: heroInvocations.length, payload: heroInvocations[0], receipt: heroReceipt });
    addShot(phase, await s.screenshot('active-running-hero.png'));
    await s.eval(`window.electronAPI.cancelTimer()`);
    await WAIT(800);

    await clearStarts(s);
    await s.key(' ');
    running = false;
    for (let i = 0; i < 30; i++) { await WAIT(200); running = await s.eval('state.running'); if (running) break; }
    if (!running) {
      const debug = await getDebug(s);
      console.error('space did not start:', JSON.stringify(debug, null, 2));
      throw new Error('space did not start timer: ' + JSON.stringify(debug));
    }
    const spaceInvocations = await getStarts(s);
    requireGate(spaceInvocations.length === 1, 'Space Start dispatched a duplicate or missing payload', spaceInvocations);
    requireGate(spaceInvocations[0]?.options?.startOrigin === 'play' && spaceInvocations[0]?.options?.dryRun === true, 'Space payload diverged from shared Start contract', spaceInvocations[0]);
    let spaceReceipt = null;
    try { spaceReceipt = await s.eval('window.electronAPI.getLatestReceipt()'); } catch {}
    results.push({ control: 'space-key', invocations: spaceInvocations.length, payload: spaceInvocations[0], receipt: spaceReceipt });
    await s.eval(`window.electronAPI.cancelTimer()`);
    await WAIT(800);

    // Restart to load morning proof (receipt) and replay through the canonical Start Now CTA
    await stopApp(child);
    const { child: child2, session: s2 } = await spawnApp(userData);
    try {
      await s2.resize(1280, 720);
      await s2.waitFor('#morning-proof-section');
      await clearStarts(s2);
      await WAIT(500);
      const proofDisplay = await s2.eval(`document.getElementById('morning-proof-section').style.display`);
      requireGate(proofDisplay !== 'none', 'Morning Proof replay control was not visible');
      addShot(phase, await s2.screenshot('morning-proof-visible.png'));
      await clearStarts(s2);
      await s2.click('#btn-start-custom');
      let running2 = false;
      for (let i = 0; i < 30; i++) { await WAIT(200); running2 = await s2.eval('state.running'); if (running2) break; }
      if (!running2) {
        const debug = await s2.eval(`({ running: state.running, paused: state.paused, action: state.action, dryRun: state.dryRun, input: document.getElementById('timer-input').value, invocations: window.__startInvocations, proofDisplay: document.getElementById('morning-proof-section')?.style.display })`);
        console.error('btn-start-custom replay did not start:', JSON.stringify(debug, null, 2));
        throw new Error('btn-start-custom did not start replay timer: ' + JSON.stringify(debug));
      }
      const againInvocations = await getStarts(s2);
      requireGate(againInvocations.length === 1, 'proof replay dispatched a duplicate or missing payload', againInvocations);
      requireGate(againInvocations[0]?.options?.startOrigin === 'play' && againInvocations[0]?.options?.dryRun === true, 'proof replay payload diverged from shared Start contract', againInvocations[0]);
      let againReceipt = null;
      try { againReceipt = await s2.eval('window.electronAPI.getLatestReceipt()'); } catch {}
      results.push({ control: 'btn-start-custom', invocations: againInvocations.length, payload: againInvocations[0], receipt: againReceipt });
      report.phases[phase] = { status: 'passed', results, proofDisplay };
    } finally {
      await stopApp(child2);
    }
  } finally {
    await stopApp(child);
  }
}

async function armAndStartMode(s, modeId, phase) {
  const expected = {
    'movie-wind-down': { title: 'Movie Wind-Down', durationSeconds: 5400, action: 'sleep', ritualId: 'standard' },
    'full-shutdown': { title: 'Full Shutdown', durationSeconds: 3600, action: 'shutdown', ritualId: 'standard' }
  }[modeId];
  const results = { modeId };
  await s.eval(`document.querySelector('[data-ns-tab="modes"]').click()`);
  await s.waitFor('#nm-ready-grid .nm-tile');
  await s.eval(`document.querySelector('.nm-tile[data-mode-id="${modeId}"]').click()`);
  await s.condition(`document.getElementById('nm-featured-content').style.display !== 'none' && !document.getElementById('nm-btn-use-tonight').disabled`, 3000);
  await s.eval(`document.getElementById('nm-btn-use-tonight').click()`);
  await s.condition(`state.armedNightMode !== null && state.armedNightMode.nightModeId === '${modeId}'`, 3000);
  results.armed = await s.eval(`state.armedNightMode ? { id: state.armedNightMode.nightModeId, title: state.armedNightMode.nightModeTitle, durationSeconds: state.armedNightMode.durationSeconds, action: state.armedNightMode.action } : null`);
  results.hero = await s.eval(`({
    title: document.getElementById('armed-mode-title')?.textContent || '',
    playLabel: document.getElementById('btn-start-custom')?.textContent?.trim() || '',
    duration: document.getElementById('timer-input')?.value || '',
    action: state.action || '',
    endTime: document.getElementById('end-time')?.textContent || '',
    ritual: document.getElementById('armed-mode-meta')?.textContent || ''
  })`);
  requireGate(results.armed?.id === modeId && results.armed?.title === expected.title, `${modeId} did not become the authoritative selected plan`, results);
  requireGate(results.armed?.durationSeconds === expected.durationSeconds && results.armed?.action === expected.action, `${modeId} selected-plan execution values drifted`, results);
  requireGate(results.hero.title.includes(expected.title) && results.hero.duration === String(expected.durationSeconds / 60), `${modeId} hero title/duration did not project selected plan`, results.hero);
  requireGate(results.hero.action === expected.action && results.hero.playLabel === 'Start Now', `${modeId} hero action/CTA did not project selected plan`, results.hero);
  requireGate(results.hero.ritual.includes('Standard ritual'), `${modeId} ritual steps were not projected`, results.hero);
  addShot(phase, await s.screenshot(`${phase}-${modeId}-projection.png`));
  await clearStarts(s);
  await s.click('#btn-start-custom');
  await s.condition(`state.running`, 3000);
  const invocations = await getStarts(s);
  results.startCount = invocations.length;
  results.startPayload = invocations[0] || null;
  results.active = await s.eval(`({
    modeTitle: document.getElementById('armed-mode-title')?.textContent || null,
    timerLabel: document.getElementById('timer-label')?.textContent || null,
    dryRun: state.dryRun,
    controls: {
      pause: getComputedStyle(document.getElementById('btn-pause')).display,
      snoozeDisabled: document.getElementById('btn-snooze').disabled,
      cancel: getComputedStyle(document.getElementById('btn-stop')).display
    }
  })`);
  requireGate(invocations.length === 1, `${modeId} dispatched a duplicate or missing Start payload`, invocations);
  requireGate(invocations[0]?.options?.nightModeId === modeId, `${modeId} Start payload lost canonical identity`, invocations[0]);
  requireGate(invocations[0]?.options?.durationSeconds === expected.durationSeconds && invocations[0]?.options?.action === expected.action, `${modeId} Start payload diverged from selected plan`, invocations[0]);
  requireGate(invocations[0]?.options?.dryRun === true, `${modeId} Start payload lost Dry Run`, invocations[0]);
  requireGate(results.active.modeTitle === expected.title && results.active.dryRun === true, `${modeId} active-run title/safety state drifted`, results.active);
  requireGate(results.active.controls.pause !== 'none' && !results.active.controls.snoozeDisabled && results.active.controls.cancel !== 'none', `${modeId} active-run controls are not visible`, results.active);
  addShot(phase, await s.screenshot(`${phase}-${modeId}-running.png`));
  // Standard-ritual modes must reach the 'timer' step before beginValidatedCountdown
  // creates a receipt. Advance the ritual until a running receipt appears.
  let receipt = null;
  const ritualTrace = [];
  for (let i = 0; i < 10; i++) {
    receipt = await s.eval(`window.electronAPI.getLatestReceipt()`);
    if (receipt && receipt.result === 'running') break;
    const ritualState = await s.eval(`window.electronAPI.ritualState()`);
    ritualTrace.push(ritualState);
    if (!ritualState?.active) break;
    await s.eval(`window.electronAPI.ritualAdvance()`);
    await WAIT(500);
  }
  results.ritualTrace = ritualTrace;
  requireGate(receipt && receipt.result === 'running', `${modeId} did not create a running receipt at the ritual timer step`, ritualTrace);
  await s.eval(`window.electronAPI.cancelTimer()`);
  await WAIT(800);
  receipt = await s.eval(`window.electronAPI.getLatestReceipt()`);
  results.receipt = receipt ? {
    receiptId: receipt.id,
    nightModeId: receipt.nightModeId,
    modeTitle: receipt.nightModeTitle,
    durationSeconds: receipt.durationSeconds,
    finalAction: receipt.action,
    dryRun: receipt.dryRun,
    startedAt: receipt.startedAt,
    endedAt: receipt.endedAt,
    result: receipt.result,
    cancelled: receipt.result === 'cancelled',
    powerActionAttempted: !!receipt.powerCommand
  } : null;
  requireGate(results.receipt?.nightModeId === modeId, `${modeId} receipt identity is missing or wrong`, results.receipt);
  requireGate(results.receipt?.durationSeconds === expected.durationSeconds && results.receipt?.finalAction === expected.action, `${modeId} receipt execution values drifted`, results.receipt);
  requireGate(results.receipt?.dryRun === true && results.receipt?.powerActionAttempted === false, `${modeId} receipt violated Dry Run/power safety`, results.receipt);
  const realPowerActions = await getRealPowerActions(s);
  requireGate(realPowerActions.length === 0, `${modeId} attempted a real power action`, realPowerActions);
  results.realPowerActions = realPowerActions.length;
  addShot(phase, await s.screenshot(`${phase}-${modeId}-cancelled.png`));
  return results;
}

async function runUseTonightGate() {
  const phase = 'use-tonight';
  const modes = ['movie-wind-down', 'full-shutdown'];
  const results = [];
  for (const modeId of modes) {
    const userData = path.join(ROOT_DIR, `userdata-use-${modeId}`);
    const { child, session: s } = await spawnApp(userData);
    try {
      const r = await armAndStartMode(s, modeId, phase);
      results.push(r);
    } finally {
      await stopApp(child);
    }
    // Restart and verify armed Night Mode restores
    await WAIT(1500);
    const { child: child2, session: s2 } = await spawnApp(userData, {}, { preserveSettings: true });
    try {
      await s2.resize(1280, 720);
      await s2.waitFor('#btn-start-custom');
      await WAIT(800);
      const restored = await s2.eval(`state.armedNightMode ? { id: state.armedNightMode.nightModeId, title: state.armedNightMode.nightModeTitle, durationSeconds: state.armedNightMode.durationSeconds, action: state.armedNightMode.action } : null`);
      const hero2 = await s2.eval(`({ title: document.getElementById('armed-mode-title')?.textContent || '', playLabel: document.getElementById('btn-start-custom')?.textContent?.trim() || '', duration: document.getElementById('timer-input')?.value || '', action: state.action || '' })`);
      const expected = modeId === 'movie-wind-down'
        ? { title: 'Movie Wind-Down', durationSeconds: 5400, action: 'sleep' }
        : { title: 'Full Shutdown', durationSeconds: 3600, action: 'shutdown' };
      requireGate(restored?.id === modeId && restored?.title === expected.title, `${modeId} did not restore after restart`, restored);
      requireGate(restored?.durationSeconds === expected.durationSeconds && restored?.action === expected.action, `${modeId} restored execution values drifted`, restored);
      requireGate(hero2.title.includes(expected.title) && hero2.playLabel === 'Start Now', `${modeId} restored hero projection drifted`, hero2);
      addShot(phase, await s2.screenshot(`${phase}-${modeId}-restore.png`));
      results.push({ modeId, restart: true, restored, hero: hero2 });
    } finally {
      await stopApp(child2);
    }
  }
  report.phases[phase] = { status: 'passed', results };
}

async function runSettingsGate() {
  const phase = 'settings';
  const userData = path.join(ROOT_DIR, 'userdata-settings');
  const { child, session: s } = await spawnApp(userData);
  try {
    await s.click('[data-ns-tab="modes"]');
    await s.click('[data-ns-tab="set"]');
    await s.condition(`getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none'`);
    const results = [];
    for (const size of [
      { label: '1280x720', width: 1280, height: 720 },
      { label: '1920x1080', width: 1920, height: 1080 },
      { label: 'ultrawide', width: 2752, height: 1152 }
    ]) {
      await s.resize(size.width, size.height);
      await WAIT(300);
      const layout = await s.eval(`({
        route: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null,
        settingsDisplay: getComputedStyle(document.getElementById('ns-panel-set')).display,
        tonightDisplay: getComputedStyle(document.getElementById('ns-panel-lib')).display,
        railDisplay: getComputedStyle(document.querySelector('.settings-rail')).display,
        activeCategories: document.querySelectorAll('.settings-rail-btn.active').length,
        visibleCategories: Array.from(document.querySelectorAll('.settings-categories .option-section[data-settings-category]'))
          .filter(section => getComputedStyle(section).display !== 'none').length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        panelRect: (() => { const r = document.querySelector('.settings-panel').getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right }; })()
      })`);
      requireGate(layout.route === 'set' && layout.settingsDisplay !== 'none', `Settings sidebar state is wrong at ${size.label}`, layout);
      requireGate(layout.tonightDisplay === 'none', `Tonight remains beneath Settings at ${size.label}`, layout);
      requireGate(layout.railDisplay !== 'none' && layout.activeCategories === 1 && layout.visibleCategories === 1, `Settings category workspace is not single-panel at ${size.label}`, layout);
      requireGate(!layout.horizontalOverflow, `Settings horizontally overflows at ${size.label}`, layout);
      addShot(phase, await s.screenshot(`settings-${size.label}.png`));
      results.push({ ...size, layout });
    }

    for (const category of ['power-safety', 'protection', 'appearance', 'advanced']) {
      await s.click(`[data-settings-category="${category}"]`);
      const selected = await s.eval(`({
        rail: document.querySelector('.settings-rail-btn.active')?.dataset?.settingsCategory || null,
        content: document.querySelector('.settings-category-active')?.dataset?.settingsCategory || null,
        activeSections: document.querySelectorAll('.settings-category-active').length,
        distinctActiveCategories: new Set(Array.from(document.querySelectorAll('.settings-category-active')).map(section => section.dataset.settingsCategory)).size
      })`);
      requireGate(selected.rail === category && selected.content === category && selected.distinctActiveCategories === 1 && selected.activeSections >= 1, `Settings category ${category} did not become the only selected workspace`, selected);
      results.push({ category, selected });
    }

    await s.click('#modal-close');
    await s.condition(`getComputedStyle(document.getElementById('ns-panel-modes')).display !== 'none'`);
    const returnRoute = await s.eval(`document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null`);
    requireGate(returnRoute === 'modes', 'Settings return navigation did not restore the prior primary view', returnRoute);
    results.push({ returnRoute });
    report.phases[phase] = { status: 'passed', results };
  } finally {
    await stopApp(child);
  }
}

async function runActiveRunGate() {
  const phase = 'active-run';
  const userData = path.join(ROOT_DIR, 'userdata-active');
  const { child, session: s } = await spawnApp(userData);
  try {
    await s.click('[data-ns-tab="modes"]');
    await s.waitFor('#nm-ready-grid');
    await WAIT(300);
    await s.click('.nm-tile[data-mode-id="movie-wind-down"]');
    await WAIT(300);
    await s.click('#nm-btn-use-tonight');
    await WAIT(300);
    await s.click('#btn-start-custom');
    await s.condition(`state.running`, 3000);

    const sizes = [
      { label: 'hd720', w: 1280, h: 720 },
      { label: 'hd1080', w: 1920, h: 1080 },
      { label: 'workarea', w: 2752, h: 1152 }
    ];
    const results = [];
    for (const { label, w, h } of sizes) {
      await s.resize(w, h);
      await WAIT(400);
      const m = await s.metrics();
      addShot(phase, await s.screenshot(`active-run-${label}.png`));
      const focused = await s.eval(`({
        modeTitle: document.getElementById('armed-mode-title')?.textContent || null,
        dryRunText: document.getElementById('status-pill')?.textContent || null,
        profilesHidden: getComputedStyle(document.getElementById('profiles-section')).display === 'none',
        streakHidden: !document.getElementById('streak-callout') || getComputedStyle(document.getElementById('streak-callout')).display === 'none',
        proofHidden: getComputedStyle(document.getElementById('morning-proof-section')).display === 'none',
        pauseVisible: getComputedStyle(document.getElementById('action-bar-running')).display !== 'none',
        snoozeVisible: getComputedStyle(document.getElementById('action-bar-running')).display !== 'none' && !document.getElementById('btn-snooze').disabled,
        cancelVisible: getComputedStyle(document.getElementById('action-bar-running')).display !== 'none'
      })`);
      requireGate(focused.modeTitle === 'Movie Wind-Down', `active mode title is not dominant at ${label}`, focused);
      requireGate(focused.dryRunText.includes('Dry Run'), `Dry Run is not prominent at ${label}`, focused);
      requireGate(focused.profilesHidden && focused.streakHidden && focused.proofHidden, `idle-only content remains visible at ${label}`, focused);
      requireGate(focused.pauseVisible && focused.snoozeVisible && focused.cancelVisible, `active controls are incomplete at ${label}`, focused);
      results.push({ label, metrics: m, focused });
    }

    await s.eval(`document.getElementById('btn-pause').click()`);
    await s.condition(`state.paused`, 3000);
    await s.resize(1280, 720);
    await WAIT(300);
    addShot(phase, await s.screenshot('active-paused-1280x720.png'));
    const pauseLabel = await s.eval(`document.getElementById('btn-pause').querySelector('span:last-child').textContent`);
    const pausedText = await s.eval(`document.getElementById('timer-label').textContent`);
    const pausedFocus = await s.eval(`({
      profilesHidden: getComputedStyle(document.getElementById('profiles-section')).display === 'none',
      streakHidden: !document.getElementById('streak-callout') || getComputedStyle(document.getElementById('streak-callout')).display === 'none',
      proofHidden: getComputedStyle(document.getElementById('morning-proof-section')).display === 'none',
      cancelVisible: getComputedStyle(document.getElementById('btn-stop')).display !== 'none'
    })`);
    requireGate(pauseLabel === 'Resume' && /paused/i.test(pausedText), 'paused state did not remain focused', { pauseLabel, pausedText, pausedFocus });
    requireGate(pausedFocus.profilesHidden && pausedFocus.streakHidden && pausedFocus.proofHidden && pausedFocus.cancelVisible, 'paused state restored idle clutter or hid Cancel', pausedFocus);
    results.push({ state: 'paused', pauseLabel, pausedText });

    await s.eval(`document.getElementById('btn-pause').click()`);
    await s.condition(`state.running && !state.paused`, 3000);
    await WAIT(300);
    addShot(phase, await s.screenshot('active-resumed-1280x720.png'));
    results.push({ state: 'resumed' });

    await s.eval(`document.getElementById('btn-stop').click()`);
    await s.condition(`!state.running && !state.paused`, 3000);
    await WAIT(300);
    addShot(phase, await s.screenshot('active-cancelled-1280x720.png'));
    const restored = await s.eval(`getComputedStyle(document.getElementById('armed-mode-title')).display !== 'none'`);
    const restoredLayout = await s.eval(`({
      hero: getComputedStyle(document.getElementById('armed-mode-title')).display !== 'none',
      profiles: getComputedStyle(document.getElementById('profiles-section')).display !== 'none',
      runningControls: getComputedStyle(document.getElementById('action-bar-running')).display
    })`);
    requireGate(restored && restoredLayout.hero && restoredLayout.profiles && restoredLayout.runningControls === 'none', 'stopping did not restore the normal Tonight layout', restoredLayout);
    results.push({ state: 'cancelled', restored });

    const realPowerActions = await getRealPowerActions(s);
    requireGate(realPowerActions.length === 0, 'active-run gate attempted a real power action', realPowerActions);
    report.phases[phase] = { status: 'passed', results, realPowerActions: realPowerActions.length };
  } finally {
    await stopApp(child);
  }
}

async function writeArtifacts() {
  report.rendererDiagnostics = runtimeSessions.map(({ label, userDataDir, port, renderer, session }) => ({
    label,
    userDataDir,
    cdpPort: port,
    renderer,
    consoleErrors: session.consoleMessages.filter(message => message.type === 'error'),
    uncaughtExceptions: session.exceptions
  }));
  const manifest = report.screenshots.map(s => ({ name: s.name, size: s.size, sha256: s.sha256 }));
  fs.writeFileSync(path.join(ROOT_DIR, 'report.json'), JSON.stringify(redactArtifactValue(report), null, 2));
  fs.writeFileSync(path.join(ROOT_DIR, 'screenshot-manifest.json'), JSON.stringify(manifest, null, 2));
  const sums = manifest.map(m => `${m.sha256}  ${m.name}`).join('\n');
  fs.writeFileSync(path.join(ROOT_DIR, 'SHA256SUMS.txt'), sums + '\n');
}

async function main() {
  if (!fs.existsSync(EXE_PATH)) throw new Error(`Desktop runtime executable missing: ${EXE_PATH}`);
  console.log('Desktop UX Functional Gate');
  console.log('Runtime:', SOURCE_RUNTIME ? 'source Electron' : 'packaged');
  console.log('Executable:', EXE_PATH);
  console.log('Root:', ROOT_DIR);

  await runStartupGate();
  await runTopMenuGate();
  await runSharedStartGate();
  await runUseTonightGate();
  await runSettingsGate();
  await runActiveRunGate();

  const uncaughtExceptions = runtimeSessions.flatMap(({ label, session }) => session.exceptions.map(exception => ({ label, ...exception })));
  requireGate(uncaughtExceptions.length === 0, 'uncaught renderer exceptions were captured', uncaughtExceptions);
  report.status = 'passed';
  report.realPowerActions = 0;
  report.endTime = new Date().toISOString();
  await writeArtifacts();
  console.log(JSON.stringify({ root: ROOT_DIR, screenshots: report.screenshots.length, phases: Object.keys(report.phases) }, null, 2));
}

main().catch(async err => {
  report.status = 'failed';
  report.failure = { message: err.message, stack: err.stack };
  report.endTime = new Date().toISOString();
  try { await writeArtifacts(); } catch (artifactError) {
    console.error('Failed to write failure artifacts:', artifactError);
  }
  console.error('Gate fatal:', err);
  process.exit(1);
});
