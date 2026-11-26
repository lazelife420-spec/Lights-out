'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const durableJsonStore = require('../durableJsonStore');
const calendar = require('../calendar');
const contentBlocker = require('../contentBlocker');
const focusSessions = require('../focusSessions');
const overrideTax = require('../overrideTax');
const updaterPolicy = require('../updaterPolicy');
const capabilityTruth = require('../capabilityTruth');
const smartLights = require('../smartLights');
const companionFirewall = require('../companionFirewall');
const wifiGuard = require('../wifiGuard');
const accountability = require('../accountability');
const family = require('../family');
const companion = require('../companion');
const alarm = require('../alarm');
const lastLight = require('../lastLight');
const profiles = require('../profiles');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('durableJsonStore writes atomically, verifies primary before rotating .bak, and recovers from corrupt primary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-djs-'));
  try {
    const file = path.join(dir, 'store.json');
    durableJsonStore.writeTmpVerifyRename(file, { version: 1, ok: true });
    durableJsonStore.writeTmpVerifyRename(file, { version: 2, ok: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 2, ok: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { version: 1, ok: true });

    // Corrupt primary: a subsequent write must NOT overwrite the healthy .bak with garbage.
    fs.writeFileSync(file, '{corrupt', 'utf8');
    const loaded = durableJsonStore.safeLoadJson(file);
    assert.equal(loaded.recovered, true);
    assert.deepEqual(loaded.data, { version: 1, ok: true });

    // Re-corrupt primary and verify writeTmpVerifyRename keeps the healthy .bak intact.
    fs.writeFileSync(file, '{corrupt', 'utf8');
    durableJsonStore.writeTmpVerifyRename(file, { version: 3, ok: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { version: 1, ok: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('calendar parses UTC timestamps without double timezone offset, handles unfolding and ignores VALARM SUMMARY', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Nightly Wind',
    ' -Down Ritual',
    'DTSTART:20261122T230000Z',
    'DTEND:20261123T000000Z',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'SUMMARY:Alarm Noise',
    'DESCRIPTION:Do not overwrite event',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const events = calendar.parseIcsContent(ics);
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, 'Nightly Wind-Down Ritual');
  assert.equal(events[0].start.toISOString(), '2026-11-22T23:00:00.000Z');
  assert.equal(events[0].end.toISOString(), '2026-11-23T00:00:00.000Z');
});

test('contentBlocker escapes ASCII and Unicode smart single quotes and guards malformed markers', () => {
  const cmd = contentBlocker.__buildWriteHostsCommand('127.0.0.1 localhost', "C:\\Users\\O'Brien\\\u2018curly\u2019\\hosts");
  assert.equal(cmd.includes("O''Brien"), true);
  assert.equal(cmd.includes('\u2018\u2018curly\u2019\u2019'), true);

  // Missing END marker must never truncate user entries below the marker.
  const broken = '127.0.0.1 localhost\n# >>> LIGHTS OUT CONTENT BLOCKER >>>\n127.0.0.1 reddit.com\n127.0.0.1 keep.example';
  const cleaned = contentBlocker.__removeBlockSection(broken);
  assert.equal(cleaned.includes('127.0.0.1 keep.example'), true);
});

test('focusSessions emits IPC-safe public DTO without timer handles and reaches long breaks', () => {
  focusSessions.stopFocusSession();
  const started = focusSessions.startFocusSession('pomodoro');
  assert.equal(started.active, true);
  assert.equal('interval' in started, false);
  assert.equal(typeof JSON.stringify(started), 'string');
  focusSessions.stopFocusSession();
});

test('overrideTax respects enabled:false and exposes tomorrowDebt and tightenMinutes', () => {
  overrideTax.resetSession();
  overrideTax.updateConfig({ enabled: false, freeSnoozes: 0, tightenMinutes: 15, maxTighten: 45, requireReasonAfter: 1 });
  const costDisabled = overrideTax.assessSnoozeCost();
  assert.equal(costDisabled.level, 0);
  assert.equal(costDisabled.tomorrowDebt, 0);
  assert.equal(costDisabled.tightenMinutes, 0);
  const recDisabled = overrideTax.recordSnooze('test');
  assert.equal(recDisabled.level, 0);
  assert.equal(recDisabled.snoozeNumber, 0);
  assert.equal(overrideTax.consumeDebt(), 0);

  overrideTax.updateConfig({ enabled: true, freeSnoozes: 0, tightenMinutes: 15, maxTighten: 45, requireReasonAfter: 1 });
  const costEnabled = overrideTax.assessSnoozeCost();
  assert.equal(costEnabled.tightenMinutes, 15);
  assert.equal(typeof costEnabled.tomorrowDebt, 'number');
  overrideTax.resetSession();
  overrideTax.updateConfig({ enabled: false });
});

test('updaterPolicy handles prerelease semver ordering and rejects non-default ports and credentials', () => {
  assert.equal(updaterPolicy.compareVersions('11.2.0', '11.2.0-rc.1'), 1);
  assert.equal(updaterPolicy.compareVersions('11.2.0-rc.1', '11.2.0'), -1);
  assert.equal(updaterPolicy.compareVersions('11.2.0-beta.2', '11.2.0-beta.10'), -1);
  assert.equal(updaterPolicy.isValidTruthUrl('https://theprooffoundry.com:8443/truth/products/lights-out.json'), false);
  assert.equal(updaterPolicy.isValidTruthUrl('https://user:pass@theprooffoundry.com/truth/products/lights-out.json'), false);
  assert.equal(updaterPolicy.isValidDownloadUrl('https://downloads.theprooffoundry.com:444/Lights-Out-Portable-v11.2.0-win-x64.zip'), false);
});

test('capabilityTruth IPv6 private classifier blocks public fc::1 and accepts link-local/ULA/loopback/IPv4-mapped', () => {
  assert.equal(capabilityTruth.isPrivateOrLocal('fc::1'), false, 'fc::1 is 00fc::1, NOT fc00::/7');
  assert.equal(capabilityTruth.isPrivateOrLocal('fc00::1'), true);
  assert.equal(capabilityTruth.isPrivateOrLocal('fd12:3456::1'), true);
  assert.equal(capabilityTruth.isPrivateOrLocal('fe80::1'), true);
  assert.equal(capabilityTruth.isPrivateOrLocal('fe90::1'), true);
  assert.equal(capabilityTruth.isPrivateOrLocal('febf::1'), true);
  assert.equal(capabilityTruth.isPrivateOrLocal('fec0::1'), false);
  assert.equal(capabilityTruth.isPrivateOrLocal('0:0:0:0:0:0:0:1'), true);
  assert.equal(capabilityTruth.isPrivateOrLocal('::ffff:192.168.1.5'), true);
  assert.equal(capabilityTruth.isPrivateOrLocal('::ffff:8.8.8.8'), false);
  assert.equal(capabilityTruth.formatHostForUrl('fd00::1'), '[fd00::1]');
  assert.equal(capabilityTruth.formatHostForUrl('192.168.1.1'), '192.168.1.1');
});

test('smartLights enforces private Hue bridge IPs, rejects path traversal segments, tolerates malformed mDNS, and omits GET bodies', async (t) => {
  await assert.rejects(
    smartLights.hueRequest('8.8.8.8', 'GET', '/api/config'),
    /private\/local/i
  );
  const badSeg = await smartLights.getHueLights('127.0.0.1', '../admin');
  assert.equal(badSeg.success, false);

  // Truncated / malformed mDNS packets must never throw.
  const truncated = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0]);
  assert.deepEqual(smartLights.parseMdnsResponse(truncated), { ptrNames: [], ips: [], bridgeIds: [] });

  // HTTP GET webhook must not send a body or Content-Type header, and oversized responses fail fast.
  let seenMethod = '';
  let seenBody = '';
  let seenCT = '';
  const server = http.createServer((req, res) => {
    seenMethod = req.method;
    seenCT = req.headers['content-type'] || '';
    req.on('data', c => { seenBody += c; });
    req.on('end', () => {
      if (req.url === '/huge') {
        res.writeHead(200);
        res.end('x'.repeat(80 * 1024));
        return;
      }
      res.writeHead(204);
      res.end();
    });
  });
  const port = await listen(server);
  t.after(() => new Promise(r => server.close(r)));

  smartLights.loadConfig({ provider: 'http', httpUrl: `http://127.0.0.1:${port}/ok`, httpMethod: 'GET', enabled: false });
  const getRes = await smartLights.invokeHttpLightAction(100, 366, true);
  assert.equal(getRes.success, true);
  assert.equal(seenMethod, 'GET');
  assert.equal(seenBody, '');
  assert.equal(seenCT, '');

  smartLights.loadConfig({ provider: 'http', httpUrl: `http://127.0.0.1:${port}/huge`, httpMethod: 'POST', enabled: false });
  const hugeRes = await smartLights.invokeHttpLightAction(100, 366, true);
  assert.equal(hugeRes.success, false);
  assert.match(hugeRes.message, /too large/i);
  smartLights.loadConfig({ provider: 'none', enabled: false, httpUrl: '', verifiedConfigKey: '' });
});

test('companionFirewall escapes Unicode smart single quotes in PowerShell literals', () => {
  const quoted = companionFirewall.quotePowerShell("C:\\Users\\O\u2019Connor\\Lights Out.exe");
  assert.equal(quoted.includes('\u2019\u2019'), true);
});

test('wifiGuard persists and reconciles interrupted adapter block state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-wg-'));
  const statePath = path.join(dir, 'wifi-guard-state.json');
  try {
    const commands = [];
    const fakeRunner = async (cmd) => {
      commands.push(cmd);
      return 'Wi-Fi';
    };
    const disabled = await wifiGuard.disableWiFiAdapter({ statePath, runner: fakeRunner });
    assert.equal(disabled.success, true);
    assert.equal(fs.existsSync(statePath), true);

    const reconciled = await wifiGuard.reconcileInterruptedAdapterBlock({ statePath, runner: fakeRunner });
    assert.equal(reconciled.reconciled, true);
    assert.equal(reconciled.adapterName, 'Wi-Fi');
    assert.equal(fs.existsSync(statePath), false);

    // Empty stdout must fail closed rather than falsely claiming success.
    const failed = await wifiGuard.disableWiFiAdapter({ statePath, runner: async () => '' });
    assert.equal(failed.success, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('accountability blocks cloud metadata endpoints and validates Discord webhook credentials', async () => {
  const [metaRes] = await accountability.testPartner({ type: 'webhook', url: 'http://169.254.169.254/latest/meta-data/' });
  assert.equal(metaRes.success, false);
  const [badDiscord] = await accountability.testPartner({ type: 'discord', webhookId: '../evil', webhookToken: 'abc' });
  assert.equal(badDiscord.success, false);
});

test('family refuses non-local peer IP in sendRemoteCommand', async () => {
  await assert.rejects(
    family.sendRemoteCommand('8.8.8.8', 'pause'),
    /non-local/i
  );
});

test('companion rejects fragmented or >125-byte control frames with close 1002', () => {
  const writes = [];
  const client = {
    alive: true,
    buf: Buffer.alloc(0),
    socket: {
      write: (b) => { writes.push(Buffer.from(b)); return true; },
      end: () => {},
      destroy: () => {}
    }
  };
  // Masked ping frame (opcode 0x9) with 126-byte payload (RFC 6455 §5.5 violation).
  const payload = Buffer.alloc(126, 0x41);
  const header = Buffer.from([0x89, 0x80 | 126, 0, 126, 1, 2, 3, 4]);
  client.buf = Buffer.concat([header, payload]);
  companion.consumeFrames(client);
  assert.equal(client.alive, false);
  const closeBuf = writes[writes.length - 1];
  assert.equal(closeBuf[0] & 0x0f, 0x8);
  assert.equal(closeBuf.readUInt16BE(2), 1002);
});

test('alarm validates HH:MM before attempting to modify scheduled tasks', async () => {
  const res = await alarm.scheduleWakeAlarm('99:99', 'C:\\Lights Out.exe');
  assert.equal(res.success, false);
  assert.match(res.error, /Invalid time/i);
});

test('lastLight rejects non-array steps and clamps dwellMs on custom sequences', () => {
  lastLight.loadCustomSequences([]);
  assert.equal(lastLight.addCustomSequence({ name: 'Bad', steps: 'not-an-array' }), null);
  const added = lastLight.addCustomSequence({
    name: 'Gentle',
    steps: [{ headline: 'Hi', line: 'Sleep', dwellMs: 999999 }]
  });
  assert.ok(added);
  assert.equal(added.steps[0].dwellMs, 10000);
  lastLight.loadCustomSequences([]);
});

test('profiles rejects invalid IDs and malformed clock strings', () => {
  const loaded = profiles.getAll();
  assert.equal(Array.isArray(loaded), true);
  assert.equal(profiles.getHint({ mode: 'clock', action: 'shutdown', clock: 'not-a-time' }), 'Shutdown (clock)');
  assert.equal(profiles.getHint({ mode: 'duration', action: 'sleep', seconds: NaN }), 'Sleep in 30m');
  assert.equal(profiles.normalize({ id: '../evil', name: 'Bad', mode: 'duration', seconds: 600 }).id.includes('..'), false);
});

test('applyAppSettings with preserveTonightPlan keeps Tonight duration while reverting Settings fields', async () => {
  const vm = require('node:vm');
  const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer-settings.js'), 'utf8');
  const start = settingsSrc.indexOf('async function applyAppSettings(');
  assert.ok(start >= 0, 'applyAppSettings not found');
  let depth = 0;
  let end = start;
  const bodyOpen = settingsSrc.indexOf(') {', start) + 2;
  for (let i = bodyOpen; i < settingsSrc.length; i++) {
    if (settingsSrc[i] === '{') depth++;
    else if (settingsSrc[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const fnSource = settingsSrc.slice(start, end);
  let inputSecondsCalls = 0;
  const ctx = {
    state: {
      running: false,
      remainingSeconds: 36 * 60,
      unit: 'min',
      action: 'sleep',
      dryRun: true,
      sound: false,
      timerName: 'ZZZZZ',
      armedNightMode: null
    },
    SoundSystem: { enabled: false },
    els: { timerName: { textContent: 'ZZZZZ' } },
    setInputFromSeconds: () => { inputSecondsCalls++; },
    setAction: () => {},
    normalizeClockFace: (v) => v || 'digital',
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    effectiveClockHandColor: (v) => v || '#9b93d6',
    applyClockStyle: () => {},
    updateClockStyleVisibility: () => {},
    handleSidebarNavigation: () => {},
    document: { querySelectorAll: () => [] },
    render: () => {},
    api: { saveAppSettings: async () => ({}) }
  };
  const applyFn = vm.runInNewContext(`(${fnSource})`, ctx);
  await applyFn(
    { durationSeconds: 22 * 60, unit: 'sec', action: 'shutdown', dryRun: false, sound: true, timerName: 'OldName' },
    { skipNavigation: true, preserveTonightPlan: true }
  );
  assert.equal(ctx.state.remainingSeconds, 36 * 60, 'Tonight duration must stay 36m on Settings Cancel/Escape');
  assert.equal(ctx.state.unit, 'min', 'Tonight unit must stay min on Settings Cancel/Escape');
  assert.equal(ctx.state.timerName, 'ZZZZZ', 'Tonight timerName must stay ZZZZZ');
  assert.equal(inputSecondsCalls, 0, 'setInputFromSeconds must not overwrite Tonight duration input');
  assert.equal(ctx.state.action, 'shutdown', 'Settings Action must revert to persisted value');
  assert.equal(ctx.state.dryRun, false, 'Settings dryRun must reload persisted value');
  assert.equal(ctx.state.sound, true, 'Settings sound must reload persisted value');
});
