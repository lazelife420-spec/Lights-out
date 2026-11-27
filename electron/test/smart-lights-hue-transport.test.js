'use strict';
// Regression guards for the Hue transport, with real local TLS servers on
// loopback (no real bridge, no LAN):
// - trust on first use: the bridge certificate is pinned (at Register, or on
//   the first good answer for a setup verified before pinning) and checked on
//   secureConnect BEFORE any byte of the request is written, so an impostor
//   never receives the Hue key, the path or a body;
// - the pin never silently un-verifies a setup, a replaced pin does;
// - every request has an absolute deadline, a TLS handshake that never
//   completes included;
// - legacy HTTP is a fallback for a refused/reset/silent :443 only with the
//   opt-in, and never for a bridge that has a pin;
// - a revoked key reads as UNAUTHORIZED with "Register the bridge again";
// - loadConfig accepts host:port and reports a refused address.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const smart = require('../smartLights');
const { makeCertificates, startFakeBridge, startSilentListener, startResettingListener, closedPort } = require('./helpers/fake-hue-bridge.cjs');

// Both certificates carry a bridge-id-looking CN: the CN proves nothing.
const certs = makeCertificates({ bridge: '001788FFFE00AB12', impostor: '001788FFFE00CD34' });
const LIGHTS = { 1: { name: 'Bed lamp', type: 'Dimmable light', state: { on: true, bri: 200, reachable: true } } };
const GROUPS = { 1: { name: 'Bedroom', type: 'Room', lights: ['1'] } };

function cleanup(t, bridge) {
  t.after(async () => {
    await smart.whenIdle();
    smart.setConfigPersistence(null);
    smart.resetSmartLightState();
    smart.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '', hueBridgeIp: '', hueGroupId: '', hueLightIds: [], hueAllowLegacyHttp: false, httpUrl: '' });
    if (bridge) await bridge.close();
  });
}

const sinceRaw = (bridge, label) => bridge.raw.filter(entry => entry.label === label).map(entry => entry.text).join('');

test('a verified setup without a pin is pinned on its first connection, keeps its verification, and an impostor certificate receives nothing', async t => {
  const bridge = await startFakeBridge({ certificate: certs.bridge, users: ['user-1'], lights: LIGHTS, groups: GROUPS });
  cleanup(t, bridge);
  const saved = [];
  smart.setConfigPersistence(patch => saved.push(patch));
  const cfg = { provider: 'hue', mode: 'gradual_dim', hueBridgeIp: bridge.host, hueUsername: 'user-1', hueGroupId: '1', enabled: true };
  const key = smart.configurationKey(cfg);
  smart.loadConfig({ ...cfg, verifiedConfigKey: key });
  assert.equal(smart.getConfig().hueCertFingerprint, '', 'paired before pinning existed');

  const first = await smart.verifySmartLightConnection();
  assert.equal(first.success, true, first.message);
  assert.equal(smart.getConfig().hueCertFingerprint, certs.bridge.fingerprint, 'pinned on first use');
  assert.deepEqual(saved, [{ hueCertFingerprint: certs.bridge.fingerprint }], 'the pin goes to the settings store');
  assert.equal(smart.getConfig().enabled, true, 'pinning keeps the verification');
  assert.equal(smart.configurationKey(), key);
  assert.equal(smart.getPublicConfig().verifiedForSetup, true);
  assert.equal('hueCertFingerprint' in smart.getPublicConfig(), false, 'the renderer never gets the pin');

  // Someone else answers at the bridge address.
  bridge.useCertificate('impostor', certs.impostor);
  const requestsBefore = bridge.requests.length;
  const verify = await smart.verifySmartLightConnection();
  assert.equal(verify.success, false);
  assert.equal(verify.code, 'CERT_CHANGED');
  assert.match(verify.message, /Register the bridge again/);
  const put = await smart.invokeSmartLightAction({ on: true, brightness: 10 });
  assert.equal(put.code, 'CERT_CHANGED');
  const test1 = await smart.testSmartLightAction();
  assert.equal(test1.code, 'CERT_CHANGED');
  assert.equal(test1.verifiedConfigKey, undefined);
  smart.startSmartLightDim(600);
  await smart.whenIdle();
  smart.updateSmartLightTick(300);
  await smart.whenIdle();

  assert.ok(bridge.connections.includes('impostor'), 'the impostor was reached (it presented its certificate)');
  assert.equal(sinceRaw(bridge, 'impostor'), '', 'not one request byte reached the impostor');
  assert.equal(bridge.requests.length, requestsBefore, 'no HTTP request (path, key or body) reached it');
  assert.equal(saved.length, 1, 'a mismatch never re-pins');

  // The real bridge again: same certificate, works.
  bridge.useCertificate('bridge', certs.bridge);
  const again = await smart.verifySmartLightConnection();
  assert.equal(again.success, true, again.message);
  const pinnedRead = await smart.getHueLights(bridge.host, 'user-1');
  assert.deepEqual([pinnedRead.success, pinnedRead.tls.pinned, pinnedRead.tls.firstUse], [true, true, false]);

  // Next launch: the persisted pin is enforced from the first request.
  smart.loadConfig({ provider: 'none', hueBridgeIp: '' });
  smart.loadConfig({ ...cfg, ...saved[0], verifiedConfigKey: key });
  assert.equal(smart.getConfig().enabled, true);
  assert.equal(smart.getConfig().hueCertFingerprint, certs.bridge.fingerprint);
  bridge.useCertificate('impostor-2', certs.impostor);
  const afterRestart = await smart.getHueLights(bridge.host, 'user-1');
  assert.equal(afterRestart.code, 'CERT_CHANGED');
  assert.equal(sinceRaw(bridge, 'impostor-2'), '');
});

