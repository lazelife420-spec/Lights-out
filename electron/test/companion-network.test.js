'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCandidateIps, selectLanIp, networkFingerprint } = require('../companionNetwork');

test('selectLanIp preserves a preferred address only while it is still present', () => {
  assert.equal(selectLanIp(['192.168.0.11', '192.168.0.16'], '192.168.0.16').lanIp, '192.168.0.16');
  assert.equal(selectLanIp(['192.168.0.11'], '192.168.0.111').lanIp, '192.168.0.11');
});

test('selectLanIp prefers the current routed source over a stale assigned preference', () => {
  const selected = selectLanIp(['192.168.0.111', '192.168.0.11'], '192.168.0.111', '192.168.0.11');
  assert.equal(selected.lanIp, '192.168.0.11');
});

test('selectLanIp reports no LAN endpoint instead of substituting loopback', () => {
  assert.deepEqual(selectLanIp([], '192.168.0.111'), { candidates: [], lanIp: '', hasLanIp: false });
  assert.deepEqual(selectLanIp(['127.0.0.1']), { candidates: [], lanIp: '', hasLanIp: false });
});

test('networkFingerprint detects address-set changes but ignores enumeration order', () => {
  assert.equal(networkFingerprint(['192.168.0.16', '192.168.0.11']), '::192.168.0.11|192.168.0.16');
  assert.equal(networkFingerprint(['192.168.0.11', '192.168.0.16']), '::192.168.0.11|192.168.0.16');
  assert.notEqual(networkFingerprint(['192.168.0.111']), networkFingerprint(['192.168.0.11']));
  assert.notEqual(networkFingerprint(['192.168.0.11'], '192.168.0.111'), networkFingerprint(['192.168.0.11'], '192.168.0.11'));
});

test('normalizeCandidateIps trims, deduplicates, and drops invalid values', () => {
  assert.deepEqual(normalizeCandidateIps([' 192.168.0.11 ', '192.168.0.11', '', null]), ['192.168.0.11']);
});
