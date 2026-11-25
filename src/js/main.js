'use strict';
// UI glue: screens, HUD, input shortcuts and the CrazyGames SDK lifecycle.
(async function () {
  const $ = (id) => document.getElementById(id);
  const screens = {
    loading: $('screenLoading'), title: $('screenTitle'),
    pause: $('screenPause'), over: $('screenOver'), upgrade: $('screenUpgrade'),
  };

  // 24x24 icons for upgrades ("s" = stroked path).
  const ICONS = {
    rate: '<path class="s" d="M4 17a8 8 0 0 1 16 0"/><path class="s" d="M12 17l4.5-5.5"/>',
    multi: '<path class="s" d="M12 21V5M12 21L4.5 8M12 21l7.5-13"/>',
    pierce: '<circle class="s" cx="11" cy="12" r="4.5"/><path class="s" d="M2 12h20M18 8l4 4-4 4"/>',
    heavy: '<circle cx="12" cy="12" r="7.5"/>',
    crit: '<circle class="s" cx="12" cy="12" r="6"/><path class="s" d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    drone: '<circle class="s" cx="12" cy="12" r="7" stroke-dasharray="2.5 3"/><path d="M19 8.5l3.5 3.5-3.5 3.5-3.5-3.5z"/><circle cx="12" cy="12" r="2.5"/>',
    chain: '<path d="M13.5 2L4 14h7l-1.5 8L19 10h-7z"/>',
    magnet: '<path class="s" d="M6 3v9a6 6 0 0 0 12 0V3"/><path class="s" d="M6 7h3M15 7h3"/>',
    armor: '<path d="M12 3l8 3c0 7-3 12-8 15C7 18 4 13 4 6z"/>',
    overcharge: '<rect class="s" x="3" y="7" width="16" height="10" rx="2"/><path class="s" d="M22 11v2"/><path d="M11 8l-3 5h3l-1 3 4-5h-3l1-3z"/>',
    heal: '<path d="M12 20C4 14 3 9 6 6.5S11 6 12 8c1-2 4-4 6-1.5S20 14 12 20z"/>',
    bounty: '<circle class="s" cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>',
  };
  const icon = (id, cls) => `<svg viewBox="0 0 24 24" class="${cls || ''}">${ICONS[id] || ''}</svg>`;

  function renderChips(el) {
    const up = Game.S.up;
    el.innerHTML = Object.keys(up)
      .filter((k) => k !== 'heal' && k !== 'bounty')
      .map((k) => `<div class="chip" style="--c:${Game.UPGRADES[k].color}" title="${Game.UPGRADES[k].name}">${icon(k)}${up[k] > 1 ? up[k] : ''}</div>`)
      .join('');
  }
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

  // ---------- upgrades ----------
  const upCards = $('upCards');
  let choices = [];
  Game.on('upgrade', (list) => {
    choices = list;
    Platform.gameplayStop();
    $('upWave').textContent = S.wave;
    renderSlots();
    upCards.innerHTML = list.map((c, i) => `
      <button class="card" data-id="${c.id}" style="--c:${c.color}">
        <span class="key">${i + 1}</span>
        ${icon(c.id, 'uicon')}
        <div class="text">
          <div class="name">${c.name}</div>
          ${c.max > 1 && c.max < 99 ? `<div class="lv">LEVEL ${c.level} / ${c.max}</div>` : ''}
          <div class="desc">${c.desc}</div>
          ${c.needsDrop ? '<div class="tag">SLOTS FULL: REPLACES ONE</div>' : ''}
        </div>
      </button>`).join('');
    setDropMode(null);
    // Ignore taps for a moment so a held fire button doesn't pick a card by accident.
    upCards.classList.add('locked');
    setTimeout(() => upCards.classList.remove('locked'), 450);
    show(screens.upgrade);
  });

  // Booster slot row ("BOOSTERS [x][x][ ]")
  function renderSlots() {
    const held = Game.heldBoosters();
    let html = `<span>BOOSTERS ${held.length}/${Game.MAX_BOOSTERS}</span>`;
    for (let i = 0; i < Game.MAX_BOOSTERS; i++) {
      const k = held[i];
      html += k
        ? `<div class="slot full" style="--c:${Game.UPGRADES[k].color}" title="${Game.UPGRADES[k].name}">${icon(k)}</div>`
        : '<div class="slot"></div>';
    }
    $('upSlots').innerHTML = html;
  }

  // Drop step: shown when a new booster is picked while all slots are full.
  const upDrop = $('upDrop'), dropCards = $('dropCards');
  let pendingId = null;
  function setDropMode(id) {
    pendingId = id;
    const on = !!id;
    upCards.classList.toggle('hidden', on);
    upDrop.classList.toggle('hidden', !on);
    $('upTitle').textContent = on ? 'DROP A BOOSTER' : 'CHOOSE A BOOSTER';
    $('upHint').textContent = on ? 'Press 1 / 2 / 3 to drop, Esc to go back' : 'Tap a card, press 1 / 2 / 3, or S to skip';
    // Skip is always offered on the card step; with full slots it means "keep what I have".
    const btnSkip = $('btnSkip');
    btnSkip.classList.toggle('hidden', on);
    btnSkip.textContent = Game.heldBoosters().length >= Game.MAX_BOOSTERS ? 'KEEP MY BOOSTERS (SKIP)' : 'SKIP';
    if (!on) return;
    $('dropFor').textContent = Game.UPGRADES[id].name;
    dropCards.innerHTML = Game.heldBoosters().map((k, i) => {
      const u = Game.UPGRADES[k];
      return `
      <button class="card" data-drop="${k}" style="--real:${u.color}">
        <span class="key">${i + 1}</span>
        ${icon(k, 'uicon')}
        <div class="text">
          <div class="name">${u.name}</div>
          <div class="lv">LEVEL ${S.up[k]}: DROP IT</div>
          <div class="desc">${u.desc}</div>
        </div>
      </button>`;
    }).join('');
  }

  function finishPick(id, dropId) {
    if (!Game.pickUpgrade(id, dropId)) return;
    Sfx.unlock();
    hide(screens.upgrade);
    setDropMode(null);
    Platform.gameplayStart();
  }

  function pickUpgrade(id) {
    if (screens.upgrade.classList.contains('hidden') || upCards.classList.contains('locked') || pendingId) return;
    Sfx.unlock();
    if (Game.needsDrop(id)) {
      Sfx.click();
      setDropMode(id);
      return;
    }
    finishPick(id);
  }
  function pickDrop(dropId) {
    if (pendingId) finishPick(pendingId, dropId);
  }
  upCards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) { e.stopPropagation(); pickUpgrade(card.dataset.id); }
  });
  dropCards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) { e.stopPropagation(); pickDrop(card.dataset.drop); }
  });
  $('btnDropBack').addEventListener('click', (e) => { e.stopPropagation(); Sfx.click(); setDropMode(null); });

  function skipUpgrade() {
    if (screens.upgrade.classList.contains('hidden') || upCards.classList.contains('locked') || pendingId) return;
    if (!Game.skipUpgrade()) return;
    Sfx.unlock();
    Sfx.click();
    hide(screens.upgrade);
    Platform.gameplayStart();
  }
  $('btnSkip').addEventListener('click', (e) => { e.stopPropagation(); skipUpgrade(); });

  Game.on('bossDown', () => Platform.happytime());

  Game.on('over', (r) => {
    Platform.gameplayStop();
    renderChips($('overUps'));
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
  Game.on('banner', ({ title, sub, boss }) => {
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub || '';
    banner.classList.toggle('boss', !!boss);
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
  const hpBar = $('hpBar'), hpFill = $('hpFill'), hpText = $('hpText');
  const shBar = $('shBar'), shFill = $('shFill'), shText = $('shText');
  const pwSpread = $('pwSpread'), pwRapid = $('pwRapid'), pwShield = $('pwShield');
  const heatBar = $('heatBar'), heatFill = $('heatFill'), heatText = $('heatText');
  $('heatMark').style.left = `${Game.HEAT_RESUME * 100}%`;

  function setPower(el, key, t) {
    const on = t > 0;
    if (cache[key] !== on) { cache[key] = on; el.classList.toggle('hidden', !on); }
    if (on) el.lastElementChild.style.transform = `scaleX(${Math.min(1, t / 9)})`;
  }

  const bossBar = $('bossBar'), bossName = $('bossName'), bossBars = $('bossBars'), hudUps = $('hudUps');
  let barBoss = null; // the boss object the bars were built for

  // One bar for most bosses; one per part for bosses like the Pincers.
  function buildBossBars(boss) {
    barBoss = boss;
    const n = boss.multi ? boss.parts.length : 1;
    bossBars.innerHTML = Array.from({ length: n }, () => '<div class="bar"><i></i><span class="bar-note"></span></div>').join('');
  }

  Game.on('frame', () => {
    if (S.phase !== 'playing' && S.phase !== 'paused' && S.phase !== 'dying' && S.phase !== 'upgrade') return;
    const bossOn = !!S.boss;
    if (cache.bossOn !== bossOn) { cache.bossOn = bossOn; bossBar.classList.toggle('hidden', !bossOn); }
    if (bossOn) {
      const B = S.boss;
      if (barBoss !== B) buildBossBars(B); // e.g. the Hive bursting out of Jack in the Box
      setText('bossName', bossName, B.name);
      const bars = bossBars.children;
      if (B.multi) {
        B.parts.forEach((p, i) => {
          const fill = p.dead ? 0 : Math.max(0, p.hp / p.maxHp);
          bars[i].firstChild.style.transform = `scaleX(${fill})`;
          bars[i].lastChild.textContent = p.dead && B.reviveT > 0 ? `REVIVES IN ${Math.ceil(B.reviveT)}s` : '';
          bars[i].classList.toggle('down', p.dead);
        });
      } else {
        bars[0].firstChild.style.transform = `scaleX(${Math.max(0, B.hp / B.maxHp)})`;
      }
    }
    const upKey = JSON.stringify(S.up);
    if (cache.up !== upKey) { cache.up = upKey; renderChips(hudUps); }
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
    // HP bar
    const hpPct = Math.max(0, S.hp / S.maxHp);
    hpFill.style.transform = `scaleX(${hpPct})`;
    setText('hp', hpText, `${Math.ceil(S.hp)} / ${S.maxHp}`);
    const low = hpPct < 0.25; // matches the game's low-HP alarm
    if (cache.hpLow !== low) { cache.hpLow = low; hpBar.classList.toggle('low', low); }
    if (cache.hpVal !== undefined && S.hp < cache.hpVal) {
      hpBar.classList.remove('hit');
      void hpBar.offsetWidth;
      hpBar.classList.add('hit');
    }
    cache.hpVal = S.hp;
    // Shield booster bar (only while the shield is up)
    const shOn = S.armor > 0;
    if (cache.shOn !== shOn) { cache.shOn = shOn; shBar.classList.toggle('hidden', !shOn); }
    if (shOn) {
      shFill.style.transform = `scaleX(${S.armor / S.armorMax})`;
      setText('sh', shText, `SHIELD ${Math.ceil(S.armor)} / ${S.armorMax}`);
      if (cache.shVal !== undefined && S.armor < cache.shVal) {
        shBar.classList.remove('hit');
        void shBar.offsetWidth;
        shBar.classList.add('hit');
      }
    }
    cache.shVal = S.armor;
    // Heat meter: normal -> warning (HEAT HIGH) -> overheated (locked, cooling to the mark)
    heatFill.style.transform = `scaleX(${S.heat})`;
    const heatState = S.overheated ? 'over' : S.heat >= Game.HEAT_WARN ? 'warn' : 'ok';
    if (cache.heatState !== heatState) {
      cache.heatState = heatState;
      heatBar.classList.toggle('warn', heatState === 'warn');
      heatBar.classList.toggle('over', heatState === 'over');
    }
    setText('heat', heatText, heatState === 'over' ? 'OVERHEATED – COOLING'
      : heatState === 'warn' ? `HEAT HIGH ${Math.round(S.heat * 100)}%` : `HEAT ${Math.round(S.heat * 100)}%`);
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
    if (!screens.upgrade.classList.contains('hidden')) {
      const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (n >= 0) {
        if (pendingId) pickDrop(Game.heldBoosters()[n]);
        else if (choices[n]) pickUpgrade(choices[n].id);
        return;
      }
      if ((e.code === 'Escape' || e.code === 'Backspace') && pendingId) { setDropMode(null); return; }
      if (e.code === 'KeyS' && !pendingId) { skipUpgrade(); return; }
    }
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
