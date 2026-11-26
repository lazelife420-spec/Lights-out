package com.lightsout.companion

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Locale

data class FirstLightTrigger(
    val occurrenceKey: String,
    val wakeEpochMs: Long,
    val triggerEpochMs: Long,
    val hasSunriseRamp: Boolean
)

data class SunriseStep(
    val brightness: Int,
    val tempKelvin: Int
)

/**
 * Pure domain model for phone-owned First Light (M6).
 * Safe defaults: enabled = false, sunriseEnabled = false, private LAN WiZ IPs only.
 * Zero Windows/PC dependency; JVM unit-testable without Android framework.
 */
data class PhoneFirstLightConfig(
    val enabled: Boolean = false,
    val time: LocalTime = LocalTime.of(7, 0),
    val weekdays: Set<Int> = setOf(1, 2, 3, 4, 5),
    val sunriseEnabled: Boolean = false,
    val sunriseMinutes: Int = 15,
    val startBrightness: Int = 10,
    val endBrightness: Int = 80,
    val lightTargets: List<String> = emptyList(),
    val armedAt: Long = 0L
) {
    init {
        require(weekdays.isNotEmpty() && weekdays.all { it in 1..7 }) { "Choose at least one weekday." }
        require(sunriseMinutes in MIN_SUNRISE_MINUTES..MAX_SUNRISE_MINUTES) {
            "Sunrise duration must be $MIN_SUNRISE_MINUTES–$MAX_SUNRISE_MINUTES minutes."
        }
        require(startBrightness in MIN_BRIGHTNESS..MAX_START_BRIGHTNESS) {
            "Start brightness must be $MIN_BRIGHTNESS–$MAX_START_BRIGHTNESS%."
        }
        require(endBrightness in MIN_END_BRIGHTNESS..MAX_BRIGHTNESS) {
            "End brightness must be $MIN_END_BRIGHTNESS–$MAX_BRIGHTNESS%."
        }
        require(endBrightness >= startBrightness) {
            "End brightness must be at least start brightness."
        }
        WizAddress.targets(lightTargets)
        require(!sunriseEnabled || lightTargets.isNotEmpty()) {
            "Choose at least one saved WiZ light for sunrise."
        }
    }

    val effectiveArmAt: Long
        get() = armedAt.coerceAtLeast(0L)

    fun formattedTime(): String = String.format(Locale.US, "%02d:%02d", time.hour, time.minute)

    fun occurrenceKeyFor(day: java.time.LocalDate): String = "fl:$day:${formattedTime()}"

    fun nextTriggerAfter(
        after: Instant,
        zone: ZoneId,
        consumed: Set<String> = emptySet()
    ): FirstLightTrigger? {
        if (!enabled) return null
        val afterMs = after.toEpochMilli()
        val startDate = after.atZone(zone).toLocalDate().minusDays(1)
        val hasSunrise = sunriseEnabled && lightTargets.isNotEmpty()
        val leadMs = if (hasSunrise) sunriseMinutes * 60_000L else 0L

        for (offset in 0L..14L) {
            val day = startDate.plusDays(offset)
            if (day.dayOfWeek.value !in weekdays) continue
            val wakeEpochMs = day.atTime(time).atZone(zone).toInstant().toEpochMilli()
            val triggerEpochMs = wakeEpochMs - leadMs
            val key = occurrenceKeyFor(day)
            if (key in consumed) continue
            if (triggerEpochMs > afterMs && triggerEpochMs >= effectiveArmAt) {
                return FirstLightTrigger(
                    occurrenceKey = key,
                    wakeEpochMs = wakeEpochMs,
                    triggerEpochMs = triggerEpochMs,
                    hasSunriseRamp = hasSunrise
                )
            }
        }
        return null
    }

    /**
     * Next wake-time reminder that needs its OWN alarm, independent of the sunrise ramp.
     * Only sunrise occurrences need one: without a ramp the trigger already fires at the
     * wake time and posts the reminder itself. Keyed by [occurrenceKeyFor] like triggers,
     * but eligibility is wake >= armedAt (never retroactive) and ignores trigger claims,
     * so a missed, late-skipped or interrupted ramp still gets its morning reminder.
     */
    fun nextReminderAfter(
        after: Instant,
        zone: ZoneId,
        postedMarkers: Set<String> = emptySet()
    ): FirstLightTrigger? {
        if (!enabled || !(sunriseEnabled && lightTargets.isNotEmpty())) return null
        val afterMs = after.toEpochMilli()
        val startDate = after.atZone(zone).toLocalDate().minusDays(1)
        val leadMs = sunriseMinutes * 60_000L
        for (offset in 0L..14L) {
            val day = startDate.plusDays(offset)
            if (day.dayOfWeek.value !in weekdays) continue
            val wakeEpochMs = day.atTime(time).atZone(zone).toInstant().toEpochMilli()
            val key = occurrenceKeyFor(day)
            if (FirstLightPlan.reminderMarker(key) in postedMarkers) continue
            if (wakeEpochMs > afterMs && wakeEpochMs >= effectiveArmAt) {
                return FirstLightTrigger(
                    occurrenceKey = key,
                    wakeEpochMs = wakeEpochMs,
                    triggerEpochMs = wakeEpochMs - leadMs,
                    hasSunriseRamp = true
                )
            }
        }
        return null
    }

    fun sunriseStep(stepIndex: Int, totalSteps: Int): SunriseStep {
        val safeTotal = totalSteps.coerceAtLeast(1)
        val clampedIndex = stepIndex.coerceIn(0, safeTotal - 1)
        val fraction = if (safeTotal <= 1) 1.0 else clampedIndex.toDouble() / (safeTotal - 1).toDouble()
        val brightness = (startBrightness + (endBrightness - startBrightness) * fraction)
            .toInt()
            .coerceIn(MIN_BRIGHTNESS, MAX_BRIGHTNESS)
        val tempKelvin = (SUNRISE_START_KELVIN + (SUNRISE_END_KELVIN - SUNRISE_START_KELVIN) * fraction)
            .toInt()
            .coerceIn(SUNRISE_START_KELVIN, SUNRISE_END_KELVIN)
        return SunriseStep(brightness = brightness, tempKelvin = tempKelvin)
    }

    fun pruneTargets(allowed: Set<String>): PhoneFirstLightConfig {
        val kept = lightTargets.filter { it in allowed }
        return copy(
            lightTargets = kept,
            sunriseEnabled = sunriseEnabled && kept.isNotEmpty()
        )
    }

    fun toMap(): Map<String, Any> = mapOf(
        "enabled" to enabled,
        "time" to formattedTime(),
        "weekdays" to weekdays.sorted(),
        "sunriseEnabled" to sunriseEnabled,
        "sunriseMinutes" to sunriseMinutes,
        "startBrightness" to startBrightness,
        "endBrightness" to endBrightness,
        "lightTargets" to lightTargets,
        "armedAt" to armedAt
    )

    fun toJson(): JSONObject = JSONObject()
        .put("enabled", enabled)
        .put("time", formattedTime())
        .put("weekdays", JSONArray(weekdays.sorted()))
        .put("sunriseEnabled", sunriseEnabled)
        .put("sunriseMinutes", sunriseMinutes)
        .put("startBrightness", startBrightness)
        .put("endBrightness", endBrightness)
        .put("lightTargets", JSONArray(lightTargets))
        .put("armedAt", armedAt)

    companion object {
        const val MIN_SUNRISE_MINUTES = 5
        const val MAX_SUNRISE_MINUTES = 45
        const val MIN_BRIGHTNESS = 10
        const val MAX_START_BRIGHTNESS = 50
        const val MIN_END_BRIGHTNESS = 20
        const val MAX_BRIGHTNESS = 100
        const val SUNRISE_START_KELVIN = 2200
        const val SUNRISE_END_KELVIN = 3500

        fun default(): PhoneFirstLightConfig = PhoneFirstLightConfig()

        private val HHMM = Regex("""^\d{2}:\d{2}$""")

        fun parseTime(raw: String?): LocalTime {
            val text = raw?.trim().orEmpty().ifBlank { "07:00" }
            if (!HHMM.matches(text)) {
                throw IllegalArgumentException("Choose a valid wake time (HH:MM).")
            }
            return try {
                val parsed = LocalTime.parse(text)
                LocalTime.of(parsed.hour, parsed.minute)
            } catch (_: Exception) {
                throw IllegalArgumentException("Choose a valid wake time (HH:MM).")
            }
        }

        fun fromMap(map: Map<String, Any?>?): PhoneFirstLightConfig {
            if (map == null || map.isEmpty()) return default()
            val parsedTime = parseTime(map["time"] as? String)
            val rawWeekdays = map["weekdays"] as? Collection<*>
            val weekdays = rawWeekdays?.map {
                (it as? Number)?.toInt() ?: throw IllegalArgumentException("Choose valid weekdays (1–7).")
            }?.toSet() ?: setOf(1, 2, 3, 4, 5)
            val rawTargets = map["lightTargets"] as? Collection<*>
            val targets = WizAddress.targets(rawTargets?.map { it.toString() } ?: emptyList())
            return PhoneFirstLightConfig(
                enabled = (map["enabled"] as? Boolean) ?: false,
                time = parsedTime,
                weekdays = weekdays,
                sunriseEnabled = (map["sunriseEnabled"] as? Boolean) ?: false,
                sunriseMinutes = (map["sunriseMinutes"] as? Number)?.toInt() ?: 15,
                startBrightness = (map["startBrightness"] as? Number)?.toInt() ?: 10,
                endBrightness = (map["endBrightness"] as? Number)?.toInt() ?: 80,
                lightTargets = targets,
                armedAt = (map["armedAt"] as? Number)?.toLong() ?: 0L
            )
        }

        fun fromJson(j: JSONObject?): PhoneFirstLightConfig {
            if (j == null || j.length() == 0) return default()
            val parsedTime = parseTime(j.optString("time", "07:00"))
            val weekdaysArr = j.optJSONArray("weekdays")
            val weekdays = if (weekdaysArr == null) {
                setOf(1, 2, 3, 4, 5)
            } else {
                (0 until weekdaysArr.length()).map { idx ->
                    val raw = weekdaysArr.opt(idx)
                    (raw as? Number)?.toInt() ?: throw IllegalArgumentException("Choose valid weekdays (1–7).")
                }.toSet()
            }
            val targetsArr = j.optJSONArray("lightTargets")
            val targets = WizAddress.targets(
                if (targetsArr == null) emptyList() else (0 until targetsArr.length()).map { targetsArr.getString(it) }
            )
            return PhoneFirstLightConfig(
                enabled = j.optBoolean("enabled", false),
                time = parsedTime,
                weekdays = weekdays,
                sunriseEnabled = j.optBoolean("sunriseEnabled", false),
                sunriseMinutes = j.optInt("sunriseMinutes", 15),
                startBrightness = j.optInt("startBrightness", 10),
                endBrightness = j.optInt("endBrightness", 80),
                lightTargets = targets,
                armedAt = j.optLong("armedAt", 0L)
            )
        }
    }
}

