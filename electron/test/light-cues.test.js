'use strict';

// Light cues: patterns and every safety rule, with fake WiZ / Hue providers
// and a fake clock. Nothing here touches a real device, the LAN or a timer.
const test = require('node:test');
const assert = require('node:assert/strict');
const lc = require('../lightCues');
const { restorePilot } = require('../wizLights');

const A = '192.168.0.21';
const B = '192.168.0.22';
const C = '192.168.0.23';
const ALL_ON = Object.freeze({ bedtime: true, autopilotSoon: true, remote: true });
const WARM = Object.freeze({ state: true, dimming: 80, temp: 3000 });
const SCENE = Object.freeze({ state: true, dimming: 40, sceneId: 14 });
const TEMP = Object.freeze({ state: true, dimming: 75, temp: 4000 });
const RGB = Object.freeze({ state: true, dimming: 55, r: 255, g: 20, b: 147, c: 0, w: 0 });
const PHONE_PAUSE = Object.freeze({ action: 'pause', source: 'phone' });
const VIOLET = { r: 124, g: 92, b: 255 };
const AMBER = { r: 255, g: 192, b: 0 };
const TEAL = { r: 0, g: 209, b: 178 };

// ── Fakes ───────────────────────────────────────────────────────────────────

async function flush() {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
}

// A cue that is skipped (or a stop() while idle) answers at once: no clock
// needed, no light touched. Fails loudly instead of hanging on a mutant.
async function immediate(promise) {
  let settled = false;
  let value;
  promise.then(result => { settled = true; value = result; });
  await flush();
  assert.equal(settled, true, 'expected an immediate answer without device contact');
  return value;
}

function createClock(start = Date.UTC(2026, 10, 26, 21, 0, 0)) {
  let current = start;
  let seq = 0;
  const timers = new Map();
  const earliest = () => {
    let best = null;
    for (const timer of timers.values()) if (!best || timer.at < best.at || (timer.at === best.at && timer.id < best.id)) best = timer;
    return best;
  };
  const fire = timer => { timers.delete(timer.id); current = Math.max(current, timer.at); timer.fn(); };
  let wallOffset = 0;
  const clock = {
    now: () => current,
    wall: () => current + wallOffset,
    stepWall: ms => { wallOffset += ms; },
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { id, fn, at: current + Math.max(0, Number(ms) || 0) }); return id; },
    clearTimeout: id => { timers.delete(id); },
    pending: () => timers.size,
    sleep: ms => new Promise(resolve => clock.setTimeout(resolve, ms)),
    // Run timers in order until the promise settles (or the predicate holds).
    async run(until, maxMs = 30 * 60 * 1000) {
      let done = until;
      if (typeof until !== 'function') {
        let settled = false;
        Promise.resolve(until).then(() => { settled = true; }, () => { settled = true; });
        done = () => settled;
      }
      const limit = current + maxMs;
      for (;;) {
        await flush();
        if (done()) return;
        const timer = earliest();
        if (!timer) throw new Error('fake clock went idle before the condition held');
        if (timer.at > limit) throw new Error('fake clock limit reached');
        fire(timer);
      }
    },
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        await flush();
        const timer = earliest();
        if (!timer || timer.at > target) break;
        fire(timer);
      }
      current = target;
      await flush();
    }
  };
  return clock;
}

// WiZ modes are exclusive (scene / white temperature / RGB). A setPilot
// without `state` changes the look but never power, as the repo documents
// for the WiZ local API (wizLights dimStates).
function applyPilot(bulb, params) {
  const has = key => params[key] !== undefined;
  if (has('state')) bulb.state = params.state;
  if (has('sceneId')) { for (const key of ['temp', 'r', 'g', 'b', 'c', 'w']) delete bulb[key]; bulb.sceneId = params.sceneId; }
  else if (has('temp')) { for (const key of ['sceneId', 'r', 'g', 'b', 'c', 'w']) delete bulb[key]; bulb.temp = params.temp; }
  else if (['r', 'g', 'b', 'c', 'w'].some(has)) {
    delete bulb.sceneId; delete bulb.temp;
    for (const key of ['r', 'g', 'b', 'c', 'w']) if (has(key)) bulb[key] = params[key];
  }
  if (has('dimming')) bulb.dimming = params.dimming;
}

// lose(entry): the reply is lost but the command lands; like wizLights.request
// the fake then retransmits it every 300 ms until its own timeoutMs (1500 by
// default), and each retransmit lands again.
function createWiz(clock, initial, { latency = 0, hang = () => false, lose = () => false, failRead = () => false } = {}) {
  const bulbs = new Map(Object.entries(initial).map(([ip, pilot]) => [ip, { ...pilot }]));
  const calls = [];
  return {
    bulbs,
    calls,
    restorePilot,
    writes: ip => calls.filter(call => call.method === 'setPilot' && (!ip || call.ip === ip)),
    request(ip, method, params = {}, options) {
      const entry = { at: clock.now(), ip, method, params: JSON.parse(JSON.stringify(params)), options: options ? { ...options } : undefined };
      calls.push(entry);
      if (hang(entry)) return new Promise(() => {});
      if (method === 'getPilot' && failRead(entry)) { entry.reply = { success: false, code: 'TIMEOUT' }; return Promise.resolve(entry.reply); }
      if (method === 'setPilot' && lose(entry)) {
        const providerTimeout = options && Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1500;
        const land = () => { const bulb = bulbs.get(ip); if (bulb) applyPilot(bulb, params); };
        land();
        for (let at = 300; at < providerTimeout; at += 300) clock.setTimeout(() => { entry.resends = (entry.resends || 0) + 1; land(); }, at);
        return new Promise(resolve => clock.setTimeout(() => resolve({ success: false, code: 'TIMEOUT' }), providerTimeout));
      }
      const respond = () => {
        const bulb = bulbs.get(ip);
        if (!bulb) return (entry.reply = { success: false, code: 'TIMEOUT' });
        if (method === 'getPilot') return (entry.reply = { success: true, result: { ...bulb, mac: 'aabbccddeeff', rssi: -55 } });
        applyPilot(bulb, params);
        return (entry.reply = { success: true, result: { success: true } });
      };
      const delay = typeof latency === 'function' ? latency(entry) : latency;
      return delay > 0 ? clock.sleep(delay).then(respond) : Promise.resolve(respond());
    }
  };
}

function createHue(clock, initial, { failList = () => false } = {}) {
  const lights = new Map(Object.entries(initial));
  const calls = [];
  return {
    lights,
    calls,
    sets: id => calls.filter(call => call.method === 'set' && (!id || call.id === id)),
    listLightStates(options) {
      calls.push({ at: clock.now(), method: 'list', options });
      if (failList()) return Promise.resolve({ success: false, code: 'HTTP_503' });
      return Promise.resolve({ success: true, lights: [...lights].map(([id, on]) => ({ id, on, bri: 200, ct: 366 })) });
    },
    setLightState(id, state, options) {
      calls.push({ at: clock.now(), method: 'set', id, state: JSON.parse(JSON.stringify(state)), options });
      return Promise.resolve({ success: true });
    }
  };
}

function wizConfig(over = {}) {
  return { provider: 'wiz', enabled: true, verifiedForSetup: true, wizAddresses: [A, B], cues: { ...ALL_ON }, ...over };
}

function hueConfig(over = {}) {
  return { provider: 'hue', enabled: true, verifiedForSetup: true, cues: { ...ALL_ON }, ...over };
}

