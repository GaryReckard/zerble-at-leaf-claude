# Zerble: A Chronicle

*From `initial commit` to "Zerble at the Festival" — every twist, turn, and pivot.*

Compiled 2026-05-26 by mining six Claude Code session transcripts (~23 MB of JSONL across `zerble-at-leaf-claude` and `zerble-at-the-festival`) and cross-referencing 40 git commits. Times in UTC except where noted; commit hashes link the story to the diff.

---

## Cast & concepts (introduced as they appear)

- **Zerble** — anthropomorphic golf cart that blows bubbles. The protagonist.
- **Smiles** — the score. Earned by gliding near festival-goers so they see Zerble's glowing eyes and bubbles.
- **The crowd** — festivalgoers, puppet parade, brass band, kid gaggles, wooks, stage performers.
- **LEAF** — Lake Eden Arts Festival, Black Mountain NC. The real festival the game is set at. (Later renamed in title to just "Festival.")
- **Lurleen** — Zerble's love-interest cart. Born May 25 ~03:57 UTC.
- **The trip** — psychedelic post-process the player can trigger via menu or by getting close to a wook. Born May 25 ~18:33 UTC.

---

## Act 0 — Genesis (May 22–23, 2026) [no session captured]

The earliest Claude Code session in the archive starts **May 24 21:28 UTC**, but the project's first 11 commits predate it. The opening creative act happened in a session that wasn't preserved here. What we can reconstruct from the diffs:

### `9ca67b6` — *initial commit* (May 22 22:35 EDT)
2,936 lines across 12 files. The game's conceptual core was already complete:
- `index.html` titled **"Zerble at LEAF — A Bubble Adventure"**, tagline *"Black Mountain, NC — bring the bubbles, collect the smiles"*
- Controls already defined: **WASD** drive, **Shift** boost, **Space** honk
- Intro copy: *"Glide near festival-goers so they see your glowing eyes and bubbles. Avoid the puppet parade, the brass band, food trucks, gaggles of kids, and the wooks."*
- File structure: `zerble.js` (the cart), `bubbles.js`, `crowd.js`, `obstacles.js` (puppet parade, brass band, kid gaggle, wooks, food trucks), `smiles.js`, `world.js`, `hud.js`, `input.js`, `main.js`, `styles.css`.
- Three.js with bloom post-processing, ACES tone mapping, PCF soft shadows.

The "festival" was never reverse-engineered from a generic template — it was named, themed, and populated on day one.

### `a1d177f` — *more tweaks* (May 22 22:46) — **chunks + mountains + RNG**
A massive +1,697/−757 refactor 11 minutes after birth. World becomes procedural:
- New `src/chunks.js` (794 lines) — chunk-streamed world.
- New `src/mountains.js`, `src/rng.js` (seeded), `src/registry.js`, `src/camera.js`.
- `world.js` shrinks 506 lines as content moves to chunks.

### `18e5d58 → 7eb3437` (May 22 23:04 → May 23 12:49) — *polish loop*
Six commits worth of "more tweaks" / "further progress": bubble tuning, chunk refinements, mountain shape work. **`07c2e11`** introduces `src/sound.js` (+285 lines). **`3af629e`** drops a big crowd/sound/zerble refactor (+824 lines). By the end of May 23 the bones of what exists today are already laid down — but everything still feels "pre-personality." No Lurleen yet. No lakes (just terrain). No mobile. No day/night. No trip.

Then **33 hours of silence** until the first captured session.

---

## Act I — Going mobile, finding the invisible people, meeting Lurleen
*Session `2aa487ff` · May 24 21:28 → May 25 05:06 UTC · 1,348 lines / 8 MB*

This session is the longest single arc in the archive. It opens with a question about phones and ends with the birth of Lurleen and the discovery that a sandbox would have saved everyone hours.

### 2026-05-24 21:28 UTC — *"What would it take to make this work on mobile?"*
Pure exploratory turn — no code. Claude scoped four workstreams: touch input, iOS viewport quirks, audio-gesture unlock, performance budget. Gary slept on it.

### 2026-05-24 22:02 UTC — *"yes. please tackle all 4 in order."*
The mobile port lands as commit **`7c91d6d` mobile updates**:
- New `src/touch.js` — multi-touch virtual thumbstick with deadzone+rescale, on-screen HONK/BOOST buttons, canvas-drag camera. Title card swaps `<kbd>` hints to touch chips via `body.is-touch`.
- `index.html` gets `viewport-fit=cover`, `user-scalable=no`, `apple-mobile-web-app-*`, `theme-color`. `styles.css` adds `100dvh` fallback, `overscroll-behavior: none`, `touch-action: none`, safe-area insets.
- `src/main.js` resize reads `visualViewport`, listens to `orientationchange` with a 250ms defer "for iOS dimension lies", swallows pinch/double-tap.
- `src/sound.js` gains `resume()` / `isReady()`; AudioContext recovers on `visibilitychange`, `pageshow`, first pointer.
- New `src/perf.js` device profile threaded into the renderer, crowd cap, chunk-load radii.

### 2026-05-24 23:31 UTC — *"audit your own work"*
Claude found **six bugs in its own mobile port** and shipped fixes in the same turn (no separate commit — same `7c91d6d`):
1. Double-counted safe-area insets (container padding stacked on chip padding).
2. Touch UI was tappable through the title card backdrop.
3. Resize left a stale canvas inline style — `setSize(w,h,false)` vs initial `true`.
4. Touch detection too eager — any touchscreen laptop got the mobile overlay. Switched to `matchMedia('(pointer: coarse)')` with old check as fallback.
5. Thumbstick had non-zero initial reading because math used base center, not finger landing position.
6. `aria-hidden="true"` never toggled when the overlay revealed.

