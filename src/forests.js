// Forests — dense clumps of taller trees that Zerble cannot drive through.
//
// Forests are pinned to the chunk grid (NOT a parallel macrocell system like
// lakes). A forest is a 3x3 chunk block: one "center" chunk plus its 8
// neighbours. Within every 5x5 chunk block we deterministically decide
// whether the center chunk (at offset 2,2) hosts a forest. That guarantees
// at least 2 chunks of clear space between any two forests' 3x3 footprints.
//
// Some forests have a path entry on one cardinal side leading to a clearing
// at the forest's center. Those clearings will (in a later phase) host the
// big LEAF-true drum circle. For Phase 1 we only place dense trees + a ring
// of edge colliders with a gap on the path side.
//
// Everything here is pure-hash deterministic — no per-frame manager, no
// loaded-state. chunks.js calls `getForestAt(cx, cz)` while generating each
// chunk; if non-null, `buildForestChunk(ctx, forest)` takes over from the
// theme system.

import * as THREE from 'three';
import { registry } from './registry.js';
import { hash2, mulberry32 } from './rng.js';
import { CHUNK_SIZE, buildCurvedPath } from './chunks.js';
import { buildForestTree } from './models/tree.js';
import { buildCampsite } from './models/campsite.js';
// `chunkInLake` is misleadingly named — it's a generic point-in-lake test
// that takes any world (x, z). We reuse it for both "is this chunk center
// in a lake" and "is this arbitrary perimeter point in a lake".
import { chunkInLake } from './lakes.js';

// Per-frame animatable props from campsite contents. Each entry:
//   { campsite: { animatables: [...] }, chunkKey: string }
// chunks.js _unload sweeps this list by chunkKey alongside its other
// per-chunk teardown.
export const forestAnimatables = [];

const FOREST_BLOCK = 5;                 // every 5x5 chunks can host one forest center
const FOREST_PROBABILITY = 1.0;          // ~1 forest per 5x5 block — dialable
// Interior content split: most forests get a campsite (atmospheric, common),
// some have a drum circle (rare, exciting), some stay deep-and-empty (mysterious).
// Sum to 1.0; tweak ratios to balance discoverability vs novelty.
const P_DRUM_CIRCLE = 0.25;
const P_CAMPSITE    = 0.60;
const P_EMPTY       = 1 - P_DRUM_CIRCLE - P_CAMPSITE;  // 0.15
const ORIGIN_SAFE_BLOCKS = 1;            // skip forests whose center is within this many 5x5-blocks of (0,0)

const DIRECTIONS = ['N', 'E', 'S', 'W'];

