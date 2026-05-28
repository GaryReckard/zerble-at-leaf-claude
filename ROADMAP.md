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

- **Crickets at night.** Quiet sin-based chirps gated on `nightness > 0.5`, panned wide. Each chirp is a short envelope on a 4-5kHz sin pair with a small detune — same synthesis pattern the fire-crackle bed already uses. Cheap. Fills the night ambience gap.
- **Music cross-fade between stages.** Currently when Zerble enters a new stage's audible range, the spatial music handle abruptly swaps — feels like changing radio stations. Cross-fade the two PannerNodes' gains over ~1.5s so the new stage's music swells in as the old one fades. Already have per-stage `attachStageMusic` handles.
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

## Gameplay verbs

- **Bubble varieties — earnable and mix-and-match.** Bubbles are Zerble's signature; unlocking new TYPES is the most direct way to amplify the core verb. Each new type is gated on a different in-game achievement, persists in `localStorage`, and shows up in a small **multi-select** UI strip (tap/click an icon to toggle it on or off). The bubble spawner picks randomly from whatever set is currently enabled — so a player who's unlocked everything can run a chaotic mix of hearts + stars + rainbows + glow + the occasional mega. Default starting set: standard only. Six variants to ship:
  - **Standard** — the base bubble. Always on, always unlocked.
  - **Heart bubbles** — unlock by catching up to Lurleen at least once. NPCs in a "love" state (currently nascent — would need a small new affect type) give double smiles; everyone else reacts normally.
  - **Star bubbles** — unlock by surviving a full wook trip (sustaining → fade-out completes). Float higher, last ~50% longer.
  - **Smile-faced bubbles** — unlock at 100 lifetime smiles. NPCs smile back automatically when hit, regardless of bubble proximity.
  - **Rainbow bubbles** — unlock with a smile combo of 30 (or whatever combo-threshold ships per the "smile combos + multiplier" idea). Pop spawns a small confetti burst + bonus smile.
  - **Glow bubbles** — unlock at full nightness during a session (or via festival pin set later). Visible from far away at night, emissive material that ramps with `nightness`.
  - **Mega-bubble** — unlock via a hidden world pickup. Rare emit (one per ~10s when enabled), 3-4× the size, pops with crowd-wide reaction (everyone within ~15m smiles + claps).
  
  Implementation sketch: extend `Bubbles` (`bubbles.js`) with a per-instance `bubbleType` attribute on the existing `InstancedMesh`. The `onBeforeCompile` shader patch reads the type to pick color/emissive/opacity. Pop behavior diverges in `_popBubble` via a small switch on type. The selector UI is a DOM strip (~6 icons) anchored to the HUD; clicking toggles a bit in a `bubbleTypesEnabled` set. `Bubbles._pickType()` does a uniform random draw from the enabled set at emit time. `localStorage` keeps `{ unlocked: ['standard', 'heart', ...], enabled: ['standard', 'rainbow'] }`.
  
  Cost: ~zero perf impact (same instance count, same draw call, one more per-instance attribute). Mostly feature work in `bubbles.js`, a new tiny DOM panel, and the per-unlock trigger plumbing across `Lurleen`, `Trip`, `Analytics.smileScore`, etc.

- **Tricks via boost + hop key.** Tap Space+Shift (or a dedicated key) mid-drive for a small 0.3s hop. Air time + bubbles in-air = bonus smiles when you land near NPCs (NPC reaction: "oooh!"). Reuses Zerble's existing arcade physics — just adds a vertical impulse and a "in-air" flag. New verb, no geometry.
- **Passenger requests.** Sometimes a boarding rider has a small icon over their head (a tent? a stage? a food truck?). Drop them within X meters of that POI = big smile bonus + maybe a token currency. Uses the existing boarding flow + the registry's POI kinds (`stage_front`, `food_truck`, `tent`, etc.).
- **Vendor stand power-ups.** Extend `vendor_row` chunk themes with rare lemonade / pretzel / glow-stick stands. Drive by, get a 10s buff: faster bubble output, brighter eye glow, louder honk. Tiny new builders that reuse `foodTruck.js` patterns; existing food-truck attractor logic carries the trigger.

---

## World

