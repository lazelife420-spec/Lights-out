// Calendar Module for Lights Out Electron
// Ported from PowerShell LightsOut.Calendar.psm1
// Parses iCalendar (.ics) files for scheduled shutdowns

const https = require('https');
const http = require('http');

const MAX_ICS_BYTES = 5 * 1024 * 1024; // 5 MB cap matching calendarProviders.js
// One version-less User-Agent for every calendar fetch (this module and
// calendarProviders.js), so feed hosts are never sent a stale app version.
const CALENDAR_USER_AGENT = 'LightsOut CalendarSync';

// ─────────────────────────────────────────────────────────────────────────────
// ICS Line Processing
// ─────────────────────────────────────────────────────────────────────────────

function expandIcsLines(lines) {
  const out = [];
  for (const line of lines) {
    if (line.match(/^[ \t]/) && line.trim() && out.length > 0) {
      // RFC 5545 §3.1: unfolding removes only the single fold space/tab.
      out[out.length - 1] = out[out.length - 1] + line.slice(1);
    } else if (line.trim()) {
      out.push(line.trim());
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ICS time zones (RFC 5545 TZID)
// ─────────────────────────────────────────────────────────────────────────────
// A DTSTART/DTEND with ;TZID=<zone> is a wall time in that zone, not in this
// PC's zone. IANA ids are converted through Intl. Outlook/Exchange send Windows
// zone names, so the common ones map to IANA (CLDR windowsZones, territory
// "001"). A TZID that still cannot be resolved (a custom VTIMEZONE name, a
// display name, an ambiguous abbreviation such as BST or IST) keeps the old
// host-local reading so the event stays listed, and
// the event is flagged timeZoneUnresolved: its instant is not trusted for an
// automatic start (calendarProviders.eventTimeIsTrusted).
const WINDOWS_TIME_ZONES = {
  'dateline standard time': 'Etc/GMT+12', 'utc-11': 'Etc/GMT+11', 'aleutian standard time': 'America/Adak',
  'hawaiian standard time': 'Pacific/Honolulu', 'marquesas standard time': 'Pacific/Marquesas',
  'alaskan standard time': 'America/Anchorage', 'utc-09': 'Etc/GMT+9', 'pacific standard time (mexico)': 'America/Tijuana',
  'utc-08': 'Etc/GMT+8', 'pacific standard time': 'America/Los_Angeles', 'us mountain standard time': 'America/Phoenix',
  'mountain standard time (mexico)': 'America/Mazatlan', 'mountain standard time': 'America/Denver',
  'yukon standard time': 'America/Whitehorse', 'central america standard time': 'America/Guatemala',
  'central standard time': 'America/Chicago', 'easter island standard time': 'Pacific/Easter',
  'central standard time (mexico)': 'America/Mexico_City', 'canada central standard time': 'America/Regina',
  'sa pacific standard time': 'America/Bogota', 'eastern standard time (mexico)': 'America/Cancun',
  'eastern standard time': 'America/New_York', 'haiti standard time': 'America/Port-au-Prince',
  'cuba standard time': 'America/Havana', 'us eastern standard time': 'America/Indiana/Indianapolis',
  'turks and caicos standard time': 'America/Grand_Turk', 'paraguay standard time': 'America/Asuncion',
  'atlantic standard time': 'America/Halifax', 'venezuela standard time': 'America/Caracas',
  'central brazilian standard time': 'America/Cuiaba', 'sa western standard time': 'America/La_Paz',
  'pacific sa standard time': 'America/Santiago', 'newfoundland standard time': 'America/St_Johns',
  'tocantins standard time': 'America/Araguaina', 'e. south america standard time': 'America/Sao_Paulo',
  'sa eastern standard time': 'America/Cayenne', 'argentina standard time': 'America/Argentina/Buenos_Aires',
  'greenland standard time': 'America/Nuuk', 'montevideo standard time': 'America/Montevideo',
  'magallanes standard time': 'America/Punta_Arenas', 'saint pierre standard time': 'America/Miquelon',
  'bahia standard time': 'America/Bahia', 'utc-02': 'Etc/GMT+2', 'mid-atlantic standard time': 'Etc/GMT+2',
  'azores standard time': 'Atlantic/Azores', 'cape verde standard time': 'Atlantic/Cape_Verde',
  'utc': 'Etc/UTC', 'coordinated universal time': 'Etc/UTC', 'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik', 'sao tome standard time': 'Africa/Sao_Tome',
  'morocco standard time': 'Africa/Casablanca', 'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest', 'romance standard time': 'Europe/Paris',
  'central european standard time': 'Europe/Warsaw', 'w. central africa standard time': 'Africa/Lagos',
  'jordan standard time': 'Asia/Amman', 'gtb standard time': 'Europe/Bucharest',
  'middle east standard time': 'Asia/Beirut', 'egypt standard time': 'Africa/Cairo',
  'e. europe standard time': 'Europe/Chisinau', 'syria standard time': 'Asia/Damascus',
  'west bank standard time': 'Asia/Hebron', 'south africa standard time': 'Africa/Johannesburg',
  'fle standard time': 'Europe/Kyiv', 'israel standard time': 'Asia/Jerusalem',
  'south sudan standard time': 'Africa/Juba', 'kaliningrad standard time': 'Europe/Kaliningrad',
  'sudan standard time': 'Africa/Khartoum', 'libya standard time': 'Africa/Tripoli',
  'namibia standard time': 'Africa/Windhoek', 'arabic standard time': 'Asia/Baghdad',
  'turkey standard time': 'Europe/Istanbul', 'arab standard time': 'Asia/Riyadh',
  'belarus standard time': 'Europe/Minsk', 'russian standard time': 'Europe/Moscow',
  'e. africa standard time': 'Africa/Nairobi', 'volgograd standard time': 'Europe/Volgograd',
  'iran standard time': 'Asia/Tehran', 'arabian standard time': 'Asia/Dubai',
  'astrakhan standard time': 'Europe/Astrakhan', 'azerbaijan standard time': 'Asia/Baku',
  'russia time zone 3': 'Europe/Samara', 'mauritius standard time': 'Indian/Mauritius',
  'saratov standard time': 'Europe/Saratov', 'georgian standard time': 'Asia/Tbilisi',
  'caucasus standard time': 'Asia/Yerevan', 'afghanistan standard time': 'Asia/Kabul',
  'west asia standard time': 'Asia/Tashkent', 'qyzylorda standard time': 'Asia/Qyzylorda',
  'ekaterinburg standard time': 'Asia/Yekaterinburg', 'pakistan standard time': 'Asia/Karachi',
  'india standard time': 'Asia/Kolkata', 'sri lanka standard time': 'Asia/Colombo',
  'nepal standard time': 'Asia/Kathmandu', 'central asia standard time': 'Asia/Bishkek',
  'bangladesh standard time': 'Asia/Dhaka', 'omsk standard time': 'Asia/Omsk',
  'myanmar standard time': 'Asia/Yangon', 'se asia standard time': 'Asia/Bangkok',
  'altai standard time': 'Asia/Barnaul', 'w. mongolia standard time': 'Asia/Hovd',
  'north asia standard time': 'Asia/Krasnoyarsk', 'n. central asia standard time': 'Asia/Novosibirsk',
  'tomsk standard time': 'Asia/Tomsk', 'china standard time': 'Asia/Shanghai',
  'north asia east standard time': 'Asia/Irkutsk', 'singapore standard time': 'Asia/Singapore',
  'w. australia standard time': 'Australia/Perth', 'taipei standard time': 'Asia/Taipei',
  'ulaanbaatar standard time': 'Asia/Ulaanbaatar', 'aus central w. standard time': 'Australia/Eucla',
  'transbaikal standard time': 'Asia/Chita', 'tokyo standard time': 'Asia/Tokyo',
  'north korea standard time': 'Asia/Pyongyang', 'korea standard time': 'Asia/Seoul',
  'yakutsk standard time': 'Asia/Yakutsk', 'cen. australia standard time': 'Australia/Adelaide',
  'aus central standard time': 'Australia/Darwin', 'e. australia standard time': 'Australia/Brisbane',
  'aus eastern standard time': 'Australia/Sydney', 'west pacific standard time': 'Pacific/Port_Moresby',
  'tasmania standard time': 'Australia/Hobart', 'vladivostok standard time': 'Asia/Vladivostok',
  'lord howe standard time': 'Australia/Lord_Howe', 'bougainville standard time': 'Pacific/Bougainville',
  'russia time zone 10': 'Asia/Srednekolymsk', 'magadan standard time': 'Asia/Magadan',
  'norfolk standard time': 'Pacific/Norfolk', 'sakhalin standard time': 'Asia/Sakhalin',
  'central pacific standard time': 'Pacific/Guadalcanal', 'russia time zone 11': 'Asia/Kamchatka',
  'new zealand standard time': 'Pacific/Auckland', 'utc+12': 'Etc/GMT-12', 'fiji standard time': 'Pacific/Fiji',
  'chatham islands standard time': 'Pacific/Chatham', 'utc+13': 'Etc/GMT-13', 'tonga standard time': 'Pacific/Tongatapu',
  'samoa standard time': 'Pacific/Apia', 'line islands standard time': 'Pacific/Kiritimati'
};

const MAX_ZONE_CACHE = 64; // a hostile feed can name many zones; keep the cache bounded
// Intl lookups for distinct uncached TZIDs allowed per parse. Each failed
// Intl.DateTimeFormat construction costs tens of microseconds, so a feed that
// gives every event a different TZID must not turn one poll into seconds of
// main-process work. Past the budget an id is unresolved (listed, untrusted).
const MAX_ZONE_LOOKUPS_PER_PARSE = 64;
let zoneLookupBudget = Infinity;
const zoneCache = new Map();
const zoneFormatters = new Map();

function intlZone(name) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// Single-segment ids that name exactly one zone. ICU also accepts its legacy
// three-letter ids (BST -> Asia/Dhaka, IST -> Asia/Calcutta, AST ->
// America/Anchorage, NST -> Pacific/Auckland, EST -> America/Panama), which a
// feed almost never means (British Summer, Irish or Israel, Atlantic, ...), so
// any other bare id stays unresolved: listed, never trusted for auto-start.
const UNAMBIGUOUS_SINGLE_SEGMENT_ZONES = new Set([
  'utc', 'gmt', 'uct', 'zulu', 'universal', 'greenwich', 'est5edt', 'cst6cdt', 'mst7mdt', 'pst8pdt'
]);

// Whether an id may be handed to Intl: an Area/Location id (every segment
// non-empty, no whitespace; Etc/* included) or an allowlisted single segment.
function isUnambiguousZoneId(id) {
  return /^[^/\s]+(?:\/[^/\s]+)+$/.test(id) || UNAMBIGUOUS_SINGLE_SEGMENT_ZONES.has(id.toLowerCase());
}

// Returns an IANA zone id Intl can use, or null when the TZID is unknown or
// ambiguous.
function resolveIcsTimeZone(tzid) {
  const raw = String(tzid || '').trim().replace(/^"(.*)"$/, '$1').trim();
  if (!raw || raw.length > 128) return null;
  if (zoneCache.has(raw)) return zoneCache.get(raw);
  if (zoneLookupBudget <= 0) return null;
  zoneLookupBudget--;
  let zone = null;
  const windows = WINDOWS_TIME_ZONES[raw.toLowerCase()];
  if (windows) zone = intlZone(windows);
  // A Windows name never contains '/', and an IANA id never contains a space.
  if (!zone && isUnambiguousZoneId(raw)) zone = intlZone(raw);
  // Prefixed ids, e.g. /mozilla.org/20050126_1/America/New_York,
  // /freeassociation.sourceforge.net/Tzfile/Europe/London or
  // tzone://Microsoft/Utc: the longest trailing path that Intl knows, under
  // the same rule (so Custom/BST stays unresolved).
  if (!zone && raw.includes('/') && !/\s/.test(raw)) {
    const parts = raw.split('/').filter(Boolean);
    // An IANA id has at most three segments (America/Argentina/Buenos_Aires),
    // so only the last three suffixes are candidates; starting at the whole
    // remaining path also resolves the RFC 5545 form "/America/New_York".
    for (let i = Math.max(0, parts.length - 3); i < parts.length && !zone; i++) {
      const suffix = parts.slice(i).join('/');
      if (isUnambiguousZoneId(suffix)) zone = intlZone(suffix);
    }
  }
  if (zoneCache.size >= MAX_ZONE_CACHE) zoneCache.clear();
  zoneCache.set(raw, zone);
  return zone;
}

function zoneFormatter(zone) {
  let f = zoneFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    if (zoneFormatters.size >= MAX_ZONE_CACHE) zoneFormatters.clear();
    zoneFormatters.set(zone, f);
  }
  return f;
}

// UTC offset (ms) of `zone` at the instant `ms`.
function zoneOffsetMs(zone, ms) {
  const base = Math.floor(ms / 1000) * 1000;
  const parts = {};
  for (const p of zoneFormatter(zone).formatToParts(new Date(base))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second)) - base;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Per zone and wall date: the UTC offset when it is the same from a day before
// to a day after that date (no transition near it), else NaN. A large feed then
// costs two Intl lookups per distinct day instead of up to six per value.
const MAX_DAY_OFFSET_CACHE = 4096;
const dayOffsetCache = new Map();

function steadyDayOffset(zone, year, month, day) {
  const key = `${zone}|${year}-${month}-${day}`;
  if (dayOffsetCache.has(key)) return dayOffsetCache.get(key);
  const dayStart = Date.UTC(year, month, day);
  const before = zoneOffsetMs(zone, dayStart - DAY_MS), after = zoneOffsetMs(zone, dayStart + 2 * DAY_MS);
  const value = before === after ? before : NaN;
  if (dayOffsetCache.size >= MAX_DAY_OFFSET_CACHE) dayOffsetCache.clear();
  dayOffsetCache.set(key, value);
  return value;
}

// The instant of a wall time in `zone`, per RFC 5545 §3.3.5: a wall time that
// occurs twice (clocks go back) is its FIRST occurrence; a wall time skipped by
// a forward jump is read with the UTC offset from BEFORE the gap (so 02:30 on a
// spring-forward night becomes 03:30 local). Deterministic for every zone.
function zonedWallTimeToDate(zone, year, month, day, hour, minute, second) {
  const wall = Date.UTC(year, month, day, hour, minute, second);
  if (!Number.isFinite(wall)) return null;
  const wallDate = new Date(wall); // normalizes out-of-range fields (e.g. hour 24)
  const steady = steadyDayOffset(zone, wallDate.getUTCFullYear(), wallDate.getUTCMonth(), wallDate.getUTCDate());
  if (Number.isFinite(steady)) return new Date(wall - steady);
  const offsets = new Set([zoneOffsetMs(zone, wall - DAY_MS), zoneOffsetMs(zone, wall), zoneOffsetMs(zone, wall + DAY_MS)]);
  const candidates = [...offsets].map(offset => wall - offset).sort((a, b) => a - b);
  const valid = candidates.filter(t => zoneOffsetMs(zone, t) === wall - t);
  if (valid.length) return new Date(valid[0]);
  return new Date(wall - zoneOffsetMs(zone, candidates[0]));
}

// ─────────────────────────────────────────────────────────────────────────────
// ICS Date/Time Parsing
// ─────────────────────────────────────────────────────────────────────────────

function convertFromIcsDateTime(value, propLine = '') {
  return parseIcsDateTime(value, propLine).date;
}

// { date, timeZoneUnresolved }. UTC ('Z') and floating (no TZID) values are
// unchanged: UTC is exact, floating is this PC's local wall time.
function parseIcsDateTime(value, propLine = '') {
  if (!value) return { date: null, timeZoneUnresolved: false };
  value = value.trim();

  // Date-only format: 20240115
  if (value.match(/^\d{8}$/)) {
    const year = parseInt(value.substring(0, 4), 10);
    const month = parseInt(value.substring(4, 6), 10);
    const day = parseInt(value.substring(6, 8), 10);
    const date = new Date(year, month - 1, day, 0, 0, 0);
    return { date: isNaN(date.getTime()) ? null : date, timeZoneUnresolved: false };
  }

  // Remove trailing Z for UTC parsing
  const isUTC = value.endsWith('Z');
  const v = value.replace(/Z$/, '');
  // RFC 5545: TZID never applies to a UTC ('Z') value.
  const tzid = isUTC ? null : readIcsParameter(propLine, 'TZID');
  const zone = tzid ? resolveIcsTimeZone(tzid) : null;
  const timeZoneUnresolved = Boolean(tzid) && !zone;
  
  const formats = [
    { regex: /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, indices: [1, 2, 3, 4, 5, 6] },
    { regex: /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/, indices: [1, 2, 3, 4, 5] },
    { regex: /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/, indices: [1, 2, 3, 4, 5, 6] },
    { regex: /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/, indices: [1, 2, 3, 4, 5, 6] },
    { regex: /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/, indices: [1, 2, 3, 4, 5] }
  ];
  
  for (const fmt of formats) {
    const match = v.match(fmt.regex);
    if (match) {
      const year = parseInt(match[fmt.indices[0]], 10);
      const month = parseInt(match[fmt.indices[1]], 10) - 1;
      const day = parseInt(match[fmt.indices[2]], 10);
      const hour = parseInt(match[fmt.indices[3]], 10);
      const minute = fmt.indices[4] ? parseInt(match[fmt.indices[4]], 10) : 0;
      const second = fmt.indices[5] && match[fmt.indices[5]] ? parseInt(match[fmt.indices[5]], 10) : 0;
      
      let date;
      if (isUTC) {
        // Date.UTC already yields the exact UTC epoch instant; do NOT apply
        // getTimezoneOffset() again or UTC events shift by the host offset.
        date = new Date(Date.UTC(year, month, day, hour, minute, second));
      } else if (zone) {
        date = zonedWallTimeToDate(zone, year, month, day, hour, minute, second);
      } else {
        date = new Date(year, month, day, hour, minute, second);
      }

      if (date && !isNaN(date.getTime())) return { date, timeZoneUnresolved };
    }
  }

  // Fallback to native parsing. A TZID it could not apply is not trusted.
  try {
    const date = new Date(value);
    return isNaN(date.getTime()) ? { date: null, timeZoneUnresolved: false } : { date, timeZoneUnresolved: Boolean(tzid) };
  } catch {
    return { date: null, timeZoneUnresolved: false };
  }
}

// Index of the ':' that separates name;params from the value. A quoted
// parameter value may itself contain ':' (TZID="(UTC-08:00) Pacific Time").
function icsValueColon(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) return i;
  }
  return line.indexOf(':'); // unbalanced quotes: fall back to the first colon
}

