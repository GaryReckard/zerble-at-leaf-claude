// Tribal-aesthetic figures for the LEAF drum circle: dancers orbiting the
// fire, seated drummers on the benches, the firekeeper + spotter pair.
//
// Hybrid aesthetic (Gary's pick): mixed silhouettes — some bare-chested,
// some in skinny strap tops, some with short skirts/wraps, some with
// shorts. Varied skin + hair palette. Long hair on everyone. No shoes.
// Designed to read as "ecstatic fire-dancers" without leaning into the
// stereotyped tribal trope the original reviewer flagged.
//
// Each builder returns `{ group, kind, anim }` where `anim` exposes the
// joint references a central updater can poke (arm pivot, hair pivot, hip
// pivot). For drummers, `anim.drumStrike(time)` triggers a one-shot arm
// swing. For dancers, `anim.advance(t, orbitAngle)` repositions + sways.
// For firekeeper, `anim.pokeFire(t)` triggers the lean-forward.

import * as THREE from 'three';

// ---- Shared palettes ----

const SKIN_TONES = [
  0xe6c098, 0xcfa279, 0xb78866, 0x946a4c, 0x6f4a31, 0x4a3122,
];
const HAIR_TONES = [
  0x1f1612, 0x2e1f15, 0x4a2e1c, 0x6a4218, 0x8b5a2b, 0xa1813d, 0xc4a25a,
];
// Wrap / skirt / sash colours — earth + sunset tones. Picking from this
// keeps the look unified without going full uniform.
const WRAP_TONES = [
  0xb45a3a, 0x884a2c, 0xc77a3d, 0x8a3a4a, 0xc7493a,
  0x6e3a2a, 0x4f2e21, 0xb8843a, 0x6a4a2a,
];
// Strap / "almost-not-a-top" colours — mostly close to skin so the top
// reads as a sliver of fabric rather than a full shirt. Some pure colours
// for variety.
const STRAP_TONES = [
  null, null, null,            // 3-in-7 chance of pure bare torso
  0xc23a4a, 0x355a3a, 0x4a5fc7, 0xd9a04a,
];

// ---- Black-clad palette for firekeeper + spotter ----
const BLACK_GARB = 0x14151a;
const BLACK_GARB_DARKER = 0x0a0b0e;

// ---------- Tribal figure builder ----------
//
// Lower-poly than the festival's simpleNPC — these spawn 15-25 per drum
// circle so every mesh counts. ~8-9 meshes per figure.
//
// opts.pose: 'dance', 'drum_seated', 'stand', 'firekeeper', 'spotter'
// opts.scale (default 1): overall y-scale (used to "seat" drummers).

