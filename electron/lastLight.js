// Ported from PowerShell LightsOut.LastLight.psm1.
// Timer-zero finale copy and step timing (visual layer only).
// Dual-mode: usable via require() in Node/main and via <script> in the renderer.
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.LastLight = mod;
})(typeof window !== 'undefined' ? window : null, function () {
  const VALID_IDS = ['ClassicFade', 'ExitTheGrid', 'AntiAlgorithm', 'SignalSeverance'];

  // ───────────────────────────────────────────────────────────────────────────
  // Custom sequence support. Users can create step scripts stored in settings.
  // ───────────────────────────────────────────────────────────────────────────
  const CUSTOM_PREFIX = 'custom_';
  // A new finale can be added only while fewer than this many exist.
  const MAX_CUSTOM_SEQUENCES = 32;
  // Load-time sanity bound for a hand-edited file. Lists saved by builds that
  // had no add limit load in full, so the next add/remove (which persists this
  // in-memory list) cannot silently drop entries beyond the add limit.
  const MAX_LOADED_CUSTOM_SEQUENCES = 256;
  let customSequences = [];  // [{ id, name, description, steps: [{ headline, line, dwellMs }] }]

  function sanitizeStep(step) {
    if (!step || typeof step !== 'object') return null;
    const headline = String(step.headline || '').slice(0, 80);
    const line = String(step.line || '').slice(0, 160);
    if (!headline && !line) return null;
    const rawDwell = Number(step.dwellMs);
    const dwellMs = Number.isFinite(rawDwell) ? Math.max(200, Math.min(10000, Math.round(rawDwell))) : 1500;
    return { headline, line, dwellMs };
  }

  function isCustomId(id) {
    return typeof id === 'string' && id.startsWith(CUSTOM_PREFIX) && /^[A-Za-z0-9_-]{8,64}$/.test(id);
  }

  // Small stable hash (FNV-1a) so this file stays usable in the renderer.
  function stableHash(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
  }

  // fallbackId: the id to use when seq has no valid one. A new finale gets a
  // fresh id; a stored one gets an id derived from what was stored, so it is
  // the same on every launch.
  function sanitizeCustomSequence(seq, fallbackId) {
    if (!seq || typeof seq !== 'object' || !Array.isArray(seq.steps)) return null;
    const name = String(seq.name || '').trim().slice(0, 60);
    const steps = seq.steps.map(sanitizeStep).filter(Boolean).slice(0, 20);
    if (!name || !steps.length) return null;
    const id = isCustomId(seq.id)
      ? seq.id
      : fallbackId || CUSTOM_PREFIX + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    return { id, name, description: String(seq.description || '').slice(0, 160), steps };
  }

  function loadCustomSequences(seqs) {
    const loaded = [];
    const used = new Set();
    for (const seq of Array.isArray(seqs) ? seqs : []) {
      if (loaded.length >= MAX_LOADED_CUSTOM_SEQUENCES) break;
      const stored = seq && typeof seq === 'object' ? seq : null;
      const derived = CUSTOM_PREFIX + 'stored_' + stableHash(JSON.stringify([stored && stored.id, stored && stored.name]));
      const entry = sanitizeCustomSequence(seq, derived);
      if (!entry) continue;
      // Ids stay unique, so removing one finale never removes another.
      let id = entry.id;
      for (let n = 2; used.has(id); n++) id = `${entry.id.slice(0, 60)}_${n}`;
      used.add(id);
      loaded.push(id === entry.id ? entry : { ...entry, id });
    }
    customSequences = loaded;
  }

  function getCustomSequences() {
    return customSequences;
  }

  // Returns null when the sequence is invalid or the limit is reached.
  function addCustomSequence(seq) {
    if (customSequences.length >= MAX_CUSTOM_SEQUENCES) return null;
    // A new finale always gets a fresh id, never one the caller supplied.
    const entry = sanitizeCustomSequence(seq && typeof seq === 'object' ? { ...seq, id: undefined } : seq);
    if (!entry) return null;
    customSequences.push(entry);
    return entry;
  }

  function removeCustomSequence(id) {
    customSequences = customSequences.filter(s => s.id !== id);
  }

  function getCatalog() {
    const builtIn = [
      { id: 'ClassicFade', name: 'Classic Fade', description: 'Calm fade before confirm' },
      { id: 'ExitTheGrid', name: 'Exit the Grid', description: 'Cyber unplug finale' },
      { id: 'AntiAlgorithm', name: 'Anti-Algorithm Protocol', description: 'Feed-resist shutdown ritual' },
      { id: 'SignalSeverance', name: 'Signal Severance', description: 'Premium severance checklist' }
    ];
    return [...builtIn, ...customSequences.map(s => ({ id: s.id, name: s.name, description: s.description, custom: true }))];
  }

  function normalizeId(id) {
    if (!id) return 'ClassicFade';
    if (String(id).startsWith(CUSTOM_PREFIX)) return id;
    const raw = String(id).replace(/\s/g, '').replace(/_/g, '').toLowerCase();
    if (raw === 'classicfade') return 'ClassicFade';
    if (raw === 'exitthegrid') return 'ExitTheGrid';
    if (raw === 'antialgorithm' || raw === 'antialgorithmprotocol') return 'AntiAlgorithm';
    if (raw === 'signalseverance') return 'SignalSeverance';
    return 'ClassicFade';
  }

  function isValidId(id) {
    if (String(id).startsWith(CUSTOM_PREFIX)) return customSequences.some(s => s.id === id);
    return VALID_IDS.indexOf(normalizeId(id)) !== -1;
  }

  function getMeta(sequenceId, dryRun) {
    const id = normalizeId(sequenceId);
    // Custom sequence.
    if (String(id).startsWith(CUSTOM_PREFIX)) {
      const custom = customSequences.find(s => s.id === id);
      if (custom) {
        return {
          id,
          finalLine: custom.steps[custom.steps.length - 1]?.line || 'Night secured.',
          sequenceLabel: custom.name.toUpperCase(),
          cinematicTitle: custom.name.toUpperCase(),
          stampLine: dryRun ? 'TEST MODE' : 'UNPLUGGED'
        };
      }
    }
    let finalLine;
    switch (id) {
      case 'ExitTheGrid': finalLine = 'You are no longer available to the system.'; break;
      case 'AntiAlgorithm': finalLine = 'The algorithm lost tonight.'; break;
      case 'SignalSeverance': finalLine = 'Signal severed. Night secured.'; break;
      default: finalLine = dryRun ? 'No power action will run.' : 'Night recovered.';
    }
    const sequenceLabel = {
      ExitTheGrid: 'EXIT THE GRID',
      AntiAlgorithm: 'ANTI-ALGORITHM PROTOCOL',
      SignalSeverance: 'SIGNAL SEVERANCE'
    }[id] || 'LAST LIGHT';
    return {
      id,
      finalLine,
      sequenceLabel,
      cinematicTitle: 'LAST LIGHT',
      stampLine: dryRun ? 'TEST MODE' : 'UNPLUGGED'
    };
  }

  function getSteps(sequenceId, dryRun) {
    const id = normalizeId(sequenceId);
    const meta = getMeta(id, dryRun);
    // Custom sequence.
    if (String(id).startsWith(CUSTOM_PREFIX)) {
      const custom = customSequences.find(s => s.id === id);
      if (custom?.steps?.length) {
        let steps = custom.steps.map(s => ({
          headline: s.headline || '',
          line: s.line || '',
          dwellMs: Number(s.dwellMs) || 1500
        }));
        if (dryRun) steps = steps.map(s => ({ ...s, dwellMs: Math.max(400, Math.round(s.dwellMs * 0.35)) }));
        return steps;
      }
    }
    let lines;
    switch (id) {
      case 'ExitTheGrid':
        lines = [
          { headline: 'GRID HOLD WEAKENING', line: 'The feed is losing control.', dwellMs: 1800 },
          { headline: '', line: 'Breaking signal...', dwellMs: 1200 },
          { headline: '', line: 'Disconnecting feed...', dwellMs: 1200 },
          { headline: '', line: 'Exiting the grid...', dwellMs: 1500 },
          { headline: '', line: meta.finalLine, dwellMs: 2000 }
        ];
        break;
      case 'AntiAlgorithm':
        lines = [
          { headline: 'THE FEED WANTS ONE MORE CLICK', line: 'Lights Out says no.', dwellMs: 1800 },
          { headline: 'ANTI-ALGORITHM PROTOCOL', line: '', dwellMs: 1000 },
          { headline: '', line: 'Autoplay resisted.', dwellMs: 900 },
          { headline: '', line: 'Recommendations ignored.', dwellMs: 900 },
          { headline: '', line: 'Infinite scroll denied.', dwellMs: 900 },
          { headline: '', line: 'Session ending.', dwellMs: 1200 },
          { headline: '', line: meta.finalLine, dwellMs: 2000 }
        ];
        break;
      case 'SignalSeverance':
        lines = [
          { headline: 'SIGNAL SEVERANCE INITIATED', line: '', dwellMs: 1200 },
          { headline: '', line: 'Browser noise: muted', dwellMs: 900 },
          { headline: '', line: 'Video loop: severed', dwellMs: 900 },
          { headline: '', line: 'System glow: fading', dwellMs: 900 },
          { headline: '', line: 'Session: closing', dwellMs: 1200 },
          { headline: '', line: meta.finalLine, dwellMs: 2000 }
        ];
        break;
      default:
        lines = [
          { headline: 'LAST LIGHT', line: 'Your session is ending.', dwellMs: 2000 },
          { headline: meta.stampLine, line: meta.finalLine, dwellMs: 1800 }
        ];
    }
    if (dryRun) {
      lines = lines.map(s => ({ ...s, dwellMs: Math.max(400, Math.round(s.dwellMs * 0.35)) }));
    }
    return lines;
  }

  function getDurationMs(sequenceId, dryRun) {
    return getSteps(sequenceId, dryRun).reduce((sum, s) => sum + Number(s.dwellMs || 0), 0);
  }

  function getSoundCatalog() {
    return [
      { id: 'Off', name: 'Off' },
      { id: 'Soft', name: 'Soft tick' },
      { id: 'Silent', name: 'Silent' }
    ];
  }

  function normalizeSoundId(id) {
    const v = String(id || 'Off').toLowerCase();
    if (v === 'soft') return 'Soft';
    if (v === 'silent') return 'Silent';
    return 'Off';
  }

  return {
    VALID_IDS,
    MAX_CUSTOM_SEQUENCES,
    getCatalog,
    normalizeId,
    isValidId,
    getMeta,
    getSteps,
    getDurationMs,
    getSoundCatalog,
    normalizeSoundId,
    loadCustomSequences,
    getCustomSequences,
    addCustomSequence,
    removeCustomSequence
  };
});
