// Tests for the iCalendar (.ics) parser in calendar.js. Users import .ics from
// files and remote URLs, so this is an untrusted-input surface: line unfolding,
// date parsing across formats, VEVENT extraction, and the https-only feed-URL
// gate all need to behave predictably on hostile or malformed input.

const test = require('node:test');
const assert = require('node:assert');
const cal = require('../calendar');

// ── expandIcsLines: RFC 5545 line unfolding ────────────────────────────────
test('expandIcsLines folds continuation lines (leading space/tab) into the prior line', () => {
  const out = cal.expandIcsLines(['SUMMARY:Long title', ' continued', '\tmore']);
  assert.deepStrictEqual(out, ['SUMMARY:Long titlecontinuedmore']);
});

test('expandIcsLines drops blank lines and trims', () => {
  assert.deepStrictEqual(cal.expandIcsLines(['A:1', '', '  ', 'B:2']), ['A:1', 'B:2']);
});

test('expandIcsLines treats a leading continuation (nothing to fold into) as a standalone trimmed line', () => {
  assert.deepStrictEqual(cal.expandIcsLines([' orphan']), ['orphan']);
});

// ── convertFromIcsDateTime: format coverage (TZ-stable assertions) ─────────
test('convertFromIcsDateTime parses a date-only value as local midnight', () => {
  const d = cal.convertFromIcsDateTime('20240115');
  assert.strictEqual(d.getFullYear(), 2024);
  assert.strictEqual(d.getMonth(), 0);
  assert.strictEqual(d.getDate(), 15);
  assert.strictEqual(d.getHours(), 0);
});

test('convertFromIcsDateTime parses a local date-time (no Z) deterministically', () => {
  const d = cal.convertFromIcsDateTime('20240115T143000');
  assert.strictEqual(d.getFullYear(), 2024);
  assert.strictEqual(d.getMonth(), 0);
  assert.strictEqual(d.getDate(), 15);
  assert.strictEqual(d.getHours(), 14);
  assert.strictEqual(d.getMinutes(), 30);
});

test('convertFromIcsDateTime handles a UTC (Z) value and hyphenated forms without throwing', () => {
  assert.ok(cal.convertFromIcsDateTime('20240115T143000Z') instanceof Date);
  assert.ok(cal.convertFromIcsDateTime('2024-01-15T14:30:00') instanceof Date);
  assert.ok(!isNaN(cal.convertFromIcsDateTime('20240115T1430').getTime())); // no seconds
});

test('convertFromIcsDateTime returns null for empty / unparseable input', () => {
  assert.strictEqual(cal.convertFromIcsDateTime(''), null);
  assert.strictEqual(cal.convertFromIcsDateTime(null), null);
  assert.strictEqual(cal.convertFromIcsDateTime('not-a-date'), null);
});

// ── parseIcsContent: VEVENT extraction ─────────────────────────────────────
const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:abc-123',
  'SUMMARY:Team sync\\, standup\\nsecond line',
  'LOCATION:Room 5\\, floor 2',
  'DTSTART:20240115T090000',
  'DTEND:20240115T093000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseIcsContent extracts a VEVENT with unescaped summary/location', () => {
  const events = cal.parseIcsContent(SAMPLE);
  assert.strictEqual(events.length, 1);
  const e = events[0];
  assert.strictEqual(e.uid, 'abc-123');
  assert.strictEqual(e.summary, 'Team sync, standup second line'); // \, -> , and \n -> space
  assert.strictEqual(e.location, 'Room 5, floor 2');
  assert.strictEqual(e.start.getHours(), 9);
  assert.strictEqual(e.end.getMinutes(), 30);
});

test('parseIcsContent skips a VEVENT with no DTSTART', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:No start', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\n');
  assert.deepStrictEqual(cal.parseIcsContent(ics), []);
});

test('parseIcsContent defaults end to start + 1h and generates a uid when absent', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Solo', 'DTSTART:20240115T220000',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\n');
  const [e] = cal.parseIcsContent(ics);
  assert.ok(typeof e.uid === 'string' && e.uid.length > 0);
  assert.strictEqual(e.end.getTime() - e.start.getTime(), 60 * 60 * 1000);
});

test('parseIcsContent returns [] for empty input and ignores non-event lines', () => {
  assert.deepStrictEqual(cal.parseIcsContent(''), []);
  assert.deepStrictEqual(cal.parseIcsContent('RANDOM:junk\nMORE:stuff'), []);
});

test('parseIcsContent reads multiple events', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'DTSTART:20240115T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20240116T090000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');
  assert.strictEqual(cal.parseIcsContent(ics).length, 2);
});

// ── importIcsFromText: header guard ────────────────────────────────────────
test('importIcsFromText throws without a VCALENDAR header', () => {
  assert.throws(() => cal.importIcsFromText('BEGIN:VEVENT\nEND:VEVENT'), /VCALENDAR/);
});

test('importIcsFromText returns { source, events, count }', () => {
  const res = cal.importIcsFromText(SAMPLE, 'MyFeed');
  assert.strictEqual(res.source, 'MyFeed');
  assert.strictEqual(res.count, 1);
  assert.strictEqual(res.events.length, 1);
});

// ── testCalendarFeedUrl: https-only gate ───────────────────────────────────
test('testCalendarFeedUrl accepts only trimmed, space-free https URLs', () => {
  assert.strictEqual(cal.testCalendarFeedUrl('https://calendar.google.com/x/basic.ics'), true);
  assert.strictEqual(cal.testCalendarFeedUrl('  https://host/feed.ics  '), true);
  assert.strictEqual(cal.testCalendarFeedUrl('http://host/feed.ics'), false); // not https
  assert.strictEqual(cal.testCalendarFeedUrl('https://host/ evil.ics'), false); // space
  assert.strictEqual(cal.testCalendarFeedUrl('ftp://host/feed.ics'), false);
  assert.strictEqual(cal.testCalendarFeedUrl(''), false);
  assert.strictEqual(cal.testCalendarFeedUrl(null), false);
});
