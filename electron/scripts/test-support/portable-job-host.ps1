param([Parameter(Mandatory=$true)][string]$RunRoot)
$ErrorActionPreference='Stop'
# Controlled, isolated launcher-lifetime test. This job owns only the new QA
# launcher and its descendants. See Microsoft Learn, Win32 "Job Objects".
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
public sealed class LightsOutOwnedJob : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
  public long ProcessTime, JobTime;
  public uint Flags;
  public UIntPtr MinWorkingSet, MaxWorkingSet;
  public uint ActiveProcesses;
  public UIntPtr Affinity;
  public uint Priority, Scheduling;
 }
 [StructLayout(LayoutKind.Sequential)] struct IoCounters {
  public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
 }
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
  public BasicLimits Basic;
  public IoCounters Io;
  public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
 }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 static extern IntPtr CreateJobObject(IntPtr attributes, string name);
 [DllImport("kernel32.dll", SetLastError=true)]
 static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits value, uint size);
 [DllImport("kernel32.dll", SetLastError=true)]
 static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
 [DllImport("kernel32.dll", SetLastError=true)]
 static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 IntPtr handle;
 public LightsOutOwnedJob() {
  handle=CreateJobObject(IntPtr.Zero,null);
  if(handle==IntPtr.Zero)throw new Win32Exception();
  var value=new ExtendedLimits();value.Basic.Flags=0x00002000;
  if(!SetInformationJobObject(handle,9,ref value,(uint)Marshal.SizeOf(value)))throw new Win32Exception();
 }
 public void Attach(Process process) { if(!AssignProcessToJobObject(handle,process.Handle))throw new Win32Exception(); }
 public bool Contains(Process process) {bool result;if(!IsProcessInJob(process.Handle,handle,out result))throw new Win32Exception();return result;}
 public void Dispose() {if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
}
'@
$testJob = New-Object LightsOutOwnedJob
try {
 $startInfo = New-Object Diagnostics.ProcessStartInfo
 $startInfo.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
 $startInfo.Arguments = '/d /s /c ""' + (Join-Path $RunRoot 'host-start.cmd') + '""'
 $startInfo.WorkingDirectory=$RunRoot
 $startInfo.UseShellExecute=$false
 $startInfo.CreateNoWindow=$true
 $launcherProcess=[Diagnostics.Process]::Start($startInfo)
 $testJob.Attach($launcherProcess)
 [IO.File]::WriteAllText((Join-Path $RunRoot 'launch.allow'),'assigned')
 $deadline=[DateTime]::UtcNow.AddSeconds(45)
 while (!(Test-Path -LiteralPath (Join-Path $RunRoot 'release-job.flag'))) {
  if([DateTime]::UtcNow -gt $deadline){throw 'Test controller did not release owned launcher job'}
  Start-Sleep -Milliseconds 100
 }
 $appRecord=Get-CimInstance Win32_Process -Filter "Name='Lights Out.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine.Contains($RunRoot) } | Select-Object -First 1
 if(!$appRecord){throw 'Owned test app missing before job release'}
 $appProcess=Get-Process -Id $appRecord.ProcessId
 $inOwnedJob=$testJob.Contains($appProcess)
 $testJob.Dispose()
 Start-Sleep -Milliseconds 350
 $stillRunning=!!(Get-Process -Id $appRecord.ProcessId -ErrorAction SilentlyContinue)
 $report=[pscustomobject]@{At=[DateTime]::UtcNow.ToString('o');AppPid=$appRecord.ProcessId;LauncherPid=$launcherProcess.Id;AppWasInControlledJob=$inOwnedJob;AppAliveAfterJobClosed=$stillRunning;RunRoot=$RunRoot}
 $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RunRoot 'job-result.json') -Encoding UTF8
 $report | ConvertTo-Json
} finally { $testJob.Dispose() }
