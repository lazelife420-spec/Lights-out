'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let config = { lights: [], routines: [], rules: [] }, configKey = '', upcoming = [], nextKey = '';
  let firstLightKey = '';
  let routineId = '', ruleId = '', view = 'timer';
  let editingActionIds = {};
  let month = new Date(); month = new Date(month.getFullYear(), month.getMonth(), 1);
  let weekStart = new Date(); weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  let calMode = 'month';
  const error = text => window.phoneUI.error(text);
  const send = (action, data = {}) => {
    const errEl = $('error');
    if (errEl) errEl.hidden = true;
    if (!window.phoneNative) return error('Phone controls are not ready. Reopen Lights Out.');
    window.phoneNative.postMessage(JSON.stringify({ action, ...data }));
  };
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const button = (text, fn, cls = 'secondary') => { const node = el('button', text, cls); node.type = 'button'; node.onclick = fn; return node; };
  const checked = id => [...($(id)?.querySelectorAll('input:checked') || [])].map(n => n.value);
  function choices(id, values, selected) {
    const host = $(id);
    if (!host) return;
    host.replaceChildren(...values.map(([value, name]) => {
      const label = el('label', undefined, 'check'); const input = el('input'); input.type = 'checkbox'; input.value = value; input.checked = selected.includes(String(value));
      label.append(input, document.createTextNode(name)); return label;
    }));
  }
  function tab(name) {
    view = name;
    if (document.body) document.body.dataset.tab = name;
    ['timer', 'lighting', 'routines', 'calendar'].forEach(value => { const panel = $('view-' + value); if (panel) panel.hidden = name !== value; });
    document.querySelectorAll('[data-tab]').forEach(node => {
      if (node.dataset.tab === name) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    });
  }
  document.querySelectorAll('[data-tab]').forEach(node => { node.onclick = () => tab(node.dataset.tab); });
  if ($('strip-all')) $('strip-all').onclick = () => tab('lighting');

  function renderLightCards() {
    const count = config.lights.length;
    if ($('lights-count')) $('lights-count').textContent = count ? `${count} light${count === 1 ? '' : 's'}` : '0 lights';
    for (const id of ['strip-warm', 'strip-off', 'light-status', 'light-on', 'light-off', 'light-warm', 'light-brightness']) {
      if ($(id)) $(id).disabled = count === 0;
    }
    const host = $('light-cards');
    if (!host) return;
    if (!count) {
      host.replaceChildren(el('p', 'No saved lights yet — set up lights below.', 'empty-copy'));
      return;
    }
    host.replaceChildren(...config.lights.map((ip, idx) => {
      const card = el('div', undefined, 'lamp');
      card.append(el('span', undefined, 'dot'), el('span', `WiZ light ${idx + 1}`, 'name'), el('span', ip, 'st'));
      return card;
    }));
  }

  function resetRoutine(p = {}) {
    editingActionIds = p.actionIds || {};
    routineId = p.id || '';
    if ($('routine-editor-title')) $('routine-editor-title').textContent = p.id ? 'Edit routine' : 'New routine';
    if ($('routine-name')) $('routine-name').value = p.name || '';
    if ($('routine-minutes')) $('routine-minutes').value = p.seconds ? p.seconds / 60 : 30;
    if ($('routine-warm')) $('routine-warm').checked = Boolean(p.brightness);
    if ($('routine-off')) $('routine-off').checked = Boolean(p.offAtEnd);
    if ($('routine-brightness')) $('routine-brightness').value = p.brightness || 30;
    choices('routine-light-options', config.lights.map(ip => [ip, ip]), p.warmTargets ?? p.targets ?? []);
    choices('routine-off-light-options', config.lights.map(ip => [ip, ip]), p.offTargets ?? p.targets ?? []);
    actionFields();
  }
  function actionFields() {
    if ($('routine-warm-fields')) $('routine-warm-fields').hidden = !$('routine-warm')?.checked;
    if ($('routine-off-fields')) $('routine-off-fields').hidden = !$('routine-off')?.checked;
    if ($('routine-brightness')) $('routine-brightness').disabled = !$('routine-warm')?.checked;
    const actions = [`${$('routine-minutes')?.value || 30} min phone reminder`];
    if ($('routine-warm')?.checked) actions.push(`warm ${checked('routine-light-options').length} light(s) to ${$('routine-brightness')?.value}% at start`);
    if ($('routine-off')?.checked) actions.push(`switch ${checked('routine-off-light-options').length} light(s) off at finish`);
    if ($('routine-action-preview')) {
      $('routine-action-preview').textContent = 'On this phone: ' + actions.join(' · ') + '. ' + (config.lights.length ? '' : 'Save lights in Lights to add WiZ actions.');
    }
  }
  if ($('routine-form')) $('routine-form').addEventListener('input', actionFields);

  function fields() {
    const kind = $('rule-kind')?.value || 'weekly';
    if ($('week-field')) $('week-field').hidden = kind !== 'weekly';
    if ($('month-field')) $('month-field').hidden = kind !== 'monthly';
    if ($('months-field')) $('months-field').hidden = kind === 'once';
    if ($('date-field')) $('date-field').hidden = kind !== 'once';
    if ($('rule-date')) $('rule-date').required = kind === 'once';
  }
  function resetRule(p = {}) {
    ruleId = p.id || '';
    if ($('rule-editor-title')) $('rule-editor-title').textContent = p.id ? 'Edit calendar rule' : 'New calendar rule';
    if ($('rule-routine')) $('rule-routine').value = p.routineId || config.routines[0]?.id || '';
    if ($('rule-kind')) $('rule-kind').value = p.kind || 'weekly';
    if ($('rule-time')) $('rule-time').value = p.time || '22:00';
    if ($('rule-date')) $('rule-date').value = p.date || '';
    if ($('rule-days')) $('rule-days').value = (p.monthDays || [1]).map(v => v === -1 ? 'last' : v).join(', ');
    if ($('rule-enabled')) $('rule-enabled').checked = p.enabled !== false;
    choices('weekday-options', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => [i + 1, n]), (p.weekdays || [1, 2, 3, 4, 5]).map(String));
    choices('month-options', Array.from({ length: 12 }, (_, i) => [i + 1, new Date(2026, i, 1).toLocaleDateString([], { month: 'short' })]), (p.months || Array.from({ length: 12 }, (_, i) => i + 1)).map(String));
    fields();
  }

  function renderUpcoming() {
    const host = $('upcoming-list');
    if (!host) return;
    const armed = config.rules
      .filter(r => r.enabled !== false)
      .map(r => ({ rule: r, routine: config.routines.find(p => p.id === r.routineId), next: upcoming.find(n => n.id === r.id)?.next }))
      .filter(item => item.next)
      .sort((a, b) => a.next - b.next)
      .slice(0, 3);
    if (!armed.length) {
      host.replaceChildren(el('p', 'No upcoming scheduled runs yet.', 'empty-copy'));
      return;
    }
    host.replaceChildren(...armed.map(({ rule, routine, next }) => {
      const card = el('div', undefined, 'up-card');
      const info = el('div');
      const when = new Date(next).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      info.append(el('div', `${when} — ${routine?.name || 'Routine'}`, 'when'));
      info.append(el('div', `${rule.kind === 'once' ? rule.date : rule.kind === 'monthly' ? 'Monthly' : 'Weekly'} · ${rule.time}`, 'what'));
      card.append(info, el('span', 'ARMED', 'tag'));
      return card;
    }));
  }

  function cards() {
    const routineList = $('routine-list');
    if (routineList) {
      routineList.replaceChildren(...config.routines.map(p => {
        const card = el('article', undefined, 'r-card');
        card.append(el('div', p.name, 'r-name'));
        const summary = `On this phone: ${Math.round(p.seconds / 60)} min reminder${p.brightness ? ` · warm ${p.brightness}% at start` : ''}${p.offAtEnd ? ' · lights off at finish' : ''}`;
        card.append(el('div', summary, 'r-sum'));
        const matchingRuleIds = new Set(config.rules.filter(r => r.routineId === p.id && r.enabled !== false).map(r => r.id));
        const nextTs = upcoming.filter(u => matchingRuleIds.has(u.id) && u.next).map(u => u.next).sort((a, b) => a - b)[0];
        card.append(el('div', nextTs ? 'Next · ' + new Date(nextTs).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Manual start', 'r-next'));
        const actions = el('div', undefined, 'button-row');
        actions.append(
          button('Start now', () => { send('startRoutine', { id: p.id }); tab('timer'); }),
          button('Edit', () => { resetRoutine(p); $('routine-form')?.scrollIntoView({ block: 'start' }); }),
          button('Delete', () => send('deleteRoutine', { id: p.id }), 'text-button')
        );
        card.append(actions);
        return card;
      }));
      if (!config.routines.length) routineList.append(el('p', 'Save your first routine below.', 'empty-copy'));
    }
    const ruleSelect = $('rule-routine');
    if (ruleSelect) {
      const selected = ruleSelect.value;
      if (config.routines.length) {
        ruleSelect.replaceChildren(...config.routines.map(p => { const option = el('option', p.name); option.value = p.id; return option; }));
        if (config.routines.some(p => p.id === selected)) ruleSelect.value = selected;
      } else {
        const emptyOpt = el('option', 'No routines yet — create one on Routines');
        emptyOpt.value = '';
        emptyOpt.disabled = true;
        emptyOpt.selected = true;
        ruleSelect.replaceChildren(emptyOpt);
      }
    }
    renderUpcoming();
    const ruleList = $('rule-list');
    if (ruleList) {
      ruleList.replaceChildren(...config.rules.map(r => {
        const card = el('article', undefined, 'rule-card');
        const p = config.routines.find(item => item.id === r.routineId);
        const next = upcoming.find(n => n.id === r.id)?.next;
        const head = el('div', undefined, 'rule-card-head');
        head.append(el('h2', p?.name || 'Missing routine'), el('span', r.enabled === false ? 'Off' : 'On', 'badge ' + (r.enabled === false ? 'off' : 'ok')));
        card.append(head);
        card.append(el('p', `${r.kind === 'once' ? r.date : r.kind === 'monthly' ? 'Monthly' : 'Weekly'} · ${r.time}`));
        card.append(el('small', r.enabled === false ? 'This rule is disabled.' : next ? 'Next ' + new Date(next).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No future date matches.'));
        const actions = el('div', undefined, 'button-row');
        actions.append(
          button('Edit', () => { resetRule(r); $('rule-form')?.scrollIntoView({ block: 'start' }); }),
          button('Delete', () => send('deleteRule', { id: r.id }), 'text-button')
        );
        card.append(actions);
        return card;
      }));
    }
  }

  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function matches(r, d) {
    if (r.enabled === false) return false;
    if (r.kind === 'once') return r.date === dateKey(d);
    if (r.kind === 'weekly') return (!r.months || r.months.includes(d.getMonth() + 1)) && (r.weekdays || []).includes(d.getDay() || 7);
    return (r.months || []).includes(d.getMonth() + 1) && ((r.monthDays || []).includes(d.getDate()) || ((r.monthDays || []).includes(-1) && new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate()));
  }
  function renderWeek() {
    const grid = $('week-grid');
    if (!grid) return;
    const base = new Date(weekStart);
    base.setDate(base.getDate() - (base.getDay() + 6) % 7);
    if ($('week-label')) $('week-label').textContent = 'Week of ' + base.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const today = dateKey(new Date());
    const dow = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    grid.replaceChildren(...Array.from({ length: 14 }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      const scheduled = config.rules.some(r => matches(r, d));
      const node = button(String(d.getDate()) + (scheduled ? ' ✦' : ''), () => {
        resetRule({ kind: 'once', date: dateKey(d) });
        $('rule-form')?.scrollIntoView({ block: 'start' });
      }, 'day');
      node.append(el('span', dow[i % 7], 'dow'));
      node.classList.toggle('today', dateKey(d) === today);
      node.setAttribute('aria-label', d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + (scheduled ? ', routine scheduled' : ''));
      return node;
    }));
  }
  function calendar() {
    if ($('calendar-month')) $('calendar-month').textContent = month.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const offset = (month.getDay() + 6) % 7, today = dateKey(new Date());
    const monthGrid = $('month-grid');
    if (monthGrid) {
      monthGrid.replaceChildren(...Array.from({ length: 42 }, (_, i) => {
        const d = new Date(month.getFullYear(), month.getMonth(), i - offset + 1);
        const scheduled = config.rules.some(r => matches(r, d));
        const node = button(String(d.getDate()) + (scheduled ? ' ✦' : ''), () => {
          resetRule({ kind: 'once', date: dateKey(d) });
          $('rule-form')?.scrollIntoView({ block: 'start' });
        }, 'day');
        node.classList.toggle('outside', d.getMonth() !== month.getMonth());
        node.classList.toggle('today', dateKey(d) === today);
        node.setAttribute('aria-label', d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + (scheduled ? ', routine scheduled' : ''));
        return node;
      }));
    }
    if (calMode === 'week') renderWeek();
  }
  function setCalMode(mode) {
    calMode = mode;
    if ($('month-view')) $('month-view').hidden = mode !== 'month';
    if ($('week-view')) $('week-view').hidden = mode !== 'week';
    if ($('cal-month')) { $('cal-month').classList.toggle('selected', mode === 'month'); $('cal-month').setAttribute('aria-pressed', String(mode === 'month')); }
    if ($('cal-week')) { $('cal-week').classList.toggle('selected', mode === 'week'); $('cal-week').setAttribute('aria-pressed', String(mode === 'week')); }
    if (mode === 'week') renderWeek();
  }
  if ($('cal-month')) $('cal-month').onclick = () => setCalMode('month');
  if ($('cal-week')) $('cal-week').onclick = () => setCalMode('week');
  if ($('month-prev')) $('month-prev').onclick = () => { if (month.getFullYear() > 2000 || month.getMonth() > 0) { month.setMonth(month.getMonth() - 1); calendar(); } };
  if ($('month-next')) $('month-next').onclick = () => { if (month.getFullYear() < 2199 || month.getMonth() < 11) { month.setMonth(month.getMonth() + 1); calendar(); } };
  if ($('week-prev')) $('week-prev').onclick = () => { weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7); renderWeek(); };
  if ($('week-next')) $('week-next').onclick = () => { weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7); renderWeek(); };

  if ($('rule-kind')) $('rule-kind').onchange = fields;
  if ($('new-routine')) $('new-routine').onclick = () => resetRoutine();
  if ($('new-rule')) $('new-rule').onclick = () => resetRule();
  if ($('save-lights')) $('save-lights').onclick = () => send('saveLights', { targets: ($('light-ips')?.value || '').split(/[\s,]+/).filter(Boolean) });
  if ($('discover-lights')) $('discover-lights').onclick = () => send('discoverLights');
  ['status', 'on', 'off', 'warm'].forEach(command => {
    const btn = $('light-' + command);
    if (btn) btn.onclick = () => {
      if (!config.lights.length) return;
      send('lightCommand', { command, targets: config.lights, brightness: Number($('light-brightness')?.value || 30) });
    };
  });
  if ($('strip-warm')) $('strip-warm').onclick = () => { if (config.lights.length) send('lightCommand', { command: 'warm', targets: config.lights, brightness: 30 }); };
  if ($('strip-off')) $('strip-off').onclick = () => { if (config.lights.length) send('lightCommand', { command: 'off', targets: config.lights, brightness: 30 }); };
  if ($('light-brightness')) $('light-brightness').oninput = () => { if ($('brightness-value')) $('brightness-value').textContent = $('light-brightness').value + '%'; };

  const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.floor(Math.random() * 16);
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
  if ($('routine-form')) {
    $('routine-form').onsubmit = event => {
      event.preventDefault(); const minutes = Number($('routine-minutes').value);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return error('Choose 1 minute to 24 hours.');
      const warmTargets = checked('routine-light-options'), offTargets = checked('routine-off-light-options');
      const routine = { id: routineId || newId(), name: $('routine-name').value.trim(), seconds: minutes * 60, targets: [...new Set([...warmTargets, ...offTargets])].sort(), warmTargets, offTargets, actionIds: editingActionIds, brightness: $('routine-warm').checked ? Number($('routine-brightness').value) : 0, offAtEnd: $('routine-off').checked };
      try { routine.plan = window.RoutineModel.fromPhoneRoutine(routine); } catch (e) { return error(e.message); }
      send('saveRoutine', { routine });
    };
  }
  if ($('rule-form')) {
    $('rule-form').onsubmit = event => {
      event.preventDefault();
      const kind = $('rule-kind').value;
      let monthDays = [];
      if (kind === 'monthly') {
        const tokens = $('rule-days').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (!tokens.length || tokens.some(s => s !== 'last' && !/^(?:[1-9]|[12][0-9]|3[01])$/.test(s))) {
          return error('Use days 1–31 or “last”, separated by commas.');
        }
        monthDays = tokens.map(s => s === 'last' ? -1 : Number(s));
      }
      send('saveRule', { rule: { id: ruleId, routineId: $('rule-routine').value, kind, time: $('rule-time').value, weekdays: kind === 'weekly' ? checked('weekday-options').map(Number) : [], monthDays, months: kind === 'once' ? Array.from({ length: 12 }, (_, i) => i + 1) : checked('month-options').map(Number), date: kind === 'once' ? $('rule-date').value : '', enabled: $('rule-enabled').checked } });
    };
  }

  function syncFirstLightFields() {
    const hasLights = config.lights.length > 0;
    const sunriseCheck = $('fl-sunrise-enabled');
    if (sunriseCheck) {
      sunriseCheck.disabled = !hasLights;
      if (!hasLights) sunriseCheck.checked = false;
    }
    if ($('fl-sunrise-fields')) {
      $('fl-sunrise-fields').hidden = !(hasLights && Boolean(sunriseCheck?.checked));
    }
    if ($('fl-sunrise-note')) {
      $('fl-sunrise-note').textContent = hasLights
        ? 'Select which saved WiZ lights should warm up before wake.'
        : 'Save local WiZ lights on the Lights tab to enable sunrise.';
    }
  }

  const reminderLead = {
    stopped: 'Sunrise stopped',
    edited: 'Sunrise stopped after a settings change',
    yielded: 'Sunrise yielded to manual control',
    notStarted: 'Sunrise could not start',
    interrupted: 'Sunrise was interrupted'
  };

  function renderFirstLight(rawFl, exact, alerts) {
    const defaultCfg = { enabled: false, time: '07:00', weekdays: [1, 2, 3, 4, 5], sunriseEnabled: false, sunriseMinutes: 15, startBrightness: 10, endBrightness: 80, lightTargets: [] };
    const fl = rawFl && typeof rawFl === 'object' ? rawFl : { config: defaultCfg, armed: false, nextWakeEpochMs: 0, nextTriggerEpochMs: 0, reminderEpochMs: 0, reminderInexact: false, reminderState: '', rampActive: false, rampStep: 0, rampTotalSteps: 0, lastEvent: '' };
    const cfg = { ...defaultCfg, ...(fl.config || {}) };
    // The wake reminder is a notification; with notifications off it cannot appear.
    const needsAlerts = Boolean(cfg.enabled) && alerts === false;

    const statePill = $('fl-state');
    if (statePill) {
      if (fl.rampActive) { statePill.textContent = 'Sunrise active'; statePill.className = 'state-pill on'; }
      else if (!cfg.enabled) { statePill.textContent = 'Off'; statePill.className = 'state-pill'; }
      else if (exact === false) { statePill.textContent = 'Needs alarm access'; statePill.className = 'state-pill warn'; }
      else if (needsAlerts) { statePill.textContent = 'Needs notifications'; statePill.className = 'state-pill warn'; }
      else if (fl.armed) { statePill.textContent = 'Armed'; statePill.className = 'state-pill on'; }
      else { statePill.textContent = 'Unscheduled'; statePill.className = 'state-pill warn'; }
    }
    if ($('fl-next')) {
      let line;
      if (fl.rampActive) {
        line = `Local WiZ sunrise running (${fl.rampStep || 1}/${fl.rampTotalSteps || cfg.sunriseMinutes}). Manual off always wins; Stop sunrise keeps the wake reminder.`;
      } else if (!cfg.enabled) {
        line = 'Off by default on this phone.';
      } else if (fl.reminderEpochMs > 0) {
        const at = new Date(fl.reminderEpochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const when = fl.reminderInexact ? `around ${at}` : `at ${at}`;
        const verb = fl.reminderEpochMs > Date.now() ? 'still fires' : 'is due';
        line = `${reminderLead[fl.reminderState] || 'Sunrise ended'} · wake reminder ${verb} ${when}.`;
        if (fl.reminderInexact && exact === false) line += ' Without Alarms & reminders access Android may deliver it up to an hour late.';
      } else if (exact === false) {
        line = 'Paused until precise alerts are allowed on Tonight.';
      } else if (fl.nextWakeEpochMs > 0) {
        const when = new Date(fl.nextWakeEpochMs).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const sunriseTag = cfg.sunriseEnabled && (cfg.lightTargets || []).length ? ` · sunrise ${cfg.sunriseMinutes} min earlier` : '';
        line = `Next wake · ${when}${sunriseTag}`;
      } else {
        line = 'Choose wake days to schedule First Light.';
      }
      if (needsAlerts) line += `${/[.!?]$/.test(line) ? '' : '.'} Notifications are off, so the wake reminder cannot appear. Enable notifications on Tonight.`;
      $('fl-next').textContent = line;
    }
    if ($('fl-last-event')) {
      $('fl-last-event').textContent = fl.lastEvent || '';
      $('fl-last-event').hidden = !fl.lastEvent;
    }
    if ($('fl-stop-ramp')) {
      $('fl-stop-ramp').hidden = !fl.rampActive;
    }

    const flFormKey = JSON.stringify({ cfg, lights: config.lights });
    if (flFormKey !== firstLightKey) {
      firstLightKey = flFormKey;
      if ($('fl-enabled')) $('fl-enabled').checked = Boolean(cfg.enabled);
      if ($('fl-time')) $('fl-time').value = cfg.time || '07:00';
      choices('fl-weekdays', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => [i + 1, n]), (cfg.weekdays || [1, 2, 3, 4, 5]).map(String));
      if ($('fl-sunrise-enabled')) $('fl-sunrise-enabled').checked = Boolean(cfg.sunriseEnabled && config.lights.length > 0);
      if ($('fl-sunrise-minutes')) $('fl-sunrise-minutes').value = String(cfg.sunriseMinutes || 15);
      if ($('fl-start-brightness')) $('fl-start-brightness').value = String(cfg.startBrightness || 10);
      if ($('fl-end-brightness')) $('fl-end-brightness').value = String(cfg.endBrightness || 80);
      choices('fl-light-options', config.lights.map(ip => [ip, ip]), cfg.lightTargets || []);
      syncFirstLightFields();
    }
  }

  if ($('fl-sunrise-enabled')) $('fl-sunrise-enabled').addEventListener('change', syncFirstLightFields);
  if ($('fl-stop-ramp')) $('fl-stop-ramp').onclick = () => send('stopFirstLight');
  if ($('first-light-form')) {
    $('first-light-form').onsubmit = event => {
      event.preventDefault();
      const weekdays = checked('fl-weekdays').map(Number);
      if (!weekdays.length) return error('Choose at least one wake day for First Light.');
      const sunriseEnabled = Boolean($('fl-sunrise-enabled')?.checked) && config.lights.length > 0;
      const sunriseMinutes = Number($('fl-sunrise-minutes')?.value || 15);
      const startBrightness = Number($('fl-start-brightness')?.value || 10);
      const endBrightness = Number($('fl-end-brightness')?.value || 80);
      if (!Number.isInteger(sunriseMinutes) || sunriseMinutes < 5 || sunriseMinutes > 45) return error('Sunrise duration must be 5–45 minutes.');
      if (!Number.isInteger(startBrightness) || startBrightness < 10 || startBrightness > 50) return error('Start brightness must be 10–50%.');
      if (!Number.isInteger(endBrightness) || endBrightness < 20 || endBrightness > 100 || endBrightness < startBrightness) return error('End brightness must be 20–100% and at least start brightness.');
      const lightTargets = sunriseEnabled ? checked('fl-light-options') : [];
      if (sunriseEnabled && !lightTargets.length) return error('Choose at least one saved WiZ light for sunrise.');
      send('saveFirstLight', {
        firstLight: {
          enabled: Boolean($('fl-enabled')?.checked),
          time: $('fl-time')?.value || '07:00',
          weekdays,
          sunriseEnabled,
          sunriseMinutes,
          startBrightness,
          endBrightness,
          lightTargets
        }
      });
    };
  }

  window.phoneHome = {
    saved(action) {
      if (action === 'saveRoutine' || action === 'deleteRoutine') resetRoutine();
      if (action === 'saveRule' || action === 'deleteRule') resetRule();
      if (action === 'saveFirstLight' && $('fl-editor')) $('fl-editor').open = false;
    },
    update(state) {
      const outcomes = $('routine-outcomes');
      const outcomeLabel = { claimed: 'Claimed; start not confirmed', running: 'Timer running', completed: 'Completed',
        cancelled: 'Cancelled', skipped: 'Skipped', failed: 'Failed', unavailable: 'History unavailable', 'partial-failure': 'Some actions failed', 'waiting-for-actions': 'Timer finished; waiting for lights' };
      const actionLabel = { 'timer.start': 'Phone reminder', 'wiz.warm': 'Warm lights', 'wiz.off': 'Lights off' };
      if (outcomes) {
        outcomes.replaceChildren(...(state.routineOutcomes || []).slice(-12).reverse().map(entry => {
          const row = el('p', `${entry.name} · ${outcomeLabel[entry.status] || 'Outcome unknown'}${entry.reason === 'timer-active' ? ' · Another phone timer was active' : ''}`);
          const statusLabel = { pending: 'Waiting', started: 'Started', paused: 'Paused', completed: 'Completed', acknowledged: 'Acknowledged', cancelled: 'Cancelled', skipped: 'Skipped', failed: 'Failed' };
          for (const action of entry.actions || []) row.append(el('small', ` · ${actionLabel[action.type] || 'Action'}: ${statusLabel[action.status] || 'Unknown'}`));
          return row;
        }));
        if (!outcomes.children.length) outcomes.textContent = 'No calendar routine has run yet.';
      }
      const key = JSON.stringify(state.home || {}), nk = JSON.stringify(state.upcoming || []);
      upcoming = state.upcoming || [];
      if (key !== configKey) {
        configKey = key; config = { lights: [], routines: [], rules: [], ...state.home };
        if ($('light-ips')) $('light-ips').value = config.lights.join('\n');
        if ($('light-count')) $('light-count').textContent = config.lights.length ? `${config.lights.length} saved light(s) · commands apply to all` : 'No saved lights yet.';
        renderLightCards();
        const connection = document.querySelector('.phone-light-connection');
        if (connection) connection.open = config.lights.length === 0;
        for (const id of ['routine-light-options', 'routine-off-light-options']) { const previous = checked(id); choices(id, config.lights.map(ip => [ip, ip]), previous); }
        actionFields();
        cards(); calendar();
        void window.phoneTransfer?.refresh();
        void window.phoneLightUI?.refresh();
      } else if (nk !== nextKey) cards();
      nextKey = nk;
      if ($('calendar-readiness')) {
        $('calendar-readiness').textContent = state.exact
          ? 'Ready to run on this phone, even with the PC off. Lights need the same Wi-Fi. Keep the phone powered on.'
          : 'Saved routines are paused. Allow precise alerts on Tonight so Android can start them with the screen off.';
      }
      if ($('phone-event')) { $('phone-event').textContent = state.event || ''; $('phone-event').hidden = !state.event; }
      const lightRes = $('light-result');
      if (lightRes) {
        const ev = state.event || '';
        const isLightEvent = /WiZ|acknowledged|no acknowledgement|timed out|superseded|^\d{1,3}(?:\.\d{1,3}){3}:/im.test(ev);
        const shown = isLightEvent ? ev : '';
        lightRes.textContent = shown;
        lightRes.className = 'muted outcome' + (!shown
          ? ''
          : /Waiting|Looking/i.test(shown)
            ? ' pending'
            : /no acknowledgement|timed out|No WiZ lights found|failed|Choose|invalid|Wait for|superseded/i.test(shown)
              ? ' fail'
              : ' ok');
      }
      renderFirstLight(state.firstLight, state.exact, state.alerts);
      syncHandoffGate(state.handoffPairing === true);
    }
  };
  const transfers = new Map();
  function transfer(action, data = {}) { return new Promise((resolve, reject) => {
    const requestId = newId(), timer = setTimeout(() => { transfers.delete(requestId); reject(Error('The file operation timed out. Reopen it when ready.')); }, 120000);
    transfers.set(requestId, { resolve, reject, timer }); window.phoneNative.postMessage(JSON.stringify({ action, requestId, ...data }));
  }); }
  window.phoneTransferReply = (id, reply) => { const request = transfers.get(id); if (!request) return; transfers.delete(id); clearTimeout(request.timer); reply.ok ? request.resolve(reply.result) : request.reject(Error(reply.error || 'File operation failed.')); };
  window.phoneTransfer = RoutineTransferUI.mount($('routine-transfer-body'), {
    platform: 'android', list: () => transfer('routineFileList'), exportFile: selection => transfer('routineFileExport', { selection }),
    openFile: () => transfer('routineFileOpen'), preview: text => transfer('routineFilePreview', { text }),
    commitImport: (text, policy) => transfer('routineFileImport', { text, policy }), adopt: options => transfer('routineFileAdopt', { options }),
    deleteDraft: id => transfer('routineFileDelete', { id }),
    start: id => send('startRoutine', { id })
  });
  function syncHandoffGate(enabled) {
    const section = $('handoff-pairing');
    const body = $('handoff-body');
    const active = enabled === true && Boolean(body && typeof HandoffUI !== 'undefined');
    if (section) {
      section.hidden = !active;
      if (!active) section.open = false;
    }
    if (active) {
      if (!window.handoffUI) {
        window.handoffUI = HandoffUI.mount(body, {
          platform: 'android',
          invoke: (operation, options) => transfer('handoff', { operation, options }),
          scan: () => transfer('handoff', { operation: 'scan', options: {} }),
          onImported: () => void window.phoneTransfer?.refresh()
        });
      }
    } else if (window.handoffUI) {
      window.handoffUI.destroy();
      window.handoffUI = null;
      if (body) {
        body.classList.remove('handoff-panel');
        body.replaceChildren();
      }
    }
  }
  syncHandoffGate(false);
  window.phoneLightUI = PhoneLightUI.mount($('light-experience-body'), (operation, data = {}) => transfer('lightExperience', { operation, ...data }));
  renderLightCards(); resetRoutine(); resetRule(); renderFirstLight(null, false); calendar(); tab(view);
})();
