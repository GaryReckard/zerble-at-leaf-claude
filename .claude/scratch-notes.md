# Scratch — Zerble at the Festival project notes

Notes I built up while reading the codebase. For my own use writing README.md and ARCHITECTURE.md.

## Top-level shape

- Pure browser game. No build step. ES modules served straight from disk.
- `index.html` constructs an importmap at boot (with a `?v=<timestamp>` cache-buster on local hostnames) and loads `src/main.js`.
- Three.js pulled from unpkg via importmap (`three@0.160.0`).
- GA4 (G-CY1FNMY8H8) inline in `index.html`. Routed through `src/analytics.js`.
- Dev server: `python3 .claude/serve_nocache.py 8765`.
- `sandbox.html` is a separate playground/scene viewer (46KB single-file). Not part of the game proper.

## Files (src/)

- **main.js** — bootstrap. Builds renderer + scene + EffectComposer (RenderPass → UnrealBloomPass → Trip.pass → OutputPass). Owns the main game loop, wires HUD/Touch/Input, instantiates Zerble, Bubbles, Smiles, Crowd, Lurleen, the moving obstacle classes, and the ChaseCamera. Houses the collision resolution function and the kind→toast mapping.
- **world.js** — global world setup (sky shader, sun/hemi lights, fog, big ground plane, mountains). Owns the ChunkManager and LakeManager. Exposes `buildWorld`, `updateWorld`, `getTimeOfDay`.
- **timeOfDay.js** — day/night cycle. Normalized t in [0,1]. Drives sky colors, sun/hemi intensity, fog, and a `nightness` accessor consumed by many systems.
- **chunks.js** — procedural festival generator. 80m chunks, themed (main_stage / side_stage / food_plaza / vendor_row / drum_circle / grove / open_lawn). Owns stage performers + light show updaters.
- **forests.js** — 3x3 chunk-block forests pinned to chunk grid. Some host a LEAF-style drum circle with tribal figures, fire, and lowpass-filtered drum audio that opens up as you enter.
- **lakes.js** — first-class lake macrocells (320m grid), independent of chunks. Lakes register colliders that block driving, plus canoes, beaches, lakeside campsites.
- **mountains.js** — three rings of low-poly hills as backdrop.
- **registry.js** — central registry. Every world thing with a footprint, collider, or attractor registers here. Crowd AI queries for avoidance + points of interest. Collision system queries for hard colliders.
- **zerble.js** — the protagonist. Anthropomorphic golf cart (red body, gold roof, blue seat, glowing eyes, mustache). Arcade physics. ~950 lines.
- **bubbles.js** — InstancedMesh of ~200 transmissive bubbles. Drift on a wandering wind field. Used by crowd as a "happiness" trigger when near NPCs.
- **smiles.js** — pickups. Glowing yellow orbs that float up from happy NPCs and home in on Zerble.
- **crowd.js** — NPC pool, ~1115 lines. Personality vector, state machine (idle/walking/watching/approaching/fleeing/smiling/riding/boarding). Steering with neighbor separation + path attraction. Emits smiles, panics on collision.
- **lurleen.js** — Zerble's love interest. A second cart with pink lips, raffia hair, flower basket. Spawns ~360m NE of origin. State machine: wandering → aware (hearts erupt) → following.
- **camera.js** — chase camera with three modes (chase / first-person / top-down). Arrow keys add persistent yaw/pitch.
- **input.js / touch.js** — keyboard + virtual thumbstick + cam-drag. Input module blends both sources so the rest of the game is source-agnostic.
- **hud.js** — DOM-based HUD (smiles count, best, toast, hit flash, title card).
- **sound.js** — ~54KB. Web Audio synthesis. No audio files shipped. Engine drone, collision SFX per kind, honks (bell + clown horn), forest drum-circle scheduler with nightness gating + spatial lowpass, crackling fire bed, stage music.
- **obstacles.js** — PuppetParade, BrassBand, KidGaggle, Wooks. World-roaming groups (not chunk-bound). Each exposes `.group`, `.update(dt)`, `.colliders`.
- **trip.js** — psychedelic post-process shader pass. Custom GLSL fragment. Gated behind a secret interaction. (DO NOT detail in README.)
- **debug.js** — `~/.claude` style dev overlay. `t` menu and friends. Toggled with backtick. (DO NOT detail in README.)
- **perf.js** — cheap device-feature detection → low/mid/high profile. Pixel ratio cap, shadow type, bloom on/off, crowd density, chunk draw radius all read from this.
- **rng.js** — mulberry32 + chunk hash. Determinism.
- **analytics.js** — GA4 wrapper. No-op if gtag missing.
- **models/** — pure geometry builders. Each returns a THREE.Group at origin. Animated parts return updater closures called from main.js. Models: tent, foodTruck, hammock, canoe, tree, heart, stage, performer, entranceArch, leafBanner, puppet, bandMember, parasolMarshal, kid, wook, tribalFigures, leafDrumCircle, campsite, tentStage.

## Key architecture observations

- **No bundler.** Importmap + ES modules. Production loads modules with no cache-buster; local dev appends `?v=<Date.now()>`.
- **Determinism via hash(cx, cz).** Chunks regenerate identically. Forests use a 5x5 macrocell offset rule so they never overlap.
- **Three lifecycle systems for world content:**
  1. Chunks — 80m grid, lazy-load, never unload once created.
  2. Forests — 3x3 chunk block, pinned to chunk grid.
  3. Lakes — 320m macrocell, load/unload by distance.
- **One central registry** is queried by both crowd AI (footprints, attractors) and collisions (hard colliders).
- **Collision model:** approach speed dot product against contact normal. Below threshold = silent overlap-resolve. Above = damage + bounce + crowd reaction.
- **All audio is synthesized.** Engine = sawtooth pair + LPF noise, modulated by speed. Drum circles = a per-circle music scheduler with spatial lowpass that opens as the player enters.
- **Nightness threads through everything.** Sky, lights, fog, stage light show, drum-circle voices, fire crackle bed all read `getTimeOfDay().nightness`.

## Tone for README (per Gary's brief)

Indie-game-on-GitHub vibe. Don't reveal wook-trip / `t` menu. Title-card already says "Black Mountain, NC — bring the bubbles, collect the smiles." Keep that. Existing controls table in index.html is the source of truth for the controls section. License: not declared in repo; default to "All rights reserved" or pick MIT — leave as TBD ("Personal project. License TBD.").
