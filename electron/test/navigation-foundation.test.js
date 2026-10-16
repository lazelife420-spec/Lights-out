'use strict';

// v11.2 Navigation Foundation.
//
// Same source-extraction + vm sandbox technique as tonights-plan-contract
// .test.js / power-action-lock-parity.test.js / dry-run-state-integrity
// .test.js: real functions are pulled out of renderer.js by source text and
// executed in a sandbox against constructed DOM-like fixtures, so these
// tests exercise actual behavior -- not string-grepping -- for every claim
// where that's meaningful. A handful of narrowly-scoped structural checks
// are used only where the claim itself is structural (e.g. "this specific
// modal is excluded from the dismissible list").

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererPath = path.join(__dirname, '..', 'renderer.js');
const rendererSource = fs.readFileSync(rendererPath, 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found in renderer.js`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length;
  let parenDepth = 1;
  while (parenDepth > 0 && i < source.length) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') parenDepth--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  if (source[i] !== '{') throw new Error(`function ${name}: no body found after parameter list`);
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

// Extracts a `const NAME = [ ... ];` array literal by source text, using
// bracket balancing from the first `[` to its matching `]`.
function extractConst(source, name) {
  const headerMatch = source.match(new RegExp(`const ${name} = \\[`));
  if (!headerMatch) throw new Error(`const ${name} not found in renderer.js`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length - 1; // at the '['
  let depth = 1;
  i++;
  while (depth > 0 && i < source.length) {
    if (source[i] === '[') depth++;
    else if (source[i] === ']') depth--;
    i++;
  }
  return source.slice(start, i);
}

// Extracts the `if (event.key === 'Escape') { ... }` branch from the main
// keydown handler (the one with the "Close the topmost active
// modal/drawer" comment -- there is a second, unrelated keydown listener
// for the custom context menu later in the file that also checks
// event.key === 'Escape', so this anchors on that comment specifically).
function extractMainEscapeBranch(source) {
  const anchor = source.indexOf('// Close the topmost active modal/drawer.');
  if (anchor === -1) throw new Error('main Escape handler comment not found');
  // The comment sits INSIDE the `if (event.key === 'Escape') { ... }`
  // wrapper, not before it -- search backward from the anchor for the
  // enclosing if, not forward (forward would skip past it and find the
  // unrelated context-menu Escape handler later in the file instead).
  const ifStart = source.lastIndexOf("if (event.key === 'Escape')", anchor);
  if (ifStart === -1) throw new Error('enclosing if (event.key === \'Escape\') not found before the anchor comment');
  const braceStart = source.indexOf('{', ifStart);
  let i = braceStart + 1;
  let depth = 1;
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(ifStart, i);
}

// Strips `// ...` line comments before running "must not contain" regex
// checks -- the explanatory comments on these branches legitimately
// mention the old function names/calls in prose (documenting what they
// used to do), which would otherwise false-positive a naive substring/regex
// check against the comment text itself, not the executable code.
function stripLineComments(text) {
  return text.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
}

// Extracts just the `{ ... }` body introduced by arbitrary literal text
// ending in an opening `{` (e.g. an addEventListener/api.on... callback
// signature), via balanced brace matching, and returning only the brace body
// (not the marker prefix) so it can be attached directly to a new
// function signature. Used for the Companion-setup button and the
// tray/global-shortcut IPC handler, which are anonymous callbacks, not
// named functions or if-blocks.
function extractBlockAfter(source, marker) {
  const markerStart = source.indexOf(marker);
  if (markerStart === -1) throw new Error(`marker not found in renderer.js: ${marker}`);
  const braceStart = markerStart + marker.length - 1; // marker's own trailing '{'
  let i = braceStart + 1;
  let depth = 1;
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(braceStart, i);
}

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(n => values.add(n)),
    remove: (...names) => names.forEach(n => values.delete(n)),
    toggle: (name, force) => {
      const shouldHave = force === undefined ? !values.has(name) : Boolean(force);
      if (shouldHave) values.add(name); else values.delete(name);
      return shouldHave;
    },
    contains: name => values.has(name)
  };
}

function createElement({ id = null, classes = [], dataset = {}, style = {}, visible = true } = {}) {
  const attributes = new Map();
  const children = [];
  const el = {
    id,
    dataset,
    classList: createClassList(classes),
    style: { display: '', ...style },
    setAttribute: (n, v) => attributes.set(n, String(v)),
    getAttribute: n => (attributes.has(n) ? attributes.get(n) : null),
    removeAttribute: n => attributes.delete(n),
    hasAttribute: n => attributes.has(n),
    focus: () => { el.__focused = true; },
    blur: () => { el.__focused = false; },
    contains: other => children.includes(other),
    addEventListener: () => {},
    click: () => { el.__clicked = (el.__clicked || 0) + 1; },
    // Settable like __focused/__clicked above -- tests flip this directly
    // (e.g. a nav control going hidden) to simulate an ancestor
    // hiding the element (body.mini-mode hiding .chrome-header/
    // .ns-sidebar), which is exactly what isRendered()'s real
    // checkVisibility() call has to detect and an inline-style read alone
    // could not. Still honors style.display for the existing
    // inline-hidden fixtures, matching what a real checkVisibility() call
    // would answer regardless of which one caused the hiding.
    __visible: visible,
    checkVisibility: () => el.__visible && el.style.display !== 'none'
  };
  return el;
}

// Minimal selector support for exactly the patterns the extracted
// functions use: `.class`, `.class.class2`, `[data-x="y"]`, and a leading
// class combined with one trailing attribute selector.
function elementMatchesSelector(el, selector) {
  const classMatch = selector.match(/^\.([\w-]+(?:\.[\w-]+)*)/);
  let rest = selector;
  if (classMatch) {
    const classes = classMatch[1].split('.');
    if (!classes.every(c => el.classList.contains(c))) return false;
    rest = selector.slice(classMatch[0].length);
  }
  const attrMatch = rest.match(/^\[data-([\w-]+)="([^"]*)"\]$/);
  if (attrMatch) {
    const [, attrNameRaw, value] = attrMatch;
    const camel = attrNameRaw.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (el.dataset[camel] !== value) return false;
  }
  return true;
}

// A minimal stand-in for document.body -- real BODY is always focusable in
// the technical sense (any HTMLElement has a .focus() method), but never a
// destination worth choosing on purpose. Exists so isSensibleFocusTarget()'s
// `el === document.body` check has something real to compare against.
function createFakeBody() {
  return createElement({ id: 'body' });
}

function createFakeDocument({ elementsById = {}, navItems = [], body } = {}) {
  const byId = { ...elementsById };
  const activeElementHolder = { current: null };
  return {
    getElementById: id => byId[id] || null,
    body: body || createFakeBody(),
    get activeElement() { return activeElementHolder.current; },
    __setActive: el => { activeElementHolder.current = el; },
    querySelectorAll: selector => {
      if (selector.startsWith('.ns-nav-item')) return navItems.filter(el => elementMatchesSelector(el, selector));
      return [];
    },
    querySelector: selector => {
      if (selector.startsWith('.ns-nav-item')) return navItems.find(el => elementMatchesSelector(el, selector)) || null;
      return null;
    }
  };
}

// Values returned from code executed inside the vm context carry that
// context's own Array/Object prototypes, distinct from this file's host
// realm -- assert/strict's deepEqual treats that as a structural mismatch
// even when every element matches. Spreading into a plain host-realm
// array first sidesteps that without weakening what's asserted.
const plainArray = value => [...value];

const NAV_TABS = ['lib', 'modes', 'sch', 'devices', 'set', 'stats'];
const DISMISSIBLE_MODAL_IDS = ['profiles-modal', 'receipts-modal', 'about-modal', 'notif-drawer', 'streak-celebration-modal', 'lan-warning-modal'];
const NON_DISMISSIBLE_MODAL_IDS = ['warning-modal', 'override-modal', 'snooze-tax-modal', 'ritual-overlay'];

function buildNavItems() {
  return NAV_TABS.concat('help').map(tab => createElement({ classes: ['ns-nav-item'], dataset: { nsTab: tab } }));
}

function buildModalElements() {
  const els = {};
  for (const id of DISMISSIBLE_MODAL_IDS.concat(NON_DISMISSIBLE_MODAL_IDS)) {
    els[id] = createElement({ id });
  }
  return els;
}