> Mid-audit, the session crashed ("session stopped responding"). Recovered 3 hours later at 02:53.

### 2026-05-25 03:18 UTC — *"invisible people"*
Gary reported running into NPCs he couldn't see and getting smiles from invisible bodies once he'd driven away from spawn. This is the session's marquee root-cause find.

**The bug:** `THREE.InstancedMesh` frustum-culls based on the geometry's tiny bounding sphere anchored at scene origin. Once Zerble drove a few meters away, all 180 crowd instances vanished in one drawcall — but `Crowd.update()` kept ticking, so collisions and smile-emission still fired on bodies that no longer rendered. The earlier author had fixed it on `bubbles.js:44` but never propagated to `crowd.js`.

**Two fixes:**
1. `frustumCulled = false` on both crowd InstancedMeshes (body + head).
2. Lifecycle redesign — NPCs had been tagged to their *spawn* chunk, so wanderers vanished when their birthplace unloaded and lingerers lived forever inside unloaded zones. Switched to **distance-from-Zerble cleanup** (~200–280m by perf tier) with riders/boarders immune so passengers can't be yanked off mid-ride.

Lands as **`f50a307` people fixes**. Claude also produced a full taxonomy table (festival-goer, puppet parade, brass band, kid gaggle, wooks, stage performers) covering source files, lifecycle, and interaction rules — the first formal census of the cast.

### 2026-05-25 03:29 UTC — *paths swallowed by hills, the lake idea, silent main stage*
Four asks in one prompt:
- **Paths feel like a perfect grid** and seem to get "swallowed" by green ground as you move.
- Wants a **large lake with a small island**, grassy causeway through it, smaller lake on the other side with a peninsula, placed anywhere procedurally.
- **Main stage is silent** while side stages have music; one stage has a too-large bounding box.
- **Different music per stage** would be cool.

What Claude found and fixed (lands across **`3b5eca7` more stuff**):
- **The "swallowed paths" root cause** was non-obvious and beautiful: `world.js:46` translated the ground plane with the player, but terrain heights were sampled in *local* geometry coords — so the ~1.5m sinusoidal hills were literally **following the camera**, sliding across world-fixed paths. Added `resampleGroundHeights()` re-deriving vertex Y at world coords whenever player moves >40m, plus `polygonOffset` on paths.
- **Grid feel** — replaced rectangular `PlaneGeometry` strips with `buildCurvedPath()` in `chunks.js`: ribbon along a `CatmullRomCurve3` through three jittered control points, seeded by `(cx,cz)` so paths still meet at chunk edges.
- **Lake theme** — new `buildLake()` in `chunks.js`: big lake disc (r=22–26m), grass island (r=3.5–5m) with a tree, 6m grassy causeway N–S through eastern half, smaller lake (r=9–12m) NE with a peninsula. Registered as a recurring theme at 6–17% frequency, never at (0,0). Lake collision via overlapping spheres with angular gaps for causeway/peninsula.
- **Main-stage silence** — `buildWorld()` pre-loaded the (0,0) chunk *before* the Start click, so `Sound.attachStageMusic` saw a null `ctx` and returned null. Fixed by returning a pending handle that `Sound.init()` adopts on Start tap. Main stage plays `'jam'`, side stages `'brass'`, drum circles `'drum'`.

### 2026-05-25 03:57 UTC — **The "10× lakes + Lurleen" prompt**
The single most consequential message in the project's history. Multi-part:

1. Lakes should be **5–10× bigger**; NPCs lounging by shores would be nice.
2. Still seeing path/lake weirdness — is the ground actually flat?
3. **Lake collision still wrong** (hit when not touching, then drove on water with no issue).
4. **Hammocks don't look like hammocks** — should curve like real ones; NPCs should sometimes climb in and swing.
5. Mustache fuzz looks like 12 round nodules — wants thin **strands flowing outward and up the handlebar**.
6. Black pupil disappears into blue iris every few seconds.
7. **NEW BIG IDEA — Lurleen.** Another anthropomorphic golf cart, **Zerble's love interest**, pink lips + googly eyes + beautiful hair (with attached reference photo), basket instead of back seat. Hidden in the world somewhere; when Zerble gets close, hearts float up and Lurleen follows.

Lands as **`60b1afc bigger lakes, LURLEEN!`** and **`6ab3ad5 bigger lakes, LURLEEN!`** (same title twice — a quick fix-up). What shipped:

- **Flat ground for real.** `terrainHeight` in `rng.js` now returns `0`. The sinusoidal hills *were* the cause of every path/water-swallowing issue. Visual variety moves entirely to chunk decorations.
- **Lake collision math.** Sphere `r=2.2`, `ringR = lakeR - sphereR` so the outer surface lies on the visible water edge, `step = sphereR` for 100% overlap to prevent tunneling, causeway gap 0.3m.
- **Lakes 10× by area.** Lakes promoted out of chunks into world-level features. New `src/lakes.js` places them on a 320m macrocell grid at ~45% density. Big lake 70–100m, small lake 25–40m. Loads within 720m, unloads past 1500m, deterministically rebuilt on return. Macrocell (0,0) exempt. `chunkOverlapsLake()` so paths never bisect water.
- **Curved hammocks + swinging NPCs.** Flat plane geometry replaced with a 16-segment cosine-sag ribbon. New crowd states `walking_to_hammock` and `hammock_riding` — idle non-skittish NPCs roll for an unoccupied hammock within 30m, jog there, swing 12–30s, climb out. Riders immune to despawn.
- **Hair-strand mustache.** Nodule icosahedrons → 192 tapered cone strands, 60% radial-out + 35% along-tangent + 15% world-up so hair curls along the handlebar. Two lengths, two purple shades.
- **Pupil flicker fix.** Base z moved from -0.70 → -0.78, animation re-anchored so it stops oscillating *into* the iris. Added `polygonOffset`.
- **Lurleen v1.** New `src/lurleen.js`. Pink chassis, yellow roof, puffy lips (stretched sphere + seam line), purple-iris googly eyes with eyelash cones, 90-strand draped hair + 8-flower crown, wicker basket with handle. Spawns deterministically at `(240, 0, 260)` ~360m NE. State machine: **wandering → aware** (within 28m, hearts + toast "*You found Lurleen! 💗*") → **following** (11m follow distance, heart every 0.55s, resets if Zerble runs 84m away). Collision `damage: 0`, toast "*Easy, lover — that's Lurleen.*" Hearts spawn in scene space so they float straight up.

