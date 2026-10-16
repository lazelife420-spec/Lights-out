package com.lightsout.companion

/** No Android dependencies: a countdown measures elapsed time, not wall-clock edits. */
data class PhoneTimer(
    val phase: String = "idle",
    val runId: String = "",
    val totalMs: Long = 0,
    val heldMs: Long = 0,
    val endElapsed: Long = 0,
    val endWall: Long = 0,
    val boot: Int = -1,
    val label: String = "",
    val lightTargets: List<String> = emptyList(),
    val offAtEnd: Boolean = false
) {
    fun restored(elapsed: Long, wall: Long, currentBoot: Int): PhoneTimer {
        if (phase != "running" || boot == currentBoot) return this
        val left = remaining(elapsed, wall, currentBoot)
        return copy(endElapsed = elapsed + left, endWall = wall + left, boot = currentBoot)
    }

    fun remaining(elapsed: Long, wall: Long, currentBoot: Int): Long = when (phase) {
        "running" -> (if (boot == currentBoot) endElapsed - elapsed else endWall - wall).coerceIn(0, totalMs)
        "paused" -> heldMs.coerceIn(0, totalMs)
        else -> 0
    }

    fun command(action: String, seconds: Long, elapsed: Long, wall: Long, currentBoot: Int,
                newId: String): PhoneTimer {
        val left = remaining(elapsed, wall, currentBoot)
        return when (action) {
            "start" -> {
                require(phase != "running" && phase != "paused") { "A phone timer is already active." }
                require(seconds in 60..86400) { "Choose 1 minute to 24 hours." }
                PhoneTimer("running", newId, seconds * 1000, 0, elapsed + seconds * 1000,
                    wall + seconds * 1000, currentBoot)
            }
            "pause" -> {
                require(phase == "running" && left > 0) { "The phone timer is not running." }
                copy(phase = "paused", heldMs = left)
            }
            "resume" -> {
                require(phase == "paused") { "The phone timer is not paused." }
                copy(phase = "running", endElapsed = elapsed + left, endWall = wall + left, boot = currentBoot)
            }
            "snooze" -> {
                require(phase in listOf("running", "paused") && left > 0) { "Start a phone timer first." }
                require(seconds in 60..3600 && left + seconds * 1000 <= 86400000) { "The timer limit is 24 hours." }
                val next = left + seconds * 1000
                copy(totalMs = maxOf(totalMs, next), heldMs = next, endElapsed = elapsed + next,
                    endWall = wall + next, boot = currentBoot)
            }
            "cancel" -> copy(phase = "idle", heldMs = 0)
            "finish" -> {
                require(phase == "running" && left == 0L) { "Timer has not ended." }
                copy(phase = "finished", heldMs = 0)
            }
            else -> throw IllegalArgumentException("Unknown phone timer command.")
        }
    }
}