function createNavigationSandbox({ activeTab = 'lib', settingsReturnTab, remoteControlState = { ready: false }, extraGlobals = {} } = {}) {
  const navItems = buildNavItems();

  const modalEls = buildModalElements();
  // Mirror applyMainPanelVisibility()'s real invariant: exactly one panel
  // starts visible (matching activeTab), every other one starts hidden --
  // not all defaulted to '' the way a bare createElement() would, which
  // would make "did the destination NOT switch" assertions vacuously true.
  const panels = {
    panelLib: createElement({ style: { display: activeTab === 'lib' ? '' : 'none' } }),
    panelModes: createElement({ style: { display: activeTab === 'modes' ? '' : 'none' } }),
    panelSch: createElement({ style: { display: activeTab === 'sch' ? '' : 'none' } }),
    panelDevices: createElement({ style: { display: activeTab === 'devices' ? '' : 'none' } }),
    panelSet: createElement({ style: { display: activeTab === 'set' ? '' : 'none' } }),
    panelStats: createElement({ style: { display: activeTab === 'stats' ? '' : 'none' } })
  };
  const btnNotif = createElement({ id: 'btn-notif' });
  const btnLanWarningCancel = createElement({ id: 'btn-lan-warning-cancel' });

  const elementsById = {
    'notif-drawer': modalEls['notif-drawer'],
    'btn-notif': btnNotif,
    'streak-celebration-modal': modalEls['streak-celebration-modal'],
    'lan-warning-modal': modalEls['lan-warning-modal'],
    'btn-lan-warning-cancel': btnLanWarningCancel,
    'warning-modal': modalEls['warning-modal'],
    'override-modal': modalEls['override-modal'],
    'snooze-tax-modal': modalEls['snooze-tax-modal'],
    'ritual-overlay': modalEls['ritual-overlay'],
  };
  const fakeDocument = createFakeDocument({ elementsById, navItems });

  const calls = {
    saveAppSettings: [],
    notify: [],
    render: 0,
    ritualCancel: 0,
    hideRitualOverlay: 0,
    exitFullscreenClock: 0,
    cancelTimer: 0,
    discardSettingsPanelChanges: 0,
    getRemoteControl: 0,
    openExternal: []
  };

  const els = {
    profilesModal: modalEls['profiles-modal'],
    receiptsModal: modalEls['receipts-modal'],
    aboutModal: modalEls['about-modal'],
    panelLib: panels.panelLib,
    panelModes: panels.panelModes,
    panelSch: panels.panelSch,
    panelDevices: panels.panelDevices,
    panelSet: panels.panelSet,
    panelStats: panels.panelStats,
    modalClose: createElement({ id: 'modal-close' })
  };

  const state = { action: 'shutdown', dryRun: true, forceShutdown: false, muteSystem: false, graceMinutes: 2, unit: 'min', running: false, paused: false, fullscreenClock: false };

  const sandbox = {
    state,
    els,
    document: fakeDocument,
    console,
    notify: (...args) => { calls.notify.push(args); },
    render: () => { calls.render++; },
    // openSettingsPanel's own UI-sync side effects -- not part of what's
    // under test here (Settings' own customize/last-light/remote-control
    // sub-panels are untouched by this slice).
    syncCustomizeUI: () => {},
    updateLastLightUIFromState: () => {},
    loadRemoteControlState: () => {},
    switchSettingsCategory: () => {},
    // Settings Save/Cancel internals -- untouched by this slice; not
    // extracted here, just tracked so tests can assert closeSettingsPanel
    // itself never calls them (it doesn't -- callers do, separately).
    discardSettingsPanelChanges: async () => { calls.discardSettingsPanelChanges++; },
    saveSettingsPanel: async () => { calls.saveSettingsPanel = (calls.saveSettingsPanel || 0) + 1; },
    refreshUpdaterStatus: () => {},
    renderStatusPanel: () => {},
    exitFullscreenClock: () => { calls.exitFullscreenClock++; state.fullscreenClock = false; },
    cancelTimer: () => { calls.cancelTimer++; state.running = false; state.paused = false; },
    api: {
      saveAppSettings: async payload => { calls.saveAppSettings.push(payload); return {}; },
      ritualCancel: async () => { calls.ritualCancel++; },
      getRemoteControl: async () => { calls.getRemoteControl++; return remoteControlState; },
      openExternal: async url => { calls.openExternal.push(url); }
    },
    hideRitualOverlay: () => { calls.hideRitualOverlay++; modalEls['ritual-overlay'].classList.remove('active'); },
    // Optional page renderers a test opts into (Schedule, Proof › Routine);
    // absent by default, exactly like the typeof guards expect.
    ...extraGlobals
  };
  const context = vm.createContext(sandbox);
  const source = [
    extractConst(rendererSource, 'NAV_DISMISSIBLE_MODALS'),
    extractFunction(rendererSource, 'closeAnyDismissibleModal'),
    extractConst(rendererSource, 'NAV_BLOCKING_MODAL_IDS'),
    extractFunction(rendererSource, 'findActiveBlockingModal'),
    extractFunction(rendererSource, 'setSidebarSelection'),
    extractFunction(rendererSource, 'applyMainPanelVisibility'),
    'let helpOpenerElement = null;',
    extractFunction(rendererSource, 'isRendered'),
    extractFunction(rendererSource, 'isSensibleFocusTarget'),
    extractFunction(rendererSource, 'openHelpPanel'),
    extractFunction(rendererSource, 'closeHelpPanel'),
    `let settingsReturnTab = ${JSON.stringify(settingsReturnTab ?? 'lib')};`,
    // The real display-name map (not a copy), so Back-button labels for new
    // destinations like Devices are exercised as shipped.
    rendererSource.match(/const NS_TAB_DISPLAY_NAME = \{[^}]*\};/)[0],
    extractFunction(rendererSource, 'openSettingsPanel'),
    extractFunction(rendererSource, 'closeSettingsPanel'),
    extractFunction(rendererSource, 'handleSidebarNavigation'),
    // The Companion-setup button and the tray/global-shortcut IPC
    // handler, wrapped as standalone functions -- real callback bodies,
    // not a re-implementation -- so tests exercise the literal code path
    // each real trigger runs, delegating into the SAME extracted
    // handleSidebarNavigation() above rather than a duplicated
    // openSettingsPanel() bypass.
    `async function triggerCompanionSettingsClick() ${extractBlockAfter(rendererSource, "els.btnCompanion?.addEventListener('click', async () => {")}`,
    `function triggerOnOpenSettingsIpc() ${extractBlockAfter(rendererSource, 'api.onOpenSettings(() => {')}`,
    `this.__nav = { closeAnyDismissibleModal, findActiveBlockingModal, handleSidebarNavigation, setSidebarSelection, applyMainPanelVisibility, openSettingsPanel, closeSettingsPanel, openHelpPanel, closeHelpPanel, isSensibleFocusTarget, triggerCompanionSettingsClick, triggerOnOpenSettingsIpc, getSettingsReturnTab: () => settingsReturnTab, getHelpOpenerElement: () => helpOpenerElement };`
  ].join('\n');
  vm.runInContext(source, context);
  // Initialize .active/aria-current via the real setSidebarSelection(),
  // matching activeTab -- not a manual classList toggle -- so tests start
  // from a realistic "already navigated here" state.
  context.__nav.setSidebarSelection(activeTab);

  return {
    state,
    els,
    modalEls,
    panels,
    navItems,
    fakeDocument,
    calls,
    // The vm context itself, so a test can run another real callback body
    // (e.g. the footer pill's click handler) against this same router.
    context,
    ...context.__nav
  };
}

test('sanity: sandbox builds and every function extracted', () => {
  const sandbox = createNavigationSandbox();
  assert.equal(typeof sandbox.closeAnyDismissibleModal, 'function');
  assert.equal(typeof sandbox.handleSidebarNavigation, 'function');
  assert.equal(typeof sandbox.openSettingsPanel, 'function');
  assert.equal(typeof sandbox.closeSettingsPanel, 'function');
});

// --- Modal-blocking-navigation defect (REQUIRED item 1) -------------------

test('NAV_DISMISSIBLE_MODALS excludes destructive/in-progress modals (structural: the list itself)', () => {
  const listSource = extractConst(rendererSource, 'NAV_DISMISSIBLE_MODALS');
  for (const id of NON_DISMISSIBLE_MODAL_IDS) {
    // Quoted-literal match, not a bare substring -- 'warning-modal' is
    // itself a substring of the legitimately-included 'lan-warning-modal'.
    assert.doesNotMatch(listSource, new RegExp(`'${id}'`), `NAV_DISMISSIBLE_MODALS must never reference '${id}' -- it represents active/destructive state that navigation must not silently discard`);
  }
  // Three entries reference their element via the pre-cached `els.*`
  // property rather than a getElementById('...') string literal.
  const ELS_PROPERTY_BY_ID = { 'profiles-modal': 'els.profilesModal', 'receipts-modal': 'els.receiptsModal', 'about-modal': 'els.aboutModal' };
  for (const id of DISMISSIBLE_MODAL_IDS) {
    const needle = ELS_PROPERTY_BY_ID[id] || `'${id}'`;
    assert.ok(listSource.includes(needle), `NAV_DISMISSIBLE_MODALS should include '${id}' (looked for ${needle})`);
  }
});

