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
    dry_run_completed: 'Test Mode Completed',
    cancelled: 'Cancelled',
    running: 'Running',
    completing: 'Completing',
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

// -- UI-R3 P11: one result vocabulary for the hero, history rows, the ledger
// and the Routine strip. tone drives colour through [data-tone] in CSS
// (done teal, test amber, cancel neutral, warn amber for attention -- drawn
// as a solid square, never the Test Mode hatch (Fire 10) --, bad red, running
// teal with a dashed seal; its title and the red REAL truth line say "not
// finished", never success); glyph is a key of the static LO_GLYPHS set (renderer-utils.js).
// A Test Mode run never maps to 'done': dry_run_completed is 'test'.
// 'running' / 'completing' while the app is idle mean "not finished" (a run
// waiting to be resumed, or an action main never confirmed): never success.
const RECEIPT_TONE = Object.freeze({
  power_executed:    Object.freeze({ tone: 'done',    glyph: 'check', title: 'Run complete' }),
  completed:         Object.freeze({ tone: 'done',    glyph: 'check', title: 'Run complete' }),
  dry_run_completed: Object.freeze({ tone: 'test',    glyph: 'test',  title: 'Test run complete' }),
  cancelled:         Object.freeze({ tone: 'cancel',  glyph: 'cross', title: 'Run cancelled' }),
  interrupted:       Object.freeze({ tone: 'warn',    glyph: 'warn',  title: 'Run interrupted' }),
  completing:        Object.freeze({ tone: 'running', glyph: 'clock', title: 'Action not confirmed' }),
  running:           Object.freeze({ tone: 'running', glyph: 'clock', title: 'Run not finished' }),
  blocked:           Object.freeze({ tone: 'bad',     glyph: 'block', title: 'Action blocked' }),
  error:             Object.freeze({ tone: 'bad',     glyph: 'warn',  title: 'Action failed' })
});

function receiptToneOf(result) {
  if (typeof result === 'string' && Object.prototype.hasOwnProperty.call(RECEIPT_TONE, result)) return RECEIPT_TONE[result];
  return { tone: 'neutral', glyph: 'ring', title: humanizeReceiptResult(result) };
}

// The hero's result stamp: a short word, never a power claim on its own (the
// truth chip beside it says whether anything really ran).
function receiptBadgeText(result) {
  if (result === 'dry_run_completed') return 'Completed';
  if (result === 'running') return 'Unfinished';
  if (result === 'completing') return 'Unconfirmed';
  return humanizeReceiptResult(result);
}

// Only a well-formed id (main generates r_<ms>_<rand>) is ever shown or used
// as a data attribute; anything else is omitted.
function safeReceiptId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
}

function shortReceiptId(id) {
  const safe = safeReceiptId(id);
  return safe ? `R-${safe.slice(-6)}` : '';
}

function receiptActionName(action) {
  const names = { shutdown: 'Shutdown', restart: 'Restart', sleep: 'Sleep', hibernate: 'Hibernate', lock: 'Lock', logout: 'Log out' };
  return typeof action === 'string' && Object.prototype.hasOwnProperty.call(names, action) ? names[action] : 'Power action';
}

// -- UI-R3 Fire 10: what actually ran ------------------------------------------
// durationSeconds is the PLANNED length (main writes totalSeconds at start).
// main records remainingSeconds on a cancel and 0 on completion, so the
// countdown's own progress (pauses excluded) is planned - remaining, but only
// when that is honest: no snooze (a snooze raises remainingSeconds while
// durationSeconds stays planned), a finite 0 <= remaining <= planned, and a
// result that really ended the countdown. Anything else is not known, and
// callers say 'planned' instead of inventing a number.
const RUN_SPAN_RESULTS = Object.freeze(['cancelled', 'power_executed', 'completed', 'dry_run_completed']);
function receiptRunSpan(r) {
  const planned = r ? r.durationSeconds : null;
  const plannedSec = typeof planned === 'number' && Number.isFinite(planned) && planned >= 0 ? planned : null;
  const remaining = r ? r.remainingSeconds : null;
  const snoozes = Number(r && r.snoozeCount) || 0;
  const known = plannedSec !== null
    && snoozes === 0
    && typeof remaining === 'number' && Number.isFinite(remaining)
    && remaining >= 0 && remaining <= plannedSec
    && RUN_SPAN_RESULTS.includes(r.result);
  return { plannedSec, ranSec: known ? plannedSec - remaining : null, known };
}

