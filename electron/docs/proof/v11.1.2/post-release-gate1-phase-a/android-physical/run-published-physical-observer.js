'use strict';

// Phase A evidence-only wrapper. It executes the repository's existing
// packaged-phone proof against the frozen public EXE while replacing two
// environment-specific assumptions in memory and adding observational checks.
// Product/runtime/test source is not modified.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../../../../../scripts/packaged-phone-smoke.js');
let source = fs.readFileSync(sourcePath, 'utf8');

source = source.replace(
  "const proofDir = path.join(root, 'dist', 'review-proof');",
  `const proofDir = ${JSON.stringify(__dirname)};`
);

source = source.replace(
  "assert.equal(connected.lanIp, '192.168.0.11');",
  "assert.match(connected.lanIp, /^192\\.168\\.0\\.\\d+$/);"
);

source = source.replace(
  "const initialRemote = await desktop.evaluate(`electronAPI.getRemoteControl()`);",
  `const appSettings = await desktop.evaluate(\`electronAPI.getAppSettings()\`);
    appSettings.app.dryRun = true;
    await desktop.evaluate(\`electronAPI.saveAppSettings(\${JSON.stringify(appSettings)})\`);
    const initialRemote = await desktop.evaluate(\`electronAPI.getRemoteControl()\`);`
);

source = source.replace(
  "const started = await desktop.evaluate(`electronAPI.startTimer({ durationSeconds: 600, action: 'shutdown', dryRun: true, force: false, source: 'manual' })`);",
  `const catalogue = await waitFor(async () => {
      const value = await phone.evaluate(\`nmCatalogue.map(mode => ({ id: mode.id, title: mode.title, status: mode.status }))\`);
      return value.length === 6 ? value : null;
    });
    assert.deepEqual(catalogue.map(mode => mode.id), [
      'quick-sleep', 'lights-down', 'movie-wind-down', 'full-shutdown', 'quiet-house', 'school-night'
    ]);
    assert.deepEqual(catalogue.map(mode => mode.status), [
      'ready', 'ready', 'ready', 'ready', 'coming_soon', 'needs_router_setup'
    ]);
    await phone.evaluate(\`nightModeToggle.click(); true\`);
    await waitFor(() => phone.evaluate(\`document.querySelectorAll('.night-mode-card').length === 6\`));
    const unavailable = await phone.evaluate(\`[...document.querySelectorAll('.night-mode-card.disabled')].map(card => ({ title: card.querySelector('.night-mode-name')?.textContent, tabindex: card.getAttribute('tabindex') }))\`);
    assert.deepEqual(unavailable, [
      { title: 'Quiet House', tabindex: '-1' },
      { title: 'School Night', tabindex: '-1' }
    ]);

    const readyModeReceipts = [];
    for (const modeId of catalogue.filter(mode => mode.status === 'ready').map(mode => mode.id)) {
      console.log('Night Mode start: ' + modeId);
      await phone.evaluate(\`openNightModeDetail(\${JSON.stringify(modeId)}); true\`);
      await waitFor(() => phone.evaluate(\`document.getElementById('night-mode-backdrop').classList.contains('show') && !nmDetailStart.disabled\`));
      await phone.evaluate(\`nmDetailStart.click(); true\`);
      await waitFor(() => phone.evaluate(\`latestState && (latestState.running || latestState.paused) && latestState.nightModeId === \${JSON.stringify(modeId)}\`), 30000);
      const receipt = await desktop.evaluate(\`electronAPI.getLatestReceipt()\`);
      assert.equal(receipt.nightModeId, modeId);
      assert.equal(receipt.dryRun, true);
      readyModeReceipts.push({ id: receipt.nightModeId, title: receipt.nightModeTitle, action: receipt.action, dryRun: receipt.dryRun });
      console.log('Night Mode receipt: ' + modeId);
      await desktop.evaluate(\`electronAPI.cancelTimer()\`);
      await waitFor(() => phone.evaluate(\`latestState && !latestState.running && !latestState.paused\`));
      await phone.evaluate(\`document.getElementById('nm-detail-close')?.click(); true\`);
    }
    console.log('Canonical Night Modes: ' + JSON.stringify({ catalogue, readyModeReceipts }));

    const started = await desktop.evaluate(\`electronAPI.startTimer({ durationSeconds: 600, action: 'shutdown', dryRun: true, force: false, source: 'manual' })\`);`
);

