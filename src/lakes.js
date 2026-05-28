// Lakes are first-class world features, not chunk content. One lake per
// macrocell — irregular elongated/lobed shape (a small fraction stay circular
// for variety) — sealed at the perimeter so the cart and NPCs cannot enter
// the water. The only entities inside a lake are 0/1/2 canoes that drift
// around its interior.
//
// On a "treatment" lake (~60%), the lake is wrapped by:
//   shore (water edge)
//     ↓ ~6m clear band (the path Zerble drives)
//   ring of campsites facing the lake
//     ↓
//   forest ring (sparse close, denser farther out)
//
// Lakes register their bounding-circle footprint + outline-sealed collider
// ring in the shared registry without a chunkKey (so chunk unload doesn't
// tear them down). Chunks consult `chunkInLake` / `chunkOverlapsLake` to
// avoid placing themes/paths on or across water.

import * as THREE from 'three';
import { Vector3 } from 'three';
import { registry } from './registry.js';
import { hash2, worldHash, mulberry32 } from './rng.js';
import { buildCanoe } from './models/canoe.js';
import { buildCampsite } from './models/campsite.js';
import { buildForestTree } from './models/tree.js';

// Per-frame animatables from lakeside campsites. Each entry:
//   { lakeKey: string, animatables: [...] }
// destroyLake sweeps this list when its lake unloads.
export const lakeAnimatables = [];

const LAKE_CELL = 320;
const LAKE_DENSITY = 0.45;       // ~45% of macrocells get a lake
const LOAD_RADIUS = 720;          // build lakes within this distance of the player
const UNLOAD_RADIUS = 1500;       // tear them down beyond this (rebuilt deterministically on return)

// Edge-collider sphere radius. Matched against cart outer radius (~1.9m) so
// `cart_edge meets visible water = cart_center at (shoreR - sphereR)`. Pushed
// INWARD by SPHERE_R along the radial direction when placing.
const SPHERE_R = 2.2;

const _key = (mcx, mcz) => `${mcx},${mcz}`;

// ---- Shared water material ----------------------------------------------
//
// All lakes share one material so chunk/lake unload doesn't free it out from
// under other lakes (`userData.shared` flag — see ARCHITECTURE.md "Shared
// resources" + the perf-pooling rule).
//
// An earlier version of this file ran an `onBeforeCompile` shader patch that
// added procedural "twinkle stars" on the water surface at night, gated by
// nightness². It looked like fake glints/sparkles rather than a real
// reflection — the time-driven twinkle made every pseudo-star fade in and
// out which is wrong physics for reflected sky. Removed: this file no
// longer pretends. A real `Reflector`-based mirror is the right fix when
// reflections matter, gated to high-tier; deferred to ROADMAP.
const WATER_MAT = new THREE.MeshStandardMaterial({
  color: 0x4d96d6,
  emissive: 0x1a3550,
  emissiveIntensity: 0.25,
  roughness: 0.3,
  metalness: 0.05,
  transparent: true,
  opacity: 0.88,
  flatShading: true,
  depthWrite: false,
  side: THREE.DoubleSide,   // ShapeGeometry winding + rotation flip leaves
                            //   normals pointing either way depending on the
                            //   particular shape; DoubleSide sidesteps it.
});
WATER_MAT.userData.shared = true;

// Kept as a no-op for caller backward compat — main.js + sandbox both still
// call it each frame. Now that the star shader patch is gone there are no
// uniforms to drive, but removing the export would require unwinding the
// call sites too; cheaper to keep the empty body and let it inline away.
export function setLakeNightness(/* nightness, time */) {}

export class LakeManager {
  constructor() {
    // key -> { center, radius, group, registryIds, canoes, lakeKey } | null
    this.lakes = new Map();
  }

