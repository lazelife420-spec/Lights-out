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
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
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

function Send-Message([object]$Message) {
  [Console]::Out.WriteLine(($Message | ConvertTo-Json -Depth 12 -Compress))
  [Console]::Out.Flush()
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
    function Mark([string]$Name,[object]$Detail=$null) { $timeline.Add([ordered]@{name=$Name;utc=(Get-Date).ToUniversalTime().ToString('o');elapsedMs=[Math]::Round($clock.Elapsed.TotalMilliseconds,3);detail=$Detail}) }
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
    Mark 'current-window-resolved' ([ordered]@{processId=$pidValue;windowHandle=$hwnd.ToInt64();clientLeft=$origin.X;clientTop=$origin.Y;clientWidth=$client.Right-$client.Left;clientHeight=$client.Bottom-$client.Top})
    [void][LightsOutNativeWorker]::ShowWindow($hwnd,9)
    [void][LightsOutNativeWorker]::SetForegroundWindow($hwnd)
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
      if (-not [LightsOutNativeWorker]::SetCursorPos($screenX,$screenY)) { throw 'SetCursorPos failed' }
      Mark 'set-cursor-pos-succeeded' ([ordered]@{x=$screenX;y=$screenY})
      $cursor = New-Object LightsOutNativeWorker+POINT
      if (-not [LightsOutNativeWorker]::GetCursorPos([ref]$cursor)) { throw 'GetCursorPos failed' }
      Mark 'get-cursor-pos-succeeded' ([ordered]@{x=$cursor.X;y=$cursor.Y})
      $actualCursor=[ordered]@{x=$cursor.X;y=$cursor.Y}
      $dx=$cursor.X-$screenX
      $dy=$cursor.Y-$screenY
      $actualStrictInterior=$null
      if ($null -ne $translatedRect) { $actualStrictInterior = [bool]($cursor.X -gt $translatedRect.left -and $cursor.X -lt $translatedRect.right -and $cursor.Y -gt $translatedRect.top -and $cursor.Y -lt $translatedRect.bottom) }
      Mark 'cursor-verified-before-input' ([ordered]@{intended=[ordered]@{x=$screenX;y=$screenY};actual=$actualCursor;dx=$dx;dy=$dy;actualStrictInterior=$actualStrictInterior;translatedTarget=$translatedRect;scaleX=$scaleX;scaleY=$scaleY})
      # Custody invariant: the physical cursor must still be safely on the verified
      # activation target, not bit-for-bit equal to the requested integer pair.
      # A readback within one physical pixel is accepted only when the actual point
      # itself remains strictly inside the same translated target (see COLD-04, P1).
      if ([Math]::Abs($dx) -gt 1 -or [Math]::Abs($dy) -gt 1) { throw 'actual cursor exceeded the one-pixel readback bound of the intended physical point' }
      if ($null -ne $translatedRect -and -not $actualStrictInterior) { throw 'actual cursor position left the strict interior of the current activation target' }
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
    Send-Message ([ordered]@{type='result';requestId=$payload.requestId;ok=$true;value=[ordered]@{processId=$pidValue;windowHandle=$hwnd.ToInt64();windowTitle=[LightsOutNativeWorker]::GetTitle($hwnd);windowBounds=[ordered]@{left=$window.Left;top=$window.Top;right=$window.Right;bottom=$window.Bottom};clientBounds=[ordered]@{left=$origin.X;top=$origin.Y;width=$client.Right-$client.Left;height=$client.Bottom-$client.Top};screenPoint=if($null -ne $screenX){[ordered]@{x=$screenX;y=$screenY}}else{$null};actualCursor=$actualCursor;postGestureCursor=$postGestureCursor;translatedTarget=$translatedRect;gesture=$gesture;timeline=$timeline}})
  } catch {
    Send-Message ([ordered]@{type='result';requestId=$payload.requestId;ok=$false;error=$_.Exception.Message;errorData=[ordered]@{timeline=$timeline;gesture=$gesture;screenPoint=if($null -ne $screenX){[ordered]@{x=$screenX;y=$screenY}}else{$null};preGestureCursor=$actualCursor;postGestureCursor=$postGestureCursor;translatedTarget=$translatedRect;dx=$dx;dy=$dy;actualStrictInterior=$actualStrictInterior}})
  }
}
