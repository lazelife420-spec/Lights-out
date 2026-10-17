package com.lightsout.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

data class PhoneRoutine(val id: String, val name: String, val seconds: Long,
    val targets: List<String>, val brightness: Int, val offAtEnd: Boolean, val occurrenceKey: String? = null) {
    init {
        require(id.matches(Regex("[a-zA-Z0-9-]{1,64}")))
        require(name.isNotBlank() && name.length <= 60) { "Name the routine (up to 60 characters)." }
        require(seconds in 60..86400) { "Choose 1 minute to 24 hours." }
        WizAddress.targets(targets)
        require(brightness == 0 || brightness in 10..100) { "Brightness must be 10–100%." }
        require(targets.isNotEmpty() || (brightness == 0 && !offAtEnd)) { "Save a light before adding lighting actions." }
    }
    fun json() = JSONObject().put("id", id).put("name", name).put("seconds", seconds)
        .put("targets", JSONArray(targets)).put("brightness", brightness).put("offAtEnd", offAtEnd)
        .put("plan", RoutinePlan.from(this).json())
}

/** Main-thread writes. Network workers post results back to the main thread. */
object PhoneHomeStore {
    private fun prefs(c: Context) = c.getSharedPreferences("phone_home", Context.MODE_PRIVATE)
    fun config(c: Context): JSONObject = JSONObject(prefs(c).getString("config", "{}") ?: "{}")
    fun save(c: Context, j: JSONObject) {
        check(prefs(c).edit().putString("config", j.toString()).commit()) { "Could not save phone settings." }
        PhoneCalendar.schedule(c)
    }
    fun event(c: Context, value: String) {
        prefs(c).edit().putString("event", value).apply()
    }
    fun event(c: Context) = prefs(c).getString("event", "") ?: ""
    fun strings(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }
    private fun ints(j: JSONObject, key: String): Set<Int> {
        val a = j.optJSONArray(key) ?: JSONArray()
        return (0 until a.length()).map { a.getInt(it) }.toSet()
    }
    fun routine(j: JSONObject): PhoneRoutine {
        j.optJSONObject("plan")?.let { RoutinePlan.validateJson(it) }
        return PhoneRoutine(j.getString("id"), j.getString("name").trim(), j.getLong("seconds"),
            WizAddress.targets(strings(j.optJSONArray("targets"))), j.optInt("brightness"), j.optBoolean("offAtEnd"))
    }
    fun rule(j: JSONObject): PhoneCalendarRule {
        j.optJSONObject("plan")?.let { RoutinePlan.validateJson(it) }
        return PhoneCalendarRule(j.getString("id"), j.getString("routineId"), j.getString("kind"),
        LocalTime.parse(j.getString("time")), ints(j, "weekdays"), ints(j, "monthDays"),
        if (j.has("months")) ints(j, "months") else (1..12).toSet(),
        j.optString("date").takeIf { it.isNotBlank() }?.let { LocalDate.parse(it) },
        j.optBoolean("enabled", true), j.optLong("createdAt"))
    }
    fun routines(c: Context): List<PhoneRoutine> {
        val a = config(c).optJSONArray("routines") ?: JSONArray()
        return (0 until a.length()).map { routine(a.getJSONObject(it)) }
    }
    fun rules(c: Context): List<PhoneCalendarRule> {
        val a = config(c).optJSONArray("rules") ?: JSONArray()
        return (0 until a.length()).map { rule(a.getJSONObject(it)) }
    }
    fun lights(c: Context) = WizAddress.targets(strings(config(c).optJSONArray("lights")))
    fun update(c: Context, action: String, msg: JSONObject) {
        val j = config(c)
        when (action) {
            "saveLights" -> {
                val targets = WizAddress.targets(strings(msg.optJSONArray("targets")))
                j.put("lights", JSONArray(targets))
            }
            "saveRoutine" -> {
                val value = msg.getJSONObject("routine")
                if (value.optString("id").isBlank()) value.put("id", UUID.randomUUID().toString())
                val p = routine(value)
                require(p.targets.all { it in lights(c) }) { "Choose saved lights." }
                val old = routines(c)
                require(old.size < 32 || old.any { it.id == p.id }) { "Keep up to 32 routines." }
                j.put("routines", JSONArray(old.filter { it.id != p.id }.map { it.json() } + p.json()))
            }
            "deleteRoutine" -> {
                val id = msg.getString("id")
                j.put("routines", JSONArray(routines(c).filter { it.id != id }.map { it.json() }))
                val a = j.optJSONArray("rules") ?: JSONArray()
                j.put("rules", JSONArray((0 until a.length()).map { a.getJSONObject(it) }.filter { it.optString("routineId") != id }))
            }
            "saveRule" -> {
                val value = msg.getJSONObject("rule")
                if (value.optString("id").isBlank()) value.put("id", UUID.randomUUID().toString())
                val old = j.optJSONArray("rules") ?: JSONArray()
                val existing = (0 until old.length()).map { old.getJSONObject(it) }.find { it.optString("id") == value.getString("id") }
                value.put("createdAt", existing?.optLong("createdAt") ?: System.currentTimeMillis())
                val rule = rule(value)
                val profile = routines(c).find { it.id == rule.routineId }
                require(profile != null) { "Choose a saved routine." }
                value.put("plan", RoutinePlan.from(profile, rule).json(rule))
                require(old.length() < 64 || existing != null) { "Keep up to 64 calendar rules." }
                val remaining = (0 until old.length()).map { old.getJSONObject(it) }.filter { it.optString("id") != rule.id }
                j.put("rules", JSONArray(remaining + value))
            }
            "deleteRule" -> {
                val old = j.optJSONArray("rules") ?: JSONArray()
                j.put("rules", JSONArray((0 until old.length()).map { old.getJSONObject(it) }.filter { it.optString("id") != msg.getString("id") }))
            }
            else -> throw IllegalArgumentException("Unknown phone setting.")
        }
        save(c, j)
    }
    fun consumed(c: Context): Set<String> = strings(JSONArray(prefs(c).getString("consumed", "[]") ?: "[]")).toSet()
    fun claim(c: Context, key: String): Boolean {
        val old = consumed(c)
        if (key in old) return false
        check(prefs(c).edit().putString("consumed", JSONArray((old + key).toList().takeLast(128)).toString()).commit())
        return true
    }
}