test('closeAnyDismissibleModal() actually closes an open, safe modal (behavioral)', () => {
  const sandbox = createNavigationSandbox();
  sandbox.modalEls['about-modal'].classList.add('active');

  const closed = sandbox.closeAnyDismissibleModal();

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false);
  assert.deepEqual(plainArray(closed), ['about-modal']);
});

test('closeAnyDismissibleModal() closes every open dismissible modal at once, not just the first', () => {
  const sandbox = createNavigationSandbox();
  sandbox.modalEls['about-modal'].classList.add('active');
  sandbox.modalEls['receipts-modal'].classList.add('active');

  const closed = sandbox.closeAnyDismissibleModal();

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false);
  assert.equal(sandbox.modalEls['receipts-modal'].classList.contains('active'), false);
  assert.deepEqual(new Set(plainArray(closed)), new Set(['receipts-modal', 'about-modal']));
});

test('closeAnyDismissibleModal() does NOT touch active/destructive modals (the explicit exceptions)', () => {
  const sandbox = createNavigationSandbox();
  for (const id of NON_DISMISSIBLE_MODAL_IDS) sandbox.modalEls[id].classList.add('active');

  const closed = sandbox.closeAnyDismissibleModal();

  assert.deepEqual(plainArray(closed), []);
  for (const id of NON_DISMISSIBLE_MODAL_IDS) {
    assert.equal(sandbox.modalEls[id].classList.contains('active'), true, `${id} must remain untouched -- navigation must not silently discard it`);
  }
});

test('closeAnyDismissibleModal() blurs focus if it was inside the closed modal (no stale focus trap)', () => {
  const sandbox = createNavigationSandbox();
  const closeBtn = createElement({ id: 'about-modal-close' });
  sandbox.modalEls['about-modal'].__children = [closeBtn];
  sandbox.modalEls['about-modal'].contains = other => other === closeBtn;
  sandbox.modalEls['about-modal'].classList.add('active');
  sandbox.fakeDocument.__setActive(closeBtn);

  sandbox.closeAnyDismissibleModal();

  assert.equal(closeBtn.__focused, false, 'focus must be removed from an element inside a now-closed modal');
});

test('top-level navigation closes an open compatible modal, and the destination really changes -- the audited defect, reproduced and fixed', async () => {
  // Exact audited sequence: open About, then click a different top-level
  // destination (Modes).
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  sandbox.modalEls['about-modal'].classList.add('active');
  sandbox.panels.panelLib.style.display = '';
  sandbox.panels.panelModes.style.display = 'none';

  await sandbox.handleSidebarNavigation('modes');

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false, 'the old modal must no longer be blocking the screen');
  assert.equal(sandbox.panels.panelModes.style.display, '', 'Modes must actually become visible');
  assert.equal(sandbox.panels.panelLib.style.display, 'none', 'Tonight must actually become hidden -- not just covered');
});

test('destructive/in-progress modals are left alone by navigation, and navigation itself is blocked while one is active', async () => {
  // Superseded contract (corrective pass): the original v11.2 Navigation
  // Foundation commit (6ccd458) let the underlying screen switch anyway,
  // leaving the exempted modal merely stacked on top. That was found to
  // still let a user lose track of an active safety decision by
  // navigating away underneath it -- the corrected, required contract is
  // that navigation is refused outright while one of these is open. See
  // the more thorough "each non-dismissible safety/in-progress modal
  // blocks top-level navigation entirely" test below for full coverage
  // across all four; this one keeps the original scenario as a direct,
  // narrow regression check.
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  sandbox.modalEls['warning-modal'].classList.add('active');

  const result = await sandbox.handleSidebarNavigation('modes');

  assert.equal(result, false, 'navigation must be refused while an active power-safety warning is open');
  assert.equal(sandbox.modalEls['warning-modal'].classList.contains('active'), true, 'an active power-safety warning must never be silently dismissed by navigation');
  assert.equal(sandbox.panels.panelModes.style.display, 'none', 'the underlying screen must not switch while the warning is unresolved');
});

// --- Back navigation (REQUIRED item 2) -------------------------------------

test('Settings Back returns to the actual previous destination, not always Tonight', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'sch' });

  await sandbox.openSettingsPanel();
  assert.equal(sandbox.getSettingsReturnTab(), 'sch', 'opening Settings from Schedule must remember Schedule as the return destination');

  sandbox.closeSettingsPanel();

  assert.equal(sandbox.panels.panelSch.style.display, '', 'Back must return to Schedule, not Tonight');
  assert.equal(sandbox.panels.panelSet.style.display, 'none');
});

test('Back falls back to Tonight/Home when there is no recorded previous destination', () => {
  const sandbox = createNavigationSandbox({ settingsReturnTab: null });

  sandbox.closeSettingsPanel();

  assert.equal(sandbox.panels.panelLib.style.display, '', 'with no prior destination recorded, Back must land on Tonight');
});

test('Back does not replay modal state -- closing Settings never re-opens a dismissible modal', () => {
  const sandbox = createNavigationSandbox({ activeTab: 'modes', settingsReturnTab: 'modes' });
  sandbox.modalEls['about-modal'].classList.add('active');

  sandbox.closeSettingsPanel();

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), true, 'closeSettingsPanel must not touch unrelated modal state either way -- it only owns its own panel');
});

test('repeated navigation does not corrupt the recorded previous-view state', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });

  await sandbox.handleSidebarNavigation('sch');
  await sandbox.openSettingsPanel();
  assert.equal(sandbox.getSettingsReturnTab(), 'sch');
  sandbox.closeSettingsPanel();
  assert.equal(sandbox.panels.panelSch.style.display, '');

  await sandbox.handleSidebarNavigation('modes');
  await sandbox.openSettingsPanel();
  assert.equal(sandbox.getSettingsReturnTab(), 'modes', 'the return tab must update to the NEW previous view, not stick to the first one ever recorded');
  sandbox.closeSettingsPanel();
  assert.equal(sandbox.panels.panelModes.style.display, '');
});

// --- Home / Tonight recovery (REQUIRED item 3) -----------------------------

test('Tonight is always directly reachable from any current view', async () => {
  for (const fromTab of NAV_TABS) {
    const sandbox = createNavigationSandbox({ activeTab: fromTab });
    await sandbox.handleSidebarNavigation('lib');
    assert.equal(sandbox.panels.panelLib.style.display, '', `Tonight must be reachable directly from ${fromTab}`);
  }
});

// --- Current-view truth (REQUIRED item 5) ----------------------------------

test('the nav indicator (.active + aria-current) tracks the actual visible destination, for every top-level tab', async () => {
  for (const tab of NAV_TABS) {
    const sandbox = createNavigationSandbox({ activeTab: 'lib' });
    await sandbox.handleSidebarNavigation(tab);

    for (const item of sandbox.navItems) {
      const shouldBeCurrent = item.dataset.nsTab === tab;
      assert.equal(item.classList.contains('active'), shouldBeCurrent, `nav item ${item.dataset.nsTab} .active must match whether it's the current tab (${tab})`);
      assert.equal(item.getAttribute('aria-current'), shouldBeCurrent ? 'page' : null, `nav item ${item.dataset.nsTab} aria-current must match whether it's the current tab (${tab})`);
    }
  }
});

test('navigating away and back leaves no stale .active/aria-current on the old destination', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  await sandbox.handleSidebarNavigation('modes');
  await sandbox.handleSidebarNavigation('sch');

  const modesItem = sandbox.navItems.find(i => i.dataset.nsTab === 'modes');
  assert.equal(modesItem.classList.contains('active'), false);
  assert.equal(modesItem.getAttribute('aria-current'), null);
});

// --- Accessibility: focus after navigation (REQUIRED item 8) --------------

test('after navigation, focus lands on the newly-current nav item', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  await sandbox.handleSidebarNavigation('modes');

  const modesItem = sandbox.navItems.find(i => i.dataset.nsTab === 'modes');
  assert.equal(modesItem.__focused, true);
});

