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
    governNow(); governMedia(true); repump();
  }
  function setFrozen(p) {
    // Only short-circuit when the state is already fully consistent — a frozen
    // state with no window must be allowed to rebuild.
    if (frozen === !!p && (!p || win)) { governNow(); repump(); return; }
    rebase(); frozen = !!p;
    if (frozen) { buildWindow(); holdMedia(); }
    else {
      // Teardown must never strand the page frozen: even if the snap-back step
      // throws, media is released and annotations are cleared.
      try { if (win) histSeek(win.end); }   // snap history back to the present before time resumes
      finally {
        win = null; liveInf = null;
        releaseMedia();
        clearAnnotations();   // echo/score/trail all die with the freeze
      }
    }
    governNow(); repump();
  }
  // Step forward. Inside history this replays the recorded past — no JS
  // re-runs. At the right edge it advances the live virtual clock: timers
  // that come due actually fire, and the window's present moves with it.
  function nudge(ms) {
    if (frozen && win && win.p < win.end - 0.5) { histSeek(win.p + ms); return; }
    rebase(); vBase += ms;
    for (const a of pageAnimations()) {
      try { a.currentTime = Math.max(0, Number(a.currentTime || 0) + ms); } catch (_) {}
    }
    pump();      // run JS timers that the step crossed
    repump();
    advanceMedia(ms);
    if (win) {
      win.end = vNow(); win.p = win.end;
      if (liveInf) for (const li of liveInf) {
        try { li.ct0 = Number(li.a.currentTime || 0); } catch (_) {}
      }
    }
    filmSnap(true);
    echoSync();
  }
  // Move the playhead through held time — backwards is possible here, and
  // only here. JS already executed; we never pretend otherwise.
  function seekBy(ms) {
    if (!frozen) setFrozen(true);
    if (!win) return;
    histSeek(win.p + ms);
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
  // in the same frame sees the same virtual instant. The counter tells the
  // overlay whether a JS draw loop is live, so it can be honest that this
  // kind of motion only steps forward.
  let rafHits = 0;
  window.requestAnimationFrame = function (cb) {
    rafHits++;
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

  // Idle callbacks are timers too — pages that animate from rIC loops
  // (schedulers, React's old fallback, lazy painters) must not escape the
  // forged clock. Modelled as a short virtual timeout with a synthetic
  // deadline; precise idle semantics matter less than obeying the freeze.
  const RIC_DELAY = 16;    // virtual ms until the idle callback runs
  const RIC_BUDGET = 12;   // virtual ms of "time remaining" reported to it
  const realRIC = window.requestIdleCallback && window.requestIdleCallback.bind(window);
  const realCancelRIC = window.cancelIdleCallback && window.cancelIdleCallback.bind(window);
  if (realRIC) {
    window.requestIdleCallback = function (fn, opts) {
      if (typeof fn !== 'function') return realRIC(fn, opts);
      const id = ++timerId;
      const due = vNow() + Math.min(Math.max(1, Number(opts && opts.timeout) || RIC_DELAY), RIC_DELAY);
      timers.set(id, {
        fn: () => {
          const start = vNow();
          fn({ didTimeout: false, timeRemaining: () => Math.max(0, RIC_BUDGET - (vNow() - start)) });
        },
        args: [], due, period: null,
      });
      schedulePump();
      return id;
    };
    window.cancelIdleCallback = function (id) {
      if (timers.delete(id)) { schedulePump(); return; }
      if (realCancelRIC) realCancelRIC(id);
    };
  }

  // WebGL normally discards its buffer after compositing — unreadable to any
  // later capture. Forcing preserveDrawingBuffer at context creation is what
  // makes the canvas film (and any WebGL capture at all) possible; rrweb made
  // the same trade. One-time cost per context, paid at creation.
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    // Respect a page that deliberately opted out (it chose memory over
    // readability); otherwise preserve so the film can read the buffer later.
    if ((type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') &&
        !(attrs && attrs.preserveDrawingBuffer === false))
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return realGetContext.call(this, type, attrs);
  };

  // CSS-in-JS writes styles through the CSSOM, which MutationObserver cannot
  // see — without this, a styled-components hover never rewinds. The prototype
  // patch is installed only while the ledger runs (cssPatch, toggled by
  // ledgerStart/ledgerStop), so a page that never activates Fermata pays
  // nothing on its hottest CSSOM path.
  const realInsertRule = CSSStyleSheet.prototype.insertRule;
  const realDeleteRule = CSSStyleSheet.prototype.deleteRule;
  function patchedInsertRule(rule, index = 0) {
    const r = realInsertRule.call(this, rule, index);
    cssNote(this, 'i', index, rule);
    return r;
  }
  function patchedDeleteRule(index) {
    let txt = null;
    try { txt = this.cssRules[index] && this.cssRules[index].cssText; } catch (_) {}
    const r = realDeleteRule.call(this, index);
    cssNote(this, 'd', index, txt);
    return r;
  }
  function cssPatch(on) {
    CSSStyleSheet.prototype.insertRule = on ? patchedInsertRule : realInsertRule;
    CSSStyleSheet.prototype.deleteRule = on ? patchedDeleteRule : realDeleteRule;
  }

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

  // The one predicate for "the clock has authority here". Scroll-driven
  // animations live on scroll position, not time — their currentTime is a
  // percentage and they follow the scroll, never the rate, the freeze, or
  // the reel. Every animation query (governor, reel, echo, score, trail)
  // goes through this.
  function governable(a) {
    if (isOurs(a)) return false;
    // Scroll-driven animations live on scroll position, not time — never seize
    // them. Detect by type, and fall back to the constructor name when
    // `instanceof` is unavailable (cross-realm, stripped global) so an
    // uncertain timeline is treated as scroll-driven rather than governed.
    try {
      const tl = a.timeline;
      if (tl) {
        const ctor = tl.constructor && tl.constructor.name;
        if (ctor === 'ScrollTimeline' || ctor === 'ViewTimeline') return false;
        if (typeof DocumentTimeline !== 'undefined' && !(tl instanceof DocumentTimeline)) return false;
      }
    } catch (_) {}
    return true;
  }

  function pageAnimations() {
    let anims;
    try { anims = document.getAnimations(); } catch (_) { return []; }
    return anims.filter(governable);
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
          if (a.playState === 'running') {
            a.pause(); frozenByUs.add(a);
            // born into frozen time: hold it at its own first frame with the
            // whole motion ahead, and remember it on the reel
            if (reelSet && !reelSet.has(a)) {
              try { a.currentTime = 0; } catch (_) {}
              reelNote(a);
            }
          }
        } else {
          if (a.playbackRate !== rate) a.playbackRate = rate;
          if (frozenByUs.has(a) && a.playState === 'paused') { a.play(); frozenByUs.delete(a); }
        }
      } catch (_) {}
    }
    governMedia();
    if ((rate !== 1 || frozen) && !governing) { governing = true; realRAF(governLoop); }
  }
  // Full scans of every animation are O(n) per call; on animation-heavy pages
  // doing that every frame is what made the tilt stutter. Every third frame
  // (~50 ms) still catches newborn animations faster than the eye notices.
  let governTick = 0;
  function governLoop() {
    if (rate === 1 && !frozen) { governing = false; return; }
    if (governTick++ % 3 === 0) governNow();
    realRAF(governLoop);
  }

  // ------------------------------------------------- media + SMIL domains
  // Video and audio run on the media clock, which exposes playbackRate and
  // currentTime directly — natively seekable in both directions, the easiest
  // time domain of all. SVG SMIL documents likewise expose pauseAnimations /
  // setCurrentTime on the <svg> root. Both join the rate, the freeze, the
  // step, and the rewind. (SMIL has no rate control — at slowed tempo it
  // honestly keeps real speed until frozen.)
  const mediaRate = new WeakMap();   // el -> the page's own playbackRate
  let mediaGov = null;               // playing media held by the freeze
  let smilGov = null;                // svg roots held by the freeze

  function mediaEls() {
    try {
      return [...document.querySelectorAll('video,audio')]
        .filter(m => !(m.closest && m.closest(`[${UI_ATTR}]`)));
    } catch (_) { return []; }
  }
  function smilRoots() {
    try {
      return [...document.querySelectorAll('svg')].filter(s =>
        s.querySelector('animate,animateTransform,animateMotion,set') &&
        !(s.closest && s.closest(`[${UI_ATTR}]`)));
    } catch (_) { return []; }
  }
  // The governor calls this every ~50 ms while off real time; the
  // querySelectorAll sweep only needs to catch newborn media, so it runs at
  // most twice a second — rate changes apply immediately via force.
  let mediaGovAt = 0;
  function governMedia(force) {
    if (frozen) return;
    const now = realPerfNow();
    if (!force && now - mediaGovAt < 450) return;
    mediaGovAt = now;
    for (const el of mediaEls()) {
      try {
        if (!mediaRate.has(el)) mediaRate.set(el, el.playbackRate || 1);
        const want = Math.max(0.0625, Math.min(16, mediaRate.get(el) * rate));
        if (Math.abs(el.playbackRate - want) > 0.001) el.playbackRate = want;
      } catch (_) {}
    }
  }
  function holdMedia() {
    mediaGov = []; smilGov = [];
    for (const el of mediaEls()) {
      try {
        const wasPlaying = !el.paused && !el.ended && el.readyState > 1;
        if (wasPlaying) el.pause();
        mediaGov.push({ el, wasPlaying, t0: el.currentTime });
      } catch (_) {}
    }
    for (const svg of smilRoots()) {
      try {
        const wasPaused = svg.animationsPaused();
        smilGov.push({ svg, wasPaused, t0: svg.getCurrentTime() });
        if (!wasPaused) svg.pauseAnimations();
      } catch (_) {}
    }
  }
  function releaseMedia() {
    if (mediaGov) for (const g of mediaGov) {
      try {
        g.el.currentTime = g.t0;
        if (g.wasPlaying) { const p = g.el.play(); if (p && p.catch) p.catch(() => {}); }
      } catch (_) {}
    }
    if (smilGov) for (const g of smilGov) {
      try {
        g.svg.setCurrentTime(g.t0);
        if (!g.wasPaused) g.svg.unpauseAnimations();
      } catch (_) {}
    }
    mediaGov = null; smilGov = null;
  }
  // live streams and range-less servers expose a narrow (or empty) seekable
  // range — honor it instead of writing times the element will ignore
  function mediaClamp(el, t) {
    try {
      const s = el.seekable;
      if (s && s.length) return Math.max(s.start(0), Math.min(s.end(0), t));
    } catch (_) {}
    return Math.max(0, t);
  }
  // dt = held-window milliseconds relative to the present edge (≤ 0 in
  // history, advances t0 itself when the live edge moves)
  function seekMedia(dt) {
    if (mediaGov) for (const g of mediaGov) {
      if (!g.wasPlaying) continue;
      try { g.el.currentTime = mediaClamp(g.el, g.t0 + dt / 1000); } catch (_) {}
    }
    if (smilGov) for (const g of smilGov) {
      try { g.svg.setCurrentTime(Math.max(0, g.t0 + dt / 1000)); } catch (_) {}
    }
  }
  // the live edge moved: the baselines advance, then everyone lands on them
  function advanceMedia(ms) {
    if (mediaGov) for (const g of mediaGov) { if (g.wasPlaying) g.t0 += ms / 1000; }
    if (smilGov) for (const g of smilGov) g.t0 += ms / 1000;
    seekMedia(0);
  }

  // The reel: while Fermata is active, every finite animation the page
  // performs is remembered — a held reference to a finished animation can
  // still be sought backward, so the page's recent past stays replayable.
  // Freeze at any moment and the timeline runs from activation (or the last
  // 30 s) to now; drag left and the dropdown you opened five seconds ago
  // replays its entrance. No trap, no timing skill: a DVR for the DOM.
  const REEL_MAX = 200, REEL_WINDOW = 30000;
  let reel = [];        // [{ a, born, end }] — born in vclock ms
  let reelSet = null;
  let reelOn = false;
  let enterV = null;

  // The ledger: animations replay the declarative record; the ledger replays
  // everything else — insertions, removals, class/style/attribute flips,
  // text. Together they make rewind show what actually happened: menus open
  // and close again, and JS-drawn motion replays from its own style history.
  const LOG_MAX = 12000;
  let mlog = [], domPos = 0, mo = null, replaying = false;

  function oursNode(n) {
    const el = n && n.nodeType === 1 ? n : n && n.parentElement;
    return !!(el && el.closest && el.closest(`[${UI_ATTR}]`));
  }
  // styles and nodes Fermata itself holds on the page (pinned fixed elements,
  // tilt companions, film overlays) are not page history
  const isHeld = (n) => !!(n && n.nodeType === 1 && n.hasAttribute &&
    (n.hasAttribute(UI_ATTR) || n.hasAttribute('data-fermata-held')));
  function ledgerStart() {
    if (mo) return;
    mlog = []; domPos = 0;
    mo = new MutationObserver(recs => { if (!replaying) ledgerPush(recs); });
    mo.observe(document.documentElement, {
      subtree: true, childList: true,
      attributes: true, attributeOldValue: true,
      characterData: true, characterDataOldValue: true,
    });
    cssPatch(true);   // start watching CSSOM rule edits only now
  }
  function ledgerStop() {
    if (mo) { try { mo.disconnect(); } catch (_) {} mo = null; }
    cssPatch(false);  // restore the native CSSOM methods — zero pass-through cost
    mlog = []; domPos = 0;
  }
  function ledgerPush(recs) {
    const t = vNow();
    const atHead = domPos === mlog.length;
    for (const m of recs) {
      // the tilt owns body/html attributes while Fermata is active
      if ((m.target === document.body || m.target === document.documentElement) &&
          m.type !== 'childList') continue;
      if (oursNode(m.target)) continue;
      // styles Fermata itself holds on page elements (pinned fixed elements,
      // tilted top-layer companions) are not page history
      if (m.type === 'attributes') {
        if (m.attributeName && m.attributeName.indexOf('data-fermata') === 0) continue;
        if (isHeld(m.target)) continue;
      }
      if (m.type === 'childList') {
        const add = [...m.addedNodes].filter(n => !oursNode(n) && !isHeld(n));
        const rem = [...m.removedNodes].filter(n => !isHeld(n));
        if (!add.length && !rem.length) continue;
        mlog.push({ t, k: 'c', tg: m.target, add, rem, prev: m.previousSibling, next: m.nextSibling });
      } else if (m.type === 'attributes') {
        mlog.push({ t, k: 'a', tg: m.target, n: m.attributeName,
          o: m.oldValue, v: m.target.getAttribute(m.attributeName) });
      } else {
        mlog.push({ t, k: 't', tg: m.target, o: m.oldValue, v: m.target.data });
      }
    }
    ledgerCap(atHead);
  }
  function ledgerCap(atHead) {
    if (mlog.length > LOG_MAX) {
      const drop = mlog.length - (LOG_MAX - 2000);
      mlog.splice(0, drop);
      domPos = Math.max(0, domPos - drop);
    }
    if (atHead) domPos = mlog.length;
  }
  // CSSOM rule edits arrive here from the prototype patches above
  function cssNote(sheet, op, idx, rule) {
    if (!mo || replaying) return;
    const atHead = domPos === mlog.length;
    mlog.push({ t: vNow(), k: 's', sh: sheet, op, idx, rule });
    ledgerCap(atHead);
  }
  // park any animations a replayed change just (re)started at the moment in
  // history they belong to
  function parkNew(node, P, born) {
    if (!node || node.nodeType !== 1 || !node.getAnimations) return;
    let anims = [];
    try { anims = node.getAnimations({ subtree: true }); } catch (_) { return; }
    for (const a of anims) {
      if (!governable(a) || (reelSet && reelSet.has(a))) continue;
      try { if (a.playState === 'running') { a.pause(); a.currentTime = Math.max(0, P - born); } } catch (_) {}
    }
  }
  function undoM(e) {
    try {
      if (e.k === 's') {
        // indices into a live sheet drift as other rules come and go; clamp so
        // a stale index degrades to a no-op instead of throwing (CSSOM rewind
        // is best-effort on churning CSS-in-JS sheets — see README)
        const len = e.sh.cssRules ? e.sh.cssRules.length : 0;
        if (e.op === 'i') { if (e.idx < len) realDeleteRule.call(e.sh, e.idx); }
        else if (e.rule != null) realInsertRule.call(e.sh, e.rule, Math.min(e.idx, len));
      }
      else if (e.k === 'a') { e.o == null ? e.tg.removeAttribute(e.n) : e.tg.setAttribute(e.n, e.o); }
      else if (e.k === 't') e.tg.data = e.o;
      else {
        for (let i = e.add.length - 1; i >= 0; i--) { try { e.add[i].remove(); } catch (_) {} }
        for (const n of e.rem) {
          try {
            if (e.next && e.next.parentNode === e.tg) e.tg.insertBefore(n, e.next);
            else e.tg.appendChild(n);
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
  function redoM(e, P) {
    try {
      if (e.k === 's') {
        const len = e.sh.cssRules ? e.sh.cssRules.length : 0;
        if (e.op === 'i') { if (e.rule != null) realInsertRule.call(e.sh, e.rule, Math.min(e.idx, len)); }
        else if (e.idx < len) realDeleteRule.call(e.sh, e.idx);
      }
      else if (e.k === 'a') {
        e.v == null ? e.tg.removeAttribute(e.n) : e.tg.setAttribute(e.n, e.v);
        parkNew(e.tg, P, e.t);
      } else if (e.k === 't') e.tg.data = e.v;
      else {
        for (const n of e.rem) { try { n.remove(); } catch (_) {} }
        for (const n of e.add) {
          try {
            if (e.next && e.next.parentNode === e.tg) e.tg.insertBefore(n, e.next);
            else if (e.prev && e.prev.parentNode === e.tg) e.tg.insertBefore(n, e.prev.nextSibling);
            else e.tg.appendChild(n);
          } catch (_) {}
        }
        for (const n of e.add) parkNew(n, P, e.t);
      }
    } catch (_) {}
  }
  function domSeek(P) {
    if (!mo) return;
    replaying = true;
    try { mo.takeRecords(); } catch (_) {}
    while (domPos > 0 && mlog[domPos - 1].t > P) undoM(mlog[--domPos]);
    while (domPos < mlog.length && mlog[domPos].t <= P) redoM(mlog[domPos++], P);
    try { mo.takeRecords(); } catch (_) {}
    replaying = false;
  }

  function reelNote(a) {
    if (replaying) return;
    if (!reelSet || reelSet.has(a)) return;
    reelSet.add(a);
    let tm;
    try { tm = a.effect.getComputedTiming(); } catch (_) { return; }
    if (!isFinite(tm.endTime) || !(Number(tm.duration) > 0)) return; // loops scrub by phase instead
    let ct = 0;
    try { ct = Number(a.currentTime || 0); } catch (_) {}
    reel.push({ a, born: vNow() - ct, end: Number(tm.endTime) });
    if (reel.length > REEL_MAX + 20) reel.splice(0, reel.length - REEL_MAX);
  }
  function reelStart() {
    if (reelOn) return;
    reelOn = true; reel = []; reelSet = new WeakSet(); enterV = vNow();
    film = new Map(); filmScanAt = 0; filmSnapAt = 0;
    ledgerStart();
    const tick = () => {
      if (!reelOn) return;
      if (!frozen) {
        for (const a of pageAnimations()) reelNote(a);
        filmSnap(false);
      }
      realRAF(tick);
    };
    realRAF(tick);
  }
  function reelStop() {
    reelOn = false; reel = []; reelSet = null; enterV = null;
    ledgerStop(); filmStop();
  }

  // The film: canvases — 2D, WebGL — are pixels, not a declarative record;
  // there is nothing to seek. So while the reel runs, every visible canvas is
  // sampled into small JPEG frames a few times a second (rrweb's approach),
  // and rewinding lays the nearest frame over the canvas in the page's own
  // space. Forward stepping stays live (rAF re-renders); the film is how the
  // past gets pixels. ~2 MB per canvas for a full 30 s window.
  const FILM_STEP = 280, FILM_MAX = 120, FILM_W = 480;
  let film = null;                  // Map canvas -> { snaps:[{t,url}], overlay, bad }
  let filmList = [];
  let filmScanAt = 0, filmSnapAt = 0;
  let filmCtx = null;

  function filmScan() {
    filmList = [];
    let all;
    try { all = document.querySelectorAll('canvas'); } catch (_) { return; }
    for (const cv of all) {
      if (filmList.length >= 4) break;
      if (cv.closest && cv.closest(`[${UI_ATTR}]`)) continue;
      if (cv.width < 96 || cv.height < 96) continue;
      let r;
      try { r = cv.getBoundingClientRect(); } catch (_) { continue; }
      if (r.width < 48 || r.height < 48 ||
          r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      filmList.push(cv);
      if (!film.has(cv)) film.set(cv, { snaps: [], overlay: null, bad: false });
    }
  }
  function filmSnap(force) {
    if (!film) return;
    const now = realPerfNow();
    if (now - filmScanAt > 2000) { filmScanAt = now; filmScan(); }
    if (!force && now - filmSnapAt < FILM_STEP) return;
    filmSnapAt = now;
    for (const cv of filmList) {
      const f = film.get(cv);
      if (!f || f.bad) continue;
      try {
        const scale = Math.min(1, FILM_W / cv.width);
        const w = Math.max(1, Math.round(cv.width * scale));
        const h = Math.max(1, Math.round(cv.height * scale));
        if (!filmCtx) filmCtx = document.createElement('canvas').getContext('2d');
        const oc = filmCtx.canvas;
        if (oc.width !== w) oc.width = w;
        if (oc.height !== h) oc.height = h;
        filmCtx.drawImage(cv, 0, 0, w, h);
        const url = oc.toDataURL('image/jpeg', 0.55);
        const last = f.snaps[f.snaps.length - 1];
        if (last && last.url === url && !force) continue;  // static canvas: keep the snap at its true draw time
        f.snaps.push({ t: vNow(), url });
        if (f.snaps.length > FILM_MAX) f.snaps.splice(0, f.snaps.length - FILM_MAX);
      } catch (_) { f.bad = true; }    // tainted canvas — leave it in peace
    }
  }
  function filmSeek(P) {
    if (!film || !win) return;
    for (const [cv, f] of film) {
      if (!f.snaps.length) continue;
      if (P >= win.end - 120 || !cv.isConnected) { filmHide(f); continue; }
      let s = f.snaps[0];
      for (const sn of f.snaps) { if (sn.t <= P) s = sn; else break; }
      if (!f.overlay) {
        const img = document.createElement('img');
        img.setAttribute('data-fermata-held', '');
        img.style.cssText =
          'position:absolute;pointer-events:none;z-index:2147483600;margin:0;';
        f.overlay = img;
      }
      if (!f.overlay.isConnected) {
        const r = measureFlat(cv);
        f.overlay.style.left = r.left.toFixed(1) + 'px';
        f.overlay.style.top = r.top.toFixed(1) + 'px';
        f.overlay.style.width = r.width.toFixed(1) + 'px';
        f.overlay.style.height = r.height.toFixed(1) + 'px';
        try { document.body.appendChild(f.overlay); } catch (_) { continue; }
      }
      if (f.overlay.src !== s.url) f.overlay.src = s.url;
    }
  }
  function filmHide(f) {
    if (f.overlay && f.overlay.isConnected) { try { f.overlay.remove(); } catch (_) {} }
  }
  function filmStop() {
    if (film) for (const [, f] of film) filmHide(f);
    film = null; filmList = []; filmCtx = null;
  }

  // The held timeline: [start, end] in vclock ms, p = the playhead. The
  // right edge is the present; everything left of it is replayable history.
  let win = null;
  let liveInf = null;   // infinite animations at freeze: scrubbed by phase shift

  function buildWindow() {
    const now = vNow();
    let start = now;
    for (const it of reel) start = Math.min(start, it.born);
    start = Math.max(start, now - REEL_WINDOW, enterV == null ? now : enterV);
    liveInf = [];
    for (const a of pageAnimations()) {
      let tm;
      try { tm = a.effect.getComputedTiming(); } catch (_) { continue; }
      if (isFinite(tm.endTime)) continue;
      let ct = 0;
      try { ct = Number(a.currentTime || 0); } catch (_) {}
      liveInf.push({ a, ct0: ct });
    }
    win = { start: Math.min(start, now), end: now, p: now };
  }

  function histSeek(P) {
    if (!win) return;
    P = Math.max(win.start, Math.min(win.end, Number(P) || 0));
    win.p = P;
    domSeek(P);   // the DOM first — menus exist before their entrances play
    for (const it of reel) {
      try {
        it.a.pause(); frozenByUs.add(it.a);
        it.a.currentTime = Math.max(0, Math.min(P - it.born, Math.max(0, it.end - 0.01)));
      } catch (_) {}
    }
    for (const li of liveInf) {
      try {
        li.a.pause(); frozenByUs.add(li.a);
        li.a.currentTime = Math.max(0, li.ct0 + (P - win.end));
      } catch (_) {}
    }
    seekMedia(P - win.end);
    filmSeek(P);
    echoSync();
  }

  function scanTimeline() {
    if (frozen && win) {
      return { count: reel.length + (liveInf ? liveInf.length : 0),
               endMs: win.end - win.start, t: win.p - win.start };
    }
    const now = vNow();
    let start = now;
    for (const it of reel) start = Math.min(start, it.born);
    start = Math.max(start, now - REEL_WINDOW, enterV == null ? now : enterV);
    return { count: reel.length, endMs: now - start, t: now - start };
  }

  // The timeline's terrain: how much was happening at each instant —
  // remembered animations mid-flight plus DOM churn from the ledger. The
  // ribbon draws it so the moments are visible before you scrub to them.
  function profile(n) {
    const N = Math.max(8, Math.min(160, (n | 0) || 72));
    let s, e;
    if (frozen && win) { s = win.start; e = win.end; }
    else {
      e = vNow(); s = e;
      for (const it of reel) s = Math.min(s, it.born);
      s = Math.max(s, e - REEL_WINDOW, enterV == null ? e : enterV);
    }
    const len = Math.max(1, e - s);
    const raw = new Float32Array(N);
    for (const it of reel) {
      const i0 = Math.max(0, Math.floor((it.born - s) / len * N));
      const i1 = Math.min(N - 1, Math.floor((it.born + it.end - s) / len * N));
      for (let i = i0; i <= i1; i++) raw[i] += 1;
    }
    for (const mm of mlog) {
      const f = (mm.t - s) / len;
      if (f >= 0 && f <= 1) raw[Math.min(N - 1, (f * N) | 0)] += 0.5;
    }
    const sm = new Float32Array(N);
    let max = 0;
    for (let i = 0; i < N; i++) {
      sm[i] = (raw[Math.max(0, i - 1)] + 2 * raw[i] + raw[Math.min(N - 1, i + 1)]) / 4;
      if (sm[i] > max) max = sm[i];
    }
    const peaks = [];
    for (let i = 0; i < N; i++)
      peaks.push(max ? +Math.pow(sm[i] / max, 0.55).toFixed(3) : 0);
    return { peaks };
  }

  function scrubTo(rel) {
    if (!frozen) setFrozen(true);
    if (!win) return { t: 0, endMs: 0 };
    histSeek(win.start + (Number(rel) || 0));
    return { t: win.p - win.start, endMs: win.end - win.start };
  }
  function scrub(frac) {
    if (!frozen) setFrozen(true);
    if (!win) return { t: 0, endMs: 0 };
    histSeek(win.start + (Math.max(0, Math.min(1, frac)) * (win.end - win.start)));
    return { t: win.p - win.start, endMs: win.end - win.start };
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

  // Climb from a point to the nearest element whose subtree moves — shared
  // by echo, score, and trail.
  function findMoving(x, y) {
    let el = document.elementFromPoint(x, y);
    const moving = n => {
      try { return n.getAnimations({ subtree: true }).filter(governable); }
      catch (_) { return []; }
    };
    let anims = [];
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.hasAttribute && el.hasAttribute(UI_ATTR)) return null;
      anims = moving(el);
      if (anims.length) break;
      el = el.parentElement;
    }
    if (!el || !anims.length || el === document.body || el === document.documentElement) return null;
    return { el, anims, label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') };
  }

  // Shared opening for echo/score/trail: find the moving element under the
  // point, enter the freeze, and measure it flat. Returns null if nothing there
  // moves — every builder bails the same way.
  function beginOverlay(x, y) {
    if (!document.body) return null;
    const hit = findMoving(x, y);
    if (!hit) return null;
    if (!frozen) setFrozen(true);
    return { hit, r: measureFlat(hit.el) };
  }

  function buildEcho(x, y) {
    clearEcho();
    const o = beginOverlay(x, y);
    if (!o) return { count: 0 };
    const el = o.hit.el, anims = o.hit.anims, r = o.r;
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

  // ------------------------------------------------------------------ score
  // Transcribe an element's motion as sheet music, drawn in the page's own
  // space: each animation is a staff, its easing the melody line, duration
  // and delay the bar. The code to reproduce it rides along for copying.
  const SERIF = `ui-serif, 'Iowan Old Style', Palatino, Georgia, serif`;
  const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
  let scoreUI = null;

  function easingPath(easing, w, h) {
    const KW = { linear: [0, 0, 1, 1], ease: [.25, .1, .25, 1], 'ease-in': [.42, 0, 1, 1],
                 'ease-out': [0, 0, .58, 1], 'ease-in-out': [.42, 0, .58, 1] };
    const mSteps = /steps\((\d+)/.exec(easing);
    if (mSteps) {
      const n = Math.max(1, +mSteps[1]);
      let d = `M0 ${h}`;
      for (let i = 1; i <= n; i++) d += ` H${(i / n * w).toFixed(1)} V${(h - i / n * h).toFixed(1)}`;
      return d;
    }
    const mBez = /cubic-bezier\(([^)]+)\)/.exec(easing);
    let cp = mBez ? mBez[1].split(',').map(Number) : KW[String(easing).trim()];
    if (!cp || cp.length !== 4 || cp.some(v => !isFinite(v))) cp = KW.linear;
    const [x1, y1, x2, y2] = cp;
    let d = `M0 ${h}`;
    for (let i = 1; i <= 28; i++) {
      const u = i / 28, v = 1 - u;
      const bx = 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u;
      const by = 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u;
      d += ` L${(bx * w).toFixed(1)} ${(h - by * h).toFixed(1)}`;
    }
    return d;
  }

  function describeAnim(a) {
    let tm = {}, kf = [];
    try { tm = a.effect.getComputedTiming() || {}; } catch (_) {}
    try { kf = a.effect.getKeyframes() || []; } catch (_) {}
    const skip = { offset: 1, easing: 1, composite: 1, computedOffset: 1 };
    const props = [...new Set(kf.flatMap(k => Object.keys(k).filter(p => !skip[p])))];
    return {
      props: props.length ? props : ['style'],
      duration: Number(tm.duration) || 0, delay: Number(tm.delay) || 0,
      easing: tm.easing || 'linear', iterations: tm.iterations,
      infinite: !isFinite(tm.endTime), direction: tm.direction || 'normal',
      kf: kf.map(({ composite, computedOffset, ...rest }) => rest),
    };
  }

  function codeFor(it) {
    const opts = [`duration: ${Math.round(it.duration)}`];
    if (it.delay) opts.push(`delay: ${Math.round(it.delay)}`);
    if (it.easing && it.easing !== 'linear') opts.push(`easing: '${it.easing}'`);
    if (it.infinite) opts.push('iterations: Infinity');
    else if (it.iterations > 1) opts.push(`iterations: ${it.iterations}`);
    if (it.direction !== 'normal') opts.push(`direction: '${it.direction}'`);
    opts.push(`fill: 'both'`);
    return `element.animate(${JSON.stringify(it.kf, null, 2)}, {\n  ${opts.join(',\n  ')}\n});`;
  }

  const shortEase = (e) => {
    const m = /cubic-bezier\(([^)]+)\)/.exec(e);
    if (!m) return e;
    return 'bezier(' + m[1].split(',').map(v =>
      (+v).toFixed(2).replace(/\.?0+$/, '').replace(/^(-?)0\./, '$1.') || '0').join(', ') + ')';
  };

  function buildScore(x, y) {
    clearScore();
    const o = beginOverlay(x, y);
    if (!o) return { count: 0 };
    const items = o.hit.anims.slice(0, 3).map(describeAnim);
    const code = items.map(codeFor).join('\n\n');
    renderScoreCard(o.r, items, o.hit.label);
    return { count: items.length, label: o.hit.label, code };
  }

  function renderScoreCard(r, items, label) {
    const W = 252, CW = 216;
    const bodyW = Math.max(document.documentElement.scrollWidth, innerWidth);
    let left = r.left + r.width + 18;
    if (left + W + 10 > bodyW) left = Math.max(8, r.left - W - 18);
    const top = Math.max(8, r.top);
    const wrap = document.createElement('div');
    wrap.setAttribute(UI_ATTR, '');
    wrap.style.cssText =
      `position:absolute;left:${left}px;top:${top}px;width:${W}px;z-index:2147483600;` +
      `background:rgba(17,13,7,.93);border:1px solid rgba(255,176,0,.35);border-radius:14px;` +
      `padding:13px 16px 11px;pointer-events:none;` +
      `box-shadow:0 18px 50px rgba(0,0,0,.5),0 0 40px rgba(255,176,0,.08);` +
      `font:400 11px/1.45 ${SANS};color:rgba(242,232,213,.8);`;
    let html =
      `<div style="font:italic 400 16px/1.2 ${SERIF};color:#ffc94d;margin-bottom:2px;">${label}</div>` +
      `<div style="font:400 9px/1 ${SANS};letter-spacing:.24em;color:rgba(255,222,150,.45);margin-bottom:10px;">THE SCORE</div>`;
    for (const it of items) {
      const staff = [0, 1, 2, 3, 4].map(i =>
        `<line x1="0" y1="${8 + i * 10}" x2="${CW}" y2="${8 + i * 10}" stroke="rgba(255,176,0,.16)" stroke-width="1"/>`).join('');
      const d = easingPath(it.easing, CW, 40);
      html +=
        `<div style="margin:0 0 10px;">` +
        `<div style="color:#f2e8d5;font-weight:500;margin-bottom:4px;">${it.props.join(' · ')}</div>` +
        `<svg width="${CW}" height="56" viewBox="0 0 ${CW} 56" style="display:block;">${staff}` +
        `<g transform="translate(0,8)">` +
        `<path d="${d}" fill="none" stroke="#ffc94d" stroke-width="1.8" stroke-linecap="round"/>` +
        `<circle cx="0" cy="40" r="3" fill="#ffd45e"/><circle cx="${CW}" cy="0" r="3" fill="#ffd45e"/>` +
        `</g></svg>` +
        `<div style="color:rgba(255,222,150,.75);font-variant-numeric:tabular-nums;">` +
        `${Math.round(it.duration)} ms` +
        (it.delay ? ` · rest ${Math.round(it.delay)} ms` : '') +
        ` · ${shortEase(it.easing)}` +
        (it.infinite ? ' · ∞' : (it.iterations > 1 ? ` · ×${it.iterations}` : '')) +
        `</div></div>`;
    }
    html += `<div style="color:rgba(242,232,213,.45);font-size:10px;">shift S copies this as code</div>`;
    wrap.innerHTML = html;
    const onRight = left > r.left + r.width;
    const lx = onRight ? r.left + r.width : left + W;
    const lw = Math.max(4, Math.abs((onRight ? left : r.left) - lx));
    const lead = document.createElement('div');
    lead.setAttribute(UI_ATTR, '');
    lead.style.cssText =
      `position:absolute;left:${lx}px;top:${r.top + 16}px;width:${lw}px;height:1px;` +
      `background:linear-gradient(90deg,rgba(255,176,0,.55),rgba(255,176,0,.1));` +
      `z-index:2147483600;pointer-events:none;`;
    document.body.appendChild(wrap);
    document.body.appendChild(lead);
    try {
      const a = wrap.animate(
        [{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)' });
      a.id = `${NS}-score`;
    } catch (_) {}
    scoreUI = { wrap, lead };
  }
  function clearScore() {
    if (!scoreUI) return;
    try { scoreUI.wrap.remove(); scoreUI.lead.remove(); } catch (_) {}
    scoreUI = null;
  }

  // ------------------------------------------------------------------ trail
  // The element's actual trajectory through the strip, drawn in the page:
  // beads sit at equal *time* intervals, so their spacing is velocity made
  // visible — bunched is slow, spread is fast, kinks are easing inflections.
  let trailUI = null;
  function buildTrail(x, y, n = 48) {
    clearTrail();
    const o = beginOverlay(x, y);
    if (!o) return { count: 0 };
    const hit = o.hit;
    if (!win || win.end - win.start < 40) return { count: 0 };
    const span = win.end - win.start;
    const p0 = win.p;
    // sample positions flat, all inside one task — the browser never paints
    // the flattened page
    const b = document.body;
    const keepT = b.style.transform, keepTr = b.style.transition;
    b.style.transition = 'none'; b.style.transform = 'none';
    const br = b.getBoundingClientRect();
    const pts = [];
    for (let i = 0; i < n; i++) {
      const tt = (i / (n - 1)) * span;
      histSeek(win.start + tt);
      const rr = hit.el.getBoundingClientRect();
      pts.push({ x: rr.left + rr.width / 2 - br.left, y: rr.top + rr.height / 2 - br.top, t: tt });
    }
    b.style.transform = keepT; b.style.transition = keepTr;
    histSeek(p0);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (maxX - minX < 6 && maxY - minY < 6) return { count: 0, still: true, label: hit.label };
    renderTrail(pts);
    return { count: n, label: hit.label, spanMs: span };
  }

  function renderTrail(pts) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute(UI_ATTR, '');
    const w = Math.max(document.documentElement.scrollWidth, innerWidth);
    const h = Math.max(document.documentElement.scrollHeight, innerHeight);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483599;pointer-events:none;overflow:visible;';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const n = pts.length;
    let inner =
      `<path d="${d}" fill="none" stroke="rgba(255,176,0,.14)" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="${d}" fill="none" stroke="rgba(255,201,77,.55)" stroke-width="1.5"/>`;
    pts.forEach((p, i) => {
      const major = i % 8 === 0 || i === n - 1;
      const o = .3 + .65 * (i / (n - 1));
      inner += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${major ? 3.2 : 2}" ` +
        `fill="rgba(255,${major ? 222 : 201},${major ? 150 : 77},${o.toFixed(2)})"/>`;
    });
    const p0 = pts[0], pn = pts[n - 1];
    inner +=
      `<text x="${(p0.x + 8).toFixed(1)}" y="${(p0.y - 8).toFixed(1)}" fill="rgba(255,222,150,.85)" font-size="10" font-family="sans-serif">0:00</text>` +
      `<text x="${(pn.x + 8).toFixed(1)}" y="${(pn.y - 8).toFixed(1)}" fill="rgba(255,222,150,.85)" font-size="10" font-family="sans-serif">+${(pn.t / 1000).toFixed(2)}s</text>`;
    svg.innerHTML = inner;
    document.body.appendChild(svg);
    try {
      const a = svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
      a.id = `${NS}-trail`;
    } catch (_) {}
    trailUI = { svg };
  }
  function clearTrail() {
    if (!trailUI) return;
    try { trailUI.svg.remove(); } catch (_) {}
    trailUI = null;
  }
  // every body-space annotation, gone in one call — used on unfreeze so no
  // echo ghost is ever stranded in the resumed page
  function clearAnnotations() { clearEcho(); clearScore(); clearTrail(); }

  // ----------------------------------------------------------- message bus
  function reply(payload) {
    window.postMessage({ source: `${NS}-engine`, ...payload }, '*');
  }
  function state() {
    // sampled between state polls (~150 ms): a live rAF loop re-registers
    // every frame, so even a couple of hits means code is drawing motion
    const rafBusy = rafHits >= 2;
    rafHits = 0;
    return { rate, frozen, vnow: vNow(), echo: !!echo, rafBusy,
             score: !!scoreUI, trail: !!trailUI };
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
      case 'scrubTo': reply({ type: 'scrubbed', ...scrubTo(m.value) }); break;
      case 'echo': reply({ type: 'echo', ...buildEcho(m.value.x, m.value.y) }); break;
      case 'echoOff': clearEcho(); break;
      case 'reel': m.value ? reelStart() : reelStop(); break;
      case 'profile': reply({ type: 'profile', ...profile(m.value) }); break;
      case 'probe': {
        const hit = m.value ? findMoving(m.value.x, m.value.y) : null;
        reply({ type: 'probe', has: !!hit, label: hit ? hit.label : '' });
        break;
      }
      case 'score': reply({ type: 'score', ...buildScore(m.value.x, m.value.y) }); break;
      case 'scoreOff': clearScore(); break;
      case 'trail': reply({ type: 'trail', ...buildTrail(m.value.x, m.value.y) }); break;
      case 'trailOff': clearTrail(); break;
    }
    reply({ type: 'state', state: state() });
  });
})();
