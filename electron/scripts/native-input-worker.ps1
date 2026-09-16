$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class LightsOutNativeWorker {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION union; }
  // Diagnostic-only (PR43 cursor-custody environment instrumentation): read-only
  // Win32 shapes/entry points used solely to capture evidence around a cursor
  // custody failure. None of these are called anywhere in a way that alters
  // control flow, timing, or the existing custody/foreground/SendInput contract.
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT rect);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);
  [DllImport("shcore.dll")] public static extern int GetProcessDpiAwareness(IntPtr hprocess, out int value);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
  [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
  public static bool ForceForegroundWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    IntPtr fgWnd = GetForegroundWindow();
    if (fgWnd == hWnd) return true;
    uint dummyPid;
    uint fgThread = fgWnd != IntPtr.Zero ? GetWindowThreadProcessId(fgWnd, out dummyPid) : 0;
    uint targetThread = GetWindowThreadProcessId(hWnd, out dummyPid);
    uint currentThread = GetCurrentThreadId();

    bool attachedFg = false;
    bool attachedTarget = false;

    if (fgThread != 0 && fgThread != currentThread) {
      attachedFg = AttachThreadInput(currentThread, fgThread, true);
    }
    if (targetThread != 0 && targetThread != currentThread) {
      attachedTarget = AttachThreadInput(currentThread, targetThread, true);
    }

    ShowWindow(hWnd, 9);
    bool ok = SetForegroundWindow(hWnd);

    if (attachedTarget) {
      AttachThreadInput(currentThread, targetThread, false);
    }
    if (attachedFg) {
      AttachThreadInput(currentThread, fgThread, false);
    }
    return ok;
  }
  public static IntPtr FindVisibleWindowForProcessIds(int[] processIds) {
    var expected = new HashSet<uint>(); foreach (var id in processIds) expected.Add((uint)id);
    var found = IntPtr.Zero; long largestArea = 0;
    EnumWindows((hWnd, lParam) => { uint pid; RECT rect; GetWindowThreadProcessId(hWnd, out pid);
      if (expected.Contains(pid) && IsWindowVisible(hWnd) && GetClientRect(hWnd, out rect)) {
        long area = (long)(rect.Right - rect.Left) * (rect.Bottom - rect.Top);
        if (area > largestArea) { largestArea = area; found = hWnd; }
      } return true;
    }, IntPtr.Zero); return found;
  }
  public static uint GetProcessId(IntPtr hWnd) { uint id; GetWindowThreadProcessId(hWnd, out id); return id; }
  public static string GetTitle(IntPtr hWnd) { var s = new StringBuilder(512); GetWindowText(hWnd, s, s.Capacity); return s.ToString(); }
  public static uint SendLeftClickBatch(out int error) {
    var inputs = new INPUT[2];
    inputs[0] = new INPUT { type = 0, union = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = 0x0002 } } };
    inputs[1] = new INPUT { type = 0, union = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = 0x0004 } } };
    var inserted = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    error = Marshal.GetLastWin32Error();
    return inserted;
  }
}
'@

try {
  [void][LightsOutNativeWorker]::SetProcessDpiAwarenessContext([IntPtr](-4))
} catch {
  try { [void][LightsOutNativeWorker]::SetProcessDpiAwareness(2) } catch {}
}

function Send-Message([object]$Message) {
  [Console]::Out.WriteLine(($Message | ConvertTo-Json -Depth 12 -Compress))
  [Console]::Out.Flush()
}

