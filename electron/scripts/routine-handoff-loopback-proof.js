'use strict';
// Opt-in QA command only. Creates ephemeral synthetic identities and binds
// 127.0.0.1 on a random port; never starts the application or a LAN listener.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),tls=require('node:tls'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const h=require('../routineHandoff'),{createInbox}=require('../routineHandoffInbox'),{createStore}=require('../routineInterchangeStore'),model=require('../routineModel');
const {createIdentities}=require('../test/helpers/handoff-fixture.cjs');
async function main(){
 const [inventoryFile,proofDir]=process.argv.slice(2);assert.ok(inventoryFile&&proofDir,'Pass isolated Android inventory and a new proof directory');
 const q=JSON.parse(fs.readFileSync(inventoryFile,'utf8').replace(/^\uFEFF/,''));assert.equal(q.status,'passed');assert.equal(q.productionSigningUsed,false);assert.equal(q.package,'com.lightsout.companion.debug');
 const root=path.resolve(__dirname,'../..'),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
 for(const f of q.sourceFiles){assert.ok(!/keystore|credential|\.dev\.vars|\.\./i.test(f.path));assert.equal(hash(path.join(root,'companion-android',f.path)),f.sha256,f.path);}
 fs.mkdirSync(proofDir,{recursive:false});const fixture=createIdentities(),[win,phone]=fixture.identities;const sockets=new Set();let server,child;
 const report={status:'running',startedAt:new Date().toISOString(),scope:'host loopback: Node Windows and actual Kotlin/JCA Android-compatible protocol, synthetic keys only',cases:[],sourceInputsMatched:q.sourceFiles.length,hardwareQualified:false,productionListenerEnabled:false};
 const passed=(name,evidence={})=>{report.cases.push({name,status:'passed',evidence});console.log('PASS '+name);};
 try{
  const document=JSON.stringify({format:'lights-out.routines',schemaVersion:1,routines:[{id:'handoff-night',name:'Handoff bedtime',actions:[{id:'timer',type:'timer.start',phase:'start',parameters:{seconds:600,endAction:'reminder'}}]}],rules:[]});model.interchange.parse(document);
  const input=path.join(fixture.root,'routine.json');fs.writeFileSync(input,document);
  let calendar={builtin:{rules:[]}},writes=0;const store=createStore({read:()=>calendar,write:c=>{calendar=c;writes++;}}),book=new h.TrustBook(win.id,'windows'),inbox=createInbox(book,store);
  const winInvite=h.invitation(win.id,'windows'),phoneInvite=h.invitation(phone.id,'android');
  let resolvePeer,rejectPeer;const accepted=new Promise((resolve,reject)=>{resolvePeer=resolve;rejectPeer=reject;});
  server=tls.createServer({key:win.key,cert:win.cert,ca:[phone.cert],requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3',maxVersion:'TLSv1.3'},socket=>{sockets.add(socket);socket.on('error',()=>{});resolvePeer(socket);});server.on('tlsClientError',rejectPeer);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});assert.equal(server.address().address,'127.0.0.1');
  const stdlib=path.join(q.qaRoot,'gradle-user/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib');
  const jars=[];for(const version of fs.readdirSync(stdlib))for(const digest of fs.readdirSync(path.join(stdlib,version)))for(const file of fs.readdirSync(path.join(stdlib,version,digest)))if(/^kotlin-stdlib-[0-9.]+\.jar$/.test(file))jars.push(path.join(stdlib,version,digest,file));assert.ok(jars.length);
  const classpath=[path.join(q.projectRoot,'app/build/tmp/kotlin-classes/debugUnitTest'),path.join(q.projectRoot,'app/build/tmp/kotlin-classes/debug'),...jars].join(path.delimiter);
  const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
  child=spawn(java,['-cp',classpath,'com.lightsout.companion.RoutineHandoffInterop',fixture.root,String(server.address().port),winInvite,input],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{errors+=b;});
  const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Native peer failed: '+errors)));});exit.catch(rejectPeer);
  const deadline=setTimeout(()=>rejectPeer(Error('Native TLS handshake timed out')),15000);const socket=await accepted;clearTimeout(deadline);
  const proof=h.authenticateSocket(socket,win.id,phone.id);book.enroll(phoneInvite,proof,phone.id);
  passed('Native TLS 1.3 mutually authenticates Node and Kotlin/JCA certificate identities',{protocol:socket.getProtocol(),cipher:socket.getCipher().standardName,windowsFingerprint:win.id,androidFingerprint:phone.id});
  const sender=new h.Endpoint(book,{validate:model.interchange.parse,preview:text=>store.preview(text)});
  socket.write(sender.offer(proof,document,await h.readFrame(socket)));const accept=await h.readFrame(socket);socket.write(sender.document(proof,accept));
  // Native peer must reach preview successfully before its reverse offer.
  socket.write(inbox.endpoint.request(proof));const info=inbox.endpoint.receiveOffer(proof,await h.readFrame(socket));
  passed('Windows -> Kotlin/JCA recipient authenticates, explicitly accepts, validates exact document and reaches preview',{documentSha256:h.fingerprint(Buffer.from(document))});
  socket.write(inbox.endpoint.accept(proof,info.sessionId,phone.id));const received=inbox.receive(proof,await h.readFrame(socket));assert.equal(writes,0);assert.deepEqual(received.preview.document,JSON.parse(document));assert.throws(()=>inbox.save(received.sessionId),/Confirm/);
  passed('Kotlin/JCA -> Windows enters existing read-only import preview without persistence',{writesBeforeConfirmation:writes,document:received.preview.document});
  inbox.save(received.sessionId,{confirmed:true});assert.equal(writes,1);assert.equal(calendar.portable.routines[0].adopted,false);assert.deepEqual(calendar.builtin.rules,[]);
  passed('Separate recipient confirmation saves only inactive intent through the existing Windows import store',{writes,adopted:false,schedules:0});
  await exit;assert.match(output,/PASS native Kotlin\/JCA/);report.nativeOutput=output;report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;throw e;}finally{
  for(const s of sockets)s.destroy();if(server)await new Promise(r=>server.close(r));if(child&&child.exitCode===null)child.kill();fixture.close();report.syntheticKeysRemoved=true;report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(proofDir,'loopback-report.json'),JSON.stringify(report,null,2)+'\n');
 }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
