'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_WARM_ITERATIONS,
  MAX_WARM_ITERATIONS,
  parseWarmIterations
} = require('../scripts/desktop-ux-gate-config');

test('warm iterations default only when the environment value is absent', () => {
  assert.equal(parseWarmIterations(undefined), DEFAULT_WARM_ITERATIONS);
});

test('warm iterations accept the inclusive bounded range', () => {
  assert.equal(parseWarmIterations('1'), 1);
  assert.equal(parseWarmIterations(String(MAX_WARM_ITERATIONS)), MAX_WARM_ITERATIONS);
  assert.equal(parseWarmIterations(' 5 '), 5);
});

for (const [label, value] of [
  ['zero', '0'],
  ['negative', '-1'],
  ['decimal', '1.5'],
  ['NaN spelling', 'NaN'],
  ['Infinity spelling', 'Infinity'],
  ['non-numeric garbage', 'five'],
  ['empty supplied value', ''],
  ['whitespace supplied value', '   '],
  ['upper-bound overflow', String(MAX_WARM_ITERATIONS + 1)]
]) {
  test(`warm iterations reject ${label}`, () => {
    assert.throws(
      () => parseWarmIterations(value),
      new RegExp(`integer from 1 to ${MAX_WARM_ITERATIONS}`)
    );
  });
}