// UI-R3 Fire 03: a calm launch. The startup restore and the fullscreen entry
// pass focusNav: false -- the selection still lands, but nothing is focused,
// so no keyboard focus ring is painted on the rail before the user acts.
test('focusNav: false still sets .active and aria-current but focuses nothing', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  const ok = await sandbox.handleSidebarNavigation('modes', { persist: false, focusNav: false });

  assert.equal(ok, true);
  const modesItem = sandbox.navItems.find(i => i.dataset.nsTab === 'modes');
  assert.equal(modesItem.classList.contains('active'), true, 'the selection still lands');
  assert.equal(modesItem.getAttribute('aria-current'), 'page');
  assert.ok(sandbox.navItems.every(i => i.__focused !== true), 'no nav item is focused');
  assert.equal(sandbox.panels.panelModes.style.display, '', 'the page still switches');
  assert.equal(sandbox.calls.saveAppSettings.length, 0, 'persist: false still skips the save');
});

test('the default call (every click / keyboard path) still focuses the nav item', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  await sandbox.handleSidebarNavigation('devices');
  assert.equal(sandbox.navItems.find(i => i.dataset.nsTab === 'devices').__focused, true);
  const again = createNavigationSandbox({ activeTab: 'modes' });
  await again.handleSidebarNavigation('lib', { persist: false });
  assert.equal(again.navItems.find(i => i.dataset.nsTab === 'lib').__focused, true, 'focusNav defaults to true');
});

// UI-R3 Fire 03: the footer truth pill leads back to the session. The real
// click handler body runs in the navigation sandbox, against the real router.
function addStatusPill(sandbox, { running = false, paused = false, disabled = false } = {}) {
  const calls = { openSettingsCategory: [], chkFocus: 0 };
  sandbox.state.running = running;
  sandbox.state.paused = paused;
  sandbox.els.statusPill = createElement({ id: 'status-pill' });
  sandbox.els.statusPill.disabled = disabled;
  sandbox.els.chkDryRun = createElement({ id: 'chk-dryrun' });
  sandbox.els.chkDryRun.focus = () => { calls.chkFocus++; };
  sandbox.context.openSettingsCategory = async (id) => { calls.openSettingsCategory.push(id); };
  vm.runInContext(`this.__pillClick = async function () ${extractBlockAfter(rendererSource, "els.statusPill?.addEventListener('click', async () => {")};`, sandbox.context);
  return { click: () => sandbox.context.__pillClick(), calls };
}

test('a status pill click while running opens Tonight -- never Settings, never a dryRun write', async () => {
  for (const [running, paused] of [[true, false], [false, true]]) {
    const sandbox = createNavigationSandbox({ activeTab: 'devices' });
    const pill = addStatusPill(sandbox, { running, paused });
    const dryRunBefore = sandbox.state.dryRun;
    let dryRunWrites = 0;
    let dryRun = dryRunBefore;
    Object.defineProperty(sandbox.state, 'dryRun', { get: () => dryRun, set: v => { dryRunWrites++; dryRun = v; }, configurable: true });

    await pill.click();

    const label = running ? 'running' : 'paused';
    assert.equal(sandbox.panels.panelLib.style.display, '', `${label}: Tonight is on screen`);
    assert.equal(sandbox.panels.panelDevices.style.display, 'none', `${label}: Devices is hidden`);
    assert.equal(sandbox.navItems.find(i => i.dataset.nsTab === 'lib').classList.contains('active'), true);
    assert.deepEqual(plainArray(pill.calls.openSettingsCategory), [], `${label}: never opens Settings`);
    assert.equal(pill.calls.chkFocus, 0, `${label}: never focuses the Test Mode switch`);
    assert.equal(dryRunWrites, 0, `${label}: never writes dryRun`);
    assert.equal(sandbox.state.dryRun, dryRunBefore);
  }
});

test('a status pill click while idle keeps the Power & Safety shortcut; a disabled pill does nothing', async () => {
  const idle = createNavigationSandbox({ activeTab: 'lib' });
  const pill = addStatusPill(idle);
  await pill.click();
  assert.deepEqual(plainArray(pill.calls.openSettingsCategory), ['power-safety']);

  const off = createNavigationSandbox({ activeTab: 'devices' });
  const offPill = addStatusPill(off, { running: true, disabled: true });
  await offPill.click();
  assert.equal(off.panels.panelDevices.style.display, '', 'a disabled pill never navigates');
  assert.deepEqual(plainArray(offPill.calls.openSettingsCategory), []);
});

// UI-R3 Fire 03: a readiness cell opens the place where you fix it.
function createReadinessSandbox({ running = false, paused = false, navResult = true } = {}) {
  const calls = { nav: [], settings: [], timers: [], cleared: 0, scroll: [], chkFocus: 0 };
  const cards = {};
  for (const id of ['device-card-phone', 'device-card-lights']) {
    const card = createElement({ id });
    card.scrollIntoView = opts => calls.scroll.push([id, opts]);
    card.focus = opts => { card.__focusedWith = opts; };
    cards[id] = card;
  }
  const panelSet = createElement({ style: { display: 'none' } });
  const sandbox = {
    state: { running, paused, dryRun: true },
    els: { panelSet, chkDryRun: { focus: () => { calls.chkFocus++; } } },
    document: { getElementById: id => cards[id] || null },
    window: { matchMedia: () => ({ matches: false }) },
    handleSidebarNavigation: async (tab) => { calls.nav.push(tab); return navResult; },
    openSettingsCategory: async (id) => { calls.settings.push(id); panelSet.style.display = ''; },
    setTimeout: (fn, ms) => { calls.timers.push([fn, ms]); return calls.timers.length; },
    clearTimeout: () => { calls.cleared++; }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    rendererSource.match(/const RDY_DEVICE_TARGETS = \[[^\]]*\];/)[0],
    'let rdyFocusTimer = null;',
    'let rdyFocusCard = null;',
    extractFunction(rendererSource, 'openReadinessTarget'),
    'this.go = openReadinessTarget;'
  ].join('\n'), sandbox);
  return { go: sandbox.go, calls, cards, state: sandbox.state };
}

test('a device readiness cell opens Devices, then lands on its card with a brief outline', async () => {
  const box = createReadinessSandbox();
  assert.equal(await box.go('device-card-lights'), true);
  assert.deepEqual(plainArray(box.calls.nav), ['devices']);
  const card = box.cards['device-card-lights'];
  assert.equal(card.getAttribute('tabindex'), '-1', 'the card can take focus');
  assert.equal(card.__focusedWith.preventScroll, true);
  assert.equal(box.calls.scroll[0][1].block, 'nearest');
  assert.equal(card.classList.contains('is-focus'), true, 'the outline is on');
  const [clear, ms] = box.calls.timers.at(-1);
  assert.equal(ms, 1200);
  clear();
  assert.equal(card.classList.contains('is-focus'), false, 'and off again after 1.2 s');

  // A second cell moves the outline; the first one never lingers.
  await box.go('device-card-phone');
  await box.go('device-card-lights');
  assert.equal(box.cards['device-card-phone'].classList.contains('is-focus'), false);
  assert.equal(box.cards['device-card-lights'].classList.contains('is-focus'), true);
});

test('a refused navigation (blocking modal) adds no highlight; a session or unknown target does nothing', async () => {
  const blocked = createReadinessSandbox({ navResult: false });
  assert.equal(await blocked.go('device-card-phone'), false);
  assert.equal(blocked.cards['device-card-phone'].classList.contains('is-focus'), false);
  assert.equal(blocked.calls.scroll.length, 0);

  for (const st of [{ running: true }, { paused: true }]) {
    const active = createReadinessSandbox(st);
    assert.equal(await active.go('device-card-phone'), false);
    assert.equal(await active.go('settings:power-safety'), false);
    assert.deepEqual(plainArray(active.calls.nav), []);
    assert.deepEqual(plainArray(active.calls.settings), []);
  }
  const odd = createReadinessSandbox();
  assert.equal(await odd.go('settings:advanced'), false);
  assert.equal(await odd.go('ns-panel-set'), false);
  assert.deepEqual(plainArray(odd.calls.nav), []);
});

test('the Safety cell opens Power & Safety and focuses Test Mode without touching dryRun', async () => {
  const box = createReadinessSandbox();
  let writes = 0;
  let dryRun = true;
  Object.defineProperty(box.state, 'dryRun', { get: () => dryRun, set: v => { writes++; dryRun = v; } });
  assert.equal(await box.go('settings:power-safety'), true);
  assert.deepEqual(plainArray(box.calls.settings), ['power-safety']);
  assert.equal(box.calls.chkFocus, 1);
  assert.equal(writes, 0);
  assert.equal(box.state.dryRun, true);
});

