'use strict';

const api = window.electronAPI || {};
const widget = document.getElementById('widget');
const arc = document.getElementById('widget-ring-arc');
const remaining = document.getElementById('widget-remaining');
const label = document.getElementById('widget-label');
const closeBtn = document.getElementById('widget-close');
const ACTION_WORDS = Object.freeze({
  shutdown: 'SHUTDOWN',
  restart: 'RESTART',
  sleep: 'SLEEP',
  hibernate: 'HIBERNATE',
  lock: 'LOCK',
  logout: 'LOG OUT'
});
const VALID_PHASES = new Set(['idle', 'focus', 'dim', 'lastlight', 'completing']);

api.onWidgetUpdate?.((data) => {
  if (!data || typeof data !== 'object') return;
  widget.className = 'widget';
  const running = Boolean(data.running);
  const paused = Boolean(data.paused);
  const rawPhase = typeof data.phase === 'string' ? data.phase.trim() : 'idle';
  const phase = VALID_PHASES.has(rawPhase) ? rawPhase : 'idle';
  const dryRun = data.dryRun === true;
  const action = Object.prototype.hasOwnProperty.call(ACTION_WORDS, data.action)
    ? ACTION_WORDS[data.action]
    : 'POWER ACTION';
  const forced = data.forceShutdown === true && (data.action === 'shutdown' || data.action === 'restart');
  widget.classList.add(dryRun ? 'test' : 'real');

  if (!running) {
    widget.classList.add('idle');
    remaining.textContent = 'Lights Out';
    label.textContent = dryRun ? 'Test Mode on' : 'Real actions on';
    arc.setAttribute('stroke-dasharray', '0 100');
    widget.title = 'Lights Out - idle';
    return;
  }

  widget.classList.add(paused ? 'paused' : 'running');
  if (phase && phase !== 'idle') widget.classList.add('phase-' + phase);
  remaining.textContent = typeof data.remaining === 'string' && data.remaining ? data.remaining : '--:--';
  // Short enough to fit the widget at every action; the truth word comes first.
  label.textContent = dryRun ? 'TEST · NO POWER ACTION' : forced ? `REAL · FORCED ${action}` : `REAL · ${action} AT END`;
  const ratio = Math.max(0, Math.min(1, Number(data.ratio) || 0));
  const filled = (ratio * 100).toFixed(1);
  arc.setAttribute('stroke-dasharray', `${filled} ${(100 - Number(filled)).toFixed(1)}`);
  widget.title = paused ? 'Paused' : phase === 'dim' ? 'Winding down' : phase === 'lastlight' ? 'Last light' : phase === 'completing' ? 'Completing' : 'Running';
});

closeBtn?.addEventListener('click', () => {
  api.closeWidget?.();
});
