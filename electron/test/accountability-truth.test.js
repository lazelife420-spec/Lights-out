'use strict';

// Partner messages tell the truth (UI-R3 P02): a Test Mode run never leaves
// the device as a success. Messages go to a webhook partner pointing at a
// local 127.0.0.1 listener owned by this test -- nothing leaves the machine.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const accountability = require('../accountability');

let server;
let hookUrl;
const received = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  hookUrl = `http://127.0.0.1:${server.address().port}/hook`;
});

after(() => new Promise(resolve => server.close(resolve)));

async function send(eventType, testMode) {
  received.length = 0;
  const results = await accountability.notifyPartner(eventType, {
    config: { partners: [{ type: 'webhook', name: 'local', url: hookUrl }] },
    timerName: 'Last Call',
    remainingSeconds: eventType === 'TIMER_STARTED' ? 1500 : 0,
    phase: eventType === 'TIMER_STARTED' ? 'focus' : 'idle',
    ...(testMode === undefined ? {} : { testMode })
  });
  assert.deepEqual(results.map(r => r.success), [true]);
  assert.equal(received.length, 1);
  return received[0];
}

const GRAMMAR = {
  violet: '#9b93d6',
  amber: '#f5b83d',
  neutral: '#91a0af',
  teal: '#00d1b2',
  red: '#ff5c7a'
};

test('all Test Mode events send no partner requests', async () => {
  received.length = 0;
  for (const eventType of Object.keys(accountability.EVENTS)) {
    const result = await accountability.notifyPartner(eventType, { testMode: true, config: { partners: [{ type: 'webhook', url: hookUrl }] } });
    assert.deepEqual(result, []);
  }
  assert.equal(received.length, 0);
});

test('a REAL completion keeps its wording and is not marked Test Mode', async () => {
  const payload = await send('TIMER_COMPLETE', false);
  assert.equal(payload.label, 'Timer finished; Windows outcome unverified');
  assert.equal(payload.testMode, false);
  assert.doesNotMatch(payload.message, /Test Mode/);
  assert.equal(payload.color, GRAMMAR.teal);

  const started = await send('TIMER_STARTED');
  assert.equal(started.label, 'Wind-down started', 'omitted testMode keeps REAL wording (testPartner path)');
});

test('EVENTS colours come from the grammar list', () => {
  const colours = Object.fromEntries(Object.entries(accountability.EVENTS).map(([id, e]) => [id, e.color]));
  assert.deepEqual(colours, {
    TIMER_STARTED: GRAMMAR.violet,
    TIMER_PAUSED: GRAMMAR.amber,
    TIMER_SNOOZED: GRAMMAR.amber,
    TIMER_CANCELLED: GRAMMAR.neutral,
    TIMER_COMPLETE: GRAMMAR.teal,
    LAST_LIGHT: GRAMMAR.violet,
    UNSAVED_WORK: GRAMMAR.amber,
    OVERRIDE: GRAMMAR.red
  });
});

test('a Test Mode Discord embed is amber', () => {
  const info = accountability.describeEvent('TIMER_COMPLETE', true);
  assert.equal(parseInt(info.color.replace('#', ''), 16), parseInt(GRAMMAR.amber.slice(1), 16));
  assert.doesNotMatch(info.label, /Completed/);
});
