'use strict';
// ICS TZID handling (features-4). A DTSTART;TZID=<zone> value is a wall time in
// that zone. Every assertion here is an exact UTC instant, so the tests hold on
// any host zone; two different zones are used so at least one of them differs
// from this PC's zone and the old host-local reading would fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const cal = require('../calendar');
const cp = require('../calendarProviders');

const one = (dtstart, extra = []) => {
  const events = cal.parseIcsContent(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:u1', 'SUMMARY:Bedtime', dtstart, ...extra, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  assert.equal(events.length, 1);
  return events[0];
};
const iso = d => d.toISOString();

test('an IANA TZID is converted to its real instant, independent of the PC zone', () => {
  const la = one('DTSTART;TZID=America/Los_Angeles:20261125T223000', ['DTEND;TZID=America/Los_Angeles:20261125T233000']);
  assert.equal(iso(la.start), '2026-11-26T06:30:00.000Z'); // PST, UTC-8
  assert.equal(iso(la.end), '2026-11-26T07:30:00.000Z');
  assert.equal(la.timeZoneUnresolved, undefined, 'a resolved zone is not flagged');
  const tokyo = one('DTSTART;TZID=Asia/Tokyo:20261125T223000');
  assert.equal(iso(tokyo.start), '2026-11-25T13:30:00.000Z'); // JST, UTC+9
  const kolkata = one('DTSTART;TZID=Asia/Kolkata:2026-07-01T22:00:00');
  assert.equal(iso(kolkata.start), '2026-07-01T16:30:00.000Z'); // hyphenated form, UTC+5:30
});

test('Windows zone names from Outlook/Exchange map to IANA, quoted or not', () => {
  assert.equal(iso(one('DTSTART;TZID="Pacific Standard Time":20261125T223000').start), '2026-11-26T06:30:00.000Z');
  assert.equal(iso(one('DTSTART;TZID=W. Europe Standard Time:20260701T220000').start), '2026-07-01T20:00:00.000Z'); // CEST
  assert.equal(iso(one('DTSTART;TZID=Tokyo Standard Time:20261125T223000').start), '2026-11-25T13:30:00.000Z');
  assert.equal(iso(one('DTSTART;tzid="eastern standard time":20260115T220000').start), '2026-01-16T03:00:00.000Z'); // case-insensitive
});

test('path-prefixed TZIDs resolve to their IANA suffix', () => {
  assert.equal(iso(one('DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20260115T220000').start), '2026-01-16T03:00:00.000Z');
  assert.equal(iso(one('DTSTART;TZID=/freeassociation.sourceforge.net/Tzfile/Europe/London:20260701T220000').start), '2026-07-01T21:00:00.000Z');
});

test('DST gaps and overlaps follow RFC 5545 deterministically', () => {
  // New York spring forward 2026-03-08 02:00 -> 03:00: 02:30 does not exist and
  // is read with the offset before the gap (EST), i.e. 03:30 EDT.
  assert.equal(iso(one('DTSTART;TZID=America/New_York:20260308T023000').start), '2026-03-08T07:30:00.000Z');
  // New York fall back 2026-11-01: 01:30 happens twice; the first (EDT) wins.
  assert.equal(iso(one('DTSTART;TZID=America/New_York:20261101T013000').start), '2026-11-01T05:30:00.000Z');
  // Berlin: gap 2026-03-29 02:30 -> 03:30 CEST; overlap 2026-10-25 02:30 -> first (CEST).
  assert.equal(iso(one('DTSTART;TZID=Europe/Berlin:20260329T023000').start), '2026-03-29T01:30:00.000Z');
  assert.equal(iso(one('DTSTART;TZID=Europe/Berlin:20261025T023000').start), '2026-10-25T00:30:00.000Z');
  // Just outside the transitions nothing shifts.
  assert.equal(iso(one('DTSTART;TZID=America/New_York:20260308T013000').start), '2026-03-08T06:30:00.000Z');
  assert.equal(iso(one('DTSTART;TZID=America/New_York:20260308T030000').start), '2026-03-08T07:00:00.000Z');
  // The same wall time always gives the same instant.
  assert.equal(iso(one('DTSTART;TZID=America/New_York:20261101T013000').start), '2026-11-01T05:30:00.000Z');
});

test('UTC (Z) values ignore TZID and floating values stay on this PC wall clock', () => {
  const utc = one('DTSTART;TZID=America/Los_Angeles:20261125T223000Z');
  assert.equal(iso(utc.start), '2026-11-25T22:30:00.000Z');
  assert.equal(utc.timeZoneUnresolved, undefined);
  const floating = one('DTSTART:20261125T223000');
  assert.equal(floating.start.getTime(), new Date(2026, 10, 25, 22, 30, 0).getTime());
  assert.equal(floating.timeZoneUnresolved, undefined);
  const allDay = one('DTSTART;VALUE=DATE;TZID=Asia/Tokyo:20261125');
  assert.equal(allDay.start.getTime(), new Date(2026, 10, 25).getTime(), 'a date-only value stays local midnight');
});

test('an unresolvable TZID keeps the event listed at this PC wall time but marks it untrusted for auto-start', () => {
  for (const line of [
    'DTSTART;TZID=Customized Time Zone:20261125T223000',
    'DTSTART;TZID="Customized Time Zone":20261125T223000',
    // A quoted parameter containing ':' (used to break parsing and drop the event).
    'DTSTART;TZID="(UTC-08:00) Pacific Time (US & Canada)":20261125T223000',
    'DTSTART;TZID=Mars/Olympus_Mons:20261125T223000'
  ]) {
    const event = one(line);
    assert.equal(event.start.getTime(), new Date(2026, 10, 25, 22, 30, 0).getTime(), line);
    assert.equal(event.timeZoneUnresolved, true, line);
    assert.equal(cp.eventTimeIsTrusted(event), false, line);
  }
  // DTEND alone with an unknown zone also makes the event untrusted.
  const endOnly = one('DTSTART:20261125T223000Z', ['DTEND;TZID=Nowhere/Land:20261125T233000']);
  assert.equal(endOnly.timeZoneUnresolved, true);
});

// ICU accepts legacy three-letter ids (BST -> Asia/Dhaka, IST -> Asia/Calcutta,
// AST -> America/Anchorage, NST -> Pacific/Auckland, EST -> America/Panama).
// In a feed they usually mean something else, so they must stay unresolved.
const AMBIGUOUS_TZIDS = ['BST', 'IST', 'AST', 'NST', 'CST', 'EST', 'PST', 'MST', 'HST', 'SST', 'ART', 'ECT', 'CET', 'EET',
  'bst', 'Custom/BST', '/Custom/IST', 'Custom//AST', '/BST', 'BST/'];

test('bare time-zone abbreviations (BST, IST, AST, NST, CST, EST, ...) and Custom/BST stay unresolved and untrusted', () => {
  for (const tzid of AMBIGUOUS_TZIDS) {
    assert.equal(cal.resolveIcsTimeZone(tzid), null, tzid);
    const event = one(`DTSTART;TZID=${tzid}:20260701T223000`);
    assert.equal(event.start.getTime(), new Date(2026, 6, 1, 22, 30, 0).getTime(), `${tzid} is listed at this PC wall time`);
    assert.equal(event.timeZoneUnresolved, true, tzid);
    assert.equal(cp.eventTimeIsTrusted(event), false, tzid);
  }
});

test('Area/Location ids, Etc/*, the unambiguous single-segment allowlist and tzone://Microsoft/Utc still resolve', () => {
  const resolved = {
    'America/New_York': '2026-07-02T02:30:00.000Z', 'Etc/GMT+5': '2026-07-02T03:30:00.000Z', 'Etc/UTC': '2026-07-01T22:30:00.000Z',
    'tzone://Microsoft/Utc': '2026-07-01T22:30:00.000Z', 'Foo/UTC': '2026-07-01T22:30:00.000Z',
    UTC: '2026-07-01T22:30:00.000Z', GMT: '2026-07-01T22:30:00.000Z', UCT: '2026-07-01T22:30:00.000Z', Zulu: '2026-07-01T22:30:00.000Z',
    Universal: '2026-07-01T22:30:00.000Z', Greenwich: '2026-07-01T22:30:00.000Z', utc: '2026-07-01T22:30:00.000Z',
    EST5EDT: '2026-07-02T02:30:00.000Z', CST6CDT: '2026-07-02T03:30:00.000Z', MST7MDT: '2026-07-02T04:30:00.000Z', PST8PDT: '2026-07-02T05:30:00.000Z',
    // Mapped Windows names (Outlook/Exchange) are unaffected by the rule.
    'Pacific Standard Time': '2026-07-02T05:30:00.000Z', 'GMT Standard Time': '2026-07-01T21:30:00.000Z', 'India Standard Time': '2026-07-01T17:00:00.000Z',
    '/mozilla.org/20050126_1/America/New_York': '2026-07-02T02:30:00.000Z'
  };
  for (const [tzid, instant] of Object.entries(resolved)) {
    assert.ok(cal.resolveIcsTimeZone(tzid), tzid);
    // RFC 5545: a parameter value containing ':' is quoted.
    const event = one(`DTSTART;TZID=${tzid.includes(':') ? `"${tzid}"` : tzid}:20260701T223000`);
    assert.equal(iso(event.start), instant, tzid);
    assert.equal(event.timeZoneUnresolved, undefined, tzid);
    assert.equal(cp.eventTimeIsTrusted(event), true, tzid);
  }
});

test('trusted events: resolved TZID, UTC, floating and built-in rules', () => {
  assert.equal(cp.eventTimeIsTrusted(one('DTSTART;TZID=Europe/Paris:20261125T223000')), true);
  assert.equal(cp.eventTimeIsTrusted(one('DTSTART:20261125T223000Z')), true);
  assert.equal(cp.eventTimeIsTrusted(one('DTSTART:20261125T223000')), true);
  const [builtin] = cp.getDefaultCalendarEvents({ rules: [{ id: 'r', time: '22:30', days: ['mon'], enabled: true }] }, new Date(2026, 10, 1), 14);
  assert.equal(cp.eventTimeIsTrusted(builtin), true);
  assert.equal(cp.eventTimeIsTrusted(null), false);
});

test('the untrusted flag survives the ICS provider into fetchAllEvents (what main.js auto-start reads)', async () => {
  const saved = cal.importIcsFromUrl;
  cal.importIcsFromUrl = async () => ({ events: cal.parseIcsContent(['BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Bedtime', 'DTSTART;TZID=Customized Time Zone:20991125T223000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Bedtime', 'DTSTART;TZID=Pacific Standard Time:20991126T223000', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n')) });
  try {
    const events = await cp.fetchAllEvents({ builtin: { rules: [] }, ical: { url: 'https://feed.invalid/a.ics' } }, new Date(2099, 10, 20), 14);
    const byUid = Object.fromEntries(events.map(e => [e.uid, e]));
    assert.equal(cp.eventTimeIsTrusted(byUid.a), false);
    assert.equal(cp.eventTimeIsTrusted(byUid.b), true);
    assert.equal(iso(byUid.b.start), '2099-11-27T06:30:00.000Z');
  } finally {
    cal.importIcsFromUrl = saved;
  }
});

// The auto-start side lives in main.js checkCalendarAutoStart, which must skip
// an event whose instant is not trusted. Same vm extraction as
// calendar-scheduling.test.js. Unconditional: the safety half of features-4.
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const checkSource = (mainSource.match(/async function checkCalendarAutoStart\(\) \{[\s\S]*?\n\}/) || [''])[0];

async function autoStartRun(event) {
  const now = Date.UTC(2026, 10, 26, 6, 30);
  const clock = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const calendar = { enabled: true, autoStartFromEvents: true };
  const starts = [];
  const context = { Date: clock, Set, Boolean, Math, calendarAutoStartBusy: false, calendarStartedOccurrences: new Set(),
    calendarCheckedThrough: null, CALENDAR_START_MAX_LATENESS_MS: 5 * 60 * 1000,
    settingsStore: { getSection: name => name === 'calendar' ? calendar : { dryRun: true }, updateSection: (name, patch) => Object.assign(calendar, patch) },
    isRunActive: () => false, isBedtimeEvent: e => /bedtime/i.test(e.summary || ''), getEventTitle: e => e.summary,
    calProviders: { fetchAllEvents: async () => [{ ...event, start: new Date(now - 20000), end: new Date(now + 900000) }], eventTimeIsTrusted: cp.eventTimeIsTrusted },
    profiles: { getById: () => null }, startTimer: input => { starts.push(input); return { success: true }; }, showNativeNotification: () => {} };
  vm.createContext(context);
  vm.runInContext(checkSource + ';globalThis.checkCalendar=checkCalendarAutoStart;', context);
  await context.checkCalendar();
  return starts;
}

test('calendar auto-start never fires an imported event whose TZID could not be resolved', async () => {
  assert.ok(checkSource, 'checkCalendarAutoStart was found in main.js');
  assert.match(checkSource, /calProviders\.eventTimeIsTrusted\(event\)/);
  const untrusted = one('DTSTART;TZID=Customized Time Zone:20261125T223000');
  assert.equal((await autoStartRun({ ...untrusted, uid: 'u', source: 'ical' })).length, 0, 'an unknown-zone event stays listed only');
  const abbreviated = one('DTSTART;TZID=BST:20261125T223000');
  assert.equal((await autoStartRun({ ...abbreviated, uid: 'b', source: 'ical' })).length, 0, 'an ambiguous abbreviation stays listed only');
  const trusted = one('DTSTART;TZID=America/Los_Angeles:20261125T223000');
  assert.equal((await autoStartRun({ ...trusted, uid: 't', source: 'ical' })).length, 1, 'a resolved-zone event still starts');
});

// Schedule's "Will auto-start" / "Listed only" pill reads autoStartEligible from
// the fetch-calendar-events IPC; it must agree with checkCalendarAutoStart.
test('fetch-calendar-events maps an untrusted imported event to autoStartEligible false', () => {
  const handler = (mainSource.match(/ipcMain\.handle\('fetch-calendar-events'[\s\S]*?\n\}\);/) || [''])[0];
  const expression = (handler.match(/autoStartEligible:\s*([^\n]+)/) || [])[1];
  assert.ok(expression, 'autoStartEligible is computed in the fetch-calendar-events handler');
  const eligible = e => vm.runInNewContext(expression, { e, isBedtimeEvent: x => /bedtime/i.test(x.summary || ''), calProviders: cp });
  assert.equal(eligible({ ...one('DTSTART;TZID=Customized Time Zone:20261125T223000'), source: 'ical' }), false);
  assert.equal(eligible({ ...one('DTSTART;TZID=IST:20261125T223000'), source: 'ical' }), false);
  assert.equal(eligible({ ...one('DTSTART;TZID=Europe/Dublin:20261125T223000'), source: 'ical' }), true);
  assert.equal(eligible({ uid: 'r', summary: 'Movie night', start: new Date(), source: 'builtin' }), true, 'built-in rules are always eligible');
  assert.equal(eligible({ ...one('DTSTART;TZID=Europe/Dublin:20261125T223000'), summary: 'Dentist', source: 'ical' }), false, 'the keyword filter still applies');
});

test('every Windows zone mapping names a zone this runtime knows, and unknown names resolve to null', () => {
  for (const [name, zone] of Object.entries(cal.WINDOWS_TIME_ZONES)) {
    assert.equal(name, name.toLowerCase(), 'keys are stored lower-case');
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }), `${name} -> ${zone}`);
    assert.ok(cal.resolveIcsTimeZone(name), name);
  }
  assert.equal(cal.resolveIcsTimeZone('Customized Time Zone'), null);
  assert.equal(cal.resolveIcsTimeZone(''), null);
  assert.equal(cal.resolveIcsTimeZone('x'.repeat(200)), null);
});
