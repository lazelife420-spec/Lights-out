'use strict';

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeWifiGuard(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const provider = ['adapter', 'tplink', 'asus', 'netgear', 'webhook'].includes(value.provider) ? value.provider : 'webhook';
  const deviceMacs = Array.isArray(value.deviceMacs) ? value.deviceMacs.filter(Boolean) : [];
  const deviceIps = Array.isArray(value.deviceIps) ? value.deviceIps.filter(Boolean) : [];
  let configured = false;
  let setupError = '';
  if (provider === 'adapter') configured = true;
  else if (provider === 'webhook') {
    configured = validHttpUrl(value.webhookUrl);
    if (!configured) setupError = 'Enter a valid HTTP(S) webhook URL before enabling WiFi Guard.';
  } else {
    configured = Boolean(String(value.routerIp || '').trim() && (deviceMacs.length || deviceIps.length));
    if (!configured) setupError = 'Enter the router address and select at least one device before enabling WiFi Guard.';
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

module.exports = { validHttpUrl, sanitizeWifiGuard, sanitizeContentBlocker, sanitizeAccountability };
