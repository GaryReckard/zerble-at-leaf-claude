// The LEAF festival world: terrain, sky, lights, fog, trees, stages, tents, string lights.
// Everything is procedural so there are no assets to ship.

import * as THREE from 'three';

const SKY_TOP = 0x6fb6e8;
const SKY_BOTTOM = 0xffd0a8;
const SUN_COLOR = 0xffe1b0;
const HEMI_SKY = 0xa9d6ff;
const HEMI_GROUND = 0xc89265;
const FOG_COLOR = 0xffcfae;
const GROUND_GREEN = 0x7cb37a;
const DIRT = 0xc69566;

const TREE_GREENS = [0x4f8a4d, 0x5fa55d, 0x6dba6a, 0x4b7c4a, 0x82c277];

// Collected stage colliders are filled in during buildWorld.
const stageColliders = [];

export function getWorldColliders() {
  return stageColliders;
}

export function buildWorld(scene) {
  stageColliders.length = 0;

  // ----- Sky -----
  // Inverted sphere with a vertex-color gradient is cheap and gives a nice sunset bowl.
  const skyGeo = new THREE.SphereGeometry(800, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(SKY_TOP) },
      bottomColor: { value: new THREE.Color(SKY_BOTTOM) },
      offset: { value: 30 },
      exponent: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // Fog softens the horizon and hides culling pops
  scene.fog = new THREE.Fog(FOG_COLOR, 80, 380);

  // ----- Lights -----
  const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(SUN_COLOR, 1.35);
  sun.position.set(80, 130, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  const shadowD = 140;
  sun.shadow.camera.left = -shadowD;
  sun.shadow.camera.right = shadowD;
  sun.shadow.camera.top = shadowD;
  sun.shadow.camera.bottom = -shadowD;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  // A subtle ambient so shadows aren't pitch black
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));

  // ----- Ground -----
  buildGround(scene);

  // ----- Stages -----
  buildStage(scene, new THREE.Vector3(0, 0, -85), 'main');
  buildStage(scene, new THREE.Vector3(-60, 0, 50), 'side');
  buildStage(scene, new THREE.Vector3(60, 0, 50), 'side');

  // Stages are tall structures — block the cart with a few overlapping circles per stage.
  addStageColliders(0, -85, true);
  addStageColliders(-60, 50, false);
  addStageColliders(60, 50, false);

  // Entrance arch sides — solid uprights
  stageColliders.push({ position: new THREE.Vector3(-6, 1, 200), radius: 1.0, damage: 4, kind: 'arch' });
  stageColliders.push({ position: new THREE.Vector3(6, 1, 200), radius: 1.0, damage: 4, kind: 'arch' });

  // ----- Tents (vendor / craft area) -----
  const tentLocations = [
    [-100, -40], [-92, -30], [-100, -20], [-92, -10], [-100, 0],
    [95, -40], [95, -25], [95, -10], [95, 5], [95, 20],
    [-50, 90], [-30, 95], [-10, 92], [10, 95], [30, 92], [50, 90],
  ];
  for (const [x, z] of tentLocations) {
    const t = buildTent();
    t.position.set(x, 0, z);
    t.rotation.y = Math.random() * 0.5 - 0.25;
    scene.add(t);
  }

  // ----- Trees scattered along the perimeter & between areas -----
  scatterTrees(scene);

  // ----- String lights between key points -----
  buildStringLights(scene);

  // ----- Speakers / amp stacks at each stage -----
  // (Already handled inside buildStage)

  // ----- A festival entrance arch -----
  buildEntranceArch(scene, new THREE.Vector3(0, 0, 200));

  return { sun, hemi };
}

function addStageColliders(x, z, main) {
  const w = main ? 24 : 14;
  const d = main ? 12 : 8;
  // A row of 3 spheres across the front of the stage approximates the deck wall.
  const cz = z + d / 2 + 1; // front edge (cart approaches from +Z)
  const bcz = z - d / 2 - 1; // back edge
  const xs = main ? [-w / 3, 0, w / 3] : [-w / 4, w / 4];
  const radius = main ? 5 : 4;
  for (const xx of xs) {
    stageColliders.push({ position: new THREE.Vector3(x + xx, 1, z), radius, damage: 10, kind: 'stage' });
    stageColliders.push({ position: new THREE.Vector3(x + xx, 1, cz), radius: radius * 0.7, damage: 10, kind: 'stage' });
    stageColliders.push({ position: new THREE.Vector3(x + xx, 1, bcz), radius: radius * 0.7, damage: 10, kind: 'stage' });
  }
}

