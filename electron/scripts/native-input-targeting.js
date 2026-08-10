'use strict';

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

const MAX_CURSOR_READBACK_PIXELS = 1;

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

module.exports = {
  assertCursorCustody,
  assertInputAllowed,
  assertSendInputComplete,
  atomicClickContract,
  isStrictInterior,
  MAX_CURSOR_READBACK_PIXELS,
  reconcileTarget,
  rectFromBounds,
  sameIdentity,
  strictInteriorPoint,
  translateClientToScreen,
  validateBrowserGesture,
  validateHit,
  validateRect
};