source = source.replace(
  "assert.ok(updateTwo < updateOne);",
  `assert.ok(updateTwo < updateOne);
    const receiptsBeforeDuplicate = await desktop.evaluate(\`electronAPI.listReceipts(100)\`);
    const remainingBeforeDuplicate = await phone.evaluate(\`latestState.remainingSeconds\`);
    assert.equal(await phone.evaluate(\`send({ action: 'start', durationSeconds: 60, timerAction: 'shutdown' })\`), true);
    await new Promise(resolve => setTimeout(resolve, 1200));
    const receiptsAfterDuplicate = await desktop.evaluate(\`electronAPI.listReceipts(100)\`);
    const remainingAfterDuplicate = await phone.evaluate(\`latestState.remainingSeconds\`);
    const duplicateObservation = {
      receiptDelta: receiptsAfterDuplicate.length - receiptsBeforeDuplicate.length,
      remainingBefore: remainingBeforeDuplicate,
      remainingAfter: remainingAfterDuplicate,
      supersededActiveRun: receiptsAfterDuplicate.length === receiptsBeforeDuplicate.length + 1 && remainingAfterDuplicate <= 60
    };
    assert.equal(duplicateObservation.supersededActiveRun, true);
    console.log('Duplicate start observation: ' + JSON.stringify(duplicateObservation));`
);

source = source.replace(
  "phoneForward = null;\n    await adb(['shell', 'am', 'force-stop', androidPackage]);\n    await adb(['shell', 'monkey', '-p', androidPackage, '-c', 'android.intent.category.LAUNCHER', '1']);",
  `phoneForward = null;
    const receiptsBeforeWrapperRestart = await desktop.evaluate(\`electronAPI.listReceipts(100)\`);
    await adb(['shell', 'am', 'force-stop', androidPackage]);
    await adb(['shell', 'monkey', '-p', androidPackage, '-c', 'android.intent.category.LAUNCHER', '1']);`
);

source = source.replace(
  "await capturePhone('physical-phone-reconnected.png');",
  `await capturePhone('physical-phone-reconnected.png');
    const receiptsAfterWrapperRestart = await desktop.evaluate(\`electronAPI.listReceipts(100)\`);
    assert.equal(receiptsAfterWrapperRestart.length, receiptsBeforeWrapperRestart.length);
    const replayState = await phone.evaluate(\`({ running: latestState.running, paused: latestState.paused, pending: pendingOperation })\`);
    assert.deepEqual(replayState, { running: false, paused: false, pending: null });
    const pairingToken = privateUrl.searchParams.get('t');
    const phoneLogs = (await adb(['logcat', '-d', '-t', '2000', '-v', 'brief'])).stdout;
    assert.equal(phoneLogs.includes(pairingToken), false);
    const desktopLogFiles = fs.readdirSync(userData, { recursive: true }).filter(item => /\\.(log|json)$/i.test(String(item)));
    const desktopLogs = desktopLogFiles.map(item => {
      try { return fs.readFileSync(path.join(userData, item), 'utf8'); } catch { return ''; }
    }).join('\\n');
    assert.equal(desktopLogs.includes(pairingToken), false);
    console.log('Reconnect replay: none; token leakage: none observed');`
);

const observer = new Module(sourcePath, module);
observer.filename = sourcePath;
observer.paths = Module._nodeModulePaths(path.dirname(sourcePath));
observer._compile(source, sourcePath);
