// Calendar provider integrations.
// Supports: Built-in (default recurring), iCal/ICS, Google Calendar, Outlook/MS Graph, Calendly.

const https = require('https');
const http = require('http');
const icsParser = require('./calendar');
const recurrence = require('./calendarRecurrence');
const routineModel = require('./routineModel');

// ─────────────────────────────────────────────────────────────────────────────
// Provider registry
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDERS = {
  builtin: { id: 'builtin', name: 'Lights Out Calendar', icon: '\u{1F4C5}', desc: 'Built-in recurring schedule' },
  ical: { id: 'ical', name: 'iCal / ICS Feed', icon: '\u{1F5D3}', desc: 'Any iCalendar URL (Google, Apple, etc.)' },
  google: { id: 'google', name: 'Google Calendar', icon: '\u{1F4E7}', desc: 'OAuth2 Google Calendar API' },
  outlook: { id: 'outlook', name: 'Outlook / Microsoft 365', icon: '\u{1F4E9}', desc: 'Microsoft Graph API' },
  calendly: { id: 'calendly', name: 'Calendly', icon: '\u{1F517}', desc: 'Calendly scheduled events' }
};

function getProviders() {
  return Object.values(PROVIDERS);
}

function getProvider(id) {
  return PROVIDERS[id] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in default calendar (recurring bedtime schedule)
// ─────────────────────────────────────────────────────────────────────────────

// Normalize a builtin-calendar config into an array of schedule rules.
// Supports the legacy single-schedule shape ({ bedtime, days, action }) that
// every settings.json persisted before multi-rule scheduling shipped, so
// upgrading users don't silently lose their configured bedtime -- if `rules`
// isn't present at all, the legacy fields (or their original hardcoded
// defaults) become a single implicit rule. An explicit `rules: []` (a user
// who deleted every rule on purpose) is left empty, not backfilled.
function normalizeScheduleRules(schedule) {
  if (Array.isArray(schedule?.rules)) return schedule.rules;
  return [{
    id: 'legacy',
    label: 'Bedtime',
    time: schedule?.bedtime || '22:30',
    days: schedule?.days || ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    action: schedule?.action || 'shutdown',
    durationMinutes: 60,
    enabled: true
  }];
}

function getDefaultCalendarEvents(schedule, from, withinDays) {
  const rules = normalizeScheduleRules(schedule).filter(r => r && r.enabled !== false);

  const events = [];
  const windowStart = new Date(from);
  windowStart.setHours(0, 0, 0, 0);
  const cutoff = new Date(windowStart);
  cutoff.setDate(cutoff.getDate() + Math.max(0, Math.min(366, Number(withinDays) || 0)));

  for (const rule of rules) {
    let routinePlan;
    try { routinePlan = routineModel.fromWindowsRule(rule); } catch { continue; }
    const [h, m] = String(rule.time || '22:30').split(':').map(Number);
    if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) continue;
    const durationMs = Math.max(1, Number(rule.durationMinutes) || 60) * 60000;
    const label = rule.label || 'Bedtime';
    const action = rule.action || 'shutdown';
    const ruleId = rule.id || 'rule';

    for (let d = new Date(windowStart); d <= cutoff; d.setDate(d.getDate() + 1)) {
      if (!recurrence.matchesDate(rule, d)) continue;
      const evtStart = new Date(d);
      evtStart.setHours(h, m, 0, 0);
      if (evtStart <= from) continue;
      events.push({
        uid: `lo-default-${ruleId}-${recurrence.dateKey(d)}`,
        summary: label,
        start: evtStart,
        end: new Date(evtStart.getTime() + durationMs),
        location: '',
        source: 'builtin',
        repeat: rule.repeat || 'weekly',
        profileId: typeof rule.profileId === 'string' ? rule.profileId : null,
        routinePlan,
        testMode: Boolean(rule.testMode),
        action
      });
    }
  }

  const priority = { once: 0, monthly: 1, weekly: 2 };
  events.sort((a, b) => a.start - b.start || priority[a.repeat] - priority[b.repeat]);
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Last fetch status (UI-R3 Fire 09): did each configured feed answer?
// ─────────────────────────────────────────────────────────────────────────────
// Per provider: { ok: true, at } or { ok: false, reason, at }. The reason is a
// CATEGORY from fixed checks only, never err.message, a URL or a token (a feed
// URL or an API key is a secret). Recorded only by a renderer-initiated fetch
// (fetchAllEvents with recordStatus); each recorded run starts empty, and a
// provider with no URL / credentials records nothing. A later recorded run
// supersedes an earlier one still in flight.
const FETCH_STATUS_REASON = /^(timeout|http-\d{3}|too-large|not-https|parse|unexpected-response|network)$/;
let lastFetchStatus = {};
let fetchStatusRun = 0;

function fetchFailureReason(err) {
  const msg = err && typeof err.message === 'string' ? err.message : '';
  if (msg === 'Timeout' || msg === 'Request timeout') return 'timeout';
  // fetchWithTimeout says 'HTTP 404'; calendar.js says 'HTTP 404: Failed to fetch calendar'.
  const http = /^HTTP (\d{3})(?::|$)/.exec(msg);
  if (http) return `http-${http[1]}`;
  if (msg === 'Response too large') return 'too-large';
  if (msg.startsWith('Calendar feed must be an https URL')) return 'not-https';
  if (err instanceof SyntaxError || msg.startsWith('Invalid iCalendar file') || msg === 'Downloaded feed is not a valid iCalendar file') return 'parse';
  return 'network';
}

function statusNote(report) {
  return typeof report === 'function' ? report : () => undefined;
}

function beginFetchStatusRun() {
  const run = ++fetchStatusRun;
  lastFetchStatus = {};
  return provider => status => {
    if (run !== fetchStatusRun) return;
    const at = Date.now();
    lastFetchStatus[provider] = status && status.ok
      ? { ok: true, at }
      : { ok: false, reason: FETCH_STATUS_REASON.test(status && status.reason) ? status.reason : 'network', at };
  };
}

// A deep copy of plain fields only: a caller can never mutate the record.
function getLastFetchStatus() {
  const out = {};
  for (const [provider, s] of Object.entries(lastFetchStatus)) {
    out[provider] = s.ok ? { ok: true, at: s.at } : { ok: false, reason: s.reason, at: s.at };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Calendar API (using service account or API key)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGoogleEvents(apiKey, calendarId, from, withinDays, maxResults = 50, report) {
  if (!apiKey || !calendarId) return [];
  const note = statusNote(report);
  const timeMin = from.toISOString();
  const timeMax = new Date(from.getTime() + withinDays * 86400000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?key=${apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=${maxResults}`;

  try {
    const response = await fetchWithTimeout(url, 10000);
    const data = JSON.parse(response);
    if (!data.items) { note({ ok: false, reason: 'unexpected-response' }); return []; }
    const events = data.items.map(item => ({
      uid: item.id,
      summary: item.summary || 'Event',
      start: parseGoogleDate(item.start),
      end: parseGoogleDate(item.end),
      location: item.location || '',
      source: 'google'
    })).filter(e => e.start);
    note({ ok: true });
    return events;
  } catch (err) {
    const reason = fetchFailureReason(err);
    console.error('Google Calendar fetch failed:', reason);
    note({ ok: false, reason });
    return [];
  }
}

function parseGoogleDate(dateObj) {
  if (!dateObj) return null;
  if (dateObj.dateTime) return new Date(dateObj.dateTime);
  if (dateObj.date) {
    const [y, m, d] = dateObj.date.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outlook / Microsoft Graph API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOutlookEvents(accessToken, from, withinDays, maxResults = 50, report) {
  if (!accessToken) return [];
  const note = statusNote(report);
  const timeMin = from.toISOString();
  const timeMax = new Date(from.getTime() + withinDays * 86400000).toISOString();
  const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${timeMin}&endDateTime=${timeMax}&$top=${maxResults}&$orderby=start/dateTime`;

  try {
    const response = await fetchWithTimeout(url, 10000, {
      Authorization: `Bearer ${accessToken}`
    });
    const data = JSON.parse(response);
    if (!data.value) { note({ ok: false, reason: 'unexpected-response' }); return []; }
    const events = data.value.map(item => ({
      uid: item.id,
      summary: item.subject || 'Event',
      start: new Date(item.start.dateTime + (item.start.timeZone ? '' : 'Z')),
      end: new Date(item.end.dateTime + (item.end.timeZone ? '' : 'Z')),
      location: item.location?.displayName || '',
      source: 'outlook'
    })).filter(e => e.start && !isNaN(e.start.getTime()));
    note({ ok: true });
    return events;
  } catch (err) {
    const reason = fetchFailureReason(err);
    console.error('Outlook Calendar fetch failed:', reason);
    note({ ok: false, reason });
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendly API (personal access token)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCalendlyEvents(personalToken, from, withinDays, report) {
  if (!personalToken) return [];
  const note = statusNote(report);
  const timeMin = from.toISOString();
  const timeMax = new Date(from.getTime() + withinDays * 86400000).toISOString();
  // First get the user URI.
  try {
    const userResp = await fetchWithTimeout('https://api.calendly.com/users/me', 10000, {
      Authorization: `Bearer ${personalToken}`
    });
    const userData = JSON.parse(userResp);
    const userUri = userData.resource?.uri;
    if (!userUri) { note({ ok: false, reason: 'unexpected-response' }); return []; }

    const url = `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${timeMin}&max_start_time=${timeMax}`;
    const eventsResp = await fetchWithTimeout(url, 10000, {
      Authorization: `Bearer ${personalToken}`
    });
    const eventsData = JSON.parse(eventsResp);
    if (!eventsData.collection) { note({ ok: false, reason: 'unexpected-response' }); return []; }

    const events = eventsData.collection.map(item => ({
      uid: item.uri,
      summary: item.name || 'Calendly Event',
      start: new Date(item.start_time),
      end: new Date(item.end_time),
      location: item.location?.location || '',
      source: 'calendly'
    })).filter(e => e.start && !isNaN(e.start.getTime()));
    note({ ok: true });
    return events;
  } catch (err) {
    const reason = fetchFailureReason(err);
    console.error('Calendly fetch failed:', reason);
    note({ ok: false, reason });
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ICS URL feed (existing calendar.js)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchIcsEvents(url, from, withinDays, report) {
  if (!url) return [];
  const note = statusNote(report);
  try {
    const result = await icsParser.importIcsFromUrl(url);
    const events = icsParser.getUpcomingEvents(result.events, from, withinDays).map(e => ({
      ...e,
      source: 'ical'
    }));
    note({ ok: true });
    return events;
  } catch (err) {
    const reason = fetchFailureReason(err);
    console.error('ICS feed fetch failed:', reason);
    note({ ok: false, reason });
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified fetch: pulls from all configured providers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAllEvents(config, from, withinDays = 14, options = {}) {
  const allEvents = [];
  // Only the renderer's own 14-day Schedule fetch records a status (main's
  // fetch-calendar-events handler); the 1-day background fetches (auto-start,
  // morning briefing) never do.
  const reporter = options && options.recordStatus ? beginFetchStatusRun() : () => undefined;

  // Built-in default calendar.
  if (config.builtin?.enabled !== false) {
    const builtinEvents = getDefaultCalendarEvents(config.builtin, from, withinDays);
    allEvents.push(...builtinEvents);
  }

  // ICS feed.
  if (config.ical?.url) {
    const icsEvents = await fetchIcsEvents(config.ical.url, from, withinDays, reporter('ical'));
    allEvents.push(...icsEvents);
  }

  // Google Calendar.
  if (config.google?.apiKey && config.google?.calendarId) {
    const gcalEvents = await fetchGoogleEvents(config.google.apiKey, config.google.calendarId, from, withinDays, undefined, reporter('google'));
    allEvents.push(...gcalEvents);
  }

  // Outlook.
  if (config.outlook?.accessToken) {
    const outlookEvents = await fetchOutlookEvents(config.outlook.accessToken, from, withinDays, undefined, reporter('outlook'));
    allEvents.push(...outlookEvents);
  }

  // Calendly.
  if (config.calendly?.personalToken) {
    const calendlyEvents = await fetchCalendlyEvents(config.calendly.personalToken, from, withinDays, reporter('calendly'));
    allEvents.push(...calendlyEvents);
  }

  // Sort by start time, deduplicate by uid.
  const seen = new Set();
  return allEvents
    .filter(e => {
      if (seen.has(e.uid)) return false;
      seen.add(e.uid);
      return e.start && !isNaN(e.start.getTime());
    })
    .sort((a, b) => a.start - b.start);
}

function fetchEvents(config, withinDays = 14, from = new Date()) {
  return fetchAllEvents(config, from, withinDays);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────────────────

function fetchWithTimeout(url, timeoutMs, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || undefined, // honor non-default ports in the feed URL
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'LightsOut/7 CalendarSync',
        ...headers
      }
    };
    const MAX_BYTES = 5 * 1024 * 1024; // cap response to guard against a hostile/huge feed
    const req = client.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume(); // drain so the socket can be freed
        return;
      }
      let data = '';
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(new Error('Response too large'));
          return;
        }
        data += chunk;
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  getProviders,
  getProvider,
  getDefaultCalendarEvents,
  fetchGoogleEvents,
  fetchOutlookEvents,
  fetchCalendlyEvents,
  fetchIcsEvents,
  fetchAllEvents,
  fetchEvents,
  getLastFetchStatus
};
