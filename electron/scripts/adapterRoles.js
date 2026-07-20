'use strict';

const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// Role-based adapter selection for network test tooling. An adapter's
// Windows display name ("Wi-Fi", "Wi-Fi 2", ...) is an arbitrary label, not
// a network fact, and must never be compared against a literal string to
// decide which adapter is "the" connected one -- that assumption breaks the
// instant two machines (or one machine on two days) enumerate adapters in a
// different order. discoverAdapterRoles() classifies by observed state
// (operational status, usable IPv4, virtual-adapter keyword, default-route
// membership) instead, mirroring the same criteria family.js's
// filterAndRankLocalIPs() already uses for production LAN-IP selection.
//
// Pure function: no I/O, no process spawning, no network mutation. Safe to
// unit-test directly with literal synthetic inventories.

const VIRTUAL_KEYWORDS = /vEthernet|Virtual|VMware|VirtualBox|Hyper-V|WSL|Docker|Tailscale|ZeroTier|hamachi/i;
const LOOPBACK_NAME = /loopback/i;

function isUsableIPv4(ip) {
  return typeof ip === 'string' && ip.length > 0 && !ip.startsWith('127.') && !ip.startsWith('169.254.');
}

function isUp(status) {
  return status === 'connected' || status === 'up';
}

function isLoopback(a) {
  return LOOPBACK_NAME.test(a.name || '');
}

// inventory: array of { name, index, status, ipv4, isVirtual, hasDefaultRoute }
// - name:            OS display name. Carried through for reporting only --
//                     never read by the classification logic below.
// - index:            interface index (or any stable per-adapter identifier).
// - status:          'connected' | 'disconnected' | 'up' | 'down' | 'unknown'.
// - ipv4:            assigned non-loopback/link-local IPv4, or null.
// - isVirtual:        true for vEthernet/VM/tunnel adapters.
// - hasDefaultRoute:  true if this adapter's IP is the OS's routed-egress IP.
function discoverAdapterRoles(inventory) {
  const list = (Array.isArray(inventory) ? inventory : []).filter(a => a && !isLoopback(a));

  const connectedCandidates = list
    .filter(a => isUp(a.status) && isUsableIPv4(a.ipv4))
    .slice()
    .sort((a, b) => {
      // Physical wins over virtual; virtual is only ever selected when no
      // physical candidate exists at all.
      const virtualDiff = Number(Boolean(a.isVirtual)) - Number(Boolean(b.isVirtual));
      if (virtualDiff !== 0) return virtualDiff;
      // Among remaining candidates, the default-route adapter wins.
      const routeDiff = Number(Boolean(b.hasDefaultRoute)) - Number(Boolean(a.hasDefaultRoute));
      if (routeDiff !== 0) return routeDiff;
      return 0;
    });

  // Prefer a genuinely-disconnected physical adapter as the representative
  // "disconnected" example over e.g. a virtual switch that merely lacks an
  // IP right now -- both qualify by definition, but the former is the
  // meaningful one to report and assert against.
  const disconnectedCandidates = list
    .filter(a => !isUp(a.status) || !isUsableIPv4(a.ipv4))
    .slice()
    .sort((a, b) => {
      const statusDiff = Number(isUp(a.status)) - Number(isUp(b.status));
      if (statusDiff !== 0) return statusDiff;
      const virtualDiff = Number(Boolean(a.isVirtual)) - Number(Boolean(b.isVirtual));
      if (virtualDiff !== 0) return virtualDiff;
      return 0;
    });

  return {
    connectedAdapter: connectedCandidates[0] || null,
    disconnectedAdapter: disconnectedCandidates[0] || null
  };
}

// Real-machine adapter inventory (Windows only). Strictly observational:
// `netsh interface ipv4 show interfaces` lists index/state/name,
// os.networkInterfaces() supplies each name's assigned IPv4 (Node uses the
// same adapter display name Windows does), and the optional getRoutedLanIp
// probe (the existing production companionNetwork.getRoutedLanIp -- an
// outbound UDP connect(), never sent) tags whichever IP the OS would
// actually route egress traffic through. No connect/disconnect/enable/
// disable call is issued anywhere in this function.
async function readWindowsAdapterInventory({ getRoutedLanIp } = {}) {
  const { stdout } = await execFileAsync(
    'netsh.exe', ['interface', 'ipv4', 'show', 'interfaces'],
    { timeout: 15000, windowsHide: true }
  );
  const dataLines = stdout.split(/\r?\n/).filter(line => /^\s*\d+\s/.test(line));
  const osIfaces = os.networkInterfaces();
  const routedIp = getRoutedLanIp ? (await getRoutedLanIp()) || '' : '';

  return dataLines.map(line => {
    const cols = line.trim().split(/\s+/);
    const index = Number(cols[0]);
    const status = (cols[3] || '').toLowerCase();
    const name = cols.slice(4).join(' ');
    const addresses = (osIfaces[name] || []).filter(entry => entry.family === 'IPv4' && !entry.internal);
    const ipv4 = addresses.length ? addresses[0].address : null;
    return {
      name,
      index,
      status,
      ipv4,
      isVirtual: VIRTUAL_KEYWORDS.test(name),
      hasDefaultRoute: Boolean(ipv4 && routedIp && ipv4 === routedIp)
    };
  });
}

module.exports = { discoverAdapterRoles, readWindowsAdapterInventory, isUsableIPv4, VIRTUAL_KEYWORDS };
