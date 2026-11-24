'use strict';
// UI glue: screens, HUD, input shortcuts and the CrazyGames SDK lifecycle.
(async function () {
  const $ = (id) => document.getElementById(id);
  const screens = {
    loading: $('screenLoading'), title: $('screenTitle'),
    pause: $('screenPause'), over: $('screenOver'),
  };
  const hud = $('hud');
  const adBlocker = $('adBlocker');
  const S = Game.S;

  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');
  function only(name) {
    for (const k in screens) (k === name ? show : hide)(screens[k]);
    (name === null ? show : hide)(hud);
  }
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  // ---------- boot ----------
  await Platform.init();
  Platform.loadingStart();

  let best = parseInt(Platform.getItem('best') || '0', 10) || 0;
  let muted = Platform.getItem('muted') === '1';
  let runs = 0;
  let busy = false;

  const sdkSettings = Platform.settings();
  if (sdkSettings) Sfx.setSdkMuted(!!sdkSettings.muteAudio);
  Platform.onSettings((s) => { if (s) Sfx.setSdkMuted(!!s.muteAudio); });
  Platform.onAdStart(() => Sfx.setAdMuted(true));
  Platform.onAdEnd(() => Sfx.setAdMuted(false));

  function setMuted(v) {
    muted = v;
    Sfx.setMuted(v);
    document.body.classList.toggle('muted', v);
    Platform.setItem('muted', v ? '1' : '0');
  }
  setMuted(muted);

  $('titleBest').textContent = fmt(best);
  Platform.loadingStop();
  only('title');

  // ---------- ads ----------
  async function runAd(kind) {
    busy = true;
    show(adBlocker);
    const ok = kind === 'rewarded' ? await Platform.rewardedAd() : await Platform.midgameAd();
    hide(adBlocker);
    busy = false;
    return ok;
  }

  // ---------- flow ----------
  async function play() {
    if (busy) return;
    Sfx.unlock();
    Sfx.click();
    if (runs > 0) await runAd('midgame');
    runs++;
    only(null);
    Game.newRun();
    Platform.gameplayStart();
  }

  function pause() {
    if (!Game.pause()) return;
    Platform.gameplayStop();
    only('pause');
  }

  function resume() {
    Sfx.unlock();
    only(null);
    Game.resume();
    Platform.gameplayStart();
  }

  function toMenu() {
    if (busy) return;
    Sfx.click();
    Platform.gameplayStop();
    Game.toAttract();
    $('titleBest').textContent = fmt(best);
    only('title');
  }

  async function continueRun() {
    if (busy) return;
    Sfx.unlock();
    hide($('adMsg'));
    const ok = await runAd('rewarded');
    if (!ok) {
      show($('adMsg'));
      return;
    }
    only(null);
    Game.continueRun();
    Platform.gameplayStart();
  }

  Game.on('over', (r) => {
    Platform.gameplayStop();
    const isBest = r.score > best;
    if (isBest) {
      best = r.score;
      Platform.setItem('best', String(best));
      Platform.happytime();
    }
    $('overScore').textContent = fmt(r.score);
    $('overWave').textContent = r.wave;
    $('overKills').textContent = fmt(r.kills);
    $('overCombo').textContent = r.bestCombo;
    $('overBest').textContent = fmt(best);
    (isBest && r.score > 0 ? show : hide)($('newBest'));
    // One rewarded continue per run, and only when ads can actually play.
    (!r.continued && Platform.active ? show : hide)($('btnContinue'));
    hide($('adMsg'));
    only('over');
  });

  // ---------- banner ----------
  const banner = $('banner');
  Game.on('banner', ({ title, sub }) => {
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub || '';
    banner.classList.remove('show');
    void banner.offsetWidth; // restart the CSS animation
    banner.classList.add('show');
  });

  // ---------- HUD (only touches the DOM when a value changes) ----------
  const cache = {};
  function setText(key, el, val) {
    if (cache[key] === val) return;
    cache[key] = val;
    el.textContent = val;
  }
  const hudScore = $('hudScore'), hudBest = $('hudBest'), hudWave = $('hudWave');
  const hudCombo = $('hudCombo'), hudLives = $('hudLives');
  const pwSpread = $('pwSpread'), pwRapid = $('pwRapid'), pwShield = $('pwShield');

  function setPower(el, key, t) {
    const on = t > 0;
    if (cache[key] !== on) { cache[key] = on; el.classList.toggle('hidden', !on); }
    if (on) el.lastElementChild.style.transform = `scaleX(${Math.min(1, t / 9)})`;
  }

  Game.on('frame', () => {
    if (S.phase !== 'playing' && S.phase !== 'paused' && S.phase !== 'dying') return;
    setText('score', hudScore, fmt(S.score));
    setText('best', hudBest, fmt(Math.max(best, S.score)));
    setText('wave', hudWave, `WAVE ${S.wave}`);
    setText('combo', hudCombo, S.combo >= 3 ? `${S.combo} COMBO  x${S.mult}` : '');
    hudCombo.classList.toggle('hot', S.mult >= 2);
    if (cache.lives !== S.lives) {
      cache.lives = S.lives;
      let html = '';
      for (let i = 0; i < Game.MAX_LIVES; i++) {
        html += `<svg viewBox="0 0 24 24" class="${i < S.lives ? 'on' : ''}"><path d="M12 20C4 14 3 9 6 6.5S11 6 12 8c1-2 4-4 6-1.5S20 14 12 20z"/></svg>`;
      }
      hudLives.innerHTML = html;
      hudLives.classList.remove('bump');
      void hudLives.offsetWidth;
      hudLives.classList.add('bump');
    }
    setPower(pwSpread, 'spread', S.spread);
    setPower(pwRapid, 'rapid', S.rapid);
    if (cache.shield !== S.shield) { cache.shield = S.shield; pwShield.classList.toggle('hidden', !S.shield); }
  });

  // ---------- buttons ----------
  const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  tap('btnPlay', play);
  tap('btnAgain', play);
  tap('btnResume', resume);
  tap('btnQuit', toMenu);
  tap('btnMenu', toMenu);
  tap('btnContinue', continueRun);
  tap('btnPause', pause);
  tap('btnMute', () => { Sfx.unlock(); setMuted(!muted); Sfx.click(); });

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        if (S.phase === 'playing') Game.setKeyFire(true);
        break;
      case 'Enter':
        if (!screens.title.classList.contains('hidden') || !screens.over.classList.contains('hidden')) play();
        else if (S.phase === 'paused') resume();
        break;
      case 'KeyP':
      case 'Escape':
        if (S.phase === 'playing') pause();
        else if (S.phase === 'paused') resume();
        break;
      case 'KeyM':
        Sfx.unlock();
        setMuted(!muted);
        break;
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') Game.setKeyFire(false); });

  // Pause automatically when the tab is hidden; the player resumes manually.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // Stop the page from scrolling / zooming on touch devices.
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
})();
