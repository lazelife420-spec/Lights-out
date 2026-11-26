'use strict';

// docs-truth-9: the wind-down media pause used to send one play/pause toggle
// whenever a known player process (chrome, Discord, slack...) was merely
// running, and reported every running process as "paused". A paused session
// was started by that toggle, and the 'Media paused: ...' toast named apps that
// were never playing. pauseAllDetectedMedia now asks Windows for the current
// media session first and reports only a session that stopped playing.
//
// media.js runs with child_process stubbed: no PowerShell, no key is sent.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

const mediaPath = require.resolve('../media');

async function withFakePowerShell(stdoutFor, fn) {
  const commands = [];
  const originalLoad = Module._load;
  delete require.cache[mediaPath];
  Module._load = function (request) {
    if (request === 'child_process') {
      return {
        spawn: (cmd, args, options) => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = () => {};
          commands.push({ cmd, args, options });
          const out = stdoutFor(args[args.length - 1], options);
          setImmediate(() => {
            if (out instanceof Error) { child.emit('error', out); return; }
            if (out) child.stdout.emit('data', Buffer.from(out));
            child.emit('close', 0);
          });
          return child;
        }
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    return await fn(require('../media'), commands);
  } finally {
    Module._load = originalLoad;
    delete require.cache[mediaPath];
  }
}

test('a running media process alone is never reported as paused', async () => {
  // What the old Get-Process detection printed for open, idle players.
  await withFakePowerShell(() => 'chrome:3\r\nDiscord:1\r\nslack:2\r\n', async (media) => {
    const result = await media.pauseAllDetectedMedia();
    assert.deepEqual(result.paused, []);
    assert.equal(result.count, 0, 'count 0: no toast and no resume toggle on cancel');
    assert.equal(result.keySent, false);
  });
});

test('a paused current session gets no toggle and no claim', async () => {
  await withFakePowerShell(() => 'LO_MEDIA|Paused|msedge.exe\r\n', async (media, commands) => {
    const result = await media.pauseAllDetectedMedia();
    assert.equal(commands.length, 1, 'one PowerShell run: the state check and the key are not split');
    assert.deepEqual(result, { paused: [], count: 0, keySent: false, playbackStatus: 'paused', appId: null });
  });
});

test('only a session that stopped playing after the key counts as paused', async () => {
  await withFakePowerShell(() => 'LO_MEDIA|paused|Spotify.exe\r\n', async (media) => {
    const result = await media.pauseAllDetectedMedia();
    assert.deepEqual(result.paused, ['Spotify']);
    assert.equal(result.count, 1);
    assert.equal(result.keySent, true);
  });
  // Key sent, but Windows still reports Playing: nothing is claimed, and
  // count stays 0 so a cancel does not toggle it a second time.
  await withFakePowerShell(() => 'LO_MEDIA|sent|Spotify.exe\r\n', async (media) => {
    const result = await media.pauseAllDetectedMedia();
    assert.deepEqual(result.paused, []);
    assert.equal(result.count, 0);
    assert.equal(result.keySent, true);
  });
});

test('no session, an unreadable state or a failed spawn sends nothing and claims nothing', async () => {
  for (const out of ['LO_MEDIA|none|\r\n', 'LO_MEDIA|unknown|\r\n', '', new Error('spawn powershell.exe ENOENT')]) {
    await withFakePowerShell(() => out, async (media) => {
      const result = await media.pauseAllDetectedMedia();
      assert.equal(result.count, 0);
      assert.deepEqual(result.paused, []);
      assert.equal(result.keySent, false);
    });
  }
});

test('the PowerShell command sends the key only after a Playing check, in the same run', () => {
  const { PAUSE_PLAYING_MEDIA_COMMAND: cmd } = require('../media');
  const playingGate = cmd.indexOf("if ($status -ne 'Playing')");
  const key = cmd.indexOf('SendKeys([char]179)');
  assert.ok(cmd.includes('GlobalSystemMediaTransportControlsSessionManager'), 'reads Windows media session state');
  assert.ok(cmd.includes('GetCurrentSession()'), 'the media key acts on the current session, so that is the one checked');
  assert.ok(playingGate > 0 && key > playingGate, 'the toggle is behind the Playing check');
  assert.equal(cmd.split('SendKeys(').length - 1, 1, 'exactly one key press');
  assert.ok(!cmd.includes('"'), 'no double quotes: the command goes through powershell -Command');
});

test('media app labels are readable and safe for the toast', () => {
  const { mediaAppLabel } = require('../media');
  assert.equal(mediaAppLabel('Spotify.exe'), 'Spotify');
  assert.equal(mediaAppLabel('msedge.exe'), 'msedge');
  assert.equal(mediaAppLabel('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic'), 'Microsoft.ZuneMusic');
  assert.equal(mediaAppLabel('308046B0AF4A39CB'), 'the current media app', 'opaque Firefox id');
  assert.equal(mediaAppLabel(''), 'the current media app');
  assert.equal(mediaAppLabel('<img src=x onerror=1>.exe'), 'img srcx onerror1');
  assert.ok(mediaAppLabel('A'.repeat(200)).length <= 48);
});

// review:docs: the resume half mirrors the pause. The play/pause key toggles
// whatever session is current at cancel time, so an unconditional resume
// paused music the user had restarted and started another app's paused video.
// resumeAllMedia(appId) sends the key only to the session the pause stopped,
// and only while Windows reports it Paused.

const sendsKey = command => /SendKeys/.test(command);
const keyRuns = commands => commands.filter(c => sendsKey(c.args[c.args.length - 1]));

// The fake answers the read-only state probe with `state` and the key run with
// `keyReply` (what the in-run gate would print).
function fakeSessions(state, keyReply = 'LO_MEDIA_RESUME|resumed|Playing|Spotify.exe') {
  return command => (sendsKey(command) ? keyReply : `LO_MEDIA_STATE|${state}\r\n`);
}

test('the pause reports the id of the session it actually paused, and null otherwise', async () => {
  await withFakePowerShell(() => 'LO_MEDIA|paused|Spotify.exe\r\n', async (media) => {
    assert.equal((await media.pauseAllDetectedMedia()).appId, 'Spotify.exe');
  });
  for (const out of ['LO_MEDIA|sent|Spotify.exe', 'LO_MEDIA|Paused|msedge.exe', 'LO_MEDIA|none|', '', new Error('ENOENT')]) {
    await withFakePowerShell(() => out, async (media) => {
      assert.equal((await media.pauseAllDetectedMedia()).appId, null, `no id for ${out}`);
    });
  }
});

test('resume with no recorded app id sends nothing and starts no PowerShell', async () => {
  await withFakePowerShell(fakeSessions('Paused|Spotify.exe'), async (media, commands) => {
    for (const missing of [undefined, null, '']) {
      const result = await media.resumeAllMedia(missing);
      assert.deepEqual(result, { resumed: false, keySent: false, reason: 'no-app-id' });
    }
    assert.deepEqual(await media.resumeAllMedia(), { resumed: false, keySent: false, reason: 'no-app-id' }, 'no argument at all');
    for (const bad of [42, {}, ' Spotify.exe', 'Spotify.exe\r\nx', 'A'.repeat(600)]) {
      const result = await media.resumeAllMedia(bad);
      assert.equal(result.resumed, false);
      assert.equal(result.reason, 'invalid-app-id');
    }
    assert.equal(commands.length, 0, 'fail safe: nothing is spawned without a usable id');
  });
});

test('resume sends no key when the current session is playing again', async () => {
  // Wind-down paused Spotify, then the user pressed play: the toggle would pause it.
  await withFakePowerShell(fakeSessions('Playing|Spotify.exe'), async (media, commands) => {
    const result = await media.resumeAllMedia('Spotify.exe');
    assert.equal(result.resumed, false);
    assert.equal(result.keySent, false);
    assert.equal(result.reason, 'not-paused');
    assert.equal(keyRuns(commands).length, 0, 'no key run');
    assert.equal(commands.length, 1, 'only the read-only state probe ran');
  });
});

test('resume sends no key when a different app owns the current session', async () => {
  // The user paused a video in Edge after the wind-down paused Spotify.
  await withFakePowerShell(fakeSessions('Paused|msedge.exe'), async (media, commands) => {
    const result = await media.resumeAllMedia('Spotify.exe');
    assert.deepEqual(result, { resumed: false, keySent: false, reason: 'other-app' });
    assert.equal(keyRuns(commands).length, 0);
  });
  // Exact match only: another case or a suffix is a different id.
  for (const other of ['spotify.exe', 'Spotify.exe2', 'Spotify']) {
    await withFakePowerShell(fakeSessions(`Paused|${other}`), async (media, commands) => {
      assert.equal((await media.resumeAllMedia('Spotify.exe')).reason, 'other-app', other);
      assert.equal(keyRuns(commands).length, 0);
    });
  }
});

test('resume sends no key with no session, an unreadable state or a failed probe', async () => {
  for (const [out, reason] of [['LO_MEDIA_STATE|none|', 'no-session'], ['LO_MEDIA_STATE|unknown|', 'unknown'], ['', 'unknown'], [new Error('ENOENT'), 'unknown']]) {
    await withFakePowerShell(command => (sendsKey(command) ? 'LO_MEDIA_RESUME|resumed|Playing|Spotify.exe' : out), async (media, commands) => {
      const result = await media.resumeAllMedia('Spotify.exe');
      assert.equal(result.resumed, false);
      assert.equal(result.keySent, false);
      assert.equal(result.reason, reason);
      assert.equal(keyRuns(commands).length, 0);
    });
  }
});

test('resume sends exactly one key to the matching paused session', async () => {
  await withFakePowerShell(fakeSessions('Paused|Spotify.exe'), async (media, commands) => {
    const result = await media.resumeAllMedia('Spotify.exe');
    assert.deepEqual(result, { resumed: true, keySent: true, reason: null });
    const runs = keyRuns(commands);
    assert.equal(runs.length, 1, 'one key run');
    const command = runs[0].args[runs[0].args.length - 1];
    assert.equal(command.split('SendKeys(').length - 1, 1, 'one key press');
    assert.equal(command, media.RESUME_PAUSED_MEDIA_COMMAND);
    // The id travels in the child's environment, never in the command text.
    assert.equal(runs[0].options.env[media.RESUME_APP_ENV], 'Spotify.exe');
    assert.ok(!command.includes('Spotify'), 'the app id is not spliced into PowerShell');
    assert.equal(commands.indexOf(runs[0]), 1, 'the read-only probe ran first');
    assert.ok(!commands[0].options.env, 'the probe needs no id');
  });
});

test('the key run re-checks Paused and the app id itself, so a change after the probe sends nothing', async () => {
  for (const [keyReply, reason] of [
    ['LO_MEDIA_RESUME|not-paused|Playing|Spotify.exe', 'not-paused'],
    ['LO_MEDIA_RESUME|other-app|Paused|msedge.exe', 'other-app'],
    ['LO_MEDIA_RESUME|none|', 'no-session']
  ]) {
    await withFakePowerShell(fakeSessions('Paused|Spotify.exe', keyReply), async (media) => {
      const result = await media.resumeAllMedia('Spotify.exe');
      assert.equal(result.resumed, false);
      assert.equal(result.keySent, false);
      assert.equal(result.reason, reason);
    });
  }
  // Key sent but Windows still says Paused: not claimed as resumed.
  await withFakePowerShell(fakeSessions('Paused|Spotify.exe', 'LO_MEDIA_RESUME|sent|Paused|Spotify.exe'), async (media) => {
    const result = await media.resumeAllMedia('Spotify.exe');
    assert.equal(result.resumed, false);
    assert.equal(result.keySent, true);
    assert.equal(result.reason, 'still-paused');
  });
  // An unreadable key run is reported as unknown, never as a resume.
  for (const keyReply of ['', 'LO_MEDIA_RESUME|unknown|', new Error('timed out')]) {
    await withFakePowerShell(fakeSessions('Paused|Spotify.exe', keyReply), async (media) => {
      const result = await media.resumeAllMedia('Spotify.exe');
      assert.equal(result.resumed, false);
      assert.equal(result.keySent, null);
      assert.equal(result.reason, 'unknown');
    });
  }

  const { RESUME_PAUSED_MEDIA_COMMAND: cmd, RESUME_APP_ENV, MEDIA_SESSION_STATE_COMMAND: probe } = require('../media');
  const key = cmd.indexOf('SendKeys([char]179)');
  const idGate = cmd.indexOf('if ($expected.Length -eq 0)');
  const pausedGate = cmd.indexOf("if ($status -cne 'Paused')");
  const appGate = cmd.indexOf('if ($app -cne $expected)');
  assert.ok(cmd.includes('GetCurrentSession()'), 'checks the session the key acts on');
  assert.ok(cmd.includes(`$expected = [string]$env:${RESUME_APP_ENV};`), 'reads the id from the environment');
  assert.ok(idGate > 0 && pausedGate > idGate && appGate > pausedGate && key > appGate, 'the key is behind all three gates in the same run');
  assert.equal(cmd.split('SendKeys(').length - 1, 1, 'exactly one key press');
  assert.ok(!cmd.includes('"') && !probe.includes('"'), 'no double quotes: the commands go through powershell -Command');
  assert.ok(!/SendKeys|WScript/.test(probe), 'the probe is read-only');
});
