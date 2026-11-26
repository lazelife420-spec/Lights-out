package com.lightsout.companion

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.util.Collections
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Native phone-owned First Light scheduler, wake reminder, and optional direct
 * local WiZ sunrise ramp (M6). Works with the PC off, defaults OFF, requires
 * Alarms & reminders access for exact wake scheduling, and yields cleanly when
 * the user stops the sunrise or manually switches a light off.
 *
 * A sunrise morning uses two independent alarms: the ramp trigger (foreground
 * service, wake time minus the sunrise lead) and the wake-time reminder
 * (broadcast at the wake time). The reminder is posted at most once per
 * occurrence, by whichever of ramp completion or the reminder alarm comes
 * first, so a stalled, stopped or process-killed ramp never drops the morning.
 * "Stop sunrise" stops the light ramp only; the wake reminder stays armed.
 *
 * Without exact-alarm access only an already-claimed morning keeps its reminder,
 * armed inexactly: that delivery is accepted up to AlarmManager's inexact cap
 * (60 min) late and the wording says "around HH:MM". After a reboot, alarms are
 * re-armed from BOOT_COMPLETED, which Android delivers only after the phone is
 * first unlocked (the receiver is not direct-boot aware).
 */
object PhoneFirstLight {
    const val CHANNEL_ID = "phone_first_light"
    const val RAMP_CHANNEL_ID = "phone_first_light_ramp"
    const val WAKE_NOTIFY_ID = 43
    const val RAMP_NOTIFY_ID = 44
    private val ACTION_TRIGGER = FirstLightPlan.TRIGGER.action
    private val DATA_URI = FirstLightPlan.TRIGGER.dataUri
    private const val ACTION_STOP = "firstLightStop"
    /** Broadcast action of the independent wake-time reminder alarm (PhoneTimerReceiver). */
    val REMINDER_ACTION: String = FirstLightPlan.REMINDER.action
    private const val LATE_WINDOW_MS = 120_000L

    private val main = Handler(Looper.getMainLooper())
    private val rampActive = AtomicBoolean(false)
    private val rampGeneration = AtomicInteger(0)
    @Volatile private var rampStepIndex = 0
    @Volatile private var rampTotalSteps = 0
    @Volatile private var rampYieldedAll = false
    @Volatile private var rampOccurrenceKey = ""
    /** Lights the running ramp is still driving (yielded lights are removed). */
    @Volatile private var rampLiveTargets: List<String> = emptyList()
    private var rampRunnable: Runnable? = null
    private val wakeLockGuard = Any()
    private var rampWakeLock: PowerManager.WakeLock? = null

    private fun prefs(c: Context) = c.getSharedPreferences("phone_first_light", Context.MODE_PRIVATE)

    fun readConfig(c: Context): PhoneFirstLightConfig {
        val raw = PhoneHomeStore.config(c).optJSONObject("firstLight")
        return try {
            PhoneFirstLightConfig.fromJson(raw)
        } catch (_: Exception) {
            PhoneFirstLightConfig.default()
        }
    }

    fun isRampActive(): Boolean = rampActive.get()

    private fun activeRampKey(): String? =
        if (rampActive.get()) rampOccurrenceKey.takeIf { it.isNotBlank() } else null

    // --- Trigger claims: persisted, plus an in-process copy so a failing storage write
    // --- or a failed trigger can never re-fire the same occurrence in a tight loop.

    private val consumedThisProcess = LinkedHashSet<String>()

    private fun storedConsumed(c: Context): List<String> = try {
        PhoneHomeStore.strings(JSONArray(prefs(c).getString("consumed", "[]") ?: "[]"))
    } catch (_: Exception) {
        emptyList()
    }

    fun consumed(c: Context): Set<String> = synchronized(this) {
        storedConsumed(c).toSet() + consumedThisProcess
    }

    private fun rememberConsumedInProcess(key: String) {
        if (key.isBlank()) return
        synchronized(this) {
            consumedThisProcess.add(key)
            while (consumedThisProcess.size > 64) consumedThisProcess.remove(consumedThisProcess.first())
        }
    }

    private fun claim(c: Context, key: String): Boolean = synchronized(this) {
        val stored = storedConsumed(c)
        if (key in stored || key in consumedThisProcess) return false
        // Remember the claim first: if the write below fails, the re-armed trigger
        // still skips this occurrence instead of re-firing it immediately.
        rememberConsumedInProcess(key)
        val saved = prefs(c).edit()
            .putString("consumed", JSONArray((stored + key).takeLast(64)).toString())
            .commit()
        check(saved) { "Could not claim First Light occurrence." }
        true
    }

