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

  // Focus tab
  await win.webContents.executeJavaScript(`
    (function(){
      var btn = document.querySelector('[data-tab="focus"]');
      if (btn) btn.click();
      return true;
    })();
  `);
  await wait(800);
  await capture(win, 'v9_focus.png');

  // Streaks tab (with sleep score)
  await win.webContents.executeJavaScript(`
    (function(){
      var btn = document.querySelector('[data-tab="streaks"]');
      if (btn) btn.click();
      return true;
    })();
  `);
  await wait(800);
  await capture(win, 'v9_streaks.png');

  // Settings (a real panel, see openSettingsPanel in renderer.js) - Protection
  // category shows WiFi Guard + Content Blocker.
  await win.webContents.executeJavaScript(`
    (function(){
      var btn = document.querySelector('[data-tab="library"]');
      if (btn) btn.click();
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
