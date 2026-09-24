'use strict';

const crypto = require('crypto');

const EPSILON = 0.01;

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function validateRect(rect, label = 'target rect') {
  if (!rect || typeof rect !== 'object') throw new Error(`${label} is required`);
  const normalized = {
    x: finiteNumber(Number(rect.x), `${label}.x`),
    y: finiteNumber(Number(rect.y), `${label}.y`),
    width: finiteNumber(Number(rect.width), `${label}.width`),
    height: finiteNumber(Number(rect.height), `${label}.height`)
  };
  if (normalized.width <= 2 || normalized.height <= 2) throw new Error(`${label} is too small for strict-interior input`);
  return normalized;
}

function strictInteriorPoint(rect) {
  const current = validateRect(rect);
  return { x: current.x + current.width / 2, y: current.y + current.height / 2 };
}

function isStrictInterior(rect, point, margin = 1) {
  const current = validateRect(rect);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return point.x > current.x + margin && point.x < current.x + current.width - margin
    && point.y > current.y + margin && point.y < current.y + current.height - margin;
}

function sameIdentity(left, right) {
  if (!left || !right) return false;
  return left.href === right.href
    && left.timeOrigin === right.timeOrigin
    && left.targetId === right.targetId
    && left.sessionId === right.sessionId;
}

function sameRect(left, right) {
  const a = validateRect(left, 'measured rect');
  const b = validateRect(right, 'current rect');
  return ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= EPSILON);
}

function validateHit(target) {
  if (!target?.hitAccepted) throw new Error('current elementFromPoint does not resolve to the activation owner or a valid descendant');
  if (!isStrictInterior(target.rect, target.point)) throw new Error('current target point is not strictly inside the activation owner');
  return target;
}

function reconcileTarget(measured, current) {
  validateHit(current);
  if (!sameIdentity(measured?.identity, current.identity)) {
    const error = new Error('current renderer document/session identity changed before native input');
    error.code = 'NATIVE_TARGET_IDENTITY_CHANGED';
    throw error;
  }
  return {
    target: current,
    reacquired: !sameRect(measured.rect, current.rect),
    stalePointRejected: !sameRect(measured.rect, current.rect)
  };
}

function translateClientToScreen(target, clientBounds, viewport) {
  const rect = validateRect(target.rect);
  if (!isStrictInterior(rect, target.point)) throw new Error('client target point is not strictly interior');
  const width = finiteNumber(Number(clientBounds.width), 'clientBounds.width');
  const height = finiteNumber(Number(clientBounds.height), 'clientBounds.height');
  const innerWidth = finiteNumber(Number(viewport.innerWidth), 'viewport.innerWidth');
  const innerHeight = finiteNumber(Number(viewport.innerHeight), 'viewport.innerHeight');
  const scaleX = width / innerWidth;
  const scaleY = height / innerHeight;
  const point = {
    x: Math.round(clientBounds.left + target.point.x * scaleX),
    y: Math.round(clientBounds.top + target.point.y * scaleY)
  };
  const screenRect = {
    x: clientBounds.left + rect.x * scaleX,
    y: clientBounds.top + rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  };
  if (!isStrictInterior(screenRect, point, 0)) throw new Error('translated physical point left the target interior');
  return { point, screenRect, scaleX, scaleY };
}

function assertInputAllowed({ clickIssued, target }) {
  if (clickIssued) throw new Error('native click was already issued; retry is prohibited');
  validateHit(target);
  return true;
}

function atomicClickContract() {
  return Object.freeze({
    api: 'SendInput',
    inputRecords: Object.freeze(['LEFTDOWN', 'LEFTUP']),
    requestedInputCount: 2,
    deliberateDelayMs: 0,
    automaticRetryCount: 0
  });
}

// ±2px: still tight custody, but tolerates ordinary wireless-pointer jitter
// that made the ±1px settle gate un-winnable on this rig (the cursor lands
// correctly; hardware noise prevented 3 consecutive ±1px-stable samples).
const MAX_CURSOR_READBACK_PIXELS = 2;