test('Register pins the certificate that answered; after a bridge reset, Register moves the pin and the setup needs verifying again', async t => {
  const bridge = await startFakeBridge({ certificate: certs.bridge, users: [], lights: LIGHTS, groups: GROUPS, linkButton: true, registerAs: 'user-A' });
  cleanup(t, bridge);
  const registered = await smart.registerHueBridge(bridge.host);
  assert.equal(registered.username, 'user-A');
  assert.equal(registered.certificatePinned, true);
  assert.equal(registered.transport, 'https');
  // The renderer saves the new key (it never sees or sends a pin).
  smart.loadConfig({ provider: 'hue', hueBridgeIp: bridge.host, hueUsername: 'user-A', hueGroupId: '1', enabled: false, verifiedConfigKey: '' });
  assert.equal(smart.getConfig().hueCertFingerprint, certs.bridge.fingerprint, 'the Register pin is adopted');
  const verified = await smart.verifySmartLightConnection();
  assert.equal(verified.success, true, verified.message);
  smart.loadConfig({ enabled: true, verifiedConfigKey: verified.verifiedConfigKey });
  assert.equal(smart.getConfig().enabled, true);

  // Factory reset: a new certificate, and the old key is gone.
  bridge.useCertificate('reset', certs.impostor);
  bridge.registerAs = 'user-B';
  bridge.users.clear();
  assert.equal((await smart.verifySmartLightConnection()).code, 'CERT_CHANGED');
  assert.equal(sinceRaw(bridge, 'reset'), '', 'the old key never reached the reset bridge');

  const again = await smart.registerHueBridge(bridge.host);
  assert.equal(again.username, 'user-B', 'Register itself is not held to the old pin');
  smart.loadConfig({ hueUsername: 'user-B', enabled: true, verifiedConfigKey: verified.verifiedConfigKey });
  assert.equal(smart.getConfig().hueCertFingerprint, certs.impostor.fingerprint, 'the pin moved with the new registration');
  assert.equal(smart.getConfig().enabled, false, 'a changed bridge is a new setup to verify');
  const reverified = await smart.verifySmartLightConnection();
  assert.equal(reverified.success, true, reverified.message);
  assert.notEqual(reverified.verifiedConfigKey, verified.verifiedConfigKey);
});

test('the certificate pin is bound to the bridge address and a replaced pin un-verifies the setup', () => {
  const fingerprintA = certs.bridge.fingerprint;
  const fingerprintB = certs.impostor.fingerprint;
  const cfg = { provider: 'hue', hueBridgeIp: '192.168.0.40', hueUsername: 'user-1', hueGroupId: '1', enabled: true };
  const key = smart.configurationKey(cfg);
  smart.loadConfig({ ...cfg, verifiedConfigKey: key });
  assert.equal(smart.getConfig().enabled, true);
  smart.loadConfig({ hueCertFingerprint: fingerprintA, enabled: true, verifiedConfigKey: key });
  assert.equal(smart.getConfig().enabled, true, 'a first pin keeps the verification');
  assert.equal(smart.getConfig().hueCertFingerprint, fingerprintA);
  for (const blank of ['', 'not-a-fingerprint', null]) {
    smart.loadConfig({ hueCertFingerprint: blank, enabled: true, verifiedConfigKey: key });
    assert.equal(smart.getConfig().hueCertFingerprint, fingerprintA, `${JSON.stringify(blank)} never clears a pin`);
  }
  smart.loadConfig({ hueCertFingerprint: fingerprintB, enabled: true, verifiedConfigKey: key });
  assert.equal(smart.getConfig().enabled, false, 'a different certificate for the same bridge is a changed bridge');
  assert.equal(smart.getConfig().verifiedConfigKey, '');
  smart.loadConfig({ hueBridgeIp: '192.168.0.41' });
  assert.equal(smart.getConfig().hueCertFingerprint, '', 'a new bridge address starts unpinned');
  const pub = JSON.stringify(smart.getPublicConfig());
  assert.equal(pub.includes(fingerprintA) || pub.includes(fingerprintB), false);
  smart.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '', hueBridgeIp: '' });
});

