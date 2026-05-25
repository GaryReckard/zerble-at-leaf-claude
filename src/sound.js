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
let sfxBus = null;       // shared bus for all SFX (engine, collisions, honks, bumps)
let engineNodes = null;
let initialized = false;

// Stage music attachment is sometimes requested BEFORE Sound.init() runs —
// the initial chunks (including the main stage at 0,0) generate during world
// boot, but Sound.init must wait for a user gesture (Start tap on iOS). We
// queue those requests here and drain them once the AudioContext exists.
const _pendingStages = [];

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

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1.0;
    sfxBus.connect(masterGain);

    // Restore persisted volume levels (zerble.vol.*)
    try {
      const sm = localStorage.getItem('zerble.vol.master');
      const sc = localStorage.getItem('zerble.vol.music');
      const ss = localStorage.getItem('zerble.vol.sfx');
      if (sm !== null) masterGain.gain.value = parseFloat(sm);
      if (sc !== null) musicBus.gain.value = parseFloat(sc);
      if (ss !== null) sfxBus.gain.value = parseFloat(ss);
    } catch (e) { /* localStorage unavailable */ }

    engineNodes = createEngine(ctx, sfxBus);
    initialized = true;

    // Drain any stage music attachments that were queued during world boot.
    const queued = _pendingStages.splice(0);
    for (const q of queued) {
      if (q.handle.cancelled) continue;
      const real = createStageMusic(ctx, musicBus, q.x, q.y, q.z, q.seed, q.style);
      q.handle._adopt(real);
    }
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
  // `style` picks the synth + pattern personality: 'jam' (main stage),
  // 'brass' (side stage), 'drum' (drum circle). Unknown styles default to jam.
  attachStageMusic(x, y, z, seed, style = 'jam') {
    if (!ctx) {
      // Deferred handle — Sound.init will adopt a real music instance into
      // this same object once the AudioContext exists. Position updates that
      // arrive before adoption (e.g. a moving brass band) are remembered so
      // the adopted panner starts in the right spot.
      const handle = {
        _real: null,
        cancelled: false,
        _pendingX: x, _pendingY: y, _pendingZ: z,
        _adopt(real) {
          this._real = real;
          if (real && real.setPosition) {
            real.setPosition(this._pendingX, this._pendingY, this._pendingZ);
          }
        },
        setPosition(nx, ny, nz) {
          if (this._real && this._real.setPosition) {
            this._real.setPosition(nx, ny, nz);
          } else {
            this._pendingX = nx; this._pendingY = ny; this._pendingZ = nz;
          }
        },
        stop() {
          if (this._real) this._real.stop();
          else this.cancelled = true;
        },
      };
      _pendingStages.push({ x, y, z, seed, style, handle });
      return handle;
    }
    return createStageMusic(ctx, musicBus, x, y, z, seed, style);
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

  // boost: 0..1 — when > 0, the engine revs higher and growls louder, like
  // the driver dropped a gear. Wired from Zerble's `wantBoost` state.
  setEngineSpeed(speed, boost = 0) {
    if (!engineNodes) return;
    engineNodes.update(Math.abs(speed), boost);
  },

  playCollision(kind) {
    if (!ctx) return;
    (COLLISION_SOUNDS[kind] || COLLISION_SOUNDS.default)(ctx, sfxBus);
  },

  playHonk() {
    if (!ctx) return;
    playHonk(ctx, sfxBus);
  },

  // Optional: lower-volume bump when Zerble brushes something without damage.
  playSoftBump() {
    if (!ctx) return;
    thump(ctx, sfxBus, 110, 0.12, 0.18);
  },

  // ---- Volume controls ----
  setMasterVolume(v) { if (masterGain) masterGain.gain.value = v; this._saveVolumes(); },
  setMusicVolume(v)  { if (musicBus)   musicBus.gain.value   = v; this._saveVolumes(); },
  setSfxVolume(v)    { if (sfxBus)     sfxBus.gain.value     = v; this._saveVolumes(); },
  getMasterVolume()  { return masterGain ? masterGain.gain.value : 0.55; },
  getMusicVolume()   { return musicBus   ? musicBus.gain.value   : 1.6; },
  getSfxVolume()     { return sfxBus     ? sfxBus.gain.value     : 1.0; },

  _saveVolumes() {
    try {
      localStorage.setItem('zerble.vol.master', String(masterGain ? masterGain.gain.value : 0.55));
      localStorage.setItem('zerble.vol.music',  String(musicBus   ? musicBus.gain.value   : 1.6));
      localStorage.setItem('zerble.vol.sfx',    String(sfxBus     ? sfxBus.gain.value     : 1.0));
    } catch (e) { /* localStorage unavailable */ }
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

  // Boost smoothing — sudden 0→1 jumps in input.boost would make the engine
  // pitch jump audibly. Glide between current and target boost.
  let boostSmoothed = 0;

  return {
    update(absSpeed, boost = 0) {
      const now = ctx.currentTime;
      const dt = Math.min(0.1, now - lastUpdate);
      lastUpdate = now;

      // Glide boost toward target so engagement/disengagement isn't a step.
      boostSmoothed += (boost - boostSmoothed) * Math.min(1, dt * 6);

      // Boost raises the effective "throttle" so the engine reads as revving
      // harder even when Zerble is at max speed cap. Adds up to +30% to t.
      const baseT = Math.min(1, absSpeed / 18);
      const t = Math.min(1, baseT + boostSmoothed * 0.3);

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
      // Boost also adds a flat +20% gain so the engine sounds "louder", not just
      // higher-pitched, when the player floors it.
      const targetVol = t * 0.24 * chug * misfireMul * (1 + boostSmoothed * 0.2);
      engineGain.gain.setTargetAtTime(targetVol, now, 0.04);

      // Pitch climbs with speed + slow warble for the wheezy old-cart wobble.
      // Boost shifts the whole pitch range up so the engine wails when revving.
      warblePhase += dt * (1.8 + t * 1.5);
      const warble = Math.sin(warblePhase) * (0.04 + t * 0.05); // ±5-9 % at high revs

      const baseFreq = 48 + boostSmoothed * 10;
      const maxFreq = 145 + boostSmoothed * 40;
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

// Two horn variants picked at random — clown squeeze-bulb or bicycle bell.
function playHonk(ctx, dest) {
  if (Math.random() < 0.5) playClownBulb(ctx, dest);
  else playBicycleBell(ctx, dest);
}

// Squeeze-bulb / "ooga" clown horn: reedy rubber-bulb tone with a high-
// passed noise "click" transient at the moment of squeeze, then a sawtooth +
// triangle pair through a soft-distortion WaveShaper to give it the
// nasal/reedy character of a real rubber bulb (not a fart).
function playClownBulb(ctx, dest) {
  const t = ctx.currentTime;

  // ---- 1) Click transient: ~5ms high-passed white-noise burst ---------
  const clickDur = 0.005;
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * (clickDur + 0.02)));
  const clickBuf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const ch = clickBuf.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) ch[i] = Math.random() * 2 - 1;
  const clickSrc = ctx.createBufferSource();
  clickSrc.buffer = clickBuf;
  const clickHpf = ctx.createBiquadFilter();
  clickHpf.type = 'highpass';
  clickHpf.frequency.value = 2200;
  clickHpf.Q.value = 0.8;
  const clickEnv = ctx.createGain();
  clickEnv.gain.setValueAtTime(0.0001, t);
  clickEnv.gain.exponentialRampToValueAtTime(0.45, t + 0.001);
  clickEnv.gain.exponentialRampToValueAtTime(0.0001, t + clickDur);
  clickSrc.connect(clickHpf).connect(clickEnv).connect(dest);
  clickSrc.start(t);
  clickSrc.stop(t + clickDur + 0.01);

  // ---- 2) Body of the honk: tri + saw through a reedy WaveShaper -------
  // The triangle (replaces the previous square) gives a softer, more
  // rubbery fundamental than a square wave's hard edge.
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.32, t + 0.04);
  env.gain.exponentialRampToValueAtTime(0.30, t + 0.32);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  env.connect(dest);

  const sawOsc = ctx.createOscillator();
  sawOsc.type = 'sawtooth';
  sawOsc.frequency.setValueAtTime(380, t);
  sawOsc.frequency.exponentialRampToValueAtTime(260, t + 0.30);
  const triOsc = ctx.createOscillator();
  triOsc.type = 'triangle';
  triOsc.frequency.setValueAtTime(190, t);
  triOsc.frequency.exponentialRampToValueAtTime(130, t + 0.30);

  // Bandpass to give it a "horn body" formant.
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 750;
  bpf.Q.value = 1.2;

  // Soft-saturation WaveShaper — adds odd harmonics for the reedy bite.
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeReedCurve(2.4, 1024);
  shaper.oversample = '2x';

  sawOsc.connect(shaper);
  triOsc.connect(shaper);
  shaper.connect(bpf);
  bpf.connect(env);

  sawOsc.start();
  triOsc.start();
  sawOsc.stop(t + 0.45);
  triOsc.stop(t + 0.45);
}

