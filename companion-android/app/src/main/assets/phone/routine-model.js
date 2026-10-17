/* Common local routine contract. Bundled byte-for-byte with Android's home. */
(function(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.RoutineModel = model;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const allMonths = () => Array.from({ length: 12 }, (_, i) => i + 1);
  function requireValue(ok, message) { if (!ok) throw Error(message); }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const d = new Date(value + 'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value && +value.slice(0, 4) >= 2000 && +value.slice(0, 4) <= 2199;
  }
  function localAddress(ip) {
    if (typeof ip !== 'string' || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
    const p = ip.split('.').map(Number);
    return p.every((n, i) => n <= 255 && String(n) === ip.split('.')[i]) && p[3] > 0 && p[3] < 255 &&
      (p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
        (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31));
  }
  function schedule(value, platform) {
    const s = { kind: value.kind || 'weekly', time: value.time || '22:30',
      weekdays: [...new Set(value.weekdays || [])].sort((a,b) => a-b),
      monthDays: [...new Set(value.monthDays || [])].sort((a,b) => a-b),
      months: [...new Set(value.months || allMonths())].sort((a,b) => a-b),
      date: value.kind === 'once' ? value.date : null,
      timezone: 'device-local', dstPolicy: 'shift-forward-first', lateSeconds: platform === 'windows' ? 60 : 120 };
    requireValue(['weekly', 'monthly', 'once'].includes(s.kind), 'Unsupported recurrence');
    requireValue(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.time), 'Use hours and minutes');
    requireValue(s.months.length > 0 && s.months.every(n => Number.isInteger(n) && n >= 1 && n <= 12), 'Choose valid months');
    requireValue(s.weekdays.every(n => Number.isInteger(n) && n >= 1 && n <= 7), 'Choose valid weekdays');
    requireValue(s.monthDays.every(n => Number.isInteger(n) && (n === -1 || (n >= 1 && n <= 31))), 'Choose valid month days');
    requireValue(s.kind !== 'weekly' || s.weekdays.length > 0, 'Choose weekdays');
    requireValue(s.kind !== 'monthly' || s.monthDays.length > 0, 'Choose month days');
    requireValue(s.kind !== 'once' || validDate(s.date), 'Choose a valid date');
    return s;
  }
  function validate(plan) {
    requireValue(plan?.schemaVersion === 1, 'Unsupported routine version');
    requireValue(/^[a-zA-Z0-9_-]{1,80}$/.test(plan.id || ''), 'Invalid routine identity');
    requireValue(typeof plan.name === 'string' && plan.name.trim().length > 0 && plan.name.length <= 120, 'Name the routine');
    requireValue(['windows', 'android'].includes(plan.owner?.platform) && plan.owner.deviceId === 'local', 'Only an explicit local owner is supported');
    const platform = plan.owner.platform;
    if (plan.schedule) {
      const normalized = schedule(plan.schedule, platform);
      requireValue(plan.schedule.timezone === normalized.timezone && plan.schedule.dstPolicy === normalized.dstPolicy &&
        plan.schedule.lateSeconds === normalized.lateSeconds, 'Unsupported clock or late policy');
    }
    requireValue(Array.isArray(plan.actions) && plan.actions.length > 0 && plan.actions.length <= 3, 'Choose supported actions');
    const ids = new Set(); let timers = 0;
    for (const action of plan.actions) {
      requireValue(/^[a-zA-Z0-9_-]{1,64}$/.test(action.id || '') && !ids.has(action.id), 'Duplicate or invalid action identity'); ids.add(action.id);
      requireValue(action.target === 'local', 'Remote device actions are unavailable');
      const p = action.parameters || {};
      if (action.type === 'timer.start') {
        timers++;
        requireValue(action.phase === 'start' && Number.isInteger(p.seconds) && p.seconds >= 60 && p.seconds <= 86400, 'Invalid timer duration');
        requireValue((platform === 'android' ? ['reminder'] : ['shutdown', 'sleep', 'hibernate']).includes(p.endAction), 'Unsupported timer end action');
        requireValue(p.testMode === undefined || (platform === 'windows' && typeof p.testMode === 'boolean'), 'Invalid Test Mode preference');
      } else {
        requireValue(platform === 'android' && ['wiz.warm', 'wiz.off'].includes(action.type), 'Adapter unavailable on this owner');
        requireValue(action.phase === (action.type === 'wiz.off' ? 'timer-complete' : 'start'), 'Unsupported action phase');
        requireValue(Array.isArray(p.targets) && p.targets.length > 0 && p.targets.length <= 8 && p.targets.every(localAddress), 'Choose local WiZ targets');
        if (action.type === 'wiz.warm') requireValue(Number.isInteger(p.brightness) && p.brightness >= 10 && p.brightness <= 100, 'Invalid brightness');
      }
    }
    requireValue(timers === 1, 'Exactly one local timer is supported');
    return plan;
  }
  function fromWindowsRule(rule) {
    if (rule.plan) { validate(rule.plan); requireValue(rule.plan.owner.platform === 'windows', 'Rule belongs to another device'); }
    const kind = rule.repeat || 'weekly';
    requireValue(rule.testMode === undefined || typeof rule.testMode === 'boolean', 'Invalid Test Mode preference');
    return validate({ schemaVersion: 1, id: rule.id || 'legacy', name: String(rule.label || 'Bedtime').slice(0, 120),
      owner: { platform: 'windows', deviceId: 'local' },
      schedule: schedule({ kind, time: rule.time || '22:30', weekdays: (rule.days || DAYS).map(d => (DAYS.indexOf(d) || 7)),
        monthDays: rule.monthDays || [], months: rule.months, date: rule.date }, 'windows'),
      actions: [{ id: 'timer', type: 'timer.start', target: 'local', phase: 'start',
        parameters: { seconds: Math.max(300, Math.round((Number(rule.durationMinutes) || 60) * 60)), endAction: rule.action || 'shutdown', testMode: Boolean(rule.testMode) } }] });
  }
  function fromPhoneRoutine(routine, rule) {
    const actions = [{ id: 'timer', type: 'timer.start', target: 'local', phase: 'start', parameters: { seconds: routine.seconds, endAction: 'reminder' } }];
    if (routine.brightness > 0) actions.push({ id: 'warm', type: 'wiz.warm', target: 'local', phase: 'start', parameters: { targets: routine.warmTargets ?? routine.targets, brightness: routine.brightness } });
    if (routine.offAtEnd) actions.push({ id: 'off', type: 'wiz.off', target: 'local', phase: 'timer-complete', parameters: { targets: routine.offTargets ?? routine.targets } });
    return validate({ schemaVersion: 1, id: rule?.id || routine.id, name: routine.name,
      owner: { platform: 'android', deviceId: 'local' }, schedule: rule ? schedule(rule, 'android') : null, actions });
  }
  function matchesDate(s, day) {
    if (!validDate(day)) return false;
    if (s.kind === 'once') return s.date === day;
    const date = new Date(day + 'T12:00:00Z'), months = s.months || allMonths();
    if (!months.includes(date.getUTCMonth() + 1)) return false;
    if (s.kind === 'weekly') return (s.weekdays || []).includes(date.getUTCDay() || 7);
    if (s.kind !== 'monthly') return false;
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    return (s.monthDays || []).includes(date.getUTCDate()) || ((s.monthDays || []).includes(-1) && date.getUTCDate() === last);
  }
  function occurrenceKey(plan, day) {
    validate(plan); requireValue(validDate(day), 'Invalid occurrence date');
    return `v1:${plan.owner.platform}:local:${plan.id}:${day}`;
  }
  function availability(plan, platform, available = true) {
    try { validate(plan); } catch (error) { return { available: false, reason: error.message }; }
    return plan.owner.platform === platform && available
      ? { available: true, reason: 'Runs on this device while available' }
      : { available: false, reason: 'Owner unavailable; no remote handoff is configured' };
  }
  return { validate, schedule, fromWindowsRule, fromPhoneRoutine, occurrenceKey, matchesDate, availability };
});
