// Fault Lines — deterministic game engine v1.
// Shared verbatim between the browser client and the Supabase edge-function
// validator: every scoring rule lives here and only here. Nothing in this
// module may read the clock, the DOM, or Math.random.

export const ENGINE_VERSION = 1;
export const BOARD = 8;
export const CELLS = BOARD * BOARD;
export const OBSTACLE = 9;
export const COLOR_COUNT = 6;
export const FULL_CLEAR_BONUS = 300;
export const OBSTACLE_POINTS = 5;
export const GUESS_PENALTY = 40;
export const MAX_MOVES = 400;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function P(id, cells, weight) {
  let h = 0, w = 0;
  for (const [r, c] of cells) {
    if (r + 1 > h) h = r + 1;
    if (c + 1 > w) w = c + 1;
  }
  return { id, cells, size: cells.length, w, h, w2: Math.round(weight * 2) };
}

export const PIECES = [
  P('P1', [[0, 0]], 4),
  P('P2a', [[0, 0], [0, 1]], 5),
  P('P2b', [[0, 0], [1, 0]], 5),
  P('P3a', [[0, 0], [0, 1], [0, 2]], 5),
  P('P3b', [[0, 0], [1, 0], [2, 0]], 5),
  P('P4a', [[0, 0], [0, 1], [0, 2], [0, 3]], 4),
  P('P4b', [[0, 0], [1, 0], [2, 0], [3, 0]], 4),
  P('P5a', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 2),
  P('P5b', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 2),
  P('SQ2', [[0, 0], [0, 1], [1, 0], [1, 1]], 6),
  P('SQ3', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], 2),
  P('R23a', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], 3),
  P('R23b', [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]], 3),
  P('L3a', [[0, 0], [1, 0], [1, 1]], 3),
  P('L3b', [[0, 0], [0, 1], [1, 0]], 3),
  P('L3c', [[0, 0], [0, 1], [1, 1]], 3),
  P('L3d', [[0, 1], [1, 0], [1, 1]], 3),
  P('L4a', [[0, 0], [1, 0], [2, 0], [2, 1]], 2),
  P('L4b', [[0, 0], [0, 1], [0, 2], [1, 0]], 2),
  P('L4c', [[0, 0], [0, 1], [1, 1], [2, 1]], 2),
  P('L4d', [[0, 2], [1, 0], [1, 1], [1, 2]], 2),
  P('T4a', [[0, 0], [0, 1], [0, 2], [1, 1]], 2),
  P('T4b', [[0, 1], [1, 0], [1, 1], [1, 2]], 2),
  P('S4', [[0, 1], [0, 2], [1, 0], [1, 1]], 1.5),
  P('Z4', [[0, 0], [0, 1], [1, 1], [1, 2]], 1.5),
];

const TOTAL_W2 = PIECES.reduce((s, p) => s + p.w2, 0);
export const BAG_SIZE = 24;

export function buildBag(rng) {
  let last = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const bag = [];
    for (let i = 0; i < PIECES.length; i++) {
      const copies = Math.floor(PIECES[i].w2 / 6);
      for (let k = 0; k < copies; k++) bag.push(i);
    }
    while (bag.length < BAG_SIZE) {
      let roll = Math.floor(rng() * TOTAL_W2);
      for (let i = 0; i < PIECES.length; i++) {
        roll -= PIECES[i].w2;
        if (roll < 0) { bag.push(i); break; }
      }
    }
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
    }
    let big = 0, small = 0, triple = false;
    for (let i = 0; i < bag.length; i++) {
      const sz = PIECES[bag[i]].size;
      if (sz >= 5) big++;
      if (sz <= 2) small++;
      if (i >= 2 && bag[i] === bag[i - 1] && bag[i] === bag[i - 2]) triple = true;
    }
    last = bag;
    if (big >= 2 && small >= 3 && !triple) return bag;
  }
  return last;
}

export function createGame(opts) {
  const state = {
    v: ENGINE_VERSION,
    rng: mulberry32((opts.seed >>> 0) || 1),
    board: new Uint8Array(CELLS),
    revealed: new Uint8Array(CELLS),
    daily: !!opts.daily,
    bagQueue: [],
    streamPos: 0,
    tray: [null, null, null],
    score: 0,
    combo: 0,
    maxCombo: 0,
    linesCleared: 0,
    placements: 0,
    rerollUsed: false,
    bombUsed: false,
    over: false,
    ended: false,
    moves: [],
    answerIndex: Number.isInteger(opts.answerIndex) ? opts.answerIndex : null,
    guessUsed: false,
    guessedAtPct: null,
    guessBonus: 0,
  };
  const obstacles = opts.obstacles || [];
  for (const cell of obstacles) {
    if (cell >= 0 && cell < CELLS) state.board[cell] = OBSTACLE;
  }
  refillTray(state);
  return state;
}

