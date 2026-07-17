// Portal platform adapter — wraps the CrazyGames HTML5 SDK behind no-op
// guards. Outside a portal (github.io, native app) every call is a silent
// no-op, so this module is safe to ship in all builds.
//
// CrazyGames requirements wired here (docs.crazygames.com/sdk/game/):
//   loadingStart/loadingStop   — around the boot/load phase (required, HTML5)
//   gameplayStart/gameplayStop — run start / revive / resume vs pause / over
//   happytime()                — sparingly, on big moments (full reveal, guess)

let sdk = null;
let playing = false;

export async function init() {
  const cg = window.CrazyGames && window.CrazyGames.SDK;
  if (!cg) return;
  try {
    if (typeof cg.init === 'function') await cg.init(); // SDK v3: modules only after init()
    sdk = cg;
    // portal mute takes priority over in-game audio settings (SDK requirement)
    if (sdk.game && sdk.game.addSettingsChangeListener) {
      sdk.game.addSettingsChangeListener(() => applyMute());
    }
  } catch {
    sdk = null; // SDK present but refused (e.g. running outside the portal)
  }
}

let muteCb = null;
function applyMute() {
  try {
    if (muteCb && sdk && sdk.game && sdk.game.settings) muteCb(!!sdk.game.settings.muteAudio);
  } catch { /* settings not available — stay unmuted */ }
}
export function onMuteChange(cb) { muteCb = cb; applyMute(); }

function game() { return sdk && sdk.game ? sdk.game : null; }
function call(fn) { try { const g = game(); if (g && g[fn]) g[fn](); } catch { /* portal quirks never break the game */ } }

export function loadingStart() { call('loadingStart'); }
export function loadingStop() { call('loadingStop'); }

// start/stop are deduped: the game has several paths into both states and the
// SDK wants clean transitions, not repeats
export function gameplayStart() {
  if (playing) return;
  playing = true;
  call('gameplayStart');
}

export function gameplayStop() {
  if (!playing) return;
  playing = false;
  call('gameplayStop');
}

export function happytime() { call('happytime'); }
