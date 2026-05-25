// All audio is synthesized at runtime via Web Audio — no audio files to ship.
//
// Engine: a continuously running pair of sawtooth oscillators (the "gas-engine"
// buzz) mixed with low-pass-filtered noise (the rumble). Speed scales master
// volume + pitch + a putt-putt LFO. At zero speed the engine fades to silence
// in ~80ms.
//
// Collision sounds: each obstacle kind has a one-shot synthesized "hit" with
// its own timbre — drums for stages, metallic clangs for trucks/lampposts,
// nasal boops for kids/puppets, brass for the band, wood knocks for the
// arch, a "duuude" drone for the wooks, etc.

import { mulberry32 } from './rng.js';

let ctx = null;
let masterGain = null;
let musicBus = null;     // shared bus for stage music sources (so we can balance vs. SFX)
let engineNodes = null;
let initialized = false;

export const Sound = {
  // Must be called from a user gesture (Start button click). Safe to call again.
  init() {
    if (initialized) {
      // Resume in case the browser auto-suspended
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ctx = new AudioCtx();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = 1.6; // bump: stage bands should carry across the festival
    musicBus.connect(masterGain);

    engineNodes = createEngine(ctx, masterGain);
    initialized = true;
  },

  // iOS Safari auto-suspends the AudioContext when the tab is hidden / the
  // device is locked. Call this on visibilitychange (and on any other "we're
  // back" signal) to resume. Safe no-op if init() hasn't run yet.
  resume() {
    if (!initialized || !ctx) return;
    if (ctx.state === 'suspended') {
      // Some iOS versions reject resume() outside a user gesture; the call is
      // best-effort and harmless if it throws.
      ctx.resume().catch(() => {});
    }
  },

  isReady() {
    return initialized;
  },

  // ---- Spatial stage music ----

  attachStageMusic(x, y, z, seed) {
    if (!ctx) return null;
    return createStageMusic(ctx, musicBus, x, y, z, seed);
  },

  detachStageMusic(handle) {
    if (!handle) return;
    handle.stop();
  },

  updateAudioListener(px, py, pz, fx, fy, fz) {
    if (!ctx) return;
    const lis = ctx.listener;
    if (lis.positionX) {
      lis.positionX.value = px;
      lis.positionY.value = py;
      lis.positionZ.value = pz;
      lis.forwardX.value = fx;
      lis.forwardY.value = fy;
      lis.forwardZ.value = fz;
      lis.upX.value = 0;
      lis.upY.value = 1;
      lis.upZ.value = 0;
    } else if (lis.setPosition) {
      // Older browsers
      lis.setPosition(px, py, pz);
      lis.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  },

  setEngineSpeed(speed) {
    if (!engineNodes) return;
    engineNodes.update(Math.abs(speed));
  },

  playCollision(kind) {
    if (!ctx) return;
    (COLLISION_SOUNDS[kind] || COLLISION_SOUNDS.default)(ctx, masterGain);
  },

  playHonk() {
    if (!ctx) return;
    playHonk(ctx, masterGain);
  },

  // Optional: lower-volume bump when Zerble brushes something without damage.
  playSoftBump() {
    if (!ctx) return;
    thump(ctx, masterGain, 110, 0.12, 0.18);
  },
};

// ---------- Engine ----------

function createEngine(ctx, dest) {
  // Two sawtooth oscillators give the gas-engine timbre. The harmonic at 1.5x
  // adds bite without sounding electronic.
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = 55;

  const osc2 = ctx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = 82;

  // Warm low-pass filter so it doesn't get harsh at high revs
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 420;
  lpf.Q.value = 1.5;

  osc1.connect(lpf);
  osc2.connect(lpf);

  // Soft-clip WaveShaper — this is the "old wheezy" crunch.
  // A steeper tanh = more distortion. Run the sawtooth-through-LPF signal
  // through the shaper, then through a band-pass to focus the grit.
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeTanhCurve(8, 2048);
  shaper.oversample = '2x';
  lpf.connect(shaper);

  const grindBpf = ctx.createBiquadFilter();
  grindBpf.type = 'bandpass';
  grindBpf.frequency.value = 280;
  grindBpf.Q.value = 1.4;
  shaper.connect(grindBpf);

  // Noise rumble — louder + grainier now. Mid-range filter so it sounds dirty.
  const bufSize = 2 * ctx.sampleRate;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) ch[i] = (Math.random() * 2 - 1) * 0.9;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const noiseBpf = ctx.createBiquadFilter();
  noiseBpf.type = 'bandpass';
  noiseBpf.frequency.value = 200;
  noiseBpf.Q.value = 0.8;
  noise.connect(noiseBpf);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.65;
  noiseBpf.connect(noiseGain);

  // Master engine volume — driven by speed each frame
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  grindBpf.connect(engineGain);
  noiseGain.connect(engineGain);
  engineGain.connect(dest);

  osc1.start();
  osc2.start();
  noise.start();

  // Hand-driven state for putt-putt LFO, warble, and misfires
  let lfoPhase = 0;
  let lastUpdate = ctx.currentTime;
  let misfireUntil = 0;       // engine "stutter" silence ends at this time
  let nextMisfireCheck = ctx.currentTime + 2 + Math.random() * 2;
  let warblePhase = 0;

  return {
    update(absSpeed) {
      const now = ctx.currentTime;
      const dt = Math.min(0.1, now - lastUpdate);
      lastUpdate = now;

      const t = Math.min(1, absSpeed / 18);

      // Chug speeds up with throttle. Irregular rhythm: slight noise on the rate.
      const lfoHz = 4 + t * 14 + Math.sin(lfoPhase * 0.31) * 1.2;
      lfoPhase += lfoHz * dt;
      // Chug envelope shape: peaky, not smooth sine (more "putt-putt")
      const chugSin = Math.sin(lfoPhase);
      const chug = (chugSin > 0 ? Math.pow(chugSin, 2) : chugSin * 0.15) * 0.4 + 0.55;

      // Random misfires: every couple seconds, kill the chug briefly
      if (now > nextMisfireCheck) {
        nextMisfireCheck = now + 1.5 + Math.random() * 3.5;
        if (t > 0.1 && Math.random() < 0.6) {
          misfireUntil = now + 0.07 + Math.random() * 0.12;
        }
      }
      const misfireMul = now < misfireUntil ? 0.2 : 1;

      // Volume ramps with speed * chug * misfire. At 0 speed → 0 volume → silent.
      const targetVol = t * 0.24 * chug * misfireMul;
      engineGain.gain.setTargetAtTime(targetVol, now, 0.04);

      // Pitch climbs with speed + slow warble for the wheezy old-cart wobble.
      warblePhase += dt * (1.8 + t * 1.5);
      const warble = Math.sin(warblePhase) * (0.04 + t * 0.05); // ±5-9 % at high revs

      const baseFreq = 48;
      const maxFreq = 145;
      const f = (baseFreq + (maxFreq - baseFreq) * t) * (1 + warble);
      osc1.frequency.setTargetAtTime(f, now, 0.07);
      osc2.frequency.setTargetAtTime(f * 1.5, now, 0.07);

      // Open the filter at high revs (brighter), tighten at low (muddier)
      const filterFreq = 320 + t * 700;
      lpf.frequency.setTargetAtTime(filterFreq, now, 0.1);

      // Drive the grind band-pass slightly with speed so the crunch peaks shift
      grindBpf.frequency.setTargetAtTime(230 + t * 280, now, 0.1);
    },
  };
}

// Tanh-shaped soft-clip curve for the engine WaveShaper.
function makeTanhCurve(drive, samples) {
  const c = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return c;
}

// ---------- Collision sound primitives ----------

function makeEnv(ctx, dest, attack, decay, peak) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

function thump(ctx, dest, freq, duration, volume = 0.5) {
  const env = makeEnv(ctx, dest, 0.005, duration, volume);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(freq * 2.2, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq), t + duration);
  osc.connect(env);
  osc.start();
  osc.stop(t + duration + 0.05);
}

