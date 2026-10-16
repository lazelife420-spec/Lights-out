// Renderer: Remote Control, Family LAN peers, WiFi Guard device list, and
// Override Tax / Autopilot status polling. Loaded as a classic sibling
// <script>, after the four existing shards and before renderer.js.
//
// SCOPE CHANGE, same pattern as renderer-receipts.js: all of these were
// nested inside wireEvents() in renderer.js (verified via
// `wireEvents.toString().includes('function setupRemoteControlHandlers')` ->
// true). Hoisting them here fixes a real, severe pre-existing bug: the
// bootstrap sequence at the bottom of renderer.js calls
// `setupRemoteControlHandlers();` as a bare top-level statement, genuinely
// outside wireEvents() (confirmed via `wireEvents.toString()` boundary
// inspection) and with no try/catch. Since setupRemoteControlHandlers was
// only reachable from *inside* wireEvents()'s own closures, that bootstrap
// call threw an uncaught ReferenceError on every app launch -- which halted
// every statement after it in that script: `setAction(state.action)`,
// `loadInitialData().finally(render)`, and `refreshStreakCallout()` never
// ran. Confirmed by reproducing the exact bootstrap call sequence live and
// watching it throw at exactly that line, then confirming
// wireEvents.toString() literally contains the nested declaration. Now that
// setupRemoteControlHandlers is a true global (defined in this earlier-
// loaded sibling file), that bootstrap call resolves correctly and the rest
// of the bootstrap sequence runs for the first time.
//
// `wifiSelectedDevices` was also wireEvents()-local (a `const`), which broke
// a *second* thing: collectWifiGuardSettings()/applyWifiGuardSettings() (true
// globals in renderer.js, added in a later slice's original code) reference
// `wifiSelectedDevices` but have no lexical access to wireEvents()'s locals --
// every click of the Options "Save" button threw "wifiSelectedDevices is not
// defined" inside the try/catch around api.saveAppSettings(...), silently
// aborting the ENTIRE settings save (app settings, customization, Last Light,
// run-at-login) and showing a confusing "Login settings failed" warning
// toast. Declaring it here as a true top-level global (loaded before
// renderer.js) fixes this the same way the calEvents hoist fixed the
// calendar auto-fetch bug in an earlier slice.
const wifiSelectedDevices = { macs: [], ips: [] };

// Plain-language explanation of what each mode actually exposes, shown
// below the mode selector -- "This PC only" reads like it enables remote
// control, but it means the opposite (loopback-only, unreachable from a
// phone), which is exactly the kind of confusion clearer settings copy
// needs to head off in a "safe by default" remote-control feature.
const REMOTE_MODE_DESCRIPTIONS = {
  off: 'No listener running. Nothing is exposed on your network.',
  local: 'Loopback only -- the companion server runs but only accepts connections from this PC. Not reachable from your phone or any other device.',
  wifi: 'Starts a token-protected listener on your private Wi-Fi. A pairing QR appears only after HTTP and WebSocket readiness checks pass.'
};
let remoteQrGeneration = 0;

function companionFailureMessage(rc) {
  if (!rc?.failed) return '';
  const owner = rc.failureDetails;
  if (rc.errorCode === 'EADDRINUSE') {
    const processText = owner?.pid
      ? ` Process ${owner.name || 'unknown'} (PID ${owner.pid})${owner.path ? ` at ${owner.path}` : ''} owns it.`
      : ' Another process owns it, but its identity could not be read.';
    return `Port ${rc.port} is already in use.${processText} Choose another port or close that app yourself, then retry.`;
  }
  return rc.errorMessage || 'The companion listener or its readiness check failed. Retry or choose another port.';
}

