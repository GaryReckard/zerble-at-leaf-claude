// LEAF-true drum circle assembly — the centrepiece of forests with
// `interiorContent === 'drum_circle'`. Per Gary's reference (Camp Rockwood
// circle at Lake Eden Arts Festival):
//
//   * Raised stone firepit, ~2.3m radius (≈7.5ft diameter), about 0.4m tall
//   * Cone of stacked logs on top, smouldering by day, blazing at night
//   * Emissive fire mesh + a warm point light that lifts every nearby trunk
//     and bench out of the dark when night falls
//   * Three concentric semicircular log benches, opening side facing the
//     entrance path so the drummers face the player AND the fire — the
//     reviewer was right that the original spec had this backwards
//
// Returned object exposes the few mutable bits a central updater needs each
// frame (fire mesh, point light, log cone for scale). Use updateLeafDrumCircle
// to advance them against nightness + a flicker phase. Per-frame work per
// drum circle is small (one scale set + two material poke + one light poke).
//
// Collision footprints/colliders are returned alongside; callers register
// them in the world registry so Zerble takes damage if he drives into the
// firepit (a hot stone wall, damage 9 like a stage) and bounces off the
// outer bench ring (radius 6, mild damage 4).

import * as THREE from 'three';

// Shared materials. The fire/glow materials are NOT shared — each circle gets
// its own so they pulse on independent phases.
const STONE_MAT = new THREE.MeshStandardMaterial({
  color: 0x7a7785, roughness: 1.0, flatShading: true,
});
const BENCH_LOG_MAT = new THREE.MeshStandardMaterial({
  color: 0x6a4628, roughness: 0.95, flatShading: true,
});
const FIRE_LOG_MAT = new THREE.MeshStandardMaterial({
  color: 0x3a2818, roughness: 1.0, flatShading: true,
});

const FIREPIT_RADIUS = 2.3;
const FIREPIT_HEIGHT = 0.42;
const LOG_CONE_HEIGHT = 2.2;
const LOG_COUNT = 8;
const FIRE_BASE_HEIGHT = 2.0;
const FIRE_BASE_RADIUS = 1.0;

// First bench ring at 5.5m gives ~3.2m of clearance from the firepit edge
// (2.3m radius) — enough room for the dancer orbit (~3.5m radius) to circle
// the fire without clipping into the front row of drummers.
const BENCH_RADII = [5.5, 6.5, 7.5];
const BENCH_LOG_LEN = 1.4;
const BENCH_LOG_R = 0.22;
const BENCH_Y = 0.40;

// Half-log geometry — a half-cylinder with flat top + rounded bottom.
// Earlier the benches were full hexagonal cylinders which read like raw
// fence posts laid sideways. Gary wanted the silhouette of a log split in
// half (think a sit-able bench), flat side up. Built once at module load
// and shared by every bench segment so the GPU only stores it once.
const _halfLogShape = (() => {
  const s = new THREE.Shape();
  s.moveTo(-BENCH_LOG_R, 0);
  s.lineTo(BENCH_LOG_R, 0);
  // absarc(centerX, centerY, radius, startAngle, endAngle, clockwise)
  s.absarc(0, 0, BENCH_LOG_R, 0, -Math.PI, true);
  return s;
})();
const _halfLogGeo = new THREE.ExtrudeGeometry(_halfLogShape, {
  depth: BENCH_LOG_LEN,
  bevelEnabled: false,
  curveSegments: 5,
});
// Centre the geometry on its midpoint so log.position is the centre of the
// log (matches how the placement loop expects coords).
_halfLogGeo.translate(0, 0, -BENCH_LOG_LEN / 2);

