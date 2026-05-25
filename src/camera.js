// Chase camera with arrow-key orbit/tilt.
//
// Default behavior: sits behind Zerble at a fixed offset, smoothly following.
// Arrow keys add user-driven yaw/pitch offsets that PERSIST when released —
// they don't auto-snap-back. Press the opposite arrow to undo, or hold the
// HOME chord (configurable below) to recenter.

import * as THREE from 'three';

const DEFAULT_DISTANCE = 12;
const DEFAULT_HEIGHT = 6.5;
const LOOK_HEIGHT = 1.8;
const LOOK_AHEAD = 4;

const YAW_RATE = 1.8;      // rad/s when an arrow is held
const PITCH_RATE = 1.0;
const MAX_PITCH = 0.7;     // ~40°
const MIN_PITCH = -0.25;   // ~-14° — camera shouldn't go below the cart
const POSITION_LERP = 6;
const LOOK_LERP = 9;

// First-person view: camera mounted between Zerble's eyes (cart-local z=-2.5,
// y=2.15), looking forward. Pitch lets you look up/down; yaw lets you look
// around without changing where the cart is facing. Pitch range is wider than
// chase mode since clipping isn't an issue here.
const FPV_LOCAL = { x: 0, y: 2.15, z: -2.5 };
const FPV_MIN_PITCH = -0.5;
const FPV_MAX_PITCH = 0.9;

export class ChaseCamera {
  constructor(camera, zerble) {
    this.camera = camera;
    this.zerble = zerble;

    this.yawOffset = 0;
    this.pitchOffset = 0.05;
    this.mode = 'third';

    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._currentLook = new THREE.Vector3();

    this.snap();
  }

  toggleMode() {
    this.mode = this.mode === 'third' ? 'first' : 'third';
    // Reset yaw offset when entering first-person so you start looking forward;
    // keep pitch so the user's tilt preference carries over.
    if (this.mode === 'first') this.yawOffset = 0;
    this.snap();
  }

  snap() {
    this._computeTargets();
    this.camera.position.copy(this._desiredPos);
    this._currentLook.copy(this._desiredLook);
    this.camera.lookAt(this._currentLook);
  }

  update(dt, input) {
    // Keyboard arrow keys: rate-based yaw/pitch.
    this.yawOffset += input.camYaw * YAW_RATE * dt;
    let nextPitch = this.pitchOffset + input.camPitch * PITCH_RATE * dt;

    // Touch drag: one-shot deltas in radians accumulated since last frame.
    if (typeof input.consumeCamDeltas === 'function') {
      const d = input.consumeCamDeltas();
      this.yawOffset += d.yaw;
      nextPitch += d.pitch;
    }

    const [minP, maxP] = this.mode === 'first'
      ? [FPV_MIN_PITCH, FPV_MAX_PITCH]
      : [MIN_PITCH, MAX_PITCH];
    this.pitchOffset = THREE.MathUtils.clamp(nextPitch, minP, maxP);

    this._computeTargets();

    if (this.mode === 'first') {
      // No lerp in FPV — the camera is rigidly mounted on Zerble's head.
      // Lerping would lag behind sharp steering, breaking the head-cam feel.
      this.camera.position.copy(this._desiredPos);
      this._currentLook.copy(this._desiredLook);
    } else {
      this.camera.position.lerp(this._desiredPos, Math.min(1, dt * POSITION_LERP));
      // Smooth the look target so quick steering doesn't whip the camera
      this._currentLook.lerp(this._desiredLook, Math.min(1, dt * LOOK_LERP));
    }
    this.camera.lookAt(this._currentLook);
  }

  _computeTargets() {
    if (this.mode === 'first') {
      this._computeFirstPerson();
      return;
    }
    // ---- Third-person chase (default) ----
    // Effective camera yaw around Zerble (heading + user offset). Pitch tilts up/down.
    const yaw = this.zerble.heading + this.yawOffset;
    const pitch = this.pitchOffset;
    const dist = DEFAULT_DISTANCE * Math.cos(pitch);
    const height = DEFAULT_HEIGHT + Math.sin(pitch) * DEFAULT_DISTANCE;

    // Behind Zerble. forward = (-sin(yaw), 0, -cos(yaw)), back = (sin, 0, cos).
    this._desiredPos.set(
      this.zerble.position.x + Math.sin(yaw) * dist,
      this.zerble.position.y + height,
      this.zerble.position.z + Math.cos(yaw) * dist
    );

    // Look slightly ahead of Zerble in his actual heading (not the user's yaw), so
    // when the user orbits the camera the cart still feels centered.
    const aimYaw = this.zerble.heading;
    this._desiredLook.set(
      this.zerble.position.x - Math.sin(aimYaw) * LOOK_AHEAD,
      this.zerble.position.y + LOOK_HEIGHT,
      this.zerble.position.z - Math.cos(aimYaw) * LOOK_AHEAD
    );
  }

  _computeFirstPerson() {
    // Mount the camera at FPV_LOCAL in Zerble's frame, rotated by his heading.
    const h = this.zerble.heading;
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    const lx = FPV_LOCAL.x;
    const lz = FPV_LOCAL.z;
    this._desiredPos.set(
      this.zerble.position.x + lx * cos + lz * sin,
      this.zerble.position.y + FPV_LOCAL.y,
      this.zerble.position.z - lx * sin + lz * cos
    );

    // Look forward along (heading + yawOffset), tilted by pitchOffset.
    // Zerble's forward is (-sin(h), 0, -cos(h)) when yawOffset = 0.
    const lookYaw = h + this.yawOffset;
    const pitch = this.pitchOffset;
    const ahead = 8;
    const cosPitch = Math.cos(pitch);
    this._desiredLook.set(
      this._desiredPos.x - Math.sin(lookYaw) * ahead * cosPitch,
      this._desiredPos.y + Math.sin(pitch) * ahead,
      this._desiredPos.z - Math.cos(lookYaw) * ahead * cosPitch
    );
  }
}
