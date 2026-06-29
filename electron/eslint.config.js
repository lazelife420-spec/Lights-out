// Flat ESLint config for the Lights Out Electron edition.
// Surfaces with different globals: main process (Node/CommonJS), renderer
// (browser + the electronAPI preload bridge), dual-context UMD scripts that load
// both via require() and <script>, and tests (Node + node:test).

const globals = require('globals');

const sharedRules = {
  'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true, caughtErrors: 'none' }],
  'no-undef': 'error',
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-cond-assign': ['error', 'except-parens'],
  'no-fallthrough': 'error',
  'no-unsafe-negation': 'error',
  'no-unreachable': 'error',
  'valid-typeof': 'error',
  eqeqeq: ['warn', 'smart']
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'assets/**',
      'scripts/ui-capture*.js',
      'scripts/proof-capture.js',
      'scripts/polish-capture.js'
    ]
  },

  // Main process + feature modules (Node, CommonJS).
  {
    files: ['**/*.js'],
    ignores: ['renderer.js', 'lastLight.js', 'ambientVisuals.js', 'test/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: sharedRules
  },

  // Dual-context UMD scripts: required by main.js AND loaded via <script> in the
  // renderer, so they legitimately reference both Node and browser globals.
  {
    files: ['lastLight.js', 'ambientVisuals.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: sharedRules
  },

  // Renderer (browser context + the preload-exposed window.electronAPI plus the
  // globals attached by the dual-context scripts above).
  //
  // no-undef is disabled here: renderer.js is a ~5k-line non-module <script> that
  // shares globals across multiple script files and assigns handlers via
  // `window.x = ...`. ESLint's scope analysis cannot see cross-file browser
  // globals and mis-scopes some top-level declarations, producing false positives.
  // Every other rule (unused vars, unreachable, etc.) still applies.
  {
    files: ['renderer.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        electronAPI: 'readonly',
        LastLight: 'readonly',
        AmbientVisuals: 'readonly',
        require: 'readonly',
        module: 'writable'
      }
    },
    rules: { ...sharedRules, 'no-undef': 'off' }
  },

  // Tests (Node + node:test runner; some use custom runners).
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: sharedRules
  }
];
