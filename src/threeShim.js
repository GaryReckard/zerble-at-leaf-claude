// Tier-aware three.js wrapper. Re-exports everything from real three.js
// (which lives at the 'three-actual' importmap entry) and overrides
// MeshStandardMaterial on low tier with a Lambert-returning shim.
//
// The importmap in index.html redirects 'three' → this file. Existing
// `import * as THREE from 'three'` calls across the codebase resolve here
// automatically — no caller changes. ES module spec resolution rules
// guarantee that a direct named export (our MeshStandardMaterial) takes
// precedence over a star re-export of the same name, so all other three.js
// exports (Vector3, BufferGeometry, etc.) pass through unchanged.
//
// Why this exists: an earlier approach tried to reassign
// `THREE.MeshStandardMaterial` after import in src/litFallback.js. ES
// module namespace objects are frozen per spec; Safari mobile (and any
// strict implementation) threw "Cannot assign to property of [object
// Module]" and crashed the whole game at boot. Chrome desktop tolerated
// it, which is why the bug only surfaced in mobile testing.
//
// The shim approach is the proper fix — the override happens at module
// resolution time, before any module-namespace object exists to freeze.

import * as ThreeOrig from 'three-actual';
import { PERF } from './perf.js';

// Properties MeshLambertMaterial supports + the base-Material props we
// want carried across from a MeshStandardMaterial constructor call.
// Standard-only properties (roughness, metalness, envMapIntensity, etc.)
// are silently dropped — Lambert doesn't model them.
const LAMBERT_COMPATIBLE = new Set([
  'color', 'map', 'lightMap', 'lightMapIntensity',
  'aoMap', 'aoMapIntensity',
  'emissive', 'emissiveMap', 'emissiveIntensity',
  'bumpMap', 'bumpScale',
  'normalMap', 'normalScale',  // Lambert ignores normals but accepts the field
  'displacementMap', 'displacementScale', 'displacementBias',
  'specularMap', 'alphaMap', 'envMap', 'combine', 'reflectivity',
  'refractionRatio', 'wireframe', 'wireframeLinewidth',
  'flatShading', 'fog',
  // Base Material props (inherited by every material subclass):
  'transparent', 'opacity', 'side', 'alphaTest', 'depthWrite', 'depthTest',
  'blending', 'visible', 'name', 'userData', 'vertexColors',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
  'toneMapped', 'premultipliedAlpha', 'dithering',
]);

const SwapEnabled = PERF.name === 'low';

// Constructor function (NOT a class — we want `new X()` to return whatever
// we hand back, including the wrong type for low-tier). Nothing in the
// codebase does `instanceof THREE.MeshStandardMaterial` so the type
// mismatch is invisible.
function MeshStandardMaterialShim(params = {}) {
  if (!SwapEnabled) {
    // Mid + high tier: real Standard material, full PBR.
    return new ThreeOrig.MeshStandardMaterial(params);
  }
  // Low tier: filter to Lambert-compatible props and build a Lambert.
  const filtered = {};
  for (const k of Object.keys(params)) {
    if (LAMBERT_COMPATIBLE.has(k)) filtered[k] = params[k];
  }
  const mat = new ThreeOrig.MeshLambertMaterial(filtered);
  // Tag for diagnostics — `mat.type` reads "MeshLambertMaterial",
  // userData.loweredFromStandard makes the swap traceable.
  mat.userData.loweredFromStandard = true;
  return mat;
}

if (SwapEnabled && typeof console !== 'undefined') {
  console.info('[perf] Lambert fallback active (threeShim) — MeshStandardMaterial → MeshLambertMaterial on low tier');
}

// Re-export everything from real three.js, then override
// MeshStandardMaterial with the shim. Direct named exports take precedence
// over star re-exports per the ES module spec.
export * from 'three-actual';
export { MeshStandardMaterialShim as MeshStandardMaterial };
