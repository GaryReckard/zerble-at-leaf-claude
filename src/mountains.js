// Blue Ridge backdrop: three rings of low-poly hills around the play area, autumn palette.
// Each hill is positioned by its PEAK HEIGHT so it reliably protrudes above the ground.

import * as THREE from 'three';

const PALETTE_NEAR = [
  0xd1502b, 0xe07a3a, 0xebb12c, 0xc88a2e,
  0x9a4423, 0x6b2f1a,
  0x3f5d3b, 0x4f7a44,
];

const PALETTE_MID = [
  0x8f5a3a, 0xa07a4a, 0x6e5232,
  0x5a6f4c, 0x435a45, 0x7a4e3a,
];

const PALETTE_FAR = [
  0x7d7e9c, 0x8d8eaa, 0x6f7290, 0x9089a5, 0x5a6388,
];

export function buildMountains(scene) {
  const root = new THREE.Group();
  root.name = 'Mountains';

  // Near ridge — autumn-vivid, bigger silhouette
  buildHillLayer(root, {
    radius: 360,
    count: 64,
    minSize: 30,
    maxSize: 70,
    minPeakY: 24,
    maxPeakY: 52,
    palette: PALETTE_NEAR,
  });

  // Mid ridge — muted, slightly taller-looking due to distance
  buildHillLayer(root, {
    radius: 520,
    count: 80,
    minSize: 40,
    maxSize: 95,
    minPeakY: 36,
    maxPeakY: 80,
    palette: PALETTE_MID,
  });

  // Far ridge — hazy blue-purple, large but distant
  buildHillLayer(root, {
    radius: 720,
    count: 90,
    minSize: 55,
    maxSize: 140,
    minPeakY: 55,
    maxPeakY: 130,
    palette: PALETTE_FAR,
  });

  scene.add(root);
  return root;
}

function buildHillLayer(parent, opts) {
  const { radius, count, minSize, maxSize, minPeakY, maxPeakY, palette } = opts;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / count) * 0.85;
    const r = radius + (Math.random() - 0.5) * radius * 0.18;

    const size = minSize + Math.random() * (maxSize - minSize);
    const peakY = minPeakY + Math.random() * (maxPeakY - minPeakY);

    // Squash icosahedron to a rounded hill shape (taller hills get a steeper profile).
    const verticalRadius = peakY + 8; // total vertical extent above ground = peakY, plus a buried portion
    const hr = verticalRadius / size;

    const stretchX = 0.75 + Math.random() * 0.8;
    const stretchZ = 0.75 + Math.random() * 0.8;

    const detail = 1;
    const geo = new THREE.IcosahedronGeometry(size, detail);
    geo.scale(stretchX, hr, stretchZ);

    // Per-vertex colors for ridge-top highlight + per-face jitter
    const colors = new Float32Array(geo.attributes.position.count * 3);
    const baseColor = new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
    const tmpColor = new THREE.Color();
    for (let v = 0; v < geo.attributes.position.count; v++) {
      const y = geo.attributes.position.getY(v);
      tmpColor.copy(baseColor);
      const lighten = THREE.MathUtils.clamp(y / (size * hr), -0.3, 0.5);
      tmpColor.offsetHSL(0, 0, lighten * 0.08);
      tmpColor.offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.03);
      colors[v * 3] = tmpColor.r;
      colors[v * 3 + 1] = tmpColor.g;
      colors[v * 3 + 2] = tmpColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1.0,
      metalness: 0,
      fog: false, // mountains punch through fog so they always silhouette the horizon
    });

    const hill = new THREE.Mesh(geo, mat);
    // Place the hill's centerline below ground; its TOP lands at peakY.
    // Icosahedron extends ±size*hr vertically from center. We want center.y + size*hr = peakY.
    hill.position.set(
      Math.cos(angle) * r,
      peakY - size * hr,
      Math.sin(angle) * r
    );
    hill.rotation.y = Math.random() * Math.PI * 2;
    hill.castShadow = false;
    hill.receiveShadow = false;
    parent.add(hill);
  }
}
