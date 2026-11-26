'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');
const version = pkg.version;

const root = path.resolve(__dirname, '../..');

test('package version is documented in CHANGELOG', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(
    changelog.includes(`v${version}`),
    `CHANGELOG.md should contain a v${version} section`
  );
});

test('package version is documented in README', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.ok(
    readme.includes(`v${version}`),
    `README.md should reference v${version}`
  );
});

test('package version is documented in AGENTS.md', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.ok(
    agents.includes(`v${version}`),
    `AGENTS.md should reference v${version}`
  );
});

test('docs/index.html matches package version, checksum filename, and existing favicon asset', () => {
  const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
  assert.ok(
    html.includes(`"softwareVersion": "${version}"`),
    `docs/index.html JSON-LD softwareVersion should match ${version}`
  );
  assert.ok(
    html.includes(`v${version}`),
    `docs/index.html should reference v${version}`
  );
  assert.ok(
    html.includes(`Lights-Out-Setup-v${version}.exe`),
    `docs/index.html checksum example should match Lights-Out-Setup-v${version}.exe`
  );
  assert.ok(
    fs.existsSync(path.join(root, 'docs', 'assets', 'icon-512.png')),
    'docs/assets/icon-512.png must exist for the landing page favicon'
  );
});

test('native-packaged-truth-smoke.js derives expected version dynamically from package.json', () => {
  const src = fs.readFileSync(path.join(root, 'electron', 'scripts', 'native-packaged-truth-smoke.js'), 'utf8');
  assert.ok(src.includes("require('../package.json')"), 'native-packaged-truth-smoke.js should load version from package.json');
  assert.ok(src.includes('pkg.version'), 'native-packaged-truth-smoke.js should use pkg.version instead of hardcoded version');
});
