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

// COLD-04 / P1: readback exceeding the one-pixel bound still prevents the
// gesture. This replaces the pre-correction exact-equality expectation
// (a 1px delta used to throw here; see the bounded-custody suite below for
// why that was stricter than the actual target-custody requirement).
test('cursor readback beyond the one-pixel bound prevents any native gesture', () => {
  assert.throws(() => assertCursorCustody({ x: 100, y: 200 }, { x: 102, y: 200 }), /custody was not established/);
  assert.throws(() => assertCursorCustody({ x: 100, y: 200 }, { x: 100, y: 202 }), /custody was not established/);
});

test('non-finite or missing cursor points prevent the native gesture', () => {
  assert.throws(() => assertCursorCustody(null, { x: 100, y: 200 }), /custody was not established/);
  assert.throws(() => assertCursorCustody({ x: 100, y: 200 }, { x: NaN, y: 200 }), /custody was not established/);
});

// COLD-04 / P1 bounded-custody suite: a readback within one physical pixel is
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

test('two-pixel X readback is rejected even while still inside the target', () => {
  assert.throws(
    () => assertCursorCustody({ x: 625, y: 24 }, { x: 627, y: 24 }, custodyBounds),
    /custody was not established/
  );
});

test('two-pixel Y readback is rejected even while still inside the target', () => {
  assert.throws(
    () => assertCursorCustody({ x: 625, y: 24 }, { x: 625, y: 26 }, custodyBounds),
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

// PR43 cursor-custody settlement gate. evaluateCursorSettlement/
// evaluateFinalPreSendCheck are the pure mirror of native-input-worker.ps1's
// live polling loop (which calls real Win32 GetCursorPos/GetForegroundWindow
// in a real time-bounded loop and so can't be unit-tested directly -- same
// duplication pattern as assertCursorCustody's JS copy vs. its PowerShell
// copy). Target for all cases below is the existing custodyBounds fixture
// -> bounds {left:600,top:10,right:650,bottom:38}, deep-interior center (625,24).

test('A. exact immediate: requested point returned immediately and remains stable settles on the third sample', () => {
  const samples = [
    { x: 625, y: 24, elapsedMs: 5 },
    { x: 625, y: 24, elapsedMs: 10 },
    { x: 625, y: 24, elapsedMs: 15 }
  ];
  const result = evaluateCursorSettlement(samples, custodyBounds);
  assert.equal(result.settled, true);
  assert.deepEqual(result.acceptedSample, { x: 625, y: 24 });
  assert.equal(result.stableRunLength, 3);
});

test('B. old ±1-safe readback: differs by <=1 and stable/strict-interior settles', () => {
  const samples = [
    { x: 624, y: 24, elapsedMs: 5 },
    { x: 625, y: 24, elapsedMs: 10 },
    { x: 624, y: 25, elapsedMs: 15 }
  ];
  const result = evaluateCursorSettlement(samples, custodyBounds);
  assert.equal(result.settled, true);
  assert.deepEqual(result.acceptedSample, { x: 624, y: 25 });
});

test('C. stale previous position then converges: old -> intermediate -> target -> stable -> stable settles only after settlement, not on first arrival', () => {
  const samples = [
    { x: 40, y: 40, elapsedMs: 2 },     // old/previous position, not interior
    { x: 300, y: 200, elapsedMs: 6 },   // intermediate, still not interior
    { x: 625, y: 24, elapsedMs: 10 },   // first arrival inside target -- run starts here, not yet accepted
    { x: 625, y: 24, elapsedMs: 15 },
    { x: 626, y: 24, elapsedMs: 20 }
  ];
  const result = evaluateCursorSettlement(samples, custodyBounds);
  assert.equal(result.settled, true);
  assert.equal(result.stableRunLength, 3);
  assert.deepEqual(result.acceptedSample, { x: 626, y: 24 });
  // Confirms first arrival alone was not sufficient: settling required all 3.
  assert.notDeepEqual(result.acceptedSample, samples[2]);
});

test('D. transient +2-inside-target sample followed by continued substantial movement must not settle on the first sample', () => {
  const samples = [
    { x: 627, y: 26, elapsedMs: 5 },  // interior (+2/+2-shaped offset), run count 1
    { x: 635, y: 30, elapsedMs: 10 }  // still interior but a step >1px -- resets the run, never reaches 3
  ];
  const result = evaluateCursorSettlement(samples, custodyBounds);
  assert.equal(result.settled, false);
  assert.equal(result.acceptedSample, null);
});

test('E. cursor enters the target then leaves before settling is rejected', () => {
  const samples = [
    { x: 625, y: 24, elapsedMs: 5 },   // interior, run count 1
    { x: 700, y: 24, elapsedMs: 10 }   // outside the target -- run cleared, no push
  ];
  const result = evaluateCursorSettlement(samples, custodyBounds);
  assert.equal(result.settled, false);
});

test('F. cursor never settles within the bounded timeout fails closed', () => {
  const samples = [
    { x: 625, y: 24, elapsedMs: 100 },
    { x: 635, y: 24, elapsedMs: 200 },
    { x: 625, y: 24, elapsedMs: 300 } // exceeds DEFAULT_SETTLEMENT_TIMEOUT_MS (250)
  ];
  const result = evaluateCursorSettlement(samples, custodyBounds);
  assert.equal(result.settled, false);
  assert.equal(result.reason, 'timeout');
});

test('G. cursor settles (stops moving) but outside the target is rejected, not accepted as "stable"', () => {
  const samples = [
    { x: 40, y: 40, elapsedMs: 50 },
    { x: 40, y: 40, elapsedMs: 150 },
    { x: 40, y: 40, elapsedMs: 260 } // stable the whole time, but never interior; times out
  ];
  const result = evaluateCursorSettlement(samples, custodyBounds);
  assert.equal(result.settled, false);
  assert.equal(result.reason, 'timeout');
});

test('H. foreground loss while waiting fails immediately, not after further polling', () => {
  const samples = [
    { x: 625, y: 24, elapsedMs: 5, foregroundOk: true },
    { x: 625, y: 24, elapsedMs: 10, foregroundOk: false },
    { x: 625, y: 24, elapsedMs: 15, foregroundOk: true } // must never be reached
  ];
  const result = evaluateCursorSettlement(samples, custodyBounds);
  assert.equal(result.settled, false);
  assert.equal(result.reason, 'foreground-lost-during-settlement');
  assert.equal(result.stableRunLength, 1);
});

test('I. settles, then the final pre-SendInput check sample has left the target: rejected, no click', () => {
  const settlement = evaluateCursorSettlement([
    { x: 625, y: 24, elapsedMs: 5 },
    { x: 625, y: 24, elapsedMs: 10 },
    { x: 625, y: 24, elapsedMs: 15 }
  ], custodyBounds);
  assert.equal(settlement.settled, true);
  const finalCheck = evaluateFinalPreSendCheck(settlement.acceptedSample, { x: 700, y: 24 }, custodyBounds);
  assert.equal(finalCheck.ok, false);
  assert.equal(finalCheck.reason, 'final-pre-send-check-left-target');
});

test('final pre-send check accepts a stable, in-target confirmation sample', () => {
  const settlement = evaluateCursorSettlement([
    { x: 625, y: 24, elapsedMs: 5 },
    { x: 625, y: 24, elapsedMs: 10 },
    { x: 625, y: 24, elapsedMs: 15 }
  ], custodyBounds);
  const finalCheck = evaluateFinalPreSendCheck(settlement.acceptedSample, { x: 625, y: 24 }, custodyBounds);
  assert.equal(finalCheck.ok, true);
});

test('final pre-send check rejects on foreground loss even if the point is still interior', () => {
  const finalCheck = evaluateFinalPreSendCheck({ x: 625, y: 24 }, { x: 625, y: 24, foregroundOk: false }, custodyBounds);
  assert.equal(finalCheck.ok, false);
  assert.equal(finalCheck.reason, 'foreground-lost-at-final-check');
});

test('a plain move with no target bounds only requires consecutive-step stability, not target interior', () => {
  const samples = [
    { x: 10, y: 10, elapsedMs: 5 },
    { x: 10, y: 10, elapsedMs: 10 },
    { x: 11, y: 10, elapsedMs: 15 }
  ];
  const result = evaluateCursorSettlement(samples, null);
  assert.equal(result.settled, true);
});

// J. call count: SetCursorPos-exactly-once is a property of the live
// native-input-worker.ps1 loop (it calls SetCursorPos once before any of
// this), not of these pure functions -- verified there, not here. What is
// verifiable here is that evaluating settlement is side-effect-free: it
// never mutates the caller's sample objects (i.e. it cannot itself be
// mistaken for a positioning action).
test('evaluateCursorSettlement and evaluateFinalPreSendCheck do not mutate their inputs (purity, no hidden repositioning)', () => {
  const samples = [{ x: 625, y: 24, elapsedMs: 5 }, { x: 625, y: 24, elapsedMs: 10 }, { x: 625, y: 24, elapsedMs: 15 }];
  const snapshot = JSON.parse(JSON.stringify(samples));
  const settlement = evaluateCursorSettlement(samples, custodyBounds);
  assert.deepEqual(samples, snapshot);
  const finalSample = { x: 625, y: 24 };
  const finalSnapshot = JSON.parse(JSON.stringify(finalSample));
  evaluateFinalPreSendCheck(settlement.acceptedSample, finalSample, custodyBounds);
  assert.deepEqual(finalSample, finalSnapshot);
});
