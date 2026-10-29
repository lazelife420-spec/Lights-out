package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class RoutinePlanTest {
    private fun plan() = RoutinePlan("night", "Night", listOf(RoutineAction("timer", "timer.start", "start", seconds = 60)))
    @Test fun explicitLocalOwnerAndStableDayKey() { assertEquals("v1:android:local:night:2026-10-19", plan().key(LocalDate.parse("2026-10-19"))) }
    @Test(expected = IllegalArgumentException::class) fun futureVersionRejected() { plan().copy(schemaVersion = 2) }
    @Test(expected = IllegalArgumentException::class) fun windowsOwnerCannotExecuteOnPhone() { plan().copy(platform = "windows") }
    @Test(expected = IllegalArgumentException::class) fun remoteTargetRejected() { RoutineAction("timer", "timer.start", "start", "pc", 60).validate() }
    @Test(expected = IllegalArgumentException::class) fun routerAdapterRejected() { RoutineAction("router", "router.disable", "start").validate() }
    @Test(expected = IllegalArgumentException::class) fun phonePowerActionRejected() { RoutineAction("timer", "timer.start", "start", seconds = 60, endAction = "shutdown").validate() }
    @Test fun noAcknowledgementCannotBeCompleted() { assertEquals("partial-failure", RoutineResult.aggregate("completed", listOf("failed"))) }
    @Test fun pendingLightsRemainPendingAfterTimer() { assertEquals("waiting-for-actions", RoutineResult.aggregate("completed", listOf("pending"))) }
    @Test fun acknowledgedLightAndCompletedTimerFinish() { assertEquals("completed", RoutineResult.aggregate("completed", listOf("acknowledged"))) }
    @Test fun cancelKeepsItsMeaningDespiteLateLightResults() { assertEquals("cancelled", RoutineResult.aggregate("cancelled", listOf("failed"))) }
    @Test fun actionsUseIndependentTargetsAndStableIdsAfterEdits() {
        val p = PhoneRoutine("night", "Night", 60, listOf("127.0.0.1", "127.0.0.2"), 30, true,
            warmTargets = listOf("127.0.0.1"), offTargets = listOf("127.0.0.2"))
        val first = RoutinePlan.from(p); val edited = RoutinePlan.from(p.copy(seconds = 120, brightness = 50))
        assertEquals(first.actions.map { it.id }, edited.actions.map { it.id })
        assertEquals(listOf("127.0.0.1"), edited.actions.first { it.type == "wiz.warm" }.targets)
        assertEquals(listOf("127.0.0.2"), edited.actions.first { it.type == "wiz.off" }.targets)
        assertEquals(listOf("timer", "off"), RoutinePlan.from(p.copy(brightness = 0)).actions.map { it.id })
    }
    @Test fun legacyRoutineUsesSameTargetsForBothActions() {
        val p = PhoneRoutine("legacy", "Legacy", 60, listOf("127.0.0.1"), 30, true)
        assertTrue(RoutinePlan.from(p).actions.filter { it.type != "timer.start" }.all { it.targets == p.targets })
    }
    @Test(expected = IllegalArgumentException::class) fun enabledActionRequiresItsOwnTargets() {
        PhoneRoutine("night", "Night", 60, listOf("127.0.0.1"), 30, true, warmTargets = emptyList())
    }
}