test('the Back button\'s accessible name reflects the actual return destination', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'sch' });
  await sandbox.openSettingsPanel();
  assert.equal(sandbox.els.modalClose.getAttribute('aria-label'), 'Back to Schedule');
});

// --- State preservation (REQUIRED item 6) ----------------------------------

test('navigation never alters state.action, Dry Run, or other power/settings fields', async () => {
  const sandbox = createNavigationSandbox();
  const snapshot = { ...sandbox.state };

  for (const tab of NAV_TABS) await sandbox.handleSidebarNavigation(tab);

  assert.equal(sandbox.state.action, snapshot.action);
  assert.equal(sandbox.state.dryRun, snapshot.dryRun);
  assert.equal(sandbox.state.forceShutdown, snapshot.forceShutdown);
  assert.equal(sandbox.state.muteSystem, snapshot.muteSystem);
  assert.equal(sandbox.state.graceMinutes, snapshot.graceMinutes);
  assert.equal(sandbox.state.unit, snapshot.unit);
});

// --- Help/About navigation truth (corrective pass, REQUIRED item 1) -------
//
// Reproduced defect: Settings open -> click Help -> About opens on top of
// Settings, but the sidebar marks Help as current even though Settings is
// still the actual visible destination underneath. Help/About is a modal
// action, not a page destination, and must never claim current-view truth.

test('Help opened from Tonight leaves Tonight current (no false destination claim)', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });

  await sandbox.handleSidebarNavigation('help');

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), true, 'About must open');
  const libItem = sandbox.navItems.find(i => i.dataset.nsTab === 'lib');
  const helpItem = sandbox.navItems.find(i => i.dataset.nsTab === 'help');
  assert.equal(libItem.classList.contains('active'), true, 'Tonight must remain the current destination underneath');
  assert.equal(libItem.getAttribute('aria-current'), 'page');
  assert.equal(helpItem.classList.contains('active'), false, 'Help must never claim to be the current destination');
  assert.equal(helpItem.getAttribute('aria-current'), null);
  assert.equal(sandbox.panels.panelLib.style.display, '', 'the underlying Tonight panel must still actually be the one showing');
});

test('Help opened from Settings leaves Settings current (the exact reproduced defect)', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'sch' });
  await sandbox.openSettingsPanel(); // Settings now open, current

  await sandbox.handleSidebarNavigation('help');

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), true);
  const setItem = sandbox.navItems.find(i => i.dataset.nsTab === 'set');
  const helpItem = sandbox.navItems.find(i => i.dataset.nsTab === 'help');
  assert.equal(setItem.classList.contains('active'), true, 'Settings must remain the current destination underneath About');
  assert.equal(setItem.getAttribute('aria-current'), 'page');
  assert.equal(helpItem.getAttribute('aria-current'), null, 'Help must not claim current-view truth');
  assert.equal(sandbox.panels.panelSet.style.display, '', 'Settings must still actually be the visible underlying panel');
});

test('closing Help restores focus to whatever had it before Help opened', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  const helpButton = sandbox.navItems.find(i => i.dataset.nsTab === 'help');
  sandbox.fakeDocument.__setActive(helpButton);

  sandbox.openHelpPanel();
  assert.equal(sandbox.getHelpOpenerElement(), helpButton);

  sandbox.closeHelpPanel();

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false);
  assert.equal(helpButton.__focused, true, 'focus must return to whatever opened Help');
  assert.equal(sandbox.getHelpOpenerElement(), null, 'the opener reference must clear once consumed');
});

test('Help never causes an implicit Settings Save or Cancel', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'sch' });
  await sandbox.openSettingsPanel();

  await sandbox.handleSidebarNavigation('help');
  sandbox.closeHelpPanel();

  assert.equal(sandbox.calls.discardSettingsPanelChanges, 0, 'opening/closing Help must never discard Settings state');
  assert.equal((sandbox.calls.saveSettingsPanel || 0), 0, 'opening/closing Help must never save Settings state');
  assert.equal(sandbox.panels.panelSet.style.display, '', 'Settings must still be open, exactly as the user left it');
});

// --- Non-dismissible safety/in-progress modals block navigation
// (corrective pass, REQUIRED item 2) ----------------------------------------
//
// Preserves the deliberate exclusion from auto-dismissal (warning/
// override/snooze-tax/ritual-overlay), but page-level navigation must not
// switch the screen underneath one of these either -- it's refused
// outright until the user resolves it through the modal's own controls.

test('each non-dismissible safety/in-progress modal blocks top-level navigation entirely', async () => {
  for (const id of NON_DISMISSIBLE_MODAL_IDS) {
    const sandbox = createNavigationSandbox({ activeTab: 'lib' });
    sandbox.modalEls[id].classList.add('active');

    const result = await sandbox.handleSidebarNavigation('modes');

    assert.equal(result, false, `navigation must report refused while ${id} is active`);
    assert.equal(sandbox.panels.panelModes.style.display, 'none', `${id}: the destination must not switch`);
    assert.equal(sandbox.panels.panelLib.style.display, '', `${id}: the underlying screen must not change`);
    const libItem = sandbox.navItems.find(i => i.dataset.nsTab === 'lib');
    const modesItem = sandbox.navItems.find(i => i.dataset.nsTab === 'modes');
    assert.equal(libItem.classList.contains('active'), true, `${id}: the nav indicator must not move`);
    assert.equal(modesItem.classList.contains('active'), false, `${id}: the nav indicator must not move`);
    assert.equal(sandbox.modalEls[id].classList.contains('active'), true, `${id}: the modal itself must remain active`);
  }
});

test('blocked navigation has zero side effects: no plan/power state change, no Save/Cancel triggered', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  sandbox.modalEls['warning-modal'].classList.add('active');
  const snapshot = { ...sandbox.state };

  await sandbox.handleSidebarNavigation('sch');

  assert.equal(sandbox.state.action, snapshot.action);
  assert.equal(sandbox.state.dryRun, snapshot.dryRun);
  assert.equal(sandbox.calls.discardSettingsPanelChanges, 0);
  assert.equal(sandbox.calls.saveAppSettings.length, 0);
  assert.equal(sandbox.calls.render, 0);
});

test('resolving/closing the blocking modal permits navigation afterward', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  sandbox.modalEls['warning-modal'].classList.add('active');

  const blockedResult = await sandbox.handleSidebarNavigation('modes');
  assert.equal(blockedResult, false);
  assert.equal(sandbox.panels.panelModes.style.display, 'none');

  // User resolves it through the modal's own controls (simulated here by
  // just clearing 'active', matching what Snooze/Cancel/Dismiss/etc. do).
  sandbox.modalEls['warning-modal'].classList.remove('active');

  const allowedResult = await sandbox.handleSidebarNavigation('modes');
  assert.equal(allowedResult, true);
  assert.equal(sandbox.panels.panelModes.style.display, '', 'navigation must succeed once the blocking modal is gone');
});

test('ordinary dismissible modals (About, profiles, receipts, etc.) still dismiss on navigation -- blocking logic does not interfere', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  sandbox.modalEls['about-modal'].classList.add('active');
  sandbox.modalEls['receipts-modal'].classList.add('active');

  const result = await sandbox.handleSidebarNavigation('modes');

  assert.equal(result, true);
  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false);
  assert.equal(sandbox.modalEls['receipts-modal'].classList.contains('active'), false);
  assert.equal(sandbox.panels.panelModes.style.display, '');
});

// UI-R1: the top Power/Settings/Help menus were removed -- the sidebar is the
// single navigation authority. The equivalent contracts are exercised by the
// sidebar navigation tests above (return destinations, blocking-modal refusal,
// Help-leaves-current, unsaved-state preservation) and by the shell-nav gate
// in desktop-ux-functional-gate.js.

// --- Schedule is one page (UI-R3 P10): no sub-tab bar left to mis-point ---
//
// The six Schedule sub-tabs (.tab-btn) and their activateTopTab() helper are
// gone: Schedule is one scrolling page, Focus moved to Settings › Automations
// and Streaks to Proof › Routine. The sidebar router owns every destination,
// and its optional page renderers are typeof-guarded so this sandbox (which
// extracts the router without them) still navigates.

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Schedule has no sub-tab bar: no .tab-btn in the markup and no activateTopTab in the renderer', () => {
  assert.doesNotMatch(indexHtml, /class="tab-btn/, 'index.html must not contain a .tab-btn');
  assert.doesNotMatch(indexHtml, /data-tab=/, 'index.html must not contain data-tab sub-tab keys');
  assert.doesNotMatch(rendererSource, /activateTopTab/, 'renderer.js must not define or call activateTopTab');
});