function buildGround(scene) {
  const size = 520;
  const seg = 90;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  // Gentle undulation so it isn't a perfect plate.
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  const grass = new THREE.Color(GROUND_GREEN);
  const dirt = new THREE.Color(DIRT);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Soft hills using layered sinusoids
    const h =
      Math.sin(x * 0.012) * 0.6 +
      Math.cos(z * 0.014) * 0.5 +
      Math.sin((x + z) * 0.025) * 0.25;
    pos.setY(i, h);

    // Mix in dirt patches based on noise-like signal
    const patch = Math.sin(x * 0.04) * Math.cos(z * 0.045);
    const dirtAmt = THREE.MathUtils.clamp((patch + 1.1) * 0.4, 0, 1) * 0.35;
    color.copy(grass).lerp(dirt, dirtAmt);
    // Slight color variation
    color.offsetHSL((Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.05 - 0.025, 0, 0);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  scene.add(ground);
}

function buildStage(scene, pos, kind) {
  const group = new THREE.Group();
  group.position.copy(pos);

  const main = kind === 'main';
  const w = main ? 24 : 14;
  const d = main ? 12 : 8;
  const h = 1.5;

  // Stage deck
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95, flatShading: true })
  );
  deck.position.y = h / 2;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Back wall / banner
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(w, 7, 0.4),
    new THREE.MeshStandardMaterial({ color: main ? 0x6fcf6a : 0xff9a8b, roughness: 0.9, flatShading: true })
  );
  banner.position.set(0, 4.5, -d / 2 - 0.2);
  banner.castShadow = true;
  group.add(banner);

  // LEAF letters on the main banner (simple emissive boxes spelling LEAF)
  if (main) {
    const letters = ['L', 'E', 'A', 'F'];
    for (let i = 0; i < letters.length; i++) {
      const letter = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 2.6, 0.3),
        new THREE.MeshStandardMaterial({
          color: 0xfff4d0,
          emissive: 0xffd28a,
          emissiveIntensity: 0.7,
          roughness: 0.5,
        })
      );
      letter.position.set(-7.5 + i * 5, 5, -d / 2);
      group.add(letter);
    }
  }

  // Truss roof (a frame of thin boxes)
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x2a1f3a,
    roughness: 0.5,
    metalness: 0.4,
    flatShading: true,
  });
  const trussGeo = new THREE.BoxGeometry(0.2, 0.2, 1);

  // Vertical pillars
  for (const [px, pz] of [
    [-w / 2 + 0.3, -d / 2 + 0.3],
    [w / 2 - 0.3, -d / 2 + 0.3],
    [-w / 2 + 0.3, d / 2 - 0.3],
    [w / 2 - 0.3, d / 2 - 0.3],
  ]) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 9, 0.25),
      trussMat
    );
    p.position.set(px, 4.5, pz);
    group.add(p);
  }

  // Roof crossbeams
  for (const dx of [-w / 2, w / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, d), trussMat);
    b.position.set(dx, 9, 0);
    group.add(b);
  }
  for (const dz of [-d / 2, d / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, 0.25), trussMat);
    b.position.set(0, 9, dz);
    group.add(b);
  }

  // Speaker stacks
  for (const sx of [-w / 2 - 1, w / 2 + 1]) {
    for (let sy = 0; sy < 3; sy++) {
      const spk = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.4, 1.4),
        new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8, flatShading: true })
      );
      spk.position.set(sx, 1.4 + sy * 1.45, -d / 2 + 1.2);
      spk.castShadow = true;
      group.add(spk);

      // Speaker cone (a flat dark circle)
      const cone = new THREE.Mesh(
        new THREE.CircleGeometry(0.45, 12),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95 })
      );
      cone.position.set(sx + (sx < 0 ? 0.8 : -0.8), 1.4 + sy * 1.45, -d / 2 + 1.2);
      cone.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(cone);
    }
  }

  // A few stage lights (emissive cones hung from truss)
  for (const lx of [-w * 0.3, 0, w * 0.3]) {
    const colorHex = main ? [0xff6f9c, 0xffd28a, 0xb285ff][Math.floor(Math.random() * 3)] : 0xffd28a;
    const lampHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.3, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.3 })
    );
    lampHousing.position.set(lx, 8.7, 0);
    group.add(lampHousing);

    const lampLens = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.6, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 2.5,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      })
    );
    lampLens.position.set(lx, 8.3, 0);
    lampLens.rotation.x = Math.PI;
    group.add(lampLens);
  }

  scene.add(group);
  return group;
}

