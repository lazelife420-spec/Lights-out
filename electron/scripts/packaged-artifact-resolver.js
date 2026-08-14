'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ELECTRON_ROOT = path.join(DEFAULT_REPO_ROOT, 'electron');
const PACKAGED_EXECUTABLE_NAME = 'Lights Out.exe';

function readOverride(env, name) {
  if (!Object.prototype.hasOwnProperty.call(env, name)) return null;
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty path when supplied`);
  }
  return value;
}

function resolveFromElectronRoot(electronRoot, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(electronRoot, value);
}

function resolvePackagedArtifact({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
  electronRoot = path.join(repoRoot, 'electron')
} = {}) {
  const executableOverride = readOverride(env, 'LIGHTS_OUT_PACKAGED_EXE');
  const distDirectoryOverride = executableOverride ? null : readOverride(env, 'LIGHTS_OUT_DIST_DIR');
  let executable;
  let source;

  if (executableOverride) {
    executable = resolveFromElectronRoot(electronRoot, executableOverride);
    source = 'LIGHTS_OUT_PACKAGED_EXE';
  } else if (distDirectoryOverride) {
    executable = path.join(resolveFromElectronRoot(electronRoot, distDirectoryOverride), PACKAGED_EXECUTABLE_NAME);
    source = 'LIGHTS_OUT_DIST_DIR';
  } else {
    executable = path.join(repoRoot, 'dist-native', 'win-unpacked', PACKAGED_EXECUTABLE_NAME);
    source = 'dist-native-default';
  }

  const unpackedDir = path.dirname(executable);
  const outputRoot = path.dirname(unpackedDir);
  return {
    executable,
    unpackedDir,
    outputRoot,
    proofDir: path.join(outputRoot, 'review-proof'),
    source
  };
}

function requirePackagedArtifact(options = {}) {
  const artifact = resolvePackagedArtifact(options);
  const fsImpl = options.fsImpl || fs;
  let isFile = false;
  try {
    isFile = fsImpl.statSync(artifact.executable).isFile();
  } catch {}
  if (!isFile) {
    throw new Error(
      `Packaged executable not found at ${artifact.executable}. ` +
      `Expected the native package output dist-native\\win-unpacked\\${PACKAGED_EXECUTABLE_NAME}; run "npm run build" first.`
    );
  }
  return artifact;
}

module.exports = {
  DEFAULT_ELECTRON_ROOT,
  DEFAULT_REPO_ROOT,
  PACKAGED_EXECUTABLE_NAME,
  requirePackagedArtifact,
  resolvePackagedArtifact
};
