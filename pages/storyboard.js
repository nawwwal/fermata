// Fermata — storyboard viewer.
// One recording, three readings: a flipbook deck (play/step/onion-skin), a
// filmstrip, and a contact sheet. Exports: contact-sheet PNG, raw frames,
// and a real-time WebM rendered from the stop-motion frames.

const $ = id => document.getElementById(id);

const fmt = ms => {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
};

let data = null;
let prevTake = null;    // the take before this one — X ghosts it for diffing
let heatUrls = null;    // per-frame motion-heat overlays, built lazily
let compareOn = false, heatOn = false;
let cur = 0;
let playing = null;     // interval handle while the flipbook runs

chrome.storage.local.get(['fermataFrames', 'fermataPrev']).then(({ fermataFrames, fermataPrev }) => {
  if (!fermataFrames || !fermataFrames.frames || !fermataFrames.frames.length) return;
  data = fermataFrames;
  prevTake = fermataPrev && fermataPrev.frames && fermataPrev.frames.length ? fermataPrev : null;
  $('compare').disabled = !prevTake;
  const { frames, meta } = data;

  $('empty').style.display = 'none';
  $('deck').classList.add('live');
  $('src').textContent = meta.url;

  const when = meta.captured ? new Date(meta.captured).toLocaleString() : '';
  $('meta').innerHTML =
    `<span>frames <b>${frames.length}</b></span>` +
    `<span>span <b>${Math.round(meta.spanMs)} ms</b> virtual</span>` +
    `<span>mode <b>${meta.mode}</b></span>` +
    `<span>clock rate at capture <b>${meta.rate.toFixed(2)}×</b></span>` +
    (meta.scope ? `<span>scope <b>${meta.scope}</b></span>` : '') +
    (when ? `<span>${when}</span>` : '');

  // Filmstrip + contact grid
  const strip = $('filmstrip'), grid = $('grid');
  frames.forEach((f, i) => {
    const thumb = document.createElement('figure');
    thumb.innerHTML = `<img src="${f.url}" alt="frame ${i + 1}">` +
      `<figcaption><span>${String(i + 1).padStart(2, '0')}</span><span class="t">+${fmt(f.t)}</span></figcaption>`;
    thumb.addEventListener('click', () => show(i));
    strip.appendChild(thumb);

    const fig = document.createElement('figure');
    fig.innerHTML = `<img src="${f.url}" alt="frame ${i + 1}">` +
      `<figcaption><span>${String(i + 1).padStart(2, '0')} / ${String(frames.length).padStart(2, '0')}</span>` +
      `<span class="t">+${fmt(f.t)}</span></figcaption>`;
    fig.addEventListener('click', () => { show(i); scrollTo({ top: 0, behavior: 'smooth' }); });
    grid.appendChild(fig);
  });

  show(0);
});