  update(scene, playerPos, dt = 0.016) {
    const mcxMin = Math.floor((playerPos.x - LOAD_RADIUS) / LAKE_CELL);
    const mcxMax = Math.floor((playerPos.x + LOAD_RADIUS) / LAKE_CELL);
    const mczMin = Math.floor((playerPos.z - LOAD_RADIUS) / LAKE_CELL);
    const mczMax = Math.floor((playerPos.z + LOAD_RADIUS) / LAKE_CELL);

    // Build (or note absence of) lakes in nearby macrocells.
    for (let mcx = mcxMin; mcx <= mcxMax; mcx++) {
      for (let mcz = mczMin; mcz <= mczMax; mcz++) {
        const key = _key(mcx, mcz);
        if (this.lakes.has(key)) continue;
        // Don't drop a lake on the main stage at the origin.
        if (mcx === 0 && mcz === 0) {
          this.lakes.set(key, null);
          continue;
        }
        const seed = worldHash(mcx * 17 + 91, mcz * 13 + 31);
        const rng = mulberry32(seed);
        if (rng() > LAKE_DENSITY) {
          this.lakes.set(key, null);
          continue;
        }
        this.lakes.set(key, buildLake(scene, mcx, mcz, rng));
      }
    }

    // Unload distant lakes (rebuilt deterministically when the player returns).
    for (const [key, lake] of this.lakes) {
      if (!lake) continue;
      const dx = lake.center.x - playerPos.x;
      const dz = lake.center.z - playerPos.z;
      if (Math.hypot(dx, dz) > UNLOAD_RADIUS) {
        destroyLake(scene, lake);
        this.lakes.delete(key);
      }
    }

    // Drift canoes on every loaded lake. Each lake has 0/1/2 canoes.
    for (const [, lake] of this.lakes) {
      if (lake && lake.canoes) {
        for (const c of lake.canoes) updateCanoe(c, dt);
      }
    }
  }
}

// ---- Outline generation ----------------------------------------------------

// Build a closed polygon outline for the lake. Returns array of {x, z} points
// relative to lake center. Most lakes are elongated and irregular; ~15% stay
// clean circles for variety.
//
// Elongation = ellipse (random major axis + rotation).
// Irregularity = two layered sin perturbations (broad lobes + finer wobble)
// plus per-vertex micro-jitter.
function buildLakeOutline(rng, baseR) {
  const N = 64;
  const points = [];

  if (rng() < 0.15) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      points.push({ x: Math.cos(a) * baseR, z: Math.sin(a) * baseR });
    }
    return points;
  }

  const a = 1 + rng() * 0.55;         // 1.0-1.55 major axis multiplier
  const b = 0.65 + rng() * 0.3;       // 0.65-0.95 minor axis multiplier
  const phi = rng() * Math.PI * 2;    // ellipse rotation

  // Two lobe perturbations — broad + finer — both smooth sinusoids. Tuned
  // down from the original aggressive amplitudes; the previous outline
  // (high amps + ±8% per-vertex jitter) read as a jagged spiky polygon
  // rather than a natural shoreline.
  const lobeFreqA = 2 + Math.floor(rng() * 2);  // 2 or 3 broad lobes
  const lobeAmpA = 0.04 + rng() * 0.08;
  const lobePhaseA = rng() * Math.PI * 2;
  const lobeFreqB = 3 + Math.floor(rng() * 3);  // 3-5 finer lobes
  const lobeAmpB = 0.02 + rng() * 0.04;
  const lobePhaseB = rng() * Math.PI * 2;

  // Per-vertex micro-jitter tuned WAY down (was ±8%). Even ±2% reads as
  // "natural irregularity" without producing visible spikes.
  const wobble = [];
  for (let i = 0; i < N; i++) wobble.push(0.98 + rng() * 0.04);

  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    // Ellipse radius at angle `ang`, axes rotated by `phi`.
    const ar = ang - phi;
    const ellR = (a * b) / Math.sqrt(
      Math.pow(b * Math.cos(ar), 2) + Math.pow(a * Math.sin(ar), 2)
    );
    const lobeMul = 1
      + lobeAmpA * Math.sin(ang * lobeFreqA + lobePhaseA)
      + lobeAmpB * Math.sin(ang * lobeFreqB + lobePhaseB);
    const r = baseR * ellR * lobeMul * wobble[i];
    points.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r });
  }
  return points;
}

