// v10.0.0 screenshot capture.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const outDir = path.join(__dirname, '..', 'assets');
const wait = ms => new Promise(r => setTimeout(r, ms));

async function capture(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, name), img.toPNG());
  console.log('wrote', name);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 520, height: 760, show: true });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await wait(2000);

  // 1. Ready state (main timer)
  await capture(win, 'v10_ready.png');

  // 2. Simulate dim phase with ambient visuals. The phase is driven through
  // renderer state (render() strips phase-* body classes on every tick, so a
  // forced class never survives): a 28 min run, 2 min grace, 18:42 left.
  await win.webContents.executeJavaScript(`
    (function(){
      document.body.classList.add('warm-shift');
      if (typeof state !== 'undefined') {
        state.running = true; state.paused = false; state.phase = 'dim';
        state.totalSeconds = 1680; state.remainingSeconds = 1122;
        state.runGraceMinutes = 2; state.action = 'shutdown';
        state.endsAt = new Date(Date.now() + 1122000).toISOString();
      }
      if (typeof render === 'function') render();
      // Start fireplace ambient
      if (typeof AmbientVisuals !== 'undefined') {
        AmbientVisuals.init(document.getElementById('ambient-canvas'));
        AmbientVisuals.start('fireplace');
      }
      return true;
    })();
  `);
  await wait(2000);
  await capture(win, 'v10_dim_fireplace.png');

  // 3. Customize panel with Calendar / Idle / Bedtime / Ambient settings
  await win.webContents.executeJavaScript(`
    (function(){
      // Reset dim phase (through state, like the shot above)
      document.body.classList.remove('warm-shift');
      if (typeof AmbientVisuals !== 'undefined') AmbientVisuals.stop();
      if (typeof state !== 'undefined') {
        state.running = false; state.paused = false; state.phase = 'idle';
        state.runGraceMinutes = null; state.endsAt = null;
      }
      if (typeof render === 'function') render();
      // Open Settings (a real panel, see openSettingsPanel in renderer.js)
      // on the Appearance & Sound category, which holds Customize.
      if (typeof openSettingsPanel === 'function') openSettingsPanel();
      if (typeof switchSettingsCategory === 'function') switchSettingsCategory('appearance');
      // Scroll to the customize section
      var cz = document.querySelector('.customize-section');
      if (cz) cz.scrollIntoView({block:'start'});
      // Set ambient to fireplace to show selection
      var ambientSel = document.getElementById('cz-ambient');
      if (ambientSel) ambientSel.value = 'fireplace';
      // Check the new toggles
      var chkIdle = document.getElementById('chk-idle-detect');
      if (chkIdle) chkIdle.checked = true;
      var chkBed = document.getElementById('chk-bedtime-reminder');
      if (chkBed) chkBed.checked = true;
      var chkCal = document.getElementById('chk-calendar-autostart');
      if (chkCal) chkCal.checked = true;
      return true;
    })();
  `);
  await wait(1000);
  await capture(win, 'v10_customize_new_toggles.png');

  app.quit();
}).catch(err => { console.error(err); app.exit(1); });
setTimeout(() => { console.error('timeout'); app.exit(1); }, 30000);
