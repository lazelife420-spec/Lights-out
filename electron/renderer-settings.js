// Renderer: Settings collect/apply (app settings, clock style, WiFi Guard,
// Content Blocker, Accountability), Customization panel, and the Warning
// modal (imminent-shutdown grace period). Loaded as a classic sibling
// <script>, after the six existing shards and before renderer.js.
//
// Unlike renderer-receipts.js/renderer-family-remote.js/renderer-ritual-focus.js,
// none of these 18 functions were nested inside wireEvents() -- verified via
// `typeof` at global scope before extracting (all already "function"). This
// is a straightforward top-level move, same risk profile as slices 1-3.
//
// Load-order requirement: must come after renderer-family-remote.js
// (collectWifiGuardSettings/applyWifiGuardSettings read/write the
// wifiSelectedDevices global declared there) and after renderer-ritual-focus.js
// (setupWarningHandlers calls showOverrideModal, declared there).
function normalizeClockFace(face) {
  return face === 'analog' ? 'analog' : 'digital';
}

/* exported collectWizSettings, applyWizSettings */
let wizDeviceDraft = [];
function collectWizSettings() {
  const field = id => document.getElementById(id);
  return {
    wizAddresses: (field('wiz-addresses')?.value || '').split(/[\s,;]+/).filter(Boolean).sort(),
    wizDevices: wizDeviceDraft.map(device => ({ ...device })),
    wizLook: {
      mode: field('wiz-look-mode')?.value || 'current',
      brightness: Number(field('wiz-brightness')?.value) || 50,
      temperature: Number(field('wiz-temperature')?.value) || 2700,
      color: field('wiz-color')?.value || '#ff9f43',
      sceneId: Number(field('wiz-scene')?.value) || 14
    }
  };
}

function renderWizDevices(devices = wizDeviceDraft) {
  const list = document.getElementById('wiz-device-list');
  const addresses = document.getElementById('wiz-addresses');
  if (!list || !addresses) return;
  const selected = new Set(addresses.value.split(/[\s,;]+/).filter(Boolean));
  const known = new Map(devices.map(device => [device.ip, { ...device }]));
  for (const ip of selected) if (!known.has(ip)) known.set(ip, { ip, name: '', room: '' });
  wizDeviceDraft = [...known.values()].slice(0, 64);
  list.replaceChildren();
  const choose = ips => {
    addresses.value = [...new Set(ips)].sort().slice(0, 32).join(', ');
    addresses.dispatchEvent(new Event('input', { bubbles: true }));
  };
  for (const device of wizDeviceDraft) {
    const row = document.createElement('div'); row.className = 'wiz-device-row';
    const label = document.createElement('label'); label.className = 'wiz-device-check';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(device.ip);
    checkbox.setAttribute('aria-label', `Control ${device.name || device.ip}`);
    checkbox.addEventListener('change', () => {
      const next = new Set(collectWizSettings().wizAddresses);
      if (checkbox.checked) next.add(device.ip); else next.delete(device.ip);
      choose([...next]);
    });
    const ip = document.createElement('span'); ip.textContent = device.ip;
    label.append(checkbox, ip);
    row.append(label);
    for (const key of ['name', 'room']) {
      const input = document.createElement('input'); input.type = 'text'; input.maxLength = 60;
      input.value = device[key] || ''; input.placeholder = key === 'name' ? 'Light name' : 'Room (optional)';
      input.setAttribute('aria-label', `${key === 'name' ? 'Light name' : 'Room'} for ${device.ip}`);
      input.addEventListener('input', () => { device[key] = input.value; });
      // Rebuild room buttons after editing, keeping focus in the input.
      input.addEventListener('change', () => renderWizRooms());
      row.append(input);
    }
    list.append(row);
  }
  if (!wizDeviceDraft.length) list.textContent = 'Find lights or enter an IP address to begin.';
  const count = document.getElementById('wiz-selection-count');
  if (count) count.textContent = `${selected.size} selected · up to 32 lights`;
  renderWizRooms();
}

function renderWizRooms() {
  const rooms = document.getElementById('wiz-room-options');
  if (!rooms) return;
  rooms.replaceChildren();
  for (const room of [...new Set(wizDeviceDraft.map(device => device.room.trim()).filter(Boolean))].sort()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-small';
    button.textContent = `Select ${room}`;
    button.addEventListener('click', () => {
      const addresses = document.getElementById('wiz-addresses');
      addresses.value = wizDeviceDraft.filter(device => device.room.trim() === room).map(device => device.ip).slice(0, 32).join(', ');
      addresses.dispatchEvent(new Event('input', { bubbles: true }));
    });
    rooms.append(button);
  }
}

function updateWizLookFields() {
  const mode = document.getElementById('wiz-look-mode')?.value || 'current';
  for (const kind of ['white', 'color', 'scene']) {
    const field = document.getElementById(`wiz-${kind}-field`);
    if (field) field.hidden = mode !== kind;
  }
  const brightness = document.getElementById('wiz-brightness-value');
  if (brightness) brightness.textContent = `${document.getElementById('wiz-brightness')?.value || 50}%`;
  const temperature = document.getElementById('wiz-temperature-value');
  if (temperature) temperature.textContent = `${document.getElementById('wiz-temperature')?.value || 2700} K`;
  const color = document.getElementById('wiz-color-value');
  if (color) color.textContent = (document.getElementById('wiz-color')?.value || '#ff9f43').toUpperCase();
}

function applyWizSettings(config) {
  wizDeviceDraft = (config.wizDevices || []).map(device => ({ ...device }));
  const look = config.wizLook || {};
  for (const [id, value] of Object.entries({ 'wiz-look-mode': look.mode || 'current', 'wiz-brightness': look.brightness || 50,
    'wiz-temperature': look.temperature || 2700, 'wiz-color': look.color || '#ff9f43', 'wiz-scene': look.sceneId || 14 })) {
    const field = document.getElementById(id); if (field) field.value = value;
  }
  renderWizDevices(); updateWizLookFields();
}
/* exported renderSettingsCategoryInfo, setupSettingsSearch */

