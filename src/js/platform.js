'use strict';
// Thin wrapper around the CrazyGames HTML5 SDK v3.
// Every call is safe when the SDK is missing (offline, other hosts, ad blockers):
// the game then runs normally with ads disabled and saves to localStorage.
(function () {
  const KEY = 'shootemall:';
  let sdk = null;
  let env = 'none';
  let inGameplay = false;
  const hooks = { adStart: null, adEnd: null };
  const settingsListeners = [];

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  async function init() {
    const g = window.CrazyGames && window.CrazyGames.SDK;
    if (!g) return;
    try {
      await withTimeout(g.init(), 6000);
      env = g.environment;
      if (env === 'crazygames' || env === 'local') sdk = g;
    } catch (e) {
      console.warn('[platform] SDK init failed, continuing without it', e);
    }
    if (sdk) {
      try {
        sdk.game.addSettingsChangeListener((s) => settingsListeners.forEach((f) => f(s)));
      } catch (e) { /* ignore */ }
    }
  }

  function call(fn) {
    if (!sdk) return;
    try { fn(sdk); } catch (e) { console.warn('[platform]', e); }
  }

  function requestAd(type) {
    return new Promise((resolve) => {
      if (!sdk) { resolve(false); return; }
      let done = false;
      let started = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (started && hooks.adEnd) hooks.adEnd();
        resolve(ok);
      };
      try {
        sdk.ad.requestAd(type, {
          adStarted() { started = true; if (hooks.adStart) hooks.adStart(); },
          adFinished() { finish(true); },
          adError(err) { console.info('[platform] ad not shown:', type, err && err.code); finish(false); },
        });
      } catch (e) {
        finish(false);
      }
    });
  }

  function hasData() {
    try { return !!(sdk && sdk.data); } catch (e) { return false; }
  }

  window.Platform = {
    init,
    get env() { return env; },
    get active() { return !!sdk; },

    loadingStart() { call((s) => s.game.loadingStart()); },
    loadingStop() { call((s) => s.game.loadingStop()); },
    gameplayStart() {
      if (inGameplay) return;
      inGameplay = true;
      call((s) => s.game.gameplayStart());
    },
    gameplayStop() {
      if (!inGameplay) return;
      inGameplay = false;
      call((s) => s.game.gameplayStop());
    },
    happytime() { call((s) => s.game.happytime()); },

    settings() {
      try { return sdk ? sdk.game.settings : null; } catch (e) { return null; }
    },
    onSettings(fn) { settingsListeners.push(fn); },

    onAdStart(fn) { hooks.adStart = fn; },
    onAdEnd(fn) { hooks.adEnd = fn; },
    midgameAd() { return requestAd('midgame'); },
    rewardedAd() { return requestAd('rewarded'); },

    getItem(k) {
      if (hasData()) {
        try { return sdk.data.getItem(KEY + k); } catch (e) { /* fall through */ }
      }
      try { return window.localStorage.getItem(KEY + k); } catch (e) { return null; }
    },
    setItem(k, v) {
      if (hasData()) {
        try { sdk.data.setItem(KEY + k, String(v)); return; } catch (e) { /* fall through */ }
      }
      try { window.localStorage.setItem(KEY + k, String(v)); } catch (e) { /* ignore */ }
    },
  };
})();
