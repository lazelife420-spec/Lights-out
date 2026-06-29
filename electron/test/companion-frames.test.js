// Tests for the hand-rolled RFC 6455 frame codec in companion.js.
// This parser consumes untrusted bytes off a LAN socket, so its bounds,
// masking enforcement, and control-frame handling are security-relevant.
// We drive it with a fake client object (the same shape companion.js builds
// internally) and synthetic frames, capturing both emitted app messages and
// the raw bytes the server writes back (close/pong frames).

const test = require('node:test');
const assert = require('node:assert');
const companion = require('../companion');

// Build a client→server frame the way a real browser would: FIN set, masked,
// 4-byte mask key applied to the payload. The server REQUIRES masking on
// inbound frames (unmasked => protocol-error close 1002).
function maskedFrame(opcode, payload, { fin = true } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = body.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len; // mask bit + 7-bit length
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = body[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

// A stand-in for the per-connection client object companion.js creates. Its
// socket only needs write/end/destroy; we record every write so we can decode
// the close/pong control frames the server emits.
function makeClient() {
  const writes = [];
  const client = {
    alive: true,
    buf: Buffer.alloc(0),
    socket: {
      write: (b) => { writes.push(Buffer.from(b)); return true; },
      end: () => {},
      destroy: () => {}
    }
  };
  return { client, writes };
}

// onMessage is backed by a single module-level emitter, so we register one
// persistent listener that appends to a shared log, and each feed returns only
// the messages that arrived during that call (avoids leaking a listener per
// feed and the MaxListeners warning that would follow).
const emitted = [];
companion.onMessage((msg) => emitted.push(msg));

function feed(client, buf) {
  const before = emitted.length;
  client.buf = client.buf.length ? Buffer.concat([client.buf, buf]) : buf;
  companion.consumeFrames(client);
  return emitted.slice(before);
}

// Decode a server→client control frame (close/pong) from a captured write.
function decodeControl(buf) {
  const opcode = buf[0] & 0x0f;
  const len = buf[1] & 0x7f; // server frames are never masked, len < 126 here
  const payload = buf.slice(2, 2 + len);
  return { fin: (buf[0] & 0x80) !== 0, opcode, payload };
}

test('encodeFrame: small payload uses a 2-byte header, FIN + opcode set', () => {
  const f = companion.encodeFrame(0x1, Buffer.from('hi'));
  assert.strictEqual(f[0], 0x81);            // FIN + text opcode
  assert.strictEqual(f[1], 2);               // unmasked, length 2
  assert.strictEqual(f.slice(2).toString(), 'hi');
});

test('encodeFrame: 126..65535 payload uses 16-bit extended length', () => {
  const payload = Buffer.alloc(200, 0x61);
  const f = companion.encodeFrame(0x1, payload);
  assert.strictEqual(f[1], 126);
  assert.strictEqual(f.readUInt16BE(2), 200);
  assert.strictEqual(f.length, 4 + 200);
});

test('encodeFrame: >65535 payload uses 64-bit extended length', () => {
  const payload = Buffer.alloc(70000, 0x62);
  const f = companion.encodeFrame(0x1, payload);
  assert.strictEqual(f[1], 127);
  assert.strictEqual(Number(f.readBigUInt64BE(2)), 70000);
  assert.strictEqual(f.length, 10 + 70000);
});

test('consumeFrames: a valid masked text frame yields a validated message', () => {
  const { client } = makeClient();
  const start = JSON.stringify({ action: 'start', timerAction: 'shutdown', durationSeconds: 1800 });
  const messages = feed(client, maskedFrame(0x1, start));
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual(messages[0], { action: 'start', timerAction: 'shutdown', durationSeconds: 1800 });
  assert.strictEqual(client.alive, true);
});

test('consumeFrames: malformed JSON is ignored, not crashed on', () => {
  const { client } = makeClient();
  const messages = feed(client, maskedFrame(0x1, 'not json{{'));
  assert.strictEqual(messages.length, 0);
  assert.strictEqual(client.alive, true);
});

test('consumeFrames: a message failing validation is dropped', () => {
  const { client } = makeClient();
  // Valid JSON, unknown action => validateCompanionMessage rejects it.
  const messages = feed(client, maskedFrame(0x1, JSON.stringify({ action: 'nuke' })));
  assert.strictEqual(messages.length, 0);
});

test('consumeFrames: an unmasked client frame is a protocol error (close 1002)', () => {
  const { client, writes } = makeClient();
  // Build an UNMASKED text frame by hand (mask bit clear).
  const body = Buffer.from('x');
  const frame = Buffer.concat([Buffer.from([0x81, body.length]), body]);
  client.buf = frame;
  companion.consumeFrames(client);
  assert.strictEqual(client.alive, false);
  const close = decodeControl(writes[writes.length - 1]);
  assert.strictEqual(close.opcode, 0x8);
  assert.strictEqual(close.payload.readUInt16BE(0), 1002);
});

test('consumeFrames: a frame over MAX_MESSAGE is rejected (close 1009)', () => {
  const { client, writes } = makeClient();
  // Declare a 64-bit length above MAX_MESSAGE (64KiB) without sending the body.
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 0x80 | 127;                 // masked + 64-bit length
  header.writeBigUInt64BE(BigInt(64 * 1024 + 1), 2);
  client.buf = header;
  companion.consumeFrames(client);
  assert.strictEqual(client.alive, false);
  const close = decodeControl(writes[writes.length - 1]);
  assert.strictEqual(close.opcode, 0x8);
  assert.strictEqual(close.payload.readUInt16BE(0), 1009);
});

test('consumeFrames: a ping is answered with a pong carrying the same payload', () => {
  const { client, writes } = makeClient();
  feed(client, maskedFrame(0x9, 'ping-data'));
  const pong = decodeControl(writes[writes.length - 1]);
  assert.strictEqual(pong.opcode, 0xA);
  assert.strictEqual(pong.payload.toString(), 'ping-data');
  assert.strictEqual(client.alive, true);
});

test('consumeFrames: a close frame from the client tears the connection down', () => {
  const { client } = makeClient();
  feed(client, maskedFrame(0x8, Buffer.alloc(0)));
  assert.strictEqual(client.alive, false);
});

test('consumeFrames: a frame split across two chunks is reassembled', () => {
  const { client } = makeClient();
  const start = JSON.stringify({ action: 'cancel' });
  const full = maskedFrame(0x1, start);
  const cut = Math.floor(full.length / 2);

  // First half: no complete frame yet, nothing emitted, buffer retained.
  let messages = feed(client, full.slice(0, cut));
  assert.strictEqual(messages.length, 0);

  // Second half completes the frame.
  messages = feed(client, full.slice(cut));
  assert.deepStrictEqual(messages, [{ action: 'cancel' }]);
});

test('consumeFrames: two back-to-back frames in one chunk both dispatch', () => {
  const { client } = makeClient();
  const a = maskedFrame(0x1, JSON.stringify({ action: 'togglePause' }));
  const b = maskedFrame(0x1, JSON.stringify({ action: 'cancel' }));
  const messages = feed(client, Buffer.concat([a, b]));
  assert.deepStrictEqual(messages, [{ action: 'togglePause' }, { action: 'cancel' }]);
});
