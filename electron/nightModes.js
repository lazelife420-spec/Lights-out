// Night Modes: declarative, main-process-owned catalogue of themed bedtime presets.
// Each mode is a validated declaration resolved by main before execution.
// No arbitrary scripts, no executable arrays, no renderer-owned validation.

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Schema version and allowed values
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

const ALLOWED_ACTIONS = Object.freeze([
  'shutdown', 'sleep', 'restart', 'hibernate', 'lock', 'logout'
]);

const ALLOWED_EXECUTION_PATHS = Object.freeze([
  'start-timer',
  'start-standard-ritual'
]);

const ALLOWED_STATUSES = Object.freeze([
  'ready',
  'coming_soon',
  'needs_device_setup',
  'needs_router_setup',
  'unsupported'
]);

// ─────────────────────────────────────────────────────────────────────────────
// Built-in catalogue
// ─────────────────────────────────────────────────────────────────────────────

const BUILT_IN_CATALOGUE = Object.freeze([
  Object.freeze({
    id: 'quick-sleep',
    version: 1,
    title: 'Quick Sleep',
    subtitle: 'A short countdown, then sleep this PC.',
    artworkId: 'quick-sleep',
    status: 'ready',
    availability: { supported: true, reason: null },
    timer: {
      durationSeconds: 900,
      action: 'sleep',
      ritualId: 'none'
    },
    actions: [{ type: 'start-timer' }],
    tags: ['15 MIN', 'SLEEP', 'READY']
  }),
  Object.freeze({
    id: 'lights-down',
    version: 1,
    title: 'Lights Down',
    subtitle: 'Wind down with a guided ritual before sleep.',
    artworkId: 'lights-down',
    status: 'ready',
    availability: { supported: true, reason: null },
    timer: {
      durationSeconds: 2700,
      action: 'sleep',
      ritualId: 'standard'
    },
    actions: [{ type: 'start-standard-ritual' }, { type: 'start-timer' }],
    tags: ['45 MIN', 'SLEEP', 'RITUAL', 'READY']
  }),
  Object.freeze({
    id: 'movie-wind-down',
    version: 1,
    title: 'Movie Wind-Down',
    subtitle: 'Finish watching, then let this PC sleep.',
    artworkId: 'movie-wind-down',
    status: 'ready',
    availability: { supported: true, reason: null },
    timer: {
      durationSeconds: 5400,
      action: 'sleep',
      ritualId: 'standard'
    },
    actions: [{ type: 'start-standard-ritual' }, { type: 'start-timer' }],
    tags: ['90 MIN', 'SLEEP', 'RITUAL', 'READY']
  }),
  Object.freeze({
    id: 'full-shutdown',
    version: 1,
    title: 'Full Shutdown',
    subtitle: 'A firm end to the night with a guided ritual.',
    artworkId: 'full-shutdown',
    status: 'ready',
    availability: { supported: true, reason: null },
    timer: {
      durationSeconds: 3600,
      action: 'shutdown',
      ritualId: 'standard'
    },
    actions: [{ type: 'start-standard-ritual' }, { type: 'start-timer' }],
    tags: ['60 MIN', 'SHUTDOWN', 'RITUAL', 'READY']
  }),
  Object.freeze({
    id: 'quiet-house',
    version: 1,
    title: 'Quiet House',
    subtitle: 'Silence networked devices and settle the house.',
    artworkId: 'quiet-house',
    status: 'coming_soon',
    availability: { supported: false, reason: 'Multi-device control is not yet supported.' },
    timer: {
      durationSeconds: 1800,
      action: 'sleep',
      ritualId: 'none'
    },
    actions: [{ type: 'start-timer' }],
    tags: ['30 MIN', 'COMING SOON']
  }),
  Object.freeze({
    id: 'school-night',
    version: 1,
    title: 'School Night',
    subtitle: 'Enforce bedtime with scheduled shutdown and content blocking.',
    artworkId: 'school-night',
    status: 'needs_router_setup',
    availability: { supported: false, reason: 'Requires router-level Wi-Fi control which is not yet supported.' },
    timer: {
      durationSeconds: 1800,
      action: 'shutdown',
      ritualId: 'standard'
    },
    actions: [{ type: 'start-standard-ritual' }, { type: 'start-timer' }],
    tags: ['30 MIN', 'SHUTDOWN', 'NEEDS SETUP']
  })
]);

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateMode(mode) {
  if (!mode || typeof mode !== 'object') return { valid: false, error: 'Mode is not an object' };
  if (!mode.id || typeof mode.id !== 'string') return { valid: false, error: 'Missing or invalid mode id' };
  if (typeof mode.version !== 'number' || mode.version < 1) return { valid: false, error: 'Invalid mode version' };
  if (!mode.title || typeof mode.title !== 'string') return { valid: false, error: 'Missing or invalid mode title' };
  if (!ALLOWED_STATUSES.includes(mode.status)) return { valid: false, error: `Unknown status: ${mode.status}` };

  if (!mode.timer || typeof mode.timer !== 'object') return { valid: false, error: 'Missing timer definition' };
  if (typeof mode.timer.durationSeconds !== 'number' || mode.timer.durationSeconds < 60 || mode.timer.durationSeconds > 86400) {
    return { valid: false, error: 'Timer duration out of range (60–86400)' };
  }
  if (!ALLOWED_ACTIONS.includes(mode.timer.action)) {
    return { valid: false, error: `Unknown timer action: ${mode.timer.action}` };
  }

  if (!Array.isArray(mode.actions) || mode.actions.length === 0) {
    return { valid: false, error: 'Missing actions array' };
  }
  for (const action of mode.actions) {
    if (!action || !ALLOWED_EXECUTION_PATHS.includes(action.type)) {
      return { valid: false, error: `Unknown or invalid action type: ${action && action.type}` };
    }
  }

  return { valid: true, error: null };
}

