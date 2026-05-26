// Day / night cycle for the festival. A single normalized time `t` runs from
// 0 (dawn) → 0.25 (noon) → 0.5 (dusk) → 0.75 (midnight) → 1 (next dawn).
// Length of one full cycle is `CYCLE_SECONDS` so Gary can tune the pace.
//
// The cycle drives:
//   - sky shader top/bottom colors
//   - sun directional light color + intensity + arc
//   - hemisphere light intensity
//   - fog color
//   - `nightness` (0..1) accessor that other systems use to fade in
//     headlights, festival lights, stage light shows, etc.
//
// `nightness` is a smooth ramp: 0 in midday, 1 at midnight, with a soft
// transition at dawn/dusk.

import * as THREE from 'three';

// One full day takes 6 minutes. Adjust if it's too fast/slow during play.
const CYCLE_SECONDS = 360;

// Hand-tuned color stops for each phase. cosmetics nudged toward warm festival
// palette so the night doesn't feel like an empty void.
const SKY_TOP_DAY     = new THREE.Color(0x6fb6e8);
const SKY_BOTTOM_DAY  = new THREE.Color(0xffd0a8);
const SKY_TOP_DUSK    = new THREE.Color(0x3a2e6a);
const SKY_BOTTOM_DUSK = new THREE.Color(0xff7a4e);
// Night colors lifted slightly from the original 0x0a0a28 / 0x191638 set —
// Gary asked for "a wee bit less dark", so the sky reads as moonlit deep
// blue rather than ink, and the ground hemisphere brightens enough that
// you can still see grass without the headlight on.
const SKY_TOP_NIGHT   = new THREE.Color(0x121540);
const SKY_BOTTOM_NIGHT= new THREE.Color(0x232148);

const SUN_DAY    = new THREE.Color(0xffe1b0);
const SUN_DUSK   = new THREE.Color(0xff7a3e);
const MOON_NIGHT = new THREE.Color(0xa6bcdf);

const FOG_DAY   = new THREE.Color(0xffcfae);
const FOG_DUSK  = new THREE.Color(0xb86a5a);
const FOG_NIGHT = new THREE.Color(0x232048);

// Hemisphere light colors. Sky color blends through dawn/dusk/night,
// ground color stays warmer to keep grass readable at night.
const HEMI_SKY_DAY   = new THREE.Color(0xa9d6ff);
const HEMI_SKY_NIGHT = new THREE.Color(0x3a4598);
const HEMI_GROUND_DAY   = new THREE.Color(0xc89265);
const HEMI_GROUND_NIGHT = new THREE.Color(0x3c2a44);

// Sun (moon) + hemi + ambient intensities at night — bumped a touch so
// the cart, paths, and figures don't disappear into pure black between
// fire pools.
const SUN_INTENSITY_DAY = 1.35;
const SUN_INTENSITY_NIGHT = 0.18;
const HEMI_INTENSITY_DAY = 0.75;
const HEMI_INTENSITY_NIGHT = 0.55;
const AMBIENT_INTENSITY_DAY = 0.15;
const AMBIENT_INTENSITY_NIGHT = 0.18;

// Smoothstep helper — saturating interpolation between two thresholds.
function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Returns a 0..1 "how dark is it" value from t.
// 0 between dawn+30min and dusk-30min (noon-ish). Ramps to 1 across the
// dusk-night-dawn arc.
function nightnessFromT(t) {
  // Daytime band: roughly 0.07..0.43 (~17% to 43% of cycle)
  // Twilight: 0.43..0.55 and 0.95..0.07 (wraps)
  // Night: 0.55..0.95
  if (t >= 0.07 && t <= 0.43) return 0;
  if (t > 0.43 && t < 0.55) return smoothstep(0.43, 0.55, t);
  if (t >= 0.55 && t <= 0.95) return 1;
  if (t > 0.95) return 1 - smoothstep(0.95, 1.07, t);
  // t < 0.07 (early dawn, wrapping side)
  return 1 - smoothstep(-0.05, 0.07, t);
}

export class TimeOfDay {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.cycleSeconds = opts.cycleSeconds || CYCLE_SECONDS;
    // Start the world at mid-morning so the first thing the player sees is
    // bright daylight (gives them a baseline before night sneaks in).
    this.t = opts.startT != null ? opts.startT : 0.15;
    this._nightness = nightnessFromT(this.t);

