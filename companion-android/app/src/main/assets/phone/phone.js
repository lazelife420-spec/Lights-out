'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node && node.textContent !== value) node.textContent = value; };
  let state = { phase: 'idle', remainingSeconds: 0, totalSeconds: 0 };
  let minutes = Math.max(1, Math.min(1440, Number(localStorage.getItem('phone_minutes')) || 30));
  let analog = localStorage.getItem('phone_clock') === 'analog';
  let sending = false;
  let lastPhase = '';
  const send = (action, seconds) => {
    const errEl = $('error');
    if (errEl) errEl.hidden = true;
    if (!window.phoneNative) return error('Phone controls are not ready. Reopen Lights Out.');
    if (sending) return;
    sending = true;
    window.phoneNative.postMessage(JSON.stringify({ action, seconds }));
    setTimeout(() => { sending = false; }, 350);
  };
  function error(message) {
    const errEl = $('error');
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
      errEl.scrollIntoView({ block: 'center' });
    }
    sending = false;
  }
  function duration(value) {
    minutes = Math.max(1, Math.min(1440, Math.round(Number(value) || 30)));
    if ($('minutes')) $('minutes').value = minutes;
    localStorage.setItem('phone_minutes', String(minutes));
    document.querySelectorAll('[data-minutes]').forEach(el => el.classList.toggle('selected', Number(el.dataset.minutes) === minutes));
    render();
  }
  function render() {
    const active = state.phase === 'running' || state.phase === 'paused';
    const finished = state.phase === 'finished';
    const left = active ? state.remainingSeconds : finished ? 0 : minutes * 60;
    document.body.dataset.state = state.phase || 'idle';
    text('time', `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    if ($('time')) $('time').style.fontSize = left >= 36000 ? 'min(2.5rem, 13vw)' : '';
    text('phase', state.phase === 'paused' ? 'PAUSED · THIS PHONE' : active ? 'REMAINING ON THIS PHONE' : finished ? 'FINISHED' : 'READY');
    text('start-min', minutes === 60 ? '— 1 hour' : `— ${minutes} min`);
    const scopeEl = document.querySelector('.scope');
    if (scopeEl) {
      scopeEl.textContent = active && state.label
        ? state.label + ' · running on this phone'
        : 'Alerts on this phone. Works without a PC or Wi-Fi.';
    }
    text('end', state.phase === 'paused'
      ? 'Holding your remaining time'
      : active
        ? 'Ends ' + new Date(Date.now() + left * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : finished
          ? 'Your reminder fired — no phone action taken'
          : 'a reminder to call it a night');
    if ($('arc')) {
      $('arc').style.strokeDashoffset = String(active ? 100 - 100 * left / Math.max(1, state.totalSeconds) : finished ? 100 : 0);
    }
    if ($('setup')) $('setup').hidden = active || finished;
    const clockChoice = document.querySelector('.clock-choice');
    if (clockChoice) clockChoice.hidden = active || finished;
    if ($('active')) $('active').hidden = !active;
    if ($('finished')) $('finished').hidden = !finished;
    text('pause', state.phase === 'paused' ? 'Resume' : 'Pause');
    if ($('add')) $('add').disabled = left > 86100;
    if ($('analog')) $('analog').hidden = !analog || active || finished;
    const dialInner = document.querySelector('.dial-inner');
    if (dialInner) dialInner.hidden = analog && !active && !finished;
    if ($('clock')) {
      $('clock').classList.toggle('selected', analog);
      $('clock').setAttribute('aria-pressed', String(analog));
    }
    if ($('countdown')) {
      $('countdown').classList.toggle('selected', !analog);
      $('countdown').setAttribute('aria-pressed', String(!analog));
    }
    const now = new Date();
    if ($('hour')) $('hour').style.transform = `rotate(${now.getHours() * 30 + now.getMinutes() / 2}deg)`;
    if ($('minute')) $('minute').style.transform = `rotate(${now.getMinutes() * 6 + now.getSeconds() / 10}deg)`;
    if ($('second')) $('second').style.transform = `rotate(${now.getSeconds() * 6}deg)`;
    if (state.exact !== undefined) {
      if ($('permissions')) $('permissions').hidden = state.exact && state.alerts;
      if ($('exact')) $('exact').hidden = state.exact;
      if ($('alerts')) $('alerts').hidden = state.alerts;
      text('permission-copy', !state.exact && !state.alerts
        ? 'Allow precise alerts and notifications so your reminder can fire on time with the screen off.'
        : !state.exact
          ? 'Allow precise alerts for an on-time reminder with the screen off. Android may delay the alert without this access.'
          : 'Enable notifications so Lights Out can alert you when your bedtime reminder finishes.');
      const paired = Boolean(state.paired);
      const pcState = $('pc-state');
      if (pcState) {
        pcState.textContent = paired ? 'Paired' : 'Not paired';
        pcState.className = 'state-pill' + (paired ? ' on' : '');
      }
      text('pc-title', paired ? 'Windows PC paired' : 'No PC paired');
      text('pc-detail', paired
        ? 'Open PC controls to check status or manage a Windows bedtime session.'
        : 'Pair to control a Windows bedtime session from here.');
      text('pc', paired ? 'Open PC controls' : 'Pair PC');
    }
  }
  window.phoneUI = {
    error,
    update(next) {
      state = next;
      sending = false;
      window.phoneHome?.update(next);
      if (next.phase !== lastPhase) {
        text('announcer', next.phase === 'finished'
          ? 'Your phone reminder has finished.'
          : next.phase === 'paused'
            ? 'Phone reminder paused.'
            : next.phase === 'running'
              ? 'Phone reminder running.'
              : 'Phone reminder ready.');
        lastPhase = next.phase;
      }
      render();
    }
  };
  if ($('minutes')) $('minutes').addEventListener('change', e => duration(e.target.value));
  if ($('less')) $('less').onclick = () => duration(minutes - 5);
  if ($('more')) $('more').onclick = () => duration(minutes + 5);
  document.querySelectorAll('[data-minutes]').forEach(el => { el.onclick = () => duration(el.dataset.minutes); });
  if ($('start')) $('start').onclick = () => { duration($('minutes').value); send('start', minutes * 60); };
  if ($('pause')) $('pause').onclick = () => send(state.phase === 'paused' ? 'resume' : 'pause');
  if ($('add')) $('add').onclick = () => send('snooze', 300);
  if ($('cancel')) $('cancel').onclick = () => send('cancel');
  if ($('done')) $('done').onclick = () => send('cancel');
  if ($('pc')) $('pc').onclick = () => send('pc');
  if ($('pc-top')) $('pc-top').onclick = () => send('pc');
  if ($('exact')) $('exact').onclick = () => send('exact');
  if ($('alerts')) $('alerts').onclick = () => send('alerts');
  if ($('clock')) $('clock').onclick = () => { analog = true; localStorage.setItem('phone_clock', 'analog'); render(); };
  if ($('countdown')) $('countdown').onclick = () => { analog = false; localStorage.setItem('phone_clock', 'countdown'); render(); };
  let taps = 0, lastTap = 0;
  if ($('brand')) {
    $('brand').onclick = () => {
      const now = Date.now();
      taps = now - lastTap < 1400 ? taps + 1 : 1;
      lastTap = now;
      if (taps >= 5) {
        taps = 0;
        text('stars', '✦  ·  ✧  ·  ✦');
        text('announcer', 'Lights out. Stars up.');
      }
    };
  }
  duration(minutes);
})();
