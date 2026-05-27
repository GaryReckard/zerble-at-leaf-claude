// Low-tier shader downgrade: swap MeshStandardMaterial → MeshLambertMaterial.
//
// MeshStandardMaterial is PBR — per-fragment lighting with metallic/roughness
// BRDF, IBL terms, and a few extra texture taps. On integrated GPUs and
// older mobile chips that fragment cost is the difference between locked
// 60fps and a stuttery 30. MeshLambertMaterial does cheap per-vertex
// diffuse lighting (Gouraud-ish) and skips all the PBR work.
//
// Per the r/threejs perf thread: "swap MeshStandardMaterial for
// MeshLambertMaterial on low-end devices" — it's the single highest-ROI
// material-side change for forward-rendered scenes.
//
// We do it via constructor monkey-patch so the swap is transparent to every
// model file. The bargain: lambert ignores `roughness`, `metalness`,
// `envMap`, normal-map detail. For Zerble's flat-shaded look that's a fine
// trade — most surfaces are matte already.
//
// Imported first thing in main.js (before any model module), gated on
// `PERF.name === 'low'`.

import * as THREE from 'three';
import { PERF } from './perf.js';

// Properties Lambert supports that we want to carry across from Standard.
// Standard-only properties (roughness, metalness, envMapIntensity, etc.) are
// silently dropped — Lambert doesn't model them.
const LAMBERT_COMPATIBLE = new Set([
  'color', 'map', 'lightMap', 'lightMapIntensity',
  'aoMap', 'aoMapIntensity',
  'emissive', 'emissiveMap', 'emissiveIntensity',
  'bumpMap', 'bumpScale',
  'normalMap', 'normalScale',  // Lambert technically ignores normals but accepts the field
  'displacementMap', 'displacementScale', 'displacementBias',
  'specularMap', 'alphaMap', 'envMap', 'combine', 'reflectivity',
  'refractionRatio', 'wireframe', 'wireframeLinewidth',
  'flatShading', 'fog',
  // Standard Material base props inherited from Material:
  'transparent', 'opacity', 'side', 'alphaTest', 'depthWrite', 'depthTest',
  'blending', 'visible', 'name', 'userData', 'vertexColors',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
  'toneMapped', 'premultipliedAlpha', 'dithering',
]);

function install() {
  const OriginalStandard = THREE.MeshStandardMaterial;

  // Class that quacks like MeshStandardMaterial but is actually a Lambert.
  // `instanceof THREE.MeshStandardMaterial` checks elsewhere will still
  // pass (Lambert won't), so any consumer code that switches on material
  // type should be checked. In this codebase nothing does that.
  function LambertShim(params = {}) {
    const filtered = {};
    for (const k of Object.keys(params)) {
      if (LAMBERT_COMPATIBLE.has(k)) filtered[k] = params[k];
    }
    // MeshLambertMaterial constructor accepts the same options-object shape.
    const mat = new THREE.MeshLambertMaterial(filtered);
    // Tag for diagnostics — `mat.type` will read "MeshLambertMaterial",
    // userData.loweredFromStandard makes the swap traceable.
    mat.userData.loweredFromStandard = true;
    return mat;
  }

  // Try to swap the exported constructor. ES module namespace objects are
  // frozen per spec (non-writable, non-configurable exports), so this
  // assignment throws on strict implementations (notably Safari mobile,
  // and any browser running with strict module semantics). Chrome desktop
  // historically tolerated it, which is why this used to work everywhere.
  //
  // If the swap fails, low-tier just runs with the original PBR material.
  // That's a perf regression on those devices but the game still RUNS,
  // which is the important part. A proper fix would route every model file
  // through a wrapper module that re-exports a mutable THREE — significant
  // churn for a tier-specific optimization. Tracking in ROADMAP.md.
  try {
    THREE.MeshStandardMaterial = LambertShim;
    THREE.MeshStandardMaterial._original = OriginalStandard;
    console.info('[perf] Lambert fallback installed — MeshStandardMaterial → MeshLambertMaterial');
  } catch (e) {
    console.warn(
      '[perf] Lambert fallback unavailable on this browser (module namespace is frozen). ' +
      'Low-tier devices will run with full MeshStandardMaterial. ' +
      'See ROADMAP.md → "Lambert fallback via wrapper module" for the proper fix.',
      e
    );
  }
}

if (PERF.name === 'low') {
  install();
}
