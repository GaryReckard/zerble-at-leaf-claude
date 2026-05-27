// MIDI playback module. Tone.js + @tonejs/midi are loaded lazily from a CDN
// on the first M press so they don't bloat startup (combined ~250KB gzip).
// Reads assets/music/manifest.json to pick a random track; if no manifest
// or it's empty, falls back to a small procedural test loop so the M key
// always produces *something* audible.
//
// Trip integration: the master effect chain's wet/depth params are driven
// each frame by Trip._envelope (0..1), so MIDI playback warps into a
// psychedelic soup as the trip ramps up — pitch wobble, deepening vibrato,
// swelling reverb, ping-pong delay runaway, tempo drift.
//
// Architecture:
//   Synth (PolySynth/FMSynth) → Vibrato → AutoFilter → PingPongDelay →
//     Reverb → Destination
//   LFO on the synth's `detune` provides cheap continuous pitch drift
//   without paying for a PitchShift node.

import { Sound } from './sound.js';

const TONE_CDN = 'https://esm.sh/tone@14.7.77';
const MIDI_CDN = 'https://esm.sh/@tonejs/midi@2.0.28';
// In-world stage music ducks to this level while the foreground MIDI is
// playing. 0.18 = ~80% attenuation; still audible far from a stage so the
// festival doesn't go totally silent, but the MIDI clearly dominates.
const DUCK_LEVEL = 0.18;

export class MidiPlayer {
  constructor() {
    this.Tone = null;
    this.Midi = null;
    this.synth = null;
    this.effects = null;
    this.parts = [];                 // Tone.Part / Tone.Sequence — disposed on stop
    this.manifest = null;
    this.isPlaying = false;
    this.currentTrack = null;
    this._loadingPromise = null;     // shared promise so concurrent toggles don't double-load
    this._tripEnvelope = 0;
    this._baseBpm = 120;
  }

  // First call lazy-loads Tone.js + @tonejs/midi + the manifest. Subsequent
  // calls resolve immediately. Returns true on success, false on failure.
  async _ensureLoaded() {
    if (this.Tone && this.Midi) return true;
    if (this._loadingPromise) return this._loadingPromise;
    this._loadingPromise = (async () => {
      try {
        const [tone, midiMod] = await Promise.all([
          import(/* @vite-ignore */ TONE_CDN),
          import(/* @vite-ignore */ MIDI_CDN),
        ]);
        this.Tone = tone;
        this.Midi = midiMod.Midi;
        // Tone.start() is REQUIRED on a user gesture (first M press) —
        // browsers suspend the AudioContext until user interaction.
        await this.Tone.start();
        this._buildEffectChain();
        this._buildSynth();
        // Best-effort manifest load. No file == empty manifest, procedural
        // fallback kicks in. Don't noisy-warn on 404.
        try {
          const res = await fetch('assets/music/manifest.json', { cache: 'no-store' });
          if (res.ok) this.manifest = await res.json();
        } catch (e) {
          this.manifest = null;
        }
        return true;
      } catch (e) {
        console.warn('[midi] failed to load Tone.js / @tonejs/midi', e);
        return false;
      }
    })();
    return this._loadingPromise;
  }

  // Build the master effect chain. Order is signal-flow: synth → effects →
  // Destination. All effects ship with subtle defaults so playback is clean
  // until setTripEnvelope() ramps them up.
  _buildEffectChain() {
    const T = this.Tone;

    // Vibrato — pitch modulation. Subtle by default; goes "drunk theremin"
    // at peak trip.
    const vibrato = new T.Vibrato({ frequency: 5, depth: 0.04 });

    // AutoFilter — LFO-driven low-pass that pulses the timbre open and
    // shut. Wet=0 at idle (no audible effect); ramped in during trip for
    // the breathing-filter feel.
    const filter = new T.AutoFilter({
      frequency: 0.3, depth: 0.5, baseFrequency: 1200, octaves: 2.5, wet: 0,
    }).start();

    // PingPongDelay — stereo bouncing echo. Subtle by default; feedback
    // ramps toward runaway during trip so single notes cascade into clouds.
    const delay = new T.PingPongDelay({
      delayTime: '8n', feedback: 0.22, wet: 0.10,
    });

    // Reverb — short hall by default; wet swells massively during trip so
    // notes hang and overlap into chord-clouds. Tone.Reverb.decay is fixed
    // at construction, so we lean on the wet ramp to convey "more reverb".
    const reverb = new T.Reverb({ decay: 4.5, wet: 0.18 });

    vibrato.chain(filter, delay, reverb, T.Destination);

    this.effects = { vibrato, filter, delay, reverb };
    this._inputNode = vibrato;       // synth.connect(this._inputNode)
  }