// One run-length formatter: 'Xh Ym' from an hour up, '<1m' for 1..59 s,
// '0m' only for exactly 0. Whole minutes round down (never overstates).
function formatRunLength(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '';
  if (sec === 0) return '0m';
  if (sec < 60) return '<1m';
  const mins = Math.floor(sec / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

// The run length as words, shared by history rows, ledger chips and the
// copied receipt. kind: 'partial' (a known span shorter than planned),
// 'full' (a known span that ran the whole plan), 'planned' (not known) or
// 'none' (no planned length on the receipt).
function receiptRunLength(r) {
  const span = receiptRunSpan(r);
  const planned = span.plannedSec === null ? '' : formatRunLength(span.plannedSec);
  if (!planned) return { kind: 'none', planned: '', ran: '', span };
  if (!span.known) return { kind: 'planned', planned, ran: '', span };
  const ran = formatRunLength(span.ranSec);
  return { kind: span.ranSec < span.plannedSec ? 'partial' : 'full', planned, ran, span };
}

// History row detail: 'ran <1m of 25m' / '25m' / '25m planned'.
function receiptRunDetail(r) {
  const len = receiptRunLength(r);
  if (len.kind === 'partial') return `ran ${len.ran} of ${len.planned}`;
  if (len.kind === 'full') return len.planned;
  if (len.kind === 'planned') return `${len.planned} planned`;
  return '';
}

// Where the run started, only from the frozen ORIGIN_LABELS map (P06); a
// local or unknown origin, or an old receipt without one, adds nothing.
function receiptOriginLabel(receipt) {
  const origin = receipt && receipt.origin;
  if (typeof ORIGIN_LABELS === 'undefined' || typeof origin !== 'string') return '';
  return Object.prototype.hasOwnProperty.call(ORIGIN_LABELS, origin) ? ORIGIN_LABELS[origin] : '';
}

// The Test Mode / REAL line for a receipt. Always present, never animated.
// 'command sent' only for power_executed: main writes it right after it
// spawned the command, so it is the one result that proves an action ran.
function receiptTruth(receipt) {
  const action = receiptActionName(receipt && receipt.action);
  const result = receipt && receipt.result;
  if (receipt && receipt.dryRun) return { text: 'TEST MODE · nothing ran', kind: 'test' };
  if (result === 'power_executed') return { text: `REAL ACTION · ${action} command sent`, kind: 'real' };
  if (result === 'completed') return { text: `REAL ACTION · ${action} completed`, kind: 'real' };
  if (result === 'running' || result === 'completing') return { text: 'REAL ACTION · not finished', kind: 'real-open' };
  return { text: `REAL ACTION · ${action} did not run`, kind: 'real-none' };
}

// When a moment sits relative to now, by the SAME night rule as the strip,
// the ledger groups and streaks (nightKey: local time minus 6 h). The night
// words only apply to night hours (17:00-05:59): a daytime run in tonight's
// bucket is 'today' (if it is still that calendar day), one in last night's
// bucket is 'yesterday' (if it was the previous calendar day). Anything else
// returns null and callers show the date. Never "last night" for a noon run.
function receiptWhenFor(value, now = new Date()) {
  const at = value === null || value === undefined || value === '' ? null : new Date(value);
  if (!at || Number.isNaN(at.getTime())) return null;
  const key = nightKey(at);
  const nowKey = nightKey(now);
  if (!key || !nowKey) return null;
  const hour = at.getHours();
  const nightHour = hour >= 17 || hour < 6;
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (key === nowKey) return nightHour ? 'tonight' : (sameDay(at, now) ? 'today' : null);
  if (key === nightKeyShift(nowKey, -1)) {
    if (nightHour) return 'last-night';
    const dayBefore = new Date(now.getTime());
    dayBefore.setDate(dayBefore.getDate() - 1);
    return sameDay(at, dayBefore) ? 'yesterday' : null;
  }
  return null;
}

// Eyebrow: TONIGHT / LAST NIGHT / TODAY / YESTERDAY from receiptWhenFor,
// otherwise the date.
const PROOF_EYEBROW_WORDS = Object.freeze({ tonight: 'TONIGHT', 'last-night': 'LAST NIGHT', today: 'TODAY', yesterday: 'YESTERDAY' });
function proofEyebrowFor(value, now = new Date()) {
  const at = value === null || value === undefined || value === '' ? null : new Date(value);
  if (!at || Number.isNaN(at.getTime())) return 'LATEST RUN';
  const when = receiptWhenFor(at, now);
  if (when) return PROOF_EYEBROW_WORDS[when];
  return `LATEST RUN · ${at.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

// Tonight's morning note: only for a REAL Sleep, Hibernate or Shutdown whose
// command main confirmed (power_executed), ended in the last 16 hours. Test
// Mode, blocked, failed, interrupted and cancelled runs never get one.
const MORNING_NOTE_ACTIONS = Object.freeze(['sleep', 'hibernate', 'shutdown']);
const MORNING_NOTE_MAX_AGE_MS = 16 * 3600 * 1000;
function morningNoteFor(receipt, nowMs = Date.now()) {
  if (!receipt || receipt.result !== 'power_executed' || receipt.dryRun === true) return null;
  if (!MORNING_NOTE_ACTIONS.includes(receipt.action)) return null;
  const ended = receipt.endedAt ? new Date(receipt.endedAt).getTime() : NaN;
  if (!Number.isFinite(ended)) return null;
  const age = nowMs - ended;
  if (age < -60000 || age > MORNING_NOTE_MAX_AGE_MS) return null;
  const id = safeReceiptId(receipt.id);
  if (!id) return null;
  // The lead word is only as true as the clock: 'Last night' only for a run
  // that ended in last night's window (a 13:00 nap read at 15:00 is
  // 'Earlier today').
  const leads = { tonight: 'Earlier tonight', 'last-night': 'Last night', today: 'Earlier today', yesterday: 'Yesterday' };
  const lead = leads[receiptWhenFor(new Date(ended), new Date(nowMs))] || 'Latest';
  return { id, endedAt: new Date(ended), action: receiptActionName(receipt.action), shortId: shortReceiptId(id), lead };
}

// UI-R3 Fire 10: an honest first page. #proof-empty ('No runs yet') shows
// only when the read RESOLVED to null (no receipt on this PC). A failed or
// missing read keeps it hidden: the night strip says 'Receipts are
// unavailable right now' instead. #proof-page-meta stays hidden at 0.
async function loadMorningProof() {
  const emptyEl = document.getElementById('proof-empty');
  try {
    const receipt = await api.getLatestReceipt?.();
    if (receipt) {
      if (emptyEl) emptyEl.hidden = true;
      await renderMorningProof(receipt);
      return;
    }
    if (els.morningProofSection) els.morningProofSection.style.display = 'none';
    if (emptyEl) emptyEl.hidden = receipt !== null;
    if (receipt === null) setProofPageMeta(0);
  } catch (e) {
    if (emptyEl) emptyEl.hidden = true;
    console.error('Failed to load morning proof:', e);
  }
}

// The page head's receipt total, from getReceiptStats(): hidden when the
// total is missing, 0 or the call failed (never a fabricated count).
function setProofPageMeta(total) {
  const meta = document.getElementById('proof-page-meta');
  if (!meta) return;
  const n = typeof total === 'number' && Number.isFinite(total) ? Math.floor(total) : 0;
  meta.textContent = n > 0 ? `${n} receipt${n === 1 ? '' : 's'} · this PC` : '';
  meta.hidden = !(n > 0);
}

// Open receipt / a history row: land on the ledger row with a short static
// outline. Smooth scroll only when reduced motion is off. Returns whether a
// row was found (an id that is not in the rendered list does nothing).
function focusLedgerReceipt(id) {
  const safe = safeReceiptId(id);
  if (!safe || !els.receiptsList || typeof els.receiptsList.querySelectorAll !== 'function') return false;
  const target = [...els.receiptsList.querySelectorAll('.receipt-row[data-receipt-id]')].find(el => el.dataset.receiptId === safe);
  if (!target) return false;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  target.classList.add('is-focus');
  setTimeout(() => target.classList.remove('is-focus'), 900);
  return true;
}

async function renderMorningProof(receipt) {
  if (!receipt || !els.morningProofSection) return;
  // Only un-hide while idle: render() hides the hero during a run.
  const active = typeof state !== 'undefined' && (state.running || state.paused);
  els.morningProofSection.style.display = active ? 'none' : '';

  const meta = receiptToneOf(receipt.result);
  const action = receiptActionName(receipt.action);
  // Colour comes only from data-tone (CSS); no inline colour writes.
  if (els.proofCard) els.proofCard.dataset.tone = meta.tone;
  const sealGlyph = document.getElementById('proof-seal-glyph');
  // A constant from the static glyph set, never receipt data.
  if (sealGlyph) sealGlyph.innerHTML = LO_GLYPHS[meta.glyph] || LO_GLYPHS.ring;

  if (els.proofBadge) els.proofBadge.textContent = receiptBadgeText(receipt.result);

  const proofTitle = document.getElementById('ns-proof-title');
  if (proofTitle) proofTitle.textContent = meta.title;

  const eyebrow = document.getElementById('ns-proof-eyebrow');
  // startedAt first: the strip and the ledger group a run by its start.
  if (eyebrow) eyebrow.textContent = proofEyebrowFor(receipt.startedAt || receipt.endedAt);

  // Name · Action · R-xxxxxx · origin. textContent and a mono span only.
  // A run without a Night Mode or My Mode is a 'Countdown' (Fire 02's one
  // session name). Receipts store no typed name, so that is all Proof can say.
  const sub = document.getElementById('ns-proof-sub');
  if (sub) {
    const nightMode = typeof receipt.nightModeTitle === 'string' ? receipt.nightModeTitle.trim() : '';
    const profile = typeof receipt.profileName === 'string' ? receipt.profileName.trim() : '';
    sub.textContent = `${nightMode || profile || 'Countdown'} · ${action}`;
    const shortId = shortReceiptId(receipt.id);
    if (shortId) {
      sub.append(' · ');
      const idEl = document.createElement('span');
      idEl.className = 'mono';
      idEl.textContent = shortId;
      sub.append(idEl);
    }
    const origin = receiptOriginLabel(receipt);
    if (origin) sub.append(' · ' + origin);
  }

  const truthEl = document.getElementById('ns-proof-truth');
  if (truthEl) {
    const truth = receiptTruth(receipt);
    truthEl.textContent = truth.text;
    truthEl.dataset.truth = truth.kind;
  }

  // Open receipt lands on this receipt's ledger row; with no usable id it is
  // a plain 'View ledger'. The id is only ever a safeReceiptId value.
  const detailsBtn = els.btnProofDetails || document.getElementById('btn-proof-details');
  if (detailsBtn) {
    const safeId = safeReceiptId(receipt.id);
    detailsBtn.dataset.receiptId = safeId;
    detailsBtn.textContent = safeId ? 'Open receipt' : 'View ledger';
  }

  // UI-R3 Fire 10: one spec strip -- RAN/PLANNED · ACTION · STARTED · ENDED.
  // Cells show only real values; a missing one is hidden (the strip's grid
  // flows the shown cells, so a hidden cell leaves no hole).
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

  // RAN when the countdown's own progress is known, else PLANNED.
  const len = receiptRunLength(receipt);
  const durPill = document.getElementById('ns-pill-duration');
  const durLabel = document.getElementById('ns-pill-duration-label');
  const durOf = document.getElementById('ns-pill-duration-of');
  const durFill = document.getElementById('ns-pill-duration-fill');
  const known = len.kind === 'partial' || len.kind === 'full';
  showPill('ns-pill-duration', 'ns-pill-duration-val', len.kind === 'none' ? null : (known ? len.ran : len.planned));
  if (durLabel) durLabel.textContent = known ? 'RAN' : 'PLANNED';
  if (durOf) {
    durOf.textContent = len.kind === 'partial' ? `of ${len.planned}` : '';
    durOf.hidden = len.kind !== 'partial';
  }
  if (durFill) {
    // Numbers only: the share of the plan the countdown ran (static, decorative).
    const pct = known && len.span.plannedSec > 0 ? Math.round(Math.min(1, Math.max(0, len.span.ranSec / len.span.plannedSec)) * 100) : 0;
    durFill.style.width = `${pct}%`;
  }
  if (durPill) {
    const mins = sec => Math.floor(sec / 60);
    const ranWords = !known ? '' : (len.span.ranSec > 0 && len.span.ranSec < 60 ? 'less than 1 minute' : `${mins(len.span.ranSec)} minutes`);
    durPill.setAttribute('aria-label', known
      ? `Countdown ran ${ranWords} of ${mins(len.span.plannedSec)} minutes`
      : (len.kind === 'planned' ? `Planned ${mins(len.span.plannedSec)} minutes` : ''));
    durPill.dataset.known = known ? 'true' : 'false';
  }

  // Action, plus text badges: 'Forced' and an amber 'TEST' (no emoji). The
  // tags wrap under the value; they are never clipped.
  showPill('ns-pill-action', 'ns-pill-action-val', receipt.action ? action : null);
  const actionVal = document.getElementById('ns-pill-action-val');
  if (actionVal && receipt.action) {
    const mini = (text, kind) => {
      const el = document.createElement('span');
      el.className = `proof-mini proof-mini--${kind}`;
      el.textContent = text;
      return el;
    };
    if (receipt.forceShutdown) actionVal.append(mini('Forced', 'forced'));
    if (receipt.dryRun) actionVal.append(mini('TEST', 'test'));
  }
  // 'N pauses · N snoozes' under ACTION, omitted when both are 0.
  const actionNote = document.getElementById('ns-pill-action-note');
  if (actionNote) {
    const pauses = Math.max(0, Math.floor(Number(receipt.pauseCount) || 0));
    const snoozes = Math.max(0, Math.floor(Number(receipt.snoozeCount) || 0));
    actionNote.textContent = [
      pauses > 0 ? `${pauses} pause${pauses === 1 ? '' : 's'}` : '',
      snoozes > 0 ? `${snoozes} snooze${snoozes === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ');
    actionNote.hidden = !actionNote.textContent;
  }

  // STARTED / ENDED (CANCELLED, FOUND INTERRUPTED): valid dates only, never a
  // placeholder. Times follow the 12h/24h setting (formatClock).
  const start = receipt.startedAt ? new Date(receipt.startedAt) : null;
  const end = receipt.endedAt ? new Date(receipt.endedAt) : null;
  const endWord = receipt.result === 'cancelled' ? 'Cancelled' : receipt.result === 'interrupted' ? 'Found interrupted' : 'Ended';
  showPill('ns-pill-start', 'ns-pill-start-val', start && !Number.isNaN(start.getTime()) ? formatClock(start) : null);
  showPill('ns-pill-end', 'ns-pill-end-val', end && !Number.isNaN(end.getTime()) ? formatClock(end) : null);
  const endLabel = document.getElementById('ns-pill-end-label');
  if (endLabel) endLabel.textContent = endWord;

  // The receipt total moved to the page head (a fact about the ledger, not
  // about this run), from the same single getReceiptStats call.
  try {
    const stats = await api.getReceiptStats?.();
    setProofPageMeta(stats ? stats.total : null);
  } catch { setProofPageMeta(null); }
}

// Ledger stats, from getReceiptStats(), on two axes (UI-R3 Fire 10):
// - the mode line: real · Test Mode · total (plus 'mode unknown'), only when
//   main sent finite testRuns/realRuns (an older main: no mode line, and the
//   legend keeps its own total);
// - the outcome bar plus its legend. The segments sum to the total
//   (runReceipts buckets interrupted and other); zero segments are omitted.
// Colour is data-tone / data-truth only (CSS); the line is static.
function receiptStatsMarkup(stats) {
  const total = Number(stats && stats.total) || 0;
  if (total <= 0) return '';
  const n = key => Math.max(0, Number(stats[key]) || 0);
  const count = key => (Number.isFinite(stats[key]) ? Math.max(0, Math.floor(stats[key])) : null);
  const known = n('completed') + n('dryRun') + n('cancelled') + n('interrupted') + n('blocked');
  const other = Number.isFinite(Number(stats.other)) ? n('other') : Math.max(0, total - known);
  const segments = [
    ['done', n('completed'), 'real completed', 'Real completed'],
    ['test', n('dryRun'), 'Test Mode completed', 'Test completed'],
    ['cancel', n('cancelled'), 'cancelled', 'Cancelled'],
    ['warn', n('interrupted'), 'interrupted', 'Interrupted'],
    ['bad', n('blocked'), 'blocked or failed', 'Blocked / error'],
    ['running', other, 'unfinished', 'Unfinished']
  ].filter(s => s[1] > 0);
  const label = `${total} run${total === 1 ? '' : 's'}: ${segments.map(s => `${s[1]} ${s[2]}`).join(', ')}`;
  const realRuns = count('realRuns');
  const testRuns = count('testRuns');
  const showMode = realRuns !== null && testRuns !== null;
  const unknownRuns = showMode ? (count('unknownModeRuns') || 0) : 0;
  const modeAria = showMode
    ? `${realRuns} real and ${testRuns} Test Mode run${testRuns === 1 ? '' : 's'} on this PC${unknownRuns > 0 ? `, ${unknownRuns} mode unknown` : ''}`
    : '';
  const modeLine = showMode
    ? `<p class="receipt-mode-line" aria-label="${escapeHtml(modeAria)}"><b data-truth="real"${realRuns > 0 ? '' : ' data-zero'}>${realRuns}</b> real · <b data-truth="test">${testRuns}</b> Test Mode · ${total} on this PC${unknownRuns > 0 ? ` · <span class="receipt-mode-unknown">${unknownRuns} mode unknown</span>` : ''}</p>`
    : '';
  const legendTotal = showMode ? '' : `<li class="receipt-legend-total"><b>${total}</b>on this PC</li>`;
  return `${modeLine}<div class="receipt-ratio" role="img" aria-label="${escapeHtml(label)}">${segments.map(s => `<span data-tone="${s[0]}" style="flex-grow:${s[1]}"></span>`).join('')}</div>
    <ul class="receipt-legend">${segments.map(s => `<li data-tone="${s[0]}"><b>${s[1]}</b>${s[3]}</li>`).join('')}${legendTotal}</ul>`;
}

// UI-R3 Fire 02: a group is a night (start minus 6 h, nightKey), so its
// header says so. Never 'Tonight' / 'Last night': a night key can hold
// daytime runs. A missing key stays 'Unknown date', with no prefix.
function receiptNightLabel(key) {
  const d = key ? nightKeyDate(key) : null;
  return d ? `Night of ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Unknown date';
}

function renderReceiptsModal(receipts, stats) {
  // Stats.
  if (els.receiptStats) els.receiptStats.innerHTML = receiptStatsMarkup(stats);

  // Receipts list.
  if (!els.receiptsList) return;
  if (!receipts.length) {
    els.receiptsList.innerHTML = '<p class="receipt-empty">No receipts yet. Start a timer to generate proof.</p>';
    return;
  }
  let lastNight;
  els.receiptsList.innerHTML = receipts.map(r => {
    const meta = receiptToneOf(r.result);
    const startDate = new Date(r.startedAt);
    const validStart = !Number.isNaN(startDate.getTime());
    // Time only (the night header names the date), in the 12h/24h setting.
    const start = validStart ? formatClock(startDate) : 'Unknown time';
    // Fire 10: '<1m / 25m' for a known short run, '25m' for a full one,
    // '25m planned' when the receipt cannot say how long it ran.
    const len = receiptRunLength(r);
    const runChip = len.kind === 'partial' ? `${len.ran} / ${len.planned}`
      : len.kind === 'full' ? len.planned
        : len.kind === 'planned' ? `${len.planned} planned` : null;
    const id = safeReceiptId(r.id);
    const shortId = shortReceiptId(r.id);
    const origin = receiptOriginLabel(r);

    // Night group header (small, muted, mono) whenever the night changes.
    const night = nightKey(r.startedAt) || 'unknown';
    const header = night !== lastNight ? `<h4 class="receipt-night">${escapeHtml(receiptNightLabel(night === 'unknown' ? null : night))}</h4>` : '';
    lastNight = night;
    // A run after midnight sits under the evening before: say it is the next
    // calendar day. Fixed markup, never data; no marker for an unknown start.
    const afterMidnight = validStart && night !== 'unknown' && loLocalDateKey(startDate) !== night
      ? '<span class="receipt-after-midnight" aria-label="next day">+1 day</span>' : '';

    // Only show meta chips that carry real information -- a "0 pauses,
    // 0 snoozes" chip on every row is noise, not proof.
    const chips = [
      getReceiptNightModeLabel(r) ? escapeHtml(getReceiptNightModeLabel(r)) : null,
      getReceiptProfileLabel(r) ? escapeHtml(getReceiptProfileLabel(r)) : null,
      escapeHtml(receiptActionName(r.action)),
      runChip ? escapeHtml(runChip) : null,
      r.dryRun === true ? '<span class="receipt-meta-chip chip-test">Test Mode</span>' : null,
      r.forceShutdown ? '<span class="receipt-meta-chip chip-forced">Forced</span>' : null,
      origin ? escapeHtml(origin) : null,
      r.pauseCount ? `${r.pauseCount} pause${r.pauseCount === 1 ? '' : 's'}` : null,
      r.snoozeCount ? `${r.snoozeCount} snooze${r.snoozeCount === 1 ? '' : 's'}` : null
    ].filter(Boolean).map(c => (c.startsWith('<span') ? c : `<span class="receipt-meta-chip">${c}</span>`));

    return `${header}<div class="receipt-row" data-tone="${meta.tone}"${id ? ` data-receipt-id="${escapeHtml(id)}"` : ''}>
      <span class="receipt-row-icon" aria-hidden="true">${loGlyph(meta.glyph)}</span>
      <div class="receipt-row-main">
        <div class="receipt-row-top">
          <span class="receipt-row-date">${escapeHtml(start)}${afterMidnight}</span>
          ${shortId ? `<span class="receipt-id">${escapeHtml(shortId)}</span>` : ''}
          <span class="receipt-row-result">${escapeHtml(humanizeReceiptResult(r.result))}</span>
        </div>
        <div class="receipt-row-meta">${chips.join('')}</div>
      </div>
    </div>`;
  }).join('');
}

// -- Delete all receipts: a two-step, inline confirm (UI-R3 P11) -------------
// The first click only swaps the footer for the confirm; Keep is focused.
// Only #btn-clear-receipts-confirm (confirmClearReceipts) deletes anything,
// and deleting stays permanent: there is no undo that pretends otherwise.
function resetReceiptsClearConfirm(options = {}) {
  const confirmEl = document.getElementById('receipts-confirm');
  const actions = document.getElementById('receipts-actions');
  const wasOpen = !!(confirmEl && !confirmEl.hidden);
  if (confirmEl) confirmEl.hidden = true;
  if (actions) actions.hidden = false;
  if (options.restoreFocus && wasOpen && els.btnClearReceipts) els.btnClearReceipts.focus();
}

async function openReceiptsClearConfirm() {
  const confirmEl = document.getElementById('receipts-confirm');
  const actions = document.getElementById('receipts-actions');
  const question = document.getElementById('receipts-confirm-q');
  if (!confirmEl) return;
  // A fresh count, or none at all: never a stale number.
  let total = null;
  try {
    const stats = await api.getReceiptStats?.();
    const n = Number(stats && stats.total);
    if (Number.isFinite(n) && n >= 0) total = n;
  } catch { total = null; }
  if (total === 0) {
    notify('There are no receipts to delete', 'info');
    return;
  }
  if (question) {
    question.textContent = total === null
      ? 'Delete all receipts from this PC?'
      : `Delete all ${total} receipt${total === 1 ? '' : 's'} from this PC?`;
  }
  const confirmBtn = document.getElementById('btn-clear-receipts-confirm');
  if (confirmBtn) confirmBtn.disabled = false;
  if (actions) actions.hidden = true;
  confirmEl.hidden = false;
  document.getElementById('btn-clear-receipts-keep')?.focus();
}

async function confirmClearReceipts() {
  const confirmBtn = document.getElementById('btn-clear-receipts-confirm');
  if (!confirmBtn || confirmBtn.disabled) return;
  confirmBtn.disabled = true;
  let cleared = false;
  try {
    const result = await api.clearReceipts();
    cleared = !!(result && result.cleared === true);
  } catch (e) {
    console.error('Failed to clear receipts:', e);
  }
  confirmBtn.disabled = false;
  resetReceiptsClearConfirm({ restoreFocus: true });
  if (!cleared) {
    // The rows stay: they were not deleted.
    notify('Could not delete receipts. They are still on this PC.', 'error');
    return;
  }
  // Re-render from fresh data, never from an assumption.
  try {
    const [receipts, stats] = await Promise.all([api.listReceipts?.(100), api.getReceiptStats?.()]);
    renderReceiptsModal(receipts || [], stats);
  } catch {
    renderReceiptsModal([], null);
  }
  notify('All receipts deleted from this PC', 'info');
  if (typeof refreshProofSurfaces === 'function') refreshProofSurfaces();
}

// -- Proof › Routine: the last 14 nights, from local receipts (UI-R3 P11) ----
// One cell per night (nightKey: local start date minus 6 h), oldest first.
// Outcome priority: real > test > cancel > bad > active > none. 'No run'
// only inside the retained window (on or after the oldest receipt); older
// nights say 'no data', because receipts are capped and can be deleted.
// Test Mode runs are never drawn as real. Static: no animation.
const NIGHT_STRIP_DAYS = 14;
const NIGHT_OUTCOME_ORDER = Object.freeze(['real', 'test', 'cancel', 'bad', 'active']);
function nightOutcomeOf(receipt) {
  const result = receipt && receipt.result;
  if (result === 'dry_run_completed') return 'test';
  if ((result === 'power_executed' || result === 'completed') && receipt.dryRun !== true) return 'real';
  if (result === 'cancelled' || result === 'interrupted') return 'cancel';
  if (result === 'blocked' || result === 'error') return 'bad';
  if (result === 'running' || result === 'completing') return 'active';
  return null;
}

function buildNightStrip(receipts, now = new Date()) {
  const byNight = new Map();
  let oldest = null;
  for (const r of Array.isArray(receipts) ? receipts : []) {
    const key = nightKey(r && r.startedAt);
    if (!key) continue;
    if (!oldest || key < oldest) oldest = key;
    const counts = byNight.get(key) || { real: 0, test: 0, cancel: 0, bad: 0, active: 0 };
    const outcome = nightOutcomeOf(r);
    if (outcome) counts[outcome]++;
    byNight.set(key, counts);
  }
  const tonight = nightKey(now);
  const cells = [];
  for (let i = NIGHT_STRIP_DAYS - 1; i >= 0; i--) {
    const key = nightKeyShift(tonight, -i);
    const counts = byNight.get(key) || null;
    let outcome = counts ? NIGHT_OUTCOME_ORDER.find(o => counts[o] > 0) || 'none' : null;
    if (!outcome) outcome = oldest && key >= oldest ? 'none' : 'nodata';
    cells.push({ key, outcome, counts, tonight: i === 0 });
  }
  return { cells, hasReceipts: !!oldest };
}

function nightCellDescription(cell) {
  const d = nightKeyDate(cell.key);
  const date = d ? d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : cell.key;
  if (cell.outcome === 'nodata') return `${date}: no data (before the oldest receipt on this PC)`;
  const c = cell.counts;
  if (!c) return `${date}: no run`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    c.real ? plural(c.real, 'real action sent', 'real actions sent') : '',
    c.test ? plural(c.test, 'Test Mode run', 'Test Mode runs') : '',
    c.cancel ? plural(c.cancel, 'cancelled or interrupted run', 'cancelled or interrupted runs') : '',
    c.bad ? plural(c.bad, 'blocked or failed run', 'blocked or failed runs') : '',
    c.active ? plural(c.active, 'unfinished run', 'unfinished runs') : ''
  ].filter(Boolean);
  return `${date}: ${parts.length ? parts.join(', ') : 'no run'}`;
}

async function renderNightStrip() {
  const strip = document.getElementById('night-strip');
  if (!strip) return;
  const empty = document.getElementById('night-strip-empty');
  let receipts = null;
  try { receipts = await api.listReceipts?.(100); } catch { receipts = null; }
  const model = buildNightStrip(receipts || [], new Date());
  strip.textContent = '';
  for (const cell of model.cells) {
    const li = document.createElement('li');
    li.className = cell.tonight ? 'night-cell is-tonight' : 'night-cell';
    li.dataset.outcome = cell.outcome;
    const text = nightCellDescription(cell);
    li.title = text;
    li.setAttribute('aria-label', text);
    const bar = document.createElement('span');
    bar.className = 'night-bar';
    bar.setAttribute('aria-hidden', 'true');
    const dow = document.createElement('span');
    dow.className = 'night-dow';
    dow.setAttribute('aria-hidden', 'true');
    const d = nightKeyDate(cell.key);
    dow.textContent = d ? d.toLocaleDateString([], { weekday: 'narrow' }) : '';
    li.append(bar, dow);
    strip.append(li);
  }
  // The rarer legend entries appear only when a drawn cell uses them.
  const shown = new Set(model.cells.map(c => c.outcome));
  for (const item of document.querySelectorAll('.routine-legend li[data-legend]')) {
    item.hidden = !shown.has(item.dataset.legend);
  }
  if (empty) {
    empty.textContent = receipts === null ? 'Receipts are unavailable right now' : 'No runs recorded on this PC yet';
    empty.hidden = model.hasReceipts;
  }

  // The real streak (P02: Test Mode never counts), from api.getStreaks().
  // UI-R3 Fire 10: it speaks quietly (muted) until a real streak exists.
  // data-state: 'live' (streak > 0: teal, the count as a big numeral),
  // 'broken' (no current streak, but a best or a total) or 'empty'. Built
  // from DOM nodes only; the text reads the same in every state.
  const streakEl = document.getElementById('routine-streak');
  if (streakEl) {
    try {
      const s = await api.getStreaks?.();
      const streak = Math.max(0, Number(s && s.streak) || 0);
      const best = Math.max(0, Number(s && s.bestStreak) || 0);
      const total = Math.max(0, Number(s && s.totalNights) || 0);
      streakEl.textContent = '';
      if (streak > 0) {
        const num = document.createElement('b');
        num.className = 'routine-streak-n';
        num.textContent = String(streak);
        streakEl.append('Real streak · ', num, ` night${streak === 1 ? '' : 's'} · best ${best}`);
        streakEl.dataset.state = 'live';
      } else if (best || total) {
        streakEl.textContent = `Real streak · 0 nights · best ${best}`;
        streakEl.dataset.state = 'broken';
      } else {
        streakEl.textContent = 'No real completions yet · Test Mode runs don\'t count';
        streakEl.dataset.state = 'empty';
      }
    } catch {
      streakEl.textContent = '';
      streakEl.dataset.state = '';
    }
  }
}

// -- UI-R3 Fire 10: Copy proof is a complete, honest receipt ------------------
// The truth line is the first fact. A Test Mode run is never 'Completed':
// the Result line uses the tone title ('Test run complete', 'Run
// cancelled'), and a completed result on a Test Mode receipt reads as the
// Test Mode title too. 'Ran:' appears only when the span is known.
function buildProofText(receipt) {
  if (!receipt || typeof receipt !== 'object') return '';
  const lines = [];
  const shortId = shortReceiptId(receipt.id);
  lines.push(shortId ? `Lights Out receipt ${shortId}` : 'Lights Out receipt');
  lines.push(receiptTruth(receipt).text);
  const finished = receipt.result === 'power_executed' || receipt.result === 'completed';
  const result = receipt.dryRun === true && finished ? RECEIPT_TONE.dry_run_completed.title : receiptToneOf(receipt.result).title;
  lines.push(`Result: ${result}`);
  lines.push(`Action: ${receiptActionName(receipt.action)}${receipt.forceShutdown ? ' (forced)' : ''}`);
  const len = receiptRunLength(receipt);
  if (len.planned) lines.push(`Planned: ${len.planned}`);
  if (len.kind === 'partial' || len.kind === 'full') lines.push(`Ran: ${len.ran}`);
  const when = value => {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })} ${formatClock(d)}`;
  };
  const started = when(receipt.startedAt);
  const ended = when(receipt.endedAt);
  if (started) lines.push(`Started: ${started}`);
  if (ended) lines.push(`Ended: ${ended}`);
  const pauses = Math.max(0, Math.floor(Number(receipt.pauseCount) || 0));
  const snoozes = Math.max(0, Math.floor(Number(receipt.snoozeCount) || 0));
  if (pauses > 0) lines.push(`Pauses: ${pauses}`);
  if (snoozes > 0) lines.push(`Snoozes: ${snoozes}`);
  const profile = getReceiptProfileLabel(receipt);
  const mode = getReceiptNightModeLabel(receipt);
  if (profile) lines.push(profile);
  if (mode) lines.push(mode);
  const origin = receiptOriginLabel(receipt);
  if (origin) lines.push(`Started ${origin}`);
  lines.push('Stored locally on this PC. No account, no cloud.');
  return lines.join('\n');
}
/* exported loadMorningProof, renderReceiptsModal, getReceiptProfileLabel, RECEIPT_TONE, receiptToneOf, morningNoteFor, renderNightStrip, buildNightStrip, resetReceiptsClearConfirm, openReceiptsClearConfirm, confirmClearReceipts, receiptRunSpan, formatRunLength, receiptRunDetail, focusLedgerReceipt, buildProofText */
