// Wook — swaying tie-dye festival-goer with chunky dreadlocks and a bucket
// hat. children[0] is the wookGroup so callers can apply sway/tilt rotations.

import * as THREE from 'three';

const TAU = Math.PI * 2;

export function buildWook(rng = Math.random) {
  const g = new THREE.Group();
  const wookGroup = new THREE.Group();

  const colors = [0xff6f9c, 0xffd28a, 0x6fcf6a, 0x66d9ff, 0xb285ff];
  // Pick a base body color + three accent colors from the palette for the
  // tie-dye splotches. Accents are guaranteed different from base.
  const baseIdx = Math.floor(rng() * colors.length);
  const baseColor = colors[baseIdx];
  const accents = [
    colors[(baseIdx + 1) % colors.length],
    colors[(baseIdx + 2) % colors.length],
    colors[(baseIdx + 3) % colors.length],
  ];
  const tieDyePhase = rng() * Math.PI * 2;

  // Splotches used to be 7 thin CircleGeometry discs floating just outside
  // the body surface — looked OK only when viewed straight on at a disc
  // center, but from any other angle the disc plane intersected the body's
  // curved surface and the disc edges visibly jutted at the silhouette.
  // Same root cause as the earlier BoxGeometry version, just rounded.
  //
  // Real fix: paint splotches DIRECTLY ONTO the body material via an
  // `onBeforeCompile` shader patch — no extra geometry, no protruding
  // edges, the pattern is part of the surface and conforms to its
  // curvature perfectly. Same trick the crowd's tie-dye shirts use.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.95,
    flatShading: true,
  });
  bodyMat.onBeforeCompile = (shader) => {
    shader.uniforms.uAccent1 = { value: new THREE.Color(accents[0]) };
    shader.uniforms.uAccent2 = { value: new THREE.Color(accents[1]) };
    shader.uniforms.uAccent3 = { value: new THREE.Color(accents[2]) };
    shader.uniforms.uPhase   = { value: tieDyePhase };
    shader.vertexShader = `
      varying vec3 vWookLocalPos;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWookLocalPos = position;`,
    );
    shader.fragmentShader = `
      varying vec3 vWookLocalPos;
      uniform vec3 uAccent1;
      uniform vec3 uAccent2;
      uniform vec3 uAccent3;
      uniform float uPhase;
    ` + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       // Three sum-of-sin noise fields at slightly different frequencies
       // and phases. Thresholded with smoothstep to make distinct color
       // splotches instead of a smooth swirl.
       float fq = 5.5;
       float n1 = sin(vWookLocalPos.y * fq + uPhase)
               + sin((vWookLocalPos.x + vWookLocalPos.z) * fq * 0.85 - uPhase * 1.4);
       float n2 = sin(vWookLocalPos.y * fq * 0.7 - uPhase * 0.8)
               + sin((vWookLocalPos.x - vWookLocalPos.z) * fq * 1.2 + uPhase * 1.7);
       float n3 = sin(vWookLocalPos.x * fq * 1.1 + uPhase * 0.5)
               + sin(vWookLocalPos.z * fq * 0.95 - uPhase * 1.3);
       float b1 = smoothstep(0.35, 1.15, n1);
       float b2 = smoothstep(0.35, 1.15, n2);
       float b3 = smoothstep(0.35, 1.15, n3);
       vec3 col = diffuseColor.rgb;
       col = mix(col, uAccent1, b1 * 0.65);
       col = mix(col, uAccent2, b2 * 0.65);
       col = mix(col, uAccent3, b3 * 0.65);
       diffuseColor.rgb = col;`,
    );
  };
  // Shared cache key so the shader compiles once across all wooks even
  // though each wook has its own material instance (uniforms vary, program
  // stays cached).
  bodyMat.customProgramCacheKey = () => 'wook-tiedye-v1';

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1.4, 4, 8),
    bodyMat,
  );
  body.position.y = 1.1;
  body.castShadow = true;
  wookGroup.add(body);

  // Arms — relaxed/swaying with palms turned slightly outward
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe6c098, roughness: 0.9, flatShading: true,
  });
  for (const sx of [-1, 1]) {
    const armGroup = new THREE.Group();
    armGroup.position.set(sx * 0.40, 1.55, 0);
    armGroup.rotation.z = sx * 0.10;
    // Upper sleeve shares the patched body material so the tie-dye pattern
    // flows continuously from torso onto sleeve (rather than the sleeve
    // being a plain solid color while the torso has splotches).
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.10, 0.36, 4, 6),
      bodyMat,
    );
    upper.position.y = -0.22;
    armGroup.add(upper);
    const lower = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.32, 4, 6), skinMat,
    );
    lower.position.y = -0.60;
    armGroup.add(lower);
    // Skip arm shadow — body + head silhouette is enough.
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

    // Base on the back of the scalp — radius 0.30 (right on head surface) and
    // y=2.30 (upper hemisphere of head centered at y=2.15). Previously baseR
    // was 0.28 (just inside the head), and droopX was *0.10 — by segment 4
    // dreads only reached radius ~0.39, well inside body radius 0.45, so they
    // sank through the torso. Now baseR sits flush on the head and droop
    // pushes out *0.30 per segment so the strand clears body radius by
    // segment 2 (≈0.48m at s=1) and angles increasingly outward as it falls.
    const baseR = 0.30;
    const baseX = Math.cos(ang) * baseR;
    const baseZ = Math.sin(ang) * baseR;
    const droopX = baseX * 0.30;
    const droopZ = baseZ * 0.30;

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
      // Dread segments — skinny cylinders, lots of them per wook. Skip
      // shadow casting (head shadow already reads).
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
  // Per-wook sway phase so neighboring wooks don't move in lockstep.
  g.userData.swayPhase = Math.random() * 100;
  return g;
}

// Per-frame sway animation. Game (Wooks.update in obstacles.js) and
// sandbox both call this — keeps the dread/hip wobble in one place.
// Doesn't touch position or yaw; that's the caller's job (orbit /
// approach / dodge state lives there).
export function tickWook(model, dt) {
  const u = model.userData;
  const t = performance.now() * 0.002 + u.swayPhase;
  const body = model.children[0];
  if (!body) return;
  body.rotation.z = Math.sin(t) * 0.15;
  body.rotation.x = Math.cos(t * 0.7) * 0.08;
}
