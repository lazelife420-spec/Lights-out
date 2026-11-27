'use strict';
// Source contract for scripts/windows-installer.nsi (makensis is not run by unit tests).
// packaging-1: an upgrade clears the previous build's app-owned runtime subtrees, and only
//   when $INSTDIR verifiably holds a Lights Out install, after the unsafe-directory and
//   running-instance guards and before the new files are copied.
// packaging-3: the uninstaller removes the Run-at-login value Electron actually writes.
// Review fixes: the upgrade cleanup is gated on a PowerShell-independent in-use probe, and the
//   per-user scheduled tasks are removed only when they launch this install (the task-removal
//   PowerShell itself runs here against stubbed Task Scheduler cmdlets).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electronDir = path.join(__dirname, '..');
const pkg = require('../package.json');
const nsiLines = fs.readFileSync(path.join(electronDir, 'scripts', 'windows-installer.nsi'), 'utf8').split(/\r?\n/);
// Statements only: whole-line comments and blank lines dropped, indentation removed.
const statements = lines => lines.map(line => line.trim()).filter(line => line && !line.startsWith(';'));

function block(startPattern, endPattern) {
  const start = nsiLines.findIndex(line => startPattern.test(line));
  assert.notEqual(start, -1, `missing block ${startPattern}`);
  const end = nsiLines.findIndex((line, index) => index > start && endPattern.test(line));
  assert.notEqual(end, -1, `unterminated block ${startPattern}`);
  return statements(nsiLines.slice(start, end + 1));
}

const install = block(/^Section "Lights Out \(required\)"/, /^SectionEnd\b/);
const uninstall = block(/^Section "Uninstall"/, /^SectionEnd\b/);
const removeSubtree = block(/^Function RemoveAppOwnedSubtree\b/, /^FunctionEnd\b/);
const loginItemMacro = block(/^!macro REMOVE_OWNED_LOGIN_ITEM VALUE_NAME\b/, /^!macroend\b/);
const all = statements(nsiLines);
const indexIn = (list, pattern, from = 0) => list.findIndex((line, index) => index >= from && pattern.test(line));
// The ${EndIf} that closes the LogicLib ${If} at `start`, skipping nested ${If} blocks.
function endIfOf(list, start) {
  let depth = 0;
  for (let index = start; index < list.length; index++) {
    if (/^\$\{If\}/.test(list[index])) depth++;
    else if (/^\$\{EndIf\}$/.test(list[index]) && --depth === 0) return index;
  }
  return -1;
}
const defines = Object.fromEntries(all.map(line => line.match(/^!define (\S+) "(.*)"$/)).filter(Boolean).map(match => [match[1], match[2]]));
const expand = value => value.replace(/\$\{(\w+)\}/g, (whole, name) => (name in defines ? defines[name] : whole));

test('upgrade cleanup runs after the safety guards, only over a verified Lights Out install, before copying', () => {
  const guard = indexIn(install, /^Call IsUnsafeInstDir$/);
  const guardAbort = indexIn(install, /^Abort$/, guard);
  const running = indexIn(install, /^!insertmacro CHECK_LIGHTS_OUT_RUNNING "\$INSTDIR" "installation"$/);
  const marker = indexIn(install, /^\$\{If\} \$\{FileExists\} "\$INSTDIR\\Uninstall\.exe"$/);
  const markerEnd = endIfOf(install, marker);
  const copy = indexIn(install, /^File \/r /);
  assert.ok(guard >= 0 && guardAbort > guard && running > guardAbort, 'unsafe-directory guard aborts before the running check');
  assert.ok(marker > running, 'cleanup only after the running-instance guard');
  assert.ok(markerEnd > marker && copy > markerEnd, 'cleanup finishes before File /r');
  assert.deepEqual(install.slice(marker, marker + 3), [
    '${If} ${FileExists} "$INSTDIR\\Uninstall.exe"',
    '${AndIf} ${FileExists} "$INSTDIR\\Lights Out.exe"',
    '${AndIf} ${FileExists} "$INSTDIR\\resources\\app\\package.json"',
  ], 'all three markers of an earlier Lights Out install are required');
  const cleanup = install.slice(marker, markerEnd);
  assert.deepEqual(cleanup.filter(line => line.startsWith('StrCpy $0 ')), ['StrCpy $0 "$INSTDIR\\resources"', 'StrCpy $0 "$INSTDIR\\locales"'],
    'only the Electron runtime subtrees are cleared, never $INSTDIR itself');
  assert.equal(cleanup.filter(line => line === 'Call RemoveAppOwnedSubtree').length, 2);
  assert.ok(indexIn(cleanup, /^Push \$0$/) >= 0 && indexIn(cleanup, /^Pop \$0$/) > indexIn(cleanup, /^Call RemoveAppOwnedSubtree$/), '$0 is preserved');
});

