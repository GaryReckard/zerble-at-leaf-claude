# Perf — pooling + dispose-safe shared resources

The project pools geometries and materials aggressively. The pattern matters
because chunks load and unload constantly; if a pooled resource gets disposed
when its host chunk unloads, every other chunk still referencing it forces a
shader recompile and stalls the frame.

## Convention: `userData.shared = true`

Any geometry or material hoisted to module scope and reused across calls must
be tagged:

```js
const SHARED_TRUNK_GEO = new THREE.CylinderGeometry(0.3, 0.3, 4, 8);
SHARED_TRUNK_GEO.userData.shared = true;

const SHARED_BARK_MAT = new THREE.MeshStandardMaterial({ color: 0x6a4a30 });
SHARED_BARK_MAT.userData.shared = true;
```

Chunk and lake disposal walks skip entries with this flag. Without it, the
first chunk-unload after the pool was used will dispose the shared resource
and break every other chunk that referenced it.

## Where to look for existing pools

- `src/models/sugarShack.js` — `SHACK_MATS`, `STRING_BULB_GEO`, `SUPPLY_CAN_GEO`
- `src/models/campsite.js` — `matFor()` color-keyed material cache, tiki +
  chair pools
- `src/models/puppet.js` — NPC geometry pool + color-keyed material cache used
  by every band member, kid, wook, performer, parasol marshal
- `src/models/foodTruck.js` — shared body geometries + color-keyed material
  cache

Model these patterns when adding new pooled resources.

## When to reach for pooling

Per the threejs-materials skill: reuse materials = batched draw calls. Per
threejs-geometry: reuse geometry buffers = lower GPU memory + lower upload
cost.

Reach for it when:

- A model spawns repeatedly (every chunk, every NPC, every campsite).
- The variation is in **transform**, not in geometry topology.
- Color variation can be expressed as a small set of buckets — pool one
  material per bucket.

If the variation is per-instance and the count is high (bubbles, crowd,
string lights, bench-ring logs), reach for `InstancedMesh` instead.

## InstancedMesh gotcha

After updating any instance matrix, `mesh.instanceMatrix.needsUpdate = true`.
Frozen instances usually mean a missed flag flip.

## Don't reflexively `castShadow = true`

The shadow audit (see `.claude/perf-audit-plan.md`) cut shadow casters from
115 → 56 by stripping small detail meshes. Don't reintroduce them. Cast
shadows for:

- Tent roofs, main walls
- Large body capsules (Zerble chassis, big puppets, the band's body trunks)
- Banners, signs facing the player
- Tree crowns

Don't cast for tent poles, sign brackets, lamppost shafts, NPC limbs, chair
parts, firepit stones, raffia, mustache hair strands, or any small detail that
won't read as a distinct shadow shape.

## Before declaring perf work done

Open the backtick (`` ` ``) debug overlay. Confirm:

- Draws stay under the per-tier budget (low 80 / mid 200 / high 400).
- Tris stay under the per-tier budget (low 150k / mid 400k / high 1.2M).
- Geometry + texture counts haven't ballooned.

Test on `?perf=low` and `?perf=mid` too — the high-tier numbers can mask
regressions that crush integrated GPUs.
