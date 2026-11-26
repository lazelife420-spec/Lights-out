'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');

test('generated unsaved-work scan parses in Windows PowerShell and never assigns automatic PID',
  { skip: process.platform !== 'win32' }, async () => {
    let script;
    const moduleObject = { exports: {} };
    const context = {
      module: moduleObject,
      setTimeout, clearTimeout,
      require(name) {
        if (name === './boundedProcess') return require('../boundedProcess');
        assert.equal(name, 'child_process');
        return { spawn(_file, args) {
          script = args.at(-1);
          const child = new EventEmitter();
          child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
          setImmediate(() => child.emit('close', 0));
          return child;
        } };
      }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../unsavedGuard.js'), 'utf8'), context);
    await moduleObject.exports.scanUnsavedWork();
    assert.equal(typeof script, 'string');
    const parser = `
$scanSource=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(script).toString('base64')}'))
$scanTokens=$null; $scanErrors=$null
$scanAst=[Management.Automation.Language.Parser]::ParseInput($scanSource,[ref]$scanTokens,[ref]$scanErrors)
$pidWrites=@($scanAst.FindAll({
 param($scanNode)
 if($scanNode -is [Management.Automation.Language.AssignmentStatementAst]) {
  return @($scanNode.Left.FindAll({param($leftNode) $leftNode -is [Management.Automation.Language.VariableExpressionAst] -and $leftNode.VariablePath.UserPath -ieq 'PID'},$true)).Count -gt 0
 }
 return $false
},$true)).Count
[pscustomobject]@{errors=@($scanErrors | ForEach-Object Message);automaticPidWrites=$pidWrites} | ConvertTo-Json -Compress
`;
    const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const result = JSON.parse(execFileSync(powershell, ['-NoProfile', '-EncodedCommand', Buffer.from(parser, 'utf16le').toString('base64')],
      { windowsHide: true, encoding: 'utf8', timeout: 10000 }));
    assert.deepEqual(result.errors, [], 'PowerShell must not silently skip an invalid window scan');
    assert.equal(result.automaticPidWrites, 0, 'The read-only PID variable cannot hold a window process ID');
  });
