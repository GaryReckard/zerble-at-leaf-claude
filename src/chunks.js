// Procedural festival, generated in chunks. Each chunk picks a theme based on its
// (cx, cz) seed and lays out props + spawns NPCs accordingly. Chunks are generated
// lazily as Zerble explores; for simplicity they stay loaded once created.
//
// Themes:
//   main_stage  — only at (0,0). Big stage with a dense audience.
//   side_stage  — smaller stage with audience.
//   food_plaza  — cluster of food trucks + tables.
//   vendor_row  — row of craft tents.
//   drum_circle — open area with a drum + congregated crowd.
//   grove       — dense trees, a few hammocks, sparse crowd.
//   open_lawn   — sparse — picnic blankets, room to drive.
//
// Every chunk also drops a path stripe along its primary axis so the player
// can see where to go, and NPC AI prefers walking near paths.

import * as THREE from 'three';
import { registry } from './registry.js';
import { hash2, mulberry32 } from './rng.js';
import { Sound } from './sound.js';
import { PERF } from './perf.js';
import { chunkOverlapsLake, chunkInLake } from './lakes.js';
import { getForestAt, buildForestChunk, chunkInForest, forestAnimatables, forestDrumCircles, forestDrumMusic } from './forests.js';
import { buildCampsite } from './models/campsite.js';
import { buildTent } from './models/tent.js';
import { buildFoodTruck, FOOD_TRUCK_SCALE } from './models/foodTruck.js';
import { buildHammock as buildHammockModel } from './models/hammock.js';
import { buildEntranceArch as buildEntranceArchModel } from './models/entranceArch.js';
import { buildStage as buildStageModel, placeBandOnStage } from './models/stage.js';
import { buildTentStage } from './models/tentStage.js';
import { buildTree } from './models/tree.js';
import { leafBannerTextures } from './models/leafBanner.js';

export const CHUNK_SIZE = 80;
const LOAD_RADIUS = PERF.chunkLoadRadius;   // mobile: 1 (3x3), desktop: 2 (5x5)
const UNLOAD_RADIUS = PERF.chunkUnloadRadius; // hysteresis

// Bands placed on stages — animated lightly each frame by the main loop.
export const stagePerformers = [];

// Spatial music handles, one per stage, tagged by chunkKey so we can detach on unload.
const stageMusic = [];

// Stage light lens meshes — the day/night system samples these for the night
// "light show" pulse + color. Each entry: { lens: Mesh, chunkKey, baseColor }.
export const stageLightLenses = [];

// Stage spotlight beams projecting INTO the audience. Each entry mirrors
// stageBeams from models/stage.js plus a chunkKey for unload tracking and
// scale so the sweep amplitude reads correctly on differently-sized stages.
// { beam, target, baseTargetX, baseTargetZ, phaseOffset, scale, chunkKey }
export const stageBeamRefs = [];

export function updateStagePerformers(t) {
  for (let i = 0; i < stagePerformers.length; i++) {
    const p = stagePerformers[i];
    const phase = t * 3 + p.phase;
    p.group.position.y = p.baseY + Math.abs(Math.sin(phase)) * 0.08;
    p.group.rotation.z = Math.sin(phase * 0.5) * 0.05;
    p.group.rotation.y = p.baseYaw + Math.sin(phase * 0.3) * 0.15;
  }
}