// Subtle distortion curve — a softer cousin of the engine's tanh curve,
// tuned to round off peaks just enough to add reedy harmonics without
// turning into buzzy fuzz.
function makeReedCurve(drive, samples) {
  const c = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    // Soft asymmetric clip — produces the nasal bias of a real horn reed.
    c[i] = Math.tanh(x * drive + 0.18 * x * x) / Math.tanh(drive + 0.18);
  }
  return c;
}

// Bicycle bell: FM-synthesised metallic ring with a sharp "strike" transient.
// The modulator runs at a NON-integer multiple of the carrier (~√2) so the
// resulting partials are inharmonic — the secret to a real bell's clang
// instead of a musical tone. A high-pass filter pulls out the muddy lows,
// and a very short high-amplitude gain envelope creates the strike impact
// before the long ringing release.
function playBicycleBell(ctx, dest) {
  ringOnce(ctx, dest, ctx.currentTime, 2400, /*strikeGain=*/0.6, /*releaseGain=*/0.22);
  // Classic double-ring — quieter second strike ~180ms later.
  setTimeout(() => {
    if (!ctx || ctx.state === 'closed') return;
    ringOnce(ctx, dest, ctx.currentTime, 2400, 0.45, 0.16);
  }, 180);
}

function ringOnce(ctx, dest, t, carrierHz, strikeGain, releaseGain) {
  // ---- Carrier + modulator (FM synthesis, inharmonic ratio) ----------
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = carrierHz;

  const modulator = ctx.createOscillator();
  modulator.type = 'sine';
  // √2 ≈ 1.4142 — a deliberately non-integer ratio produces inharmonic
  // sidebands that read as "metal struck" rather than a clean musical note.
  modulator.frequency.value = carrierHz * 1.4142;
  const modGain = ctx.createGain();
  // Modulation index falls off slightly across the ring so the partials
  // settle into a purer sine as the bell rings out.
  modGain.gain.setValueAtTime(carrierHz * 0.28, t);
  modGain.gain.exponentialRampToValueAtTime(carrierHz * 0.10, t + 0.4);
  modulator.connect(modGain).connect(carrier.frequency);

  // ---- High-pass filter: cut the muddy low fundamental ----------------
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 1200;
  hpf.Q.value = 0.6;

  // ---- Two-stage envelope: sharp strike → long release ----------------
  // The strike is a 2ms high-amplitude transient that gives the "tink"
  // impact; the release tail rings for ~0.65s.
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(strikeGain, t + 0.002);   // strike
  env.gain.exponentialRampToValueAtTime(releaseGain, t + 0.025);  // settle
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);        // ringout

  carrier.connect(hpf).connect(env).connect(dest);
  carrier.start(t);
  modulator.start(t);
  carrier.stop(t + 0.7);
  modulator.stop(t + 0.7);
}

