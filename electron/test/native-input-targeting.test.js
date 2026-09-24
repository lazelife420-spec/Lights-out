'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
  evaluateCursorSettlement,
  evaluateFinalPreSendCheck,
  isStrictInterior,
  mapPerformanceToWallClock,
  reconcileTarget,
  selectPrecedingContext,
  strictInteriorPoint,
  strictInteriorPointWithDiagnostics,
  translateClientToScreen,
  validateBrowserGesture,
  validateHit
} = require('../scripts/native-input-targeting');

const identity = { href: 'file:///app/index.html', timeOrigin: 100, targetId: 'target-1', sessionId: 'session-1' };
const target = (rect = { x: 600, y: 10, width: 50, height: 28 }, extra = {}) => ({ rect, point: strictInteriorPoint(rect), hitAccepted: true, identity, ...extra });

test('stable current target allows exactly one prepared activation', () => {
  const prepared = reconcileTarget(target(), target());
  assert.equal(prepared.reacquired, false);
  assert.equal(assertInputAllowed({ clickIssued: false, target: prepared.target }), true);
});

test('geometry change rejects the stale coordinate and reacquires current geometry', () => {
  const measured = target();
  const current = target({ x: 640, y: 12, width: 52, height: 30 });
  const prepared = reconcileTarget(measured, current);
  assert.equal(prepared.stalePointRejected, true);
  assert.deepEqual(prepared.target.point, { x: 666, y: 27 });
});

test('window/content origin changes recalculate physical translation', () => {
  const current = target();
  const before = translateClientToScreen(current, { left: 100, top: 200, width: 1280, height: 720 }, { innerWidth: 1280, innerHeight: 720 });
  const after = translateClientToScreen(current, { left: 300, top: 400, width: 1280, height: 720 }, { innerWidth: 1280, innerHeight: 720 });
  assert.deepEqual({ x: after.point.x - before.point.x, y: after.point.y - before.point.y }, { x: 200, y: 200 });
});

test('strict interior center is accepted', () => {
  const current = target();
  assert.equal(isStrictInterior(current.rect, current.point), true);
  assert.doesNotThrow(() => validateHit(current));
});

test('edge point is rejected', () => {
  const current = target();
  current.point = { x: current.rect.x, y: current.rect.y + 10 };
  assert.throws(() => validateHit(current), /strictly inside/);
});

test('hit-test mismatch prevents native input', () => {
  assert.throws(() => assertInputAllowed({ clickIssued: false, target: target(undefined, { hitAccepted: false }) }), /elementFromPoint/);
});

test('wrong live document/session prevents input until current identity is established', () => {
  const changed = target(undefined, { identity: { ...identity, sessionId: 'session-2' } });
  assert.throws(() => reconcileTarget(target(), changed), error => error.code === 'NATIVE_TARGET_IDENTITY_CHANGED');
});

test('high-DPI fractional bounds keep the final physical point inside target', () => {
  const current = target({ x: 666.075, y: 9.6, width: 48.7625, height: 28 });
  const translated = translateClientToScreen(current, { left: 1108, top: 175, width: 1280, height: 720 }, { innerWidth: 1280, innerHeight: 722 });
  assert.equal(isStrictInterior(translated.screenRect, translated.point, 0), true);
});

test('1280x720 reduced geometry remains valid without guessed coordinates', () => {
  const current = target({ x: 640, y: 8, width: 46, height: 28 });
  const translated = translateClientToScreen(current, { left: 10, top: 20, width: 1280, height: 720 }, { innerWidth: 1280, innerHeight: 720 });
  assert.deepEqual(translated.point, { x: 673, y: 42 });
});

test('native click already issued has no retry path', () => {
  assert.throws(() => assertInputAllowed({ clickIssued: true, target: target() }), /retry is prohibited/);
});

test('valid current target and current cursor allow one two-event gesture', () => {
  const current = target();
  assert.equal(assertInputAllowed({ clickIssued: false, target: current }), true);
  assert.equal(assertCursorCustody({ x: 100, y: 200 }, { x: 100, y: 200 }), true);
  assert.deepEqual(atomicClickContract().inputRecords, ['LEFTDOWN', 'LEFTUP']);
});

// COLD-04 / P1: readback exceeding the custody bound still prevents the
// gesture. This replaces the pre-correction exact-equality expectation
// (a 1px delta used to throw here; see the bounded-custody suite below for
// why that was stricter than the actual target-custody requirement).
// UI-R1: the bound is ±2px -- real wireless-pointer jitter made ±1px
// un-winnable while the click contract stays identical (same target).
test('cursor readback beyond the two-pixel bound prevents any native gesture', () => {
  assert.throws(() => assertCursorCustody({ x: 100, y: 200 }, { x: 103, y: 200 }), /custody was not established/);
  assert.throws(() => assertCursorCustody({ x: 100, y: 200 }, { x: 100, y: 203 }), /custody was not established/);
});

test('non-finite or missing cursor points prevent the native gesture', () => {
  assert.throws(() => assertCursorCustody(null, { x: 100, y: 200 }), /custody was not established/);
  assert.throws(() => assertCursorCustody({ x: 100, y: 200 }, { x: NaN, y: 200 }), /custody was not established/);
});