function isAvailable(mode) {
  if (!mode) return false;
  return mode.status === 'ready' && mode.availability && mode.availability.supported === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue access
// ─────────────────────────────────────────────────────────────────────────────

function getCatalogue() {
  return BUILT_IN_CATALOGUE.map(mode => ({
    id: mode.id,
    version: mode.version,
    title: mode.title,
    subtitle: mode.subtitle,
    artworkId: mode.artworkId,
    status: mode.status,
    availability: { ...mode.availability },
    timer: { ...mode.timer },
    actions: mode.actions.map(a => ({ ...a })),
    tags: [...mode.tags]
  }));
}

function getById(id) {
  if (!id || typeof id !== 'string') return null;
  const mode = BUILT_IN_CATALOGUE.find(m => m.id === id);
  if (!mode) return null;
  return {
    id: mode.id,
    version: mode.version,
    title: mode.title,
    subtitle: mode.subtitle,
    artworkId: mode.artworkId,
    status: mode.status,
    availability: { ...mode.availability },
    timer: { ...mode.timer },
    actions: mode.actions.map(a => ({ ...a })),
    tags: [...mode.tags]
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution: convert a mode selection into canonical timer options
// ─────────────────────────────────────────────────────────────────────────────

function resolveForExecution(nightModeId) {
  const mode = getById(nightModeId);
  if (!mode) return { success: false, error: `Unknown night mode: ${nightModeId}` };

  const validation = validateMode(mode);
  if (!validation.valid) return { success: false, error: validation.error };

  if (!isAvailable(mode)) {
    return { success: false, error: `Mode "${mode.title}" is not available: ${mode.availability.reason || mode.status}` };
  }

  // Determine execution path from the actions array
  const hasRitual = mode.actions.some(a => a.type === 'start-standard-ritual');
  const ritualId = hasRitual ? 'standard' : (mode.timer.ritualId || 'none');

  return {
    success: true,
    resolved: {
      nightModeId: mode.id,
      nightModeVersion: mode.version,
      nightModeTitle: mode.title,
      durationSeconds: mode.timer.durationSeconds,
      action: mode.timer.action,
      ritualId,
      dryRun: false,
      forceShutdown: false,
      muteSystem: false,
      gracePeriod: 2
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// START-time resolution: compare actual execution against canonical mode.
// Returns main-resolved identity or null fields if execution was modified.
// ─────────────────────────────────────────────────────────────────────────────

function resolveNightModeStart(options) {
  const empty = { nightModeId: null, nightModeTitle: null, nightModeVersion: null };
  if (!options || !options.nightModeId) return empty;
  const mode = getById(options.nightModeId);
  if (!mode || !isAvailable(mode)) return empty;
  if (options.durationSeconds !== mode.timer.durationSeconds) return empty;
  if (options.action !== mode.timer.action) return empty;
  return {
    nightModeId: mode.id,
    nightModeTitle: mode.title,
    nightModeVersion: mode.version
  };
}

module.exports = {
  SCHEMA_VERSION,
  ALLOWED_ACTIONS,
  ALLOWED_EXECUTION_PATHS,
  ALLOWED_STATUSES,
  BUILT_IN_CATALOGUE,
  validateMode,
  isAvailable,
  getCatalogue,
  getById,
  resolveForExecution,
  resolveNightModeStart
};
