// trip.js — Psychedelic post-process effect for Zerble at LEAF.
//
// When a wook hangs near a stopped Zerble for 5 continuous seconds, the driver
// gets dosed. A ShaderPass ramps in over fadeIn seconds, sustains for duration,
// then fades out over fadeOut seconds, then enters a brief cooldown.
//
// Usage (main.js):
//   import { Trip } from './trip.js';
//   Trip.init();
//   composer.addPass(Trip.pass);   // insert before OutputPass
//
//   // in tickBody(dt):
//   Trip.update(dt, zerble.position, Math.abs(zerble.speed), wookPositions);

import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
  uniform float kaleidoscope;
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

    // ---- 3. Kaleidoscope ----
    float kStr = kaleidoscope * intensity;
    if (kStr > 0.0) {
      vec2 kUv = uv - 0.5;
      float slices = mix(1.0, 8.0, kStr);
      float angle = atan(kUv.y, kUv.x);
      float radius = length(kUv);
      float slice = 3.14159265 / slices;
      angle = mod(angle, 2.0 * slice);
      if (angle > slice) angle = 2.0 * slice - angle;
      uv = vec2(cos(angle), sin(angle)) * radius + 0.5;
    }

    // ---- 4. Chromatic aberration ----
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

    // ---- 5. Hue shift ----
    float hsStr = hueShift * intensity;
    if (hsStr > 0.0) {
      vec3 hsv = rgb2hsv(col);
      hsv.x = fract(hsv.x + hsStr * 0.5 + 0.15 * sin(time * 0.3));
      col = hsv2rgb(hsv);
    }

    // ---- 6. Saturation boost ----
    float satStr = saturation * intensity;
    if (satStr > 0.0) {
      vec3 hsv = rgb2hsv(col);
      hsv.y = clamp(hsv.y * (1.0 + satStr), 0.0, 1.0);
      col = hsv2rgb(hsv);
    }

    // ---- 7. Posterize ----
    float postStr = posterize * intensity;
    if (postStr > 0.001) {
      float levels = mix(256.0, 5.0, postStr);
      col = floor(col * levels) / levels;
    }

    // ---- 8. Brightness pulse ----
    float bpStr = brightnessPulse * intensity;
    if (bpStr > 0.0) {
      col *= 1.0 + bpStr * 0.3 * sin(time * 1.2);
    }

    // ---- 9. Vignette pulse ----
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

export const Trip = {
  pass: null,

  config: {
    hueShift:             0.5,
    saturation:           0.4,
    uvRipple:             0.5,
    chromaticAberration:  0.4,
    lensDistortion:       0.4,
    kaleidoscope:         0.0,
    posterize:            0.0,
    vignettePulse:        0.3,
    brightnessPulse:      0.3,
  },

  // Timing / proximity settings
  duration:            30,
  fadeIn:              1.5,
  fadeOut:             3.0,
  cooldown:            5,
  proximityThreshold:  2.5,
  restSpeed:           0.5,
  restDuration:        5,

  // Internal state
  state:            'idle',  // 'idle' | 'fading_in' | 'sustaining' | 'fading_out' | 'cooldown'
  _phaseTimer:      0,
  _proximityTimer:  0,
  _envelope:        0,
  _timeAccum:       0,

  init() {
    const shader = {
      uniforms: {
        tDiffuse:            { value: null },
        time:                { value: 0.0 },
        intensity:           { value: 0.0 },
        hueShift:            { value: 0.0 },
        saturation:          { value: 0.0 },
        uvRipple:            { value: 0.0 },
        chromaticAberration: { value: 0.0 },
        lensDistortion:      { value: 0.0 },
        kaleidoscope:        { value: 0.0 },
        posterize:           { value: 0.0 },
        vignettePulse:       { value: 0.0 },
        brightnessPulse:     { value: 0.0 },
      },
      vertexShader,
      fragmentShader,
    };

    this.pass = new ShaderPass(shader);
    this.pass.renderToScreen = false;

    // Apply default preset
    this.setPreset('standard');
  },

  trigger() {
    this._phaseTimer = 0;
    this._proximityTimer = 0;
    this.state = 'fading_in';
  },

  setPreset(name) {
    const presets = {
      microdose: {
        hueShift: 0.4, saturation: 0.4, uvRipple: 0,
        chromaticAberration: 0, lensDistortion: 0,
        kaleidoscope: 0, posterize: 0,
        vignettePulse: 0.3, brightnessPulse: 0.2,
      },
      standard: {
        hueShift: 0.5, saturation: 0.4, uvRipple: 0.5,
        chromaticAberration: 0.4, lensDistortion: 0.4,
        kaleidoscope: 0, posterize: 0,
        vignettePulse: 0.3, brightnessPulse: 0.3,
      },
      full: {
        hueShift: 0.6, saturation: 0.6, uvRipple: 0.6,
        chromaticAberration: 0.6, lensDistortion: 0.6,
        kaleidoscope: 0.5, posterize: 0.4,
        vignettePulse: 0.6, brightnessPulse: 0.6,
      },
    };
    const p = presets[name] || presets.standard;
    Object.assign(this.config, p);
    this._pushConfigToUniforms();
  },

  _pushConfigToUniforms() {
    if (!this.pass) return;
    const u = this.pass.uniforms;
    for (const key of Object.keys(this.config)) {
      if (u[key] !== undefined) u[key].value = this.config[key];
    }
  },

  _smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  },

  update(dt, zerblePos, zerbleSpeed, wookPositions) {
    if (!this.pass) return;

    // Always advance time so shader wobble has a continuous phase
    this._timeAccum += dt;
    this.pass.uniforms.time.value = this._timeAccum;

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

    // --- State machine ---
    switch (this.state) {
      case 'idle': {
        if (zerbleSpeed < this.restSpeed && nearestDist < this.proximityThreshold) {
          this._proximityTimer += dt;
          if (this._proximityTimer >= this.restDuration) {
            this.state = 'fading_in';
            this._phaseTimer = 0;
            this._proximityTimer = 0;
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
          this.state = 'fading_out';
          this._phaseTimer = 0;
        }
        break;
      }

      case 'fading_out': {
        this._phaseTimer += dt;
        this._envelope = 1 - this._smoothstep(0, this.fadeOut, this._phaseTimer);
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
        }
        break;
      }
    }

    // Write master envelope + per-effect values to uniforms
    this.pass.uniforms.intensity.value = this._envelope;
    this._pushConfigToUniforms();

    // Store nearest dist for the debug panel to read
    this._nearestWookDist = nearestDist;
  },
};
