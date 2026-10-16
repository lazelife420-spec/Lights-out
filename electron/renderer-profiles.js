// Renderer: Saved Profiles feature (create, load, reorder, rename, delete,
// import/export). Loaded as a classic sibling <script>, after renderer-utils.js
// and before renderer.js — uses `state`/`els`/`api`/`notify`/`escapeHtml`/
// `actionLabel`/`inputSeconds`/`setInputFromSeconds`/`setAction`/`startTimer`
// from the core script, and is called from wireEvents()/render() there.

const PROFILE_ACCENT_VALUES = new Set([
  '#5b8cff', '#a855f7', '#22d3ee', '#34d399', '#f59e0b', '#fb7185'
]);

function applyProfileAccentStyles(container) {
  if (!container) return;
  const profilesById = new Map(state.profiles.map(profile => [profile.id, profile]));
  container.querySelectorAll('.profile-card[data-profile-id], .profile-item[data-profile-id]').forEach(element => {
    const accent = profilesById.get(element.dataset.profileId)?.accent;
    if (PROFILE_ACCENT_VALUES.has(accent)) {
      element.style.setProperty('--profile-accent', accent);
      element.classList.add('has-profile-accent');
    } else {
      element.style.removeProperty('--profile-accent');
      element.classList.remove('has-profile-accent');
    }
  });
}

async function loadProfiles() {
  try {
    const profiles = await api.getAllProfiles();
    state.profiles = profiles || [];
    if (state.currentProfileId && !state.profiles.some(profile => profile.id === state.currentProfileId)) {
      state.currentProfileId = null;
      await persistSelectedProfile(null);
    }
    renderProfiles();
    return profiles;
  } catch (error) {
    console.error('Failed to load profiles:', error);
    return [];
  }
}

function getSortedAndFilteredProfiles() {
  let list = [...state.profiles];
  const query = (state.profileSearchQuery || '').toLowerCase().trim();
  const filter = state.profileActiveFilter || 'all';

  if (query) {
    list = list.filter(p => p.name.toLowerCase().includes(query));
  }

  if (filter === 'duration') {
    list = list.filter(p => p.mode === 'duration');
  } else if (filter === 'clock') {
    list = list.filter(p => p.mode === 'clock');
  } else if (filter === 'pinned') {
    list = list.filter(p => p.pinned);
  }

  // Sort pinned first, then normal relative order
  return list.sort((a, b) => {
    const aPin = a.pinned ? 1 : 0;
    const bPin = b.pinned ? 1 : 0;
    return bPin - aPin;
  });
}

// My Modes cards (UI-R3 P12, Fire 02). Each card says what loading it would
// really do now: LOADED when it is the current plan; TEST when the mode was
// saved in Test Mode or Test Mode is on (loading a mode never turns Test Mode
// off: applyProfile only ever turns it on); otherwise REAL. FORCE only beside
// REAL, for a forced shutdown/restart. At most three chips; the chip labels
// are uppercased by CSS only and names are never uppercased.
function getProfileChips(profile, isActive) {
  const chips = [];
  if (isActive) chips.push({ cls: 'loaded', text: 'Loaded' });
  const testNow = state.settingsLoaded === true && state.dryRun === true;
  if (profile.dryRun || testNow) {
    chips.push({ cls: 'test', text: 'Test' });
  } else {
    chips.push({ cls: 'real', text: 'Real', title: profileRealChipTitle() });
    if (profile.forceShutdown && (profile.action === 'shutdown' || profile.action === 'restart')) {
      chips.push({ cls: 'force', text: 'Force', title: 'Forced: open apps are closed without asking.' });
    }
  }
  return chips.slice(0, 3);
}

// A REAL chip only ever shows while Test Mode is off, so its title is one
// constant (smoke extracts it).
function profileRealChipTitle() {
  return 'Runs for real.';
}

// The chips follow the live Test Mode setting, which can change without a My
// Modes re-render: render() calls this (typeof-guarded) and the cards are
// re-rendered only when that truth changes (renderProfiles never calls render()).
let lastChipTruth = null;
function syncProfileChipTitles() {
  const truth = state.settingsLoaded === true && state.dryRun === true;
  if (truth === lastChipTruth) return;
  lastChipTruth = truth;
  renderProfiles();
}

// The order My Modes shows its cards in: pinned first, otherwise as saved.
// A stable copy: state.profiles is never reordered. Ctrl+1..9 loads the card
// at that position, so the shortcut and the card always agree.
function getMyModesOrder() {
  return (Array.isArray(state.profiles) ? state.profiles : [])
    .map((profile, index) => ({ profile, index }))
    .sort((a, b) => ((b.profile.pinned ? 1 : 0) - (a.profile.pinned ? 1 : 0)) || (a.index - b.index))
    .map(entry => entry.profile);
}

