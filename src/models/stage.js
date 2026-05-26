// Festival stage — deck, banner, truss, speaker stacks, stage lights.
// Sits at the group's origin; caller positions the group.
//
// Caller-supplied opts:
//   isMain         - bigger stage with the LEAF banner
//   leafTexture    - { diffuse, emissive } CanvasTexture pair (chunks.js owns the cache)
//
// Returns { group, deckWidth, deckDepth, deckHeight, frontZ } so callers can
// register colliders / attractors in world space relative to where they place
// the group.

import * as THREE from 'three';
import { buildPerformer } from './performer.js';
import { register as registerContextLight } from '../contextLights.js';

export function buildStage(opts = {}) {
  // `scale` (default 1.0) scales the deck dimensions + truss + speakers +
  // stage lights uniformly so chunks.js can give each stage a different
  // size for visual variety. The returned dimensions reflect the scale so
  // callers can register correctly-sized colliders.
  const { isMain = false, leafTexture = null, rng = Math.random, scale = 1.0 } = opts;

  const g = new THREE.Group();
  const w = (isMain ? 24 : 14) * scale;
  const d = (isMain ? 12 : 8) * scale;
  const h = 1.5 * scale;

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95, flatShading: true })
  );
  deck.position.set(0, h / 2, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);

  const bannerColor = isMain
    ? 0x6fcf6a
    : [0xff9a8b, 0xc77dff, 0x66d9ff, 0xffd28a][Math.floor(rng() * 4)];
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(w, 7 * scale, 0.4 * scale),
    new THREE.MeshStandardMaterial({ color: bannerColor, roughness: 0.9, flatShading: true })
  );
  banner.position.set(0, 4.5 * scale, -d / 2 - 0.2 * scale);
  banner.castShadow = true;
  g.add(banner);

  if (isMain && leafTexture) {
    const bannerW = Math.min(w - 2 * scale, 16 * scale);
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(bannerW, 3.4 * scale),
      new THREE.MeshStandardMaterial({
        map: leafTexture.diffuse,
        emissive: 0xffd28a,
        emissiveMap: leafTexture.emissive,
        emissiveIntensity: 0.55,
        roughness: 0.6,
        side: THREE.DoubleSide,
      })
    );
    leaf.position.set(0, 5.3 * scale, -d / 2 + 0.06 * scale);
    g.add(leaf);
  }

  // Truss
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a1f3a, roughness: 0.5, metalness: 0.4, flatShading: true });
  const trussH = 9 * scale;
  const trussThk = 0.25 * scale;
  for (const [px, pz] of [
    [-w / 2 + 0.3 * scale, -d / 2 + 0.3 * scale], [w / 2 - 0.3 * scale, -d / 2 + 0.3 * scale],
    [-w / 2 + 0.3 * scale, d / 2 - 0.3 * scale], [w / 2 - 0.3 * scale, d / 2 - 0.3 * scale],
  ]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(trussThk, trussH, trussThk), trussMat);
    p.position.set(px, trussH / 2, pz);
    g.add(p);
  }
  for (const dx of [-w / 2, w / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(trussThk, trussThk, d), trussMat);
    b.position.set(dx, trussH, 0);
    g.add(b);
  }
  for (const dz of [-d / 2, d / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, trussThk, trussThk), trussMat);
    b.position.set(0, trussH, dz);
    g.add(b);
  }

  // Speaker stacks
  const spkW = 1.6 * scale;
  const spkH = 1.4 * scale;
  for (const sx of [-w / 2 - 1 * scale, w / 2 + 1 * scale]) {
    for (let sy = 0; sy < 3; sy++) {
      const spk = new THREE.Mesh(
        new THREE.BoxGeometry(spkW, spkH, spkW),
        new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8, flatShading: true })
      );
      spk.position.set(sx, 1.4 * scale + sy * 1.45 * scale, -d / 2 + 1.2 * scale);
      // 6 speakers per stage; deck + banner already cast the stage shadow.
      g.add(spk);
    }
  }

  // Stage lights — emissive lens mesh + SpotLight aimed into the audience.
  // The day-night system ramps SpotLight intensity with nightness and
  // animates each beam's target so the beams sweep across the crowd in
  // colorful patterns at night.
  const stageLights = [];
  const stageBeams = [];
  const PALETTE = [0xff3380, 0xff8a3b, 0xffe066, 0x6fcf6a, 0x33d9ff, 0xc080ff];
  for (let i = 0; i < 3; i++) {
    const lxArr = [-w * 0.32, 0, w * 0.32];
    const lx = lxArr[i];
    const colorHex = isMain
      ? PALETTE[Math.floor(rng() * PALETTE.length)]
      : 0xffd28a;
    const lampLens = new THREE.Mesh(
      new THREE.ConeGeometry(0.4 * scale, 0.6 * scale, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 2.5,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      })
    );
    const lensY = trussH - 0.7 * scale;
    lampLens.position.set(lx, lensY, 0);
    lampLens.rotation.x = Math.PI;
    g.add(lampLens);
    stageLights.push(lampLens);

    // SpotLight directly behind the lens, aimed into the audience
    // (+Z, downward). Target sits a few meters in front + below.
    const beam = new THREE.SpotLight(
      colorHex,
      0,                // intensity — animated by updateStageLightShow
      24 * scale,       // throw distance
      Math.PI / 7,      // ~25° cone half-angle (narrowish so beams read)
      0.45,             // penumbra
      1.0,              // decay
    );
    beam.position.set(lx, lensY - 0.1, 0);
    const target = new THREE.Object3D();
    // Default target: 8m forward (+Z) of the stage, on the ground.
    target.position.set(lx, 0, 10 * scale);
    g.add(target);
    beam.target = target;
    g.add(beam);
    // Distance-cull stage SpotLights — they're the heaviest light in the
    // game (SpotLights are ~2× a PointLight per fragment) and a stage that
    // isn't visible shouldn't be paying that cost.
    registerContextLight(beam);

    stageBeams.push({ beam, target, baseTargetX: lx, baseTargetZ: 10 * scale, phaseOffset: i * 1.7 });
  }

  return {
    group: g,
    deckWidth: w,
    deckDepth: d,
    deckHeight: h,
    scale,
    frontZ: d / 2,           // local Z of the deck front edge (audience side)
    stageLights,
    stageBeams,
  };
}

// Lay a band out across a stage. `bandSeed` is the array of instrument
// strings (e.g. ['lead_vocal','guitar','drum']). Returns the performer
// groups in placement order so caller can register them for animation.
export function placeBandOnStage(stageGroup, instruments, opts) {
  const { deckWidth, deckDepth, deckHeight, rng = Math.random } = opts;
  const w = deckWidth;
  const d = deckDepth;
  const lineZ = 0.5;              // slightly behind the front edge
  const backZ = -d * 0.25;
  const performers = [];
  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    const isLead = inst === 'lead_vocal' || inst === 'drum' || inst === 'bass';
    const spread = w * 0.32;
    const spotX = ((i / (instruments.length - 1 || 1)) - 0.5) * spread * 2;
    const spotZ = inst === 'drum' ? backZ : (isLead && i === 0 ? lineZ + 1.0 : lineZ - 0.5);
    const performer = buildPerformer(inst, rng);
    performer.position.set(spotX, deckHeight, spotZ);
    performer.rotation.y = Math.PI;
    stageGroup.add(performer);
    performers.push(performer);
  }
  return performers;
}
