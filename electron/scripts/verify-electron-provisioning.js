'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { validateElectronProvisioningContract } = require('./electron-provisioning-contract');

const OUTPUT_LIMIT = 4096;
const TIMEOUT_MS = 15000;

function sanitizeOutput(value) {
  return String(value).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '').slice(0, OUTPUT_LIMIT).trim();
}

function runProcess(command, args, { spawnProcess = spawn, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const child = spawnProcess(command, args, { windowsHide: true });
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const append = chunk => {
      if (output.length < OUTPUT_LIMIT) output += String(chunk).slice(0, OUTPUT_LIMIT - output.length);
    };
    const timeout = setTimeout(() => {
      if (typeof child.kill === 'function') child.kill();
      finish(reject, new Error(`Electron version command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('error', error => finish(reject, error));
    child.once('close', code => {
      const sanitized = sanitizeOutput(output);
      if (code !== 0) return finish(reject, new Error(`Electron version command exited ${code}: ${sanitized}`));
      finish(resolve, sanitized);
    });
  });
}

async function verifyProvisionedElectron({ root = path.join(__dirname, '..'), fsModule = fs, spawnProcess = spawn, timeoutMs = TIMEOUT_MS, electronPackagePath } = {}) {
  const packageJson = JSON.parse(fsModule.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockfile = JSON.parse(fsModule.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  validateElectronProvisioningContract({ packageJson, lockfile });

  const resolvedPackagePath = electronPackagePath || require.resolve('electron/package.json');
  assert.ok(fsModule.existsSync(resolvedPackagePath), `Electron package metadata is missing: ${resolvedPackagePath}`);
  const electronPackage = JSON.parse(fsModule.readFileSync(resolvedPackagePath, 'utf8'));
  const lockedVersion = lockfile.packages['node_modules/electron'].version;
  assert.equal(electronPackage.version, lockedVersion, `installed Electron ${electronPackage.version} does not match locked ${lockedVersion}`);

  const electronRoot = path.dirname(resolvedPackagePath);
  const pathFile = path.join(electronRoot, 'path.txt');
  assert.ok(fsModule.existsSync(pathFile), `Electron path marker is missing: ${pathFile}. Run npm run electron:provision first.`);
  const executableName = fsModule.readFileSync(pathFile, 'utf8').trim();
  assert.ok(executableName, `Electron path marker is empty: ${pathFile}`);
  const executable = path.resolve(electronRoot, 'dist', executableName);
  assert.ok(fsModule.existsSync(executable), `Electron binary is missing: ${executable}. Run npm run electron:provision first.`);

  const version = await runProcess(executable, ['--version'], { spawnProcess, timeoutMs });
  assert.equal(version, `v${lockedVersion}`, `provisioned Electron version ${version} does not match locked v${lockedVersion}`);
  return { executable, version };
}

if (require.main === module) {
  verifyProvisionedElectron().then(({ executable, version }) => {
    console.log(`Electron ${version} provisioned at ${executable}`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runProcess, sanitizeOutput, verifyProvisionedElectron };
