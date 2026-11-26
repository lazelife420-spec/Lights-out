'use strict';
// First Light from a cold launch (the wake task starting the app) must play.
// Electron 43.8.4, measured with a bare BrowserWindow: isLoadingMainFrame()
// is still true inside 'did-finish-load' and false only from
// 'did-stop-loading' on. A request made while the page loads was flushed only
// in 'did-finish-load', so it stayed pending and the sunrise never ran.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createDelivery, isWindowReady, flushWhenLoaded } = require('../firstLightDelivery');

function fakeWindow() {
  const webContents = new EventEmitter();
  webContents.loading = true;
  webContents.isLoadingMainFrame = () => webContents.loading;
  return { webContents, isDestroyed: () => false };
}

// Replays the order Electron emits for a main-frame load.
function finishLoading(win) {
  win.webContents.emit('dom-ready');
  win.webContents.emit('did-finish-load'); // still "loading" here
  win.webContents.loading = false;
  win.webContents.emit('did-stop-loading');
}

function wire(win) {
  const starts = [];
  const delivery = createDelivery({
    ready: () => isWindowReady(win), busy: () => false,
    claim: () => true, start: id => starts.push(id), onError: error => { throw error; }
  });
  flushWhenLoaded(win.webContents, delivery);
  // main.js also flushes inside did-finish-load; keep that path in the replay.
  win.webContents.once('did-finish-load', () => delivery.flush());
  return { delivery, starts };
}

test('a First Light request made while the window loads plays once loading stops', () => {
  const win = fakeWindow();
  const { delivery, starts } = wire(win);
  assert.equal(delivery.request(['app.exe', '--first-light', '--first-light-request=wake-1']), true);
  assert.deepEqual(starts, [], 'not delivered while the page is loading');
  finishLoading(win);
  assert.deepEqual(starts, ['wake-1'], 'delivered at did-stop-loading');
  win.webContents.emit('did-stop-loading');
  assert.deepEqual(starts, ['wake-1'], 'a later stop-loading never replays it');
});

test('a request after the window has loaded (app already running) plays at once', () => {
  const win = fakeWindow();
  const { delivery, starts } = wire(win);
  finishLoading(win);
  delivery.request(['app.exe', '--first-light', '--first-light-request=wake-2']);
  assert.deepEqual(starts, ['wake-2']);
});

test('a destroyed or missing window is never ready', () => {
  assert.equal(isWindowReady(null), false);
  assert.equal(isWindowReady({ isDestroyed: () => true, webContents: { isLoadingMainFrame: () => false } }), false);
});

test('main.js uses the shared readiness check and flushes when loading stops', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /ready: \(\) => firstLightModule\.isWindowReady\(mainWindow\)/);
  assert.match(main, /firstLightModule\.flushWhenLoaded\(mainWindow\.webContents, firstLightDelivery\)/);
});