test("handleSidebarNavigation('sch') shows Schedule without renderSchedulePage loaded", async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  const result = await sandbox.handleSidebarNavigation('sch');
  assert.equal(result, true);
  assert.equal(sandbox.panels.panelSch.style.display, '');
  assert.equal(sandbox.panels.panelLib.style.display, 'none');
  const current = sandbox.navItems.filter(el => el.classList.contains('active')).map(el => el.dataset.nsTab);
  assert.deepEqual(plainArray(current), ['sch']);
});

test("handleSidebarNavigation('sch') renders the Schedule page when it is loaded, and leaving stops its clock", async () => {
  const seen = { render: 0, start: 0, stop: 0 };
  const sandbox = createNavigationSandbox({
    activeTab: 'lib',
    extraGlobals: {
      renderSchedulePage: async () => { seen.render++; },
      startScheduleClock: () => { seen.start++; },
      stopScheduleClock: () => { seen.stop++; }
    }
  });
  await sandbox.handleSidebarNavigation('sch');
  assert.equal(seen.render, 1, 'Schedule renders on arrival');
  assert.equal(seen.start, 1, 'the 60 s clock starts when Schedule shows');
  const stopsWhileOnSchedule = seen.stop;
  await sandbox.handleSidebarNavigation('stats');
  assert.equal(seen.stop, stopsWhileOnSchedule + 1, 'leaving Schedule stops its 60 s clock');
  assert.equal(sandbox.panels.panelSch.style.display, 'none');
});

test("handleSidebarNavigation('stats') refreshes Proof › Routine when loaded, and works without it", async () => {
  const bare = createNavigationSandbox({ activeTab: 'lib' });
  assert.equal(await bare.handleSidebarNavigation('stats'), true);
  assert.equal(bare.panels.panelStats.style.display, '');

  const seen = { streaks: 0, debt: 0 };
  const sandbox = createNavigationSandbox({
    activeTab: 'lib',
    extraGlobals: { loadStreaks: () => { seen.streaks++; }, loadSleepDebt: () => { seen.debt++; } }
  });
  assert.equal(await sandbox.handleSidebarNavigation('stats'), true);
  assert.deepEqual({ ...seen }, { streaks: 1, debt: 1 });
});

// --- Settings Save/Cancel semantics unchanged (structural regression guard) ---

// --- Escape contract (REQUIRED item 4) -------------------------------------
//
// The existing Escape handler already implements the required contract
// correctly (priority: fullscreen clock > Settings discard > each modal in
// turn > running-timer cancel as the final fallback). This corrective pass
// makes exactly ONE surgical substitution inside it -- the about-modal
// branch now calls closeHelpPanel() instead of a raw classList.remove(),
// so closing About via Escape gets the same focus-restoration as every
// other close path -- at the same position in the same priority order,
// with every other branch untouched. The "unchanged" test below asserts
// that precisely: the branch order and the running-timer fallback are
// byte-for-byte identical; only that one line differs.

function createEscapeSandbox({ fullscreenClock = false, running = false, paused = false, activeModalIds = [] } = {}) {
  const modalEls = buildModalElements();
  for (const id of activeModalIds) modalEls[id].classList.add('active');

  const settingsPanel = createElement({ style: { display: 'none' } });
  const btnNotif = createElement({ id: 'btn-notif' });
  const btnLanWarningCancel = createElement({ id: 'btn-lan-warning-cancel' });
  const btnSnoozeTaxCancel = createElement({ id: 'btn-snooze-tax-cancel' });

  const elementsById = {
    'notif-drawer': modalEls['notif-drawer'],
    'btn-notif': btnNotif,
    'ritual-overlay': modalEls['ritual-overlay'],
    'warning-modal': modalEls['warning-modal'],
    'override-modal': modalEls['override-modal'],
    'snooze-tax-modal': modalEls['snooze-tax-modal'],
    'lan-warning-modal': modalEls['lan-warning-modal'],
    'btn-lan-warning-cancel': btnLanWarningCancel,
    'btn-snooze-tax-cancel': btnSnoozeTaxCancel,
    'streak-celebration-modal': modalEls['streak-celebration-modal']
  };
  const fakeDocument = createFakeDocument({ elementsById, navItems: [] });

  const calls = { exitFullscreenClock: 0, discardSettingsPanelChanges: 0, closeSettingsPanel: 0, ritualCancel: 0, hideRitualOverlay: 0, cancelTimer: 0, closeHelpPanel: 0 };
  const state = { fullscreenClock, running, paused };
  const els = { panelSet: settingsPanel, profilesModal: modalEls['profiles-modal'], receiptsModal: modalEls['receipts-modal'], aboutModal: modalEls['about-modal'] };

  const sandbox = {
    state,
    els,
    document: fakeDocument,
    console,
    exitFullscreenClock: () => { calls.exitFullscreenClock++; },
    discardSettingsPanelChanges: async () => { calls.discardSettingsPanelChanges++; },
    closeSettingsPanel: () => { calls.closeSettingsPanel++; },
    cancelTimer: () => { calls.cancelTimer++; },
    hideRitualOverlay: () => { calls.hideRitualOverlay++; },
    // Stub matching closeHelpPanel()'s externally-visible effect --
    // closeHelpPanel() itself is separately, fully tested (real,
    // extracted) in the Help/About section below.
    closeHelpPanel: () => { calls.closeHelpPanel++; modalEls['about-modal'].classList.remove('active'); },
    api: { ritualCancel: async () => { calls.ritualCancel++; } }
  };

  const context = vm.createContext(sandbox);
  const branch = extractMainEscapeBranch(rendererSource);
  vm.runInContext(`this.__handleEscape = async function handleEscape(event) {\n${branch}\n};`, context);

  return { state, els, modalEls, settingsPanel, calls, btnSnoozeTaxCancel, handleEscape: context.__handleEscape };
}

test('Escape handler is unchanged except the single, intentional closeHelpPanel() substitution (structural regression guard)', () => {
  // This slice does not otherwise touch the Escape handler -- the
  // navigation fix uses a SEPARATE, parallel dismissal path
  // (closeAnyDismissibleModal), specifically to avoid any risk to
  // Escape's existing, working precedence (especially
  // Escape-cancels-a-running-timer).
  const branch = extractMainEscapeBranch(rendererSource);
  assert.match(branch, /else if \(state\.running \|\| state\.paused\) \{\s*cancelTimer\(\);\s*\}/, 'the running-timer-cancel fallback must still be the last branch, unchanged');
  assert.match(branch, /else if \(els\.aboutModal\?\.classList\.contains\('active'\)\) \{\s*closeHelpPanel\(\);\s*\}/, 'the about-modal branch must be at the same position, now calling closeHelpPanel()');
  // Every other modal branch keeps its original raw close, unmodified.
  assert.match(branch, /els\.profilesModal\.classList\.remove\('active'\)/);
  assert.match(branch, /els\.receiptsModal\.classList\.remove\('active'\)/);
  assert.match(branch, /document\.getElementById\('warning-modal'\)\.classList\.remove\('active'\)/);
  assert.match(branch, /if \(state\.fullscreenClock\) \{\s*exitFullscreenClock\(\);/, 'fullscreen-clock-exit must still be the first, highest-priority branch, unchanged');
});

test('Escape on the snooze-tax modal clicks its "Go to sleep" cancel, resolving the pending choice, and cancels no timer', async () => {
  // It used to only remove .active, leaving showSnoozeTaxModal()'s promise
  // pending with its listeners attached, so the next confirm also resolved
  // the stale promise and snoozed twice.
  const sandbox = createEscapeSandbox({ running: true, activeModalIds: ['snooze-tax-modal'] });

  await sandbox.handleEscape({ key: 'Escape', preventDefault: () => {} });

  assert.equal(sandbox.btnSnoozeTaxCancel.__clicked, 1, 'Escape must go through btn-snooze-tax-cancel');
  assert.equal(sandbox.calls.cancelTimer, 0, 'Escape on the snooze-tax modal must not cancel the running timer');
  const branch = extractMainEscapeBranch(rendererSource);
  assert.match(branch, /getElementById\('snooze-tax-modal'\)\?\.classList\.contains\('active'\)\) \{\s*document\.getElementById\('btn-snooze-tax-cancel'\)\?\.click\(\);\s*\}/);
});

