'use strict';

const assert = require('node:assert/strict');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForCondition(read, {
  timeoutMs = 5000,
  intervalMs = 50,
  description = 'condition',
  sleep = wait
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  let lastError;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (last) return last;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const detail = lastError ? lastError.message : JSON.stringify(last);
  throw new Error(`Timed out waiting for ${description}: ${detail}`);
}

async function waitForAuthoritativeReadiness(readSnapshot, {
  timeoutMs = 15000,
  intervalMs = 75,
  sleep = wait,
  onMilestone = () => {}
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let generation = null;
  let last = null;
  while (Date.now() < deadline) {
    last = await readSnapshot();
    if (last?.generation && last.generation !== generation) {
      generation = last.generation;
      onMilestone({ event: 'renderer-generation', generation, at: Date.now() });
    }
    if (
      generation &&
      last?.generation === generation &&
      last.documentReadyState === 'complete' &&
      last.proofExists === true &&
      last.proofReady === true &&
      last.navReady === true &&
      !last.openModal
    ) {
      const confirmation = await readSnapshot();
      if (
        confirmation?.generation === generation &&
        confirmation.documentReadyState === 'complete' &&
        confirmation.proofReady === true &&
        confirmation.navReady === true &&
        !confirmation.openModal
      ) {
        onMilestone({ event: 'renderer-ready', generation, at: Date.now() });
        return confirmation;
      }
      last = confirmation;
      if (confirmation?.generation && confirmation.generation !== generation) {
        generation = confirmation.generation;
        onMilestone({ event: 'renderer-generation', generation, at: Date.now() });
      }
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for authoritative renderer readiness: ${JSON.stringify(last)}`);
}

function assertOwnedEndpoint({
  spawnedPid,
  listeningPid,
  expectedExecutable,
  actualExecutable,
  expectedUserData,
  commandLine
}) {
  assert.equal(listeningPid, spawnedPid, 'CDP listener belongs to a different process');
  assert.equal(
    String(actualExecutable).toLowerCase(),
    String(expectedExecutable).toLowerCase(),
    'spawned process executable does not match the packaged executable'
  );
  assert.ok(
    String(commandLine).includes(`--user-data-dir=${expectedUserData}`),
    'spawned process does not own the isolated user-data directory'
  );
}

// UI-R1: the unified shell's navigation contract. Nav items are plain
// buttons -- the contract is "click activates the item (active class +
// aria-current=page)", or "click opens the About modal" for the help
// destination, plus no menu machinery remaining anywhere in the DOM.
async function exerciseNavContract({
  navId,
  readReadiness,
  readNav,
  clickNav,
  pressEscape,
  timeoutMs = 5000,
  opensModal = false
}) {
  const readiness = await readReadiness();
  assert.equal(readiness.navReady, true, `${navId} click attempted before nav was ready`);
  const before = await readNav();
  assert.equal(before.connected, true, `${navId} nav item is detached`);
  assert.equal(before.visible, true, `${navId} nav item is not visible`);
  assert.equal(before.enabled, true, `${navId} nav item is disabled`);
  assert.equal(before.menuRemnants, 0, 'top-menu remnants still in DOM');

  await clickNav();
  if (opensModal) {
    const opened = await waitForCondition(async () => {
      const state = await readNav();
      return state.activeModal === 'about-modal' ? state : null;
    }, { timeoutMs, description: `${navId} opens About modal` });
    await pressEscape();
    const closed = await waitForCondition(async () => {
      const state = await readNav();
      return state.activeModal === null ? state : null;
    }, { timeoutMs, description: `${navId} Escape closes About modal` });
    return { opened, closed };
  }

  const activated = await waitForCondition(async () => {
    const state = await readNav();
    return state.active === true && state.ariaCurrent === 'page' ? state : null;
  }, { timeoutMs, description: `${navId} active and aria-current after click` });
  return { activated };
}

module.exports = {
  assertOwnedEndpoint,
  exerciseNavContract,
  waitForAuthoritativeReadiness,
  waitForCondition
};
