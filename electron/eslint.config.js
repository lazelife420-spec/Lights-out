const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'build.log',
      'renderer.js',
      'ambientVisuals.js',
      'lastLight.js'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-case-declarations': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }]
    }
  }
];
