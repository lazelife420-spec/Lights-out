// Renderer: Night Modes library interaction.
// Renders the Library's Featured/Selected area + Ready/Requires-setup tile
// rows, handles selection, and the Use Tonight handoff into Tonight.
//
// Home/Library redesign pass: replaced the emoji ARTWORK_MAP with inline
// stroke-SVG icons (NS_MODE_ICONS) matching the sidebar's coherent icon
// family, and replaced the old flat card-grid + narrow text sidebar with a
// large Featured area (Steam-like: what's selected gets real visual
// prominence) sitting above two tiered rows of larger tiles. Also exports
// NS_MODE_ICONS/NS_GLANCE_ICONS and renderHomeNightModesTeaser() for
// renderer.js's Home panel to reuse the same icon language and catalogue
// data -- one source of truth for "what a mode looks like," not two.

/* global api, escapeHtml, handleSidebarNavigation */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Icon family: inline stroke SVGs, same spec as the sidebar nav icons
// (viewBox 0 0 24 24, stroke=currentColor, stroke-width=2, round caps/joins,
// fill=none) -- generic geometric glyphs, not emoji, one coherent family.
// ─────────────────────────────────────────────────────────────────────────────

const SVG_OPEN = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const NS_MODE_ICONS = {
  'quick-sleep': `<svg ${SVG_OPEN}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  'lights-down': `<svg ${SVG_OPEN}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>`,
  'movie-wind-down': `<svg ${SVG_OPEN}><path d="M4 8l1.4-4h3L7 8"/><path d="M9.5 8L11 4h3l-1.4 4"/><path d="M15 8l1.4-4h3L18 8"/><rect x="3" y="8" width="18" height="12" rx="2"/></svg>`,
  'full-shutdown': `<svg ${SVG_OPEN}><path d="M12 2v6"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg>`,
  'quiet-house': `<svg ${SVG_OPEN}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  'school-night': `<svg ${SVG_OPEN}><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 2.5 3 6 3s6-1.5 6-3v-5"/></svg>`
};
const NS_MODE_ICON_FALLBACK = NS_MODE_ICONS['quick-sleep'];

// Per-mode accent identity (a distinct color language per mode, not
// fabricated artwork) so the Featured area and its tile read as having a
// real visual identity instead of one generic blue badge repeated for
// every mode. Classes defined alongside .nm-featured-icon/.nm-tile-badge
// in styles.css.
const NS_MODE_ACCENTS = {
  'quick-sleep': 'nm-accent-blue',
  'lights-down': 'nm-accent-amber',
  'movie-wind-down': 'nm-accent-purple',
  'full-shutdown': 'nm-accent-red',
  'quiet-house': 'nm-accent-teal',
  'school-night': 'nm-accent-indigo'
};
function modeAccentClass(mode) {
  return NS_MODE_ACCENTS[mode.artworkId] || 'nm-accent-blue';
}

// Shared with renderer.js's Home "Tonight at a glance" tiles.
const NS_GLANCE_ICONS = {
  alarm: `<svg ${SVG_OPEN}><path d="M12 2v7"/><path d="m4.22 10.22 1.42 1.42"/><path d="M1 18h2"/><path d="M21 18h2"/><path d="m18.36 11.64 1.42-1.42"/><path d="M23 22H1"/><path d="m16 6-4 4-4-4"/><path d="M8 18a4 4 0 1 1 8 0"/></svg>`,
  companion: `<svg ${SVG_OPEN}><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
  lights: NS_MODE_ICONS['lights-down'],
  wifi: `<svg ${SVG_OPEN}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  // Phase 5I-C: media pause glance tile + Tonight plan-summary chip.
  media: `<svg ${SVG_OPEN}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
};

// Also shared: Home's hero CTA and Tonight-card icons.
const NS_HOME_ICONS = {
  play: `<svg ${SVG_OPEN} fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
  arrow: `<svg ${SVG_OPEN}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`
};