### 2026-05-25 04:32 UTC — *"are there tools you could build to make debugging easier?"*
The other turning point. Gary suggested a sandbox mode for visual iteration, then dumped another grab-bag: pupils too big (~2/3 out, want ~1/3), wants mouse camera, bubbles should live 2–3× longer, gold roof, mustache too spikey, stages/food trucks showing up inside lakes, canoes on the water, two honk variants (clown bulb OR bicycle bell), stages too clustered near spawn, Lurleen v1 didn't match the reference photo (flat googly stickers not 3D globes, hair wrapping the roof bunched/parted, plumper lips), and Lurleen needs to keep up with Zerble.

Lands across **`60b1afc`/`6ab3ad5`** and into **`52016d0` moar!**:
- **`sandbox.html`** — standalone debug viewer, entity dropdown (Zerble, Lurleen, side-by-side, Hammock, Heart, Canoe, Lake), mouse-drag orbit + scroll zoom + Shift-drag pan, 1–6 angle snaps, R reset, L toggle ground. URL deep-link via `?entity=lurleen`, copy-link button. **The single biggest productivity unlock of the project.**
- Quick wins: pupil radius 0.30→0.24, base z -0.78→-0.70 (~1/3 protruding). Bubble lifetime 8s→22s. `COLOR_ROOF` pink→gold (`0xf2c14e`). Lurleen `SPEED_MAX` 5.5→16, `ACCEL` 8→18, `TURN_RATE` 2.4→3.0, dropped the `aligned > 0.4` accel gate that was stalling her in turns.
- **Mouse camera** — pointer events filtered to `pointerType === 'mouse'`, piggyback on existing `camYawDelta`/`camPitchDelta`. Cursor grab→grabbing.
- **Hearts as actual hearts** — two-lobe Shape extruded with bevel, billboard via `lookAt` + gentle local-Z spin.
- **Lakes don't host stages** — `chunkInLake` added to `lakes.js`, used in `chunks._generate` to skip theme content in chunks intersecting lakes. Causeway z-fight fixed by removing water's polygonOffset and lifting causeway/peninsula/island slightly.
- Stages sprinkled into outer rings so they keep appearing as you drive.
- Honk variety — `playHonk` randomly picks clown squeeze-bulb or bicycle bell.
- **Canoes on every lake** — builder + per-frame update in `lakes.js`, passengers meandering.
- **Lurleen v2** — flat googly-sticker eyes (replaced 3D globes) with a wobbling pupil disc, plumper lips, hair wrapping the whole roof in bunched/parted sections, colored flowers + bows. Verified visually in the sandbox.

> Verification gotcha Claude flagged: Claude in Chrome runs the tab hidden, so the game ticks at ~1fps during inspection. Made Lurleen's chase math look broken when it wasn't.

### 2026-05-25 05:03 UTC — *wrap & memorize*
Gary said he wanted to start fresh. Claude saved five memories: project-overview, sandbox-debug-workflow, photo-is-spec, dig-for-root-cause (citing the four hard bugs from the session), and the Claude-in-Chrome throttle gotcha.

Closing line: *"Good festival."*

---

## Act II — Modular refactor, day/night, Lurleen v2, NOLA brass
*Session `3422646f` · May 25 05:10 → 14:50 UTC · 1,529 lines / 7.5 MB*

Fresh session, memories intact. Gary opens with the biggest wishlist of the project and tells Claude to **choose its own order**.

### 2026-05-25 05:10 UTC — The wishlist
Confirmed the five memories saved, then:
- Lurleen: taller roof matching Zerble, googly eyes on windshield, corner-bunched raffia hair.
- Every model available in sandbox + audit modularity.
- Better `playClownBulb` (click transient + triangle + WaveShaper) and `playBicycleBell` (FM with √2 ratio + HP filter + strike envelope).
- **Day/night cycle** with Zerble headlights and stage light shows.
- **Tent-stage** variant with soundbooth + crowd.
- Kids attracted to bubbles.
- Brass band + puppet parade polish + **NOLA second-line music**.
- Missing "Easy, lover" toast.

Lands as **`2a8707a` moar!** and **`b83a820` so much more**. The work:

