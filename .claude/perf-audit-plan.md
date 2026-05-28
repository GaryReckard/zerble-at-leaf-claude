# Perf audit + plan — applying threejs-* skills

## Skill takeaways (relevant to this codebase)

| Skill | Most-relevant guidance |
|---|---|
| **fundamentals** | Pixel ratio matters a lot; cap on retina helps |
| **geometry** | Reuse geometries; cut segment counts; dispose on unload |
| **materials** | Reuse materials (batched draws); avoid transparency; simpler material > standard |
| **textures** | POT sizes; cap at 1024 on most things; reuse textures |
| **lighting** | Limit lights; smaller shadow maps; tight frustum; selective shadows |
| **postprocessing** | Each pass = full-screen render; disable unused; half-res blur targets |
| **animation** | Off-screen culling; cache clips; limit active mixers |

## Audit findings

| Finding | Count / detail | Severity |
|---|---|---|
| `castShadow = true` across codebase | 115 instances | HIGH — many on small detail meshes nobody will notice |
| `new THREE.MeshStandardMaterial` calls | 213 instances | MED — campsite uses `matFor` cache; Sugar Shack/puppet/tent do not |
| Geometry primitive creations | 231 instances | MED — Sugar Shack creates many per-build, no shared constants |
| Sun shadow map size | 1024×1024 | OK — could be 512 on low |
| Trip ShaderPass | Always in composer chain | MED — runs a full-screen pass even when intensity = 0 |
| Bloom pass | Already half-res | OK |
| Crowd | Uses InstancedMesh already (per comment) | OK |
| Sugar Shack textures | Some at 2048×512 | LOW — texture cost is one-time, the size mostly affects memory not FPS |

## Plan (in priority order)

### Phase 1 — shadow audit (biggest FPS win)

Cut `castShadow = true` from small detail meshes. Sun shadow map render redraws EVERY shadow caster every frame; smaller objects don't appear distinct in shadow anyway.

**Targets to flip to false:**
- Sugar Shack: tent poles, ridge post, facade posts, brackets, sign boards (banner/plank/side panels), grill stations, supply cans, head/dome (work lights), worker sub-meshes other than torso/head
- Campsite: chiminea bowl, ring stones, tiki torch poles/cups (keep flame's shadow off — it's emissive anyway)
- Other models: skim for similar small details

Goal: 115 → ~30-40.

### Phase 2 — Trip pass enable/disable

Set `Trip.pass.enabled = false` when `intensity === 0`. Currently the pass runs every frame as a no-op fragment shader, but it's still a full-screen render+sample.

### Phase 3 — Sugar Shack material/geometry pooling

Hoist hot materials + geometries to module-level constants. Reduces per-build allocation cost (only matters when shacks spawn, not steady-state FPS).

- Shared materials: `woodMat`, `darkMat`, `chromeMat`, `whiteMat`, `poleMat`, `facadePoleMat`, `counterBoardMat`, `counterTopMat`, `stationMat`, `grillTopMat`, `supplyMat`, `bulbMat`
- Shared geometries: pole box (POLE_T × WALL_H × POLE_T), bulb sphere (0.07), can cylinder (0.12 × 0.32)

### Phase 4 — Tier-aware lights

For lights that DO stay (sun, Zerble headlight, forest drum-circle fire, stage):
- Shrink sun shadow map on low tier (512 instead of 1024) — already shadows off, so moot, but mid uses basic shadows at 1024
- Verify zerble headlight/disco don't cast shadows themselves (waste)

### Phase 5 — Bonus polish

- `mountains.js` — many static hills. Confirm `castShadow` is off (they're far backdrop)
- World ground plane shadow: receiveShadow but not castShadow (correct)
- Confirm bubble InstancedMesh — already done
- Add `renderer.info` debug log behind a flag so we can measure draw calls

### Phase 6 — Documentation

Update ROADMAP.md to capture findings + what we left for later (LOD, frustum culling, mesh merging on chunk completion).

## Done criteria

- Default high tier should be playable (≥30 FPS on a typical Retina display)
- No visible degradation (a casual player shouldn't notice shadow cuts)
- All changes behind explicit comments referencing the skill that motivated them

## What shipped

### Phase 1 — shadow audit ✅
- `castShadow = true` count: **115 → 56** (-51%, ~60 shadow-map draws saved every frame)
- Targets cut: tent/facade poles, sign boards, brackets, grills, stations, supply cans, dome lights, NPC legs/arms/shoulders/hair detail, Lurleen raffia strands (was casting 280-560 per cart!), camp chair seats/backs, chiminea bulb+stack, firepit stones, tiki torch poles, tapestry posts, drum-circle stones, food-truck canopy, canoe tips, hammock posts, kid arms, performer arms/legs, wook arms/dreads, tribal figure legs/wrap/wig/ponytail, parasol wedges, stage speakers, tentStage poles, lamppost cylinders, leafDrumCircle bench logs + cone logs + rim stones, Zerble seats/floorboard/oh-bar/roof poles/driver head/driver mustache/mustache hair strands
- Kept: tent roofs, main walls, large body capsules, banners, tree crowns, chassis main bits, wheels

### Phase 2 — Trip pass enable/disable ✅
- `this.pass.enabled` now flips with envelope > 0.001
- Saves a full-screen render every frame when nobody's tripping

### Phase 3 — Sugar Shack material/geometry pooling ✅
- 20+ `MeshStandardMaterial` allocations per shack → **1 shared `SHACK_MATS` object** at module level
- String-bulb sphere geometry: 20 allocations per shack → **1 shared `STRING_BULB_GEO`**
- Supply-can cylinder: 5 per shack → **1 shared `SUPPLY_CAN_GEO`**
- Per threejs-materials skill: "Reuse materials = batched draw calls"

### Phase 4 — Tier-aware shadow map ✅
- Was: fixed 1024 × 1024 regardless of tier, shadowD = 100 hardcoded
- Now: 1024 on high, 512 on mid (low has shadows off); shadowD = 100 on high, 60 on mid (tighter frustum = more resolution per texel for the smaller map)

### Deferred to ROADMAP

- LOD on distant trees / tents (replace high-poly with billboards beyond 60m)
- Frustum-based update gating (don't tick NPCs / animations when off-screen)
- Geometry merging on chunk completion (massive draw-call reduction)
- Texture mipmap audit
- Other models that have lots of identical materials but no caching yet (puppet.js, foodTruck.js, tent.js — ~50 fresh allocations between them)
