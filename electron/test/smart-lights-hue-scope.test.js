'use strict';
// Regression guards for what Hue dimming may touch, against a loopback HTTPS
// fake bridge (no real device):
// - the snapshot, the dim steps, the restore and the final off cover only the
//   dim targets (the configured room), never other rooms;
// - each light dims from its own level and never above it (a snooze brings
//   it back to that level, not to full);
// - a light switched off mid-run (error 201) is released for the rest of the
//   run; a cancel reads every light live and never sends on:true;
// - the sunrise and the ritual scene never switch on a light that is off, and
//   an action queued before a newer run or reset is dropped.
const test = require('node:test');
const assert = require('node:assert/strict');
const smart = require('../smartLights');
const { makeCertificates, startFakeBridge } = require('./helpers/fake-hue-bridge.cjs');

const certs = makeCertificates({ bridge: '001788FFFE00AB12' });

const LIGHTS = {
  1: { name: 'Bed lamp', type: 'Extended color light', state: { on: true, bri: 200, ct: 300, colormode: 'ct', reachable: true } },
  2: { name: 'Desk', type: 'Color temperature light', state: { on: true, bri: 100, ct: 400, colormode: 'ct', reachable: true } },
  3: { name: 'Shelf', type: 'Dimmable light', state: { on: false, bri: 150, reachable: true } },
  5: { name: 'Reading', type: 'Dimmable light', state: { on: true, bri: 80, reachable: true } },
  9: { name: 'Kitchen', type: 'Extended color light', state: { on: true, bri: 254, ct: 250, colormode: 'ct', reachable: true } }
};
const GROUPS = {
  1: { name: 'Bedroom', type: 'Room', lights: ['1', '2', '3', '5'] },
  2: { name: 'Kitchen', type: 'Room', lights: ['9'] }
};

async function hueSetup(t, overrides = {}) {
  const bridge = await startFakeBridge({ certificate: certs.bridge, users: ['user-1'], lights: LIGHTS, groups: GROUPS });
  const cfg = { provider: 'hue', mode: 'gradual_dim', dimMinutes: 10, hueBridgeIp: bridge.host, hueUsername: 'user-1',
    hueGroupId: '1', hueLightIds: [], hueAllowLegacyHttp: false, enabled: true, ...overrides };
  smart.loadConfig({ ...cfg, verifiedConfigKey: smart.configurationKey(cfg) });
  assert.equal(smart.getConfig().enabled, true, 'fixture setup is verified');
  t.after(async () => {
    await smart.whenIdle();
    smart.resetSmartLightState();
    smart.loadConfig({ provider: 'none', enabled: false, verifiedConfigKey: '', hueBridgeIp: '', hueGroupId: '', hueLightIds: [] });
    await bridge.close();
  });
  const tick = async remaining => { smart.updateSmartLightTick(remaining); await smart.whenIdle(); };
  const puts = () => bridge.requests.filter(r => r.method === 'PUT');
  const lightId = request => request.url.split('/')[4];
  const touched = id => bridge.requests.some(r => r.url.includes(`/lights/${id}`));
  return { bridge, tick, puts, lightId, touched };
}

test('Hue dims only the selected room, from each light\'s own level, and a light switched off mid-run stays off through cancel', async t => {
  const { bridge, tick, puts, lightId, touched } = await hueSetup(t);
  smart.startSmartLightDim(600);
  await smart.whenIdle();
  const dimSteps = from => puts().slice(from).map(p => [lightId(p), p.body.bri]);

  await tick(300);
  assert.deepEqual(dimSteps(0), [['1', 100], ['2', 50], ['5', 40]], 'per-light steps scaled from each light\'s own level');

  bridge.lights[2].state.on = false; // switched off in the Hue app mid-run
  let mark = puts().length;
  await tick(150);
  assert.deepEqual(dimSteps(mark), [['1', 50], ['2', 25], ['5', 20]]);
  assert.equal(bridge.lights[2].state.on, false, 'the dim step to an off light answered 201 and changed nothing');

  mark = puts().length;
  await tick(600); // snoozed: back to where each light started, never above
  assert.deepEqual(dimSteps(mark), [['1', 200], ['5', 80]], 'the released desk lamp is no longer addressed');

  const requestsBefore = bridge.requests.length;
  await tick(120);
  assert.deepEqual(dimSteps(mark + 2), [['1', 40], ['5', 16]]);
  assert.equal(bridge.requests.slice(requestsBefore).some(r => r.url.includes('/lights/2')), false);

  bridge.lights[5].state.on = false; // switched off just before the cancel
  const restored = await smart.restoreHueOriginalState();
  assert.equal(restored.success, true, restored.message);
  assert.equal(restored.code, 'RESTORED');
  assert.equal(bridge.lights[1].state.on, true);
  assert.equal(bridge.lights[1].state.bri, 200, 'the bed lamp is back at its own level');
  assert.equal(bridge.lights[2].state.on, false, 'a light switched off mid-run stays off');
  assert.equal(bridge.lights[5].state.on, false, 'a light switched off before the cancel stays off');
  assert.equal(bridge.lights[3].state.on, false, 'a light that was off is never switched on');

  assert.equal(touched(3), false, 'the room light that was off is never addressed');
  assert.equal(touched(9), false, 'another room is never addressed');
  assert.equal(bridge.requests.some(r => r.url.includes('/groups/') && r.method === 'PUT'), false, 'no room-wide command');
  assert.equal(puts().some(p => p.body && p.body.on === true), false, 'no dim step or restore sends on:true');
  for (const p of puts()) {
    const start = LIGHTS[lightId(p)].state.bri;
    assert.ok(p.body.bri === undefined || p.body.bri <= start, `light ${lightId(p)} never above its start (${p.body.bri} > ${start})`);
  }
  assert.deepEqual(bridge.lights[9].state, LIGHTS[9].state, 'the kitchen is untouched');
});

