// Renderer: Night Modes library interaction.
// Renders the card grid, handles selection, detail view, and Use Tonight handoff.

/* global api, escapeHtml, loGlyph, state, describeLightsReadiness, getWindDownFacts, windDownEffects */

'use strict';

// One stroke-glyph per mode category (UI-R2: no emoji chrome). Static,
// trusted markup; currentColor follows the card's readiness tier.
const nmGlyph = paths => `<svg class="nm-glyph" viewBox="0 0 28 28" aria-hidden="true">${paths}</svg>`;
const ARTWORK_MAP = {
  'quick-sleep': nmGlyph('<path d="M21.5 16.6A8.6 8.6 0 0 1 11.4 6.5a8.6 8.6 0 1 0 10.1 10.1z"/><path d="M18.6 4.4l-2 3.6h3l-2 3.6"/>'),
  'lights-down': nmGlyph('<path d="M10.6 18.6c0-2.2-3-3.6-3-7.4a6.4 6.4 0 0 1 12.8 0c0 3.8-3 5.2-3 7.4z"/><path d="M11 21.6h6M12.2 24.4h3.6"/><path d="M10.4 11.4a3.6 3.6 0 0 1 3.6-3.6"/>'),
  'movie-wind-down': nmGlyph('<rect x="3.6" y="5.6" width="20.8" height="13.6" rx="2"/><path d="M12 9.4v6l5-3z"/><path d="M10 23.2h8"/>'),
  'full-shutdown': nmGlyph('<path d="M14 3.8v9.4"/><path d="M8.2 7.6a8.8 8.8 0 1 0 11.6 0"/>'),
  'quiet-house': nmGlyph('<path d="M4.4 13.2 14 5l9.6 8.2"/><path d="M7 11.4v11.4h14V11.4"/><path d="M12 22.8v-5.4h4v5.4"/>'),
  'school-night': nmGlyph('<path d="M4.6 7.4c3.2-1 6.4-.8 9.4.8v15c-3-1.6-6.2-1.8-9.4-.8z"/><path d="M14 8.2c3-1.6 6.2-1.8 9.4-.8v15c-3.2-1-6.4-.8-9.4.8"/><path d="M20.4 3.4a2.6 2.6 0 0 0 2.8 3.4 3.2 3.2 0 1 1-2.8-3.4z"/>')
};
const ARTWORK_FALLBACK = ARTWORK_MAP['quick-sleep'];

// UI-R3 Fire 08: scene posters from the logo's world, one per Ready mode.
// Static, trusted markup (never data): no <defs>, ids, images, links, script
// or handlers. Inked with currentColor (the violet "you act" accent, set in
// CSS) and neutral white alphas only -- never teal, amber or red, so a poster
// can never read as a live, Test Mode or REAL signal. Every subject sits in
// x 110-250 of the 400x84 band: the glyph tile keeps the left edge and the
// duration ring the right (x >= 285 stays empty; nothing above .25 alpha
// within 20 units of it). An unknown artworkId gets no poster.
const nmScene = body => `<svg class="nm-scene-art" viewBox="0 0 400 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${body}</svg>`;
const SCENE_MAP = Object.freeze({
  // A crescent over a broken horizon, with the logo's flicker diamonds.
  'quick-sleep': nmScene(
    '<path d="M40 63H118M128 63H262" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>'
    + '<path d="M171 45A19 19 0 0 1 149 22.5a19 19 0 1 0 22 22.5z" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.4"/>'
    + '<path d="M198 20l2.6 2.6-2.6 2.6-2.6-2.6z" fill="currentColor" fill-opacity="0.6"/>'
    + '<path d="M214 44l2 2-2 2-2-2z" fill="currentColor" fill-opacity="0.42"/>'
    + '<path d="M236 28l1.6 1.6-1.6 1.6-1.6-1.6z" fill="currentColor" fill-opacity="0.24"/>'
    + '<path d="M128 26h.01M226 56h.01M216 12h.01" stroke="rgba(255,255,255,0.35)" stroke-width="1.6" stroke-linecap="round"/>'),
  // The logo's desk lamp, its beam a flat low-alpha wedge down to the floor.
  'lights-down': nmScene(
    '<path d="M40 66H262" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>'
    + '<path d="M182 31L250 66H178L176 44z" fill="currentColor" fill-opacity="0.10"/>'
    + '<path d="M182 66h52" stroke="currentColor" stroke-opacity="0.22" stroke-width="2" stroke-linecap="round"/>'
    + '<path d="M128 66h28M142 66l-6-24 22-16" fill="none" stroke="currentColor" stroke-opacity="0.6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M156 21l26 10-6 13-26-10z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<path d="M136 42h.01" stroke="currentColor" stroke-opacity="0.7" stroke-width="3" stroke-linecap="round"/>'),
  // A screen with end credits, a flat glow and a light spill (no play mark).
  'movie-wind-down': nmScene(
    '<path d="M40 68H262" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>'
    + '<path d="M140 56h92l26 12H116z" fill="currentColor" fill-opacity="0.06"/>'
    + '<rect x="132" y="14" width="108" height="42" rx="3" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.4"/>'
    + '<path d="M170 26h32M176 33h20M166 40h40M178 47h16" stroke="rgba(255,255,255,0.3)" stroke-width="1.4" stroke-linecap="round"/>'
    + '<path d="M176 61h20" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.4" stroke-linecap="round"/>'),
  // The lamp again, its beam cut short at a hard edge, and a small power tick.
  'full-shutdown': nmScene(
    '<path d="M40 66H262" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>'
    + '<path d="M128 66h28M142 66l-6-24 22-16" fill="none" stroke="currentColor" stroke-opacity="0.6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M156 21l26 10-6 13-26-10z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<path d="M136 42h.01" stroke="currentColor" stroke-opacity="0.7" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M182 31L206 46L192 52L176 44z" fill="currentColor" fill-opacity="0.12"/>'
    + '<path d="M206 46L192 52" stroke="rgba(255,255,255,0.32)" stroke-width="1.2" stroke-linecap="round"/>'
    + '<path d="M232 24v8" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M226.5 27.2a7.4 7.4 0 1 0 11 0" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.6" stroke-linecap="round"/>')
});

