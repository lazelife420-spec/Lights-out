'use strict';
// The Proof Foundry upload kit: page filled from the release manifest, a
// truth record the in-app updater accepts, and hashes for every file.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const kit = require('../scripts/build-proof-foundry-kit');
const policy = require('../updaterPolicy');
const pkg = require('../package.json');

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function fixtureRelease(t, { tamper = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-kit-release-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-kit-out-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });
  const v = pkg.version;
  const files = { [`Lights-Out-Setup-v${v}.exe`]: Buffer.from('fixture installer'), [policy.portableNameFor(v)]: Buffer.from('fixture portable zip') };
  const artifacts = Object.entries(files).map(([name, buf]) => ({ name, bytes: buf.length, sha256: sha(buf) }));
  for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), tamper && name.endsWith('.zip') ? Buffer.from('tampered') : buf);
  fs.writeFileSync(path.join(dir, 'BUILD-MANIFEST.json'), JSON.stringify({ version: v, sourceCommit: 'a'.repeat(40), artifacts }));
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), artifacts.map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n');
  return { dir, out, v, artifacts };
}

test('the kit fills the product page from the release manifest and links GitHub by default', t => {
  const f = fixtureRelease(t);
  const result = kit.build({ releaseDir: f.dir, outRoot: f.out, downloadOption: 'github', publishedAt: '2026-11-26', withBinaries: false, zip: false });
  const page = fs.readFileSync(path.join(result.kit, 'site', 'lights-out', 'index.html'), 'utf8');
  for (const a of f.artifacts) assert.ok(page.includes(a.sha256), `page shows ${a.name} SHA-256`);
  assert.ok(page.includes(`href="https://github.com/lazelife420-spec/Lights-out/releases/download/v${f.v}/Lights-Out-Setup-v${f.v}.exe"`));
  assert.doesNotMatch(page, /Listed in SHA256SUMS\.txt on the release page/, 'no unfilled checksum placeholder');
  for (const rel of ['assets/icon-512.png', 'assets/product/tonight.webp', 'assets/product/proof.png']) {
    assert.ok(fs.existsSync(path.join(result.kit, 'site', 'lights-out', rel)), `${rel} is in the kit`);
  }
  // Every srcset candidate the page can pick is uploaded with it.
  const candidates = [...page.matchAll(/srcset="([^"]+)"/g)].flatMap(m => m[1].split(',').map(part => part.trim().split(/\s+/)[0]));
  assert.ok(candidates.includes('assets/product/tonight-800.webp'), 'the LCP image has a small variant');
  for (const rel of candidates.filter(url => url.startsWith('assets/'))) {
    assert.ok(fs.existsSync(path.join(result.kit, 'site', 'lights-out', rel)), `srcset candidate ${rel} is in the kit`);
  }
  assert.ok(!fs.existsSync(path.join(result.kit, 'downloads')), 'binaries only with --with-binaries');
  const upload = fs.readFileSync(path.join(result.kit, 'UPLOAD.md'), 'utf8');
  assert.match(upload, /site\/truth\/products\/lights-out\.json/);
  assert.match(upload, /UNTRUSTED_DOWNLOAD_HOST/, 'says plainly that GitHub links cannot be used by the in-app updater');
});

test('the truth record matches the live schema and the updater accepts it on the Proof Foundry host', t => {
  const f = fixtureRelease(t);
  const base = `https://${policy.DOWNLOAD_HOST}/lights-out/v${f.v}/`;
  const result = kit.build({ releaseDir: f.dir, outRoot: f.out, downloadOption: base, publishedAt: '2026-11-26', withBinaries: true, zip: false });
  const truth = JSON.parse(fs.readFileSync(path.join(result.kit, 'site', 'truth', 'products', 'lights-out.json'), 'utf8'));
  assert.equal(truth.schemaVersion, 1);
  assert.equal(truth.id, 'lights-out');
  assert.equal(truth.release.publicVersion, f.v);
  assert.equal(truth.release.sourceCommit, 'a'.repeat(40));
  assert.equal(truth.verification.status, 'VERIFIED', 'binaries were hashed against the manifest');
  const older = policy.resolveTruth(truth, '11.0.0');
  assert.equal(older.available, true, `an older app is offered the update (${older.code || ''})`);
  assert.equal(older.assetName, policy.portableNameFor(f.v));
  assert.equal(older.assetDigest, f.artifacts.find(a => a.name.endsWith('.zip')).sha256.toUpperCase());
  assert.equal(policy.resolveTruth(truth, f.v).available, false, 'never offered to itself');
  for (const name of ['downloads/SHA256SUMS.txt', `downloads/${policy.portableNameFor(f.v)}`]) assert.ok(fs.existsSync(path.join(result.kit, name)));
  const manifest = JSON.parse(fs.readFileSync(path.join(result.kit, 'KIT-MANIFEST.json'), 'utf8'));
  for (const file of manifest.files) assert.equal(file.sha256, sha(fs.readFileSync(path.join(result.kit, file.path))), `${file.path} hash recorded`);
});

test('a tampered binary or a foreign download host is refused', t => {
  const bad = fixtureRelease(t, { tamper: true });
  assert.throws(() => kit.build({ releaseDir: bad.dir, outRoot: bad.out, downloadOption: `https://${policy.DOWNLOAD_HOST}/x/`, withBinaries: true, zip: false }), /does not match its published SHA-256/);
  const f = fixtureRelease(t);
  assert.throws(() => kit.build({ releaseDir: f.dir, outRoot: f.out, downloadOption: 'https://example.com/files/', zip: false }), /--download-base must be/);
});

test('a release whose checksums disagree with its manifest is refused', t => {
  const f = fixtureRelease(t);
  fs.writeFileSync(path.join(f.dir, 'SHA256SUMS.txt'), f.artifacts.map(a => `${'0'.repeat(64)}  ${a.name}`).join('\n'));
  assert.throws(() => kit.build({ releaseDir: f.dir, outRoot: f.out, zip: false }), /SHA256SUMS\.txt disagrees/);
});
