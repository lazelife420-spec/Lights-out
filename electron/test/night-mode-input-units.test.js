'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const nm=fs.readFileSync(path.join(__dirname,'../renderer-night-modes.js'),'utf8'),renderer=fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8');
function extract(source,name){let start=source.indexOf('function '+name+'(');assert(start>=0);if(source.slice(start-6,start)==='async ')start-=6;let i=source.indexOf('{',start),depth=1;const body=i++;while(depth&&i<source.length){if(source[i]==='{')depth++;if(source[i]==='}')depth--;i++;}return source.slice(start,body)+source.slice(body,i);}
for(const [unit,seconds,expectedUnit,expectedInput] of [['sec',900,'sec','900'],['min',5400,'min','90'],['min',90,'sec','90']]){
 test(`Use Tonight preserves ${seconds}s when the input uses ${unit}`,async()=>{
  const state={unit,running:false},input={value:'20'},mode={nightModeId:'sample',nightModeTitle:'Sample',durationSeconds:seconds,action:'sleep'};
  let routes=0,starts=0;
  const context=vm.createContext({state,els:{timerInput:input},nmSelectedId:'sample',nmCatalogue:[{id:'sample',status:'ready'}],api:{useNightModeTonight:async()=>({success:true,...mode}),startTimer:()=>{starts++;}},document:{querySelector:selector=>selector.includes('data-unit')?{click:()=>{state.unit='sec';}}:selector.includes('data-ns-tab')?{click:()=>{routes++;}}:null,getElementById:id=>id==='timer-input'?input:id==='ns-panel-lib'?null:{click:()=>{routes++;}}},render:()=>{},renderDetailTruth:()=>{},armNightMode:value=>{state.armedNightMode=value;},setAction:action=>{state.action=action;const actual=Number(input.value)*(state.unit==='sec'?1:60);if(actual!==state.armedNightMode.durationSeconds)state.armedNightMode=null;}});
  context.inputSeconds=()=>Number(input.value)*(state.unit==='sec'?1:60);
  vm.runInContext(extract(renderer,'setInputFromSeconds')+'\n'+extract(nm,'useTonight')+'\nthis.run=useTonight;',context);
  await context.run();assert.equal(state.unit,expectedUnit);assert.equal(String(input.value),expectedInput);assert.equal(state.armedNightMode.durationSeconds,seconds);assert.equal(starts,0);assert.equal(routes,1);assert.equal(state.running,false);
 });
}
