'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../routineModel');
const fixture=()=>({format:'lights-out.routines',schemaVersion:1,routines:[{id:'night',name:'Night',actions:[
 {id:'timer',type:'timer.start',phase:'start',parameters:{seconds:600,endAction:'sleep'}}]}],rules:[{id:'week',routineId:'night',name:'Weeknight',schedule:{kind:'weekly',time:'22:00',weekdays:[1,2],monthDays:[],months:[2],date:null,timezone:'device-local',dstPolicy:'shift-forward-first'}}]});
test('portable v1 validates without runtime ownership and retains leap-day and timezone intent',()=>{
 const d=fixture();d.rules[0].schedule={...d.rules[0].schedule,kind:'monthly',monthDays:[29]};
 assert.deepEqual(model.interchange.parse(JSON.stringify(d)),d);assert.equal(model.matchesDate(d.rules[0].schedule,'2032-02-29'),true);
 assert.equal(model.matchesDate(d.rules[0].schedule,'2032-03-29'),false);
});
test('future/corrupt/unsafe/bounded payloads and dangling references fail closed',()=>{
 for(const edit of [d=>d.schemaVersion=2,d=>d.routines[0].actions[0].type='router.disable',d=>d.routines[0].actions[0].parameters.forceShutdown=true,
 d=>d.routines[0].actions[0].target='remote',d=>d.rules[0].routineId='missing',d=>d.rules[0].schedule.timezone='UTC',
 d=>d.rules[0].schedule.months=[2.5],d=>d.routines.push(structuredClone(d.routines[0])),d=>d.routines[0].id='../unsafe']){
  const d=fixture();edit(d);assert.throws(()=>model.interchange.parse(JSON.stringify(d)));
 }
 assert.throws(()=>model.interchange.parse('{bad'));assert.throws(()=>model.interchange.parse(' '.repeat(262145)));
 assert.throws(()=>model.interchange.parse(inputDuplicate()),/Duplicate JSON/);
});
function inputDuplicate(){return JSON.stringify(fixture()).replace('"schemaVersion":1','"schemaVersion":2,"schemaVersion":1');}
test('exports whitelist intent and replace WiZ endpoints with shared abstract slots',()=>{
 const routine={id:'phone',name:'Phone',seconds:600,brightness:30,offAtEnd:true,warmTargets:['192.168.1.2'],offTargets:['192.168.1.3'],targets:['192.168.1.2','192.168.1.3'],token:'NEVER',receiptHistory:['NEVER']};
 const exported=model.interchange.phoneExport({routines:[routine],rules:[]},['phone']);const json=JSON.stringify(exported);
 assert.doesNotMatch(json,/192\.168|NEVER|owner|receipt/);assert.deepEqual(exported.routines[0].actions[1].parameters.bindings,['light-1']);
 assert.deepEqual(exported.routines[0].actions[2].parameters.bindings,['light-2']);
});
test('duplicate imports reject by default; explicit copy remaps IDs and references without overwrites',()=>{
 const d=fixture(),existing={routines:['night'],rules:['week']};assert.throws(()=>model.interchange.prepare(d,existing,'reject',()=> 'copy'),/conflict/i);
 let n=0;const result=model.interchange.prepare(d,existing,'copy',()=> 'copy-'+(++n));
 assert.equal(result.routines[0].id,'copy-1');assert.equal(result.rules[0].id,'copy-2');assert.equal(result.rules[0].routineId,'copy-1');assert.equal(d.routines[0].id,'night');
 assert.deepEqual(result.routines[0].actions,d.routines[0].actions);
});
test('platform preview identifies unavailable endings and light bindings without conversion or execution',()=>{
 const d=fixture(),before=JSON.stringify(d);const preview=model.interchange.inspect(d,'android');
 assert.match(preview.routines[0].issues.join(' '),/reminder/i);assert.equal(JSON.stringify(d),before);
});
test('adopted light slot names survive export without exposing the local binding map',()=>{
 const d=model.interchange.phoneExport({routines:[{id:'bound',name:'Bound',seconds:600,targets:['127.0.0.1','127.0.0.2'],warmTargets:['127.0.0.1'],offTargets:['127.0.0.2'],brightness:30,offAtEnd:true,lightBindings:{bedside:'127.0.0.1',hall:'127.0.0.2'}}],rules:[]},['bound']);
 assert.deepEqual(d.routines[0].actions[1].parameters.bindings,['bedside']);assert.deepEqual(d.routines[0].actions[2].parameters.bindings,['hall']);assert.doesNotMatch(JSON.stringify(d),/127\.0/);
});
test('both platforms bundle the same transfer UI bytes',()=>{
 const fs=require('node:fs'),path=require('node:path');assert.deepEqual(fs.readFileSync(path.join(__dirname,'../routine-transfer-ui.js')),fs.readFileSync(path.join(__dirname,'../../companion-android/app/src/main/assets/phone/routine-transfer-ui.js')));
});
