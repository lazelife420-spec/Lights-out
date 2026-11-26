package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Pure First Light decisions behind the Android glue in PhoneFirstLight: the
 * inexact-reminder window, trigger re-arm after failures, mid-ramp config edits,
 * the all-yielded early end, and the morning state machine and its wording.
 * PendingIntent identity, alarm delivery and wake-lock behaviour are NOT covered
 * here; they remain emulator / physical-device checks.
 */
class FirstLightStateTest {
    private val zone: ZoneId = ZoneId.of("America/New_York")
    private val minute = 60_000L

    // 2026-11-25 is a Wednesday.
    private fun at(day: Int, hour: Int, minute: Int, second: Int = 0): Long =
        ZonedDateTime.of(LocalDate.of(2026, 11, day), LocalTime.of(hour, minute, second), zone)
            .toInstant().toEpochMilli()

    private val lightA = "192.168.1.25"
    private val lightB = "192.168.1.26"

    private fun sunrise(
        minutes: Int = 45,
        time: LocalTime = LocalTime.of(7, 0),
        targets: List<String> = listOf(lightA, lightB)
    ) = PhoneFirstLightConfig(
        enabled = true,
        time = time,
        weekdays = setOf(1, 2, 3, 4, 5),
        sunriseEnabled = true,
        sunriseMinutes = minutes,
        lightTargets = targets,
        armedAt = at(24, 12, 0)
    )

    private val todayKey = "fl:2026-11-25:07:00"
    private fun pending(endedBy: FirstLightRampEnd? = null, noted: Boolean = false) =
        FirstLightPending(todayKey, at(25, 7, 0), at(25, 6, 15), endedBy, noted)

    // --- 1. Inexact fallback: the late window matches AlarmManager's inexact cap. ---

    @Test
    fun inexactReminderIsAcceptedUpToTheInexactCapAndSaysAround() {
        // Review scenario: 45-min sunrise for 07:00, ramp claimed at 06:15, exact access
        // revoked at 06:20, reminder re-armed inexactly, delivered at 07:18.
        val cfg = sunrise()
        val p = pending().trigger()
        val wake = p.wakeEpochMs
        val key = FirstLightPlan.inexactReminderKey(exactNow = false, pendingKey = p.occurrenceKey, persistedInexactKey = "")
        assertEquals(todayKey, key)
        assertTrue(FirstLightPlan.isInexactReminder(todayKey, key))
        val window = FirstLightPlan.reminderLateWindowMs(inexact = true)
        assertEquals(60 * minute, window)
        assertEquals(FirstLightPlan.REMINDER_LATE_WINDOW_MS, FirstLightPlan.reminderLateWindowMs(inexact = false))

        // Armed at 06:20 without exact access: only the claimed morning is armed.
        assertEquals(p, FirstLightPlan.reminderTarget(cfg, at(25, 6, 20), zone, emptySet(), p, includeUpcoming = false, inexactKey = key))

        // The old 10-minute window dropped the 07:18 delivery; the inexact window posts it.
        assertFalse(FirstLightPlan.reminderDue(at(25, 7, 18), wake))
        assertTrue(FirstLightPlan.reminderDue(at(25, 7, 18), wake, window))
        assertTrue(FirstLightPlan.reminderDue(wake + window, wake, window))
        assertFalse(FirstLightPlan.reminderDue(wake + window + 1L, wake, window))
        assertEquals(p, FirstLightPlan.reminderTarget(cfg, at(25, 7, 18), zone, emptySet(), p, includeUpcoming = false, inexactKey = key))
        assertNull(FirstLightPlan.reminderTarget(cfg, wake + window + 1L, zone, emptySet(), p, includeUpcoming = false, inexactKey = key))
        assertTrue(FirstLightPlan.pendingReminderOpen(p, at(25, 7, 18), emptySet(), key))
        assertFalse(FirstLightPlan.pendingReminderOpen(p, at(25, 7, 18), emptySet(), ""))

        // Access re-granted at 07:20: the persisted inexact key keeps that morning's window.
        val regranted = FirstLightPlan.inexactReminderKey(exactNow = true, pendingKey = todayKey, persistedInexactKey = todayKey)
        assertEquals(todayKey, regranted)
        assertEquals(p, FirstLightPlan.reminderTarget(cfg, at(25, 7, 20), zone, emptySet(), p, inexactKey = regranted))
        // A morning armed exactly keeps the 10-minute window.
        assertEquals("", FirstLightPlan.inexactReminderKey(exactNow = true, pendingKey = todayKey, persistedInexactKey = ""))
        assertFalse(FirstLightPlan.isInexactReminder("", ""))

        assertEquals("around 07:00", FirstLightPlan.reminderWhen("07:00", inexact = true))
        assertEquals("at 07:00", FirstLightPlan.reminderWhen("07:00", inexact = false))
        assertTrue(FirstLightPlan.interruptedNotice("around 07:00").endsWith("still fires around 07:00."))
    }

