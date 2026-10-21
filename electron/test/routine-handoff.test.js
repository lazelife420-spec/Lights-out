'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{PassThrough}=require('node:stream');
const h=require('../routineHandoff'),{createInbox}=require('../routineHandoffInbox'),{createStore}=require('../routineInterchangeStore'),model=require('../routineModel');
const {createIdentities,pair}=require('./helpers/handoff-fixture.cjs');
const fixture=createIdentities(),[win,phone,other]=fixture.identities;test.after(()=>fixture.close());
const doc=JSON.stringify({format:'lights-out.routines',schemaVersion:1,routines:[{id:'night',name:'Bedtime',actions:[{id:'timer',type:'timer.start',phase:'start',parameters:{seconds:600,endAction:'sleep'}}]}],rules:[]});
async function setup(t){
 const sockets=await pair(win,phone);t.after(()=>sockets.close());const a=h.authenticateSocket(sockets.a,win.id,phone.id),b=h.authenticateSocket(sockets.b,phone.id,win.id);let now=Date.now();
 const left=new h.TrustBook(win.id,'windows',()=>now),right=new h.TrustBook(phone.id,'android',()=>now);
 left.enroll(h.invitation(phone.id,'android',now),a,phone.id);right.enroll(h.invitation(win.id,'windows',now),b,win.id);
 let calendar={builtin:{rules:[]}},writes=0;const store=createStore({read:()=>calendar,write:c=>{calendar=c;writes++;}});
 const endpoint=new h.Endpoint(left,{validate:model.interchange.parse,preview:text=>store.preview(text)}),inbox=createInbox(right,store);
 return {a,b,left,right,endpoint,inbox,sockets,store,calendar:()=>calendar,writes:()=>writes,advance:ms=>{now+=ms;}};
}
function offered(s,text=doc){const challenge=s.inbox.endpoint.request(s.b),frame=s.endpoint.offer(s.a,text,challenge);return {frame,offer:s.inbox.endpoint.receiveOffer(s.b,frame)};}
function delivered(s,text=doc){const o=offered(s,text),accepted=s.inbox.endpoint.accept(s.b,o.offer.sessionId,win.id);return {...o,packet:s.endpoint.document(s.a,accepted),accepted};}

