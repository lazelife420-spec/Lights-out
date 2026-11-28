'use strict';

// H3 (2026-11-27 audit): every ad-hoc PowerShell call is bounded, and the
// companion system-info poll neither stacks spawns nor runs with no phone.
// The real main.js functions run against a fake spawn: no PowerShell starts.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length;
  let parenDepth = 1;
  while (parenDepth > 0 && i < source.length) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') parenDepth--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

function constLine(name) {
  const match = mainSource.match(new RegExp(`const ${name} = [^\\n]*;`));
  if (!match) throw new Error(`const ${name} not found`);
  return match[0];
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = 0;
  child.kill = () => { child.killed++; };
  return child;
}

function sandbox(extra = {}) {
  const spawned = [];
  const context = vm.createContext({
    setTimeout, clearTimeout, Promise, Error, Object, Math, Date,
    spawn: (file, args, options) => { const child = fakeChild(); spawned.push({ file, args, options, child }); return child; },
    ...extra
  });
  vm.runInContext([
    constLine('POWERSHELL_TIMEOUT_MS'),
    constLine('POWERSHELL_MAX_OUTPUT'),
    extractFunction(mainSource, 'executePowerShell'),
    'this.executePowerShell = executePowerShell;'
  ].join('\n'), context);
  return { context, spawned };
}

test('executePowerShell hides the window and resolves trimmed stdout', async () => {
  const { context, spawned } = sandbox();
  const p = context.executePowerShell('Get-Thing');
  const { file, args, options, child } = spawned[0];
  assert.equal(file, 'powershell.exe');
  assert.deepEqual([...args.slice(-2)], ['-Command', 'Get-Thing']);
  assert.equal(options.windowsHide, true, 'no console window flashes from a GUI app');
  child.stdout.emit('data', Buffer.from('  42 \r\n'));
  child.emit('close', 0);
  assert.equal(await p, '42');
});

test('executePowerShell keeps PowerShell\'s own error text', async () => {
  const { context, spawned } = sandbox();
  const p = context.executePowerShell('Bad-Thing');
  spawned[0].child.stderr.emit('data', Buffer.from('Access is denied.\r\n'));
  spawned[0].child.emit('close', 1);
  await assert.rejects(p, /Access is denied\./);
});

test('a hung PowerShell is killed at its deadline instead of hanging the caller', async () => {
  const { context, spawned } = sandbox();
  const p = context.executePowerShell('Hang', { timeoutMs: 30 });
  await assert.rejects(p, err => err.code === 'POWERSHELL_TIMEOUT');
  assert.equal(spawned[0].child.killed, 1, 'the child is killed');
  spawned[0].child.emit('close', null); // a late close changes nothing
});

test('runaway output is capped and the child killed', async () => {
  const { context, spawned } = sandbox();
  const p = context.executePowerShell('Spew');
  spawned[0].child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 10, 'x'));
  await assert.rejects(p, err => err.code === 'POWERSHELL_OUTPUT_LIMIT');
  assert.equal(spawned[0].child.killed, 1);
});

test('the default deadline is bounded', () => {
  assert.match(mainSource, /const POWERSHELL_TIMEOUT_MS = 20000;/);
  assert.match(extractFunction(mainSource, 'executePowerShell'), /\{ timeoutMs = POWERSHELL_TIMEOUT_MS \} = \{\}/);
});

function systemInfoSandbox({ clients }) {
  const calls = [];
  const pending = [];
  const context = vm.createContext({
    Promise, Date,
    systemInfoCache: null, systemInfoCachedAt: 0, systemInfoRefresh: null,
    companion: { getStatus: () => ({ clients }) },
    executePowerShell: command => new Promise((resolve, reject) => { calls.push(command); pending.push({ resolve, reject }); })
  });
  vm.runInContext([
    constLine('SYSTEM_INFO_TTL_MS'),
    extractFunction(mainSource, 'refreshSystemInfo'),
    extractFunction(mainSource, 'updateSystemInfoCacheAsync'),
    'this.refreshSystemInfo = refreshSystemInfo; this.updateSystemInfoCacheAsync = updateSystemInfoCacheAsync;'
  ].join('\n'), context);
  return { context, calls, pending };
}

test('with no phone connected, the 2 s companion broadcast spawns nothing', () => {
  const { context, calls } = systemInfoSandbox({ clients: 0 });
  for (let i = 0; i < 20; i++) context.updateSystemInfoCacheAsync();
  assert.equal(calls.length, 0);
});

test('concurrent refreshes share one query; a slow WMI never stacks spawns', async () => {
  const { context, calls, pending } = systemInfoSandbox({ clients: 1 });
  for (let i = 0; i < 10; i++) context.updateSystemInfoCacheAsync();
  const fromRenderer = context.refreshSystemInfo();
  assert.equal(calls.length, 1, 'one battery query in flight, however many ticks');
  pending[0].resolve('80');
  await new Promise(r => setImmediate(r));
  assert.equal(calls.length, 2, 'then one power-plan query');
  pending[1].resolve('Balanced');
  assert.deepEqual({ ...(await fromRenderer) }, { battery: '80', powerPlan: 'Balanced' });
  context.updateSystemInfoCacheAsync();
  assert.equal(calls.length, 2, 'a fresh cache spawns nothing');
});

test('a failed refresh is cached for the TTL, so a broken WMI is not retried every tick', async () => {
  const { context, calls, pending } = systemInfoSandbox({ clients: 1 });
  const first = context.refreshSystemInfo();
  pending[0].reject(new Error('WMI broken'));
  assert.deepEqual({ ...(await first) }, { battery: 'N/A', powerPlan: 'Unknown' });
  for (let i = 0; i < 10; i++) context.updateSystemInfoCacheAsync();
  assert.equal(calls.length, 1);
});
