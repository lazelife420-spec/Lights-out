'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),tls=require('node:tls');
const {createIdentity}=require('../handoffIdentityWindows'),{createController}=require('../handoffController'),{createStore}=require('../routineInterchangeStore'),{fingerprint,TrustBook}=require('../routineHandoff');
async function setup(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lightsout-controller-unit-')),key=crypto.randomBytes(32),sockets=new Set(),servers=new Set(),controllers=new Set();
 const safeStorage={isEncryptionAvailable:()=>true,encryptString(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text,'utf8'),c.final(),c.getAuthTag()]);},decryptString(b){const d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString();}};
 t.after(async()=>{for(const c of controllers)await c.close();for(const s of sockets)s.destroy();for(const s of servers)await new Promise(r=>s.close(r));const p=fs.realpathSync(directory);assert.equal(path.dirname(p),fs.realpathSync(os.tmpdir()));assert.match(path.basename(p),/^lightsout-controller-unit-[A-Za-z0-9]+$/);fs.rmSync(p,{recursive:true,force:true});key.fill(0);});
 function actor(name){const identity=createIdentity({directory:path.join(directory,name),safeStorage,platform:'win32'});let calendar={builtin:{rules:[]}},writes=0;const profiles=name==='a'?[{id:'bedtime',name:'Bedtime',mode:'duration',seconds:600,action:'sleep'}]:[];const store=createStore({read:()=>calendar,write:c=>{calendar=c;writes++;},getProfiles:()=>profiles});
  function restart(){const c=createController({identity,store,qr:async()=> 'data:image/png;base64,AA=='});controllers.add(c);return c;}const c=restart();return {identity,c,restart,writes:()=>writes,calendar:()=>calendar,dir:path.join(directory,name)};}
 const a=actor('a'),b=actor('b');assert.equal((await a.c.handle('setup',{confirmed:true})).ok,true);assert.equal((await b.c.handle('setup',{confirmed:true})).ok,true);
 async function connect(approve=true){const ai=(await a.c.handle('invite')).result.invitation.link,bi=(await b.c.handle('invite')).result.invitation.link;const aid=a.identity.status().fingerprint,bid=b.identity.status().fingerprint;
  let accept;const accepted=new Promise(r=>{accept=r;});const server=b.identity.withTls(options=>tls.createServer({...options,ca:[a.identity.publicCertificate()],requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.2'},s=>{s.on('error',()=>{});sockets.add(s);accept(s);}));servers.add(server);server.on('tlsClientError',()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const client=a.identity.withTls(options=>tls.connect({...options,host:'127.0.0.1',port:server.address().port,ca:[b.identity.publicCertificate()],rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(_host,cert)=>fingerprint(cert.raw)===bid?undefined:Error('Wrong identity')}));sockets.add(client);await new Promise((resolve,reject)=>{client.once('secureConnect',resolve);client.once('error',reject);});const remote=await accepted;
  const ap=await a.c.attach(client,bi),bp=await b.c.attach(remote,ai);if(approve){if((await a.c.handle('status')).result.pairings.length)assert.equal((await a.c.handle('approve',{id:ap,fingerprint:bid,label:'Phone lab'})).ok,true);if((await b.c.handle('status')).result.pairings.length)assert.equal((await b.c.handle('approve',{id:bp,fingerprint:aid,label:'PC lab'})).ok,true);}
  return {ap,bp,ai,bi,aid,bid,client,remote};
 }
 async function wait(c,predicate){const until=Date.now()+3000;while(Date.now()<until){const r=await c.handle('status');assert.equal(r.ok,true);if(predicate(r.result))return r.result;await new Promise(r=>setTimeout(r,10));}throw Error('Primary handler state timed out');}
 async function transfer(){const aid=a.identity.status().fingerprint,bid=b.identity.status().fingerprint;assert.equal((await b.c.handle('receive',{peerId:aid})).ok,true);await wait(a.c,s=>s.peers.some(p=>p.canOffer));assert.equal((await a.c.handle('offer',{peerId:bid,selection:[{kind:'profile',id:'bedtime'}]})).ok,true);const offered=await wait(b.c,s=>s.offers.length===1);return offered.offers[0];}
 return {a,b,connect,wait,transfer};
}
test('primary pairing handler never approves an unverified link or an unchecked fingerprint',async t=>{
 const s=await setup(t),p=await s.connect(false);assert.equal((await s.a.c.handle('open',{link:p.bi})).result.opened.verified,false);
 assert.equal((await s.a.c.handle('approve',{id:p.ap,fingerprint:'wrong'})).ok,false);assert.equal((await s.a.c.handle('status')).result.peers.length,0);
 assert.equal((await s.a.c.handle('reject',{id:p.ap})).ok,true);assert.equal((await s.a.c.handle('status')).result.peers.length,0);
});
test('genuine controller offer/accept/preview/save handlers require separate consent and retain inactive imports',async t=>{
 const s=await setup(t);await s.connect();const o=await s.transfer();assert.equal(s.b.writes(),0);assert.equal((await s.b.c.handle('accept',{id:o.id,confirmed:false})).ok,false);
 assert.equal((await s.b.c.handle('accept',{id:o.id,confirmed:true})).ok,true);const p=(await s.wait(s.b.c,v=>Boolean(v.preview))).preview;assert.equal(s.b.writes(),0);
 assert.equal((await s.b.c.handle('save',{id:p.id,confirmed:false})).ok,false);assert.equal(s.b.writes(),0);assert.equal((await s.b.c.handle('save',{id:p.id,confirmed:true})).ok,true);
 assert.equal(s.b.writes(),1);assert.equal(s.b.calendar().portable.routines[0].adopted,false);assert.deepEqual(s.b.calendar().builtin.rules,[]);
});
test('trust, used invitations, session replay history and revocations survive application-controller restart',async t=>{
 const s=await setup(t),p=await s.connect();const id=s.a.identity.status().fingerprint;const book=new TrustBook(id,'windows',()=>s.a.identity.now(),s.a.identity.trustStore(id));book.reserveSession('a'.repeat(32),s.a.identity.now()+120000);
 await s.a.c.close();await s.b.c.close();s.a.c=s.a.restart();s.b.c=s.b.restart();assert.equal((await s.a.c.handle('status')).result.peers.length,1);assert.equal((await s.a.c.handle('open',{link:p.bi})).ok,false);
 assert.throws(()=>new TrustBook(id,'windows',()=>s.a.identity.now(),s.a.identity.trustStore(id)).reserveSession('a'.repeat(32),s.a.identity.now()+120000),/Replayed/);
 await s.connect();assert.equal((await s.b.c.handle('revoke',{id})).ok,true);await s.b.c.close();s.b.c=s.b.restart();assert.equal((await s.b.c.handle('status')).result.peers[0].revoked,true);
});
test('revocation after preview and corrupt protected storage block real import handlers',async t=>{
 const s=await setup(t);await s.connect();const o=await s.transfer();await s.b.c.handle('accept',{id:o.id,confirmed:true});const p=(await s.wait(s.b.c,v=>Boolean(v.preview))).preview;
 await s.b.c.handle('revoke',{id:s.a.identity.status().fingerprint});assert.equal((await s.b.c.handle('save',{id:p.id,confirmed:true})).ok,false);assert.equal(s.b.writes(),0);
 fs.writeFileSync(path.join(s.b.dir,'protected.bin'),Buffer.from('corrupt synthetic fixture'));assert.equal((await s.b.c.handle('status')).result.identity.status,'blocked');assert.equal((await s.b.c.handle('receive',{peerId:s.a.identity.status().fingerprint})).ok,false);
});
