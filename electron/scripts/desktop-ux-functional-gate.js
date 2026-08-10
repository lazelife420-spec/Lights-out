#!/usr/bin/env node
// Desktop UX Functional Gate: native Electron proof for top menus, shared Start,
// Use Tonight (two Night Modes with restart), and active-run visual focus.
'use strict';

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const WebSocket = require('ws');
const { decideRitualStepAction, decideWorkareaControlAction } = require('./ritual-step-progression');
const { assertCursorCustody, assertInputAllowed, assertSendInputComplete, reconcileTarget, strictInteriorPoint, validateBrowserGesture, validateHit } = require('./native-input-targeting');

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

class NativeInputWorker {
  constructor(scriptPath) {
    this.scriptPath = scriptPath;
    this.process = null;
    this.pending = new Map();
    this.requestId = 0;
    this.readyPromise = null;
  }
  async start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.process = child;
      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', line => {
        let message;
        try { message = JSON.parse(line); } catch (error) { reject(new Error(`native worker emitted invalid JSON: ${error.message}`)); return; }
        if (message.type === 'ready') { resolve(message); return; }
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        if (message.ok) pending.resolve(message.value);
        else {
          const error = new Error(message.error || 'native worker request failed');
          error.nativeInput = message.errorData || null;
          pending.reject(error);
        }
      });
      let stderr = '';
      child.stderr.on('data', data => { stderr += data; });
      child.once('error', reject);
      child.once('exit', code => {
        if (code !== 0 && this.pending.size) {
          const error = new Error(`native worker exited ${code}: ${stderr}`);
          for (const pending of this.pending.values()) pending.reject(error);
          this.pending.clear();
        }
      });
    });
    return Promise.race([
      this.readyPromise,
      WAIT(10000).then(() => { throw new Error('native input worker ready timeout'); })
    ]);
  }
  async request(payload) {
    await this.start();
    if (!this.process || this.process.killed) throw new Error('native input worker is unavailable');
    const requestId = ++this.requestId;
    const response = new Promise((resolve, reject) => this.pending.set(requestId, { resolve, reject }));
    this.process.stdin.write(`${JSON.stringify({ ...payload, requestId })}\n`);
    return response;
  }
  async stop() {
    if (!this.process || this.process.killed) return;
    const child = this.process;
    try { child.stdin.write(`${JSON.stringify({ type: 'stop', requestId: ++this.requestId })}\n`); } catch {}
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), WAIT(2000)]);
    if (child.exitCode === null) child.kill();
  }
}

const nativeInputWorker = new NativeInputWorker(path.join(__dirname, 'native-input-worker.ps1'));

async function invokeNativeInput(payload) {
  return nativeInputWorker.request(payload);
}

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
  constructor(wsUrl, port, targetId) {
    this.ws = new WebSocket(wsUrl);
    this.port = port;
    this.targetId = targetId;
    this.sessionId = crypto.randomUUID();
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
  async measureNativeTarget(sel) {
    const ownerSel = /^#menu-(power|settings|help) > span$/.test(sel) ? sel.split(' > ')[0] : sel;
    const measured = await this.eval(`(() => {
      const requested = document.querySelector(${JSON.stringify(sel)});
      const owner = document.querySelector(${JSON.stringify(ownerSel)});
      if (!requested || !owner) return false;
      owner.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = owner.getBoundingClientRect();
      const requestedRect = requested.getBoundingClientRect();
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        requestedRect: { x: requestedRect.x, y: requestedRect.y, width: requestedRect.width, height: requestedRect.height },
        point,
        hitAccepted: Boolean(hit && (hit === owner || owner.contains(hit))),
        hit: { tag: hit?.tagName || null, id: hit?.id || null, classes: hit?.className || null },
        ownerSelector: ${JSON.stringify(ownerSel)},
        requestedSelector: ${JSON.stringify(sel)},
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        dpr: window.devicePixelRatio,
        identity: { href: location.href, timeOrigin: performance.timeOrigin }
      };
    })()`);
    if (!measured) return false;
    measured.identity.targetId = this.targetId;
    measured.identity.sessionId = this.sessionId;
    measured.point = strictInteriorPoint(measured.rect);
    validateHit(measured);
    return measured;
  }
  async click(sel) {
    const measured = await this.condition(`Boolean(document.querySelector(${JSON.stringify(sel)}))`, 3000, `native target ${sel}`);
    if (!measured) throw new Error(`native target ${sel} was not found`);
    const initial = await this.measureNativeTarget(sel);
    const current = await this.measureNativeTarget(sel);
    const prepared = reconcileTarget(initial, current);
    assertInputAllowed({ clickIssued: false, target: prepared.target });
    const target = prepared.target;
    const topMenuOwner = /^#menu-(power|settings|help) > span$/.test(sel) ? target.ownerSelector.slice(1) : null;
    const gestureId = topMenuOwner ? crypto.randomUUID() : null;
    if (gestureId) await this.eval(`window.__desktopUxBeginNativeGesture?.(${JSON.stringify(gestureId)}, ${JSON.stringify(topMenuOwner)})`);
    const native = await invokeNativeInput({ kind: 'pointer', action: 'click', executable: EXE_PATH, clientX: target.point.x, clientY: target.point.y, targetRect: target.rect, innerWidth: target.innerWidth, innerHeight: target.innerHeight });
    assertCursorCustody(native.screenPoint, native.actualCursor);
    assertSendInputComplete(native.gesture);
    await WAIT(120);
    const browserGesture = gestureId ? await this.eval(`window.__desktopUxEndNativeGesture?.(${JSON.stringify(gestureId)})`) : null;
    if (browserGesture) {
      validateBrowserGesture(browserGesture);
      requireGate(browserGesture.handlerEntries.length === 1, `${topMenuOwner} production handler was not entered exactly once`, browserGesture);
    }
    report.nativeInputs.push({ timestamp: new Date().toISOString(), method: 'win32-mouse', selector: sel, measured: initial, current: target, targetReacquired: prepared.reacquired, native, browserGesture, retryCount: 0 });
    return { rect: target, native, browserGesture };
  }
  async clickXY(x, y) {
    const viewport = await this.eval(`({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio })`);
    const native = await invokeNativeInput({ kind: 'pointer', action: 'click', executable: EXE_PATH, clientX: x, clientY: y, innerWidth: viewport.innerWidth, innerHeight: viewport.innerHeight });
    assertCursorCustody(native.screenPoint, native.actualCursor);
    assertSendInputComplete(native.gesture);
    report.nativeInputs.push({ timestamp: new Date().toISOString(), method: 'win32-mouse', selector: null, measured: { x, y, ...viewport }, native, retryCount: 0 });
    await WAIT(120);
    return { point: { x, y }, native };
  }
  async movePointer(x, y) {
    const viewport = await this.eval(`({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio })`);
    const native = await invokeNativeInput({ kind: 'pointer', action: 'move', executable: EXE_PATH, clientX: x, clientY: y, innerWidth: viewport.innerWidth, innerHeight: viewport.innerHeight });
    report.nativeInputs.push({ timestamp: new Date().toISOString(), method: 'win32-mouse-move', measured: { x, y, ...viewport }, native, retryCount: 0 });
    await WAIT(80);
    return { point: { x, y }, native };
  }
  async key(k) {
    const map = { Escape: 0x1B, Enter: 0x0D, ' ': 0x20, ArrowDown: 0x28, ArrowUp: 0x26, ArrowLeft: 0x25, ArrowRight: 0x27, Tab: 0x09, Backspace: 0x08 };
    const virtualKey = map[k] || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : null);
    if (virtualKey === null) throw new Error(`unsupported native key ${k}`);
    const native = await invokeNativeInput({ kind: 'key', executable: EXE_PATH, virtualKey, modifiers: [] });
    report.nativeInputs.push({ timestamp: new Date().toISOString(), method: 'win32-keyboard', keySequence: [k], native, retryCount: 0 });
    await WAIT(150);
    return native;
  }
  async chord(modifiers, k) {
    const modifierMap = { Control: 0x11, Shift: 0x10, Alt: 0x12 };
    const keyMap = { Escape: 0x1B, Enter: 0x0D, ' ': 0x20, ArrowDown: 0x28, ArrowUp: 0x26, ArrowLeft: 0x25, ArrowRight: 0x27, Tab: 0x09 };
    const virtualKey = keyMap[k] || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : null);
    const modifierKeys = modifiers.map(modifier => modifierMap[modifier]);
    if (virtualKey === null || modifierKeys.some(key => !key)) throw new Error(`unsupported native chord ${modifiers.join('+')}+${k}`);
    const native = await invokeNativeInput({ kind: 'key', executable: EXE_PATH, virtualKey, modifiers: modifierKeys });
    report.nativeInputs.push({ timestamp: new Date().toISOString(), method: 'win32-keyboard', keySequence: [...modifiers, k], native, retryCount: 0 });
    await WAIT(150);
    return native;
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
  async waitFor(sel, timeout = 5000, label = `selector ${sel} exists`) {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      if (await this.eval(`!!document.querySelector('${sel}')`)) return true;
      await WAIT(100);
    }
    const diagnostic = await this.captureTimeout(label);
    throw new Error(`timeout waiting for ${label}: ${JSON.stringify(diagnostic)}`);
  }
  async condition(fnExpr, timeout = 5000, label = fnExpr) {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      const result = await this.eval(fnExpr);
      if (result) return result;
      await WAIT(100);
    }
    const diagnostic = await this.captureTimeout(label);
    throw new Error(`timeout waiting for ${label}: ${JSON.stringify(diagnostic)}`);
  }
  async captureTimeout(label) {
    const safe = String(label).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'state';
    let screenshot = null;
    try { screenshot = await this.screenshot(`timeout-${Date.now()}-${safe}.png`); } catch (error) { screenshot = { error: error.message }; }
    let renderer = null;
    try { renderer = await this.rendererDiagnostics(); } catch (error) { renderer = { error: error.message }; }
    return { label, timeoutScreenshot: screenshot, renderer };
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
          exists: Boolean(document.getElementById('ns-hero-card')),
          display: document.getElementById('ns-hero-card') ? getComputedStyle(document.getElementById('ns-hero-card')).display : null,
          title: document.getElementById('ns-hero-title')?.textContent || null
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
  if (!child) return true;
  const userDataDir = child.userDataDir;
  try { child.cdpSession?.ws?.terminate(); } catch {}
  const runTaskkill = args => new Promise(resolve => {
    const process = spawn('taskkill', args, { windowsHide: true });
    process.once('error', () => resolve(false));
    process.once('close', code => resolve(code === 0));
  });
  const hasLightsOutProcess = () => new Promise(resolve => {
    let stdout = '';
    const process = spawn('tasklist', ['/FI', 'IMAGENAME eq Lights Out.exe', '/NH'], { windowsHide: true });
    process.stdout.on('data', data => { stdout += data; });
    process.once('error', () => resolve(false));
    process.once('close', () => resolve(stdout.includes('Lights Out.exe')));
  });

  try { child.kill(); } catch {}
  await WAIT(500);
  await runTaskkill(['/F', '/T', '/PID', String(child.pid)]);
  await WAIT(500);
  await runTaskkill(['/F', '/IM', 'Lights Out.exe']);
  for (let check = 0; check < 10; check++) {
    if (!(await hasLightsOutProcess())) return true;
    await WAIT(500);
  }
  throw new Error(`Lights Out process tree for ${userDataDir} did not terminate`);
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
  const child = spawn(EXE_PATH, launchArgs, { detached: true, windowsHide: false, env: { ...process.env, LIGHTS_OUT_DESKTOP_UX_GATE: '1' } });
  child.unref();
  let list = [];
  for (let i = 0; i < 40; i++) {
    try { list = await cdpList(port); if (list.length) break; } catch {}
    await WAIT(250);
  }
  if (!list.length) { try { child.kill(); } catch {} throw new Error('Electron did not expose CDP'); }
  const page = list.find(x => x.type === 'page' || x.title === 'Lights Out') || list[0];
  const session = new CdpSession(page.webSocketDebuggerUrl, port, page.id);
  await session.connect();
  const renderer = await session.waitForRendererReady();
  child.cdpSession = session;
  child.userDataDir = userDataDir;
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
  screenshots: [],
  nativeInputs: [],
  retryCount: 0
};