function buildTent() {
  const g = new THREE.Group();

  const baseColor = [0xfff4d0, 0xe7c995, 0xfddfa5, 0xd0c2a8][Math.floor(Math.random() * 4)];
  const roofColor = [0xff6f9c, 0x6fcf6a, 0xffd28a, 0xb285ff, 0x66d9ff][Math.floor(Math.random() * 5)];

  // Walls (4 thin panels) — actually skip walls, just legs + roof for low-poly readability
  const legMat = new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.8, flatShading: true });
  for (const [x, z] of [
    [-2, -2], [2, -2], [-2, 2], [2, 2],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), legMat);
    leg.position.set(x, 1.25, z);
    leg.castShadow = true;
    g.add(leg);
  }

  // Pyramid roof (use cone with 4 segments for tent shape)
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 1.8, 4),
    new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85, flatShading: true })
  );
  roof.position.y = 3.4;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);

  // Table
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.1, 1.2),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, flatShading: true })
  );
  table.position.set(0, 1.0, 0);
  table.castShadow = true;
  table.receiveShadow = true;
  g.add(table);

  // Random craft objects on table
  for (let i = 0; i < 3; i++) {
    const obj = new THREE.Mesh(
      new THREE.BoxGeometry(0.25 + Math.random() * 0.2, 0.2 + Math.random() * 0.3, 0.25),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(Math.random(), 0.7, 0.55),
        roughness: 0.7,
        flatShading: true,
      })
    );
    obj.position.set(-1 + i * 1, 1.2, 0);
    g.add(obj);
  }

  return g;
}

function scatterTrees(scene) {
  const placedCircles = []; // avoid placing near stages or paths

  function isClear(x, z) {
    // Stay out of the central festival ring
    const dCenter = Math.hypot(x, z);
    if (dCenter < 25) return false;
    // Stay off the main path lanes (rough X/Z bands)
    for (const [cx, cz, r] of placedCircles) {
      if (Math.hypot(x - cx, z - cz) < r) return false;
    }
    return true;
  }

  // Avoid stages
  placedCircles.push([0, -85, 22]);
  placedCircles.push([-60, 50, 18]);
  placedCircles.push([60, 50, 18]);

  // Trunk and foliage geometries reused
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.6, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.95, flatShading: true });

  for (let i = 0; i < 130; i++) {
    let tries = 0;
    let x = 0, z = 0;
    while (tries++ < 20) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 30 + Math.random() * 200;
      x = Math.cos(ang) * rad;
      z = Math.sin(ang) * rad;
      if (isClear(x, z)) break;
    }
    if (tries > 20) continue;

    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.8;
    trunk.castShadow = true;
    tree.add(trunk);

    // 60% leafy, 40% conifer
    if (Math.random() < 0.6) {
      const r = 1.6 + Math.random() * 1.0;
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 1),
        new THREE.MeshStandardMaterial({
          color: TREE_GREENS[Math.floor(Math.random() * TREE_GREENS.length)],
          roughness: 0.95,
          flatShading: true,
        })
      );
      leaf.position.y = 3.8 + Math.random() * 0.4;
      leaf.castShadow = true;
      tree.add(leaf);

      // Sometimes add a second smaller puff for variation
      if (Math.random() < 0.5) {
        const r2 = r * 0.7;
        const leaf2 = new THREE.Mesh(
          new THREE.IcosahedronGeometry(r2, 1),
          leaf.material
        );
        leaf2.position.set((Math.random() - 0.5) * 1.5, 3.3 + Math.random() * 0.7, (Math.random() - 0.5) * 1.5);
        leaf2.castShadow = true;
        tree.add(leaf2);
      }
    } else {
      const h = 4 + Math.random() * 2.5;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, h, 8),
        new THREE.MeshStandardMaterial({
          color: 0x2d5d3e,
          roughness: 0.95,
          flatShading: true,
        })
      );
      cone.position.y = 2 + h / 2;
      cone.castShadow = true;
      tree.add(cone);
    }

    tree.position.set(x, 0, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    scene.add(tree);

    placedCircles.push([x, z, 3]);
  }
}

