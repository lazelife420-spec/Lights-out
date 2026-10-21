'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { runBounded } = require('./boundedProcess');
const TASK_NAME = 'LightsOut_FirstLight';
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";

function createAlarm({ executor = spawn, exists = fs.existsSync, now = () => Date.now(), taskName = TASK_NAME } = {}) {
  if (!/^LightsOut_FirstLight(?:_QA_[a-zA-Z0-9_-]+)?$/.test(taskName)) throw new Error('Invalid First Light task identity');
  const executePS = command => runBounded({ spawn: executor, file: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', "$ErrorActionPreference='Stop'; " + command], timeoutMs: 10000, errorPrefix: 'ALARM' });
  async function getWakeAlarmStatus() {
    try {
      const raw = await executePS([
        `$t=Get-ScheduledTask -TaskName ${quote(taskName)} -ErrorAction SilentlyContinue`,
        `if (!$t) { @{exists=$false} | ConvertTo-Json -Compress; exit 0 }`,
        `$i=Get-ScheduledTaskInfo -TaskName ${quote(taskName)}`,
        `$a=@($t.Actions)[0]`,
        `@{exists=$true;state=[string]$t.State;enabled=[bool]$t.Settings.Enabled;executable=$a.Execute;arguments=$a.Arguments;targetExists=[bool](Test-Path -LiteralPath $a.Execute -PathType Leaf);nextRunTime=$(if($i.NextRunTime){$i.NextRunTime.ToUniversalTime().ToString('o')}else{$null})} | ConvertTo-Json -Compress`
      ].join('; '));
      const task = JSON.parse(raw);
      if (!task.exists) return { active: false, code: 'NOT_SCHEDULED' };
      if (!task.targetExists) return { active: false, code: 'TARGET_MISSING', error: 'First Light needs rescheduling: its application is missing.' };
      const next = Date.parse(task.nextRunTime);
      if (!task.enabled || !['ready', 'running'].includes(String(task.state).toLowerCase()) || !Number.isFinite(next) || next <= now()) {
        return { active: false, code: 'NO_FUTURE_RUN', error: 'First Light needs rescheduling: no enabled future run exists.' };
      }
      if (!/(?:^|\s)--first-light(?:\s|$)/.test(task.arguments || '')) return { active: false, code: 'INVALID_ACTION', error: 'First Light needs rescheduling: its task action is invalid.' };
      return { active: true, alarmTime: new Date(next).toTimeString().slice(0, 5), nextRunTime: new Date(next).toISOString(), executable: task.executable };
    } catch (error) { return { active: false, code: error.code || 'STATUS_UNAVAILABLE', error: 'First Light status unavailable; check or reschedule the alarm.' }; }
  }
  async function scheduleWakeAlarm(alarmTime, appExePath, profile) {
    // Validate before replacing an existing registration.
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(alarmTime || '')) return { success: false, error: 'Invalid time format' };
    if (typeof appExePath !== 'string' || !path.isAbsolute(appExePath) || !/\.exe$/i.test(appExePath) || !exists(appExePath)) return { success: false, error: 'First Light application is missing' };
    if (profile && (typeof profile !== 'string' || !path.isAbsolute(profile) || !exists(profile) || profile.includes('"'))) return { success: false, error: 'First Light data profile is unavailable' };
    const [hours, minutes] = alarmTime.split(':').map(Number), requestId = randomUUID();
    const args = `--first-light --first-light-request=${requestId}` + (profile ? ` "--user-data-dir=${profile}"` : '');
    try {
      await executePS([
        `$Action=New-ScheduledTaskAction -Execute ${quote(appExePath)} -Argument ${quote(args)}`,
        `$At=(Get-Date).Date.AddHours(${hours}).AddMinutes(${minutes}); if($At -le (Get-Date)){$At=$At.AddDays(1)}`,
        '$Trigger=New-ScheduledTaskTrigger -Once -At $At',
        '$Settings=New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable',
        `Register-ScheduledTask -TaskName ${quote(taskName)} -Action $Action -Trigger $Trigger -Settings $Settings -Force -Description 'Lights Out First Light wake-up alarm' | Out-Null`
      ].join('; '));
      const status = await getWakeAlarmStatus();
      if (!status.active || path.resolve(status.executable).toLowerCase() !== path.resolve(appExePath).toLowerCase()) return { success: false, error: status.error || 'First Light task verification failed' };
      return { success: true, alarmTime, requestId, nextRunTime: status.nextRunTime };
    } catch (error) { return { success: false, error: error.message }; }
  }
  async function removeWakeAlarm(expectedRequestId) {
    try {
      if (expectedRequestId && !/^[a-zA-Z0-9_-]{1,128}$/.test(expectedRequestId)) return { success: false, error: 'Invalid First Light request' };
      const owned = expectedRequestId ? ` -and @($t.Actions)[0].Arguments -match ${quote('(?:^|\\s)--first-light-request=' + expectedRequestId + '(?:\\s|$)')}` : '';
      await executePS(`$t=Get-ScheduledTask -TaskName ${quote(taskName)} -ErrorAction SilentlyContinue; if($t${owned}){Unregister-ScheduledTask -TaskName ${quote(taskName)} -Confirm:$false}`);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  }
  return { scheduleWakeAlarm, removeWakeAlarm, getWakeAlarmStatus };
}

module.exports = { ...createAlarm(), createAlarm, TASK_NAME };
