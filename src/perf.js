// Device performance profile. Detected once at boot from cheap signals
// (touch, screen size, hardware concurrency, deviceMemory). Everything that
// has a knob — renderer pixel ratio, post-processing, shadow map, crowd
// density, chunk draw distance — reads from PERF instead of hardcoding.
//
// Override at runtime for testing: `window.__perfProfile = 'low'; location.reload()`.

function detect() {
  // Manual override wins.
  const forced = (typeof window !== 'undefined' && window.__perfProfile) ||
                 new URLSearchParams(location.search).get('perf');
  if (forced === 'low' || forced === 'mid' || forced === 'high') return forced;

  const isTouch =
    (typeof window !== 'undefined') &&
    (('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));

  // Hardware signals (not all browsers expose these).
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4; // GB; iOS Safari doesn't expose this — left at default
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 700;

  // Touch + small screen = phone. Treat as low-end by default; iPhones lie
  // about deviceMemory so we can't trust it on iOS.
  if (isTouch && smallScreen) return 'low';
  // Touch + big screen = tablet. Better than phone, worse than desktop.
  if (isTouch) return 'mid';
  // Anemic desktop (cheap laptops, old machines).
  if (cores <= 2 || mem <= 2) return 'mid';
  return 'high';
}

const profile = detect();

const TABLE = {
  low: {
    name: 'low',
    pixelRatioCap: 1.25,
    bloom: true,
    bloomStrength: 0.35,    // softer than desktop (was 0.6)
    bloomRadius: 0.7,
    bloomThreshold: 0.85,
    shadows: false,
    shadowType: 'basic',
    crowdMax: 180,
    chunkLoadRadius: 1,
    chunkUnloadRadius: 2,
    // contextLights = optional proxy PointLights at firepits / drum-circle
    // pits / etc., one per cluster. Off on low so emissive + bloom carry the
    // load without paying the per-fragment lighting cost on slow GPUs.
    contextLights: false,
  },
  mid: {
    name: 'mid',
    pixelRatioCap: 1.5,
    bloom: true,
    bloomStrength: 0.5,
    bloomRadius: 0.8,
    bloomThreshold: 0.8,
    shadows: true,
    shadowType: 'basic',
    crowdMax: 320,
    chunkLoadRadius: 2,
    chunkUnloadRadius: 3,
    contextLights: true,
  },
  high: {
    name: 'high',
    pixelRatioCap: 2,
    bloom: true,
    bloomStrength: 0.6,
    bloomRadius: 0.85,
    bloomThreshold: 0.78,
    shadows: true,
    shadowType: 'soft',
    crowdMax: 500,
    chunkLoadRadius: 2,
    chunkUnloadRadius: 3,
    contextLights: true,
  },
};

export const PERF = TABLE[profile];

if (typeof console !== 'undefined') {
  console.info('[perf] profile =', PERF.name, PERF);
}