let nmCatalogue = [];
let nmSelectedId = null;
// Listener wiring runs once (initNightModes); a retry only re-fetches.
let nmWired = false;
// Detail facts read from main when a detail opens: the ritual steps
// (api.ritualConfig) and the settings that gate conditional steps. undefined =
// not read yet, null = the read failed. Never filled with built-in defaults.
let nmFacts = { ritual: undefined, contentBlocker: undefined, app: undefined, lights: undefined };
let nmFactsSeq = 0;

// Action tags get a class from this whitelist only (never from data).
const NM_ACTION_CLASS = Object.freeze({
  shutdown: 'act-shutdown', restart: 'act-restart', logout: 'act-logout',
  hibernate: 'act-hibernate', sleep: 'act-sleep', lock: 'act-lock'
});
// Actions that end the session or power the PC off: they carry the power
// glyph, and the danger tint only under body.real-action (styles.css P12).
const NM_POWER_ACTIONS = Object.freeze(['shutdown', 'restart', 'logout', 'hibernate']);
const NM_ACTION_VERB = Object.freeze({
  sleep: 'sleep', shutdown: 'shut down', restart: 'restart',
  hibernate: 'hibernate', lock: 'lock', logout: 'log out'
});
// The duration gauge spans 0..2h; longer modes read '>2h' on a full arc.
const NM_RING_CAP_SECONDS = 7200;
const NM_RING_TRACK = 136; // of C = 2*pi*24 = 150.8, leaving the broken-O gap

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(seconds / 60)} min`;
}

function formatAction(action) {
  const map = { shutdown: 'Shutdown', sleep: 'Sleep', restart: 'Restart', hibernate: 'Hibernate', lock: 'Lock', logout: 'Log out' };
  return map[action] || action;
}

// Static broken-O duration gauge, read like an instrument: a big numeral
// with its unit below. Built from clamped numbers only. The ring shows whole
// minutes ('15' / 'MIN', never '0' for a positive duration) up to the 2h cap
// and '>2' / 'HRS' past it; the duration chip, visible only where the ring is
// hidden (the rail), keeps the shared formatDuration vocabulary.
function nmRingParts(secs) {
  if (secs > NM_RING_CAP_SECONDS) return { num: '>2', unit: 'HRS' };
  if (secs > 0) return { num: String(Math.max(1, Math.round(secs / 60))), unit: 'MIN' };
  return { num: '0', unit: 'MIN' };
}

function nmRingSvg(seconds, extraClass = '') {
  const raw = Number(seconds);
  const secs = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const ratio = Math.min(1, secs / NM_RING_CAP_SECONDS);
  const arc = Math.round(NM_RING_TRACK * ratio * 10) / 10;
  const { num, unit } = nmRingParts(secs);
  const cls = extraClass === 'nm-ring--hero' ? 'nm-ring nm-ring--hero' : 'nm-ring';
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">`
    + `<circle class="nm-ring-track" cx="32" cy="32" r="24" stroke-dasharray="${NM_RING_TRACK} 14.8" transform="rotate(-50 32 32)"/>`
    + `<circle class="nm-ring-arc" cx="32" cy="32" r="24" stroke-dasharray="${arc} 999" transform="rotate(-50 32 32)"/>`
    + `<text class="nm-ring-num" x="32" y="28.5">${escapeHtml(num)}</text>`
    + `<text class="nm-ring-unit" x="32" y="42">${escapeHtml(unit)}</text></svg>`;
}