- **Big modular refactor.** 15 builders pulled into `src/models/` (canoe, hammock, tent, foodTruck, tree, performer, stage, entranceArch, bandMember, puppet, kid, wook, heart, leafBanner, parasolMarshal, tentStage). `chunks.js` 1209→810 lines, `obstacles.js` 754→326.
- **Lurleen v3** — tall roof matching Zerble, clear front windshield with smaller closer eyes, four-corner raffia hair bunches with hair-tie rings, new `setSpawnAt` so sandbox Lurleen stops driving off.
- **Sandbox picker upgraded** — every model gets an entry, organized into Carts / Festival props / People / Particles optgroups.
- **Audio rewrite** — `playClownBulb` (5ms HP-noise click + triangle + reedy WaveShaper), `playBicycleBell` (FM √2 modulator + HP filter + 2ms strike → 0.65s release).
- **NOLA second-line** — `secondLineStage` for snare/tuba/horn groove + `setPosition` panner so the brass band's music follows the leader.
- **Day/night cycle** — brand-new `src/timeOfDay.js`, 6-minute cycle: sky shader, sun arc, hemi/ambient, fog, `nightness` 0..1. Zerble gets `SpotLight` headlights + emissive headlight bar. Stage lenses pulse and cycle colors at night. Force-test via `window.__game.getTimeOfDay().setT(0.75)`.
- **Tent stage** — `src/models/tentStage.js` + `tent_stage` chunk theme: striped circus tent, mixer LEDs, in-tent crowd + sound engineer, tent-pole colliders.
- **Bubble-chasing kids** — `KidGaggle.update` now takes `(bubbles, zerble)`: each kid chases nearest bubble within 9m; gaggle drifts toward Zerble.
- **Parasol marshal** — spinning canopy + ribbons + drum-major hat fronting a 7-piece brass band; spatial second-line music handle attached.
- **Puppet polish** — streamers from each hand + 50% chance of glowing antennae.
- **Lurleen "Easy, lover" toast** — damage-0 collider now emits a `notify` flag → toast + soft-bump SFX (`main.js:307`).

### 2026-05-25 05:55 UTC — *"canoe bow/stern are flipped"*
Quick one. `src/models/canoe.js` had `rotation.x` signs that flared the cones outward — flipped so they taper to a point. Bow + stern now narrow correctly. (Folded into the same commit cluster.)

### 2026-05-25 13:52 UTC — Lurleen round-3 + tent cleanup + backtick debug menu
**~8-hour gap** (Gary slept). Came back with photo-referenced refinements:
- **Lurleen lips** should match the attached reference (cupid's bow, **no black seam**), and she needs a **front seat** like Zerble's.
- **Halve the eye spacing**; from behind, eyes should show as white circles.
- **Hair** should come off the whole roof perimeter, arc into corner ties ~1/3 down, then fall straight.
- **Food trucks 1.5–2× larger**.
- **Tent stage**: no stripes, drop the left/right sides, rotate the stage 180°.
- **Backtick-key debug menu** with night/day controls.
- **Parades shouldn't spawn walking on a lake.**

Lands across **`14a2206` improvements!** and **`6774e7b` improvements! and performance issues now!**:

- `lurleen.js`: glossy red cupid's-bow lip rebuild (no center seam), purple front bench seat, eye gap halved (~0.46 center separation, double-sided sclera so the backs show as white circles), hair re-routed to arc into corner hair-tie knots then fall straight below.
- `models/foodTruck.js`: `FOOD_TRUCK_SCALE = 1.7`; matching footprint/collider/attractor scale in `buildFoodPlaza`.
- `models/tentStage.js`: all-white canvas, side walls removed (back wall only), stage rotated so the band faces the open entrance.
- `src/debug.js`: backtick panel got a time-of-day section — live readout, draggable slider, Morning/Noon/Dusk/Midnight preset buttons synced to the natural cycle when not dragging.
- `src/lakes.js`: new `projectOutOfLake(x, z, margin)` shoreline projector + `avoidLakes(path)` helper called from `PuppetParade` and `BrassBand` constructors to snap any in-water waypoint outward.

> Eye-overlap regression caught during a verification screenshot (the gap had been halved center-to-center instead of halving the visible gap). Fixed before reporting done.

### 2026-05-25 14:07 UTC — *"I asked for SHAPE not COLOR"* + Gemini's lip code
First explicit pivot of the session. Gary pushed back: Claude had changed lip *color* when only *shape* was requested — restore the pink. Then pasted Gemini's two-pass lip suggestions (sphere-lobes for cupid's bow, then `ShapeGeometry` + texture mapping) and asked Claude to try Gemini's approach. Plus:
- Kids running through hard objects with glowsticks.
- **Vendor tents** should have white tops with real product variation and stand close together.
- **Too many stages near spawn**; vary stage size 1.0–1.5× with collider respect.

Lands as part of **`6774e7b`**:
- `lurleen.js`: pink lip color restored. Shape switched to Gemini's `ShapeGeometry`/`ExtrudeGeometry` approach — top lip single silhouette with real cupid's-bow dip, bottom wide rounded pillow, no center seam, thin profile (fabric-prop look, not anatomy).
- `obstacles.js` `pushOutOfHardColliders`: each frame iterates `registry.colliders()`, hard-resolves overlap, redirects kid heading outward.
- `models/tent.js` + `chunks.js`: tent roofs always white festival canvas, per-tent colored valance trim band. Six product layouts (`layoutPottery`, `layoutHats`, `layoutJars`, `layoutPaintings`, `layoutBoxes`, `layoutPlantStand`) replacing three identical boxes. Vendor-row spacing 9m→5m so canopies nearly touch.
- `chunks.js`: inner-ring (dist ≤ 1.5) stage probability 35% → 7%; mid-ring 25% → 10%. `buildStage` takes a `scale` option — main stages 1.15–1.40, sides 1.0–1.5, with truss/banner/speakers/lights and all colliders + attractor radii scaling uniformly.
- `sandbox.html`: Lurleen camera now tracks her root each frame (she wandered off-screen during the wander timer).

> Pasting competing-LLM code is a Gary move — and a useful one. Claude implemented Gemini's shape directly rather than re-engineering from scratch.

### 2026-05-25 14:21 UTC — Stage poking through tent + brighter headlights + dim eyeballs
Lands as **`6774e7b` improvements! and performance issues now!** and into **`3153ce0` lots more changes**:

