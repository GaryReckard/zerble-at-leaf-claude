// Stage performer — a musician with body, head, hat, and instrument.
// Returns a Group. Caller positions/rotates.

import * as THREE from 'three';

const SHIRT_COLORS = [0xff6f9c, 0xffd28a, 0xb285ff, 0x66d9ff, 0x6fcf6a, 0xff8a5b];

export function buildPerformer(instrument, rng = Math.random) {
  const g = new THREE.Group();
  const shirt = SHIRT_COLORS[Math.floor(rng() * SHIRT_COLORS.length)];
  const shirtMat = new THREE.MeshStandardMaterial({
    color: shirt, roughness: 0.85, flatShading: true,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe6c098, roughness: 0.9, flatShading: true,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2a, roughness: 0.92, flatShading: true,
  });

  // Legs — performers stand on stage in pants.
  for (const lx of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.70, 8), pantsMat,
    );
    leg.position.set(lx, 0.35, 0);
    leg.castShadow = true;
    g.add(leg);
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.07, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 }),
    );
    // -z = forward (eyes look at -z). Shoe sticks out in front of the leg.
    shoe.position.set(lx, 0.035, -0.06);
    g.add(shoe);
  }

  // Torso.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.55, 4, 8), shirtMat,
  );
  body.position.y = 1.10;
  body.castShadow = true;
  g.add(body);

  // Arms — two-segment with a real elbow pivot so the forearm stays attached
  // when the shoulder rotates. Shoulder bends forward (+x), forearm bends a
  // bit more so the hands meet roughly in front of the chest.
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.30, 1.30, 0);
    shoulder.rotation.x = 0.5;        // +x rotation swings the arm toward -z (forward)
    shoulder.rotation.z = sx * 0.05;
    // Upper arm hangs from shoulder; capsule center is half its length below.
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.30, 4, 6), shirtMat,
    );
    upper.position.y = -0.18;
    shoulder.add(upper);
    // Elbow pivot at the bottom of the upper arm.
    const elbow = new THREE.Group();
    elbow.position.y = -0.36;
    elbow.rotation.x = 0.5;           // forearm bends further forward at the elbow
    shoulder.add(elbow);
    const lower = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.30, 4, 6), skinMat,
    );
    lower.position.y = -0.18;         // hangs below the elbow pivot, attached
    elbow.add(lower);
    shoulder.castShadow = true;
    g.add(shoulder);
  }

  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.28, 1), skinMat,
  );
  head.position.y = 1.80;
  head.castShadow = true;
  g.add(head);
  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 });
  for (const ex of [-0.09, 0.09]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat);
    eye.position.set(ex, 1.83, -0.24);
    g.add(eye);
  }

  const brass = new THREE.MeshStandardMaterial({
    color: 0xe8b042, roughness: 0.4, metalness: 0.85, flatShading: true,
    // DoubleSide so the openEnded sax bell cone renders from the open-mouth
    // side too (otherwise back-faces get culled and the bell looks transparent).
    side: THREE.DoubleSide,
  });
  const black = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.6, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9, flatShading: true });

  if (instrument === 'guitar') {
    const guitarBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.7, 0.15),
      new THREE.MeshStandardMaterial({
        color: [0x9b3b2a, 0x4a6f2a, 0x222244, 0xc28a44][Math.floor(rng() * 4)],
        roughness: 0.5, flatShading: true,
      })
    );
    guitarBody.position.set(0.15, 1.0, -0.35);
    guitarBody.rotation.z = -0.4;
    g.add(guitarBody);
    // Neck — HORIZONTAL shaft along x, sticking out from the body's upper end.
    // Long axis is x (1.0), thin on y + z (0.09). rotation.z tilts it the same
    // direction as the body so the whole instrument reads as one rigid object.
    const neck = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.09, 0.09), wood);
    neck.position.set(-0.45, 1.30, -0.4);
    neck.rotation.z = -0.4;
    g.add(neck);
    // Headstock at the far end of the neck.
    const head2 = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.18, 0.06), wood);
    head2.position.set(-0.95, 1.40, -0.42);
    head2.rotation.z = -0.4;
    g.add(head2);
  } else if (instrument === 'bass') {
    const bassBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.85, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x1a3658, roughness: 0.5, flatShading: true })
    );
    bassBody.position.set(0.1, 0.9, -0.35);
    bassBody.rotation.z = -0.35;
    g.add(bassBody);
    // Neck — horizontal shaft along x (was vertical, which read as a flagpole).
    const neck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.10, 0.10), wood);
    neck.position.set(-0.55, 1.25, -0.40);
    neck.rotation.z = -0.35;
    g.add(neck);
  } else if (instrument === 'drum') {
    const kick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 0.7, flatShading: true })
    );
    kick.rotation.x = Math.PI / 2;
    kick.position.set(0, 0.6, -0.6);
    g.add(kick);
    const tom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.4, 12),
      new THREE.MeshStandardMaterial({ color: 0xc97a3b, roughness: 0.7, flatShading: true })
    );
    tom.position.set(0.45, 1.25, -0.55);
    g.add(tom);
    const cymbal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.03, 16),
      brass
    );
    cymbal.position.set(-0.5, 1.65, -0.55);
    cymbal.rotation.x = -0.15;
    g.add(cymbal);
  } else if (instrument === 'sax') {
    const body2 = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.95, 10), brass);
    body2.position.set(0.25, 1.25, -0.35);
    body2.rotation.z = -0.35;
    g.add(body2);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 12, 1, true), brass);
    bell.position.set(0.45, 1.8, -0.35);
    bell.rotation.z = -0.35;
    g.add(bell);
  } else {
    // lead_vocal: mic on a stand
    const standBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.05, 12), black);
    standBase.position.set(0, 0.025, -0.4);
    g.add(standBase);
    const standPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 8), black);
    standPole.position.set(0, 0.8, -0.4);
    g.add(standPole);
    const mic = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), black);
    mic.position.set(0, 1.55, -0.4);
    g.add(mic);
  }

  return g;
}
