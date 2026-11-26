'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const WebSocket=require('ws');
const root=process.argv[2],cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let page;for(let i=0;i<100;i++){try{page=(await(await fetch(`http://127.0.0.1:${cfg.Port}/json/list`)).json()).find(p=>p.type==='page');}catch{}if(page)break;await delay(100);}assert(page,'QA page not ready');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});let id=0;const pending=new Map();
 ws.on('message',raw=>{const m=JSON.parse(raw);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error('QA control timeout')),7000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result?.value;};
 try{
  for(let i=0;i<100;i++){if(await evaluate(`typeof state!=='undefined'&&state.settingsLoaded===true`))break;await delay(100);}
  assert(fs.readFileSync(path.join(cfg.DataRoot||root,'startup.log'),'utf8').includes('"qaPowerLock":true'),'Guard required before REAL-path test');assert.equal(await evaluate('!state.dryRun&&!state.running&&!state.smartLights.enabled'),true);
  await send('Input.setIgnoreInputEvents',{ignore:true});
  const seconds=cfg.DurationSeconds||30,unit=cfg.Unit||'sec',amount=unit==='min'?seconds/60:seconds,action=cfg.Action||'sleep';
  await evaluate(`(()=>{document.querySelector('[data-unit="${unit}"]').click();const input=document.getElementById('timer-input');input.value=${JSON.stringify(String(amount))};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action="${action}"]').click();document.getElementById('ns-play-btn').click();})()`);
  await delay(3000);await evaluate(`document.getElementById('btn-close').click();true`);
  const status=await evaluate(`({running:state.running,dryRun:state.dryRun,remainingSeconds:state.remainingSeconds,totalSeconds:state.totalSeconds,endsAt:state.endsAt,action:state.action})`);assert(status.running&&!status.dryRun);assert.equal(status.totalSeconds,seconds);assert.equal(status.action,action);fs.writeFileSync(path.join(root,'controller-result.json'),JSON.stringify({at:new Date().toISOString(),...status,controllerDisconnectsNow:true},null,2)+'\n');
  console.log(JSON.stringify({variant:cfg.Variant,...status,controller:'disconnected before completion'}));
 }finally{ws.close();}
 fs.writeFileSync(path.join(root,'release-job.flag'),'release only the owned launcher job');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