// ---------- Spatial stage music ----------

// Picks a key + tempo + pattern from the seed and runs a self-scheduling loop
// on a PannerNode placed at the stage. `style` picks the synth personality —
// jam-band, brass-led, or drum-only.
//
// Each style returns the same handle shape ({ panner, stop }) so callers don't
// care which engine is running underneath.
function createStageMusic(ctx, dest, x, y, z, seed, style = 'jam') {
  const panner = createStagePanner(ctx, dest, x, y, z);
  let handle;
  switch (style) {
    case 'brass':       handle = brassStage(ctx, panner, seed); break;
    case 'drum':        handle = drumStage(ctx, panner, seed); break;
    case 'second_line': handle = secondLineStage(ctx, panner, seed); break;
    case 'jam':
    default:            handle = jamStage(ctx, panner, seed); break;
  }
  // Universal position setter so callers (e.g. the marching brass band) can
  // move the source around the world each frame.
  handle.setPosition = (nx, ny, nz) => {
    if (panner.positionX) {
      panner.positionX.setTargetAtTime(nx, ctx.currentTime, 0.02);
      panner.positionY.setTargetAtTime(ny, ctx.currentTime, 0.02);
      panner.positionZ.setTargetAtTime(nz, ctx.currentTime, 0.02);
    } else if (panner.setPosition) {
      panner.setPosition(nx, ny, nz);
    }
  };
  return handle;
}

