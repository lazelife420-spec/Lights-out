const test = require('node:test');
const assert = require('node:assert/strict');
const profileIdentity = require('../profileIdentity');

const profiles = new Map([
  ['alex', { id: 'alex', name: 'Alex' }],
  ['sam', { id: 'sam', name: 'Sam' }]
]);
const getProfileById = id => profiles.get(id) || null;

test('canonical identity ignores a mismatched renderer name by accepting only an ID lookup', () => {
  const identity = profileIdentity.resolveCanonicalProfileIdentity({
    requestedProfileId: 'alex',
    profileName: 'Mallory',
    fallbackProfileId: null,
    getProfileById
  });
  assert.deepEqual(identity, { profileId: 'alex', profileName: 'Alex' });
});

test('invalid explicit identity falls back to the persisted valid selection', () => {
  const identity = profileIdentity.resolveCanonicalProfileIdentity({
    requestedProfileId: 'deleted',
    fallbackProfileId: 'sam',
    getProfileById
  });
  assert.deepEqual(identity, { profileId: 'sam', profileName: 'Sam' });
});

test('missing or invalid identity resolves to an empty attribution', () => {
  const identity = profileIdentity.resolveCanonicalProfileIdentity({
    requestedProfileId: 'deleted',
    fallbackProfileId: 'also-deleted',
    getProfileById
  });
  assert.deepEqual(identity, { profileId: null, profileName: null });
});

test('remote starts remain unattributed even with explicit and persisted valid IDs', () => {
  const identity = profileIdentity.resolveTimerProfileIdentity({
    source: 'remote',
    requestedProfileId: 'alex',
    fallbackProfileId: 'sam',
    getProfileById
  });
  assert.deepEqual(identity, { profileId: null, profileName: null });
});

test('canonical values are safety-normalized only after lookup', () => {
  const identity = profileIdentity.resolveCanonicalProfileIdentity({
    requestedProfileId: 'long',
    fallbackProfileId: null,
    getProfileById: id => id === 'long'
      ? { id: `  ${'i'.repeat(140)}  `, name: `  ${'n'.repeat(40)}  ` }
      : null
  });
  assert.equal(identity.profileId.length, 128);
  assert.equal(identity.profileName.length, 32);
});

test('reconcilePersistedSelection clears a deleted selection', () => {
  let selected = 'deleted';
  const settingsStore = {
    getSection: () => ({ lastSelectedProfileId: selected }),
    updateSection: (section, patch) => { selected = patch.lastSelectedProfileId; }
  };
  const result = profileIdentity.reconcilePersistedSelection(settingsStore, { getById: getProfileById });
  assert.equal(result, null);
  assert.equal(selected, null);
});

test('reconcilePersistedSelection preserves an existing selection', () => {
  let writes = 0;
  const settingsStore = {
    getSection: () => ({ lastSelectedProfileId: 'alex' }),
    updateSection: () => { writes++; }
  };
  const result = profileIdentity.reconcilePersistedSelection(settingsStore, { getById: getProfileById });
  assert.equal(result, 'alex');
  assert.equal(writes, 0);
});