function boop(ctx, dest, freqStart, freqEnd, duration, volume = 0.4, type = 'sine') {
  const env = makeEnv(ctx, dest, 0.005, duration, volume);
  const osc = ctx.createOscillator();
  osc.type = type;
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(freqStart, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
  osc.connect(env);
  osc.start();
  osc.stop(t + duration + 0.05);
}

function clang(ctx, dest) {
  const t = ctx.currentTime;
  // High square sweep down — metallic bite
  const env1 = makeEnv(ctx, dest, 0.001, 0.25, 0.35);
  const o1 = ctx.createOscillator();
  o1.type = 'square';
  o1.frequency.setValueAtTime(1900, t);
  o1.frequency.exponentialRampToValueAtTime(900, t + 0.25);
  o1.connect(env1);
  o1.start();
  o1.stop(t + 0.3);

  // Triangle layer for body
  const env2 = makeEnv(ctx, dest, 0.001, 0.32, 0.18);
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.setValueAtTime(1200, t);
  o2.frequency.exponentialRampToValueAtTime(500, t + 0.3);
  o2.connect(env2);
  o2.start();
  o2.stop(t + 0.35);
}

function brassHit(ctx, dest) {
  const t = ctx.currentTime;
  const env = makeEnv(ctx, dest, 0.02, 0.45, 0.4);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.linearRampToValueAtTime(170, t + 0.45);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(2000, t);
  lpf.frequency.linearRampToValueAtTime(700, t + 0.3);
  osc.connect(lpf).connect(env);
  osc.start();
  osc.stop(t + 0.5);
}

function woodKnock(ctx, dest) {
  const t = ctx.currentTime;
  const env = makeEnv(ctx, dest, 0.001, 0.12, 0.45);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(450, t);
  osc.frequency.exponentialRampToValueAtTime(170, t + 0.12);
  osc.connect(env);
  osc.start();
  osc.stop(t + 0.15);
}

function duudeSound(ctx, dest) {
  const t = ctx.currentTime;
  // Low slow "duuude" — sine carrier + filtered saw harmonic
  const env = makeEnv(ctx, dest, 0.06, 0.75, 0.4);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.linearRampToValueAtTime(120, t + 0.4);
  osc.frequency.linearRampToValueAtTime(135, t + 0.75);
  osc.connect(env);
  osc.start();
  osc.stop(t + 0.85);

  const env2 = makeEnv(ctx, dest, 0.06, 0.75, 0.18);
  const osc2 = ctx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(320, t);
  osc2.frequency.linearRampToValueAtTime(240, t + 0.4);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 520;
  osc2.connect(lpf).connect(env2);
  osc2.start();
  osc2.stop(t + 0.85);
}

function playHonk(ctx, dest) {
  const t = ctx.currentTime;
  const env = makeEnv(ctx, dest, 0.01, 0.3, 0.42);
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.linearRampToValueAtTime(410, t + 0.3);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 2200;
  osc.connect(lpf).connect(env);
  osc.start();
  osc.stop(t + 0.4);
}

// ---------- Spatial stage music ----------

// Picks a key + tempo + pattern from the seed and runs a self-scheduling loop on
// a PannerNode placed at the stage. Each stage's music is unique-ish and decays
// with distance via HRTF panning.
function createStageMusic(ctx, dest, x, y, z, seed) {
  const rng = mulberry32(seed >>> 0);

  // Pick a key (chromatic offset in semitones) and tempo
  const semis = Math.floor(rng() * 12);
  const baseFreq = 196 * Math.pow(2, semis / 12); // ~G3 ± an octave
  const tempo = 96 + Math.floor(rng() * 36);
  const beat = 60 / tempo;

  // Major-pentatonic-ish scale ratios — sounds pleasant in any key
  const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4];

  // Random melody (8 notes) + random bass (4 notes)
  const melody = new Array(8).fill(0).map(() => baseFreq * scale[Math.floor(rng() * scale.length)]);
  const bass = new Array(4).fill(0).map(() => baseFreq * 0.5 * scale[Math.floor(rng() * 4)]);

  // ---- Panner: positional in 3D. Tuned so each stage carries clearly across
  // its surrounding chunk before fading. ----
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 14;     // stays at full volume up to this distance
  panner.maxDistance = 140;
  panner.rolloffFactor = 1.1;  // gentler falloff = audible from farther
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else if (panner.setPosition) {
    panner.setPosition(x, y, z);
  }
  panner.connect(dest);

  // ---- Lead oscillator (triangle: warm melodic tone) ----
  const lead = ctx.createOscillator();
  lead.type = 'triangle';
  lead.frequency.value = melody[0];
  const leadGain = ctx.createGain();
  leadGain.gain.value = 0;
  lead.connect(leadGain).connect(panner);
  lead.start();

  // ---- Bass oscillator (saw + low-pass: gives that PA-system thump) ----
  const bassOsc = ctx.createOscillator();
  bassOsc.type = 'sawtooth';
  bassOsc.frequency.value = bass[0];
  const bassLpf = ctx.createBiquadFilter();
  bassLpf.type = 'lowpass';
  bassLpf.frequency.value = 380;
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0;
  bassOsc.connect(bassLpf).connect(bassGain).connect(panner);
  bassOsc.start();

  // ---- Drum kick: a sub-bass oscillator we re-pluck per beat ----
  const kick = ctx.createOscillator();
  kick.type = 'sine';
  kick.frequency.value = 50;
  const kickGain = ctx.createGain();
  kickGain.gain.value = 0;
  kick.connect(kickGain).connect(panner);
  kick.start();

  // ---- Scheduler: queues ~0.6s of notes every 0.2s ----
  let nextNoteTime = ctx.currentTime + 0.15;
  let beatIdx = 0;

  function schedule() {
    const horizon = ctx.currentTime + 0.6;
    while (nextNoteTime < horizon) {
      const t = nextNoteTime;

      // Melody note (each beat)
      const m = melody[beatIdx % melody.length];
      lead.frequency.setValueAtTime(m, t);
      leadGain.gain.cancelScheduledValues(t);
      leadGain.gain.setValueAtTime(0.0001, t);
      leadGain.gain.exponentialRampToValueAtTime(0.28, t + 0.015);
      leadGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.85);

      // Bass note (every other beat)
      if (beatIdx % 2 === 0) {
        const b = bass[Math.floor(beatIdx / 2) % bass.length];
        bassOsc.frequency.setValueAtTime(b, t);
        bassGain.gain.cancelScheduledValues(t);
        bassGain.gain.setValueAtTime(0.0001, t);
        bassGain.gain.exponentialRampToValueAtTime(0.34, t + 0.02);
        bassGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.8);
      }

      // Kick: every beat — short pitch sweep
      kick.frequency.setValueAtTime(110, t);
      kick.frequency.exponentialRampToValueAtTime(40, t + 0.08);
      kickGain.gain.cancelScheduledValues(t);
      kickGain.gain.setValueAtTime(0.0001, t);
      kickGain.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
      kickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

      nextNoteTime += beat;
      beatIdx++;
    }
  }
  schedule();
  const intervalId = setInterval(schedule, 200);

  return {
    panner,
    stop() {
      clearInterval(intervalId);
      try { lead.stop(); } catch (e) {}
      try { bassOsc.stop(); } catch (e) {}
      try { kick.stop(); } catch (e) {}
      try { panner.disconnect(); } catch (e) {}
    },
  };
}

// ---------- Per-obstacle dispatch ----------

const COLLISION_SOUNDS = {
  puppet:      (c, d) => boop(c, d, 240, 540, 0.2, 0.4, 'sine'),
  brass:       (c, d) => brassHit(c, d),
  truck:       (c, d) => { thump(c, d, 55, 0.4, 0.6); clang(c, d); },
  tent:        (c, d) => thump(c, d, 95, 0.22, 0.35),
  kid:         (c, d) => boop(c, d, 720, 1150, 0.13, 0.35, 'sine'),
  wook:        (c, d) => duudeSound(c, d),
  stage:       (c, d) => { thump(c, d, 52, 0.55, 0.62); woodKnock(c, d); },
  stage_front: (c, d) => thump(c, d, 75, 0.4, 0.45),
  arch:        (c, d) => woodKnock(c, d),
  lamppost:    (c, d) => clang(c, d),
  drum_circle: (c, d) => { thump(c, d, 70, 0.4, 0.55); thump(c, d, 110, 0.25, 0.3); },
  default:     (c, d) => thump(c, d, 180, 0.2, 0.3),
};
