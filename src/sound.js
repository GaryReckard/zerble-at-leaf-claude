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
let musicDuckGain = null; // downstream attenuator — ducks when an external player (MIDI) is active
// Trip effect chain — sits between musicDuckGain and masterGain. Always
// wired in; only audibly active when `setMusicTrip(env, p)` ramps the
// wet gain above zero. Drives a lowpass sweep + a feedback delay in
// lockstep with the visual trip envelope. See `setMusicTrip` below.
let _tripDryGain = null;
let _tripWetGain = null;
let _tripLowpass = null;
let _tripDelay = null;
let _tripFeedback = null;
let sfxBus = null;       // shared bus for all SFX (engine, collisions, honks, bumps)
let engineNodes = null;
let initialized = false;
let silentUnlockEl = null;   // HTMLAudioElement kept alive to hold the iOS "Playback" audio session
let silentUnlockUrl = null;  // Blob URL — revoked on tear-down (not currently torn down, but for hygiene)

// Diagnostics state — populated by init() so we can surface what unlocked
// (and what didn't) from window.__game.sound.diagnostics() on the iPhone.
const _diag = {
  initCalled: false,
  ctxConstructed: false,
  ctxStateAfterConstruct: null,
  resumeCalled: false,
  resumeError: null,
  ctxStateAfterResume: null,
  htmlUnlockTried: false,
  htmlUnlockPlayResolved: false,
  htmlUnlockPlayRejected: null,
  webAudioBufferUnlocked: false,
  restoredFromLocalStorage: { master: null, music: null, sfx: null },
};

// Build a valid 100ms silent 16-bit PCM WAV in memory. We use a real (non-zero)
// audio body because some iOS Safari versions silently refuse to mark
// zero-sample media as "played", which means the audio session never promotes
// to Playback and the hardware silent switch keeps muting WebAudio.
function buildSilentWavBlobUrl() {
  const sampleRate = 8000;
  const numSamples = sampleRate / 10;          // 100ms
  const dataBytes = numSamples * 2;            // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  let p = 0;
  const wU32 = (v) => { view.setUint32(p, v, true); p += 4; };
  const wU16 = (v) => { view.setUint16(p, v, true); p += 2; };
  const wStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); };
  wStr('RIFF'); wU32(36 + dataBytes);
  wStr('WAVE'); wStr('fmt '); wU32(16);
  wU16(1);                                     // PCM
  wU16(1);                                     // 1 channel
  wU32(sampleRate);                            // sample rate
  wU32(sampleRate * 2);                        // byte rate (1ch * 16bit)
  wU16(2);                                     // block align
  wU16(16);                                    // bits per sample
  wStr('data'); wU32(dataBytes);
  // 16-bit signed PCM silence is 0 — ArrayBuffer is already zeroed.
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

// Global nightness (0..1) — set each frame by main.js via Sound.setNightness.
// The forest drum engine reads this every scheduler tick to gate voices in,
// shape velocities, and decide whether the crackling-fire bed plays.
let currentNightness = 0;

// Stage music attachment is sometimes requested BEFORE Sound.init() runs —
// the initial chunks (including the main stage at 0,0) generate during world
// boot, but Sound.init must wait for a user gesture (Start tap on iOS). We
// queue those requests here and drain them once the AudioContext exists.
const _pendingStages = [];

