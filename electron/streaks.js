// Sleep streaks + insights engine.
// Records bedtime events and computes streaks, weekly stats, and achievements.

const path = require('path');
const { writeTmpVerifyRename, safeLoadJson } = require('./durableJsonStore');

const STREAKS_FILE = 'streaks.json';

let cache = null;

const DEFAULTS = {
  // New events: { date: <nightKey>, bedTime, action, snoozed, source: 'real' }.
  // Legacy events (no source) keep their original UTC date keys; they are never
  // rewritten. Any event flagged testMode === true is kept but never counted.
  events: [],       // [{ date: '2026-06-10', bedTime: '22:30', action: 'shutdown', snoozed: false }]
  streak: 0,
  bestStreak: 0,
  achievements: []  // ['first_light', '7_night_streak', ...]
};

function getConfigPath() {
  let userDataDir;
  try {
    const { app } = require('electron');
    userDataDir = app.getPath('userData');
  } catch {
    const os = require('os');
    userDataDir = os.tmpdir();
  }
  return path.join(userDataDir, STREAKS_FILE);
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function load() {
  if (cache) return cache;
  try {
    const file = getConfigPath();
    const { data, recovered } = safeLoadJson(file);
    if (data && typeof data === 'object') {
      cache = deepMerge(clone(DEFAULTS), data);
      if (recovered) save();
    } else {
      cache = clone(DEFAULTS);
    }
  } catch {
    cache = clone(DEFAULTS);
  }
  return cache;
}

function save() {
  if (!cache) return;
  try {
    writeTmpVerifyRename(getConfigPath(), cache);
  } catch { /* best-effort */ }
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ─────────────────────────────────────────────────────────────────────────────
// Night keys and read-time truth
// ─────────────────────────────────────────────────────────────────────────────

// A "night" is a local calendar date, shifted back 6 hours so a 00:30 run
// belongs to the previous evening's night.
const NIGHT_OFFSET_MS = 6 * 3600 * 1000;

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nightKey(d = new Date()) {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return localDateKey(new Date(t - NIGHT_OFFSET_MS));
}

// Shift a YYYY-MM-DD key by whole local calendar days (DST-safe).
function shiftKey(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + days));
}

// Only real completions count. Events flagged testMode stay on disk but are
// excluded from every count, streak and achievement.
function isCounted(e) {
  return Boolean(e) && typeof e.date === 'string' && e.testMode !== true;
}

function countedEvents(events) {
  return (Array.isArray(events) ? events : []).filter(isCounted);
}

// New events carry source:'real'; anything counted without it predates Test
// Mode tracking and cannot be told apart (it may have been a Test Mode run).
function isRealSourced(e) {
  return Boolean(e) && e.source === 'real';
}

// Legacy events (no source) were keyed by the UTC date of the moment they were
// written, and their bedTime is the LOCAL time of that same moment (old
// recordEvent: date = toISOString().slice(0, 10), bedTime = formatTime()).
// Together they pin the local night without rewriting anything on disk: find
// the local date whose bedTime instant has that UTC date. A 23:00 run in New
// York was stored under the next UTC day; this reads it back as its own night,
// so it can't collide with the following night's REAL event. Anything that
// can't be resolved keeps its stored date.
function legacyNightKey(e) {
  const date = String(e.date);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(e.bedTime || ''));
  if (!dm || !tm) return date;
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (h > 23 || mi > 59) return date;
  for (const k of [0, -1, 1]) {
    const local = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]) + k, h, mi);
    if (!Number.isNaN(local.getTime()) && local.toISOString().slice(0, 10) === date) return nightKey(local);
  }
  return date;
}

// The night an event belongs to. REAL events are already keyed by nightKey(),
// and an entry from countedNights() (it carries storedDate) is already mapped,
// so mapping is never applied twice.
function nightOf(e) {
  if (isRealSourced(e) || typeof e.storedDate === 'string') return e.date;
  return legacyNightKey(e);
}