// Compute the outline radius (distance from lake center) at an arbitrary
// angle by linear-interpolating between the two nearest sample points.
// Used by shore-attractor placement, beach placement, campsite placement,
// forest-tree placement, and canoe drift clamping.
function outlineRAt(outline, angle) {
  let a = angle;
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  const N = outline.length;
  const idx = (a / (Math.PI * 2)) * N;
  const i0 = Math.floor(idx) % N;
  const i1 = (i0 + 1) % N;
  const t = idx - Math.floor(idx);
  const p0 = outline[i0];
  const p1 = outline[i1];
  const r0 = Math.hypot(p0.x, p0.z);
  const r1 = Math.hypot(p1.x, p1.z);
  return r0 + (r1 - r0) * t;
}

// ---- Sealed perimeter colliders -------------------------------------------

// Walk the closed outline and place overlapping sphere colliders along it
// at SPHERE_R arc-length intervals — fully sealed, no gaps.
//
// Each collider is pushed inward along the EDGE NORMAL (perpendicular to the
// local tangent), not along the radial direction from lake center. Radial
// offset matches the shore normal only for circular shapes; on irregular
// lakes with lobes + concavities, radial drift away from normal makes the
// collider ring visibly drift away from the outline. Using the edge normal
// keeps the collider ring tracing the outline at every angle.
//
// CCW polygon convention: my outline samples (cos a, sin a) for a in
// [0, 2π) which winds CCW when viewed from +Y. For CCW winding the interior
// is to the LEFT of each edge as you walk it; rotating the edge tangent
// 90° CCW gives the inward normal: (tx, tz) → (-tz, tx).
function placeSealedColliders(registryIds, cx, cz, outline) {
  const N = outline.length;
  const closed = outline.concat([outline[0]]);
  const segLen = [];
  let total = 0;
  for (let i = 0; i < N; i++) {
    const dx = closed[i + 1].x - closed[i].x;
    const dz = closed[i + 1].z - closed[i].z;
    const L = Math.hypot(dx, dz);
    segLen.push(L);
    total += L;
  }
  const step = SPHERE_R;
  const n = Math.max(20, Math.ceil(total / step));
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    let acc = 0;
    let seg = 0;
    while (seg < N && acc + segLen[seg] < target) {
      acc += segLen[seg];
      seg++;
    }
    if (seg >= N) seg = N - 1;
    const tInSeg = (target - acc) / Math.max(0.001, segLen[seg]);
    const ax = closed[seg].x + (closed[seg + 1].x - closed[seg].x) * tInSeg;
    const az = closed[seg].z + (closed[seg + 1].z - closed[seg].z) * tInSeg;
    // Inward normal of this edge (CCW polygon, interior to the left):
    // edge direction (dx, dz) → inward normal (-dz, dx) / |edge|
    const edx = closed[seg + 1].x - closed[seg].x;
    const edz = closed[seg + 1].z - closed[seg].z;
    const eL = Math.max(0.001, Math.hypot(edx, edz));
    const nx = -edz / eL;
    const nz =  edx / eL;
    const px = cx + ax + nx * SPHERE_R;
    const pz = cz + az + nz * SPHERE_R;
    registryIds.push(registry.add({
      kind: 'lake_edge',
      position: new THREE.Vector3(px, 0.5, pz),
      footprint: 0,
      collider: { radius: SPHERE_R, damage: 1 },
    }));
  }
}

// ---- buildLake ------------------------------------------------------------

