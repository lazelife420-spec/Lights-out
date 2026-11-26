'use strict';
// packaging-7: provision-nsis.ps1 must not trust a preset LIGHTS_OUT_NSIS_ROOT (or a
// cached extraction) unless it is an exact copy of the SHA-256-pinned NSIS archive.
// Runs the real script against temporary cache folders. It never downloads: every
// case seeds the cache with an archive, and nothing here executes makensis.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'provision-nsis.ps1');
const PINNED_SHA256 = 'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1';
const windows = process.platform === 'win32';
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// The pinned archive as provisioned by an earlier build (CI provisions it before npm test).
const cachedArchive = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'LightsOut-build-tools', 'nsis-3.11', 'nsis-3.11.zip') : '';
const pinnedArchiveAvailable = windows && Boolean(cachedArchive) && fs.existsSync(cachedArchive) && sha256(cachedArchive) === PINNED_SHA256;

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-nsis-provision-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function provision(cacheRoot, presetRoot) {
  const env = { ...process.env };
  delete env.GITHUB_ENV; // never append to a CI job's environment file
  delete env.LIGHTS_OUT_NSIS_ROOT;
  if (presetRoot) env.LIGHTS_OUT_NSIS_ROOT = presetRoot;
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-CacheRoot', cacheRoot],
    { env, encoding: 'utf8', timeout: 150000, windowsHide: true });
  // The console host wraps long warnings, so compare with whitespace collapsed.
  return { status: result.status, output: `${result.stdout || ''} ${result.stderr || ''}`.replace(/\s+/g, ' ') };
}

test('a preset NSIS root without the pinned archive beside it is not trusted', { skip: !windows, timeout: 180000 }, t => {
  const root = tempDir(t);
  const preset = path.join(root, 'custom', 'nsis');
  fs.mkdirSync(path.join(preset, 'Bin'), { recursive: true });
  fs.writeFileSync(path.join(preset, 'Bin', 'makensis.exe'), 'not the pinned compiler');
  const cacheRoot = path.join(root, 'cache');
  fs.mkdirSync(cacheRoot);
  // A corrupt cached archive makes the fallback stop before any download.
  fs.writeFileSync(path.join(cacheRoot, 'nsis-3.11.zip'), 'corrupt archive');

  const { status, output } = provision(cacheRoot, preset);
  assert.notEqual(status, 0, output);
  assert.doesNotMatch(output, /Validated preconfigured|verified file by file/);
  assert.match(output, /Ignoring preconfigured LIGHTS_OUT_NSIS_ROOT/);
  assert.match(output, /Cached NSIS archive integrity mismatch/);
});

test('a preset root beside a corrupt archive is not trusted either', { skip: !windows, timeout: 180000 }, t => {
  const root = tempDir(t);
  const preset = path.join(root, 'custom', 'nsis-3.11');
  fs.mkdirSync(preset, { recursive: true });
  fs.writeFileSync(path.join(preset, 'makensis.exe'), 'not the pinned compiler');
  fs.writeFileSync(path.join(root, 'custom', 'nsis-3.11.zip'), 'not the pinned archive');
  const cacheRoot = path.join(root, 'cache');
  fs.mkdirSync(cacheRoot);
  fs.writeFileSync(path.join(cacheRoot, 'nsis-3.11.zip'), 'corrupt archive');

  const { status, output } = provision(cacheRoot, preset);
  assert.notEqual(status, 0, output);
  assert.match(output, /Ignoring preconfigured LIGHTS_OUT_NSIS_ROOT.*failed SHA-256 verification/s);
});

test('a tampered or padded NSIS tree is rejected and re-extracted from the verified archive',
  { skip: !pinnedArchiveAvailable && 'pinned NSIS archive is not provisioned on this machine', timeout: 300000 }, t => {
    const root = tempDir(t);
    const cacheRoot = path.join(root, 'cache');
    fs.mkdirSync(cacheRoot);
    fs.copyFileSync(cachedArchive, path.join(cacheRoot, 'nsis-3.11.zip'));
    const extractRoot = path.join(cacheRoot, 'nsis-3.11');

    let run = provision(cacheRoot);
    assert.equal(run.status, 0, run.output);
    const compiler = path.join(extractRoot, 'Bin', 'makensis.exe');
    const pinnedCompilerSha = sha256(compiler);

    // The compiler that would actually run is modified, and an extra plugin is planted.
    fs.appendFileSync(compiler, 'tampered');
    const planted = path.join(extractRoot, 'Plugins', 'x86-unicode', 'planted.dll');
    fs.writeFileSync(planted, 'planted');

    run = provision(cacheRoot, extractRoot);
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /Ignoring preconfigured LIGHTS_OUT_NSIS_ROOT.*not an exact copy/s);
    assert.doesNotMatch(run.output, /verified file by file/);
    assert.equal(sha256(compiler), pinnedCompilerSha, 'the pinned compiler is restored from the verified archive');

    // Without a preset, a cached extraction with an extra file is not reused as-is either.
    fs.writeFileSync(planted, 'planted');
    run = provision(cacheRoot);
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /unexpected file: Plugins\\x86-unicode\\planted\.dll/);
    assert.equal(fs.existsSync(planted), false);

    // An exact copy of the pinned tree is accepted as a preset.
    run = provision(cacheRoot, extractRoot);
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /verified file by file against the pinned archive/);
  });