// Build the assembly. `facingAngle` is the world angle (radians, atan2-style)
// pointing FROM the fire toward the path entry. The bench semicircle opens
// on that side, so as Zerble drives in the drummers face him across the fire.
export function buildLeafDrumCircle(rng = Math.random, opts = {}) {
  const facingAngle = opts.facingAngle ?? 0;
  const group = new THREE.Group();
  group.name = 'leafDrumCircle';

  // ---- Raised stone firepit ----
  // Short cylinder base + ring of irregular boulders. The cylinder gives
  // the visible "stone wall" silhouette; boulders break up the rim so it
  // doesn't read as a perfect machined ring.
  const baseGeo = new THREE.CylinderGeometry(
    FIREPIT_RADIUS, FIREPIT_RADIUS + 0.15, FIREPIT_HEIGHT, 18,
  );
  const base = new THREE.Mesh(baseGeo, STONE_MAT);
  base.position.y = FIREPIT_HEIGHT / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // Rim boulders — 14-16 irregular icospheres sitting on top of the base
  // edge so the silhouette reads as natural rocks, not concrete.
  const rimCount = 14 + Math.floor(rng() * 3);
  for (let i = 0; i < rimCount; i++) {
    const a = (i / rimCount) * Math.PI * 2 + rng() * 0.15;
    const stone = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18 + rng() * 0.12, 0),
      STONE_MAT,
    );
    stone.position.set(
      Math.cos(a) * FIREPIT_RADIUS,
      FIREPIT_HEIGHT + 0.05 + rng() * 0.05,
      Math.sin(a) * FIREPIT_RADIUS,
    );
    stone.rotation.y = rng() * Math.PI * 2;
    stone.castShadow = true;
    group.add(stone);
  }

  // ---- Log cone ----
  // 8 cylinders leaning inward, butts on the firepit rim, tips meeting at
  // a point ~2.2m above the base. Each log is rotated so its long axis
  // points from rim → apex.
  const logCone = new THREE.Group();
  logCone.name = 'logCone';
  const apexY = FIREPIT_HEIGHT + LOG_CONE_HEIGHT;
  for (let i = 0; i < LOG_COUNT; i++) {
    const a = (i / LOG_COUNT) * Math.PI * 2;
    const baseX = Math.cos(a) * (FIREPIT_RADIUS * 0.6);
    const baseZ = Math.sin(a) * (FIREPIT_RADIUS * 0.6);
    const logLen = Math.hypot(baseX, apexY - FIREPIT_HEIGHT) + 0.4;

    // Cylinder default long axis = +Y. We want the log oriented from
    // (baseX, FIREPIT_HEIGHT, baseZ) up to (0, apexY, 0). Build it
    // centred at the midpoint with the right tilt.
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, logLen, 6),
      FIRE_LOG_MAT,
    );
    const midX = baseX * 0.5;
    const midZ = baseZ * 0.5;
    const midY = (FIREPIT_HEIGHT + apexY) / 2;
    log.position.set(midX, midY, midZ);
    // Tilt = angle from +Y to the (rim→apex) vector
    const horizDist = Math.hypot(baseX, baseZ);
    const tilt = Math.atan2(horizDist, apexY - FIREPIT_HEIGHT);
    // Rotate around the axis perpendicular to the lean direction.
    // Lean direction in XZ is (baseX, baseZ); perpendicular axis is
    // (-baseZ, 0, baseX) normalised. Apply rotation via Quaternion.
    const axis = new THREE.Vector3(-baseZ, 0, baseX).normalize();
    log.quaternion.setFromAxisAngle(axis, tilt);
    log.castShadow = true;
    logCone.add(log);
  }
  group.add(logCone);

  // ---- Emissive fire mesh ----
  // Cone of soft orange that scales with nightness. The base radius shrinks
  // to nothing during the day so it reads as embers, not a flame.
  const fireMat = new THREE.MeshStandardMaterial({
    color: 0xffb04a,
    emissive: 0xff5a1a,
    emissiveIntensity: 2.5,
    roughness: 0.4,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const fireGeo = new THREE.ConeGeometry(FIRE_BASE_RADIUS, FIRE_BASE_HEIGHT, 10);
  const fireMesh = new THREE.Mesh(fireGeo, fireMat);
  fireMesh.position.y = FIREPIT_HEIGHT + FIRE_BASE_HEIGHT / 2;
  group.add(fireMesh);

  // Glowing ember bed at the base of the cone — visible during the day
  // when the flame mesh fades out, so the firepit never reads "cold".
  const emberMat = new THREE.MeshStandardMaterial({
    color: 0xff7733,
    emissive: 0xff4011,
    emissiveIntensity: 2.0,
    roughness: 0.7,
  });
  const ember = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 1),
    emberMat,
  );
  ember.position.y = FIREPIT_HEIGHT + 0.15;
  ember.scale.set(1.4, 0.5, 1.4);
  group.add(ember);

  // ---- PointLight ----
  // Warm orange, decay 2 (realistic falloff). Intensity ramps with nightness
  // from a barely-there 0.4 daylight value up to 5.5 at full night. Caller
  // is responsible for not adding this to too many drum circles at once —
  // PointLight on MeshStandardMaterial is a per-fragment cost on every
  // standard material in range.
  const fireLight = new THREE.PointLight(0xffaa55, 0.4, 22, 2);
  fireLight.position.set(0, FIREPIT_HEIGHT + 1.4, 0);
  // No shadows — point-light shadow maps are 6x the cost of directional and
  // we already use the sun for the world's main shadow pass.
  fireLight.castShadow = false;
  group.add(fireLight);

  // ---- Three-row bench semicircle ----
  // Centreline opposite the entrance: drummers face the fire and the
  // arriving player. Each ring is a row of discrete log cylinders so the
  // silhouette reads as "logs laid end-to-end" rather than a smooth torus.
  const benchCentre = facingAngle + Math.PI;
  for (let ring = 0; ring < BENCH_RADII.length; ring++) {
    const r = BENCH_RADII[ring];
    const arcLen = Math.PI * r;                  // semicircle arc length
    const logCountInRing = Math.max(5, Math.round(arcLen / (BENCH_LOG_LEN * 1.1)));
    for (let i = 0; i < logCountInRing; i++) {
      // Spread evenly across the half-circle.
      const t = (i + 0.5) / logCountInRing;        // 0..1 across the arc
      const a = benchCentre - Math.PI / 2 + t * Math.PI;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;

      // Half-log: ExtrudeGeometry already lays the log along Z with flat
      // top up. Just rotate around Y to align the long axis with the
      // bench arc's tangent at this point.
      const log = new THREE.Mesh(_halfLogGeo, BENCH_LOG_MAT);
      log.position.set(cx, BENCH_Y, cz);
      log.rotation.y = -a + (Math.sin(i * 7.3 + ring) * 0.06);
      log.castShadow = true;
      group.add(log);

      // Small wedge supports under each end so the log doesn't visibly
      // float. Only on every other log to keep mesh count down.
      if (i % 2 === 0) {
        const support = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.08, 0.35, 5),
          BENCH_LOG_MAT,
        );
        support.position.set(cx + Math.cos(a + Math.PI / 2) * 0.5, 0.18, cz + Math.sin(a + Math.PI / 2) * 0.5);
        group.add(support);
      }
    }
  }

  // ---- Smoke column (discoverability beacon) ----
  // Tall semi-transparent grey cylinder rising from the firepit. Visible
  // above the tree canopy from outside the forest, so a player can spot
  // "ah, there's a fire over there" from far away. Catches the warm fire
  // PointLight at night, giving a subtle orange tint near the base.
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0xc6c4c0,
    transparent: true,
    opacity: 0.0,           // animator sets this each frame
    depthWrite: false,
    flatShading: true,
  });
  const smoke = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.9, 18, 8, 4, true),
    smokeMat,
  );
  smoke.position.y = FIREPIT_HEIGHT + 9;
  group.add(smoke);

  // ---- Spark particles ----
  // Pre-allocated pool of tiny emissive spheres rising from the firepit.
  // Cheap — 14 meshes that recycle in place. Each spark has its own state
  // updated by the animator: position, age, lifetime, drift.
  const sparkMat = new THREE.MeshStandardMaterial({
    color: 0xffd066,
    emissive: 0xffa033,
    emissiveIntensity: 3.0,
    transparent: true,
    opacity: 0,
  });
  const sparkGeo = new THREE.SphereGeometry(0.04, 4, 3);
  const sparks = [];
  const SPARK_COUNT = 14;
  for (let i = 0; i < SPARK_COUNT; i++) {
    const m = new THREE.Mesh(sparkGeo, sparkMat.clone());
    m.material.opacity = 0;
    m.position.set(0, FIREPIT_HEIGHT + 0.8, 0);
    group.add(m);
    sparks.push({
      mesh: m,
      // Stagger initial ages so the pool doesn't burst all-at-once on the
      // first frame.
      age: rng() * 2.0,
      lifetime: 1.4 + rng() * 1.2,
      driftX: (rng() - 0.5) * 0.12,
      driftZ: (rng() - 0.5) * 0.12,
      rise: 1.6 + rng() * 0.8,
    });
  }

  // Caller animates these per frame.
  return {
    group,
    fireMesh, fireMat,
    ember, emberMat,
    logCone,
    fireLight,
    smoke, smokeMat,
    sparks,
    // Each circle's flicker is offset by its own seed so multiple circles
    // visible at once don't pulse in lockstep.
    phase: rng() * Math.PI * 2,
    // Hard collider hints — caller registers with the world registry.
    firepitCollider: { radius: FIREPIT_RADIUS, damage: 9 },
    benchCollider: { radius: BENCH_RADII[BENCH_RADII.length - 1] + 0.4, damage: 4 },
  };
}

