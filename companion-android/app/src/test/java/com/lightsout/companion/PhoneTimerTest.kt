package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test

class PhoneTimerTest {
    private fun start(seconds: Long = 60) = PhoneTimer().command("start", seconds, 1000, 100000, 4, "run-a")
    @Test fun `starts idle and rejects replacing active timer`() {
        assertEquals("idle", PhoneTimer().phase)
        assertEquals(60000, start().remaining(1000, 100000, 4))
        assertThrows(IllegalArgumentException::class.java) { start().command("start", 60, 1000, 100000, 4, "b") }
    }
    @Test fun `duration boundaries reject unsupported intervals`() {
        for (seconds in listOf(0L, -60, 59, 86401)) {
            assertThrows(IllegalArgumentException::class.java) { start(seconds) }
        }
        assertEquals(86400000, start(86400).totalMs)
    }
    @Test fun `clock changes do not alter countdown on same boot`() {
        assertEquals(59000, start().remaining(2000, 5000000, 4))
        assertEquals(59000, start().remaining(2000, 0, 4))
    }
    @Test fun `screen off and elapsed process restart do not lose time`() {
        val persisted = start().copy()
        assertEquals(30000, persisted.remaining(31000, 130000, 4))
        assertEquals(0, persisted.remaining(65000, 164000, 4))
    }
    @Test fun `reboot falls back to saved wall deadline`() {
        assertEquals(20000, start().remaining(500, 140000, 5))
        assertEquals(0, start().remaining(500, 170000, 5))
    }
    @Test fun `restored reboot timer uses elapsed time again after rebasing`() {
        val restored = start().restored(500, 140000, 5)
        assertEquals(19000, restored.remaining(1500, 99999999, 5))
        assertEquals(19000, restored.remaining(1500, 0, 5))
        assertEquals("run-a", restored.runId)
        assertEquals(restored, restored.restored(1500, 0, 5))
    }
    @Test fun `pause freezes time and resume establishes a new deadline`() {
        val paused = start().command("pause", 0, 11000, 110000, 4, "")
        assertEquals(50000, paused.remaining(90000, 190000, 4))
        val resumed = paused.command("resume", 0, 90000, 190000, 4, "")
        assertEquals(49000, resumed.remaining(91000, 9999999, 4))
        assertEquals("run-a", resumed.runId)
    }
    @Test fun `add time while paused and running preserves phase and caps total`() {
        val running = start().command("snooze", 300, 2000, 101000, 4, "")
        assertEquals(359000, running.remaining(2000, 101000, 4))
        val paused = start().command("pause", 0, 2000, 101000, 4, "")
            .command("snooze", 300, 10000, 109000, 4, "")
        assertEquals("paused", paused.phase)
        assertEquals(359000, paused.remaining(100000, 200000, 4))
        assertThrows(IllegalArgumentException::class.java) { start(86400).command("snooze", 60, 1000, 100000, 4, "") }
    }
    @Test fun `cancel leaves idle and permits a fresh timer identity`() {
        val idle = start().command("cancel", 0, 2000, 101000, 4, "")
        assertEquals("idle", idle.phase)
        assertEquals(0, idle.remaining(2000, 101000, 4))
        assertEquals("run-b", idle.command("start", 60, 2000, 101000, 4, "run-b").runId)
    }
    @Test fun `cannot finish early or twice or finish a paused timer`() {
        assertThrows(IllegalArgumentException::class.java) { start().command("finish", 0, 60000, 159000, 4, "") }
        val finished = start().command("finish", 0, 61000, 160000, 4, "")
        assertEquals("finished", finished.phase)
        assertThrows(IllegalArgumentException::class.java) { finished.command("finish", 0, 62000, 161000, 4, "") }
        val paused = start().command("pause", 0, 2000, 101000, 4, "")
        assertThrows(IllegalArgumentException::class.java) { paused.command("finish", 0, 90000, 190000, 4, "") }
    }
    @Test fun `routine metadata survives controls but never leaks into a new manual timer`() {
        val routine = start().copy(label = "Night", lightTargets = listOf("10.0.2.2"), offAtEnd = true)
        val paused = routine.command("pause", 0, 2000, 101000, 4, "")
            .command("snooze", 300, 2000, 101000, 4, "")
        assertEquals("Night", paused.label)
        assertEquals(listOf("10.0.2.2"), paused.lightTargets)
        assertTrue(paused.offAtEnd)
        val fresh = paused.command("cancel", 0, 2000, 101000, 4, "")
            .command("start", 60, 2000, 101000, 4, "fresh")
        assertEquals("", fresh.label)
        assertTrue(fresh.lightTargets.isEmpty())
        assertFalse(fresh.offAtEnd)
    }
    @Test fun `invalid state transitions never create a timer`() {
        for (action in listOf("pause", "resume", "snooze", "powerOff")) {
            assertThrows(IllegalArgumentException::class.java) { PhoneTimer().command(action, 300, 1000, 100000, 4, "") }
        }
        assertThrows(IllegalArgumentException::class.java) { start().command("resume", 0, 1000, 100000, 4, "") }
    }
}