// Stage-light show: during the day the lenses just sit there with their
// baseline emissive. At night they pulse and cycle through a club-like
// rainbow palette and the audience-facing SpotLight beams sweep across
// the crowd. `t` is seconds since start, `nightness` 0..1 from the
// time-of-day system, `zerblePos` is THREE.Vector3 used to pool the
// closest beams (only MAX_ACTIVE_STAGE_LIGHTS SpotLights are lit per frame).
const MAX_ACTIVE_STAGE_LIGHTS = 6;
const _showColors = [0xff3380, 0xffae33, 0xffe066, 0x66ff88, 0x33d9ff, 0xc080ff];
const _tmpC1 = new THREE.Color();
const _tmpC2 = new THREE.Color();
// Scratch vector to avoid per-frame allocation when computing distances.
const _tmpVec = new THREE.Vector3();
// Scratch buffers for the beam-distance sort — lazily resized, reused every frame.
let _beamDistances = new Float32Array(64);
let _beamIndices = Array.from({ length: 64 }, (_, i) => i);
let _beamScratchCap = 64;
export function updateStageLightShow(t, nightness, zerblePos) {
  // ---- Lens colors / pulse ----
  for (let i = 0; i < stageLightLenses.length; i++) {
    const entry = stageLightLenses[i];
    const mat = entry.lens.material;
    if (nightness < 0.05) {
      mat.emissiveIntensity = 2.4 + Math.sin(t * 1.5 + i) * 0.2;
      const base = _tmpC1.setHex(entry.baseColor);
      mat.color.lerp(base, 0.05);
      mat.emissive.lerp(base, 0.05);
    } else {
      const phase = t * 1.4 + i * 0.7;
      const colorIdx = Math.floor((t * 0.4 + i) % _showColors.length);
      const nextIdx = (colorIdx + 1) % _showColors.length;
      const blend = (t * 0.4 + i) % 1;
      _tmpC1.setHex(_showColors[colorIdx]);
      _tmpC2.setHex(_showColors[nextIdx]);
      const c = _tmpC1.lerp(_tmpC2, blend);
      mat.color.copy(c);
      mat.emissive.copy(c);
      const pulse = 0.5 + 0.5 * Math.sin(phase);
      mat.emissiveIntensity = 2.0 + pulse * 5.0 * nightness;
    }
  }

  // ---- Audience-facing SpotLight beams ----
  // Beams swing left/right + forward/back in lissajous patterns so each
  // stage paints a moving rainbow across the crowd. Three beams per stage
  // chase different patterns so they don't lockstep.
  //
  // Performance pool: rank all loaded beams by their stage's distance to
  // Zerble and only enable the closest MAX_ACTIVE_STAGE_LIGHTS. Beams
  // outside the pool get intensity = 0 so the GPU skips their fragment
  // work entirely. Animation state (target position, color) still advances
  // every frame for all beams so there's no visual pop when a stage enters
  // or leaves the active pool.
  const PATTERNS = [
    // {ax: amplitudeX, az: amplitudeZ, rateX, rateZ, phaseZ}
    { ax: 6, az: 3, rateX: 0.9, rateZ: 1.3, phaseZ: 0.0 },     // wide sweep
    { ax: 2, az: 5, rateX: 1.4, rateZ: 0.7, phaseZ: 1.5 },     // depth pump
    { ax: 5, az: 4, rateX: 0.6, rateZ: 1.1, phaseZ: 2.4 },     // diagonal
  ];
  const beamOn = THREE.MathUtils.smoothstep(nightness, 0.15, 0.7);
  const totalBeams = stageBeamRefs.length;

  // Build a sorted distance list only when we have more beams than the pool
  // size AND we have a valid zerblePos to compare against. When beam count is
  // within the pool cap, every beam is active — no sorting needed.
  let activeSet = null; // null means "all beams are active"
  if (zerblePos && totalBeams > MAX_ACTIVE_STAGE_LIGHTS) {
    // Compute squared distance for each beam (cheap; avoids sqrt).
    // Group by stage world position so three beams from the same stage share
    // one distance lookup (each ref carries stageWorldPos).
    // Grow scratch buffers only when beam count exceeds current capacity.
    if (totalBeams > _beamScratchCap) {
      _beamDistances = new Float32Array(totalBeams);
      _beamIndices = Array.from({ length: totalBeams }, (_, i) => i);
      _beamScratchCap = totalBeams;
    }
    for (let i = 0; i < totalBeams; i++) {
      const ref = stageBeamRefs[i];
      if (ref.stageWorldPos) {
        _tmpVec.copy(ref.stageWorldPos).sub(zerblePos);
        _beamDistances[i] = _tmpVec.x * _tmpVec.x + _tmpVec.z * _tmpVec.z;
      } else {
        // No world position stored — treat as closest so it's never culled.
        _beamDistances[i] = 0;
      }
      _beamIndices[i] = i; // reset before sort (reused buffer)
    }
    // Sort indices by distance ascending (in-place on reused array).
    _beamIndices.length = totalBeams;
    _beamIndices.sort((a, b) => _beamDistances[a] - _beamDistances[b]);
    // The active set is the closest MAX_ACTIVE_STAGE_LIGHTS beam indices.
    activeSet = new Set(_beamIndices.slice(0, MAX_ACTIVE_STAGE_LIGHTS));
  }

  for (let i = 0; i < totalBeams; i++) {
    const ref = stageBeamRefs[i];
    const pattern = PATTERNS[i % PATTERNS.length];
    const phase = t + ref.phaseOffset;

    // Always advance animation state so beams are in-phase when they re-enter
    // the active pool — avoids a visible jump in sweep position / color.
    ref.target.position.x = ref.baseTargetX
      + Math.sin(phase * pattern.rateX) * pattern.ax * ref.scale;
    ref.target.position.z = ref.baseTargetZ
      + Math.sin(phase * pattern.rateZ + pattern.phaseZ) * pattern.az * ref.scale;
    // Color chase — shifts through the palette out of phase with the lens.
    const colorIdx = Math.floor((t * 0.35 + i * 1.3) % _showColors.length);
    const nextIdx = (colorIdx + 1) % _showColors.length;
    const blend = (t * 0.35 + i * 1.3) % 1;
    _tmpC1.setHex(_showColors[colorIdx]);
    _tmpC2.setHex(_showColors[nextIdx]);
    ref.beam.color.copy(_tmpC1.lerp(_tmpC2, blend));

    // Intensity: full animation for active pool; zero for culled beams.
    const inPool = activeSet === null || activeSet.has(i);
    if (inPool) {
      const pulse = 0.55 + 0.45 * Math.sin(phase * 2.2);
      ref.beam.intensity = beamOn * pulse * 9.0;
    } else {
      ref.beam.intensity = 0;
    }
  }
}

// ---------- Public API ----------

export class ChunkManager {
  constructor(scene, crowd) {
    this.scene = scene;
    this.crowd = crowd;
    this.loaded = new Map(); // key -> { group, cx, cz, theme }
  }

