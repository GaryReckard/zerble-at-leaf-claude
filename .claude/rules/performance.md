# Performance — principles, priorities, gotchas

Three perf passes have already shipped (see CHANGELOG "Performance (pass 1/2/3)"
and the audit docs at `.claude/perf-audit-plan.md` + `.claude/perf-pass-2-plan.md`).
The *what* of each fix lives there. This file is the *how to think about it
next time* — the priority ordering, the mental model, and the gotchas worth
internalizing before touching graphics code.

The canonical source for the priority list is the r/threejs
"how to optimize for low-end computers" thread:
<https://www.reddit.com/r/threejs/comments/skk0f3/how_to_optimize_project_for_lowend_computers/>.
The shipped passes followed it almost directly.

## Audit order (highest-impact first)

When approaching a perf task, audit in this order. Earlier phases unlock
clarity on later ones.

| # | Audit | Why first |
|---|---|---|
| 1 | **`renderer.info` overlay** (already in backtick HUD) | You can't tune what you can't see. Open the panel; read draws / tris / geometries / textures / heap. **Always start here.** |
| 2 | **Shadow casters** | `castShadow = true` redraws every caster every frame from the sun's POV — by far the highest per-frame multiplier. Pass 1 dropped 115 → 56 and saved ~60 draws/frame. |
| 3 | **Dispose-safety on pooled resources** | Long-session stability. A mis-disposed shared material storms shader recompiles. Tag `userData.shared = true`; the chunk/lake unloaders skip those. |
| 4 | **Post-process pass gating** | Each pass is a full-screen render+sample. The Trip pass had to learn `pass.enabled = false` when envelope == 0. Apply the same pattern to any new pass. |
| 5 | **InstancedMesh + variant buckets** | One draw call replaces N. Sugar Shack string bulbs (20 → 1), drum-circle benches (~45 → 2). Use it when the same geometry repeats per chunk/per cluster. |
| 6 | **Material + geometry pooling** | Allocation-time win, not steady-state. Matters during chunk spawns; not during quiet driving. See `.claude/rules/perf-pooling.md`. |
| 7 | **Pixel ratio + AA strategy** | MSAA at ratio 2 is brutal on integrated GPUs. Mid/low get `antialias: false` + FXAAPass instead. |
| 8 | **Texture sizes** | One-time memory cost, **not** an FPS issue unless you're memory-bound. Cap at 1024 (iOS > 2048 crash risk). Don't sweat 2048 unless symptoms point at memory. |

If a phase doesn't move the needle on the HUD numbers, **stop optimizing
there and move to the next.** Don't pre-optimize categories the budget panel
says are fine.

## Allocation cost ≠ steady-state cost

These are different bugs with different symptoms — diagnose accordingly.

- **Allocation cost** shows as **frame stalls** when something spawns (a new
  chunk crosses the load ring, a campsite materializes, the first Sugar Shack
  appears). Fixed by pooling, budgeting (1 chunk/frame), and disposal
  safety.
- **Steady-state cost** shows as **low baseline FPS** even while parked.
  Fixed by shadow audit, post-process gating, instancing, AA strategy.

Pooling does almost nothing for steady-state FPS; the shack already built.
Shadow audits do almost nothing for the spawn-stall on boost into new
territory. Match the fix to the symptom.

## Heuristics + rules of thumb

### "Tighter frustum > smaller shadow map"

When reducing shadow cost on lower tiers, don't *just* drop the map
resolution (1024 → 512). Also tighten the sun's orthographic frustum
(`shadowD` from 100 → 60). A smaller map covering a smaller area is *sharper
per texel* than a smaller map covering the same area. The mid-tier shadow
config does both deliberately.

### "Small detail meshes don't appear distinct in shadow anyway"

Tent poles, sign brackets, lamppost shafts, NPC limbs, raffia strands, chair
parts, firepit stones, mustache hairs — they all *could* cast shadows but
players can't tell them apart from the larger object's shadow. **Don't cast
shadows from small detail.** Cast only from: tent roofs, main walls, large
body capsules, banners facing the player, tree crowns, chassis main bits,
wheels. The 56 remaining casters are roughly that list.

### "Avoid transparent. Prefer alphaTest. Opaque > both."