function nmActionTagHtml(action) {
  const cls = Object.prototype.hasOwnProperty.call(NM_ACTION_CLASS, action) ? NM_ACTION_CLASS[action] : 'act-other';
  const glyph = NM_POWER_ACTIONS.includes(action) && typeof loGlyph === 'function' ? loGlyph('power', 'chip-glyph nm-tag-glyph') : '';
  return `<span class="nm-card-tag nm-act ${cls}">${glyph}${escapeHtml(formatAction(action))}</span>`;
}

// UI-R3 Fire 08: a mode that hands the screen to the guided ritual says so
// on its card. Literal class and label only: nothing from the mode reaches
// the markup. Ready cards only (the later shelf never advertises a ritual).
function nmIsRitualMode(mode) {
  return Boolean(mode && mode.timer && mode.timer.ritualId === 'standard');
}

function nmRitualTagHtml(mode) {
  if (!nmIsRitualMode(mode)) return '';
  const glyph = typeof loGlyph === 'function' ? loGlyph('wind', 'chip-glyph nm-tag-glyph') : '';
  return `<span class="nm-card-tag nm-ritual">${glyph}<span class="nm-ritual-label">Ritual</span></span>`;
}

// The Ready card's one accessible name: what it is, how long, what ends it.
function nmReadyCardLabel(mode) {
  const label = `${mode.title}: ${formatDuration(mode.timer.durationSeconds)}, then ${formatAction(mode.timer.action)}`;
  return nmIsRitualMode(mode) ? `${label}, with a guided ritual` : label;
}

function nmBindCard(card, mode) {
  card.dataset.modeId = mode.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-pressed', String(mode.id === nmSelectedId));
  if (mode.id === nmSelectedId) card.classList.add('selected');
  card.addEventListener('click', () => selectMode(mode.id));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode(mode.id); }
  });
}

