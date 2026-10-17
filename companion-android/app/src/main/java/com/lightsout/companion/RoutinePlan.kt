package com.lightsout.companion

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** v1 capability contract; timer/alarm authorities remain the existing native engines. */
data class RoutineAction(val id: String, val type: String, val phase: String, val target: String = "local",
    val seconds: Long = 0, val endAction: String = "reminder", val targets: List<String> = emptyList(), val brightness: Int = 0) {
    fun validate() {
        require(target == "local") { "Remote action targets are unavailable." }
        require(id.matches(Regex("[a-zA-Z0-9_-]{1,64}")))
        when (type) {
            "timer.start" -> require(phase == "start" && seconds in 60..86400 && endAction == "reminder") { "Only a phone reminder is supported." }
            "wiz.warm", "wiz.off" -> {
                require(targets.isNotEmpty()); WizAddress.targets(targets)
                require(phase == if (type == "wiz.off") "timer-complete" else "start")
                require(type != "wiz.warm" || brightness in 10..100)
            }
            else -> throw IllegalArgumentException("This action has no supported phone adapter.")
        }
    }
    fun json(): JSONObject {
        val params = if (type == "timer.start") JSONObject().put("seconds", seconds).put("endAction", endAction)
            else JSONObject().put("targets", JSONArray(targets)).apply { if (type == "wiz.warm") put("brightness", brightness) }
        return JSONObject().put("id", id).put("type", type).put("target", target).put("phase", phase).put("parameters", params)
    }
}

data class RoutinePlan(val id: String, val name: String, val actions: List<RoutineAction>,
    val schemaVersion: Int = 1, val platform: String = "android", val deviceId: String = "local") {
    init {
        require(schemaVersion == 1) { "Unsupported routine version." }
        require(platform == "android" && deviceId == "local") { "This routine belongs to another device." }
        require(id.matches(Regex("[a-zA-Z0-9_-]{1,80}")) && name.isNotBlank() && name.length <= 120)
        require(actions.size in 1..3 && actions.count { it.type == "timer.start" } == 1 && actions.map { it.id }.distinct().size == actions.size)
        actions.forEach { it.validate() }
    }
    fun key(day: LocalDate) = "v1:android:local:$id:$day"
    fun json(rule: PhoneCalendarRule? = null): JSONObject {
        val schedule = rule?.let { JSONObject().put("kind", it.kind).put("time", it.time.toString())
            .put("weekdays", JSONArray(it.weekdays.sorted())).put("monthDays", JSONArray(it.monthDays.sorted()))
            .put("months", JSONArray(it.months.sorted())).put("date", it.date?.toString() ?: JSONObject.NULL)
            .put("timezone", "device-local").put("dstPolicy", "shift-forward-first").put("lateSeconds", 120) }
        return JSONObject().put("schemaVersion", schemaVersion).put("id", id).put("name", name)
            .put("owner", JSONObject().put("platform", platform).put("deviceId", deviceId))
            .put("schedule", schedule ?: JSONObject.NULL).put("actions", JSONArray(actions.map { it.json() }))
    }
    companion object {
        fun from(p: PhoneRoutine, rule: PhoneCalendarRule? = null): RoutinePlan {
            val actions = mutableListOf(RoutineAction("timer", "timer.start", "start", seconds = p.seconds))
            if (p.brightness > 0) actions.add(RoutineAction("warm", "wiz.warm", "start", targets = p.targets, brightness = p.brightness))
            if (p.offAtEnd) actions.add(RoutineAction("off", "wiz.off", "timer-complete", targets = p.targets))
            return RoutinePlan(rule?.id ?: p.id, p.name, actions)
        }
        fun validateJson(j: JSONObject) {
            val version = j.get("schemaVersion")
            require(version is Number && version.toDouble() == 1.0) { "Unsupported routine version." }
            val owner = j.getJSONObject("owner"); val a = j.getJSONArray("actions")
            RoutinePlan(j.getString("id"), j.getString("name"), (0 until a.length()).map { i ->
                val action = a.getJSONObject(i); val p = action.getJSONObject("parameters")
                if (action.getString("type") == "timer.start") {
                    val seconds = p.get("seconds")
                    require(seconds is Number && seconds.toDouble() == seconds.toLong().toDouble())
                    require(p.getString("endAction") == "reminder")
                } else if (action.getString("type") == "wiz.warm") {
                    val brightness = p.get("brightness")
                    require(brightness is Number && brightness.toDouble() == brightness.toInt().toDouble())
                }
                RoutineAction(action.getString("id"), action.getString("type"), action.getString("phase"), action.getString("target"),
                    p.optLong("seconds"), p.optString("endAction", "reminder"), PhoneHomeStore.strings(p.optJSONArray("targets")), p.optInt("brightness"))
            }, j.getInt("schemaVersion"), owner.getString("platform"), owner.getString("deviceId"))
            j.optJSONObject("schedule")?.let {
                require(it.getString("timezone") == "device-local" && it.getString("dstPolicy") == "shift-forward-first" && it.getInt("lateSeconds") == 120)
            }
        }
    }
}

data class PhoneLightResult(val target: String, val status: String, val message: String)
object RoutineResult {
    fun aggregate(timer: String, actions: List<String>): String = when {
        timer == "cancelled" -> "cancelled"
        timer == "failed" -> "failed"
        actions.any { it == "failed" } -> "partial-failure"
        timer == "completed" && actions.any { it == "pending" } -> "waiting-for-actions"
        timer == "completed" -> "completed"
        timer == "started" || timer == "paused" -> "running"
        else -> timer
    }
}
