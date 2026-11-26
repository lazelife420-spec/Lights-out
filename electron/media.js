// Media auto-pause engine.
// During wind-down, pauses the media Windows reports as playing (see
// pauseAllDetectedMedia). On cancel, resumeAllMedia restarts only a paused
// session of that same app (a browser is one app, whichever tab is current),
// and only while Windows still reports it paused.
// detectMediaSessions only lists running players.

const { spawn } = require('child_process');

// Known media process names that support keyboard media-key pause.
const MEDIA_PROCESSES = [
  'Spotify',
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi',
  'vlc', 'wmplayer', 'Music.UI', 'Video.UI',
  'Amazon Music', 'Pandora', 'TIDAL',
  'Discord', 'Telegram', 'slack'
];

const PS_TIMEOUT_MS = 15000;

// Check which media processes are currently running.
async function detectMediaSessions() {
  const results = [];
  const cmd = MEDIA_PROCESSES.map(proc =>
    `$p = @(Get-Process -Name '${proc}' -ErrorAction SilentlyContinue); if ($p.Count -gt 0) { '${proc}:' + $p.Count }`
  ).join('; ');

  try {
    const raw = await executePS(cmd);
    if (!raw) return [];
    for (const part of raw.split(/[\r\n;]+/).map(s => s.trim()).filter(Boolean)) {
      const idx = part.lastIndexOf(':');
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const count = parseInt(part.slice(idx + 1), 10);
      if (name && Number.isFinite(count) && count > 0) {
        results.push({ name, processCount: count });
      }
    }
  } catch { /* best-effort */ }
  return results;
}

// Blind toggle: sends the Windows media play/pause key (VK_MEDIA_PLAY_PAUSE =
// 0xB3) without checking any session, so on paused media it STARTS playback.
// The wind-down never uses it (see pauseAllDetectedMedia / resumeAllMedia).
async function pauseAllMedia() {
  // Send the media play/pause key via PowerShell SendKeys.
  try {
    await executePS(
      `(New-Object -ComObject WScript.Shell).SendKeys([char]179)`  // 179 = VK_MEDIA_PLAY_PAUSE
    );
  } catch { /* best-effort; never inject arbitrary app hotkeys into unfocused windows */ }
}

// The same blind toggle, limited to known media process names. It uses the
// global media key rather than injecting unfocused Space / Ctrl+P / Ctrl+F8
// keystrokes into whatever window has focus (which could scroll/click dialogs,
// open Print, or type into an active document).
async function pauseAppByName(processName) {
  const normalized = String(processName || '').trim().toLowerCase();
  if (!normalized) return;
  if (MEDIA_PROCESSES.some(p => p.toLowerCase() === normalized)) {
    await pauseAllMedia();
  }
}

// VK_MEDIA_PLAY_PAUSE is a toggle that acts on Windows' current media session.
// A running Chrome/Discord/Spotify process says nothing about playback, and a
// toggle sent to a paused session starts it. So every wind-down key first asks
// Windows (GlobalSystemMediaTransportControls, Windows 10 1809+) about the
// current session, in the same PowerShell run that sends the key, so nothing
// can change between the check and the key. Anything unexpected sends nothing
// and claims nothing. Single quotes only: the commands pass through -Command.
//
// mediaSessionCommand wraps `body` with the session lookup. In `body`, $session
// is the current session, $app its SourceAppUserModelId and $status its
// PlaybackStatus. Each reply is one '<tag>|...' line.
function mediaSessionCommand(tag, body) {
  return [
    "$ErrorActionPreference = 'Stop';",
    'try {',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime;',
    '$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime];',
    "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1;",
    '$task = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null, @([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()));',
    `if (-not $task.Wait(5000)) { '${tag}|unknown|'; return };`,
    '$session = $task.Result.GetCurrentSession();',
    `if ($null -eq $session) { '${tag}|none|'; return };`,
    '$app = [string]$session.SourceAppUserModelId;',
    '$status = [string]$session.GetPlaybackInfo().PlaybackStatus;',
    ...body,
    `} catch { '${tag}|unknown|' }`
  ].join(' ');
}

// Pause: the key is sent only when the current session is Playing, and that
// session counts as paused only once Windows reports it is no longer playing.
const PAUSE_PLAYING_MEDIA_COMMAND = mediaSessionCommand('LO_MEDIA', [
  "if ($status -ne 'Playing') { 'LO_MEDIA|' + $status + '|' + $app; return };",
  '(New-Object -ComObject WScript.Shell).SendKeys([char]179);',
  '$deadline = [DateTime]::UtcNow.AddMilliseconds(1500);',
  "do { Start-Sleep -Milliseconds 150; $status = [string]$session.GetPlaybackInfo().PlaybackStatus } while ($status -eq 'Playing' -and [DateTime]::UtcNow -lt $deadline);",
  "if ($status -eq 'Playing') { 'LO_MEDIA|sent|' + $app } else { 'LO_MEDIA|paused|' + $app }"
]);

