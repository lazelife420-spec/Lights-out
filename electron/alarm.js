// Wake-up alarm engine.
// Schedules a Windows Task Scheduler wake-up event and runs a sunrise
// brightening sequence when the PC resumes from sleep/hibernate.

const { spawn } = require('child_process');

const TASK_NAME = 'LightsOut_FirstLight';

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling: uses Windows Task Scheduler to create a one-shot wake task.
// ─────────────────────────────────────────────────────────────────────────────

async function scheduleWakeAlarm(alarmTime, appExePath) {
  // alarmTime: '07:30' format
  if (!alarmTime || !appExePath) return { success: false, error: 'Missing time or exe path' };

  // Remove any previous wake alarm.
  await removeWakeAlarm();

  const [hours, minutes] = alarmTime.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return { success: false, error: 'Invalid time format' };

  // Build the PowerShell command to create a scheduled task that wakes the PC.
  const psCmd = [
    `$Action = New-ScheduledTaskAction -Execute '${appExePath.replace(/'/g, "''")}' -Argument '--first-light'`,
    `$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours(${hours}).AddMinutes(${minutes})`,
    `$Settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable`,
    `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $Action -Trigger $Trigger -Settings $Settings -Force -Description 'Lights Out First Light wake-up alarm'`
  ].join('; ');

  try {
    await executePS(psCmd);
    return { success: true, alarmTime };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function removeWakeAlarm() {
  try {
    await executePS(`Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue`);
  } catch { /* best-effort */ }
  return { success: true };
}

async function getWakeAlarmStatus() {
  try {
    const result = await executePS(`(Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue).State`);
    if (result && result.trim().toLowerCase() === 'ready') {
      const trigger = await executePS(`(Get-ScheduledTask -TaskName '${TASK_NAME}').Triggers[0].StartBoundary`);
      // Parse ISO timestamp like "2026-06-10T07:30:00"
      const match = trigger?.match(/T(\d{2}:\d{2})/);
      return { active: true, alarmTime: match ? match[1] : null };
    }
    return { active: false };
  } catch {
    return { active: false };
  }
}

function executePS(command) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    let error = '';
    ps.stdout.on('data', data => { output += data.toString(); });
    ps.stderr.on('data', data => { error += data.toString(); });
    ps.on('error', reject);
    ps.on('close', code => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(error.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

module.exports = {
  scheduleWakeAlarm,
  removeWakeAlarm,
  getWakeAlarmStatus,
  TASK_NAME
};
