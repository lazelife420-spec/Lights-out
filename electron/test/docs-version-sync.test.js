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
