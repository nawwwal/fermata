// Fermata — experience layer (ISOLATED world).
// Talks to the MAIN-world engine over postMessage, to the service worker for
// screenshots. The interface is the page itself: freeze time and the live DOM
// tilts back into perspective — a slab of frozen glass you can orbit, step,
// drag through time, loop, and clone into depth-fanned echoes. One quiet
// capsule of words at the bottom; every move has a single key.
//
// This world's clock is real (the engine only forges MAIN-world time), so all
// timers and rAF loops here run at true speed even while the page is frozen.

(() => {
  'use strict';
  if (window.__fermataHud) return;
  window.__fermataHud = true;

  const NS = 'fermata';
  const UI_ATTR = 'data-fermata-ui';
  const SERIF = `ui-serif, "Iowan Old Style", Palatino, "Book Antiqua", Georgia, serif`;
  const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');

  // entrances and exits accelerate toward the user; on-screen moves breathe
  const EASE = {
    out: 'cubic-bezier(.215,.61,.355,1)',      // cubic — workhorse
    outQuint: 'cubic-bezier(.23,1,.32,1)',     // big entrances
    inOut: 'cubic-bezier(.645,.045,.355,1)',   // already-visible movement
  };

  const TEMPOS = [
    { r: 0.05, word: 'grave',   plain: '1/20 speed' },
    { r: 0.1,  word: 'largo',   plain: '1/10 speed' },
    { r: 0.25, word: 'adagio',  plain: '1/4 speed' },
    { r: 0.5,  word: 'andante', plain: '1/2 speed' },
    { r: 1,    word: 'a tempo', plain: 'full speed · 1×' },
    { r: 2,    word: 'presto',  plain: '2× speed' },
  ];

  let active = false;
  let host = null, ui = {};
  let st = { rate: 1, frozen: false, vnow: 0, echo: false, armed: false, score: false, trail: false };
  let lastScore = '';
  let tl = { count: 0, endMs: 0, t: 0 };
  let recording = false;
  let lastBadge = null;
  let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  let toastTimer = null;

  // body styling we own while tilted — saved so release restores the site
  let saved = null;
  let tilted = false;
  let tiltAnim = null;
  let orbit = { rx: 13, ry: 0 };       // target, from the cursor
  let orbitCur = { rx: 13, ry: 0 };    // eased present value
  let orbitRaf = 0;
  let fixedComp = [];                  // viewport-fixed elements we re-anchor
  let companions = [];                 // top-layer dialogs/popovers we tilt along

  // the repeatable portion of the strip: [ marks in, ] marks out, L replays
  let loopSel = { a: null, b: null, playing: false, raf: 0, t0: 0 };

  // ------------------------------------------------------------ engine bus
  const send = (cmd, value) => window.postMessage({ source: `${NS}-hud`, cmd, value }, '*');

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.source !== `${NS}-engine`) return;
    if (m.type === 'state') { st = m.state; render(); }
    if (m.type === 'timeline') { tl = { count: m.count, endMs: m.endMs, t: m.t }; renderRibbon(); }
    if (m.type === 'scrubbed') { tl.t = m.t; if (m.endMs) tl.endMs = m.endMs; renderRibbon(); }
    if (m.type === 'profile') drawWave(m.peaks);
    if (m.type === 'probe') showWhisper(m);
    if (m.type === 'echo') {
      if (m.count) toast('echo', `${m.label} — past behind, future ahead`);
      else toast('nothing moves here', 'point at something animating and press E');
    }
    if (m.type === 'score') {
      if (m.count) { lastScore = m.code || ''; toast('the score', `${m.label} — shift S copies the code`); }
      else toast('nothing to score', 'point at something animating and press S');
    }
    if (m.type === 'trail') {
      if (m.count) toast('trail', `${m.label} — beads sit ${Math.max(1, Math.round(m.spanMs / 47))} ms apart`);
      else if (m.still) toast('no travel', `${m.label} animates in place — E echoes it instead`);
      else toast('no trail here', 'point at something that travels and press T');
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'fermata-toggle') (active ? leave : enter)();
  });

  function badge() {
    const text = st.frozen ? 'HELD'
      : Math.abs(st.rate - 1) < 0.005 ? (active ? '1×' : '')
      : st.rate < 1 ? st.rate.toFixed(2).replace(/^0/, '') + '×'
      : st.rate.toFixed(0) + '×';
    if (text === lastBadge) return;
    lastBadge = text;
    try { chrome.runtime.sendMessage({ type: 'fermata-badge', text }); } catch (_) {}
  }

  // ----------------------------------------------------------------- enter
  function enter() {
    if (active) return;
    active = true;
    build();
    // The toolbar click leaves keyboard focus in the browser chrome — pull it
    // back into the page so the keys work immediately, no click required.
    try { window.focus(); } catch (_) {}
    try { host.focus({ preventScroll: true }); } catch (_) {}
    send('state'); send('scan');
    send('reel', true);   // from this moment, everything the page does is replayable
    // the arrival, in order: the wave crosses and the page ripples in its
    // wake → the word lands center stage → the capsule rises at the foot
    const sweep = splash('in');
    if (ui.capsule) ui.capsule.style.animationDelay = (sweep ? sweep + 420 : 0) + 'ms';
    setTimeout(() => { if (active) toast('fermata', 'you hold this page’s clock — space to freeze', true); },
      sweep ? sweep + 140 : 120);
    maybeFirstRun();
    tickLoop();
  }

  // once, ever: if the very first visit goes four seconds without a key,
  // one serif line says what to do — then never again
  let firstRunT = null;
  function maybeFirstRun() {
    try {
      chrome.storage.local.get('fermataSeen', (v) => {
        if (v && v.fermataSeen) return;
        firstRunT = setTimeout(() => {
          firstRunT = null;
          if (!active || st.frozen) return;
          toast('press space', 'the page will hold its breath');
          firstRunDone();
        }, 4200);
      });
    } catch (_) {}
  }
  function firstRunDone() {
    if (firstRunT) { clearTimeout(firstRunT); firstRunT = null; }
    try { chrome.storage.local.set({ fermataSeen: true }); } catch (_) {}
  }

  function leave() {
    if (!active || recording) return;
    active = false;
    splash('out');
    stopLoop();
    loopSel.a = loopSel.b = null;
    send('echoOff');
    send('setFrozen', false);
    send('setRate', 1);
    send('reel', false);
    untilt(false);
    dismissUi();
    lastBadge = null;
    try { chrome.runtime.sendMessage({ type: 'fermata-badge', text: '' }); } catch (_) {}
  }

  function dismissUi() {
    const h = host;
    host = null;
    if (!h) return;
    try {
      ui.capsule.classList.add('out');
      ui.vig.classList.remove('in');
      ui.ribbon.classList.remove('in');
      ui.stage.classList.remove('in');
      ui.toast.classList.remove('show');
    } catch (_) {}
    ui = {};
    setTimeout(() => { try { h.remove(); } catch (_) {} }, 240);
  }

  let tick = 0;
  function tickLoop() {
    if (!active) return;
    if (!recording) {
      send('state');
      // keep folding newborn animations (hover transitions, late starts) into
      // the frozen strip so the scrubber never goes stale mid-session
      if (st.frozen && !drag && !loopSel.playing && tick++ % 2 === 0) send('scan');
    }
    setTimeout(tickLoop, 150);
  }

  // ---------------------------------------------------------------- splash
  // The swell. One crest of golden light enters above the page and travels
  // down it at constant speed, the way a sea swell crosses open water — one
  // direction, one surface. Every element rides it as the crest passes:
  // top edge pitches up into the front, the body rises toward you and is
  // carried down a little on the crest, pulls back up through the trough,
  // then settles with a damped bob. Neighbours at the same height move in
  // phase, so the whole page reads as one surface lifting. Leaving runs the
  // swell bottom-to-top: the page dips and releases upward.
  //
  // All element motion is WAAPI with composite:'add' — it stacks on top of
  // whatever transform an element already has and removes itself completely
  // when it finishes. Nothing is written to page styles. Returns the sweep
  // duration so the arrival can be orchestrated around it.
  function splash(dir) {
    if (REDUCE.matches || recording || !document.body) return 0;
    const vw = innerWidth, vh = innerHeight, vArea = vw * vh;
    const out = dir === 'out';
    const sweep = Math.min(880, Math.max(560, vh / 1.15));   // crest speed ~1.15 px/ms

    // a swell still in flight from a rapid toggle is left to finish — additive
    // waves superpose and settle on their own; cancelling one mid-ride is
    // exactly the kind of snap the eye reads as a glitch
    // geometry of the cloth: the lead crest enters `lead` px off-screen and
    // exits the same margin past the far edge; a softer packet trails it.
    // Element delays are solved against the crest's actual position so the
    // drawn lines and the element motion stay welded.
    const lead = 120, travelBase = vh + 2 * lead;
    // leaving is an exhale: noticeably shorter and quieter than arriving
    const dur = Math.round(sweep * (out ? 1.15 : 1.75));

    const targets = splashTargets(vw, vh, vArea);
    const cellParams = [];
    let cells = '';
    for (const t of targets) {
      const r = t.r;
      const cy = r.top + r.height / 2;
      const frac = Math.max(0, Math.min(1, cy / vh));
      const hit = Math.max(0, Math.min(1, (out ? vh + lead - cy : cy + lead) / travelBase));
      const delay = hit * sweep;
      // big ships ride low, small craft bob; the swell sheds a little energy
      // as it crosses. The page barely moves — a breath, not a heave; the
      // light is the protagonist and the elements only acknowledge it.
      const size = 1 - Math.min((r.width * r.height) / (vArea * 0.4), 1) * 0.6;
      const spent = 1 - frac * 0.22;
      const A = (out ? 3.5 : 6) * size * spent + 1.6;         // crest height, px of z
      const T = Math.min(2.2, Math.max(0.6, A * 0.35)) *
                Math.min(1, 260 / Math.max(r.width, r.height));  // pitch, deg
      const p = {
        delay, A, T, out,
        ax: out ? 1 : -1, ay: 0,                  // pitch about x: facing edge lifts first
        px: 0, py: (out ? -1 : 1) * A * 0.3,      // orbital carry along the travel
      };
      waveRide(t.el, p);
      if (!out) {       // crest light: a soft golden lining that rides along
        cellParams.push(p);
        cells += `<div class="cell" style="left:${r.left.toFixed(1)}px;top:${r.top.toFixed(1)}px;` +
          `width:${r.width.toFixed(1)}px;height:${r.height.toFixed(1)}px">` +
          `<div class="edge"></div><div class="clip">` +
          `<i class="sheen" style="animation-delay:${(delay + sweep * 0.04).toFixed(0)}ms"></i></div></div>`;
      }
    }

    // ------- the page as terrain -------
    // The displacement map is not noise: it is the DOM. Every vessel stamps a
    // smooth hill into a coarse heightmap — height grows with DOM depth (the
    // deeper a component nests, the higher it sits under the sheet) and with
    // smallness (leaf widgets ride on top of their sections). The cloth then
    // deforms over the page's actual furniture as the crest passes.
    const CELL = 16;
    const gw = Math.ceil(vw / CELL) + 2, gh = Math.ceil(vh / CELL) + 2;
    const HM = new Float32Array(gw * gh);
    for (const t of targets) {
      const r = t.r;
      const hgt = 12 + Math.min(24, t.depth) * 4.5 +
                  (1 - Math.min(1, (r.width * r.height) / (vArea * 0.38))) * 16;
      const pad = 46;
      const x0 = Math.max(0, ((r.left - pad) / CELL) | 0), x1 = Math.min(gw - 1, Math.ceil((r.right + pad) / CELL));
      const y0 = Math.max(0, ((r.top - pad) / CELL) | 0), y1 = Math.min(gh - 1, Math.ceil((r.bottom + pad) / CELL));
      for (let gy = y0; gy <= y1; gy++) {
        const py = gy * CELL;
        const ddy = Math.max(0, Math.max(r.top - py, py - r.bottom));
        for (let gx = x0; gx <= x1; gx++) {
          const px = gx * CELL;
          const ddx = Math.max(0, Math.max(r.left - px, px - r.right));
          const f = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * pad * pad));
          const i = gy * gw + gx;
          const v = HM[i] + hgt * f;
          HM[i] = v > 95 ? 95 : v;
        }
      }
    }
    const hAt = (x, y) => {
      if (x < 0) x = 0; else if (x > vw) x = vw;
      if (y < 0) y = 0; else if (y > vh) y = vh;
      const fx = x / CELL, fy = y / CELL;
      const ix = fx | 0, iy = fy | 0;
      const tx = fx - ix, ty = fy - iy;
      const i00 = iy * gw + ix;
      const h00 = HM[i00] || 0, h10 = HM[i00 + 1] || 0;
      const h01 = HM[i00 + gw] || 0, h11 = HM[i00 + gw + 1] || 0;
      return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
    };

    const sh = document.createElement('div');
    sh.setAttribute(UI_ATTR, '');
    sh.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = sh.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .cell { position: fixed; border-radius: 10px; opacity: 0; transform-origin: 50% 50%; }
  .edge { position: absolute; inset: 0; border-radius: inherit;
    border: 1px solid rgba(255,201,77,.45);
    box-shadow: 0 0 14px rgba(255,176,0,.15), inset 0 0 18px rgba(255,176,0,.05); }
  .clip { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; }
  .sheen { position: absolute; top: -60%; bottom: -60%; left: 0; width: 45%; opacity: 0;
    background: linear-gradient(90deg, transparent, rgba(255,222,150,.24), transparent);
    animation: sheen .6s ${EASE.inOut} both; }
  @keyframes sheen {
    from { transform: translateX(-150%) rotate(12deg); opacity: 0; }
    20%  { opacity: 1; }
    to   { transform: translateX(300%) rotate(12deg); opacity: 0; }
  }
  /* the cloth: drawn, not faked — fine contour lines across the whole page,
     bent by the traveling wave the way scanlines bend over shaken fabric.
     Where the wave compresses them they read as light; where it stretches
     them, shadow. Flat cloth shows almost nothing. */
  .cloth { position: fixed; inset: 0; width: 100%; height: 100%; }