  update(playerPos) {
    const ccx = Math.round(playerPos.x / CHUNK_SIZE);
    const ccz = Math.round(playerPos.z / CHUNK_SIZE);

    // Load nearby chunks
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = chunkKey(cx, cz);
        if (!this.loaded.has(key)) {
          this._generate(cx, cz);
        }
      }
    }

    // Unload distant chunks (hysteresis: only beyond UNLOAD_RADIUS, so we don't
    // thrash when straddling a boundary)
    for (const [key, chunk] of this.loaded) {
      const ddx = Math.abs(chunk.cx - ccx);
      const ddz = Math.abs(chunk.cz - ccz);
      if (ddx > UNLOAD_RADIUS || ddz > UNLOAD_RADIUS) {
        this._unload(key, chunk);
      }
    }
  }

  _unload(key, chunk) {
    // Dispose all geometries and materials in this chunk's group so the GPU can
    // free them. We don't share geometries across chunks in this codebase, so
    // disposing per-chunk is safe.
    chunk.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        const m = obj.material;
        if (Array.isArray(m)) {
          for (const sub of m) sub?.dispose?.();
        } else {
          m?.dispose?.();
        }
      }
    });
    this.scene.remove(chunk.group);

    // Clean up registry + crowd + stage performers + stage music tagged with this chunk
    registry.removeChunk(key);
    if (this.crowd) this.crowd.unloadChunk(key);
    for (let i = stagePerformers.length - 1; i >= 0; i--) {
      if (stagePerformers[i].chunkKey === key) stagePerformers.splice(i, 1);
    }
    for (let i = stageMusic.length - 1; i >= 0; i--) {
      if (stageMusic[i].chunkKey === key) {
        Sound.detachStageMusic(stageMusic[i].handle);
        stageMusic.splice(i, 1);
      }
    }
    for (let i = stageLightLenses.length - 1; i >= 0; i--) {
      if (stageLightLenses[i].chunkKey === key) stageLightLenses.splice(i, 1);
    }
    for (let i = stageBeamRefs.length - 1; i >= 0; i--) {
      if (stageBeamRefs[i].chunkKey === key) stageBeamRefs.splice(i, 1);
    }
    // Sweep forest animatables (campsite firepit / torch flicker state).
    for (let i = forestAnimatables.length - 1; i >= 0; i--) {
      if (forestAnimatables[i].chunkKey === key) forestAnimatables.splice(i, 1);
    }
    // Sweep LEAF drum-circle animatables (fire mesh pulse + PointLight flicker).
    for (let i = forestDrumCircles.length - 1; i >= 0; i--) {
      if (forestDrumCircles[i].chunkKey === key) forestDrumCircles.splice(i, 1);
    }
    // Detach forest-drum spatial music and free its oscillators.
    for (let i = forestDrumMusic.length - 1; i >= 0; i--) {
      if (forestDrumMusic[i].chunkKey === key) {
        Sound.detachStageMusic(forestDrumMusic[i].handle);
        forestDrumMusic.splice(i, 1);
      }
    }

    this.loaded.delete(key);
  }

  _generate(cx, cz) {
    const key = chunkKey(cx, cz);
    // Forests preempt the normal theme: if this chunk is part of a forest's
    // 3x3 block, we hand it off to forests.js entirely (which builds dense
    // trees + perimeter colliders + — eventually — the clearing).
    const forest = getForestAt(cx, cz);
    const theme = forest ? 'forest' : pickTheme(cx, cz);
    const group = new THREE.Group();
    group.name = `chunk(${cx},${cz},${theme})`;

    const ctx = {
      cx, cz, key,
      theme,
      cxWorld: cx * CHUNK_SIZE,
      czWorld: cz * CHUNK_SIZE,
      rng: mulberry32(hash2(cx, cz)),
      group,
      crowd: this.crowd,
    };

    if (forest) {
      // Forest chunks skip the normal path grid, theme builders, ambient
      // crowd, and chunk-tree scatter. Everything is handled inside
      // buildForestChunk so reasoning about "what's in a forest chunk?"
      // stays in forests.js.
      buildForestChunk(ctx, forest);
    } else {
      // Every chunk: paths along its grid axes (skipped if the chunk overlaps a lake)
      placePaths(ctx);

      // Suppress theme content (stages, food trucks, vendor rows, drum circles,
      // hammocks, picnic blankets) when the chunk center sits inside a lake.
      // Otherwise these get placed on top of the water. Trees + sparse ambient
      // crowd still happen — they consult registry footprints individually so
      // they naturally land on the shoreline.
      const inWater = chunkInLake(ctx.cxWorld, ctx.czWorld);
      if (!inWater) {
        THEME_BUILDERS[theme](ctx);
      }

      // Scatter trees — will dodge the buildings + lake footprints registered.
      const treeDensity = inWater ? 0 : THEME_PROPS[theme].treeDensity;
      scatterTrees(ctx, treeDensity);

      // Ambient crowd
      const crowdCount = inWater ? 0 : THEME_PROPS[theme].ambientCrowd;
      spawnAmbientCrowd(ctx, crowdCount);
    }

    this.scene.add(group);
    this.loaded.set(key, { group, cx, cz, theme });
  }
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

// ---------- Theme picking ----------

function pickTheme(cx, cz) {
  if (cx === 0 && cz === 0) return 'main_stage';

  const dist = Math.hypot(cx, cz);
  // Closer to origin: denser/more interesting; far: more groves and lawns.
  const rng = mulberry32(hash2(cx, cz, 1));
  const r = rng();

  // INNER ring (chunks immediately around the main stage): keep this band
  // light on stages so spawn doesn't feel cluttered with concert decks. The
  // main stage already lives at (0,0) — neighbors should be food/vendors
  // and ambient lawn, with at most an occasional smaller stage.
  if (dist <= 1.5) {
    if (r < 0.05) return 'tent_stage';     // rare
    if (r < 0.12) return 'side_stage';     // was 35% → 7%
    if (r < 0.35) return 'food_plaza';
    if (r < 0.65) return 'vendor_row';
    if (r < 0.80) return 'drum_circle';
    if (r < 0.92) return 'grove';
    return 'open_lawn';
  }
  if (dist <= 3.5) {
    if (r < 0.08) return 'tent_stage';
    if (r < 0.18) return 'side_stage';     // was 25% → 10%
    if (r < 0.36) return 'food_plaza';
    if (r < 0.58) return 'vendor_row';
    if (r < 0.72) return 'drum_circle';
    if (r < 0.90) return 'grove';
    return 'open_lawn';
  }
  // Outer rings — keep stages discoverable far from spawn.
  if (r < 0.05) return 'tent_stage';
  if (r < 0.13) return 'side_stage';
  if (r < 0.23) return 'food_plaza';
  if (r < 0.33) return 'drum_circle';
  if (r < 0.47) return 'vendor_row';
  if (r < 0.75) return 'grove';
  return 'open_lawn';
}