function drawPiece(state) {
  if (state.bagQueue.length === 0) state.bagQueue = buildBag(state.rng);
  const pieceIdx = state.bagQueue.shift();
  const color = (state.streamPos % COLOR_COUNT) + 1;
  state.streamPos++;
  return { piece: pieceIdx, color };
}

function refillTray(state) {
  for (let i = 0; i < 3; i++) state.tray[i] = drawPiece(state);
}

export function canPlace(state, pieceIdx, row, col) {
  const p = PIECES[pieceIdx];
  if (row < 0 || col < 0 || row + p.h > BOARD || col + p.w > BOARD) return false;
  for (const [r, c] of p.cells) {
    if (state.board[(row + r) * BOARD + (col + c)] !== 0) return false;
  }
  return true;
}

export function anyFit(state) {
  for (let s = 0; s < 3; s++) {
    if (!state.tray[s]) continue;
    const p = PIECES[state.tray[s].piece];
    for (let r = 0; r <= BOARD - p.h; r++) {
      for (let c = 0; c <= BOARD - p.w; c++) {
        if (canPlace(state, state.tray[s].piece, r, c)) return true;
      }
    }
  }
  return false;
}

export function slotFits(state, slot) {
  if (!state.tray[slot]) return false;
  const p = PIECES[state.tray[slot].piece];
  for (let r = 0; r <= BOARD - p.h; r++) {
    for (let c = 0; c <= BOARD - p.w; c++) {
      if (canPlace(state, state.tray[slot].piece, r, c)) return true;
    }
  }
  return false;
}

function triangular(n) { return (n * (n + 1)) >> 1; }

