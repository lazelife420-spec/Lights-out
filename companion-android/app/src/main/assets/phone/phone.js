'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  let state = { phase: 'idle', remainingSeconds: 0, totalSeconds: 0 };
  let minutes = Math.max(1, Math.min(1440, Number(localStorage.getItem('phone_minutes')) || 30));
  let analog = localStorage.getItem('phone_clock') === 'analog';
  let sending = false;
  let lastPhase = '';
  const send = (action, seconds) => {
    $('error').hidden = true;
    if (!window.phoneNative) return error('Phone controls are not ready. Reopen Lights Out.');
    if (sending) return;
    sending = true;
    window.phoneNative.postMessage(JSON.stringify({ action, seconds }));
    setTimeout(() => { sending = false; }, 350);
  };
  function error(message) { $('error').textContent = message; $('error').hidden = false; $('error').scrollIntoView({ block: 'center' }); sending = false; }
  function duration(value) {
    minutes = Math.max(1, Math.min(1440, Math.round(Number(value) || 30)));
    $('minutes').value = minutes;
    localStorage.setItem('phone_minutes', String(minutes));
    document.querySelectorAll('[data-minutes]').forEach(el => el.classList.toggle('selected', Number(el.dataset.minutes) === minutes));
    render();
  }
  function render() {
    const active = state.phase === 'running' || state.phase === 'paused';
    const finished = state.phase === 'finished';
    const left = active ? state.remainingSeconds : finished ? 0 : minutes * 60;
    text('time', `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    $('time').style.fontSize = left >= 36000 ? '48px' : '';
    text('phase', state.phase === 'paused' ? 'PAUSED ON THIS PHONE' : active ? 'REMAINING ON THIS PHONE' : finished ? 'PHONE TIMER FINISHED' : 'PHONE TIMER');
    document.querySelector('.scope').textContent = active && state.label ? state.label + ' · running on this phone' : 'A reminder on this phone. Works without a PC or Wi-Fi.';
    text('end', state.phase === 'paused' ? 'Holding your remaining time' : active ? 'Ends ' + new Date(Date.now() + left * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'A reminder to call it a night');
    $('arc').style.strokeDashoffset = String(active ? 100 - 100 * left / Math.max(1, state.totalSeconds) : finished ? 100 : 0);
    $('setup').hidden = active || finished; $('active').hidden = !active; $('finished').hidden = !finished;
    text('pause', state.phase === 'paused' ? 'Resume' : 'Pause');
    $('add').disabled = left > 86100;
    $('analog').hidden = !analog || active || finished;
    document.querySelector('.dial-inner').hidden = analog && !active && !finished;
    $('clock').classList.toggle('selected', analog); $('clock').setAttribute('aria-pressed', String(analog));
    $('countdown').classList.toggle('selected', !analog); $('countdown').setAttribute('aria-pressed', String(!analog));
    const now = new Date();
    $('hour').style.transform = `rotate(${now.getHours() * 30 + now.getMinutes() / 2}deg)`;
    $('minute').style.transform = `rotate(${now.getMinutes() * 6 + now.getSeconds() / 10}deg)`;
    $('second').style.transform = `rotate(${now.getSeconds() * 6}deg)`;
    if (state.exact !== undefined) {
      $('permissions').hidden = state.exact && state.alerts;
      $('exact').hidden = state.exact; $('alerts').hidden = state.alerts;
      text('permission-copy', !state.exact && !state.alerts ? 'Allow precise alerts and notifications so your timer can remind you on time with the screen off.' : !state.exact ? 'Allow precise alerts for an on-time reminder with the screen off. Android may delay the alert without this access.' : 'Enable notifications so Lights Out can alert you when your phone timer finishes.');
      text('pc-title', state.paired ? 'Open PC controls' : 'Pair a PC');
    }
  }
  window.phoneUI = { error, update(next) {
    state = next; sending = false;
    window.phoneHome?.update(next);
    if (next.phase !== lastPhase) {
      $('announcer').textContent = next.phase === 'finished' ? 'Your phone timer has finished.' : next.phase === 'paused' ? 'Phone timer paused.' : next.phase === 'running' ? 'Phone timer running.' : 'Phone timer ready.';
      lastPhase = next.phase;
    }
    render();
  } };
  $('minutes').addEventListener('change', e => duration(e.target.value));
  $('less').onclick = () => duration(minutes - 5); $('more').onclick = () => duration(minutes + 5);
  document.querySelectorAll('[data-minutes]').forEach(el => { el.onclick = () => duration(el.dataset.minutes); });
  $('start').onclick = () => { duration($('minutes').value); send('start', minutes * 60); };
  $('pause').onclick = () => send(state.phase === 'paused' ? 'resume' : 'pause');
  $('add').onclick = () => send('snooze', 300); $('cancel').onclick = $('done').onclick = () => send('cancel');
  $('pc').onclick = $('pc-top').onclick = () => send('pc'); $('exact').onclick = () => send('exact'); $('alerts').onclick = () => send('alerts');
  $('clock').onclick = () => { analog = true; localStorage.setItem('phone_clock', 'analog'); render(); };
  $('countdown').onclick = () => { analog = false; localStorage.setItem('phone_clock', 'countdown'); render(); };
  let taps = 0, lastTap = 0;
  $('brand').onclick = () => { const now = Date.now(); taps = now - lastTap < 1400 ? taps + 1 : 1; lastTap = now; if (taps >= 5) { taps = 0; $('stars').textContent = '✦  ·  ✧  ·  ✦'; $('announcer').textContent = 'Lights out. Stars up.'; } };
  duration(minutes);
})();
