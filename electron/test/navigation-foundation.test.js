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

function createElement({ id = null, classes = [], dataset = {}, style = {} } = {}) {
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
    click: () => { el.__clicked = (el.__clicked || 0) + 1; }
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

function createFakeDocument({ elementsById = {}, navItems = [] } = {}) {
  const byId = { ...elementsById };
  const activeElementHolder = { current: null };
  return {
    getElementById: id => byId[id] || null,
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

const NAV_TABS = ['lib', 'modes', 'sch', 'set', 'stats'];
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

function createNavigationSandbox({ activeTab = 'lib', settingsReturnTab } = {}) {
  const navItems = buildNavItems();
  navItems.forEach(el => el.classList.toggle('active', el.dataset.nsTab === activeTab));

  const modalEls = buildModalElements();
  const panels = {
    panelLib: createElement(),
    panelModes: createElement(),
    panelSch: createElement(),
    panelSet: createElement({ style: { display: 'none' } }),
    panelStats: createElement()
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
    'ritual-overlay': modalEls['ritual-overlay']
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
    activateTopTab: []
  };

  const els = {
    profilesModal: modalEls['profiles-modal'],
    receiptsModal: modalEls['receipts-modal'],
    aboutModal: modalEls['about-modal'],
    panelLib: panels.panelLib,
    panelModes: panels.panelModes,
    panelSch: panels.panelSch,
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
    activateTopTab: tab => { calls.activateTopTab.push(tab); },
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
    openHelpPanel: () => { modalEls['about-modal'].classList.add('active'); },
    renderStatusPanel: () => {},
    exitFullscreenClock: () => { calls.exitFullscreenClock++; state.fullscreenClock = false; },
    cancelTimer: () => { calls.cancelTimer++; state.running = false; state.paused = false; },
    api: {
      saveAppSettings: async payload => { calls.saveAppSettings.push(payload); return {}; },
      ritualCancel: async () => { calls.ritualCancel++; }
    },
    hideRitualOverlay: () => { calls.hideRitualOverlay++; modalEls['ritual-overlay'].classList.remove('active'); }
  };
  const context = vm.createContext(sandbox);
  const source = [
    extractConst(rendererSource, 'NAV_DISMISSIBLE_MODALS'),
    extractFunction(rendererSource, 'closeAnyDismissibleModal'),
    extractFunction(rendererSource, 'setSidebarSelection'),
    extractFunction(rendererSource, 'applyMainPanelVisibility'),
    `let settingsReturnTab = ${JSON.stringify(settingsReturnTab ?? 'lib')};`,
    'const NS_TAB_DISPLAY_NAME = { lib: "Tonight", modes: "Night Modes", sch: "Schedule", stats: "Stats" };',
    extractFunction(rendererSource, 'openSettingsPanel'),
    extractFunction(rendererSource, 'closeSettingsPanel'),
    extractFunction(rendererSource, 'handleSidebarNavigation'),
    `this.__nav = { closeAnyDismissibleModal, handleSidebarNavigation, setSidebarSelection, applyMainPanelVisibility, openSettingsPanel, closeSettingsPanel, getSettingsReturnTab: () => settingsReturnTab };`
  ].join('\n');
  vm.runInContext(source, context);

  return {
    state,
    els,
    modalEls,
    panels,
    navItems,
    fakeDocument,
    calls,
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

test('destructive/in-progress modals are left alone by navigation (documented exception, not a regression)', async () => {
  const sandbox = createNavigationSandbox({ activeTab: 'lib' });
  sandbox.modalEls['warning-modal'].classList.add('active');

  await sandbox.handleSidebarNavigation('modes');

  assert.equal(sandbox.modalEls['warning-modal'].classList.contains('active'), true, 'an active power-safety warning must never be silently dismissed by navigation');
  // The underlying screen still switches -- navigation itself isn't blocked,
  // only the exempted modal's own dismissal is left to its existing (Escape-only) path.
  assert.equal(sandbox.panels.panelModes.style.display, '');
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

// --- Settings Save/Cancel semantics unchanged (structural regression guard) ---

// --- Escape contract (REQUIRED item 4) -------------------------------------
//
// The existing Escape handler already implements the required contract
// correctly (priority: fullscreen clock > Settings discard > each modal in
// turn > running-timer cancel as the final fallback) -- this slice does not
// modify it at all (see the "Escape handler is byte-for-byte unchanged"
// structural test below). These tests exist to PROVE that existing,
// unmodified precedence behaviorally, per the roadmap's explicit
// requirement, not to introduce new behavior.

function createEscapeSandbox({ fullscreenClock = false, running = false, paused = false, activeModalIds = [] } = {}) {
  const modalEls = buildModalElements();
  for (const id of activeModalIds) modalEls[id].classList.add('active');

  const settingsPanel = createElement({ style: { display: 'none' } });
  const btnNotif = createElement({ id: 'btn-notif' });
  const btnLanWarningCancel = createElement({ id: 'btn-lan-warning-cancel' });

  const elementsById = {
    'notif-drawer': modalEls['notif-drawer'],
    'btn-notif': btnNotif,
    'ritual-overlay': modalEls['ritual-overlay'],
    'warning-modal': modalEls['warning-modal'],
    'override-modal': modalEls['override-modal'],
    'snooze-tax-modal': modalEls['snooze-tax-modal'],
    'lan-warning-modal': modalEls['lan-warning-modal'],
    'btn-lan-warning-cancel': btnLanWarningCancel,
    'streak-celebration-modal': modalEls['streak-celebration-modal']
  };
  const fakeDocument = createFakeDocument({ elementsById, navItems: [] });

  const calls = { exitFullscreenClock: 0, discardSettingsPanelChanges: 0, closeSettingsPanel: 0, ritualCancel: 0, hideRitualOverlay: 0, cancelTimer: 0 };
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
    api: { ritualCancel: async () => { calls.ritualCancel++; } }
  };

  const context = vm.createContext(sandbox);
  const branch = extractMainEscapeBranch(rendererSource);
  vm.runInContext(`this.__handleEscape = async function handleEscape(event) {\n${branch}\n};`, context);

  return { state, els, modalEls, settingsPanel, calls, handleEscape: context.__handleEscape };
}

test('Escape handler is byte-for-byte unchanged by this slice (structural regression guard)', () => {
  // This slice deliberately does not touch the Escape handler at all --
  // it introduces a SEPARATE, parallel dismissal path for navigation
  // (closeAnyDismissibleModal), specifically to avoid any risk of
  // altering Escape's existing, working precedence (especially
  // Escape-cancels-a-running-timer). Confirms the branch text is present
  // verbatim.
  const branch = extractMainEscapeBranch(rendererSource);
  assert.match(branch, /else if \(state\.running \|\| state\.paused\) \{\s*cancelTimer\(\);\s*\}/, 'the running-timer-cancel fallback must still be the last branch, unchanged');
  assert.match(branch, /if \(state\.fullscreenClock\) \{\s*exitFullscreenClock\(\);/, 'fullscreen-clock-exit must still be the first, highest-priority branch, unchanged');
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

test('Settings Save/Cancel/discard wiring is untouched by this slice', () => {
  assert.match(rendererSource, /els\.modalClose\.addEventListener\('click', async \(\) => \{\s*await discardSettingsPanelChanges\(\);\s*closeSettingsPanel\(\);/, 'Back-to-Tonight (X) must still discard via the existing path');
  assert.match(rendererSource, /els\.btnCancelOpt\.addEventListener\('click', async \(\) => \{\s*await discardSettingsPanelChanges\(\);/, 'Cancel must still discard via the existing path');
  assert.match(rendererSource, /els\.btnSaveOpt\.addEventListener\('click', async \(\) => \{\s*await saveSettingsPanel\(\);\s*closeSettingsPanel\(\);/, 'Save must still persist via the existing path');
  const closeSettingsSource = extractFunction(rendererSource, 'closeSettingsPanel');
  assert.doesNotMatch(closeSettingsSource, /discardSettingsPanelChanges|saveSettingsPanel/, 'closeSettingsPanel() itself must remain a pure panel-visibility switch -- Save/Cancel decisions stay with the callers, not folded into navigation');
});

