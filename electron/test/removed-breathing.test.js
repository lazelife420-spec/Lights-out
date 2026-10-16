'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../ritualMode.js'),'utf8');
function ritual(config={}) {
  const context={module:{exports:{}},require:()=>({getSection:()=>config}),Date,setTimeout,clearTimeout};
  vm.runInNewContext(source,context);return context.module.exports;
}
test('default routines contain no breathing step',()=>{
  const engine=ritual();assert.equal(engine.DEFAULT_STEPS.some(step=>step.id==='breathe'),false);
  assert.deepEqual(Array.from(engine.DEFAULT_STEPS,step=>step.id),['block','dim','timer','lights']);
});
test('old saved and custom breathing steps are removed before a routine starts',()=>{
  const engine=ritual({steps:[{id:'breathe'},{id:'timer',auto:false}]});
  assert.equal(engine.startRitual().currentStepInfo.id,'timer');engine.cancelRitual();
  assert.equal(engine.startRitual([{id:'breathe'},{id:'lights',auto:false}]).currentStepInfo.id,'lights');engine.cancelRitual();
});
test('a legacy breathing-only routine does not start a timer or get stuck active',()=>{
  const engine=ritual({steps:[{id:'breathe'}]});let steps=0;engine.onStep(()=>steps++);
  const result=engine.startRitual();assert.equal(result.active,false);assert.equal(result.reason,'no-steps');assert.equal(steps,0);
});
