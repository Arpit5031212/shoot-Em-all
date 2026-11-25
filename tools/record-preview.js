// Records the CrazyGames preview videos straight from the game canvas (dev only, never shipped).
//
// 1. npm run dev
// 2. Open http://localhost:5173/src/?debug in Chrome with the viewport set to the video size
//    (DevTools device toolbar: 1920x1080 for landscape, 1080x1620 for portrait).
// 3. In the console:
//      await import('/tools/record-preview.js')
//      recordPreview({ name: 'preview-landscape-1920x1080.mp4', cover: '/store/cover-landscape-1920x1080.png', W: 1920, H: 1080 })
//    The MP4 (and a _sheet-*.png contact sheet for checking) is written into store/ by the dev server.
//
// The video opens on the static cover, cross-fades into a scripted wave-12 fight (an auto-aim
// "player" with god mode on), shows Spread and Rapid pick-ups, and ends on a screen-clearing bomb.
// No sound, no cursor, no HUD text: only the game canvas is captured.

const loadBitmap = async (url) => createImageBitmap(await (await fetch(url)).blob());

// Aim at the nearest enemy (power-ups count as closer, so they get collected), hold fire,
// and ease off before the gun overheats.
function autopilot() {
  const S = Game.S, c = Game.debug.center(), P = Game.pointer;
  const onScreen = (e) => e.x > -20 && e.x < innerWidth + 20 && e.y > -20 && e.y < innerHeight + 20;
  const cands = Game.debug.enemies().filter((e) => !e.dead && onScreen(e)).map((e) => ({ x: e.x, y: e.y, w: 1 }));
  for (const p of Game.debug.powerups()) if (!p.dead) cands.push({ x: p.x, y: p.y, w: 0.5 });
  if (S.boss) {
    const parts = S.boss.parts ? S.boss.parts.filter((p) => !p.dead) : [S.boss];
    for (const p of parts) if (p.x !== undefined) cands.push({ x: p.x, y: p.y, w: 1.4 });
  }
  let best = null, bd = Infinity;
  for (const e of cands) { const d = Math.hypot(e.x - c.x, e.y - c.y) * e.w; if (d < bd) { bd = d; best = e; } }
  if (best) { P.x += (best.x - P.x) * 0.35; P.y += (best.y - P.y) * 0.35; }
  if (S.overheated || S.heat > 0.7) autopilot.cool = true;
  if (S.heat < 0.35) autopilot.cool = false;
  Game.setKeyFire(!!best && !autopilot.cool);
}

function setupScene() {
  Game.newRun();
  Game.debug.god(true);
  Game.debug.upgrade('drone', 1);
  Game.debug.upgrade('pierce', 1);
  Game.debug.wave(12);
  Game.debug.sim(4.5, autopilot); // skip the empty start of the wave
}

const dropNear = (type, dx, dy) => {
  const c = Game.debug.center(), s = Math.min(innerWidth, innerHeight);
  Game.debug.drop(type, c.x + dx * s, c.y + dy * s);
};
// seconds after the cover fades out
const sceneEvents = [
  { t: 2.5, fn: () => dropNear('spread', 0.22, -0.14) },
  { t: 8, fn: () => dropNear('rapid', -0.2, 0.16) },
  { t: 13.8, fn: () => dropNear('bomb', 0.18, 0.1) },
];

async function recordPreview({ name, cover, W, H, fps = 30, coverSecs = 1.0, fadeSecs = 0.4, gameSecs = 17.6,
  snaps = [0.5, 1.2, 3.5, 6, 9, 12, 14.9, 15.4, 18.4] }) {
  const st = (window._rec = { stage: 'loading', name });
  try {
    // The game's own loop is stopped; frames are stepped by a worker timer at an exact fps,
    // which keeps working (and keeps real-time pacing) even when the tab is in the background.
    window.requestAnimationFrame = () => 0;
    const gc = document.getElementById('game');
    const rc = document.createElement('canvas'); rc.width = W; rc.height = H;
    const rx = rc.getContext('2d');
    const img = await loadBitmap(cover);
    const track = rc.captureStream(0).getVideoTracks()[0];
    const rec = new MediaRecorder(new MediaStream([track]), { mimeType: 'video/mp4;codecs=avc1.640028', videoBitsPerSecond: 14e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    setupScene();
    const total = Math.round((coverSecs + gameSecs) * fps);
    const snapFrames = new Set(snaps.map((s) => Math.round(s * fps)));
    const shots = [];
    const drawCover = () => rx.drawImage(img, 0, 0, W, H);
    let i = 0, ev = 0;
    drawCover();
    rec.start();
    st.stage = 'recording';
    const wk = new Worker(URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${1000 / fps})`], { type: 'text/javascript' })));
    await new Promise((resolve) => {
      wk.onmessage = () => {
        const t = i / fps;
        if (t < coverSecs) drawCover();
        else {
          const gt = t - coverSecs;
          while (ev < sceneEvents.length && gt >= sceneEvents[ev].t) sceneEvents[ev++].fn();
          Game.debug.sim(1 / fps, autopilot);
          rx.globalAlpha = 1;
          rx.drawImage(gc, 0, 0, W, H);
          const f = gt / fadeSecs;
          if (f < 1) { rx.globalAlpha = 1 - f; drawCover(); rx.globalAlpha = 1; }
        }
        track.requestFrame();
        if (snapFrames.has(i)) shots.push(createImageBitmap(rc).then((b) => ({ t: +t.toFixed(1), b })));
        st.frame = ++i;
        if (i >= total) { wk.terminate(); resolve(); }
      };
    });
    await new Promise((r) => setTimeout(r, 200));
    rec.stop();
    await done;
    st.stage = 'saving';
    const blob = new Blob(chunks, { type: 'video/mp4' });
    const res = await fetch('/__save?name=' + name, { method: 'POST', body: blob });
    // contact sheet of a few frames, for a quick visual check
    const bm = await Promise.all(shots);
    const tw = W > H ? 480 : 300, th = Math.round(tw * H / W), cols = W > H ? 3 : 5;
    const sh = document.createElement('canvas');
    sh.width = cols * tw; sh.height = Math.ceil(bm.length / cols) * (th + 30);
    const sx = sh.getContext('2d');
    sx.fillStyle = '#333'; sx.fillRect(0, 0, sh.width, sh.height);
    bm.forEach((s, k) => {
      const x = (k % cols) * tw, y = Math.floor(k / cols) * (th + 30);
      sx.drawImage(s.b, x, y, tw, th);
      sx.fillStyle = '#ff0'; sx.font = '20px sans-serif'; sx.fillText(s.t + 's', x + 6, y + th + 22);
    });
    await fetch('/__save?name=_sheet-' + name.replace('.mp4', '.png'), { method: 'POST', body: sh.toDataURL('image/png') });
    Object.assign(st, { stage: 'done', mb: (blob.size / 1048576).toFixed(2), saved: await res.text() });
  } catch (e) {
    st.stage = 'error';
    st.err = String(e);
  }
  return st;
}

Object.assign(window, { recordPreview, autopilot, setupScene, sceneEvents });
