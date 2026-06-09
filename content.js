// Tempo Lens — HUD + recorder (ISOLATED world).
// Talks to the MAIN-world engine over postMessage, to the service worker for
// screenshots. Recording is stop-motion: pause the virtual clock, advance it
// in fixed steps, capture each settled frame — frame-perfect regardless of
// captureVisibleTab's ~2/sec quota.

(() => {
  'use strict';
  if (window.__tempoLensHud) return;
  window.__tempoLensHud = true;

  const NS = 'tempo-lens';
  const SCOPE_ATTR = 'data-tempo-scope';
  let host = null, ui = {}, engineState = { rate: 1, paused: false, vnow: 0 };
  let timeline = { count: 0, endMs: 0 };
  let recording = false;

  // ------------------------------------------------------------ engine bus
  function send(cmd, value) {
    window.postMessage({ source: `${NS}-hud`, cmd, value }, '*');
  }
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.source !== `${NS}-engine`) return;
    if (m.type === 'state') { engineState = m.state; renderState(); }
    if (m.type === 'timeline') { timeline = { count: m.count, endMs: m.endMs }; renderTimeline(); }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'tempo-toggle') toggleHud();
  });

  // ------------------------------------------------------------------- HUD
  function toggleHud() {
    if (host) { host.remove(); host = null; return; }
    buildHud();
    send('state');
  }

  function buildHud() {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:24px;right:24px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; }
  .panel {
    width: 308px; color: #e8e3d8;
    background: rgba(16,15,13,.94); backdrop-filter: blur(10px);
    border: 1px solid #3a352c; border-radius: 10px;
    font: 12px/1.45 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
    box-shadow: 0 12px 40px rgba(0,0,0,.5);
    user-select: none;
  }
  .bar { display:flex; align-items:center; gap:8px; padding:10px 12px;
    border-bottom:1px solid #2a2620; cursor:grab; }
  .bar:active { cursor:grabbing; }
  .dot { width:8px; height:8px; border-radius:50%; background:#ffb000;
    box-shadow:0 0 8px #ffb00088; flex:none; }
  .dot.paused { background:#6e675a; box-shadow:none; }
  .name { letter-spacing:.14em; font-size:10px; color:#9a937f; }
  .tc { margin-left:auto; font-variant-numeric:tabular-nums; color:#ffb000; font-size:13px; }
  .x { background:none; border:none; color:#6e675a; font:inherit; cursor:pointer; padding:0 0 0 6px; }
  .x:hover { color:#e8e3d8; }
  section { padding:10px 12px; border-bottom:1px solid #2a2620; }
  section:last-of-type { border-bottom:none; }
  label.h { display:block; font-size:9px; letter-spacing:.16em; color:#6e675a; margin-bottom:7px; }
  .row { display:flex; gap:6px; align-items:center; }
  input[type=range] { flex:1; accent-color:#ffb000; height:18px; }
  .val { width:54px; text-align:right; color:#ffb000; font-variant-numeric:tabular-nums; }
  button.b {
    background:#221f1a; color:#cfc8b8; border:1px solid #3a352c; border-radius:5px;
    font:inherit; font-size:11px; padding:4px 8px; cursor:pointer;
  }
  button.b:hover { border-color:#ffb000; color:#ffb000; }
  button.b.on { background:#ffb000; color:#16140f; border-color:#ffb000; font-weight:700; }
  button.b:disabled { opacity:.4; cursor:default; }
  .presets { display:flex; gap:5px; margin-top:7px; }
  .presets .b { flex:1; padding:4px 0; }
  .meta { color:#6e675a; font-size:10px; margin-top:6px; }
  .meta em { color:#9a937f; font-style:normal; }
  input.n { width:52px; background:#221f1a; border:1px solid #3a352c; border-radius:5px;
    color:#e8e3d8; font:inherit; padding:4px 6px; text-align:right; }
  select.n { background:#221f1a; border:1px solid #3a352c; border-radius:5px;
    color:#e8e3d8; font:inherit; padding:4px; }
  .prog { height:3px; background:#2a2620; border-radius:2px; margin-top:8px; overflow:hidden; display:none; }
  .prog i { display:block; height:100%; width:0%; background:#ffb000; transition:width .2s; }
</style>
<div class="panel">
  <div class="bar" id="drag">
    <span class="dot" id="dot"></span><span class="name">TEMPO LENS</span>
    <span class="tc" id="tc">00:00.000</span>
    <button class="x" id="close" title="Close">✕</button>
  </div>

  <section>
    <label class="h">CLOCK RATE</label>
    <div class="row">
      <input type="range" id="rate" min="0" max="100" value="73">
      <span class="val" id="rateval">1.00×</span>
    </div>
    <div class="presets">
      <button class="b" data-r="0.05">.05</button>
      <button class="b" data-r="0.1">.1</button>
      <button class="b" data-r="0.25">.25</button>
      <button class="b" data-r="0.5">.5</button>
      <button class="b" data-r="1">1</button>
    </div>
  </section>

  <section>
    <label class="h">TRANSPORT</label>
    <div class="row">
      <button class="b" id="pause" style="flex:1">Pause</button>
      <button class="b" id="step1" title="Advance virtual clock 16 ms">+16 ms</button>
      <button class="b" id="step4" title="Advance virtual clock 100 ms">+100 ms</button>
    </div>
    <div class="meta">Stepping advances the page's forged clock — JS motion included.</div>
  </section>

  <section>
    <label class="h">SCOPE &amp; SCRUB</label>
    <div class="row">
      <button class="b" id="pick" style="flex:1">Pick element</button>
      <button class="b" id="scan" style="flex:1">Scan animations</button>
    </div>
    <div class="row" style="margin-top:8px">
      <input type="range" id="scrub" min="0" max="1000" value="0" disabled>
      <span class="val" id="scrubval">—</span>
    </div>
    <div class="meta" id="tlmeta">Scan finds seekable (CSS/WAAPI) animations. Scrubbing runs both directions; slow the clock first so transitions live long enough to catch.</div>
  </section>

  <section>
    <label class="h">RECORD → STORYBOARD</label>
    <div class="row">
      <input class="n" id="frames" type="number" min="2" max="48" value="12" title="Frames">
      <span class="meta" style="margin:0">frames ·</span>
      <input class="n" id="span" type="number" min="50" max="60000" value="800" title="Span (virtual ms)">
      <span class="meta" style="margin:0">ms ·</span>
      <select class="n" id="mode">
        <option value="clock">clock</option>
        <option value="timeline">timeline</option>
      </select>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="b on" id="rec" style="flex:1">● Record</button>
    </div>
    <div class="prog" id="prog"><i id="progbar"></i></div>
    <div class="meta"><em>clock</em>: steps the forged clock through the next <em>span</em> ms — start it mid-interaction. <em>timeline</em>: scrubs the scanned animations end-to-end.</div>
  </section>
</div>`;

    ui = {};
    for (const id of ['dot','tc','rate','rateval','pause','step1','step4','pick','scan',
                      'scrub','scrubval','tlmeta','frames','span','mode','rec','prog','progbar','close','drag'])
      ui[id] = root.getElementById(id);

    // Log-scale slider: 0..100 → 0.02..2, with 73 ≈ 1.0
    const sliderToRate = v => 0.02 * Math.pow(100, v / 100);
    const rateToSlider = r => 100 * Math.log(r / 0.02) / Math.log(100);

    ui.rate.addEventListener('input', () => {
      const r = sliderToRate(+ui.rate.value);
      send('setRate', r);
    });
    root.querySelectorAll('[data-r]').forEach(b =>
      b.addEventListener('click', () => {
        send('setRate', +b.dataset.r);
        ui.rate.value = rateToSlider(+b.dataset.r);
      }));

    ui.pause.addEventListener('click', () => send('setPaused', !engineState.paused));
    ui.step1.addEventListener('click', () => send('nudge', 16.67));
    ui.step4.addEventListener('click', () => send('nudge', 100));
    ui.pick.addEventListener('click', startPicker);
    ui.scan.addEventListener('click', () => send('scan'));
    ui.scrub.addEventListener('input', () => send('scrub', +ui.scrub.value / 1000));
    ui.rec.addEventListener('click', record);
    ui.close.addEventListener('click', toggleHud);

    // Drag
    let dx = 0, dy = 0, dragging = false;
    ui.drag.addEventListener('pointerdown', e => {
      dragging = true; const r = host.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      ui.drag.setPointerCapture(e.pointerId);
    });
    ui.drag.addEventListener('pointermove', e => {
      if (!dragging) return;
      host.style.left = (e.clientX - dx) + 'px';
      host.style.top = (e.clientY - dy) + 'px';
      host.style.right = 'auto';
    });
    ui.drag.addEventListener('pointerup', () => dragging = false);

    document.documentElement.appendChild(host);

    // Timecode ticker (real interval so it runs while page clock is frozen)
    const tick = () => {
      if (!host) return;
      send('state');
      setTimeout(tick, 120);
    };
    tick();
  }

  function fmt(ms) {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2,'0')}:${(s % 60).toFixed(3).padStart(6,'0')}`;
  }

  function renderState() {
    if (!host) return;
    ui.tc.textContent = fmt(engineState.vnow);
    ui.rateval.textContent = engineState.rate.toFixed(2) + '×';
    ui.pause.textContent = engineState.paused ? 'Play' : 'Pause';
    ui.pause.classList.toggle('on', engineState.paused);
    ui.dot.classList.toggle('paused', engineState.paused);
  }

  function renderTimeline() {
    ui.scrub.disabled = timeline.count === 0;
    ui.scrubval.textContent = timeline.count ? fmt(timeline.endMs) : '—';
    ui.tlmeta.innerHTML = timeline.count
      ? `<em>${timeline.count}</em> seekable animation${timeline.count > 1 ? 's' : ''} · strip length <em>${Math.round(timeline.endMs)} ms</em>. Scrub pauses the page.`
      : 'No seekable animations in scope right now. Trigger the interaction at a slow rate, then scan again.';
  }

  // --------------------------------------------------------- element picker
  function startPicker() {
    document.querySelectorAll(`[${SCOPE_ATTR}]`).forEach(el => el.removeAttribute(SCOPE_ATTR));
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:1.5px solid #ffb000;background:#ffb00018;border-radius:3px;transition:all .05s;';
    document.documentElement.appendChild(box);
    ui.pick.textContent = 'Click target… (Esc)';

    const move = e => {
      const el = e.target;
      if (host && host.contains(el)) return;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    };
    const done = (el) => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
      box.remove();
      if (el) { el.setAttribute(SCOPE_ATTR, '1'); ui.pick.textContent = 'Scope: ' + tag(el) + ' ✕'; ui.pick.onclick = clearScope; }
      else ui.pick.textContent = 'Pick element';
      send('scan');
    };
    const clearScope = () => {
      document.querySelectorAll(`[${SCOPE_ATTR}]`).forEach(el => el.removeAttribute(SCOPE_ATTR));
      ui.pick.textContent = 'Pick element';
      ui.pick.onclick = null;
      send('scan');
    };
    const click = e => {
      if (host && host.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      done(e.target);
    };
    const key = e => { if (e.key === 'Escape') done(null); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
  }

  function tag(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.classList[0] ? '.' + el.classList[0] : '');
  }

  // --------------------------------------------------- stop-motion recorder
  const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40))));

  async function capture(attempt = 0) {
    const res = await chrome.runtime.sendMessage({ type: 'tempo-capture' });
    if (res && res.ok) return res.url;
    if (attempt < 6) {              // quota backoff (~2 captures/sec allowed)
      await new Promise(r => setTimeout(r, 650));
      return capture(attempt + 1);
    }
    throw new Error(res && res.err || 'capture failed');
  }

  async function record() {
    if (recording) return;
    recording = true;
    ui.rec.disabled = true; ui.prog.style.display = 'block';
    const N = Math.min(48, Math.max(2, +ui.frames.value || 12));
    const span = Math.max(50, +ui.span.value || 800);
    const mode = ui.mode.value;
    const wasPaused = engineState.paused;
    const frames = [];

    // Hide HUD during capture so it doesn't appear in frames.
    host.style.visibility = 'hidden';
    send('setPaused', true);
    await settle();

    try {
      for (let i = 0; i < N; i++) {
        if (mode === 'timeline' && timeline.count > 0) {
          send('scrub', i / (N - 1));
        } else if (i > 0) {
          send('nudge', span / (N - 1));
        }
        await settle();
        const url = await capture();
        const t = mode === 'timeline'
          ? (i / (N - 1)) * timeline.endMs
          : i * (span / (N - 1));
        frames.push({ url, t });
        ui.progbar.style.width = Math.round(((i + 1) / N) * 100) + '%';
        await new Promise(r => setTimeout(r, 620)); // respect capture quota
      }
      await chrome.storage.local.set({
        tempoFrames: {
          frames,
          meta: {
            title: document.title, url: location.href, mode,
            spanMs: mode === 'timeline' ? timeline.endMs : span,
            rate: engineState.rate, captured: Date.now()
          }
        }
      });
      chrome.runtime.sendMessage({ type: 'tempo-storyboard' });
    } catch (e) {
      ui.tlmeta.innerHTML = '<em>Recording failed:</em> ' + e.message;
    } finally {
      host.style.visibility = '';
      if (!wasPaused) send('setPaused', false);
      ui.rec.disabled = false; recording = false;
      ui.prog.style.display = 'none'; ui.progbar.style.width = '0%';
    }
  }
})();
