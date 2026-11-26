'use strict';
// packaging-2: BUILD-MANIFEST.json must not certify a build as a clean build of
// sourceCommit while a packaged application file is untracked, ignored, staged
// only, or edited relative to HEAD. Uses throwaway git repositories; the real
// repository's git state is never read or changed by these tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Hermetic git: fixture repositories must not inherit this machine's global or
// system git configuration (signing, hooks, templates, autocrlf).
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-packaging-provenance-'));
const isolatedConfig = path.join(sandbox, 'gitconfig');
fs.writeFileSync(isolatedConfig, '');
process.env.GIT_CONFIG_GLOBAL = isolatedConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) delete process.env[name];
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const { create, verify, uncommittedAppSourceFiles, uncommittedBuildInputFiles, buildInputFiles } = require('../scripts/release-artifacts');
const { appSourceFiles } = require('../scripts/app-source-files');

const VERSION = '9.8.7';
const ARTIFACTS = [`Lights-Out-Setup-v${VERSION}.exe`, `Lights-Out-Portable-v${VERSION}-win-x64.zip`];

function git(repo, ...args) {
  return execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root, relative, content) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// A repository shaped like this one: <repo>/electron with build.files naming
// explicit modules plus an assets/** tree. `uncommitted` files exist on disk but
// are left out of the commit (the "forgot git add" case).
function repoFixture({ uncommitted = [], gitignore = '', extra = {} } = {}) {
  const repo = fs.mkdtempSync(path.join(sandbox, 'repo-'));
  const appDir = path.join(repo, 'electron');
  const files = {
    'package.json': JSON.stringify({ name: 'fixture-app', version: VERSION, build: { files: ['main.js', 'feature.js', 'assets/**'] } }, null, 2) + '\n',
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/electron': { version: '43.8.4' } } }) + '\n',
    'main.js': "'use strict';\nrequire('./feature');\n",
    'feature.js': "'use strict';\nmodule.exports = 1;\n",
    'assets/icon.txt': 'icon\n',
    ...extra,
  };
  git(sandbox, 'init', '-q', repo);
  if (gitignore) write(repo, '.gitignore', gitignore);
  for (const [name, content] of Object.entries(files)) if (!uncommitted.includes(name)) write(appDir, name, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'fixture');
  for (const name of uncommitted) write(appDir, name, files[name]);
  return { repo, appDir };
}

// Stages a fake dist-native output whose packaged app is a copy of the working tree.
function stageOutput(appDir) {
  const output = fs.mkdtempSync(path.join(sandbox, 'dist-native-'));
  const packagedApp = path.join(output, 'win-unpacked', 'resources', 'app');
  for (const name of appSourceFiles(appDir)) write(packagedApp, name, fs.readFileSync(path.join(appDir, ...name.split('/'))));
  write(output, 'win-unpacked/Lights Out.exe', 'fixture runtime');
  for (const name of ARTIFACTS) write(output, name, 'fixture artifact ' + name);
  return output;
}

function build(t, appDir) {
  t.mock.method(console, 'log', () => {});
  const output = stageOutput(appDir);
  create(output, { appDir });
  return { output, manifest: JSON.parse(fs.readFileSync(path.join(output, 'BUILD-MANIFEST.json'), 'utf8')) };
}

test('a build of a fully committed tree is recorded clean and passes strict verification', t => {
  const { appDir } = repoFixture();
  const { output, manifest } = build(t, appDir);
  assert.equal(manifest.trackedSourceDirty, false);
  assert.deepEqual(manifest.uncommittedAppSourceFiles, []);
  assert.equal(verify(output, true, false, { appDir }).version, VERSION);
  assert.equal(verify(output, true, true, { appDir }).version, VERSION);
});

test('an untracked packaged module marks the build dirty and strict verification refuses it', t => {
  const { appDir } = repoFixture({ uncommitted: ['feature.js'] });
  const { output, manifest } = build(t, appDir);
  assert.equal(manifest.trackedSourceDirty, true, 'HEAD cannot reproduce this build');
  assert.deepEqual(manifest.uncommittedAppSourceFiles, ['feature.js']);
  assert.throws(() => verify(output, true, false, { appDir }), /clean source commit; packaged files not committed at it: feature\.js/);
  assert.throws(() => verify(output, true, true, { appDir }), /feature\.js/, 'downloaded-asset verification reads the recorded list');
});

test('strict verification re-checks the working tree, so a hand-cleaned manifest still fails', t => {
  const { appDir } = repoFixture({ uncommitted: ['feature.js'] });
  const { output, manifest } = build(t, appDir);
  fs.writeFileSync(path.join(output, 'BUILD-MANIFEST.json'),
    JSON.stringify({ ...manifest, trackedSourceDirty: false, uncommittedAppSourceFiles: [] }, null, 2));
  assert.throws(() => verify(output, true, false, { appDir }), /packaged files not committed at it: feature\.js/);
});