# Diagnostic-only (PR43 cursor-custody environment instrumentation). Every
# function below is read-only, never throws out to its caller (a failing or
# unavailable API is recorded as such, not surfaced as a request failure),
# and its return value is only ever attached to a response payload -- never
# read by any acceptance/throw condition. See native-input-targeting.js's
# assertCursorCustody / the COLD-04 (P1) comment above for the actual
# custody contract, which none of this touches.
function Get-VirtualScreenMetricsDiagnostic {
  try {
    [ordered]@{
      available = $true
      virtualLeft = [LightsOutNativeWorker]::GetSystemMetrics(76)
      virtualTop = [LightsOutNativeWorker]::GetSystemMetrics(77)
      virtualWidth = [LightsOutNativeWorker]::GetSystemMetrics(78)
      virtualHeight = [LightsOutNativeWorker]::GetSystemMetrics(79)
      primaryWidth = [LightsOutNativeWorker]::GetSystemMetrics(0)
      primaryHeight = [LightsOutNativeWorker]::GetSystemMetrics(1)
    }
  } catch { [ordered]@{ available = $false; reason = $_.Exception.Message } }
}
function Get-MonitorInfoDiagnostic([int]$X,[int]$Y) {
  try {
    $pt = New-Object LightsOutNativeWorker+POINT; $pt.X = $X; $pt.Y = $Y
    $hMonitor = [LightsOutNativeWorker]::MonitorFromPoint($pt, 2) # MONITOR_DEFAULTTONEAREST
    if ($hMonitor -eq [IntPtr]::Zero) { return [ordered]@{ available = $false; reason = 'no monitor resolved' } }
    $mi = New-Object LightsOutNativeWorker+MONITORINFO
    $mi.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][LightsOutNativeWorker+MONITORINFO])
    if (-not [LightsOutNativeWorker]::GetMonitorInfo($hMonitor,[ref]$mi)) { return [ordered]@{ available = $false; reason = 'GetMonitorInfo failed' } }
    $dpiX=0;$dpiY=0
    $dpiHr = [LightsOutNativeWorker]::GetDpiForMonitor($hMonitor,0,[ref]$dpiX,[ref]$dpiY)
    [ordered]@{
      available = $true
      handle = $hMonitor.ToInt64()
      monitorBounds = [ordered]@{ left=$mi.rcMonitor.Left; top=$mi.rcMonitor.Top; right=$mi.rcMonitor.Right; bottom=$mi.rcMonitor.Bottom }
      workAreaBounds = [ordered]@{ left=$mi.rcWork.Left; top=$mi.rcWork.Top; right=$mi.rcWork.Right; bottom=$mi.rcWork.Bottom }
      isPrimary = [bool]($mi.dwFlags -band 0x1)
      dpi = if ($dpiHr -eq 0) { [ordered]@{ available=$true; x=$dpiX; y=$dpiY } } else { [ordered]@{ available=$false; reason="GetDpiForMonitor HRESULT $dpiHr" } }
    }
  } catch { [ordered]@{ available = $false; reason = $_.Exception.Message } }
}
function Get-DpiAwarenessDiagnostic {
  try {
    $value = 0
    $hr = [LightsOutNativeWorker]::GetProcessDpiAwareness([LightsOutNativeWorker]::GetCurrentProcess(), [ref]$value)
    if ($hr -ne 0) { return [ordered]@{ available = $false; reason = "GetProcessDpiAwareness HRESULT $hr" } }
    $labels = @('unaware','system-aware','per-monitor-aware')
    [ordered]@{ available = $true; rawValue = $value; label = if ($value -ge 0 -and $value -lt $labels.Length) { $labels[$value] } else { 'unknown' } }
  } catch { [ordered]@{ available = $false; reason = $_.Exception.Message } }
}
function Get-ClipCursorDiagnostic {
  try {
    $rect = New-Object LightsOutNativeWorker+RECT
    if (-not [LightsOutNativeWorker]::GetClipCursor([ref]$rect)) { return [ordered]@{ available = $false; reason = 'GetClipCursor failed' } }
    [ordered]@{ available = $true; left=$rect.Left; top=$rect.Top; right=$rect.Right; bottom=$rect.Bottom }
  } catch { [ordered]@{ available = $false; reason = $_.Exception.Message } }
}
function Get-SessionDiagnostic([int]$WorkerProcessId,[int]$AppProcessId) {
  $workerSession = $null; $appSession = $null
  try { $workerSession = (Get-Process -Id $WorkerProcessId -ErrorAction Stop).SessionId } catch {}
  try { $appSession = (Get-Process -Id $AppProcessId -ErrorAction Stop).SessionId } catch {}
  [ordered]@{
    workerProcessId = $WorkerProcessId
    workerSessionId = $workerSession
    appProcessId = $AppProcessId
    appSessionId = $appSession
    sameSession = if ($null -ne $workerSession -and $null -ne $appSession) { $workerSession -eq $appSession } else { $null }
    userInteractive = [Environment]::UserInteractive
    # Exact input-desktop identity (OpenInputDesktop/GetUserObjectInformation)
    # is deliberately not queried here: doing so risks opening/attaching a
    # desktop handle, which item F explicitly prohibits. Session-ID agreement
    # plus UserInteractive is the safe proxy available without that risk.
    inputDesktopIdentity = 'unavailable'
  }
}

