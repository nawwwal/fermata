// Fermata — experience layer (ISOLATED world).
// Talks to the MAIN-world engine over postMessage, to the service worker for
// screenshots. The interface is the page itself: freeze time and the live DOM
// tilts back into perspective — a slab of frozen glass you can orbit, step,
// drag through time, and clone into depth-fanned echoes. One quiet capsule of
// words at the bottom; every move has a single key.

(() => {
  'use strict';
  if (window.__fermataHud) return;
  window.__fermataHud = true;

  const NS = 'fermata';
  const UI_ATTR = 'data-fermata-ui';
  const SERIF = `ui-serif, "Iowan Old Style", Palatino, "Book Antiqua", Georgia, serif`;
  const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;

  const TEMPOS = [
    { r: 0.05, word: 'grave',   plain: 'one-twentieth speed' },
    { r: 0.1,  word: 'largo',   plain: 'one-tenth speed' },
    { r: 0.25, word: 'adagio',  plain: 'quarter speed' },
    { r: 0.5,  word: 'andante', plain: 'half speed' },
    { r: 1,    word: 'a tempo', plain: 'full speed' },
    { r: 2,    word: 'presto',  plain: 'double speed' },
  ];

  let active = false;
  let host = null, ui = {};
  let st = { rate: 1, frozen: false, vnow: 0, echo: false };
  let tl = { count: 0, endMs: 0, t: 0 };
  let recording = false;
  let lastBadge = null;
  let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  let toastTimer = null;

  // body styling we own while tilted — saved so release restores the site
  let saved = null;
  let tilted = false;
  let orbit = { rx: 14, ry: 0 };
  let orbitRaf = 0;

  // ------------------------------------------------------------ engine bus
  const send = (cmd, value) => window.postMessage({ source: `${NS}-hud`, cmd, value }, '*');

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.source !== `${NS}-engine`) return;
    if (m.type === 'state') { st = m.state; render(); }
    if (m.type === 'timeline') { tl = { count: m.count, endMs: m.endMs, t: m.t }; renderRibbon(); }
    if (m.type === 'scrubbed') { tl.t = m.t; tl.endMs = m.endMs; renderRibbon(); }
    if (m.type === 'echo') {
      if (m.count) toast('echo', `${m.label} — past behind, future ahead`);
      else toast('nothing moves here', 'point at something animating and press E');
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
    send('state'); send('scan');
    toast('fermata', 'you hold this page’s clock — space to freeze');
    tickLoop();
  }

  function leave() {
    if (!active) return;
    active = false;
    send('echoOff');
    send('setFrozen', false);
    send('setRate', 1);
    untilt(true);
    if (host) { host.remove(); host = null; }
    lastBadge = null;
    try { chrome.runtime.sendMessage({ type: 'fermata-badge', text: '' }); } catch (_) {}
  }

  function tickLoop() {
    if (!active) return;
    if (!recording) send('state');
    setTimeout(tickLoop, 150);
  }

  // ------------------------------------------------------------------ tilt
  // The page itself becomes the 3D object: the live body tilts back into
  // perspective over a dark golden room. Real DOM, still alive — only its
  // clock is confiscated.
  function tilt() {
    if (tilted || !document.body) return;
    tilted = true;
    const b = document.body, d = document.documentElement;
    saved = {
      transform: b.style.transform, origin: b.style.transformOrigin,
      shadow: b.style.boxShadow, outline: b.style.outline,
      bg: d.style.background,
    };
    d.style.background =
      'radial-gradient(120% 90% at 50% 0%, #2a2110 0%, #15110a 45%, #0b0906 100%)';
    b.style.transformOrigin = `50% ${scrollY + innerHeight * 0.45}px`;
    b.style.boxShadow = '0 80px 140px rgba(0,0,0,.65), 0 0 90px rgba(255,176,0,.10)';
    b.style.outline = '1px solid rgba(255,176,0,.22)';
    orbit = { rx: 13, ry: 0 };
    const a = b.animate(
      [{ transform: b.style.transform || 'none' }, { transform: tiltTransform() }],
      { duration: 700, easing: 'cubic-bezier(.22,1,.36,1)' });
    a.id = `${NS}-tilt`;
    a.onfinish = () => { if (tilted) b.style.transform = tiltTransform(); a.cancel(); };
  }

  const tiltTransform = () =>
    `perspective(1500px) translateY(-1.5vh) scale(.9) rotateX(${orbit.rx}deg) rotateY(${orbit.ry}deg)`;

  function untilt(instant) {
    if (!tilted || !document.body) { tilted = false; return; }
    tilted = false;
    cancelAnimationFrame(orbitRaf);
    const b = document.body, d = document.documentElement;
    const finish = () => {
      b.style.transform = saved.transform; b.style.transformOrigin = saved.origin;
      b.style.boxShadow = saved.shadow; b.style.outline = saved.outline;
      d.style.background = saved.bg;
      saved = null;
    };
    if (instant) { finish(); return; }
    const a = b.animate(
      [{ transform: b.style.transform || tiltTransform() }, { transform: saved.transform || 'none' }],
      { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)' });
    a.id = `${NS}-tilt`;
    a.onfinish = () => { finish(); a.cancel(); };
  }

  // gentle orbit as the cursor moves — the frozen slab is in your hand
  function onOrbit() {
    orbitRaf = 0;
    if (!tilted || recording || !document.body) return;
    orbit.ry = ((mouse.x / innerWidth) - 0.5) * 7;
    orbit.rx = 13 - ((mouse.y / innerHeight) - 0.5) * 5;
    document.body.style.transform = tiltTransform();
  }

  window.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    if (tilted && !orbitRaf) orbitRaf = requestAnimationFrame(onOrbit);
  }, true);

  // ---------------------------------------------------------------- freeze
  function setFrozen(f) {
    send('setFrozen', f);
    if (f) {
      tilt();
      send('scan');
      toast('frozen', 'arrows step · drag to scrub · E echoes the motion');
    } else {
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
    send('nudge', ms);
    send('scan');
  }
  function stepBack(ms) {
    if (!st.frozen) setFrozen(true);
    send('seekBy', -ms);
    send('scan');
  }

  // -------------------------------------------------------------- keyboard
  const editable = (el) => {
    if (!el) return false;
    const t = (el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
  };

  window.addEventListener('keydown', (e) => {
    if (!active || recording) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leave(); return; }
    if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const big = e.shiftKey;
    switch (e.code) {
      case 'Space':      setFrozen(!st.frozen); break;
      case 'ArrowRight': step(big ? 100 : 16.67); break;
      case 'ArrowLeft':  stepBack(big ? 100 : 16.67); break;
      case 'ArrowDown':  setTempo(tempoIndex() - 1); break;
      case 'ArrowUp':    setTempo(tempoIndex() + 1); break;
      case 'KeyE':
        if (st.echo) { send('echoOff'); }
        else send('echo', { x: mouse.x, y: mouse.y });
        break;
      case 'KeyR':       record(big ? 24 : 12); break;
      default: return;
    }
    e.preventDefault(); e.stopPropagation();
  }, true);

  // ---------------------------------------------------- drag through time
  // While frozen, the page is a film: pull it horizontally to scrub.
  let drag = null;
  window.addEventListener('pointerdown', (e) => {
    if (!active || !st.frozen || recording || !tl.endMs) return;
    if (host && e.composedPath().includes(host)) return;
    drag = { x0: e.clientX, f0: tl.endMs ? tl.t / tl.endMs : 0, moved: false };
    e.preventDefault(); e.stopPropagation();
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.moved = true;
    const f = Math.max(0, Math.min(1, drag.f0 + (e.clientX - drag.x0) / (innerWidth * 0.6)));
    send('scrub', f);
    e.preventDefault(); e.stopPropagation();
  }, true);
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (drag.moved) { e.preventDefault(); e.stopPropagation(); }
    drag = null;
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
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .vignette { position: fixed; inset: 0; pointer-events: none;
    box-shadow: inset 0 0 140px rgba(255,176,0,.07), inset 0 0 36px rgba(0,0,0,.18);
    border: 1px solid rgba(255,176,0,.28); opacity: 0; transition: opacity .6s; }
  .vignette.in { opacity: 1; }

  .toast { position: fixed; left: 50%; top: 38%; transform: translate(-50%,-50%) scale(.98);
    text-align: center; pointer-events: none; opacity: 0; padding: 48px 90px;
    background: radial-gradient(55% 55% at 50% 50%, rgba(10,8,3,.62), rgba(10,8,3,0) 72%);
    transition: opacity .45s ease, transform .45s ease; }
  .toast.show { opacity: 1; transform: translate(-50%,-50%) scale(1); }
  .toast .word { font: italic 400 54px/1.1 ${SERIF}; color: #ffc94d; letter-spacing: .01em;
    text-shadow: 0 2px 30px rgba(0,0,0,.55), 0 0 60px rgba(255,176,0,.25); }
  .toast .plain { margin-top: 10px; font: 400 14px/1.4 ${SANS}; color: rgba(255,236,196,.85);
    letter-spacing: .04em; text-shadow: 0 1px 12px rgba(0,0,0,.6); }

  .ribbon { position: fixed; left: 50%; bottom: 86px; transform: translateX(-50%);
    width: min(560px, 70vw); height: 18px; pointer-events: auto; cursor: ew-resize;
    opacity: 0; transition: opacity .4s; }
  .ribbon.in { opacity: 1; }
  .ribbon .rail { position: absolute; left: 0; right: 0; top: 8px; height: 2px;
    background: linear-gradient(90deg, rgba(255,176,0,.15), rgba(255,176,0,.5), rgba(255,176,0,.15));
    border-radius: 1px; }
  .ribbon .ph { position: absolute; top: 3px; width: 12px; height: 12px; border-radius: 50%;
    background: #ffc94d; box-shadow: 0 0 12px rgba(255,176,0,.8); margin-left: -6px;
    transition: left .08s linear; }
  .ribbon .rt { position: absolute; right: 0; top: -16px; font: 400 11px ${SANS};
    color: rgba(255,222,150,.8); font-variant-numeric: tabular-nums; }

  .capsule { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 14px; pointer-events: auto;
    background: rgba(17,13,7,.82); backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid rgba(255,176,0,.3); border-radius: 999px;
    padding: 10px 22px 11px 18px;
    box-shadow: 0 16px 50px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,210,110,.12);
    font: 400 13px/1.3 ${SANS}; color: #f2e8d5; white-space: nowrap;
    animation: rise .55s cubic-bezier(.22,1,.36,1); }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 14px); } }
  .glyph { color: #ffb000; display: flex; flex: none;
    filter: drop-shadow(0 0 6px rgba(255,176,0,.5)); transition: filter .3s, color .3s; }
  .glyph.held { color: #ffd45e; filter: drop-shadow(0 0 12px rgba(255,200,60,.85)); }
  .tempo { display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
  .tempo .word { font: italic 400 19px/1 ${SERIF}; color: #ffc94d; }
  .tempo .plain { font: 400 11.5px ${SANS}; color: rgba(242,232,213,.55); }
  .time { font: 400 12.5px ${SANS}; color: rgba(255,222,150,.9);
    font-variant-numeric: tabular-nums; min-width: 56px; }
  .sep { width: 1px; height: 20px; background: rgba(255,176,0,.22); }
  .hints { display: flex; gap: 12px; align-items: center; }
  .hint { display: flex; gap: 5px; align-items: center; background: none; border: none;
    font: 400 11.5px ${SANS}; color: rgba(242,232,213,.62); cursor: pointer; padding: 0; }
  .hint:hover { color: #ffc94d; }
  .hint kbd { font: 500 10px/1 ${SANS}; color: rgba(255,222,150,.9);
    border: 1px solid rgba(255,176,0,.32); border-bottom-width: 2px; border-radius: 4px;
    padding: 3px 5px; background: rgba(255,176,0,.07); }

  .rec { position: fixed; right: 28px; top: 24px; display: none; align-items: center; gap: 10px;
    background: rgba(17,13,7,.85); border: 1px solid rgba(255,176,0,.35); border-radius: 999px;
    padding: 8px 16px; font: 400 12.5px ${SANS}; color: #ffe2b0; pointer-events: none; }
  .rec.in { display: flex; }
  .rec .dot { width: 9px; height: 9px; border-radius: 50%; background: #ffb000;
    box-shadow: 0 0 10px rgba(255,176,0,.9); animation: pulse 1s ease infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
</style>
<div class="vignette" id="vig"></div>
<div class="toast" id="toast"><div class="word" id="tword"></div><div class="plain" id="tplain"></div></div>
<div class="ribbon" id="ribbon"><span class="rt" id="rtime"></span><div class="rail"></div><div class="ph" id="ph"></div></div>
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
<div class="rec" id="recpill"><span class="dot"></span><span id="rectext">recording</span></div>`;

    ui = {};
    for (const id of ['vig','toast','tword','tplain','ribbon','rtime','ph','capsule','glyph',
                      'tempo','word','plain','time','hints','recpill','rectext'])
      ui[id] = root.getElementById(id);

    requestAnimationFrame(() => ui.vig.classList.add('in'));
    ui.tempo.addEventListener('click', () => setTempo(tempoIndex() - 1));
    renderHints();

    // ribbon is also draggable directly
    let rdrag = false;
    const rfrac = (e) => {
      const r = ui.ribbon.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    ui.ribbon.addEventListener('pointerdown', (e) => {
      rdrag = true; ui.ribbon.setPointerCapture(e.pointerId); send('scrub', rfrac(e));
      e.stopPropagation();
    });
    ui.ribbon.addEventListener('pointermove', (e) => { if (rdrag) send('scrub', rfrac(e)); });
    ui.ribbon.addEventListener('pointerup', () => rdrag = false);

    document.documentElement.appendChild(host);
  }

  function renderHints() {
    const items = st.frozen
      ? [['space', 'release'], ['← →', 'step'], ['drag', 'scrub'], ['E', 'echo'], ['R', 'record'], ['esc', 'leave']]
      : [['space', 'freeze'], ['↑ ↓', 'speed'], ['R', 'record'], ['esc', 'leave']];
    ui.hints.innerHTML = '';
    for (const [k, label] of items) {
      const b = document.createElement('button');
      b.className = 'hint';
      b.innerHTML = `<kbd>${k}</kbd>${label}`;
      b.addEventListener('click', () => {
        if (label === 'freeze' || label === 'release') setFrozen(!st.frozen);
        else if (label === 'step') step(16.67);
        else if (label === 'speed') setTempo(tempoIndex() - 1);
        else if (label === 'echo') st.echo ? send('echoOff') : send('echo', { x: mouse.x, y: mouse.y });
        else if (label === 'record') record(12);
        else if (label === 'leave') leave();
      });
      ui.hints.appendChild(b);
    }
  }

  function toast(word, plain) {
    if (!host) return;
    ui.tword.textContent = word;
    ui.tplain.textContent = plain;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast && ui.toast.classList.remove('show'), 1900);
  }

  const fmt = (ms) => {
    const s = Math.max(0, ms) / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  };

  let wasFrozen = false;
  function render() {
    if (!host) return;
    const t = TEMPOS[tempoIndex()];
    const exact = Math.abs(t.r - st.rate) < 0.004;
    ui.word.textContent = st.frozen ? 'frozen' : (exact ? t.word : st.rate.toFixed(2) + '×');
    ui.plain.textContent = st.frozen ? 'time is yours' : t.plain;
    ui.time.textContent = fmt(st.vnow);
    ui.glyph.classList.toggle('held', st.frozen);
    if (st.frozen !== wasFrozen) { wasFrozen = st.frozen; renderHints(); renderRibbon(); }
    badge();
  }

  function renderRibbon() {
    if (!host) return;
    const show = st.frozen && tl.endMs > 0;
    ui.ribbon.classList.toggle('in', show);
    if (!show) return;
    const f = Math.max(0, Math.min(1, tl.t / tl.endMs));
    ui.ph.style.left = (f * 100) + '%';
    ui.rtime.textContent = `${fmt(tl.t)} / ${fmt(tl.endMs)}`;
  }

  // --------------------------------------------------- stop-motion recorder
  // Hold the virtual clock, advance it in fixed steps, capture each settled
  // frame — frame-perfect regardless of captureVisibleTab's ~2/sec quota.
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

  async function record(N) {
    if (recording || !active) return;
    recording = true;
    const wasFrozenBefore = st.frozen;
    const useTimeline = tl.endMs > 0;
    const span = useTimeline ? tl.endMs : 800;

    // a flat, clean stage: no tilt, no echoes, no overlay in frame
    send('echoOff');
    send('setFrozen', true);
    untilt(true);
    ui.vig.style.display = 'none';
    ui.capsule.style.display = 'none';
    ui.ribbon.style.display = 'none';
    ui.toast.classList.remove('show');
    ui.toast.style.display = 'none';     // instantly — a mid-fade toast must not land in frames
    ui.recpill.classList.add('in');
    await settle();

    const frames = [];
    try {
      for (let i = 0; i < N; i++) {
        if (useTimeline) send('scrub', i / (N - 1));
        else if (i > 0) send('nudge', span / (N - 1));
        ui.recpill.style.display = 'none';
        await settle();
        const url = await capture();
        const t = i * (span / (N - 1));
        frames.push({ url, t });
        ui.recpill.style.display = '';
        ui.rectext.textContent = `frame ${i + 1} of ${N}`;
        await new Promise(r => setTimeout(r, 620)); // respect capture quota
      }
      await chrome.storage.local.set({
        fermataFrames: {
          frames,
          meta: {
            title: document.title, url: location.href,
            mode: useTimeline ? 'timeline' : 'clock',
            spanMs: span, rate: st.rate, captured: Date.now()
          }
        }
      });
      chrome.runtime.sendMessage({ type: 'fermata-storyboard' });
    } catch (e) {
      toast('recording failed', e.message);
    } finally {
      ui.recpill.classList.remove('in');
      ui.recpill.style.display = '';
      ui.toast.style.display = '';
      ui.vig.style.display = '';
      ui.capsule.style.display = '';
      ui.ribbon.style.display = '';
      recording = false;
      if (wasFrozenBefore) tilt();
      else send('setFrozen', false);
    }
  }
})();
