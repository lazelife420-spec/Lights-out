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
const TRUTH_TIMEOUT_MS = 15 * 1000;
const DOWNLOAD_TIMEOUT_MS = 120 * 1000;
const MAX_REDIRECT_HOPS = 5;

let lastCheckResult = null;
let intervalId = null;
let downloadInFlight = false;

async function fetchValidatedHttps(initialUrl, validateUrl, { headers, timeoutMs, untrustedCode, untrustedMessage }) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (!validateUrl(currentUrl)) {
      const err = new Error(untrustedMessage);
      err.code = untrustedCode;
      throw err;
    }
    const response = await net.fetch(currentUrl, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        const err = new Error('Redirect response missing Location header');
        err.code = untrustedCode;
        throw err;
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    if (response.url && !validateUrl(response.url)) {
      const err = new Error(untrustedMessage);
      err.code = untrustedCode;
      throw err;
    }
    return response;
  }
  const err = new Error('Too many redirects');
  err.code = untrustedCode;
  throw err;
}

async function checkForUpdate() {
  try {
    const response = await fetchValidatedHttps(policy.TRUTH_URL, policy.isValidTruthUrl, {
      headers: { 'User-Agent': 'LightsOut-UpdateCheck' },
      timeoutMs: TRUTH_TIMEOUT_MS,
      untrustedCode: 'UNTRUSTED_TRUTH_HOST',
      untrustedMessage: 'Release truth redirected to an untrusted host'
    });
    if (!response.ok) {
      lastCheckResult = policy.truthDiscoveryHttpError(response.status);
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
    lastCheckResult = {
      available: false,
      error: error.message,
      code: error.code === 'UNTRUSTED_TRUTH_HOST' ? 'UNTRUSTED_TRUTH_HOST' : 'RELEASE_DISCOVERY_FAILED'
    };
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
  if (downloadInFlight) {
    return { success: false, code: 'UPDATE_DOWNLOAD_IN_PROGRESS', error: 'An update download is already in progress' };
  }
  const release = lastCheckResult;
  if (!release?.available || release.distribution !== 'portable-zip' || !release.downloadUrl || !release.assetDigest || !release.assetName) {
    return { success: false, code: 'NO_VERIFIED_PORTABLE_UPDATE', error: 'No verified portable update is ready to download' };
  }

  downloadInFlight = true;
  let temporary = null;
  let handle = null;
  try {
    const response = await fetchValidatedHttps(release.downloadUrl, policy.isValidDownloadUrl, {
      headers: { 'User-Agent': 'LightsOut-PortableUpdate' },
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      untrustedCode: 'UPDATE_UNTRUSTED_REDIRECT',
      untrustedMessage: 'Download redirected to an untrusted host'
    });
    if (!response.ok) {
      return { success: false, code: 'UPDATE_DOWNLOAD_HTTP_ERROR', error: `Portable ZIP download returned HTTP ${response.status}`, httpStatus: response.status };
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > policy.MAX_ARTIFACT_BYTES ||
        (release.assetBytes && contentLength > 0 && contentLength !== release.assetBytes)) {
      return { success: false, code: 'UPDATE_SIZE_MISMATCH', error: 'Download size does not match the release truth' };
    }

    await fs.mkdir(destinationDirectory, { recursive: true });
    const destination = await uniqueDestination(destinationDirectory, release.assetName);
    temporary = `${destination}.partial-${crypto.randomUUID()}`;
    handle = await fs.open(temporary, 'wx');

    // Stream chunks directly to disk while computing SHA-256 so an oversized or
    // chunked payload can never exhaust RAM.
    const hasher = crypto.createHash('sha256');
    const maxBytes = release.assetBytes ? Math.min(policy.MAX_ARTIFACT_BYTES, release.assetBytes) : policy.MAX_ARTIFACT_BYTES;
    let totalBytes = 0;

    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          return { success: false, code: 'UPDATE_SIZE_MISMATCH', error: 'Download size does not match the release truth' };
        }
        hasher.update(chunk);
        await handle.write(chunk);
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      totalBytes = buffer.length;
      if (totalBytes > maxBytes) {
        return { success: false, code: 'UPDATE_SIZE_MISMATCH', error: 'Download size does not match the release truth' };
      }
      hasher.update(buffer);
      await handle.write(buffer);
    }

    await handle.sync().catch(() => {});
    await handle.close();
    handle = null;

    if (totalBytes > policy.MAX_ARTIFACT_BYTES || (release.assetBytes && totalBytes !== release.assetBytes)) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      return { success: false, code: 'UPDATE_SIZE_MISMATCH', error: 'Download size does not match the release truth' };
    }

    const actualDigest = hasher.digest('hex').toUpperCase();
    const expectedDigest = String(release.assetDigest || '').toUpperCase();
    if (actualDigest !== expectedDigest) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      return {
        success: false,
        code: 'UPDATE_DIGEST_MISMATCH',
        error: 'Downloaded ZIP failed SHA-256 verification',
        ok: false,
        expectedDigest,
        actualDigest
      };
    }

    await fs.rename(temporary, destination);
    temporary = null;
    return {
      success: true,
      code: 'VERIFIED_PORTABLE_ZIP_SAVED',
      filePath: destination,
      assetName: release.assetName,
      sha256: actualDigest,
      manualInstall: true,
      instructions: 'Close Lights Out, extract the ZIP to its own folder, then run Lights Out.exe from that folder.'
    };
  } catch (error) {
    return {
      success: false,
      code: error.code === 'UPDATE_UNTRUSTED_REDIRECT' ? 'UPDATE_UNTRUSTED_REDIRECT' : 'UPDATE_DOWNLOAD_FAILED',
      error: error.message
    };
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
    downloadInFlight = false;
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
