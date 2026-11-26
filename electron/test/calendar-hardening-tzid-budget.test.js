'use strict';
// v11.3 audit (calendar re-review): a hostile feed must not turn time-zone
// resolution into seconds of main-process work, and the RFC 5545
// globally-unique TZID form ("/America/New_York") must resolve.

const { test } = require('node:test');
const assert = require('node:assert/strict');

function parseWith(cal, tzid) {
  return cal.parseIcsContent([
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:u', 'SUMMARY:Bedtime',
    `DTSTART;TZID=${tzid}:20260701T223000`, 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n'))[0];
}

test('distinct deep TZIDs in one feed stay within a small Intl budget and are all listed as untrusted', t => {
  const RealFormat = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = new Proxy(RealFormat, { construct(target, args) { constructions++; return new target(...args); } });
  t.after(() => { Intl.DateTimeFormat = RealFormat; });
  delete require.cache[require.resolve('../calendar')];
  const cal = require('../calendar');
  const deep = n => `${n}/` + Array.from({ length: 60 }, () => 'a').join('/');
  const lines = ['BEGIN:VCALENDAR'];
  for (let n = 0; n < 2000; n++) {
    lines.push('BEGIN:VEVENT', `UID:u${n}`, 'SUMMARY:Bedtime', `DTSTART;TZID=${deep(n)}:20260701T223000`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const started = Date.now();
  const events = cal.parseIcsContent(lines.join('\r\n'));
  assert.equal(events.length, 2000, 'every event is still listed');
  assert.ok(events.every(e => e.timeZoneUnresolved === true), 'unknown zones stay untrusted');
  assert.ok(constructions < 64 * 6, `Intl constructions bounded (${constructions})`);
  assert.ok(Date.now() - started < 3000, 'parse stays fast');
});

test('the RFC 5545 leading-slash form resolves, while abbreviations stay unresolved', () => {
  delete require.cache[require.resolve('../calendar')];
  const cal = require('../calendar');
  for (const tzid of ['/America/New_York', 'America/New_York', '/mozilla.org/20050126_1/America/New_York', 'America/Argentina/Buenos_Aires']) {
    const event = parseWith(cal, tzid);
    assert.notEqual(event.timeZoneUnresolved, true, `${tzid} resolves`);
  }
  const ny = parseWith(cal, '/America/New_York');
  assert.equal(new Date(ny.start).toISOString(), '2026-07-02T02:30:00.000Z', '22:30 EDT');
  for (const tzid of ['/BST', 'BST/', 'Custom/BST', 'BST']) {
    assert.equal(parseWith(cal, tzid).timeZoneUnresolved, true, `${tzid} stays unresolved`);
  }
});
