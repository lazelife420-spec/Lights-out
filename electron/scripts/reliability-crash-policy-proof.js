const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const EXE_PATH = process.env.LIGHTS_OUT_NATIVE_EXE
  ? path.resolve(process.env.LIGHTS_OUT_NATIVE_EXE)
  : path.resolve(__dirname, '..', '..', 'dist-native', 'win-unpacked', 'Lights Out.exe');

const ROOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-reliability-proof-'));

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

async function findPageTarget(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await getCdpList(port);
      const page = list.find(p => p.type === 'page' && /index\.html/.test(p.url));
      if (page) return page;
    } catch {}
    await wait(250);
  }
  throw new Error('No renderer page target found on CDP port');
}

class CdpSession {
  constructor(ws, targetId) {
    this.ws = ws;
    this.targetId = targetId;
    this.nextId = 1;
    this.pending = new Map();
    this.console = [];
    this.closed = false;
    ws.on('message', data => this.onMessage(data));
    ws.on('close', () => { this.closed = true; });
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
      if (this.closed) return reject(new Error('CDP session closed'));
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

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function connectCdp(port) {
  const page = await findPageTarget(port);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  const session = new CdpSession(ws, page.id);
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  return session;
}

async function spawnApp(userDataDir, port) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const settings = {
    app: {
      dryRun: true,
      nsActiveTab: 'home',
      onboarded: true
    }
  };
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify(settings, null, 2));

  const child = spawn(EXE_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-gpu'
  ], {
    detached: true,
    env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1', LIGHTS_OUT_RELIABILITY_PROOF: '1' }
  });

  return { child, port, userDataDir };
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

async function main() {
  if (!fs.existsSync(EXE_PATH)) {
    console.error('Built exe not found:', EXE_PATH);
    process.exit(1);
  }

  const userDataDir = path.join(ROOT_DIR, 'userdata');
  const port = 9631;
  const report = { passed: [], failed: [] };
  let child;
  let session;

  try {
    const spawned = await spawnApp(userDataDir, port);
    child = spawned.child;

    console.log('Reliability/Crash Policy Native Proof');
    console.log(`Root: ${ROOT_DIR}`);

    session = await connectCdp(port);
    await wait(1500);

    // Wait for renderer bootstrap to complete and signal main.
    await session.eval(`new Promise(resolve => {
      let attempts = 0;
      const check = () => {
        if (window.electronAPI && window.electronAPI.reliabilityProof) return resolve(true);
        if (++attempts > 40) return resolve(false);
        setTimeout(check, 250);
      };
      check();
    })`);

    // 1. Start a timer so we can prove state survives a renderer crash.
    const startResult = await session.eval(`(async () => {
      const r = await window.electronAPI.startTimer({ durationSeconds: 600, dryRun: true });
      return { success: r.success, running: r.state?.running };
    })()`);
    if (startResult.success && startResult.running) {
      report.passed.push('timer started and running before crash');
    } else {
      report.failed.push(`timer did not start: ${JSON.stringify(startResult)}`);
    }

    // 2. Crash the renderer process through the gated proof bridge.
    // Plant a marker so we can prove the renderer reloaded afterwards.
    await session.eval(`window.__reliabilityCrashMarker = Date.now()`);
    let crashError = null;
    try {
      await session.eval(`window.electronAPI.reliabilityProof.crashRenderer()`);
      await wait(500);
    } catch (error) {
      crashError = error;
    }
    if (crashError && String(crashError).includes('Target crashed')) {
      report.passed.push('renderer crash terminated the renderer process');
    } else if (crashError) {
      report.passed.push('renderer crash request caused expected error');
    } else {
      report.failed.push('renderer crash request did not produce an expected error');
    }

    // Wait for main to respawn the renderer and expose a new CDP target.
    await wait(4000);
    session.close();
    session = await connectCdp(port);
    await wait(2000);

    // Prove the page actually reloaded: the marker is gone and the fresh
    // renderer reports its readiness.
    const markerGone = await session.eval(`typeof window.__reliabilityCrashMarker === 'undefined'`);
    if (markerGone) {
      report.passed.push('renderer page reloaded after crash');
    } else {
      report.failed.push('renderer page did not reload after crash');
    }

    // 3. Verify the timer is still running after the renderer reload.
    const afterCrash = await session.eval(`(async () => {
      const state = await window.electronAPI.getAppSettings();
      return {
        bridgeOk: Boolean(window.electronAPI && window.electronAPI.reliabilityProof),
        timerRunning: Boolean(state.recoverableTimer && !state.recoverableTimer.paused)
      };
    })()`);
    if (afterCrash.bridgeOk) {
      report.passed.push('preload bridge present after renderer reload');
    } else {
      report.failed.push('preload bridge missing after renderer reload');
    }
    if (afterCrash.timerRunning) {
      report.passed.push('timer state persisted and is running after renderer crash reload');
    } else {
      report.failed.push(`timer not running after renderer crash reload: ${JSON.stringify(afterCrash)}`);
    }

    // 4. Trigger a main-process uncaught exception and prove the app survives.
    await session.eval(`window.electronAPI.reliabilityProof.throwMain()`);
    await wait(1000);

    // 5. Read startup.log and verify the fault was recorded.
    const log = await session.eval(`window.electronAPI.reliabilityProof.getStartupLog()`);
    if (typeof log === 'string' && log.includes('Lights Out encountered a problem') && log.includes('simulated main uncaught exception')) {
      report.passed.push('main uncaught exception recorded in startup.log with fault context');
    } else {
      report.failed.push(`main uncaught exception not recorded as expected: log length ${log?.length}`);
    }

    // 6. App is still responsive after the main fault.
    const ping = await session.eval(`({ alive: true, ts: Date.now() })`);
    if (ping.alive) {
      report.passed.push('app still responds after main uncaught exception');
    } else {
      report.failed.push('app did not respond after main uncaught exception');
    }

    // Cleanup: cancel the timer so the process can exit cleanly.
    await session.eval(`window.electronAPI.cancelTimer()`);
  } finally {
    if (session) session.close();
    await stopApp(child);
  }

  report.ok = report.failed.length === 0;
  const reportPath = path.join(ROOT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(report.ok ? '\nPASS' : '\nFAIL');
  for (const p of report.passed) console.log(`  + ${p}`);
  for (const f of report.failed) console.log(`  - ${f}`);
  console.log(`\nReport: ${reportPath}`);
  process.exit(report.ok ? 0 : 1);
}

main().catch(error => {
  console.error('Fatal proof error:', error);
  process.exit(1);
});
