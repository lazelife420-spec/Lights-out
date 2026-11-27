'use strict';
// WiZ resilience: one lost UDP datagram must not drop a light from a run, a
// light that never answered must not be reported as done, and the owner's
// manual control keeps winning. Loopback fake bulbs only (127.0.0.x); no LAN.
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const wiz = require('../wizLights');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// State the owner's real bulb (ESP01_SHRGB1C_31, firmware 1.35.0) reported
// before the 2026-11-26 packaged-app runs: a scene at full brightness.
const REAL_ORIGINAL = { state: true, sceneId: 13, temp: 6500, dimming: 100 };

// Applies a setPilot the way the real bulb reported it in those runs: a
// brightness/colour write keeps the power state, a white temperature or an
// RGB colour ends the scene (sceneId 0), and an off keeps the last dimming.
function applyPilot(pilot, params) {
  if ('state' in params) pilot.state = params.state;
  if ('dimming' in params) pilot.dimming = params.dimming;
  if ('temp' in params) { pilot.temp = params.temp; pilot.sceneId = 0; delete pilot.r; delete pilot.g; delete pilot.b; }
  if ('r' in params) { Object.assign(pilot, { r: params.r, g: params.g, b: params.b, sceneId: 0 }); delete pilot.temp; }
  if ('sceneId' in params) pilot.sceneId = params.sceneId;
}

async function bindSocket(host, port) {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, host, () => { socket.removeListener('error', reject); resolve(); });
  });
  return socket;
}

const closeSocket = socket => new Promise(resolve => { try { socket.close(resolve); } catch { resolve(); } });

// A fake bulb. `online: false` swallows every datagram. `lose(command, bulb)`
// may return 'request' (the datagram never arrives), 'reply' (the bulb
// applies it but the answer is lost) or { send } (answer with `send` instead).
// Only loopback senders are answered.
function emulate(socket, { pilot = { state: true, dimming: 70, temp: 3000 }, online = true, lose = () => false } = {}) {
  const bulb = { ip: socket.address().address, pilot: { ...pilot }, online, lose, received: [] };
  const answer = (reply, remote) => socket.send(Buffer.from(JSON.stringify(reply)), remote.port, remote.address);
  socket.on('message', (raw, remote) => {
    if (!/^127\./.test(remote.address)) return;
    let command;
    try { command = JSON.parse(raw.toString('utf8')); } catch { return; }
    const entry = { method: command.method, params: command.params, raw: raw.toString('utf8'), at: Date.now() };
    bulb.received.push(entry);
    if (!bulb.online) return;
    const loss = bulb.lose(command, bulb);
    if (loss === 'request') return;
    if (loss?.send) return answer(loss.send, remote);
    let reply;
    if (command.method === 'getPilot') {
      reply = { method: 'getPilot', env: 'pro', result: { mac: 'a1b2c3d4e5f6', rssi: -55, src: '', ...bulb.pilot } };
    } else if (command.method === 'setPilot') {
      entry.whileOff = bulb.pilot.state === false && command.params.state !== false;
      applyPilot(bulb.pilot, command.params);
      reply = { method: 'setPilot', env: 'pro', result: { success: true } };
    } else return;
    if (loss === 'reply') return;
    answer(reply, remote);
  });
  bulb.gets = () => bulb.received.filter(entry => entry.method === 'getPilot');
  bulb.sets = () => bulb.received.filter(entry => entry.method === 'setPilot');
  return bulb;
}

// Fake bulbs on 127.0.0.1, 127.0.0.2, ... sharing one free port, as real WiZ
// bulbs share 38899.
async function fakeBulbs(t, specs) {
  for (let attempt = 0; ; attempt++) {
    const sockets = [];
    try {
      sockets.push(await bindSocket('127.0.0.1', 0));
      const port = sockets[0].address().port;
      for (let i = 1; i < specs.length; i++) sockets.push(await bindSocket(`127.0.0.${i + 1}`, port));
      t.after(() => Promise.all(sockets.map(closeSocket)));
      return { port, bulbs: sockets.map((socket, i) => emulate(socket, specs[i])) };
    } catch (error) {
      await Promise.all(sockets.map(closeSocket));
      if (error.code !== 'EADDRINUSE' || attempt >= 4) throw error;
    }
  }
}

