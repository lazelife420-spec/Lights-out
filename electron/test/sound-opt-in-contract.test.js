'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ELECTRON_DIR = path.join(__dirname, '..');

function readSource(rel) {
  return fs.readFileSync(path.join(ELECTRON_DIR, rel), 'utf8');
}

// Brace/paren matcher that ignores strings, template literals, and comments.
function findMatchingBrace(source, startIdx) {
  let depth = 1;
  let i = startIdx + 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    const next = source[i + 1] || '';
    if (c === '/' && next === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '`') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) throw new Error('Unbalanced braces');
  return i - 1;
}

function findMatchingParen(source, startIdx) {
  let depth = 1;
  let i = startIdx + 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    const next = source[i + 1] || '';
    if (c === '/' && next === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '`') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  if (depth !== 0) throw new Error('Unbalanced parentheses');
  return i - 1;
}

function findNextChar(source, startIdx, target) {
  let i = startIdx;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1] || '';
    if (c === '/' && next === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '`') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === target) return i;
    i++;
  }
  throw new Error(`Character ${target} not found`);
}

function extractFunction(source, name) {
  const re = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = re.exec(source);
  if (!match) throw new Error(`Function ${name} not found`);
  const openParen = source.indexOf('(', match.index);
  if (openParen === -1) throw new Error(`Open parenthesis not found for ${name}`);
  const closeParen = findMatchingParen(source, openParen);
  const openBrace = findNextChar(source, closeParen + 1, '{');
  const closeBrace = findMatchingBrace(source, openBrace);
  return source.slice(match.index, closeBrace + 1);
}

function extractObjectLiteral(source, declaration) {
  const re = new RegExp(`${declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*\\{`);
  const match = re.exec(source);
  if (!match) throw new Error(`${declaration} not found`);
  const openBrace = match.index + match.length - 1;
  const closeBrace = findMatchingBrace(source, openBrace);
  return source.slice(openBrace, closeBrace + 1);
}

function extractLastObjectLiteral(source, declaration) {
  const escaped = declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*=\\s*\\{`, 'g');

  let match;
  let lastMatch = null;

  while ((match = re.exec(source)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch) {
    throw new Error(`${declaration} not found`);
  }

  const openBrace = lastMatch.index + lastMatch[0].length - 1;
  const closeBrace = findMatchingBrace(source, openBrace);
  return source.slice(openBrace, closeBrace + 1);
}

test('fresh defaults', () => {
  const rendererSource = readSource('renderer.js');
  const stateBlock = extractLastObjectLiteral(rendererSource, 'const state');
  assert.match(stateBlock, /\bsound:\s*false\b/);

  const soundSystemMatch = rendererSource.match(
    /\bconst\s+SoundSystem\s*=\s*\{[^}]*enabled:\s*false\b/
  );
  assert.ok(
    soundSystemMatch,
    'SoundSystem must initialize enabled to false'
  );

  const onboardingSource = readSource('renderer-onboarding-updater.js');
  const onboardDataMatch = onboardingSource.match(
    /\blet\s+onboardData\s*=\s*\{[^}]*sound:\s*false\b/
  );
  assert.ok(
    onboardDataMatch,
    'onboardData.sound must initialize to false'
  );

  const html = readSource('index.html');
  const inputMatch = html.match(/<input[^>]*id=["']onboard-sound["'][^>]*>/i);
  assert.ok(inputMatch, 'onboard-sound input must exist');
  assert.doesNotMatch(inputMatch[0], /\bchecked\b/i);
});

test('persisted sound settings remain authoritative', async () => {
  const settingsSource = readSource('renderer-settings.js');
  const applySource = extractFunction(settingsSource, 'applyAppSettings');

  function makeContext(sound, enabled) {
    return {
      console,
      state: {
        running: false,
        action: 'shutdown',
        graceMinutes: 2,
        clockMode: false,
        sound,
      },
      SoundSystem: { enabled },
      els: {},
      setInputFromSeconds: () => {},
      setAction: () => {},
      applyClockStyle: () => {},
      updateClockStyleVisibility: () => {},
      api: { saveAppSettings: async () => ({}) },
      handleSidebarNavigation: () => {},
      document: { querySelectorAll: () => ({ forEach: () => {} }) },
      render: () => {},
      clamp: (v, min, max) => Math.max(min, Math.min(max, v))
    };
  }

  const trueContext = makeContext(false, false);
  const applyTrue = vm.runInNewContext('(' + applySource + ')', trueContext);
  await applyTrue({ sound: true }, { skipNavigation: true });
  assert.equal(trueContext.state.sound, true);
  assert.equal(trueContext.SoundSystem.enabled, true);

  const falseContext = makeContext(true, true);
  const applyFalse = vm.runInNewContext('(' + applySource + ')', falseContext);
  await applyFalse({ sound: false }, { skipNavigation: true });
  assert.equal(falseContext.state.sound, false);
  assert.equal(falseContext.SoundSystem.enabled, false);

  const unchangedContext = makeContext('unchanged-sound', 42);
  const applyUnchanged = vm.runInNewContext('(' + applySource + ')', unchangedContext);
  await applyUnchanged({ action: 'shutdown' }, { skipNavigation: true });
  assert.equal(unchangedContext.state.sound, 'unchanged-sound');
  assert.equal(unchangedContext.SoundSystem.enabled, 42);
});

test('executePowerAction does not manipulate volume', () => {
  const mainSource = readSource('main.js');
  const fnSource = extractFunction(mainSource, 'executePowerAction');
  assert.doesNotMatch(fnSource, /SendKeys/);
  assert.doesNotMatch(fnSource, /\[char\]173/);
  assert.doesNotMatch(fnSource, /VK_VOLUME_MUTE/);
  assert.doesNotMatch(fnSource, /muteSystemVolume/);
  assert.doesNotMatch(fnSource, /setSystemVolume/);
});

test('media source contract uses VK_MEDIA_PLAY_PAUSE (179) and keeps 174 out of play/pause paths', () => {
  const mediaSource = readSource('media.js');
  assert.match(
    mediaSource,
    /\[char\]179/,
    'media.js must contain the media play/pause key [char]179'
  );
  const pauseSource = extractFunction(mediaSource, 'pauseAllMedia');
  const resumeSource = extractFunction(mediaSource, 'resumeAllMedia');

  assert.match(
    pauseSource,
    /\[char\]179/,
    'pauseAllMedia must contain [char]179'
  );
  assert.doesNotMatch(
    pauseSource,
    /\[char\]174/,
    'pauseAllMedia must not contain the volume-down key [char]174'
  );

  assert.match(
    resumeSource,
    /\[char\]179/,
    'resumeAllMedia must contain [char]179'
  );
  assert.doesNotMatch(
    resumeSource,
    /\[char\]174/,
    'resumeAllMedia must not contain the volume-down key [char]174'
  );
});
