'use strict';

// Post-RC3 physical-observer. Evidence-only wrapper around the repository's
// existing packaged-phone proof (scripts/packaged-phone-smoke.js), following
// the established in-memory-patch pattern from the v11.1.2 gate1 observer:
// it executes the unmodified proof flow while adapting three environment
// assumptions for this tranche. Product/runtime/test source is not modified.
//   1. Desktop launches from SOURCE Electron (Windows packaging is forbidden
//      this tranche; frozen RC3 must not be touched) via electron.exe with
//      the app directory as the first argument.
//   2. Android package targets the debug-signed v11.1.3 development build
//      (com.lightsout.companion.debug) which installs beside the untouched
//      production-signed companion (see companion-android build.gradle).
//   3. The summary JSON labels the desktop mode honestly (source, not
//      packaged). Evidence dir is chosen via LIGHTS_OUT_PHONE_PROOF_DIR.
// Every patch is guarded: if the base script drifts and a search string no
// longer matches, this wrapper FAILS LOUDLY instead of silently launching a
// packaged EXE.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../../../../scripts/packaged-phone-smoke.js');
let source = fs.readFileSync(sourcePath, 'utf8');

function replaceOnce(label, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Observer patch anchor missing (${label}) -- packaged-phone-smoke.js drifted; refusing to run unpatched`);
  }
  source = source.replace(search, replacement);
}

// 1a. Point the desktop launcher at source Electron (app dir = electron/).
replaceOnce(
  'executable const',
  [
    'const executable = process.env.LIGHTS_OUT_PACKAGED_EXE',
    '  ? path.resolve(process.env.LIGHTS_OUT_PACKAGED_EXE)',
    "  : path.join(root, 'dist-native', 'win-unpacked', 'Lights Out.exe');"
  ].join('\n'),
  [
    "const ELECTRON_APP_DIR = path.resolve(__dirname, '..');",
    "const executable = path.join(ELECTRON_APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');"
  ].join('\n')
);

// 1b. Spawn electron.exe with the app dir as its first argument.
replaceOnce(
  'spawn block',
  [
    '  const child = spawn(executable, [',
    "    '--no-auto-start',",
    '    `--user-data-dir=${userData}`,',
    '    `--remote-debugging-port=${debugPort}`',
    '  ], {',
    '    cwd: path.dirname(executable),'
  ].join('\n'),
  [
    '  const child = spawn(executable, [',
    '    ELECTRON_APP_DIR,',
    "    '--no-auto-start',",
    '    `--user-data-dir=${userData}`,',
    '    `--remote-debugging-port=${debugPort}`',
    '  ], {',
    '    cwd: ELECTRON_APP_DIR,'
  ].join('\n')
);

// 1c. The packaged-EXE existence assertion becomes an Electron assertion.
replaceOnce(
  'executable assertion',
  'assert.ok(fs.existsSync(executable), `Packaged executable missing: ${executable}`);',
  'assert.ok(fs.existsSync(executable), `Source Electron binary missing: ${executable}`);'
);

// 3. Honest summary label.
replaceOnce(
  'summary label',
  '      packaged: true,',
  [
    '      packaged: false,',
    "      desktopMode: 'source-electron (post-RC3 tranche: Windows packaging forbidden)',"
  ].join('\n')
);

// Guard: no packaged-EXE path may survive into the executed module.
if (source.includes('dist-native')) throw new Error('Observer guard failed: a packaged-EXE path survived patching');

const observer = new Module(sourcePath, module);
observer.filename = sourcePath;
observer.paths = Module._nodeModulePaths(path.dirname(sourcePath));
observer._compile(source, sourcePath);
