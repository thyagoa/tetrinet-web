// ===== SOUND ENGINE =====
// Procedural audio via Web Audio API — zero external files
// All sounds are synthesized from oscillators, filters and envelopes.

const SFX = (() => {
  let ctx = null;
  let masterGain = null;
  let enabled = true;
  let volume = 0.5; // 0..1

  // Load prefs from localStorage
  try {
    const saved = JSON.parse(localStorage.getItem('bricknet_sfx') || '{}');
    if (typeof saved.enabled === 'boolean') enabled = saved.enabled;
    if (typeof saved.volume  === 'number')  volume  = saved.volume;
  } catch(_) {}

  function savePrefs() {
    localStorage.setItem('bricknet_sfx', JSON.stringify({ enabled, volume }));
  }

  // Lazy-init AudioContext on first user interaction
  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ===== LOW-LEVEL HELPERS =====

  function osc(type, freq, startTime, duration, gainPeak, gainEnd = 0, detune = 0) {
    const c = getCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type    = type;
    o.frequency.setValueAtTime(freq, startTime);
    if (detune) o.detune.setValueAtTime(detune, startTime);
    g.gain.setValueAtTime(0.001, startTime);
    g.gain.linearRampToValueAtTime(gainPeak, startTime + 0.005);
    g.gain.exponentialRampToValueAtTime(Math.max(gainEnd, 0.001), startTime + duration);
    o.connect(g);
    g.connect(masterGain);
    o.start(startTime);
    o.stop(startTime + duration + 0.01);
    return { osc: o, gain: g };
  }

  function freqSlide(type, freqStart, freqEnd, startTime, duration, gainPeak) {
    const c = getCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqStart, startTime);
    o.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration);
    g.gain.setValueAtTime(0.001, startTime);
    g.gain.linearRampToValueAtTime(gainPeak, startTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    o.connect(g);
    g.connect(masterGain);
    o.start(startTime);
    o.stop(startTime + duration + 0.01);
  }

  function noise(startTime, duration, gainPeak, filterFreq = 2000) {
    const c    = getCtx();
    const buf  = c.createBuffer(1, c.sampleRate * duration, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src    = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const g      = c.createGain();
    src.buffer        = buf;
    filter.type       = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value    = 1;
    g.gain.setValueAtTime(gainPeak, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }

  // ===== SOUND DEFINITIONS =====

  const sounds = {

    // Piece moves left/right — quick low click
    move() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      osc('square', 180, t, 0.04, 0.08);
    },

    // Piece rotates — slightly higher tick
    rotate() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      osc('square', 260, t, 0.05, 0.10);
    },

    // Soft drop (holding down)
    softDrop() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      osc('sine', 120, t, 0.03, 0.06);
    },

    // Piece locks on ground — thud
    lock() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sine', 140, 60, t, 0.12, 0.3);
      noise(t, 0.07, 0.12, 400);
    },

    // Hard drop — whoosh down + thud
    hardDrop() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sawtooth', 600, 80, t, 0.15, 0.25);
      noise(t + 0.08, 0.1, 0.18, 500);
      freqSlide('sine', 100, 50, t + 0.08, 0.15, 0.3);
    },

    // 1 line cleared
    clear1() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      osc('sine', 440, t,        0.12, 0.3);
      osc('sine', 660, t + 0.06, 0.12, 0.25);
    },

    // 2 lines cleared
    clear2() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      osc('sine', 440, t,        0.10, 0.28);
      osc('sine', 550, t + 0.05, 0.10, 0.28);
      osc('sine', 770, t + 0.10, 0.14, 0.30);
    },

    // 3 lines cleared
    clear3() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      [440, 550, 660, 880].forEach((f, i) => {
        osc('sine', f, t + i * 0.055, 0.14, 0.28);
      });
    },

    // TETRIS — 4 lines! Fanfara
    tetris() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      const melody = [523, 659, 784, 1047, 784, 1047];
      melody.forEach((f, i) => {
        osc('square', f,   t + i * 0.07, 0.10, 0.22);
        osc('sine',   f/2, t + i * 0.07, 0.10, 0.12);
      });
    },

    // Bomb picked up into inventory
    bombCapture() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sine', 400, 800, t, 0.10, 0.18);
      osc('triangle', 1200, t + 0.08, 0.08, 0.10);
    },

    // Player uses a bomb (zap/laser)
    bombUse() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sawtooth', 800, 200, t, 0.18, 0.28);
      noise(t, 0.06, 0.15, 3000);
    },

    // Generic bomb received
    bombHit() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sawtooth', 300, 80,  t,        0.20, 0.35);
      noise(t, 0.15, 0.20, 800);
    },

    // Add Line — thumping bass hit
    bombAddLine() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sine', 200, 55, t, 0.25, 0.45);
      noise(t, 0.12, 0.25, 300);
      osc('square', 100, t, 0.10, 0.20);
    },

    // Nuke — massive explosion + reverb-like trail
    bombNuke() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      // Low boom
      freqSlide('sine', 120, 25, t, 0.40, 0.55);
      // Mid crunch
      freqSlide('sawtooth', 300, 60, t, 0.30, 0.40);
      // High sizzle
      noise(t, 0.50, 0.30, 2000);
      // Rumble tail
      [0.1, 0.2, 0.35].forEach(delay => {
        noise(t + delay, 0.20, 0.12 - delay * 0.2, 600);
      });
    },

    // Blockquake — chaotic rumble
    bombBlockquake() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      noise(t, 0.40, 0.30, 500);
      [80, 120, 90, 110].forEach((f, i) => {
        freqSlide('sine', f, f * 0.6, t + i * 0.07, 0.15, 0.15);
      });
    },

    // Switch fields — whoosh swap
    bombSwitch() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sine', 200, 800, t,        0.12, 0.20);
      freqSlide('sine', 800, 200, t + 0.12, 0.12, 0.20);
    },

    // Clear line — pleasant pop
    bombClearLine() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sine', 300, 600, t, 0.12, 0.22);
      osc('triangle', 900, t + 0.06, 0.10, 0.15);
    },

    // Gravity — heavy drop sound
    bombGravity() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('sine', 400, 80, t, 0.25, 0.28);
      noise(t + 0.1, 0.15, 0.15, 400);
    },

    // You died — descending phrase
    death() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      const notes = [440, 370, 311, 220, 165];
      notes.forEach((f, i) => {
        osc('square',   f,   t + i * 0.12, 0.14, 0.20);
        osc('triangle', f/2, t + i * 0.12, 0.14, 0.10);
      });
    },

    // Victory — ascending fanfara
    victory() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      const notes = [523, 659, 784, 659, 784, 1047];
      notes.forEach((f, i) => {
        osc('square',   f,   t + i * 0.09, 0.12, 0.25);
        osc('sine',     f/2, t + i * 0.09, 0.12, 0.12);
      });
    },

    // Game over (lost) — low sad phrase
    gameOver() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      const notes = [330, 277, 220, 165];
      notes.forEach((f, i) => {
        osc('sawtooth', f,   t + i * 0.15, 0.18, 0.22);
        osc('sine',     f/2, t + i * 0.15, 0.18, 0.10);
      });
    },

    // Countdown beep (3, 2, 1)
    countdownBeep() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      osc('square', 880, t, 0.12, 0.3);
    },

    // GO! — higher beep
    countdownGo() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      osc('square', 1320, t,        0.10, 0.35);
      osc('square', 1760, t + 0.08, 0.10, 0.30);
    },

    // Speed up warning
    speedUp() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      freqSlide('square', 440, 880, t, 0.15, 0.20);
    },

    // Bot eliminated
    botEliminated() {
      if (!enabled) return;
      const t = getCtx().currentTime;
      const notes = [330, 262, 220];
      notes.forEach((f, i) => {
        osc('square', f, t + i * 0.10, 0.12, 0.18);
      });
    },
  };

  // ===== BOMB ROUTER =====
  // Call this when a bomb is received — routes to the right SFX
  sounds.bombReceived = function(special) {
    if (!enabled) return;
    switch(special) {
      case 'a': sounds.bombAddLine();    break;
      case 'n': sounds.bombNuke();       break;
      case 'q': sounds.bombBlockquake(); break;
      case 's': sounds.bombSwitch();     break;
      case 'c': sounds.bombClearLine();  break;
      case 'g': sounds.bombGravity();    break;
      default:  sounds.bombHit();        break;
    }
  };

  // ===== LINES ROUTER =====
  sounds.linesCleared = function(count) {
    if (!enabled) return;
    if (count >= 4)      sounds.tetris();
    else if (count === 3) sounds.clear3();
    else if (count === 2) sounds.clear2();
    else                  sounds.clear1();
  };

  // ===== VOLUME / ENABLE CONTROLS =====
  sounds.setVolume = function(v) {
    volume = Math.max(0, Math.min(1, v));
    if (masterGain) masterGain.gain.value = volume;
    savePrefs();
  };

  sounds.setEnabled = function(v) {
    enabled = !!v;
    savePrefs();
  };

  sounds.getVolume  = () => volume;
  sounds.isEnabled  = () => enabled;

  // Resume context after any user interaction (browser autoplay policy)
  document.addEventListener('keydown', () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: false });
  document.addEventListener('click',   () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: false });

  return sounds;
})();
