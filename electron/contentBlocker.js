// Content Blocker: blocks distracting websites during wind-down
// by modifying the Windows hosts file. Zero dependencies,
// works for all browsers, brutal and effective.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const MARKER_START = '# === LIGHTS OUT BLOCK START ===';
const MARKER_END = '# === LIGHTS OUT BLOCK END ===';

// Default blocklist: social media, video, and doom-scrolling sites.
const DEFAULT_BLOCKLIST = [
  'tiktok.com', 'www.tiktok.com',
  'instagram.com', 'www.instagram.com',
  'reddit.com', 'www.reddit.com', 'old.reddit.com',
  'twitter.com', 'x.com', 'www.twitter.com', 'www.x.com',
  'facebook.com', 'www.facebook.com', 'm.facebook.com',
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'twitch.tv', 'www.twitch.tv',
  'netflix.com', 'www.netflix.com',
  'discord.com', 'www.discord.com',
  'pinterest.com', 'www.pinterest.com',
  'tumblr.com', 'www.tumblr.com',
  'snapchat.com', 'www.snapchat.com',
  'threads.net', 'www.threads.net'
];

// Read the current hosts file content.
function readHosts() {
  try {
    return fs.readFileSync(HOSTS_PATH, 'utf-8');
  } catch {
    return '';
  }
}

// Write the hosts file (requires admin, so we use PowerShell with elevation).
async function writeHosts(content) {
  // Write via PowerShell which can handle admin file access.
  const escaped = content.replace(/'/g, "''").replace(/\n/g, "`n");
  try {
    await executePS(
      `Set-Content -Path '${HOSTS_PATH}' -Value '${escaped}' -Encoding UTF8 -Force`
    );
    // Flush DNS cache so changes take effect immediately.
    await executePS('ipconfig /flushdns');
    return true;
  } catch {
    // Fallback: try direct write (works if app is running as admin).
    try {
      fs.writeFileSync(HOSTS_PATH, content, 'utf-8');
      await executePS('ipconfig /flushdns');
      return true;
    } catch {
      return false;
    }
  }
}

// Block all sites in the blocklist by adding entries to the hosts file.
// Preserves any existing non-Lights-Out entries.
async function blockSites(blocklist) {
  const sites = blocklist && blocklist.length > 0 ? blocklist : DEFAULT_BLOCKLIST;
  let content = readHosts();

  // Remove any existing Lights Out block section first.
  content = removeBlockSection(content);

  // Build the block entries.
  const entries = sites.map(site => `0.0.0.0 ${site}`).join('\n');
  const blockSection = `${MARKER_START}\n${entries}\n${MARKER_END}`;

  // Append the block section.
  content = content.trimEnd() + '\n\n' + blockSection + '\n';

  const success = await writeHosts(content);
  return { success, sites: sites.length, provider: 'hosts' };
}

// Unblock all sites by removing the Lights Out section from the hosts file.
async function unblockSites() {
  let content = readHosts();
  content = removeBlockSection(content);
  const success = await writeHosts(content.trimEnd() + '\n');
  return { success, provider: 'hosts' };
}

// Remove the Lights Out block section from hosts content.
function removeBlockSection(content) {
  const lines = content.split('\n');
  let inBlock = false;
  const result = [];
  for (const line of lines) {
    if (line.trim() === MARKER_START) { inBlock = true; continue; }
    if (line.trim() === MARKER_END) { inBlock = false; continue; }
    if (!inBlock) result.push(line);
  }
  return result.join('\n');
}

// Check if the block is currently active.
function isBlocked() {
  const content = readHosts();
  return content.includes(MARKER_START);
}

// Get the current blocklist (sites in the Lights Out section).
function getActiveBlocklist() {
  const content = readHosts();
  const lines = content.split('\n');
  let inBlock = false;
  const sites = [];
  for (const line of lines) {
    if (line.trim() === MARKER_START) { inBlock = true; continue; }
    if (line.trim() === MARKER_END) { inBlock = false; continue; }
    if (inBlock && line.startsWith('0.0.0.0 ')) {
      sites.push(line.replace('0.0.0.0 ', '').trim());
    }
  }
  return sites;
}

function executePS(command) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    ps.stdout.on('data', data => { output += data.toString(); });
    ps.stderr.on('data', data => { output += data.toString(); });
    ps.on('error', reject);
    ps.on('close', code => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(output.trim() || `PS exit ${code}`));
    });
  });
}

module.exports = {
  blockSites,
  unblockSites,
  isBlocked,
  getActiveBlocklist,
  DEFAULT_BLOCKLIST
};