function setup({
  config = wizConfig(), app = { dryRun: false },
  bulbs = { [A]: { ...WARM }, [B]: { ...SCENE } }, hueLights = { 1: true, 2: false, 3: true },
  wizOptions, hueOptions, engine = {}
} = {}) {
  const clock = createClock();
  const wiz = createWiz(clock, bulbs, wizOptions);
  const hue = createHue(clock, hueLights, hueOptions);
  const logs = [];
  const state = { config, app, dim: false };
  const cues = lc.createLightCues({
    getConfig: () => state.config,
    getAppSettings: () => state.app,
    isDimActive: () => state.dim,
    wiz, hue,
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    serialize: (provider, task) => task(),
    log: (event, data) => logs.push({ event, data }),
    ...engine
  });
  const play = async promise => { await clock.run(promise); return promise; };
  return { clock, wiz, hue, logs, state, cues, play };
}

function assertPowerless(wiz) {
  for (const call of wiz.writes()) assert.equal('state' in call.params, false, `setPilot to ${call.ip} carried a power field`);
}

// Every write is preceded, since that bulb's last write, by a live read that
// succeeded and found the bulb on.
function assertReadBeforeEveryWrite(wiz) {
  const lastRead = new Map();
  for (const call of wiz.calls) {
    if (call.method === 'getPilot') lastRead.set(call.ip, call);
    else {
      const read = lastRead.get(call.ip);
      assert.ok(read, `setPilot to ${call.ip} at ${call.at} without a fresh live read`);
      assert.ok(read.reply && read.reply.success === true && read.reply.result.state === true,
        `setPilot to ${call.ip} at ${call.at} after a read that failed or found it off`);
      lastRead.delete(call.ip);
    }
  }
}

function assertCalmWrites(writes) {
  for (let i = 1; i < writes.length; i++) {
    assert.ok(writes[i].at - writes[i - 1].at >= lc.FRAME_MS, `two light changes ${writes[i].at - writes[i - 1].at} ms apart`);
  }
  for (const write of writes) assert.ok(writes.filter(other => other.at >= write.at && other.at < write.at + 1000).length <= 2, 'more than two changes in a second');
}

// ── Patterns ────────────────────────────────────────────────────────────────

function assertCalmPattern(pattern) {
  const { frames, durationMs, floor } = pattern;
  assert.equal(frames[0].atMs, 0);
  assert.equal(frames[0].level, 1, 'a cue starts at the bulb\'s own level');
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].atMs - frames[i - 1].atMs >= lc.FRAME_MS, 'at most two changes per second');
    assert.ok(Math.abs(frames[i].level - frames[i - 1].level) <= 0.5 + 1e-9, 'no hard jump between frames');
  }
  assert.ok(durationMs - frames.at(-1).atMs >= lc.FRAME_MS, 'the restore keeps the same spacing');
  // The restore (the bulb's own level, level 1) is the top of the last
  // breath: the pattern rises into it with no bigger step than any frame.
  assert.ok(frames.length < 2 || frames.at(-1).level >= frames.at(-2).level, 'rising into the restore');
  assert.ok(1 - frames.at(-1).level <= 0.5, 'a calm step into the restore');
  for (const frame of frames) {
    assert.ok(frame.level <= 1 && frame.level >= floor - 1e-9, 'never brighter than the room, never below the floor');
    assert.deepEqual(frame.look, frames[0].look, 'one colour for the whole cue: no flicker');
    assert.equal('state' in frame.look, false);
  }
  const changes = [...frames.map(frame => frame.atMs), durationMs];
  for (const at of changes) assert.ok(changes.filter(other => other >= at && other < at + 1000).length <= 2);
}
const dips = pattern => pattern.frames.filter(frame => frame.level === pattern.floor).map(frame => frame.atMs);

test('settings: every cue defaults off and only an explicit true opts in', () => {
  assert.deepEqual(lc.normalizeCueSettings(), { bedtime: false, autopilotSoon: false, remote: false });
  assert.deepEqual({ ...lc.DEFAULT_CUE_SETTINGS }, { bedtime: false, autopilotSoon: false, remote: false });
  assert.deepEqual(lc.normalizeCueSettings({ bedtime: 'true', autopilotSoon: 1, remote: true, strobe: true }),
    { bedtime: false, autopilotSoon: false, remote: true });
  for (const junk of [null, [true, true, true], 'all', 7]) assert.deepEqual(lc.normalizeCueSettings(junk), lc.DEFAULT_CUE_SETTINGS);
  assert.deepEqual([...lc.CUE_NAMES], ['bedtime', 'autopilotSoon', 'remote']);
});

test('bedtime pattern: three slow warm breaths to 35% of the bulb\'s own level, nine seconds', () => {
  const pattern = lc.cuePattern('bedtime');
  assert.equal(pattern.label, 'Wind-down heads-up');
  assert.equal(pattern.durationMs, 9000);
  assert.equal(pattern.frames.length, 18);
  assert.deepEqual({ ...pattern.frames[0].look }, { temp: 2700 });
  assert.equal(pattern.floor, 0.35);
  assert.deepEqual(dips(pattern), [1500, 4500, 7500], 'one dip per 3-second breath');
  assertCalmPattern(pattern);
  assert.deepEqual({ count: pattern.hue.count, spacingMs: pattern.hue.spacingMs }, { count: 3, spacingMs: 3000 });
});

test('autopilotSoon pattern: two slow violet breaths (bulb rendering of the app accent), six seconds', () => {
  const pattern = lc.cuePattern('autopilotSoon');
  assert.equal(pattern.label, 'Autopilot starts soon');
  assert.equal(pattern.durationMs, 6000);
  assert.equal(pattern.frames.length, 12);
  assert.deepEqual({ ...pattern.frames[0].look }, VIOLET);
  assert.deepEqual(lc.hexToRgb('#9b93d6'), { r: 155, g: 147, b: 214 }, 'the UI token is unchanged');
  assert.deepEqual(dips(pattern), [1500, 4500]);
  assertCalmPattern(pattern);
  assert.deepEqual({ count: pattern.hue.count, spacingMs: pattern.hue.spacingMs }, { count: 2, spacingMs: 3000 });
});

test('remote pattern: one soft double pulse in 2.5 s, coloured by the action', () => {
  const colours = { pause: AMBER, snooze: VIOLET, cancel: TEAL };
  for (const [action, rgb] of Object.entries(colours)) {
    const pattern = lc.cuePattern('remote', { action });
    assert.equal(pattern.durationMs, 2500);
    assert.deepEqual(pattern.frames.map(frame => frame.level), [1, 0.5, 1, 0.5, 1], 'two soft dips, back to the top');
    assert.deepEqual({ ...pattern.frames[0].look }, rgb);
    assertCalmPattern(pattern);
    assert.deepEqual({ count: pattern.hue.count, spacingMs: pattern.hue.spacingMs }, { count: 2, spacingMs: 1250 });
  }
  assert.equal(lc.REMOTE_COLORS.pause, '#f5b83d');
  assert.equal(lc.REMOTE_COLORS.snooze, '#9b93d6');
  assert.equal(lc.REMOTE_COLORS.cancel, '#00ffd1');
  assert.equal(lc.cuePattern('remote', { action: 'resume' }), null);
  assert.equal(lc.cuePattern('remote'), null);
  assert.equal(lc.cuePattern('strobe'), null);
  assert.equal(lc.cuePattern('constructor'), null);
});

test('WiZ frame params dip relative to the bulb\'s own level, stay within 10..current, and carry no power', () => {
  const dip = { level: 0.35, look: { temp: 2700 } };
  assert.deepEqual(lc.wizFrameParams(dip, { state: true, dimming: 80, temp: 4000 }), { dimming: 28, temp: 2700 });
  assert.deepEqual(lc.wizFrameParams(dip, { state: true, dimming: 20, temp: 3000 }), { dimming: 10, temp: 2700 }, 'WiZ minimum');
  assert.deepEqual(lc.wizFrameParams({ level: 1, look: TEAL }, { state: true, dimming: 64, temp: 3000 }), { dimming: 64, ...TEAL });
  assert.deepEqual(lc.wizFrameParams({ level: 1, look: TEAL }, { state: true, dimming: 60, sceneId: 14 }), { dimming: 48, ...TEAL }, 'colour on a scene is capped at 80%');
  for (const name of lc.CUE_NAMES) {
    const pattern = lc.cuePattern(name, { action: 'cancel' });
    for (let dimming = 10; dimming <= 100; dimming += 3) {
      for (const frame of pattern.frames) {
        const params = lc.wizFrameParams(frame, { state: true, dimming });
        assert.ok(params.dimming >= 10 && params.dimming <= dimming, `${name}: ${params.dimming} outside 10..${dimming}`);
        assert.equal('state' in params, false);
      }
    }
  }
});

