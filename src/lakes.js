// Lakes are first-class world features, not chunk content. A lake spans
// multiple chunks (big body radius 70-100m, small body 25-40m), placed at a
// deterministic position within a 320m "lake macrocell". They load when the
// player gets within LOAD_RADIUS and persist until LOAD_RADIUS_UNLOAD — so
// the player can see them well before they reach them, and they don't pop
// in/out at chunk boundaries.
//
// Lakes register their footprints + colliders in the shared registry without
// a chunkKey (so chunk unload doesn't tear them down), and chunks consult
// the registry to avoid placing paths/decorations on top of water.

import * as THREE from 'three';
import { registry } from './registry.js';
import { hash2, mulberry32 } from './rng.js';

const LAKE_CELL = 320;
const LAKE_DENSITY = 0.45;       // ~45% of macrocells get a lake
const LOAD_RADIUS = 720;          // build lakes within this distance of the player
const UNLOAD_RADIUS = 1500;       // tear them down beyond this (rebuilt deterministically on return)

const _key = (mcx, mcz) => `${mcx},${mcz}`;

export class LakeManager {
  constructor() {
    // key -> { center, bigR, smallR, group, registryIds } | null (null = no lake here)
    this.lakes = new Map();
  }

  update(scene, playerPos) {
    const mcxMin = Math.floor((playerPos.x - LOAD_RADIUS) / LAKE_CELL);
    const mcxMax = Math.floor((playerPos.x + LOAD_RADIUS) / LAKE_CELL);
    const mczMin = Math.floor((playerPos.z - LOAD_RADIUS) / LAKE_CELL);
    const mczMax = Math.floor((playerPos.z + LOAD_RADIUS) / LAKE_CELL);

    // Build (or note absence of) lakes in nearby macrocells.
    for (let mcx = mcxMin; mcx <= mcxMax; mcx++) {
      for (let mcz = mczMin; mcz <= mczMax; mcz++) {
        const key = _key(mcx, mcz);
        if (this.lakes.has(key)) continue;
        // Don't drop a lake on the main stage / LEAF arch.
        if (mcx === 0 && mcz === 0) {
          this.lakes.set(key, null);
          continue;
        }
        const seed = hash2(mcx * 17 + 91, mcz * 13 + 31);
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
  }
}

function buildLake(scene, mcx, mcz, rng) {
  const cellOriginX = mcx * LAKE_CELL;
  const cellOriginZ = mcz * LAKE_CELL;

  // Lake bodies sized for world-scale impact — the user explicitly asked for
  // "5 to 10x as big as what you have" (was 22m big / 9m small).
  const bigR = 70 + rng() * 30;     // 70-100 m
  const smallR = 25 + rng() * 15;   // 25-40 m
  const causewayHalfW = 4;          // 8m wide grass road
  const peninsulaLen = smallR * 0.55;

  // Position the big lake comfortably within the macrocell. Keep some margin
  // from the macrocell edge so neighbour macrocells' content has room.
  const margin = bigR + 30;
  const bigCx = cellOriginX + margin + rng() * (LAKE_CELL - 2 * margin);
  const bigCz = cellOriginZ + margin + rng() * (LAKE_CELL - 2 * margin);

  // Small lake to the north-east of big lake, distance ~bigR + smallR + 30m.
  const sepAngle = (rng() * 0.6 - 0.3) + Math.PI / 4;  // roughly NE, slight jitter
  const sep = bigR + smallR + 25 + rng() * 15;
  const smallCx = bigCx + Math.cos(sepAngle) * sep;
  const smallCz = bigCz + Math.sin(sepAngle) * sep;

  // Causeway runs along the line between the two lake centers, perpendicular
  // to the sep axis is the strip width direction.
  const dirX = (smallCx - bigCx) / sep;
  const dirZ = (smallCz - bigCz) / sep;
  // Causeway midpoint
  const causewayMidX = (bigCx + smallCx) / 2;
  const causewayMidZ = (bigCz + smallCz) / 2;
  // Causeway runs ALONG the sep axis through the two lakes.
  const causewayLen = sep + bigR + smallR + 40;  // extends past both lakes
  const causewayAngle = Math.atan2(dirZ, dirX);

  // ---- Materials ----
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x4d96d6,
    emissive: 0x1a3550,
    emissiveIntensity: 0.25,
    roughness: 0.3,
    metalness: 0.05,
    transparent: true,
    opacity: 0.88,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    depthWrite: false,
  });
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x82c277,
    roughness: 0.95,
    flatShading: true,
  });

  const group = new THREE.Group();
  group.name = `lake(${mcx},${mcz})`;

  // ---- Big lake water ----
  const bigWater = new THREE.Mesh(new THREE.CircleGeometry(bigR, 64), waterMat);
  bigWater.rotation.x = -Math.PI / 2;
  bigWater.position.set(bigCx, 0.08, bigCz);
  bigWater.receiveShadow = true;
  group.add(bigWater);

  // ---- Small lake water ----
  const smallWater = new THREE.Mesh(new THREE.CircleGeometry(smallR, 40), waterMat);
  smallWater.rotation.x = -Math.PI / 2;
  smallWater.position.set(smallCx, 0.08, smallCz);
  smallWater.receiveShadow = true;
  group.add(smallWater);

  // ---- Island in big lake ----
  const islandR = 5 + rng() * 3;       // 5-8 m
  const islandOff = bigR * 0.25 * (rng() - 0.5);
  // Slightly offset from center, perpendicular to sep axis
  const islandX = bigCx - dirZ * islandOff;
  const islandZ = bigCz + dirX * islandOff;
  const island = new THREE.Mesh(new THREE.CircleGeometry(islandR, 24), grassMat);
  island.rotation.x = -Math.PI / 2;
  island.position.set(islandX, 0.12, islandZ);
  island.receiveShadow = true;
  group.add(island);

  // Tree on the island, scaled to lake scale
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.95, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5fa55d, roughness: 0.95, flatShading: true });
  const trunkH = 4 + rng() * 1.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, trunkH, 8), trunkMat);
  trunk.position.set(islandX, trunkH / 2, islandZ);
  trunk.castShadow = true;
  group.add(trunk);
  const leafR = 2.2 + rng() * 0.6;
  const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(leafR, 1), leafMat);
  leaf.position.set(islandX, trunkH + leafR * 0.5, islandZ);
  leaf.castShadow = true;
  group.add(leaf);

  // ---- Causeway: grass strip running along the sep axis through both lakes ----
  const causeway = new THREE.Mesh(
    new THREE.PlaneGeometry(causewayLen, causewayHalfW * 2),
    grassMat,
  );
  causeway.rotation.x = -Math.PI / 2;
  causeway.rotation.z = -causewayAngle;     // align long axis with sep direction (PlaneGeometry's x = long)
  causeway.position.set(causewayMidX, 0.11, causewayMidZ);
  causeway.receiveShadow = true;
  group.add(causeway);

  // ---- Peninsula in small lake: a finger jutting into the small lake from
  // the OPPOSITE side of where the causeway enters. ----
  const peninsulaAngle = causewayAngle + Math.PI;  // 180° from causeway entry
  const pCx = smallCx + Math.cos(peninsulaAngle) * peninsulaLen * 0.5;
  const pCz = smallCz + Math.sin(peninsulaAngle) * peninsulaLen * 0.5;
  const peninsula = new THREE.Mesh(
    new THREE.PlaneGeometry(peninsulaLen, 4),
    grassMat,
  );
  peninsula.rotation.x = -Math.PI / 2;
  peninsula.rotation.z = -peninsulaAngle;
  peninsula.position.set(pCx, 0.13, pCz);
  peninsula.receiveShadow = true;
  group.add(peninsula);

  scene.add(group);

  // ---- Registry: footprints (NPC + tree avoidance) ----
  const registryIds = [];
  registryIds.push(registry.add({
    kind: 'lake',
    position: new THREE.Vector3(bigCx, 0, bigCz),
    footprint: bigR,
  }));
  registryIds.push(registry.add({
    kind: 'lake',
    position: new THREE.Vector3(smallCx, 0, smallCz),
    footprint: smallR,
  }));

  // ---- Edge colliders: ring around each lake's perimeter ----
  addLakeRingColliders(registryIds, bigCx, bigCz, bigR, causewayAngle, causewayHalfW, null);
  addLakeRingColliders(registryIds, smallCx, smallCz, smallR, causewayAngle + Math.PI, causewayHalfW, peninsulaAngle);

  // Island as a soft bump
  registryIds.push(registry.add({
    kind: 'island',
    position: new THREE.Vector3(islandX, 0.5, islandZ),
    footprint: islandR,
    collider: { radius: islandR + 0.4, damage: 3 },
  }));

  // Shore attractors: NPCs like hanging out at the shoreline. Sample 3-4 points
  // around the big lake's perimeter and one on the peninsula tip.
  const shoreSamples = 4;
  for (let i = 0; i < shoreSamples; i++) {
    const a = (i / shoreSamples) * Math.PI * 2 + rng() * 0.3;
    const r = bigR + 5;
    registryIds.push(registry.add({
      kind: 'shore',
      position: new THREE.Vector3(bigCx + Math.cos(a) * r, 0, bigCz + Math.sin(a) * r),
      footprint: 0,
      attractor: { radius: 8, weight: 1.8 },
    }));
  }
  registryIds.push(registry.add({
    kind: 'shore',
    position: new THREE.Vector3(pCx + Math.cos(peninsulaAngle) * peninsulaLen * 0.3, 0, pCz + Math.sin(peninsulaAngle) * peninsulaLen * 0.3),
    footprint: 0,
    attractor: { radius: 6, weight: 1.6 },
  }));

  return {
    center: new THREE.Vector3(bigCx, 0, bigCz),
    bigR,
    smallR,
    group,
    registryIds,
  };
}

