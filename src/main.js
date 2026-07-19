// Fault Lines — app orchestrator: screens, drag input, daily flow, persistence.
import * as E from './engine.js';
import { BoardRenderer, drawPieceSprite } from './render.js';
import * as SFX from './audio.js';
import * as Share from './share.js';
import * as Net from './net.js';
import { initAds } from './ads.js';
import * as Notify from './notify.js';
import * as Portal from './portal.js';

const $ = id => document.getElementById(id);
const cfg = window.FL_CONFIG || {};
// Share destination per platform: the native app advertises its App Store page
// (shared cards should convert to installs), the web build keeps the web URL,
// portal builds must not point players off-site at all.
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const SHARE_URL = window.FL_PORTAL ? ''
  : IS_NATIVE ? 'apps.apple.com/app/id6789700779'
  : (cfg.shareUrl || 'guvenser09-png.github.io/unbury');

function load(key, fallback) {
  try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key)) || {}) }; }
  catch { return { ...fallback }; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

const settings = load('fl_settings', {
  sound: true, haptics: true, shake: true, reducedMotion:
    window.matchMedia('(prefers-reduced-motion: reduce)').matches, dragOffset: 72,
});

const app = {
  images: [], dateStr: '', faultNo: 0, seed: 0, image: null, obstacles: [],
  mode: null, game: null, counted: false, runStart: 0, runSeed: 0,
  endless: null, // this week's league snapshot from the server
  server: null, bombMode: false, paused: false,
  streak: load('fl_streak', { count: 0, best: 0, lastDate: null }),
  endlessBest: Number(localStorage.getItem('fl_endless_best') || 0),
  lastResult: null,
};

let renderer = null;

// ---------- boot ----------

function todayUTC() { return new Date().toISOString().slice(0, 10); }

async function boot() {
  // ?fresh=1 — wipe this device's local state after an explicit confirm
  // (testing/support tool; the confirm blocks drive-by wipe links)
  if (new URLSearchParams(location.search).has('fresh')) {
    history.replaceState(null, '', location.pathname);
    if (confirm('Start completely fresh on this device? Local progress, streak and name will be reset.')) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('fl_')) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
    }
  }
  await Portal.init();
  Portal.onMuteChange(m => { portalMuted = m; SFX.setEnabled(!m && settings.sound); });
  Portal.loadingStart();
  initAds();
  $('boot-bar').style.width = '30%';
  try {
    const res = await fetch('src/data/images.json');
    app.images = (await res.json()).images;
  } catch {
    app.images = [FALLBACK_IMAGE];
  }
  $('boot-bar').style.width = '60%';

  app.dateStr = todayUTC();
  app.faultNo = E.faultNumber(app.dateStr);
  const seedInfo = await E.deriveDailySeed(app.dateStr);
  app.seed = seedInfo.seed;
  app.answerIndex = (app.faultNo - 1 + app.images.length * 1000) % app.images.length;
  app.image = app.images[app.answerIndex];
  app.obstacles = app.image.obstacles;
  $('boot-bar').style.width = '85%';

  const onFlushed = (item, res) => {
    if (item.dateStr === app.dateStr && res.percentile != null) {
      const rec = dailyRecord();
      if (rec) {
        rec.percentile = res.percentile;
        rec.rank = res.rank != null ? res.rank : null;
        rec.players = res.players != null ? res.players : null;
        save('fl_daily', rec);
      }
      const label = rankLabel(res.rank, res.players, res.percentile);
      // if the result panel is still open, replace the stuck "Syncing…" chip
      if (!$('ov-gameover').classList.contains('hidden') && label) {
        $('go-percentile').textContent = `🏆 ${label}`;
      }
      toast(`Synced! ${label || 'Score verified'}`);
      renderHome();
    }
  };
  Net.flushQueue(onFlushed);
  window.addEventListener('online', () => Net.flushQueue(onFlushed));
  Net.getEndless().then(res => {
    if (res && !res.error) { app.endless = res; renderHome(); }
  });
  syncEndless(null); // retry a stranded league run from a previous session
  window.addEventListener('online', () => syncEndless(null));
  Net.getDaily(app.dateStr).then(info => {
    if (info && !info.error) {
      app.server = info;
      if (info.streak != null) {
        app.streak.count = info.streak;
        app.streak.best = Math.max(app.streak.best, info.best_streak || 0);
        save('fl_streak', app.streak);
      }
      // rehydrate the name if this browser lost its local copy
      if (info.name && !localStorage.getItem('fl_name')) {
        localStorage.setItem('fl_name', info.name);
        localStorage.setItem('fl_name_prompted', '1');
      }
      const rec = dailyRecord();
      if (rec && info.percentile != null && (rec.percentile == null || rec.rank == null)) {
        rec.percentile = info.percentile;
        rec.rank = info.rank != null ? info.rank : null;
        rec.players = info.players != null ? info.players : null;
        save('fl_daily', rec);
      }
      renderHome();
    }
  });

  bindUI();
  // refresh the 7-evening reminder plan; skips today once it's played
  Notify.reschedule({ playedToday: !!dailyRecord(), streak: app.streak.count });
  $('boot-bar').style.width = '100%';
  Portal.loadingStop();
  setTimeout(() => {
    renderHome();
    show('s-home');
  }, 250);
  setInterval(tickCountdown, 1000);
  tickCountdown();
}

const FALLBACK_IMAGE = {
  id: 'seam', name: 'THE SEAM', category: 'object', caption: 'The first crack is always free.',
  palette: ['#141924', '#FFB020', '#F2F5F9', '#39424E'],
  px: Array.from({ length: 256 }, (_, i) => (i % 17 === 0 ? 1 : i % 23 === 0 ? 3 : 0)),
  obstacles: [3, 10, 12, 19, 21, 28, 35, 37, 42, 44, 49, 51, 58, 60],
};

// ---------- screens ----------

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function dailyRecord() {
  try {
    const rec = JSON.parse(localStorage.getItem('fl_daily') || 'null');
    return rec && rec.date === app.dateStr ? rec : null;
  } catch { return null; }
}

function attemptRecord() {
  try {
    const rec = JSON.parse(localStorage.getItem('fl_attempt') || 'null');
    return rec && rec.date === app.dateStr ? rec : null;
  } catch { return null; }
}

function renderHome() {
  $('fault-no').textContent = '#' + app.faultNo;
  $('fault-date').textContent = new Date(app.dateStr + 'T00:00:00Z')
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  $('streak-num').textContent = app.streak.count;
  $('endless-best').textContent = 'All-time best: ' + app.endlessBest.toLocaleString('en-US');
  const en = app.endless;
  if (en && !en.error) {
    $('endless-reset').textContent = en.resetsAt ? resetLabel(en.resetsAt) : '';
    if (en.best > 0 && en.rank) {
      $('endless-rank').textContent = `This week: ${en.best.toLocaleString('en-US')} · #${en.rank}`;
      $('endless-rank').style.color = 'var(--success)';
    } else {
      $('endless-rank').textContent = (en.players || 0) > 0
        ? `${en.players.toLocaleString('en-US')} in this week's league` : 'Be first on the board this week';
    }
  }

  const rec = dailyRecord();
  const att = attemptRecord();
  if (rec) {
    drawArt($('home-art'), app.image, rec.revealed);
    const label = rankLabel(rec.rank, rec.players, rec.percentile);
    const pct = label ? ` — ${label}` : '';
    $('daily-status').innerHTML = `You scored <b style="color:var(--accent)">${rec.score.toLocaleString('en-US')}</b>${pct}`;
    $('btn-daily').textContent = 'PRACTICE AGAIN';
    $('btn-share-home').classList.remove('hidden');
  } else {
    drawArt($('home-art'), app.image, new Uint8Array(64));
    $('daily-status').textContent = 'Something is hiding under today’s board…';
    $('btn-daily').textContent = att ? 'RESUME RUN' : 'PLAY TODAY’S DAILY';
    $('btn-share-home').classList.add('hidden');
  }
}

