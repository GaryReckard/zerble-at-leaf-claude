// Distance-culled registry for PERF.contextLights-gated proxy lights
// (campsite firepits, drum-circle pits, Sugar Shack spots, etc).
//
// Three.js's forward renderer runs the per-fragment lighting equation
// against EVERY active light in the scene for every fragment of every
// shadow-receiving / lit material. Even a "far away" light with short
// distance falloff still pays this cost — `distance` clamps the
// CONTRIBUTION, not the shader work.
//
// The trick (per threejs-lighting skill's general guidance to "limit
// light count"): toggle `light.visible = false` on lights the camera
// can't perceive anyway. A disabled light is excluded from the
// renderer's per-fragment lighting loop entirely.
//
// Models call `register(light)` once when they build. Each frame
// `update(cameraPos)` walks the registry, sorts by squared distance,
// and turns on at most `BUDGET` of the closest lights within
// `MAX_DISTANCE`. Lights past either threshold get `visible = false`.
//
// Dead lights (chunk unloaded, parent gone) are pruned lazily.

import * as THREE from 'three';

const _registry = [];
const _tmpV = new THREE.Vector3();

// Tuned to leave headroom on mid tier (which has shadows on too — every
// extra light multiplies the shadow + lighting cost). Sun/hemi + Zerble's
// headlight + disco = 4 always-on lights; this BUDGET sets how many
// context lights can be active on top. Stage SpotLights cluster (6 per
// main stage) so we need enough budget for "you're near a stage" while
// still capping at "everything nearby" pile-ons.
const MAX_DISTANCE = 45;
const BUDGET = 8;
const MAX_DISTANCE_SQ = MAX_DISTANCE * MAX_DISTANCE;

// Cached sort buffer — reused each frame to avoid GC churn.
const _candidates = [];

export function register(light) {
  _registry.push(light);
}

// Optional explicit unregistration (chunks could call this on unload).
// Not required — the dead-parent prune below handles cleanup lazily.
export function unregister(light) {
  const idx = _registry.indexOf(light);
  if (idx >= 0) _registry.splice(idx, 1);
}

export function update(cameraPos) {
  // Lazy prune: any light whose parent chain has been removed from a
  // scene (chunk unload) is now orphaned. Drop it.
  for (let i = _registry.length - 1; i >= 0; i--) {
    if (!_registry[i].parent) {
      _registry.splice(i, 1);
    }
  }

  _candidates.length = 0;
  for (const light of _registry) {
    light.getWorldPosition(_tmpV);
    const dx = _tmpV.x - cameraPos.x;
    const dy = _tmpV.y - cameraPos.y;
    const dz = _tmpV.z - cameraPos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > MAX_DISTANCE_SQ) {
      light.visible = false;
      continue;
    }
    _candidates.push({ light, d2 });
  }

  // Sort ascending by distance² so the first BUDGET entries are the
  // closest. Anything past BUDGET turns off even if within range.
  _candidates.sort((a, b) => a.d2 - b.d2);
  for (let i = 0; i < _candidates.length; i++) {
    _candidates[i].light.visible = i < BUDGET;
  }
}

export function _debugRegistrySize() {
  return _registry.length;
}
