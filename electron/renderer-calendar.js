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
// The built-in schedule's default action, as loaded from settings (used when
// an event carries no action of its own, same order as main's auto-start).
let calBuiltinAction = null;

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

// ─────────────────────────────────────────────────────────────────────────────
// Schedule page (UI-R3 P10): one scrolling page. Every fact below is read from
// the persisted calendar settings and main's own event list (which carries
// main's auto-start rule as autoStartEligible); nothing is guessed.
// ─────────────────────────────────────────────────────────────────────────────

// Persisted arm state (calendar.enabled && calendar.autoStartFromEvents), as
// last loaded from or acknowledged by main. Both switches (Schedule's
// #cal-auto-start and Settings' #chk-calendar-autostart) mirror this value.
let calConfigEnabled = true;
let calAutoStartArmed = false;
let calScheduleClock = null;
let calTruthKey = '';
// The provider panel the user picked this session (null until they pick one),
// so a return to Schedule never snaps the select back to a stale saved value.
let calProviderChoice = null;
// When main's event list was last fetched. Entering Schedule refetches only
// when this is older than CAL_REFETCH_MS (external providers are network).
let calLastFetchAt = 0;
const CAL_REFETCH_MS = 5 * 60000;
const CAL_EXTERNAL_PROVIDERS = ['ical', 'google', 'outlook', 'calendly'];
// Fire 09: what main recorded for the last Schedule fetch, per provider, and
// the pending provider-field save a Check press waits for.
let calFetchStatus = {};
let calConfigSaving = Promise.resolve();
const CAL_STATUS_WINDOW_DAYS = 14;

function calendarArmed() {
  return Boolean(calConfigEnabled && calAutoStartArmed);
}

// An event main would auto-start: a built-in rule, or an imported event that
// passes main's bedtime-title rule. Unknown (no field) is never eligible.
function isAutoStartEligible(evt) {
  return Boolean(evt) && (evt.source === 'builtin' || evt.autoStartEligible === true);
}

function eventEnd(evt) {
  const start = new Date(evt.start);
  return evt.end ? new Date(evt.end) : new Date(start.getTime() + 3600000);
}

// The user's clock format (Settings › Appearance), split for the hero numerals.
function schClockParts(date) {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  if (state.clockFormat !== '12h') return { hm: `${String(date.getHours()).padStart(2, '0')}:${minutes}`, ampm: '' };
  return { hm: `${date.getHours() % 12 || 12}:${minutes}`, ampm: date.getHours() >= 12 ? 'PM' : 'AM' };
}

function schClock(date) {
  const p = schClockParts(date);
  return p.ampm ? `${p.hm} ${p.ampm}` : p.hm;
}

// Pure: "HH:MM" + minutes, wrapping past midnight (a fractional minute is
// floored, as a clock shows it). Returns { time, nextDay, dayOffset }.
function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const start = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  const total = Math.floor(start + (Number(minutes) || 0));
  const wrapped = ((total % 1440) + 1440) % 1440;
  const dayOffset = Math.floor(total / 1440);
  return {
    time: `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`,
    nextDay: total >= 1440,
    dayOffset
  };
}

// A rule's event length exactly as main builds it
// (calendarProviders.getDefaultCalendarEvents: Math.max(1, Number(d) || 60)).
function ruleEventMinutes(value) {
  return Math.max(1, Number(value) || 60);
}

// How long an auto-started run really counts down: checkCalendarAutoStart in
// main never starts a countdown shorter than 300 s.
const CAL_AUTOSTART_MIN_MINUTES = 5;
function ruleCountdownMinutes(value) {
  return Math.max(CAL_AUTOSTART_MIN_MINUTES, ruleEventMinutes(value));
}

function schClockFromHHMM(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return schClock(d);
}

function schDayLabel(date, now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (date.toDateString() === now.toDateString()) return date.getHours() >= 17 ? 'Tonight' : 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function schDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!h) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function setCalText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

// What the enabled rules end with, for the arm hint ("Real shutdown at the end").
function rulesActionPhrase() {
  const actions = [...new Set(scheduleRules.filter(r => r && r.enabled !== false).map(r => r.action || calBuiltinAction || 'shutdown'))];
  return actions.length === 1 ? actionLabel(actions[0]).toLowerCase() : 'power action';
}

function setupCalendarHandlers() {
  // The provider select only switches the external provider panels; built-in
  // rules always show in #sch-rules (they used to hide behind this select
  // while they kept firing).
  // The choice is kept for the session (never written back), so a return to
  // Schedule does not snap the select to a stale saved value.
  els.selCalendarProvider?.addEventListener('change', () => {
    calProviderChoice = els.selCalendarProvider.value;
    showProviderPanel(calProviderChoice);
  });

  els.calAutoStart?.addEventListener('change', () => { void setScheduleAutoStart(els.calAutoStart.checked); });
  setupScheduleRuleHandlers();

  // Provider input changes. The save is kept as a promise so a Check click
  // (which fires right after the field's change) fetches the value just typed.
  [els.calIcalUrl, els.calGoogleApikey, els.calGoogleCalid, els.calOutlookToken, els.calCalendlyToken].forEach(el => {
    el?.addEventListener('change', queueCalendarConfigSave);
  });

  // Check buttons (Fire 09): 'Checking…', then whether each feed was reached.
  [els.btnCalIcalFetch, els.btnCalGoogleFetch, els.btnCalOutlookFetch, els.btnCalCalendlyFetch].forEach(btn => {
    btn?.addEventListener('click', () => { void checkCalendarFeeds(btn); });
  });

  // The hero's Start is the single manual Schedule start. On success, Tonight
  // shows the live ring.
  els.btnStartFromEvent?.addEventListener('click', async () => {
    if (!calNextEvent) return;
    const started = await startFromScheduleEvent(calNextEvent);
    if (started && typeof handleSidebarNavigation === 'function') handleSidebarNavigation('lib');
  });

  // Load initial config.
  loadCalendarConfig();
  fetchAndRenderEvents();
}

function showProviderPanel(provider) {
  const active = CAL_EXTERNAL_PROVIDERS.includes(provider) ? provider : 'ical';
  CAL_EXTERNAL_PROVIDERS.forEach(id => {
    const panel = document.getElementById(`cal-cfg-${id}`);
    if (panel) panel.style.display = id === active ? '' : 'none';
  });
  if (els.selCalendarProvider && els.selCalendarProvider.value !== active) els.selCalendarProvider.value = active;
}

