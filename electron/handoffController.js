'use strict';
const crypto=require('node:crypto'),h=require('./routineHandoff'),{createInbox}=require('./routineHandoffInbox');
// Manual transport is off at startup. A short pairing window requires local
// confirmation and an exact public peer certificate; attach still verifies TLS.
function createController({identity,store,qr=link=>require('qrcode').toDataURL(link,{width:400,margin:3,errorCorrectionLevel:'M'})}){
 let chain=Promise.resolve(),book,inbox,currentId,invitation,opened,preview,listener,note='Pairing is off. Connect devices explicitly to exchange inactive routine intent.';
 const pending=new Map(),connections=new Map(),offers=new Map();
 const queue=fn=>{const next=chain.then(fn);chain=next.catch(()=>{});return next;};
 function closeAll(){listener?.stop();for(const c of [...pending.values(),...connections.values()]){clearTimeout(c.expiryTimer);c.socket.destroy();}pending.clear();connections.clear();offers.clear();preview=null;}
 function ready(){const state=identity.status();if(state.status!=='ready'){closeAll();throw Error(state.error||'Create a device identity first.');}if(currentId!==state.fingerprint){closeAll();currentId=state.fingerprint;book=new h.TrustBook(currentId,'windows',()=>identity.now(),identity.trustStore(currentId));inbox=createInbox(book,store);}return state;}
 function expire(){if(!book)return;const now=identity.now();if(invitation&&invitation.expiresAt<=now)invitation=null;if(opened&&opened.expiresAt<=now)opened=null;
  for(const [id,p]of pending)if(p.expiresAt<=now){p.socket.destroy();pending.delete(id);note='Pairing invitation expired. Generate a new invitation.';}
  for(const [id,o]of offers)if(o.expiresAt<=now){inbox.endpoint.cancel(id);offers.delete(id);note='Transfer offer expired. Request a new transfer.';}
  if(preview&&preview.expiresAt<=now){inbox.dismiss(preview.id);preview=null;note='Received preview expired. Request a new transfer.';}
 }
 function connection(id){ready();const c=connections.get(id);if(!c)throw Error('This device is not securely connected. Local transport must be attached first.');book.check(c.proof);return c;}
 function snapshot(){const state=identity.status();if(state.status==='ready'){ready();expire();}else closeAll();
  return {identity:state,transport:'manual',connection:listener?.status(),invitation:invitation||null,opened:opened||null,pairings:[...pending.values()].map(p=>({id:p.id,fingerprint:p.peerId,platform:p.platform,verified:true,expiresAt:p.expiresAt})),peers:state.status==='ready'?book.listPeers().map(p=>({...p,connected:connections.has(p.id),canOffer:Boolean(connections.get(p.id)?.challenge&&connections.get(p.id).challengeExpires>identity.now())})):[],offers:[...offers.values()].map(o=>({id:o.id,peerId:o.peerId,bytes:o.bytes,sha256:o.sha256,expiresAt:o.expiresAt})),preview:preview?{id:preview.id,peerId:preview.peerId,expiresAt:preview.expiresAt,value:preview.value}:null,sources:store.list().choices,note};
 }
 function disconnect(c){clearTimeout(c.expiryTimer);let active=false;for(const [id,p]of pending)if(p===c){pending.delete(id);active=true;}if(connections.get(c.peerId)===c){connections.delete(c.peerId);active=true;}for(const [id,o]of offers)if(o.peerId===c.peerId){inbox?.endpoint.cancel(id);offers.delete(id);}if(active)note='Secure connection closed. A fresh connection and transfer confirmation are required.';}
 async function readLoop(c){try{while(!c.socket.destroyed){const bytes=await h.readFrame(c.socket,125000);await queue(()=>{
   ready();book.check(c.proof);const f=h.decode(bytes);inbox.endpoint.live(c.proof,f);
   if(f.type===0){c.challenge=bytes;c.challengeExpires=f.expires;note='The connected device is ready to receive. Select routines and offer them explicitly.';}
   else if(f.type===1){const offer=inbox.endpoint.receiveOffer(c.proof,bytes);offers.set(offer.sessionId,{...offer,id:offer.sessionId,peerId:c.peerId});note='A routine offer is waiting for your acceptance.';}
   else if(f.type===2){c.socket.write(inbox.endpoint.document(c.proof,bytes));note='Routine sent for recipient preview. Nothing was activated.';}
   else {const result=inbox.receive(c.proof,bytes);preview={id:result.sessionId,peerId:c.peerId,expiresAt:f.expires,value:result.preview};offers.delete(f.id);note='Review the received routine. Saving creates inactive intent only.';}
  });}}catch{c.socket.destroy();await queue(()=>disconnect(c));}}
 function connected(c){clearTimeout(c.expiryTimer);connections.set(c.peerId,c);void readLoop(c);note='Authenticated device connected. Transfers still require recipient acceptance and local import confirmation.';}
 const api = {
  identity,
  attach(socket,link){return queue(()=>{
   try {ready();const invite=h.parseInvitation(link,identity.now()),proof=h.authenticateSocket(socket,currentId,invite.id),state=identity.trustStore(currentId).read();
   if(state.used.some(r=>r.key===invite.id+':'+invite.nonce&&r.expires>identity.now()))throw Error('This invitation has already been used. Generate a new one.');
   if(connections.has(invite.id)||[...pending.values()].some(p=>p.peerId===invite.id)){socket.destroy();throw Error('A connection for this device already exists. Close it before retrying.');}
   if(pending.size+connections.size>=8){socket.destroy();throw Error('Too many pending device connections.');}
   const c={id:crypto.randomUUID(),peerId:invite.id,platform:invite.platform,expiresAt:invite.expires,proof,socket,link};socket.on('error',()=>{});socket.once('close',()=>void queue(()=>disconnect(c)));socket.setTimeout(125000,()=>socket.destroy());c.expiryTimer=setTimeout(()=>void queue(()=>{if(pending.has(c.id)){pending.delete(c.id);socket.destroy();note='Pairing invitation expired. Generate a new invitation.';}}),Math.max(1,invite.expires-identity.now()));
   const known=book.listPeers().find(p=>p.id===invite.id&&!p.revoked);if(known){book.connect(link,proof);connected(c);}else{pending.set(c.id,c);note='Peer certificate verified. Compare the full fingerprint and approve or reject enrollment.';}return c.id;
   }catch(error){socket.destroy();throw error;}
  });},
  handle(action,args={}){return queue(async()=>{
   try{
    if(action==='status')return {ok:true,result:snapshot()};
    if(action==='setup'||action==='replace'){closeAll();await identity.initialize({confirmed:args.confirmed===true,replace:action==='replace',expectedFingerprint:args.expectedFingerprint});currentId=null;ready();note='Device identity ready. Other devices must explicitly enroll this identity.';}
    else {ready();expire();
     if(action==='invite'){const link=h.invitation(currentId,'windows',identity.now()),value=h.parseInvitation(link,identity.now());invitation={link,expiresAt:value.expires,qr:await qr(link),card:require('./handoffConnection').makeCard(identity,link)};note='Invitation expires in two minutes. It contains public identity only.';}
     else if(action==='listen'){if(pending.size||connections.size)throw Error('Close the existing connection before opening another pairing window.');await listener.start(args);note='Pairing window open for one phone. Copy the PC connection details to your phone, then compare fingerprints.';}
     else if(action==='disconnect'){closeAll();note='Pairing window and connections closed. Saved device trust is unchanged.';}
     else if(action==='open'){const p=h.parseInvitation(args.link,identity.now()),used=identity.trustStore(currentId).read().used;if(used.some(r=>r.key===p.id+':'+p.nonce&&r.expires>identity.now()))throw Error('This invitation has already been used. Generate a new one.');opened={fingerprint:p.id,platform:p.platform,expiresAt:p.expires,verified:false};note='Invitation opened. Approval remains unavailable until a secure connection proves this fingerprint.';}
     else if(action==='approve'){const p=pending.get(args.id);if(!p||p.expiresAt<=identity.now())throw Error('Pairing invitation expired or disconnected.');book.enroll(p.link,p.proof,args.fingerprint,{label:args.label,replaceId:args.replaceId||null});pending.delete(p.id);connected(p);}
     else if(action==='reject'){const p=pending.get(args.id);if(p){pending.delete(p.id);p.socket.destroy();}note='Pairing rejected. No device was enrolled.';}
     else if(action==='revoke'){book.revoke(args.id);connections.get(args.id)?.socket.destroy();note='Device revoked. Existing and pending imports from this identity are blocked.';}
     else if(action==='receive'){const c=connection(args.peerId);c.socket.write(inbox.endpoint.request(c.proof));note='Ready to receive from this device. You must still accept any offer.';}
     else if(action==='offer'){const c=connection(args.peerId);if(!c.challenge||c.challengeExpires<=identity.now())throw Error('The recipient must request a fresh transfer first.');const text=JSON.stringify(store.export(args.selection));c.socket.write(inbox.endpoint.offer(c.proof,text,c.challenge));c.challenge=null;note='Offer sent. Waiting for the recipient to accept.';}
     else if(action==='accept'){const o=offers.get(args.id);if(!o||args.confirmed!==true)throw Error('Explicitly accept this offer for preview.');const c=connection(o.peerId);c.socket.write(inbox.endpoint.accept(c.proof,o.id,c.peerId));offers.delete(o.id);note='Offer accepted for preview only. Nothing will be saved or activated automatically.';}
     else if(action==='rejectOffer'){const o=offers.get(args.id);if(o){inbox.endpoint.cancel(o.id);offers.delete(o.id);connections.get(o.peerId)?.socket.destroy();}note='Offer rejected. Nothing was imported.';}
     else if(action==='save'){if(!preview||args.id!==preview.id)throw Error('Open a current received preview first.');inbox.save(args.id,{confirmed:args.confirmed===true,policy:args.policy||'reject'});preview=null;note='Saved inactive routine intent. Review adoption separately in Routine files.';}
     else if(action==='dismiss'){if(preview){inbox.dismiss(preview.id);preview=null;}note='Received preview dismissed. Nothing was imported.';}
     else throw Error('Unsupported pairing action.');
    }
    return {ok:true,result:snapshot()};
   }catch(error){const allowed=/^(Device |Windows |Create |Confirm |An identity |Protected |Could not |Pairing |This |Invalid |Expired |Unsupported |Unknown |Owner |Recipient |Replayed |Select |Use |Choose |Explicitly |The recipient |Open |Too many |Identity |Routine |Expected |Conflicting |Keep )/;return {ok:false,error:allowed.test(error.message||'')?error.message:'Pairing could not complete. No authority was granted.'};}
  });},
  close(){return queue(()=>closeAll());}
 };
 listener=require('./handoffConnection').createListener({identity,attach:(socket,link)=>api.attach(socket,link)});
 return api;
}
module.exports={createController};
