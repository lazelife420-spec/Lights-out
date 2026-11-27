/* Tonight dial: the idle instrument (countdown ring or analog face) doubles
   as a slider for tonight's duration. Drag up = longer, down = shorter; the
   wheel and the keyboard step it too.

   It owns no plan state. Every change goes through the caller's apply(),
   which in renderer.js is the duration stepper's own update path
   (applyTonightDuration: #timer-input, the plan facts, the armed Night Mode /
   My Mode identity checks and the debounced durationSeconds save). It never
   starts, pauses or changes a run: while isInteractive() is false (a run, a
   ritual, mini mode, the fullscreen clock, settings not loaded yet) every
   handler returns before reading or writing anything. */
(function (root) {
  'use strict';

  // The stepper's own bounds: renderer.js inputValue() clamps 1..480 minutes
  // (1..28800 seconds in the sec unit, the same 8 h ceiling).
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 480;
  const PX_PER_STEP = 6;            // about 1 minute per 6 px of travel
  const COARSE_STEP = 5;            // Shift (drag, wheel, arrows) and PageUp/PageDown
  const DRAG_THRESHOLD_PX = 3;      // less travel than this is a click, not a drag
  const WHEEL_PIXELS_PER_STEP = 50; // a mouse notch (100-120 px) is one step; a touchpad accumulates

  function clampMinutes(value, min = MIN_MINUTES, max = MAX_MINUTES) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  // Whole minutes for a duration in seconds (a sec-unit plan rounds).
  function minutesFromSeconds(seconds) {
    return clampMinutes((Number(seconds) || 0) / 60);
  }

  // Up (a negative deltaY) is longer. Whole steps of PX_PER_STEP toward zero,
  // so a 1-5 px tremor never changes the value.
  function dragMinutes(anchorMinutes, deltaY, coarse = false) {
    const steps = Math.trunc(-(Number(deltaY) || 0) / PX_PER_STEP);
    return clampMinutes(clampMinutes(anchorMinutes) + steps * (coarse ? COARSE_STEP : 1));
  }

  function startDrag(minutes, y) {
    const start = clampMinutes(minutes);
    return { startMinutes: start, minutes: start, anchorMinutes: start, anchorY: Number(y) || 0, startY: Number(y) || 0, coarse: null, moved: false };
  }

  // Pressing or releasing Shift mid-drag re-anchors at the current value and
  // pointer, so the step size changes without the value jumping.
  function moveDrag(drag, y, coarse = false) {
    const nextCoarse = Boolean(coarse);
    const pointerY = Number(y) || 0;
    const next = { ...drag };
    if (next.coarse === null) next.coarse = nextCoarse;
    if (next.coarse !== nextCoarse) {
      next.anchorMinutes = next.minutes;
      next.anchorY = pointerY;
      next.coarse = nextCoarse;
    }
    next.moved = next.moved || Math.abs(pointerY - next.startY) >= DRAG_THRESHOLD_PX;
    if (next.moved) next.minutes = dragMinutes(next.anchorMinutes, pointerY - next.anchorY, next.coarse);
    return next;
  }

  // ArrowUp/Right +1, ArrowDown/Left -1 (Shift: 5), PageUp/PageDown +/-5,
  // Home/End the stepper's min/max. Anything else: null (not the dial's key).
  function keyMinutes(current, key, shift = false) {
    const step = shift ? COARSE_STEP : 1;
    const value = clampMinutes(current);
    switch (key) {
      case 'ArrowUp': case 'ArrowRight': return clampMinutes(value + step);
      case 'ArrowDown': case 'ArrowLeft': return clampMinutes(value - step);
      case 'PageUp': return clampMinutes(value + COARSE_STEP);
      case 'PageDown': return clampMinutes(value - COARSE_STEP);
      case 'Home': return MIN_MINUTES;
      case 'End': return MAX_MINUTES;
      default: return null;
    }
  }

  // Wheel up = longer. A line/page wheel or a full pixel notch is exactly one
  // step; small touchpad deltas add up until they make one. A direction
  // change starts the count again.
  function wheelSteps(accumulated, deltaY, deltaMode = 0) {
    const delta = Number(deltaY) || 0;
    if (!delta) return { steps: 0, accumulated: Number(accumulated) || 0 };
    if (deltaMode !== 0 || Math.abs(delta) >= WHEEL_PIXELS_PER_STEP) return { steps: delta < 0 ? 1 : -1, accumulated: 0 };
    let acc = Number(accumulated) || 0;
    if (acc && Math.sign(acc) !== Math.sign(delta)) acc = 0;
    acc += delta;
    if (Math.abs(acc) >= WHEEL_PIXELS_PER_STEP) return { steps: acc < 0 ? 1 : -1, accumulated: 0 };
    return { steps: 0, accumulated: acc };
  }

  // The countdown face's drag preview arc: the first hour fills half the
  // ring, hours 1-8 the other half. Continuous and monotonic; full at the max.
  // (The analog face previews on its own bezel, from the hand to the end.)
  function previewRatio(minutes) {
    const m = clampMinutes(minutes);
    if (m <= 60) return m / 120;
    return 0.5 + 0.5 * (m - 60) / (MAX_MINUTES - 60);
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Spoken duration for aria-valuetext: "45 minutes", "1 hour 30 minutes",
  // "1 minute 30 seconds" (a sec-unit plan).
  function durationWords(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts = [];
    if (h) parts.push(plural(h, 'hour'));
    if (m) parts.push(plural(m, 'minute'));
    if (s) parts.push(plural(s, 'second'));
    return parts.length ? parts.join(' ') : '0 seconds';
  }

  // "23:45 · today" -> "23:45"; "00:30 · tomorrow" -> "00:30 tomorrow".
  function spokenEnd(target) {
    const text = String(target || '').trim();
    if (!text) return '';
    const at = text.lastIndexOf(' · ');
    if (at < 0) return text;
    const time = text.slice(0, at);
    const day = text.slice(at + 3);
    return day === 'today' ? time : `${time} ${day}`;
  }

  // "45 minutes, ends 23:45".
  function valueText(seconds, target) {
    const end = spokenEnd(target);
    return end ? `${durationWords(seconds)}, ends ${end}` : durationWords(seconds);
  }

  // Inside the dial's circle (the ring container is square; its corners and
  // the full-screen button below it are not the dial).
  function withinDial(x, y, rect) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
    const r = Math.min(rect.width, rect.height) / 2;
    const dx = Number(x) - (rect.left + rect.width / 2);
    const dy = Number(y) - (rect.top + rect.height / 2);
    return dx * dx + dy * dy <= r * r;
  }

  // Controls inside the instrument keep their own pointer behaviour: the
  // session name stays editable, buttons stay buttons.
  const OWN_POINTER_SELECTOR = '.timer-name, button, a[href], input, select, textarea, [contenteditable]:not([contenteditable="false"])';

  // opts: container (pointer + wheel target), dial (role=slider: focus, keys,
  // aria), readout { value, ends } elements, win (Escape while dragging),
  // body, isInteractive(), getSeconds(), apply(seconds) -> boolean,
  // describe(seconds) -> { duration, target }, onDragChange(active).
  function createController(opts) {
    const { container, dial, readout = {}, win, body } = opts;
    const isInteractive = () => { try { return Boolean(opts.isInteractive()); } catch { return false; } };
    const seconds = () => Number(opts.getSeconds()) || 0;
    const current = () => minutesFromSeconds(seconds());
    let drag = null;
    let wheelAcc = 0;

    const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
    const setAttr = (el, name, value) => { if (el && el.getAttribute?.(name) !== value) el.setAttribute(name, value); };

    // The one write: whole minutes, through the stepper's path, only when it
    // changes the plan.
    function commit(nextSeconds) {
      if (!isInteractive()) return false;
      const target = Math.max(1, Math.round(Number(nextSeconds) || 0));
      if (target === seconds()) return true;
      return Boolean(opts.apply(target));
    }

    function renderReadout(minutes) {
      const facts = opts.describe(minutes * 60) || {};
      setText(readout.value, facts.duration || '');
      setText(readout.ends, facts.target ? `Ends ${facts.target}` : '');
    }

    function setDragging(active) {
      container.classList.toggle('is-dragging', active);
      body?.classList.toggle('dial-dragging', active);
      if (typeof opts.onDragChange === 'function') opts.onDragChange(active);
    }

    // End a drag. keep=false (Escape) puts the starting value back through
    // the same path; an abort (no longer interactive) writes nothing at all.
    function finish({ restore = false } = {}) {
      if (!drag) return;
      const ended = drag;
      drag = null;
      win?.removeEventListener('keydown', onEscape, true);
      try { if (container.hasPointerCapture?.(ended.pointerId)) container.releasePointerCapture(ended.pointerId); } catch {}
      if (restore && ended.moved) commit(ended.startSeconds);
      if (ended.moved) setDragging(false);
    }

    function onEscape(event) {
      if (!drag || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish({ restore: isInteractive() });
    }

    function onPointerDown(event) {
      if (drag || event.isPrimary === false) return;
      if ((event.pointerType || 'mouse') === 'mouse' && event.button !== 0) return;
      if (!isInteractive()) return;
      if (event.target?.closest?.(OWN_POINTER_SELECTOR)) return;
      if (!withinDial(event.clientX, event.clientY, container.getBoundingClientRect())) return;
      // No text selection, no native drag, and focus lands on the slider
      // (marked as pointer focus: no keyboard focus ring after a mouse drag).
      event.preventDefault();
      dial.setAttribute('data-pointer-focus', '');
      try { dial.focus({ preventScroll: true }); } catch {}
      try { container.setPointerCapture(event.pointerId); } catch {}
      drag = { ...startDrag(current(), event.clientY), pointerId: event.pointerId, startSeconds: seconds() };
      win?.addEventListener('keydown', onEscape, true);
    }

    function onPointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!isInteractive()) { finish(); return; }
      event.preventDefault();
      const wasMoved = drag.moved;
      drag = { ...drag, ...moveDrag(drag, event.clientY, event.shiftKey) };
      if (!drag.moved) return;
      if (!wasMoved) setDragging(true);
      if (drag.minutes * 60 !== seconds() && !commit(drag.minutes * 60)) { finish(); return; }
      renderReadout(drag.minutes);
    }

    function onPointerEnd(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      finish();
    }

    function onKeyDown(event) {
      dial.removeAttribute('data-pointer-focus');
      if (drag || !isInteractive()) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // A slider has no Space action; never let it reach the Start shortcut.
      if (event.key === ' ' || event.code === 'Space') { event.preventDefault(); return; }
      const next = keyMinutes(current(), event.key, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      commit(next * 60);
    }

    function onWheel(event) {
      if (drag || !isInteractive()) return;
      if (!withinDial(event.clientX, event.clientY, container.getBoundingClientRect())) return;
      // Shift+wheel arrives as horizontal scroll in Chromium.
      const delta = event.deltaY || (event.shiftKey ? event.deltaX : 0);
      if (!delta) return;
      event.preventDefault();
      const result = wheelSteps(wheelAcc, delta, event.deltaMode);
      wheelAcc = result.accumulated;
      if (!result.steps) return;
      commit(clampMinutes(current() + result.steps * (event.shiftKey ? COARSE_STEP : 1)) * 60);
    }

    function onSelectStart(event) { if (drag) event.preventDefault(); }
    function onDragStart(event) { if (isInteractive() && !event.target?.closest?.(OWN_POINTER_SELECTOR)) event.preventDefault(); }

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerEnd);
    container.addEventListener('pointercancel', onPointerEnd);
    container.addEventListener('lostpointercapture', onPointerEnd);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('selectstart', onSelectStart);
    container.addEventListener('dragstart', onDragStart);
    dial.addEventListener('keydown', onKeyDown);
    dial.addEventListener('blur', () => dial.removeAttribute('data-pointer-focus'));

    // Called from render(): the slider's state follows the plan and the gate.
    function sync() {
      const live = isInteractive();
      if (!live && drag) finish();
      container.classList.toggle('dial-live', live);
      setAttr(dial, 'aria-disabled', live ? 'false' : 'true');
      setAttr(dial, 'tabindex', live ? '0' : '-1');
      setAttr(dial, 'aria-valuemin', String(MIN_MINUTES));
      setAttr(dial, 'aria-valuemax', String(MAX_MINUTES));
      const secs = seconds();
      setAttr(dial, 'aria-valuenow', String(minutesFromSeconds(secs)));
      // Idle it says when the plan would end; inert (a run has its own end)
      // it states only the duration.
      const facts = live ? (opts.describe(secs) || {}) : {};
      setAttr(dial, 'aria-valuetext', valueText(secs, facts.target));
      if (drag && drag.moved) renderReadout(drag.minutes);
    }

    return {
      sync,
      isDragging: () => Boolean(drag && drag.moved),
      previewMinutes: () => (drag ? drag.minutes : current()),
      cancel: () => finish()
    };
  }

  const api = {
    MIN_MINUTES, MAX_MINUTES, PX_PER_STEP, COARSE_STEP, DRAG_THRESHOLD_PX, WHEEL_PIXELS_PER_STEP,
    clampMinutes, minutesFromSeconds, dragMinutes, startDrag, moveDrag, keyMinutes, wheelSteps,
    previewRatio, durationWords, spokenEnd, valueText, withinDial, createController
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TonightDial = api;
})(globalThis);
