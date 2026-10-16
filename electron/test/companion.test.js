// Unit tests for the companion WebSocket handshake.
//
// Regression guard for the Sec-WebSocket-Accept computation: a wrong RFC 6455
// magic GUID produces an accept value that strict clients (every real browser,
// the `ws` library) reject, so the phone PWA connects at the TCP level but the
// browser aborts the handshake (close code 1006) and live timer state never
// arrives. Lenient test clients don't validate the accept, so only a check
// against the known-correct RFC example catches this.
//
// Run with: node --test  (or npm test)

const { test } = require('node:test');
const assert = require('node:assert/strict');

// companion.js loads only Node core + ./remoteControl at module scope, so it
// imports cleanly under plain node without Electron.
const companion = require('../companion');

test('computeAccept matches the canonical RFC 6455 example', () => {
  // RFC 6455 §1.3: key "dGhlIHNhbXBsZSBub25jZQ==" must yield this accept.
  assert.equal(
    companion.computeAccept('dGhlIHNhbXBsZSBub25jZQ=='),
    's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
  );
});

test('computeAccept is deterministic and base64-shaped', () => {
  const a = companion.computeAccept('AQIDBAUGBwgJCgsMDQ4PEC==');
  const b = companion.computeAccept('AQIDBAUGBwgJCgsMDQ4PEC==');
  assert.equal(a, b);
  // SHA-1 digest base64-encoded is always 28 chars ending in '='.
  assert.match(a, /^[A-Za-z0-9+/]{27}=$/);
});

test('computeAccept changes with the key', () => {
  assert.notEqual(
    companion.computeAccept('dGhlIHNhbXBsZSBub25jZQ=='),
    companion.computeAccept('x3JJHMbDL1EzLkh9GBhXDw==')
  );
});

test('pair-check distinguishes a valid token from missing or expired pairing', () => {
  assert.equal(companion.pairCheckStatus('current-token', 'current-token'), 204);
  assert.equal(companion.pairCheckStatus('old-token', 'current-token'), 403);
  assert.equal(companion.pairCheckStatus('', 'current-token'), 403);
  assert.equal(companion.pairCheckStatus('current-token', ''), 401);
});

// Failed-pairing-attempt visibility: purely informational (see the comment
// above recordFailedAttempt in companion.js for why this is not a lockout).
// Tests use relative deltas rather than absolute counts since the counter
// only resets on start() (which needs a real bound port), so module state
// may carry over between test files/runs.

test('recordFailedAttempt increments the counter and records the source IP', () => {
  const before = companion.getStatus().failedAttempts;
  companion.recordFailedAttempt({ remoteAddress: '192.168.1.50' });
  const after = companion.getStatus();
  assert.equal(after.failedAttempts, before + 1);
  assert.equal(after.lastFailedIp, '192.168.1.50');
});

test('recordFailedAttempt strips the IPv4-mapped IPv6 prefix from the source address', () => {
  companion.recordFailedAttempt({ remoteAddress: '::ffff:10.0.0.5' });
  assert.equal(companion.getStatus().lastFailedIp, '10.0.0.5');
});

test('recordFailedAttempt tolerates a missing remoteAddress', () => {
  const before = companion.getStatus().failedAttempts;
  companion.recordFailedAttempt({});
  const after = companion.getStatus();
  assert.equal(after.failedAttempts, before + 1);
  assert.equal(after.lastFailedIp, '');
});

// ── UI-R3 P09: phone page contracts (companion.html), run against the real
// page source. Functions are lifted into a vm sandbox with fake elements, so
// no browser, Electron or network is involved.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const companionHtml = fs.readFileSync(path.join(__dirname, '..', 'companion.html'), 'utf8');
const desktopNightModes = fs.readFileSync(path.join(__dirname, '..', 'renderer-night-modes.js'), 'utf8');

function liftFunction(source, name) {
  const head = source.match(new RegExp(`function ${name}\\s*\\(`));
  if (!head) throw new Error(`function ${name} not found`);
  let i = source.indexOf('{', head.index + head[0].length);
  let depth = 0;
  const start = head.index;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

function fakeButton(action) {
  const classes = new Set();
  const attrs = {};
  return {
    dataset: { action },
    classList: { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
    setAttribute: (name, value) => { attrs[name] = String(value); },
    getAttribute: name => attrs[name]
  };
}

test('P09: the phone viewport allows pinch-zoom and covers notched screens', () => {
  const meta = companionHtml.match(/<meta name="viewport" content="([^"]+)">/);
  assert.ok(meta, 'viewport meta missing');
  assert.doesNotMatch(meta[1], /user-scalable\s*=\s*no|maximum-scale/);
  assert.match(meta[1], /viewport-fit=cover/);
});

test('P09: the #action-seg default (shutdown) is pressed in markup', () => {
  const buttons = companionHtml.match(/<button class="seg-btn[^"]*" data-action="(\w+)"[^>]*>/g) || [];
  assert.equal(buttons.length, 3);
  const pressed = buttons.filter(b => /aria-pressed="true"/.test(b));
  assert.equal(pressed.length, 1);
  assert.match(pressed[0], /class="seg-btn active" data-action="shutdown"/);
  assert.ok(buttons.every(b => /aria-pressed="(true|false)"/.test(b)));
});

test('P09: setSelectedAction keeps .active and aria-pressed together', () => {
  const buttons = ['sleep', 'shutdown', 'restart'].map(fakeButton);
  const sandbox = { actionSeg: { querySelectorAll: () => buttons }, selectedAction: 'shutdown' };
  vm.createContext(sandbox);
  vm.runInContext(`${liftFunction(companionHtml, 'setSelectedAction')}; this.setSelectedAction = setSelectedAction;`, sandbox);
  for (const action of ['restart', 'sleep', 'shutdown']) {
    sandbox.setSelectedAction(action);
    assert.equal(sandbox.selectedAction, action);
    for (const b of buttons) {
      const on = b.dataset.action === action;
      assert.equal(b.classList.contains('active'), on);
      assert.equal(b.getAttribute('aria-pressed'), String(on));
    }
  }
});

test('P09: Night Mode status labels match on phone and desktop, never the reason', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${liftFunction(companionHtml, 'getNmStatusLabel')}; ${liftFunction(desktopNightModes, 'getStatusTagHtml')};
    this.phone = getNmStatusLabel; this.desktop = getStatusTagHtml;`, sandbox);
  const expected = { coming_soon: 'Coming later', needs_router_setup: 'Needs router control', needs_device_setup: 'Needs device setup', unsupported: 'Unavailable' };
  for (const [status, label] of Object.entries(expected)) {
    assert.equal(sandbox.phone(status), label);
    assert.equal(sandbox.desktop(status).replace(/<[^>]+>/g, ''), label);
  }
  assert.equal(sandbox.desktop('ready'), '');
});

test('P09: --lights-level is clamped to [.25, 1] from real numbers, NaN -> 1', () => {
  const props = {};
  const bodyClasses = new Set();
  const sandbox = {
    document: {
      body: { classList: { toggle: (n, on) => { if (on) bodyClasses.add(n); else bodyClasses.delete(n); } } },
      documentElement: { style: { setProperty: (k, v) => { props[k] = v; } } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${liftFunction(companionHtml, 'applyRunClasses')}; this.apply = applyRunClasses;`, sandbox);
  sandbox.apply(true, false, 'dim', 0.1);
  assert.equal(props['--lights-level'], '0.250');
  assert.ok(bodyClasses.has('is-running') && bodyClasses.has('phase-dim') && !bodyClasses.has('is-paused'));
  sandbox.apply(true, true, 'dim', 0.6);
  assert.equal(props['--lights-level'], '0.600');
  assert.ok(bodyClasses.has('is-paused') && !bodyClasses.has('is-running') && !bodyClasses.has('phase-dim'));
  sandbox.apply(true, false, 'focus', NaN);
  assert.equal(props['--lights-level'], '1.000');
});

