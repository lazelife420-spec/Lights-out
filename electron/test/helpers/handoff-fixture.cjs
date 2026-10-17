'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),tls=require('node:tls'),{execFileSync}=require('node:child_process');
const {fingerprint}=require('../../routineHandoff');
function createIdentities(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lightsout-sdh-test-')),openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  const identities=['windows','android','unknown'].map(name=>{
    const keyFile=path.join(root,name+'.key.pem'),certFile=path.join(root,name+'.cert.pem'),p12=path.join(root,name+'.p12');
    execFileSync(openssl,['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE','-keyout',keyFile,'-out',certFile],{windowsHide:true,stdio:'ignore'});
    execFileSync(openssl,['pkcs12','-export','-inkey',keyFile,'-in',certFile,'-name','qa','-passout','pass:local-qa-only','-keypbe','PBE-SHA1-3DES','-certpbe','PBE-SHA1-3DES','-macalg','sha1','-out',p12],{windowsHide:true,stdio:'ignore'});
    const cert=fs.readFileSync(certFile),key=fs.readFileSync(keyFile),id=fingerprint(new (require('node:crypto').X509Certificate)(cert).raw);return {name,cert,key,id,p12,certFile};
  });
  return {root,identities,close(){const resolved=fs.realpathSync(root);if(path.dirname(resolved)!==fs.realpathSync(os.tmpdir())||!/^lightsout-sdh-test-[A-Za-z0-9]+$/.test(path.basename(resolved)))throw Error('Unexpected QA identity path');fs.rmSync(resolved,{recursive:true,force:true});}};
}
async function pair(a,b){
  const sockets=new Set();let resolveServer,rejectServer;
  const accepted=new Promise((resolve,reject)=>{resolveServer=resolve;rejectServer=reject;});
  const server=tls.createServer({key:b.key,cert:b.cert,ca:[a.cert],requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.2'},s=>{sockets.add(s);s.on('error',()=>{});resolveServer(s);});
  server.on('tlsClientError',rejectServer);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const client=tls.connect({host:'127.0.0.1',port:server.address().port,servername:'localhost',key:a.key,cert:a.cert,ca:[b.cert],rejectUnauthorized:true,minVersion:'TLSv1.2'});sockets.add(client);
  await new Promise((resolve,reject)=>{client.once('secureConnect',resolve);client.once('error',reject);});
  const remote=await accepted;
  return {a:client,b:remote,async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
module.exports={createIdentities,pair};