function readIcsPropertyValue(line) {
  const colon = icsValueColon(line);
  if (colon < 0) return null;
  return line.substring(colon + 1).trim();
}

function getIcsPropertyName(line) {
  const colon = icsValueColon(line);
  if (colon < 0) return line.toUpperCase();
  const head = line.substring(0, colon);
  return head.split(';')[0].toUpperCase();
}

// A property parameter value (case-insensitive name, quotes removed), or null.
function readIcsParameter(line, param) {
  if (!line) return null;
  const colon = icsValueColon(line);
  const head = colon < 0 ? line : line.substring(0, colon);
  const parts = [];
  let current = '', quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) { parts.push(current); current = ''; } else current += ch;
  }
  parts.push(current);
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.substring(0, eq).trim().toUpperCase() === param) {
      const v = part.substring(eq + 1).trim().replace(/^"(.*)"$/, '$1').trim();
      return v || null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ICS Content Parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseIcsContent(text) {
  if (!text) return [];
  zoneLookupBudget = MAX_ZONE_LOOKUPS_PER_PARSE;
  try {
    return parseIcsEvents(text);
  } finally {
    zoneLookupBudget = Infinity;
  }
}

function parseIcsEvents(text) {

  const lines = expandIcsLines(text.split(/\r?\n/));
  const events = [];
  let inEvent = false;
  let nestedDepth = 0;
  let currentEvent = { uid: '', summary: 'Event', start: null, end: null, location: '' };
  
  for (const line of lines) {
    const name = getIcsPropertyName(line);
    
    switch (name) {
      case 'BEGIN': {
        const comp = (readIcsPropertyValue(line) || '').toUpperCase();
        if (comp === 'VEVENT' && !inEvent) {
          inEvent = true;
          nestedDepth = 0;
          currentEvent = { uid: '', summary: 'Event', start: null, end: null, location: '' };
        } else if (inEvent) {
          // Track nested sub-components (e.g. VALARM) so their SUMMARY/DTSTART
          // never overwrite the enclosing VEVENT's properties.
          nestedDepth++;
        }
        break;
      }
      case 'END': {
        const comp = (readIcsPropertyValue(line) || '').toUpperCase();
        if (inEvent && nestedDepth > 0) {
          nestedDepth--;
        } else if (inEvent && comp === 'VEVENT') {
          if (currentEvent.start) {
            const event = {
              uid: currentEvent.uid || generateUid(),
              summary: currentEvent.summary || 'Event',
              start: currentEvent.start,
              end: currentEvent.end || new Date(currentEvent.start.getTime() + 60 * 60 * 1000),
              location: currentEvent.location || ''
            };
            // Listed at this PC's wall time, but its real instant is unknown.
            if (currentEvent.timeZoneUnresolved) event.timeZoneUnresolved = true;
            events.push(event);
          }
          inEvent = false;
          nestedDepth = 0;
          currentEvent = { uid: '', summary: 'Event', start: null, end: null, location: '' };
        }
        break;
      }
      default: {
        if (!inEvent || nestedDepth > 0) continue;
        const value = readIcsPropertyValue(line);
        if (!value) continue;
        
        if (name === 'UID') {
          currentEvent.uid = value;
        } else if (name === 'SUMMARY') {
          currentEvent.summary = value.replace(/\\n/g, ' ').replace(/\\,/g, ',');
        } else if (name === 'LOCATION') {
          currentEvent.location = value.replace(/\\,/g, ',');
        } else if (name === 'DTSTART' || name === 'DTEND') {
          const parsed = parseIcsDateTime(value, line);
          currentEvent[name === 'DTSTART' ? 'start' : 'end'] = parsed.date;
          if (parsed.date && parsed.timeZoneUnresolved) currentEvent.timeZoneUnresolved = true;
        }
        break;
      }
    }
  }
  
  return events;
}

function generateUid() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// ─────────────────────────────────────────────────────────────────────────────
// File Import
// ─────────────────────────────────────────────────────────────────────────────

function importIcsFromText(text, sourceName = 'Imported') {
  if (!text || !text.includes('BEGIN:VCALENDAR')) {
    throw new Error('Invalid iCalendar file: missing VCALENDAR header');
  }
  
  const events = parseIcsContent(text);
  return {
    source: sourceName,
    events: events,
    count: events.length
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Import
// ─────────────────────────────────────────────────────────────────────────────

function testCalendarFeedUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!u.startsWith('https://')) return false;
  if (/\s/.test(u)) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

// timeoutMs is the socket idle timeout; deadlineMs bounds the whole download,
// so a feed that trickles bytes (or a connection that never finishes) always
// settles and can never hold the calendar auto-start poll.
async function importIcsFromUrl(url, timeoutMs = 45000, deadlineMs = 2 * timeoutMs) {
  if (!testCalendarFeedUrl(url)) {
    throw new Error('Calendar feed must be an https URL (Google Calendar secret iCal link or hosted .ics)');
  }

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url.trim());
    const client = urlObj.protocol === 'https:' ? https : http;
    let settled = false;
    let deadline = null;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (err) reject(err);
      else resolve(value);
    };
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || undefined,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        'User-Agent': CALENDAR_USER_AGENT
      }
    };
    
    const req = client.request(options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        req.destroy();
        done(new Error(`HTTP ${res.statusCode}: Failed to fetch calendar`));
        return;
      }
      
      // Bytes are joined before decoding, so a UTF-8 character split across
      // two chunks is never garbled.
      const chunks = [];
      let byteCount = 0;
      res.on('data', chunk => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        byteCount += bytes.length;
        if (byteCount > MAX_ICS_BYTES) {
          res.resume();
          req.destroy();
          done(Object.assign(new Error('Calendar feed exceeds 5 MB limit'), { code: 'CALENDAR_FEED_TOO_LARGE' }));
          return;
        }
        chunks.push(bytes);
      });
      res.on('error', err => done(err));
      // A connection closed before the body completed never resolves as a feed.
      res.on('close', () => { if (!res.complete) done(new Error('Calendar feed connection closed early')); });
      res.on('end', () => {
        if (settled) return;
        const data = Buffer.concat(chunks).toString('utf8');
        if (!data || !data.includes('BEGIN:VCALENDAR')) {
          done(new Error('Downloaded feed is not a valid iCalendar file'));
          return;
        }
        
        try {
          const events = parseIcsContent(data);
          done(null, {
            source: url.trim(),
            events: events,
            count: events.length
          });
        } catch (error) {
          done(error);
        }
      });
    });
    
    req.on('error', err => done(err));
    req.on('timeout', () => {
      req.destroy();
      done(new Error('Request timeout'));
    });
    deadline = setTimeout(() => {
      req.destroy();
      done(new Error('Request timeout'));
    }, Math.max(1, Number(deadlineMs) || 2 * timeoutMs));

    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Filtering & Utilities