test('WiZ restore params use restorePilot semantics minus state, and refuse what cannot be put back', () => {
  assert.deepEqual(lc.wizRestoreParams({ state: true, dimming: 40, sceneId: 14, speed: 100, mac: 'x', rssi: -60 }, restorePilot), { dimming: 40, sceneId: 14 });
  assert.deepEqual(lc.wizRestoreParams(TEMP, restorePilot), { dimming: 75, temp: 4000 });
  assert.deepEqual(lc.wizRestoreParams(RGB, restorePilot), { dimming: 55, r: 255, g: 20, b: 147, c: 0, w: 0 });
  assert.equal(lc.wizRestoreParams({ state: false, dimming: 50, temp: 2700 }, restorePilot), null, 'an off bulb is never restored');
  assert.equal(lc.wizRestoreParams({ state: true, temp: 2700 }, restorePilot), null, 'no level to return to');
  assert.equal(lc.wizRestoreParams({ state: true, dimming: 50 }, restorePilot), null, 'no colour to return to');
  assert.deepEqual(lc.wizRestoreParams(WARM, () => ({ state: true, dimming: 80, temp: 3000 })), { dimming: 80, temp: 3000 }, 'state is always stripped');
  assert.equal(lc.wizRestoreParams(WARM, () => { throw new Error('boom'); }), null);
  assert.equal(lc.wizRestoreParams(WARM, undefined), null);
});

test('a run fights a cue only while it is actually dimming; a paused run is not active', () => {
  assert.equal(lc.isRunDimming({ running: true, paused: false, dimStarted: true, dryRun: false }), true);
  assert.equal(lc.isRunDimming({ running: true, paused: true, dimStarted: true, dryRun: false }), false);
  assert.equal(lc.isRunDimming({ running: true, paused: false, dimStarted: false }), false);
  assert.equal(lc.isRunDimming({ running: true, paused: false, dimStarted: true, dryRun: true }), false);
  assert.equal(lc.isRunDimming(), false);
});

// ── Rule 1: opt-in ──────────────────────────────────────────────────────────

test('rule 1 opt-in: an automatic cue runs only when its own flag is on; preview ignores the flag', async () => {
  const s = setup({ config: wizConfig({ cues: { bedtime: false, autopilotSoon: true, remote: false } }) });
  assert.equal((await immediate(s.cues.cue('bedtime'))).code, 'SKIPPED_DISABLED');
  assert.equal((await immediate(s.cues.cue('remote', PHONE_PAUSE))).code, 'SKIPPED_DISABLED');
  s.state.config = wizConfig({ cues: undefined });
  assert.equal((await immediate(s.cues.cue('autopilotSoon'))).code, 'SKIPPED_DISABLED', 'no saved setting means off');
  s.state.config = wizConfig({ cues: { bedtime: 'yes', autopilotSoon: 1, remote: false } });
  assert.equal((await immediate(s.cues.cue('bedtime'))).code, 'SKIPPED_DISABLED');
  assert.equal((await immediate(s.cues.cue('autopilotSoon'))).code, 'SKIPPED_DISABLED');
  assert.equal(s.wiz.calls.length, 0, 'a disabled cue never contacts a light');

  const preview = await s.play(s.cues.preview('bedtime'));
  assert.equal(preview.code, 'OK');
  assert.equal(preview.preview, true);
  assert.equal(preview.touched, 2);
  assert.equal(preview.restored, 2);

  s.state.config = wizConfig({ cues: { bedtime: false, autopilotSoon: true, remote: false } });
  assert.equal((await s.play(s.cues.cue('autopilotSoon'))).code, 'OK', 'each flag is independent');
});

// ── Rule 2: Test Mode ───────────────────────────────────────────────────────

test('rule 2 Test Mode: cues are skipped, a Test Mode run is skipped, preview still works', async () => {
  const s = setup({ app: { dryRun: true } });
  assert.equal((await immediate(s.cues.cue('bedtime'))).code, 'SKIPPED_TEST_MODE');
  assert.equal((await immediate(s.cues.cue('autopilotSoon'))).code, 'SKIPPED_TEST_MODE');
  assert.equal((await immediate(s.cues.cue('remote', PHONE_PAUSE))).code, 'SKIPPED_TEST_MODE');
  s.state.app = { dryRun: false };
  assert.equal((await immediate(s.cues.cue('remote', { ...PHONE_PAUSE, dryRun: true }))).code, 'SKIPPED_TEST_MODE', 'a rehearsal run never drives lights');
  assert.equal(s.wiz.calls.length, 0);

  s.state.app = { dryRun: true };
  const preview = await s.play(s.cues.preview('remote', { action: 'cancel' }));
  assert.equal(preview.code, 'OK');
  assert.ok(s.wiz.writes(A).some(write => write.params.g === 209 && write.params.b === 178), 'the teal cancel pulse played');

  s.state.app = { dryRun: false };
  assert.equal((await s.play(s.cues.cue('remote', PHONE_PAUSE))).code, 'OK', 'a skipped cue did not use up the rate limit');
});

// ── Rule 3: never wakes a dark room ─────────────────────────────────────────

test('rule 3: a bulb that is off is never written to, and no frame or restore carries power', async () => {
  const s = setup({ bulbs: { [A]: { ...WARM }, [B]: { state: false, dimming: 50, temp: 2700 } } });
  const result = await s.play(s.cues.cue('bedtime'));
  assert.equal(result.code, 'OK');
  assert.equal(result.touched, 1);
  assert.equal(result.skippedOff, 1);
  assert.equal(result.restored, 1);
  assert.equal(s.wiz.writes(B).length, 0);
  assert.equal(s.wiz.bulbs.get(B).state, false);
  assertPowerless(s.wiz);
  assertReadBeforeEveryWrite(s.wiz);

  const dark = setup({ bulbs: { [A]: { state: false, dimming: 50, temp: 2700 }, [B]: { state: false, dimming: 30, sceneId: 14 } } });
  const nothing = await dark.play(dark.cues.preview('remote', { action: 'cancel' }));
  assert.equal(nothing.code, 'SKIPPED_NO_LIGHTS_ON');
  assert.equal(nothing.skippedOff, 2);
  assert.equal(dark.wiz.writes().length, 0);
});

test('rule 3: switching a bulb off mid-cue stops every write to it at once; on again stays the user\'s', async () => {
  const s = setup();
  const start = s.clock.now();
  const pending = s.cues.cue('bedtime');
  s.clock.setTimeout(() => { s.wiz.bulbs.get(A).state = false; }, 2200);
  s.clock.setTimeout(() => { s.wiz.bulbs.get(A).state = true; }, 5000);
  const result = await s.play(pending);
  assert.equal(result.code, 'OK');
  assert.equal(result.released, 1);
  assert.equal(result.restored, 1);
  const writesToA = s.wiz.writes(A);
  assert.ok(writesToA.length > 0);
  assert.ok(writesToA.every(write => write.at - start < 2200), 'nothing after the manual off');
  assert.ok(writesToA.every(write => write.params.temp === 2700), 'no restore to a light the user took over');
  const afterOff = s.wiz.calls.filter(call => call.ip === A && call.at - start >= 2200);
  assert.deepEqual(afterOff.map(call => call.method), ['getPilot'], 'one read found it off; then it was left alone');
  assert.deepEqual(s.wiz.bulbs.get(B), { ...SCENE }, 'the other light still came back exactly');
  assertPowerless(s.wiz);
  assertReadBeforeEveryWrite(s.wiz);
});