test('the only recursive delete is the junction-safe subtree helper, and the uninstaller never recurses', () => {
  assert.deepEqual(all.filter(line => /^RMDir\s+\/r\b/i.test(line)), ['RMDir /r "$0"']);
  const body = removeSubtree.join('\n');
  assert.match(body, /System::Call 'kernel32::GetFileAttributesW\(w "\$0"\) i \.r1'\n\$\{If\} \$1 <> -1\nIntOp \$2 \$1 & 1040\n\$\{If\} \$2 = 16\nRMDir \/r "\$0"/,
    'removes only an existing real directory (directory bit set, reparse-point bit clear)');
  assert.equal(all.filter(line => line === 'Call RemoveAppOwnedSubtree').length, 2, 'called only by the install-time cleanup');
  assert.ok(uninstall.includes('!include "${UNINSTALL_MANIFEST}"'), 'uninstall stays manifest-only');
  assert.equal(uninstall.some(line => /^RMDir\s+\/r/i.test(line)), false);
});

// The ProductName the packaging stamps on Lights Out.exe: stamp-windows-identity.ps1's default,
// which package-native-windows.ps1 must not override, and which verify-windows-identity.ps1 expects.
function stampedProductName() {
  const read = name => fs.readFileSync(path.join(electronDir, 'scripts', name), 'utf8');
  const stamped = read('stamp-windows-identity.ps1').match(/\[string\]\$ProductName = '([^']+)'/);
  assert.ok(stamped, 'stamp-windows-identity.ps1 declares a ProductName default');
  const call = read('package-native-windows.ps1').match(/^\s*& \$stampScript (.*)$/m);
  assert.ok(call, 'package-native-windows.ps1 runs the identity stamp');
  assert.doesNotMatch(call[1], /-ProductName\b/, 'the packaged exe keeps the stamp script\'s ProductName');
  assert.match(read('verify-windows-identity.ps1'), new RegExp(`\\[string\\]\\$ExpectedProductName = '${stamped[1]}'`));
  return stamped[1];
}

// Electron 43's default AppUserModelId on Windows is "electron.app.<ProductName of the running exe>"
// (GetRawAppUserModelID reads the exe's version resource, not app.name), and setLoginItemSettings()
// without a `name` writes the Run value under it. The package.json-name form is the hedge.
const electronDefaultLoginItemName = 'electron.app.' + stampedProductName();
const appNameLoginItemName = 'electron.app.' + (pkg.productName || pkg.name);

