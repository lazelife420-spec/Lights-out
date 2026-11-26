'use strict';
// Disposable debug UID only. A loopback UDP responder never reaches the LAN.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFile}=require('node:child_process');
module.exports=async function fixture({adb,adbPrefix=[],args,pkg,report,wait,sleep}){
  assert.match(args.serial,/^emulator-\d+$/);assert.equal(pkg,'com.lightsout.companion.debug');
  const token=crypto.randomUUID(),script='files/qa-wiz-'+token+'.sh',response='files/qa-wiz-'+token+'.json';
  await adb(['shell','run-as',pkg,'mkdir','-p','files']);
  async function write(file,text){await new Promise((resolve,reject)=>{const child=execFile(args.adb,[...adbPrefix,'-s',args.serial,'shell','-T','run-as',pkg,'tee',file],{windowsHide:true,timeout:10000,maxBuffer:16384},e=>e?reject(e):resolve());child.stdin.end(text);});}
  const record={bind:'127.0.0.1',port:38899,scope:'owned emulator debug UID',requests:[],modes:[]};report.wizFixture=record;
  let pid,child;
  async function setMode(mode){
    const method=mode==='status'?'getPilot':'setPilot';
    const body=mode==='malformed'?'not-json':mode==='timeout'?'':JSON.stringify(mode==='negative'?{method,error:{code:-1}}:mode==='no-ack'?{method,result:{success:false}}:mode==='status'?{method,result:{state:true,dimming:30}}:{method,result:{success:true}});
    // nc reads stdin before the first datagram, so restart the owned listener
    // instead of assuming a file replacement changes an already-read reply.
    if(pid)await close();
    await write(response+'.tmp',body+'\n');await adb(['shell','run-as',pkg,'mv',response+'.tmp',response]);record.modes.push(mode);
    child=execFile(args.adb,[...adbPrefix,'-s',args.serial,'shell','-T','run-as',pkg,'sh',script],{windowsHide:true,timeout:180000,maxBuffer:65536},()=>{});
    child.stdout.on('data',b=>{const text=b.toString(),m=text.match(/FIXTURE_PID=(\d+)/);if(m)pid=Number(m[1]);else if(text.trim())record.requests.push(text.slice(0,8192));});
    await wait('owned guest UDP fixture',()=>pid);record.pid=pid;record.stopped=false;await sleep(200);
  }
  await write(script,`#!/system/bin/sh\necho FIXTURE_PID=$$\nwhile :; do\n  cat ${response} | toybox nc -4 -u -l -s 127.0.0.1 -p 38899 -W 2\ndone\n`);
  async function close(){
    if(!pid)return;
    const command=(await adb(['shell','run-as',pkg,'cat','/proc/'+pid+'/cmdline'])).stdout;assert.ok(command.includes(script),'fixture ownership changed');
    const uid=Number((await adb(['shell','run-as',pkg,'id','-u'])).stdout.trim());await adb(['shell','run-as',pkg,'kill','-STOP',String(pid)]);
    async function processes(){return (await adb(['shell','ps','-A','-o','PID,PPID,UID,STAT,ARGS'])).stdout.split(/\r?\n/).slice(1).map(line=>{const m=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);return m&&{pid:+m[1],parent:+m[2],uid:+m[3],state:m[4],command:m[5]};}).filter(Boolean);}
    const before=await processes(),owner=before.find(p=>p.pid===pid);assert.equal(owner.uid,uid);assert.equal(owner.command,'sh '+script);
    const owned=new Set([pid]);let changed=true;while(changed){changed=false;for(const p of before)if(p.uid===uid&&owned.has(p.parent)&&!owned.has(p.pid)){assert.ok(p.command.includes('nc ')&&p.command.includes('127.0.0.1')&&p.command.includes('38899')||p.command.includes('qa-wiz-'+token));owned.add(p.pid);changed=true;}}
    await adb(['shell','run-as',pkg,'kill','-9',...[...owned].map(String)]);await sleep(400);assert.deepEqual((await processes()).filter(p=>owned.has(p.pid)&&!p.state.startsWith('Z')),[]);child.kill();pid=null;record.stopped=true;record.ownedProcessesStopped=(record.ownedProcessesStopped||0)+owned.size;
  }
  await setMode('status');return {record,setMode,close};
};