test('rule 3: an unreachable bulb is never written blind', async () => {
  const s = setup({ config: wizConfig({ wizAddresses: [A, C] }), bulbs: { [A]: { ...WARM } } });
  const result = await s.play(s.cues.cue('autopilotSoon'));
  assert.equal(result.code, 'OK');
  assert.equal(result.unreachable, 1);
  assert.equal(s.wiz.writes(C).length, 0);
  assert.deepEqual(s.wiz.bulbs.get(A), { ...WARM });
});

// ── Rule 4: exact restore ───────────────────────────────────────────────────

test('rule 4: every cue restores scene, white and colour bulbs to their exact pre-cue pilot', async () => {
  const cases = [['bedtime'], ['autopilotSoon'], ['remote', { action: 'cancel', source: 'family' }], ['remote', { action: 'snooze', source: 'phone' }]];
  for (const [name, context] of cases) {
    const originals = { [A]: SCENE, [B]: TEMP, [C]: RGB };
    const s = setup({ config: wizConfig({ wizAddresses: [A, B, C] }), bulbs: { [A]: { ...SCENE }, [B]: { ...TEMP }, [C]: { ...RGB } } });
    const result = await s.play(s.cues.cue(name, context));
    assert.equal(result.code, 'OK', name);
    assert.equal(result.touched, 3);
    assert.equal(result.restored, 3);
    for (const [ip, original] of Object.entries(originals)) {
      assert.deepEqual(s.wiz.bulbs.get(ip), { ...original }, `${name}: ${ip} came back exactly`);
      const writes = s.wiz.writes(ip);
      assert.deepEqual(writes.at(-1).params, lc.wizRestoreParams(original, restorePilot), 'the last write is the restore');
      assert.ok(writes.length > 2, 'the cue was actually shown');
      assertCalmWrites(writes);
    }
    assertPowerless(s.wiz);
    assertReadBeforeEveryWrite(s.wiz);
  }
});

test('rule 4: a bulb switched off just before the restore is left off', async () => {
  const s = setup();
  const start = s.clock.now();
  const pending = s.cues.cue('bedtime');
  s.clock.setTimeout(() => { s.wiz.bulbs.get(B).state = false; }, 8700); // after the last frame, before the restore
  const result = await s.play(pending);
  assert.equal(result.restored, 1);
  assert.equal(result.released, 1);
  assert.equal(s.wiz.writes(B).filter(write => write.at - start >= 8700).length, 0);
  assert.equal(s.wiz.bulbs.get(B).state, false);
  assert.deepEqual(s.wiz.bulbs.get(A), { ...WARM });
  assertPowerless(s.wiz);
});

test('WiZ cue writes are calm: >= 500 ms apart, two per second at most, never brighter than the room', async () => {
  const s = setup();
  const start = s.clock.now();
  await s.play(s.cues.cue('bedtime'));
  for (const [ip, original] of [[A, WARM], [B, SCENE]]) {
    const writes = s.wiz.writes(ip);
    assert.equal(writes.length, 19, '18 frames and one restore');
    assertCalmWrites(writes);
    const frames = writes.slice(0, -1);
    const warmth = original.sceneId ? undefined : 2700; // a scene keeps its own look
    assert.ok(frames.every(write => write.params.temp === warmth && write.params.dimming <= original.dimming));
    const floor = Math.round(original.dimming * 0.35);
    assert.equal(frames.filter(write => write.params.dimming === floor).length, 3, 'three breaths');
    assert.equal(writes.at(-1).at - start, 9000);
  }
});

// ── Rule 5: never fights a run ──────────────────────────────────────────────

test('rule 5: a countdown that is dimming the lights wins; a paused run does not block', async () => {
  const s = setup();
  s.state.dim = true;
  assert.equal((await immediate(s.cues.cue('bedtime'))).code, 'SKIPPED_RUN_ACTIVE');
  assert.equal((await immediate(s.cues.preview('remote', { action: 'pause' }))).code, 'SKIPPED_RUN_ACTIVE');
  assert.equal(s.wiz.calls.length, 0);

  const run = { running: true, paused: true, dimStarted: true, dryRun: false };
  const p = setup({ engine: { isDimActive: () => lc.isRunDimming(run) } });
  assert.equal((await p.play(p.cues.cue('remote', PHONE_PAUSE))).code, 'OK', 'the phone paused the run: the pulse plays');
});

test('rule 5: if the run starts dimming mid-cue the cue stops at once and restores', async () => {
  const run = { running: true, paused: true, dimStarted: true, dryRun: false };
  const s = setup({ engine: { isDimActive: () => lc.isRunDimming(run) } });
  const start = s.clock.now();
  const pending = s.cues.cue('bedtime');
  s.clock.setTimeout(() => { run.paused = false; }, 3100);
  const result = await s.play(pending);
  assert.equal(result.code, 'INTERRUPTED_RUN_ACTIVE');
  assert.equal(result.restored, 2);
  for (const [ip, original] of [[A, WARM], [B, SCENE]]) {
    const late = s.wiz.writes(ip).filter(write => write.at - start > 3100);
    assert.deepEqual(late.map(write => write.params), [lc.wizRestoreParams(original, restorePilot)], 'only the restore after the run took over');
    assert.ok(late[0].at - start <= 3500, 'restored within one frame');
    assert.deepEqual(s.wiz.bulbs.get(ip), { ...original });
  }
});

// ── Rule 6: configured, verified lights ─────────────────────────────────────

test('rule 6: cues need an enabled, verified lights setup', async () => {
  const variants = [
    wizConfig({ enabled: false }),
    wizConfig({ verifiedForSetup: false }),
    { provider: 'wiz', enabled: true, verifiedConfigKey: 'wiz:192.168.0.21', wizAddresses: [A], cues: { ...ALL_ON } },
    wizConfig({ provider: 'none' }),
    wizConfig({ provider: 'mqtt' }),
    wizConfig({ wizAddresses: [] })
  ];
  for (const config of variants) {
    const s = setup({ config });
    assert.equal((await immediate(s.cues.cue('bedtime'))).code, 'SKIPPED_NOT_CONFIGURED', JSON.stringify(config));
    assert.equal((await immediate(s.cues.preview('bedtime'))).code, 'SKIPPED_NOT_CONFIGURED');
    assert.equal(s.wiz.calls.length, 0);
  }
  const none = setup({ config: null });
  assert.equal((await immediate(none.cues.preview('remote'))).code, 'SKIPPED_NOT_CONFIGURED');
  const noHueAdapter = setup({ config: hueConfig(), engine: { hue: {} } });
  assert.equal((await immediate(noHueAdapter.cues.preview('bedtime'))).code, 'SKIPPED_NOT_CONFIGURED');
  const unwired = lc.createLightCues({ wiz: { request: () => assert.fail('contacted a light') } });
  assert.equal((await immediate(unwired.cue('bedtime'))).code, 'SKIPPED_NOT_CONFIGURED');
  assert.equal((await immediate(unwired.preview('bedtime'))).code, 'SKIPPED_NOT_CONFIGURED');
});

// ── Rule 7: single-flight and rate limits ───────────────────────────────────

