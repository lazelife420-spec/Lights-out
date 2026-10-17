'use strict';
// Explicitly destructive to QA debug data; never accepts a physical device or production package.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
const { WebSocket } = globalThis;
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i];
  assert.match(name, /^--[a-z-]+$/);
  args[name.slice(2)] = process.argv[i + 1]?.startsWith('--') || i + 1 === process.argv.length ? true : process.argv[++i];
}
for (const name of ['adb', 'serial', 'avd', 'apk', 'source-inventory', 'proof-root']) assert.equal(typeof args[name], 'string', '--' + name + ' is required');
assert.equal(args['allow-debug-reset'], true, 'Pass --allow-debug-reset for the owned QA debug package');
assert.match(args.serial, /^emulator-\d+$/);
assert.match(args.avd, /^LightsOut_QA_[A-Za-z0-9_-]+$/);
const pkg = 'com.lightsout.companion.debug';
const proofRoot = path.resolve(args['proof-root']);
fs.mkdirSync(proofRoot, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), package: pkg, serial: args.serial, avd: args.avd,
  surface: 'owned Android emulator, native offline home/service/alarms; no PC server or bulb commands', cases: [], commands: [], rendererErrors: [] };
report.mode = args['calendar-only'] ? 'calendar-only' : 'lifecycle';
fs.writeFileSync(path.join(proofRoot, 'android-lifecycle-report.json'), JSON.stringify(report, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let owned = false, port, ws, nextId = 0, oldZone, oldWifi, oldData;
let oldAutoTime, originalWall, originalHostTime, clockChanged = false;
const pending = new Map();
async function adb(command) {
  report.commands.push({ at: new Date().toISOString(), executable: 'adb', args: ['-s', args.serial, ...command] });
  return run(args.adb, ['-s', args.serial, ...command], { windowsHide: true, timeout: 20000, maxBuffer: 8e6,
    encoding: command[0] === 'exec-out' ? 'buffer' : 'utf8' });
}
async function wait(label, fn, timeout = 20000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(350);
  }
  throw Error(label + ' timed out' + (last ? ': ' + last.message : ''));
}
function passed(name, evidence = {}) { report.cases.push({ name, status: 'passed', at: new Date().toISOString(), evidence }); console.log('PASS ' + name); }
async function prefs(name) {
  assert.ok(['phone_timer', 'phone_home', 'phone_calendar'].includes(name));
  let xml;
  try { xml = (await adb(['shell', 'run-as', pkg, 'cat', 'shared_prefs/' + name + '.xml'])).stdout; }
  catch (error) { if (/No such file/.test(error.stderr || '')) return {}; throw error; }
  const decode = text => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const fields = Object.fromEntries([...xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)].map(match => [match[1], decode(match[2])]));
  for (const name of ['state', 'config', 'consumed', 'scheduled']) if (fields[name]) fields[name] = JSON.parse(fields[name]);
  return fields;
}
const state = async () => (await prefs('phone_timer')).state;
async function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP request timed out')); }, 10000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function disconnect() {
  if (ws) { ws.close(); ws = null; }
  if (port) { await adb(['forward', '--remove', 'tcp:' + port]).catch(() => {}); port = null; }
}
async function launch() {
  await disconnect();
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  await adb(['shell', 'wm', 'dismiss-keyguard']);
  await adb(['shell', 'am', 'start', '-n', pkg + '/com.lightsout.companion.HomeActivity']);
  const pid = await wait('debug process', async () => { const value = (await adb(['shell', 'pidof', pkg])).stdout.trim(); return /^\d+$/.test(value) && value; });
  port = Number((await adb(['forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid])).stdout.trim());
  const page = await wait('bundled page', async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())
    .find(page => page.url === 'https://appassets.androidplatform.net/assets/phone/index.html'));
  ws = new WebSocket(page.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, 'ws://127.0.0.1:' + port));
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') report.rendererErrors.push(message.params.exceptionDetails.text);
    const job = pending.get(message.id);
    if (job) { pending.delete(message.id); message.error ? job.reject(Error(message.error.message)) : job.resolve(message.result); }
  });
  await send('Runtime.enable');
  await wait('native bridge', () => evaluate('!!window.phoneUI && !!window.phoneNative'));
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(650); }
async function start(minutes) {
  await evaluate(`document.getElementById('minutes').value=${minutes};document.getElementById('minutes').dispatchEvent(new Event('change'));`);
  await click('#start');
  return wait('running native timer', async () => { const timer = await state(); return timer?.phase === 'running' && timer; });
}
async function message(body) { await evaluate(`window.phoneNative.postMessage(${JSON.stringify(JSON.stringify(body))})`); await sleep(650); }
async function watchSnapshots() {
  await evaluate(`(() => {const update=window.phoneUI.update;window.phoneUI.update=next=>{window.__qaSnapshot=next;update(next);};})()`);
  await wait('native snapshot observer', () => evaluate('!!window.__qaSnapshot'));
}
async function calendarProof() {
  assert.equal(args['allow-emulator-clock-change'], true, 'Calendar mode requires --allow-emulator-clock-change');
  oldAutoTime = (await adb(['shell', 'settings', 'get', 'global', 'auto_time'])).stdout.trim();
  originalWall = Number((await adb(['shell', 'date', '+%s'])).stdout.trim()) * 1000;
  originalHostTime = Date.now();
  const routineId = 'qa-calendar-routine';
  await message({ action: 'saveRoutine', routine: { id: routineId, name: 'Calendar QA', seconds: 120, targets: [], brightness: 0, offAtEnd: false } });
  async function saveRule(id) {
    const date = await evaluate(`(() => {const d=new Date();d.setMinutes(d.getMinutes()+5,0,0);return {date:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),time:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};})()`);
    await message({ action: 'saveRule', rule: { id, routineId, kind: 'once', enabled: true, ...date } });
    await wait('persisted phone rule', async () => (await prefs('phone_home')).config?.rules?.some(rule => rule.id === id));
  }
  const id = 'qa-calendar-once';
  await saveRule(id);
  assert.deepEqual((await prefs('phone_calendar')).scheduled, []);
  passed('precise-alarm denial preserves the rule without scheduling an alarm');
  await adb(['shell', 'pm', 'clear-permission-flags', pkg, 'android.permission.POST_NOTIFICATIONS', 'user-fixed', 'user-set']);
  await adb(['shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS']);
  await adb(['shell', 'appops', 'set', '--uid', pkg, 'SCHEDULE_EXACT_ALARM', 'allow']);
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']); await launch(); await watchSnapshots();
  await wait('saved rule rescheduled after grant/reopen', async () => (await prefs('phone_calendar')).scheduled?.includes(id));
  const next = async ruleId => {
    const entry = await wait('native occurrence snapshot', () => evaluate(`window.__qaSnapshot?.upcoming?.find(rule=>rule.id===${JSON.stringify(ruleId)})`));
    assert.equal(typeof entry.next, 'number');
    return entry.next; // Zero truthfully means this once-only local time is now past.
  };
  const wall = await next(id);
  const intents = (await adb(['shell', 'dumpsys', 'activity', 'intents'])).stdout;
  assert.ok(intents.includes('lightsout://phone-calendar/' + id));
  passed('permission grant and reopen restore the native calendar PendingIntent', { ruleId: id, wall });
  async function deliver(ruleId, occurrence) {
    const result = await adb(['shell', 'run-as', pkg, 'am', 'startservice', '--user', '0', '-n', pkg + '/com.lightsout.companion.PhoneTimerService',
      '-a', 'calendar', '--es', 'ruleId', ruleId, '--el', 'wall', String(occurrence)]);
    assert.doesNotMatch(result.stdout + result.stderr, /Error|Exception|Permission Denial/i); await sleep(700);
  }
  await deliver(id, wall);
  assert.ok(!(await prefs('phone_home')).consumed?.some(key => key.startsWith(id + ':')));
  assert.notEqual((await state())?.phase, 'running');
  passed('early calendar delivery does not start or consume an occurrence');
  const zone = oldZone === 'Europe/Berlin' ? 'Asia/Tokyo' : 'Europe/Berlin';
  await adb(['shell', 'cmd', 'alarm', 'set-timezone', zone]);
  const shifted = (await wait('timezone-adjusted calendar occurrence', async () => { const value = await next(id); return value !== wall && { value }; })).value;
  if (shifted === 0) assert.ok(!(await prefs('phone_calendar')).scheduled.includes(id));
  await adb(['shell', 'cmd', 'alarm', 'set-timezone', oldZone]);
  await wait('original-zone calendar occurrence', async () => (await next(id)) === wall);
  passed('timezone changes recompute the phone-owned calendar occurrence', { original: wall, shifted });
  await adb(['shell', 'settings', 'put', 'global', 'auto_time', '0']);
  async function setWall(value) {
    await adb(['shell', 'cmd', 'alarm', 'set-time', String(value)]); clockChanged = true;
    await wait('emulator clock set', async () => Math.abs(Number((await adb(['shell', 'date', '+%s'])).stdout.trim()) * 1000 - value) < 5000);
  }
  await setWall(wall + 1000);
  const active = await wait('real native calendar alarm start', async () => { const timer = await state(); return timer?.phase === 'running' && timer.label === 'Calendar QA' && timer; });
  await deliver(id, wall);
  assert.equal((await state()).runId, active.runId);
  assert.equal((await prefs('phone_home')).consumed.filter(key => key.startsWith(id + ':')).length, 1);
  passed('real calendar alarm and duplicate delivery produce one occurrence/run', { runId: active.runId });
  const lateId = 'qa-calendar-late';
  await saveRule(lateId); const lateWall = await next(lateId);
  await setWall(lateWall + 121000);
  await deliver(lateId, lateWall);
  assert.equal((await state()).runId, active.runId); assert.equal((await state()).phase, 'running');
  assert.equal((await state()).endElapsed, active.endElapsed);
  assert.ok(!(await prefs('phone_home')).consumed.some(key => key.startsWith(lateId + ':')));
  passed('late delivery skips without consuming or replacing a running monotonic timer', { ruleId: lateId, wall: lateWall });
  await click('#cancel'); assert.equal((await state()).phase, 'idle');
  assert.deepEqual(report.rendererErrors, []);
}
async function main() {
  assert.equal((await adb(['shell', 'getprop', 'ro.kernel.qemu'])).stdout.trim(), '1');
  assert.ok((await adb(['emu', 'avd', 'name'])).stdout.split('\n').some(line => line.trim() === args.avd));
  owned = true;
  report.api = (await adb(['shell', 'getprop', 'ro.build.version.sdk'])).stdout.trim();
  report.image = (await adb(['shell', 'getprop', 'ro.build.fingerprint'])).stdout.trim();
  oldZone = (await adb(['shell', 'getprop', 'persist.sys.timezone'])).stdout.trim();
  oldWifi = (await adb(['shell', 'settings', 'get', 'global', 'wifi_on'])).stdout.trim();
  oldData = (await adb(['shell', 'settings', 'get', 'global', 'mobile_data'])).stdout.trim();
  const inventory = JSON.parse(fs.readFileSync(args['source-inventory'], 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(inventory.package, pkg);
  assert.equal(inventory.status, 'passed');
  assert.equal(inventory.productionSigningUsed, false);
  report.apkSha256 = hash(args.apk);
  assert.equal(report.apkSha256, inventory.apkSha256);
  const sourceRoot = path.resolve(__dirname, '../../companion-android');
  for (const file of inventory.sourceFiles) {
    const source = path.resolve(sourceRoot, file.path);
    assert.ok(source.startsWith(sourceRoot + path.sep) && !/keystore|credential|\.dev\.vars/i.test(file.path));
    assert.ok(/^(build\.gradle|settings\.gradle|gradlew(?:\.bat)?|app\/(?:build\.gradle|proguard-rules\.pro|src\/(?:main|test)\/.+)|gradle\/wrapper\/gradle-wrapper\.(?:jar|properties))$/.test(file.path));
    // Git checkout line endings may differ; the existing build inventory uses exact bytes.
    assert.equal(hash(source), file.sha256, 'Android source input differs: ' + file.path);
  }
  report.sourceInputsMatched = inventory.sourceFiles.length;
  const aapt = path.resolve(path.dirname(args.adb), '../build-tools/34.0.0/aapt.exe');
  const badging = (await run(aapt, ['dump', 'badging', args.apk], { windowsHide: true, timeout: 20000 })).stdout;
  assert.match(badging.split(/\r?\n/)[0], /^package: name='com\.lightsout\.companion\.debug'/);
  try { await adb(['install', '-r', args.apk]); }
  catch (error) {
    if (!/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(error.stdout + error.stderr)) throw error;
    await adb(['uninstall', pkg]);
    await adb(['install', args.apk]);
  }
  await adb(['shell', 'pm', 'clear', pkg]);
  await adb(['shell', 'pm', 'revoke', pkg, 'android.permission.POST_NOTIFICATIONS']);
  await adb(['shell', 'pm', 'set-permission-flags', pkg, 'android.permission.POST_NOTIFICATIONS', 'user-set', 'user-fixed']);
  await adb(['shell', 'appops', 'set', '--uid', pkg, 'SCHEDULE_EXACT_ALARM', 'deny']);
  await adb(['shell', 'appops', 'set', pkg, 'SCHEDULE_EXACT_ALARM', 'default']);
  await adb(['shell', 'svc', 'wifi', 'disable']);
  await adb(['shell', 'svc', 'data', 'disable']);
  await launch();
  await wait('offline platform', () => evaluate('navigator.onLine === false'));
  if (args['calendar-only']) { await calendarProof(); report.status = 'passed'; return; }
  await wait('denied permission disclosure', () => evaluate(`!document.getElementById('exact').hidden && !document.getElementById('alerts').hidden`));
  await start(3);
  await click('#pause'); assert.equal((await state()).phase, 'paused');
  const paused = await state();
  await click('#add'); assert.equal((await state()).heldMs, paused.heldMs + 300000);
  await click('#pause'); assert.equal((await state()).phase, 'running');
  await click('#cancel'); assert.equal((await state()).phase, 'idle');
  passed('offline native controls with notifications/exact access denied', { permissionCopy: await evaluate(`document.getElementById('permission-copy').textContent`) });

  await adb(['shell', 'pm', 'clear-permission-flags', pkg, 'android.permission.POST_NOTIFICATIONS', 'user-fixed', 'user-set']);
  await adb(['shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS']);
  await adb(['shell', 'appops', 'set', '--uid', pkg, 'SCHEDULE_EXACT_ALARM', 'allow']);
  await launch();
  await wait('granted permission readiness', () => evaluate(`document.getElementById('permissions').hidden`));
  const first = await start(3);
  const notices = (await adb(['shell', 'dumpsys', 'notification', '--noredact'])).stdout;
  assert.match(notices, /NotificationRecord\([^\n]*pkg=com\.lightsout\.companion\.debug[^\n]*id=41/);
  passed('granted notifications and exact access register the ongoing native notification');
  const zone = oldZone === 'Europe/Berlin' ? 'Asia/Tokyo' : 'Europe/Berlin';
  await adb(['shell', 'cmd', 'alarm', 'set-timezone', zone]);
  await wait('emulator timezone', async () => (await adb(['shell', 'getprop', 'persist.sys.timezone'])).stdout.trim() === zone);
  assert.equal((await state()).endElapsed, first.endElapsed);
  assert.equal((await state()).runId, first.runId);
  passed('timezone change preserves the active monotonic countdown', { from: oldZone, to: zone, runId: first.runId });
  await click('#cancel');
  const second = await start(3);
  assert.notEqual(second.runId, first.runId);
  const stale = await adb(['shell', 'run-as', pkg, 'am', 'startservice', '--user', '0', '-n', pkg + '/com.lightsout.companion.PhoneTimerService', '-a', 'cancel', '--es', 'runId', first.runId]);
  assert.doesNotMatch(stale.stdout + stale.stderr, /Error|Exception|Permission Denial/i);
  assert.equal((await state()).runId, second.runId); assert.equal((await state()).phase, 'running');
  passed('a stale service command cannot cancel a newer timer');
  await disconnect();
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
  const priorPid = (await adb(['shell', 'pidof', pkg])).stdout.trim(); assert.match(priorPid, /^\d+$/);
  await adb(['shell', 'run-as', pkg, 'kill', '-9', priorPid]);
  const restartedPid = await wait('sticky foreground-service restart', async () => {
    const value = (await adb(['shell', 'pidof', pkg])).stdout.trim(); return /^\d+$/.test(value) && value !== priorPid && value;
  }, 60000);
  assert.equal((await state()).runId, second.runId); assert.equal((await state()).endElapsed, second.endElapsed);
  await launch();
  await wait('reattached running UI', () => evaluate(`document.getElementById('phase').textContent.includes('REMAINING')`));
  passed('owned app-process restart and UI reopen preserve one timer/deadline', { priorPid, restartedPid });
  await disconnect();
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_SLEEP']);
  await wait('screen-off native completion', async () => (await state())?.phase === 'finished', 200000);
  const power = (await adb(['shell', 'dumpsys', 'power'])).stdout;
  assert.match(power, /mWakefulness=(Asleep|Dozing)/);
  const completed = (await adb(['shell', 'dumpsys', 'notification', '--noredact'])).stdout;
  assert.match(completed, /NotificationRecord\([^\n]*pkg=com\.lightsout\.companion\.debug[^\n]*id=42/);
  assert.equal((await state()).runId, second.runId);
  passed('offline screen-off completion posts the native finish notification', { runId: second.runId, lightsConfigured: 0 });
  assert.deepEqual(report.rendererErrors, []);
  report.status = 'passed';
}
main().catch(error => { report.status = 'failed'; report.error = error.stack; console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await disconnect().catch(() => {});
  if (owned) {
    await adb(['shell', 'am', 'force-stop', pkg]).catch(() => {});
    if (clockChanged) await adb(['shell', 'cmd', 'alarm', 'set-time', String(originalWall + Date.now() - originalHostTime)]).catch(() => { report.status = 'failed'; process.exitCode = 1; });
    if (oldAutoTime !== undefined) await adb(['shell', 'settings', 'put', 'global', 'auto_time', oldAutoTime]).catch(() => { report.status = 'failed'; process.exitCode = 1; });
    if (oldZone) await adb(['shell', 'cmd', 'alarm', 'set-timezone', oldZone]).catch(() => {});
    if (oldWifi !== undefined) await adb(['shell', 'svc', 'wifi', oldWifi === '1' ? 'enable' : 'disable']).catch(() => {});
    if (oldData !== undefined) await adb(['shell', 'svc', 'data', oldData === '1' ? 'enable' : 'disable']).catch(() => {});
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(proofRoot, 'android-lifecycle-report.json'), JSON.stringify(report, null, 2) + '\n');
});
