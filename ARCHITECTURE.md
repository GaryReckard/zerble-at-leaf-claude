# Architecture

How Zerble at Festival fits together. Aimed at someone who has cloned the repo and wants to understand the moving parts before editing anything.

---

## Top-level shape

- **No build step.** The game runs from source. `index.html` constructs an [importmap](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) at boot and loads `src/main.js` as an ES module. Three.js is pulled from `unpkg` through that same importmap.
- **Dev cache-buster.** On local hostnames (`localhost`, `127.0.0.1`, `*.local`, RFC1918, `claude-preview`, `happycog`) the importmap appends `?v=<Date.now()>` to every module URL, so edits show up on reload even when the preview proxy strips cache headers. Production loads modules unsuffixed so three.js can cache cleanly.
- **Dev server.** `python3 .claude/serve_nocache.py 8765` — a `http.server` subclass that sends `Cache-Control: no-store` on every response. Use it instead of `python3 -m http.server` so ES module bodies don't get cached by the heuristic cache.
- **Analytics.** GA4 (`G-CY1FNMY8H8`) loads inline in `index.html`. Every gameplay event flows through [analytics.js](src/analytics.js), which no-ops gracefully if `gtag` is missing.

---

## File layout

```
index.html                  Boot + importmap + title card + HUD scaffolding
styles.css                  HUD, title card, touch overlay
sandbox.html                Standalone scene viewer (not part of the game)
.claude/serve_nocache.py    Dev static server with no-cache headers
src/
  main.js                   Game bootstrap + main loop + collisions
  world.js                  Sky, lights, ground, fog, chunk + lake managers
  timeOfDay.js              Day/night cycle, nightness curve
  chunks.js                 80m procedural festival chunks
  forests.js                3x3-chunk forest blocks
  lakes.js                  Macrocell lake bodies
  mountains.js              Blue Ridge backdrop
  registry.js               Central world-entity registry
  zerble.js                 The player cart — geometry + arcade physics
  lurleen.js                Zerble's love interest — a second cart
  bubbles.js                InstancedMesh bubble particle system
  smiles.js                 Smile pickup orbs
  crowd.js                  NPC pool, AI, state machine
  obstacles.js              Puppet parade, brass band, kid gaggle, wooks
  camera.js                 Chase / first-person / top-down camera
  input.js                  Keyboard + touch input blend
  touch.js                  Virtual thumbstick + camera drag
  hud.js                    DOM HUD bindings (score, toast, hit flash)
  sound.js                  Web Audio synthesis — engine, SFX, music
  trip.js                   Custom post-process shader pass
  debug.js                  Dev overlay + console helpers
  perf.js                   Device tier detection (low/mid/high)
  rng.js                    Seeded mulberry32 + (cx,cz) hash
  analytics.js              GA4 wrapper
  models/                   Pure THREE.Group builders (geometry)
    canoe.js  campsite.js  bandMember.js  entranceArch.js
    foodTruck.js  hammock.js  heart.js  kid.js
    leafBanner.js  leafDrumCircle.js  parasolMarshal.js
    performer.js  puppet.js  stage.js  tent.js  tentStage.js
    tree.js  tribalFigures.js  wook.js
```

---

## Render pipeline

`main.js` builds:

```
WebGLRenderer  →  EffectComposer
                    ├─ RenderPass (scene, camera)
                    ├─ UnrealBloomPass        (PERF.bloom can disable)
                    ├─ Trip.pass              (custom ShaderPass — no-op at intensity 0)
                    └─ OutputPass
```

- `ACESFilmicToneMapping`, exposure `1.05`, sRGB output.
- Pixel ratio capped at `PERF.pixelRatioCap`.
- Shadows + shadow type are profile-gated.
- The bloom pass renders at half-res (`width * 0.5`).

Resize is driven by `window.visualViewport` so the canvas tracks the iOS URL bar correctly.

---

## Main loop

```
tick()
  ├─ shouldRunFrame(dt)         ← debug.js can pause / single-step
  └─ tickBody(dt)
        ├─ Zerble physics
        ├─ Sound.setEngineSpeed / setNightness
        ├─ Input edges → honk / view toggle / Y (trip accept)
        ├─ Bubbles.update / Crowd.update / Smiles.update
        ├─ Obstacles update — puppets, band, kids, wooks
        ├─ Trip.update / Lurleen.update
        ├─ Stage performers + light show
        ├─ Campsite + drum-circle animatables
        ├─ Forest drum-circle spatial lowpass
        ├─ World.update (expand chunks/lakes)
        ├─ resolveCollision(zerble, allColliders)
        ├─ honkRing expansion
        ├─ chaseCam.update
        ├─ Sound.updateAudioListener
        └─ composer.render()
```