// COLD-04 / P1 bounded-custody suite: a readback within the custody bound is
// safe only when the actual point remains strictly interior of the same
// verified activation target. Fixture rect is {x:600,y:10,width:50,height:28}
// -> bounds {left:600,top:10,right:650,bottom:38}, deep-interior center (625,24).
const custodyBounds = { left: 600, top: 10, right: 650, bottom: 38 };

test('exact readback (delta 0,0) is accepted with target bounds supplied', () => {
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 625, y: 24 }, custodyBounds), true);
});

test('one-pixel X readback deep inside the same target is accepted', () => {
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 624, y: 24 }, custodyBounds), true);
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 626, y: 24 }, custodyBounds), true);
});

test('one-pixel Y readback deep inside the same target is accepted', () => {
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 625, y: 23 }, custodyBounds), true);
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 625, y: 25 }, custodyBounds), true);
});

test('diagonal one-pixel readback deep inside the same target is accepted', () => {
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 626, y: 25 }, custodyBounds), true);
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 624, y: 23 }, custodyBounds), true);
});

test('one-pixel readback that crosses the left boundary is rejected', () => {
  assert.throws(
    () => assertCursorCustody({ x: 601, y: 24 }, { x: 600, y: 24 }, custodyBounds),
    /strict interior/
  );
});

test('one-pixel readback that crosses the right boundary is rejected', () => {
  assert.throws(
    () => assertCursorCustody({ x: 649, y: 24 }, { x: 650, y: 24 }, custodyBounds),
    /strict interior/
  );
});

test('one-pixel readback that crosses the top or bottom boundary is rejected', () => {
  assert.throws(
    () => assertCursorCustody({ x: 625, y: 11 }, { x: 625, y: 10 }, custodyBounds),
    /strict interior/
  );
  assert.throws(
    () => assertCursorCustody({ x: 625, y: 37 }, { x: 625, y: 38 }, custodyBounds),
    /strict interior/
  );
});

test('two-pixel X readback deep inside the same target is accepted', () => {
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 627, y: 24 }, custodyBounds), true);
});

test('two-pixel Y readback deep inside the same target is accepted', () => {
  assert.equal(assertCursorCustody({ x: 625, y: 24 }, { x: 625, y: 26 }, custodyBounds), true);
});

test('three-pixel readback is rejected even while still inside the target', () => {
  assert.throws(
    () => assertCursorCustody({ x: 625, y: 24 }, { x: 628, y: 24 }, custodyBounds),
    /custody was not established/
  );
  assert.throws(
    () => assertCursorCustody({ x: 625, y: 24 }, { x: 625, y: 27 }, custodyBounds),
    /custody was not established/
  );
});

test('one-pixel readback with no target bounds supplied (deliberate outside-click) is accepted on delta alone', () => {
  assert.equal(assertCursorCustody({ x: 40, y: 40 }, { x: 41, y: 40 }, null), true);
});

test('high-DPI fractional target: one-pixel readback accepted only when the actual point remains interior', () => {
  const current = target({ x: 666.075, y: 9.6, width: 48.7625, height: 28 });
  const translated = translateClientToScreen(current, { left: 1108, top: 175, width: 1280, height: 720 }, { innerWidth: 1280, innerHeight: 722 });
  const bounds = {
    left: translated.screenRect.x,
    top: translated.screenRect.y,
    right: translated.screenRect.x + translated.screenRect.width,
    bottom: translated.screenRect.y + translated.screenRect.height
  };
  const nudged = { x: translated.point.x + 1, y: translated.point.y };
  assert.equal(assertCursorCustody(translated.point, nudged, bounds), true);
  // Same one-pixel delta, but the actual readback lands at-or-beyond the
  // fractional right edge (ceil, so it is never < bounds.right), which must
  // leave the strict interior even though the delta is still within bound.
  const overEdge = { x: Math.ceil(bounds.right), y: translated.point.y };
  const edgePoint = { x: overEdge.x - 1, y: translated.point.y };
  assert.throws(() => assertCursorCustody(edgePoint, overEdge, bounds), /strict interior/);
});

test('1280x720 target: safe one-pixel readback is accepted', () => {
  const current = target({ x: 640, y: 8, width: 46, height: 28 });
  const translated = translateClientToScreen(current, { left: 10, top: 20, width: 1280, height: 720 }, { innerWidth: 1280, innerHeight: 720 });
  const bounds = {
    left: translated.screenRect.x,
    top: translated.screenRect.y,
    right: translated.screenRect.x + translated.screenRect.width,
    bottom: translated.screenRect.y + translated.screenRect.height
  };
  const nudged = { x: translated.point.x - 1, y: translated.point.y };
  assert.equal(assertCursorCustody(translated.point, nudged, bounds), true);
});

test('DOWN and UP are represented in one atomic SendInput batch', () => {
  const contract = atomicClickContract();
  assert.equal(contract.api, 'SendInput');
  assert.equal(contract.requestedInputCount, 2);
  assert.deepEqual(contract.inputRecords, ['LEFTDOWN', 'LEFTUP']);
});

test('atomic native click has no deliberate DOWN to UP delay', () => {
  assert.equal(atomicClickContract().deliberateDelayMs, 0);
});

test('partial SendInput insertion fails without retry', () => {
  assert.throws(
    () => assertSendInputComplete({ requestedInputCount: 2, returnedInputCount: 1, win32Error: 5 }),
    error => error.code === 'NATIVE_GESTURE_PARTIAL_INSERTION' && error.win32Error === 5
  );
  assert.equal(atomicClickContract().automaticRetryCount, 0);
});

