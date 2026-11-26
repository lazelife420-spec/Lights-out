'use strict';
// Regression guards for the v11.3.0 production audit fixes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function liftFunction(source, name) {
  const head = source.match(new RegExp(`function ${name}\\s*\\(`));
  if (!head) throw new Error(`function ${name} not found`);
  let i = source.indexOf('{', head.index + head[0].length);
  let depth = 0;
  const start = head.index;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function loadSettings(t) {
  const dir = tempDir(t, 'lo-release-settings-');
  const file = path.join(root, 'settings.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  m.require = request => request === 'electron' ? { app: { getPath: () => dir }, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from('fixture:' + text),
    decryptString: bytes => bytes.toString().slice(8)
  } } : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  return m.exports;
}

test('startup.log rotates past its cap instead of growing without bound', t => {
  const dir = tempDir(t, 'lo-release-log-');
  const writeStartupLog = new Function('app', 'fs', 'path', 'STARTUP_LOG_MAX_BYTES',
    `${liftFunction(mainSource, 'writeStartupLog')}; return writeStartupLog;`)(
    { getPath: () => dir }, fs, path, 200);
  for (let i = 0; i < 40; i++) writeStartupLog('uncaughtException', { message: 'x'.repeat(20), i });
  const logPath = path.join(dir, 'startup.log');
  assert.ok(fs.statSync(logPath).size <= 200, 'current log stays within the cap');
  assert.ok(fs.existsSync(logPath + '.1'), 'older lines move to startup.log.1');
  assert.ok(fs.statSync(logPath + '.1').size <= 200, 'only one rotated generation is kept');
  assert.match(mainSource, /const STARTUP_LOG_MAX_BYTES = 1024 \* 1024;/);
});

test('companion upgrade sockets get an error listener before any refusal path', () => {
  const src = fs.readFileSync(path.join(root, 'companion.js'), 'utf8');
  const body = liftFunction(src, 'upgradeHandler');
  const errorAt = body.indexOf("socket.on('error'");
  assert.ok(errorAt > 0, 'upgradeHandler must attach an error listener');
  for (const refusal of ['socket.destroy(); return;', 'writeHttpResponse(socket']) {
    assert.ok(errorAt < body.indexOf(refusal), `error listener must precede ${refusal}`);
  }
});

test('phone-started Night Modes are limited to the remote action allowlist', () => {
  const block = mainSource.slice(mainSource.indexOf("case 'startNightMode':"), mainSource.indexOf("case 'getNightModes':"));
  const guard = block.indexOf('REMOTE_ACTIONS.includes(resolution.resolved.action)');
  assert.ok(mainSource.includes("const REMOTE_ACTIONS = rcMod ? rcMod.ALLOWED_ACTIONS : ['shutdown', 'sleep', 'restart'];"),
    'the harness fallback must equal remoteControl.ALLOWED_ACTIONS');
  assert.ok(guard > 0, 'remote night-mode start must check the resolved action');
  assert.ok(guard < block.indexOf('startTimer('), 'the check must run before startTimer');
  const rc = require('../remoteControl');
  assert.deepEqual([...rc.ALLOWED_ACTIONS].sort(), ['restart', 'shutdown', 'sleep']);
});

test('only the app page itself may load in the main and widget windows', () => {
  const isOwnAppPage = new Function('path', '__dirname', 'require',
    `${liftFunction(mainSource, 'isOwnAppPage')}; return isOwnAppPage;`)(path, root, require);
  const own = require('node:url').pathToFileURL(path.join(root, 'index.html')).href;
  assert.equal(isOwnAppPage(own, 'index.html'), true);
  assert.equal(isOwnAppPage(own + '#settings', 'index.html'), true, 'hash changes and reloads stay allowed');
  assert.equal(isOwnAppPage(own.toUpperCase().replace('FILE:', 'file:'), 'index.html'), true, 'Windows paths compare case-insensitively');
  const dropped = require('node:url').pathToFileURL(path.join(os.tmpdir(), 'evil.html')).href;
  assert.equal(isOwnAppPage(dropped, 'index.html'), false, 'a dropped file must not replace the app');
  assert.equal(isOwnAppPage(own, 'widget.html'), false);
  assert.equal(isOwnAppPage('https://example.com/index.html', 'index.html'), false);
  assert.equal(isOwnAppPage('not a url', 'index.html'), false);
  assert.match(mainSource, /guardAppPageNavigation\(mainWindow, 'index\.html'\)/);
  assert.match(mainSource, /guardAppPageNavigation\(widgetWindow, 'widget\.html'\)/);
  assert.doesNotMatch(mainSource, /if \(!url\.startsWith\('file:\/\/'\)\)/, 'the old any-file: guard is gone');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  assert.match(renderer, /document\.addEventListener\('drop', refuse\)/);
  assert.match(renderer, /document\.addEventListener\('dragover', refuse\)/);
});