/** PendingIntent identity (action + data URI + request code) of a First Light alarm. */
data class FirstLightAlarmIdentity(
    val action: String,
    val dataUri: String,
    val requestCode: Int
)

/** Why a claimed sunrise ramp ended before its planned end (persisted with the pending morning). */
enum class FirstLightRampEnd(val id: String) {
    /** The user pressed Stop sunrise (in-app or notification). */
    STOPPED("stopped"),
    /** First Light settings changed mid-ramp so the running ramp was no longer covered. */
    EDITED("edited"),
    /** Every sunrise light yielded to manual control. */
    YIELDED("yielded"),
    /** The trigger fired but the foreground service could not start, so no ramp ran. */
    NOT_STARTED("notStarted");

    companion object {
        fun parse(id: String?): FirstLightRampEnd? = entries.firstOrNull { it.id == id }
    }
}

/**
 * The claimed sunrise morning whose wake reminder has not been posted yet: a
 * framework-free view of the persisted pendingReminder record.
 */
data class FirstLightPending(
    val occurrenceKey: String,
    val wakeEpochMs: Long,
    val triggerEpochMs: Long,
    val endedBy: FirstLightRampEnd? = null,
    /** The interruption (process death, reboot, update) was already reported once. */
    val noted: Boolean = false
) {
    fun trigger(): FirstLightTrigger = FirstLightTrigger(occurrenceKey, wakeEpochMs, triggerEpochMs, true)
}

