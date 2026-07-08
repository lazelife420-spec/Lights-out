// Tests for the pure provider-registry + built-in recurring-schedule logic in
// calendarProviders.js. getDefaultCalendarEvents drives the default "Bedtime"
// calendar, so its day filtering, bedtime parsing, and future-only / cutoff
// windowing need to be correct and deterministic.
//
// The network provider fetchers (Google/Outlook/Calendly/ICS) are not covered
// here — they require live HTTP and are integration-tested elsewhere.

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

test('getDefaultCalendarEvents emits Bedtime events with the right shape', () => {
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
    assert.match(e.uid, /^lo-default-\d{4}-\d{2}-\d{2}$/);
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
