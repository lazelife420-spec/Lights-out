'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const lockfilePath = path.join(__dirname, '..', 'package-lock.json');

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  assert.ok(match, `lockfile version is not a stable semver value: ${version}`);
  return match.slice(1).map(Number);
}

function compareSemver(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
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

function validateTarResolutions(lockfile) {
  const packages = lockfile.packages || {};
  const tarPaths = Object.keys(packages).filter(packagePath => /(^|\/)node_modules\/tar$/.test(packagePath));
  if (tarPaths.length === 0) {
    return;
  }
  const introducers = new Map(tarPaths.map(tarPath => [tarPath, []]));

  for (const [packagePath, packageInfo] of Object.entries(packages)) {
    if (!packageInfo.dependencies || !Object.hasOwn(packageInfo.dependencies, 'tar')) continue;
    const tarPath = resolvedTarPath(packages, packagePath);
    if (tarPath && introducers.has(tarPath)) introducers.get(tarPath).push(packagePath);
  }

  for (const tarPath of tarPaths) {
    const version = packages[tarPath].version;
    const parents = introducers.get(tarPath);
    assert.ok(parents.length > 0, `${tarPath}@${version} has no resolved introducing parent path`);
    assert.equal(isAffectedTarVersion(version), false, `${tarPath}@${version} is affected by GHSA-r292-9mhp-454m; introduced by ${parents.join(', ')}`);
  }
}

function validatePackageFloors(lockfile, floors) {
  const packages = lockfile.packages || {};
  for (const [pkgName, minVersion] of Object.entries(floors)) {
    const pattern = new RegExp(`(^|/)node_modules/${pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const matches = Object.keys(packages).filter(p => pattern.test(p));
    assert.ok(matches.length > 0, `expected ${pkgName} to be present in package-lock.json`);
    for (const pkgPath of matches) {
      const version = packages[pkgPath].version;
      assert.ok(
        compareSemver(version, minVersion) >= 0,
        `${pkgPath}@${version} is below minimum patched version ${minVersion}`
      );
    }
  }
}

function fixture(tarVersions, { includeParents = true } = {}) {
  const packages = {};
  for (const [tarPath, version] of Object.entries(tarVersions)) {
    packages[tarPath] = { version };
    if (includeParents) {
      const parentPath = tarPath === 'node_modules/tar'
        ? 'node_modules/introducer'
        : tarPath.replace(/\/node_modules\/tar$/, '/node_modules/introducer');
      packages[parentPath] = { dependencies: { tar: '^7.0.0' } };
    }
  }
  return { packages };
}

test('live lockfile has only patched tar resolutions with introducing paths', () => {
  validateTarResolutions(JSON.parse(fs.readFileSync(lockfilePath, 'utf8')));
});

test('live lockfile satisfies security version floors for active runtime and toolchain packages', () => {
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  validatePackageFloors(lockfile, {
    electron: '43.8.4',
    sharp: '0.35.5',
    eslint: '10.15.0',
    'brace-expansion': '5.0.5',
    minimatch: '11.0.1',
    undici: '7.24.0',
    qrcode: '1.5.4'
  });
});

test('synthetic vulnerable minimatch and undici lockfile entries fail floor validation', () => {
  assert.throws(() => validatePackageFloors({
    packages: { 'node_modules/minimatch': { version: '10.2.5' } }
  }, { minimatch: '11.0.1' }), /below minimum patched version/);
  assert.throws(() => validatePackageFloors({
    packages: { 'node_modules/undici': { version: '7.18.0' } }
  }, { undici: '7.24.0' }), /below minimum patched version/);
});

test('synthetic tar 7.5.19 and 7.5.20 resolutions fail with their parent paths', () => {
  for (const version of ['7.5.19', '7.5.20']) {
    assert.throws(() => validateTarResolutions(fixture({ 'node_modules/tar': version })), new RegExp(`tar@${version}.*introduced by node_modules/introducer`));
  }
});

test('synthetic tar 7.5.21 resolution passes', () => {
  validateTarResolutions(fixture({ 'node_modules/tar': '7.5.21' }));
});

test('multiple fixed tar copies pass and one vulnerable copy fails', () => {
  validateTarResolutions(fixture({
    'node_modules/tar': '7.5.22',
    'node_modules/a/node_modules/tar': '7.5.21'
  }));
  assert.throws(() => validateTarResolutions(fixture({
    'node_modules/tar': '7.5.22',
    'node_modules/a/node_modules/tar': '7.5.19'
  })), /node_modules\/a\/node_modules\/tar@7\.5\.19.*node_modules\/a\/node_modules\/introducer/);
});

test('tar resolutions without an introducing parent fail clearly', () => {
  assert.throws(() => validateTarResolutions(fixture({ 'node_modules/tar': '7.5.22' }, { includeParents: false })), /node_modules\/tar@7\.5\.22 has no resolved introducing parent path/);
});
