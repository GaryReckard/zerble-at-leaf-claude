# Perf pass 4 — ChatGPT audit eval + execution plan

Date: 2026-05-28
Trigger: ChatGPT review of the zipped repo. This doc is my (Claude's) read of
that audit — claim-by-claim against the actual code — plus a priority-ordered
plan for what's worth shipping.

> **Project rule context:** I followed
> [.claude/rules/performance.md](rules/performance.md) — audit before tuning,
> match fix to symptom (allocation vs steady-state), don't pre-optimize
> categories that the HUD says are green. ROADMAP "Performance" was also
> consulted; items already parked there are tagged below.

---

## Phase 1 findings — measured 2026-05-28

Instrumentation shipped and tested. Key measurements at `?perf=high`, parked
still at main stage, 499 NPCs loaded:

| Metric | Value |
|---|---|
| fps | 19 |
| avg frame | 52.4ms |
| p95 frame | 58.1ms |
| max frame | 78.4ms |
| chunk gen avg | 3.3ms |
| chunk gen worst | 15.2ms |
| chunk gen slow (>8ms) | 2 of 30 |
| registry entries | 3760 |
| registry colliders | 3312 |

**Branch decision: Path B (crowd-first).** fps=19 with the cart parked,
doing nothing — that's pure steady-state simulation cost. Chunk gen is fast
(avg 3.3ms, worst 15ms). The bottleneck is: 499 NPCs × ~3760 footprints =
~1.88M footprint checks/frame + 499 × 499 ≈ 249k NPC-NPC separation
checks/frame. GPU/rendering is not the bottleneck.

Forest geometry merging still matters for the draw-call budget (important on
the `?perf=low` tier and for long sessions where geometry count creeps), but
it won't move the fps needle from 19 to 60. Spatial hashing goes first.

**Bug found + fixed during Phase 1:** `dt` in main.js is capped at 50ms
(`Math.min(clock.getDelta(), 0.05)`), so using it for frame-time stats
made avg/p95/max all report exactly 50ms. Fixed by tracking raw
`performance.now()` deltas in `adaptiveQuality.js` independently.

---

## TL;DR

**Updated 2026-05-28 (round 2)** after ChatGPT pushed back on the original
plan. The two corrections I had to own:

- **Material pooling does not reduce draw calls.** three.js sorts by
  material to cut state changes; it does not merge separate `Mesh` objects.
  My first read undersold the forest draw-call problem because of this.
- **Phase ordering was hard-coded before phase 1 instrumentation could
  justify it.** Fixed: phases 4–7 are now branched on what the slow-chunk
  and p95 metrics reveal.

Three structural wins not on ROADMAP, worth doing in some order:

1. **Forest chunk geometry merging.** Bigger draw-call win than I
   originally credited. Goes EARLY if instrumentation says spikes
   correlate with chunk loads or forest proximity.
2. **Spatial hashing for crowd separation + registry footprint queries.**
   Genuine O(n²) at `crowdMax: 500`. Sim-side win, biggest payoff in
   crowded zones. Forest_tree footprints are NOT skipped in the existing
   kind-filter, so the registry index in particular has more headroom
   than I first said.
3. **Adaptive quality re-ordering + threshold tuning + p95 jitter signal.**
   The current ladder demotes pixel ratio last; on Retina that's backwards.
   Also: avg-only frame metric misses spikes.

The rest is a mix of: things already shipped (FXAA at mid/low, material
pooling), things already on ROADMAP (forest LOD, geometry merging, chair
instancing), and one piece of advice we should partially reject (blanket
"disable MSAA on high").

**Don't do** (at least not as a perf measure):
- Disable MSAA on high. It's intentional and the visual diff is significant
  on desktop. The pixel-ratio cap is the right knob.
- Replace bubble `MeshPhysicalMaterial` outright. Tier-gate it instead — the
  iridescent transmission is part of the toy's identity at high.
- "Generate heavy chunks in phases" beyond what we already have. 1 chunk/frame
  + instrumentation is the right starting point; multi-phase is complexity we
  haven't justified yet.

---

## Claim-by-claim evaluation

### ✅ Real, not on ROADMAP, worth doing

#### Crowd separation is O(n²) at 500 NPCs
[src/crowd.js:812-831](../src/crowd.js#L812) — every NPC's update loops over
every other NPC for separation. At `crowdMax: 500` (high tier) that's up to
250,000 pair checks per frame plus square-roots. ROADMAP "Crowd InstancedMesh
churn" is about *render-side* matrix writes; this is a separate **sim-side**
problem and isn't tracked.

**Fix:** uniform-grid spatial hash. Cell size = `SEPARATION_RADIUS`. Each
frame: bucket NPCs into cells, then per-NPC query the 9 surrounding cells
instead of `this.npcs`. Expected complexity: O(n × k) where k is the
average per-cell count (small).

#### Registry footprint scan is O(npcs × footprints)
[src/crowd.js:1397](../src/crowd.js#L1397) — `nearestFootprintAvoidance` walks
`registry.footprints()` for every NPC every frame. Forest chunks each
register ~80 `forest_tree` entries — across 9 loaded chunks plus tents,
stages, lampposts, campsites, that's easily 800–1200 footprints. 500 NPCs ×
1000 footprints = 500k checks/frame.

**Important detail (caught by ChatGPT round 2):** the in-loop skip is
```js
if (fp.kind === 'tree' || fp.kind === 'path_node') continue;
```
Forest trees are registered with `kind: 'forest_tree'`
([src/forests.js:856](../src/forests.js#L856)), **not** `'tree'`, so they
are NOT skipped. That's intentional gameplay-wise (NPCs should walk around
big forest trunks) but it means forest_tree footprints dominate the cost.
The chunk-tree `'tree'` filter is fine; the win on `forest_tree` only comes
from a real spatial index, not a kind-filter.

**Fix:** add a spatial grid on `Registry` for footprints (probably
8m cells — a few footprints fit). Expose `registry.footprintsNear(pos,
radius)` and switch the crowd loop to that. The kind-filter can stay where
it is; the structural win is the index.

#### Adaptive quality demotes pixel ratio last
[src/adaptiveQuality.js:28-35](../src/adaptiveQuality.js#L28) — current
ladder: `baseline → no-bloom → no-shadows → half-pixels`. On a Retina
MacBook (devicePixelRatio 2 → renderer pixelRatio 2), the dominant fill-rate
cost is **pixels rendered**, and the right first response to "slow" is to
drop pixelRatio. Bloom and shadows go second.

**Fix:** reorder to e.g. `baseline → pixel-90 → no-bloom → no-shadows →
pixel-75 → pixel-60`. Use intermediate multipliers (0.9, 0.75) rather than
jumping straight to 0.5 — the visual hit at 0.5 is steep.

#### RAISE_FRAME_MS = 15 is too tight for 60Hz
[src/adaptiveQuality.js:24](../src/adaptiveQuality.js#L24) — vsync at 60Hz
caps at ~16.67ms. Requiring avg < 15ms over a 90-frame window to ever raise
quality means many *perfectly fine* 60Hz sessions stay degraded forever
once they've dropped once.

**Fix:** RAISE to ~18ms. Add a tiny dead-band that prefers staying at the
current level when avg is between RAISE and DROP. This was an off-by-one in
intent, not a deep redesign.

#### Average frame time hides jitter
The whole point of adaptive quality is to react to *bad frames*, but the
trigger is average. A scene at 14ms-avg with 50ms spikes every second will
*feel* terrible and never trigger a downgrade.

**Fix:** also track `p95` over the window. Drop if `p95 > 33ms` even when
avg is fine — meaning "spike every ~20 frames". Cheap to compute (sorted
copy of the 90-sample window once per second, not per frame).

#### Chunk-generation timing is uninstrumented
[src/chunks.js:235-238](../src/chunks.js#L235) — comments acknowledge that a
heavy chunk *can* stall. We don't measure which chunks. Forest chunks at
80 trees × ~5 sub-meshes + colliders + campsites are the prime suspects.

**Fix:** wrap `this._generate(c.cx, c.cz)` in `performance.now()` and
expose a rolling "slow chunk" stat on the backtick HUD. Console-warn if
generation takes > 8ms. This is **purely instrumentation** — no behavior
change, but it lets us decide whether multi-phase chunk gen is justified
(currently it isn't).

#### Bubble allocation per spawn
[src/bubbles.js:273](../src/bubbles.js#L273) — `new THREE.Vector3(0,1,0)`
inside `_writeInstance`. It's per-spawn, not per-frame per-bubble, so the
GC pressure is "40 spawns/sec × 1 alloc = 40/sec" which is minor. Still a
one-line fix: hoist a `_axisY` instance field.

#### Per-frame collider list allocation
[src/main.js:525-553](../src/main.js#L525) — `npcColliders = []` and the
spread-rest `allColliders` array rebuild every frame. With ~1500 entries
combined across the spread, that's ~25-30 allocations per frame plus a
fresh per-NPC `{position: {x,y,z}, ...}` literal in the broadphase. Not
catastrophic, but it's hot-path GC pressure.

**Fix:** reuse `_npcColliderScratch` array. Don't synthesize `{position}`
objects for NPCs — pass `n.pos` directly (NPCs' `.pos` is already a
`Vector3`). The spread can become an explicit pre-sized loop. Probably
the smallest win in this list but it composes with the other CPU cleanups.

### ⚠️ Real, but ROADMAP already has the right plan

#### Forest draw calls are high
[src/forests.js:759-765](../src/forests.js#L759) — the 80-trees-per-chunk
comment ChatGPT quoted.

> **Correction (2026-05-28, after ChatGPT round 2):** my first reading of
> this said "materials are pooled, so three.js batches by material" — that
> conflated two things. three.js *sorts* render items by material to reduce
> GL state changes; it does **not** merge separate `Mesh` objects into one
> draw call. Each `Mesh` in the scene is its own draw call regardless of
> shared material. So ChatGPT's "~3600 draws/frame in forests" math is
> closer to right than my pushback. Material pooling still wins on memory
> + shader-program count + state-change cost between sorted draws, but
> it does not collapse the draw-call total. This changes the priority
> of the forest fix — see updated ordering below.

What's actually pooled: 7 trunk + 7 foliage materials in
[src/models/tree.js:22-31](../src/models/tree.js#L22). Geometries are *not*
pooled — each tree allocates fresh `CylinderGeometry` / `IcosahedronGeometry` /
`ConeGeometry`. So we pay both: many draw calls *and* many geometry buffers.

**ROADMAP already lists:**
- "Geometry merging at chunk completion" — `BufferGeometryUtils.mergeGeometries`
- "LOD on distant trees / tents" — billboard swap beyond ~60m
- "Forest tree count on low tier" — per-tier density

The right move is to ship the **geometry merging** path before reaching for
full instancing. Per-chunk merge collapses 80 trees × ~5 sub-meshes into
~14 merged buffers (one per material), preserving culling and disposal
semantics. Instancing across chunks is harder because chunks load/unload
independently.

**Action:** promote "Geometry merging at chunk completion" from ROADMAP into
this perf pass. **Priority is now conditional** — see "Phase ordering after
instrumentation" at the bottom.

#### MSAA at pixelRatio 2 on high is expensive
[src/main.js:89](../src/main.js#L89) — `useMSAA = PERF.name === 'high'`. The
combination IS expensive. ChatGPT's "turn MSAA off everywhere" overshoots —
**pixel ratio cap is the right knob first**. Keep MSAA on high.

> **Correction (round 2):** my prose here was muddled — I wrote "cap high
> to 1.5" in this section and then "drop high from 2 to 1.75 behind a
> flag" further down. They're not the same plan. The reconciled
> recommendation is below.

**Reconciled action:** keep `high.pixelRatioCap: 2` (preserve default look).
Make the adaptive ladder do the work:
```
adaptive baseline:   pixelRatioMul 1.0   (effective dPR 2 on Retina)
adaptive first drop: pixelRatioMul 0.875 (effective 1.75)
adaptive second:     pixelRatioMul 0.75  (effective 1.5)
adaptive third:      pixelRatioMul 0.5   (effective 1.0)
```
That preserves the sharp default while reacting earlier when the browser
struggles. Keep MSAA on high — when adaptive drops pixel ratio to ≤1.5,
MSAA's cost falls proportionally and it stays worth keeping.

ROADMAP "Antialias off + FXAA pass on mid/low tiers" — **already shipped**
([src/main.js:89-134](../src/main.js#L89)). The mid/low path already uses
FXAA, contrary to ChatGPT's first reading. Remove the stale ROADMAP bullet
when this pass lands.

#### Bubble MeshPhysicalMaterial is expensive
[src/bubbles.js:30-49](../src/bubbles.js#L30) — transmission + transparent +
DoubleSide + iridescence + sheen, up to 600 instances. ChatGPT's right that
it's pricey. But this is also **the visual identity** of the bubbles — the
iridescent glint catching evening light is part of the toy.

**Compromise:** keep `MeshPhysicalMaterial` on high; switch mid/low to a
cheaper variant (no `iridescence`, no `sheen`, `FrontSide` only). The pool
size is already tier-aware (`bubblePoolMax`: low 200 / mid 350 / high 600)
so the high-cost path is naturally bounded.

### ❌ Things I disagree with

#### "Reduce high.pixelRatioCap to 1.5 unconditionally"
The 2x cap on high is **intentional** — this game is meant to look sharp on
the Macs Gary tests on, and bringing it down to 1.5 trades a real and
visible quality hit for an unmeasured perf gain. The adaptive ladder is the
right place to react when high is too expensive on a *particular* machine,
not the static default.

**Counter-action:** make adaptive's first step `pixelRatioMul: 0.875` (close
to 1.75 on Retina). That gives us most of ChatGPT's win — when actually
needed — without preemptively dimming the default.

#### "Make bubbles cheap by default"
See above — keep fancy on high, drop on mid/low.

#### "Generate heavy chunks in phases"
The current `BUDGET_PER_FRAME = 1` already spreads load. Multi-phase would
add complexity (suspended chunk state, partial-render artifacts at chunk
boundaries) we haven't justified. **Instrument first, decide after.**

#### "Three-mesh-bvh, lookAt caching"
Not in ChatGPT's suggestions; flagging for completeness — these are on the
won't-do list in [rules/performance.md](rules/performance.md). Don't
re-propose.

---

## Priority-ordered execution plan

Each phase is a separate commit. Order is "biggest-impact-per-line-of-code
first" with phases that *enable measurement* up front so we don't fly blind
on the structural changes.

### Phase 1 — Instrumentation (commit gate: numbers visible)
- Wrap `_generate` calls in `chunks.js` with `performance.now()`. Track:
  - Slowest single chunk gen this session (ms, kind)
  - Count of chunks > 8ms
  - Average chunk gen ms
- Track frame-time metrics in `adaptiveQuality.js` over the 90-frame
  window — **all three, not just p95** (Gemini caught that p95 at
  WINDOW=90 catches sustained jitter, not single hitches):
  - `avg`     — overall feel
  - `p95`     — sustained jitter (≈86th sorted sample, ≈5+ bad frames
                in window)
  - `max`     — single-frame hitches (chunk-load stutters)
- Surface all of them + the chunk metrics on the backtick HUD.
- **No behavior change.** This phase justifies (or doesn't) the branched
  ordering for phases 4–7.

### Phase 2 — Adaptive quality fixes (commit gate: smoother degrade)
- Re-order `QUALITY_LEVELS` to demote pixel ratio first. Encode bubble
  quality as a per-level property (`bubbles: 'fancy' | 'cheap'`) so
  phase 3's `onLevelChange` hook can read it without inferring from
  level name. Proposed ladder:
  ```js
  { name: 'baseline',    pixelRatioMul: 1.0,   bubbles: 'fancy' },
  { name: 'pixel-87',    pixelRatioMul: 0.875, bubbles: 'fancy' },
  { name: 'no-bloom',    pixelRatioMul: 0.875, bubbles: 'fancy',
    bloom: false },
  { name: 'pixel-75',    pixelRatioMul: 0.75,  bubbles: 'fancy',
    bloom: false },
  { name: 'cheap-bubs',  pixelRatioMul: 0.75,  bubbles: 'cheap',
    bloom: false },
  { name: 'no-shadows',  pixelRatioMul: 0.75,  bubbles: 'cheap',
    bloom: false, shadows: false },
  { name: 'pixel-50',    pixelRatioMul: 0.5,   bubbles: 'cheap',
    bloom: false, shadows: false },
  ```
- RAISE_FRAME_MS 15 → 18.
- Add p95 + max spike triggers:
  - DROP if `avg > 22ms` (lowered from current 24) OR `p95 > 33ms`
    sustained over SUSTAIN_FRAMES.
  - DROP single-step on `max > 80ms` lasting more than 1 frame
    (a real hitch, not a single GC pause) — *only* if not already at
    the lowest level.
- RAISE only when all of: avg < 18, p95 < 22, max < 33 — so spikes
  block restoration even when avg looks fine.

### Phase 3 — Bubble cleanups (small, low-risk)
- Hoist `_axisY` in `Bubbles` constructor.
- Tier-gate bubble material: high keeps `MeshPhysicalMaterial`; mid/low get
  a cheaper `MeshStandardMaterial` (or `MeshPhongMaterial`) with a hand-tuned
  transparent path. No `iridescence`, no `sheen`, `FrontSide`.
- **Adaptive bubble degrade — pre-built materials, no on-the-fly compile.**
  Gemini caught a real footgun: constructing a `MeshPhysicalMaterial` vs.
  `MeshStandardMaterial` at adaptive-downgrade time would itself cause a
  shader compile and a visible hitch — *during a performance crisis*, which
  is the worst time. Instead:
  - Build `_matFancy` and `_matCheap` both in the `Bubbles` constructor.
  - Warm both at boot (a single offscreen render with the cheap material
    suffices, since the fancy one renders the first frame anyway).
  - Expose `Bubbles.setCheapMaterial(on)` that flips
    `this.mesh.material = on ? _matCheap : _matFancy`. No `dispose()`,
    no construction.
  - Encode the bubble quality bit as a property of each adaptive level
    instead of keying it implicitly off "past no-shadows" — see phase 2.
- **Wire `onLevelChange` in main.js.** The module supports
  `onLevelChange?.(newLevel, lvl)` ([src/adaptiveQuality.js:119](../src/adaptiveQuality.js#L119))
  but the call site at [src/main.js:275](../src/main.js#L275) doesn't pass
  one. Add it:
  ```js
  AdaptiveQuality.install({
    renderer, scene, composer, bloomPass, hud: HUD,
    onLevelChange: (_level, lvl) => {
      bubbles.setCheapMaterial(lvl.bubbles === 'cheap');
    },
  });
  ```

### Phase 4 — Collision hot-path cleanup
- Reuse `_npcColliderScratch` array between frames.
- Stop synthesizing `{position: {x, y, z}}` literals in the broadphase;
  pass `n.pos` (already a Vector3) or a pre-existing scratch object pool.
- Build `allColliders` via explicit loop into a reused scratch array, not
  spread-rest of 8 sources every frame.

### Branch point — pick path 4A or 4B from phase 1 metrics

> Gemini pointed out the "Phases 4–7 are conditional" wording was
> editorially mushy. Concrete branches:

**Path A — Forest-first** (pick if phase 1 shows high `max` frame ms
correlated with chunk-load events, or low FPS standing still inside a
forest at `?perf=high&adaptive=0`):

- **Phase 4A — Forest chunk geometry merging.** See spec below.
- **Phase 5A — Registry spatial grid.** See spec below.
- **Phase 6A — Crowd spatial grid.** See spec below.
- **Phase 7A — Collision scratch cleanup.** See spec below.

**Path B — Crowd-first** (pick if phase 1 shows high `p95` correlated
with dense-crowd zones, but `max` and chunk-gen ms look clean):

- **Phase 4B — Crowd spatial grid.**
- **Phase 5B — Registry spatial grid.**
- **Phase 6B — Collision scratch cleanup.**
- **Phase 7B — Forest geometry merging** — only if HUD draws/tris are
  still over budget after phases 4B–6B.

**If both A and B symptoms present:** use Path A. The geometry merge fixes
one allocation spike per chunk load *and* reduces steady-state draws; the
sim-side spatial grids are pure wins after that.

### Phase specs (apply in whichever path the branch picked)

#### Forest chunk geometry merging
- After a forest chunk's content is placed, walk its subtree, group meshes
  by `(material, castShadow)` — Gemini's note: don't flatten castShadow
  across the merge or trunk shadows get lost. The tree.js per-cone /
  per-bump castShadow decisions
  ([tree.js:111, 142, 187](../src/models/tree.js#L111)) need to survive.
- For each bucket, call `BufferGeometryUtils.mergeGeometries`.
- **Bake each mesh's transform into a cloned geometry before merge** — this
  is the classic footgun Gemini flagged. Sketch:
  ```js
  // ensure transforms are current
  mesh.updateWorldMatrix(true, false);
  // bake the mesh's transform RELATIVE TO THE CHUNK GROUP, not world —
  // the merged mesh will be attached under the chunk group at identity,
  // so we want chunk-local coords. tree positions are already chunk-local
  // (tree.position.set(x, z) where x,z are world coords minus chunk origin),
  // so mesh.matrix (NOT matrixWorld) is what we want here.
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrix);
  bucket.push(g);
  ```
  After merge, attach the merged mesh to the chunk group at identity. If
  in doubt, screenshot the forest at `?entity=` for a single chunk and
  verify trees aren't stacked at origin or rotated wrong.
- Replace the per-tree meshes with the merged ones. Keep
  `userData.shared = false` on the merged buffers — they're per-chunk and
  must dispose on chunk unload.
- Cost: one one-shot CPU pass at chunk finalization. Should turn ~400
  forest meshes/chunk into ~14-28 merged meshes (one per material ×
  castShadow bool).
- Defer LOD billboards (separate ROADMAP item, follow-on perf pass).

#### Spatial hash: crowd separation
- New `SpatialGrid` class (cell-size = `SEPARATION_RADIUS`, ~2-3m).
- Build per-frame from `this.npcs` before the update loop.
- Replace `for (const other of this.npcs)` in `_updateNpc` separation block
  ([crowd.js:812](../src/crowd.js#L812)) with a 9-cell query
  (current + 8 neighbours).
- Measure on `?perf=high&adaptive=0` standing in a crowded zone.

#### Spatial hash: registry footprints
- Add `Registry._footprintGrid` (cell size ~8m, larger than NPC grid).
- Build on `registry.add` / invalidate on `registry.remove`.
- Expose `registry.footprintsNear(pos, radius)` generator.
- Switch `nearestFootprintAvoidance` in
  [crowd.js:1395](../src/crowd.js#L1395) to use it.
- Since `forest_tree` is NOT in the existing kind-skip and they dominate
  the per-NPC scan, the win here is largest in forests specifically.

#### Collision scratch cleanup
- Reuse `_npcColliderScratch` array between frames in
  [main.js:525](../src/main.js#L525).
- Stop synthesizing `{position: {x, y, z}}` literals; pass `n.pos`
  (already a Vector3).
- Build `allColliders` via explicit loop into a reused scratch array, not
  spread-rest of 8 sources every frame.

### Phase 8 — Optional `ultra` tier (deferred, visual decision)
- Add an `ultra` tier (1080p+, dPR cap 2, full bubbles) **separately** from
  `high` — for users who want to "make my MacBook sweat."
- Leave `high.pixelRatioCap: 2` as-is. Adaptive ladder (phase 2) does the
  reactive work.
- Verify with Gary before shipping — this is a config decision, not a
  perf measurement.

---

## Verification matrix (per phase)

| Test URL | What to check |
|---|---|
| `?perf=high&adaptive=0` | Steady-state baseline; can't blame adaptive for masking the symptom |
| `?perf=mid&adaptive=0` | Confirms mid still ships under budget |
| `?perf=low&adaptive=0` | Catches the threeShim-Lambert / module-freeze class of bugs |
| `?perf=high` (adaptive on) | Confirms new adaptive ladder degrades gracefully |
| Backtick HUD | Draws + tris stay within per-tier budgets (low 80/150k, mid 200/400k, high 400/1.2M) |
| Slow-chunk counter (phase 1+) | Confirms forest chunks fall under 8ms after phase 7 |
| `preview_screenshot` at Noon + Midnight | Visual regression check, especially for bubble + forest changes |

---

## ROADMAP touches when this lands

When shipping any phase, also do:
- **Remove** "Antialias off + FXAA pass on mid/low tiers" — already done,
  shouldn't be on the list. (Pre-existing ROADMAP cleanup, regardless of
  this pass.)
- **Trim** "Crowd InstancedMesh churn" to be specifically about the
  matrix-write churn, not sim cost (phase 5 covers the latter).
- **Remove** "Geometry merging at chunk completion" when phase 7 ships.
- **Move** ChatGPT-flagged items NOT in this pass (e.g. instanced
  cross-chunk forests, LOD billboards) onto ROADMAP if they aren't already.

CHANGELOG: each phase that ships gets its own dated `### Performance` block
under [.claude/rules/changelog-and-roadmap.md](rules/changelog-and-roadmap.md)'s
voice rules. Cite the file:line of the fix and the budget number that moved.