    fun lastEvent(c: Context): String = prefs(c).getString("lastEvent", "") ?: ""

    private fun recordEvent(c: Context, message: String) {
        prefs(c).edit().putString("lastEvent", message).apply()
    }

    private fun announce(c: Context, message: String) {
        recordEvent(c, message)
        PhoneHomeStore.event(c, message)
    }

    private fun localTime(epochMs: Long): String {
        val t = Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()).toLocalTime()
        return String.format(Locale.US, "%02d:%02d", t.hour, t.minute)
    }

    // --- Wake-reminder ledger: one alert per occurrence, persisted across process death. ---

    /** Process-lifetime copy of posted markers, so a storage failure can never cause a re-alert loop. */
    private val postedThisProcess = LinkedHashSet<String>()

    private fun reminderMarkers(c: Context): List<String> = synchronized(this) {
        val stored = try {
            PhoneHomeStore.strings(JSONArray(prefs(c).getString("reminderMarkers", "[]") ?: "[]"))
        } catch (_: Exception) {
            emptyList()
        }
        stored + postedThisProcess.filter { it !in stored }
    }

    private fun claimReminder(c: Context, key: String): Boolean = synchronized(this) {
        val updated = FirstLightPlan.claimReminder(reminderMarkers(c), key) ?: return false
        postedThisProcess.add(FirstLightPlan.reminderMarker(key))
        while (postedThisProcess.size > FirstLightPlan.MARKER_LIMIT) postedThisProcess.remove(postedThisProcess.first())
        // If storage refuses the marker, still alert: a rare duplicate beats a lost morning.
        prefs(c).edit().putString("reminderMarkers", JSONArray(updated.takeLast(FirstLightPlan.MARKER_LIMIT)).toString()).commit()
        true
    }

    // --- Inexact arming: the occurrence whose reminder was armed without exact access. ---

    private fun persistedInexactKey(c: Context): String = prefs(c).getString("reminderInexactKey", "") ?: ""

    private fun setInexactKey(c: Context, key: String) {
        prefs(c).edit().putString("reminderInexactKey", key).commit()
    }

    private fun clearInexactKey(c: Context, key: String?) {
        val current = persistedInexactKey(c)
        if (current.isNotBlank() && (key == null || current == key)) setInexactKey(c, "")
    }

    private fun effectiveInexactKey(c: Context, pending: FirstLightPending?): String =
        FirstLightPlan.inexactReminderKey(PhoneTimerStore.exact(c), pending?.occurrenceKey, persistedInexactKey(c))

    /** "at 07:00", or "around 07:00" when this morning's reminder is armed inexactly. */
    private fun reminderWhen(c: Context, pending: FirstLightPending): String =
        FirstLightPlan.reminderWhen(
            localTime(pending.wakeEpochMs),
            FirstLightPlan.isInexactReminder(pending.occurrenceKey, effectiveInexactKey(c, pending))
        )

    // --- Pending morning: the claimed sunrise occurrence whose reminder has not posted. ---

    private fun pendingJson(c: Context): JSONObject? = synchronized(this) {
        try {
            val raw = prefs(c).getString("pendingReminder", "") ?: ""
            if (raw.isBlank()) null else JSONObject(raw)
        } catch (_: Exception) {
            null
        }
    }

    private fun readPending(c: Context): FirstLightPending? {
        val j = pendingJson(c) ?: return null
        val key = j.optString("key")
        val wake = j.optLong("wake", 0L)
        if (key.isBlank() || wake <= 0L) return null
        val endedBy = FirstLightRampEnd.parse(j.optString("endedBy", ""))
            ?: if (j.optBoolean("stopped", false)) FirstLightRampEnd.STOPPED else null
        return FirstLightPending(key, wake, j.optLong("trigger", 0L), endedBy, j.optBoolean("noted", false))
    }

    private fun writePending(c: Context, trigger: FirstLightTrigger) {
        val j = JSONObject()
            .put("key", trigger.occurrenceKey)
            .put("wake", trigger.wakeEpochMs)
            .put("trigger", trigger.triggerEpochMs)
            .put("noted", false)
        synchronized(this) {
            prefs(c).edit().putString("pendingReminder", j.toString()).commit()
        }
    }

    private fun updatePending(c: Context, key: String, field: String, value: Any) {
        synchronized(this) {
            val j = pendingJson(c) ?: return
            if (j.optString("key") != key) return
            prefs(c).edit().putString("pendingReminder", j.put(field, value).toString()).commit()
        }
    }

    private fun markEnded(c: Context, key: String, end: FirstLightRampEnd) =
        updatePending(c, key, "endedBy", end.id)

    private fun clearPending(c: Context, key: String?) {
        synchronized(this) {
            val j = pendingJson(c) ?: return
            if (key == null || j.optString("key") == key) {
                prefs(c).edit().remove("pendingReminder").commit()
            }
        }
    }

    /** Posts the wake reminder for [occurrenceKey] unless it was already posted. */
    private fun postReminderOnce(app: Context, occurrenceKey: String, event: String, detail: String): Boolean {
        if (!claimReminder(app, occurrenceKey)) return false
        clearPending(app, occurrenceKey)
        clearInexactKey(app, occurrenceKey)
        announce(app, event)
        postWakeReminder(app, detail)
        // Retarget the independent reminder alarm so a stale one is never left armed.
        try { scheduleReminder(app) } catch (_: Exception) {}
        return true
    }

    // --- Ramp-wide wake lock: one bounded PARTIAL_WAKE_LOCK, never per step. ---

    private fun acquireRampWakeLock(app: Context, rampDurationMs: Long) {
        synchronized(wakeLockGuard) {
            releaseRampWakeLockLocked()
            try {
                val lock = app.getSystemService(PowerManager::class.java)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LightsOut:FirstLightRamp")
                lock.setReferenceCounted(false)
                lock.acquire(FirstLightPlan.wakeLockMs(rampDurationMs))
                rampWakeLock = lock
            } catch (_: Exception) {
                rampWakeLock = null
            }
        }
    }

    private fun releaseRampWakeLock() {
        synchronized(wakeLockGuard) { releaseRampWakeLockLocked() }
    }

    private fun releaseRampWakeLockLocked() {
        val lock = rampWakeLock
        rampWakeLock = null
        try {
            if (lock != null && lock.isHeld) lock.release()
        } catch (_: Exception) {}
    }

    // --- Alarms ---

    private fun alarmPending(c: Context, trigger: FirstLightTrigger?): PendingIntent {
        val intent = Intent(c, PhoneTimerService::class.java)
            .setAction(ACTION_TRIGGER)
            .setData(Uri.parse(DATA_URI))
        if (trigger != null) {
            intent.putExtra("occurrenceKey", trigger.occurrenceKey)
            intent.putExtra("wakeWall", trigger.wakeEpochMs)
            intent.putExtra("triggerWall", trigger.triggerEpochMs)
            intent.putExtra("hasSunriseRamp", trigger.hasSunriseRamp)
        }
        return PendingIntent.getForegroundService(
            c,
            FirstLightPlan.TRIGGER.requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun reminderIntent(c: Context): Intent = Intent(c, PhoneTimerReceiver::class.java)
        .setAction(FirstLightPlan.REMINDER.action)
        .setData(Uri.parse(FirstLightPlan.REMINDER.dataUri))

    fun schedule(c: Context) {
        val config = readConfig(c)
        scheduleTrigger(c, config)
        scheduleReminder(c, config)
    }

    private fun scheduleTrigger(c: Context, config: PhoneFirstLightConfig) {
        val alarms = c.getSystemService(AlarmManager::class.java)
        val existingIntent = Intent(c, PhoneTimerService::class.java)
            .setAction(ACTION_TRIGGER)
            .setData(Uri.parse(DATA_URI))
        val existing = PendingIntent.getForegroundService(
            c,
            FirstLightPlan.TRIGGER.requestCode,
            existingIntent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (existing != null) {
            alarms.cancel(existing)
            existing.cancel()
        }

        var scheduledKey = ""
        if (config.enabled && PhoneTimerStore.exact(c)) {
            val now = System.currentTimeMillis()
            val zone = ZoneId.systemDefault()
            val next = config.nextTriggerAfter(Instant.ofEpochMilli(now - FirstLightPlan.TRIGGER_LOOKBACK_MS), zone, consumed(c))
            if (next != null) {
                try {
                    alarms.setAlarmClock(
                        AlarmManager.AlarmClockInfo(next.triggerEpochMs, PhoneTimerStore.open(c)),
                        alarmPending(c, next)
                    )
                    scheduledKey = next.occurrenceKey
                } catch (_: SecurityException) {
                    // Exact-alarm access was revoked; UI honestly surfaces unarmed state.
                }
            }
        }
        prefs(c).edit().putString("scheduledKey", scheduledKey).commit()
    }

    /**
     * Arms the single wake-time reminder alarm (distinct identity from the ramp
     * trigger) for the earliest unposted sunrise occurrence, including one whose
     * ramp is already running, was stopped, or was interrupted by process death.
     * An inexact arming is persisted so its delivery and any re-arm both accept
     * the same wider late window.
     */
    private fun scheduleReminder(c: Context, config: PhoneFirstLightConfig = readConfig(c)) {
        val alarms = c.getSystemService(AlarmManager::class.java)
        val existing = PendingIntent.getBroadcast(
            c,
            FirstLightPlan.REMINDER.requestCode,
            reminderIntent(c),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (existing != null) {
            alarms.cancel(existing)
            existing.cancel()
        }
        if (!config.enabled) {
            clearPending(c, null)
            clearInexactKey(c, null)
        }

        val exact = PhoneTimerStore.exact(c)
        val pending = readPending(c)
        val target = FirstLightPlan.reminderTarget(
            config,
            System.currentTimeMillis(),
            ZoneId.systemDefault(),
            reminderMarkers(c).toSet(),
            pending?.trigger(),
            includeUpcoming = exact,
            inexactKey = effectiveInexactKey(c, pending)
        )
        var reminderKey = ""
        if (target != null) {
            val pendingIntent = PendingIntent.getBroadcast(
                c,
                FirstLightPlan.REMINDER.requestCode,
                reminderIntent(c)
                    .putExtra("occurrenceKey", target.occurrenceKey)
                    .putExtra("wakeWall", target.wakeEpochMs),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            var armedInexactly = false
            try {
                if (exact) {
                    alarms.setAlarmClock(AlarmManager.AlarmClockInfo(target.wakeEpochMs, PhoneTimerStore.open(c)), pendingIntent)
                } else {
                    // Only an already-claimed morning reaches here without exact access.
                    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, target.wakeEpochMs, pendingIntent)
                    armedInexactly = true
                }
                reminderKey = target.occurrenceKey
            } catch (_: SecurityException) {
                // Access was revoked mid-morning: best-effort inexact delivery.
                try {
                    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, target.wakeEpochMs, pendingIntent)
                    armedInexactly = true
                    reminderKey = target.occurrenceKey
                } catch (_: Exception) {}
            }
            if (armedInexactly && persistedInexactKey(c) != target.occurrenceKey) {
                setInexactKey(c, target.occurrenceKey)
            }
        }
        prefs(c).edit().putString("reminderKey", reminderKey).apply()
    }

    fun channels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "First Light wake reminder", NotificationManager.IMPORTANCE_HIGH)
        )
        nm.createNotificationChannel(
            NotificationChannel(RAMP_CHANNEL_ID, "First Light sunrise", NotificationManager.IMPORTANCE_LOW)
        )
    }

    fun rampNotification(c: Context, step: Int, total: Int, yieldedAll: Boolean = false): Notification {
        channels(c)
        val stopPending = PendingIntent.getService(
            c,
            ACTION_STOP.hashCode(),
            Intent(c, PhoneTimerService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val contentText = if (yieldedAll) {
            "Sunrise yielded to manual off — wake reminder still armed."
        } else {
            "Warming saved WiZ lights ($step/$total). Stop keeps the wake reminder."
        }
        return NotificationCompat.Builder(c, RAMP_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_moon)
            .setContentTitle("Lights Out · First Light sunrise")
            .setContentText(contentText)
            .setContentIntent(PhoneTimerStore.open(c))
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .addAction(0, "Stop sunrise", stopPending)
            .build()
    }

    /**
     * Keeps exactly one ongoing sunrise notification visible: reuses PhoneTimerStore.ONGOING (41)
     * when no bedtime countdown is active, or uses RAMP_NOTIFY_ID (44) alongside an active timer.
     */
    fun syncRampNotification(c: Context) {
        val app = c.applicationContext
        val nm = NotificationManagerCompat.from(app)
        if (!rampActive.get()) {
            try { nm.cancel(RAMP_NOTIFY_ID) } catch (_: Exception) {}
            return
        }
        val timerActive = PhoneTimerStore.read(app).phase in listOf("running", "paused")
        val notif = rampNotification(app, rampStepIndex.coerceAtLeast(1), rampTotalSteps.coerceAtLeast(1), rampYieldedAll)
        try {
            if (timerActive) {
                nm.notify(RAMP_NOTIFY_ID, notif)
            } else {
                nm.cancel(RAMP_NOTIFY_ID)
                nm.notify(PhoneTimerStore.ONGOING, notif)
            }
        } catch (_: SecurityException) {}
    }

    private fun postWakeReminder(c: Context, detail: String) {
        channels(c)
        val notification = NotificationCompat.Builder(c, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_moon)
            .setContentTitle("First Light · Good morning")
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setContentIntent(PhoneTimerStore.open(c))
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(c).notify(WAKE_NOTIFY_ID, notification)
        } catch (_: SecurityException) {}
    }

    private fun requestServiceStop(app: Context) {
        try {
            app.startService(Intent(app, PhoneTimerService::class.java).setAction(ACTION_STOP))
        } catch (_: Exception) {
            // PhoneTimerService.tick will stopForeground/stopSelf cleanly on its next check.
        }
    }

    /**
     * Runs a delivered First Light trigger and never leaves First Light unarmed:
     * if handling throws (for example a storage failure while claiming), the
     * occurrence is consumed in-process and every later morning is re-armed.
     * [canRamp] is false when the foreground service could not start; then no
     * sunrise runs, but a reminder-only morning still posts and a sunrise morning
     * keeps its independent wake reminder.
     */
    fun runTrigger(c: Context, occurrenceKey: String, wakeWall: Long, triggerWall: Long, canRamp: Boolean): Boolean =
        try {
            handleAlarmTrigger(c, occurrenceKey, wakeWall, triggerWall, canRamp)
        } catch (_: Exception) {
            recoverFailedTrigger(c, occurrenceKey)
            false
        }

    private fun recoverFailedTrigger(c: Context, occurrenceKey: String) {
        val app = c.applicationContext
        rememberConsumedInProcess(occurrenceKey)
        try { PhoneHomeStore.event(app, "Could not run First Light; check alarms and storage.") } catch (_: Exception) {}
        try { schedule(app) } catch (_: Exception) {}
    }

    /**
     * Handles an AlarmManager First Light trigger. Returns true if an active
     * sunrise ramp was started (so the foreground service stays alive until the
     * ramp completes or is stopped), or false if handled immediately.
     */
    fun handleAlarmTrigger(
        c: Context,
        occurrenceKey: String,
        wakeWall: Long,
        triggerWall: Long,
        canRamp: Boolean = true
    ): Boolean {
        val app = c.applicationContext
        val config = readConfig(app)
        if (!config.enabled || !PhoneTimerStore.exact(app) || occurrenceKey.isBlank()) {
            schedule(app)
            return false
        }
        val now = System.currentTimeMillis()
        if (triggerWall <= 0L || now < triggerWall - 5_000L || now - triggerWall > LATE_WINDOW_MS) {
            schedule(app)
            return false
        }
        if (triggerWall < config.effectiveArmAt) {
            schedule(app)
            return false
        }
        if (!claim(app, occurrenceKey)) {
            schedule(app)
            return false
        }

        val ramp = config.sunriseEnabled && config.lightTargets.isNotEmpty() && wakeWall > now + 10_000L
        if (ramp) {
            // Persist this morning before the ramp starts: its wake reminder must survive
            // config edits, process death and a reboot (re-armed once the phone is first
            // unlocked) even though the trigger is now claimed.
            writePending(app, FirstLightTrigger(occurrenceKey, wakeWall, triggerWall, true))
        }

        // Schedule the next morning and this morning's independent wake-time reminder
        // immediately, so process death or a failure never drops either.
        schedule(app)

        if (ramp && canRamp) {
            startSunriseRamp(app, config, occurrenceKey, wakeWall)
            return true
        }
        if (ramp) {
            // No foreground service, so no sunrise: lights are not touched and the
            // independent wake reminder (armed above) still fires at the wake time.
            markEnded(app, occurrenceKey, FirstLightRampEnd.NOT_STARTED)
            val pending = readPending(app)?.takeIf { it.occurrenceKey == occurrenceKey }
            announce(app, FirstLightPlan.rampEndedNotice(FirstLightRampEnd.NOT_STARTED, pending?.let { reminderWhen(app, it) }))
            return false
        }

        val message = FirstLightPlan.reminderMessage(FirstLightMorning.PLAIN, inexact = false, lateByMs = 0L, wakeText = localTime(wakeWall))
        postReminderOnce(app, occurrenceKey, message.event, message.detail)
        return false
    }

    /**
     * Handles the independent wake-time reminder alarm. Posts at most once per
     * occurrence (ramp completion may already have posted it) and only for an
     * occurrence this phone actually armed, then re-arms the next reminder. The
     * late window matches how it was armed, exactly as the re-arm in `finally`
     * computes it, so a rejected late delivery is never re-armed in a loop.
     */
    fun handleReminderAlarm(c: Context, occurrenceKey: String, wakeWall: Long) {
        val app = c.applicationContext
        try {
            val config = readConfig(app)
            val now = System.currentTimeMillis()
            val pending = readPending(app)
            val markers = reminderMarkers(app).toSet()
            val inexact = FirstLightPlan.isInexactReminder(occurrenceKey, effectiveInexactKey(app, pending))
            if (FirstLightPlan.reminderDue(now, wakeWall, FirstLightPlan.reminderLateWindowMs(inexact)) &&
                FirstLightPlan.isArmedReminder(config, ZoneId.systemDefault(), occurrenceKey, wakeWall, markers, pending?.trigger())
            ) {
                val morning = FirstLightPlan.morningState(occurrenceKey, activeRampKey(), pending)
                val message = FirstLightPlan.reminderMessage(morning, inexact, now - wakeWall, localTime(wakeWall))
                postReminderOnce(app, occurrenceKey, message.event, message.detail)
            }
        } finally {
            schedule(app)
        }
    }

    private fun startSunriseRamp(app: Context, config: PhoneFirstLightConfig, occurrenceKey: String, wakeWall: Long) {
        stopActiveRamp(app, null)
        val gen = rampGeneration.incrementAndGet()
        val totalSteps = config.sunriseMinutes.coerceIn(
            PhoneFirstLightConfig.MIN_SUNRISE_MINUTES,
            PhoneFirstLightConfig.MAX_SUNRISE_MINUTES
        )
        val startWall = System.currentTimeMillis()
        val remainingMs = (wakeWall - startWall).coerceAtLeast(10_000L)
        val stepIntervalMs = FirstLightPlan.stepIntervalMs(remainingMs, totalSteps)
        val rampDurationMs = FirstLightPlan.rampDurationMs(remainingMs, totalSteps)
        val rampEndWall = startWall + rampDurationMs
        val activeTargets = config.lightTargets.toMutableList()
        val startTargetCount = activeTargets.size
        val activatedTargets = Collections.synchronizedSet(mutableSetOf<String>())
        val initialEpochs = activeTargets.associateWith { PhoneLights.manualEpoch(it) }

        rampStepIndex = 0
        rampTotalSteps = totalSteps
        rampYieldedAll = false
        rampOccurrenceKey = occurrenceKey
        rampLiveTargets = activeTargets.toList()
        rampActive.set(true)
        // Main-looper step delays only advance while the CPU is awake: hold one
        // bounded wake lock for the whole ramp so a screen-off phone keeps stepping.
        acquireRampWakeLock(app, rampDurationMs)
        recordEvent(app, "First Light sunrise started (${config.lightTargets.size} local WiZ light(s)).")

        fun runStep(stepIdx: Int) {
            if (!rampActive.get() || rampGeneration.get() != gen) return
            val overran = stepIdx < totalSteps && FirstLightPlan.rampOverrun(System.currentTimeMillis(), rampEndWall)
            if (stepIdx >= totalSteps || overran) {
                finishRamp(app, occurrenceKey, activeTargets.isEmpty(), overran)
                return
            }

            rampStepIndex = stepIdx + 1
            rampYieldedAll = activeTargets.isEmpty()
            val step = config.sunriseStep(stepIdx, totalSteps)
            syncRampNotification(app)

            val targetsSnapshot = activeTargets.toList()
            if (targetsSnapshot.isNotEmpty()) {
                Thread({
                    val pool = Executors.newFixedThreadPool(targetsSnapshot.size)
                    val yieldedIps = mutableListOf<String>()
                    val failedCount = AtomicInteger(0)
                    try {
                        val futures = targetsSnapshot.map { ip ->
                            pool.submit {
                                if (!rampActive.get() || rampGeneration.get() != gen) return@submit
                                PhoneLights.withTargetLock(ip) {
                                    if (!rampActive.get() || rampGeneration.get() != gen) return@withTargetLock
                                    // Yield immediately if the user manually controlled this bulb in-app.
                                    if (PhoneLights.manualEpoch(ip) != initialEpochs[ip]) {
                                        synchronized(yieldedIps) { yieldedIps.add(ip) }
                                        return@withTargetLock
                                    }
                                    try {
                                        // Only treat physical state==false as manual off after this ramp actually turned the bulb on.
                                        if (ip in activatedTargets) {
                                            val pilot = PhoneLights.request(ip, null)
                                            if (!pilot.optBoolean("state", true)) {
                                                synchronized(yieldedIps) { yieldedIps.add(ip) }
                                                return@withTargetLock
                                            }
                                        }
                                        val params = JSONObject()
                                            .put("state", true)
                                            .put("dimming", step.brightness)
                                            .put("temp", step.tempKelvin)
                                        PhoneLights.request(ip, params)
                                        activatedTargets.add(ip)
                                    } catch (_: Exception) {
                                        failedCount.incrementAndGet()
                                    }
                                }
                            }
                        }
                        val deadlineNs = System.nanoTime() + TimeUnit.SECONDS.toNanos(4)
                        futures.forEach { future ->
                            val rem = TimeUnit.NANOSECONDS.toMillis(deadlineNs - System.nanoTime()).coerceAtLeast(1L)
                            try { future.get(rem, TimeUnit.MILLISECONDS) } catch (_: Exception) { failedCount.incrementAndGet() }
                        }
                    } finally {
                        pool.shutdownNow()
                        val failures = failedCount.get()
                        main.post {
                            if (!rampActive.get() || rampGeneration.get() != gen) return@post
                            if (yieldedIps.isNotEmpty()) {
                                activeTargets.removeAll(yieldedIps.toSet())
                                rampLiveTargets = activeTargets.toList()
                                rampYieldedAll = activeTargets.isEmpty()
                                if (FirstLightPlan.allLightsYielded(startTargetCount, activeTargets.size)) {
                                    // Nothing left to drive: end now instead of holding the wake lock,
                                    // the foreground service and the ongoing notification until the
                                    // planned end. The independent wake reminder still fires.
                                    endRampEarly(app, occurrenceKey, FirstLightRampEnd.YIELDED)
                                    return@post
                                }
                                recordEvent(app, "Sunrise yielded for ${yieldedIps.joinToString(", ")} (manual off).")
                                syncRampNotification(app)
                            } else if (failures > 0) {
                                recordEvent(app, "Sunrise step $rampStepIndex/$totalSteps: no WiZ acknowledgement on $failures light(s).")
                            }
                        }
                    }
                }, "LightsOut-FirstLight").start()
            }

            val nextRunnable = Runnable { runStep(stepIdx + 1) }
            rampRunnable = nextRunnable
            main.postDelayed(nextRunnable, stepIntervalMs)
        }

        runStep(0)
    }

    /**
     * Ends a ramp that completed (or overran its planned end): releases the wake
     * lock, then posts the wake reminder unless the reminder alarm already did.
     * An overrun sends no further light commands; lights stay as they are.
     */
    private fun finishRamp(app: Context, occurrenceKey: String, yieldedAll: Boolean, overran: Boolean) {
        rampActive.set(false)
        rampYieldedAll = false
        rampRunnable = null
        rampOccurrenceKey = ""
        rampLiveTargets = emptyList()
        releaseRampWakeLock()
        try { NotificationManagerCompat.from(app).cancel(RAMP_NOTIFY_ID) } catch (_: Exception) {}
        val (reminder, done) = FirstLightPlan.rampFinishedMessages(overran, yieldedAll)
        if (!postReminderOnce(app, occurrenceKey, reminder, reminder)) {
            announce(app, done)
        }
        requestServiceStop(app)
    }

    /**
     * Ends a running ramp before its planned end with Stop-sunrise semantics: no
     * further light commands (lights stay as they are), wake lock released, ramp
     * notification cleared and the service asked to stop. The pending morning is
     * kept and marked with [end], so its wake reminder still fires with matching words.
     */
    private fun endRampEarly(app: Context, occurrenceKey: String, end: FirstLightRampEnd) {
        stopActiveRamp(app, null)
        val pending = readPending(app)?.takeIf { it.occurrenceKey == occurrenceKey }
        if (pending != null) markEnded(app, occurrenceKey, end)
        announce(app, FirstLightPlan.rampEndedNotice(end, pending?.let { reminderWhen(app, it) }))
        requestServiceStop(app)
    }

    fun stopActiveRamp(c: Context, reason: String? = "First Light sunrise stopped."): Boolean {
        val wasActive = rampActive.getAndSet(false)
        rampGeneration.incrementAndGet()
        rampRunnable?.let { main.removeCallbacks(it) }
        rampRunnable = null
        rampStepIndex = 0
        rampTotalSteps = 0
        rampYieldedAll = false
        rampOccurrenceKey = ""
        rampLiveTargets = emptyList()
        releaseRampWakeLock()
        try {
            NotificationManagerCompat.from(c.applicationContext).cancel(RAMP_NOTIFY_ID)
        } catch (_: Exception) {}
        if (wasActive && reason != null) {
            announce(c.applicationContext, reason)
        }
        return wasActive
    }

    /**
     * User "Stop sunrise" (in-app button or notification action): stops the light
     * ramp only and leaves lights as they are. The wake reminder stays armed and
     * still fires at the wake time; turning First Light off is what cancels it.
     */
    fun stopSunriseByUser(c: Context): Boolean {
        val app = c.applicationContext
        val key = rampOccurrenceKey
        val wasActive = stopActiveRamp(app, null)
        if (!wasActive) return false
        val pending = readPending(app)?.takeIf { it.occurrenceKey == key && readConfig(app).enabled }
        if (pending != null) markEnded(app, key, FirstLightRampEnd.STOPPED)
        announce(app, FirstLightPlan.rampEndedNotice(FirstLightRampEnd.STOPPED, pending?.let { reminderWhen(app, it) }))
        return true
    }

    /**
     * Called while a First Light settings save is committed (before the alarms are
     * re-armed). Turning First Light off stops any ramp; the alarms re-arm then
     * clears the pending morning and its reminder. Otherwise a running ramp that
     * the new settings no longer cover (wake time changed, sunrise disabled, or a
     * light it still drives removed) is stopped with Stop-sunrise semantics, and a
     * pending morning whose wake time no longer exists is dropped so only the new
     * wake time alerts.
     */
    fun applyConfigEdit(c: Context, newConfig: PhoneFirstLightConfig) {
        val app = c.applicationContext
        if (!newConfig.enabled) {
            if (stopActiveRamp(app, "First Light turned off.")) requestServiceStop(app)
            return
        }
        val activeKey = activeRampKey()
        val pending = readPending(app)
        val decision = FirstLightPlan.configEditDecision(newConfig, activeKey, rampLiveTargets, pending?.occurrenceKey)
        if (decision.dropPending && pending != null) {
            clearPending(app, pending.occurrenceKey)
            clearInexactKey(app, pending.occurrenceKey)
        }
        if (decision.stopRamp && activeKey != null) {
            stopActiveRamp(app, null)
            val kept = pending?.takeIf { it.occurrenceKey == activeKey && !decision.dropPending }
            if (kept != null) markEnded(app, activeKey, FirstLightRampEnd.EDITED)
            announce(
                app,
                FirstLightPlan.rampEndedNotice(
                    FirstLightRampEnd.EDITED,
                    kept?.let { reminderWhen(app, it) },
                    wakeTimeMoved = decision.dropPending
                )
            )
            requestServiceStop(app)
        } else if (decision.dropPending) {
            announce(app, "First Light wake time changed. Only the new wake time will alert.")
        }
    }

    /**
     * After process death mid-ramp (sticky service restart, a reboot once the phone
     * is first unlocked, an app update or reopening the app), the in-memory ramp and
     * its wake lock are gone. It is not resumed — that could override a manual off —
     * so it is finished safely: no further light commands, lights stay as they were,
     * any leftover sunrise notification is cleared, and the morning is never dropped:
     * this states it once and makes sure the independent wake reminder is armed.
     */
    fun noteInterruptedRamp(c: Context) {
        val app = c.applicationContext
        if (rampActive.get()) return
        // A ramp running beside a bedtime timer posts its own ongoing notification (44),
        // which outlives process death; with no live ramp it must not linger.
        try { NotificationManagerCompat.from(app).cancel(RAMP_NOTIFY_ID) } catch (_: Exception) {}
        val pending = readPending(app)
        if (!FirstLightPlan.interruptedRampNoticeDue(readConfig(app).enabled, rampActive.get(), pending, System.currentTimeMillis())) return
        if (pending == null) return
        updatePending(app, pending.occurrenceKey, "noted", true)
        scheduleReminder(app)
        announce(app, FirstLightPlan.interruptedNotice(reminderWhen(app, pending)))
    }

    fun statusJson(c: Context): JSONObject {
        val config = readConfig(c)
        val exact = PhoneTimerStore.exact(c)
        val now = System.currentTimeMillis()
        val next = if (config.enabled && exact) {
            config.nextTriggerAfter(Instant.ofEpochMilli(now - FirstLightPlan.TRIGGER_LOOKBACK_MS), ZoneId.systemDefault(), consumed(c))
        } else {
            null
        }
        val pending = if (config.enabled) readPending(c) else null
        val inexactKey = effectiveInexactKey(c, pending)
        val shown = pending?.takeIf {
            FirstLightPlan.pendingReminderOpen(it.trigger(), now, reminderMarkers(c).toSet(), inexactKey)
        }
        return JSONObject()
            .put("config", config.toJson())
            .put("armed", config.enabled && exact && next != null)
            .put("nextWakeEpochMs", next?.wakeEpochMs ?: 0L)
            .put("nextTriggerEpochMs", next?.triggerEpochMs ?: 0L)
            .put("reminderEpochMs", shown?.wakeEpochMs ?: 0L)
            .put("reminderInexact", shown != null && FirstLightPlan.isInexactReminder(shown.occurrenceKey, inexactKey))
            .put("reminderState", shown?.let { FirstLightPlan.morningState(it.occurrenceKey, activeRampKey(), it).id } ?: "")
            .put("rampActive", rampActive.get())
            .put("rampStep", rampStepIndex)
            .put("rampTotalSteps", rampTotalSteps)
            .put("lastEvent", lastEvent(c))
    }
}
