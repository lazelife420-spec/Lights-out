const { app, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  NORMAL_MINIMUM,
  MINI_GEOMETRY,
  clampNormalBounds,
  applyNormalBounds,
  enterMiniMode,
  exitMiniMode
} = require('../windowGeometry');

const isolatedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-window-geometry-'));
app.setPath('userData', isolatedUserData);
app.commandLine.appendSwitch('disable-gpu');

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertBoundsNear(actual, expected, label, tolerance = 2) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (Math.abs(actual[key] - expected[key]) > tolerance) {
      throw new Error(`${label}.${key}: expected ${expected[key]} ± ${tolerance}, got ${actual[key]}`);
    }
  }
}

function createTestWindow(bounds) {
  return new BrowserWindow({
    ...bounds,
    minWidth: NORMAL_MINIMUM.width,
    minHeight: NORMAL_MINIMUM.height,
    frame: false,
    thickFrame: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
}

app.whenReady().then(() => {
  let win;
  let relaunched;
  try {
    const work = screen.getPrimaryDisplay().workArea;
    const normalBounds = clampNormalBounds({
      x: work.x + 40,
      y: work.y + 40,
      width: 703,
      height: 722
    }, screen);

    win = createTestWindow(normalBounds);
    const savedNormalBounds = win.getBounds();

    enterMiniMode(win);
    assertDeepEqual(win.getMinimumSize(), [260, 320], 'Mini Mode minimum');
    const observedMiniOuterSize = win.getSize();
    // Windows 11 adds a small thick-frame delta; Server 2025 can report the
    // requested size exactly. Keep a bounded native-frame allowance, rather
    // than treating one desktop theme's border as the product geometry.
    const frameAllowance = process.platform === 'win32' ? 2 : 0;
    [MINI_GEOMETRY.width, MINI_GEOMETRY.height].forEach((requested, index) => {
      assert(observedMiniOuterSize[index] >= requested && observedMiniOuterSize[index] <= requested + frameAllowance,
        `Mini Mode dimension ${index}: expected ${requested}..${requested + frameAllowance}, got ${observedMiniOuterSize[index]}`);
    });
    assert(!win.isMaximizable(), 'Mini Mode cannot maximize');

    exitMiniMode(win, screen);
    assertDeepEqual(
      win.getMinimumSize(),
      [NORMAL_MINIMUM.width, NORMAL_MINIMUM.height],
      'restored normal minimum'
    );
    assertBoundsNear(win.getBounds(), savedNormalBounds, 'restored normal bounds', 0);

    const clamped = clampNormalBounds({
      x: work.x + work.width + 500,
      y: work.y + work.height + 500,
      width: work.width + 500,
      height: work.height + 500
    }, screen);
    assert(clamped.x >= work.x && clamped.y >= work.y, 'clamped bounds start inside the display');
    assert(clamped.x + clamped.width <= work.x + work.width, 'clamped width stays inside the display');
    assert(clamped.y + clamped.height <= work.y + work.height, 'clamped height stays inside the display');

    win.destroy();
    win = null;

    // A new normal window consumes the persisted normal bounds, not the
    // transient Mini Mode size, so a relaunch cannot trap the app at 260x320.
    relaunched = createTestWindow({ width: 520, height: 800 });
    applyNormalBounds(relaunched, savedNormalBounds, screen);
    assertDeepEqual(
      relaunched.getMinimumSize(),
      [NORMAL_MINIMUM.width, NORMAL_MINIMUM.height],
      'relaunch normal minimum'
    );
    assertBoundsNear(relaunched.getBounds(), savedNormalBounds, 'relaunch restored bounds', 0);
    const relaunchedSize = relaunched.getSize();
    assert(relaunchedSize[0] === savedNormalBounds.width, 'relaunch width restores exactly');
    assert(relaunchedSize[1] === savedNormalBounds.height, 'relaunch height restores exactly');

    console.log(JSON.stringify({
      requestedMiniSize: [MINI_GEOMETRY.width, MINI_GEOMETRY.height],
      observedMiniOuterSize,
      displayScaleFactor: screen.getPrimaryDisplay().scaleFactor,
      normalMinimum: [NORMAL_MINIMUM.width, NORMAL_MINIMUM.height],
      restoredBounds: savedNormalBounds,
      displayClamping: 'pass',
      relaunch: 'pass',
      isolatedUserData
    }, null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    if (relaunched && !relaunched.isDestroyed()) relaunched.destroy();
    try { fs.rmSync(isolatedUserData, { recursive: true, force: true }); } catch {}
    app.exit(process.exitCode || 0);
  }
});