test('rule 7: one cue at a time; a cue requested meanwhile is dropped, not queued', async () => {
  const s = setup();
  const first = s.cues.cue('bedtime');
  assert.equal(s.cues.isBusy(), true);
  assert.equal((await immediate(s.cues.cue('remote', PHONE_PAUSE))).code, 'SKIPPED_BUSY');
  assert.equal((await immediate(s.cues.preview('autopilotSoon'))).code, 'SKIPPED_BUSY');
  assert.equal((await s.play(first)).code, 'OK');
  assert.equal(s.cues.isBusy(), false);
  const calls = s.wiz.calls.length;
  await s.clock.advance(60 * 1000);
  assert.equal(s.wiz.calls.length, calls, 'the dropped cue never ran later');
  assert.ok(s.wiz.writes().every(write => write.params.r === undefined), 'only the bedtime look ever reached the lights');
});

test('rule 7: remote at most once per 10 s, bedtime once per 10 min, on the injected clock', async () => {
  const s = setup();
  const t0 = s.clock.now();
  assert.equal((await s.play(s.cues.cue('remote', PHONE_PAUSE))).code, 'OK');
  assert.equal((await immediate(s.cues.cue('remote', { action: 'snooze', source: 'family' }))).code, 'SKIPPED_RATE_LIMITED');
  await s.clock.advance(t0 + 9999 - s.clock.now());
  assert.equal((await immediate(s.cues.cue('remote', { action: 'cancel', source: 'phone' }))).code, 'SKIPPED_RATE_LIMITED');
  await s.clock.advance(1);
  assert.equal((await s.play(s.cues.cue('remote', { action: 'cancel', source: 'phone' }))).code, 'OK');

  const t1 = s.clock.now();
  assert.equal((await s.play(s.cues.cue('bedtime'))).code, 'OK');
  await s.clock.advance(t1 + 9 * 60 * 1000 - s.clock.now());
  assert.equal((await immediate(s.cues.cue('bedtime'))).code, 'SKIPPED_RATE_LIMITED');
  assert.equal((await s.play(s.cues.preview('bedtime'))).code, 'OK', 'preview is explicit and not rate limited');
  await s.clock.advance(t1 + 10 * 60 * 1000 - s.clock.now());
  assert.equal((await s.play(s.cues.cue('bedtime'))).code, 'OK');

  const fresh = setup();
  assert.equal((await fresh.play(fresh.cues.preview('remote'))).code, 'OK');
  assert.equal((await fresh.play(fresh.cues.cue('remote', PHONE_PAUSE))).code, 'OK', 'a preview does not use up the automatic budget');

  const custom = setup({ engine: { rateLimitMs: { remote: 60 * 1000 } } });
  assert.equal((await custom.play(custom.cues.cue('remote', PHONE_PAUSE))).code, 'OK');
  await custom.clock.advance(30 * 1000);
  assert.equal((await immediate(custom.cues.cue('remote', PHONE_PAUSE))).code, 'SKIPPED_RATE_LIMITED');
});

test('autopilotSoon signals once per armed fire and never for a fire time already past', async () => {
  const s = setup();
  const fireAt = new Date(s.clock.now() + 30 * 60 * 1000).toISOString();
  assert.equal((await s.play(s.cues.cue('autopilotSoon', { fireAt }))).code, 'OK');
  await s.clock.advance(11 * 60 * 1000);
  assert.equal((await immediate(s.cues.cue('autopilotSoon', { fireAt }))).code, 'SKIPPED_ALREADY_SIGNALLED', 'a re-arm of the same fire');
  assert.equal((await immediate(s.cues.cue('autopilotSoon', { fireAt: new Date(s.clock.now() - 1000).toISOString() }))).code, 'SKIPPED_STALE');
  assert.equal((await immediate(s.cues.cue('autopilotSoon', { fireAt: 'tonight' }))).code, 'SKIPPED_INVALID_CONTEXT');
  const nextNight = new Date(Date.parse(fireAt) + 24 * 60 * 60 * 1000).getTime();
  assert.equal((await s.play(s.cues.cue('autopilotSoon', { fireAt: nextNight }))).code, 'OK');
});

test('remote cues need a real phone/family action; preview defaults to the amber pause pulse', async () => {
  const s = setup();
  for (const context of [undefined, {}, { action: 'resume', source: 'phone' }, { action: 'pause', source: 'desktop' }, { action: 'pause' }, 'cancel']) {
    assert.equal((await immediate(s.cues.cue('remote', context))).code, 'SKIPPED_INVALID_CONTEXT', JSON.stringify(context));
  }
  assert.equal(s.wiz.calls.length, 0);
  const preview = await s.play(s.cues.preview('remote'));
  assert.equal(preview.code, 'OK');
  assert.equal(preview.action, 'pause');
  assert.ok(s.wiz.writes(A).some(write => write.params.r === 255 && write.params.g === 192 && write.params.b === 0));
  const family = await s.play(s.cues.cue('remote', { action: 'snooze', source: 'family' }));
  assert.deepEqual([family.action, family.source], ['snooze', 'family']);
});

// ── Rule 8: bounded, never throws, never blocks ─────────────────────────────

test('rule 8: every provider call times out; a silent network ends the cue in one call timeout', async () => {
  const s = setup({ wizOptions: { hang: () => true } });
  const t0 = s.clock.now();
  const result = await s.play(s.cues.cue('bedtime'));
  assert.equal(result.code, 'SKIPPED_UNREACHABLE');
  assert.equal(result.unreachable, 2);
  assert.equal(s.clock.now() - t0, lc.DEFAULT_CALL_TIMEOUT_MS);
  assert.equal(s.cues.isBusy(), false);
  assert.equal(s.clock.pending(), 0, 'no timer left behind');
});

test('rule 8: a restore that never answers is retried once, bounded, and reported', async () => {
  const s = setup({ wizOptions: { hang: call => call.method === 'setPilot' && call.ip === A && call.params.temp === 3000 } });
  const result = await s.play(s.cues.cue('bedtime'));
  assert.equal(result.code, 'RESTORE_PARTIAL');
  assert.equal(result.restoreFailed, 1);
  assert.equal(result.restored, 1);
  assert.equal(s.wiz.writes(A).filter(write => write.params.temp === 3000).length, 2);
  assert.equal(s.cues.isBusy(), false);
  assert.equal(s.clock.pending(), 0);
});

test('rule 8: the hard deadline answers the caller; no frame starts after it; the restore still lands', async () => {
  const s = setup({
    config: wizConfig({ wizAddresses: [A] }), bulbs: { [A]: { ...WARM } },
    wizOptions: { latency: 1000 }, engine: { callTimeoutMs: 10000, deadlineSlackMs: 500 }
  });
  const t0 = s.clock.now();
  const result = await s.play(s.cues.cue('remote', PHONE_PAUSE));
  assert.equal(result.code, 'DEADLINE_EXCEEDED');
  assert.equal(s.clock.now() - t0, 2500 + lc.CUE_GAP_MS + 500, '2.5 s pattern + cue gap allowance + 0.5 s slack');
  assert.equal(s.cues.isBusy(), true, 'the bounded restore still owns the lights');
  assert.equal((await immediate(s.cues.cue('bedtime'))).code, 'SKIPPED_BUSY');
  await s.clock.run(() => !s.cues.isBusy());
  assert.deepEqual(s.wiz.bulbs.get(A), { ...WARM }, 'restored after the deadline');
  for (const write of s.wiz.writes(A)) if (write.at - t0 >= 4500) assert.deepEqual(write.params, { dimming: 80, temp: 3000 });
  assert.ok(s.logs.some(entry => entry.event === 'light-cue-late' && entry.data.restored === 1 && entry.data.late === true));
  assert.equal(s.clock.pending(), 0);
});