/** What the wake reminder says about this morning's sunrise. */
enum class FirstLightMorning(val id: String) {
    PLAIN("plain"),
    FINISHING("finishing"),
    STOPPED("stopped"),
    EDITED("edited"),
    YIELDED("yielded"),
    NOT_STARTED("notStarted"),
    INTERRUPTED("interrupted")
}

/** An in-app event line plus the matching notification text. */
data class FirstLightMessage(val event: String, val detail: String)

/** What a First Light settings save must do to a running ramp and the pending morning. */
data class FirstLightEditDecision(
    /** Stop the running ramp with Stop-sunrise semantics (lights left as they are). */
    val stopRamp: Boolean,
    /** Forget the pending morning: its wake time no longer exists, so only the new one alerts. */
    val dropPending: Boolean
)

/**
 * Pure First Light ramp/reminder planning (no Android framework), so the
 * wake-lock bound, reminder timing/identity and once-per-occurrence alerting
 * are JVM unit-testable.
 */
object FirstLightPlan {
    /** Ramp trigger: a foreground-service alarm at wake time minus the sunrise lead. */
    val TRIGGER = FirstLightAlarmIdentity("firstLight", "lightsout://phone-first-light", 0)

    /**
     * Wake-time reminder: a broadcast alarm with a distinct action, data URI and
     * request code, so cancelling/updating the trigger can never clobber it.
     */
    val REMINDER = FirstLightAlarmIdentity(
        "com.lightsout.FIRST_LIGHT_REMINDER",
        "lightsout://phone-first-light-reminder",
        2
    )

