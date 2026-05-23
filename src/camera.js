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

export class ChaseCamera {
  constructor(camera, zerble) {
    this.camera = camera;
    this.zerble = zerble;

    this.yawOffset = 0;
    this.pitchOffset = 0.05;

    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._currentLook = new THREE.Vector3();

    this.snap();
  }

  snap() {
    this._computeTargets();
    this.camera.position.copy(this._desiredPos);
    this._currentLook.copy(this._desiredLook);
    this.camera.lookAt(this._currentLook);
  }

  update(dt, input) {
    this.yawOffset += input.camYaw * YAW_RATE * dt;
    this.pitchOffset = THREE.MathUtils.clamp(
      this.pitchOffset + input.camPitch * PITCH_RATE * dt,
      MIN_PITCH,
      MAX_PITCH
    );

    this._computeTargets();

    this.camera.position.lerp(this._desiredPos, Math.min(1, dt * POSITION_LERP));
    // Smooth the look target so quick steering doesn't whip the camera
    this._currentLook.lerp(this._desiredLook, Math.min(1, dt * LOOK_LERP));
    this.camera.lookAt(this._currentLook);
  }

  _computeTargets() {
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
}