test('browser DOWN UP and click on the same valid activation ancestry pass', () => {
  const event = { pathOwnerIds: ['menu-help'] };
  assert.equal(validateBrowserGesture({ ownerId: 'menu-help', down: event, up: event, click: event }), true);
});

test('browser DOWN valid and UP on a different ancestry fails', () => {
  assert.throws(() => validateBrowserGesture({
    ownerId: 'menu-help',
    down: { pathOwnerIds: ['menu-help'] },
    up: { pathOwnerIds: [] },
    click: { pathOwnerIds: ['menu-help'] }
  }), /browser UP left/);
});

test('browser click on a different target fails', () => {
  assert.throws(() => validateBrowserGesture({
    ownerId: 'menu-help',
    down: { pathOwnerIds: ['menu-help'] },
    up: { pathOwnerIds: ['menu-help'] },
    click: { targetId: 'cockpit', pathOwnerIds: [] }
  }), /browser click left/);
});

// TOPMENU-STABILITY-01 observability suite: classifyBrowserGestureFailure,
// createGestureRequestId, and attachDiagnostics are diagnostic-only additions.
// None of them may change what validateBrowserGesture accepts or rejects --
// each classification case below is paired with the equivalent
// validateBrowserGesture call to prove the throw condition is unchanged.
const heldOwner = { pathOwnerIds: ['menu-settings'] };
const wrongOwner = { pathOwnerIds: ['cockpit'] };

test('classifyBrowserGestureFailure returns null for a fully valid gesture (H1)', () => {
  const gesture = { ownerId: 'menu-settings', down: heldOwner, up: heldOwner, click: heldOwner };
  assert.equal(classifyBrowserGestureFailure(gesture), null);
  assert.equal(validateBrowserGesture(gesture), true);
});

test('DOWN missing classifies as DOWN_MISSING and still throws the original message (H2)', () => {
  const gesture = { ownerId: 'menu-settings', down: null, up: heldOwner, click: heldOwner };
  assert.equal(classifyBrowserGestureFailure(gesture), 'DOWN_MISSING');
  assert.throws(() => validateBrowserGesture(gesture), /browser DOWN left the accepted activation ancestry/);
});

test('DOWN present but wrong owner classifies as DOWN_WRONG_ANCESTRY (H3)', () => {
  const gesture = { ownerId: 'menu-settings', down: wrongOwner, up: heldOwner, click: heldOwner };
  assert.equal(classifyBrowserGestureFailure(gesture), 'DOWN_WRONG_ANCESTRY');
  assert.throws(() => validateBrowserGesture(gesture), /browser DOWN left the accepted activation ancestry/);
  // The two DOWN failure modes are indistinguishable to validateBrowserGesture's
  // own message but distinguishable via classifyBrowserGestureFailure -- this is
  // exactly the ambiguity that made TOPMENU-STABILITY-01 UNRESOLVED.
  assert.notEqual(classifyBrowserGestureFailure({ ownerId: 'menu-settings', down: null, up: heldOwner, click: heldOwner }), classifyBrowserGestureFailure(gesture));
});

test('UP missing classifies as UP_MISSING only when DOWN passed (H4)', () => {
  const gesture = { ownerId: 'menu-settings', down: heldOwner, up: null, click: heldOwner };
  assert.equal(classifyBrowserGestureFailure(gesture), 'UP_MISSING');
  assert.throws(() => validateBrowserGesture(gesture), /browser UP left the accepted activation ancestry/);
});

test('UP wrong owner classifies as UP_WRONG_ANCESTRY (H5)', () => {
  const gesture = { ownerId: 'menu-settings', down: heldOwner, up: wrongOwner, click: heldOwner };
  assert.equal(classifyBrowserGestureFailure(gesture), 'UP_WRONG_ANCESTRY');
  assert.throws(() => validateBrowserGesture(gesture), /browser UP left the accepted activation ancestry/);
});

test('CLICK missing classifies as CLICK_MISSING only when DOWN and UP passed (H6)', () => {
  const gesture = { ownerId: 'menu-settings', down: heldOwner, up: heldOwner, click: null };
  assert.equal(classifyBrowserGestureFailure(gesture), 'CLICK_MISSING');
  assert.throws(() => validateBrowserGesture(gesture), /browser click left the accepted activation ancestry/);
});

test('CLICK wrong owner classifies as CLICK_WRONG_ANCESTRY (H7)', () => {
  const gesture = { ownerId: 'menu-settings', down: heldOwner, up: heldOwner, click: wrongOwner };
  assert.equal(classifyBrowserGestureFailure(gesture), 'CLICK_WRONG_ANCESTRY');
  assert.throws(() => validateBrowserGesture(gesture), /browser click left the accepted activation ancestry/);
});

test('gestureRequestId is fresh per call and never derived from the selector (H8/H9)', () => {
  const first = createGestureRequestId();
  const second = createGestureRequestId();
  assert.notEqual(first, second);
  // A "preceding toggle" activation and a later "Settings reopen" activation
  // for the identical selector must not collide merely because the selector
  // repeats -- both ids are opaque and carry no selector-derived component.
  assert.equal(typeof first, 'string');
  assert.ok(first.length > 0);
});

