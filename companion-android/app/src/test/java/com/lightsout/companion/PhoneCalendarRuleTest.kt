package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test
import java.time.*

class PhoneCalendarRuleTest {
    private val zone = ZoneId.of("America/Vancouver")
    private fun rule(kind: String = "weekly", time: String = "22:00", days: Set<Int> = setOf(1, 2, 3, 4, 5),
        monthDays: Set<Int> = setOf(1), months: Set<Int> = (1..12).toSet(), date: String? = null,
        enabled: Boolean = true, created: Long = 0) = PhoneCalendarRule("rule-1", "routine-1", kind,
        LocalTime.parse(time), days, monthDays, months, date?.let { LocalDate.parse(it) }, enabled, created)
    private fun after(local: String) = LocalDateTime.parse(local).atZone(zone).toInstant()
    @Test fun weeklyUsesIsoWeekdays() { assertEquals("2026-10-19T22:00", rule().nextAfter(after("2026-10-16T22:01"), zone)!!.toLocalDateTime().toString()) }
    @Test fun weeklySelectedMonthsExcludeOtherMonths() { assertFalse(rule(months = setOf(12)).matches(LocalDate.parse("2026-10-19"))) }
    @Test fun noEarlyStart() { assertEquals(22, rule().nextAfter(after("2026-10-15T21:59"), zone)!!.hour) }
    @Test fun exactBoundaryIsExclusive() { assertEquals(16, rule().nextAfter(after("2026-10-15T22:00"), zone)!!.dayOfMonth) }
    @Test fun shortMonthsSkipMissingDay() { assertEquals("2026-03-31", rule("monthly", monthDays = setOf(31)).nextAfter(after("2026-02-01T00:00"), zone)!!.toLocalDate().toString()) }
    @Test fun lastDayIncludesLeapFebruary() { assertEquals("2028-02-29", rule("monthly", monthDays = setOf(-1), months = setOf(2)).nextAfter(after("2028-02-01T00:00"), zone)!!.toLocalDate().toString()) }
    @Test fun leapDayRepeatsAfterFourYears() { assertEquals("2032-02-29", rule("monthly", monthDays = setOf(29), months = setOf(2)).nextAfter(after("2028-02-29T22:00"), zone)!!.toLocalDate().toString()) }
    @Test fun leapDaySkipsNonLeapCentury() { assertEquals("2104-02-29", rule("monthly", monthDays = setOf(29), months = setOf(2)).nextAfter(after("2096-02-29T22:00"), zone)!!.toLocalDate().toString()) }
    @Test fun consumedLeapDayFindsFollowingLeapYear() { assertEquals("2036-02-29", rule("monthly", monthDays = setOf(29), months = setOf(2)).nextAfter(after("2028-02-29T22:00"), zone, setOf("rule-1:2032-02-29"))!!.toLocalDate().toString()) }
    @Test fun selectedMonthsSkipImpossibleDatesAndConsumedCandidates() { assertEquals("2027-01-31", rule("monthly", monthDays = setOf(31), months = setOf(1, 2, 4)).nextAfter(after("2026-01-01T00:00"), zone, setOf("rule-1:2026-01-31"))!!.toLocalDate().toString()) }
    @Test fun futureCreationIsIncludedWithoutCatchup() { assertEquals("2196-02-29", rule("monthly", monthDays = setOf(29), months = setOf(2), created = after("2196-02-29T22:00").toEpochMilli()).nextAfter(after("2026-01-01T00:00"), zone)!!.toLocalDate().toString()) }
    @Test fun recurringSpringGapMovesForward() { assertEquals("2025-03-09T03:30", rule(time = "02:30", days = setOf(7), months = setOf(3)).nextAfter(after("2025-03-09T00:00"), zone)!!.toLocalDateTime().toString()) }
    @Test fun recurringOverlapIsNotRepeatedAfterFirstInstant() { assertEquals("2025-11-09", rule(time = "01:30", days = setOf(7), months = setOf(11)).nextAfter(Instant.parse("2025-11-02T09:00:00Z"), zone)!!.toLocalDate().toString()) }
    @Test fun selectedMonthsExcludeOthers() { assertEquals(12, rule("monthly", months = setOf(12)).nextAfter(after("2026-10-01T00:00"), zone)!!.monthValue) }
    @Test fun impossibleMonthDayReturnsNone() { assertNull(rule("monthly", monthDays = setOf(31), months = setOf(2)).nextAfter(after("2026-01-01T00:00"), zone)) }
    @Test fun individualDateCanBeFarFuture() { assertEquals(2199, rule("once", date = "2199-12-31").nextAfter(after("2026-01-01T00:00"), zone)!!.year) }
    @Test fun individualDateDoesNotRepeat() { assertNull(rule("once", date = "2026-10-15").nextAfter(after("2026-10-16T00:00"), zone)) }
    @Test fun disabledRuleHasNoAlarm() { assertNull(rule(enabled = false).nextAfter(Instant.now(), zone)) }
    @Test fun consumedDateIsSkipped() { assertEquals(16, rule().nextAfter(after("2026-10-15T21:59"), zone, setOf("rule-1:2026-10-15"))!!.dayOfMonth) }
    // Use historical transitions: Vancouver adopted permanent UTC-7 in 2026.
    // Future dates would test the installed tzdb's policy rather than this rule.
    @Test fun springGapMovesForward() { assertEquals("2025-03-09T03:30", rule("once", time = "02:30", date = "2025-03-09").nextAfter(after("2025-03-09T00:00"), zone)!!.toLocalDateTime().toString()) }
    @Test fun fallOverlapUsesFirstOccurrence() { assertEquals(ZoneOffset.ofHours(-7), rule("once", time = "01:30", date = "2025-11-02").nextAfter(after("2025-11-02T00:00"), zone)!!.offset) }
    @Test fun overlapCannotStartTwice() { assertNull(rule("once", time = "01:30", date = "2025-11-02").nextAfter(after("2025-11-02T00:00"), zone, setOf("rule-1:2025-11-02"))) }
    @Test fun creationDoesNotCatchUpPastMinute() { val r = rule(created = after("2026-10-15T22:00:30").toEpochMilli()); assertEquals(16, r.nextAfter(after("2026-10-15T21:59"), zone)!!.dayOfMonth) }
    @Test(expected = IllegalArgumentException::class) fun weeklyNeedsDays() { rule(days = emptySet()) }
    @Test(expected = IllegalArgumentException::class) fun monthlyNeedsMonths() { rule("monthly", months = emptySet()) }
    @Test(expected = IllegalArgumentException::class) fun rejectsInvalidDay() { rule("monthly", monthDays = setOf(32)) }
}
