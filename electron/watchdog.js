// Autopilot watchdog: a Windows Scheduled Task that relaunches the app a few
// minutes before the armed autopilot bedtime.
//
// In-process autopilot only fires while the app is running — quitting it
// (tray Quit, Task Manager, a crash the handlers could not absorb) silently
// disables the feature for the rest of the night, and Run-at-login only helps
// on the next boot. This task is the belt-and-suspenders layer: it launches
// the app shortly before the armed bedtime so the app's own countdown, warning
// and receipt path runs normally. The task itself never performs a power
// action — the app's safety chain still owns that.
//
// The task re-registers on every schedule() with the freshest bedtime, so the
// stored daily time always reflects the most recently armed fire.

const { execFile } = require('child_process');

const TASK_NAME = 'LightsOut-AutopilotWatchdog';
const RELAUNCH_ARG = '--watchdog-relaunch';
const LEAD_MINUTES = 15;

// Wired once from main.js to writeStartupLog so task arm/disarm evidence lands
// in startup.log next to the rest of the launch diagnostics.
let moduleLog = () => {};
function setLogger(fn) {
  moduleLog = typeof fn === 'function' ? fn : () => {};
}

function defaultExePath() {
  try {
    const { app } = require('electron');
    return app.getPath('exe');
  } catch {
    return null;
  }
}

function defaultIsPackaged() {
  try {
    const { app } = require('electron');
    return !!app.isPackaged;
  } catch {
    return false;
  }
}

// schtasks is invoked via execFile (no shell). Returns a resolved result
// object; callers decide whether a failure matters.
function run(args, runner) {
  const exec = runner || execFile;
  return new Promise((resolve) => {
    try {
      exec('schtasks.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
        resolve({ ok: !err, code: err && typeof err.code === 'number' ? err.code : (err ? -1 : 0), stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(e && e.message || e) });
    }
  });
}

async function deleteTask(io) {
  const r = await run(['/Delete', '/TN', TASK_NAME, '/F'], io.runner);
  if (r.ok) io.log('Autopilot watchdog task removed');
  return r.ok;
}

// Every sync is serialized through this queue: schedule() runs cancel() (a
// disarm) immediately before arming, and unordered execFile calls can resolve
// out of order — leaving the task deleted after the arm. Queuing makes call
// order == execution order.
let queue = Promise.resolve();

// target: Date | ISO string | null. null/invalid/not-packaged/non-Windows
// disarms the task (best effort delete — a missing task is not an error).
function sync(target, deps = {}) {
  queue = queue.catch(() => {}).then(() => syncNow(target, deps));
  return queue;
}

async function syncNow(target, deps = {}) {
  const io = {
    platform: process.platform,
    isPackaged: defaultIsPackaged(),
    exePath: defaultExePath(),
    log: moduleLog,
    runner: null,
    ...deps
  };

  const fire = target ? new Date(target) : null;
  const arm = fire && Number.isFinite(fire.getTime()) && io.platform === 'win32' && io.isPackaged && !!io.exePath;

  if (!arm) {
    await deleteTask(io);
    return { armed: false };
  }

  const lead = new Date(fire.getTime() - LEAD_MINUTES * 60 * 1000);
  const at = `${String(lead.getHours()).padStart(2, '0')}:${String(lead.getMinutes()).padStart(2, '0')}`;
  const tr = `"${io.exePath}" --minimized --no-auto-start ${RELAUNCH_ARG}`;
  const r = await run(['/Create', '/TN', TASK_NAME, '/TR', tr, '/SC', 'DAILY', '/ST', at, '/F'], io.runner);
  if (r.ok) {
    io.log('Autopilot watchdog task armed', { at, task: TASK_NAME });
    return { armed: true, at };
  }
  io.log('Autopilot watchdog task could not be armed', { stderr: r.stderr.slice(0, 200) });
  return { armed: false };
}

module.exports = { sync, setLogger, TASK_NAME, RELAUNCH_ARG, LEAD_MINUTES };
