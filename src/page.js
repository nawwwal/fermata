// Fermata — page engine (MAIN world, document_start).
// Owns two time domains:
//   1. The imperative clock: performance.now / Date.now / rAF timestamps / timer
//      delays are forged so JS-driven motion (rAF loops, physics, GSAP-core)
//      runs at the chosen rate, pauses, and steps forward.
//   2. The declarative domain: a governor continuously sets playbackRate on
//      every live Animation object (CSS animations, transitions, WAAPI), which
//      are also seekable — this is what scrubbing manipulates.
// Pass-through cost at rate 1 / not paused is one multiply per clock read.

(() => {
  'use strict';
  if (window.__fermata) return;
  window.__fermata = true;

  const NS = 'fermata';
  const realPerfNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const realRAF = window.requestAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);

  // ---------------------------------------------------------------- vclock
  let rate = 1;
  let paused = false;
  let vBase = realPerfNow();
  let rBase = vBase;

  const effRate = () => (paused ? 0 : rate);
  const vNow = () => vBase + (realPerfNow() - rBase) * effRate();
  const rebase = () => { vBase = vNow(); rBase = realPerfNow(); };

  function setRate(r) { rebase(); rate = Math.max(0.001, r); governNow(); }
  function setPaused(p) { rebase(); paused = !!p; governNow(); }
  // Step the virtual clock forward by ms (only meaningful while paused).
  // Also nudges seekable animations so both domains stay in lockstep.
  function nudge(ms) {
    rebase(); vBase += ms;
    for (const a of scopedAnimations()) {
      try { a.currentTime = Math.max(0, Number(a.currentTime || 0) + ms); } catch (_) {}
    }
  }

  // --------------------------------------------------------- clock patches
  const dateOffset = realDateNow() - realPerfNow();
  performance.now = function now() { return vNow(); };
  Date.now = function now() { return Math.round(vNow() + dateOffset); };
  window.requestAnimationFrame = function (cb) {
    return realRAF(() => { try { cb(vNow()); } catch (e) { console.error(e); } });
  };
  // New timers get dilated delays. Limitation (deliberate): timers already
  // pending when the rate changes keep their original real-time fuse.
  window.setTimeout = function (fn, d = 0, ...a) {
    return realSetTimeout(fn, d / Math.max(effRate(), 0.001), ...a);
  };
  window.setInterval = function (fn, d = 0, ...a) {
    return realSetInterval(fn, d / Math.max(effRate(), 0.001), ...a);
  };

  // ----------------------------------------------------- declarative domain
  const SCOPE_ATTR = 'data-fermata-scope';

  function scopedAnimations() {
    let anims;
    try { anims = document.getAnimations(); } catch (_) { return []; }
    const scope = document.querySelector(`[${SCOPE_ATTR}]`);
    if (!scope) return anims;
    return anims.filter(a => {
      const t = a.effect && a.effect.target;
      return t && (t === scope || scope.contains(t));
    });
  }

  function endOf(a) {
    try {
      const t = a.effect && a.effect.getComputedTiming();
      if (!t) return 0;
      if (isFinite(t.endTime)) return Number(t.endTime);
      return Number(t.delay || 0) + Number(t.duration || 0); // infinite → one iteration
    } catch (_) { return 0; }
  }

  // Governor: a real-clock rAF loop that keeps every animation — including
  // ones born after the rate change — at the chosen playbackRate. Runs only
  // while the page is off real time, so cost at rate 1 is zero.
  const pausedByUs = new WeakSet();
  let governing = false;

  function governNow() {
    for (const a of scopedAnimations()) {
      try {
        if (paused) {
          if (a.playState === 'running') { a.pause(); pausedByUs.add(a); }
        } else {
          if (a.playbackRate !== rate) a.playbackRate = rate;
          if (pausedByUs.has(a) && a.playState === 'paused') { a.play(); pausedByUs.delete(a); }
        }
      } catch (_) {}
    }
    if ((rate !== 1 || paused) && !governing) { governing = true; realRAF(governLoop); }
  }
  function governLoop() {
    if (rate === 1 && !paused) { governing = false; return; }
    governNow();
    realRAF(governLoop);
  }

  // Timeline: aggregate scoped animations into one scrubbable strip.
  function scanTimeline() {
    const anims = scopedAnimations();
    let end = 0;
    for (const a of anims) end = Math.max(end, endOf(a));
    return { count: anims.length, endMs: end };
  }

  function scrub(frac) {
    if (!paused) setPaused(true);
    const anims = scopedAnimations();
    let end = 0;
    for (const a of anims) end = Math.max(end, endOf(a));
    const t = frac * end;
    for (const a of anims) {
      try {
        a.pause(); pausedByUs.add(a);
        a.currentTime = Math.min(t, Math.max(0, endOf(a) - 0.01));
      } catch (_) {}
    }
    return { t, endMs: end };
  }

  // ----------------------------------------------------------- message bus
  function reply(payload) {
    window.postMessage({ source: `${NS}-engine`, ...payload }, '*');
  }
  function state() {
    return { rate, paused, vnow: vNow(), rnow: realPerfNow() };
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.source !== `${NS}-hud`) return;
    switch (m.cmd) {
      case 'state': break;
      case 'setRate': setRate(m.value); break;
      case 'setPaused': setPaused(m.value); break;
      case 'nudge': nudge(m.value); break;
      case 'scan': reply({ type: 'timeline', ...scanTimeline(), id: m.id }); break;
      case 'scrub': reply({ type: 'scrubbed', ...scrub(m.value), id: m.id }); break;
    }
    reply({ type: 'state', state: state(), id: m.id });
  });
})();