test('native mutual TLS pins both identities and rejects forged/plaintext/wrong-peer contexts',async t=>{
 const s=await setup(t);assert.equal(s.sockets.a.authorized,true);assert.equal(s.sockets.b.authorized,true);
 assert.throws(()=>h.authenticateSocket(s.sockets.a,win.id,other.id),/identity/);assert.throws(()=>h.authenticateSocket({},win.id,phone.id),/TLS/);
 assert.throws(()=>s.left.check({localId:win.id,peerId:phone.id,verify(){}}),/Authenticated/);
});
test('QR/link enrollment requires full owner confirmation, authenticated identity, freshness and one-use nonce',async t=>{
 const s=await setup(t),book=new h.TrustBook(win.id,'windows'),link=h.invitation(phone.id,'android');
 assert.throws(()=>book.enroll(link,s.a,''),/Owner/);assert.throws(()=>book.enroll(h.invitation(other.id,'android'),s.a,other.id),/Owner/);
 book.enroll(link,s.a,phone.id);assert.throws(()=>book.enroll(link,s.a,phone.id),/Replayed/);
 assert.throws(()=>h.parseInvitation(link+'&nonce=bad'),/Ambiguous/);assert.throws(()=>h.parseInvitation(link,Date.now()+h.TTL+1000),/Expired/);
 assert.throws(()=>h.parseInvitation(link.replace('/v1','/v2')));assert.throws(()=>h.parseInvitation(link+'&token=private'));
});
test('authenticated exchange only reaches existing read-only preview until a separate local import confirmation',async t=>{
 const s=await setup(t),d=delivered(s);assert.equal(s.writes(),0);const r=s.inbox.receive(s.b,d.packet);assert.equal(s.writes(),0);
 assert.deepEqual(r.preview.document,JSON.parse(doc));assert.throws(()=>s.inbox.save(r.sessionId),/Confirm/);
 assert.equal(s.inbox.save(r.sessionId,{confirmed:true}).count,1);assert.equal(s.writes(),1);
 assert.equal(s.calendar().portable.routines[0].adopted,false);assert.deepEqual(s.calendar().builtin.rules,[]);assert.throws(()=>s.inbox.save(r.sessionId,{confirmed:true}),/Confirm/);
});
test('reverse direction uses the same protocol and the existing Windows inactive import store',async t=>{
 const s=await setup(t),inbox=createInbox(s.left,s.store),sender=new h.Endpoint(s.right,{validate:model.interchange.parse,preview:text=>model.interchange.inspect(model.interchange.parse(text),'android')});
 const request=inbox.endpoint.request(s.a),offer=sender.offer(s.b,doc,request),info=inbox.endpoint.receiveOffer(s.a,offer);
 const accept=inbox.endpoint.accept(s.a,info.sessionId,phone.id),document=sender.document(s.b,accept),r=inbox.receive(s.a,document);
 assert.equal(s.writes(),0);inbox.save(r.sessionId,{confirmed:true});assert.equal(s.calendar().portable.routines[0].adopted,false);
});
test('unconfirmed offers cannot deliver data or start the preview callback',async t=>{
 const s=await setup(t),o=offered(s),m=h.decode(o.frame),packet=h.encode({...m,type:3,body:Buffer.from(doc)});
 assert.throws(()=>s.inbox.endpoint.accept(s.b,o.offer.sessionId,''),/confirm/);assert.throws(()=>s.inbox.receive(s.b,packet),/acceptance/);assert.equal(s.writes(),0);
});
test('offer, acceptance and document replays fail; interrupted and restarted recipients reject old offers',async t=>{
 const s=await setup(t),d=delivered(s);assert.throws(()=>s.inbox.endpoint.receiveOffer(s.b,d.frame),/challenge/);assert.throws(()=>s.endpoint.document(s.a,d.accepted),/Unknown/);
 s.inbox.receive(s.b,d.packet);assert.throws(()=>s.inbox.receive(s.b,d.packet),/Unknown/);
 const fresh=new h.Endpoint(s.right,{validate:model.interchange.parse,preview:()=>{throw Error('must not preview');}});assert.throws(()=>fresh.receiveOffer(s.b,d.frame),/Unknown/);
 const o=offered(s);s.inbox.dismiss(o.offer.sessionId);assert.throws(()=>s.inbox.endpoint.accept(s.b,o.offer.sessionId,win.id),/Unknown/);
});
test('altered payload and wrong metadata/identity cannot enter preview or storage',async t=>{
 const s=await setup(t);for(const offset of [30,62,94,102,114]){const d=delivered(s),bad=Buffer.from(d.packet);bad[offset]^=1;assert.throws(()=>s.inbox.receive(s.b,bad));s.inbox.dismiss(d.offer.sessionId);}
 const d=delivered(s),bad=Buffer.from(d.packet);bad[bad.length-2]^=1;assert.throws(()=>s.inbox.receive(s.b,bad),/payload/);assert.equal(s.writes(),0);
});
test('revocation rejects unknown peers and revokes pending offers and received previews immediately',async t=>{
 const s=await setup(t);const empty=new h.TrustBook(phone.id,'android');assert.throws(()=>empty.check(s.b),/Unknown/);
 const d=delivered(s),r=s.inbox.receive(s.b,d.packet);s.right.revoke(win.id);assert.throws(()=>s.inbox.save(r.sessionId,{confirmed:true}),/revoked/);
 assert.throws(()=>s.inbox.endpoint.request(s.b),/revoked/);assert.equal(s.writes(),0);
});
test('expired sessions and previews fail closed without extending the original deadline',async t=>{
 const s=await setup(t),d=delivered(s),r=s.inbox.receive(s.b,d.packet);s.advance(h.TTL+1);assert.throws(()=>s.inbox.save(r.sessionId,{confirmed:true}),/expired/);assert.equal(s.writes(),0);
});
test('capability/schema mismatch, truncation, trailing bytes and allocation attacks are rejected',async t=>{
 const s=await setup(t),o=offered(s);
 for(const offset of [8,9,10,12]){const bad=Buffer.from(o.frame);bad[offset]=255;assert.throws(()=>h.decode(bad));}
 assert.throws(()=>h.decode(o.frame.subarray(0,149)));assert.throws(()=>h.decode(Buffer.concat([o.frame,Buffer.from([1])])));
 const bad=Buffer.from(o.frame);bad.writeUInt32BE(0xffffffff,146);const stream=new PassThrough();const read=h.readFrame(stream);stream.end(bad);await assert.rejects(read,/limit/);
});
test('LO-RIE validation rejects future schemas/unknown actions/extra execution grants before offering or preview',async t=>{
 const s=await setup(t),bad=JSON.stringify({...JSON.parse(doc),schemaVersion:2}),challenge=s.inbox.endpoint.request(s.b);
 assert.throws(()=>s.endpoint.offer(s.a,bad,challenge),/version/);
 const o=offered(s),original=h.decode(o.frame),mutated={...original,length:Buffer.byteLength(bad),digest:h.fingerprint(Buffer.from(bad))};
 // A malicious but authenticated sender advertises a syntactically valid
 // future file. The recipient still validates with LO-RIE-1 after consent.
 s.inbox.dismiss(o.offer.sessionId);const c=s.inbox.endpoint.request(s.b),m=h.decode(c),off=h.encode({...mutated,id:m.id,issued:m.issued,expires:m.expires});
 const info=s.inbox.endpoint.receiveOffer(s.b,off);s.inbox.endpoint.accept(s.b,info.sessionId,win.id);
 assert.throws(()=>s.inbox.receive(s.b,h.encode({...h.decode(off),type:3,body:Buffer.from(bad)})),/version/);assert.equal(s.writes(),0);
});
test('duplicate imports use LO-RIE conflict handling and explicit copies remain inactive',async t=>{
 const s=await setup(t);let d=delivered(s),r=s.inbox.receive(s.b,d.packet);s.inbox.save(r.sessionId,{confirmed:true});d=delivered(s);r=s.inbox.receive(s.b,d.packet);
 assert.throws(()=>s.inbox.save(r.sessionId,{confirmed:true}),/conflict/i);assert.equal(s.writes(),1);s.inbox.save(r.sessionId,{confirmed:true,policy:'copy'});assert.equal(s.writes(),2);assert.equal(s.calendar().portable.routines.length,2);
});
test('failed local persistence retains the received preview for an explicit safe retry',async t=>{
 const s=await setup(t);let fail=true,calendar={builtin:{rules:[]}},writes=0;
 const store=createStore({read:()=>calendar,write:c=>{if(fail)throw Error('isolated disk failure');calendar=c;writes++;}}),inbox=createInbox(s.right,store);
 const request=inbox.endpoint.request(s.b),off=s.endpoint.offer(s.a,doc,request),info=inbox.endpoint.receiveOffer(s.b,off),accept=inbox.endpoint.accept(s.b,info.sessionId,win.id),result=inbox.receive(s.b,s.endpoint.document(s.a,accept));
 assert.throws(()=>inbox.save(result.sessionId,{confirmed:true}),/disk failure/);assert.deepEqual(calendar,{builtin:{rules:[]}});assert.equal(writes,0);
 fail=false;inbox.save(result.sessionId,{confirmed:true});assert.equal(writes,1);assert.equal(calendar.portable.routines[0].adopted,false);
});
test('fragmented TLS frames reassemble without plaintext transport or application-level encryption',async t=>{
 const s=await setup(t),challenge=s.inbox.endpoint.request(s.b),read=h.readFrame(s.sockets.a);s.sockets.b.write(challenge.subarray(0,30));s.sockets.b.write(challenge.subarray(30));assert.deepEqual(await read,challenge);
 const stream=new PassThrough(),incomplete=h.readFrame(stream,100);stream.end(challenge.subarray(0,20));await assert.rejects(incomplete,/Interrupted/);
});
test('pending session limits are bounded and connection loss invalidates authority',async t=>{
 const s=await setup(t);for(let n=0;n<8;n++)s.inbox.endpoint.request(s.b);assert.throws(()=>s.inbox.endpoint.request(s.b),/limit/);
 s.sockets.a.destroy();assert.throws(()=>s.left.check(s.a),/TLS/);
});
