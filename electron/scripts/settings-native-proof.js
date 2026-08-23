#!/usr/bin/env node
// Native Settings runtime proof for the built Windows Electron app.
// Uses Chrome DevTools Protocol over --remote-debugging-port.
// Runs dry-run only and keeps every test in an isolated userData directory.

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EXE_PATH = process.env.LIGHTS_OUT_NATIVE_EXE
  ? path.resolve(process.env.LIGHTS_OUT_NATIVE_EXE)
  : path.resolve(__dirname, '..', '..', 'dist-native', 'win-unpacked', 'Lights Out.exe');
const ROOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-settings-native-proof-'));
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

let globalPort = 9351;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function getCdpList(port) {
  const raw = await httpGet(`http://127.0.0.1:${port}/json/list`);
  return JSON.parse(raw);
}

class CdpSession {
  constructor(ws, targetId) {
    this.ws = ws;
    this.targetId = targetId;
    this.nextId = 1;
    this.pending = new Map();
    this.console = [];
    ws.on('message', data => this.onMessage(data));
  }

  onMessage(data) {
    const msg = JSON.parse(data);
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) {
          const err = new Error(msg.error.message || JSON.stringify(msg.error));
          err.cdpError = msg.error;
          p.reject(err);
        } else {
          p.resolve(msg);
        }
      }
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      this.console.push(msg.params);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      this.console.push({ level: 'exception', text: msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text });
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, awaitPromise = true, returnByValue = true) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue,
      includeCommandLineAPI: true
    });
    if (r.result && r.result.exceptionDetails) {
      const desc = r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text;
      throw new Error(`eval failed: ${desc}\nexpr: ${expression.slice(0, 200)}`);
    }
    return r.result.result.value;
  }

  async click(selector) {
    const pos = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('missing selector: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await wait(120);
  }

  async key(key, code, windowsVirtualKeyCode, text = null) {
    const down = { type: 'keyDown', key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
    const up = { type: 'keyUp', key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
    if (text !== null) {
      down.text = text;
      down.unmodifiedText = text;
    }
    await this.send('Input.dispatchKeyEvent', down);
    await this.send('Input.dispatchKeyEvent', up);
    await wait(120);
  }

  async screenshot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const data = (r.result && r.result.data) || r.data;
    if (!data) throw new Error('Page.captureScreenshot returned no data: ' + JSON.stringify(r).slice(0, 200));
    const buf = Buffer.from(data, 'base64');
    const p = path.join(SCREENSHOTS_DIR, name);
    fs.writeFileSync(p, buf);
    return { path: p, size: buf.length };
  }

  async resize(w, h) {
    // Browser.* may not be implemented in Electron; fallback to window.resizeTo
    try {
      const win = await this.send('Browser.getWindowForTarget', { targetId: this.targetId });
      await this.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width: w, height: h } });
    } catch {
      await this.eval(`window.moveTo(0,0); window.resizeTo(${w}, ${h})`);
    }
    await wait(300);
  }

  async ensureSettingsOpen() {
    let open = await this.eval(`(document.getElementById('ns-panel-set')?.style.display !== 'none')`);
    if (!open) {
      await this.click('[data-ns-tab="set"]');
      await wait(250);
      open = await this.eval(`(document.getElementById('ns-panel-set')?.style.display !== 'none')`);
      if (!open) {
        // Fallback: top-bar Settings menu -> Options.
        await this.click('#menu-settings');
        await wait(120);
        await this.click('#open-options');
        await wait(250);
        open = await this.eval(`(document.getElementById('ns-panel-set')?.style.display !== 'none')`);
        if (!open) throw new Error('Could not open Settings panel');
      }
    }
    const current = await this.eval(`(document.querySelector('.settings-rail-btn.active')?.dataset?.settingsCategory || '')`);
    if (current !== 'general') {
      await this.click('.settings-rail-btn[data-settings-category="general"]');
      await wait(100);
    }
  }

  async metrics() {
    return this.eval(`({
      display: { width: window.screen.width, height: window.screen.height },
      workArea: { width: window.screen.availWidth, height: window.screen.availHeight },
      outer: { width: window.outerWidth, height: window.outerHeight },
      inner: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio
    })`);
  }
}