// Which external panel to show on load: the user's pick this session, else
// the saved provider when it has a URL or credentials, else the first
// provider that does, else the saved provider (iCal for a legacy 'builtin').
// Only truthiness is checked; no value is read out or displayed.
function initialProviderPanel(cal) {
  if (calProviderChoice) return calProviderChoice;
  const configured = {
    ical: Boolean(cal?.ical?.url),
    google: Boolean(cal?.google?.apiKey || cal?.google?.calendarId),
    outlook: Boolean(cal?.outlook?.accessToken),
    calendly: Boolean(cal?.calendly?.personalToken)
  };
  const saved = CAL_EXTERNAL_PROVIDERS.includes(cal?.provider) ? cal.provider : null;
  if (saved && configured[saved]) return saved;
  return CAL_EXTERNAL_PROVIDERS.find(id => configured[id]) || saved || 'ical';
}

// The one Schedule "Start" path. It counts down to the rule's action time
// (the event end), exactly like calendar auto-start in main, honors Test Mode,
// and only announces a start that really happened. Resolves true on a start.
async function startFromScheduleEvent(evt) {
  if (!evt) return false;
  if (!state.settingsLoaded) { notify('Loading your settings…', 'info'); return false; }
  if (state.running || state.paused) { notify('A run is already active. Pause or cancel it first.', 'warning'); return false; }
  const start = new Date(evt.start);
  const end = evt.end ? new Date(evt.end) : new Date(start.getTime() + 3600000);
  const ms = end - Date.now();
  if (!(ms > 60000)) { notify('That bedtime has already passed', 'warning'); return false; }
  // Same cap the Tonight timer input enforces (its max, in minutes).
  const capMinutes = Number(els.timerInput?.max);
  if (!Number.isFinite(capMinutes) || ms > capMinutes * 60000) {
    notify(`That bedtime is more than ${Number.isFinite(capMinutes) ? capMinutes / 60 : 'a few'} hours away. Start it closer to bedtime.`, 'warning');
    return false;
  }
  const action = evt.action || calBuiltinAction || 'shutdown';
  const profile = evt.profileId ? (state.profiles || []).find(profile => profile.id === evt.profileId) : null;
  if (evt.profileId && !profile) { notify('Choose an available routine for this rule first.', 'warning'); return false; }
  const dryRun = Boolean(state.dryRun || profile?.dryRun || evt.testMode);
  const result = await api.startTimer({ durationSeconds: Math.round(ms / 1000), action, dryRun,
    profileId: profile?.id || null, forceShutdown: false, gracePeriod: profile?.gracePeriod ?? state.graceMinutes,
    startOrigin: profile ? 'profile-start' : 'schedule', origin: 'schedule' });
  if (result?.success === false) {
    notify(result.error || 'Timer could not start', 'error');
    return false;
  }
  const at = schClock(end);
  notify(dryRun
    ? `Test Mode countdown to ${at}, nothing will power off`
    : `${actionLabel(action)} at ${at}`, dryRun ? 'info' : 'warning');
  return true;
}

// Both Auto-start switches write the one persisted field
// (calendar.autoStartFromEvents) through main and then mirror main's answer,
// so they can never disagree.
async function setScheduleAutoStart(checked) {
  let armed = Boolean(checked);
  try {
    const res = await api.setCalendarAutoStart?.(armed);
    if (res && typeof res.autoStartFromEvents === 'boolean') armed = res.autoStartFromEvents;
  } catch (e) {
    console.error('Failed to save Auto-start:', e);
    armed = calAutoStartArmed;
    notify('Auto-start could not be saved', 'error');
  }
  calAutoStartArmed = armed;
  syncAutoStartSwitches();
  renderScheduleState();
}

function syncAutoStartSwitches() {
  if (els.calAutoStart) els.calAutoStart.checked = calAutoStartArmed;
  if (els.chkCalendarAutostart) els.chkCalendarAutostart.checked = calAutoStartArmed;
}

async function loadCalendarConfig() {
  try {
    const cal = await api.getCalendarSettings();
    if (!cal) return;
    renderRoutineOutcomes(cal.routineOutcomes || []);
    // Exactly main's test (checkCalendarAutoStart: `!calSettings.enabled`).
    calConfigEnabled = Boolean(cal.enabled);
    calAutoStartArmed = Boolean(cal.autoStartFromEvents);
    syncAutoStartSwitches();
    if (els.calIcalUrl) els.calIcalUrl.value = cal.ical?.url || '';
    if (els.calGoogleApikey) els.calGoogleApikey.value = cal.google?.apiKey || '';
    if (els.calGoogleCalid) els.calGoogleCalid.value = cal.google?.calendarId || '';
    if (els.calOutlookToken) els.calOutlookToken.value = cal.outlook?.accessToken || '';
    if (els.calCalendlyToken) els.calCalendlyToken.value = cal.calendly?.personalToken || '';
    scheduleRules = Array.isArray(cal.builtin?.rules) ? cal.builtin.rules : [];
    savedScheduleRules = JSON.parse(JSON.stringify(scheduleRules));
    calBuiltinAction = cal.builtin?.action || null;
    // Display only: nothing is written back on load.
    showProviderPanel(initialProviderPanel(cal));
    renderScheduleState();
  } catch (e) {
    console.error('Failed to load calendar config:', e);
  }
}

function renderRoutineOutcomes(entries) {
  const container = document.getElementById('routine-outcomes');
  if (!container) return;
  const labels = { claimed: 'Claimed; dispatch not confirmed', accepted: 'Ritual accepted; timer pending', running: 'Timer running', simulated: 'Completed in Test Mode',
    completed: 'Legacy outcome unverified', unverified: 'Windows outcome unverified', timer_elapsed: 'Timer finished; request pending',
    action_requested: 'Power requested; Windows outcome unverified', command_spawned: 'Command started; Windows outcome unverified',
    command_returned_failure: 'Command returned an error; Windows outcome unverified', spawn_failed: 'Command could not start',
    cancelled: 'Cancelled', interrupted: 'Interrupted', skipped: 'Skipped', failed: 'Failed', unavailable: 'Unavailable' };
  container.replaceChildren();
  if (!entries.length) { container.textContent = 'No calendar routine has run yet.'; return; }
  for (const entry of entries) {
    const row = document.createElement('p');
    const label = entry.status === 'running' && entry.receiptAvailable === false ? 'Timer status unverified; receipt unavailable' : labels[entry.status] || 'Outcome unknown';
    row.textContent = `${entry.name || 'Routine'} · ${label}${entry.reason ? ' · ' + entry.reason : ''}${entry.proofSaved === false ? ' · receipt save unavailable' : ''}`;
    container.append(row);
  }
}

