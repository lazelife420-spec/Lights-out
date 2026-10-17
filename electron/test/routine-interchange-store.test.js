'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createStore}=require('../routineInterchangeStore');
const input=()=>JSON.stringify({format:'lights-out.routines',schemaVersion:1,routines:[{id:'night',name:'Night',actions:[{id:'my-timer',type:'timer.start',phase:'start',parameters:{seconds:600,endAction:'sleep'}}]}],rules:[{id:'date',routineId:'night',name:'Leap night',schedule:{kind:'once',time:'22:00',weekdays:[],monthDays:[],months:[2],date:'2032-02-29',timezone:'device-local',dstPolicy:'shift-forward-first'}}]});
function setup(){let disk={enabled:true,autoStartFromEvents:true,builtin:{rules:[]},unrelated:'preserved'},fail=false;const store=createStore({read:()=>disk,write:c=>{if(fail)throw Error('disk full');disk=c;},newId:()=> 'copy'});return{store,get:()=>disk,fail:()=>{fail=true;}};}
test('preview is read-only; import preserves all settings and saves inactive intent only',()=>{
 const r=setup(),before=JSON.stringify(r.get());r.store.preview(input());assert.equal(JSON.stringify(r.get()),before);
 r.store.import(input());assert.equal(r.get().portable.routines[0].adopted,false);assert.deepEqual(r.get().builtin.rules,[]);assert.equal(r.get().unrelated,'preserved');assert.throws(()=>r.store.timerOptions('night'));
});
test('explicit adoption creates disabled Test Mode rules on the existing engine and preserves action IDs',()=>{
 const r=setup();r.store.import(input());r.store.adopt({id:'night',seconds:600,endAction:'sleep'});
 const rule=r.get().builtin.rules[0];assert.equal(rule.enabled,false);assert.equal(rule.testMode,true);assert.equal(rule.plan.actions[0].id,'my-timer');
 assert.equal(rule.date,'2032-02-29');assert.equal(r.store.timerOptions('night').dryRun,true);
 assert.deepEqual(r.store.export([{kind:'portable',id:'night'}]),JSON.parse(input()));
});
test('storage failure during import/adoption leaves the previous document intact',()=>{
 for(const action of ['import','adopt']){const r=setup();if(action==='adopt')r.store.import(input());const before=JSON.stringify(r.get());r.fail();assert.throws(()=>action==='import'?r.store.import(input()):r.store.adopt({id:'night',seconds:600,endAction:'sleep'}));assert.equal(JSON.stringify(r.get()),before);}
});
test('conflicts cannot replace existing imports; explicit copies retain references',()=>{
 const r=setup();r.store.import(input());const before=JSON.stringify(r.get());assert.throws(()=>r.store.import(input()),/conflict/);assert.equal(JSON.stringify(r.get()),before);
 r.store.import(input(),'copy');assert.equal(r.get().portable.rules[1].routineId,'copy');
});
test('native rule edits are reflected in subsequent portable export',()=>{
 const r=setup();r.store.import(input());r.store.adopt({id:'night',seconds:600,endAction:'sleep'});r.get().builtin.rules[0].label='Renamed rule';
 assert.equal(r.store.export([{kind:'portable',id:'night'}]).rules[0].name,'Renamed rule');
});
test('standalone one-minute Windows profiles export without applying the calendar floor',()=>{
 const store=createStore({read:()=>({}),write:()=>{},getProfiles:()=>[{id:'short',name:'Short',mode:'duration',seconds:60,action:'sleep'}]});
 assert.equal(store.export([{kind:'profile',id:'short'}]).routines[0].actions[0].parameters.seconds,60);
});
