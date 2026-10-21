/* global document, LightExperience, Event */
(function () {
  'use strict';
  const preview = document.getElementById('wiz-mode-preview');
  const mode = document.getElementById('sel-light-mode');
  const progress = document.getElementById('wiz-mode-preview-progress');
  if (!preview || !mode || !progress) return;
  const cards = [...document.querySelectorAll('[data-light-mode]')];
  const descriptions = {
    hourglass: ['Room Hourglass', 'Warm light drains across your selected lights, one by one.'],
    orbit: ['Orbit', 'A cool accent travels around the room and settles into amber.'],
    ember: ['Ember', 'A slow, warm breath that fades with your countdown.']
  };
  const started = performance.now();
  function draw() {
    const selected = Object.hasOwn(descriptions, mode.value);
    const look = document.querySelector('#wiz-config .wiz-look-grid');
    if (look) look.classList.toggle('is-timer-experience', selected);
    const lookTitle = document.querySelector('.lighting-look-heading h4');
    const lookHint = document.querySelector('.lighting-look-heading .help-text');
    if (lookTitle) lookTitle.textContent = selected ? 'Effect brightness' : 'Starting look';
    if (lookHint) lookHint.textContent = selected ? 'Timer effects are capped at 60%' : 'For gradual and warm dimming';
    const timing = document.getElementById('light-dim-timing');
    if (timing) timing.hidden = selected || mode.value === 'off_at_end';
    const timingNote = document.getElementById('light-full-timer-note');
    if (timingNote) timingNote.hidden = !selected;
    for (const card of cards) card.setAttribute('aria-pressed', String(card.dataset.lightMode === mode.value));
    preview.hidden = !selected;
    if (!selected) return;
    document.getElementById('wiz-preview-title').textContent = descriptions[mode.value][0];
    document.getElementById('wiz-preview-description').textContent = descriptions[mode.value][1];
    document.getElementById('wiz-preview-progress-value').value = `${progress.value}%`;
    if (!preview.getClientRects().length) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seconds = reduced ? 0 : (performance.now() - started) / 1000;
    [...preview.querySelectorAll('.light-experience-preview i')].forEach((orb, index) => {
      const frame = LightExperience.frame(mode.value, { progress: Number(progress.value) / 100,
        elapsedSeconds: seconds, index, count: 4, brightness: Number(document.getElementById('wiz-brightness')?.value) || 40 });
      orb.style.background = `rgb(${frame.r},${frame.g},${frame.b})`;
      orb.style.color = orb.style.background;
      orb.style.opacity = String(.25 + frame.dimming / 80);
    });
  }
  for (const card of cards) card.addEventListener('click', () => {
    mode.value = card.dataset.lightMode;
    mode.dispatchEvent(new Event('input', { bubbles: true }));
    mode.dispatchEvent(new Event('change', { bubbles: true }));
  });
  mode.addEventListener('change', draw);
  progress.addEventListener('input', draw);
  document.getElementById('wiz-brightness')?.addEventListener('input', draw);
  setInterval(() => { if (!document.hidden) draw(); }, 250);
  draw();
})();
