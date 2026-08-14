'use strict';

const DEFAULT_WARM_ITERATIONS = 5;
const MAX_WARM_ITERATIONS = 50;

function parseWarmIterations(rawValue) {
  if (rawValue === undefined) return DEFAULT_WARM_ITERATIONS;

  const text = String(rawValue).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`LIGHTS_OUT_GATE_WARM_ITERATIONS must be an integer from 1 to ${MAX_WARM_ITERATIONS}`);
  }

  const iterations = Number(text);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_WARM_ITERATIONS) {
    throw new Error(`LIGHTS_OUT_GATE_WARM_ITERATIONS must be an integer from 1 to ${MAX_WARM_ITERATIONS}`);
  }

  return iterations;
}

module.exports = { DEFAULT_WARM_ITERATIONS, MAX_WARM_ITERATIONS, parseWarmIterations };