  _buildSynth() {
    const T = this.Tone;
    // PolySynth wrapping FMSynth — bright, festival-y timbre that stays
    // distinct under heavy effect warping. Could be expanded later to a
    // per-channel sampler (different instruments per MIDI track) but FMSynth
    // covers a lot of ground for one allocation.
    // 256 voices to cover dense full-band MIDIs (drums + bass + chords +
    // lead + pad all sustaining at once). 32 → 128 wasn't enough; real pop
    // arrangements layer up fast. The shorter release (0.4s vs 1.0s) also
    // frees voices back to the pool quicker so the cap is reached less.
    this.synth = new T.PolySynth(T.FMSynth, {
      volume: -8,
      maxPolyphony: 256,
      envelope: { attack: 0.02, decay: 0.12, sustain: 0.5, release: 0.4 },
    });
    this.synth.connect(this._inputNode);
  }

  // M key entry point. Toggles playback. `hud` is the HUD module (for toast).
  async toggle(hud) {
    if (this.isPlaying) {
      this.stop();
      Sound.setMusicDuck(1.0);          // restore in-world stage music
      if (hud) hud.toast('Music off', 1200);
      return;
    }
    // First press: show a quick "loading…" toast since CDN fetch can take
    // 200-800ms on a cold cache.
    const firstLoad = !this.Tone;
    if (firstLoad && hud) hud.toast('Loading music engine…', 1500);
    const ok = await this._ensureLoaded();
    if (!ok) {
      if (hud) hud.toast('Music load failed', 1800);
      return;
    }
    Sound.setMusicDuck(DUCK_LEVEL);     // duck in-world stage music
    await this._playRandom(hud);
  }

  async _playRandom(hud) {
    const tracks = this.manifest && this.manifest.tracks ? this.manifest.tracks : [];
    if (tracks.length === 0) {
      // No manifest / empty manifest — procedural fallback so the M key
      // always produces something. User drops MIDIs in assets/music/ and
      // lists them in manifest.json to replace this.
      this._playProceduralLoop();
      this.isPlaying = true;
      this.currentTrack = '(test loop)';
      if (hud) hud.toast('♪ Test loop — add MIDIs to assets/music/', 2800);
      return;
    }
    const pick = tracks[Math.floor(Math.random() * tracks.length)];
    // Manifest entries can be either a bare filename string OR an object
    // like { file: 'x.mid', name: 'Song Title' }. Normalize both forms.
    const file = (typeof pick === 'string') ? pick : pick.file;
    const trackUrl = `assets/music/${file}`;
    const trackName = (typeof pick === 'string')
      ? file.replace(/\.[^.]+$/, '')              // strip extension for display
      : (pick.name || pick.file);
    try {
      const buf = await fetch(trackUrl).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      const midi = new this.Midi(buf);
      this._schedule(midi);
      this.isPlaying = true;
      this.currentTrack = trackName;
      if (hud) hud.toast(`♪ ${trackName}`, 2200);
    } catch (e) {
      console.warn('[midi] failed to load', trackUrl, e);
      if (hud) hud.toast(`Could not load ${trackName}`, 1800);
      // Failed to start — restore in-world music so the duck doesn't linger.
      Sound.setMusicDuck(1.0);
    }
  }

  // Wire MIDI notes from the parsed file into Tone.Transport-scheduled parts.
  // Each MIDI track becomes a Tone.Part that loops on the whole-MIDI duration
  // so playback continues until the user presses M again.
  _schedule(midi) {
    const T = this.Tone;
    T.Transport.stop();
    T.Transport.cancel();
    T.Transport.position = 0;
    const tempo = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
    this._baseBpm = tempo;
    T.Transport.bpm.value = tempo;

    this.parts = [];
    for (const track of midi.tracks) {
      const events = track.notes.map(n => ({
        time: n.time,
        name: n.name,
        duration: n.duration,
        velocity: n.velocity,
      }));
      if (events.length === 0) continue;
      const part = new T.Part((time, ev) => {
        this.synth.triggerAttackRelease(ev.name, ev.duration, time, ev.velocity);
      }, events);
      part.loop = true;
      part.loopEnd = midi.duration;
      part.start(0);
      this.parts.push(part);
    }
    T.Transport.start('+0.05');
  }

  // Tiny festive arpeggio so the M key does *something* before the user
  // adds their own MIDIs.
  _playProceduralLoop() {
    const T = this.Tone;
    T.Transport.stop();
    T.Transport.cancel();
    this._baseBpm = 120;
    T.Transport.bpm.value = 120;
    const seq = new T.Sequence((time, note) => {
      this.synth.triggerAttackRelease(note, '8n', time, 0.7);
    }, ['C4', 'E4', 'G4', 'B4', 'C5', 'B4', 'G4', 'E4'], '8n');
    seq.loop = true;
    seq.start(0);
    this.parts = [seq];
    T.Transport.start('+0.05');
  }

  stop() {
    if (!this.Tone) return;
    this.Tone.Transport.stop();
    this.Tone.Transport.cancel();
    for (const p of this.parts) {
      try { p.dispose(); } catch (e) { /* ignore */ }
    }
    this.parts = [];
    if (this.synth) this.synth.releaseAll();
    this.isPlaying = false;
    this.currentTrack = null;
  }

