// Festival kid — a recognizable child silhouette (head, torso, arms, legs)
// rather than a one-piece capsule. children[0] is the body group so the
// caller can do a "lil hop" bob each frame.
//
// Variations baked in via rng: hairstyle (pigtails / cap / bare),
// outfit color, glow-stick accessory.

import * as THREE from 'three';

const SHIRT_PALETTE = [
  0xff5577, 0xffaa33, 0xffe066, 0x66ff88, 0x66d9ff, 0xc080ff,
  0xff8a5b, 0x8ecae6, 0xffb703,
];
const PANTS_PALETTE = [0x223a5c, 0x4a3a6a, 0x2d5d3e, 0x6a4a2a, 0x1a1a2a];
const HAIR_PALETTE = [0x3a2a1a, 0x6a4a2a, 0x8b5a2b, 0xd9a26e, 0xc97a3b, 0x222];
const SKIN_PALETTE = [0xe6c098, 0xd1a070, 0xb37e5a, 0x8a5a3a];
const HAT_PALETTE = [0xff5577, 0x33d9ff, 0xc080ff, 0x6fcf6a, 0xffe066];

export function buildKid(rng = Math.random) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const shirt = SHIRT_PALETTE[Math.floor(rng() * SHIRT_PALETTE.length)];
  const pants = PANTS_PALETTE[Math.floor(rng() * PANTS_PALETTE.length)];
  const hair = HAIR_PALETTE[Math.floor(rng() * HAIR_PALETTE.length)];
  const skin = SKIN_PALETTE[Math.floor(rng() * SKIN_PALETTE.length)];

  const shirtMat = new THREE.MeshStandardMaterial({
    color: shirt, roughness: 0.85, flatShading: true,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: pants, roughness: 0.9, flatShading: true,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: skin, roughness: 0.9, flatShading: true,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: hair, roughness: 1.0, flatShading: true,
  });

  // ----- Legs — two short pants-colored cylinders, slightly apart -----
  const legGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.45, 8);
  for (const lx of [-0.08, 0.08]) {
    const leg = new THREE.Mesh(legGeo, pantsMat);
    leg.position.set(lx, 0.23, 0);
    leg.castShadow = true;
    body.add(leg);
    // Tiny shoes
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.05, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 }),
    );
    shoe.position.set(lx, 0.025, -0.04);
    body.add(shoe);
  }

  // ----- Torso — capsule sized for a kid -----
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.16, 0.30, 4, 8),
    shirtMat,
  );
  torso.position.y = 0.65;
  torso.castShadow = true;
  body.add(torso);

  // ----- Arms — two thin capsules dangling at the sides -----
  const armGeo = new THREE.CapsuleGeometry(0.055, 0.32, 4, 6);
  for (const sx of [-1, 1]) {
    // Sleeve (shirt color, upper portion)
    const armGroup = new THREE.Group();
    const upper = new THREE.Mesh(armGeo, shirtMat);
    upper.scale.set(1, 0.55, 1);
    upper.position.y = -0.08;
    armGroup.add(upper);
    // Bare forearm (skin color)
    const lower = new THREE.Mesh(armGeo, skinMat);
    lower.scale.set(0.9, 0.55, 0.9);
    lower.position.y = -0.30;
    armGroup.add(lower);
    armGroup.position.set(sx * 0.20, 0.72, 0);
    armGroup.rotation.z = sx * 0.08;       // slight outward splay
    armGroup.castShadow = true;
    body.add(armGroup);
  }

  // ----- Head -----
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.18, 1),
    skinMat,
  );
  head.position.y = 1.00;
  head.castShadow = true;
  body.add(head);

  // Eyes — two tiny black dots facing forward
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 });
  for (const ex of [-0.06, 0.06]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), eyeMat);
    eye.position.set(ex, 1.03, -0.16);
    body.add(eye);
  }

  // ----- Hair / hat — one of three styles -----
  const hairRoll = rng();
  if (hairRoll < 0.30) {
    // Pigtails — two small spheres on the sides
    for (const sx of [-1, 1]) {
      const tail = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.07, 0),
        hairMat,
      );
      tail.position.set(sx * 0.16, 1.00, 0.05);
      body.add(tail);
    }
    // Hair cap on top
    const cap = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 1),
      hairMat,
    );
    cap.scale.set(1, 0.55, 1);
    cap.position.set(0, 1.10, 0);
    body.add(cap);
  } else if (hairRoll < 0.65) {
    // Baseball-style cap (festival kid)
    const hatColor = HAT_PALETTE[Math.floor(rng() * HAT_PALETTE.length)];
    const hatMat = new THREE.MeshStandardMaterial({
      color: hatColor, roughness: 0.7, flatShading: true,
    });
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14),
      hatMat,
    );
    cap.position.y = 1.14;
    body.add(cap);
    const brim = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.025, 0.10),
      hatMat,
    );
    brim.position.set(0, 1.10, -0.16);
    body.add(brim);
  } else {
    // Plain mussed hair — a half-sphere skull cap.
    const skullCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      hairMat,
    );
    skullCap.position.y = 1.00;
    body.add(skullCap);
    // A few unruly tufts
    for (let i = 0; i < 3; i++) {
      const tuft = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.04, 0), hairMat,
      );
      tuft.position.set(
        (rng() - 0.5) * 0.20,
        1.16 + rng() * 0.04,
        (rng() - 0.5) * 0.18,
      );
      body.add(tuft);
    }
  }

  // ----- Accessory: 50% glow stick / lightsaber, 25% balloon, 25% nothing -----
  const accRoll = rng();
  if (accRoll < 0.50) {
    const accColors = [0xff5577, 0xffe066, 0x66ff88, 0x66d9ff, 0xc080ff];
    const accColor = accColors[Math.floor(rng() * accColors.length)];
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6),
      new THREE.MeshStandardMaterial({
        color: accColor, emissive: accColor, emissiveIntensity: 1.4, roughness: 0.4,
      }),
    );
    stick.position.set(0.30, 0.85, 0);
    stick.rotation.z = -0.55;
    body.add(stick);
  } else if (accRoll < 0.75) {
    // Balloon on a string
    const balloonColor = SHIRT_PALETTE[Math.floor(rng() * SHIRT_PALETTE.length)];
    const string = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.55, 4),
      new THREE.MeshStandardMaterial({ color: 0x333, roughness: 0.9 }),
    );
    string.position.set(0.22, 1.05, 0);
    body.add(string);
    const balloon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 1),
      new THREE.MeshStandardMaterial({
        color: balloonColor, roughness: 0.5, emissive: balloonColor,
        emissiveIntensity: 0.25,
      }),
    );
    balloon.position.set(0.22, 1.42, 0);
    balloon.scale.set(1, 1.2, 1);
    body.add(balloon);
  }

  return g;
}
