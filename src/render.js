// Board renderer + juice. Render-only: never mutates engine state.
import { BOARD, OBSTACLE } from './engine.js';

export const MINERALS = [
  { fill: '#FFC145', top: '#FFD97A', bot: '#D99A26' },
  { fill: '#F25C54', top: '#FF8A80', bot: '#C43E38' },
  { fill: '#2DD4BF', top: '#6FE8D8', bot: '#1BA394' },
  { fill: '#4C9AFF', top: '#82BAFF', bot: '#2F72D6' },
  { fill: '#A78BFA', top: '#C4B0FF', bot: '#7E62D9' },
  { fill: '#F472B6', top: '#FA9DCC', bot: '#C94E90' },
];

const COL = {
  boardBg: '#1A2029',
  cellEmpty: '#232B36',
  cellStroke: '#2E3945',
  overburden: '#39424E',
  overburdenSpeck: '#414B58',
  accent: '#FFB020',
  accentHot: '#FF7A3D',
  success: '#3DDC97',
  shimmer: '#FFE9B8',
};

export class BoardRenderer {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts; // { getState, getImage, settings }
    this.pad = 8;
    this.gap = 3;
    this.cell = 40;
    this.particles = [];
    this.floaters = [];
    this.cracks = [];
    this.flashes = [];   // {cells, t0, dur}
    this.dying = [];     // {cell, color, t0}
    this.blooms = [];    // {cell, t0} reveal bloom
    this.shake = { mag: 0, t0: 0, dur: 0 };
    this.goldFlash = 0;
    this.ghost = null;   // {cells, valid, glowRows, glowCols, color}
    this.bombHover = null;
    this.artDim = 0.4;   // revealed-art opacity; fades to ~0.1 while aiming
    this.gameOverCrack = 0;
    this.desat = 0;
    this.last = performance.now();
    this.raf = null;
  }

  resize(cssWidth) {
    const inner = cssWidth - this.pad * 2 - this.gap * (BOARD - 1);
    this.cell = Math.floor(inner / BOARD);
    const size = this.cell * BOARD + this.gap * (BOARD - 1) + this.pad * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
  }

  cellXY(cell) {
    const r = Math.floor(cell / BOARD), c = cell % BOARD;
    return {
      x: this.pad + c * (this.cell + this.gap),
      y: this.pad + r * (this.cell + this.gap),
    };
  }

  start() {
    if (this.raf) return;
    const loop = (now) => {
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.draw(now, dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; } }

  // --- event ingestion (called by main after applyMove) ---

  playPlacement(ev, now) {
    for (const cell of ev.placedCells) this.puff(cell, 3, '#98A5B3');
    if (ev.clearedCells.length > 0) this.playClear(ev, now);
    if (ev.fullClear) this.goldFlash = now;
  }

  playClear(ev, now) {
    const reduced = this.opts.settings().reducedMotion;
    this.flashes.push({ cells: ev.clearedCells.slice(), t0: now, dur: 140 });
    for (const cell of ev.clearedCells) {
      const state = this.opts.getState();
      this.dying.push({ cell, t0: now, obstacle: ev.obstacleCells.includes(cell) });
      if (!reduced) this.burst(cell, ev.clearedCells.length > 16 ? 4 : 6, ev.obstacleCells.includes(cell));
    }
    for (const r of ev.clearedRows) this.addCrack(true, r, now);
    for (const c of ev.clearedCols) this.addCrack(false, c, now);
    for (const cell of ev.revealedNow) this.blooms.push({ cell, t0: now });
    const L = ev.clearedRows.length + ev.clearedCols.length;
    if (!reduced && this.opts.settings().shake) {
      this.shake = { mag: Math.min(2 * L + (ev.combo >= 4 ? 1 : 0), 5), t0: now, dur: 120 + L * 10 };
    }
    this.float(ev.clearedCells[Math.floor(ev.clearedCells.length / 2)], '+' + ev.scoreDelta, now,
      ev.combo >= 3 ? COL.accentHot : COL.accent);
  }

  playBomb(ev, now) {
    for (const cell of ev.clearedCells) {
      this.dying.push({ cell, t0: now, obstacle: false });
      this.burst(cell, 6, true);
    }
    for (const cell of ev.revealedNow) this.blooms.push({ cell, t0: now });
    if (this.opts.settings().shake) this.shake = { mag: 5, t0: now, dur: 200 };
  }

  addCrack(isRow, idx, t0) {
    const pts = [];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const along = this.pad + (i / n) * (this.size - this.pad * 2);
      const wobble = (i === 0 || i === n) ? 0 : (Math.random() * 12 - 6);
      const at = this.pad + idx * (this.cell + this.gap) + this.cell / 2 + wobble;
      pts.push(isRow ? [along, at] : [at, along]);
    }
    this.cracks.push({ pts, t0, dur: 460 });
  }

  burst(cell, count, dark) {
    if (this.particles.length > 110) return;
    const { x, y } = this.cellXY(cell);
    const state = this.opts.getState();
    const v = state ? state.board[cell] : 0;
    const mineral = v >= 1 && v <= 6 ? MINERALS[v - 1] : null;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 90 + Math.random() * 160;
      this.particles.push({
        x: x + this.cell / 2, y: y + this.cell / 2,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 40,
        life: 0.38 + Math.random() * 0.14, age: 0,
        size: 3 + Math.random() * 4,
        color: dark ? COL.overburdenSpeck : (mineral ? (Math.random() < 0.2 ? mineral.top : mineral.fill) : COL.shimmer),
      });
    }
  }

  puff(cell, count, color) {
    if (this.particles.length > 110) return;
    const { x, y } = this.cellXY(cell);
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + Math.random() * this.cell, y: y + this.cell,
        vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 20,
        life: 0.2, age: 0, size: 2, color,
      });
    }
  }

  float(cell, text, t0, color) {
    const { x, y } = this.cellXY(cell == null ? 27 : cell);
    this.floaters.push({ x: x + this.cell / 2, y, text, t0, color });
  }

  // --- main draw ---

  draw(now, dt) {
    const ctx = this.ctx;
    const state = this.opts.getState();
    ctx.clearRect(0, 0, this.size, this.size);

    ctx.save();
    if (this.shake.mag > 0) {
      const el = now - this.shake.t0;
      if (el < this.shake.dur) {
        const decay = 1 - el / this.shake.dur;
        ctx.translate(
          Math.sin(el * 0.35) * this.shake.mag * decay,
          Math.cos(el * 0.27) * this.shake.mag * decay
        );
      } else this.shake.mag = 0;
    }

    // slab
    roundRect(ctx, 0, 0, this.size, this.size, 14);
    ctx.fillStyle = COL.boardBg;
    ctx.fill();

    const img = this.opts.getImage();

    // while the player is aiming, mute the mural so the board reads as pure
    // game state: empty vs blocked, nothing in between
    const artTarget = this.ghost || this.bombHover != null ? 0.1 : 0.4;
    this.artDim += (artTarget - this.artDim) * Math.min(dt * 12, 1);

    for (let cell = 0; cell < 64; cell++) {
      const { x, y } = this.cellXY(cell);
      const v = state ? state.board[cell] : 0;
      const revealed = state ? state.revealed[cell] : 0;

      if (v === 0) {
        ctx.fillStyle = COL.cellEmpty;
        roundRect(ctx, x, y, this.cell, this.cell, 5);
        ctx.fill();
        if (revealed && img) {
          this.drawArtCell(ctx, img, cell, x, y, this.artDim);
        }
      } else if (v === OBSTACLE) {
        this.drawObstacle(ctx, x, y, cell);
      } else {
        this.drawMineral(ctx, x, y, this.cell, v);
      }
    }

    // ghost preview + clairvoyance glow
    if (this.ghost && state) {
      if (this.ghost.valid) {
        for (const r of this.ghost.glowRows) this.glowLine(ctx, true, r, now);
        for (const c of this.ghost.glowCols) this.glowLine(ctx, false, c, now);
        const m = MINERALS[this.ghost.color - 1];
        for (const cell of this.ghost.cells) {
          const { x, y } = this.cellXY(cell);
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = m.fill;
          roundRect(ctx, x, y, this.cell, this.cell, 5);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = COL.success;
          ctx.lineWidth = 2;
          roundRect(ctx, x + 1, y + 1, this.cell - 2, this.cell - 2, 5);
          ctx.stroke();
        }
      }
    }

    // bomb targeting reticle
    if (this.bombHover != null) {
      const r0 = Math.floor(this.bombHover / BOARD), c0 = this.bombHover % BOARD;
      ctx.strokeStyle = COL.accentHot;
      ctx.lineWidth = 3;
      const tl = this.cellXY(Math.max(r0 - 1, 0) * BOARD + Math.max(c0 - 1, 0));
      const br = this.cellXY(Math.min(r0 + 1, 7) * BOARD + Math.min(c0 + 1, 7));
      roundRect(ctx, tl.x - 2, tl.y - 2, br.x + this.cell - tl.x + 4, br.y + this.cell - tl.y + 4, 8);
      ctx.stroke();
    }

    // dying cells (clear animation: scale-out with mineral color)
    this.dying = this.dying.filter(d => {
      const el = (now - d.t0) / 160;
      if (el >= 1) return false;
      const { x, y } = this.cellXY(d.cell);
      const s = 1 - el;
      const off = (this.cell * (1 - s)) / 2;
      ctx.globalAlpha = 1 - el * 0.5;
      ctx.fillStyle = d.obstacle ? COL.overburden : COL.cellEmpty;
      roundRect(ctx, x + off, y + off, this.cell * s, this.cell * s, 5 * s);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    });

    // flash sweep
    this.flashes = this.flashes.filter(f => {
      const el = (now - f.t0) / f.dur;
      if (el >= 1) return false;
      const a = el < 0.36 ? el / 0.36 : 1 - (el - 0.36) / 0.64;
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = '#FFFFFF';
      for (const cell of f.cells) {
        const { x, y } = this.cellXY(cell);
        roundRect(ctx, x, y, this.cell, this.cell, 5);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return true;
    });

    // seam cracks
    this.cracks = this.cracks.filter(cr => {
      const el = (now - cr.t0) / cr.dur;
      if (el >= 1) return false;
      const reach = Math.min(el * 2.4, 1);
      const alpha = el < 0.5 ? 1 : 1 - (el - 0.5) * 2;
      ctx.strokeStyle = COL.accent;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.shadowColor = COL.accent;
      ctx.shadowBlur = 7;
      ctx.beginPath();
      const upto = Math.max(2, Math.floor(cr.pts.length * reach));
      ctx.moveTo(cr.pts[0][0], cr.pts[0][1]);
      for (let i = 1; i < upto; i++) ctx.lineTo(cr.pts[i][0], cr.pts[i][1]);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return true;
    });

    // reveal blooms
    this.blooms = this.blooms.filter(b => {
      const el = (now - b.t0) / 300;
      if (el >= 1) return false;
      const { x, y } = this.cellXY(b.cell);
      ctx.globalAlpha = (1 - el) * 0.55;
      ctx.fillStyle = COL.shimmer;
      roundRect(ctx, x, y, this.cell, this.cell, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    });

    // particles
    this.particles = this.particles.filter(p => {
      p.age += dt;
      if (p.age >= p.life) return false;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 640 * dt;
      const fade = 1 - Math.max(0, (p.age / p.life - 0.6) / 0.4);
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.globalAlpha = 1;
      return true;
    });

    // floating score text
    this.floaters = this.floaters.filter(f => {
      const el = (now - f.t0) / 500;
      if (el >= 1) return false;
      ctx.globalAlpha = 1 - Math.max(0, (el - 0.55) / 0.45);
      ctx.fillStyle = f.color;
      ctx.font = '700 20px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - el * 26);
      ctx.globalAlpha = 1;
      return true;
    });

    // full-clear gold flash
    if (this.goldFlash) {
      const el = (now - this.goldFlash) / 450;
      if (el < 1) {
        ctx.globalAlpha = (1 - el) * 0.35;
        ctx.fillStyle = COL.accent;
        ctx.fillRect(0, 0, this.size, this.size);
        ctx.globalAlpha = 1;
      } else this.goldFlash = 0;
    }

    // game-over diagonal seam
    if (this.gameOverCrack) {
      const el = Math.min((now - this.gameOverCrack) / 700, 1);
      ctx.strokeStyle = el < 1 ? COL.accent : '#6B4A1F';
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const steps = 10;
      ctx.moveTo(4, 4);
      for (let i = 1; i <= Math.floor(steps * el); i++) {
        const t = i / steps;
        ctx.lineTo(4 + t * (this.size - 8) + (i % 2 ? 7 : -7), 4 + t * (this.size - 8));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  drawArtCell(ctx, img, cell, x, y, alpha) {
    // board cell (r,c) maps to the 2x2 image-pixel block (2r..2r+1, 2c..2c+1).
    // Art is drawn INSET with a sunken rim: raised = solid block, sunken pit =
    // excavated and buildable — the affordance must read at a glance.
    const r = Math.floor(cell / BOARD), c = cell % BOARD;
    const inset = 3;
    const half = (this.cell - inset * 2) / 2;
    ctx.globalAlpha = alpha;
    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        const px = img.px[(r * 2 + dr) * 16 + (c * 2 + dc)];
        ctx.fillStyle = img.palette[px];
        ctx.fillRect(x + inset + dc * half, y + inset + dr * half, half, half);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(8, 10, 14, 0.35)';
    ctx.fillRect(x + inset, y + inset, this.cell - inset * 2, 2);
    ctx.strokeStyle = 'rgba(8, 10, 14, 0.6)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x + 1.5, y + 1.5, this.cell - 3, this.cell - 3, 4);
    ctx.stroke();
  }

  drawObstacle(ctx, x, y, cell) {
    ctx.fillStyle = COL.overburden;
    roundRect(ctx, x, y, this.cell, this.cell, 5);
    ctx.fill();
    // deterministic speckle from cell index (render-only)
    ctx.fillStyle = COL.overburdenSpeck;
    const s = Math.max(2, this.cell * 0.1);
    const h1 = (cell * 37) % (this.cell - s * 2);
    const h2 = (cell * 53) % (this.cell - s * 2);
    ctx.fillRect(x + s + h1 * 0.7, y + s + h2 * 0.5, s, s);
    ctx.fillRect(x + s + h2 * 0.6, y + s + h1 * 0.8, s * 0.8, s * 0.8);
    ctx.strokeStyle = COL.overburdenSpeck;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + this.cell * 0.25, y + this.cell * 0.3);
    ctx.lineTo(x + this.cell * 0.5, y + this.cell * 0.55);
    ctx.lineTo(x + this.cell * 0.42, y + this.cell * 0.78);
    ctx.stroke();
  }

  drawMineral(ctx, x, y, size, v) {
    const m = MINERALS[v - 1];
    ctx.fillStyle = m.fill;
    roundRect(ctx, x, y, size, size, 5);
    ctx.fill();
    ctx.strokeStyle = m.top;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + size * 0.5);
    ctx.lineTo(x + 2, y + 6);
    ctx.quadraticCurveTo(x + 2, y + 2, x + 6, y + 2);
    ctx.lineTo(x + size * 0.5, y + 2);
    ctx.stroke();
    ctx.strokeStyle = m.bot;
    ctx.beginPath();
    ctx.moveTo(x + size - 2, y + size * 0.5);
    ctx.lineTo(x + size - 2, y + size - 6);
    ctx.quadraticCurveTo(x + size - 2, y + size - 2, x + size - 6, y + size - 2);
    ctx.lineTo(x + size * 0.5, y + size - 2);
    ctx.stroke();
  }

  glowLine(ctx, isRow, idx, now) {
    const pulse = 0.1 + 0.06 * Math.sin(now / 160);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = COL.accent;
    const at = this.pad + idx * (this.cell + this.gap) - 2;
    if (isRow) ctx.fillRect(this.pad - 3, at, this.size - this.pad * 2 + 6, this.cell + 4);
    else ctx.fillRect(at, this.pad - 3, this.cell + 4, this.size - this.pad * 2 + 6);
    ctx.globalAlpha = 1;
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draws a piece into a small canvas for the tray / drag layer.
export function drawPieceSprite(canvas, piece, color, cellPx, gapPx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = piece.w * cellPx + (piece.w - 1) * gapPx;
  const h = piece.h * cellPx + (piece.h - 1) * gapPx;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const m = MINERALS[color - 1];
  for (const [r, c] of piece.cells) {
    const x = c * (cellPx + gapPx), y = r * (cellPx + gapPx);
    ctx.fillStyle = m.fill;
    roundRect(ctx, x, y, cellPx, cellPx, Math.max(3, cellPx * 0.12));
    ctx.fill();
    ctx.strokeStyle = m.top;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 1.5, y + cellPx * 0.5);
    ctx.lineTo(x + 1.5, y + 4);
    ctx.lineTo(x + cellPx * 0.5, y + 1.5);
    ctx.stroke();
  }
  return { w, h };
}
