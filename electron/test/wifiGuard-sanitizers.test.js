// Tests for wifiGuard's input sanitizers. These two helpers are the guard rails
// in front of dangerous sinks: validIps filters the list that gets interpolated
// into PowerShell New-NetFirewallRule commands, and xmlEscape neutralizes values
// embedded in SOAP/XML router request bodies. A regression here is a command- or
// XML-injection hole, so they get direct coverage.

const test = require('node:test');
const assert = require('node:assert');
const { validIps, xmlEscape } = require('../wifiGuard');

test('validIps keeps clean IPv4 and IPv6 literals', () => {
  const input = ['192.168.1.10', '10.0.0.1', '::1', 'fe80::1'];
  assert.deepStrictEqual(validIps(input), input);
});

test('validIps drops non-IP strings that could carry a PowerShell payload', () => {
  const input = [
    '192.168.1.10',
    "192.168.1.10'; Remove-Item C:\\ -Recurse; '",
    'not-an-ip',
    '999.999.999.999',
    '192.168.1.10 && calc'
  ];
  assert.deepStrictEqual(validIps(input), ['192.168.1.10']);
});

test('validIps drops non-string and nullish entries', () => {
  const input = ['10.0.0.5', null, undefined, 42, {}, ['10.0.0.6']];
  assert.deepStrictEqual(validIps(input), ['10.0.0.5']);
});

test('validIps tolerates missing / non-array input', () => {
  assert.deepStrictEqual(validIps(undefined), []);
  assert.deepStrictEqual(validIps(null), []);
  assert.deepStrictEqual(validIps([]), []);
});

test('xmlEscape encodes all five XML metacharacters', () => {
  assert.strictEqual(
    xmlEscape(`<tag attr="x" other='y'> & </tag>`),
    '&lt;tag attr=&quot;x&quot; other=&apos;y&apos;&gt; &amp; &lt;/tag&gt;'
  );
});

test('xmlEscape escapes & first so other entities are not double-encoded', () => {
  // If & were escaped last, '<' -> '&lt;' would become '&amp;lt;'.
  assert.strictEqual(xmlEscape('<'), '&lt;');
  assert.strictEqual(xmlEscape('&lt;'), '&amp;lt;');
});

test('xmlEscape coerces null/undefined to an empty string', () => {
  assert.strictEqual(xmlEscape(null), '');
  assert.strictEqual(xmlEscape(undefined), '');
  assert.strictEqual(xmlEscape(0), '0');
});

test('xmlEscape neutralizes an element-breakout attempt', () => {
  const payload = '</password><admin>true</admin>';
  assert.ok(!xmlEscape(payload).includes('<'));
  assert.ok(!xmlEscape(payload).includes('>'));
});
