package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class PhoneFirstLightTest {
    private val zone: ZoneId = ZoneId.of("America/New_York")

    @Test
    fun safeDefaultsAreOffWithNoLights() {
        val def = PhoneFirstLightConfig.default()
        assertFalse(def.enabled)
        assertFalse(def.sunriseEnabled)
        assertEquals(LocalTime.of(7, 0), def.time)
        assertEquals(setOf(1, 2, 3, 4, 5), def.weekdays)
        assertEquals(15, def.sunriseMinutes)
        assertEquals(10, def.startBrightness)
        assertEquals(80, def.endBrightness)
        assertTrue(def.lightTargets.isEmpty())

        assertEquals(def, PhoneFirstLightConfig.fromJson(null))
        assertEquals(def, PhoneFirstLightConfig.fromMap(null))
        assertEquals(def, PhoneFirstLightConfig.fromMap(emptyMap()))
        assertNull(def.nextTriggerAfter(Instant.parse("2026-11-25T10:00:00Z"), zone))
    }

    @Test
    fun nextTriggerSchedulesNextWeekdayWakeAndSkipsWeekendsAndConsumed() {
        // 2026-11-27 is Friday
        val cfg = PhoneFirstLightConfig(
            enabled = true,
            time = LocalTime.of(7, 0),
            weekdays = setOf(1, 2, 3, 4, 5)
        )
        val fridayMorningBefore = ZonedDateTime.of(LocalDate.of(2026, 11, 27), LocalTime.of(6, 30), zone).toInstant()
        val t1 = cfg.nextTriggerAfter(fridayMorningBefore, zone)
        assertNotNull(t1)
        assertEquals("fl:2026-11-27:07:00", t1!!.occurrenceKey)
        assertEquals(t1.wakeEpochMs, t1.triggerEpochMs)
        assertFalse(t1.hasSunriseRamp)

        // If Friday is already consumed, jumps over Sat/Sun to Monday 2026-11-30
        val t2 = cfg.nextTriggerAfter(fridayMorningBefore, zone, consumed = setOf("fl:2026-11-27:07:00"))
        assertNotNull(t2)
        assertEquals("fl:2026-11-30:07:00", t2!!.occurrenceKey)
    }

    @Test
    fun sunriseTriggerLeadsWakeTimeAndRespectsArmedAtNoRetroactiveFire() {
        val wake = ZonedDateTime.of(LocalDate.of(2026, 11, 25), LocalTime.of(7, 0), zone)
        val armAt650 = ZonedDateTime.of(LocalDate.of(2026, 11, 25), LocalTime.of(6, 50), zone).toInstant().toEpochMilli()
        val cfg = PhoneFirstLightConfig(
            enabled = true,
            time = LocalTime.of(7, 0),
            weekdays = setOf(1, 2, 3, 4, 5),
            sunriseEnabled = true,
            sunriseMinutes = 15,
            startBrightness = 10,
            endBrightness = 85,
            lightTargets = listOf("192.168.1.25"),
            armedAt = armAt650
        )

        // At 06:40 before arming at 06:50, today's 06:45 trigger is < armedAt -> advances to Thursday 06:45
        val t = cfg.nextTriggerAfter(
            ZonedDateTime.of(LocalDate.of(2026, 11, 25), LocalTime.of(6, 40), zone).toInstant(),
            zone
        )
        assertNotNull(t)
        assertEquals("fl:2026-11-26:07:00", t!!.occurrenceKey)
        assertTrue(t.hasSunriseRamp)
        assertEquals(15 * 60_000L, t.wakeEpochMs - t.triggerEpochMs)

        // When armed before 06:45, today's 06:45 trigger fires for today's 07:00 wake
        val earlyArm = ZonedDateTime.of(LocalDate.of(2026, 11, 25), LocalTime.of(6, 0), zone).toInstant().toEpochMilli()
        val tToday = cfg.copy(armedAt = earlyArm).nextTriggerAfter(
            ZonedDateTime.of(LocalDate.of(2026, 11, 25), LocalTime.of(6, 30), zone).toInstant(),
            zone
        )
        assertNotNull(tToday)
        assertEquals("fl:2026-11-25:07:00", tToday!!.occurrenceKey)
        assertEquals(wake.toInstant().toEpochMilli(), tToday.wakeEpochMs)
        assertEquals(wake.toInstant().toEpochMilli() - 15 * 60_000L, tToday.triggerEpochMs)
    }

    @Test
    fun dstSpringForwardComputesValidLocalWakeTime() {
        // US Eastern springs forward on 2026-03-08 at 02:00 -> 03:00
        val cfg = PhoneFirstLightConfig(
            enabled = true,
            time = LocalTime.of(7, 0),
            weekdays = setOf(7) // Sunday
        )
        val saturdayNight = ZonedDateTime.of(LocalDate.of(2026, 3, 7), LocalTime.of(23, 0), zone).toInstant()
        val t = cfg.nextTriggerAfter(saturdayNight, zone)
        assertNotNull(t)
        assertEquals("fl:2026-03-08:07:00", t!!.occurrenceKey)
        val resolved = Instant.ofEpochMilli(t.wakeEpochMs).atZone(zone)
        assertEquals(7, resolved.hour)
        assertEquals(0, resolved.minute)
    }

    @Test
    fun sunriseStepInterpolatesWarmBrightnessAndColorTemperature() {
        val cfg = PhoneFirstLightConfig(
            enabled = true,
            sunriseEnabled = true,
            sunriseMinutes = 15,
            startBrightness = 10,
            endBrightness = 90,
            lightTargets = listOf("10.0.0.12")
        )
        val first = cfg.sunriseStep(0, 15)
        val mid = cfg.sunriseStep(7, 15)
        val last = cfg.sunriseStep(14, 15)

        assertEquals(10, first.brightness)
        assertEquals(2200, first.tempKelvin)
        assertEquals(50, mid.brightness)
        assertEquals(2850, mid.tempKelvin)
        assertEquals(90, last.brightness)
        assertEquals(3500, last.tempKelvin)
    }

    @Test
    fun validationRejectsPublicIpsInvalidBoundsAndSunriseWithoutLights() {
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig(enabled = true, weekdays = emptySet())
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig(enabled = true, weekdays = setOf(0, 8))
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig(enabled = true, sunriseMinutes = 4)
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig(enabled = true, sunriseMinutes = 46)
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig(enabled = true, startBrightness = 40, endBrightness = 30)
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig(enabled = true, sunriseEnabled = true, lightTargets = emptyList())
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig(enabled = true, sunriseEnabled = true, lightTargets = listOf("8.8.8.8"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig(enabled = true, sunriseEnabled = true, lightTargets = listOf("192.168.1.255"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig.parseTime("not-a-time")
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig.parseTime("07:00:30")
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig.parseTime("7:00")
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig.fromMap(mapOf("time" to "25:99"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            PhoneFirstLightConfig.fromMap(mapOf("weekdays" to listOf("Mon")))
        }
    }

    @Test
    fun dstFallBackComputesValidLocalWakeTime() {
        // US Eastern falls back on 2026-11-01 at 02:00 -> 01:00
        val cfg = PhoneFirstLightConfig(
            enabled = true,
            time = LocalTime.of(1, 30),
            weekdays = setOf(7) // Sunday
        )
        val saturdayNight = ZonedDateTime.of(LocalDate.of(2026, 10, 31), LocalTime.of(23, 0), zone).toInstant()
        val t = cfg.nextTriggerAfter(saturdayNight, zone)
        assertNotNull(t)
        assertEquals("fl:2026-11-01:01:30", t!!.occurrenceKey)
        val resolved = Instant.ofEpochMilli(t.wakeEpochMs).atZone(zone)
        assertEquals(1, resolved.hour)
        assertEquals(30, resolved.minute)
    }

    @Test
    fun pruneTargetsDisablesSunriseWhenAllTargetsRemovedAndRoundTripsMap() {
        val original = PhoneFirstLightConfig(
            enabled = true,
            time = LocalTime.of(6, 45),
            weekdays = setOf(1, 3, 5),
            sunriseEnabled = true,
            sunriseMinutes = 20,
            startBrightness = 15,
            endBrightness = 75,
            lightTargets = listOf("192.168.0.10", "192.168.0.11"),
            armedAt = 123456789L
        )
        val roundTripped = PhoneFirstLightConfig.fromMap(original.toMap())
        assertEquals(original, roundTripped)

        val partiallyPruned = original.pruneTargets(setOf("192.168.0.10"))
        assertTrue(partiallyPruned.sunriseEnabled)
        assertEquals(listOf("192.168.0.10"), partiallyPruned.lightTargets)

        val fullyPruned = original.pruneTargets(emptySet())
        assertTrue(fullyPruned.enabled) // Morning reminder itself stays enabled
        assertFalse(fullyPruned.sunriseEnabled) // Sunrise cleanly turns OFF with 0 lights
        assertTrue(fullyPruned.lightTargets.isEmpty())

        // Verify map serialization schema
        val serialized = original.toMap()
        assertEquals("06:45", serialized["time"])
        assertEquals(listOf(1, 3, 5), serialized["weekdays"])
    }
}
