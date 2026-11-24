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

  function noise(dur, vol, freq, freqEnd, delay) {
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
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
    hit() {
      if (!ready('hit', 0.03)) return;
      noise(0.05, 0.16, 4200);
      tone(320, 180, 0.05, 'triangle', 0.08);
    },
    explode(size) {
      if (!ready('explode', 0.035)) return;
      const s = Math.min(1, size / 44);
      noise(0.18 + s * 0.4, 0.22 + s * 0.25, 2000 - s * 1000, 120);
      tone(150 - s * 70, 38, 0.2 + s * 0.3, 'sine', 0.22 + s * 0.2);
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
    click() {
      if (!ready('click', 0.05)) return;
      tone(600, 900, 0.06, 'triangle', 0.08);
    },
  };
})();