test('rule 8: cue() never throws or rejects, whatever the inputs or providers do', async () => {
  const boom = () => { throw new Error('boom'); };
  for (const deps of [undefined, null, 'x', {}]) {
    const cues = lc.createLightCues(deps);
    assert.equal((await immediate(cues.cue('bedtime'))).code, 'SKIPPED_NOT_CONFIGURED');
    assert.equal(await immediate(cues.stop()), false);
  }
  const names = [undefined, 42, {}, Symbol('x'), 'constructor', '__proto__', 'strobe'];
  const s = setup();
  for (const name of names) assert.equal((await immediate(s.cues.cue(name))).code, 'SKIPPED_UNKNOWN_CUE');
  const trap = new Proxy({}, { get: boom });
  assert.equal((await immediate(s.cues.cue('bedtime', trap))).code, 'SKIPPED_ERROR');

  for (const engine of [{ getConfig: boom }, { getAppSettings: boom }, { isDimActive: boom }, { getAppSettings: () => null }]) {
    const e = setup({ engine });
    await assert.doesNotReject(async () => assert.equal((await e.play(e.cues.cue('bedtime'))).code, 'SKIPPED_ERROR'));
    assert.equal(e.wiz.calls.length, 0);
  }

  const providers = [
    { request: boom, restorePilot },
    { request: () => Promise.reject(new Error('nope')), restorePilot },
    { request: () => null, restorePilot },
    { request: () => ({ success: true, result: 'on' }), restorePilot }
  ];
  for (const wiz of providers) {
    const e = setup({ engine: { wiz } });
    const result = await e.play(e.cues.cue('bedtime'));
    assert.equal(result.code, 'SKIPPED_UNREACHABLE');
    assert.equal(e.cues.isBusy(), false);
  }
  const noRestore = setup({ engine: { wiz: { request: (...args) => noRestore.wiz.request(...args), restorePilot: boom } } });
  assert.equal((await noRestore.play(noRestore.cues.cue('bedtime'))).code, 'SKIPPED_NO_LIGHTS_ON');
  assert.equal(noRestore.wiz.writes().length, 0, 'a light that could not be put back is left alone');

  const loud = setup({ engine: { log: boom } });
  assert.equal((await loud.play(loud.cues.cue('bedtime'))).code, 'OK');

  for (const serialize of [boom, () => undefined, () => Promise.reject(new Error('queue'))]) {
    const e = setup({ engine: { serialize } });
    assert.equal((await e.play(e.cues.cue('bedtime'))).code, 'FAILED');
    assert.equal(e.cues.isBusy(), false);
  }
});

test('rule 8: cue() returns at once, contacts no light in the caller\'s tick, and an unawaited cue is safe', async t => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));

  const s = setup();
  const pending = s.cues.cue('bedtime');
  assert.ok(pending instanceof Promise);
  assert.equal(s.wiz.calls.length, 0, 'no device contact inside the caller\'s tick');

  const rejecting = setup({ engine: { wiz: { request: () => Promise.reject(new Error('lan down')), restorePilot } } });
  rejecting.cues.cue('bedtime'); // fire-and-forget, as the timer path will call it
  await rejecting.clock.run(() => !rejecting.cues.isBusy());
  await s.play(pending);
  await flush();
  assert.deepEqual(unhandled, []);
});

test('stop() aborts the running cue and restores what it touched', async () => {
  const s = setup();
  const start = s.clock.now();
  const pending = s.cues.cue('bedtime');
  let stopped = null;
  s.clock.setTimeout(() => { stopped = s.cues.stop(); }, 4100);
  const result = await s.play(pending);
  assert.equal(result.code, 'STOPPED');
  assert.equal(await stopped, true);
  assert.equal(s.cues.isBusy(), false);
  for (const [ip, original] of [[A, WARM], [B, SCENE]]) {
    assert.deepEqual(s.wiz.bulbs.get(ip), { ...original });
    const late = s.wiz.writes(ip).filter(write => write.at - start > 4100);
    assert.deepEqual(late.map(write => write.params), [lc.wizRestoreParams(original, restorePilot)]);
  }
  assert.equal(await immediate(s.cues.stop()), false);
});

test('provider work runs inside the injected serialize queue, after work already queued', async () => {
  let chain = Promise.resolve();
  const order = [];
  const serialize = (provider, task) => {
    order.push(`cue:${provider}`);
    const next = chain.then(task);
    chain = next.catch(() => {});
    return next;
  };
  const s = setup({ engine: { serialize } });
  const t0 = s.clock.now();
  // e.g. the cancel restore smartLights queued just before the remote cue
  chain = chain.then(() => s.clock.sleep(1000)).then(() => order.push('restore-done'));
  const result = await s.play(s.cues.cue('remote', { action: 'cancel', source: 'phone' }));
  assert.equal(result.code, 'OK');
  assert.deepEqual(order, ['cue:wiz', 'restore-done']);
  assert.ok(s.wiz.calls[0].at - t0 >= 1000, 'the cue read the lights only after the queued restore');
});

// ── Rule 9: Hue native breathe; webhook unsupported ─────────────────────────

test('rule 9 Hue: native {alert:"select"} breathes on lights that are on, by the pattern\'s count and spacing', async () => {
  const expectations = [['bedtime', undefined, 3, 3000], ['autopilotSoon', undefined, 2, 3000], ['remote', PHONE_PAUSE, 2, 1250]];
  for (const [name, context, count, spacing] of expectations) {
    const s = setup({ config: hueConfig() });
    const result = await s.play(s.cues.cue(name, context));
    assert.equal(result.code, 'OK', name);
    assert.equal(result.provider, 'hue');
    assert.equal(result.touched, 2);
    assert.equal(result.skippedOff, 1);
    assert.equal(result.restored, 0, 'an alert changes no state, so there is nothing to restore');
    assert.equal(s.hue.sets('2').length, 0, 'the light that is off is never alerted');
    for (const call of s.hue.sets()) assert.deepEqual(call.state, { alert: 'select' }, 'no on/bri/ct, ever');
    for (const id of ['1', '3']) {
      const sets = s.hue.sets(id);
      assert.equal(sets.length, count);
      for (let i = 1; i < sets.length; i++) assert.equal(sets[i].at - sets[i - 1].at, spacing);
    }
    assert.equal(s.hue.sets('3')[0].at - s.hue.sets('1')[0].at, 120, 'bridge calls are paced');
    assert.equal(s.hue.calls.filter(call => call.method === 'list').length, count, 'live state re-read before each round');
  }
});

test('rule 9 Hue: a light switched off mid-cue gets no further alert; an unreadable bridge gets none', async () => {
  const s = setup({ config: hueConfig() });
  const start = s.clock.now();
  const pending = s.cues.cue('bedtime');
  s.clock.setTimeout(() => s.hue.lights.set('3', false), 1000);
  const result = await s.play(pending);
  assert.equal(result.released, 1);
  assert.equal(s.hue.sets('3').filter(call => call.at - start >= 1000).length, 0);
  assert.equal(s.hue.sets('1').length, 3);

  const down = setup({ config: hueConfig(), hueOptions: { failList: () => true } });
  const unreachable = await down.play(down.cues.preview('bedtime'));
  assert.equal(unreachable.code, 'SKIPPED_UNREACHABLE');
  assert.equal(down.hue.sets().length, 0);

  let reads = 0;
  const flaky = setup({ config: hueConfig(), hueOptions: { failList: () => ++reads === 2 } });
  const partial = await flaky.play(flaky.cues.cue('bedtime'));
  assert.equal(partial.code, 'PARTIAL');
  assert.equal(flaky.hue.sets('1').length, 2, 'the round with no live state was skipped, not sent blind');
});

test('rule 9 webhook: an HTTP webhook has no state to restore, so cues are unsupported', async () => {
  const s = setup({ config: { provider: 'http', enabled: true, verifiedForSetup: true, cues: { ...ALL_ON } } });
  for (const name of lc.CUE_NAMES) {
    assert.equal((await immediate(s.cues.cue(name, PHONE_PAUSE))).code, 'SKIPPED_UNSUPPORTED_PROVIDER');
    assert.equal((await immediate(s.cues.preview(name))).code, 'SKIPPED_UNSUPPORTED_PROVIDER');
  }
  assert.equal(s.wiz.calls.length + s.hue.calls.length, 0);
});