// Ctrl+1..9 loads a mode only while it cannot surprise anyone: idle, not in
// the browser preview, not from a text field, not behind the My Modes manager,
// onboarding or any dialog. It only ever loads; it never starts a timer.
function myModesShortcutLive(target) {
  if (typeof previewMode !== 'undefined' && previewMode) return false;
  if (state.running || state.paused) return false;
  if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '') || target.isContentEditable)) return false;
  if (els.profilesModal?.classList?.contains('active')) return false;
  if (typeof timerShortcutSurfaceBlocked === 'function' && timerShortcutSurfaceBlocked()) return false;
  return true;
}

function onMyModesShortcut(event) {
  if (!event.ctrlKey || event.metaKey || event.altKey || !/^[1-9]$/.test(event.key)) return;
  if (!myModesShortcutLive(event.target)) return;
  const profile = getMyModesOrder()[Number(event.key) - 1];
  if (!profile) return;
  event.preventDefault();
  applyProfile(profile.id);
}

// Context menu Edit…: the manager opens with search and filter cleared
// (openProfilesModal), then the mode's row is brought into view and its name
// field focused.
function editProfileFromMenu(profileId) {
  openProfilesModal();
  // After the dialog layer has focused the dialog title (as openProfileCreate).
  setTimeout(() => {
    const list = els.profilesList;
    const row = list && [...list.querySelectorAll('.profile-item[data-profile-id]')].find(item => item.dataset.profileId === profileId);
    if (!row) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    row.querySelector('.profile-item-name-input')?.focus({ preventScroll: true });
  }, 50);
}

function profileGlyph(name) {
  return typeof loGlyph === 'function' ? loGlyph(name, 'chip-glyph profile-flag') : '';
}

// The manager's reorder buttons: the LO_GLYPHS chevron, turned up / down by
// CSS (data-action), never the old dingbat triangles.
function profileMoveGlyph() {
  return typeof loGlyph === 'function' ? loGlyph('chevron', 'chip-glyph profile-move-glyph') : '';
}

// Empty My Modes: one create card. It only opens the manager and focuses the
// name field; it never loads or starts anything.
function openProfileCreate() {
  openProfilesModal();
  setTimeout(() => document.getElementById('new-profile-name')?.focus(), 50);
}

// The My Modes tier count: '${n} saved', from state.profiles only, in the
// neutral tier-count tone. Hidden at zero (the create card speaks then).
function renderMyModesCount() {
  const count = document.getElementById('my-modes-count');
  if (!count) return;
  const n = Array.isArray(state.profiles) ? state.profiles.length : 0;
  const text = n > 0 ? `${n} saved` : '';
  if (count.textContent !== text) count.textContent = text;
  if (count.hidden !== (n === 0)) count.hidden = n === 0;
}

// UI-R3 Fire 08: a My Mode card's neutral action badge (static, aria-hidden).
function profileActionGlyphName(action) {
  if (['shutdown', 'restart', 'logout', 'hibernate'].includes(action)) return 'power';
  return action === 'sleep' ? 'moon' : 'lamp';
}

// The card's right-hand instrument: the shared Night Modes duration
// vocabulary (formatDuration), or the clock time for a clock-mode mode.
function profileDurationText(profile) {
  if (!profile) return '';
  if (profile.mode === 'clock') return `at ${profile.clock}`;
  const seconds = Number(profile.seconds) || 0;
  return typeof formatDuration === 'function' ? formatDuration(seconds) : `${Math.max(1, Math.ceil(seconds / 60))} min`;
}

// The card's hint keeps the action word; the duration sits on the right.
function getProfileCardHint(profile) {
  if (!profile) return '';
  const action = String(profile.action || '');
  return typeof formatAction === 'function' ? formatAction(action) : action.charAt(0).toUpperCase() + action.slice(1);
}

// One accessible name for the card: what it is, what it does and its truth
// chips (an aria-label on role=button hides the inner chip text).
function profileCardLabel(profile, chips) {
  const chipText = chips.map(chip => chip.text).join(', ');
  return `${profile.name}: ${getProfileHint(profile)}${chipText ? `, ${chipText}` : ''}`;
}

