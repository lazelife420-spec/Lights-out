'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const pkg = require('../package.json');
const { verify } = require('../scripts/release-artifacts');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-artifact-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifacts = [`Lights-Out-Setup-v${pkg.version}.exe`, `Lights-Out-Portable-v${pkg.version}-win-x64.zip`].map(name => {
    const content = Buffer.from('qualified fixture ' + name);
    fs.writeFileSync(path.join(directory, name), content);
    return { name, bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  });
  fs.writeFileSync(path.join(directory, 'BUILD-MANIFEST.json'), JSON.stringify({ version: pkg.version, artifacts, runtime: [] }));
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), artifacts.map(a => a.sha256 + '  ' + a.name).join('\n') + '\n');
  return { directory, artifacts };
}
test('downloaded distribution checksums verify independently of installed runtime', t => {
  const { directory } = fixture(t);
  assert.equal(verify(directory, false, true).artifacts.length, 2);
});
test('artifact verification refuses modified installer bytes', t => {
  const { directory, artifacts } = fixture(t);
  fs.appendFileSync(path.join(directory, artifacts[0].name), 'changed');
  assert.throws(() => verify(directory, false, true), /hash mismatch/);
});
test('artifact verification refuses a missing checksum entry', t => {
  const { directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), '');
  assert.throws(() => verify(directory, false, true), /Checksum entry missing/);
});
test('artifact verification refuses extra unexpected lines in SHA256SUMS.txt', t => {
  const { directory } = fixture(t);
  fs.appendFileSync(path.join(directory, 'SHA256SUMS.txt'), '0'.repeat(64) + '  rogue.exe\n');
  assert.throws(() => verify(directory, false, true), /Unexpected or duplicate checksum entry/);
});
test('artifact verification refuses mismatched package version in manifest', t => {
  const { directory, artifacts } = fixture(t);
  fs.writeFileSync(path.join(directory, 'BUILD-MANIFEST.json'), JSON.stringify({ version: '99.99.99', artifacts, runtime: [] }));
  assert.throws(() => verify(directory, false, true), /Manifest version mismatch/);
});
test('artifact verification validates WINDOWS-VERIFICATION.json when present', t => {
  const { directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'WINDOWS-VERIFICATION.json'), JSON.stringify({ status: 'failed', version: pkg.version, qaUninstalled: false }));
  assert.throws(() => verify(directory, false, true), /WINDOWS-VERIFICATION\.json/);
  fs.writeFileSync(path.join(directory, 'WINDOWS-VERIFICATION.json'), JSON.stringify({ status: 'passed', version: pkg.version, qaUninstalled: true }));
  assert.equal(verify(directory, false, true).artifacts.length, 2);
});
test('artifact verification refuses manifest traversal before reading outside output', t => {
  const { directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'BUILD-MANIFEST.json'), JSON.stringify({ artifacts: [{ name: '../outside.exe', sha256: '0'.repeat(64) }], runtime: [] }));
  assert.throws(() => verify(directory, false, true), /hash mismatch/);
});
