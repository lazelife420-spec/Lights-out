'use strict';

// Pure validation policy for Proof Foundry machine-truth update discovery.
// No Electron, no network — every rule is unit-testable.
//
// Authority model: the public release record is Proof Foundry machine truth
// (/truth/products/lights-out.json), not GitHub Releases. The record declares
// the public version and checksum-bound artifacts on an allowlisted download
// host. Anything that disagrees with that record is rejected, never guessed.

const crypto = require('node:crypto');

const TRUTH_URL = 'https://theprooffoundry.com/truth/products/lights-out.json';
const TRUTH_HOST = 'theprooffoundry.com';
const DOWNLOAD_HOST = 'downloads.theprooffoundry.com';
const TRUTH_PAGE_URL = `https://${TRUTH_HOST}/lights-out/`;

const PRODUCT_ID = 'lights-out';
const SUPPORTED_SCHEMA_VERSION = 1;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
// The verified public Windows artifact is the portable ZIP.
const PORTABLE_NAME_RE = /^Lights-Out-Portable-v\d+\.\d+\.\d+-win-x64\.zip$/;
// Hard bound on any single artifact download, regardless of declared size.
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map(Number);
  const pb = String(b || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function isValidDownloadUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === DOWNLOAD_HOST;
  } catch {
    return false;
  }
}

function isValidTruthUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === TRUTH_HOST;
  } catch {
    return false;
  }
}

function portableNameFor(version) {
  return `Lights-Out-Portable-v${version}-win-x64.zip`;
}

// Locate the Windows portable artifact in the machine record. Explicit
// metadata first (artifacts[] entries), then the top-level download block as
// the documented single-artifact fallback. Filename must still match the
// derived portable name — artifact selection is never fuzzy guessing.
function selectPortableArtifact(truth, version) {
  const expectedName = portableNameFor(version);
  const artifacts = Array.isArray(truth?.artifacts) ? truth.artifacts : [];
  const artifact = artifacts.find(candidate =>
    candidate && candidate.filename === expectedName &&
    candidate.platform === 'Windows' &&
    typeof candidate.distType === 'string' && /portable\s*zip/i.test(candidate.distType));
  if (artifact) {
    return {
      filename: artifact.filename,
      downloadUrl: artifact.downloadUrl,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes
    };
  }
  const download = truth?.download;
  if (download && download.available === true && typeof download.url === 'string') {
    const leaf = download.url.split('/').pop() || '';
    if (leaf === expectedName && PORTABLE_NAME_RE.test(leaf)) {
      return {
        filename: leaf,
        downloadUrl: download.url,
        sha256: download.sha256,
        sizeBytes: null
      };
    }
  }
  return null;
}

function resolveTruth(truth, currentVersion) {
  if (!truth || typeof truth !== 'object' || Array.isArray(truth)) {
    return { available: false, error: 'Invalid release truth metadata', code: 'INVALID_RELEASE_METADATA' };
  }
  if (truth.schemaVersion !== SUPPORTED_SCHEMA_VERSION || truth.id !== PRODUCT_ID) {
    return { available: false, error: 'Unexpected release truth record', code: 'INVALID_RELEASE_METADATA' };
  }
  const publicVersion = truth.release?.publicVersion;
  if (typeof publicVersion !== 'string' || !SEMVER_RE.test(publicVersion)) {
    return { available: false, error: 'Release truth has no valid semantic public version', code: 'INVALID_RELEASE_VERSION' };
  }

  const base = {
    available: compareVersions(publicVersion, currentVersion) > 0,
    currentVersion,
    latestVersion: publicVersion,
    releaseUrl: TRUTH_PAGE_URL
  };
  if (!base.available) return base;

  if (truth.download?.available !== true) {
    return { ...base, available: false, error: 'Release truth marks download unavailable', code: 'DOWNLOAD_UNAVAILABLE' };
  }

  const artifact = selectPortableArtifact(truth, publicVersion);
  if (!artifact) {
    return { ...base, available: false, error: `Required portable ZIP is missing: ${portableNameFor(publicVersion)}`, code: 'MISSING_PORTABLE_ZIP' };
  }
  if (typeof artifact.downloadUrl !== 'string' || !isValidDownloadUrl(artifact.downloadUrl)) {
    return { ...base, available: false, error: 'Artifact download URL is outside the trusted download host', code: 'UNTRUSTED_DOWNLOAD_HOST' };
  }
  if (typeof artifact.sha256 !== 'string' || !SHA256_HEX_RE.test(artifact.sha256)) {
    return { ...base, available: false, error: 'Required SHA-256 artifact digest is missing', code: 'MISSING_ASSET_DIGEST' };
  }
  if (artifact.sizeBytes != null &&
      (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0 || artifact.sizeBytes > MAX_ARTIFACT_BYTES)) {
    return { ...base, available: false, error: 'Artifact size is outside the allowed bound', code: 'INVALID_ARTIFACT_SIZE' };
  }

  return {
    ...base,
    available: true,
    distribution: 'portable-zip',
    assetName: artifact.filename,
    assetBytes: artifact.sizeBytes ?? null,
    assetDigest: artifact.sha256.toUpperCase(),
    downloadUrl: artifact.downloadUrl,
    manualInstall: true
  };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function verifyDownloadBuffer(buffer, expectedDigest) {
  const actualDigest = sha256(buffer);
  return {
    ok: actualDigest === String(expectedDigest || '').toUpperCase(),
    expectedDigest: String(expectedDigest || '').toUpperCase(),
    actualDigest
  };
}

function truthDiscoveryHttpError(status) {
  return {
    available: false,
    error: `Proof Foundry release truth returned HTTP ${status}`,
    code: 'RELEASE_DISCOVERY_HTTP_ERROR',
    httpStatus: status
  };
}

module.exports = {
  TRUTH_URL,
  TRUTH_HOST,
  DOWNLOAD_HOST,
  TRUTH_PAGE_URL,
  PORTABLE_NAME_RE,
  MAX_ARTIFACT_BYTES,
  compareVersions,
  portableNameFor,
  isValidDownloadUrl,
  isValidTruthUrl,
  selectPortableArtifact,
  resolveTruth,
  sha256,
  verifyDownloadBuffer,
  truthDiscoveryHttpError
};
