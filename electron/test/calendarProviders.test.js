// Tests for the pure provider-registry + built-in recurring-schedule logic in
// calendarProviders.js. getDefaultCalendarEvents drives the default "Bedtime"
// calendar, so its day filtering, bedtime parsing, and future-only / cutoff
// windowing need to be correct and deterministic.
//
// The network provider fetchers (Google/Outlook/Calendly/ICS) need live HTTP
// for real data; only their fetch-status recording (Fire 09) is covered here,
// with the network stubbed out.

const test = require('node:test');
const assert = require('node:assert');
const cp = require('../calendarProviders');

// Jan 1 2024 is a Monday. Anchor at local noon so 22:30 events that day still
// count as "future". All dates are constructed locally, so assertions are
// timezone-stable.
const MON_NOON = new Date(2024, 0, 1, 12, 0, 0);

test('getProviders returns all five providers; getProvider looks up by id', () => {
  const ids = cp.getProviders().map(p => p.id).sort();
  assert.deepStrictEqual(ids, ['builtin', 'calendly', 'google', 'ical', 'outlook']);
  assert.strictEqual(cp.getProvider('google').name, 'Google Calendar');
  assert.strictEqual(cp.getProvider('nope'), null);
});

test('getDefaultCalendarEvents emits Bedtime events with the right shape (legacy single-schedule shape)', () => {
  const events = cp.getDefaultCalendarEvents(
    { bedtime: '22:30', days: ['mon','tue','wed','thu','fri','sat','sun'], action: 'shutdown' },
    MON_NOON, 7,
  );
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.strictEqual(e.summary, 'Bedtime');
    assert.strictEqual(e.source, 'builtin');
    assert.strictEqual(e.action, 'shutdown');
    assert.strictEqual(e.start.getHours(), 22);
    assert.strictEqual(e.start.getMinutes(), 30);
    assert.strictEqual(e.end.getTime() - e.start.getTime(), 3600000); // +1h
    assert.ok(e.start > MON_NOON); // only future events
    assert.match(e.uid, /^lo-default-legacy-\d{4}-\d{2}-\d{2}$/);
  }
});

test('getDefaultCalendarEvents filters to the configured weekdays only', () => {
  const events = cp.getDefaultCalendarEvents({ bedtime: '22:00', days: ['mon'] }, MON_NOON, 21);
  assert.ok(events.length >= 2); // several Mondays in a 21-day window
  for (const e of events) assert.strictEqual(e.start.getDay(), 1); // Monday
});

test('getDefaultCalendarEvents parses a non-default bedtime and default action', () => {
  const [e] = cp.getDefaultCalendarEvents({ bedtime: '07:15', days: ['mon'] }, MON_NOON, 14);
  assert.strictEqual(e.start.getHours(), 7);
  assert.strictEqual(e.start.getMinutes(), 15);
  assert.strictEqual(e.action, 'shutdown'); // default when unspecified
});

test('getDefaultCalendarEvents falls back to all-week / 22:30 when schedule is empty', () => {
  const withDefaults = cp.getDefaultCalendarEvents({}, MON_NOON, 7);
  const distinctDays = new Set(withDefaults.map(e => e.start.getDay()));
  assert.ok(distinctDays.size >= 5); // spans most of the week
  assert.ok(withDefaults.every(e => e.start.getHours() === 22 && e.start.getMinutes() === 30));
});

test('getDefaultCalendarEvents returns nothing when no valid days are given', () => {
  assert.deepStrictEqual(cp.getDefaultCalendarEvents({ days: [] }, MON_NOON, 30), []);
  // Unrecognized day names are dropped, leaving no target days.
  assert.deepStrictEqual(cp.getDefaultCalendarEvents({ days: ['funday'] }, MON_NOON, 30), []);
});