export const Sound = {
  // Must be called from a user gesture (Start button click). Safe to call again.
  init() {
    _diag.initCalled = true;
    if (initialized) {
      // Resume in case the browser auto-suspended
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ctx = new AudioCtx();
    _diag.ctxConstructed = true;
    _diag.ctxStateAfterConstruct = ctx.state;

    // iOS unlock A: resume FIRST, before we touch any other node. On iOS the
    // AudioContext is constructed in 'suspended' state and resume() needs the
    // active user gesture. Doing it before the rest of the graph setup keeps
    // the gesture privilege as fresh as possible.
    if (ctx.state === 'suspended') {
      _diag.resumeCalled = true;
      const p = ctx.resume();
      if (p && typeof p.then === 'function') {
        p.then(() => { _diag.ctxStateAfterResume = ctx.state; })
         .catch((e) => { _diag.resumeError = String(e); });
      } else {
        _diag.ctxStateAfterResume = ctx.state;
      }
    } else {
      _diag.ctxStateAfterResume = ctx.state;
    }

    // iOS unlock B: play a 1-sample silent WebAudio buffer source. On some
    // older iOS versions this is what actually flips the WebAudio scheduler
    // from "scheduled but silent" to "audible". Cheap, harmless on every
    // other browser.
    try {
      const unlockBuf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = unlockBuf;
      src.connect(ctx.destination);
      src.start(0);
      _diag.webAudioBufferUnlocked = true;
    } catch (e) { /* old iOS may throw on createBuffer(1,1,22050); we tried */ }

    // iOS unlock C: play a real HTMLAudioElement so the page is promoted to
    // the "Playback" audio session and WebAudio stops respecting the silent
    // switch. Must be a non-zero-duration media file with a valid header — a
    // 0-sample WAV will look "played" to us but iOS sometimes doesn't count
    // it. Build a real 100ms silent WAV in memory and play it from a Blob URL,
    // appended to the DOM so iOS treats it as a first-class media element.
    try {
      _diag.htmlUnlockTried = true;
      silentUnlockUrl = buildSilentWavBlobUrl();
      const el = document.createElement('audio');
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.preload = 'auto';
      el.loop = true;
      el.muted = false;
      el.volume = 0.001;            // audible to iOS, inaudible to humans
      el.src = silentUnlockUrl;
      // Off-screen but in the tree — appending to <body> matters on iOS.
      el.style.position = 'fixed';
      el.style.top = '-9999px';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.opacity = '0';
      document.body.appendChild(el);
      const p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { _diag.htmlUnlockPlayResolved = true; })
         .catch((e) => { _diag.htmlUnlockPlayRejected = String(e); });
      } else {
        _diag.htmlUnlockPlayResolved = true;
      }
      silentUnlockEl = el;
    } catch (e) { _diag.htmlUnlockPlayRejected = String(e); }

    // Now build the actual mix graph.
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);

    musicBus = ctx.createGain();
    // Was 1.6 when the music was a wall-of-sound four-loop pattern at boot.
    // The generators now breathe + rotate variants so they don't need the
    // headroom boost to "carry" — dropping to 1.2 cuts the in-your-face
    // feel near the main stage without making distant stages disappear.
    musicBus.gain.value = 1.2;

    // Downstream duck node — MIDI player ramps this to ~0.2 while it's
    // playing so the in-world stage music doesn't fight the foreground
    // music. User's saved volume preference still lives on musicBus.gain;
    // the duck node is purely a runtime multiplier on top.
    musicDuckGain = ctx.createGain();
    musicDuckGain.gain.value = 1.0;
    musicBus.connect(musicDuckGain);

    // Trip effects chain (wet/dry) on the music path. Dry is the bypass — always
    // 1.0. Wet routes through a lowpass + feedback delay, summed back at
    // masterGain. `setMusicTrip(env, p)` ramps the wet gain and modulates the
    // lowpass cutoff + delay feedback in lockstep with the visual trip. When
    // env=0 the wet branch is silent, so the only steady-state cost is two
    // Gain nodes + a BiquadFilter + a DelayNode all running at idle gain 0
    // (still very cheap).
    _tripDryGain = ctx.createGain();
    _tripDryGain.gain.value = 1.0;
    _tripWetGain = ctx.createGain();
    _tripWetGain.gain.value = 0.0;
    _tripLowpass = ctx.createBiquadFilter();
    _tripLowpass.type = 'lowpass';
    _tripLowpass.frequency.value = 18000;   // wide open at idle
    _tripLowpass.Q.value = 1.0;
    _tripDelay = ctx.createDelay(1.0);       // up to 1s of delay
    _tripDelay.delayTime.value = 0.28;
    _tripFeedback = ctx.createGain();
    _tripFeedback.gain.value = 0.0;          // ramps with envelope (0..0.78)

    // Wiring:
    //   musicDuckGain ─┬─→ _tripDryGain ──→ masterGain        (dry path)
    //                  └─→ _tripLowpass ──┬─→ _tripWetGain ──→ masterGain
    //                                     └─→ _tripDelay ────→ _tripFeedback ──→ _tripLowpass  (delay loop)
    musicDuckGain.connect(_tripDryGain);
    _tripDryGain.connect(masterGain);
    musicDuckGain.connect(_tripLowpass);
    _tripLowpass.connect(_tripWetGain);
    _tripWetGain.connect(masterGain);
    _tripLowpass.connect(_tripDelay);
    _tripDelay.connect(_tripFeedback);
    _tripFeedback.connect(_tripLowpass);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1.0;
    sfxBus.connect(masterGain);

    // Restore persisted volume levels (zerble.vol.*). Clamp anything < 0.05
    // up to 0.05 — a stuck-at-zero slider from a previous session is the
    // sneakiest "no sound" footgun, and 0.05 is still close enough to silent
    // that an intentionally-muted player won't notice. Use Sound.setVolume()
    // to explicitly go all the way to zero.
    try {
      const restore = (key, gain, fallback) => {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        const v = parseFloat(raw);
        if (!Number.isFinite(v)) return null;
        const clamped = v < 0.05 ? 0.05 : v;
        gain.gain.value = clamped;
        return { raw, applied: clamped };
      };
      _diag.restoredFromLocalStorage.master = restore('zerble.vol.master', masterGain);
      _diag.restoredFromLocalStorage.music  = restore('zerble.vol.music',  musicBus);
      _diag.restoredFromLocalStorage.sfx    = restore('zerble.vol.sfx',    sfxBus);
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

  // Returns a snapshot of the audio init state. Wired through
  // window.__game.sound.diagnostics() so we can probe an iPhone via Safari
  // Web Inspector without ad-hoc instrumentation. Also includes the LIVE
  // ctx state + gain values so we can spot a stuck-suspended context or a
  // dropped-to-zero master after the fact.
  diagnostics() {
    return {
      ...JSON.parse(JSON.stringify(_diag)),
      live: {
        initialized,
        ctxState: ctx ? ctx.state : 'no-ctx',
        ctxSampleRate: ctx ? ctx.sampleRate : null,
        ctxBaseLatency: ctx ? ctx.baseLatency : null,
        masterGain: masterGain ? masterGain.gain.value : null,
        musicBus: musicBus ? musicBus.gain.value : null,
        sfxBus: sfxBus ? sfxBus.gain.value : null,
        silentUnlockPaused: silentUnlockEl ? silentUnlockEl.paused : null,
        silentUnlockCurrentTime: silentUnlockEl ? silentUnlockEl.currentTime : null,
        silentUnlockReadyState: silentUnlockEl ? silentUnlockEl.readyState : null,
      },
    };
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
    // iOS may also pause the silent-unlock element when the tab backgrounds,
    // which can drop the page back to the Ambient audio session and re-mute
    // WebAudio behind the silent switch. Nudge it back to playing.
    if (silentUnlockEl && silentUnlockEl.paused) {
      const p = silentUnlockEl.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  },

  isReady() {
    return initialized;
  },

  // Push the current world nightness (0..1) into module state. The forest
  // drum engine reads this each scheduler tick to gate voices/velocity, and
  // the crackling-fire bed gates on it too. Cheap call — bare variable set.
  setNightness(n) {
    currentNightness = Math.max(0, Math.min(1, n));
  },

  // Drive the music-bus trip effect chain from the global Trip envelope.
  // env (0..1)     — overall wet intensity. 0 = bypass, 1 = full effect.
  // progress (0..1) — phase across the full trip. Used to layer a slow
  //                   lowpass sweep and a feedback bell on top of the gate.
  //
  // The chain warps procedural music (bands, drums, drum circles) the same
  // way the MIDI player's effects chain warps Tone.js playback — closing
  // off the high end and pushing the feedback delay toward runaway near
  // the climax (around p=1/3), then easing out.
  //
  // No-op until `Sound.init()` has wired the nodes.
  setMusicTrip(env, progress) {
    if (!_tripWetGain || !_tripLowpass || !_tripFeedback || !_tripDelay) return;
    const e = Math.max(0, Math.min(1, env || 0));
    const p = Math.max(0, Math.min(1, progress || 0));
    const t = ctx.currentTime;

    // Wet/dry crossfade. Dry never fully drops out — even at peak we keep
    // some clean signal so the music remains recognizable.
    const wet = e;
    const dry = 1.0 - e * 0.55;
    _tripWetGain.gain.setTargetAtTime(wet, t, 0.05);
    _tripDryGain.gain.setTargetAtTime(dry, t, 0.05);

    // Lowpass sweeps from open (18kHz) to muddy (~700Hz) on the wet branch
    // proportionally to envelope. A slow extra wobble on `progress` adds
    // life so the sweep doesn't sit at one cutoff for the whole trip.
    const wobble = 0.5 + 0.5 * Math.sin(p * Math.PI * 2 * 1.5);
    const cutoff = 18000 + (700 - 18000) * e * (0.55 + 0.45 * wobble);
    _tripLowpass.frequency.setTargetAtTime(cutoff, t, 0.1);

    // Feedback delay — runaway-ish near the climax (p≈1/3), tamer at the
    // edges. Caps at 0.78 to keep the signal from blowing up entirely.
    const peakBell = Math.exp(-Math.pow((p - 1 / 3) / 0.18, 2));
    const fb = e * (0.35 + 0.43 * peakBell);
    _tripFeedback.gain.setTargetAtTime(Math.min(0.78, fb), t, 0.1);

    // Delay time drifts a hair so the echo isn't perfectly metronomic.
    const dt = 0.28 + 0.08 * Math.sin(p * Math.PI * 2 * 0.7);
    _tripDelay.delayTime.setTargetAtTime(dt, t, 0.1);
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
        // Forward lowpass cutoff to the real handle once adoption finishes.
        // Pre-adoption calls are silently dropped — the engine sets its own
        // initial cutoff at construction time, so the first call lands within
        // a frame or two of the audio coming up anyway.
        setLowpassCutoff(freq) {
          if (this._real && this._real.setLowpassCutoff) {
            this._real.setLowpassCutoff(freq);
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

  // Specific-sound variants (bound to B and H keys for direct triggering).
  playBicycleBell() {
    if (!ctx) return;
    playBicycleBell(ctx, sfxBus);
  },

  playClownHorn() {
    if (!ctx) return;
    playClownBulb(ctx, sfxBus);
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

  // Runtime music attenuator — independent of the user's saved volume.
  // The MIDI player calls this with ~0.18 on start and 1.0 on stop so the
  // in-world stage music ducks under the foreground MIDI instead of
  // fighting it. Ramped to avoid pops.
  setMusicDuck(factor) {
    if (!musicDuckGain || !ctx) return;
    const now = ctx.currentTime;
    musicDuckGain.gain.cancelScheduledValues(now);
    musicDuckGain.gain.setValueAtTime(musicDuckGain.gain.value, now);
    musicDuckGain.gain.linearRampToValueAtTime(factor, now + 0.4);
  },
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

// Squeeze-bulb / "ooga" clown horn — TWO sounds in sequence:
//   1) HONK (squeeze): one steady low tone with a sharp click transient up
//      front. Lasts ~0.22s. Frequency does NOT slide — a real rubber bulb
//      makes a steady note while you squeeze it.
//   2) INHALE (release): a quieter, shorter, HIGHER tone as air rushes back
//      into the bulb. Pitched a perfect fifth (1.5×) above the honk.
function playClownBulb(ctx, dest) {
  const t = ctx.currentTime;

  // Tone frequencies (steady — no glide).
  const HONK_SAW = 260, HONK_TRI = 130;
  const INHALE_SAW = HONK_SAW * 1.5, INHALE_TRI = HONK_TRI * 1.5;  // a 5th above

  // Phase timings.
  const HONK_DUR    = 0.22;   // squeeze hold
  const GAP         = 0.05;   // tiny silence between squeeze and release
  const INHALE_DUR  = 0.16;   // shorter, breathier
  const TOTAL       = HONK_DUR + GAP + INHALE_DUR + 0.05;

  // ---- 1) Squeeze CLICK: ~5ms high-passed white-noise burst at t=0 ------
  function emitClick(at, gain, hpfHz) {
    const dur = 0.005;
    const n = Math.max(1, Math.floor(ctx.sampleRate * (dur + 0.02)));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = hpfHz;
    hpf.Q.value = 0.8;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(hpf).connect(env).connect(dest);
    src.start(at);
    src.stop(at + dur + 0.01);
  }
  emitClick(t, 0.45, 2200);                          // sharp squeeze click
  emitClick(t + HONK_DUR + GAP, 0.18, 3000);         // softer intake "puff"

  // ---- 2) Body — saw + tri through reed WaveShaper, two phases ---------
  // Single envelope handles both honk and inhale with a gap in the middle.
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  // HONK: ramp up, sustain, drop to silence at the gap.
  env.gain.exponentialRampToValueAtTime(0.32, t + 0.025);
  env.gain.setValueAtTime(0.32, t + HONK_DUR - 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, t + HONK_DUR);
  // INHALE: ramp up at lower peak, hold, fade.
  const tInhaleStart = t + HONK_DUR + GAP;
  env.gain.exponentialRampToValueAtTime(0.20, tInhaleStart + 0.02);
  env.gain.setValueAtTime(0.20, tInhaleStart + INHALE_DUR - 0.04);
  env.gain.exponentialRampToValueAtTime(0.0001, tInhaleStart + INHALE_DUR);
  env.connect(dest);

  const sawOsc = ctx.createOscillator();
  sawOsc.type = 'sawtooth';
  sawOsc.frequency.setValueAtTime(HONK_SAW, t);
  sawOsc.frequency.setValueAtTime(INHALE_SAW, tInhaleStart);

  const triOsc = ctx.createOscillator();
  triOsc.type = 'triangle';
  triOsc.frequency.setValueAtTime(HONK_TRI, t);
  triOsc.frequency.setValueAtTime(INHALE_TRI, tInhaleStart);

  // Bandpass — "horn body" formant.
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 750;
  bpf.Q.value = 1.2;

  // Soft-saturation reed shaper.
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeReedCurve(2.4, 1024);
  shaper.oversample = '2x';

  sawOsc.connect(shaper);
  triOsc.connect(shaper);
  shaper.connect(bpf);
  bpf.connect(env);

  sawOsc.start();
  triOsc.start();
  sawOsc.stop(t + TOTAL);
  triOsc.stop(t + TOTAL);
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

// Bicycle bell — a real bell's thumb-lever bounces against the dome multiple
// times in rapid succession, so we render each "brrring" as 6 closely-spaced
// strikes (~30Hz strike rate) whose ring tails overlap into a rolling buzz
// instead of a clean single ding. Two brrrings = classic double-trill.
function playBicycleBell(ctx, dest) {
  const t0 = ctx.currentTime;
  brrring(ctx, dest, t0,         /*loud=*/0.55);
  brrring(ctx, dest, t0 + 0.32,  /*loud=*/0.42);  // quieter second trill
}

// One "brrring": 6 inharmonic FM strikes, ~32ms apart (~31Hz strike rate),
// each strike progressively softer so the trill rolls off rather than
// sustaining as a wall of clang.
function brrring(ctx, dest, tStart, loud) {
  const STRIKES = 6;
  const SPACING = 0.032;        // 32ms between strikes → ~31Hz buzz
  for (let i = 0; i < STRIKES; i++) {
    // Each subsequent strike is a bit quieter (the lever loses energy with
    // each bounce). Last few strikes have short release so the brrring doesn't
    // smear into the next trill.
    const tap = i === 0 ? loud : loud * (1 - i * 0.13);
    const release = 0.10 - i * 0.012;  // first strikes ring longer
    ringOnce(ctx, dest, tStart + i * SPACING, 2400, tap, Math.max(0.04, release));
  }
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
    case 'forest_drum': handle = forestDrumStage(ctx, panner, seed); break;
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
  // setLowpassCutoff is only defined on the forest-drum engine — leave a
  // no-op shim on other styles so callers can call it uniformly.
  if (typeof handle.setLowpassCutoff !== 'function') {
    handle.setLowpassCutoff = () => {};
  }
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
//
// Variation pass: instead of a single 16-note melody on infinite loop, we
// generate 3 melody variants + 2 bass variants up front (still deterministic
// per seed) and rotate which one is "active" every 32 beats so the phrase
// changes ~every 22s. Lead notes have a 22% chance to drop entirely so the
// solo breathes instead of hammering. Every note's peak gain is multiplied
// by a slow LFO so the mix ebbs and flows over ~28 seconds.
function jamStage(ctx, panner, seed) {
  const rng = mulberry32(seed >>> 0);
  const baseFreq = 174 * Math.pow(2, Math.floor(rng() * 12) / 12); // ~F3 ± octave
  const tempo = 86 + Math.floor(rng() * 18);
  const beat = 60 / tempo;

  const MELODY_VARIANTS = 3;
  const BASS_VARIANTS = 2;
  const BEATS_PER_ROTATION = 32;        // ≈ 2 melody loops per variant
  const REST_PROB = 0.10;               // chance any given lead note drops
  const LFO_PERIOD_S = 28;
  const LFO_DEPTH = 0.30;               // ±30% on peak gain

  const melodies = Array.from({ length: MELODY_VARIANTS }, () =>
    new Array(16).fill(0).map(() => baseFreq * SCALE_PENT[Math.floor(rng() * SCALE_PENT.length)])
  );
  const basses = Array.from({ length: BASS_VARIANTS }, () =>
    new Array(8).fill(0).map(() => baseFreq * 0.5 * SCALE_PENT[Math.floor(rng() * 4)])
  );

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
      const rot = Math.floor(beatIdx / BEATS_PER_ROTATION);
      const melody = melodies[rot % MELODY_VARIANTS];
      const bass   = basses[rot % BASS_VARIANTS];
      const m = melody[beatIdx % melody.length];
      // Slow breath — sin maps to [-1,1], so peak gain is multiplied by [0.7, 1.3].
      const breath = 1 + LFO_DEPTH * Math.sin((t / LFO_PERIOD_S) * 2 * Math.PI);

      // Lead drops out 22% of beats. Kick + bass + harm keep going so the
      // pulse doesn't disappear — only the melody breathes.
      if (Math.random() >= REST_PROB) {
        lead.frequency.setValueAtTime(m, t);
        leadGain.gain.cancelScheduledValues(t);
        leadGain.gain.setValueAtTime(0.0001, t);
        leadGain.gain.exponentialRampToValueAtTime(0.24 * breath, t + 0.015);
        leadGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.85);
      }
      // Harmonic an octave up on accent beats
      if (beatIdx % 4 === 0) {
        harm.frequency.setValueAtTime(m * 2, t);
        harmGain.gain.cancelScheduledValues(t);
        harmGain.gain.setValueAtTime(0.0001, t);
        harmGain.gain.exponentialRampToValueAtTime(0.08 * breath, t + 0.02);
        harmGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.7);
      }
      if (beatIdx % 2 === 0) {
        const b = bass[Math.floor(beatIdx / 2) % bass.length];
        bassOsc.frequency.setValueAtTime(b, t);
        bassGain.gain.cancelScheduledValues(t);
        bassGain.gain.setValueAtTime(0.0001, t);
        bassGain.gain.exponentialRampToValueAtTime(0.30 * breath, t + 0.02);
        bassGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.8);
      }
      kick.frequency.setValueAtTime(110, t);
      kick.frequency.exponentialRampToValueAtTime(40, t + 0.08);
      kickGain.gain.cancelScheduledValues(t);
      kickGain.gain.setValueAtTime(0.0001, t);
      kickGain.gain.exponentialRampToValueAtTime(0.5 * breath, t + 0.005);
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
//
// Variation pass: 3 horn melodies, 2 tuba lines, rotated every 16 beats.
// Horn dropouts 28% (brass naturally takes breaths between phrases).
// Slow ±25% gain LFO over 22s — slightly faster than jam since brass is
// inherently punchier.
function brassStage(ctx, panner, seed) {
  const rng = mulberry32(seed >>> 0);
  const baseFreq = 233 * Math.pow(2, Math.floor(rng() * 12) / 12); // Bb3 ± octave
  const tempo = 116 + Math.floor(rng() * 24);
  const beat = 60 / tempo;

  const MELODY_VARIANTS = 3;
  const BASS_VARIANTS = 2;
  const BEATS_PER_ROTATION = 16;
  const REST_PROB = 0.12;
  const LFO_PERIOD_S = 22;
  const LFO_DEPTH = 0.25;

  const melodies = Array.from({ length: MELODY_VARIANTS }, () =>
    new Array(8).fill(0).map(() => baseFreq * SCALE_MIXO[Math.floor(rng() * SCALE_MIXO.length)])
  );
  const basses = Array.from({ length: BASS_VARIANTS }, () =>
    new Array(4).fill(0).map(() => baseFreq * 0.5 * SCALE_MIXO[Math.floor(rng() * 4)])
  );

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
      const rot = Math.floor(beatIdx / BEATS_PER_ROTATION);
      const melody = melodies[rot % MELODY_VARIANTS];
      const bass   = basses[rot % BASS_VARIANTS];
      const m = melody[beatIdx % melody.length];
      const breath = 1 + LFO_DEPTH * Math.sin((t / LFO_PERIOD_S) * 2 * Math.PI);

      if (Math.random() >= REST_PROB) {
        // Detune the two oscs ~7 cents for chorus.
        sawOsc.frequency.setValueAtTime(m * 1.004, t);
        sqrOsc.frequency.setValueAtTime(m * 0.996, t);
        hornMix.gain.cancelScheduledValues(t);
        hornMix.gain.setValueAtTime(0.0001, t);
        hornMix.gain.exponentialRampToValueAtTime(0.20 * breath, t + 0.012);
        // Staccato decay — short bursts.
        hornMix.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.55);
      }
      // Tuba on the downbeats only.
      if (beatIdx % 2 === 0) {
        const b = bass[Math.floor(beatIdx / 2) % bass.length];
        tuba.frequency.setValueAtTime(b, t);
        tubaGain.gain.cancelScheduledValues(t);
        tubaGain.gain.setValueAtTime(0.0001, t);
        tubaGain.gain.exponentialRampToValueAtTime(0.32 * breath, t + 0.025);
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
  const SCALE = SCALE_MIXO;

  // Variation pass: 3 tuba walks, 3 lead riffs, 3 counter-horn variants.
  // Rotate every 32 ticks (= 2 bars) so each variant gets two cycles before
  // it swaps out. Lead horn drops 18% of phrases (a brass player breathes
  // when there's nothing to say). Slow ±20% gain breath over 20s.
  const TUBA_VARIANTS = [
    [1.0, 1.0, 1.5, 1.5, 16/9, 16/9, 4/3, 4/3],   // I → V → bVII → IV
    [1.0, 1.0, 4/3, 4/3, 3/2,  3/2,  1.0,  1.0],   // I → IV → V → I
    [1.0, 5/4, 3/2, 5/4, 1.0,  4/3,  3/2,  4/3],   // walking arpeggio
  ];
  const LEAD_VARIANTS = [
    [4, -1, 5, 4, -1, 2, -1, 1,  4,  5, 6, 5, 4, 2, 1, -1],
    [6, -1, 5, -1, 4, -1, 5,  4,  2,  1, -1, 2, 4, -1, 5, -1],
    [1, 2, 4, 5, -1, 6, 5, 4,  -1, 5, 4, 2, 1, -1, -1, -1],
  ];
  const COUNTER_VARIANTS = [
    [-1, -1, 1, -1, -1, 2, -1, -1, -1, -1, 4, -1, 2,  1, -1, -1],
    [-1, -1, -1, 4, -1, -1, 2, -1, -1, -1, -1, 5, -1, -1, 4, -1],
    [-1,  1, -1, -1, 4, -1, -1, 2, -1,  1, -1, -1, 5, -1, -1, 4],
  ];

  const TICKS_PER_ROTATION = 32;
  const REST_PROB_LEAD = 0.08;
  const LFO_PERIOD_S = 20;
  const LFO_DEPTH = 0.20;

  let nextTick = ctx.currentTime + 0.15;
  let tickIdx = 0;
  function schedule() {
    const horizon = ctx.currentTime + 0.6;
    while (nextTick < horizon) {
      const t = nextTick;
      const bt = tickIdx % 16;
      const rot = Math.floor(tickIdx / TICKS_PER_ROTATION);
      const TUBA_RATIOS = TUBA_VARIANTS[rot % TUBA_VARIANTS.length];
      const LEAD = LEAD_VARIANTS[rot % LEAD_VARIANTS.length];
      const COUNTER = COUNTER_VARIANTS[rot % COUNTER_VARIANTS.length];
      const breath = 1 + LFO_DEPTH * Math.sin((t / LFO_PERIOD_S) * 2 * Math.PI);

      // Kick
      if (KICK_TICKS.includes(bt)) {
        kickOsc.frequency.setValueAtTime(105, t);
        kickOsc.frequency.exponentialRampToValueAtTime(45, t + 0.10);
        kickGain.gain.cancelScheduledValues(t);
        kickGain.gain.setValueAtTime(0.0001, t);
        kickGain.gain.exponentialRampToValueAtTime(0.42 * breath, t + 0.005);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      }
      // Snare
      for (const s of SNARE_TICKS) {
        if (s.tick === bt) {
          snareGain.gain.cancelScheduledValues(t);
          snareGain.gain.setValueAtTime(0.0001, t);
          snareGain.gain.exponentialRampToValueAtTime(s.vol * breath, t + 0.002);
          snareGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        }
      }
      // Tuba on every other tick (8th notes)
      if (bt % 2 === 0) {
        const ratio = TUBA_RATIOS[(bt / 2) % TUBA_RATIOS.length];
        tubaOsc.frequency.setValueAtTime(baseFreq * 0.5 * ratio, t);
        tubaGain.gain.cancelScheduledValues(t);
        tubaGain.gain.setValueAtTime(0.0001, t);
        tubaGain.gain.exponentialRampToValueAtTime(0.30 * breath, t + 0.02);
        tubaGain.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.55);
      }
      // Lead horn riff
      const leadIdx = LEAD[bt];
      if (leadIdx >= 0 && Math.random() >= REST_PROB_LEAD) {
        const f = baseFreq * SCALE[leadIdx % SCALE.length];
        leadOsc.frequency.setValueAtTime(f * 1.004, t);
        leadSqr.frequency.setValueAtTime(f * 0.996, t);
        leadMix.gain.cancelScheduledValues(t);
        leadMix.gain.setValueAtTime(0.0001, t);
        leadMix.gain.exponentialRampToValueAtTime(0.18 * breath, t + 0.015);
        leadMix.gain.exponentialRampToValueAtTime(0.0001, t + tick * 2.6);
      }
      // Counter horn (lower)
      const counterIdx = COUNTER[bt];
      if (counterIdx >= 0) {
        const f = baseFreq * 0.5 * SCALE[counterIdx % SCALE.length];
        counterOsc.frequency.setValueAtTime(f, t);
        counterMix.gain.cancelScheduledValues(t);
        counterMix.gain.setValueAtTime(0.0001, t);
        counterMix.gain.exponentialRampToValueAtTime(0.14 * breath, t + 0.02);
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
//
// Variation pass: rotate through 3 tom-pattern pairs every 4 measures, add
// 12% miss chance per tom hit (drummers fluff strokes), and a slow ±20%
// gain breath over 26s. Kick stays metronomic — it's the heartbeat.
function drumStage(ctx, panner, seed) {
  const rng = mulberry32(seed >>> 0);
  const tempo = 70 + Math.floor(rng() * 22);
  const beat = 60 / tempo;
  // Tick = 1/12th of a measure (LCM of 3 and 4).
  const tick = beat / 3;
  const tom1Freq = 150 + Math.floor(rng() * 40);   // higher tom
  const tom2Freq = 88 + Math.floor(rng() * 22);    // lower tom

  // 12-tick patterns. true = hit. Pattern A is the original 3:4 cross-rhythm.
  // B and C are gentle reshuffles so each rotation still grooves but the
  // accents land differently.
  const TOM1_PATTERNS = [
    [true, false, false, false, true, false, false, false, true, false, false, false],
    [true, false, false, true, false, false, true, false, false, false, true, false],
    [false, false, true, false, true, false, false, true, false, true, false, false],
  ];
  const TOM2_PATTERNS = [
    [true, false, false, true, false, false, true, false, false, true, false, false],
    [true, false, true, false, false, true, false, true, false, false, true, false],
    [true, true, false, false, true, false, true, false, true, false, false, true],
  ];
  const TICKS_PER_ROTATION = 48;          // 4 measures
  const MISS_PROB = 0.06;
  const LFO_PERIOD_S = 26;
  const LFO_DEPTH = 0.20;

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
      const rot = Math.floor(tickIdx / TICKS_PER_ROTATION);
      const tom1Pat = TOM1_PATTERNS[rot % TOM1_PATTERNS.length];
      const tom2Pat = TOM2_PATTERNS[rot % TOM2_PATTERNS.length];
      const breath = 1 + LFO_DEPTH * Math.sin((t / LFO_PERIOD_S) * 2 * Math.PI);

      // Kick: 1 and 7 (every half measure). No miss — kick is the heartbeat.
      if (measureTick === 0 || measureTick === 6) {
        kick.frequency.setValueAtTime(95, t);
        kick.frequency.exponentialRampToValueAtTime(45, t + 0.10);
        kickGain.gain.cancelScheduledValues(t);
        kickGain.gain.setValueAtTime(0.0001, t);
        kickGain.gain.exponentialRampToValueAtTime(0.48 * breath, t + 0.005);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      }
      if (tom1Pat[measureTick] && Math.random() >= MISS_PROB) {
        tom1.frequency.setValueAtTime(tom1Freq * 1.2, t);
        tom1.frequency.exponentialRampToValueAtTime(tom1Freq, t + 0.06);
        tom1Gain.gain.cancelScheduledValues(t);
        tom1Gain.gain.setValueAtTime(0.0001, t);
        tom1Gain.gain.exponentialRampToValueAtTime(0.34 * breath, t + 0.005);
        tom1Gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      }
      if (tom2Pat[measureTick] && Math.random() >= MISS_PROB) {
        tom2.frequency.setValueAtTime(tom2Freq * 1.2, t);
        tom2.frequency.exponentialRampToValueAtTime(tom2Freq, t + 0.07);
        tom2Gain.gain.cancelScheduledValues(t);
        tom2Gain.gain.setValueAtTime(0.0001, t);
        tom2Gain.gain.exponentialRampToValueAtTime(0.30 * breath, t + 0.005);
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

// ----- FOREST DRUM CIRCLE (rich Euclidean polyrhythm) ----------------------
//
// Phase 4 — the LEAF-true engine. Built on coprime Euclidean rhythms over
// the same 12-tick LCM that drumStage uses, but with:
//
//   * 7 voices instead of 3: kick + 2 toms + djembe slap + djembe tone +
//     bell + shaker. Each is a different Euclidean pattern, shifted by
//     coprime offsets so the combined groove never lines up the same way
//     across measures.
//   * Voice gating by nightness — kick/toms are always on, the brighter
//     voices fade in as the sun goes down. At full night all 7 are firing.
//   * Probabilistic misses + ghost-note velocity variance + ±5ms timing
//     jitter — what the reviewer pushed back on the original spec for. The
//     human-feel comes from those three together, not from any one of them.
//   * A crackling-fire pink-noise bed gated on nightness > 0.3, panned with
//     the drum mix so it only hisses up close.
//
// Per-circle CPU cost: ~8 oscillators always running + a few transient
// BufferSource allocs per hit. With 3 visible drum circles that's ~24
// oscillators total — well under what Web Audio can chew through.
function forestDrumStage(ctx, panner, seed) {
  const rng = mulberry32(seed >>> 0);
  const tempo = 72 + Math.floor(rng() * 16);     // 72-88 bpm
  const beat = 60 / tempo;
  const measureDur = beat * 4;                   // 4 beats per measure
  const tickDur = measureDur / 12;

  // Lowpass filter — sits between every voice and the spatial panner so the
  // engine can muffle the highs when the player is outside the forest body.
  // Cutoff starts wide open; main.js drives it down via setLowpassCutoff as
  // the player drives away from the fire (reviewer's "woods absorb the
  // sound" idea). Q stays low so we don't ring on the resonance.
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 14000;
  lowpass.Q.value = 0.5;
  lowpass.connect(panner);
  // All internal voice connections point here so they're filtered before
  // reaching the panner. Trigger functions still reference `panner` for
  // their parameter names (kept to minimise diff churn) but pass `dest`.
  const dest = lowpass;

  // Euclidean rhythm: distribute `hits` evenly across `steps` ticks. Returns
  // a length-`steps` boolean array. Optional `shift` rotates the pattern.
  function E(hits, steps, shift = 0) {
    const pattern = new Array(steps).fill(false);
    for (let i = 0; i < hits; i++) pattern[Math.floor((i * steps) / hits)] = true;
    if (!shift) return pattern;
    const out = new Array(steps);
    for (let i = 0; i < steps; i++) out[i] = pattern[((i - shift) % steps + steps) % steps];
    return out;
  }

  // Voice definitions. Order matters — we trigger in this order so kick
  // attacks fire ahead of higher voices when they share a tick.
  //   pattern    : 12-tick rhythm
  //   kind       : timbre generator
  //   baseGain   : peak gain at velocity 1.0
  //   miss       : 0..1 chance to skip any scheduled hit
  //   ghost      : 0..1 chance a hit becomes a ghost note (velocity ≈0.18)
  //   threshold  : nightness below which the voice is silent
  const voices = [
    { name: 'kick', pattern: E(2, 12),    kind: 'kick', baseGain: 0.50, miss: 0,    ghost: 0,    threshold: 0    },
    { name: 'tom1', pattern: E(3, 12),    kind: 'tom1', baseGain: 0.36, miss: 0,    ghost: 0,    threshold: 0    },
    { name: 'tom2', pattern: E(4, 12),    kind: 'tom2', baseGain: 0.30, miss: 0,    ghost: 0,    threshold: 0    },
    { name: 'slap', pattern: E(5, 12, 1), kind: 'slap', baseGain: 0.30, miss: 0.10, ghost: 0.15, threshold: 0.20 },
    { name: 'tone', pattern: E(7, 12, 2), kind: 'tone', baseGain: 0.22, miss: 0.15, ghost: 0.20, threshold: 0.30 },
    { name: 'bell', pattern: E(3, 12, 5), kind: 'bell', baseGain: 0.18, miss: 0.20, ghost: 0.10, threshold: 0.40 },
    { name: 'shak', pattern: E(8, 12),    kind: 'shak', baseGain: 0.14, miss: 0.15, ghost: 0,    threshold: 0.50 },
  ];

  // Tonal voices get a persistent oscillator+gain we re-pluck per hit (cheaper
  // than allocating a new osc each time). Noise voices allocate per-hit since
  // they need fresh buffer data anyway.
  const persistent = {};
  function ensureOsc(name, freq, type = 'sine') {
    if (persistent[name]) return persistent[name];
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(dest);
    osc.start();
    persistent[name] = { osc, gain };
    return persistent[name];
  }
  ensureOsc('kick', 95);
  ensureOsc('tom1', 150 + Math.floor(rng() * 40));
  ensureOsc('tom2', 88 + Math.floor(rng() * 22));
  ensureOsc('tone', 200 + Math.floor(rng() * 30));

  function triggerKick(t, vel, p) {
    p.osc.frequency.setValueAtTime(95, t);
    p.osc.frequency.exponentialRampToValueAtTime(45, t + 0.10);
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(0.0001, t);
    p.gain.gain.exponentialRampToValueAtTime(vel, t + 0.005);
    p.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
  }
  function triggerSineHit(t, vel, p, peakFreq, restFreq, sweepDur, decayDur) {
    p.osc.frequency.setValueAtTime(peakFreq, t);
    p.osc.frequency.exponentialRampToValueAtTime(restFreq, t + sweepDur);
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(0.0001, t);
    p.gain.gain.exponentialRampToValueAtTime(vel, t + 0.005);
    p.gain.gain.exponentialRampToValueAtTime(0.0001, t + decayDur);
  }
  function triggerNoise(t, vel, freq, qish, dur, type = 'highpass') {
    const bufSize = Math.max(64, Math.ceil(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    if (qish != null) filter.Q.value = qish;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vel, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
  function triggerTri(t, vel, freq, dur) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vel * 0.45, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Scheduler with lookahead. Per-tick we walk every voice and decide whether
  // it fires. Nightness is read fresh each tick from the module-level
  // currentNightness so daytime→night transitions are reflected in real time.
  let nextTickTime = ctx.currentTime + 0.2;
  let tickIdx = 0;
  function schedule() {
    const horizon = ctx.currentTime + 0.6;
    while (nextTickTime < horizon) {
      const ti = tickIdx % 12;
      const n = currentNightness;
      for (let v = 0; v < voices.length; v++) {
        const voice = voices[v];
        if (!voice.pattern[ti]) continue;
        if (n < voice.threshold) continue;
        if (voice.miss > 0 && Math.random() < voice.miss) continue;
        // Velocity — ghost note vs accent. baseVel ranges 0.55..1.0.
        const baseVel = (Math.random() < voice.ghost) ? 0.18 : (0.55 + Math.random() * 0.45);
        // Gate gain — voice fades in over a 0.15 nightness window starting at threshold.
        const gateN = Math.max(0, Math.min(1, (n - voice.threshold) / 0.15));
        // Overall mix gain rises slightly with nightness so the whole thing
        // is more present at night.
        const overall = 0.45 + 0.55 * n;
        const gain = voice.baseGain * gateN * baseVel * overall;
        // Guard against effectively-silent triggers — exponentialRampToValueAtTime
        // rejects targets exactly at zero, and even very tiny values waste an
        // oscillator pulse for no audible result.
        if (gain < 0.001) continue;
        // Timing jitter ±5ms — humanises the groove.
        const t = nextTickTime + (Math.random() - 0.5) * 0.010;
        switch (voice.kind) {
          case 'kick': triggerKick(t, gain, persistent.kick); break;
          case 'tom1': triggerSineHit(t, gain, persistent.tom1, persistent.tom1.osc.frequency.value * 1.2, 150, 0.06, 0.16); break;
          case 'tom2': triggerSineHit(t, gain, persistent.tom2, persistent.tom2.osc.frequency.value * 1.2, 90, 0.07, 0.18); break;
          case 'tone': triggerSineHit(t, gain, persistent.tone, 230, 200, 0.05, 0.13); break;
          case 'slap': triggerNoise(t, gain, 2400, null, 0.07, 'highpass'); break;
          case 'bell': triggerTri(t, gain, 600 + (rng() * 80), 0.18); break;
          case 'shak': triggerNoise(t, gain * 0.6, 5200, null, 0.04, 'highpass'); break;
        }
      }
      nextTickTime += tickDur;
      tickIdx++;
    }
  }
  schedule();
  const intervalId = setInterval(schedule, 180);

  // ---- Crackling fire ----
  // Pink-noise bursts every 0.4-1.2s, gated on nightness > 0.3. Quiet — the
  // fire is supposed to be in the background, not competing with the drums.
  // Each burst is a short bandpassed noise blip at a random centre frequency
  // so successive cracks sound different (crackle, pop, hiss).
  let nextCrackleTime = ctx.currentTime + 0.8;
  function crackleSchedule() {
    const n = currentNightness;
    if (n < 0.3) {
      // Push forward so we don't try to catch up when night arrives.
      nextCrackleTime = ctx.currentTime + 0.4;
      return;
    }
    while (nextCrackleTime < ctx.currentTime + 0.6) {
      const dur = 0.04 + Math.random() * 0.08;
      const vel = (0.08 + (n - 0.3) * 0.10) * (0.6 + Math.random() * 0.4);
      triggerNoise(
        nextCrackleTime, vel,
        600 + Math.random() * 1400,
        1.5, dur, 'bandpass',
      );
      nextCrackleTime += 0.4 + Math.random() * 0.8;
    }
  }
  const crackleId = setInterval(crackleSchedule, 220);

  return {
    panner,
    // Move the lowpass cutoff exponentially to the target so changes never
    // pop. `freq` should be in Hz; we expect a range of ~2500..14000.
    setLowpassCutoff(freq) {
      const clamped = Math.max(120, Math.min(20000, freq));
      lowpass.frequency.setTargetAtTime(clamped, ctx.currentTime, 0.20);
    },
    stop() {
      clearInterval(intervalId);
      clearInterval(crackleId);
      for (const key in persistent) {
        try { persistent[key].osc.stop(); } catch (e) {}
      }
      try { lowpass.disconnect(); } catch (e) {}
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
  // Forest collisions: forest_tree = a louder woody thud (you ran into an
  // 8-metre oak). Firepit = thumpy stone wall. Bench = soft wood bonk.
  forest_tree: (c, d) => { thump(c, d, 65, 0.45, 0.55); woodKnock(c, d); },
  firepit:     (c, d) => { thump(c, d, 50, 0.5, 0.55); thump(c, d, 75, 0.3, 0.4); },
  bench_ring:  (c, d) => woodKnock(c, d),
  default:     (c, d) => thump(c, d, 180, 0.2, 0.3),
};