const THEME_PROPS = {
  main_stage:  { treeDensity: 0.15, ambientCrowd: 30 },
  side_stage:  { treeDensity: 0.25, ambientCrowd: 16 },
  tent_stage:  { treeDensity: 0.10, ambientCrowd: 22 },   // dense crowd inside
  food_plaza:  { treeDensity: 0.2,  ambientCrowd: 14 },
  vendor_row:  { treeDensity: 0.3,  ambientCrowd: 13 },
  drum_circle: { treeDensity: 0.4,  ambientCrowd: 12 },
  grove:       { treeDensity: 1.0,  ambientCrowd: 7 },
  open_lawn:   { treeDensity: 0.2,  ambientCrowd: 8 },
};

const THEME_BUILDERS = {
  main_stage: buildMainStage,
  side_stage: buildSideStage,
  tent_stage: buildTentStageTheme,
  food_plaza: buildFoodPlaza,
  vendor_row: buildVendorRow,
  drum_circle: buildDrumCircle,
  grove: buildGrove,
  open_lawn: buildOpenLawn,
};

// ---------- Path placement ----------

function placePaths(ctx) {
  // Two dirt trails through the chunk — they enter/exit at the chunk's edge
  // midpoints (so they always connect with neighbors) but wiggle in between
  // so they don't read as a perfect grid. Each chunk's wiggle is seeded by
  // (cx, cz) so it's deterministic + consistent on reload.
  //
  // Skip paths if any lake intersects this chunk — water has its own causeway
  // and we don't want paths submerging into the lake.
  if (chunkOverlapsLake(ctx.cxWorld, ctx.czWorld, CHUNK_SIZE / 2)) return;

  const pathColor = 0xb89570;
  const mat = new THREE.MeshStandardMaterial({
    color: pathColor,
    roughness: 1,
    metalness: 0,
    // polygonOffset pulls the path "toward camera" in depth so it draws on top
    // of the ground even when the terrain has tiny variations. depthWrite off
    // prevents the path from blocking decals stacked above it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });

  // E-W trail: enters at (cxWorld - chunk/2, czWorld), exits at (cxWorld + chunk/2, czWorld)
  const ewMesh = buildCurvedPath(
    ctx.cxWorld - CHUNK_SIZE / 2 - 1, ctx.czWorld,
    ctx.cxWorld + CHUNK_SIZE / 2 + 1, ctx.czWorld,
    5,   // width
    ctx.rng,
    mat,
  );
  ctx.group.add(ewMesh);

  // N-S trail
  const nsMesh = buildCurvedPath(
    ctx.cxWorld, ctx.czWorld - CHUNK_SIZE / 2 - 1,
    ctx.cxWorld, ctx.czWorld + CHUNK_SIZE / 2 + 1,
    5,
    ctx.rng,
    mat,
  );
  ctx.group.add(nsMesh);

  // A small dirt pad at the intersection — kept circular as a visual anchor.
  const padGeo = new THREE.CircleGeometry(5, 16);
  const pad = new THREE.Mesh(padGeo, mat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(ctx.cxWorld, 0.06, ctx.czWorld);
  ctx.group.add(pad);

  // Register path waypoints for NPCs (chunk-local + 4 edge points)
  registry.add({
    kind: 'path_node',
    position: new THREE.Vector3(ctx.cxWorld, 0, ctx.czWorld),
    footprint: 0,
    attractor: { radius: 6, weight: 0.5 },
    chunkKey: ctx.key,
  });
}

// Builds a flat ribbon mesh from (x1,z1) to (x2,z2) that follows a gentle
// curve. The curve is a Catmull-Rom through jittered interior control points
// (deterministic via the passed rng), and the ribbon has constant width with
// edges offset perpendicular to the local tangent. Lying flat at y=0.06.
export function buildCurvedPath(x1, z1, x2, z2, width, rng, material) {
  const segments = 16;
  const halfW = width / 2;

  // Build control points: start, 3 jittered interior, end.
  const lineLen = Math.hypot(x2 - x1, z2 - z1);
  const tangent = { x: (x2 - x1) / lineLen, z: (z2 - z1) / lineLen };
  const perpendicular = { x: -tangent.z, z: tangent.x };
  const maxOffset = Math.min(width * 1.5, lineLen * 0.10); // wiggle amplitude

  const ctrl = [{ x: x1, z: z1 }];
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const baseX = x1 + tangent.x * lineLen * t;
    const baseZ = z1 + tangent.z * lineLen * t;
    const off = (rng() - 0.5) * 2 * maxOffset;
    ctrl.push({ x: baseX + perpendicular.x * off, z: baseZ + perpendicular.z * off });
  }
  ctrl.push({ x: x2, z: z2 });

  const curve = new THREE.CatmullRomCurve3(
    ctrl.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    false,
    'catmullrom',
    0.5,
  );

  // Build ribbon: for each step along the curve, emit two vertices offset
  // perpendicularly by ±halfW.
  const verts = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPoint(t);
    const tg = curve.getTangent(t);
    // Perpendicular in XZ plane (rotate tangent 90° around Y).
    const px = -tg.z;
    const pz = tg.x;
    verts.push(p.x + px * halfW, 0, p.z + pz * halfW); // left
    verts.push(p.x - px * halfW, 0, p.z - pz * halfW); // right
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, material);
  mesh.position.y = 0.06;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- Tree scattering ----------

function scatterTrees(ctx, density) {
  const targetCount = Math.floor(density * 18);
  let placed = 0;
  let tries = 0;
  while (placed < targetCount && tries < targetCount * 5) {
    tries++;
    const x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE - 6);
    const z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE - 6);
    // Avoid the path strip and existing buildings
    if (Math.abs(x - ctx.cxWorld) < 4 && Math.abs(z - ctx.czWorld) < CHUNK_SIZE * 0.5) continue;
    if (Math.abs(z - ctx.czWorld) < 4 && Math.abs(x - ctx.cxWorld) < CHUNK_SIZE * 0.5) continue;
    if (registry.closestBuilding(new THREE.Vector3(x, 0, z), 2.5)) continue;

    const tree = buildTree(ctx.rng);
    tree.position.set(x, 0, z);
    tree.rotation.y = ctx.rng() * Math.PI * 2;
    ctx.group.add(tree);

    registry.add({
      kind: 'tree',
      position: new THREE.Vector3(x, 0, z),
      footprint: 1.2,
      attractor: { radius: 4, weight: 0.15 },
      chunkKey: ctx.key,
    });
    placed++;
  }
}