    @Test
    fun aReArmedPastReminderAlwaysPostsSoItCanNeverReArmInALoop() {
        // An alarm armed for a past wake time fires immediately. handleReminderAlarm then
        // checks reminderDue with the window of the same arming, and the re-arm in its
        // finally block uses reminderTarget with that same window. Invariant: whatever
        // reminderTarget returns with a wake at or before now is due and armed, so it is
        // posted (marker set) instead of being re-armed again.
        val cfg = sunrise()
        val p = pending().trigger()
        val nextDayKey = "fl:2026-11-26:07:00"
        var checked = 0
        var t = at(25, 6, 0)
        while (t <= at(26, 9, 0)) {
            for (exactNow in listOf(true, false)) {
                for (persisted in listOf("", todayKey, nextDayKey)) {
                    val key = FirstLightPlan.inexactReminderKey(exactNow, p.occurrenceKey, persisted)
                    val target = FirstLightPlan.reminderTarget(cfg, t, zone, emptySet(), p, includeUpcoming = exactNow, inexactKey = key)
                        ?: continue
                    val window = FirstLightPlan.reminderLateWindowMs(FirstLightPlan.isInexactReminder(target.occurrenceKey, key))
                    // Delivered on time, or immediately when re-armed in the past: always accepted.
                    assertTrue("due at wake ${target.occurrenceKey}", FirstLightPlan.reminderDue(target.wakeEpochMs, target.wakeEpochMs, window))
                    if (target.wakeEpochMs <= t) {
                        checked++
                        assertTrue("past target due t=$t key=$key", FirstLightPlan.reminderDue(t, target.wakeEpochMs, window))
                        assertTrue(
                            "past target armed t=$t key=$key",
                            FirstLightPlan.isArmedReminder(cfg, zone, target.occurrenceKey, target.wakeEpochMs, emptySet(), p)
                        )
                    }
                }
            }
            t += minute
        }
        assertTrue("the simulation exercised past re-arms", checked > 0)

        // A rejected (too late) delivery is never the next target again.
        val inexactKey = FirstLightPlan.inexactReminderKey(false, todayKey, "")
        val tooLate = p.wakeEpochMs + FirstLightPlan.INEXACT_REMINDER_LATE_WINDOW_MS + 1L
        assertFalse(FirstLightPlan.reminderDue(tooLate, p.wakeEpochMs, FirstLightPlan.reminderLateWindowMs(true)))
        assertNull(FirstLightPlan.reminderTarget(cfg, tooLate, zone, emptySet(), p, includeUpcoming = false, inexactKey = inexactKey))
        val exactLate = p.wakeEpochMs + FirstLightPlan.REMINDER_LATE_WINDOW_MS + 1L
        assertNotEquals(p, FirstLightPlan.reminderTarget(cfg, exactLate, zone, emptySet(), p))
    }

    // --- 2. Failure paths: an in-process claim stops an immediate re-fire. ---

    @Test
    fun aFailedTriggerConsumedInProcessIsNotReArmedForImmediateReFire() {
        val plain = PhoneFirstLightConfig(enabled = true, time = LocalTime.of(7, 0), armedAt = at(24, 12, 0))
        val now = at(25, 7, 0, 20)
        val lookBack = Instant.ofEpochMilli(now - FirstLightPlan.TRIGGER_LOOKBACK_MS)
        // Storage refused the claim: re-arming would target the same just-fired trigger again.
        assertEquals(todayKey, plain.nextTriggerAfter(lookBack, zone, consumed = emptySet())!!.occurrenceKey)
        // With the in-process claim merged in, the re-arm moves on to the next wake day.
        val next = plain.nextTriggerAfter(lookBack, zone, consumed = setOf(todayKey))!!
        assertEquals("fl:2026-11-26:07:00", next.occurrenceKey)
        assertTrue(next.triggerEpochMs > now)
    }

