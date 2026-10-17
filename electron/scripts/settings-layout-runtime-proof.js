'use strict';

// Real Electron UI with isolated settings; no LAN checks or physical actions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { requirePackagedArtifact } = require('./packaged-artifact-resolver');
const source = process.argv.includes('--source');
const artifact = source ? { executable: require('electron'), proofDir: path.resolve(__dirname, '../../review/SETTINGS-POLISH-20261016') } : requirePackagedArtifact();
const proofDir = process.env.LIGHTS_OUT_SETTINGS_PROOF_DIR
  ? path.resolve(process.env.LIGHTS_OUT_SETTINGS_PROOF_DIR) : path.join(artifact.proofDir, 'settings-layout');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-settings-layout-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], errors = [];
let child, ws;

async function until(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await wait(100); }
  throw new Error(message);
}

async function main() {
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
    app: { dryRun: true, onboarded: true, sound: 'Off' }, companion: { enabled: false }, family: { enabled: false },
    smartLights: { provider: 'wiz', enabled: false, wizAddresses: ['127.0.0.1'],
      wizDevices: [{ ip: '127.0.0.1', name: 'Bedside', room: 'Bedroom' }, { ip: '127.0.0.2', name: 'Desk', room: 'Bedroom' }],
      wizLook: { mode: 'color', brightness: 30, color: '#ff8000' } }
  }));
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--disable-gpu', '--no-auto-start'];
  if (source) args.unshift(path.resolve(__dirname, '..'));
  child = spawn(artifact.executable, args, { windowsHide: true, stdio: 'ignore', env: { ...process.env, LIGHTS_OUT_SUPPRESS_TRAY: '1', LIGHTS_OUT_QA_POWER_LOCK: '1' } });
  let page;
  await until(async () => {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page'); return Boolean(page); }
    catch { return false; }
  }, 'Electron page did not become ready');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let id = 0; const pending = new Map();
  ws.on('message', data => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (!pending.has(message.id)) return;
    const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  };
  await send('Runtime.enable');
  await until(() => evaluate(`typeof api !== 'undefined' && state.settingsLoaded === true`), 'Settings did not load');
  await evaluate(`document.querySelector('[data-ns-tab="set"]').click()`);
  const categories = ['general','power-safety','wind-down','lighting','phone','protection','accountability','automations','appearance','advanced'];
  for (const theme of ['midnight', 'dawn']) {
    await evaluate(`state.customization.theme=${JSON.stringify(theme)};applyCustomization(state.customization);document.getElementById('cz-theme').value=${JSON.stringify(theme)}`);
    for (const [width, height] of [[900, 640], [1120, 760], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await wait(120);
      for (const category of categories) {
        await evaluate(`document.querySelector('.settings-rail-btn[data-settings-category="${category}"]').click()`);
        await wait(50);
        const layout = await evaluate(`(() => {
          const content=document.getElementById('settings-categories'),rail=document.querySelector('.settings-rail'),footer=document.querySelector('.set-footer');
          const rect=footer.getBoundingClientRect(), active=document.querySelector('.settings-rail-btn[aria-current="page"]');
          const sections=[...content.querySelectorAll('.option-section.settings-category-active')];
          return { overflow:content.scrollWidth-content.clientWidth,railOverflow:rail.scrollHeight-rail.clientHeight,
            footerVisible:rect.bottom<=innerHeight&&rect.top>=0,contentAboveFooter:content.getBoundingClientRect().bottom<=rect.top+1,
            active:active?.dataset.settingsCategory,sections:sections.length,title:document.getElementById('settings-category-title').textContent,
            hiddenVisible:[...document.querySelectorAll('#ns-panel-set [hidden]')].filter(node=>node.getClientRects().length).length };
        })()`);
        assert.ok(layout.overflow <= 1, `${theme} ${width} ${category} overflow ${layout.overflow}`);
        assert.ok(layout.footerVisible && layout.contentAboveFooter, `${theme} ${width} ${category}: footer overlap`);
        assert.equal(layout.active, category); assert.ok(layout.sections > 0);
        assert.equal(layout.hiddenVisible, 0, 'Hidden settings controls must remain hidden');
        if (['general','power-safety','lighting','appearance'].includes(category)) {
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(proofDir, `${theme}-${width}-${category}.png`), Buffer.from(shot.data, 'base64'));
        }
        if (height === 640) assert.ok(layout.railOverflow <= 1, `Minimum-height navigation clips ${layout.railOverflow}px`);
        if (category === 'lighting' && width !== 1120) {
          await evaluate(`document.getElementById('wiz-look-mode').scrollIntoView({block:'start'})`);
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(proofDir, `${theme}-${width}-wiz-look.png`), Buffer.from(shot.data, 'base64'));
        }
        results.push({ theme, width, height, category, ...layout });
      }
    }
  }
  await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true})); })()`);
  assert.equal(await evaluate(`document.activeElement.id`), 'settings-search');
  await evaluate(`(() => { const input=document.getElementById('settings-search'); input.value='WiZ'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
  assert.equal(await evaluate(`document.querySelector('.settings-rail-btn.active').dataset.settingsCategory`), 'lighting');
  await evaluate(`(() => { const input=document.getElementById('settings-search'); input.value='force'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); })()`);
  assert.equal(await evaluate(`document.activeElement.id`), 'settings-search');
  assert.equal(await evaluate(`document.getElementById('ns-panel-set').style.display === 'none'`), false);
  await evaluate(`(() => {const nav=document.querySelector('.settings-rail-btn.active');nav.focus();nav.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));})()`);
  assert.equal(await evaluate(`document.querySelector('.settings-rail-btn.active').dataset.settingsCategory`), 'advanced');
  await evaluate(`openSettingsCategory('lighting'); document.querySelector('[data-light-provider="wiz"]').click(); document.querySelector('[data-light-mode="orbit"]').click(); true`);
  await until(() => evaluate(`document.querySelector('[data-light-mode="orbit"]').getAttribute('aria-pressed')==='true'`), 'Mode card did not select Orbit');
  assert.equal(await evaluate(`document.getElementById('sel-light-mode').value`), 'orbit');
  assert.equal(await evaluate(`document.getElementById('light-dim-timing').hidden`), true);
  await evaluate(`document.getElementById('btn-save-opt').click(); true`);
  await until(() => evaluate(`!document.getElementById('ns-panel-set').classList.contains('is-dirty')`), 'Mode save did not settle');
  await evaluate(`openSettingsCategory('lighting'); true`);
  await until(() => evaluate(`document.getElementById('wiz-mode-preview').getClientRects().length>0`), 'Saved mode did not reopen');
  await evaluate(`(() => { const range=document.getElementById('wiz-mode-preview-progress'); range.value=70; range.dispatchEvent(new Event('input',{bubbles:true})); range.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  assert.equal(await evaluate(`document.getElementById('ns-panel-set').classList.contains('is-dirty')`), false, 'Screen-only preview must not count as a settings edit');
  assert.equal(await evaluate(`document.getElementById('wiz-preview-progress-value').value`), '70%');
  for (const theme of ['midnight', 'dawn']) {
    await evaluate(`state.customization.theme=${JSON.stringify(theme)};applyCustomization(state.customization); true`);
    for (const width of [900, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate(`document.querySelector('.light-mode-grid').scrollIntoView({block:'start'}); true`);
      await wait(300);
      assert.equal(await evaluate(`document.querySelector('.light-mode-grid').scrollWidth>document.querySelector('.light-mode-grid').clientWidth`), false);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(proofDir, `${theme}-${width}-mode-cards.png`), Buffer.from(shot.data, 'base64'));
    }
  }
  await evaluate(`document.querySelector('[data-light-provider="hue"]').click(); true`);
  assert.equal(await evaluate(`document.getElementById('wiz-targets').hidden`), true);
  assert.equal(await evaluate(`document.getElementById('wiz-config').getClientRects().length`), 0);
  assert.equal(await evaluate(`document.querySelector('#sel-light-mode option[value="orbit"]').disabled`), true);
  await evaluate(`document.getElementById('sel-light-mode').value='gradual_dim';document.getElementById('sel-light-mode').dispatchEvent(new Event('change',{bubbles:true})); true`);
  assert.equal(await evaluate(`document.getElementById('light-dim-timing').hidden`), false);
  assert.deepEqual(errors, []);
  await evaluate(`document.getElementById('btn-cancel-opt').click();true`);
  const shellLayouts = [];
  for (const theme of ['midnight', 'dawn']) {
    await evaluate(`state.customization.theme=${JSON.stringify(theme)};applyCustomization(state.customization); true`);
    for (const [width, height] of [[900,640],[1440,900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      for (const tab of ['lib','modes','sch','devices','stats','help']) {
        await evaluate(`handleSidebarNavigation(${JSON.stringify(tab)}, {persist:false,focusNav:false}).then(()=>true)`);
        await evaluate(`document.activeElement?.blur();true`);
        await wait(500);
        const layout = await evaluate(`(() => { const section=document.getElementById('${tab === 'help' ? 'about-modal' : 'ns-panel-' + tab}'), nav=[...document.querySelectorAll('.ns-nav-label')]; return {visible:section.getClientRects().length>0, overflow:section.scrollWidth-section.clientWidth, navClipped:nav.some(n=>n.scrollWidth>n.clientWidth+1), pageOverflow:document.documentElement.scrollWidth-innerWidth}; })()`);
        if (width === 1440 || tab === 'lib') {
          const shot=await send('Page.captureScreenshot',{format:'png'});
          fs.writeFileSync(path.join(proofDir,`${theme}-${width}-shell-${tab}.png`),Buffer.from(shot.data,'base64'));
        }
        assert.ok(layout.visible && layout.overflow<=1 && layout.pageOverflow<=1 && !layout.navClipped, `${theme} ${width} ${tab}: ${JSON.stringify(layout)}`);
        if (tab === 'lib') assert.ok(await evaluate(`document.getElementById('ns-play-btn').getBoundingClientRect().bottom<=innerHeight-40`), 'Start action must fit on Tonight');
        shellLayouts.push({theme,width,height,tab,...layout});
        if (tab === 'help') await evaluate(`document.getElementById('about-modal-close').click();true`);
      }
    }
  }
  await evaluate(`state.customization.theme='midnight';applyCustomization(state.customization);handleSidebarNavigation('lib',{persist:false,focusNav:false}).then(()=>true)`);
  await send('Emulation.setDeviceMetricsOverride', { width:1440,height:900,deviceScaleFactor:1,mobile:false });
  assert.equal(await evaluate(`state.smartLights.enabled`), false, 'UI proof must leave real lighting disabled');
  const started=await evaluate(`window.electronAPI.startTimer({durationSeconds:600,action:'sleep',dryRun:true,forceShutdown:false,muteSystem:false,gracePeriod:0,profileId:null,nightModeId:'',origin:'this-pc'})`);
  assert.equal(started.success,true);
  await until(()=>evaluate(`state.running===true`),'Dry-run timer did not start');
  const timerStates=[];
  for(const phase of ['running','paused']) {
    if(phase==='paused') { await evaluate('window.electronAPI.pauseTimer()');await until(()=>evaluate('state.paused===true'),'Timer did not pause'); }
    const layout=await evaluate(`(()=>{const r=document.getElementById('btn-stop').getBoundingClientRect(),time=document.getElementById('timer-main');return {cancelVisible:r.top>=0&&r.bottom<=innerHeight-40,readoutVisible:time.getClientRects().length>0,overflow:document.documentElement.scrollWidth-innerWidth}})()`);
    assert.ok(layout.cancelVisible&&layout.readoutVisible&&layout.overflow<=1,`${phase}: ${JSON.stringify(layout)}`);
    timerStates.push({phase,...layout});
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(proofDir,`timer-${phase}.png`),Buffer.from(shot.data,'base64'));
  }
  await evaluate('window.electronAPI.toggleMiniMode();true');await until(()=>evaluate('document.body.classList.contains("mini-mode")'),'Mini mode did not open');
  await send('Emulation.setDeviceMetricsOverride',{width:260,height:320,deviceScaleFactor:1,mobile:false});
  const mini=await evaluate(`(()=>{const r=document.getElementById('btn-stop').getBoundingClientRect();return {cancelVisible:r.top>=0&&r.bottom<=innerHeight,headingHidden:!document.querySelector('.studio-tonight-head').getClientRects().length,overflow:document.documentElement.scrollWidth-innerWidth}})()`);
  const miniShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(proofDir,'timer-mini.png'),Buffer.from(miniShot.data,'base64'));
  if (mini.overflow>1) console.log('Mini overflow elements: '+JSON.stringify(await evaluate(`Array.from(document.querySelectorAll('body *')).filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}))`)));
  assert.ok(mini.cancelVisible&&mini.headingHidden&&mini.overflow<=1,JSON.stringify(mini));timerStates.push({phase:'mini-paused',...mini});
  await evaluate('window.electronAPI.toggleMiniMode();true');await until(()=>evaluate('!document.body.classList.contains("mini-mode")'),'Mini mode did not close');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate('window.electronAPI.resumeTimer()');await until(()=>evaluate('state.running&&!state.paused'),'Timer did not resume');
  await evaluate('window.electronAPI.cancelTimer()');await until(()=>evaluate('!state.running&&!state.paused'),'Timer did not cancel');
  // The full-screen clock deliberately remains idle-only so timer controls
  // can never be hidden by it during a live session.
  await evaluate('window.electronAPI.setFullScreenClock(true)');
  await until(()=>evaluate('document.body.classList.contains("fullscreen-clock-mode")'),'Full-screen clock did not open');
  const clock=await evaluate(`(()=>{const r=document.getElementById('btn-fullscreen-clock-exit').getBoundingClientRect();return {exitVisible:r.width>0&&r.top>=0&&r.bottom<=innerHeight,headingHidden:!document.querySelector('.studio-tonight-head').getClientRects().length,sidebarHidden:!document.querySelector('.ns-sidebar').getClientRects().length}})()`);
  assert.ok(clock.exitVisible&&clock.headingHidden&&clock.sidebarHidden,JSON.stringify(clock));timerStates.push({phase:'native-fullscreen-clock',...clock});
  const clockShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(proofDir,'timer-fullscreen.png'),Buffer.from(clockShot.data,'base64'));
  await evaluate('document.getElementById("btn-fullscreen-clock-exit").click();true');await until(()=>evaluate('!document.body.classList.contains("fullscreen-clock-mode")'),'Full-screen clock did not close');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(proofDir, 'report.json'), JSON.stringify({ source, executable: artifact.executable, layouts: results, shellLayouts, timerStates, lighting: ['mode-card selection','staged save','passive preview leaves no unsaved changes','provider isolation','mode-specific timing'], keyboard: ['Ctrl K','WiZ search + Enter','Escape from search results keeps Settings open','End selects last category'], runtimeErrors: errors }, null, 2));
  console.log(`PASS ${results.length} category/theme/viewport layouts, footer visibility, no horizontal overflow and minimum-height navigation`);
  console.log('PASS search, keyboard navigation, focus and runtime error checks');
  console.log('PASS mode cards, staged save, passive preview, mode timing and provider isolation');
  console.log(`PASS ${shellLayouts.length} app page/theme/viewport layouts and unclipped navigation`);
  console.log('PASS actual dry-run timer start/pause/resume/cancel, mini controls and native full-screen clock');
  console.log(`Report: ${path.join(proofDir, 'report.json')}`);
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (ws) ws.close();
  if (child && child.exitCode === null) await new Promise(resolve => {
    const killer=spawn('taskkill.exe',['/F','/T','/PID',String(child.pid)],{windowsHide:true,stdio:'ignore'});killer.once('exit',resolve);killer.once('error',resolve);
  });
});
