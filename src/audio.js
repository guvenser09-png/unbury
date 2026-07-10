// Synthesized SFX — zero assets. Pentatonic ladder for combo clears.
let ctx = null;
let master = null;
let enabled = true;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlock() { ensure(); }
export function setEnabled(on) { enabled = on; }

function tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.1, attack = 0.002, gain = 0.25, delay = 0 }) {
  if (!enabled || !ensure()) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.03, gain = 0.08, freq = 2000, delay = 0 }) {
  if (!enabled || !ensure()) return;
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t);
}

const LADDER = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // C5 D5 E5 G5 A5 C6

export function place() {
  const detune = 1 + (Math.random() * 0.2 - 0.1);
  tone({ type: 'triangle', f0: 170 * detune, f1: 140 * detune, dur: 0.08, gain: 0.22 });
  noise({ dur: 0.025, gain: 0.05, freq: 2000 });
  vibrate(10);
}

export function invalid() { tone({ f0: 260, dur: 0.03, gain: 0.08 }); }

export function reject() {
  tone({ f0: 220, f1: 160, dur: 0.09, gain: 0.16 });
  tone({ f0: 160, f1: 120, dur: 0.12, gain: 0.14, delay: 0.06 });
  vibrate(35);
}
export function pickup() { tone({ f0: 300, f1: 380, dur: 0.05, gain: 0.1 }); }
export function button() { tone({ f0: 440, dur: 0.025, gain: 0.08 }); }

export function clear(combo, lines) {
  const idx = Math.min(Math.max(combo - 1, 0), LADDER.length - 1);
  tone({ f0: 620, f1: 420, dur: 0.07, gain: 0.2 });
  tone({ f0: LADDER[idx], dur: 0.26, gain: 0.16, delay: 0.015 });
  if (lines >= 2) tone({ f0: LADDER[idx] * 1.25, dur: 0.26, gain: 0.12, delay: 0.045 });
  if (combo >= 4) tone({ f0: 55, dur: 0.2, gain: 0.3, type: 'sine' });
  vibrate(lines >= 2 ? [20, 30, 20] : 20);
}

export function obstacleBreak() { noise({ dur: 0.05, gain: 0.1, freq: 700 }); }

export function fullClear() {
  [0, 1, 2, 3, 4].forEach(i => tone({ f0: LADDER[i], dur: 0.3, gain: 0.14, delay: i * 0.07 }));
  vibrate([30, 40, 30]);
}

export function milestone() {
  tone({ f0: 523.25, dur: 0.25, gain: 0.12 });
  tone({ f0: 659.25, dur: 0.25, gain: 0.12, delay: 0.08 });
  tone({ f0: 783.99, dur: 0.3, gain: 0.12, delay: 0.16 });
}

export function revealFinale() {
  [0, 1, 2, 3, 4, 5].forEach(i => tone({ f0: LADDER[i], dur: 0.32, gain: 0.15, delay: i * 0.07 }));
  noise({ dur: 1.2, gain: 0.04, freq: 7000, delay: 0.35 });
  vibrate([30, 40, 30, 40, 60]);
}

export function gameOver() {
  tone({ f0: 329.63, dur: 0.5, gain: 0.12 });
  tone({ f0: 277.18, dur: 0.7, gain: 0.12, delay: 0.22 });
  vibrate(40);
}

export function bomb() {
  tone({ f0: 90, f1: 40, dur: 0.35, gain: 0.4 });
  noise({ dur: 0.25, gain: 0.15, freq: 500 });
  vibrate([20, 30, 40]);
}

let haptics = true;
export function setHaptics(on) { haptics = on; }
function vibrate(pattern) {
  if (haptics && navigator.vibrate) navigator.vibrate(pattern);
}
