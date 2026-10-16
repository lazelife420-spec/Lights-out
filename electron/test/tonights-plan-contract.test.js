'use strict';

// v11.2 explicit Tonight's Plan UX slice. renderer.js is a single shared-scope
// browser script (no modules), so -- same approach as
// ritual-overlay-visibility-contract.test.js for renderer-ritual-focus.js --
// this extracts the specific functions under test by source text and
// evaluates them in a minimal sandboxed context with mocked DOM/state,
// rather than attempting to execute the whole file (which bootstraps a real
// window/document on load).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererPath = path.join(__dirname, '..', 'renderer.js');
const rendererSource = fs.readFileSync(rendererPath, 'utf8');
const indexHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-utils.js'), 'utf8');

// The canonical action vocabulary, per profiles.js's validActions / nightModes.js
// -- not every action main.js's executePowerAction currently implements (lock
// is validated/storable but not yet executable; see the completion-pass note
// in v11.2-explicit-tonights-plan-ux-slice memory). This slice's job is
// "every valid state.action has a visible selection", independent of whether
// every action is fully wired end to end in main.js.
const CANONICAL_ACTIONS = ['sleep', 'shutdown', 'restart', 'hibernate', 'lock'];

// Balanced extraction of a top-level `function name(...) { ... }`
// declaration's exact source text. Two-stage balanced matching (parameter
// parens, then body braces) because parameter default values can themselves
// contain parens (e.g. `function startTimer(seconds = inputSeconds(), ...)`),
// which a single non-nested regex can't skip over correctly.
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