test('strict verification refuses a manifest that does not record packaged source provenance', t => {
  const { appDir } = repoFixture();
  const { output, manifest } = build(t, appDir);
  const { uncommittedAppSourceFiles: _omitted, ...legacy } = manifest;
  fs.writeFileSync(path.join(output, 'BUILD-MANIFEST.json'), JSON.stringify(legacy, null, 2));
  assert.throws(() => verify(output, true, true, { appDir }), /must record packaged source files/);
  assert.equal(verify(output, false, true, { appDir }).version, VERSION, 'non-strict checksum verification is unchanged');
  const { uncommittedBuildInputFiles: _alsoOmitted, ...withoutBuildInputs } = manifest;
  fs.writeFileSync(path.join(output, 'BUILD-MANIFEST.json'), JSON.stringify(withoutBuildInputs, null, 2));
  assert.throws(() => verify(output, true, true, { appDir }), /must record build scripts/);
});

// The packager in the fixture runs two helper scripts the way package-native-windows.ps1 does.
const PACKAGER = [
  "param([string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path)",
  "& (Join-Path $PSScriptRoot 'build-helper.ps1') -SourceRoot $SourceRoot",
  "$stampScript = Join-Path $PSScriptRoot 'stamp-helper.ps1'",
  '',
].join('\n');
const BUILD_SCRIPTS = {
  'scripts/package-native-windows.ps1': PACKAGER,
  'scripts/build-helper.ps1': '# compiles a packaged helper\n',
  'scripts/stamp-helper.ps1': '# stamps the executable\n',
  'scripts/unrelated-proof.js': '// a proof script the packager never runs\n',
};

test('an untracked build script the packager runs marks the build dirty and strict verification refuses it', t => {
  const { repo, appDir } = repoFixture({ extra: BUILD_SCRIPTS, uncommitted: ['scripts/build-helper.ps1', 'scripts/unrelated-proof.js'] });
  assert.deepEqual(buildInputFiles(appDir), ['scripts/build-helper.ps1', 'scripts/package-native-windows.ps1', 'scripts/stamp-helper.ps1'],
    'the packager and the scripts it runs, never unrelated scripts or the parent folder');
  assert.deepEqual(uncommittedBuildInputFiles(appDir), ['scripts/build-helper.ps1']);
  let { output, manifest } = build(t, appDir);
  assert.deepEqual(manifest.uncommittedAppSourceFiles, [], 'build scripts are not packaged application files');
  assert.deepEqual(manifest.uncommittedBuildInputFiles, ['scripts/build-helper.ps1']);
  assert.equal(manifest.trackedSourceDirty, true, 'HEAD cannot rebuild this distribution');
  assert.throws(() => verify(output, true, false, { appDir }), /build scripts not committed at it: scripts\/build-helper\.ps1/);
  assert.throws(() => verify(output, true, true, { appDir }), /build scripts not committed at it: scripts\/build-helper\.ps1/);

  // A hand-cleaned manifest is still refused by the working-tree re-check.
  fs.writeFileSync(path.join(output, 'BUILD-MANIFEST.json'),
    JSON.stringify({ ...manifest, trackedSourceDirty: false, uncommittedBuildInputFiles: [] }, null, 2));
  assert.throws(() => verify(output, true, false, { appDir }), /build scripts not committed at it: scripts\/build-helper\.ps1/);

  // An edited (tracked) build script is reported too; committing everything makes the build clean.
  fs.appendFileSync(path.join(appDir, 'scripts', 'stamp-helper.ps1'), '# local edit\n');
  assert.deepEqual(uncommittedBuildInputFiles(appDir), ['scripts/build-helper.ps1', 'scripts/stamp-helper.ps1']);
  git(repo, 'add', 'electron/scripts/build-helper.ps1', 'electron/scripts/stamp-helper.ps1');
  git(repo, 'commit', '-q', '-m', 'commit the build scripts');
  ({ output, manifest } = build(t, appDir));
  assert.deepEqual(manifest.uncommittedBuildInputFiles, []);
  assert.equal(manifest.trackedSourceDirty, false, 'the untracked unrelated proof script does not make the build dirty');
  assert.equal(verify(output, true, false, { appDir }).version, VERSION);
});

// The packager runs a Node build script that loads local helper modules, the way it runs
// verify-electron-provisioning.js, which requires ./electron-provisioning-contract.js.
const NODE_BUILD_SCRIPTS = {
  'scripts/package-native-windows.ps1': [
    "param([string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path)",
    "& node (Join-Path $PSScriptRoot 'verify-helper.js')",
    '',
  ].join('\n'),
  'scripts/verify-helper.js': [
    "'use strict';",
    "const fs = require('node:fs');",
    "const { rules } = require('./helper-contract');",
    "require('./not-on-disk');",
    "require('../../outside-the-app');",
    'module.exports = { fs, rules };',
    '',
  ].join('\n'),
  // A cycle back to the script that required it, a double-quoted specifier and a directory module.
  'scripts/helper-contract.js': "'use strict';\nrequire('./verify-helper.js');\nmodule.exports = { rules: require(\"./lib/shared\") };\n",
  'scripts/lib/shared/index.js': "'use strict';\nmodule.exports = require('../../../build-config.json');\n",
  'build-config.json': '{}\n',
  'scripts/unrelated-helper.js': '// loaded by nothing the packager runs\n',
};

