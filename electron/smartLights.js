// Smart Lights Module for Lights Out Electron
// Shipped providers: Philips Hue Bridge (local HTTP control), Generic HTTP webhook.
// MQTT / Home Assistant / IFTTT were advertised in earlier revisions but were
// never reachable through the live config path (configurationKey() never
// produced a key for them, so loadConfig could never enable them). They are
// deliberately not part of the shipped provider surface — re-adding one means
// wiring config, verification, credentials-at-rest, and runtime end to end.

const https = require('https');
const http = require('http');
const net = require('net');
const dgram = require('dgram');

const SHIPPED_PROVIDERS = ['none', 'hue', 'http'];

// Configuration state. Only fields for shipped providers live here; unknown
// persisted keys are pruned by loadConfig.
let config = {
  provider: 'none',        // 'none', 'hue', 'http'
  mode: 'gradual_dim',     // 'gradual_dim', 'warm_dim', 'off_at_end'
  dimMinutes: 10,          // minutes before end to start dimming
  enabled: false,
  // Hue settings
  hueBridgeIp: '',
  hueUsername: '',
  hueLightIds: [],         // array of light IDs (empty = all)
  hueGroupId: '',          // group/room ID (optional)
  // HTTP settings
  httpUrl: '',
  httpMethod: 'POST',
  httpHeaders: {},
  httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "color_temp": {{COLOR_TEMP}}, "on": {{ON}}}',
  verifiedConfigKey: ''
};

// Secret-bearing config fields → renderer-safe presence indicators.
// getPublicConfig() drops each secret and sets its indicator instead.
const SECRET_INDICATORS = {
  hueUsername: 'hasHueCredential',
  httpHeaders: 'hasHttpHeaders'
};

function configurationKey(value = config) {
  const provider = value.provider || 'none';
  if (provider === 'hue') return `hue:${value.hueBridgeIp || ''}:${value.hueUsername || ''}:${value.hueGroupId || ''}`;
  if (provider === 'http') return `http:${value.httpMethod || 'POST'}:${value.httpUrl || ''}:${value.httpBodyTemplate || ''}`;
  return '';
}

// Runtime state
let state = {
  dimStarted: false,
  originalLightState: null,  // [{id, on, bri, ct}] captured at dim start (Hue)
  dimStartTime: null,
  dimDurationMs: 0
};

function result(provider, success, code, message, extra = {}) {
  return { provider, success, code, message, ...extra };
}

function failure(provider, code, message) {
  return result(provider, false, code, message);
}

// fetch() does not honor a `timeout` RequestInit — bound every outbound call
// with AbortSignal so a blackholed endpoint fails truthfully.
function fetchBounded(url, options = {}, timeoutMs = 5000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hue Bridge Discovery & Registration
// ─────────────────────────────────────────────────────────────────────────────

// Parse an SSDP response/location pair into a candidate bridge address, or null.
// Hue v1 bridges answer M-SEARCH with a LOCATION pointing at description.xml.
function parseSsdpLocation(raw) {
  const text = String(raw || '');
  const match = text.match(/^LOCATION:\s*(https?:\/\/[^\s]+)/im);
  return match ? match[1].trim() : '';
}

// Decide whether a fetched bridge descriptor really is a Philips Hue bridge.
function isHueBridgeDescriptor(xml) {
  const text = String(xml || '');
  return /philips\s+hue/i.test(text) || /<modelName>[^<]*hue[^<]*<\/modelName>/i.test(text);
}

// LAN-native discovery: SSDP M-SEARCH multicast, then verify each responder by
// fetching its UPnP description and looking for the Hue model marker. No
// Internet route required — multicast never leaves the LAN.
function discoverHueBridgeLocal(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const found = new Map();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      resolve(value);
    };

    socket.on('message', async (msg) => {
      const location = parseSsdpLocation(msg.toString());
      if (!location) return;
      let host;
      try { host = new URL(location).hostname; } catch { return; }
      if (!net.isIP(host) || found.has(host)) return;
      found.set(host, true);
      try {
        const res = await fetchBounded(location, {}, 2500);
        const xml = await res.text();
        if (isHueBridgeDescriptor(xml)) done({ ip: host, source: 'ssdp' });
      } catch { /* not a Hue responder */ }
    });
    socket.on('error', () => done(null));

    socket.bind(0, () => {
      try {
        const query = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n' +
          'HOST: 239.255.255.250:1900\r\n' +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 2\r\n' +
          'ST: urn:schemas-upnp-org:device:basic:1\r\n\r\n'
        );
        socket.send(query, 0, query.length, 1900, '239.255.255.250');
      } catch { done(null); }
    });
    setTimeout(() => done(null), timeoutMs).unref?.();
  });
}

