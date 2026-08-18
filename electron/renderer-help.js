// Renderer: shared hover/focus help pattern (Phase 5B-A). Loaded as a
// classic sibling <script>, after renderer-utils.js and before renderer.js
// (see index.html) -- initHelpTooltips() is self-contained and only touches
// document/body, so it runs immediately at script-execution time with no
// bootstrap dependency on state/els/api.
//
// Any element with a `data-ns-help="..."` attribute shows that text in one
// shared floating tooltip on mouse hover AND keyboard focus. Native `title`
// only fires on hover, which silently excludes keyboard users, so this is a
// small custom component instead -- not the pre-existing `data-help`
// pattern (top-menu Info items only, toasts on click; left untouched here
// to avoid double behavior on those two elements).
//
// Delegated listeners on `document` so this also covers content rendered
// later by other renderer files (Library tiles, Tonight's participating
// chips, etc.) without each of them having to call an init function.

function initHelpTooltips() {
  let tip = document.getElementById('ns-help-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'ns-help-tip';
    tip.className = 'ns-help-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  let activeEl = null;

  function show(el) {
    const text = el.getAttribute('data-ns-help');
    if (!text) return;
    tip.textContent = text;
    el.setAttribute('aria-describedby', 'ns-help-tip');
    activeEl = el;
    tip.classList.add('visible');
    // Position after the text is set (so tip has real dimensions), clamped
    // to stay on-screen -- same clamp approach as showContextMenu().
    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const left = clamp(rect.left, 8, window.innerWidth - tipRect.width - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= tipRect.height + 12
      ? rect.bottom + 8
      : rect.top - tipRect.height - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }

  function hide(el) {
    if (el && el !== activeEl) return;
    tip.classList.remove('visible');
    if (activeEl) activeEl.removeAttribute('aria-describedby');
    activeEl = null;
  }

  document.addEventListener('mouseover', event => {
    const el = event.target.closest('[data-ns-help]');
    if (el) show(el);
  });
  document.addEventListener('mouseout', event => {
    const el = event.target.closest('[data-ns-help]');
    if (el && !el.contains(event.relatedTarget)) hide(el);
  });
  document.addEventListener('focusin', event => {
    const el = event.target.closest('[data-ns-help]');
    if (el) show(el);
  });
  document.addEventListener('focusout', event => {
    const el = event.target.closest('[data-ns-help]');
    if (el) hide(el);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeEl) hide(activeEl);
  });
  // A click (e.g. a chip that instant-starts) should not leave a stale
  // tooltip floating over the newly-changed page state.
  document.addEventListener('click', event => {
    if (activeEl && !activeEl.contains(event.target)) hide(activeEl);
  });
}

initHelpTooltips();
/* exported initHelpTooltips */
