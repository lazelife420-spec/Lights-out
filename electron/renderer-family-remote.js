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

function renderRemoteControl(rc) {
  if (!rc || !els.chkRemoteControl) return;
  els.chkRemoteControl.checked = !!rc.enabled;
  if (els.remoteControlConfig) els.remoteControlConfig.style.display = rc.enabled ? '' : 'none';
  if (els.remoteUrl) els.remoteUrl.textContent = rc.url || '';
  if (els.remoteToken) els.remoteToken.textContent = rc.token || '';
  updateRemoteQr(rc.url);
}

// Generate (or clear) the pairing QR for the current companion URL so the phone
// can pair by camera. Hidden whenever there is no URL or QR support.
async function updateRemoteQr(url) {
  if (!els.remoteQrWrap || !els.remoteQr) return;
  if (!url || !api.generateQr) { els.remoteQrWrap.style.display = 'none'; return; }
  try {
    const dataUrl = await api.generateQr(url);
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
  if (!els.chkRemoteControl) return;
  try { renderRemoteControl(await api.getRemoteControl?.()); } catch {}
}

function setupRemoteControlHandlers() {
  els.chkRemoteControl?.addEventListener('change', async () => {
    try {
      const rc = await api.setRemoteControlEnabled?.(els.chkRemoteControl.checked);
      renderRemoteControl(rc);
      notify(els.chkRemoteControl.checked ? 'Remote control enabled' : 'Remote control disabled', 'info');
    } catch { notify('Failed to update remote control', 'error'); }
  });
  els.btnRegenToken?.addEventListener('click', async () => {
    try {
      renderRemoteControl(await api.regenerateRemoteToken?.());
      notify('New pairing code generated', 'success');
    } catch { notify('Failed to regenerate code', 'error'); }
  });
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
  } catch {}
}
