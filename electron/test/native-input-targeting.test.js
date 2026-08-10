'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertCursorCustody,
  assertInputAllowed,
  assertSendInputComplete,
  atomicClickContract,
  isStrictInterior,
  reconcileTarget,
  strictInteriorPoint,
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