test('results are structured, frozen and logged without addresses', async () => {
  const s = setup();
  const result = await s.play(s.cues.cue('bedtime'));
  for (const key of ['cue', 'provider', 'code', 'touched', 'skippedOff', 'restored']) assert.ok(key in result, key);
  assert.equal(Object.isFrozen(result), true);
  assert.ok(lc.RESULT_CODES.includes(result.code));
  const entry = s.logs.find(item => item.event === 'light-cue');
  assert.equal(entry.data.cue, 'bedtime');
  assert.equal(JSON.stringify(s.logs).includes('192.168.'), false);
});

// ── Review findings: regression guards ──────────────────────────────────────

test('serialize is required: an engine without the provider queue never contacts a light', async () => {
  const s = setup({ engine: { serialize: undefined } });
  assert.equal((await immediate(s.cues.cue('bedtime'))).code, 'SKIPPED_NOT_CONFIGURED');
  assert.equal((await immediate(s.cues.preview('remote', { action: 'cancel' }))).code, 'SKIPPED_NOT_CONFIGURED');
  assert.equal(s.wiz.calls.length, 0);
});

test('monotonic timing: a backward wall-clock step mid-cue cannot stretch the cue or hold the restore', async () => {
  const s = setup({ engine: { now: () => s.clock.wall(), monoNow: () => s.clock.now() } });
  const t0 = s.clock.now();
  const pending = s.cues.cue('bedtime');
  s.clock.setTimeout(() => s.clock.stepWall(-60 * 60 * 1000), 4200);
  const result = await s.play(pending);
  assert.equal(result.code, 'OK');
  assert.equal(s.clock.now() - t0, 9000, 'restored on time');
  assert.deepEqual(s.wiz.bulbs.get(A), { ...WARM });
  assert.equal(s.cues.isBusy(), false);

  // Even a monotonic source that jumps (bad injection) is clamped: every wait
  // is at most one frame or one pattern.
  let jump = 0;
  const j = setup({ engine: { monoNow: () => j.clock.now() - jump } });
  const j0 = j.clock.now();
  const pendingJ = j.cues.cue('bedtime');
  j.clock.setTimeout(() => { jump = 60 * 60 * 1000; }, 4200);
  let stopped = null;
  j.clock.setTimeout(() => { stopped = j.cues.stop(); }, 6000);
  await j.play(pendingJ);
  await j.clock.run(() => stopped !== null && !j.cues.isBusy(), 60 * 1000);
  assert.equal(await stopped, true);
  assert.ok(j.clock.now() - j0 < 15000, `finished at +${j.clock.now() - j0} ms`);
  assert.deepEqual(j.wiz.bulbs.get(A), { ...WARM });
  assert.deepEqual(j.wiz.bulbs.get(B), { ...SCENE });
});

test('user takes over mid-cue: a manual dim or a new scene stops every write and is never undone', async () => {
  const changes = [
    ['dim', bulb => { bulb.dimming = 15; }],
    ['scene', bulb => { delete bulb.temp; bulb.sceneId = 6; bulb.dimming = 15; }],
    ['colour', bulb => { delete bulb.temp; Object.assign(bulb, { r: 255, g: 80, b: 0 }); }]
  ];
  for (const [label, change] of changes) {
    const s = setup();
    const start = s.clock.now();
    const pending = s.cues.cue('bedtime');
    let userLook = null;
    s.clock.setTimeout(() => { change(s.wiz.bulbs.get(A)); userLook = { ...s.wiz.bulbs.get(A) }; }, 4100);
    const result = await s.play(pending);
    assert.equal(result.takenOver, 1, label);
    assert.equal(result.restored, 1, `${label}: the other light still came back`);
    assert.equal(s.wiz.writes(A).filter(write => write.at - start >= 4100).length, 0, `${label}: no write after the user's change`);
    assert.deepEqual(s.wiz.bulbs.get(A), userLook, `${label}: the user's look stays`);
    assert.deepEqual(s.wiz.bulbs.get(B), { ...SCENE });
  }
  // Just before the restore counts too.
  const late = setup();
  const pendingLate = late.cues.cue('remote', { action: 'cancel', source: 'phone' });
  late.clock.setTimeout(() => { late.wiz.bulbs.get(A).dimming = 30; }, 2300);
  const lateResult = await late.play(pendingLate);
  assert.equal(lateResult.takenOver, 1);
  assert.equal(late.wiz.bulbs.get(A).dimming, 30);
  assert.equal(late.wiz.bulbs.get(A).g, 209, 'left as the user found it, not restored over their change');
});

test('provider budget: every WiZ call carries a timeout below the engine one, so a late resend cannot undo the restore', async () => {
  let s0 = 0;
  const s = setup({
    config: wizConfig({ wizAddresses: [A] }), bulbs: { [A]: { ...WARM } },
    // the reply to the last remote frame (level 1, at +2000) is lost; the command and its resends land
    wizOptions: { lose: call => call.params.g === 209 && call.params.dimming === 80 && call.at - s0 >= 2000 }
  });
  s0 = s.clock.now();
  const result = await s.play(s.cues.cue('remote', { action: 'cancel', source: 'phone' }));
  await s.clock.advance(5000);
  for (const call of s.wiz.calls) {
    assert.ok(call.options && call.options.timeoutMs <= lc.DEFAULT_CALL_TIMEOUT_MS - lc.PROVIDER_TIMEOUT_MARGIN_MS, `${call.method} without a smaller provider timeout`);
  }
  const lost = s.wiz.writes(A).find(write => write.reply === undefined);
  assert.ok(lost && lost.resends > 0, 'the lost write was retransmitted');
  assert.equal(result.code, 'PARTIAL');
  assert.equal(result.restored, 1, 'a write that timed out but landed is still restored (M9)');
  assert.deepEqual(s.wiz.bulbs.get(A), { ...WARM }, 'no resend landed after the restore');
});

test('back-to-back cues never abut: every bulb keeps writes >= FRAME_MS apart and the next cue waits the gap', async () => {
  const s = setup();
  await s.play(s.cues.preview('remote', { action: 'cancel' }));
  const boundary = s.wiz.writes(A).at(-1).at;
  await s.play(s.cues.preview('remote', { action: 'snooze' }));
  await s.play(s.cues.cue('bedtime'));
  for (const ip of [A, B]) assertCalmWrites(s.wiz.writes(ip));
  const next = s.wiz.writes(A).find(write => write.at > boundary);
  assert.ok(next.at - boundary >= lc.CUE_GAP_MS, `next cue ${next.at - boundary} ms after the restore`);
  assert.deepEqual(s.wiz.bulbs.get(A), { ...WARM });
});

test('rule 3: a bulb whose live read fails mid-cue gets no frame, and a failed restore read gets no blind restore', async () => {
  let s0 = 0;
  const s = setup({ wizOptions: { failRead: call => call.ip === A && call.at - s0 >= 2000 && call.at - s0 < 3000 } });
  s0 = s.clock.now();
  const result = await s.play(s.cues.cue('bedtime'));
  assert.ok(result.failed > 0);
  assert.equal(s.wiz.writes(A).filter(write => write.at - s0 >= 2000 && write.at - s0 < 3000).length, 0, 'never written blind (M1)');
  assertReadBeforeEveryWrite(s.wiz);
  assert.deepEqual(s.wiz.bulbs.get(A), { ...WARM });

  // Unreadable at restore time: no restore write at all (M5).
  let r0 = 0;
  const r = setup({ wizOptions: { failRead: call => call.ip === A && call.at - r0 >= 8600 } });
  r0 = r.clock.now();
  const restoreless = await r.play(r.cues.cue('bedtime'));
  assert.equal(restoreless.code, 'RESTORE_PARTIAL');
  assert.equal(restoreless.restoreFailed, 1);
  assert.equal(r.wiz.writes(A).filter(write => write.at - r0 >= 8600).length, 0);
  assertReadBeforeEveryWrite(r.wiz);
});

