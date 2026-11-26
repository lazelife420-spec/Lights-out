'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer-receipts.js'), 'utf8'), context);
for (const action of ['sleep', 'hibernate']) test(`${action} receipts distinguish API acceptance from physical outcome`, () => {
  const receipt = { action, result: 'command_returned_success', dryRun: false, powerEvidence: { events: [{ api: 'SetSuspendState' }] } };
  context.receipt = receipt;
  assert.equal(vm.runInContext('receiptResultLabel(receipt)', context), 'API accepted · unverified');
  assert.match(vm.runInContext('receiptTruth(receipt).text', context), /accepted API request; physical power state unverified/);
  assert.equal(vm.runInContext('receiptDisplayTone(receipt).tone', context), 'warn');
  receipt.result = 'command_returned_failure';
  assert.match(vm.runInContext('receiptTruth(receipt).text', context), /API request failed/);
  receipt.dryRun = true;
  assert.match(vm.runInContext('receiptTruth(receipt).text', context), /PC power action skipped/);
});