    const val MIN_STEP_MS = 5_000L
    const val MAX_RAMP_MS = PhoneFirstLightConfig.MAX_SUNRISE_MINUTES * 60_000L
    const val WAKE_LOCK_MARGIN_MS = 30_000L
    /** A ramp that is still stepping this long after its planned end stops stepping. */
    const val RAMP_OVERRUN_GRACE_MS = 120_000L
    const val REMINDER_EARLY_TOLERANCE_MS = 5_000L
    /**
     * An exactly armed reminder delivered (or re-armed after the first unlock following
     * a reboot) up to this late still posts once.
     */
    const val REMINDER_LATE_WINDOW_MS = 10 * 60_000L
    /**
     * An inexactly armed reminder (no Alarms & reminders access) may be delivered up to
     * AlarmManager's inexact cap late; it still posts once and says "around HH:MM".
     */
    const val INEXACT_REMINDER_LATE_WINDOW_MS = 60 * 60_000L
    /** An inexact reminder later than this says it arrived late. */
    const val LATE_NOTE_MS = 2 * 60_000L
    /** Ramp triggers are re-armed looking back this far, so a just-due trigger still fires. */
    const val TRIGGER_LOOKBACK_MS = 60_000L
    const val MARKER_LIMIT = 64
    private const val MARKER_PREFIX = "reminderPosted:"

    fun stepIntervalMs(remainingMs: Long, totalSteps: Int): Long =
        (remainingMs.coerceAtLeast(0L) / totalSteps.coerceAtLeast(1)).coerceAtLeast(MIN_STEP_MS)

    fun rampDurationMs(remainingMs: Long, totalSteps: Int): Long =
        stepIntervalMs(remainingMs, totalSteps) * totalSteps.coerceAtLeast(1)

    /** One bounded PARTIAL_WAKE_LOCK for the whole ramp: ramp (capped at 45 min) + 30 s. */
    fun wakeLockMs(rampDurationMs: Long): Long =
        rampDurationMs.coerceIn(0L, MAX_RAMP_MS) + WAKE_LOCK_MARGIN_MS

    fun rampOverrun(nowWallMs: Long, rampEndWallMs: Long): Boolean =
        nowWallMs > rampEndWallMs + RAMP_OVERRUN_GRACE_MS

    fun reminderMarker(occurrenceKey: String): String = MARKER_PREFIX + occurrenceKey