// Read-only: the current session's PlaybackStatus and app id. No key.
const MEDIA_SESSION_STATE_COMMAND = mediaSessionCommand('LO_MEDIA_STATE', [
  "'LO_MEDIA_STATE|' + $status + '|' + $app"
]);

// Resume (the mirror of the pause): the key is sent only when the current
// session is Paused AND is the app the pause stopped. The app id arrives in an
// environment variable, never spliced into the command text, so no app id can
// change what PowerShell runs. Both checks are exact (case-sensitive).
const RESUME_APP_ENV = 'LO_MEDIA_EXPECTED_APP';
const RESUME_PAUSED_MEDIA_COMMAND = mediaSessionCommand('LO_MEDIA_RESUME', [
  `$expected = [string]$env:${RESUME_APP_ENV};`,
  "if ($expected.Length -eq 0) { 'LO_MEDIA_RESUME|no-app-id|' + $status + '|' + $app; return };",
  "if ($status -cne 'Paused') { 'LO_MEDIA_RESUME|not-paused|' + $status + '|' + $app; return };",
  "if ($app -cne $expected) { 'LO_MEDIA_RESUME|other-app|' + $status + '|' + $app; return };",
  '(New-Object -ComObject WScript.Shell).SendKeys([char]179);',
  '$deadline = [DateTime]::UtcNow.AddMilliseconds(1500);',
  "do { Start-Sleep -Milliseconds 150; $status = [string]$session.GetPlaybackInfo().PlaybackStatus } while ($status -eq 'Paused' -and [DateTime]::UtcNow -lt $deadline);",
  "if ($status -eq 'Playing') { 'LO_MEDIA_RESUME|resumed|' + $status + '|' + $app } else { 'LO_MEDIA_RESUME|sent|' + $status + '|' + $app }"
]);

// A readable app name from a media session's AppUserModelID
// ('Spotify.exe', 'Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic').
// Opaque IDs (Firefox registers a 16-hex-digit one) get a generic label.
function mediaAppLabel(appId) {
  let name = String(appId || '').split('!')[0];
  name = name.replace(/_[a-z0-9]{13}$/i, '').replace(/\.exe$/i, '');
  name = name.replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 48);
  if (!name || /^[0-9A-F]{16}$/i.test(name)) return 'the current media app';
  return name;
}

// The '|' fields after `tag` on the first line that carries it ([] if none).
// The app id is always the last field and may itself contain '|'.
function mediaReplyFields(raw, tag, count) {
  const line = String(raw || '').split(/\r?\n/).map(s => s.trim()).find(s => s.startsWith(`${tag}|`));
  if (!line) return [];
  const parts = line.slice(tag.length + 1).split('|');
  const head = parts.slice(0, count - 1).map(s => s.trim());
  return [...head, parts.slice(count - 1).join('|').trim()];
}

function parsePauseResult(raw) {
  const [state, appId = ''] = mediaReplyFields(raw, 'LO_MEDIA', 2);
  return { state: state || 'unknown', appId };
}

// Wind-down pause. `paused` lists only a session that was playing and stopped
// after the key; `count` > 0 only then (so no toast names a merely running
// app), and `appId` is that session's SourceAppUserModelId (null otherwise).
// main.js hands appId to resumeAllMedia on cancel.
async function pauseAllDetectedMedia() {
  let raw = '';
  try {
    raw = await executePS(PAUSE_PLAYING_MEDIA_COMMAND);
  } catch { /* best-effort: an unreadable media state sends nothing */ }
  const { state, appId } = parsePauseResult(raw);
  if (state === 'paused') {
    return { paused: [mediaAppLabel(appId)], count: 1, keySent: true, playbackStatus: 'paused', appId: appId || null };
  }
  const keySent = state === 'sent';
  return { paused: [], count: 0, keySent, playbackStatus: keySent ? 'still-playing' : (state.toLowerCase() || 'unknown'), appId: null };
}

// An app id as pauseAllDetectedMedia reports it: one trimmed line.
function isMediaAppId(appId) {
  return typeof appId === 'string' && appId.length > 0 && appId.length <= 512 &&
    appId === appId.trim() && !/[\u0000-\u001f\u007f]/.test(appId);
}

