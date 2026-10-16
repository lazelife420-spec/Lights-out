'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ELECTRON_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ELECTRON_ROOT, 'package.json'), 'utf8'));
const E2E_RUNNER_SRC = fs.readFileSync(path.join(ELECTRON_ROOT, 'scripts', 'e2e-runner.js'), 'utf8');
const DESKTOP_GATE_SRC = fs.readFileSync(path.join(ELECTRON_ROOT, 'scripts', 'desktop-ux-functional-gate.js'), 'utf8');

test('package.json exposes distinct test:e2e:ci and test:e2e:desktop script targets', () => {
  assert.equal(PACKAGE_JSON.scripts['test:e2e:ci'], 'npm run build && node scripts/e2e-runner.js --ci');
  assert.equal(PACKAGE_JSON.scripts['test:e2e:desktop'], 'node scripts/desktop-ux-functional-gate.js --desktop-ux-proof');
  assert.equal(PACKAGE_JSON.scripts['test:e2e'], 'npm run build && node scripts/e2e-runner.js');
});

test('CI lane (--ci) runs packaged-truth-smoke as required and skips interactive native input', () => {
  assert.match(E2E_RUNNER_SRC, /IS_CI_MODE/);
  assert.match(E2E_RUNNER_SRC, /INTERACTIVE_DESKTOP_REQUIRED \(skipped in --ci mode\)/);
  assert.match(E2E_RUNNER_SRC, /packaged-truth-smoke/);
});

test('desktop-ux-functional-gate remains required and is never marked advisory', () => {
  assert.match(E2E_RUNNER_SRC, /runLane\(\s*'desktop-ux-functional-gate\.js',\s*\['--desktop-ux-proof'\],\s*'desktop-ux-functional-gate',\s*true\s*\)/);
});

test('unsupported desktop execution environment returns exit code 2 (INTERACTIVE_DESKTOP_REQUIRED)', () => {
  assert.match(DESKTOP_GATE_SRC, /current app window does not own foreground custody/);
  assert.match(DESKTOP_GATE_SRC, /INTERACTIVE_DESKTOP_REQUIRED/);
  assert.match(DESKTOP_GATE_SRC, /process\.exitCode = 2/);
  assert.match(E2E_RUNNER_SRC, /process\.exit\(2\)/);
});

test('full E2E qualification requires both unattended CI and interactive desktop evidence', () => {
  assert.match(E2E_RUNNER_SRC, /Full release qualification requires `npm run test:e2e:desktop`/);
});

test('CI qualification fails if either required runtime proof fails', () => {
  function runWithStatuses(statuses) {
    const calls = [];
    let exit = 0;
    try {
      vm.runInNewContext(E2E_RUNNER_SRC, {
        __dirname: path.join(ELECTRON_ROOT, 'scripts'),
        console: { log() {}, error() {} },
        process: { argv: ['node', 'e2e-runner.js', '--ci'], execPath: 'node', env: {}, exit(code) { throw { requestedExit: code }; } },
        require(name) {
          if (name === 'node:child_process') return { spawnSync(_command, args) {
            const script = path.basename(args[0]);
            calls.push(script);
            return { status: statuses[script] || 0 };
          } };
          if (name === './packaged-artifact-resolver') return { requirePackagedArtifact() {} };
          return require(name);
        }
      });
    } catch (error) {
      if (!Object.hasOwn(error, 'requestedExit')) throw error;
      exit = error.requestedExit;
    }
    assert.deepEqual(calls, ['packaged-truth-smoke.js', 'night-modes-electron-proof.js']);
    return exit;
  }
  assert.equal(runWithStatuses({}), 0);
  assert.equal(runWithStatuses({ 'packaged-truth-smoke.js': 1 }), 1);
  assert.equal(runWithStatuses({ 'night-modes-electron-proof.js': 1 }), 1);
});
