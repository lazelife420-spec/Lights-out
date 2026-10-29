package com.lightsout.companion

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.time.Instant
import java.time.ZoneId

object PhoneCalendar {
    private var upcomingKey = ""
    private var upcomingCache = org.json.JSONArray()
    private fun pending(c: Context, rule: PhoneCalendarRule, wall: Long): PendingIntent = PendingIntent.getForegroundService(c, 0,
        Intent(c, PhoneTimerService::class.java).setAction("calendar")
            .setData(Uri.parse("lightsout://phone-calendar/${rule.id}"))
            .putExtra("ruleId", rule.id).putExtra("wall", wall),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun schedule(c: Context) {
        val alarms = c.getSystemService(AlarmManager::class.java)
        val prefs = c.getSharedPreferences("phone_calendar", Context.MODE_PRIVATE)
        val previous = PhoneHomeStore.strings(org.json.JSONArray(prefs.getString("scheduled", "[]") ?: "[]"))
        previous.forEach { id ->
            val intent = Intent(c, PhoneTimerService::class.java).setAction("calendar")
                .setData(Uri.parse("lightsout://phone-calendar/$id"))
            val old = PendingIntent.getForegroundService(c, 0, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
            if (old != null) { alarms.cancel(old); old.cancel() }
        }
        val ids = mutableListOf<String>()
        if (PhoneTimerStore.exact(c)) {
            val now = System.currentTimeMillis()
            val zone = ZoneId.systemDefault()
            val consumed = PhoneHomeStore.consumed(c)
            val profiles = PhoneHomeStore.routines(c).map { it.id }.toSet()
            PhoneHomeStore.rules(c).filter { it.routineId in profiles }.forEach { rule ->
                val next = rule.nextAfter(Instant.ofEpochMilli(now - 120000), zone, consumed)
                if (next != null) {
                    val wall = next.toInstant().toEpochMilli()
                    // A user-visible calendar alarm can wake the phone and start its FGS.
                    try {
                        alarms.setAlarmClock(AlarmManager.AlarmClockInfo(wall, PhoneTimerStore.open(c)), pending(c, rule, wall))
                        ids.add(rule.id)
                    } catch (_: SecurityException) { /* Access was revoked; the UI shows routines paused. */ }
                }
            }
        }
        check(prefs.edit().putString("scheduled", org.json.JSONArray(ids).toString()).commit())
    }
    fun due(c: Context, id: String, wall: Long): PhoneRoutine? {
        if (!PhoneTimerStore.exact(c)) return null
        val rule = PhoneHomeStore.rules(c).find { it.id == id && it.enabled } ?: return null
        val now = System.currentTimeMillis()
        if (now < wall || now - wall > 120000) return null
        val occurrence = Instant.ofEpochMilli(wall).atZone(ZoneId.systemDefault())
        val day = occurrence.toLocalDate()
        val expected = day.atTime(rule.time).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        if (!rule.matches(day) || expected != wall || wall < rule.createdAt) return null
        val p = PhoneHomeStore.routines(c).find { it.id == rule.routineId } ?: return null
        val key = PhoneRoutineOutcomes.claim(c, rule, RoutinePlan.from(p, rule), wall) ?: return null
        if (PhoneTimerStore.read(c).phase in setOf("running", "paused")) {
            PhoneHomeStore.event(c, "Skipped ${p.name}: another phone timer is active.")
            PhoneRoutineOutcomes.skipped(c, key, "timer-active")
            return null
        }
        return p.copy(occurrenceKey = key)
    }
    fun upcoming(c: Context): org.json.JSONArray {
        val zone = ZoneId.systemDefault()
        val now = Instant.now().minusSeconds(120)
        val consumed = PhoneHomeStore.consumed(c)
        val key = "${PhoneHomeStore.config(c)}|$consumed|$zone|${System.currentTimeMillis() / 60000}"
        if (key == upcomingKey) return upcomingCache
        upcomingKey = key
        upcomingCache = org.json.JSONArray(PhoneHomeStore.rules(c).map { rule ->
            val next = rule.nextAfter(now, zone, consumed)
            org.json.JSONObject().put("id", rule.id).put("next", next?.toInstant()?.toEpochMilli() ?: 0)
        })
        return upcomingCache
    }
}
