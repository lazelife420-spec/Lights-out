// Calendar provider integrations.
// Supports: Built-in (default recurring), iCal/ICS, Google Calendar, Outlook/MS Graph, Calendly.

const https = require('https');
const http = require('http');
const icsParser = require('./calendar');

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

function getDefaultCalendarEvents(schedule, from, withinDays) {
  // schedule: { bedtime: '22:30', days: ['mon','tue','wed','thu','fri','sat','sun'], action: 'shutdown' }
  const days = schedule?.days || ['mon','tue','wed','thu','fri','sat','sun'];
  const bedtime = schedule?.bedtime || '22:30';
  const action = schedule?.action || 'shutdown';
  const [h, m] = bedtime.split(':').map(Number);
  const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const targetDays = days.map(d => dayMap[d.toLowerCase()]).filter(n => n !== undefined);

  const events = [];
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const cutoff = new Date(start.getTime() + withinDays * 86400000);

  for (let d = new Date(start); d <= cutoff; d.setDate(d.getDate() + 1)) {
    if (targetDays.includes(d.getDay())) {
      const evtStart = new Date(d);
      evtStart.setHours(h, m, 0, 0);
      if (evtStart > from) {
        events.push({
          uid: `lo-default-${d.toISOString().slice(0, 10)}`,
          summary: 'Bedtime',
          start: evtStart,
          end: new Date(evtStart.getTime() + 3600000),
          location: '',
          source: 'builtin',
          action
        });
      }
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Calendar API (using service account or API key)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGoogleEvents(apiKey, calendarId, from, withinDays, maxResults = 50) {
  if (!apiKey || !calendarId) return [];
  const timeMin = from.toISOString();
  const timeMax = new Date(from.getTime() + withinDays * 86400000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?key=${apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=${maxResults}`;

  try {
    const response = await fetchWithTimeout(url, 10000);
    const data = JSON.parse(response);
    if (!data.items) return [];
    return data.items.map(item => ({
      uid: item.id,
      summary: item.summary || 'Event',
      start: parseGoogleDate(item.start),
      end: parseGoogleDate(item.end),
      location: item.location || '',
      source: 'google'
    })).filter(e => e.start);
  } catch (err) {
    console.error('Google Calendar fetch failed:', err.message);
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

async function fetchOutlookEvents(accessToken, from, withinDays, maxResults = 50) {
  if (!accessToken) return [];
  const timeMin = from.toISOString();
  const timeMax = new Date(from.getTime() + withinDays * 86400000).toISOString();
  const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${timeMin}&endDateTime=${timeMax}&$top=${maxResults}&$orderby=start/dateTime`;

  try {
    const response = await fetchWithTimeout(url, 10000, {
      Authorization: `Bearer ${accessToken}`
    });
    const data = JSON.parse(response);
    if (!data.value) return [];
    return data.value.map(item => ({
      uid: item.id,
      summary: item.subject || 'Event',
      start: new Date(item.start.dateTime + (item.start.timeZone ? '' : 'Z')),
      end: new Date(item.end.dateTime + (item.end.timeZone ? '' : 'Z')),
      location: item.location?.displayName || '',
      source: 'outlook'
    })).filter(e => e.start && !isNaN(e.start.getTime()));
  } catch (err) {
    console.error('Outlook Calendar fetch failed:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendly API (personal access token)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCalendlyEvents(personalToken, from, withinDays) {
  if (!personalToken) return [];
  const timeMin = from.toISOString();
  const timeMax = new Date(from.getTime() + withinDays * 86400000).toISOString();
  // First get the user URI.
  try {
    const userResp = await fetchWithTimeout('https://api.calendly.com/users/me', 10000, {
      Authorization: `Bearer ${personalToken}`
    });
    const userData = JSON.parse(userResp);
    const userUri = userData.resource?.uri;
    if (!userUri) return [];

    const url = `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${timeMin}&max_start_time=${timeMax}`;
    const eventsResp = await fetchWithTimeout(url, 10000, {
      Authorization: `Bearer ${personalToken}`
    });
    const eventsData = JSON.parse(eventsResp);
    if (!eventsData.collection) return [];

    return eventsData.collection.map(item => ({
      uid: item.uri,
      summary: item.name || 'Calendly Event',
      start: new Date(item.start_time),
      end: new Date(item.end_time),
      location: item.location?.location || '',
      source: 'calendly'
    })).filter(e => e.start && !isNaN(e.start.getTime()));
  } catch (err) {
    console.error('Calendly fetch failed:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ICS URL feed (existing calendar.js)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchIcsEvents(url, from, withinDays) {
  if (!url) return [];
  try {
    const result = await icsParser.importIcsFromUrl(url);
    return icsParser.getUpcomingEvents(result.events, from, withinDays).map(e => ({
      ...e,
      source: 'ical'
    }));
  } catch (err) {
    console.error('ICS feed fetch failed:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified fetch: pulls from all configured providers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAllEvents(config, from, withinDays = 14) {
  const allEvents = [];

  // Built-in default calendar.
  if (config.builtin?.enabled !== false) {
    const builtinEvents = getDefaultCalendarEvents(config.builtin, from, withinDays);
    allEvents.push(...builtinEvents);
  }

  // ICS feed.
  if (config.ical?.url) {
    const icsEvents = await fetchIcsEvents(config.ical.url, from, withinDays);
    allEvents.push(...icsEvents);
  }

  // Google Calendar.
  if (config.google?.apiKey && config.google?.calendarId) {
    const gcalEvents = await fetchGoogleEvents(config.google.apiKey, config.google.calendarId, from, withinDays);
    allEvents.push(...gcalEvents);
  }

  // Outlook.
  if (config.outlook?.accessToken) {
    const outlookEvents = await fetchOutlookEvents(config.outlook.accessToken, from, withinDays);
    allEvents.push(...outlookEvents);
  }

  // Calendly.
  if (config.calendly?.personalToken) {
    const calendlyEvents = await fetchCalendlyEvents(config.calendly.personalToken, from, withinDays);
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
  fetchAllEvents
};