test('getDefaultCalendarEvents honors the withinDays cutoff', () => {
  const shortWindow = cp.getDefaultCalendarEvents({ days: ['mon'] }, MON_NOON, 3);
  // Only the anchor Monday's 22:30 falls within 3 days.
  assert.strictEqual(shortWindow.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-rule scheduling: several independent "at this time, on these days, do
// this" rules, not just one global bedtime.
// ─────────────────────────────────────────────────────────────────────────────

test('getDefaultCalendarEvents emits events for every rule, each with its own label/time/action/duration', () => {
  const events = cp.getDefaultCalendarEvents({
    rules: [
      { id: 'weeknight', label: 'Weeknight', time: '22:00', days: ['mon','tue','wed','thu','fri'], action: 'shutdown', durationMinutes: 30, enabled: true },
      { id: 'weekend', label: 'Weekend', time: '23:30', days: ['fri','sat'], action: 'sleep', durationMinutes: 90, enabled: true }
    ]
  }, MON_NOON, 7);

  const weeknight = events.filter(e => e.summary === 'Weeknight');
  const weekend = events.filter(e => e.summary === 'Weekend');
  assert.ok(weeknight.length > 0);
  assert.ok(weekend.length > 0);
  for (const e of weeknight) {
    assert.strictEqual(e.action, 'shutdown');
    assert.strictEqual(e.start.getHours(), 22);
    assert.strictEqual(e.end.getTime() - e.start.getTime(), 30 * 60000);
    assert.match(e.uid, /^lo-default-weeknight-\d{4}-\d{2}-\d{2}$/);
  }
  for (const e of weekend) {
    assert.strictEqual(e.action, 'sleep');
    assert.strictEqual(e.start.getHours(), 23);
    assert.strictEqual(e.start.getMinutes(), 30);
    assert.strictEqual(e.end.getTime() - e.start.getTime(), 90 * 60000);
    assert.match(e.uid, /^lo-default-weekend-\d{4}-\d{2}-\d{2}$/);
  }
  // Friday is in both rules, so it must produce two distinct events (one per rule).
  const friday = events.filter(e => e.start.getDay() === 5);
  assert.strictEqual(friday.length, 2);
});

test('getDefaultCalendarEvents skips a disabled rule entirely', () => {
  const events = cp.getDefaultCalendarEvents({
    rules: [
      { id: 'a', label: 'A', time: '22:00', days: ['mon'], action: 'shutdown', enabled: true },
      { id: 'b', label: 'B', time: '23:00', days: ['mon'], action: 'sleep', enabled: false }
    ]
  }, MON_NOON, 7);
  assert.ok(events.every(e => e.summary === 'A'));
  assert.ok(events.length > 0);
});

test('getDefaultCalendarEvents returns nothing for an explicit empty rules array (user deleted every rule)', () => {
  assert.deepStrictEqual(cp.getDefaultCalendarEvents({ rules: [] }, MON_NOON, 30), []);
});

test('getDefaultCalendarEvents events are sorted chronologically across rules', () => {
  const events = cp.getDefaultCalendarEvents({
    rules: [
      { id: 'late', label: 'Late', time: '23:00', days: ['mon','tue'], action: 'shutdown', enabled: true },
      { id: 'early', label: 'Early', time: '08:00', days: ['mon','tue'], action: 'shutdown', enabled: true }
    ]
  }, MON_NOON, 3);
  const times = events.map(e => e.start.getTime());
  const sorted = [...times].sort((a, b) => a - b);
  assert.deepStrictEqual(times, sorted);
});

// ─────────────────────────────────────────────────────────────────────────────
// UI-R3 Fire 09: the last fetch status. Network calls are stubbed at the
// https.request / calendar.importIcsFromUrl seams (the same module objects
// calendarProviders uses), so nothing leaves this machine.
// ─────────────────────────────────────────────────────────────────────────────
const { EventEmitter } = require('node:events');
const https = require('node:https');
const icsParser = require('../calendar');

const SECRET_URL = 'https://calendar.example.test/private/s3cr3t-feed-token/basic.ics';
const SECRET_KEY = 'AIzaSECRETKEY123';
const SECRET_TOKEN = 'eyJSECRET.TOKEN.value';

async function withStubs(stubs, fn) {
  const saved = { request: https.request, importIcsFromUrl: icsParser.importIcsFromUrl, error: console.error };
  const logged = [];
  if (stubs.request) https.request = stubs.request;
  if (stubs.importIcsFromUrl) icsParser.importIcsFromUrl = stubs.importIcsFromUrl;
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  try {
    return await fn(logged);
  } finally {
    https.request = saved.request;
    icsParser.importIcsFromUrl = saved.importIcsFromUrl;
    console.error = saved.error;
  }
}

// A request that fails with an Error whose message carries the URL, key and token.
function failingRequest(opts) {
  const req = new EventEmitter();
  req.end = () => process.nextTick(() => req.emit('error', new Error(`connect ECONNREFUSED ${SECRET_URL}?key=${SECRET_KEY} ${SECRET_TOKEN} ${opts && opts.path}`)));
  req.destroy = () => {};
  return req;
}

// A 200 response with a JSON body.
function jsonRequest(body) {
  return (opts, onResponse) => {
    const req = new EventEmitter();
    req.end = () => process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.resume = () => {};
      onResponse(res);
      res.emit('data', Buffer.from(JSON.stringify(body)));
      res.emit('end');
    });
    req.destroy = () => {};
    return req;
  };
}

const ALLOWED_REASON = /^(timeout|http-\d{3}|too-large|not-https|parse|unexpected-response|network)$/;

test('fetch status (Fire 09): a failing feed records an allowlisted reason and never the URL, key or token', async () => {
  await withStubs({
    request: failingRequest,
    importIcsFromUrl: async () => { throw new Error(`HTTP 404: Failed to fetch ${SECRET_URL}`); }
  }, async logged => {
    const events = await cp.fetchAllEvents({
      builtin: { rules: [] },
      ical: { url: SECRET_URL },
      google: { apiKey: SECRET_KEY, calendarId: 'me@example.test' },
      outlook: { accessToken: SECRET_TOKEN },
      calendly: { personalToken: SECRET_TOKEN }
    }, MON_NOON, 14, { recordStatus: true });
    assert.deepStrictEqual(events, []);
    const status = cp.getLastFetchStatus();
    const json = JSON.stringify(status);
    for (const secret of [SECRET_URL, SECRET_KEY, SECRET_TOKEN, 's3cr3t', 'example.test']) {
      assert.ok(!json.includes(secret), `status must not carry ${secret}`);
      assert.ok(!logged.join('\n').includes(secret), `console lines must not carry ${secret}`);
    }
    assert.deepStrictEqual(Object.keys(status).sort(), ['calendly', 'google', 'ical', 'outlook']);
    assert.strictEqual(status.ical.reason, 'http-404');
    for (const p of ['google', 'outlook', 'calendly']) assert.strictEqual(status[p].reason, 'network');
    for (const s of Object.values(status)) {
      assert.strictEqual(s.ok, false);
      assert.match(s.reason, ALLOWED_REASON);
      assert.ok(Number.isFinite(s.at));
      assert.deepStrictEqual(Object.keys(s).sort(), ['at', 'ok', 'reason']);
    }
  });
});

test('fetch status (Fire 09): a non-throwing missing-items answer records unexpected-response, never ok', async () => {
  await withStubs({ request: jsonRequest({ error: { code: 400 } }) }, async () => {
    await cp.fetchAllEvents({ builtin: { rules: [] }, google: { apiKey: 'k', calendarId: 'c' } }, MON_NOON, 14, { recordStatus: true });
    const status = cp.getLastFetchStatus();
    assert.deepStrictEqual(Object.keys(status), ['google']);
    assert.strictEqual(status.google.ok, false);
    assert.strictEqual(status.google.reason, 'unexpected-response');
  });
  await withStubs({ request: jsonRequest({ resource: {} }) }, async () => {
    await cp.fetchAllEvents({ builtin: { rules: [] }, calendly: { personalToken: 't' } }, MON_NOON, 14, { recordStatus: true });
    assert.strictEqual(cp.getLastFetchStatus().calendly.reason, 'unexpected-response');
  });
});

test('fetch status (Fire 09): reached feeds record ok; unconfigured providers record nothing', async () => {
  await withStubs({
    request: jsonRequest({ items: [] }),
    importIcsFromUrl: async () => ({ events: [] })
  }, async () => {
    await cp.fetchAllEvents({ builtin: { rules: [] }, ical: { url: 'https://x.test/a.ics' }, google: { apiKey: 'k', calendarId: '' }, outlook: { accessToken: '' } }, MON_NOON, 14, { recordStatus: true });
    const status = cp.getLastFetchStatus();
    assert.deepStrictEqual(Object.keys(status), ['ical'], 'Google without a calendar ID and an empty Outlook token record nothing');
    assert.deepStrictEqual(Object.keys(status.ical).sort(), ['at', 'ok']);
    assert.strictEqual(status.ical.ok, true);
    // A deep copy: mutating it never changes the record.
    status.ical.ok = false;
    assert.strictEqual(cp.getLastFetchStatus().ical.ok, true);
  });
});

test('fetch status (Fire 09): a 1-day background fetch records nothing and leaves the last status alone', async () => {
  await withStubs({ importIcsFromUrl: async () => ({ events: [] }) }, async () => {
    await cp.fetchAllEvents({ builtin: { rules: [] }, ical: { url: 'https://x.test/a.ics' } }, MON_NOON, 14, { recordStatus: true });
  });
  const before = JSON.stringify(cp.getLastFetchStatus());
  await withStubs({ importIcsFromUrl: async () => { throw new Error('Request timeout'); } }, async () => {
    await cp.fetchAllEvents({ builtin: { rules: [] }, ical: { url: 'https://x.test/a.ics' } }, MON_NOON, 1);
    await cp.fetchEvents({ builtin: { rules: [] }, ical: { url: 'https://x.test/a.ics' } }, 1, MON_NOON);
  });
  assert.strictEqual(JSON.stringify(cp.getLastFetchStatus()), before);
  // A new recorded run starts empty: a provider removed since is not kept.
  await cp.fetchAllEvents({ builtin: { rules: [] } }, MON_NOON, 14, { recordStatus: true });
  assert.deepStrictEqual(cp.getLastFetchStatus(), {});
});