// Card click and Enter / Space load the mode and, when idle, land on Tonight.
// Ctrl+N, 'Load and start' and the manager's Load never pass navigate.
function onProfileCardActivate(profileId) {
  return applyProfile(profileId, { navigate: true });
}

function bindProfileCard(card, profile, chips, isActive) {
  card.setAttribute('aria-pressed', String(Boolean(isActive)));
  card.setAttribute('aria-label', profileCardLabel(profile, chips));
  card.addEventListener('click', () => onProfileCardActivate(profile.id));
  card.addEventListener('keydown', (e) => {
    if (e.target !== card || e.repeat) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onProfileCardActivate(profile.id);
    }
  });
}

function renderProfiles() {
  if (!els.profilesGrid) return;
  renderMyModesCount();

  if (state.profiles.length === 0) {
    els.profilesGrid.innerHTML = `
      <button type="button" class="profile-card profile-card--create" id="profiles-empty-create">
        <span class="profile-mono profile-mono--create" aria-hidden="true"><svg class="chip-glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M9 3.6v10.8M3.6 9h10.8"/></svg></span>
        <span class="profile-main">
          <span class="profile-name">Make tonight's plan a mode</span>
          <span class="profile-hint">Saves tonight's action and duration</span>
        </span>
      </button>
    `;
    els.profilesGrid.querySelector('#profiles-empty-create')?.addEventListener('click', openProfileCreate);
    return;
  }

  const sorted = getMyModesOrder();
  const lastUsedId = getLastUsedProfileId();
  // The Ctrl+N hint shows only while the shortcut can work (idle, not in the
  // browser preview); the section itself is hidden during a run.
  const shortcutLive = !(typeof previewMode !== 'undefined' && previewMode) && !state.running && !state.paused;
  const cardChips = new Map();
  els.profilesGrid.innerHTML = sorted.map((profile, index) => {
    const isActive = state.currentProfileId === profile.id;
    // Last-used is a separate, persistent signal from "active" (which only
    // reflects this session) -- skip it on the active card to avoid two
    // badges saying almost the same thing at once.
    const isLastUsed = !isActive && profile.id === lastUsedId;
    const hint = getProfileCardHint(profile);
    // Notes ride along in the card's tooltip -- a quick hover reminder
    // without taking up any of the card's compact layout. No notes, no title.
    const cardTitle = profile.notes ? `${profile.notes}` : '';
    const key = shortcutLive && index < 9 ? index + 1 : 0;
    const mono = profile.avatar || Array.from(String(profile.name || '').trim())[0] || '';
    const chipList = getProfileChips(profile, isActive);
    cardChips.set(profile.id, chipList);
    const chips = chipList.map(chip =>
      `<span class="profile-chip ${chip.cls}"${chip.title ? ` title="${escapeHtml(chip.title)}"` : ''}>${chip.text}</span>`).join('');
    const badge = typeof loGlyph === 'function' ? loGlyph(profileActionGlyphName(profile.action), 'chip-glyph profile-badge-glyph') : '';
    return `
      <div class="profile-card ${isActive ? 'active' : ''} ${profile.pinned ? 'pinned' : ''}" data-profile-id="${profile.id}" role="button" tabindex="0"${cardTitle ? ` title="${profileAttr(cardTitle)}"` : ''}${key ? ` aria-keyshortcuts="Control+${key}"` : ''}>
        <span class="profile-mono" aria-hidden="true">${escapeHtml(mono)}<span class="profile-badge">${badge}</span></span>
        <div class="profile-main">
          <div class="profile-name">
            <span class="profile-name-text">${escapeHtml(profile.name)}</span>
            ${profile.pinned ? `<span class="profile-flag-wrap">${profileGlyph('pin')}<span class="sr-only">Pinned</span></span>` : ''}
            ${profile.notes ? `<span class="profile-flag-wrap">${profileGlyph('note')}<span class="sr-only">Has notes</span></span>` : ''}
          </div>
          <div class="profile-hint">${escapeHtml(hint)}${profile.kind === 'family' ? ' · Family' : ''}${isLastUsed ? ' <span class="last-used-badge">· last used</span>' : ''}</div>
          <div class="profile-chips">${chips}</div>
        </div>
        <span class="profile-side">
          <span class="profile-dur">${escapeHtml(profileDurationText(profile))}</span>
          ${key ? `<kbd class="profile-kbd" aria-hidden="true">Ctrl+${key}</kbd>` : ''}
        </span>
      </div>
    `;
  }).join('');

  applyProfileAccentStyles(els.profilesGrid);

  // Keyboard-reachable instruments (UI-R3 Fire 08): aria-pressed and the
  // accessible name are set as attributes (never through the markup string),
  // plus click and Enter / Space on the card itself.
  const byId = new Map(sorted.map(profile => [profile.id, profile]));
  els.profilesGrid.querySelectorAll('.profile-card[data-profile-id]').forEach(card => {
    const profile = byId.get(card.dataset.profileId);
    if (!profile) return;
    bindProfileCard(card, profile, cardChips.get(profile.id) || [], state.currentProfileId === profile.id);
  });
}

