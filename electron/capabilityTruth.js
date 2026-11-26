'use strict';

const net = require('net');

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const VALID_MAC = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

function isPrivateOrLocalIpv4(ip) {
  if (!net.isIPv4(ip)) return false;
  const parts = ip.split('.').map(Number);
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (parts[0] === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

// Expand a valid IPv6 literal into eight 16-bit integer groups so prefix tests
// operate on true bitmasks (preventing short-hextet bypasses like `fc::1` = 00fc::1).
function parseIpv6Groups(rawIp) {
  const ip = String(rawIp || '').split('%')[0].toLowerCase();
  if (!net.isIPv6(ip)) return null;
  let work = ip;
  // Convert embedded IPv4 tail (e.g. ::ffff:192.168.0.1) into two 16-bit hex groups.
  const lastColon = work.lastIndexOf(':');
  if (lastColon !== -1 && work.slice(lastColon + 1).includes('.')) {
    const v4 = work.slice(lastColon + 1);
    if (!net.isIPv4(v4)) return null;
    const p = v4.split('.').map(Number);
    const hi = ((p[0] << 8) | p[1]).toString(16);
    const lo = ((p[2] << 8) | p[3]).toString(16);
    work = work.slice(0, lastColon + 1) + hi + ':' + lo;
  }
  const halves = work.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 0) return null;
  const full = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (full.length !== 8) return null;
  const groups = full.map(seg => parseInt(seg, 16));
  return groups.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

// Router credentials must only be sent to private/link-local/loopback
// destinations. Globally routable IPs are rejected to prevent credential
// exfiltration even when the attacker cannot control DNS resolution.
function isPrivateOrLocal(ip) {
  if (typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  const base = trimmed.split('%')[0];
  if (net.isIP(base) === 0) return false;
  if (net.isIPv4(base)) return isPrivateOrLocalIpv4(base);

  const g = parseIpv6Groups(trimmed);
  if (!g) return false;
  // ::1 (loopback)
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) {
    return true;
  }
  // IPv4-mapped ::ffff:a.b.c.d -> defer to IPv4 private/local check
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const v4 = `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`;
    return isPrivateOrLocalIpv4(v4);
  }
  // fe80::/10 (link-local: 0xfe80..0xfebf)
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  // fc00::/7 (ULA — unique local addresses, RFC 4193: 0xfc00..0xfdff)
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  return false;
}

function formatHostForUrl(ip) {
  const s = String(ip || '').trim();
  return net.isIPv6(s.split('%')[0]) ? `[${s}]` : s;
}

function sanitizeWifiGuard(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const provider = ['adapter', 'tplink', 'asus', 'netgear', 'webhook'].includes(value.provider) ? value.provider : 'webhook';
  const deviceMacs = Array.isArray(value.deviceMacs)
    ? value.deviceMacs.filter(m => typeof m === 'string' && VALID_MAC.test(m.trim())).map(m => m.trim())
    : [];
  const deviceIps = Array.isArray(value.deviceIps)
    ? value.deviceIps.filter(ip => typeof ip === 'string' && net.isIP(ip.trim()) !== 0).map(ip => ip.trim())
    : [];
  let configured = false;
  let setupError = '';
  if (provider === 'adapter') configured = true;
  else if (provider === 'webhook') {
    configured = validHttpUrl(value.webhookUrl);
    if (!configured) setupError = 'Enter a valid HTTP(S) webhook URL before enabling WiFi Guard.';
  } else {
    const routerIpRaw = String(value.routerIp || '').trim();
    const routerIpIsIp = net.isIP(routerIpRaw) !== 0;
    const routerIpValid = routerIpIsIp && isPrivateOrLocal(routerIpRaw);
    configured = Boolean(routerIpValid && (deviceMacs.length || deviceIps.length));
    if (routerIpRaw && !routerIpIsIp) setupError = 'Router address must be a valid IP address (not a hostname). Example: 192.168.0.1';
    else if (routerIpRaw && routerIpIsIp && !routerIpValid) setupError = 'Router address must be a private/local network address (e.g. 192.168.x.x, 10.x.x.x). Public IPs are not accepted.';
    else if (!configured) setupError = 'Enter the router IP address and select at least one device before enabling WiFi Guard.';
  }
  return { ...value, provider, deviceMacs, deviceIps, enabled: Boolean(value.enabled && configured), configured, setupError };
}

function sanitizeContentBlocker(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const blocklist = Array.isArray(value.blocklist) ? value.blocklist.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
  const useDefault = value.useDefault !== false;
  const configured = useDefault || blocklist.length > 0;
  return {
    ...value,
    blocklist,
    useDefault,
    enabled: Boolean(value.enabled && configured),
    configured,
    setupError: configured ? '' : 'Choose the default blocklist or add at least one site before enabling Content Blocker.'
  };
}

function sanitizeAccountability(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const partners = Array.isArray(value.partners)
    ? value.partners.filter(partner => partner && partner.type === 'webhook' && validHttpUrl(partner.url))
    : [];
  const configured = partners.length > 0;
  return {
    ...value,
    partners,
    enabled: Boolean(value.enabled && configured),
    configured,
    setupError: configured ? '' : 'Enter a valid partner webhook URL before enabling accountability notifications.'
  };
}

module.exports = { validHttpUrl, isPrivateOrLocal, formatHostForUrl, sanitizeWifiGuard, sanitizeContentBlocker, sanitizeAccountability };