    // --- 3. Mid-ramp config edits. ---

    @Test
    fun midRampEditsStopTheRampOnlyWhenTheNewConfigNoLongerCoversIt() {
        val targets = listOf(lightA, lightB)
        fun decide(cfg: PhoneFirstLightConfig, live: List<String> = targets, pendingKey: String? = todayKey) =
            FirstLightPlan.configEditDecision(cfg, todayKey, live, pendingKey)

        // Unchanged, brightness or ramp-length edits keep the running ramp and its reminder.
        assertEquals(FirstLightEditDecision(stopRamp = false, dropPending = false), decide(sunrise()))
        assertEquals(FirstLightEditDecision(false, false), decide(sunrise().copy(endBrightness = 60)))
        assertEquals(FirstLightEditDecision(false, false), decide(sunrise(minutes = 20)))

        // Wake time moved 07:00 -> 07:30: stop the ramp and drop the old pending reminder,
        // so only the new wake time alerts.
        assertEquals(FirstLightEditDecision(stopRamp = true, dropPending = true), decide(sunrise(time = LocalTime.of(7, 30))))

        // Sunrise unticked: stop the ramp, keep this morning's reminder.
        val noSunrise = sunrise().copy(sunriseEnabled = false, lightTargets = emptyList())
        assertEquals(FirstLightEditDecision(stopRamp = true, dropPending = false), decide(noSunrise))

        // A light the ramp still drives was removed: stop, keep the reminder.
        assertEquals(FirstLightEditDecision(true, false), decide(sunrise(targets = listOf(lightA))))
        // A light that already yielded was removed: the ramp no longer drives it, keep going.
        assertEquals(FirstLightEditDecision(false, false), decide(sunrise(targets = listOf(lightA)), live = listOf(lightA)))

        // First Light off: stop and drop everything.
        assertEquals(FirstLightEditDecision(true, true), decide(sunrise().copy(enabled = false)))

        // No ramp running: only a moved wake time drops a stopped/interrupted pending morning.
        assertEquals(
            FirstLightEditDecision(false, true),
            FirstLightPlan.configEditDecision(sunrise(time = LocalTime.of(6, 30)), null, emptyList(), todayKey)
        )
        assertEquals(FirstLightEditDecision(false, false), FirstLightPlan.configEditDecision(noSunrise, null, emptyList(), todayKey))
        assertEquals(FirstLightEditDecision(false, false), FirstLightPlan.configEditDecision(sunrise(), null, emptyList(), null))

        // Occurrence keys are parsed strictly.
        assertEquals(LocalDate.of(2026, 11, 25), FirstLightPlan.occurrenceDate(todayKey))
        assertNull(FirstLightPlan.occurrenceDate("2026-11-25:07:00"))
        assertNull(FirstLightPlan.occurrenceDate("fl:not-a-date:07:00"))
        assertTrue(FirstLightPlan.occurrenceStillScheduled(sunrise(), todayKey))
        assertFalse(FirstLightPlan.occurrenceStillScheduled(sunrise(time = LocalTime.of(7, 30)), todayKey))
        assertFalse(FirstLightPlan.occurrenceStillScheduled(sunrise(), "garbage"))
    }

    @Test
    fun movedWakeTimeLeavesOnlyTheNewOccurrenceToAlert() {
        // 06:50, ramp for 07:00 running; the user moves the wake time to 07:30.
        val edited = sunrise(minutes = 15, time = LocalTime.of(7, 30)).copy(armedAt = at(25, 6, 50))
        val decision = FirstLightPlan.configEditDecision(edited, todayKey, listOf(lightA, lightB), todayKey)
        assertTrue(decision.stopRamp && decision.dropPending)
        // With the old pending dropped, the one reminder alarm targets only 07:30.
        val target = FirstLightPlan.reminderTarget(edited, at(25, 6, 50), zone, emptySet(), pending = null)!!
        assertEquals("fl:2026-11-25:07:30", target.occurrenceKey)
        assertEquals(at(25, 7, 30), target.wakeEpochMs)
    }

