package com.lightsout.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

/** Main-thread, write-ahead claims. Shares one atomic preferences edit with legacy keys. */
object PhoneRoutineOutcomes {
    private fun prefs(c: Context) = c.getSharedPreferences("phone_home", Context.MODE_PRIVATE)
    fun list(c: Context): JSONArray = JSONArray(prefs(c).getString("outcomes", "[]") ?: "[]")
    fun display(c: Context): JSONArray = try { list(c) } catch (_: Exception) {
        JSONArray().put(JSONObject().put("name", "Routine history").put("status", "unavailable").put("actions", JSONArray()))
    }
    private fun rows(c: Context): MutableList<JSONObject> = list(c).let { a -> (0 until a.length()).map { a.getJSONObject(it) }.toMutableList() }
    fun claim(c: Context, rule: PhoneCalendarRule, plan: RoutinePlan, wall: Long): String? {
        val day = Instant.ofEpochMilli(wall).atZone(ZoneId.systemDefault()).toLocalDate()
        val key = plan.key(day); val legacy = rule.key(day); val consumed = PhoneHomeStore.consumed(c); val old = rows(c)
        if (key in consumed || legacy in consumed || old.any { it.optString("occurrenceKey") == key }) return null
        val entry = JSONObject().put("schemaVersion", 1).put("occurrenceKey", key).put("routineId", plan.id).put("name", plan.name)
            .put("owner", JSONObject().put("platform", "android").put("deviceId", "local"))
            .put("scheduledFor", wall).put("status", "claimed").put("at", System.currentTimeMillis())
            .put("actions", JSONArray(plan.actions.map { JSONObject().put("id", it.id).put("type", it.type).put("target", it.target).put("status", "pending") }))
        old.add(entry)
        check(prefs(c).edit().putString("consumed", JSONArray((consumed + legacy + key).toList().takeLast(256)).toString())
            .putString("outcomes", JSONArray(old.takeLast(128)).toString()).commit()) { "Could not save routine occurrence; nothing was started." }
        return key
    }
    private fun update(c: Context, predicate: (JSONObject) -> Boolean, change: (JSONObject) -> Unit) {
        try {
            val entries = rows(c); val entry = entries.findLast(predicate) ?: return
            change(entry)
            check(prefs(c).edit().putString("outcomes", JSONArray(entries).toString()).commit())
        } catch (_: Exception) {
            // History failure must not take down an existing independent timer.
            // Claims remain strict above; uncertain dispatch is never replayed.
            PhoneHomeStore.event(c, "Routine history could not be saved. The phone timer remains independent.")
        }
    }
    private fun actions(j: JSONObject): List<JSONObject> = j.getJSONArray("actions").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    private fun aggregate(j: JSONObject) {
        val a = actions(j); val timer = a.find { it.getString("type") == "timer.start" }?.getString("status") ?: "unknown"
        j.put("status", RoutineResult.aggregate(timer, a.filter { it.getString("type") != "timer.start" }.map { it.getString("status") }))
    }
    fun skipped(c: Context, key: String, reason: String) = update(c, { it.optString("occurrenceKey") == key }) { j ->
        j.put("status", "skipped").put("reason", reason); actions(j).forEach { it.put("status", "skipped") }
    }
    fun started(c: Context, key: String?, runId: String) {
        if (key == null) return
        update(c, { it.optString("occurrenceKey") == key }) { j ->
            j.put("runId", runId); actions(j).find { it.getString("type") == "timer.start" }?.put("status", "started"); aggregate(j)
        }
    }
    fun timer(c: Context, runId: String, status: String) = update(c, { it.optString("runId") == runId && runId.isNotBlank() }) { j ->
        actions(j).forEach { a ->
            if (a.getString("type") == "timer.start") a.put("status", status)
            else if (status == "cancelled" && a.getString("status") == "pending") a.put("status", "cancelled")
        }; aggregate(j)
    }
    fun lights(c: Context, runId: String, type: String, results: List<PhoneLightResult>) = update(c, { it.optString("runId") == runId }) { j ->
        actions(j).find { it.getString("type") == type }?.apply {
            if (optString("status") != "cancelled") put("status", if (results.all { it.status == "acknowledged" }) "acknowledged" else if (results.any { it.status == "failed" }) "failed" else "skipped")
            put("targets", JSONArray(results.map { JSONObject().put("target", it.target).put("status", it.status) }))
        }; aggregate(j)
    }
}