// Per-frame animator. Call once per visible drum circle, passing the
// current time in seconds and the world's nightness (0..1). Cheap — pure
// scalar math + four uniform writes.
export function updateLeafDrumCircle(t, nightness, dc) {
  if (!dc) return;
  // ---- Fire mesh scale ----
  // Daytime: cone barely visible (small ember). Night: full 2m blaze with
  // a slight breathing wobble + faster flicker on top.
  const scaleY = 0.20 + 0.80 * nightness + 0.06 * Math.sin(t * 4 + dc.phase);
  const scaleXZ = 0.40 + 0.60 * nightness + 0.04 * Math.sin(t * 7 + dc.phase * 0.7);
  dc.fireMesh.scale.set(scaleXZ, scaleY, scaleXZ);
  // Fade flame opacity along with size — at full day, opacity drops so the
  // ember mesh shows through instead of a cold-looking transparent cone.
  dc.fireMat.opacity = THREE.MathUtils.clamp(0.25 + nightness * 0.7, 0.05, 0.95);
  dc.fireMat.emissiveIntensity = 1.8 + 2.0 * nightness + 0.3 * Math.sin(t * 9 + dc.phase);

  // ---- Ember bed ----
  // Embers pulse on a slower cycle, brighter relative scale during the day
  // so the "this thing is still hot" read holds when the flame is dim.
  const emberBoost = 0.7 + 0.3 * (1 - nightness);
  dc.emberMat.emissiveIntensity = (1.5 + 1.2 * nightness) * emberBoost
    * (0.85 + 0.15 * Math.sin(t * 5 + dc.phase * 1.3));

  // ---- PointLight ----
  // Linear ramp 0.4 → 5.5 with mild flicker noise. Distance + decay stay fixed.
  dc.fireLight.intensity = (0.4 + 5.1 * nightness) * (0.9 + 0.10 * Math.sin(t * 12 + dc.phase));

  // ---- Log cone vertical scale ----
  // Subtle — at full day the cone shrinks to ~80% so it reads less like a
  // bonfire and more like a campfire ring with kindling. Not zero, so the
  // structure is always visible.
  const coneScale = 0.78 + 0.22 * nightness;
  dc.logCone.scale.y = coneScale;

  // ---- Smoke column ----
  // Opacity ramps with nightness so the beacon's strongest after dark.
  // During the day there's still a thin wisp (chimney effect over hot
  // embers) but it's barely visible.
  if (dc.smokeMat) {
    dc.smokeMat.opacity = 0.06 + 0.22 * nightness;
  }

  // ---- Spark particles ----
  // Each spark rises from the firepit, drifts a little, fades, and recycles.
  // Sparks are mostly invisible during the day (gated on nightness) so they
  // don't read as random orange dots in broad daylight.
  if (dc.sparks) {
    const sparkAlphaScale = Math.max(0, (nightness - 0.3) / 0.5);
    // Approximate dt from sin variation — fine since spark motion doesn't
    // need sample-accurate timing. Closure over t lets us compute dt from
    // a stored prev-t on dc; first frame we just skip.
    const lastT = dc._sparkLastT ?? t;
    const dt = Math.max(0, Math.min(0.05, t - lastT));
    dc._sparkLastT = t;
    for (let i = 0; i < dc.sparks.length; i++) {
      const s = dc.sparks[i];
      s.age += dt;
      if (s.age >= s.lifetime) {
        // Respawn at firepit centre
        s.age = 0;
        s.mesh.position.x = (Math.random() - 0.5) * 0.8;
        s.mesh.position.z = (Math.random() - 0.5) * 0.8;
        s.mesh.position.y = 0.8;   // base height — relative to drum-circle group origin
        s.driftX = (Math.random() - 0.5) * 0.20;
        s.driftZ = (Math.random() - 0.5) * 0.20;
        s.rise = 1.6 + Math.random() * 0.8;
        s.lifetime = 1.4 + Math.random() * 1.2;
      } else {
        s.mesh.position.x += s.driftX * dt;
        s.mesh.position.z += s.driftZ * dt;
        s.mesh.position.y += s.rise * dt;
      }
      // Alpha curve — fade in fast, hold, fade out
      const k = s.age / s.lifetime;
      const fade = k < 0.15 ? (k / 0.15) : (1 - (k - 0.15) / 0.85);
      s.mesh.material.opacity = Math.max(0, fade) * sparkAlphaScale;
    }
  }
}
