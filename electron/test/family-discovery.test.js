// Tests for the family-mode LAN discovery beacon parser. Discovery datagrams
// arrive over UDP broadcast from anything on the network, so parseDiscoveryBeacon
// is a trust boundary: it must reject foreign/own/malformed packets and tame the
// attacker-controlled peer name before it is stored or surfaced to the UI.

const test = require('node:test');
const assert = require('node:assert');
const family = require('../family');

const { FAMILY_MAGIC, MAX_LABEL_LEN, parseDiscoveryBeacon } = family;

test('accepts a well-formed beacon and returns the peer', () => {
  const peer = parseDiscoveryBeacon(`${FAMILY_MAGIC}|Bedroom PC|58733`, '192.168.1.20', ['192.168.1.5']);
  assert.deepStrictEqual(peer, { ip: '192.168.1.20', name: 'Bedroom PC' });
});

test('ignores datagrams without the family magic prefix', () => {
  assert.strictEqual(parseDiscoveryBeacon('SOMETHING_ELSE|x|1', '192.168.1.20', []), null);
  assert.strictEqual(parseDiscoveryBeacon('', '192.168.1.20', []), null);
});

test('ignores a beacon with no label field', () => {
  assert.strictEqual(parseDiscoveryBeacon(FAMILY_MAGIC, '192.168.1.20', []), null);
});

test('ignores our own beacon (sender ip is a local ip)', () => {
  const ip = '192.168.1.5';
  assert.strictEqual(parseDiscoveryBeacon(`${FAMILY_MAGIC}|Me|58733`, ip, [ip]), null);
});

test('ignores a beacon with a missing sender address', () => {
  assert.strictEqual(parseDiscoveryBeacon(`${FAMILY_MAGIC}|Whoever|1`, '', []), null);
  assert.strictEqual(parseDiscoveryBeacon(`${FAMILY_MAGIC}|Whoever|1`, undefined, []), null);
});

test('accepts a raw Buffer datagram, not just a string', () => {
  const buf = Buffer.from(`${FAMILY_MAGIC}|Living Room|58733`);
  const peer = parseDiscoveryBeacon(buf, '10.0.0.2', []);
  assert.deepStrictEqual(peer, { ip: '10.0.0.2', name: 'Living Room' });
});

test('strips control characters from the untrusted label', () => {
  const peer = parseDiscoveryBeacon(`${FAMILY_MAGIC}|ab\x00\x1f\x7fcd|1`, '10.0.0.3', []);
  assert.strictEqual(peer.name, 'abcd');
});

test('caps an over-long label at MAX_LABEL_LEN', () => {
  const longName = 'A'.repeat(500);
  const peer = parseDiscoveryBeacon(`${FAMILY_MAGIC}|${longName}|1`, '10.0.0.4', []);
  assert.strictEqual(peer.name.length, MAX_LABEL_LEN);
});

test('falls back to the sender ip when the label is empty after sanitizing', () => {
  const peer = parseDiscoveryBeacon(`${FAMILY_MAGIC}|\x00\x01\x02|1`, '10.0.0.5', []);
  assert.strictEqual(peer.name, '10.0.0.5');
});

test('uses only the first field as the label, ignoring extra pipes', () => {
  const peer = parseDiscoveryBeacon(`${FAMILY_MAGIC}|Den|58733|extra|junk`, '10.0.0.6', []);
  assert.strictEqual(peer.name, 'Den');
});