// Returns a forest descriptor for the chunk at (cx, cz), or null if this
// chunk isn't part of any forest. The descriptor identifies the forest's
// center, this chunk's role in the 3x3, and forest-wide attributes.
//
// Pure-hash: same (cx, cz) always returns the same answer. Cheap enough to
// call freely (a couple of hash + branch ops, no allocation in the null path).
export function getForestAt(cx, cz) {
  // Which 5x5 block does this chunk belong to? The block's center chunk is
  // at (bx*5 + 2, bz*5 + 2). We compute by shifting so that center has
  // residue zero, then floor-divide.
  const bx = Math.floor((cx + 2) / FOREST_BLOCK);
  const bz = Math.floor((cz + 2) / FOREST_BLOCK);

  // Center chunk of that 5x5 block
  const centerCx = bx * FOREST_BLOCK + 2 - 2;  // simplifies to bx*5
  const centerCz = bz * FOREST_BLOCK + 2 - 2;
  // ^ Yes that's just bx*5. Spelled out for the next reader. The "+2 -2"
  // documents the offset convention: we shifted cx by +2 above so that the
  // center chunk gets residue zero when floor-divided by 5.

  // Is the requested chunk within the 3x3 around the center?
  const dx = cx - centerCx;
  const dz = cz - centerCz;
  if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return null;

  // Stay away from the main stage (0,0) and a small buffer around it.
  if (Math.abs(bx) <= ORIGIN_SAFE_BLOCKS && Math.abs(bz) <= ORIGIN_SAFE_BLOCKS) return null;

  // Deterministic seed for this forest's properties
  const seed = hash2(centerCx * 73 + 13, centerCz * 91 + 37);
  const rng = mulberry32(seed);
  if (rng() >= FOREST_PROBABILITY) return null;

  // Pre-compute world center
  const centerX = centerCx * CHUNK_SIZE;
  const centerZ = centerCz * CHUNK_SIZE;

  // Skip if the forest center sits in a lake (lakes load before chunks per
  // world.js, so by the time we ask this question, nearby lake footprints
  // are already in the registry).
  if (chunkInLake(centerX, centerZ)) return null;

  // Forest body radius — 90-110m, fits inside the 3x3 = 240m block with margin
  const bodyRadius = 90 + rng() * 20;

  // Also skip if the forest's BODY (not just center) overlaps any lake.
  // Without this, a lake whose center is just past the forest center could
  // still poke through the forest perimeter. We sample a few perimeter points.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (chunkInLake(centerX + Math.cos(a) * bodyRadius, centerZ + Math.sin(a) * bodyRadius)) {
      return null;
    }
  }

  // Pick interior content type from rng. Empty forests have no path/clearing.
  const r2 = rng();
  let interiorContent;
  if (r2 < P_DRUM_CIRCLE) interiorContent = 'drum_circle';
  else if (r2 < P_DRUM_CIRCLE + P_CAMPSITE) interiorContent = 'campsite';
  else interiorContent = 'none';

  const pathDirIdx = Math.floor(rng() * 4);
  const pathDir = DIRECTIONS[pathDirIdx];

  // Drum-circle forests get a SECOND opening on the opposite side: a "back
  // path" connecting the drum circle to a camping meadow that sits in the
  // open corner-chunk zone past the forest body. This way the long path
  // remains the scenic main route to the fire, and the back path is a
  // shortcut from the campsites.
  const backPathDirIdx = interiorContent === 'drum_circle'
    ? (pathDirIdx + 2) % 4   // exactly opposite
    : null;

  const role = roleFromOffset(dx, dz);
  const isPathChunk = isPathChunkForDir(dx, dz, pathDirIdx);
  const hasInterior = interiorContent !== 'none';

  // Build the forest descriptor first so the interior-campsite computer can
  // consult its own path / drum-circle data.
  const forest = {
    centerCx, centerCz, centerX, centerZ,
    bodyRadius,
    role,
    isPathChunk,
    interiorContent,
    // Legacy alias — true if there's a path + clearing of any kind (drum circle or campsite).
    hasInterior,
    pathDir,
    pathDirIdx,
    backPathDirIdx,
    seed,
  };

  // Pre-compute deterministic positions for campsites SCATTERED INSIDE the
  // forest body (not just in the meadow). These are the "littered through
  // the trees" sites Gary asked for. Computed here so scatterForestTrees can
  // skip placing trees on top of them, and buildInteriorCampsites can
  // construct the campsites at the same positions.
  //
  // Empty forests (no interior content) skip this — the body's sealed, and
  // putting campsites inside an unreachable forest is wasteful + boring.
  forest.interiorCampsitePositions = hasInterior
    ? computeInteriorCampsitePositions(forest)
    : [];

  return forest;
}