    /**
     * Claims the single wake reminder of an occurrence. Returns the updated marker
     * ledger (newest [MARKER_LIMIT] kept), or null when it was already posted, so
     * ramp completion and the reminder alarm can never both alert.
     */
    fun claimReminder(markers: List<String>, occurrenceKey: String): List<String>? {
        if (occurrenceKey.isBlank()) return null
        val marker = reminderMarker(occurrenceKey)
        if (marker in markers) return null
        return (markers + marker).takeLast(MARKER_LIMIT)
    }

    /**
     * The one late-window parameter shared by [reminderDue] and [reminderTarget]: an
     * occurrence is re-armed only while a delivery of it would still be accepted, so
     * a re-armed past reminder always posts instead of re-arming itself in a loop.
     */
    fun reminderLateWindowMs(inexact: Boolean): Long =
        if (inexact) INEXACT_REMINDER_LATE_WINDOW_MS else REMINDER_LATE_WINDOW_MS

    /**
     * The occurrence whose reminder is (or is about to be) armed inexactly. Without
     * exact access only the claimed pending morning is armed, and inexactly; otherwise
     * the persisted key of the occurrence last armed inexactly stays authoritative, so
     * delivery and re-arming always agree on the window.
     */
    fun inexactReminderKey(exactNow: Boolean, pendingKey: String?, persistedInexactKey: String): String =
        if (!exactNow && !pendingKey.isNullOrBlank()) pendingKey else persistedInexactKey

    fun isInexactReminder(occurrenceKey: String, inexactKey: String): Boolean =
        occurrenceKey.isNotBlank() && occurrenceKey == inexactKey

    /** "at 07:00", or "around 07:00" when Android may deliver the reminder late. */
    fun reminderWhen(timeText: String, inexact: Boolean): String =
        if (inexact) "around $timeText" else "at $timeText"

    fun reminderDue(nowWallMs: Long, wakeWallMs: Long, lateWindowMs: Long = REMINDER_LATE_WINDOW_MS): Boolean =
        wakeWallMs > 0L &&
            nowWallMs >= wakeWallMs - REMINDER_EARLY_TOLERANCE_MS &&
            nowWallMs - wakeWallMs <= lateWindowMs

    /** True while the claimed pending morning still needs its wake reminder. */
    fun pendingReminderOpen(
        pending: FirstLightTrigger,
        nowWallMs: Long,
        postedMarkers: Set<String>,
        inexactKey: String = ""
    ): Boolean {
        val window = reminderLateWindowMs(isInexactReminder(pending.occurrenceKey, inexactKey))
        return pending.occurrenceKey.isNotBlank() &&
            pending.wakeEpochMs > nowWallMs - window &&
            reminderMarker(pending.occurrenceKey) !in postedMarkers
    }

    /**
     * The one reminder alarm to arm: the earliest of the persisted in-progress
     * occurrence (a ramp was claimed; survives config edits, process death and a
     * reboot once the phone is first unlocked) and the next upcoming sunrise
     * occurrence. First Light off → none. Each candidate uses the late window of
     * its own arming ([inexactKey]), exactly as [reminderDue] will on delivery.
     */
    fun reminderTarget(
        config: PhoneFirstLightConfig,
        nowWallMs: Long,
        zone: ZoneId,
        postedMarkers: Set<String>,
        pending: FirstLightTrigger?,
        includeUpcoming: Boolean = true,
        inexactKey: String = ""
    ): FirstLightTrigger? {
        if (!config.enabled) return null
        val fromPending = pending?.takeIf { pendingReminderOpen(it, nowWallMs, postedMarkers, inexactKey) }
        val upcoming = if (includeUpcoming) {
            val exactNext = config.nextReminderAfter(
                Instant.ofEpochMilli(nowWallMs - REMINDER_LATE_WINDOW_MS), zone, postedMarkers
            )
            val inexactNext = if (inexactKey.isBlank()) {
                null
            } else {
                config.nextReminderAfter(
                    Instant.ofEpochMilli(nowWallMs - INEXACT_REMINDER_LATE_WINDOW_MS), zone, postedMarkers
                )?.takeIf { it.occurrenceKey == inexactKey }
            }
            listOfNotNull(exactNext, inexactNext).minByOrNull { it.wakeEpochMs }
        } else {
            null
        }
        return listOfNotNull(fromPending, upcoming).minByOrNull { it.wakeEpochMs }
    }