    // Hold references the world.js setup will inject.
    this.sky = null;
    this.sun = null;
    this.hemi = null;
    this.ambient = null;
    this.fog = null;
  }

  // World.js calls this after building the scene, passing in references it
  // owns. We mutate these directly each frame.
  attach({ sky, sun, hemi, ambient }) {
    this.sky = sky;
    this.sun = sun;
    this.hemi = hemi;
    this.ambient = ambient;
    this.fog = this.scene.fog || null;
  }

  // Smooth 0..1 darkness. Other systems use this to fade in lights.
  get nightness() {
    return this._nightness;
  }

  // Sunlight angle in radians around the world's Y axis — exposed so the
  // sun direction can drive long shadows.
  get sunAngle() {
    return this.t * Math.PI * 2;
  }

  update(dt) {
    this.t = (this.t + dt / this.cycleSeconds) % 1;
    this._nightness = nightnessFromT(this.t);
    this._applyVisuals();
  }

  // Force a particular t for testing (e.g. debug menu).
  setT(t) {
    this.t = ((t % 1) + 1) % 1;
    this._nightness = nightnessFromT(this.t);
    this._applyVisuals();
  }

  _applyVisuals() {
    const n = this._nightness;
    // Dusk weight peaks near the transitions (0.43..0.55 and 0.95..0.07).
    const duskBlend = (() => {
      const a = Math.abs(this.t - 0.49);
      const b = Math.abs(this.t - 0.99);
      const d = Math.min(a, b > 0.5 ? 1 - b : b);
      return THREE.MathUtils.clamp(1 - d / 0.12, 0, 1);
    })();

    // Sky colors: day → dusk → night blend.
    if (this.sky?.material?.uniforms) {
      const top = _tmpColorA;
      const bottom = _tmpColorB;
      top.copy(SKY_TOP_DAY).lerp(SKY_TOP_DUSK, duskBlend);
      top.lerp(SKY_TOP_NIGHT, n * (1 - duskBlend * 0.5));
      bottom.copy(SKY_BOTTOM_DAY).lerp(SKY_BOTTOM_DUSK, duskBlend);
      bottom.lerp(SKY_BOTTOM_NIGHT, n * (1 - duskBlend * 0.5));
      this.sky.material.uniforms.topColor.value.copy(top);
      this.sky.material.uniforms.bottomColor.value.copy(bottom);
    }

    // Sun direction + color + intensity
    if (this.sun) {
      const ang = (this.t - 0.07) * Math.PI / 0.36;     // arc from dawn to dusk
      // During day, the sun arcs from east (-x) through up (+y) to west (+x).
      // At night we lower it below horizon so shadows go away naturally.
      const dayPhase = this.t > 0.07 && this.t < 0.43;
      const arcAng = dayPhase ? ang : 0;
      const sunDist = 130;
      const x = Math.cos(arcAng - Math.PI / 2) * 90;
      const y = dayPhase ? Math.max(20, Math.sin(arcAng) * sunDist) : -5;
      const z = 60;
      this.sun.position.set(x, y, z);

      const c = _tmpColorA;
      c.copy(SUN_DAY).lerp(SUN_DUSK, duskBlend);
      c.lerp(MOON_NIGHT, n);
      this.sun.color.copy(c);
      this.sun.intensity = SUN_INTENSITY_DAY * (1 - n) + SUN_INTENSITY_NIGHT * n;
      this.sun.castShadow = n < 0.7;
    }

    if (this.hemi) {
      this.hemi.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, n);
      this.hemi.groundColor.copy(HEMI_GROUND_DAY).lerp(HEMI_GROUND_NIGHT, n);
      this.hemi.intensity = HEMI_INTENSITY_DAY * (1 - n) + HEMI_INTENSITY_NIGHT * n;
    }

    if (this.ambient) {
      this.ambient.intensity = AMBIENT_INTENSITY_DAY * (1 - n) + AMBIENT_INTENSITY_NIGHT * n;
    }

    if (this.fog) {
      const f = _tmpColorA;
      f.copy(FOG_DAY).lerp(FOG_DUSK, duskBlend);
      f.lerp(FOG_NIGHT, n);
      this.fog.color.copy(f);
    }
  }
}

const _tmpColorA = new THREE.Color();
const _tmpColorB = new THREE.Color();