test('the final Hue off covers the dimmed lights that were on, minus the ones switched off by hand', async t => {
  const { bridge, tick, puts, lightId, touched } = await hueSetup(t);
  smart.startSmartLightDim(600);
  await smart.whenIdle();
  await tick(300);
  bridge.lights[2].state.on = false;
  await tick(150); // the desk lamp answers 201 and is released
  const mark = puts().length;
  const off = await smart.invokeSmartLightOff();
  assert.equal(off.success, true, off.message);
  const offs = puts().slice(mark);
  assert.deepEqual(offs.map(p => [lightId(p), p.body.on]), [['1', false], ['5', false]]);
  assert.equal(touched(3) || touched(9), false, 'lights outside the dim are never addressed');
  assert.equal(bridge.lights[9].state.on, true, 'the kitchen stays on');
});

test('with no room or light selected, the snapshot is the lights that were on and the restore still reads each one live', async t => {
  const { bridge, tick, puts, lightId, touched } = await hueSetup(t, { hueGroupId: '' });
  smart.startSmartLightDim(600);
  await smart.whenIdle();
  await tick(300);
  assert.deepEqual(puts().map(p => [lightId(p), p.body.bri]), [['1', 100], ['2', 50], ['5', 40], ['9', 127]]);
  assert.equal(touched(3), false, 'a light that was off is not a dim target');
  bridge.lights[9].state.on = false;
  const mark = puts().length;
  const restored = await smart.restoreHueOriginalState();
  assert.equal(restored.success, true, restored.message);
  assert.deepEqual(puts().slice(mark).map(p => lightId(p)), ['1', '2', '5']);
  assert.equal(bridge.lights[9].state.on, false, 'switched off before the cancel: left off');
  assert.equal(puts().some(p => p.body.on === true), false);
});

test('the ritual scene and the sunrise never switch on a Hue light that is off', async t => {
  const { bridge, puts, lightId, touched } = await hueSetup(t);
  // Ritual 'night' scene on the Bedroom: lights that are on change, the shelf stays off.
  const scene = await smart.applyScene('night');
  assert.equal(scene.success, true, scene.message);
  assert.equal(bridge.lights[3].state.on, false, 'the scene left the shelf light off');
  assert.equal(puts().some(p => lightId(p) === '3'), false);
  assert.equal(puts().some(p => p.body.on !== undefined), false, 'a scene never sends a power command');
  assert.equal(bridge.lights[1].state.bri, 48);
  assert.equal(bridge.requests.some(r => r.url.includes('/groups/1/action')), false, 'no room-wide on:true');

  // First Light sunrise on two selected lights: the first step may switch
  // them on; once the owner switches one off, it is left alone.
  smart.loadConfig({ hueGroupId: '', hueLightIds: ['1', '3'], enabled: true, verifiedConfigKey: smart.getConfig().verifiedConfigKey });
  assert.equal(smart.getConfig().enabled, false, 'leaving the room is a new setup to verify');
  const cfg = smart.getConfig();
  smart.loadConfig({ enabled: true, verifiedConfigKey: smart.configurationKey(cfg) });
  const released = new Set();
  const step = (brightness, preservePower) => smart.invokeSmartLightAction({ on: true, brightness, colorTemp: 400, transitionTime: 50, preservePower, released });
  assert.equal((await step(25, false)).success, true);
  assert.equal(bridge.lights[3].state.on, true, 'the first sunrise step switches the lights on');
  bridge.lights[3].state.on = false; // the owner switches it off from bed
  const mark = puts().length;
  assert.equal((await step(100, true)).success, true);
  assert.equal(bridge.lights[3].state.on, false, 'the next step leaves it off');
  assert.ok(released.has('3'));
  bridge.lights[3].state.on = true; // switched on by hand again: still the owner's
  await step(200, true);
  assert.equal(puts().slice(mark).some(p => lightId(p) === '3'), false, 'no write to the released light');
  assert.equal(bridge.lights[1].state.bri, 200);
  assert.equal(puts().slice(mark).some(p => p.body.on !== undefined), false);
  assert.equal(touched(9), false);
});

test('a Hue action queued before a reset or a newer run is dropped, not sent', async t => {
  const { bridge, puts } = await hueSetup(t);
  const pending = smart.invokeSmartLightAction({ on: true, brightness: 254 });
  smart.resetSmartLightState(); // a cancel / new countdown supersedes it
  const res = await pending;
  assert.equal(res.success, false);
  assert.equal(res.code, 'SUPERSEDED');
  await smart.whenIdle();
  assert.equal(puts().length, 0, 'nothing reached the bridge');
  assert.equal(bridge.lights[3].state.on, false);
});