function show(i) {
  if (!data) return;
  const n = data.frames.length;
  cur = ((i % n) + n) % n;
  $('frame').src = data.frames[cur].url;
  $('ghost').src = cur > 0 ? data.frames[cur - 1].url : '';
  $('ghost').style.visibility = cur > 0 ? '' : 'hidden';
  if (compareOn && prevTake) {
    const np = prevTake.frames.length;
    $('prevf').src = prevTake.frames[Math.round(cur * (np - 1) / Math.max(1, n - 1))].url;
  }
  $('prevf').style.display = compareOn && prevTake ? '' : 'none';
  const hu = heatOn && heatUrls && heatUrls[cur];
  $('heatimg').style.display = hu ? '' : 'none';
  if (hu) $('heatimg').src = hu;
  $('tc').textContent = '+' + fmt(data.frames[cur].t);
  $('badge').textContent = `${String(cur + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
  [...$('filmstrip').children].forEach((el, j) => el.classList.toggle('on', j === cur));
  const on = $('filmstrip').children[cur];
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function stop() {
  if (playing) { clearInterval(playing); playing = null; }
  $('play').textContent = '▶ Play';
  $('play').classList.remove('on');
}

function play() {
  if (playing) { stop(); return; }
  const fps = +$('fps').value;
  $('play').textContent = '❚❚ Stop';
  $('play').classList.add('on');
  playing = setInterval(() => show(cur + 1), 1000 / fps);
}

$('play').addEventListener('click', play);
$('first').addEventListener('click', () => { stop(); show(0); });
$('last').addEventListener('click', () => { stop(); show(data ? data.frames.length - 1 : 0); });
$('prev').addEventListener('click', () => { stop(); show(cur - 1); });
$('next').addEventListener('click', () => { stop(); show(cur + 1); });
$('fps').addEventListener('change', () => { if (playing) { stop(); play(); } });
$('onion').addEventListener('click', () => {
  $('stage').classList.toggle('onion');
  $('onion').classList.toggle('on');
});

$('compare').addEventListener('click', () => {
  if (!prevTake) return;
  compareOn = !compareOn;
  $('compare').classList.toggle('on', compareOn);
  show(cur);
});

// Motion heat: where, and how much, each frame differs from the one before —
// the change between instants painted as warmth.
async function buildHeat() {
  if (heatUrls) return;
  const imgs = await loadAll();
  const w = Math.min(480, imgs[0].width);
  const h = Math.round(imgs[0].height * (w / imgs[0].width));
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ca = mk(), cb = mk(), co = mk();
  const ga = ca.getContext('2d', { willReadFrequently: true });
  const gb = cb.getContext('2d', { willReadFrequently: true });
  const go = co.getContext('2d');
  heatUrls = [''];
  for (let i = 1; i < imgs.length; i++) {
    ga.drawImage(imgs[i - 1], 0, 0, w, h);
    gb.drawImage(imgs[i], 0, 0, w, h);
    const A = ga.getImageData(0, 0, w, h).data;
    const B = gb.getImageData(0, 0, w, h).data;
    const out = go.createImageData(w, h), O = out.data;
    for (let p = 0; p < A.length; p += 4) {
      const v = Math.min(255, Math.abs(A[p] - B[p]) + Math.abs(A[p + 1] - B[p + 1]) + Math.abs(A[p + 2] - B[p + 2]));
      O[p] = 255; O[p + 1] = Math.max(60, 200 - v * .4); O[p + 2] = 0;
      O[p + 3] = v > 24 ? Math.min(220, v * 1.6) : 0;
    }
    go.putImageData(out, 0, 0);
    heatUrls.push(co.toDataURL('image/png'));
  }
}

$('heatbtn').addEventListener('click', async () => {
  if (!data) return;
  heatOn = !heatOn;
  $('heatbtn').classList.toggle('on', heatOn);
  if (heatOn && !heatUrls) {
    $('heatbtn').textContent = 'Heat…';
    await buildHeat();
    $('heatbtn').textContent = 'Motion heat';
  }
  show(cur);
});

window.addEventListener('keydown', e => {
  if (!data || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') { stop(); show(cur - 1); }
  else if (e.key === 'ArrowRight') { stop(); show(cur + 1); }
  else if (e.key === ' ') { e.preventDefault(); play(); }
  else if (e.key.toLowerCase() === 'o') { $('onion').click(); }
  else if (e.key.toLowerCase() === 'x') { $('compare').click(); }
  else if (e.key.toLowerCase() === 'h') { $('heatbtn').click(); }
});

// --------------------------------------------------------------- exports
const download = (href, name) => {
  const a = document.createElement('a');
  a.href = href; a.download = name; a.click();
};

const loadAll = () => Promise.all(data.frames.map(f => new Promise(res => {
  const im = new Image(); im.onload = () => res(im); im.src = f.url;
})));

$('all').addEventListener('click', () => {
  if (!data) return;
  data.frames.forEach((f, i) =>
    download(f.url, `fermata-frame-${String(i + 1).padStart(2, '0')}.png`));
});

$('sheet').addEventListener('click', async () => {
  if (!data) return;
  const imgs = await loadAll();
  const cols = Math.min(4, imgs.length);
  const rows = Math.ceil(imgs.length / cols);
  const w = imgs[0].width, h = imgs[0].height;
  const scale = Math.min(1, 640 / w);
  const fw = Math.round(w * scale), fh = Math.round(h * scale);
  const pad = 24, cap = 34;

  const c = document.createElement('canvas');
  c.width = cols * (fw + pad) + pad;
  c.height = rows * (fh + cap + pad) + pad + 50;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#100f0b';
  ctx.fillRect(0, 0, c.width, c.height);

  // header: fermata glyph + wordmark + source
  ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(pad + 11, 32, 10, Math.PI, 2 * Math.PI); ctx.stroke();
  ctx.fillStyle = '#ffb000';
  ctx.beginPath(); ctx.arc(pad + 11, 30, 2.4, 0, 2 * Math.PI); ctx.fill();
  ctx.font = 'italic 20px Georgia, serif';
  ctx.fillText('Fermata — storyboard', pad + 34, 38);
  ctx.fillStyle = '#8b8472';
  ctx.font = '12px -apple-system, Segoe UI, sans-serif';
  const title = (data.meta.url || '').slice(0, 80);
  ctx.fillText(title, pad + 400, 36);

  imgs.forEach((im, i) => {
    const x = pad + (i % cols) * (fw + pad);
    const y = 50 + pad + Math.floor(i / cols) * (fh + cap + pad);
    ctx.drawImage(im, x, y, fw, fh);
    ctx.strokeStyle = '#36322a'; ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, fw - 1, fh - 1);
    ctx.fillStyle = '#8b8472';
    ctx.font = '12px -apple-system, Segoe UI, sans-serif';
    ctx.fillText(String(i + 1).padStart(2, '0'), x, y + fh + 20);
    ctx.fillStyle = '#ffb000';
    const t = `+${fmt(data.frames[i].t)}`;
    ctx.fillText(t, x + fw - ctx.measureText(t).width, y + fh + 20);
  });

  download(c.toDataURL('image/png'), 'fermata-storyboard.png');
});

// Render the stop-motion frames back into real-time motion at the flipbook
// rate, via canvas capture → MediaRecorder.
$('webm').addEventListener('click', async () => {
  if (!data) return;
  const btn = $('webm');
  btn.disabled = true; btn.textContent = 'Rendering…';
  try {
    const imgs = await loadAll();
    const fps = +$('fps').value;
    const c = document.createElement('canvas');
    c.width = imgs[0].width; c.height = imgs[0].height;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgs[0], 0, 0);

    const stream = c.captureStream(fps);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => rec.onstop = res);
    rec.start();

    for (const im of imgs) {
      ctx.drawImage(im, 0, 0);
      await new Promise(r => setTimeout(r, 1000 / fps));
    }
    await new Promise(r => setTimeout(r, 250));   // let the tail frame land
    rec.stop();
    await stopped;
    download(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), 'fermata-motion.webm');
  } finally {
    btn.disabled = false; btn.textContent = 'Export film (.webm)';
  }
});

// The motion report: one self-contained HTML file — flipbook, timecodes,
// metadata, and per-frame motion heat — droppable into a PR, Slack, or a
// ticket as evidence of how something moved.
$('report').addEventListener('click', async () => {
  if (!data) return;
  const btn = $('report');
  btn.disabled = true; btn.textContent = 'Building…';
  try {
    await buildHeat();
    const payload = { frames: data.frames, meta: data.meta, heat: heatUrls };
    download(URL.createObjectURL(new Blob([reportHtml(payload)], { type: 'text/html' })),
      'fermata-motion-report.html');
  } finally {
    btn.disabled = false; btn.textContent = 'Motion report';
  }
});

function reportHtml(p) {
  const json = JSON.stringify(p).replace(/</g, '\\u003c');
  const src = (p.meta.url || '').replace(/</g, '&lt;');
  const when = p.meta.captured ? new Date(p.meta.captured).toLocaleString() : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Fermata — motion report</title>
<style>
body{background:#100f0b;color:#e8e3d8;font:13px -apple-system,"Segoe UI",sans-serif;padding:28px;margin:0}
h1{font:italic 400 22px Georgia,serif;color:#ffc94d;margin:0 0 2px}
.src{color:#8b8472;font-size:11px;margin:2px 0 4px;word-break:break-all}
.meta{color:#b89a4e;font-size:11px;margin-bottom:16px}
.stage{position:relative;display:inline-block;border:1px solid #36322a;border-radius:10px;overflow:hidden;max-width:100%}
.stage img{display:block;max-width:100%;max-height:70vh}
#h{position:absolute;left:0;top:0;width:100%;height:100%;mix-blend-mode:screen;pointer-events:none;display:none}
#tc{position:absolute;left:10px;top:10px;color:#ffb000;font-size:11px;background:rgba(16,15,11,.8);padding:3px 8px;border-radius:5px;font-variant-numeric:tabular-nums}
.bar{margin:12px 0}
.bar button{background:#ffb000;border:0;border-radius:6px;padding:6px 14px;font-weight:700;cursor:pointer;font:inherit}
.hint{color:#56503f;font-size:10px;margin-left:10px}
#strip{display:flex;gap:6px;overflow-x:auto;margin-top:12px;padding-bottom:6px}
#strip img{width:110px;border:1px solid #262219;border-radius:4px;cursor:pointer;display:block}
#strip img.on{border-color:#ffb000}
</style></head><body>
<h1>Fermata — motion report</h1>
<div class="src">${src}</div>
<div class="meta">${p.frames.length} frames · ${Math.round(p.meta.spanMs)} ms virtual · ${p.meta.mode}${when ? ' · ' + when : ''}</div>
<div class="stage"><img id="f"><img id="h"><div id="tc"></div></div>
<div class="bar"><button id="play">play</button><span class="hint">arrows step · space plays · H motion heat</span></div>
<div id="strip"></div>
<script>
var D=${json},i=0,playing=null,heat=false;
var f=document.getElementById('f'),hh=document.getElementById('h'),
    tc=document.getElementById('tc'),strip=document.getElementById('strip');
D.frames.forEach(function(fr,j){var im=document.createElement('img');im.src=fr.url;
  im.onclick=function(){show(j)};strip.appendChild(im);});
function show(j){var n=D.frames.length;i=((j%n)+n)%n;f.src=D.frames[i].url;
  tc.textContent='+'+(D.frames[i].t/1000).toFixed(3)+'s · '+(i+1)+'/'+n;
  var hu=heat&&D.heat&&D.heat[i];hh.style.display=hu?'block':'none';if(hu)hh.src=hu;
  [].forEach.call(strip.children,function(el,k){el.className=k===i?'on':''});}
function play(){if(playing){clearInterval(playing);playing=null;return;}
  playing=setInterval(function(){show(i+1)},1000/6);}
document.getElementById('play').onclick=play;
window.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight')show(i+1);else if(e.key==='ArrowLeft')show(i-1);
  else if(e.key===' '){e.preventDefault();play();}
  else if(e.key.toLowerCase()==='h'){heat=!heat;show(i);}});
show(0);
</`+`script></body></html>`;
}
