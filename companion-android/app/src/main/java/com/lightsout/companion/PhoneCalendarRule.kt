package com.lightsout.companion

import java.time.*

/** Local-calendar rules; elapsed countdowns deliberately use a different clock. */
data class PhoneCalendarRule(
    val id: String, val routineId: String, val kind: String, val time: LocalTime,
    val weekdays: Set<Int> = emptySet(), val monthDays: Set<Int> = emptySet(),
    val months: Set<Int> = (1..12).toSet(), val date: LocalDate? = null,
    val enabled: Boolean = true, val createdAt: Long = 0
) {
    init {
        require(id.matches(Regex("[a-zA-Z0-9-]{1,64}")) && routineId.matches(Regex("[a-zA-Z0-9-]{1,64}")))
        require(kind in setOf("weekly", "monthly", "once")) { "Choose a weekly, monthly, or date rule." }
        require(time.second == 0 && time.nano == 0) { "Use hours and minutes." }
        require(weekdays.all { it in 1..7 } && monthDays.all { it in 1..31 || it == -1 })
        require(months.isNotEmpty() && months.all { it in 1..12 }) { "Select at least one month." }
        require(kind != "weekly" || weekdays.isNotEmpty()) { "Select at least one weekday." }
        require(kind != "monthly" || monthDays.isNotEmpty()) { "Select at least one month day." }
        require(kind != "once" || date != null) { "Choose a date." }
        require(date == null || date.year in 2000..2199) { "Choose a date from 2000 to 2199." }
    }
    fun matches(day: LocalDate): Boolean = when (kind) {
        "weekly" -> day.dayOfWeek.value in weekdays
        "monthly" -> day.monthValue in months && (day.dayOfMonth in monthDays ||
            (-1 in monthDays && day.dayOfMonth == day.lengthOfMonth()))
        else -> day == date
    }
    fun key(day: LocalDate) = "$id:$day"
    fun nextAfter(after: Instant, zone: ZoneId, consumed: Set<String> = emptySet()): ZonedDateTime? {
        if (!enabled) return null
        if (kind == "once") {
            val day = date ?: return null
            val candidate = day.atTime(time).atZone(zone)
            return candidate.takeIf { key(day) !in consumed && it.toInstant().isAfter(after) && it.toInstant().toEpochMilli() >= createdAt }
        }
        val first = after.atZone(zone).toLocalDate()
        // A selected month plus a 31st day can be more than a year away.
        for (offset in 0..740) {
            val day = first.plusDays(offset.toLong())
            if (!matches(day) || key(day) in consumed) continue
            // atZone moves a spring gap forward and picks the first fall overlap.
            // One local-date key makes a fall-back hour fire at most once.
            val candidate = day.atTime(time).atZone(zone)
            if (candidate.toInstant().isAfter(after) && candidate.toInstant().toEpochMilli() >= createdAt) return candidate
        }
        return null
    }
}