    /** True when a delivered reminder alarm names an occurrence this phone actually armed. */
    fun isArmedReminder(
        config: PhoneFirstLightConfig,
        zone: ZoneId,
        occurrenceKey: String,
        wakeWallMs: Long,
        postedMarkers: Set<String>,
        pending: FirstLightTrigger?
    ): Boolean {
        if (!config.enabled || occurrenceKey.isBlank() || wakeWallMs <= 0L) return false
        if (pending != null && pending.occurrenceKey == occurrenceKey && pending.wakeEpochMs == wakeWallMs) return true
        val expected = config.nextReminderAfter(Instant.ofEpochMilli(wakeWallMs - 1L), zone, postedMarkers)
        return expected != null && expected.occurrenceKey == occurrenceKey && expected.wakeEpochMs == wakeWallMs
    }

    // --- Morning state machine and wording (pure, so every branch is unit-tested). ---

    /** The local date an occurrence key ("fl:YYYY-MM-DD:HH:MM") belongs to, or null. */
    fun occurrenceDate(occurrenceKey: String): LocalDate? {
        if (!occurrenceKey.startsWith("fl:")) return null
        return try {
            LocalDate.parse(occurrenceKey.removePrefix("fl:").substringBefore(':'))
        } catch (_: Exception) {
            null
        }
    }

    /** True while [config] still schedules that morning at the same local wake time. */
    fun occurrenceStillScheduled(config: PhoneFirstLightConfig, occurrenceKey: String): Boolean {
        val date = occurrenceDate(occurrenceKey) ?: return false
        return config.occurrenceKeyFor(date) == occurrenceKey
    }

    /**
     * A settings save mid-morning. The running ramp is stopped (lights left as they
     * are) when the new config no longer covers it: First Light off, the wake time
     * changed (a different occurrence key), sunrise disabled, or a light it is still
     * driving removed. The pending morning is dropped only when its wake time no
     * longer exists (or First Light is off), so only the new wake time alerts.
     */
    fun configEditDecision(
        newConfig: PhoneFirstLightConfig,
        activeRampKey: String?,
        rampTargets: Collection<String>,
        pendingKey: String?
    ): FirstLightEditDecision {
        val rampRunning = !activeRampKey.isNullOrBlank()
        if (!newConfig.enabled) return FirstLightEditDecision(stopRamp = rampRunning, dropPending = pendingKey != null)
        val covered = rampRunning &&
            occurrenceStillScheduled(newConfig, activeRampKey) &&
            newConfig.sunriseEnabled &&
            newConfig.lightTargets.containsAll(rampTargets)
        return FirstLightEditDecision(
            stopRamp = rampRunning && !covered,
            dropPending = pendingKey != null && !occurrenceStillScheduled(newConfig, pendingKey)
        )
    }

    /** Every light the ramp started with has yielded to manual control. */
    fun allLightsYielded(startTargets: Int, remainingTargets: Int): Boolean =
        startTargets > 0 && remainingTargets <= 0

    fun morningState(occurrenceKey: String, activeRampKey: String?, pending: FirstLightPending?): FirstLightMorning {
        if (occurrenceKey.isNotBlank() && activeRampKey == occurrenceKey) return FirstLightMorning.FINISHING
        if (pending == null || pending.occurrenceKey != occurrenceKey) return FirstLightMorning.PLAIN
        return when (pending.endedBy) {
            FirstLightRampEnd.STOPPED -> FirstLightMorning.STOPPED
            FirstLightRampEnd.EDITED -> FirstLightMorning.EDITED
            FirstLightRampEnd.YIELDED -> FirstLightMorning.YIELDED
            FirstLightRampEnd.NOT_STARTED -> FirstLightMorning.NOT_STARTED
            null -> FirstLightMorning.INTERRUPTED
        }
    }

