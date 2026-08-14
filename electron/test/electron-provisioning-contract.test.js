'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateElectronProvisioningContract } = require('../scripts/electron-provisioning-contract');
const { runProcess, verifyProvisionedElectron } = require('../scripts/verify-electron-provisioning');

const root = path.join(__dirname, '..');
const repositoryPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const repositoryLockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

function fixture() {
  return {
    packageJson: structuredClone(repositoryPackage),
    lockfile: structuredClone(repositoryLockfile)
  };
}

function assertContractFails(mutator, pattern) {
  const value = fixture();
  mutator(value);
  assert.throws(() => validateElectronProvisioningContract(value), pattern);
}

function fakeSpawn({ output = '', code = 0, error, close = true, onKill } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => onKill?.();
    queueMicrotask(() => {
      if (error) child.emit('error', error);
      else if (close) {
        child.stdout.emit('data', output);
        child.emit('close', code);
      }
    });
    return child;
  };
}

function runtimeFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-electron-verify-'));
  const electronRoot = path.join(directory, 'node_modules', 'electron');
  fs.mkdirSync(path.join(electronRoot, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(repositoryPackage));
  fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify(repositoryLockfile));
  fs.writeFileSync(path.join(electronRoot, 'package.json'), JSON.stringify({ version: '43.1.0' }));
  fs.writeFileSync(path.join(electronRoot, 'path.txt'), 'electron.exe');
  fs.writeFileSync(path.join(electronRoot, 'dist', 'electron.exe'), 'fixture');
  return { directory, electronPackagePath: path.join(electronRoot, 'package.json') };
}

async function withRuntimeFixture(callback) {
  const value = runtimeFixture();
  try {
    await callback(value);
  } finally {
    fs.rmSync(value.directory, { recursive: true, force: true });
  }
}

test('real repository satisfies the explicit Electron 42+ installer contract', () => {
  validateElectronProvisioningContract(fixture());
});

test('provisioning contract rejects missing declaration, lock entry, and incompatible version', () => {
  assertContractFails(value => { delete value.packageJson.devDependencies.electron; }, /declared in devDependencies/);
  assertContractFails(value => { delete value.lockfile.packages['node_modules/electron']; }, /must resolve node_modules\/electron/);
  assertContractFails(value => { value.packageJson.devDependencies.electron = '^42.0.0'; }, /does not satisfy declared/);
});

test('provisioning contract rejects missing bin, scripts, resolved metadata, and integrity', () => {
  assertContractFails(value => { delete value.lockfile.packages['node_modules/electron'].bin; }, /install-electron/);
  assertContractFails(value => { delete value.packageJson.scripts['electron:provision']; }, /electron:provision/);
  assertContractFails(value => { value.packageJson.scripts['electron:provision'] = 'install-electron'; }, /official installer command/);
  assertContractFails(value => { delete value.packageJson.scripts['electron:verify']; }, /electron:verify must exist/);
  assertContractFails(value => { delete value.lockfile.packages['node_modules/electron'].resolved; }, /resolved tarball/);
  assertContractFails(value => { delete value.lockfile.packages['node_modules/electron'].integrity; }, /integrity/);
});

test('provisioning contract rejects automatic and direct installation commands but accepts absent lifecycle metadata', () => {
  assertContractFails(value => { value.packageJson.scripts.postinstall = 'install-electron --no'; }, /postinstall/);
  assertContractFails(value => { value.packageJson.scripts.check = 'node node_modules/electron/install.js'; }, /must not invoke electron\/install\.js directly/);
  validateElectronProvisioningContract(fixture());
});

test('verifier accepts normalized matching runtime output and rejects a mismatch', async () => {
  await withRuntimeFixture(async value => {
    const result = await verifyProvisionedElectron({ root: value.directory, electronPackagePath: value.electronPackagePath, spawnProcess: fakeSpawn({ output: ' \n\u0000v43.1.0\r\n ' }) });
    assert.equal(result.version, 'v43.1.0');
    await assert.rejects(() => verifyProvisionedElectron({ root: value.directory, electronPackagePath: value.electronPackagePath, spawnProcess: fakeSpawn({ output: 'v43.1.1' }) }), /does not match locked/);
  });
});

test('verifier rejects missing binary, path marker, and nonzero runtime exit', async () => {
  await withRuntimeFixture(async value => {
    fs.rmSync(path.join(path.dirname(value.electronPackagePath), 'dist', 'electron.exe'));
    await assert.rejects(() => verifyProvisionedElectron({ root: value.directory, electronPackagePath: value.electronPackagePath }), /binary is missing/);
  });
  await withRuntimeFixture(async value => {
    fs.rmSync(path.join(path.dirname(value.electronPackagePath), 'path.txt'));
    await assert.rejects(() => verifyProvisionedElectron({ root: value.directory, electronPackagePath: value.electronPackagePath }), /path marker is missing/);
  });
  await withRuntimeFixture(async value => {
    await assert.rejects(() => verifyProvisionedElectron({ root: value.directory, electronPackagePath: value.electronPackagePath, spawnProcess: fakeSpawn({ output: 'failure', code: 7 }) }), /exited 7/);
  });
});

test('verifier times out and cleans up its spawned process', async () => {
  let killed = false;
  await assert.rejects(() => runProcess('fixture', ['--version'], { spawnProcess: fakeSpawn({ close: false, onKill: () => { killed = true; } }), timeoutMs: 5 }), /timed out/);
  assert.equal(killed, true);
});
