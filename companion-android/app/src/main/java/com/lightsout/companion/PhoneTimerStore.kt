package com.lightsout.companion

import android.app.*
import android.content.*
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/** All callers run on the main thread, including alarm delivery and service commands. */
object PhoneTimerStore {
    const val TICK_CHANNEL = "phone_timer"
    const val END_CHANNEL = "phone_timer_end"
    const val ONGOING = 41
    private const val COMPLETE = 42
    private fun prefs(c: Context) = c.getSharedPreferences("phone_timer", Context.MODE_PRIVATE)
    fun boot(c: Context) = Settings.Global.getInt(c.contentResolver, Settings.Global.BOOT_COUNT, -1)
    fun read(c: Context): PhoneTimer = try {
        val j = JSONObject(prefs(c).getString("state", "{}") ?: "{}")
        PhoneTimer(j.optString("phase", "idle"), j.optString("runId"), j.optLong("totalMs"),
            j.optLong("heldMs"), j.optLong("endElapsed"), j.optLong("endWall"), j.optInt("boot", -1),
            j.optString("label"), WizAddress.targets(PhoneHomeStore.strings(j.optJSONArray("lightTargets"))), j.optBoolean("offAtEnd"))
    } catch (_: Exception) { PhoneTimer() }
    fun left(c: Context, t: PhoneTimer) = t.remaining(SystemClock.elapsedRealtime(), System.currentTimeMillis(), boot(c))
    fun restore(c: Context): PhoneTimer {
        val old = read(c)
        val restored = old.restored(SystemClock.elapsedRealtime(), System.currentTimeMillis(), boot(c))
        if (restored != old) write(c, restored)
        return restored
    }
    fun write(c: Context, t: PhoneTimer) {
        val j = JSONObject().put("phase", t.phase).put("runId", t.runId).put("totalMs", t.totalMs)
            .put("heldMs", t.heldMs).put("endElapsed", t.endElapsed).put("endWall", t.endWall).put("boot", t.boot)
            .put("label", t.label).put("lightTargets", org.json.JSONArray(t.lightTargets)).put("offAtEnd", t.offAtEnd)
        check(prefs(c).edit().putString("state", j.toString()).commit()) { "Could not save the phone timer." }
        schedule(c, t)
        val outcome = when (t.phase) { "finished" -> "completed"; "idle" -> "cancelled"; "paused" -> "paused"; else -> "started" }
        PhoneRoutineOutcomes.timer(c, t.runId, outcome)
    }
    fun exact(c: Context): Boolean = Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    private fun pending(c: Context): PendingIntent = PendingIntent.getBroadcast(c, 1,
        Intent(c, PhoneTimerReceiver::class.java).setAction("com.lightsout.TIMER_END"),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun schedule(c: Context, t: PhoneTimer) {
        val alarms = c.getSystemService(AlarmManager::class.java)
        alarms.cancel(pending(c))
        if (t.phase != "running") return
        val whenElapsed = SystemClock.elapsedRealtime() + left(c, t)
        try {
            if (exact(c)) alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, whenElapsed, pending(c))
            else alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, whenElapsed, pending(c))
        } catch (_: SecurityException) {
            alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, whenElapsed, pending(c))
        }
    }
    fun channels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(TICK_CHANNEL, "Active phone timer", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(END_CHANNEL, "Timer finished", NotificationManager.IMPORTANCE_HIGH))
    }
    fun open(c: Context): PendingIntent = PendingIntent.getActivity(c, 0, Intent(c, HomeActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun ongoing(c: Context, t: PhoneTimer): Notification {
        channels(c)
        val seconds = (left(c, t) + 999) / 1000
        val label = if (t.phase == "paused") "Paused" else "Phone timer"
        fun control(action: String) = PendingIntent.getService(c, action.hashCode(),
            Intent(c, PhoneTimerService::class.java).setAction(action).putExtra("runId", t.runId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(c, TICK_CHANNEL).setSmallIcon(R.drawable.ic_moon)
            .setContentTitle("Lights Out · $label").setContentText("%d:%02d remaining".format(seconds / 60, seconds % 60))
            .setContentIntent(open(c)).setOnlyAlertOnce(true).setOngoing(true)
            .addAction(0, if (t.phase == "paused") "Resume" else "Pause", control(if (t.phase == "paused") "resume" else "pause"))
            .addAction(0, "Cancel", control("cancel"))
        if (t.phase == "running") {
            builder.setContentText("Reminder on this phone").setWhen(System.currentTimeMillis() + left(c, t))
                .setUsesChronometer(true).setChronometerCountDown(true).setShowWhen(true)
        }
        return builder.build()
    }
    fun finishIfDue(c: Context, done: (() -> Unit)? = null): Boolean {
        val t = read(c)
        if (t.phase != "running" || left(c, t) > 0) { done?.invoke(); return false }
        write(c, t.command("finish", 0, SystemClock.elapsedRealtime(), System.currentTimeMillis(), boot(c), ""))
        channels(c)
        val notification = NotificationCompat.Builder(c, END_CHANNEL).setSmallIcon(R.drawable.ic_moon)
            .setContentTitle("Lights out. Stars up.").setContentText("Your phone timer has finished.")
            .setContentIntent(open(c)).setAutoCancel(true).build()
        try { NotificationManagerCompat.from(c).notify(COMPLETE, notification) } catch (_: SecurityException) {}
        PhoneLightExperience.finished(c,allowBeacon=!t.offAtEnd)
        if (t.offAtEnd && t.lightTargets.isNotEmpty()) {
            PhoneHomeStore.event(c, "Timer finished. Waiting for WiZ acknowledgement…")
            PhoneLights.perform(c, t.lightTargets, "off", runId = t.runId, done = done)
        }
        else done?.invoke()
        return true
    }
}

class PhoneTimerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val finished = java.util.concurrent.atomic.AtomicBoolean(false)
        fun finish() { if (finished.compareAndSet(false, true)) pending.finish() }
        try {
            PhoneTimerStore.restore(context)
            PhoneTimerStore.finishIfDue(context) { finish() }
            if (intent.action != "com.lightsout.TIMER_END") {
                PhoneTimerStore.schedule(context, PhoneTimerStore.read(context))
                PhoneCalendar.schedule(context)
            }
        } catch (_: Exception) {
            PhoneHomeStore.event(context, "Could not restore phone alarms. Reopen Lights Out to check your routines.")
            finish()
        }
    }
}
