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
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
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
    $screenX=$null;$screenY=$null;$actualCursor=$null;$translatedRect=$null
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
      $cursor = New-Object LightsOutNativeWorker+POINT
      if (-not [LightsOutNativeWorker]::GetCursorPos([ref]$cursor)) { throw 'GetCursorPos failed' }
      $actualCursor=[ordered]@{x=$cursor.X;y=$cursor.Y}
      Mark 'cursor-verified-before-input' ([ordered]@{intended=[ordered]@{x=$screenX;y=$screenY};actual=$actualCursor;translatedTarget=$translatedRect;scaleX=$scaleX;scaleY=$scaleY})
      if ($cursor.X -ne $screenX -or $cursor.Y -ne $screenY) { throw 'actual cursor does not match intended physical point' }
      if ($payload.action -eq 'click') {
        Mark 'native-pointerdown-requested'
        [LightsOutNativeWorker]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
        Start-Sleep -Milliseconds 50
        Mark 'native-pointerup-requested'
        [LightsOutNativeWorker]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
      }
    } elseif ($payload.kind -eq 'key') {
      $vk=[byte]$payload.virtualKey;$modifiers=@($payload.modifiers)
      foreach($modifier in $modifiers){[LightsOutNativeWorker]::keybd_event([byte]$modifier,0,0,[UIntPtr]::Zero)}
      [LightsOutNativeWorker]::keybd_event($vk,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 35;[LightsOutNativeWorker]::keybd_event($vk,0,2,[UIntPtr]::Zero)
      [array]::Reverse($modifiers);foreach($modifier in $modifiers){[LightsOutNativeWorker]::keybd_event([byte]$modifier,0,2,[UIntPtr]::Zero)}
    } else { throw "Unknown native input kind: $($payload.kind)" }
    Mark 'request-complete'
    Send-Message ([ordered]@{type='result';requestId=$payload.requestId;ok=$true;value=[ordered]@{processId=$pidValue;windowHandle=$hwnd.ToInt64();windowTitle=[LightsOutNativeWorker]::GetTitle($hwnd);windowBounds=[ordered]@{left=$window.Left;top=$window.Top;right=$window.Right;bottom=$window.Bottom};clientBounds=[ordered]@{left=$origin.X;top=$origin.Y;width=$client.Right-$client.Left;height=$client.Bottom-$client.Top};screenPoint=if($null -ne $screenX){[ordered]@{x=$screenX;y=$screenY}}else{$null};actualCursor=$actualCursor;translatedTarget=$translatedRect;timeline=$timeline}})
  } catch {
    Send-Message ([ordered]@{type='result';requestId=$payload.requestId;ok=$false;error=$_.Exception.Message})
  }
}