test('nested pathOwnerIds: existing accepted-owner behavior is unchanged by the new classifier (H10)', () => {
  const nested = { pathOwnerIds: ['submenu-item', 'menu-settings-submenu', 'menu-settings'] };
  const gesture = { ownerId: 'menu-settings', down: nested, up: nested, click: nested };
  assert.equal(classifyBrowserGestureFailure(gesture), null);
  assert.equal(validateBrowserGesture(gesture), true);
});

test('a thrown validation error survives with attached browserGesture diagnostics (H11)', () => {
  let caught = null;
  try {
    validateBrowserGesture({ ownerId: 'menu-settings', down: null, up: heldOwner, click: heldOwner });
  } catch (error) {
    attachDiagnostics(error, 'gestureRequestId', 'gr-1');
    attachDiagnostics(error, 'browserGesture', { down: null, up: heldOwner, click: heldOwner, validationFailureStage: 'DOWN_MISSING' });
    caught = error;
  }
  assert.ok(caught, 'expected validateBrowserGesture to throw');
  assert.equal(caught.gestureRequestId, 'gr-1');
  assert.equal(caught.browserGesture.validationFailureStage, 'DOWN_MISSING');
  assert.equal(caught.browserGesture.down, null);
});

test('nativeInput and browserGesture diagnostics coexist on one Error without overwriting (H12)', () => {
  const error = new Error('synthetic');
  attachDiagnostics(error, 'nativeInput', { screenPoint: { x: 1, y: 2 } });
  attachDiagnostics(error, 'browserGesture', { down: null });
  assert.deepEqual(error.nativeInput, { screenPoint: { x: 1, y: 2 } });
  assert.deepEqual(error.browserGesture, { down: null });
  // attachDiagnostics must not clobber a value already present under the key.
  attachDiagnostics(error, 'nativeInput', { screenPoint: { x: 99, y: 99 } });
  assert.deepEqual(error.nativeInput, { screenPoint: { x: 1, y: 2 } });
});

test('nested browserGesture/timing objects survive JSON serialization at full depth (H13)', () => {
  const diagnostics = {
    gestureRequestId: 'gr-2',
    selector: '#menu-settings > span',
    down: null,
    up: { pathOwnerIds: ['cockpit'] },
    click: { pathOwnerIds: ['cockpit'] },
    eventCounts: { pointerdown: 0, mousedown: 0, pointerup: 1, mouseup: 1, click: 1, totalMatchedThisGesture: 3, totalCapturedThisSession: 214 },
    activeGestureMatchedAtSample: true,
    validationFailureStage: 'DOWN_MISSING',
    timing: {
      gestureRequestCreatedUtc: '2026-08-10T19:53:07.000Z',
      targetMeasuredUtc: '2026-08-10T19:53:07.050Z',
      browserTraceArmedUtc: '2026-08-10T19:53:07.060Z',
      nativeRequestStartUtc: '2026-08-10T19:53:07.070Z',
      nativeRequestReturnedUtc: '2026-08-10T19:53:07.120Z',
      browserTraceSampledUtc: '2026-08-10T19:53:07.240Z',
      gestureValidationStartUtc: '2026-08-10T19:53:07.241Z',
      gestureValidationEndUtc: '2026-08-10T19:53:07.242Z'
    }
  };
  const roundTripped = JSON.parse(JSON.stringify(diagnostics));
  assert.deepEqual(roundTripped, diagnostics);
  assert.equal(roundTripped.down, null);
  assert.equal(roundTripped.eventCounts.totalCapturedThisSession, 214);
  assert.equal(Object.keys(roundTripped.timing).length, 8);
});

const geometryContext = {
  selector: '#ns-play-btn',
  selectorMatchCount: 1,
  chosenElement: { id: 'ns-play-btn', connected: true },
  rawRect: { x: 120, y: 220, width: 0, height: 37.6, top: 220, right: 120, bottom: 257.6, left: 120 },
  targetStyle: { display: 'inline-flex', visibility: 'visible', opacity: '1' },
  ancestors: [
    { id: 'ns-play-btn', display: 'inline-flex', rect: { width: 0, height: 37.6 } },
    { id: 'ns-hero-card', display: 'block', rect: { width: 900, height: 180 } }
  ],
  rendererState: { route: 'lib', running: false, paused: false, heroVisible: true },
  viewport: { innerWidth: 1280, innerHeight: 722, devicePixelRatio: 1.25 }
};

test('invalid raw geometry is retained before the original validateRect error throws', () => {
  assert.throws(
    () => strictInteriorPointWithDiagnostics({ x: 120, y: 220, width: 0, height: 37.6 }, geometryContext),
    error => error.message === 'target rect is too small for strict-interior input'
      && error.geometryDiagnostic.rawRect.width === 0
      && error.geometryDiagnostic.rawRect.height === 37.6
  );
});

test('width and height validation flags are serialized independently', () => {
  for (const [rect, expected] of [
    [{ x: 0, y: 0, width: 0, height: 37.6 }, [true, false]],
    [{ x: 0, y: 0, width: 234, height: 2 }, [false, true]],
    [{ x: 0, y: 0, width: 1, height: 1 }, [true, true]]
  ]) {
    assert.throws(() => strictInteriorPointWithDiagnostics(rect, geometryContext), error => {
      assert.deepEqual(
        [error.geometryDiagnostic.validationPredicate.widthLessThanOrEqual2, error.geometryDiagnostic.validationPredicate.heightLessThanOrEqual2],
        expected
      );
      return true;
    });
  }
});

