'use strict';
require('node:test')('Invitation parsing permits at most five seconds clock skew and never accepts expired invitations',()=>{
 const assert=require('node:assert/strict'),h=require('../routineHandoff'),now=1792210000000,link=h.invitation('01'.repeat(32),'windows',now);
 assert.equal(h.parseInvitation(link,now-5000).expires,now+h.TTL);
 assert.throws(()=>h.parseInvitation(link,now-5001),/clock/);
 assert.throws(()=>h.parseInvitation(link,now+h.TTL),/Expired/);
});
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createIdentity}=require('../handoffIdentityWindows'),trust=require('../handoffTrust');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lightsout-identity-unit-')),key=crypto.randomBytes(32);t.after(()=>{const p=fs.realpathSync(directory);assert.equal(path.dirname(p),fs.realpathSync(os.tmpdir()));assert.match(path.basename(p),/^lightsout-identity-unit-[A-Za-z0-9]+$/);fs.rmSync(p,{recursive:true,force:true});key.fill(0);});
 const safeStorage={isEncryptionAvailable:()=>true,encryptString(text){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]);},decryptString(b){const d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8');}};
 return {directory,safeStorage,newIdentity:options=>createIdentity({directory,safeStorage,...options})};
}
test('protected identity survives re-creation without exposing a private key in public state',async t=>{
 const f=fixture(t),a=f.newIdentity();assert.equal(a.status().status,'uninitialized');assert.equal((await a.initialize({confirmed:true})).status,'ready');const state=a.status();
 assert.equal(f.newIdentity().status().fingerprint,state.fingerprint);assert.equal(Object.hasOwn(state,'privateKey'),false);assert.equal(JSON.stringify(state).includes('PRIVATE KEY'),false);
 assert.equal(fs.readFileSync(path.join(f.directory,'protected.bin')).includes(Buffer.from('PRIVATE KEY')),false);
 assert.equal(a.withTls(({key,cert})=>new crypto.X509Certificate(cert).checkPrivateKey(crypto.createPrivateKey(key))),true);
});
test('no missing OS-protection or cross-platform plaintext fallback can create an identity',async t=>{
 const f=fixture(t);await assert.rejects(createIdentity({directory:f.directory,safeStorage:{isEncryptionAvailable:()=>false}}).initialize({confirmed:true}),/unavailable/);
 await assert.rejects(f.newIdentity({platform:'linux'}).initialize({confirmed:true}),/unavailable/);assert.equal(fs.readdirSync(f.directory).length,0);
});
test('loss/corruption is blocked and replacement requires current explicit confirmation',async t=>{
 const f=fixture(t),a=f.newIdentity();await a.initialize({confirmed:true});const before=a.status().fingerprint;
 fs.writeFileSync(path.join(f.directory,'protected.bin'),Buffer.from('corrupt synthetic fixture'));assert.equal(a.status().status,'blocked');
 await assert.rejects(a.initialize({confirmed:true}),/exists/);await assert.rejects(a.initialize({confirmed:true,replace:true,expectedFingerprint:'wrong'}),/changed/);
 const replaced=await a.initialize({confirmed:true,replace:true,expectedFingerprint:before});assert.notEqual(replaced.fingerprint,before);assert.deepEqual(a.trustStore(replaced.fingerprint).read().peers,[]);
 fs.unlinkSync(path.join(f.directory,'protected.bin'));assert.equal(f.newIdentity().status().status,'blocked');
});
test('protected trust has strict identity/version/field binding and never falls back to a backup',async t=>{
 const f=fixture(t),a=f.newIdentity();const s=await a.initialize({confirmed:true}),store=a.trustStore(s.fingerprint);
 assert.throws(()=>store.write({...trust.empty(s.fingerprint),version:2}),/identity/);assert.throws(()=>store.write({...trust.empty(s.fingerprint),extra:true}),/invalid/);
 assert.throws(()=>a.trustStore('a'.repeat(64)).read(),/changed/);
 fs.writeFileSync(path.join(f.directory,'protected.bin.bak'),fs.readFileSync(path.join(f.directory,'protected.bin')));fs.unlinkSync(path.join(f.directory,'protected.bin'));assert.equal(a.status().status,'blocked');
});
test('guarded time uses monotonic elapsed time and rejects restart rollback against sealed time',()=>{
 let wall=1792200000000,elapsed=10;const c=trust.guardedClock({wall:()=>wall,elapsed:()=>elapsed}),start=c.now();wall-=3000;elapsed+=120001;assert.ok(c.now()>=start+120001);
 assert.throws(()=>trust.guardedClock({wall:()=>wall,elapsed:()=>0}).now(start+10000),/clock/);
});
test('duplicate devices, ambiguous revocations and malformed replay history are rejected',()=>{
 const own='1'.repeat(64),p={id:'2'.repeat(64),platform:'android',revoked:false,label:'Phone',enrolledAt:1792200000000,revokedAt:null};
 assert.throws(()=>trust.validate({...trust.empty(own),peers:[p,p]},own),/invalid/);
 assert.throws(()=>trust.validate({...trust.empty(own),peers:[{...p,revoked:true}]},own),/invalid/);
 assert.throws(()=>trust.validate({...trust.empty(own),sessions:[{key:'../bad',expires:1792200000000}]},own),/invalid/);
});
