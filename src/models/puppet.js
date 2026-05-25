// Giant street-creature puppet — handler underneath holds a pole topped with
// a floating creature body (head + eyes + mouth + arms + collar).
// children[0] is the floating body (so callers can bob it).

import * as THREE from 'three';

export function buildPuppet(seed = 0) {
  const g = new THREE.Group();

  const hueA = (seed * 0.37) % 1;
  const colorA = new THREE.Color().setHSL(hueA, 0.75, 0.55).getHex();
  const colorB = new THREE.Color().setHSL((hueA + 0.5) % 1, 0.75, 0.6).getHex();

  // Floating creature body (held aloft)
  const body = new THREE.Group();
  body.position.y = 4;

  // Head (large oblong)
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.2, 1),
    new THREE.MeshStandardMaterial({ color: colorA, roughness: 0.8, flatShading: true })
  );
  head.scale.set(1, 1.25, 1);
  head.castShadow = true;
  body.add(head);

  // Big white eyes with black pupils
  for (const ex of [-0.45, 0.45]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    );
    eye.position.set(ex, 0.2, -0.95);
    body.add(eye);

    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x000000 })
    );
    pupil.position.set(ex, 0.2, -1.15);
    body.add(pupil);
  }

  // Mouth (open, dark)
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.25, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x222035 })
  );
  mouth.position.set(0, -0.45, -1.05);
  body.add(mouth);

  // Floppy arms — two cylinders hanging from the sides. Trailing colored
  // ribbons stream from each hand for the parade-creature vibe.
  for (const ax of [-1.2, 1.2]) {
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.12, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: colorB, roughness: 0.9, flatShading: true })
    );
    arm.position.set(ax, -1.2, 0);
    arm.rotation.z = ax > 0 ? -0.25 : 0.25;
    arm.castShadow = true;
    body.add(arm);

    // Three streamers per hand, in different colors.
    const handY = -1.2 - Math.cos(0.25) * 1.2;
    const handX = ax + Math.sin(ax > 0 ? -0.25 : 0.25) * 1.2;
    const streamerColors = [0xff5577, 0xffe066, 0x66ff88, 0x66d9ff, 0xc080ff];
    for (let k = 0; k < 3; k++) {
      const len = 1.4 + Math.random() * 0.8;
      const cone = new THREE.ConeGeometry(0.04, len, 4, 1);
      cone.translate(0, -len / 2, 0);
      const stream = new THREE.Mesh(
        cone,
        new THREE.MeshStandardMaterial({
          color: streamerColors[((seed * 3 + k) | 0) % streamerColors.length],
          roughness: 0.8,
          flatShading: true,
        }),
      );
      stream.position.set(handX + (k - 1) * 0.06, handY, 0);
      stream.rotation.z = (Math.random() - 0.5) * 0.4;
      stream.rotation.x = (Math.random() - 0.5) * 0.3;
      body.add(stream);
    }
  }

  // 50% of the time: antennae poking out the top of the head (variation).
  if ((seed * 1.7) % 1 < 0.5) {
    const antennaMat = new THREE.MeshStandardMaterial({
      color: colorB, roughness: 0.6, flatShading: true,
    });
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0xffe066, emissive: 0xffe066, emissiveIntensity: 1.0,
      roughness: 0.3,
    });
    for (const ax of [-0.35, 0.35]) {
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), antennaMat,
      );
      antenna.position.set(ax, 1.55, 0);
      antenna.rotation.z = -ax * 0.6;
      body.add(antenna);
      const tip = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.13, 0), tipMat,
      );
      tip.position.set(ax * 1.45, 1.85, 0);
      body.add(tip);
    }
  }

  // Frilly collar
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.18, 8, 16),
    new THREE.MeshStandardMaterial({ color: colorB, roughness: 0.9, flatShading: true })
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = -1;
  body.add(collar);

  g.add(body);

  // Handler underneath
  const handler = buildSimpleNPC(0x222033, 0xe6c098);
  handler.position.y = 0;
  g.add(handler);

  // Pole connecting handler to puppet body
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 3.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.95 })
  );
  pole.position.y = 2.8;
  g.add(pole);

  return g;
}

// Compact NPC builder used inside other models (puppet handler, band
// members, parasol marshal). Now includes legs + arms so the silhouette
// reads as a person instead of a capsule pill. Optional opts.armPose lets
// the band member tilt arms to grip an instrument.
export function buildSimpleNPC(shirtHex, skinHex, opts = {}) {
  const { armPose = 'rest', pantsHex = 0x223a5c } = opts;
  const g = new THREE.Group();

  const shirtMat = new THREE.MeshStandardMaterial({
    color: shirtHex, roughness: 0.9, flatShading: true,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: skinHex, roughness: 0.9, flatShading: true,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: pantsHex, roughness: 0.92, flatShading: true,
  });

  // ----- Legs -----
  for (const lx of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.65, 8),
      pantsMat,
    );
    leg.position.set(lx, 0.32, 0);
    leg.castShadow = true;
    g.add(leg);
    // Shoes
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.07, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 }),
    );
    shoe.position.set(lx, 0.03, -0.06);
    g.add(shoe);
  }

  // ----- Torso -----
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.55, 4, 8),
    shirtMat,
  );
  torso.position.y = 1.0;
  torso.castShadow = true;
  g.add(torso);

  // ----- Arms — two upper (sleeve) + lower (skin) segments per side -----
  for (const sx of [-1, 1]) {
    const armGroup = new THREE.Group();
    armGroup.position.set(sx * 0.30, 1.20, 0);
    // Pose: 'rest' = hanging straight, 'instrument' = bent forward to grip
    let upperZ = 0;
    let lowerZ = 0;
    if (armPose === 'instrument') {
      // Positive X rotation swings the arm forward (toward -Z, where the face looks).
      // Negative was a bug — it pushed arms behind the body.
      armGroup.rotation.x = 0.6;
      lowerZ = -0.10;
    }
    armGroup.rotation.z = sx * 0.05;
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.30, 4, 6), shirtMat,
    );
    upper.position.set(0, -0.18, upperZ);
    armGroup.add(upper);
    const lower = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.28, 4, 6), skinMat,
    );
    lower.position.set(0, -0.50, lowerZ);
    armGroup.add(lower);
    armGroup.castShadow = true;
    g.add(armGroup);
  }

  // ----- Head -----
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.26, 1), skinMat,
  );
  head.position.y = 1.65;
  head.castShadow = true;
  g.add(head);

  // ----- Face dots — two eyes facing local -Z (forward) -----
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 });
  for (const ex of [-0.08, 0.08]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), eyeMat);
    eye.position.set(ex, 1.68, -0.22);
    g.add(eye);
  }

  return g;
}
