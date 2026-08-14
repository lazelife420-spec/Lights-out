'use strict';

function decideFocusTraceInstallation(alreadyInstalled) {
  return { install: !alreadyInstalled, reason: alreadyInstalled ? 'already-installed' : 'first-install' };
}

function appendSequenced(buffer, item, maxLength = 4000) {
  const sequence = (buffer.at(-1)?.sequence || 0) + 1;
  buffer.push({ sequence, ...item });
  if (buffer.length > maxLength) buffer.shift();
  return buffer.at(-1);
}

function composeMoveDiagnostics({ correlationId, selector, before, native, after, browserEvents, focusTrace }) {
  if (!correlationId) throw new Error('move correlation ID is required');
  return {
    correlationId,
    selector: selector || null,
    before: before || null,
    native: native || null,
    after: after || null,
    browserEvents: Array.isArray(browserEvents) ? browserEvents : [],
    focusTrace: Array.isArray(focusTrace) ? focusTrace : []
  };
}

module.exports = { appendSequenced, composeMoveDiagnostics, decideFocusTraceInstallation };