// Pick positions for campsites scattered THROUGH the forest body's trees.
// Deterministic from the forest seed so the same forest always lays out the
// same. Constraints:
//   - Inside body radius (with a 6m margin off the perimeter)
//   - At least 30m from the drum circle (wide berth around the fire — Gary's
//     ask: "wide birth around the big drum circle")
//   - At least 12m from the central campsite (for campsite forests)
//   - Outside the path corridors (entrance + back path)
//   - Min 14m spacing between any two campsites
// Uses sqrt-distributed radius so placements are uniformly distributed by
// area, not by radius (otherwise everything bunches near the center).
function computeInteriorCampsitePositions(forest) {
  const rng = mulberry32(forest.seed * 199 + 41);
  // Density target: ~5-9 sites inside a 100m-radius body. Smaller body, fewer
  // sites (otherwise they overlap).
  const target = 4 + Math.floor(rng() * 6);  // 4-9 sites
  const drumBuffer = forest.interiorContent === 'drum_circle' ? 30 : 0;
  const centerBuffer = forest.interiorContent === 'campsite' ? 14 : 0;
  const minSpacing = 14;
  const placed = [];

  for (let i = 0; i < target; i++) {
    let chosen = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      // sqrt(rng) gives uniform area distribution (otherwise centre-heavy)
      const r = Math.sqrt(rng()) * (forest.bodyRadius - 6);
      const a = rng() * Math.PI * 2;
      const x = forest.centerX + Math.cos(a) * r;
      const z = forest.centerZ + Math.sin(a) * r;
      const localR = r;

      if (localR < drumBuffer) continue;
      if (localR < centerBuffer) continue;
      if (pointInPathCorridor(x, z, forest)) continue;

      let tooClose = false;
      for (let j = 0; j < placed.length; j++) {
        const dx = placed[j].x - x;
        const dz = placed[j].z - z;
        if (dx * dx + dz * dz < minSpacing * minSpacing) { tooClose = true; break; }
      }
      if (tooClose) continue;

      chosen = { x, z };
      break;
    }
    if (chosen) placed.push(chosen);
  }
  return placed;
}

function roleFromOffset(dx, dz) {
  if (dx === 0 && dz === 0) return 'center';
  // -z is north (matches Three.js conventions used elsewhere here)
  if (dx === 0 && dz === -1) return 'N';
  if (dx === 1 && dz === -1) return 'NE';
  if (dx === 1 && dz === 0) return 'E';
  if (dx === 1 && dz === 1) return 'SE';
  if (dx === 0 && dz === 1) return 'S';
  if (dx === -1 && dz === 1) return 'SW';
  if (dx === -1 && dz === 0) return 'W';
  if (dx === -1 && dz === -1) return 'NW';
  return null;
}

// Returns true if this chunk is the one that should host the forest path
// entrance (and therefore have a gap in its perimeter colliders).
function isPathChunkForDir(dx, dz, dirIdx) {
  if (dirIdx === 0 && dz === -1 && dx === 0) return true; // N
  if (dirIdx === 1 && dx === 1 && dz === 0) return true;  // E
  if (dirIdx === 2 && dz === 1 && dx === 0) return true;  // S
  if (dirIdx === 3 && dx === -1 && dz === 0) return true; // W
  return false;
}

// Public: is the world point (x, z) inside any forest body?
export function pointInForest(x, z) {
  const cx = Math.round(x / CHUNK_SIZE);
  const cz = Math.round(z / CHUNK_SIZE);
  // Forest body can extend up to ~110m, which is 1.4 chunks. Check the
  // 3x3 neighbourhood — any forest body that includes (x,z) must have its
  // center within ~110m of the cx,cz chunk center.
  for (let ddx = -1; ddx <= 1; ddx++) {
    for (let ddz = -1; ddz <= 1; ddz++) {
      const f = getForestAt(cx + ddx, cz + ddz);
      if (!f) continue;
      const dx = f.centerX - x;
      const dz = f.centerZ - z;
      if (dx * dx + dz * dz < f.bodyRadius * f.bodyRadius) return true;
    }
  }
  return false;
}

// Public: does the chunk centered at (cxWorld, czWorld) sit inside any
// forest's 3x3 block? Used by chunks.js to suppress paths + themes.
// Mirrors `chunkInLake` semantics.
export function chunkInForest(cxWorld, czWorld) {
  const cx = Math.round(cxWorld / CHUNK_SIZE);
  const cz = Math.round(czWorld / CHUNK_SIZE);
  return getForestAt(cx, cz) !== null;
}

// ---------- Forest content builder (called from chunks._generate) ----------

