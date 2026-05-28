# Roadmap

What's queued up next, plus a parking lot of "we talked about it, haven't done it yet." Items move to [CHANGELOG.md](CHANGELOG.md) when they ship.

---

## Music

### Section system *(medium effort, biggest payoff)*

Each music generator gets named sections — `intro / groove / build / break / outro` — each with its own pattern bank and tempo. A meta-scheduler picks the next section probabilistically, with musical transitions: a snare fill into a new section, a tempo ramp into a breakdown. Voices come in and out (just kick for a bar, then horns enter). Different sources can be in different sections at the same time — no global lockstep.

This is the "real" answer to "less repetitive" — the cheap-wins variation pass (multiple variants, rest probability, gain LFO) addresses surface-level repetition, but doesn't give the music a sense of arc.

### Real songform *(big effort, smaller marginal payoff)*

Markov/motif-based phrase generation so the melody actually develops instead of looping. Per-source "songs" — 2–3 minute arcs with intro → verse → chorus → bridge → outro, then a new song picked from the bank. Key changes between songs.

### Smaller music polish

- **Dynamics-aware breath** — couple the rest-probability to the LFO so quiet phases drop more notes and loud phases pack in more accents.
- **Tempo wobble** — slow drift (±3 BPM over 32 bars) so the groove isn't perfectly metronomic. Tricky because `beat` is captured in envelope math; a clean implementation requires factoring tempo into a function.
- **Shuffled variant order** — currently rotates 0→1→2→0→1→2. Picking the next variant from a weighted shuffle (avoiding immediate repeats) would feel less mechanical.
- **Stage-music presets that drift** — even within a single source, the lead can occasionally swap timbre (triangle → sine → square) at section boundaries.

### MIDI player follow-ups

The MIDI player (M key) ships with a single shared PolySynth(FMSynth) for all tracks of a parsed MIDI. Worth exploring:

- **Per-channel instruments.** Map MIDI channels to distinct synths (or `Tone.Sampler` with a soundfont) so drums sound like drums and a bass sounds like a bass instead of all-FMSynth-everything. Drives the timbre toward "playable instrument" instead of "synth interpretation."
- **General MIDI program map.** Honor program-change messages in the MIDI file — e.g. program 0 = acoustic grand → sampler, program 32 = acoustic bass → bass synth, channel 10 = drums → drum kit sampler. Big jump in playback fidelity for arranged MIDIs.
- **Per-track muting in the debug overlay.** Toggle individual MIDI tracks on/off for live remixing during a trip.
- **Pre-render reverb impulse for blast-mode swell.** `Tone.Reverb.decay` is fixed at construction; swelling decay during a trip currently leans on wet ramp. A second `Reverb` with a long decay routed in parallel would let us crossfade for a true "cathedral opens" effect.
- **Granular synthesis chain for peak moments.** At the climax, route the synth through a granular/glitch effect (Tone has nothing native — would need a custom `AudioWorklet`) for that "reality fracturing" feel. Significant scope — punt unless someone wants to chase the high.

---

## Trip / wook

- **Accept methods we considered but didn't ship.** Currently tap-to-toast or press [Y]. Other options on the table:
  - **Tap-the-wook** — raycast a tap on the canvas; if it hits a wook (or its proximity zone) during `awaiting_confirm`, accept. More diegetic.
  - **Dedicated ACCEPT button** — fourth touch button that appears only during `awaiting_confirm`. Most discoverable but adds permanent UI for a rare interaction.
- **Trip narration polish.** The TRIP_NARRATIVE_TEXTS array in `main.js` could rotate by trip-elapsed-time so early-trip text differs from late-trip text. Right now it's uniform random.

---

## Audio polish

