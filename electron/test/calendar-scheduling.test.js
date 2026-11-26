'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const vm=require('node:vm'), fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const check=source.match(/async function checkCalendarAutoStart\(\) \{[\s\S]*?\n\}/)[0];
const now=Date.UTC(2026,9,15,5,30);
function runtime(events,options={}) {
  const calendar={enabled:true,autoStartFromEvents:true,...options.calendar};
  const starts=[];const clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  const context={Date:clock,Set,Boolean,Math,calendarAutoStartBusy:false,calendarStartedOccurrences:new Set(),
    calendarCheckedThrough:options.checkedThrough??null,CALENDAR_START_MAX_LATENESS_MS:5*60*1000,
    settingsStore:{getSection:name=>name==='calendar'?calendar:{dryRun:options.dryRun!==false},updateSection:(name,patch)=>Object.assign(calendar,patch)},
    isRunActive:()=>false,calProviders:{fetchAllEvents:async()=>events,eventTimeIsTrusted:require('../calendarProviders').eventTimeIsTrusted},isBedtimeEvent:()=>true,
    profiles:{getById:id=>options.profile?.id===id?options.profile:null},
    startTimer:input=>{starts.push(input);return {success:true};},showNativeNotification:()=>{},getEventTitle:()=>''};
  vm.createContext(context);vm.runInContext(check+';globalThis.checkCalendar=checkCalendarAutoStart;',context);
  return {context,calendar,starts};
}
const event=(offset=0)=>({uid:'night',source:'builtin',start:new Date(now+offset).toISOString(),end:new Date(now+900000).toISOString(),action:'sleep'});
test('scheduled timers wait until their time and do not repeat after cancellation or restart',async()=>{
  const early=runtime([event(60000)]);await early.context.checkCalendar();assert.equal(early.starts.length,0);
  const due=runtime([event(-20000)]);await due.context.checkCalendar();await due.context.checkCalendar();assert.equal(due.starts.length,1);
  const restarted=runtime([event(-20000)],{calendar:due.calendar});await restarted.context.checkCalendar();assert.equal(restarted.starts.length,0);
});
test('scheduled saved routines keep Test Mode and never inherit forced shutdown',async()=>{
  const run=runtime([{...event(-1000),profileId:'routine'}],{dryRun:false,profile:{id:'routine',dryRun:true,forceShutdown:true}});
  await run.context.checkCalendar();assert.equal(run.starts.length,1);assert.equal(run.starts[0].profileId,'routine');
  assert.equal(run.starts[0].dryRun,true);assert.equal(run.starts[0].forceShutdown,false);assert.equal(run.starts[0].origin,'calendar');
});
test('a deleted assigned routine is skipped rather than replaced',async()=>{
  const run=runtime([{...event(-1000),profileId:'missing'}]);await run.context.checkCalendar();assert.equal(run.starts.length,0);
});

test('failed calendar writes restore saved rules and do not poison the next save',async()=>{
  const renderer=fs.readFileSync(path.join(__dirname,'../renderer-calendar.js'),'utf8');
  const persist=renderer.match(/async function persistScheduleRules\(\) \{[\s\S]*?\n\}/)[0];
  const notifications=[];let fetches=0;
  const context={JSON,Promise,scheduleRules:[{id:'unsaved'}],savedScheduleRules:[{id:'saved'}],scheduleSaveRevision:0,scheduleSaveChain:Promise.resolve(),
    api:{saveCalendarSettings:async()=>{throw new Error('simulated disk failure');}},renderScheduleRules:()=>{},renderArmState:()=>{},
    fetchAndRenderEvents:async()=>{fetches++;},notify:(text,type)=>notifications.push({text,type})};
  vm.createContext(context);vm.runInContext(persist+';globalThis.persist=persistScheduleRules;',context);
  assert.equal(await context.persist(),false);assert.equal(context.scheduleRules[0].id,'saved');assert.equal(fetches,0);assert.equal(notifications[0].type,'error');
  context.api.saveCalendarSettings=async()=>({});context.scheduleRules=[{id:'retry'}];
  assert.equal(await context.persist(),true);assert.equal(context.savedScheduleRules[0].id,'retry');assert.equal(fetches,1);
});

test('manual Schedule starts use the assigned routine and honour its Test Mode',async()=>{
  const renderer=fs.readFileSync(path.join(__dirname,'../renderer-calendar.js'),'utf8');
  const start=renderer.match(/async function startFromScheduleEvent\(evt\) \{[\s\S]*?\n\}/)[0];
  const calls=[];const notices=[];
  const context={Date,Boolean,Number,Math,state:{settingsLoaded:true,profiles:[{id:'assigned',dryRun:true}],dryRun:false,graceMinutes:2},
    els:{timerInput:{max:1440}},calBuiltinAction:'sleep',api:{startTimer:async options=>{calls.push(options);return{success:true};}},
    schClock:()=> '23:45',actionLabel:()=> 'Sleep',notify:(text,tone)=>notices.push({text,tone})};
  vm.createContext(context);vm.runInContext(start+';globalThis.start=startFromScheduleEvent;',context);
  const evt={profileId:'assigned',start:new Date(Date.now()+300000).toISOString(),end:new Date(Date.now()+900000).toISOString()};
  assert.equal(await context.start(evt),true);assert.equal(calls[0].profileId,'assigned');assert.equal(calls[0].dryRun,true);assert.equal(calls[0].forceShutdown,false);
  assert.equal(calls[0].startOrigin,'profile-start');assert.match(notices[0].text,/Test Mode/);
  assert.equal(await context.start({...evt,profileId:'deleted'}),false);assert.equal(calls.length,1);
});

// v11.3 audit: a slow fetch or a skipped poll must not drop an event that
// started between two checks; a slept-through event stays missed.
test('an event that started since the last check is still started after a slow poll', async () => {
  const late = runtime([event(-150000)], { checkedThrough: now - 200000 });
  await late.context.checkCalendar();
  assert.equal(late.starts.length, 1, '2.5 min old event inside the watermark window starts');
  assert.equal(late.context.calendarCheckedThrough, now, 'the watermark advances to this check');
});
test('without an older watermark the window stays the usual last minute', async () => {
  const fresh = runtime([event(-150000)]);
  await fresh.context.checkCalendar();
  assert.equal(fresh.starts.length, 0);
});
test('an event the PC slept through is never started on wake, whatever the watermark', async () => {
  const slept = runtime([event(-2 * 3600 * 1000)], { checkedThrough: now - 3 * 3600 * 1000 });
  await slept.context.checkCalendar();
  assert.equal(slept.starts.length, 0, 'older than the 5-minute bound');
  const edge = runtime([event(-6 * 60 * 1000)], { checkedThrough: now - 10 * 60 * 1000 });
  await edge.context.checkCalendar();
  assert.equal(edge.starts.length, 0);
});
test('a failed fetch does not advance the watermark, so the next check catches up', async () => {
  const failing = runtime([]);
  failing.context.calProviders.fetchAllEvents = async () => { throw new Error('offline'); };
  failing.context.calendarCheckedThrough = now - 90000;
  await failing.context.checkCalendar();
  assert.equal(failing.context.calendarCheckedThrough, now - 90000);
});
