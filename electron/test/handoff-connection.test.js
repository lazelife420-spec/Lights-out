'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),tls=require('node:tls'),net=require('node:net');
const {createIdentities}=require('./helpers/handoff-fixture.cjs'),h=require('../routineHandoff'),c=require('../handoffConnection');
function fixture(t){const f=createIdentities();t.after(()=>f.close());const [win,phone,unknown]=f.identities;
 const identity={status:()=>({fingerprint:win.id}),now:Date.now,publicCertificate:()=>win.cert,withTls:fn=>fn({key:win.key,cert:win.cert})};
 const phoneCard=JSON.stringify({format:c.FORMAT,version:1,invitation:h.invitation(phone.id,'android'),certificate:new(require('node:crypto').X509Certificate)(phone.cert).raw.toString('base64'),host:null,port:null});return {win,phone,unknown,identity,phoneCard};}
test('manual transport is off, and neither missing consent nor an invalid address opens a listener',async t=>{
 const f=fixture(t),s=c.createListener({...f,attach:()=>{},localAddresses:()=>['127.0.0.1']});t.after(()=>s.stop());assert.equal(s.status().state,'OFF');
 await assert.rejects(s.start({peerCard:f.phoneCard,host:'127.0.0.1',confirmed:false}),/Confirm/);
 for(const host of ['0.0.0.0','127.0.0.2','8.8.8.8','localhost','192.168.9.99'])await assert.rejects(s.start({peerCard:f.phoneCard,host,confirmed:true}),/Choose/);
 assert.equal(s.status().state,'OFF');
});
test('public cards reject altered identity, ambiguous fields, public/DNS endpoints and expired invitations',t=>{
 const f=fixture(t),card=JSON.parse(f.phoneCard);assert.equal(c.parseCard(f.phoneCard).invite.id,f.phone.id);assert.equal(c.parseCard(f.phoneCard.replaceAll('/','\\/')).invite.id,f.phone.id);
 for(const change of [v=>{v.extra=true;},v=>{v.version=2;},v=>{v.invitation=h.invitation(f.unknown.id,'android');},v=>{v.host='example.com';v.port=1234;},v=>{v.host='8.8.8.8';v.port=1234;},v=>{v.host='127.0.0.1';v.port=80;},v=>{v.host='127.0.0.1';v.port=1234.5;},v=>{v.certificate='AA==';},v=>{v.invitation=h.invitation(f.phone.id,'android',Date.now()-180000);}]){const bad=structuredClone(card);change(bad);assert.throws(()=>c.parseCard(JSON.stringify(bad)));}
 assert.throws(()=>c.parseCard(f.phoneCard.replace('"version":1','"version":9,"version":1')));assert.throws(()=>c.parseCard('x'.repeat(8193)));
});
test('only explicit local private IPv4 addresses are supported',()=>{
 for(const value of ['10.1.2.3','172.16.0.1','172.31.2.3','192.168.1.2','127.0.0.1'])assert.equal(c.privateAddress(value),true);
 for(const value of ['0.0.0.0','127.1','127.0.0.2','172.32.0.1','169.254.1.2','192.168.001.2','::1','localhost','https://192.168.1.2'])assert.equal(c.privateAddress(value),false);
});
test('one authenticated, exactly pinned peer closes the listener and attaches without enrollment',async t=>{
 const f=fixture(t);let accepted;const attached=new Promise(resolve=>{accepted=resolve;});
 const s=c.createListener({identity:f.identity,attach:(socket,link)=>{accepted({socket,link});},localAddresses:()=>['127.0.0.1']});t.after(()=>s.stop());
 const opened=await s.start({peerCard:f.phoneCard,host:'127.0.0.1',confirmed:true});assert.equal(opened.state,'LISTENING');const parsed=c.parseCard(opened.card);assert.equal(parsed.invite.id,f.win.id);
 await assert.rejects(s.start({peerCard:f.phoneCard,host:'127.0.0.1',confirmed:true}),/already/);
 const client=tls.connect({host:'127.0.0.1',port:parsed.card.port,servername:'localhost',key:f.phone.key,cert:f.phone.cert,ca:[f.win.cert],rejectUnauthorized:true,minVersion:'TLSv1.2'});t.after(()=>client.destroy());
 await new Promise((resolve,reject)=>{client.once('secureConnect',resolve);client.once('error',reject);});const peer=await attached;t.after(()=>peer.socket.destroy());
 assert.equal(peer.link,JSON.parse(f.phoneCard).invitation);assert.equal(h.authenticateSocket(peer.socket,f.win.id,f.phone.id).peerId,f.phone.id);assert.equal(s.status().state,'OFF');
});
test('closing a pairing window closes its owned port without changing any other server',async t=>{
 const f=fixture(t),s=c.createListener({identity:f.identity,attach:()=>{},localAddresses:()=>['127.0.0.1']});t.after(()=>s.stop());
 const opened=await s.start({peerCard:f.phoneCard,host:'127.0.0.1',confirmed:true}),port=JSON.parse(opened.card).port;s.stop();
 const replacement=net.createServer();await new Promise((resolve,reject)=>{replacement.once('error',reject);replacement.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>replacement.close(resolve));assert.equal(s.status().state,'OFF');
});
test('pairing window expiry is bounded by the peer invitation',async t=>{
 const f=fixture(t),card=JSON.parse(f.phoneCard);card.invitation=h.invitation(f.phone.id,'android',Date.now()-119900);
 const s=c.createListener({identity:f.identity,attach:()=>{},localAddresses:()=>['127.0.0.1']});t.after(()=>s.stop());await s.start({peerCard:JSON.stringify(card),host:'127.0.0.1',confirmed:true});
 await new Promise(resolve=>setTimeout(resolve,180));assert.equal(s.status().state,'OFF');
});
test('cancelling while a listener starts settles the request and leaves transport off',async t=>{
 const f=fixture(t),s=c.createListener({identity:f.identity,attach:()=>{},localAddresses:()=>['127.0.0.1']});t.after(()=>s.stop());
 const pending=s.start({peerCard:f.phoneCard,host:'127.0.0.1',confirmed:true});s.stop();await assert.rejects(pending,/closed/);assert.equal(s.status().state,'OFF');
});
test('a different certificate never reaches the attach or enrollment boundary',async t=>{
 const f=fixture(t);let attached=0;const s=c.createListener({identity:f.identity,attach:socket=>{attached++;socket.destroy();},localAddresses:()=>['127.0.0.1']});t.after(()=>s.stop());
 const opened=await s.start({peerCard:f.phoneCard,host:'127.0.0.1',confirmed:true});const client=tls.connect({host:'127.0.0.1',port:JSON.parse(opened.card).port,servername:'localhost',key:f.unknown.key,cert:f.unknown.cert,ca:[f.win.cert],minVersion:'TLSv1.2'});t.after(()=>client.destroy());client.on('error',()=>{});await new Promise(resolve=>client.once('close',resolve));assert.equal(attached,0);assert.equal(s.status().state,'LISTENING');
});
