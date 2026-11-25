'use strict';
// Core gameplay: simulation, collisions and canvas rendering.
// All movement is time-based (px per second), so speed is the same at 60/144/165 Hz.
(function () {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function pickWeighted(list) {
    let total = 0;
    for (const [, w] of list) total += w;
    let r = Math.random() * total;
    for (const [k, w] of list) if ((r -= w) <= 0) return k;
    return list[list.length - 1][0];
  }

  function compact(arr) {
    let j = 0;
    for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i];
    arr.length = j;
  }

  // ---------- tuning ----------
  const PLAYER_R = 22;
  const BULLET_SPEED = 780;
  const BULLET_R = 4.5;
  const FIRE_INTERVAL = 0.16;
  const MAX_FIRE_RATE = 14;      // shots per second, no matter what is stacked
  const HEAVY_SLOWDOWN = 0.08;   // Heavy Rounds: -8% fire rate per level
  const HEAT_PER_SHOT = 0.03;    // fraction of the heat gauge each shot fills
  const OVERCLOCK_HEAT = 0.12;   // Overclock: +12% heat per shot per level
  const HEAT_COOL = 0.4;         // gauge drained per second
  const HEAT_COOL_LOCKED = 0.55; // drained per second while overheated (locked)
  const HEAT_RESUME = 0.35;      // gun unlocks once heat falls to this
  const HEAT_WARN = 0.75;        // "HEAT HIGH" warning from here up
  const RAPID_INTERVAL = 0.065;
  const POWER_TIME = 9;
  const HIT_INVULN = 0.25;  // after an ordinary hit (stops one crowd draining you in a frame)
  const COMBO_WINDOW = 2;
  const MAX_LIVES = 3;   // lives never go above 3; healing restores HP instead
  const START_LIVES = 3;
  const START_HP = 100;
  const LOW_HP = 0.25;
  const REVIVE_SHIELD = 5;     // seconds of protection after losing a life
  const BOOSTER_ORB_LIFE = 5;  // seconds to shoot lost boosters back // below this fraction of max HP: alarm + red blinking
  const MAX_HP_CAP = 250;
  const MAX_PARTICLES = 700;

  const TYPES = {
    basic:    { speed: [70, 105], r: [14, 30], dmg: 'size', score: 250, shape: 'circle', color: () => `hsl(${(Math.random() * 360) | 0},75%,62%)` },
    dart:     { speed: [190, 230], r: [10, 11], hp: 1, dmg: 8, score: 300, shape: 'tri', color: () => '#ffd84d' },
    zig:      { speed: [85, 100], r: [15, 17], hp: 2, dmg: 12, score: 350, shape: 'diamond', shrink: 3, color: () => '#ff4d9d' },
    splitter: { speed: [55, 70], r: [28, 30], hp: 3, dmg: 18, score: 400, shape: 'split', shrink: 3, color: () => '#7dff6a' },
    tank:     { speed: [36, 44], r: [40, 44], hp: 8, dmg: 30, score: 900, shape: 'hex', shrink: 2.5, color: () => '#ff8a3d' },
    mini:     { speed: [140, 170], r: [9, 10], hp: 1, dmg: 6, score: 100, shape: 'circle', color: () => '#b8ffad' },
    // boss projectiles: always 1 hit, no late-wave health scaling
    orb:      { speed: [150, 170], r: [8, 8], hp: 1, fixed: true, dmg: 10, score: 50, shape: 'orb', color: () => '#ff7dff' },
    bouncer:  { speed: [250, 270], r: [10, 10], hp: 1, fixed: true, dmg: 12, score: 80, shape: 'bouncer', color: () => '#b6ff4d' },
    // mini boss: roams outside your circle, shoots, and releases a wave of enemies when killed
    miniboss: { speed: [115, 135], r: [32, 34], hp: 24, dmg: 25, score: 1500, shape: 'miniboss', noShrink: true, color: () => '#ff6b6b' },
  };

  // Upgrades offered (pick 1 of 3) after every cleared wave. They last for the whole run.
  const UPGRADES = {
    rate:       { name: 'Overclock',        max: 4, color: '#ffd84d', desc: '+15% fire rate, but the gun heats up faster' },
    multi:      { name: 'Side Cannons',     max: 2, color: '#4dd2ff', desc: '+2 angled bullets every shot' },
    pierce:     { name: 'Piercing Rounds',  max: 3, color: '#ffffff', desc: 'Bullets pass through +1 enemy' },
    heavy:      { name: 'Heavy Rounds',     max: 3, color: '#ff8a3d', desc: 'Bigger bullets, +50% damage, but 8% slower fire' },
    crit:       { name: 'Critical Hits',    max: 3, color: '#ff4d6d', desc: '+12% chance of triple damage' },
    drone:      { name: 'Drone',            max: 3, color: '#4de8ff', desc: 'An orbiting drone shoots for you' },
    chain:      { name: 'Chain Lightning',  max: 3, color: '#9fe8ff', desc: 'Kills zap +1 nearby enemy' },
    magnet:     { name: 'Magnet',           max: 1, color: '#ff6bd0', desc: 'Power-ups fly to you' },
    armor:      { name: 'Shield',           max: 3, color: '#6fc8ff', desc: 'A shield bar takes all damage until it breaks (50 / 80 / 110)' },
    overcharge: { name: 'Overcharge',       max: 2, color: '#ffd84d', desc: 'Power-ups last 50% longer' },
    heal:       { name: 'Patch Up',         max: 99, color: '#ff6bd0', desc: '+25 max HP and heal 25 HP', w: 0.7, instant: true },
    bounty:     { name: 'Bounty',           max: 99, color: '#ffd84d', desc: '+2,000 points per wave reached', w: 0.15, instant: true },
  };
  const MAX_BOOSTERS = 3;
  const BOSS_HP_SCALE = 1.5; // every boss has 50% more health than its base value
  const ARMOR_BY_LEVEL = [0, 50, 80, 110]; // Shield booster: bar size per level

  // Bosses: one every 5 waves. Each has one signature skill.
  // r = radius, hp = health at the first boss slot, speed = movement in px/s (before screen scaling).
  const BOSSES = {
    hive:       { name: 'THE HIVE', sub: 'It births swarms. Kill it fast.', color: '#ff8a3d', r: 62, hp: 130, speed: 150 },
    teleporter: { name: 'THE TELEPORTER', sub: 'It blinks across the screen. Hit it while it is visible.', color: '#7df9ff', r: 44, hp: 110 },
    zigzag:     { name: 'THE ZIGZAG', sub: 'Fast and erratic, but it stops to fire.', color: '#ff4d9d', r: 42, hp: 100, speed: 300 },
    warden:     { name: 'THE WARDEN', sub: 'Shoot through the gap in its shield.', color: '#c77dff', r: 54, hp: 40, speed: 185 },
    slider:     { name: 'THE SLIDER', sub: 'It races along the walls.', color: '#ffd84d', r: 34, hp: 70, speed: 760 },
    ricochet:   { name: 'THE RICOCHET', sub: 'Its shots bounce until you shoot them down.', color: '#b6ff4d', r: 46, hp: 100, speed: 130 },
    serpent:    { name: 'THE SERPENT', sub: 'It hunts you across the screen. Cut it to pieces.', color: '#7dff6a', r: 19, hp: 6, segs: 14, speed: 230 },
    pincers:    { name: 'THE PINCERS', sub: 'Kill both within 5 seconds or the other revives.', color: '#ff4d6d', r: 40, hp: 60 },
    bastion:    { name: 'THE SHIELD', sub: 'Three spinning shields. Shoot through the gaps.', color: '#6fa8ff', r: 58, hp: 55, speed: 85 },
    jack:       { name: 'JACK IN THE BOX', sub: 'Something is waiting inside...', color: '#f5a623', r: 56, hp: 170, speed: 55 },
    zigserpent: { name: 'THE ZIGZAG SERPENT', sub: 'A serpent that never moves in a straight line.', color: '#ff7de0', r: 19, hp: 9, segs: 14, speed: 250 },
  };
  // Boss slot n (wave 5n) draws a random boss from pool n, so runs differ.
  // After the last pool, any boss not yet met this run (then any but the last one).
  const BOSS_POOLS = [
    ['hive', 'teleporter', 'zigzag'],
    ['warden', 'slider', 'ricochet'],
    ['serpent', 'pincers', 'bastion'],
    ['jack', 'zigserpent'],
  ];
  function bossKind(wave) {
    const slot = Math.floor(wave / 5);
    if (!S.bossPlan[slot]) {
      const seen = Object.values(S.bossPlan);
      const pool = BOSS_POOLS[slot - 1] || Object.keys(BOSSES);
      let options = pool.filter((k) => !seen.includes(k));
      if (!options.length) options = pool.filter((k) => k !== seen[seen.length - 1]);
      S.bossPlan[slot] = options[Math.floor(Math.random() * options.length)];
    }
    return S.bossPlan[slot];
  }

  const POWER = {
    spread: { color: '#4dd2ff', w: 3, label: 'SPREAD SHOT' },
    rapid:  { color: '#ffd84d', w: 3, label: 'RAPID FIRE' },
    shield: { color: '#7dffea', w: 2, label: 'SHIELD' },
    bomb:   { color: '#ff4d6d', w: 0.45, label: 'BOMB!' }, // rare
    life:   { color: '#ff6bd0', w: 0.9, label: '+30 HP' },
  };

  const TOUCH = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  const FIRE_HINT = TOUCH ? 'TOUCH & HOLD TO AIM AND FIRE' : 'HOLD MOUSE (OR SPACE) TO FIRE';
  const WAVE_INTRO = {
    1: 'Shoot everything before it reaches you.',
    2: 'New enemy: Darts. Fast and fragile.',
    3: 'New enemy: Zigzaggers. Lead your shots.',
    4: 'New enemy: Splitters. They break apart.',
    5: 'New enemy: Tanks. Keep shooting.',
  };

  // ---------- canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, U = 1, cx = 0, cy = 0;

  // ---------- state ----------
  const S = {
    phase: 'attract', // attract | playing | paused | dying | over
    lowHp: false, alarmT: 0, reviveT: 0, heat: 0, overheated: false, heatWarn: false, hasFired: false,
    score: 0, wave: 0, lives: START_LIVES, kills: 0, hp: START_HP, maxHp: START_HP,
    toSpawn: 0, spawnTimer: 0, bannerT: 0,
    invuln: 0, shield: false, spread: 0, rapid: 0,
    combo: 0, comboTimer: 0, mult: 1, bestCombo: 0,
    cool: 0, aim: -Math.PI / 2, recoil: 0,
    shake: 0, hurtFlash: 0, dyingT: 0, sinceDrop: 0,
    continued: false, time: 0,
    up: {}, boss: null, bossPending: false, waveDone: false, clearT: 0,
    armor: 0, armorMax: 0, droneCool: [], bossPlan: {}, nextBoss: null,
  };
  let bullets = [], enemies = [], particles = [], powerups = [], texts = [], rings = [], bolts = [];
  const lvl = (k) => S.up[k] || 0;
  const pointer = { x: 0, y: 0, down: false, key: false };
  const handlers = {};
  const emit = (name, a) => { if (handlers[name]) handlers[name](a); };

  const playerR = () => Math.max(15, PLAYER_R * U);
  // Enemies get 6% faster every wave (until wave 31).
  const speedMult = () => 1 + Math.min(Math.max(S.wave - 1, 0), 30) * 0.06;
  // Boss aimed shots fly at orb speed x this. Regular enemies are capped just
  // below that, so nothing in a normal wave is ever as fast as a boss attack.
  const BOSS_SHOT_SPEED = 1.5;
  const enemySpeedCap = () => 160 * BOSS_SHOT_SPEED * 0.9 * U * speedMult();
  const spawnInterval = () => Math.max(0.3, 1.0 - (S.wave - 1) * 0.06);

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const nw = window.innerWidth, nh = window.innerHeight;
    const dx = nw / 2 - cx, dy = nh / 2 - cy;
    if (W > 0) {
      for (const list of [bullets, enemies, particles, powerups, texts, rings]) {
        for (const o of list) if (o.boss) o.wT = 0; // bosses pick new on-screen targets
        for (const o of list) { o.x += dx; o.y += dy; }
      }
    }
    W = nw; H = nh; cx = W / 2; cy = H / 2;
    U = clamp(Math.min(W, H) / 800, 0.55, 1.25);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#06070e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ---------- spawning ----------
  function pickType(w) {
    const pool = [['basic', 10]];
    if (w >= 2) pool.push(['dart', 3 + w * 0.4]);
    if (w >= 3) pool.push(['zig', 3 + w * 0.3]);
    if (w >= 4) pool.push(['splitter', 2 + w * 0.2]);
    if (w >= 5) pool.push(['tank', 1 + w * 0.15]);
    return pickWeighted(pool);
  }

  function makeEnemy(type, x, y) {
    const T = TYPES[type];
    const base = rand(T.r[0], T.r[1]);
    // Enemies get tougher after wave 6 so upgrades don't trivialise late waves.
    const hpMul = S.phase === 'playing' && !T.fixed ? 1 + Math.max(0, S.wave - 6) * 0.1 : 1;
    const hp = Math.ceil((T.hp || 1 + Math.floor((base - 6) / 10)) * hpMul);
    const minR = Math.max(7, base * 0.4) * U;
    return {
      type, x, y,
      r: base * U, tr: base * U,
      shrink: hp > 1 && !T.noShrink ? (base * U - minR) / hp : 0, minR,
      hp, maxHp: hp,
      // contact damage to the player; basic enemies hit harder the bigger they are (13-21)
      dmg: T.dmg === 'size' ? Math.round(6 + base * 0.5) : T.dmg,
      speed: T.fixed
        ? rand(T.speed[0], T.speed[1]) * U * speedMult()
        : Math.min(rand(T.speed[0], T.speed[1]) * 1.1 * U * speedMult(), enemySpeedCap()),
      color: T.color(), shape: T.shape, score: T.score,
      t: rand(0, TAU), rot: rand(0, TAU), spin: rand(-2, 2),
      flash: 0, kx: 0, ky: 0, dead: false,
    };
  }

  function spawnEnemy(type) {
    const r = TYPES[type].r[1] * U + 6;
    let x, y;
    if (Math.random() < W / (W + H)) {
      x = rand(0, W);
      y = Math.random() < 0.5 ? -r : H + r;
    } else {
      x = Math.random() < 0.5 ? -r : W + r;
      y = rand(0, H);
    }
    enemies.push(makeEnemy(type, x, y));
  }

  function aliveEnemies() {
    let n = 0;
    for (const e of enemies) if (!e.dead) n++;
    return n;
  }

  function startWave(n, forceBoss) {
    S.wave = n;
    S.spawnTimer = 0;
    S.bannerT = 1.8;
    S.waveDone = false;
    if (n % 5 === 0 || forceBoss) {
      const kind = forceBoss || bossKind(n);
      const B = BOSSES[kind];
      S.nextBoss = kind;
      S.miniAt = []; // no mini bosses during boss waves
      S.toSpawn = 3 + Math.floor(n / 5) * 2;
      S.bossPending = true;
      S.bannerT = 2.4;
      emit('banner', { title: B.name, sub: B.sub, boss: true });
      Sfx.boss();
    } else {
      S.toSpawn = 6 + n * 4;
      // mini bosses from wave 3 (two from wave 12), arriving part-way through the wave
      const minis = n >= 12 ? 2 : n >= 3 ? 1 : 0;
      S.miniAt = [Math.floor(S.toSpawn * 0.6), Math.floor(S.toSpawn * 0.2)].slice(0, minis);
      emit('banner', { title: `WAVE ${n}`, sub: WAVE_INTRO[n] || '' });
      if (n > 1) Sfx.wave();
    }
  }

  function baseEnemy(fields) {
    return Object.assign({
      t: 0, rot: 0, spin: 0, flash: 0, kx: 0, ky: 0, dead: false,
      speed: 0, shrink: 0, score: 0,
    }, fields);
  }

  // ===================== BOSSES =====================

  function spawnBoss(kind, at) {
    kind = kind || S.nextBoss || 'hive';
    const tier = Math.max(1, Math.floor(S.wave / 5));
    const B = BOSSES[kind];
    const hpMul = BOSS_HP_SCALE * (1 + (tier - 1) * 0.45);
    const boss = {
      kind, name: B.name, color: B.color, tier, parts: [], hp: 0, maxHp: 0, multi: false,
      speed: (B.speed || 0) * (1 + (tier - 1) * 0.08),
      next: 0.75, // next health fraction that triggers an enemy surge
      t: 0,
    };
    S.boss = boss;
    const entry = at || { x: rand(W * 0.2, W * 0.8), y: -80 * U };
    const hp = Math.round(B.hp * hpMul);
    const add = (fields) => {
      const e = baseEnemy(Object.assign({
        type: kind, shape: kind, boss, color: B.color, r: B.r * U, hp,
        x: entry.x, y: entry.y, vx: 0, vy: 0, wT: 0, tx: cx, ty: cy,
        act: 1.5, act2: 2, spin: 0.5, entered: !!at, dmg: 30,
      }, fields));
      e.tr = e.r;
      e.maxHp = e.hp;
      boss.parts.push(e);
      enemies.push(e);
      return e;
    };

    if (kind === 'serpent' || kind === 'zigserpent') {
      const n = Math.min(24, B.segs + Math.max(0, tier - 3) * 2);
      for (let i = 0; i < n; i++) {
        const head = i === 0;
        add({
          type: 'seg', shape: 'seg', idx: i, r: (head ? 26 : B.r) * U, dmg: head ? 20 : 15,
          hp: Math.ceil(B.hp * hpMul) * (head ? 2 : 1), score: 300,
          color: head ? (kind === 'serpent' ? '#d9ff7d' : '#ffd1f5') : B.color,
          y: entry.y - i * 4, act: rand(1, 3), zigT: 0, zigSign: 1,
        });
      }
    } else if (kind === 'pincers') {
      Object.assign(boss, { multi: true, theta: rand(0, TAU), dir: 1, dirT: 3, fireT: 2, volley: 0, reviveT: 0 });
      for (let i = 0; i < 2; i++) {
        add({ type: 'pincer', shape: 'pincer', idx: i, x: i ? W + 80 * U : -80 * U, y: rand(H * 0.3, H * 0.7) });
      }
    } else if (kind === 'slider') {
      const e = add({ entered: true, state: 'pause', stateT: 1, s: 0, sTarget: 0, fired: true, dir: 0 });
      e.s = rand(0, perimLen(e));
    } else if (kind === 'teleporter') {
      const e = add({ entered: true, state: 'in', stateT: 0.6, alpha: 0, ghost: true, hugeDone: false });
      const p = teleportPoint(e);
      e.x = p.x; e.y = p.y;
    } else {
      add({
        y: at ? entry.y : -B.r * U - 20, gapA: Math.PI / 2,
        state: 'move', stateT: 2, zigT: 0, zigSign: 1, fired: false,
        jstate: 'closed', jT: 2, open: 0, volley: 0,
      });
    }
    for (const p of boss.parts) boss.maxHp += p.hp;
    boss.hp = boss.maxHp;
    shake(14);
  }

  // ---- shared movement ----

  // Radius of the ring drawn around the shooter. Bosses may never cross it.
  const arenaR = () => 110 * U;

  // Hard wall: push any boss part that overlaps the ring back out to its edge
  // and cancel the part of its velocity heading inward, so it slides around it.
  function keepOutOfArena(e) {
    const min = arenaR() + e.r + 4 * U;
    let dx = e.x - cx, dy = e.y - cy;
    let d = Math.hypot(dx, dy);
    if (d >= min) return;
    if (d < 0.001) { dx = 0; dy = -1; d = 1; }
    const nx = dx / d, ny = dy / d;
    e.x = cx + nx * min;
    e.y = cy + ny * min;
    if (e.vx !== undefined) {
      const inward = e.vx * nx + e.vy * ny;
      if (inward < 0) { e.vx -= inward * nx; e.vy -= inward * ny; }
    }
  }

  function pickBossTarget(e) {
    const m = e.r + 12 * U;
    const keepOut = arenaR() + e.r + 90 * U;
    for (let i = 0; i < 12; i++) {
      const tx = rand(m, W - m), ty = rand(m + 40 * U, H - m);
      if (Math.hypot(tx - cx, ty - cy) > keepOut || i === 11) { e.tx = tx; e.ty = ty; return; }
    }
  }

  // swerve away from the player before reaching the hard wall
  function avoidPlayer(e, speed, dt) {
    const px = e.x - cx, py = e.y - cy;
    const pd = Math.hypot(px, py) || 1;
    if (pd < arenaR() + e.r + 60 * U) {
      e.vx += (px / pd) * speed * 6 * dt;
      e.vy += (py / pd) * speed * 6 * dt;
    }
  }

  // move by velocity, stay on screen once entered, never cross the ring
  function bossIntegrate(e, dt) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    const m = e.r * 0.6;
    if (e.x > m && e.x < W - m && e.y > m && e.y < H - m) e.entered = true;
    if (e.entered) {
      e.x = clamp(e.x, m, W - m);
      e.y = clamp(e.y, m, H - m);
    }
    keepOutOfArena(e);
  }

  // smooth roaming between random points
  function bossRoam(e, speed, dt) {
    e.wT -= dt;
    if (e.wT <= 0 || Math.hypot(e.tx - e.x, e.ty - e.y) < 40 * U) {
      pickBossTarget(e);
      e.wT = rand(1.2, 2.6);
    }
    const dx = e.tx - e.x, dy = e.ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, dt * 3);
    e.vx += ((dx / d) * speed - e.vx) * k;
    e.vy += ((dy / d) * speed - e.vy) * k;
    avoidPlayer(e, speed, dt);
    bossIntegrate(e, dt);
  }

  // zig-zag: head for a target while snapping side to side
  function zigMove(e, speed, dt) {
    e.wT -= dt;
    if (e.wT <= 0 || Math.hypot(e.tx - e.x, e.ty - e.y) < 40 * U) {
      pickBossTarget(e);
      e.wT = rand(1.5, 2.5);
    }
    e.zigT -= dt;
    if (e.zigT <= 0) { e.zigT = 0.3; e.zigSign = -(e.zigSign || 1); }
    const dx = e.tx - e.x, dy = e.ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const fx = dx / d, fy = dy / d;
    const wantX = fx * speed * 0.6 - fy * speed * 0.9 * e.zigSign;
    const wantY = fy * speed * 0.6 + fx * speed * 0.9 * e.zigSign;
    const k = Math.min(1, dt * 14);
    e.vx += (wantX - e.vx) * k;
    e.vy += (wantY - e.vy) * k;
    avoidPlayer(e, speed, dt);
    bossIntegrate(e, dt);
  }

  // ---- shared attacks ----

  // aimed shots at the player; `spread` = list of angle offsets
  function bossShoot(e, spread) {
    const a = Math.atan2(cy - e.y, cx - e.x);
    for (const o of spread || [0]) {
      const orb = makeEnemy('orb', e.x + Math.cos(a + o) * e.r, e.y + Math.sin(a + o) * e.r);
      orb.speed *= BOSS_SHOT_SPEED;
      orb.kx = Math.cos(a + o) * orb.speed * 0.8;
      orb.ky = Math.sin(a + o) * orb.speed * 0.8;
      enemies.push(orb);
    }
  }

  // a "wave": a ring of shots that bursts outward, then curves in toward the player
  function orbWave(e, n, kick, offset) {
    for (let i = 0; i < n; i++) {
      const a = (offset || 0) + (i / n) * TAU;
      const orb = makeEnemy('orb', e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
      orb.kx = Math.cos(a) * kick * U;
      orb.ky = Math.sin(a) * kick * U;
      enemies.push(orb);
    }
    ring(e.x, e.y, e.color, e.r * 2.2, 3);
  }

  function hugeWave(e) {
    const n = Math.min(36, 24 + e.boss.tier * 2);
    orbWave(e, n, 320, 0);
    orbWave(e, n, 560, Math.PI / n);
    ring(e.x, e.y, '#ffffff', 260 * U, 5);
    floatText(e.x, e.y - e.r - 18 * U, 'HUGE WAVE!', e.color, 1.4);
    shake(16);
    Sfx.surge();
  }

  // ---- per-boss behaviour ----

  function updateBoss(e, dt) {
    const tier = e.boss.tier;
    const live = S.phase === 'playing' && e.entered;
    if (live) { e.act -= dt; e.act2 -= dt; }
    switch (e.type) {
      case 'hive':
        bossRoam(e, e.boss.speed * U, dt);
        if (!live) break;
        if (e.act <= 0) {
          e.act = Math.max(0.9, 1.8 - tier * 0.2);
          const n = 2 + Math.min(2, tier - 1);
          for (let i = 0; i < n; i++) {
            const a = rand(0, TAU);
            const m = makeEnemy(Math.random() < 0.5 ? 'dart' : 'mini', e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
            m.kx = Math.cos(a) * 120 * U;
            m.ky = Math.sin(a) * 120 * U;
            enemies.push(m);
          }
          ring(e.x, e.y, e.color, e.r * 1.8, 2);
        }
        if (e.act2 <= 0) {
          e.act2 = Math.max(0.55, 1.0 - tier * 0.1);
          bossShoot(e);
        }
        break;

      case 'warden':
        bossRoam(e, e.boss.speed * U, dt);
        e.gapA += 1.1 * dt;
        if (live && e.act <= 0) {
          e.act = Math.max(0.35, 0.7 - tier * 0.08);
          bossShoot(e, tier >= 2 ? [-0.28, 0, 0.28] : [0]);
        }
        break;

      case 'teleporter': updateTeleporter(e, dt, live); break;
      case 'zigzag': updateZigzag(e, dt, live); break;
      case 'slider': updateSlider(e, dt, live); break;

      case 'ricochet':
        bossRoam(e, e.boss.speed * U, dt);
        // fires a full ring of bouncing shots in every direction; the ring rotates each volley
        if (live && e.act <= 0) {
          e.act = Math.max(1.3, 2.1 - tier * 0.12);
          let bouncers = 0;
          for (const o of enemies) if (!o.dead && o.type === 'bouncer') bouncers++;
          const cap = 14 + tier * 3; // most bouncing shots allowed on screen at once
          const n = Math.min(6 + tier, 10);
          const room = Math.min(n, cap - bouncers);
          if (room > 0) {
            e.volley = (e.volley || 0) + 1;
            const offset = e.volley * (Math.PI / n); // half a step each volley
            // near the cap, fire only what fits, still spaced evenly round the circle
            for (let i = 0; i < room; i++) {
              const a = offset + (i / room) * TAU;
              const b = makeEnemy('bouncer', e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
              b.vx = Math.cos(a) * b.speed;
              b.vy = Math.sin(a) * b.speed;
              enemies.push(b);
            }
            ring(e.x, e.y, e.color, e.r * 2, 3);
          }
        }
        break;

      case 'bastion':
        bossRoam(e, e.boss.speed * U, dt);
        e.gapA += (0.9 + tier * 0.08) * dt;
        if (live && e.act <= 0) {
          e.act = Math.max(0.7, 1.3 - tier * 0.1);
          e.volley++;
          const fan = e.volley % 3 === 0 ? [-0.3, 0, 0.3] : [0];
          for (let k = 0; k < 3; k++) {
            const a = e.gapA + (k / 3) * TAU; // fire out of each gap
            for (const o of fan) {
              const orb = makeEnemy('orb', e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
              orb.kx = Math.cos(a + o) * 330 * U;
              orb.ky = Math.sin(a + o) * 330 * U;
              enemies.push(orb);
            }
          }
        }
        break;

      case 'jack':
        bossRoam(e, e.boss.speed * U, dt);
        e.jT -= dt;
        if (e.jstate === 'closed') {
          e.open = Math.max(0, e.open - dt * 5);
          if (live && e.jT <= 0) { e.jstate = 'open'; e.jT = 1.1; e.fired = false; Sfx.boing(); }
        } else {
          e.open = Math.min(1, e.open + dt * 6);
          if (!e.fired && e.open >= 1 && live) {
            e.fired = true;
            orbWave(e, Math.min(26, 14 + tier * 2), 400, rand(0, TAU));
            bossShoot(e, [-0.3, 0, 0.3]);
            shake(8);
          }
          if (e.jT <= 0) { e.jstate = 'closed'; e.jT = Math.max(1.6, 2.6 - tier * 0.15); }
        }
        break;
    }
  }

  // Teleporter: visible for a moment, fades out, reappears somewhere far from you and fires a wave.
  function teleportPoint(e) {
    const m = e.r + 14 * U;
    const minFromPlayer = arenaR() + e.r + 170 * U;
    let best = null, bestD = -1;
    for (let i = 0; i < 24; i++) {
      const x = rand(m, W - m), y = rand(m + 44 * U, H - m);
      const dp = Math.hypot(x - cx, y - cy);
      const moved = Math.hypot(x - e.x, y - e.y);
      if (dp >= minFromPlayer && moved > 150 * U) return { x, y };
      if (dp > bestD) { bestD = dp; best = { x, y }; }
    }
    return best; // tiny screens: the farthest point found
  }

  function updateTeleporter(e, dt, live) {
    const tier = e.boss.tier;
    e.vx = e.vy = 0;
    e.stateT -= dt;
    if (e.state === 'show') {
      e.alpha = 1; e.ghost = false;
      if (e.stateT <= 0) {
        e.state = 'out'; e.stateT = 0.35;
        Sfx.tele();
      }
    } else if (e.state === 'out') {
      e.alpha = Math.max(0, e.stateT / 0.35); e.ghost = true;
      if (e.stateT <= 0) {
        burst(e.x, e.y, e.color, 25, 10);
        const p = teleportPoint(e);
        e.x = p.x; e.y = p.y;
        e.state = 'in'; e.stateT = 0.3;
      }
    } else if (e.state === 'in') {
      e.alpha = 1 - Math.max(0, e.stateT / 0.3); e.ghost = true;
      if (e.stateT <= 0) {
        e.state = 'show'; e.stateT = Math.max(0.9, 1.7 - tier * 0.12);
        e.alpha = 1; e.ghost = false;
        burst(e.x, e.y, e.color, 25, 10);
        if (live) orbWave(e, Math.min(20, 10 + tier * 2), 380, rand(0, TAU));
      }
    }
    // last stand
    if (live && !e.hugeDone && e.hp <= e.maxHp * 0.15) {
      e.hugeDone = true;
      hugeWave(e);
    }
  }

  // ZigZag: fast side-to-side dashes; stops, charges, fires a wave, then moves on.
  function updateZigzag(e, dt, live) {
    const tier = e.boss.tier;
    e.stateT -= dt;
    if (e.state === 'move') {
      zigMove(e, e.boss.speed * U, dt);
      if (e.stateT <= 0 && e.entered) { e.state = 'pause'; e.stateT = 0.9; e.fired = false; }
    } else {
      e.vx *= Math.exp(-12 * dt);
      e.vy *= Math.exp(-12 * dt);
      bossIntegrate(e, dt);
      if (!e.fired && e.stateT < 0.45 && live) {
        e.fired = true;
        orbWave(e, Math.min(22, 12 + tier * 2), 380, rand(0, TAU));
      }
      if (e.stateT <= 0) { e.state = 'move'; e.stateT = rand(1.8, 2.6); }
    }
  }

  // Slider: runs along the screen edges (a rectangle just inside the walls).
  function sliderRect(e) {
    const m = e.r + 8 * U;
    return { x0: m, y0: m + 95 * U, x1: W - m, y1: H - m }; // top track stays below the HUD
  }
  function perimLen(e) {
    const R = sliderRect(e);
    return 2 * ((R.x1 - R.x0) + (R.y1 - R.y0));
  }
  function perimPoint(e, s) {
    const R = sliderRect(e);
    const w = R.x1 - R.x0, h = R.y1 - R.y0, L = 2 * (w + h);
    s = ((s % L) + L) % L;
    if (s < w) return { x: R.x0 + s, y: R.y0, dir: 0 };
    s -= w;
    if (s < h) return { x: R.x1, y: R.y0 + s, dir: Math.PI / 2 };
    s -= h;
    if (s < w) return { x: R.x1 - s, y: R.y1, dir: Math.PI };
    s -= w;
    return { x: R.x0, y: R.y1 - s, dir: -Math.PI / 2 };
  }

  function updateSlider(e, dt, live) {
    const tier = e.boss.tier;
    const L = perimLen(e);
    if (e.state === 'slide') {
      let diff = e.sTarget - e.s;
      diff = (((diff % L) + L * 1.5) % L) - L / 2; // shortest way round
      const step = e.boss.speed * U * dt;
      if (Math.abs(diff) <= step) {
        e.s = e.sTarget;
        e.state = 'pause';
        e.stateT = Math.max(0.35, 0.7 - tier * 0.06);
        e.fired = false;
      } else {
        e.s += Math.sign(diff) * step;
        if (particles.length < MAX_PARTICLES) {
          particles.push({ x: e.x + rand(-e.r, e.r) * 0.5, y: e.y + rand(-e.r, e.r) * 0.5, vx: 0, vy: 0, r: rand(1.5, 3) * U, color: e.color, life: 0.35, max: 0.5, dead: false });
        }
      }
      e.sliding = true;
    } else {
      e.sliding = false;
      e.stateT -= dt;
      if (!e.fired && live) {
        e.fired = true;
        bossShoot(e, tier >= 2 ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.3, 0, 0.3]);
      }
      if (e.stateT <= 0) {
        e.state = 'slide';
        e.sTarget = e.s + (Math.random() < 0.5 ? -1 : 1) * rand(0.2, 0.5) * L;
      }
    }
    const p = perimPoint(e, e.s);
    e.x = p.x; e.y = p.y; e.dir = p.dir;
    keepOutOfArena(e);
  }

  // Serpent / ZigZag Serpent: the first living segment leads; the rest follow it.
  function updateSerpent(dt) {
    const B = S.boss;
    let leader = null;
    for (const e of B.parts) {
      if (e.dead) continue;
      if (!leader) {
        if (B.kind === 'zigserpent') zigMove(e, B.speed * U, dt);
        else bossRoam(e, B.speed * U, dt);
      } else {
        const dx = leader.x - e.x, dy = leader.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const gap = (leader.r + e.r) * 0.9;
        if (d > gap) {
          e.x += (dx / d) * (d - gap);
          e.y += (dy / d) * (d - gap);
        }
        e.vx = dx; e.vy = dy;
        e.entered = leader.entered;
        keepOutOfArena(e); // body segments can't cut through the ring either
      }
      if (S.phase === 'playing' && e.entered) {
        e.act -= dt;
        if (e.act <= 0) {
          const head = !leader;
          e.act = head ? Math.max(0.45, 0.85 - B.tier * 0.06) : Math.max(1.6, 3.2 - B.tier * 0.2);
          if (head || e.idx % 4 === 0) bossShoot(e);
        }
      }
      leader = e;
    }
  }

  // Pincers: a pair on opposite sides of you, circling and firing together.
  function updatePincers(dt) {
    const B = S.boss;
    const tier = B.tier;
    B.t += dt;
    B.dirT -= dt;
    if (B.dirT <= 0) { B.dir *= -1; B.dirT = rand(2.5, 4.5); }
    B.theta += B.dir * (0.9 + tier * 0.08) * dt;
    const f = 0.75 + Math.sin(B.t * 0.9) * 0.2;
    const alive = B.parts.filter((p) => !p.dead);
    for (const e of alive) {
      const a = B.theta + e.idx * Math.PI;
      const rx = W / 2 - e.r - 12 * U, ry = H / 2 - e.r - 48 * U;
      const tx = cx + Math.cos(a) * rx * f, ty = cy + Math.sin(a) * ry * f;
      const k = Math.min(1, dt * 3);
      e.vx = (tx - e.x) * 3; e.vy = (ty - e.y) * 3;
      e.x += (tx - e.x) * k;
      e.y += (ty - e.y) * k;
      keepOutOfArena(e);
      if (e.x > 0 && e.x < W && e.y > 0 && e.y < H) e.entered = true;
      e.rot = Math.atan2(cy - e.y, cx - e.x);
    }
    if (S.phase !== 'playing') return;
    if (alive.length && alive.every((p) => p.entered)) {
      B.fireT -= dt;
      if (B.fireT <= 0) {
        B.fireT = Math.max(0.8, 1.5 - tier * 0.1);
        B.volley++;
        for (const p of alive) {
          if (B.volley % 3 === 0) orbWave(p, 8, 320, B.theta);
          else bossShoot(p, [-0.22, 0, 0.22]);
        }
      }
    }
    if (alive.length === 1 && B.reviveT > 0) {
      B.reviveT -= dt;
      if (B.reviveT <= 0) {
        const e = B.parts.find((p) => p.dead);
        e.dead = false;
        e.hp = e.maxHp;
        e.flash = 0.3;
        e.x = cx + (cx - alive[0].x);
        e.y = cy + (cy - alive[0].y);
        enemies.push(e);
        ring(e.x, e.y, e.color, 200 * U, 5);
        burst(e.x, e.y, e.color, 50, 20);
        floatText(e.x, e.y - e.r - 14 * U, 'REVIVED!', e.color, 1.4);
        Sfx.boss();
      }
    }
  }

  // ===================== MINI BOSSES =====================
  // Three kinds, each with its own firing pattern.
  const MINI_KINDS = {
    gunner:  { name: 'GUNNER',  color: '#ff6b6b', every: 1.3 }, // aimed single shots
    spitter: { name: 'SPITTER', color: '#ffb84d', every: 1.9 }, // 3-shot fans
    orbiter: { name: 'ORBITER', color: '#c38bff', every: 2.6 }, // rings of shots
  };

  function spawnMiniBoss() {
    const kinds = Object.keys(MINI_KINDS);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const r = 40 * U;
    let x, y;
    if (Math.random() < W / (W + H)) { x = rand(W * 0.15, W * 0.85); y = Math.random() < 0.5 ? -r : H + r; }
    else { x = Math.random() < 0.5 ? -r : W + r; y = rand(H * 0.2, H * 0.8); }
    const e = makeEnemy('miniboss', x, y);
    Object.assign(e, {
      kind, color: MINI_KINDS[kind].color,
      vx: 0, vy: 0, wT: 0, tx: cx, ty: cy, entered: false,
      act: 0.6, spin: 1.2,
    });
    enemies.push(e);
    floatText(clamp(x, 60, W - 60), clamp(y, 80, H - 40), `MINI BOSS: ${MINI_KINDS[kind].name}`, e.color, 1.2);
    Sfx.surge();
  }

  function updateMiniBoss(e, dt) {
    bossRoam(e, e.speed, dt);
    const visible = e.x > 0 && e.x < W && e.y > 0 && e.y < H;
    if (S.phase !== 'playing' || !visible) return;
    e.act -= dt;
    if (e.act > 0) return;
    const tierUp = Math.min(0.5, S.wave * 0.02); // fires a little faster in later waves
    e.act = MINI_KINDS[e.kind].every * (1 - tierUp);
    if (e.kind === 'gunner') bossShoot(e);
    else if (e.kind === 'spitter') bossShoot(e, [-0.3, 0, 0.3]);
    else orbWave(e, 8, 320, e.rot);
  }

  // Killed: a ring of enemies bursts out of it, plus a guaranteed power-up.
  function miniBossDown(e) {
    const n = Math.min(14, 6 + Math.floor(S.wave / 3));
    const pool = S.wave >= 8 ? ['dart', 'mini', 'zig'] : ['dart', 'mini'];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const m = makeEnemy(pool[i % pool.length], e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
      m.kx = Math.cos(a) * 260 * U;
      m.ky = Math.sin(a) * 260 * U;
      enemies.push(m);
    }
    ring(e.x, e.y, e.color, 200 * U, 5);
    burst(e.x, e.y, e.color, 50, 20);
    floatText(e.x, e.y - e.r - 14 * U, 'ENEMY WAVE!', e.color, 1.2);
    shake(12);
    Sfx.surge();
    dropPower(e.x, e.y);
  }

  // Every 25% of boss health lost, it bursts out a ring of enemies.
  function bossSurge() {
    const B = S.boss;
    const src = B.parts.find((p) => !p.dead);
    if (!src) return;
    const n = Math.min(16, 8 + B.tier * 2);
    const pool = B.tier >= 2 ? ['dart', 'mini', 'zig'] : ['dart', 'mini'];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const m = makeEnemy(pool[i % pool.length], src.x + Math.cos(a) * src.r, src.y + Math.sin(a) * src.r);
      m.kx = Math.cos(a) * 280 * U;
      m.ky = Math.sin(a) * 280 * U;
      enemies.push(m);
    }
    ring(src.x, src.y, B.color, 260 * U, 6);
    ring(src.x, src.y, '#ffffff', 160 * U, 3);
    floatText(src.x, src.y - src.r - 16 * U, 'ENEMY WAVE!', B.color, 1.3);
    shake(14);
    Sfx.surge();
  }

  // Smallest angle between a and b (0..PI). Works for any size of angle: the shield
  // rotation angles keep growing, and JS % returns negatives for negative inputs.
  const angDiff = (a, b) => {
    let d = (a - b) % TAU;
    if (d < 0) d += TAU;
    return d > Math.PI ? TAU - d : d;
  };
  // Warden: one wide gap. Shield (bastion): three narrow gaps.
  const inWardenGap = (e, a) => angDiff(a, e.gapA) < 0.6;
  // Shield boss gap half-width in radians (0.38 = each gap is about 44 degrees wide)
  const BASTION_GAP = 0.38;
  const inBastionGap = (e, a) => [0, 1, 2].some((k) => angDiff(a, e.gapA + (k / 3) * TAU) < BASTION_GAP);
  function deflects(e, a) {
    if (e.type === 'warden') return !inWardenGap(e, a);
    if (e.type === 'bastion') return !inBastionGap(e, a);
    return false;
  }

  // called from killEnemy for every boss part
  function bossPartKilled(e) {
    const B = e.boss;
    if (e.type === 'pincer') {
      burst(e.x, e.y, e.color, 70, 30);
      ring(e.x, e.y, e.color, 220 * U, 5);
      if (S.phase === 'playing') hugeWave(e);
      if (!B.parts.every((p) => p.dead)) {
        B.reviveT = 5;
        floatText(cx, cy - 90 * U, 'KILL THE OTHER IN 5s!', e.color, 1.3);
      }
    }
    if (B.parts.every((p) => p.dead)) bossDown(e);
  }

  function bossDown(e) {
    const B = S.boss;
    if (!B) return;
    const bonus = 4000 * B.tier;
    addScore(bonus);
    floatText(e.x, e.y - 30 * U, `BOSS DOWN +${bonus.toLocaleString('en-US')}`, '#ffd84d', 1.7);
    burst(e.x, e.y, B.color, 120, 40);
    burst(e.x, e.y, '#ffffff', 60, 30);
    ring(e.x, e.y, B.color, 320 * U, 6);
    ring(e.x, e.y, '#ffffff', 200 * U, 3);
    shake(30);
    Sfx.bomb();
    S.boss = null;
    for (let i = 0; i < 2; i++) dropPower(e.x + rand(-40, 40) * U, e.y + rand(-40, 40) * U);
    // Boss reward: HP always refills to full, plus +1 life if below 3 lives.
    // Beating a boss is the only way to gain a life. Jack's reward waits for the Hive inside it.
    if (B.kind !== 'jack' && S.phase === 'playing') {
      S.hp = S.maxHp;
      if (S.lives < MAX_LIVES) {
        S.lives++;
        floatText(cx, cy - 110 * U, '+1 LIFE  ·  HP RESTORED', '#ff6bd0', 1.5);
      } else {
        floatText(cx, cy - 110 * U, 'HP RESTORED', '#7dffea', 1.4);
      }
      ring(cx, cy, '#ff6bd0', 180 * U, 4);
      Sfx.power();
    }
    emit('bossDown', { tier: B.tier });
    // Jack in the Box: a Hive bursts out of the broken box.
    if (B.kind === 'jack' && S.phase === 'playing') {
      spawnBoss('hive', { x: e.x, y: e.y });
      emit('banner', { title: 'THE HIVE', sub: 'It was hiding in the box!', boss: true });
      Sfx.boss();
    }
  }

  // ---------- effects ----------
  function burst(x, y, color, count, power) {
    count = Math.min(count, MAX_PARTICLES - particles.length);
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(30, 120 + power * 6) * U;
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: rand(1, 2.6) * Math.max(U, 0.8), color,
        life: rand(0.5, 1.3), max: 1.3, dead: false,
      });
    }
  }

  function ring(x, y, color, max, width) {
    rings.push({ x, y, r: 4, max, color, width: width || 3, life: 1, dead: false });
  }

  function floatText(x, y, text, color, size) {
    texts.push({ x, y, text, color, size: size || 1, life: 1, dead: false });
  }

  function shake(amount) {
    S.shake = Math.max(S.shake, amount * Math.max(U, 0.7));
  }

  function addScore(pts) {
    if (S.phase !== 'playing') return;
    S.score += pts;
  }

  function updateMult() {
    S.mult = Math.min(5, 1 + Math.floor(S.combo / 5) * 0.5);
    if (S.combo > S.bestCombo) S.bestCombo = S.combo;
  }

  function knockback(radius, force) {
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - cx, dy = e.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      if (d < radius) {
        const f = force * (1 - d / radius) + force * 0.3;
        e.kx += (dx / d) * f;
        e.ky += (dy / d) * f;
      }
    }
  }

  // ---------- enemies ----------
  function killEnemy(e, opts) {
    if (e.dead) return;
    e.dead = true;
    burst(e.x, e.y, e.color, 8 + e.r / U * 0.9, e.r / U);
    if (!opts.silent && S.phase !== 'attract') Sfx.explode(e.r / U);
    shake(Math.min(9, (e.r / U) * 0.18));
    if (e.r / U > 26) ring(e.x, e.y, e.color, e.r * 2.4, 2);

    if (opts.score && S.phase === 'playing') {
      S.combo++;
      S.comboTimer = COMBO_WINDOW;
      updateMult();
      const pts = Math.round(e.score * S.mult);
      addScore(pts);
      S.kills++;
      if (pts > 0) floatText(e.x, e.y, '+' + pts, e.color, S.mult > 1 ? 1.15 : 1);
      if (opts.drop) maybeDrop(e.x, e.y);
    }

    if (e.boss) bossPartKilled(e);

    if (opts.chain && lvl('chain') > 0 && S.phase === 'playing') {
      const range = 170 * Math.max(U, 0.75);
      const targets = enemies
        .filter((o) => !o.dead && !o.ghost && Math.hypot(o.x - e.x, o.y - e.y) < range + o.r)
        .sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))
        .slice(0, lvl('chain'));
      for (const o of targets) {
        bolts.push({ x1: e.x, y1: e.y, x2: o.x, y2: o.y, life: 1 });
        damageEnemy(o, 1, o.x, o.y, 0, 0, false);
      }
      if (targets.length) Sfx.zap();
    }

    if (e.type === 'miniboss' && opts.score) miniBossDown(e);

    if (opts.split && e.type === 'splitter') {
      const base = Math.atan2(cy - e.y, cx - e.x);
      for (let i = -1; i <= 1; i++) {
        const a = base + Math.PI / 2 * i;
        const m = makeEnemy('mini', e.x + Math.cos(a) * e.r * 0.6, e.y + Math.sin(a) * e.r * 0.6);
        m.kx = Math.cos(a) * 160 * U;
        m.ky = Math.sin(a) * 160 * U;
        enemies.push(m);
      }
    }
  }

  // canChain: false for damage that itself came from chain lightning (no endless chains).
  function damageEnemy(e, dmg, hx, hy, kvx, kvy, canChain) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.07;
    burst(hx, hy, e.color, 4, 2);
    if (e.hp <= 0) {
      killEnemy(e, { score: true, drop: !e.boss, split: true, chain: canChain });
      return;
    }
    if (e.shrink) e.tr = Math.max(e.minR, e.tr - e.shrink * dmg);
    if (!e.boss) {
      const mass = e.type === 'tank' ? 0.015 : 0.05;
      e.kx += kvx * mass;
      e.ky += kvy * mass;
    }
    addScore(Math.round((e.boss ? 25 : 100) * S.mult));
    Sfx.hit();
  }

  function hitEnemy(e, b) {
    let dmg = b.dmg;
    if (lvl('crit') > 0 && Math.random() < lvl('crit') * 0.12) {
      dmg *= 3;
      floatText(b.x, b.y - 12 * U, 'CRIT', '#ff4d6d', 0.8);
    }
    damageEnemy(e, dmg, b.x, b.y, b.vx, b.vy, true);
  }

  // The Shield booster's bar hit 0: shatter it and free its booster slot.
  function breakArmor() {
    S.armor = 0;
    S.armorMax = 0;
    delete S.up.armor;
    const col = UPGRADES.armor.color;
    const pr = playerR();
    // glass shards flying off the ring
    for (let i = 0; i < 40 && particles.length < MAX_PARTICLES; i++) {
      const a = rand(0, TAU);
      const sp = rand(120, 380) * U;
      particles.push({
        x: cx + Math.cos(a) * (pr + 12 * U), y: cy + Math.sin(a) * (pr + 12 * U),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: rand(1.5, 3.5) * U, color: Math.random() < 0.5 ? col : '#ffffff',
        life: rand(0.5, 1.1), max: 1.1, dead: false,
      });
    }
    ring(cx, cy, col, 200 * U, 4);
    ring(cx, cy, '#ffffff', 120 * U, 2);
    floatText(cx, cy - 90 * U, 'SHIELD BROKEN', col, 1.4);
    shake(14);
    Sfx.shatter();
  }

  function touchPlayer(e) {
    // Bosses never die from touching you; everything else explodes on contact.
    if (!e.boss || e.type === 'seg') killEnemy(e, { score: false, silent: false });
    if (S.phase !== 'playing') return;
    if (S.shield) {
      S.shield = false;
      ring(cx, cy, POWER.shield.color, 170 * U, 4);
      knockback(200 * U, 380 * U);
      Sfx.shieldBreak();
      S.invuln = Math.max(S.invuln, 0.5);
      return;
    }
    if (S.invuln > 0) return;

    // Each enemy deals its own damage.
    const dmg = e.dmg || 10;

    // Shield booster: while the shield bar is up it takes the whole hit and HP is untouched.
    if (S.armor > 0) {
      S.armor = Math.max(0, S.armor - dmg);
      floatText(cx + rand(-20, 20) * U, cy - playerR() - 14 * U, `-${dmg}`, UPGRADES.armor.color, 1.1);
      shake(4 + dmg * 0.15);
      knockback(140 * U, 220 * U);
      S.invuln = HIT_INVULN;
      if (S.armor <= 0) breakArmor();
      else Sfx.shieldHit();
      return;
    }
    S.hp = Math.max(0, S.hp - dmg);
    S.combo = 0;
    S.comboTimer = 0;
    updateMult();
    floatText(cx + rand(-20, 20) * U, cy - playerR() - 14 * U, `-${dmg}`, '#ff4d6d', 1.1);
    S.hurtFlash = Math.min(0.35, 0.1 + dmg / 120);
    shake(6 + dmg * 0.25);
    S.invuln = HIT_INVULN;
    Sfx.hurt();
    if (S.hp > 0) {
      knockback(160 * U, 260 * U);
      return;
    }

    // HP gone: lose a life.
    S.lives--;
    if (S.lives <= 0) { die(); return; }
    S.hp = S.maxHp;
    lifeLostBlast();
    startReviveShield();
    S.hurtFlash = 0.45;
    floatText(cx, cy - 90 * U, 'LIFE LOST', '#ff4d6d', 1.5);
    const lost = dropAllBoosters();
    if (lost.length) {
      scatterBoosters(lost);
      floatText(cx, cy - 64 * U, 'SHOOT YOUR BOOSTERS BACK!', '#ffd84d', 1.1);
    }
  }

  // Losing a life sets off a blast that destroys every enemy inside the ring
  // around the shooter. Enemies outside it are left exactly as they are.
  function lifeLostBlast() {
    const R = arenaR();
    for (const e of enemies) {
      if (e.dead || e.boss) continue;
      if (Math.hypot(e.x - cx, e.y - cy) < R + e.r) killEnemy(e, { score: false, silent: true });
    }
    ring(cx, cy, '#ff4d6d', R * 1.15, 8);
    ring(cx, cy, '#ffffff', R * 0.85, 4);
    burst(cx, cy, '#ff4d6d', 60, 18);
    burst(cx, cy, '#ffd84d', 30, 14);
    shake(24);
    Sfx.bomb();
  }

  // 5 seconds of full protection after coming back, shown as a bubble with a countdown ring.
  function startReviveShield() {
    S.invuln = REVIVE_SHIELD;
    S.reviveT = REVIVE_SHIELD;
    S.heat = 0; S.heatWarn = false;
    S.overheated = false;
  }

  // A new life starts with empty booster slots. Instant cards (Patch Up's extra
  // max HP, Bounty) were never in a slot, so they stay. Returns the boosters that were held.
  function dropAllBoosters() {
    const held = heldBoosters();
    for (const k of held) delete S.up[k];
    S.armor = 0;
    S.armorMax = 0;
    S.droneCool = [];
    return held;
  }

  // Lost boosters fly out as orbs for BOOSTER_ORB_LIFE seconds; shooting one brings
  // that booster back at level 1.
  function scatterBoosters(list) {
    const n = list.length;
    const base = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * TAU;
      const d = playerR() + arenaR() * 0.9;
      powerups.push({
        type: 'booster', k: list[i],
        x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
        vx: Math.cos(a) * 150 * U, vy: Math.sin(a) * 150 * U,
        r: Math.max(15, 20 * U), life: BOOSTER_ORB_LIFE, t: 0, dead: false,
      });
    }
  }

  function recoverBooster(p) {
    const k = p.k;
    const U2 = UPGRADES[k];
    if (lvl(k) === 0 && heldBoosters().length < MAX_BOOSTERS) {
      applyUpgrade(k); // back at level 1
      floatText(p.x, p.y - 14 * U, `${U2.name} RECOVERED`, U2.color, 1.1);
    }
    ring(p.x, p.y, U2.color, 90 * U, 3);
    burst(p.x, p.y, U2.color, 20, 10);
  }

  function die() {
    S.phase = 'dying';
    S.dyingT = 1.2;
    S.spread = S.rapid = 0;
    S.shield = false;
    pointer.down = false;
    burst(cx, cy, '#ffffff', 90, 30);
    burst(cx, cy, '#4de8ff', 50, 24);
    ring(cx, cy, '#ffffff', Math.max(W, H) * 0.7, 6);
    shake(30);
    Sfx.over();
    // Keep the boss alive so a rewarded "continue" resumes the fight.
    for (const e of enemies) if (!e.boss) killEnemy(e, { score: false, silent: true });
    for (const p of powerups) p.dead = true;
  }

  // ---------- power-ups ----------
  function maybeDrop(x, y) {
    if (S.phase !== 'playing') return;
    S.sinceDrop++;
    let live = 0;
    for (const p of powerups) if (!p.dead) live++;
    if (live >= 2) return;
    if (Math.random() > 0.075 && S.sinceDrop < 22) return;
    dropPower(x, y);
  }

  function dropPower(x, y) {
    S.sinceDrop = 0;
    const pool = Object.keys(POWER)
      .filter((k) => !(k === 'life' && S.hp >= S.maxHp))
      .map((k) => [k, POWER[k].w]);
    const type = pickWeighted(pool);
    const a = rand(0, TAU);
    powerups.push({
      type, x, y, vx: Math.cos(a) * 28 * U, vy: Math.sin(a) * 28 * U,
      r: Math.max(13, 17 * U), life: 9, t: 0, dead: false,
    });
  }

  function collect(p) {
    p.dead = true;
    if (p.type === 'booster') { recoverBooster(p); Sfx.power(); return; }
    const P = POWER[p.type];
    ring(p.x, p.y, P.color, 90 * U, 3);
    burst(p.x, p.y, P.color, 20, 10);
    floatText(p.x, p.y - 10, P.label, P.color, 1.2);
    Sfx.power();
    const dur = POWER_TIME * (1 + 0.5 * lvl('overcharge'));
    switch (p.type) {
      case 'spread': S.spread = dur; break;
      case 'rapid': S.rapid = dur; break;
      case 'shield': S.shield = true; break;
      case 'life': S.hp = Math.min(S.maxHp, S.hp + 30); break;
      case 'bomb': bomb(true); break;
    }
  }

  function bomb(scored) {
    ring(cx, cy, '#ff4d6d', Math.hypot(W, H) * 0.6, 8);
    ring(cx, cy, '#ffffff', Math.hypot(W, H) * 0.45, 3);
    shake(22);
    Sfx.bomb();
    for (const e of enemies) {
      if (e.dead) continue;
      // Bombs never touch bosses or mini bosses.
      if (e.boss || e.type === 'miniboss') continue;
      killEnemy(e, { score: scored, drop: false, split: false, silent: true });
    }
  }

  // ---------- shooting ----------
  function makeBullet(x, y, a, opts) {
    const sp = BULLET_SPEED * Math.max(U, 0.75);
    const heavy = lvl('heavy');
    bullets.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      r: Math.max(3, BULLET_R * U) * (1 + 0.3 * heavy) * (opts.scale || 1),
      dmg: (1 + 0.5 * heavy) * (opts.dmg || 1),
      pierce: lvl('pierce'), hits: [],
      color: opts.color || '#ffffff', dead: false,
    });
  }

  function fire() {
    const a0 = S.aim;
    const offsets = [0];
    if (S.spread > 0) offsets.push(-0.18, 0.18);
    for (let k = 1; k <= lvl('multi'); k++) offsets.push(-0.32 * k, 0.32 * k);
    const pr = playerR();
    for (const o of offsets) {
      const a = a0 + o;
      makeBullet(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr, a, {});
    }
    S.recoil = 1;
    if (S.phase === 'playing') Sfx.shoot();
  }

  // Seconds between shots. Overclock and Rapid Fire speed it up, Heavy Rounds slow it
  // down 8% per level, and nothing can push it past MAX_FIRE_RATE shots per second.
  const fireInterval = () => Math.max(
    1 / MAX_FIRE_RATE,
    FIRE_INTERVAL * Math.pow(0.85, lvl('rate'))
      * (S.rapid > 0 ? RAPID_INTERVAL / FIRE_INTERVAL : 1)
      / (1 - HEAVY_SLOWDOWN * lvl('heavy')),
  );

  // ---- overheat ----
  // Every shot adds heat (more with Overclock); heat cools off continuously.
  // At full heat the gun locks until it has cooled to HEAT_RESUME.
  function tryFire() {
    if (S.cool > 0 || S.overheated) return;
    S.hasFired = true;
    fire();
    S.cool = fireInterval();
    S.heat += HEAT_PER_SHOT * (1 + OVERCLOCK_HEAT * lvl('rate'));
    // early warning once per climb past HEAT_WARN
    if (!S.heatWarn && S.heat >= HEAT_WARN && S.heat < 1) {
      S.heatWarn = true;
      Sfx.heatWarn();
    }
    if (S.heat >= 1) {
      S.heat = 1;
      S.overheated = true;
      floatText(cx, cy - playerR() - 30 * U, 'OVERHEAT!', '#ff6b3d', 1.3);
      for (let i = 0; i < 14 && particles.length < MAX_PARTICLES; i++) {
        const a = S.aim + rand(-0.5, 0.5);
        const sp = rand(30, 90) * U;
        particles.push({
          x: cx + Math.cos(S.aim) * playerR() * 1.3, y: cy + Math.sin(S.aim) * playerR() * 1.3,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20 * U,
          r: rand(2, 4) * U, color: '#9aa3ad', life: rand(0.6, 1.1), max: 1.1, dead: false,
        });
      }
      Sfx.overheat();
    }
  }

  function coolGun(dt) {
    S.heat = Math.max(0, S.heat - (S.overheated ? HEAT_COOL_LOCKED : HEAT_COOL) * dt);
    if (S.heatWarn && !S.overheated && S.heat < HEAT_WARN - 0.15) S.heatWarn = false;
    if (S.overheated && S.heat <= HEAT_RESUME) {
      S.overheated = false;
      Sfx.cooled();
    }
  }

  function dronePos(i, n) {
    const a = S.time * 1.8 + (i / n) * TAU;
    const d = playerR() * 2.4;
    return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d };
  }

  // ---------- upgrades ----------
  function rollUpgrades() {
    const pool = Object.keys(UPGRADES)
      .filter((k) => lvl(k) < UPGRADES[k].max)
      .filter((k) => !(k === 'heal' && S.maxHp >= MAX_HP_CAP))
      .map((k) => [k, UPGRADES[k].w || 1]);
    const out = [];
    while (out.length < 3 && pool.length) {
      const k = pickWeighted(pool);
      out.push(k);
      pool.splice(pool.findIndex((p) => p[0] === k), 1);
    }
    return out.map((k) => ({
      id: k, name: UPGRADES[k].name, desc: UPGRADES[k].desc, color: UPGRADES[k].color,
      level: lvl(k) + 1, max: UPGRADES[k].max, needsDrop: needsDrop(k),
    }));
  }

  // Only MAX_BOOSTERS different boosters can be held at once. Levelling up one you
  // already have is always allowed; instant cards (+1 life, points) don't take a slot.
  const heldBoosters = () => Object.keys(S.up).filter((k) => S.up[k] > 0 && !UPGRADES[k].instant);
  const needsDrop = (k) => !UPGRADES[k].instant && lvl(k) === 0 && heldBoosters().length >= MAX_BOOSTERS;

  function dropBooster(k) {
    delete S.up[k];
    if (k === 'drone') S.droneCool = [];
    if (k === 'armor') { S.armor = 0; S.armorMax = 0; }
    floatText(cx, cy + 60 * U, `${UPGRADES[k].name} dropped`, '#8da2bb', 0.9);
  }

  function applyUpgrade(k) {
    S.up[k] = lvl(k) + 1;
    if (k === 'heal') {
      S.maxHp = Math.min(MAX_HP_CAP, S.maxHp + 25);
      S.hp = Math.min(S.maxHp, S.hp + 25);
    }
    if (k === 'bounty') addScore(2000 * S.wave);
    if (k === 'armor') {
      // each level raises the shield bar's size and refills it
      S.armorMax = ARMOR_BY_LEVEL[Math.min(lvl('armor'), ARMOR_BY_LEVEL.length - 1)];
      S.armor = S.armorMax;
    }
    ring(cx, cy, UPGRADES[k].color, 160 * U, 4);
    burst(cx, cy, UPGRADES[k].color, 30, 12);
    Sfx.power();
  }

  function nearestEnemy() {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (e.dead || e.ghost || e.x < 0 || e.x > W || e.y < 0 || e.y > H) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------- update ----------
  function update(dt) {
    S.time += dt;
    S.shake = Math.max(0, S.shake - dt * 60);
    S.hurtFlash = Math.max(0, S.hurtFlash - dt);
    S.recoil = Math.max(0, S.recoil - dt * 10);

    const playing = S.phase === 'playing';
    const attract = S.phase === 'attract';

    // aiming & firing
    S.cool = Math.max(0, S.cool - dt);
    if (playing) {
      S.aim = Math.atan2(pointer.y - cy, pointer.x - cx);
      coolGun(dt);
      if (pointer.down || pointer.key) tryFire();
      S.invuln = Math.max(0, S.invuln - dt);
      S.reviveT = Math.max(0, S.reviveT - dt);

      // critical HP (below 25%): repeating alarm, and the shooter blinks red (see drawPlayer)
      const wasLow = S.lowHp;
      S.lowHp = S.hp / S.maxHp < LOW_HP;
      if (S.lowHp) {
        S.alarmT = wasLow ? S.alarmT - dt : 0;
        if (S.alarmT <= 0) {
          Sfx.lowHp();
          S.alarmT = 1.0;
        }
      }
      S.spread = Math.max(0, S.spread - dt);
      S.rapid = Math.max(0, S.rapid - dt);
      if (S.comboTimer > 0) {
        S.comboTimer -= dt;
        if (S.comboTimer <= 0) { S.combo = 0; updateMult(); }
      }

      // drones auto-fire at the nearest enemy
      const nd = lvl('drone');
      for (let i = 0; i < nd; i++) {
        S.droneCool[i] = (S.droneCool[i] || 0) - dt;
        if (S.droneCool[i] > 0) continue;
        const p = dronePos(i, nd);
        let best = null, bd = Infinity;
        for (const e of enemies) {
          if (e.dead || e.ghost || e.x < 0 || e.x > W || e.y < 0 || e.y > H) continue;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          makeBullet(p.x, p.y, Math.atan2(best.y - p.y, best.x - p.x), { color: '#4de8ff', scale: 0.8 });
          S.droneCool[i] = 0.55;
        }
      }
    } else if (attract) {
      const target = nearestEnemy();
      if (target) {
        const want = Math.atan2(target.y - cy, target.x - cx);
        let diff = ((want - S.aim + Math.PI * 3) % TAU) - Math.PI;
        S.aim += diff * Math.min(1, dt * 10);
        if (S.cool <= 0 && Math.abs(diff) < 0.15) {
          fire();
          S.cool = 0.24;
        }
      }
    }

    // waves
    if (playing) {
      if (S.waveDone) {
        // short breather, then offer upgrades
        S.clearT -= dt;
        if (S.clearT <= 0) {
          S.waveDone = false;
          S.phase = 'upgrade';
          pointer.down = false;
          pointer.key = false;
          emit('upgrade', rollUpgrades());
        }
      } else if (S.bannerT > 0) {
        S.bannerT -= dt;
        if (S.bannerT <= 0 && S.bossPending) {
          S.bossPending = false;
          spawnBoss();
        }
      } else if (S.toSpawn > 0) {
        S.spawnTimer -= dt;
        if (S.spawnTimer <= 0) {
          S.spawnTimer = spawnInterval() * rand(0.7, 1.3) * (S.boss ? 1.8 : 1);
          const n = S.wave >= 6 && Math.random() < 0.2 ? 2 : 1;
          for (let i = 0; i < n && S.toSpawn > 0; i++, S.toSpawn--) spawnEnemy(pickType(S.wave));
          while (S.miniAt && S.miniAt.length && S.toSpawn <= S.miniAt[0]) {
            S.miniAt.shift();
            spawnMiniBoss();
          }
        }
      } else if (aliveEnemies() === 0 && !S.boss) {
        const bonus = 250 * S.wave;
        addScore(bonus);
        floatText(cx, cy - 70 * U, `WAVE CLEAR +${bonus}`, '#4de8ff', 1.5);
        S.waveDone = true;
        S.clearT = 1.1;
      }
    } else if (attract) {
      S.spawnTimer -= dt;
      if (S.spawnTimer <= 0 && aliveEnemies() < 7) {
        S.spawnTimer = rand(0.5, 1.1);
        spawnEnemy(pickType(4));
      }
    } else if (S.phase === 'dying') {
      S.dyingT -= dt;
      if (S.dyingT <= 0) {
        S.phase = 'over';
        emit('over', { score: S.score, wave: S.wave, kills: S.kills, bestCombo: S.bestCombo, continued: S.continued });
      }
    }

    // bullets (sub-stepped so fast bullets never skip small enemies)
    const pr = playerR();
    for (const b of bullets) {
      if (b.dead) continue;
      const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 8));
      const sdt = dt / steps;
      for (let s = 0; s < steps && !b.dead; s++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) {
          b.dead = true;
          break;
        }
        for (const p of powerups) {
          if (!p.dead && Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r) { b.dead = true; collect(p); break; }
        }
        if (b.dead) break;
        for (const e of enemies) {
          if (e.dead || e.ghost || b.hits.includes(e)) continue;
          if (Math.hypot(b.x - e.x, b.y - e.y) >= e.r + b.r) continue;
          if (deflects(e, Math.atan2(b.y - e.y, b.x - e.x))) {
            // deflected by the shield
            b.dead = true;
            burst(b.x, b.y, '#ffffff', 3, 1);
            Sfx.tink();
            break;
          }
          hitEnemy(e, b);
          if (b.pierce > 0) {
            b.pierce--;
            b.hits.push(e);
          } else {
            b.dead = true;
            break;
          }
        }
      }
    }

    // enemies
    const damp = Math.exp(-4 * dt);
    if (S.boss && (S.boss.kind === 'serpent' || S.boss.kind === 'zigserpent')) updateSerpent(dt);
    if (S.boss && S.boss.kind === 'pincers') updatePincers(dt);
    for (const e of enemies) {
      if (e.dead) continue;
      e.t += dt;
      e.rot += e.spin * dt;
      if (e.flash > 0) e.flash -= dt;
      e.r += (e.tr - e.r) * Math.min(1, dt * 14);
      if (e.boss) {
        if (e.type !== 'seg' && e.type !== 'pincer') updateBoss(e, dt);
      } else if (e.type === 'miniboss') {
        updateMiniBoss(e, dt);
      } else if (e.type === 'bouncer') {
        // flies straight and bounces off the walls until shot down
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.x < e.r) { e.x = e.r; e.vx = Math.abs(e.vx); }
        if (e.x > W - e.r) { e.x = W - e.r; e.vx = -Math.abs(e.vx); }
        if (e.y < e.r) { e.y = e.r; e.vy = Math.abs(e.vy); }
        if (e.y > H - e.r) { e.y = H - e.r; e.vy = -Math.abs(e.vy); }
        e.rot += dt * 6;
      } else {
        const dx = cx - e.x, dy = cy - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = dx / d, ny = dy / d;
        let vx = nx * e.speed, vy = ny * e.speed;
        if (e.type === 'zig') {
          const w = Math.cos(e.t * 4) * e.speed * 1.6;
          vx += -ny * w;
          vy += nx * w;
        }
        e.x += (vx + e.kx) * dt;
        e.y += (vy + e.ky) * dt;
        e.kx *= damp;
        e.ky *= damp;
      }
      if ((playing || attract) && !e.ghost && Math.hypot(cx - e.x, cy - e.y) < e.r + pr) touchPlayer(e);
    }
    if (S.boss) {
      S.boss.hp = 0;
      for (const p of S.boss.parts) if (!p.dead) S.boss.hp += Math.max(0, p.hp);
      while (playing && S.boss && S.boss.next > 0 && S.boss.hp / S.boss.maxHp <= S.boss.next) {
        S.boss.next -= 0.25;
        bossSurge();
      }
    }

    // power-ups drift and bounce inside the screen
    for (const p of powerups) {
      if (p.dead) continue;
      p.t += dt;
      p.life -= dt;
      const pColor = p.type === 'booster' ? UPGRADES[p.k].color : POWER[p.type].color;
      if (p.life <= 0) { p.dead = true; burst(p.x, p.y, pColor, 10, 4); continue; }
      if (p.type === 'booster') { const f = Math.exp(-1.2 * dt); p.vx *= f; p.vy *= f; }
      if (lvl('magnet') > 0 && playing) {
        const dx = cx - p.x, dy = cy - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < pr + p.r) { collect(p); continue; }
        p.vx += (dx / d) * 260 * U * dt;
        p.vy += (dy / d) * 260 * U * dt;
        const sp = Math.hypot(p.vx, p.vy), max = 220 * U;
        if (sp > max) { p.vx *= max / sp; p.vy *= max / sp; }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const m = p.r + 8;
      if (p.x < m || p.x > W - m) { p.vx *= -1; p.x = clamp(p.x, m, W - m); }
      if (p.y < m + 50 || p.y > H - m) { p.vy *= -1; p.y = clamp(p.y, m + 50, H - m); }
    }

    // particles, rings, texts
    const fr = Math.exp(-1.6 * dt);
    for (const p of particles) {
      p.vx *= fr; p.vy *= fr;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) p.dead = true;
    }
    for (const r of rings) {
      r.life -= dt * 1.8;
      r.r += (r.max - r.r) * Math.min(1, dt * 7);
      if (r.life <= 0) r.dead = true;
    }
    for (const t of texts) {
      t.y -= 40 * dt * U;
      t.life -= dt * 0.9;
      if (t.life <= 0) t.dead = true;
    }
    for (const b of bolts) {
      b.life -= dt * 5;
      if (b.life <= 0) b.dead = true;
    }

    compact(bullets); compact(enemies); compact(powerups);
    compact(particles); compact(rings); compact(texts); compact(bolts);
  }

  // ---------- render ----------
  function drawIcon(type, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, s * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (type) {
      case 'spread':
        for (const a of [-0.55, 0, 0.55]) {
          ctx.moveTo(0, s * 0.45);
          ctx.lineTo(Math.sin(a) * s * 0.9, s * 0.45 - Math.cos(a) * s * 0.9);
        }
        ctx.stroke();
        break;
      case 'rapid':
        for (const o of [-0.25, 0.25]) {
          ctx.moveTo((o - 0.2) * s, -0.4 * s);
          ctx.lineTo((o + 0.2) * s, 0);
          ctx.lineTo((o - 0.2) * s, 0.4 * s);
        }
        ctx.stroke();
        break;
      case 'shield':
        ctx.moveTo(0, -0.5 * s);
        ctx.lineTo(0.42 * s, -0.32 * s);
        ctx.quadraticCurveTo(0.42 * s, 0.3 * s, 0, 0.52 * s);
        ctx.quadraticCurveTo(-0.42 * s, 0.3 * s, -0.42 * s, -0.32 * s);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'bomb':
        ctx.arc(0, 0.08 * s, 0.36 * s, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0.2 * s, -0.22 * s);
        ctx.quadraticCurveTo(0.35 * s, -0.55 * s, 0.5 * s, -0.42 * s);
        ctx.stroke();
        break;
      case 'life':
        ctx.moveTo(0, 0.45 * s);
        ctx.bezierCurveTo(-0.7 * s, -0.05 * s, -0.35 * s, -0.6 * s, 0, -0.22 * s);
        ctx.bezierCurveTo(0.35 * s, -0.6 * s, 0.7 * s, -0.05 * s, 0, 0.45 * s);
        ctx.fill();
        break;
    }
    ctx.restore();
  }

  function polygon(x, y, r, sides, rot) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * TAU;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawEnemyBody(e) {
    const col = e.flash > 0 ? '#ffffff' : e.color;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    switch (e.shape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.fill();
        break;
      case 'tri': {
        const a = Math.atan2(cy - e.y, cx - e.x);
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * e.r * 1.5, e.y + Math.sin(a) * e.r * 1.5);
        ctx.lineTo(e.x + Math.cos(a + 2.5) * e.r, e.y + Math.sin(a + 2.5) * e.r);
        ctx.lineTo(e.x + Math.cos(a - 2.5) * e.r, e.y + Math.sin(a - 2.5) * e.r);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'diamond':
        polygon(e.x, e.y, e.r * 1.25, 4, e.rot);
        ctx.fill();
        break;
      case 'split':
        ctx.lineWidth = Math.max(2, e.r * 0.18);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.9, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const a = e.rot + (i / 3) * TAU;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * e.r * 0.38, e.y + Math.sin(a) * e.r * 0.38, e.r * 0.24, 0, TAU);
          ctx.fill();
        }
        break;
      case 'hex':
        polygon(e.x, e.y, e.r, 6, e.rot * 0.3);
        ctx.fill();
        ctx.fillStyle = 'rgba(6,7,14,0.55)';
        polygon(e.x, e.y, e.r * 0.55 * (1 - e.hp / e.maxHp) + e.r * 0.12, 6, e.rot * 0.3);
        ctx.fill();
        break;
      case 'orb':
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.fill();
        ctx.restore();
        break;
      case 'hive': {
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 30;
        polygon(e.x, e.y, e.r, 6, e.rot * 0.4);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#2a1206';
        polygon(e.x, e.y, e.r * 0.72, 6, e.rot * 0.4);
        ctx.fill();
        // six spawning cells around a pulsing core
        ctx.fillStyle = col;
        for (let i = 0; i < 6; i++) {
          const a = e.rot * 0.4 + (i / 6) * TAU + Math.PI / 6;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * e.r * 0.45, e.y + Math.sin(a) * e.r * 0.45, e.r * 0.13, 0, TAU);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (0.2 + Math.sin(e.t * 5) * 0.04), 0, TAU);
        ctx.fill();
        break;
      }
      case 'warden': {
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 26;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.62, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#16061f';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.3, 0, TAU);
        ctx.fill();
        // shield: a thick arc everywhere except the gap
        ctx.lineWidth = e.r * 0.2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = e.flash > 0 ? '#ffffff' : '#e7c6ff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.9, e.gapA + 0.6, e.gapA - 0.6 + TAU);
        ctx.stroke();
        ctx.lineCap = 'butt';
        break;
      }
      case 'seg': {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(6,7,14,0.5)';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.45 * (1 - e.hp / e.maxHp) + e.r * 0.15, 0, TAU);
        ctx.fill();
        if (e.idx === 0) {
          const a = Math.atan2(e.vy || 0, e.vx || 1); // eyes face the direction of travel
          ctx.fillStyle = '#06070e';
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(e.x + Math.cos(a + s * 0.6) * e.r * 0.55, e.y + Math.sin(a + s * 0.6) * e.r * 0.55, e.r * 0.16, 0, TAU);
            ctx.fill();
          }
        }
        break;
      }

      case 'miniboss': {
        // octagon with a spinning inner core and its own health bar
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 18;
        polygon(e.x, e.y, e.r, 8, e.rot * 0.3);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#12060a';
        polygon(e.x, e.y, e.r * 0.62, 8, e.rot * 0.3);
        ctx.fill();
        ctx.fillStyle = col;
        if (e.kind === 'gunner') {
          const a = Math.atan2(cy - e.y, cx - e.x);
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * e.r * 0.25, e.y + Math.sin(a) * e.r * 0.25, e.r * 0.22, 0, TAU);
          ctx.fill();
        } else if (e.kind === 'spitter') {
          polygon(e.x, e.y, e.r * 0.36, 3, e.rot);
          ctx.fill();
        } else {
          for (let i = 0; i < 4; i++) {
            const a = e.rot + (i / 4) * TAU;
            ctx.beginPath();
            ctx.arc(e.x + Math.cos(a) * e.r * 0.32, e.y + Math.sin(a) * e.r * 0.32, e.r * 0.1, 0, TAU);
            ctx.fill();
          }
        }
        const bw = e.r * 2, bh = Math.max(4, 5 * U), by = e.y - e.r - 12 * U;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(e.x - bw / 2, by, bw, bh);
        ctx.fillStyle = e.color;
        ctx.fillRect(e.x - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), bh);
        break;
      }

      // ----- new bosses -----
      case 'teleporter': {
        // spinning diamond core inside a dashed halo, with four orbiting sparks
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 26;
        polygon(e.x, e.y, e.r * 0.8, 4, e.t * 1.5);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#062a2e';
        polygon(e.x, e.y, e.r * 0.4, 4, -e.t * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 1.05, e.t, e.t + TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col;
        for (let i = 0; i < 4; i++) {
          const a = -e.t * 2.5 + (i / 4) * TAU;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * e.r * 1.05, e.y + Math.sin(a) * e.r * 1.05, e.r * 0.1, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'zigzag': {
        // four-point throwing star; swells while charging a wave
        const charge = e.state === 'pause' ? 1 + Math.sin(e.t * 30) * 0.06 + 0.12 : 1;
        const spinA = e.t * (e.state === 'pause' ? 12 : 5);
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = e.state === 'pause' ? 36 : 20;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = spinA + (i / 8) * TAU;
          const rr = (i % 2 === 0 ? e.r * 1.15 : e.r * 0.45) * charge;
          ctx[i ? 'lineTo' : 'moveTo'](e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#2a0618';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.22, 0, TAU);
        ctx.fill();
        break;
      }
      case 'slider': {
        // capsule lying along the wall it rides
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.dir || 0);
        ctx.shadowColor = e.color;
        ctx.shadowBlur = e.sliding ? 30 : 16;
        const len = e.r * (e.sliding ? 1.9 : 1.4), hgt = e.r * 0.75;
        ctx.beginPath();
        ctx.arc(-len + hgt, 0, hgt, Math.PI / 2, Math.PI * 1.5);
        ctx.arc(len - hgt, 0, hgt, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#2a2206';
        ctx.fillRect(-len * 0.5, -hgt * 0.25, len, hgt * 0.5);
        ctx.restore();
        break;
      }
      case 'pincer': {
        // a thick "C" claw opening toward the player
        const a = e.rot || 0;
        const open = 0.55 + Math.sin(e.t * 6) * 0.15;
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 22;
        ctx.lineWidth = e.r * 0.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.75, a + open, a - open + TAU);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#2a0610';
        ctx.beginPath();
        ctx.arc(e.x - Math.cos(a) * e.r * 0.15, e.y - Math.sin(a) * e.r * 0.15, e.r * 0.25, 0, TAU);
        ctx.fill();
        break;
      }
      case 'ricochet': {
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 22;
        ctx.lineWidth = e.r * 0.22;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.85, 0, TAU);
        ctx.stroke();
        ctx.restore();
        polygon(e.x, e.y, e.r * 0.5, 3, e.t * 2.2);
        ctx.fill();
        break;
      }
      case 'bouncer':
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        polygon(e.x, e.y, e.r * 1.2, 4, e.rot);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#16200a';
        polygon(e.x, e.y, e.r * 0.5, 4, e.rot);
        ctx.fill();
        break;
      case 'bastion': {
        // core plus three spinning shield arcs with narrow gaps
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.55, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#081430';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.25, 0, TAU);
        ctx.fill();
        ctx.lineWidth = e.r * 0.18;
        ctx.strokeStyle = e.flash > 0 ? '#ffffff' : '#cfe0ff';
        for (let k = 0; k < 3; k++) {
          const g = e.gapA + (k / 3) * TAU;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r * 0.9, g + BASTION_GAP, g + TAU / 3 - BASTION_GAP);
          ctx.stroke();
        }
        break;
      }
      case 'jack': {
        // box with a hinged lid; the jack springs out when it opens
        const s = e.r * 0.85;
        const open = e.open || 0;
        if (open > 0.05) {
          const top = e.y - s - open * e.r * 1.2;
          ctx.strokeStyle = '#ffe7b0';
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let i = 0; i <= 8; i++) {
            const yy = e.y - s + (top - (e.y - s)) * (i / 8);
            ctx.lineTo(e.x + (i % 2 ? 8 : -8) * U, yy);
          }
          ctx.stroke();
          ctx.fillStyle = '#ff4d6d';
          ctx.beginPath();
          ctx.arc(e.x, top, e.r * 0.38, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#06070e';
          for (const sx of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(e.x + sx * e.r * 0.13, top - e.r * 0.05, e.r * 0.06, 0, TAU);
            ctx.fill();
          }
        }
        ctx.save();
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 20;
        ctx.fillStyle = col;
        ctx.fillRect(e.x - s, e.y - s, s * 2, s * 2);
        ctx.restore();
        ctx.fillStyle = 'rgba(6,7,14,0.35)';
        ctx.fillRect(e.x - s * 0.15, e.y - s, s * 0.3, s * 2);
        ctx.fillRect(e.x - s, e.y - s * 0.15, s * 2, s * 0.3);
        // lid, hinged at its left edge
        ctx.save();
        ctx.translate(e.x - s, e.y - s);
        ctx.rotate(-open * 1.9);
        ctx.fillStyle = e.flash > 0 ? '#ffffff' : '#ffc35c';
        ctx.fillRect(0, -s * 0.28, s * 2, s * 0.28);
        ctx.restore();
        break;
      }
    }
  }

  function drawEnemy(e) {
    if (e.alpha !== undefined && e.alpha < 1) {
      if (e.alpha <= 0.02) return;
      ctx.save();
      ctx.globalAlpha = e.alpha;
      drawEnemyBody(e);
      ctx.restore();
      return;
    }
    drawEnemyBody(e);
  }

  // A lost booster waiting to be shot back: glowing hexagon in the booster's colour,
  // with its name and a ring showing how long is left.
  function drawBoosterOrb(p) {
    if (p.life < 1.5 && Math.floor(p.life * 10) % 2 === 0) return;
    const col = UPGRADES[p.k].color;
    const pulse = 1 + Math.sin(p.t * 8) * 0.1;
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 24;
    ctx.fillStyle = 'rgba(6,7,14,0.8)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    polygon(p.x, p.y, p.r * pulse, 6, p.t * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = col;
    polygon(p.x, p.y, p.r * 0.4, 4, -p.t * 3);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.35, -Math.PI / 2, -Math.PI / 2 + TAU * (p.life / BOOSTER_ORB_LIFE));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `800 ${Math.round(10 + 3 * U)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(UPGRADES[p.k].name.toUpperCase(), p.x, p.y - p.r * 1.45);
  }

  function drawBolts() {
    ctx.save();
    ctx.strokeStyle = '#bff4ff';
    ctx.shadowColor = '#4de8ff';
    ctx.shadowBlur = 12;
    for (const b of bolts) {
      ctx.globalAlpha = Math.max(0, b.life);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      const steps = 6;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        ctx.lineTo(b.x1 + (b.x2 - b.x1) * t + rand(-8, 8), b.y1 + (b.y2 - b.y1) * t + rand(-8, 8));
      }
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDrones() {
    const n = lvl('drone');
    if (!n || S.phase === 'dying' || S.phase === 'over' || S.phase === 'attract') return;
    ctx.fillStyle = '#4de8ff';
    for (let i = 0; i < n; i++) {
      const p = dronePos(i, n);
      polygon(p.x, p.y, Math.max(6, 8 * U), 4, S.time * 4);
      ctx.fill();
    }
  }

  function drawPlayer() {
    const pr = playerR();
    if (S.phase === 'dying' || S.phase === 'over') return;
    const blink = S.invuln > 0 && S.reviveT <= 0 && Math.floor(S.invuln * 14) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;

    // barrel(s)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(S.aim);
    // barrel glows orange when hot and flashes red while overheated
    ctx.fillStyle = S.overheated ? (Math.floor(S.time * 10) % 2 ? '#ff3b3b' : '#ff8a3d')
      : S.heat > 0.7 ? '#ff8a3d'
      : S.rapid > 0 ? POWER.rapid.color : S.spread > 0 ? POWER.spread.color : '#cfefff';
    const back = S.recoil * 5 * U;
    const bw = pr * 0.42;
    ctx.fillRect(pr * 0.3 - back, -bw / 2, pr * 1.0, bw);
    if (S.spread > 0) {
      for (const a of [-0.2, 0.2]) {
        ctx.save();
        ctx.rotate(a);
        ctx.fillRect(pr * 0.3 - back, -bw / 3, pr * 0.85, bw * 0.66);
        ctx.restore();
      }
    }
    ctx.restore();

    // body (blinks red about 3 times a second while HP is critical)
    const redBlink = S.lowHp && Math.floor(S.time * 6) % 2 === 0;
    ctx.shadowColor = S.lowHp ? '#ff3b5c' : '#7fe9ff';
    ctx.shadowBlur = S.lowHp ? 30 : 22;
    ctx.fillStyle = redBlink ? '#ff3b5c' : '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0d1a2a';
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 0.42, 0, TAU);
    ctx.fill();
    ctx.fillStyle = S.lowHp ? '#ff3b5c' : '#4de8ff';
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 0.22, 0, TAU);
    ctx.fill();

    if (S.shield) {
      ctx.strokeStyle = POWER.shield.color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.6 + Math.sin(S.time * 8) * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, pr + 10 * U + Math.sin(S.time * 4) * 2, 0, TAU);
      ctx.stroke();
    }
    // First-run onboarding: pulse a "how to fire" prompt until the first shot
    if (S.phase === 'playing' && S.wave === 1 && !S.hasFired) {
      ctx.globalAlpha = 0.65 + 0.35 * Math.sin(S.time * 5);
      ctx.font = `800 ${Math.round(13 * U + 3)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.fillStyle = '#7dffea';
      const hy = cy + arenaR() + 16 * U;
      ctx.strokeText(FIRE_HINT, cx, hy);
      ctx.fillText(FIRE_HINT, cx, hy);
      ctx.globalAlpha = 1;
    }
    // Heat gauge: a thin arc hugging the shooter, yellow -> orange -> red
    if (S.heat > 0.02 && S.phase !== 'attract') {
      const hcol = S.overheated ? (Math.floor(S.time * 10) % 2 ? '#ff3b3b' : '#ffffff')
        : S.heat > 0.75 ? '#ff4d3d' : S.heat > 0.45 ? '#ff8a3d' : '#ffd84d';
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, pr + 5 * U, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = hcol;
      ctx.beginPath();
      ctx.arc(cx, cy, pr + 5 * U, Math.PI / 2, Math.PI / 2 + TAU * S.heat);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // warning label under the shooter
      const label = S.overheated ? 'OVERHEATED' : S.heat >= HEAT_WARN ? 'HEAT HIGH' : '';
      if (label && (S.overheated || Math.floor(S.time * 6) % 2)) {
        ctx.font = `800 ${Math.round(12 * U + 2)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.fillStyle = S.overheated ? hcol : '#ff8a3d';
        const ly = cy + pr + 14 * U;
        ctx.strokeText(label, cx, ly);
        ctx.fillText(label, cx, ly);
      }
    }
    // Revive shield: bubble plus a ring that counts down the 5 seconds
    if (S.reviveT > 0) {
      const f = S.reviveT / REVIVE_SHIELD;
      const rr = pr + 24 * U;
      ctx.globalAlpha = 0.12 + 0.06 * Math.sin(S.time * 10);
      ctx.fillStyle = '#bff4ff';
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = S.reviveT < 1 && Math.floor(S.reviveT * 10) % 2 === 0 ? 0.3 : 0.95;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Shield booster: a hexagonal bubble that fades and thins as the bar drains
    if (S.armor > 0 && S.armorMax > 0) {
      const f = S.armor / S.armorMax;
      ctx.globalAlpha = 0.25 + 0.55 * f;
      ctx.strokeStyle = UPGRADES.armor.color;
      ctx.lineWidth = 1.5 + 3 * f;
      polygon(cx, cy, pr + 18 * U, 6, S.time * 0.6);
      ctx.stroke();
      ctx.globalAlpha = 0.06 + 0.08 * f;
      ctx.fillStyle = UPGRADES.armor.color;
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(6,7,14,0.3)';
    ctx.fillRect(0, 0, W, H);

    let sx = 0, sy = 0;
    if (S.shake > 0 && S.phase !== 'paused') {
      sx = rand(-1, 1) * S.shake * 0.5;
      sy = rand(-1, 1) * S.shake * 0.5;
    }
    ctx.setTransform(DPR, 0, 0, DPR, sx * DPR, sy * DPR);

    // arena hint
    ctx.strokeStyle = 'rgba(77,232,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, arenaR(), 0, TAU);
    ctx.stroke();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;

    for (const r of rings) {
      ctx.globalAlpha = Math.max(0, r.life);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const p of powerups) {
      if (p.type === 'booster') { drawBoosterOrb(p); continue; }
      if (p.life < 2.5 && Math.floor(p.life * 8) % 2 === 0) continue;
      const P = POWER[p.type];
      const pulse = 1 + Math.sin(p.t * 6) * 0.08;
      ctx.save();
      ctx.shadowColor = P.color;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = P.color;
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(6,7,14,0.75)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * pulse, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      drawIcon(p.type, p.x, p.y, p.r * 1.05, P.color);
    }

    for (const b of bullets) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }

    for (const e of enemies) drawEnemy(e);
    drawBolts();
    drawDrones();
    drawPlayer();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of texts) {
      ctx.globalAlpha = Math.min(1, t.life * 1.6);
      ctx.fillStyle = t.color;
      ctx.font = `800 ${Math.round((13 + 5 * U) * t.size)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    if (S.hurtFlash > 0) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = `rgba(255,40,80,${S.hurtFlash * 0.45})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt <= 0) return;
    if (dt > 0.05) dt = 0.05;
    if (S.phase !== 'paused') update(dt);
    draw();
    emit('frame', S);
  }

  // ---------- input ----------
  function setPointer(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setPointer(e);
    if (S.phase !== 'playing') return;
    pointer.down = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    S.aim = Math.atan2(pointer.y - cy, pointer.x - cx);
    tryFire();
  });
  canvas.addEventListener('pointermove', setPointer);
  const release = () => { pointer.down = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => { pointer.down = false; pointer.key = false; });
  window.addEventListener('resize', resize);

  // ---------- public API ----------
  function clearField(withFx, keepBoss) {
    for (const e of enemies) {
      if (keepBoss && e.boss) continue;
      e.boss = null; // so killing parts here never triggers a boss-down reward
      if (withFx) killEnemy(e, { score: false, silent: true });
      else e.dead = true;
    }
    if (!keepBoss) S.boss = null;
    bullets.length = 0;
    powerups.length = 0;
    bolts.length = 0;
    compact(enemies);
  }

  window.Game = {
    S,
    on(name, fn) { handlers[name] = fn; },
    pointer,
    POWER,
    UPGRADES,
    MAX_LIVES,
    HEAT_WARN,
    HEAT_RESUME,

    newRun() {
      clearField(true);
      Object.assign(S, {
        phase: 'playing', score: 0, lives: START_LIVES, kills: 0, hp: START_HP, maxHp: START_HP,
        invuln: 0, shield: false, spread: 0, rapid: 0,
        combo: 0, comboTimer: 0, mult: 1, bestCombo: 0,
        cool: 0.15, hurtFlash: 0, sinceDrop: 0, continued: false,
        up: {}, boss: null, bossPending: false, waveDone: false, armor: 0, armorMax: 0, droneCool: [],
        bossPlan: {}, nextBoss: null, lowHp: false, alarmT: 0, reviveT: 0, heat: 0, overheated: false, heatWarn: false, hasFired: false,
      });
      pointer.down = false;
      pointer.x = cx; pointer.y = cy - 100;
      startWave(1);
    },

    MAX_BOOSTERS,
    heldBoosters,
    needsDrop: (id) => !!UPGRADES[id] && needsDrop(id),

    // Returns false (and changes nothing) if the slots are full and no valid drop was given.
    // Take nothing this time and go straight to the next wave.
    skipUpgrade() {
      if (S.phase !== 'upgrade') return false;
      S.phase = 'playing';
      S.cool = 0.2;
      startWave(S.wave + 1);
      return true;
    },

    pickUpgrade(id, dropId) {
      if (S.phase !== 'upgrade' || !UPGRADES[id]) return false;
      if (needsDrop(id)) {
        if (!dropId || !heldBoosters().includes(dropId)) return false;
        dropBooster(dropId);
      }
      S.phase = 'playing';
      applyUpgrade(id);
      S.cool = 0.2;
      startWave(S.wave + 1);
      return true;
    },

    continueRun() {
      clearField(false, true);
      S.phase = 'playing';
      S.lives = 1;
      S.hp = S.maxHp;
      // the continue is a new life: boosters fly out to be shot back, plus the revive shield
      const lost = dropAllBoosters();
      if (lost.length) scatterBoosters(lost);
      S.shield = true;
      startReviveShield();
      S.continued = true;
      S.bannerT = 1.4;
      S.combo = 0;
      updateMult();
      ring(cx, cy, POWER.shield.color, 220 * U, 5);
      emit('banner', { title: 'SECOND CHANCE', sub: `Wave ${S.wave} continues` });
    },

    pause() {
      if (S.phase !== 'playing') return false;
      S.phase = 'paused';
      pointer.down = false;
      pointer.key = false;
      return true;
    },
    resume() {
      if (S.phase !== 'paused') return;
      S.phase = 'playing';
      last = performance.now();
    },
    toAttract() {
      clearField(true);
      S.phase = 'attract';
      S.lowHp = false;
      S.wave = 3;
      S.spawnTimer = 0.3;
      S.shield = false;
      S.spread = S.rapid = 0;
      S.invuln = 0;
    },
    setKeyFire(v) { pointer.key = !!v && S.phase === 'playing'; },
  };

  // Testing / trailer-recording hooks, only with ?debug in the URL.
  if (/[?&]debug\b/.test(location.search)) {
    window.Game.debug = {
      enemies: () => enemies,
      powerups: () => powerups,
      bullets: () => bullets,
      drop: (type, x, y) => powerups.push({ type, x: x || cx + 150, y: y || cy, vx: 0, vy: 0, r: Math.max(13, 17 * U), life: 9, t: 0, dead: false }),
      god: (v) => { window.Game.debug.isGod = v; },
      // Jump to a wave, e.g. Game.debug.wave(5) for the first boss.
      wave: (n) => { clearField(false); S.phase = 'playing'; startWave(n); },
      // Fight a specific boss now, e.g. Game.debug.boss('jack'). Keeps the current wave number.
      boss: (kind) => {
        if (!BOSSES[kind]) return Object.keys(BOSSES);
        clearField(false);
        S.phase = 'playing';
        startWave(Math.max(5, S.wave), kind);
        return kind;
      },
      bosses: () => Object.keys(BOSSES),
      upgrade: (id, times) => { for (let i = 0; i < (times || 1); i++) applyUpgrade(id); },
      // Fast-forward the simulation (for automated tests). `each` runs before every step.
      sim: (secs, each) => {
        for (let t = 0; t < secs; t += 1 / 60) {
          if (each) each();
          if (S.phase !== 'paused') update(1 / 60);
        }
        draw();
      },
      center: () => ({ x: cx, y: cy }),
    };
    const orig = touchPlayer;
    touchPlayer = (e) => { if (window.Game.debug.isGod) { killEnemy(e, { score: false }); return; } orig(e); };
  }

  resize();
  window.Game.toAttract();
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
