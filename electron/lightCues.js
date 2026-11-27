'use strict';

// Light cues: a short, calm signal on the room's smart lights for three
// events. Every cue is opt-in (default off), skipped in Test Mode, never wakes
// a dark room, restores exactly what it changed, and never fights a countdown
// that is dimming the lights. preview() is the explicit Settings action.
//
//   bedtime        "Wind-down heads-up" when the bedtime reminder fires:
//                  three slow breaths, each dipping to 35% of the bulb's own
//                  level and back. 9 s. A white bulb is warmed to 2700 K
//                  (never made cooler); a scene or colour bulb keeps its own
//                  look and only breathes.
//   autopilotSoon  "Autopilot starts soon", 5 min before an Autopilot run:
//                  two slow violet breaths (bulb rendering of the app accent
//                  #9b93d6). 6 s.
//   remote         a phone or family PC paused, snoozed or cancelled tonight's
//                  run: one soft double pulse coloured by the action. 2.5 s.
//                  On a bulb already below 25% the colour carries the signal
//                  instead (held at the bulb's level, no dips).
//
// Lighting rules shared by every pattern: at most two light changes per
// second on any bulb, including across back-to-back cues; a cue never raises
// a bulb's level (a colour cue on a scene or colour bulb is capped at 80% of
// it), the colour is constant for the whole cue, and the restore lands at the
// top of the last breath. The user always wins: a bulb switched off, dimmed,
// recoloured or put in another scene during a cue is released at once and is
// not restored. A bulb that could not show the cue visibly is not touched.
//
// Timing runs on a monotonic clock (monoNow); the wall clock (now) is used
// only for rate limits and the autopilot fire time, so a clock step during a
// cue cannot stretch it. Every wait is clamped.
//
// This module requires nothing. Providers, config, clocks and logging are
// injected (createLightCues) so it is testable with fakes and wired later.

const CUE_NAMES = Object.freeze(['bedtime', 'autopilotSoon', 'remote']);
const REMOTE_ACTIONS = Object.freeze(['pause', 'snooze', 'cancel']);
// Desktop actions are deliberately not a source: the user is at the PC.
const REMOTE_SOURCES = Object.freeze(['phone', 'family']);

const FRAME_MS = 500; // two changes per second at most: calm, never strobe-like
// A bulb's first write of a cue waits this long after its last write of any
// earlier cue, so back-to-back cues (or Preview spam) never abut.
const CUE_GAP_MS = 1500;
const WIZ_MIN_DIMMING = 10;
const WIZ_MAX_DIMMING = 100;
const MAX_WIZ_LIGHTS = 32;
const MAX_HUE_LIGHTS = 16;
const HUE_PACE_MS = 120; // same bridge pacing as smartLights sendToHueTargets
// One alert round (all lights, paced) must finish within this share of the
// breath spacing, or the breaths blur into one rolling chase.
const HUE_ROUND_SHARE = 0.6;
const HUE_ALERT = Object.freeze({ alert: 'select' }); // one native bridge breathe; no state change
const WIZ_LIGHT_FIELDS = Object.freeze(['dimming', 'temp', 'sceneId', 'r', 'g', 'b', 'c', 'w']);
// The provider must give up (and stop retransmitting) before the engine does,
// so a late resend can never land after the restore.
const PROVIDER_TIMEOUT_MARGIN_MS = 100;
const MIN_VISIBLE_DIMMING_RANGE = 6;
const SAME_TEMP_TOLERANCE_K = 100;
const REMOTE_LOW_BASE = 25;
const COLOR_ON_COLOR_CAP = 0.8;

// UI tokens (Settings copy, swatches). Not sent to bulbs.
const ACCENT_LAVENDER = '#9b93d6';
const REMOTE_COLORS = Object.freeze({ pause: '#f5b83d', snooze: ACCENT_LAVENDER, cancel: '#00ffd1' });
// What a bulb is actually sent. Saturated enough to read as a colour against
// warm white on RGB LEDs: amber with no blue, the accent hue as a real
// violet, and the app's semantic safe/healthy teal (--pf-teal).
const BULB_COLORS = Object.freeze({
  pause: Object.freeze({ r: 255, g: 192, b: 0 }),
  snooze: Object.freeze({ r: 124, g: 92, b: 255 }),
  cancel: Object.freeze({ r: 0, g: 209, b: 178 }),
  autopilotSoon: Object.freeze({ r: 124, g: 92, b: 255 })
});

const DEFAULT_CUE_SETTINGS = Object.freeze({ bedtime: false, autopilotSoon: false, remote: false });
const DEFAULT_RATE_LIMIT_MS = Object.freeze({ bedtime: 10 * 60 * 1000, autopilotSoon: 10 * 60 * 1000, remote: 10 * 1000 });
const DEFAULT_CALL_TIMEOUT_MS = 1000;
const DEFAULT_HUE_LIST_TIMEOUT_MS = 2000;
// Covers the worst case of every provider call timing out (initial read, the
// last frame, two restore attempts), so the backstop only fires when the
// light queue is held by other work or a provider ignores its timeout.
const DEFAULT_DEADLINE_SLACK_MS = 9000;

