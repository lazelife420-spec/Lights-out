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
            if (state.phase in listOf("running", "paused")) {
                handler.postDelayed(this, if (state.phase == "paused") 60000 else 1000)
            } else {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val calendar = intent?.action == "calendar"
        // A calendar PendingIntent starts an FGS: fulfill the contract even if
        // the saved rule was deleted, is late, or another timer is busy.
        if (calendar) startForeground(PhoneTimerStore.ONGOING, PhoneTimerStore.ongoing(this, PhoneTimerStore.read(this)))
        PhoneTimerStore.restore(this)
        PhoneTimerStore.finishIfDue(this)
        var state = PhoneTimerStore.read(this)
        var action = intent?.action
        var profile: PhoneRoutine? = null
        if (calendar) {
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
                if (profile != null) state = state.copy(label = profile.name, lightTargets = profile.targets, offAtEnd = profile.offAtEnd)
                PhoneTimerStore.write(this, state)
                if (profile != null) {
                    PhoneRoutineOutcomes.started(this, profile.occurrenceKey, state.runId)
                    PhoneHomeStore.event(this, "Started ${profile.name} on this phone.")
                    if (profile.brightness > 0) PhoneLights.perform(this, profile.targets, "warm", profile.brightness, state.runId)
                }
            } catch (_: IllegalArgumentException) { /* Repeated/stale actions must not overwrite an active timer. */ }
        }
        handler.removeCallbacks(tick)
        if (state.phase in listOf("running", "paused")) {
            startForeground(PhoneTimerStore.ONGOING, PhoneTimerStore.ongoing(this, state))
        }
        tick.run()
        return if (state.phase in listOf("running", "paused")) START_STICKY else START_NOT_STICKY
    }
    override fun onDestroy() {
        handler.removeCallbacks(tick)
        super.onDestroy()
    }
}
