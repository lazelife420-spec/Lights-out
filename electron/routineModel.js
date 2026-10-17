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
      actions: [{ id: rule.actionId || 'timer', type: 'timer.start', target: 'local', phase: 'start',
        parameters: { seconds: Math.max(300, Math.round((Number(rule.durationMinutes) || 60) * 60)), endAction: rule.action || 'shutdown', testMode: Boolean(rule.testMode) } }] });
  }
  function fromPhoneRoutine(routine, rule) {
    const actions = [{ id: routine.actionIds?.['timer.start'] || 'timer', type: 'timer.start', target: 'local', phase: 'start', parameters: { seconds: routine.seconds, endAction: 'reminder' } }];
    if (routine.brightness > 0) actions.push({ id: routine.actionIds?.['wiz.warm'] || 'warm', type: 'wiz.warm', target: 'local', phase: 'start', parameters: { targets: routine.warmTargets ?? routine.targets, brightness: routine.brightness } });
    if (routine.offAtEnd) actions.push({ id: routine.actionIds?.['wiz.off'] || 'off', type: 'wiz.off', target: 'local', phase: 'timer-complete', parameters: { targets: routine.offTargets ?? routine.targets } });
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
  // Offline interchange projects the existing action/schedule model. It never
  // carries an owner, endpoint, activation flag, receipt or occurrence ledger.
  const MAX_FILE_BYTES = 262144;
  const portableId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  function fields(value, required, optional = []) {
    requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object in the routine file');
    requireValue(required.every(k => Object.hasOwn(value,k)) && Object.keys(value).every(k => [...required,...optional].includes(k)), 'Missing or unsupported field in the routine file');
  }
  function portableSchedule(s) {
    fields(s, ['kind','time','weekdays','monthDays','months','date','timezone','dstPolicy']);
    requireValue(['weekdays','monthDays','months'].every(k => Array.isArray(s[k]) && s[k].length <= 31 && new Set(s[k]).size === s[k].length), 'Invalid calendar selectors');
    const normalized = schedule(s, 'android');
    requireValue(s.timezone === normalized.timezone && s.dstPolicy === normalized.dstPolicy && (s.kind === 'once' || s.date === null), 'Unsupported calendar clock policy');
    return s;
  }
  function portableActions(actions) {
    requireValue(Array.isArray(actions) && actions.length >= 1 && actions.length <= 3, 'Choose one timer and up to two WiZ actions');
    const ids = new Set(), types = new Set();
    for (const a of actions) {
      fields(a, ['id','type','phase','parameters']);
      requireValue(typeof a.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(a.id) && !ids.has(a.id) && !types.has(a.type), 'Duplicate or invalid action identity');
      ids.add(a.id); types.add(a.type);
      if (a.type === 'timer.start') {
        fields(a.parameters, ['seconds','endAction']);
        requireValue(a.phase === 'start' && Number.isInteger(a.parameters.seconds) && a.parameters.seconds >= 60 && a.parameters.seconds <= 86400, 'Invalid timer duration');
        requireValue(['reminder','shutdown','sleep','hibernate'].includes(a.parameters.endAction), 'Unsupported timer ending');
      } else {
        requireValue(['wiz.warm','wiz.off'].includes(a.type), 'This action has no supported interchange adapter');
        fields(a.parameters, a.type === 'wiz.warm' ? ['bindings','brightness'] : ['bindings']);
        requireValue(a.phase === (a.type === 'wiz.off' ? 'timer-complete' : 'start'), 'Unsupported action timing');
        const b = a.parameters.bindings;
        requireValue(Array.isArray(b) && b.length >= 1 && b.length <= 8 && new Set(b).size === b.length && b.every(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(v)), 'Use abstract light bindings, not addresses');
        if (a.type === 'wiz.warm') requireValue(Number.isInteger(a.parameters.brightness) && a.parameters.brightness >= 10 && a.parameters.brightness <= 100, 'Invalid brightness');
      }
    }
    requireValue(types.has('timer.start'), 'A portable routine needs a timer');
    requireValue(new Set(actions.flatMap(a => a.parameters.bindings || [])).size <= 8, 'Keep up to eight light bindings per routine');
  }
  function portableValidate(d) {
    fields(d, ['format','schemaVersion','routines','rules']);
    requireValue(d.format === 'lights-out.routines' && d.schemaVersion === 1, 'Unsupported routine file format or version');
    requireValue(Array.isArray(d.routines) && d.routines.length >= 1 && d.routines.length <= 32 && Array.isArray(d.rules) && d.rules.length <= 64, 'Keep up to 32 routines and 64 rules per file');
    const routines = new Set(), rules = new Set();
    const name = n => typeof n === 'string' && n.trim().length > 0 && n.trim() === n && n.length <= 60 && !/[\u0000-\u001f\u007f]/.test(n);
    for (const r of d.routines) {
      fields(r, ['id','name','actions']); requireValue(portableId(r.id) && !routines.has(r.id), 'Duplicate or invalid routine identity');
      requireValue(name(r.name), 'Name routines with 1–60 printable characters'); routines.add(r.id); portableActions(r.actions);
    }
    for (const r of d.rules) {
      fields(r, ['id','routineId','name','schedule']); requireValue(portableId(r.id) && !rules.has(r.id), 'Duplicate or invalid rule identity');
      requireValue(routines.has(r.routineId) && name(r.name), 'Calendar rule references a missing routine or name'); rules.add(r.id); portableSchedule(r.schedule);
    }
    return d;
  }
  function portableParse(text) {
    requireValue(typeof text === 'string' && new TextEncoder().encode(text).length <= MAX_FILE_BYTES, 'Routine files must be UTF-8 JSON up to 256 KiB');
    const json=text.replace(/^\uFEFF/,'');
    let d; try { d = JSON.parse(json); } catch { throw Error('The routine file is not valid JSON'); }
    // JSON.parse accepts duplicate keys. Reject ambiguity (and excessive
    // nesting) before either platform can interpret a different version.
    let at=0;
    const whitespace=()=>{while(/\s/.test(json[at] || '') && at<json.length)at++;};
    function quoted(){const start=at++;while(at<json.length){if(json[at]==='\\'){at+=2;continue;}if(json[at++]==='"')return JSON.parse(json.slice(start,at));}throw Error('Invalid JSON string');}
    function scan(depth){requireValue(depth<=16,'Routine JSON nesting is too deep');whitespace();const token=json[at];
      if(token==='{'){at++;whitespace();const keys=new Set();if(json[at]==='}'){at++;return;}while(true){whitespace();const key=quoted();requireValue(!keys.has(key),'Duplicate JSON field');keys.add(key);whitespace();at++;scan(depth+1);whitespace();if(json[at++]==='}')break;}}
      else if(token==='['){at++;whitespace();if(json[at]===']'){at++;return;}while(true){scan(depth+1);whitespace();if(json[at++]===']')break;}}
      else if(token==='"')quoted();else while(at<json.length&&!/[\s,}\]]/.test(json[at]))at++;
    }
    scan(0);
    return portableValidate(d);
  }
  function portablePrepare(document, existing, policy = 'reject', newId) {
    const d = JSON.parse(JSON.stringify(portableValidate(document)));
    requireValue(['reject','copy'].includes(policy), 'Choose reject conflicts or import as copies');
    const usedRoutines = new Set(existing.routines || []), usedRules = new Set(existing.rules || []), map = new Map();
    function identity(id, used) {
      if (!used.has(id)) { used.add(id); return id; }
      requireValue(policy === 'copy', 'Identity conflict: existing records were not changed. Choose Import as copies.');
      for (let n = 0; n < 32; n++) { const next = newId(); if (portableId(next) && !used.has(next)) { used.add(next); return next; } }
      throw Error('Could not allocate a unique copy identity');
    }
    for (const r of d.routines) { const old = r.id; r.id = identity(old, usedRoutines); map.set(old,r.id); }
    for (const r of d.rules) { r.id = identity(r.id,usedRules); r.routineId = map.get(r.routineId); }
    return d;
  }
  function portableInspect(d, platform, existing = { routines: [], rules: [] }) {
    portableValidate(d); requireValue(['windows','android'].includes(platform), 'Unknown local platform');
    return { document: d, routines: d.routines.map(r => {
      const timer = r.actions.find(a => a.type === 'timer.start'), issues = [];
      if (platform === 'android' && timer.parameters.endAction !== 'reminder') issues.push('Choose the phone reminder instead of the Windows power ending.');
      if (platform === 'windows' && timer.parameters.endAction === 'reminder') issues.push('Choose a Windows timer ending; phone reminders are unavailable on this PC.');
      if (r.actions.some(a => a.type.startsWith('wiz.'))) issues.push(platform === 'windows' ? 'WiZ actions are unavailable in the PC routine adapter. Explicitly omit them to adopt.' : 'Bind light slots to saved phone lights, or explicitly omit lighting.');
      if (platform === 'windows' && timer.parameters.seconds < 300 && d.rules.some(rule => rule.routineId === r.id)) issues.push('Windows scheduled timers require at least 5 minutes. Review the duration.');
      return { ...r, issues, conflict: (existing.routines || []).includes(r.id) };
    }), conflicts: { routines: d.routines.filter(r => (existing.routines || []).includes(r.id)).map(r => r.id), rules: d.rules.filter(r => (existing.rules || []).includes(r.id)).map(r => r.id) },
    note: 'Times use this device’s local timezone. Import saves inactive drafts; adoption saves calendar rules disabled.' };
  }
  function portableFromPlan(plan, configuredBindings = {}) {
    validate(plan);
    const addresses = [...new Set(plan.actions.flatMap(a => a.parameters.targets || []))].sort();
    const slots = new Map(), used = new Set();
    for (const [slot,ip] of Object.entries(configuredBindings)) if(addresses.includes(ip) && /^[a-zA-Z0-9_-]{1,32}$/.test(slot) && !slots.has(ip)){slots.set(ip,slot);used.add(slot);}
    for (const ip of addresses) if(!slots.has(ip)){let n=1;while(used.has('light-'+n))n++;const slot='light-'+n;slots.set(ip,slot);used.add(slot);}
    return { id: plan.id, name: plan.name, actions: plan.actions.map(a => ({ id:a.id, type:a.type, phase:a.phase,
      parameters: a.type === 'timer.start' ? { seconds:a.parameters.seconds, endAction:a.parameters.endAction } : {
        bindings: a.parameters.targets.map(ip => slots.get(ip)), ...(a.type === 'wiz.warm' ? {brightness:a.parameters.brightness} : {}) } })) };
  }
  function portableRule(rule, routineId, name) {
    const s = schedule(rule, 'android'); delete s.lateSeconds;
    return { id:rule.id, routineId, name, schedule:s };
  }
  function phoneExport(config, ids) {
    requireValue(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, 'Select routines to export');
    const routines = [], rules = [];
    for (const id of ids) {
      const native = (config.routines || []).find(r => r.id === id), draft = (config.portable?.routines || []).find(r => r.intent.id === id);
      requireValue(native || draft, 'A selected routine is no longer available');
      if (native) {
        routines.push(portableFromPlan(fromPhoneRoutine(native),native.lightBindings));
        for (const rule of config.rules || []) if (rule.routineId === id) rules.push(portableRule(rule,id,rule.name || native.name));
      } else { routines.push(draft.intent); rules.push(...(config.portable.rules || []).filter(r => r.routineId === id)); }
    }
    return portableValidate({format:'lights-out.routines',schemaVersion:1,routines,rules});
  }
  const interchange = { maxBytes:MAX_FILE_BYTES, validate:portableValidate, parse:portableParse, prepare:portablePrepare, inspect:portableInspect,
    fromPlan:portableFromPlan, rule:portableRule, phoneExport };
  return { validate, schedule, fromWindowsRule, fromPhoneRoutine, occurrenceKey, matchesDate, availability, interchange };
});
