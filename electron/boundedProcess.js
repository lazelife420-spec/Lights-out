'use strict';

// The caller supplies the executor. This module cannot launch a process by itself.
function runBounded({ spawn, file, args, timeoutMs = 5000, signal, errorPrefix = 'PROCESS', maxBytes = 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    let child, deadline, settled = false, output = '', errorOutput = '';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const stop = code => {
      finish(Object.assign(new Error(`${errorPrefix}: ${code}`), { code: `${errorPrefix}_${code}` }));
      try { child?.kill(); } catch { /* settling never depends on child teardown */ }
    };
    const abort = () => stop('ABORTED');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) {
      finish(Object.assign(new Error('Bounded timeout required'), { code: `${errorPrefix}_INVALID_TIMEOUT` })); return;
    }
    if (signal?.aborted) { abort(); return; }
    deadline = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const append = (data, stderr) => {
        if (settled) return;
        if (stderr) errorOutput += data.toString(); else output += data.toString();
        if (output.length + errorOutput.length > maxBytes) stop('OUTPUT_LIMIT');
      };
      child.stdout.on('data', data => append(data, false));
      child.stderr.on('data', data => append(data, true));
      child.on('error', error => finish(Object.assign(new Error(`${errorPrefix}: process could not start`), { code: error.code || `${errorPrefix}_SPAWN_FAILED` })));
      child.on('close', (code, terminationSignal) => {
        if (code === 0 && !terminationSignal) finish(null, output.trim());
        else finish(Object.assign(new Error(`${errorPrefix}: process did not complete successfully`), { code: `${errorPrefix}_FAILED`, exitCode: code, signal: terminationSignal || null }));
      });
      // Handles an abort delivered synchronously by an injected executor.
      if (signal?.aborted) abort();
    } catch (error) { finish(Object.assign(new Error(`${errorPrefix}: process could not start`), { code: error.code || `${errorPrefix}_SPAWN_FAILED` })); }
  });
}

module.exports = { runBounded };