// Fake bulbs on the real WiZ port for smartLights, which uses the defaults.
async function fakeBulbsOnWizPort(t, hosts, specs) {
  const sockets = [];
  for (const host of hosts) sockets.push(await bindSocket(host, wiz.PORT));
  t.after(() => Promise.all(sockets.map(closeSocket)));
  return sockets.map((socket, i) => emulate(socket, specs[i]));
}

function gaps(entries) {
  return entries.slice(1).map((entry, i) => entry.at - entries[i].at);
}

// ── request(): retransmission ────────────────────────────────────────────────

test('WiZ request resends a lost getPilot every 300 ms and answers from the retransmit', async t => {
  let lost = 0;
  const { port, bulbs: [bulb] } = await fakeBulbs(t, [{ lose: () => (lost++ === 0 ? 'request' : false) }]);
  const reply = await wiz.request(bulb.ip, 'getPilot', {}, { port });
  assert.equal(reply.success, true, JSON.stringify(reply));
  assert.equal(reply.result.state, true);
  assert.equal(bulb.gets().length, 2);
  assert.equal(bulb.gets()[1].raw, bulb.gets()[0].raw, 'the retransmit is the same datagram');
  assert.ok(gaps(bulb.gets())[0] >= 250, `resent after ${gaps(bulb.gets())[0]} ms`);
  assert.equal(wiz.RETRANSMIT_MS, 300);
});

test('WiZ request resends a setPilot whose reply was lost; the bulb applies the same change again', async t => {
  let lost = 0;
  const { port, bulbs: [bulb] } = await fakeBulbs(t, [{ lose: command => (command.method === 'setPilot' && lost++ === 0 ? 'reply' : false) }]);
  const reply = await wiz.request(bulb.ip, 'setPilot', { dimming: 20 }, { port, timeoutMs: 600, retransmitMs: 100 });
  assert.equal(reply.success, true, JSON.stringify(reply));
  assert.deepEqual(bulb.sets().map(entry => entry.params), [{ dimming: 20 }, { dimming: 20 }]);
  assert.equal(bulb.sets()[1].raw, bulb.sets()[0].raw);
  assert.equal(bulb.pilot.dimming, 20);
  assert.equal(bulb.pilot.state, true, 'a brightness write never asserts power');
});

test('WiZ request ignores unrelated replies and stops resending at the first matching one', async t => {
  const { port, bulbs: [bulb] } = await fakeBulbs(t, [{}]);
  bulb.lose = (command, self) => {
    const seen = self.gets().length;
    if (seen === 1) return { send: { method: 'setPilot', result: { success: true } } }; // another method's answer
    if (seen === 2) return { send: { method: 'getPilot', result: { mac: 'a1b2c3d4e5f6' } } }; // no power state
    if (seen === 3) return 'request';
    return false;
  };
  const started = Date.now();
  const reply = await wiz.request(bulb.ip, 'getPilot', {}, { port, timeoutMs: 1000, retransmitMs: 100 });
  assert.equal(reply.success, true, JSON.stringify(reply));
  assert.equal(reply.result.state, true);
  assert.equal(bulb.gets().length, 4);
  assert.ok(Date.now() - started < 1000);
  await wait(350);
  assert.equal(bulb.gets().length, 4, 'nothing is resent after the answer');
});

test('WiZ request keeps resending until its timeout, then stops', async t => {
  const { port, bulbs: [bulb] } = await fakeBulbs(t, [{ online: false }]);
  const started = Date.now();
  const reply = await wiz.request(bulb.ip, 'setPilot', { state: false }, { port, timeoutMs: 1150 });
  const elapsed = Date.now() - started;
  assert.equal(reply.code, 'TIMEOUT');
  assert.ok(elapsed >= 1100 && elapsed < 1700, `timeout honoured (${elapsed} ms)`);
  const sent = bulb.sets().length;
  assert.ok(sent >= 3 && sent <= 4, `${sent} datagrams in 1150 ms at a 300 ms cadence`);
  assert.ok(gaps(bulb.sets()).every(gap => gap >= 250), `gaps ${gaps(bulb.sets())}`);
  assert.ok(bulb.sets().every(entry => entry.raw === bulb.sets()[0].raw));
  await wait(700);
  assert.equal(bulb.sets().length, sent, 'no datagram after the timeout');
});

