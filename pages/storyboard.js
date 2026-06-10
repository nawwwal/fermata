// Fermata — storyboard renderer.

const fmt = ms => {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
};

let data = null;

chrome.storage.local.get('fermataFrames').then(({ fermataFrames }) => {
  if (!fermataFrames || !fermataFrames.frames || !fermataFrames.frames.length) return;
  data = fermataFrames;
  const { frames, meta } = data;

  document.getElementById('src').textContent = meta.url;
  document.getElementById('meta').innerHTML =
    `<span>frames <b>${frames.length}</b></span>` +
    `<span>span <b>${Math.round(meta.spanMs)} ms</b> (virtual)</span>` +
    `<span>mode <b>${meta.mode}</b></span>` +
    `<span>clock rate at capture <b>${meta.rate.toFixed(2)}×</b></span>`;

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  frames.forEach((f, i) => {
    const fig = document.createElement('figure');
    const img = new Image();
    img.src = f.url;
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<span>${String(i + 1).padStart(2, '0')} / ${String(frames.length).padStart(2, '0')}</span>` +
                    `<span class="t">+${fmt(f.t)}</span>`;
    fig.append(img, cap);
    grid.appendChild(fig);
  });
});

document.getElementById('all').addEventListener('click', () => {
  if (!data) return;
  data.frames.forEach((f, i) => {
    const a = document.createElement('a');
    a.href = f.url;
    a.download = `fermata-frame-${String(i + 1).padStart(2, '0')}.png`;
    a.click();
  });
});

document.getElementById('sheet').addEventListener('click', async () => {
  if (!data) return;
  const imgs = await Promise.all(data.frames.map(f => new Promise(res => {
    const im = new Image(); im.onload = () => res(im); im.src = f.url;
  })));
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
  ctx.fillStyle = '#16140f';
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.fillStyle = '#ffb000';
  ctx.font = '700 16px ui-monospace, Menlo, monospace';
  ctx.fillText('FERMATA / STORYBOARD', pad, 34);
  ctx.fillStyle = '#8b8472';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  const title = (data.meta.url || '').slice(0, 90);
  ctx.fillText(title, pad + 270, 34);

  imgs.forEach((im, i) => {
    const x = pad + (i % cols) * (fw + pad);
    const y = 50 + pad + Math.floor(i / cols) * (fh + cap + pad);
    ctx.drawImage(im, x, y, fw, fh);
    ctx.strokeStyle = '#36322a';
    ctx.strokeRect(x + .5, y + .5, fw - 1, fh - 1);
    ctx.fillStyle = '#8b8472';
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.fillText(String(i + 1).padStart(2, '0'), x, y + fh + 20);
    ctx.fillStyle = '#ffb000';
    const t = `+${fmt(data.frames[i].t)}`;
    ctx.fillText(t, x + fw - ctx.measureText(t).width, y + fh + 20);
  });

  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = 'fermata-storyboard.png';
  a.click();
});
