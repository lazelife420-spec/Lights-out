'use strict';
// Every calendar fetch sends one shared, version-less User-Agent, so feed hosts
// are never told a stale app version ('LightsOut/11.2' in calendar.js and
// 'LightsOut/7' in calendarProviders.js used to disagree). Requests go to a
// loopback server on 127.0.0.1: https.request is redirected to http.request
// there, so nothing leaves this machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const cp = require('../calendarProviders');
const cal = require('../calendar');

async function loopback(t, body) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers['user-agent']);
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const saved = https.request;
  https.request = (options, onResponse) => http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', port, agent: false }, onResponse);
  t.after(async () => {
    https.request = saved;
    await new Promise(resolve => server.close(resolve));
  });
  return seen;
}

const FEED = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:Bedtime\r\nDTSTART:20991125T223000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

test('the shared calendar User-Agent is version-less', () => {
  assert.equal(cal.CALENDAR_USER_AGENT, 'LightsOut CalendarSync');
  assert.doesNotMatch(cal.CALENDAR_USER_AGENT, /\d/, 'no version number to go stale');
});

test('the ICS URL import and the provider fetch send the same User-Agent', async t => {
  const seen = await loopback(t, FEED);
  await cal.importIcsFromUrl('https://feed.invalid/a.ics');
  await cp.fetchWithTimeout('https://www.googleapis.com/calendar/v3/x', 2000);
  assert.deepEqual(seen, ['LightsOut CalendarSync', 'LightsOut CalendarSync']);
});

test('a caller header can still override the provider User-Agent', async t => {
  const seen = await loopback(t, FEED);
  await cp.fetchWithTimeout('https://www.googleapis.com/calendar/v3/x', 2000, { 'User-Agent': 'Override' });
  assert.deepEqual(seen, ['Override']);
});