export function buildLake(scene, mcx, mcz, rng, opts = {}) {
  const cellOriginX = mcx * LAKE_CELL;
  const cellOriginZ = mcz * LAKE_CELL;

  // Lake size: 55-100m base radius. The outline can stretch up to ~1.7× this
  // along the major axis (ellipse), so total span is up to ~340m on a long lake.
  const baseR = 55 + rng() * 45;

  // Build the outline (irregular polygon).
  const outline = buildLakeOutline(rng, baseR);

  // Bounding circle for external chunk-overlap tests, and inscribed circle
  // (used to size islands so they stay clear of every shore).
  let maxR = 0;
  let minR = Infinity;
  for (const p of outline) {
    const r = Math.hypot(p.x, p.z);
    if (r > maxR) maxR = r;
    if (r < minR) minR = r;
  }

  // Position the lake inside the macrocell with `margin` clearance. The
  // bounding radius drives this so neighbour macrocells have room.
  const margin = maxR + 30;
  const cx = cellOriginX + margin + rng() * (LAKE_CELL - 2 * margin);
  const cz = cellOriginZ + margin + rng() * (LAKE_CELL - 2 * margin);

  // ---- Materials ----
  // Water is the shared, shader-patched WATER_MAT (defined at module scope)
  // so all lakes drive their star shimmer from one set of uniforms.
  const waterMat = WATER_MAT;
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x82c277,
    roughness: 0.95,
    flatShading: true,
  });

  const group = new THREE.Group();
  group.name = `lake(${mcx},${mcz})`;

  // ---- Water surface — ShapeGeometry from outline ----
  // ShapeGeometry's triangulated polygon naturally handles concave/lobed
  // outlines (unlike CircleGeometry which only does round discs).
  //
  // Frame alignment: shape vertices sit in XY plane; rotating by +π/2 around
  // X maps (sx, sy, 0) → (sx, 0, sy), so a shape walked from outline.(x, z)
  // ends up at world (outline.x, 0, outline.z) — same frame the colliders /
  // camps / trees / beach all use. Earlier attempt used rotation.x = -π/2
  // which maps to (sx, 0, -sy), mirroring Z, making the visible water lay
  // perpendicular to where its colliders thought it was on irregular shapes.
  //
  // To keep the polygon facing +Y (up) at this rotation, the shape needs
  // CW winding (a CCW polygon under +π/2 rotation faces -Y / back-culled).
  // We walk the outline IN REVERSE to get CW.
  const shape = new THREE.Shape();
  const lastIdx = outline.length - 1;
  shape.moveTo(outline[lastIdx].x, outline[lastIdx].z);
  for (let i = lastIdx - 1; i >= 0; i--) shape.lineTo(outline[i].x, outline[i].z);
  shape.lineTo(outline[lastIdx].x, outline[lastIdx].z);
  const waterGeo = new THREE.ShapeGeometry(shape);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = Math.PI / 2;
  water.position.set(cx, 0.08, cz);
  water.receiveShadow = true;
  water.renderOrder = 0;
  group.add(water);

  // ---- Island (35% chance, max one per lake) ----
  let islandSpec = null;
  if (rng() < 0.35) {
    const islR = 4 + rng() * 4;
    // Anchor inside the inscribed radius so the island doesn't punch out of
    // the irregular outline on any side.
    const ang = rng() * Math.PI * 2;
    const dist = Math.max(0, (minR - islR - 4)) * rng() * 0.7;
    const ix = cx + Math.cos(ang) * dist;
    const iz = cz + Math.sin(ang) * dist;

    const island = new THREE.Mesh(new THREE.CircleGeometry(islR, 24), grassMat);
    island.rotation.x = -Math.PI / 2;
    island.position.set(ix, 0.16, iz);
    island.receiveShadow = true;
    island.renderOrder = 1;
    group.add(island);
    islandSpec = { x: ix, z: iz, r: islR };

    // 0/1/2 trees on the island. Most have 1-2 — empty islands are rare but fine.
    const treeRoll = rng();
    const treeCount = treeRoll < 0.18 ? 0 : (treeRoll < 0.62 ? 1 : 2);
    for (let t = 0; t < treeCount; t++) {
      const tAng = rng() * Math.PI * 2;
      const tDist = rng() * (islR - 1.2);
      const tx = ix + Math.cos(tAng) * tDist;
      const tz = iz + Math.sin(tAng) * tDist;
      const tree = buildForestTree(rng);
      tree.position.set(tx, 0, tz);
      const s = 0.85 + rng() * 0.30;
      tree.scale.set(s, s, s);
      group.add(tree);
      // No collider needed — island is unreachable; only the canoe could come
      // near, and canoes stay 4m off shore via the outline-based clamp.
    }
  }

  // ---- Beach (60% chance, or forced via opts.forceBeach) ----
  let beachSpec = null;
  if (opts.forceBeach || rng() < 0.6) {
    const sandMat = new THREE.MeshStandardMaterial({
      color: 0xd9b878,
      roughness: 1.0,
      flatShading: true,
    });
    const beachAng = rng() * Math.PI * 2;
    const shoreR = outlineRAt(outline, beachAng);
    const sandR = baseR * 0.16;
    // Center sand straddling the shore (60% on grass, 40% peeking into water).
    const bX = cx + Math.cos(beachAng) * (shoreR + sandR * 0.2);
    const bZ = cz + Math.sin(beachAng) * (shoreR + sandR * 0.2);
    const sandMesh = new THREE.Mesh(new THREE.CircleGeometry(sandR, 16), sandMat);
    sandMesh.rotation.x = -Math.PI / 2;
    sandMesh.position.set(bX, 0.15, bZ);
    sandMesh.receiveShadow = true;
    sandMesh.renderOrder = 2;
    group.add(sandMesh);
    beachSpec = { x: bX, z: bZ, r: sandR };
  }

  scene.add(group);

  // ---- Registry ----
  // Single bounding-circle `lake` footprint for chunk/lake checks. Outline is
  // also stashed on the entry so `isPointInLake` can do an exact in-outline
  // check (not just the conservative bounding circle).
  const registryIds = [];
  registryIds.push(registry.add({
    kind: 'lake',
    position: new THREE.Vector3(cx, 0, cz),
    footprint: maxR,
    outline,
  }));

  // Sealed collider ring — no gaps for causeways or paths. The cart cannot
  // drive into a lake; only canoes (already inside) live on water.
  placeSealedColliders(registryIds, cx, cz, outline);

  // Beach attractor — NPCs hang out on the sand.
  if (beachSpec) {
    registryIds.push(registry.add({
      kind: 'beach',
      position: new THREE.Vector3(beachSpec.x, 0, beachSpec.z),
      footprint: 0,
      attractor: { radius: beachSpec.r * 0.9, weight: 2.4 },
    }));
  }

  // Shore attractors — NPCs gravitate to the shoreline.
  const shoreSamples = 4;
  for (let i = 0; i < shoreSamples; i++) {
    const ang = (i / shoreSamples) * Math.PI * 2 + rng() * 0.3;
    const sR = outlineRAt(outline, ang);
    registryIds.push(registry.add({
      kind: 'shore',
      position: new THREE.Vector3(cx + Math.cos(ang) * (sR + 5), 0, cz + Math.sin(ang) * (sR + 5)),
      footprint: 0,
      attractor: { radius: 8, weight: 1.8 },
    }));
  }

  // ---- Campsites + forest ring (60% of lakes get the full treatment) ----
  const lakeKey = _key(mcx, mcz);
  const lakeAnimEntries = [];
  if (rng() < 0.60) {
    // 4-9 campsites, deterministic angles via attempt-with-rejection so
    // no two camps pile up.
    const campCount = 4 + Math.floor(rng() * 6);
    const usedAngles = [];
    const camps = [];
    for (let i = 0; i < campCount; i++) {
      let theta = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const t = rng() * Math.PI * 2;
        if (usedAngles.every((u) => angDiff(t, u) >= 0.45)) { theta = t; break; }
      }
      if (theta == null) continue;
      usedAngles.push(theta);

      const campSeed = worldHash(mcx * 211 + 17 + i, mcz * 313 + i * 59);
      const size = rng() < 0.4 ? 'small' : 'medium';
      const camp = buildCampsite(mulberry32(campSeed), size);

      // Place the camp `6m + footprint` beyond the FARTHEST nearby shore in
      // an angular wedge around theta — not just shoreR at theta itself.
      // For elongated/lobed lakes, a lobe at theta+ε can extend past the
      // shore at theta and the camp would end up partly in water. Sampling
      // ±0.30rad (≈±17°) is well over the camp's own angular footprint at
      // these distances (~footprint / r ≈ 0.07rad for footprint=5, r=70).
      let maxShoreNearby = 0;
      for (let dt = -0.30; dt <= 0.30; dt += 0.05) {
        maxShoreNearby = Math.max(maxShoreNearby, outlineRAt(outline, theta + dt));
      }
      const r = maxShoreNearby + 6 + camp.footprint;
      const camX = cx + Math.cos(theta) * r;
      const camZ = cz + Math.sin(theta) * r;
      camp.group.position.set(camX, 0, camZ);
      camp.group.rotation.y = Math.atan2(cz - camZ, cx - camX);  // face the lake
      group.add(camp.group);
      lakeAnimEntries.push(camp.animatables);
      camps.push({ x: camX, z: camZ, r: camp.footprint });

      registryIds.push(registry.add({
        kind: 'campsite',
        position: new THREE.Vector3(camX, 0, camZ),
        footprint: camp.footprint,
        attractor: { radius: 6, weight: 1.4 },
      }));
    }

    // Forest ring around the lake — sparse near the camps, denser further out.
    // We sample N candidate positions in the shore-band (14-39m beyond shore);
    // each candidate uses rng()^0.6 to bias the radial distance toward "far"
    // so density visibly increases with distance. Candidates within camp
    // footprint + 2.5m are rejected so camps stay clear.
    const TREE_TARGET = 90 + Math.floor(rng() * 50);
    let placed = 0;
    let attempts = 0;
    while (placed < TREE_TARGET && attempts < TREE_TARGET * 4) {
      attempts++;
      const ang = rng() * Math.PI * 2;
      // Same wedge-max trick as campsites — use the farthest shore within
      // ±0.15rad so a lobe doesn't poke under a tree at the chosen angle.
      let sR = 0;
      for (let dt = -0.15; dt <= 0.15; dt += 0.05) {
        sR = Math.max(sR, outlineRAt(outline, ang + dt));
      }
      const radialT = Math.pow(rng(), 0.6);
      const dRadial = 14 + radialT * 25;
      const treeX = cx + Math.cos(ang) * (sR + dRadial);
      const treeZ = cz + Math.sin(ang) * (sR + dRadial);

      let closeToCamp = false;
      for (const c of camps) {
        if (Math.hypot(c.x - treeX, c.z - treeZ) < c.r + 2.5) { closeToCamp = true; break; }
      }
      if (closeToCamp) continue;

      const tree = buildForestTree(rng);
      tree.position.set(treeX, 0, treeZ);
      const s = 0.85 + rng() * 0.35;
      tree.scale.set(s, s, s);
      group.add(tree);

      // `forest_tree` collider — same kind as forests.js trees, so hitting one
      // hurts the same way and panics nearby NPCs. No chunkKey so the tree
      // survives chunk unload (it's bound to the lake's lifecycle).
      registryIds.push(registry.add({
        kind: 'forest_tree',
        position: new THREE.Vector3(treeX, 0, treeZ),
        footprint: 1.0,
        collider: { radius: 1.0 * s, damage: 2 },
      }));
      placed++;
    }

    if (lakeAnimEntries.length > 0) {
      lakeAnimatables.push({
        lakeKey,
        animatables: lakeAnimEntries.flat(),
        centerX: (mcx + 0.5) * LAKE_CELL,
        centerZ: (mcz + 0.5) * LAKE_CELL,
      });
    }
  }

  // ---- Canoes: 0/1/2 per lake. 30% / 50% / 20% distribution.
  const canoes = [];
  const canoeRoll = rng();
  const canoeCount = canoeRoll < 0.30 ? 0 : (canoeRoll < 0.80 ? 1 : 2);
  for (let i = 0; i < canoeCount; i++) {
    canoes.push(createLakeCanoe(group, cx, cz, outline, rng));
  }

  return {
    center: new THREE.Vector3(cx, 0, cz),
    radius: maxR,
    group,
    registryIds,
    canoes,
    lakeKey,
    outline,
  };
}