if (typeof window !== 'undefined') {
  window.NS_MODE_ICONS = NS_MODE_ICONS;
  window.NS_GLANCE_ICONS = NS_GLANCE_ICONS;
  window.NS_HOME_ICONS = NS_HOME_ICONS;
}

let nmCatalogue = [];
let nmSelectedId = null;

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

function modeIconSvg(mode) {
  return NS_MODE_ICONS[mode.artworkId] || NS_MODE_ICON_FALLBACK;
}

function getStatusTagHtml(status) {
  if (status === 'coming_soon') {
    return '<span class="nm-tile-tag status-coming-soon">COMING SOON</span>';
  }
  if (status === 'needs_router_setup' || status === 'needs_device_setup') {
    return '<span class="nm-tile-tag status-needs-setup">NEEDS SETUP</span>';
  }
  return '';
}

// A larger, tile-style card for the "Ready to Use" / "Requires Setup" rows --
// icon in its own accent-tinted badge (not a bare glyph), title, and one
// compact tag row. Deliberately lighter than the old .nm-card (no long
// subtitle) since the full description now lives in the Featured area once
// selected, not repeated on every tile.
function buildTile(mode) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'nm-tile';
  if (mode.status !== 'ready') tile.classList.add('disabled');
  if (mode.id === nmSelectedId) tile.classList.add('selected');
  tile.dataset.modeId = mode.id;

  const statusTag = mode.status !== 'ready' ? getStatusTagHtml(mode.status) : '';

  tile.innerHTML = `
    <span class="nm-tile-badge ${mode.status === 'ready' ? modeAccentClass(mode) : ''}" aria-hidden="true">${modeIconSvg(mode)}</span>
    <span class="nm-tile-title">${escapeHtml(mode.title)}</span>
    <span class="nm-tile-tags">
      <span class="nm-tile-tag">${formatDuration(mode.timer.durationSeconds)}</span>
      <span class="nm-tile-tag">${formatAction(mode.timer.action)}</span>
      ${statusTag}
    </span>
  `;

  tile.setAttribute('aria-pressed', String(mode.id === nmSelectedId));
  tile.setAttribute('aria-label', `${mode.title}${mode.status !== 'ready' ? ' (unavailable)' : ''}`);
  tile.addEventListener('click', () => selectMode(mode.id));
  return tile;
}

// Grouped by real catalog status, not invented tiers: "Ready to use" (status
// === 'ready') vs "Requires setup / coming later" (everything else).
function renderCards() {
  const readyGrid = document.getElementById('nm-ready-grid');
  const unreadyGrid = document.getElementById('nm-unready-grid');
  const unreadySection = document.getElementById('nm-unready-section');
  if (!readyGrid || !unreadyGrid) return;
  readyGrid.innerHTML = '';
  unreadyGrid.innerHTML = '';

  const ready = nmCatalogue.filter(mode => mode.status === 'ready');
  const notReady = nmCatalogue.filter(mode => mode.status !== 'ready');

  ready.forEach(mode => readyGrid.appendChild(buildTile(mode)));
  notReady.forEach(mode => unreadyGrid.appendChild(buildTile(mode)));

  if (unreadySection) unreadySection.style.display = notReady.length ? '' : 'none';
}

function buildTimeline(mode) {
  const steps = [];
  if (mode.timer.ritualId === 'standard') {
    steps.push('Begin the standard wind-down ritual.');
  }
  steps.push(`Run a ${formatDuration(mode.timer.durationSeconds)} countdown.`);
  steps.push(`${formatAction(mode.timer.action)} this PC when the countdown completes.`);
  return steps;
}