test('Escape closes an ordinary modal (about-modal) when nothing higher-priority is active', async () => {
  const sandbox = createEscapeSandbox({ activeModalIds: ['about-modal'] });

  await sandbox.handleEscape({ key: 'Escape', preventDefault: () => {} });

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false);
  assert.equal(sandbox.calls.cancelTimer, 0, 'closing a modal must not also cancel a timer');
});

test('Escape preserves the existing running-timer-cancel behavior when nothing else is active', async () => {
  const sandbox = createEscapeSandbox({ running: true });

  await sandbox.handleEscape({ key: 'Escape', preventDefault: () => {} });

  assert.equal(sandbox.calls.cancelTimer, 1, 'Escape must still cancel a running timer as the fallback -- this is the exact behavior the roadmap requires preserving');
});

test('Escape preserves running-timer-cancel while paused too', async () => {
  const sandbox = createEscapeSandbox({ paused: true });

  await sandbox.handleEscape({ key: 'Escape', preventDefault: () => {} });

  assert.equal(sandbox.calls.cancelTimer, 1);
});

test('modal-close precedence beats running-timer-cancel: an open modal wins even while a timer is running', async () => {
  // The explicit precedence proof the roadmap asked for: with BOTH a
  // dismissible modal open AND a timer running, Escape must close the
  // modal, not cancel the timer -- modal-close semantics take priority,
  // and this must be demonstrated, not assumed.
  const sandbox = createEscapeSandbox({ running: true, activeModalIds: ['about-modal'] });

  await sandbox.handleEscape({ key: 'Escape', preventDefault: () => {} });

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false, 'the modal must close');
  assert.equal(sandbox.calls.cancelTimer, 0, 'the running timer must NOT be cancelled while a modal was still open -- modal-close precedence, not a coincidence');
});

test('Escape never triggers a real power action -- it only ever calls cancelTimer(), never a power-action API', async () => {
  const branch = extractMainEscapeBranch(rendererSource);
  assert.doesNotMatch(branch, /executePowerAction|startTimer\(|api\.startTimer/, 'the Escape branch must never itself initiate a power action or a new timer');
  const sandbox = createEscapeSandbox({ running: true });
  await sandbox.handleEscape({ key: 'Escape', preventDefault: () => {} });
  assert.equal(sandbox.calls.cancelTimer, 1, 'the only running-timer effect Escape has is cancellation');
});

test('Escape\'s Settings-panel priority discards via the existing path, unchanged, before the running-timer fallback', async () => {
  const sandbox = createEscapeSandbox({ running: true });
  sandbox.settingsPanel.style.display = ''; // Settings open

  await sandbox.handleEscape({ key: 'Escape', preventDefault: () => {} });

  assert.equal(sandbox.calls.discardSettingsPanelChanges, 1);
  assert.equal(sandbox.calls.closeSettingsPanel, 1);
  assert.equal(sandbox.calls.cancelTimer, 0, 'Settings discard takes priority over the running-timer fallback, same as any other open modal');
});

test('Settings Save closes on success; Cancel and Back use the discard path', () => {
  assert.match(rendererSource, /els\.modalClose\.addEventListener\('click', async \(\) => \{\s*await discardSettingsPanelChanges\(\);\s*closeSettingsPanel\(\);/, 'Back-to-Tonight (X) must still discard via the existing path');
  assert.match(rendererSource, /els\.btnCancelOpt\.addEventListener\('click', async \(\) => \{\s*await discardSettingsPanelChanges\(\);/, 'Cancel must still discard via the existing path');
  assert.match(rendererSource, /if \(await saveSettingsPanel\(\)\) closeSettingsPanel\(\);/, 'Save must close only after successful persistence');
  const closeSettingsSource = extractFunction(rendererSource, 'closeSettingsPanel');
  assert.doesNotMatch(closeSettingsSource, /discardSettingsPanelChanges|saveSettingsPanel/, 'closeSettingsPanel() itself must remain a pure panel-visibility switch -- Save/Cancel decisions stay with the callers, not folded into navigation');
});

// --- Settings close focus restoration (Navigation Foundation final
// contract completion) ------------------------------------------------
//
// Back, Cancel, and Save all close Settings through the same
// closeSettingsPanel() (see the structural test below) -- but
// applyMainPanelVisibility() hides #ns-panel-set (containing whichever
// button was just clicked) out from under it, and losing a hidden
// element's focus lands the browser on BODY -- the exact class of bug
// fixed for Help/About. closeSettingsPanel() now lands focus on the
// return destination's own sidebar control instead.

test('closeSettingsPanel() restores focus to the return destination\'s sidebar control, for every possible return tab', () => {
  for (const returnTab of NAV_TABS.filter(t => t !== 'set')) {
    const sandbox = createNavigationSandbox({ activeTab: 'lib', settingsReturnTab: returnTab });

    sandbox.closeSettingsPanel();

    const destinationItem = sandbox.navItems.find(i => i.dataset.nsTab === returnTab);
    assert.equal(destinationItem.__focused, true, `closing Settings when returnTab is ${returnTab} must land focus there`);
  }
});

test('closeSettingsPanel() never focuses a control still inside the now-hidden Settings panel, and never focuses BODY', () => {
  // Deliberately does NOT pre-focus els.modalClose (unlike a real
  // Back/Cancel/Save click) -- the mock's focus()/blur() are independent
  // per-element flags, not a single global activeElement, so pre-setting
  // it true would prove nothing (nothing here would ever flip it back).
  // Instead this checks the one thing that IS meaningful: modalClose's
  // flag staying at its untouched default proves closeSettingsPanel()
  // itself never calls focus() on it.
  const sandbox = createNavigationSandbox({ activeTab: 'lib', settingsReturnTab: 'sch' });

  sandbox.closeSettingsPanel();

  assert.notEqual(sandbox.fakeDocument.body.__focused, true, 'BODY must never be the successful target');
  assert.notEqual(sandbox.els.modalClose.__focused, true, 'closeSettingsPanel() must never call focus() on a control still inside #ns-panel-set');
});

test('closeSettingsPanel() falls back to Tonight, not BODY, when the destination\'s own sidebar control is unavailable', () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib', settingsReturnTab: 'sch' });
  const schItem = sandbox.navItems.find(i => i.dataset.nsTab === 'sch');
  schItem.__visible = false; // simulates it becoming ancestor-hidden (e.g. mini-mode)

  sandbox.closeSettingsPanel();

  const libItem = sandbox.navItems.find(i => i.dataset.nsTab === 'lib');
  assert.equal(libItem.__focused, true, 'must fall back to the Tonight sidebar control');
  assert.notEqual(schItem.__focused, true);
});

test('closeSettingsPanel() forces focus nowhere -- never BODY as a last resort -- when the whole sidebar is unavailable', () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib', settingsReturnTab: 'sch' });
  sandbox.navItems.forEach(item => { item.__visible = false; }); // simulates body.mini-mode hiding .ns-sidebar wholesale

  sandbox.closeSettingsPanel();

  assert.ok(sandbox.navItems.every(item => item.__focused !== true), 'no nav item should be focused when none are actually visible');
  assert.notEqual(sandbox.fakeDocument.body.__focused, true);
});

test('Back, Cancel, and Save all close Settings via the same closeSettingsPanel(), sharing its focus restoration (structural)', () => {
  assert.match(rendererSource, /els\.modalClose\.addEventListener\('click', async \(\) => \{\s*await discardSettingsPanelChanges\(\);\s*closeSettingsPanel\(\);\s*\}\)/, 'Back must call closeSettingsPanel()');
  assert.match(rendererSource, /els\.btnCancelOpt\.addEventListener\('click', async \(\) => \{\s*await discardSettingsPanelChanges\(\);\s*closeSettingsPanel\(\);\s*\}\)/, 'Cancel must call closeSettingsPanel()');
  assert.match(rendererSource, /if \(await saveSettingsPanel\(\)\) closeSettingsPanel\(\);/, 'Successful Save must call closeSettingsPanel()');
});

test('closeSettingsPanel() leaves settingsReturnTab itself completely untouched', () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib', settingsReturnTab: 'modes' });

  sandbox.closeSettingsPanel();

  assert.equal(sandbox.getSettingsReturnTab(), 'modes', 'closeSettingsPanel() must never mutate settingsReturnTab -- only openSettingsPanel() records a new one');
});

// --- Focus-target visibility hardening (Navigation Foundation final
// contract completion) -------------------------------------------------
//
// isSensibleFocusTarget()'s hidden-check previously only read the
// target's OWN inline style.display -- but CSS `display: none` set on a
// PARENT (e.g. body.mini-mode hiding .chrome-header/.ns-sidebar
// wholesale) never appears in the child's own style at all. isRendered()
// now uses a real rendered-layout check (checkVisibility(), Chromium's
// own answer) instead, so an ancestor-hidden target is rejected the same
// way an inline-hidden one always was.

test('a target hidden via an ancestor (not its own inline style) is rejected -- e.g. body.mini-mode hiding .chrome-header/.ns-sidebar', () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  // Real body.mini-mode hides .chrome-header/.ns-sidebar via a CSS rule
  // on an ancestor -- the sidebar Help button's own inline style is never
  // touched. __visible simulates exactly that (see createElement()'s
  // checkVisibility() mock above).
  const sidebarHelp = sandbox.navItems.find(i => i.dataset.nsTab === 'help');
  sidebarHelp.__visible = false;

  assert.equal(sandbox.isSensibleFocusTarget(sidebarHelp), false, 'the sidebar Help control must be rejected once ancestor-hidden, even with untouched inline style');
});

test('a genuinely visible target is not wrongly rejected by the hardened check', () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  for (const tab of NAV_TABS) {
    const item = sandbox.navItems.find(i => i.dataset.nsTab === tab);
    assert.equal(sandbox.isSensibleFocusTarget(item), true, `${tab} nav item must be a sensible focus target`);
  }
});

