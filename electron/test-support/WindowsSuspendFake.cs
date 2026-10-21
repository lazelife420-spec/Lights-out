// Compiled ONLY with POWER_TEST and WindowsSuspend.cs. Never packaged.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
namespace LightsOut.Power {
    public sealed class TestApi : IPowerApi, IDisposable {
        public bool canSleep = true, canHibernate = true, accepted = true, denied, probeFails, restoreFails;
        public int calls, privileges, restores, delay;
        public bool hibernateArg, forceArg, disableWakeArg;
        public TestApi() {
            string scenario = Environment.GetEnvironmentVariable("LO_POWER_TEST_CASE");
            canSleep = scenario != "unsupported-sleep"; canHibernate = scenario != "unsupported-hibernate";
            denied = scenario == "denied"; accepted = scenario != "failed"; probeFails = scenario == "probe-failed";
            delay = scenario == "delayed" ? 150 : 0;
        }
        public Capabilities Probe() {
            if (probeFails) throw new Win32Exception(5);
            return new Capabilities { sleep = canSleep, hibernate = canHibernate };
        }
        public IDisposable EnablePrivilege() { privileges++; if (denied) throw new Win32Exception(1300); return this; }
        public bool Suspend(bool h, bool f, bool w) { calls++; hibernateArg = h; forceArg = f; disableWakeArg = w; if (delay > 0) Thread.Sleep(delay); return accepted; }
        public int LastError { get { return 1314; } }
        public void Dispose() { restores++; if (restoreFails) throw new Win32Exception(5); }
        static void Require(bool value, string reason) { if (!value) throw new Exception(reason); }
        public static object SelfTest() {
            int checks = 0;
            for (int state = 0; state < 5; state++) {
                var c = Capabilities.FromFlags(state == 0, state == 1, state == 2, false, false, 0, state == 3);
                Require(c.sleep == (state != 4) && !c.hibernate && c.modernStandby == (state == 3), "sleep capability mapping"); checks++;
            }
            foreach (byte type in new byte[] { 0, 1, 2, 3 }) {
                Require(Capabilities.FromFlags(false, false, false, true, true, type, false).hibernate == (type == 2), "hiberfile type"); checks++;
            }
            Require(!Capabilities.FromFlags(false, false, false, false, true, 2, false).hibernate, "S4 unavailable"); checks++;
            Require(!Capabilities.FromFlags(false, false, false, true, false, 2, false).hibernate, "file absent"); checks++;
            Require(Marshal.SizeOf(typeof(WindowsApi.NativeCapabilities)) == 76 && Marshal.OffsetOf(typeof(WindowsApi.NativeCapabilities), "aoac").ToInt32() == 20 && Marshal.OffsetOf(typeof(WindowsApi.NativeCapabilities), "hiberFileType").ToInt32() == 22, "SDK layout"); checks++;
            var f = new TestApi(); var a = new Adapter(f);
            Require(a.Request("sleep", false, () => {}).reason == "not-committed" && f.calls == 0 && f.privileges == 0, "no commit"); checks++;
            Require(a.Request("restart", true, () => {}).reason == "invalid-action" && f.calls == 0, "invalid action"); checks++;
            f.canSleep = false; Require(a.Request("sleep", true, () => {}).reason == "unsupported-state" && f.calls == 0, "unsupported sleep"); checks++;
            f.canSleep = true; f.canHibernate = false; Require(a.Request("hibernate", true, () => {}).reason == "unsupported-state" && f.calls == 0, "unsupported hibernate"); checks++;
            f.canHibernate = true; f.denied = true; Require(a.Request("sleep", true, () => {}).errorCode == 1300 && f.calls == 0, "denied privilege"); checks++;
            f.denied = false; var sleep = a.Request("sleep", true, () => {});
            Require(sleep.accepted && sleep.requested && sleep.systemOutcome == "unverified" && !f.hibernateArg && !f.forceArg && !f.disableWakeArg && f.restores == 1, "sleep args + truthful result"); checks++;
            Require(a.Request("hibernate", true, () => {}).accepted && f.hibernateArg && f.restores == 2, "hibernate args"); checks++;
            f.accepted = false; Require(a.Request("sleep", true, () => {}).errorCode == 1314 && f.restores == 3, "native error + restoration"); checks++;
            var callback = a.Request("sleep", true, () => { throw new IOException(); });
            Require(!callback.requested && f.calls == 3 && f.restores == 4, "failed pre-invoke reporting blocks"); checks++;
            f.probeFails = true; Require(a.Request("sleep", true, () => {}).errorCode == 5 && f.calls == 3, "probe error"); checks++;
            f.probeFails = false; f.restoreFails = true; f.accepted = true;
            var cleanup = a.Request("sleep", true, () => {});
            Require(cleanup.accepted && cleanup.cleanupErrorCode == 5 && cleanup.status == "accepted", "cleanup cannot falsify native result"); checks++;
            return new { status = "PASS", checks, realNativeCalls = 0, compileTimeFake = true };
        }
    }
}
