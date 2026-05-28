// Hula-hooper — festival-goer gyrating with a glowing hoop.
//
// Structure:
//   group
//     children[0] = body (Group containing legs/torso/head/arms) — caller tilts this for gyration
//     children[1] = hoopPivot (Group) — caller rotates this for hoop spin; hoop is its child
//   userData.hoopMat — emissive ring material, intensity bumped at night
//   userData.armBands — the two MeshStandardMaterials used for the arms so the
//     caller can keep them roughly synced with the body when desired
//   userData.bodyHeight — feet→shoulder distance (≈1.25); used for arm pose math
//
// Arms are baked in an "up and out" pose (like she's keeping the hoop spinning
// with the upper body) so we don't need per-frame arm rotations.
//
// Tie-dye / festival palette chosen to match the wook/crowd vibe.

import * as THREE from 'three';

const TIE_DYE_PALETTE = [
  0xff4d8d, 0xffd23f, 0x6fcf6a, 0x66d9ff, 0xc77dff,
  0xff7b3c, 0x39d6c4, 0xff5577, 0xb7ff5b, 0xffaef7,
];

const HOOP_GLOW_COLORS = [
  0xff44aa, 0x44ffd0, 0xffd23f, 0x9b6bff, 0x59ffa0, 0xff7b3c,
];

export function buildHulaHooper(rng = Math.random) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const shirtColor = TIE_DYE_PALETTE[Math.floor(rng() * TIE_DYE_PALETTE.length)];
  const accentColor = TIE_DYE_PALETTE[Math.floor(rng() * TIE_DYE_PALETTE.length)];
  const pantsColor = 0x2a2a3a + Math.floor(rng() * 0x101020);
  const skinColor = [0xe6c098, 0xd1a070, 0xb37e5a, 0x8a5a3a][Math.floor(rng() * 4)];

  const skinMat = new THREE.MeshStandardMaterial({
    color: skinColor, roughness: 0.9, flatShading: true,
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: shirtColor, roughness: 0.85, flatShading: true,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: pantsColor, roughness: 0.9, flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor, roughness: 0.85, flatShading: true,
  });

  // ----- Legs: two short pants cylinders, slight stance -----
  const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.55, 8);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, pantsMat);
    leg.position.set(sx * 0.11, 0.28, 0);
    leg.castShadow = true;
    body.add(leg);
    // Tiny shoes
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.06, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 }),
    );
    shoe.position.set(sx * 0.11, 0.03, -0.04);
    body.add(shoe);
  }

  // ----- Torso (crop top vibe — short capsule above bare midriff implied) -----
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.45, 4, 8),
    shirtMat,
  );
  torso.position.y = 0.95;
  torso.castShadow = true;
  body.add(torso);

  // ----- Arms held up and outward. -----
  //
  // Each arm is ONE rigid capsule (a long sleeve, no upper/lower split) plus
  // a hand sphere at the end. The armGroup hangs vertically along local -Y;
  // its Z rotation then swings the whole arm so locally-down lands as
  // up-and-out in world space.
  //
  // For the right arm we want world dir ≈ (+0.5, +0.866) (up + right). 2D
  // rotation of (0,-1) by +θ gives (sin θ, -cos θ); θ = 5π/6 (150°) gives
  // (+0.5, +0.866). The left arm mirrors with -5π/6.
  //
  // Single-capsule sleeves avoid any chance of forearm/upper-arm
  // misalignment that a two-segment build can produce when the rotation
  // chain is misread.
  const ARM_OUT = (5 * Math.PI) / 6;
  const ARM_LEN = 0.70;            // shoulder-to-hand sleeve length
  for (const sx of [-1, 1]) {
    const armGroup = new THREE.Group();
    armGroup.position.set(sx * 0.22, 1.20, 0);
    armGroup.rotation.z = sx * ARM_OUT;
    // Sleeve — one capsule from shoulder to hand
    const sleeve = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, ARM_LEN, 4, 8),
      shirtMat,
    );
    sleeve.position.y = -(ARM_LEN / 2 + 0.07);   // hangs straight down from shoulder
    armGroup.add(sleeve);
    // Hand at the far end
    const hand = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 0), skinMat,
    );
    hand.position.y = -(ARM_LEN + 0.16);
    armGroup.add(hand);
    body.add(armGroup);
  }

  // ----- Head -----
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.24, 1),
    skinMat,
  );
  head.position.y = 1.55;
  head.castShadow = true;
  body.add(head);

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 });
  for (const ex of [-0.08, 0.08]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
    eye.position.set(ex, 1.58, -0.20);
    body.add(eye);
  }

  // Hair — flat hemisphere skull cap that hugs the head. (Previously had a
  // chunky vertical capsule "ponytail" added behind the head — it stuck out
  // like an extra limb, so it's gone now.)
  const hairColor = [0x3a2a1a, 0x6a4a2a, 0xc97a3b, 0xd9a26e, 0x222, 0xff5577][Math.floor(rng() * 6)];
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 1, flatShading: true });
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    hairMat,
  );
  hairCap.position.y = 1.55;
  body.add(hairCap);

  // Headband (matches accent)
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.26, 0.025, 4, 16),
    accentMat,
  );
  band.position.y = 1.65;
  band.rotation.x = Math.PI / 2;
  body.add(band);

  // ----- Hoop -----
  // The hoop sits around the hips/waist. The hoopPivot is a separate child of
  // the top-level group (NOT a child of body) so the caller can tilt body for
  // hip gyration without dragging the hoop with it — the hoop stays roughly
  // horizontal and rotates on its own.
  const hoopPivot = new THREE.Group();
  hoopPivot.position.y = 0.85;       // hip height
  g.add(hoopPivot);

  const hoopGlowColor = HOOP_GLOW_COLORS[Math.floor(rng() * HOOP_GLOW_COLORS.length)];
  const hoopMat = new THREE.MeshStandardMaterial({
    color: hoopGlowColor,
    emissive: hoopGlowColor,
    emissiveIntensity: 0.05,        // dim by day; caller bumps to ~3 at night
    roughness: 0.5,
    metalness: 0.1,
  });
  const HOOP_RADIUS = 0.58;
  const hoop = new THREE.Mesh(
    new THREE.TorusGeometry(HOOP_RADIUS, 0.035, 6, 24),
    hoopMat,
  );
  hoop.rotation.x = Math.PI / 2;     // lay flat in the XZ plane
  hoopPivot.add(hoop);

  g.userData.hoopMat = hoopMat;
  g.userData.hoopRadius = HOOP_RADIUS;
  g.userData.hoopPivot = hoopPivot;
  g.userData.bodyGroup = body;
  // Per-hooper animation params. Picked once per build so every hooper has
  // a slightly different feel (some chill, some going harder). Range tuned
  // to real hooping tempo — hips at ~0.6-1.0 Hz, hoop at ~1.0-1.7 Hz.
  // (We use phase = rad/s. Body sway period = 2π / gyrSpeed.)
  g.userData.gyrSpeed     = 4 + Math.random() * 2.5;   // 4-6.5 rad/s → 0.64-1.03 Hz
  g.userData.hoopSpinMult = 1.3 + Math.random() * 0.7; // hoop is 1.3-2.0× hip rate
  g.userData.phase        = Math.random() * Math.PI * 2;

  return g;
}

