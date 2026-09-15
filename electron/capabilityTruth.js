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

// Router credentials must only be sent to private/link-local/loopback
// destinations. Globally routable IPs are rejected to prevent credential
// exfiltration even when the attacker cannot control DNS resolution.
function isPrivateOrLocal(ip) {
  if (net.isIP(ip) === 0) return false;
  if (net.isIPv4(ip)) {
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
  // IPv6
  const lower = ip.toLowerCase();
  // ::1 (loopback)
  if (lower === '::1') return true;
  // fe80::/10 (link-local)
  if (lower.startsWith('fe80:') || lower.startsWith('fe80%')) return true;
  // fc00::/7 (ULA — unique local addresses, RFC 4193)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
}

function sanitizeWifiGuard(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const provider = ['adapter', 'tplink', 'asus', 'netgear', 'webhook'].includes(value.provider) ? value.provider : 'webhook';
  const deviceMacs = Array.isArray(value.deviceMacs) ? value.deviceMacs.filter(m => typeof m === 'string' && VALID_MAC.test(m.trim())) : [];
  const deviceIps = Array.isArray(value.deviceIps) ? value.deviceIps.filter(ip => typeof ip === 'string' && net.isIP(ip.trim()) !== 0) : [];
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

module.exports = { validHttpUrl, isPrivateOrLocal, sanitizeWifiGuard, sanitizeContentBlocker, sanitizeAccountability };
