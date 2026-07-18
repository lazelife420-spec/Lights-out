'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const truth = require('../capabilityTruth');

test('WiFi Guard cannot look enabled without its provider setup', () => {
  assert.equal(truth.sanitizeWifiGuard({ enabled: true, provider: 'webhook', webhookUrl: '' }).enabled, false);
  assert.equal(truth.sanitizeWifiGuard({ enabled: true, provider: 'tplink', routerIp: '192.168.0.1' }).enabled, false);
  assert.equal(truth.sanitizeWifiGuard({ enabled: true, provider: 'webhook', webhookUrl: 'https://example.test/hook' }).enabled, true);
  assert.equal(truth.sanitizeWifiGuard({ enabled: true, provider: 'firewall' }).provider, 'webhook');
});

test('Content Blocker needs either its grounded default list or explicit sites', () => {
  assert.equal(truth.sanitizeContentBlocker({ enabled: true, useDefault: false, blocklist: [] }).enabled, false);
  assert.equal(truth.sanitizeContentBlocker({ enabled: true, useDefault: true }).enabled, true);
  assert.equal(truth.sanitizeContentBlocker({ enabled: true, useDefault: false, blocklist: ['example.com'] }).enabled, true);
});

test('Accountability cannot look enabled without a valid webhook partner', () => {
  assert.equal(truth.sanitizeAccountability({ enabled: true, partners: [] }).enabled, false);
  assert.equal(truth.sanitizeAccountability({ enabled: true, partners: [{ type: 'webhook', url: 'not-a-url' }] }).enabled, false);
  assert.equal(truth.sanitizeAccountability({ enabled: true, partners: [{ type: 'webhook', url: 'https://example.test/hook' }] }).enabled, true);
});
