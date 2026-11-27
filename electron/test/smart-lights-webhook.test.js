'use strict';
// Regression guards for the HTTP webhook light provider (loopback fakes only):
// - one dim request at a time: a tick while one is pending is skipped;
// - the final off waits for a pending dim request, so it cannot land first;
// - only a 2xx answer is success (a 3xx redirect is not a delivered command);
// - result messages show scheme://host only, never the path or query that
//   usually carries the webhook secret;
// - a power-preserving action (sunrise after its first step, ritual scene)
//   never fires a webhook that cannot report whether its light is on.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const smart = require('../smartLights');
const { listen } = require('./helpers/fake-hue-bridge.cjs');

async function webhookServer(t, respond = (req, res) => { res.writeHead(204); res.end(); }) {
  const seen = [];
  let open = 0;
  let maxOpen = 0;
  const server = http.createServer((req, res) => {
    let text = '';
    open++;
    maxOpen = Math.max(maxOpen, open);
    res.on('finish', () => { open--; });
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      const entry = { url: req.url, body: text ? JSON.parse(text) : null, at: seen.length };
      seen.push(entry);
      respond(req, res, entry);
    });
  });
  const port = await listen(server);
  t.after(async () => {
    await smart.whenIdle();
    smart.resetSmartLightState();
    smart.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '', httpUrl: '' });
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  });
  return { port, seen, maxOpen: () => maxOpen };
}

function enableWebhook(url) {
  const cfg = { provider: 'http', mode: 'gradual_dim', dimMinutes: 10, httpUrl: url, httpMethod: 'POST', httpHeaders: {},
    httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "on": {{ON}}}', enabled: true };
  smart.loadConfig({ ...cfg, verifiedConfigKey: smart.configurationKey(cfg) });
  assert.equal(smart.getConfig().enabled, true);
}

const until = async (condition, label) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(condition(), label);
};

test('one webhook dim request at a time, and the final off waits for the pending one', async t => {
  const held = [];
  const responses = [];
  const hook = await webhookServer(t, (req, res, entry) => {
    const reply = () => { responses.push(entry.at); res.writeHead(204); res.end(); };
    if (entry.body.on === true) held.push(reply); else reply();
  });
  enableWebhook(`http://127.0.0.1:${hook.port}/hook`);
  smart.startSmartLightDim(600);

  smart.updateSmartLightTick(600);
  await until(() => hook.seen.length === 1, 'the first dim request arrived');
  for (let remaining = 599; remaining > 594; remaining--) smart.updateSmartLightTick(remaining);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(hook.seen.length, 1, 'ticks while a request is pending are skipped');

  const off = smart.invokeSmartLightOff();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(hook.seen.length, 1, 'the off is not sent while the dim request is pending');
  held.shift()();
  const res = await off;
  assert.equal(res.success, true, res.message);
  assert.deepEqual(hook.seen.map(entry => entry.body.on), [true, false]);
  assert.deepEqual(responses, [0, 1], 'the dim step was answered before the off arrived');
  assert.equal(hook.maxOpen(), 1, 'never two webhook requests in flight');
  smart.updateSmartLightTick(590);
  await smart.whenIdle();
  assert.equal(hook.seen.length, 2, 'no dim step after the final off');
});

test('only a 2xx answer counts: a redirect fails the test action and mints no verification', async t => {
  let status = 301;
  const hook = await webhookServer(t, (req, res) => { res.writeHead(status, { Location: 'https://example.invalid/moved' }); res.end(); });
  smart.loadConfig({ provider: 'http', httpUrl: `http://127.0.0.1:${hook.port}/hook`, httpMethod: 'POST', enabled: false, verifiedConfigKey: '' });
  for (const code of [301, 302, 307, 308, 304, 404, 500]) {
    status = code;
    const res = await smart.testSmartLightAction();
    assert.equal(res.success, false, `HTTP ${code} is not success`);
    assert.match(res.message, new RegExp(`HTTP ${code}`));
    assert.equal(res.verifiedConfigKey, undefined);
  }
  status = 204;
  assert.equal((await smart.testSmartLightAction()).success, true);
});

test('webhook result messages never echo the path or query that carries the secret', async t => {
  let status = 204;
  const hook = await webhookServer(t, (req, res) => { res.writeHead(status); res.end(); });
  const url = `http://127.0.0.1:${hook.port}/api/webhook/secret-hook-id?token=abc123`;
  smart.loadConfig({ provider: 'http', httpUrl: url, httpMethod: 'POST', enabled: false, verifiedConfigKey: '' });
  const ok = await smart.testSmartLightAction();
  assert.equal(ok.success, true);
  assert.equal(ok.message, `Sent test action to http://127.0.0.1:${hook.port}`);
  status = 500;
  const failed = await smart.testSmartLightAction();
  for (const res of [ok, failed]) {
    assert.equal(res.message.includes('secret-hook-id') || res.message.includes('abc123'), false, res.message);
  }
  assert.equal(hook.seen[0].url, '/api/webhook/secret-hook-id?token=abc123', 'the request itself still uses the full URL');
});

test('a power-preserving action never fires the webhook (it cannot report whether its light is on)', async t => {
  const hook = await webhookServer(t);
  enableWebhook(`http://127.0.0.1:${hook.port}/hook`);
  const scene = await smart.applyScene('night');
  assert.equal(scene.success, true);
  assert.equal(scene.code, 'SKIPPED');
  const sunriseStep = await smart.invokeSmartLightAction({ on: true, brightness: 120, preservePower: true, released: new Set() });
  assert.equal(sunriseStep.code, 'SKIPPED');
  assert.equal(hook.seen.length, 0, 'no request: it could switch on a light someone switched off');
  // An explicit action (or the first sunrise step) still fires it.
  assert.equal((await smart.invokeSmartLightAction({ on: true, brightness: 60 })).success, true);
  assert.equal(hook.seen.length, 1);
});