// ─────────────────────────────────────────────────────────────────────────────

function getUpcomingEvents(events, from = new Date(), withinDays = 90, maxCount = 50) {
  const cutoff = new Date(from.getTime() + withinDays * 24 * 60 * 60 * 1000);
  
  return events
    .filter(e => e.start && e.start > from && e.start <= cutoff)
    .sort((a, b) => a.start - b.start)
    .slice(0, maxCount);
}

function getNextEvent(events, from = new Date()) {
  const upcoming = getUpcomingEvents(events, from, 365, 1);
  return upcoming.length > 0 ? upcoming[0] : null;
}

function formatEventTime(date) {
  if (!date) return 'Unknown';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString() === date.toDateString();
  
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  
  if (isToday) return `Today at ${timeStr}`;
  if (isTomorrow) return `Tomorrow at ${timeStr}`;
  
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dateStr} at ${timeStr}`;
}

function calculateDurationToEvent(event, from = new Date()) {
  if (!event || !event.start) return null;
  const diffMs = event.start.getTime() - from.getTime();
  const seconds = Math.max(0, Math.round(diffMs / 1000));
  return seconds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer Profile Generation
// ─────────────────────────────────────────────────────────────────────────────

function createTimerFromEvent(event, action = 'shutdown', options = {}) {
  if (!event || !event.start) {
    return { success: false, error: 'Invalid event' };
  }
  
  const from = options.from || new Date();
  const durationSeconds = calculateDurationToEvent(event, from);
  
  if (durationSeconds <= 0) {
    return { success: false, error: 'Event has already started or passed' };
  }
  
  return {
    success: true,
    timerOptions: {
      durationSeconds,
      action,
      endsAt: event.start.toISOString(),
      dryRun: options.dryRun || false,
      forceShutdown: options.forceShutdown || false,
      muteSystem: options.muteSystem || false,
      gracePeriod: options.gracePeriod || 2
    },
    event: {
      uid: event.uid,
      summary: event.summary,
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
      location: event.location
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Parsing
  parseIcsContent,
  importIcsFromText,
  
  // URL import
  testCalendarFeedUrl,
  importIcsFromUrl,
  CALENDAR_USER_AGENT,

  // Filtering
  getUpcomingEvents,
  getNextEvent,
  
  // Utilities
  formatEventTime,
  calculateDurationToEvent,
  createTimerFromEvent,
  
  // Internal helpers (exposed for testing)
  convertFromIcsDateTime,
  parseIcsDateTime,
  resolveIcsTimeZone,
  WINDOWS_TIME_ZONES,
  expandIcsLines
};
