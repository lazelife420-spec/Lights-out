package com.lightsout.companion
import org.junit.Assert.*
import org.junit.Test
class PortableRoutineChecksTest {
    @Test fun commonIdsIncludeUnderscoresAndRejectPaths() { assertTrue(PortableRoutineChecks.id("night_1"));assertFalse(PortableRoutineChecks.id("../night"));assertFalse(PortableRoutineChecks.id("x".repeat(81))) }
    @Test fun validPortableWindowsIntentDoesNotAcquirePhoneAuthority() { PortableRoutineChecks.action("timer", "timer.start", "start",600,"sleep",emptyList(),0) }
    @Test(expected = IllegalArgumentException::class) fun remoteAdapterRejected() { PortableRoutineChecks.action("router","router.disable","start",600,"sleep",emptyList(),0) }
    @Test(expected = IllegalArgumentException::class) fun endpointsAreNotLightBindings() { PortableRoutineChecks.action("warm","wiz.warm","start",0,"",listOf("192.168.0.1"),30) }
    @Test(expected = IllegalArgumentException::class) fun wrongActionPhaseRejected() { PortableRoutineChecks.action("off","wiz.off","start",0,"",listOf("light-1"),0) }
    @Test fun failedCommitRestoresCachedAuthorityAndThrows() {
        var memory="previous"; val writes=mutableListOf<String>()
        try { PhoneImportCommit.write(memory,"new") { memory=it;writes.add(it);false };fail("Must report storage failure") } catch (_: IllegalStateException) { }
        assertEquals("previous",memory);assertEquals(listOf("new","previous"),writes)
    }
    @Test fun adoptionIdsSurviveNativeActionProjection() {
        val p=PhoneRoutine("night_1","Night",600,emptyList(),0,false,actionIds=mapOf("timer.start" to "custom_timer"))
        assertEquals("custom_timer",RoutinePlan.from(p).actions.single().id)
    }
    @Test fun abstractSlotNamesSurviveLocalBindingAndNewTargetsAvoidCollisions() {
        val slots=PortableRoutineChecks.slots(listOf("127.0.0.1","127.0.0.2"),mapOf("light-1" to "127.0.0.1"))
        assertEquals("light-1",slots["127.0.0.1"]);assertEquals("light-2",slots["127.0.0.2"])
        assertEquals("bedside",PortableRoutineChecks.slots(listOf("127.0.0.1"),mapOf("bedside" to "127.0.0.1"))["127.0.0.1"])
    }
}
