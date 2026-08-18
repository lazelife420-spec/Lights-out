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
    interrupted: 'Interrupted',
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

// Icon family for the Last Night card, matching the sidebar's coherent
// stroke-SVG language (viewBox 0 0 24 24, stroke=currentColor,
// stroke-width=2, round caps/joins) -- replaces the emoji-per-result
// badge.icon values used before the Home/Library redesign pass. The
// receipts LEDGER list (renderReceiptsModal below) still uses its own
// emoji per result; out of scope for this pass, see the icon inventory.
const NS_PROOF_ICON_SVG_OPEN = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const NS_PROOF_ICONS = {
  running: `<svg ${NS_PROOF_ICON_SVG_OPEN}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
  completing: `<svg ${NS_PROOF_ICON_SVG_OPEN}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  power_executed: `<svg ${NS_PROOF_ICON_SVG_OPEN}><polyline points="20 6 9 17 4 12"/></svg>`,
  dry_run_completed: `<svg ${NS_PROOF_ICON_SVG_OPEN}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  cancelled: `<svg ${NS_PROOF_ICON_SVG_OPEN}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  blocked: `<svg ${NS_PROOF_ICON_SVG_OPEN}><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
  error: `<svg ${NS_PROOF_ICON_SVG_OPEN}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  unknown: `<svg ${NS_PROOF_ICON_SVG_OPEN}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

async function renderMorningProof(receipt) {
  if (!receipt || !els.morningProofSection) return;
  els.morningProofSection.style.display = '';

  // Result → badge + compact headline. Title-cased for a compact card, not
  // the shouty all-caps the old full-width hero used. Icons are looked up
  // separately from NS_PROOF_ICONS (SVG, not emoji) below.
  const badgeMap = {
    running:           { text: 'RUNNING',    color: '#5b8cff', title: 'In progress' },
    completing:        { text: 'COMPLETING', color: '#d4a50a', title: 'Completing…' },
    power_executed:    { text: 'COMPLETED',  color: '#4caf50', title: 'Session complete' },
    dry_run_completed: { text: 'DRY RUN',    color: '#76c9ff', title: 'Dry run complete' },
    cancelled:         { text: 'CANCELLED',  color: '#ff9800', title: 'Session cancelled' },
    blocked:           { text: 'BLOCKED',    color: '#ff4d4d', title: 'Blocked' },
    error:             { text: 'ERROR',      color: '#ff4d4d', title: 'Error' }
  };
  const badge = badgeMap[receipt.result] || { text: receipt.result?.toUpperCase(), color: 'var(--text-muted)', title: receipt.result?.toUpperCase() || 'Unknown' };

  if (els.proofBadge) {
    els.proofBadge.textContent = badge.text;
    els.proofBadge.style.color = badge.color;
    els.proofBadge.style.borderColor = badge.color;
  }
  if (els.proofIcon) els.proofIcon.innerHTML = NS_PROOF_ICONS[receipt.result] || NS_PROOF_ICONS.unknown;

  const proofTitle = document.getElementById('ns-proof-title');
  if (proofTitle) proofTitle.textContent = badge.title;

  // Meta line: real duration/action/timestamp, only the parts we have.
  const timestamp = document.getElementById('ns-proof-timestamp');
  if (timestamp) {
    const parts = [];
    if (receipt.durationSeconds) parts.push(`${Math.floor(receipt.durationSeconds / 60)}m`);
    if (receipt.action) {
      const label = receipt.action.charAt(0).toUpperCase() + receipt.action.slice(1);
      parts.push(receipt.forceShutdown ? `${label} (forced)` : label);
    }
    const end = receipt.endedAt ? new Date(receipt.endedAt) : null;
    if (end) parts.push((receipt.result === 'cancelled' ? 'Cancelled ' : 'Ended ') + end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    if (receipt.profileName) parts.push(receipt.profileName);
    timestamp.textContent = parts.join(' · ');
  }

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