// Cancel-time resume, the mirror of the pause. The play/pause key toggles
// whatever session is current NOW, which may not be the one the wind-down
// paused: the user may have pressed play again (the key would pause it), or
// paused a video in another app (the key would start it). So the key is sent
// only when the current session is Paused and its SourceAppUserModelId equals
// `expectedAppId`, the id pauseAllDetectedMedia returned. A read-only check
// runs first, and the run that sends the key checks both again. No id, or any
// other state, sends nothing and resolves { resumed: false, reason }.
// keySent is null only when the key run's reply was unreadable.
async function resumeAllMedia(expectedAppId) {
  if (expectedAppId === undefined || expectedAppId === null || expectedAppId === '') {
    return { resumed: false, keySent: false, reason: 'no-app-id' };
  }
  if (!isMediaAppId(expectedAppId)) return { resumed: false, keySent: false, reason: 'invalid-app-id' };

  let raw = '';
  try {
    raw = await executePS(MEDIA_SESSION_STATE_COMMAND);
  } catch { /* unreadable: send nothing */ }
  const [status = 'unknown', appId = ''] = mediaReplyFields(raw, 'LO_MEDIA_STATE', 2);
  if (status === 'none') return { resumed: false, keySent: false, reason: 'no-session' };
  if (status === 'unknown' || !status) return { resumed: false, keySent: false, reason: 'unknown' };
  if (status !== 'Paused') return { resumed: false, keySent: false, reason: 'not-paused', playbackStatus: status };
  if (appId !== expectedAppId) return { resumed: false, keySent: false, reason: 'other-app' };

  let reply = '';
  try {
    reply = await executePS(RESUME_PAUSED_MEDIA_COMMAND, PS_TIMEOUT_MS, { [RESUME_APP_ENV]: expectedAppId });
  } catch { /* reported below as unknown */ }
  const [outcome, after = ''] = mediaReplyFields(reply, 'LO_MEDIA_RESUME', 3);
  if (outcome === 'resumed') return { resumed: true, keySent: true, reason: null };
  if (outcome === 'sent') return { resumed: false, keySent: true, reason: 'still-paused', playbackStatus: after };
  if (outcome === 'none') return { resumed: false, keySent: false, reason: 'no-session' };
  if (outcome && outcome !== 'unknown') return { resumed: false, keySent: false, reason: outcome, playbackStatus: after };
  // The key run failed, timed out or threw: whether it sent the key is unknown.
  return { resumed: false, keySent: null, reason: 'unknown' };
}

// Mute system volume.
async function muteSystemVolume() {
  try {
    await executePS(
      `(New-Object -ComObject WScript.Shell).SendKeys([char]173)`
    );
  } catch { /* best-effort */ }
}

// Unmute system volume.
async function unmuteSystemVolume() {
  try {
    await executePS(
      `(New-Object -ComObject WScript.Shell).SendKeys([char]173)`
    );
  } catch { /* best-effort */ }
}

// Set system volume (0-100).
function buildSystemVolumeCommand(percent) {
  const numeric = Number(percent);
  const vol = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
  const steps = Math.floor(vol / 2);
  return `$wsh = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $wsh.SendKeys([char]174) }; if (${steps} -gt 0) { 1..${steps} | ForEach-Object { $wsh.SendKeys([char]175) } }`;
}

async function setSystemVolume(percent) {
  try {
    await executePS(buildSystemVolumeCommand(percent));
  } catch { /* best-effort */ }
}

// extraEnv: variables added to this one child's environment (data the command
// reads as $env:NAME instead of having it spliced into the command text).
function executePS(command, timeoutMs = PS_TIMEOUT_MS, extraEnv = null) {
  return new Promise((resolve, reject) => {
    const options = { stdio: ['ignore', 'pipe', 'pipe'] };
    if (extraEnv) options.env = { ...process.env, ...extraEnv };
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], options);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err, out) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(out);
    };
    const timer = setTimeout(() => {
      try { ps.kill(); } catch {}
      finish(new Error('PowerShell command timed out'));
    }, timeoutMs);
    timer.unref?.();
    ps.stdout.on('data', data => { stdout += data.toString(); });
    ps.stderr.on('data', data => { stderr += data.toString(); });
    ps.on('error', err => finish(err));
    ps.on('close', code => {
      if (code === 0) finish(null, stdout.trim());
      else finish(new Error((stderr || stdout).trim() || `PS exit ${code}`));
    });
  });
}

module.exports = {
  detectMediaSessions,
  pauseAllMedia,
  pauseAppByName,
  pauseAllDetectedMedia,
  resumeAllMedia,
  muteSystemVolume,
  unmuteSystemVolume,
  setSystemVolume,
  buildSystemVolumeCommand,
  PAUSE_PLAYING_MEDIA_COMMAND,
  MEDIA_SESSION_STATE_COMMAND,
  RESUME_PAUSED_MEDIA_COMMAND,
  RESUME_APP_ENV,
  mediaAppLabel,
  parsePauseResult
};