// ---------- Theme builders ----------

function buildMainStage(ctx) {
  const x = ctx.cxWorld;
  const z = ctx.czWorld - 20; // slightly off center in the chunk
  buildStage(ctx, x, z, true);
  buildEntranceArch(ctx, x, ctx.czWorld + 30);
  // Add string lights along the main path
  for (let s = -25; s <= 25; s += 16) {
    placePolePair(ctx, x - 18, ctx.czWorld + s, x + 18, ctx.czWorld + s);
  }
}

function buildSideStage(ctx) {
  const x = ctx.cxWorld + (ctx.rng() - 0.5) * 10;
  const z = ctx.czWorld + (ctx.rng() - 0.5) * 10;
  buildStage(ctx, x, z, false);
}

// Tent stage chunk theme — drops the big white-tent stage at the chunk
// center, registers wall colliders, attractor, and dense crowd inside.
function buildTentStageTheme(ctx) {
  const tex = leafBannerTextures('#fff4d0', '#6fcf6a', '#ffd28a');
  const tent = buildTentStage({ rng: ctx.rng, leafTexture: tex });
  // Random yaw so tent openings face different directions across chunks.
  const yaw = ctx.rng() * Math.PI * 2;
  tent.group.position.set(ctx.cxWorld, 0, ctx.czWorld);
  tent.group.rotation.y = yaw;
  ctx.group.add(tent.group);

  // Track the tent's stage lights with the rest of the light show.
  for (const lens of tent.stageLights) {
    stageLightLenses.push({
      lens, chunkKey: ctx.key, baseColor: lens.material.color.getHex(),
    });
  }
  // ...and its audience-facing beams. The tent stage's world position is the
  // chunk center (tent.group.position is set to cxWorld/czWorld above).
  if (tent.stageBeams) {
    const tentWorldPos = new THREE.Vector3(ctx.cxWorld, 0, ctx.czWorld);
    for (const b of tent.stageBeams) {
      stageBeamRefs.push({ ...b, chunkKey: ctx.key, scale: tent.stageScale || 1.0, stageWorldPos: tentWorldPos });
    }
  }

  // Helper: rotate a local (lx, lz) into world coordinates given the yaw.
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const worldXZ = (lx, lz) => ({
    x: ctx.cxWorld + lx * cosY + lz * sinY,
    z: ctx.czWorld + -lx * sinY + lz * cosY,
  });

  // Stage colliders: re-use the inscribed-spheres approach from buildStage.
  // Local stage coordinates are at tent.stagePos.
  const w = tent.stageWidth;
  const d = tent.stageDepth;
  const sphereR = 2.5;
  const innerW = Math.max(0.001, w - sphereR * 2);
  const innerD = Math.max(0.001, d - sphereR * 2);
  const cols = Math.max(2, Math.ceil(innerW / 3.5) + 1);
  const rows = Math.max(2, Math.ceil(innerD / 3.5) + 1);
  for (let cc = 0; cc < cols; cc++) {
    for (let rr = 0; rr < rows; rr++) {
      const localX = tent.stagePos.x + (-innerW / 2 + (cc / (cols - 1)) * innerW);
      const localZ = tent.stagePos.z + (-innerD / 2 + (rr / (rows - 1)) * innerD);
      const w3 = worldXZ(localX, localZ);
      registry.add({
        kind: 'stage',
        position: new THREE.Vector3(w3.x, 1, w3.z),
        footprint: sphereR,
        collider: { radius: sphereR, damage: 9 },
        chunkKey: ctx.key,
      });
    }
  }

  // Tent pole colliders so Zerble bounces off the four corners.
  const halfW = tent.width / 2;
  const halfD = tent.depth / 2;
  for (const [lx, lz] of [
    [-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD],
  ]) {
    const w3 = worldXZ(lx, lz);
    registry.add({
      kind: 'tent',
      position: new THREE.Vector3(w3.x, 0, w3.z),
      footprint: 0.5,
      collider: { radius: 0.5, damage: 3 },
      chunkKey: ctx.key,
    });
  }

  // Soundbooth platform collider (so Zerble can't drive through the mixer)
  {
    const w3 = worldXZ(tent.mixerPos.x, tent.mixerPos.z);
    registry.add({
      kind: 'tent',
      position: new THREE.Vector3(w3.x, 0.5, w3.z),
      footprint: 1.4,
      collider: { radius: 1.4, damage: 5 },
      attractor: { radius: 3, weight: 0.6 },
      chunkKey: ctx.key,
    });
  }

  // Attractor in front of the stage so crowds gather there even outside the
  // tent placement loop below.
  {
    const w3 = worldXZ(0, tent.stagePos.z + d / 2 + 4);
    registry.add({
      kind: 'stage_front',
      position: new THREE.Vector3(w3.x, 0, w3.z),
      footprint: 0,
      attractor: { radius: 10, weight: 2.5 },
      chunkKey: ctx.key,
    });
  }

  // Spawn the in-tent crowd directly so they actually appear inside the tent
  // (the ambient-crowd pass spawns globally on the chunk, which would scatter
  // them across the grass too).
  if (ctx.crowd) {
    for (const spot of tent.crowdSpots) {
      const w3 = worldXZ(spot.x, spot.z);
      ctx.crowd.spawn({
        pos: new THREE.Vector3(w3.x, 0, w3.z),
        chunkKey: ctx.key,
        rng: ctx.rng,
      });
    }
    // Sound engineer at the mixer
    const m3 = worldXZ(tent.mixerPos.x, tent.mixerPos.z + 0.6);
    ctx.crowd.spawn({
      pos: new THREE.Vector3(m3.x, 0, m3.z),
      chunkKey: ctx.key,
      rng: ctx.rng,
    });
  }

  // Spatial music — same brass style the tent vibes with.
  const musicSeed = hash2(ctx.cx * 13 + 23, ctx.cz * 19 + 17);
  const m3 = worldXZ(0, tent.stagePos.z);
  const handle = Sound.attachStageMusic(m3.x, 4, m3.z, musicSeed, 'jam');
  if (handle) stageMusic.push({ handle, chunkKey: ctx.key });
}

