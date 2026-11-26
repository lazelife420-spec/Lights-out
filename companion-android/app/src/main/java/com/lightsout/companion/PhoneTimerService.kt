package com.lightsout.companion

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import java.util.UUID

/** User-started timer survives closing the screen. AlarmManager covers CPU sleep. */
class PhoneTimerService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            PhoneTimerStore.finishIfDue(this@PhoneTimerService)
            val state = PhoneTimerStore.read(this@PhoneTimerService)
            PhoneLightExperience.tick(this@PhoneTimerService)
            if (state.phase in listOf("running", "paused")) {
                handler.postDelayed(this, if (state.phase == "paused") 60000 else 1000)
            } else if (PhoneFirstLight.isRampActive()) {
                PhoneFirstLight.syncRampNotification(this@PhoneTimerService)
                handler.postDelayed(this, 10000)
            } else {
                PhoneLightExperience.stopTimer(this@PhoneTimerService)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val calendar = intent?.action == "calendar"
        val firstLight = intent?.action == "firstLight"
        val firstLightStop = intent?.action == "firstLightStop"
        // A calendar or First Light PendingIntent starts an FGS: fulfill the contract
        // even if the rule was disabled, is late, or another timer is busy.
        if (calendar || firstLight) {
            try {
                val initial = PhoneTimerStore.read(this)
                val notif = if (firstLight && initial.phase !in listOf("running", "paused")) {
                    PhoneFirstLight.rampNotification(this, 1, 1)
                } else {
                    PhoneTimerStore.ongoing(this, initial)
                }
                startForeground(PhoneTimerStore.ONGOING, notif)
            } catch (_: Exception) {
                // The alarm that started us is used up. Without the foreground service no
                // sunrise can run, but First Light must not go unarmed: a reminder-only
                // morning still posts, a sunrise morning keeps its wake reminder, and
                // later mornings are re-armed (the occurrence is consumed in-process).
                if (firstLight) runFirstLight(intent, canRamp = false)
                stopSelf()
                return START_NOT_STICKY
            }
        }
        if (intent == null) {
            // Sticky restart after process death: an in-memory sunrise ramp is gone. Say so
            // once and keep the independent wake reminder armed instead of dropping the morning.
            try { PhoneFirstLight.noteInterruptedRamp(this) } catch (_: Exception) {}
        }
        PhoneTimerStore.restore(this)
        PhoneTimerStore.finishIfDue(this)
        var state = PhoneTimerStore.read(this)
        var action = intent?.action
        var profile: PhoneRoutine? = null
        if (firstLight) {
            // Never throws: a failure records an event, consumes the occurrence
            // in-process and re-arms First Light.
            runFirstLight(intent, canRamp = true)
            action = null
        } else if (firstLightStop) {
            // Stops the light ramp only; the independent wake reminder stays armed.
            PhoneFirstLight.stopSunriseByUser(this)
            action = null
        } else if (calendar) {
            profile = try { PhoneCalendar.due(this, intent?.getStringExtra("ruleId") ?: "", intent?.getLongExtra("wall", 0) ?: 0) }
            catch (_: Exception) {
                PhoneHomeStore.event(this, "Could not claim the calendar routine; nothing was started. Check routine history and storage.")
                null
            }
            action = if (profile != null) "start" else null
            PhoneCalendar.schedule(this)
        } else if (action == "startRoutine") {
            profile = PhoneHomeStore.routines(this).find { it.id == intent?.getStringExtra("routineId") }
            action = if (profile != null) "start" else null
        }
        if (action != null && (intent?.getStringExtra("runId") ?: state.runId) == state.runId) {
            try {
                state = state.command(action, profile?.seconds ?: intent?.getLongExtra("seconds", 0) ?: 0, SystemClock.elapsedRealtime(),
                    System.currentTimeMillis(), PhoneTimerStore.boot(this), UUID.randomUUID().toString())
                if (profile != null) state = state.copy(label = profile.name, lightTargets = profile.offTargets, offAtEnd = profile.offAtEnd)
                PhoneTimerStore.write(this, state)
                if (profile != null) {
                    PhoneRoutineOutcomes.started(this, profile.occurrenceKey, state.runId)
                    PhoneHomeStore.event(this, "Started ${profile.name} on this phone.")
                    if (profile.brightness > 0) PhoneLights.perform(this, profile.warmTargets, "warm", profile.brightness, state.runId)
                }
            } catch (_: IllegalArgumentException) { /* Repeated/stale actions must not overwrite an active timer. */ }
        }
        handler.removeCallbacks(tick)
        if (state.phase in listOf("running", "paused")) {
            try {
                startForeground(PhoneTimerStore.ONGOING, PhoneTimerStore.ongoing(this, state))
            } catch (_: Exception) {
                // AlarmManager still backs the timer even if FGS promotion is blocked.
            }
        }
        tick.run()
        return if (state.phase in listOf("running", "paused") || PhoneFirstLight.isRampActive()) START_STICKY else START_NOT_STICKY
    }
    private fun runFirstLight(intent: Intent?, canRamp: Boolean) {
        PhoneFirstLight.runTrigger(
            this,
            intent?.getStringExtra("occurrenceKey") ?: "",
            intent?.getLongExtra("wakeWall", 0L) ?: 0L,
            intent?.getLongExtra("triggerWall", 0L) ?: 0L,
            canRamp
        )
    }
    override fun onDestroy() {
        handler.removeCallbacks(tick)
        super.onDestroy()
    }
}
