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
  const RAPID_INTERVAL = 0.065;
  const POWER_TIME = 9;
  const INVULN_TIME = 1.6;
  const COMBO_WINDOW = 2;
  const MAX_LIVES = 5;
  const START_LIVES = 3;
  const MAX_PARTICLES = 700;

  const TYPES = {
    basic:    { speed: [70, 105], r: [14, 30], score: 250, shape: 'circle', color: () => `hsl(${(Math.random() * 360) | 0},75%,62%)` },
    dart:     { speed: [190, 230], r: [10, 11], hp: 1, score: 300, shape: 'tri', color: () => '#ffd84d' },
    zig:      { speed: [85, 100], r: [15, 17], hp: 2, score: 350, shape: 'diamond', shrink: 3, color: () => '#ff4d9d' },
    splitter: { speed: [55, 70], r: [28, 30], hp: 3, score: 400, shape: 'split', shrink: 3, color: () => '#7dff6a' },
    tank:     { speed: [36, 44], r: [40, 44], hp: 8, score: 900, shape: 'hex', shrink: 2.5, color: () => '#ff8a3d' },
    mini:     { speed: [140, 170], r: [9, 10], hp: 1, score: 100, shape: 'circle', color: () => '#b8ffad' },
  };

  const POWER = {
    spread: { color: '#4dd2ff', w: 3, label: 'SPREAD SHOT' },
    rapid:  { color: '#ffd84d', w: 3, label: 'RAPID FIRE' },
    shield: { color: '#7dffea', w: 2, label: 'SHIELD' },
    bomb:   { color: '#ff4d6d', w: 1.4, label: 'BOMB!' },
    life:   { color: '#ff6bd0', w: 0.9, label: '+1 LIFE' },
  };

  const WAVE_INTRO = {
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
    score: 0, wave: 0, lives: START_LIVES, kills: 0,
    toSpawn: 0, spawnTimer: 0, bannerT: 0,
    invuln: 0, shield: false, spread: 0, rapid: 0,
    combo: 0, comboTimer: 0, mult: 1, bestCombo: 0,
    cool: 0, aim: -Math.PI / 2, recoil: 0,
    shake: 0, hurtFlash: 0, dyingT: 0, sinceDrop: 0,
    continued: false, time: 0,
  };
  let bullets = [], enemies = [], particles = [], powerups = [], texts = [], rings = [];
  const pointer = { x: 0, y: 0, down: false, key: false };
  const handlers = {};
  const emit = (name, a) => { if (handlers[name]) handlers[name](a); };

  const playerR = () => Math.max(15, PLAYER_R * U);
  const speedMult = () => 1 + Math.min(Math.max(S.wave - 1, 0), 25) * 0.04;
  const spawnInterval = () => Math.max(0.3, 1.0 - (S.wave - 1) * 0.06);

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const nw = window.innerWidth, nh = window.innerHeight;
    const dx = nw / 2 - cx, dy = nh / 2 - cy;
    if (W > 0) {
      for (const list of [bullets, enemies, particles, powerups, texts, rings]) {
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
    const hp = T.hp || 1 + Math.floor((base - 6) / 10);
    return {
      type, x, y,
      r: base * U, tr: base * U,
      shrink: (T.shrink != null ? T.shrink : 10) * U,
      hp, maxHp: hp,
      speed: rand(T.speed[0], T.speed[1]) * U * speedMult(),
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

  function startWave(n) {
    S.wave = n;
    S.toSpawn = 6 + n * 4;
    S.spawnTimer = 0;
    S.bannerT = 1.8;
    emit('banner', { title: `WAVE ${n}`, sub: WAVE_INTRO[n] || (n % 5 === 0 ? 'They are getting faster...' : '') });
    if (n > 1) Sfx.wave();
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
      floatText(e.x, e.y, '+' + pts, e.color, S.mult > 1 ? 1.15 : 1);
      if (opts.drop) maybeDrop(e.x, e.y);
    }

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

  function hitEnemy(e, b) {
    e.hp--;
    e.flash = 0.07;
    burst(b.x, b.y, e.color, 4, 2);
    if (e.hp <= 0) {
      killEnemy(e, { score: true, drop: true, split: true });
      return;
    }
    e.tr = Math.max(8 * U, e.tr - e.shrink);
    const mass = e.type === 'tank' ? 0.015 : 0.05;
    e.kx += b.vx * mass;
    e.ky += b.vy * mass;
    addScore(Math.round(100 * S.mult));
    Sfx.hit();
  }

  function touchPlayer(e) {
    killEnemy(e, { score: false, silent: false });
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
    S.lives--;
    S.invuln = INVULN_TIME;
    S.combo = 0;
    S.comboTimer = 0;
    updateMult();
    S.hurtFlash = 0.35;
    shake(18);
    knockback(240 * U, 420 * U);
    ring(cx, cy, '#ff4d6d', 200 * U, 4);
    Sfx.hurt();
    if (S.lives <= 0) die();
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
    for (const e of enemies) killEnemy(e, { score: false, silent: true });
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
    S.sinceDrop = 0;
    const pool = Object.keys(POWER)
      .filter((k) => !(k === 'life' && S.lives >= MAX_LIVES))
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
    const P = POWER[p.type];
    ring(p.x, p.y, P.color, 90 * U, 3);
    burst(p.x, p.y, P.color, 20, 10);
    floatText(p.x, p.y - 10, P.label, P.color, 1.2);
    Sfx.power();
    switch (p.type) {
      case 'spread': S.spread = POWER_TIME; break;
      case 'rapid': S.rapid = POWER_TIME; break;
      case 'shield': S.shield = true; break;
      case 'life': S.lives = Math.min(MAX_LIVES, S.lives + 1); break;
      case 'bomb': bomb(true); break;
    }
  }

  function bomb(scored) {
    ring(cx, cy, '#ff4d6d', Math.hypot(W, H) * 0.6, 8);
    ring(cx, cy, '#ffffff', Math.hypot(W, H) * 0.45, 3);
    shake(22);
    Sfx.bomb();
    for (const e of enemies) {
      if (!e.dead) killEnemy(e, { score: scored, drop: false, split: false, silent: true });
    }
  }

  // ---------- shooting ----------
  function fire() {
    const a0 = S.aim;
    const angles = S.spread > 0 ? [a0 - 0.2, a0, a0 + 0.2] : [a0];
    const pr = playerR();
    const br = Math.max(3, BULLET_R * U);
    const sp = BULLET_SPEED * Math.max(U, 0.75);
    for (const a of angles) {
      bullets.push({
        x: cx + Math.cos(a) * pr, y: cy + Math.sin(a) * pr,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: br, dead: false,
      });
    }
    S.recoil = 1;
    if (S.phase === 'playing') Sfx.shoot();
  }

  const fireInterval = () => (S.rapid > 0 ? RAPID_INTERVAL : FIRE_INTERVAL);

  function nearestEnemy() {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (e.dead || e.x < 0 || e.x > W || e.y < 0 || e.y > H) continue;
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
      if ((pointer.down || pointer.key) && S.cool <= 0) {
        fire();
        S.cool = fireInterval();
      }
      S.invuln = Math.max(0, S.invuln - dt);
      S.spread = Math.max(0, S.spread - dt);
      S.rapid = Math.max(0, S.rapid - dt);
      if (S.comboTimer > 0) {
        S.comboTimer -= dt;
        if (S.comboTimer <= 0) { S.combo = 0; updateMult(); }
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
      if (S.bannerT > 0) {
        S.bannerT -= dt;
      } else if (S.toSpawn > 0) {
        S.spawnTimer -= dt;
        if (S.spawnTimer <= 0) {
          S.spawnTimer = spawnInterval() * rand(0.7, 1.3);
          const n = S.wave >= 6 && Math.random() < 0.2 ? 2 : 1;
          for (let i = 0; i < n && S.toSpawn > 0; i++, S.toSpawn--) spawnEnemy(pickType(S.wave));
        }
      } else if (aliveEnemies() === 0) {
        const bonus = 250 * S.wave;
        addScore(bonus);
        floatText(cx, cy - 70 * U, `WAVE CLEAR +${bonus}`, '#4de8ff', 1.5);
        startWave(S.wave + 1);
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
        if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) { b.dead = true; break; }
        for (const p of powerups) {
          if (!p.dead && Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r) { b.dead = true; collect(p); break; }
        }
        if (b.dead) break;
        for (const e of enemies) {
          if (!e.dead && Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r) { b.dead = true; hitEnemy(e, b); break; }
        }
      }
    }

    // enemies
    const damp = Math.exp(-4 * dt);
    for (const e of enemies) {
      if (e.dead) continue;
      e.t += dt;
      e.rot += e.spin * dt;
      if (e.flash > 0) e.flash -= dt;
      e.r += (e.tr - e.r) * Math.min(1, dt * 14);
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
      if ((playing || attract) && d < e.r + pr) touchPlayer(e);
    }

    // power-ups drift and bounce inside the screen
    for (const p of powerups) {
      if (p.dead) continue;
      p.t += dt;
      p.life -= dt;
      if (p.life <= 0) { p.dead = true; burst(p.x, p.y, POWER[p.type].color, 10, 4); continue; }
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

    compact(bullets); compact(enemies); compact(powerups);
    compact(particles); compact(rings); compact(texts);
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

  function drawEnemy(e) {
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
    }
  }

  function drawPlayer() {
    const pr = playerR();
    if (S.phase === 'dying' || S.phase === 'over') return;
    const blink = S.invuln > 0 && Math.floor(S.invuln * 14) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;

    // barrel(s)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(S.aim);
    ctx.fillStyle = S.rapid > 0 ? POWER.rapid.color : S.spread > 0 ? POWER.spread.color : '#cfefff';
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

    // body
    ctx.shadowColor = '#7fe9ff';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0d1a2a';
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 0.42, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4de8ff';
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
    ctx.arc(cx, cy, 110 * U, 0, TAU);
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

    ctx.fillStyle = '#ffffff';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
    }

    for (const e of enemies) drawEnemy(e);
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
    if (S.cool <= 0) { fire(); S.cool = fireInterval(); }
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
  function clearField(withFx) {
    for (const e of enemies) {
      if (withFx) killEnemy(e, { score: false, silent: true });
      else e.dead = true;
    }
    bullets.length = 0;
    powerups.length = 0;
    compact(enemies);
  }

  window.Game = {
    S,
    on(name, fn) { handlers[name] = fn; },
    pointer,
    POWER,
    MAX_LIVES,

    newRun() {
      clearField(true);
      Object.assign(S, {
        phase: 'playing', score: 0, lives: START_LIVES, kills: 0,
        invuln: 0, shield: false, spread: 0, rapid: 0,
        combo: 0, comboTimer: 0, mult: 1, bestCombo: 0,
        cool: 0.15, hurtFlash: 0, sinceDrop: 0, continued: false,
      });
      pointer.down = false;
      pointer.x = cx; pointer.y = cy - 100;
      startWave(1);
    },

    continueRun() {
      clearField(false);
      S.phase = 'playing';
      S.lives = 1;
      S.shield = true;
      S.invuln = 2.5;
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
      drop: (type, x, y) => powerups.push({ type, x: x || cx + 150, y: y || cy, vx: 0, vy: 0, r: Math.max(13, 17 * U), life: 9, t: 0, dead: false }),
      god: (v) => { window.Game.debug.isGod = v; },
    };
    const orig = touchPlayer;
    touchPlayer = (e) => { if (window.Game.debug.isGod) { killEnemy(e, { score: false }); return; } orig(e); };
  }

  resize();
  window.Game.toAttract();
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
