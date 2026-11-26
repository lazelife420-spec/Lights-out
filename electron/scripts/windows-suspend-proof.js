'use strict';
// Non-actuating cross-process qualification. Production helper is invoked ONLY
// with --probe. All request tests use a different, compile-time-fake executable.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict'), vm = require('node:vm');
const sourceRoot = path.resolve(__dirname, '..');
const appRoot = path.resolve(process.argv[2] || sourceRoot);
const evidence = path.resolve(process.argv[3] || path.join(sourceRoot, 'test-results', 'windows-suspend'));
fs.mkdirSync(evidence, { recursive: true });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const fake = path.join(evidence, 'WindowsSuspendFake.exe');
const nativeSource = path.join(appRoot, 'native', 'WindowsSuspend.cs');
execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', '/define:POWER_TEST',
  '/reference:System.Web.Extensions.dll', '/out:' + fake, nativeSource, path.join(sourceRoot, 'test-support', 'WindowsSuspendFake.cs')], { windowsHide: true });
const selfTest = JSON.parse(execFileSync(fake, ['--self-test'], { encoding: 'utf8', windowsHide: true }));
assert.equal(selfTest.realNativeCalls, 0); assert.equal(selfTest.compileTimeFake, true);
const production = path.join(appRoot, 'native', 'WindowsSuspend.exe');
const probe = JSON.parse(execFileSync(production, ['--probe'], { encoding: 'utf8', windowsHide: true }));
assert.equal(probe.type, 'capabilities'); assert.equal(probe.realPowerCalls, 0); assert.equal(probe.privilegeAdjusted, false);
const { createSuspendDispatcher } = require(path.join(appRoot, 'windowsSuspend'));
const { createDispatcher } = require(path.join(appRoot, 'powerActionDispatcher'));
const mainSource = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
const powerSource = mainSource.slice(mainSource.indexOf('async function executePowerAction('), mainSource.indexOf('\nfunction getLoginSettings()', mainSource.indexOf('async function executePowerAction(')));
const formatSource = mainSource.match(/function formatAction\(action\) \{[\s\S]*?\n\}/)[0];
const records = [], processCalls = [];
async function scenario(name, action, expected, { mode = name, cancel = false, qaLock = false, dryRun = false, observationMs = 1000 } = {}) {
  const events = [], updates = [];
  let currentChild;
  const dispatcher = createDispatcher({ spawn() { throw Error('Non-suspend power commands forbidden in qualification'); },
    suspend: createSuspendDispatcher({ helperPath: fake, observationMs, preparationMs: 3000,
      spawn(file, args, options) {
        assert.equal(file, fake); assert.equal(args[0], '--serve'); assert.ok(['sleep', 'hibernate'].includes(args[1]));
        const child = spawn(file, args, { ...options, env: { ...process.env, LO_POWER_TEST_CASE: mode } });
        currentChild = child; processCalls.push({ name, pid: child.pid, file, args, compileTimeFake: true });
        return child;
      } }) });
  const context = vm.createContext({ Boolean, Date, console, AbortController: globalThis.AbortController,
    DESKTOP_UX_PROOF: false, QA_POWER_LOCK: qaLock, activeReceiptId: 'receipt-' + name,
    completionGuardController: null, dispatchPowerAction: dispatcher,
    emitTimerUpdate(type, data) { updates.push({ type, data }); if (cancel && data.actionStatus === 'action_requested') context.completionGuardController.abort(); },
    writeStartupLog() {}, showNativeNotification() {}, runReceipts: {
      updateRunReceipt() {}, recordActionEvent(id, event) { events.push({ id, ...event }); return { persistence: { saved: true } }; }
    } });
  vm.runInContext(formatSource + '\n' + powerSource, context);
  context.options = { action, dryRun, forceShutdown: true };
  const result = await vm.runInContext('executePowerAction(options)', context);
  if (expected === 'test') assert.equal(result.dryRun, true);
  else if (expected === 'qa') assert.equal(result.blocked, true);
  else assert.equal(result.status, expected, name);
  if (currentChild && currentChild.exitCode === null) await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error('Fake helper did not close')), 4000);
    currentChild.once('close', () => { clearTimeout(deadline); resolve(); });
  });
  assert.ok(events.every(e => e.systemOutcome === 'unverified'));
  assert.ok(!events.some(e => e.state === 'power_executed'));
  records.push({ name, action, result: JSON.parse(JSON.stringify(result)), events, updates });
}
async function run() {
  await scenario('accepted-sleep', 'sleep', 'command_returned_success');
  await scenario('accepted-hibernate', 'hibernate', 'command_returned_success');
  await scenario('unsupported-sleep', 'sleep', 'blocked');
  await scenario('unsupported-hibernate', 'hibernate', 'blocked');
  await scenario('denied', 'sleep', 'blocked');
  await scenario('failed', 'hibernate', 'command_returned_failure');
  await scenario('probe-failed', 'sleep', 'blocked');
  await scenario('cancel-before-commit', 'sleep', 'cancelled', { cancel: true });
  await scenario('late-api-return', 'sleep', 'outcome_unverified', { mode: 'delayed', observationMs: 30 });
  await scenario('test-sleep', 'sleep', 'test', { dryRun: true });
  await scenario('test-hibernate', 'hibernate', 'test', { dryRun: true });
  await scenario('qa-locked', 'sleep', 'qa', { qaLock: true });
  for (const args of [[], ['--execute', 'sleep'], ['--serve', 'restart', '0'.repeat(32)]]) {
    const child = spawn(fake, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const code = await new Promise(resolve => child.once('close', resolve)); assert.equal(code, 2);
  }
  const report = { verdict: 'PASS', at: new Date().toISOString(), appRoot, sourceSha256: hash(nativeSource),
    productionHelperSha256: hash(production), fakeHelperSha256: hash(fake), selfTest, probe, records, processCalls,
    requestExecutor: 'POWER_TEST compile-time Fake only', realPowerActions: 0, liveLightActions: 0,
    scope: 'Real compiled helper protocol + production JS dispatch + extracted production main action body. Physical power outcomes untested.' };
  fs.writeFileSync(path.join(evidence, 'RESULTS.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: report.verdict, scenarios: records.length, nativeFakeChecks: selfTest.checks, realPowerActions: 0, liveLightActions: 0 }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
