// Portable ZIP update discovery and verified download.
// Release authority is Proof Foundry machine truth, not GitHub Releases.
// Lights Out never executes or overwrites itself from this module. A verified
// ZIP is saved to Downloads and the user completes the portable update.

const { app, net } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const policy = require('./updaterPolicy');
const currentVersion = require('./package.json').version;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let lastCheckResult = null;
let intervalId = null;

async function checkForUpdate() {
  try {
    const response = await net.fetch(policy.TRUTH_URL, {
      headers: { 'User-Agent': 'LightsOut-UpdateCheck' },
      redirect: 'follow'
    });
    if (!response.ok) {
      lastCheckResult = policy.truthDiscoveryHttpError(response.status);
      return lastCheckResult;
    }
    if (response.url && !policy.isValidTruthUrl(response.url)) {
      lastCheckResult = { available: false, error: 'Release truth redirected to an untrusted host', code: 'UNTRUSTED_TRUTH_HOST' };
      return lastCheckResult;
    }
    let data;
    try {
      data = await response.json();
    } catch {
      lastCheckResult = { available: false, error: 'Proof Foundry returned malformed release truth', code: 'INVALID_RELEASE_METADATA' };
      return lastCheckResult;
    }
    lastCheckResult = policy.resolveTruth(data, currentVersion);
    return lastCheckResult;
  } catch (error) {
    lastCheckResult = { available: false, error: error.message, code: 'RELEASE_DISCOVERY_FAILED' };
    return lastCheckResult;
  }
}

async function uniqueDestination(directory, assetName) {
  const parsed = path.parse(assetName);
  for (let index = 0; index < 1000; index++) {
    const suffix = index === 0 ? '' : ` (${index})`;
    const candidate = path.join(directory, `${parsed.name}${suffix}${parsed.ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Could not choose a non-overwriting download filename');
}

async function downloadPortableUpdate(destinationDirectory = app.getPath('downloads')) {
  const release = lastCheckResult;
  if (!release?.available || release.distribution !== 'portable-zip' || !release.downloadUrl || !release.assetDigest || !release.assetName) {
    return { success: false, code: 'NO_VERIFIED_PORTABLE_UPDATE', error: 'No verified portable update is ready to download' };
  }

  try {
    const response = await net.fetch(release.downloadUrl, {
      headers: { 'User-Agent': 'LightsOut-PortableUpdate' },
      redirect: 'follow'
    });
    if (response.url && !policy.isValidDownloadUrl(response.url)) {
      return { success: false, code: 'UPDATE_UNTRUSTED_REDIRECT', error: 'Download redirected to an untrusted host' };
    }
    if (!response.ok) {
      return { success: false, code: 'UPDATE_DOWNLOAD_HTTP_ERROR', error: `Portable ZIP download returned HTTP ${response.status}`, httpStatus: response.status };
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > policy.MAX_ARTIFACT_BYTES ||
        (release.assetBytes && contentLength > 0 && contentLength !== release.assetBytes)) {
      return { success: false, code: 'UPDATE_SIZE_MISMATCH', error: 'Download size does not match the release truth' };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > policy.MAX_ARTIFACT_BYTES ||
        (release.assetBytes && buffer.length !== release.assetBytes)) {
      return { success: false, code: 'UPDATE_SIZE_MISMATCH', error: 'Download size does not match the release truth' };
    }
    const verification = policy.verifyDownloadBuffer(buffer, release.assetDigest);
    if (!verification.ok) {
      return { success: false, code: 'UPDATE_DIGEST_MISMATCH', error: 'Downloaded ZIP failed SHA-256 verification', ...verification };
    }

    await fs.mkdir(destinationDirectory, { recursive: true });
    const destination = await uniqueDestination(destinationDirectory, release.assetName);
    const temporary = `${destination}.partial-${crypto.randomUUID()}`;
    try {
      await fs.writeFile(temporary, buffer, { flag: 'wx' });
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return {
      success: true,
      code: 'VERIFIED_PORTABLE_ZIP_SAVED',
      filePath: destination,
      assetName: release.assetName,
      sha256: verification.actualDigest,
      manualInstall: true,
      instructions: 'Close Lights Out, extract the ZIP to its own folder, then run Lights Out.exe from that folder.'
    };
  } catch (error) {
    return { success: false, code: 'UPDATE_DOWNLOAD_FAILED', error: error.message };
  }
}

function startPeriodicCheck(callback) {
  // Check once on start.
  checkForUpdate().then(result => {
    if (result.available && callback) callback(result);
  });

  // Then periodically.
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(async () => {
    const result = await checkForUpdate();
    if (result.available && callback) callback(result);
  }, CHECK_INTERVAL_MS);
}

function stopPeriodicCheck() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

function getLastCheckResult() {
  return lastCheckResult;
}

module.exports = {
  checkForUpdate,
  downloadPortableUpdate,
  startPeriodicCheck,
  stopPeriodicCheck,
  getLastCheckResult,
  currentVersion,
  resolveTruth: policy.resolveTruth,
  compareVersions: policy.compareVersions
};