// count breaths (or pulses) of periodMs, sampled every FRAME_MS. Each one
// starts at the bulb's own level, dips to floor x that level at mid-period,
// and comes back. holdMs keeps the cue colour at full level before restore.
const CUE_DEFINITIONS = Object.freeze({
  bedtime: Object.freeze({
    label: 'Wind-down heads-up', count: 3, periodMs: 3000, floor: 0.35, holdMs: 0,
    look: Object.freeze({ temp: 2700 }), hueSpacingMs: 3000
  }),
  autopilotSoon: Object.freeze({
    label: 'Autopilot starts soon', count: 2, periodMs: 3000, floor: 0.35, holdMs: 0,
    color: BULB_COLORS.autopilotSoon, hueSpacingMs: 3000
  }),
  remote: Object.freeze({
    label: 'Tonight\'s run changed from your phone or family PC', count: 2, periodMs: 1000, floor: 0.5, holdMs: 500,
    colorByAction: Object.freeze({ pause: BULB_COLORS.pause, snooze: BULB_COLORS.snooze, cancel: BULB_COLORS.cancel }),
    hueSpacingMs: 1250
  })
});

const REASON_CODES = Object.freeze({
  DEADLINE: 'DEADLINE_EXCEEDED',
  STOPPED: 'STOPPED',
  RUN_ACTIVE: 'INTERRUPTED_RUN_ACTIVE',
  NOT_CONFIGURED: 'INTERRUPTED_NOT_CONFIGURED',
  ERROR: 'INTERRUPTED_ERROR'
});

const RESULT_CODES = Object.freeze([
  'OK', 'PARTIAL', 'RESTORE_PARTIAL', 'FAILED',
  ...Object.values(REASON_CODES),
  'SKIPPED_UNKNOWN_CUE', 'SKIPPED_INVALID_CONTEXT', 'SKIPPED_DISABLED', 'SKIPPED_TEST_MODE',
  'SKIPPED_UNSUPPORTED_PROVIDER', 'SKIPPED_NOT_CONFIGURED', 'SKIPPED_RUN_ACTIVE', 'SKIPPED_BUSY',
  'SKIPPED_RATE_LIMITED', 'SKIPPED_STALE', 'SKIPPED_ALREADY_SIGNALLED', 'SKIPPED_NO_LIGHTS_ON',
  'SKIPPED_TOO_DIM', 'SKIPPED_UNREACHABLE', 'SKIPPED_ERROR'
]);

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

function clampInt(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : min;
}

function hexToRgb(hex) {
  if (typeof hex !== 'string' || !/^#[a-f\d]{6}$/i.test(hex)) return null;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

// Settings sanitizer: only an explicit boolean true opts a cue in.
function normalizeCueSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    bedtime: source.bedtime === true,
    autopilotSoon: source.autopilotSoon === true,
    remote: source.remote === true
  };
}

// The countdown "fights" a cue only while it is actually dimming the lights.
// A paused run is not dimming (its ticks stop) and Test Mode never dims.
function isRunDimming({ running, paused, dimStarted, dryRun } = {}) {
  return running === true && paused !== true && dryRun !== true && dimStarted === true;
}

// Bulb-independent pattern: frames carry a relative level (1 = the bulb's own
// level) and a look. null for an unknown cue or a remote cue without a valid
// action.
function cuePattern(name, context = {}) {
  if (!CUE_NAMES.includes(name)) return null;
  const def = CUE_DEFINITIONS[name];
  let look;
  if (def.look) look = { ...def.look };
  else {
    const action = context && typeof context === 'object' ? context.action : undefined;
    const rgb = def.color || (REMOTE_ACTIONS.includes(action) ? def.colorByAction[action] : null);
    if (!rgb) return null;
    look = { r: rgb.r, g: rgb.g, b: rgb.b };
  }
  const cycleMs = def.count * def.periodMs;
  const lastAt = def.holdMs > 0 ? cycleMs : cycleMs - FRAME_MS;
  const frames = [];
  for (let atMs = 0; atMs <= lastAt; atMs += FRAME_MS) {
    const phase = (atMs % def.periodMs) / def.periodMs;
    const depth = (1 - Math.cos(2 * Math.PI * phase)) / 2; // 0 at the top, 1 at the dip
    const level = Math.round((1 - (1 - def.floor) * depth) * 1000) / 1000;
    frames.push(Object.freeze({ atMs, level, look: Object.freeze({ ...look }) }));
  }
  const hueSpacingMs = def.hueSpacingMs;
  return Object.freeze({
    name,
    label: def.label,
    durationMs: cycleMs + def.holdMs,
    floor: def.floor,
    frames: Object.freeze(frames),
    hue: Object.freeze({
      count: def.count,
      spacingMs: hueSpacingMs,
      durationMs: def.count * hueSpacingMs,
      maxLights: Math.max(1, Math.min(MAX_HUE_LIGHTS, Math.floor(hueSpacingMs * HUE_ROUND_SHARE / HUE_PACE_MS) + 1))
    })
  });
}

function baseDimming(pilot) {
  const dimming = Number(pilot && pilot.dimming);
  return Number.isFinite(dimming) ? clampInt(dimming, WIZ_MIN_DIMMING, WIZ_MAX_DIMMING) : WIZ_MIN_DIMMING;
}

