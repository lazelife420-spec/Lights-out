package com.lightsout.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat

/**
 * Foreground service that keeps a native WebSocket connection to the desktop
 * companion alive in the background and mirrors timer events to the Android
 * notification shade — including Snooze / Cancel action buttons — so the phone
 * stays useful even when the app isn't in the foreground.
 */
class CompanionService : Service(), CompanionClient.Listener {

    private lateinit var prefs: Prefs
    private var client: CompanionClient? = null
    private var connectedUrl: String? = null

    private var lastPhase: String = "idle"
    private var lastActive: Boolean = false
    private var lastConnected: Boolean = false

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        createChannels()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_SNOOZE -> { client?.snooze(SNOOZE_SECONDS); return START_STICKY }
            ACTION_CANCEL -> { client?.cancel(); return START_STICKY }
            ACTION_STOP -> { shutdown(); return START_NOT_STICKY }
        }

        val url = intent?.getStringExtra(EXTRA_URL) ?: prefs.companionUrl
        if (url.isNullOrBlank()) { shutdown(); return START_NOT_STICKY }

        // Post the foreground notification immediately (required within ~5s).
        startForegroundCompat(buildStatusNotification(null, connected = false))

        if (url != connectedUrl || client == null) {
            client?.stop()
            connectedUrl = url
            client = CompanionClient(url, this).also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        client?.stop()
        client = null
        super.onDestroy()
    }

    // ── CompanionClient.Listener ──────────────────────────────────────────────
    override fun onConnected() {
        lastConnected = true
        updateForeground(buildStatusNotification(null, connected = true))
    }

    override fun onDisconnected() {
        lastConnected = false
        updateForeground(buildStatusNotification(null, connected = false))
    }

    override fun onState(state: TimerState) {
        lastConnected = true
        maybeAlert(state)
        updateForeground(buildStatusNotification(state, connected = true))
        lastPhase = if (state.isActive) state.phase else "idle"
        lastActive = state.isActive
    }

    // ── Alerts on meaningful transitions ──────────────────────────────────────
    private fun maybeAlert(state: TimerState) {
        if (!prefs.notificationsEnabled) return

        // Phase escalation while running.
        if (state.isActive && !state.paused) {
            if (lastPhase != "dim" && lastPhase != "lastlight" && state.phase == "dim") {
                alert(
                    getString(R.string.alert_winddown_title),
                    getString(R.string.alert_winddown_body, state.timerName),
                    highPriority = false
                )
            }
            if (lastPhase != "lastlight" && state.phase == "lastlight") {
                alert(
                    getString(R.string.alert_lastcall_title),
                    getString(R.string.alert_lastcall_body, state.action),
                    highPriority = prefs.headsUpAlerts
                )
            }
        }

        // Completion: was running through to the end, now idle.
        if (lastActive && !state.isActive && lastPhase == "lastlight") {
            alert(
                getString(R.string.alert_complete_title),
                if (state.dryRun) getString(R.string.alert_complete_dryrun)
                else getString(R.string.alert_complete_body, state.action),
                highPriority = prefs.headsUpAlerts
            )
        }
    }

    // ── Notification building ──────────────────────────────────────────────────
    private fun buildStatusNotification(state: TimerState?, connected: Boolean): Notification {
        val title: String
        val text: String
        when {
            state != null && state.isActive -> {
                val verb = if (state.paused) getString(R.string.status_paused)
                    else getString(R.string.phase_label, phaseLabel(state.phase))
                title = "${state.timerName} · ${TimerState.formatTime(state.remainingSeconds)}"
                text = "$verb · ${getString(R.string.until_action, state.action)}"
            }
            connected -> {
                title = getString(R.string.status_connected_title)
                text = getString(R.string.status_idle)
            }
            else -> {
                title = getString(R.string.status_reconnecting_title)
                text = getString(R.string.status_reconnecting_body)
            }
        }

        val builder = NotificationCompat.Builder(this, CH_STATUS)
            .setSmallIcon(R.drawable.ic_stat_lights)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(openAppIntent())
            .setPriority(NotificationCompat.PRIORITY_LOW)

        // Offer Snooze / Cancel directly from the shade while a timer is active.
        if (state != null && state.isActive) {
            builder.addAction(0, getString(R.string.action_snooze), servicePendingIntent(ACTION_SNOOZE, 11))
            builder.addAction(0, getString(R.string.action_cancel), servicePendingIntent(ACTION_CANCEL, 12))
        }
        return builder.build()
    }

    private fun alert(title: String, body: String, highPriority: Boolean) {
        if (!hasNotificationPermission()) return
        val channel = if (highPriority) CH_ALERTS else CH_STATUS
        val n = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_stat_lights)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .setPriority(if (highPriority) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .build()
        NotificationManagerCompat.from(this).notify(ALERT_ID, n)
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    private fun shutdown() {
        client?.stop()
        client = null
        connectedUrl = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startForegroundCompat(notification: Notification) {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        ServiceCompat.startForeground(this, FOREGROUND_ID, notification, type)
    }

    private fun updateForeground(notification: Notification) {
        if (!hasNotificationPermission()) return
        NotificationManagerCompat.from(this).notify(FOREGROUND_ID, notification)
    }

    private fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    private fun openAppIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(this, 1, intent, pendingFlags())
    }

    private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, CompanionService::class.java).setAction(action)
        return PendingIntent.getService(this, requestCode, intent, pendingFlags())
    }

    private fun pendingFlags(): Int {
        var f = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f = f or PendingIntent.FLAG_IMMUTABLE
        return f
    }

    private fun phaseLabel(phase: String): String = when (phase) {
        "dim" -> getString(R.string.phase_dim)
        "lastlight" -> getString(R.string.phase_lastlight)
        else -> getString(R.string.phase_focus)
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val status = NotificationChannel(
            CH_STATUS, getString(R.string.channel_status), NotificationManager.IMPORTANCE_LOW
        ).apply { description = getString(R.string.channel_status_desc); setShowBadge(false) }
        val alerts = NotificationChannel(
            CH_ALERTS, getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = getString(R.string.channel_alerts_desc)
            enableVibration(true)
        }
        mgr.createNotificationChannel(status)
        mgr.createNotificationChannel(alerts)
    }

    companion object {
        const val ACTION_START = "com.lightsout.companion.START"
        const val ACTION_STOP = "com.lightsout.companion.STOP"
        const val ACTION_SNOOZE = "com.lightsout.companion.SNOOZE"
        const val ACTION_CANCEL = "com.lightsout.companion.CANCEL"
        const val EXTRA_URL = "url"

        private const val CH_STATUS = "companion_status"
        private const val CH_ALERTS = "companion_alerts"
        private const val FOREGROUND_ID = 1
        private const val ALERT_ID = 2
        private const val SNOOZE_SECONDS = 300

        fun start(context: Context, url: String) {
            val intent = Intent(context, CompanionService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_URL, url)
            androidx.core.content.ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, CompanionService::class.java).setAction(ACTION_STOP)
            context.startService(intent)
        }
    }
}
