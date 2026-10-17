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
        require(id.matches(Regex("[a-zA-Z0-9_-]{1,80}")) && routineId.matches(Regex("[a-zA-Z0-9_-]{1,80}")))
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
        "weekly" -> day.monthValue in months && day.dayOfWeek.value in weekdays
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
        // February's maximum length is 29. Reject impossible selectors without
        // walking years (e.g. February 31), while retaining leap-day rules.
        if (kind == "monthly" && months.none { month ->
            monthDays.any { it == -1 || it <= YearMonth.of(2000, month).lengthOfMonth() }
        }) return null
        val first = maxOf(after.atZone(zone).toLocalDate(), Instant.ofEpochMilli(createdAt).atZone(zone).toLocalDate())
        val firstMonth = YearMonth.from(first)
        // The Gregorian calendar repeats every 400 years, including weekdays
        // and the non-leap centuries. N consumed dates can exclude at most N
        // otherwise valid candidates; N+1 cycles therefore suffice. Enumerate
        // selected months/days, rather than every day in that bound.
        val bound = minOf(4800L * (consumed.size.toLong() + 1), (999999999L - first.year) * 12 + 12 - first.monthValue)
        for (offset in 0L..bound) {
            val month = firstMonth.plusMonths(offset)
            if (month.monthValue !in months) continue
            val days = if (kind == "monthly") monthDays.map { if (it == -1) month.lengthOfMonth() else it }
                .filter { it <= month.lengthOfMonth() }.distinct().sorted() else (1..month.lengthOfMonth()).toList()
            for (number in days) {
                val day = month.atDay(number)
                if (day < first || !matches(day) || key(day) in consumed) continue
                // Shift gaps forward; choose the first overlap. One local-date
                // identity prevents replay during the repeated fall hour.
                val candidate = day.atTime(time).atZone(zone)
                if (candidate.toInstant().isAfter(after) && candidate.toInstant().toEpochMilli() >= createdAt) return candidate
            }
        }
        return null
    }
}
