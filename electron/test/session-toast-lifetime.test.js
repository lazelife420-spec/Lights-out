'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8');
function functionSource(name){const start=source.indexOf('function '+name+'(');assert(start>=0);let i=source.indexOf('{',start),depth=1;const body=i++;while(depth&&i<source.length){if(source[i]==='{')depth++;if(source[i]==='}')depth--;i++;}return source.slice(start,body)+source.slice(body,i);}
test('a new session dismisses terminal status only, cancels its timers, and retains history/errors',()=>{
  const removed=[],cleared=[],history=['Session cancelled','Current error'];
  const status={_dismissTimer:1,_removeTimer:2,remove(){removed.push('old session');}};
  const error={remove(){removed.push('error');}};
  const context=vm.createContext({document:{querySelectorAll(selector){assert.equal(selector,'.toast[data-session-outcome="true"]');return [status];}},clearTimeout:id=>cleared.push(id),notificationFeed:history,currentError:error});
  vm.runInContext(functionSource('dismissSessionOutcomeToasts')+';dismissSessionOutcomeToasts();',context);
  assert.deepEqual(removed,['old session']);assert.deepEqual(cleared,[1,2]);assert.deepEqual(history,['Session cancelled','Current error']);
});
test('every terminal feedback source opts into session scope and canonical starts dismiss it',()=>{
  for(const message of ['Timer complete','Session cancelled','Test Mode skipped the power action']){
    const line=source.split('\n').find(s=>s.includes('notify(')&&s.includes(message));
    assert.match(line,/sessionOutcome: true/,message);
  }
  const started=source.slice(source.indexOf("} else if (data.type === 'started')"));
  assert.match(started.slice(0,220),/dismissSessionOutcomeToasts\(\)/);
  const success=source.slice(source.indexOf('async function startTimer('),source.indexOf('async function cancelTimer('));
  assert(success.indexOf('dismissSessionOutcomeToasts()')>success.indexOf('result?.success === false'));
});