  // Called every frame from main.js with the trip's master envelope
  // (0..1, fade-in/sustain/fade-out gate) AND its progress (0..1, position
  // across the full trip including fades). Mirrors how Trip._writeDynamicCurves
  // shapes the visuals: each audio effect has its OWN personality curve
  // over `progress`, and the whole thing is gated by `envelope` so it
  // ramps in and out cleanly alongside the visual fades.
  //
  // The peak moment is engineered at progress ≈ 1/3, matching the visual
  // posterize spike — that's where vibrato is widest, tempo bottoms out,
  // delay feedback is most aggressive, and a Gaussian bell on top of
  // everything makes the climax clearly audible.
  setTripState(envelope, progress) {
    if (!this.effects) return;
    this._tripEnvelope = envelope;
    const e = this.effects;
    const env = envelope;
    const p = progress;

    // Per-effect curves over `p` — these define each effect's "personality"
    // across the trip, independent of the master envelope gate. Each curve
    // returns 0..1 and is then mapped to its effect's parameter range.
    //
    // peakBell: Gaussian centered at p=1/3 — same "peak moment" as the
    //   visual posterize spike. Width ~0.18 = climax spans ~36s of a 180s
    //   trip. Several effects layer this on top of their baseline to
    //   crescendo at the same moment.
    const peakBell = env > 0
      ? Math.exp(-Math.pow((p - 1 / 3) / 0.18, 2))
      : 0;

    // 1. Vibrato — pitch wobble. Baseline ramps from subtle (0.04) to
    //    moderate (0.30) across the trip, PLUS the bell adds another 0.25
    //    at peak. Frequency slows monotonically toward peak (faster
    //    shimmer at edges, slow seasick wow at climax).
    const vibBase = 0.04 + p * 0.26;
    const vibDepth = vibBase + peakBell * 0.25;
    e.vibrato.depth.rampTo(env * vibDepth + (1 - env) * 0.04, 0.1);
    const vibFreq = 5 - p * 4 + peakBell * (-0.5);
    e.vibrato.frequency.rampTo(env * vibFreq + (1 - env) * 5, 0.1);

    // 2. Reverb wet — sigmoid up to ~0.55 by p=0.5, holds, gentle taper
    //    after p=0.85. Cathedral opens and stays open through the meat of
    //    the trip. Bell adds another 0.15 to swell the climax further.
    const revRamp = this._smoothstep(p, 0.0, 0.5) - this._smoothstep(p, 0.85, 1.0) * 0.4;
    const revWet = 0.18 + env * (revRamp * 0.45 + peakBell * 0.15);
    e.reverb.wet.rampTo(revWet, 0.2);

    // 3. Delay feedback — sum-of-sines oscillation (like the visual
    //    vignettePulse) so echo clouds wax and wane through the trip.
    //    Baseline range 0.30..0.55; peak bell pushes it to ~0.78 (the
    //    runaway zone) at climax.
    const fbOsc =
      0.4
      + 0.20 * Math.sin(p * Math.PI * 2 * 1.5 + 0.8)
      + 0.10 * Math.sin(p * Math.PI * 2 * 3.1 + 1.7);
    const fb = 0.22 + env * (fbOsc * 0.35 + peakBell * 0.20);
    e.delay.feedback.rampTo(Math.min(0.85, fb), 0.15);
    const delayWet = 0.10 + env * (0.25 + peakBell * 0.35);
    e.delay.wet.rampTo(delayWet, 0.15);

    // 4. AutoFilter wet — smooth pseudo-random sum-of-sines (mirrors the
    //    visual brightness pulse). Ramps in over the first quarter, breathes
    //    through middle half, ramps out over last quarter.
    const filterShape =
      0.5
      + 0.30 * Math.sin(p * Math.PI * 2 * 1.7 + 2.4)
      + 0.20 * Math.sin(p * Math.PI * 2 * 2.5 + 3.1);
    let filterGate;
    if (p < 0.25)      filterGate = this._easeInOut(p * 4);
    else if (p > 0.75) filterGate = this._easeInOut((1 - p) * 4);
    else               filterGate = 1.0;
    e.filter.wet.rampTo(env * filterGate * Math.max(0, Math.min(1, filterShape * 0.85)), 0.2);

    // 5. Tempo — bottoms out at the climax (slowest), recovers toward
    //    fadeOut. The world stops at the peak. Base curve dips to -18% at
    //    p=1/3 via the same Gaussian bell.
    if (this.Tone && this.Tone.Transport && this._baseBpm > 0) {
      const tempoDrop = env * peakBell * 0.18 + env * p * 0.05;
      this.Tone.Transport.bpm.rampTo(this._baseBpm * (1 - tempoDrop), 0.5);
    }
  }

  // Cubic smoothstep — same shape as Trip._smoothstep but inlined here.
  _smoothstep(x, a, b) {
    if (b <= a) return x >= b ? 1 : 0;
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // Cubic ease-in-out 0..1
  _easeInOut(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}