function renderCards() {
  const grid = document.getElementById('nm-cards-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const laterGrid = document.getElementById('nm-later-grid');
  if (laterGrid) laterGrid.innerHTML = '';

  const ready = nmCatalogue.filter(mode => mode.status === 'ready');
  const later = nmCatalogue.filter(mode => mode.status !== 'ready');

  for (const mode of ready) {
    const card = document.createElement('div');
    card.className = 'nm-card';
    const artwork = ARTWORK_MAP[mode.artworkId] || ARTWORK_FALLBACK;
    card.innerHTML = `
      <div class="nm-card-scene">${SCENE_MAP[mode.artworkId] || ''}
        <div class="nm-card-artwork">${artwork}</div>
        ${nmRingSvg(mode.timer.durationSeconds)}
      </div>
      <div class="nm-card-body">
        <div class="nm-card-title">${escapeHtml(mode.title)}</div>
        <div class="nm-card-subtitle">${escapeHtml(mode.subtitle)}</div>
        <div class="nm-card-tags">
          <span class="nm-card-tag nm-dur">${escapeHtml(formatDuration(mode.timer.durationSeconds))}</span>
          ${nmActionTagHtml(mode.timer.action)}
          ${nmRitualTagHtml(mode)}
        </div>
      </div>
    `;
    card.setAttribute('aria-label', nmReadyCardLabel(mode));
    nmBindCard(card, mode);
    grid.appendChild(card);
  }

  // The honest shelf: same .nm-card contract (clickable, opens the detail
  // with its reason), but a ghost row that never looks runnable. The visible
  // status tag names the gap; the full reason lives in the aria-label and in
  // the detail's Requires (no hidden reason node on the card).
  for (const mode of later) {
    if (!laterGrid) break;
    const reason = (mode.availability && mode.availability.reason) || mode.status.replace(/_/g, ' ');
    const card = document.createElement('div');
    card.className = 'nm-card nm-card--later disabled';
    const artwork = ARTWORK_MAP[mode.artworkId] || ARTWORK_FALLBACK;
    card.innerHTML = `
      <div class="nm-card-artwork">${artwork}</div>
      <div class="nm-card-body">
        <div class="nm-card-title">${escapeHtml(mode.title)}</div>
      </div>
      <div class="nm-card-tags">${getStatusTagHtml(mode.status)}</div>
    `;
    card.setAttribute('aria-label', `${mode.title} (unavailable: ${reason})`);
    nmBindCard(card, mode);
    laterGrid.appendChild(card);
  }

  const count = document.getElementById('nm-ready-count');
  if (count) {
    count.textContent = ready.length > 0 ? `${ready.length} on this PC` : '';
    count.hidden = ready.length === 0;
  }
  // The 'Ready' eyebrow is hidden only on a failed load (loadNightModes'
  // catch); every successful render shows it again.
  nmSetReadyHeadHidden(false);
  const laterSection = document.getElementById('nm-later-section');
  if (laterSection) laterSection.hidden = later.length === 0;
  if (ready.length === 0 && nmCatalogue.length > 0) {
    const note = document.createElement('p');
    note.className = 'nm-empty-note';
    note.textContent = 'No Night Modes are ready on this PC.';
    grid.appendChild(note);
  }
}

// One status vocabulary with the phone companion (companion.html
// getNmStatusLabel): Coming later / Needs router control / Needs device
// setup / Unavailable. Static strings only; reasons are rendered elsewhere.
// Every unavailable tag is muted and dashed (never amber): there is no setup
// the user can do here yet.
function getStatusTagHtml(status) {
  if (status === 'ready') return '';
  if (status === 'coming_soon') {
    return '<span class="nm-card-tag status-coming-soon">Coming later</span>';
  }
  if (status === 'needs_router_setup') {
    return '<span class="nm-card-tag status-needs-setup">Needs router control</span>';
  }
  if (status === 'needs_device_setup') {
    return '<span class="nm-card-tag status-needs-setup">Needs device setup</span>';
  }
  return '<span class="nm-card-tag status-coming-soon">Unavailable</span>';
}

function nmText(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderDetail(mode) {
  const panel = document.getElementById('nm-detail-panel');
  if (!panel || !mode) { closeDetail(); return; }

  panel.style.display = '';
  document.querySelector('.nm-library-body')?.classList.add('has-detail');

  renderDetailScene(mode);
  document.getElementById('nm-detail-title').textContent = mode.title;
  document.getElementById('nm-detail-subtitle').textContent = mode.subtitle;
  renderDetailSpec(mode);

  // Tier: only from the real status mapping (the shared vocabulary).
  const tier = document.getElementById('nm-detail-tier');
  if (tier) {
    const ready = mode.status === 'ready';
    tier.textContent = ready ? 'Ready on this PC' : getStatusTagHtml(mode.status).replace(/<[^>]+>/g, '');
    tier.dataset.tone = ready ? 'ok' : 'off';
  }

  renderDetailTimeline(mode);
  renderDetailRequires(mode);

  // Use Tonight: disabled exactly when the mode is not ready (unchanged).
  const btn = document.getElementById('nm-btn-use-tonight');
  btn.disabled = mode.status !== 'ready';
  renderDetailTruth();
}

// UI-R3 Fire 08: the poster spread. The card's poster (if any), its glyph
// tile and the hero ring, built only from the static maps and nmRingSvg's
// clamped numbers. The ring is the one duration statement in the detail.
// It draws once per open: the arc starts at '0 999', a forced style flush
// commits that, then the final value (read from nmRingSvg's own attribute,
// so the end state equals the static gauge) is set and the CSS transition on
// .nm-ring--hero .nm-ring-arc carries it. A transition, never an animation;
// the reduced-motion contract collapses it to the end state. The numeral
// and unit are static the whole time.
function renderDetailScene(mode) {
  const scene = document.getElementById('nm-detail-scene');
  if (!scene) return;
  scene.dataset.tier = mode.status === 'ready' ? 'ready' : 'off';
  scene.innerHTML = `${SCENE_MAP[mode.artworkId] || ''}`
    + `<div class="nm-detail-art">${ARTWORK_MAP[mode.artworkId] || ARTWORK_FALLBACK}</div>`
    + nmRingSvg(mode.timer.durationSeconds, 'nm-ring--hero');
  const arc = scene.querySelector('.nm-ring--hero .nm-ring-arc');
  const final = arc ? arc.getAttribute('stroke-dasharray') : null;
  if (!arc || !arc.style || !final) return;
  arc.style.strokeDasharray = '0 999';
  void arc.getBoundingClientRect();
  arc.style.strokeDasharray = final;
}

// How the mode starts, in one line (textContent). A ritual mode says 'Guided
// ritual' only while the ritual is really on with a countdown step (the same
// reading as the timeline); otherwise the neutral 'Ritual mode', so the line
// never contradicts the timeline's warning.
function nmDetailSpec(mode) {
  if (!nmIsRitualMode(mode)) return 'Direct start';
  return nmRitualSteps() ? 'Guided ritual' : 'Ritual mode';
}

function renderDetailSpec(mode) {
  const spec = document.getElementById('nm-detail-spec');
  if (!spec) return;
  const text = nmDetailSpec(mode);
  if (spec.textContent !== text) spec.textContent = text;
}

// The canonical Test Mode / REAL words for this detail, from state.dryRun
// (the same field Start reads). Nothing until saved settings have loaded.
function nmTruthFor(mode) {
  if (!mode || mode.status !== 'ready') return null;
  if (typeof state === 'undefined' || !state || state.settingsLoaded !== true) return null;
  const action = mode.timer.action;
  if (state.dryRun === true) {
    return { tone: 'test', text: "Test Mode: this mode won't power off this PC", node: 'Test Mode: no power action' };
  }
  if (state.dryRun !== false) return null;
  const verb = NM_ACTION_VERB[action] || String(formatAction(action)).toLowerCase();
  const forced = Boolean(state.forceShutdown) && (action === 'shutdown' || action === 'restart');
  const name = forced ? `Force ${String(formatAction(action)).toLowerCase()}` : formatAction(action);
  return {
    tone: 'real',
    text: `Real ${name}: this PC will ${forced ? 'force ' : ''}${verb} when the countdown ends, unless you cancel`,
    node: `Real: this PC will ${forced ? 'force ' : ''}${verb}`
  };
}

// Idempotent: writes the truth line, the timeline's action truth and the
// Use Tonight label only when they change. Called from renderDetail and,
// typeof-guarded, from renderer.js render() and the modes route. No
// animation or transition anywhere on these elements.
function renderDetailTruth() {
  if (!nmSelectedId) return;
  const mode = nmCatalogue.find(m => m.id === nmSelectedId);
  if (!mode) return;
  const truth = nmTruthFor(mode);
  const tone = truth ? truth.tone : '';

  const line = document.getElementById('nm-detail-truth');
  if (line) {
    const text = truth ? truth.text : '';
    if (line.textContent !== text) line.textContent = text;
    if ((line.dataset.tone || '') !== tone) line.dataset.tone = tone;
    if (line.hidden !== !truth) line.hidden = !truth;
  }
  const nodeTruth = document.querySelector('#nm-detail-timeline .nm-tl-truth');
  if (nodeTruth) {
    const text = truth ? truth.node : '';
    if (nodeTruth.textContent !== text) nodeTruth.textContent = text;
    if ((nodeTruth.dataset.tone || '') !== tone) nodeTruth.dataset.tone = tone;
    if (nodeTruth.hidden !== !truth) nodeTruth.hidden = !truth;
  }

  // UI-R3 Fire 08: Test Mode holds back only the power action. In loaded Test
  // Mode, a ready mode also states the wind-down effects that still run, from
  // Fire 02's one helper (main's own conditions). Static amber, written on
  // change, hidden otherwise; never animated.
  const scope = document.getElementById('nm-detail-scope');
  if (scope) {
    let text = '';
    if (mode.status === 'ready' && typeof state !== 'undefined' && state
      && state.settingsLoaded === true && state.dryRun === true) {
      const facts = typeof getWindDownFacts === 'function' ? getWindDownFacts() : null;
      const effects = facts && typeof windDownEffects === 'function' ? windDownEffects(facts).effects : [];
      if (effects.length > 0) text = `Wind-down still runs in Test Mode: ${effects.map(e => e.label).join(', ')}.`;
    }
    if (scope.textContent !== text) scope.textContent = text;
    if (scope.hidden !== !text) scope.hidden = !text;
  }

  const btn = document.getElementById('nm-btn-use-tonight');
  if (btn) {
    const armed = typeof state !== 'undefined' && Boolean(state && state.armedNightMode
      && state.armedNightMode.nightModeId === mode.id);
    const label = mode.status !== 'ready' ? 'Not Available' : (armed ? 'Armed: Go to Tonight' : 'Use Tonight');
    let main = btn.querySelector('.nm-cta-main');
    if (!main) {
      btn.textContent = '';
      main = nmText('span', 'nm-cta-main');
      btn.appendChild(main);
    }
    if (main.textContent !== label) main.textContent = label;
    btn.classList.toggle('is-armed', armed && mode.status === 'ready');
  }
}

// A conditional ritual step reads the real setting that gates its side
// effect in main (ritual onStep): content blocker, Night Light on dim, smart
// lights. 'unknown' when that setting could not be read.
function nmStepSetting(stepId) {
  if (stepId === 'block') {
    const cb = nmFacts.contentBlocker;
    return cb && typeof cb === 'object' ? (cb.enabled ? 'on' : 'off') : 'unknown';
  }
  if (stepId === 'dim') {
    const app = nmFacts.app;
    return app && typeof app === 'object' ? (app.nightLightOnDim === true ? 'on' : 'off') : 'unknown';
  }
  if (stepId === 'lights') {
    const lights = nmFacts.lights;
    return lights && typeof lights === 'object' ? (lights.enabled ? 'on' : 'off') : 'unknown';
  }
  return null;
}

function nmStepSeconds(step) {
  const n = Number(step && step.durationSeconds);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nmRitualSteps() {
  const ritual = nmFacts.ritual;
  if (!ritual || typeof ritual !== 'object' || ritual.enabled === false) return null;
  const steps = Array.isArray(ritual.steps) ? ritual.steps.filter(s => s && typeof s === 'object') : [];
  return steps.length > 0 && steps.some(s => s.id === 'timer') ? steps : null;
}

// The real order of tonight, as nodes { label, meta, kind, tone }. A ritual
// mode reads the configured steps (api.ritualConfig); when the ritual is off,
// empty or unreadable it says so and never shows built-in defaults. No
// absolute clock times or intervals are claimed.
function buildTimeline(mode) {
  const d = mode.timer.durationSeconds;
  const action = { label: `${formatAction(mode.timer.action)} this PC`, meta: 'when the countdown ends', kind: 'action' };
  if (mode.timer.ritualId !== 'standard') {
    return [{ label: `${formatDuration(d)} countdown starts`, meta: 'when you press Start', kind: 'countdown' }, action];
  }
  const ritual = nmFacts.ritual;
  if (ritual === undefined) {
    return [{ label: 'Standard wind-down ritual', meta: 'Reading steps…', kind: 'step' }];
  }
  const steps = nmRitualSteps();
  if (!steps) {
    let warn = "Ritual steps couldn't be read";
    if (ritual && typeof ritual === 'object') {
      const configured = Array.isArray(ritual.steps) ? ritual.steps : [];
      warn = ritual.enabled === false || configured.length === 0
        ? 'Ritual is turned off in Settings'
        : 'Ritual has no countdown step in Settings';
    }
    return [
      { label: 'Standard wind-down ritual', meta: '', kind: 'step' },
      { label: warn, meta: '', kind: 'warn' }
    ];
  }
  const nodes = [];
  let afterTimer = false;
  for (const step of steps) {
    if (step.id === 'timer') {
      const secs = nmStepSeconds(step);
      nodes.push({ label: `${formatDuration(d)} countdown starts`, meta: secs > 0 ? formatDuration(secs) : 'tap to continue', kind: 'countdown' });
      afterTimer = true;
      continue;
    }
    const label = String(step.label || step.id || 'Ritual step').slice(0, 60);
    const setting = nmStepSetting(step.id);
    if (setting === 'off') {
      nodes.push({ label, meta: 'Off', kind: 'step', tone: 'off' });
    } else if (setting === 'unknown') {
      nodes.push({ label, meta: 'if enabled in Settings', kind: 'step', tone: 'off' });
    } else {
      const secs = nmStepSeconds(step);
      nodes.push({ label, meta: afterTimer ? 'during the countdown' : (secs > 0 ? formatDuration(secs) : 'tap to continue'), kind: 'step' });
    }
  }
  nodes.push(action);
  return nodes;
}

function renderDetailTimeline(mode) {
  const timeline = document.getElementById('nm-detail-timeline');
  if (!timeline) return;
  timeline.innerHTML = '';
  for (const node of buildTimeline(mode)) {
    const li = nmText('li', 'nm-tl-node');
    li.dataset.kind = node.kind;
    if (node.tone) li.dataset.tone = node.tone;
    li.appendChild(nmText('span', 'nm-tl-dot'));
    const main = nmText('span', 'nm-tl-main');
    main.appendChild(nmText('span', 'nm-tl-label', node.label));
    if (node.kind === 'action' && mode.status === 'ready') {
      const truth = nmText('span', 'nm-tl-truth');
      truth.hidden = true;
      main.appendChild(truth);
    }
    li.appendChild(main);
    if (node.meta) li.appendChild(nmText('span', 'nm-tl-meta', node.meta));
    timeline.appendChild(li);
  }
}

function nmReqRow(label, pill, tone) {
  const row = nmText('div', 'nm-req-row');
  row.appendChild(nmText('span', 'nm-req-label', label));
  const p = nmText('span', 'nm-req-pill', pill);
  p.dataset.tone = tone;
  row.appendChild(p);
  return row;
}

// Requires: what this mode needs on this PC, from the catalogue's own
// availability (the reason text stays in #nm-detail-status) and, when the
// ritual includes the lights step, the shared smart-lights reading.
function renderDetailRequires(mode) {
  const statusEl = document.getElementById('nm-detail-status');
  if (!statusEl) return;
  statusEl.innerHTML = '';
  const supported = mode.status === 'ready' && !(mode.availability && mode.availability.supported === false);
  statusEl.className = `nm-detail-status ${supported ? 'ready' : 'unavailable'}`;
  statusEl.appendChild(nmReqRow(`This PC · ${formatAction(mode.timer.action)}`, supported ? 'Ready' : 'Not supported yet', supported ? 'ok' : 'warn'));
  if (!supported) {
    const reason = (mode.availability && mode.availability.reason) || mode.status.replace(/_/g, ' ');
    statusEl.appendChild(nmText('p', 'nm-req-reason', reason));
  }
  const steps = mode.timer.ritualId === 'standard' ? nmRitualSteps() : null;
  if (steps && steps.some(s => s.id === 'lights')) {
    let reading = { label: 'Checking…', tone: 'off' };
    if (nmFacts.lights !== undefined && typeof describeLightsReadiness === 'function') {
      reading = describeLightsReadiness(nmFacts.lights);
    }
    statusEl.appendChild(nmReqRow('Smart Lights', reading.label, reading.tone === 'error' ? 'warn' : reading.tone));
  }
}

// Reads the facts a detail shows, each guarded: a failed read is null and
// renders as unknown, never as a default. Re-renders only the still-selected
// mode (a slower, older read never overwrites a newer one).
async function refreshDetailFacts() {
  const seq = ++nmFactsSeq;
  const read = async fn => {
    try {
      const value = await fn();
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  };
  const [ritual, contentBlocker, appSettings, lights] = await Promise.all([
    read(() => (typeof api.ritualConfig === 'function' ? api.ritualConfig() : null)),
    read(() => (typeof api.getContentBlockerSettings === 'function' ? api.getContentBlockerSettings() : null)),
    read(() => (typeof api.getAppSettings === 'function' ? api.getAppSettings() : null)),
    read(() => (typeof api.getSmartLightConfig === 'function' ? api.getSmartLightConfig() : null))
  ]);
  if (seq !== nmFactsSeq) return;
  nmFacts = {
    ritual,
    contentBlocker,
    app: appSettings && appSettings.app && typeof appSettings.app === 'object' ? appSettings.app : null,
    lights
  };
  const mode = nmSelectedId ? nmCatalogue.find(m => m.id === nmSelectedId) : null;
  if (mode) {
    renderDetailSpec(mode);
    renderDetailTimeline(mode);
    renderDetailRequires(mode);
    renderDetailTruth();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction
// ─────────────────────────────────────────────────────────────────────────────

function selectMode(id) {
  const mode = nmCatalogue.find(m => m.id === id);
  if (!mode) return;
  nmSelectedId = id;

  // Selecting an unavailable mode must clear any previously armed ready mode
  if (mode.status !== 'ready' && typeof clearArmedNightMode === 'function') {
    clearArmedNightMode();
  }

  // Update card selection state and aria-pressed
  document.querySelectorAll('.nm-card').forEach(c => {
    const isSelected = c.dataset.modeId === id;
    c.classList.toggle('selected', isSelected);
    c.setAttribute('aria-pressed', String(isSelected));
  });

  document.querySelector('.nm-library-body')?.classList.add('has-detail');
  renderDetail(mode);
  void refreshDetailFacts();
}

// The one way the detail closes: the Back button and renderDetail's no-mode
// path. Selection, the open panel and the rail layout clear together.
function closeDetail() {
  nmSelectedId = null;
  nmFactsSeq++;
  document.querySelectorAll('.nm-card').forEach(c => {
    c.classList.remove('selected');
    c.setAttribute('aria-pressed', 'false');
  });
  const panel = document.getElementById('nm-detail-panel');
  if (panel) panel.style.display = 'none';
  document.querySelector('.nm-library-body')?.classList.remove('has-detail');
}

async function useTonight() {
  if (!nmSelectedId) return;
  const mode = nmCatalogue.find(m => m.id === nmSelectedId);
  if (!mode || mode.status !== 'ready') return;

  const result = await api.useNightModeTonight(nmSelectedId);
  if (!result || !result.success) {
    console.error('[NightModes] Use Tonight failed:', result && result.error);
    return;
  }

  // Load resolved values into Tonight lobby (timer input and action selector)
  const durationMinutes = Math.round(result.durationSeconds / 60);
  const timerInput = document.getElementById('timer-input');
  if (timerInput) timerInput.value = String(durationMinutes);

  // Set action via the renderer's canonical setAction (avoids simulated click)
  if (typeof setAction === 'function') {
    // Temporarily arm first so setAction's checkArmedModeMatch sees the new
    // canonical values and does not clear it.
    if (typeof armNightMode === 'function') {
      armNightMode({
        nightModeId: result.nightModeId,
        nightModeTitle: result.nightModeTitle,
        durationSeconds: result.durationSeconds,
        action: result.action,
        ritualId: result.ritualId
      });
    }
    setAction(result.action);
  } else {
    // Fallback: simulate click on matching action button
    const actionBtns = document.querySelectorAll('.setup-controls [data-action]');
    actionBtns.forEach(btn => {
      if (btn.dataset.action === result.action) btn.click();
    });
    if (typeof armNightMode === 'function') {
      armNightMode({
        nightModeId: result.nightModeId,
        nightModeTitle: result.nightModeTitle,
        durationSeconds: result.durationSeconds,
        action: result.action,
        ritualId: result.ritualId
      });
    }
  }
  renderDetailTruth();

  // Navigate to Tonight panel
  const tonightBtn = document.querySelector('[data-ns-tab="lib"]');
  if (tonightBtn) tonightBtn.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

function nmNormalizeCatalogue(raw) {
  return (Array.isArray(raw) ? raw : []).map(mode => {
    if (!mode.timer) {
      return {
        ...mode,
        timer: {
          durationSeconds: mode.durationSeconds,
          action: mode.action,
          ritualId: mode.ritualId
        }
      };
    }
    return mode;
  });
}

function nmSetReadyHeadHidden(hidden) {
  const count = document.getElementById('nm-ready-count');
  const head = count && typeof count.closest === 'function' ? count.closest('.nm-tier-head') : null;
  if (head && head.hidden !== hidden) head.hidden = hidden;
}

// Fetch the catalogue and render the cards. On failure: a designed state in
// the grid (never a blank grid, never the raw error), with Try again. A retry
// runs only this function: it re-fetches and calls renderCards, and leaves
// listeners and any armed mode alone.
async function loadNightModes() {
  try {
    const raw = await api.getNightModesCatalogue();
    nmCatalogue = nmNormalizeCatalogue(raw);
    renderCards();
  } catch (err) {
    console.error('[NightModes] Failed to load catalogue:', err);
    nmCatalogue = [];
    renderCards();
    // A failed load is not the Ready tier: drop its eyebrow above the box.
    nmSetReadyHeadHidden(true);
    const grid = document.getElementById('nm-cards-grid');
    if (grid) {
      const box = nmText('div', 'nm-empty');
      box.setAttribute('role', 'status');
      box.appendChild(nmText('strong', '', "Night Modes didn't load."));
      box.appendChild(nmText('span', '', 'Tonight still works manually.'));
      const retry = nmText('button', 'btn-quiet btn-compact', 'Try again');
      retry.type = 'button';
      retry.id = 'nm-retry';
      retry.addEventListener('click', () => {
        if (retry.disabled) return;
        retry.disabled = true;
        void loadNightModes();
      });
      box.appendChild(retry);
      grid.replaceChildren(box);
    }
  }
}

async function initNightModes() {
  // Once-guard: set before the first await so a second call never re-binds.
  if (!nmWired) {
    nmWired = true;
    const backBtn = document.getElementById('nm-detail-back');
    if (backBtn) backBtn.addEventListener('click', () => {
      const previous = nmSelectedId;
      closeDetail();
      const card = previous ? [...document.querySelectorAll('.nm-card')].find(c => c.dataset.modeId === previous) : null;
      if (card) card.focus();
    });
    const useBtn = document.getElementById('nm-btn-use-tonight');
    if (useBtn) useBtn.addEventListener('click', useTonight);
  }
  await loadNightModes();
}

// Export for renderer.js to call during app init, and for render() to keep the
// detail's Test Mode / REAL line current.
if (typeof window !== 'undefined') {
  window.initNightModes = initNightModes;
  window.renderDetailTruth = renderDetailTruth;
  window.formatDuration = formatDuration;
}
