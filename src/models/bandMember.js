// Marching brass band member — NPC with a hat + a brass-colored instrument.
// children[0] is the body (caller bobs it for the marching anim).

import * as THREE from 'three';
import { buildSimpleNPC } from './puppet.js';

export function buildBandMember(instrument) {
  const g = new THREE.Group();
  const body = buildSimpleNPC(
    instrument === 'drum' ? 0x6a2a2a : 0xc77dff,
    0xe6c098
  );
  g.add(body);

  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.35, 12),
    new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 })
  );
  hat.position.set(0, 2.05, 0);
  g.add(hat);
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12),
    new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 })
  );
  brim.position.set(0, 1.9, 0);
  g.add(brim);

  const brass = new THREE.MeshStandardMaterial({
    color: 0xe8b042,
    roughness: 0.4,
    metalness: 0.85,
    flatShading: true,
  });

  if (instrument === 'tuba') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.18, 10, 16), brass);
    ring.position.set(0, 1.4, -0.5);
    g.add(ring);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.7, 14, 1, true), brass);
    bell.position.set(0, 2.0, -0.5);
    bell.rotation.x = Math.PI;
    g.add(bell);
  } else if (instrument === 'drum') {
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 0.7, flatShading: true })
    );
    drum.rotation.x = Math.PI / 2;
    drum.position.set(0, 1.2, -0.5);
    g.add(drum);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.72, 0.1, 16),
      new THREE.MeshStandardMaterial({ color: 0xff6f9c })
    );
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 1.2, -0.5);
    g.add(band);
    // Drumsticks crossed over the head
    const stickMat = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.9 });
    for (const sx of [-0.18, 0.18]) {
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6), stickMat,
      );
      stick.position.set(sx, 1.55, -0.18);
      stick.rotation.x = -0.6;
      stick.rotation.z = sx > 0 ? -0.2 : 0.2;
      g.add(stick);
    }
  } else if (instrument === 'sax') {
    const body2 = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.95, 10), brass);
    body2.position.set(0.35, 1.35, -0.4);
    body2.rotation.z = -0.35;
    g.add(body2);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 12, 1, true), brass);
    bell.position.set(0.55, 1.9, -0.4);
    bell.rotation.z = -0.35;
    g.add(bell);
  } else if (instrument === 'trombone') {
    // Slide trombone — long thin tube + bell forward
    const slide = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8), brass);
    slide.rotation.z = Math.PI / 2;
    slide.position.set(0.4, 1.45, -0.45);
    g.add(slide);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.35, 12, 1, true), brass);
    bell.rotation.z = Math.PI / 2;
    bell.position.set(1.05, 1.45, -0.45);
    g.add(bell);
  } else {
    // trumpet (default)
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.85, 8), brass);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(0, 1.5, -0.45);
    g.add(tube);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 12, 1, true), brass);
    bell.rotation.z = Math.PI / 2;
    bell.position.set(0.5, 1.5, -0.45);
    g.add(bell);
  }

  return g;
}