function tickCountdown() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  let s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  const el = $('countdown');
  if (el) el.textContent = `${h}:${m}:${sec}`;
  if (app.dateStr && todayUTC() !== app.dateStr && !app.game) location.reload();
}

// Draw 16x16 art with per-board-cell reveal mask onto a square canvas.
function drawArt(canvas, image, revealed) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cell = size / 8;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#1A2029';
  ctx.fillRect(0, 0, size, size);
  for (let bc = 0; bc < 64; bc++) {
    const r = Math.floor(bc / 8), c = bc % 8;
    const x = c * cell, y = r * cell;
    if (revealed[bc]) {
      const half = cell / 2;
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
        ctx.fillStyle = image.palette[image.px[(r * 2 + dr) * 16 + (c * 2 + dc)]];
        ctx.fillRect(x + dc * half, y + dr * half, half, half);
      }
    } else {
      ctx.fillStyle = '#39424E';
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      ctx.fillStyle = '#414B58';
      ctx.fillRect(x + 2 + ((bc * 37) % (cell - 6)), y + 2 + ((bc * 53) % (cell - 6)), 3, 3);
    }
  }
}

// ---------- game lifecycle ----------

function startGame(mode) {
  SFX.unlock();
  app.mode = mode;
  app.counted = mode === 'daily';
  const endless = mode === 'endless';
  let seed = app.seed;
  if (endless) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    seed = buf[0];
  }
  app.runSeed = seed;
  app.game = E.createGame({
    seed,
    obstacles: endless ? [] : app.obstacles,
    daily: !endless,
    answerIndex: endless ? null : app.answerIndex,
  });

  if (mode === 'daily') {
    const att = attemptRecord();
    if (att) {
      let ok = true;
      for (const m of att.moves) {
        const ev = E.applyMove(app.game, m);
        if (ev.error) { ok = false; break; }
      }
      if (!ok) {
        // content/version skew — the saved moves no longer replay cleanly
        localStorage.removeItem('fl_attempt');
        app.game = E.createGame({ seed, obstacles: app.obstacles, daily: true, answerIndex: app.answerIndex });
      }
    }
  }

  if (!renderer) {
    renderer = new BoardRenderer($('board'), {
      getState: () => app.game,
      getImage: () => (app.mode === 'endless' ? null : app.image),
      settings: () => settings,
    });
  }
  const wrapW = Math.min(document.body.clientWidth, 480) - 32;
  renderer.resize(wrapW);
  renderer.ghost = null;
  renderer.gameOverCrack = 0;
  $('board').classList.remove('dimmed');
  renderer.start();

  $('practice-band').classList.toggle('hidden', mode !== 'practice');
  $('reveal-meter').style.display = endless ? 'none' : '';
  $('reveal-pct').style.display = endless ? 'none' : '';
  $('score-sub').textContent = endless ? 'BEST ' + app.endlessBest.toLocaleString('en-US') : 'DIG #' + app.faultNo;
  $('bomb-hint').classList.add('hidden');
  app.bombMode = false;
  app.bestBeaten = false;
  app.runStart = Date.now();
  lastMilestone = app.mode === 'daily' ? E.revealPct(app.game) : 0;
  show('s-game');
  Portal.gameplayStart();
  updateHUD();
  renderTray();
  updateRerollBtn();
  // first-ever game: loop the drag gesture demo until they grab a piece
  if (!localStorage.getItem('fl_hand_done')) $('tut-hand').classList.remove('hidden');
  if (app.game.over) gameOverFlow();
}

function updateHUD() {
  const g = app.game;
  const scoreEl = $('score');
  const subEl = $('score-sub');
  scoreEl.textContent = g.score.toLocaleString('en-US');
  if (app.mode !== 'endless') {
    const pct = E.revealPct(g);
    $('reveal-fill').style.width = pct + '%';
    $('reveal-pct').textContent = pct + '%';
    const showGuess = !g.over && !g.guessUsed && g.answerIndex != null && pct >= 20;
    $('btn-guess').classList.toggle('hidden', !showGuess);
    if (showGuess) $('btn-guess').textContent = `🔍 I KNOW WHAT IT IS · +${(100 - pct) * 2}`;
    scoreEl.style.color = '';
    subEl.style.color = '';
  } else {
    $('btn-guess').classList.add('hidden');
    // record-chase tension: live gap to the personal best, gold when close,
    // one-shot celebration the moment the record actually falls
    const best = app.endlessBest;
    if (best > 0 && g.score > best) {
      if (!app.bestBeaten) {
        app.bestBeaten = true;
        SFX.fullClear();
        toast('🏆 NEW BEST!');
        if (renderer) {
          renderer.goldFlash = performance.now();
          renderer.float(27, 'NEW BEST!', performance.now(), '#3DDC97');
        }
      }
      subEl.textContent = `🏆 NEW BEST · +${(g.score - best).toLocaleString('en-US')}`;
      subEl.style.color = 'var(--success)';
      scoreEl.style.color = 'var(--success)';
    } else if (best > 0) {
      const gap = best - g.score;
      subEl.textContent = `${gap.toLocaleString('en-US')} TO BEAT`;
      const near = g.score >= best * 0.85;
      subEl.style.color = near ? 'var(--accent)' : '';
      scoreEl.style.color = near ? 'var(--accent)' : '';
    } else {
      subEl.textContent = 'FIRST RUN — SET THE BAR';
      subEl.style.color = '';
      scoreEl.style.color = '';
    }
  }
}

function updateRerollBtn() {
  const g = app.game;
  const btn = $('btn-reroll');
  btn.style.opacity = g.rerollUsed || g.over ? '.35' : '1';
  // ad wording only where an ad SDK actually exists (portal builds)
  const hasAds = !!(window.FL_SDK && window.FL_SDK.requestRewarded);
  $('reroll-badge').textContent = hasAds
    ? (localStorage.getItem('fl_reroll_taught') ? '▶ ×1' : 'FREE ×1')
    : '×1';
}

function renderTray() {
  const boardCell = renderer ? renderer.cell : 40;
  document.querySelectorAll('.slot').forEach(slot => {
    const i = Number(slot.dataset.slot);
    const canvas = slot.querySelector('canvas');
    const item = app.game.tray[i];
    slot.classList.remove('dragging');
    if (!item) {
      canvas.width = canvas.height = 0;
      slot.classList.remove('unfit', 'warn');
      return;
    }
    const piece = E.PIECES[item.piece];
    const maxCell = Math.min(boardCell * 0.62, (slot.clientWidth - 16) / piece.w, (slot.clientHeight - 16) / piece.h);
    drawPieceSprite(canvas, piece, item.color, Math.max(10, maxCell), 2);
    slot.classList.toggle('unfit', !E.slotFits(app.game, i));
  });
  // amber pulse when exactly one slot still fits
  const fitting = [0, 1, 2].filter(i => app.game.tray[i] && E.slotFits(app.game, i));
  document.querySelectorAll('.slot').forEach(slot => {
    slot.classList.toggle('warn', fitting.length === 1 && Number(slot.dataset.slot) === fitting[0]);
  });
}

