// Renderer: Calendar Provider feature (built-in schedule, iCal/Google/Outlook/
// Calendly config, event fetch/render, .ics file/URL import). Loaded as a
// classic sibling <script>, after renderer-utils.js/renderer-profiles.js and
// before renderer.js — uses `state`/`els`/`api`/`notify`/`escapeHtml` from
// earlier scripts; setupCalendarHandlers() is invoked from renderer.js's
// bootstrap sequence at the bottom of that file.
//
// `calEvents`/`calNextEvent` are declared here (not in renderer.js) so they
// are fully initialized before renderer.js's bootstrap ever runs. Previously
// both lived in renderer.js itself, declared *after* the bootstrap sequence
// that (via wireEvents() -> setupCalendarHandlers() -> fetchAndRenderEvents())
// read them at top-level script-execution time, which threw a
// "Cannot access before initialization" TDZ error on every first load — that
// pre-existing bug is fixed as a side effect of this split.
let calEvents = [];
let calNextEvent = null;

function showCalendarLoading() {
  if (els.calendarEvents) {
    els.calendarEvents.innerHTML = '<div class="calendar-loading">Loading calendar...</div>';
  }
}

function showCalendarError(message) {
  if (els.calendarEvents) {
    els.calendarEvents.innerHTML = `<div class="calendar-error">${escapeHtml(message)}</div>`;
  }
}

async function importCalendarFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.name.endsWith('.ics')) {
    notify('Please select an .ics calendar file', 'warning');
    return;
  }

  showCalendarLoading();

  try {
    const text = await file.text();
    const result = await api.calendarParseText(text);

    if (result.success) {
      state.calendarEvents = result.events || [];
      state.calendarSource = result.source || file.name;
      notify(`${result.count} events imported from ${file.name}`, 'success');
      renderCalendarEvents();
    } else {
      notify(result.error || 'Failed to import calendar', 'error');
      showCalendarError(result.error || 'Import failed');
    }
  } catch (error) {
    notify(`Import failed: ${error.message}`, 'error');
    showCalendarError(error.message);
  }

  // Reset file input
  event.target.value = '';
}

async function importCalendarUrl() {
  const url = els.calendarUrlInput?.value?.trim();
  if (!url) {
    notify('Enter a calendar URL', 'warning');
    return;
  }

  const isValid = await api.calendarTestUrl(url);
  if (!isValid) {
    notify('URL must start with https://', 'warning');
    return;
  }

  showCalendarLoading();

  try {
    const result = await api.calendarImportUrl(url);

    if (result.success) {
      state.calendarEvents = result.events || [];
      state.calendarSource = result.source || url;
      notify(`${result.count} events imported from calendar`, 'success');
      renderCalendarEvents();
      if (els.calendarUrlInput) els.calendarUrlInput.value = '';
    } else {
      notify(result.error || 'Failed to fetch calendar', 'error');
      showCalendarError(result.error || 'Fetch failed');
    }
  } catch (error) {
    notify(`Import failed: ${error.message}`, 'error');
    showCalendarError(error.message);
  }
}

function setupCalendarHandlers() {
  // Provider selector: show/hide config panels.
  els.selCalendarProvider?.addEventListener('change', () => {
    const provider = els.selCalendarProvider.value;
    const configs = ['builtin', 'ical', 'google', 'outlook', 'calendly'];
    configs.forEach(id => {
      const panel = document.getElementById(`cal-cfg-${id}`);
      if (panel) panel.style.display = id === provider ? 'block' : 'none';
    });
    saveCalendarConfig();
  });

  els.calAutoStart?.addEventListener('change', saveCalendarConfig);
  setupScheduleRuleHandlers();

  // Provider input changes.
  [els.calIcalUrl, els.calGoogleApikey, els.calGoogleCalid, els.calOutlookToken, els.calCalendlyToken].forEach(el => {
    el?.addEventListener('change', saveCalendarConfig);
  });

  // Fetch buttons.
  els.btnCalIcalFetch?.addEventListener('click', () => fetchAndRenderEvents());
  els.btnCalGoogleFetch?.addEventListener('click', () => fetchAndRenderEvents());
  els.btnCalOutlookFetch?.addEventListener('click', () => fetchAndRenderEvents());
  els.btnCalCalendlyFetch?.addEventListener('click', () => fetchAndRenderEvents());

  // Load initial config.
  loadCalendarConfig();
  fetchAndRenderEvents();
}

async function loadCalendarConfig() {
  try {
    const cal = await api.getCalendarSettings();
    if (!cal) return;
    if (els.selCalendarProvider) els.selCalendarProvider.value = cal.provider || 'builtin';
    if (els.calAutoStart) els.calAutoStart.checked = cal.autoStartFromEvents || false;
    if (els.calIcalUrl) els.calIcalUrl.value = cal.ical?.url || '';
    if (els.calGoogleApikey) els.calGoogleApikey.value = cal.google?.apiKey || '';
    if (els.calGoogleCalid) els.calGoogleCalid.value = cal.google?.calendarId || '';
    if (els.calOutlookToken) els.calOutlookToken.value = cal.outlook?.accessToken || '';
    if (els.calCalendlyToken) els.calCalendlyToken.value = cal.calendly?.personalToken || '';
    scheduleRules = Array.isArray(cal.builtin?.rules) ? cal.builtin.rules : [];
    renderScheduleRules();
    // Show the active provider config.
    els.selCalendarProvider?.dispatchEvent(new Event('change'));
  } catch (e) {
    console.error('Failed to load calendar config:', e);
  }
}

