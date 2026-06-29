// Unit tests for the companion WebSocket handshake.
//
// Regression guard for the Sec-WebSocket-Accept computation: a wrong RFC 6455
// magic GUID produces an accept value that strict clients (every real browser,
// the `ws` library) reject, so the phone PWA connects at the TCP level but the
// browser aborts the handshake (close code 1006) and live timer state never
// arrives. Lenient test clients don't validate the accept, so only a check
// against the known-correct RFC example catches this.
//
// Run with: node --test  (or npm test)

const { test } = require('node:test');
const assert = require('node:assert/strict');

// companion.js loads only Node core + ./remoteControl at module scope, so it
// imports cleanly under plain node without Electron.
const companion = require('../companion');

test('computeAccept matches the canonical RFC 6455 example', () => {
  // RFC 6455 §1.3: key "dGhlIHNhbXBsZSBub25jZQ==" must yield this accept.
  assert.equal(
    companion.computeAccept('dGhlIHNhbXBsZSBub25jZQ=='),
    's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
  );
});

test('computeAccept is deterministic and base64-shaped', () => {
  const a = companion.computeAccept('AQIDBAUGBwgJCgsMDQ4PEC==');
  const b = companion.computeAccept('AQIDBAUGBwgJCgsMDQ4PEC==');
  assert.equal(a, b);
  // SHA-1 digest base64-encoded is always 28 chars ending in '='.
  assert.match(a, /^[A-Za-z0-9+/]{27}=$/);
});

test('computeAccept changes with the key', () => {
  assert.notEqual(
    companion.computeAccept('dGhlIHNhbXBsZSBub25jZQ=='),
    companion.computeAccept('x3JJHMbDL1EzLkh9GBhXDw==')
  );
});