function renderRemoteControl(rc) {
  if (!rc) return;
  const mode = rc.mode || 'off';
  // UI-R3 P13: a segmented control. aria-pressed follows the real rc.mode, and
  // teal (live) marks the active segment only once the listener is verified.
  const live = mode !== 'off' && !rc.failed && Boolean(rc.ready || rc.connected);
  document.querySelectorAll('.btn-mode').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.classList.toggle('is-live', active && live);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (els.remoteModeDescription) {
    els.remoteModeDescription.textContent = rc.failed
      ? companionFailureMessage(rc)
      : rc.ready && mode === 'wifi'
        ? `Desktop endpoint ready at ${rc.lanIp}:${rc.port}. Phone reachability is confirmed only after an authenticated phone connects.`
        : REMOTE_MODE_DESCRIPTIONS[mode] || '';
  }
  if (els.companionStatusPill) {
    const statusClass = rc.failed ? 'status-failed' : rc.connected ? 'status-connected' : rc.ready ? `status-${mode}` : 'status-starting';
    els.companionStatusPill.className = `status-pill ${statusClass}`;
    els.companionStatusPill.textContent = rc.statusLabel || (mode === 'off' ? 'Off' : (mode === 'local' ? 'This PC only' : 'Same Wi-Fi'));
  }
  if (els.remoteControlConfig) els.remoteControlConfig.style.display = mode === 'off' ? 'none' : '';
  if (els.remotePort && document.activeElement !== els.remotePort) els.remotePort.value = String(rc.port || 58732);
  if (els.remoteUrl) els.remoteUrl.textContent = rc.ready ? (rc.url || '') : '';
  if (els.remoteShortCode) els.remoteShortCode.textContent = rc.ready && mode === 'wifi' ? (rc.shortCode || '') : '';
  if (els.companionPairingDetails) els.companionPairingDetails.style.display = rc.ready && mode === 'wifi' ? '' : 'none';
  if (els.remoteStartupError) els.remoteStartupError.style.display = rc.failed ? '' : 'none';
  if (els.remoteStartupErrorText) els.remoteStartupErrorText.textContent = companionFailureMessage(rc);
  const firewallWarning = mode === 'wifi' && rc.ready && rc.firewall && !rc.firewall.configured;
  if (els.remoteFirewallWarning) els.remoteFirewallWarning.style.display = firewallWarning ? '' : 'none';
  if (els.remoteFirewallWarningText) els.remoteFirewallWarningText.textContent = firewallWarning ? (rc.firewall.guidance || rc.firewall.error || '') : '';
  if (els.companionConnectedBadge) {
    els.companionConnectedBadge.style.display = rc.connected ? '' : 'none';
    els.companionConnectedBadge.textContent = rc.connected ? `${rc.clients} phone${rc.clients === 1 ? '' : 's'} connected` : '';
  }
  // Purely informational -- not a lockout, not an alarm. Shows only when
  // there's something to react to; disappears on its own once the user
  // regenerates the code (see companion.js's recordFailedAttempt).
  if (els.remoteFailedAttempts) {
    const count = rc.failedAttempts || 0;
    els.remoteFailedAttempts.style.display = count > 0 ? '' : 'none';
    if (count > 0 && els.remoteFailedAttemptsText) {
      const ipSuffix = rc.lastFailedIp ? ` (last from ${rc.lastFailedIp})` : '';
      els.remoteFailedAttemptsText.textContent = `${count} failed pairing attempt${count === 1 ? '' : 's'}${ipSuffix}`;
    }
  }
  updateRemoteQr(rc.ready && mode === 'wifi' ? rc.url : '');
}

// Generate (or clear) the pairing QR for the current companion URL so the phone
// can pair by camera. Hidden whenever there is no URL or QR support.
async function updateRemoteQr(url) {
  const generation = ++remoteQrGeneration;
  if (!els.remoteQrWrap || !els.remoteQr) return;
  if (!url || !api.generateQr) { els.remoteQrWrap.style.display = 'none'; return; }
  try {
    const dataUrl = await api.generateQr(url);
    if (generation !== remoteQrGeneration || els.remoteUrl?.textContent !== url) return;
    if (dataUrl) {
      els.remoteQr.src = dataUrl;
      els.remoteQrWrap.style.display = '';
    } else {
      els.remoteQrWrap.style.display = 'none';
    }
  } catch {
    els.remoteQrWrap.style.display = 'none';
  }
}

async function loadRemoteControlState() {
  if (!els.remoteControlConfig) return;
  try { renderRemoteControl(await api.getRemoteControl?.()); } catch {}
}

