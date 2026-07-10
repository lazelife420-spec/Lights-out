// Sleep streaks + insights engine.
// Records bedtime events and computes streaks, weekly stats, and achievements.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const STREAKS_FILE = 'streaks.json';

let configPath = null;
let cache = null;

const DEFAULTS = {
  events: [],       // [{ date: '2026-06-10', bedTime: '22:30', action: 'shutdown', snoozed: false }]
  streak: 0,
  bestStreak: 0,
  achievements: []  // ['first_light', '7_night_streak', ...]
};

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function load() {
  if (cache) return cache;
  try {
    if (!configPath) configPath = path.join(app.getPath('userData'), STREAKS_FILE);
    if (fs.existsSync(configPath)) {
      cache = deepMerge(clone(DEFAULTS), JSON.parse(fs.readFileSync(configPath, 'utf8')));
    } else {
      cache = clone(DEFAULTS);
    }
  } catch {
    cache = clone(DEFAULTS);
  }
  return cache;
}

function save() {
  try {
    if (!configPath) configPath = path.join(app.getPath('userData'), STREAKS_FILE);
    fs.writeFileSync(configPath, JSON.stringify(cache, null, 2), 'utf8');
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
// Public API
// ─────────────────────────────────────────────────────────────────────────────

function recordEvent(bedTime, action, snoozed) {
  const data = load();
  const today = new Date().toISOString().slice(0, 10);
  // Only one event per day (use the latest bedtime).
  data.events = data.events.filter(e => e.date !== today);
  data.events.push({ date: today, bedTime: bedTime || formatTime(), action: action || 'shutdown', snoozed: Boolean(snoozed) });

  // Keep last 365 days.
  if (data.events.length > 365) data.events = data.events.slice(-365);

  // Recompute streak.
  const streakInfo = computeStreak(data.events);
  data.streak = streakInfo.current;
  data.bestStreak = Math.max(data.bestStreak || 0, streakInfo.current);

  // Check achievements.
  data.achievements = checkAchievements(data);

  save();
  return getSummary();
}

function computeStreak(events) {
  if (!events.length) return { current: 0 };
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let current = 1;
  let best = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const prev = new Date(sorted[i - 1].date);
    const curr = new Date(sorted[i].date);
    const diffDays = Math.round((curr - prev) / 86400000);
    if (diffDays === 1) {
      current++;
      best = Math.max(best, current);
    } else {
      break;
    }
  }
  return { current, best: Math.max(best, current) };
}

function checkAchievements(data) {
  const unlocked = [...(data.achievements || [])];
  const add = (id) => { if (!unlocked.includes(id)) unlocked.push(id); };

  if (data.events.length >= 1) add('first_light');
  if (data.events.length >= 7) add('weekly_warrior');
  if (data.streak >= 3) add('3_night_streak');
  if (data.streak >= 7) add('7_night_streak');
  if (data.streak >= 14) add('14_night_streak');
  if (data.streak >= 30) add('30_night_streak');
  if (data.bestStreak >= 100) add('centurion');
  // No-snooze for 7 consecutive days.
  const recent7 = data.events.slice(-7);
  if (recent7.length === 7 && recent7.every(e => !e.snoozed)) add('no_snooze_7');
  // Used Last Light at least once.
  if (data.events.some(e => e.action === 'lastlight')) add('last_light_activated');

  return unlocked;
}

function getSummary() {
  const data = load();
  const week = getWeekStats(data.events);
  return {
    streak: data.streak || 0,
    bestStreak: data.bestStreak || 0,
    totalNights: data.events.length,
    achievements: data.achievements || [],
    weekAvg: week.avgBedTime,
    weekOnTime: week.onTimePercent,
    weekDays: week.days
  };
}

function getWeekStats(events) {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const recent = events.filter(e => e.date >= weekAgo);
  if (!recent.length) return { avgBedTime: '--:--', onTimePercent: 0, days: [] };

  // Average bedtime.
  let totalMin = 0;
  const days = recent.map(e => {
    const [h, m] = (e.bedTime || '22:00').split(':').map(Number);
    const mins = (h * 60 + m);
    totalMin += mins;
    return { date: e.date, bedTime: e.bedTime, onTime: mins <= 23 * 60, snoozed: e.snoozed };
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
function getWeeklyReport() {
  const data = load();
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const recent = data.events.filter(e => e.date >= weekAgo);
  const total = data.events.length;

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

  // Action breakdown.
  const actionCounts = {};
  recent.forEach(e => { actionCounts[e.action] = (actionCounts[e.action] || 0) + 1; });

  const report = {
    weekStart: weekAgo,
    weekEnd: now.toISOString().slice(0, 10),
    nightsThisWeek: recent.length,
    totalNights: total,
    streak: data.streak || 0,
    bestStreak: data.bestStreak || 0,
    consistency,
    snoozeRate,
    actionCounts,
    trend,
    achievements: data.achievements || []
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
    return 'No nights logged this week yet. Start a timer tonight to begin this week\'s report.';
  }
  const lines = [];
  lines.push(`${report.nightsThisWeek} of the last 7 nights logged (${report.totalNights} total since you started).`);
  lines.push(`Current streak: ${report.streak} night${report.streak === 1 ? '' : 's'} (best ever: ${report.bestStreak}).`);
  if (report.trend.length > 1) {
    lines.push(`Bedtime varied by about ${report.consistency} minutes night to night this week.`);
  }
  lines.push(`Snoozed on ${report.snoozeRate}% of logged nights this week.`);
  const actionParts = Object.entries(report.actionCounts)
    .map(([action, count]) => `${count} ${action}`);
  if (actionParts.length) lines.push(`Actions taken: ${actionParts.join(', ')}.`);
  if (report.achievements.length) {
    lines.push(`${report.achievements.length} achievement${report.achievements.length === 1 ? '' : 's'} unlocked so far.`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Sleep Score: composite 0-100 score
// ─────────────────────────────────────────────────────────────────────────────

function getSleepScore() {
  const data = load();
  const now = new Date();
  const recent30 = data.events.filter(e => {
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
  const streakBonus = Math.min(10, (data.streak || 0) * 2);
  const achievementBonus = Math.min(10, (data.achievements || []).length * 2);
  const ritualScore = streakBonus + achievementBonus;

  const totalScore = Math.min(100, consistencyScore + onTimeScore + noSnoozeScore + ritualScore);

  let label;
  if (totalScore >= 90) label = 'Legendary';
  else if (totalScore >= 75) label = 'Excellent';
  else if (totalScore >= 60) label = 'Good';
  else if (totalScore >= 40) label = 'Fair';
  else label = 'Needs Work';

  return {
    score: totalScore,
    label,
    breakdown: {
      consistency: { score: consistencyScore, max: 30, stdDev: Math.round(stdDev) },
      onTime: { score: onTimeScore, max: 25, rate: Math.round(onTimeRate * 100) },
      noSnooze: { score: noSnoozeScore, max: 25, rate: Math.round(noSnoozeRate * 100) },
      ritual: { score: ritualScore, max: 20, streak: data.streak || 0, achievements: (data.achievements || []).length }
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
  return monday.toISOString().slice(0, 10); // bucket key = that week's Monday
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
  for (const e of data.events) {
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
      if (mins <= 23 * 60) onTimeCount++;
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
  const now = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const found = data.events.find(e => e.date === dateStr);
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

function replaceAll(nextData) {
  const normalized = deepMerge(clone(DEFAULTS), nextData && typeof nextData === 'object' ? nextData : {});
  normalized.events = Array.isArray(normalized.events) ? normalized.events.slice(-365) : [];
  normalized.achievements = Array.isArray(normalized.achievements) ? normalized.achievements : [];
  normalized.streak = Number.isFinite(Number(normalized.streak)) ? Math.max(0, Number(normalized.streak)) : 0;
  normalized.bestStreak = Number.isFinite(Number(normalized.bestStreak))
    ? Math.max(normalized.streak, Number(normalized.bestStreak))
    : normalized.streak;
  cache = normalized;
  save();
  return getSummary();
}

function formatTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

module.exports = {
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
  _load: load,
  _reset: () => { cache = null; }
};
