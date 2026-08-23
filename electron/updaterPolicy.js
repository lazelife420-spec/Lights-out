'use strict';

const crypto = require('node:crypto');

const PORTABLE_ASSET_RE = /^Lights-Out-Portable-v(\d+\.\d+\.\d+)-win-x64\.zip$/;
const SHA256_RE = /^sha256:([a-f0-9]{64})$/i;

function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map(Number);
  const pb = String(b || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function resolveRelease(release, currentVersion) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    return { available: false, error: 'Invalid release metadata', code: 'INVALID_RELEASE_METADATA' };
  }
  const latestTag = typeof release.tag_name === 'string' ? release.tag_name : '';
  const latestVersion = latestTag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(latestVersion)) {
    return { available: false, error: 'Latest release has no valid semantic version tag', code: 'INVALID_RELEASE_VERSION' };
  }

  const base = {
    available: compareVersions(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    releaseNotes: typeof release.body === 'string' ? release.body : '',
    releaseUrl: typeof release.html_url === 'string' ? release.html_url : ''
  };
  if (!base.available) return base;

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const expectedName = `Lights-Out-Portable-v${latestVersion}-win-x64.zip`;
  const asset = assets.find(candidate => candidate?.name === expectedName && PORTABLE_ASSET_RE.test(candidate.name));
  if (!asset || typeof asset.browser_download_url !== 'string' || !asset.browser_download_url.startsWith('https://github.com/')) {
    return { ...base, available: false, error: `Required portable ZIP is missing: ${expectedName}`, code: 'MISSING_PORTABLE_ZIP' };
  }
  const digestMatch = typeof asset.digest === 'string' ? asset.digest.match(SHA256_RE) : null;
  if (!digestMatch) {
    return { ...base, available: false, error: 'Required GitHub SHA-256 asset digest is missing', code: 'MISSING_ASSET_DIGEST' };
  }

  return {
    ...base,
    available: true,
    distribution: 'portable-zip',
    assetName: asset.name,
    assetBytes: Number.isSafeInteger(asset.size) ? asset.size : null,
    assetDigest: digestMatch[1].toUpperCase(),
    downloadUrl: asset.browser_download_url,
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

function releaseDiscoveryHttpError(status) {
  return {
    available: false,
    error: `GitHub release discovery returned HTTP ${status}`,
    code: 'RELEASE_DISCOVERY_HTTP_ERROR',
    httpStatus: status
  };
}

module.exports = { PORTABLE_ASSET_RE, compareVersions, resolveRelease, sha256, verifyDownloadBuffer, releaseDiscoveryHttpError };