// Trusted LAN mode: "wifi" is the mode that actually exposes the companion
// server beyond this PC (binds 0.0.0.0, opens the firewall — see main.js
// startRemoteControl). Enabling it must be an explicit, informed choice, not
// a single accidental click, so it is gated behind a warning modal that
// states exactly what is exposed and what stays off-limits (never a forced
// shutdown/logout/hibernate). Resolves false if the user cancels or the
// modal is missing from the DOM.
function showLanWarningModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('lan-warning-modal');
    if (!modal) { resolve(false); return; }

    modal.classList.add('active');

    const confirmBtn = document.getElementById('btn-lan-warning-confirm');
    const cancelBtn = document.getElementById('btn-lan-warning-cancel');

    function cleanup() {
      modal.classList.remove('active');
      confirmBtn?.removeEventListener('click', onConfirm);
      cancelBtn?.removeEventListener('click', onCancel);
    }
    function onConfirm() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    confirmBtn?.addEventListener('click', onConfirm);
    cancelBtn?.addEventListener('click', onCancel);
  });
}

function setupRemoteControlHandlers() {
  document.querySelectorAll('.btn-mode').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      if (mode === 'wifi' && !btn.classList.contains('active')) {
        const confirmed = await showLanWarningModal();
        if (!confirmed) return;
      }
      try {
        const rc = await api.setRemoteControlMode?.(mode);
        renderRemoteControl(rc);
        notify(`Companion mode: ${mode}`, 'info');
      } catch { notify('Failed to update companion mode', 'error'); }
    });
  });
  els.btnTurnOffCompanion?.addEventListener('click', async () => {
    try {
      const rc = await api.setRemoteControlMode?.('off');
      renderRemoteControl(rc);
      notify('Companion turned off', 'info');
    } catch { notify('Failed to turn off companion', 'error'); }
  });
  els.btnCopyUrl?.addEventListener('click', () => {
    const url = els.remoteUrl?.textContent;
    if (url) {
      navigator.clipboard.writeText(url)
        .then(() => notify('URL copied to clipboard', 'success'))
        .catch(() => notify('Could not copy the companion URL', 'error'));
    }
  });
  els.btnRegenToken?.addEventListener('click', async () => {
    try {
      const rc = await api.regenerateRemoteToken?.();
      renderRemoteControl(rc);
      notify(rc?.ready ? 'New pairing code generated and verified' : 'Pairing code changed; companion is still unavailable', rc?.ready ? 'success' : 'warning');
    } catch { notify('Failed to regenerate code', 'error'); }
  });
  els.btnRetryCompanion?.addEventListener('click', async () => {
    try {
      const rc = await api.retryRemoteControl?.();
      renderRemoteControl(rc);
      notify(rc?.ready ? 'Companion connection verified' : 'Companion is still unavailable', rc?.ready ? 'success' : 'error');
    } catch (error) {
      notify(`Companion retry failed: ${error.message || error}`, 'error');
    }
  });
  els.btnSaveCompanionPort?.addEventListener('click', async () => {
    try {
      const rc = await api.setRemoteControlPort?.(Number(els.remotePort?.value));
      renderRemoteControl(rc);
      notify(rc?.ready ? `Companion verified on port ${rc.port}` : `Port ${rc?.port || els.remotePort?.value} is not ready`, rc?.ready ? 'success' : 'error');
    } catch (error) {
      notify(error.message || 'Invalid companion port', 'error');
    }
  });
  api.onRemoteControlStatus?.(renderRemoteControl);
  loadRemoteControlState();
  setupFamilyPeerSettingsHandlers();
  setupWifiSelectionHandlers();
}

// ─── Family peer results: one interpreter for Devices and Settings ─────────
// Every answer a peer gives (or fails to give) maps to plain words and a tone:
// ok (teal) for a real success, warn (amber) for a refusal, bad (red) for an
// error. A success without a known code reads 'Done'. Never 'Command sent'.
const PEER_RESULT = Object.freeze({
  PAUSED: 'Paused',
  RESUMED: 'Resumed',
  CANCELLED: 'Run stopped',
  NOT_RUNNING: 'No run active there',
  NOT_PAUSED: 'Not paused',
  RUN_ACTIVE: 'A run is already active there',
  STARTED: 'Timer started there',
  START_REJECTED: 'That PC refused the start',
  STATUS: 'State read',
  INVALID: 'That PC refused the request',
  UNKNOWN_COMMAND: 'Not supported there'
});
const PEER_ERROR = Object.freeze({
  unauthorized: { text: 'Pairing code differs on that PC', tone: 'bad' },
  'unknown command': { text: 'State not shared (older Lights Out)', tone: 'warn' },
  'unknown peer': { text: 'That PC is no longer announcing itself', tone: 'bad' }
});
const PEER_TONE_NOTIFY = Object.freeze({ ok: 'success', warn: 'warning', bad: 'error', muted: 'info' });