test('P09: "last seen" ages read 12s ago / 3 min ago and never go negative', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${liftFunction(companionHtml, 'formatSeenAge')}; this.age = formatSeenAge;`, sandbox);
  assert.equal(sandbox.age(12000), '12s ago');
  assert.equal(sandbox.age(3 * 60000 + 5000), '3 min ago');
  assert.equal(sandbox.age(-5000), '0s ago');
});

test('P09 fix: the ticking last-seen age never rewrites the polite live text', () => {
  function span() {
    let text = '';
    const node = { parentNode: null, writes: 0 };
    Object.defineProperty(node, 'textContent', { get: () => text, set: (v) => { text = String(v); node.writes++; } });
    return node;
  }
  const freshnessText = span();
  const freshnessAge = span();
  const freshnessEl = { replaceChildren(...kids) { for (const k of kids) k.parentNode = freshnessEl; } };
  const sandbox = { freshnessText, freshnessAge, freshnessEl };
  vm.createContext(sandbox);
  vm.runInContext(`${liftFunction(companionHtml, 'setFreshness')}; this.set = setFreshness;`, sandbox);
  sandbox.set('State may be stale', ' · last seen 12s ago');
  sandbox.set('State may be stale', ' · last seen 13s ago');
  sandbox.set('State may be stale', ' · last seen 14s ago');
  assert.equal(freshnessText.textContent, 'State may be stale');
  assert.equal(freshnessText.writes, 1, 'the live-region text is written once while only the age ticks');
  assert.equal(freshnessAge.textContent, ' · last seen 14s ago');
  sandbox.set('Updated just now');
  assert.equal(freshnessText.textContent, 'Updated just now');
  assert.equal(freshnessAge.textContent, '');
  assert.match(companionHtml, /freshnessAge\.setAttribute\('aria-hidden', 'true'\);/);
});

// ── UI-R3 Fire 05: the phone run, lifted from the real page into a vm
// sandbox (no browser, Electron or network).
function liftConst(source, name) {
  const m = source.match(new RegExp(`const ${name} = (\\{[^}]*\\}|[^;]+);`));
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}
function fire05Words() {
  return ['ACTION_NOUN', 'ACTION_VERB', 'DEFAULT_TIMER_NAME', 'OUTCOME_MAX_MS'].map(n => liftConst(companionHtml, n)).join('\n')
    + `\n${liftFunction(companionHtml, 'actionWords')}`;
}

test('Fire 05: ringPhaseKey never paints a Test Mode Last Light red', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${liftConst(companionHtml, 'PHASE_COLORS')}; ${liftFunction(companionHtml, 'ringPhaseKey')}; this.key = ringPhaseKey; this.colors = PHASE_COLORS;`, sandbox);
  const { key, colors } = sandbox;
  assert.equal(key(true, true, 'lastlight', false), 'paused');
  assert.equal(key(true, true, 'dim', true), 'paused');
  assert.equal(key(true, false, 'lastlight', true), 'lastlight-test');
  assert.equal(key(true, false, 'lastlight', undefined), 'lastlight-test');
  assert.equal(key(true, false, 'lastlight', false), 'lastlight');
  assert.equal(key(true, false, 'dim', false), 'dim');
  assert.equal(key(true, false, 'focus', true), 'focus');
  assert.equal(key(false, false, 'focus', false), 'idle');
  assert.equal(key(true, false, undefined, false), 'idle');
  assert.equal(colors['lastlight-test'], '#f5b83d');
  assert.equal(colors.paused, '#f5b83d');
  assert.equal(colors.lastlight, '#ff5c7a');
  assert.notEqual(colors.dim, '#f5b83d', 'winding down is violet-dimmed, never amber');
});

