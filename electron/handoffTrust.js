'use strict';
const {performance}=require('node:perf_hooks');
const id=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),nonce=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const requireValue=(v,m)=>{if(!v)throw Error(m);};
const fields=(o,names)=>requireValue(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===names.sort().join(','),'Pairing storage is invalid; restore or replace the device identity.');
function empty(localId){return {version:1,localId,peers:[],used:[],sessions:[]};}
function validate(s,localId){
 fields(s,['version','localId','peers','used','sessions']);requireValue(s.version===1&&id(localId)&&s.localId===localId,'Device identity changed; re-enrollment is required.');
 requireValue(Array.isArray(s.peers)&&s.peers.length<=64&&Array.isArray(s.used)&&s.used.length<=128&&Array.isArray(s.sessions)&&s.sessions.length<=128,'Pairing storage limit exceeded.');
 const peers=new Set();for(const p of s.peers){fields(p,['id','platform','revoked','label','enrolledAt','revokedAt']);requireValue(id(p.id)&&p.id!==localId&&!peers.has(p.id)&&['windows','android'].includes(p.platform)&&typeof p.revoked==='boolean'&&typeof p.label==='string'&&p.label.trim()===p.label&&p.label.length>0&&p.label.length<=60&&!/[\x00-\x1f\x7f]/.test(p.label)&&Number.isSafeInteger(p.enrolledAt)&&p.enrolledAt>0&&(p.revokedAt===null||Number.isSafeInteger(p.revokedAt)&&p.revokedAt>=p.enrolledAt)&&p.revoked===(p.revokedAt!==null),'Pairing storage has an invalid device.');peers.add(p.id);}
 for(const [key,valid]of [['used',v=>/^[a-f0-9]{64}:[a-f0-9]{32}$/.test(v)],['sessions',nonce]]){const seen=new Set();for(const r of s[key]){fields(r,['key','expires']);requireValue(typeof r.key==='string'&&valid(r.key)&&!seen.has(r.key)&&Number.isSafeInteger(r.expires)&&r.expires>0,'Pairing replay storage is invalid.');seen.add(r.key);}}
 return structuredClone(s);
}
function guardedClock({wall=Date.now,elapsed=()=>performance.now()}={}){
 const startWall=wall(),startElapsed=elapsed();let highest=startWall;
 return {now(floor=0){const raw=wall();requireValue(Number.isSafeInteger(raw)&&raw>0&&raw+5000>=floor,'Device clock moved backwards. Correct the clock before pairing.');highest=Math.max(highest,raw,startWall+Math.floor(elapsed()-startElapsed),floor);return highest;}};
}
module.exports={empty,validate,guardedClock};
