// Flat ESLint config (ESLint 9). Pragmatic: catch real correctness bugs
// (undefined names, unreachable code, bad regexes) without fighting this
// codebase's intentional patterns (empty catch blocks, LAN control-char regex).
// Style is deliberately not enforced here — that's not what this lane is for.

const { builtinRules } = require('eslint/use-at-your-own-risk');

const recommendedRules = Object.fromEntries(
  [...builtinRules]
    .filter(([, rule]) => rule.meta?.docs?.recommended)
    .map(([id]) => [id, 'error'])
);

// Globals shared by the Node main process (main.js, feature modules, preload,
// tests, scripts). Writable ones are the CommonJS module bindings.
const nodeGlobals = {
  require: 'readonly', module: 'writable', exports: 'writable',
  process: 'readonly', console: 'readonly', Buffer: 'readonly',
  __dirname: 'readonly', __filename: 'readonly', global: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', queueMicrotask: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly',
  // Modern Node built-ins (Node 18+): used by smartLights/streaks/etc.
  fetch: 'readonly', AbortSignal: 'readonly', Blob: 'readonly',
  structuredClone: 'readonly', performance: 'readonly', window: 'readonly',
};

// Globals for the browser-context renderer (no nodeIntegration; talks to the
// main process only through the preload `window.api` bridge).
const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  location: 'readonly', localStorage: 'readonly', fetch: 'readonly',
  alert: 'readonly', console: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  getComputedStyle: 'readonly', MutationObserver: 'readonly',
  CustomEvent: 'readonly', Event: 'readonly', HTMLElement: 'readonly',
  Image: 'readonly', WebSocket: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', btoa: 'readonly', atob: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
};

const correctnessRules = {
  ...recommendedRules,
  // Intentional patterns in this codebase — not defects:
  'no-empty': ['error', { allowEmptyCatch: true }], // best-effort try/catch
  'no-control-regex': 'off',                          // family.js strips \x00-\x1f
  'no-constant-condition': ['error', { checkLoops: false }],
  // Legacy noise: report but don't fail the lane on these. Ignore unused
  // function arguments (common in callback/handler signatures) and _-prefixed
  // bindings; still warn on genuinely dead local variables.
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
  // ESLint 10 added these to recommended; preserve existing effective rules.
  'no-useless-assignment': 'off',
  'preserve-caught-error': 'off',
};

module.exports = [
  // .claude/** excludes nested git worktrees that can land inside this
  // directory (e.g. C:\...\electron\.claude\worktrees\<name>\electron\...) --
  // without this, eslint recurses into another worktree's copy of these same
  // filenames and reports it under the wrong (Node-globals) rule set.
  { ignores: ['node_modules/**', 'dist/**', 'dist-native/**', 'assets/**', 'test-results/**', 'build.log', '.claude/**'] },

  // Node main process, feature modules, preload, tests, build scripts.
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: correctnessRules,
  },

  // Browser-context renderer files (override: browser globals, script scope).
  // no-undef is unreliable here: the renderer attaches many helpers to `window`
  // and calls them bare, plus reads globals defined by sibling <script> files
  // (AmbientVisuals). That pattern is intentional, so scope no-undef off and let
  // no-dupe-keys / no-redeclare still do the real work.
  //
  // Expected noise: no-unused-vars lints each file independently, so a function
  // defined in renderer-utils.js and called only from renderer.js (or vice
  // versa) shows as "defined but never used" in the defining file. That is a
  // false positive of this split-file architecture, not dead code — check the
  // sibling file for a call site before "cleaning up" one of these warnings.
  {
    files: ['renderer.js', 'renderer-utils.js', 'renderer-profiles.js', 'renderer-calendar.js', 'renderer-receipts.js', 'renderer-family-remote.js', 'renderer-ritual-focus.js', 'renderer-settings.js', 'renderer-lastlight-alarm.js', 'renderer-onboarding-updater.js', 'renderer-night-modes.js', 'ambientVisuals.js', 'lastLight.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...browserGlobals, require: 'readonly', module: 'writable' },
    },
    rules: { ...correctnessRules, 'no-undef': 'off' },
  },

  // This config file itself is Node.
  {
    files: ['eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: nodeGlobals },
  },
];
