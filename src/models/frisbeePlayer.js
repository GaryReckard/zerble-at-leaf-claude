// Frisbee player — a festivalgoer mid-throw/catch pose.
//
// Structure:
//   group
//     children[0] = body (Group containing legs/torso/head/arms)
//     userData.armPivots = { left, right }  — caller may rotate these to
//       switch between "ready to catch" (arms up + out) and "tracking the
//       disc" poses. We keep the default pose at arms-up-and-out which reads
//       fine for both throwing and catching.
//
// Built off the same proportions as crowd NPCs (scale ≈ 1m torso, 1.65m head)
// so a frisbee player walking next to a regular festivalgoer looks consistent.

import * as THREE from 'three';

const SHIRT_PALETTE = [
  0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff,
  0xff8a5b, 0x39d6c4, 0xffd23f, 0xff4d8d,
];
const PANTS_PALETTE = [0x223a5c, 0x4a3a6a, 0x2d5d3e, 0x6a4a2a, 0x1a1a2a];
const SKIN_PALETTE = [0xe6c098, 0xd1a070, 0xb37e5a, 0x8a5a3a];
const HAT_PALETTE = [0xff5577, 0x33d9ff, 0xc080ff, 0x6fcf6a, 0xffe066, 0x222];

export function buildFrisbeePlayer(rng = Math.random) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const shirtColor = SHIRT_PALETTE[Math.floor(rng() * SHIRT_PALETTE.length)];
  const pantsColor = PANTS_PALETTE[Math.floor(rng() * PANTS_PALETTE.length)];
  const skinColor = SKIN_PALETTE[Math.floor(rng() * SKIN_PALETTE.length)];

  const skinMat = new THREE.MeshStandardMaterial({
    color: skinColor, roughness: 0.9, flatShading: true,
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: shirtColor, roughness: 0.85, flatShading: true,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: pantsColor, roughness: 0.9, flatShading: true,
  });

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.65, 8);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, pantsMat);
    leg.position.set(sx * 0.12, 0.325, 0);
    leg.castShadow = true;
    body.add(leg);
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.07, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 }),
    );
    shoe.position.set(sx * 0.12, 0.035, -0.06);
    body.add(shoe);
  }

  // Torso
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.55, 4, 8),
    shirtMat,
  );
  torso.position.y = 1.0;
  torso.castShadow = true;
  body.add(torso);

  // Arms — both raised, ready to throw or catch. Left arm pivot up + out,
  // right arm pivot up + out + slightly forward (catching/throwing arm).
  const armPivots = { left: null, right: null };
  for (const sx of [-1, 1]) {
    const armGroup = new THREE.Group();
    armGroup.position.set(sx * 0.28, 1.18, 0);
    // Up + outward
    armGroup.rotation.z = sx * -0.90;
    armGroup.rotation.x = sx > 0 ? -0.30 : -0.05;  // right arm forward more
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.32, 4, 6),
      shirtMat,
    );
    upper.position.y = -0.18;
    armGroup.add(upper);
    const lower = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, 0.34, 4, 6),
      skinMat,
    );
    lower.position.y = -0.52;
    armGroup.add(lower);
    const hand = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 0), skinMat,
    );
    hand.position.y = -0.74;
    armGroup.add(hand);
    body.add(armGroup);
    if (sx > 0) armPivots.right = armGroup; else armPivots.left = armGroup;
  }

  // Head
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.26, 1),
    skinMat,
  );
  head.position.y = 1.65;
  head.castShadow = true;
  body.add(head);

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 });
  for (const ex of [-0.085, 0.085]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), eyeMat);
    eye.position.set(ex, 1.68, -0.22);
    body.add(eye);
  }

  // Hair / cap — 50/50
  if (rng() < 0.5) {
    const hatColor = HAT_PALETTE[Math.floor(rng() * HAT_PALETTE.length)];
    const hatMat = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.8, flatShading: true });
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.10, 14),
      hatMat,
    );
    cap.position.y = 1.82;
    body.add(cap);
    const brim = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.03, 0.16),
      hatMat,
    );
    brim.position.set(0, 1.78, -0.22);
    body.add(brim);
  } else {
    const hairColor = [0x3a2a1a, 0x6a4a2a, 0xc97a3b, 0xd9a26e, 0x222][Math.floor(rng() * 5)];
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 1, flatShading: true });
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7),
      hairMat,
    );
    cap.position.y = 1.65;
    body.add(cap);
  }

  g.userData.armPivots = armPivots;
  g.userData.bodyGroup = body;
  g.userData.bobPhase = Math.random() * 10;
  return g;
}

// Per-frame idle bob — small breathing motion when the player isn't
// running. Caller (Frisbees.update / sandbox) drives motion + lookAt;
// this just adds the subtle "alive" hop. ~4cm peaks, no excitement.
export function tickFrisbeePlayer(model, dt) {
  const u = model.userData;
  if (!u.bodyGroup) return;
  const t = performance.now() * 0.004 + u.bobPhase;
  u.bodyGroup.position.y = Math.abs(Math.sin(t)) * 0.04;
}

// Builds a small frisbee disc — flat-ish cylinder with a colored rim. Returns
// a Group whose origin is the disc's center; the caller positions/orients it.
//
// userData.discMat is exposed so the caller (Frisbees.update / sandbox) can
// bump emissiveIntensity at night for a glow-in-the-dark effect — same trick
// the hula-hoop uses.
export function buildFrisbeeDisc(rng = Math.random) {
  const g = new THREE.Group();
  const palette = [0xff5577, 0xffd23f, 0x66d9ff, 0xc080ff, 0xffffff, 0xff7b3c, 0x6fcf6a];
  const color = palette[Math.floor(rng() * palette.length)];
  const discMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.05,       // dim by day; caller bumps to ~3 at night
    roughness: 0.55,
    metalness: 0.05,
    flatShading: true,
  });
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.025, 18),
    discMat,
  );
  g.add(disc);
  g.userData.discMat = discMat;
  // Rim ring for a little visual pop
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.135, 0.012, 4, 18),
    new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.6 }),
  );
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  return g;
}

// Per-frame disc animation — spin + glow. The caller (Frisbees.update in
// the game, sandbox in the demo) drives the world position via held /
// flying / landed state. This just spins the disc at the appropriate
// rate (slow when held, fast when flying, settling when landed) and
// bumps the emissive for the glow-in-the-dark effect.
//
// `state`: 'held' | 'flying' | 'landed' — spin speed varies by state.
// `nightness`: 0..1 — ramps the disc's emissive intensity.
export function tickFrisbeeDisc(disc, dt, state, nightness = 0) {
  if (!disc) return;
  if (state === 'flying') {
    disc.rotation.y += dt * 14;            // fast spin in flight
  } else if (state === 'held') {
    disc.rotation.y += dt * 4;             // slow spin in hand
  }
  // landed: don't spin
  if (disc.userData.discMat) {
    disc.userData.discMat.emissiveIntensity = 0.05 + nightness * 3.0;
  }
}
