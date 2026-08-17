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
  document.querySelectorAll('.btn-mode').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
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
}

function renderFamilyPeers(peers) {
  if (!els.familyPeers) return;
  if (!peers.length) {
    els.familyPeers.innerHTML = '<p style="font-size:11px;color:var(--text-muted)">No other Lights Out instances found on your network.</p>';
    return;
  }
  els.familyPeers.innerHTML = peers.map(p => `
    <div class="family-peer" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bg-card)">
      <span style="flex:1;font-size:12px">&#x1F5A5; ${escapeHtml(p.name || p.ip)} <small style="color:var(--text-muted)">${escapeHtml(p.ip)}</small></span>
      <button class="btn-tiny" data-peer-ip="${escapeHtml(p.ip)}" data-peer-action="start" title="Start 30-min timer">&#x25B6;</button>
      <button class="btn-tiny" data-peer-ip="${escapeHtml(p.ip)}" data-peer-action="pause" title="Pause">&#x23F8;</button>
      <button class="btn-tiny" data-peer-ip="${escapeHtml(p.ip)}" data-peer-action="cancel" title="Cancel">&#x274C;</button>
    </div>
  `).join('');

  els.familyPeers.querySelectorAll('button[data-peer-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.peerAction;
      familyRemote(btn.dataset.peerIp, action, action === 'start' ? 30 : undefined);
    });
  });
}

window.familyRemote = async function(ip, action, duration) {
  try {
    if (action === 'start') await api.familyRemoteStart?.(ip, (duration || 30) * 60, 'shutdown');
    else if (action === 'pause') await api.familyRemotePause?.(ip);
    else if (action === 'cancel') await api.familyRemoteCancel?.(ip);
    notify(`Command sent to ${ip}`, 'info');
  } catch { notify('Command failed', 'error'); }
};

function renderWifiDevices(devices) {
  if (!els.wifiDeviceList) return;
  if (!devices.length) {
    els.wifiDeviceList.innerHTML = '<p style="font-size:11px;color:var(--text-muted)">No devices found. Make sure you\'re on the same network.</p>';
    return;
  }
  els.wifiDeviceList.innerHTML = devices.map(d => {
    const macSel = wifiSelectedDevices.macs.includes(d.mac);
    const ipSel = wifiSelectedDevices.ips.includes(d.ip);
    const selected = macSel || ipSel;
    return `<div class="wifi-device${selected ? ' selected' : ''}" data-mac="${escapeHtml(d.mac)}" data-ip="${escapeHtml(d.ip)}" style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;cursor:pointer;border:1px solid ${selected ? 'var(--accent-cyan)' : 'var(--bg-card)'};margin-bottom:3px;font-size:11px">
      <span style="flex:1">&#x1F4F1; ${escapeHtml(d.mac)} <small style="color:var(--text-muted)">${escapeHtml(d.ip)}</small></span>
      <span style="font-size:9px;color:var(--accent-cyan)">${selected ? 'BLOCKED' : 'click to block'}</span>
    </div>`;
  }).join('');

  // Click handlers to toggle selection.
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
      renderWifiDevices(devices);
    });
  });
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
    // Drive the "Also automated" summary on the Schedule > Automations tab.
    const autopilotText = status.enabled
      ? (status.learned?.bedtime ? `On \u00b7 ${status.learned.bedtime}` : 'On')
      : 'Off';
    if (els.asAutopilotStatus) els.asAutopilotStatus.textContent = autopilotText;
    // Schedule header "Next tonight" summary.
    if (els.schNextAutopilot) els.schNextAutopilot.textContent = `Autopilot: ${autopilotText.toLowerCase()}`;
  } catch {}
}
/* exported setupRemoteControlHandlers, renderFamilyPeers, renderWifiDevices, refreshTaxStats, refreshAutopilotStatus */