function addShot(phase, s) {
  report.screenshots.push({ phase, ...s });
  return s;
}

async function clearStarts(s) { await s.eval('window.__desktopUxProof?.clearStartInvocations()'); }
async function getStarts(s) { return s.eval('window.__desktopUxProof?.getStartInvocations()'); }
async function getRealPowerActions(s) { return s.eval('window.__desktopUxProof?.getRealPowerActions()'); }
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
    const handlerEntries = [];
    let activeGesture = null;
    const add = event => events.push({
      gestureId: activeGesture?.id || null,
      type: event.type,
      target: event.target?.id || event.target?.className || event.target?.tagName || null,
      targetId: event.target?.id || null,
      pathOwnerIds: (event.composedPath?.() || []).map(node => node?.id).filter(Boolean),
      activeElement: document.activeElement?.id || null,
      openMenus: Array.from(document.querySelectorAll('.menu-item.open')).map(menu => menu.id),
      settingsAriaExpanded: document.getElementById('menu-settings')?.getAttribute('aria-expanded') || null,
      at: performance.now()
    });
    ['blur', 'focus', 'focusin', 'focusout', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'mouseenter', 'mouseleave', 'mousemove'].forEach(type => window.addEventListener(type, add, true));
    for (const ownerId of ['menu-power', 'menu-settings', 'menu-help']) {
      document.getElementById(ownerId)?.addEventListener('click', event => handlerEntries.push({
        gestureId: activeGesture?.id || null,
        ownerId,
        targetId: event.target?.id || null,
        pathOwnerIds: (event.composedPath?.() || []).map(node => node?.id).filter(Boolean),
        at: performance.now()
      }));
    }
    window.__desktopUxBeginNativeGesture = (id, ownerId) => { activeGesture = { id, ownerId }; return { id, ownerId, at: performance.now() }; };
    window.__desktopUxEndNativeGesture = id => {
      const ownerId = activeGesture?.id === id ? activeGesture.ownerId : null;
      const matching = events.filter(event => event.gestureId === id);
      const first = type => matching.find(event => event.type === type) || null;
      const result = {
        gestureId: id,
        ownerId,
        down: first('pointerdown') || first('mousedown'),
        up: first('pointerup') || first('mouseup'),
        click: first('click'),
        handlerEntries: handlerEntries.filter(entry => entry.gestureId === id),
        expectedState: {
          openMenus: Array.from(document.querySelectorAll('.menu-item.open')).map(menu => menu.id),
          ariaExpanded: ownerId ? document.getElementById(ownerId)?.getAttribute('aria-expanded') || null : null
        }
      };
      if (activeGesture?.id === id) activeGesture = null;
      return result;
    };
    window.__desktopUxGateEvents = events;
    window.__desktopUxGateHandlerEntries = handlerEntries;
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
    heroTitle: document.getElementById('ns-hero-title')?.textContent || null
  })`);
}

async function runStartupGate() {
  const phase = 'startup';
  const results = [];
  for (const scenario of [
    { name: 'normal', nsActiveTab: 'lib' },
    { name: 'legacy-settings', nsActiveTab: 'set' },
    { name: 'legacy-help', nsActiveTab: 'help' }
  ]) {
    const userData = path.join(ROOT_DIR, `userdata-startup-${scenario.name}`);
    const { child, session: s } = await spawnApp(userData, { app: { nsActiveTab: scenario.nsActiveTab } });
    try {
      const snapshot = await getStartupSnapshot(s);
      const persisted = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
      const result = { scenario: scenario.name, seeded: scenario.nsActiveTab, snapshot, persistedTab: persisted.app?.nsActiveTab };
      requireGate(snapshot.route === 'lib', `${scenario.name} did not land on Tonight`, result);
      requireGate(snapshot.visiblePanel === 'ns-panel-lib', `${scenario.name} did not show the Tonight panel`, result);
      requireGate(!snapshot.settingsVisible && !snapshot.settingsEverVisible, `${scenario.name} flashed or showed Settings during startup`, result);
      requireGate(snapshot.dryRun === true, `${scenario.name} did not preserve Dry Run`, result);
      requireGate(persisted.app?.nsActiveTab === 'lib', `${scenario.name} did not persist the safe Tonight route`, result);
      results.push(result);
    } finally {
      await stopApp(child);
    }
  }

  const returnUserData = path.join(ROOT_DIR, 'userdata-startup-settings-return');
  const first = await spawnApp(returnUserData);
  try {
    await first.session.click('[data-ns-tab="set"]');
    await first.session.condition(`getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none'`);
    await first.session.click('#modal-close');
    await first.session.condition(`getComputedStyle(document.getElementById('ns-panel-lib')).display !== 'none'`);
  } finally {
    await stopApp(first.child);
  }
  const second = await spawnApp(returnUserData, {}, { preserveSettings: true });
  try {
    const snapshot = await getStartupSnapshot(second.session);
    requireGate(snapshot.route === 'lib' && snapshot.visiblePanel === 'ns-panel-lib', 'closing Settings altered the next startup route', snapshot);
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
  // Preserve the established finite assertion budget; this observes state
  // after one native gesture and is not an input retry.
  const waitFor = (expression, label, timeout = 5000) => s.condition(expression, timeout, label);
  try {
    await s.resize(1280, 720);
    await s.waitFor('#menu-power');
    await installTopMenuEventTrace(s);

    await s.click('#menu-power > span');
    await waitFor(`document.getElementById('menu-power').classList.contains('open')`, 'Power menu open after native click');
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
    open = await waitFor(`!document.querySelector('.menu-item.open')`, 'Power menu closed after second native click');
    results.mouse.push({ step: 'click-power-again', closed: open });
    requireGate(open, 'Power trigger did not toggle closed');

    await s.click('#menu-settings > span');
    open = await waitFor(`document.getElementById('menu-settings').classList.contains('open')`, 'Settings menu open after native click');
    addShot(phase, await s.screenshot('topmenu-settings-mouse-open.png'));
    results.mouse.push({ step: 'click-settings', open });
    requireGate(open, 'Settings menu did not open on click');

    await s.click('#menu-help > span');
    await waitFor(`!document.getElementById('menu-settings').classList.contains('open') && document.getElementById('menu-help').classList.contains('open')`, 'Help open and Settings closed');
    const settingsClosed = await s.eval(`!document.getElementById('menu-settings').classList.contains('open')`);
    const helpOpen = await s.eval(`document.getElementById('menu-help').classList.contains('open')`);
    results.mouse.push({ step: 'click-help-closes-settings', settingsClosed, helpOpen });
    requireGate(settingsClosed && helpOpen, 'opening Help did not close Settings');
    addShot(phase, await s.screenshot('topmenu-help-mouse-open.png'));

    await s.click('#menu-settings > span');
    await waitFor(`document.getElementById('menu-settings').classList.contains('open')`, 'Settings menu reopened for pointer transfer');
    const menuRect = await s.eval(`(r=document.querySelector('#menu-settings .submenu').getBoundingClientRect(),{x:r.x+r.width/2,y:r.y+10})`);
    const beforePointerTransfer = await getTopMenuKeyboardState(s);
    await s.movePointer(menuRect.x, menuRect.y);
    await waitFor(`document.getElementById('menu-settings').classList.contains('open')`, 'Settings menu remains open inside submenu');
    const afterPointerTransfer = await getTopMenuKeyboardState(s);
    const stillOpen = afterPointerTransfer.settingsMenuOpen;
    results.mouse.push({ step: 'pointer-transfer-stays-open', menuRect, beforePointerTransfer, afterPointerTransfer, stillOpen });
    requireGate(stillOpen, 'menu closed while pointer entered its submenu', afterPointerTransfer);
    await s.movePointer(20, 20);
    await waitFor(`document.getElementById('menu-settings').classList.contains('open')`, 'Settings menu remains open until dismissal click');
    const afterPointerAway = await getTopMenuKeyboardState(s);
    const stillOpen2 = afterPointerAway.settingsMenuOpen;
    results.mouse.push({ step: 'pointer-away-stays-open', afterPointerAway, stillOpen2 });
    requireGate(stillOpen2, 'menu closed before an outside click', afterPointerAway);

    await s.click('#open-options');
    await waitFor(`getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none'`, 'Advanced Options opens Settings panel');
    const settingsVisible = await s.eval(`document.getElementById('ns-panel-set').style.display !== 'none'`);
    results.mouse.push({ step: 'advanced-options-opens-settings', settingsVisible });
    requireGate(settingsVisible, 'Advanced Options did not open the Settings workspace');
    addShot(phase, await s.screenshot('topmenu-settings-panel.png'));
    await s.click('#modal-close');
    await waitFor(`document.querySelector('.ns-nav-item.active')?.dataset?.nsTab === 'lib'`, 'native Settings close restores Tonight');
    const restored = await s.eval(`document.querySelector('.ns-nav-item.active')?.dataset.nsTab`);
    results.mouse.push({ step: 'close-restores-route', restored });
    requireGate(restored === 'lib', 'closing Settings did not restore Tonight', restored);

    await s.click('#menu-settings > span');
    await waitFor(`document.getElementById('menu-settings').classList.contains('open')`, 'Settings menu open for Dry Run toggle');
    await s.click('#toggle-dryrun');
    await waitFor(`document.querySelector('#toggle-dryrun .toggle-indicator').textContent === 'OFF'`, 'Dry Run toggle visibly disabled');
    const dryRunIndicator = await s.eval(`document.querySelector('#toggle-dryrun .toggle-indicator').textContent`);
    results.mouse.push({ step: 'toggle-dryrun', dryRunIndicator });
    requireGate(dryRunIndicator === 'OFF', 'enabled Settings toggle did not activate', dryRunIndicator);
    await s.click('#menu-settings > span');
    await waitFor(`document.getElementById('menu-settings').classList.contains('open')`, 'Settings menu reopened to restore Dry Run');
    await s.click('#toggle-dryrun');
    await waitFor(`state.dryRun === true`, 'Dry Run restored');

    await s.click('#menu-power > span');
    await waitFor(`document.getElementById('menu-power').classList.contains('open')`, 'Power menu open for outside dismissal');
    const outside = await s.eval(`(r=document.getElementById('ns-hero-card').getBoundingClientRect(), {x:r.x+r.width/2, y:r.y+r.height/2})`);
    await s.clickXY(outside.x, outside.y);
    const allClosed = await waitFor(`!document.querySelector('.menu-item.open')`, 'outside native click closes every top menu');
    results.mouse.push({ step: 'outside-click-closes', allClosed });
    requireGate(allClosed, 'outside click did not close top menu');

    await clearStarts(s);
    await s.click('#menu-power > span');
    await waitFor(`document.getElementById('menu-power').classList.contains('open')`, 'Power menu open for plan selection');
    await s.click('#menu-power [data-action="shutdown"]');
    await waitFor(`state.action === 'shutdown' && state.dryRun === true`, 'Shutdown plan selected without leaving Dry Run');
    const powerSelection = await s.eval(`({ action: state.action, dryRun: state.dryRun, warningOpen: document.getElementById('warning-modal')?.classList.contains('active') || false })`);
    const startsAfterPowerSelection = await getStarts(s);
    const realPowerActions = await getRealPowerActions(s);
    requireGate(powerSelection.action === 'shutdown' && powerSelection.dryRun === true, 'Power selection changed safety state', powerSelection);
    requireGate(startsAfterPowerSelection.length === 0 && realPowerActions.length === 0, 'Power menu selection bypassed the shared Start/confirmation path', { startsAfterPowerSelection, realPowerActions });
    results.mouse.push({ step: 'power-selects-plan-without-execution', powerSelection, starts: startsAfterPowerSelection.length, realPowerActions: realPowerActions.length });

    await s.click('#menu-help > span');
    await waitFor(`document.getElementById('menu-help').classList.contains('open')`, 'Help menu open');
    await s.click('#open-about');
    await waitFor(`document.getElementById('about-modal')?.classList.contains('active') || false`, 'About modal open from native menu selection');
    const aboutOpen = await s.eval(`document.getElementById('about-modal')?.classList.contains('active') || false`);
    requireGate(aboutOpen, 'enabled Help item did not activate');
    await s.key('Escape');
    await waitFor(`!document.getElementById('about-modal')?.classList.contains('active')`, 'Escape closes About modal');
    results.mouse.push({ step: 'help-item-activates', aboutOpen });

    // Keyboard navigation
    await s.click('#menu-power > span');
    await waitFor(`document.getElementById('menu-power').classList.contains('open')`, 'Power menu primed for keyboard path');
    await s.key('Escape');
    await waitFor(`!document.querySelector('.menu-item.open') && document.activeElement?.id === 'menu-power'`, 'Power trigger focused after Escape');
    await s.key('Enter');
    await waitFor(`document.getElementById('menu-power').classList.contains('open')`, 'Enter opens Power menu');
    const powerOpen = await s.eval(`document.getElementById('menu-power').classList.contains('open')`);
    addShot(phase, await s.screenshot('topmenu-power-keyboard-open.png'));
    results.keyboard.push({ step: 'enter-opens-power', powerOpen });
    requireGate(powerOpen, 'Enter did not open Power');

    await s.key('ArrowDown');
    await waitFor(`document.activeElement?.dataset?.action === 'restart'`, 'ArrowDown focuses Restart');
    const focusedItem = await s.eval(`({ text: document.activeElement?.textContent?.trim(), action: document.activeElement?.dataset?.action || null })`);
    results.keyboard.push({ step: 'arrow-down-to-item', focusedItem });
    requireGate(focusedItem.action === 'restart', 'ArrowDown did not move to the next Power item', focusedItem);
    await s.key('ArrowUp');
    await waitFor(`document.activeElement?.dataset?.action === 'shutdown'`, 'ArrowUp focuses Shutdown');
    const focusedAfterUp = await s.eval(`({ text: document.activeElement?.textContent?.trim(), action: document.activeElement?.dataset?.action || null })`);
    results.keyboard.push({ step: 'arrow-up', focusedItem: focusedAfterUp });
    requireGate(focusedAfterUp.action === 'shutdown', 'ArrowUp did not move to the previous Power item', focusedAfterUp);
    await s.key('Escape');
    const closedByEscape = await waitFor(`!document.querySelector('.menu-item.open') && document.activeElement?.id === 'menu-power'`, 'Escape closes Power and returns focus');
    results.keyboard.push({ step: 'escape-closes-and-focuses-trigger', closedByEscape });
    requireGate(closedByEscape, 'Escape did not close Power and return focus');

    await clearStarts(s);
    await s.click('#menu-settings > span');
    await waitFor(`document.getElementById('menu-settings').classList.contains('open')`, 'Settings menu primed for keyboard path');
    await s.key('Escape');
    await waitFor(`document.activeElement?.id === 'menu-settings'`, 'Settings trigger focused after Escape');
    await s.key('ArrowDown');
    await waitFor(`document.getElementById('menu-settings').classList.contains('open') && document.activeElement?.id === 'toggle-dryrun'`, 'ArrowDown opens Settings and focuses first item');
    const settingsOpen = await getTopMenuKeyboardState(s);
    results.keyboard.push({ step: 'arrow-down-opens-settings', ...settingsOpen });
    requireGate(settingsOpen.settingsMenuOpen && settingsOpen.settingsAriaExpanded === 'true' && settingsOpen.selectedMenuItem === 'toggle-dryrun', 'ArrowDown did not open Settings and focus the first menu item', settingsOpen);
    await s.key('ArrowUp');
    const beforeEnter = await getTopMenuKeyboardState(s);
    results.keyboard.push({ step: 'before-enter-on-open-options', ...beforeEnter });
    requireGate(beforeEnter.settingsMenuOpen && beforeEnter.settingsAriaExpanded === 'true' && beforeEnter.selectedMenuItem === 'open-options', 'Advanced Options was not focused before Enter', beforeEnter);
    await s.key('Enter');
    await waitFor(`getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none' && document.querySelector('.ns-nav-item.active')?.dataset?.nsTab === 'set'`, 'Enter activates Advanced Options');
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
    await s.waitFor('#ns-play-btn');
    await clearStarts(s);
    await WAIT(400);
    const results = [];

    await s.click('#timer-input');
    await s.chord(['Control'], 'A');
    await s.key('2');
    await s.condition(`document.getElementById('timer-input').value === '2'`, 2000, 'native timer input contains 2 minutes');
    await clearStarts(s);
    await s.click('#ns-play-btn');
    await s.condition(`state.running`, 6000, 'hero Start enters running state');
    const heroInvocations = await getStarts(s);
    requireGate(heroInvocations.length === 1, 'hero Start dispatched a duplicate or missing payload', heroInvocations);
    requireGate(heroInvocations[0]?.options?.startOrigin === 'play' && heroInvocations[0]?.options?.dryRun === true, 'hero Start payload violated shared Start/Dry Run contract', heroInvocations[0]);
    let heroReceipt = null;
    try { heroReceipt = await s.eval('window.electronAPI.getLatestReceipt()'); } catch {}
    results.push({ control: 'ns-play-btn', invocations: heroInvocations.length, payload: heroInvocations[0], receipt: heroReceipt });
    addShot(phase, await s.screenshot('active-running-hero.png'));
    await s.click('#btn-stop');
    await s.condition(`!state.running && !state.paused`, 3000, 'native Cancel stops hero-started session');

    await clearStarts(s);
    await s.key(' ');
    await s.condition(`state.running`, 6000, 'Space enters running state');
    const spaceInvocations = await getStarts(s);
    requireGate(spaceInvocations.length === 1, 'Space Start dispatched a duplicate or missing payload', spaceInvocations);
    requireGate(spaceInvocations[0]?.options?.startOrigin === 'play' && spaceInvocations[0]?.options?.dryRun === true, 'Space payload diverged from shared Start contract', spaceInvocations[0]);
    let spaceReceipt = null;
    try { spaceReceipt = await s.eval('window.electronAPI.getLatestReceipt()'); } catch {}
    results.push({ control: 'space-key', invocations: spaceInvocations.length, payload: spaceInvocations[0], receipt: spaceReceipt });
    await s.click('#btn-stop');
    await s.condition(`!state.running && !state.paused`, 3000, 'native Cancel stops Space-started session');

    // Restart to load morning proof (receipt) so proof-again appears
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
      await s2.click('#btn-proof-again');
      await s2.condition(`state.running`, 6000, 'Morning Proof replay enters running state');
      const againInvocations = await getStarts(s2);
      requireGate(againInvocations.length === 1, 'proof replay dispatched a duplicate or missing payload', againInvocations);
      requireGate(againInvocations[0]?.options?.startOrigin === 'play' && againInvocations[0]?.options?.dryRun === true, 'proof replay payload diverged from shared Start contract', againInvocations[0]);
      let againReceipt = null;
      try { againReceipt = await s2.eval('window.electronAPI.getLatestReceipt()'); } catch {}
      results.push({ control: 'proof-again', invocations: againInvocations.length, payload: againInvocations[0], receipt: againReceipt });
      report.phases[phase] = { status: 'passed', results, proofDisplay };
    } finally {
      await stopApp(child2);
    }
  } finally {
    await stopApp(child);
  }
}