// Saves everything EXCEPT builtin.rules, which is mutated + persisted directly
// by persistScheduleRules() -- this function's config object omits that key so
// the deep-merge in settings.js's updateSection() leaves the rule list alone
// (see settings.js deepMerge: a key absent from the patch is never touched).
async function saveCalendarConfig() {
  const config = {
    enabled: true,
    provider: els.selCalendarProvider?.value || 'builtin',
    autoStartFromEvents: els.calAutoStart?.checked || false,
    ical: { url: els.calIcalUrl?.value || '' },
    google: { apiKey: els.calGoogleApikey?.value || '', calendarId: els.calGoogleCalid?.value || '' },
    outlook: { accessToken: els.calOutlookToken?.value || '' },
    calendly: { personalToken: els.calCalendlyToken?.value || '' }
  };
  await api.saveCalendarSettings(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in schedule: multiple independent recurring rules (label, time, active
// days, action). Each rule becomes a synthesized calendar event per matching
// day via calendarProviders.getDefaultCalendarEvents on the main-process side.
// ─────────────────────────────────────────────────────────────────────────────

let scheduleRules = [];
let editingRuleId = null; // null while the form is closed or adding; a rule id while editing

const SCHEDULE_ACTION_LABELS = { shutdown: 'Shutdown', sleep: 'Sleep', hibernate: 'Hibernate' };
const SCHEDULE_DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SCHEDULE_DAY_LABELS = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

function formatRuleTime(time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatRuleDays(days) {
  return SCHEDULE_DAY_ORDER.filter(d => (days || []).includes(d)).map(d => SCHEDULE_DAY_LABELS[d]).join('/');
}

function renderScheduleRules() {
  const list = document.getElementById('schedule-rules-list');
  if (!list) return;
  if (!scheduleRules.length) {
    list.innerHTML = '<div class="schedule-rules-empty">No scheduled rules yet. Add one to auto-trigger a timer at a specific time.</div>';
    return;
  }
  list.innerHTML = scheduleRules.map(rule => `
    <div class="schedule-rule-item ${rule.enabled === false ? 'disabled' : ''}" data-rule-id="${escapeHtml(rule.id)}">
      <div class="schedule-rule-info">
        <div class="schedule-rule-label">${escapeHtml(rule.label || 'Untitled')}</div>
        <div class="schedule-rule-detail">${formatRuleTime(rule.time)} &middot; ${formatRuleDays(rule.days) || 'no days'} &middot; ${SCHEDULE_ACTION_LABELS[rule.action] || rule.action}</div>
      </div>
      <div class="schedule-rule-actions">
        <input type="checkbox" class="rule-enabled-toggle" data-rule-id="${escapeHtml(rule.id)}" title="Enabled" ${rule.enabled === false ? '' : 'checked'}>
        <button class="profile-item-btn rule-edit-btn" data-rule-id="${escapeHtml(rule.id)}" type="button">Edit</button>
        <button class="profile-item-btn rule-delete-btn" data-rule-id="${escapeHtml(rule.id)}" type="button">Delete</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.rule-enabled-toggle').forEach(input => {
    input.addEventListener('change', () => {
      const rule = scheduleRules.find(r => r.id === input.dataset.ruleId);
      if (rule) { rule.enabled = input.checked; persistScheduleRules(); }
    });
  });
  list.querySelectorAll('.rule-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openRuleForm(btn.dataset.ruleId));
  });
  list.querySelectorAll('.rule-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      scheduleRules = scheduleRules.filter(r => r.id !== btn.dataset.ruleId);
      persistScheduleRules();
    });
  });
}

// Persists the in-memory rule list as a targeted patch (builtin.rules only),
// re-renders the list, and refreshes the upcoming-events view so the Schedule
// tab immediately reflects what will actually fire.
function persistScheduleRules() {
  renderScheduleRules();
  api.saveCalendarSettings({ builtin: { rules: scheduleRules } });
  fetchAndRenderEvents();
}

function openRuleForm(ruleId) {
  const form = document.getElementById('schedule-rule-form');
  if (!form) return;
  editingRuleId = ruleId || null;
  const rule = ruleId ? scheduleRules.find(r => r.id === ruleId) : null;
  const labelEl = document.getElementById('rule-label');
  const timeEl = document.getElementById('rule-time');
  const durationEl = document.getElementById('rule-duration');
  const actionEl = document.getElementById('rule-action');
  if (labelEl) labelEl.value = rule?.label || '';
  if (timeEl) timeEl.value = rule?.time || '22:30';
  if (durationEl) durationEl.value = rule?.durationMinutes || 60;
  if (actionEl) actionEl.value = rule?.action || 'shutdown';
  const days = rule?.days || ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  document.querySelectorAll('#rule-days .day-toggle').forEach(btn => {
    btn.classList.toggle('active', days.includes(btn.dataset.day));
  });
  form.style.display = '';
  labelEl?.focus();
}

function closeRuleForm() {
  const form = document.getElementById('schedule-rule-form');
  if (form) form.style.display = 'none';
  editingRuleId = null;
}

function saveRuleFromForm() {
  const label = document.getElementById('rule-label')?.value?.trim() || 'Untitled';
  const time = document.getElementById('rule-time')?.value || '22:30';
  const durationMinutes = Math.max(1, Math.min(1440, parseInt(document.getElementById('rule-duration')?.value, 10) || 60));
  const action = document.getElementById('rule-action')?.value || 'shutdown';
  const days = [...document.querySelectorAll('#rule-days .day-toggle.active')].map(b => b.dataset.day);
  if (!days.length) { notify('Pick at least one active day', 'warning'); return; }

  if (editingRuleId) {
    const rule = scheduleRules.find(r => r.id === editingRuleId);
    if (rule) Object.assign(rule, { label, time, durationMinutes, action, days });
  } else {
    scheduleRules.push({
      id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label, time, durationMinutes, action, days, enabled: true
    });
  }
  closeRuleForm();
  persistScheduleRules();
  notify(`Schedule rule "${label}" saved`, 'success');
}

function setupScheduleRuleHandlers() {
  document.getElementById('btn-add-schedule-rule')?.addEventListener('click', () => openRuleForm(null));
  document.getElementById('btn-cancel-rule')?.addEventListener('click', closeRuleForm);
  document.getElementById('btn-save-rule')?.addEventListener('click', saveRuleFromForm);
  document.querySelectorAll('#rule-days .day-toggle').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });
}

async function fetchAndRenderEvents() {
  try {
    calEvents = await api.fetchCalendarEvents(14);
    renderCalendarEvents();
  } catch (e) {
    console.error('Failed to fetch calendar events:', e);
  }
}

function renderCalendarEvents() {
  if (!els.calendarEvents) return;
  const now = new Date();
  const upcoming = calEvents.filter(e => new Date(e.start) > now).slice(0, 10);

  if (!upcoming.length) {
    els.calendarEvents.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:8px">No upcoming events found.</div>';
    if (els.schNextBedtime) els.schNextBedtime.textContent = 'No bedtime rule set';
    return;
  }

  calNextEvent = upcoming[0];

  // Phase 5I-D: "Start" used to appear on every listed occurrence, up to 10
  // days out -- clicking it doesn't schedule anything, it starts a real,
  // live countdown right now for however long until that occurrence (see
  // the click handler below), so clicking "Start" on a 2-day-out entry
  // silently began a ~48-hour countdown. Restricted to the nearest/next
  // occurrence only, where "start this early instead of waiting" is an
  // actual sensible action -- the built-in schedule already auto-starts
  // itself near the real time regardless (main.js), so this button was
  // always just "start it early," never "activate this future rule."
  els.calendarEvents.innerHTML = upcoming.map((e, index) => {
    const start = new Date(e.start);
    const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const dateStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const sourceIcons = { builtin: '\u{1F4C5}', ical: '\u{1F5D3}', google: '\u{1F4E7}', outlook: '\u{1F4E9}', calendly: '\u{1F517}' };
    const startBtn = index === 0
      ? `<button class="btn-secondary btn-sm event-start-btn" data-uid="${escapeHtml(e.uid)}" title="Start this now instead of waiting">Start</button>`
      : '';
    return `<div class="calendar-event" data-uid="${escapeHtml(e.uid)}">
      <div class="event-info">
        <div class="event-name">${escapeHtml(e.summary)}</div>
        <div class="event-meta">${dateStr} at ${timeStr} ${sourceIcons[e.source] || ''}</div>
      </div>
      ${startBtn}
    </div>`;
  }).join('');

  // Start button handlers.
  els.calendarEvents.querySelectorAll('.event-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const evt = calEvents.find(e => e.uid === btn.dataset.uid);
      if (evt) {
        const diffSec = Math.max(0, Math.round((new Date(evt.start) - new Date()) / 1000));
        if (diffSec > 0) {
          api.startTimer({ durationSeconds: diffSec, action: evt.action || 'shutdown' });
          notify(`Timer set for ${evt.summary}`, 'success');
        }
      }
    });
  });

  // Schedule header "Next tonight" summary -- same real next-event data,
  // just mirrored into the always-visible header above the sub-tabs.
  if (els.schNextBedtime && calNextEvent) {
    const start2 = new Date(calNextEvent.start);
    const isToday2 = start2.toDateString() === now.toDateString();
    const isTomorrow2 = new Date(now.getTime() + 86400000).toDateString() === start2.toDateString();
    const timeStr2 = start2.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const when2 = isToday2 ? `today at ${timeStr2}` : isTomorrow2 ? `tomorrow at ${timeStr2}` : `${start2.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr2}`;
    els.schNextBedtime.textContent = `${calNextEvent.summary} \u2014 ${when2}`;
  }
}
/* exported importCalendarFile, importCalendarUrl, setupCalendarHandlers */
