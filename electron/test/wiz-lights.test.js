'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const dgram=require('node:dgram');
const wiz=require('../wizLights');

async function bulb(t, respond) {
  const server=dgram.createSocket('udp4');
  await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  server.on('message',(packet,remote)=>{const request=JSON.parse(packet);respond(request,reply=>server.send(Buffer.from(JSON.stringify(reply)),remote.port,remote.address));});
  return server.address().port;
}
test('WiZ addresses are bounded, deduplicated, and confined to the local network',()=>{
  assert.deepEqual(wiz.normalizeAddresses('192.168.0.18, 192.168.0.18; 10.0.0.2 8.8.8.8 nope 192.168.0.255'),['10.0.0.2','192.168.0.18']);
  assert.equal(wiz.isLocalAddress('8.8.8.8'),false);assert.equal(wiz.isLocalAddress('255.255.255.255'),false);
});
test('WiZ getPilot verifies status over real UDP without sending a light change',async t=>{
  const commands=[];
  const port=await bulb(t,(command,send)=>{commands.push(command.method);send({method:command.method,result:{state:true,mac:'aabbccddeeff'}});});
  const response=await wiz.request('127.0.0.1','getPilot',{}, {port});
  assert.equal(response.success,true);assert.deepEqual(commands,['getPilot']);
});
test('WiZ discovery finds responders and exposes no MAC addresses',async t=>{
  const port=await bulb(t,(command,send)=>send({method:command.method,result:{state:true,mac:'aabbccddeeff'}}));
  const lights=await wiz.discover({broadcasts:['127.0.0.1'],port,timeoutMs:80});
  assert.deepEqual(lights,[{ip:'127.0.0.1',on:true}]);
});
test('WiZ ignores unrelated packets and requires a confirmed setPilot result',async t=>{
  const port=await bulb(t,(command,send)=>{send({method:'unrelated',result:{success:true}});send({method:command.method,result:{success:false}});});
  const response=await wiz.request('127.0.0.1','setPilot',{state:false},{port,timeoutMs:80});
  assert.equal(response.success,false);assert.equal(response.code,'DEVICE_REJECTED');
});
test('WiZ reports timeout and device error as failures',async t=>{
  const port=await bulb(t,()=>{});
  assert.equal((await wiz.request('127.0.0.1','getPilot',{}, {port,timeoutMs:35})).code,'TIMEOUT');
  assert.equal((await wiz.request('8.8.8.8','setPilot')).code,'INVALID_ADDRESS');
});
test('WiZ brightness and temperature use percentage and Kelvin, with real off',()=>{
  assert.deepEqual(wiz.pilotState({brightness:127,colorTemp:500}),{state:true,dimming:50,temp:2200});
  assert.deepEqual(wiz.pilotState({brightness:1}),{state:true,dimming:10});
  assert.deepEqual(wiz.pilotState({brightness:0}),{state:false});
});
test('WiZ verification belongs to the exact device list, and disabled automation stays blocked',async t=>{
  const smart=require('../smartLights');const original=wiz.verify;
  wiz.verify=async()=>({success:true,code:'VERIFIED',message:'Connected'});t.after(()=>{wiz.verify=original;});
  smart.loadConfig({provider:'wiz',wizAddresses:['192.168.0.18'],enabled:false});
  const verified=await smart.verifySmartLightConnection();assert.equal(verified.verifiedConfigKey,'wiz:192.168.0.18');
  smart.loadConfig({enabled:true,verifiedConfigKey:verified.verifiedConfigKey});assert.equal(smart.getConfig().enabled,true);
  smart.loadConfig({wizAddresses:['192.168.0.19'],enabled:true,verifiedConfigKey:verified.verifiedConfigKey});assert.equal(smart.getConfig().enabled,false);
  assert.equal((await smart.invokeSmartLightAction()).code,'DISABLED');
});
test('WiZ dimming starts from current brightness, leaves off lights off, and restores their state over UDP',async t=>{
  const writes=[];
  const port=await bulb(t,(command,send)=>{if(command.method==='getPilot')send({method:'getPilot',result:{state:true,dimming:40,temp:3000,mac:'aabbccddeeff'}});else{writes.push(command.params);send({method:'setPilot',result:{success:true}});}});
  const snapshot=await wiz.readStates(['127.0.0.1'],{port});
  const off={ip:'127.0.0.2',pilot:{state:false}};
  assert.equal((await wiz.dimStates([...snapshot,off],0.5,false,{port})).success,true);
  assert.deepEqual(writes,[{dimming:20}]);
  assert.equal((await wiz.restoreStates(snapshot,{port})).success,true);
  assert.deepEqual(writes[1],{dimming:40,temp:3000});
});
test('WiZ cancellation preserves an in-flight snapshot after timer state resets',async t=>{
  const smart=require('../smartLights'),originalRead=wiz.readStates,originalRestore=wiz.restoreStates;
  const snapshot=[{ip:'192.168.0.18',pilot:{state:true,dimming:35}}];let release;let restored;
  wiz.readStates=()=>new Promise(resolve=>{release=resolve;});
  wiz.restoreStates=async value=>{restored=value;return{success:true};};
  t.after(()=>{wiz.readStates=originalRead;wiz.restoreStates=originalRestore;smart.resetSmartLightState();});
  smart.loadConfig({provider:'wiz',mode:'gradual_dim',wizAddresses:['192.168.0.18'],enabled:true,verifiedConfigKey:'wiz:192.168.0.18'});
  smart.startSmartLightDim(300);await new Promise(resolve=>setImmediate(resolve));
  const restore=smart.restoreWizOriginalState();smart.resetSmartLightState();release(snapshot);await restore;
  assert.deepEqual(restored,snapshot);
});

