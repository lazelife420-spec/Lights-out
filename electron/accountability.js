// Accountability Partner: notify your partner when you start
// wind-down, hit snooze, or cancel. Social commitment works.
// Supports webhook (Discord, Slack, IFTTT, custom) and email.

const http = require('http');
const https = require('https');

// ─────────────────────────────────────────────────────────────────────────────
// Notification events
// ─────────────────────────────────────────────────────────────────────────────

// Colours follow the app grammar: violet = you act, amber = attention /
// paused, neutral = cancelled, teal = done, red = override.
const COLORS = {
  violet: '#9b93d6',
  amber: '#f5b83d',
  neutral: '#91a0af',
  teal: '#00d1b2',
  red: '#ff5c7a'
};

const EVENTS = {
  TIMER_STARTED: { icon: '\u{1F319}', label: 'Wind-down started', color: COLORS.violet },
  TIMER_PAUSED: { icon: '\u23F8', label: 'Paused', color: COLORS.amber },
  TIMER_SNOOZED: { icon: '\u23F0', label: 'Snoozed', color: COLORS.amber },
  TIMER_CANCELLED: { icon: '\u274C', label: 'Cancelled', color: COLORS.neutral },
  TIMER_COMPLETE: { icon: '\u2705', label: 'Completed', color: COLORS.teal },
  LAST_LIGHT: { icon: '\u{1F4A1}', label: 'Last Light ritual', color: COLORS.violet },
  UNSAVED_WORK: { icon: '\u26A0\uFE0F', label: 'Unsaved work detected', color: COLORS.amber },
  OVERRIDE: { icon: '\u{1F6AB}', label: 'Emergency override', color: COLORS.red }
};

// A Test Mode run never leaves the device as a success: every label is
// prefixed, the completion says no power action ran (no check-mark icon), and
// the colour is amber. REAL messages keep their wording.
const TEST_MODE_PREFIX = 'Test Mode: ';
const TEST_MODE_COMPLETE_LABEL = 'run finished \u00B7 no power action';

function describeEvent(eventType, testMode) {
  const base = EVENTS[eventType];
  if (!base) return null;
  if (!testMode) return { ...base };
  if (eventType === 'TIMER_COMPLETE') {
    return { icon: '\u{1F9EA}', label: TEST_MODE_PREFIX + TEST_MODE_COMPLETE_LABEL, color: COLORS.amber };
  }
  return { icon: base.icon, label: TEST_MODE_PREFIX + base.label, color: COLORS.amber };
}

// ─────────────────────────────────────────────────────────────────────────────
// Send notification to all configured partners
// ─────────────────────────────────────────────────────────────────────────────

async function notifyPartner(eventType, details = {}) {
  const testMode = details.testMode === true;
  const eventInfo = describeEvent(eventType, testMode);
  if (!eventInfo) return [];

  const config = details.config || {};
  const partners = config.partners || [];
  if (!partners.length) return [];

  const results = [];
  const timerName = details.timerName || 'Last Call';
  const remaining = details.remainingSeconds ? `${Math.floor(details.remainingSeconds / 60)}m left` : '';
  const phase = details.phase || '';
  const timestamp = new Date().toLocaleTimeString();

  for (const partner of partners) {
    try {
      let result;
      switch (partner.type) {
        case 'webhook':
          result = await sendWebhook(partner.url, {
            event: eventType,
            icon: eventInfo.icon,
            label: eventInfo.label,
            timerName,
            remaining,
            phase,
            timestamp,
            color: eventInfo.color,
            testMode,
            message: `${eventInfo.icon} **${timerName}**: ${eventInfo.label}${remaining ? ` (${remaining})` : ''} at ${timestamp}`
          });
          break;
        case 'discord':
          result = await sendDiscord(partner.webhookId, partner.webhookToken, {
            username: 'Lights Out',
            embeds: [{
              title: `${eventInfo.icon} ${eventInfo.label}`,
              description: `**${timerName}** ${remaining ? `- ${remaining}` : ''}\nPhase: ${phase || 'N/A'}`,
              color: parseInt(eventInfo.color.replace('#', ''), 16),
              timestamp: new Date().toISOString()
            }]
          });
          break;
        case 'slack':
          result = await sendWebhook(partner.webhookUrl, {
            text: `${eventInfo.icon} *${timerName}*: ${eventInfo.label}${remaining ? ` (${remaining})` : ''}`,
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: `${eventInfo.icon} *${timerName}*\n${eventInfo.label}${remaining ? ` - ${remaining}` : ''} | ${phase || 'idle'}` }
            }]
          });
          break;
        case 'email':
          result = await sendEmail(partner.email, `${eventInfo.icon} ${timerName}: ${eventInfo.label}`, `${timerName} update at ${timestamp}:\n\n${eventInfo.label}${remaining ? ` (${remaining})` : ''}\nPhase: ${phase || 'idle'}`);
          break;
        default:
          result = { success: false, error: `Unknown partner type: ${partner.type}` };
      }
      results.push({ partner: partner.name || partner.type, ...result });
    } catch (e) {
      results.push({ partner: partner.name || partner.type, success: false, error: e.message });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook sender (generic JSON POST)
// ─────────────────────────────────────────────────────────────────────────────

function sendWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : http;
    const data = JSON.stringify(payload);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 8000
    };
    const req = mod.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ success: res.statusCode < 300, status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord webhook
// ─────────────────────────────────────────────────────────────────────────────

function sendDiscord(webhookId, webhookToken, payload) {
  const url = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;
  return sendWebhook(url, payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Email via SMTP relay (simple HTTP relay / mailgun / sendgrid)
// ─────────────────────────────────────────────────────────────────────────────

async function sendEmail(to, subject, body) {
  // Email requires an external relay. We support any HTTP-based email API.
  // The user configures their relay URL and we POST to it.
  return { success: false, error: 'Email relay not configured. Use a webhook provider instead.' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test connectivity
// ─────────────────────────────────────────────────────────────────────────────

async function testPartner(partner) {
  return notifyPartner('TIMER_STARTED', {
    config: { partners: [partner] },
    timerName: 'Test Notification',
    remainingSeconds: 1800,
    phase: 'focus'
  });
}

module.exports = {
  notifyPartner,
  testPartner,
  describeEvent,
  EVENTS,
  COLORS
};
