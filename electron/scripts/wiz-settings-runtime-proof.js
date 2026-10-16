'use strict';

// Real packaged Electron + IPC + loopback UDP bulbs. Does not discover LAN
// devices, use production settings, or allow Windows power actions.
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { requirePackagedArtifact } = require('./packaged-artifact-resolver');

const artifact = requirePackagedArtifact();
const proofDir = path.join(artifact.proofDir, 'wiz-settings');
fs.mkdirSync(proofDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-wiz-proof-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const passed = [], sockets = [];
let child, ws;

async function until(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(message);
}

async function fakeBulb(ip) {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(38899, ip, resolve); });
  sockets.push(socket);
  const bulb = { pilot: { state: true, dimming: 70, temp: 4000 }, commands: [] };
  socket.on('message', (packet, remote) => {
    const command = JSON.parse(packet.toString()); bulb.commands.push(command);
    if (command.method === 'setPilot') Object.assign(bulb.pilot, command.params);
    const reply = { method: command.method, result: command.method === 'getPilot' ? { ...bulb.pilot } : { success: true } };
    socket.send(Buffer.from(JSON.stringify(reply)), remote.port, remote.address);
  });
  return bulb;
}

async function connect() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  child = spawn(artifact.executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--disable-gpu', '--no-auto-start'], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1', LIGHTS_OUT_QA_POWER_LOCK: '1' }
  });
  let page;
  await until(async () => {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page'); return Boolean(page); }
    catch { return false; }
  }, 'Packaged Electron did not expose its page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let id = 0; const pending = new Map();
  ws.on('message', data => {
    const message = JSON.parse(data);
    if (!pending.has(message.id)) return;
    const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  };
  await until(() => evaluate(`typeof api !== 'undefined' && typeof applyWizSettings === 'function' && document.getElementById('wiz-look-mode') !== null`), 'WiZ settings did not initialize');
  await wait(500);
  return { send, evaluate };
}

async function stop() {
  if (ws) { ws.close(); ws = null; }
  if (child && child.exitCode === null) {
    const pid = child.pid;
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolve); killer.once('exit', resolve);
    });
  }
  child = null;
}

