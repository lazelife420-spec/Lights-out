'use strict';

const { spawn } = require('node:child_process');
const readline = require('node:readline');

const DEFAULT_READY_TIMEOUT_MS = 10000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_STOP_TIMEOUT_MS = 2000;

class NativeInputWorker {
  constructor(scriptPath, options = {}) {
    this.scriptPath = scriptPath;
    this.spawnProcess = options.spawnProcess || spawn;
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.process = null;
    this.lines = null;
    this.pending = new Map();
    this.requestId = 0;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.readyTimer = null;
    this.stderr = '';
    this.state = 'idle';
  }

  clearReadyTimer() {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  settlePending(requestId, method, value) {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending[method](value);
    return true;
  }

  rejectAllPending(error) {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  terminate(error, { kill = false } = {}) {
    if (this.state === 'terminated') return;
    this.clearReadyTimer();
    if (this.readyReject) this.readyReject(error);
    this.readyResolve = null;
    this.readyReject = null;
    this.rejectAllPending(error);
    this.state = 'terminated';
    if (kill && this.process && this.process.exitCode === null && !this.process.killed) {
      try { this.process.kill(); } catch {}
    }
  }

  protocolFailure(message) {
    const error = new Error(`native worker protocol error: ${message}`);
    error.code = 'NATIVE_WORKER_PROTOCOL_ERROR';
    this.terminate(error, { kill: true });
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.protocolFailure(`invalid JSON: ${error.message}`);
      return;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
      this.protocolFailure('response must be an object with a string type');
      return;
    }

    if (message.type === 'ready') {
      if (this.state !== 'starting' || !this.readyResolve) {
        this.protocolFailure('unexpected ready response');
        return;
      }
      this.clearReadyTimer();
      this.state = 'ready';
      const resolve = this.readyResolve;
      this.readyResolve = null;
      this.readyReject = null;
      resolve(message);
      return;
    }

    if (message.type === 'stopped' && this.state === 'stopping') return;

    if (message.type !== 'result' || !Number.isSafeInteger(message.requestId) || typeof message.ok !== 'boolean') {
      this.protocolFailure('unusable result response');
      return;
    }

    const pending = this.pending.get(message.requestId);
    if (!pending) {
      this.protocolFailure(`response has no pending request: ${message.requestId}`);
      return;
    }

    if (message.ok) {
      this.settlePending(message.requestId, 'resolve', message.value);
    } else {
      const error = new Error(message.error || 'native worker request failed');
      error.nativeInput = message.errorData || null;
      this.settlePending(message.requestId, 'reject', error);
    }
  }

  handleExit(code, signal) {
    const wasStopping = this.state === 'stopping';
    const detail = `native worker exited ${code ?? 'without code'}${signal ? ` (${signal})` : ''}${this.stderr ? `: ${this.stderr}` : ''}`;
    const error = new Error(detail);
    error.code = 'NATIVE_WORKER_EXITED';
    if (wasStopping && this.pending.size === 0) {
      this.clearReadyTimer();
      this.state = 'terminated';
      return;
    }
    this.terminate(error);
  }

  async start() {
    if (this.state === 'ready') return this.readyPromise;
    if (this.state === 'starting') return this.readyPromise;
    if (this.state !== 'idle') throw new Error('native input worker is terminated');

    this.state = 'starting';
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(() => {
      const error = new Error('native input worker ready timeout');
      error.code = 'NATIVE_WORKER_READY_TIMEOUT';
      this.terminate(error, { kill: true });
    }, this.readyTimeoutMs);

    try {
      const child = this.spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.process = child;
      this.lines = readline.createInterface({ input: child.stdout });
      this.lines.on('line', line => this.handleLine(line));
      child.stderr.on('data', data => { this.stderr += data; });
      child.once('error', error => this.terminate(error));
      child.once('exit', (code, signal) => this.handleExit(code, signal));
    } catch (error) {
      this.terminate(error);
    }

    return this.readyPromise;
  }

  async request(payload) {
    await this.start();
    if (this.state !== 'ready' || !this.process || this.process.exitCode !== null || this.process.killed) {
      throw new Error('native input worker is unavailable');
    }

    const requestId = ++this.requestId;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`native input worker request ${requestId} timed out after ${this.requestTimeoutMs}ms`);
        error.code = 'NATIVE_WORKER_REQUEST_TIMEOUT';
        this.terminate(error, { kill: true });
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });

    try {
      this.process.stdin.write(`${JSON.stringify({ ...payload, requestId })}\n`, error => {
        if (error) this.terminate(error, { kill: true });
      });
    } catch (error) {
      this.terminate(error, { kill: true });
    }
    return response;
  }

  async stop() {
    if (this.state === 'idle' || this.state === 'terminated') return;
    const child = this.process;
    this.state = 'stopping';
    this.rejectAllPending(new Error('native input worker stopped with pending requests'));
    const requestId = ++this.requestId;
    try { child.stdin.write(`${JSON.stringify({ type: 'stop', requestId })}\n`); } catch {}

    if (child.exitCode === null && !child.killed) {
      await new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, this.stopTimeoutMs);
        child.once('exit', finish);
      });
    }
    if (child.exitCode === null && !child.killed) {
      try { child.kill(); } catch {}
    }
    this.clearReadyTimer();
    this.state = 'terminated';
  }
}

module.exports = {
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STOP_TIMEOUT_MS,
  NativeInputWorker
};