// 'scene' | 'temp' | 'color' | 'unknown'. sceneId 0 means "no scene" on WiZ.
function pilotMode(pilot) {
  if (!pilot || typeof pilot !== 'object') return 'unknown';
  if (Number.isInteger(pilot.sceneId) && pilot.sceneId > 0) return 'scene';
  if (Number.isFinite(pilot.temp)) return 'temp';
  if (['r', 'g', 'b'].every(key => Number.isFinite(pilot[key])) || Number.isFinite(pilot.c) || Number.isFinite(pilot.w)) return 'color';
  return 'unknown';
}

// WiZ setPilot params for one frame on one bulb (same fields as wizLights
// dimStates). Relative to the bulb's own level and never above it. Never
// carries power: no `state` field in any cue frame.
//  - warm cue (look.temp): a white bulb gets min(its temp, look temp), so the
//    room is never made cooler; a scene/colour bulb gets dimming only and
//    keeps its own look (WiZ keeps the scene or colour on a dimming-only
//    setPilot), so it is never switched to brighter white.
//  - colour cue (look.r/g/b): on a scene/colour bulb the level is capped at
//    80% of its own, since a saturated cue colour can out-shine a dim look.
function wizFrameParams(frame, pilot) {
  const base = baseDimming(pilot);
  const raw = Number(frame && frame.level);
  const level = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
  const mode = pilotMode(pilot);
  const look = (frame && frame.look) || {};
  const scaled = Math.round(base * level);
  if (Number.isFinite(look.temp)) {
    const params = { dimming: Math.max(WIZ_MIN_DIMMING, Math.min(base, scaled)) };
    if (mode === 'temp') params.temp = Math.min(clampInt(look.temp, 2200, 6500), clampInt(pilot.temp, 2200, 6500));
    return params;
  }
  const top = mode === 'scene' || mode === 'color' ? Math.max(WIZ_MIN_DIMMING, Math.round(base * COLOR_ON_COLOR_CAP)) : base;
  const params = { dimming: Math.max(WIZ_MIN_DIMMING, Math.min(top, scaled)) };
  for (const key of ['r', 'g', 'b']) params[key] = clampInt(look[key], 0, 255);
  return params;
}

// Does this cue's look differ visibly from the bulb's own look?
function lookDiffers(params, pilot) {
  if (Number.isFinite(params.temp)) return pilotMode(pilot) !== 'temp' || Math.abs(params.temp - pilot.temp) > SAME_TEMP_TOLERANCE_K;
  if (Number.isFinite(params.r)) {
    if (pilotMode(pilot) !== 'color') return true;
    return ['r', 'g', 'b'].some(key => !Number.isFinite(pilot[key]) || Math.abs(pilot[key] - params[key]) > 8);
  }
  return false; // dimming only: the bulb keeps its look
}

// Per-bulb plan: the frame params this bulb will get, and whether the cue
// would be visible on it at all. A remote pulse on a bulb already below 25%
// cannot dip visibly (WiZ floors at 10), so its colour is held at the bulb's
// level instead.
function wizCueFrames(pattern, pilot) {
  const hold = Boolean(pattern && pattern.name === 'remote' && baseDimming(pilot) < REMOTE_LOW_BASE);
  const frames = ((pattern && pattern.frames) || []).map(frame => wizFrameParams(hold ? { ...frame, level: 1 } : frame, pilot));
  if (!frames.length) return { frames, hold, visible: false };
  const levels = frames.map(params => params.dimming);
  const range = Math.max(...levels) - Math.min(...levels);
  const recolours = lookDiffers(frames[0], pilot);
  // The first frame also differs when the colour-on-colour cap lowers it.
  const firstStep = Math.abs(baseDimming(pilot) - frames[0].dimming);
  return { frames, hold, visible: range >= MIN_VISIBLE_DIMMING_RANGE || recolours || firstStep >= MIN_VISIBLE_DIMMING_RANGE };
}

function onlyLightFields(params) {
  const out = {};
  for (const key of WIZ_LIGHT_FIELDS) if (params[key] !== undefined) out[key] = params[key];
  return out;
}

// Pre-cue pilot -> restore params: wizLights.restorePilot semantics minus
// state (a restore never powers a light on). null when the pilot could not
// be put back exactly (no level or no colour/scene/temperature), so the cue
// leaves that bulb alone rather than strand it in the cue colour.
function wizRestoreParams(pilot, restorePilot) {
  if (!pilot || pilot.state !== true || typeof restorePilot !== 'function') return null;
  let params;
  try { params = restorePilot(pilot); } catch { return null; }
  if (!params || typeof params !== 'object') return null;
  params = onlyLightFields(params);
  const hasLook = Number.isInteger(params.sceneId) || Number.isFinite(params.temp)
    || ['r', 'g', 'b'].every(key => Number.isInteger(params[key]))
    || Number.isInteger(params.c) || Number.isInteger(params.w);
  return Number.isFinite(params.dimming) && hasLook ? params : null;
}

// The look a bulb should show: level plus its mode's fields.
function lookOf(pilot) {
  const out = { dimming: Number(pilot && pilot.dimming) };
  const mode = pilotMode(pilot);
  if (mode === 'scene') out.sceneId = pilot.sceneId;
  else if (mode === 'temp') out.temp = pilot.temp;
  else if (mode === 'color') for (const key of ['r', 'g', 'b']) if (Number.isFinite(pilot[key])) out[key] = pilot[key];
  return out;
}