const SETTINGS_CATEGORY_INFO = {
  general: ['General', 'The essentials for this PC.'],
  'power-safety': ['Power & Safety', 'Choose how a timer ends and keep the consequences clear.'],
  'wind-down': ['Wind-Down', 'Set the atmosphere as your night winds down.'],
  lighting: ['Lighting', 'Bring your WiZ lights, Hue rooms, or webhook into the routine.'],
  phone: ['Phone Companion', 'Connect your phone and the people sharing this PC.'],
  protection: ['Protection', 'Keep distracting apps and websites out of the way.'],
  accountability: ['Accountability', 'Choose the commitments that work for you.'],
  automations: ['Automations', 'Routines, focus timers, and morning alarms.'],
  appearance: ['Appearance & Sound', 'Your clock, your colours, your final scene.'],
  advanced: ['Advanced', 'Additional controls and maintenance.']
};

function renderSettingsCategoryInfo(category) {
  const info = SETTINGS_CATEGORY_INFO[category] || SETTINGS_CATEGORY_INFO.general;
  const title = document.getElementById('settings-category-title');
  const description = document.getElementById('settings-category-description');
  if (title) title.textContent = info[0];
  if (description) description.textContent = info[1];
  const content = document.getElementById('settings-categories');
  if (content) content.scrollTop = 0;
}