function createStagePanner(ctx, dest, x, y, z) {
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 14;
  panner.maxDistance = 140;
  panner.rolloffFactor = 1.1;
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else if (panner.setPosition) {
    panner.setPosition(x, y, z);
  }
  panner.connect(dest);
  return panner;
}

// Major pentatonic — pleasant in any key, won't clash with neighboring stages.
const SCALE_PENT = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4];
// Mixolydian-ish — flat-seventh adds a slightly hornier feel.
const SCALE_MIXO = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 16 / 9, 2];

// ----- JAM-BAND GROOVE (main stage) ----------------------------------------
// Warm triangle lead, saw bass, sub-kick, sustained chord pad, longer melody.
function jamStage(ctx, panner, seed) {
  const rng = mulberry32(seed >>> 0);
  const baseFreq = 174 * Math.pow(2, Math.floor(rng() * 12) / 12); // ~F3 ± octave
  const tempo = 86 + Math.floor(rng() * 18);
  const beat = 60 / tempo;
  const melody = new Array(16).fill(0).map(() => baseFreq * SCALE_PENT[Math.floor(rng() * SCALE_PENT.length)]);
  const bass = new Array(8).fill(0).map(() => baseFreq * 0.5 * SCALE_PENT[Math.floor(rng() * 4)]);

  const lead = ctx.createOscillator();
  lead.type = 'triangle';
  const leadGain = ctx.createGain(); leadGain.gain.value = 0;
  lead.connect(leadGain).connect(panner); lead.start();

  // Second harmonic layer an octave up for a richer "two-guitarist" feel.
  const harm = ctx.createOscillator();
  harm.type = 'sine';
  const harmGain = ctx.createGain(); harmGain.gain.value = 0;
  harm.connect(harmGain).connect(panner); harm.start();

  const bassOsc = ctx.createOscillator(); bassOsc.type = 'sawtooth';
  const bassLpf = ctx.createBiquadFilter(); bassLpf.type = 'lowpass'; bassLpf.frequency.value = 380;
  const bassGain = ctx.createGain(); bassGain.gain.value = 0;
  bassOsc.connect(bassLpf).connect(bassGain).connect(panner); bassOsc.start();

  const kick = ctx.createOscillator(); kick.type = 'sine';
  const kickGain = ctx.createGain(); kickGain.gain.value = 0;
  kick.connect(kickGain).connect(panner); kick.start();

  let nextNote = ctx.currentTime + 0.15;
  let beatIdx = 0;
  function schedule() {
    const horizon = ctx.currentTime + 0.6;
    while (nextNote < horizon) {
      const t = nextNote;
      const m = melody[beatIdx % melody.length];
      lead.frequency.setValueAtTime(m, t);
      leadGain.gain.cancelScheduledValues(t);
      leadGain.gain.setValueAtTime(0.0001, t);
      leadGain.gain.exponentialRampToValueAtTime(0.24, t + 0.015);
      leadGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.85);
      // Harmonic an octave up on accent beats
      if (beatIdx % 4 === 0) {
        harm.frequency.setValueAtTime(m * 2, t);
        harmGain.gain.cancelScheduledValues(t);
        harmGain.gain.setValueAtTime(0.0001, t);
        harmGain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
        harmGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.7);
      }
      if (beatIdx % 2 === 0) {
        const b = bass[Math.floor(beatIdx / 2) % bass.length];
        bassOsc.frequency.setValueAtTime(b, t);
        bassGain.gain.cancelScheduledValues(t);
        bassGain.gain.setValueAtTime(0.0001, t);
        bassGain.gain.exponentialRampToValueAtTime(0.30, t + 0.02);
        bassGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.8);
      }
      kick.frequency.setValueAtTime(110, t);
      kick.frequency.exponentialRampToValueAtTime(40, t + 0.08);
      kickGain.gain.cancelScheduledValues(t);
      kickGain.gain.setValueAtTime(0.0001, t);
      kickGain.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
      kickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      nextNote += beat;
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
      try { harm.stop(); } catch (e) {}
      try { bassOsc.stop(); } catch (e) {}
      try { kick.stop(); } catch (e) {}
      try { panner.disconnect(); } catch (e) {}
    },
  };
}