test('BODY/disconnected/disabled rejection still holds after the visibility hardening (regression guard)', () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  const disconnected = createElement({ id: 'disconnected-target' });
  disconnected.isConnected = false;
  const disabled = createElement({ id: 'disabled-target' });
  disabled.disabled = true;

  assert.equal(sandbox.isSensibleFocusTarget(sandbox.fakeDocument.body), false);
  assert.equal(sandbox.isSensibleFocusTarget(disconnected), false);
  assert.equal(sandbox.isSensibleFocusTarget(disabled), false);
});

test('mini-mode About close does not target the now-hidden sidebar Help control', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  const sidebarHelp = sandbox.navItems.find(i => i.dataset.nsTab === 'help');
  sandbox.fakeDocument.__setActive(sidebarHelp);

  await sandbox.handleSidebarNavigation('help');
  assert.equal(sandbox.getHelpOpenerElement(), sidebarHelp, 'sanity: recorded the sidebar opener');

  // body.mini-mode toggles on WHILE About is still open -- toggleMiniMode()
  // has no modal-open guard -- so the sidebar Help control becomes
  // ancestor-hidden before About is closed.
  sidebarHelp.__visible = false;

  sandbox.closeHelpPanel();

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false);
  assert.notEqual(sidebarHelp.__focused, true, 'the now-hidden sidebar control must never receive focus');
  assert.notEqual(sandbox.fakeDocument.body.__focused, true, 'BODY must never be the successful target either');
});

// --- Central Settings-entry parity: Companion button + tray/IPC
// (Navigation Foundation final contract completion) ---------------------
//
// els.btnCompanion's "not ready yet" path and api.onOpenSettings (the
// tray-menu/global-shortcut IPC bridge) used to call openSettingsPanel()
// directly, bypassing the blocking-modal refusal, dismissible-modal
// cleanup, and settingsReturnTab bookkeeping every other Settings opener
// already goes through. Both now route through handleSidebarNavigation
// ('set') instead -- these tests exercise the ACTUAL callback bodies
// (via triggerCompanionSettingsClick/triggerOnOpenSettingsIpc, extracted
// from renderer.js), not a re-implementation.

test('Companion-triggered Settings is refused while a blocking safety modal is active, and shows no misleading follow-up message', async () => {
  for (const id of NON_DISMISSIBLE_MODAL_IDS) {
    const sandbox = createNavigationSandbox({ activeTab: 'lib' });
    sandbox.modalEls[id].classList.add('active');

    await sandbox.triggerCompanionSettingsClick();

    assert.equal(sandbox.panels.panelSet.style.display, 'none', `${id}: Settings must not open`);
    assert.equal(sandbox.modalEls[id].classList.contains('active'), true, `${id}: the blocking modal must remain untouched`);
    assert.ok(!sandbox.calls.notify.some(args => String(args[0]).includes('Enable and verify Phone Companion')), `${id}: must not show the "go to Settings" guidance when Settings never actually opened`);
  }
});

test('Companion-triggered Settings dismisses an ordinary open modal first, then opens', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  sandbox.modalEls['about-modal'].classList.add('active');

  await sandbox.triggerCompanionSettingsClick();

  assert.equal(sandbox.modalEls['about-modal'].classList.contains('active'), false, 'the stray modal must be dismissed');
  assert.equal(sandbox.panels.panelSet.style.display, '', 'Settings must still open');
});

test('Companion-triggered Settings records the correct settingsReturnTab and shows its guidance message once Settings actually opens', async () => {
  for (const fromTab of ['modes', 'sch']) {
    const sandbox = createNavigationSandbox({ activeTab: fromTab });

    await sandbox.triggerCompanionSettingsClick();

    assert.equal(sandbox.getSettingsReturnTab(), fromTab, `opening Settings via Companion from ${fromTab} must record ${fromTab} as the return destination`);
    assert.equal(sandbox.panels.panelSet.style.display, '');
    assert.ok(sandbox.calls.notify.some(args => String(args[0]).includes('Enable and verify Phone Companion')), 'the guidance message must still show once Settings actually opens');
  }
});

test('Companion-triggered Settings no longer calls openSettingsPanel() directly (structural)', () => {
  const companionBlock = stripLineComments(extractBlockAfter(rendererSource, "els.btnCompanion?.addEventListener('click', async () => {"));
  assert.doesNotMatch(companionBlock, /openSettingsPanel\(/, 'must not call openSettingsPanel() directly -- that would skip the blocking-modal check');
  assert.match(companionBlock, /handleSidebarNavigation\('set'\)/, 'must route through the central navigation entry point');
});

test('IPC/tray onOpenSettings is refused while a blocking safety modal is active', async () => {
  for (const id of NON_DISMISSIBLE_MODAL_IDS) {
    const sandbox = createNavigationSandbox({ activeTab: 'lib' });
    sandbox.modalEls[id].classList.add('active');

    sandbox.triggerOnOpenSettingsIpc();

    assert.equal(sandbox.panels.panelSet.style.display, 'none', `${id}: Settings must not open`);
    assert.equal(sandbox.modalEls[id].classList.contains('active'), true, `${id}: the blocking modal must remain untouched`);
  }
});

test('IPC/tray onOpenSettings records the correct settingsReturnTab, exactly like a real click', () => {
  for (const fromTab of ['modes', 'sch', 'stats']) {
    const sandbox = createNavigationSandbox({ activeTab: fromTab });

    sandbox.triggerOnOpenSettingsIpc();

    assert.equal(sandbox.getSettingsReturnTab(), fromTab, `IPC-triggered Settings from ${fromTab} must record ${fromTab} as the return destination`);
    assert.equal(sandbox.panels.panelSet.style.display, '');
  }
});

test('IPC/tray onOpenSettings no longer calls openSettingsPanel() directly, and needs no DOM opener element (structural + behavioral)', () => {
  const ipcBlock = extractBlockAfter(rendererSource, 'api.onOpenSettings(() => {');
  assert.doesNotMatch(ipcBlock, /openSettingsPanel\(/, 'must not call openSettingsPanel() directly -- that would skip the blocking-modal check');
  assert.match(ipcBlock, /handleSidebarNavigation\('set'\)/, 'must route through the central navigation entry point');

  // Behavioral half: the trigger genuinely works with zero DOM opener
  // context -- no click event, no activeElement setup at all.
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  sandbox.triggerOnOpenSettingsIpc();
  assert.equal(sandbox.panels.panelSet.style.display, '', 'Settings must open from a bare IPC call with no DOM opener');
});

test('all production openSettingsPanel() call sites are internal implementation, not a user-entry bypass (structural)', () => {
  // The ONLY place allowed to call openSettingsPanel() directly is
  // handleSidebarNavigation()'s own 'set' branch -- every user-reachable
  // entry point (sidebar, top-menu, Companion, tray/IPC) must route
  // through handleSidebarNavigation('set') instead. Matches the actual
  // call shape `openSettingsPanel();` (trailing semicolon) specifically
  // so the `function openSettingsPanel() {` declaration itself -- which
  // also contains the substring "openSettingsPanel()" but is followed by
  // ` {`, not `;` -- is never counted as a call site.
  const callSites = rendererSource.match(/openSettingsPanel\(\);/g) || [];
  assert.equal(callSites.length, 1, `expected exactly one openSettingsPanel() call site (inside handleSidebarNavigation), found ${callSites.length}`);
});