// Top-level entry: build this chunk's slice of the forest content.
export function buildForestChunk(ctx, forest) {
  // Edge colliders — only the perimeter ring, distributed across whichever
  // chunks own each arc segment.
  placeForestEdgeColliders(ctx, forest);

  // Trees — dense inside body radius, tapering to a sparse fringe outside.
  // Placed deterministically from the forest seed + chunk offset so that
  // chunk reload doesn't shuffle them.
  scatterForestTrees(ctx, forest);

  // The forest itself registers a footprint (for "is point in forest"
  // questions by other systems like crowd avoidance). Only the center
  // chunk registers it, so we don't have nine duplicates.
  if (forest.role === 'center') {
    registry.add({
      kind: 'forest',
      position: new THREE.Vector3(forest.centerX, 0, forest.centerZ),
      footprint: forest.bodyRadius,
      chunkKey: ctx.key,
    });

    // Center chunk owns the path geometry + the interior content placement.
    // Both are skipped for empty forests — those stay impenetrable.
    if (forest.hasInterior) {
      buildForestPath(ctx, forest);
      buildForestInteriorContent(ctx, forest);
    }
  }
}

// ---------- Forest path geometry ----------
//
// Curved dirt strip running from the chunk-grid edge on the entry side,
// through the path-chunk, into the center chunk, and ending at the clearing
// centre. We build the full 2-chunk path from the center chunk (the path
// extends into the neighbor chunk's territory, but Three.js doesn't care —
// the group's parent is the center chunk and all 9 forest chunks are loaded
// together).
//
// Re-uses chunks.js' `buildCurvedPath` to keep visual style identical to
// the chunk-grid trails so the forest path reads as "the same kind of path,
// just leading into the woods."

const PATH_WIDTH = 5;
const _forestPathMat = new THREE.MeshStandardMaterial({
  color: 0xb89570,
  roughness: 1,
  metalness: 0,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  depthWrite: false,
});

function buildForestPath(ctx, forest) {
  // Path enters at the OUTER edge of the path-chunk (3x3 block edge), 80m away
  // from center in the path direction; ends at the clearing centre.
  const off = CHUNK_SIZE + CHUNK_SIZE / 2;  // = 120m for entry from block edge to center
  let startX = forest.centerX, startZ = forest.centerZ;
  switch (forest.pathDirIdx) {
    case 0: startZ -= off; break; // N
    case 1: startX += off; break; // E
    case 2: startZ += off; break; // S
    case 3: startX -= off; break; // W
  }
  // Build the curved ribbon. Seed the rng deterministically from the forest
  // so the path's wiggle stays consistent across chunk reloads.
  const rng = mulberry32(forest.seed * 31 + 7);
  const mesh = buildCurvedPath(
    startX, startZ,
    forest.centerX, forest.centerZ,
    PATH_WIDTH,
    rng,
    _forestPathMat,
  );
  ctx.group.add(mesh);
}

// ---------- Forest interior content ----------
//
// Decides what visual fills the clearing. For Phase 2 the 'drum_circle'
// branch uses the same minimal-fire-and-djembe visual as the old chunk
// drum-circle theme; the LEAF-true rebuild lands in Phase 5. The 'campsite'
// branch uses the full assembler from models/campsite.js.

function buildForestInteriorContent(ctx, forest) {
  if (forest.interiorContent === 'campsite') {
    buildForestCampsite(ctx, forest);
  } else if (forest.interiorContent === 'drum_circle') {
    buildForestDrumCirclePlaceholder(ctx, forest);
  }
  // 'none' falls through — empty clearing (won't happen unless hasInterior,
  // which gates this whole function).
}