function interpretPeerResult(r, failure) {
  if (failure) {
    const message = String((failure && failure.message) || failure);
    return /Timeout/.test(message)
      ? { text: 'No answer (timed out)', tone: 'bad' }
      : { text: 'Could not reach that PC', tone: 'bad' };
  }
  if (!r || typeof r !== 'object') return { text: 'Could not reach that PC', tone: 'bad' };
  if (r.success === true) {
    return { text: Object.prototype.hasOwnProperty.call(PEER_RESULT, r.code) ? PEER_RESULT[r.code] : 'Done', tone: 'ok' };
  }
  if (typeof r.code === 'string' && Object.prototype.hasOwnProperty.call(PEER_RESULT, r.code)) {
    return { text: PEER_RESULT[r.code], tone: 'warn' };
  }
  const error = typeof r.error === 'string' ? r.error : '';
  if (Object.prototype.hasOwnProperty.call(PEER_ERROR, error)) return { ...PEER_ERROR[error] };
  if (!error || error === 'bad response') return { text: 'Unexpected answer from that PC', tone: 'bad' };
  if (/^HTTP \d+$/.test(error)) return { text: `That PC answered ${error}`, tone: 'bad' };
  // Any other refusal text comes from the peer (untrusted): shown as text only.
  return { text: `Refused there: ${error.slice(0, 120)}`, tone: 'warn' };
}

// ─── Settings › Phone › Family Mode rows ───────────────────────────────────
// Text buttons, name + mono IP. Start never fires on the first click: it opens
// an inline confirm bound to that one IP, with 'Keep idle' focused. A
// re-render (Scan again) cancels a pending confirm and sends nothing.
let familySettingsPeers = [];
let familyStartConfirmIp = null;

function familyPeerName(ip) {
  const peer = familySettingsPeers.find(p => p.ip === ip);
  return (peer && peer.name) || ip;
}

function renderFamilyPeers(peers) {
  if (!els.familyPeers) return;
  familyStartConfirmIp = null;
  familySettingsPeers = (Array.isArray(peers) ? peers : []).filter(p => p && typeof p.ip === 'string' && p.ip);
  if (!familySettingsPeers.length) {
    els.familyPeers.innerHTML = '<p class="help-text">No other Lights Out instances found on your network.</p>';
    return;
  }
  els.familyPeers.innerHTML = familySettingsPeers.map(p => {
    const ip = escapeHtml(p.ip);
    const name = escapeHtml(p.name || p.ip);
    return `<div class="set-peer" data-peer-ip="${ip}">
      <span class="set-peer-id"><span class="set-peer-name">${name}</span><span class="set-peer-ip">${ip}</span></span>
      <span class="set-peer-actions">
        <button type="button" class="btn-secondary btn-sm" data-peer-ip="${ip}" data-peer-action="start" aria-label="Start a 30-minute timer on ${name}">Start 30 min</button>
        <button type="button" class="btn-secondary btn-sm" data-peer-ip="${ip}" data-peer-action="pause" aria-label="Pause the timer on ${name}">Pause</button>
        <button type="button" class="btn-secondary btn-sm" data-peer-ip="${ip}" data-peer-action="cancel" aria-label="Cancel the timer on ${name}">Cancel timer</button>
      </span>
    </div>`;
  }).join('');
}

// mode: 'test' | 'real' | null. No read-only peer status exists yet (it is a
// LAN protocol change awaiting owner sign-off), so callers pass null and the
// confirm never claims a mode it has not read.
function familyStartConfirmText(name, ip, mode = null) {
  const ask = `Start a 30-minute Shutdown timer on ${name} (${ip})?`;
  if (mode === 'test') return `${ask} ${name} is in Test Mode, so nothing will power off.`;
  if (mode === 'real') return `${ask} ${name} will really shut down when it ends.`;
  return `${ask} That PC's own Test Mode setting applies; its mode is unknown.`;
}

function familyPeerSettingsRow(ip) {
  if (!els.familyPeers) return null;
  return [...els.familyPeers.querySelectorAll('.set-peer')].find(el => el.dataset.peerIp === ip) || null;
}