    /** The wake reminder's event line and notification text for this morning. */
    fun reminderMessage(morning: FirstLightMorning, inexact: Boolean, lateByMs: Long, wakeText: String): FirstLightMessage {
        val base = when (morning) {
            FirstLightMorning.FINISHING -> FirstLightMessage(
                "Morning reminder fired at wake time; sunrise is finishing.",
                "Good morning. Your local WiZ sunrise is finishing."
            )
            FirstLightMorning.STOPPED -> FirstLightMessage(
                "Morning reminder fired. Sunrise had been stopped; lights were left as they were.",
                "Good morning. Sunrise was stopped earlier; lights were left as they were."
            )
            FirstLightMorning.EDITED -> FirstLightMessage(
                "Morning reminder fired. Sunrise stopped when First Light settings changed; lights were left as they were.",
                "Good morning. Sunrise stopped when its settings changed; lights were left as they were."
            )
            FirstLightMorning.YIELDED -> FirstLightMessage(
                "Morning reminder fired. Sunrise yielded to manual control; lights were left as they were.",
                "Good morning. Sunrise yielded to manual control; lights were left as they were."
            )
            FirstLightMorning.NOT_STARTED -> FirstLightMessage(
                "Morning reminder fired. Sunrise could not start; lights were not changed.",
                "Good morning. Sunrise could not start this morning; lights were not changed."
            )
            FirstLightMorning.INTERRUPTED -> FirstLightMessage(
                "Morning reminder fired. Sunrise was interrupted; lights were left as they were.",
                "Good morning. Sunrise was interrupted; lights were left as they were."
            )
            FirstLightMorning.PLAIN -> FirstLightMessage(
                "Morning reminder fired on this phone.",
                "Your phone-owned First Light morning reminder."
            )
        }
        if (!inexact || lateByMs <= LATE_NOTE_MS) return base
        return FirstLightMessage(
            base.event + " It arrived late (inexact alarm).",
            base.detail + " Android delivered this $wakeText reminder late; allow Alarms & reminders for on-time alerts."
        )
    }

    /**
     * The once-only "sunrise was interrupted" notice after process death, a reboot
     * (seen after the first unlock) or an app update: only for a claimed morning whose
     * ramp is not running, did not end for a known reason, was not reported yet, and
     * whose wake time is still ahead.
     */
    fun interruptedRampNoticeDue(
        firstLightEnabled: Boolean,
        rampActive: Boolean,
        pending: FirstLightPending?,
        nowWallMs: Long
    ): Boolean = firstLightEnabled &&
        !rampActive &&
        pending != null &&
        pending.wakeEpochMs > nowWallMs &&
        pending.endedBy == null &&
        !pending.noted

    fun interruptedNotice(reminderWhen: String): String =
        "First Light sunrise was interrupted; lights were left as they were. The wake reminder still fires $reminderWhen."

    /**
     * The in-app line when a ramp ends early. [reminderWhen] is null when no wake
     * reminder is still pending for that morning (it already posted, or was dropped).
     */
    fun rampEndedNotice(end: FirstLightRampEnd, reminderWhen: String?, wakeTimeMoved: Boolean = false): String {
        val head = when (end) {
            FirstLightRampEnd.STOPPED -> "First Light sunrise stopped."
            FirstLightRampEnd.EDITED -> if (wakeTimeMoved) {
                "First Light sunrise stopped because the wake time changed; lights were left as they were."
            } else {
                "First Light sunrise stopped because its settings changed; lights were left as they were."
            }
            FirstLightRampEnd.YIELDED -> "First Light sunrise yielded to manual control; lights were left as they were."
            FirstLightRampEnd.NOT_STARTED -> "First Light sunrise could not start; lights were not changed."
        }
        return when {
            wakeTimeMoved -> "$head Only the new wake time will alert."
            reminderWhen != null -> "$head The wake reminder still fires $reminderWhen."
            else -> head
        }
    }

    /** First: the reminder text when ramp completion posts it; second: the line when it already posted. */
    fun rampFinishedMessages(overran: Boolean, yieldedAll: Boolean): Pair<String, String> = when {
        overran -> "Morning reminder fired. Sunrise ran late and stopped; lights were left as they were." to
            "First Light sunrise ran late and stopped; lights were left as they were."
        yieldedAll -> "Morning reminder fired. Sunrise yielded to manual control." to
            "First Light sunrise ended; it yielded to manual control."
        else -> "Morning reminder fired after local WiZ sunrise." to
            "First Light sunrise finished."
    }
}
