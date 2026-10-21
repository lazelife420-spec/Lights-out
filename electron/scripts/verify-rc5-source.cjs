'use strict';
// Read-only custody check. Does not build, install, launch Electron or actuate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/rc5/source-custody.json'),'utf8'));
const digest=(algorithm,bytes)=>crypto.createHash(algorithm).update(bytes).digest('hex');
const objectId=(kind,bytes)=>digest('sha1',Buffer.concat([Buffer.from(`${kind} ${bytes.length}\0`),bytes]));
function tree(entries){
  const groups=new Map();
  for(const entry of entries){const [name,...rest]=entry.file.split('/');if(!groups.has(name))groups.set(name,[]);groups.get(name).push({...entry,file:rest.join('/')});}
  const nodes=[...groups].map(([name,items])=>items[0].file?{name,mode:'40000',id:tree(items),sort:name+'/'}:{name,mode:'100644',id:items[0].blob,sort:name});
  nodes.sort((a,b)=>Buffer.compare(Buffer.from(a.sort),Buffer.from(b.sort)));
  return objectId('tree',Buffer.concat(nodes.map(n=>Buffer.concat([Buffer.from(`${n.mode} ${n.name}\0`),Buffer.from(n.id,'hex')]))));
}
function sourceBytes(file){assert.ok(/^(electron|docs)\//.test(file)&&!file.split('/').includes('..'));return fs.readFileSync(path.join(root,file));}
for(const entry of manifest.qualifiedSourceFiles)assert.equal(digest('sha256',sourceBytes(entry.file)),entry.sha256,`Qualified source drift: ${entry.file}`);
assert.equal(digest('sha256',sourceBytes('electron/package-lock.json')),manifest.packageLockSha256);
assert.equal(JSON.parse(sourceBytes('electron/package.json')).lightsOutDistribution,undefined,'Source edition must remain unmarked');
const inputs=manifest.packagedInputs.map(entry=>{
  let bytes=sourceBytes('electron/'+entry.file);
  assert.equal(digest('sha256',bytes),entry.sourceSha256,`Source preimage drift: ${entry.file}`);
  if(entry.file==='package.json')bytes=Buffer.from(JSON.stringify({...JSON.parse(bytes),lightsOutDistribution:'portable'},null,2)+'\n');
  assert.equal(digest('sha256',bytes),entry.sha256,`Packaged input drift: ${entry.file}`);
  return{...entry,blob:objectId('blob',bytes)};
});
assert.equal(tree(inputs),manifest.packagedApplicationTreeSha1);
assert.equal(digest('sha256',Buffer.from(inputs.map(e=>`${e.file}\0${e.sha256}\n`).join(''))),manifest.packagedApplicationInputsSha256);
console.log(JSON.stringify({verdict:'RC5_SOURCE_CUSTODY_VERIFIED',qualifiedSourceFiles:manifest.qualifiedSourceFiles.length,packagedInputs:inputs.length,packagedApplicationTreeSha1:manifest.packagedApplicationTreeSha1,packageLockVerified:true,built:false,applicationLaunched:false,powerActions:0},null,2));