function closeFamilyStartConfirm({ restoreFocus = false } = {}) {
  const ip = familyStartConfirmIp;
  familyStartConfirmIp = null;
  els.familyPeers?.querySelectorAll('.set-peer-confirm').forEach(box => box.remove());
  if (restoreFocus && ip) {
    const start = familyPeerSettingsRow(ip)?.querySelector('button[data-peer-action="start"]');
    start?.focus();
  }
}

function openFamilyStartConfirm(ip) {
  closeFamilyStartConfirm();
  const row = familyPeerSettingsRow(ip);
  if (!row) return;
  familyStartConfirmIp = ip;
  const name = familyPeerName(ip);
  const box = document.createElement('div');
  box.className = 'set-peer-confirm';
  box.dataset.confirmIp = ip;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `Confirm a timer on ${name}`);
  const text = document.createElement('p');
  text.className = 'set-peer-confirm-text';
  text.textContent = familyStartConfirmText(name, ip, null);
  const actions = document.createElement('div');
  actions.className = 'set-peer-confirm-actions';
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'btn-secondary btn-sm';
  keep.dataset.confirm = 'keep';
  keep.textContent = 'Keep idle';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn-secondary btn-sm set-peer-confirm-go';
  go.dataset.confirm = 'start';
  go.textContent = 'Start';
  actions.append(keep, go);
  box.append(text, actions);
  row.after(box);
  keep.focus();
}

function setupFamilyPeerSettingsHandlers() {
  if (!els.familyPeers || els.familyPeers.dataset.wired === '1') return;
  els.familyPeers.dataset.wired = '1';
  els.familyPeers.addEventListener('click', (event) => {
    const confirmBtn = event.target.closest?.('button[data-confirm]');
    if (confirmBtn) {
      const ip = confirmBtn.closest('.set-peer-confirm')?.dataset.confirmIp;
      const confirmed = confirmBtn.dataset.confirm === 'start' && ip && ip === familyStartConfirmIp;
      closeFamilyStartConfirm({ restoreFocus: true });
      if (confirmed) void window.familyRemote(ip, 'start', 30);
      return;
    }
    const btn = event.target.closest?.('button[data-peer-action]');
    if (!btn) return;
    const ip = btn.dataset.peerIp;
    const action = btn.dataset.peerAction;
    if (action === 'start') openFamilyStartConfirm(ip);
    else if (action === 'pause' || action === 'cancel') void window.familyRemote(ip, action);
  });
  els.familyPeers.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !event.target.closest?.('.set-peer-confirm')) return;
    event.preventDefault();
    event.stopPropagation();
    closeFamilyStartConfirm({ restoreFocus: true });
  });
}

// Awaits the real answer and reports it through the interpreter.
window.familyRemote = async function(ip, action, duration) {
  const calls = {
    start: () => api.familyRemoteStart?.(ip, (duration || 30) * 60, 'shutdown'),
    pause: () => api.familyRemotePause?.(ip),
    resume: () => api.familyRemoteResume?.(ip),
    cancel: () => api.familyRemoteCancel?.(ip)
  };
  const call = calls[action];
  if (!call) return { text: 'Unknown action', tone: 'bad' };
  let answer;
  let failure = null;
  try {
    answer = await call();
  } catch (err) {
    failure = err || new Error('failed');
  }
  const outcome = interpretPeerResult(answer, failure);
  notify(`${familyPeerName(ip)}: ${outcome.text}`, PEER_TONE_NOTIFY[outcome.tone] || 'info');
  return outcome;
};

// ─── Settings › Protection › Wi-Fi Guard device list ───────────────────────
// A click only SELECTS a device for a future bedtime block: nothing is blocked
// here, so the row says 'Selected' or 'Select' and never claims a block.
const WIFI_ROUTER_PROVIDERS = ['tplink', 'asus', 'netgear'];

function wifiSelectedCount() {
  return Math.max(wifiSelectedDevices.macs.length, wifiSelectedDevices.ips.length);
}

function renderWifiSelectedSummary() {
  const out = document.getElementById('wifi-selected-summary');
  if (!out) return;
  const n = wifiSelectedCount();
  const provider = els.selWifiProvider?.value || '';
  const guardOn = Boolean(els.chkWifiGuard?.checked);
  const blockOnDim = Boolean(els.chkWifiBlockDim?.checked);
  const restoreOnCancel = Boolean(els.chkWifiUnblockCancel?.checked);
  let text;
  if (provider === 'adapter') {
    text = `${n} selected · Wi-Fi adapter mode ignores this list: it turns off this PC's own Wi-Fi.`;
  } else if (guardOn && blockOnDim && (WIFI_ROUTER_PROVIDERS.includes(provider) || provider === 'webhook')) {
    text = `${n} selected · sent to your ${provider === 'webhook' ? 'webhook' : 'router'} when the dim phase starts`
      + (restoreOnCancel ? ' · restored if you cancel' : ' · not restored automatically');
  } else {
    text = `${n} selected · not blocked automatically`;
  }
  out.textContent = text;
}

