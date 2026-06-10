// Auto-update checker.
// Compares the current app version against the latest GitHub Release
// and notifies the user when an update is available.

const { net } = require('electron');
const currentVersion = require('./package.json').version;

const REPO_API = 'https://api.github.com/repos/Z3r0DayZion-install/lights-out/releases/latest';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

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
        const downloadUrl = (data.assets || []).find(a => a.name?.endsWith('.exe'))?.browser_download_url || data.html_url;

        if (compareVersions(latestVersion, currentVersion) > 0) {
          lastCheckResult = {
            available: true,
            latestVersion,
            currentVersion,
            downloadUrl,
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
  currentVersion
};
