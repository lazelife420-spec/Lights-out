// Electron integration smoke. Launches the real renderer in a real Electron
// process (preload bridge + contextIsolation active) and verifies:
//   1. exactly one window opens and the electronAPI bridge is wired
//   2. the safety-critical idle startup invariant (AGENTS.md): default open is
//      idle, never an auto-started countdown
//   3. a full start -> pause -> resume -> cancel control cycle, driven over the
//      real IPC bridge in DRY-RUN so it can never trigger a power action
//
// Run with: npm run test:e2e
//
// Note: the app uses requestSingleInstanceLock(), so this must not run while
// another Lights Out instance is already open (it would hand off and quit).

const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

let app;
let page;

test.beforeAll(async () => {
  app = await electron.launch({ args: [path.join(__dirname, '..')] });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Wait until the renderer has wired itself up (Start control rendered).
  await page.locator('#btn-start').waitFor({ state: 'visible' });
});

test.afterAll(async () => {
  if (!app) return;
  // window-all-closed keeps the app alive in the tray, so allow a clean quit
  // before asking Playwright to close the process.
  try { await app.evaluate(({ app: electronApp }) => { electronApp.isQuitting = true; }); } catch { /* closing */ }
  await app.close();
});

test('opens exactly one window with the electronAPI bridge wired', async () => {
  expect(app.windows().length).toBe(1);
  const bridge = await page.evaluate(() => ({
    present: typeof window.electronAPI === 'object' && window.electronAPI !== null,
    hasStart: typeof window.electronAPI?.startTimer === 'function',
    hasCancel: typeof window.electronAPI?.cancelTimer === 'function'
  }));
  expect(bridge).toEqual({ present: true, hasStart: true, hasCancel: true });
});

test('starts idle: Start control visible and no countdown running', async () => {
  await expect(page.locator('#btn-start')).toBeVisible();
  const idle = await page.evaluate(() => ({
    running: document.body.classList.contains('is-running'),
    paused: document.body.classList.contains('is-paused')
  }));
  expect(idle).toEqual({ running: false, paused: false });
});

test('dry-run start -> pause -> resume -> cancel never fires a power action', async () => {
  // Start a long DRY-RUN timer over the real IPC bridge. dryRun is honored
  // end-to-end (main.js executePowerAction returns early on dryRun), so no
  // shutdown/sleep/restart can occur regardless of how the test ends.
  const started = await page.evaluate(() =>
    window.electronAPI.startTimer({ durationSeconds: 600, action: 'shutdown', dryRun: true })
  );
  expect(started.success).toBe(true);
  expect(started.state.running).toBe(true);
  expect(started.state.dryRun).toBe(true);

  // The renderer must react to the timer-update and reflect the running state.
  await page.waitForFunction(() => document.body.classList.contains('is-running'));

  const paused = await page.evaluate(() => window.electronAPI.pauseTimer());
  expect(paused.success).toBe(true);
  expect(paused.state.paused).toBe(true);

  const resumed = await page.evaluate(() => window.electronAPI.resumeTimer());
  expect(resumed.success).toBe(true);
  expect(resumed.state.paused).toBe(false);

  const cancelled = await page.evaluate(() => window.electronAPI.cancelTimer());
  expect(cancelled.success).toBe(true);

  // Back to idle in the UI.
  await page.waitForFunction(() => !document.body.classList.contains('is-running'));
  await expect(page.locator('#btn-start')).toBeVisible();
});
