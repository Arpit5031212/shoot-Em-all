'use strict';
// All sound effects are synthesized with WebAudio, so the game ships no audio files.
(function () {
  let ac = null;
  let master = null;
  let noiseBuf = null;
  let userMuted = false;
  let adMuted = false;
  let sdkMuted = false;
  const last = {};

  function ensure() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ac = new AC(); } catch (e) { return null; }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(ac.destination);
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(comp);
    const len = ac.sampleRate * 2;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    apply();
    return ac;
  }

  const silent = () => userMuted || adMuted || sdkMuted;

  function apply() {
    if (!master) return;
    const t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(silent() ? 0 : 0.55, t, 0.015);
  }

  // Must run inside a click/touchend handler for iOS.
  function unlock() {
    ensure();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  }

  function ready(name, gap) {
    if (!ac || ac.state !== 'running' || silent()) return false;
    const t = ac.currentTime;
    if (last[name] !== undefined && t - last[name] < gap) return false;
    last[name] = t;
    return true;
  }

  function tone(f0, f1, dur, type, vol, delay) {
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function noise(dur, vol, freq, freqEnd, delay, filterType) {
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.03);
  }

  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend().catch(() => {});
    else ac.resume().catch(() => {});
  });

  window.Sfx = {
    unlock,
    get muted() { return userMuted; },
    setMuted(v) { userMuted = !!v; apply(); },
    setAdMuted(v) { adMuted = !!v; apply(); },
    setSdkMuted(v) { sdkMuted = !!v; apply(); },

    shoot() {
      if (!ready('shoot', 0.045)) return;
      tone(880 + Math.random() * 90, 380, 0.07, 'square', 0.045);
    },
    // Hits and kills are bright, high-pitched "zaps" with no low-end thump,
    // so rapid fire sounds like lasers connecting rather than a drum kit.
    hit() {
      if (!ready('hit', 0.035)) return;
      const f = 1500 + Math.random() * 300;
      tone(f, f * 1.6, 0.045, 'sine', 0.07);
      noise(0.03, 0.05, 6000, 0, 0, 'highpass');
    },
    explode(size) {
      if (!ready('explode', 0.04)) return;
      const s = Math.min(1, size / 44);
      const f = 1100 - s * 450 + Math.random() * 120;
      // descending laser chirp + shimmering high sparkle
      tone(f, f * 0.25, 0.12 + s * 0.14, 'square', 0.05 + s * 0.02);
      tone(f * 1.5, f * 2.2, 0.08, 'sine', 0.06);
      noise(0.12 + s * 0.2, 0.08 + s * 0.06, 3500, 9000, 0, 'highpass');
    },
    power() {
      if (!ready('power', 0.1)) return;
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0, 0.14, 'triangle', 0.14, i * 0.06));
    },
    bomb() {
      if (!ready('bomb', 0.2)) return;
      noise(1.1, 0.5, 2400, 60);
      tone(90, 30, 0.9, 'sine', 0.5);
    },
    shieldBreak() {
      if (!ready('shield', 0.1)) return;
      tone(1200, 300, 0.25, 'sawtooth', 0.08);
      noise(0.2, 0.15, 6000, 800);
    },
    hurt() {
      if (!ready('hurt', 0.2)) return;
      tone(260, 50, 0.45, 'sawtooth', 0.22);
      noise(0.35, 0.3, 1500, 100);
    },
    wave() {
      if (!ready('wave', 0.3)) return;
      tone(660, 0, 0.16, 'triangle', 0.14);
      tone(990, 0, 0.3, 'triangle', 0.14, 0.12);
    },
    over() {
      if (!ready('over', 0.5)) return;
      [440, 349, 262, 196].forEach((f, i) => tone(f, f * 0.97, 0.3, 'triangle', 0.16, i * 0.16));
      noise(1.2, 0.4, 1800, 60);
    },
    boss() {
      if (!ready('boss', 1)) return;
      tone(55, 110, 1.4, 'sawtooth', 0.16);
      tone(82, 165, 1.4, 'sawtooth', 0.1, 0.05);
      noise(1.3, 0.18, 300, 2000);
    },
    surge() {
      if (!ready('surge', 0.5)) return;
      tone(180, 900, 0.35, 'sawtooth', 0.12);
      noise(0.4, 0.2, 800, 4000);
    },
    // gun overheated: a hard clunk followed by a long steam hiss
    overheat() {
      if (!ready('overheat', 0.3)) return;
      tone(180, 70, 0.18, 'square', 0.12);
      noise(1.1, 0.22, 5000, 1500, 0.05, 'highpass');
    },
    // heat climbing toward overheat: two short rising warning chirps
    heatWarn() {
      if (!ready('heatWarn', 0.5)) return;
      tone(700, 1000, 0.07, 'square', 0.05);
      tone(700, 1000, 0.07, 'square', 0.05, 0.1);
    },
    // gun usable again: quick rising double ping
    cooled() {
      if (!ready('cooled', 0.3)) return;
      tone(900, 0, 0.07, 'triangle', 0.08);
      tone(1350, 0, 0.09, 'triangle', 0.08, 0.08);
    },
    // critical-HP warning: urgent two-tone beep, played about once a second
    lowHp() {
      if (!ready('lowHp', 0.5)) return;
      tone(880, 0, 0.11, 'square', 0.07);
      tone(660, 0, 0.13, 'square', 0.07, 0.14);
    },
    // soft thud while the Shield booster absorbs a hit
    shieldHit() {
      if (!ready('shieldHit', 0.06)) return;
      tone(520, 260, 0.12, 'triangle', 0.1);
      noise(0.08, 0.08, 2500, 900);
    },
    // glass shattering: a crack, a cluster of high random pings, then falling tinkles
    shatter() {
      if (!ready('shatter', 0.3)) return;
      noise(0.06, 0.45, 9000, 0, 0, 'highpass');
      tone(140, 60, 0.18, 'sine', 0.25);
      for (let i = 0; i < 9; i++) {
        const f = 2200 + Math.random() * 3800;
        tone(f, f * (0.7 + Math.random() * 0.2), 0.12 + Math.random() * 0.2, i % 2 ? 'sine' : 'triangle', 0.05, 0.01 + Math.random() * 0.12);
      }
      for (let i = 0; i < 6; i++) {
        const f = 3000 + Math.random() * 3000;
        tone(f, f, 0.06, 'sine', 0.03, 0.18 + i * 0.06 + Math.random() * 0.04);
      }
      noise(0.5, 0.18, 6000, 0, 0.02, 'highpass');
    },
    tele() {
      if (!ready('tele', 0.2)) return;
      tone(300, 2400, 0.3, 'sine', 0.12);
      tone(450, 3200, 0.3, 'triangle', 0.05, 0.03);
    },
    boing() {
      if (!ready('boing', 0.3)) return;
      tone(120, 520, 0.25, 'square', 0.08);
      tone(520, 260, 0.2, 'triangle', 0.08, 0.2);
    },
    zap() {
      if (!ready('zap', 0.06)) return;
      tone(2400, 600, 0.09, 'sawtooth', 0.05);
      noise(0.08, 0.06, 5000, 0, 0, 'highpass');
    },
    tink() {
      if (!ready('tink', 0.05)) return;
      tone(2600, 2000, 0.05, 'square', 0.03);
    },
    click() {
      if (!ready('click', 0.05)) return;
      tone(600, 900, 0.06, 'triangle', 0.08);
    },
  };
})();