// ----- BRASS / HORN-LED (side stages) --------------------------------------
// Square + saw lead through a band-pass filter — gives that buzzy horn timbre.
// Faster tempo, mixolydian, staccato accents, no sub-bass kick.
function brassStage(ctx, panner, seed) {
  const rng = mulberry32(seed >>> 0);
  const baseFreq = 233 * Math.pow(2, Math.floor(rng() * 12) / 12); // Bb3 ± octave
  const tempo = 116 + Math.floor(rng() * 24);
  const beat = 60 / tempo;
  const melody = new Array(8).fill(0).map(() => baseFreq * SCALE_MIXO[Math.floor(rng() * SCALE_MIXO.length)]);
  const bass = new Array(4).fill(0).map(() => baseFreq * 0.5 * SCALE_MIXO[Math.floor(rng() * 4)]);

  // Two-osc "horn" — saw + square detuned slightly through a bandpass.
  const sawOsc = ctx.createOscillator(); sawOsc.type = 'sawtooth';
  const sqrOsc = ctx.createOscillator(); sqrOsc.type = 'square';
  const hornMix = ctx.createGain(); hornMix.gain.value = 0;
  const hornBpf = ctx.createBiquadFilter();
  hornBpf.type = 'bandpass'; hornBpf.frequency.value = 1400; hornBpf.Q.value = 1.6;
  sawOsc.connect(hornMix); sqrOsc.connect(hornMix);
  hornMix.connect(hornBpf).connect(panner);
  sawOsc.start(); sqrOsc.start();

  // Tuba-ish bass: square + low-pass.
  const tuba = ctx.createOscillator(); tuba.type = 'square';
  const tubaLpf = ctx.createBiquadFilter(); tubaLpf.type = 'lowpass'; tubaLpf.frequency.value = 320;
  const tubaGain = ctx.createGain(); tubaGain.gain.value = 0;
  tuba.connect(tubaLpf).connect(tubaGain).connect(panner); tuba.start();

  let nextNote = ctx.currentTime + 0.15;
  let beatIdx = 0;
  function schedule() {
    const horizon = ctx.currentTime + 0.6;
    while (nextNote < horizon) {
      const t = nextNote;
      const m = melody[beatIdx % melody.length];
      // Detune the two oscs ~7 cents for chorus.
      sawOsc.frequency.setValueAtTime(m * 1.004, t);
      sqrOsc.frequency.setValueAtTime(m * 0.996, t);
      hornMix.gain.cancelScheduledValues(t);
      hornMix.gain.setValueAtTime(0.0001, t);
      hornMix.gain.exponentialRampToValueAtTime(0.20, t + 0.012);
      // Staccato decay — short bursts.
      hornMix.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.55);
      // Tuba on the downbeats only.
      if (beatIdx % 2 === 0) {
        const b = bass[Math.floor(beatIdx / 2) % bass.length];
        tuba.frequency.setValueAtTime(b, t);
        tubaGain.gain.cancelScheduledValues(t);
        tubaGain.gain.setValueAtTime(0.0001, t);
        tubaGain.gain.exponentialRampToValueAtTime(0.32, t + 0.025);
        tubaGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.4);
      }
      nextNote += beat;
      beatIdx++;
    }
  }
  schedule();
  const intervalId = setInterval(schedule, 200);
  return {
    panner,
    stop() {
      clearInterval(intervalId);
      try { sawOsc.stop(); } catch (e) {}
      try { sqrOsc.stop(); } catch (e) {}
      try { tuba.stop(); } catch (e) {}
      try { panner.disconnect(); } catch (e) {}
    },
  };
}