async function spawnApp(userDataDir, settingsSeed = {}) {
  const port = globalPort++;
  fs.mkdirSync(userDataDir, { recursive: true });

  const defaults = {
    app: {
      dryRun: true,
      nsActiveTab: 'home',
      onboarded: true
    }
  };
  if (settingsSeed.app) Object.assign(defaults.app, settingsSeed.app);
  const settingsPath = path.join(userDataDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2));
  fs.copyFileSync(settingsPath, path.join(userDataDir, 'seed-settings.json'));

  const child = spawn(EXE_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-gpu'
  ], {
    detached: true,
    env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1' }
  });

  // wait for CDP
  let list = [];
  for (let i = 0; i < 40; i++) {
    try {
      list = await getCdpList(port);
      if (list.length) break;
    } catch {}
    await wait(250);
  }
  if (!list.length) {
    try { child.kill('SIGTERM'); } catch {}
    throw new Error(`Electron did not expose CDP on port ${port}`);
  }

  const page = list.find(p => p.type === 'page' && p.title === 'Lights Out');
  if (!page) {
    try { child.kill('SIGTERM'); } catch {}
    throw new Error('Lights Out page not found in CDP list: ' + JSON.stringify(list));
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

  const session = new CdpSession(ws, page.id);
  await session.send('Runtime.enable');
  await session.send('Page.enable');

  await wait(400);
  return { child, session, port, userDataDir };
}

function stopApp({ child, session }) {
  return new Promise(resolve => {
    if (session && session.ws) try { session.ws.close(); } catch {}
    if (!child) return resolve();
    const pid = child.pid;
    try { child.kill(); } catch {}
    // Windows: forcefully terminate the whole process tree.
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)]);
    killer.on('error', () => {});
    killer.on('close', () => resolve());
    setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch {} resolve(); }, 1200);
  });
}

const helpers = {
  isHomeActive: `document.querySelector('.ns-nav-item[data-ns-tab="home"]')?.classList.contains('active') === true`,
  isSetVisible: `document.getElementById('ns-panel-set')?.style.display !== 'none'`,
  isSetHidden: `document.getElementById('ns-panel-set')?.style.display === 'none'`,
  isAboutActive: `document.getElementById('about-modal')?.classList.contains('active') === true`,
  activeTab: `document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || ''`,
  visibleCategory: `document.querySelector('.settings-categories .option-section.settings-category-active')?.dataset?.settingsCategory || ''`,
  activeRail: `document.querySelector('.settings-rail-btn.active')?.dataset?.settingsCategory || ''`,
  focusBlocklistValue: `document.getElementById('focus-blocklist')?.value || ''`,
  runLoginValue: `document.getElementById('chk-run-login')?.checked || false`,
  dryRunValue: `document.getElementById('chk-dryrun')?.checked || false`,
  graceValue: `document.getElementById('grace-minutes')?.value || ''`,
  panelHomeVisible: `document.getElementById('ns-panel-home')?.style.display !== 'none'`,
  panelSetVisible: `document.getElementById('ns-panel-set')?.style.display !== 'none'`,
};

async function readDiskApp(userDataDir) {
  const p = path.join(userDataDir, 'settings.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')).app || {};
}

async function runStartupProof(seed, label) {
  const userData = path.join(ROOT_DIR, label);
  fs.mkdirSync(userData, { recursive: true });
  const app = await spawnApp(userData, { app: seed });

  let result = { label, passed: [], failed: [] };
  try {
    const homeActive = await app.session.eval(helpers.isHomeActive);
    const setHidden = await app.session.eval(helpers.isSetHidden);
    const aboutActive = await app.session.eval(helpers.isAboutActive);
    if (homeActive) result.passed.push('sidebar Home active'); else result.failed.push('sidebar Home not active');
    if (setHidden) result.passed.push('Settings panel hidden'); else result.failed.push('Settings panel visible at startup');
    if (!aboutActive) result.passed.push('About/Help not active'); else result.failed.push('About/Help active at startup');

    // flash detection at 0/50/100/200ms after load
    const snapshots = [];
    for (const t of [0, 50, 100, 200]) {
      await wait(t);
      const v = await app.session.eval(`(document.getElementById('ns-panel-set')?.style.display === 'none' && !document.getElementById('about-modal')?.classList.contains('active'))`);
      snapshots.push({ t, ok: v });
    }
    if (snapshots.every(s => s.ok)) result.passed.push('no Settings/Help flash during startup');
    else result.failed.push('flash detected: ' + JSON.stringify(snapshots));

    const settingsOnDisk = await readDiskApp(userData);
    const apiApp = await app.session.eval(`(async () => { const s = await window.electronAPI.getAppSettings(); return s.app; })()`);
    result.apiApp = apiApp;
    result.diskApp = settingsOnDisk;
    result.ok = result.failed.length === 0;
  } finally {
    await stopApp(app);
  }
  return result;
}