// Expected look after a successful write of params over `expect`.
function expectAfter(expect, params) {
  if (Number.isFinite(params.sceneId)) return { dimming: params.dimming, sceneId: params.sceneId };
  if (Number.isFinite(params.temp)) return { dimming: params.dimming, temp: params.temp };
  if (Number.isFinite(params.r)) return { dimming: params.dimming, r: params.r, g: params.g, b: params.b };
  return { ...expect, dimming: params.dimming };
}

// Does the live pilot still show what the engine last put there? A
// difference means the user took the bulb over (dimmed it, changed its
// colour or picked a scene) and the user wins.
function liveMatches(live, expect) {
  if (!expect) return true;
  if (Number.isFinite(live.dimming) && Number.isFinite(expect.dimming) && Math.abs(live.dimming - expect.dimming) > 1) return false;
  const want = pilotMode(expect);
  const have = pilotMode(live);
  if (want === 'unknown') return true;
  if (want !== have) return false;
  if (want === 'scene') return live.sceneId === expect.sceneId;
  if (want === 'temp') return Math.abs(live.temp - expect.temp) <= 50;
  return ['r', 'g', 'b'].every(key => !Number.isFinite(expect[key]) || (Number.isFinite(live[key]) && Math.abs(live[key] - expect[key]) <= 3));
}

function sameParams(a, b) {
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

function addressList(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter(ip => typeof ip === 'string').map(ip => ip.trim()).filter(ip => ip && ip.length <= 45))]
    .slice(0, MAX_WIZ_LIGHTS);
}

function livePilot(reply) {
  return reply && reply.success === true && reply.result && typeof reply.result === 'object'
    && typeof reply.result.state === 'boolean' ? reply.result : null;
}

function hueLightList(reply) {
  if (!reply || reply.success !== true || !Array.isArray(reply.lights)) return null;
  return reply.lights.slice(0, 64)
    .filter(light => light && (typeof light.id === 'string' || Number.isInteger(light.id)) && /^[A-Za-z0-9_-]{1,64}$/.test(String(light.id)))
    .map(light => ({ id: String(light.id), on: light.on === true }));
}

function providerOf(cfg) {
  return cfg && ['wiz', 'hue', 'http'].includes(cfg.provider) ? cfg.provider : 'none';
}

function normalizeContext(name, raw, explicit) {
  const ctx = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // A Test Mode run (rehearsal) never drives lights, like the dim path.
  const dryRun = ctx.dryRun === true || ctx.testMode === true;
  if (name === 'remote') {
    const action = ctx.action === undefined && explicit ? 'pause' : ctx.action;
    const source = ctx.source === undefined && explicit ? 'phone' : ctx.source;
    if (!REMOTE_ACTIONS.includes(action) || !REMOTE_SOURCES.includes(source)) return null;
    return { action, source, dryRun };
  }
  if (name === 'autopilotSoon') {
    let fireAtMs = null;
    if (ctx.fireAt !== undefined && ctx.fireAt !== null) {
      fireAtMs = typeof ctx.fireAt === 'number' ? ctx.fireAt : typeof ctx.fireAt === 'string' ? Date.parse(ctx.fireAt) : NaN;
      if (!Number.isFinite(fireAtMs)) return null;
    }
    return { fireAtMs, dryRun };
  }
  return { dryRun };
}

function defaultMonoNow() {
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return () => performance.now();
  } catch { /* fall through */ }
  return Date.now;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

