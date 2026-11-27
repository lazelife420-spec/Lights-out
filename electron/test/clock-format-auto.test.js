'use strict';
// Time format 'auto' (the new default) follows the Windows region: 12-hour
// with AM/PM where the system clock uses it, 24-hour otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer-utils.js'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function formatIdleClockTime(');
let depth = 0, end = src.indexOf('{', start);
for (let i = end; i < src.length; i++) { if (src[i] === '{') depth++; if (src[i] === '}' && --depth === 0) { end = i + 1; break; } }
const fnSource = src.slice(start, end);

function format(clockFormat, hourCycle, date) {
  const RealDTF = Intl.DateTimeFormat;
  const FakeIntl = { DateTimeFormat: function (...args) { const f = new RealDTF(...args); return { resolvedOptions: () => ({ ...f.resolvedOptions(), hourCycle }) }; } };
  const sandbox = { state: { clockFormat }, Intl: FakeIntl };
  vm.createContext(sandbox);
  vm.runInContext(`${fnSource}; this.fmt = formatIdleClockTime;`, sandbox);
  return sandbox.fmt(date);
}

const evening = new Date(2026, 10, 26, 23, 45);
test('auto uses AM/PM when Windows uses a 12-hour clock', () => {
  assert.equal(format('auto', 'h12', evening), '11:45 PM');
  assert.equal(format('auto', 'h11', evening), '11:45 PM');
});
test('auto uses 24-hour when Windows does', () => {
  assert.equal(format('auto', 'h23', evening), '23:45');
});
test('explicit choices still win over the region', () => {
  assert.equal(format('12h', 'h23', evening), '11:45 PM');
  assert.equal(format('24h', 'h12', evening), '23:45');
});
test('auto is the shipped default and the option is offered', () => {
  const settings = fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8');
  assert.match(settings, /clockFormat: 'auto'/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<option value="auto">Automatic \(Windows region\)<\/option>/);
});