- `models/tentStage.js`: inner stage passed `scale: 0.82` to `buildStage`. Math derivation: truss top `9*s` must clear roof height `11 - 2.75*s` at the stage edge, so anything ≥0.94 pokes through; 0.82 leaves clearance.
- `zerble.js`: headlight SpotLight intensity 3.2 → 8.5 max; lamp lens emissive 1.2 → 5.0 at full night. Eye baseline dropped to `(0.35 + 0.35 * nightness) * eyeGlowLevel` so eyes glow soft even at midnight.
- **Eye geometry rebuild** — sclera is a front-facing hemisphere (`phiStart=π/2, phiLength=π`) + opaque black back-cap hemisphere so the driver cab stays dark from inside. Iris translucent + emissive; pupil solid.
- New `eyeGlowLevel` (default 0.75); hold **`I`** to ramp toward 1, **`O`** toward 0 (0.65/sec, ~1.55s full sweep). Multiplies the day/night baseline.
- `models/stage.js` + `chunks.js`: each lens lamp gets a matching SpotLight forward-and-down. Three Lissajous sweep patterns (wide, depth-pump, diagonal) cycling festival palette; smoothsteps with `nightness` so daytime stages aren't washed out.
- Seat colors: Lurleen front bench and Zerble back bench both → beige `0xd7c79a`.
- `bubbles.js`: emissive ramps to 0.35 at full night so bubbles pick up stage beams. `bubbles.update(dt, zerble, nightness)`.
- `zerble.js`: bubble-machine disco light replaced with a faceted icosahedron dome on a small black housing, mounted under the bubble machine, rotated π/4 back-and-down. Dome spins on aim axis cycling RGB; matching SpotLight throws colored light onto ground behind Zerble at night.
- **Unprompted "people pass"** — Claude noticed the new kid model "looked like a purple pill" and rebuilt the humanoid: `buildSimpleNPC` got legs/sleeved arms/hands/face dots/shoes + optional `armPose: 'instrument'`. `buildKid` full rebuild — torso, legs, sleeved arms, eyes, three hairstyles (pigtails / cap / mussed tufts), glow stick or balloon-on-string. `buildPerformer`, `buildBandMember`, `buildWook` (sunglasses + beard tufts + tie-dye sleeves) all upgraded.

### 2026-05-25 14:41 UTC — The 7-task batch, then a hard interrupt
Gary fired off another grab-bag:
- Sandbox needs the backtick day/night tools too.
- 5% of large lakes should get a single sandy beach on one edge.
- Driver: much longer brown beard, **handlebar mustache**, blue eyes, no hat.
- Eye dark backing is on the *side*, not the *back*, and should be **medium dark grey**, not black.
- Arch + main-stage text: **"LEAF" → "FESTIVAL"**.
- Night bubbles render white — should stay transparent with colored-light glints.
- Disco light points 45° UP but should be 45° DOWN, and mount under the bubble-machine box, not on the nozzle.
- Performance feels sluggish — optimization pass.
- Performers have top-hats clipping through bodies — hats shouldn't be on everyone, same hat, and should ride heads.

Claude set up **7 TaskCreate sub-agent jobs** for parallel work — then Gary interrupted before any edits landed.

### 2026-05-25 14:45 UTC — *"[Request interrupted by user] i/o eyeball brightness feature doesn't work"*
Drop-everything moment. Claude pulled up `mcp__Claude_Preview__preview_list` to inspect the running game but instead pivoted to recommending `/compact` — context was getting long — and offered a continuation prompt for a fresh session.

### 2026-05-25 14:50 UTC — Meta: *"Is Opus 4.7 the right model for this?"*
Closing reflective beat. Claude's honest take: **Sonnet handles ~85%** (mechanical refactors, geometry tweaks, sandbox loops); **Opus earned its keep** on multi-system root-cause debugs (eye hemisphere orientation, Lurleen spawn-vs-wander, bubble-flow architecture through `main.js`), spatial reasoning math (tent-stage scale derivation, FM modulator ratio), and matching Gary's casual voice. Recommendation: **Opus 4.7 main + Sonnet sub-agents** for mechanical tasks, 1M context worth it because the codebase + voice profile + accumulated feedback don't survive compaction otherwise.

---

## Act III — The trip system, the beach saga, the audio polish
*Session `600c13ab` · May 25 14:52 → 19:43 UTC · 2,026 lines / 6.9 MB*

The session opens by carrying over the interrupted batch and ends right before the directory rename.

### 2026-05-25 14:52 UTC — Continuation prompt + delegation
Pasted self-contained continuation covering the 7-task batch (I/O eye bug, sandbox debug, beach, driver beard, sclera back-cap, LEAF→FESTIVAL, night bubbles, disco flip, perf, performer hats). Asked the orchestrator to delegate to Sonnet sub-agents. Also added music/sfx volume controls. Lands gradually across the next several commits.

### 2026-05-25 15:13 UTC — Beach as people-attractor + intro text
Beach reworked as an attractor for festival-goers; small-island collision dropped. Intro screen text → **"Festival"**. Re-emphasis of the eye/back-cap fix suggests it wasn't right yet.

### 2026-05-25 15:35 UTC — Two-arms bug + sandbox coverage gap
Many people have **two sets of arms**; arms/feet point opposite to face. One remaining hatted band member: hat still static + clipping. Sandbox is missing big-lake + beach. (*"I've never even seen a beach in-game."*) Lays the groundwork for the **forearm/foot** fix in `3ea738f` and the sandbox expansion.

### 2026-05-25 15:53 UTC — *"how do i start this game again locally?"*
Quick answer, no code.

### 2026-05-25 15:56 UTC — *"did you decrease bubble output? We need more bubbles!"*
Spawn rate nudged up.

### 2026-05-25 15:57 UTC — *"can we switch to first-person?"*
First-person camera mode added.

### 2026-05-25 16:00 UTC — Explicit bubble cranking
`MAX_BUBBLES → 200`, `SPAWN_PER_SEC → 40`, boost idle baseline so bubbles pour at a stop.

