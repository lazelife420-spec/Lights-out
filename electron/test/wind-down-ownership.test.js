'use strict';

// Wind-down ownership: when a timer stops, restoreAfterTimer() may undo only
// what this run's dim phase actually changed.
//
// The Windows media key is a play/pause TOGGLE. restoreAfterTimer() used to
// send it on every cancel, stop and completion, so with "Pause media at
// wind-down" off (the default) it paused whatever the user was playing each
// time a timer ended. It also removed the Night Light registry value even when
// Lights Out never set it, which could switch off the user's own Night Light.
//
// The real applyDimPhase()/restoreAfterTimer() bodies run in a vm sandbox whose
// media, PowerShell, Wi-Fi Guard and content-blocker hooks are recording mocks:
// no key press, registry write or network call can happen from this file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found in main.js`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length;
  let parenDepth = 1;
  while (parenDepth > 0 && i < source.length) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') parenDepth--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

function extractStatement(source, startsWith) {
  const start = source.indexOf(startsWith);
  if (start < 0) throw new Error(`statement "${startsWith}" not found in main.js`);
  const end = source.indexOf(';\n', start);
  return source.slice(start, end + 1);
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function createSandbox({ app = {}, pausedCount = 0, holdPause = false } = {}) {
  const calls = { resume: 0, pause: 0, ps: [], sent: [] };
  let releasePause = null;
  const sandbox = {
    console: { warn: () => {}, log: () => {}, error: () => {} },
    Date,
    settingsStore: {
      getSection: name => (name === 'app' ? app : null)
    },
    media: {
      pauseAllDetectedMedia: () => {
        calls.pause++;
        const result = { count: pausedCount, paused: pausedCount ? ['spotify'] : [] };
        if (!holdPause) return Promise.resolve(result);
        return new Promise(resolve => { releasePause = () => resolve(result); });
      },
      resumeAllMedia: async () => { calls.resume++; }
    },
    executePowerShell: async command => { calls.ps.push(command); return ''; },
    applyFocusMode: () => {},
    wifiGuard: { blockInternet: async () => ({ success: false }), unblockInternet: async () => ({ success: false }) },
    contentBlocker: { DEFAULT_BLOCKLIST: [], blockSites: async () => ({ success: false }), unblockSites: async () => {}, isAnyScheduleActive: () => false },
    mainWindow: {
      isDestroyed: () => false,
      setOpacity: () => {},
      setAlwaysOnTop: () => {},
      setMenuBarVisibility: () => {},
      webContents: { send: (channel, data) => calls.sent.push({ channel, data }) }
    }
  };
  vm.createContext(sandbox);
  const code = [
    extractStatement(mainSource, 'const windDownChanges = '),
    extractFunction(mainSource, 'applyDimPhase'),
    extractFunction(mainSource, 'restoreAfterTimer'),
    'globalThis.applyDimPhase = applyDimPhase; globalThis.restoreAfterTimer = restoreAfterTimer;'
  ].join('\n');
  vm.runInContext(code, sandbox);
  return { sandbox, calls, releasePause: () => releasePause && releasePause() };
}

const nightLightRemovals = calls => calls.ps.filter(c => /Remove-ItemProperty/.test(c) && /bluelightreduction/.test(c)).length;
const nightLightWrites = calls => calls.ps.filter(c => /Set-ItemProperty/.test(c) && /bluelightreduction/.test(c)).length;

test('a timer that stops before wind-down never sends the play/pause key', async () => {
  const { sandbox, calls } = createSandbox({ app: { pauseMediaOnDim: true, nightLightOnDim: true } });
  sandbox.restoreAfterTimer();
  await flush();
  assert.equal(calls.resume, 0, 'no media key when nothing was paused');
  assert.equal(nightLightRemovals(calls), 0, 'the user\'s own Night Light is left alone');
});

test('with "Pause media at wind-down" off, stopping after the dim phase leaves playing media alone', async () => {
  const { sandbox, calls } = createSandbox({ app: { pauseMediaOnDim: false } });
  sandbox.applyDimPhase(60, 240);
  sandbox.restoreAfterTimer();
  await flush();
  assert.equal(calls.pause, 0);
  assert.equal(calls.resume, 0, 'restore must not toggle media the app never paused');
});

test('media paused by this run resumes exactly once when the timer stops', async () => {
  const { sandbox, calls } = createSandbox({ app: { pauseMediaOnDim: true }, pausedCount: 2 });
  sandbox.applyDimPhase(60, 240);
  await flush();
  assert.equal(calls.pause, 1);
  assert.ok(calls.sent.some(s => s.channel === 'media-paused'), 'the renderer still hears about the pause');
  sandbox.restoreAfterTimer();
  await flush();
  assert.equal(calls.resume, 1);
  sandbox.restoreAfterTimer();
  await flush();
  assert.equal(calls.resume, 1, 'a second restore does not toggle again');
});

test('when the dim phase found no player to pause, stopping sends no key', async () => {
  const { sandbox, calls } = createSandbox({ app: { pauseMediaOnDim: true }, pausedCount: 0 });
  sandbox.applyDimPhase(60, 240);
  sandbox.restoreAfterTimer();
  await flush();
  assert.equal(calls.pause, 1);
  assert.equal(calls.resume, 0);
});

test('a cancel while the pause is still in flight resumes only after it really paused', async () => {
  const { sandbox, calls, releasePause } = createSandbox({ app: { pauseMediaOnDim: true }, pausedCount: 1, holdPause: true });
  sandbox.applyDimPhase(60, 240);
  sandbox.restoreAfterTimer();
  await flush();
  assert.equal(calls.resume, 0, 'nothing is resumed before the pause lands');
  releasePause();
  await flush();
  await flush();
  assert.equal(calls.resume, 1, 'the pause this run made is undone');
});

test('Night Light is removed only when this run turned it on, and only once', async () => {
  const { sandbox, calls } = createSandbox({ app: { nightLightOnDim: true } });
  sandbox.applyDimPhase(60, 240);
  assert.equal(nightLightWrites(calls), 1);
  sandbox.restoreAfterTimer();
  sandbox.restoreAfterTimer();
  await flush();
  assert.equal(nightLightRemovals(calls), 1);
});

test('a run whose dim phase did not touch Night Light leaves the user\'s Night Light alone', async () => {
  const { sandbox, calls } = createSandbox({ app: { nightLightOnDim: false } });
  sandbox.applyDimPhase(60, 240);
  sandbox.restoreAfterTimer();
  await flush();
  assert.equal(nightLightWrites(calls), 0);
  assert.equal(nightLightRemovals(calls), 0);
});