function buildFoodPlaza(ctx) {
  // 3-5 food trucks arranged around a central area. Trucks are scaled up
  // visually (FOOD_TRUCK_SCALE) — push the ring outward + scale colliders to
  // match so we don't end up parked-on-truck-roof.
  const count = 3 + Math.floor(ctx.rng() * 3);
  const centerX = ctx.cxWorld;
  const centerZ = ctx.czWorld;
  const ring = 14 * FOOD_TRUCK_SCALE;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + ctx.rng() * 0.4;
    const x = centerX + Math.cos(ang) * ring;
    const z = centerZ + Math.sin(ang) * ring;
    const truck = buildFoodTruck(ctx.rng);
    truck.position.set(x, 0, z);
    truck.rotation.y = Math.atan2(centerX - x, centerZ - z); // face inward
    ctx.group.add(truck);

    registry.add({
      kind: 'truck',
      position: new THREE.Vector3(x, 1.5 * FOOD_TRUCK_SCALE, z),
      footprint: 4.4 * FOOD_TRUCK_SCALE,
      collider: { radius: 3.6 * FOOD_TRUCK_SCALE, damage: 12 },
      attractor: { radius: 8 * FOOD_TRUCK_SCALE, weight: 1.2 },
      chunkKey: ctx.key,
    });
  }
}

function buildVendorRow(ctx) {
  // Two parallel rows of tents along one axis. Tent canopies are ~3.2m
  // radius; tight spacing (~5m) keeps adjacent canopies nearly touching so
  // the row reads as a real market stall lineup, not isolated tents.
  const axisH = ctx.rng() < 0.5;
  const count = 5 + Math.floor(ctx.rng() * 3);
  const spacing = 5.0;
  const rowOffset = 7;
  for (let i = 0; i < count; i++) {
    for (const side of [-1, 1]) {
      const t = i - (count - 1) / 2;
      const x = ctx.cxWorld + (axisH ? t * spacing : side * rowOffset);
      const z = ctx.czWorld + (axisH ? side * rowOffset : t * spacing);
      const tent = buildTent(ctx.rng);
      tent.position.set(x, 0, z);
      tent.rotation.y = axisH ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2);
      ctx.group.add(tent);

      registry.add({
        kind: 'tent',
        position: new THREE.Vector3(x, 0, z),
        footprint: 2.6,
        collider: { radius: 2.2, damage: 5 },
        attractor: { radius: 4, weight: 0.5 },
        chunkKey: ctx.key,
      });
    }
  }
}

function buildDrumCircle(ctx) {
  // A small fire pit + bench ring + a big drum
  const x = ctx.cxWorld + (ctx.rng() - 0.5) * 8;
  const z = ctx.czWorld + (ctx.rng() - 0.5) * 8;

  // Fire (emissive)
  const fire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.6, 1),
    new THREE.MeshStandardMaterial({
      color: 0xff7733,
      emissive: 0xff5511,
      emissiveIntensity: 2.5,
      roughness: 0.8,
    })
  );
  fire.position.set(x, 0.6, z);
  ctx.group.add(fire);

  // Stones around fire
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const sx = x + Math.cos(ang) * 1.4;
    const sz = z + Math.sin(ang) * 1.4;
    const stone = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.3 + ctx.rng() * 0.15, 0),
      new THREE.MeshStandardMaterial({ color: 0x6a6a78, roughness: 1, flatShading: true })
    );
    stone.position.set(sx, 0.3, sz);
    stone.castShadow = true;
    ctx.group.add(stone);
  }

  // Big djembe drum
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.55, 1.4, 14),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9, flatShading: true })
  );
  drum.position.set(x + 3, 0.7, z + 1);
  drum.castShadow = true;
  ctx.group.add(drum);

  registry.add({
    kind: 'drum_circle',
    position: new THREE.Vector3(x, 0, z),
    footprint: 1.5,
    collider: { radius: 1.2, damage: 4 },
    attractor: { radius: 12, weight: 2.2 },
    chunkKey: ctx.key,
  });

  // Polyrhythmic drum music, anchored at the fire pit. Lower pan height than
  // stages so it feels grounded.
  const drumSeed = hash2(ctx.cx * 13 + 7, ctx.cz * 17 + 11);
  const handle = Sound.attachStageMusic(x, 1, z, drumSeed, 'drum');
  if (handle) stageMusic.push({ handle, chunkKey: ctx.key });
}

function buildGrove(ctx) {
  // Already covered by tree scattering — add a hammock or two
  const count = 1 + Math.floor(ctx.rng() * 2);
  for (let i = 0; i < count; i++) {
    const x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.6);
    const z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.6);
    if (Math.abs(x - ctx.cxWorld) < 6 && Math.abs(z - ctx.czWorld) < 6) continue;
    buildHammock(ctx, x, z);
  }
  // Sprinkle a small campsite in some groves — feels like festival-goers
  // pitched tents under the trees.
  scatterChunkCampsites(ctx, { chance: 0.5, max: 2 });
}

