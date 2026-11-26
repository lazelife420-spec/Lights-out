package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class FirstLightPlanTest {
    private val zone: ZoneId = ZoneId.of("America/New_York")

    // 2026-11-25 is a Wednesday.
    private fun at(day: Int, hour: Int, minute: Int, second: Int = 0): Long =
        ZonedDateTime.of(LocalDate.of(2026, 11, day), LocalTime.of(hour, minute, second), zone)
            .toInstant().toEpochMilli()

    private fun sunriseConfig(armedAt: Long = at(24, 12, 0), minutes: Int = 15) = PhoneFirstLightConfig(
        enabled = true,
        time = LocalTime.of(7, 0),
        weekdays = setOf(1, 2, 3, 4, 5),
        sunriseEnabled = true,
        sunriseMinutes = minutes,
        startBrightness = 10,
        endBrightness = 80,
        lightTargets = listOf("192.168.1.25"),
        armedAt = armedAt
    )

    @Test
    fun reminderAlarmFiresAtWakeTimeNotAtRampTrigger() {
        val cfg = sunriseConfig()
        val now = at(25, 6, 0)
        val trigger = cfg.nextTriggerAfter(java.time.Instant.ofEpochMilli(now), zone)!!
        val reminder = FirstLightPlan.reminderTarget(cfg, now, zone, emptySet(), pending = null)!!

        assertEquals("fl:2026-11-25:07:00", reminder.occurrenceKey)
        assertEquals(trigger.occurrenceKey, reminder.occurrenceKey)
        assertEquals(at(25, 7, 0), reminder.wakeEpochMs)
        assertEquals(trigger.wakeEpochMs, reminder.wakeEpochMs)
        assertEquals(at(25, 6, 45), trigger.triggerEpochMs)
        assertNotEquals(trigger.triggerEpochMs, reminder.wakeEpochMs)
    }

    @Test
    fun reminderAlarmIdentityIsDistinctFromRampTrigger() {
        val trigger = FirstLightPlan.TRIGGER
        val reminder = FirstLightPlan.REMINDER
        // The trigger keeps its shipped identity so already-armed alarms still cancel after an update.
        assertEquals(FirstLightAlarmIdentity("firstLight", "lightsout://phone-first-light", 0), trigger)
        // Cancelling/updating the trigger (action + data + request code) can never match the reminder.
        assertNotEquals(trigger.action, reminder.action)
        assertNotEquals(trigger.dataUri, reminder.dataUri)
        assertNotEquals(trigger.requestCode, reminder.requestCode)
        assertNotEquals("calendar", reminder.action)
        assertNotEquals("com.lightsout.TIMER_END", reminder.action)
        assertFalse(reminder.dataUri.startsWith("lightsout://phone-calendar/"))
    }

    @Test
    fun wakeReminderAlertsOnlyOncePerOccurrence() {
        val first = FirstLightPlan.claimReminder(emptyList(), "fl:2026-11-25:07:00")
        assertNotNull(first)
        assertEquals(listOf("reminderPosted:fl:2026-11-25:07:00"), first)
        // Ramp completion and the reminder alarm race: the second claimant must not alert.
        assertNull(FirstLightPlan.claimReminder(first!!, "fl:2026-11-25:07:00"))
        assertNull(FirstLightPlan.claimReminder(first, ""))
        assertNotNull(FirstLightPlan.claimReminder(first, "fl:2026-11-26:07:00"))

        // Once posted, the reminder alarm re-arms for the next wake day instead.
        val cfg = sunriseConfig()
        val next = FirstLightPlan.reminderTarget(cfg, at(25, 7, 0, 1), zone, first.toSet(), pending = null)!!
        assertEquals("fl:2026-11-26:07:00", next.occurrenceKey)
        assertEquals(at(26, 7, 0), next.wakeEpochMs)

        // The ledger is bounded and keeps the newest markers.
        var ledger = emptyList<String>()
        for (i in 1..70) ledger = FirstLightPlan.claimReminder(ledger, "fl:k$i")!!
        assertEquals(FirstLightPlan.MARKER_LIMIT, ledger.size)
        assertEquals("reminderPosted:fl:k70", ledger.last())
        assertFalse("reminderPosted:fl:k1" in ledger)
    }

    @Test
    fun rampWakeLockIsOneBoundedLockForTheWholeRamp() {
        val margin = FirstLightPlan.WAKE_LOCK_MARGIN_MS
        val cap = 45 * 60_000L
        assertEquals(cap, FirstLightPlan.MAX_RAMP_MS)
        assertEquals(30_000L, margin)

        val fifteen = FirstLightPlan.rampDurationMs(15 * 60_000L, 15)
        assertEquals(15 * 60_000L, fifteen)
        assertEquals(15 * 60_000L + margin, FirstLightPlan.wakeLockMs(fifteen))
        assertEquals(cap + margin, FirstLightPlan.wakeLockMs(FirstLightPlan.rampDurationMs(cap, 45)))
        // Never unbounded, never negative.
        assertEquals(cap + margin, FirstLightPlan.wakeLockMs(2 * 60 * 60_000L))
        assertEquals(cap + margin, FirstLightPlan.wakeLockMs(Long.MAX_VALUE))
        assertEquals(margin, FirstLightPlan.wakeLockMs(-5L))

        // Every allowed ramp, triggered on time or up to the 2-minute late window, is fully
        // covered by its lock and the lock never exceeds 45 min + 30 s.
        for (minutes in PhoneFirstLightConfig.MIN_SUNRISE_MINUTES..PhoneFirstLightConfig.MAX_SUNRISE_MINUTES) {
            for (lateMs in listOf(-5_000L, 0L, 60_000L, 120_000L)) {
                val remaining = minutes * 60_000L - lateMs
                val duration = FirstLightPlan.rampDurationMs(remaining, minutes)
                val lock = FirstLightPlan.wakeLockMs(duration)
                assertTrue("ramp $minutes min, late $lateMs", duration <= remaining)
                assertTrue("lock covers ramp $minutes min, late $lateMs", lock >= duration + margin - 5_000L)
                assertTrue("lock bounded $minutes min", lock <= cap + margin)
            }
        }
        assertEquals(FirstLightPlan.MIN_STEP_MS, FirstLightPlan.stepIntervalMs(10_000L, 45))
    }

    @Test
    fun claimedMorningKeepsItsReminderThroughConfigEditsAndProcessDeath() {
        // The ramp for today's 07:00 wake was claimed at 06:45 and persisted as pending.
        val pending = FirstLightTrigger("fl:2026-11-25:07:00", at(25, 7, 0), at(25, 6, 45), true)
        // Mid-ramp the user saved a new schedule: armedAt moved past today's trigger and
        // sunrise was turned off, so the config alone no longer yields today's reminder.
        val edited = sunriseConfig(armedAt = at(25, 6, 50)).copy(sunriseEnabled = false, lightTargets = emptyList())
        assertNull(edited.nextReminderAfter(java.time.Instant.ofEpochMilli(at(25, 6, 50)), zone))

        val target = FirstLightPlan.reminderTarget(edited, at(25, 6, 52), zone, emptySet(), pending)
        assertEquals(pending, target)
        // A restarted process (in-memory ramp gone) still targets the same wake-time reminder.
        assertEquals(pending, FirstLightPlan.reminderTarget(sunriseConfig(), at(25, 6, 55), zone, emptySet(), pending))

        // Without exact access only the in-progress morning is kept (best-effort inexact).
        assertEquals(pending, FirstLightPlan.reminderTarget(sunriseConfig(), at(25, 6, 55), zone, emptySet(), pending, includeUpcoming = false))
        assertNull(FirstLightPlan.reminderTarget(sunriseConfig(), at(25, 6, 55), zone, emptySet(), null, includeUpcoming = false))

        // Turning First Light off cancels it; a posted reminder is never re-armed.
        assertNull(FirstLightPlan.reminderTarget(edited.copy(enabled = false), at(25, 6, 52), zone, emptySet(), pending))
        assertNull(
            FirstLightPlan.reminderTarget(
                edited, at(25, 6, 52), zone, setOf(FirstLightPlan.reminderMarker(pending.occurrenceKey)), pending
            )
        )
        // Long after the wake time (beyond the late window) a stale pending entry is dropped.
        assertNull(FirstLightPlan.reminderTarget(edited, at(25, 7, 10, 1), zone, emptySet(), pending))
    }

    @Test
    fun reminderEligibilityUsesWakeTimeAndIsNeverRetroactive() {
        // Armed at 06:50: today's 06:45 ramp trigger is skipped (no retroactive sunrise)...
        val armed650 = sunriseConfig(armedAt = at(25, 6, 50))
        val trigger = armed650.nextTriggerAfter(java.time.Instant.ofEpochMilli(at(25, 6, 50)), zone)!!
        assertEquals("fl:2026-11-26:07:00", trigger.occurrenceKey)
        // ...but the 07:00 wake reminder is still in the future, so it still fires today.
        val reminder = FirstLightPlan.reminderTarget(armed650, at(25, 6, 50), zone, emptySet(), null)!!
        assertEquals("fl:2026-11-25:07:00", reminder.occurrenceKey)

        // Armed after the wake time: nothing fires retroactively for today.
        val armed705 = sunriseConfig(armedAt = at(25, 7, 5))
        val later = FirstLightPlan.reminderTarget(armed705, at(25, 7, 5), zone, emptySet(), null)!!
        assertEquals("fl:2026-11-26:07:00", later.occurrenceKey)

        // Weekends are skipped like triggers (2026-11-27 is Friday -> Monday 30th).
        val fridayPosted = setOf(FirstLightPlan.reminderMarker("fl:2026-11-27:07:00"))
        val monday = FirstLightPlan.reminderTarget(sunriseConfig(), at(27, 7, 0, 1), zone, fridayPosted, null)!!
        assertEquals("fl:2026-11-30:07:00", monday.occurrenceKey)
    }

    @Test
    fun reminderOnlyConfigNeedsNoSeparateAlarmAndDefaultsStayOff() {
        // Without a sunrise the trigger itself fires at the wake time and posts the reminder.
        val plain = PhoneFirstLightConfig(enabled = true, time = LocalTime.of(7, 0))
        assertNull(plain.nextReminderAfter(java.time.Instant.ofEpochMilli(at(25, 6, 0)), zone))
        assertNull(FirstLightPlan.reminderTarget(plain, at(25, 6, 0), zone, emptySet(), null))
        val t = plain.nextTriggerAfter(java.time.Instant.ofEpochMilli(at(25, 6, 0)), zone)!!
        assertEquals(t.wakeEpochMs, t.triggerEpochMs)

        val defaults = PhoneFirstLightConfig.default()
        assertFalse(defaults.enabled)
        assertNull(FirstLightPlan.reminderTarget(defaults, at(25, 6, 0), zone, emptySet(), null))
    }

    @Test
    fun reminderDeliveryWindowAndArmedOccurrenceValidation() {
        val wake = at(25, 7, 0)
        assertTrue(FirstLightPlan.reminderDue(wake, wake))
        assertTrue(FirstLightPlan.reminderDue(wake - 5_000L, wake))
        assertFalse(FirstLightPlan.reminderDue(wake - 5_001L, wake))
        assertTrue(FirstLightPlan.reminderDue(wake + FirstLightPlan.REMINDER_LATE_WINDOW_MS, wake))
        assertFalse(FirstLightPlan.reminderDue(wake + FirstLightPlan.REMINDER_LATE_WINDOW_MS + 1L, wake))
        assertFalse(FirstLightPlan.reminderDue(wake, 0L))

        val cfg = sunriseConfig()
        val key = "fl:2026-11-25:07:00"
        assertTrue(FirstLightPlan.isArmedReminder(cfg, zone, key, wake, emptySet(), null))
        assertFalse(FirstLightPlan.isArmedReminder(cfg, zone, key, wake + 60_000L, emptySet(), null))
        assertFalse(FirstLightPlan.isArmedReminder(cfg, zone, "fl:2026-11-25:06:00", wake, emptySet(), null))
        assertFalse(FirstLightPlan.isArmedReminder(cfg, zone, key, wake, setOf(FirstLightPlan.reminderMarker(key)), null))
        assertFalse(FirstLightPlan.isArmedReminder(cfg.copy(enabled = false), zone, key, wake, emptySet(), null))

        // A claimed in-progress morning validates through its persisted record even after edits.
        val pending = FirstLightTrigger(key, wake, wake - 15 * 60_000L, true)
        val edited = cfg.copy(sunriseEnabled = false, lightTargets = emptyList(), armedAt = at(25, 6, 50))
        assertTrue(FirstLightPlan.isArmedReminder(edited, zone, key, wake, emptySet(), pending))
        assertFalse(FirstLightPlan.isArmedReminder(edited, zone, key, wake + 1L, emptySet(), pending))
    }

    private fun local(epochMs: Long): ZonedDateTime = java.time.Instant.ofEpochMilli(epochMs).atZone(zone)

    private fun sundaySunrise(time: LocalTime, minutes: Int) = PhoneFirstLightConfig(
        enabled = true,
        time = time,
        weekdays = setOf(7),
        sunriseEnabled = true,
        sunriseMinutes = minutes,
        lightTargets = listOf("192.168.1.25")
    )

    @Test
    fun reminderStaysAtLocalWakeTimeAcrossSpringForward() {
        // US Eastern springs forward on Sunday 2026-03-08 at 02:00 EST -> 03:00 EDT.
        val saturdayNight = ZonedDateTime.of(LocalDate.of(2026, 3, 7), LocalTime.of(23, 0), zone).toInstant().toEpochMilli()

        // Ordinary morning after the jump: reminder at 07:00 EDT, ramp exactly 15 real minutes earlier.
        val cfg = sundaySunrise(LocalTime.of(7, 0), 15)
        val trigger = cfg.nextTriggerAfter(java.time.Instant.ofEpochMilli(saturdayNight), zone)!!
        val reminder = FirstLightPlan.reminderTarget(cfg, saturdayNight, zone, emptySet(), pending = null)!!
        assertEquals("fl:2026-03-08:07:00", reminder.occurrenceKey)
        assertEquals(trigger.wakeEpochMs, reminder.wakeEpochMs)
        assertEquals(LocalTime.of(7, 0), local(reminder.wakeEpochMs).toLocalTime())
        assertEquals(java.time.ZoneOffset.ofHours(-4), local(reminder.wakeEpochMs).offset)
        assertEquals(15 * 60_000L, reminder.wakeEpochMs - trigger.triggerEpochMs)

        // A ramp that spans the jump (wake 03:10 EDT, 30 min) is 30 real minutes long,
        // starting at 01:40 EST, and the reminder still fires at the 03:10 wake time.
        val spanning = sundaySunrise(LocalTime.of(3, 10), 30)
        val spanTrigger = spanning.nextTriggerAfter(java.time.Instant.ofEpochMilli(saturdayNight), zone)!!
        val spanReminder = FirstLightPlan.reminderTarget(spanning, saturdayNight, zone, emptySet(), null)!!
        assertEquals(spanTrigger.wakeEpochMs, spanReminder.wakeEpochMs)
        assertEquals(LocalTime.of(3, 10), local(spanReminder.wakeEpochMs).toLocalTime())
        assertEquals(LocalTime.of(1, 40), local(spanTrigger.triggerEpochMs).toLocalTime())
        assertEquals(30 * 60_000L, spanReminder.wakeEpochMs - spanTrigger.triggerEpochMs)
        assertTrue(FirstLightPlan.isArmedReminder(spanning, zone, spanReminder.occurrenceKey, spanReminder.wakeEpochMs, emptySet(), null))

        // A wake time inside the skipped hour (02:30) moves forward to 03:30 EDT, for both alarms.
        val gap = sundaySunrise(LocalTime.of(2, 30), 15)
        val gapTrigger = gap.nextTriggerAfter(java.time.Instant.ofEpochMilli(saturdayNight), zone)!!
        val gapReminder = FirstLightPlan.reminderTarget(gap, saturdayNight, zone, emptySet(), null)!!
        assertEquals("fl:2026-03-08:02:30", gapReminder.occurrenceKey)
        assertEquals(LocalTime.of(3, 30), local(gapReminder.wakeEpochMs).toLocalTime())
        assertEquals(gapTrigger.wakeEpochMs, gapReminder.wakeEpochMs)
        assertEquals(15 * 60_000L, gapReminder.wakeEpochMs - gapTrigger.triggerEpochMs)
    }

    @Test
    fun fallBackOverlapAlertsOnceAtFirstLocalWakeTime() {
        // US Eastern falls back on Sunday 2026-11-01 at 02:00 EDT -> 01:00 EST; 01:30 happens twice.
        val cfg = sundaySunrise(LocalTime.of(1, 30), 15)
        val saturdayNight = ZonedDateTime.of(LocalDate.of(2026, 10, 31), LocalTime.of(23, 0), zone).toInstant().toEpochMilli()
        val reminder = FirstLightPlan.reminderTarget(cfg, saturdayNight, zone, emptySet(), null)!!
        assertEquals("fl:2026-11-01:01:30", reminder.occurrenceKey)
        // The first (EDT) 01:30 is the wake time.
        assertEquals(LocalTime.of(1, 30), local(reminder.wakeEpochMs).toLocalTime())
        assertEquals(java.time.ZoneOffset.ofHours(-4), local(reminder.wakeEpochMs).offset)
        val trigger = cfg.nextTriggerAfter(java.time.Instant.ofEpochMilli(saturdayNight), zone)!!
        assertEquals(trigger.wakeEpochMs, reminder.wakeEpochMs)

        // Once posted, the repeated (EST) 01:30 one hour later never alerts again for that morning.
        val posted = FirstLightPlan.claimReminder(emptyList(), reminder.occurrenceKey)!!.toSet()
        val secondPass = reminder.wakeEpochMs + 60 * 60_000L
        assertEquals(LocalTime.of(1, 30), local(secondPass).toLocalTime())
        assertFalse(FirstLightPlan.isArmedReminder(cfg, zone, reminder.occurrenceKey, secondPass, posted, null))
        val next = FirstLightPlan.reminderTarget(cfg, secondPass, zone, posted, null)!!
        assertEquals("fl:2026-11-08:01:30", next.occurrenceKey)
        assertNull(FirstLightPlan.claimReminder(posted.toList(), reminder.occurrenceKey))
    }

    @Test
    fun overrunningRampStopsSteppingAfterGrace() {
        val end = at(25, 7, 0)
        assertFalse(FirstLightPlan.rampOverrun(end, end))
        assertFalse(FirstLightPlan.rampOverrun(end + FirstLightPlan.RAMP_OVERRUN_GRACE_MS, end))
        assertTrue(FirstLightPlan.rampOverrun(end + FirstLightPlan.RAMP_OVERRUN_GRACE_MS + 1L, end))
    }
}
