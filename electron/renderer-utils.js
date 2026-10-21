// Renderer utilities: small, dependency-free helpers shared across the
// renderer's feature modules. No reference to `state`/`els`/IPC — safe to
// load first. Loaded as a classic sibling <script> before renderer.js (see
// index.html); top-level declarations here are visible as bare identifiers
// in every script tag that loads after this one, sharing the page's global
// scope (same mechanism lastLight.js/ambientVisuals.js already rely on).

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTimeAgo(date) {
  const sec = Math.round((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return `rgba(155, 147, 214, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// -- Glyph system (UI-R3 P04) -------------------------------------------------
// One static line-glyph vocabulary (18x18, stroke = currentColor) so evidence,
// settings and phone surfaces stop borrowing OS-coloured emoji. These strings
// are constants: never interpolate data into them. loGlyph() only accepts a
// known name (anything else draws a neutral dot) and a class-name token.
const LO_GLYPHS = Object.freeze({
  check: '<path d="M4 9.5l3.2 3.2L14 5.8"/>',
  cross: '<path d="M5 5l8 8M13 5l-8 8"/>',
  test: '<path d="M7 2.5h4M8 2.5v4.2L4.2 14a1.2 1.2 0 0 0 1 1.8h7.6a1.2 1.2 0 0 0 1-1.8L10 6.7V2.5"/>',
  warn: '<path d="M9 2.8L16 15H2z"/><path d="M9 7.4v3.6M9 13.1v.01"/>',
  block: '<circle cx="9" cy="9" r="6.2"/><path d="M4.6 4.6l8.8 8.8"/>',
  ring: '<circle cx="9" cy="9" r="6.2"/><circle cx="9" cy="9" r="2.2"/>',
  clock: '<circle cx="9" cy="9" r="6.5"/><path d="M9 5.5V9l2.5 1.6"/>',
  lamp: '<path d="M3.5 15.5h7M7 15.5l-1.5-5 4.5-4"/><path d="M9.2 3.6l5 2.1-1.5 3.4-5-2.1z"/><path d="M13 10.2l1.2 1.6"/>',
  moon: '<path d="M14.5 11.2A6 6 0 0 1 6.8 3.5a6 6 0 1 0 7.7 7.7z"/>',
  wind: '<path d="M2.5 7h8.5a2.2 2.2 0 1 0-2.2-2.2M2.5 10.5h11a2.2 2.2 0 1 1-2.2 2.2"/>',
  copy: '<rect x="6" y="6" width="9" height="9" rx="1.5"/><path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12"/>',
  download: '<path d="M9 3v8.5M5.5 8L9 11.5 12.5 8M3.5 14.5h11"/>',
  pin: '<path d="M9 16v-4.5M5.5 11.5h7L11 9V4h1V2.5H6V4h1v5z"/>',
  note: '<path d="M4.5 2.5h6l3 3v10h-9z"/><path d="M10.5 2.5v3h3M6.5 9h5M6.5 12h5"/>',
  trash: '<path d="M3.5 5h11M7 5V3.2h4V5M5 5l.8 10.5h6.4L13 5"/>',
  edit: '<path d="M11.8 3.2l3 3-8.3 8.3L3 15l.5-3.5z"/>',
  chevron: '<path d="M7 4.5L11.5 9 7 13.5"/>',
  back: '<path d="M11 4.5L6.5 9l4.5 4.5"/>',
  wifi: '<path d="M2.5 7a9.5 9.5 0 0 1 13 0M5 9.8a6 6 0 0 1 8 0M7.3 12.4a2.6 2.6 0 0 1 3.4 0"/><path d="M9 14.8v.01"/>',
  bell: '<path d="M4.5 12.5v-4a4.5 4.5 0 0 1 9 0v4l1.5 1.5H3z"/><path d="M7.5 15.5a1.6 1.6 0 0 0 3 0"/>',
  house: '<path d="M2.8 8.5L9 3l6.2 5.5M4.5 7.2v8.3h9V7.2"/><path d="M7.5 15.5v-4h3v4"/>',
  power: '<path d="M9 2.5v6"/><path d="M5.2 5.2a5.6 5.6 0 1 0 7.6 0"/>',
  'cloud-off': '<path d="M6 13.5h6.5a2.8 2.8 0 0 0 .9-5.5A4.2 4.2 0 0 0 6 6.3a3.6 3.6 0 0 0 0 7.2z"/><path d="M2.5 2.5l13 13"/>',
  shield: '<path d="M9 2.5l5.5 2v4.2c0 3.3-2.3 5.7-5.5 6.8-3.2-1.1-5.5-3.5-5.5-6.8V4.5z"/>',
  // The logo's broken "O": the countdown ring with the wordmark's gaps.
  'broken-O': '<circle cx="9" cy="9" r="6" stroke-dasharray="12 3 10 3 6 6"/>'
});
const LO_GLYPH_FALLBACK = '<circle cx="9" cy="9" r="1.6"/>';

function loGlyph(name, cls = 'chip-glyph') {
  const body = Object.prototype.hasOwnProperty.call(LO_GLYPHS, name) ? LO_GLYPHS[name] : LO_GLYPH_FALLBACK;
  const safeCls = String(cls).replace(/[^a-zA-Z0-9 _-]/g, '');
  return `<svg class="${safeCls}" viewBox="0 0 18 18" aria-hidden="true" focusable="false">${body}</svg>`;
}

// -- Run origins (UI-R3 P06) ---------------------------------------------------
// Where a run was started, as a short phrase after the session phase
// ("Running · from your phone"). Display only, and only ever from this frozen
// map: an unknown or local ('this-pc') origin adds nothing, and no free text
// from a payload is ever shown. P11 (Proof) reuses it.
const ORIGIN_LABELS = Object.freeze({
  phone: 'from your phone',
  family: 'from another PC',
  schedule: 'from Schedule',
  calendar: 'from your calendar',
  autopilot: 'by Autopilot',
  shortcut: 'from a shortcut',
  tray: 'from the tray',
  launch: 'at launch',
  ritual: 'after the ritual',
  resume: 'resumed after a restart'
});

// -- Nights (UI-R3 P11) --------------------------------------------------------
// A run belongs to a "night": the local date of its start minus 6 hours, the
// same rule streaks.js uses, so a 00:30 run counts toward the evening before.
// An invalid or missing date returns null (callers group it as "Unknown date").
const LO_NIGHT_OFFSET_MS = 6 * 3600 * 1000;
function loLocalDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nightKey(value) {
  if (value === null || value === undefined || value === '') return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return loLocalDateKey(new Date(t - LO_NIGHT_OFFSET_MS));
}
// The local Date (noon) a night key names, or null for a malformed key.
function nightKeyDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}
function nightKeyShift(key, days) {
  const d = nightKeyDate(key);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return loLocalDateKey(d);
}

// -- One clock (UI-R3 Fire 02) --------------------------------------------------
// Every desktop clock string follows Settings › General › Time format. 24-hour
// unless the setting says '12h' (the same fallback as schClockParts), so a
// sandbox or an early render without state reads 24h. compact = the idle
// face's '1:08a' form; formatClock never uses it.
function formatIdleClockTime(now, compact = false) {
  const use12Hour = typeof state !== 'undefined' && state && state.clockFormat === '12h';
  const minutes = now.getMinutes().toString().padStart(2, '0');

  if (!use12Hour) {
    const hours24 = now.getHours().toString().padStart(2, '0');
    return `${hours24}:${minutes}`;
  }

  const hours12 = now.getHours() % 12 || 12;
  const meridiem = now.getHours() >= 12 ? 'PM' : 'AM';
  return compact ? `${hours12}:${minutes}${meridiem.charAt(0).toLowerCase()}` : `${hours12}:${minutes} ${meridiem}`;
}

// A real moment as the user reads clocks: '01:08' or '1:08 AM'. '' for anything
// that is not a valid Date, so every caller keeps its own fallback wording.
function formatClock(date) {
  // toString tag, not instanceof: a Date from another realm (vm tests) counts.
  if (Object.prototype.toString.call(date) !== '[object Date]' || Number.isNaN(date.getTime())) return '';
  return formatIdleClockTime(date, false);
}

// A wall-clock target, qualified by its local calendar day (not a 24-hour
// offset, which is wrong over DST). Countdown values never come from here.
function formatClockTarget(date, now = new Date()) {
  const time = formatClock(date);
  if (!time) return '';
  const sameDay = other => date.getFullYear() === other.getFullYear()
    && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = sameDay(now) ? 'today' : sameDay(tomorrow) ? 'tomorrow'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // A repeated/skipped DST hour needs its target zone to remain intelligible.
  const zone = date.getTimezoneOffset() !== now.getTimezoneOffset()
    ? new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value : '';
  return `${time}${zone ? ` ${zone}` : ''} · ${day}`;
}

// -- One name per session (UI-R3 Fire 02) --------------------------------------
// 'Tonight's plan' is what is set up to run. A session is named by its Night
// Mode, else its My Mode, else the name the user typed on the ring, else
// 'Countdown'. DEFAULT_TIMER_NAME is the stored default (settings.js, main.js):
// it is never shown as a name and never rewritten in the user's settings.
const DEFAULT_TIMER_NAME = 'Last Call';
function sessionDisplayName({ nightModeTitle, profileName, timerName } = {}) {
  const clean = v => (typeof v === 'string' ? v.trim() : '');
  const typed = clean(timerName);
  return clean(nightModeTitle) || clean(profileName) || (typed && typed !== DEFAULT_TIMER_NAME ? typed : '') || 'Countdown';
}

// -- What Test Mode does not hold back (UI-R3 Fire 02) --------------------------
// Test Mode holds back only the power action. main.js applyDimPhase() runs the
// wind-down with no Test Mode check (Night Light, closing apps, media pause,
// Stay on top, Wi-Fi Guard, the Content Blocker) and the countdown tick starts
// the smart-light dim the same way. These two pure functions say so from
// main's own conditions; smoke 'Fire 02 truth and names' fails if main ever
// gates one of them, so this copy must change with it.
//
// pickWindDownFacts keeps only non-secret facts, picked by name: a Wi-Fi
// provider config carries router credentials, so a config is never spread.
// A missing section becomes null (windDownEffects lists it as unknown).
const WIND_DOWN_APP_NAME = /^[A-Za-z0-9 ._-]+$/;           // main.js applyFocusMode
const WIND_DOWN_LAN_PROVIDERS = Object.freeze(['tplink', 'asus', 'netgear', 'webhook']);
function pickWindDownFacts({ app, contentBlocker, wifiGuard, lights } = {}) {
  const section = v => (v && typeof v === 'object' ? v : null);
  const count = v => (Array.isArray(v) ? v.length : 0);
  const a = section(app);
  const cb = section(contentBlocker);
  const wg = section(wifiGuard);
  const li = section(lights);
  return {
    app: a ? {
      nightLightOnDim: a.nightLightOnDim === true,
      pauseMediaOnDim: a.pauseMediaOnDim === true,
      lockoutOnDim: a.lockoutOnDim === true,
      closeApps: Array.isArray(a.focusBlocklist) ? a.focusBlocklist.filter(n => typeof n === 'string' && WIND_DOWN_APP_NAME.test(n)).length : 0
    } : null,
    contentBlocker: cb ? { enabled: Boolean(cb.enabled), blockOnDim: cb.blockOnDim !== false } : null,
    wifiGuard: wg ? {
      enabled: Boolean(wg.enabled) && wg.blockingAvailable !== false,
      blockOnDim: wg.blockOnDim !== false,
      provider: typeof wg.provider === 'string' ? wg.provider : '',
      // A selected device is stored as a MAC + IP pair: count devices, not fields.
      listed: Math.max(count(wg.deviceMacs), count(wg.deviceIps))
    } : null,
    lights: li ? { enabled: li.enabled === true } : null
  };
}

// { effects: [{ id, label }], unknown: [section] }, in a fixed order. Only
// what main would really do: Wi-Fi Guard's 'firewall' provider cannot pause
// another device (main's blockInternet returns a failure), so it adds nothing.
function windDownEffects(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const effects = [];
  const unknown = ['app', 'contentBlocker', 'wifiGuard', 'lights'].filter(k => !f[k]);
  const add = (id, label) => effects.push({ id, label });
  const app = f.app;
  if (app && app.nightLightOnDim === true) add('night-light', 'turns on Night Light');
  const n = app ? Math.max(0, Number(app.closeApps) || 0) : 0;
  if (n > 0) add('close-apps', `closes ${n} app${n === 1 ? '' : 's'}`);
  if (app && app.pauseMediaOnDim === true) add('pause-media', 'pauses media');
  if (app && app.lockoutOnDim === true) add('on-top', 'keeps Lights Out on top');
  const wg = f.wifiGuard;
  if (wg && wg.enabled && wg.blockOnDim !== false) {
    const listed = Math.max(0, Number(wg.listed) || 0);
    if (wg.provider === 'adapter') add('wifi', "turns off this PC's Wi-Fi");
    else if (WIND_DOWN_LAN_PROVIDERS.includes(wg.provider) && listed > 0) add('wifi', `pauses internet for ${listed} device${listed === 1 ? '' : 's'}`);
  }
  const cb = f.contentBlocker;
  if (cb && cb.enabled && cb.blockOnDim !== false) add('sites', 'blocks sites');
  if (f.lights && f.lights.enabled === true) add('lights', 'changes your smart lights');
  return { effects, unknown };
}

// -- One two-step confirm (UI-R3 Fire 08) ---------------------------------------
// The one machine for an inline "press again to confirm" (My Modes delete and
// overwrite; FIRE09's rule delete reuses it). Pure: the caller keeps
// `pending` ({ key, at } or null) and the clock. The first press on a key
// arms it; only a second press on the SAME key within windowMs confirms. A
// press on another key, a press after the window, or a clock that went
// backwards arms again. Confirming returns pending: null (disarmed).
function twoStepNext(pending, key, now, windowMs = 4000) {
  const k = String(key);
  const t = Number(now);
  const p = pending && typeof pending === 'object' ? pending : null;
  if (p && p.key === k && Number.isFinite(t) && Number.isFinite(p.at)) {
    const age = t - p.at;
    if (age >= 0 && age <= windowMs) return { decision: 'confirm', pending: null };
  }
  return { decision: 'arm', pending: { key: k, at: t } };
}

// -- Dialog layers (UI-R3 P05) -------------------------------------------------
// Every dialog container is watched (class + style attributes only). The
// first layer to open remembers the opener, makes .cockpit -- and only
// .cockpit -- inert, and moves focus to the new dialog's title (tabindex=-1),
// never to a destructive, override or confirm control, so Enter / Space can
// never fire an action by accident. When the last layer closes, inert is
// removed and focus goes back to the opener only if focus was lost (BODY or
// a hidden element) and the opener is still usable; closeHelpPanel() and
// closeAnyDismissibleModal() keep their own focus handling because they run
// first. Opening and closing stay with each dialog's own code: this never
// shows, hides or dismisses anything, and never handles Escape.
const LO_DIALOG_IDS = Object.freeze([
  'warning-modal', 'override-modal', 'snooze-tax-modal', 'ritual-overlay',
  'profiles-modal', 'lan-warning-modal', 'receipts-modal',
  'about-modal', 'notif-drawer', 'streak-celebration-modal'
]);
const loDialogStack = [];
let loDialogOpener = null;

function loElementVisible(el) {
  if (!el || !el.isConnected) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  return el.getClientRects().length > 0;
}

// A .modal is open when it is laid out (.active, or an inline display that
// beats the base display:none: ritual-overlay / notif-drawer).
function loDialogIsOpen(el) {
  if (!el || !el.isConnected) return false;
  if (el.classList.contains('modal')) {
    return el.classList.contains('active') || getComputedStyle(el).display !== 'none';
  }
  return el.classList.contains('active');
}

function loFocusDialogTitle(dialog) {
  if (!dialog) return;
  const labelId = dialog.getAttribute('aria-labelledby');
  const title = (labelId && document.getElementById(labelId)) || dialog;
  if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
  try { title.focus({ preventScroll: true }); } catch (_) { /* no-op */ }
}

function loFocusWasLost(cockpit) {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (cockpit && cockpit.hasAttribute('inert') && cockpit.contains(active)) return true;
  return !loElementVisible(active);
}

function syncDialogLayers() {
  const cockpit = document.querySelector('.cockpit');
  const open = LO_DIALOG_IDS.map(id => document.getElementById(id)).filter(loDialogIsOpen);
  // A hand-off (warning -> override in one task) keeps the original opener.
  const hadLayers = loDialogStack.length > 0;
  for (let i = loDialogStack.length - 1; i >= 0; i--) {
    if (!open.includes(loDialogStack[i])) loDialogStack.splice(i, 1);
  }
  const opened = open.filter(el => !loDialogStack.includes(el));
  if (opened.length) {
    if (!hadLayers) {
      const active = document.activeElement;
      loDialogOpener = active && active !== document.body && !opened.some(d => d.contains(active)) ? active : null;
    }
    loDialogStack.push(...opened);
    if (cockpit && !cockpit.hasAttribute('inert')) cockpit.setAttribute('inert', '');
    loFocusDialogTitle(loDialogStack[loDialogStack.length - 1]);
    return;
  }
  if (loDialogStack.length) {
    // A lower layer is still up: keep focus inside it if the closed one took it.
    if (loFocusWasLost(cockpit)) loFocusDialogTitle(loDialogStack[loDialogStack.length - 1]);
    return;
  }
  if (cockpit && cockpit.hasAttribute('inert')) {
    cockpit.removeAttribute('inert');
    const opener = loDialogOpener;
    loDialogOpener = null;
    if (loFocusWasLost(null) && opener && !opener.disabled && loElementVisible(opener) && typeof opener.focus === 'function') {
      try { opener.focus({ preventScroll: true }); } catch (_) { /* no-op */ }
    }
  }
}

function initDialogLayers() {
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(syncDialogLayers);
  LO_DIALOG_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
  });
  syncDialogLayers();
}

let contextMenuEl = null;

function closeContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'app-context-menu';
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      closeContextMenu();
      try { item.action(); } catch (_) { /* no-op */ }
    });
    menu.appendChild(btn);
  });
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const px = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const py = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  menu.style.visibility = 'visible';
  contextMenuEl = menu;
}
// This script loads at the end of <body>, after every dialog container.
initDialogLayers();
/* exported clamp, formatTimeAgo, hexToRgba, escapeHtml, showContextMenu, LO_GLYPHS, loGlyph, ORIGIN_LABELS, nightKey, nightKeyDate, nightKeyShift, formatIdleClockTime, formatClock, formatClockTarget, DEFAULT_TIMER_NAME, sessionDisplayName, pickWindDownFacts, windDownEffects, twoStepNext */