test('WiZ phone off yields the light for the run and cancel never turns it back on', async t => {
  let on = true; const writes = [];
  const port = await bulb(t, (command, send) => {
    if (command.method === 'getPilot') send({ method: 'getPilot', result: { state: on, dimming: 60 } });
    else { writes.push(command.params); send({ method: 'setPilot', result: { success: true } }); }
  });
  const snapshot = await wiz.readStates(['127.0.0.1'], { port });
  await wiz.dimStates(snapshot, .1, false, { port });
  on = false; // WiZ phone app switches off mid-countdown.
  await wiz.dimStates(snapshot, .2, false, { port });
  await wiz.restoreStates(snapshot, { port });
  assert.deepEqual(writes, [{ dimming: 54 }]);
  on = true; // Manual on again still belongs to the user for this run.
  await wiz.dimStates(snapshot, .3, true, { port });
  assert.equal(writes.length, 1);
});

test('WiZ cancel observes an off command that arrives before the next dim tick', async t => {
  let on = true; const writes = [];
  const port = await bulb(t, (command, send) => {
    if (command.method === 'getPilot') send({ method: 'getPilot', result: { state: on, dimming: 40 } });
    else { writes.push(command.params); send({ method: 'setPilot', result: { success: true } }); }
  });
  const snapshot = await wiz.readStates(['127.0.0.1'], { port });
  await wiz.dimStates(snapshot, .25, false, { port });
  on = false;
  await wiz.restoreStates(snapshot, { port });
  assert.deepEqual(writes, [{ dimming: 30 }]);
});

test('WiZ dim never asserts power on even if the phone switches off between read and write', async t => {
  let on = true; const writes = [];
  const port = await bulb(t, (command, send) => {
    if (command.method === 'getPilot') {
      send({ method: 'getPilot', result: { state: on, dimming: 40 } });
      on = false; // Simulate the race immediately after the live read.
    } else {
      writes.push(command.params);
      if (command.params.state !== undefined) on = command.params.state;
      send({ method: 'setPilot', result: { success: true } });
    }
  });
  const snapshot = [{ ip: '127.0.0.1', pilot: { state: true, dimming: 40 } }];
  await wiz.dimStates(snapshot, .5, false, { port });
  assert.deepEqual(writes, [{ dimming: 20 }]); assert.equal(on, false);
});

test('WiZ skips writes when a live read times out or the run is disabled during the read', async t => {
  let current = true; const writes = [];
  const port = await bulb(t, (command, send) => {
    if (command.method === 'getPilot') { current = false; send({ method: 'getPilot', result: { state: true } }); }
    else { writes.push(command); send({ method: 'setPilot', result: { success: true } }); }
  });
  const snapshot = [{ ip: '127.0.0.1', pilot: { state: true, dimming: 40 } }];
  await wiz.dimStates(snapshot, .5, false, { port }, { isCurrent: () => current });
  const silentPort = await bulb(t, command => { if (command.method === 'setPilot') writes.push(command); });
  assert.equal((await wiz.dimStates(snapshot, .5, false, { port: silentPort, timeoutMs: 30 })).success, false);
  assert.deepEqual(writes, []);
});

test('WiZ applies a chosen scene once, dims from its brightness, and restores the original look', async t => {
  const writes = [];
  const port = await bulb(t, (command, send) => {
    if (command.method === 'getPilot') send({ method: 'getPilot', result: { state: true, dimming: 70, temp: 4000 } });
    else { writes.push(command.params); send({ method: 'setPilot', result: { success: true } }); }
  });
  const snapshot = await wiz.readStates(['127.0.0.1'], { port });
  const look = { mode: 'scene', brightness: 40, sceneId: 16 };
  await wiz.dimStates(snapshot, .25, false, { port }, { look });
  await wiz.dimStates(snapshot, .5, false, { port }, { look });
  await wiz.restoreStates(snapshot, { port });
  assert.deepEqual(writes, [{ dimming: 30, sceneId: 16 }, { dimming: 20 }, { dimming: 70, temp: 4000 }]);
});

