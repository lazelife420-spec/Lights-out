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

module.exports = {
  assertInputAllowed,
  isStrictInterior,
  reconcileTarget,
  sameIdentity,
  strictInteriorPoint,
  translateClientToScreen,
  validateHit,
  validateRect
};