// The single most-recently-applied profile, across restarts (lastUsedAt is
// persisted). Distinct from state.currentProfileId, which only reflects
// what's loaded in *this* session and is null after a fresh app launch.
function getLastUsedProfileId() {
  let latest = null;
  for (const p of state.profiles) {
    if (p.lastUsedAt && (!latest || p.lastUsedAt > latest.lastUsedAt)) latest = p;
  }
  return latest ? latest.id : null;
}

async function restoreSelectedProfile(profileId) {
  const selected = profileId && state.profiles.some(profile => profile.id === profileId)
    ? profileId
    : null;
  state.currentProfileId = selected;
  if (profileId && !selected) await persistSelectedProfile(null);
  renderProfiles();
}

async function persistSelectedProfile(profileId) {
  await api.saveAppSettings({ app: { lastSelectedProfileId: profileId || null } });
}

function getProfileHint(profile) {
  if (!profile) return '';
  const action = typeof formatAction === 'function'
    ? formatAction(profile.action)
    : profile.action.charAt(0).toUpperCase() + profile.action.slice(1);

  if (profile.mode === 'clock') {
    return `${action} at ${profile.clock}`;
  }

  // One duration vocabulary with Night Modes (renderer-night-modes.js
  // formatDuration): 'Sleep · 2h', 'Shutdown · 45 min'.
  const seconds = Number(profile.seconds) || 0;
  const duration = typeof formatDuration === 'function' ? formatDuration(seconds) : `${Math.ceil(seconds / 60)} min`;
  return `${action} · ${duration}`;
}

// Legacy autoStart metadata remains import-compatible, but selection itself
// is inert. Only an explicit Start Profile command may run the timer.
function shouldStartOnProfileSelection(options = {}) {
  return options.start === true;
}

// Loading a My Mode can only ever turn Test Mode ON (UI-R3 Fire 02): a mode
// saved in Test Mode turns it on; a REAL (or legacy, field-less) mode loaded
// while Test Mode is on stays a test, and the toast says so. The app-wide
// setting is never persisted from here. true on success, false otherwise.
async function applyProfile(profileId, opts = {}) {
  // Until the saved Test Mode setting is known, nothing is loaded.
  if (state.settingsLoaded !== true) {
    notify('Loading your settings…', 'info');
    return false;
  }
  try {
    const result = await api.applyProfile(profileId);
    if (!result || !result.success) {
      notify((result && result.error) || 'Could not load that mode', 'error');
      return false;
    }

    state.currentProfileId = profileId;
    await persistSelectedProfile(profileId);

    // Pick up the fresh lastUsedAt stamp so the "last used" badge updates
    // immediately, without a full loadProfiles() round trip.
    if (result.profile) {
      const idx = state.profiles.findIndex(p => p.id === profileId);
      if (idx >= 0) state.profiles[idx] = result.profile;
    }

    // Dismiss clock mode so the user sees the loaded timer value, not the clock face.
    if (state.clockMode) {
      state.clockMode = false;
      state._clockDismissedByProfile = true;
    }

    // Apply timer options from profile
    const testModeOn = state.dryRun === true;
    let heldBackReal = false;
    if (result.timerOptions) {
      state.action = result.timerOptions.action || state.action;
      heldBackReal = testModeOn && result.timerOptions.dryRun !== true;
      state.dryRun = testModeOn ? true : Boolean(result.timerOptions.dryRun);
      state.forceShutdown = result.timerOptions.forceShutdown || false;
      state.muteSystem = result.timerOptions.muteSystem || false;
      state.graceMinutes = result.timerOptions.gracePeriod || 2;

      // Apply Last Light from profile
      if (result.timerOptions.lastLightEnabled !== undefined) {
        state.lastLight.enabled = result.timerOptions.lastLightEnabled;
        if (result.timerOptions.lastLightSequence) state.lastLight.sequence = result.timerOptions.lastLightSequence;
        if (result.timerOptions.lastLightSound) state.lastLight.sound = result.timerOptions.lastLightSound;
      }

      setInputFromSeconds(result.timerOptions.durationSeconds || 1800);
      setAction(state.action);
    }

    renderProfiles();
    // The footer, body.test-mode / real-action and the Settings Test Mode box
    // follow at once.
    render();
    const name = (result.profile && result.profile.name) || 'Mode';
    notify(heldBackReal ? `${name} loaded in Test Mode. It runs for real only when Test Mode is off.` : `${name} loaded`, 'success');

    // Selection is always inert. Only an explicit "start" action may run it.
    if (shouldStartOnProfileSelection(opts) && !state.running && !state.paused) {
      state._clockDismissedByProfile = false; // timer starting, no restore needed
      startTimer(result.timerOptions?.durationSeconds, 'profile-start');
    }
    // UI-R3 Fire 08: a card click / Enter lands on Tonight with the loaded
    // plan, only after a successful load and only while idle. An armed
    // preset is cleared first, so Tonight never titles the plan with it.
    if (opts.navigate === true && !state.running && !state.paused) {
      if (state.armedNightMode && typeof clearArmedNightMode === 'function') clearArmedNightMode();
      if (typeof handleSidebarNavigation === 'function') handleSidebarNavigation('lib');
    }
    return true;
  } catch (error) {
    notify(`Could not load that mode: ${error.message || error}`, 'error');
    return false;
  }
}

