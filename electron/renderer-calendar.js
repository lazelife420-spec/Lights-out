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

  // Day toggle buttons.
  document.querySelectorAll('.day-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      saveCalendarConfig();
    });
  });

  // Built-in changes.
  els.calBuiltinBedtime?.addEventListener('change', saveCalendarConfig);
  els.calBuiltinAction?.addEventListener('change', saveCalendarConfig);
  els.calAutoStart?.addEventListener('change', saveCalendarConfig);

  // Provider input changes.
  [els.calIcalUrl, els.calGoogleApikey, els.calGoogleCalid, els.calOutlookToken, els.calCalendlyToken].forEach(el => {
    el?.addEventListener('change', saveCalendarConfig);
  });

  // Fetch buttons.
  els.btnCalIcalFetch?.addEventListener('click', () => fetchAndRenderEvents());
  els.btnCalGoogleFetch?.addEventListener('click', () => fetchAndRenderEvents());
  els.btnCalOutlookFetch?.addEventListener('click', () => fetchAndRenderEvents());
  els.btnCalCalendlyFetch?.addEventListener('click', () => fetchAndRenderEvents());

  // Start from event.
  els.btnStartFromEvent?.addEventListener('click', () => {
    if (calNextEvent) {
      const now = new Date();
      const evtStart = new Date(calNextEvent.start);
      const diffSec = Math.max(0, Math.round((evtStart - now) / 1000));
      if (diffSec > 0) {
        api.startTimer({ durationSeconds: diffSec, action: calNextEvent.action || 'shutdown' });
        notify(`Timer set for ${calNextEvent.summary}`, 'success');
      } else {
        notify('Event has already passed', 'warning');
      }
    }
  });

  // Load initial config.
  loadCalendarConfig();
  fetchAndRenderEvents();
}

async function loadCalendarConfig() {
  try {
    const cal = await api.getCalendarSettings();
    if (!cal) return;
    if (els.selCalendarProvider) els.selCalendarProvider.value = cal.provider || 'builtin';
    if (els.calBuiltinBedtime) els.calBuiltinBedtime.value = cal.builtin?.bedtime || '22:30';
    if (els.calBuiltinAction) els.calBuiltinAction.value = cal.builtin?.action || 'shutdown';
    if (els.calAutoStart) els.calAutoStart.checked = cal.autoStartFromEvents || false;
    if (els.calIcalUrl) els.calIcalUrl.value = cal.ical?.url || '';
    if (els.calGoogleApikey) els.calGoogleApikey.value = cal.google?.apiKey || '';
    if (els.calGoogleCalid) els.calGoogleCalid.value = cal.google?.calendarId || '';
    if (els.calOutlookToken) els.calOutlookToken.value = cal.outlook?.accessToken || '';
    if (els.calCalendlyToken) els.calCalendlyToken.value = cal.calendly?.personalToken || '';
    // Day toggles.
    const days = cal.builtin?.days || ['sun','mon','tue','wed','thu','fri','sat'];
    document.querySelectorAll('.day-toggle').forEach(btn => {
      btn.classList.toggle('active', days.includes(btn.dataset.day));
    });
    // Show the active provider config.
    els.selCalendarProvider?.dispatchEvent(new Event('change'));
  } catch (e) {
    console.error('Failed to load calendar config:', e);
  }
}

async function saveCalendarConfig() {
  const days = [...document.querySelectorAll('.day-toggle.active')].map(b => b.dataset.day);
  const config = {
    enabled: true,
    provider: els.selCalendarProvider?.value || 'builtin',
    autoStartFromEvents: els.calAutoStart?.checked || false,
    builtin: {
      enabled: true,
      bedtime: els.calBuiltinBedtime?.value || '22:30',
      days,
      action: els.calBuiltinAction?.value || 'shutdown'
    },
    ical: { url: els.calIcalUrl?.value || '' },
    google: { apiKey: els.calGoogleApikey?.value || '', calendarId: els.calGoogleCalid?.value || '' },
    outlook: { accessToken: els.calOutlookToken?.value || '' },
    calendly: { personalToken: els.calCalendlyToken?.value || '' }
  };
  await api.saveCalendarSettings(config);
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
    if (els.nextEventCard) els.nextEventCard.style.display = 'none';
    return;
  }

  calNextEvent = upcoming[0];

  els.calendarEvents.innerHTML = upcoming.map(e => {
    const start = new Date(e.start);
    const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const dateStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const sourceIcons = { builtin: '\u{1F4C5}', ical: '\u{1F5D3}', google: '\u{1F4E7}', outlook: '\u{1F4E9}', calendly: '\u{1F517}' };
    return `<div class="calendar-event" data-uid="${escapeHtml(e.uid)}">
      <div class="event-info">
        <div class="event-name">${escapeHtml(e.summary)}</div>
        <div class="event-meta">${dateStr} at ${timeStr} ${sourceIcons[e.source] || ''}</div>
      </div>
      <button class="btn-secondary btn-sm event-start-btn" data-uid="${escapeHtml(e.uid)}">Start</button>
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

  // Next event card.
  if (els.nextEventCard && calNextEvent) {
    els.nextEventCard.style.display = '';
    const start = new Date(calNextEvent.start);
    if (els.nextEventName) els.nextEventName.textContent = calNextEvent.summary;
    if (els.nextEventTime) {
      const isToday = start.toDateString() === now.toDateString();
      const isTomorrow = new Date(now.getTime() + 86400000).toDateString() === start.toDateString();
      const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      if (isToday) els.nextEventTime.textContent = `Today at ${timeStr}`;
      else if (isTomorrow) els.nextEventTime.textContent = `Tomorrow at ${timeStr}`;
      else els.nextEventTime.textContent = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`;
    }
  }
}