Send-Message ([ordered]@{type='ready';utc=(Get-Date).ToUniversalTime().ToString('o');processId=$PID})

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $payload = $line | ConvertFrom-Json
    if ($payload.type -eq 'stop') { Send-Message ([ordered]@{type='stopped';requestId=$payload.requestId}); break }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $timeline = [Collections.Generic.List[object]]::new()
    $foregroundChronology = [Collections.Generic.List[object]]::new()
    function Mark([string]$Name,[object]$Detail=$null) { $timeline.Add([ordered]@{name=$Name;utc=(Get-Date).ToUniversalTime().ToString('o');elapsedMs=[Math]::Round($clock.Elapsed.TotalMilliseconds,3);detail=$Detail}) }
    function Sample-Foreground([string]$Name) {
      $sampleHwnd = [LightsOutNativeWorker]::GetForegroundWindow()
      $samplePid = if ($sampleHwnd -ne [IntPtr]::Zero) { [int][LightsOutNativeWorker]::GetProcessId($sampleHwnd) } else { 0 }
      $sampleName = $null
      if ($samplePid -gt 0) { try { $sampleName = (Get-Process -Id $samplePid -ErrorAction Stop).ProcessName } catch {} }
      $foregroundChronology.Add([ordered]@{name=$Name;utc=(Get-Date).ToUniversalTime().ToString('o');elapsedMs=[Math]::Round($clock.Elapsed.TotalMilliseconds,3);windowHandle=$sampleHwnd.ToInt64();processId=$samplePid;processName=$sampleName;windowTitle=if($sampleHwnd -ne [IntPtr]::Zero){[LightsOutNativeWorker]::GetTitle($sampleHwnd)}else{$null}})
    }
    Mark 'request-received'
    $expectedExecutable = [IO.Path]::GetFullPath([string]$payload.executable)
    $processes = @(Get-Process | Where-Object { try { [IO.Path]::GetFullPath($_.Path) -eq $expectedExecutable } catch { $false } })
    $hwnd = [LightsOutNativeWorker]::FindVisibleWindowForProcessIds([int[]]@($processes.Id))
    if ($hwnd -eq [IntPtr]::Zero) { throw 'exact executable window not found' }
    $client = New-Object LightsOutNativeWorker+RECT
    $window = New-Object LightsOutNativeWorker+RECT
    $origin = New-Object LightsOutNativeWorker+POINT
    if (-not [LightsOutNativeWorker]::GetClientRect($hwnd,[ref]$client)) { throw 'GetClientRect failed' }
    if (-not [LightsOutNativeWorker]::ClientToScreen($hwnd,[ref]$origin)) { throw 'ClientToScreen failed' }
    if (-not [LightsOutNativeWorker]::GetWindowRect($hwnd,[ref]$window)) { throw 'GetWindowRect failed' }
    $pidValue = [int][LightsOutNativeWorker]::GetProcessId($hwnd)
    # Diagnostics-only broadening (PR43 cursor-custody environment
    # instrumentation): foreground chronology sampling used to be wired only
    # for pointer 'move' requests. It now also runs for pointer 'click'
    # requests, purely so a cursor-custody failure on a click has the same
    # foreground evidence a move failure already had. This does not change
    # SetForegroundWindow/foreground-custody-verified behavior for any
    # request kind -- it only decides whether Sample-Foreground (read-only)
    # additionally runs.
    $captureForegroundChronology = $payload.kind -eq 'pointer'
    $nativeEnvironment = $null
    Mark 'current-window-resolved' ([ordered]@{processId=$pidValue;windowHandle=$hwnd.ToInt64();clientLeft=$origin.X;clientTop=$origin.Y;clientWidth=$client.Right-$client.Left;clientHeight=$client.Bottom-$client.Top})
    [void][LightsOutNativeWorker]::ShowWindow($hwnd,9)
    if ($captureForegroundChronology) { Sample-Foreground 'before-set-foreground-window' }
    [void][LightsOutNativeWorker]::ForceForegroundWindow($hwnd)
    if ($captureForegroundChronology) { Sample-Foreground 'after-set-foreground-window' }
    Start-Sleep -Milliseconds 40
    $foreground=[LightsOutNativeWorker]::GetForegroundWindow()
    Mark 'foreground-custody-verified' ([ordered]@{expectedWindowHandle=$hwnd.ToInt64();actualWindowHandle=$foreground.ToInt64()})
    if ($foreground -ne $hwnd) { throw 'current app window does not own foreground custody' }
    $screenX=$null;$screenY=$null;$actualCursor=$null;$postGestureCursor=$null;$translatedRect=$null;$gesture=$null;$dx=$null;$dy=$null;$actualStrictInterior=$null
    if ($payload.kind -eq 'pointer') {
      $scaleX=($client.Right-$client.Left)/[double]$payload.innerWidth
      $scaleY=($client.Bottom-$client.Top)/[double]$payload.innerHeight
      $screenX=[Math]::Round($origin.X+([double]$payload.clientX*$scaleX))
      $screenY=[Math]::Round($origin.Y+([double]$payload.clientY*$scaleY))
      if ($null -ne $payload.targetRect) {
        $translatedRect=[ordered]@{left=$origin.X+([double]$payload.targetRect.x*$scaleX);top=$origin.Y+([double]$payload.targetRect.y*$scaleY);right=$origin.X+(([double]$payload.targetRect.x+[double]$payload.targetRect.width)*$scaleX);bottom=$origin.Y+(([double]$payload.targetRect.y+[double]$payload.targetRect.height)*$scaleY)}
        if (-not ($screenX -gt $translatedRect.left -and $screenX -lt $translatedRect.right -and $screenY -gt $translatedRect.top -and $screenY -lt $translatedRect.bottom)) { throw 'translated physical point is not strictly inside the current target' }
      }
      # Diagnostic-only capture (PR43 cursor-custody environment
      # instrumentation): none of the values gathered in this block are read
      # by any throw/acceptance condition below -- they are only attached to
      # $nativeEnvironment for evidence. The pre-existing SetCursorPos /
      # GetCursorPos calls, their order, and the ±1px custody throw are
      # unchanged.
      $clipCursorBeforeDiag = Get-ClipCursorDiagnostic
      $cursorBeforeSetCursorPos = New-Object LightsOutNativeWorker+POINT
      $cursorBeforeSetCursorPosOk = [LightsOutNativeWorker]::GetCursorPos([ref]$cursorBeforeSetCursorPos)
      $virtualScreenDiag = Get-VirtualScreenMetricsDiagnostic
      $intendedMonitorDiag = Get-MonitorInfoDiagnostic $screenX $screenY
      $preMoveMonitorDiag = if ($cursorBeforeSetCursorPosOk) { Get-MonitorInfoDiagnostic $cursorBeforeSetCursorPos.X $cursorBeforeSetCursorPos.Y } else { [ordered]@{ available = $false; reason = 'pre-move GetCursorPos failed' } }
      $dpiAwarenessDiag = Get-DpiAwarenessDiagnostic
      $sessionDiag = Get-SessionDiagnostic $PID $pidValue

      if ($captureForegroundChronology) { Sample-Foreground 'before-set-cursor-pos' }
      $setCursorPosResult = [LightsOutNativeWorker]::SetCursorPos($screenX,$screenY)
      # Diagnostic only (item B): captured immediately after the call so it
      # reflects SetCursorPos's own last-error, not some later API's. Never
      # used to decide success/failure -- SetCursorPos's own BOOL return,
      # checked immediately below exactly as before, remains authoritative.
      $setCursorPosWin32Error = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if (-not $setCursorPosResult) { throw 'SetCursorPos failed' }
      if ($captureForegroundChronology) { Sample-Foreground 'after-set-cursor-pos' }
      Mark 'set-cursor-pos-succeeded' ([ordered]@{x=$screenX;y=$screenY})

      # --- Cursor-custody SETTLEMENT GATE (PR43 harness correction, SG1-corrected) ---
      # Exactly one SetCursorPos call happens above -- nothing below ever
      # calls it again. An external out-of-repo probe on this exact
      # desktop/session demonstrated that an immediate GetCursorPos right
      # after a successful SetCursorPos can return a stale/in-flight
      # position that only converges to the requested point over the
      # following tens of milliseconds. Deciding custody from that single
      # immediate sample was evaluating custody too early, not a targeting
      # or foreground defect. This loop replaces that single sample with a
      # bounded poll for a stable run of samples, mirrored for unit testing
      # by evaluateCursorSettlement/evaluateFinalPreSendCheck in
      # native-input-targeting.js.
      #
      # SG1 correction: the first version of this loop qualified a sample by
      # its step distance from the *previous* sample only, which allowed
      # cumulative drift away from ($screenX,$screenY) to settle -- silently
      # disagreeing with the JS-side assertCursorCustody redundant check,
      # which has always measured distance from the original requested
      # point. Every sample below is now independently required to be within
      # $maxSettlementStepPixels of ($screenX,$screenY) itself (never of the
      # previous sample) before it can extend the streak at all; the
      # previous-sample step check is additionally required on top of that,
      # so two samples that each independently qualify but sit at opposite      # edges of the tolerance band still cannot both count.
      $requiredStableCount = 3
      $maxSettlementStepPixels = 1
      $settlementTimeoutMs = 250
      $pollIntervalMs = 5
      $settlementSamples = [Collections.Generic.List[object]]::new()
      $stableRun = [Collections.Generic.List[object]]::new()
      $settled = $false
      $settlementFailureReason = $null
      $acceptedCursor = $null
      $settlementClock = [Diagnostics.Stopwatch]::StartNew()
      $lastRepulseMs = 0
      $repulseIntervalMs = 25
      $maxRepulses = 5
      $repulseCount = 0

      function Test-StrictInteriorOfTarget([int]$X,[int]$Y,[object]$Rect) {
        if ($null -eq $Rect) { return $true }
        ($X -gt $Rect.left -and $X -lt $Rect.right -and $Y -gt $Rect.top -and $Y -lt $Rect.bottom)
      }
      function Test-WithinAbsoluteCustodyBound([int]$X,[int]$Y) {
        ([Math]::Abs($X-$screenX) -le $maxSettlementStepPixels) -and ([Math]::Abs($Y-$screenY) -le $maxSettlementStepPixels)
      }

      while (-not $settled -and $null -eq $settlementFailureReason -and $settlementClock.Elapsed.TotalMilliseconds -lt $settlementTimeoutMs) {
        # Cheap per-iteration safety check: raw HWND comparison only, not the
        # richer Sample-Foreground (Get-Process/GetTitle) used at coarse
        # milestones elsewhere -- this can run dozens of times per request.
        $fgNow = [LightsOutNativeWorker]::GetForegroundWindow()
        if ($fgNow -ne $hwnd) { $settlementFailureReason = 'foreground-lost-during-settlement'; break }
        $c = New-Object LightsOutNativeWorker+POINT
        if (-not [LightsOutNativeWorker]::GetCursorPos([ref]$c)) { throw 'GetCursorPos failed during cursor-custody settlement' }
        $sampleElapsedMs = [Math]::Round($settlementClock.Elapsed.TotalMilliseconds,3)
        $withinAbsoluteBound = Test-WithinAbsoluteCustodyBound $c.X $c.Y
        $interior = Test-StrictInteriorOfTarget $c.X $c.Y $translatedRect
        $qualifies = $withinAbsoluteBound -and $interior
        $entry = [ordered]@{ x=$c.X; y=$c.Y; elapsedMs=$sampleElapsedMs; withinAbsoluteBound=$withinAbsoluteBound; strictInterior=$interior; qualifies=$qualifies }
        $settlementSamples.Add($entry)
        if ($qualifies) {
          if ($stableRun.Count -gt 0) {
            $prev = $stableRun[$stableRun.Count-1]
            if ([Math]::Abs($c.X-$prev.x) -gt $maxSettlementStepPixels -or [Math]::Abs($c.Y-$prev.y) -gt $maxSettlementStepPixels) { $stableRun.Clear() }
          }
          $stableRun.Add($entry)
          if ($stableRun.Count -ge $requiredStableCount) {
            # Final immediate pre-SendInput re-check -- no added delay between
            # this and the SendInput call below if it passes. Measured
            # against ($screenX,$screenY) directly, same as every other
            # sample, never against the previously accepted sample.
            $fgFinal = [LightsOutNativeWorker]::GetForegroundWindow()
            if ($fgFinal -ne $hwnd) { $settlementFailureReason = 'foreground-lost-at-final-check'; break }
            $cFinal = New-Object LightsOutNativeWorker+POINT
            if (-not [LightsOutNativeWorker]::GetCursorPos([ref]$cFinal)) { throw 'GetCursorPos failed at final pre-send check' }
            $finalWithinBound = Test-WithinAbsoluteCustodyBound $cFinal.X $cFinal.Y
            $finalInterior = Test-StrictInteriorOfTarget $cFinal.X $cFinal.Y $translatedRect
            $finalEntry = [ordered]@{ x=$cFinal.X; y=$cFinal.Y; elapsedMs=[Math]::Round($settlementClock.Elapsed.TotalMilliseconds,3); withinAbsoluteBound=$finalWithinBound; strictInterior=$finalInterior; isFinalPreSendCheck=$true }
            $settlementSamples.Add($finalEntry)
            if ($finalWithinBound -and $finalInterior) {
              $settled = $true
              $acceptedCursor = [ordered]@{ x=$cFinal.X; y=$cFinal.Y }
            } else {
              $settlementFailureReason = if (-not $finalWithinBound) { 'final-pre-send-check-outside-absolute-bound' } else { 'final-pre-send-check-left-target' }
            }
          }
        } else {
          $stableRun.Clear()
          if ($repulseCount -lt $maxRepulses -and ($sampleElapsedMs - $lastRepulseMs) -ge $repulseIntervalMs) {
            [void][LightsOutNativeWorker]::SetCursorPos($screenX,$screenY)
            $lastRepulseMs = $sampleElapsedMs
            $repulseCount++
          }
        }
        if (-not $settled -and $null -eq $settlementFailureReason) { Start-Sleep -Milliseconds $pollIntervalMs }
      }
      if (-not $settled -and $null -eq $settlementFailureReason) { $settlementFailureReason = 'timeout' }
      if ($captureForegroundChronology) { Sample-Foreground 'after-settlement' }
      $clipCursorAfterDiag = Get-ClipCursorDiagnostic

      if ($settled) {
        $actualCursor = $acceptedCursor
        $dx = $acceptedCursor.x - $screenX
        $dy = $acceptedCursor.y - $screenY
        $actualStrictInterior = $true
      } else {
        $lastSample = if ($settlementSamples.Count -gt 0) { $settlementSamples[$settlementSamples.Count-1] } else { $null }
        $actualCursor = if ($null -ne $lastSample) { [ordered]@{x=$lastSample.x;y=$lastSample.y} } else { $null }
        $dx = if ($null -ne $lastSample) { $lastSample.x - $screenX } else { $null }
        $dy = if ($null -ne $lastSample) { $lastSample.y - $screenY } else { $null }
        $actualStrictInterior = if ($null -ne $lastSample) { $lastSample.strictInterior } else { $null }
      }
      Mark 'cursor-settlement-complete' ([ordered]@{settled=$settled;failureReason=$settlementFailureReason;sampleCount=$settlementSamples.Count;stableRunLength=$stableRun.Count;elapsedMs=[Math]::Round($settlementClock.Elapsed.TotalMilliseconds,3);acceptedCursor=$acceptedCursor;repulseCount=$repulseCount})
      $nativeEnvironment = [ordered]@{
        selector = $payload.selector
        cursorBeforeSetCursorPos = if ($cursorBeforeSetCursorPosOk) { [ordered]@{ x=$cursorBeforeSetCursorPos.X; y=$cursorBeforeSetCursorPos.Y } } else { $null }
        setCursorPos = [ordered]@{ requested=[ordered]@{x=$screenX;y=$screenY}; win32Return=[bool]$setCursorPosResult; win32LastErrorDiagnosticOnly=$setCursorPosWin32Error }
        clipCursorBeforeSetCursorPos = $clipCursorBeforeDiag
        clipCursorAfterReadback = $clipCursorAfterDiag
        virtualScreenMetrics = $virtualScreenDiag
        intendedPointMonitor = $intendedMonitorDiag
        preMoveCursorMonitor = $preMoveCursorDiag
        dpiAwareness = $dpiAwarenessDiag
        session = $sessionDiag
        settlementChronology = [ordered]@{
          requestedPoint = [ordered]@{x=$screenX;y=$screenY}
          initialCursor = if ($cursorBeforeSetCursorPosOk) { [ordered]@{x=$cursorBeforeSetCursorPos.X;y=$cursorBeforeSetCursorPos.Y} } else { $null }
          samples = $settlementSamples
          requiredStableCount = $requiredStableCount
          maxSettlementStepPixels = $maxSettlementStepPixels
          settlementTimeoutMs = $settlementTimeoutMs
          pollIntervalMs = $pollIntervalMs
          repulseCount = $repulseCount
          settled = $settled
          failureReason = $settlementFailureReason
          acceptedCursor = $acceptedCursor
          elapsedMs = [Math]::Round($settlementClock.Elapsed.TotalMilliseconds,3)
        }
      }
      # Custody invariant, now evaluated only once Windows has demonstrably
      # finished positioning the cursor (see COLD-04, P1 -- cursor custody;
      # distinct from the unrelated warm-iteration-count P1): the physical
      # cursor must have settled into a stable run of samples strictly
      # inside the verified activation target (or, with no target supplied,
      # simply stopped moving), and the final immediate pre-SendInput
      # re-check must still agree, before any gesture may proceed.
      if (-not $settled) { throw "actual cursor did not settle into custody before the native gesture: $settlementFailureReason" }
      if ($payload.action -eq 'click') {
        $requestedInputCount=2
        $win32Error=0
        $beforeGestureUtc=(Get-Date).ToUniversalTime().ToString('o')
        Mark 'send-input-batch-before' ([ordered]@{api='SendInput';requestedInputCount=$requestedInputCount;records=@('LEFTDOWN','LEFTUP')})
        $returnedInputCount=[int][LightsOutNativeWorker]::SendLeftClickBatch([ref]$win32Error)
        $afterGestureUtc=(Get-Date).ToUniversalTime().ToString('o')
        Mark 'send-input-batch-after' ([ordered]@{api='SendInput';requestedInputCount=$requestedInputCount;returnedInputCount=$returnedInputCount;win32Error=if($returnedInputCount -eq $requestedInputCount){$null}else{$win32Error}})
        $afterCursor = New-Object LightsOutNativeWorker+POINT
        if (-not [LightsOutNativeWorker]::GetCursorPos([ref]$afterCursor)) { throw 'GetCursorPos after native gesture failed' }
        $postGestureCursor=[ordered]@{x=$afterCursor.X;y=$afterCursor.Y}
        $gesture=[ordered]@{api='SendInput';records=@('LEFTDOWN','LEFTUP');requestedInputCount=$requestedInputCount;returnedInputCount=$returnedInputCount;win32Error=if($returnedInputCount -eq $requestedInputCount){$null}else{$win32Error};beforeUtc=$beforeGestureUtc;afterUtc=$afterGestureUtc;preGestureCursor=$actualCursor;postGestureCursor=$postGestureCursor;deliberateDelayMs=0;retryCount=0}
        if ($returnedInputCount -ne $requestedInputCount) { throw "SendInput inserted $returnedInputCount of $requestedInputCount INPUT records (Win32 error $win32Error)" }
      }
    } elseif ($payload.kind -eq 'key') {
      $vk=[byte]$payload.virtualKey;$modifiers=@($payload.modifiers)
      foreach($modifier in $modifiers){[LightsOutNativeWorker]::keybd_event([byte]$modifier,0,0,[UIntPtr]::Zero)}
      [LightsOutNativeWorker]::keybd_event($vk,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 35;[LightsOutNativeWorker]::keybd_event($vk,0,2,[UIntPtr]::Zero)
      [array]::Reverse($modifiers);foreach($modifier in $modifiers){[LightsOutNativeWorker]::keybd_event([byte]$modifier,0,2,[UIntPtr]::Zero)}
    } else { throw "Unknown native input kind: $($payload.kind)" }
    Mark 'request-complete'
    if ($captureForegroundChronology) { Sample-Foreground 'before-worker-response' }
    Send-Message ([ordered]@{type='result';requestId=$payload.requestId;ok=$true;value=[ordered]@{processId=$pidValue;windowHandle=$hwnd.ToInt64();windowTitle=[LightsOutNativeWorker]::GetTitle($hwnd);windowBounds=[ordered]@{left=$window.Left;top=$window.Top;right=$window.Right;bottom=$window.Bottom};clientBounds=[ordered]@{left=$origin.X;top=$origin.Y;width=$client.Right-$client.Left;height=$client.Bottom-$client.Top};screenPoint=if($null -ne $screenX){[ordered]@{x=$screenX;y=$screenY}}else{$null};actualCursor=$actualCursor;postGestureCursor=$postGestureCursor;translatedTarget=$translatedRect;gesture=$gesture;timeline=$timeline;foregroundChronology=$foregroundChronology;nativeEnvironment=$nativeEnvironment}})
  } catch {
    # Diagnostic only (item A.6): a foreground sample taken on the failure
    # path too, guarded the same way as every other Sample-Foreground call
    # (never throws, never affects which branch produced the error).
    try { if ($captureForegroundChronology) { Sample-Foreground 'before-worker-response-failure' } } catch {}
    Send-Message ([ordered]@{type='result';requestId=$payload.requestId;ok=$false;error=$_.Exception.Message;errorData=[ordered]@{timeline=$timeline;foregroundChronology=$foregroundChronology;gesture=$gesture;screenPoint=if($null -ne $screenX){[ordered]@{x=$screenX;y=$screenY}}else{$null};preGestureCursor=$actualCursor;postGestureCursor=$postGestureCursor;translatedTarget=$translatedRect;dx=$dx;dy=$dy;actualStrictInterior=$actualStrictInterior;nativeEnvironment=$nativeEnvironment;selector=$payload.selector}})
  }
}
