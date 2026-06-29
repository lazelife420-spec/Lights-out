// Stats Dashboard: aggregates all metrics into a single payload for the STATS panel.
// Pulls from streaks, sleepDebt, overrideTax, screenTime, and runReceipts.

const streaks = require('./streaks');
const sleepDebt = require('./sleepDebt');
const overrideTax = require('./overrideTax');
const screenTime = require('./screenTime');
const runReceipts = require('./runReceipts');

async function getFullDashboard() {
  const sleepScore = streaks.getSleepScore();
  const streakSummary = streaks.getSummary();
  const weekStats = streaks.getWeekStats();
  const debtSummary = sleepDebt.getDebtSummary();
  const taxStats = overrideTax.getStats();
  const taxConfig = overrideTax.getConfig();

  let screenTimeToday = null;
  try { screenTimeToday = await screenTime.getScreenTimeToday(); } catch {}

  let recentReceipts = [];
  try { recentReceipts = runReceipts.listReceipts().slice(0, 10); } catch {}

  return {
    sleepScore,
    streaks: {
      current: streakSummary.streak,
      best: streakSummary.bestStreak,
      total: streakSummary.totalNights,
      achievements: streakSummary.achievements || []
    },
    weekStats,
    sleepDebt: debtSummary,
    overrideTax: {
      sessionSnoozeCount: taxStats.sessionSnoozeCount,
      tomorrowDebt: taxStats.tomorrowDebt,
      weeklySnoozes: taxStats.weeklySnoozeCount,
      enabled: taxConfig.enabled !== false
    },
    screenTime: screenTimeToday,
    recentReceipts: recentReceipts.map(r => ({
      id: r.id,
      date: r.startedAt,
      duration: r.durationSeconds,
      action: r.action,
      snoozeCount: r.snoozeCount,
      status: r.status
    }))
  };
}

module.exports = { getFullDashboard };