function buildOpenLawn(ctx) {
  // Picnic blankets
  const count = 1 + Math.floor(ctx.rng() * 3);
  for (let i = 0; i < count; i++) {
    const x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.7);
    const z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.7);
    const colors = [0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff, 0xff8a5b];
    const blanket = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshStandardMaterial({
        color: colors[Math.floor(ctx.rng() * colors.length)],
        roughness: 0.9,
        side: THREE.DoubleSide,
      })
    );
    blanket.rotation.x = -Math.PI / 2;
    blanket.position.set(x, 0.06, z);
    blanket.rotation.z = ctx.rng() * Math.PI * 2;
    ctx.group.add(blanket);

    registry.add({
      kind: 'picnic',
      position: new THREE.Vector3(x, 0, z),
      footprint: 0,
      attractor: { radius: 3, weight: 0.4 },
      chunkKey: ctx.key,
    });
  }
  // Open lawns are prime camping ground — most of them get a tent or two.
  scatterChunkCampsites(ctx, { chance: 0.65, max: 2 });
}

// ---------- Festival-ground campsite scatter ----------
//
// Sprinkles 0-N small campsites across the chunk. Called from open_lawn /
// grove theme builders so the festival has tents pitched here and there in
// the open areas, not just inside forests.
//
// Skips positions near the chunk-grid path (so cars can still drive through)
// and near any registered building/stage/lake. Animatables (firepit + torch
// flicker) reuse the forestAnimatables list — naming aside, it's a generic
// "chunk-bound campsite animatables" sink.
function scatterChunkCampsites(ctx, { chance = 0.5, max = 2 } = {}) {
  if (ctx.rng() > chance) return;
  const count = 1 + Math.floor(ctx.rng() * max);
  for (let i = 0; i < count; i++) {
    // Stay off the path strip — paths run along chunk-grid midlines, so any
    // position within ±4m of either axis is on a path.
    let chosen = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.7);
      const z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE * 0.7);
      if (Math.abs(x - ctx.cxWorld) < 6 || Math.abs(z - ctx.czWorld) < 6) continue;
      // Bail if any registered building is within 4m — keeps tents from
      // jamming into stages, food trucks, etc.
      if (registry.closestBuilding(new THREE.Vector3(x, 0, z), 4)) continue;
      chosen = { x, z };
      break;
    }
    if (!chosen) continue;

    const camp = buildCampsite(ctx.rng, 'small');
    camp.group.position.set(chosen.x, 0, chosen.z);
    camp.group.rotation.y = ctx.rng() * Math.PI * 2;
    ctx.group.add(camp.group);

    if (camp.animatables && camp.animatables.length > 0) {
      forestAnimatables.push({ chunkKey: ctx.key, animatables: camp.animatables });
    }

    registry.add({
      kind: 'campsite',
      position: new THREE.Vector3(chosen.x, 0, chosen.z),
      footprint: camp.footprint,
      attractor: { radius: 4, weight: 0.5 },
      chunkKey: ctx.key,
    });
  }
}


// ---------- Reusable builders ----------