function buildForestCampsite(ctx, forest) {
  // Forest seed → deterministic campsite layout. Size scales with body radius:
  // small forests get 'small' campsites, bigger ones get medium/large.
  const rng = mulberry32(forest.seed * 41 + 13);
  const size = forest.bodyRadius > 105 ? 'large'
             : forest.bodyRadius > 95 ? 'medium'
             : 'small';
  const camp = buildCampsite(rng, size);
  camp.group.position.set(forest.centerX, 0, forest.centerZ);
  // Rotate so the firepit faces the path entry direction
  camp.group.rotation.y = pathDirToAngle(forest.pathDirIdx);
  ctx.group.add(camp.group);
  pushCampsiteAnimatables(ctx, camp);
  registerCampsiteFootprint(ctx, forest.centerX, forest.centerZ, camp.footprint);

  // The "wide open" zone in the corner chunks of the 3x3 — outside the dense
  // body, inside the block boundary — gets 2-3 additional satellite camps.
  // They give the forest the "main camp + outliers" feel a real LEAF camping
  // area has, and scatter the smiles + activity beyond a single bullseye.
  // Skip the wedge around the entrance path so the long approach stays clean.
  scatterMeadowCampsites(ctx, forest, rng, {
    count: 2 + Math.floor(rng() * 2),  // 2-3 outliers
    excludeAngle: pathDirToAngle(forest.pathDirIdx),
    excludeArc: Math.PI * 0.45,          // ±40° around entrance: keep clear
  });
}

// Placeholder drum-circle visual — small fire + a stray djembe drum.
// Identical to the original chunk drum_circle theme so we have *something*
// in the clearing until Phase 5's LEAF-true rebuild.
function buildForestDrumCirclePlaceholder(ctx, forest) {
  const x = forest.centerX;
  const z = forest.centerZ;

  // Fire (emissive icosahedron + ring of stones)
  const fire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.6, 1),
    new THREE.MeshStandardMaterial({
      color: 0xff7733,
      emissive: 0xff5511,
      emissiveIntensity: 2.5,
      roughness: 0.8,
    }),
  );
  fire.position.set(x, 0.6, z);
  ctx.group.add(fire);

  const rng = mulberry32(forest.seed * 53 + 19);
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const stone = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.3 + rng() * 0.15, 0),
      new THREE.MeshStandardMaterial({ color: 0x6a6a78, roughness: 1, flatShading: true }),
    );
    stone.position.set(x + Math.cos(ang) * 1.4, 0.3, z + Math.sin(ang) * 1.4);
    stone.castShadow = true;
    ctx.group.add(stone);
  }

  // Big djembe drum
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.55, 1.4, 14),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9, flatShading: true }),
  );
  drum.position.set(x + 3, 0.7, z + 1);
  drum.castShadow = true;
  ctx.group.add(drum);

  // BACK PATH — runs from the drum circle out the opposite side of the body
  // to the open meadow zone (corner chunks of the 3x3). Mirrors the main
  // entrance path's style so the cart can drive through both.
  const backAngle = pathDirToAngle(forest.backPathDirIdx);
  const backExitX = forest.centerX + Math.cos(backAngle) * (forest.bodyRadius + 6);
  const backExitZ = forest.centerZ + Math.sin(backAngle) * (forest.bodyRadius + 6);
  const backRng = mulberry32(forest.seed * 67 + 13);
  const backMesh = buildCurvedPath(
    forest.centerX, forest.centerZ,
    backExitX, backExitZ,
    PATH_WIDTH,
    backRng,
    _forestPathMat,
  );
  ctx.group.add(backMesh);

  // CAMPING MEADOW — 3-5 campsites scattered in a wedge past the back exit,
  // in the open area between the body perimeter and the 3x3 block edge.
  scatterMeadowCampsites(ctx, forest, backRng, {
    count: 3 + Math.floor(backRng() * 3),  // 3-5 sites
    excludeAngle: pathDirToAngle(forest.pathDirIdx),
    excludeArc: Math.PI * 0.55,            // ±50° around entrance: keep clear
    centerAngle: backAngle,                // bias the wedge to point this way
    centerArc: Math.PI * 0.5,              // sites spread within ±45° of back direction
  });

  // Register an attractor so the drum circle vibe propagates. Marked with
  // a distinct kind so audio + later upgrades can find these specifically.
  registry.add({
    kind: 'forest_drum_circle',
    position: new THREE.Vector3(x, 0, z),
    footprint: 1.5,
    collider: { radius: 1.2, damage: 4 },
    attractor: { radius: 8, weight: 1.4 },
    chunkKey: ctx.key,
  });
  // Note: spatial drum music attachment happens in Phase 4 — keeping this
  // placeholder silent for now so we hear the existing chunk drum_circle
  // theme audio without confusion. (Drum circles inside forests aren't yet
  // wired up because we haven't replaced the audio engine.)
}