    // --- 4. Every light yielded: end the ramp early, keep the reminder. ---

    @Test
    fun allLightsYieldedEndsTheRampEarlyButKeepsTheWakeReminder() {
        assertTrue(FirstLightPlan.allLightsYielded(startTargets = 2, remainingTargets = 0))
        assertFalse(FirstLightPlan.allLightsYielded(startTargets = 2, remainingTargets = 1))
        assertFalse(FirstLightPlan.allLightsYielded(startTargets = 0, remainingTargets = 0))

        val yielded = pending(endedBy = FirstLightRampEnd.YIELDED)
        // The pending morning stays armed for its wake reminder...
        assertEquals(
            yielded.trigger(),
            FirstLightPlan.reminderTarget(sunrise(), at(25, 6, 40), zone, emptySet(), yielded.trigger())
        )
        // ...says "yielded", and is never re-reported as an interruption.
        assertEquals(FirstLightMorning.YIELDED, FirstLightPlan.morningState(todayKey, null, yielded))
        assertTrue(FirstLightPlan.reminderMessage(FirstLightMorning.YIELDED, false, 0L, "07:00").detail.contains("yielded to manual control"))
        assertFalse(FirstLightPlan.interruptedRampNoticeDue(true, false, yielded, at(25, 6, 40)))
        assertEquals(
            "First Light sunrise yielded to manual control; lights were left as they were. The wake reminder still fires at 07:00.",
            FirstLightPlan.rampEndedNotice(FirstLightRampEnd.YIELDED, "at 07:00")
        )
    }

    // --- 7. Morning state machine and wording. ---

    @Test
    fun morningStateMachineCoversEveryEnding() {
        assertEquals(FirstLightMorning.FINISHING, FirstLightPlan.morningState(todayKey, todayKey, pending()))
        // A running ramp wins over any persisted ending of the same key.
        assertEquals(FirstLightMorning.FINISHING, FirstLightPlan.morningState(todayKey, todayKey, pending(FirstLightRampEnd.STOPPED)))
        assertEquals(FirstLightMorning.STOPPED, FirstLightPlan.morningState(todayKey, null, pending(FirstLightRampEnd.STOPPED)))
        assertEquals(FirstLightMorning.EDITED, FirstLightPlan.morningState(todayKey, null, pending(FirstLightRampEnd.EDITED)))
        assertEquals(FirstLightMorning.YIELDED, FirstLightPlan.morningState(todayKey, null, pending(FirstLightRampEnd.YIELDED)))
        assertEquals(FirstLightMorning.NOT_STARTED, FirstLightPlan.morningState(todayKey, null, pending(FirstLightRampEnd.NOT_STARTED)))
        assertEquals(FirstLightMorning.INTERRUPTED, FirstLightPlan.morningState(todayKey, null, pending()))
        assertEquals(FirstLightMorning.INTERRUPTED, FirstLightPlan.morningState(todayKey, null, pending(noted = true)))
        // A ramp or pending record of another morning does not colour this reminder.
        assertEquals(FirstLightMorning.PLAIN, FirstLightPlan.morningState(todayKey, "fl:2026-11-26:07:00", null))
        assertEquals(FirstLightMorning.PLAIN, FirstLightPlan.morningState("fl:2026-11-26:07:00", null, pending()))
        assertEquals(FirstLightMorning.PLAIN, FirstLightPlan.morningState("", "", null))

        // Persisted ids round-trip and are distinct (the UI keys its wording on them).
        for (end in FirstLightRampEnd.entries) assertEquals(end, FirstLightRampEnd.parse(end.id))
        assertNull(FirstLightRampEnd.parse(""))
        assertNull(FirstLightRampEnd.parse(null))
        assertEquals(FirstLightMorning.entries.size, FirstLightMorning.entries.map { it.id }.toSet().size)
    }