function detectClears(state) {
  const rows = [], cols = [];
  for (let r = 0; r < BOARD; r++) {
    let full = true;
    for (let c = 0; c < BOARD; c++) if (state.board[r * BOARD + c] === 0) { full = false; break; }
    if (full) rows.push(r);
  }
  for (let c = 0; c < BOARD; c++) {
    let full = true;
    for (let r = 0; r < BOARD; r++) if (state.board[r * BOARD + c] === 0) { full = false; break; }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

export function applyMove(state, move) {
  if (state.ended) return { error: 'run already ended' };
  if (state.moves.length >= MAX_MOVES) return { error: 'move cap exceeded' };

  if (move.t === 'p') {
    if (state.over) return { error: 'placement while game over' };
    const slot = move.i;
    if (slot !== 0 && slot !== 1 && slot !== 2) return { error: 'bad slot' };
    const item = state.tray[slot];
    if (!item) return { error: 'slot empty' };
    if (!canPlace(state, item.piece, move.y, move.x)) return { error: 'illegal placement' };

    const p = PIECES[item.piece];
    const placedCells = [];
    for (const [r, c] of p.cells) {
      const cell = (move.y + r) * BOARD + (move.x + c);
      state.board[cell] = item.color;
      placedCells.push(cell);
    }
    let delta = p.size;
    state.placements++;

    const { rows, cols } = detectClears(state);
    const L = rows.length + cols.length;
    const clearedCells = [];
    const obstacleCells = [];
    const revealedNow = [];
    let fullClear = false;

    if (L > 0) {
      state.combo++;
      if (state.combo > state.maxCombo) state.maxCombo = state.combo;
      state.linesCleared += L;
      const seen = new Uint8Array(CELLS);
      for (const r of rows) for (let c = 0; c < BOARD; c++) seen[r * BOARD + c] = 1;
      for (const c of cols) for (let r = 0; r < BOARD; r++) seen[r * BOARD + c] = 1;
      let obstacles = 0;
      for (let cell = 0; cell < CELLS; cell++) {
        if (!seen[cell]) continue;
        if (state.board[cell] === OBSTACLE) { obstacles++; obstacleCells.push(cell); }
        state.board[cell] = 0;
        clearedCells.push(cell);
        if (!state.revealed[cell]) { state.revealed[cell] = 1; revealedNow.push(cell); }
      }
      const base = 10 * triangular(L);
      const m2 = Math.min(state.combo + 1, 8);
      delta += ((base + OBSTACLE_POINTS * obstacles) * m2) >> 1;

      let empty = true;
      for (let cell = 0; cell < CELLS; cell++) if (state.board[cell] !== 0) { empty = false; break; }
      if (empty) { delta += FULL_CLEAR_BONUS; fullClear = true; }
    } else {
      state.combo = 0;
    }

    state.score += delta;
    state.tray[slot] = null;
    let refilled = false;
    if (!state.tray[0] && !state.tray[1] && !state.tray[2]) { refillTray(state); refilled = true; }
    if (!anyFit(state)) state.over = true;

    state.moves.push({ t: 'p', i: slot, x: move.x, y: move.y });
    return {
      placedCells, color: item.color, pieceId: p.id,
      clearedRows: rows, clearedCols: cols, clearedCells, obstacleCells,
      revealedNow, scoreDelta: delta, combo: state.combo, fullClear,
      refilled, gameOver: state.over,
    };
  }

  if (move.t === 'reroll') {
    if (state.over) return { error: 'reroll while game over' };
    if (state.rerollUsed) return { error: 'reroll already used' };
    state.rerollUsed = true;
    refillTray(state);
    if (!anyFit(state)) state.over = true;
    state.moves.push({ t: 'reroll' });
    return { reroll: true, gameOver: state.over };
  }

  if (move.t === 'bomb') {
    if (!state.over) return { error: 'bomb only at game over' };
    if (state.bombUsed) return { error: 'bomb already used' };
    if (move.x < 0 || move.x > BOARD - 1 || move.y < 0 || move.y > BOARD - 1) return { error: 'bomb out of bounds' };
    state.bombUsed = true;
    const clearedCells = [];
    const revealedNow = [];
    for (let r = move.y - 1; r <= move.y + 1; r++) {
      for (let c = move.x - 1; c <= move.x + 1; c++) {
        if (r < 0 || r >= BOARD || c < 0 || c >= BOARD) continue;
        const cell = r * BOARD + c;
        if (state.board[cell] === OBSTACLE && !state.revealed[cell]) {
          state.revealed[cell] = 1;
          revealedNow.push(cell);
        }
        if (state.board[cell] !== 0) clearedCells.push(cell);
        state.board[cell] = 0;
      }
    }
    state.combo = 0;
    state.over = !anyFit(state);
    state.moves.push({ t: 'bomb', x: move.x, y: move.y });
    return { bomb: true, clearedCells, revealedNow, gameOver: state.over };
  }

  if (move.t === 'g') {
    if (state.over) return { error: 'guess while game over' };
    if (state.guessUsed) return { error: 'guess already used' };
    if (state.answerIndex == null) return { error: 'no guess in this mode' };
    const pct = revealPct(state);
    if (pct < 20) return { error: 'guess locked below 20%' };
    if (!Number.isInteger(move.pick) || move.pick < 0) return { error: 'bad pick' };
    state.guessUsed = true;
    const correct = move.pick === state.answerIndex;
    let bonus = 0;
    let penalty = 0;
    if (correct) {
      bonus = (100 - pct) * 2;
      state.guessBonus = bonus;
      state.guessedAtPct = pct;
      state.score += bonus;
    } else {
      // a wrong guess is a lost wager, floored so score never goes negative
      penalty = Math.min(GUESS_PENALTY, state.score);
      state.score -= penalty;
    }
    state.moves.push({ t: 'g', pick: move.pick });
    return { guess: true, correct, bonus, penalty, atPct: pct };
  }

  if (move.t === 'end') {
    state.ended = true;
    state.moves.push({ t: 'end' });
    return { ended: true };
  }

  return { error: 'unknown move type' };
}

export function revealCount(state) {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (state.revealed[i]) n++;
  return n;
}

export function revealPct(state) {
  return Math.round((revealCount(state) * 100) / CELLS);
}

// Re-simulates a submitted move list from scratch. Used by the validator and
// by client-side self-checks; claimed values are redundant checksums.
export function simulate(seed, obstacles, moves, daily, answerIndex) {
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > MAX_MOVES) {
    return { valid: false, reason: 'bad move list' };
  }
  let rerolls = 0, bombs = 0, guesses = 0;
  for (const m of moves) {
    if (m.t === 'reroll') rerolls++;
    if (m.t === 'bomb') bombs++;
    if (m.t === 'g') guesses++;
  }
  if (rerolls > 1 || bombs > 1 || guesses > 1) return { valid: false, reason: 'perk overuse' };

  const state = createGame({ seed, obstacles, daily, answerIndex });
  for (const m of moves) {
    const ev = applyMove(state, m);
    if (ev.error) return { valid: false, reason: ev.error };
  }
  if (!state.over && !state.ended) return { valid: false, reason: 'run not finished' };
  return {
    valid: true,
    score: state.score,
    revealPct: revealPct(state),
    maxCombo: state.maxCombo,
    linesCleared: state.linesCleared,
    placements: state.placements,
    usedReroll: state.rerollUsed,
    usedBomb: state.bombUsed,
    guessedAtPct: state.guessedAtPct,
    guessBonus: state.guessBonus,
  };
}

// --- Daily helpers (async-free date math; SHA-256 via WebCrypto) ---

export async function deriveDailySeed(dateStr) {
  const data = new TextEncoder().encode('FAULTLINES-v1:' + dateStr);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const dv = new DataView(hash);
  const lo = dv.getUint32(0);
  const hi = dv.getUint32(4);
  return { seedLo: lo, seedHi: hi, seed: (lo ^ hi) >>> 0 };
}

export function faultNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000) + 1;
}