test('Fire 05: phoneSessionTitle names a run like the desktop (Night Mode, typed name, else Countdown)', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${fire05Words()}; ${liftFunction(companionHtml, 'phoneSessionTitle')}; this.title = phoneSessionTitle;`, sandbox);
  assert.equal(sandbox.title({ nightModeTitle: 'Quick Sleep', timerName: 'Reading' }), 'Quick Sleep');
  assert.equal(sandbox.title({ nightModeTitle: null, timerName: 'Last Call' }), 'Countdown');
  assert.equal(sandbox.title({ nightModeTitle: '', timerName: '' }), 'Countdown');
  assert.equal(sandbox.title({ timerName: '  Reading ' }), 'Reading');
  assert.equal(sandbox.title(null), 'Countdown');
  assert.doesNotMatch(companionHtml, /Custom Timer/);
});

test('Fire 05: the ring label states the consequence from the run\'s own dryRun', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${fire05Words()}; ${liftFunction(companionHtml, 'phoneRingLabel')}; this.label = phoneRingLabel;`, sandbox);
  const { label } = sandbox;
  assert.equal(label(true, false, true, 'shutdown'), 'Test · no shutdown');
  assert.equal(label(true, false, true, 'logout'), 'Test · no log out');
  assert.equal(label(true, false, false, 'shutdown'), 'then shut down');
  assert.equal(label(true, false, false, 'sleep'), 'then sleep');
  assert.equal(label(true, false, undefined, 'shutdown'), 'until end');
  assert.equal(label(true, true, false, 'shutdown'), 'Paused');
  assert.equal(label(false, false, false, 'shutdown'), 'Idle');
  // A missing or hostile action never throws and never becomes a word.
  assert.doesNotThrow(() => label(true, false, true, undefined));
  assert.equal(label(true, false, true, undefined), 'Test · no power action');
  assert.equal(label(true, false, true, 'constructor'), 'Test · no power action');
  assert.equal(label(true, false, false, null), 'until end');
  assert.equal(label(true, false, false, 42), 'until end');
});

test('Fire 05: the phase line shows only winding down and Last Light, red only when REAL', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${liftFunction(companionHtml, 'phoneRunPhase')}; this.phase = phoneRunPhase;`, sandbox);
  const { phase } = sandbox;
  assert.equal(phase(true, false, false, 'focus', false), null);
  assert.deepEqual({ ...phase(true, false, false, 'dim', true) }, { text: 'WINDING DOWN', tone: 'dim' });
  assert.equal(phase(true, false, false, 'lastlight', false).tone, 'lastlight-real');
  assert.equal(phase(true, false, false, 'lastlight', true).tone, 'lastlight-test');
  assert.equal(phase(true, false, false, 'lastlight', undefined).tone, 'lastlight-test');
  assert.equal(phase(true, true, false, 'dim', false), null, 'paused shows no phase');
  assert.equal(phase(true, false, true, 'dim', false), null, 'stale shows no phase');
  assert.equal(phase(false, false, false, 'dim', false), null);
});

test('Fire 05: phone clocks use the phone locale, never a hard-coded 12-hour clock', () => {
  const calls = [];
  class FakeDate { constructor(ms) { this.ms = ms; } static now() { return 0; } toLocaleTimeString(locales, opts) { calls.push([locales, opts]); return 'formatted'; } }
  const sandbox = { Date: FakeDate };
  vm.createContext(sandbox);
  vm.runInContext(`${liftFunction(companionHtml, 'clockAt')}; this.clockAt = clockAt;`, sandbox);
  assert.equal(sandbox.clockAt(60), 'formatted');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [[], { hour: 'numeric', minute: '2-digit' }]);
});

function outcomeSandbox() {
  let now = 1_000_000;
  const strip = { hidden: true };
  const text = { textContent: '' };
  const toasts = [];
  const sandbox = {
    Date: { now: () => now },
    outcomeStrip: strip,
    outcomeText: text,
    pcName: 'DESKTOP-1',
    pendingOperation: null,
    clockAt: () => '1:14 AM',
    clearPending: ({ success } = {}) => { sandbox.pendingOperation = null; if (success) toasts.push(success); }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fire05Words()}
    var outcomeShownAt = 0;
    ${['confirmPendingFromState', 'outcomeEligible', 'outcomeStripText', 'showOutcome', 'hideOutcome', 'expireOutcome', 'syncOutcomeWithState'].map(n => liftFunction(companionHtml, n)).join('\n')}
    this.confirm = confirmPendingFromState; this.eligible = outcomeEligible; this.expire = expireOutcome;
    this.sync = syncOutcomeWithState; this.hide = hideOutcome;`, sandbox);
  const cancel = snapshot => ({ kind: 'cancel', success: 'Tonight’s run stopped', snapshot, matches: s => !s.running && !s.paused });
  return { sandbox, strip, text, toasts, cancel, advance: ms => { now += ms; }, now: () => now };
}

test('Fire 05: the outcome strip speaks only after a confirmed cancel with a safe margin', () => {
  const o = outcomeSandbox();
  // A cancel confirmed by an idle state with 120 s left: the strip shows.
  o.sandbox.pendingOperation = o.cancel({ remainingSeconds: 120, phase: 'dim', dryRun: false, action: 'shutdown' });
  o.sandbox.confirm({ running: false, paused: false });
  assert.equal(o.strip.hidden, false);
  assert.equal(o.text.textContent, 'Run stopped · 1:14 AM · DESKTOP-1 will not shut down for this run');
  assert.deepEqual(o.toasts, ['Tonight’s run stopped']);
  assert.doesNotMatch(o.text.textContent, /from this phone/);

  // Under 15 s, or in Last Light: toast only, no claim about the PC.
  for (const snapshot of [{ remainingSeconds: 14, phase: 'focus', dryRun: false, action: 'shutdown' }, { remainingSeconds: 300, phase: 'lastlight', dryRun: false, action: 'shutdown' }, null]) {
    const p = outcomeSandbox();
    p.sandbox.pendingOperation = p.cancel(snapshot);
    p.sandbox.confirm({ running: false, paused: false });
    assert.equal(p.strip.hidden, true, JSON.stringify(snapshot));
    assert.deepEqual(p.toasts, ['Tonight’s run stopped']);
  }
  // Another kind never shows it; an unmatched state confirms nothing.
  const q = outcomeSandbox();
  q.sandbox.pendingOperation = { kind: 'pause', success: 'Paused', snapshot: { remainingSeconds: 300, phase: 'focus' }, matches: () => true };
  q.sandbox.confirm({ running: true, paused: true });
  assert.equal(q.strip.hidden, true);
  const r = outcomeSandbox();
  r.sandbox.pendingOperation = r.cancel({ remainingSeconds: 300, phase: 'focus', dryRun: false, action: 'sleep' });
  r.sandbox.confirm({ running: true, paused: false });
  assert.equal(r.strip.hidden, true);
  assert.ok(r.sandbox.pendingOperation, 'an unmatched state leaves the cancel pending');
  // A Test Mode run says no power action was planned.
  const t = outcomeSandbox();
  t.sandbox.pendingOperation = t.cancel({ remainingSeconds: 300, phase: 'focus', dryRun: true, action: 'shutdown' });
  t.sandbox.confirm({ running: false, paused: false });
  assert.equal(t.text.textContent, 'Test run stopped · 1:14 AM · no power action was planned on DESKTOP-1');
});