// Saves everything EXCEPT builtin.rules, which is mutated + persisted directly
// by persistScheduleRules() -- this function's config object omits that key so
// the deep-merge in settings.js's updateSection() leaves the rule list alone
// (see settings.js deepMerge: a key absent from the patch is never touched).
// The provider key and the Auto-start field are omitted too: the select is
// display-only now, and Auto-start has its own path (setScheduleAutoStart).
async function saveCalendarConfig() {
  const config = {
    enabled: true,
    ical: { url: els.calIcalUrl?.value || '' },
    google: { apiKey: els.calGoogleApikey?.value || '', calendarId: els.calGoogleCalid?.value || '' },
    outlook: { accessToken: els.calOutlookToken?.value || '' },
    calendly: { personalToken: els.calCalendlyToken?.value || '' }
  };
  await api.saveCalendarSettings(config);
  calConfigEnabled = true;
  // A status describes the configuration it was fetched with: after a change
  // it is unknown until the next check, never a stale 'Reached'.
  calFetchStatus = {};
  renderCalendarFetchStatus();
  renderCalendarEvents();
}

function queueCalendarConfigSave() {
  calConfigSaving = saveCalendarConfig().catch(e => { console.error('Failed to save calendar config:', e); });
  return calConfigSaving;
}

// -- Calendar checks report what happened (UI-R3 Fire 09) ----------------------
// main records, per configured provider, whether the last Schedule fetch
// reached it ({ ok, at } or { ok:false, reason, at }; the reason is a fixed
// category). The event count is counted here from main's own event list.
// Every line below is fixed copy; no error text, URL or token is ever shown.

// The providers main's fetchAllEvents would fetch, from the current fields
// (the same tests: a URL, API key + calendar ID, or a token). Truthiness only.
function calConfiguredProviders() {
  return CAL_EXTERNAL_PROVIDERS.filter(id => ({
    ical: Boolean(els.calIcalUrl?.value),
    google: Boolean(els.calGoogleApikey?.value && els.calGoogleCalid?.value),
    outlook: Boolean(els.calOutlookToken?.value),
    calendly: Boolean(els.calCalendlyToken?.value)
  })[id]);
}

// Pure: one status line. tone 'live' (teal, reached) or 'attn' (amber).
function calStatusLine(provider, status, count, checkedAt) {
  const noun = provider === 'ical' ? 'feed' : 'calendar';
  const at = checkedAt ? ` · checked ${checkedAt}` : '';
  if (status && status.ok === true) {
    const n = Number(count) || 0;
    const what = n === 0 ? 'no events' : `${n} event${n === 1 ? '' : 's'}`;
    return { tone: 'live', text: `Reached · ${what} in the next ${CAL_STATUS_WINDOW_DAYS} days${at}` };
  }
  const reason = String(status?.reason || 'network');
  const http = /^http-(\d{3})$/.exec(reason);
  let text;
  if (http && (http[1] === '401' || http[1] === '403')) text = 'Sign-in expired or not allowed.';
  else if (http && http[1] === '404') text = `Couldn't reach this ${noun} (not found).`;
  else if (http) text = `Couldn't reach this ${noun} (the server answered HTTP ${http[1]}).`;
  else if (reason === 'timeout') text = `Couldn't reach this ${noun} (timed out).`;
  else if (reason === 'too-large') text = 'This feed is too large to read (over 5 MB).';
  else if (reason === 'not-https') text = 'This feed must be an https:// link.';
  else if (reason === 'parse') text = `Reached, but this ${noun} could not be read.`;
  else if (reason === 'unexpected-response') text = `Reached, but no event list came back. Check the ${provider === 'google' ? 'calendar ID and key' : 'token'}.`;
  else text = `Couldn't reach this ${noun} (network).`;
  return { tone: 'attn', text: `${text} Rules above still work.${at}` };
}

// Pure: the empty imported-events copy. 'No imported events' only when every
// configured provider was reached; a broken feed never looks like a healthy,
// empty one.
function calEmptyCopy(configured, statusMap) {
  if (!configured.length) return 'No calendar connected. Bedtime rules above work without one.';
  const status = statusMap || {};
  if (configured.every(p => status[p]?.ok === true)) return `No imported events in the next ${CAL_STATUS_WINDOW_DAYS} days.`;
  if (configured.some(p => status[p]?.ok === false)) return 'A calendar could not be reached; see above.';
  return 'Not checked since the last change. Use Check to fetch.';
}

function calEventCount(provider) {
  const now = Date.now();
  const until = now + CAL_STATUS_WINDOW_DAYS * 86400000;
  return calEvents.filter(e => {
    if (!e || e.source !== provider) return false;
    const t = new Date(e.start).getTime();
    return Number.isFinite(t) && t <= until;
  }).length;
}

function renderCalendarFetchStatus() {
  const configured = calConfiguredProviders();
  CAL_EXTERNAL_PROVIDERS.forEach(provider => {
    const el = document.getElementById(`sch-cal-status-${provider}`);
    if (!el) return;
    const status = calFetchStatus[provider];
    if (!status || !configured.includes(provider)) {
      el.hidden = true;
      setCalText(el, '');
      delete el.dataset.tone;
      return;
    }
    const at = Number.isFinite(status.at) ? schClock(new Date(status.at)) : '';
    const line = calStatusLine(provider, status, calEventCount(provider), at);
    el.dataset.tone = line.tone;
    setCalText(el, line.text);
    el.hidden = false;
  });
}

