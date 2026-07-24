'use strict';

const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..', '..');
const executable = path.join(root, 'dist', 'win-unpacked', 'Lights Out.exe');
const proofDir = path.join(root, 'dist', 'review-proof');
const androidPackage = 'com.lightsout.companion';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function waitFor(fn, timeoutMs = 30000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error('Timed out waiting for physical-phone proof state');
}

class CdpClient {
  constructor(url) {
    this.socket = new globalThis.WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = message.id && this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timeout); resolve(value); },
        reject: error => { clearTimeout(timeout); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed');
    return response.result.value;
  }

  close() { this.socket.close(); }
}

async function adb(args, options = {}) {
  try {
    return await execFileAsync('adb.exe', args, { timeout: options.timeout || 15000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    throw new Error(options.secret ? 'ADB command containing pairing material failed' : `ADB command failed: ${error.stderr || error.message}`);
  }
}

async function openAndroidSetup() {
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  await adb(['shell', 'wm', 'dismiss-keyguard']);
  await adb(['shell', 'am', 'force-stop', androidPackage]);
  await adb(['shell', 'monkey', '-p', androidPackage, '-c', 'android.intent.category.LAUNCHER', '1']);
  await new Promise(resolve => setTimeout(resolve, 1200));
  await adb(['shell', 'input', 'tap', '1015', '180']);
  await new Promise(resolve => setTimeout(resolve, 250));
  await adb(['shell', 'input', 'tap', '700', '185']);
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function enterPairingUrl(pairingUrl) {
  const encoded = Buffer.from(pairingUrl, 'utf8').toString('base64');
  await adb(['shell', 'input', 'tap', '540', '1700']);
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
  await adb(['shell', `for i in $(seq 1 180); do input keyevent KEYCODE_DEL; done`], { timeout: 30000 });
  await adb(['shell', `input text "$(echo ${encoded} | base64 -d)"`], { secret: true });
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  await new Promise(resolve => setTimeout(resolve, 300));
  await adb(['shell', 'input', 'tap', '540', '1900']);
}

async function selectPhoneWifi5G() {
  const remoteDump = '/sdcard/lightsout-wifi-gate.xml';
  const localDump = path.join(os.tmpdir(), 'lightsout-wifi-gate.xml');
  try {
    await adb(['shell', 'am', 'start', '-a', 'android.settings.WIFI_SETTINGS']);
    await new Promise(resolve => setTimeout(resolve, 1800));
    await adb(['shell', 'uiautomator', 'dump', remoteDump]);
    await adb(['pull', remoteDump, localDump]);
    const xml = fs.readFileSync(localDump, 'utf8');
    const match = xml.match(/<node[^>]*text="BMW ONLY! 5G"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!match) throw new Error('Saved 5 GHz Wi-Fi network was not visible in Android settings');
    const x = Math.round((Number(match[1]) + Number(match[3])) / 2);
    const y = Math.round((Number(match[2]) + Number(match[4])) / 2);
    await adb(['shell', 'input', 'tap', String(x), String(y)]);
    await waitFor(async () => /connected to "BMW ONLY! 5G"/.test((await adb(['shell', 'cmd', 'wifi', 'status'])).stdout), 20000, 1000);
  } finally {
    await adb(['shell', 'rm', '-f', remoteDump]).catch(() => {});
    if (fs.existsSync(localDump)) fs.rmSync(localDump, { force: true });
  }
}

async function connectPhoneCdp() {
  const pid = (await adb(['shell', 'pidof', androidPackage])).stdout.trim();
  assert.match(pid, /^\d+$/);
  const forwarded = await adb(['forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`]);
  const port = Number(forwarded.stdout.trim());
  assert.ok(Number.isInteger(port) && port > 0);
  const target = await waitFor(async () => {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
    return targets.find(item => item.type === 'page' && /^http:\/\//.test(item.url));
  });
  const client = new CdpClient(target.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`));
  await client.open();
  return { client, port };
}

async function capturePhone(name) {
  fs.mkdirSync(proofDir, { recursive: true });
  const result = await execFileAsync('adb.exe', ['exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
  fs.writeFileSync(path.join(proofDir, name), result.stdout);
}

async function main() {
  assert.ok(fs.existsSync(executable), `Packaged executable missing: ${executable}`);
  const devices = (await adb(['devices', '-l'])).stdout;
  assert.match(devices, /model:SM_S911W\b/);
  const wifiBefore = (await adb(['shell', 'cmd', 'wifi', 'status'])).stdout;
  assert.match(wifiBefore, /connected to "BMW ONLY! 5G"/);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-phone-gate-'));
  const debugPort = await freePort();
  const child = spawn(executable, [
    '--no-auto-start',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${debugPort}`
  ], {
    cwd: path.dirname(executable),
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1' }
  });

  let desktop;
  let phone;
  let phoneForward;
  let wifiDisabled = false;
  const commandCounts = { pause: 0, resume: 0, addFive: 0, cancel: 0 };
  try {
    const target = await waitFor(async () => {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      return targets.find(item => item.type === 'page' && /index\.html/.test(item.url));
    }, 20000);
    desktop = new CdpClient(target.webSocketDebuggerUrl);
    await desktop.open();
    await waitFor(() => desktop.evaluate(`typeof electronAPI === 'object'`));

    // The product default (58732) is not guaranteed bindable on every Windows
    // machine -- Hyper-V/WinNAT dynamically reserve ranges that can include
    // it. setRemoteControlMode does not reset a previously-set port, so
    // picking an OS-assigned ephemeral port here keeps this test immune to
    // that class of failure. Production's own default stays 58732.
    const initialRemote = await desktop.evaluate(`electronAPI.getRemoteControl()`);
    assert.equal(initialRemote.port, 58732, 'production default companion port must remain 58732');
    const testPort = await freePort();
    await desktop.evaluate(`electronAPI.setRemoteControlPort(${testPort})`);
    const ready = await desktop.evaluate(`electronAPI.setRemoteControlMode('wifi')`);
    assert.equal(ready.ready, true);
    assert.equal(ready.port, testPort);
    const fresh = await desktop.evaluate(`electronAPI.regenerateRemoteToken()`);
    assert.equal(fresh.ready, true);
    assert.match(fresh.url, new RegExp(`^http://192\\.168\\.0\\.\\d+:${testPort}/\\?t=`));
    const privateUrl = new URL(fresh.url);
    privateUrl.searchParams.delete('host');

    await openAndroidSetup();
    await enterPairingUrl(privateUrl.toString());
    const connected = await waitFor(async () => {
      const state = await desktop.evaluate(`electronAPI.getRemoteControl()`);
      return state.connected && state.clients === 1 ? state : null;
    }, 30000);
    assert.equal(connected.lanIp, '192.168.0.11');

    ({ client: phone, port: phoneForward } = await connectPhoneCdp());
    await waitFor(() => phone.evaluate(`document.getElementById('status-text')?.textContent === 'Connected'`));
    const paired = await phone.evaluate(`({
      status: document.getElementById('status-text').textContent,
      hasSocket: Boolean(ws && ws.readyState === WebSocket.OPEN)
    })`);
    assert.deepEqual(paired, { status: 'Connected', hasSocket: true });

    const started = await desktop.evaluate(`electronAPI.startTimer({ durationSeconds: 600, action: 'shutdown', dryRun: true, force: false, source: 'manual' })`);
    assert.equal(started.success, true);
    await waitFor(() => phone.evaluate(`document.getElementById('safety-badge').textContent === 'DRY RUN'`));
    const updateOne = await waitFor(() => phone.evaluate(`latestState?.running && !latestState?.paused ? latestState.remainingSeconds : 0`));
    await new Promise(resolve => setTimeout(resolve, 1300));
    const updateTwo = await waitFor(() => phone.evaluate(`latestState?.remainingSeconds < ${updateOne} ? latestState.remainingSeconds : 0`));
    assert.ok(updateTwo < updateOne);

    await phone.evaluate(`document.getElementById('btn-pause').click(); true`);
    commandCounts.pause++;
    await waitFor(() => phone.evaluate(`latestState?.paused === true`));
    await phone.evaluate(`document.getElementById('btn-pause').click(); true`);
    commandCounts.resume++;
    await waitFor(() => phone.evaluate(`latestState?.running === true && latestState?.paused === false`));

    const beforeAdd = await phone.evaluate(`latestState.remainingSeconds`);
    await phone.evaluate(`document.querySelector('[data-add-seconds="300"]').click(); true`);
    commandCounts.addFive++;
    const afterAdd = await waitFor(() => phone.evaluate(`latestState?.remainingSeconds >= ${beforeAdd + 295} ? latestState.remainingSeconds : 0`));
    assert.ok(afterAdd < beforeAdd + 305);
    await capturePhone('physical-phone-connected.png');

    await phone.evaluate(`document.getElementById('btn-cancel').click(); document.getElementById('cancel-stop').click(); true`);
    commandCounts.cancel++;
    await waitFor(() => phone.evaluate(`latestState && latestState.running === false && latestState.paused === false`));

    await adb(['shell', 'svc', 'wifi', 'disable']);
    wifiDisabled = true;
    await waitFor(async () => {
      const state = await desktop.evaluate(`electronAPI.getRemoteControl()`);
      return state.clients === 0;
    }, 20000);
    await adb(['shell', 'svc', 'wifi', 'enable']);
    wifiDisabled = false;
    await waitFor(async () => /Wifi is connected to/.test((await adb(['shell', 'cmd', 'wifi', 'status'])).stdout), 30000, 1000);
    await selectPhoneWifi5G();
    await adb(['shell', 'monkey', '-p', androidPackage, '-c', 'android.intent.category.LAUNCHER', '1']);
    await waitFor(async () => {
      const state = await desktop.evaluate(`electronAPI.getRemoteControl()`);
      return state.connected && state.clients === 1;
    }, 45000);

    phone.close();
    phone = null;
    await adb(['forward', '--remove', `tcp:${phoneForward}`]);
    phoneForward = null;
    await adb(['shell', 'am', 'force-stop', androidPackage]);
    await adb(['shell', 'monkey', '-p', androidPackage, '-c', 'android.intent.category.LAUNCHER', '1']);
    await waitFor(async () => {
      const state = await desktop.evaluate(`electronAPI.getRemoteControl()`);
      return state.connected && state.clients === 1;
    }, 30000);
    ({ client: phone, port: phoneForward } = await connectPhoneCdp());
    await waitFor(() => phone.evaluate(`document.getElementById('status-text')?.textContent === 'Connected'`));
    await capturePhone('physical-phone-reconnected.png');

    const finalState = await desktop.evaluate(`electronAPI.getRemoteControl()`);
    console.log(JSON.stringify({
      device: 'Samsung SM-S911W',
      packaged: true,
      desktop: { host: finalState.lanIp, port: finalState.port, token: '[REDACTED]' },
      phoneWifi: 'BMW ONLY! 5G',
      httpPairing: true,
      authenticatedWebSocket: true,
      countdownUpdates: 2,
      commandCounts,
      phoneWifiRecovery: true,
      wrapperRestartRecovery: true,
      qrScanMethod: 'manual URL entry driven over ADB; camera scan not claimed',
      realPowerActions: 0
    }, null, 2));
  } finally {
    if (wifiDisabled) await adb(['shell', 'svc', 'wifi', 'enable']).catch(() => {});
    await selectPhoneWifi5G().catch(() => {});
    if (phone) phone.close();
    if (phoneForward) await adb(['forward', '--remove', `tcp:${phoneForward}`]).catch(() => {});
    if (desktop) {
      try { await desktop.evaluate(`electronAPI.setRemoteControlMode('off')`); } catch {}
    }
    if (desktop) desktop.close();
    try { child.kill(); } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
    await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
