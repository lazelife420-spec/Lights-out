'use strict';

const { execFile } = require('node:child_process');

function normalizeCandidateIps(candidateIps) {
  if (!Array.isArray(candidateIps)) return [];
  return [...new Set(candidateIps
    .filter(ip => typeof ip === 'string')
    .map(ip => ip.trim())
    .filter(ip => ip && ip !== '127.0.0.1'))];
}

function selectLanIp(candidateIps, preferredIp = '', routedIp = '') {
  const candidates = normalizeCandidateIps(candidateIps);
  const preferred = typeof preferredIp === 'string' ? preferredIp.trim() : '';
  const routed = typeof routedIp === 'string' ? routedIp.trim() : '';
  // The route-table answer only wins when it is one of the already-filtered
  // LAN candidates — a VPN tunnel or virtual adapter address can never be
  // advertised just because it owns the default route.
  const lanIp = routed && candidates.includes(routed)
    ? routed
    : (preferred && candidates.includes(preferred) ? preferred : (candidates[0] || ''));
  return {
    candidates,
    lanIp,
    hasLanIp: Boolean(lanIp)
  };
}

function networkFingerprint(candidateIps, routedIp = '') {
  return `${String(routedIp || '').trim()}::${normalizeCandidateIps(candidateIps).sort().join('|')}`;
}

// Which local IPv4 owns the best default route, according to the OS route
// table. Unlike the previous outbound-UDP-connect hint this emits no packets
// and does not require Internet reachability — it reads routing metadata.
// Returns '' when no default route exists (e.g. an isolated LAN), which callers
// must treat as "no hint", never as "no LAN".
function getDefaultRouteLanIp() {
  if (process.platform !== 'win32') return Promise.resolve('');
  const ps = [
    "$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue",
    "  | Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' }",
    // Windows prefers the LOWEST SUM of RouteMetric + InterfaceMetric, not a
    // lexicographic two-key sort — the sums are not equivalent orderings.
    '  | Sort-Object -Property @{Expression={$_.RouteMetric + $_.InterfaceMetric}} | Select-Object -First 1;',
    'if ($r) {',
    '  $a = Get-NetIPAddress -InterfaceIndex $r.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue',
    "    | Where-Object { $_.IPAddress -notmatch '^(127\\.|169\\.254\\.)' }",
    '    | Select-Object -First 1;',
    '  if ($a) { $a.IPAddress }',
    '}'
  ].join('\n');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 8000 }, (err, stdout) => {
        if (err) return resolve('');
        const ip = String(stdout || '').trim();
        resolve(/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : '');
      });
  });
}

module.exports = { normalizeCandidateIps, selectLanIp, networkFingerprint, getDefaultRouteLanIp };