test('WiZ custom color and white do not send conflicting color modes; values are bounded', () => {
  assert.deepEqual(wiz.pilotState({ brightness: 127, look: { mode: 'color', color: '#ff0080' } }), { state: true, dimming: 50, r: 255, g: 0, b: 128 });
  assert.deepEqual(wiz.lookPilot({ mode: 'white', temperature: 9900 }), { temp: 6500 });
  assert.deepEqual(wiz.lookPilot({ mode: 'scene', sceneId: 14 }), { sceneId: 14 });
  assert.deepEqual(wiz.lookPilot({ mode: 'current' }), {});
  assert.equal(wiz.normalizeLook({ brightness: -10 }).brightness, 10);
  assert.equal(wiz.normalizeLook(null).mode, 'current');
  assert.deepEqual(wiz.normalizeDevices([{ ip: '8.8.8.8', name: 'bad' }, { ip: '192.168.0.2', name: ' Desk\n', room: 'Bedroom' }], ['192.168.0.3']),
    [{ ip: '192.168.0.3', name: '', room: '' }, { ip: '192.168.0.2', name: 'Desk', room: 'Bedroom' }]);
});

test('WiZ applies the saved look to selected lights only and keeps unselected room metadata', async t => {
  const smart = require('../smartLights'), originalSet = wiz.setLights;
  const calls = []; wiz.setLights = async (...args) => { calls.push(args); return { success: true }; };
  t.after(() => { wiz.setLights = originalSet; smart.loadConfig({ enabled: false }); });
  smart.loadConfig({ provider: 'wiz', enabled: false, wizAddresses: ['192.168.0.2'],
    wizDevices: [{ ip: '192.168.0.2', room: 'Bedroom', name: 'Desk' }, { ip: '192.168.0.3', room: 'Kitchen', name: 'Counter' }],
    wizLook: { mode: 'color', color: '#ff0080', brightness: 30 } });
  assert.equal((await smart.testSmartLightAction()).success, true);
  assert.deepEqual(calls[0][0], ['192.168.0.2']);
  assert.equal(calls[0][1].look.color, '#ff0080');
  assert.equal(calls[0][1].brightness, 76);
  assert.equal(smart.getPublicConfig().wizDevices.length, 2);
});

test('WiZ timer completion leaves released lights under manual control', async t => {
  const smart = require('../smartLights'), originalRead = wiz.readStates, originalDim = wiz.dimStates, originalSet = wiz.setLights;
  const snapshot = [{ ip: '192.168.0.2', pilot: { state: true }, released: true }]; const writes = [];
  wiz.readStates = async () => snapshot; wiz.dimStates = async () => ({ success: true });
  wiz.setLights = async (...args) => { writes.push(args); return { success: true }; };
  t.after(() => { wiz.readStates = originalRead; wiz.dimStates = originalDim; wiz.setLights = originalSet; smart.loadConfig({ enabled: false }); });
  smart.loadConfig({ provider: 'wiz', enabled: true, mode: 'gradual_dim', wizAddresses: ['192.168.0.2'], verifiedConfigKey: 'wiz:192.168.0.2' });
  smart.startSmartLightDim(300); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await smart.invokeSmartLightOff()).success, true); assert.deepEqual(writes, []);
});

test('WiZ sunrise yields to phone off after its initial wake action', async t => {
  let on = false; const writes = [];
  const port = await bulb(t, (command, send) => {
    if (command.method === 'getPilot') send({ method: 'getPilot', result: { state: on } });
    else {
      writes.push(command.params); if (command.params.state !== undefined) on = command.params.state;
      send({ method: 'setPilot', result: { success: true } });
    }
  });
  const released = new Set();
  await wiz.setLights(['127.0.0.1'], { on: true, brightness: 25 }, { port });
  assert.equal(on, true);
  await wiz.setLights(['127.0.0.1'], { on: true, brightness: 50 }, { port }, { preservePower: true, released });
  assert.equal(writes[1].state, undefined);
  on = false;
  await wiz.setLights(['127.0.0.1'], { on: true, brightness: 75 }, { port }, { preservePower: true, released });
  on = true; // A manual on again belongs to the owner for this sunrise.
  await wiz.setLights(['127.0.0.1'], { on: true, brightness: 100 }, { port }, { preservePower: true, released });
  assert.equal(writes.length, 2);
});
