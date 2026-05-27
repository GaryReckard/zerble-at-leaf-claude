# Perf pass 2 — execution plan

Five high-impact wins from the canonical r/threejs optimization list, ordered for incremental commits.

## Phase 1: renderer.info overlay (#5)
- Add a readout block to the backtick debug menu:
  - Draw calls, triangles
  - Geometries / textures in memory
  - JS heap (if performance.memory exists)
- Update each frame
- Commit point: instant value as a measurement tool

## Phase 2: Geometry / material disposal on chunk unload (#2)
- In `chunks.js` chunk unload + `lakes.js` lake unload + `forests.js`:
  - Before scene.remove, walk the chunk's group and dispose its geometries + materials
  - **CRITICAL**: don't dispose shared module-level geometries/materials (the `SHACK_MATS`, `STRING_BULB_GEO`, campsite `matFor` cache, etc.)
  - Track which materials/geos are shared via a Set or skip flag
- Commit point: long-session stability

## Phase 3: Frustum-based update gating (#1)
- In `main.js` tickBody:
  - Build a `THREE.Frustum` once per frame from camera projection
  - Gate per-frame updaters for animatables, drum-circle figures, stage performers when their cluster position is off-screen
- Important: keep collision + state-machine ticks running; only skip the *visual* animation work
- Commit point: FPS improvement in dense scenes

## Phase 4: Adaptive quality monitor (#4)
- New `src/adaptiveQuality.js` module
- Track rolling avg of `dt` over last 60 frames
- If avg > 40ms for sustained period: downgrade (turn off shadows OR drop pixel ratio OR disable bloom)
- If avg < 20ms for sustained period: ramp back up
- HUD toast on transitions so player understands

## Phase 5: InstancedMesh with variant buckets (#3)
- **5a Sugar Shack string bulbs** — single variant (all bulbs identical), 20 per shack collapsed to one `InstancedMesh`
- **5b Campsite tiki torches** — 3 variants (slightly different bamboo / cup / height). Each tiki built from 5 sub-meshes; merge into one BufferGeometry per variant, then InstancedMesh. Hash assigns each torch to a variant
- **5c Campsite chairs** — 3 variants. Already heterogeneous per `buildCampChair(rng)` but most variation is color — could collapse to 3 colored variants
- For each variant, allocate instances using deterministic hash so layouts stay stable across reloads

## Phase 6: Smaller wins (if time allows)
- Antialias off + FXAA pass tier-gated to mid/low
- Tiki flame `transparent: true` → `alphaTest: 0.5`
- Color-space audit

## Out of scope
- three-mesh-bvh (no raycast bottleneck here)
- lookAt caching (marginal)

## Validation
- Snapshot renderer.info before each phase
- A/B by hitting `?perf=mid` (the slowest tier where the work is most visible)

## What shipped

### ✅ Phase 1 — renderer.info readout
Backtick menu now shows draws, triangles, geometry/texture/heap counts.

### ✅ Phase 2 — Safe disposal
`userData.shared = true` on SHACK_MATS / STRING_BULB_GEO / SUPPLY_CAN_GEO /
campsite matFor cache. Chunk + lake disposal walks skip them. Was forcing
shader recompiles whenever a chunk containing a Sugar Shack or campsite
unloaded.

### ✅ Phase 3 — Distance-gated updates
forestAnimatables / lakeAnimatables / forestDrumCircles entries now carry
centerX/centerZ. main.js skips per-frame updates for any entry > 75m
from Zerble.

### ✅ Phase 4 — Adaptive quality monitor
New `src/adaptiveQuality.js`. Rolling 90-frame window; if avg > 24ms for
60 consecutive frames, drops a quality level (bloom → shadows → half
pixel ratio). If < 15ms sustained, ramps back. HUD toast on transitions.

### ✅ Phase 5a — InstancedMesh
- Sugar Shack string bulbs (20 per shack → 1 draw)
- Forest drum-circle bench rings (~30 logs + ~15 supports → 2 draws per
  circle)

### ✅ Phase 6 — Color-space cleanup
Tapestry CanvasTexture missing `colorSpace = SRGBColorSpace`. Added.

### ✅ Phase 7 — Antialias-off + FXAA tier-gated
High tier keeps MSAA (sharper). Mid/low get `antialias: false` + an
FXAAPass for screen-space AA — much cheaper at pixelRatio 2.

### ✅ Phase 8 — Material+geometry pool in puppet.js
buildSimpleNPC (used by band, kids, wooks, performers, parasol marshals)
now shares leg/shoe/torso/arm/head/eye geometries across every NPC, and
pools materials by color so two band members with the same shirt share
their MeshStandardMaterial.

### ✅ Phase 9 — Tiki torch + camp chair geometry pool
buildTikiTorch and buildCampChair use module-level shared geometry
buffers. Every torch in the world shares the same pole / joint / cup /
flame BufferGeometry; every chair shares leg / arm / seat / back.

### ✅ Phase 10 — Food truck geometry+material pool
Every truck shares the same BoxGeometry/CylinderGeometry buffers; bodyMat
is pooled by truck color.

### Final geometry counts (typical scene)
- Start of pass 2: ~3686
- After pass 2: ~2919  (-21%)

### Deferred to ROADMAP
- Variant-bucketed InstancedMesh for tiki torches/chairs (per-instance
  flame animation + chair color combinatorics make this a larger refactor)
- Color-space audit of any remaining textures
- LOD on distant trees + tents
- Geometry merging at chunk completion

### Won't do
- three-mesh-bvh (no raycast bottleneck)
- lookAt caching (no hot path)