function buildTribalFigure(rng = Math.random, opts = {}) {
  const {
    pose = 'stand',
    scale = 1,
    forceSkin = null,
    forceHair = null,
  } = opts;

  const skinHex = forceSkin ?? SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)];
  const hairHex = forceHair ?? HAIR_TONES[Math.floor(rng() * HAIR_TONES.length)];
  const wrapHex = WRAP_TONES[Math.floor(rng() * WRAP_TONES.length)];
  const strapHex = STRAP_TONES[Math.floor(rng() * STRAP_TONES.length)];

  // Black-clad overrides for firekeeper + spotter
  const isBlackClad = (pose === 'firekeeper' || pose === 'spotter');
  const torsoColor = isBlackClad ? BLACK_GARB
    : (strapHex !== null ? strapHex : skinHex);
  const lowerColor = isBlackClad ? BLACK_GARB_DARKER : wrapHex;

  const skinMat = new THREE.MeshStandardMaterial({
    color: skinHex, roughness: 0.92, flatShading: true,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: hairHex, roughness: 0.95, flatShading: true,
  });
  const torsoMat = new THREE.MeshStandardMaterial({
    color: torsoColor, roughness: 0.92, flatShading: true,
  });
  const lowerMat = new THREE.MeshStandardMaterial({
    color: lowerColor, roughness: 0.95, flatShading: true,
  });

  const g = new THREE.Group();

  // ----- Legs -----
  // Bare legs (skin) for dancers + drummers + spotter. Black for firekeeper.
  // Drummers' legs are mostly hidden by the bench but we draw them anyway
  // so seated drummers have proper knees if the camera gets low.
  const legMat = isBlackClad ? lowerMat : skinMat;
  for (const lx of [-0.10, 0.10]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.55, 6),
      legMat,
    );
    leg.position.set(lx, 0.30, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  // No shoes — barefoot.

  // ----- Wrap / skirt at the waist -----
  // Short flared cylinder from waist to mid-thigh. Black-clad figures get
  // a longer "robe" extension so they look fully covered.
  const wrapTop = isBlackClad ? 0.95 : 0.65;
  const wrapBot = isBlackClad ? 0.55 : 0.50;
  const wrapH = isBlackClad ? 0.85 : 0.32;
  const wrapTopR = 0.20;
  const wrapBotR = isBlackClad ? 0.26 : (0.30 + rng() * 0.04);
  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(wrapTopR, wrapBotR, wrapH, 8),
    lowerMat,
  );
  wrap.position.y = (wrapTop + wrapBot) / 2;
  wrap.castShadow = true;
  g.add(wrap);

  // ----- Torso -----
  // Capsule, sized to a slim adult. Color is skin or strap depending on
  // top variant.
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.45, 4, 6),
    torsoMat,
  );
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);

  // ----- Optional strap / skinny top -----
  // Even when torsoColor == skinHex (the "bare" variant), we add a thin
  // horizontal band where a bandeau / wrap would be — subtle enough to read
  // as a sliver of cloth without becoming a shirt.
  if (!isBlackClad && strapHex !== null) {
    // The torso already IS the strap colour, so the strap is implicit. Skip.
  } else if (!isBlackClad) {
    // Bare top — add a thin band high on the torso for a wrapped-fabric
    // hint without explicitly clothing the figure.
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.10, 6),
      new THREE.MeshStandardMaterial({
        color: wrapHex, roughness: 0.95, flatShading: true,
      }),
    );
    band.position.y = 1.18;
    g.add(band);
  }

  // ----- Arms — two-segment with elbow pivot, posed per role -----
  const armRefs = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.26, 1.30, 0);
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.065, 0.28, 4, 6),
      skinMat,    // arms are always bare skin for tribal figures
    );
    upper.position.y = -0.16;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    const lower = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.055, 0.26, 4, 6),
      skinMat,
    );
    lower.position.y = -0.16;
    elbow.add(lower);
    g.add(shoulder);

    // Per-pose initial rotation. Records for animation.
    if (pose === 'dance') {
      // Arms up and out in a V-pose. Earlier this was `rotation.x = -1.4`
      // which actually pivots the arm BEHIND the body (the "clasped behind
      // back" silhouette Gary called out). Pure Z-rotation around the
      // shoulder is what raises the arm overhead.
      //   default arm hangs at (0, -0.18, 0). rotation.z = sx * 2.2 rotates
      //   the arm so it points up-and-outward: (sx*0.15, +0.10, 0).
      shoulder.rotation.z = sx * 2.2;
      shoulder.rotation.x = 0.15;    // small forward tilt — feels alive
    } else if (pose === 'drum_seated') {
      // Forward and down — hands at lap, ready to strike a drum.
      shoulder.rotation.x = 0.9;
      elbow.rotation.x = 0.5;
    } else if (pose === 'firekeeper') {
      // Both hands wrapped around an imagined pole — shoulders slightly
      // forward, elbows bent so hands meet in front at chest height.
      shoulder.rotation.x = 0.4;
      shoulder.rotation.z = sx * 0.4;
      elbow.rotation.x = 0.6;
    } else if (pose === 'spotter') {
      // Arms crossed-ish in front — chill, "I'm watching" body language.
      shoulder.rotation.x = 0.35;
      shoulder.rotation.z = sx * 0.2;
      elbow.rotation.x = 1.2;
      elbow.rotation.z = sx * -0.8;
    } else {
      // 'stand' default — straight down.
    }
    armRefs.push({ shoulder, elbow, side: sx });
  }

  // ----- Head -----
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22, 1),
    skinMat,
  );
  head.position.y = 1.60;
  head.castShadow = true;
  g.add(head);

  // ----- Hair -----
  // Earlier version used a horizontally-squashed icosphere sitting low on
  // the head, which read as a balding "ear-to-ear semicircle" ring instead
  // of hair (Gary's catch). New build:
  //   * a slightly larger-than-head sphere PUSHED BACK so the front of the
  //     head (face/eyes) is uncovered, and the sphere wraps the crown +
  //     sides + back
  //   * a long cone trailing down the back for the "long flowing" look
  // Black-clad figures still get a tight cropped cap (no flow).
  const hairGroup = new THREE.Group();
  hairGroup.position.set(0, 1.60, 0);
  if (!isBlackClad) {
    // Wig — bigger than the head, offset back so the face peeks out.
    // Center at z = +0.12 means the wig's front face is at z = -0.14,
    // safely behind the eyes (z = -0.18 in face-local coords).
    const wig = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.26, 1), hairMat,
    );
    wig.position.set(0, 0.06, 0.12);
    wig.scale.set(1.0, 1.05, 1.1);
    wig.castShadow = true;
    hairGroup.add(wig);

    // Long ponytail / flowing hair behind the head, anchored at the wig's
    // lower-back. Tapered cone tilts slightly back so it hangs below the
    // shoulder blades.
    const ponytail = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.75, 7),
      hairMat,
    );
    ponytail.position.set(0, -0.36, 0.12);
    ponytail.rotation.x = -0.25;      // tip swings back
    ponytail.castShadow = true;
    hairGroup.add(ponytail);
  } else {
    // Black-clad: tight cropped cap that hugs the head.
    const cap = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.24, 1), hairMat,
    );
    cap.position.set(0, 0.04, 0.03);
    cap.scale.set(1, 0.85, 1.05);
    hairGroup.add(cap);
  }
  g.add(hairGroup);

  // ----- Eyes -----
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 });
  for (const ex of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
    eye.position.set(ex, 1.63, -0.18);
    g.add(eye);
  }

  // Pose-specific scale tweak so seated drummers actually sit instead of
  // floating chair-less. We scale the WHOLE figure down on Y a little + drop
  // it slightly so the bench surface (~0.6m) lands at the figure's seat.
  if (pose === 'drum_seated') {
    g.scale.set(1, 0.75, 1);
    g.position.y = -0.10;
  }
  if (scale !== 1) {
    g.scale.multiplyScalar(scale);
  }

  // ----- Per-figure animation interface -----
  // The central updater pokes these refs each frame. Closures over local
  // state for things like phase offsets.
  const phase = rng() * Math.PI * 2;

  return {
    group: g,
    kind: pose,
    phase,
    armRefs,
    hairGroup,
    torso,
  };
}

