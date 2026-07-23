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
      last.menusReady === true &&
      !last.openModal
    ) {
      const confirmation = await readSnapshot();
      if (
        confirmation?.generation === generation &&
        confirmation.documentReadyState === 'complete' &&
        confirmation.proofReady === true &&
        confirmation.menusReady === true &&
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

async function exerciseMenuContract({
  menuId,
  readReadiness,
  readMenu,
  clickTrigger,
  moveToFirstItem,
  pressEscape,
  timeoutMs = 5000,
  full = false
}) {
  const readiness = await readReadiness();
  assert.equal(readiness.menusReady, true, `${menuId} click attempted before menus were ready`);
  const before = await readMenu();
  assert.equal(before.connected, true, `${menuId} trigger is detached`);
  assert.equal(before.visible, true, `${menuId} trigger is not visible`);
  assert.equal(before.enabled, true, `${menuId} trigger is disabled`);

  await clickTrigger();
  const opened = await waitForCondition(async () => {
    const state = await readMenu();
    return state.ariaExpanded === 'true' && state.open && state.menuVisible ? state : null;
  }, { timeoutMs, description: `${menuId} accessible and visible open state` });

  if (!full) {
    await pressEscape();
    const closed = await waitForCondition(async () => {
      const state = await readMenu();
      return state.ariaExpanded === 'false' && !state.open && state.focusedId === menuId ? state : null;
    }, { timeoutMs, description: `${menuId} Escape close and focus restoration` });
    return { opened, closed };
  }

  await moveToFirstItem();
  const pointerTransfer = await waitForCondition(async () => {
    const state = await readMenu();
    return state.ariaExpanded === 'true' && state.open && state.menuVisible ? state : null;
  }, { timeoutMs, description: `${menuId} pointer transfer` });
  await pressEscape();
  const closed = await waitForCondition(async () => {
    const state = await readMenu();
    return state.ariaExpanded === 'false' && !state.open && state.focusedId === menuId ? state : null;
  }, { timeoutMs, description: `${menuId} Escape close and focus restoration` });
  return { opened, pointerTransfer, closed };
}

module.exports = {
  assertOwnedEndpoint,
  exerciseMenuContract,
  waitForAuthoritativeReadiness,
  waitForCondition
};
