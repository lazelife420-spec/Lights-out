'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { appSourceFiles } = require('./app-source-files');
const root = path.resolve(__dirname, '..', '..');
const app = path.join(root, 'electron');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

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

function create(output) {
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  const files = ['Lights Out Setup ' + pkg.version + '.exe', 'Lights-Out-Portable-v' + pkg.version + '-win-x64.zip']
    .filter(name => fs.existsSync(path.join(output, name)));
  if (!files.length) throw new Error('No distribution artifacts found');
  const artifacts = files.map(name => ({ name, bytes: fs.statSync(path.join(output, name)).size, sha256: sha256(path.join(output, name)) }));
  const manifest = { schema: 'lights-out.windows-release/v1', version: pkg.version, sourceCommit: git('rev-parse', 'HEAD'),
    trackedSourceDirty: Boolean(git('status', '--porcelain=v1', '--untracked-files=no')),
    electronVersion: JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8')).packages['node_modules/electron'].version,
    packageLockSha256: sha256(path.join(app, 'package-lock.json')), artifacts, runtime: fileInventory(path.join(output, 'win-unpacked')) };
  fs.writeFileSync(path.join(output, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), artifacts.map(a => a.sha256 + '  ' + a.name).join('\n') + '\n');
  console.log(JSON.stringify({ version: pkg.version, artifacts, runtimeFiles: manifest.runtime.length }));
}

function verify(output, strict = false, assetsOnly = false) {
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'BUILD-MANIFEST.json'), 'utf8'));
  if (strict && (manifest.trackedSourceDirty || manifest.sourceCommit !== git('rev-parse', 'HEAD'))) throw new Error('Release provenance must name this clean source commit');
  const sums = fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8');
  for (const artifact of manifest.artifacts) {
    if (path.basename(artifact.name) !== artifact.name || sha256(path.join(output, artifact.name)) !== artifact.sha256) throw new Error('Artifact hash mismatch: ' + artifact.name);
    if (!sums.split(/\r?\n/).includes(artifact.sha256 + '  ' + artifact.name)) throw new Error('Checksum entry missing: ' + artifact.name);
  }
  if (strict && manifest.artifacts.length !== 2) throw new Error('Installer and portable ZIP are both required');
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
module.exports = { create, verify, fileInventory };