async function progressVisibleRitualOverlay(s, { modeId, phase, screenshotPrefix }) {
  let receipt = null;
  const ritualTrace = [];
  const ritualStepLog = [];
  const clickedStepFingerprints = new Set();
  let overlayDismissed = false;
  for (let attempt = 0; ; attempt++) {
    const currentReceipt = await s.eval(`window.electronAPI.getLatestReceipt()`);
    if (currentReceipt && currentReceipt.result === 'running') receipt = currentReceipt;

    const ritualState = await s.eval(`window.electronAPI.ritualState()`);
    ritualTrace.push(ritualState);
    const overlayActive = await s.eval(`(() => {
      const overlay = document.getElementById('ritual-overlay');
      return Boolean(overlay && getComputedStyle(overlay).display !== 'none' && overlay.classList.contains('active'));
    })()`);

    const realPowerActionsDuringRitual = await getRealPowerActions(s);
    const control = await s.eval(`(() => {
      const next = document.getElementById('btn-ritual-next');
      if (!next) return { exists: false };
      const r = next.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        exists: true,
        visible: r.width > 0 && r.height > 0,
        label: next.textContent || '',
        hitTestOk: Boolean(hit && (hit === next || next.contains(hit) || hit.closest?.('#btn-ritual-next') === next))
      };
    })()`);

    const decision = decideRitualStepAction({
      ritualActive: Boolean(ritualState?.active),
      overlayActive,
      totalSteps: ritualState?.totalSteps,
      currentStep: ritualState?.currentStep,
      currentStepId: ritualState?.currentStepInfo?.id,
      controlExists: Boolean(control.exists),
      controlVisible: Boolean(control.visible),
      controlLabel: control.label,
      controlHitTestOk: Boolean(control.hitTestOk),
      clickedFingerprints: clickedStepFingerprints,
      attempt,
      realPowerActionsCount: realPowerActionsDuringRitual.length
    });

    if (decision.action === 'done') { overlayDismissed = true; break; }
    requireGate(decision.action === 'click', `${modeId} ${decision.reason || 'ritual progression failed'}`, { decision, control, ritualTrace, ritualStepLog });

    const fingerprint = decision.fingerprint;
    const fileFingerprint = fingerprint.replace(':', '-');
    const before = addShot(phase, await s.screenshot(`${screenshotPrefix}-ritual-${fileFingerprint}-before.png`));
    const stepBeforeChange = { currentStep: ritualState?.currentStep, stepId: ritualState?.currentStepInfo?.id };
    const { native } = await s.click('#btn-ritual-next');
    clickedStepFingerprints.add(fingerprint);

    const transitionStartedAt = Date.now();
    let transition;
    try {
      await s.condition(`(() => {
        const overlay = document.getElementById('ritual-overlay');
        const overlayStillActive = Boolean(overlay && getComputedStyle(overlay).display !== 'none' && overlay.classList.contains('active'));
        if (!overlayStillActive) return true;
        return window.electronAPI.ritualState().then(rs =>
          rs?.currentStep !== ${JSON.stringify(stepBeforeChange.currentStep)} ||
          rs?.currentStepInfo?.id !== ${JSON.stringify(stepBeforeChange.stepId)}
        );
      })()`, 3000, `${modeId} ritual step ${fingerprint} transitions (overlay dismissed or step changed)`);
      transition = { success: true, elapsedMs: Date.now() - transitionStartedAt };
    } catch (err) {
      transition = { success: false, elapsedMs: Date.now() - transitionStartedAt, error: err.message };
    }
    requireGate(transition.success, `${modeId} ritual step ${fingerprint} did not transition after its one native click`, { transition, ritualTrace, ritualStepLog });
    const after = addShot(phase, await s.screenshot(`${screenshotPrefix}-ritual-${fileFingerprint}-after.png`));

    ritualStepLog.push({ fingerprint, label: control.label, native, before: before.name, after: after.name, transitionElapsedMs: transition.elapsedMs });
  }

  requireGate(overlayDismissed, `${modeId} ritual overlay did not dismiss through the visible progression control`, { ritualTrace, ritualStepLog });
  return { receipt, ritualTrace, ritualStepLog, overlayDismissed };
}