test('WiZ rejection is final: a device error is not resent', async t => {
  const { port, bulbs: [bulb] } = await fakeBulbs(t, [{
    lose: command => ({ send: command.method === 'setPilot'
      ? { method: 'setPilot', result: { success: false } }
      : { method: 'getPilot', error: { code: -32601, message: 'Method not found' } } })
  }]);
  const options = { port, retransmitMs: 50 };
  assert.equal((await wiz.request(bulb.ip, 'setPilot', { state: false }, options)).code, 'DEVICE_REJECTED');
  assert.equal((await wiz.request(bulb.ip, 'getPilot', {}, options)).code, 'DEVICE_REJECTED');
  await wait(200);
  assert.deepEqual(bulb.received.map(entry => entry.method), ['setPilot', 'getPilot']);
});

// ── readStates / dimStates: a light that did not answer at dim start ─────────

const FAST = { timeoutMs: 250, retransmitMs: 50 };

test('A light silent at dim start stays in the snapshot as unreached instead of being dropped', async t => {
  const { port, bulbs: [online, silent] } = await fakeBulbs(t, [{}, { online: false }]);
  const snapshot = await wiz.readStates([online.ip, silent.ip], { port, ...FAST });
  assert.equal(snapshot.length, 2, 'both configured lights are part of the run');
  assert.equal(snapshot[0].ip, online.ip); assert.equal(snapshot[0].unreached, undefined);
  assert.equal(snapshot[1].ip, silent.ip); assert.equal(snapshot[1].unreached, true);
  assert.ok(silent.gets().length >= 2, 'the dim-start read was retransmitted');
  assert.equal(silent.sets().length, 0);
});

test('Dim reports PARTIAL while a configured light has never answered, and keeps dimming the others', async t => {
  const { port, bulbs: [online, silent] } = await fakeBulbs(t, [{}, { online: false }]);
  const options = { port, ...FAST };
  const snapshot = await wiz.readStates([online.ip, silent.ip], options);
  const dim = await wiz.dimStates(snapshot, 0.5, false, options);
  assert.equal(dim.success, false);
  assert.equal(dim.code, 'PARTIAL');
  assert.equal(dim.unreached, 1);
  assert.deepEqual(online.sets().map(entry => entry.params), [{ dimming: 35 }]);
  assert.equal(silent.sets().length, 0);
  assert.ok(silent.gets().length > 0, 'the silent light is probed again on the tick');
});

test('A light that comes back mid-run is dimmed from its own live state and restored to it', async t => {
  const { port, bulbs: [online, late] } = await fakeBulbs(t, [{}, { online: false, pilot: { state: true, dimming: 80, sceneId: 13, temp: 6500 } }]);
  const options = { port, ...FAST };
  const snapshot = await wiz.readStates([online.ip, late.ip], options);
  assert.equal(snapshot[1]?.unreached, true, 'the silent light is kept for the run');
  late.online = true;
  const dim = await wiz.dimStates(snapshot, 0.5, false, options);
  assert.equal(dim.success, true); assert.equal(dim.code, 'OK');
  assert.equal(snapshot[1].unreached, undefined, 'it answered, so it is no longer unreached');
  assert.equal(snapshot[1].pilot.dimming, 80, 'its live state is the restore point');
  assert.deepEqual(late.sets().map(entry => entry.params), [{ dimming: 40 }]);
  const restored = await wiz.restoreStates(snapshot, options);
  assert.equal(restored.code, 'RESTORED');
  assert.deepEqual(late.sets().map(entry => entry.params), [{ dimming: 40 }, { dimming: 80, sceneId: 13 }]);
  assert.deepEqual(online.sets().map(entry => entry.params), [{ dimming: 35 }, { dimming: 70, temp: 3000 }]);
  assert.equal(late.pilot.state, true); assert.equal(late.pilot.dimming, 80); assert.equal(late.pilot.sceneId, 13);
  assert.ok([...online.sets(), ...late.sets()].every(entry => !('state' in entry.params)), 'neither dim nor restore asserts power');
});

