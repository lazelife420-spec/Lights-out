'use strict';

// Native Windows fault injection: closing an owned launcher job must not kill
// the portable's background timer. All runs use isolated data and a power lock.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const WebSocket = require('ws');
const { requirePackagedArtifact } = require('./packaged-artifact-resolver');

assert.equal(process.platform, 'win32', 'This proof requires native Windows');
const artifact = requirePackagedArtifact();
const output = process.env.LIGHTS_OUT_PORTABLE_PROOF_DIR
  ? path.resolve(process.env.LIGHTS_OUT_PORTABLE_PROOF_DIR)
  : path.join(os.tmpdir(), 'lights-out-portable-proof-' + Date.now());
assert(!fs.existsSync(output), 'Use a new proof output directory');
fs.mkdirSync(output, { recursive: true });
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const explorer = path.join(process.env.SystemRoot || 'C:/Windows', 'explorer.exe');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const startTemplate = fs.readFileSync(path.join(__dirname, 'portable-start.cmd'), 'utf8');
const runTemplate = fs.readFileSync(path.join(__dirname, 'portable-run.cmd'), 'utf8');
const report = {
  schema: 'lights-out.portable-launch-proof/v1', at: new Date().toISOString(),
  executable: artifact.executable, status: 'RUNNING',
  startTemplateSha256: sha(path.join(__dirname, 'portable-start.cmd')),
  runTemplateSha256: sha(path.join(__dirname, 'portable-run.cmd')),
  realPowerOrLightingAllowed: false, cases: []
};
const hosts = [];
const cases = [];
async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await delay(100); }
  throw Error(message);
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function prepare(variant) {
  const root = path.join(output, variant + ' launcher with spaces');
  fs.mkdirSync(root);
  const data = path.join(root, 'user-data'); fs.mkdirSync(data);
  save(path.join(data, 'settings.json'), {
    app: { dryRun: false, onboarded: true, sound: 'Off', graceMinutes: 0,
      forceShutdown: false, muteSystem: false, gracefulClose: false,
      bedtimeReminderEnabled: false, nightLightOnDim: false, pauseMediaOnDim: false,
      lockoutOnDim: false, autopilotEnabled: false, calendarAutoStart: false, focusBlocklist: [] },
    smartLights: { enabled: false }, wifiGuard: { enabled: false }, contentBlocker: { enabled: false },
    family: { enabled: false }, companion: { enabled: false }, remoteControl: { enabled: false, mode: 'off' },
    lastLight: { enabled: false }, accountability: { enabled: false }, calendar: { enabled: false, events: [] }
  });
  const port = await freePort();
  // Only the test backend differs: it locks power, selects isolated data and
  // adds a loopback debugging port. The fixed start template is unchanged.
  const backend = runTemplate
    .replace('%~dp0app\\Lights Out.exe', artifact.executable)
    .replace('%~dp0user-data', data)
    .replace('set "LIGHTS_OUT_QA_POWER_LOCK="', 'set "LIGHTS_OUT_QA_POWER_LOCK=1"')
    .replace('--no-auto-start', '--no-auto-start --remote-debugging-port=' + port);
  fs.writeFileSync(path.join(root, 'Launch Lights Out.cmd'), backend);
  fs.writeFileSync(path.join(root, 'Start Lights Out.cmd'), variant === 'fixed'
    ? startTemplate : '@echo off\r\ncall "%~dp0Launch Lights Out.cmd"\r\n');
  fs.writeFileSync(path.join(root, 'host-start.cmd'), [
    '@echo off', ':wait_for_assignment', 'if exist "%~dp0launch.allow" goto launch',
    'powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 100"',
    'goto wait_for_assignment', ':launch', 'call "%~dp0Start Lights Out.cmd"'
  ].join('\r\n'));
  const cfg = { RunRoot: root, DataRoot: data, Port: port, Variant: variant,
    DurationSeconds: 30, Unit: 'sec', Action: 'shutdown', Guarded: true };
  save(path.join(root, 'config.json'), cfg); cases.push(cfg); return cfg;
}
async function runCase(variant) {
  const cfg = await prepare(variant);
  const log = fs.openSync(path.join(cfg.RunRoot, 'host.log'), 'w');
  const host = spawn(powershell, ['-NoProfile', '-WindowStyle', 'Hidden', '-File',
    path.join(__dirname, 'test-support/portable-job-host.ps1'), '-RunRoot', cfg.RunRoot],
  { windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); hosts.push(host);
  await until(() => fs.existsSync(path.join(cfg.RunRoot, 'launch.allow')), 'Launcher job was not assigned');
  const control = execFileSync(process.execPath, [path.join(__dirname, 'test-support/portable-launch-control.js'), cfg.RunRoot],
    { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  fs.writeFileSync(path.join(cfg.RunRoot, 'control.log'), control);
  await until(() => fs.existsSync(path.join(cfg.RunRoot, 'job-result.json')), 'Launcher job did not finish');
  const result = read(path.join(cfg.RunRoot, 'job-result.json'));
  assert.equal(result.AppWasInControlledJob, variant === 'direct');
  assert.equal(result.AppAliveAfterJobClosed, variant === 'fixed');
  if (variant === 'direct') assert.equal(read(path.join(cfg.DataRoot, 'run-receipts.json')).receipts.at(-1).result, 'running');
  else {
    await until(() => read(path.join(cfg.DataRoot, 'run-receipts.json')).receipts.at(-1).result === 'blocked',
      'Independent timer did not reach the guarded ending', 50000);
    const receipt = read(path.join(cfg.DataRoot, 'run-receipts.json')).receipts.at(-1);
    assert.equal(receipt.notes, 'QA power lock - no power action executed');
    result.receipt = receipt;
  }
  report.cases.push({ variant, ...result }); return cfg;
}
async function quitOwned(cfg) {
  let ws;
  try {
    const page = (await (await fetch(`http://127.0.0.1:${cfg.Port}/json/list`)).json()).find(p => p.type === 'page');
    if (!page || !page.url.endsWith('/index.html')) return;
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'window.electronAPI.quitApp();true' } }));
    await Promise.race([new Promise(resolve => ws.once('close', resolve)), delay(1500)]);
  } catch { /* already exited */ } finally { if (ws) ws.close(); }
}
(async () => {
  const direct = await runCase('direct');
  const fixed = await runCase('fixed');
  // Reopening the killed app after its deadline reproduces the original
  // interrupted receipt, with no automatic restart or power action.
  const reopened = spawn(explorer, [path.join(direct.RunRoot, 'Launch Lights Out.cmd')],
    { windowsHide: true, detached: true, stdio: 'ignore' }); reopened.unref();
  await until(() => read(path.join(direct.DataRoot, 'run-receipts.json')).receipts.at(-1).result === 'interrupted',
    'Killed run was not reconciled as interrupted');
  report.interruptedReceipt = read(path.join(direct.DataRoot, 'run-receipts.json')).receipts.at(-1);
  await quitOwned(direct); await quitOwned(fixed);
  report.status = 'PASS'; report.finishedAt = new Date().toISOString();
  save(path.join(output, 'report.json'), report);
  console.log(JSON.stringify({ status: 'PASS', baselineFailureReproduced: true,
    fixedSurvivesLauncherTeardown: true, guardedEndingReached: true, output }));
})().catch(error => {
  report.status = 'FAIL'; report.error = error.stack;
  save(path.join(output, 'report.json'), report); console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  for (const cfg of cases) await quitOwned(cfg);
  for (const host of hosts) if (host.exitCode === null) host.kill();
});
