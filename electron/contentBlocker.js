// Content Blocker: blocks distracting websites during wind-down
// by modifying the Windows hosts file. Zero dependencies,
// works for all browsers, brutal and effective.

const fs = require('fs');
const { spawn } = require('child_process');

const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const MARKER_START = '# === LIGHTS OUT BLOCK START ===';
const MARKER_END = '# === LIGHTS OUT BLOCK END ===';

// Each hosts entry is a single label-dotted hostname, optionally with a port-free
// leading wildcard the OS hosts file does not support anyway. Blocklist entries can
// arrive from imported config or the renderer, so anything that is not a clean
// hostname (whitespace, newlines, IPs, shell/hosts-file metacharacters) is dropped
// before it can reach the hosts file or the PowerShell command string.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function sanitizeSites(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const site = raw.trim().toLowerCase();
    if (!HOSTNAME_RE.test(site) || seen.has(site)) continue;
    seen.add(site);
    out.push(site);
  }
  return out;
}

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

// Serialize hosts read-modify-write operations so overlapping callers can never
// clobber each other's changes.
let hostsOpQueue = Promise.resolve();

function enqueueHostsOp(fn) {
  const next = hostsOpQueue.then(fn, fn);
  hostsOpQueue = next.catch(() => {});
  return next;
}

// Read the current hosts file content. Returns null on read error (never ''!)
// so callers can fail closed rather than wiping existing Windows hosts entries.
function readHostsStrict(hostsPath = HOSTS_PATH, fileSystem = fs) {
  try {
    return fileSystem.readFileSync(hostsPath, 'utf-8');
  } catch {
    return null;
  }
}

// Read-only convenience helper for status inspection.
function readHosts() {
  const raw = readHostsStrict();
  return raw === null ? '' : raw;
}

