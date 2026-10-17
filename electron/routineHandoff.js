'use strict';
// No listener, discovery, key storage, remote control or execution adapter.
const crypto=require('node:crypto'),tls=require('node:tls');
const MAX_BYTES=262144,HEADER=150,TTL=120000,CAPABILITY=1;
const magic=Buffer.from('LOSDH001'),platforms={windows:1,android:2},proofs=new WeakSet();
const check=(ok,message)=>{if(!ok)throw Error(message);};
const fingerprint=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const isId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
function authenticateSocket(socket,localId,peerId){
  check(socket instanceof tls.TLSSocket,'A native TLS socket is required');
  check(isId(localId)&&isId(peerId)&&localId!==peerId,'Distinct certificate identities required');
  const verify=()=>{
    check(socket.encrypted&&socket.authorized&&!socket.destroyed&&socket.getFinished()?.length,'Mutual TLS authentication required');
    check(['TLSv1.2','TLSv1.3'].includes(socket.getProtocol()),'Unsupported TLS version');
    check(/^(TLS_(AES_(128|256)_GCM_SHA(256|384)|CHACHA20_POLY1305_SHA256)|TLS_ECDHE_ECDSA_WITH_AES_(128|256)_GCM_SHA(256|384))$/.test(socket.getCipher()?.standardName || ''),'Authenticated modern TLS cipher required');
    check(fingerprint(socket.getCertificate().raw)===localId&&fingerprint(socket.getPeerCertificate().raw)===peerId,'TLS certificate identity mismatch');
  };
  verify();const proof=Object.freeze({localId,peerId,verify});proofs.add(proof);return proof;
}
function invitation(id,platform,now=Date.now()){
  check(isId(id)&&platforms[platform]&&Number.isSafeInteger(now),'Invalid enrollment identity');
  return `lightsout-handoff://enroll/v1?fingerprint=${id}&platform=${platform}&nonce=${crypto.randomBytes(16).toString('hex')}&expires=${now+TTL}`;
}
function parseInvitation(link,now=Date.now()){
  check(typeof link==='string'&&link.length<=400&&link.startsWith('lightsout-handoff://enroll/v1?')&&!link.includes('%'),'Invalid enrollment link');const u=new URL(link);
  check(u.protocol==='lightsout-handoff:'&&u.hostname==='enroll'&&u.pathname==='/v1'&&!u.username&&!u.password&&!u.port&&!u.hash,'Invalid enrollment link');
  check([...u.searchParams.keys()].sort().join(',')==='expires,fingerprint,nonce,platform','Ambiguous enrollment link');
  const id=u.searchParams.get('fingerprint'),platform=u.searchParams.get('platform'),nonce=u.searchParams.get('nonce'),value=u.searchParams.get('expires');
  check(isId(id)&&platforms[platform]&&/^[a-f0-9]{32}$/.test(nonce)&&/^\d{13}$/.test(value),'Invalid enrollment identity');const expires=Number(value);
  check(expires>now&&expires<=now+TTL,'Expired enrollment link');return {id,platform,nonce,expires};
}
class TrustBook{
  constructor(id,platform,clock=Date.now){check(isId(id)&&platforms[platform],'Invalid local identity');this.id=id;this.platform=platform;this.clock=clock;this.peers=new Map();this.used=new Map();}
  check(proof){check(proofs.has(proof)&&proof.localId===this.id,'Authenticated local channel required');proof.verify();const p=this.peers.get(proof.peerId);check(p&&!p.revoked,'Unknown or revoked peer');return p;}
  enroll(link,proof,confirmedFingerprint){
    const p=parseInvitation(link,this.clock());check(proofs.has(proof)&&proof.localId===this.id,'Authenticated enrollment channel required');proof.verify();
    check(p.id===proof.peerId&&p.id===confirmedFingerprint,'Owner must confirm the authenticated peer fingerprint');
    for(const [n,e]of this.used)if(e<=this.clock())this.used.delete(n);
    check(!this.used.has(p.id+':'+p.nonce)&&this.used.size<128,'Replayed enrollment or enrollment limit');this.used.set(p.id+':'+p.nonce,p.expires);
    this.peers.set(p.id,{id:p.id,platform:p.platform,revoked:false});return {...this.peers.get(p.id)};
  }
  revoke(id){check(isId(id),'Invalid peer');const p=this.peers.get(id);if(p)p.revoked=true;}
}
function encode(m){
  const body=Buffer.from(m.body || []),b=Buffer.alloc(HEADER+body.length);magic.copy(b);b[8]=m.type;b[9]=platforms[m.platform];b.writeUInt16BE(m.version??1,10);b.writeUInt16BE(m.capabilities??CAPABILITY,12);
  Buffer.from(m.id,'hex').copy(b,14);Buffer.from(m.sender,'hex').copy(b,30);Buffer.from(m.recipient,'hex').copy(b,62);
  b.writeBigUInt64BE(BigInt(m.issued),94);b.writeBigUInt64BE(BigInt(m.expires),102);b.writeUInt32BE(m.length,110);Buffer.from(m.digest,'hex').copy(b,114);b.writeUInt32BE(body.length,146);body.copy(b,HEADER);return b;
}
function decode(bytes){
  check(Buffer.isBuffer(bytes)&&bytes.length>=HEADER&&bytes.length<=HEADER+MAX_BYTES,'Bounded complete handoff frame required');
  check(bytes.subarray(0,8).equals(magic),'Unknown handoff protocol');const type=bytes[8],platform=Object.keys(platforms).find(p=>platforms[p]===bytes[9]);
  check([0,1,2,3].includes(type)&&platform&&bytes.readUInt16BE(10)===1&&bytes.readUInt16BE(12)===CAPABILITY,'Unsupported protocol, schema capability or frame type');
  const issued=Number(bytes.readBigUInt64BE(94)),expires=Number(bytes.readBigUInt64BE(102)),length=bytes.readUInt32BE(110),bodyLength=bytes.readUInt32BE(146);
  check(Number.isSafeInteger(issued)&&Number.isSafeInteger(expires)&&length>0&&length<=MAX_BYTES&&bytes.length===HEADER+bodyLength&&(type===3?bodyLength===length:bodyLength===0),'Malformed handoff frame');
  const digest=bytes.subarray(114,146).toString('hex');check(type!==0||(length===1&&digest==='0'.repeat(64)),'Malformed session challenge');
  return {type,platform,version:1,capabilities:CAPABILITY,id:bytes.subarray(14,30).toString('hex'),sender:bytes.subarray(30,62).toString('hex'),recipient:bytes.subarray(62,94).toString('hex'),issued,expires,length,digest,body:Buffer.from(bytes.subarray(HEADER))};
}
class Endpoint{
  constructor(book,{validate,preview,clock=book.clock}={}){check(typeof validate==='function'&&typeof preview==='function','Existing interchange adapters required');this.book=book;this.validate=validate;this.preview=preview;this.clock=clock;this.pending=new Map();this.seen=new Map();}
  prune(){const now=this.clock();for(const [id,s]of this.pending)if(s.offer.expires<=now)this.pending.delete(id);for(const [id,e]of this.seen)if(e<=now)this.seen.delete(id);}
  live(proof,m){const peer=this.book.check(proof),now=this.clock();check(m.sender===peer.id&&m.recipient===this.book.id&&m.platform===peer.platform,'Wrong peer or local recipient');check(m.issued<=now+5000&&m.expires>now&&m.expires-m.issued>=1000&&m.expires-m.issued<=TTL&&m.expires<=now+TTL+5000,'Expired or invalid transfer session');}
  reserve(id,expires){this.prune();check(!this.seen.has(id)&&this.pending.size<8&&this.seen.size<128,'Replayed session or transfer limit');this.seen.set(id,expires);}
  request(proof){this.book.check(proof);const now=this.clock(),m={type:0,platform:this.book.platform,id:crypto.randomBytes(16).toString('hex'),sender:this.book.id,recipient:proof.peerId,issued:now,expires:now+TTL,length:1,digest:'0'.repeat(64)};this.reserve(m.id,m.expires);this.pending.set(m.id,{proof,offer:m,outgoing:false,awaiting:true});return encode(m);}
  offer(proof,text,challenge){
    this.book.check(proof);check(typeof text==='string'&&Buffer.byteLength(text)<=MAX_BYTES,'Routine file exceeds limit');this.validate(text);
    const hello=decode(challenge);this.live(proof,hello);check(hello.type===0,'Fresh recipient challenge required');
    const body=Buffer.from(text),m={...hello,type:1,platform:this.book.platform,sender:this.book.id,recipient:proof.peerId,length:body.length,digest:fingerprint(body),body:undefined};
    this.reserve(m.id,m.expires);this.pending.set(m.id,{proof,offer:m,outgoing:true,body});return encode(m);
  }
  receiveOffer(proof,bytes){const m=decode(bytes);this.live(proof,m);check(m.type===1,'Expected offer');const s=this.state(proof,m.id,false);check(s.awaiting&&s.offer.issued===m.issued&&s.offer.expires===m.expires,'Fresh recipient challenge required');this.pending.set(m.id,{proof,offer:m,outgoing:false,accepted:false});return {sessionId:m.id,peerId:m.sender,bytes:m.length,sha256:m.digest,expiresAt:m.expires};}
  state(proof,id,outgoing){this.prune();this.book.check(proof);const s=this.pending.get(id);check(s&&s.proof===proof&&s.outgoing===outgoing,'Unknown, interrupted or wrong-channel session');return s;}
  accept(proof,id,confirmedFingerprint){const s=this.state(proof,id,false);check(!s.awaiting&&!s.accepted&&confirmedFingerprint===proof.peerId,'Recipient must explicitly confirm this peer');s.accepted=true;return encode({...s.offer,type:2,platform:this.book.platform,sender:this.book.id,recipient:proof.peerId,body:undefined});}
  match(s,m){check(['id','issued','expires','length','digest','capabilities','version'].every(k=>m[k]===(s.offer[k]??(k==='capabilities'?1:k==='version'?1:undefined))),'Altered transfer offer');}
  document(proof,bytes){const m=decode(bytes);this.live(proof,m);check(m.type===2,'Expected acceptance');const s=this.state(proof,m.id,true);this.match(s,m);this.pending.delete(m.id);return encode({...s.offer,type:3,body:s.body});}
  receiveDocument(proof,bytes){
    const m=decode(bytes);this.live(proof,m);check(m.type===3,'Expected document');const s=this.state(proof,m.id,false);check(s.accepted,'Recipient acceptance required');this.match(s,m);this.pending.delete(m.id);
    check(fingerprint(m.body)===m.digest,'Altered routine payload');const text=new TextDecoder('utf-8',{fatal:true}).decode(m.body);this.validate(text);
    return {sessionId:m.id,document:text,preview:this.preview(text),expiresAt:m.expires};
  }
  cancel(id){this.pending.delete(id);} // Seen nonce remains until expiry; no resume.
}
function readFrame(socket,timeout=10000){return new Promise((resolve,reject)=>{
  let header,size;const timer=setTimeout(()=>done(Error('Interrupted handoff frame')),timeout);
  const fail=e=>done(e instanceof Error?e:Error('Interrupted handoff frame'));
  function done(error,value){clearTimeout(timer);socket.off('readable',pump);socket.off('error',fail);socket.off('end',fail);socket.off('close',fail);error?reject(error):resolve(value);}
  function pump(){try{if(!header){header=socket.read(HEADER);if(!header)return;check(header.length===HEADER,'Interrupted handoff frame');size=header.readUInt32BE(146);check(size<=MAX_BYTES,'Handoff payload exceeds limit');}const body=size?socket.read(size):Buffer.alloc(0);if(body){check(body.length===size,'Interrupted handoff frame');done(null,Buffer.concat([header,body]));}}catch(e){done(e);}}
  socket.on('readable',pump);socket.once('error',fail);socket.once('end',fail);socket.once('close',fail);pump();
});}
module.exports={MAX_BYTES,HEADER,TTL,TrustBook,Endpoint,invitation,parseInvitation,authenticateSocket,fingerprint,encode,decode,readFrame};