function renderWifiDevices(devices) {
  if (!els.wifiDeviceList) return;
  const list = Array.isArray(devices) ? devices : [];
  if (!list.length) {
    els.wifiDeviceList.innerHTML = '<p class="help-text">No devices found. Make sure you\'re on the same network.</p>';
    renderWifiSelectedSummary();
    return;
  }
  const focusedMac = document.activeElement?.closest?.('.wifi-device')?.dataset.mac;
  els.wifiDeviceList.innerHTML = list.map(d => {
    const selected = wifiSelectedDevices.macs.includes(d.mac) || wifiSelectedDevices.ips.includes(d.ip);
    return `<button type="button" class="wifi-device set-device${selected ? ' is-selected' : ''}" data-mac="${escapeHtml(d.mac)}" data-ip="${escapeHtml(d.ip)}" aria-pressed="${selected ? 'true' : 'false'}">
      <span class="set-device-id">${escapeHtml(d.mac)}</span><span class="set-device-ip">${escapeHtml(d.ip)}</span><span class="set-device-state">${selected ? 'Selected' : 'Select'}</span>
    </button>`;
  }).join('');

  // A native button: Enter/Space already fire click, so no keydown handler.
  els.wifiDeviceList.querySelectorAll('.wifi-device').forEach(el => {
    el.addEventListener('click', () => {
      const mac = el.dataset.mac;
      const ip = el.dataset.ip;
      if (wifiSelectedDevices.macs.includes(mac)) {
        wifiSelectedDevices.macs = wifiSelectedDevices.macs.filter(m => m !== mac);
        wifiSelectedDevices.ips = wifiSelectedDevices.ips.filter(i => i !== ip);
      } else {
        wifiSelectedDevices.macs.push(mac);
        wifiSelectedDevices.ips.push(ip);
      }
      renderWifiDevices(list);
    });
  });
  // Keep keyboard focus on the device that was just toggled.
  if (focusedMac) {
    [...els.wifiDeviceList.querySelectorAll('.wifi-device')].find(el => el.dataset.mac === focusedMac)?.focus();
  }
  renderWifiSelectedSummary();
}

function setupWifiSelectionHandlers() {
  for (const el of [els.chkWifiBlockDim, els.chkWifiUnblockCancel, els.chkWifiGuard, els.selWifiProvider]) {
    el?.addEventListener('change', renderWifiSelectedSummary);
  }
  renderWifiSelectedSummary();
}

async function refreshTaxStats() {
  try {
    const stats = await api.getOverrideTaxStats?.();
    if (stats) {
      if (els.taxSessionCount) els.taxSessionCount.textContent = stats.sessionSnoozeCount;
      if (els.taxTomorrowDebt) els.taxTomorrowDebt.textContent = `${stats.tomorrowDebt} min`;
    }
  } catch {}
}

async function refreshAutopilotStatus() {
  try {
    const status = await api.getAutopilotStatus?.();
    if (!status) return;
    if (els.chkAutopilot) els.chkAutopilot.checked = status.enabled;
    if (els.autopilotConfig) els.autopilotConfig.style.display = status.enabled ? '' : 'none';
    if (status.learned) {
      if (els.autopilotLearned) els.autopilotLearned.textContent = status.learned.bedtime;
      if (els.autopilotConfidence) {
        els.autopilotConfidence.textContent = status.learned.confidence;
        els.autopilotConfidence.style.color = status.learned.confidence === 'high' ? '#4caf50' : status.learned.confidence === 'medium' ? '#ff9800' : '#ff4d4d';
      }
      if (els.autopilotSample) els.autopilotSample.textContent = `${status.learned.sampleSize} nights`;
    }
  } catch {}
}
/* exported setupRemoteControlHandlers, renderFamilyPeers, renderWifiDevices, renderWifiSelectedSummary, interpretPeerResult, refreshTaxStats, refreshAutopilotStatus */