test('preload enters proof mode only on the same flag main uses for its QA power lock', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.doesNotMatch(preload, /LIGHTS_OUT_DESKTOP_UX_GATE === 'true'/);
  assert.match(preload, /process\.env\.LIGHTS_OUT_DESKTOP_UX_GATE === '1'/);
});

test('data export leaves out every credential, the pairing token and any active timer', t => {
  const settings = loadSettings(t);
  const secret = 'synthetic-credential-value';
  settings.updateSection('wifiGuard', { provider: 'webhook', routerPass: secret, routerUser: secret, webhookUrl: 'https://hooks.example/' + secret, webhookHeaders: { Authorization: secret } });
  settings.updateSection('calendar', { ical: { url: 'https://cal.example/' + secret } });
  settings.updateSection('remoteControl', { mode: 'wifi', token: secret });
  settings.updateSection('accountability', { enabled: true, partners: [{ type: 'webhook', name: 'Sam', url: 'https://hooks.example/' + secret }] });
  settings.updateSection('smartLights', { hueUsername: secret, httpHeaders: { Authorization: secret } });
  settings.updateSection('app', { timerName: 'Kept' });
  settings.setActiveTimer({ endsAt: '2026-11-25T23:00:00.000Z', action: 'shutdown' });
  const { settings: exported, redactedCredentials } = settings.exportSnapshot();
  const text = JSON.stringify(exported);
  assert.equal(text.includes(secret), false, 'no credential text in the export');
  assert.equal(exported.activeTimer, undefined, 'an in-flight timer is not exported');
  assert.equal(exported.app.timerName, 'Kept', 'ordinary settings are exported');
  assert.equal(exported.accountability.partners[0].name, 'Sam', 'partner labels survive');
  assert.ok(redactedCredentials >= 9, `counted redacted credentials (${redactedCredentials})`);
  assert.equal(settings.getSection('remoteControl').token, secret, 'export does not touch live settings');
});

test('importing a redacted backup keeps this PC’s credentials and never imports a pairing token', t => {
  const settings = loadSettings(t);
  settings.updateSection('remoteControl', { mode: 'local', token: 'this-pc-token' });
  settings.updateSection('accountability', { enabled: true, partners: [{ type: 'webhook', name: 'Sam', url: 'https://hooks.example/live' }] });
  settings.updateSection('wifiGuard', { routerPass: 'this-pc-pass' });

  const rc = settings.importableSection('remoteControl', { mode: 'wifi', token: 'attacker-known-token' });
  assert.equal(rc.token, undefined, 'a backup can never set the pairing token');
  settings.updateSection('remoteControl', rc);
  assert.equal(settings.getSection('remoteControl').token, 'this-pc-token');

  const acc = settings.importableSection('accountability', { enabled: true, partners: [{ type: 'webhook', name: 'Sam' }] });
  assert.equal(acc.partners, undefined, 'a redacted partner list keeps this PC’s partners');
  settings.updateSection('accountability', acc);
  assert.equal(settings.getSection('accountability').partners[0].url, 'https://hooks.example/live');

  settings.updateSection('wifiGuard', settings.importableSection('wifiGuard', { provider: 'adapter' }));
  assert.equal(settings.getSection('wifiGuard').routerPass, 'this-pc-pass', 'omitted secrets keep current values');
  assert.deepEqual(settings.importableSection('app', { dryRun: true }), { dryRun: true });
});

test('import-all-data skips activeTimer and sanitizes merged credential sections', () => {
  const block = mainSource.slice(mainSource.indexOf("ipcMain.handle('import-all-data'"), mainSource.indexOf("ipcMain.handle('import-all-data'") + 2500);
  assert.match(block, /section === 'activeTimer'[^\n]*continue;/);
  assert.doesNotMatch(block, /setActiveTimer\(/, 'a backup never restores a timer');
  assert.match(block, /settingsStore\.importableSection\(section, raw\)/);
  assert.match(block, /sanitizeWifiGuard\(\{ \.\.\.settingsStore\.getSection\(section\), \.\.\.value \}\)/);
  assert.match(block, /sanitizeAccountability\(\{ \.\.\.settingsStore\.getSection\(section\), \.\.\.value \}\)/);
  const exportBlock = mainSource.slice(mainSource.indexOf("ipcMain.handle('export-all-data'"), mainSource.indexOf("ipcMain.handle('import-all-data'"));
  assert.match(exportBlock, /settingsStore\.exportSnapshot\(\)/);
  assert.doesNotMatch(exportBlock, /settingsStore\.getAll\(\)/);
});
