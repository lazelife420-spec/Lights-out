'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../updaterPolicy');

const current = '11.1.2';
const portableName = 'Lights-Out-Portable-v11.1.3-win-x64.zip';
const digest = 'A'.repeat(64);

function release(overrides = {}) {
  return {
    tag_name: 'v11.1.3',
    html_url: 'https://github.com/lazelife420-spec/Lights-out/releases/tag/v11.1.3',
    body: 'notes',
    assets: [{ name: portableName, size: 123, digest: `sha256:${digest}`, browser_download_url: `https://github.com/lazelife420-spec/Lights-out/releases/download/v11.1.3/${portableName}` }],
    ...overrides
  };
}

test('updater: current == latest is up to date', () => {
  const result = policy.resolveRelease(release({ tag_name: 'v11.1.2' }), current);
  assert.equal(result.available, false);
  assert.equal(result.latestVersion, current);
  assert.equal(result.error, undefined);
});

test('updater: older < latest resolves the exact portable Windows x64 ZIP', () => {
  const result = policy.resolveRelease(release(), current);
  assert.equal(result.available, true);
  assert.equal(result.distribution, 'portable-zip');
  assert.equal(result.assetName, portableName);
  assert.equal(result.assetDigest, digest);
  assert.equal(result.manualInstall, true);
});

test('updater: malformed release JSON fails explicitly', () => {
  assert.equal(policy.resolveRelease(null, current).code, 'INVALID_RELEASE_METADATA');
  assert.equal(policy.resolveRelease([], current).code, 'INVALID_RELEASE_METADATA');
  assert.equal(policy.resolveRelease({ tag_name: 'latest' }, current).code, 'INVALID_RELEASE_VERSION');
});

test('updater: API unavailable preserves the HTTP failure truth', () => {
  assert.deepEqual(policy.releaseDiscoveryHttpError(404), {
    available: false,
    error: 'GitHub release discovery returned HTTP 404',
    code: 'RELEASE_DISCOVERY_HTTP_ERROR',
    httpStatus: 404
  });
});

test('updater: missing expected ZIP fails explicitly', () => {
  assert.equal(policy.resolveRelease(release({ assets: [] }), current).code, 'MISSING_PORTABLE_ZIP');
});

test('updater: wrong asset name is not accepted', () => {
  const result = policy.resolveRelease(release({ assets: [{ name: 'LightsOut.exe', digest: `sha256:${digest}`, browser_download_url: 'https://github.com/example.exe' }] }), current);
  assert.equal(result.code, 'MISSING_PORTABLE_ZIP');
});

test('updater: missing integrity metadata fails explicitly', () => {
  const data = release();
  delete data.assets[0].digest;
  assert.equal(policy.resolveRelease(data, current).code, 'MISSING_ASSET_DIGEST');
});

test('updater: malformed integrity metadata fails explicitly', () => {
  const data = release();
  data.assets[0].digest = 'sha256:not-a-digest';
  assert.equal(policy.resolveRelease(data, current).code, 'MISSING_ASSET_DIGEST');
});

test('updater: digest mismatch is rejected', () => {
  const result = policy.verifyDownloadBuffer(Buffer.from('portable ZIP bytes'), digest);
  assert.equal(result.ok, false);
  assert.notEqual(result.actualDigest, result.expectedDigest);
});

test('updater: valid portable ZIP bytes pass the declared SHA-256', () => {
  const bytes = Buffer.from('portable ZIP bytes');
  const expected = policy.sha256(bytes);
  const result = policy.verifyDownloadBuffer(bytes, expected);
  assert.equal(result.ok, true);
  assert.equal(result.actualDigest, expected);
});

test('updater: no installer asset is required and no fallback URL is fabricated', () => {
  const result = policy.resolveRelease(release(), current);
  assert.equal(result.available, true);
  assert.match(result.downloadUrl, /Lights-Out-Portable-v11\.1\.3-win-x64\.zip$/);
  assert.doesNotMatch(JSON.stringify(result), /Lights\.Out\.Setup|\.exe/);
});

test('updater: installer-only releases are rejected rather than guessed', () => {
  const result = policy.resolveRelease(release({ assets: [{ name: 'Lights.Out.Setup.11.1.3.exe', digest: `sha256:${digest}`, browser_download_url: 'https://github.com/installer.exe' }] }), current);
  assert.equal(result.code, 'MISSING_PORTABLE_ZIP');
  assert.equal(result.downloadUrl, undefined);
});