// ---------- Convenience factory builders + pose presets ----------

export function buildFireDancer(rng = Math.random) {
  return buildTribalFigure(rng, { pose: 'dance' });
}

export function buildHandDrummer(rng = Math.random) {
  const figure = buildTribalFigure(rng, { pose: 'drum_seated' });
  // Djembe sits IN FRONT of the drummer — figure's local "forward" is -Z, so
  // the drum lives at negative z, low enough that the head is at lap height.
  // Earlier this was at +Z (behind the body) so the arms reached forward into
  // empty air; Gary called this out as "drums in them, not in front".
  const djembe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.16, 0.50, 12),
    new THREE.MeshStandardMaterial({
      color: 0x6a3a18, roughness: 0.95, flatShading: true,
    }),
  );
  djembe.position.set(0, 0.60, -0.32);
  djembe.castShadow = true;
  figure.group.add(djembe);
  // Drumhead — pale skin, on top of the djembe body
  const drumhead = new THREE.Mesh(
    new THREE.CircleGeometry(0.215, 12),
    new THREE.MeshStandardMaterial({
      color: 0xd9b878, roughness: 0.9, flatShading: true, side: THREE.DoubleSide,
    }),
  );
  drumhead.rotation.x = -Math.PI / 2;
  drumhead.position.set(0, 0.86, -0.32);
  figure.group.add(drumhead);
  figure.djembe = djembe;
  return figure;
}

export function buildFirekeeper(rng = Math.random) {
  const figure = buildTribalFigure(rng, { pose: 'firekeeper' });
  // Hand-held pole — long dark cylinder leaning forward like a hot-iron poker.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 2.2, 6),
    new THREE.MeshStandardMaterial({
      color: 0x2a1d12, roughness: 0.9, flatShading: true,
    }),
  );
  // Position pole so it crosses the body diagonally — top by the head,
  // bottom near the ground in front. Held in both hands.
  pole.position.set(0.05, 1.30, 0.65);
  pole.rotation.x = 0.85;
  figure.group.add(pole);
  figure.pole = pole;
  return figure;
}

export function buildSpotter(rng = Math.random) {
  return buildTribalFigure(rng, { pose: 'spotter' });
}

// ---------- Central animator ----------
//
// Walks the per-circle figure list once a frame. Cheap math + a few
// rotation pokes per figure. The arm-strike on drummers is driven on a
// continuous sine + the body bob is a separate sine — no audio coupling
// needed for the visual to read as "they're drumming".

