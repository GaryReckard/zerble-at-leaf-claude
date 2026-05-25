// Grand marshal of a New Orleans second-line brass band — an NPC holding up
// a big colorful spinning parasol with ribbon streamers. children[0] is the
// body so the caller can bob it for the marching anim. userData.parasol is
// the spinning parasol group so the caller can twirl it each frame.

import * as THREE from 'three';
import { buildSimpleNPC } from './puppet.js';

const PARASOL_COLORS = [
  [0xff6f9c, 0xffd28a, 0x66d9ff, 0x6fcf6a, 0xc77dff, 0xffe066],
  [0xff8a5b, 0x8ecae6, 0xfb8500, 0xb285ff, 0xfff4d0, 0xff6f6f],
  [0xffb703, 0x66ff88, 0xff5577, 0x00bbf9, 0xc080ff, 0xfde74c],
];

export function buildParasolMarshal() {
  const g = new THREE.Group();

  // White-tie marshal jacket (a brighter red than the standard band).
  const body = buildSimpleNPC(0xa31e2e, 0xe6c098);
  g.add(body);

  // Tall band leader's hat — taller drum-major-style topper.
  // Parented to body so it bobs with the marching animation (caller bobs body).
  // Head center is at body-local y=1.65; hat sits on top.
  const hatColor = 0x1a1a3a;
  const hatMat = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.7 });
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.55, 14), hatMat,
  );
  hat.position.set(0, 2.18, 0);
  body.add(hat);
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.05, 14), hatMat,
  );
  brim.position.set(0, 1.93, 0);
  body.add(brim);
  // Gold band on the hat
  const hatBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.325, 0.325, 0.08, 14),
    new THREE.MeshStandardMaterial({ color: 0xe8b042, roughness: 0.3, metalness: 0.9 }),
  );
  hatBand.position.set(0, 1.97, 0);
  body.add(hatBand);

  // Parasol pole — held in the right hand, runs up to ~3.5m. Parented to body
  // so it travels with the marshal's hand as the body bobs.
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x6a4a2a, roughness: 0.95,
  });
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), poleMat,
  );
  pole.position.set(0.3, 2.0, -0.2);
  body.add(pole);

  // Parasol group — canopy + ribbons. Spins around its Y axis.
  // Parented to body so it bobs naturally with the marshal.
  const parasol = new THREE.Group();
  parasol.position.set(0.3, 3.3, -0.2);
  body.add(parasol);

  // Canopy — flattened cone with vertical color bands. Approximate radial
  // bands by stacking thin pie slices, but the cheap version that reads
  // well at festival-driving distance is a single cone with multi-vertex
  // color via segments.
  const slices = 12;
  const palette = PARASOL_COLORS[Math.floor(Math.random() * PARASOL_COLORS.length)];
  for (let i = 0; i < slices; i++) {
    const startA = (i / slices) * Math.PI * 2;
    const endA = ((i + 1) / slices) * Math.PI * 2;
    // Build a thin radial wedge from a custom BufferGeometry.
    const r = 1.0;
    const h = 0.45;
    const verts = new Float32Array([
      0, h, 0,                                          // apex
      Math.cos(startA) * r, 0, Math.sin(startA) * r,
      Math.cos(endA) * r,   0, Math.sin(endA) * r,
    ]);
    const idx = [0, 1, 2];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const wedge = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: palette[i % palette.length],
        roughness: 0.6,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
    );
    wedge.castShadow = true;
    parasol.add(wedge);
  }

  // Ribbons trailing off the rim — a few long cone strands.
  const ribbonCount = 10;
  for (let i = 0; i < ribbonCount; i++) {
    const a = (i / ribbonCount) * Math.PI * 2;
    const len = 1.0 + Math.random() * 0.5;
    const cone = new THREE.ConeGeometry(0.04, len, 5, 1);
    cone.translate(0, -len / 2, 0);
    const ribbon = new THREE.Mesh(
      cone,
      new THREE.MeshStandardMaterial({
        color: palette[(i + 3) % palette.length],
        roughness: 0.8,
        flatShading: true,
      }),
    );
    ribbon.position.set(Math.cos(a) * 0.95, -0.05, Math.sin(a) * 0.95);
    ribbon.rotation.x = 0.6 * Math.cos(a);
    ribbon.rotation.z = -0.6 * Math.sin(a);
    parasol.add(ribbon);
  }

  // Tip ornament on top of the parasol (a small gold orb)
  const tip = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.08, 0),
    new THREE.MeshStandardMaterial({ color: 0xe8b042, roughness: 0.3, metalness: 0.9 }),
  );
  tip.position.y = 0.55;
  parasol.add(tip);

  g.userData.parasol = parasol;
  return g;
}
