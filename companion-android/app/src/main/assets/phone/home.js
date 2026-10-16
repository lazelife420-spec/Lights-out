'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let config = { lights: [], routines: [], rules: [] }, configKey = '', upcoming = [], nextKey = '';
  let routineId = '', ruleId = '', view = 'timer';
  let month = new Date(); month = new Date(month.getFullYear(), month.getMonth(), 1);
  const error = text => window.phoneUI.error(text);
  const send = (action, data = {}) => {
    $('error').hidden = true;
    if (!window.phoneNative) return error('Phone controls are not ready. Reopen Lights Out.');
    window.phoneNative.postMessage(JSON.stringify({ action, ...data }));
  };
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const button = (text, fn, cls = 'secondary') => { const node = el('button', text, cls); node.type = 'button'; node.onclick = fn; return node; };
  const checked = id => [...$(id).querySelectorAll('input:checked')].map(n => n.value);
  function choices(id, values, selected) {
    $(id).replaceChildren(...values.map(([value, name]) => {
      const label = el('label', undefined, 'check'); const input = el('input'); input.type = 'checkbox'; input.value = value; input.checked = selected.includes(String(value));
      label.append(input, document.createTextNode(name)); return label;
    }));
  }
  function tab(name) {
    view = name;
    ['timer', 'lighting', 'routines', 'calendar'].forEach(value => { $('view-' + value).hidden = name !== value; });
    document.querySelectorAll('[data-tab]').forEach(node => { if (node.dataset.tab === name) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
  }
  document.querySelectorAll('[data-tab]').forEach(node => { node.onclick = () => tab(node.dataset.tab); });
  function resetRoutine(p = {}) {
    routineId = p.id || ''; $('routine-editor-title').textContent = p.id ? 'Edit routine' : 'New routine';
    $('routine-name').value = p.name || ''; $('routine-minutes').value = p.seconds ? p.seconds / 60 : 30;
    $('routine-warm').checked = Boolean(p.brightness); $('routine-off').checked = Boolean(p.offAtEnd); $('routine-brightness').value = p.brightness || 30;
    choices('routine-light-options', config.lights.map(ip => [ip, ip]), p.targets || []);
  }
  function fields() { const kind = $('rule-kind').value; $('week-field').hidden = kind !== 'weekly'; $('month-field').hidden = kind !== 'monthly'; $('date-field').hidden = kind !== 'once'; $('rule-date').required = kind === 'once'; }
  function resetRule(p = {}) {
    ruleId = p.id || ''; $('rule-editor-title').textContent = p.id ? 'Edit calendar rule' : 'New calendar rule';
    $('rule-routine').value = p.routineId || config.routines[0]?.id || ''; $('rule-kind').value = p.kind || 'weekly'; $('rule-time').value = p.time || '22:00';
    $('rule-date').value = p.date || ''; $('rule-days').value = (p.monthDays || [1]).map(v => v === -1 ? 'last' : v).join(', '); $('rule-enabled').checked = p.enabled !== false;
    choices('weekday-options', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => [i + 1, n]), (p.weekdays || [1, 2, 3, 4, 5]).map(String));
    choices('month-options', Array.from({ length: 12 }, (_, i) => [i + 1, new Date(2026, i, 1).toLocaleDateString([], { month: 'short' })]), (p.months || Array.from({ length: 12 }, (_, i) => i + 1)).map(String)); fields();
  }
  function cards() {
    $('routine-list').replaceChildren(...config.routines.map(p => {
      const card = el('article', undefined, 'item'); card.append(el('h2', p.name), el('p', `${p.seconds / 60} min${p.brightness ? ' · warm start' : ''}${p.offAtEnd ? ' · lights off at finish' : ''}`));
      const actions = el('div', undefined, 'button-row'); actions.append(button('Start', () => { send('startRoutine', { id: p.id }); tab('timer'); }), button('Edit', () => resetRoutine(p)), button('Delete', () => send('deleteRoutine', { id: p.id }), 'text-button'));
      card.append(actions); return card;
    }));
    if (!config.routines.length) $('routine-list').append(el('p', 'Save your first routine below.', 'empty-copy'));
    const selected = $('rule-routine').value;
    $('rule-routine').replaceChildren(...config.routines.map(p => { const option = el('option', p.name); option.value = p.id; return option; }));
    if (config.routines.some(p => p.id === selected)) $('rule-routine').value = selected;
    $('rule-list').replaceChildren(...config.rules.map(r => {
      const card = el('article', undefined, 'item'); const p = config.routines.find(p => p.id === r.routineId); const next = upcoming.find(n => n.id === r.id)?.next;
      card.append(el('h2', p?.name || 'Missing routine'), el('p', `${r.enabled === false ? 'Paused · ' : ''}${r.kind === 'once' ? r.date : r.kind === 'monthly' ? 'Monthly' : 'Weekly'} · ${r.time}`));
      card.append(el('small', r.enabled === false ? 'This rule is disabled.' : next ? 'Next ' + new Date(next).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No future date matches.'));
      const actions = el('div', undefined, 'button-row'); actions.append(button('Edit', () => resetRule(r)), button('Delete', () => send('deleteRule', { id: r.id }), 'text-button')); card.append(actions); return card;
    }));
  }
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function matches(r, d) {
    if (r.enabled === false) return false;
    if (r.kind === 'once') return r.date === dateKey(d);
    if (r.kind === 'weekly') return (r.weekdays || []).includes(d.getDay() || 7);
    return (r.months || []).includes(d.getMonth() + 1) && ((r.monthDays || []).includes(d.getDate()) || ((r.monthDays || []).includes(-1) && new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate()));
  }
  function calendar() {
    $('calendar-month').textContent = month.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const offset = (month.getDay() + 6) % 7, today = dateKey(new Date());
    $('month-grid').replaceChildren(...Array.from({ length: 42 }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), i - offset + 1); const scheduled = config.rules.some(r => matches(r, d));
      const node = button(String(d.getDate()) + (scheduled ? ' ✦' : ''), () => { resetRule({ kind: 'once', date: dateKey(d) }); $('rule-form').scrollIntoView({ block: 'start' }); }, 'day');
      node.classList.toggle('outside', d.getMonth() !== month.getMonth()); node.classList.toggle('today', dateKey(d) === today); node.setAttribute('aria-label', d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + (scheduled ? ', routine scheduled' : '')); return node;
    }));
  }
  $('month-prev').onclick = () => { if (month.getFullYear() > 2000 || month.getMonth() > 0) { month.setMonth(month.getMonth() - 1); calendar(); } };
  $('month-next').onclick = () => { if (month.getFullYear() < 2199 || month.getMonth() < 11) { month.setMonth(month.getMonth() + 1); calendar(); } };
  $('rule-kind').onchange = fields; $('new-routine').onclick = () => resetRoutine(); $('new-rule').onclick = () => resetRule();
  $('save-lights').onclick = () => send('saveLights', { targets: $('light-ips').value.split(/[\s,]+/).filter(Boolean) });
  $('discover-lights').onclick = () => send('discoverLights');
  ['status', 'on', 'off', 'warm'].forEach(command => { $('light-' + command).onclick = () => send('lightCommand', { command, targets: config.lights, brightness: Number($('light-brightness').value) }); });
  $('light-brightness').oninput = () => { $('brightness-value').textContent = $('light-brightness').value + '%'; };
  $('routine-form').onsubmit = event => {
    event.preventDefault(); const minutes = Number($('routine-minutes').value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return error('Choose 1 minute to 24 hours.');
    const useLights = $('routine-warm').checked || $('routine-off').checked;
    send('saveRoutine', { routine: { id: routineId, name: $('routine-name').value.trim(), seconds: minutes * 60, targets: useLights ? checked('routine-light-options') : [], brightness: $('routine-warm').checked ? Number($('routine-brightness').value) : 0, offAtEnd: $('routine-off').checked } });
  };
  $('rule-form').onsubmit = event => {
    event.preventDefault(); const tokens = $('rule-days').value.split(',').map(s => s.trim().toLowerCase());
    if ($('rule-kind').value === 'monthly' && tokens.some(s => s !== 'last' && !/^(?:[1-9]|[12][0-9]|3[01])$/.test(s))) return error('Use days 1–31 or “last”, separated by commas.');
    send('saveRule', { rule: { id: ruleId, routineId: $('rule-routine').value, kind: $('rule-kind').value, time: $('rule-time').value, weekdays: checked('weekday-options').map(Number), monthDays: tokens.map(s => s === 'last' ? -1 : Number(s)), months: checked('month-options').map(Number), date: $('rule-kind').value === 'once' ? $('rule-date').value : '', enabled: $('rule-enabled').checked } });
  };
  window.phoneHome = {
    saved(action) { if (action === 'saveRoutine' || action === 'deleteRoutine') resetRoutine(); if (action === 'saveRule' || action === 'deleteRule') resetRule(); },
    update(state) {
      const key = JSON.stringify(state.home || {}), nk = JSON.stringify(state.upcoming || []);
      upcoming = state.upcoming || [];
      if (key !== configKey) {
        configKey = key; config = { lights: [], routines: [], rules: [], ...state.home };
        $('light-ips').value = config.lights.join('\n'); $('light-count').textContent = config.lights.length ? `${config.lights.length} saved light(s) · commands apply to all` : 'No saved lights yet.';
        const previous = checked('routine-light-options'); choices('routine-light-options', config.lights.map(ip => [ip, ip]), previous);
        cards(); calendar();
      } else if (nk !== nextKey) cards();
      nextKey = nk;
      $('calendar-readiness').textContent = state.exact ? "Ready to run on this phone, even with the PC off. Lights need the same Wi-Fi. Keep the phone powered on." : 'Saved routines are paused. Allow precise alerts below so Android can start them with the screen off.';
      $('phone-event').textContent = state.event || ''; $('phone-event').hidden = !state.event;
      $('light-result').textContent = state.event || '';
    }
  };
  resetRoutine(); resetRule(); calendar(); tab(view);
})();