function buildStage(ctx, x, z, isMain) {
  // ----- Visual model — the deck, banner, truss, speakers, lights -----
  // Per-stage scale gives the festival real variety. Main stage gets a
  // mild boost (1.15-1.4) because it anchors spawn; side stages range from
  // 1.0 to 1.5x for more obvious differences.
  const scale = isMain
    ? 1.15 + ctx.rng() * 0.25
    : 1.0 + ctx.rng() * 0.5;
  const leafTex = isMain ? leafBannerTextures('#fff4d0', '#6fcf6a', '#ffd28a') : null;
  const stage = buildStageModel({ isMain, leafTexture: leafTex, rng: ctx.rng, scale });
  stage.group.position.set(x, 0, z);
  // Match the original orientation: the front (banner side) faces -Z so the
  // crowd attractor in +Z is "in front" of the stage.
  ctx.group.add(stage.group);

  const w = stage.deckWidth;
  const d = stage.deckDepth;
  const h = stage.deckHeight;
  // Track lens meshes for the day-night light show
  for (const lens of stage.stageLights) {
    stageLightLenses.push({ lens, chunkKey: ctx.key, baseColor: lens.material.color.getHex() });
  }
  // Track audience-facing spotlight beams. Store the stage's world position
  // so the spotlight pool can rank beams by distance to Zerble each frame.
  const stageWorldPos = new THREE.Vector3(x, 0, z);
  for (const b of stage.stageBeams) {
    stageBeamRefs.push({ ...b, chunkKey: ctx.key, scale, stageWorldPos });
  }

  // ----- Colliders: spheres INSCRIBED in the deck rectangle -----
  // Sphere radius scales with the stage so larger stages have proportionally
  // larger spheres (still inscribed, never extending past the visible deck).
  const sphereR = 2.5 * scale;
  const collDamage = isMain ? 14 : 9;
  const innerW = Math.max(0.001, w - sphereR * 2);
  const innerD = Math.max(0.001, d - sphereR * 2);
  // Use spacing of ~3.5m * scale so spheres overlap on bigger stages too.
  const cols = Math.max(2, Math.ceil(innerW / (3.5 * scale)) + 1);
  const rows = Math.max(2, Math.ceil(innerD / (3.5 * scale)) + 1);
  for (let cc = 0; cc < cols; cc++) {
    for (let rr = 0; rr < rows; rr++) {
      const lx = -innerW / 2 + (cc / (cols - 1)) * innerW;
      const lz = -innerD / 2 + (rr / (rows - 1)) * innerD;
      registry.add({
        kind: 'stage',
        position: new THREE.Vector3(x + lx, 1, z + lz),
        footprint: sphereR,
        collider: { radius: sphereR, damage: collDamage },
        chunkKey: ctx.key,
      });
    }
  }

  // Attractor in front of the stage so crowds gather there (scaled too).
  registry.add({
    kind: 'stage_front',
    position: new THREE.Vector3(x, 0, z + d / 2 + 6 * scale),
    footprint: 0,
    attractor: { radius: 14 * scale, weight: isMain ? 3.5 : 2.0 },
    chunkKey: ctx.key,
  });

  // ----- Spatial music for this stage -----
  // Seed mixes chunk coords + stage flag so main vs side stages get distinct music.
  const musicSeed = hash2(ctx.cx * 7 + (isMain ? 1 : 2), ctx.cz * 11 + (isMain ? 3 : 5));
  const handle = Sound.attachStageMusic(x, 4, z, musicSeed, isMain ? 'jam' : 'brass');
  if (handle) stageMusic.push({ handle, chunkKey: ctx.key });

  // ----- The band on stage -----
  // Main stage gets a bigger ensemble (6 performers). Side stages get a trio.
  // placeBandOnStage adds the performers as children of stage.group at LOCAL
  // coords; we record world-space positions via stage.group's transform so the
  // animator can wiggle them around the stage's height/yaw.
  const instruments = isMain
    ? ['lead_vocal', 'guitar', 'guitar', 'bass', 'drum', 'sax']
    : ['lead_vocal', 'guitar', 'drum'];
  const performers = placeBandOnStage(stage.group, instruments, {
    deckWidth: w, deckDepth: d, deckHeight: h, rng: ctx.rng,
  });
  for (const performer of performers) {
    stagePerformers.push({
      group: performer,
      chunkKey: ctx.key,
      baseY: h,
      baseYaw: Math.PI,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

// EntranceArch wrapper — uses the model and registers post colliders.
function buildEntranceArch(ctx, x, z) {
  const arch = buildEntranceArchModel(leafBannerTextures('#fff4d0', '#ff6f9c', '#ffe066'));
  arch.position.set(x, 0, z);
  ctx.group.add(arch);

  registry.add({
    kind: 'arch',
    position: new THREE.Vector3(x - 6, 1, z),
    footprint: 0.8,
    collider: { radius: 1.0, damage: 4 },
    chunkKey: ctx.key,
  });
  registry.add({
    kind: 'arch',
    position: new THREE.Vector3(x + 6, 1, z),
    footprint: 0.8,
    collider: { radius: 1.0, damage: 4 },
    chunkKey: ctx.key,
  });
}

// Hammock wrapper — uses the model and registers the entry crowd.js consults.
function buildHammock(ctx, x, z) {
  const { group, seatPos, yaw } = buildHammockModel(x, z, ctx.rng);
  ctx.group.add(group);

  registry.add({
    kind: 'hammock',
    position: new THREE.Vector3(x, 0, z),
    footprint: 1.6,
    attractor: { radius: 3, weight: 0.6 },
    chunkKey: ctx.key,
    hammock: { seatPos, yaw, occupied: false },
  });
}

// Sandbox helper — back-compat with the old export shape (returns a Group).
export function buildHammockStandalone(x, z, rng = Math.random) {
  const { group } = buildHammockModel(x, z, rng);
  group.name = 'sandbox-hammock';
  return group;
}

function placePolePair(ctx, ax, az, bx, bz) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a1f3a, roughness: 0.7, flatShading: true });
  const h = 6;
  for (const [px, pz] of [[ax, az], [bx, bz]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, h, 8), poleMat);
    pole.position.set(px, h / 2, pz);
    pole.castShadow = true;
    ctx.group.add(pole);
    registry.add({
      kind: 'lamppost',
      position: new THREE.Vector3(px, 0, pz),
      footprint: 0.5,
      collider: { radius: 0.4, damage: 2 },
      chunkKey: ctx.key,
    });
  }
  const startTop = new THREE.Vector3(ax, h - 0.1, az);
  const endTop = new THREE.Vector3(bx, h - 0.1, bz);
  const mid = startTop.clone().add(endTop).multiplyScalar(0.5);
  mid.y -= 0.6 + startTop.distanceTo(endTop) * 0.02;
  const curve = new THREE.QuadraticBezierCurve3(startTop, mid, endTop);

  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 12, 0.03, 4, false),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  ctx.group.add(cable);

  const bulbHues = [0xffd28a, 0xff6f9c, 0x8ecae6, 0x6fcf6a, 0xc77dff, 0xffd166];
  const bulbGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const p = curve.getPoint(t);
    const hue = bulbHues[i % bulbHues.length];
    const bulb = new THREE.Mesh(
      bulbGeo,
      new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 1.2 })
    );
    bulb.position.copy(p);
    bulb.position.y -= 0.13;
    ctx.group.add(bulb);
  }
}

// ---------- Crowd spawning ----------

function spawnAmbientCrowd(ctx, count) {
  if (!ctx.crowd || count <= 0) return;

  // Collect attractors that live in this chunk so we can cluster crowds around them.
  const chunkAttractors = [];
  for (const e of registry.byChunk(ctx.key)) {
    if (e.attractor && e.attractor.weight >= 0.5) chunkAttractors.push(e);
  }

  for (let i = 0; i < count; i++) {
    let x, z;
    let tries = 0;
    do {
      // 70% chance to spawn near an attractor (if any), 30% random in chunk
      if (chunkAttractors.length > 0 && ctx.rng() < 0.7) {
        const att = chunkAttractors[Math.floor(ctx.rng() * chunkAttractors.length)];
        const a = ctx.rng() * Math.PI * 2;
        const r = Math.sqrt(ctx.rng()) * att.attractor.radius;
        x = att.position.x + Math.cos(a) * r;
        z = att.position.z + Math.sin(a) * r;
      } else {
        x = ctx.cxWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE - 8);
        z = ctx.czWorld + (ctx.rng() - 0.5) * (CHUNK_SIZE - 8);
      }
      tries++;
    } while (registry.closestBuilding(new THREE.Vector3(x, 0, z), 1.5) && tries < 6);

    ctx.crowd.spawn({
      pos: new THREE.Vector3(x, 0, z),
      chunkKey: ctx.key,
      rng: ctx.rng,
    });
  }
}