// Ring of overlapping sphere colliders around a lake. The cart's outer radius
// (1.9m) + sphereR(2.2) means cart_edge meets the visible water exactly when
// ringR = lakeR - sphereR. step = sphereR gives full overlap so the cart
// can't tunnel between spheres.
function addLakeRingColliders(registryIds, lcx, lcz, lakeR, causewayAngle, causewayHalfW, peninsulaAngle) {
  const sphereR = 2.2;
  const ringR = Math.max(2, lakeR - sphereR);
  const circumference = 2 * Math.PI * ringR;
  const step = sphereR;
  const n = Math.max(20, Math.ceil(circumference / step));

  // Causeway crosses the lake along causewayAngle. Compute the angular gap on
  // the ring as the half-width / ringR (small-angle ok since causewayHalfW << ringR).
  const causewayHalfArc = Math.atan2(causewayHalfW + 1.0, ringR);

  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;

    // Skip both ends of the causeway axis (entry and exit) so the cart can drive through.
    const dCauseway = Math.min(
      angDiff(ang, causewayAngle),
      angDiff(ang, causewayAngle + Math.PI),
    );
    if (dCauseway < causewayHalfArc) continue;

    // Skip peninsula attachment if applicable
    if (peninsulaAngle != null && angDiff(ang, peninsulaAngle) < 0.20) continue;

    const px = lcx + Math.cos(ang) * ringR;
    const pz = lcz + Math.sin(ang) * ringR;
    registryIds.push(registry.add({
      kind: 'lake_edge',
      position: new THREE.Vector3(px, 0.5, pz),
      footprint: 0,
      collider: { radius: sphereR, damage: 1 },
    }));
  }
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function destroyLake(scene, lake) {
  lake.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      // Materials are shared across the lake's meshes so disposing once is enough,
      // but it's cheap to call dispose repeatedly.
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm?.dispose?.());
      else m?.dispose?.();
    }
  });
  scene.remove(lake.group);
  for (const id of lake.registryIds) registry.remove(id);
}

// Helper for chunks.js to know whether a chunk should skip its standard paths
// because a lake passes through it.
export function chunkOverlapsLake(cxWorld, czWorld, halfChunk) {
  for (const e of registry.entries.values()) {
    if (e.kind !== 'lake' || !e.footprint) continue;
    const dx = Math.max(0, Math.abs(e.position.x - cxWorld) - halfChunk);
    const dz = Math.max(0, Math.abs(e.position.z - czWorld) - halfChunk);
    if (Math.hypot(dx, dz) < e.footprint) return true;
  }
  return false;
}
