'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),m=require('../lightExperience');
test('Light experiences default off with independent explicit alert choices',()=>{
 assert.deepEqual(m.normalize(),{timerMode:'off',brightness:35,timerAlerts:false,appAlerts:false});
 assert.equal(m.normalize({timerAlerts:true}).appAlerts,false);assert.equal(m.normalize({appAlerts:true}).timerAlerts,false);
 assert.equal(m.normalize({timerMode:'invented',brightness:999}).timerMode,'off');
});
test('Timer frames are bounded intent and never carry power or execution fields',()=>{
 for(const mode of m.modes)for(let p=0;p<=1;p+=.02)for(let i=0;i<8;i++){
  const f=m.frame(mode,{progress:p,elapsedSeconds:p*7200,index:i,count:8,brightness:60});if(mode==='off'){assert.equal(f,null);continue;}
  assert.deepEqual(Object.keys(f).sort(),['b','dimming','g','r']);assert.ok(f.dimming>=10&&f.dimming<=60);
  for(const k of ['r','g','b'])assert.ok(Number.isInteger(f[k])&&f[k]>=0&&f[k]<=255);
 }
});
test('Hourglass drains lights in order and Orbital animation is deterministic',()=>{
 const f=i=>m.frame('hourglass',{progress:.5,index:i,count:4,brightness:50}).dimming;
 assert.equal(f(0),10);assert.equal(f(1),10);assert.equal(f(2),50);assert.equal(f(3),50);
 assert.deepEqual(m.frame('orbit',{progress:.2,elapsedSeconds:48}),m.frame('orbit',{progress:.2,elapsedSeconds:24}));
 assert.equal(m.frame('unsupported'),null);
});
test('Notification beacon has a finite six-second envelope without power-on intent',()=>{
 assert.equal(m.beacon({elapsedSeconds:6}),null);assert.equal(m.beacon({elapsedSeconds:100}),null);
 for(let t=0;t<6;t+=.1){const f=m.beacon({elapsedSeconds:t,brightness:100,index:5,count:8});assert.ok(f.dimming>=10&&f.dimming<=60);assert.equal('state' in f,false);}
});