async function armAndStartMode(s, modeId, phase) {
  const expected = {
    'movie-wind-down': { title: 'Movie Wind-Down', durationSeconds: 5400, action: 'sleep', ritualId: 'standard' },
    'full-shutdown': { title: 'Full Shutdown', durationSeconds: 3600, action: 'shutdown', ritualId: 'standard' }
  }[modeId];
  const results = { modeId };
  await s.click('[data-ns-tab="modes"]');
  await s.waitFor('#nm-cards-grid .nm-card');
  await s.click(`.nm-card[data-mode-id="${modeId}"]`);
  await s.condition(`document.getElementById('nm-detail-panel').style.display !== 'none' && !document.getElementById('nm-btn-use-tonight').disabled`, 3000, `${modeId} detail panel ready`);
  await s.click('#nm-btn-use-tonight');
  await s.condition(`state.armedNightMode !== null && state.armedNightMode.nightModeId === '${modeId}'`, 3000, `${modeId} armed through native Use Tonight`);
  results.armed = await s.eval(`state.armedNightMode ? { id: state.armedNightMode.nightModeId, title: state.armedNightMode.nightModeTitle, durationSeconds: state.armedNightMode.durationSeconds, action: state.armedNightMode.action } : null`);
  results.hero = await s.eval(`({
    title: document.getElementById('ns-hero-title').textContent,
    playLabel: document.getElementById('ns-play-label').textContent,
    duration: document.getElementById('timer-input').value,
    action: state.action,
    preview: document.getElementById('ns-preview-time').textContent,
    endTime: document.getElementById('end-time').textContent,
    ritual: document.getElementById('armed-mode-meta').textContent
  })`);
  requireGate(results.armed?.id === modeId && results.armed?.title === expected.title, `${modeId} did not become the authoritative selected plan`, results);
  requireGate(results.armed?.durationSeconds === expected.durationSeconds && results.armed?.action === expected.action, `${modeId} selected-plan execution values drifted`, results);
  requireGate(results.hero.title.includes(expected.title) && results.hero.duration === String(expected.durationSeconds / 60), `${modeId} hero title/duration did not project selected plan`, results.hero);
  requireGate(results.hero.action === expected.action && results.hero.playLabel === `Start ${expected.title}`, `${modeId} hero action/CTA did not project selected plan`, results.hero);
  const expectedHours = Math.floor(expected.durationSeconds / 3600);
  const expectedMinutes = Math.floor((expected.durationSeconds % 3600) / 60);
  const expectedPreview = expectedHours > 0
    ? `${expectedHours}:${String(expectedMinutes).padStart(2, '0')}:00`
    : `${expectedMinutes}:00`;
  requireGate(results.hero.preview === expectedPreview && results.hero.endTime, `${modeId} preview/end-time projection was incomplete`, results.hero);
  requireGate(results.hero.ritual.includes('Standard ritual'), `${modeId} ritual steps were not projected`, results.hero);
  addShot(phase, await s.screenshot(`${phase}-${modeId}-projection.png`));
  await clearStarts(s);
  await s.click('#ns-play-btn');
  await s.condition(`state.running`, 3000, `${modeId} enters running ritual state`);
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
  // Standard-ritual modes must reach the timer step before a receipt exists,
  // and the overlay itself only closes once every distinct visible step has
  // been acknowledged through its own native click -- `auto` steps only
  // relabel the same #btn-ritual-next control ("Done" vs "Next"), they don't
  // auto-advance, and the backend receipt can go 'running' one step before
  // the ritual's actual last step. Track a fingerprint per step so the same
  // step is never clicked twice, and bound the loop by the ritual's own
  // reported step count (ritualState().totalSteps) plus a small safety
  // margin, not an arbitrary large number.
  const progression = await progressVisibleRitualOverlay(s, { modeId, phase, screenshotPrefix: `${phase}-${modeId}` });
  let receipt = progression.receipt;
  results.ritualTrace = progression.ritualTrace;
  results.ritualStepLog = progression.ritualStepLog;
  requireGate(receipt && receipt.result === 'running', `${modeId} did not create a running receipt at the ritual timer step`, progression.ritualTrace);
  await s.click('#btn-stop');
  await s.condition(`!state.running && !state.paused`, 3000, `${modeId} native Cancel stops active run`);
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
      await s2.waitFor('#ns-play-btn');
      await WAIT(800);
      const restored = await s2.eval(`state.armedNightMode ? { id: state.armedNightMode.nightModeId, title: state.armedNightMode.nightModeTitle, durationSeconds: state.armedNightMode.durationSeconds, action: state.armedNightMode.action } : null`);
      const hero2 = await s2.eval(`({ title: document.getElementById('ns-hero-title').textContent, playLabel: document.getElementById('ns-play-label').textContent, duration: document.getElementById('timer-input').value, action: state.action })`);
      const expected = modeId === 'movie-wind-down'
        ? { title: 'Movie Wind-Down', durationSeconds: 5400, action: 'sleep' }
        : { title: 'Full Shutdown', durationSeconds: 3600, action: 'shutdown' };
      requireGate(restored?.id === modeId && restored?.title === expected.title, `${modeId} did not restore after restart`, restored);
      requireGate(restored?.durationSeconds === expected.durationSeconds && restored?.action === expected.action, `${modeId} restored execution values drifted`, restored);
      requireGate(hero2.title.includes(expected.title) && hero2.playLabel === `Start ${expected.title}`, `${modeId} restored hero projection drifted`, hero2);
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
    await s.waitFor('#nm-cards-grid');
    await WAIT(300);
    await s.click('.nm-card[data-mode-id="movie-wind-down"]');
    await WAIT(300);
    await s.click('#nm-btn-use-tonight');
    await WAIT(300);
    await s.click('#ns-play-btn');
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
        streakHidden: getComputedStyle(document.getElementById('streak-callout')).display === 'none',
        proofHidden: getComputedStyle(document.getElementById('morning-proof-section')).display === 'none',
        pauseVisible: getComputedStyle(document.getElementById('btn-pause')).display !== 'none',
        snoozeVisible: getComputedStyle(document.getElementById('btn-snooze')).display !== 'none' && !document.getElementById('btn-snooze').disabled,
        cancelVisible: getComputedStyle(document.getElementById('btn-stop')).display !== 'none'
      })`);
      requireGate(focused.modeTitle === 'Movie Wind-Down', `active mode title is not dominant at ${label}`, focused);
      requireGate(focused.dryRunText.includes('Dry Run'), `Dry Run is not prominent at ${label}`, focused);
      requireGate(focused.profilesHidden && focused.streakHidden && focused.proofHidden, `idle-only content remains visible at ${label}`, focused);
      requireGate(focused.pauseVisible && focused.snoozeVisible && focused.cancelVisible, `active controls are incomplete at ${label}`, focused);
      results.push({ label, metrics: m, focused });
    }

    const activeRitual = await progressVisibleRitualOverlay(s, {
      modeId: 'active-run-movie-wind-down',
      phase,
      screenshotPrefix: 'active-run-workarea'
    });
    results.push({
      state: 'ritual-completed-before-controls',
      ritualTrace: activeRitual.ritualTrace,
      ritualStepLog: activeRitual.ritualStepLog
    });

    const ritualStateBeforePause = await s.eval(`window.electronAPI.ritualState()`);
    const realPowerActionsBeforePause = await getRealPowerActions(s);
    const pauseTarget = await s.eval(`(() => {
      const overlay = document.getElementById('ritual-overlay');
      const pause = document.getElementById('btn-pause');
      if (!pause) return { exists: false };
      const r = pause.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const overlayActive = Boolean(overlay && getComputedStyle(overlay).display !== 'none' && overlay.classList.contains('active'));
      return {
        exists: true,
        visible: r.width > 0 && r.height > 0,
        hitTestOk: Boolean(hit && (hit === pause || pause.contains(hit) || hit.closest?.('#btn-pause') === pause)),
        overlayActive,
        coveredByActiveOverlay: Boolean(overlayActive && hit && (hit === overlay || overlay.contains(hit))),
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        hit: { id: hit?.id || null, className: typeof hit?.className === 'string' ? hit.className : null }
      };
    })()`);
    const pauseDecision = decideWorkareaControlAction({
      ritualActive: Boolean(ritualStateBeforePause?.active),
      overlayActive: Boolean(pauseTarget.overlayActive),
      totalSteps: ritualStateBeforePause?.totalSteps,
      currentStep: ritualStateBeforePause?.currentStep,
      currentStepId: ritualStateBeforePause?.currentStepInfo?.id,
      controlExists: false,
      controlVisible: false,
      controlLabel: '',
      controlHitTestOk: false,
      clickedFingerprints: new Set(activeRitual.ritualStepLog.map(step => step.fingerprint)),
      attempt: activeRitual.ritualStepLog.length,
      realPowerActionsCount: realPowerActionsBeforePause.length,
      pauseCoveredByActiveOverlay: pauseTarget.coveredByActiveOverlay,
      pauseTargetExists: pauseTarget.exists,
      pauseTargetVisible: pauseTarget.visible,
      pauseTargetHitTestOk: pauseTarget.hitTestOk
    });
    requireGate(pauseDecision.action === 'pause', pauseDecision.reason || 'Pause is not safely targetable after ritual completion', { pauseDecision, pauseTarget, ritualStateBeforePause, realPowerActionsBeforePause });
    results.push({ state: 'pause-target-verified', pauseTarget, realPowerActions: realPowerActionsBeforePause.length });

    await s.click('#btn-pause');
    await s.condition(`state.paused`, 3000);
    await s.resize(1280, 720);
    await WAIT(300);
    addShot(phase, await s.screenshot('active-paused-1280x720.png'));
    const pauseLabel = await s.eval(`document.getElementById('btn-pause').querySelector('span:last-child').textContent`);
    const pausedText = await s.eval(`document.getElementById('timer-label').textContent`);
    const pausedFocus = await s.eval(`({
      profilesHidden: getComputedStyle(document.getElementById('profiles-section')).display === 'none',
      streakHidden: getComputedStyle(document.getElementById('streak-callout')).display === 'none',
      proofHidden: getComputedStyle(document.getElementById('morning-proof-section')).display === 'none',
      cancelVisible: getComputedStyle(document.getElementById('btn-stop')).display !== 'none'
    })`);
    requireGate(pauseLabel === 'Resume' && /paused/i.test(pausedText), 'paused state did not remain focused', { pauseLabel, pausedText, pausedFocus });
    requireGate(pausedFocus.profilesHidden && pausedFocus.streakHidden && pausedFocus.proofHidden && pausedFocus.cancelVisible, 'paused state restored idle clutter or hid Cancel', pausedFocus);
    results.push({ state: 'paused', pauseLabel, pausedText });

    await s.click('#btn-pause');
    await s.condition(`state.running && !state.paused`, 3000);
    await WAIT(300);
    addShot(phase, await s.screenshot('active-resumed-1280x720.png'));
    results.push({ state: 'resumed' });

    await s.click('#btn-stop');
    await s.condition(`!state.running && !state.paused`, 3000);
    await WAIT(300);
    addShot(phase, await s.screenshot('active-cancelled-1280x720.png'));
    const restored = await s.eval(`document.getElementById('ns-hero-card').style.display !== 'none'`);
    const restoredLayout = await s.eval(`({
      hero: getComputedStyle(document.getElementById('ns-hero-card')).display !== 'none',
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

// --- Warm-mode: one continuing packaged process reused across N iterations,
// reset only through supported visible UI between iterations (no restart).
async function runWarmTopMenuPass(s) {
  const results = { mouse: [], keyboard: [] };
  // Same measured-overhead basis as runTopMenuGate's waitFor: see the comment there.
  const waitFor = (expression, label, timeout = 5000) => s.condition(expression, timeout, label);

  await s.click('#menu-power > span');
  let open = await waitFor(`document.getElementById('menu-power').classList.contains('open')`, 'warm Power menu open after native click');
  requireGate(open, 'warm Power menu did not open on click');
  results.mouse.push({ step: 'click-power-open', open });

  await s.click('#menu-power > span');
  open = await waitFor(`!document.querySelector('.menu-item.open')`, 'warm Power menu closed after second native click');
  requireGate(open, 'warm Power trigger did not toggle closed');
  results.mouse.push({ step: 'click-power-close', closed: open });

  await s.click('#menu-settings > span');
  open = await waitFor(`document.getElementById('menu-settings').classList.contains('open')`, 'warm Settings menu open after native click');
  requireGate(open, 'warm Settings menu did not open on click');
  results.mouse.push({ step: 'click-settings-open', open });

  await s.click('#menu-help > span');
  await waitFor(`!document.getElementById('menu-settings').classList.contains('open') && document.getElementById('menu-help').classList.contains('open')`, 'warm Help open and Settings closed');
  results.mouse.push({ step: 'click-help-closes-settings' });

  const outside = await s.eval(`(r=document.getElementById('ns-hero-card').getBoundingClientRect(), {x:r.x+r.width/2, y:r.y+r.height/2})`);
  await s.clickXY(outside.x, outside.y);
  const allClosed = await waitFor(`!document.querySelector('.menu-item.open')`, 'warm outside native click closes every top menu');
  requireGate(allClosed, 'warm outside click did not close top menu');
  results.mouse.push({ step: 'outside-click-closes', allClosed });

  await s.click('#menu-power > span');
  await waitFor(`document.getElementById('menu-power').classList.contains('open')`, 'warm Power menu primed for keyboard path');
  await s.key('Escape');
  await waitFor(`!document.querySelector('.menu-item.open') && document.activeElement?.id === 'menu-power'`, 'warm Power trigger focused after Escape');
  await s.key('Enter');
  const powerOpen = await waitFor(`document.getElementById('menu-power').classList.contains('open')`, 'warm Enter opens Power menu');
  requireGate(powerOpen, 'warm Enter did not open Power');
  results.keyboard.push({ step: 'enter-opens-power', powerOpen });
  await s.key('ArrowDown');
  await waitFor(`document.activeElement?.dataset?.action === 'restart'`, 'warm ArrowDown focuses Restart');
  results.keyboard.push({ step: 'arrow-down-focuses-restart' });
  await s.key('Escape');
  const closedByEscape = await waitFor(`!document.querySelector('.menu-item.open') && document.activeElement?.id === 'menu-power'`, 'warm Escape closes Power and returns focus');
  requireGate(closedByEscape, 'warm Escape did not close Power and return focus');
  results.keyboard.push({ step: 'escape-closes', closedByEscape });

  return results;
}

async function runWarmSettingsTogglePass(s) {
  const results = [];
  // Same measured-overhead basis as runTopMenuGate's waitFor (~2.0s floor per
  // native click): these post-click assertions follow the identical top-menu
  // click pattern, so they carry the same widened, finite budget.
  await s.click('#menu-settings > span');
  await s.condition(`document.getElementById('menu-settings').classList.contains('open')`, 5000, 'warm Settings menu open for Dry Run toggle');
  await s.click('#toggle-dryrun');
  await s.condition(`document.querySelector('#toggle-dryrun .toggle-indicator').textContent === 'OFF'`, 5000, 'warm Dry Run toggle visibly disabled');
  let indicator = await s.eval(`document.querySelector('#toggle-dryrun .toggle-indicator').textContent`);
  requireGate(indicator === 'OFF', 'warm Dry Run toggle did not visibly disable', indicator);
  results.push({ step: 'toggle-off', indicator });

  await s.click('#menu-settings > span');
  await s.condition(`document.getElementById('menu-settings').classList.contains('open')`, 5000, 'warm Settings menu reopened to restore Dry Run');
  await s.click('#toggle-dryrun');
  await s.condition(`state.dryRun === true`, 5000, 'warm Dry Run restored');
  indicator = await s.eval(`document.querySelector('#toggle-dryrun .toggle-indicator').textContent`);
  requireGate(indicator === 'ON', 'warm Dry Run toggle did not visibly restore', indicator);
  results.push({ step: 'toggle-on-restore', indicator });

  await s.click('#open-options');
  await s.condition(`getComputedStyle(document.getElementById('ns-panel-set')).display !== 'none'`, 5000, 'warm Advanced Options opens Settings panel');
  const settingsVisible = await s.eval(`document.getElementById('ns-panel-set').style.display !== 'none'`);
  requireGate(settingsVisible, 'warm Advanced Options did not open the Settings workspace');
  results.push({ step: 'advanced-options-opens-settings', settingsVisible });

  await s.click('#modal-close');
  await s.condition(`document.querySelector('.ns-nav-item.active')?.dataset?.nsTab === 'lib'`, 5000, 'warm native Settings close restores Tonight');
  const restored = await s.eval(`document.querySelector('.ns-nav-item.active')?.dataset.nsTab`);
  requireGate(restored === 'lib', 'warm closing Settings did not restore Tonight', restored);
  results.push({ step: 'close-restores-route', restored });
  return results;
}

async function runWarmSharedStartPass(s) {
  const results = [];
  await clearStarts(s);
  await s.click('#ns-play-btn');
  await s.condition(`state.running`, 6000, 'warm hero Start enters running state');
  let invocations = await getStarts(s);
  requireGate(invocations.length === 1 && invocations[0]?.options?.startOrigin === 'play' && invocations[0]?.options?.dryRun === true, 'warm hero Start payload violated shared Start/Dry Run contract', invocations);
  results.push({ control: 'ns-play-btn', invocations: invocations.length });
  await s.click('#btn-stop');
  await s.condition(`!state.running && !state.paused`, 3000, 'warm native Cancel stops hero-started session');

  await clearStarts(s);
  await s.key(' ');
  await s.condition(`state.running`, 6000, 'warm Space enters running state');
  invocations = await getStarts(s);
  requireGate(invocations.length === 1 && invocations[0]?.options?.startOrigin === 'play' && invocations[0]?.options?.dryRun === true, 'warm Space Start payload diverged from shared Start contract', invocations);
  results.push({ control: 'space-key', invocations: invocations.length });
  await s.click('#btn-stop');
  await s.condition(`!state.running && !state.paused`, 3000, 'warm native Cancel stops Space-started session');

  const realPowerActions = await getRealPowerActions(s);
  requireGate(realPowerActions.length === 0, 'warm shared-start pass attempted a real power action', realPowerActions);
  return results;
}

async function assertWarmBaseline(s, iterationLabel) {
  const baseline = await s.eval(`({
    route: document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null,
    openMenus: Array.from(document.querySelectorAll('.menu-item.open')).map(menu => menu.id),
    activeModals: Array.from(document.querySelectorAll('.modal.active')).map(modal => modal.id),
    running: state.running,
    paused: state.paused,
    dryRun: state.dryRun,
    ritualOverlayActive: document.getElementById('ritual-overlay')?.classList.contains('active') || false,
    heroVisible: getComputedStyle(document.getElementById('ns-hero-card')).display !== 'none'
  })`);
  requireGate(
    baseline.route === 'lib' &&
    baseline.openMenus.length === 0 &&
    baseline.activeModals.length === 0 &&
    baseline.running === false &&
    baseline.paused === false &&
    baseline.dryRun === true &&
    !baseline.ritualOverlayActive &&
    baseline.heroVisible,
    `warm iteration ${iterationLabel} did not reach the known reset baseline before proceeding`,
    baseline
  );
  return baseline;
}

async function resetToWarmBaseline(s) {
  for (let i = 0; i < 3; i++) {
    const openState = await s.eval(`({
      openMenus: Array.from(document.querySelectorAll('.menu-item.open')).map(menu => menu.id),
      activeModals: Array.from(document.querySelectorAll('.modal.active')).map(modal => modal.id)
    })`);
    if (openState.openMenus.length === 0 && openState.activeModals.length === 0) break;
    await s.key('Escape');
    await WAIT(150);
  }
  const active = await s.eval(`state.running || state.paused`);
  if (active) {
    await s.click('#btn-stop');
    await s.condition(`!state.running && !state.paused`, 3000, 'warm reset stops any active run through the supported Cancel control');
  }
  const route = await s.eval(`document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || null`);
  if (route !== 'lib') {
    await s.click('[data-ns-tab="lib"]');
    await s.condition(`document.querySelector('.ns-nav-item.active')?.dataset?.nsTab === 'lib'`, 2000, 'warm reset returns to the Tonight tab through the visible nav');
  }
}

async function runWarmIteration(s, iterationIndex, modeId) {
  const phase = `warm-${iterationIndex}`;
  const results = {};
  results.topMenu = await runWarmTopMenuPass(s);
  results.settingsToggle = await runWarmSettingsTogglePass(s);
  results.sharedStart = await runWarmSharedStartPass(s);
  results.useTonight = await armAndStartMode(s, modeId, phase);
  await resetToWarmBaseline(s);
  results.baseline = await assertWarmBaseline(s, iterationIndex);
  return results;
}

async function runWarmMatrix(iterations) {
  const phase = 'warm-matrix';
  const userData = path.join(ROOT_DIR, 'userdata-warm');
  const { child, session: s } = await spawnApp(userData);
  const allResults = [];
  try {
    await s.resize(1280, 720);
    await s.waitFor('#ns-play-btn');
    await resetToWarmBaseline(s);
    await assertWarmBaseline(s, 'initial');
    for (let i = 1; i <= iterations; i++) {
      const modeId = i % 2 === 1 ? 'movie-wind-down' : 'full-shutdown';
      const iterationResult = await runWarmIteration(s, i, modeId);
      allResults.push({ iteration: i, modeId, ...iterationResult });
      const realPowerActions = await getRealPowerActions(s);
      requireGate(realPowerActions.length === 0, `warm iteration ${i} left a real power action recorded`, realPowerActions);
    }
    report.phases[phase] = { status: 'passed', results: allResults, processReused: true, restarts: 0 };
  } finally {
    await stopApp(child);
  }
  return allResults;
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

function cleanupUserDataDirs() {
  try {
    for (const entry of fs.readdirSync(ROOT_DIR)) {
      if (entry.startsWith('userdata-')) fs.rmSync(path.join(ROOT_DIR, entry), { recursive: true, force: true });
    }
  } catch {}
}

async function main() {
  if (!fs.existsSync(EXE_PATH)) throw new Error(`Desktop runtime executable missing: ${EXE_PATH}`);
  const workerReady = await nativeInputWorker.start();
  report.nativeInputWorker = { script: path.join(__dirname, 'native-input-worker.ps1'), ready: workerReady };
  console.log('Desktop UX Functional Gate');
  console.log('Runtime:', SOURCE_RUNTIME ? 'source Electron' : 'packaged');
  console.log('Executable:', EXE_PATH);
  console.log('Root:', ROOT_DIR);

  // Mode selection: 'cold' (default) performs the full flow inventory through
  // fresh per-scenario launches, unchanged from prior behavior. 'warm' launches
  // the packaged app exactly once and reuses that one process across N
  // iterations of the flow inventory, resetting only through supported visible
  // UI (never restarting) between iterations.
  const mode = process.env.LIGHTS_OUT_GATE_MODE === 'warm' ? 'warm' : 'cold';
  report.mode = mode;
  console.log('Mode:', mode);

  if (mode === 'warm') {
    const iterations = Number(process.env.LIGHTS_OUT_GATE_WARM_ITERATIONS || 5);
    await runWarmMatrix(iterations);
  } else {
    await runStartupGate();
    await runTopMenuGate();
    await runSharedStartGate();
    await runUseTonightGate();
    await runSettingsGate();
    await runActiveRunGate();
  }

  const uncaughtExceptions = runtimeSessions.flatMap(({ label, session }) => session.exceptions.map(exception => ({ label, ...exception })));
  requireGate(uncaughtExceptions.length === 0, 'uncaught renderer exceptions were captured', uncaughtExceptions);
  report.status = 'passed';
  report.realPowerActions = 0;
  report.endTime = new Date().toISOString();
  await writeArtifacts();
  cleanupUserDataDirs();
  console.log(JSON.stringify({ root: ROOT_DIR, mode, screenshots: report.screenshots.length, phases: Object.keys(report.phases) }, null, 2));
}

main().catch(async err => {
  report.status = 'failed';
  report.failure = { message: err.message, stack: err.stack };
  report.endTime = new Date().toISOString();
  try { await writeArtifacts(); } catch (artifactError) {
    console.error('Failed to write failure artifacts:', artifactError);
  }
  cleanupUserDataDirs();
  console.error('Gate fatal:', err);
  process.exitCode = 1;
}).finally(async () => {
  await nativeInputWorker.stop();
});