    @Test
    fun reminderTextMatchesTheMorningAndFlagsLateInexactDelivery() {
        val texts = FirstLightMorning.entries.associateWith { FirstLightPlan.reminderMessage(it, false, 0L, "07:00") }
        assertEquals("Good morning. Your local WiZ sunrise is finishing.", texts[FirstLightMorning.FINISHING]!!.detail)
        assertEquals("Good morning. Sunrise was stopped earlier; lights were left as they were.", texts[FirstLightMorning.STOPPED]!!.detail)
        assertTrue(texts[FirstLightMorning.EDITED]!!.detail.contains("settings changed"))
        assertTrue(texts[FirstLightMorning.NOT_STARTED]!!.detail.contains("lights were not changed"))
        assertEquals("Good morning. Sunrise was interrupted; lights were left as they were.", texts[FirstLightMorning.INTERRUPTED]!!.detail)
        assertEquals("Your phone-owned First Light morning reminder.", texts[FirstLightMorning.PLAIN]!!.detail)
        assertEquals("every morning has its own wording", texts.size, texts.values.map { it.detail }.toSet().size)

        // Only an inexact delivery more than two minutes late says so.
        val plain = texts[FirstLightMorning.INTERRUPTED]!!
        assertEquals(plain, FirstLightPlan.reminderMessage(FirstLightMorning.INTERRUPTED, true, FirstLightPlan.LATE_NOTE_MS, "07:00"))
        assertEquals(plain, FirstLightPlan.reminderMessage(FirstLightMorning.INTERRUPTED, false, 30 * minute, "07:00"))
        val late = FirstLightPlan.reminderMessage(FirstLightMorning.INTERRUPTED, true, 18 * minute, "07:00")
        assertTrue(late.detail.startsWith(plain.detail))
        assertTrue(late.detail.contains("07:00 reminder late"))
        assertTrue(late.event.contains("late"))
    }

    @Test
    fun interruptedNoticeIsOnlyForAnUnexplainedUnreportedFutureMorning() {
        val now = at(25, 6, 30)
        assertTrue(FirstLightPlan.interruptedRampNoticeDue(true, false, pending(), now))
        assertFalse("First Light off", FirstLightPlan.interruptedRampNoticeDue(false, false, pending(), now))
        assertFalse("ramp still running", FirstLightPlan.interruptedRampNoticeDue(true, true, pending(), now))
        assertFalse("nothing pending", FirstLightPlan.interruptedRampNoticeDue(true, false, null, now))
        assertFalse("already reported", FirstLightPlan.interruptedRampNoticeDue(true, false, pending(noted = true), now))
        assertFalse("wake time passed", FirstLightPlan.interruptedRampNoticeDue(true, false, pending(), at(25, 7, 0)))
        for (end in FirstLightRampEnd.entries) {
            assertFalse("ended by $end", FirstLightPlan.interruptedRampNoticeDue(true, false, pending(end), now))
        }
    }

    @Test
    fun rampEndAndFinishWordingNeverPromisesAReminderThatIsGone() {
        assertEquals(
            "First Light sunrise stopped. The wake reminder still fires around 07:00.",
            FirstLightPlan.rampEndedNotice(FirstLightRampEnd.STOPPED, "around 07:00")
        )
        // No pending reminder left (already posted): no promise.
        assertEquals("First Light sunrise stopped.", FirstLightPlan.rampEndedNotice(FirstLightRampEnd.STOPPED, null))
        val moved = FirstLightPlan.rampEndedNotice(FirstLightRampEnd.EDITED, null, wakeTimeMoved = true)
        assertTrue(moved.contains("wake time changed") && moved.endsWith("Only the new wake time will alert."))
        assertFalse(moved.contains("still fires"))
        assertTrue(FirstLightPlan.rampEndedNotice(FirstLightRampEnd.EDITED, "at 07:00").contains("settings changed"))
        assertTrue(FirstLightPlan.rampEndedNotice(FirstLightRampEnd.NOT_STARTED, "at 07:00").contains("could not start"))

        assertTrue(FirstLightPlan.rampFinishedMessages(overran = true, yieldedAll = true).first.contains("ran late"))
        assertTrue(FirstLightPlan.rampFinishedMessages(overran = false, yieldedAll = true).second.contains("yielded"))
        assertEquals(
            "Morning reminder fired after local WiZ sunrise." to "First Light sunrise finished.",
            FirstLightPlan.rampFinishedMessages(overran = false, yieldedAll = false)
        )
    }
}