function setupSettingsSearch() {
  const input = document.getElementById('settings-search');
  const results = document.getElementById('settings-search-results');
  if (!input || !results) return;
  const close = () => { results.hidden = true; results.replaceChildren(); input.setAttribute('aria-expanded', 'false'); };
  input.addEventListener('input', () => {
    close(); const query = input.value.trim().toLocaleLowerCase();
    if (query.length < 2) return;
    const entries = [];
    for (const [category, info] of Object.entries(SETTINGS_CATEGORY_INFO)) {
      if (info.join(' ').toLocaleLowerCase().includes(query)) entries.push({ text: info[0], category, label: document.getElementById('settings-category-title') });
    }
    document.querySelectorAll('.settings-categories .option-section[data-settings-category]').forEach(section => {
      const category = section.dataset.settingsCategory;
      section.querySelectorAll('h3, .option-group > label, .set-row-title').forEach(label => {
        const text = label.textContent.trim().replace(/\s+/g, ' ');
        if (text.toLocaleLowerCase().includes(query) && !entries.some(entry => entry.text === text)) entries.push({ text, category, label });
      });
    });
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (!entries.length) { results.textContent = 'No matching settings.'; return; }
    for (const entry of entries.slice(0, 7)) {
      const button = document.createElement('button'); button.type = 'button';
      const title = document.createElement('span'); title.textContent = entry.text;
      const category = document.createElement('small'); category.textContent = SETTINGS_CATEGORY_INFO[entry.category]?.[0] || entry.category;
      button.append(title, category);
      button.addEventListener('click', () => {
        switchSettingsCategory(entry.category); close(); input.value = '';
        const target = entry.label.closest('.option-group') || entry.label;
        // A match inside a collapsed details panel must be revealed first.
        for (let ancestor=target.parentElement; ancestor; ancestor=ancestor.parentElement) if (ancestor.tagName==='DETAILS') ancestor.open=true;
        if (target.getClientRects().length) target.scrollIntoView({ block: 'center' });
        const field = [...target.querySelectorAll('input:not([type="hidden"]), select:not(.sr-only), button, textarea')].find(node => node.getClientRects().length);
        (field || document.getElementById('settings-category-title'))?.focus({ preventScroll: true });
      });
      results.append(button);
    }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); input.value = ''; event.stopPropagation(); }
    if (event.key === 'ArrowDown' && !results.hidden) { results.querySelector('button')?.focus(); event.preventDefault(); }
    if (event.key === 'Enter' && !results.hidden) { results.querySelector('button')?.click(); event.preventDefault(); }
  });
  results.addEventListener('keydown', event => {
    const buttons = [...results.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') { close(); input.focus(); event.preventDefault(); event.stopPropagation(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  });
  document.addEventListener('keydown', event => {
    if (document.getElementById('ns-panel-set')?.style.display === 'none') return;
    const typing = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
    if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) {
      event.preventDefault(); input.focus(); input.select();
    }
  });
  document.querySelector('.settings-rail')?.addEventListener('keydown', event => {
    const buttons = [...document.querySelectorAll('.settings-rail-btn')], index = buttons.indexOf(event.target);
    if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next].click(); buttons[next].focus(); buttons[next].scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.settings-search')) close(); });
  document.getElementById('modal-close')?.addEventListener('click', () => { close(); input.value=''; });
  document.getElementById('wiz-addresses')?.addEventListener('input', () => renderWizDevices());
  document.getElementById('wiz-select-all')?.addEventListener('click', () => {
    const addresses = document.getElementById('wiz-addresses');
    addresses.value = wizDeviceDraft.map(device => device.ip).slice(0, 32).join(', ');
    addresses.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.getElementById('wiz-select-none')?.addEventListener('click', () => {
    const addresses = document.getElementById('wiz-addresses'); addresses.value = '';
    addresses.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const id of ['wiz-look-mode', 'wiz-brightness', 'wiz-temperature', 'wiz-color']) document.getElementById(id)?.addEventListener('input', updateWizLookFields);
  document.getElementById('btn-discover-wiz')?.addEventListener('click', async event => {
    const button=event.currentTarget, status=document.getElementById('wiz-discovery-result');
    button.disabled=true; if(status) status.textContent='Looking for WiZ lights…';
    try {
      const lights=await api.discoverWizLights?.();
      if (!Array.isArray(lights) || !lights.length) { if(status) status.textContent='No lights found. Check the WiZ local communication setting, or enter their IP addresses.'; return; }
      const known = new Map(wizDeviceDraft.map(device => [device.ip, device]));
      for (const light of lights) if (!known.has(light.ip)) known.set(light.ip, { ip: light.ip, name: '', room: '' });
      renderWizDevices([...known.values()]);
      document.getElementById('wiz-addresses')?.dispatchEvent(new Event('input', { bubbles: true }));
      if(status) status.textContent=`Found ${lights.length} WiZ light(s). Select the lights or room to control, then Verify connection.`;
    } catch { if(status) status.textContent='Discovery could not finish. Enter the light IP addresses to connect directly.'; }
    finally { button.disabled=false; }
  });
}

function collectAppSettings() {
  const blocklistStr = els.focusBlocklist?.value?.trim() || '';
  const focusBlocklist = blocklistStr ? blocklistStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  return {
    action: state.action,
    unit: state.unit,
    durationSeconds: state.remainingSeconds,
    sound: state.sound,
    gracefulClose: state.gracefulClose,
    forceShutdown: state.forceShutdown,
    muteSystem: state.muteSystem,
    graceMinutes: state.graceMinutes,
    dryRun: state.dryRun,
    focusBlocklist,
    nightLightOnDim: els.chkNightlightDim?.checked || false,
    pauseMediaOnDim: els.chkPauseMediaDim?.checked || false,
    lockoutOnDim: els.chkLockoutDim?.checked || false,
    // Clock prefs come from applied state (the source of truth), not raw control
    // values, so a save can never clobber restored prefs with stale UI defaults.
    // clockMode is the user's preference (#chk-clock-mode, live): a loaded
    // profile only hides the clock for the moment (_clockDismissedByProfile)
    // and Save must not persist that as "off".
    clockMode: state._clockDismissedByProfile === true
      ? true
      : (typeof state.clockMode === 'boolean' ? state.clockMode : (els.chkClockMode?.checked ?? true)),
    clockFace: state.clockFace || els.czClockFace?.value || 'digital',
    clockStyle: state.clockStyle || els.czClockStyle?.value || 'modern',
    clockDial: state.clockDial || els.czClockDial?.value || 'bars',
    clockFormat: state.clockFormat || els.czClockFormat?.value || '24h',
    clockScale: Number.isFinite(Number(state.clockScale)) ? Number(state.clockScale) : Number(els.czClockScale?.value || 1),
    clockShowDate: Boolean(state.clockShowDate),
    clockHandColor: state.clockHandColor || els.czClockHands?.value || '#9b93d6',
    clockSeconds: state.clockSeconds !== false,
    clockSweep: state.clockSweep !== false,
    timerName: els.timerName?.textContent?.trim() || state.timerName || 'Last Call',
    // 'set'/'help' are modal-opening nav states, not persistent dashboard
    // views -- never persist them as the restorable tab, or a modal left
    // open when a save fires (Save button, live per-field auto-save, a
    // top-bar quick toggle) reopens itself on the next launch.
    nsActiveTab: (() => {
      const active = document.querySelector('.ns-nav-item.active')?.dataset?.nsTab || 'lib';
      if (active === 'set' || active === 'help') {
        return typeof settingsReturnTab === 'string' ? settingsReturnTab : 'lib';
      }
      return active;
    })(),
    nsSelectedMode: document.querySelector('.ns-mode-card.selected')?.dataset?.nsMode || ''
  };
}

async function applyAppSettings(app, { skipNavigation = false } = {}) {
  if (!app) return;
  const restoredArmedMode = app.armedNightMode && typeof app.armedNightMode === 'object'
    ? app.armedNightMode
    : null;
  if (app.armedNightMode !== undefined) state.armedNightMode = restoredArmedMode;
  if (restoredArmedMode) {
    // The selected plan is authoritative over stale custom controls. Main
    // still canonicalizes nightModeId plus execution values before starting.
    state.action = restoredArmedMode.action;
    state.unit = 'min';
  } else {
    if (app.action) state.action = app.action;
    if (app.unit) state.unit = app.unit;
  }
  if (typeof app.sound === 'boolean') { state.sound = app.sound; SoundSystem.enabled = app.sound; }
  if (typeof app.gracefulClose === 'boolean') state.gracefulClose = app.gracefulClose;
  if (typeof app.forceShutdown === 'boolean') state.forceShutdown = app.forceShutdown;
  if (typeof app.muteSystem === 'boolean') state.muteSystem = app.muteSystem;
  if (Number.isFinite(Number(app.graceMinutes))) state.graceMinutes = Number(app.graceMinutes);
  if (typeof app.dryRun === 'boolean') state.dryRun = app.dryRun;
  if (Array.isArray(app.focusBlocklist)) {
    if (els.focusBlocklist) els.focusBlocklist.value = app.focusBlocklist.join(',');
  }
  const restoredDuration = restoredArmedMode?.durationSeconds ?? app.durationSeconds;
  if (Number.isFinite(Number(restoredDuration)) && Number(restoredDuration) > 0 && !state.running) {
    state.remainingSeconds = Number(restoredDuration);
    setInputFromSeconds(state.remainingSeconds);
  }
  setAction(state.action);
  // Restore persisted toggle states for new features.
  if (els.chkIdleDetect) els.chkIdleDetect.checked = !!app.idleDetectionEnabled;
  if (els.chkBedtimeReminder) els.chkBedtimeReminder.checked = app.bedtimeReminderEnabled !== false;
  // #chk-calendar-autostart is not an app-section field: it mirrors
  // calendar.autoStartFromEvents, synced with Schedule's #cal-auto-start by
  // renderer-calendar.js (loadCalendarConfig / setScheduleAutoStart).
  if (els.chkNightlightDim) els.chkNightlightDim.checked = !!app.nightLightOnDim;
  if (els.chkPauseMediaDim) els.chkPauseMediaDim.checked = !!app.pauseMediaOnDim;
  if (els.chkLockoutDim) els.chkLockoutDim.checked = !!app.lockoutOnDim;
  // Autopilot override bedtime (persisted live as app.autopilotBedtime): show
  // the saved value, blank meaning "use the learned bedtime".
  if (els.autopilotOverrideTime) {
    els.autopilotOverrideTime.value = typeof app.autopilotBedtime === 'string' && /^\d{2}:\d{2}$/.test(app.autopilotBedtime)
      ? app.autopilotBedtime
      : '';
  }
  if (els.chkClockMode) els.chkClockMode.checked = app.clockMode !== false;
  state.clockMode = app.clockMode !== false;
  if (state.clockMode) state._clockDismissedByProfile = false; // explicit re-enable clears dismissal
  // The previous default was hybrid. Explicit analog choices remain analog;
  // missing, legacy-default and unknown values use the countdown ring.
  state.clockFace = normalizeClockFace(app.clockFace);
  if (els.czClockFace) els.czClockFace.value = state.clockFace;
  state.clockStyle = app.clockStyle || 'modern';
  state.clockDial = app.clockDial || 'bars';
  state.clockFormat = app.clockFormat || '24h';
  state.clockScale = Number.isFinite(Number(app.clockScale)) ? clamp(Number(app.clockScale), 0.8, 1.35) : 1;
  state.clockShowDate = !!app.clockShowDate;
  state.clockHandColor = app.clockHandColor || '#9b93d6';
  state.clockSeconds = app.clockSeconds !== false;
  state.clockSweep = app.clockSweep !== false;
  if (els.czClockStyle) els.czClockStyle.value = state.clockStyle;
  if (els.czClockDial) els.czClockDial.value = state.clockDial;
  if (els.czClockFormat) els.czClockFormat.value = state.clockFormat;
  if (els.czClockScale) els.czClockScale.value = String(state.clockScale);
  if (els.czClockScaleVal) els.czClockScaleVal.textContent = `${Math.round(state.clockScale * 100)}%`;
  if (els.czClockHands) els.czClockHands.value = effectiveClockHandColor(state.clockHandColor);
  if (els.czClockDate) els.czClockDate.checked = state.clockShowDate;
  if (els.czClockSeconds) els.czClockSeconds.checked = state.clockSeconds;
  if (els.czClockSweep) els.czClockSweep.checked = state.clockSweep;
  applyClockStyle();
  updateClockStyleVisibility();
  state.bedtime = app.bedtime || '';
  // Restore timer name.
  if (app.timerName && els.timerName) {
    els.timerName.textContent = app.timerName;
    state.timerName = app.timerName;
  }
  // UI-R3 Fire 04: mark the default name (presentation only; renderer.js).
  if (typeof syncTimerNameDefault === 'function') syncTimerNameDefault();
  // Restore northstar sidebar tab. If it is a modal/settings tab (set/help),
  // migrate it to 'lib' on disk and navigate to 'lib' by default.
  if (app.nsActiveTab === 'set' || app.nsActiveTab === 'help') {
    app.nsActiveTab = 'lib';
    await api.saveAppSettings({ app: { nsActiveTab: 'lib' } }).catch(error => {
      console.error('Failed to migrate legacy active tab:', error);
      throw error;
    });
  }
  if (!skipNavigation) {
    // UI-R3 Fire 03: the launch restore selects the page without moving
    // focus, so the app never opens with a keyboard focus ring on the rail.
    if (app.nsActiveTab) {
      handleSidebarNavigation(app.nsActiveTab, { persist: false, focusNav: false });
    } else {
      handleSidebarNavigation('lib', { persist: false, focusNav: false });
    }
  }
  // Restore northstar selected mode card.
  if (app.nsSelectedMode) {
    document.querySelectorAll('.ns-mode-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.nsMode === app.nsSelectedMode);
    });
  }
  render();
}

// Apply the clock style preset, hand color, and second-hand visibility to the analog SVG.
function applyClockStyle() {
  if (!els.analogClock) return;
  const style = state.clockStyle || 'modern';
  els.analogClock.classList.remove('style-modern', 'style-bold', 'style-minimal', 'style-neon', 'style-classic');
  els.analogClock.classList.add('style-' + style);
  els.analogClock.classList.toggle('hide-seconds', state.clockSeconds === false);
  els.analogClock.dataset.dial = resolveClockDial();
  els.analogClock.style.setProperty('--clock-hand-color', effectiveClockHandColor(state.clockHandColor));
  const clockScale = String(clamp(Number(state.clockScale) || 1, 0.8, 1.35));
  els.analogClock.style.setProperty('--clock-scale', clockScale);
  els.timerDisplay?.style.setProperty('--clock-scale', clockScale);
  buildAnalogTicks();
  buildAnalogNumerals();
  buildAnalogArabic();
}

// Clock customization controls only apply to analog/hybrid faces; hide them for digital.
function updateClockStyleVisibility() {
  if (!els.clockStyleGroup) return;
  const showsAnalog = state.clockFace === 'analog' || state.clockFace === 'hybrid';
  els.clockStyleGroup.style.display = showsAnalog ? '' : 'none';
}

function collectWifiGuardSettings() {
  const provider = els.selWifiProvider?.value || 'webhook';
  return {
    enabled: provider !== 'firewall' && (els.chkWifiGuard?.checked || false),
    provider,
    routerIp: els.wifiRouterIp?.value || '',
    routerUser: els.wifiRouterUser?.value || 'admin',
    routerPass: els.wifiRouterPass?.value || '',
    deviceMacs: [...wifiSelectedDevices.macs],
    deviceIps: [...wifiSelectedDevices.ips],
    webhookUrl: els.wifiWebhookUrl?.value || '',
    webhookHeaders: {},
    blockOnDim: els.chkWifiBlockDim?.checked ?? true,
    unblockOnCancel: els.chkWifiUnblockCancel?.checked ?? true
  };
}

function collectContentBlockerSettings() {
  const customStr = els.contentCustomBlocklist?.value?.trim() || '';
  const customList = customStr ? customStr.split('\n').map(s => s.trim()).filter(Boolean) : [];
  return {
    enabled: els.chkContentBlocker?.checked || false,
    blockOnDim: els.chkContentBlockDim?.checked ?? true,
    unblockOnComplete: els.chkContentUnblockComplete?.checked ?? true,
    blocklist: customList,
    useDefault: els.chkContentDefault?.checked ?? true
  };
}

function collectAccountabilitySettings() {
  const url = els.accWebhookUrl?.value?.trim() || '';
  const name = els.accPartnerName?.value?.trim() || 'Partner';
  const partners = url ? [{ type: 'webhook', url, name }] : [];
  return {
    enabled: els.chkAccountability?.checked || false,
    notifyOnStart: els.chkAccNotifyStart?.checked ?? true,
    notifyOnSnooze: els.chkAccNotifySnooze?.checked ?? true,
    notifyOnCancel: els.chkAccNotifyCancel?.checked ?? true,
    notifyOnComplete: els.chkAccNotifyComplete?.checked ?? false,
    partners
  };
}

function applyWifiGuardSettings(wifi) {
  if (!wifi) return;
  const supportedProvider = wifi.provider !== 'firewall';
  if (els.chkWifiGuard) els.chkWifiGuard.checked = supportedProvider && !!wifi.enabled;
  if (els.wifiGuardConfig) els.wifiGuardConfig.style.display = supportedProvider && wifi.enabled ? '' : 'none';
  if (els.selWifiProvider) {
    els.selWifiProvider.value = wifi.provider || 'webhook';
    els.selWifiProvider.dispatchEvent(new Event('change'));
  }
  if (els.wifiRouterIp) els.wifiRouterIp.value = wifi.routerIp || '';
  if (els.wifiRouterUser) els.wifiRouterUser.value = wifi.routerUser || 'admin';
  if (els.wifiRouterPass) els.wifiRouterPass.value = wifi.routerPass || '';
  if (els.wifiWebhookUrl) els.wifiWebhookUrl.value = wifi.webhookUrl || '';
  if (els.chkWifiBlockDim) els.chkWifiBlockDim.checked = wifi.blockOnDim !== false;
  if (els.chkWifiUnblockCancel) els.chkWifiUnblockCancel.checked = wifi.unblockOnCancel !== false;
  wifiSelectedDevices.macs = wifi.deviceMacs || [];
  wifiSelectedDevices.ips = wifi.deviceIps || [];
  // Keep the Wi-Fi Guard selection summary (renderer-family-remote.js) true.
  if (typeof renderWifiSelectedSummary === 'function') renderWifiSelectedSummary();
  if (els.wifiTestResult && wifi.setupError) {
    els.wifiTestResult.textContent = wifi.setupError;
    els.wifiTestResult.style.color = '#ff9800';
  }
}

function applyContentBlockerSettings(cb) {
  if (!cb) return;
  if (els.chkContentBlocker) els.chkContentBlocker.checked = !!cb.enabled;
  if (els.contentBlockerConfig) els.contentBlockerConfig.style.display = cb.enabled ? '' : 'none';
  if (els.chkContentDefault) els.chkContentDefault.checked = cb.useDefault !== false;
  if (els.contentCustomBlocklist) els.contentCustomBlocklist.value = (cb.blocklist || []).join('\n');
  // UI-R3 P13: the custom list is used only when the default list is off
  // (main blocks DEFAULT_BLOCKLIST alone whenever useDefault is on), so it is
  // disabled -- never cleared -- while the default list is on.
  if (els.contentCustomBlocklist && els.chkContentDefault) els.contentCustomBlocklist.disabled = els.chkContentDefault.checked;
  if (els.chkContentBlockDim) els.chkContentBlockDim.checked = cb.blockOnDim !== false;
  if (els.chkContentUnblockComplete) els.chkContentUnblockComplete.checked = cb.unblockOnComplete !== false;
  cbSchedules = Array.isArray(cb.schedules) ? cb.schedules : [];
  renderContentBlockerSchedules();
  if (els.contentTestResult && cb.setupError) {
    els.contentTestResult.textContent = cb.setupError;
    els.contentTestResult.style.color = '#ff9800';
  }
}

// Content Blocker recurring schedules -- independent of the shutdown timer's
// own dim-phase blocking (e.g. "block social media 22:00-07:00 every
// night" whether or not a timer happens to be running). Mirrors the
// Schedule tab's rule editor (renderer-calendar.js) exactly, including
// reusing its formatRuleTime/formatRuleDays/SCHEDULE_DAY_ORDER globals --
// same shape (label, days), just a start/end time window instead of a
// single time+duration since blocking needs a window, not a fire-once
// trigger.
let cbSchedules = [];
let editingCbScheduleId = null;

function renderContentBlockerSchedules() {
  const list = els.cbSchedulesList;
  if (!list) return;
  if (!cbSchedules.length) {
    list.innerHTML = '<div class="schedule-rules-empty">No blocking schedules yet. Add one to block sites on a recurring window, independent of the timer.</div>';
    return;
  }
  list.innerHTML = cbSchedules.map(rule => `
    <div class="schedule-rule-item ${rule.enabled === false ? 'disabled' : ''}" data-rule-id="${escapeHtml(rule.id)}">
      <div class="schedule-rule-info">
        <div class="schedule-rule-label">${escapeHtml(rule.label || 'Untitled')}</div>
        <div class="schedule-rule-detail">${formatRuleTime(rule.startTime)} &ndash; ${formatRuleTime(rule.endTime)} &middot; ${formatRuleDays(rule.days) || 'no days'}</div>
      </div>
      <div class="schedule-rule-actions">
        <input type="checkbox" class="cb-rule-enabled-toggle" data-rule-id="${escapeHtml(rule.id)}" title="Enabled" ${rule.enabled === false ? '' : 'checked'}>
        <button class="profile-item-btn cb-rule-edit-btn" data-rule-id="${escapeHtml(rule.id)}" type="button">Edit</button>
        <button class="profile-item-btn cb-rule-delete-btn" data-rule-id="${escapeHtml(rule.id)}" type="button">Delete</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.cb-rule-enabled-toggle').forEach(input => {
    input.addEventListener('change', () => {
      const rule = cbSchedules.find(r => r.id === input.dataset.ruleId);
      if (rule) { rule.enabled = input.checked; persistCbSchedules(); }
    });
  });
  list.querySelectorAll('.cb-rule-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openCbScheduleForm(btn.dataset.ruleId));
  });
  list.querySelectorAll('.cb-rule-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cbSchedules = cbSchedules.filter(r => r.id !== btn.dataset.ruleId);
      persistCbSchedules();
    });
  });
}

// Persists immediately (not deferred to the Options modal's bulk Save
// button) since a blocking schedule has a real-world effect independent of
// whether the user ever opens that modal again -- same reasoning as the
// Schedule tab's persistScheduleRules().
function persistCbSchedules() {
  renderContentBlockerSchedules();
  api.saveContentBlockerSettings?.({ schedules: cbSchedules });
}

function openCbScheduleForm(ruleId) {
  const form = els.cbScheduleForm;
  if (!form) return;
  editingCbScheduleId = ruleId || null;
  const rule = ruleId ? cbSchedules.find(r => r.id === ruleId) : null;
  if (els.cbRuleLabel) els.cbRuleLabel.value = rule?.label || '';
  if (els.cbRuleStart) els.cbRuleStart.value = rule?.startTime || '22:00';
  if (els.cbRuleEnd) els.cbRuleEnd.value = rule?.endTime || '07:00';
  const days = rule?.days || [...SCHEDULE_DAY_ORDER];
  els.cbRuleDays?.querySelectorAll('.day-toggle').forEach(btn => {
    btn.classList.toggle('active', days.includes(btn.dataset.day));
  });
  form.style.display = '';
  els.cbRuleLabel?.focus();
}

function closeCbScheduleForm() {
  if (els.cbScheduleForm) els.cbScheduleForm.style.display = 'none';
  editingCbScheduleId = null;
}

function saveCbScheduleFromForm() {
  const label = els.cbRuleLabel?.value?.trim() || 'Untitled';
  const startTime = els.cbRuleStart?.value || '22:00';
  const endTime = els.cbRuleEnd?.value || '07:00';
  const days = [...(els.cbRuleDays?.querySelectorAll('.day-toggle.active') || [])].map(b => b.dataset.day);
  if (!days.length) { notify('Pick at least one active day', 'warning'); return; }
  if (startTime === endTime) { notify('Start and end time can\'t be the same', 'warning'); return; }

  if (editingCbScheduleId) {
    const rule = cbSchedules.find(r => r.id === editingCbScheduleId);
    if (rule) Object.assign(rule, { label, startTime, endTime, days });
  } else {
    cbSchedules.push({
      id: `cbrule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label, startTime, endTime, days, enabled: true
    });
  }
  closeCbScheduleForm();
  persistCbSchedules();
  notify(`Blocking schedule "${label}" saved`, 'success');
}

function setupCbScheduleHandlers() {
  // UI-R3 P13: keep the custom blocklist's disabled state true to what the
  // blocker will use. The value is kept either way.
  els.chkContentDefault?.addEventListener('change', () => {
    if (els.contentCustomBlocklist) els.contentCustomBlocklist.disabled = els.chkContentDefault.checked;
  });
  els.btnAddCbSchedule?.addEventListener('click', () => openCbScheduleForm(null));
  els.btnCancelCbRule?.addEventListener('click', closeCbScheduleForm);
  els.btnSaveCbRule?.addEventListener('click', saveCbScheduleFromForm);
  els.cbRuleDays?.querySelectorAll('.day-toggle').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });
}

