'use strict';
// New app-owned handoff identity only. No existing credentials or signing keys.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const trust=require('./handoffTrust');
function atomicWrite(file,bytes,verify){
 const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),tmp=file+'.'+crypto.randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;verify(fs.readFileSync(tmp));fs.renameSync(tmp,file);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function createIdentity({directory,safeStorage=require('./handoffProtectionWindows').createProtection(),platform=process.platform,clock=trust.guardedClock(),generate=generateIdentity}){
 const anchor=path.join(directory,'anchor.json'),sealed=path.join(directory,'protected.bin');
 const fail=message=>{throw Error(message);};
 function bounded(file,max){if(fs.statSync(file).size>max)fail('Invalid identity storage size');return fs.readFileSync(file);}
 function available(){if(platform!=='win32'||!safeStorage?.isEncryptionAvailable())fail('Windows protected storage is unavailable. Pairing is disabled.');}
 function publicRecord(r){return {status:'ready',platform:'windows',fingerprint:r.fingerprint,createdAt:r.createdAt,expiresAt:new crypto.X509Certificate(r.cert).validTo,protection:'Windows DPAPI · protected at rest',nonExportable:false};}
 function load(){
  available();try{
   if(!fs.existsSync(anchor)&&!fs.existsSync(sealed))fail('Create a device identity to begin pairing.');
   const anchorText=bounded(anchor,1024).toString('utf8'),a=JSON.parse(anchorText);if(JSON.stringify(a)!==anchorText||Object.keys(a).sort().join(',')!=='fingerprint,installId,version'||a.version!==1||!/^[a-f0-9-]{36}$/.test(a.installId)||!/^[a-f0-9]{64}$/.test(a.fingerprint))fail('Invalid anchor');
   const raw=safeStorage.decryptString(bounded(sealed,262144)),r=JSON.parse(raw);if(JSON.stringify(r)!==raw||Object.keys(r).sort().join(',')!=='cert,createdAt,fingerprint,installId,lastWall,privateKey,trust,version')fail('Ambiguous protected record');
   if(r.version!==1||r.installId!==a.installId||r.fingerprint!==a.fingerprint||!Number.isSafeInteger(r.lastWall)||!Number.isSafeInteger(r.createdAt)||r.createdAt<=0||r.createdAt>r.lastWall||typeof r.privateKey!=='string'||typeof r.cert!=='string')fail('Identity mismatch');
   const cert=new crypto.X509Certificate(r.cert),fingerprint=crypto.createHash('sha256').update(cert.raw).digest('hex');
   const now=clock.now(r.lastWall);if(fingerprint!==r.fingerprint||!cert.checkPrivateKey(crypto.createPrivateKey(r.privateKey))||now>Date.parse(cert.validTo)||now<Date.parse(cert.validFrom))fail('Identity mismatch');
   r.trust=trust.validate(r.trust,r.fingerprint);return r;
  }catch(error){if(error.message==='Create a device identity to begin pairing.'||error.message.startsWith('Device clock moved backwards.'))throw error;fail('Device identity or trust storage is missing, replaced or corrupt. Explicit identity replacement and re-enrollment are required.');}
 }
 function write(r){available();r.lastWall=clock.now(r.lastWall);const bytes=safeStorage.encryptString(JSON.stringify(r));if(!Buffer.isBuffer(bytes)||!bytes.length)fail('Protected storage failed; no plaintext fallback is allowed.');
  fs.mkdirSync(directory,{recursive:true});try{atomicWrite(sealed,bytes,data=>{const check=JSON.parse(safeStorage.decryptString(data));if(check.fingerprint!==r.fingerprint)throw Error('Protected write verification failed');});}catch{fail('Could not save protected pairing data. Pairing remains blocked until a safe retry.');}
 }
 return {
  status(){try{return publicRecord(load());}catch(error){let previousFingerprint;try{const a=JSON.parse(bounded(anchor,1024).toString('utf8'));if(/^[a-f0-9]{64}$/.test(a.fingerprint))previousFingerprint=a.fingerprint;}catch{}return {status:!fs.existsSync(anchor)&&!fs.existsSync(sealed)?'uninitialized':'blocked',platform:'windows',previousFingerprint,error:error.message};}},
  async initialize({confirmed=false,replace=false,expectedFingerprint=null}={}){
   available();if(!confirmed)fail('Confirm creation or replacement of this device identity.');if(!replace&&(fs.existsSync(anchor)||fs.existsSync(sealed)))fail('An identity already exists or needs explicit recovery.');
   if(replace){const state=this.status();if(expectedFingerprint!==(state.fingerprint||state.previousFingerprint||'unavailable'))fail('Device identity changed since confirmation. Review it again.');}
   const identity=await generate(),now=clock.now(),installId=crypto.randomUUID();const r={version:1,installId,fingerprint:identity.fingerprint,cert:identity.cert,privateKey:identity.privateKey,createdAt:now,lastWall:now,trust:trust.empty(identity.fingerprint)};
   write(r);try{atomicWrite(anchor,JSON.stringify({version:1,installId,fingerprint:r.fingerprint}),data=>JSON.parse(data.toString()));}catch{fail('Identity anchor could not be saved; pairing remains blocked.');}return publicRecord(load());
  },
  now(){const r=load();return clock.now(r.lastWall);},
  publicCertificate(){return load().cert;},
  withTls(visitor){const r=load(),key=Buffer.from(r.privateKey);try{return visitor({key,cert:r.cert});}finally{key.fill(0);}},
  trustStore(localId){return {read(){const r=load();if(r.fingerprint!==localId)fail('Device identity changed; re-enrollment is required.');return r.trust;},write(value){const r=load();r.trust=trust.validate(value,localId);write(r);}};}
 };
}
async function generateIdentity(){
 require('reflect-metadata');const x509=require('@peculiar/x509'),webcrypto=crypto.webcrypto;x509.cryptoProvider.set(webcrypto);
 const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),now=Date.now();
 const cert=await x509.X509CertificateGenerator.createSelfSigned({serialNumber:crypto.randomBytes(16).toString('hex'),name:'CN=Lights Out routine handoff',notBefore:new Date(now-60000),notAfter:new Date(now+365*86400000),signingAlgorithm:{name:'ECDSA',hash:'SHA-256'},keys,extensions:[new x509.BasicConstraintsExtension(true,0,true),new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1','1.3.6.1.5.5.7.3.2']),new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature|x509.KeyUsageFlags.keyCertSign,true)]});
 const privateBytes=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey));try{const privateKey=crypto.createPrivateKey({key:privateBytes,format:'der',type:'pkcs8'}).export({type:'pkcs8',format:'pem'});const pem=cert.toString('pem');return {cert:pem,privateKey,fingerprint:crypto.createHash('sha256').update(new crypto.X509Certificate(pem).raw).digest('hex')};}finally{privateBytes.fill(0);}
}
module.exports={createIdentity,generateIdentity};
