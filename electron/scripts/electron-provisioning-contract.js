'use strict';

const assert = require('node:assert/strict');

function parseVersion(version, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || '');
  assert.ok(match, `${label} must be an exact semver version: ${version}`);
  return match.slice(1).map(Number);
}

function declaredRangeAccepts(declared, locked) {
  const [lockedMajor, lockedMinor, lockedPatch] = parseVersion(locked, 'locked Electron version');
  const exact = /^(\d+)\.(\d+)\.(\d+)$/.exec(declared || '');
  if (exact) return declared === locked;
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(declared || '');
  if (caret) {
    const [major, minor, patch] = caret.slice(1).map(Number);
    if (lockedMajor !== major) return false;
    if (major > 0) return lockedMinor > minor || (lockedMinor === minor && lockedPatch >= patch);
    if (lockedMinor !== minor) return false;
    if (minor === 0) return lockedPatch === patch;
    return lockedPatch >= patch;
  }
  const tilde = /^~(\d+)\.(\d+)\.(\d+)$/.exec(declared || '');
  if (tilde) {
    const [major, minor, patch] = tilde.slice(1).map(Number);
    return lockedMajor === major && lockedMinor === minor && lockedPatch >= patch;
  }
  assert.fail(`Electron declaration must be an exact, caret, or tilde semver range: ${declared}`);
}

function validateElectronProvisioningContract({ packageJson, lockfile }) {
  const declared = packageJson.devDependencies?.electron;
  const locked = lockfile.packages?.['node_modules/electron'];
  const scripts = packageJson.scripts || {};

  assert.ok(declared, 'Electron must be declared in devDependencies');
  assert.ok(locked, 'package-lock.json must resolve node_modules/electron');
  assert.ok(declaredRangeAccepts(declared, locked.version), `locked Electron ${locked.version} does not satisfy declared ${declared}`);
  assert.ok(locked.resolved, 'locked Electron must include its resolved tarball');
  assert.ok(locked.integrity, 'locked Electron must include its integrity');
  assert.equal(locked.bin?.['install-electron'], 'install.js', 'locked Electron must expose the official install-electron command');
  assert.equal(scripts['electron:provision'], 'install-electron --no', 'electron:provision must use the official installer command');
  assert.ok(scripts['electron:verify'], 'electron:verify must exist');
  assert.ok(!scripts.postinstall || !/\b(?:electron|install-electron)\b|electron\/install\.js/i.test(scripts.postinstall), 'project postinstall must not provision Electron');
  for (const [name, command] of Object.entries(scripts)) {
    assert.ok(!/electron\/install\.js/i.test(command), `${name} must not invoke electron/install.js directly`);
  }
  assert.equal(Object.hasOwn(locked, 'hasInstallScript'), false, 'Electron 42+ provisioning must not fabricate hasInstallScript metadata');
}

module.exports = { declaredRangeAccepts, validateElectronProvisioningContract };