test('Fire 05: the outcome strip hides on a later run, after 10 minutes, and on a pairing reset', () => {
  const o = outcomeSandbox();
  const show = () => {
    o.sandbox.pendingOperation = o.cancel({ remainingSeconds: 600, phase: 'focus', dryRun: false, action: 'restart' });
    o.sandbox.confirm({ running: false, paused: false });
    assert.equal(o.strip.hidden, false);
  };
  show();
  o.sandbox.sync({ running: false, paused: false });
  assert.equal(o.strip.hidden, false, 'an idle state keeps it');
  o.sandbox.sync({ running: true, paused: false });
  assert.equal(o.strip.hidden, true, 'a later running state (any device) hides it');
  show();
  o.sandbox.sync({ running: true, paused: true });
  assert.equal(o.strip.hidden, true, 'a paused state hides it');
  show();
  o.advance(9 * 60 * 1000);
  o.sandbox.expire(o.now());
  assert.equal(o.strip.hidden, false, 'still shown at 9 minutes');
  o.advance(60 * 1000);
  o.sandbox.expire(o.now());
  assert.equal(o.strip.hidden, true, 'gone at 10 minutes');

  // forgetLastKnownState (pairing reset / showPairing) hides it.
  const strip = { hidden: false };
  const runLayoutCalls = [];
  const el = () => ({ textContent: 'x', hidden: false, classList: { remove() {}, toggle() {} } });
  // Fire 06: the reset also drops the plan preview, closes the Start sheet
  // and unlights the lamp.
  const bodyRemoved = [];
  const fire06Calls = [];
  const sandbox = {
    latestState: { running: false }, lastSeenAt: 5, desktopHello: {}, pcVersionEl: el(),
    timerName: el(), timerMain: el(), timerLabel: el(), targetEl: el(), timerPhase: el(),
    outcomeStrip: strip, outcomeShownAt: 1,
    document: { body: { classList: { remove: (...n) => bodyRemoved.push(...n) } } },
    setRing() {}, clearRunClasses() {}, syncStaleTag() {}, syncActionSegTruth() {}, updateIdleSafetyBanner() {},
    closeStartSheet() { fire06Calls.push('closeStartSheet'); }, setLampOff() { fire06Calls.push('setLampOff'); },
    setRunLayout(on) { runLayoutCalls.push(on); }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${['setPhaseLine', 'hideOutcome', 'forgetLastKnownState'].map(n => liftFunction(companionHtml, n)).join('\n')}; forgetLastKnownState();`, sandbox);
  assert.equal(strip.hidden, true);
  assert.equal(sandbox.outcomeShownAt, 0);
  assert.equal(sandbox.latestState, null);
  assert.deepEqual(runLayoutCalls, [false], 'a pairing reset also drops the thumb-dock layout');
  assert.ok(bodyRemoved.includes('is-plan'), 'a pairing reset drops the plan preview');
  assert.deepEqual(fire06Calls, ['closeStartSheet', 'setLampOff'], 'a pairing reset closes the Start sheet and unlights the lamp');
  assert.equal(sandbox.timerMain.textContent, '—', "a pairing reset keeps '—'");
  assert.match(liftFunction(companionHtml, 'markStale'), /hideOutcome\(\);/, 'connection loss / stale hides it too');
  assert.match(liftFunction(companionHtml, 'beginPending'), /operation\.kind === 'start' \|\| operation\.kind === 'startNightMode'\) hideOutcome\(\);/, 'the next start hides it');
});

// Fix round 2: the thumb dock keyed on is-running / is-paused, which
// markStale clears on every stale flash (a phone wake), so the ring and the
// controls jumped ~55-110px and back within ~2 s, under the user's thumb.
// The dock now keys on body.has-run, which a stale flash never touches.
test('Fire 05: a stale flash keeps the thumb-dock layout (has-run); idle and pairing drop it', () => {
  const bodyClasses = new Set();
  const classList = {
    add: (...n) => n.forEach(c => bodyClasses.add(c)),
    remove: (...n) => n.forEach(c => bodyClasses.delete(c)),
    toggle: (n, on) => { if (on) bodyClasses.add(n); else bodyClasses.delete(n); },
    contains: n => bodyClasses.has(n)
  };
  const freshness = new Set();
  const sandbox = {
    document: { body: { classList }, documentElement: { style: { setProperty() {} } } },
    freshnessEl: { classList: { add: c => freshness.add(c), remove: c => freshness.delete(c) } },
    setFreshness() {}, lastSeenSuffix: () => '', setPhaseLine() {}, hideOutcome() {}
  };
  vm.createContext(sandbox);
  const lifted = ['applyRunClasses', 'clearRunClasses', 'setRunLayout', 'markStale'].map(n => liftFunction(companionHtml, n)).join('\n');
  vm.runInContext(`${lifted}; this.apply = applyRunClasses; this.layout = setRunLayout; this.stale = markStale;`, sandbox);
  // An authoritative running state (handleUpdate: applyRunClasses + setRunLayout(active)).
  sandbox.apply(true, false, 'focus', 0.5);
  sandbox.layout(true);
  assert.ok(bodyClasses.has('is-running') && bodyClasses.has('has-run'));
  // Phone wake: the reading goes stale. The run classes go (the stale
  // visuals win), the dock layout stays.
  sandbox.stale('Checking the PC');
  assert.ok(bodyClasses.has('stale-state') && !bodyClasses.has('is-running') && !bodyClasses.has('is-paused'));
  assert.ok(bodyClasses.has('has-run'), 'markStale must not drop the thumb-dock layout');
  // The same for a paused run.
  sandbox.apply(true, true, 'focus', 0.5);
  sandbox.stale('Checking the PC');
  assert.ok(bodyClasses.has('has-run'));
  // An authoritative idle state drops it.
  sandbox.layout(false);
  assert.ok(!bodyClasses.has('has-run'));
  // Only handleUpdate (authoritative state) and forgetLastKnownState write it.
  for (const fn of ['markStale', 'applyRunClasses', 'clearRunClasses', 'updateFreshness']) {
    assert.doesNotMatch(liftFunction(companionHtml, fn), /has-run|setRunLayout/, `${fn} must not touch the dock layout`);
  }
  assert.match(liftFunction(companionHtml, 'handleUpdate'), /else clearRunClasses\(\);\s*setRunLayout\(active\);/);
  assert.match(liftFunction(companionHtml, 'forgetLastKnownState'), /setRunLayout\(false\);/);
});

test('Fire 05: the stop sheet says what stopping does; the Test sentence only for dryRun === true', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${fire05Words()}; ${['phoneSessionTitle', 'formatTime', 'cancelCopyText'].map(n => liftFunction(companionHtml, n)).join('\n')}; this.copy = cancelCopyText;`, sandbox);
  const real = sandbox.copy({ nightModeTitle: 'Quick Sleep', remainingSeconds: 754, dryRun: false, action: 'shutdown' }, 'DESKTOP-1');
  assert.equal(real, 'Quick Sleep has 12:34 remaining on DESKTOP-1. This will stop the timer, and this run’s shutdown will not happen.');
  const test = sandbox.copy({ timerName: 'Last Call', remainingSeconds: 60, dryRun: true, action: 'sleep' }, 'DESKTOP-1');
  assert.equal(test, 'Countdown has 1:00 remaining on DESKTOP-1. This will stop the timer. This is a Test Mode run: no power action was planned.');
  assert.doesNotMatch(test, /will not happen|either way/, 'a Test Mode run never implies a planned action');
  const unknown = sandbox.copy({ timerName: 'Reading', remainingSeconds: 60, action: undefined }, 'the connected PC');
  assert.match(unknown, /this run’s power action will not happen\.$/);
  assert.doesNotMatch(unknown, /Test Mode/, 'no Test sentence unless dryRun === true');
  for (const copy of [real, test, unknown]) assert.ok(copy.includes('remaining') && copy.includes('stop the timer'));
});