// Real, non-fabricated "what else participates tonight" chips -- only shown
// when the corresponding global feature is actually enabled/configured, per
// the same source data the Devices panel and Home's "Tonight at a glance"
// read (state.smartLights / api.getWifiGuardSettings). Never claims a
// feature is active when it isn't configured; omitted entirely otherwise.
async function buildFeatureChips(mode) {
  const chips = [];
  if (mode.timer.ritualId === 'standard') {
    chips.push({ icon: NS_HOME_ICONS.arrow, label: 'Guided ritual' });
  }
  try {
    const light = await api.getSmartLightConfig?.();
    if (light?.enabled && light.provider && light.provider !== 'none') {
      chips.push({ icon: NS_GLANCE_ICONS.lights, label: `Smart Lights (${light.provider})` });
    }
  } catch { /* real-data-or-nothing: no chip on failure */ }
  try {
    const wifi = await api.getWifiGuardSettings?.();
    if (wifi?.enabled && wifi.configured) {
      chips.push({ icon: NS_GLANCE_ICONS.wifi, label: 'WiFi Guard' });
    }
  } catch { /* real-data-or-nothing: no chip on failure */ }
  return chips;
}

async function renderFeatured(mode) {
  const empty = document.getElementById('nm-featured-empty');
  const content = document.getElementById('nm-featured-content');
  if (!empty || !content) return;
  if (!mode) {
    empty.style.display = '';
    content.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = '';

  const artworkEl = document.getElementById('nm-detail-artwork');
  artworkEl.innerHTML = modeIconSvg(mode);
  artworkEl.className = `nm-featured-icon ${mode.status === 'ready' ? modeAccentClass(mode) : ''}`;
  document.getElementById('nm-detail-title').textContent = mode.title;
  document.getElementById('nm-detail-subtitle').textContent = mode.subtitle;

  const timeline = document.getElementById('nm-detail-timeline');
  timeline.innerHTML = '';
  for (const step of buildTimeline(mode)) {
    const li = document.createElement('li');
    li.textContent = step;
    timeline.appendChild(li);
  }

  const meta = document.getElementById('nm-detail-meta');
  meta.innerHTML = `
    <div class="nm-meta-row"><span class="nm-meta-label">Duration</span><span>${formatDuration(mode.timer.durationSeconds)}</span></div>
    <div class="nm-meta-row"><span class="nm-meta-label">Action</span><span>${formatAction(mode.timer.action)}</span></div>
    <div class="nm-meta-row"><span class="nm-meta-label">Ritual</span><span>${mode.timer.ritualId === 'standard' ? 'Standard wind-down' : 'None (direct start)'}</span></div>
  `;

  const statusEl = document.getElementById('nm-detail-status');
  const statusIconOk = `<svg ${SVG_OPEN} width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>`;
  const statusIconWarn = `<svg ${SVG_OPEN} width="14" height="14"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  if (mode.status === 'ready') {
    statusEl.innerHTML = `${statusIconOk}<span>Ready on this PC</span>`;
    statusEl.className = 'nm-detail-status ready';
  } else {
    const reason = (mode.availability && mode.availability.reason) || mode.status.replace(/_/g, ' ');
    statusEl.innerHTML = `${statusIconWarn}<span>${escapeHtml(reason)}</span>`;
    statusEl.className = 'nm-detail-status unavailable';
  }

  const featuresEl = document.getElementById('nm-detail-features');
  if (featuresEl) {
    const chips = await buildFeatureChips(mode);
    featuresEl.innerHTML = chips.length
      ? chips.map(c => `<span class="nm-feature-chip">${c.icon}<span>${escapeHtml(c.label)}</span></span>`).join('')
      : '';
    featuresEl.style.display = chips.length ? '' : 'none';
  }

  const btn = document.getElementById('nm-btn-use-tonight');
  btn.disabled = mode.status !== 'ready';
  btn.innerHTML = mode.status === 'ready'
    ? '<img src="assets/brand/lights-out-icon-small.svg" alt="" draggable="false"><span>Use Tonight</span>'
    : '<span>Not Available</span>';
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

  document.querySelectorAll('.nm-tile').forEach(t => {
    const isSelected = t.dataset.modeId === id;
    t.classList.toggle('selected', isSelected);
    t.setAttribute('aria-pressed', String(isSelected));
  });

  renderFeatured(mode);
  const featured = document.getElementById('nm-featured');
  if (featured && typeof featured.scrollIntoView === 'function') {
    featured.scrollIntoView({ block: 'nearest' });
  }
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

  // Bridge Library -> Tonight through the same central navigation entry
  // point every other nav control uses (handleSidebarNavigation), not a
  // simulated click on the sidebar button.
  if (typeof handleSidebarNavigation === 'function') {
    handleSidebarNavigation('lib');
  } else {
    document.querySelector('[data-ns-tab="lib"]')?.click();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Home teaser: 3-4 "Ready" mode tiles shown on Home, above "Browse Library".
// Selecting one here selects it in the Library too (so landing on Library
// right after shows that mode already featured) and navigates there --
// Home orients, Library is where you actually browse and commit.
// ─────────────────────────────────────────────────────────────────────────────

function renderHomeNightModesTeaser() {
  const row = document.getElementById('ns-home-modes-row');
  if (!row) return;
  row.innerHTML = '';
  const ready = nmCatalogue.filter(mode => mode.status === 'ready').slice(0, 4);
  ready.forEach(mode => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'ns-home-mode-tile';
    tile.dataset.modeId = mode.id;
    tile.innerHTML = `
      <span class="ns-home-mode-badge ${modeAccentClass(mode)}" aria-hidden="true">${modeIconSvg(mode)}</span>
      <span class="ns-home-mode-title">${escapeHtml(mode.title)}</span>
      <span class="ns-home-mode-meta">${formatDuration(mode.timer.durationSeconds)} &middot; ${formatAction(mode.timer.action)}</span>
    `;
    tile.addEventListener('click', () => {
      selectMode(mode.id);
      if (typeof handleSidebarNavigation === 'function') handleSidebarNavigation('modes');
    });
    row.appendChild(tile);
  });
}

if (typeof window !== 'undefined') {
  window.renderHomeNightModesTeaser = renderHomeNightModesTeaser;
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

async function initNightModes() {
  try {
    const raw = await api.getNightModesCatalogue();
    nmCatalogue = (Array.isArray(raw) ? raw : []).map(mode => {
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
  } catch (err) {
    console.error('[NightModes] Failed to load catalogue:', err);
    nmCatalogue = [];
  }

  // Auto-feature a default mode so the Featured area never opens on the
  // big empty "Select a Night Mode" placeholder (per review: a browsing
  // library shouldn't lead with blank space). Prefers whatever is already
  // armed for Tonight -- never override a real choice with an arbitrary
  // default -- falling back to the first ready mode in catalogue order.
  // This only sets what's *displayed* as featured; it does not arm
  // anything or touch Tonight's configured duration/action (that still
  // only happens via Use Tonight), so opening Library can never silently
  // change what Home's hero CTA thinks is chosen.
  if (!nmSelectedId) {
    const armedId = (typeof state !== 'undefined' && state.armedNightMode) ? state.armedNightMode.nightModeId : null;
    const armedMode = armedId ? nmCatalogue.find(m => m.id === armedId && m.status === 'ready') : null;
    const defaultMode = armedMode || nmCatalogue.find(m => m.status === 'ready') || null;
    if (defaultMode) {
      nmSelectedId = defaultMode.id;
    }
  }

  renderCards();
  renderHomeNightModesTeaser();
  renderFeatured(nmCatalogue.find(m => m.id === nmSelectedId) || null);

  // Wire up Use Tonight button
  const useBtn = document.getElementById('nm-btn-use-tonight');
  if (useBtn) useBtn.addEventListener('click', useTonight);
}

// Export for renderer.js to call during app init.
if (typeof window !== 'undefined') {
  window.initNightModes = initNightModes;
}
