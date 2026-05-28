// Tiny seeded RNG (mulberry32) + stable hash so chunk generation is deterministic.
//
// Two flavors of hash now live here:
//   * hash2(x, y)           — pure 32-bit hash of (x, y). Unaffected by the
//                             session seed. Use when something MUST stay
//                             identical across sessions (e.g. the (0,0)
//                             chunk's main-stage + entrance arch layout).
//   * worldHash(x, y, salt) — same hash with the session seed mixed in.
//                             Use for any world content that should vary
//                             per session (lakes, forests, non-origin chunk
//                             themes, music seeds, drum seeds, …).
//
// The session seed is set once at boot from `?seed=` (see main.js). When it
// is 0 (the default), worldHash with salt=0 collapses to hash2(x, y), so the
// behavior matches the old single-hash regime if anyone forgets to wire it.

let SESSION_SEED = 0;

// Accepts a string (FNV-1a-style hashed to 32-bit) or a number. Returns the
// resolved 32-bit int so callers can echo it back to the player.
export function setSessionSeed(seedInput) {
  let s;
  if (typeof seedInput === 'string' && seedInput.length > 0) {
    s = 0x811C9DC5;
    for (let i = 0; i < seedInput.length; i++) {
      s = Math.imul(s ^ seedInput.charCodeAt(i), 0x01000193);
    }
    s = s >>> 0;
  } else if (typeof seedInput === 'number' && Number.isFinite(seedInput)) {
    s = (seedInput | 0) >>> 0;
  } else {
    s = 0;
  }
  SESSION_SEED = s;
  return s;
}

export function getSessionSeed() { return SESSION_SEED; }

export function hash2(x, y) {
  // 32-bit integer hash of (x, y)
  let h = Math.imul(x | 0, 0x9E3779B1);
  h = (h ^ Math.imul(y | 0, 0x85EBCA77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21F0AAAD) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735A2D97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

// Session-salted variant. The session seed is split across both inputs so
// the avalanche through hash2 actually interacts with x and y rather than
// just nudging the final XOR. `salt` lets a caller stack a second
// independent stream on the same (cx, cz) (used by pickTheme below to keep
// "what theme is this chunk" decoupled from "what props does this chunk
// scatter").
export function worldHash(x, y, salt = 0) {
  const s = SESSION_SEED;
  const sx = (s ^ Math.imul(salt | 0, 0x9E3779B1)) | 0;
  const sy = (((s << 13) | (s >>> 19)) ^ Math.imul(salt | 0, 0x85EBCA77)) | 0;
  return hash2((x | 0) + sx, (y | 0) + sy);
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
  return mulberry32(worldHash(cx, cz, salt));
}

// Terrain is now intentionally flat. The previous sinusoidal hills (up to ~1.5m
// peak-to-peak) clipped through paths, lakes, causeways, and other y≈0 decals,
// and they translated with the player even after world-coord resampling. Visual
// variety comes from chunk decorations (paths, water, props, lights) instead.
// Kept the function signature for any callers that rely on it.
export function terrainHeight(_x, _z) {
  return 0;
}
