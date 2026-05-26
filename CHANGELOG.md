# Changelog

All notable changes to Zerble at the Festival. Newest at top. Following [Keep a Changelog](https://keepachangelog.com); the project isn't versioned yet, so entries are grouped by date.

## [Unreleased]

### Added
- **Sugar Shack vendor** modeled on Tom's Sugar Shack at LEAF. A 4×8m white gable tent with a separate signage facade in front: beige header banner ("Festival Famous / the SUGAR SHACK / Breakfast All Day + Night"), one long wooden menu plank below it with FRENCH TOAST / VEGGIE THING / VERMONT MAPLE TREATS / HOT & COLD DRINKS, white DRINKS price list on the left, white FOOD price list on the right, pink THANK YOU banner across the counter. Two triangular-frame wooden brackets (two poles meeting at an apex) project forward from the banner with chrome work lights at the apex, aimed inward to spotlight the sign — real `SpotLight`s, not emissive trickery. Two workers inside: Tom (tie-dye shirt, white/grey ponytail, beard stubble) and an apron-wearing cook. Cooking stations along the side walls; center is the worker walkway. String lights along both eaves; a single PointLight inside stands in for the cumulative glow. ~35% of food-plaza chunks swap one ring slot for a shack. *(Sandbox: "Sugar Shack" entity.)*
- **Sandbox: Time-of-day panel.** Slider + Morning / Noon / Dusk / Midnight buttons in the entity sandbox UI, mirroring the in-game block from the backtick debug menu. The full backtick debug overlay is removed from the sandbox — the entity panel is now the entire sandbox UI.
- **Context lights (`PERF.contextLights`).** New PERF flag (off on low-tier, on for mid/high) that gates the optional proxy `PointLight`s now placed at every campsite firepit and chunk-level drum-circle firepit, plus the Sugar Shack's three lights. Each is one light per cluster (not per element), `castShadow = false`, and the campsite ones modulate by `nightness²` so they're invisible by day and roaring at midnight.

### Changed
- **Music: less repetitive across all stages.** Every music generator (jam, brass, second-line, drum-circle) now rotates through 2–3 melody/rhythm variants instead of looping a single 16-step pattern forever. Lead voices have an 8–12% chance to drop notes so the soloist breathes a little (tuned down from a heavier 18–28% first pass — too many rests sounded weird). Drum toms miss ~6% of hits. A slow ±20–30% gain LFO over 20–28 seconds makes the whole mix ebb and flow. The forest drum circle was already varied (Euclidean rhythms + ghost notes + jitter) and is unchanged. *(See [ROADMAP.md](ROADMAP.md) for section-based songform and full Markov phrase generation.)*
- **Music bus volume dropped from 1.6 → 1.2.** The boost-to-carry was compensating for the wall-of-sound problem. With the variation pass landed, the boost isn't needed and the main stage is no longer in-your-face at boot.

## 2026-05-26

### Added
- **iOS audio.** Multi-stage unlock during the Start gesture: synchronous `ctx.resume()` first, then a 1-sample WebAudio buffer-source, then a real 100ms silent WAV via HTMLAudioElement appended to the DOM. The third path engages iOS's "Playback" audio session so WebAudio stops respecting the hardware silent switch. Lock state persists across tab backgrounding via the `Sound.resume()` shim.
- **Audio diagnostics.** `Sound.diagnostics()` returns the full init + live state (ctx state, gain values, unlock outcomes). Surfaced on `window.__game.sound` for Safari Web Inspector probing. `?sounddebug=1` URL param pops the state as an on-screen toast at Start.
- **Volume safety clamp.** `localStorage.zerble.vol.master` (and music/sfx) restore now clamps anything below 0.05 to 0.05 — a previously-saved zero was a real "no sound" footgun.
- **Trip offer: tap-to-accept on touch devices.** The wook offer toast becomes a one-shot button (pulsing green border, `pointer-events: auto`) so mobile players can accept without a Y key. Desktop Y still works.
- **README** with indie-game framing, hero image, and the canonical control list.
- **ARCHITECTURE.md** — full walkthrough of render pipeline, world chunks/forests/lakes, registry, collision model, crowd AI, audio synthesis, perf tiers.
- **Drum-circle population.** Tribal-aesthetic figures (drummers on benches, dancers orbiting the fire, firekeeper + spotter) added to forest drum circles. Hybrid silhouettes — mixed bodies/clothing/hair, no shoes — to read as ecstatic fire-dancers without leaning on the stereotyped tribal trope.
- **Starry night sky + moon.** Star field opacity ramps with nightness. Moon rises across the sky on the day/night arc.
- **Drum-circle clearings** inside selected forests, with raised stone firepit, log benches, smouldering log cone, and emissive fire that lifts nearby trunks out of the dark.
- **More campsites** — both forest-clearing and lakeside variants, with firepits + tiki torches that flicker on at night.

### Changed
- **Generic festival branding.** Title screen reads "Zerble at the Festival" (added "the"). Tagline dropped the "Black Mountain, NC" reference. README scrubbed of LEAF / Lake Eden Arts Festival names so the game reads as generic-festival.
- **Pixel-art hero image** in README, replacing the ASCII title block.

### Fixed
- **iOS no-sound bug.** Root cause: `new AudioContext()` returns suspended on iOS Safari and was never resumed. Compounded by WebAudio respecting the silent switch when no `HTMLMediaElement` has played.

## 2026-05-25

### Added
- **Wook trip system.** Approaching a wook while stopped triggers a slow-build psychedelic post-process effect — kaleidoscope, color shift, rippling refraction — running for ~3 minutes with a Come Down phase before clearing. Trip has two modes (Static for hand-tuned slider values, Dynamic for scripted timelines). Wook actively approaches the player to dose them.
- **First-person view.** `V` cycles through chase / first-person / top-down.
- **Bubble bump** — Zerble can now bonk NPCs gently and get a non-damaging soft-collision response.
- **GA4 analytics** wired to gameplay events: game start, first honk, smile milestones (10/25/50/100/250/500/1000/2500), personal best, collisions by kind, view toggles, Lurleen found.
- **Lurleen** — Zerble's love interest, a second cart with pink puffy lips, raffia hair, flower basket. Spawns ~360m NE of origin, wanders home turf, transitions to "aware" with hearts when Zerble approaches, then follows.
- **Lakes** — first-class macrocell lake bodies (big radius 70–100m, small 25–40m), independent of the chunk grid. Canoes, beaches, lakeside campsites. Edge colliders stop carts from driving in.
- **Bigger lakes** with proper shore handling and 20% beach odds.
- **Forests.** 3x3 chunk-block forest cells pinned to the chunk grid with a 5x5 macrocell rule guaranteeing breathing room. Some host interior clearings (campsite or drum circle); all have a path entry through the tree wall.
- **Brass band parade** — roaming second-line marching brass with trumpet, trombone, tuba, snare, and kick. Anchored music handle that follows the band.
- **Puppet parade**, **kid gaggle**, and **wooks** as world-roaming obstacles independent of the chunk system.
- **Crowd v2** — pool of stateful NPCs with personality vectors (curiosity, skittishness, energy, social, talkative). State machine: idle / walking / watching / approaching / fleeing / smiling / riding / boarding. Steering with neighbor separation, footprint repulsion via registry, path attraction.
- **Crowd faces, smile reactions, happy bounce.** Walking-backward bug fix.
- **Humanoid bodies + horizontal guitar/bass necks** for stage performers.
- **Hammocks** with sleeping NPCs rendered supine (spine aligned with the poles, sinks into the sag).
- **Procedural festival chunk system.** 80m chunks, themed (main_stage / side_stage / food_plaza / vendor_row / drum_circle / grove / open_lawn), deterministic per (cx,cz) hash, lazy-load on approach.
- **Honk system.** Bell (B) + clown horn (H), Space picks randomly. 0.15s cooldown. Clown horn is a 2-phase honk + inhale fifth up. Bell is a brrring trill.
- **Boost engine sound** that punches in with throttle.
- **Touch controls.** Virtual thumbstick + Boost / Honk / Cam buttons, drag-to-orbit-camera.
- **Mobile polish** — viewport handling for iOS URL bar, dvh sizing, pinch/double-tap zoom suppression.

### Changed
- **Performance tiers** (low/mid/high) auto-detected from touch/screen/cores/memory. Pixel ratio cap, shadows, bloom, crowd density, chunk draw radius all read from this.
- **Performers / band poses** — trumpet, trombone, tuba alignment; cone bells flipped so they point away from the player; detached-forearm bug fixed.

## 2026-05-24

### Added
- **People fixes** — improved NPC rendering and behavior.
- **Mobile updates** — viewport, controls, audio gesture handling.

## 2026-05-23

### Added
- **Initial three.js scene** — Zerble cart, ground plane, sky, bubbles, smile pickups, score panel, title card.