// ----- SECOND-LINE BRASS BAND ----------------------------------------------
// Marching New Orleans groove that follows the band around the world. Built
// from a tuba walking bass + a snare-driven second-line pattern + two horn
// voices doing simple call-and-response phrases in mixolydian. The schedule
// runs on 16th-note ticks so the snare can land its trademark off-beat
// rolls between the kicks.
function secondLineStage(ctx, panner, seed) {
  const rng = mulberry32(seed >>> 0);
  const baseFreq = 220 * Math.pow(2, Math.floor(rng() * 7 - 3) / 12);   // A3 ± ~quarter octave
  const tempo = 102 + Math.floor(rng() * 14);
  const beat = 60 / tempo;
  const tick = beat / 4;          // 16th-note grid

  // ---- Voices ----
  // Two brass voices: a lead horn (trumpet) + a counter horn (trombone).
  const leadOsc = ctx.createOscillator(); leadOsc.type = 'sawtooth';
  const leadSqr = ctx.createOscillator(); leadSqr.type = 'square';
  const leadMix = ctx.createGain(); leadMix.gain.value = 0;
  const leadBpf = ctx.createBiquadFilter();
  leadBpf.type = 'bandpass'; leadBpf.frequency.value = 1500; leadBpf.Q.value = 1.5;
  leadOsc.connect(leadMix); leadSqr.connect(leadMix);
  leadMix.connect(leadBpf).connect(panner);
  leadOsc.start(); leadSqr.start();

  const counterOsc = ctx.createOscillator(); counterOsc.type = 'sawtooth';
  const counterMix = ctx.createGain(); counterMix.gain.value = 0;
  const counterBpf = ctx.createBiquadFilter();
  counterBpf.type = 'bandpass'; counterBpf.frequency.value = 900; counterBpf.Q.value = 1.2;
  counterOsc.connect(counterMix).connect(counterBpf).connect(panner);
  counterOsc.start();

  // Tuba walking bass — square through low-pass.
  const tubaOsc = ctx.createOscillator(); tubaOsc.type = 'square';
  const tubaLpf = ctx.createBiquadFilter();
  tubaLpf.type = 'lowpass'; tubaLpf.frequency.value = 280;
  const tubaGain = ctx.createGain(); tubaGain.gain.value = 0;
  tubaOsc.connect(tubaLpf).connect(tubaGain).connect(panner);
  tubaOsc.start();

  // Kick drum — short sine sweep.
  const kickOsc = ctx.createOscillator(); kickOsc.type = 'sine';
  const kickGain = ctx.createGain(); kickGain.gain.value = 0;
  kickOsc.connect(kickGain).connect(panner);
  kickOsc.start();

  // Snare — short noise burst through a band-pass with envelope. To keep
  // GC churn down, we build one looping noise buffer and gate it with a
  // gain node each hit.
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const nch = noiseBuf.getChannelData(0);
  for (let i = 0; i < nch.length; i++) nch[i] = Math.random() * 2 - 1;
  const snareSrc = ctx.createBufferSource();
  snareSrc.buffer = noiseBuf;
  snareSrc.loop = true;
  const snareBpf = ctx.createBiquadFilter();
  snareBpf.type = 'bandpass'; snareBpf.frequency.value = 1800; snareBpf.Q.value = 1.6;
  const snareGain = ctx.createGain(); snareGain.gain.value = 0;
  snareSrc.connect(snareBpf).connect(snareGain).connect(panner);
  snareSrc.start();

  // ---- Patterns ----
  // 16 ticks per bar (4 beats × 4 sixteenths). Numbers are tick positions.
  const KICK_TICKS = [0, 8];                              // kick on 1 and 3
  const SNARE_TICKS = [
    { tick: 4,  vol: 0.30 },   // backbeat 2
    { tick: 6,  vol: 0.10 },   // ghost
    { tick: 7,  vol: 0.20 },   // pickup to 3
    { tick: 12, vol: 0.30 },   // backbeat 4
    { tick: 13, vol: 0.12 },   // grace
    { tick: 14, vol: 0.18 },   // roll
    { tick: 15, vol: 0.22 },   // pickup to 1
  ];
  // Tuba walks I → V → bVII → IV (a mixolydian standard). Two notes per beat.
  const TUBA_RATIOS = [1.0, 1.0, 1.5, 1.5, 16/9, 16/9, 4/3, 4/3];
  const SCALE = SCALE_MIXO;
  // Lead riff: 16 melodic indices (-1 = rest), in scale-degree positions.
  const LEAD = [4, -1, 5, 4, -1, 2, -1, 1,  4, 5, 6, 5, 4, 2, 1, -1];
  // Counter horn: sparser, lower octave.
  const COUNTER = [-1, -1, 1, -1, -1, 2, -1, -1, -1, -1, 4, -1, 2, 1, -1, -1];

  let nextTick = ctx.currentTime + 0.15;
  let tickIdx = 0;
  function schedule() {
    const horizon = ctx.currentTime + 0.6;
    while (nextTick < horizon) {
      const t = nextTick;
      const bt = tickIdx % 16;

      // Kick
      if (KICK_TICKS.includes(bt)) {
        kickOsc.frequency.setValueAtTime(105, t);
        kickOsc.frequency.exponentialRampToValueAtTime(45, t + 0.10);
        kickGain.gain.cancelScheduledValues(t);
        kickGain.gain.setValueAtTime(0.0001, t);
        kickGain.gain.exponentialRampToValueAtTime(0.42, t + 0.005);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      }
      // Snare
      for (const s of SNARE_TICKS) {
        if (s.tick === bt) {
          snareGain.gain.cancelScheduledValues(t);
          snareGain.gain.setValueAtTime(0.0001, t);
          snareGain.gain.exponentialRampToValueAtTime(s.vol, t + 0.002);
          snareGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        }
      }
      // Tuba on every other tick (8th notes)
      if (bt % 2 === 0) {
        const ratio = TUBA_RATIOS[(bt / 2) % TUBA_RATIOS.length];
        tubaOsc.frequency.setValueAtTime(baseFreq * 0.5 * ratio, t);
        tubaGain.gain.cancelScheduledValues(t);
        tubaGain.gain.setValueAtTime(0.0001, t);
        tubaGain.gain.exponentialRampToValueAtTime(0.30, t + 0.02);
        tubaGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.55);
      }
      // Lead horn riff
      const leadIdx = LEAD[bt];
      if (leadIdx >= 0) {
        const f = baseFreq * SCALE[leadIdx % SCALE.length];
        leadOsc.frequency.setValueAtTime(f * 1.004, t);
        leadSqr.frequency.setValueAtTime(f * 0.996, t);
        leadMix.gain.cancelScheduledValues(t);
        leadMix.gain.setValueAtTime(0.0001, t);
        leadMix.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
        leadMix.gain.exponentialRampToValueAtTime(0.0001, t + tick * 2.6);
      }
      // Counter horn (lower)
      const counterIdx = COUNTER[bt];
      if (counterIdx >= 0) {
        const f = baseFreq * 0.5 * SCALE[counterIdx % SCALE.length];
        counterOsc.frequency.setValueAtTime(f, t);
        counterMix.gain.cancelScheduledValues(t);
        counterMix.gain.setValueAtTime(0.0001, t);
        counterMix.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
        counterMix.gain.exponentialRampToValueAtTime(0.0001, t + tick * 3);
      }

      nextTick += tick;
      tickIdx++;
    }
  }
  schedule();
  const intervalId = setInterval(schedule, 160);
  return {
    panner,
    stop() {
      clearInterval(intervalId);
      try { leadOsc.stop(); } catch (e) {}
      try { leadSqr.stop(); } catch (e) {}
      try { counterOsc.stop(); } catch (e) {}
      try { tubaOsc.stop(); } catch (e) {}
      try { kickOsc.stop(); } catch (e) {}
      try { snareSrc.stop(); } catch (e) {}
      try { panner.disconnect(); } catch (e) {}
    },
  };
}

