// Fermata — page engine (MAIN world, document_start).
// Owns two time domains:
//   1. The imperative clock: performance.now / Date.now / new Date() / rAF
//      timestamps are forged, and ALL timers run through a virtual scheduler,
//      so JS-driven motion (rAF loops, physics, setTimeout chains) runs at the
//      chosen rate, freezes on hold, and fires correctly when stepped.
//   2. The declarative domain: a governor continuously sets playbackRate on
//      every live Animation object (CSS animations, transitions, WAAPI), which
//      are also seekable — this is what scrubbing manipulates.
// It also builds "echoes": real DOM clones of a moving element, each replaying
// the element's animations seeked to a different instant, fanned into depth —
// the motion's timeline extruded into the page's own space.
// Pass-through cost at rate 1 / not frozen is one multiply per clock read and
// a single pending real timeout for the whole virtual timer queue.

(() => {
  'use strict';
  if (window.__fermata) return;
  window.__fermata = true;

  const NS = 'fermata';
  const UI_ATTR = 'data-fermata-ui';
  const realPerfNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const realRAF = window.requestAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realClearInterval = window.clearInterval.bind(window);

  // ---------------------------------------------------------------- vclock
  let rate = 1;
  let frozen = false;
  let vBase = realPerfNow();
  let rBase = vBase;

  const effRate = () => (frozen ? 0 : rate);
  const toVirtual = (realT) => vBase + (realT - rBase) * effRate();
  const vNow = () => toVirtual(realPerfNow());
  const rebase = () => { vBase = vNow(); rBase = realPerfNow(); };

  function setRate(r) {
    rebase(); rate = Math.max(0.001, r);
    governNow(); repump();
  }
  function setFrozen(p) {
    rebase(); frozen = !!p;
    governNow(); repump();
  }
  // Step the virtual clock forward by ms (the precision move while frozen).
  // Fires any virtual timers that come due and nudges seekable animations so
  // both time domains stay in lockstep.
  function nudge(ms) {
    rebase(); vBase += ms;
    for (const a of pageAnimations()) {
      try { a.currentTime = Math.max(0, Number(a.currentTime || 0) + ms); } catch (_) {}
    }
    pump();      // run JS timers that the step crossed
    repump();
    echoSync();
  }
  // Move only the seekable (CSS/WAAPI) domain — backwards is possible here,
  // and only here. JS already executed; we never pretend otherwise.
  function seekBy(ms) {
    if (!frozen) setFrozen(true);
    for (const a of pageAnimations()) {
      try {
        a.pause(); frozenByUs.add(a);
        a.currentTime = Math.min(endOf(a) - 0.01, Math.max(0, Number(a.currentTime || 0) + ms));
      } catch (_) {}
    }
    echoSync();
  }

  // --------------------------------------------------------- clock patches
  const dateOffset = realDateNow() - realPerfNow();
  performance.now = function now() { return vNow(); };

  const RealDate = Date;
  class FermataDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(vNow() + dateOffset);
    }
    static now() { return Math.round(vNow() + dateOffset); }
  }
  FermataDate.parse = RealDate.parse;
  FermataDate.UTC = RealDate.UTC;
  window.Date = FermataDate;

  // rAF timestamps are forged from the real frame timestamp so every callback
  // in the same frame sees the same virtual instant.
  window.requestAnimationFrame = function (cb) {
    return realRAF((ts) => { try { cb(toVirtual(ts)); } catch (e) { console.error(e); } });
  };

  // -------------------------------------------------- virtual timer queue
  // Every page timer lives here in virtual time. Changing the rate retimes
  // pending timers; freezing stops them; stepping fires the ones it crosses.
  // One real timeout services the whole queue (rescheduled to the next due).
  const timers = new Map();      // id -> { fn, args, due, period|null }
  let timerId = 0x40000000;      // far above native ids — no collisions
  let pumpHandle = null;
  let pumpAt = Infinity;         // real-clock instant the service timer fires

  function schedulePump() {
    const er = effRate();
    let minDue = Infinity;
    for (const t of timers.values()) if (t.due < minDue) minDue = t.due;
    if (minDue === Infinity || er === 0) {
      if (pumpHandle !== null) { realClearTimeout(pumpHandle); pumpHandle = null; pumpAt = Infinity; }
      return;
    }
    const realAt = realPerfNow() + Math.max(0, (minDue - vNow()) / er);
    if (pumpHandle !== null) {
      if (realAt >= pumpAt - 0.5) return;     // current service fires soon enough
      realClearTimeout(pumpHandle);
    }
    pumpAt = realAt;
    pumpHandle = realSetTimeout(pump, Math.max(0, realAt - realPerfNow()));
  }
  function repump() {
    if (pumpHandle !== null) { realClearTimeout(pumpHandle); pumpHandle = null; }
    pumpAt = Infinity;
    schedulePump();
  }
  function pump() {
    pumpHandle = null; pumpAt = Infinity;
    const now = vNow();
    const due = [];
    for (const [id, t] of timers) if (t.due <= now) due.push([id, t]);
    due.sort((a, b) => a[1].due - b[1].due);
    for (const [id, t] of due) {
      if (!timers.has(id)) continue;          // cleared by an earlier callback
      if (t.period !== null) t.due = now + t.period;
      else timers.delete(id);
      try { t.fn(...t.args); } catch (e) { console.error(e); }
    }
    schedulePump();
  }

  window.setTimeout = function (fn, d = 0, ...args) {
    if (typeof fn !== 'function') return realSetTimeout(fn, d, ...args);
    const id = ++timerId;
    timers.set(id, { fn, args, due: vNow() + Math.max(0, Number(d) || 0), period: null });
    schedulePump();
    return id;
  };
  window.setInterval = function (fn, d = 0, ...args) {
    if (typeof fn !== 'function') return realSetInterval(fn, d, ...args);
    const period = Math.max(1, Number(d) || 0);
    const id = ++timerId;
    timers.set(id, { fn, args, due: vNow() + period, period });
    schedulePump();
    return id;
  };
  window.clearTimeout = function (id) {
    if (timers.delete(id)) { schedulePump(); return; }
    realClearTimeout(id);
  };
  window.clearInterval = function (id) {
    if (timers.delete(id)) { schedulePump(); return; }
    realClearInterval(id);
  };

  // ----------------------------------------------------- declarative domain
  // Everything Fermata creates is exempt from its own time authority: elements
  // under [data-fermata-ui] and any Animation whose id starts with "fermata".
  function isOurs(a) {
    if (a.id && String(a.id).indexOf(NS) === 0) return true;
    let n = a.effect && a.effect.target;
    while (n) {
      if (n.hasAttribute && n.hasAttribute(UI_ATTR)) return true;
      n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
    }
    return false;
  }

  function pageAnimations() {
    let anims;
    try { anims = document.getAnimations(); } catch (_) { return []; }
    return anims.filter(a => !isOurs(a));
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
  const frozenByUs = new WeakSet();
  let governing = false;

  function governNow() {
    for (const a of pageAnimations()) {
      try {
        if (frozen) {
          if (a.playState === 'running') { a.pause(); frozenByUs.add(a); }
        } else {
          if (a.playbackRate !== rate) a.playbackRate = rate;
          if (frozenByUs.has(a) && a.playState === 'paused') { a.play(); frozenByUs.delete(a); }
        }
      } catch (_) {}
    }
    if ((rate !== 1 || frozen) && !governing) { governing = true; realRAF(governLoop); }
  }
  function governLoop() {
    if (rate === 1 && !frozen) { governing = false; return; }
    governNow();
    realRAF(governLoop);
  }

  // Timeline: aggregate the page's animations into one scrubbable strip.
  function scanTimeline() {
    const anims = pageAnimations();
    let end = 0, t = 0;
    for (const a of anims) {
      end = Math.max(end, endOf(a));
      t = Math.max(t, Number(a.currentTime || 0));
    }
    return { count: anims.length, endMs: end, t: Math.min(t, end) };
  }

  function scrub(frac) {
    if (!frozen) setFrozen(true);
    const anims = pageAnimations();
    let end = 0;
    for (const a of anims) end = Math.max(end, endOf(a));
    const t = frac * end;
    for (const a of anims) {
      try {
        a.pause(); frozenByUs.add(a);
        a.currentTime = Math.min(t, Math.max(0, endOf(a) - 0.01));
      } catch (_) {}
    }
    echoSync();
    return { t, endMs: end };
  }

  // ------------------------------------------------------------------ echo
  // Clone a moving element into a fan of ghosts, each one a real DOM replay
  // of its animations seeked to a different instant: the past recedes behind
  // it, the future stands ahead. The motion's timeline, physically in the page.
  let echo = null;   // { wrap, ref: Animation[], clones: [{anims, off}] }

  // Body may be tilted (3D) by the overlay layer. Measure with the transform
  // momentarily removed — restored before the browser ever paints.
  function measureFlat(el) {
    const b = document.body;
    const keepT = b.style.transform, keepTr = b.style.transition;
    b.style.transition = 'none'; b.style.transform = 'none';
    const r = el.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    b.style.transform = keepT; b.style.transition = keepTr;
    return { left: r.left - br.left, top: r.top - br.top, width: r.width, height: r.height };
  }

  function nodePath(root, node) {
    const path = [];
    while (node && node !== root) {
      const p = node.parentNode;
      if (!p) return null;
      path.unshift([].indexOf.call(p.childNodes, node));
      node = p;
    }
    return node === root ? path : null;
  }
  const nodeAt = (root, path) => path.reduce((n, i) => n && n.childNodes[i], root);

  function buildEcho(x, y) {
    clearEcho();
    if (!document.body) return { count: 0 };
    // climb from the point to the nearest element whose subtree moves
    let el = document.elementFromPoint(x, y);
    const moving = n => {
      try { return n.getAnimations({ subtree: true }).filter(a => !isOurs(a)); }
      catch (_) { return []; }
    };
    let anims = [];
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.hasAttribute && el.hasAttribute(UI_ATTR)) return { count: 0 };
      anims = moving(el);
      if (anims.length) break;
      el = el.parentElement;
    }
    if (!el || !anims.length || el === document.body || el === document.documentElement) return { count: 0 };

    if (!frozen) setFrozen(true);
    const r = measureFlat(el);
    if (r.width < 4 || r.height < 4) return { count: 0 };

    let span = 0;
    for (const a of anims) span = Math.max(span, endOf(a));
    const step = Math.max(40, Math.min(220, span / 8));

    const wrap = document.createElement('div');
    wrap.setAttribute(UI_ATTR, '');
    wrap.style.cssText =
      `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
      'pointer-events:none;z-index:2147483600;perspective:900px;perspective-origin:50% 50%;';

    const PAST = 4, FUTURE = 3;
    const clones = [];
    const offsets = [];
    for (let k = PAST; k >= 1; k--) offsets.push(-k);     // deep past first (paints behind)
    for (let k = FUTURE; k >= 1; k--) offsets.push(k);    // far future first
    for (const k of offsets) {
      const c = el.cloneNode(true);
      const past = k < 0, depth = Math.abs(k);
      c.style.cssText +=
        `;position:absolute;left:0;top:0;width:${r.width}px;height:${r.height}px;margin:0;` +
        `transform:translate3d(${k * 16}px, ${-depth * 6}px, ${(past ? -1 : 1) * depth * 85}px);` +
        `opacity:${Math.max(0.12, 0.6 - depth * 0.12)};pointer-events:none;` +
        (past ? 'filter:sepia(.55) saturate(1.1) brightness(.85);'
              : 'filter:saturate(1.15) brightness(1.08) drop-shadow(0 0 10px rgba(255,176,0,.25));');
      wrap.appendChild(c);

      // silence whatever animations the clone re-instantiated, then replay the
      // original effects onto the matching cloned nodes and park them in time
      try { for (const ca of c.getAnimations({ subtree: true })) ca.cancel(); } catch (_) {}
      const cloneAnims = [];
      for (const a of anims) {
        try {
          const path = nodePath(el, a.effect.target);
          const target = path ? nodeAt(c, path) : null;
          if (!target || !target.animate) continue;
          const kf = a.effect.getKeyframes();
          const tm = a.effect.getComputedTiming();
          const na = target.animate(kf, {
            duration: Number(tm.duration) || 1, delay: Number(tm.delay) || 0,
            easing: tm.easing || 'linear',
            iterations: isFinite(tm.iterations) ? tm.iterations : 1,
            direction: tm.direction || 'normal', fill: 'both',
          });
          na.id = `${NS}-echo`;
          na.pause();
          cloneAnims.push(na);
        } catch (_) {}
      }
      clones.push({ anims: cloneAnims, off: k * step });
    }

    document.body.appendChild(wrap);
    echo = { wrap, ref: anims, clones, span };
    echoSync();
    const label = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
    return { count: clones.length, label, stepMs: Math.round(step) };
  }

  function echoSync() {
    if (!echo) return;
    let t = 0;
    for (const a of echo.ref) { try { t = Math.max(t, Number(a.currentTime || 0)); } catch (_) {} }
    for (const c of echo.clones) {
      const ct = Math.min(Math.max(0, t + c.off), Math.max(0, echo.span - 0.01));
      for (const a of c.anims) { try { a.currentTime = ct; } catch (_) {} }
    }
  }

  function clearEcho() {
    if (!echo) return;
    try { echo.wrap.remove(); } catch (_) {}
    echo = null;
  }

  // ----------------------------------------------------------- message bus
  function reply(payload) {
    window.postMessage({ source: `${NS}-engine`, ...payload }, '*');
  }
  function state() {
    return { rate, frozen, vnow: vNow(), echo: !!echo };
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.source !== `${NS}-hud`) return;
    switch (m.cmd) {
      case 'state': break;
      case 'setRate': setRate(m.value); break;
      case 'setFrozen': setFrozen(m.value); break;
      case 'nudge': nudge(m.value); break;
      case 'seekBy': seekBy(m.value); break;
      case 'scan': reply({ type: 'timeline', ...scanTimeline() }); break;
      case 'scrub': reply({ type: 'scrubbed', ...scrub(m.value) }); break;
      case 'echo': reply({ type: 'echo', ...buildEcho(m.value.x, m.value.y) }); break;
      case 'echoOff': clearEcho(); break;
    }
    reply({ type: 'state', state: state() });
  });
})();
