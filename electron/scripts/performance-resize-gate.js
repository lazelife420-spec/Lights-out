#!/usr/bin/env node
// Gate 5 — measure-first resize/render performance baseline.
// Uses the packaged native runtime and Chrome DevTools Protocol to record
// hashes, idle metrics, resize frame cadence, and navigation stress.

'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { promisify } = require('util');
const WebSocket = require('ws');

const execFileAsync = promisify(execFile);

const EXE_PATH = process.env.LIGHTS_OUT_NATIVE_EXE
  ? path.resolve(process.env.LIGHTS_OUT_NATIVE_EXE)
  : path.resolve(__dirname, '..', '..', 'dist-native', 'win-unpacked', 'Lights Out.exe');
const APP_DIR_PATH = path.resolve(path.dirname(EXE_PATH), 'resources', 'app');
const ROOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-perf-gate5-'));

function hashManifest(dir) {
  const files = [
    'package.json', 'main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css'
  ];
  const out = {};
  for (const f of files) {
    const p = path.join(dir, f);
    out[f] = fs.existsSync(p) ? sha256(p) : null;
  }
  return out;
}

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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

async function getProcessInfo(pid) {
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $p = Get-Process -Id ${Number(pid)} -ErrorAction Stop;
      [pscustomobject]@{
        workingSetMB = [math]::Round($p.WorkingSet64 / 1MB, 2);
        privateMB = [math]::Round($p.PrivateMemorySize64 / 1MB, 2);
        cpuSeconds = [math]::Round($p.TotalProcessorTime.TotalSeconds, 3);
        threads = $p.Threads.Count;
        handles = $p.Handles;
      } | ConvertTo-Json -Compress
    `], { windowsHide: true, timeout: 10000 });
    return JSON.parse(stdout);
  } catch (error) {
    return { error: error.message };
  }
}

class CdpSession {
  constructor(ws, targetId) {
    this.ws = ws;
    this.targetId = targetId;
    this.nextId = 1;
    this.pending = new Map();
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

  async setWindowBounds(bounds) {
    await this.eval(`window.resizeTo(${Number(bounds.width)}, ${Number(bounds.height)})`);
  }

  async perfMetrics() {
    try {
      const r = await this.send('Performance.getMetrics');
      const metrics = {};
      for (const m of r.result.metrics) metrics[m.name] = m.value;
      return metrics;
    } catch {
      return {};
    }
  }

  async rendererMemorySnapshot() {
    return this.eval(`(typeof performance !== 'undefined' && performance.memory) ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      domNodes: document.getElementsByTagName('*').length,
      listeners: (window.getEventListeners ? Object.keys(getEventListeners(document)).length : null)
    } : { error: 'performance.memory unavailable' }`);
  }

  close() { try { this.ws.close(); } catch {} }
}

async function connectCdp(port) {
  const deadline = Date.now() + 20000;
  let page = null;
  while (Date.now() < deadline) {
    try {
      const list = await getCdpList(port);
      page = list.find(p => p.type === 'page' && /index\.html/.test(p.url));
      if (page) break;
    } catch {}
    await wait(250);
  }
  if (!page) throw new Error('No renderer page target found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  const session = new CdpSession(ws, page.id);
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  return session;
}

async function spawnApp(userDataDir, port) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({
    app: { dryRun: true, nsActiveTab: 'home', onboarded: true }
  }, null, 2));

  const child = spawn(EXE_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-gpu'
  ], {
    detached: true,
    env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1' }
  });
  return child;
}

function stopApp(child) {
  return new Promise(resolve => {
    if (!child) return resolve();
    const pid = child.pid;
    try { child.kill(); } catch {}
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)]);
    killer.on('error', () => {});
    killer.on('close', () => resolve());
    setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch {} resolve(); }, 1200);
  });
}

async function getChildPids(parentPid) {
  try {
    const { stdout } = await execFileAsync('wmic.exe', [
      'process', 'where', `(ParentProcessId=${parentPid})`, 'get', 'ProcessId', '/value'
    ], { windowsHide: true, timeout: 10000 });
    return stdout.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith('ProcessId='))
      .map(line => Number(line.split('=')[1]))
      .filter(n => n > 0);
  } catch {
    return [];
  }
}

async function setupFrameCounter(session) {
  await session.eval(`
    if (!window.__perfFrameProbe) {
      const marks = [];
      let running = false;
      function probe(t) {
        marks.push(t);
        if (running) requestAnimationFrame(probe);
      }
      window.__perfFrameProbe = {
        marks,
        start() { running = true; marks.length = 0; requestAnimationFrame(probe); },
        stop() { running = false; },
        stats() {
          const deltas = [];
          for (let i = 1; i < marks.length; i++) deltas.push(marks[i] - marks[i - 1]);
          const janks = deltas.filter(d => d > 50);
          return {
            frames: marks.length,
            avgDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0,
            maxDelta: deltas.length ? Math.max(...deltas) : 0,
            jankFrames: janks.length,
            p99Delta: deltas.length ? (deltas.sort((a, b) => a - b)[Math.floor(deltas.length * 0.99)] || 0) : 0
          };
        }
      };
    }
    window.__perfFrameProbe.start();
  `);
}

async function stopFrameCounter(session) {
  return session.eval(`window.__perfFrameProbe.stop(); window.__perfFrameProbe.stats()`);
}

async function routeNames(session) {
  return session.eval(`Array.from(document.querySelectorAll('.ns-nav-item')).map(el => ({ id: el.dataset.nsTab, text: el.textContent.trim() }))`);
}

async function navigateTo(session, tabId) {
  await session.eval(`{
    const el = document.querySelector('.ns-nav-item[data-ns-tab="${tabId}"]');
    if (el) { el.click(); }
  }`);
  await wait(600);
}

async function activeRoute(session) {
  return session.eval(`document.querySelector('.ns-nav-item.active')?.dataset.nsTab || 'unknown'`);
}

async function runResizeSurface(session, surface, boundsList, cycles = 6) {
  await setupFrameCounter(session);
  await wait(300);
  const perfBefore = await session.perfMetrics();

  const timings = [];
  const start = performance.now();
  for (let i = 0; i < cycles; i++) {
    for (const bounds of boundsList) {
      const t0 = performance.now();
      await session.setWindowBounds(bounds);
      timings.push({ to: `${bounds.width}x${bounds.height}`, ms: performance.now() - t0 });
      await wait(120);
    }
  }
  const duration = performance.now() - start;
  await wait(200);
  const perfAfter = await session.perfMetrics();
  const frameStats = await stopFrameCounter(session);
  return {
    surface,
    durationMs: duration,
    resizeCount: timings.length,
    resizeSetTimingsMs: timings,
    frameStats,
    perfBefore,
    perfAfter
  };
}

async function main() {
  if (!fs.existsSync(EXE_PATH)) {
    console.error('Packaged exe not found:', EXE_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(APP_DIR_PATH)) {
    console.error('resources/app dir not found:', APP_DIR_PATH);
    process.exit(1);
  }

  const report = {
    timestamp: new Date().toISOString(),
    exePath: EXE_PATH,
    exeSha256: sha256(EXE_PATH),
    appManifestSha256: hashManifest(APP_DIR_PATH),
    phases: {}
  };

  const userDataDir = path.join(ROOT_DIR, 'userdata');
  const port = 9711;
  let child;
  let session;

  try {
    child = await spawnApp(userDataDir, port);
    session = await connectCdp(port);
    await wait(1500);

    // 5A baseline
    const childPids = await getChildPids(child.pid);
    report.baseline = {
      mainPid: child.pid,
      childPids,
      windowBounds: await session.eval(`({ x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight })`),
      route: await activeRoute(session),
      mainProcessInfo: await getProcessInfo(child.pid),
      childProcessInfos: {},
      rendererMemory: await session.rendererMemorySnapshot(),
      idlePerfMetrics: await session.perfMetrics()
    };
    for (const cpid of childPids) {
      report.baseline.childProcessInfos[cpid] = await getProcessInfo(cpid);
    }

    // 5B/5C — resize each major surface
    const boundsList = [
      { width: 1000, height: 700 },
      { width: 680, height: 880 },
      { width: 1100, height: 760 },
      { width: 760, height: 640 }
    ];
    const surfaces = ['home', 'lib', 'schedule', 'devices', 'proof', 'set'];
    report.resizeResults = [];
    for (const surface of surfaces) {
      await navigateTo(session, surface);
      report.resizeResults.push(await runResizeSurface(session, surface, boundsList, 8));
    }

    // 5D — navigation memory stress
    await navigateTo(session, 'home');
    await wait(500);
    const memBefore = await session.rendererMemorySnapshot();
    const routeOrder = ['home', 'lib', 'schedule', 'devices', 'proof', 'set'];
    for (let i = 0; i < 30; i++) {
      for (const tab of routeOrder) {
        await navigateTo(session, tab);
      }
    }
    await navigateTo(session, 'home');
    await wait(1000);
    const memAfter = await session.rendererMemorySnapshot();
    const childPidsAfter = await getChildPids(child.pid);
    const childProcessInfosAfter = {};
    for (const cpid of childPidsAfter) {
      childProcessInfosAfter[cpid] = await getProcessInfo(cpid);
    }
    report.navigationStress = {
      cycles: 30,
      rendererMemoryBefore: memBefore,
      rendererMemoryAfter: memAfter,
      mainProcessBefore: report.baseline.mainProcessInfo,
      mainProcessAfter: await getProcessInfo(child.pid),
      childProcessInfosAfter
    };

    // Final route
    report.finalRoute = await activeRoute(session);
  } finally {
    if (session) session.close();
    await stopApp(child);
  }

  const reportPath = path.join(ROOT_DIR, 'gate5-baseline.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Console summary
  console.log('Gate 5A — baseline measured');
  console.log(`  EXE:     ${report.exeSha256}`);
  console.log(`  Manifest hashes recorded for: ${Object.keys(report.appManifestSha256).join(', ')}`);
  console.log(`  Main:    ${child.pid}  workingSet=${report.baseline.mainProcessInfo.workingSetMB}MB  private=${report.baseline.mainProcessInfo.privateMB}MB`);
  console.log(`  Route:   ${report.baseline.route}`);
  console.log('\nGate 5B/5C — resize surfaces');
  for (const r of report.resizeResults) {
    const jankPct = r.frameStats.frames ? Math.round((r.frameStats.jankFrames / r.frameStats.frames) * 100) : 0;
    console.log(`  ${r.surface.padEnd(9)} frames=${r.frameStats.frames} jank=${r.frameStats.jankFrames}(${jankPct}%) maxDelta=${r.frameStats.maxDelta.toFixed(1)}ms avgDelta=${r.frameStats.avgDelta.toFixed(1)}ms`);
  }
  console.log('\nGate 5D — navigation stress (30 cycles x 6 routes)');
  const heapGrowth = report.navigationStress.rendererMemoryAfter.usedJSHeapSize - report.navigationStress.rendererMemoryBefore.usedJSHeapSize;
  const domGrowth = report.navigationStress.rendererMemoryAfter.domNodes - report.navigationStress.rendererMemoryBefore.domNodes;
  console.log(`  heapUsed growth: ${heapGrowth} bytes  domNodes growth: ${domGrowth}`);
  console.log(`\nFull report: ${reportPath}`);
}

main().catch(error => {
  console.error('Fatal gate error:', error);
  process.exit(1);
});