### 2026-05-25 16:02 UTC — Intro instructions + mobile cam button + push
Opening screen + tick menu should list all controls (cam mode, tick menu). Add a mobile cam-toggle button. Gary granted a **one-time push permission** (rare — his normal instinct is to gate remote ops).

Lands as **`0aa7930` First-person view, bubble bump, full keybind help**.

### 2026-05-25 16:07 UTC — *"still have not witnessed a beach by a lake yet..."*
**The beach saga begins.** First of five rounds chasing the elusive beach. This round lands as **`463f8e1` Beach: lift above water + raise odds to 20%**.

### *~2-hour gap.* (Gary stepped away — life happens.)

### 2026-05-25 18:05 UTC — Forearms / feet still backward
Performers don't have two sets of hands after all — their forearms aren't attached to elbows correctly and are facing backward along with their feet. Lands as **`3ea738f` Fix detached forearms + backward shoes/arms on performers + band**.

### 2026-05-25 18:09 UTC — Crowd upgrade + guitar/bass necks
Make normal festivalgoers look like performers (minus instruments). Guitar/bass necks are 90° off. Lands as **`4a04b7f` Crowd: humanoid bodies + horizontal guitar/bass necks`**.

### 2026-05-25 18:17 UTC — Brass instrument poses + button text + boot error
Trumpets should bob with the player, come out of mouth with horn facing away, hands reach up. Tuba: rotate 90° around vertical then 90° around another axis, slight offset. Rename **"Start the parade" → "Let's go ZERBLIN'!"**. Fix the `BufferGeometryUtils` named-import that's breaking `crowd.js`. Lands as **`7e8455e` Fix crowd boot error + trumpet/tuba poses + button text**.

### 2026-05-25 18:22 UTC — Glowsticks from hands + crowd faces + smiles
Glowsticks come from kids' shoulders, not hands. Festivalgoers' feet look backward (they glide toward you in reverse) and have **no face** — add a face that smiles on smile-emit (until cooldown), plus a small happy-bounce. Lands as **`ae2cefc` Crowd: face, smile reaction, happy bounce + fix walking-backward`**.

### 2026-05-25 18:31 UTC — Trombone + flip both cones
Same trumpet fix for trombones; reverse the cone on both so the **large end faces away**. Lands as **`aa93ce2` Trombone matches trumpet + flip both cones so the bell points away`**.

### 2026-05-25 18:33 UTC — **The "wook dose" idea is born**
Wook dreadlocks should come out of the back/sides of his head, not push through his shirt all the way around. Also: snappier I/O eye-brightness keys.

> Then the seed: *"if a wook gets close to Zerble, briefly **dose** the driver with a psychedelic post-processing filter on the 2D output for ~30–60s — wants creative options."*

Lands as **`2fd07c7` Wook: dreads only on back/sides + snappier I/O eye-glow`**. The trip system is now germinating.

### 2026-05-25 18:36 UTC — Brass cones one-sided
Horn cones transparent from one angle. Lands as **`45fcd4b` Brass: DoubleSide so cone bells render from inside`**.

### 2026-05-25 18:44 UTC — **Full trip system with T-menu + dosed-by-wook entry**
Gary loved the dose idea. Wants three trip modes toggleable in a new **`T` menu**, configurable time/length. Trip starts when a wook walks up to Zerble at rest for ~5s — fade in. Ship all the cheap/trivial effects with sliders, each effect possibly wanting its own easing timeline.

Lands as **`c1d0df5` Wook dose: psychedelic post-process trip + T menu`** — the marquee feature of the session. Adds the psychedelic post-process pipeline: hue shift, saturation, UV ripple, chromatic aberration, lens distortion, vignette pulse, brightness pulse, posterize, kaleidoscope.

### 2026-05-25 19:05 UTC — Drop kaleidoscope + Come Down + Dynamic Trip (message interrupted)
Eliminate kaleidoscope (too much). Remove `T` and backtick callouts from main screen. Add a **Come Down** button (only active when tripping) and a **Dynamic Trip** button — the latter is what the wook triggers. Detailed per-effect timelines incoming…

### 2026-05-25 19:06 UTC — Full Dynamic Trip choreography
Re-sent with the wook trigger clarified. Per-effect timelines:
- Hue: slow 0↔1 loop
- Saturation: faster 0↔1 loop
- UV Ripple: easeInOutCubic in first 1/3, ease out last 2/3
- Chromatic Aberration: ease-in to 0.25 for first half, then oscillate 0.25↔1, then ease back to 0
- Lens Distortion / Vignette Pulse / Brightness Pulse: smooth random
- Posterize: meanders 0–0.25 most of the trip, sharp spike to 1 at the peak (~1/3 mark), then back down

Lands as **`d4c01e7` Trip: Dynamic mode + Come Down + drop kaleidoscope`**.

### 2026-05-25 19:14 UTC — Wook trigger inert + 3-min default + hammock sandbox
Testing the wook trigger — doesn't fire. Default Dynamic Trip duration → 3 minutes (was 30s). Aside: never seen anyone in a hammock — add to sandbox. Lands as **`ccc4071` Trip: wooks approach + 3min default; hammock fixes + sandbox`**.

### 2026-05-25 19:20 UTC — Hammock NPC standing through the hammock
"Person lounging" looks like they're standing up through it — they should be supine. Lands as **`5e18b00` Hammock NPCs render supine instead of standing upright`**.

### 2026-05-25 19:26 UTC — *"somethings fucky there, please look into it. you can spawn an opus 4.7 max sub-agent"*
Wook is at 2.7m but `prox-timer: 0.0s` never advances. Also: hammock NPC needs ~70° more rotation + sink into sag.