async function main() {
  const report = {
    build: {
      exe: EXE_PATH,
      unpackedExe: EXE_PATH,
    },
    screenshots: [],
    results: []
  };

  // Verify the built exe exists.
  if (!fs.existsSync(EXE_PATH)) {
    console.error('Built exe not found. Run npm run build first.');
    process.exit(1);
  }

  console.log('\nNative Settings Runtime Proof');
  console.log(`Root proof dir: ${ROOT_DIR}`);

  // 1. Clean startup
  console.log('\n--- Clean startup ---');
  const clean = await runStartupProof({}, 'clean-startup');
  report.results.push(clean);
  console.log(clean.ok ? 'PASS' : 'FAIL', clean.label, clean.failed);

  // 2. Legacy set migration
  console.log('\n--- Legacy set migration ---');
  const setMigration = await runStartupProof({ nsActiveTab: 'set', unrelatedProofKey: 'preserve-me' }, 'legacy-set');
  report.results.push(setMigration);
  console.log(setMigration.ok ? 'PASS' : 'FAIL', setMigration.label, setMigration.failed);

  // 3. Legacy help migration
  console.log('\n--- Legacy help migration ---');
  const helpMigration = await runStartupProof({ nsActiveTab: 'help', unrelatedProofKey: 'preserve-me' }, 'legacy-help');
  report.results.push(helpMigration);
  console.log(helpMigration.ok ? 'PASS' : 'FAIL', helpMigration.label, helpMigration.failed);

  // 4. Settings interactions
  console.log('\n--- Settings controls proof ---');
  const controlsDir = path.join(ROOT_DIR, 'controls');
  const app = await spawnApp(controlsDir, { app: { dryRun: true, nsActiveTab: 'home' } });

  const controlsResult = { label: 'settings-controls', passed: [], failed: [], screenshots: [] };

  try {
    await app.session.resize(1280, 720);

    // open via sidebar
    await app.session.click('[data-ns-tab="set"]');
    await wait(300);
    if (await app.session.eval(helpers.isSetVisible)) controlsResult.passed.push('sidebar opens Settings');
    else controlsResult.failed.push('sidebar did not open Settings');
    if (await app.session.eval(helpers.activeRail) === 'general') controlsResult.passed.push('default category is General');
    else controlsResult.failed.push('default category not General: ' + await app.session.eval(helpers.activeRail));

    // return to Home via Back
    await app.session.click('#modal-close');
    await wait(300);
    if (await app.session.eval(helpers.isSetHidden) && await app.session.eval(helpers.panelHomeVisible)) controlsResult.passed.push('Back returns to Home');
    else controlsResult.failed.push('Back did not return to Home');

    // open via top menu
    await app.session.click('#menu-settings');
    await wait(100);
    await app.session.click('#open-options');
    await wait(300);
    if (await app.session.eval(helpers.isSetVisible)) controlsResult.passed.push('top menu opens Settings');
    else controlsResult.failed.push('top menu did not open Settings');

    await app.session.click('#modal-close');
    await wait(300);

    // open via keyboard (focus sidebar settings and press Enter)
    await app.session.eval(`window.focus(); document.querySelector('[data-ns-tab="set"]').focus();`);
    await app.session.key('Enter', 'Enter', 13, '\r');
    await wait(400);
    if (await app.session.eval(helpers.isSetVisible)) controlsResult.passed.push('keyboard Enter opens Settings');
    else {
      controlsResult.failed.push('keyboard Enter did not open Settings');
      // Ensure Settings is open for the remaining tests so we can keep collecting evidence.
      await app.session.ensureSettingsOpen();
    }

    // categories
    await app.session.ensureSettingsOpen();
    const categories = [
      ['general', 'General'],
      ['power-safety', 'Power & Safety'],
      ['wind-down', 'Wind-Down'],
      ['phone', 'Phone Companion'],
      ['protection', 'Protection'],
      ['accountability', 'Accountability'],
      ['automations', 'Automations'],
      ['appearance', 'Appearance & Sound'],
      ['advanced', 'Advanced']
    ];

    for (const [cat, label] of categories) {
      await app.session.click(`.settings-rail-btn[data-settings-category="${cat}"]`);
      await wait(100);
      const activeRail = await app.session.eval(helpers.activeRail);
      const visibleCat = await app.session.eval(helpers.visibleCategory);
      if (activeRail === cat && visibleCat === cat) {
        controlsResult.passed.push(`category ${label} active and visible`);
      } else {
        controlsResult.failed.push(`category ${label}: rail=${activeRail}, visible=${visibleCat}`);
      }
    }

    // Save proof: change focus-blocklist and save
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const originalBlocklist = await app.session.eval(helpers.focusBlocklistValue);
    await app.session.eval(`document.getElementById('focus-blocklist').value = 'chrome,discord'`);
    await app.session.click('#btn-save-opt');
    await wait(500);

    await app.session.click('[data-ns-tab="set"]');
    await wait(300);
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const savedBlocklist = await app.session.eval(helpers.focusBlocklistValue);
    if (savedBlocklist === 'chrome,discord') controlsResult.passed.push('Save persisted focus-blocklist');
    else controlsResult.failed.push('Save did not persist focus-blocklist: ' + savedBlocklist);

    // restore original
    await app.session.eval(`document.getElementById('focus-blocklist').value = ${JSON.stringify(originalBlocklist)}`);
    await app.session.click('#btn-save-opt');
    await wait(500);

    // Cancel proof: change focus-blocklist and run-at-login, cancel
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const origBlocklist2 = await app.session.eval(helpers.focusBlocklistValue);
    const origRunLogin = await app.session.eval(helpers.runLoginValue);
    const persistedBeforeCancel = await app.session.eval(`(async () => { const s = await window.electronAPI.getAppSettings(); return s.app; })()`);
    await app.session.eval(`document.getElementById('focus-blocklist').value = 'not,saved'`);
    await app.session.eval(`document.getElementById('chk-run-login').checked = ${!origRunLogin}`);
    await app.session.click('#btn-cancel-opt');
    await wait(500);

    controlsResult.debug = controlsResult.debug || {};
    controlsResult.debug.cancel = {
      persistedBeforeCancel,
      panelHiddenAfter: await app.session.eval(helpers.isSetHidden),
      homeVisibleAfter: await app.session.eval(helpers.panelHomeVisible)
    };

    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const afterCancelBlocklist = await app.session.eval(helpers.focusBlocklistValue);
    const afterCancelRunLogin = await app.session.eval(helpers.runLoginValue);
    if (afterCancelBlocklist === origBlocklist2 && afterCancelRunLogin === origRunLogin) {
      controlsResult.passed.push('Cancel reverted both changes');
    } else {
      controlsResult.failed.push(`Cancel revert failed: blocklist=${afterCancelBlocklist} vs ${origBlocklist2}, runLogin=${afterCancelRunLogin} vs ${origRunLogin}`);
    }

    // Back proof: change settings, click Back, reopen, verify discarded
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const origBlocklist3 = await app.session.eval(helpers.focusBlocklistValue);
    const origDryRun = await app.session.eval(helpers.dryRunValue);
    await app.session.eval(`document.getElementById('focus-blocklist').value = 'back,not,saved'`);
    await app.session.eval(`document.getElementById('chk-dryrun').checked = ${!origDryRun}`);
    await app.session.click('#modal-close');
    await wait(400);

    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const afterBackBlocklist = await app.session.eval(helpers.focusBlocklistValue);
    const afterBackDryRun = await app.session.eval(helpers.dryRunValue);
    if (afterBackBlocklist === origBlocklist3 && afterBackDryRun === origDryRun) {
      controlsResult.passed.push('Back to Home discarded both changes');
    } else {
      controlsResult.failed.push(`Back discard failed: blocklist=${afterBackBlocklist} vs ${origBlocklist3}, dryRun=${afterBackDryRun} vs ${origDryRun}`);
    }

    // Escape proof
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const origBlocklist4 = await app.session.eval(helpers.focusBlocklistValue);
    await app.session.eval(`document.getElementById('focus-blocklist').value = 'escape,not,saved'`);
    // Move focus out of the input so the global Escape handler closes Settings.
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    await app.session.key('Escape', 'Escape', 27);
    await wait(500);
    if (await app.session.eval(helpers.isSetHidden) && await app.session.eval(helpers.panelHomeVisible)) {
      controlsResult.passed.push('Escape closes Settings to Home');
    } else {
      controlsResult.failed.push('Escape did not close Settings');
    }
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const afterEscape = await app.session.eval(helpers.focusBlocklistValue);
    if (afterEscape === origBlocklist4) controlsResult.passed.push('Escape discarded the edit');
    else controlsResult.failed.push(`Escape did not discard: ${afterEscape} vs ${origBlocklist4}`);

    // Keyboard ownership regression tests
    await app.session.ensureSettingsOpen();
    await app.session.click('.settings-rail-btn[data-settings-category="general"]');
    await wait(120);

    // Space on a focused rail button should activate that category, not start the timer.
    await app.session.eval(`document.querySelector('.settings-rail-btn[data-settings-category="appearance"]').focus()`);
    await wait(120);
    const railSpaceBefore = await app.session.eval(`({ running: state.running, paused: state.paused, category: document.querySelector('.settings-rail-btn.active')?.dataset?.settingsCategory || '' })`);
    await app.session.key(' ', 'Space', 32, ' ');
    await wait(200);
    const railSpaceAfter = await app.session.eval(`({ running: state.running, paused: state.paused, category: document.querySelector('.settings-rail-btn.active')?.dataset?.settingsCategory || '', settingsVisible: document.getElementById('ns-panel-set')?.style.display !== 'none' })`);
    if (railSpaceAfter.settingsVisible && !railSpaceAfter.running && !railSpaceAfter.paused && railSpaceAfter.category === 'appearance') {
      controlsResult.passed.push('Space on focused rail button activates category, does not start timer');
    } else {
      controlsResult.failed.push(`rail Space ownership failed: ${JSON.stringify({ before: railSpaceBefore, after: railSpaceAfter })}`);
    }

    // Arrow keys on rail buttons should navigate focus between categories without
    // adjusting the timer or leaking to global shortcuts.
    await app.session.click('.settings-rail-btn[data-settings-category="general"]');
    await wait(120);
    await app.session.eval(`document.querySelector('.settings-rail-btn[data-settings-category="general"]').focus()`);
    await wait(120);
    const railArrowBefore = await app.session.eval(`({ focusedCategory: document.activeElement?.dataset?.settingsCategory || document.activeElement?.textContent || '', timerValue: document.getElementById('timer-input')?.value || '' })`);
    await app.session.key('ArrowDown', 'ArrowDown', 40);
    await wait(200);
    const railArrowAfter = await app.session.eval(`({ focusedCategory: document.activeElement?.dataset?.settingsCategory || document.activeElement?.textContent || '', timerValue: document.getElementById('timer-input')?.value || '' })`);
    if (railArrowAfter.focusedCategory !== railArrowBefore.focusedCategory && railArrowAfter.timerValue === railArrowBefore.timerValue) {
      controlsResult.passed.push('ArrowDown on rail navigates focus without changing timer');
    } else {
      controlsResult.failed.push(`rail ArrowDown ownership failed: ${JSON.stringify({ before: railArrowBefore, after: railArrowAfter })}`);
    }

    // With a modal open, arrow and Space keys must not leak to global shortcuts.
    await app.session.click('#menu-help');
    await wait(100);
    await app.session.click('#open-about');
    await wait(300);
    const modalKeyBefore = await app.session.eval(`({ aboutActive: document.getElementById('about-modal')?.classList.contains('active') === true, running: state.running, paused: state.paused })`);
    await app.session.key('ArrowDown', 'ArrowDown', 40);
    await app.session.key(' ', 'Space', 32, ' ');
    await wait(200);
    const modalKeyAfter = await app.session.eval(`({ aboutActive: document.getElementById('about-modal')?.classList.contains('active') === true, running: state.running, paused: state.paused })`);
    if (modalKeyAfter.aboutActive && modalKeyAfter.running === modalKeyBefore.running && modalKeyAfter.paused === modalKeyBefore.paused) {
      controlsResult.passed.push('keys with About modal open do not leak to global shortcuts');
    } else {
      controlsResult.failed.push(`modal key ownership failed: ${JSON.stringify({ before: modalKeyBefore, after: modalKeyAfter })}`);
    }
    // Use the modal close button to avoid leaving focus on a top-menu item.
    await app.session.click('#about-modal-close');
    await wait(300);

    // 10-cycle regression: behavior and state stability
    const baseline = await app.session.eval(`(async () => ({
      running: state.running,
      paused: state.paused,
      remainingSeconds: state.remainingSeconds,
      rc: await (window.electronAPI.getRemoteControl ? window.electronAPI.getRemoteControl() : Promise.resolve({ mode: 'off' }))
    }))()`);
    let cycleErrors = [];

    for (let i = 0; i < 10; i++) {
      await app.session.ensureSettingsOpen();
      await app.session.click(`.settings-rail-btn[data-settings-category="power-safety"]`);
      await app.session.click(`.settings-rail-btn[data-settings-category="general"]`);
      if (i % 2 === 0) {
        await app.session.eval(`document.getElementById('focus-blocklist').value = 'cycle-${i}'`);
        await app.session.click('#btn-cancel-opt');
      } else {
        await app.session.click('#btn-save-opt');
      }
      await wait(250);
      if (!await app.session.eval(helpers.isSetHidden)) {
        cycleErrors.push(`cycle ${i} did not return to Home`);
        await app.session.click('#modal-close');
        await wait(200);
      }
    }

    if (cycleErrors.length === 0) controlsResult.passed.push('ten cycles all returned to Home');
    else controlsResult.failed.push(...cycleErrors);

    // After ten cycles, a single category click must still produce exactly one transition.
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="wind-down"]`);
    await wait(100);
    const postCycleRail = await app.session.eval(helpers.activeRail);
    const postCycleVisible = await app.session.eval(helpers.visibleCategory);
    if (postCycleRail === 'wind-down' && postCycleVisible === 'wind-down') {
      controlsResult.passed.push('post-cycle single category click produces one transition');
    } else {
      controlsResult.failed.push(`post-cycle transition: rail=${postCycleRail}, visible=${postCycleVisible}`);
    }

    // A single Save must still persist exactly once.
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    await app.session.eval(`document.getElementById('focus-blocklist').value = 'post-cycle-save'`);
    await app.session.click('#btn-save-opt');
    await wait(500);
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const postCycleSaved = await app.session.eval(helpers.focusBlocklistValue);
    if (postCycleSaved === 'post-cycle-save') {
      controlsResult.passed.push('post-cycle single Save persists once');
      // restore
      await app.session.eval(`document.getElementById('focus-blocklist').value = ''`);
      await app.session.click('#btn-save-opt');
      await wait(500);
    } else {
      controlsResult.failed.push(`post-cycle Save did not persist: ${postCycleSaved}`);
    }

    // A single Cancel must still reload and discard.
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const beforeCancelValue = await app.session.eval(helpers.focusBlocklistValue);
    await app.session.eval(`document.getElementById('focus-blocklist').value = 'post-cycle-cancel'`);
    await app.session.click('#btn-cancel-opt');
    await wait(400);
    await app.session.ensureSettingsOpen();
    await app.session.click(`.settings-rail-btn[data-settings-category="advanced"]`);
    const afterCancelValue = await app.session.eval(helpers.focusBlocklistValue);
    if (afterCancelValue === beforeCancelValue) {
      controlsResult.passed.push('post-cycle single Cancel reloads once and discards');
    } else {
      controlsResult.failed.push(`post-cycle Cancel did not discard: ${afterCancelValue} vs ${beforeCancelValue}`);
    }

    // No companion restart and no timer mutation across the cycles.
    const afterCycles = await app.session.eval(`(async () => ({
      running: state.running,
      paused: state.paused,
      remainingSeconds: state.remainingSeconds,
      rc: await (window.electronAPI.getRemoteControl ? window.electronAPI.getRemoteControl() : Promise.resolve({ mode: baseline.rc.mode }))
    }))()`);
    if (afterCycles.rc.mode === baseline.rc.mode) controlsResult.passed.push('companion state stable across cycles');
    else controlsResult.failed.push(`companion mode changed: ${baseline.rc.mode} -> ${afterCycles.rc.mode}`);
    if (!afterCycles.running && !afterCycles.paused && afterCycles.remainingSeconds === baseline.remainingSeconds) {
      controlsResult.passed.push('timer state unchanged across cycles');
    } else {
      controlsResult.failed.push(`timer state mutated: running=${afterCycles.running}, paused=${afterCycles.paused}, remaining=${afterCycles.remainingSeconds}`);
    }

    // screenshots at sizes
    const initialMetrics = await app.session.metrics();
    report.displayBounds = initialMetrics.display;
    report.displayWorkArea = initialMetrics.workArea;

    const sizes = [
      { name: '1280x720', w: 1280, h: 720 },
      { name: '1920x1080', w: 1920, h: 1080 },
      { name: 'workarea', w: initialMetrics.workArea.width, h: initialMetrics.workArea.height }
    ];

    const views = [
      ['home', '[data-ns-tab="home"]'],
      ['general', `.settings-rail-btn[data-settings-category="general"]`],
      ['power-safety', `.settings-rail-btn[data-settings-category="power-safety"]`],
      ['protection', `.settings-rail-btn[data-settings-category="protection"]`],
      ['appearance', `.settings-rail-btn[data-settings-category="appearance"]`],
      ['advanced', `.settings-rail-btn[data-settings-category="advanced"]`]
    ];

    async function focusCategoryControl(category) {
      const selectors = {
        general: '#grace-minutes',
        'power-safety': '#chk-force-shutdown',
        protection: '#focus-blocklist',
        appearance: '#clock-scale',
        advanced: '#idle-threshold-seconds'
      };
      const selector = selectors[category] || '#grace-minutes';
      await app.session.eval(`(function(){ const el = document.querySelector('${selector}'); if (el) { el.focus(); el.style.outline = '3px solid #76c9ff'; el.style.outlineOffset = '2px'; } })()`);
    }

    for (const size of sizes) {
      await app.session.resize(size.w, size.h);
      for (const [viewName, navSelector] of views) {
        if (navSelector !== '[data-ns-tab="lib"]') {
          await app.session.click(navSelector);
          await wait(120);
        }
        const shot = await app.session.screenshot(`${size.name}-${viewName}.png`);
        const metrics = await app.session.metrics();
        controlsResult.screenshots.push({ name: `${size.name}-${viewName}`, path: shot.path, size: shot.size, dimensions: metrics });
      }
      // focused control screenshot per size
      await app.session.click('.settings-rail-btn[data-settings-category="general"]');
      await wait(120);
      await focusCategoryControl('general');
      await wait(120);
      const focusedShot = await app.session.screenshot(`${size.name}-focused-general.png`);
      const focusedMetrics = await app.session.metrics();
      controlsResult.screenshots.push({ name: `${size.name}-focused-general`, path: focusedShot.path, size: focusedShot.size, dimensions: focusedMetrics });
      // restore Home before next size
      await app.session.click('[data-ns-tab="home"]');
      await wait(120);
    }

    controlsResult.ok = controlsResult.failed.length === 0;
  } finally {
    await stopApp(app);
  }
  report.results.push(controlsResult);
  report.screenshots = controlsResult.screenshots;

  // Summary
  console.log('\n=== Native Settings Runtime Gate summary ===');
  let allPassed = true;
  for (const r of report.results) {
    console.log(r.ok ? 'PASS' : 'FAIL', r.label);
    if (r.passed) for (const p of r.passed) console.log('  +', p);
    if (r.failed) for (const f of r.failed) console.log('  -', f);
    if (!r.ok) allPassed = false;
  }
  console.log('\nScreenshots:', SCREENSHOTS_DIR);
  fs.writeFileSync(path.join(ROOT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report JSON:', path.join(ROOT_DIR, 'report.json'));
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal proof error:', err);
  process.exit(1);
});