export function updateTribalFigures(t, nightness, figures) {
  for (let i = 0; i < figures.length; i++) {
    const f = figures[i];
    switch (f.kind) {
      case 'dance': updateDancer(t, f); break;
      case 'drum_seated': updateDrummer(t, f); break;
      case 'firekeeper': updateFirekeeper(t, f); break;
      case 'spotter': updateSpotter(t, f); break;
    }
  }
}

function updateDancer(t, f) {
  // Figures are parented to the drum-circle group whose origin sits at the
  // fire — so dancers move in LOCAL coords with the fire at (0,0,0). Each
  // dancer has its own orbit speed + phase; the radius modulates so one
  // dancer occasionally crosses inward toward the fire (reviewer's
  // "they're feeling the music" suggestion).
  const orbitSpeed = 0.34;
  const a = f.phase + t * orbitSpeed;
  const baseR = 3.5;
  const innerDip = 0.6 * (0.5 + 0.5 * Math.sin(t * 0.35 + f.phase * 2.3));
  const r = baseR - innerDip;
  f.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);

  // Face the DIRECTION OF MOTION (orbit tangent), not the fire. For
  // counterclockwise motion at angle a, tangent direction in world XZ is
  // (-sin a, cos a) → rotation.y = π - a makes local -Z point that way.
  // Twirl: every ~10s the dancer spins a full 360° over ~1.2s, layered on
  // top of the orbit-facing rotation.
  const twirlCycle = 9 + (f.phase * 0.5) % 4;     // 9-13s per twirl, deterministic per dancer
  const twirlPhase = (t * 0.9 + f.phase * 1.7) % twirlCycle;
  const twirlDur = 1.2;
  let twirl = 0;
  if (twirlPhase < twirlDur) {
    // Smoothstep the spin so it accelerates + decelerates rather than
    // snapping into rotation.
    const u = twirlPhase / twirlDur;
    const eased = u * u * (3 - 2 * u);
    twirl = eased * Math.PI * 2;
  }
  f.group.rotation.y = Math.PI - a + twirl;

  // Sway hips + torso — small Z rotation on the whole figure.
  const sway = Math.sin(t * 2.5 + f.phase) * 0.10;
  f.group.rotation.z = sway;

  // Arms above head, swaying together. Base pose is set at build time
  // (shoulder.rotation.z = sx * 2.2). Animation adds a unified L/R tilt
  // that follows the body sway — both arms drift the same direction so it
  // reads as one continuous gesture, not flapping.
  for (const arm of f.armRefs) {
    arm.shoulder.rotation.z = arm.side * 2.2 + sway * 0.3;
    arm.shoulder.rotation.x = 0.15 + sway * 0.10;
  }
  // Hair sway — slight rotation around X opposite the body sway.
  if (f.hairGroup) f.hairGroup.rotation.z = -sway * 0.8;
}

function updateDrummer(t, f) {
  // Body bob — gentle forward-backward lean at drum tempo. Doesn't tie to
  // audio voices yet (would require per-drummer voice mapping); a bob at
  // ~90bpm reads as "drumming" without the coupling.
  const bpm = 80;
  const bobHz = bpm / 60;
  f.group.rotation.x = Math.sin(t * bobHz * 2 * Math.PI + f.phase) * 0.06;
  // Arm strike — alternating left/right hands at twice the bob rate, so
  // there's a hit every half-beat. Strike amplitude = 0.4 rad pitch on the
  // shoulder.
  for (let i = 0; i < f.armRefs.length; i++) {
    const arm = f.armRefs[i];
    const handPhase = f.phase + (i === 0 ? 0 : Math.PI);
    const strike = 0.5 + 0.5 * Math.sin(t * bobHz * 4 * Math.PI + handPhase);
    // Base shoulder rotation is 0.9 (forward-down). Strike subtracts ~0.4
    // to bring the hand up briefly, then back down.
    arm.shoulder.rotation.x = 0.9 - strike * 0.35;
  }
}

function updateFirekeeper(t, f) {
  // Mostly still. Once every ~12 seconds, lean forward to poke the fire
  // (rotate the WHOLE figure around its base by ~12°).
  const cycle = 12;
  const phase = (t + f.phase) % cycle;
  // Lean window: 1 second long, peak at 0.5s in.
  if (phase < 1.0) {
    const k = phase < 0.5 ? (phase / 0.5) : ((1.0 - phase) / 0.5);
    f.group.rotation.x = k * 0.22;
  } else {
    f.group.rotation.x = 0;
  }
}

function updateSpotter(t, f) {
  // Subtle weight shift left/right — body sway around Z, very slow.
  f.group.rotation.z = Math.sin(t * 0.4 + f.phase) * 0.04;
}
