'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const lockfilePath = path.join(__dirname, '..', 'package-lock.json');

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  assert.ok(match, `tar lockfile version is not a stable semver value: ${version}`);
  return match.slice(1).map(Number);
}

function isAffectedTarVersion(version) {
  const [major, minor, patch] = versionParts(version);
  return major < 7 || (major === 7 && (minor < 5 || (minor === 5 && patch <= 20)));
}

function resolvedTarPath(packages, parentPath) {
  let scope = parentPath;
  while (true) {
    const marker = scope.lastIndexOf('/node_modules/');
    const root = marker === -1 ? '' : scope.slice(0, marker);
    const candidate = root ? `${root}/node_modules/tar` : 'node_modules/tar';
    if (packages[candidate]) return candidate;
    if (!root) return null;
    scope = root;
  }
}

test('resolved tar dependencies are fixed and retain their introducing paths', () => {
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  const packages = lockfile.packages || {};
  const tarPaths = Object.keys(packages).filter(packagePath => /(^|\/)node_modules\/tar$/.test(packagePath));
  assert.ok(tarPaths.length > 0, 'package-lock.json contains no resolved tar package');

  const introducers = new Map(tarPaths.map(tarPath => [tarPath, []]));
  for (const [packagePath, packageInfo] of Object.entries(packages)) {
    if (!packageInfo.dependencies || !Object.hasOwn(packageInfo.dependencies, 'tar')) continue;
    const tarPath = resolvedTarPath(packages, packagePath);
    if (tarPath && introducers.has(tarPath)) introducers.get(tarPath).push(packagePath);
  }

  for (const tarPath of tarPaths) {
    const version = packages[tarPath].version;
    assert.equal(isAffectedTarVersion(version), false, `${tarPath}@${version} is affected by GHSA-r292-9mhp-454m`);
    assert.ok(introducers.get(tarPath).length > 0, `${tarPath}@${version} has no resolved introducing parent path`);
  }
});