// ---------- Camping meadow ----------
//
// Scatter satellite campsites in the open corner-chunk zone past the forest
// body. Positions are constrained to angles outside the entrance wedge so
// the long approach path stays clear. For drum-circle forests, callers pass
// `centerAngle`/`centerArc` to bias the wedge toward the back path; for
// campsite forests, callers leave those unset (sites spread anywhere away
// from the entrance).
//
// Each site gets its own deterministic sub-seed from the forest seed so two
// sites in the same forest get visually different layouts.
function scatterMeadowCampsites(ctx, forest, rng, opts) {
  const {
    count = 3,
    excludeAngle = null,       // angle (radians) to keep clear
    excludeArc = 0,            // half-width of the exclude wedge (radians)
    centerAngle = null,        // if set, bias placements toward this angle
    centerArc = Math.PI,       // total spread around centerAngle (default ±π = anywhere)
  } = opts || {};

  const placed = [];
  // Each campsite needs ~10m clearance from the next to avoid prop overlap.
  const MIN_SITE_SPACING = 14;

  for (let i = 0; i < count; i++) {
    let chosen = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      // Pick angle: weighted toward centerAngle if provided, otherwise uniform.
      let theta;
      if (centerAngle != null) {
        theta = centerAngle + (rng() - 0.5) * centerArc;
      } else {
        theta = rng() * Math.PI * 2;
      }
      // Reject if in the entrance-exclusion wedge
      if (excludeAngle != null && angDiff(theta, excludeAngle) < excludeArc) continue;

      // Distance: just past the body perimeter, into the corner-chunk zone.
      // Body radius is 90-110m, 3x3 corner is 170m from center. We want sites
      // between bodyR+12 (clear of the perimeter colliders) and bodyR+50 (room
      // to drive between them and the 3x3 boundary without falling off the world).
      const dist = forest.bodyRadius + 12 + rng() * 38;
      const x = forest.centerX + Math.cos(theta) * dist;
      const z = forest.centerZ + Math.sin(theta) * dist;

      // Spread check vs prior placements
      let tooClose = false;
      for (let j = 0; j < placed.length; j++) {
        const dx = placed[j].x - x;
        const dz = placed[j].z - z;
        if (dx * dx + dz * dz < MIN_SITE_SPACING * MIN_SITE_SPACING) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        chosen = { x, z, theta };
        break;
      }
    }
    if (!chosen) continue;

    // Build the campsite. Small for satellites — keeps the meadow legible
    // (10+ medium camps in a forest is too noisy).
    const siteSeed = mulberry32(hash2(forest.seed * 137 + i * 41, i * 311 + 7));
    const size = siteSeed() < 0.6 ? 'small' : 'medium';
    const camp = buildCampsite(siteSeed, size);
    camp.group.position.set(chosen.x, 0, chosen.z);
    // Face the firepit roughly toward the forest body (so the visual focal
    // point reads as "this camp belongs to the forest").
    camp.group.rotation.y = chosen.theta + Math.PI;
    ctx.group.add(camp.group);
    pushCampsiteAnimatables(ctx, camp);
    registerCampsiteFootprint(ctx, chosen.x, chosen.z, camp.footprint);
    placed.push(chosen);
  }
}

// Helpers shared by buildForestCampsite + scatterMeadowCampsites so the
// "register this campsite" logic lives in one place.
function pushCampsiteAnimatables(ctx, camp) {
  if (!camp || !camp.animatables || camp.animatables.length === 0) return;
  forestAnimatables.push({
    chunkKey: ctx.key,
    animatables: camp.animatables,
  });
}

function registerCampsiteFootprint(ctx, x, z, footprint) {
  registry.add({
    kind: 'campsite',
    position: new THREE.Vector3(x, 0, z),
    footprint,
    attractor: { radius: 5, weight: 0.6 },
    chunkKey: ctx.key,
  });
}