function escapePowerShellSingleQuoted(str) {
  // Windows PowerShell 5.1 treats Unicode smart single quotes (U+2018-U+201B)
  // as single-quote delimiters alongside ASCII apostrophe (U+0027).
  return String(str).replace(/['\u2018\u2019\u201A\u201B]/g, ch => ch + ch);
}

// Build the PowerShell command that writes `content` to the hosts file. Pure
// (no process spawn) so the escaping can be unit tested. Content is passed as
// base64 rather than interpolated into a quoted string: base64's alphabet
// ([A-Za-z0-9+/=]) contains no quotes, backticks, or newlines, so this can
// never be broken out of regardless of what the (already-sanitized) blocklist
// or pre-existing hosts file content contains.
function buildWriteHostsCommand(content, hostsPath = HOSTS_PATH) {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const safePath = escapePowerShellSingleQuoted(hostsPath);
  return `$bytes = [System.Convert]::FromBase64String('${b64}'); [System.IO.File]::WriteAllBytes('${safePath}', $bytes)`;
}

// Write the hosts file (requires admin, so we use PowerShell with elevation).
async function writeHosts(content, {
  hostsPath = HOSTS_PATH,
  runCommand = executePS,
  fileSystem = fs
} = {}) {
  // Write via PowerShell which can handle admin file access.
  let wrote = false;
  try {
    await runCommand(buildWriteHostsCommand(content, hostsPath));
    wrote = true;
  } catch {
    // Fallback: try direct write (works if app is running as admin).
    try {
      fileSystem.writeFileSync(hostsPath, content, 'utf-8');
      wrote = true;
    } catch {
      return false;
    }
  }
  if (wrote) {
    // Best-effort DNS cache flush: a disabled DNS Client service must not
    // cause a confirmed hosts write to report failure or double-write.
    try { await runCommand('ipconfig /flushdns'); } catch { /* best-effort */ }
  }
  return wrote;
}

// Block all sites in the blocklist by adding entries to the hosts file.
// Preserves any existing non-Lights-Out entries.
async function blockSites(blocklist, ioOpts = {}) {
  return enqueueHostsOp(async () => {
    // Validate every entry up front so a crafted hostname (e.g. one containing a
    // newline + arbitrary IP mapping) can never be written into the hosts file,
    // including via the direct-write fallback in writeHosts.
    const requested = sanitizeSites(blocklist);
    const sites = requested.length > 0 ? requested : DEFAULT_BLOCKLIST;
    const hostsPath = ioOpts.hostsPath || HOSTS_PATH;
    const fileSystem = ioOpts.fileSystem || fs;
    const existing = readHostsStrict(hostsPath, fileSystem);
    if (existing === null) {
      return {
        success: false,
        sites: 0,
        provider: 'hosts',
        error: 'Could not read existing hosts file; refusing to overwrite.'
      };
    }

    // Remove any existing Lights Out block section first.
    let content = removeBlockSection(existing);

    // Build the block entries.
    const entries = sites.map(site => `0.0.0.0 ${site}`).join('\n');
    const blockSection = `${MARKER_START}\n${entries}\n${MARKER_END}`;

    // Append the block section.
    content = content.trimEnd() + '\n\n' + blockSection + '\n';

    const success = await writeHosts(content, ioOpts);
    return {
      success,
      sites: sites.length,
      provider: 'hosts',
      error: success ? '' : 'Hosts file update was denied or unavailable; no block was confirmed.'
    };
  });
}

// Unblock all sites by removing the Lights Out section from the hosts file.
async function unblockSites(ioOpts = {}) {
  return enqueueHostsOp(async () => {
    const hostsPath = ioOpts.hostsPath || HOSTS_PATH;
    const fileSystem = ioOpts.fileSystem || fs;
    const existing = readHostsStrict(hostsPath, fileSystem);
    if (existing === null) {
      return {
        success: false,
        provider: 'hosts',
        error: 'Could not read existing hosts file; refusing to overwrite.'
      };
    }
    if (!existing.includes(MARKER_START)) {
      return { success: true, provider: 'hosts', error: '' };
    }
    const content = removeBlockSection(existing);
    const success = await writeHosts(content.trimEnd() + '\n', ioOpts);
    return {
      success,
      provider: 'hosts',
      error: success ? '' : 'Hosts file update was denied or unavailable; no unblock was confirmed.'
    };
  });
}

// Remove the Lights Out block section from hosts content.
// Requires both start and end markers so a corrupted missing end marker never
// truncates unrelated entries to EOF.
function removeBlockSection(content) {
  const lines = content.split('\n');
  const startIdx = lines.findIndex(line => line.trim() === MARKER_START);
  if (startIdx === -1) return content;
  const endIdx = lines.findIndex((line, idx) => idx > startIdx && line.trim() === MARKER_END);
  if (endIdx === -1) {
    // Only drop the orphaned marker line and consecutive 0.0.0.0 lines immediately following it.
    let stop = startIdx + 1;
    while (stop < lines.length && lines[stop].trim().startsWith('0.0.0.0 ')) stop++;
    return [...lines.slice(0, startIdx), ...lines.slice(stop)].join('\n');
  }
  const rest = [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)].join('\n');
  return rest.includes(MARKER_START) ? removeBlockSection(rest) : rest;
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

// ─────────────────────────────────────────────────────────────────────────────
// Recurring blocking schedules -- independent of the shutdown timer's own
// dim-phase blocking. Pure (no I/O), so overnight-window edge cases can be
// unit tested against a fixed `now` instead of waiting for the real clock.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function timeToMinutes(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// Whether a single schedule is active at `now`. Handles windows that cross
// midnight (e.g. 22:00-07:00), which is the common case for a bedtime
// blocking schedule and the reason this can't just compare against today's
// day-of-week alone.
function isScheduleActive(schedule, now = new Date()) {
  if (!schedule || schedule.enabled === false) return false;
  const rawDays = Array.isArray(schedule.days) && schedule.days.length ? schedule.days : DAY_KEYS;
  const days = rawDays.map(d => String(d || '').trim().toLowerCase());
  const startMin = timeToMinutes(schedule.startTime);
  const endMin = timeToMinutes(schedule.endTime);
  if (startMin === null || endMin === null || startMin === endMin) return false; // malformed or zero-length

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayKey = DAY_KEYS[now.getDay()];

  if (startMin < endMin) {
    // Same-day window, e.g. 13:00-17:00.
    return days.includes(todayKey) && nowMin >= startMin && nowMin < endMin;
  }
  // Overnight window, e.g. 22:00-07:00: active either from startMin to
  // midnight on a scheduled day, or from midnight to endMin the morning
  // after a scheduled day.
  const yesterdayKey = DAY_KEYS[(now.getDay() + 6) % 7];
  return (days.includes(todayKey) && nowMin >= startMin) ||
         (days.includes(yesterdayKey) && nowMin < endMin);
}

function isAnyScheduleActive(schedules, now = new Date()) {
  return Array.isArray(schedules) && schedules.some(s => isScheduleActive(s, now));
}

function executePS(command, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(val);
    };
    const timer = setTimeout(() => {
      try { ps.kill(); } catch {}
      finish(new Error('PowerShell timeout'));
    }, timeoutMs);
    timer.unref();
    ps.stdout.on('data', data => { stdout += data.toString(); });
    ps.stderr.on('data', data => { stderr += data.toString(); });
    ps.on('error', err => finish(err));
    ps.on('close', code => {
      if (code === 0) finish(null, stdout.trim());
      else finish(new Error(stderr.trim() || stdout.trim() || `PS exit ${code}`));
    });
  });
}

module.exports = {
  blockSites,
  unblockSites,
  isBlocked,
  getActiveBlocklist,
  DEFAULT_BLOCKLIST,
  isScheduleActive,
  isAnyScheduleActive,
  // Exposed for unit testing of the hosts-injection guard.
  __sanitizeSites: sanitizeSites,
  // Exposed for unit testing the hosts-file write command builder.
  __buildWriteHostsCommand: buildWriteHostsCommand,
  __removeBlockSection: removeBlockSection,
  // Controlled isolated-target permission harness; production callers use HOSTS_PATH.
  __writeHosts: writeHosts
};