// A Check press: waits for a pending save, says 'Checking…' (static text) and
// always restores the button, even when the IPC call throws.
async function checkCalendarFeeds(btn) {
  if (!btn || btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    await calConfigSaving;
    if (!(await fetchAndRenderEvents())) notify('The calendars could not be checked. Try again.', 'warning');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Re-renders everything on the page that depends on the persisted arm state,
// Test Mode or the event list.
function renderScheduleState() {
  renderArmState();
  renderScheduleRules();
  renderScheduleNext();
  renderCalendarEvents();
}

// The Auto-start row: what On / Off really means, plus a static mode line
// from the persisted Test Mode (calendar auto-start inherits it in main).
function renderArmState() {
  const armed = calendarArmed();
  setCalText(document.getElementById('sch-arm-hint'), armed
    ? 'On: rules, and imported events marked Will auto-start, start a countdown on this PC at their time while Lights Out is running and idle.'
    : 'Off: rules are listed but never start a countdown.');
  const mode = document.getElementById('sch-arm-mode');
  if (!mode) return;
  if (!armed || !state.settingsLoaded) {
    mode.hidden = true;
    // Cleared too: #cal-auto-start's aria-describedby reads it even hidden.
    setCalText(mode, '');
    return;
  }
  mode.hidden = false;
  mode.dataset.tone = state.dryRun ? 'test' : 'real';
  setCalText(mode, state.dryRun
    ? 'Test Mode: auto-started runs will not power off.'
    : `Real ${rulesActionPhrase()} at the end of each run.`);
}

// Next lights-out hero (Fire 09: the page's instrument): the first upcoming
// event main would auto-start. The big numerals are its END (the action
// time); the span line spells out countdown start -> action; the arc fills by
// real proximity over 24 h (no fake minimum). The eyebrow says 'Next
// lights-out' only when armed: unarmed, nothing will happen by itself.
function scheduleSpanAction(action) {
  if (!state.settingsLoaded) return 'ends';
  return state.dryRun ? 'Test ends' : `${actionLabel(action)} at`;
}

function renderScheduleNext() {
  const card = document.getElementById('sch-next');
  if (!card) return;
  const now = new Date();
  const evt = calEvents
    .filter(e => isAutoStartEligible(e) && new Date(e.start) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0] || null;
  calNextEvent = evt;

  const eyebrowEl = document.getElementById('sch-next-eyebrow');
  const whenEl = document.getElementById('sch-next-when');
  const ampmEl = document.getElementById('sch-next-ampm');
  const dayEl = document.getElementById('sch-next-day');
  const spanEl = document.getElementById('sch-next-span');
  const detailEl = document.getElementById('sch-next-detail');
  const conseqEl = document.getElementById('sch-next-consequence');
  const inEl = document.getElementById('sch-next-in');
  const arc = document.getElementById('sch-next-arc');
  const btn = els.btnStartFromEvent;

  if (!evt) {
    card.dataset.state = 'none';
    setCalText(eyebrowEl, 'Next bedtime');
    setCalText(whenEl, '--:--');
    setCalText(ampmEl, '');
    setCalText(dayEl, '');
    setCalText(spanEl, '');
    if (spanEl) spanEl.hidden = true;
    const rules = scheduleRules.filter(Boolean);
    setCalText(detailEl, !rules.length
      ? 'No bedtime scheduled. Add a rule below.'
      : rules.some(r => r.enabled !== false)
        ? 'No rule falls in the next 14 days.'
        : 'All rules are off. Turn one on below.');
    if (detailEl) detailEl.removeAttribute('title');
    if (conseqEl) conseqEl.hidden = true;
    setCalText(inEl, '');
    if (arc) arc.setAttribute('stroke-dasharray', '0 100');
    if (btn) btn.hidden = true;
    return;
  }

  const armed = calendarArmed();
  const start = new Date(evt.start);
  const end = eventEnd(evt);
  const action = evt.action || calBuiltinAction || 'shutdown';
  card.dataset.state = armed ? 'armed' : 'unarmed';
  setCalText(eyebrowEl, armed ? 'Next lights-out' : 'Next bedtime');

  const parts = schClockParts(end);
  setCalText(whenEl, parts.hm);
  setCalText(ampmEl, parts.ampm);
  setCalText(dayEl, schDayLabel(end, now));
  setCalText(spanEl, `Countdown from ${schClock(start)} · ${scheduleSpanAction(action)} ${schClock(end)}`);
  if (spanEl) spanEl.hidden = false;
  setCalText(detailEl, `${evt.summary || 'Bedtime'} · ${Math.max(1, Math.round((end - start) / 60000))} min countdown`);
  if (detailEl) detailEl.title = 'Override Tax debt from an earlier run may shorten a countdown.';

  if (conseqEl) {
    conseqEl.hidden = false;
    conseqEl.dataset.tone = !state.settingsLoaded ? 'off' : (state.dryRun ? 'test' : 'real');
    setCalText(conseqEl, !state.settingsLoaded ? 'Checking mode…'
      : (state.dryRun ? 'Test Mode · no power action' : `Real ${actionLabel(action)}`));
  }

  const msToStart = start - now;
  setCalText(inEl, msToStart < 60000 ? 'starts in under a minute' : `starts in ${schDuration(msToStart)}`);
  if (arc) {
    const day = 24 * 3600000;
    const dash = Math.round(100 * (1 - Math.min(Math.max(msToStart, 0), day) / day));
    arc.setAttribute('stroke-dasharray', `${dash} 100`);
  }

  if (btn) {
    const msToEnd = end - now;
    const capMinutes = Number(els.timerInput?.max);
    const fits = Number.isFinite(capMinutes) && msToEnd > 0 && msToEnd <= capMinutes * 60000;
    btn.hidden = !(fits && !state.running && !state.paused);
  }
}

// Called from render(): Schedule's truth (Test Mode / REAL, run state) is
// re-rendered only when one of its inputs actually changed.
function renderScheduleTruth() {
  const key = `${state.settingsLoaded}|${state.dryRun}|${state.running}|${state.paused}|${state.clockFormat}`;
  if (key === calTruthKey) return;
  calTruthKey = key;
  renderArmState();
  renderScheduleNext();
  renderCalendarEvents();
}

// The hero's "starts in" line and arc refresh once a minute, only while
// Schedule is visible. Idempotent.
function startScheduleClock() {
  if (calScheduleClock) return;
  calScheduleClock = setInterval(() => {
    if (calNextEvent && new Date(calNextEvent.start) <= new Date()) fetchAndRenderEvents();
    else renderScheduleNext();
  }, 60000);
}

function stopScheduleClock() {
  if (!calScheduleClock) return;
  clearInterval(calScheduleClock);
  calScheduleClock = null;
}

// Entering Schedule: reload the persisted config, refetch main's events only
// when the last fetch is stale (external providers are network fetches), then
// tick. loadCalendarConfig() already re-renders from the cached events.
async function renderSchedulePage() {
  await loadCalendarConfig();
  if (typeof api !== 'undefined' && api.routineFileList && document.getElementById('routine-transfer-body')) {
    if (!window.routineTransfer) window.routineTransfer = RoutineTransferUI.mount(document.getElementById('routine-transfer-body'), {
      platform:'windows', list:()=>api.routineFileList(), exportFile:selection=>api.routineFileExport(selection),
      openFile:()=>api.routineFileOpen(), preview:text=>api.routineFilePreview(text),
      commitImport:(text,policy)=>api.routineFileImport(text,policy), adopt:async options=>{const r=await api.routineFileAdopt(options);await loadCalendarConfig();return r;},
      start:async id=>{const r=await api.routineFileStart(id);if(!r?.success)throw Error(r?.error || 'Timer could not start');}
    }); else await window.routineTransfer.refresh();
  }
  if (Date.now() - calLastFetchAt > CAL_REFETCH_MS) await fetchAndRenderEvents();
  startScheduleClock();
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in schedule: multiple independent recurring rules (label, time, active
// days, action). Each rule becomes a synthesized calendar event per matching
// day via calendarProviders.getDefaultCalendarEvents on the main-process side.
// ─────────────────────────────────────────────────────────────────────────────

let scheduleRules = [];
let savedScheduleRules = [];
let scheduleSaveChain = Promise.resolve();
let scheduleSaveRevision = 0;
let editingRuleId = null; // null while the form is closed or adding; a rule id while editing
let plannerMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function ruleRecurrenceLabel(rule) {
  if (rule.repeat === 'once') return rule.date || 'Choose a date';
  const months = (rule.months || []).length === 12 || !rule.months ? '' : ` · ${rule.months.map(m => new Date(2026,m-1,1).toLocaleDateString([], {month:'short'})).join(', ')}`;
  if (rule.repeat === 'monthly') return `Monthly · ${(rule.monthDays || []).map(day => day === -1 ? 'last day' : day).join(', ')}${months}`;
  return `${formatRuleDays(rule.days) || 'No weekdays'}${months}`;
}

function renderMonthPlanner() {
  const grid=document.getElementById('planner-grid'); if(!grid) return;
  const month=document.getElementById('planner-month'),year=document.getElementById('planner-year');
  if(month) month.value=String(plannerMonth.getMonth()); if(year) year.value=String(plannerMonth.getFullYear());
  grid.replaceChildren();
  const first=new Date(plannerMonth);first.setDate(1-first.getDay());
  const today=CalendarRecurrence.dateKey(new Date());
  for(let i=0;i<42;i++) {
    const date=new Date(first);date.setDate(first.getDate()+i);
    const key=CalendarRecurrence.dateKey(date),rules=scheduleRules.filter(rule=>CalendarRecurrence.matchesDate(rule,date));
    const button=document.createElement('button');button.type='button';button.className='planner-day';button.dataset.date=key;
    button.classList.toggle('outside-month',date.getMonth()!==plannerMonth.getMonth());
    if(key===today)button.setAttribute('aria-current','date');
    button.setAttribute('aria-label',`${date.toLocaleDateString([], {weekday:'long',year:'numeric',month:'long',day:'numeric'})}${rules.length?': '+rules.map(rule=>rule.label || 'Routine').join(', '):': Add routine'}`);
    const day=document.createElement('span');day.className='planner-day-number';day.textContent=String(date.getDate());button.append(day);
    for(const rule of rules.slice(0,2)) { const badge=document.createElement('span');badge.className='planner-rule';badge.textContent=rule.label || 'Routine';button.append(badge); }
    if(rules.length>2) { const more=document.createElement('small');more.textContent=`+${rules.length-2} more`;button.append(more); }
    button.addEventListener('click',()=>{openRuleForm(null,key);document.getElementById('schedule-rule-form')?.scrollIntoView({block:'nearest'});});
    grid.append(button);
  }
}

function updateRuleRepeatFields() {
  const repeat=document.getElementById('rule-repeat')?.value || 'weekly';
  for(const [selector,show] of [['.sch-rule-days-field',repeat==='weekly'],['.rule-monthly-field',repeat==='monthly'],['.rule-once-field',repeat==='once'],['.rule-months-field',repeat!=='once']]) {
    const field=document.querySelector('#schedule-rule-form '+selector);if(field)field.hidden=!show;
  }
}

function updateRuleActionPreview() {
  const preview = document.getElementById('rule-action-preview'); if (!preview) return;
  const minutes = Math.max(5, Number(document.getElementById('rule-duration')?.value) || 60);
  const action = SCHEDULE_ACTION_LABELS[document.getElementById('rule-action')?.value] || 'Shutdown';
  const profile = (state.profiles || []).find(p => p.id === document.getElementById('rule-profile')?.value);
  const test = Boolean(state.dryRun || profile?.dryRun || document.getElementById('rule-test-mode')?.checked);
  preview.textContent = `On this PC: start a ${minutes} min timer, then ${test ? 'simulate ' : ''}${action.toLowerCase()}. ${test ? 'Nothing will power off.' : 'Uses your power safety settings.'}`;
}

function setupMonthPlanner() {
  const month=document.getElementById('planner-month');
  if(!month) return;
  for(let i=0;i<12;i++) { const option=document.createElement('option');option.value=String(i);option.textContent=new Date(2026,i,1).toLocaleDateString([], {month:'long'});month.append(option); }
  month.addEventListener('change',()=>{plannerMonth.setMonth(Number(month.value));renderMonthPlanner();});
  document.getElementById('planner-year')?.addEventListener('change',event=>{plannerMonth.setFullYear(Math.max(2000,Math.min(2199,Number(event.target.value)||new Date().getFullYear())));renderMonthPlanner();});
  for(const [id,delta] of [['planner-prev',-1],['planner-next',1]]) document.getElementById(id)?.addEventListener('click',()=>{const next=new Date(plannerMonth);next.setMonth(next.getMonth()+delta);if(next.getFullYear()<2000||next.getFullYear()>2199)return;plannerMonth=next;renderMonthPlanner();});
  document.getElementById('planner-today')?.addEventListener('click',()=>{plannerMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderMonthPlanner();});
  function toggles(id,values,label) {
    const container=document.getElementById(id);if(!container)return;
    for(const value of values) { const button=document.createElement('button');button.type='button';button.className='day-toggle';button.dataset.value=String(value);button.textContent=label(value);button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>button.setAttribute('aria-pressed',String(button.classList.toggle('active'))));container.append(button); }
  }
  toggles('rule-monthdays',[...Array.from({length:31},(_,i)=>i+1),-1],day=>day===-1?'Last':String(day));
  toggles('rule-months',Array.from({length:12},(_,i)=>i+1),m=>new Date(2026,m-1,1).toLocaleDateString([], {month:'short'}));
  document.getElementById('rule-repeat')?.addEventListener('change',updateRuleRepeatFields);
  document.getElementById('rule-actions')?.addEventListener('input', updateRuleActionPreview);
  document.getElementById('rule-profile')?.addEventListener('change',event=>{
    const profile=(state.profiles || []).find(profile=>profile.id===event.target.value);if(!profile)return;
    document.getElementById('rule-label').value=profile.name;
    document.getElementById('rule-duration').value=String(Math.max(1,Math.min(1440,Math.round((profile.seconds || 3600)/60))));
    if(['shutdown','sleep','hibernate'].includes(profile.action))document.getElementById('rule-action').value=profile.action;
    updateRuleActionPreview();
  });
  renderMonthPlanner();
}

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

// One truthful line per rule: when an auto-started countdown starts, how long
// it runs and what lands when, with main's own arithmetic (event length
// Math.max(1, d || 60), no upper clamp; auto-start never runs under 5 min).
function ruleTruthLine(rule) {
  const eventMinutes = ruleEventMinutes(rule.durationMinutes);
  const minutes = ruleCountdownMinutes(rule.durationMinutes);
  const landing = addMinutes(rule.time || '22:30', minutes);
  const action = SCHEDULE_ACTION_LABELS[rule.action] || actionLabel(rule.action);
  const shownMinutes = Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(1));
  const day = landing.dayOffset > 1 ? ` (+${landing.dayOffset} days)` : landing.nextDay ? ' (next day)' : '';
  const floor = eventMinutes < CAL_AUTOSTART_MIN_MINUTES ? ` (auto-start runs at least ${CAL_AUTOSTART_MIN_MINUTES} min)` : '';
  return `${escapeHtml(schClockFromHHMM(rule.time || '22:30'))} · ${shownMinutes} min countdown → <strong>${escapeHtml(action)}</strong> at ${escapeHtml(schClockFromHHMM(landing.time))}${day}${floor}`;
}

// The same facts as ruleTruthLine, split for the rule card (Fire 09): exactly
// its arithmetic (main's event length, the 5 min auto-start floor, the same
// rounding and the same day note), so the card and the line cannot drift.
function ruleClock(rule) {
  const eventMinutes = ruleEventMinutes(rule.durationMinutes);
  const minutes = ruleCountdownMinutes(rule.durationMinutes);
  const landing = addMinutes(rule.time || '22:30', minutes);
  const action = SCHEDULE_ACTION_LABELS[rule.action] || actionLabel(rule.action);
  const shownMinutes = Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(1));
  const dayNote = landing.dayOffset > 1 ? `+${landing.dayOffset} days` : landing.nextDay ? 'next day' : '';
  const floorNote = eventMinutes < CAL_AUTOSTART_MIN_MINUTES ? `auto-start runs at least ${CAL_AUTOSTART_MIN_MINUTES} min` : '';
  return {
    start: schClockFromHHMM(rule.time || '22:30'),
    end: schClockFromHHMM(landing.time),
    minutes: shownMinutes,
    dayNote,
    floorNote,
    action
  };
}

// A 7-day track: one pill per day (violet when on), its fixed one-letter
// label drawn below from data-d (SCHEDULE_DAY_LABELS only), today marked.
function ruleDayDots(days, today = SCHEDULE_DAY_ORDER[new Date().getDay()]) {
  const on = new Set(days || []);
  return SCHEDULE_DAY_ORDER.map(d => {
    const isOn = on.has(d);
    const isToday = d === today;
    return `<span class="sch-day${isOn ? ' on' : ''}${isToday ? ' today' : ''}" data-d="${SCHEDULE_DAY_LABELS[d].charAt(0)}" title="${SCHEDULE_DAY_LABELS[d]}${isOn ? '' : ' (off)'}"${isToday ? ' aria-current="date"' : ''}></span>`;
  }).join('');
}

// Text for an attribute value: escapeHtml leaves quotes alone.
function ruleAttr(value) {
  return escapeHtml(String(value)).replace(/"/g, '&quot;');
}

function ruleCardHtml(rule) {
  const label = rule.label || 'Untitled';
  const c = ruleClock(rule);
  const [endHm, endAmpm] = c.end.split(' ');
  const notes = [c.dayNote, c.floorNote].filter(Boolean).map(n => ` <span class="sch-rule-note">· ${escapeHtml(n)}</span>`).join('');
  const off = rule.enabled === false;
  const id = ruleAttr(rule.id);
  return `
    <div class="schedule-rule-item sch-rule${off ? ' disabled' : ''}" data-rule-id="${id}">
      <div class="sch-rule-clock" aria-hidden="true">
        <span class="sch-rule-t">${escapeHtml(endHm)}${endAmpm ? `<small>${escapeHtml(endAmpm)}</small>` : ''}</span>
        <span class="sch-rule-run">from ${escapeHtml(c.start)} · ${c.minutes} min countdown</span>
      </div>
      <div class="schedule-rule-info">
        <div class="schedule-rule-label">${escapeHtml(label)}${off ? '<span class="sch-rule-off">Off</span>' : ''}</div>
        <div class="sch-rule-line" aria-hidden="true"><strong>${escapeHtml(c.action)}</strong>${notes}</div>
        <span class="sr-only">${ruleTruthLine(rule)}</span>
        <div class="sch-rule-recurrence">${escapeHtml(ruleRecurrenceLabel(rule))}${rule.testMode ? ' · Test Mode only' : ''}${rule.profileId ? ` · ${escapeHtml((state.profiles || []).find(profile => profile.id === rule.profileId)?.name || 'Routine unavailable')}` : ''}</div>
        ${!rule.repeat || rule.repeat === 'weekly' ? `<div class="sch-rule-days" aria-label="Active days: ${ruleAttr(formatRuleDays(rule.days) || 'none')}">${ruleDayDots(rule.days)}</div>` : ''}
      </div>
      <div class="schedule-rule-actions">
        <input type="checkbox" class="rule-enabled-toggle" data-rule-id="${id}" title="Rule enabled" aria-label="${ruleAttr(label)} enabled" ${off ? '' : 'checked'}>
        <button class="btn-quiet sch-rule-icon rule-edit-btn" data-rule-id="${id}" type="button" aria-label="Edit ${ruleAttr(label)}" title="Edit ${ruleAttr(label)}">${loGlyph('edit')}</button>
        <button class="btn-quiet btn-quiet--danger sch-rule-icon rule-delete-btn" data-rule-id="${id}" type="button" aria-label="Delete ${ruleAttr(label)}" title="Delete ${ruleAttr(label)}">${loGlyph('trash')}</button>
      </div>
    </div>`;
}

// -- Rule delete: two steps on the shared machine (UI-R3 Fire 09) --------------
// The same twoStepNext (renderer-utils.js) as My Modes: the first press arms
// ('Delete?'), only a second press on the SAME rule within RULE_DELETE_MS
// deletes. Escape, blur, the timeout, arming another rule and any re-render
// of the list disarm. Never a one-click delete of a saved rule.
const RULE_DELETE_MS = 4000;
const ruleDeleteState = { pending: null, timer: null };

// Pure (no DOM): 'arm' or 'delete'. Keeps the machine's pending in `st`.
function ruleDeleteClick(st, ruleId, now) {
  const step = twoStepNext(st.pending, `rule:${ruleId}`, now, RULE_DELETE_MS);
  st.pending = step.pending;
  return step.decision === 'confirm' ? 'delete' : 'arm';
}

function setRuleDeleteArmed(btn, armed) {
  if (!btn) return;
  const rule = scheduleRules.find(r => r.id === btn.dataset.ruleId);
  const label = rule ? (rule.label || 'Untitled') : 'this rule';
  btn.classList.toggle('is-confirming', armed);
  // Constant markup only: the glyph or the fixed word.
  btn.innerHTML = armed ? 'Delete?' : loGlyph('trash');
  btn.setAttribute('aria-label', armed ? `Confirm delete ${label}` : `Delete ${label}`);
  btn.setAttribute('title', armed ? `Confirm delete ${label}` : `Delete ${label}`);
}

function disarmRuleDelete() {
  ruleDeleteState.pending = null;
  if (ruleDeleteState.timer) { clearTimeout(ruleDeleteState.timer); ruleDeleteState.timer = null; }
  document.querySelectorAll('#schedule-rules-list .rule-delete-btn.is-confirming').forEach(b => setRuleDeleteArmed(b, false));
}

// One press on a rule's Delete. Resolves 'arm' or 'delete'.
function requestRuleDelete(btn) {
  const ruleId = btn?.dataset?.ruleId;
  const rule = scheduleRules.find(r => r.id === ruleId);
  if (!rule) return 'arm';
  const label = rule.label || 'Untitled';
  const decision = ruleDeleteClick(ruleDeleteState, ruleId, Date.now());
  if (ruleDeleteState.timer) { clearTimeout(ruleDeleteState.timer); ruleDeleteState.timer = null; }
  document.querySelectorAll('#schedule-rules-list .rule-delete-btn.is-confirming').forEach(b => { if (b !== btn) setRuleDeleteArmed(b, false); });
  if (decision === 'delete') {
    scheduleRules = scheduleRules.filter(r => r.id !== ruleId);
    void persistScheduleRules().then(saved => { if (saved) notify(`Deleted "${label}"`, 'info'); });
    return 'delete';
  }
  setRuleDeleteArmed(btn, true);
  ruleDeleteState.timer = setTimeout(disarmRuleDelete, RULE_DELETE_MS);
  return 'arm';
}

function renderScheduleRules() {
  // A re-render rebuilds the buttons: no armed delete may outlive its button.
  disarmRuleDelete();
  if (typeof CalendarRecurrence !== 'undefined') renderMonthPlanner();
  const list = document.getElementById('schedule-rules-list');
  if (!list) return;
  if (!scheduleRules.length) {
    list.innerHTML = '<div class="schedule-rules-empty">No bedtime rules yet. Add one: at its time, a countdown starts on this PC (only while Auto-start is on).</div>';
    return;
  }
  list.innerHTML = scheduleRules.map(ruleCardHtml).join('');

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
    btn.addEventListener('click', () => { requestRuleDelete(btn); });
    btn.addEventListener('keydown', e => { if (e.key === 'Escape' && btn.classList.contains('is-confirming')) disarmRuleDelete(); });
    btn.addEventListener('blur', () => { if (btn.classList.contains('is-confirming')) disarmRuleDelete(); });
  });
}