Backgrounded tabs use `setTimeout(tick, 16)` instead of `requestAnimationFrame`, because RAF throttles to ~0 fps when `document.hidden` — and the Claude Preview MCP runs the page hidden.

---

## World generation

Three independent lifecycle systems own world content. They all share one registry.

### 1. Chunks (`chunks.js`)

- Grid size: **80m**. Chunk key is `${cx}_${cz}`.
- Lazy-loaded as Zerble approaches; **never unloaded** once created.
- Each chunk picks a theme from `(cx, cz)` hash:
  - `main_stage` — only at `(0, 0)`. Big stage + dense audience.
  - `side_stage`, `food_plaza`, `vendor_row`, `drum_circle`, `grove`, `open_lawn`.
- Every chunk also lays down a path stripe along its primary axis. NPC AI prefers to walk near paths.
- Chunks consult `lakes.chunkInLake` / `forests.chunkInForest` and skip generation when overlapping.

### 2. Forests (`forests.js`)

- **3x3 chunk blocks** pinned to the chunk grid. The center chunk hosts the forest; the 8 neighbours form the canopy.
- Decision rule: within every 5x5 chunk block, the center offset `(2, 2)` is the only candidate. This guarantees ≥2 chunks of clear space between any two forests.
- Some forests have a path entry on one cardinal side leading to an interior clearing. Clearings may host:
  - a campsite, or
  - a **LEAF-style drum circle** — stone firepit, log benches, tribal figures (dancers, drummers, firekeeper).
- Forest entries register edge colliders (gap on the path side) so Zerble physically cannot drive through the trees.

### 3. Lakes (`lakes.js`)

- Independent of the chunk grid. Lakes live on a **320m macrocell grid**.
- Body radius 70–100m (large) or 25–40m (small), placed deterministically within the macrocell.
- Load when within `LOAD_RADIUS` of the player, unload past `LOAD_RADIUS_UNLOAD` — so they don't pop in/out at chunk boundaries.
- Register colliders (radial wall) **without** a `chunkKey`, so chunk unload doesn't tear them down.
- Lakes own: canoes, beaches, lakeside campsites. Chunks consult the registry to avoid placing paths or decorations on water.

### Determinism

`rng.js` provides `hash2(x, y)` (32-bit mixing) and `mulberry32(seed)` (seeded PRNG). Every procedural decision — chunk theme, prop placement, lake position, forest contents — is hashed from grid coordinates plus a salt. The world is identical across reloads at the same coordinates.

---

## The Registry (`registry.js`)

A single store mapping `id → entry`. Every "thing in the world" registers itself. Entries can have:

- `kind` — `'stage' | 'tent' | 'truck' | 'tree' | 'lamppost' | 'arch' | 'puppet' | 'lake_edge' | 'firepit' | 'forest_tree' | 'drum_circle' | 'lurleen' | 'wook' | …`
- `position` — `Vector3`
- `footprint` — NPC-avoidance radius
- `collider` — optional hard collider for Zerble: `{ radius, damage }`
- `attractor` — optional crowd magnet: `{ radius, weight }`
- `chunkKey` — optional. When the chunk unloads, entries with this key are removed.

Consumers:

- **Crowd AI** queries footprints (avoidance) + attractors (points of interest).
- **Collision system** in `main.js` reads `registry.colliders()` each frame.

---

## Collision model

Centralized in `main.js#resolveCollision`. Each frame builds a list of candidate colliders:

```
allColliders = [
  ...registry.colliders(),
  ...puppets.colliders, ...band.colliders, ...kids.colliders, ...wooks.colliders,
  ...crowdNPCsWithinBroadphase,        // 6m broadphase reject
]
```

For each collider closer than `c.radius + zerble.radius`:

- Compute **approach speed** as the dot of Zerble's velocity with the contact normal.
- If `approachSpeed > APPROACH_DAMAGE_THRESHOLD` (1.2 m/s) → **damaging hit**. Apply knockback to Zerble, panic the NPC, deduct smiles, play kind-specific SFX, show toast.
- Else → **silent overlap-resolve.** Project Zerble out of the radius, bleed off the small approach speed. No score change.

