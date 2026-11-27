'use strict';

// Windows taskbar presence for an active Lights Out run.
//
// While a countdown (or its completion steps) is active, the taskbar button
// carries an overlay badge -- amber for a Test Mode run, rose for a REAL power
// action, the same colours as the tray dot -- and the window thumbnail gets a
// toolbar: Pause/Resume, Snooze +5 min and Cancel. During the completion phase
// (unsaved-work wait, Last Light, a Sleep/Hibernate pre-commit) only Cancel is
// offered, exactly like the tray's "Cancel pending power action". Idle clears
// both. Progress stays with main.js's setTaskbarProgress.
//
// The images are pre-rendered PNGs (assets/taskbar, from scripts/make-icons.js)
// at every small-icon size Windows uses (16/20/24/32 for 100/125/150/200%):
// Electron converts the NativeImage's 1x bitmap into a single HICON, so the
// PNG matching the display scale is chosen instead of letting Windows stretch
// a 16px one. Nothing here needs sharp at runtime.
//
// Everything is a no-op off Windows, without a window, or once the window is
// destroyed, and nothing here throws into the timer code that calls it.

const path = require('path');

const TASKBAR_ICON_SIZES = Object.freeze([16, 20, 24, 32]);
const OVERLAY_KINDS = Object.freeze(['test', 'real']);
const THUMB_GLYPHS = Object.freeze(['pause', 'resume', 'snooze', 'cancel']);
// Thumbnail flyouts follow the system (taskbar) theme: white glyphs on the
// dark flyout, black glyphs on the light one.
const THUMB_INKS = Object.freeze(['white', 'black']);
const TASKBAR_ASSET_DIR = path.join('assets', 'taskbar');

function overlayAssetFile(kind, paused, size) {
  return `overlay-${kind}${paused ? '-paused' : ''}-${size}.png`;
}

function thumbAssetFile(glyph, ink, size) {
  return `thumb-${glyph}-${ink}-${size}.png`;
}

// Every pre-rendered file the runtime may load, relative to the app root.
function allTaskbarAssetFiles() {
  const files = [];
  for (const kind of OVERLAY_KINDS) {
    for (const paused of [false, true]) {
      for (const size of TASKBAR_ICON_SIZES) files.push(path.posix.join('assets', 'taskbar', overlayAssetFile(kind, paused, size)));
    }
  }
  for (const glyph of THUMB_GLYPHS) {
    for (const ink of THUMB_INKS) {
      for (const size of TASKBAR_ICON_SIZES) files.push(path.posix.join('assets', 'taskbar', thumbAssetFile(glyph, ink, size)));
    }
  }
  return files;
}

// Smallest pre-rendered size that covers 16px at this display scale; the
// largest one beyond 200%.
function pickIconSize(scaleFactor) {
  const scale = Number(scaleFactor);
  const wanted = 16 * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  return TASKBAR_ICON_SIZES.find(size => size >= wanted - 0.01) || TASKBAR_ICON_SIZES[TASKBAR_ICON_SIZES.length - 1];
}

// Pure model of what the taskbar should show.
// snapshot: { running, paused, completing, dryRun, actionLabel, snoozeLabel }
//   completing = main.js isCompletionInFlight(): the countdown has ended but
//   the run is still cancellable before its power request is dispatched.
function describeTaskbarState(snapshot = {}) {
  const active = Boolean(snapshot.running || snapshot.paused);
  const completing = !active && Boolean(snapshot.completing);
  if (!active && !completing) return { overlay: null, buttons: [] };

  const kind = snapshot.dryRun ? 'test' : 'real';
  const action = typeof snapshot.actionLabel === 'string' && snapshot.actionLabel ? snapshot.actionLabel : 'Power action';
  const paused = active && Boolean(snapshot.paused);
  let description;
  if (kind === 'test') {
    description = completing ? 'Lights Out: Test Mode run finishing. Nothing will power off.'
      : paused ? 'Lights Out: Test Mode run paused. Nothing will power off.'
        : 'Lights Out: Test Mode run in progress. Nothing will power off.';
  } else {
    description = completing ? `Lights Out: REAL ${action} pending. It can still be cancelled.`
      : paused ? `Lights Out: REAL ${action} countdown paused.`
        : `Lights Out: REAL ${action} countdown running.`;
  }

  const buttons = completing
    ? [{ id: 'cancel', tooltip: kind === 'test' ? 'Cancel Test Mode run' : 'Cancel pending power action' }]
    : [
      paused ? { id: 'resume', tooltip: 'Resume' } : { id: 'pause', tooltip: 'Pause' },
      { id: 'snooze', tooltip: typeof snapshot.snoozeLabel === 'string' && snapshot.snoozeLabel ? snapshot.snoozeLabel : 'Snooze +5 min' },
      { id: 'cancel', tooltip: 'Cancel Timer' }
    ];
  return { overlay: { kind, paused, description }, buttons };
}

