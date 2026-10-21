'use strict';
// Direct current-user DPAPI: no Chromium profile master-key write dependency,
// child process, credential-file access, machine-wide scope or plaintext fallback.
const path=require('node:path');
let api;
function native(){
 if(api)return api;
 if(process.platform!=='win32')throw Error('Windows protected storage is unavailable. Pairing is disabled.');
 const koffi=require('koffi'),systemRoot=process.env.SystemRoot;
 if(!systemRoot||!path.isAbsolute(systemRoot))throw Error('Windows protected storage is unavailable. Pairing is disabled.');
 const blob=koffi.struct({cbData:'uint32',pbData:'void *'}),crypt=koffi.load(path.join(systemRoot,'System32','Crypt32.dll')),kernel=koffi.load(path.join(systemRoot,'System32','Kernel32.dll'));
 const args=[koffi.pointer(blob),'void *','void *','void *','void *','uint32',koffi.out(koffi.pointer(blob))];
 const protect=crypt.func('__stdcall','CryptProtectData','int',args),unprotect=crypt.func('__stdcall','CryptUnprotectData','int',args),free=kernel.func('__stdcall','LocalFree','void *',['void *']);
 function transform(input,decrypt){
  if(!Buffer.isBuffer(input)||!input.length||input.length>262144)throw Error('Invalid protected storage input.');
  const output={cbData:0,pbData:null};let view;
  try{
   if(!(decrypt?unprotect:protect)({cbData:input.length,pbData:input},null,null,null,null,1,output))throw Error('Protected storage operation failed.');
   if(!output.pbData||output.cbData<=0||output.cbData>262144)throw Error('Invalid protected storage result.');
   view=Buffer.from(koffi.decode(output.pbData,'uint8_t',output.cbData));return Buffer.from(view);
  }finally{if(view){view.fill(0);koffi.encode(output.pbData,koffi.array('uint8_t',output.cbData),view);}if(output.pbData)free(output.pbData);}
 }
 return api={transform};
}
function createProtection(){return {
 isEncryptionAvailable(){try{native();return true;}catch{return false;}},
 encryptString(text){const input=Buffer.from(text,'utf8');try{return native().transform(input,false);}finally{input.fill(0);}},
 decryptString(input){const output=native().transform(input,true);try{return output.toString('utf8');}finally{output.fill(0);}}
};}
module.exports={createProtection};