This is what lets you brush against people at a crawl without losing smiles, while still getting punished for driving full speed into a crowd.

`passive` colliders are visible to the registry but skipped here — they're proximity triggers, not physical objects.

---

## Crowd (`crowd.js`)

A pool of stateful NPCs spawned by chunks.

- **Personality:** `curiosity`, `skittishness`, `energy`, `social`, `talkativeness` — random per NPC.
- **States:** `idle → walking → watching → approaching → fleeing → smiling → riding/boarding`.
- **Steering:** seek target + repel from registry footprints + neighbor separation + path attraction.
- **Smile mechanic:** eye contact with Zerble plus bubble proximity raises an internal happiness counter. On threshold → emit a smile pickup, record Zerble's at-smile position. The same NPC won't smile again until Zerble has driven `SMILE_RESET_DIST` away (prevents parking-near-crowd farming) **and** a cooldown elapses.
- **Hit response:** `onZerbleHit(npc, nx, nz)` panics the victim, applies knockback, and infects nearby NPCs into a brief fleeing state.

---

## Zerble (`zerble.js`)

Anthropomorphic golf cart. ~950 lines of geometry + physics.

- Arcade driving: throttle/brake/turn/drag/boost. `MAX_SPEED = 18 m/s`, `BOOST_MULT = 1.55`, `TURN_RATE = 2.1 rad/s`.
- Visible parts: red body, gold roof, blue seat, glowing cyan eyes, purple mustache, 6 wheels.
- Eye glow ramps with `nightness` and can be hand-tuned with `I` / `O`.
- World-bounded by `WORLD_BOUND = 230` so the player can't outrun the festival's "feel."
- `applyHit(pushDir)` adds an invulnerability window and a knockback impulse.

---

## Time of day (`timeOfDay.js`)

Single normalized `t ∈ [0, 1)`: `0`=dawn, `0.25`=noon, `0.5`=dusk, `0.75`=midnight. Cycle length is `CYCLE_SECONDS`.

Drives:

- Sky shader top/bottom colors
- Sun directional light (color, intensity, arc)
- Hemisphere light intensity
- Fog color
- A `nightness ∈ [0, 1]` accessor (smooth ramp, 0 at midday, 1 at midnight) consumed by:
  - Stage light shows, lampposts, tiki torches (fade in)
  - Drum-circle audio scheduler (more voices at night)
  - Crackling-fire bed (only audible after dusk)
  - Zerble's eye glow (subtle ramp)
  - Star field opacity

---

## Audio (`sound.js`)

All synthesized — no audio files shipped. ~1300 lines of Web Audio nodes.

- **Engine.** A pair of detuned sawtooth oscillators (gas-engine buzz) mixed with LPF-filtered noise (rumble). Speed scales gain + pitch + a putt-putt LFO. Boost engages a second tier with extra harmonics. At zero speed, fades to silence in ~80ms.
- **Collisions.** Per-`kind` one-shot synth hits: drums for stages, metallic clangs for trucks/lampposts, nasal boops for kids/puppets, brass for the band, wood knocks for the arch, a "duuude" drone for wooks.
- **Honks.** Bicycle bell (struck-tine + trill envelope) or clown horn (2-phase honk + inhale fifth up).
- **Drum circles.** A per-circle music scheduler. Voice density gates on `nightness`. A **lowpass cutoff** is set every frame from main.js based on distance from the body perimeter — drums sound wide-open from inside the circle, muffled by trees as you leave.
- **Stage music.** Bussed through `musicBus`, balanced against `sfxBus`.
- **Listener.** Camera position + forward feed into the Web Audio AudioListener every frame for spatial pan.

iOS specifics: `Sound.init()` must run **synchronously inside the tap handler** so the AudioContext starts in `running` state. The visibilitychange / pageshow / pointerdown / touchstart handlers all call `Sound.resume()` to recover from iOS suspending the context.

---

## Input (`input.js`, `touch.js`)

