'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { appSourceFiles } = require('./app-source-files');
const defaultApp = path.resolve(__dirname, '..');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// GIT_OPTIONAL_LOCKS=0 keeps these read-only queries from refreshing (writing) the index.
const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
// The application lives in <repository>/electron; app-source-files.js makes the same assumption.
const repoOf = appDir => path.resolve(appDir, '..');

// Returns a filter that keeps the given application-relative files a clean checkout of HEAD
// would not reproduce: files missing from the HEAD tree (untracked, ignored or only staged)
// and files with staged or unstaged edits. git status applies the checkout's line-ending
// filters, so a CRLF (core.autocrlf) checkout of an unchanged LF blob is not reported.
// Only the files passed in are judged, never unrelated untracked repository files.
function uncommittedFilter(appDir) {
  const repo = repoOf(appDir);
  const base = path.relative(repo, appDir).replaceAll('\\', '/');
  const repoPath = name => base + '/' + name;
  const atHead = new Set(gitIn(repo, 'ls-tree', '-r', '-z', '--full-tree', '--name-only', 'HEAD', '--', base).split('\0').filter(Boolean));
  const changed = new Set();
  const status = gitIn(repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', base).split('\0');
  for (let index = 0; index < status.length; index++) {
    const entry = status[index];
    if (entry.length < 4) continue;
    changed.add(entry.slice(3));
    // In -z output a rename or copy is followed by its source path as its own field.
    if ('RC'.includes(entry[0]) || 'RC'.includes(entry[1])) changed.add(status[++index]);
  }
  return names => names.filter(name => !atHead.has(repoPath(name)) || changed.has(repoPath(name))).sort();
}

// The build scripts that shape the distribution without being packaged: the packager and every
// script it runs as Join-Path $PSScriptRoot '<name>' (the WindowsSuspend.exe compiler, the
// identity stamp, the NSIS script and provisioning, and so on), plus every local module those
// JavaScript scripts load, followed recursively (verify-electron-provisioning.js, for example,
// takes the rules that decide which Electron runtime is accepted from
// ./electron-provisioning-contract.js). A referenced script that does not exist would fail the
// build, so only existing files are listed.
const PACKAGER = 'scripts/package-native-windows.ps1';
// require('./x') / require('../x') and import('./x') with a literal relative specifier. Matching
// commented-out calls too only ever adds files to judge, never hides one.
const LOCAL_MODULE = /\b(?:require|import)\s*\(\s*(['"])(\.{1,2}\/[^'"\r\n]*)\1\s*\)/g;
const SCANNED_MODULE = /\.c?js$/i;

// Resolves a relative specifier the way Node resolves it for require() (exact file, then .js,
// .json, then a directory's index), to an application-relative path. Files outside the
// application directory are not followed.
function resolveLocalModule(appDir, fromFile, specifier) {
  const target = path.resolve(path.dirname(fromFile), ...specifier.split('/'));
  for (const candidate of [target, target + '.js', target + '.json', path.join(target, 'index.js'), path.join(target, 'index.json')]) {
    const relative = path.relative(appDir, candidate);
    if (!relative || relative.split(path.sep)[0] === '..' || path.isAbsolute(relative)) return null;
    let stat;
    try { stat = fs.lstatSync(candidate); } catch { continue; }
    if (stat.isFile()) return relative.replaceAll('\\', '/');
  }
  return null;
}

function buildInputFiles(appDir = defaultApp) {
  const packager = path.join(appDir, ...PACKAGER.split('/'));
  if (!fs.existsSync(packager)) return [];
  const result = new Set([PACKAGER]);
  for (const match of fs.readFileSync(packager, 'utf8').matchAll(/Join-Path \$PSScriptRoot '([^'\\/]+)'/g)) {
    const file = path.join(appDir, 'scripts', match[1]);
    if (match[1] !== '..' && fs.existsSync(file) && fs.lstatSync(file).isFile()) result.add('scripts/' + match[1]);
  }
  const pending = [...result];
  while (pending.length) {
    const name = pending.pop();
    if (!SCANNED_MODULE.test(name)) continue;
    const file = path.join(appDir, ...name.split('/'));
    for (const match of fs.readFileSync(file, 'utf8').matchAll(LOCAL_MODULE)) {
      const required = resolveLocalModule(appDir, file, match[2]);
      if (required && !result.has(required)) {
        result.add(required);
        pending.push(required);
      }
    }
  }
  return [...result].sort();
}

// Packaged application files that a clean checkout of HEAD would not reproduce.
function uncommittedAppSourceFiles(appDir = defaultApp) {
  return uncommittedFilter(appDir)(appSourceFiles(appDir));
}

// Build scripts that a clean checkout of HEAD would not reproduce.
function uncommittedBuildInputFiles(appDir = defaultApp) {
  return uncommittedFilter(appDir)(buildInputFiles(appDir));
}

function fileInventory(directory) {
  const result = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Distribution cannot contain symbolic links');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result.push({ path: path.relative(directory, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: sha256(file) });
    }
  }
  visit(directory);
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function create(output, { appDir = defaultApp } = {}) {
  const app = appDir;
  const repo = repoOf(app);
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  const files = ['Lights-Out-Setup-v' + pkg.version + '.exe', 'Lights-Out-Portable-v' + pkg.version + '-win-x64.zip']
    .filter(name => fs.existsSync(path.join(output, name)));
  if (!files.length) throw new Error('No distribution artifacts found');
  const artifacts = files.map(name => ({ name, bytes: fs.statSync(path.join(output, name)).size, sha256: sha256(path.join(output, name)) }));
  const uncommitted = uncommittedFilter(app);
  const uncommittedApp = uncommitted(appSourceFiles(app));
  const uncommittedBuild = uncommitted(buildInputFiles(app));
  const manifest = { schema: 'lights-out.windows-release/v1', version: pkg.version, sourceCommit: gitIn(repo, 'rev-parse', 'HEAD').trim(),
    // true whenever this build is not a clean build of sourceCommit: a tracked change anywhere in
    // the repository, or a packaged application file or build script that HEAD does not contain as built.
    trackedSourceDirty: Boolean(gitIn(repo, 'status', '--porcelain=v1', '--untracked-files=no').trim()) || uncommittedApp.length > 0 || uncommittedBuild.length > 0,
    uncommittedAppSourceFiles: uncommittedApp,
    uncommittedBuildInputFiles: uncommittedBuild,
    electronVersion: JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8')).packages['node_modules/electron'].version,
    packageLockSha256: sha256(path.join(app, 'package-lock.json')), artifacts, runtime: fileInventory(path.join(output, 'win-unpacked')) };
  fs.writeFileSync(path.join(output, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), artifacts.map(a => a.sha256 + '  ' + a.name).join('\n') + '\n');
  console.log(JSON.stringify({ version: pkg.version, artifacts, runtimeFiles: manifest.runtime.length }));
}

function verify(output, strict = false, assetsOnly = false, { appDir = defaultApp } = {}) {
  const app = appDir;
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'BUILD-MANIFEST.json'), 'utf8'));
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('Manifest contains no artifacts');
  }
  if (strict) {
    if (manifest.schema !== 'lights-out.windows-release/v1') throw new Error('Unsupported release manifest schema: ' + manifest.schema);
    const refuseUncommitted = (kind, names) => {
      if (names.length) throw new Error(`Release provenance must name this clean source commit; ${kind} not committed at it: ${names.join(', ')}`);
    };
    if (!Array.isArray(manifest.uncommittedAppSourceFiles)) throw new Error('Release provenance must record packaged source files not committed at sourceCommit');
    if (!Array.isArray(manifest.uncommittedBuildInputFiles)) throw new Error('Release provenance must record build scripts not committed at sourceCommit');
    refuseUncommitted('packaged files', manifest.uncommittedAppSourceFiles);
    refuseUncommitted('build scripts', manifest.uncommittedBuildInputFiles);
    if (manifest.trackedSourceDirty || manifest.sourceCommit !== gitIn(repoOf(app), 'rev-parse', 'HEAD').trim()) throw new Error('Release provenance must name this clean source commit');
    // The packaged application is compared with this working tree below, so this working tree's
    // packaged inputs and build scripts must equal HEAD too. That check does not rely on the recorded fields.
    if (!assetsOnly) {
      const uncommitted = uncommittedFilter(app);
      refuseUncommitted('packaged files', uncommitted(appSourceFiles(app)));
      refuseUncommitted('build scripts', uncommitted(buildInputFiles(app)));
    }
    if (manifest.version !== pkg.version) throw new Error(`Manifest version mismatch: expected ${pkg.version}, got ${manifest.version}`);
    const lockSha = sha256(path.join(app, 'package-lock.json'));
    if (manifest.packageLockSha256 !== lockSha) throw new Error('Manifest package-lock.json SHA-256 mismatch');
  }

  const sums = fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8');
  const sumLines = sums.split(/\r?\n/).filter(line => line.trim().length > 0);
  const expectedSumLines = new Set();

  for (const artifact of manifest.artifacts) {
    if (typeof artifact.name !== 'string' || path.basename(artifact.name) !== artifact.name) {
      throw new Error('Artifact hash mismatch: ' + artifact.name);
    }
    const artifactPath = path.join(output, artifact.name);
    if (!fs.existsSync(artifactPath) || sha256(artifactPath) !== artifact.sha256) {
      throw new Error('Artifact hash mismatch: ' + artifact.name);
    }
    if (typeof artifact.bytes === 'number' && fs.statSync(artifactPath).size !== artifact.bytes) {
      throw new Error('Artifact size mismatch: ' + artifact.name);
    }
    const line = artifact.sha256 + '  ' + artifact.name;
    if (!sumLines.includes(line)) throw new Error('Checksum entry missing: ' + artifact.name);
    expectedSumLines.add(line);
  }

  if (sumLines.length !== expectedSumLines.size || !sumLines.every(line => expectedSumLines.has(line))) {
    throw new Error('Unexpected or duplicate checksum entry in SHA256SUMS.txt');
  }

  if (manifest.version && manifest.version !== pkg.version) {
    throw new Error(`Manifest version mismatch: expected ${pkg.version}, got ${manifest.version}`);
  }

  if (strict) {
    const expectedNames = ['Lights-Out-Setup-v' + pkg.version + '.exe', 'Lights-Out-Portable-v' + pkg.version + '-win-x64.zip'];
    if (manifest.artifacts.length !== 2) throw new Error('Installer and portable ZIP are both required');
    const actualNames = new Set(manifest.artifacts.map(a => a.name));
    for (const expectedName of expectedNames) {
      if (!actualNames.has(expectedName)) throw new Error('Expected release artifact missing: ' + expectedName);
    }
  }

  const verificationPath = path.join(output, 'WINDOWS-VERIFICATION.json');
  if (fs.existsSync(verificationPath)) {
    const verification = JSON.parse(fs.readFileSync(verificationPath, 'utf8').replace(/^\uFEFF/, ''));
    if (verification.status !== 'passed' || verification.version !== manifest.version || verification.qaUninstalled !== true) {
      throw new Error('WINDOWS-VERIFICATION.json does not record a passing verification for this build');
    }
  }

  for (const file of assetsOnly ? [] : manifest.runtime) {
    const target = path.resolve(output, 'win-unpacked', file.path);
    if (!target.startsWith(path.resolve(output, 'win-unpacked') + path.sep) || sha256(target) !== file.sha256) throw new Error('Runtime hash mismatch: ' + file.path);
  }
  for (const name of assetsOnly ? [] : appSourceFiles(app)) {
    if (sha256(path.join(app, name)) !== sha256(path.join(output, 'win-unpacked', 'resources', 'app', name))) throw new Error('Packaged application differs from source: ' + name);
  }
  console.log(JSON.stringify({ status: 'passed', version: manifest.version, sourceCommit: manifest.sourceCommit, artifacts: manifest.artifacts.length, runtimeFiles: manifest.runtime.length }));
  return manifest;
}
if (require.main === module) {
  const [action, directory, mode] = process.argv.slice(2);
  if (!directory || !['create', 'verify'].includes(action)) throw new Error('Usage: release-artifacts.js create|verify OUTPUT [--release]');
  if (action === 'create') create(path.resolve(directory)); else verify(path.resolve(directory), mode === '--release' || mode === '--release-assets', mode === '--release-assets');
}
module.exports = { create, verify, fileInventory, uncommittedAppSourceFiles, uncommittedBuildInputFiles, buildInputFiles };