test('the unauthenticated discovery probe is not pinned', async t => {
  const bridge = await startFakeBridge({ certificate: certs.bridge, users: ['user-1'], lights: LIGHTS, groups: GROUPS });
  cleanup(t, bridge);
  smart.loadConfig({ provider: 'hue', hueBridgeIp: bridge.host, hueUsername: 'user-1', hueCertFingerprint: certs.impostor.fingerprint });
  const probe = await smart.hueRequest(bridge.host, 'GET', '/api/config', null, 2000, { pin: 'none', cacheTransport: false });
  assert.equal(probe.ok, true);
  assert.equal(probe.data.bridgeid, '001788FFFE00AB12');
  assert.equal(smart.getConfig().hueCertFingerprint, certs.impostor.fingerprint, 'the probe neither checks nor replaces the pin');
  const credentialed = await smart.getHueLights(bridge.host, 'user-1');
  assert.equal(credentialed.code, 'CERT_CHANGED', 'a credentialed request to the same host is pinned');
  const src = fs.readFileSync(path.join(__dirname, '..', 'smartLights.js'), 'utf8');
  assert.match(src, /hueRequest\(ip, 'GET', '\/api\/config', null, 2500, \{[^}]*pin: 'none'/, 'discovery uses the unpinned probe');
});

test('every Hue and webhook request has an absolute deadline, a TLS handshake that never completes included', async t => {
  const silent = await startSilentListener();
  cleanup(t, null);
  t.after(() => silent.close());
  const timeoutMs = 600;
  const within = async (label, run) => {
    const started = performance.now();
    await run();
    const elapsed = performance.now() - started;
    assert.ok(elapsed <= timeoutMs + 250, `${label} took ${Math.round(elapsed)} ms (limit ${timeoutMs + 250})`);
  };
  await within('Hue HTTPS', () => assert.rejects(smart.hueRequest(`127.0.0.1:${silent.port}`, 'GET', '/api/config', null, timeoutMs), err => err.code === 'TIMEOUT'));
  await within('Hue with legacy HTTP fallback', () => assert.rejects(
    smart.hueRequest(`127.0.0.1:${silent.port}`, 'GET', '/api/config', null, timeoutMs, { allowLegacyHttp: true, cacheTransport: false }),
    err => err.code === 'TIMEOUT'));
  for (const scheme of ['https', 'http']) {
    smart.loadConfig({ provider: 'http', httpUrl: `${scheme}://127.0.0.1:${silent.port}/hook`, httpMethod: 'POST', enabled: false, verifiedConfigKey: '' });
    await within(`webhook ${scheme}`, async () => {
      const res = await smart.invokeHttpLightAction(254, 366, true, { timeoutMs });
      assert.equal(res.success, false);
      assert.match(res.message, /timed out/);
    });
  }
  assert.ok(silent.accepted() >= 4, 'each request really reached the silent listener');
});

test('legacy HTTP is a fallback for a refused, reset or silent :443 only with the opt-in, and never for a pinned bridge', async t => {
  cleanup(t, null);
  const legacy = await startFakeBridge({ certificate: null, users: ['user-1'], lights: LIGHTS, groups: GROUPS });
  const resetting = await startResettingListener();
  const silent = await startSilentListener();
  t.after(async () => { await legacy.close(); await resetting.close(); await silent.close(); });
  const refused = await closedPort();
  const call = (httpsPort, extra = {}) => smart.hueRequest('127.0.0.1', 'GET', '/api/config', null, 2000,
    { cacheTransport: false, transportPorts: { https: httpsPort, http: legacy.port }, ...extra });

  for (const [label, httpsPort] of [['refused', refused], ['reset', resetting.port], ['silent', silent.port]]) {
    const before = legacy.requests.length;
    await assert.rejects(call(httpsPort, { allowLegacyHttp: false }), `${label} :443 without the opt-in fails`);
    assert.equal(legacy.requests.length, before, `${label}: nothing went over plain HTTP without the opt-in`);
    const started = performance.now();
    const r = await call(httpsPort, { allowLegacyHttp: true });
    assert.equal(r.transport, 'http', `${label} :443 falls back to HTTP on :80 with the opt-in`);
    assert.equal(r.data.bridgeid, '001788FFFE00AB12');
    assert.ok(performance.now() - started < 2000, `${label}: the fallback fits the same deadline`);
  }

  // A bridge that has answered over HTTPS (pinned) is never downgraded.
  const tlsBridge = await startFakeBridge({ certificate: certs.bridge, users: ['user-1'], lights: LIGHTS, groups: GROUPS });
  t.after(() => tlsBridge.close());
  const pinned = await smart.hueRequest('127.0.0.1', 'GET', '/api/config', null, 2000, { cacheTransport: false, transportPorts: { https: tlsBridge.port } });
  assert.equal(pinned.tls.firstUse, true);
  const before = legacy.requests.length;
  await assert.rejects(call(refused, { allowLegacyHttp: true }), err => err.code === 'ECONNREFUSED');
  assert.equal(legacy.requests.length, before, 'no plain-HTTP request to a bridge that has a pin');
});

test('a revoked or unknown Hue key reads as UNAUTHORIZED with "Register the bridge again"', async t => {
  const bridge = await startFakeBridge({ certificate: certs.bridge, users: ['user-1'], lights: LIGHTS, groups: GROUPS });
  cleanup(t, bridge);
  const expectUnauthorized = (res, label) => {
    assert.equal(res.success, false, label);
    assert.equal(res.code, 'UNAUTHORIZED', `${label}: ${res.code} ${res.message}`);
    assert.match(res.message, /Register the bridge again/, label);
  };
  expectUnauthorized(await smart.getHueLights(bridge.host, 'revoked'), 'lights');
  expectUnauthorized(await smart.getHueGroups(bridge.host, 'revoked'), 'groups');
  smart.loadConfig({ provider: 'hue', hueBridgeIp: bridge.host, hueUsername: 'revoked', hueGroupId: '1', enabled: false, verifiedConfigKey: '' });
  expectUnauthorized(await smart.verifySmartLightConnection(), 'verify');
  const groupTest = await smart.testSmartLightAction();
  expectUnauthorized(groupTest, 'test action (room)');
  assert.equal(groupTest.verifiedConfigKey, undefined);
  smart.loadConfig({ hueGroupId: '', hueLightIds: ['1'] });
  expectUnauthorized(await smart.testSmartLightAction(), 'test action (selected lights)');
  smart.loadConfig({ hueLightIds: [] });
  expectUnauthorized(await smart.testSmartLightAction(), 'test action (all lights)');
  assert.equal(smart.getConfig().hueCertFingerprint, '', 'an unauthorized answer never pins');
  assert.equal(bridge.lights[1].state.bri, 200, 'nothing changed');
});

test('loadConfig accepts a bridge address with a port and reports a refused address instead of silently keeping another', () => {
  smart.loadConfig({ provider: 'hue', hueBridgeIp: '' });
  smart.loadConfig({ hueBridgeIp: ' 192.168.1.20:8443 ' });
  assert.equal(smart.getConfig().hueBridgeIp, '192.168.1.20:8443');
  smart.loadConfig({ hueBridgeIp: '[fd00::5]:8080' });
  assert.equal(smart.getConfig().hueBridgeIp, '[fd00::5]:8080');
  const refused = smart.loadConfig({ hueBridgeIp: '8.8.8.8:80' });
  assert.deepEqual(refused.rejected, ['hueBridgeIp']);
  assert.deepEqual(smart.getPublicConfig().rejectedFields, ['hueBridgeIp']);
  assert.equal(smart.getConfig().hueBridgeIp, '[fd00::5]:8080', 'the previous address is kept');
  const ok = smart.loadConfig({ hueBridgeIp: '10.0.0.7' });
  assert.equal(ok.rejected, undefined);
  assert.equal(smart.getPublicConfig().rejectedFields, undefined);
  smart.loadConfig({ provider: 'none', hueBridgeIp: '' });
});
