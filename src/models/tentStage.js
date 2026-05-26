// Big white festival tent enclosing a stage. The stage sits at the back of
// the tent facing the open front; a soundbooth + mixer occupies a small
// platform near the back where the FOH engineer mixes the show.
//
// Returned: { group, stagePos, mixerPos, crowdSpots, openingZ }
//   - stagePos: world-relative position of the stage center
//   - mixerPos: where the soundbooth platform lives (NPC stands here)
//   - crowdSpots: an array of XZ positions inside the tent for ambient crowd
//   - openingZ: the Z value at which the tent opens (driving entrance)

import * as THREE from 'three';
import { buildStage, placeBandOnStage } from './stage.js';

// Tent dimensions
const TENT_WIDTH = 28;       // X
const TENT_DEPTH = 38;       // Z (longer axis)
const TENT_RIDGE_HEIGHT = 11; // peak Y
const TENT_WALL_HEIGHT = 5.5; // height of the vertical wall before slope starts
const STAGE_INSET = 3;        // how far inside the tent the stage sits

export function buildTentStage(opts = {}) {
  const { rng = Math.random, leafTexture = null } = opts;
  const group = new THREE.Group();
  group.name = 'TentStage';

  const halfW = TENT_WIDTH / 2;
  const halfD = TENT_DEPTH / 2;

  // ---- Tent canopy: A symmetric "barn" tent built from custom faces. ----
  // - Two long slanted roof panels (left + right) meeting at the ridge
  // - Back-wall closed; front-wall is the open entrance (omitted)
  // - LEFT and RIGHT sides intentionally open per the reference: tent is
  //   only closed at the back, so Zerble can drive in from any of the three
  //   open sides.
  // All canvas is a single off-white shade (no stripes).
  const canvasMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb, roughness: 0.85, side: THREE.DoubleSide, flatShading: true,
  });

  // Helper: convex polygon from CCW vertices into a Mesh.
  const polyMesh = (verts, mat) => {
    const positions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
      positions[i * 3 + 0] = verts[i][0];
      positions[i * 3 + 1] = verts[i][1];
      positions[i * 3 + 2] = verts[i][2];
    }
    // Triangulate fan (works for convex)
    const indices = [];
    for (let i = 1; i < verts.length - 1; i++) indices.push(0, i, i + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  };

  // (No left or right side walls — Zerble can drive in from either side.)

  // Back wall (closed end, z = -halfD)
  // Triangle on top + rectangle below = pentagon.
  group.add(polyMesh([
    [-halfW, 0,                       -halfD],
    [-halfW, TENT_WALL_HEIGHT,        -halfD],
    [0,      TENT_RIDGE_HEIGHT,       -halfD],
    [ halfW, TENT_WALL_HEIGHT,        -halfD],
    [ halfW, 0,                       -halfD],
  ], canvasMat));

  // (No front wall — fully open front entrance.)

  // Roof panels — two long trapezoidal slopes from each side wall up to the
  // ridge. Solid white now (no stripes).
  group.add(polyMesh([
    [-halfW, TENT_WALL_HEIGHT, -halfD],
    [-halfW, TENT_WALL_HEIGHT,  halfD],
    [0,      TENT_RIDGE_HEIGHT, halfD],
    [0,      TENT_RIDGE_HEIGHT, -halfD],
  ], canvasMat));
  group.add(polyMesh([
    [0,      TENT_RIDGE_HEIGHT, -halfD],
    [0,      TENT_RIDGE_HEIGHT,  halfD],
    [ halfW, TENT_WALL_HEIGHT,  halfD],
    [ halfW, TENT_WALL_HEIGHT, -halfD],
  ], canvasMat));

  // Ridge pole — visible spine running along the peak. Adds structural feel.
  const ridgeMat = new THREE.MeshStandardMaterial({
    color: 0x6a4a2a, roughness: 0.9, flatShading: true,
  });
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, TENT_DEPTH), ridgeMat,
  );
  ridge.position.set(0, TENT_RIDGE_HEIGHT, 0);
  group.add(ridge);

  // Corner poles
  for (const [px, pz] of [
    [-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD],
  ]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.18, TENT_WALL_HEIGHT, 8), ridgeMat,
    );
    pole.position.set(px, TENT_WALL_HEIGHT / 2, pz);
    // Slim pole — tent roof carries the silhouette.
    group.add(pole);
  }

  // ---- Stage at the back end of the tent ----
  // The tent ridge sits at TENT_RIDGE_HEIGHT (11) with the wall at
  // TENT_WALL_HEIGHT (5.5). Roof slopes linearly between them. The stage's
  // outer truss bars sit at world Y = 9 * stageScale, X = ±7 * stageScale.
  // The roof height at that X is 5.5 + 5.5 * (1 - 7*s/14) = 11 - 2.75*s.
  // For the truss to clear the roof we need 9*s < 11 - 2.75*s → s < 0.94.
  // Pick a comfortable 0.82 so the truss + the side stage lights are
  // visibly under the canvas, not poking through.
  const stageBuild = buildStage({
    isMain: false, leafTexture, rng, scale: 0.82,
  });
  // The stage's local +Z is its FRONT (banner side at -Z is the BACK). We
  // want the band facing +Z toward the open front of the tent. With NO
  // rotation, the stage already points its front at +Z — which is exactly
  // where the entrance is. (Previously we rotated by π which flipped them
  // to face the back wall — that was the bug.)
  const stageZ = -halfD + STAGE_INSET + stageBuild.deckDepth / 2;
  stageBuild.group.position.set(0, 0, stageZ);
  group.add(stageBuild.group);

  // Drop a default band onto the stage so the tent isn't visually empty.
  const instruments = ['lead_vocal', 'guitar', 'drum'];
  placeBandOnStage(stageBuild.group, instruments, {
    deckWidth: stageBuild.deckWidth, deckDepth: stageBuild.deckDepth,
    deckHeight: stageBuild.deckHeight, rng,
  });

  // ---- Soundbooth at the BACK of the tent (audience-facing end) ----
  // Wait — in a tent shape we have stage at z = -halfD (back) and the open
  // entrance at z = +halfD. The soundbooth lives at the OPEN end so the
  // engineer faces toward the stage. Place it on a small raised platform.
  const boothMat = new THREE.MeshStandardMaterial({
    color: 0x3a2e22, roughness: 0.9, flatShading: true,
  });
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(4.0, 0.5, 2.5), boothMat,
  );
  platform.position.set(0, 0.25, halfD - 3);
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  // Mixer desk on top of the platform (a slanted black box with knobs).
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.18, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.5, metalness: 0.4 }),
  );
  desk.position.set(0, 1.05, halfD - 3.4);
  desk.rotation.x = -0.18;
  group.add(desk);
  // Sprinkle of LED indicator dots on the desk
  const ledColors = [0xff5577, 0xffe066, 0x66ff88, 0x66d9ff];
  for (let i = 0; i < 12; i++) {
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 6, 6),
      new THREE.MeshStandardMaterial({
        color: ledColors[i % ledColors.length],
        emissive: ledColors[i % ledColors.length],
        emissiveIntensity: 1.4,
      }),
    );
    led.position.set(-1.3 + i * 0.24, 1.16, halfD - 3.55);
    group.add(led);
  }

  // The mixer position — where an ambient NPC ("sound guy") can be parked.
  const mixerPos = new THREE.Vector3(0, 0, halfD - 3);

  // Crowd spots inside the tent — a grid filling the middle. Skip the very
  // back (stage) and very front (booth) ends.
  const crowdSpots = [];
  for (let i = 0; i < 18; i++) {
    const rx = (rng() - 0.5) * (TENT_WIDTH - 4);
    // crowd lives between z = -halfD + 8 (just past stage front) and
    // z = halfD - 6 (just before the booth)
    const rz = -halfD + 8 + rng() * (TENT_DEPTH - 14);
    crowdSpots.push(new THREE.Vector3(rx, 0, rz));
  }

  return {
    group,
    stagePos: new THREE.Vector3(0, 0, stageZ),
    stageWidth: stageBuild.deckWidth,
    stageDepth: stageBuild.deckDepth,
    stageHeight: stageBuild.deckHeight,
    stageScale: stageBuild.scale,
    stageLights: stageBuild.stageLights,
    stageBeams: stageBuild.stageBeams,
    mixerPos,
    crowdSpots,
    openingZ: halfD,
    width: TENT_WIDTH,
    depth: TENT_DEPTH,
    ridgeHeight: TENT_RIDGE_HEIGHT,
  };
}