// One reset for the manager's search and filter: opening the manager and the
// empty list's Clear search both use it.
function resetProfileFilters() {
  state.profileSearchQuery = '';
  state.profileActiveFilter = 'all';
  const searchInput = document.getElementById('profile-search');
  if (searchInput) searchInput.value = '';
  const filterContainer = document.getElementById('profile-filters');
  if (filterContainer) {
    // Class + aria-pressed only: the chip look lives in CSS (UI-R3 Fire 01).
    filterContainer.querySelectorAll('.filter-btn').forEach(b => {
      const on = b.dataset.filter === 'all';
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
}

function openProfilesModal() {
  if (!els.profilesModal) return;

  // Reset search and filter query
  resetProfileFilters();
  clearProfileSaveConfirm();

  els.profilesModal.classList.add('active');
  updateProfileSavePreview();
  renderProfilesList();
}

// Show what the current timer will save as, so the save form is never a blind guess.
function updateProfileSavePreview() {
  if (!els.profileSavePreview) return;
  const action = actionLabel();
  const secs = inputSeconds();
  let when;
  if (secs >= 3600 && secs % 3600 === 0) {
    when = `${secs / 3600}h`;
  } else if (secs >= 60) {
    when = `${Math.round(secs / 60)}m`;
  } else {
    when = `${secs}s`;
  }
  els.profileSavePreview.textContent = `Will save: ${action} in ${when}`;
}

function closeProfilesModal() {
  if (!els.profilesModal) return;
  els.profilesModal.classList.remove('active');
}

// -- Manager two-steps (UI-R3 Fire 08) -----------------------------------------
// Deleting or replacing a mode takes two presses through the shared
// twoStepNext machine (renderer-utils.js); never a native browser dialog. The
// first press arms ('Delete?' / an inline note), a second press on the same
// control within PROFILE_TWO_STEP_MS confirms. Escape, blur, the timeout and
// any re-render of the list disarm.
const PROFILE_TWO_STEP_MS = 4000;
let profileDeletePending = null;
let profileDeleteTimer = null;
let profileSavePending = null;
let profileSaveTimer = null;

// Text for an attribute value: escapeHtml leaves quotes alone.
function profileAttr(value) {
  return escapeHtml(String(value)).replace(/"/g, '&quot;');
}

function profileNameFor(profileId) {
  const profile = (Array.isArray(state.profiles) ? state.profiles : []).find(p => p.id === profileId);
  return profile ? profile.name : 'this mode';
}

function setProfileDeleteArmed(btn, armed) {
  if (!btn) return;
  const name = profileNameFor(btn.closest?.('.profile-item')?.dataset.profileId);
  btn.classList.toggle('is-confirming', armed);
  btn.textContent = armed ? 'Delete?' : 'Delete';
  btn.setAttribute('aria-label', armed ? `Confirm delete ${name}` : `Delete ${name}`);
}

function disarmProfileDelete() {
  profileDeletePending = null;
  if (profileDeleteTimer) { clearTimeout(profileDeleteTimer); profileDeleteTimer = null; }
  els.profilesList?.querySelectorAll('.delete-btn.is-confirming').forEach(b => setProfileDeleteArmed(b, false));
}

// One press on a row's Delete: the first arms it, a second on the same row
// within the window deletes. Never a one-click delete.
async function requestProfileDelete(btn, profileId) {
  const step = twoStepNext(profileDeletePending, `delete:${profileId}`, Date.now(), PROFILE_TWO_STEP_MS);
  disarmProfileDelete();
  if (step.decision === 'confirm') {
    await deleteProfile(profileId);
    return true;
  }
  profileDeletePending = step.pending;
  setProfileDeleteArmed(btn, true);
  profileDeleteTimer = setTimeout(disarmProfileDelete, PROFILE_TWO_STEP_MS);
  return false;
}

function clearProfileSaveConfirm() {
  profileSavePending = null;
  if (profileSaveTimer) { clearTimeout(profileSaveTimer); profileSaveTimer = null; }
  const note = document.getElementById('profile-save-note');
  if (note) { note.textContent = ''; note.hidden = true; }
  els.btnSaveProfile?.classList?.remove('is-confirming');
}

// Context menu 'Delete…': opens the manager at that mode's row with its
// Delete already armed. Focus stays where the dialog layer puts it (never on
// a destructive control); a press on 'Delete?' then deletes.
function deleteProfileFromMenu(profileId) {
  openProfilesModal();
  setTimeout(() => {
    const list = els.profilesList;
    const row = list && [...list.querySelectorAll('.profile-item[data-profile-id]')].find(item => item.dataset.profileId === profileId);
    if (!row) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    void requestProfileDelete(row.querySelector('.delete-btn'), profileId);
  }, 50);
}

function renderProfilesList() {
  if (!els.profilesList) return;
  // A re-render rebuilds the buttons: no armed delete may outlive its button.
  disarmProfileDelete();

  const filtered = getSortedAndFilteredProfiles();

  if (filtered.length === 0) {
    if (state.profiles.length === 0) {
      els.profilesList.innerHTML = '<div class="empty-profiles">Nothing saved yet. Name tonight\'s plan above to save it.</div>';
      return;
    }
    els.profilesList.innerHTML = '<div class="empty-profiles">No modes match. <button type="button" class="btn-quiet btn-compact" id="profiles-clear-search">Clear search</button></div>';
    els.profilesList.querySelector('#profiles-clear-search')?.addEventListener('click', () => {
      resetProfileFilters();
      renderProfilesList();
    });
    return;
  }

  els.profilesList.innerHTML = filtered.map((profile, idx) => {
    const hint = getProfileHint(profile);
    const lastUsedHint = profile.lastUsedAt ? ` · Last used ${formatTimeAgo(new Date(profile.lastUsedAt))}` : '';
    return `
      <div class="profile-item" data-profile-id="${profile.id}">
        <div class="profile-item-info">
          <input type="text" class="profile-item-name-input" value="${profileAttr(profile.name)}" data-profile-id="${profile.id}" maxlength="32" spellcheck="false" aria-label="Name of ${profileAttr(profile.name)}">
          <div class="profile-item-hint">${escapeHtml(hint)}${escapeHtml(lastUsedHint)}</div>
          <div class="profile-identity-fields">
            <select class="profile-item-kind-input" data-profile-id="${profile.id}" aria-label="Kind">
              <option value="timer" ${profile.kind !== 'family' ? 'selected' : ''}>Routine</option>
              <option value="family" ${profile.kind === 'family' ? 'selected' : ''}>Family member</option>
            </select>
            <input type="text" class="profile-item-avatar-input" value="${profileAttr(profile.avatar || '')}" data-profile-id="${profile.id}" maxlength="4" spellcheck="false" aria-label="Profile avatar" placeholder="Avatar">
            <select class="profile-item-accent-input" data-profile-id="${profile.id}" aria-label="Profile accent">
              <option value="" ${!profile.accent ? 'selected' : ''}>App default</option>
              <option value="#5b8cff" ${profile.accent === '#5b8cff' ? 'selected' : ''}>Blue</option>
              <option value="#a855f7" ${profile.accent === '#a855f7' ? 'selected' : ''}>Purple</option>
              <option value="#22d3ee" ${profile.accent === '#22d3ee' ? 'selected' : ''}>Cyan</option>
              <option value="#34d399" ${profile.accent === '#34d399' ? 'selected' : ''}>Green</option>
              <option value="#f59e0b" ${profile.accent === '#f59e0b' ? 'selected' : ''}>Amber</option>
              <option value="#fb7185" ${profile.accent === '#fb7185' ? 'selected' : ''}>Rose</option>
            </select>
          </div>
          <input type="text" class="profile-item-notes-input" value="${profileAttr(profile.notes || '')}" data-profile-id="${profile.id}" maxlength="280" spellcheck="false" placeholder="Add a note...">
        </div>
        <div class="profile-item-actions">
          <button type="button" class="profile-item-btn pin-btn btn-quiet${profile.pinned ? ' is-pinned' : ''}" data-action="pin" title="${profile.pinned ? 'Unpin' : 'Pin'}" aria-pressed="${profile.pinned ? 'true' : 'false'}">
            ${profileGlyph('pin')}<span class="sr-only">${profile.pinned ? 'Unpin' : 'Pin'}</span>
          </button>
          <button type="button" class="profile-item-btn move-btn btn-quiet" data-action="up" data-idx="${idx}" title="Move up" aria-label="Move ${profileAttr(profile.name)} up" ${idx === 0 ? 'disabled' : ''}>${profileMoveGlyph()}</button>
          <button type="button" class="profile-item-btn move-btn btn-quiet" data-action="down" data-idx="${idx}" title="Move down" aria-label="Move ${profileAttr(profile.name)} down" ${idx === filtered.length - 1 ? 'disabled' : ''}>${profileMoveGlyph()}</button>
          <button type="button" class="profile-item-btn load-btn btn-quiet" data-action="load">Load</button>
          <button type="button" class="profile-item-btn delete-btn btn-quiet" data-action="delete" aria-label="Delete ${profileAttr(profile.name)}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  applyProfileAccentStyles(els.profilesList);

  // Rename handler (save on blur/enter).
  els.profilesList.querySelectorAll('.profile-item-name-input').forEach(input => {
    input.addEventListener('change', async () => {
      const newName = input.value.trim();
      const profileId = input.dataset.profileId;
      if (!newName || !profileId) return;
      await api.updateProfile(profileId, { name: newName });
      await loadProfiles();
      renderProfiles();
      renderProfilesList();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  });

  els.profilesList.querySelectorAll('.profile-item-kind-input').forEach(input => {
    input.addEventListener('change', async () => {
      await api.updateProfile(input.dataset.profileId, { kind: input.value });
      await loadProfiles();
      renderProfilesList();
    });
  });

  els.profilesList.querySelectorAll('.profile-item-avatar-input').forEach(input => {
    input.addEventListener('change', async () => {
      await api.updateProfile(input.dataset.profileId, { avatar: input.value.trim() });
      await loadProfiles();
      renderProfilesList();
    });
  });

  els.profilesList.querySelectorAll('.profile-item-accent-input').forEach(input => {
    input.addEventListener('change', async () => {
      await api.updateProfile(input.dataset.profileId, { accent: input.value || null });
      await loadProfiles();
      renderProfilesList();
    });
  });

  // Notes handler (save on blur/enter, same pattern as rename).
  els.profilesList.querySelectorAll('.profile-item-notes-input').forEach(input => {
    input.addEventListener('change', async () => {
      const profileId = input.dataset.profileId;
      if (!profileId) return;
      await api.updateProfile(profileId, { notes: input.value.trim() });
      await loadProfiles();
      renderProfiles();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  });

  // An armed Delete disarms on blur and on Escape (Escape then stops here,
  // so it only disarms and does not also close the manager).
  els.profilesList.querySelectorAll('.profile-item-btn.delete-btn').forEach(btn => {
    btn.addEventListener('blur', () => { if (btn.classList.contains('is-confirming')) disarmProfileDelete(); });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !btn.classList.contains('is-confirming')) return;
      e.preventDefault();
      e.stopPropagation();
      disarmProfileDelete();
    });
  });

  // Add event handlers
  els.profilesList.querySelectorAll('.profile-item-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const profileId = btn.closest('.profile-item').dataset.profileId;
      const action = btn.dataset.action;

      if (action === 'load') {
        await applyProfile(profileId);
        closeProfilesModal();
      } else if (action === 'delete') {
        await requestProfileDelete(btn, profileId);
      } else if (action === 'pin') {
        const profile = state.profiles.find(p => p.id === profileId);
        if (profile) {
          await api.updateProfile(profileId, { pinned: !profile.pinned });
          await loadProfiles();
          renderProfiles();
          renderProfilesList();
        }
      } else if (action === 'up' || action === 'down') {
        const idx = parseInt(btn.dataset.idx);
        const newIdx = action === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= filtered.length) return;
        const p1 = filtered[idx];
        const p2 = filtered[newIdx];
        const gIdx1 = state.profiles.findIndex(p => p.id === p1.id);
        const gIdx2 = state.profiles.findIndex(p => p.id === p2.id);
        if (gIdx1 >= 0 && gIdx2 >= 0) {
          const ids = state.profiles.map(p => p.id);
          [ids[gIdx1], ids[gIdx2]] = [ids[gIdx2], ids[gIdx1]];
          await api.reorderProfiles(ids);
          await loadProfiles();
          renderProfiles();
          renderProfilesList();
        }
      }
    });
  });
}

async function saveNewProfile() {
  if (!els.newProfileName) return;

  const name = els.newProfileName.value.trim();
  if (!name) {
    notify('Name this mode first', 'warning');
    return;
  }

  const profileData = {
    name: name,
    // New modes default to a Routine; stored modes keep their kind.
    kind: els.newProfileKind?.value === 'family' ? 'family' : 'timer',
    avatar: els.newProfileAvatar?.value?.trim() || '',
    accent: document.getElementById('new-profile-accent')?.value || null,
    notes: els.newProfileNotes?.value?.trim() || '',
    action: state.action,
    mode: 'duration',
    seconds: inputSeconds(),
    autoStart: false,
    dryRun: state.dryRun,
    forceShutdown: state.forceShutdown,
    muteSystem: state.muteSystem,
    gracePeriod: state.graceMinutes,
    smartLightsEnabled: state.smartLights.enabled,
    smartLightsMode: state.smartLights.mode
  };

  try {
    const exists = state.profiles.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      // Replacing a saved mode takes a second press of Save mode (no
      // native dialog): the first press arms and says so inline.
      const step = twoStepNext(profileSavePending, `save:${name.toLowerCase()}`, Date.now(), PROFILE_TWO_STEP_MS);
      if (step.decision === 'arm') {
        clearProfileSaveConfirm();
        profileSavePending = step.pending;
        const note = document.getElementById('profile-save-note');
        if (note) {
          note.textContent = `A mode named "${name}" exists. Press Save mode again to replace it.`;
          note.hidden = false;
        }
        els.btnSaveProfile?.classList?.add('is-confirming');
        profileSaveTimer = setTimeout(clearProfileSaveConfirm, PROFILE_TWO_STEP_MS);
        return;
      }
    }
    clearProfileSaveConfirm();

    const result = await api.createProfile(profileData);
    if (result.success) {
      notify(`Mode "${result.profile.name}" ${result.action === 'created' ? 'saved' : 'updated'}`, 'success');
      els.newProfileName.value = '';
      if (els.newProfileAvatar) els.newProfileAvatar.value = '';
      const newProfileAccent = document.getElementById('new-profile-accent');
      if (newProfileAccent) newProfileAccent.value = '';
      if (els.newProfileNotes) els.newProfileNotes.value = '';
      await loadProfiles();
      renderProfilesList();
    } else {
      notify(result.error || 'Couldn’t save this mode', 'error');
    }
  } catch (error) {
    notify(`Couldn’t save this mode: ${error.message}`, 'error');
  }
}

// Deletes only: the two presses that lead here are requestProfileDelete's.
async function deleteProfile(profileId) {
  try {
    const result = await api.deleteProfile(profileId);
    if (result.success) {
      notify('Mode deleted', 'success');
      if (state.currentProfileId === profileId) {
        state.currentProfileId = null;
        await persistSelectedProfile(null);
      }
      await loadProfiles();
      renderProfiles();
      renderProfilesList();
    } else {
      notify(result.error || 'Couldn’t delete this mode', 'error');
    }
  } catch (error) {
    notify(`Couldn’t delete this mode: ${error.message}`, 'error');
  }
}

async function exportProfiles() {
  try {
    const json = await api.exportProfiles();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lights-out-profiles-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Profiles exported', 'success');
  } catch (error) {
    notify(`Export failed: ${error.message}`, 'error');
  }
}

async function importProfiles(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const result = await api.importProfiles(text);
    if (result.success) {
      notify(`${result.count} profiles imported`, 'success');
      await loadProfiles();
      renderProfiles();
      renderProfilesList();
    } else {
      notify(result.error || 'Import failed', 'error');
    }
  } catch (error) {
    notify(`Import failed: ${error.message}`, 'error');
  }

  // Reset file input
  event.target.value = '';
}
/* exported openProfilesModal, saveNewProfile, exportProfiles, importProfiles, restoreSelectedProfile, resetProfileFilters, syncProfileChipTitles, getMyModesOrder, onMyModesShortcut, editProfileFromMenu, deleteProfileFromMenu, clearProfileSaveConfirm */