**Opus subagent found the root cause:** wook collider radius (0.9) + Zerble collision radius (1.9) = 2.8m forced gap > 2.5m proximity threshold. Fix passes the wook through as a non-colliding proximity check. Lands as:
- **`742edd9` Hammock: align supine spine with poles + sink into sag`** — `npc.yaw = π/2 − h.yaw` so spine lines up with the pole axis.
- **`344a18d` Wook trip trigger: passive collider on approaching wook so prox-timer can advance`**.

> Parallel orchestration: orchestrator did hammock pose while Opus sub-agent dug the wook bug.

### 2026-05-25 19:29 UTC — Wook spawn radius + boost engine sound + still no beach
Drove ~800m and saw no wooks — do they not spawn far from world spawn? Boost should affect engine sound. Still no beaches. Lands as **`25415a1` Boost engine sound, wook anchor recycling, beach 50%`** — wook anchors recycle as Zerble moves so they spawn at distance; engine gets a boost-modulated layer; **beach probability bumped to 50%**.

### 2026-05-25 19:35 UTC — Honk sounds wrong
Clown horn should be **two sounds**: a steady low honk when squeezed, then a higher-pitch interval as air sucks back in — current honk has a descending tone, that's wrong. Bicycle bell is close (two dings) but should be more like a **brrriiing brrrriiiing trill**. Lands as **`12ac537` Honk: clown 2-phase (honk + inhale fifth up), bell brrring trill`**.

### 2026-05-25 19:38 UTC — *"every large lake, just smaller"*
Wook trigger working — woo! For beaches: wants one on **every** large lake (not a subset), just covering ~5% of the lake's short-arc circumference. The beach saga ends here: **`b308532` Beach: small (5% arc) on every large lake instead of 50% chance giant`** — 100% spawn, radius `bigR × 0.16`, centered just outside the shoreline.