// ----- DRUM CIRCLE (polyrhythmic drums, no melody) -------------------------
// Two toms in a 3:4 cross-rhythm, plus a heartbeat-like kick. The seed picks
// tempo + which tom plays the 3-pattern vs the 4-pattern.
function drumStage(ctx, panner, seed) {
  const rng = mulberry32(seed >>> 0);
  const tempo = 70 + Math.floor(rng() * 22);
  const beat = 60 / tempo;
  // Tick = 1/12th of a measure (LCM of 3 and 4).
  const tick = beat / 3;
  const tom1Freq = 150 + Math.floor(rng() * 40);   // higher tom
  const tom2Freq = 88 + Math.floor(rng() * 22);    // lower tom

  // Drums are pitch-swept sine oscillators that we re-pluck per hit.
  const kick = ctx.createOscillator(); kick.type = 'sine';
  const kickGain = ctx.createGain(); kickGain.gain.value = 0;
  kick.connect(kickGain).connect(panner); kick.start();

  const tom1 = ctx.createOscillator(); tom1.type = 'sine';
  const tom1Gain = ctx.createGain(); tom1Gain.gain.value = 0;
  tom1.connect(tom1Gain).connect(panner); tom1.start();

  const tom2 = ctx.createOscillator(); tom2.type = 'sine';
  const tom2Gain = ctx.createGain(); tom2Gain.gain.value = 0;
  tom2.connect(tom2Gain).connect(panner); tom2.start();

  let nextTick = ctx.currentTime + 0.15;
  let tickIdx = 0;
  function schedule() {
    const horizon = ctx.currentTime + 0.6;
    while (nextTick < horizon) {
      const t = nextTick;
      const measureTick = tickIdx % 12;
      // Kick: 1 and 7 (every half measure).
      if (measureTick === 0 || measureTick === 6) {
        kick.frequency.setValueAtTime(95, t);
        kick.frequency.exponentialRampToValueAtTime(45, t + 0.10);
        kickGain.gain.cancelScheduledValues(t);
        kickGain.gain.setValueAtTime(0.0001, t);
        kickGain.gain.exponentialRampToValueAtTime(0.48, t + 0.005);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      }
      // Tom1 on the 3-pattern (every 4 ticks)
      if (measureTick % 4 === 0) {
        tom1.frequency.setValueAtTime(tom1Freq * 1.2, t);
        tom1.frequency.exponentialRampToValueAtTime(tom1Freq, t + 0.06);
        tom1Gain.gain.cancelScheduledValues(t);
        tom1Gain.gain.setValueAtTime(0.0001, t);
        tom1Gain.gain.exponentialRampToValueAtTime(0.34, t + 0.005);
        tom1Gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      }
      // Tom2 on the 4-pattern (every 3 ticks)
      if (measureTick % 3 === 0) {
        tom2.frequency.setValueAtTime(tom2Freq * 1.2, t);
        tom2.frequency.exponentialRampToValueAtTime(tom2Freq, t + 0.07);
        tom2Gain.gain.cancelScheduledValues(t);
        tom2Gain.gain.setValueAtTime(0.0001, t);
        tom2Gain.gain.exponentialRampToValueAtTime(0.30, t + 0.005);
        tom2Gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      }
      nextTick += tick;
      tickIdx++;
    }
  }
  schedule();
  const intervalId = setInterval(schedule, 180);
  return {
    panner,
    stop() {
      clearInterval(intervalId);
      try { kick.stop(); } catch (e) {}
      try { tom1.stop(); } catch (e) {}
      try { tom2.stop(); } catch (e) {}
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
