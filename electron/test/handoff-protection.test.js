'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {createProtection}=require('../handoffProtectionWindows');
test('Windows current-user DPAPI survives a fresh process without a profile master key',{skip:process.platform!=='win32'},()=>{
 const p=createProtection();assert.equal(p.isEncryptionAvailable(),true);
 const encrypted=p.encryptString('non-secret isolated DPAPI restart probe');
 const script="const p=require('./handoffProtectionWindows').createProtection();const value=p.decryptString(Buffer.from(process.argv[1],'base64'));if(value!=='non-secret isolated DPAPI restart probe')process.exit(1);process.stdout.write('passed')";
 assert.equal(execFileSync(process.execPath,['-e',script,encrypted.toString('base64')],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',windowsHide:true}),'passed');
});
test('Windows DPAPI rejects tampering and incomplete records',{skip:process.platform!=='win32'},()=>{
 const p=createProtection(),encrypted=p.encryptString('non-secret corruption probe');encrypted[encrypted.length-1]^=1;
 assert.throws(()=>p.decryptString(encrypted),/Protected storage operation failed/);
 assert.throws(()=>p.decryptString(Buffer.alloc(0)),/Invalid protected storage input/);
 assert.throws(()=>p.decryptString(Buffer.alloc(262145)),/Invalid protected storage input/);
});
