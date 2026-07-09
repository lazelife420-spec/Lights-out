// Auto-update checker.
// Compares the current app version against the latest GitHub Release
// and notifies the user when an update is available.

const { net } = require('electron');
const currentVersion = require('./package.json').version;

const REPO_API = 'https://api.github.com/repos/lazelife420-spec/Lights-out/releases/latest';
const REPO_DOWNLOAD = 'https://github.com/lazelife420-spec/Lights-out/releases/download';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// The NSIS installer asset, e.g. "Lights.Out.Setup.10.0.7.exe".
// Casing is significant: GitHub asset URLs are case-sensitive.
const INSTALLER_RE = /^Lights\.Out\.Setup\.\d+\.\d+\.\d+\.exe$/i;
const PORTABLE_NAME = 'LightsOut.exe';
const CHECKSUM_NAME = 'SHA256SUMS.txt';

// Resolve download targets from the release's real asset list rather than
// guessing names. Falls back to the documented installer naming convention
// (never lower-cased) only when no matching asset is present.
function resolveAssets(assets, tag, version) {
  const list = Array.isArray(assets) ? assets : [];
  const installer =
    list.find(a => INSTALLER_RE.test(a?.name || '')) ||
    list.find(a => a?.name?.toLowerCase().endsWith('.exe') && a.name !== PORTABLE_NAME);
  const checksum = list.find(a => a?.name === CHECKSUM_NAME);

  const fallbackTag = tag || (version ? `v${version}` : '');
  const downloadUrl =
    installer?.browser_download_url ||
    (fallbackTag && version
      ? `${REPO_DOWNLOAD}/${fallbackTag}/Lights.Out.Setup.${version}.exe`
      : '');

  return { downloadUrl, checksumUrl: checksum?.browser_download_url || '' };
}

let lastCheckResult = null;
let intervalId = null;

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkForUpdate() {
  return new Promise((resolve) => {
    try {
      const request = net.fetch(REPO_API, {
        headers: { 'User-Agent': 'LightsOut-UpdateCheck' }
      });
      request.then(async (response) => {
        if (!response.ok) {
          lastCheckResult = { available: false, error: `HTTP ${response.status}` };
          return resolve(lastCheckResult);
        }
        const data = await response.json();
        const latestTag = data.tag_name || '';
        const latestVersion = latestTag.replace(/^v/, '');
        const { downloadUrl, checksumUrl } = resolveAssets(data.assets, latestTag, latestVersion);

        if (compareVersions(latestVersion, currentVersion) > 0) {
          lastCheckResult = {
            available: true,
            latestVersion,
            currentVersion,
            downloadUrl: downloadUrl || data.html_url,
            checksumUrl,
            releaseNotes: data.body || '',
            releaseUrl: data.html_url
          };
        } else {
          lastCheckResult = { available: false, currentVersion, latestVersion };
        }
        resolve(lastCheckResult);
      }).catch((err) => {
        lastCheckResult = { available: false, error: err.message };
        resolve(lastCheckResult);
      });
    } catch (err) {
      lastCheckResult = { available: false, error: err.message };
      resolve(lastCheckResult);
    }
  });
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
  startPeriodicCheck,
  stopPeriodicCheck,
  getLastCheckResult,
  resolveAssets,
  currentVersion
};
