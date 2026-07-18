// Renderer: Night Modes library interaction.
// Renders the card grid, handles selection, detail view, and Use Tonight handoff.

/* global api, escapeHtml */

'use strict';

const ARTWORK_MAP = {
  'quick-sleep': '\u{1F319}',
  'lights-down': '\u{1F506}',
  'movie-wind-down': '\u{1F3AC}',
  'full-shutdown': '\u{26A1}',
  'quiet-house': '\u{1F3E0}',
  'school-night': '\u{1F4DA}'
};

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

function renderCards() {
  const grid = document.getElementById('nm-cards-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const mode of nmCatalogue) {
    const card = document.createElement('div');
    card.className = 'nm-card';
    if (mode.status !== 'ready') card.classList.add('disabled');
    if (mode.id === nmSelectedId) card.classList.add('selected');
    card.dataset.modeId = mode.id;

    const artwork = ARTWORK_MAP[mode.artworkId] || '\u{1F319}';
    const statusTag = mode.status !== 'ready' ? getStatusTagHtml(mode.status) : '';

    card.innerHTML = `
      <div class="nm-card-artwork">${artwork}</div>
      <div class="nm-card-title">${escapeHtml(mode.title)}</div>
      <div class="nm-card-subtitle">${escapeHtml(mode.subtitle)}</div>
      <div class="nm-card-tags">
        <span class="nm-card-tag">${formatDuration(mode.timer.durationSeconds)}</span>
        <span class="nm-card-tag">${formatAction(mode.timer.action)}</span>
        ${statusTag}
      </div>
    `;

    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${mode.title}${mode.status !== 'ready' ? ' (unavailable)' : ''}`);
    if (mode.id === nmSelectedId) card.setAttribute('aria-pressed', 'true');
    card.addEventListener('click', () => selectMode(mode.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode(mode.id); }
    });
    grid.appendChild(card);
  }
}

function getStatusTagHtml(status) {
  if (status === 'coming_soon') {
    return '<span class="nm-card-tag status-coming-soon">COMING SOON</span>';
  }
  if (status === 'needs_router_setup' || status === 'needs_device_setup') {
    return '<span class="nm-card-tag status-needs-setup">NEEDS SETUP</span>';
  }
  return '';
}

function renderDetail(mode) {
  const panel = document.getElementById('nm-detail-panel');
  if (!panel || !mode) { if (panel) panel.style.display = 'none'; return; }

  panel.style.display = '';

  const artwork = ARTWORK_MAP[mode.artworkId] || '\u{1F319}';
  document.getElementById('nm-detail-artwork').textContent = artwork;
  document.getElementById('nm-detail-title').textContent = mode.title;
  document.getElementById('nm-detail-subtitle').textContent = mode.subtitle;

  // Timeline
  const timeline = document.getElementById('nm-detail-timeline');
  timeline.innerHTML = '';
  const steps = buildTimeline(mode);
  for (const step of steps) {
    const li = document.createElement('li');
    li.textContent = step;
    timeline.appendChild(li);
  }

  // Meta
  const meta = document.getElementById('nm-detail-meta');
  meta.innerHTML = `
    <div class="nm-meta-row"><span class="nm-meta-label">Duration</span><span>${formatDuration(mode.timer.durationSeconds)}</span></div>
    <div class="nm-meta-row"><span class="nm-meta-label">Action</span><span>${formatAction(mode.timer.action)}</span></div>
    <div class="nm-meta-row"><span class="nm-meta-label">Ritual</span><span>${mode.timer.ritualId === 'standard' ? 'Standard wind-down' : 'None (direct start)'}</span></div>
  `;

  // Status
  const statusEl = document.getElementById('nm-detail-status');
  if (mode.status === 'ready') {
    statusEl.textContent = '\u2705 Ready on this PC';
    statusEl.className = 'nm-detail-status ready';
  } else {
    const reason = (mode.availability && mode.availability.reason) || mode.status.replace(/_/g, ' ');
    statusEl.textContent = '\u26A0\uFE0F ' + reason;
    statusEl.className = 'nm-detail-status unavailable';
  }

  // Use Tonight button
  const btn = document.getElementById('nm-btn-use-tonight');
  btn.disabled = mode.status !== 'ready';
  btn.textContent = mode.status === 'ready' ? 'Use Tonight' : 'Not Available';
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

  renderDetail(mode);
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

  // Navigate to Tonight panel
  const tonightBtn = document.querySelector('[data-ns-tab="lib"]');
  if (tonightBtn) tonightBtn.click();
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

  renderCards();

  // Wire up detail back button
  const backBtn = document.getElementById('nm-detail-back');
  if (backBtn) backBtn.addEventListener('click', () => {
    nmSelectedId = null;
    document.querySelectorAll('.nm-card').forEach(c => c.classList.remove('selected'));
    const panel = document.getElementById('nm-detail-panel');
    if (panel) panel.style.display = 'none';
  });

  // Wire up Use Tonight button
  const useBtn = document.getElementById('nm-btn-use-tonight');
  if (useBtn) useBtn.addEventListener('click', useTonight);
}

// Export for renderer.js to call during app init.
if (typeof window !== 'undefined') {
  window.initNightModes = initNightModes;
}
