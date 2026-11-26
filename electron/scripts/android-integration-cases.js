'use strict';
// Invoked only after the lifecycle runner verifies emulator ownership, APK,
// source inventory and the disposable debug package. No physical endpoints.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function integration(c){
  const {adb,args,pkg,prefs,state,message,launch,disconnect,watchSnapshots,evaluate,wait,sleep,passed,proofRoot}=c;
  assert.equal(args['allow-emulator-clock-change'],true);
  await adb(['shell','pm','clear-permission-flags',pkg,'android.permission.POST_NOTIFICATIONS','user-fixed','user-set']);
  await adb(['shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS']);
  await adb(['shell','appops','set','--uid',pkg,'SCHEDULE_EXACT_ALARM','allow']);
  await launch();await watchSnapshots();
  const routine={id:'qa-integration',name:'Integration reminder',seconds:600,targets:[],brightness:0,offAtEnd:false};
  await message({action:'saveRoutine',routine});
  const date=await evaluate(`(()=>{const d=new Date();d.setMinutes(d.getMinutes()+5,0,0);return {date:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),time:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};})()`);
  const rule={id:'qa-integration-rule',routineId:routine.id,kind:'once',enabled:true,...date};
  await message({action:'saveRule',rule});
  await wait('calendar scheduled',async()=>(await prefs('phone_calendar')).scheduled?.includes(rule.id));
  await message({action:'start',seconds:600});const before=await state();assert.equal(before.phase,'running');
  const boot=Number((await adb(['shell','settings','get','global','boot_count'])).stdout.trim());
  await disconnect();await adb(['reboot']);
  await wait('owned emulator reboot',async()=>Number((await adb(['shell','settings','get','global','boot_count'])).stdout.trim())>boot&&(await adb(['shell','getprop','sys.boot_completed'])).stdout.trim()==='1',180000);
  await adb(['shell','input','keyevent','KEYCODE_WAKEUP']);await adb(['shell','wm','dismiss-keyguard']);
  const restored=await wait('boot receiver restores timer',async()=>{const t=await state();return t?.boot>before.boot&&t;},30000);
  assert.equal(restored.runId,before.runId);assert.equal(restored.phase,'running');assert.equal(restored.endWall,before.endWall);assert.ok(restored.endElapsed<before.endElapsed);
  await wait('calendar restored at boot',async()=>(await prefs('phone_calendar')).scheduled?.includes(rule.id));
  const alarms=(await adb(['shell','dumpsys','alarm'])).stdout;assert.ok(alarms.includes('com.lightsout.TIMER_END'),'native timer alarm missing');
  const intents=(await adb(['shell','dumpsys','activity','intents'])).stdout;
  assert.ok(intents.includes('lightsout://phone-calendar/qa-integration-rule'),'calendar PendingIntent missing');
  passed('actual emulator reboot restores the same timer and native calendar alarm before UI launch',{runId:restored.runId,bootBefore:boot,bootAfter:restored.boot,endWall:restored.endWall});
  await launch();await watchSnapshots();assert.equal(await evaluate('window.__qaSnapshot.paired'),false);
  passed('standalone phone remains unpaired and works without a PC server');
  await adb(['shell','appops','set','--uid',pkg,'SCHEDULE_EXACT_ALARM','deny']);await launch();await watchSnapshots();
  await wait('exact access revoked',()=>evaluate('window.__qaSnapshot.exact===false'));
  assert.deepEqual((await prefs('phone_calendar')).scheduled,[]);assert.equal((await state()).runId,before.runId);
  await adb(['shell','appops','set','--uid',pkg,'SCHEDULE_EXACT_ALARM','allow']);await launch();await watchSnapshots();
  await wait('exact grant reschedules',async()=>(await prefs('phone_calendar')).scheduled?.includes(rule.id));
  passed('revocation removes precise calendar alarms; regrant restores them without replacing the timer');
  const occurrence=await wait('next occurrence',()=>evaluate('window.__qaSnapshot.upcoming.find(r=>r.id==="qa-integration-rule")?.next'));
  const auto=(await adb(['shell','settings','get','global','auto_time'])).stdout.trim(),wall=Number((await adb(['shell','date','+%s'])).stdout.trim())*1000,host=Date.now();
  try{
    await adb(['shell','settings','put','global','auto_time','0']);await adb(['shell','cmd','alarm','set-time',String(occurrence+1000)]);
    await wait('busy occurrence recorded',async()=>{const xml=(await adb(['shell','run-as',pkg,'cat','shared_prefs/phone_home.xml'])).stdout;return xml.includes('timer-active');});
    const current=await state();assert.equal(current.runId,before.runId);assert.equal(current.endElapsed,restored.endElapsed);
    await wait('skipped snapshot',()=>evaluate('window.__qaSnapshot.routineOutcomes.some(r=>r.reason==="timer-active"&&r.status==="skipped")'));
    const skipped=await evaluate('window.__qaSnapshot.routineOutcomes.find(r=>r.reason==="timer-active")');
    assert.ok(skipped.actions.every(a=>a.status==='skipped'));
    const result=await adb(['shell','run-as',pkg,'am','startservice','--user','0','-n',pkg+'/com.lightsout.companion.PhoneTimerService','-a','calendar','--es','ruleId',rule.id,'--el','wall',String(occurrence)]);assert.doesNotMatch(result.stdout+result.stderr,/Error|Exception|Permission Denial/);await sleep(700);
    assert.equal((await state()).runId,before.runId);assert.equal(await evaluate('window.__qaSnapshot.routineOutcomes.filter(r=>r.reason==="timer-active").length'),1);
    passed('busy timer skips and durably deduplicates a real alarm occurrence with accurate action receipts',{skipped});
  }finally{await adb(['shell','cmd','alarm','set-time',String(wall+Date.now()-host)]);await adb(['shell','settings','put','global','auto_time',auto]);}
  await message({action:'cancel'});assert.equal((await state()).phase,'idle');
  await evaluate(`(()=>{window.__qaErrors=[];const oldError=window.phoneUI.error;window.phoneUI.error=text=>{window.__qaErrors.push(text);oldError(text);};window.__qaReplies={};const oldReply=window.phoneTransferReply;window.phoneTransferReply=(id,reply)=>{window.__qaReplies[id]=reply;oldReply?.(id,reply);};})()`);
  let request=0;async function transfer(action,extra){const requestId='qa-'+(++request);await message({action,requestId,...extra});return wait('native transfer reply',()=>evaluate('window.__qaReplies['+JSON.stringify(requestId)+']'));}
  const doc={format:'lights-out.routines',schemaVersion:1,routines:[{id:'qa-windows-intent',name:'Windows sleep intent',actions:[{id:'timer',type:'timer.start',phase:'start',parameters:{seconds:600,endAction:'sleep'}}]}],rules:[]};
  require('../routineModel').interchange.validate(doc);const text=JSON.stringify(doc),saved=(await prefs('phone_home')).config,timer=await state();
  const preview=await transfer('routineFilePreview',{text});assert.equal(preview.ok,true);assert.match(preview.result.routines[0].issues.join(' '),/phone reminder/);assert.deepEqual((await prefs('phone_home')).config,saved);
  for(const invalid of [JSON.stringify({...doc,schemaVersion:2}),'{broken',text.replace('"schemaVersion":1','"schemaVersion":2,"schemaVersion":1'),JSON.stringify({...doc,routines:[{...doc.routines[0],actions:[{...doc.routines[0].actions[0],type:'router.disable'}]}]})]){const reply=await transfer('routineFilePreview',{text:invalid});assert.equal(reply.ok,false);assert.ok(reply.error);assert.deepEqual((await prefs('phone_home')).config,saved);}
  assert.equal((await transfer('routineFileImport',{text,policy:'reject'})).ok,true);const imported=(await prefs('phone_home')).config;assert.equal(imported.portable.routines[0].adopted,false);assert.deepEqual(imported.portable.routines[0].intent,doc.routines[0]);assert.deepEqual(await state(),timer);
  assert.equal((await transfer('routineFileImport',{text,policy:'reject'})).ok,false);assert.deepEqual((await prefs('phone_home')).config,imported);
  passed('native Android interchange previews Windows intent, rejects four invalid formats, saves inactive intent and rejects duplicate imports',{invalidFormats:4,automaticStarts:0});
  fs.writeFileSync(path.join(proofRoot,'windows-to-android-intent.json'),text+'\n');
  await wiz(c);
};
async function wiz(c){
  const {report,prefs,message,evaluate,wait,passed,proofRoot}=c;
  await evaluate(`(()=>{if(window.__qaErrors){window.__qaErrors.length=0;return;}window.__qaErrors=[];const oldError=window.phoneUI.error;window.phoneUI.error=text=>{window.__qaErrors.push(text);oldError(text);};})()`);
  await message({action:'saveLights',targets:['127.0.0.1','127.0.0.2']});
  const server=await require('./android-wiz-guest-fixture')(c);
  try{
    async function command(command,target='127.0.0.1'){await message({action:'lightCommand',command,targets:[target]});return wait('native WiZ result',async()=>{const event=(await prefs('phone_home')).event;return event&&!/Waiting/.test(event)&&event;},8000);}
    const status=await command('status');assert.match(status,/127\.0\.0\.1: on/);passed('direct native WiZ status observes the controlled loopback responder');
    await server.setMode('ack');const ack=await command('warm');assert.match(ack,/acknowledged/);passed('direct native WiZ positive acknowledgement is reported accurately');
    for(const mode of ['negative','no-ack','malformed','timeout']){await server.setMode(mode);const result=await command('off');assert.match(result,/no acknowledgement/);assert.doesNotMatch(result,/: acknowledged/);passed('direct native WiZ '+mode+' is a failure, never success',{result});}
    const unreachable=await command('on','127.0.0.2');assert.match(unreachable,/no acknowledgement/);passed('unreachable guest loopback target fails safely');
    const config=(await prefs('phone_home')).config,count=server.record.requests.length;
    await message({action:'saveLights',targets:['8.8.8.8']});assert.deepEqual((await prefs('phone_home')).config,config);
    await message({action:'lightCommand',command:'off',targets:['8.8.8.8']});assert.equal(server.record.requests.length,count);assert.ok((await evaluate('window.__qaErrors')).length>=2);
    passed('invalid public targets are rejected without changing configuration or sending packets');
  }finally{await server.close();fs.writeFileSync(path.join(proofRoot,'controlled-wiz-packets.json'),JSON.stringify({...server.record,physicalLights:0},null,2));}
  assert.deepEqual(report.rendererErrors,[]);
}
module.exports.wiz=wiz;