function applyAccountabilitySettings(acc) {
  if (!acc) return;
  if (els.chkAccountability) els.chkAccountability.checked = !!acc.enabled;
  if (els.accountabilityConfig) els.accountabilityConfig.style.display = acc.enabled ? '' : 'none';
  if (els.chkAccNotifyStart) els.chkAccNotifyStart.checked = acc.notifyOnStart !== false;
  if (els.chkAccNotifySnooze) els.chkAccNotifySnooze.checked = acc.notifyOnSnooze !== false;
  if (els.chkAccNotifyCancel) els.chkAccNotifyCancel.checked = acc.notifyOnCancel !== false;
  if (els.chkAccNotifyComplete) els.chkAccNotifyComplete.checked = !!acc.notifyOnComplete;
  if (acc.partners?.[0]) {
    if (els.accWebhookUrl) els.accWebhookUrl.value = acc.partners[0].url || '';
    if (els.accPartnerName) els.accPartnerName.value = acc.partners[0].name || 'Partner';
  }
  if (els.accTestResult && acc.setupError) {
    els.accTestResult.textContent = acc.setupError;
    els.accTestResult.style.color = '#ff9800';
  }
}

// -- Appearance grammar guard ------------------------------------------------
// Violet = you act, teal = live, amber = Test Mode / attention, red = REAL or
// destructive. A user accent may never borrow amber, red or teal, and a
// retired ring style may never repaint the idle instrument. Both limits are
// applied at RENDER time only: the saved settings value is never rewritten.
const RING_STYLES = ['glow', 'neon', 'midnight', 'solid', 'minimal'];
// The shipped v11.1.3 default accent. settings.save() persisted it for every
// upgraded install, so it renders as the product violet (like the old blue
// clock hand) without touching the saved value, and without the reserved note.
const LEGACY_DEFAULT_ACCENT = '#5b8cff';
// Ink drawn on accent-filled primary buttons (.ns-proof-btn-primary etc.).
const ACCENT_BUTTON_INK = '#14101f';
// --accent-blue (every hover / dim state) is the accent mixed this many percent
// toward black. 92 keeps hover text >= 4.5:1 on cards and the dark button ink
// >= 4.5:1 for every night-safe swatch (truth-contrast.test.js), while still
// visibly changing on hover. styles.css ships the same value for the default.
const ACCENT_HOVER_SHADE = 92;