// ---------- Forest trees ----------

const FOREST_TREE_MIN_SPACING = 4.0;  // metres between trunks (was 3 — perf)
const FOREST_TREE_TARGET_DENSITY = 0.022; // trees per m² inside body radius
// ^ Calibrated against draw-call budget. Each forest tree is ~5 meshes
// (trunk + tiered foliage), so 0.022 * 6400 = ~140 attempts per chunk
// → ~80 placed → ~400 meshes/chunk. Across 9 loaded chunks that's
// ~3600 draw calls just for the forest, which the renderer absorbs without
// dropping frames. Going higher than this requires InstancedMesh.

function scatterForestTrees(ctx, forest) {
  // Use a forest-stable rng (NOT ctx.rng — that one differs per chunk).
  // We mix in the chunk offset so trees don't repeat across the 3x3.
  const dx = ctx.cx - forest.centerCx;
  const dz = ctx.cz - forest.centerCz;
  const rng = mulberry32(hash2(forest.seed + dx * 131, dz * 197 + 11));

  // Bounding box for this chunk (world coords)
  const chunkMinX = ctx.cxWorld - CHUNK_SIZE / 2;
  const chunkMaxX = ctx.cxWorld + CHUNK_SIZE / 2;
  const chunkMinZ = ctx.czWorld - CHUNK_SIZE / 2;
  const chunkMaxZ = ctx.czWorld + CHUNK_SIZE / 2;

  // How many trees to TRY placing in this chunk
  const chunkArea = CHUNK_SIZE * CHUNK_SIZE;
  const target = Math.floor(chunkArea * FOREST_TREE_TARGET_DENSITY);

  // Track placed positions for spacing check (just this chunk's trees;
  // perfect spacing across chunk borders isn't worth the cost).
  const placed = [];

  for (let attempt = 0; attempt < target * 4 && placed.length < target; attempt++) {
    const x = chunkMinX + rng() * (chunkMaxX - chunkMinX);
    const z = chunkMinZ + rng() * (chunkMaxZ - chunkMinZ);

    // Distance to forest center
    const ddx = x - forest.centerX;
    const ddz = z - forest.centerZ;
    const dist = Math.hypot(ddx, ddz);

    // Inside body: dense. Outside body (but still in 3x3): sparse fringe.
    // Skip if too far from the center to look like a forest at all.
    if (dist > forest.bodyRadius + 20) continue;

    // Density falloff: full inside body radius, ramps down to 0 over 20m fringe
    const density = dist < forest.bodyRadius
      ? 1.0
      : Math.max(0, 1 - (dist - forest.bodyRadius) / 20);
    if (rng() > density) continue;

    // Path corridor exclusion — Phase 2 carves the actual path geometry.
    // For now, ALSO skip trees within a corridor along the path-entry
    // direction so Phase 2 has clear room to lay the path.
    if (forest.hasInterior && pointInPathCorridor(x, z, forest)) continue;

    // Clearing exclusion — keep the central area tree-free for the drum circle.
    if (forest.hasInterior && dist < 16) continue;

    // Min spacing check (within this chunk)
    let tooClose = false;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (Math.hypot(p.x - x, p.z - z) < FOREST_TREE_MIN_SPACING) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Avoid stepping on any building registered by neighbouring chunks
    // (shouldn't happen inside the 3x3 since we suppress themes, but
    // belt + suspenders for the fringe).
    if (registry.closestBuilding(new THREE.Vector3(x, 0, z), 2.5)) continue;

    const tree = buildForestTree(rng);
    tree.position.set(x, 0, z);
    tree.rotation.y = rng() * Math.PI * 2;
    ctx.group.add(tree);

    // Forest trees DO get a hard collider — driving into them hurts.
    // Distinct kind so it can be tuned independently of the chunk-tree
    // "soft footprint, no collider" rule.
    registry.add({
      kind: 'forest_tree',
      position: new THREE.Vector3(x, 0, z),
      footprint: 1.4,
      collider: { radius: 0.9, damage: 3 },
      chunkKey: ctx.key,
    });

    placed.push({ x, z });
  }
}