function buildStringLights(scene) {
  const anchorHeight = 6;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a1f3a, roughness: 0.7, flatShading: true });
  const bulbHues = [0xffd28a, 0xff6f9c, 0x8ecae6, 0x6fcf6a, 0xc77dff, 0xffd166];

  const poles = [
    [-30, 0], [-15, 0], [0, 0], [15, 0], [30, 0],
    [-30, -30], [30, -30],
    [-30, 30], [30, 30],
  ];

  for (const [x, z] of poles) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, anchorHeight, 8), poleMat);
    pole.position.set(x, anchorHeight / 2, z);
    pole.castShadow = true;
    scene.add(pole);
  }

  // Connect each adjacent pair with a strand of bulbs
  function strand(ax, az, bx, bz, count) {
    const startTop = new THREE.Vector3(ax, anchorHeight - 0.1, az);
    const endTop = new THREE.Vector3(bx, anchorHeight - 0.1, bz);

    // The cable sags — use a quadratic with a midpoint lower
    const mid = startTop.clone().add(endTop).multiplyScalar(0.5);
    const sag = 0.8 + Math.hypot(bx - ax, bz - az) * 0.02;
    mid.y -= sag;

    const curve = new THREE.QuadraticBezierCurve3(startTop, mid, endTop);

    // Cable as a thin tube
    const cableGeo = new THREE.TubeGeometry(curve, 12, 0.03, 4, false);
    const cable = new THREE.Mesh(cableGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    scene.add(cable);

    const bulbGeo = new THREE.SphereGeometry(0.12, 8, 6);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const p = curve.getPoint(t);
      const hue = bulbHues[i % bulbHues.length];
      const bulb = new THREE.Mesh(
        bulbGeo,
        new THREE.MeshStandardMaterial({
          color: hue,
          emissive: hue,
          emissiveIntensity: 1.2,
        })
      );
      bulb.position.copy(p);
      bulb.position.y -= 0.13;
      scene.add(bulb);
    }
  }

  strand(-30, 0, -15, 0, 6);
  strand(-15, 0, 0, 0, 6);
  strand(0, 0, 15, 0, 6);
  strand(15, 0, 30, 0, 6);
  strand(-30, -30, -30, 30, 10);
  strand(30, -30, 30, 30, 10);
}

function buildEntranceArch(scene, pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  const sideMat = new THREE.MeshStandardMaterial({ color: 0x4f8a4d, roughness: 0.9, flatShading: true });
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), sideMat);
  left.position.set(-6, 4, 0);
  left.castShadow = true;
  g.add(left);

  const right = left.clone();
  right.position.x = 6;
  g.add(right);

  // Curved arch top — a torus segment
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(6, 0.4, 8, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xff6f9c, roughness: 0.7, flatShading: true })
  );
  arch.position.set(0, 8, 0);
  arch.rotation.z = Math.PI;
  arch.rotation.y = 0;
  arch.castShadow = true;
  g.add(arch);

  // Big letters "LEAF"
  const letters = ['L', 'E', 'A', 'F'];
  for (let i = 0; i < letters.length; i++) {
    const ltr = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.8, 0.4),
      new THREE.MeshStandardMaterial({
        color: 0xfff4d0,
        emissive: 0xffe066,
        emissiveIntensity: 0.6,
        roughness: 0.5,
      })
    );
    ltr.position.set(-3.7 + i * 2.5, 9.5, 0);
    g.add(ltr);
  }

  scene.add(g);
}
