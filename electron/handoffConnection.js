'use strict';
// Public connection details only. No timer/control grant, private key or discovery.
const crypto=require('node:crypto'),net=require('node:net'),os=require('node:os'),tls=require('node:tls');
const h=require('./routineHandoff');
const FORMAT='lights-out.pairing',MAX_CARD=8192;
function check(ok,message){if(!ok)throw Error(message);}
function privateAddress(host){
 if(typeof host!=='string'||net.isIP(host)!==4)return false;
 const [a,b]=host.split('.').map(Number);
 return host==='127.0.0.1'||a===10||a===172&&b>=16&&b<=31||a===192&&b===168;
}
function addresses(){return [...new Set(['127.0.0.1',...Object.values(os.networkInterfaces()).flat().filter(n=>n&&n.family==='IPv4'&&!n.internal&&privateAddress(n.address)).map(n=>n.address)])];}
function parseCard(text,now=Date.now()){
 check(typeof text==='string'&&Buffer.byteLength(text)<=MAX_CARD,'Invalid pairing details size.');
 let card;try{card=JSON.parse(text);}catch{throw Error('Invalid pairing details. Paste the complete public details.');}
 check(card&&JSON.stringify(card)===text.replace(/\\\//g,'/')&&Object.keys(card).sort().join(',')==='certificate,format,host,invitation,port,version'&&card.format===FORMAT&&card.version===1,'Unsupported pairing details.');
 const invite=h.parseInvitation(card.invitation,now);
 check(typeof card.certificate==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(card.certificate)&&card.certificate.length<=4096,'Invalid pairing certificate.');
 const der=Buffer.from(card.certificate,'base64');check(der.toString('base64')===card.certificate,'Invalid pairing certificate encoding.');
 const certificate=new crypto.X509Certificate(der);
 check(certificate.raw.equals(der)&&h.fingerprint(der)===invite.id&&now>=Date.parse(certificate.validFrom)&&now<=Date.parse(certificate.validTo),'Invalid pairing certificate identity or validity.');
 check(certificate.publicKey.asymmetricKeyType==='ec'&&certificate.publicKey.asymmetricKeyDetails?.namedCurve==='prime256v1'&&certificate.verify(certificate.publicKey),'Unsupported pairing certificate key.');
 check(card.host===null&&card.port===null||privateAddress(card.host)&&Number.isInteger(card.port)&&card.port>=1024&&card.port<=65535,'Invalid pairing endpoint. Use a private IPv4 address.');
 return {card,invite,certificate};
}
function makeCard(identity,invitation,host=null,port=null){
 const certificate=new crypto.X509Certificate(identity.publicCertificate()).raw.toString('base64');
 const text=JSON.stringify({format:FORMAT,version:1,invitation,certificate,host,port});parseCard(text,identity.now());return text;
}
function createListener({identity,attach,localAddresses=addresses}){
 let server=null,timer=null,details=null,starting=false,generation=0,rejectStarting=null;
 const sockets=new Set();
 function stop(){generation++;clearTimeout(timer);timer=null;const prior=server;server=null;details=null;starting=false;const reject=rejectStarting;rejectStarting=null;reject?.(Error('Pairing window was closed.'));for(const s of sockets)s.destroy();sockets.clear();if(prior)prior.close(()=>{});}
 function status(){return {state:server?.listening?'LISTENING':starting?'STARTING':'OFF',addresses:localAddresses(),card:details?.card||null,expiresAt:details?.expiresAt||null};}
 async function start({peerCard,host,confirmed}){
  check(confirmed===true,'Confirm opening a temporary pairing window.');
  check(!server&&!starting,'Pairing window is already open. Close it before retrying.');
  check(localAddresses().includes(host)&&privateAddress(host),'Choose an address on this PC.');
  const peer=parseCard(peerCard,identity.now());check(peer.invite.platform==='android'&&peer.card.host===null,'Choose phone pairing details.');
  starting=true;const epoch=++generation;let attempts=0,accepted=false;
  try{
   const ownInvite=h.invitation(identity.status().fingerprint,'windows',identity.now());
   const expiresAt=Math.min(peer.invite.expires,h.parseInvitation(ownInvite,identity.now()).expires);
   const current=identity.withTls(options=>tls.createServer({...options,ca:[peer.certificate.toString()],requestCert:true,rejectUnauthorized:true,allowPartialTrustChain:true,minVersion:'TLSv1.2',handshakeTimeout:8000},socket=>{
    // After TLS wraps a transport, own the TLS socket, never tear down its
    // underlying raw handle a second time while TLS cleanup is still pending.
    for(const raw of sockets)if(raw.remoteAddress===socket.remoteAddress&&raw.remotePort===socket.remotePort&&raw.localPort===socket.localPort)sockets.delete(raw);
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
    try{if(epoch!==generation||accepted||identity.now()>=expiresAt)throw Error('Expired pairing window');h.authenticateSocket(socket,identity.status().fingerprint,peer.invite.id);}catch{socket.destroy();return;}
    accepted=true;clearTimeout(timer);current.close();server=null;details=null;
    void Promise.resolve(attach(socket,peer.card.invitation)).catch(()=>socket.destroy());
   }));
   server=current;current.maxConnections=4;
   current.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));if(++attempts>8)stop();});
   current.on('tlsClientError',()=>{});current.on('error',()=>{if(epoch===generation)stop();});
   await new Promise((resolve,reject)=>{rejectStarting=reject;current.once('error',reject);current.listen(0,host,()=>{rejectStarting=null;resolve();});});
   check(epoch===generation,'Pairing window was closed.');
   details={expiresAt,card:makeCard(identity,ownInvite,host,current.address().port)};starting=false;
   timer=setTimeout(stop,Math.max(1,expiresAt-identity.now()));timer.unref?.();return status();
  }catch(error){if(epoch===generation)stop();throw error;}
 }
 return {start,stop,status};
}
module.exports={FORMAT,MAX_CARD,privateAddress,addresses,parseCard,makeCard,createListener};
