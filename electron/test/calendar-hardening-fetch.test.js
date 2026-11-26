'use strict';
// Calendar provider fetches always settle (features-2) and an oversize ICS
// feed reports 'too-large' (features-5). Every request goes to a loopback
// server on 127.0.0.1: https.request is redirected to http.request there, so
// nothing leaves this machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const cp = require('../calendarProviders');
const cal = require('../calendar');

async function loopback(t, handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const saved = https.request;
  https.request = (options, onResponse) => http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', port, agent: false }, onResponse);
  t.after(async () => {
    https.request = saved;
    for (const s of sockets) s.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return port;
}

// Resolves with how the promise settled, or { settled: false } after ms.
function within(promise, ms) {
  let timer;
  return Promise.race([
    promise.then(value => ({ settled: true, value }), error => ({ settled: true, error })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ settled: false }), ms); })
  ]).finally(() => clearTimeout(timer));
}

function quietConsole(t) {
  const saved = console.error;
  console.error = () => {};
  t.after(() => { console.error = saved; });
}

// Headers and part of a declared body, then the server closes the socket.
function closesMidBody(close) {
  return (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
    res.write('{"items":[');
    setTimeout(() => close(res.socket), 30);
  };
}

for (const [name, close] of [
  ['graceful close (FIN)', s => s.end()],
  ['destroyed socket', s => s.destroy()],
  // A real reset (RST) already settled through req 'error'; kept so the
  // whole family of mid-body disconnects stays covered.
  ['connection reset (RST)', s => s.resetAndDestroy()]
]) {
  test(`Google fetch settles as 'network' when the peer ends mid-body: ${name}`, async t => {
    quietConsole(t);
    await loopback(t, closesMidBody(close));
    const statuses = [];
    const outcome = await within(cp.fetchGoogleEvents('fixture-key', 'me', new Date(), 1, 50, s => statuses.push(s)), 4000);
    assert.equal(outcome.settled, true, 'the fetch must settle instead of hanging (it would hold the auto-start poll forever)');
    assert.deepEqual(outcome.value, []);
    assert.deepEqual(statuses, [{ ok: false, reason: 'network' }]);
  });
}

test('Outlook and Calendly fetches also settle when the peer ends mid-body', async t => {
  quietConsole(t);
  await loopback(t, closesMidBody(s => s.end()));
  const outlook = await within(cp.fetchOutlookEvents('fixture-token', new Date(), 1, 50), 4000);
  const calendly = await within(cp.fetchCalendlyEvents('fixture-token', new Date(), 1), 4000);
  assert.equal(outlook.settled, true);
  assert.equal(calendly.settled, true);
});

test('fetchAllEvents (the auto-start poll) settles with the built-in rules when a provider drops mid-body', async t => {
  quietConsole(t);
  await loopback(t, closesMidBody(s => s.end()));
  const from = new Date(2099, 0, 5, 12, 0, 0);
  const outcome = await within(cp.fetchAllEvents({
    builtin: { rules: [{ id: 'r', label: 'Bedtime', time: '22:30', days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], action: 'sleep', enabled: true }] },
    google: { apiKey: 'fixture-key', calendarId: 'me' }
  }, from, 1), 4000);
  assert.equal(outcome.settled, true);
  assert.ok(outcome.value.some(e => e.source === 'builtin'));
});

test('a response that trickles bytes forever hits the overall deadline', async t => {
  await loopback(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100000' });
    const timer = setInterval(() => res.write(' '), 40); // never idle long enough for the socket timeout
    res.on('close', () => clearInterval(timer));
  });
  const started = Date.now();
  const outcome = await within(cp.fetchWithTimeout('https://www.googleapis.com/calendar/v3/x', 300, {}, 700), 3000);
  assert.equal(outcome.settled, true, 'the deadline must end a trickling response');
  assert.ok(outcome.error, 'it rejects');
  assert.equal(cp.fetchFailureReason(outcome.error), 'timeout');
  assert.ok(Date.now() - started < 2500);
});

test('a stalled response (headers, then nothing) times out', async t => {
  await loopback(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
    res.flushHeaders();
  });
  const outcome = await within(cp.fetchWithTimeout('https://www.googleapis.com/calendar/v3/x', 300, {}, 5000), 3000);
  assert.equal(outcome.settled, true);
  assert.equal(cp.fetchFailureReason(outcome.error), 'timeout');
});

