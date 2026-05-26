# Plan: Forests + LEAF-true Drum Circle

## Goals (per Gary's spec)

1. **Forests** — dense clumps of taller, more varied trees. Zerble cannot drive through. Spawn like lakes (macrocell-based). Block other spawns inside.
2. Some forests contain a **path wide enough for Zerble** leading to a clearing with the new drum circle.
3. **New drum circle** with:
   - 7-8ft raised stone firepit with a cone of logs burning on top
   - Three-row semicircle of log benches with seated drummers
   - Tribal dancers (shirtless men in loincloths, women in skirts + bikini tops, long hair) circling the fire
   - Firekeeper + spotter — pair in black, spotter follows firekeeper closely
   - Fire emits real light onto everything around it
4. **Day vs. night behavior**: small fire, casual scattered drummers, few lingerers by day. After sunset: roaring fire, full crowd, intense music.
5. **Emergent polyrhythm** — keep the 3:4 base, but layer multiple voices with rules that create emergent texture.
6. No horns at the drum circle (per Gary).
7. No wook-style dancers (per Gary) — these are distinctly *tribal-aesthetic* figures.

---

## Architecture overview

### Two new systems, mirroring the lake pattern

**`src/forests.js`** (new) — `ForestManager`, modeled directly on `LakeManager`:
- Forest macrocell size: **240m** (smaller than lake's 320m — forests are smaller landmarks).
- `FOREST_DENSITY = 0.55` per macrocell (a bit higher than lakes' 45% — they should feel common).
- `LOAD_RADIUS = 600`, `UNLOAD_RADIUS = 1300`.
- Forest body radius: 40-70m (smaller than lakes' 70-100m).
- Each forest deterministically seeded from `(mcx, mcz)` decides:
  - `hasDrumCircle: rng() < 0.40` — only ~40% of forests have the clearing. Makes finding one feel like an event.
  - If `hasDrumCircle`, pick a `pathAngle` (entry direction) and a clearing radius (~14m).
- Registers in the global `registry`:
  - One `kind: 'forest'` entry with a footprint = forest radius (used to suppress chunk themes inside, exactly like `chunkInLake`).
  - A ring of `kind: 'forest_edge'` colliders forming the perimeter. **Gap** in the ring where the path enters (just like lake causeways skip colliders along the causeway angle).
- **Trees inside forest**: scattered in `forests.js` (not `chunks.js`), denser and taller than chunk trees. New tree variants in `models/tree.js`: pine, oak (rounded), birch (narrow). Sizes 1.5x-2.5x current.
- **Clearing**: when `hasDrumCircle`, carve out a circular zone at the forest center with no trees. Plant the drum circle assets there.
- **Path**: from forest perimeter (at `pathAngle`) inward to the clearing — same `buildCurvedPath()` helper already in chunks.js. Width 6m. Suppresses trees within `±3.5m` of the spline.

### Chunk-theme changes

In `src/chunks.js`:
- **Add `chunkInForest()` / `chunkOverlapsForest()`** checks alongside the lake ones. When a chunk overlaps a forest, suppress all theme builders + ambient crowd inside the forest footprint. Trees from `scatterTrees()` also skip forest interiors.
- **Remove `drum_circle` from `pickTheme()`** — drum circles now exist only inside forests. The probability mass previously on `drum_circle` redistributes to `grove` and `open_lawn` so chunk balance stays sensible.
- Leave `buildDrumCircle` as a function but call it from `forests.js`, not from a chunk theme. (Rename to `buildLeafDrumCircle` to make the new shape clear.)

### Registry / collision

- `forest_edge` colliders: same pattern as `lake_edge`. Many small overlapping sphere colliders around the forest perimeter, with a gap at the path entry. `damage: 3` (less than lakes' 1 — they're scratchy bushes, not water — wait, lakes are 1, ouch — let me set forest at 2 to feel painful but not punitive).
- Individual large trees inside forest **also get colliders** (`radius: 0.6, damage: 4`) so even if Zerble somehow gets in, he can't ricochet around freely.
- `tree` kind needs an enhanced variant: `forest_tree` so we can give those colliders without affecting existing free-standing trees in chunks.

---

## Drum circle visual rebuild

`src/models/drumCircle.js` (new model module) builds the whole assembly:

### Firepit
- **Base**: low cylinder, radius **2.3m** (≈7.5ft), height 0.4m, stone-colored with flat shading. Built from ~16 ring stones (icosahedrons) capped with a low ring mesh.
- **Log cone**: 6-8 cylinder "logs" (radius 0.15, length 1.8-2.4m) leaned inward and meeting at a point ~2m above the firepit base. Charcoal-brown material.
- **Fire mesh**: an emissive cone (height 2.0m, radius 1.0m at base) layered over the logs. The shape pulses with a noise-driven scale: `0.8 + 0.2*sin(t*4) + 0.1*sin(t*7+0.3)`.
- **Day/night scale**: the fire mesh + log cone are scaled by `0.25 + 0.75 * nightness` along Y. By day it's a tame ember; at night it's a 3m roaring blaze.
- **PointLight**: one `THREE.PointLight(0xffaa55, intensity, distance=18, decay=2)` at the fire's center. Intensity ramps `0.6 → 6.0` with nightness. Flickers via `1 + (noise * 0.15)` per frame. **Cast shadows? No** — point-light shadows are 6× the cost. Use no shadow but rely on the warm color tone to sell the lighting.

### Log benches
- Three concentric semicircle arcs, radii **3.5m, 4.5m, 5.5m**, spanning **180°** (the side facing away from the fire's entry path).
- Each arc is built of 5-7 short cylinder "logs" (radius 0.25, length 1.4m) laid end-to-end, slightly rotated to read as separate logs.
- Logs sit on small wedge-cut supports (two small cylinders propping each up).
- Bench arcs register `kind: 'bench'` footprint (radius 0.4, no collider — Zerble can drive over them; they're decoration).

### Drummers (seated)
- 12 NPCs placed on the bench arcs (one per log section).
- New character builder `buildHandDrummer(rng)` in `src/models/handDrummer.js`. Reuses `puppet.js` `buildSimpleNPC` skeleton but:
  - Pose: **seated** — body scaled by `(1, 0.7, 1)`, dropped to `y=0.55`, legs bent (just lower the legs into the ground a bit since the bench occludes feet anyway).
  - New `armPose: 'handDrum'` — both arms forward and slightly down, hands meeting in front at lap height.
  - A small djembe child mesh (cylinder, 0.35 radius, 0.55 tall) between the knees.
  - Body palette: warm earth tones (browns, terracotta, deep red, ochre) — picked from a curated palette in handDrummer.js.
- **Animation**: each drummer's body bobs to its own assigned drum voice (more on this below). Arms swing in a small arc (`±15°`) on hits.

### Dancers (tribal)
- 6-8 NPCs orbiting the fire on a circle of radius **2.9m** (just outside the firepit edge).
- New character builders `buildTribalDancerMale(rng)` and `buildTribalDancerFemale(rng)` in `src/models/tribalDancer.js`:
  - **Male**: bare chest (skin color torso, no shirt mesh), loincloth = a small wrap-around plane mesh in tan/leather brown at hip height. Athletic build.
  - **Female**: bikini top (small rectangular mesh across chest, varied colors — terracotta, rust, deep maroon), skirt (slightly flared cylinder/cone from waist to mid-thigh, earth tones), long hair mesh (a swept-back cone or curved tube from the head down past the shoulders).
  - Both barefoot — skip the shoe meshes.
  - **Skin variation**: pick from a palette of 5-6 skin tones to avoid uniformity.
- **Animation**: orbit speed `0.35-0.55 rad/sec`, arms above head swaying side-to-side, hips rotating. Hair sways for the females.
- Dancers update centrally from a `drumCircles[]` list in main loop, similar to `stagePerformers`.

### Firekeeper + spotter pair
- Two NPCs **standing** near the fire, on the side opposite the bench semicircle.
- `buildFirekeeper(rng)` — all-black clothing (black shirt, black pants), holding a long pole (cylinder, 1.8m, dark gray). Performs a slow "poke the fire" anim every ~8 seconds — bends slightly, extends pole toward fire, retracts.
- `buildSpotter(rng)` — also all-black, no pole, arms folded or relaxed. **Follows the firekeeper** — every frame, position itself 1.5m behind firekeeper at a 30° offset. When firekeeper moves (during the poke anim, firekeeper shifts forward 0.3m), spotter shifts to match.
- During the day, firekeeper rarely pokes (every ~30s); at night, every ~6s.

### Day/night crowd scaling
The dancers + drummers list are **all built once** but their **visibility** is driven by nightness:
- **Daytime (nightness < 0.15)**: only 3-4 drummers visible (chosen deterministically), no dancers, firekeeper present but spotter standing further back, dim fire.
- **Twilight (0.15-0.6)**: drummers fade in linearly, dancers start appearing, fire grows.
- **Night (>0.6)**: full crowd, all dancers orbiting, fire raging.
- Implementation: each NPC has a `nightnessThreshold` baked in (0.0 to 1.0); `visible = nightness >= threshold`. Drummers get thresholds 0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.65, 0.7, 0.75. Dancers get 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75.

---

## Audio: emergent polyrhythm engine

`src/sound.js` already has a `drumStage()` function. Replace with a richer engine.

### Core idea: Euclidean rhythms + voice layering + adaptive rules

**Euclidean rhythms** distribute N hits across M steps as evenly as possible. E.g. `E(3,8) = X..X..X.` produces the West African bell pattern. They are the building block of most hand-drum polyrhythms in the real world. Tiny code, huge musical payoff.

```js
function euclidean(hits, steps) {
  const out = new Array(steps).fill(false);
  for (let i = 0; i < hits; i++) out[Math.floor((i * steps) / hits)] = true;
  return out;
}
```

### Voice layout (matches the visible drummers)

12 drum voices, each with its own Euclidean pattern, all sharing a common pulse (24 ticks per measure — LCM of 2,3,4,6,8):

| Voice | Role | Pattern | Sound |
|---|---|---|---|
| 1 | Heartbeat kick | E(2,24) = beats 1 and 13 | Low sine sweep 95→45Hz |
| 2 | Pulse low tom | E(4,24) | Filtered noise burst, 80Hz center |
| 3 | Pulse mid tom | E(3,24) — the cross-rhythm | Mid sine 150Hz |
| 4 | Lead djembe slap | E(5,24) | Bright noise burst, hi-passed |
| 5 | Lead djembe tone | E(7,24) | Sine 200Hz with quick decay |
| 6 | Counter-djembe | E(7,24) shifted by 3 | Sine 175Hz |
| 7 | Bell | E(5,24) shifted by 2 | Triangle wave 600Hz, very short |
| 8 | Shaker | E(11,24) | High-pass noise, very quiet |
| 9-12 | Spice — fills | (see below) | Various |

### Emergent layer: "spice" voices with reactive rules

Voices 9-12 don't play fixed patterns. Each one runs a simple rule per tick:

- **Voice 9 (call)**: every 8 measures, plays a short 3-hit fill ending on beat 1 of the next measure.
- **Voice 10 (response)**: hears voice 9's call; on the next measure, plays a mirrored 3-hit fill at a different pitch.
- **Voice 11 (density-aware)**: counts how many other voices are hitting on this tick. If >3, stays silent (don't crowd). If 0 or 1, has a 40% chance to hit (fill the gap).
- **Voice 12 (entrainment)**: starts on its own Euclidean pattern E(5,24) shifted by 5, but every 4 measures, **drifts** by ±1 tick. Creates a "the drummer is human" wobble.

These rules are *not* a neural net or even a Markov chain — they're four simple if-statements. But the combination of fixed Euclidean voices + a few reactive ones creates the *feel* of a real drum circle where one player throws a fill and another picks it up.

### Day/night intensity ramps

- **Daytime**: only voices 1, 3, 5 active. Quiet (gain 0.3x). Tempo 65bpm.
- **Twilight**: voices 1-7 active. Tempo 70bpm. Gain 0.6x.
- **Night**: all 12 voices active. Tempo 75-92bpm (per-circle seeded). Gain 1.0x. Voice 9's calls fire more often (every 4 measures instead of 8).

The currently-playing voices and gain are computed each frame from `nightness`. Crossfade individual voices over ~2 seconds when they enter/leave, so it doesn't pop.

### Per-drummer animation tie-in

Each visible drummer is assigned a voice (1 → drummer #0, 2 → drummer #1, etc.). On every scheduled hit for a voice, the corresponding drummer's arms swing forward briefly. This visually ties the crowd to the audio. The dancers, separately, bob their hips on every kick (voice 1).

### Audio performance

- All voices share one spatial panner per drum circle (same model as current `attachStageMusic`).
- Voice scheduling stays on the same `setInterval(180ms)` look-ahead pattern already in `drumStage`.
- Total active oscillators per drum circle at peak: ~14 (sines + a few noise sources). Well within budget.

---

## Implementation order

Doing this in phases so we can see progress and back out if anything goes sideways.

### Phase 1 — Forests as obstacles (no drum circle yet)
1. Create `src/forests.js` with `ForestManager` mirroring `LakeManager`. Just dense trees + edge colliders + footprint registration.
2. Add `chunkInForest()`/`chunkOverlapsForest()` helpers; update `chunks.js` to suppress themes inside forests.
3. Add new tree variants (pine-tall, oak-rounded, birch-narrow) to `models/tree.js`. Sizes 1.5x-2.5x current.
4. Wire `ForestManager.update()` into `main.js` next to `lakes.update()`.
5. **Test**: drive around, find forests. Crash into them. Confirm chunks inside are empty. Confirm forests load/unload at expected radii.

### Phase 2 — Forest paths + clearings
1. For each forest, deterministically pick `hasDrumCircle` and `pathAngle`.
2. Carve a path from perimeter to clearing using `buildCurvedPath()`. Skip trees within `±3.5m` of the spline. Skip edge colliders along the path entry.
3. Carve the clearing — circle of radius ~14m at forest center with no trees.
4. Drop a placeholder marker (the old fire icosahedron) in the clearing so we can see it.
5. **Test**: drive into a forest-with-path. Reach the clearing. Confirm no perimeter collider in the path. Confirm no tree pokes into the path.

### Phase 3 — Remove old drum circle from chunk themes
1. Delete `drum_circle` from `pickTheme()`. Redistribute probability to `grove`/`open_lawn`.
2. Keep `buildDrumCircle` function but rename and unhook it.
3. **Test**: no drum circles anywhere except inside forest clearings. (Yet — Phase 4 adds them.)

### Phase 4 — New drum circle visuals
1. Create `src/models/drumCircle.js` with `buildDrumCircle({ rng })` returning `{ group, fire, light, drummers[], dancers[], firekeeper, spotter }`.
2. Build firepit (stone ring + log cone + emissive fire mesh).
3. Build bench semicircle (three log arcs).
4. Add `THREE.PointLight` at fire.
5. Wire fire scale + light intensity to `nightness` in a new update function.
6. **Test**: visually correct from any angle, day and night.

### Phase 5 — New characters
1. `models/handDrummer.js` — seated drummer with djembe.
2. `models/tribalDancer.js` — male + female variants.
3. `models/firekeeper.js` — firekeeper + spotter pair, with the spotter following.
4. Place 12 drummers on benches, 8 dancers on orbit ring, firekeeper + spotter near fire.
5. Wire animations: drummer arm-swing per hit, dancer orbit + sway, firekeeper poke + spotter follow.
6. **Test**: characters look distinctly tribal, not festival hippie. Visibility scales correctly with nightness.

### Phase 6 — Emergent polyrhythm audio
1. Rewrite `drumStage()` in `sound.js` to be the 12-voice Euclidean + spice engine.
2. Wire per-voice gain to nightness.
3. Wire per-drummer animation to per-voice hits (pass an emit-callback into the model from chunks.js wiring).
4. **Test**: listen at multiple drum circles to confirm seeded variety. Listen across the day/night cycle.

### Phase 7 — Polish
1. Spark particles rising from fire (point sprites, decay over ~3s, only spawn at night).
2. Warm orange flicker on the bench logs and surrounding tree trunks (achieved automatically by the PointLight if `distance` is tuned).
3. Confirm performance under chunk reload stress.

---

## Risk register

| Risk | Mitigation |
|---|---|
| PointLight count blows perf budget | Cap to MAX 3 active drum-circle lights — pool by distance to Zerble, exactly like the existing stage-light pool. |
| Forests block all other content too aggressively, world feels barren | `FOREST_DENSITY` is tunable; start at 0.55, dial down if it feels too crowded. |
| Player can't find a drum circle | Audio is loud + spatial — drums carry. Plus the forest edge is visibly different (taller trees). Plus path entrances are visible from outside. |
| 12 oscillators per drum circle * 3 active circles = 36 oscillators is too much | The Web Audio context handles hundreds of oscillators fine; this is well under. But cap active drum circles by distance just in case. |
| Tribal dancer designs feel uncomfortable / culturally insensitive | This is a stylized arcade game with cube-people; the imagery is closer to "Crash Bandicoot tiki" than real cultural depiction. Use earth-tone palette, no facial features, no specific motifs. Keep it abstract. |
| Removing drum_circle chunk theme breaks save/replay determinism | The chunk theme picker is purely deterministic from (cx, cz). Same input → same output. No saved state to migrate. Confirmed safe. |
| Firekeeper spotter pair-following logic glitches at chunk unload | Spotter follows firekeeper by storing a reference, not by position lookup. Both are children of the drum circle group. When the group unloads, both go together. |

---

## File diff summary (what gets touched)

**New files:**
- `src/forests.js` (~400 lines)
- `src/models/drumCircle.js` (~250 lines)
- `src/models/handDrummer.js` (~80 lines)
- `src/models/tribalDancer.js` (~120 lines)
- `src/models/firekeeper.js` (~60 lines)

**Modified files:**
- `src/chunks.js` — remove drum_circle theme, add forest suppression checks (~30 lines changed)
- `src/sound.js` — replace `drumStage()` with Euclidean engine (~200 lines changed)
- `src/main.js` — wire ForestManager, drum-circle updates (~15 lines)
- `src/models/tree.js` — add tall/varied variants (~60 lines added)
- `src/registry.js` — no changes (existing kind system handles `forest`, `forest_edge`, `forest_tree`)

Estimated total: ~1300 lines new, ~250 lines modified.