function autosave(force) {
  // the fatal move is persisted too (force) — otherwise force-quitting on the
  // game-over screen would replay into a free undo of the losing placement
  if (app.counted && (!app.game.over || force)) {
    save('fl_attempt', { date: app.dateStr, moves: app.game.moves });
  }
}

// ---------- drag input ----------

const drag = { active: false, slot: -1, w: 0, h: 0, piece: null, color: 0, target: null, pointerType: 'touch' };
const dragEl = $('drag-piece');
const dragCanvas = dragEl.querySelector('canvas');

function bindDrag() {
  document.querySelectorAll('.slot').forEach(slot => {
    slot.addEventListener('pointerdown', e => {
      if (app.paused || app.bombMode || !app.game || app.game.over) return;
      if (drag.active) cancelDrag(); // stale drag from a lost pointer — reset first
      const i = Number(slot.dataset.slot);
      const item = app.game.tray[i];
      if (!item) return;
      e.preventDefault();
      try { slot.setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
      drag.active = true;
      drag.slot = i;
      drag.piece = E.PIECES[item.piece];
      drag.color = item.color;
      drag.pointerType = e.pointerType;
      const dim = drawPieceSprite(dragCanvas, drag.piece, item.color, renderer.cell, renderer.gap);
      drag.w = dim.w; drag.h = dim.h;
      drag.blockers = [];
      dragEl.classList.remove('hidden', 'returning');
      slot.classList.add('dragging');
      renderer.dragging = true;
      if (!localStorage.getItem('fl_hand_done')) {
        localStorage.setItem('fl_hand_done', '1');
        $('tut-hand').classList.add('hidden');
      }
      SFX.pickup();
      moveDrag(e);
    });
    slot.addEventListener('pointermove', e => { if (drag.active && Number(slot.dataset.slot) === drag.slot) moveDrag(e); });
    slot.addEventListener('pointerup', e => { if (drag.active && Number(slot.dataset.slot) === drag.slot) endDrag(e); });
    slot.addEventListener('pointercancel', () => cancelDrag());
  });
  // safety net: capture can be lost (release outside the window, OS gestures,
  // devtools) — never leave a drag stuck to the cursor
  window.addEventListener('pointermove', e => { if (drag.active) moveDrag(e); });
  window.addEventListener('pointerup', () => { if (drag.active) endDrag(); });
  window.addEventListener('pointercancel', () => { if (drag.active) cancelDrag(); });
  window.addEventListener('blur', () => { if (drag.active) cancelDrag(); });
}

function dragAnchor(e) {
  const offset = drag.pointerType === 'mouse' ? 0 : settings.dragOffset;
  return { x: e.clientX, y: e.clientY - offset };
}

function moveDrag(e) {
  const a = dragAnchor(e);
  const left = a.x - drag.w / 2, top = a.y - drag.h / 2;
  dragEl.style.transform = `translate(${left}px, ${top}px)`;

  const rect = $('board').getBoundingClientRect();
  const step = renderer.cell + renderer.gap;
  const col = Math.round((left - rect.left - renderer.pad) / step);
  const row = Math.round((top - rect.top - renderer.pad) / step);
  const valid = E.canPlace(app.game, pieceIndex(drag.piece), row, col);
  if (row > -3 && col > -3 && row < 10 && col < 10) {
    const cells = drag.piece.cells.map(([r, c]) => (row + r) * 8 + (col + c));
    const glow = valid ? wouldClear(cells) : { rows: [], cols: [] };
    renderer.ghost = valid
      ? { cells, valid: true, glowRows: glow.rows, glowCols: glow.cols, color: drag.color }
      : null;
    drag.target = valid ? { row, col } : null;
  } else {
    renderer.ghost = null;
    drag.target = null;
  }

  // when hovering an illegal spot over the board, remember which occupied
  // cells block it and tint the dragged piece red — "not here" at a glance
  const inBoard = row > -2 && col > -2 && row < 9 && col < 9;
  drag.blockers = [];
  if (inBoard && !valid) {
    for (const [r, c] of drag.piece.cells) {
      const rr = row + r, cc = col + c;
      if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const idx = rr * 8 + cc;
        if (app.game.board[idx] !== 0) drag.blockers.push(idx);
      }
    }
  }
  dragEl.style.filter = inBoard && !valid ? 'drop-shadow(0 0 8px rgba(255,90,103,0.85))' : '';
}

function pieceIndex(piece) { return E.PIECES.indexOf(piece); }