function rectFromBounds(bounds) {
  return { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
}

// Custody invariant: the physical cursor must still be safely inside the current
// verified activation target, not bit-for-bit equal to the requested integer pair.
// A readback within MAX_CURSOR_READBACK_PIXELS is accepted only when the actual
// point itself remains strictly interior of targetBounds (when supplied). This is
// a redundant, defense-in-depth check: native-input-worker.ps1 is the authoritative
// gate and only returns a successful response after applying the same contract
// before SendInput. See COLD-04 (P1: safe one-pixel quantization/readback
// difference, not a custody loss).
function assertCursorCustody(intended, actual, targetBounds = null) {
  if (!intended || !actual || !Number.isFinite(intended.x) || !Number.isFinite(intended.y) || !Number.isFinite(actual.x) || !Number.isFinite(actual.y)) {
    throw new Error('cursor custody was not established before the native gesture');
  }
  const dx = actual.x - intended.x;
  const dy = actual.y - intended.y;
  if (Math.abs(dx) > MAX_CURSOR_READBACK_PIXELS || Math.abs(dy) > MAX_CURSOR_READBACK_PIXELS) {
    throw new Error('cursor custody was not established before the native gesture');
  }
  if (targetBounds && !isStrictInterior(rectFromBounds(targetBounds), actual, 0)) {
    throw new Error('actual cursor position left the strict interior of the current activation target');
  }
  return true;
}

// --- Cursor-custody settlement gate (PR43 harness correction, SG1-corrected) ---
//
// A pure, DOM/Win32-free mirror of the polling loop native-input-worker.ps1
// runs after its single SetCursorPos call -- same duplication pattern as
// assertCursorCustody's JS copy vs. its PowerShell copy: the live loop can't
// be unit-tested directly (it calls real Win32 GetCursorPos/GetForegroundWindow
// in a real time-bounded loop), so this pure state machine over a supplied
// sample sequence is how its acceptance/rejection behavior gets unit
// coverage. An external out-of-repo probe on the target desktop/session
// demonstrated that an immediate GetCursorPos right after a successful
// SetCursorPos can return a stale/in-flight position that only converges to
// the requested point over the following tens of milliseconds -- this gate
// is the fix for evaluating custody too early, not a retry of positioning:
// exactly one SetCursorPos is issued (by the caller, before any of this),
// and this function/its ps1 counterpart never re-call it.
//
// SG1 correction: the first version of this gate (settlement-gate commit
// b2c2de7) accepted a "qualifying" sample based only on its step distance
// from the *previous* sample, which allowed cumulative drift (e.g.
// target+1 -> target+2 -> target+3) to settle several pixels away from the
// original requested point -- silently disagreeing with assertCursorCustody
// above, which has always measured distance from the original intended
// point. That was a settlement-gate defect, not evidence that Windows
// legitimately settles away from the requested point (the external probe
// showed delayed convergence, not stable multi-pixel displacement). This
// version requires every accepted sample to independently satisfy the exact
// same absolute ±MAX_CURSOR_READBACK_PIXELS-from-requestedPoint contract
// assertCursorCustody enforces, so the two can never disagree again (see
// the consistency test below).
const DEFAULT_SETTLEMENT_STABLE_COUNT = 3;
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 800;

// samples: ordered array of { x, y, elapsedMs, foregroundOk }. foregroundOk
// is only ever explicitly false when the expected window lost foreground at
// that sample; undefined/true means it still owned foreground.
// requestedPoint: the original SetCursorPos target -- {x, y} -- the fixed
// reference every sample is measured against (never the previous sample).
// targetBounds: {left,top,right,bottom} or null/undefined (no target
// constraint -- e.g. a plain diagnostic move with no click target -- only
// absolute-point stability is required, mirroring assertCursorCustody's own
// "no targetBounds supplied" behavior).
function evaluateCursorSettlement(samples, requestedPoint, targetBounds = null, options = {}) {
  if (!requestedPoint || !Number.isFinite(requestedPoint.x) || !Number.isFinite(requestedPoint.y)) {
    throw new Error('evaluateCursorSettlement requires a finite requestedPoint');
  }
  const requiredStableCount = options.requiredStableCount ?? DEFAULT_SETTLEMENT_STABLE_COUNT;
  const maxStepPixels = options.maxStepPixels ?? MAX_CURSOR_READBACK_PIXELS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SETTLEMENT_TIMEOUT_MS;
  const rect = targetBounds ? rectFromBounds(targetBounds) : null;
  let streak = [];
  for (const sample of samples || []) {
    if (Number.isFinite(sample.elapsedMs) && sample.elapsedMs > timeoutMs) {
      return { settled: false, reason: 'timeout', acceptedSample: null, stableRunLength: streak.length };
    }
    if (sample.foregroundOk === false) {
      return { settled: false, reason: 'foreground-lost-during-settlement', acceptedSample: null, stableRunLength: streak.length };
    }
    // Qualifying = independently within the absolute custody bound of the
    // ORIGINAL requested point (never the previous sample) AND, when a
    // target is supplied, strict-interior of it. A sample that fails this
    // does not qualify at all -- it cannot start or extend a streak.
    const withinAbsoluteBound = Math.abs(sample.x - requestedPoint.x) <= maxStepPixels && Math.abs(sample.y - requestedPoint.y) <= maxStepPixels;
    const interior = rect ? isStrictInterior(rect, sample, 0) : true;
    if (!withinAbsoluteBound || !interior) {
      streak = [];
      continue;
    }
    // Two qualifying samples may each individually sit within the bound yet
    // still be up to 2*maxStepPixels apart from each other (opposite edges
    // of the band) -- require adjacent qualifying samples to also be close
    // to each other, not just each independently close to the target.
    if (streak.length > 0) {
      const prev = streak[streak.length - 1];
      if (Math.abs(sample.x - prev.x) > maxStepPixels || Math.abs(sample.y - prev.y) > maxStepPixels) {
        streak = [];
      }
    }
    streak.push(sample);
    if (streak.length >= requiredStableCount) {
      return { settled: true, reason: null, acceptedSample: { x: sample.x, y: sample.y }, stableRunLength: streak.length };
    }
  }
  return { settled: false, reason: 'exhausted-without-settlement', acceptedSample: null, stableRunLength: streak.length };
}

// The immediate, no-added-delay re-check taken right before SendInput, after
// evaluateCursorSettlement has already accepted a streak. Measured against
// the same fixed requestedPoint as every other sample (not against the
// previously accepted sample) so this can never be a looser check than the
// streak itself. This is what stops a click on a target the cursor is only
// transiently passing through (see COLD-04/P1's settlement addendum,
// scenario I): settling once is not itself permission to click if the very
// next sample would already show it leaving again.
function evaluateFinalPreSendCheck(requestedPoint, finalSample, targetBounds = null, maxStepPixels = MAX_CURSOR_READBACK_PIXELS) {
  if (!requestedPoint || !Number.isFinite(requestedPoint.x) || !Number.isFinite(requestedPoint.y)) {
    throw new Error('evaluateFinalPreSendCheck requires a finite requestedPoint');
  }
  if (!finalSample || !Number.isFinite(finalSample.x) || !Number.isFinite(finalSample.y)) {
    return { ok: false, reason: 'final-check-sample-unavailable' };
  }
  if (finalSample.foregroundOk === false) {
    return { ok: false, reason: 'foreground-lost-at-final-check' };
  }
  if (Math.abs(finalSample.x - requestedPoint.x) > maxStepPixels || Math.abs(finalSample.y - requestedPoint.y) > maxStepPixels) {
    return { ok: false, reason: 'final-pre-send-check-outside-absolute-bound' };
  }
  if (targetBounds && !isStrictInterior(rectFromBounds(targetBounds), finalSample, 0)) {
    return { ok: false, reason: 'final-pre-send-check-left-target' };
  }
  return { ok: true, reason: null };
}

function assertSendInputComplete({ requestedInputCount, returnedInputCount, win32Error = null }) {
  if (requestedInputCount !== 2) throw new Error('atomic click must request exactly two INPUT records');
  if (returnedInputCount !== requestedInputCount) {
    const error = new Error(`SendInput inserted ${returnedInputCount} of ${requestedInputCount} INPUT records`);
    error.code = 'NATIVE_GESTURE_PARTIAL_INSERTION';
    error.win32Error = win32Error;
    throw error;
  }
  return true;
}

function eventBelongsToOwner(event, ownerId) {
  return Boolean(event && (event.ownerId === ownerId || event.targetId === ownerId || event.pathOwnerIds?.includes(ownerId)));
}

function validateBrowserGesture({ ownerId, down, up, click }) {
  if (!ownerId) throw new Error('activation owner is required');
  if (!eventBelongsToOwner(down, ownerId)) throw new Error('browser DOWN left the accepted activation ancestry');
  if (!eventBelongsToOwner(up, ownerId)) throw new Error('browser UP left the accepted activation ancestry');
  if (!eventBelongsToOwner(click, ownerId)) throw new Error('browser click left the accepted activation ancestry');
  return true;
}

// Observability only: mirrors validateBrowserGesture's own check order (down,
// then up, then click) so a failure reason lines up with whichever check would
// actually throw, but never throws itself and never changes what counts as
// PASS/FAIL. Distinguishes "no event captured" from "event captured but wrong
// ancestry" -- a distinction validateBrowserGesture's error message alone
// cannot make (see TOPMENU-STABILITY-01: eventBelongsToOwner(null, ownerId)
// and eventBelongsToOwner(wrongOwnerEvent, ownerId) both read as `false`).
function classifyBrowserGestureFailure({ ownerId, down, up, click }) {
  if (!ownerId) return 'OWNER_MISSING';
  const check = (event, missingCode, wrongCode) => {
    if (!event) return missingCode;
    if (!eventBelongsToOwner(event, ownerId)) return wrongCode;
    return null;
  };
  return check(down, 'DOWN_MISSING', 'DOWN_WRONG_ANCESTRY')
    || check(up, 'UP_MISSING', 'UP_WRONG_ANCESTRY')
    || check(click, 'CLICK_MISSING', 'CLICK_WRONG_ANCESTRY')
    || null;
}

// A fresh, unreused identifier per native click-path invocation. Identity is
// never derived from the selector, so repeated activations of the same
// selector (e.g. Settings opened twice) remain distinguishable.
function createGestureRequestId() {
  return crypto.randomUUID();
}

// Attaches diagnostic data to an Error under `key` without clobbering a value
// already present -- so nativeInput and browserGesture diagnostics (or two
// layers attaching the same key) can coexist on one thrown Error.
function attachDiagnostics(error, key, value) {
  if (error && error[key] === undefined) error[key] = value;
  return error;
}

// Observability-only wrapper for geometry failures. The original
// strictInteriorPoint -> validateRect path remains the sole acceptance check;
// this only retains the raw evidence that would otherwise be lost when that
// path throws before the caller can serialize its measurement.
function strictInteriorPointWithDiagnostics(rect, context = {}) {
  const geometryDiagnostic = {
    ...context,
    validationPredicate: {
      widthLessThanOrEqual2: Number(rect?.width) <= 2,
      heightLessThanOrEqual2: Number(rect?.height) <= 2
    }
  };
  try {
    return strictInteriorPoint(rect);
  } catch (error) {
    attachDiagnostics(error, 'geometryDiagnostic', geometryDiagnostic);
    throw error;
  }
}

// --- Cross-gesture correlation observability (TOPMENU-STABILITY-01 v2) ---
//
// These are pure, DOM-free mirrors of the algorithm the browser-injected
// trace in desktop-ux-functional-gate.js's installTopMenuEventTrace() runs
// (that script is CDP-eval'd into the page and cannot require() this module,
// so the logic is necessarily duplicated -- the same pattern already used
// between assertCursorCustody's JS copy here and its PowerShell copy in
// native-input-worker.ps1). Testing the algorithm here is how its behavior
// gets unit coverage at all.

// Appends to a bounded ring buffer: never resets/clears across calls (a new
// gesture arming must NOT erase prior history), only drops the oldest entry
// once maxLength is exceeded. Returns the same array, mutated, for chaining.
function appendBounded(buffer, item, maxLength) {
  buffer.push(item);
  if (buffer.length > maxLength) buffer.shift();
  return buffer;
}

// Gap, in ms, between the previous gesture's end and the current gesture's
// arm. null when there was no previous gesture (first activation of the
// session). This is the number the TOPMENU-STABILITY-01 v2 hypothesis hinges
// on: a short gap means a delayed event from the previous gesture has less
// time to have already fired, but does not by itself prove attribution.
function computeGestureGap(previousGestureEndWallClockMs, armWallClockMs) {
  if (!Number.isFinite(previousGestureEndWallClockMs) || !Number.isFinite(armWallClockMs)) return null;
  return armWallClockMs - previousGestureEndWallClockMs;
}

// Trace installation must be idempotent: a second install attempt in the same
// document must not attach a second set of listeners (which would itself
// fabricate duplicate-looking events unrelated to any real defect). Returns
// whether to actually install, distinct from merely recording the attempt.
function decideTraceInstallation(alreadyInstalled) {
  return { install: !alreadyInstalled, reason: alreadyInstalled ? 'already-installed' : 'first-install' };
}

// Events captured immediately before a gesture armed, by traceSequence --
// i.e. the tail of whatever came before, regardless of which (if any)
// gesture they were tagged with. This is what lets a later analysis judge
// whether a same-ID event downstream is a plausible delayed continuation of
// what was happening right before arm, rather than trusting activeGestureId
// equality as causal proof on its own.
function selectPrecedingContext(events, traceSequenceAtArm, windowSize) {
  if (!Number.isFinite(traceSequenceAtArm)) return [];
  return events.filter(event => event.traceSequence > traceSequenceAtArm - windowSize && event.traceSequence <= traceSequenceAtArm);
}

// Maps a performance.now()-relative timestamp to approximate wall-clock time
// using a (wallClockMs, performanceMs) anchor pair captured together. This is
// the cross-clock bridge Section E asked for: without it, renderer
// performance.now() timestamps and Node Date.now()/UTC timestamps cannot be
// placed on the same timeline at all.
function mapPerformanceToWallClock(anchorWallClockMs, anchorPerformanceMs, samplePerformanceMs) {
  if (!Number.isFinite(anchorWallClockMs) || !Number.isFinite(anchorPerformanceMs) || !Number.isFinite(samplePerformanceMs)) return null;
  return anchorWallClockMs + (samplePerformanceMs - anchorPerformanceMs);
}

module.exports = {
  appendBounded,
  assertCursorCustody,
  assertInputAllowed,
  assertSendInputComplete,
  atomicClickContract,
  attachDiagnostics,
  classifyBrowserGestureFailure,
  computeGestureGap,
  createGestureRequestId,
  decideTraceInstallation,
  DEFAULT_SETTLEMENT_STABLE_COUNT,
  DEFAULT_SETTLEMENT_TIMEOUT_MS,
  evaluateCursorSettlement,
  evaluateFinalPreSendCheck,
  isStrictInterior,
  mapPerformanceToWallClock,
  MAX_CURSOR_READBACK_PIXELS,
  reconcileTarget,
  rectFromBounds,
  sameIdentity,
  selectPrecedingContext,
  strictInteriorPoint,
  strictInteriorPointWithDiagnostics,
  translateClientToScreen,
  validateBrowserGesture,
  validateHit,
  validateRect
};