</style>
<div class="w ${out ? 'out' : 'in'}">
  <canvas class="cloth"></canvas>
  ${cells}
</div>`;
    document.documentElement.appendChild(sh);

    // ------- the contour-line cloth renderer -------
    // Each scanline is displaced by a Gaussian wave packet traveling at the
    // same constant speed the element delays were solved against, plus a
    // softer packet trailing it. Horizontal meander varies the crest's
    // amplitude across the width, so it bulges like held fabric instead of
    // sweeping like a scanner. Line opacity follows the local wave energy:
    // flat cloth nearly vanishes, the moving fold draws itself.
    try {
      const cv = root.querySelector('.cloth');
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      cv.width = Math.round(vw * dpr);
      cv.height = Math.round(vh * dpr);
      const g = cv.getContext('2d');
      const speed = travelBase / sweep;            // px per ms, constant
      const GAP = 6, STEP = 8;
      const AMP = out ? 24 : 34, SIG = 260, LAM = 380;  // free ripple in open ground
      const SIG2 = 300, LAM2 = 520;                // trailing swell, broader
      const trail = out ? -340 : 340;
      const tStart = performance.now();
      const frame = (now) => {
        if (!sh.isConnected) return;
        const t = now - tStart;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, vw, vh);
        if (t > dur) return;
        const yc = out ? vh + lead - speed * t : -lead + speed * t;
        g.globalAlpha = Math.min(1, t / 140) * Math.min(1, Math.max(0, (dur - t) / 320));
        for (let ly = -110; ly < vh + 110; ly += GAP) {
          const d = ly - yc;
          const env = Math.exp(-(d * d) / (SIG * SIG));
          const d2 = d + trail;
          const env2 = Math.exp(-(d2 * d2) / (SIG2 * SIG2));
          const energy = Math.max(env, env2 * 0.7);
          if (energy < 0.035) continue;            // flat cloth: invisible
          // steepen the waveform: a flicked sheet has a sharp front and a
          // long back, not a polite cosine
          const ph = (d / LAM) * 2 * Math.PI;
          const lean = ph + 0.85 * Math.sin(ph);
          const ph2 = (d2 / LAM2) * 2 * Math.PI;
          const lean2 = ph2 + 0.5 * Math.sin(ph2);
          const a1 = AMP * env, a2 = AMP * 0.55 * env2;
          g.lineWidth = 0.8 + 0.9 * energy;        // crest lines carry weight
          g.strokeStyle = `rgba(255,205,110,${(0.62 * Math.pow(energy, 1.1)).toFixed(3)})`;
          g.beginPath();
          let first = true;
          for (let x = -8; x <= vw + 8; x += STEP) {
            // amplitude heaves and *dies to zero* across the width, and the
            // bulges drift as the wave travels — held fabric, not a stamp
            const mx = Math.max(0, 1 + 0.85 * Math.sin(x * 0.0032 + 1.7 + t * 0.0005)
                                   + 0.45 * Math.sin(x * 0.0085 + 0.3 - t * 0.0003));
            const mx2 = Math.max(0, 1 + 0.8 * Math.sin(x * 0.0055 - 0.8 + t * 0.0004));
            const ripple = a1 * mx * Math.cos(lean + 0.7 * Math.sin(x * 0.003))
                         + a2 * mx2 * Math.cos(lean2 + x * 0.0025);
            // the DOM is the terrain: as the crest arrives, the sheet
            // inflates over the page's furniture and relaxes behind it
            const liftPh = 0.55 + 0.45 * Math.cos(lean);
            const w = ripple - hAt(x, ly) * env * liftPh;
            // the cloth also gathers sideways into the fold
            const gxs = 0.45 * ripple * Math.sin(x * 0.004 + 0.9);
            if (first) { g.moveTo(x + gxs, ly + w); first = false; }
            else g.lineTo(x + gxs, ly + w);
          }
          g.stroke();
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    } catch (_) {}

    // crest light rides the exact same wave as its element, so they stay
    // welded together for the whole pass
    const cellEls = root.querySelectorAll('.cell');
    cellEls.forEach((cell, i) => {
      const p = cellParams[i];
      if (!p) return;
      const k = waveKeyframes(p);
      const glow = [0, .32, .55, .3, .1, .03, 0];
      k.forEach((f, j) => { f.opacity = glow[j]; });
      try {
        const a = cell.animate(k, { duration: 1350, delay: p.delay });
        a.id = `${NS}-wave`;
      } catch (_) {}
    });

    setTimeout(() => { try { sh.remove(); } catch (_) {} }, sweep + (out ? 900 : 1700));
    return sweep;
  }

  // One pass of the swell under one element. Orbital motion, like water:
  // the near edge pitches up as the front arrives, the body rises and is
  // carried forward on the crest, pitches the other way as it passes, pulls
  // back through the trough, then settles in a damped bob. Movement of an
  // on-screen element, so every leg eases in-out.
  function waveKeyframes(p, flat) {
    const E = EASE.inOut;
    // flat: the element already lives in a transform/3D context (card fans,
    // carousels). Adding perspective + rotation there reshuffles its paint
    // order against overlapping siblings — the "everything blinks away" bug —
    // so those hulls ride in-plane: drift and a whisper of scale, no z, no tilt.
    const tf = flat
      ? (z, t, kx = 0, ky = 0) =>
        `translate(${kx.toFixed(2)}px, ${ky.toFixed(2)}px) scale(${(1 + z / 1600).toFixed(4)})`
      : (z, t, kx = 0, ky = 0) =>
        `perspective(1100px) translate3d(${kx.toFixed(2)}px, ${ky.toFixed(2)}px, ${z.toFixed(2)}px) ` +
        `rotate3d(${p.ax.toFixed(4)}, ${p.ay.toFixed(4)}, 0, ${t.toFixed(3)}deg)`;
    if (p.out) return [
      { transform: tf(0, 0), easing: E, offset: 0 },
      { transform: tf(-p.A * 0.55, -p.T * 0.5, -p.px * 0.6, -p.py * 0.6), easing: E, offset: 0.3 },
      { transform: tf(p.A * 0.18, p.T * 0.22), easing: E, offset: 0.62 },
      { transform: tf(0, 0), offset: 1 },
    ];
    return [
      { transform: tf(0, 0), easing: E, offset: 0 },
      { transform: tf(p.A * 0.5, p.T, p.px * 0.4, p.py * 0.4), easing: E, offset: 0.14 },          // bow lifts into the front
      { transform: tf(p.A, 0, p.px, p.py), easing: E, offset: 0.30 },                              // riding the crest, carried along
      { transform: tf(p.A * 0.3, -p.T * 0.7, p.px * 0.3, p.py * 0.3), easing: E, offset: 0.46 },   // stern up as it passes
      { transform: tf(-p.A * 0.35, -p.T * 0.15, -p.px * 0.45, -p.py * 0.45), easing: E, offset: 0.64 }, // the trough pulls back
      { transform: tf(p.A * 0.09, p.T * 0.06, p.px * 0.08, p.py * 0.08), easing: E, offset: 0.82 },     // damped settle
      { transform: tf(0, 0), offset: 1 },
    ];
  }
  function waveRide(el, p) {
    try {
      let flat = false;
      try {
        const cs = getComputedStyle(el);
        flat = cs.transform !== 'none' || cs.transformStyle === 'preserve-3d';
        if (!flat && el.parentElement) {
          const ps = getComputedStyle(el.parentElement);
          flat = ps.transformStyle === 'preserve-3d' || ps.perspective !== 'none';
        }
      } catch (_) {}
      const a = el.animate(waveKeyframes(p, flat), {
        duration: p.out ? 680 : 1350,    // exits run well under half the entrance
        delay: p.delay,
        composite: 'add',
      });
      a.id = `${NS}-wave`;
    } catch (_) {}
  }

  // The vessels: visible, component-sized elements chosen top-down. Once an
  // element is chosen its whole subtree rides as one rigid body — a card is a
  // ship, not a flotilla of its own children. Hard caps bound the cost on
  // intensive pages.
  function splashTargets(vw, vh, vArea) {
    const out = [];
    const queue = [document.body];
    let visits = 0;
    while (queue.length && out.length < 70 && visits < 1600) {
      const el = queue.shift();
      visits++;
      if (!el || el.nodeType !== 1) continue;
      if (el.hasAttribute && el.hasAttribute(UI_ATTR)) continue;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
      let r;
      try { r = el.getBoundingClientRect(); } catch (_) { continue; }
      const visible = r.bottom > -30 && r.top < vh + 30 && r.right > -30 && r.left < vw + 30;
      const area = r.width * r.height;
      if (visible && r.width >= 36 && r.height >= 20 &&
          area >= 3200 && area <= vArea * 0.38) {
        let depth = 0, n = el;
        while (n && n !== document.body && depth < 24) { depth++; n = n.parentElement; }
        out.push({ el, r, depth });
        continue;                       // children ride with their vessel
      }
      for (let i = 0; i < el.children.length; i++) queue.push(el.children[i]);
    }
    return out;
  }

  // ------------------------------------------------------------------ tilt
  // The page itself becomes the 3D object: the live body tilts back into
  // perspective over a dark golden room. Real DOM, still alive — only its
  // clock is confiscated. will-change keeps the orbit composite-only, so it
  // stays smooth even on paint-heavy pages.
  const tiltTransform = (o) =>
    `perspective(1500px) translateY(-1.5vh) scale(.9) rotateX(${o.rx.toFixed(3)}deg) rotateY(${o.ry.toFixed(3)}deg)`;

  function tilt() {
    if (tilted || !document.body) return;
    tilted = true;
    const b = document.body, d = document.documentElement;
    if (tiltAnim) { try { tiltAnim.cancel(); } catch (_) {} tiltAnim = null; }
    if (!saved) saved = {
      transform: b.style.transform, origin: b.style.transformOrigin,
      shadow: b.style.boxShadow, outline: b.style.outline,
      radius: b.style.borderRadius, will: b.style.willChange,
      bg: d.style.background, cursor: d.style.cursor,
    };
    // Measure and pin BEFORE touching any body style: will-change alone
    // already makes the body a containing block, which re-anchors every
    // fixed element and poisons the very rects the pinning needs.
    compensateFixed();
    gatherCompanions();
    // Pivot about the point of the body currently at 45% of the viewport —
    // measured, not derived from scrollY, which is 0 on sites that scroll by
    // transforming a wrapper (Lenis and friends) and would fling the page.
    const originY = innerHeight * 0.45 - b.getBoundingClientRect().top;
    d.style.background =
      'radial-gradient(130% 100% at 50% -8%, #342812 0%, #1d160c 38%, #0b0906 100%)';
    b.style.transformOrigin = `50% ${originY.toFixed(1)}px`;
    // the last shadow is the slab's lower rim catching the room's light —
    // a hairline of thickness so the page reads as an object, not a plane
    b.style.boxShadow =
      '0 90px 160px rgba(0,0,0,.6), 0 28px 60px rgba(0,0,0,.45), ' +
      '0 0 110px rgba(255,176,0,.09), 0 1px 0 rgba(255,210,110,.28)';
    b.style.outline = '1px solid rgba(255,176,0,.25)';
    d.style.cursor = 'ew-resize';    // the frozen page itself scrubs — say so
    b.style.borderRadius = '10px';
    b.style.willChange = 'transform';
    if (ui.stage) ui.stage.classList.add('in');
    orbit = { rx: 13, ry: 0 };
    orbitCur = { rx: 13, ry: 0 };
    if (REDUCE.matches) {
      b.style.transform = tiltTransform(orbitCur);
      syncCompanions(orbitCur);
      return;
    }
    let from = 'none';
    try { const cur = getComputedStyle(b).transform; if (cur && cur !== 'none') from = cur; } catch (_) {}
    const a = b.animate([{ transform: from }, { transform: tiltTransform(orbitCur) }],
      { duration: 700, easing: EASE.outQuint });
    a.id = `${NS}-tilt`;
    tiltAnim = a;
    a.onfinish = () => {
      tiltAnim = null;
      if (tilted) { b.style.transform = tiltTransform(orbitCur); startOrbit(); }
      try { a.cancel(); } catch (_) {}
    };
  }

  function untilt(instant) {
    if (!tilted || !document.body) { tilted = false; return; }
    tilted = false;
    stopOrbit();
    if (tiltAnim) { try { tiltAnim.cancel(); } catch (_) {} tiltAnim = null; }
    const b = document.body, d = document.documentElement;
    if (ui.stage) ui.stage.classList.remove('in');
    const finish = () => {
      if (!saved) return;
      b.style.transform = saved.transform; b.style.transformOrigin = saved.origin;
      b.style.boxShadow = saved.shadow; b.style.outline = saved.outline;
      b.style.borderRadius = saved.radius; b.style.willChange = saved.will;
      d.style.background = saved.bg; d.style.cursor = saved.cursor;
      saved = null;
      restoreFixed();
      restoreCompanions();
    };
    if (instant || REDUCE.matches) { finish(); return; }
    for (const c of companions) {
      try {
        const ca = c.el.animate(
          [{ transform: c.el.style.transform || 'none' }, { transform: c.prev.transform || 'none' }],
          { duration: 480, easing: EASE.outQuint });
        ca.id = `${NS}-companion`;
      } catch (_) {}
    }
    const a = b.animate(
      [{ transform: b.style.transform || tiltTransform(orbitCur) }, { transform: saved.transform || 'none' }],
      { duration: 480, easing: EASE.outQuint });
    a.id = `${NS}-tilt`;
    tiltAnim = a;
    a.onfinish = () => { tiltAnim = null; finish(); try { a.cancel(); } catch (_) {} };
  }

  // A transformed body is a containing block: position:fixed re-anchors from
  // the viewport to the document. On a scrolled page every fixed header flies
  // off-screen; worse, an `inset: 0` modal overlay suddenly sizes itself to
  // the whole tall document and its flex-centered dialog lands thousands of
  // pixels below the viewport — the modal "just disappears". Translating is
  // not enough: each fixed element is pinned to its exact pre-tilt viewport
  // rect, position *and* size, expressed in document space. Inline styles are
  // saved and restored verbatim on release.
  function compensateFixed() {
    if (fixedComp.length) return;
    const sx = scrollX, sy = scrollY;
    let els = document.body.getElementsByTagName('*');
    if (els.length > 7000) {
      // intensive page: fixed surfaces (headers, modals, toasts) live near
      // the top of the tree — scan three levels instead of stalling
      try { els = document.body.querySelectorAll(':scope > *, :scope > * > *, :scope > * > * > *'); }
      catch (_) { return; }
    }
    for (const el of els) {
      if (el.hasAttribute(UI_ATTR)) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      if (cs.position !== 'fixed' || cs.display === 'none') continue;
      // already inside a containing-block ancestor → it was never
      // viewport-anchored, and the tilt changes nothing for it
      let anc = el.parentElement, contained = false;
      while (anc && anc !== document.body) {
        const acs = getComputedStyle(anc);
        if (acs.transform !== 'none' || acs.filter !== 'none' ||
            (acs.backdropFilter && acs.backdropFilter !== 'none') ||
            (acs.willChange || '').includes('transform')) { contained = true; break; }
        anc = anc.parentElement;
      }
      if (contained) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const s = el.style;
      fixedComp.push({ el, prev: {
        top: s.top, left: s.left, right: s.right, bottom: s.bottom,
        width: s.width, height: s.height, margin: s.margin, boxSizing: s.boxSizing,
      } });
      el.setAttribute('data-fermata-held', '');   // the ledger must not record our pin
      s.top = (r.top + sy).toFixed(1) + 'px';
      s.left = (r.left + sx).toFixed(1) + 'px';
      s.right = 'auto';
      s.bottom = 'auto';
      s.boxSizing = 'border-box';
      s.width = r.width.toFixed(1) + 'px';
      s.height = r.height.toFixed(1) + 'px';
      s.margin = '0';
    }
  }
  function restoreFixed() {
    for (const f of fixedComp) {
      try { Object.assign(f.el.style, f.prev); f.el.removeAttribute('data-fermata-held'); } catch (_) {}
    }
    fixedComp = [];
  }

  // Top-layer elements (modal <dialog>, open popovers) render above any
  // ancestor transform and would float flat over the tilted slab. Give each
  // the same transform about the same world axis so they tilt with the page.
  function gatherCompanions() {
    if (!companions.length) {
      let els = [];
      try { els = [...document.querySelectorAll('dialog[open], [popover]')]; } catch (_) {}
      for (const el of els) {
        if (el.hasAttribute(UI_ATTR)) continue;
        let topLayer = false;
        try { topLayer = el.matches(':modal') || el.matches(':popover-open'); } catch (_) {}
        if (!topLayer) continue;
        const r = el.getBoundingClientRect();
        companions.push({
          el,
          prev: { transform: el.style.transform, origin: el.style.transformOrigin, will: el.style.willChange },
        });
        el.setAttribute('data-fermata-held', '');
        el.style.transformOrigin =
          `${(innerWidth / 2 - r.left).toFixed(1)}px ${(innerHeight * 0.45 - r.top).toFixed(1)}px`;
        el.style.willChange = 'transform';
      }
    }
    for (const c of companions) {
      if (REDUCE.matches) { c.el.style.transform = tiltTransform(orbitCur); continue; }
      try {
        const a = c.el.animate(
          [{ transform: c.prev.transform || 'none' }, { transform: tiltTransform(orbitCur) }],
          { duration: 700, easing: EASE.outQuint });
        a.id = `${NS}-companion`;
        a.onfinish = () => {
          if (tilted) c.el.style.transform = tiltTransform(orbitCur);
          try { a.cancel(); } catch (_) {}
        };
      } catch (_) {}
    }
  }
  function syncCompanions(o) {
    for (const c of companions) { try { c.el.style.transform = tiltTransform(o); } catch (_) {} }
  }
  function restoreCompanions() {
    for (const c of companions) {
      try {
        c.el.style.transform = c.prev.transform;
        c.el.style.transformOrigin = c.prev.origin;
        c.el.style.willChange = c.prev.will;
        c.el.removeAttribute('data-fermata-held');
      } catch (_) {}
    }
    companions = [];
  }

  // orbit as the cursor moves — a critically damped spring, so the slab has
  // mass and momentum instead of a leash. The room answers: rim lights and
  // the contact shadow under the slab move with the same spring.
  let orbitVel = { rx: 0, ry: 0 };
  let orbitPrevT = 0;
  function startOrbit() {
    if (orbitRaf || REDUCE.matches) return;
    orbitVel = { rx: 0, ry: 0 };
    orbitPrevT = 0;
    orbitRaf = requestAnimationFrame(orbitLoop);
  }
  function stopOrbit() {
    if (orbitRaf) cancelAnimationFrame(orbitRaf);
    orbitRaf = 0;
  }
  function orbitLoop(now) {
    orbitRaf = 0;
    if (!tilted || recording || !document.body) return;
    const dt = Math.min(0.05, orbitPrevT ? (now - orbitPrevT) / 1000 : 1 / 60);
    orbitPrevT = now;
    orbit.ry = ((mouse.x / innerWidth) - 0.5) * 7;
    orbit.rx = 13 - ((mouse.y / innerHeight) - 0.5) * 5;
    const K = 42, C = 13;            // c ≈ 2√k — settles without wobble
    let moving = false;
    for (const ax of ['rx', 'ry']) {
      orbitVel[ax] += (K * (orbit[ax] - orbitCur[ax]) - C * orbitVel[ax]) * dt;
      orbitCur[ax] += orbitVel[ax] * dt;
      if (Math.abs(orbit[ax] - orbitCur[ax]) > 0.002 || Math.abs(orbitVel[ax]) > 0.01)
        moving = true;
    }
    if (!moving) { orbitPrevT = 0; return; }   // settled: sleep until the mouse wakes us
    document.body.style.transform = tiltTransform(orbitCur);
    syncCompanions(orbitCur);
    syncStage(orbitCur);
    orbitRaf = requestAnimationFrame(orbitLoop);
  }
  function syncStage(o) {
    if (!ui.rimL) return;
    const k = o.ry / 3.5;
    ui.rimL.style.opacity = Math.max(0, -k * 0.9).toFixed(3);
    ui.rimR.style.opacity = Math.max(0, k * 0.9).toFixed(3);
    if (ui.ground)
      ui.ground.style.transform = `translateX(calc(-50% + ${(-o.ry * 7).toFixed(1)}px))`;
  }

  window.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    if (tilted && !orbitRaf && !tiltAnim) startOrbit();   // the settled slab wakes
    if (active) scheduleWhisper(e);
  }, true);

  // ------------------------------------------------------------- the whisper
  // The studies introduce themselves where they apply: rest the cursor on
  // something that moves and a quiet word appears beside it. No panel, no
  // tour — the page tells you what it can do, where it can do it.
  let whisperT = null, whisperHideT = null;
  function scheduleWhisper(e) {
    hideWhisper();
    clearTimeout(whisperT);
    // shadow retargeting makes any event from the overlay target the host
    // itself, so this stays O(1) on the mousemove hot path
    if (recording || e.target === host) return;
    whisperT = setTimeout(() => {
      if (!active || recording || drag || loopSel.playing || !host) return;
      send('probe', { x: mouse.x, y: mouse.y });
    }, 420);
  }
  function hideWhisper() {
    clearTimeout(whisperHideT);
    if (ui.whisper) ui.whisper.classList.remove('show');
  }
  function showWhisper(m) {
    if (!m.has || !ui.whisper || st.score || st.trail || st.echo) return;
    ui.whisper.textContent = 'E echo · S score · T trail';
    ui.whisper.style.left = Math.min(innerWidth - 180, mouse.x + 16) + 'px';
    ui.whisper.style.top = Math.min(innerHeight - 140, mouse.y + 22) + 'px';
    ui.whisper.classList.add('show');
    clearTimeout(whisperHideT);
    whisperHideT = setTimeout(hideWhisper, 2600);
  }

  // ---------------------------------------------------------------- freeze
  function setFrozen(f) {
    send('setFrozen', f);
    if (f) {
      tilt();
      send('scan');
      toast('frozen', 'drag left — the past replays under your hand');
    } else {
      stopLoop();
      loopSel.a = loopSel.b = null;
      send('echoOff');
      untilt(false);
    }
  }

  function setTempo(i) {
    const t = TEMPOS[Math.max(0, Math.min(TEMPOS.length - 1, i))];
    send('setRate', t.r);
    toast(t.word, t.plain);
  }
  function tempoIndex() {
    let best = 0, dist = Infinity;
    TEMPOS.forEach((t, i) => {
      const d = Math.abs(Math.log(t.r) - Math.log(st.rate));
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }

  function step(ms) {
    if (!st.frozen) setFrozen(true);
    stopLoop();
    send('nudge', ms);
    send('scan');
    pulsePlayhead();
  }
  function stepBack(ms) {
    if (!st.frozen) setFrozen(true);
    stopLoop();
    send('seekBy', -ms);
    send('scan');
    pulsePlayhead();
  }

  // stepping is a ratchet: the playhead clicks forward with a tiny overshoot
  // and the timecode bubble surfaces for a beat, right where the effect is
  let phTimer = null;
  function pulsePlayhead() {
    if (!ui.ph || REDUCE.matches) return;
    ui.ribbon.classList.add('live');
    clearTimeout(phTimer);
    phTimer = setTimeout(() => {
      if (!loopSel.playing && !drag && ui.ribbon) ui.ribbon.classList.remove('live');
    }, 450);
    try {
      ui.ph.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1.25)' }],
        { duration: 160, easing: EASE.out });
    } catch (_) {}
  }

  // ------------------------------------------------------------------ loop
  // Repeat one portion of the strip: [ marks in, ] marks out, L plays the
  // region on a cycle at the chosen tempo. Any manual scrub or step stops it.
  const rateNow = () => Math.max(0.02, st.rate || 1);

  function markLoop(which) {
    if (!st.frozen) setFrozen(true);
    if (!tl.endMs) { toast('nothing seekable', 'loop needs CSS or WAAPI motion'); return; }
    if (which === 'in') loopSel.a = tl.t; else loopSel.b = tl.t;
    if (loopSel.a != null && loopSel.b != null && loopSel.b < loopSel.a)
      [loopSel.a, loopSel.b] = [loopSel.b, loopSel.a];
    toast(which === 'in' ? 'loop in' : 'loop out', `marked at ${fmt(tl.t)} — L plays the region`);
    if (loopSel.playing) loopSel.t0 = performance.now();
    renderRibbon();
  }
  function toggleLoop() {
    if (loopSel.playing) { stopLoop(); toast('loop off', 'held where you stopped'); return; }
    if (!st.frozen) setFrozen(true);
    if (!tl.endMs) { toast('nothing seekable', 'loop needs CSS or WAAPI motion'); return; }
    if (loopSel.a == null) loopSel.a = 0;
    if (loopSel.b == null) loopSel.b = tl.endMs;
    if (loopSel.b - loopSel.a < 40) { loopSel.a = 0; loopSel.b = tl.endMs; }
    loopSel.playing = true;
    const inside = tl.t >= loopSel.a && tl.t <= loopSel.b ? tl.t - loopSel.a : 0;
    loopSel.t0 = performance.now() - inside / rateNow();
    if (ui.ribbon) ui.ribbon.classList.add('live');
    toast('loop', `${fmt(loopSel.a)} – ${fmt(loopSel.b)} at ${TEMPOS[tempoIndex()].word} — L stops`);
    loopSel.raf = requestAnimationFrame(loopTick);
  }
  function loopTick(now) {
    if (!loopSel.playing) return;
    const span = Math.max(40, loopSel.b - loopSel.a);
    send('scrubTo', loopSel.a + ((now - loopSel.t0) * rateNow()) % span);
    loopSel.raf = requestAnimationFrame(loopTick);
  }
  function stopLoop() {
    if (!loopSel.playing) return;
    loopSel.playing = false;
    cancelAnimationFrame(loopSel.raf);
    if (ui.ribbon) ui.ribbon.classList.remove('live');
  }
  function clearLoop() {
    stopLoop();
    if (loopSel.a == null && loopSel.b == null) return;
    loopSel.a = loopSel.b = null;
    toast('loop cleared', 'the whole strip again');
    renderRibbon();
  }

  // -------------------------------------------------------------- keyboard
  const editable = (el) => {
    if (!el) return false;
    const t = (el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
  };

  const KEYCHIP = {
    Space: ['space'], ArrowRight: ['←→'], ArrowLeft: ['←→', '←'],
    ArrowUp: ['↑↓'], ArrowDown: ['↑↓'], KeyE: ['E'], KeyR: ['R'],
    KeyL: ['L'], BracketLeft: ['L'], BracketRight: ['L'], Escape: ['esc'],
    KeyS: ['S'], KeyT: ['T'], KeyK: ['K'],
  };

  // ---- one letter each: score, trail, link
  function scoreToggle() {
    if (st.score) { send('scoreOff'); return; }
    if (!st.frozen) setFrozen(true);
    send('score', { x: mouse.x, y: mouse.y });
  }
  function trailToggle() {
    if (st.trail) { send('trailOff'); return; }
    if (!st.frozen) setFrozen(true);
    send('trail', { x: mouse.x, y: mouse.y });
  }
  function copyScore() {
    if (!lastScore) { toast('no score yet', 'S scores the element under your cursor'); return; }
    navigator.clipboard.writeText(lastScore).then(
      () => toast('copied', 'the motion, as code, on your clipboard'),
      () => toast('couldn’t copy', 'the clipboard was blocked here'));
  }
  function copyLink() {
    const p = { v: 1, y: Math.round(scrollY), r: st.rate, f: st.frozen };
    if (st.frozen) p.t = Math.round(tl.t);
    if (loopSel.a != null) p.a = Math.round(loopSel.a);
    if (loopSel.b != null) p.b = Math.round(loopSel.b);
    const url = location.origin + location.pathname + location.search +
      '#fermata=' + encodeURIComponent(btoa(JSON.stringify(p)));
    navigator.clipboard.writeText(url).then(
      () => toast('link', 'this held moment, on your clipboard'),
      () => toast('couldn’t copy', 'the clipboard was blocked here'));
  }

  window.addEventListener('keydown', (e) => {
    if (!active || recording) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); flashKey('Escape'); leave(); return; }
    if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const big = e.shiftKey;
    switch (e.code) {
      case 'Space':        setFrozen(!st.frozen); break;
      case 'ArrowRight':   step(big ? 100 : 16.67); break;
      case 'ArrowLeft':    stepBack(big ? 100 : 16.67); break;
      case 'ArrowDown':    setTempo(tempoIndex() - 1); break;
      case 'ArrowUp':      setTempo(tempoIndex() + 1); break;
      case 'BracketLeft':  markLoop('in'); break;
      case 'BracketRight': markLoop('out'); break;
      case 'KeyL':         big ? clearLoop() : toggleLoop(); break;
      case 'KeyE':
        if (st.echo) { send('echoOff'); }
        else send('echo', { x: mouse.x, y: mouse.y });
        break;
      case 'KeyS':         big ? copyScore() : scoreToggle(); break;
      case 'KeyT':         trailToggle(); break;
      case 'KeyK':         copyLink(); break;
      case 'KeyR':         record(big ? 24 : 0); break;
      default: return;
    }
    flashKey(e.code);
    if (firstRunT) firstRunDone();   // they found the keys on their own
    e.preventDefault(); e.stopPropagation();
  }, true);

  // pressing a key lights its cap in the capsule — the keyboard and the UI
  // are the same instrument
  function flashKey(code) {
    if (!host || !KEYCHIP[code]) return;
    let kbd = null;
    for (const label of KEYCHIP[code]) {
      kbd = ui.hints && ui.hints.querySelector(`kbd[data-k="${label}"]`);
      if (kbd) break;
    }
    if (!kbd) return;
    kbd.classList.remove('hit');
    void kbd.offsetWidth;            // restart the flash on rapid presses
    kbd.classList.add('hit');
    setTimeout(() => kbd.classList.remove('hit'), 180);
  }

  // ---------------------------------------------------- drag through time
  // While frozen, the page is a film: pull it horizontally to scrub.
  let drag = null;
  window.addEventListener('pointerdown', (e) => {
    if (!active || !st.frozen || recording || !tl.endMs) return;
    if (host && e.composedPath().includes(host)) return;
    stopLoop();
    drag = { x0: e.clientX, f0: tl.endMs ? tl.t / tl.endMs : 0, moved: false };
    if (ui.ribbon) ui.ribbon.classList.add('live');
    e.preventDefault(); e.stopPropagation();
  }, true);
  // the window's edges are moments, not just extremes — scrubs settle onto
  // the start and especially onto "now" instead of stranding a pixel short
  const detent = (f) => {
    f = Math.max(0, Math.min(1, f));
    return f > 0.985 ? 1 : f < 0.015 ? 0 : f;
  };

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.moved = true;
    send('scrub', detent(drag.f0 + (e.clientX - drag.x0) / (innerWidth * 0.7)));
    e.preventDefault(); e.stopPropagation();
  }, true);
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (drag.moved) { e.preventDefault(); e.stopPropagation(); }
    drag = null;
    if (ui.ribbon && !loopSel.playing) ui.ribbon.classList.remove('live');
  }, true);
  window.addEventListener('click', (e) => {
    // swallow the click that ends a scrub-drag so frozen pages don't navigate
    if (active && st.frozen && !recording && tl.endMs &&
        host && !e.composedPath().includes(host)) {
      e.preventDefault(); e.stopPropagation();
    }
  }, true);

  // --------------------------------------------------------------- overlay
  function build() {
    host = document.createElement('div');
    host.setAttribute(UI_ATTR, '');
    host.tabIndex = -1;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;outline:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  :host { all: initial;
    --amber: #ffb000; --amber-hi: #ffc94d;
    /* the whole overlay moves on four durations and three curves — nothing else */
    --d1: 120ms; --d2: 200ms; --d3: 320ms; --d4: 700ms;
    --eo: ${EASE.out}; --eo5: ${EASE.outQuint}; --eio: ${EASE.inOut};
    --noise: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>"); }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .vignette { position: fixed; inset: 0; pointer-events: none; opacity: 0;
    border: 1px solid rgba(255,176,0,.26);
    box-shadow: inset 0 0 120px rgba(255,176,0,.05), inset 0 0 30px rgba(0,0,0,.16);
    transition: opacity var(--d3) var(--eo), box-shadow var(--d4) var(--eio), border-color var(--d4) var(--eio); }
  .vignette.in { opacity: 1; }
  .vignette.held { border-color: rgba(255,176,0,.42);
    box-shadow: inset 0 0 160px rgba(255,176,0,.09), inset 0 0 42px rgba(0,0,0,.22); }

  /* the room: floor glow, an overhead beam, side rims that answer the orbit,
     grain so the dark gradients never band, and a contact shadow that
     grounds the slab on the floor */
  .stage { position: fixed; inset: 0; pointer-events: none; opacity: 0;
    transition: opacity var(--d4) var(--eo); }
  .stage.in { opacity: 1; }
  .noise { position: absolute; inset: 0; opacity: .045;
    background-image: var(--noise); background-size: 160px 160px; }
  .ground { position: absolute; left: 50%; bottom: 3vh; width: 74vw; height: 10vh;
    transform: translateX(-50%); will-change: transform;
    background: radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.6), transparent 70%);
    filter: blur(16px); }
  .beam { position: absolute; left: 50%; top: 0; width: 130vw; height: 38vh;
    transform: translateX(-50%);
    background: radial-gradient(55% 100% at 50% 0%, rgba(255,196,77,.07), transparent 75%); }
  .floor { position: absolute; left: -5vw; right: -5vw; bottom: 0; height: 24vh;
    background: linear-gradient(to top, rgba(255,176,0,.09), rgba(255,176,0,.025) 50%, transparent); }
  .rim { position: absolute; top: 8vh; bottom: 8vh; width: 12vw; opacity: 0;
    transition: opacity var(--d2) linear; }
  .rim.l { left: 0; background: linear-gradient(to right, rgba(255,196,77,.12), transparent); }
  .rim.r { right: 0; background: linear-gradient(to left, rgba(255,196,77,.12), transparent); }

  /* the portal: not a dark blob — an elliptical lens that shows the page
     behind it in Fermata's own golden hour, ringed by a hairline with two
     glints of light orbiting it. Alive, and never black. */
  .toast { position: fixed; left: 50%; top: 36%; transform: translate(-50%,-50%) scale(.94);
    text-align: center; pointer-events: none; opacity: 0; padding: 46px 88px; filter: blur(6px);
    visibility: hidden;
    transition: opacity var(--d2) ease, transform var(--d2) ease, filter var(--d2) ease, visibility var(--d2); }
  .toast.show { opacity: 1; transform: translate(-50%,-50%) scale(1); filter: blur(0);
    visibility: visible;
    transition: opacity var(--d3) var(--eo5), transform var(--d3) var(--eo5), filter var(--d3) var(--eo5), visibility 0s; }
  /* ——— tempoglass: a material where light obeys the held clock ———
     A slab of glass cut from slowed time. The page shows through it in
     golden-hour tint. Light that enters travels slower than light outside:
     the specular streak crossing it decelerates mid-pane as the thickened
     time grips it, then snaps out the far side — and the glass briefly
     remembers it as an afterglow. Veins of suspended light drift inside at
     largo; the rim disperses a slow circuit of split light. */
  /* ——— pooled time ———
     Not glass. A region of the page where stopped time has collected, like
     the heat-haze above a candle, frozen. It has no surface — only optical
     density. The box is far larger than the visible pool so every feather
     completes long before any boundary exists; blur falls progressively
     22 → 8 → 2.5 → 0 through gradient-masked layers. Two textures only:
     the progressive frost, and the sweep of light that decelerates as it
     crosses the thickened middle. Everything else stays out of its way. */
  /* NOTE: the slab itself must stay unmasked — a masked ancestor becomes a
     backdrop root and its backdrop-filter children go blind to the page.
     Each frost feathers itself; everything painted lives in .pool, which
     carries the shared feather. */
  .slab { position: absolute; inset: -90px -130px; pointer-events: none; }
  .pool { position: absolute; inset: 0;
    -webkit-mask: radial-gradient(60% 62% at 50% 54%, #000 34%, rgba(0,0,0,.5) 54%, transparent 76%);
    mask: radial-gradient(60% 62% at 50% 54%, #000 34%, rgba(0,0,0,.5) 54%, transparent 76%); }
  .scrim { position: absolute; inset: 0;
    background: radial-gradient(46% 44% at 50% 50%, rgba(24,15,3,.5),
      rgba(24,15,3,.16) 48%, transparent 68%); }
  .frost { position: absolute; inset: 0; }
  .frost.f1 { backdrop-filter: blur(22px) saturate(1.35) brightness(.86) sepia(.3) hue-rotate(-8deg);
    -webkit-mask: radial-gradient(60% 62% at 50% 54%, #000 26%, transparent 48%);
    mask: radial-gradient(60% 62% at 50% 54%, #000 26%, transparent 48%); }
  .frost.f2 { backdrop-filter: blur(8px) saturate(1.18) brightness(.94) sepia(.18) hue-rotate(-6deg);
    -webkit-mask: radial-gradient(60% 62% at 50% 54%, #000 40%, transparent 62%);
    mask: radial-gradient(60% 62% at 50% 54%, #000 40%, transparent 62%); }
  .frost.f3 { backdrop-filter: blur(2.5px) saturate(1.08) sepia(.08) hue-rotate(-4deg);
    -webkit-mask: radial-gradient(60% 62% at 50% 54%, #000 54%, transparent 78%);
    mask: radial-gradient(60% 62% at 50% 54%, #000 54%, transparent 78%); }
  .tintwash { position: absolute; inset: 0;
    background:
      radial-gradient(46% 40% at 50% 70%, rgba(150,95,15,.07), transparent 80%),
      radial-gradient(52% 50% at 50% 52%, rgba(255,210,120,.12), rgba(255,176,0,.04) 60%, transparent 80%); }
  .sweep { position: absolute; top: -30%; bottom: -30%; width: 34%; left: 0; opacity: 0;
    background: linear-gradient(100deg, transparent, rgba(255,243,214,.34) 45%,
      rgba(255,224,150,.18) 60%, transparent);
    filter: blur(6px); will-change: transform, opacity; }
  /* fast in — crawl through the middle where time is thickest — fast out */
  .toast.show .sweep { animation: slowlight 1.1s cubic-bezier(.16,.88,.84,.12) both; }
  .toast.show:not(.rich) .sweep { animation: slowlight-lite .7s cubic-bezier(.16,.88,.84,.12) both; }
  @keyframes slowlight {
    0% { transform: translateX(-180%) skewX(-8deg); opacity: 0; }
    10% { opacity: .95; }
    90% { opacity: .95; }
    100% { transform: translateX(440%) skewX(-8deg); opacity: 0; } }
  @keyframes slowlight-lite {
    0% { transform: translateX(-180%) skewX(-8deg); opacity: 0; }
    12% { opacity: .45; }
    88% { opacity: .45; }
    100% { transform: translateX(440%) skewX(-8deg); opacity: 0; } }
  .toast .word { position: relative; font: italic 400 54px/1.1 ${SERIF}; color: var(--amber-hi);
    letter-spacing: .01em;
    /* prismatic fringes: type seen through dense time splits faintly */
    text-shadow: -1px 0 0 rgba(255,120,30,.25), 1px 0 0 rgba(255,244,200,.3),
      0 1px 2px rgba(64,38,0,.5), 0 0 34px rgba(255,176,0,.5); }
  .toast .plain { position: relative; margin-top: 10px; font: 400 14px/1.4 ${SANS};
    color: rgba(255,243,218,.95); letter-spacing: .04em;
    text-shadow: 0 1px 2px rgba(64,38,0,.65), 0 0 12px rgba(64,38,0,.3); }

  .ribbon { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%) translateY(8px);
    width: min(620px, 72vw); height: 36px; pointer-events: auto; cursor: ew-resize;
    opacity: 0; transition: opacity var(--d3) var(--eo), transform var(--d3) var(--eo); }
  /* the freeze is one downbeat: tilt lands first, the ribbon answers a
     beat later (delay applies entering only — leaving is immediate) */
  .ribbon.in { opacity: 1; transform: translateX(-50%) translateY(0); transition-delay: 160ms; }
  /* the seismograph: the window's activity drawn as terrain — peaks are
     moments, flat ground is idle time. You can see where to scrub. */
  .ribbon .wave { position: absolute; inset: 0; width: 100%; height: 100%; }
  .ribbon .rail { position: absolute; left: 0; right: 0; top: 19px; height: 2px; border-radius: 1px;
    background: linear-gradient(90deg, rgba(255,176,0,.14), rgba(255,176,0,.38), rgba(255,176,0,.14)); }
  .ribbon .band { position: absolute; top: -3px; height: 8px; border-radius: 4px; display: none;
    background: rgba(255,176,0,.15); box-shadow: inset 0 0 0 1px rgba(255,176,0,.22); }
  .ribbon .fill { position: absolute; left: 0; top: 0; height: 2px; width: 0; border-radius: 1px;
    background: linear-gradient(90deg, rgba(255,201,77,.45), rgba(255,201,77,.9));
    box-shadow: 0 0 8px rgba(255,176,0,.35); }
  .ribbon .tick { position: absolute; top: 14px; width: 1px; height: 12px;
    background: rgba(255,176,0,.45); }
  .ribbon .tick.t0 { left: 0; } .ribbon .tick.t1 { right: 0; }
  .ribbon .mark { position: absolute; top: 11px; width: 6px; height: 18px; display: none;
    border-top: 1.5px solid var(--amber-hi); border-bottom: 1.5px solid var(--amber-hi); }
  .ribbon .mark.show { display: block; }
  .ribbon .mark.a { border-left: 1.5px solid var(--amber-hi); margin-left: -1px; }
  .ribbon .mark.b { border-right: 1.5px solid var(--amber-hi); margin-left: -5px; }
  .ribbon .ph { position: absolute; top: 14px; width: 12px; height: 12px; margin-left: -6px;
    border-radius: 50%; background: var(--amber-hi); box-shadow: 0 0 12px rgba(255,176,0,.8);
    transition: left 80ms linear, transform var(--d1) var(--eo); }
  .ribbon.live .ph { transition: transform var(--d1) var(--eo); }
  .ribbon:hover .ph, .ribbon.live .ph { transform: scale(1.25); }
  .bubble { position: absolute; top: -16px; transform: translateX(-50%); padding: 3px 9px;
    font: 400 11px/1 ${SANS}; color: #ffe2b0; background: rgba(17,13,7,.92);
    border: 1px solid rgba(255,176,0,.3); border-radius: 999px; opacity: 0; white-space: nowrap;
    font-variant-numeric: tabular-nums; transition: opacity var(--d1) ease; }
  .ribbon:hover .bubble, .ribbon.live .bubble { opacity: 1; }
  .cap { position: absolute; top: 27px; font: 400 10px ${SANS};
    color: rgba(255,222,150,.55); font-variant-numeric: tabular-nums; }
  .cap.c0 { left: 0; } .cap.c1 { right: 0; }
  .ribbon .empty { position: absolute; inset: 0; display: none; align-items: center;
    justify-content: center; font: 400 11px ${SANS}; color: rgba(242,232,213,.5);
    letter-spacing: .03em; }
  .ribbon.bare { cursor: default; pointer-events: none; }
  .ribbon.bare .empty { display: flex; }
  .ribbon.bare .rail, .ribbon.bare .fill, .ribbon.bare .ph, .ribbon.bare .tick,
  .ribbon.bare .cap, .ribbon.bare .mark, .ribbon.bare .band, .ribbon.bare .bubble,
  .ribbon.bare .wave { display: none; }

  .capsule { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 14px; pointer-events: auto; cursor: default;
    max-width: calc(100vw - 24px);
    background: rgba(17,13,7,.82); backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid rgba(255,176,0,.3); border-radius: 999px;
    padding: 10px 22px 11px 18px;
    box-shadow: 0 16px 50px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,210,110,.12);
    font: 400 13px/1.3 ${SANS}; color: #f2e8d5; white-space: nowrap;
    animation: rise var(--d3) var(--eo5) backwards;
    transition: opacity var(--d2) ease, transform var(--d2) ease, filter var(--d2) ease; }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 18px) scale(.97); filter: blur(6px); } }
  .capsule.out { opacity: 0; transform: translate(-50%, 12px) scale(.98); filter: blur(4px); }
  @media (max-width: 760px) { .tempo .plain { display: none; } }
  .glyph { color: var(--amber); display: flex; flex: none;
    filter: drop-shadow(0 0 6px rgba(255,176,0,.5));
    transition: filter var(--d3) ease, color var(--d3) ease; }
  .glyph.held { color: #ffd45e; animation: breathe 2.6s var(--eio) infinite; }
  @keyframes breathe {
    0%, 100% { filter: drop-shadow(0 0 12px rgba(255,200,60,.85)); }
    50% { filter: drop-shadow(0 0 5px rgba(255,200,60,.4)); } }
  .tempo { display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
  .tempo .word { font: italic 400 18px/1 ${SERIF}; color: var(--amber-hi); }
  .tempo .plain { font: 400 11px ${SANS}; color: rgba(242,232,213,.55); }
  .time { font: 400 13px ${SANS}; color: rgba(255,222,150,.9);
    font-variant-numeric: tabular-nums; min-width: 56px; }
  .sep { width: 1px; height: 20px; background: rgba(255,176,0,.22); }
  .hints { display: flex; gap: 12px; align-items: center; }
  .hint { display: flex; gap: 5px; align-items: center; background: none; border: none;
    font: 400 11px ${SANS}; color: rgba(242,232,213,.62); cursor: pointer; padding: 0;
    transition: color var(--d1) ease, transform var(--d1) var(--eo);
    animation: hintin var(--d2) var(--eo) backwards; }
  @keyframes hintin { from { opacity: 0; transform: translateY(4px); } }
  .hint:hover { color: var(--amber-hi); }
  .hint:active { transform: scale(.96); }
  .hint { position: relative; }
  .hint::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 14px);
    left: 50%; transform: translateX(-50%) translateY(3px); white-space: nowrap;
    padding: 6px 11px; background: rgba(17,13,7,.95); border: 1px solid rgba(255,176,0,.35);
    border-radius: 8px; font: 400 10px/1.3 ${SANS}; color: #ffe2b0; opacity: 0;
    pointer-events: none; box-shadow: 0 8px 26px rgba(0,0,0,.45);
    transition: opacity var(--d1) ease .3s, transform var(--d2) var(--eo) .3s; }
  .hint:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }
  .hint kbd { font: 500 10px/1 ${SANS}; color: rgba(255,222,150,.9);
    border: 1px solid rgba(255,176,0,.32); border-bottom-width: 2px; border-radius: 4px;
    padding: 3px 5px; background: rgba(255,176,0,.07);
    transition: color var(--d1) ease, border-color var(--d1) ease, background var(--d1) ease,
      transform var(--d1) var(--eo), box-shadow var(--d1) ease; }
  .hint:hover kbd { border-color: rgba(255,176,0,.6); }
  .hint kbd.hit { transform: translateY(1px) scale(.92); background: rgba(255,176,0,.28);
    color: #fff3da; border-color: rgba(255,201,77,.8); box-shadow: 0 0 12px rgba(255,176,0,.45); }

  .rec { position: fixed; right: 28px; top: 24px; display: none; align-items: center; gap: 10px;
    background: rgba(17,13,7,.85); border: 1px solid rgba(255,176,0,.35); border-radius: 999px;
    padding: 8px 16px; font: 400 13px ${SANS}; color: #ffe2b0; pointer-events: none; }
  .rec.in { display: flex; animation: recin var(--d2) var(--eo5); }
  @keyframes recin { from { opacity: 0; transform: translateY(-8px); } }
  .rec .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--amber);
    box-shadow: 0 0 10px rgba(255,176,0,.9); animation: pulse 1s ease infinite; }
  @keyframes pulse { 50% { opacity: .25; } }

  /* a quiet word beside the cursor when it rests on something that moves —
     the studies (echo, score, trail) introduce themselves where they apply */
  .whisper { position: fixed; pointer-events: none; opacity: 0; transform: translateY(3px);
    padding: 5px 11px; background: rgba(17,13,7,.88); border: 1px solid rgba(255,176,0,.28);
    border-radius: 999px; font: 400 10px/1 ${SANS}; color: rgba(255,226,176,.85);
    white-space: nowrap; letter-spacing: .03em;
    transition: opacity var(--d2) ease, transform var(--d2) var(--eo); }
  .whisper.show { opacity: 1; transform: translateY(0); }

  /* the stage clears completely for capture */
  :host(.shooting) .vignette, :host(.shooting) .capsule, :host(.shooting) .ribbon,
  :host(.shooting) .toast, :host(.shooting) .stage, :host(.shooting) .whisper
    { display: none !important; }

  @media (prefers-reduced-motion: reduce) {
    .capsule, .hint, .rec.in, .glyph.held, .toast.show .sweep { animation: none; }
    .vignette, .stage, .rim, .toast, .ribbon, .ribbon .ph, .bubble,
    .capsule, .glyph, .hint, .hint kbd, .whisper { transition: none; }
  }
</style>
<div class="vignette" id="vig"></div>
<div class="stage" id="stage"><div class="noise"></div><div class="beam"></div>
  <div class="ground" id="ground"></div><div class="floor"></div>
  <div class="rim l" id="rimL"></div><div class="rim r" id="rimR"></div></div>
<div class="toast" id="toast">
  <div class="slab">
    <div class="frost f1"></div>
    <div class="frost f2"></div>
    <div class="frost f3"></div>
    <div class="pool">
      <div class="scrim"></div>
      <div class="tintwash"></div>
      <div class="sweep"></div>
    </div>
  </div>
  <div class="word" id="tword"></div><div class="plain" id="tplain"></div>
</div>
<div class="ribbon" id="ribbon">
  <span class="empty">nothing has moved yet — → still steps the clock</span>
  <canvas class="wave" id="wave"></canvas>
  <div class="rail"><div class="band" id="band"></div><div class="fill" id="rfill"></div></div>
  <div class="tick t0"></div><div class="tick t1"></div>
  <div class="mark a" id="ma"></div><div class="mark b" id="mb"></div>
  <div class="ph" id="ph"></div>
  <div class="bubble" id="bubble">0:00.0</div>
  <span class="cap c0">0:00</span><span class="cap c1" id="rdur">0:00</span>
</div>
<div class="capsule" id="capsule">
  <span class="glyph" id="glyph">
    <svg width="22" height="14" viewBox="0 0 24 15" fill="none">
      <path d="M2.5 13.5 A 9.5 9.5 0 0 1 21.5 13.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="12" cy="11.6" r="2" fill="currentColor"/></svg>
  </span>
  <span class="tempo" id="tempo" title="Change speed (↑ ↓)">
    <span class="word" id="word">a tempo</span><span class="plain" id="plain">full speed</span>
  </span>
  <span class="time" id="time">0:00.0</span>
  <span class="sep"></span>
  <span class="hints" id="hints"></span>
</div>
<div class="rec" id="recpill"><span class="dot"></span><span id="rectext">recording</span></div>
<div class="whisper" id="whisper"></div>`;

    ui = {};
    for (const id of ['vig','stage','ground','rimL','rimR','toast','tword','tplain','ribbon','band',
                      'rfill','ma','mb','ph','bubble','rdur','capsule','glyph','wave',
                      'tempo','word','plain','time','hints','recpill','rectext','whisper'])
      ui[id] = root.getElementById(id);

    requestAnimationFrame(() => ui.vig && ui.vig.classList.add('in'));
    ui.tempo.addEventListener('click', () => setTempo(tempoIndex() - 1));
    renderHints();

    // ribbon is also draggable directly — absolute positioning, no surprises
    let rdrag = false;
    const rfrac = (e) => {
      const r = ui.ribbon.getBoundingClientRect();
      return detent((e.clientX - r.left) / r.width);
    };
    ui.ribbon.addEventListener('pointerdown', (e) => {
      stopLoop();
      rdrag = true; ui.ribbon.setPointerCapture(e.pointerId);
      ui.ribbon.classList.add('live');
      send('scrub', rfrac(e));
      e.stopPropagation();
    });
    ui.ribbon.addEventListener('pointermove', (e) => { if (rdrag) send('scrub', rfrac(e)); });
    ui.ribbon.addEventListener('pointerup', () => {
      rdrag = false;
      if (!loopSel.playing) ui.ribbon.classList.remove('live');
    });

    document.documentElement.appendChild(host);
  }

  // every hint explains itself on hover — plain words, no jargon
  const HINT_TIPS = {
    freeze: 'stop the clock — everything the page did since you entered becomes scrubbable',
    release: 'let time run again',
    speed: 'walk the musical tempo presets, grave to presto',
    step: '→ advances one frame · ← rewinds through what happened',
    rewind: 'everything the page did since you entered is held — drag left into the past',
    loop: 'replay a region on a cycle · [ and ] mark its edges',
    echo: 'fan a moving element into past and future ghosts',
    score: 'transcribe an element’s motion as sheet music · shift S copies the code',
    trail: 'draw its path with beads spaced by time — bunched is slow, spread is fast',
    record: 'stop-motion capture into a storyboard, frame-perfect',
    link: 'copy a link to this held moment for a teammate',
    leave: 'restore the page exactly as it was',
    more: 'the studies — echo, score, trail, and the link',
    less: 'tuck the studies away',
  };

  // The capsule shows the few moves you always need; the studies (echo,
  // score, trail, link) stay one ··· away — and introduce themselves beside
  // the cursor whenever it rests on something that moves. Keys always work,
  // shown or not.
  let moreHints = false;
  function renderHints() {
    const items = st.frozen
      ? [['space', 'release'], ['←→', 'step'], ['L', 'loop'], ['R', 'record']]
      : [['space', 'freeze'], ['↑↓', 'speed'], ['R', 'record']];
    if (moreHints)
      items.push(['E', 'echo'], ['S', 'score'], ['T', 'trail'], ['K', 'link']);
    items.push(['···', moreHints ? 'less' : 'more'], ['esc', 'leave']);
    ui.hints.innerHTML = '';
    items.forEach(([k, label], i) => {
      const b = document.createElement('button');
      b.className = 'hint';
      b.style.animationDelay = `${i * 25}ms`;
      b.setAttribute('data-tip', HINT_TIPS[label] || label);
      b.innerHTML = label === 'more' || label === 'less'
        ? `<kbd data-k="${k}">${k}</kbd>`
        : `<kbd data-k="${k}">${k}</kbd>${label}`;
      b.addEventListener('click', () => {
        if (label === 'freeze' || label === 'release') setFrozen(!st.frozen);
        else if (label === 'step') step(16.67);
        else if (label === 'speed') setTempo(tempoIndex() - 1);
        else if (label === 'loop') toggleLoop();
        else if (label === 'echo') st.echo ? send('echoOff') : send('echo', { x: mouse.x, y: mouse.y });
        else if (label === 'score') scoreToggle();
        else if (label === 'trail') trailToggle();
        else if (label === 'link') copyLink();
        else if (label === 'record') record(0);
        else if (label === 'leave') leave();
        else if (label === 'more' || label === 'less') { moreHints = !moreHints; renderHints(); }
      });
      ui.hints.appendChild(b);
    });
    // fade-through, never a blink: the row arrives as one soft beat while
    // the items stagger in underneath it
    if (!REDUCE.matches) {
      try {
        ui.hints.animate(
          [{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0)' }],
          { duration: 160, easing: EASE.out });
      } catch (_) {}
    }
  }

  // Plain toasts are for actions you repeat (tempo, marks, freezes) — quiet
  // glass, no spectacle. `rich` opens the full portal, reserved for arrival.
  function toast(word, plain, rich) {
    if (!host) return;
    ui.toast.classList.toggle('rich', !!rich);
    ui.tword.textContent = word;
    ui.tplain.textContent = plain;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast && ui.toast.classList.remove('show'),
      rich ? 2400 : 1900);
  }

  const fmt = (ms) => {
    const s = Math.max(0, ms) / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  };

  // the tempo word rolls over on change — up when time speeds, down when it slows
  function rollText(el, txt, dy) {
    el.textContent = txt;
    if (REDUCE.matches) return;
    try {
      el.animate(
        [{ opacity: 0, transform: `translateY(${dy}px)`, filter: 'blur(3px)' },
         { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }],
        { duration: 240, easing: EASE.outQuint });
    } catch (_) {}
  }

  let wasFrozen = false, prevRate = 1;
  function render() {
    if (!host) return;
    // tilt always follows the engine's clock — freezes born in the engine
    // (catch, echo/score/trail on a running page) tilt just the same
    if (!recording) {
      if (st.frozen && !tilted) tilt();
      else if (!st.frozen && tilted) untilt(false);
    }
    const t = TEMPOS[tempoIndex()];
    const exact = Math.abs(t.r - st.rate) < 0.004;
    const word = st.frozen ? 'frozen' : (exact ? t.word : st.rate.toFixed(2) + '×');
    if (ui.word.textContent !== word) {
      rollText(ui.word, word, st.frozen ? 6 : (st.rate >= prevRate ? 8 : -8));
      prevRate = st.rate;
    }
    ui.plain.textContent = st.frozen ? 'time is yours' : t.plain;
    ui.time.textContent = fmt(st.vnow);
    ui.glyph.classList.toggle('held', st.frozen);
    ui.vig.classList.toggle('held', st.frozen);
    if (st.frozen !== wasFrozen) { wasFrozen = st.frozen; renderHints(); renderRibbon(); }
    badge();
  }

  // the seismograph: ask the engine for the window's activity terrain
  // whenever the window itself has changed shape
  let profEnd = -1;
  function drawWave(peaks) {
    if (!ui.wave || !peaks || !peaks.length) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = ui.ribbon.clientWidth || 1, h = 36;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    // writing width/height clears the canvas and forces a relayout — only
    // touch it when the ribbon actually resized
    if (ui.wave.width !== cw) ui.wave.width = cw;
    if (ui.wave.height !== ch) ui.wave.height = ch;
    const g = ui.wave.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const base = 19, A = 13, last = peaks.length - 1 || 1;
    const pts = peaks.map((v, i) => [i / last * w, base - v * A]);
    g.beginPath();
    g.moveTo(0, base);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(w, base);
    g.closePath();
    g.fillStyle = 'rgba(255,176,0,.13)';
    g.fill();
    g.beginPath();
    pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.strokeStyle = 'rgba(255,201,77,.38)';
    g.lineWidth = 1;
    g.stroke();
  }

  function renderRibbon() {
    if (!host) return;
    const show = active && st.frozen && !recording;
    ui.ribbon.classList.toggle('in', show);
    const has = tl.endMs > 0;
    ui.ribbon.classList.toggle('bare', !has);
    if (!show || !has) { profEnd = -1; return; }
    if (Math.abs(tl.endMs - profEnd) > 300) { profEnd = tl.endMs; send('profile', 72); }
    const f = Math.max(0, Math.min(1, tl.t / tl.endMs));
    ui.ph.style.left = (f * 100) + '%';
    ui.rfill.style.width = (f * 100) + '%';
    ui.bubble.style.left = (f * 100) + '%';
    ui.bubble.textContent = fmt(tl.t);
    ui.rdur.textContent = fmt(tl.endMs);
    const hasA = loopSel.a != null, hasB = loopSel.b != null;
    ui.ma.classList.toggle('show', hasA);
    ui.mb.classList.toggle('show', hasB);
    if (hasA) ui.ma.style.left = (loopSel.a / tl.endMs * 100) + '%';
    if (hasB) ui.mb.style.left = (loopSel.b / tl.endMs * 100) + '%';
    const both = hasA && hasB;
    ui.band.style.display = both ? 'block' : 'none';
    if (both) {
      ui.band.style.left = (loopSel.a / tl.endMs * 100) + '%';
      ui.band.style.width = ((loopSel.b - loopSel.a) / tl.endMs * 100) + '%';
    }
  }

  // --------------------------------------------------- stop-motion recorder
  // Hold the virtual clock, advance it in fixed steps, capture each settled
  // frame — frame-perfect regardless of captureVisibleTab's ~2/sec quota.
  // When a loop region is marked, the frames cover exactly that region.
  const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40))));

  async function capture(attempt = 0) {
    const res = await chrome.runtime.sendMessage({ type: 'fermata-capture' });
    if (res && res.ok) return res.url;
    if (attempt < 6) {              // quota backoff (~2 captures/sec allowed)
      await new Promise(r => setTimeout(r, 650));
      return capture(attempt + 1);
    }
    throw new Error((res && res.err) || 'capture failed');
  }

  async function record(forceN) {
    if (recording || !active) return;
    recording = true;
    stopLoop();
    const wasFrozenBefore = st.frozen;
    const hasLoop = loopSel.a != null && loopSel.b != null && (loopSel.b - loopSel.a) > 50;
    const useTimeline = tl.endMs > 0;
    const t0 = hasLoop ? loopSel.a : 0;
    const span = hasLoop ? (loopSel.b - loopSel.a) : (useTimeline ? tl.endMs : 800);
    // frame count follows the material: one frame per ~80 virtual ms, kept
    // between 8 and 24 — each capture costs ~0.65 s of real time under
    // Chrome's screenshot quota, so denser would mean waiting, not detail
    const N = forceN || Math.max(8, Math.min(24, Math.round(span / 80)));

    // a flat, clean stage: no tilt, no echoes, no overlay in frame
    send('echoOff');
    send('setFrozen', true);
    untilt(true);
    host.classList.add('shooting');
    ui.recpill.classList.add('in');
    await settle();

    const frames = [];
    let failMsg = null;
    try {
      for (let i = 0; i < N; i++) {
        if (useTimeline) send('scrubTo', t0 + span * (i / (N - 1)));
        else if (i > 0) send('nudge', span / (N - 1));
        ui.recpill.style.display = 'none';
        await settle();
        const url = await capture();
        frames.push({ url, t: t0 + i * (span / (N - 1)) });
        ui.recpill.style.display = '';
        ui.rectext.textContent = `frame ${i + 1} of ${N}`;
        await new Promise(r => setTimeout(r, 620)); // respect capture quota
      }
      // keep the previous take — the storyboard can ghost it over this one
      try {
        const prev = await chrome.storage.local.get('fermataFrames');
        if (prev && prev.fermataFrames) await chrome.storage.local.set({ fermataPrev: prev.fermataFrames });
      } catch (_) {}
      await chrome.storage.local.set({
        fermataFrames: {
          frames,
          meta: {
            title: document.title, url: location.href,
            mode: hasLoop ? 'loop' : useTimeline ? 'timeline' : 'clock',
            spanMs: span, rate: st.rate, captured: Date.now()
          }
        }
      });
      chrome.runtime.sendMessage({ type: 'fermata-storyboard' });
    } catch (e) {
      failMsg = e.message;
    } finally {
      ui.recpill.classList.remove('in');
      ui.recpill.style.display = '';
      host.classList.remove('shooting');
      recording = false;
      if (wasFrozenBefore) tilt();
      else send('setFrozen', false);
    }
    if (failMsg) toast('recording failed', failMsg);
  }

  // ------------------------------------------------------ held-moment links
  // K copied a link; arriving on one re-enters the same held moment: scroll,
  // tempo, freeze, strip position, loop marks. Approximate by design — the
  // page loads fresh — and exact for seekable motion, which is what loops.
  (function restoreLink() {
    const m = location.hash.match(/[#&]fermata=([A-Za-z0-9+/=%]+)/);
    if (!m) return;
    let p = null;
    try { p = JSON.parse(atob(decodeURIComponent(m[1]))); } catch (_) { return; }
    if (!p || p.v !== 1) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    setTimeout(() => {
      if (p.y) scrollTo(0, p.y);
      enter();
      if (p.r && Math.abs(p.r - 1) > 0.001) send('setRate', p.r);
      if (p.f) {
        setFrozen(true);
        setTimeout(() => {
          if (p.t != null) send('scrubTo', p.t);
          if (p.a != null) loopSel.a = p.a;
          if (p.b != null) loopSel.b = p.b;
          renderRibbon();
          toast('held moment', 'restored from the link — space releases');
        }, 900);
      }
    }, 400);
  })();
})();
