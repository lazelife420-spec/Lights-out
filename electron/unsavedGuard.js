// Unsaved work guardian.
// Scans for open "Save changes?" or "Unsaved changes" dialog windows
// before the power action fires, and warns the user.

const { spawn } = require('child_process');
const { runBounded } = require('./boundedProcess');

// Window title patterns that indicate unsaved work.
const UNSAVED_PATTERNS = [
  'save changes',
  'unsaved changes',
  'do you want to save',
  'save before closing',
  'document has been modified',
  'save changes to',
  'would you like to save',
  'you have unsaved',
  'save your changes',
  'confirm save',
  'the file has been modified',
  'save the changes',
  'discard changes',
  'save?'
];

// Scan all visible windows for unsaved-work dialog titles.
async function scanUnsavedWork({ signal, timeoutMs = 5000 } = {}) {
  const warnings = [];

  // Get all windows with titles using PowerShell.
  const psCmd = `
    $ErrorActionPreference = 'Stop'
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
      }
"@
    $titles = [System.Collections.ArrayList]::new()
    $callback = [Win32+EnumWindowsProc]{
      param($hWnd, $lParam)
      if ([Win32]::IsWindowVisible($hWnd)) {
        $sb = [System.Text.StringBuilder]::new(512)
        [Win32]::GetWindowText($hWnd, $sb, 512) | Out-Null
        $title = $sb.ToString()
        if ($title.Length -gt 0) {
          [uint32]$windowProcessId = 0
          [Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId) | Out-Null
          $proc = Get-Process -Id $windowProcessId -ErrorAction SilentlyContinue
          $titles.Add("$windowProcessId|$($proc.ProcessName)|$title") | Out-Null
        }
      }
      return $true
    }
    if (-not [Win32]::EnumWindows($callback, [IntPtr]::Zero)) { throw 'Window enumeration failed' }
    $titles -join ';'
  `;

    const raw = await executePS(psCmd, { signal, timeoutMs });
    if (!raw) return [];

    for (const entry of raw.split(';').map(s => s.trim()).filter(Boolean)) {
      const [pidStr, procName, title] = entry.split('|');
      if (!title) continue;

      const lowerTitle = title.toLowerCase();
      for (const pattern of UNSAVED_PATTERNS) {
        if (lowerTitle.includes(pattern)) {
          warnings.push({
            pid: parseInt(pidStr) || 0,
            process: procName || 'unknown',
            title,
            pattern
          });
          break; // one match per window is enough
        }
      }
    }

  return warnings;
}

// Quick check: are there any unsaved work dialogs?
async function hasUnsavedWork() {
  const warnings = await scanUnsavedWork();
  return warnings.length > 0;
}

function executePS(command, { signal, timeoutMs }) {
  return runBounded({ spawn, file: 'powershell.exe', args: [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], signal, timeoutMs, errorPrefix: 'UNSAVED_SCAN' });
}

module.exports = {
  scanUnsavedWork,
  hasUnsavedWork
};