test('rule 6: lights disabled mid-cue interrupt it and the touched bulbs are restored', async () => {
  const s = setup();
  const pending = s.cues.cue('bedtime');
  s.clock.setTimeout(() => { s.state.config = wizConfig({ enabled: false }); }, 3100);
  const result = await s.play(pending);
  assert.equal(result.code, 'INTERRUPTED_NOT_CONFIGURED');
  assert.equal(result.restored, 2);
  assert.deepEqual(s.wiz.bulbs.get(A), { ...WARM });
  assert.deepEqual(s.wiz.bulbs.get(B), { ...SCENE });
});

test('rule 5 Hue: a run that starts dimming mid-cue gets no further alerts', async () => {
  const s = setup({ config: hueConfig() });
  const start = s.clock.now();
  const pending = s.cues.cue('bedtime');
  s.clock.setTimeout(() => { s.state.dim = true; }, 1000);
  const result = await s.play(pending);
  assert.equal(result.code, 'INTERRUPTED_RUN_ACTIVE');
  assert.equal(s.hue.sets().filter(call => call.at - start >= 1000).length, 0);
  assert.equal(s.hue.sets().length, 2, 'only the first round');
});

test('bedtime keeps a scene or colour bulb look and never makes a white bulb cooler', async () => {
  const NIGHT = { state: true, dimming: 30, sceneId: 14 };
  const ORANGE = { state: true, dimming: 30, r: 255, g: 159, b: 67, c: 0, w: 0 };
  const CANDLE = { state: true, dimming: 60, temp: 2200 };
  const s = setup({ config: wizConfig({ wizAddresses: [A, B, C] }), bulbs: { [A]: { ...NIGHT }, [B]: { ...ORANGE }, [C]: { ...CANDLE } } });
  const result = await s.play(s.cues.cue('bedtime'));
  assert.equal(result.code, 'OK');
  for (const ip of [A, B]) {
    const frames = s.wiz.writes(ip).slice(0, -1);
    assert.ok(frames.length > 2);
    for (const write of frames) assert.deepEqual(Object.keys(write.params), ['dimming'], `${ip}: dimming only`);
  }
  for (const write of s.wiz.writes(C)) assert.ok(write.params.temp <= 2200, `temp ${write.params.temp} above the bulb's 2200 K`);
  assert.deepEqual(s.wiz.bulbs.get(A), NIGHT);
  assert.deepEqual(s.wiz.bulbs.get(B), ORANGE);
  assert.deepEqual(s.wiz.bulbs.get(C), CANDLE);
});

test('low levels: a cue nobody could see is not played; a remote pulse below 25% is carried by colour', async () => {
  const bedtime = lc.cuePattern('bedtime');
  const remote = lc.cuePattern('remote', { action: 'pause' });
  const visible = (pattern, pilot) => lc.wizCueFrames(pattern, pilot).visible;
  for (const dimming of [10, 12, 15]) {
    assert.equal(visible(bedtime, { state: true, dimming, temp: 2700 }), false, `bedtime on 2700 K at ${dimming}`);
    assert.equal(visible(bedtime, { state: true, dimming, sceneId: 14 }), false, `bedtime on a scene at ${dimming}`);
    const plan = lc.wizCueFrames(remote, { state: true, dimming, temp: 2700 });
    assert.equal(plan.hold, true);
    assert.equal(plan.visible, true, 'the colour shows even at the floor');
    assert.ok(plan.frames.every(params => params.dimming === dimming && params.r === 255), 'held at the bulb level, no flicker at the floor');
  }
  assert.equal(visible(bedtime, { state: true, dimming: 12, temp: 3000 }), true, 'a warm shift is visible');
  assert.equal(visible(bedtime, { state: true, dimming: 40, temp: 2700 }), true);
  assert.equal(lc.wizCueFrames(remote, { state: true, dimming: 60, temp: 2700 }).hold, false);

  const s = setup({ bulbs: { [A]: { state: true, dimming: 10, temp: 2700 }, [B]: { state: true, dimming: 12, sceneId: 14 } } });
  const dim = await s.play(s.cues.cue('bedtime'));
  assert.equal(dim.code, 'SKIPPED_TOO_DIM');
  assert.equal(dim.touched, 0);
  assert.equal(dim.tooDim, 2);
  assert.equal(s.wiz.writes().length, 0);

  const low = setup({ config: wizConfig({ wizAddresses: [A] }), bulbs: { [A]: { state: true, dimming: 12, temp: 2400 } } });
  const held = await low.play(low.cues.cue('remote', PHONE_PAUSE));
  assert.equal(held.code, 'OK');
  assert.deepEqual(low.wiz.writes(A).map(write => write.params), [{ dimming: 12, ...AMBER }, { dimming: 12, temp: 2400 }]);
  assert.deepEqual(low.wiz.bulbs.get(A), { state: true, dimming: 12, temp: 2400 });
});

// Tanner Helland's blackbody approximation and HSV, for colour distinctness.
function blackbody(kelvin) {
  const t = kelvin / 100;
  const g = 99.4708025861 * Math.log(t) - 161.1195681661;
  const b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return { r: 255, g: Math.max(0, Math.min(255, g)), b: Math.max(0, Math.min(255, b)) };
}
function hsv({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s: max ? (d / max) * 100 : 0 };
}

test('bulb colours read as colours against warm white, and cancel uses the semantic teal', () => {
  const whites = [2200, 2500, 2700, 3000].map(blackbody).concat([{ r: 255, g: 176, b: 76 }]); // + Hourglass start
  for (const [name, rgb] of Object.entries(lc.BULB_COLORS)) {
    const cue = hsv(rgb);
    for (const white of whites) {
      const w = hsv(white);
      const dh = Math.min(Math.abs(cue.h - w.h), 360 - Math.abs(cue.h - w.h));
      assert.ok(dh >= 15 || Math.abs(cue.s - w.s) >= 25, `${name} too close to ${JSON.stringify(white)}: ${dh.toFixed(1)} deg, ${Math.abs(cue.s - w.s).toFixed(1)} sat`);
    }
    assert.ok(cue.s >= 60, `${name} saturation ${cue.s.toFixed(0)}`);
  }
  assert.deepEqual({ ...lc.BULB_COLORS.cancel }, lc.hexToRgb('#00d1b2'), '--pf-teal, not the logo ink');
  assert.deepEqual({ ...lc.BULB_COLORS.autopilotSoon }, lc.hexToRgb('#7c5cff'));
});

test('Hue: a round only alerts as many lights as fit in the breath spacing, so a double pulse stays two pulses', async () => {
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), true]));
  const s = setup({ config: hueConfig(), hueLights: many });
  const start = s.clock.now();
  const result = await s.play(s.cues.cue('remote', PHONE_PAUSE));
  const plan = lc.cuePattern('remote', PHONE_PAUSE).hue;
  assert.equal(result.code, 'OK');
  assert.equal(result.touched, plan.maxLights);
  assert.equal(result.overCapacity, 12 - plan.maxLights);
  assert.equal(result.framesDropped, 0, 'no breath dropped');
  const sets = s.hue.sets();
  assert.equal(sets.length, plan.maxLights * plan.count);
  const firstRound = sets.slice(0, plan.maxLights);
  assert.ok(firstRound.at(-1).at - start <= plan.spacingMs * 0.6, 'the first round ends well before the second pulse');
  assert.equal(sets[plan.maxLights].at - start, plan.spacingMs);
  for (const call of s.hue.calls) assert.ok(call.options && call.options.timeoutMs > 0, `${call.method} carries a provider timeout`);
});