test('A light first reached while off is yielded: dim and restore never power it on', async t => {
  const { port, bulbs: [online, late] } = await fakeBulbs(t, [{}, { online: false }]);
  const options = { port, ...FAST };
  const snapshot = await wiz.readStates([online.ip, late.ip], options);
  late.pilot = { state: false, dimming: 50 };
  late.online = true;
  assert.equal((await wiz.dimStates(snapshot, 0.5, false, options)).success, true);
  assert.equal(snapshot[1]?.released, true, 'an off light belongs to the owner for the run');
  assert.equal(snapshot[1].pilot.state, false);
  late.pilot.state = true; // A manual on later still belongs to the owner.
  await wiz.dimStates(snapshot, 0.7, false, options);
  await wiz.restoreStates(snapshot, options);
  assert.equal(late.sets().length, 0);
});

test('A light that never answers is never written from its placeholder state', async t => {
  const { port, bulbs: [online, silent] } = await fakeBulbs(t, [{}, { online: false }]);
  const options = { port, ...FAST };
  const snapshot = await wiz.readStates([online.ip, silent.ip], options);
  for (const progress of [0.3, 0.6]) await wiz.dimStates(snapshot, progress, true, options);
  const restored = await wiz.restoreStates(snapshot, options);
  assert.equal(restored.success, true, 'restore touches only lights a dim changed');
  assert.equal(silent.sets().length, 0);
  assert.ok(silent.received.every(entry => entry.method === 'getPilot'), 'only reads ever reached the silent light');
});

// ── smartLights timer completion over the real adapter ───────────────────────

function enableWiz(smart, addresses) {
  const cfg = { provider: 'wiz', mode: 'gradual_dim', dimMinutes: 1, timerBeacon: false, wizAddresses: addresses, wizLook: { mode: 'current' } };
  smart.loadConfig({ ...cfg, enabled: false });
  smart.loadConfig({ ...cfg, enabled: true, verifiedConfigKey: smart.configurationKey(smart.getConfig()) });
  assert.equal(smart.getConfig().enabled, true);
}

async function until(predicate, every, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    every();
    await wait(50);
  }
}

test('Timer completion turns off a light that never answered at dim start and reports PARTIAL', async t => {
  const smart = require('../smartLights');
  t.after(() => { smart.resetSmartLightState(); smart.loadConfig({ provider: 'none', enabled: false }); });
  const hosts = ['127.0.0.211', '127.0.0.212'];
  const [online, silent] = await fakeBulbsOnWizPort(t, hosts, [{}, { online: false }]);
  smart.resetSmartLightState();
  enableWiz(smart, hosts);
  smart.startSmartLightDim(60);
  // The dim tick only runs once the dim-start snapshot exists.
  await until(() => online.sets().length > 0, () => smart.updateSmartLightTick(59));
  const off = await smart.invokeSmartLightOff();
  assert.equal(off.success, false, JSON.stringify(off));
  assert.equal(off.code, 'PARTIAL');
  assert.match(off.message, /1 of 2/);
  assert.ok(silent.sets().some(entry => entry.params.state === false), 'the final off still targets the silent light');
  assert.equal(online.pilot.state, false);
});

test('Timer completion off survives one lost off datagram', async t => {
  const smart = require('../smartLights');
  t.after(() => { smart.resetSmartLightState(); smart.loadConfig({ provider: 'none', enabled: false }); });
  let lost = 0;
  const [bulb] = await fakeBulbsOnWizPort(t, ['127.0.0.213'], [{
    lose: command => (command.method === 'setPilot' && command.params.state === false && lost++ === 0 ? 'request' : false)
  }]);
  smart.resetSmartLightState();
  enableWiz(smart, [bulb.ip]);
  smart.startSmartLightDim(60);
  await until(() => bulb.sets().length > 0, () => smart.updateSmartLightTick(59));
  const off = await smart.invokeSmartLightOff();
  assert.equal(off.success, true, JSON.stringify(off));
  assert.equal(bulb.pilot.state, false);
  assert.equal(bulb.sets().filter(entry => entry.params.state === false).length, 2, 'the off was resent once');
});