function createLightCues(deps = {}) {
  const options = deps && typeof deps === 'object' ? deps : {};
  const { getConfig, getAppSettings, isDimActive, serialize } = options;
  const wiz = options.wiz && typeof options.wiz === 'object' ? options.wiz : {};
  const hue = options.hue && typeof options.hue === 'object' ? options.hue : {};
  // Wall clock: rate limits and the autopilot fire time only.
  const now = typeof options.now === 'function' ? options.now : Date.now;
  // Monotonic clock: every cue timing. A fake clock that injects only `now`
  // (and its own timers) is used for both.
  const mono = typeof options.monoNow === 'function' ? options.monoNow
    : typeof options.now === 'function' ? options.now : defaultMonoNow();
  const setTimer = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const callTimeoutMs = Number.isFinite(options.callTimeoutMs) && options.callTimeoutMs > 0 ? options.callTimeoutMs : DEFAULT_CALL_TIMEOUT_MS;
  const hueListTimeoutMs = Number.isFinite(options.hueListTimeoutMs) && options.hueListTimeoutMs > 0 ? options.hueListTimeoutMs : DEFAULT_HUE_LIST_TIMEOUT_MS;
  const deadlineSlackMs = Number.isFinite(options.deadlineSlackMs) && options.deadlineSlackMs >= 0 ? options.deadlineSlackMs : DEFAULT_DEADLINE_SLACK_MS;
  const rateLimits = options.rateLimitMs && typeof options.rateLimitMs === 'object' ? options.rateLimitMs : {};
  const providerBudget = ms => ({ timeoutMs: Math.max(50, ms - PROVIDER_TIMEOUT_MARGIN_MS) });
  // serialize (the provider's own operation queue: smartLights
  // queueWizOperation / queueHueOperation) is required: it is what keeps a
  // run's dim snapshot from ever capturing a cue frame, and makes a cancel
  // restore finish before a cue reads the room.
  const wired = typeof getConfig === 'function' && typeof getAppSettings === 'function'
    && typeof isDimActive === 'function' && typeof serialize === 'function';

  let active = null;
  const lastRunAt = new Map();
  let lastAutopilotFireAt = null;
  // Last write per light (monotonic), across cues: 'wiz:<ip>' / 'hue'.
  const lastWriteAt = new Map();

  function timer(fn, ms) {
    const id = setTimer(fn, ms);
    try { if (id && typeof id.unref === 'function') id.unref(); } catch { /* fake timers */ }
    return id;
  }

  function report(event, result) {
    try { log(event, { ...result }); } catch { /* logging never breaks a cue */ }
  }

  // Every provider call is bounded. A throw or rejection becomes a failure.
  function call(fn, ms = callTimeoutMs) {
    return new Promise(resolve => {
      let settled = false;
      const done = value => { if (settled) return; settled = true; clearTimer(id); resolve(value); };
      const id = timer(() => done({ success: false, code: 'TIMEOUT' }), ms);
      try {
        Promise.resolve(fn()).then(done, () => done({ success: false, code: 'PROVIDER_ERROR' }));
      } catch {
        done({ success: false, code: 'PROVIDER_ERROR' });
      }
    });
  }

  function wizCall(ip, method, params) {
    return call(() => wiz.request(ip, method, { ...params }, providerBudget(callTimeoutMs)));
  }

  // Wait until monotonic `at`, never longer than maxMs (a clock step or a
  // bad schedule cannot stretch a cue). Woken early through `wakers`.
  function sleepUntil(at, maxMs, wakers, isAborted) {
    const raw = at - mono();
    const ms = Number.isFinite(raw) ? Math.min(Math.max(0, raw), Math.max(0, maxMs)) : 0;
    if (!(ms > 0) || (isAborted && isAborted())) return Promise.resolve();
    return new Promise(resolve => {
      const wake = () => { clearTimer(id); if (wakers) wakers.delete(wake); resolve(); };
      const id = timer(wake, ms);
      if (wakers) wakers.add(wake);
    });
  }

  function rateLimitFor(name) {
    const value = Number(rateLimits[name]);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RATE_LIMIT_MS[name];
  }

  function isConfigured(cfg, provider) {
    if (!cfg || cfg.enabled !== true || cfg.verifiedForSetup !== true) return false;
    if (provider === 'wiz') {
      return addressList(cfg.wizAddresses).length > 0 && typeof wiz.request === 'function' && typeof wiz.restorePilot === 'function';
    }
    if (provider === 'hue') return typeof hue.listLightStates === 'function' && typeof hue.setLightState === 'function';
    return false;
  }

  function blankResult(name, explicit) {
    return {
      cue: typeof name === 'string' ? name.slice(0, 40) : typeof name,
      provider: 'none', code: 'SKIPPED_ERROR', preview: explicit,
      touched: 0, skippedOff: 0, restored: 0,
      released: 0, takenOver: 0, tooDim: 0, overCapacity: 0,
      unreachable: 0, unrestorable: 0, failed: 0, restoreFailed: 0, framesDropped: 0
    };
  }

  // Synchronous gates: cheap in-memory reads only, no device contact.
  // Returns a claim, or null with result.code set.
  function admit(name, rawContext, explicit, result) {
    const skip = code => { result.code = code; return null; };
    if (!CUE_NAMES.includes(name)) return skip('SKIPPED_UNKNOWN_CUE');
    if (!wired) return skip('SKIPPED_NOT_CONFIGURED');
    const context = normalizeContext(name, rawContext, explicit);
    if (!context) return skip('SKIPPED_INVALID_CONTEXT');
    if (name === 'remote') { result.action = context.action; result.source = context.source; }
    const cfg = getConfig();
    const provider = providerOf(cfg);
    result.provider = provider;
    if (!explicit && !normalizeCueSettings(cfg && cfg.cues)[name]) return skip('SKIPPED_DISABLED');
    if (!explicit) {
      const app = getAppSettings();
      if (!app || typeof app !== 'object') return skip('SKIPPED_ERROR');
      if (app.dryRun === true || context.dryRun) return skip('SKIPPED_TEST_MODE');
    }
    // A webhook has no state to read or restore.
    if (provider === 'http') return skip('SKIPPED_UNSUPPORTED_PROVIDER');
    if (!isConfigured(cfg, provider)) return skip('SKIPPED_NOT_CONFIGURED');
    if (isDimActive()) return skip('SKIPPED_RUN_ACTIVE');
    if (active) return skip('SKIPPED_BUSY');
    if (!explicit) {
      const at = now();
      const last = lastRunAt.get(name);
      if (last !== undefined && Math.abs(at - last) < rateLimitFor(name)) return skip('SKIPPED_RATE_LIMITED');
      if (name === 'autopilotSoon' && context.fireAtMs !== null) {
        if (context.fireAtMs <= at) return skip('SKIPPED_STALE');
        if (context.fireAtMs === lastAutopilotFireAt) return skip('SKIPPED_ALREADY_SIGNALLED');
      }
    }
    const pattern = cuePattern(name, context);
    if (!pattern) return skip('SKIPPED_INVALID_CONTEXT');
    return { name, provider, cfg, context, pattern, explicit };
  }

  function interruption(claim) {
    try {
      if (isDimActive()) return 'RUN_ACTIVE';
      const cfg = getConfig();
      if (providerOf(cfg) !== claim.provider || !isConfigured(cfg, claim.provider)) return 'NOT_CONFIGURED';
      return null;
    } catch {
      return 'ERROR';
    }
  }

  function outcome(ctl, stats) {
    if (ctl.reason) return REASON_CODES[ctl.reason] || 'FAILED';
    if (stats.restoreFailed > 0) return 'RESTORE_PARTIAL';
    if (stats.failed > 0) return 'PARTIAL';
    return 'OK';
  }

  function noLightsCode(stats) {
    if (stats.tooDim > 0) return 'SKIPPED_TOO_DIM';
    return stats.unreachable > 0 && stats.skippedOff === 0 && stats.unrestorable === 0 ? 'SKIPPED_UNREACHABLE' : 'SKIPPED_NO_LIGHTS_ON';
  }

  // Hold a new cue until CUE_GAP_MS after the last write to any of its lights.
  async function waitForGap(keys, ctl) {
    let until = -Infinity;
    for (const key of keys) if (lastWriteAt.has(key)) until = Math.max(until, lastWriteAt.get(key) + CUE_GAP_MS);
    if (Number.isFinite(until)) await sleepUntil(until, CUE_GAP_MS, ctl.sleepers, () => ctl.aborted);
  }

  // ── WiZ ────────────────────────────────────────────────────────────────────

  function releaseBulb(bulb, stats, takenOver = false) {
    if (bulb.released) return;
    bulb.released = true;
    stats.released++;
    if (takenOver) stats.takenOver++;
  }

  function markWrite(bulb) {
    bulb.lastSetAt = mono();
    lastWriteAt.set(`wiz:${bulb.ip}`, bulb.lastSetAt);
  }

  async function stepBulb(bulb, k, ctl, stats) {
    if (bulb.released) return;
    const params = bulb.frames[k];
    if (sameParams(params, bulb.last)) return;
    // Per-bulb spacing: the read starts no sooner than one frame after this
    // bulb's last change, so its writes are always >= FRAME_MS apart.
    if (bulb.lastSetAt !== null) await sleepUntil(bulb.lastSetAt + FRAME_MS, FRAME_MS, ctl.sleepers, () => ctl.aborted);
    if (ctl.aborted) return;
    let pilot = bulb.fresh;
    bulb.fresh = null;
    if (!pilot) pilot = livePilot(await wizCall(bulb.ip, 'getPilot', {}));
    if (!pilot) { stats.failed++; return; } // unreadable: never write from a stale snapshot
    if (pilot.state !== true) { releaseBulb(bulb, stats); return; } // manual off wins, for the rest of the cue
    // Dimmed, recoloured or another scene since our last write: the user wins.
    if (!bulb.uncertain && !liveMatches(pilot, bulb.expect)) { releaseBulb(bulb, stats, true); return; }
    if (ctl.aborted) return;
    if (!bulb.attempted) { bulb.attempted = true; stats.touched++; }
    markWrite(bulb);
    const reply = await wizCall(bulb.ip, 'setPilot', params);
    if (reply && reply.success === true) {
      bulb.last = params;
      bulb.expect = expectAfter(bulb.expect, params);
      bulb.uncertain = false;
    } else {
      // It may still have landed: compare nothing until the next confirmed write.
      bulb.last = null;
      bulb.uncertain = true;
      stats.failed++;
    }
  }

  async function restoreBulb(bulb, ctl, stats) {
    // A write that timed out may still have landed, so every attempted bulb
    // is restored, not only confirmed ones.
    if (!bulb.attempted || bulb.released) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Calm spacing, clamped to one frame: a clock step, stop() or the
      // deadline can never hold the restore back longer than FRAME_MS, and
      // even a stopped cue never changes a bulb twice within FRAME_MS.
      if (bulb.lastSetAt !== null) await sleepUntil(bulb.lastSetAt + FRAME_MS, FRAME_MS, null, null);
      const pilot = livePilot(await wizCall(bulb.ip, 'getPilot', {}));
      if (!pilot) continue; // never restore blind
      if (pilot.state !== true) { releaseBulb(bulb, stats); return; } // still off: leave the room dark
      if (!bulb.uncertain && !liveMatches(pilot, bulb.expect)) { releaseBulb(bulb, stats, true); return; }
      markWrite(bulb);
      const reply = await wizCall(bulb.ip, 'setPilot', bulb.restore);
      if (reply && reply.success === true) { stats.restored++; return; }
      bulb.uncertain = true;
    }
    stats.restoreFailed++;
  }

  async function runWiz(claim, ctl, stats) {
    const { pattern } = claim;
    const ips = addressList(claim.cfg.wizAddresses);
    await waitForGap(ips.map(ip => `wiz:${ip}`), ctl);
    if (ctl.aborted) return outcome(ctl, stats);
    const reads = await Promise.all(ips.map(async ip => ({ ip, reply: await wizCall(ip, 'getPilot', {}) })));
    const bulbs = [];
    for (const { ip, reply } of reads) {
      const pilot = livePilot(reply);
      if (!pilot) { stats.unreachable++; continue; }
      if (pilot.state !== true) { stats.skippedOff++; continue; }
      const restore = wizRestoreParams(pilot, wiz.restorePilot);
      if (!restore) { stats.unrestorable++; continue; }
      const plan = wizCueFrames(pattern, pilot);
      if (!plan.visible) { stats.tooDim++; continue; } // nothing anyone could see: leave it alone
      bulbs.push({
        ip, pilot: { ...pilot }, restore, frames: plan.frames, fresh: pilot,
        expect: lookOf(pilot), uncertain: false,
        last: null, lastSetAt: null, attempted: false, released: false
      });
    }
    if (!bulbs.length) return noLightsCode(stats);
    if (ctl.aborted) return outcome(ctl, stats);

    const frames = pattern.frames;
    const startAt = mono();
    let lastFrameAt = null;
    for (let k = 0; k < frames.length && !ctl.aborted; k++) {
      const due = startAt + frames[k].atMs;
      const at = lastFrameAt === null ? due : Math.max(due, lastFrameAt + FRAME_MS);
      const startsBy = Math.max(at, mono());
      // Keep the rhythm after a slow round trip: skip a frame whose successor
      // is already due, never start one after the pattern.
      if (startsBy - startAt >= pattern.durationMs) { stats.framesDropped += frames.length - k; break; }
      if (k + 1 < frames.length && startsBy >= startAt + frames[k + 1].atMs) { stats.framesDropped++; continue; }
      await sleepUntil(at, pattern.durationMs, ctl.sleepers, () => ctl.aborted);
      if (ctl.aborted) break;
      const reason = interruption(claim);
      if (reason) { ctl.abort(reason); break; }
      lastFrameAt = mono();
      await Promise.all(bulbs.map(bulb => stepBulb(bulb, k, ctl, stats)));
      for (const bulb of bulbs) bulb.fresh = null; // the initial read only counts for the first write
      if (bulbs.every(bulb => bulb.released)) break;
    }
    // Restore at the top of the last breath (or right away after an abort);
    // restoreBulb keeps each bulb's writes at least FRAME_MS apart.
    if (bulbs.some(bulb => bulb.attempted && !bulb.released)) {
      await sleepUntil(startAt + pattern.durationMs, pattern.durationMs, ctl.sleepers, () => ctl.aborted);
    }
    await Promise.all(bulbs.map(bulb => restoreBulb(bulb, ctl, stats)));
    return outcome(ctl, stats);
  }

  // ── Hue ────────────────────────────────────────────────────────────────────
  // The bridge's native breathe ({alert:'select'}) changes no state, so it
  // needs no restore. Only lights that are on are alerted; one found off is
  // released for the rest of the cue. A round never alerts more lights than
  // fit, paced, inside 60% of the breath spacing, so breaths stay distinct.

  function hueList() {
    return call(() => hue.listLightStates(providerBudget(hueListTimeoutMs)), hueListTimeoutMs);
  }

  async function runHue(claim, ctl, stats) {
    const plan = claim.pattern.hue;
    await waitForGap(['hue'], ctl);
    if (ctl.aborted) return outcome(ctl, stats);
    const first = hueLightList(await hueList());
    if (!first) { stats.unreachable++; return 'SKIPPED_UNREACHABLE'; }
    const lights = [];
    for (const light of first) {
      if (!light.on) stats.skippedOff++;
      else if (lights.some(existing => existing.id === light.id)) continue;
      else if (lights.length < plan.maxLights) lights.push({ id: light.id, attempted: false, released: false });
      else stats.overCapacity++;
    }
    if (!lights.length) return 'SKIPPED_NO_LIGHTS_ON';
    if (ctl.aborted) return outcome(ctl, stats);

    const startAt = mono();
    for (let k = 0; k < plan.count && !ctl.aborted; k++) {
      if (k > 0) {
        if (mono() - startAt >= plan.durationMs) { stats.framesDropped += plan.count - k; break; }
        await sleepUntil(startAt + k * plan.spacingMs, plan.spacingMs, ctl.sleepers, () => ctl.aborted);
        if (ctl.aborted) break;
      }
      const reason = interruption(claim);
      if (reason) { ctl.abort(reason); break; }
      const live = k === 0 ? first : hueLightList(await hueList());
      if (!live) { stats.failed++; continue; } // unreadable: never alert blind
      const onNow = new Set(live.filter(light => light.on).map(light => light.id));
      let sent = 0;
      for (const light of lights) {
        if (ctl.aborted) break;
        if (light.released) continue;
        if (!onNow.has(light.id)) { releaseBulb(light, stats); continue; }
        if (sent > 0) await sleepUntil(mono() + HUE_PACE_MS, HUE_PACE_MS, ctl.sleepers, () => ctl.aborted);
        if (ctl.aborted) break;
        sent++;
        if (!light.attempted) { light.attempted = true; stats.touched++; }
        lastWriteAt.set('hue', mono());
        const reply = await call(() => hue.setLightState(light.id, { ...HUE_ALERT }, providerBudget(callTimeoutMs)));
        if (!reply || reply.success !== true) stats.failed++;
      }
      if (lights.every(light => light.released)) break;
    }
    return outcome(ctl, stats);
  }

  // ── Single-flight runner ───────────────────────────────────────────────────

  function createControl() {
    let markDone;
    const ctl = {
      aborted: false, reason: null, started: false, finished: false,
      sleepers: new Set(),
      done: new Promise(resolve => { markDone = resolve; })
    };
    ctl.abort = reason => {
      if (!ctl.aborted) { ctl.aborted = true; ctl.reason = reason; }
      for (const wake of [...ctl.sleepers]) wake();
    };
    ctl.finish = () => {
      if (ctl.finished) return;
      ctl.finished = true;
      if (active === ctl) active = null;
      markDone();
    };
    return ctl;
  }

  function execute(claim, result) {
    const ctl = createControl();
    active = ctl;
    if (!claim.explicit) {
      lastRunAt.set(claim.name, now());
      if (claim.name === 'autopilotSoon' && claim.context.fireAtMs !== null) lastAutopilotFireAt = claim.context.fireAtMs;
    }
    const planMs = claim.provider === 'hue' ? claim.pattern.hue.durationMs : claim.pattern.durationMs;
    return new Promise(resolve => {
      let answered = false;
      let backstop = null;
      const answer = code => {
        if (answered) return;
        answered = true;
        result.code = code;
        const snapshot = Object.freeze({ ...result });
        report('light-cue', snapshot);
        resolve(snapshot);
      };
      ctl.answer = answer;
      try {
        // Hard deadline: the caller has an answer by now, no new frame
        // starts, and only the bounded restore may still finish (the cue
        // stays busy until it does, so nothing overlaps it).
        backstop = timer(() => {
          ctl.abort('DEADLINE');
          answer(REASON_CODES.DEADLINE);
          if (!ctl.started) ctl.finish(); // still queued behind other light work: nothing in flight
        }, planMs + CUE_GAP_MS + deadlineSlackMs);
        const task = async () => {
          if (ctl.aborted) return outcome(ctl, result);
          ctl.started = true;
          return claim.provider === 'wiz' ? runWiz(claim, ctl, result) : runHue(claim, ctl, result);
        };
        // serialize must return the task's own promise.
        Promise.resolve()
          .then(() => serialize(claim.provider, task))
          .then(code => (typeof code === 'string' && RESULT_CODES.includes(code) ? code : 'FAILED'), () => 'FAILED')
          .then(code => {
            try { clearTimer(backstop); } catch { /* injected clock */ }
            if (answered) {
              result.code = code;
              report('light-cue-late', { ...result, late: true });
            } else {
              answer(code);
            }
            ctl.finish();
          });
      } catch {
        ctl.abort('STOPPED');
        answer('FAILED');
        ctl.finish();
      }
    });
  }

  function request(name, context, explicit) {
    const result = blankResult(name, explicit);
    let claim = null;
    try {
      claim = admit(name, context, explicit, result);
    } catch {
      result.code = 'SKIPPED_ERROR';
      claim = null;
    }
    if (!claim) {
      const snapshot = Object.freeze({ ...result });
      report('light-cue', snapshot);
      return Promise.resolve(snapshot);
    }
    try {
      return execute(claim, result);
    } catch {
      if (active) active.finish();
      result.code = 'FAILED';
      return Promise.resolve(Object.freeze({ ...result }));
    }
  }

  return {
    // Automatic cue: respects its opt-in flag, Test Mode and the rate limit.
    // Returns a promise that never rejects; callers need not await it.
    cue: (name, context) => request(name, context, false),
    // Explicit Settings action: ignores the flag and Test Mode (like the
    // Lighting "Send test action" button) and is not rate limited. Still
    // single-flight, still never wakes a dark room, still restores.
    preview: (name, context) => request(name, context, true),
    isBusy: () => active !== null,
    // Abort the running cue (e.g. app quit) and restore what it touched
    // (within one frame plus the bounded restore calls). Resolves true once the cue has finished,
    // false when idle.
    stop: () => {
      const ctl = active;
      if (!ctl) return Promise.resolve(false);
      ctl.abort('STOPPED');
      if (!ctl.started) {
        // Still queued behind other light work: nothing was touched.
        if (ctl.answer) ctl.answer('STOPPED');
        ctl.finish();
      }
      return ctl.done.then(() => true);
    }
  };
}

module.exports = {
  CUE_NAMES,
  REMOTE_ACTIONS,
  REMOTE_SOURCES,
  REMOTE_COLORS,
  BULB_COLORS,
  CUE_DEFINITIONS,
  RESULT_CODES,
  FRAME_MS,
  CUE_GAP_MS,
  HUE_ALERT,
  HUE_PACE_MS,
  DEFAULT_CUE_SETTINGS,
  DEFAULT_RATE_LIMIT_MS,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_DEADLINE_SLACK_MS,
  PROVIDER_TIMEOUT_MARGIN_MS,
  hexToRgb,
  normalizeCueSettings,
  isRunDimming,
  cuePattern,
  pilotMode,
  wizFrameParams,
  wizCueFrames,
  wizRestoreParams,
  createLightCues
};