- `input.js` tracks held keys + edge events. Exposes `Input.throttle`, `.steer`, `.boost`, `.held(key)`, `.consumePressed(key)`.
- `touch.js` installs a virtual thumbstick (left), Boost/Honk/Cam buttons (right), and drag-anywhere-else for camera orbit. It pushes axes + edge events back into `Input` so the rest of the game is input-source-agnostic.
- Body class `.is-touch` on detection reveals the touch overlay.
- iOS pinch + double-tap zooming are killed at the document level.

---

## Camera (`camera.js`)

Three modes, cycled with `V` or the Cam button:

1. **Chase** — fixed offset behind Zerble, smooth follow. Arrow keys add **persistent** yaw/pitch offsets (no auto-snap-back).
2. **First-person** — eye level, follows heading.
3. **Top-down** — zoomable via `↑`/`↓` or mouse wheel.

---

## Models (`src/models/`)

Each file exports one or more `buildX(...)` functions that return a `THREE.Group` anchored at `(0, 0, 0)`. Callers position and rotate the group themselves.

Animated bits (firepit flicker, tiki flame, tapestry sway, tribal-figure motion) attach an updater closure or expose an `anim` object on the returned group. A central per-frame updater in `main.js` walks the animatables lists owned by chunks (`forestAnimatables`), lakes (`lakeAnimatables`), and drum circles (`forestDrumCircles`).

Notable model files:

- **`zerble.js`** + **`lurleen.js`** — full character carts. Stay in `src/` (not `models/`) because they carry physics + state, not just geometry.
- **`leafDrumCircle.js`** + **`tribalFigures.js`** — the centerpiece of the forest drum-circle theme.
- **`campsite.js`** — tents, chairs, firepit, tiki torch, tapestries.
- **`puppet.js`** — also exports `buildSimpleNPC` used as the base humanoid for band members, kids, and crowd NPCs.

---

## Performance (`perf.js`)

Boot-time device sniff: touch capability, screen size, `hardwareConcurrency`, `deviceMemory`. Picks one of three profiles:

| Knob | low | mid | high |
|---|---|---|---|
| `pixelRatioCap` | 1.0 | 1.5 | 2.0 |
| `shadows` | off | on | on |
| `shadowType` | basic | basic | soft |
| `bloom` | on | on | on |
| `crowd density` | thin | medium | dense |
| `chunk draw radius` | small | medium | large |

Override at the URL: `?perf=low` (or `mid` / `high`). Or at runtime: `window.__perfProfile = 'low'; location.reload()`.

---

## HUD (`hud.js`, `styles.css`)

Vanilla DOM, no framework.

- Score panel (current smiles + best, persisted to `localStorage` as `zerble-best-smiles`).
- Toast strip — short status messages with a fade timer.
- Hit flash — red vignette pulse on damage.
- Title card — full-screen overlay before start, dismissed by the green "Let's go ZERBLIN'!" button.

---

## Analytics (`analytics.js`)

Thin `gtag` wrapper. Events:

- `game_start`
- `first_honk`
- `smile_milestone` (10, 25, 50, 100, 250, 500, 1000, 2500)
- `personal_best`
- `collision` (by kind)
- `view_toggle` (mode)
- `lurleen_found`

`try`/`catch` around every `gtag` call so analytics failures (ad blockers, offline dev) never break gameplay.

---

## Cross-system threads to be aware of

1. **`nightness` is global state read everywhere.** Renderer doesn't know about it; world systems poll `getTimeOfDay()` every frame.
2. **Registry mutations are not transactional.** Chunks add then unload by `chunkKey`. Lakes deliberately omit `chunkKey`. Don't accidentally tag lake entries with one or they'll vanish when their host chunk unloads.
3. **InstancedMesh objects** (bubbles, parts of the crowd) need `instanceMatrix.needsUpdate = true` after every frame's writes — easy to forget when refactoring.
4. **Sound must initialize inside a user gesture.** Adding any `await` / `setTimeout` between the tap and `Sound.init()` breaks iOS audio silently.
5. **Determinism depends on hash inputs.** If you add salt to a chunk RNG call, prior chunks regenerate differently — fine for greenfield, painful if a player is mid-session and chunks reload.

---

## Where to start reading

If you only read three files, read them in this order:

1. **`src/main.js`** — the whole loop, top to bottom.
2. **`src/chunks.js`** — how the world is built.
3. **`src/crowd.js`** — where the game's "feel" lives.

After that, dip into any model file when you want to see how something specific is constructed — they're all standalone, all small, all readable.
