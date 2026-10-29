'use strict';

// DEF-002 use-site enforcement: router credentials must never leave the
// machine for a non-private destination, no matter how the value was
// persisted. The save/import sanitizers already refuse bad routerIp values;
// this pins the request-path guard so a value that bypassed persistence-time
// validation (bulk import, hand-edited settings.json) still cannot leak
// credentials to an arbitrary host.

const assert = require('node:assert/strict');
const test = require('node:test');

const wifiGuard = require('../wifiGuard');

const creds = { routerUser: 'admin', routerPass: 'supersecret', deviceMacs: ['AA:BB:CC:DD:EE:FF'] };

async function refusesOnBlock(routerIp, provider = 'tplink') {
  const r = await wifiGuard.blockInternet({ provider, routerIp, ...creds });
  assert.equal(r.success, false);
  assert.match(r.error, /refused/i, `routerIp ${routerIp} must be refused on block`);
  const u = await wifiGuard.unblockInternet({ provider, routerIp, ...creds });
  assert.equal(u.success, false);
  assert.match(u.error, /refused/i, `routerIp ${routerIp} must be refused on unblock`);
}

test('public IPs are refused for every router provider', async () => {
  for (const provider of ['tplink', 'asus', 'netgear']) {
    await refusesOnBlock('8.8.8.8', provider);
  }
});

test('hostnames are refused (no DNS, no injection)', async () => {
  await refusesOnBlock('attacker.example.com');
  await refusesOnBlock('router.local');
});

test('URL-injection tricks are refused', async () => {
  // If this reached `http://${routerIp}` the @ would parse as userinfo and the
  // real host would be attacker.com — exactly the DEF-002 leak.
  await refusesOnBlock('192.168.1.1@attacker.com');
  await refusesOnBlock('attacker.com/');
  await refusesOnBlock('192.168.1.1:80@attacker.com');
});

test('private LAN targets still reach the provider path', async () => {
  // The guard must not block legitimate routers. The call then fails on the
  // network (no router here) — which proves the guard passed it through rather
  // than refusing it at the boundary.
  const r = await wifiGuard.blockInternet({ provider: 'tplink', routerIp: '192.168.1.1', ...creds });
  assert.equal(r.success, false);
  assert.doesNotMatch(String(r.error), /refused/i, 'private IP must not hit the refuse guard');
});

test('safeRouterTarget accepts exactly private/local literals', async () => {
  assert.equal(wifiGuard.safeRouterTarget('192.168.0.1'), '192.168.0.1');
  assert.equal(wifiGuard.safeRouterTarget(' 10.0.0.1 '), '10.0.0.1');
  assert.equal(wifiGuard.safeRouterTarget('172.16.5.4'), '172.16.5.4');
  assert.equal(wifiGuard.safeRouterTarget('127.0.0.1'), '127.0.0.1');
  assert.equal(wifiGuard.safeRouterTarget('169.254.1.1'), '169.254.1.1');
  assert.equal(wifiGuard.safeRouterTarget('8.8.8.8'), null);
  assert.equal(wifiGuard.safeRouterTarget('172.15.0.1'), null, 'outside 172.16/12 is public');
  assert.equal(wifiGuard.safeRouterTarget('router.local'), null);
  assert.equal(wifiGuard.safeRouterTarget(''), null);
  assert.equal(wifiGuard.safeRouterTarget(null), null);
});