// ── Real-bulb semantics recorded on 2026-11-26 must stay true ────────────────

test('Real-bulb replay: gradual dim changes only brightness, and cancel restores the scene without a power command', async t => {
  const { port, bulbs: [bulb] } = await fakeBulbs(t, [{ pilot: REAL_ORIGINAL }]);
  const options = { port, timeoutMs: 400, retransmitMs: 60 };
  const snapshot = await wiz.readStates([bulb.ip], options);
  for (const progress of [0.03, 0.07, 0.11, 0.16, 0.2, 0.24, 0.28, 0.32]) {
    assert.equal((await wiz.dimStates(snapshot, progress, false, options)).success, true);
  }
  const dims = bulb.sets().map(entry => entry.params);
  // The real bulb reported exactly this brightness sequence with scene 13 kept.
  assert.deepEqual(dims, [97, 93, 89, 84, 80, 76, 72, 68].map(dimming => ({ dimming })));
  assert.equal(bulb.pilot.sceneId, 13);
  // Cancel, with the first restore datagram lost on the way to the bulb.
  let lost = 0;
  bulb.lose = command => (command.method === 'setPilot' && lost++ === 0 ? 'request' : false);
  const restored = await wiz.restoreStates(snapshot, options);
  assert.equal(restored.code, 'RESTORED', JSON.stringify(restored));
  const restores = bulb.sets().slice(dims.length);
  assert.equal(restores.length, 2);
  assert.equal(restores[1].raw, restores[0].raw);
  assert.deepEqual(restores[0].params, { dimming: 100, sceneId: 13 });
  assert.ok(!restores[0].raw.includes('"state"'), 'restore never sends a power command');
  assert.deepEqual({ state: bulb.pilot.state, dimming: bulb.pilot.dimming, sceneId: bulb.pilot.sceneId, temp: bulb.pilot.temp }, REAL_ORIGINAL);
});

test('Real-bulb replay: a phone off during a warm dim wins for the rest of the run, even over a lossy link', async t => {
  const { port, bulbs: [bulb] } = await fakeBulbs(t, [{ pilot: REAL_ORIGINAL }]);
  const options = { port, timeoutMs: 400, retransmitMs: 60 };
  const snapshot = await wiz.readStates([bulb.ip], options);
  for (const progress of [0.03, 0.07, 0.11]) await wiz.dimStates(snapshot, progress, true, options);
  assert.equal(bulb.pilot.sceneId, 0, 'warm white replaces the scene, as the real bulb reported');
  assert.equal(bulb.pilot.state, true);
  const writes = bulb.sets().length;
  bulb.pilot.state = false; // Phone app off; the bulb keeps its last dimming.
  // The read that observes the off loses its first datagram.
  let lost = 0;
  bulb.lose = command => (command.method === 'getPilot' && lost++ === 0 ? 'request' : false);
  assert.equal((await wiz.dimStates(snapshot, 0.16, true, options)).success, true);
  assert.equal(snapshot[0].released, true, 'the manual off is observed through the retransmit');
  bulb.lose = () => false;
  for (const progress of [0.2, 0.24]) await wiz.dimStates(snapshot, progress, true, options);
  await wiz.restoreStates(snapshot, options);
  assert.equal(bulb.sets().length, writes, 'no write after the manual off, including cancel');
  assert.equal(bulb.pilot.state, false, 'cancel leaves it off');
  bulb.pilot.state = true; // A manual on again still belongs to the owner.
  await wiz.dimStates(snapshot, 0.3, true, options);
  assert.equal(bulb.sets().length, writes);
  assert.ok(bulb.sets().every(entry => !('state' in entry.params) && !entry.whileOff), 'dims never assert power or write an off light');
});
