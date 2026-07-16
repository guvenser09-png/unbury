// Ad adapter — routes rewarded-ad requests to whichever backend exists.
// The game only ever talks to window.FL_SDK.requestRewarded(); all ad wording
// in the UI is conditional on FL_SDK being present, so with no backend the
// perks are silently free and nothing in the UI mentions ads.
//
// Backends:
//   1. CrazyGames portal SDK (web portal builds — injected by the portal)
//   2. AdMob via @capacitor-community/admob (iOS v1.1 — needs plugin + unit id
//      in window.FL_ADS; event names must be verified against the installed
//      plugin version when wiring v1.1)

export function initAds() {
  if (window.FL_SDK) return;

  // --- CrazyGames (web portal) ---
  const cg = window.CrazyGames && window.CrazyGames.SDK;
  if (cg && cg.ad) {
    window.FL_SDK = {
      requestRewarded: () => new Promise((resolve) => {
        cg.ad.requestAd('rewarded', {
          adStarted: () => {},
          adFinished: () => resolve(true),
          // portal rule: never grant the reward on an ad error — EXCEPT when
          // the platform has ads disabled entirely (Basic Launch), where the
          // perk stays free so gameplay is identical to the ad-free builds
          adError: (e) => resolve(/disabled/i.test(String((e && e.code) || (e && e.message) || e || ''))),
        });
      }),
    };
    return;
  }

  // --- AdMob (native app, activates only when plugin + ids exist) ---
  const cap = window.Capacitor;
  const AdMob = cap && cap.Plugins && cap.Plugins.AdMob;
  const ids = window.FL_ADS || {};
  const native = cap && cap.isNativePlatform && cap.isNativePlatform();
  if (AdMob && native && ids.admobRewardedId) {
    let ready = false;
    const prepare = () =>
      AdMob.prepareRewardVideoAd({ adId: ids.admobRewardedId, npa: !ids.personalized })
        .then(() => { ready = true; })
        .catch(() => { ready = false; });
    AdMob.initialize({}).then(prepare).catch(() => {});

    window.FL_SDK = {
      requestRewarded: () => new Promise((resolve) => {
        if (!ready) { prepare(); resolve(true); return; } // native no-fill: grant free — no dead buttons in the app
        ready = false;
        let rewarded = false;
        const subs = [];
        const cleanup = () => { subs.forEach(s => s.remove && s.remove()); prepare(); };
        // NOTE v1.1: confirm exact event names for the installed plugin major
        // version (RewardAdPluginEvents.Rewarded / .Dismissed in v5+).
        Promise.resolve(AdMob.addListener('onRewardedVideoAdReward', () => { rewarded = true; })).then(s => subs.push(s));
        Promise.resolve(AdMob.addListener('onRewardedVideoAdClosed', () => { cleanup(); resolve(rewarded); })).then(s => subs.push(s));
        AdMob.showRewardVideoAd().catch(() => { cleanup(); resolve(false); });
      }),
    };
  }
}
