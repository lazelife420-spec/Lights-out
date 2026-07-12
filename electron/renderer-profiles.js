// Renderer: Saved Profiles feature (create, load, reorder, rename, delete,
// import/export). Loaded as a classic sibling <script>, after renderer-utils.js
// and before renderer.js — uses `state`/`els`/`api`/`notify`/`escapeHtml`/
// `actionLabel`/`inputSeconds`/`setInputFromSeconds`/`setAction`/`startTimer`
// from the core script, and is called from wireEvents()/render() there.

async function loadProfiles() {
  try {
    const profiles = await api.getAllProfiles();
    state.profiles = profiles || [];
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

function renderProfiles() {
  if (!els.profilesGrid) return;

  if (state.profiles.length === 0) {
    els.profilesGrid.innerHTML = '<div class="empty-profiles">No saved profiles yet. Click the gear to create one.</div>';
    return;
  }

  const sorted = [...state.profiles].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const lastUsedId = getLastUsedProfileId();
  els.profilesGrid.innerHTML = sorted.map((profile, index) => {
    const isActive = state.currentProfileId === profile.id;
    // Last-used is a separate, persistent signal from "active" (which only
    // reflects this session) -- skip it on the active card to avoid two
    // badges saying almost the same thing at once.
    const isLastUsed = !isActive && profile.id === lastUsedId;
    const hint = getProfileHint(profile);
    // Notes ride along in the card's tooltip -- a quick hover reminder
    // without taking up any of the card's compact layout.
    const cardTitle = profile.notes ? `${profile.notes}` : `Ctrl+${index + 1} to quick-load`;
    return `
      <div class="profile-card ${isActive ? 'active' : ''} ${profile.pinned ? 'pinned' : ''}" data-profile-id="${profile.id}" title="${escapeHtml(cardTitle)}">
        <div class="profile-name">
          ${profile.pinned ? '<span class="pin-badge" style="color:var(--accent-amber); margin-right:4px;">📌</span>' : ''}
          ${escapeHtml(profile.name)}
          ${profile.notes ? '<span class="notes-badge" aria-hidden="true">📝</span>' : ''}
        </div>
        <div class="profile-hint">${escapeHtml(hint)}${isLastUsed ? ' <span class="last-used-badge">· last used</span>' : ''}</div>
      </div>
    `;
  }).join('');

  // Add click handlers
  els.profilesGrid.querySelectorAll('.profile-card').forEach(card => {
    card.addEventListener('click', () => {
      const profileId = card.dataset.profileId;
      applyProfile(profileId);
    });
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

function getProfileHint(profile) {
  if (!profile) return '';
  const action = profile.action.charAt(0).toUpperCase() + profile.action.slice(1);

  if (profile.mode === 'clock') {
    return `${action} at ${profile.clock}`;
  }

  const minutes = Math.ceil(profile.seconds / 60);
  return `${action} in ${minutes}m`;
}

async function applyProfile(profileId, opts = {}) {
  try {
    const result = await api.applyProfile(profileId);
    if (!result.success) {
      notify(result.error || 'Failed to apply profile', 'error');
      return;
    }

    state.currentProfileId = profileId;

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
    if (result.timerOptions) {
      state.action = result.timerOptions.action || state.action;
      state.dryRun = result.timerOptions.dryRun || false;
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
    notify(`Profile "${result.profile.name}" loaded`, 'success');

    // Auto-start if configured, or when started explicitly from the context menu.
    const shouldStart = opts.start || result.autoStart;
    if (shouldStart && !state.running && !state.paused) {
      state._clockDismissedByProfile = false; // timer starting, no restore needed
      startTimer(result.timerOptions?.durationSeconds);
    }
  } catch (error) {
    notify(`Failed to apply profile: ${error.message}`, 'error');
  }
}

function openProfilesModal() {
  if (!els.profilesModal) return;

  // Reset search and filter query
  state.profileSearchQuery = '';
  state.profileActiveFilter = 'all';
  const searchInput = document.getElementById('profile-search');
  if (searchInput) searchInput.value = '';
  const filterContainer = document.getElementById('profile-filters');
  if (filterContainer) {
    filterContainer.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.remove('active');
      b.style.background = 'transparent';
      b.style.color = 'var(--text-muted)';
    });
    const defaultBtn = filterContainer.querySelector('[data-filter="all"]');
    if (defaultBtn) {
      defaultBtn.classList.add('active');
      defaultBtn.style.background = 'rgba(255,255,255,0.08)';
      defaultBtn.style.color = '#fff';
    }
  }

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

function renderProfilesList() {
  if (!els.profilesList) return;

  const filtered = getSortedAndFilteredProfiles();

  if (filtered.length === 0) {
    els.profilesList.innerHTML = '<div class="empty-profiles">No profiles matching search/filter criteria.</div>';
    return;
  }

  els.profilesList.innerHTML = filtered.map((profile, idx) => {
    const hint = getProfileHint(profile);
    const lastUsedHint = profile.lastUsedAt ? ` · Last used ${formatTimeAgo(new Date(profile.lastUsedAt))}` : '';
    return `
      <div class="profile-item" data-profile-id="${profile.id}">
        <div class="profile-item-info">
          <input type="text" class="profile-item-name-input" value="${escapeHtml(profile.name)}" data-profile-id="${profile.id}" maxlength="32" spellcheck="false">
          <div class="profile-item-hint">${escapeHtml(hint)}${escapeHtml(lastUsedHint)}</div>
          <input type="text" class="profile-item-notes-input" value="${escapeHtml(profile.notes || '')}" data-profile-id="${profile.id}" maxlength="280" spellcheck="false" placeholder="Add a note...">
        </div>
        <div class="profile-item-actions">
          <button class="profile-item-btn pin-btn" data-action="pin" title="${profile.pinned ? 'Unpin' : 'Pin'}">
            ${profile.pinned ? '📌' : '🧷'}
          </button>
          <button class="profile-item-btn move-btn" data-action="up" data-idx="${idx}" title="Move up" ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
          <button class="profile-item-btn move-btn" data-action="down" data-idx="${idx}" title="Move down" ${idx === filtered.length - 1 ? 'disabled' : ''}>&#9660;</button>
          <button class="profile-item-btn load-btn" data-action="load">Load</button>
          <button class="profile-item-btn delete-btn" data-action="delete">Delete</button>
        </div>
      </div>
    `;
  }).join('');

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
        await deleteProfile(profileId);
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
    notify('Enter a profile name', 'warning');
    return;
  }

  const profileData = {
    name: name,
    notes: els.newProfileNotes?.value?.trim() || '',
    action: state.action,
    mode: 'duration',
    seconds: inputSeconds(),
    autoStart: els.newProfileAutostart?.checked ?? false,
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
      if (!confirm(`A profile named "${name}" already exists. Overwrite it?`)) {
        return;
      }
    }

    const result = await api.createProfile(profileData);
    if (result.success) {
      notify(`Profile "${result.profile.name}" ${result.action === 'created' ? 'created' : 'updated'}`, 'success');
      els.newProfileName.value = '';
      if (els.newProfileNotes) els.newProfileNotes.value = '';
      await loadProfiles();
      renderProfilesList();
    } else {
      notify(result.error || 'Failed to save profile', 'error');
    }
  } catch (error) {
    notify(`Failed to save profile: ${error.message}`, 'error');
  }
}

async function deleteProfile(profileId) {
  if (!confirm('Delete this profile?')) return;

  try {
    const result = await api.deleteProfile(profileId);
    if (result.success) {
      notify('Profile deleted', 'success');
      if (state.currentProfileId === profileId) {
        state.currentProfileId = null;
      }
      await loadProfiles();
      renderProfiles();
      renderProfilesList();
    } else {
      notify(result.error || 'Failed to delete profile', 'error');
    }
  } catch (error) {
    notify(`Failed to delete profile: ${error.message}`, 'error');
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
/* exported openProfilesModal, saveNewProfile, exportProfiles, importProfiles */
