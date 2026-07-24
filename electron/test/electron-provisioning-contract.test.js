'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

function major(version) {
  const match = /^(?:\^|~)?(\d+)\./.exec(version);
  assert.ok(match, `Electron version is not a supported semver range: ${version}`);
  return Number(match[1]);
}

test('Electron provisioning uses the explicit Electron 42+ installer contract', () => {
  const declared = packageJson.devDependencies?.electron;
  const locked = lockfile.packages?.['node_modules/electron'];

  assert.ok(declared, 'Electron must be declared in devDependencies');
  assert.ok(locked, 'package-lock.json must resolve node_modules/electron');
  assert.equal(major(locked.version), major(declared), `locked Electron ${locked.version} does not satisfy declared ${declared}`);
  assert.ok(locked.resolved, 'locked Electron must include its resolved tarball');
  assert.ok(locked.integrity, 'locked Electron must include its integrity');
  assert.equal(locked.bin?.['install-electron'], 'install.js', 'locked Electron must expose the official install-electron command');
  assert.equal(packageJson.scripts?.['electron:provision'], 'install-electron --no', 'electron:provision must use the official installer command');
  assert.ok(!packageJson.scripts?.postinstall || !/electron|install-electron/i.test(packageJson.scripts.postinstall), 'project postinstall must not provision Electron');
  assert.equal(Object.hasOwn(locked, 'hasInstallScript'), false, 'Electron 42+ provisioning must not fabricate hasInstallScript metadata');
});