test('renderer and viewport diagnostic fields survive the failure path', () => {
  assert.throws(() => strictInteriorPointWithDiagnostics({ x: 0, y: 0, width: 0, height: 37.6 }, geometryContext), error => {
    const serialized = JSON.parse(JSON.stringify(error.geometryDiagnostic));
    assert.deepEqual(serialized.rendererState, geometryContext.rendererState);
    assert.deepEqual(serialized.viewport, geometryContext.viewport);
    return true;
  });
});

test('ancestor visibility diagnostics survive the failure path', () => {
  assert.throws(() => strictInteriorPointWithDiagnostics({ x: 0, y: 0, width: 234, height: 0 }, geometryContext), error => {
    assert.deepEqual(error.geometryDiagnostic.ancestors, geometryContext.ancestors);
    return true;
  });
});

test('diagnostic instrumentation preserves the original validateRect error unchanged', () => {
  let original;
  let observed;
  try { strictInteriorPoint({ x: 0, y: 0, width: 0, height: 37.6 }); } catch (error) { original = error; }
  try { strictInteriorPointWithDiagnostics({ x: 0, y: 0, width: 0, height: 37.6 }, geometryContext); } catch (error) { observed = error; }
  assert.ok(original);
  assert.ok(observed);
  assert.equal(observed.message, original.message);
  assert.equal(observed.constructor, original.constructor);
});

test('diagnostic instrumentation cannot turn invalid geometry into a pass', () => {
  assert.throws(() => strictInteriorPointWithDiagnostics({ x: 0, y: 0, width: 2, height: 37.6 }, geometryContext));
  assert.throws(() => strictInteriorPointWithDiagnostics({ x: 0, y: 0, width: 234, height: 2 }, geometryContext));
  assert.deepEqual(strictInteriorPointWithDiagnostics({ x: 0, y: 0, width: 234, height: 37.6 }, geometryContext), { x: 117, y: 18.8 });
});

test('successful activation: existing report format remains usable alongside the new fields (H14)', () => {
  const gesture = { ownerId: 'menu-settings', down: heldOwner, up: heldOwner, click: heldOwner, handlerEntries: [{ ownerId: 'menu-settings' }], expectedState: { openMenus: ['menu-settings'] } };
  assert.equal(classifyBrowserGestureFailure(gesture), null);
  assert.equal(validateBrowserGesture(gesture), true);
  assert.equal(gesture.handlerEntries.length, 1);
});

// TOPMENU-STABILITY-01 v2 (cross-gesture correlation) observability suite.
// These test the pure Node-side mirror of the algorithm the browser-injected
// trace runs; the browser copy is necessarily duplicated (CDP eval can't
// require() this module) and gets its correctness proof from the live
// focused acceptance run instead, not from these unit tests.

test('appendBounded assigns monotonically increasing traceSequence and never drops in-bound items (K1)', () => {
  let seq = 0;
  const buffer = [];
  for (let i = 0; i < 5; i += 1) {
    seq += 1;
    appendBounded(buffer, { traceSequence: seq, label: `e${i}` }, 100);
  }
  assert.deepEqual(buffer.map(e => e.traceSequence), [1, 2, 3, 4, 5]);
  assert.equal(buffer.length, 5);
});

test('starting a new gesture does not erase prior gesture events from the buffer (K2)', () => {
  const buffer = [];
  appendBounded(buffer, { traceSequence: 1, activeGestureId: 'A' }, 100);
  appendBounded(buffer, { traceSequence: 2, activeGestureId: 'A' }, 100);
  // Gesture A ends; gesture B arms. The buffer is never cleared on arm.
  appendBounded(buffer, { traceSequence: 3, activeGestureId: 'B' }, 100);
  assert.equal(buffer.length, 3);
  assert.ok(buffer.some(e => e.activeGestureId === 'A'));
  assert.ok(buffer.some(e => e.activeGestureId === 'B'));
});

test('a same-ID event downstream can be checked against the immediately preceding gesture via traceSequence proximity (K3)', () => {
  // Gesture A's tail event (seq 3) sits right before gesture B arms at seq 4.
  // A delayed event tagged "B" (seq 5) is adjacent to A's tail in sequence
  // order -- this is the shape selectPrecedingContext exists to surface, not
  // to prove attribution on its own (activeGestureId equality is not causal
  // proof; see H3-style ambiguity for the down/up/click case).
  const events = [
    { traceSequence: 1, activeGestureId: 'A', type: 'pointerdown' },
    { traceSequence: 2, activeGestureId: 'A', type: 'pointerup' },
    { traceSequence: 3, activeGestureId: 'A', type: 'click' },
    { traceSequence: 4, activeGestureId: 'B', type: 'pointerdown' },
    { traceSequence: 5, activeGestureId: 'B', type: 'click' }
  ];
  const traceSequenceAtArm = 3; // B armed right after A's tail event
  const preceding = selectPrecedingContext(events, traceSequenceAtArm, 20);
  assert.deepEqual(preceding.map(e => e.traceSequence), [1, 2, 3]);
  assert.ok(preceding.every(e => e.activeGestureId === 'A'));
});

