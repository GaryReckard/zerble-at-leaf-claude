// Stage performer — a musician with body, head, hat, and instrument.
// Returns a Group. Caller positions/rotates.

import * as THREE from 'three';

const SHIRT_COLORS = [0xff6f9c, 0xffd28a, 0xb285ff, 0x66d9ff, 0x6fcf6a, 0xff8a5b];

export function buildPerformer(instrument, rng = Math.random) {
  const g = new THREE.Group();
  const shirt = SHIRT_COLORS[Math.floor(rng() * SHIRT_COLORS.length)];

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.1, 4, 8),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85, flatShading: true })
  );
  body.position.y = 0.9;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 1),
    new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true })
  );
  head.position.y = 1.75;
  head.castShadow = true;
  g.add(head);

  const brass = new THREE.MeshStandardMaterial({
    color: 0xe8b042, roughness: 0.4, metalness: 0.85, flatShading: true,
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
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), wood);
    neck.position.set(-0.55, 1.25, -0.45);
    neck.rotation.z = -0.4;
    g.add(neck);
    const head2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.06), wood);
    head2.position.set(-0.95, 1.45, -0.5);
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
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), wood);
    neck.position.set(-0.6, 1.2, -0.45);
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
