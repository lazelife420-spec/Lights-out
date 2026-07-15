// Renderer: Morning Proof hero + Run Receipts modal. Loaded as a classic
// sibling <script>, after renderer-utils.js/renderer-profiles.js/
// renderer-calendar.js and before renderer.js.
//
// SCOPE CHANGE, not a pure move: these three functions were previously
// declared *nested inside* wireEvents() in renderer.js (function declarations
// with zero indentation, easy to mistake for top-level — verified empirically
// via `typeof renderReceiptsModal` at global scope, which was "undefined"
// even after wireEvents() had already run once). That made them private,
// reachable only through closures created during wireEvents()'s single
// invocation (the event-listener callbacks that call them). Every call site
// lived inside that same closure, so nothing was ever silently broken by the
// nesting (unlike the calEvents bug fixed in the previous slice) — but hoisting
// them to true top-level globals here is still a real scope change worth
// calling out. Verified none of the three reference any wireEvents()-local
// variable (only `els`/`api`/`notify`/`escapeHtml`/their own params), so the
// hoist is behavior-preserving: the listener callbacks left behind in
// wireEvents() now resolve these bare identifiers up the scope chain to the
// globals defined here instead of to the (now-removed) local declarations.
// Human-readable label for a receipt's result code (e.g. "dry_run_completed"
// -> "Dry Run Completed"). Shared between the receipts list and the Copy
// Proof clipboard text so "proof" never reads as a raw internal enum value.
function humanizeReceiptResult(result) {
  const labels = {
    power_executed: 'Completed',
    completed: 'Completed',
    dry_run_completed: 'Dry Run Completed',
    cancelled: 'Cancelled',
    running: 'Running',
    error: 'Error',
    blocked: 'Blocked'
  };
  if (labels[result]) return labels[result];
  if (!result) return 'Unknown';
  return result.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getReceiptProfileLabel(receipt) {
  const name = typeof receipt?.profileName === 'string' ? receipt.profileName.trim() : '';
  return name ? `Profile: ${name}` : '';
}

function getReceiptNightModeLabel(receipt) {
  const title = typeof receipt?.nightModeTitle === 'string' ? receipt.nightModeTitle.trim() : '';
  return title ? `Mode: ${title}` : '';
}

async function loadMorningProof() {
  try {
    const receipt = await api.getLatestReceipt?.();
    if (receipt) renderMorningProof(receipt);
  } catch (e) {
    console.error('Failed to load morning proof:', e);
  }
}

async function renderMorningProof(receipt) {
  if (!receipt || !els.morningProofSection) return;
  els.morningProofSection.style.display = '';

  // Result → badge + headline.
  const badgeMap = {
    running:           { text: 'RUNNING',    color: '#5b8cff', icon: '\u{1F504}', title: 'IN PROGRESS' },
    completing:        { text: 'COMPLETING', color: '#d4a50a', icon: '⏳',    title: 'COMPLETING…' },
    power_executed:    { text: 'COMPLETED',  color: '#4caf50', icon: '☀️', title: 'MISSION COMPLETE' },
    dry_run_completed: { text: 'DRY RUN',    color: '#76c9ff', icon: '\u{1F4CB}', title: 'DRY RUN COMPLETE' },
    cancelled:         { text: 'CANCELLED',  color: '#ff9800', icon: '❌',    title: 'SESSION CANCELLED' },
    blocked:           { text: 'BLOCKED',    color: '#ff4d4d', icon: '\u{1F6AB}', title: 'BLOCKED' },
    error:             { text: 'ERROR',      color: '#ff4d4d', icon: '⚠️', title: 'ERROR' }
  };
  const badge = badgeMap[receipt.result] || { text: receipt.result?.toUpperCase(), color: 'var(--text-muted)', icon: '❓', title: receipt.result?.toUpperCase() || '—' };

  if (els.proofBadge) {
    els.proofBadge.textContent = badge.text;
    els.proofBadge.style.color = badge.color;
    els.proofBadge.style.borderColor = badge.color;
  }
  if (els.proofIcon) els.proofIcon.textContent = badge.icon;

  const proofTitle = document.getElementById('ns-proof-title');
  if (proofTitle) proofTitle.textContent = badge.title;

  // Timestamp line.
  const timestamp = document.getElementById('ns-proof-timestamp');
  if (timestamp) {
    const end = receipt.endedAt ? new Date(receipt.endedAt) : null;
    const start = receipt.startedAt ? new Date(receipt.startedAt) : null;
    const parts = [];
    if (start) parts.push('Started ' + start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    if (end)   parts.push((receipt.result === 'cancelled' ? 'Cancelled' : 'Ended') + ' ' + end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    timestamp.textContent = parts.join(' · ');
  }

  // Stat pills — only show pills we have real values for.
  function showPill(id, valId, value) {
    const pill = document.getElementById(id);
    const valEl = document.getElementById(valId);
    if (!pill) return;
    if (value !== null && value !== undefined && value !== '') {
      if (valEl) valEl.textContent = value;
      pill.style.display = '';
    } else {
      pill.style.display = 'none';
    }
  }

  const durMin = receipt.durationSeconds ? Math.floor(receipt.durationSeconds / 60) : null;
  showPill('ns-pill-duration', 'ns-pill-duration-val', durMin !== null ? `${durMin}m` : null);

  const actionLabel = receipt.action ? (receipt.action.charAt(0).toUpperCase() + receipt.action.slice(1)) + (receipt.forceShutdown ? ' ⚡' : '') + (receipt.dryRun ? ' \u{1F4CB}' : '') : null;
  showPill('ns-pill-action', 'ns-pill-action-val', actionLabel);

  if (timestamp && receipt.profileName) timestamp.textContent += ` · ${receipt.profileName}`;

  const snoozes = receipt.snoozeCount || 0;
  showPill('ns-pill-snoozes', 'ns-pill-snoozes-val', snoozes > 0 ? snoozes : null);

  // Total runs from stats API (real count, no faking).
  try {
    const stats = await api.getReceiptStats?.();
    showPill('ns-pill-runs', 'ns-pill-runs-val', stats?.total ?? null);
  } catch { showPill('ns-pill-runs', 'ns-pill-runs-val', null); }
}

function renderReceiptsModal(receipts, stats) {
  // Stats.
  if (els.receiptStats && stats) {
    els.receiptStats.innerHTML = `
      <div class="receipt-stat-grid">
        <div class="receipt-stat"><span class="rs-val">${stats.total}</span><span class="rs-lbl">Total</span></div>
        <div class="receipt-stat"><span class="rs-val" style="color:#4caf50">${stats.completed}</span><span class="rs-lbl">Completed</span></div>
        <div class="receipt-stat"><span class="rs-val" style="color:#ff9800">${stats.cancelled}</span><span class="rs-lbl">Cancelled</span></div>
        <div class="receipt-stat"><span class="rs-val" style="color:#76c9ff">${stats.dryRun}</span><span class="rs-lbl">Dry Runs</span></div>
        <div class="receipt-stat"><span class="rs-val" style="color:#ff4d4d">${stats.blocked}</span><span class="rs-lbl">Blocked</span></div>
      </div>
    `;
  }

  // Receipts list.
  if (!els.receiptsList) return;
  if (!receipts.length) {
    els.receiptsList.innerHTML = '<p style="font-size:11px;color:var(--text-muted)">No receipts yet. Start a timer to generate proof.</p>';
    return;
  }
  // Same result vocabulary as the Morning Proof hero badge (renderMorningProof),
  // just mapped to a modifier class + icon instead of a badge/title.
  const resultMeta = {
    power_executed:    { cls: 'completed', icon: '✅' },
    completed:          { cls: 'completed', icon: '✅' },
    dry_run_completed: { cls: 'dry-run',   icon: '\u{1F4CB}' },
    cancelled:         { cls: 'cancelled', icon: '❌' },
    running:           { cls: 'running',   icon: '\u{1F504}' },
    error:             { cls: 'blocked',   icon: '⚠️' },
    blocked:           { cls: 'blocked',   icon: '\u{1F6AB}' }
  };
  els.receiptsList.innerHTML = receipts.map(r => {
    const meta = resultMeta[r.result] || { cls: '', icon: '❓' };
    const start = new Date(r.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dur = Math.floor(r.durationSeconds / 60);

    // Only show meta chips that carry real information -- a "0 pauses,
    // 0 snoozes" chip on every row is noise, not proof.
    const chips = [
      getReceiptNightModeLabel(r) ? escapeHtml(getReceiptNightModeLabel(r)) : null,
      getReceiptProfileLabel(r) ? escapeHtml(getReceiptProfileLabel(r)) : null,
      `${escapeHtml((r.action || '').charAt(0).toUpperCase() + (r.action || '').slice(1))}`,
      `${dur}m`,
      r.dryRun ? 'Dry Run' : null,
      r.forceShutdown ? 'Forced' : null,
      r.pauseCount ? `${r.pauseCount} pause${r.pauseCount === 1 ? '' : 's'}` : null,
      r.snoozeCount ? `${r.snoozeCount} snooze${r.snoozeCount === 1 ? '' : 's'}` : null
    ].filter(Boolean);

    return `<div class="receipt-row receipt-row--${meta.cls}">
      <span class="receipt-row-icon" aria-hidden="true">${meta.icon}</span>
      <div class="receipt-row-main">
        <div class="receipt-row-top">
          <span class="receipt-row-date">${escapeHtml(start)}</span>
          <span class="receipt-row-result">${escapeHtml(humanizeReceiptResult(r.result))}</span>
        </div>
        <div class="receipt-row-meta">${chips.map(c => `<span class="receipt-meta-chip">${c}</span>`).join('')}</div>
      </div>
    </div>`;
  }).join('');
}
/* exported loadMorningProof, renderReceiptsModal, getReceiptProfileLabel */
