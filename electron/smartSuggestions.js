// Smart Suggestions: recommends timer duration and bedtime based on
// sleep debt, override history, screen time, and streak patterns.

const streaks = require('./streaks');
const sleepDebt = require('./sleepDebt');
const overrideTax = require('./overrideTax');

function getSuggestions() {
  const suggestions = [];

  // 1. Sleep debt recommendation.
  try {
    const debt = sleepDebt.getDebtSummary();
    if (debt && debt.netDebt > 2) {
      suggestions.push({
        id: 'sleep-debt-early',
        type: 'bedtime',
        priority: 'high',
        title: 'Go to bed earlier tonight',
        description: `You have ${debt.netDebt}h of sleep debt. Starting 30 minutes earlier helps recover.`,
        action: { adjustMinutes: -30 }
      });
    }
  } catch {}

  // 2. Override Tax history.
  try {
    const stats = overrideTax.getStats();
    if (stats.weeklySnoozeCount >= 5) {
      suggestions.push({
        id: 'snooze-habit',
        type: 'behavior',
        priority: 'medium',
        title: 'Snooze habit detected',
        description: `${stats.weeklySnoozeCount} snoozes this week. Consider starting your timer when you feel tired, not after.`,
        action: null
      });
    }
    if (stats.tomorrowDebt > 0) {
      suggestions.push({
        id: 'tomorrow-shorter',
        type: 'warning',
        priority: 'high',
        title: `Tomorrow's timer is ${stats.tomorrowDebt}m shorter`,
        description: `Override Tax penalty from tonight's snoozes. The timer will start shorter to compensate.`,
        action: null
      });
    }
  } catch {}

  // 3. Streak encouragement.
  try {
    const summary = streaks.getSummary();
    if (summary.streak >= 3 && summary.streak < summary.bestStreak) {
      suggestions.push({
        id: 'streak-push',
        type: 'motivation',
        priority: 'low',
        title: `${summary.streak}-night streak! ${summary.bestStreak - summary.streak} more to beat your record.`,
        description: `Your best was ${summary.bestStreak} nights. Keep going!`,
        action: null
      });
    }
    if (summary.streak === 0 && summary.bestStreak >= 3) {
      suggestions.push({
        id: 'streak-restart',
        type: 'motivation',
        priority: 'medium',
        title: 'Start a new streak tonight',
        description: `Your best streak was ${summary.bestStreak} nights. One good night resets momentum.`,
        action: null
      });
    }
  } catch {}

  // 4. Duration recommendation based on average.
  try {
    const weekStats = streaks.getWeekStats();
    if (weekStats && weekStats.avgDuration) {
      const avgMin = Math.round(weekStats.avgDuration / 60);
      if (avgMin > 0 && avgMin < 20) {
        suggestions.push({
          id: 'too-short',
          type: 'duration',
          priority: 'medium',
          title: 'Your average timer is quite short',
          description: `${avgMin} min average. Consider 28+ minutes for a proper wind-down.`,
          action: { suggestMinutes: 28 }
        });
      }
    }
  } catch {}

  return suggestions.sort((a, b) => {
    const prio = { high: 0, medium: 1, low: 2 };
    return (prio[a.priority] || 2) - (prio[b.priority] || 2);
  });
}

module.exports = { getSuggestions };
