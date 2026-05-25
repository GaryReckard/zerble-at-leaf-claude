// Tiny seeded RNG (mulberry32) + stable hash so chunk generation is deterministic.

export function hash2(x, y) {
  // 32-bit integer hash of (x, y)
  let h = (x | 0) * 0x9E3779B1;
  h = (h ^ ((y | 0) * 0x85EBCA77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21F0AAAD) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735A2D97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function chunkRng(cx, cz, salt = 0) {
  return mulberry32(hash2(cx + salt * 4096, cz - salt * 4096));
}

// Terrain is now intentionally flat. The previous sinusoidal hills (up to ~1.5m
// peak-to-peak) clipped through paths, lakes, causeways, and other y≈0 decals,
// and they translated with the player even after world-coord resampling. Visual
// variety comes from chunk decorations (paths, water, props, lights) instead.
// Kept the function signature for any callers that rely on it.
export function terrainHeight(_x, _z) {
  return 0;
}