// Every count is per NIGHT, never per event: one entry per night over the
// counted events, sorted oldest first, with date = that night. A REAL event
// wins over a legacy one on the same night; otherwise the later entry wins
// (the old one-event-per-day rule). storedDate keeps the on-disk key.
function countedNights(events) {
  const byNight = new Map();
  for (const e of countedEvents(events)) {
    const night = nightOf(e);
    const prev = byNight.get(night);
    if (prev && isRealSourced(prev) && !isRealSourced(e)) continue;
    byNight.set(night, { ...e, date: night, storedDate: e.date });
  }
  return [...byNight.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function nightDatesAsc(events) {
  return countedNights(events).map(e => e.date);
}

function dayGap(a, b) {
  // Both are date-only keys, parsed as UTC midnight: no DST drift.
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// Computed when read, never frozen at write time: 0 unless the newest counted
// night is tonight or last night, otherwise the length of the consecutive run.
function currentStreak(events, now = new Date()) {
  const dates = nightDatesAsc(events);
  if (!dates.length) return 0;
  const lastNight = shiftKey(nightKey(now), -1);
  // A legacy key that couldn't be resolved can sit one day "ahead" of the
  // local night key; anything at or after last night still counts as live.
  if (dates[dates.length - 1] < lastNight) return 0;
  let run = 1;
  for (let i = dates.length - 1; i > 0; i--) {
    if (dayGap(dates[i - 1], dates[i]) === 1) run++;
    else break;
  }
  return run;
}

// Full-history longest consecutive run over counted events.
function longestRun(events) {
  const dates = nightDatesAsc(events);
  if (!dates.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    run = dayGap(dates[i - 1], dates[i]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

// Callers only record REAL completions (main.js completeTimer and
// emergencyOverride skip Test Mode runs), so new events carry source:'real'.
function recordEvent(bedTime, action, snoozed) {
  const data = load();
  const tonight = nightKey();
  // One REAL event per night (the latest bedtime wins). Only earlier real
  // events for tonight are replaced: a legacy event (no source) is never
  // deleted, even when its old UTC date key equals tonight's local night key
  // (an evening run in a UTC-negative zone was keyed to the next UTC day).
  data.events = data.events.filter(e => !(e && e.source === 'real' && e.date === tonight));
  data.events.push({ date: tonight, bedTime: bedTime || formatTime(), action: action || 'shutdown', snoozed: Boolean(snoozed), source: 'real' });

  // Keep last 365 days.
  if (data.events.length > 365) data.events = data.events.slice(-365);

  // Stored for backward compatibility only; every read recomputes it.
  data.streak = currentStreak(data.events);
  data.bestStreak = Math.max(data.bestStreak || 0, data.streak);

  // Stored achievements only ever grow (kept for older builds that read the
  // file). Every read rebuilds them from the counted events instead, so a
  // stale stored id is never shown -- but the disk record is never narrowed.
  const stored = Array.isArray(data.achievements) ? data.achievements : [];
  data.achievements = [...stored, ...checkAchievements(data).filter(id => !stored.includes(id))];

  save();
  return getSummary();
}

// Rebuilt from an EMPTY list over counted nights every time -- never a union
// with stale stored achievements, so a Test Mode history unlocks nothing.
function checkAchievements(data) {
  const counted = countedNights(data && data.events);
  const unlocked = [];
  const add = (id) => { if (!unlocked.includes(id)) unlocked.push(id); };
  const best = longestRun(data && data.events);

  if (counted.length >= 1) add('first_light');
  if (counted.length >= 7) add('weekly_warrior');
  if (best >= 3) add('3_night_streak');
  if (best >= 7) add('7_night_streak');
  if (best >= 14) add('14_night_streak');
  if (best >= 30) add('30_night_streak');
  if (best >= 100) add('centurion');
  // No-snooze for 7 consecutive logged nights.
  for (let i = 0; i + 7 <= counted.length; i++) {
    if (counted.slice(i, i + 7).every(e => !e.snoozed)) { add('no_snooze_7'); break; }
  }
  // Used Last Light at least once.
  if (counted.some(e => e.action === 'lastlight')) add('last_light_activated');

  return unlocked;
}

// Read from the counted events, not the stored number: a stored bestStreak
// can predate this fix and include Test Mode runs, and the record must never
// show a figure the events can't back.
function readBestStreak(data) {
  return longestRun(data.events);
}

function getSummary() {
  const data = load();
  const week = getWeekStats(data.events);
  return {
    streak: currentStreak(data.events),
    bestStreak: readBestStreak(data),
    totalNights: countedNights(data.events).length,
    achievements: checkAchievements(data),
    weekAvg: week.avgBedTime,
    weekOnTime: week.onTimePercent,
    weekDays: week.days
  };
}

// The last 7 local nights, tonight included.
function weekStartKey(now = new Date()) {
  return shiftKey(nightKey(now), -6);
}

function getWeekStats(events, now = new Date()) {
  // Callers that pass nothing (statsDashboard, smartSuggestions) read the store.
  if (events === undefined) events = load().events;
  const weekAgo = weekStartKey(now);
  const recent = countedNights(events).filter(e => e.date >= weekAgo);
  if (!recent.length) return { avgBedTime: '--:--', onTimePercent: 0, days: [] };

  // Average bedtime.
  let totalMin = 0;
  const days = recent.map(e => {
    const [h, m] = (e.bedTime || '22:00').split(':').map(Number);
    const mins = (h * 60 + m);
    totalMin += mins;
    return { date: e.date, bedTime: e.bedTime, onTime: mins < 23 * 60, snoozed: e.snoozed };
  });
  const avgMin = Math.round(totalMin / recent.length);
  const avgH = Math.floor(avgMin / 60) % 24;
  const avgM = avgMin % 60;
  const onTimeCount = days.filter(d => d.onTime).length;

  return {
    avgBedTime: `${String(avgH).padStart(2, '0')}:${String(avgM).padStart(2, '0')}`,
    onTimePercent: recent.length ? Math.round(onTimeCount / recent.length * 100) : 0,
    days
  };
}

function getAchievementCatalog() {
  return [
    { id: 'first_light', name: 'First Light', desc: 'Completed your first bedtime ritual' },
    { id: 'weekly_warrior', name: 'Weekly Warrior', desc: '7 nights using Lights Out' },
    { id: '3_night_streak', name: 'Triple Threat', desc: '3-night sleep streak' },
    { id: '7_night_streak', name: 'Seven Strong', desc: '7-night sleep streak' },
    { id: '14_night_streak', name: 'Fortnight Force', desc: '14-night sleep streak' },
    { id: '30_night_streak', name: 'Monthly Monument', desc: '30-night sleep streak' },
    { id: 'centurion', name: 'Centurion', desc: 'Best streak of 100 nights' },
    { id: 'no_snooze_7', name: 'No Snooze Zone', desc: '7 nights with no snooze' },
    { id: 'last_light_activated', name: 'Last Light', desc: 'Used the Last Light finale' }
  ];
}

// Digital wellbeing report: a weekly summary with trend data.
// opts.receipts (optional): the run-receipt ledger, so Test Mode runs this week
// can be acknowledged even though they never become streak events.
// legacyEvents: counted events without source. An old build recorded Test
// Mode runs too, keyed by the run's UTC date with bedTime = the local time it
// was written (the same moment the receipt ended). A Test Mode receipt that
// matches a legacy event on both is the same run, already reported neutrally
// as a legacy night, so it is not counted again as "not counted". Each legacy
// event accounts for at most one receipt.
function sameRunAsLegacy(at, e) {
  if ((e.storedDate || e.date) !== at.toISOString().slice(0, 10)) return false;
  const [h, m] = String(e.bedTime || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return true; // date is all we have
  const diff = Math.abs((at.getHours() * 60 + at.getMinutes()) - (h * 60 + m));
  return Math.min(diff, 1440 - diff) <= 2;
}

function countTestModeReceipts(receipts, weekAgo, legacyEvents = []) {
  if (!Array.isArray(receipts)) return 0;
  const unmatched = [...legacyEvents];
  return receipts.filter(r => {
    if (!r || r.dryRun !== true || r.result !== 'dry_run_completed') return false;
    const at = new Date(r.endedAt || r.startedAt);
    if (Number.isNaN(at.getTime()) || nightKey(at) < weekAgo) return false;
    const i = unmatched.findIndex(e => sameRunAsLegacy(at, e));
    if (i === -1) return true;
    unmatched.splice(i, 1);
    return false;
  }).length;
}

function getWeeklyReport(opts = {}) {
  const data = load();
  const now = new Date();
  const weekAgo = weekStartKey(now);
  const weekEnd = nightKey(now);
  // Nights, not events: at most one entry per night, and the window is the
  // last 7 nights, so nightsThisWeek can never exceed 7.
  const counted = countedNights(data.events);
  const recent = counted.filter(e => e.date >= weekAgo && e.date <= weekEnd);
  const total = counted.length;
  const flaggedThisWeek = (data.events || []).filter(e => e && e.testMode === true && nightOf(e) >= weekAgo).length;
  const legacyEvents = counted.filter(e => !isRealSourced(e));
  // Flagged events and Test Mode receipts can describe the same run, so take
  // the larger count rather than summing them.
  const testModeRunsThisWeek = Math.max(flaggedThisWeek, countTestModeReceipts(opts && opts.receipts, weekAgo, legacyEvents));

  // Bedtime trend (last 7 days, oldest first).
  const trend = recent.map(e => {
    const [h, m] = (e.bedTime || '23:00').split(':').map(Number);
    return { date: e.date, bedTime: e.bedTime, mins: h * 60 + m };
  }).sort((a, b) => a.date.localeCompare(b.date));

  // Consistency: standard deviation of bedtimes (lower = more consistent).
  let consistency = 0;
  if (trend.length > 1) {
    const mean = trend.reduce((s, t) => s + t.mins, 0) / trend.length;
    const variance = trend.reduce((s, t) => s + Math.pow(t.mins - mean, 2), 0) / trend.length;
    consistency = Math.round(Math.sqrt(variance));
  }

  // Snooze rate.
  const snoozeCount = recent.filter(e => e.snoozed).length;
  const snoozeRate = recent.length ? Math.round(snoozeCount / recent.length * 100) : 0;

  // Action breakdown: every counted night, plus the subset recorded as REAL
  // completions (source:'real'). Legacy nights are reported separately.
  const actionCounts = {};
  const realActionCounts = {};
  let legacyNightsThisWeek = 0;
  recent.forEach(e => {
    actionCounts[e.action] = (actionCounts[e.action] || 0) + 1;
    if (isRealSourced(e)) realActionCounts[e.action] = (realActionCounts[e.action] || 0) + 1;
    else legacyNightsThisWeek++;
  });

  const report = {
    weekStart: weekAgo,
    weekEnd,
    nightsThisWeek: recent.length,
    totalNights: total,
    testModeRunsThisWeek,
    streak: currentStreak(data.events, now),
    bestStreak: readBestStreak(data),
    consistency,
    snoozeRate,
    actionCounts,
    realActionCounts,
    legacyNightsThisWeek,
    trend,
    achievements: checkAchievements(data)
  };
  report.narrative = buildWeeklyNarrative(report);
  return report;
}

// Turns a getWeeklyReport() result into a plain-text narrative -- every
// sentence is a direct readout of a field already computed above, no scoring
// or diagnosis layered on top (see Streaks pillar guardrail: no medical
// language, no fake scores not backed by actual events). Pure function so
// it's testable without touching the events store.
function buildWeeklyNarrative(report) {
  if (!report || !report.nightsThisWeek) {
    if (report && Number(report.testModeRunsThisWeek) > 0) {
      return 'No real completions this week. Test Mode runs are recorded in Proof but don\'t count toward your routine.';
    }
    return 'No nights logged this week yet. Start a timer tonight to begin this week\'s report.';
  }
  const lines = [];
  lines.push(`${report.nightsThisWeek} of the last 7 nights logged (${report.totalNights} total since you started).`);
  lines.push(`Current streak: ${report.streak} night${report.streak === 1 ? '' : 's'} (best ever: ${report.bestStreak}).`);
  if (report.trend.length > 1) {
    lines.push(`Bedtime varied by about ${report.consistency} minutes night to night this week.`);
  }
  lines.push(`Snoozed on ${report.snoozeRate}% of logged nights this week.`);
  // Only events recorded as REAL (source:'real') are called Real-mode. The
  // record is written before executePowerAction runs, so this states what was
  // completed in Real mode -- not that a power action ran.
  const actionParts = Object.entries(report.realActionCounts || {})
    .map(([action, count]) => `${count} ${action}`);
  if (actionParts.length) lines.push(`Real-mode completions: ${actionParts.join(', ')}.`);
  // Older nights can't be told apart (they may include Test Mode runs), so
  // they are stated neutrally, never as Real-mode.
  const legacyNights = Number(report.legacyNightsThisWeek) || 0;
  if (legacyNights > 0) {
    lines.push(`${legacyNights} logged night${legacyNights === 1 ? '' : 's'} ${legacyNights === 1 ? 'was' : 'were'} recorded before Test Mode tracking.`);
  }
  const testRuns = Number(report.testModeRunsThisWeek) || 0;
  if (testRuns > 0) {
    lines.push(`${testRuns} Test Mode run${testRuns === 1 ? '' : 's'} this week ${testRuns === 1 ? 'is' : 'are'} recorded in Proof and not counted.`);
  }
  // UI-R3 Fire 10: Routine no longer shows achievements, so the narrative
  // stops counting them (read-out only: report.achievements and every stored
  // field are unchanged).
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// App-use routine consistency: composite 0-100 score. This describes Lights Out
// completion timing and snooze behavior; it is not a sleep or health metric.
// ─────────────────────────────────────────────────────────────────────────────

function getSleepScore() {
  const data = load();
  const now = new Date();
  const recent30 = countedNights(data.events).filter(e => {
    const d = new Date(e.date + 'T12:00:00');
    return (now - d) < 30 * 86400000;
  });

  if (recent30.length < 3) return { score: null, label: 'Not enough data', breakdown: {} };

  // 1. Consistency (0-30): lower std dev = higher score.
  // Target: <30 min std dev = 30 points, >90 min = 0 points.
  const bedtimes = recent30.map(e => {
    const [h, m] = (e.bedTime || '23:00').split(':').map(Number);
    return h * 60 + m;
  });
  const mean = bedtimes.reduce((s, t) => s + t, 0) / bedtimes.length;
  const stdDev = Math.sqrt(bedtimes.reduce((s, t) => s + Math.pow(t - mean, 2), 0) / bedtimes.length);
  const consistencyScore = Math.round(Math.max(0, 30 * (1 - stdDev / 90)));

  // 2. On-time rate (0-25): % of nights before target bedtime.
  // Target bedtime: from settings or mean - 15 min.
  const targetBedtime = mean - 15;
  const onTimeCount = bedtimes.filter(t => t <= targetBedtime + 10).length; // 10 min grace
  const onTimeRate = onTimeCount / recent30.length;
  const onTimeScore = Math.round(25 * onTimeRate);

  // 3. No-snooze rate (0-25): % of nights without snooze.
  const noSnoozeCount = recent30.filter(e => !e.snoozed).length;
  const noSnoozeRate = noSnoozeCount / recent30.length;
  const noSnoozeScore = Math.round(25 * noSnoozeRate);

  // 4. Ritual completion (0-20): streak bonus + achievements.
  const streakNow = currentStreak(data.events, now);
  const achievementsNow = checkAchievements(data);
  const streakBonus = Math.min(10, streakNow * 2);
  const achievementBonus = Math.min(10, achievementsNow.length * 2);
  const ritualScore = streakBonus + achievementBonus;

  const totalScore = Math.min(100, consistencyScore + onTimeScore + noSnoozeScore + ritualScore);

  let label;
  if (totalScore >= 90) label = 'Very consistent';
  else if (totalScore >= 75) label = 'Consistent';
  else if (totalScore >= 60) label = 'Developing';
  else if (totalScore >= 40) label = 'Variable';
  else label = 'Sparse';

  return {
    score: totalScore,
    label,
    breakdown: {
      consistency: { score: consistencyScore, max: 30, stdDev: Math.round(stdDev) },
      onTime: { score: onTimeScore, max: 25, rate: Math.round(onTimeRate * 100) },
      noSnooze: { score: noSnoozeScore, max: 25, rate: Math.round(noSnoozeRate * 100) },
      ritual: { score: ritualScore, max: 20, streak: streakNow, achievements: achievementsNow.length }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trend View: weekly/monthly aggregates beyond the 30-day grid.
// Buckets the full stored event history (up to 365 days) by ISO-ish week
// (Monday-start) or calendar month, so long-term patterns are visible past
// what the 30-day grid and 7-day weekly report can show.
// ─────────────────────────────────────────────────────────────────────────────

function trendBucketKey(dateStr, granularity) {
  if (granularity === 'month') return dateStr.slice(0, 7); // YYYY-MM

  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  return localDateKey(monday); // bucket key = that week's Monday (local date)
}

function trendBucketLabel(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  const d = new Date(key + 'T12:00:00');
  return `Wk of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function getTrend(granularity = 'week', limit = 12) {
  const normGranularity = granularity === 'month' ? 'month' : 'week';
  const data = load();

  const buckets = new Map();
  for (const e of countedNights(data.events)) {
    const key = trendBucketKey(e.date, normGranularity);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }

  const sortedKeys = [...buckets.keys()].sort();
  const recentKeys = sortedKeys.slice(-Math.max(1, limit));

  return recentKeys.map(key => {
    const events = buckets.get(key);
    let totalMin = 0;
    let onTimeCount = 0;
    let snoozeCount = 0;
    for (const e of events) {
      const [h, m] = (e.bedTime || '23:00').split(':').map(Number);
      const mins = h * 60 + m;
      totalMin += mins;
      if (mins < 23 * 60) onTimeCount++;
      if (e.snoozed) snoozeCount++;
    }
    const avgMin = Math.round(totalMin / events.length);
    const avgH = Math.floor(avgMin / 60) % 24;
    const avgM = avgMin % 60;
    const periodLength = normGranularity === 'month' ? daysInMonth(key) : 7;

    return {
      key,
      label: trendBucketLabel(key, normGranularity),
      nights: events.length,
      periodLength,
      avgBedTime: `${String(avgH).padStart(2, '0')}:${String(avgM).padStart(2, '0')}`,
      onTimePercent: Math.round(onTimeCount / events.length * 100),
      snoozeRate: Math.round(snoozeCount / events.length * 100)
    };
  });
}

function daysInMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function exportData() {
  return clone(load());
}

function getHistory30() {
  const data = load();
  const tonight = nightKey(new Date());
  const counted = countedNights(data.events);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const dateStr = shiftKey(tonight, -i);
    // A Test-Mode-only night is not a filled cell.
    const found = counted.find(e => e.date === dateStr);
    days.push({
      date: dateStr,
      hasEvent: !!found,
      action: found ? found.action : null,
      snoozed: found ? found.snoozed : false,
      bedTime: found ? found.bedTime : null
    });
  }
  return days;
}

// Import/restore. Event fields (including source and testMode) and a top-level
// truthVersion round-trip untouched. Imported streak, bestStreak and
// achievements are recomputed from the counted events, never trusted.
function replaceAll(nextData) {
  const normalized = deepMerge(clone(DEFAULTS), nextData && typeof nextData === 'object' ? nextData : {});
  normalized.events = Array.isArray(normalized.events) ? normalized.events.slice(-365) : [];
  normalized.streak = currentStreak(normalized.events);
  normalized.bestStreak = longestRun(normalized.events);
  normalized.achievements = checkAchievements(normalized);
  cache = normalized;
  save();
  return getSummary();
}

function formatTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

module.exports = {
  nightKey,
  currentStreak,
  recordEvent,
  getSummary,
  getWeekStats,
  getAchievementCatalog,
  getWeeklyReport,
  buildWeeklyNarrative,
  getSleepScore,
  getHistory30,
  getTrend,
  exportData,
  replaceAll,
  // Testing helpers.
  _longestRun: longestRun,
  _countedNights: countedNights,
  _checkAchievements: checkAchievements,
  _load: load,
  _reset: () => { cache = null; }
};