async function main() {
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ app: { dryRun: true, onboarded: true, sound: 'Off' }, companion: { enabled: false }, family: { enabled: false } }));
  const bedside = await fakeBulb('127.0.0.1'), kitchen = await fakeBulb('127.0.0.2');
  let session = await connect(); const evaluate = expression => session.evaluate(expression);
  await evaluate(`(async () => {
    state.smartLights = await api.saveSmartLightConfig({ provider: 'wiz', enabled: false, mode: 'gradual_dim',
      wizAddresses: ['127.0.0.1','127.0.0.2'], wizDevices: [
        { ip: '127.0.0.1', name: 'Bedside', room: 'Bedroom' }, { ip: '127.0.0.2', name: 'Counter', room: 'Kitchen' }] });
    updateLightsUIFromState(); document.querySelector('[data-ns-tab="set"]').click(); switchSettingsCategory('lighting');
    document.querySelector('#wiz-room-options button').click();
  })()`);
  assert.deepEqual(await evaluate('collectWizSettings().wizAddresses'), ['127.0.0.1']);
  await evaluate(`(() => {
    document.getElementById('wiz-select-all').click();
    if (collectWizSettings().wizAddresses.length !== 2) throw new Error('Select all did not select both lights');
    document.getElementById('wiz-select-none').click();
    if (collectWizSettings().wizAddresses.length !== 0) throw new Error('Clearing selection selected lights again');
    document.querySelector('#wiz-room-options button').click();
    document.querySelectorAll('#wiz-device-list input[type=checkbox]')[1].click();
    if (collectWizSettings().wizAddresses.length !== 2) throw new Error('Individual light selection failed');
    document.querySelectorAll('#wiz-device-list input[type=checkbox]')[1].click();
  })()`);
  assert.deepEqual(await evaluate('collectWizSettings().wizAddresses'), ['127.0.0.1']);
  await evaluate(`(() => {
    renderWizDevices([...wizDeviceDraft, {ip:'127.0.0.3',name:'New discovery',room:''}]);
    document.getElementById('wiz-look-mode').value='color';
    document.getElementById('wiz-color').value='#ff8000';
    document.getElementById('wiz-brightness').value='30'; updateWizLookFields();
  })()`);
  assert.deepEqual(await evaluate('collectWizSettings().wizAddresses'), ['127.0.0.1']);
  assert.equal(await evaluate(`document.querySelectorAll('#wiz-device-list input[type=checkbox]:checked').length`), 1);
  passed.push('Room selection selects only its lights; adding discovered candidates preserves selection');
  await evaluate('saveSettingsPanel()');
  let saved = await evaluate('api.getSmartLightConfig()');
  assert.deepEqual(saved.wizAddresses, ['127.0.0.1']); assert.equal(saved.wizDevices.length, 3);
  assert.equal(saved.wizLook.color, '#ff8000'); assert.equal(saved.wizLook.brightness, 30);
  assert.equal(saved.enabled, false);
  passed.push('Settings Save persists selection, room names, custom color and brightness through real IPC');
  const writesBeforeVerify = bedside.commands.filter(command => command.method === 'setPilot').length;
  await evaluate(`document.getElementById('btn-test-lights').click()`);
  await until(async () => (await evaluate('api.getSmartLightConfig()')).verifiedConfigKey === 'wiz:127.0.0.1', 'Passive verification did not complete');
  assert.equal(bedside.commands.filter(command => command.method === 'setPilot').length, writesBeforeVerify);
  passed.push('Verify remains passive and belongs to the selected bulb');
  await evaluate(`document.getElementById('btn-test-action').click()`);
  await until(() => bedside.commands.some(command => command.method === 'setPilot'), 'Selected look was not sent');
  assert.deepEqual(bedside.commands.find(command => command.method === 'setPilot').params, { state: true, dimming: 30, r: 255, g: 128, b: 0 });
  assert.equal(kitchen.commands.length, 0);
  passed.push('Explicit test action sends the chosen color and brightness only to selected bulbs over UDP');
  await evaluate(`(async () => {
    const config = await api.getSmartLightConfig(); config.enabled=true;
    state.smartLights=await api.saveSmartLightConfig(config); updateLightsUIFromState();
  })()`);
  bedside.commands.length = 0;
  const started = await evaluate(`api.startTimer({durationSeconds:300,action:'sleep',dryRun:true,forceShutdown:false})`);
  assert.notEqual(started?.success, false);
  await until(() => bedside.commands.some(command => command.method === 'setPilot'), 'Actual timer did not dim the mock bulb');
  assert.ok(bedside.commands.filter(command => command.method === 'setPilot').every(command => command.params.state !== true));
  bedside.pilot.state = false; // Phone app off during the actual Electron timer.
  await wait(4000);
  const writesAfterOff = bedside.commands.filter(command => command.method === 'setPilot').length;
  await evaluate('api.cancelTimer()'); await wait(1800);
  assert.equal(bedside.pilot.state, false);
  assert.equal(bedside.commands.filter(command => command.method === 'setPilot').length, writesAfterOff);
  assert.equal(kitchen.commands.length, 0);
  passed.push('Actual timer yields to phone off; cancellation never turns it back on; unselected bulb is untouched');
  await evaluate(`document.getElementById('wiz-config').scrollIntoView({block:'start'})`);
  await wait(200);
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(proofDir, 'lighting.png'), Buffer.from(shot.data, 'base64'));
  assert.equal(await evaluate(`document.getElementById('wiz-device-list').scrollWidth <= document.getElementById('wiz-device-list').clientWidth`), true);
  await evaluate(`document.getElementById('wiz-look-mode').scrollIntoView({block:'start'})`);
  await wait(200);
  const lookShot = await session.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(proofDir, 'look.png'), Buffer.from(lookShot.data, 'base64'));
  for (const mode of ['white', 'scene', 'color']) {
    await evaluate(`document.getElementById('wiz-look-mode').value=${JSON.stringify(mode)}; document.getElementById('wiz-look-mode').dispatchEvent(new Event('input',{bubbles:true}))`);
    assert.equal(await evaluate(`document.getElementById('wiz-${mode}-field').hidden`), false);
  }
  for (const [width, height] of [[900, 640], [1120, 760], [1440, 900]]) {
    await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(200);
    assert.equal(await evaluate(`document.getElementById('wiz-device-list').scrollWidth <= document.getElementById('wiz-device-list').clientWidth`), true);
    await evaluate(`document.getElementById('wiz-config').scrollIntoView({block:'start'})`);
    const layout = await session.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(proofDir, `lighting-${width}.png`), Buffer.from(layout.data, 'base64'));
  }
  passed.push('Select all, clear, individual checkboxes and mode fields work; selection rows fit three viewport sizes including the minimum');
  await stop(); session = await connect();
  await until(async () => (await evaluate('api.getSmartLightConfig()')).wizLook.color === '#ff8000', 'Saved look did not survive restart');
  saved = await evaluate('api.getSmartLightConfig()');
  assert.deepEqual(saved.wizAddresses, ['127.0.0.1']); assert.equal(saved.wizDevices[0].room, 'Bedroom');
  assert.equal(await evaluate(`collectWizSettings().wizLook.color`), '#ff8000');
  passed.push('Selection, room names and look rehydrate after restarting the packaged app');
  fs.writeFileSync(path.join(proofDir, 'report.json'), JSON.stringify({ executable: artifact.executable, passed, screenshot: path.join(proofDir, 'lighting.png'), scope: 'Packaged Electron and simulated loopback UDP bulbs; physical WiZ/router not tested.' }, null, 2));
  for (const check of passed) console.log(`PASS ${check}`);
  console.log(`Report: ${path.join(proofDir, 'report.json')}`);
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await stop();
  await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve))));
});