// ── UI-R3 Fire 06: the phone at rest, lifted from the real page into a vm
// sandbox (no browser, Electron or network).
function fire06Dom() {
  const listeners = new Set();
  const byId = {};
  const doc = {
    activeElement: null,
    addEventListener: (type, fn) => { if (type === 'keydown') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'keydown') listeners.delete(fn); },
    createElement: () => el(),
    createTextNode: text => ({ textContent: String(text) }),
    getElementById: id => byId[id] || null,
    body: el('body')
  };
  function el(id) {
    const classes = new Set();
    const attrs = {};
    const node = {
      id, hidden: false, disabled: false, inert: false, isConnected: true, visible: true, children: [], _text: '', dataset: {},
      get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; },
      set textContent(v) { this.children = []; this._text = String(v); },
      replaceChildren(...kids) { this.children = kids; this._text = ''; },
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
      classList: {
        add: (...n) => n.forEach(c => classes.add(c)),
        remove: (...n) => n.forEach(c => classes.delete(c)),
        toggle: (n, on) => { const want = on === undefined ? !classes.has(n) : Boolean(on); if (want) classes.add(n); else classes.delete(n); return want; },
        contains: n => classes.has(n)
      },
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: k => (k in attrs ? attrs[k] : null),
      removeAttribute: k => { delete attrs[k]; },
      getClientRects() { return this.visible ? [{}] : []; },
      focus() { doc.activeElement = node; },
      querySelectorAll: () => []
    };
    if (id) byId[id] = node;
    return node;
  }
  return { doc, el, listeners, byId };
}

function startSheetSandbox() {
  const { doc, el, listeners } = fire06Dom();
  const sent = [];
  const pending = [];
  const sandbox = {
    document: doc,
    latestState: { running: false, paused: false, dryRunPolicy: true },
    pendingOperation: null,
    selectedAction: 'shutdown',
    pcName: 'DESKTOP-1',
    startSheetSeconds: 1800,
    startSheetOpener: null,
    authoritative: true,
    clockAt: () => '1:14 AM',
    send: payload => { sent.push(payload); return true; },
    beginPending: op => { pending.push(op); sandbox.pendingOperation = op; return true; },
    clearPending: () => { sandbox.pendingOperation = null; },
    startSheet: el('start-sheet'), startEyebrow: el('start-eyebrow'), startTitle: el('start-title'),
    startActionEl: el('start-action'), startWhenLabel: el('start-when-label'), startWhen: el('start-when'),
    startRunType: el('start-run-type'), startGo: el('start-go'), startCancel: el('start-cancel'),
    cancelConfirm: el('cancel-confirm'), nightModeBackdrop: el('night-mode-backdrop'),
    appShell: el('app-shell'), planStart: el('plan-start'), btnPause: el('btn-pause')
  };
  vm.createContext(sandbox);
  const names = ['anyDialogOpen', 'releaseShellIfNoDialog', 'isUsableFocusTarget', 'focusFirstUsable', 'trapDialogTab',
    'truthBand', 'applyTruthBand', 'clampPlanSeconds', 'planPolicyKnown', 'actionLabel', 'setText', 'formatTime',
    'startSheetReady', 'openStartSheet', 'renderStartSheet', 'closeStartSheet', 'handleStartSheetKeydown', 'confirmStartSheet'];
  vm.runInContext(`${fire05Words()}
    function stateIsAuthoritative() { return authoritative; }
    ${names.map(n => liftFunction(companionHtml, n)).join('\n')}
    this.open = openStartSheet; this.close = closeStartSheet; this.go = confirmStartSheet;
    this.key = handleStartSheetKeydown; this.render = renderStartSheet;`, sandbox);
  const shown = () => sandbox.startSheet.classList.contains('show');
  return { sandbox, sent, pending, listeners, shown, doc };
}