// Cloud-assisted discovery — optional fallback only. Returns source:'cloud' so
// callers/UI can distinguish it from LAN discovery.
async function discoverHueBridgeCloud() {
  try {
    const response = await fetchBounded('https://discovery.meethue.com', {}, 5000);
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0 && data[0].internalipaddress) {
      return { ip: data[0].internalipaddress, id: data[0].id, source: 'cloud' };
    }
  } catch (error) {
    console.error('Hue cloud discovery failed:', error.message);
  }
  return null;
}

// Discovery order: LAN SSDP first, cloud only as a labeled fallback.
async function findHueBridge() {
  const local = await discoverHueBridgeLocal().catch(() => null);
  if (local) return local;
  return discoverHueBridgeCloud();
}

async function registerHueBridge(bridgeIp) {
  try {
    const response = await fetchBounded(`http://${bridgeIp}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devicetype: 'LightsOut#SleepTimer' })
    }, 10000);
    const data = await response.json();
    if (data[0]?.success?.username) {
      return { username: data[0].success.username };
    }
    if (data[0]?.error) {
      return { error: data[0].error.description };
    }
  } catch (error) {
    return { error: error.message };
  }
  return null;
}

// Hue read helpers return { success, ... } — transport failures are truthful,
// never silently converted into an empty list that looks like "no lights".
async function getHueLights(bridgeIp, username) {
  try {
    const response = await fetchBounded(`http://${bridgeIp}/api/${username}/lights`, {}, 5000);
    if (!response.ok) return failure('hue', 'HTTP_' + response.status, `Bridge returned HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return failure('hue', 'INVALID_RESPONSE', 'Unexpected bridge response');
    }
    const lights = [];
    for (const [id, light] of Object.entries(data)) {
      if (!light || !light.state) continue;
      lights.push({
        id: id,
        name: light.name,
        on: Boolean(light.state.on),
        bri: light.state.bri || 0,
        ct: light.state.ct || 0,
        type: light.type
      });
    }
    return result('hue', true, 'OK', `${lights.length} lights`, { lights });
  } catch (error) {
    return failure('hue', error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', error.message);
  }
}

async function getHueGroups(bridgeIp, username) {
  try {
    const response = await fetchBounded(`http://${bridgeIp}/api/${username}/groups`, {}, 5000);
    if (!response.ok) return failure('hue', 'HTTP_' + response.status, `Bridge returned HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return failure('hue', 'INVALID_RESPONSE', 'Unexpected bridge response');
    }
    const groups = [];
    for (const [id, group] of Object.entries(data)) {
      groups.push({ id: id, name: group.name, type: group.type, lights: group.lights });
    }
    return result('hue', true, 'OK', `${groups.length} groups`, { groups });
  } catch (error) {
    return failure('hue', error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', error.message);
  }
}

async function setHueLightState(bridgeIp, username, lightId, lightState) {
  try {
    const response = await fetchBounded(`http://${bridgeIp}/api/${username}/lights/${lightId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lightState)
    }, 5000);
    if (!response.ok) return failure('hue', 'HTTP_' + response.status, `Light ${lightId} returned HTTP ${response.status}`);
    const data = await response.json();
    if (Array.isArray(data) && data.some(e => e && e.error)) {
      return failure('hue', 'BRIDGE_ERROR', data.find(e => e.error).error.description || 'Bridge rejected the state');
    }
    return result('hue', true, 'OK', `Light ${lightId} updated`);
  } catch (error) {
    return failure('hue', error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', error.message);
  }
}

async function setHueGroupState(bridgeIp, username, groupId, groupState) {
  try {
    const response = await fetchBounded(`http://${bridgeIp}/api/${username}/groups/${groupId}/action`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(groupState)
    }, 5000);
    if (!response.ok) return failure('hue', 'HTTP_' + response.status, `Group ${groupId} returned HTTP ${response.status}`);
    const data = await response.json();
    if (Array.isArray(data) && data.some(e => e && e.error)) {
      return failure('hue', 'BRIDGE_ERROR', data.find(e => e.error).error.description || 'Bridge rejected the state');
    }
    return result('hue', true, 'OK', `Group ${groupId} updated`);
  } catch (error) {
    return failure('hue', error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', error.message);
  }
}

// Snapshot the current state of every light that is ON so a later cancel can
// put them back exactly where they were.
async function saveHueCurrentState(bridgeIp, username) {
  const res = await getHueLights(bridgeIp, username);
  if (res.success && Array.isArray(res.lights)) {
    state.originalLightState = res.lights
      .filter(l => l.on)
      .map(l => ({ id: l.id, on: true, bri: l.bri, ct: l.ct }));
  }
}

// Replay a captured snapshot onto a bridge. Pure w.r.t. module state — the
// caller owns the snapshot. Truthful per-light results; never throws.
async function restoreLightSnapshot(bridgeIp, username, snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return result('hue', true, 'NOTHING_TO_RESTORE', 'No captured light state');
  }
  if (!bridgeIp || !username) {
    return failure('hue', 'NOT_CONFIGURED', 'Hue not configured — captured state discarded');
  }
  const failed = [];
  for (const light of snapshot) {
    const body = { on: true, bri: light.bri, transitiontime: 10 };
    if (light.ct) body.ct = light.ct;
    const res = await setHueLightState(bridgeIp, username, light.id, body);
    if (!res.success) failed.push(light.id);
  }
  if (failed.length) {
    return failure('hue', 'RESTORE_PARTIAL', `Could not restore ${failed.length} light(s): ${failed.join(', ')}`);
  }
  return result('hue', true, 'RESTORED', `Restored ${snapshot.length} light(s)`);
}

// Restore the snapshot captured at dim start. Returns a truthful result —
// restoration failure is surfaced, never hidden, and never throws.
async function restoreHueOriginalState() {
  const snapshot = state.originalLightState;
  state.originalLightState = null;
  return restoreLightSnapshot(config.hueBridgeIp, config.hueUsername, snapshot);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Webhook
// ─────────────────────────────────────────────────────────────────────────────

// Trust model: the webhook is a user-configured LAN automation endpoint, so
// private/localhost targets are allowed by design. What is enforced: http(s)
// scheme only, method allowlist, bounded response, bounded timeout.
const HTTP_METHODS = ['GET', 'POST', 'PUT'];
const HTTP_MAX_RESPONSE = 64 * 1024;

function validateHttpTarget(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return { error: 'Invalid webhook URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Webhook URL must be http:// or https://' };
  }
  return { url };
}

async function invokeHttpLightAction(brightness = 254, colorTemp = 366, on = true) {
  if (!config.httpUrl) return failure('http', 'NOT_CONFIGURED', 'No webhook URL configured');
  const target = validateHttpTarget(config.httpUrl);
  if (target.error) return failure('http', 'INVALID_URL', target.error);
  const url = target.url;
  const method = HTTP_METHODS.includes(String(config.httpMethod).toUpperCase())
    ? String(config.httpMethod).toUpperCase() : 'POST';

  const bodyStr = config.httpBodyTemplate
    .replace(/\{\{BRIGHTNESS\}\}/g, brightness)
    .replace(/\{\{COLOR_TEMP\}\}/g, colorTemp)
    .replace(/\{\{ON\}\}/g, on ? 'true' : 'false');

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...config.httpHeaders
    },
    timeout: 5000
  };

  const client = url.protocol === 'https:' ? https : http;
  try {
    await new Promise((resolve, reject) => {
      const req = client.request(options, (res) => {
        let data = '';
        let tooBig = false;
        res.on('data', chunk => {
          if (tooBig) return;
          data += chunk;
          if (data.length > HTTP_MAX_RESPONSE) { tooBig = true; req.destroy(); }
        });
        res.on('end', () => {
          if (tooBig) return reject(new Error('Webhook response too large'));
          if (res.statusCode >= 400) {
            return reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
          }
          resolve();
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(bodyStr);
      req.end();
    });
  } catch (error) {
    return failure('http', 'TRANSPORT_ERROR', error.message);
  }
  return result('http', true, 'OK', `Sent ${method} to ${url.hostname}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer Integration
// ─────────────────────────────────────────────────────────────────────────────

function startSmartLightDim(remainingSeconds) {
  if (!config.enabled || state.dimStarted) return;

  state.dimStarted = true;
  state.dimStartTime = Date.now();
  state.dimDurationMs = Math.min(remainingSeconds, config.dimMinutes * 60) * 1000;

  if (config.provider === 'hue' && config.hueBridgeIp && config.hueUsername) {
    // Fire-and-forget snapshot; dim ticks proceed even if the snapshot is slow.
    saveHueCurrentState(config.hueBridgeIp, config.hueUsername)
      .catch(() => {});
  }
}

function updateSmartLightTick(remainingSeconds) {
  if (!config.enabled || !state.dimStarted) return;
  if (config.mode === 'off_at_end') return;

  const elapsedMs = Date.now() - state.dimStartTime;
  const progress = Math.min(1.0, Math.max(0.0, elapsedMs / state.dimDurationMs));

  // Calculate target brightness (254 -> 0)
  const targetBri = Math.round(254 * (1.0 - progress));

  // Calculate color temp for warm_dim mode (neutral 366 -> warm 500)
  const targetCt = config.mode === 'warm_dim'
    ? Math.round(366 + (134 * progress))
    : 366;

  // Transition time in 100ms units (smooth 1-second steps = 10)
  const transition = 10;

  switch (config.provider) {
    case 'hue': {
      const lightState = { bri: targetBri, transitiontime: transition };
      if (config.mode === 'warm_dim') lightState.ct = targetCt;
      if (targetBri <= 0) lightState.on = false;

      if (config.hueGroupId) {
        setHueGroupState(config.hueBridgeIp, config.hueUsername, config.hueGroupId, lightState)
          .catch(() => {});
      } else {
        const ids = config.hueLightIds.length > 0
          ? config.hueLightIds
          : (state.originalLightState || []).map(l => l.id);
        for (const id of ids) {
          setHueLightState(config.hueBridgeIp, config.hueUsername, id, lightState)
            .catch(() => {});
        }
      }
      break;
    }
    case 'http': {
      invokeHttpLightAction(targetBri, targetCt, targetBri > 0)
        .catch(() => {});
      break;
    }
  }
}

async function invokeSmartLightAction({ on = true, brightness = 254, colorTemp = 366, transitionTime = 10 } = {}) {
  if (!config.enabled) return failure(config.provider || 'none', 'DISABLED', 'Smart Lights not enabled');

  const targetBri = Math.max(0, Math.min(254, Math.round(Number(brightness) || 0)));
  const targetCt = Math.max(153, Math.min(500, Math.round(Number(colorTemp) || 366)));
  const hueState = {
    on: Boolean(on) && targetBri > 0,
    bri: targetBri,
    transitiontime: Math.max(0, Math.round(Number(transitionTime) || 0))
  };
  if (targetCt) hueState.ct = targetCt;

  switch (config.provider) {
    case 'hue': {
      if (!config.hueBridgeIp || !config.hueUsername) {
        return failure('hue', 'NOT_CONFIGURED', 'Hue bridge/credential not configured');
      }
      if (config.hueGroupId) {
        return setHueGroupState(config.hueBridgeIp, config.hueUsername, config.hueGroupId, hueState);
      }
      let ids = config.hueLightIds.length > 0 ? [...config.hueLightIds] : [];
      if (ids.length === 0) {
        const res = await getHueLights(config.hueBridgeIp, config.hueUsername);
        if (!res.success) return res;
        ids = res.lights.map(light => light.id);
      }
      const results = await Promise.all(ids.map(id => setHueLightState(config.hueBridgeIp, config.hueUsername, id, hueState)));
      const failedCount = results.filter(r => !r.success).length;
      if (failedCount === results.length && results.length > 0) {
        return failure('hue', 'ALL_FAILED', `All ${failedCount} light updates failed`);
      }
      if (failedCount > 0) {
        return failure('hue', 'PARTIAL', `${failedCount} of ${results.length} light updates failed`);
      }
      return result('hue', true, 'OK', `${results.length} light(s) updated`);
    }
    case 'http':
      return invokeHttpLightAction(targetBri, targetCt, Boolean(on) && targetBri > 0);
    default:
      return failure(config.provider || 'none', 'NO_PROVIDER', 'No supported provider configured');
  }
}

async function applyScene(sceneId) {
  switch (String(sceneId || '').toLowerCase()) {
    case 'night':
      return invokeSmartLightAction({ on: true, brightness: 48, colorTemp: 460, transitionTime: 20 });
    case 'dim':
      return invokeSmartLightAction({ on: true, brightness: 96, colorTemp: 410, transitionTime: 15 });
    case 'off':
      return invokeSmartLightOff();
    default:
      return invokeSmartLightAction({});
  }
}

async function invokeSmartLightOff() {
  if (!config.enabled) return failure(config.provider || 'none', 'DISABLED', 'Smart Lights not enabled');

  let res;
  switch (config.provider) {
    case 'hue': {
      const lightState = { on: false, transitiontime: 10 };
      if (config.hueGroupId) {
        res = await setHueGroupState(config.hueBridgeIp, config.hueUsername, config.hueGroupId, lightState);
      } else {
        const ids = config.hueLightIds.length > 0
          ? config.hueLightIds
          : (state.originalLightState || []).map(l => l.id);
        const results = [];
        for (const id of ids) {
          results.push(await setHueLightState(config.hueBridgeIp, config.hueUsername, id, lightState));
        }
        const failedCount = results.filter(r => !r.success).length;
        res = failedCount === 0
          ? result('hue', true, 'OK', 'Lights off')
          : failure('hue', failedCount === results.length && results.length ? 'ALL_FAILED' : 'PARTIAL', `${failedCount} of ${results.length} lights failed to turn off`);
      }
      break;
    }
    case 'http': {
      res = await invokeHttpLightAction(0, 366, false);
      break;
    }
    default:
      res = failure(config.provider || 'none', 'NO_PROVIDER', 'No supported provider configured');
  }
  state.dimStarted = false;
  return res;
}

function resetSmartLightState() {
  state.dimStarted = false;
  state.originalLightState = null;
  state.dimStartTime = null;
  state.dimDurationMs = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification vs actuation
//
// verifySmartLightConnection() is PASSIVE: it must never change a light.
// testSmartLightAction() is the explicit actuating operation — it sends a real
// command and only a real success can produce verifiedConfigKey.
// ─────────────────────────────────────────────────────────────────────────────

async function verifySmartLightConnection() {
  switch (config.provider) {
    case 'hue': {
      if (!config.hueBridgeIp || !config.hueUsername) {
        return failure('hue', 'NOT_CONFIGURED', 'Hue Bridge not configured');
      }
      const res = await getHueLights(config.hueBridgeIp, config.hueUsername);
      if (!res.success) return res;
      if (res.lights.length === 0) {
        return failure('hue', 'NO_LIGHTS', 'No lights found - check bridge IP/username');
      }
      return result('hue', true, 'VERIFIED', `Connected: ${res.lights.length} lights found`,
        { verifiedConfigKey: configurationKey() });
    }
    case 'http': {
      // A webhook cannot be verified passively: ANY request to it (GET, HEAD,
      // OPTIONS) may actuate a poorly-designed endpoint. Verify URL shape only
      // and require an explicit actuation test for enablement.
      const target = config.httpUrl ? validateHttpTarget(config.httpUrl) : { error: 'No webhook URL configured' };
      if (target.error) return failure('http', 'INVALID_URL', target.error);
      return failure('http', 'ACTUATION_REQUIRED',
        'HTTP webhooks cannot be verified without sending a request. Use "Send test action" — it will fire the webhook once.');
    }
    default:
      return failure('none', 'NO_PROVIDER', 'No provider selected');
  }
}

// Explicit actuating test. For Hue, pulses configured lights (or all lights)
// to full brightness briefly, then restores captured state. For HTTP, fires
// the configured webhook once with on=true/brightness=254.
async function testSmartLightAction() {
  switch (config.provider) {
    case 'hue': {
      if (!config.hueBridgeIp || !config.hueUsername) {
        return failure('hue', 'NOT_CONFIGURED', 'Hue Bridge not configured');
      }
      const res = await invokeSmartLightAction({ on: true, brightness: 254, transitionTime: 5 });
      if (!res.success) return res;
      return result('hue', true, 'ACTION_SENT', 'Test action sent to Hue lights',
        { verifiedConfigKey: configurationKey() });
    }
    case 'http': {
      if (!config.httpUrl) return failure('http', 'NOT_CONFIGURED', 'No webhook URL configured');
      const res = await invokeHttpLightAction(254, 366, true);
      if (!res.success) return res;
      return result('http', true, 'ACTION_SENT', `Sent test action to ${config.httpUrl}`,
        { verifiedConfigKey: configurationKey() });
    }
    default:
      return failure('none', 'NO_PROVIDER', 'No provider selected');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Management
// ─────────────────────────────────────────────────────────────────────────────

function loadConfig(newConfig) {
  if (!newConfig) return;
  const merged = {
    ...config,
    provider: newConfig.provider !== undefined
      ? (SHIPPED_PROVIDERS.includes(newConfig.provider) ? newConfig.provider : 'none')
      : config.provider,
    mode: newConfig.mode || config.mode,
    dimMinutes: newConfig.dimMinutes !== undefined ? Number(newConfig.dimMinutes) : config.dimMinutes,
    enabled: newConfig.enabled !== undefined ? Boolean(newConfig.enabled) : config.enabled,
    hueBridgeIp: (newConfig.hueBridgeIp && net.isIP(String(newConfig.hueBridgeIp).trim()) !== 0) ? String(newConfig.hueBridgeIp).trim() : config.hueBridgeIp,
    // Empty string means "keep existing" so a redacted (blanked) renderer field
    // never clobbers the stored credential.
    hueUsername: newConfig.hueUsername || config.hueUsername,
    hueLightIds: newConfig.hueLightIds || config.hueLightIds,
    hueGroupId: newConfig.hueGroupId || config.hueGroupId,
    httpUrl: newConfig.httpUrl || config.httpUrl,
    httpMethod: newConfig.httpMethod || config.httpMethod,
    httpHeaders: newConfig.httpHeaders || config.httpHeaders,
    httpBodyTemplate: newConfig.httpBodyTemplate || config.httpBodyTemplate,
    verifiedConfigKey: newConfig.verifiedConfigKey || ''
  };
  merged.enabled = Boolean(merged.enabled && merged.verifiedConfigKey && merged.verifiedConfigKey === configurationKey(merged));
  config = merged;
}

// Full config — main-process only. Never send to the renderer.
function getConfig() {
  return { ...config };
}

// Renderer-safe config: secret fields are replaced by presence indicators.
function getPublicConfig() {
  const publicConfig = { ...config };
  for (const [field, indicator] of Object.entries(SECRET_INDICATORS)) {
    const value = publicConfig[field];
    const present = typeof value === 'string' ? value.length > 0
      : (value && typeof value === 'object' ? Object.keys(value).length > 0 : false);
    publicConfig[indicator] = Boolean(present);
    delete publicConfig[field];
  }
  return publicConfig;
}

function shouldStartDim(remainingSeconds) {
  return config.enabled && !state.dimStarted && remainingSeconds <= config.dimMinutes * 60;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Configuration
  loadConfig,
  getConfig,
  getPublicConfig,
  configurationKey,
  SHIPPED_PROVIDERS,

  // Hue functions
  findHueBridge,
  discoverHueBridgeLocal,
  registerHueBridge,
  getHueLights,
  getHueGroups,

  // Timer integration
  startSmartLightDim,
  updateSmartLightTick,
  invokeSmartLightAction,
  applyScene,
  invokeSmartLightOff,
  restoreHueOriginalState,
  restoreLightSnapshot,
  resetSmartLightState,
  shouldStartDim,

  // Verification (passive) vs actuation (explicit)
  verifySmartLightConnection,
  testSmartLightAction,
  // Back-compat alias for existing callers/tests; now passive, never actuates.
  testSmartLightConnection: verifySmartLightConnection,

  // Direct control (truthful results)
  setHueLightState,
  setHueGroupState,
  invokeHttpLightAction,

  // Exposed for unit tests
  parseSsdpLocation,
  isHueBridgeDescriptor,
  validateHttpTarget
};
