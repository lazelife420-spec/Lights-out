// Quick UI capture for v9.1.0.
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
  const win = new BrowserWindow({
    width: 520,
    height: 760,
    show: true,
    webPreferences: { offscreen: true }
  });

  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await wait(1500);
  await capture(win, 'v9_cockpit.png');

  // Focus Sessions: Settings > Automations (UI-R3 P10 moved them off Schedule)
  await win.webContents.executeJavaScript(`
    (function(){
      var nav = document.getElementById('nav-set');
      if (nav) nav.click();
      var rail = document.querySelector('.settings-rail-btn[data-settings-category="automations"]');
      if (rail) rail.click();
      var sec = document.querySelector('.focus-section');
      if (sec) sec.scrollIntoView({block:'start'});
      return true;
    })();
  `);
  await wait(800);
  await capture(win, 'v9_focus.png');

  // Streaks (with the routine score): Proof > Routine (UI-R3 P10)
  await win.webContents.executeJavaScript(`
    (function(){
      var nav = document.getElementById('nav-stats');
      if (nav) nav.click();
      var routine = document.getElementById('proof-routine');
      if (routine) routine.scrollIntoView({block:'start'});
      return true;
    })();
  `);
  await wait(800);
  await capture(win, 'v9_streaks.png');

  // Settings (a real panel, see openSettingsPanel in renderer.js) - Protection
  // category shows WiFi Guard + Content Blocker.
  await win.webContents.executeJavaScript(`
    (function(){
      if (typeof openSettingsPanel === 'function') openSettingsPanel();
      if (typeof switchSettingsCategory === 'function') switchSettingsCategory('protection');
      var sec = document.querySelector('.wifi-guard-section');
      if (sec) sec.scrollIntoView({block:'start'});
      return true;
    })();
  `);
  await wait(800);
  await capture(win, 'v9_wifiguard.png');

  // Accountability category
  await win.webContents.executeJavaScript(`
    (function(){
      if (typeof switchSettingsCategory === 'function') switchSettingsCategory('accountability');
      var sec = document.querySelector('.accountability-section');
      if (sec) sec.scrollIntoView({block:'start'});
      return true;
    })();
  `);
  await wait(600);
  await capture(win, 'v9_accountability.png');

  // Warning modal with override button
  await win.webContents.executeJavaScript(`
    (function(){
      if (typeof closeSettingsPanel === 'function') closeSettingsPanel();
      if (typeof showWarningModal === 'function') showWarningModal('Shutdown in 2 minutes');
      return true;
    })();
  `);
  await wait(600);
  await capture(win, 'v9_warning_override.png');

  app.quit();
}).catch(err => {
  console.error(err);
  app.exit(1);
});

setTimeout(() => { console.error('timeout'); app.exit(1); }, 25000);