// Per-frame animation tick. Pure function over the model + a phase value.
// Game (obstacles.js) and sandbox (sandbox.html) both call this so the
// motion definition lives in ONE place — no more drift between the two.
// `nightness` (0..1) drives the hoop's emissive bump.
//
// Body motion is a clean elliptical hip orbit (sin/cos at the same rate,
// 90° out of phase) rather than the prior irrational frequency ratio —
// the old math read as chaotic rather than as smooth hooping. The hoop
// spins independently at hoopSpinMult × the hip rate.
export function tickHulaHooper(model, dt, nightness = 0) {
  const u = model.userData;
  if (u.gyrSpeed === undefined) return;       // not a built hooper

  u.phase += dt * u.gyrSpeed;
  const p = u.phase;

  // Elliptical hip orbit — sin on Z (forward/back lean), cos on X (side
  // lean) at the same rate. Reads as a circular hip motion, not a
  // figure-8. Amplitudes are subtle (in radians) — the body leans,
  // doesn't lurch.
  u.bodyGroup.rotation.z = Math.sin(p) * 0.20;
  u.bodyGroup.rotation.x = Math.cos(p) * 0.20;
  // Tiny vertical bob at 2× hip rate (the body rises slightly at the
  // forward/back transit points). Kept small — 3cm peaks, easy to miss
  // but adds life when you do notice it.
  u.bodyGroup.position.y = Math.sin(p * 2) * 0.03;

  // Hoop — spins independently around its own axis + wobbles a hair so
  // it doesn't look perfectly rigid on the body. Same `p` so the
  // wobble syncs with the hips, just at different multiples.
  u.hoopPivot.rotation.y = p * u.hoopSpinMult;
  u.hoopPivot.rotation.x = Math.sin(p) * 0.08;
  u.hoopPivot.rotation.z = Math.cos(p) * 0.06;

  // Glow — dim by day, bright at night. Caller passes nightness 0..1.
  u.hoopMat.emissiveIntensity = 0.05 + nightness * 3.0;
}