### 2026-05-25 19:40 UTC — Honk cooldown gone + B / H keys
Bells sound great. Lower or remove the cooldown. **B** = bicycle bell, **H** = clown horn. Lands as **`3a5c18e` Honk: 0.15s cooldown, B = bell, H = clown horn`** — cooldown 2.5s → 0.15s; `Sound.bell()` + `Sound.clownHonk()` exposed; intro card + debug panel updated.

### 2026-05-25 19:42 UTC — *"what would it take to rename the git repo + Pages?"*
From `zerble-at-leaf-claude` to `zerble-at-the-festival`. Claude scanned the project — zero hardcoded references to the old slug — and walked through the rename (GitHub settings, Pages URL, local `git remote set-url`).

---

## [Project directory moved: `zerble-at-leaf-claude` → `zerble-at-the-festival`]
*Between 19:43 UTC (last session ends) and 19:50 UTC (next session begins). The rename precedes the GA4 work. Best guess: the project outgrew its "LEAF" working title once forests, drum circles, beaches, wooks, and Lurleen pushed it from "festival simulator" toward a broader "Zerble at the Festival" world.*

---

## Act IV — Analytics
*Session `56e3e5d3` · May 25 19:50 → 19:58 UTC · 180 lines / 326 KB*

### 2026-05-25 19:50 UTC — *"Add GA4"*
Drop the Google tag (`gtag.js`, `G-CY1FNMY8H8`) into the page.

### 2026-05-25 19:51 UTC — *"yes please"* (event instrumentation)
While you're at it, instrument event tracking: menu opens (backtick + T), smiles counter milestones, wook trip triggered, Lurleen found, "stuff like that." Lands as **`d342f2e` GA4 (G-CY1FNMY8H8) + gameplay event tracking** at 15:56 EDT / 19:56 UTC.

### 2026-05-25 19:56 UTC — *"please commit"*

### 2026-05-25 19:58 UTC — GA4 dashboard configuration?
Pure guidance: GA4 auto-collection vs. marking events as conversions, registering custom dimensions for event parameters, DebugView for verification.

---

## Act V — Drum circle research, the forest scope-bomb
*Session `2095f149` · May 25 22:20 → May 26 01:00 UTC · 153 lines / 344 KB*

After the GA4 wrap, Gary stepped away for ~2.5 hours.

### 2026-05-25 22:20 UTC — Research the real LEAF drum circle
Web research on the Camp Rockwood drum circle at LEAF: mountaintop clearing, ~7–8ft raised firepit with a cone-of-logs fire, dancers in a circle, three-row semicircle of log benches for hand-drummers. Find visual descriptions.

**What came back:** *"the bonfire of all bonfires," "firelight casting shadows on eager faces,"* people of all ages, *"almost carnal, trance-like state,"* dancers inner ring / drummers on benches / lingering folks at the tree line, horns layering in late-night, sparks rising into canopy. Sources cited (The Jamwich, Leeway's Home Grown, ADVCollective, Dancin' Days, LEAF World Drum Day, Black Mountain News). Suggestions for the in-game scene: firekeeper figure, three radiating layers, sound bleed at distance, sparks, warm orange light on surrounding tree trunks.

### 2026-05-25 22:23 UTC — Audit the in-game drum circle
What does it need? New characters (dancers + drummers)? New music?

**Audit of current state:**
- `chunks.js:730` — exposed as thin: single icosahedron fire, 8 stones in a ring, one stray djembe, no drummers, no dancers, a comment promising a bench ring that was never built.
- `sound.js:998` — 3:4 polyrhythm with two sine toms + heartbeat kick. *"Actually pretty good bones."*

**Ranked impact-per-effort table proposed:** (1) real firepit + log cone, (2) three-row log-bench semicircle, (3) seated drummer NPCs reusing puppet skeleton + new `armPose: 'handDrum'`, (4) dancers circling fire, (5) spark particles, (6) thicken audio with slap-vs-tone djembe voice + shaker, (7) firekeeper, (8) late-night horns. Recommendation: do 1, 2, 5 first (zero character work), then decide if NPCs are needed.

### 2026-05-26 00:59 UTC — Major redirect + the FOREST idea
**~2.5 hour gap** (Gary thinking / dinner). Came back with a big bundle:

- Not into wook-style dancers — should be **shirtless men in loincloths** and **scantily-clad women in skirts/bikini tops** with long hair.
- Loves the 3:4 polyrhythm base; wants **emergent randomness** — *"some simple rules of how various layers of percussion would work together, that would lead to an emergent property somehow… i dunno, think on it."*
- **Firekeeper always has a helper/spotter** following close, both in black. No horns at drum circle (overriding earlier "late-night horns" idea).
- Firelight illuminates the scene; **daytime = small fire + casual drumming**; **after sunset = crowd gathers, music picks up, fire rages**.
- **New big system — FORESTS.** Denser tree clumps, much taller, more varieties. Zerble can't drive through normal forest. Forests pop up in clumps like lakes; nothing else walks through or spawns in them. **Some forests have a path** wide enough for Zerble leading to a clearing with the new fire + drum circle.
- Instruction: plan it out, then have a sub-agent do an adversarial review to poke holes / surface new ideas, then make it happen.

**Status:** planning kicked off — assistant read lake/chunk-theme/tree/time-of-day/collision/attractor systems before writing the plan, then briefed an adversarial sub-agent reviewer. Session ended mid-execution — implementation hasn't landed in git yet.

> Pivots/surprises: explicit retraction of late-night horns; rejection of wook dancers as the visual model; forests as a brand-new system (biggest scope add of the night); emergent-rules audio rather than scripted patterns.

---

## Act VI — This document
*Session `a712d4fb` · May 26 01:01 → 01:02 UTC · 37 lines / 57 KB*

### 2026-05-26 01:01 UTC — *"compile a document that chronicles the ideas and decisions and changes"*
The current session. Four parallel mining agents on the six session JSONLs, cross-referenced with 40 commits, producing this file.

---

## Through-lines

A few patterns showed up across every session worth naming.

**The sandbox unlock.** Until Gary suggested `sandbox.html` at 04:32 on May 25, all visual iteration meant driving 360m through procedural terrain to find Lurleen. After it landed, every model got an entry and visual tuning collapsed from minutes to seconds.

**Root-cause hunts that paid off.** Three bugs in this project were diagnosed only by reading code paths, not by tweaking values:
- **Invisible NPCs** — `InstancedMesh` frustum-cull against scene-origin bounding sphere.
- **Path-swallowing hills** — ground plane translated with the player but heights sampled in local coords, so hills literally followed the camera.
- **Silent main stage** — `buildWorld()` pre-loaded (0,0) before `Sound.init()`, so the stage music attach saw a null context.
- **Wook trigger inert** — wook+Zerble collider radii forced a 2.8m floor above the 2.5m proximity threshold.

In each case, "tune the number" would have wasted hours; the actual fix lived in the data flow.

**The beach saga.** Five separate prompts before the beach was a thing Gary could find. Iterations: hidden under water → 20% odds → 50% giant → realized he wanted small-but-omnipresent. Finally landed as 100% of large lakes, 5% arc, just outside the shoreline.

**Lurleen is iterative.** Born May 25 03:57 (v1: pink chassis, 3D googly globes), refined 04:32 (v2: flat googly stickers, plumper lips, hair wrapping the roof), refined again 05:10 (v3: taller roof matching Zerble, corner raffia hair, front windshield), refined again 13:52 (v4: cupid's-bow lips no seam, front seat, halved eye spacing), refined again 14:07 (v5: ShapeGeometry lips per Gemini's pasted code, pink restored). Five visible passes; "the photo is the spec" memory was earned the hard way.

**Audio iteration is its own arc.** Sound effects went through more rounds than any visual: clown horn from descending glide → steady tone + inhale-a-fifth-up; bell from two dings → brrriiing brrrriiiing trill; cooldown from 2.5s → 0.15s; dedicated B/H keys; FM modulator ratio derivation in `playBicycleBell`; spatial panner so brass band music follows the parasol marshal.

**Voice register.** Gary's casual "heya," "okee," "fucky," "whoops," "stuff like that" never broke through three days. Memorized in the saved profile, defended through compaction.

**Orchestration earned its keep.** The explicit Opus-sub-agent dispatch on the wook proximity bug (May 25 19:26) is the cleanest example: Opus did the spatial-reasoning root-cause find, orchestrator landed the hammock pose in parallel. Same pattern at session 1 end ("Opus main + Sonnet sub-agents").

**The directory rename was an admission.** When Gary asked "what would it take to rename the repo from zerble-at-leaf-claude to zerble-at-the-festival" (May 25 19:42), he was acknowledging out loud what the game had become: not a LEAF simulator anymore, but a wider festival world with forests, beaches, drum circles, and a love story.

---

## Where the story stands (May 26 01:02 UTC)

- **In git:** 40 commits, all on `main`, last is `d342f2e` GA4 + gameplay events.
- **In progress (uncommitted, planning only):** the **forest system** + **drum circle overhaul** (new dancer/drummer NPCs, firekeeper+helper, emergent percussion, post-sunset intensification, forest clearings with paths leading in).
- **In the codebase right now:**
  - `src/` — 23 modules, `src/models/` with 15 builders.
  - `sandbox.html` with mouse orbit, day/night controls, every model selectable.
  - Mobile-ready (virtual stick, HONK/BOOST buttons, iOS viewport handling).
  - GA4 analytics live.
  - Trip system with Static + Dynamic + Dosed (wook-triggered) modes.
  - Lurleen v5 wandering, hearts and toast on first contact.
  - Every large lake gets a small beach, a canoe with passengers, an island.
  - Day/night cycle, headlights, stage light shows.
  - Two distinct honks (B/H), NOLA second-line brass band, drum-circle 3:4 polyrhythm.

The festival is real. The forests are coming.