test('events firing with no active gesture remain in the rolling buffer (K4)', () => {
  const buffer = [];
  appendBounded(buffer, { traceSequence: 1, activeGestureId: null, type: 'mousemove' }, 100);
  assert.equal(buffer.length, 1);
  assert.equal(buffer[0].activeGestureId, null);
});

test('full matching event arrays survive JSON serialization, not just first() (K5/K6)', () => {
  const matching = [
    { traceSequence: 10, type: 'pointerdown' },
    { traceSequence: 11, type: 'pointerdown' },
    { traceSequence: 12, type: 'pointerdown' },
    { traceSequence: 13, type: 'pointerup' },
    { traceSequence: 14, type: 'pointerup' },
    { traceSequence: 15, type: 'click' },
    { traceSequence: 16, type: 'click' }
  ];
  const roundTripped = JSON.parse(JSON.stringify({ matchingEvents: matching }));
  assert.equal(roundTripped.matchingEvents.length, 7);
  assert.deepEqual(roundTripped.matchingEvents, matching);
});

test('renderer wall-clock/performance anchor survives serialization and maps correctly (K7)', () => {
  const anchor = { installedAtWallClockMs: 1000, installedAtPerformanceMs: 50 };
  const roundTripped = JSON.parse(JSON.stringify(anchor));
  assert.equal(mapPerformanceToWallClock(roundTripped.installedAtWallClockMs, roundTripped.installedAtPerformanceMs, 150), 1100);
});

test('gesture arm/sample clock anchors survive serialization and compute a gap (K8)', () => {
  const previousGesture = { id: 'A', endedAtWallClockMs: 1000 };
  const currentArm = { id: 'B', armWallClockMs: 1143 };
  const roundTripped = JSON.parse(JSON.stringify({ previousGesture, currentArm }));
  assert.equal(computeGestureGap(roundTripped.previousGesture.endedAtWallClockMs, roundTripped.currentArm.armWallClockMs), 143);
});

test('no previous gesture yields a null gap, not a false zero (K8 edge case)', () => {
  assert.equal(computeGestureGap(undefined, 1000), null);
});

test('trace installation is idempotent: a second attempt in the same document does not reinstall (K9/K10)', () => {
  const first = decideTraceInstallation(false);
  assert.equal(first.install, true);
  assert.equal(first.reason, 'first-install');
  const second = decideTraceInstallation(true);
  assert.equal(second.install, false);
  assert.equal(second.reason, 'already-installed');
});

test('handler entries receive unique handlerTraceSequence values that never reset (K11/K12)', () => {
  const handlerBuffer = [];
  let handlerSeq = 0;
  for (let i = 0; i < 3; i += 1) {
    handlerSeq += 1;
    appendBounded(handlerBuffer, { handlerTraceSequence: handlerSeq, ownerId: 'menu-power' }, 100);
  }
  assert.deepEqual(handlerBuffer.map(e => e.handlerTraceSequence), [1, 2, 3]);
  // A later gesture's handler entries append, not replace -- history survives.
  handlerSeq += 1;
  appendBounded(handlerBuffer, { handlerTraceSequence: handlerSeq, ownerId: 'menu-settings' }, 100);
  assert.equal(handlerBuffer.length, 4);
});

test('previousGestureRequestId and inter-gesture gap persist through diagnostic serialization (K13)', () => {
  const diagnostics = {
    gestureRequestId: 'B',
    previousGestureRequestId: 'A',
    previousGestureEndWallClockMs: 1000,
    currentGestureArmWallClockMs: 1143,
    gapSincePreviousGestureMs: computeGestureGap(1000, 1143)
  };
  const roundTripped = JSON.parse(JSON.stringify(diagnostics));
  assert.equal(roundTripped.previousGestureRequestId, 'A');
  assert.equal(roundTripped.gapSincePreviousGestureMs, 143);
});

test('nested cross-gesture failure evidence (matchingEvents, precedingContextEvents, anchors) survives report serialization at full depth (K14)', () => {
  const diagnostics = {
    gestureRequestId: 'B',
    previousGestureRequestId: 'A',
    gapSincePreviousGestureMs: 143,
    traceSequenceAtArm: 3,
    matchingEvents: [{ traceSequence: 4, type: 'pointerdown' }, { traceSequence: 7, type: 'click' }],
    precedingContextEvents: [{ traceSequence: 2, type: 'pointerup', activeGestureId: 'A' }, { traceSequence: 3, type: 'click', activeGestureId: 'A' }],
    anchor: { installedAtWallClockMs: 900, installedAtPerformanceMs: 10 }
  };
  const roundTripped = JSON.parse(JSON.stringify(diagnostics));
  assert.deepEqual(roundTripped, diagnostics);
  assert.equal(roundTripped.matchingEvents.length, 2);
  assert.equal(roundTripped.precedingContextEvents.length, 2);
});

test('existing browserGesture PASS/FAIL rules are unchanged by the correlation additions (K15)', () => {
  assert.equal(classifyBrowserGestureFailure({ ownerId: 'menu-settings', down: heldOwner, up: heldOwner, click: heldOwner }), null);
  assert.throws(() => validateBrowserGesture({ ownerId: 'menu-settings', down: null, up: heldOwner, click: heldOwner }), /browser DOWN left the accepted activation ancestry/);
});