// ---- Canoe ----------------------------------------------------------------

function createLakeCanoe(parentGroup, lakeCx, lakeCz, outline, rng) {
  const canoeGroup = new THREE.Group();
  canoeGroup.name = 'canoe';
  buildCanoe(canoeGroup, rng);
  // Start well inside the lake (40% of shore radius at a random angle).
  const ang = rng() * Math.PI * 2;
  const shoreR = outlineRAt(outline, ang);
  const r = shoreR * 0.4;
  canoeGroup.position.set(lakeCx + Math.cos(ang) * r, 0, lakeCz + Math.sin(ang) * r);
  canoeGroup.rotation.y = rng() * Math.PI * 2;
  parentGroup.add(canoeGroup);

  return {
    group: canoeGroup,
    lakeCx,
    lakeCz,
    outline,
    heading: canoeGroup.rotation.y,
    speed: 0.6 + rng() * 0.5,
    targetX: lakeCx,
    targetZ: lakeCz,
    timer: 0,
    bobPhase: rng() * Math.PI * 2,
  };
}

function updateCanoe(canoe, dt) {
  canoe.timer -= dt;
  if (canoe.timer <= 0) {
    // Pick a new target inside the lake using the outline's angle-specific
    // shore radius so canoes can explore elongated lakes (not just orbit the
    // center).
    const ang = Math.random() * Math.PI * 2;
    const sR = outlineRAt(canoe.outline, ang);
    const r = Math.random() * sR * 0.7;
    canoe.targetX = canoe.lakeCx + Math.cos(ang) * r;
    canoe.targetZ = canoe.lakeCz + Math.sin(ang) * r;
    canoe.timer = 6 + Math.random() * 8;
  }

  // Steer toward target.
  const dx = canoe.targetX - canoe.group.position.x;
  const dz = canoe.targetZ - canoe.group.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.5) {
    // Canoe long axis is +Z; heading = atan2(dx, dz) faces the (dx,dz) vector.
    const targetHeading = Math.atan2(dx, dz);
    let diff = targetHeading - canoe.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    canoe.heading += Math.sign(diff) * Math.min(Math.abs(diff), 0.7 * dt);

    canoe.group.position.x += Math.sin(canoe.heading) * canoe.speed * dt;
    canoe.group.position.z += Math.cos(canoe.heading) * canoe.speed * dt;
  }

  // Hard clamp against the outline-shaped safe zone (4m off the shore at the
  // canoe's current angle). Replaces the old hardcoded `safeR = lakeR * 0.78`,
  // which couldn't follow an irregular shape.
  const ox = canoe.group.position.x - canoe.lakeCx;
  const oz = canoe.group.position.z - canoe.lakeCz;
  const distFromCenter = Math.hypot(ox, oz);
  if (distFromCenter > 0.001) {
    const canoeAng = Math.atan2(oz, ox);
    const sR = outlineRAt(canoe.outline, canoeAng);
    const safeR = Math.max(2, sR - 4);
    if (distFromCenter > safeR) {
      const inv = safeR / distFromCenter;
      canoe.group.position.x = canoe.lakeCx + ox * inv;
      canoe.group.position.z = canoe.lakeCz + oz * inv;
      canoe.targetX = canoe.lakeCx;
      canoe.targetZ = canoe.lakeCz;
      canoe.timer = 4 + Math.random() * 3;
    }
  }

  // Gentle bob + sway.
  canoe.bobPhase += dt * 1.3;
  canoe.group.position.y = 0.04 + Math.sin(canoe.bobPhase) * 0.04;
  canoe.group.rotation.y = canoe.heading;
  canoe.group.rotation.x = Math.sin(canoe.bobPhase * 0.7) * 0.03;
  canoe.group.rotation.z = Math.cos(canoe.bobPhase * 0.5) * 0.04;
}

