// Canonical Family Profile identity resolution for timer attribution.
// Renderer data supplies lookup keys only; names always come from profiles.js.

function emptyIdentity() {
  return { profileId: null, profileName: null };
}

function normalizeCanonicalProfile(profile) {
  if (!profile || typeof profile.id !== 'string' || typeof profile.name !== 'string') {
    return emptyIdentity();
  }
  const profileId = profile.id.trim().substring(0, 128);
  const profileName = profile.name.trim().substring(0, 32);
  return profileId && profileName ? { profileId, profileName } : emptyIdentity();
}

function resolveCanonicalProfileIdentity({ requestedProfileId, fallbackProfileId, getProfileById }) {
  if (typeof getProfileById !== 'function') return emptyIdentity();

  const requested = typeof requestedProfileId === 'string' ? requestedProfileId.trim() : '';
  if (requested) {
    const identity = normalizeCanonicalProfile(getProfileById(requested));
    if (identity.profileId) return identity;
  }

  const fallback = typeof fallbackProfileId === 'string' ? fallbackProfileId.trim() : '';
  return fallback ? normalizeCanonicalProfile(getProfileById(fallback)) : emptyIdentity();
}

function resolveTimerProfileIdentity({ source, requestedProfileId, fallbackProfileId, getProfileById }) {
  if (source === 'remote') return emptyIdentity();
  return resolveCanonicalProfileIdentity({ requestedProfileId, fallbackProfileId, getProfileById });
}

function reconcilePersistedSelection(settingsStore, profileStore) {
  const appSettings = settingsStore.getSection('app') || {};
  const selectedId = typeof appSettings.lastSelectedProfileId === 'string'
    ? appSettings.lastSelectedProfileId
    : null;
  if (!selectedId || profileStore.getById(selectedId)) return selectedId;
  settingsStore.updateSection('app', { lastSelectedProfileId: null });
  return null;
}

module.exports = {
  emptyIdentity,
  normalizeCanonicalProfile,
  resolveCanonicalProfileIdentity,
  resolveTimerProfileIdentity,
  reconcilePersistedSelection
};
