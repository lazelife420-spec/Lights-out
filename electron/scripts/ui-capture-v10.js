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

  // 2. Simulate dim phase with ambient visuals
  await win.webContents.executeJavaScript(`
    (function(){
      document.body.classList.add('warm-shift');
      document.body.classList.add('phase-dim');
      // Start fireplace ambient
      if (typeof AmbientVisuals !== 'undefined') {
        AmbientVisuals.init(document.getElementById('ambient-canvas'));
        AmbientVisuals.start('fireplace');
      }
      // Simulate a running timer
      document.getElementById('setup-controls').style.display = 'none';
      document.getElementById('action-bar-running').style.display = '';
      document.getElementById('timer-main').textContent = '18:42';
      document.getElementById('timer-label').textContent = 'until shutdown';
      document.getElementById('timer-name').textContent = 'Last Call';
      // Show status pill as "Winding Down"
      var pill = document.querySelector('.status-pill');
      if (pill) { pill.textContent = 'Winding Down'; pill.className = 'status-pill phase-dim'; }
      return true;
    })();
  `);
  await wait(2000);
  await capture(win, 'v10_dim_fireplace.png');

  // 3. Customize panel with Calendar / Idle / Bedtime / Ambient settings
  await win.webContents.executeJavaScript(`
    (function(){
      // Reset dim phase
      document.body.classList.remove('warm-shift');
      document.body.classList.remove('phase-dim');
      if (typeof AmbientVisuals !== 'undefined') AmbientVisuals.stop();
      document.getElementById('setup-controls').style.display = '';
      document.getElementById('action-bar-running').style.display = 'none';
      document.getElementById('timer-main').textContent = '28:20';
      document.getElementById('timer-label').textContent = 'until shutdown';
      // Open options modal and scroll to customize
      document.getElementById('options-modal').classList.add('active');
      // Click the Library tab to make sure we're on the right tab
      var libTab = document.querySelector('[data-tab="library"]');
      if (libTab) libTab.click();
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
