'use strict';
// Regression guards: smart-light dimming follows the COUNTDOWN, not the wall
// clock. main.js stops ticking while a run is paused and a snooze adds
// countdown time, so with a wall-clock progress a pause or snooze inside the
// dim window turned the lights fully off while time was still left. Now a
// pause freezes the dim, a snooze moves it back toward the starting
// brightness, and the dim completes only when no time remains.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const wiz = require('../wizLights');
const smart = require('../smartLights');
const { listen } = require('./helpers/fake-hue-bridge.cjs');

// The wall clock is faked so a "20-minute pause" costs nothing; the countdown
// (remaining seconds) is what each tick passes, exactly as main.js does.
function fakeClock(t) {
  const realNow = Date.now;
  const clock = { now: realNow() };
  Date.now = () => clock.now;
  t.after(() => { Date.now = realNow; });
  return clock;
}

function resetLights(t) {
  t.after(async () => {
    await smart.whenIdle();
    smart.resetSmartLightState();
    smart.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '', httpUrl: '', wizAddresses: [] });
  });
}

test('dim progress follows the countdown: a pause freezes it, a snooze lowers it, and it never completes while time remains', async t => {
  const clock = fakeClock(t);
  resetLights(t);
  const originalRead = wiz.readStates;
  const originalDim = wiz.dimStates;
  const seen = [];
  wiz.readStates = async () => [{ ip: '192.168.0.18', pilot: { state: true, dimming: 80 } }];
  wiz.dimStates = async (snapshot, progress) => { seen.push(progress); return { success: true }; };
  t.after(() => { wiz.readStates = originalRead; wiz.dimStates = originalDim; });

  smart.loadConfig({ provider: 'wiz', mode: 'gradual_dim', dimMinutes: 10, wizAddresses: ['192.168.0.18'], enabled: true, verifiedConfigKey: 'wiz:192.168.0.18' });
  assert.equal(smart.getConfig().enabled, true);
  smart.startSmartLightDim(600);
  await smart.whenIdle();
  const tick = async (remaining, wallClockMs) => {
    clock.now += wallClockMs;
    smart.updateSmartLightTick(remaining);
    await smart.whenIdle();
    return seen.at(-1);
  };

  assert.equal(await tick(600, 0), 0, 'dimming starts from the current level');
  assert.equal(await tick(300, 300_000), 0.5);
  // Paused for 20 minutes: main sends no ticks, then resumes with 300 s left.
  assert.equal(await tick(300, 1_200_000), 0.5, 'a pause freezes the dim');
  // Snoozed: the countdown gains 150 s, so the lights come back up.
  assert.equal(await tick(450, 1_000), 0.25, 'a snooze moves the dim back toward the start');
  assert.equal(await tick(900, 1_000), 0, 'a long snooze never goes past the starting level');
  const lastSecond = await tick(1, 899_000);
  assert.ok(lastSecond > 0.99 && lastSecond < 1, `1 s left must not complete the dim (got ${lastSecond})`);
  assert.equal(await tick(0, 1_000), 1, 'the dim completes only when no time remains');
});

test('the webhook level follows the countdown and stays on while time remains', async t => {
  const clock = fakeClock(t);
  resetLights(t);
  const bodies = [];
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => { bodies.push(JSON.parse(text)); res.writeHead(204); res.end(); });
  });
  const port = await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));

  const cfg = { provider: 'http', mode: 'gradual_dim', dimMinutes: 10, httpUrl: `http://127.0.0.1:${port}/hook`, httpMethod: 'POST', httpHeaders: {},
    httpBodyTemplate: '{"brightness": {{BRIGHTNESS}}, "on": {{ON}}}', enabled: true };
  smart.loadConfig({ ...cfg, verifiedConfigKey: smart.configurationKey(cfg) });
  assert.equal(smart.getConfig().enabled, true);
  smart.startSmartLightDim(600);
  const tick = async (remaining, wallClockMs) => {
    clock.now += wallClockMs;
    smart.updateSmartLightTick(remaining);
    await smart.whenIdle();
    return bodies.at(-1);
  };

  assert.deepEqual(await tick(600, 0), { brightness: 254, on: true });
  assert.deepEqual(await tick(300, 300_000), { brightness: 127, on: true });
  assert.deepEqual(await tick(300, 1_200_000), { brightness: 127, on: true }, 'a 20-minute pause changes nothing');
  assert.deepEqual(await tick(600, 1_000), { brightness: 254, on: true }, 'a snooze brings the level back up');
  // The last second is the dimmest level, still on: the off is the final
  // command (invokeSmartLightOff), never a dim step.
  assert.deepEqual(await tick(1, 599_000), { brightness: 1, on: true });
  assert.ok(bodies.every(body => body.on === true), 'no dim step switched the light off');
});