function createClassList() {
  const values = new Set();
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

function createElement(overrides = {}) {
  const attributes = new Map();
  return {
    style: { display: overrides.display ?? '' },
    classList: createClassList(),
    textContent: '',
    value: overrides.value,
    dataset: overrides.dataset || {},
    setAttribute: (n, v) => attributes.set(n, String(v)),
    getAttribute: n => attributes.get(n) ?? null
  };
}

// Builds a sandbox containing the real setAction/checkArmedModeMatch/
// checkProfileMatch/clearCurrentProfile/clearArmedNightMode/renderTonightHero/
// actionLabel/inputValue/inputSeconds/formatTime bodies from renderer.js,
// plus the minimal state/DOM/collaborator mocks they call out to. Every
// collaborator NOT under test (render, persistSelectedProfile, renderProfiles,
// persistArmedNightMode, renderArmedModeBanner, clamp) is a tracked no-op
// stub, so assertions can confirm they were (or weren't) called without
// depending on their real implementations.
function createTonightsPlanSandbox({ state, elsOverrides = {}, actionButtons = [] } = {}) {
  const calls = { render: 0, persistSelectedProfile: [], renderProfiles: 0, persistArmedNightMode: 0, renderArmedModeBanner: 0 };

  const elements = {
    'ns-hero-title': createElement(),
    'ns-preview-time': createElement(),
    'ns-play-label': createElement(),
    'ns-hero-source': createElement({ display: 'none' }),
    'ns-hero-source-name': createElement(),
    'ns-meta-ending': createElement(),
    ...(elsOverrides.elements || {})
  };

  const document = {
    getElementById: id => elements[id] || null,
    querySelectorAll: selector => {
      if (selector === '[data-action]' || selector === '#action-chips-row [data-action]') return actionButtons;
      return [];
    }
  };

  const els = {
    selAction: null,
    timerInput: createElement({ value: '28' }),
    scheduleCheck: null,
    scheduleTime: null,
    ...elsOverrides.els
  };

  const sandbox = {
    state,
    els,
    document,
    console,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    render: () => { calls.render++; },
    persistSelectedProfile: id => { calls.persistSelectedProfile.push(id); },
    renderProfiles: () => { calls.renderProfiles++; },
    persistArmedNightMode: () => { calls.persistArmedNightMode++; },
    renderArmedModeBanner: () => { calls.renderArmedModeBanner++; }
  };

  const context = vm.createContext(sandbox);
  const source = [
    // One name per session (UI-R3 Fire 02): the vocabulary lives in renderer-utils.js.
    (utilsSource.match(/const DEFAULT_TIMER_NAME = [^\n]*/) || [''])[0],
    extractFunction(utilsSource, 'sessionDisplayName'),
    extractFunction(rendererSource, 'formatTime'),
    extractFunction(rendererSource, 'inputValue'),
    extractFunction(rendererSource, 'inputSeconds'),
    extractFunction(rendererSource, 'actionLabel'),
    extractFunction(rendererSource, 'setAction'),
    extractFunction(rendererSource, 'clearArmedNightMode'),
    extractFunction(rendererSource, 'checkArmedModeMatch'),
    extractFunction(rendererSource, 'checkProfileMatch'),
    extractFunction(rendererSource, 'clearCurrentProfile'),
    extractFunction(rendererSource, 'renderTonightHero')
  ].join('\n');
  vm.runInContext(
    `${source}\nthis.__contract = { setAction, checkArmedModeMatch, checkProfileMatch, clearCurrentProfile, renderTonightHero, actionLabel, inputSeconds };`,
    context
  );

  return { elements, els, calls, ...context.__contract };
}

function baseState(overrides = {}) {
  return {
    action: 'shutdown',
    unit: 'min',
    armedNightMode: null,
    currentProfileId: null,
    profiles: [],
    ...overrides
  };
}

function actionButton(action) {
  const btn = createElement({ dataset: { action } });
  return btn;
}

test('manual action selection updates the canonical action state (not a parallel field)', () => {
  const state = baseState({ action: 'shutdown' });
  const sleepBtn = actionButton('sleep');
  const shutdownBtn = actionButton('shutdown');
  const { setAction } = createTonightsPlanSandbox({ state, actionButtons: [sleepBtn, shutdownBtn] });

  setAction('sleep');

  assert.equal(state.action, 'sleep');
  assert.equal(sleepBtn.classList.contains('selected'), true);
  assert.equal(shutdownBtn.classList.contains('selected'), false);
});

test('Tonight\'s Plan summary reflects a manual timer\'s duration and action', () => {
  const state = baseState({ action: 'sleep', unit: 'min' });
  const { elements, els, renderTonightHero } = createTonightsPlanSandbox({ state });
  els.timerInput.value = '45';

  renderTonightHero();

  assert.equal(elements['ns-hero-title'].textContent, 'Countdown · 45 min');
  assert.equal(elements['ns-preview-time'].textContent, '45:00');
  assert.equal(elements['ns-play-label'].textContent, 'Start countdown');
  assert.equal(elements['ns-hero-source'].style.display, 'none');
});

test('one name per session: a typed ring name names the plan; the stored default or nothing reads Countdown (Fire 02)', () => {
  const typed = createTonightsPlanSandbox({ state: baseState({ action: 'sleep', timerName: 'Reading' }) });
  typed.renderTonightHero();
  assert.equal(typed.elements['ns-hero-title'].textContent, 'Reading · 28 min');
  assert.equal(typed.elements['ns-play-label'].textContent, 'Start Reading');
  for (const timerName of ['Last Call', '', '   ', undefined]) {
    const plain = createTonightsPlanSandbox({ state: baseState({ action: 'sleep', timerName }) });
    plain.renderTonightHero();
    assert.equal(plain.elements['ns-hero-title'].textContent, 'Countdown · 28 min', String(timerName));
    assert.equal(plain.elements['ns-play-label'].textContent, 'Start countdown', String(timerName));
  }
  // An armed Night Mode or a loaded My Mode still wins over a typed name.
  const armed = createTonightsPlanSandbox({ state: baseState({ action: 'shutdown', timerName: 'Reading', armedNightMode: { nightModeId: 'wind', nightModeTitle: 'Wind Down', durationSeconds: 5400, action: 'shutdown' } }) });
  armed.renderTonightHero();
  assert.equal(armed.elements['ns-hero-title'].textContent, 'Wind Down · 90 min');
  assert.equal(armed.elements['ns-play-label'].textContent, 'Start Wind Down');
  const profile = { id: 'p1', name: 'Hard Stop', action: 'shutdown', mode: 'duration', seconds: 900 };
  const mode = createTonightsPlanSandbox({ state: baseState({ action: 'shutdown', timerName: 'Reading', currentProfileId: 'p1', profiles: [profile] }) });
  mode.els.timerInput.value = '15';
  mode.renderTonightHero();
  assert.equal(mode.elements['ns-hero-title'].textContent, 'Hard Stop · 15 min');
  assert.equal(mode.elements['ns-play-label'].textContent, 'Start Hard Stop');
});

test('loading a profile shows its name as the plan source ("From: <name>")', () => {
  const profile = { id: 'p1', name: 'Hard Stop', action: 'shutdown', mode: 'duration', seconds: 900 };
  const state = baseState({ action: 'shutdown', currentProfileId: 'p1', profiles: [profile] });
  const { elements, els, renderTonightHero } = createTonightsPlanSandbox({ state });
  els.timerInput.value = '15';

  renderTonightHero();

  assert.equal(elements['ns-hero-title'].textContent, 'Hard Stop · 15 min');
  assert.equal(elements['ns-hero-source'].style.display, '');
  assert.equal(elements['ns-hero-source-name'].textContent, 'Hard Stop');
});

test('manually editing action after a profile load clears the profile identity and reverts the plan to Custom', () => {
  const profile = { id: 'p1', name: 'Hard Stop', action: 'shutdown', mode: 'duration', seconds: 900 };
  const state = baseState({ action: 'shutdown', currentProfileId: 'p1', profiles: [profile] });
  const { elements, els, calls, setAction, renderTonightHero } = createTonightsPlanSandbox({
    state,
    actionButtons: [actionButton('sleep'), actionButton('shutdown')]
  });
  els.timerInput.value = '15';

  // Sanity: profile is credited before any edit.
  renderTonightHero();
  assert.equal(elements['ns-hero-source'].style.display, '');

  // setAction is the manual-action-selector's own entry point -- exercising
  // it here proves the selector's edit path, not just checkProfileMatch in
  // isolation.
  setAction('sleep');

  assert.equal(state.currentProfileId, null, 'profile identity must be cleared once action no longer matches');
  assert.deepEqual(calls.persistSelectedProfile, [null]);
  assert.equal(calls.renderProfiles, 1);

  renderTonightHero();
  assert.equal(elements['ns-hero-title'].textContent, 'Countdown · 15 min');
  assert.equal(elements['ns-hero-source'].style.display, 'none');
});

test('manually editing duration after a profile load also clears the profile identity', () => {
  const profile = { id: 'p1', name: 'Movie Night', action: 'sleep', mode: 'duration', seconds: 7200 };
  const state = baseState({ action: 'sleep', currentProfileId: 'p1', profiles: [profile] });
  const { els, checkProfileMatch, calls } = createTonightsPlanSandbox({ state });
  // Profile saved 7200s (120 min); simulate the user changing the lobby to 30 min.
  els.timerInput.value = '30';

  checkProfileMatch();

  assert.equal(state.currentProfileId, null, 'profile identity must be cleared once duration no longer matches');
  assert.equal(calls.renderProfiles, 1);
  assert.deepEqual(calls.persistSelectedProfile, [null]);
});

test('a matching, unedited profile is not cleared', () => {
  const profile = { id: 'p1', name: 'Hard Stop', action: 'shutdown', mode: 'duration', seconds: 900 };
  const state = baseState({ action: 'shutdown', currentProfileId: 'p1', profiles: [profile] });
  const { els, checkProfileMatch, calls } = createTonightsPlanSandbox({ state });
  els.timerInput.value = '15'; // 15 * 60 === profile.seconds

  checkProfileMatch();

  assert.equal(state.currentProfileId, 'p1');
  assert.equal(calls.renderProfiles, 0);
  assert.equal(calls.persistSelectedProfile.length, 0);
});

test('clock-mode profiles are compared by action only, never by a fixed duration', () => {
  const profile = { id: 'p1', name: 'Bedtime', action: 'sleep', mode: 'clock', clock: '23:00' };
  const state = baseState({ action: 'sleep', currentProfileId: 'p1', profiles: [profile] });
  const { checkProfileMatch, calls } = createTonightsPlanSandbox({ state });

  checkProfileMatch();

  assert.equal(state.currentProfileId, 'p1', 'clock-mode profile must not be cleared by an unrelated duration comparison');
  assert.equal(calls.renderProfiles, 0);
});

test('Night Modes continue showing their own correct plan, unaffected by profile-source logic', () => {
  const state = baseState({
    action: 'shutdown',
    armedNightMode: { nightModeId: 'movie', nightModeTitle: 'Movie Wind-Down', durationSeconds: 5400, action: 'sleep', ritualId: 'standard' },
    currentProfileId: 'p1', // even if a profile id lingers, armed Night Mode takes precedence
    profiles: [{ id: 'p1', name: 'Hard Stop', action: 'shutdown', mode: 'duration', seconds: 900 }]
  });
  const { elements, renderTonightHero } = createTonightsPlanSandbox({ state });

  renderTonightHero();

  assert.equal(elements['ns-hero-title'].textContent, 'Movie Wind-Down · 90 min');
  assert.equal(elements['ns-preview-time'].textContent, '1:30:00');
  assert.equal(elements['ns-play-label'].textContent, 'Start Movie Wind-Down');
  // Night Modes are credited by the existing armed-mode banner, not the
  // profile-source line -- showing both would be two competing labels.
  assert.equal(elements['ns-hero-source'].style.display, 'none');
});

// UI-R3 P03: the hero's one fact ("Ends with") is the action this plan really
// runs -- never the static 'Clearance: Clear' / 'Proof: Tomorrow morning'.
test('hero "Ends with" names the real action for a manual timer (sleep)', () => {
  const state = baseState({ action: 'sleep' });
  const { elements, renderTonightHero, actionLabel } = createTonightsPlanSandbox({ state });

  renderTonightHero();

  assert.ok(elements['ns-meta-ending'].textContent.startsWith(actionLabel('sleep')), elements['ns-meta-ending'].textContent);
  assert.equal(elements['ns-meta-ending'].textContent, 'Sleep');
});

test('hero "Ends with" names the loaded profile\'s action (Hard Stop, shutdown)', () => {
  const profile = { id: 'p1', name: 'Hard Stop', action: 'shutdown', mode: 'duration', seconds: 900 };
  const state = baseState({ action: 'shutdown', currentProfileId: 'p1', profiles: [profile] });
  const { elements, els, renderTonightHero, actionLabel } = createTonightsPlanSandbox({ state });
  els.timerInput.value = '15';

  renderTonightHero();

  assert.ok(elements['ns-meta-ending'].textContent.startsWith(actionLabel('shutdown')), elements['ns-meta-ending'].textContent);
});

test('hero "Ends with" follows an armed Night Mode\'s own action, not state.action', () => {
  const state = baseState({
    action: 'shutdown',
    armedNightMode: { nightModeId: 'movie', nightModeTitle: 'Movie Wind-Down', durationSeconds: 5400, action: 'sleep', ritualId: 'standard' }
  });
  const { elements, renderTonightHero, actionLabel } = createTonightsPlanSandbox({ state });

  renderTonightHero();

  assert.ok(elements['ns-meta-ending'].textContent.startsWith(actionLabel('sleep')), elements['ns-meta-ending'].textContent);
  assert.ok(!elements['ns-meta-ending'].textContent.startsWith(actionLabel('shutdown')));
});

test('hero "Ends with" adds the Last Light finale only when it is enabled', () => {
  const sequenceSelect = { selectedIndex: 1, options: [{ textContent: 'Classic Fade' }, { textContent: 'Exit the Grid' }] };
  const state = baseState({ action: 'shutdown', lastLight: { enabled: false, sequence: 'ExitTheGrid' } });
  const { elements, renderTonightHero } = createTonightsPlanSandbox({ state, elsOverrides: { elements: { 'sel-lastlight-sequence': sequenceSelect } } });

  renderTonightHero();
  assert.equal(elements['ns-meta-ending'].textContent, 'Shutdown');

  state.lastLight.enabled = true;
  renderTonightHero();
  assert.equal(elements['ns-meta-ending'].textContent, 'Shutdown · Exit the Grid');
});

test('the hero markup carries no fabricated plan facts', () => {
  assert.doesNotMatch(indexHtmlSource, /ns-meta-clearance|Tomorrow morning/);
  // UI-R3 P06: the plan facts are a <dl>; every value starts empty or as a
  // neutral placeholder and is written from state by the renderer.
  assert.match(indexHtmlSource, /<dd id="ns-meta-ending"><\/dd>/);
  assert.match(indexHtmlSource, /<dd id="plan-out-at">--:--<\/dd>/);
  assert.doesNotMatch(indexHtmlSource, /Clearance/);
});

test('renderTonightHero stays null-safe for the P06 plan ids it does not own', () => {
  // ns-hero-label, plan-out-at(-label) and ns-meta-reach are written by
  // render()/updateReadiness(), never by renderTonightHero; stubbing them here
  // proves the hero neither reads nor clobbers them.
  const extra = {
    'ns-hero-label': createElement(),
    'plan-out-at': createElement(),
    'plan-out-at-label': createElement(),
    'ns-meta-reach': createElement()
  };
  for (const el of Object.values(extra)) el.textContent = 'untouched';
  const state = baseState({ action: 'sleep' });
  const { elements, renderTonightHero } = createTonightsPlanSandbox({ state, elsOverrides: { elements: extra } });
  renderTonightHero();
  assert.equal(elements['ns-hero-title'].textContent, 'Countdown · 28 min');
  assert.equal(elements['ns-preview-time'].textContent, '28:00');
  assert.equal(elements['ns-play-label'].textContent, 'Start countdown');
  for (const id of Object.keys(extra)) assert.equal(elements[id].textContent, 'untouched', id);
  // ...and with none of them present (getElementById returns null) it still renders.
  const bare = createTonightsPlanSandbox({ state: baseState({ action: 'shutdown' }) });
  bare.renderTonightHero();
  assert.equal(bare.elements['ns-meta-ending'].textContent, 'Shutdown');
});

test('editing the action while a Night Mode is armed and it no longer matches clears the armed mode (existing contract, unchanged)', () => {
  const state = baseState({
    action: 'sleep',
    armedNightMode: { nightModeId: 'movie', nightModeTitle: 'Movie Wind-Down', durationSeconds: 5400, action: 'sleep', ritualId: 'standard' }
  });
  const { setAction, calls } = createTonightsPlanSandbox({ state, actionButtons: [actionButton('shutdown')] });

  setAction('shutdown');

  assert.equal(state.armedNightMode, null);
  assert.equal(calls.renderArmedModeBanner, 1);
  assert.equal(calls.persistArmedNightMode, 1);
});

test('no regression to Dry Run / power-safety fields: the new functions never read or write them', () => {
  const contractSource = [
    extractFunction(rendererSource, 'setAction'),
    extractFunction(rendererSource, 'checkProfileMatch'),
    extractFunction(rendererSource, 'clearCurrentProfile'),
    extractFunction(rendererSource, 'renderTonightHero')
  ].join('\n');
  assert.doesNotMatch(contractSource, /dryRun|forceShutdown|muteSystem/);
});

test('Start reads exactly the same state.action / inputSeconds() the visible plan is built from -- no competing state model', () => {
  const startTimerSource = extractFunction(rendererSource, 'startTimer');
  assert.match(startTimerSource, /action:\s*state\.action/);
  assert.match(startTimerSource, /dryRun:\s*state\.dryRun/, 'dry run must still be sent unchanged');
  assert.match(startTimerSource, /forceShutdown:\s*state\.forceShutdown/, 'force-shutdown must still be sent unchanged');
  // startTonightPlan (the hero CTA / Space-key / "play again" shared entry
  // point) must call startTimer with inputSeconds() -- the exact value
  // renderTonightHero() uses to build the visible plan -- not a second,
  // independently-tracked duration.
  const startTonightPlanSource = extractFunction(rendererSource, 'startTonightPlan');
  assert.match(startTonightPlanSource, /startTimer\(inputSeconds\(\)/);
});

// --- Action-parity completion pass: Lock must be a first-class citizen of
// the manual action selector, not a silently-executable-but-unpickable
// canonical action. ---------------------------------------------------------

test('every canonical action has a visible manual selector chip, and a real (non-fallback) label', () => {
  const chipsRowMatch = indexHtmlSource.match(/<div class="action-chips-row"[\s\S]*?<\/div>/);
  assert.ok(chipsRowMatch, 'action-chips-row markup must exist in index.html');
  const chipsRowHtml = chipsRowMatch[0];

  for (const action of CANONICAL_ACTIONS) {
    assert.match(
      chipsRowHtml,
      new RegExp(`data-action="${action}"`),
      `manual action selector is missing a chip for canonical action "${action}"`
    );
  }

  const { actionLabel } = createTonightsPlanSandbox({ state: baseState() });
  for (const action of CANONICAL_ACTIONS) {
    assert.notEqual(
      actionLabel(action),
      'Power action',
      `actionLabel() has no real label for canonical action "${action}" -- it would render the generic fallback`
    );
  }
});

test('selecting Lock updates the canonical action state exactly like any other action', () => {
  const state = baseState({ action: 'shutdown' });
  const lockBtn = actionButton('lock');
  const shutdownBtn = actionButton('shutdown');
  const { setAction } = createTonightsPlanSandbox({ state, actionButtons: [lockBtn, shutdownBtn] });

  setAction('lock');

  assert.equal(state.action, 'lock');
  assert.equal(lockBtn.classList.contains('selected'), true);
  assert.equal(shutdownBtn.classList.contains('selected'), false);
});

test('manual Lock plan summary renders in Tonight\'s Plan exactly like any other action', () => {
  const state = baseState({ action: 'lock', unit: 'min' });
  const { elements, els, renderTonightHero } = createTonightsPlanSandbox({ state });
  els.timerInput.value = '20';

  renderTonightHero();

  assert.equal(elements['ns-hero-title'].textContent, 'Countdown · 20 min');
  assert.equal(elements['ns-play-label'].textContent, 'Start countdown');
});

test('a Lock profile shows its source, and manually editing away from it clears to Custom -- same matching rules as any other action', () => {
  const profile = { id: 'p1', name: 'Quick Lock', action: 'lock', mode: 'duration', seconds: 300 };
  const state = baseState({ action: 'lock', currentProfileId: 'p1', profiles: [profile] });
  const { elements, els, calls, setAction, renderTonightHero } = createTonightsPlanSandbox({
    state,
    actionButtons: [actionButton('lock'), actionButton('shutdown')]
  });
  els.timerInput.value = '5';

  renderTonightHero();
  assert.equal(elements['ns-hero-source'].style.display, '');
  assert.equal(elements['ns-hero-source-name'].textContent, 'Quick Lock');
  assert.equal(elements['ns-hero-title'].textContent, 'Quick Lock · 5 min');

  setAction('shutdown');

  assert.equal(state.currentProfileId, null, 'profile identity must clear once the action no longer matches the loaded Lock profile');
  assert.deepEqual(calls.persistSelectedProfile, [null]);

  renderTonightHero();
  assert.equal(elements['ns-hero-title'].textContent, 'Countdown · 5 min');
  assert.equal(elements['ns-hero-source'].style.display, 'none');
});

test('Start executes the same canonical action Tonight\'s Plan displays when Lock is selected -- no hidden mismatch', () => {
  const state = baseState({ action: 'lock', unit: 'min' });
  const { elements, els, renderTonightHero } = createTonightsPlanSandbox({ state });
  els.timerInput.value = '10';

  renderTonightHero();
  assert.equal(elements['ns-hero-title'].textContent, 'Countdown · 10 min');

  // startTimer (Start's shared entry point, generic across every action)
  // sends `action: state.action` verbatim -- with state.action === 'lock'
  // here, that's exactly the action the hero just displayed. Re-asserted
  // per-action (rather than relying solely on the generic contract test
  // above) because this is the literal claim the parity pass exists to
  // guarantee: whatever Tonight's Plan shows is what Start executes.
  const startTimerSource = extractFunction(rendererSource, 'startTimer');
  assert.match(startTimerSource, /action:\s*state\.action/);
});

// --- Remediation pass: clock-mode profile attribution must be truthful --
// it survives passive re-renders untouched, but a manual duration edit
// always clears it (never by recomputing/comparing a clock target; see
// checkProfileMatch's durationEdited parameter and its comment in
// renderer.js). ------------------------------------------------------------

function clockProfile(overrides = {}) {
  return { id: 'clock-1', name: 'Bedtime Lock', action: 'lock', mode: 'clock', clock: '23:00', seconds: 1800, ...overrides };
}

test('a loaded clock-mode profile stays attributed across passive re-renders (no user edit)', () => {
  const profile = clockProfile();
  const state = baseState({ action: 'lock', currentProfileId: 'clock-1', profiles: [profile] });
  const { elements, checkProfileMatch, renderTonightHero } = createTonightsPlanSandbox({ state });

  // Simulate several passive passes -- none represent a user edit, so none
  // pass durationEdited=true. Loading + rendering alone must never clear it.
  checkProfileMatch();
  renderTonightHero();
  checkProfileMatch();
  renderTonightHero();

  assert.equal(state.currentProfileId, 'clock-1', 'passively re-rendering must never clear a clock-mode profile the user has not touched');
  assert.equal(elements['ns-hero-source'].style.display, '');
  assert.equal(elements['ns-hero-source-name'].textContent, 'Bedtime Lock');
});

test('a typed duration edit clears a loaded clock-mode profile', () => {
  const profile = clockProfile();
  const state = baseState({ action: 'lock', currentProfileId: 'clock-1', profiles: [profile] });
  const { els, calls, checkProfileMatch, elements, renderTonightHero } = createTonightsPlanSandbox({ state });
  renderTonightHero();
  assert.equal(elements['ns-hero-source'].style.display, '', 'sanity: profile credited before the edit');

  // Mirrors renderer.js's timerInput 'input' handler, which now calls
  // checkProfileMatch(true) after a typed edit.
  els.timerInput.value = '5';
  checkProfileMatch(true);

  assert.equal(state.currentProfileId, null, 'a manual duration edit must clear a clock-mode profile even though it has no comparable stored duration');
  assert.deepEqual(calls.persistSelectedProfile, [null]);
});

test('a +/- duration edit clears a loaded clock-mode profile', () => {
  const profile = clockProfile();
  const state = baseState({ action: 'lock', currentProfileId: 'clock-1', profiles: [profile] });
  const { checkProfileMatch } = createTonightsPlanSandbox({ state });

  checkProfileMatch(true); // mirrors btnPlus/btnMinus's checkProfileMatch(true) call

  assert.equal(state.currentProfileId, null);
});

test('a unit change (min <-> sec) clears a loaded clock-mode profile, same as any other duration mutation', () => {
  const profile = clockProfile();
  const state = baseState({ action: 'lock', currentProfileId: 'clock-1', profiles: [profile], unit: 'min' });
  const { checkProfileMatch } = createTonightsPlanSandbox({ state });

  state.unit = 'sec'; // mirrors the .unit-btn click handler mutating state.unit
  checkProfileMatch(true); // mirrors that handler's new checkProfileMatch(true) call

  assert.equal(state.currentProfileId, null, 'unit changes are a manual duration mutation and must clear clock-mode profiles too');
});

test('a manual duration edit clears a clock-mode profile even if the new value numerically coincides with profile.seconds', () => {
  // The specific failure mode being guarded against: comparing against a
  // recomputed/stored duration would let a coincidental numeric match save
  // a profile the user has explicitly left. A manual edit always clears a
  // clock-mode profile, regardless of the resulting number.
  const profile = clockProfile({ seconds: 1800 });
  const state = baseState({ action: 'lock', currentProfileId: 'clock-1', profiles: [profile] });
  const { els, checkProfileMatch } = createTonightsPlanSandbox({ state });
  els.timerInput.value = '30'; // 30 min === 1800s == profile.seconds

  checkProfileMatch(true);

  assert.equal(state.currentProfileId, null, 'a manual duration edit must clear a clock-mode profile regardless of any numeric coincidence with profile.seconds');
});

test('action mismatch still clears a clock-mode profile (unaffected by the durationEdited parameter)', () => {
  const profile = clockProfile({ action: 'lock' });
  const state = baseState({ action: 'sleep', currentProfileId: 'clock-1', profiles: [profile] }); // action already diverged from the profile
  const { checkProfileMatch } = createTonightsPlanSandbox({ state });

  checkProfileMatch(); // default false -- action mismatch must still be caught up front, before the clock-mode branch

  assert.equal(state.currentProfileId, null);
});

test('duration-mode profile matching is unchanged: durationEdited=true does not force-clear a still-matching duration-mode profile', () => {
  const profile = { id: 'p1', name: 'Hard Stop', action: 'shutdown', mode: 'duration', seconds: 900 };
  const state = baseState({ action: 'shutdown', currentProfileId: 'p1', profiles: [profile] });
  const { els, checkProfileMatch } = createTonightsPlanSandbox({ state });
  els.timerInput.value = '15'; // 15 * 60 === profile.seconds -- genuinely unchanged

  checkProfileMatch(true); // even flagged as a duration edit, an unchanged duration-mode profile must not be force-cleared

  assert.equal(state.currentProfileId, 'p1', 'durationEdited must only affect clock-mode profiles -- duration-mode profiles keep their existing numeric comparison');
});

test('the manual duration-edit event handlers (+, -, typed input, unit toggle) all call checkProfileMatch(true) in renderer.js', () => {
  // Structural check, not a full DOM harness: extractFunction only pulls
  // named top-level functions, and these are anonymous click/input
  // listeners registered inline. The live CDP walkthrough exercises the
  // real wiring end to end; this locks down that each handler actually
  // passes durationEdited=true, matching the semantic checkProfileMatch()
  // itself expects for a genuine manual duration mutation.
  const plusHandler = rendererSource.match(/els\.btnPlus\.addEventListener\('click', \(\) => \{[\s\S]*?\}\);/);
  assert.ok(plusHandler, 'els.btnPlus click handler not found');
  assert.match(plusHandler[0], /checkProfileMatch\(true\)/, 'btnPlus click handler must call checkProfileMatch(true)');

  const minusHandler = rendererSource.match(/els\.btnMinus\.addEventListener\('click', \(\) => \{[\s\S]*?\}\);/);
  assert.ok(minusHandler, 'els.btnMinus click handler not found');
  assert.match(minusHandler[0], /checkProfileMatch\(true\)/, 'btnMinus click handler must call checkProfileMatch(true)');

  const timerInputHandler = rendererSource.match(/els\.timerInput\.addEventListener\('input', \(\) => \{[\s\S]*?\}\);/);
  assert.ok(timerInputHandler, 'timerInput input handler not found');
  assert.match(timerInputHandler[0], /checkProfileMatch\(true\)/, 'timerInput input handler must call checkProfileMatch(true)');

  // There are two '.unit-btn' querySelectorAll blocks in renderer.js: a
  // display-sync loop inside render() (toggles .active, no listener) and
  // the actual click-handler wiring below it -- anchor on
  // addEventListener('click' to match the latter specifically.
  const unitBtnHandler = rendererSource.match(/document\.querySelectorAll\('\.unit-btn'\)\.forEach\(btn => \{\s*btn\.addEventListener\('click', \(\) => \{[\s\S]*?\}\);\s*\}\);/);
  assert.ok(unitBtnHandler, 'unit-btn click handler not found');
  assert.match(unitBtnHandler[0], /checkProfileMatch\(true\)/, 'unit-btn click handler must call checkProfileMatch(true)');
});

// --- Remediation pass: action-chip accessibility. aria-pressed must be
// derived from the exact same isSelected value as the visual .selected
// class, in the same pass, so the two can never diverge. -------------------

test('exactly one action chip has aria-pressed="true" for each canonical action', () => {
  for (const action of CANONICAL_ACTIONS) {
    const state = baseState({ action });
    const buttons = CANONICAL_ACTIONS.map(a => actionButton(a));
    const { renderTonightHero } = createTonightsPlanSandbox({ state, actionButtons: buttons });

    renderTonightHero();

    const pressed = buttons.filter(b => b.getAttribute('aria-pressed') === 'true');
    assert.equal(pressed.length, 1, `exactly one chip should be aria-pressed="true" for action "${action}"`);
    assert.equal(pressed[0].dataset.action, action);
    for (const btn of buttons) {
      const shouldBePressed = btn.dataset.action === action;
      assert.equal(btn.getAttribute('aria-pressed'), String(shouldBePressed), 'aria-pressed must be an explicit "true"/"false" string, never absent');
      assert.equal(btn.classList.contains('selected'), shouldBePressed, 'aria-pressed and .selected must never diverge');
    }
  }
});

test('state changes update both the visual .selected class and aria-pressed together', () => {
  const state = baseState({ action: 'shutdown' });
  const sleepBtn = actionButton('sleep');
  const shutdownBtn = actionButton('shutdown');
  const { setAction, renderTonightHero } = createTonightsPlanSandbox({ state, actionButtons: [sleepBtn, shutdownBtn] });

  // renderTonightHero() is called explicitly here because this sandbox's
  // render() is a call-counting stub (not the real render()), same as
  // every other test in this file that exercises setAction() -- it mirrors
  // setAction()'s own render() call, which in the real app is what chains
  // into renderTonightHero() and sets aria-pressed.
  setAction('sleep');
  renderTonightHero();
  assert.equal(sleepBtn.classList.contains('selected'), true);
  assert.equal(sleepBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(shutdownBtn.classList.contains('selected'), false);
  assert.equal(shutdownBtn.getAttribute('aria-pressed'), 'false');

  setAction('shutdown');
  renderTonightHero();
  assert.equal(sleepBtn.classList.contains('selected'), false);
  assert.equal(sleepBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(shutdownBtn.classList.contains('selected'), true);
  assert.equal(shutdownBtn.getAttribute('aria-pressed'), 'true');
});

test('Lock behaves identically to the other four actions for aria-pressed', () => {
  const state = baseState({ action: 'lock' });
  const lockBtn = actionButton('lock');
  const otherButtons = ['sleep', 'shutdown', 'restart', 'hibernate'].map(a => actionButton(a));
  const { renderTonightHero } = createTonightsPlanSandbox({ state, actionButtons: [lockBtn, ...otherButtons] });

  renderTonightHero();

  assert.equal(lockBtn.getAttribute('aria-pressed'), 'true');
  for (const btn of otherButtons) {
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
  }
});
