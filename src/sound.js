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

let ctx = null;
let masterGain = null;
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

    engineNodes = createEngine(ctx, masterGain);
    initialized = true;
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
  lpf.Q.value = 1.1;

  osc1.connect(lpf);
  osc2.connect(lpf);

  // Noise rumble — 2-second loop buffer of band-limited noise
  const bufSize = 2 * ctx.sampleRate;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) ch[i] = (Math.random() * 2 - 1) * 0.7;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const noiseLpf = ctx.createBiquadFilter();
  noiseLpf.type = 'lowpass';
  noiseLpf.frequency.value = 240;
  noise.connect(noiseLpf);

  // Master engine volume — driven by speed each frame
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  lpf.connect(engineGain);
  noiseLpf.connect(engineGain);
  engineGain.connect(dest);

  osc1.start();
  osc2.start();
  noise.start();

  // Hand-driven putt-putt LFO so the engine has a rhythmic chug that speeds up.
  let lfoPhase = 0;
  let lastUpdate = ctx.currentTime;

  return {
    update(absSpeed) {
      const now = ctx.currentTime;
      const dt = Math.min(0.1, now - lastUpdate);
      lastUpdate = now;

      // 0..1
      const t = Math.min(1, absSpeed / 18);

      // Chug speeds up with throttle
      const lfoHz = 4 + t * 14;
      lfoPhase += lfoHz * dt;
      const chug = (Math.sin(lfoPhase) * 0.5 + 0.5) * 0.35 + 0.65;

      // Volume ramps with speed * chug. At 0 speed → 0 volume → silent.
      const targetVol = t * 0.22 * chug;
      engineGain.gain.setTargetAtTime(targetVol, now, 0.04);

      // Pitch climbs with speed
      const baseFreq = 50;
      const maxFreq = 145;
      const f = baseFreq + (maxFreq - baseFreq) * t;
      osc1.frequency.setTargetAtTime(f, now, 0.08);
      osc2.frequency.setTargetAtTime(f * 1.5, now, 0.08);

      // Open filter a touch at higher revs so it gets brighter
      const filterFreq = 350 + t * 600;
      lpf.frequency.setTargetAtTime(filterFreq, now, 0.1);
    },
  };
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