test('an untracked module a JavaScript build script requires marks the build dirty and strict verification refuses it', t => {
  const { repo, appDir } = repoFixture({ extra: NODE_BUILD_SCRIPTS, uncommitted: ['scripts/helper-contract.js', 'scripts/unrelated-helper.js'] });
  write(repo, 'outside-the-app.js', '// outside the application directory: never followed\n');
  assert.deepEqual(buildInputFiles(appDir), [
    'build-config.json',
    'scripts/helper-contract.js',
    'scripts/lib/shared/index.js',
    'scripts/package-native-windows.ps1',
    'scripts/verify-helper.js',
  ], 'required modules are followed recursively; missing, built-in, outside and unrelated files are not listed');
  assert.deepEqual(uncommittedBuildInputFiles(appDir), ['scripts/helper-contract.js']);
  let { output, manifest } = build(t, appDir);
  assert.deepEqual(manifest.uncommittedBuildInputFiles, ['scripts/helper-contract.js']);
  assert.equal(manifest.trackedSourceDirty, true, 'HEAD cannot rebuild this distribution');
  assert.throws(() => verify(output, true, false, { appDir }), /build scripts not committed at it: scripts\/helper-contract\.js/);
  assert.throws(() => verify(output, true, true, { appDir }), /build scripts not committed at it: scripts\/helper-contract\.js/);

  // A module reached only through another required module counts too, once edited.
  git(repo, 'add', 'electron/scripts/helper-contract.js');
  git(repo, 'commit', '-q', '-m', 'commit the helper');
  fs.appendFileSync(path.join(appDir, 'scripts', 'lib', 'shared', 'index.js'), '// local edit\n');
  assert.deepEqual(uncommittedBuildInputFiles(appDir), ['scripts/lib/shared/index.js']);
  git(repo, 'add', 'electron/scripts/lib/shared/index.js');
  git(repo, 'commit', '-q', '-m', 'commit the edit');
  ({ output, manifest } = build(t, appDir));
  assert.deepEqual(manifest.uncommittedBuildInputFiles, []);
  assert.equal(manifest.trackedSourceDirty, false, 'the untracked unrelated helper does not make the build dirty');
  assert.equal(verify(output, true, false, { appDir }).version, VERSION);
});

test('the real packager\'s build inputs include the Electron provisioning contract it loads', () => {
  const inputs = buildInputFiles(path.join(__dirname, '..'));
  assert.ok(inputs.includes('scripts/verify-electron-provisioning.js'), 'the packager runs verify-electron-provisioning.js');
  assert.ok(inputs.includes('scripts/electron-provisioning-contract.js'), 'which requires ./electron-provisioning-contract.js');
});

test('edited, staged-only, renamed and gitignored packaged files are all reported', () => {
  const { repo, appDir } = repoFixture({ uncommitted: ['feature.js'], gitignore: 'electron/feature.js\n' });
  // feature.js is ignored, so git status alone would never mention it.
  assert.deepEqual(uncommittedAppSourceFiles(appDir), ['feature.js']);
  fs.appendFileSync(path.join(appDir, 'main.js'), '// local edit\n');
  write(appDir, 'assets/new.txt', 'staged only\n');
  git(repo, 'add', 'electron/assets/new.txt');
  git(repo, 'mv', 'electron/assets/icon.txt', 'electron/assets/renamed.txt');
  assert.deepEqual(uncommittedAppSourceFiles(appDir), ['assets/new.txt', 'assets/renamed.txt', 'feature.js', 'main.js']);
});

test('unrelated untracked files and a CRLF (autocrlf) checkout do not mark the build dirty', t => {
  const { repo: origin } = repoFixture();
  // A Windows CI runner checks out with core.autocrlf=true: LF blobs, CRLF working files.
  const repo = path.join(sandbox, path.basename(origin) + '-crlf-clone');
  git(sandbox, 'clone', '-q', '-c', 'core.autocrlf=true', origin, repo);
  const appDir = path.join(repo, 'electron');
  assert.match(fs.readFileSync(path.join(appDir, 'main.js'), 'utf8'), /\r\n/, 'fixture checkout really is CRLF');
  write(appDir, 'NOTES.md', 'scratch notes are not packaged\n');
  write(appDir, 'test-results/screenshot.png', 'generated');
  assert.deepEqual(uncommittedAppSourceFiles(appDir), []);
  const { output, manifest } = build(t, appDir);
  assert.equal(manifest.trackedSourceDirty, false);
  assert.deepEqual(manifest.uncommittedAppSourceFiles, []);
  assert.equal(verify(output, true, false, { appDir }).version, VERSION);
});