function normalizeHexColor(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : null;
}

function hexToHsl(hex) {
  const n = normalizeHexColor(hex);
  if (!n) return null;
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

// WCAG 2.x contrast between two #rrggbb colours.
function hexContrast(a, b) {
  const lum = hex => {
    const n = normalizeHexColor(hex);
    const c = [1, 3, 5].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Returns the accent to render: the user's colour when it is night-safe,
// otherwise the product violet. Night-safe also means the dark button ink
// stays >= 4.5:1 on an accent-filled primary button.
function sanitizeAccent(hex) {
  const fallback = CUSTOMIZE_DEFAULTS.accent;
  const n = normalizeHexColor(hex);
  if (!n || n === LEGACY_DEFAULT_ACCENT) return fallback;
  const { h, s, l } = hexToHsl(n);
  const amber = h >= 15 && h <= 75;
  const live = h > 75 && h <= 195;
  const red = (h >= 330 || h <= 20) && s > 35;
  const washedOut = l < 45 || l > 85 || s < 15;
  const hidesLabel = hexContrast(n, ACCENT_BUTTON_INK) < 4.5;
  return amber || live || red || washedOut || hidesLabel ? fallback : n;
}

// True when a saved/picked accent is replaced because it is reserved. The
// retired v11.1.3 default and missing values are quietly drawn violet: the
// user never picked them, so no reserved-colour note.
function accentIsReserved(value) {
  const n = normalizeHexColor(value);
  if (!n || n === LEGACY_DEFAULT_ACCENT) return false;
  return sanitizeAccent(n) !== n;
}

function sanitizeRingStyle(value) {
  return RING_STYLES.includes(value) ? value : 'glow';
}

// The pre-R3 default clock hand was light blue. It renders violet; the saved
// value is left exactly as stored, and custom colours are never touched.
function effectiveClockHandColor(value) {
  const n = normalizeHexColor(value);
  if (!n || n === '#76c9ff') return '#9b93d6';
  return value;
}

function hexToRgbTriplet(hex) {
  const n = normalizeHexColor(hex) || CUSTOMIZE_DEFAULTS.accent;
  return `${parseInt(n.slice(1, 3), 16)}, ${parseInt(n.slice(3, 5), 16)}, ${parseInt(n.slice(5, 7), 16)}`;
}

function applyCustomization(c) {
  if (!c) return;
  const root = document.documentElement;
  const accent = sanitizeAccent(c.accent);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-cyan', accent);
  // The hover / dim variant is the accent darkened, never the accent itself:
  // with the raw accent every var(--accent-blue) hover was a no-op.
  root.style.setProperty('--accent-blue', `color-mix(in srgb, ${accent} ${ACCENT_HOVER_SHADE}%, #000)`);
  root.style.setProperty('--ring-fill', accent);
  root.style.setProperty('--accent-rgb', hexToRgbTriplet(accent));
  root.style.setProperty('--accent-glow', hexToRgba(accent, 0.45));
  if (c.theme) document.body.dataset.theme = c.theme;
  document.body.dataset.ring = sanitizeRingStyle(c.ringStyle);
  if (Number.isFinite(Number(c.opacity))) {
    const op = clamp(Number(c.opacity), 0.5, 1);
    if (previewMode) {
      root.style.setProperty('--app-opacity', op);
    } else {
      api.setWindowOpacity(op);
    }
  }
  if (Number.isFinite(Number(c.volume))) {
    SoundSystem.master = clamp(Number(c.volume), 0, 1);
  }
}

const CUSTOMIZE_DEFAULTS = { accent: '#9b93d6', theme: 'midnight', ringStyle: 'glow', opacity: 1, volume: 1, warmShift: true, soundscape: 'off', ambientVisual: 'off' };

// Swatch selection, the custom swatch and the reserved-colour note always
// show the accent that is actually rendered.
function syncAccentUI(c, { skipInput = false, rejected = null } = {}) {
  const effective = sanitizeAccent(c.accent);
  const isRejected = rejected === null ? accentIsReserved(c.accent) : rejected;
  if (els.czAccent && !skipInput) els.czAccent.value = effective;
  if (els.czSwatches) {
    els.czSwatches.querySelectorAll('.swatch').forEach(sw => {
      const on = sw.dataset.color.toLowerCase() === effective;
      sw.classList.toggle('active', on);
      sw.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  const note = document.getElementById('cz-accent-note');
  if (note) note.hidden = !isRejected;
}

function syncCustomizeUI() {
  const c = state.customization;
  if (els.czTheme) els.czTheme.value = c.theme;
  if (els.czRing) els.czRing.value = sanitizeRingStyle(c.ringStyle);
  if (els.czOpacity) els.czOpacity.value = c.opacity;
  if (els.czOpacityVal) els.czOpacityVal.textContent = `${Math.round(c.opacity * 100)}%`;
  if (els.czVolume) els.czVolume.value = c.volume;
  if (els.czVolumeVal) els.czVolumeVal.textContent = `${Math.round(c.volume * 100)}%`;
  if (els.czWarmShift) els.czWarmShift.checked = c.warmShift !== false;
  if (els.czSoundscape) els.czSoundscape.value = c.soundscape || 'off';
  if (els.czAmbient) els.czAmbient.value = c.ambientVisual || 'off';
  syncAccentUI(c);
  renderCustomSequences();
}

function setupCustomizeHandlers() {
  // Custom colour: preview night-safe colours live while dragging (never
  // snapping the picker mid-drag); commit, or fall back to violet with the
  // reserved-colour note, when the picker closes.
  els.czAccent?.addEventListener('input', () => {
    const picked = els.czAccent.value;
    if (sanitizeAccent(picked) !== normalizeHexColor(picked)) return;
    state.customization.accent = picked;
    applyCustomization(state.customization);
    syncAccentUI(state.customization, { skipInput: true });
  });
  els.czAccent?.addEventListener('change', () => {
    const picked = els.czAccent.value;
    const safe = sanitizeAccent(picked);
    state.customization.accent = safe;
    applyCustomization(state.customization);
    syncAccentUI(state.customization, { rejected: safe !== normalizeHexColor(picked) });
  });
  els.czSwatches?.querySelectorAll('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      state.customization.accent = sw.dataset.color;
      applyCustomization(state.customization);
      syncCustomizeUI();
    });
  });
  els.czTheme?.addEventListener('change', () => {
    state.customization.theme = els.czTheme.value;
    applyCustomization(state.customization);
  });
  els.czRing?.addEventListener('change', () => {
    state.customization.ringStyle = els.czRing.value;
    applyCustomization(state.customization);
  });
  els.czOpacity?.addEventListener('input', () => {
    state.customization.opacity = Number(els.czOpacity.value);
    applyCustomization(state.customization);
    if (els.czOpacityVal) els.czOpacityVal.textContent = `${Math.round(state.customization.opacity * 100)}%`;
  });
  els.czVolume?.addEventListener('input', () => {
    state.customization.volume = Number(els.czVolume.value);
    applyCustomization(state.customization);
    if (els.czVolumeVal) els.czVolumeVal.textContent = `${Math.round(state.customization.volume * 100)}%`;
  });
  els.btnResetCustomize?.addEventListener('click', () => {
    state.customization = { ...CUSTOMIZE_DEFAULTS };
    applyCustomization(state.customization);
    syncCustomizeUI();
    Soundscape.stop();
  });
  els.czWarmShift?.addEventListener('change', () => {
    state.customization.warmShift = els.czWarmShift.checked;
  });
  els.czSoundscape?.addEventListener('change', () => {
    state.customization.soundscape = els.czSoundscape.value;
    if (state.running) Soundscape.start(els.czSoundscape.value);
    else Soundscape.stop();
  });
  els.czAmbient?.addEventListener('change', () => {
    state.customization.ambientVisual = els.czAmbient.value;
    if (AmbientVisuals.isActive()) AmbientVisuals.start(els.czAmbient.value);
  });
  els.chkIdleDetect?.addEventListener('change', () => {
    api.setIdleThreshold?.(els.chkIdleDetect.checked ? 300 : 0);
    // Persist only the changed key; saveAppSettings deep-merges on the main side.
    api.saveAppSettings?.({ app: { idleDetectionEnabled: els.chkIdleDetect.checked } });
  });
  els.chkBedtimeReminder?.addEventListener('change', () => {
    api.setBedtimeReminder?.(els.chkBedtimeReminder.checked ? 15 : 0);
    api.saveAppSettings?.({ app: { bedtimeReminderEnabled: els.chkBedtimeReminder.checked } });
  });
  // The same persisted switch as Schedule's Auto-start
  // (calendar.autoStartFromEvents): one write path, both checkboxes mirror
  // main's answer, so the two can never disagree.
  els.chkCalendarAutostart?.addEventListener('change', () => {
    if (typeof setScheduleAutoStart === 'function') void setScheduleAutoStart(els.chkCalendarAutostart.checked);
    else api.setCalendarAutoStart?.(els.chkCalendarAutostart.checked);
  });
}

// The heads-up dialog is an instrument (UI-R3 P05): render() fills its
// countdown, ring and copy from the live timer state while it is open.
// main's message (the native notification text) is no longer shown here, so
// the dialog never makes a second, static time claim. _warnStart is the
// ring's full scale: the remaining time when the dialog opened.
function showWarningModal(_message) {
  if (!els.warningModal) return;
  state._warnStart = Number.isFinite(Number(state.remainingSeconds)) ? Math.max(1, Number(state.remainingSeconds)) : null;
  els.warningModal.classList.add('active');
}

function hideWarningModal() {
  state._warnStart = null;
  els.warningModal?.classList.remove('active');
}

// Warm shift: during the dim phase, body.warm-shift shows a faint amber wash
// in the room behind the app (.night-env), never a filter over the app
// itself, so the Test Mode / REAL truth and the controls keep full colour.
// Night Light (Windows) is a separate, opt-in main-process setting.
function applyWarmFilter() {
  if (state.customization.warmShift === false) return;
  document.body.classList.add('warm-shift');
}

function removeWarmFilter() {
  document.body.classList.remove('warm-shift');
}

function setupWarningHandlers() {
  els.warningSnooze?.addEventListener('click', () => {
    snooze(5 * 60);
    hideWarningModal();
  });
  els.warningCancel?.addEventListener('click', () => {
    cancelTimer();
    hideWarningModal();
  });
  els.warningDismiss?.addEventListener('click', hideWarningModal);
  els.warningOverride?.addEventListener('click', () => {
    hideWarningModal();
    showOverrideModal();
  });
  els.warningModal?.addEventListener('click', event => {
    if (event.target === els.warningModal) hideWarningModal();
  });
}
/* exported sanitizeAccent, accentIsReserved, sanitizeRingStyle, effectiveClockHandColor, collectAppSettings, applyAppSettings, collectWifiGuardSettings, collectContentBlockerSettings, collectAccountabilitySettings, applyWifiGuardSettings, applyContentBlockerSettings, setupCbScheduleHandlers, applyAccountabilitySettings, setupCustomizeHandlers, showWarningModal, applyWarmFilter, removeWarmFilter, setupWarningHandlers */
