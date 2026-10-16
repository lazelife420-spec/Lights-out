/* Shared local-calendar arithmetic for the backend and month planner. */
(function(root, factory) {
  const recurrence = factory();
  if (typeof module === 'object' && module.exports) module.exports = recurrence;
  else root.CalendarRecurrence = recurrence;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return year >= 2000 && year <= 2199 && dateKey(date) === value;
  }
  function matchesDate(rule, date) {
    if (!rule || rule.enabled === false || !Number.isFinite(date.getTime())) return false;
    const repeat = rule.repeat || 'weekly';
    if (repeat === 'once') return validDate(rule.date) && rule.date === dateKey(date);
    if (!['weekly', 'monthly'].includes(repeat)) return false;
    const months = Array.isArray(rule.months) ? rule.months : Array.from({ length: 12 }, (_, i) => i + 1);
    if (!months.includes(date.getMonth() + 1)) return false;
    if (repeat === 'monthly') {
      const selected = Array.isArray(rule.monthDays) ? rule.monthDays : [];
      const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      return selected.includes(date.getDate()) || (selected.includes(-1) && date.getDate() === last);
    }
    return (Array.isArray(rule.days) ? rule.days : []).map(day=>String(day).toLowerCase()).includes(DAYS[date.getDay()]);
  }
  return { DAYS, dateKey, validDate, matchesDate };
});
