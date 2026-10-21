// Windows 10+ suspend helper. No action on startup: --serve needs a matching
// one-use commit on stdin, after the parent has observed readiness. --probe
// only reads capabilities and never adjusts privileges or requests suspension.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace LightsOut.Power {
    public sealed class Capabilities {
        public bool sleep, hibernate, modernStandby;
        public static Capabilities FromFlags(bool s1, bool s2, bool s3, bool s4, bool file, byte fileType, bool aoac) {
            return new Capabilities { sleep = s1 || s2 || s3 || aoac,
                hibernate = s4 && file && fileType == 2, modernStandby = aoac };
        }
    }
    public sealed class Result {
        public string status = "blocked", reason, systemOutcome = "unverified";
        public int errorCode, cleanupErrorCode;
        public bool requested, accepted;
    }
    public interface IPowerApi {
        Capabilities Probe();
        IDisposable EnablePrivilege();
        bool Suspend(bool hibernate, bool force, bool disableWakeEvents);
        int LastError { get; }
    }
    public sealed class Adapter {
        readonly IPowerApi api;
        public Adapter(IPowerApi value) { api = value; }
        public static bool Supported(Capabilities c, string action) {
            return c != null && (action == "sleep" ? c.sleep : action == "hibernate" && c.hibernate);
        }
        public Result Request(string action, bool committed, Action invoking) {
            var result = new Result(); IDisposable privilege = null;
            try {
                if (!committed) { result.reason = "not-committed"; return result; }
                if (action != "sleep" && action != "hibernate") { result.reason = "invalid-action"; return result; }
                // Recheck immediately before execution; Windows settings may have changed.
                if (!Supported(api.Probe(), action)) { result.reason = "unsupported-state"; return result; }
                privilege = api.EnablePrivilege();
                invoking(); // If reporting fails, do not make an unrecorded request.
                result.requested = true;
                result.accepted = api.Suspend(action == "hibernate", false, false);
                result.errorCode = result.accepted ? 0 : api.LastError;
                result.status = result.accepted ? "accepted" : "failed";
                result.reason = result.accepted ? "native-api-returned-true" : "native-api-returned-false";
            } catch (Win32Exception e) {
                result.errorCode = e.NativeErrorCode; result.reason = "native-error";
                result.status = result.requested ? "failed" : "blocked";
            } catch (Exception e) {
                result.reason = e is PlatformNotSupportedException ? "unsupported-platform" :
                    e is DllNotFoundException || e is EntryPointNotFoundException ? "api-unavailable" : "helper-error";
                result.status = result.requested ? "unknown" : "blocked";
            } finally {
                // Never turn an accepted native request into a false pre-request block
                // if privilege restoration fails. The short-lived process exits anyway.
                if (privilege != null) try { privilege.Dispose(); }
                    catch (Win32Exception e) { result.cleanupErrorCode = e.NativeErrorCode; }
                    catch { result.cleanupErrorCode = -1; }
            }
            return result;
        }
    }
    public sealed class WindowsApi : IPowerApi {
        // Windows 10 SDK SYSTEM_POWER_CAPABILITIES: byte-sized BOOLEAN fields.
        // Unused battery/wake tail is reserved; full native size is 76 bytes.
        [StructLayout(LayoutKind.Explicit, Size = 76)]
        public struct NativeCapabilities {
            [FieldOffset(3)] public byte s1;
            [FieldOffset(4)] public byte s2;
            [FieldOffset(5)] public byte s3;
            [FieldOffset(6)] public byte s4;
            [FieldOffset(8)] public byte hiberFile;
            [FieldOffset(20)] public byte aoac;
            [FieldOffset(22)] public byte hiberFileType;
        }
        [DllImport("powrprof.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.U1)]
        static extern bool GetPwrCapabilities(out NativeCapabilities value);
        [DllImport("powrprof.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.U1)]
        static extern bool SetSuspendState([MarshalAs(UnmanagedType.U1)] bool hibernate,
            [MarshalAs(UnmanagedType.U1)] bool force, [MarshalAs(UnmanagedType.U1)] bool disableWakeEvents);
        public int LastError { get; private set; }
        public Capabilities Probe() {
            if (Environment.OSVersion.Platform != PlatformID.Win32NT) throw new PlatformNotSupportedException();
            NativeCapabilities c;
            if (!GetPwrCapabilities(out c)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return Capabilities.FromFlags(c.s1 != 0, c.s2 != 0, c.s3 != 0, c.s4 != 0,
                c.hiberFile != 0, c.hiberFileType, c.aoac != 0);
        }
        public IDisposable EnablePrivilege() { return new ShutdownPrivilege(); }
        public bool Suspend(bool hibernate, bool force, bool disableWakeEvents) {
            bool accepted = SetSuspendState(hibernate, force, disableWakeEvents);
            LastError = accepted ? 0 : Marshal.GetLastWin32Error();
            return accepted;
        }
        sealed class ShutdownPrivilege : IDisposable {
            [StructLayout(LayoutKind.Sequential)] struct Luid { public uint low; public int high; }
            [StructLayout(LayoutKind.Sequential)] struct TokenPrivileges { public uint count; public Luid id; public uint attributes; }
            [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
            [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
            [DllImport("kernel32.dll")] static extern void SetLastError(uint value);
            [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
            [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool LookupPrivilegeValue(string system, string name, out Luid id);
            [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll,
                ref TokenPrivileges state, uint bytes, out TokenPrivileges previous, out uint needed);
            IntPtr token; TokenPrivileges previous; bool changed;
            public ShutdownPrivilege() {
                if (!OpenProcessToken(GetCurrentProcess(), 0x20 | 0x8, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
                try {
                    Luid id;
                    if (!LookupPrivilegeValue(null, "SeShutdownPrivilege", out id)) throw new Win32Exception(Marshal.GetLastWin32Error());
                    var next = new TokenPrivileges { count = 1, id = id, attributes = 2 };
                    uint needed; SetLastError(0);
                    bool ok = AdjustTokenPrivileges(token, false, ref next, (uint)Marshal.SizeOf(typeof(TokenPrivileges)), out previous, out needed);
                    int error = Marshal.GetLastWin32Error(); changed = ok;
                    // AdjustTokenPrivileges may return TRUE with ERROR_NOT_ALL_ASSIGNED.
                    if (!ok || error != 0) throw new Win32Exception(error);
                } catch { Dispose(); throw; }
            }
            public void Dispose() {
                if (token == IntPtr.Zero) return;
                try {
                    if (changed) {
                        TokenPrivileges ignored; uint needed; SetLastError(0);
                        bool ok = AdjustTokenPrivileges(token, false, ref previous, (uint)Marshal.SizeOf(typeof(TokenPrivileges)), out ignored, out needed);
                        int error = Marshal.GetLastWin32Error();
                        if (!ok || error != 0) throw new Win32Exception(error);
                    }
                } finally { CloseHandle(token); token = IntPtr.Zero; }
            }
        }
    }
    public static class Program {
        static readonly JavaScriptSerializer json = new JavaScriptSerializer();
        static void Write(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
        public static int Main(string[] args) {
            try {
                IPowerApi api;
#if POWER_TEST
                // Compile-time substitution only; production has no fake/execution toggle.
                api = new TestApi();
                if (args.Length == 1 && args[0] == "--self-test") { Write(TestApi.SelfTest()); return 0; }
#else
                api = new WindowsApi();
#endif
                if (args.Length == 1 && args[0] == "--probe") {
                    Write(new { type = "capabilities", version = 1, capabilities = api.Probe(), realPowerCalls = 0, privilegeAdjusted = false }); return 0;
                }
                if (args.Length != 3 || args[0] != "--serve" ||
                    (args[1] != "sleep" && args[1] != "hibernate") || !Regex.IsMatch(args[2], "\\A[a-f0-9]{32}\\z")) {
                    Write(new { type = "error", reason = "invalid-arguments" }); return 2;
                }
                string action = args[1], requestId = args[2];
                Capabilities capabilities = api.Probe();
                if (!Adapter.Supported(capabilities, action)) {
                    Write(new { type = "result", requestId, result = new Result { reason = "unsupported-state" } }); return 0;
                }
                Write(new { type = "ready", version = 1, requestId, action, capabilities });
                // No request on launch, timeout, EOF, malformed or mismatched commit.
                Task<string> input = Task.Run(() => Console.ReadLine());
                bool committed = input.Wait(10000) && input.Result == "commit:" + requestId;
                var result = new Adapter(api).Request(action, committed,
                    () => Write(new { type = "invoking", requestId, api = "SetSuspendState" }));
                Write(new { type = "result", requestId, result }); return 0;
            } catch (Exception e) {
                Write(new { type = "error", reason = "helper-initialization-failed", errorCode = e is Win32Exception ? ((Win32Exception)e).NativeErrorCode : 0 }); return 1;
            }
        }
    }
}