test('Fire 06: the Start sheet refuses without authority or a boolean Test Mode policy', () => {
  for (const policy of [undefined, null, 'true', 1]) {
    const t = startSheetSandbox();
    t.sandbox.latestState = { running: false, paused: false, dryRunPolicy: policy };
    assert.equal(t.sandbox.open(900), false, `policy ${String(policy)}`);
    assert.equal(t.shown(), false);
    assert.equal(t.sandbox.appShell.inert, false);
    assert.equal(t.listeners.size, 0);
  }
  const t = startSheetSandbox();
  t.sandbox.authoritative = false;
  assert.equal(t.sandbox.open(900), false, 'not authoritative');
  assert.equal(t.shown(), false);
  // One dialog at a time.
  const u = startSheetSandbox();
  u.sandbox.cancelConfirm.classList.add('show');
  assert.equal(u.sandbox.open(900), false, 'never over the stop sheet');
  assert.equal(u.sent.length, 0);
});

test('Fire 06: the Start sheet states Test Mode, makes the page inert and sends nothing before #start-go', () => {
  const t = startSheetSandbox();
  t.sandbox.planStart.focus();
  assert.equal(t.sandbox.open(900), true);
  assert.equal(t.shown(), true);
  assert.equal(t.sandbox.startSheet.getAttribute('aria-hidden'), 'false');
  assert.equal(t.sandbox.appShell.inert, true);
  assert.equal(t.sandbox.appShell.getAttribute('aria-hidden'), 'true');
  assert.equal(t.doc.activeElement, t.sandbox.startCancel, 'initial focus is Not now, never Start');
  assert.equal(t.sent.length, 0, 'opening the sheet sends nothing');
  assert.equal(t.sandbox.startEyebrow.textContent, 'TONIGHT’S PLAN · DESKTOP-1');
  assert.equal(t.sandbox.startTitle.textContent, '15:00');
  assert.equal(t.sandbox.startRunType.textContent, 'TEST MODE · No PC power action will run.');
  assert.ok(t.sandbox.startRunType.classList.contains('dry') && !t.sandbox.startRunType.classList.contains('real'));
  assert.equal(t.sandbox.startWhenLabel.textContent, 'Test would end ≈');
  assert.equal(t.sandbox.startActionEl.textContent, 'Shut down · test only');
  assert.equal(t.sandbox.startGo.textContent, 'Start test run');
  assert.equal(t.sandbox.startGo.classList.contains('is-real'), false);
  assert.equal(t.sandbox.startGo.disabled, false);
  // Clamped like the old startTimer (60 s .. 24 h).
  t.sandbox.close();
  t.sandbox.open(5);
  assert.equal(t.sandbox.startSheetSeconds, 60);
  t.sandbox.open(10 * 24 * 3600);
  assert.equal(t.sandbox.startSheetSeconds, 24 * 3600);
  assert.equal(t.listeners.size, 1, 'one trap while open, never two');
});

test('Fire 06: a REAL policy names the action and draws the danger edge', () => {
  const t = startSheetSandbox();
  t.sandbox.latestState = { running: false, paused: false, dryRunPolicy: false };
  t.sandbox.open(2700);
  assert.equal(t.sandbox.startRunType.textContent, 'REAL ACTION · This run will shut down this PC.');
  assert.ok(t.sandbox.startRunType.classList.contains('real'));
  assert.equal(t.sandbox.startGo.textContent, 'Start · will shut down');
  assert.equal(t.sandbox.startGo.classList.contains('is-real'), true);
  assert.equal(t.sandbox.startWhenLabel.textContent, 'Lights out ≈');
  assert.equal(t.sandbox.startActionEl.textContent, 'Shut down');
  // Losing authority while open disables Start (the tick re-renders).
  t.sandbox.authoritative = false;
  t.sandbox.render();
  assert.equal(t.sandbox.startGo.disabled, true);
});

test('Fire 06: #start-go sends with the click-time policy and ending, then closes and releases the page', () => {
  const t = startSheetSandbox();
  t.sandbox.planStart.focus();
  t.sandbox.open(900);
  // The desktop flips Test Mode off and the user picks Sleep while open.
  t.sandbox.latestState = { running: false, paused: false, dryRunPolicy: false };
  t.sandbox.selectedAction = 'sleep';
  t.sandbox.go();
  assert.equal(t.pending.length, 1);
  assert.equal(t.pending[0].kind, 'start');
  assert.equal(t.pending[0].success, 'Timer started — REAL ACTION', 'success copy from the click-time policy');
  assert.deepEqual(JSON.parse(JSON.stringify(t.sent)), [{ action: 'start', durationSeconds: 900, timerAction: 'sleep' }]);
  assert.equal(t.shown(), false);
  assert.equal(t.sandbox.appShell.inert, false);
  assert.equal(t.sandbox.appShell.getAttribute('aria-hidden'), null);
  assert.equal(t.listeners.size, 0);
  // At click time without authority: close, send nothing.
  const u = startSheetSandbox();
  u.sandbox.open(900);
  u.sandbox.authoritative = false;
  u.sandbox.go();
  assert.equal(u.sent.length, 0);
  assert.equal(u.shown(), false);
  // A policy that stops being boolean at click time: close, send nothing.
  const v = startSheetSandbox();
  v.sandbox.open(900);
  v.sandbox.latestState = { running: false, paused: false };
  v.sandbox.go();
  assert.equal(v.sent.length, 0);
  assert.equal(v.shown(), false);
});