// PR43 cursor-custody settlement gate (SG1-corrected). evaluateCursorSettlement/
// evaluateFinalPreSendCheck are the pure mirror of native-input-worker.ps1's
// live polling loop (which calls real Win32 GetCursorPos/GetForegroundWindow
// in a real time-bounded loop and so can't be unit-tested directly -- same
// duplication pattern as assertCursorCustody's JS copy vs. its PowerShell
// copy). requestedPoint for all cases below is (625,24), the center of the
// existing custodyBounds fixture -> bounds {left:600,top:10,right:650,bottom:38}.
const settlementTarget = { x: 625, y: 24 };

test('A. exact immediate: requested point returned immediately and remains stable settles on the third sample', () => {
  const samples = [
    { x: 625, y: 24, elapsedMs: 5 },
    { x: 625, y: 24, elapsedMs: 10 },
    { x: 625, y: 24, elapsedMs: 15 }
  ];
  const result = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.equal(result.settled, true);
  assert.deepEqual(result.acceptedSample, { x: 625, y: 24 });
  assert.equal(result.stableRunLength, 3);
});

test('B. ±1 absolute-stable readback: differs from the requested point by <=1 and is stable/strict-interior settles', () => {
  const samples = [
    { x: 626, y: 24, elapsedMs: 5 },
    { x: 626, y: 24, elapsedMs: 10 },
    { x: 626, y: 24, elapsedMs: 15 }
  ];
  const result = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.equal(result.settled, true);
  assert.deepEqual(result.acceptedSample, { x: 626, y: 24 });
});

// C. SG1 REGRESSION TEST -- this is exactly the shape the first settlement-gate
// commit (b2c2de7) accepted incorrectly: each sample is only a small step from the
// PREVIOUS sample, so it "looked" step-stable, but each is progressively
// farther from the original requested point. Only the samples inside the
// absolute ±2 custody bound (delta 1, 2) qualify at all, and they alone can
// never reach the required streak of 3.
test('C. cumulative drift away from the requested point must not settle (SG1 regression)', () => {
  const samples = [
    { x: 626, y: 24, elapsedMs: 5 },  // +1, qualifies alone
    { x: 627, y: 24, elapsedMs: 60 }, // +2, qualifies -- streak reaches only 2
    { x: 628, y: 24, elapsedMs: 120 }, // +3, does not qualify
    { x: 629, y: 24, elapsedMs: 180 }  // +4, does not qualify
  ];
  const result = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.equal(result.settled, false);
  assert.equal(result.acceptedSample, null);
});

test('D. stale previous position then converges to the requested point settles only after three absolute-custody samples, not on first arrival', () => {
  const samples = [
    { x: 40, y: 40, elapsedMs: 2 },     // old/previous position, not interior, not within bound
    { x: 300, y: 200, elapsedMs: 6 },   // intermediate, still not qualifying
    { x: 625, y: 24, elapsedMs: 10 },   // first arrival at the exact requested point -- streak starts here
    { x: 625, y: 24, elapsedMs: 15 },
    { x: 625, y: 24, elapsedMs: 20 }
  ];
  const result = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.equal(result.settled, true);
  assert.equal(result.stableRunLength, 3);
  assert.deepEqual(result.acceptedSample, { x: 625, y: 24 });
});

test('E. transient +3/+4-from-requested-point samples inside the button do not qualify even though strict-interior, only the later exact samples settle', () => {
  const samples = [
    { x: 628, y: 24, elapsedMs: 5 },  // +3 from requested point -- does not qualify, even though well inside custodyBounds
    { x: 629, y: 24, elapsedMs: 10 }, // +4 -- does not qualify
    { x: 625, y: 24, elapsedMs: 15 }, // exact -- streak starts here
    { x: 625, y: 24, elapsedMs: 20 },
    { x: 625, y: 24, elapsedMs: 25 }
  ];
  const result = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.equal(result.settled, true);
  assert.equal(result.stableRunLength, 3);
  // The accepted sample cannot be either of the two +3/+4 transients.
  assert.notDeepEqual(result.acceptedSample, { x: 628, y: 24 });
  assert.notDeepEqual(result.acceptedSample, { x: 629, y: 24 });
});

test('F. stable +3-from-requested-point the whole time never qualifies and times out (no permanent multi-pixel displacement is accepted)', () => {
  const samples = [
    { x: 628, y: 24, elapsedMs: 50 },
    { x: 628, y: 24, elapsedMs: 150 },
    { x: 628, y: 24, elapsedMs: 860 } // exceeds DEFAULT_SETTLEMENT_TIMEOUT_MS (800)
  ];
  const result = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.equal(result.settled, false);
  assert.equal(result.reason, 'timeout');
});

test('G. enters the absolute-custody range then leaves before settling: streak resets, must not click', () => {
  const samples = [
    { x: 625, y: 24, elapsedMs: 5 },
    { x: 625, y: 24, elapsedMs: 10 },
    { x: 700, y: 24, elapsedMs: 15 } // leaves both the bound and the target on the 3rd sample
  ];
  const result = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.equal(result.settled, false);
});