Transparent objects force three.js to sort every frame and expand the
depth-test work. If the texture is essentially binary-masked (a tiki flame, a
leaf cutout, signage with text on alpha) use `alphaTest: 0.5` on a regular
Lambert/Standard instead. You lose smooth edges; you gain a lot of perf.
Reserve true transparency for genuinely translucent things (bubbles, glass,
volumetric).

### "Emissive doesn't cast shadows."

Self-illuminating materials (campfires, tiki flames, stage lights,
bulb-emissive shaders) are additive-final. They contribute light *visually*
but they aren't `Light` objects — no shadow caster, no `castShadow` knob
worth flipping. If you want shadows *from* a fire, add a `PointLight` (gated
by `PERF.contextLights`, `castShadow = false` for cheapness).

### "One light per cluster, not one per element."

Campsites have one PointLight at the firepit, not one per torch. Sugar
Shacks have three lights total (two work spotlights + one interior), not one
per string-light bulb. Drum circles have one fire light, not one per
torchlit dancer. Lights are expensive; clusters look fine with a single
proxy.

### "Cap pixel ratio. Don't trust devicePixelRatio."

`renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERF.pixelRatioCap))`.
Retina iPhones report 3.0; rendering at 3× over a 1170-pixel-wide screen is
~10M pixels per frame at the canvas alone. Cap at 1.0 / 1.5 / 2.0
(low/mid/high). Adaptive quality can drop further at runtime.

## Footguns / no-nos

### Don't `THREE.X = Y` after import

ES module namespaces are frozen. Safari mobile (and any spec-strict runtime)
throws "Cannot assign to property of [object Module]" on
post-import reassignment. The whole boot dies. If you need a tier-aware
override of a three.js export, do it via the `'three'` importmap entry
pointing at `src/threeShim.js`, the same way the MeshStandardMaterial swap
works. See the comment block at the top of `threeShim.js`.

### Don't dispose without the `userData.shared` check

```js
// Safe disposal walk in chunk/lake unload
obj.traverse((n) => {
  if (n.geometry && !n.geometry.userData.shared) n.geometry.dispose();
  if (n.material && !n.material.userData.shared) n.material.dispose();
});
```

A mis-disposed shared material **doesn't crash** — it silently triggers a
shader recompile the next frame any other chunk uses that material. Recompile
storms (50+ in a frame) show up as periodic ~200ms stalls that look like GC
pauses. They're not GC.

### Don't reflexively `castShadow = true` on new meshes

It's `false` by default for a reason. Adding a new model? Default everything
to off. Turn on only the meshes whose shadow shape would actually read
distinctly on the ground. The audit drove the count from 115 → 56; don't
walk it back.

### Don't add transparency to InstancedMesh without considering sort cost

Sorting transparent instances per-frame is much worse than sorting
non-instanced transparent meshes (the GPU can't depth-sort within a single
draw call). If you need translucency on instances, see if `alphaTest` works
first.

### Don't try to optimize before you've measured

Open the backtick debug panel. **Read the budget markers.** If draws/tris
are green (`ok`), the next perf pass is wasted work. The HUD shows per-tier
budgets (low 80/150k, mid 200/400k, high 400/1.2M) precisely so you don't
need to guess.

### Don't ship a perf change without checking `?perf=low` and `?perf=mid`

High tier hides regressions that crush integrated GPUs. The threeShim
Lambert swap, the FXAA-not-MSAA branch, and the chunk-load budget all exist
because something looked fine on high and was broken on low/mid. Verify the
quiet tiers.

## When perf work stops being worth it

Diminishing returns hit fast in three.js. If the budget panel is green at
the tier you care about, **declare done.** Don't chase another 5% if it adds
complexity to a system that has to stay readable. The "boil the ocean" rule
applies to *correctness* — not to perf. Perf is bounded by what the player
can perceive on the target device.

## Open items deferred to ROADMAP

The perf passes deferred a few things explicitly (see ROADMAP "Performance"
section): LOD on distant trees/tents, geometry merging at chunk completion,
texture mipmap audit, light-layers for the Sugar Shack work spots,
variant-bucketed InstancedMesh for tiki torches + chairs. These were
considered and parked, not missed. Don't re-propose them as "obvious next
wins" without checking ROADMAP first — Gary has thought about each.

The won't-do list: three-mesh-bvh (no raycast bottleneck here) and lookAt
caching (no hot path). Don't suggest these.
