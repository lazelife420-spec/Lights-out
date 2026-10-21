/* Shared local pairing UI. All authority and transport remain in native code. */
/* global document, RoutineTransferUI */
(function(root){
 'use strict';
 function mount(container,adapter){
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(text,fn,id)=>{const b=node('button',text,'btn-secondary secondary');b.type='button';if(id)b.dataset.handoff=id;b.onclick=()=>void run(fn);return b;};
  const choice=text=>{const label=node('label',undefined,'handoff-choice'),input=node('input');input.type='checkbox';label.append(input,document.createTextNode(text));return {label,input};};
  const fingerprint=id=>node('code',id?.match(/.{1,8}/g)?.join(' ')||'Unavailable','handoff-fingerprint');
  const body=node('div'),status=node('p','Loading local pairing…','handoff-note'),error=node('p',undefined,'handoff-error');status.setAttribute('role','status');error.setAttribute('role','alert');
  const selected=new Map();let state,key='',busy=false,previewId,pendingLink='';
  container.classList.add('handoff-panel');container.append(node('h3','Pair routines. Keep control.'),node('p','Protected device identities and explicit receiving consent. LAN transfer is disabled in this build; offline routine files remain available.','handoff-note'),status,error,body);
  async function run(fn){if(busy)return;busy=true;container.setAttribute('aria-busy','true');error.textContent='';try{await fn();}catch(e){error.textContent=e.message||'Pairing could not complete.';}finally{busy=false;container.removeAttribute('aria-busy');}}
  async function invoke(action,args={}){const r=await adapter.invoke(action,args);if(!r.ok)throw Error(r.error||'Pairing could not complete.');render(r.result);return r.result;}
  const card=(title)=>{const c=node('article',undefined,'handoff-card');c.append(node('h4',title));return c;};
  function render(next){const nextKey=JSON.stringify(next);if(nextKey===key)return;key=nextKey;state=next;status.textContent=next.note;body.replaceChildren();
   const s=next.identity,identity=card('This device');identity.append(node('p',s.protection||'Set up a protected identity before pairing.','handoff-note'));
   if(s.fingerprint)identity.append(fingerprint(s.fingerprint));if(s.error)identity.append(node('p',s.error,'handoff-error'));
   if(s.status==='uninitialized'){const ack=choice('Create a protected identity for routine pairing');ack.input.dataset.handoff='setup-confirm';const create=button('Create device identity',()=>invoke('setup',{confirmed:ack.input.checked}),'setup');create.disabled=true;ack.input.onchange=()=>{create.disabled=!ack.input.checked;};identity.append(ack.label,create);}
   else {const recovery=node('details');recovery.append(node('summary','Replace device identity'));const ack=choice('Replace this identity and clear its saved pairings. Every device must enroll again.');ack.input.dataset.handoff='replace-confirm';const replace=button('Replace identity',()=>invoke('replace',{confirmed:ack.input.checked,expectedFingerprint:s.fingerprint||s.previousFingerprint||'unavailable'}),'replace');replace.disabled=true;ack.input.onchange=()=>{replace.disabled=!ack.input.checked;};recovery.append(ack.label,replace);identity.append(recovery);}
   body.append(identity);if(s.status!=='ready')return;
   const invite=card('Pair a device');invite.append(node('p','Generate an invitation on each device. Opening a link does not verify the device or grant any control.','handoff-note'),button('Generate invitation',()=>invoke('invite'),'invite'));
   if(next.invitation){const image=node('img');image.alt='Public device enrollment invitation QR code';image.width=280;image.height=280;if(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(next.invitation.qr))image.src=next.invitation.qr;image.className='handoff-qr';
    const link=node('textarea');link.readOnly=true;link.value=next.invitation.link;link.rows=3;link.setAttribute('aria-label','Public enrollment invitation');link.dataset.handoff='invitation';invite.append(image,link,node('p','Expires at '+new Date(next.invitation.expiresAt).toLocaleTimeString()+'.','handoff-note'));}
   const linkInput=node('textarea');linkInput.rows=3;linkInput.maxLength=400;linkInput.value=pendingLink;linkInput.oninput=()=>{pendingLink=linkInput.value;};linkInput.placeholder='Paste the other device’s lightsout-handoff:// invitation';linkInput.dataset.handoff='link';linkInput.setAttribute('aria-label','Other device invitation');invite.append(linkInput,button('Open invitation',()=>invoke('open',{link:linkInput.value.trim()}),'open'));
   if(adapter.scan)invite.append(button('Scan invitation',async()=>{const r=await adapter.scan();if(!r.ok)throw Error(r.error||'Scan cancelled');render(r.result);},'scan'));
   if(next.opened&&!next.pairings.some(p=>p.fingerprint===next.opened.fingerprint)){const waiting=card('Awaiting secure identity proof');waiting.append(fingerprint(next.opened.fingerprint),node('p','Invitation opened. Enrollment approval becomes available only after the local transport authenticates this exact certificate.','handoff-note'));invite.append(waiting);}body.append(invite);
   for(const p of next.pairings){const c=card('Verify '+(p.platform==='android'?'Android phone':'Windows PC'));c.dataset.pairingId=p.id;c.append(node('p','TLS certificate verified. Compare this full fingerprint on the other device.'),fingerprint(p.fingerprint));const label=node('input');label.maxLength=60;label.value=p.platform==='android'?'Android phone':'Windows PC';label.setAttribute('aria-label','Local name for this device');label.dataset.handoff='label';
    const replacement=node('select');replacement.setAttribute('aria-label','Previous device identity to replace');const fresh=node('option','Enroll as a new device');fresh.value='';replacement.append(fresh);for(const old of next.peers.filter(old=>old.id!==p.fingerprint)){const o=node('option','Replace '+old.label+' · '+old.id.slice(0,8));o.value=old.id;replacement.append(o);}
    const ack=choice('I compared the full fingerprint and approve this device for routine transfer only.');ack.input.dataset.handoff='pair-confirm';const approve=button('Approve enrollment',()=>invoke('approve',{id:p.id,fingerprint:p.fingerprint,label:label.value,replaceId:replacement.value}),'approve');approve.disabled=true;ack.input.onchange=()=>{approve.disabled=!ack.input.checked;};c.append(label,replacement,ack.label,approve,button('Reject',()=>invoke('reject',{id:p.id}),'reject'));body.append(c);}
   const devices=card('Trusted devices');if(!next.peers.length)devices.append(node('p','No devices enrolled.','handoff-note'));
   for(const p of next.peers){const c=card(p.label);c.dataset.peerId=p.id;c.append(node('p',p.revoked?'Revoked · transfers and imports blocked':p.connected?'Securely connected':'Saved pairing · disconnected','handoff-note'),fingerprint(p.id));
    if(p.revoked)c.append(node('p','Re-enrollment requires a fresh invitation and explicit identity approval.','handoff-note'));
    else {c.append(button('Revoke device',()=>invoke('revoke',{id:p.id}),'revoke'));if(p.connected){c.append(button('Request a routine',()=>invoke('receive',{peerId:p.id}),'receive'));const sources=node('div',undefined,'handoff-sources'),picked=selected.get(p.id)||new Set();selected.set(p.id,picked);
      for(const source of next.sources){const row=choice(source.name),value=JSON.stringify({kind:source.kind,id:source.id});row.input.value=value;row.input.checked=picked.has(value);row.input.onchange=()=>{row.input.checked?picked.add(value):picked.delete(value);};sources.append(row.label);}
      const offer=button('Offer selected routines',()=>invoke('offer',{peerId:p.id,selection:[...picked].map(v=>JSON.parse(v))}),'offer');offer.disabled=!p.canOffer;c.append(sources,offer);if(!p.canOffer)c.append(node('p','The recipient must request a fresh transfer before you can offer routines.','handoff-note'));
    }}devices.append(c);
   }body.append(devices);
   for(const o of next.offers){const c=card('Incoming routine offer');c.dataset.offerId=o.id;c.append(node('p',o.bytes+' bytes · expires '+new Date(o.expiresAt).toLocaleTimeString()),fingerprint(o.peerId),node('p','File SHA-256','handoff-note'),fingerprint(o.sha256));const ack=choice('Accept this offer for preview only. Nothing will be saved or activated.');ack.input.dataset.handoff='offer-confirm';const accept=button('Accept for preview',()=>invoke('accept',{id:o.id,confirmed:ack.input.checked}),'accept');accept.disabled=true;ack.input.onchange=()=>{accept.disabled=!ack.input.checked;};c.append(ack.label,accept,button('Reject offer',()=>invoke('rejectOffer',{id:o.id}),'reject-offer'));body.append(c);}
   if(next.preview){const c=card('Received routine preview'),peer=next.peers.find(p=>p.id===next.preview.peerId);c.dataset.previewId=next.preview.id;body.append(c);
    if(!peer||peer.revoked||!peer.connected)c.append(node('p','This peer is revoked or disconnected. Import is blocked; request a fresh transfer.','handoff-error'));
    else {previewId=next.preview.id;const viewer=node('div');c.append(viewer);const transfer=RoutineTransferUI.mount(viewer,{platform:adapter.platform,receiveOnly:true,list:async()=>({choices:[],drafts:[],lights:[]}),preview:async()=>next.preview.value,commitImport:async(_text,policy)=>{const id=previewId;await invoke('save',{id,confirmed:true,policy});adapter.onImported?.();return {count:next.preview.value.document.routines.length};}});void transfer.ready.then(()=>transfer.preview(JSON.stringify(next.preview.value.document)));}
    c.append(button('Dismiss preview',()=>invoke('dismiss'),'dismiss'));
   }
  }
  async function refresh(){return invoke('status');}
  void run(refresh);const timer=setInterval(()=>{if(!document.hidden&&container.getClientRects().length&&(!container.closest('details')||container.closest('details').open))void run(refresh);},2000);
  return {refresh:()=>run(refresh),prefill(link){pendingLink=link;key='';if(state)render(state);},destroy(){clearInterval(timer);},state:()=>state};
 }
 root.HandoffUI={mount};
})(globalThis);