test('Fire 06: Escape, Not now and an active run close the Start sheet without sending; focus comes back', () => {
  const t = startSheetSandbox();
  t.sandbox.planStart.focus();
  t.sandbox.open(900);
  let prevented = false;
  t.sandbox.key({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(t.doc.activeElement, t.sandbox.startGo, 'Tab wraps from Not now to Start');
  t.sandbox.key({ key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(t.doc.activeElement, t.sandbox.startCancel, 'and back');
  t.sandbox.key({ key: 'Escape', preventDefault() {} });
  assert.equal(t.shown(), false);
  assert.equal(t.sent.length, 0);
  assert.equal(t.doc.activeElement, t.sandbox.planStart, 'focus returns to the opener');
  assert.equal(t.sandbox.appShell.inert, false);
  // Closed because a run went active: the idle opener is hidden, so focus
  // goes to the visible active control.
  t.sandbox.open(900);
  t.sandbox.planStart.visible = false;
  t.sandbox.close();
  assert.equal(t.doc.activeElement, t.sandbox.btnPause);
  assert.equal(t.sent.length, 0);
  // Another dialog still open keeps the page inert.
  const u = startSheetSandbox();
  u.sandbox.open(900);
  u.sandbox.nightModeBackdrop.classList.add('show');
  u.sandbox.close();
  assert.equal(u.sandbox.appShell.inert, true, 'inert is cleared only when no dialog shows');
  // handleUpdate closes the sheet on any running/paused state.
  assert.match(liftFunction(companionHtml, 'handleUpdate'), /if \(active && startSheet\.classList\.contains\('show'\)\) closeStartSheet\(\);/);
  assert.doesNotMatch(companionHtml.slice(companionHtml.indexOf('<script>')), /\bconfirm\(/, 'no browser confirm remains');
});

test('Fire 06: the Night Mode end line is honest about Test Mode, unknown policy and rituals', () => {
  let clockCalls = 0;
  const sandbox = { clockAt: () => { clockCalls++; return '1:14 AM'; } };
  vm.createContext(sandbox);
  vm.runInContext(`${liftFunction(companionHtml, 'formatNmAction')}; ${liftFunction(companionHtml, 'nmEndsLine')}; this.ends = nmEndsLine;`, sandbox);
  const quick = { durationSeconds: 900, action: 'sleep', ritualId: null };
  assert.equal(sandbox.ends(quick, true), 'Test would end ≈ 1:14 AM if started now');
  assert.doesNotMatch(sandbox.ends(quick, true), /Sleep|Shut|Restart/, 'no power-action verb in Test Mode');
  assert.equal(sandbox.ends(quick, false), 'Sleep ≈ 1:14 AM if started now');
  assert.equal(sandbox.ends(quick, undefined), '');
  assert.equal(sandbox.ends(quick, 'true'), '');
  const before = clockCalls;
  assert.equal(sandbox.ends({ durationSeconds: 3600, action: 'shutdown', ritualId: 'standard' }, false), 'after a guided wind-down');
  assert.equal(sandbox.ends({ durationSeconds: 3600, action: 'shutdown', ritualId: 'standard' }, true), 'after a guided wind-down');
  assert.equal(clockCalls, before, 'a ritual mode never computes a clock');
  assert.equal(sandbox.ends(null, true), '');
});

test('Fire 06: the Night Mode sheet is a real modal (inert, one trap, focus restored, refresh never steals focus)', () => {
  const { doc, el, listeners } = fire06Dom();
  const card = el('card');
  const sandbox = {
    document: doc,
    nmCatalogue: [{ id: 'quick-sleep', status: 'ready', version: 1, title: 'Quick Sleep', subtitle: 'A short countdown.', durationSeconds: 900, action: 'sleep', ritualId: null, artworkId: 'quick-sleep' }],
    NM_ARTWORK: { 'quick-sleep': '<svg></svg>' },
    nmSelectedId: null, nmSelectedVersion: null, nmDialogOpener: null,
    runTypeUpdates: 0,
    updateNightModeRunType() { sandbox.runTypeUpdates++; },
    nightModeBackdrop: el('night-mode-backdrop'), startSheet: el('start-sheet'), cancelConfirm: el('cancel-confirm'),
    appShell: el('app-shell'), nmDetailArt: el('nm-detail-art'), nmDetailTitle: el('nm-detail-title'),
    nmDetailSubtitle: el('nm-detail-subtitle'), nmDetailDuration: el('nm-detail-duration'), nmDetailFacts: el('nm-detail-facts'),
    nmDetailRitual: el('nm-detail-ritual'), nmDetailStart: el('nm-detail-start'), nmDetailClose: el('nm-detail-close'),
    nightModeToggle: el('night-mode-toggle'),
    nightModeGrid: { querySelectorAll: () => [card] }
  };
  vm.createContext(sandbox);
  const names = ['anyDialogOpen', 'releaseShellIfNoDialog', 'isUsableFocusTarget', 'focusFirstUsable', 'trapDialogTab',
    'formatTime', 'formatNmDuration', 'formatNmAction', 'openNightModeDetail', 'closeNightModeDetail', 'handleNightModeKeydown'];
  vm.runInContext(`${names.map(n => liftFunction(companionHtml, n)).join('\n')}
    this.open = openNightModeDetail; this.close = closeNightModeDetail; this.key = handleNightModeKeydown;`, sandbox);
  card.focus();
  sandbox.open('quick-sleep');
  const shown = () => sandbox.nightModeBackdrop.classList.contains('show');
  assert.ok(shown());
  assert.equal(sandbox.appShell.inert, true);
  assert.equal(sandbox.appShell.getAttribute('aria-hidden'), 'true');
  assert.equal(doc.activeElement, sandbox.nmDetailStart);
  assert.equal(listeners.size, 1);
  assert.equal(sandbox.nmDetailDuration.textContent, '15:00');
  assert.equal(sandbox.nmDetailFacts.textContent, '15 min · Sleep');
  assert.equal(sandbox.nmDetailRitual.textContent, 'Direct start');
  assert.equal(sandbox.nmDetailStart.textContent, 'Start Quick Sleep');
  // A catalogue refresh re-opens: no second trap, no focus theft, opener kept.
  sandbox.nmDetailClose.focus();
  sandbox.open('quick-sleep');
  assert.equal(listeners.size, 1);
  assert.equal(doc.activeElement, sandbox.nmDetailClose);
  assert.equal(sandbox.nmDialogOpener, card);
  // Tab skips a disabled Start.
  sandbox.nmDetailStart.disabled = true;
  sandbox.key({ key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(doc.activeElement, sandbox.nmDetailClose);
  // Escape closes, releases the page and returns focus to the card.
  sandbox.key({ key: 'Escape', preventDefault() {} });
  assert.ok(!shown());
  assert.equal(sandbox.appShell.inert, false);
  assert.equal(listeners.size, 0);
  assert.equal(doc.activeElement, card);
  // Disabled Start: initial focus is Close; a hidden opener falls back to the toggle.
  sandbox.open('quick-sleep');
  assert.equal(doc.activeElement, sandbox.nmDetailClose);
  card.visible = false;
  sandbox.close();
  assert.equal(doc.activeElement, sandbox.nightModeToggle);
  // Never over the Start sheet.
  sandbox.startSheet.classList.add('show');
  sandbox.open('quick-sleep');
  assert.ok(!shown());
});

test('Fire 06: the idle ring previews tonight\'s plan only from an authoritative state with a boolean policy', () => {
  const { doc, el } = fire06Dom();
  const rings = [];
  const sandbox = {
    document: doc, authoritative: true, planSeconds: 1800, selectedAction: 'shutdown',
    latestState: { running: false, paused: false, dryRunPolicy: false },
    timerName: el('timer-name'), timerMain: el('timer-main'), timerLabel: el('timer-label'), targetEl: el('target'),
    clockAt: () => '1:14 AM',
    setRing: (f, phase) => rings.push([f, phase])
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fire05Words()}
    function stateIsAuthoritative() { return authoritative; }
    ${['planPolicyKnown', 'setText', 'formatTime', 'renderIdlePlan'].map(n => liftFunction(companionHtml, n)).join('\n')}
    this.render = renderIdlePlan;`, sandbox);
  const read = () => [sandbox.timerName.textContent, sandbox.timerMain.textContent, sandbox.timerLabel.textContent, sandbox.targetEl.textContent];
  sandbox.render();
  assert.deepEqual(read(), ['Tonight’s plan', '30:00', 'then shut down', 'Lights out 1:14 AM if started now']);
  assert.ok(doc.body.classList.contains('is-plan'));
  assert.deepEqual(rings.pop(), [1, 'idle']);
  sandbox.latestState = { running: false, paused: false, dryRunPolicy: true };
  sandbox.render();
  assert.deepEqual(read(), ['Tonight’s plan', '30:00', 'Test run · no power action', 'Test would end 1:14 AM if started now']);
  assert.doesNotMatch(read().join(' '), /shut down|Lights out/, "Test Mode never reads 'then shut down'");
  // Checking (no policy) or not authoritative: '—', no plan copy.
  for (const setup of [() => { sandbox.latestState = { running: false, paused: false }; }, () => { sandbox.latestState = { running: false, paused: false, dryRunPolicy: true }; sandbox.authoritative = false; }]) {
    setup();
    sandbox.render();
    assert.deepEqual(read(), ['', '—', '', '']);
    assert.ok(!doc.body.classList.contains('is-plan'));
    assert.deepEqual(rings.pop(), [0, 'idle']);
  }
  // A running state is never touched by the preview.
  sandbox.authoritative = true;
  sandbox.latestState = { running: true, paused: false, dryRunPolicy: true };
  sandbox.timerMain.textContent = '12:34';
  sandbox.render();
  assert.equal(sandbox.timerMain.textContent, '12:34');
});

test('Fire 06: the plan steps by 5 minutes within 1..1440 and one sentence states Test Mode', () => {
  const sandbox = {
    planSeconds: 1800, customMin: { value: '30' }, renders: 0,
    renderPlanControls() {}, renderIdlePlan() { sandbox.renders++; }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fire05Words()}
    ${['clampPlanSeconds', 'setPlanSeconds', 'customMinutesValue', 'stepCustom', 'truthBand'].map(n => liftFunction(companionHtml, n)).join('\n')}
    this.step = stepCustom; this.set = setPlanSeconds; this.band = truthBand; this.clamp = clampPlanSeconds;`, sandbox);
  sandbox.step(1);
  assert.equal(sandbox.planSeconds, 35 * 60);
  assert.equal(sandbox.customMin.value, '35');
  sandbox.customMin.value = '7';
  sandbox.step(1);
  assert.equal(sandbox.customMin.value, '10');
  sandbox.customMin.value = '7';
  sandbox.step(-1);
  assert.equal(sandbox.customMin.value, '5');
  sandbox.customMin.value = '1';
  sandbox.step(-1);
  assert.equal(sandbox.customMin.value, '1', 'never below 1 minute');
  sandbox.customMin.value = '1440';
  sandbox.step(1);
  assert.equal(sandbox.customMin.value, '1440', 'never above 24 h');
  assert.equal(sandbox.set(NaN), false, 'an invalid value never becomes the plan');
  assert.equal(sandbox.clamp(0), null);
  assert.equal(sandbox.clamp(-60), null);
  const test = sandbox.band(true, 'shutdown');
  assert.equal(test.word + test.rest, 'TEST MODE · No PC power action will run.');
  const real = sandbox.band(false, 'restart');
  assert.equal(real.word + real.rest, 'REAL ACTION · This run will restart this PC.');
  assert.equal(sandbox.band(false, 'constructor').rest, ' · Runs started here use real PC power actions.');
  assert.equal(sandbox.band(undefined, 'shutdown').word, 'CHECKING');
});