// deps:
//   platform        process.platform (only 'win32' does anything)
//   nativeImage     Electron nativeImage (createFromPath)
//   appRoot         directory holding assets/taskbar
//   getWindow()     the BrowserWindow that owns the taskbar button, or null
//   getScaleFactor(window)   display scale for that window (default 1)
//   useDarkGlyphs()          true when the system UI is light (black glyphs)
//   handlers        { pauseOrResume, snooze, cancel }: called on a click
//   log(message, extra)      best-effort diagnostics
function createTaskbarPresence(deps = {}) {
  const platform = deps.platform || process.platform;
  const images = new Map();
  let lastWindow = null;
  let lastOverlayKey = null;
  let lastButtonsKey = null;
  // Windows cannot remove a thumbnail toolbar once added (an empty list only
  // hides its buttons), so an idle window that never had one never gets one.
  let toolbarAdded = false;
  let overlaySet = false;
  const logged = new Set();

  function log(message, extra) {
    if (typeof deps.log !== 'function') return;
    const key = message + (extra && extra.file ? `:${extra.file}` : '');
    if (logged.has(key)) return;
    logged.add(key);
    try { deps.log(message, extra); } catch { /* diagnostics only */ }
  }

  function loadImage(file) {
    if (images.has(file)) return images.get(file);
    let image = null;
    try {
      const candidate = deps.nativeImage.createFromPath(path.join(deps.appRoot, TASKBAR_ASSET_DIR, file));
      if (candidate && !candidate.isEmpty()) image = candidate;
    } catch { /* fall through to null */ }
    if (!image) log('Taskbar asset unavailable', { file });
    images.set(file, image);
    return image;
  }

  function liveWindow() {
    try {
      const win = typeof deps.getWindow === 'function' ? deps.getWindow() : null;
      if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return null;
      return win;
    } catch {
      return null;
    }
  }

  function scaleFor(win) {
    try { return typeof deps.getScaleFactor === 'function' ? deps.getScaleFactor(win) : 1; } catch { return 1; }
  }

  function darkGlyphs() {
    try { return typeof deps.useDarkGlyphs === 'function' && Boolean(deps.useDarkGlyphs()); } catch { return false; }
  }

  function click(id) {
    const handlers = deps.handlers || {};
    const handler = id === 'pause' || id === 'resume' ? handlers.pauseOrResume : handlers[id];
    if (typeof handler !== 'function') return;
    try { handler(); } catch (error) { log('Taskbar button action failed', { button: id, message: error && error.message }); }
  }

  // Applies the snapshot to the window. Unchanged state is not re-sent unless
  // force is set (after the taskbar button was recreated, e.g. on show).
  function apply(snapshot, { force = false } = {}) {
    if (platform !== 'win32') return false;
    const win = liveWindow();
    if (!win) return false;
    if (win !== lastWindow) {
      lastWindow = win;
      lastOverlayKey = 'none';
      lastButtonsKey = null;
      toolbarAdded = false;
      overlaySet = false;
    }

    const state = describeTaskbarState(snapshot);
    const size = pickIconSize(scaleFor(win));
    const ink = darkGlyphs() ? 'black' : 'white';

    const overlayFile = state.overlay ? overlayAssetFile(state.overlay.kind, state.overlay.paused, size) : null;
    const overlayKey = state.overlay ? `${overlayFile}|${state.overlay.description}` : 'none';
    if ((force || overlayKey !== lastOverlayKey) && (state.overlay || overlaySet)) {
      try {
        const image = overlayFile ? loadImage(overlayFile) : null;
        if (image) {
          win.setOverlayIcon(image, state.overlay.description);
          overlaySet = true;
        } else if (overlaySet) {
          win.setOverlayIcon(null, '');
          overlaySet = false;
        }
        lastOverlayKey = overlayKey;
      } catch (error) {
        lastOverlayKey = null;
        log('Taskbar overlay unavailable', { message: error && error.message });
      }
    }

    const buttonsKey = state.buttons.length
      ? `${ink}|${size}|${state.buttons.map(button => `${button.id}:${button.tooltip}`).join(',')}`
      : 'none';
    if (force || buttonsKey !== lastButtonsKey) {
      try {
        const buttons = [];
        for (const button of state.buttons) {
          const icon = loadImage(thumbAssetFile(button.id, ink, size));
          if (!icon) continue;
          buttons.push({ icon, tooltip: button.tooltip, click: () => click(button.id) });
        }
        if (buttons.length || toolbarAdded) {
          const ok = win.setThumbarButtons(buttons);
          if (buttons.length) toolbarAdded = true;
          // A refused call (no taskbar button yet) is retried on the next apply.
          lastButtonsKey = ok === false ? null : buttonsKey;
        } else {
          lastButtonsKey = buttonsKey;
        }
      } catch (error) {
        lastButtonsKey = null;
        log('Taskbar thumbnail toolbar unavailable', { message: error && error.message });
      }
    }
    return true;
  }

  return { apply, describe: describeTaskbarState };
}

module.exports = {
  TASKBAR_ICON_SIZES,
  OVERLAY_KINDS,
  THUMB_GLYPHS,
  THUMB_INKS,
  overlayAssetFile,
  thumbAssetFile,
  allTaskbarAssetFiles,
  pickIconSize,
  describeTaskbarState,
  createTaskbarPresence
};
