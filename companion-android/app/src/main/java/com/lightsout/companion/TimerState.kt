package com.lightsout.companion

import org.json.JSONObject

/**
 * Snapshot of the desktop timer, parsed from a companion `type:"state"` frame.
 * The desktop broadcasts this every ~2s while connected (and on every action).
 */
data class TimerState(
    val running: Boolean,
    val paused: Boolean,
    val remainingSeconds: Int,
    val totalSeconds: Int,
    val action: String,
    val phase: String,        // idle | focus | dim | lastlight
    val timerName: String,
    val dryRun: Boolean
) {
    val isActive: Boolean get() = running || paused

    companion object {
        /** Returns a TimerState only for `type:"state"` frames; null otherwise. */
        fun fromJson(json: JSONObject): TimerState? {
            if (json.optString("type") != "state") return null
            return TimerState(
                running = json.optBoolean("running", false),
                paused = json.optBoolean("paused", false),
                remainingSeconds = json.optInt("remainingSeconds", 0),
                totalSeconds = json.optInt("totalSeconds", 0),
                action = json.optString("action", "shutdown"),
                phase = json.optString("phase", "idle"),
                timerName = json.optString("timerName", "Last Call"),
                dryRun = json.optBoolean("dryRun", false)
            )
        }

        fun formatTime(totalSeconds: Int): String {
            val s = if (totalSeconds < 0) 0 else totalSeconds
            val h = s / 3600
            val m = (s % 3600) / 60
            val sec = s % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%d:%02d".format(m, sec)
        }
    }
}