test('the default deadline is twice the idle timeout and is cleared once the fetch settles', async t => {
  await loopback(t, (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"items":[]}'); });
  const savedSet = global.setTimeout, savedClear = global.clearTimeout;
  const armed = [], cleared = [];
  global.setTimeout = (fn, ms, ...rest) => { const h = savedSet(fn, ms, ...rest); armed.push({ h, ms }); return h; };
  global.clearTimeout = h => { cleared.push(h); return savedClear(h); };
  try {
    assert.equal(await cp.fetchWithTimeout('https://www.googleapis.com/x', 1234), '{"items":[]}');
  } finally {
    global.setTimeout = savedSet; global.clearTimeout = savedClear;
  }
  const deadline = armed.find(a => a.ms === 2468);
  assert.ok(deadline, 'a 2x deadline was armed');
  assert.ok(cleared.includes(deadline.h), 'and cleared on success (no timer leak on the 60 s poll)');
});

test('ICS feed: a trickling server hits the overall deadline and reports timeout', async t => {
  quietConsole(t);
  await loopback(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.write('BEGIN:VCALENDAR\r\n');
    const timer = setInterval(() => res.write('X-PAD:1\r\n'), 40);
    res.on('close', () => clearInterval(timer));
  });
  const outcome = await within(cal.importIcsFromUrl('https://feed.invalid/a.ics', 300, 700), 3000);
  assert.equal(outcome.settled, true, 'the ICS download must have a total deadline');
  assert.equal(cp.fetchFailureReason(outcome.error), 'timeout');
});

test('ICS feed: a server that closes mid-body settles as network', async t => {
  quietConsole(t);
  await loopback(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar', 'Content-Length': '5000' });
    res.write('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n');
    setTimeout(() => res.socket.end(), 30);
  });
  const statuses = [];
  const outcome = await within(cp.fetchIcsEvents('https://feed.invalid/a.ics', new Date(), 1, s => statuses.push(s)), 4000);
  assert.equal(outcome.settled, true);
  assert.deepEqual(outcome.value, []);
  assert.deepEqual(statuses, [{ ok: false, reason: 'network' }]);
});

test("an ICS feed over 5 MB reports 'too-large', not 'network'", async t => {
  quietConsole(t);
  await loopback(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.write('BEGIN:VCALENDAR\r\n');
    const line = Buffer.alloc(64 * 1024, 'X');
    let sent = 0;
    const pump = () => {
      while (sent < 6 * 1024 * 1024 && !res.destroyed) {
        sent += line.length;
        if (!res.write(line)) { res.once('drain', pump); return; }
      }
      if (!res.destroyed) res.end('END:VCALENDAR\r\n');
    };
    res.on('error', () => {});
    pump();
  });
  await cp.fetchAllEvents({ builtin: { rules: [] }, ical: { url: 'https://feed.invalid/big.ics' } }, new Date(), 14, { recordStatus: true });
  const status = cp.getLastFetchStatus();
  assert.equal(status.ical.ok, false);
  assert.equal(status.ical.reason, 'too-large');
});

test('fetchFailureReason maps both size-cap errors to too-large and keeps other mappings', () => {
  assert.equal(cp.fetchFailureReason(new Error('Calendar feed exceeds 5 MB limit')), 'too-large');
  assert.equal(cp.fetchFailureReason(new Error('Response too large')), 'too-large');
  assert.equal(cp.fetchFailureReason(Object.assign(new Error('x'), { code: 'CALENDAR_FEED_TOO_LARGE' })), 'too-large');
  assert.equal(cp.fetchFailureReason(new Error('HTTP 404: Failed to fetch calendar')), 'http-404');
  assert.equal(cp.fetchFailureReason(new Error('Request timeout')), 'timeout');
  assert.equal(cp.fetchFailureReason(new Error('aborted')), 'network');
});

// A UTF-8 character split across two TCP chunks must not be garbled.
const SPLIT_SUMMARY = 'Bedtime – Schlafenszeit ü';
function splitWrites(res, text) {
  const bytes = Buffer.from(text, 'utf8');
  const cut = bytes.indexOf(Buffer.from('ü', 'utf8')) + 1; // inside the 2-byte character
  res.socket.setNoDelay(true);
  res.write(bytes.subarray(0, cut));
  setTimeout(() => res.end(bytes.subarray(cut)), 60);
}

test('ICS feed: a multi-byte character split across chunks is decoded intact', async t => {
  await loopback(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
    splitWrites(res, `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:${SPLIT_SUMMARY}\r\nDTSTART:20991125T223000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  });
  const result = await cal.importIcsFromUrl('https://feed.invalid/a.ics');
  assert.equal(result.events[0].summary, SPLIT_SUMMARY);
});

test('Google fetch: a multi-byte character split across chunks is decoded intact', async t => {
  await loopback(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    splitWrites(res, JSON.stringify({ items: [{ id: 'g1', summary: SPLIT_SUMMARY, start: { dateTime: '2099-11-25T22:30:00Z' }, end: { dateTime: '2099-11-25T23:30:00Z' } }] }));
  });
  const [event] = await cp.fetchGoogleEvents('fixture-key', 'me', new Date(), 1);
  assert.equal(event.summary, SPLIT_SUMMARY);
});
