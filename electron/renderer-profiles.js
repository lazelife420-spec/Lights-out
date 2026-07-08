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

function renderProfiles() {
  if (!els.profilesGrid) return;

  if (state.profiles.length === 0) {
    els.profilesGrid.innerHTML = '<div class="empty-profiles">No saved profiles yet. Click the gear to create one.</div>';
    return;
  }

  els.profilesGrid.innerHTML = state.profiles.map((profile, index) => {
    const isActive = state.currentProfileId === profile.id;
    const hint = getProfileHint(profile);
    return `
      <div class="profile-card ${isActive ? 'active' : ''}" data-profile-id="${profile.id}" title="Ctrl+${index + 1} to quick-load">
        <div class="profile-name">${escapeHtml(profile.name)}</div>
        <div class="profile-hint">${escapeHtml(hint)}</div>
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

  if (state.profiles.length === 0) {
    els.profilesList.innerHTML = '<div class="empty-profiles">No profiles yet. Create your first one above!</div>';
    return;
  }

  els.profilesList.innerHTML = state.profiles.map((profile, idx) => {
    const hint = getProfileHint(profile);
    return `
      <div class="profile-item" data-profile-id="${profile.id}">
        <div class="profile-item-info">
          <input type="text" class="profile-item-name-input" value="${escapeHtml(profile.name)}" data-profile-id="${profile.id}" maxlength="32" spellcheck="false">
          <div class="profile-item-hint">${escapeHtml(hint)}</div>
        </div>
        <div class="profile-item-actions">
          <button class="profile-item-btn move-btn" data-action="up" data-idx="${idx}" title="Move up" ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
          <button class="profile-item-btn move-btn" data-action="down" data-idx="${idx}" title="Move down" ${idx === state.profiles.length - 1 ? 'disabled' : ''}>&#9660;</button>
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
      } else if (action === 'up' || action === 'down') {
        const idx = parseInt(btn.dataset.idx);
        const newIdx = action === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= state.profiles.length) return;
        const ids = state.profiles.map(p => p.id);
        [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
        await api.reorderProfiles(ids);
        await loadProfiles();
        renderProfiles();
        renderProfilesList();
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
    const result = await api.createProfile(profileData);
    if (result.success) {
      notify(`Profile "${result.profile.name}" ${result.action === 'created' ? 'created' : 'updated'}`, 'success');
      els.newProfileName.value = '';
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
