// Playwright config for the Electron integration lane.
// Specs live in ./e2e (NOT ./test) so Node's `--test` runner never tries to
// execute Playwright specs as node:test files.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']]
});