- **`Sound.setVolume(0)` proper-mute API.** The localStorage clamp (≥0.05) is a safety net against an accidentally-dragged slider; a real "fully mute" path should bypass the clamp so intentional muting works.
- **Output-routing detection.** If iOS sound is still broken after the v2 unlock, log whether the audio is routed to a ghost Bluetooth device. Surface in `Sound.diagnostics()`.
- **`?sounddebug=1` discoverability.** The mobile audio debug toast only shows when the URL param is set. Consider gating it on a debug build flag rather than a query string, so it never accidentally appears in production.

---

## Docs

- **"LEAF-style drum circle" comment in ARCHITECTURE.md.** Still mentions LEAF as an internal label even though the README is now generic-festival. Decide: scrub from architecture too, or keep as internal context for code-reading colleagues.
- **Multiple sizes of `assets/zerble.png`.** Currently a single PNG. A higher-res original would scale down cleaner on Retina displays — the README `<img>` is set to `width="420"` but devices pull the full resolution.

---

## Touch / UX

- **Touch overlay during title card.** Currently hidden behind the title's `backdrop-filter`. After Start, the overlay reveals — that's fine, but a brief "tap-and-go" hint after Start might help new touch players find the thumbstick.

---

## World

- **Real lake reflections via `Reflector`.** An earlier procedural "twinkly stars" shader patch on the water surface looked like fake sparkles fading in/out — not reflection physics. Removed in favor of plain water for now. A proper Reflector (`three/examples/jsm/objects/Reflector`) would render the scene from the mirrored camera into a texture and sample it from the water surface — actual mirror of sky + stars + moon + nearby objects. Cost is roughly a second scene render whenever the player can see a lake; would gate to high tier only, and possibly half-res target + nightness-driven wet/dry mix so it only matters when reflections matter.

## Performance

- **Crowd InstancedMesh churn.** When NPCs change state, their per-instance matrix flag has to flip. Worth profiling on low-end devices to see if writes per frame are an issue.
- **Forest tree count on low tier.** PERF tier currently scales chunk draw radius and crowd density but not forest tree density. Dense forests on mid-spec phones might benefit from a tier-gated thin-out.
- **LOD on distant trees / tents.** Beyond ~60m the polygon detail is invisible; could swap to billboard or low-poly replacements.
- **Geometry merging at chunk completion.** Once a chunk's content stops changing, `BufferGeometryUtils.mergeGeometries` could collapse it into a single mesh per material — massive draw-call reduction.
- **Material pooling in older models.** `puppet.js`, `foodTruck.js`, `tent.js` still allocate 5–15 fresh `MeshStandardMaterial`s per build. The Sugar Shack now uses a single `SHACK_MATS` module-level cache; that pattern could be backported.
- **Variant-bucketed InstancedMesh for tiki torches.** Each torch is currently 5 separate meshes (pole + 2 joints + cup + flame). With 2–3 variant buckets we could collapse the static parts into ~3 InstancedMesh per campsite while keeping per-flame animation independent.
- **Variant-bucketed InstancedMesh for camp chairs.** 8 meshes per chair × multiple chairs per campsite. Use `setColorAt()` for the fabric color variation; instance legs/seat/back/arms across all chairs in a campsite.
- **Antialias off + FXAA pass on mid/low tiers.** MSAA + pixel ratio 2 on integrated GPUs is brutal; FXAA's screen-space approach is way cheaper.
- **Texture mipmap audit.** Confirm `generateMipmaps = true` on the larger canvas textures so distant draws sample cheap LOD levels.
- **Light layers for the Sugar Shack work spots.** Currently every standard material in range pays the per-fragment SpotLight cost. Putting the lights on a layer that only the banner is on would cut that to ~3 affected meshes.

---

## Out of scope (worth flagging)

- **Bundler.** Tempting but adds a build step, breaks the "open index.html and it just works" property. Stay no-build until performance forces the issue.
- **Sample-based audio (mp3/wav).** Adding recorded audio means an asset pipeline and a CDN story. Synthesized stays the constraint for game SFX + stage music. MIDI playback uses Tone.js synthesis — no samples shipped.
