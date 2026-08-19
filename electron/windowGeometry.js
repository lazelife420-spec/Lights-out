// Phase 5H-C: 900 used to be both the enforced minimum AND wider than the
// requested default (520) -- Electron clamps a new window up to minWidth at
// construction, so 520 was never the real default a fresh user saw; the
// real fresh-launch width was ~900, not 520. Raised so the shell has a real
// control-center canvas (Settings' rail+content split, Devices' cards, etc.
// all need real width to not read as cramped) instead of a narrow-utility
// floor: 1024 (up from 900), with NORMAL_DEFAULT now a single source of
// truth so main.js and exitMiniMode's fallback can't drift apart the way
// 520 (main.js) and 720 (this file's own exitMiniMode fallback) already had.
const NORMAL_MINIMUM = Object.freeze({ width: 1024, height: 640 });
const NORMAL_DEFAULT = Object.freeze({ width: 1180, height: 760 });
const MINI_GEOMETRY = Object.freeze({ width: 260, height: 320 });

function validBounds(bounds) {
  return bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]));
}

function clampNormalBounds(bounds, screenApi) {
  if (!validBounds(bounds) || !screenApi || typeof screenApi.getDisplayMatching !== 'function') return null;

  const candidate = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
  const work = screenApi.getDisplayMatching(candidate).workArea;
  const width = Math.min(Math.max(candidate.width, NORMAL_MINIMUM.width), work.width);
  const height = Math.min(Math.max(candidate.height, NORMAL_MINIMUM.height), work.height);
  const x = Math.min(Math.max(candidate.x, work.x), work.x + work.width - width);
  const y = Math.min(Math.max(candidate.y, work.y), work.y + work.height - height);
  return { x, y, width, height };
}

function applyNormalBounds(win, bounds, screenApi) {
  const target = clampNormalBounds(bounds, screenApi);
  if (!target) return null;

  // Frameless thick-frame windows can report a small native-frame delta after
  // setBounds(). Correct that bounded delta so persisted outer bounds do not
  // grow by a few pixels on every restart or Mini Mode round trip.
  let request = { ...target };
  for (let attempt = 0; attempt < 3; attempt++) {
    win.setBounds(request);
    const actual = win.getBounds();
    const delta = {
      x: target.x - actual.x,
      y: target.y - actual.y,
      width: target.width - actual.width,
      height: target.height - actual.height
    };
    if (Object.values(delta).every(value => value === 0)) return actual;
    request = {
      x: request.x + delta.x,
      y: request.y + delta.y,
      width: request.width + delta.width,
      height: request.height + delta.height
    };
  }
  return win.getBounds();
}

function enterMiniMode(win) {
  if (!win.normalModeBounds) {
    win.normalModeBounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  }
  if (!win.normalModeMinimum) win.normalModeMinimum = win.getMinimumSize();
  win.wasMaximizedBeforeMini = win.isMaximized();
  if (win.wasMaximizedBeforeMini) win.unmaximize();

  // Electron enforces the active minimum when setSize() runs, so the minimum
  // must change before requesting Mini Mode's exact geometry.
  win.setMinimumSize(MINI_GEOMETRY.width, MINI_GEOMETRY.height);
  win.setSize(MINI_GEOMETRY.width, MINI_GEOMETRY.height);
}

function exitMiniMode(win, screenApi) {
  const minimum = Array.isArray(win.normalModeMinimum)
    ? win.normalModeMinimum
    : [NORMAL_MINIMUM.width, NORMAL_MINIMUM.height];
  win.setMinimumSize(minimum[0], minimum[1]);

  const restoredBounds = applyNormalBounds(win, win.normalModeBounds, screenApi);
  if (!restoredBounds) win.setSize(NORMAL_DEFAULT.width, NORMAL_DEFAULT.height);
  if (win.wasMaximizedBeforeMini) win.maximize();

  win.normalModeBounds = null;
  win.normalModeMinimum = null;
  win.wasMaximizedBeforeMini = false;
}

module.exports = {
  NORMAL_MINIMUM,
  NORMAL_DEFAULT,
  MINI_GEOMETRY,
  clampNormalBounds,
  applyNormalBounds,
  enterMiniMode,
  exitMiniMode
};
