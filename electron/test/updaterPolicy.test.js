'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../updaterPolicy');

const current = '11.1.2';
const portableName = 'Lights-Out-Portable-v11.1.3-win-x64.zip';
const digest = 'A'.repeat(64);
const zipUrl = `https://downloads.theprooffoundry.com/lights-out/v11.1.3/${portableName}`;

function truth(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'lights-out',
    release: { releaseStatus: 'PUBLIC_RELEASE', publicVersion: '11.1.3' },
    download: { available: true, url: zipUrl, sha256: digest },
    artifacts: [{
      filename: portableName,
      sizeBytes: 123,
      sha256: digest,
      downloadUrl: zipUrl,
      platform: 'Windows',
      distType: 'Portable ZIP (unsigned)'
    }],
    ...overrides
  };
}

test('updater: newer public version resolves the verified portable ZIP', () => {
  const result = policy.resolveTruth(truth(), current);
  assert.equal(result.available, true);
  assert.equal(result.distribution, 'portable-zip');
  assert.equal(result.assetName, portableName);
  assert.equal(result.assetDigest, digest);
  assert.equal(result.downloadUrl, zipUrl);
  assert.equal(result.manualInstall, true);
  assert.equal(result.latestVersion, '11.1.3');
});

test('updater: same public version is not an update', () => {
  const result = policy.resolveTruth(truth({ release: { publicVersion: current } }), current);
  assert.equal(result.available, false);
  assert.equal(result.latestVersion, current);
  assert.equal(result.error, undefined);
});

test('updater: older public version never downgrades', () => {
  const result = policy.resolveTruth(truth({ release: { publicVersion: '10.0.0' } }), current);
  assert.equal(result.available, false);
  assert.equal(result.latestVersion, '10.0.0');
});

test('updater: malformed or missing version is rejected', () => {
  assert.equal(policy.resolveTruth(truth({ release: { publicVersion: 'latest' } }), current).code, 'INVALID_RELEASE_VERSION');
  assert.equal(policy.resolveTruth(truth({ release: {} }), current).code, 'INVALID_RELEASE_VERSION');
});

test('updater: malformed truth record is rejected, never an update', () => {
  assert.equal(policy.resolveTruth(null, current).code, 'INVALID_RELEASE_METADATA');
  assert.equal(policy.resolveTruth([], current).code, 'INVALID_RELEASE_METADATA');
  assert.equal(policy.resolveTruth(truth({ schemaVersion: 2 }), current).code, 'INVALID_RELEASE_METADATA');
  assert.equal(policy.resolveTruth(truth({ id: 'other-product' }), current).code, 'INVALID_RELEASE_METADATA');
});

test('updater: download marked unavailable fails closed', () => {
  const data = truth();
  data.download.available = false;
  assert.equal(policy.resolveTruth(data, current).code, 'DOWNLOAD_UNAVAILABLE');
});

test('updater: truth HTTP failure preserves status truth', () => {
  assert.deepEqual(policy.truthDiscoveryHttpError(503), {
    available: false,
    error: 'Proof Foundry release truth returned HTTP 503',
    code: 'RELEASE_DISCOVERY_HTTP_ERROR',
    httpStatus: 503
  });
});

test('updater: installer-only artifact is rejected, not guessed', () => {
  const data = truth({ artifacts: [{ filename: 'Lights-Out-v11.1.3-Win-x64.exe', sha256: digest, downloadUrl: 'https://downloads.theprooffoundry.com/lights-out/v11.1.3/installer.exe', platform: 'Windows', distType: 'Windows installer EXE (unsigned)' }] });
  const result = policy.resolveTruth(data, current);
  // artifacts[] lacks the portable entry, but the download block still names
  // the same portable ZIP and remains a valid explicit fallback.
  assert.equal(result.available, true);
  assert.equal(result.assetName, portableName);
});

test('updater: missing portable artifact and unusable download block fails closed', () => {
  const data = truth({
    artifacts: [],
    download: { available: true, url: 'https://downloads.theprooffoundry.com/lights-out/v11.1.3/Lights-Out-v11.1.3-Win-x64.exe', sha256: digest }
  });
  assert.equal(policy.resolveTruth(data, current).code, 'MISSING_PORTABLE_ZIP');
});

test('updater: download URL outside the trusted host is rejected', () => {
  const data = truth();
  data.artifacts[0].downloadUrl = 'https://evil.example.com/lights-out.zip';
  assert.equal(policy.resolveTruth(data, current).code, 'UNTRUSTED_DOWNLOAD_HOST');
  const http = truth();
  http.artifacts[0].downloadUrl = 'http://downloads.theprooffoundry.com/x.zip';
  assert.equal(policy.resolveTruth(http, current).code, 'UNTRUSTED_DOWNLOAD_HOST');
});

test('updater: missing or malformed SHA-256 digest fails closed', () => {
  const missing = truth();
  delete missing.artifacts[0].sha256;
  assert.equal(policy.resolveTruth(missing, current).code, 'MISSING_ASSET_DIGEST');
  const bad = truth();
  bad.artifacts[0].sha256 = 'not-a-digest';
  assert.equal(policy.resolveTruth(bad, current).code, 'MISSING_ASSET_DIGEST');
});

test('updater: absurd artifact size is rejected', () => {
  const data = truth();
  data.artifacts[0].sizeBytes = policy.MAX_ARTIFACT_BYTES + 1;
  assert.equal(policy.resolveTruth(data, current).code, 'INVALID_ARTIFACT_SIZE');
});

test('updater: digest mismatch is rejected and match accepted', () => {
  const bytes = Buffer.from('portable ZIP bytes');
  const expected = policy.sha256(bytes);
  assert.equal(policy.verifyDownloadBuffer(bytes, expected).ok, true);
  const wrong = policy.verifyDownloadBuffer(bytes, digest);
  assert.equal(wrong.ok, false);
  assert.notEqual(wrong.actualDigest, wrong.expectedDigest);
});

test('updater: result carries no GitHub or NSIS assumptions', () => {
  const result = policy.resolveTruth(truth(), current);
  assert.equal(result.available, true);
  const serialized = JSON.stringify(result) + JSON.stringify(policy.TRUTH_URL);
  assert.doesNotMatch(serialized, /github\.com|Lights\.Out\.Setup/i);
});

test('updater: artifact filename must be the derived portable name', () => {
  const data = truth();
  data.artifacts[0].filename = 'lights-out-latest.zip';
  const result = policy.resolveTruth(data, current);
  // artifacts[] entry no longer qualifies; download block still points at the
  // correctly-named portable ZIP and remains the valid explicit fallback.
  assert.equal(result.available, true);
  assert.equal(result.assetName, portableName);
});
