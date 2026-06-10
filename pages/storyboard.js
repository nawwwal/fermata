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
let cur = 0;
let playing = null;     // interval handle while the flipbook runs

chrome.storage.local.get('fermataFrames').then(({ fermataFrames }) => {
  if (!fermataFrames || !fermataFrames.frames || !fermataFrames.frames.length) return;
  data = fermataFrames;
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

window.addEventListener('keydown', e => {
  if (!data || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') { stop(); show(cur - 1); }
  else if (e.key === 'ArrowRight') { stop(); show(cur + 1); }
  else if (e.key === ' ') { e.preventDefault(); play(); }
  else if (e.key.toLowerCase() === 'o') { $('onion').click(); }
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
