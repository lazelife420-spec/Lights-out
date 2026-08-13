'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { requirePackagedArtifact, resolvePackagedArtifact } = require('../scripts/packaged-artifact-resolver');

function makeRepo(prefix = 'Lights Out resolver ') {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(repoRoot, 'electron'), { recursive: true });
  return repoRoot;
}

function removeRepo(repoRoot) {
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

test('default resolves the authoritative dist-native executable', () => {
  const repoRoot = path.join('C:', 'workspace with spaces', 'Lights Out');
  const artifact = resolvePackagedArtifact({ env: {}, repoRoot });
  assert.equal(artifact.executable, path.join(repoRoot, 'dist-native', 'win-unpacked', 'Lights Out.exe'));
  assert.equal(artifact.source, 'dist-native-default');
  assert.ok(!artifact.executable.includes(`${path.sep}dist${path.sep}win-unpacked`));
});

test('space-containing repository paths survive default resolution', () => {
  const repoRoot = makeRepo();
  try {
    const executable = path.join(repoRoot, 'dist-native', 'win-unpacked', 'Lights Out.exe');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, 'probe');
    assert.equal(requirePackagedArtifact({ env: {}, repoRoot }).executable, executable);
  } finally {
    removeRepo(repoRoot);
  }
});

test('explicit packaged executable override is preserved exactly', () => {
  const repoRoot = makeRepo();
  try {
    const executable = path.join(repoRoot, 'custom output with spaces', 'Lights Out Candidate.exe');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, 'probe');
    const artifact = requirePackagedArtifact({
      env: { LIGHTS_OUT_PACKAGED_EXE: executable, LIGHTS_OUT_DIST_DIR: '   ' },
      repoRoot
    });
    assert.equal(artifact.executable, executable);
    assert.equal(artifact.source, 'LIGHTS_OUT_PACKAGED_EXE');
  } finally {
    removeRepo(repoRoot);
  }
});

test('existing LIGHTS_OUT_DIST_DIR override remains supported', () => {
  const repoRoot = makeRepo();
  try {
    const electronRoot = path.join(repoRoot, 'electron');
    const relativeDirectory = path.join('..', 'alternate package', 'win-unpacked');
    const executable = path.resolve(electronRoot, relativeDirectory, 'Lights Out.exe');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, 'probe');
    const artifact = requirePackagedArtifact({ env: { LIGHTS_OUT_DIST_DIR: relativeDirectory }, repoRoot });
    assert.equal(artifact.executable, executable);
    assert.equal(artifact.source, 'LIGHTS_OUT_DIST_DIR');
  } finally {
    removeRepo(repoRoot);
  }
});

test('missing authoritative artifact fails clearly without stale dist fallback', () => {
  const repoRoot = makeRepo();
  try {
    const staleExecutable = path.join(repoRoot, 'dist', 'win-unpacked', 'Lights Out.exe');
    fs.mkdirSync(path.dirname(staleExecutable), { recursive: true });
    fs.writeFileSync(staleExecutable, 'stale');
    assert.throws(
      () => requirePackagedArtifact({ env: {}, repoRoot }),
      error => error.message.includes(path.join(repoRoot, 'dist-native', 'win-unpacked', 'Lights Out.exe')) &&
        error.message.includes('run "npm run build" first')
    );
  } finally {
    removeRepo(repoRoot);
  }
});

test('empty explicit override fails closed instead of silently selecting another artifact', () => {
  assert.throws(
    () => resolvePackagedArtifact({ env: { LIGHTS_OUT_PACKAGED_EXE: '   ' } }),
    /LIGHTS_OUT_PACKAGED_EXE must be a non-empty path/
  );
});