function wouldClear(cells) {
  const b = app.game.board;
  const rows = [], cols = [];
  for (let r = 0; r < 8; r++) {
    let full = true;
    for (let c = 0; c < 8; c++) {
      const idx = r * 8 + c;
      if (b[idx] === 0 && !cells.includes(idx)) { full = false; break; }
    }
    if (full) rows.push(r);
  }
  for (let c = 0; c < 8; c++) {
    let full = true;
    for (let r = 0; r < 8; r++) {
      const idx = r * 8 + c;
      if (b[idx] === 0 && !cells.includes(idx)) { full = false; break; }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

function endDrag() {
  if (!drag.active) return;
  const target = drag.target;
  drag.active = false;
  renderer.ghost = null;
  renderer.dragging = false;
  dragEl.style.filter = '';
  document.querySelectorAll('.slot').forEach(s => s.classList.remove('dragging'));

  if (target) {
    dragEl.classList.add('hidden');
    const ev = E.applyMove(app.game, { t: 'p', i: drag.slot, x: target.col, y: target.row });
    if (ev.error) { SFX.invalid(); renderTray(); return; }
    handleMoveEvent(ev);
  } else {
    dragEl.classList.add('returning');
    if (drag.blockers && drag.blockers.length) {
      // the drop was refused by occupied cells: buzz, flash the culprits red,
      // nudge the board — the player must FEEL the "no"
      SFX.reject();
      renderer.flashReject(drag.blockers);
      if (settings.shake && !settings.reducedMotion) {
        renderer.shake = { mag: 2, t0: performance.now(), dur: 110 };
      }
      const hasRock = drag.blockers.some(i => app.game.board[i] === E.OBSTACLE);
      if (hasRock && !localStorage.getItem('fl_rock_tip')) {
        localStorage.setItem('fl_rock_tip', '1');
        toast('💡 Rocks can’t hold pieces — fill their row or column to break them');
      }
    } else {
      SFX.invalid();
    }
    setTimeout(() => dragEl.classList.add('hidden'), 190);
  }
}

function cancelDrag() {
  drag.active = false;
  renderer.ghost = null;
  renderer.dragging = false;
  dragEl.style.filter = '';
  dragEl.classList.add('hidden');
  document.querySelectorAll('.slot').forEach(s => s.classList.remove('dragging'));
  renderTray();
}

// The engine caps runs at MAX_MOVES. Finish the run one move early (room for
// the closing 'end' move) instead of letting the board silently refuse input.
function capGuard() {
  const g = app.game;
  if (!g || g.over || g.ended) return false;
  if (g.moves.length >= E.MAX_MOVES - 1) {
    g.over = true;
    toast('⛏️ 400 moves — the vault is full! Banking your run.');
    setTimeout(() => gameOverFlow(), 600);
    return true;
  }
  return false;
}

function handleMoveEvent(ev) {
  const now = performance.now();
  renderer.playPlacement(ev, now);
  SFX.place();
  if (ev.clearedCells.length > 0) {
    const L = ev.clearedRows.length + ev.clearedCols.length;
    SFX.clear(ev.combo, L);
    if (ev.obstacleCells.length > 0) SFX.obstacleBreak();
    const pct = E.revealPct(app.game);
    checkMilestone(pct);
  }
  if (ev.fullClear) { SFX.fullClear(); toast('FAULT SEALED! +300'); }
  updateHUD();
  renderTray();
  updateRerollBtn();
  autosave(ev.gameOver);
  if (ev.gameOver) setTimeout(() => gameOverFlow(), 650);
  else capGuard();
}

let lastMilestone = 0;
function checkMilestone(pct) {
  for (const m of [25, 50, 75, 100]) {
    if (pct >= m && lastMilestone < m) {
      lastMilestone = m;
      if (m === 100) { SFX.revealFinale(); toast('FULLY REVEALED!'); Portal.happytime(); }
      else { SFX.milestone(); toast(m === 50 ? `${m}% — it's ${app.image.category}…` : `${m}% revealed`); }
    }
  }
}

// ---------- guess layer ----------

function openGuess() {
  const g = app.game;
  if (!g || g.guessUsed || g.over) return;
  SFX.button();
  // deterministic decoys: same six options for every player, every load
  const rng = E.mulberry32((app.seed ^ 0x9e3779b9) >>> 0);
  const n = app.images.length;
  const picks = [app.answerIndex];
  let guard = 0;
  while (picks.length < Math.min(6, n) && guard++ < 300) {
    const idx = Math.floor(rng() * n);
    if (!picks.includes(idx)) picks.push(idx);
  }
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = picks[i]; picks[i] = picks[j]; picks[j] = tmp;
  }
  $('guess-stakes').innerHTML =
    `Right: <b style="color:var(--success)">+${(100 - E.revealPct(g)) * 2}</b> &nbsp;·&nbsp; Wrong: <b style="color:var(--danger)">−${E.GUESS_PENALTY}</b> and the hunt ends.`;
  const wrap = $('guess-options');
  wrap.innerHTML = '';
  for (const idx of picks) {
    const btn = document.createElement('button');
    btn.className = 'guess-option';
    btn.textContent = app.images[idx].name;
    btn.addEventListener('click', () => doGuess(idx));
    wrap.appendChild(btn);
  }
  $('ov-guess').classList.remove('hidden');
}

function doGuess(pick) {
  $('ov-guess').classList.add('hidden');
  if (!app.game || app.game.guessUsed) return; // double-tap on two options
  const ev = E.applyMove(app.game, { t: 'g', pick });
  if (ev.error) { toast(ev.error); return; }
  const now = performance.now();
  if (ev.correct) {
    SFX.fullClear();
    Portal.happytime();
    if (renderer) {
      renderer.goldFlash = now;
      renderer.float(27, `🔍 +${ev.bonus}`, now, '#3DDC97');
    }
    toast(`🔍 Nailed it at ${ev.atPct}% — +${ev.bonus}!`);
  } else {
    SFX.invalid();
    if (renderer) renderer.float(27, ev.penalty > 0 ? `🔍 −${ev.penalty}` : '🔍 ✗', now, '#FF5A67');
    toast(ev.penalty > 0 ? `Not quite — the wager cost you ${ev.penalty}` : 'Not quite — keep digging');
  }
  updateHUD();
  autosave();
}

// ---------- digger name ----------

const NAME_A = ['Amber', 'Copper', 'Quartz', 'Jade', 'Cobalt', 'Onyx', 'Flint', 'Slate', 'Ruby', 'Basalt', 'Golden', 'Crystal', 'Iron', 'Silver', 'Magma', 'Fossil'];
const NAME_B = ['Fox', 'Mole', 'Otter', 'Badger', 'Raven', 'Lynx', 'Digger', 'Miner', 'Owl', 'Wolf', 'Beetle', 'Turtle', 'Falcon', 'Bear', 'Gecko', 'Marmot'];

// Deterministic per device: the suggested name is always the same on this
// device, so a returning player who skipped saving still sees a familiar name.
function genName() {
  const k = localStorage.getItem('fl_device_key') || 'seed';
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  // unsigned shifts only — a signed >> on a large hash goes negative and
  // indexes past the array ("Silverundefined", never forget)
  return NAME_A[(h >>> 8) % NAME_A.length] + NAME_B[(h >>> 4) % NAME_B.length];
}

function randName() {
  return NAME_A[Math.floor(Math.random() * NAME_A.length)] + NAME_B[Math.floor(Math.random() * NAME_B.length)];
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function openNamePrompt() {
  $('name-input').value = localStorage.getItem('fl_name') || (app.server && app.server.name) || genName();
  $('ov-name').classList.remove('hidden');
}

async function saveName() {
  const val = $('name-input').value.trim();
  if (val.length < 2) { toast('At least 2 characters'); return; }
  $('btn-name-save').textContent = 'SAVING…';
  const res = await Net.setName(val);
  $('btn-name-save').textContent = 'SAVE NAME';
  if (res && !res.error && res.name) {
    localStorage.setItem('fl_name', res.name);
    localStorage.setItem('fl_name_prompted', '1');
    $('ov-name').classList.add('hidden');
    toast(`⛏️ Welcome, ${res.name}!`);
    Net.getDaily(app.dateStr).then(info => { if (info && !info.error) app.server = info; });
  } else if (res && res.error === 'name rejected') {
    toast('That name won’t fly — try another');
  } else {
    toast('Couldn’t save — check connection');
  }
}

// ---------- rewarded stubs (portal adapter) ----------

async function adFlow() {
  // window.FL_SDK.requestRewarded resolves true = grant, false = no grant.
  // Each backend sets its own failure policy in ads.js — portal rules forbid
  // granting the reward on ad errors. Without any ad backend the perks are
  // simply free features and no ad language is shown anywhere.
  if (window.FL_SDK && window.FL_SDK.requestRewarded) {
    SFX.adPause(); // free the audio session — iOS can stall the ad video otherwise
    try { return await window.FL_SDK.requestRewarded(); }
    catch { return false; }
    finally { SFX.adResume(); }
  }
  return true;
}

// ---------- game over ----------

async function gameOverFlow() {
  const g = app.game;
  if (!g || !g.over) return;
  Portal.gameplayStop();
  SFX.gameOver();
  renderer.gameOverCrack = performance.now();
  $('board').classList.add('dimmed');
  await sleep(1100);
  if (app.game !== g) return; // player left for home/another run mid-pause

  // no bomb offer at the move cap — there'd be no room left to close the run
  if (!g.bombUsed && app.mode !== 'endless' && g.moves.length < E.MAX_MOVES - 1) {
    $('ov-gameover').classList.remove('hidden');
    $('go-step-bomb').classList.remove('hidden');
    $('go-step-result').classList.add('hidden');
    return; // continues via bomb buttons
  }
  finalizeRun();
}

async function bombAccept() {
  const ok = await adFlow();
  if (!ok) { toast('No ad available right now'); bombDecline(); return; }
  $('ov-gameover').classList.add('hidden');
  $('go-step-bomb').classList.add('hidden');
  app.bombMode = true;
  Portal.gameplayStart();
  $('bomb-hint').classList.remove('hidden');
  $('board').classList.remove('dimmed');
  renderer.gameOverCrack = 0;
}

function bombDecline() {
  $('go-step-bomb').classList.add('hidden');
  finalizeRun();
}

function bombTap(e) {
  const rect = $('board').getBoundingClientRect();
  const step = renderer.cell + renderer.gap;
  const col = Math.min(6, Math.max(1, Math.floor((e.clientX - rect.left - renderer.pad) / step)));
  const row = Math.min(6, Math.max(1, Math.floor((e.clientY - rect.top - renderer.pad) / step)));
  const ev = E.applyMove(app.game, { t: 'bomb', x: col, y: row });
  if (ev.error) return;
  app.bombMode = false;
  $('bomb-hint').classList.add('hidden');
  SFX.bomb();
  renderer.playBomb(ev, performance.now());
  updateHUD();
  renderTray();
  autosave();
  if (ev.gameOver) setTimeout(() => gameOverFlow(), 700);
  else if (!capGuard()) toast('Back in business');
}

async function finalizeRun() {
  const g = app.game;
  if (!g || !g.over) return; // never finalize a game that isn't actually over
  Portal.gameplayStop();
  if (!g.ended) E.applyMove(g, { t: 'end' });
  const durationMs = Date.now() - app.runStart;
  const pct = E.revealPct(g);
  const revealed = Array.from(g.revealed);
  app.lastResult = { score: g.score, revealPct: pct, revealed, maxCombo: g.maxCombo, lines: g.linesCleared };

  let percentile = null, rank = null, players = null;
  let submittedNow = false;
  let endlessSync = false;

  if (app.mode === 'endless') {
    if (g.score > app.endlessBest) {
      app.endlessBest = g.score;
      localStorage.setItem('fl_endless_best', String(g.score));
    }
    // the panel must open instantly: queue the run, sync in the background,
    // and patch the rank chip in place when the server answers
    if (Net.isOnlineMode() && g.score > 0) {
      queueEndless({ seed: app.runSeed, moves: g.moves, score: g.score, durationMs, savedAt: Date.now() });
      endlessSync = true;
      syncEndless(g);
    }
  } else if (app.counted) {
    localStorage.removeItem('fl_attempt');
    bumpLocalStreak();
    const rec = {
      date: app.dateStr, score: g.score, revealPct: pct, revealed,
      percentile: null, moves: g.moves, guessedAt: g.guessedAtPct,
    };
    save('fl_daily', rec);
    submittedNow = true;
    if (Net.isOnlineMode()) {
      const res = await Net.submitRun(app.dateStr, g.moves, g.score, pct, durationMs);
      if (res && !res.error && res.percentile != null) {
        percentile = res.percentile;
        rank = res.rank != null ? res.rank : null;
        players = res.players != null ? res.players : null;
        rec.percentile = percentile;
        rec.rank = rank;
        rec.players = players;
        save('fl_daily', rec);
        if (res.streak != null) {
          app.streak.count = res.streak;
          app.streak.best = Math.max(app.streak.best, res.best_streak || 0);
          save('fl_streak', app.streak);
        }
        app.server = { ...(app.server || {}), players: res.players, played: true, percentile };
        // nobody stays "Digger" on the wall: auto-claim this device's name
        if (!localStorage.getItem('fl_name') && !(app.server && app.server.name)) {
          Net.setName(genName()).then(r => {
            if (r && !r.error && r.name) localStorage.setItem('fl_name', r.name);
          });
        }
        Net.getDaily(app.dateStr).then(info => { if (info && !info.error) app.server = info; });
      } else {
        Net.queueSubmission({ dateStr: app.dateStr, moves: g.moves, score: g.score, revealPctVal: pct, durationMs });
      }
    }
  } else {
    const best = Number(localStorage.getItem('fl_practice_best_' + app.dateStr) || 0);
    if (g.score > best) localStorage.setItem('fl_practice_best_' + app.dateStr, String(g.score));
  }

  showResultPanel({ percentile, rank, players, submittedNow, endlessSync });
}

// "resets in 3d 14h" — from the league's resetsAt timestamp
function resetLabel(resetsAt) {
  const ms = Date.parse(resetsAt) - Date.now();
  if (!(ms > 0)) return 'new week — fresh board';
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  if (d > 0) return `resets in ${d}d ${h}h`;
  return h > 0 ? `resets in ${h}h` : 'resets in <1h';
}

// Monday-00:00-UTC week key — must mirror the server's weekInfo()
function weekKeyOf(t) {
  const d = new Date(t);
  const dayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(dayMs - ((new Date(dayMs).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

// Best unsubmitted endless run of the week survives reloads and flaky networks.
function queueEndless(p) {
  let cur = null;
  try { cur = JSON.parse(localStorage.getItem('fl_endless_pending') || 'null'); } catch { /* corrupt — replace */ }
  if (!cur || p.score > cur.score) localStorage.setItem('fl_endless_pending', JSON.stringify(p));
}

let endlessSyncing = false;
async function syncEndless(gameRef) {
  let p = null;
  try { p = JSON.parse(localStorage.getItem('fl_endless_pending') || 'null'); } catch { /* corrupt */ }
  if (!p || endlessSyncing) return;
  if (weekKeyOf(p.savedAt) !== weekKeyOf(Date.now())) {
    localStorage.removeItem('fl_endless_pending'); // last week's run — that league is closed
    return;
  }
  endlessSyncing = true;
  const panelOpen = () => gameRef && app.game === gameRef && !$('ov-gameover').classList.contains('hidden');
  try {
    const res = await Net.submitEndless(p.seed, p.moves, p.score, p.durationMs);
    if (res && !res.error && res.verified) {
      localStorage.removeItem('fl_endless_pending');
      app.endless = res;
      renderHome();
      // league-only players deserve a name on the wall too
      if (!localStorage.getItem('fl_name') && !(app.server && app.server.name)) {
        Net.setName(genName()).then(r => {
          if (r && !r.error && r.name) localStorage.setItem('fl_name', r.name);
        });
      }
      if (panelOpen() && res.rank) {
        $('go-percentile').textContent = `🏆 #${res.rank} this week` + (res.players > 1 ? ` of ${res.players.toLocaleString('en-US')}` : '');
        $('go-streak').textContent = `Weekly best: ${(res.best || p.score).toLocaleString('en-US')}`;
      }
    } else if (res && res.error && !/timeout|fetch|network|http 5/i.test(String(res.error))) {
      localStorage.removeItem('fl_endless_pending'); // permanent rejection — drop, never loop
      if (panelOpen()) $('go-percentile').textContent = '🏆 Score banked locally';
    } else {
      // transient failure — pending stays; boot/reconnect retries it
      if (panelOpen()) $('go-percentile').textContent = '📶 League sync pending…';
    }
  } finally {
    endlessSyncing = false;
  }
}

// Adaptive rank display: small player counts and top finishers get the exciting
// direct rank; everyone else gets the shame-free percentile.
function rankLabel(rank, players, percentile) {
  if (rank == null || !players) return percentile != null ? `Top ${percentile}%` : null;
  if (players < 100) return `#${rank} of ${players} today`;
  if (rank <= 100) return `#${rank} in the world`;
  return percentile != null ? `Top ${percentile}%` : null;
}

function bumpLocalStreak() {
  const yesterday = new Date(Date.parse(app.dateStr + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  if (app.streak.lastDate === app.dateStr) return;
  app.streak.count = app.streak.lastDate === yesterday ? app.streak.count + 1 : 1;
  app.streak.best = Math.max(app.streak.best, app.streak.count);
  app.streak.lastDate = app.dateStr;
  save('fl_streak', app.streak);
}

function showResultPanel({ percentile, rank, players, submittedNow, endlessSync }) {
  const g = app.game;
  const endless = app.mode === 'endless';
  $('ov-gameover').classList.remove('hidden');
  $('go-step-bomb').classList.add('hidden');
  $('go-step-result').classList.remove('hidden');

  $('go-reveal-wrap').style.display = endless ? 'none' : '';
  $('go-reveal-line').style.display = endless ? 'none' : '';
  if (!endless) {
    drawArt($('go-art'), app.image, g.revealed);
    const pct = E.revealPct(g);
    animateNumber($('go-reveal-pct'), pct, v => v + '%', 900);
    const full = pct === 100;
    $('go-plaque').classList.toggle('hidden', !full);
    $('go-caption').classList.toggle('hidden', !full);
    if (full) {
      $('go-plaque').textContent = `DIG #${app.faultNo}: ${app.image.name}`;
      $('go-caption').textContent = app.image.caption;
    }
  }

  animateNumber($('go-score'), g.score, v => v.toLocaleString('en-US'), 900);
  let guessBit = '';
  if (g.guessedAtPct != null) guessBit = ` · 🔍 named it at ${g.guessedAtPct}% (+${g.guessBonus})`;
  else if (g.guessUsed) guessBit = ` · 🔍 wrong guess (−${E.GUESS_PENALTY})`;
  $('go-stats').textContent = `biggest combo ×${g.maxCombo} · ${g.linesCleared} lines${guessBit}`;

  const pctEl = $('go-percentile');
  if (app.mode === 'daily') {
    pctEl.classList.remove('hidden');
    const label = rankLabel(rank, players, percentile);
    if (label) pctEl.textContent = `🏆 ${label}`;
    else if (Net.isOnlineMode()) pctEl.textContent = '📶 Syncing…';
    else pctEl.textContent = '🏆 Score banked';
    $('go-streak').textContent = submittedNow ? `🔥 Streak: ${app.streak.count} day${app.streak.count > 1 ? 's' : ''}` : '';
  } else {
    pctEl.classList.add('hidden');
    if (app.mode === 'practice') {
      const best = Number(localStorage.getItem('fl_practice_best_' + app.dateStr) || 0);
      $('go-streak').textContent = `Practice best: ${best.toLocaleString('en-US')}`;
    } else if (endlessSync) {
      pctEl.classList.remove('hidden');
      pctEl.textContent = '📶 Syncing…'; // syncEndless patches this in place
      $('go-streak').textContent = (g.score >= app.endlessBest ? '⭐ New best! · ' : '') +
        `Best: ${app.endlessBest.toLocaleString('en-US')}`;
    } else {
      $('go-streak').textContent = g.score >= app.endlessBest ? '⭐ New best!' : `Best: ${app.endlessBest.toLocaleString('en-US')}`;
    }
  }

  $('btn-share').style.display = app.mode === 'daily' || app.mode === 'practice' ? '' : 'none';
  $('btn-see-board').style.display = app.mode === 'daily' ? '' : 'none';
  $('btn-again').textContent = endless ? 'PLAY AGAIN' : 'PRACTICE AGAIN';

  // first counted score just landed on the world board — let them claim a name;
  // the reminder ask waits for the run AFTER that (one question per day, max)
  if (app.mode === 'daily' && submittedNow) {
    Notify.reschedule({ playedToday: true, streak: app.streak.count });
    if (Net.isOnlineMode() && !localStorage.getItem('fl_name_prompted')) {
      setTimeout(openNamePrompt, 1600);
    } else if (Notify.available() && !Notify.enabled() && !localStorage.getItem('fl_notify_asked')) {
      localStorage.setItem('fl_notify_asked', '1');
      setTimeout(() => $('ov-notify').classList.remove('hidden'), 1600);
    }
  }
}

function animateNumber(el, target, fmt, dur) {
  const t0 = performance.now();
  let done = false;
  function frame(now) {
    if (done) return;
    const t = Math.min((now - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(frame);
    else done = true;
  }
  requestAnimationFrame(frame);
  // rAF never fires in hidden/backgrounded tabs — guarantee the final value
  setTimeout(() => { if (!done) { done = true; el.textContent = fmt(target); } }, dur + 80);
}

// ---------- share ----------

let shareCanvas = null;

function openShare() {
  const rec = dailyRecord() || (app.lastResult && app.mode !== 'endless'
    ? { score: app.lastResult.score, revealPct: app.lastResult.revealPct, revealed: app.lastResult.revealed, percentile: null }
    : null);
  if (!rec) { toast('Play today’s daily first'); return; }
  const dateLabel = new Date(app.dateStr + 'T00:00:00Z')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
  shareCanvas = Share.renderCard({
    faultNo: app.faultNo, dateLabel, image: app.image,
    revealed: rec.revealed, revealPctVal: rec.revealPct,
    rankText: rankLabel(rec.rank, rec.players, rec.percentile),
    guessedAt: rec.guessedAt != null ? rec.guessedAt : null,
    streak: app.streak.count,
    url: SHARE_URL,
  });
  $('share-preview').src = shareCanvas.toDataURL('image/png');
  $('ov-share').classList.remove('hidden');
}

function currentShareText() {
  const rec = dailyRecord() || { score: app.lastResult?.score || 0, revealPct: app.lastResult?.revealPct || 0, percentile: null };
  return Share.shareText({
    faultNo: app.faultNo, revealPctVal: rec.revealPct,
    rankText: rankLabel(rec.rank, rec.players, rec.percentile),
    guessedAt: rec.guessedAt != null ? rec.guessedAt : null,
    streak: app.streak.count, score: rec.score,
    url: SHARE_URL ? `https://${SHARE_URL}` : '',
  });
}

// ---------- leaderboard ----------

function lbTab(which) {
  $('tab-today').classList.toggle('active', which === 'today');
  $('tab-endless').classList.toggle('active', which === 'endless');
  $('tab-hall').classList.toggle('active', which === 'hall');
  $('lb-today').classList.toggle('hidden', which !== 'today');
  $('lb-endless').classList.toggle('hidden', which !== 'endless');
  $('lb-hall').classList.toggle('hidden', which !== 'hall');
  if (which === 'hall') loadHall();
  if (which === 'endless') loadEndlessBoard();
}

async function loadEndlessBoard() {
  renderEndlessBoard(app.endless); // paint what we have, then refresh
  if (!Net.isOnlineMode()) return;
  const res = await Net.getEndless();
  if (res && !res.error) {
    app.endless = res;
    renderEndlessBoard(res);
    renderHome();
  } else if (!app.endless) {
    $('endless-lb-rank').textContent = '—';
    $('endless-lb-players').textContent = 'Couldn’t load the league — try again.';
  }
}

function renderEndlessBoard(en) {
  const rankEl = $('endless-lb-rank');
  if (!en || en.error) {
    rankEl.textContent = '—';
    $('endless-lb-players').textContent = Net.isOnlineMode() ? 'Loading…' : 'Offline — the league syncs when you reconnect.';
    return;
  }
  rankEl.textContent = en.best > 0 && en.rank ? `#${en.rank} this week` : '∞';
  const parts = [`${(en.players || 0).toLocaleString('en-US')} in the league`];
  if (en.resetsAt) { const rl = resetLabel(en.resetsAt); if (rl) parts.push(rl); }
  $('endless-lb-players').textContent = parts.join(' · ');
  const top = en.top10 || [];
  $('endless-lb-top10').innerHTML = top.length
    ? top.map(t => {
        // rank+score match — exact against the server's own numbers, no name heuristics
        const mine = en.best > 0 && t.rank === en.rank && t.score === en.best;
        const medal = t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : t.rank;
        return `<div class="lb-row${mine ? ' me' : ''}"><span class="lb-rank">${medal}</span><span class="lb-name">${esc(t.name)}</span><span class="lb-pts">${t.score.toLocaleString('en-US')}</span></div>`;
      }).join('')
    : '<p class="muted" style="font-size:13px">No runs yet this week — set the first score.</p>';
  $('endless-lb-mine').textContent = en.best > 0 ? `Your best this week: ${en.best.toLocaleString('en-US')}` : 'Play an Endless run to enter the league.';
}

async function loadHall() {
  if (app.hall) { renderHall(app.hall); return; }
  if (!Net.isOnlineMode()) {
    $('hall-body').innerHTML = '<p class="muted" style="font-size:13px">Offline — the hall opens when you reconnect.</p>';
    return;
  }
  const res = await Net.getHall();
  if (!res || res.error) {
    $('hall-body').innerHTML = '<p class="muted" style="font-size:13px">Couldn’t load the hall — try again.</p>';
    return;
  }
  app.hall = res;
  renderHall(res);
}

function renderHall(h) {
  const medal = i => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1);
  const myName = localStorage.getItem('fl_name');
  const row = (i, name, right) =>
    `<div class="lb-row${myName && name === myName ? ' me' : ''}"><span class="lb-rank">${medal(i)}</span><span class="lb-name">${esc(name)}</span><span class="lb-pts">${right}</span></div>`;
  let html = '';
  if (h.bestDigs && h.bestDigs.length) {
    html += '<div class="hall-title">🏆 BEST DIGS EVER</div>';
    html += h.bestDigs.map((b, i) => row(i, b.name, `${b.score.toLocaleString('en-US')} · #${b.dig}`)).join('');
  }
  if (h.streaks && h.streaks.length) {
    html += '<div class="hall-title">🔥 LONGEST STREAKS</div>';
    html += h.streaks.map((s, i) => row(i, s.name, `${s.best} day${s.best > 1 ? 's' : ''}${s.alive ? ' 🔥' : ''}`)).join('');
  }
  if (h.endless && h.endless.length) {
    html += '<div class="hall-title">∞ ENDLESS LEGENDS</div>';
    html += h.endless.map((e, i) => row(i, e.name, e.score.toLocaleString('en-US'))).join('');
  }
  if (h.career && h.career.length) {
    html += '<div class="hall-title">⛏️ CAREER POINTS</div>';
    html += h.career.map((c, i) => row(i, c.name, `${c.total.toLocaleString('en-US')} · ${c.digs} digs`)).join('');
  }
  $('hall-body').innerHTML = html || '<p class="muted" style="font-size:13px">No legends yet — be the first.</p>';
}

function openLeaderboard() {
  const rec = dailyRecord();
  app.hall = null; // refetch per open — the wall may have new legends
  lbTab('today');
  $('ov-board').classList.remove('hidden');
  $('lb-locked').classList.toggle('hidden', !!rec);
  $('lb-content').classList.toggle('hidden', !rec);
  if (rec) {
    $('lb-percentile').textContent = rankLabel(rec.rank, rec.players, rec.percentile) || '—';
    $('lb-score').textContent = `Your score: ${rec.score.toLocaleString('en-US')} · ${rec.revealPct}% revealed`;
    const players = app.server && app.server.players;
    $('lb-players').textContent = players ? `${players.toLocaleString('en-US')} players today` : '';

    const top = (app.server && app.server.top10) || [];
    const myName = localStorage.getItem('fl_name');
    $('lb-top10').innerHTML = top.length
      ? top.map(t => {
          const mine = rec.rank === t.rank && (!myName || myName === t.name || t.name === 'Digger');
          const medal = t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : t.rank;
          return `<div class="lb-row${mine ? ' me' : ''}"><span class="lb-rank">${medal}</span><span class="lb-name">${esc(t.name)}</span><span class="lb-pts">${t.score.toLocaleString('en-US')}</span></div>`;
        }).join('')
      : '';

    $('lb-note').textContent = Net.isOnlineMode()
      ? 'Every score is verified by replaying the moves on the server — provably fair.'
      : 'Scores sync when you’re back online.';
  }
}

// ---------- UI bindings ----------

function bindUI() {
  bindDrag();

  $('btn-daily').addEventListener('click', () => {
    SFX.button();
    startGame(dailyRecord() ? 'practice' : 'daily');
  });
  $('btn-endless').addEventListener('click', () => { SFX.button(); startGame('endless'); });
  $('btn-tut-go').addEventListener('click', () => {
    localStorage.setItem('fl_tutorial_done', '1');
    $('ov-tutorial').classList.add('hidden');
    SFX.button();
  });

  $('btn-pause').addEventListener('click', () => {
    if (app.bombMode || !app.game || app.game.over) return;
    app.paused = true;
    Portal.gameplayStop();
    $('btn-endrun').textContent = app.mode === 'daily' ? 'END RUN' : 'RESTART';
    $('ov-pause').classList.remove('hidden');
  });
  $('btn-resume').addEventListener('click', () => { app.paused = false; $('ov-pause').classList.add('hidden'); Portal.gameplayStart(); });
  $('btn-quit').addEventListener('click', () => {
    app.paused = false;
    $('ov-pause').classList.add('hidden');
    renderer.stop();
    app.game = null;
    renderHome();
    show('s-home');
  });
  $('btn-howto').addEventListener('click', () => $('ov-tutorial').classList.remove('hidden'));
  $('btn-endrun').addEventListener('click', () => {
    $('ov-pause').classList.add('hidden');
    app.paused = false;
    if (app.mode === 'daily') {
      confirmBox('End your run?', 'Ending counts your current score as today’s result.', () => {
        app.game.over = true;
        finalizeRun();
      });
    } else {
      startGame(app.mode);
    }
  });

  $('btn-reroll').addEventListener('click', async () => {
    const g = app.game;
    if (!g || g.over || app.paused) return;
    // never reject silently — the button must always explain itself
    if (app.bombMode) { toast('Place your 3×3 blast first'); return; }
    if (g.rerollUsed) { toast('Reroll spent — you get a fresh one next run'); return; }
    const ok = await adFlow();
    if (!ok) { toast('No ad available right now'); return; }
    localStorage.setItem('fl_reroll_taught', '1');
    const ev = E.applyMove(g, { t: 'reroll' });
    if (ev.error) return;
    SFX.button();
    toast('Fresh picks from the same seam');
    renderTray();
    updateRerollBtn();
    autosave();
    if (ev.gameOver) setTimeout(() => gameOverFlow(), 500);
    else capGuard();
  });

  $('board').addEventListener('pointerdown', e => { if (app.bombMode) bombTap(e); });

  $('btn-guess').addEventListener('click', openGuess);
  const closeGuess = () => $('ov-guess').classList.add('hidden');
  $('btn-guess-cancel').addEventListener('click', closeGuess);
  $('btn-guess-x').addEventListener('click', closeGuess);
  $('ov-guess').addEventListener('click', e => { if (e.target === $('ov-guess')) closeGuess(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeGuess(); });

  $('btn-bomb-yes').addEventListener('click', bombAccept);
  $('btn-bomb-no').addEventListener('click', bombDecline);
  if (window.FL_SDK && window.FL_SDK.requestRewarded) {
    $('btn-bomb-yes').textContent = '▶ WATCH A SHORT AD';
  }

  $('btn-share').addEventListener('click', () => { $('ov-gameover').classList.add('hidden'); openShare(); });
  $('btn-share-home').addEventListener('click', openShare);
  $('btn-see-board').addEventListener('click', () => { $('ov-gameover').classList.add('hidden'); openLeaderboard(); });
  $('btn-again').addEventListener('click', () => {
    $('ov-gameover').classList.add('hidden');
    startGame(app.mode === 'endless' ? 'endless' : 'practice');
  });
  $('btn-go-home').addEventListener('click', () => {
    $('ov-gameover').classList.add('hidden');
    $('ov-pause').classList.add('hidden');
    app.paused = false;
    renderer.stop();
    app.game = null;
    lastMilestone = 0;
    renderHome();
    show('s-home');
  });

  let shareBusy = false;
  $('btn-share-native').addEventListener('click', async () => {
    if (shareBusy) return;
    shareBusy = true;
    try {
      const res = await Share.shareCard(shareCanvas, currentShareText());
      if (res === null) toast('Sharing unavailable — try copy or download');
    } finally { shareBusy = false; }
  });
  // WKWebView has no download manager — hide DOWNLOAD in the native app
  // (and the privacy link: the App Store listing already carries it there)
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    $('btn-download').style.display = 'none';
    $('privacy-link').style.display = 'none';
  }
  $('btn-copy-img').addEventListener('click', async () => {
    toast(await Share.copyImage(shareCanvas) ? 'Image copied' : 'Copy failed — try download');
  });
  $('btn-copy-text').addEventListener('click', async () => {
    toast(await Share.copyText(currentShareText()) ? 'Copied' : 'Copy failed');
  });
  $('btn-download').addEventListener('click', () => Share.downloadCard(shareCanvas, app.faultNo));
  $('btn-share-back').addEventListener('click', () => $('ov-share').classList.add('hidden'));

  $('btn-leaderboard').addEventListener('click', openLeaderboard);
  $('btn-lb-close').addEventListener('click', () => $('ov-board').classList.add('hidden'));
  $('tab-today').addEventListener('click', () => lbTab('today'));
  $('tab-endless').addEventListener('click', () => lbTab('endless'));
  $('tab-hall').addEventListener('click', () => lbTab('hall'));

  $('btn-name-dice').addEventListener('click', () => { $('name-input').value = randName(); SFX.button(); });
  $('btn-name-save').addEventListener('click', saveName);
  $('btn-name-skip').addEventListener('click', () => {
    localStorage.setItem('fl_name_prompted', '1');
    $('ov-name').classList.add('hidden');
  });

  $('btn-notify-yes').addEventListener('click', async () => {
    $('ov-notify').classList.add('hidden');
    const ok = await Notify.enable({ playedToday: !!dailyRecord(), streak: app.streak.count });
    toast(ok ? '⛏️ Reminders on — see you tomorrow evening'
             : 'Couldn’t enable — allow notifications in iOS Settings');
    syncSettingsUI();
  });
  $('btn-notify-no').addEventListener('click', () => $('ov-notify').classList.add('hidden'));
  $('tog-notify').addEventListener('click', async () => {
    if (Notify.enabled()) {
      await Notify.disable();
      toast('Daily reminder off');
    } else {
      const ok = await Notify.enable({ playedToday: !!dailyRecord(), streak: app.streak.count });
      toast(ok ? '⛏️ Daily reminder on' : 'Allow notifications in iOS Settings first');
    }
    syncSettingsUI();
  });
  $('btn-name-change').addEventListener('click', () => { $('ov-settings').classList.add('hidden'); openNamePrompt(); });
  $('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveName(); });
  $('btn-streak').addEventListener('click', () => {
    toast(`🔥 ${app.streak.count} day streak · best ${app.streak.best}`);
  });

  // settings
  $('btn-settings').addEventListener('click', () => { syncSettingsUI(); $('ov-settings').classList.remove('hidden'); });
  $('btn-settings-close').addEventListener('click', () => $('ov-settings').classList.add('hidden'));
  const togs = [['tog-sound', 'sound'], ['tog-haptics', 'haptics'], ['tog-shake', 'shake'], ['tog-motion', 'reducedMotion']];
  for (const [id, key] of togs) {
    $(id).addEventListener('click', () => {
      settings[key] = !settings[key];
      applySettings();
      syncSettingsUI();
    });
  }
  $('rng-offset').addEventListener('input', e => {
    settings.dragOffset = Number(e.target.value);
    save('fl_settings', settings);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.game && !app.game.over && $('s-game').classList.contains('active') && !app.paused) {
      app.paused = true;
      Portal.gameplayStop();
      $('ov-pause').classList.remove('hidden');
      autosave();
    }
  });
  window.addEventListener('resize', () => {
    if (renderer && app.game) {
      renderer.resize(Math.min(document.body.clientWidth, 480) - 32);
      renderTray();
    }
  });
  document.addEventListener('pointerdown', SFX.unlock, { once: true });
}

let confirmCb = null;
function confirmBox(title, msg, cb) {
  $('confirm-title').textContent = title;
  $('confirm-msg').textContent = msg;
  confirmCb = cb;
  $('ov-confirm').classList.remove('hidden');
}
$('confirm-yes').addEventListener('click', () => { $('ov-confirm').classList.add('hidden'); if (confirmCb) confirmCb(); });
$('confirm-no').addEventListener('click', () => $('ov-confirm').classList.add('hidden'));

let portalMuted = false; // portal-level mute wins over the in-game toggle
function applySettings() {
  save('fl_settings', settings);
  SFX.setEnabled(settings.sound && !portalMuted);
  SFX.setHaptics(settings.haptics);
}

function syncSettingsUI() {
  $('tog-sound').classList.toggle('on', settings.sound);
  $('tog-haptics').classList.toggle('on', settings.haptics);
  $('tog-shake').classList.toggle('on', settings.shake);
  $('tog-motion').classList.toggle('on', settings.reducedMotion);
  $('row-notify').classList.toggle('hidden', !Notify.available());
  $('tog-notify').classList.toggle('on', Notify.enabled());
  $('rng-offset').value = settings.dragOffset;
  const dk = localStorage.getItem('fl_device_key') || '';
  $('device-hash').textContent = dk ? 'device ' + dk.slice(0, 8) : '';
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

applySettings();
boot();

// debug hook (dev only — stripped for portal builds)
window.__fl = { app, drag, settings, E };

// Debug/testing hook — server-side replay validation makes client tampering
// pointless, so exposing this is safe by design.
window.__FL = { app, E, startGame, finalizeRun, gameOverFlow, openShare, renderHome };
