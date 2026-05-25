// Wook — swaying tie-dye festival-goer with chunky dreadlocks and a bucket
// hat. children[0] is the wookGroup so callers can apply sway/tilt rotations.

import * as THREE from 'three';

const TAU = Math.PI * 2;

export function buildWook(rng = Math.random) {
  const g = new THREE.Group();
  const wookGroup = new THREE.Group();

  const colors = [0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff];
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1.4, 4, 8),
    new THREE.MeshStandardMaterial({
      color: colors[Math.floor(rng() * colors.length)],
      roughness: 0.95,
      flatShading: true,
    })
  );
  body.position.y = 1.1;
  body.castShadow = true;
  wookGroup.add(body);

  // Tie-dye splotches
  for (let i = 0; i < 4; i++) {
    const splotch = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.4, 0.02),
      new THREE.MeshStandardMaterial({
        color: colors[Math.floor(rng() * colors.length)],
        roughness: 0.95,
      })
    );
    const a = rng() * TAU;
    splotch.position.set(Math.cos(a) * 0.45, 0.5 + rng() * 1.4, Math.sin(a) * 0.45);
    splotch.lookAt(splotch.position.clone().multiplyScalar(2));
    wookGroup.add(splotch);
  }

  // Arms — relaxed/swaying with palms turned slightly outward
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe6c098, roughness: 0.9, flatShading: true,
  });
  for (const sx of [-1, 1]) {
    const armGroup = new THREE.Group();
    armGroup.position.set(sx * 0.40, 1.55, 0);
    armGroup.rotation.z = sx * 0.10;
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.10, 0.36, 4, 6),
      new THREE.MeshStandardMaterial({
        color: body.material.color, roughness: 0.95, flatShading: true,
      }),
    );
    upper.position.y = -0.22;
    armGroup.add(upper);
    const lower = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.32, 4, 6), skinMat,
    );
    lower.position.y = -0.60;
    armGroup.add(lower);
    armGroup.castShadow = true;
    wookGroup.add(armGroup);
  }

  // Head
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 1),
    new THREE.MeshStandardMaterial({ color: 0xe6c098, roughness: 0.9, flatShading: true })
  );
  head.position.y = 2.15;
  head.castShadow = true;
  wookGroup.add(head);
  // Sunglasses — wooks always wear shades
  const shades = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.08, 0.04),
    new THREE.MeshStandardMaterial({
      color: 0x111, roughness: 0.3, metalness: 0.4,
    }),
  );
  shades.position.set(0, 2.17, -0.27);
  wookGroup.add(shades);
  // Tiny beard tufts
  const beardMat = new THREE.MeshStandardMaterial({
    color: 0x5a3a1a, roughness: 1.0, flatShading: true,
  });
  for (let i = 0; i < 4; i++) {
    const tuft = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.045 + rng() * 0.02, 0), beardMat,
    );
    tuft.position.set(
      (rng() - 0.5) * 0.14,
      2.00 + rng() * 0.04,
      -0.25 + rng() * 0.04,
    );
    wookGroup.add(tuft);
  }

  // Thick dreadlocks — emerge from the back hemisphere of the head only
  // (sides + back, never the face). Roots sit high on the scalp; segments
  // droop down + slightly outward. Wook faces -z, so the back of the head is
  // +z. We distribute ang across [0, π] which covers right side (ang=0) →
  // back (ang=π/2) → left side (ang=π). The front wedge gets no dreads.
  const hairColor = 0x5a3a1a;
  const dreadMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 1, flatShading: true });
  const dreadHighlightMat = new THREE.MeshStandardMaterial({
    color: 0x7a5630, roughness: 1, flatShading: true,
  });
  const dreadCount = 14;
  for (let i = 0; i < dreadCount; i++) {
    // Map index across the back hemisphere [0, π], small jitter
    const ang = (i / (dreadCount - 1)) * Math.PI + (rng() - 0.5) * 0.18;
    // Sin(ang) is max at the back (π/2), zero at the sides — longer dreads
    // hang down the back, shorter ones tuft out the sides.
    const backness = Math.max(0, Math.sin(ang));
    const len = 0.9 + backness * 0.7 + rng() * 0.3;
    const segments = 4 + Math.floor(rng() * 2);
    const segLen = len / segments;

    // Base on the back of the scalp — radius 0.28 (just inside head r=0.30)
    // and y=2.30 (upper hemisphere of head centered at y=2.15).
    const baseR = 0.28;
    const baseX = Math.cos(ang) * baseR;
    const baseZ = Math.sin(ang) * baseR;
    const droopX = baseX * 0.10;
    const droopZ = baseZ * 0.10;

    let prevX = baseX;
    let prevZ = baseZ;
    let yTop = 2.30;
    for (let s = 0; s < segments; s++) {
      const sX = baseX + droopX * (s + 1);
      const sZ = baseZ + droopZ * (s + 1);
      const r = 0.12 + (rng() - 0.5) * 0.04 - s * 0.005;
      const segH = segLen * (0.85 + rng() * 0.3);
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 0.95, segH, 6),
        s % 2 === 0 ? dreadMat : dreadHighlightMat
      );
      const cx = (prevX + sX) / 2;
      const cz = (prevZ + sZ) / 2;
      seg.position.set(cx, yTop - segH / 2, cz);
      const tiltX = Math.atan2(sX - prevX, segH);
      const tiltZ = Math.atan2(sZ - prevZ, segH);
      seg.rotation.x = -tiltZ;
      seg.rotation.z = tiltX;
      seg.castShadow = true;
      wookGroup.add(seg);

      if (s < segments - 1) {
        const knob = new THREE.Mesh(
          new THREE.IcosahedronGeometry(r * 1.25, 0),
          dreadMat
        );
        knob.position.set(sX, yTop - segH, sZ);
        wookGroup.add(knob);
      }

      yTop -= segH;
      prevX = sX;
      prevZ = sZ;
    }
  }

  // Bucket hat
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.18, 14),
    new THREE.MeshStandardMaterial({ color: 0xc77dff, roughness: 0.8 })
  );
  hat.position.y = 2.4;
  wookGroup.add(hat);
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.05, 14),
    new THREE.MeshStandardMaterial({ color: 0xc77dff, roughness: 0.8 })
  );
  brim.position.y = 2.32;
  wookGroup.add(brim);

  g.add(wookGroup);
  return g;
}
