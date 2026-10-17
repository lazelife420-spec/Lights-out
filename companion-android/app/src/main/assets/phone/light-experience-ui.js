/* global document, LightExperience */
(function (root) {
  'use strict';
  function mount(container, invoke) {
    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    let dirty = false, busy = false, current, mode = 'off', brightness = 35, timer = 0;
    const started = performance.now();
    const status = el('p', 'Loading light settings…', 'light-save-status');
    status.setAttribute('role', 'status');
    const body = el('div');
    container.append(body);
    body.append(status);
    const button = (text, fn) => {
      const node = el('button', text, 'secondary');
      node.type = 'button';
      node.onclick = () => void task(fn);
      return node;
    };
    async function task(fn) {
      if (busy) return;
      busy = true;
      container.setAttribute('aria-busy', 'true');
      const pendingSave = container.querySelector('[data-light-experience="save"]');
      if (pendingSave) pendingSave.disabled = true;
      try { await fn(); }
      catch (error) { status.textContent = error.message || 'Could not save. Your edits are still here.'; }
      finally {
        busy = false; container.removeAttribute('aria-busy');
        const save = container.querySelector('[data-light-experience="save"]');
        if (save) save.disabled = !dirty;
      }
    }
    function draw(data) {
      current = data;
      dirty = false;
      body.replaceChildren();
      const settings = data.settings || {};
      mode = settings.timerMode || 'off';
      brightness = settings.brightness || 35;
      const section = (number, title, copy) => {
        const card = el('section', undefined, 'light-builder-section');
        const heading = el('div', undefined, 'light-section-heading');
        heading.append(el('span', number, 'light-section-number'), el('h3', title));
        card.append(heading);
        if (copy) card.append(el('p', copy, 'view-copy'));
        body.append(card);
        return card;
      };
      const choice = (text, id, checked = false, description) => {
        const label = el('label', undefined, 'check light-choice');
        const input = el('input');
        input.type = 'checkbox'; input.checked = checked; input.dataset.lightExperience = id;
        const copy = el('span', undefined, 'light-choice-copy');
        copy.append(el('span', text));
        if (description) copy.append(el('small', description));
        label.append(input, copy);
        return { label, input };
      };
      const changes = () => { dirty = true; status.textContent = 'Unsaved changes'; save.disabled = busy; };
      const modeSection = section('01', 'Your countdown, in light', 'Follows this phone’s timer, including pause and resume.');
      const select = el('select');
      select.hidden = true; select.dataset.lightExperience = 'mode';
      const modes = [
        ['off', 'Off', 'Leave the lights as they are.'],
        ['hourglass', 'Room Hourglass', 'Warm light drains across the room.'],
        ['orbit', 'Orbit', 'A cool accent, a warm landing.'],
        ['ember', 'Ember', 'A slow breath into the night.']
      ];
      const modeGrid = el('div', undefined, 'light-mode-grid');
      modeGrid.setAttribute('role', 'group'); modeGrid.setAttribute('aria-label', 'Timer light mode');
      for (const [value, name, copy] of modes) {
        const option = el('option', name); option.value = value; select.append(option);
        const card = el('button', undefined, 'light-mode-card');
        card.type = 'button'; card.dataset.lightMode = value;
        const art = el('span', undefined, 'light-mode-art art-' + value); art.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 4; i++) art.append(el('i'));
        card.append(art, el('strong', name), el('small', copy));
        card.onclick = () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
        modeGrid.append(card);
      }
      select.value = mode;
      modeSection.append(select, modeGrid);
      const preview = el('div', undefined, 'light-preview-card');
      const previewHeading = el('div', undefined, 'light-preview-heading');
      const previewTitle = el('strong');
      previewHeading.append(previewTitle, el('span', 'Screen preview', 'light-preview-badge'));
      preview.append(previewHeading);
      const stage = el('div', undefined, 'light-experience-preview'); stage.setAttribute('aria-hidden', 'true');
      const orbs = Array.from({ length: 4 }, () => { const orb = el('i'); stage.append(orb); return orb; });
      preview.append(stage);
      const previewLabel = el('label', 'Move through your timer');
      const positionOutput = el('output', '45%'); previewLabel.append(positionOutput);
      const positions = el('input'); positions.type = 'range'; positions.min = 0; positions.max = 100; positions.value = 45;
      positions.id = 'light-mode-preview-position'; previewLabel.htmlFor = positions.id; positionOutput.htmlFor = positions.id;
      positions.oninput = () => { positionOutput.value = positions.value + '%'; paint(); };
      preview.append(previewLabel, positions, el('p', 'Preview only. No lights change.', 'light-preview-note'));
      modeSection.append(preview);
      const level = el('label', 'Effect brightness');
      const output = el('output', brightness + '%'); level.append(output);
      const range = el('input'); range.type = 'range'; range.min = 10; range.max = 60; range.value = brightness;
      range.id = 'light-mode-brightness'; level.htmlFor = range.id; output.htmlFor = range.id;
      range.dataset.lightExperience = 'brightness';
      const levelGroup = el('div', undefined, 'light-brightness-control'); levelGroup.append(level, range); modeSection.append(levelGroup);
      const syncMode = () => {
        mode = select.value;
        for (const card of modeGrid.children) card.setAttribute('aria-pressed', String(card.dataset.lightMode === mode));
        previewTitle.textContent = modes.find(item => item[0] === mode)?.[1] || 'Off';
        preview.hidden = mode === 'off'; levelGroup.hidden = mode === 'off';
        paint();
      };
      select.onchange = () => { syncMode(); changes(); };
      range.oninput = () => { brightness = Number(range.value); output.value = brightness + '%'; changes(); paint(); };
      function lights(parent, title, key) {
        const field = el('fieldset', undefined, 'light-target-picker');
        field.append(el('legend', title));
        const list = el('div', undefined, 'light-target-grid');
        const picked = new Set(settings[key] || []);
        for (const ip of data.lights || []) {
          const row = choice(ip, key + ':' + ip, picked.has(ip));
          row.input.value = ip; row.input.onchange = changes; list.append(row.label);
        }
        if (!(data.lights || []).length) list.append(el('p', 'Save your WiZ lights above to choose them here.', 'light-empty'));
        field.append(list); parent.append(field);
        return () => [...field.querySelectorAll('input:checked')].map(node => node.value);
      }
      const timerTargets = lights(modeSection, 'Lights for the countdown', 'timerTargets');
      const alerts = section('02', 'A little heads-up', 'Choose what gets a six-second light beacon.');
      const timerAlert = choice('Timer & reminders', 'timerAlerts', settings.timerAlerts === true, 'When this phone’s timer finishes.');
      const appAlert = choice('Selected phone apps', 'appAlerts', settings.appAlerts === true, 'Only the apps you choose below.');
      timerAlert.label.classList.add('light-toggle'); appAlert.label.classList.add('light-toggle');
      timerAlert.input.onchange = appAlert.input.onchange = changes;
      alerts.append(timerAlert.label, appAlert.label);
      const access = el('div', undefined, 'light-access-card');
      access.append(el('span', data.notificationAccess ? 'Notification access enabled' : 'Notification access needed', 'light-access-state' + (data.notificationAccess ? '' : ' is-needed')));
      access.append(el('p', data.notificationAccess ? 'Only selected apps can trigger a beacon.' : 'Enable Android access for app beacons. Timer beacons work without it.', 'view-copy'));
      access.append(button('Open Android settings ↗', async () => {
        await invoke('access'); status.textContent = 'Choose Lights Out in Android settings, then return here.';
      }));
      alerts.append(access);
      const apps = el('details', undefined, 'light-app-picker');
      const appSummary = el('summary');
      const appList = el('div', undefined, 'light-app-list');
      const selected = new Set(settings.apps || []);
      const search = el('input'); search.type = 'search'; search.placeholder = 'Find an app'; search.setAttribute('aria-label', 'Find notification app');
      const countApps = () => { appSummary.textContent = `Choose apps · ${appList.querySelectorAll('input:checked').length} selected`; };
      for (const app of data.apps || []) {
        const row = choice(app.name, 'app:' + app.id, selected.has(app.id), app.id);
        row.input.value = app.id; row.label.dataset.appSearch = (app.name + ' ' + app.id).toLowerCase();
        row.input.onchange = () => { changes(); countApps(); }; appList.append(row.label);
      }
      const noMatch = el('p', 'No matching apps.', 'light-empty'); noMatch.hidden = true;
      if (!(data.apps || []).length) appList.append(el('p', 'No eligible apps are visible on this phone.', 'light-empty'));
      search.oninput = () => {
        let matches = 0;
        for (const row of appList.querySelectorAll('[data-app-search]')) {
          row.hidden = !row.dataset.appSearch.includes(search.value.toLowerCase());
          if (!row.hidden) matches++;
        }
        noMatch.hidden = matches > 0 || !(data.apps || []).length;
      };
      countApps(); apps.append(appSummary, search, appList, noMatch); alerts.append(apps);
      const alertTargets = lights(alerts, 'Lights for beacons', 'alertTargets');
      const note = el('details', undefined, 'light-safety-note');
      note.append(el('summary', 'Your lights stay in your hands'));
      note.append(el('p', 'Only lights already on are used. Manual changes release them. App beacons have a 30-second cooldown. A routine’s finish-off action keeps priority. No notification text is read, saved or sent.', 'view-copy'));
      alerts.append(note);
      const save = button('Save light settings', async () => {
        const value = { timerMode: mode, brightness, timerTargets: timerTargets(), alertTargets: alertTargets(),
          timerAlerts: timerAlert.input.checked, appAlerts: appAlert.input.checked,
          apps: [...appList.querySelectorAll('input:checked')].map(node => node.value) };
        save.disabled = true;
        try { draw(await invoke('save', { settings: value })); }
        catch (error) { save.disabled = false; throw error; }
      });
      save.className = 'primary'; save.dataset.lightExperience = 'save'; save.disabled = true;
      const saveBar = el('div', undefined, 'light-save-bar'); saveBar.append(status, save); body.append(saveBar);
      status.textContent = 'Saved on this phone';
      function paint() {
        if (document.hidden || !container.getClientRects().length) return;
        const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const elapsed = reduced ? 0 : (performance.now() - started) / 1000;
        orbs.forEach((orb, index) => {
          const frame = LightExperience.frame(mode, { progress: Number(positions.value) / 100, elapsedSeconds: elapsed, index, count: 4, brightness });
          orb.style.background = frame ? `rgb(${frame.r},${frame.g},${frame.b})` : '#333843';
          orb.style.color = orb.style.background; orb.style.opacity = frame ? String(.25 + frame.dimming / 80) : '.4';
        });
      }
      syncMode(); clearInterval(timer); timer = setInterval(paint, 250);
    }
    async function refresh() {
      if (dirty) return;
      const data = await invoke('status');
      // Returning from another screen must not replace edits made while loading.
      if (!dirty) draw(data);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !dirty) void task(refresh); });
    void task(refresh);
    return { refresh: () => task(refresh), state: () => current };
  }
  root.PhoneLightUI = { mount };
})(globalThis);