// Sandbox helper — same builder, sensible-default rng.
export function _buildCanoeMeshForSandbox(group, rng = Math.random) {
  buildCanoe(group, rng);
}

// ---- Utility -------------------------------------------------------------

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function destroyLake(scene, lake) {
  lake.group.traverse((o) => {
    if (o.isMesh) {
      // Skip shared (module-level cached) geos/mats — see chunks._unload.
      if (!o.geometry?.userData?.shared) o.geometry?.dispose();
      const m = o.material;
      if (Array.isArray(m)) {
        m.forEach((mm) => { if (!mm?.userData?.shared) mm?.dispose?.(); });
      } else if (!m?.userData?.shared) {
        m?.dispose?.();
      }
    }
  });
  scene.remove(lake.group);
  for (const id of lake.registryIds) registry.remove(id);
  if (lake.lakeKey) {
    for (let i = lakeAnimatables.length - 1; i >= 0; i--) {
      if (lakeAnimatables[i].lakeKey === lake.lakeKey) {
        lakeAnimatables.splice(i, 1);
      }
    }
  }
}

// Helper for chunks.js to know whether a chunk should skip its standard paths
// because a lake passes through it. Uses the bounding-circle footprint
// registered by buildLake (kind: 'lake') — a slight over-approximation that
// suppresses a few grass-only chunks near the lake's bounding box. Acceptable.
export function chunkOverlapsLake(cxWorld, czWorld, halfChunk) {
  for (const e of registry.entries.values()) {
    if (e.kind !== 'lake' || !e.footprint) continue;
    const dx = Math.max(0, Math.abs(e.position.x - cxWorld) - halfChunk);
    const dz = Math.max(0, Math.abs(e.position.z - czWorld) - halfChunk);
    if (Math.hypot(dx, dz) < e.footprint) return true;
  }
  return false;
}

