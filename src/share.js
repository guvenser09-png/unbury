// Share card (1080x1350 PNG) + Web Share / clipboard / download flows.
// Spoiler policy: unrevealed tiles render as rock — image data never leaks;
// the image name is never on the card.

const W = 1080, H = 1350;

export function renderCard({ faultNo, dateLabel, image, revealed, revealPctVal, rankText, guessedAt, streak, url }) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#151821';
  ctx.fillRect(0, 0, W, H);
  // strata bands
  const bands = ['#12161D', '#141924', '#111520', '#0C0F14'];
  bands.forEach((b, i) => {
    ctx.fillStyle = b;
    ctx.save();
    ctx.translate(0, i * (H / 4));
    ctx.transform(1, 0.02, 0, 1, 0, 0);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(-40, 0, W + 80, H / 4 + 30);
    ctx.restore();
  });
  ctx.globalAlpha = 1;

  // header
  ctx.fillStyle = '#F2F5F9';
  ctx.font = '800 44px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('UNBURY', 64, 92);
  const wordW = ctx.measureText('UNBURY').width;
  drawCrack(ctx, 64 + wordW + 16, 52, 64 + wordW + 52, 100, '#FFB020', 3);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#98A5B3';
  ctx.font = '700 36px ui-rounded, system-ui, sans-serif';
  ctx.fillText(`DIG #${faultNo} · ${dateLabel}`, W - 64, 92);

  // hero: pixel art at exact reveal state on a slab
  const slabSize = 720;
  const slabX = (W - slabSize) / 2, slabY = 170;
  rr(ctx, slabX, slabY, slabSize, slabSize, 32);
  ctx.fillStyle = '#1A2029';
  ctx.fill();

  const tile = (slabSize - 32) / 8;
  for (let cell = 0; cell < 64; cell++) {
    const r = Math.floor(cell / 8), c = cell % 8;
    const x = slabX + 16 + c * tile, y = slabY + 16 + r * tile;
    if (revealed[cell]) {
      const half = (tile - 4) / 2;
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
        const px = image.px[(r * 2 + dr) * 16 + (c * 2 + dc)];
        ctx.fillStyle = image.palette[px];
        ctx.fillRect(x + 2 + dc * half, y + 2 + dr * half, half, half);
      }
    } else {
      ctx.fillStyle = '#39424E';
      rr(ctx, x + 2, y + 2, tile - 4, tile - 4, 8);
      ctx.fill();
      ctx.fillStyle = '#414B58';
      ctx.fillRect(x + 2 + ((cell * 37) % (tile - 20)), y + 2 + ((cell * 53) % (tile - 20)), 8, 8);
    }
  }

  // stat chips
  const chips = [{ text: `\u{1F441} ${revealPctVal}% revealed`, gold: false }];
  if (rankText) chips.push({ text: `\u{1F3C6} ${rankText}`, gold: true });
  if (guessedAt != null) chips.push({ text: `\u{1F50D} named it at ${guessedAt}%`, gold: false });
  if (streak > 1) chips.push({ text: `\u{1F525} ${streak}-day streak`, gold: false });
  ctx.font = '800 44px ui-rounded, system-ui, sans-serif';
  const widths = chips.map(c => ctx.measureText(c.text).width + 72);
  const totalW = widths.reduce((a, b) => a + b, 0) + (chips.length - 1) * 24;
  let cx = (W - totalW) / 2;
  const cy = 990;
  chips.forEach((c, i) => {
    ctx.fillStyle = '#1E252F';
    rr(ctx, cx, cy, widths[i], 96, 48);
    ctx.fill();
    ctx.fillStyle = c.gold ? '#FFB020' : '#F2F5F9';
    ctx.textAlign = 'center';
    ctx.fillText(c.text, cx + widths[i] / 2, cy + 62);
    cx += widths[i] + 24;
  });

  // footer
  ctx.textAlign = 'center';
  ctx.fillStyle = '#98A5B3';
  ctx.font = '700 40px ui-rounded, system-ui, sans-serif';
  ctx.fillText('Can you unbury more?', W / 2, 1180);
  ctx.fillStyle = '#FFB020';
  ctx.font = '800 44px ui-rounded, system-ui, sans-serif';
  ctx.fillText(url, W / 2, 1240);
  ctx.fillStyle = '#3DDC97';
  ctx.font = '700 28px ui-rounded, system-ui, sans-serif';
  ctx.fillText('✓ provably fair — same pieces for everyone', W / 2, 1300);

  return canvas;
}

function drawCrack(ctx, x0, y0, x1, y1, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const n = 4;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    ctx.lineTo(x0 + (x1 - x0) * t + (i % 2 ? 6 : -6), y0 + (y1 - y0) * t);
  }
  ctx.stroke();
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function shareText({ faultNo, revealPctVal, rankText, guessedAt, streak, score, url }) {
  const segs = Math.round(revealPctVal / 12.5);
  const bar = '▓'.repeat(segs) + '░'.repeat(8 - segs);
  const parts = [`Unbury #${faultNo} \u{1F441} ${revealPctVal}%`];
  if (rankText) parts.push(`\u{1F3C6} ${rankText}`);
  if (guessedAt != null) parts.push(`\u{1F50D} @${guessedAt}%`);
  if (streak > 1) parts.push(`\u{1F525} ${streak}`);
  return `${parts.join(' · ')}\n${bar} ${score.toLocaleString('en-US')} pts\nSame pieces. Same board. Beat me:\n${url}`;
}

function capPlugins() {
  const c = window.Capacitor;
  return c && c.isNativePlatform && c.isNativePlatform() ? c.Plugins : null;
}

export async function shareCard(canvas, text, url) {
  // Native app: write the PNG to cache and hand it to the OS share sheet —
  // the only reliable file-share path inside WKWebView.
  const plugins = capPlugins();
  if (plugins && plugins.Filesystem && plugins.Share) {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const write = await plugins.Filesystem.writeFile({
        path: 'unbury-share.png',
        data: dataUrl.split(',')[1],
        directory: 'CACHE',
      });
      await plugins.Share.share({ text, files: [write.uri] });
      return 'shared';
    } catch (e) {
      if (e && /cancel/i.test(String(e.message || e))) return 'cancelled';
    }
  }
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  const file = blob ? new File([blob], 'unbury.png', { type: 'image/png' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  if (navigator.share) {
    try { await navigator.share({ text, url }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  return null; // caller falls back to copy/download UI
}

export async function copyImage(canvas) {
  // ClipboardItem must be constructed synchronously within the user gesture;
  // passing a promise keeps WebKit's activation window open.
  try {
    const item = new ClipboardItem({
      'image/png': new Promise(res => canvas.toBlob(res, 'image/png')),
    });
    await navigator.clipboard.write([item]);
    return true;
  } catch { return false; }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export function downloadCard(canvas, faultNo) {
  const a = document.createElement('a');
  a.download = `unbury-${faultNo}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}
