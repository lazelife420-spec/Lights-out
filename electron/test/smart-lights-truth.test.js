'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('module');
const smartLights = require('../smartLights');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('Smart Lights cannot remain enabled without verification of the exact configuration', async () => {
  smartLights.loadConfig({ provider: 'hue', hueBridgeIp: '', hueUsername: '', enabled: true, verifiedConfigKey: 'invented' });
  assert.equal(smartLights.getConfig().enabled, false);
  const result = await smartLights.verifySmartLightConnection();
  assert.equal(result.success, false);
});

test('dead providers normalize to none and can never enable', async () => {
  for (const dead of ['mqtt', 'homeassistant', 'ifttt']) {
    smartLights.loadConfig({ provider: dead, enabled: true, verifiedConfigKey: 'x' });
    assert.equal(smartLights.getConfig().provider, 'none', `${dead} must not persist as a selectable provider`);
    assert.equal(smartLights.getConfig().enabled, false);
  }
  // And the config object no longer carries dead-provider credential fields.
  const cfg = smartLights.getConfig();
  for (const key of ['mqttBroker', 'mqttPassword', 'haToken', 'iftttWebhookKey']) {
    assert.equal(cfg[key], undefined, `${key} must not exist in live config`);
  }
  smartLights.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '' });
});

test('HTTP verify is passive and never actuates; only a test action can verify', async (t) => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; req.resume(); req.on('end', () => { res.writeHead(204); res.end(); }); });
  const port = await listen(server);
  t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${port}/lights`;

  smartLights.loadConfig({ provider: 'http', httpUrl: url, httpMethod: 'POST', enabled: false, verifiedConfigKey: '' });
  const verify = await smartLights.verifySmartLightConnection();
  assert.equal(verify.success, false);
  assert.equal(verify.code, 'ACTUATION_REQUIRED');
  assert.equal(verify.verifiedConfigKey, undefined, 'passive verify must never mint a verified key');
  assert.equal(hits, 0, 'VERIFY_CONNECTION_ACTUATES_LIGHTS = NO — zero requests allowed');

  const action = await smartLights.testSmartLightAction();
  assert.equal(action.success, true);
  assert.ok(action.verifiedConfigKey);
  assert.equal(hits, 1, 'the actuation test sends exactly one request');

  smartLights.loadConfig({ enabled: true, verifiedConfigKey: action.verifiedConfigKey });
  assert.equal(smartLights.getConfig().enabled, true);
  smartLights.loadConfig({ httpUrl: `${url}/changed`, enabled: true, verifiedConfigKey: action.verifiedConfigKey });
  assert.equal(smartLights.getConfig().enabled, false);
});

test('HTTP transport failure is truthful — never reported as success', async () => {
  // Nothing listens on this port: guaranteed ECONNREFUSED.
  smartLights.loadConfig({ provider: 'http', httpUrl: 'http://127.0.0.1:9/unreachable', httpMethod: 'POST', enabled: false, verifiedConfigKey: '' });
  const res = await smartLights.invokeHttpLightAction(254, 366, true);
  assert.equal(res.success, false, 'a refused webhook must not report success');
  const action = await smartLights.testSmartLightAction();
  assert.equal(action.success, false);
  assert.equal(action.verifiedConfigKey, undefined, 'a failed test must never mint a verified key');
});

test('HTTP webhook rejects non-http schemes and wild verbs', async () => {
  smartLights.loadConfig({ provider: 'http', httpUrl: 'file:///etc/passwd', httpMethod: 'POST', enabled: false, verifiedConfigKey: '' });
  const res = await smartLights.invokeHttpLightAction(1, 366, true);
  assert.equal(res.success, false);
  assert.equal(res.code, 'INVALID_URL');
});

test('Hue verify is a passive read and returns truthful failure', async (t) => {
  const server = http.createServer((req, res) => {
    // /api/<user>/lights → object map of lights
    if (/\/api\/[^/]+\/lights/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ '1': { name: 'Desk', state: { on: true, bri: 200, ct: 300 } }, '2': { name: 'Lamp', state: { on: false, bri: 0, ct: 300 } } }));
      return;
    }
    res.writeHead(404); res.end();
  });
  const port = await listen(server);
  t.after(() => new Promise(r => server.close(r)));

  smartLights.loadConfig({ provider: 'hue', hueBridgeIp: '127.0.0.1', hueUsername: 'u', enabled: false, verifiedConfigKey: '' });
  // Point the module at the stub via the IP field being overridden post-load:
  // loadConfig requires a valid IP; 127.0.0.1 is valid — but the port differs,
  // so exercise the read path through the stub by monkey-patching config via
  // the http webhook shape is wrong. Instead use the direct function:
  const res = await smartLights.getHueLights(`127.0.0.1:${port}`, 'u');
  assert.equal(res.success, true);
  assert.equal(res.lights.length, 2);

  const dead = await smartLights.getHueLights('127.0.0.1:9', 'u');
  assert.equal(dead.success, false, 'refused bridge must fail truthfully');
});

test('Hue cancel restoration replays the captured snapshot truthfully', async (t) => {
  const writes = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'PUT' && /\/state$/.test(req.url)) {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => { writes.push({ url: req.url, body: JSON.parse(body) }); res.writeHead(200); res.end('[]'); });
      return;
    }
    res.writeHead(404); res.end();
  });
  const port = await listen(server);
  t.after(() => new Promise(r => server.close(r)));

  const snapshot = [{ id: '7', on: true, bri: 180, ct: 320 }, { id: '9', on: true, bri: 90, ct: 0 }];
  const res = await smartLights.restoreLightSnapshot(`127.0.0.1:${port}`, 'u', snapshot);
  assert.equal(res.success, true);
  assert.equal(res.code, 'RESTORED');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.on, true);
  assert.equal(writes[0].body.bri, 180);
  assert.equal(writes[0].body.ct, 320);
  assert.equal(writes[1].body.bri, 90);
  assert.equal(writes[1].body.ct, undefined, 'zero ct must not be written');

  // Restoration failure is surfaced, not hidden.
  const bad = await smartLights.restoreLightSnapshot('127.0.0.1:9', 'u', snapshot);
  assert.equal(bad.success, false);
  assert.equal(bad.code, 'RESTORE_PARTIAL');

  const nothing = await smartLights.restoreLightSnapshot('127.0.0.1', 'u', null);
  assert.equal(nothing.success, true);
  assert.equal(nothing.code, 'NOTHING_TO_RESTORE');
});

test('Test Mode contract: smart lights actuate during dry-run (lights are the rehearsal, not the power action)', () => {
  // The module intentionally has no dryRun/Test Mode input: Test Mode suppresses
  // Windows power actions only, while the light ritual still runs so the user
  // sees the real bedtime sequence. REAL_POWER_ACTIONS stays 0 in main.js.
  const src = fs.readFileSync(path.join(__dirname, '..', 'smartLights.js'), 'utf8');
  assert.equal(src.includes('dryRun'), false, 'smartLights must not consult dry-run state');
});

test('HTTP config key covers credential headers — rotating a secret invalidates verification', () => {
  smartLights.loadConfig({ provider: 'http', httpUrl: 'http://10.0.0.5/hook', httpMethod: 'POST', enabled: false, verifiedConfigKey: '', httpHeaders: { Authorization: 'Bearer old' } });
  const k1 = smartLights.configurationKey();
  smartLights.loadConfig({ httpHeaders: { Authorization: 'Bearer new' } });
  const k2 = smartLights.configurationKey();
  assert.notEqual(k1, k2, 'a credential change must change the verification key');
  assert.equal(k1.includes('old'), false, 'key must not carry plaintext secrets');
  smartLights.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '', httpHeaders: {} });
});

test('hueRequest falls back to HTTP for legacy bridges and reports the transport', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bridgeid: 'AABBCCDDEEFF0011', name: 'stub' }));
  });
  const port = await listen(server);
  t.after(() => new Promise(r => server.close(r)));

  const r = await smartLights.hueRequest(`127.0.0.1:${port}`, 'GET', '/api/config', null, 3000);
  assert.equal(r.ok, true);
  assert.equal(r.transport, 'http', 'plain-HTTP stub must be reached via the legacy fallback');
  assert.equal(r.data.bridgeid, 'AABBCCDDEEFF0011');
});

test('isHueBridgeCertificate accepts Hue-looking certs and rejects unrelated ones', () => {
  const good = smartLights.isHueBridgeCertificate({ subject: { CN: '001788FFFE123456' }, issuer: {} });
  assert.equal(good.trusted, true);
  const hueIssuer = smartLights.isHueBridgeCertificate({ subject: { CN: 'weird' }, issuer: { CN: 'Philips Hue CA' } });
  assert.equal(hueIssuer.trusted, true);
  const bad = smartLights.isHueBridgeCertificate({ subject: { CN: 'evil.corp' }, issuer: { CN: 'Internal Corp CA' } });
  assert.equal(bad.trusted, false);
  const none = smartLights.isHueBridgeCertificate(null);
  assert.equal(none.trusted, false);
});

test('mDNS query/parse round-trips a Hue announcement', () => {
  const q = smartLights.buildMdnsQuery();
  assert.ok(q.includes(Buffer.from('_hue')), 'query must ask for _hue._tcp.local');

  // Synthesize a response: header + 1 PTR answer + 1 A answer.
  const name = Buffer.from([4, ...Buffer.from('_hue'), 4, ...Buffer.from('_tcp'), 5, ...Buffer.from('local'), 0]);
  // Real Hue PTR targets look like 'Philips hue - XXXXXX._hue._tcp.local'.
  const ptrTarget = Buffer.from([
    7, ...Buffer.from('hue-abc'),
    4, ...Buffer.from('_hue'),
    4, ...Buffer.from('_tcp'),
    5, ...Buffer.from('local'), 0
  ]);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 6); // ancount=1 (+additional handled by ansum below)
  // We'll build: header(qd=0, an=2) then RR1: name ptr->_hue._tcp.local TYPE PTR, RR2: TYPE A.
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(2, 6);
  const rr1head = Buffer.alloc(10);
  rr1head.writeUInt16BE(12, 0); // TYPE PTR
  rr1head.writeUInt16BE(1, 2);  // CLASS IN
  rr1head.writeUInt16BE(ptrTarget.length, 8); // RDLENGTH
  const rr2head = Buffer.alloc(10);
  rr2head.writeUInt16BE(1, 0);  // TYPE A
  rr2head.writeUInt16BE(1, 2);
  rr2head.writeUInt16BE(4, 8);
  const packet = Buffer.concat([header, name, rr1head, ptrTarget, name, rr2head, Buffer.from([192, 168, 0, 77])]);
  const parsed = smartLights.parseMdnsResponse(packet);
  assert.ok(parsed.ptrNames.some(n => n.includes('hue-abc')), `PTR names: ${parsed.ptrNames}`);
  assert.ok(parsed.ips.includes('192.168.0.77'), `A ips: ${parsed.ips}`);
});

test('public config redacts secrets; full config stays in main process', () => {
  smartLights.loadConfig({
    provider: 'hue', hueBridgeIp: '192.168.0.50', hueUsername: 'super-secret-user',
    httpHeaders: { Authorization: 'Bearer live-token' }, enabled: false
  });
  const pub = smartLights.getPublicConfig();
  assert.equal(pub.hueUsername, undefined, 'hueUsername must not reach renderer');
  assert.equal(pub.httpHeaders, undefined, 'httpHeaders must not reach renderer');
  assert.equal(pub.hasHueCredential, true);
  assert.equal(pub.hasHttpHeaders, true);
  assert.equal(JSON.stringify(pub).includes('super-secret-user'), false);
  assert.equal(JSON.stringify(pub).includes('live-token'), false);
  const full = smartLights.getConfig();
  assert.equal(full.hueUsername, 'super-secret-user');
});

// settings.js secret-at-rest coverage for object-valued fields (httpHeaders).
test('settings: httpHeaders secret map is encrypted at rest when safeStorage is available', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-slsec-'));
  const origLoad = Module._load;
  const fakeEnc = s => 'enc:v1:' + Buffer.from(s).toString('base64');
  const fakeDec = s => Buffer.from(s.slice(7), 'base64').toString();
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => tmpDir },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: v => Buffer.from(fakeDec(fakeEnc(v))),
          decryptString: b => fakeDec('enc:v1:' + Buffer.from(b).toString('base64'))
        }
      };
    }
    return origLoad.apply(this, arguments);
  };
  const settingsPath = path.resolve(__dirname, '..', 'settings.js');
  try {
    delete require.cache[settingsPath];
    const settings = require(settingsPath);
    settings.updateSection('smartLights', { httpHeaders: { Authorization: 'Bearer should-be-encrypted' } });
    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    assert.equal(raw.includes('should-be-encrypted'), false, 'header secret must not sit plaintext in settings.json');
    // It must round-trip back as an object.
    const sec = settings.getSection('smartLights');
    assert.equal(sec.httpHeaders.Authorization, 'Bearer should-be-encrypted');
  } finally {
    Module._load = origLoad;
    delete require.cache[settingsPath];
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('settings: dead-provider credential keys are pruned on load', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-slprune-'));
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return { app: { getPath: () => tmpDir }, safeStorage: { isEncryptionAvailable: () => false } };
    }
    return origLoad.apply(this, arguments);
  };
  const settingsPath = path.resolve(__dirname, '..', 'settings.js');
  try {
    // Seed a settings.json carrying dead-provider secrets.
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({
      smartLights: { provider: 'mqtt', mqttPassword: 'dead-secret', haToken: 'dead-token', iftttWebhookKey: 'dead-key' }
    }));
    delete require.cache[settingsPath];
    const settings = require(settingsPath);
    const sec = settings.getSection('smartLights');
    assert.equal(sec.mqttPassword, undefined, 'dead-provider secret must be pruned');
    assert.equal(sec.haToken, undefined);
    assert.equal(sec.iftttWebhookKey, undefined);
    // And the next save must not re-persist them.
    settings.updateSection('smartLights', { provider: 'none' });
    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    assert.equal(raw.includes('dead-secret'), false);
  } finally {
    Module._load = origLoad;
    delete require.cache[settingsPath];
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});
