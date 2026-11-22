/* ============================================================
   淮海战役 · 程序化音效
   无外部音频素材，全部用 WebAudio 合成
   ============================================================ */
(function (root) {
  'use strict';
  const HX = root.HX = root.HX || {};
  const Audio = HX.Audio = {};
  const KEY = 'huaihai1948.audio';
  const AC = root.AudioContext || root.webkitAudioContext;
  let ctx = null;
  let master = null;
  let enabled = true;
  let lastClick = 0;

  try {
    const v = localStorage.getItem(KEY);
    if (v === '0') enabled = false;
  } catch (e) { }

  function saveEnabled() {
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) { }
  }

  function ensure() {
    if (!enabled || !AC) return null;
    try {
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.32;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(function () { });
      }
      return ctx;
    } catch (e) {
      return null;
    }
  }

  function tone(freq, dur, type, vol, delay, slideTo) {
    const c = ensure();
    if (!c) return;
    try {
      const t = c.currentTime + (delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(Math.max(30, freq), t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol || 0.05, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.03);
    } catch (e) { }
  }

  function noise(dur, vol, cutoff, delay) {
    const c = ensure();
    if (!c) return;
    try {
      const t = c.currentTime + (delay || 0);
      const n = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff || 800;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol || 0.04, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + dur + 0.02);
    } catch (e) { }
  }

  Audio.unlock = function () {
    ensure();
  };

  Audio.click = function () {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastClick < 45) return;
    lastClick = now;
    tone(1000, 0.035, 'square', 0.018);
  };

  Audio.order = function () {
    if (!enabled) return;
    tone(1180, 0.035, 'square', 0.022);
    tone(760, 0.05, 'square', 0.018, 0.055);
    noise(0.06, 0.012, 1600, 0.01);
  };

  Audio.turn = function () {
    if (!enabled) return;
    tone(240, 0.12, 'triangle', 0.028);
    tone(320, 0.1, 'triangle', 0.02, 0.09);
  };

  Audio.combat = function () {
    if (!enabled) return;
    tone(62, 0.48, 'sine', 0.22, 0, 34);
    noise(0.42, 0.16, 260, 0);
    tone(52, 0.62, 'sine', 0.16, 0.18, 27);
    noise(0.55, 0.11, 190, 0.2);
  };

  Audio.save = function () {
    if (!enabled) return;
    tone(660, 0.07, 'sine', 0.03);
    tone(880, 0.09, 'sine', 0.026, 0.08);
  };

  Audio.result = function (win) {
    if (!enabled) return;
    if (win) {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.045, i * 0.12));
    } else {
      [220, 196, 147].forEach((f, i) => tone(f, 0.35, 'sine', 0.05, i * 0.16));
    }
  };

  Audio.refreshButton = function () {
    const btn = document.getElementById('btn-sound');
    if (!btn) return;
    btn.textContent = enabled ? '♪' : '♪';
    btn.classList.toggle('muted', !enabled);
    btn.title = enabled ? '声音：开（点击关闭）' : '声音：关（点击开启）';
    btn.setAttribute('aria-label', btn.title);
  };

  Audio.toggle = function () {
    enabled = !enabled;
    saveEnabled();
    if (enabled) {
      ensure();
      if (master) master.gain.value = 0.32;
      Audio.click();
    } else if (master) {
      try { master.gain.value = 0; } catch (e) { }
    }
    Audio.refreshButton();
  };

  Audio.isEnabled = function () { return enabled; };

  document.addEventListener('pointerdown', function () {
    Audio.unlock();
  }, { once: true });

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('button')) Audio.click();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Audio.refreshButton, { once: true });
  } else {
    Audio.refreshButton();
  }
})(typeof window !== 'undefined' ? window : globalThis);