test('H. foreground loss while waiting fails immediately, not after further polling', () => {
  const samples = [
    { x: 625, y: 24, elapsedMs: 5, foregroundOk: true },
    { x: 625, y: 24, elapsedMs: 10, foregroundOk: false },
    { x: 625, y: 24, elapsedMs: 15, foregroundOk: true } // must never be reached
  ];
  const result = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.equal(result.settled, false);
  assert.equal(result.reason, 'foreground-lost-during-settlement');
  assert.equal(result.stableRunLength, 1);
});

test('I. settles, then the final pre-SendInput sample is outside the absolute ±2 bound: rejected, no click', () => {
  const settlement = evaluateCursorSettlement([
    { x: 625, y: 24, elapsedMs: 5 },
    { x: 625, y: 24, elapsedMs: 10 },
    { x: 625, y: 24, elapsedMs: 15 }
  ], settlementTarget, custodyBounds);
  assert.equal(settlement.settled, true);
  const finalCheck = evaluateFinalPreSendCheck(settlementTarget, { x: 628, y: 24 }, custodyBounds);
  assert.equal(finalCheck.ok, false);
  assert.equal(finalCheck.reason, 'final-pre-send-check-outside-absolute-bound');
});

test('final pre-send check rejects a sample that is within the absolute bound but has left the target rect', () => {
  // Constructed only to isolate the interior branch: within ±1 of some
  // requested point yet outside custodyBounds by using a requestedPoint
  // right at the target's edge.
  const edgeRequested = { x: 601, y: 24 };
  const finalCheck = evaluateFinalPreSendCheck(edgeRequested, { x: 600, y: 24 }, custodyBounds);
  assert.equal(finalCheck.ok, false);
  assert.equal(finalCheck.reason, 'final-pre-send-check-left-target');
});

test('final pre-send check accepts a stable, in-target, absolute-custody confirmation sample', () => {
  const finalCheck = evaluateFinalPreSendCheck(settlementTarget, { x: 625, y: 24 }, custodyBounds);
  assert.equal(finalCheck.ok, true);
});

test('final pre-send check rejects on foreground loss even if the point is still within the absolute bound', () => {
  const finalCheck = evaluateFinalPreSendCheck(settlementTarget, { x: 625, y: 24, foregroundOk: false }, custodyBounds);
  assert.equal(finalCheck.ok, false);
  assert.equal(finalCheck.reason, 'foreground-lost-at-final-check');
});

test('a plain move with no target bounds only requires absolute-point stability, not target interior', () => {
  const samples = [
    { x: 10, y: 10, elapsedMs: 5 },
    { x: 10, y: 10, elapsedMs: 10 },
    { x: 11, y: 10, elapsedMs: 15 }
  ];
  const result = evaluateCursorSettlement(samples, { x: 10, y: 10 }, null);
  assert.equal(result.settled, true);
});

// J. call count: SetCursorPos-exactly-once is a property of the live
// native-input-worker.ps1 loop (it calls SetCursorPos once before any of
// this), not of these pure functions -- verified there, not here.
test('evaluateCursorSettlement and evaluateFinalPreSendCheck do not mutate their inputs (purity, no hidden repositioning)', () => {
  const samples = [{ x: 625, y: 24, elapsedMs: 5 }, { x: 625, y: 24, elapsedMs: 10 }, { x: 625, y: 24, elapsedMs: 15 }];
  const snapshot = JSON.parse(JSON.stringify(samples));
  evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
  assert.deepEqual(samples, snapshot);
  const finalSample = { x: 625, y: 24 };
  const finalSnapshot = JSON.parse(JSON.stringify(finalSample));
  evaluateFinalPreSendCheck(settlementTarget, finalSample, custodyBounds);
  assert.deepEqual(finalSample, finalSnapshot);
});

// K. JS DEFENSE-IN-DEPTH CONSISTENCY -- the actual SG1 regression guard:
// whatever evaluateCursorSettlement accepts must always also pass
// assertCursorCustody's independent, unchanged check against the same
// requestedPoint. This is what makes it structurally impossible for the
// worker's settlement gate and the JS redundant check to disagree again,
// rather than merely coincidentally agreeing on today's test fixtures.
test('K. every settlement evaluateCursorSettlement accepts also passes assertCursorCustody unchanged (worker/JS agreement)', () => {
  const acceptingCases = [
    { samples: [{ x: 625, y: 24, elapsedMs: 5 }, { x: 625, y: 24, elapsedMs: 10 }, { x: 625, y: 24, elapsedMs: 15 }] },
    { samples: [{ x: 626, y: 24, elapsedMs: 5 }, { x: 626, y: 24, elapsedMs: 10 }, { x: 626, y: 24, elapsedMs: 15 }] },
    { samples: [{ x: 624, y: 23, elapsedMs: 5 }, { x: 624, y: 23, elapsedMs: 10 }, { x: 624, y: 23, elapsedMs: 15 }] }
  ];
  for (const { samples } of acceptingCases) {
    const settlement = evaluateCursorSettlement(samples, settlementTarget, custodyBounds);
    assert.equal(settlement.settled, true);
    assert.doesNotThrow(() => assertCursorCustody(settlementTarget, settlement.acceptedSample, custodyBounds));
  }
});

// L. FAILURE OBSERVABILITY -- verified at the desktop-ux-functional-gate.js
// level (native error diagnostics attachment), not here; see
// native-input-worker.test.js / the gate script's click() catch block for
// the corresponding fix.
