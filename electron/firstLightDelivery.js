'use strict';

// Claim before sunrise effects. Interrupted claims are never silently replayed.
function createDelivery({ ready, busy, claim, start, onError, now = () => new Date() }) {
  const pending = new Set(), seen = new Set();
  function flush() {
    if (!ready() || busy()) return;
    for (const id of pending) {
      pending.delete(id);
      if (seen.has(id)) continue;
      try {
        if (!claim(id)) { seen.add(id); continue; }
        seen.add(id);
        start(id);
      } catch (error) { onError(error); }
      if (busy()) return;
    }
  }
  function request(argv = []) {
    if (!argv.some(arg => ['--first-light', '--wake-alarm'].includes(String(arg).toLowerCase()))) return false;
    const argument = argv.find(arg => String(arg).startsWith('--first-light-request='));
    const id = argument ? String(argument).slice('--first-light-request='.length) : `legacy-${now().toISOString().slice(0, 10)}`;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return false;
    if (!seen.has(id)) pending.add(id);
    flush();
    return true;
  }
  return { request, flush };
}

module.exports = { createDelivery };