// Stricter check: is the chunk CENTER itself inside a lake footprint? Used to
// suppress theme builders (stage / food truck / drum circle) on water.
export function chunkInLake(cxWorld, czWorld) {
  for (const e of registry.entries.values()) {
    if (e.kind !== 'lake' || !e.footprint) continue;
    const dx = e.position.x - cxWorld;
    const dz = e.position.z - czWorld;
    if (Math.hypot(dx, dz) < e.footprint) return true;
  }
  return false;
}

// Is (x, z) inside any lake's actual outline (not just the bounding circle)?
// Bounding-circle check first as a cheap rejection, then exact in-outline
// check for points inside the bounding circle. Used by ambient-crowd spawn
// to keep NPCs out of the water (canoes are the only entities allowed in).
export function isPointInLake(x, z) {
  for (const e of registry.entries.values()) {
    if (e.kind !== 'lake' || !e.footprint) continue;
    const dx = x - e.position.x;
    const dz = z - e.position.z;
    const d = Math.hypot(dx, dz);
    if (d > e.footprint) continue;       // outside bounding circle — safe
    if (!e.outline) return true;         // no outline stored — fall back to bounding circle
    const ang = Math.atan2(dz, dx);
    const shoreR = outlineRAt(e.outline, ang);
    if (d < shoreR) return true;
  }
  return false;
}

// If (x, z) is inside any lake's footprint, project to the shoreline (just
// outside the bounding circle by `margin`). Used by moving entities (brass
// band, puppet parade) to keep their paths off water.
export function projectOutOfLake(x, z, margin = 2.5) {
  for (const e of registry.entries.values()) {
    if (e.kind !== 'lake' || !e.footprint) continue;
    const dx = x - e.position.x;
    const dz = z - e.position.z;
    const d = Math.hypot(dx, dz);
    if (d < e.footprint) {
      const inv = d > 0.01 ? 1 / d : 1;
      const target = e.footprint + margin;
      return new Vector3(
        e.position.x + (d > 0.01 ? dx * inv : 1) * target,
        0,
        e.position.z + (d > 0.01 ? dz * inv : 0) * target,
      );
    }
  }
  return null;
}
