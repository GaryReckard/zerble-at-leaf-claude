// trip.js — Psychedelic post-process effect for Zerble at LEAF.
//
// When a wook hangs near a stopped Zerble for 5 continuous seconds, the driver
// gets dosed. A ShaderPass ramps in over fadeIn seconds, sustains for duration,
// then fades out over fadeOut seconds, then enters a brief cooldown.
//
// Two modes:
//   Static  — sliders in the T menu set each effect's intensity 0..1 directly.
//             The master envelope ramps the whole thing in/out around them.
//   Dynamic — each effect has its own scripted timeline across the full trip
//             so the "feel" evolves. Wook-triggered trips use Dynamic mode.
//
// Usage (main.js):
//   import { Trip } from './trip.js';
//   Trip.init();
//   composer.addPass(Trip.pass);   // insert before OutputPass
//
//   // in tickBody(dt):
//   Trip.update(dt, zerble.position, Math.abs(zerble.speed), wookPositions);

import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Analytics } from './analytics.js';

// ---------- GLSL ----------

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float time;
  uniform float intensity;

  // Per-effect intensities (0..1)
  uniform float hueShift;
  uniform float saturation;
  uniform float uvRipple;
  uniform float chromaticAberration;
  uniform float lensDistortion;
  uniform float posterize;
  uniform float vignettePulse;
  uniform float brightnessPulse;

  varying vec2 vUv;

  // ---------- HSV helpers ----------
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = vUv;

    // ---- 1. Lens distortion (barrel, breathing) ----
    float ldStr = lensDistortion * intensity;
    if (ldStr > 0.0) {
      vec2 centered = uv - 0.5;
      float dist2 = dot(centered, centered);
      float breathe = 1.0 + sin(time * 0.5) * 0.08 * ldStr;
      uv = uv + centered * dist2 * ldStr * 0.6 * breathe;
    }

    // ---- 2. UV ripple ----
    float ripStr = uvRipple * intensity;
    if (ripStr > 0.0) {
      uv += sin(uv * 10.0 + time * 1.5) * ripStr * 0.02;
    }

    // ---- 3. Chromatic aberration ----
    float caStr = chromaticAberration * intensity;
    vec3 col;
    if (caStr > 0.001) {
      vec2 dir = normalize(uv - 0.5);
      float offset = caStr * 0.005;
      float r = texture2D(tDiffuse, clamp(uv + dir * offset,       0.0, 1.0)).r;
      float g = texture2D(tDiffuse, clamp(uv,                      0.0, 1.0)).g;
      float b = texture2D(tDiffuse, clamp(uv - dir * offset,       0.0, 1.0)).b;
      col = vec3(r, g, b);
    } else {
      col = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
    }

    // ---- 4. Hue shift ----
    float hsStr = hueShift * intensity;
    if (hsStr > 0.0) {
      vec3 hsv = rgb2hsv(col);
      hsv.x = fract(hsv.x + hsStr * 0.5 + 0.15 * sin(time * 0.3));
      col = hsv2rgb(hsv);
    }

    // ---- 5. Saturation boost ----
    float satStr = saturation * intensity;
    if (satStr > 0.0) {
      vec3 hsv = rgb2hsv(col);
      hsv.y = clamp(hsv.y * (1.0 + satStr), 0.0, 1.0);
      col = hsv2rgb(hsv);
    }

    // ---- 6. Posterize ----
    float postStr = posterize * intensity;
    if (postStr > 0.001) {
      float levels = mix(256.0, 5.0, postStr);
      col = floor(col * levels) / levels;
    }

    // ---- 7. Brightness pulse ----
    float bpStr = brightnessPulse * intensity;
    if (bpStr > 0.0) {
      col *= 1.0 + bpStr * 0.3 * sin(time * 1.2);
    }

    // ---- 8. Vignette pulse ----
    float vpStr = vignettePulse * intensity;
    if (vpStr > 0.0) {
      vec2 vigUv = vUv - 0.5;
      float vd = dot(vigUv, vigUv);
      float pulse = 1.0 + vpStr * 0.4 * sin(time * 0.4);
      float vignette = 1.0 - smoothstep(0.3, 0.75, vd * pulse * 2.0);
      col *= mix(1.0, vignette, vpStr);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------- Trip singleton ----------

// Effect keys (used in many places — keep the list authoritative here).
const EFFECT_KEYS = [
  'hueShift', 'saturation', 'uvRipple', 'chromaticAberration',
  'lensDistortion', 'posterize', 'vignettePulse', 'brightnessPulse',
];

export const Trip = {
  pass: null,

  // Slider-driven values used by Static mode.
  config: {
    hueShift:             0.5,
    saturation:           0.4,
    uvRipple:             0.5,
    chromaticAberration:  0.4,
    lensDistortion:       0.4,
    posterize:            0.0,
    vignettePulse:        0.3,
    brightnessPulse:      0.3,
  },

  // Timing / proximity settings
  duration:            180,        // 3-minute trip by default — wooks deal good shit
  fadeIn:              1.5,
  fadeOut:             3.0,
  cooldown:            5,
  proximityThreshold:  2.5,
  restSpeed:           0.5,
  restDuration:        5,

  // Mode
  dynamic:          false,   // wook auto-trigger + "Dynamic Trip" button set this true

  // Internal state
  state:            'idle',  // 'idle' | 'fading_in' | 'sustaining' | 'fading_out' | 'cooldown'
  _phaseTimer:      0,
  _proximityTimer:  0,
  _envelope:        0,
  _fadeOutFrom:     1,        // envelope value at the moment we entered fading_out
  _tripElapsed:     0,        // seconds since trip start (cleared in idle/cooldown)
  _timeAccum:       0,
  _nearestWookDist: Infinity,
  // Live per-effect values (what's actually being written to uniforms this frame).
  // Useful for the debug panel to show what the dynamic timeline is doing.
  live: {
    hueShift: 0, saturation: 0, uvRipple: 0, chromaticAberration: 0,
    lensDistortion: 0, posterize: 0, vignettePulse: 0, brightnessPulse: 0,
  },

  init() {
    const uniforms = { tDiffuse: { value: null }, time: { value: 0.0 }, intensity: { value: 0.0 } };
    for (const k of EFFECT_KEYS) uniforms[k] = { value: 0.0 };

    this.pass = new ShaderPass({ uniforms, vertexShader, fragmentShader });
    this.pass.renderToScreen = false;

    this.setPreset('standard');
  },

  // Manual trigger (FIRE TRIP button) — uses Static mode (whatever sliders are set to)
  trigger() {
    this.dynamic = false;
    this._enterFadingIn();
    Analytics.tripStart('manual_static');
  },

  // Manual trigger from the Dynamic Trip button — uses scripted per-effect timelines
  triggerDynamic() {
    this.dynamic = true;
    this._enterFadingIn();
    Analytics.tripStart('manual_dynamic');
  },

  _enterFadingIn() {
    this._phaseTimer = 0;
    this._proximityTimer = 0;
    this._tripElapsed = 0;
    this.state = 'fading_in';
  },

  // Cut the trip short — smoothly fade out from whatever envelope we're currently at.
  // No-op outside of an active trip phase.
  comeDown() {
    if (this.state === 'fading_in' || this.state === 'sustaining') {
      this._fadeOutFrom = this._envelope;
      this.state = 'fading_out';
      this._phaseTimer = 0;
    }
  },

  isActive() {
    return this.state === 'fading_in' || this.state === 'sustaining' || this.state === 'fading_out';
  },

  setPreset(name) {
    const presets = {
      microdose: {
        hueShift: 0.4, saturation: 0.4, uvRipple: 0,
        chromaticAberration: 0, lensDistortion: 0,
        posterize: 0, vignettePulse: 0.3, brightnessPulse: 0.2,
      },
      standard: {
        hueShift: 0.5, saturation: 0.4, uvRipple: 0.5,
        chromaticAberration: 0.4, lensDistortion: 0.4,
        posterize: 0, vignettePulse: 0.3, brightnessPulse: 0.3,
      },
      full: {
        hueShift: 0.6, saturation: 0.6, uvRipple: 0.6,
        chromaticAberration: 0.6, lensDistortion: 0.6,
        posterize: 0.4, vignettePulse: 0.6, brightnessPulse: 0.6,
      },
    };
    const p = presets[name] || presets.standard;
    Object.assign(this.config, p);
    if (!this.dynamic) this._pushConfigToUniforms();
  },

  _pushConfigToUniforms() {
    if (!this.pass) return;
    const u = this.pass.uniforms;
    for (const k of EFFECT_KEYS) {
      if (u[k] !== undefined) {
        u[k].value = this.config[k];
        this.live[k] = this.config[k];
      }
    }
  },

  _smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  },

  _easeInOutCubic(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },

  _clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  },

  // p ∈ [0, 1] — progress across the full trip (fadeIn + duration + fadeOut)
  _writeDynamicCurves(p) {
    const live = this.live;

    // 1. Hue shift — slow oscillation, ~2 full cycles over the trip (0→1→0→1→0)
    live.hueShift = 0.5 - 0.5 * Math.cos(p * Math.PI * 2 * 2);

    // 2. Saturation — faster oscillation, ~5 cycles
    live.saturation = 0.5 - 0.5 * Math.cos(p * Math.PI * 2 * 5);

    // 3. UV ripple — easeInOutCubic up over first 1/3, ease out to 0 over last 2/3
    if (p < 1 / 3) {
      live.uvRipple = this._easeInOutCubic(p * 3);
    } else {
      live.uvRipple = this._easeInOutCubic((1 - p) * 1.5);
    }

    // 4. Chromatic aberration — ease to 0.25 over first 1/4, oscillate 0.25..1 in
    //    middle 1/2, ease back to 0 over last 1/4.
    if (p < 0.25) {
      live.chromaticAberration = this._easeInOutCubic(p * 4) * 0.25;
    } else if (p > 0.75) {
      live.chromaticAberration = this._easeInOutCubic((1 - p) * 4) * 0.25;
    } else {
      const localP = (p - 0.25) / 0.5;  // 0..1 across middle half
      live.chromaticAberration = 0.25 + 0.75 * (0.5 - 0.5 * Math.cos(localP * Math.PI * 2 * 4));
    }

    // 5/6/7. Lens / Vignette / Brightness — smooth pseudo-random via sum of sins.
    //    Each effect uses unique frequencies + phase offsets.
    live.lensDistortion = this._clamp01(
      0.5
      + 0.3 * Math.sin(p * Math.PI * 2 * 1.2 + 0.3)
      + 0.2 * Math.sin(p * Math.PI * 2 * 2.9 + 0.39)
    );
    live.vignettePulse = this._clamp01(
      0.5
      + 0.3 * Math.sin(p * Math.PI * 2 * 1.5 + 1.1)
      + 0.2 * Math.sin(p * Math.PI * 2 * 3.2 + 1.43)
    );
    live.brightnessPulse = this._clamp01(
      0.5
      + 0.3 * Math.sin(p * Math.PI * 2 * 1.7 + 2.4)
      + 0.2 * Math.sin(p * Math.PI * 2 * 2.5 + 3.12)
    );

    // 8. Posterize — meander 0..0.25 most of the trip, sharp spike to ~0.95
    //    around p=1/3 ("around the peak").
    const meander = 0.1 + 0.15 * (0.5 + 0.5 * Math.sin(p * Math.PI * 2 * 3));
    const spike = 0.85 * Math.exp(-Math.pow((p - 1 / 3) / 0.03, 2));
    live.posterize = Math.min(1, meander + spike);

    // Push to uniforms
    const u = this.pass.uniforms;
    for (const k of EFFECT_KEYS) {
      if (u[k] !== undefined) u[k].value = live[k];
    }
  },

  update(dt, zerblePos, zerbleSpeed, wookPositions) {
    if (!this.pass) return;

    // Always advance time so shader wobble has a continuous phase
    this._timeAccum += dt;
    this.pass.uniforms.time.value = this._timeAccum;

    // Track trip elapsed time across the three active phases
    if (this.isActive()) this._tripElapsed += dt;

    // Find nearest wook distance
    let nearestDist = Infinity;
    if (wookPositions && wookPositions.length) {
      for (const wp of wookPositions) {
        const dx = wp.x - zerblePos.x;
        const dz = wp.z - zerblePos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < nearestDist) nearestDist = d;
      }
    }
    this._nearestWookDist = nearestDist;

    // --- State machine ---
    switch (this.state) {
      case 'idle': {
        if (zerbleSpeed < this.restSpeed && nearestDist < this.proximityThreshold) {
          this._proximityTimer += dt;
          if (this._proximityTimer >= this.restDuration) {
            // Wook-dose: always uses Dynamic mode.
            this.dynamic = true;
            this._enterFadingIn();
            Analytics.tripStart('wook');
          }
        } else {
          this._proximityTimer = 0;
        }
        this._envelope = 0;
        break;
      }

      case 'fading_in': {
        this._phaseTimer += dt;
        this._envelope = this._smoothstep(0, this.fadeIn, this._phaseTimer);
        if (this._envelope >= 1.0) {
          this._envelope = 1.0;
          this.state = 'sustaining';
          this._phaseTimer = 0;
        }
        break;
      }

      case 'sustaining': {
        this._envelope = 1.0;
        this._phaseTimer += dt;
        if (this._phaseTimer >= this.duration) {
          this._fadeOutFrom = 1.0;
          this.state = 'fading_out';
          this._phaseTimer = 0;
        }
        break;
      }

      case 'fading_out': {
        this._phaseTimer += dt;
        // Ramp from _fadeOutFrom to 0 over fadeOut seconds (supports Come Down
        // mid-fade-in by capturing the current envelope as the starting point).
        const t = this._smoothstep(0, this.fadeOut, this._phaseTimer);
        this._envelope = this._fadeOutFrom * (1 - t);
        if (this._phaseTimer >= this.fadeOut) {
          this._envelope = 0;
          this.state = 'cooldown';
          this._phaseTimer = 0;
        }
        break;
      }

      case 'cooldown': {
        this._envelope = 0;
        this._phaseTimer += dt;
        if (this._phaseTimer >= this.cooldown) {
          this.state = 'idle';
          this._phaseTimer = 0;
          this._proximityTimer = 0;
          this._tripElapsed = 0;
          // Reset to static so next manual trigger uses sliders by default.
          this.dynamic = false;
        }
        break;
      }
    }

    // Write master envelope to uniforms
    this.pass.uniforms.intensity.value = this._envelope;

    // Effect uniforms: Dynamic mode runs scripted curves while a trip is
    // active; Static mode just pushes the slider config values.
    if (this.dynamic && this.isActive()) {
      const totalDuration = this.fadeIn + this.duration + this.fadeOut;
      const p = Math.max(0, Math.min(1, this._tripElapsed / totalDuration));
      this._writeDynamicCurves(p);
    } else {
      this._pushConfigToUniforms();
    }
  },
};