// Persists the in-memory rule list as a targeted patch (builtin.rules only),
// re-renders the list, and refreshes the upcoming-events view so the Schedule
// page immediately reflects what will actually fire.
async function persistScheduleRules() {
  const next = JSON.parse(JSON.stringify(scheduleRules));
  const revision = ++scheduleSaveRevision;
  const save = scheduleSaveChain.then(() => api.saveCalendarSettings({ builtin: { rules: next } }));
  scheduleSaveChain = save.catch(() => {});
  try {
    await save;
    savedScheduleRules = next;
  } catch {
    if (revision === scheduleSaveRevision) scheduleRules = JSON.parse(JSON.stringify(savedScheduleRules));
    renderScheduleRules(); renderArmState();
    notify('The schedule could not be saved. Your previous rules are still in place.', 'error');
    return false;
  }
  renderScheduleRules();
  renderArmState();
  await fetchAndRenderEvents();
  return true;
}

function openRuleForm(ruleId, selectedDate) {
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
  const testModeInput = document.getElementById('rule-test-mode'); if (testModeInput) testModeInput.checked = Boolean(rule?.testMode);
  document.getElementById('rule-repeat').value=selectedDate?'once':(rule?.repeat || 'weekly');
  document.getElementById('rule-date').value=selectedDate || rule?.date || CalendarRecurrence.dateKey(new Date());
  const profiles=document.getElementById('rule-profile');profiles.replaceChildren();
  const custom=document.createElement('option');custom.value='';custom.textContent='Custom timer';profiles.append(custom);
  for(const profile of state.profiles || []) { if(!['shutdown','sleep','hibernate'].includes(profile.action))continue;const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;profiles.append(option); }
  if(rule?.profileId && !(state.profiles || []).some(profile=>profile.id===rule.profileId)) { const missing=document.createElement('option');missing.value=rule.profileId;missing.textContent='Routine unavailable — choose another';profiles.append(missing); }
  profiles.value=rule?.profileId || '';
  updateRuleActionPreview();
  for(const [id,values] of [['rule-monthdays',rule?.monthDays || [new Date().getDate()]],['rule-months',rule?.months || Array.from({length:12},(_,i)=>i+1)]])document.querySelectorAll('#'+id+' .day-toggle').forEach(button=>{const selected=values.includes(Number(button.dataset.value));button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  updateRuleRepeatFields();
  const days = rule?.days || ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  document.querySelectorAll('#rule-days .day-toggle').forEach(btn => {
    const on = days.includes(btn.dataset.day);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  // '' (not 'grid'): the #sch-rules #schedule-rule-form grid rule applies.
  form.style.display = '';
  labelEl?.focus();
}

function closeRuleForm() {
  const form = document.getElementById('schedule-rule-form');
  if (form) form.style.display = 'none';
  editingRuleId = null;
}

async function saveRuleFromForm() {
  const label = document.getElementById('rule-label')?.value?.trim() || 'Untitled';
  const time = document.getElementById('rule-time')?.value || '22:30';
  const durationMinutes = Math.max(1, Math.min(1440, parseInt(document.getElementById('rule-duration')?.value, 10) || 60));
  const action = document.getElementById('rule-action')?.value || 'shutdown';
  const days = [...document.querySelectorAll('#rule-days .day-toggle.active')].map(b => b.dataset.day);
  const repeat=document.getElementById('rule-repeat').value;
  const date=document.getElementById('rule-date').value;
  const monthDays=[...document.querySelectorAll('#rule-monthdays .day-toggle.active')].map(button=>Number(button.dataset.value));
  const months=[...document.querySelectorAll('#rule-months .day-toggle.active')].map(button=>Number(button.dataset.value));
  const profileId=document.getElementById('rule-profile').value || null;
  const testMode=Boolean(document.getElementById('rule-test-mode')?.checked);
  if(repeat==='weekly'&&!days.length){notify('Pick at least one active day','warning');return;}
  if(repeat==='monthly'&&!monthDays.length){notify('Pick at least one day of the month','warning');return;}
  if(repeat!=='once'&&!months.length){notify('Pick at least one active month','warning');return;}
  if(repeat==='once'&&!CalendarRecurrence.validDate(date)){notify('Choose a valid calendar date','warning');return;}
  if(profileId&&!(state.profiles || []).some(profile=>profile.id===profileId)){notify('Choose an available routine','warning');return;}

  if (editingRuleId) {
    const rule = scheduleRules.find(r => r.id === editingRuleId);
    if (rule) Object.assign(rule, { label, time, durationMinutes, action, days, repeat, date, monthDays, months, profileId, testMode });
  } else {
    scheduleRules.push({
      id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label, time, durationMinutes, action, days, repeat, date, monthDays, months, profileId, testMode, enabled: true
    });
  }
  const button=document.getElementById('btn-save-rule'); if(button)button.disabled=true;
  try {
    if(await persistScheduleRules()) { closeRuleForm();notify(`Schedule rule "${label}" saved`, 'success'); }
  } finally { if(button)button.disabled=false; }
}

function setupScheduleRuleHandlers() {
  setupMonthPlanner();
  document.getElementById('btn-add-schedule-rule')?.addEventListener('click', () => openRuleForm(null));
  document.getElementById('btn-cancel-rule')?.addEventListener('click', closeRuleForm);
  document.getElementById('btn-save-rule')?.addEventListener('click', saveRuleFromForm);
  document.querySelectorAll('#rule-days .day-toggle').forEach(btn => {
    btn.addEventListener('click', () => btn.setAttribute('aria-pressed', String(btn.classList.toggle('active'))));
  });
}

// Fetches main's 14-day event list, then what main recorded about each
// configured feed. Resolves true when the list arrived, false when it did not
// (never a silent success): a Check press restores its button either way.
async function fetchAndRenderEvents() {
  try {
    calEvents = await api.fetchCalendarEvents(14);
    if (!Array.isArray(calEvents)) calEvents = [];
    calLastFetchAt = Date.now();
  } catch (e) {
    console.error('Failed to fetch calendar events:', e);
    return false;
  }
  try {
    const status = await api.getCalendarFetchStatus?.();
    calFetchStatus = status && typeof status === 'object' ? status : {};
  } catch (e) {
    console.error('Failed to read calendar fetch status:', e);
    calFetchStatus = {};
  }
  renderScheduleNext();
  renderCalendarEvents();
  renderCalendarFetchStatus();
  return true;
}

// Imported events only (built-in rules already show above, so nothing appears
// twice), as styled rows with no per-row Start: the hero is the single manual
// start. Every external string is escaped.
function renderCalendarEvents() {
  if (!els.calendarEvents) return;
  const now = new Date();
  const armed = calendarArmed();
  const imported = calEvents
    .filter(e => e && e.source !== 'builtin' && new Date(e.start) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 10);

  if (!imported.length) {
    // Only 'No imported events' when every configured feed was reached.
    els.calendarEvents.innerHTML = `<div class="calendar-events-empty">${escapeHtml(calEmptyCopy(calConfiguredProviders(), calFetchStatus))}</div>`;
    return;
  }

  const willTone = !state.settingsLoaded ? 'off' : (state.dryRun ? 'test' : 'real');
  els.calendarEvents.innerHTML = imported.map(e => {
    const start = new Date(e.start);
    const end = eventEnd(e);
    const date = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    const will = e.autoStartEligible === true && armed;
    return `<div class="calendar-event" data-uid="${escapeHtml(e.uid)}">
      <span class="sch-ev-date">${escapeHtml(date)}</span>
      <div class="sch-ev-main">
        <div class="sch-ev-name">${escapeHtml(e.summary || 'Untitled event')}</div>
        <div class="sch-ev-meta">${escapeHtml(schClock(start))} → ${escapeHtml(actionLabel(e.action || 'shutdown'))} at ${escapeHtml(schClock(end))}</div>
      </div>
      <span class="sch-pill" data-tone="${will ? willTone : 'off'}">${will ? 'Will auto-start' : 'Listed only'}</span>
    </div>`;
  }).join('');
}
/* exported importCalendarFile, importCalendarUrl, setupCalendarHandlers, startFromScheduleEvent, formatRuleTime, renderSchedulePage, renderScheduleTruth, startScheduleClock, stopScheduleClock, setScheduleAutoStart, ruleClock, ruleDeleteClick, calStatusLine, calEmptyCopy */
