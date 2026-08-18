// Renderer: Navigation Contract (Phase 5C-A). Loaded as a classic sibling
// <script>, after renderer-help.js and before renderer.js (see index.html)
// -- initNavigationContract() is self-contained and only touches
// document/body, so it runs immediately at script-execution time.
//
// This file covers: mouse-button back/forward, Alt+Left/Right back/forward,
// and delegated roving arrow-key navigation for any element marked
// data-ns-navgroup="horizontal|vertical". It does NOT touch the timer
// engine, power engine, scheduled execution, or Phone Companion runtime --
// purely presentation-layer keyboard/mouse ergonomics on top of the
// existing handleSidebarNavigation() single entry point (renderer.js).
//
// History stack: pushNavRoute() is called from handleSidebarNavigation()
// on every real, user-driven tab change. navGoBack()/navGoForward() call
// handleSidebarNavigation() back with { fromHistory: true } so the move
// itself doesn't get re-pushed onto the stack it just came from.

let navBackStack = [];
let navForwardStack = [];
let navCurrentTab = null;

function pushNavRoute(tab) {
  if (tab === navCurrentTab) return;
  if (navCurrentTab !== null) navBackStack.push(navCurrentTab);
  navForwardStack = [];
  navCurrentTab = tab;
}

// A real modal (Quick Plans manager, Proof ledger, About) blocks the
// background -- mouse-button/Alt+Arrow navigation underneath it would be
// confusing while it's open, so this is skipped, matching the existing
// "Escape closes the modal first" precedent already in renderer.js.
function navModalOpen() {
  return !!document.querySelector('#profiles-modal.active, #receipts-modal.active, #about-modal.active');
}

function navGoBack() {
  if (navModalOpen() || !navBackStack.length) return;
  const target = navBackStack.pop();
  navForwardStack.push(navCurrentTab);
  navCurrentTab = target;
  if (typeof handleSidebarNavigation === 'function') handleSidebarNavigation(target, { fromHistory: true });
}

function navGoForward() {
  if (navModalOpen() || !navForwardStack.length) return;
  const target = navForwardStack.pop();
  navBackStack.push(navCurrentTab);
  navCurrentTab = target;
  if (typeof handleSidebarNavigation === 'function') handleSidebarNavigation(target, { fromHistory: true });
}

function initNavigationContract() {
  // Mouse back/forward side buttons: MouseEvent.button 3 = XButton1 (back),
  // 4 = XButton2 (forward). mouseup (not mousedown/click) so this can't
  // fire in the middle of an unrelated drag.
  document.addEventListener('mouseup', event => {
    if (event.button === 3) { event.preventDefault(); navGoBack(); }
    else if (event.button === 4) { event.preventDefault(); navGoForward(); }
  });
  // Some Windows mouse drivers/Chromium builds also fire these as
  // auxclick rather than a plain mouseup -- listen for both so the side
  // buttons work regardless of driver behavior. Deduping isn't needed:
  // a given click fires as either mouseup+click or auxclick, never both.
  document.addEventListener('auxclick', event => {
    if (event.button === 3) { event.preventDefault(); navGoBack(); }
    else if (event.button === 4) { event.preventDefault(); navGoForward(); }
  });

  document.addEventListener('keydown', event => {
    if (!event.altKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); navGoBack(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); navGoForward(); }
  });

  // Delegated roving arrow-key navigation: any element carrying
  // data-ns-navgroup="horizontal"|"vertical" becomes a group whose real
  // focusable children (buttons, or tabindex="0" elements like the
  // Quick-plans cards) can be moved between with arrow keys, matching the
  // existing top-menu submenu pattern (wireTopMenus() in renderer.js)
  // instead of introducing a second convention. Delegated on document so
  // it also covers content rendered after this file executes (Library
  // tiles, Quick Plans cards) with no per-render re-wiring needed.
  document.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const group = event.target.closest('[data-ns-navgroup]');
    if (!group) return;
    const orientation = group.getAttribute('data-ns-navgroup');
    const items = Array.from(group.querySelectorAll('button:not([disabled]), [tabindex="0"]'))
      .filter(el => el.offsetParent !== null);
    const currentIndex = items.indexOf(event.target);
    if (currentIndex === -1) return;
    const forwardKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const backwardKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    let nextIndex = null;
    if (event.key === forwardKey) nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === backwardKey) nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex].focus();
  });
}

initNavigationContract();
/* exported pushNavRoute, navGoBack, navGoForward */
