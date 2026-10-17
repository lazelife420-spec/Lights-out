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
}