// True if (x, z) is inside ANY path corridor for this forest — the main
// entrance corridor, OR (for drum-circle forests) the back corridor.
// Used to keep trees clear so the path geometry can run unobstructed.
function pointInPathCorridor(x, z, forest) {
  if (corridorMatches(x, z, forest, forest.pathDirIdx)) return true;
  if (forest.backPathDirIdx != null
      && corridorMatches(x, z, forest, forest.backPathDirIdx)) return true;
  return false;
}

function corridorMatches(x, z, forest, dirIdx) {
  const halfWidth = 5;  // tree-free corridor is 10m wide
  const lx = x - forest.centerX;
  const lz = z - forest.centerZ;
  const maxR = forest.bodyRadius + 8;
  switch (dirIdx) {
    case 0: return Math.abs(lx) < halfWidth && lz < 0 && lz > -maxR; // N
    case 1: return Math.abs(lz) < halfWidth && lx > 0 && lx < maxR;  // E
    case 2: return Math.abs(lx) < halfWidth && lz > 0 && lz < maxR;  // S
    case 3: return Math.abs(lz) < halfWidth && lx < 0 && lx > -maxR; // W
  }
  return false;
}

// ---------- Forest edge colliders ----------

// Place sphere colliders around the perimeter of the forest body, but only
// the ones whose world position falls inside THIS chunk's bbox. Skip a
// wedge of angles around `pathDir` so the path entry is collider-free.
function placeForestEdgeColliders(ctx, forest) {
  const ringR = forest.bodyRadius;
  const sphereR = 1.6;
  // Spacing along the ring: enough overlap that Zerble can't squeeze between.
  const circumference = 2 * Math.PI * ringR;
  const n = Math.ceil(circumference / (sphereR * 1.4));

  // Gap angle (in radians) around the path entry direction
  const pathAngle = pathDirToAngle(forest.pathDirIdx);
  const gapHalfArc = 0.10;  // ~5.7° each side → 11.5° opening, ~12m wide at the perimeter

  // Chunk bbox
  const minX = ctx.cxWorld - CHUNK_SIZE / 2;
  const maxX = ctx.cxWorld + CHUNK_SIZE / 2;
  const minZ = ctx.czWorld - CHUNK_SIZE / 2;
  const maxZ = ctx.czWorld + CHUNK_SIZE / 2;

  // Pre-compute back-path angle once for drum-circle forests so the inner
  // loop doesn't recompute it per perimeter point.
  const backAngle = forest.backPathDirIdx != null
    ? pathDirToAngle(forest.backPathDirIdx)
    : null;

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;

    // Skip the main path-entry gap
    if (forest.hasInterior) {
      const da = angDiff(a, pathAngle);
      if (da < gapHalfArc) continue;
    }
    // Skip the back-path gap (drum-circle forests only)
    if (backAngle != null) {
      const dbA = angDiff(a, backAngle);
      if (dbA < gapHalfArc) continue;
    }

    const px = forest.centerX + Math.cos(a) * ringR;
    const pz = forest.centerZ + Math.sin(a) * ringR;

    // Only this chunk owns colliders inside its bbox
    if (px < minX || px > maxX || pz < minZ || pz > maxZ) continue;

    registry.add({
      kind: 'forest_edge',
      position: new THREE.Vector3(px, 0.5, pz),
      footprint: 0,
      collider: { radius: sphereR, damage: 3 },
      chunkKey: ctx.key,
    });
  }
}

// Convert pathDirIdx (0=N, 1=E, 2=S, 3=W) to the angle used for placing
// perimeter points: 0 rad = +X (E), π/2 = +Z (S), π = -X (W), 3π/2 = -Z (N).
function pathDirToAngle(idx) {
  switch (idx) {
    case 0: return -Math.PI / 2; // N → -Z
    case 1: return 0;             // E → +X
    case 2: return Math.PI / 2;   // S → +Z
    case 3: return Math.PI;       // W → -X
  }
  return 0;
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}