- **Bubble inhabitants.** Once in a while a bubble drifts past with a tiny waving figure inside it (silhouette billboard, ~0.1m). Rare enough to read as an Easter egg. One mesh, low spawn rate, despawn with parent bubble.
- **Birds overhead.** Small triangular birds in instanced flocks circling the festival, occasionally dipping low past Zerble. Single `InstancedMesh`, one update loop, ~60 instances global. Big vibe lift for almost nothing.
- **Fireworks at midnight.** Cheap instanced point sprites + emissive ramp, gated on `nightness > 0.85`. Triggers ~once per minute. Almost every NPC stops and looks up to take notice — same "watching" state crowd already supports, just biased to face up. Hooker for the day/night cycle's climax.
- **Crowd photographer.** A specific NPC type with a camera who occasionally crouches and "takes a photo" of Zerble (small flash sprite). Pure animation + a brief emissive pop. Builds the festival-vibe story.
- **Real lake reflections via `Reflector`.** An earlier procedural "twinkly stars" shader patch on the water surface looked like fake sparkles fading in/out — not reflection physics. Removed in favor of plain water for now. A proper Reflector (`three/examples/jsm/objects/Reflector`) would render the scene from the mirrored camera into a texture and sample it from the water surface — actual mirror of sky + stars + moon + nearby objects. Cost is roughly a second scene render whenever the player can see a lake; would gate to high tier only, and possibly half-res target + nightness-driven wet/dry mix so it only matters when reflections matter.

---

## HUD / juice

- **Smile counter pulse + color shift** when score increments. Pure CSS animation on `#smiles .value` — scale bump + brief warm-tone color flash, then ease back.
- **Personal-best confetti.** When BEST gets beaten, a brief DOM confetti shower over the score panel. Pure HTML/CSS — no three.js cost. One-time trigger per session.
- **Boost streaks.** Visible trail behind Zerble at high speed — short fading emissive ring instances, ~8 in a pool, spawned at the rear during boost and fading over ~0.4s. Reads as motion without changing collision or perf budget.
- **Day/night HUD indicator.** Tiny sun/moon icon in the corner arcing across a strip showing time of day. Pure DOM/SVG, syncs to `getTimeOfDay().t`. Tells the player when the trippy night content (drum circles, stage lights, fireworks once shipped) is coming.

## Performance

- **Crowd InstancedMesh churn.** When NPCs change state, their per-instance matrix flag has to flip. Worth profiling on low-end devices to see if writes per frame are an issue.
- **Forest tree count on low tier.** PERF tier currently scales chunk draw radius and crowd density but not forest tree density. Dense forests on mid-spec phones might benefit from a tier-gated thin-out.
- **LOD on distant trees / tents.** Beyond ~60m the polygon detail is invisible; could swap to billboard or low-poly replacements.
- **Geometry merging at chunk completion.** Once a chunk's content stops changing, `BufferGeometryUtils.mergeGeometries` could collapse it into a single mesh per material — massive draw-call reduction.
- **Material pooling in older models.** `puppet.js` and `foodTruck.js` still allocate 5–15 fresh `MeshStandardMaterial`s per build. The Sugar Shack now uses a single `SHACK_MATS` module-level cache and `tent.js` was pooled in the vendor-layout pass; that pattern could be backported to the remaining two.
- **Variant-bucketed InstancedMesh for tiki torches.** Each torch is currently 5 separate meshes (pole + 2 joints + cup + flame). With 2–3 variant buckets we could collapse the static parts into ~3 InstancedMesh per campsite while keeping per-flame animation independent.
- **Variant-bucketed InstancedMesh for camp chairs.** 8 meshes per chair × multiple chairs per campsite. Use `setColorAt()` for the fabric color variation; instance legs/seat/back/arms across all chairs in a campsite.
- **Antialias off + FXAA pass on mid/low tiers.** MSAA + pixel ratio 2 on integrated GPUs is brutal; FXAA's screen-space approach is way cheaper.
- **Texture mipmap audit.** Confirm `generateMipmaps = true` on the larger canvas textures so distant draws sample cheap LOD levels.
- **Light layers for the Sugar Shack work spots.** Currently every standard material in range pays the per-fragment SpotLight cost. Putting the lights on a layer that only the banner is on would cut that to ~3 affected meshes.

---

## Out of scope (worth flagging)

- **Bundler.** Tempting but adds a build step, breaks the "open index.html and it just works" property. Stay no-build until performance forces the issue.
- **Sample-based audio (mp3/wav).** Adding recorded audio means an asset pipeline and a CDN story. Synthesized stays the constraint for game SFX + stage music. MIDI playback uses Tone.js synthesis — no samples shipped.
