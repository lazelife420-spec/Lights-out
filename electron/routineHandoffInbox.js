'use strict';
const {Endpoint}=require('./routineHandoff'),{interchange}=require('./routineModel');
// Local UI coordinator only. No incoming network command may call save().
function createInbox(book,store){
  const ready=new Map(),endpoint=new Endpoint(book,{validate:interchange.parse,preview:text=>store.preview(text)});
  return {endpoint,
    receive(proof,frame){if(ready.size>=8)throw Error('Review or dismiss pending transfers first');const r=endpoint.receiveDocument(proof,frame);ready.set(r.sessionId,{text:r.document,proof,expires:r.expiresAt});return {sessionId:r.sessionId,preview:r.preview};},
    save(id,{confirmed=false,policy='reject'}={}){const r=ready.get(id);if(!r||!confirmed)throw Error('Confirm the received preview before importing');book.check(r.proof);if(r.expires<=book.clock()){ready.delete(id);throw Error('Received preview expired');}const result=store.import(r.text,policy);ready.delete(id);return result;},
    dismiss(id){ready.delete(id);endpoint.cancel(id);}
  };
}
module.exports={createInbox};