// The Run value name Electron's app.setLoginItemSettings() writes for main.js's call.
function expectedLoginItemName() {
  const main = fs.readFileSync(path.join(electronDir, 'main.js'), 'utf8');
  const call = main.match(/app\.setLoginItemSettings\(\{([\s\S]*?)\}\);/);
  assert.ok(call, 'main.js still configures the login item');
  const explicit = call[1].match(/\bname\s*:\s*(['"])([^'"]+)\1/);
  if (explicit) return explicit[2];
  assert.doesNotMatch(call[1], /\bname\s*:/, 'a computed login-item name must be mirrored in windows-installer.nsi by hand');
  // Without a name Electron uses the AppUserModelId, which nothing overrides.
  assert.doesNotMatch(main, /setAppUserModelId/, 'an AppUserModelId override changes the Run value name');
  return electronDefaultLoginItemName;
}

test('the uninstaller removes the Run-at-login value Electron writes, and its StartupApproved twin', () => {
  const written = expectedLoginItemName();
  assert.equal(defines.ELECTRON_LOGIN_ITEM_NAME, 'electron.app.Lights Out', 'Electron names the value after the exe ProductName');
  assert.equal(defines.ELECTRON_LOGIN_ITEM_NAME, electronDefaultLoginItemName, 'the NSIS define follows the stamped ProductName');
  assert.equal(defines.ELECTRON_APP_NAME_LOGIN_ITEM_NAME, appNameLoginItemName, 'the hedge define follows electron/package.json');
  assert.equal(defines.LO_RUN_KEY, 'Software\\Microsoft\\Windows\\CurrentVersion\\Run');
  assert.equal(defines.LO_STARTUP_APPROVED_RUN_KEY, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run');

  const qaStart = indexIn(uninstall, /^\$\{If\} \$QaMode != "1"$/);
  assert.ok(qaStart >= 0, 'registration cleanup stays behind the QA guard');
  const registration = uninstall.slice(qaStart).map(expand);
  const owned = registration.map(line => line.match(/^!insertmacro REMOVE_OWNED_LOGIN_ITEM "(.+)"$/)).filter(Boolean).map(match => match[1]);
  const unconditional = key => registration.map(line => line.match(new RegExp('^DeleteRegValue HKCU "' + key.replace(/\\/g, '\\\\') + '" "(.+)"$'))).filter(Boolean).map(match => match[1]);
  const removedFrom = key => new Set([...owned, ...unconditional(key)]);
  // Existing installs carry the Electron default name even if main.js later names the item explicitly.
  for (const name of new Set([written, electronDefaultLoginItemName, appNameLoginItemName, 'Lights Out', 'LightsOut'])) {
    for (const key of [defines.LO_RUN_KEY, defines.LO_STARTUP_APPROVED_RUN_KEY]) {
      assert.ok(removedFrom(key).has(name), `${name} is removed from HKCU\\${key}`);
    }
  }
  for (const name of [electronDefaultLoginItemName, appNameLoginItemName]) {
    assert.ok(owned.includes(name), `${name} is removed only through the ownership check`);
    assert.ok(!unconditional(defines.LO_RUN_KEY).includes(name) && !unconditional(defines.LO_STARTUP_APPROVED_RUN_KEY).includes(name),
      `${name} is never deleted unconditionally, so another Lights Out copy keeps its login item`);
  }
});

test('a login item is deleted only when it launches this install, so another copy keeps its own', () => {
  const body = loginItemMacro.map(expand).join('\n');
  const read = body.indexOf('ReadRegStr $0 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${VALUE_NAME}"');
  const ownerCheck = body.indexOf('StrCpy $1 \'"$INSTDIR\\Lights Out.exe"\'\nStrLen $2 $1\nStrCpy $2 $0 $2\n${If} $2 == $1\n'
    + 'DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${VALUE_NAME}"\n'
    + 'DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "${VALUE_NAME}"');
  assert.ok(read >= 0, 'reads the Run value first');
  assert.ok(ownerCheck > read, 'deletes the Run value and its twin only when it starts with this install\'s quoted exe path');
  assert.equal((body.match(/DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run"/g) || []).length, 1,
    'no other path deletes the Run value');
  assert.match(body, /\$\{If\} \$\{Errors\}\n\$\{OrIf\} \$0 == ""\nDeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "\$\{VALUE_NAME\}"\n\$\{Else\}/,
    'without a Run value only the orphaned approval entry is dropped');
});

// packaging-hardening (review): an upgrade never deletes the runtime of a running install, even
// when CHECK_LIGHTS_OUT_RUNNING could not run (it fails open if PowerShell cannot start).
test('the upgrade cleanup proves Lights Out.exe is not in use, without PowerShell, before deleting anything', () => {
  const marker = indexIn(install, /^\$\{If\} \$\{FileExists\} "\$INSTDIR\\Uninstall\.exe"$/);
  const gate = install.slice(marker, endIfOf(install, marker) + 1);
  const open = indexIn(gate, /^FileOpen \$3 "\$INSTDIR\\Lights Out\.exe" a$/);
  const firstRemoval = indexIn(gate, /^Call RemoveAppOwnedSubtree$/);
  assert.ok(open > 0, 'the cleanup gate opens Lights Out.exe for writing');
  assert.deepEqual(gate.slice(open - 2, open), ['Push $3', 'ClearErrors'], 'the error flag is cleared right before the probe');
  assert.equal(gate[open + 1], '${If} ${Errors}', 'a failed open is checked at once');
  const failedEnd = endIfOf(gate, open + 1);
  assert.deepEqual(gate.slice(open + 1, failedEnd + 1).filter(line => !line.startsWith('MessageBox ')),
    ['${If} ${Errors}', 'Pop $3', 'IfSilent +2 0', 'SetErrorLevel 2', 'Abort', '${EndIf}'], 'an in-use exe aborts the install with error level 2');
  assert.match(gate[indexIn(gate, /^IfSilent \+2 0$/, open) + 1], /^MessageBox MB_OK\|MB_ICONSTOP ".*is in use and cannot be replaced/,
    'interactive installs explain why; IfSilent +2 skips exactly that message box');
  assert.deepEqual(gate.slice(failedEnd + 1, failedEnd + 3), ['FileClose $3', 'Pop $3'], 'a successful probe closes its handle');
  assert.ok(firstRemoval > failedEnd, 'nothing is removed before the probe has passed');
  assert.equal(gate.slice(0, failedEnd).some(line => /^(RMDir|Delete|Call RemoveAppOwnedSubtree)\b/i.test(line)), false,
    'nothing before the probe deletes a file or directory');
});

// packaging-hardening (review): the autopilot watchdog and First Light tasks are per Windows user,
// so the uninstaller removes each only when it launches this install, as watchdog.js deleteTask does.
const taskMacro = block(/^!macro REMOVE_OWNED_SCHEDULED_TASK TASK_NAME\b/, /^!macroend\b/);
const taskNameIn = file => {
  const match = fs.readFileSync(path.join(electronDir, file), 'utf8').match(/^const TASK_NAME = '([^']+)';$/m);
  assert.ok(match, `${file} declares its TASK_NAME`);
  return match[1];
};
const watchdogTaskName = taskNameIn('watchdog.js');
const firstLightTaskName = taskNameIn('alarm.js');

function taskRemovalCommand() {
  const exec = taskMacro.filter(line => line.startsWith('nsExec::ExecToStack '));
  assert.equal(exec.length, 1, 'the macro runs one command');
  const inner = exec[0].match(/^nsExec::ExecToStack `(.*)`$/);
  assert.ok(inner, 'the command is a backtick-quoted NSIS string');
  const command = inner[1].match(/^"\$SYSDIR\\WindowsPowerShell\\v1\.0\\powershell\.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "(.*)"$/);
  assert.ok(command, 'it runs the system Windows PowerShell with one -Command argument');
  return { line: inner[1], payload: command[1] };
}

// What NSIS hands PowerShell for a given task name: $$ is a literal $, ${TASK_NAME} the macro argument.
const nsisExpand = (text, taskName) => text.replace(/\$\$|\$\{TASK_NAME\}/g, token => (token === '$$' ? '$' : taskName));

test('the uninstaller removes the watchdog and First Light tasks only through the ownership check', () => {
  assert.equal(defines.LO_WATCHDOG_TASK_NAME, watchdogTaskName, 'the NSIS define follows watchdog.js');
  assert.equal(defines.LO_FIRST_LIGHT_TASK_NAME, firstLightTaskName, 'the NSIS define follows alarm.js');
  assert.equal(nsiLines.some(line => /schtasks/i.test(line)), false, 'no schtasks call remains, so no task is deleted unconditionally');
  assert.deepEqual(all.filter(line => /Unregister-ScheduledTask/i.test(line)), [taskMacro.find(line => /Unregister-ScheduledTask/i.test(line))],
    'only the ownership-checked macro unregisters a task');
  const qaStart = indexIn(uninstall, /^\$\{If\} \$QaMode != "1"$/);
  const registration = uninstall.slice(qaStart, endIfOf(uninstall, qaStart) + 1).map(expand);
  const removed = registration.map(line => line.match(/^!insertmacro REMOVE_OWNED_SCHEDULED_TASK "(.+)"$/)).filter(Boolean).map(match => match[1]);
  assert.deepEqual(removed, [watchdogTaskName, firstLightTaskName], 'both per-user tasks, behind the QA guard');
  assert.equal(all.filter(line => line.startsWith('!insertmacro REMOVE_OWNED_SCHEDULED_TASK ')).length, 2, 'and nowhere else');
  assert.ok(qaStart > indexIn(uninstall, /^SetErrorLevel 3$/), 'only after the still-in-use abort, so a kept install keeps its tasks');

  const body = taskMacro.join('\n');
  const setDir = body.indexOf('System::Call \'kernel32::SetEnvironmentVariableW(w "LO_CHECK_DIR", w "$INSTDIR")\'');
  const run = body.indexOf('nsExec::ExecToStack ');
  const clearDir = body.indexOf('System::Call \'kernel32::SetEnvironmentVariableW(w "LO_CHECK_DIR", i 0)\'');
  assert.ok(setDir >= 0 && run > setDir && clearDir > run, 'the install directory is handed over through LO_CHECK_DIR and cleared afterwards');
});

test('the task-removal PowerShell is escaped for NSIS and fits NSIS_MAX_STRLEN', () => {
  const { line, payload } = taskRemovalCommand();
  assert.doesNotMatch(payload, /"/, 'no double quote can end the -Command argument early');
  assert.doesNotMatch(payload.replace(/\$\$|\$\{TASK_NAME\}/g, ''), /\$/, 'every PowerShell $ is written $$, so NSIS expands no variable inside');
  assert.match(payload, /\$\$env:LO_CHECK_DIR/, 'the install directory arrives through the environment, never quoted into the command');
  // The pinned NSIS 3.11 build has NSIS_MAX_STRLEN 1024; leave room for a long $SYSDIR.
  const longest = [watchdogTaskName, firstLightTaskName].sort((a, b) => b.length - a.length)[0];
  const expanded = nsisExpand(line.replace('$SYSDIR', 'C:\\' + 'W'.repeat(60)), longest);
  assert.ok(expanded.length < 1000, `expanded command is ${expanded.length} characters`);
});

const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
// Get-ScheduledTask and Unregister-ScheduledTask replaced by fixtures (functions win over cmdlets),
// so no real scheduled task is read or touched. A missing task fails the way the real cmdlet does.
const TASK_STUBS = String.raw`
function Get-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskPath, [string]$TaskName)
  if ($env:LO_FIXTURE_MODE -eq 'unreadable') { throw 'Task Scheduler is unavailable' }
  if ($env:LO_FIXTURE_MODE -eq 'missing' -or $TaskPath -ne '\' -or $TaskName -ne $env:LO_FIXTURE_TASK) {
    Write-Error -Message 'No MSFT_ScheduledTask objects found' -ErrorId 'CmdletizationQuery_NotFound' -Category ObjectNotFound
    return
  }
  $execute = if ($env:LO_FIXTURE_MODE -eq 'com-handler') { $null } else { $env:LO_FIXTURE_EXECUTE }
  [pscustomobject]@{ TaskPath = '\'; TaskName = $TaskName; Actions = @([pscustomobject]@{ Execute = $execute; Arguments = '--minimized' }) }
}
function Unregister-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskPath, [string]$TaskName, [switch]$Confirm)
  [IO.File]::AppendAllText($env:LO_FIXTURE_LOG, "$TaskPath|$TaskName|confirm=$([bool]$Confirm)" + [Environment]::NewLine)
}
`;

test('the uninstaller\'s task removal deletes a task only when it launches this install', { skip: process.platform !== 'win32' && 'Windows PowerShell', timeout: 120000 }, t => {
  const { payload } = taskRemovalCommand();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-installer-tasks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installDir = 'C:\\Users\\Fixture\\AppData\\Local\\Programs\\Lights Out';
  let runs = 0;
  const run = (taskName, { execute = '', mode = 'present', checkDir = installDir } = {}) => {
    const log = path.join(root, `unregister-${++runs}.log`);
    const script = TASK_STUBS + nsisExpand(payload, taskName);
    const env = { ...process.env, LO_FIXTURE_TASK: taskName, LO_FIXTURE_EXECUTE: execute, LO_FIXTURE_MODE: mode, LO_FIXTURE_LOG: log };
    if (checkDir) env.LO_CHECK_DIR = checkDir; else delete env.LO_CHECK_DIR;
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { env, encoding: 'utf8', timeout: 60000, windowsHide: true });
    return { status: result.status, removed: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/) : [], output: result.stdout + result.stderr };
  };
  const expectRemoved = (outcome, taskName, why) => {
    assert.equal(outcome.status, 20, `${why}: ${outcome.output}`);
    assert.deepEqual(outcome.removed, [`\\|${taskName}|confirm=False`], `${why}: unregistered without a prompt`);
  };
  const expectKept = (outcome, status, why) => {
    assert.equal(outcome.status, status, `${why}: ${outcome.output}`);
    assert.deepEqual(outcome.removed, [], `${why}: left alone`);
  };

  // watchdog.js writes the action with schtasks /TR, so Execute keeps its quotes.
  expectRemoved(run(watchdogTaskName, { execute: `"${installDir}\\Lights Out.exe"` }), watchdogTaskName, 'this install\'s watchdog');
  // alarm.js writes an unquoted Execute; Windows paths compare case-insensitively and normalised.
  expectRemoved(run(firstLightTaskName, { execute: `  ${installDir.toUpperCase()}\\resources\\..\\LIGHTS OUT.EXE ` }), firstLightTaskName, 'this install\'s First Light alarm');

  expectKept(run(watchdogTaskName, { execute: '"C:\\Users\\Fixture\\Tools\\Lights Out\\Lights Out.exe"' }), 0, 'a portable copy\'s watchdog');
  expectKept(run(firstLightTaskName, { execute: `${installDir} Portable\\Lights Out.exe` }), 0, 'a sibling folder sharing the name prefix');
  expectKept(run(firstLightTaskName, { execute: `${installDir}\\Lights Out.exe.old` }), 0, 'a different file in this install');
  expectKept(run(watchdogTaskName, { mode: 'missing' }), 0, 'a missing task');
  expectKept(run(firstLightTaskName, { mode: 'com-handler' }), 0, 'a task without a program action');
  expectKept(run(watchdogTaskName, { mode: 'unreadable' }), 1, 'a task that cannot be read');
  expectKept(run(watchdogTaskName, { execute: `"${installDir}\\Lights Out.exe"`, checkDir: '' }), 1, 'no install directory handed over');
});

// MUI2 issues its own Icon/UninstallIcon from MUI_ICON/MUI_UNICON when the first page macro is
// inserted, so a plain `Icon "${APP_ICON}"` was silently replaced by NSIS's stock art: Setup.exe,
// Uninstall.exe and the Start-menu Uninstall shortcut showed the Nullsoft icon, not Lights Out's.
test('Setup.exe and Uninstall.exe are branded with the Lights Out icon, DPI-aware', () => {
  const firstPage = indexIn(all, /^!insertmacro MUI_(?:UN)?PAGE_/);
  assert.ok(firstPage > 0, 'the installer has MUI pages');
  const icon = indexIn(all, /^!define MUI_ICON "\$\{APP_ICON\}"$/);
  const unicon = indexIn(all, /^!define MUI_UNICON "\$\{APP_ICON\}"$/);
  assert.ok(icon >= 0 && icon < firstPage, 'MUI_ICON is defined before the first page macro');
  assert.ok(unicon >= 0 && unicon < firstPage, 'MUI_UNICON is defined before the first page macro');
  assert.deepEqual(all.filter(line => /^(?:Icon|UninstallIcon)\s/.test(line)), [], 'no plain Icon statement MUI2 would override');
  assert.ok(all.includes('ManifestDPIAware true'), 'crisp at 125% and above');
  assert.ok(all.some(line => /^BrandingText "Lights Out /.test(line)), 'the footer names Lights Out, not Nullsoft');
  // The build hands NSIS the same .ico rcedit stamps on Lights Out.exe.
  const build = fs.readFileSync(path.join(electronDir, 'scripts', 'package-native-windows.ps1'), 'utf8');
  assert.match(build, /"\/DAPP_ICON=\$\(Join-Path \$SourceRoot 'assets\\icon\.ico'\)"/);
  assert.match(build, /-IconPath \(Join-Path \$SourceRoot 'assets\\icon\.ico'\)/);
});
