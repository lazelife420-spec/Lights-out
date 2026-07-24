'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

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

const root = path.resolve(__dirname, '..', '..');
const executable = path.join(root, 'dist', 'win-unpacked', 'Lights Out.exe');
const artifactDir = process.env.LIGHTS_OUT_WALKTHROUGH_DIR
  ? path.resolve(process.env.LIGHTS_OUT_WALKTHROUGH_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-native-walkthrough-'));
const captures = [];
fs.mkdirSync(artifactDir, { recursive: true });

function progress(msg) {
  console.log(`[walkthrough] ${msg}`);
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

async function waitFor(fn, timeoutMs = 15000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error('Timed out waiting');
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
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
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
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime evaluation failed');
    }
    return response.result.value;
  }

  async screenshot(name) {
    const result = await this.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(artifactDir, name);
    const buffer = Buffer.from(result.data, 'base64');
    fs.writeFileSync(file, buffer);
    captures.push({
      name,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex')
    });
    progress(`Captured screenshot: ${name}`);
  }

  close() { this.socket.close(); }
}

async function main() {
  if (!fs.existsSync(executable)) {
    throw new Error(`Packaged executable missing: ${executable}`);
  }

  const debugPort = await freePort();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-walkthrough-'));

  // Set default settings
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { onboarded: true, action: 'sleep', durationSeconds: 900, dryRun: true },
    calendar: { builtin: { enabled: true, bedtime: '22:15', days: ['mon', 'tue'], action: 'sleep' } }
  }));

  progress('Launching Electron...');
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

  let cdp;
  try {
    progress('Connecting to CDP...');
    const target = await waitFor(async () => {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      return targets.find(item => item.type === 'page' && /index\.html/.test(item.url));
    }, 20000);

    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.command('Page.enable');

    // Wait for the app renderer to be ready
    await waitFor(() => cdp.evaluate(`typeof openSettingsPanel === 'function'`));

    // Resolutions to capture
    const resolutions = [
      { name: '1280', width: 1280, height: 720 },
      { name: '1920', width: 1920, height: 1080 },
      { name: 'ultrawide', width: 2560, height: 1080 }
    ];

    for (const res of resolutions) {
      progress(`Setting resolution to ${res.width}x${res.height}`);
      await cdp.evaluate(`window.resizeTo(${res.width}, ${res.height})`);
      await new Promise(r => setTimeout(r, 1000)); // wait for layout settling

      // 1. Capture tonight lobby (make sure settings is closed/hidden)
      await cdp.evaluate(`closeSettingsPanel()`);
      await new Promise(r => setTimeout(r, 200));
      await cdp.screenshot(`settings_${res.name}_tonight.png`);

      // 2. Open settings and select General
      await cdp.evaluate(`openSettingsPanel()`);
      await cdp.evaluate(`switchSettingsCategory('general')`);
      await new Promise(r => setTimeout(r, 200));
      await cdp.screenshot(`settings_${res.name}_general.png`);

      // 3. Switch to Power & Safety
      await cdp.evaluate(`switchSettingsCategory('power-safety')`);
      await new Promise(r => setTimeout(r, 200));
      await cdp.screenshot(`settings_${res.name}_power_safety.png`);

      // 4. Switch to Protection
      await cdp.evaluate(`switchSettingsCategory('protection')`);
      await new Promise(r => setTimeout(r, 200));
      await cdp.screenshot(`settings_${res.name}_protection.png`);

      // 5. Switch to Appearance & Sound
      await cdp.evaluate(`switchSettingsCategory('appearance')`);
      await new Promise(r => setTimeout(r, 200));
      await cdp.screenshot(`settings_${res.name}_appearance_sound.png`);
    }

    fs.writeFileSync(path.join(artifactDir, 'walkthrough-manifest.json'), JSON.stringify({
      status: 'passed',
      runtime: 'dist/win-unpacked/Lights Out.exe',
      dryRun: true,
      resolutions: ['1280x720', '1920x1080', '2560x1080'],
      screenshots: captures
    }, null, 2));
    progress(`Walkthrough completed successfully: ${artifactDir}`);
  } finally {
    if (cdp) cdp.close();
    child.kill();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch(err => {
  console.error('Walkthrough failed:', err);
  process.exit(1);
});
