// Marching brass band member — NPC with a hat + a brass-colored instrument.
// children[0] is the body (caller bobs it for the marching anim).

import * as THREE from 'three';
import { buildSimpleNPC } from './puppet.js';

export function buildBandMember(instrument, seed = 0) {
  const g = new THREE.Group();
  // Marching uniform shirt + black trousers. Arms pose forward to grip
  // the instrument; the drummer keeps relaxed arms (sticks live on the
  // drum).
  const armPose = instrument === 'drum' ? 'rest' : 'instrument';
  const body = buildSimpleNPC(
    instrument === 'drum' ? 0x6a2a2a : 0xc77dff,
    0xe6c098,
    { armPose, pantsHex: 0x1a1a2a },
  );
  g.add(body);

  // Per-member hat variation — deterministic from seed.
  // Hat is parented to `body` so it bobs with marching animation.
  // Head center is at y=1.65 within body; hat sits just above at y=2.05.
  const hatRoll = ((seed * 2654435761) >>> 0) / 0x100000000; // simple hash → [0,1)
  if (hatRoll < 0.34) {
    // NO HAT — ~34% of band members go bare-headed.
  } else if (hatRoll < 0.67) {
    // TOP HAT — narrow crown + tight brim, fixed proportions.
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 });
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.35, 12),
      hatMat,
    );
    hat.position.set(0, 2.05, 0);
    body.add(hat);
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.30, 0.05, 12),
      hatMat,
    );
    brim.position.set(0, 1.90, 0);
    body.add(brim);
  } else {
    // BASEBALL CAP — short cylinder + thin forward brim.
    const capColors = [0x2a3a5a, 0x6a2a2a, 0x2a6a3a];
    const capHex = capColors[((seed * 1234567891) >>> 0) % capColors.length];
    const capMat = new THREE.MeshStandardMaterial({ color: capHex, roughness: 0.85 });
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.10, 12),
      capMat,
    );
    cap.position.set(0, 1.77, 0);
    body.add(cap);
    // Brim sticking forward (local -Z = forward for the NPC).
    const capBrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.03, 0.16),
      capMat,
    );
    capBrim.position.set(0, 1.72, -0.20);
    body.add(capBrim);
  }

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
