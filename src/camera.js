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

// Top-down view: camera floats above Zerble at a configurable height, tilted
// slightly off-vertical so the world has some depth (a true 90° straight-down
// view feels flat and disorienting at speed). UP/DOWN arrows zoom; LEFT/RIGHT
// rotate the view around the vertical axis. Mouse wheel also zooms.
const TOP_DEFAULT_HEIGHT = 80;
const TOP_MIN_HEIGHT = 30;
const TOP_MAX_HEIGHT = 220;
const TOP_TILT = 0.18;        // ~10° off vertical, gives depth
const TOP_ZOOM_RATE = 1.4;    // (height units per second while UP/DOWN held) → multiplier
const TOP_POSITION_LERP = 5;
const TOP_LOOK_LERP = 7;

export class ChaseCamera {
  constructor(camera, zerble) {
    this.camera = camera;
    this.zerble = zerble;

    this.yawOffset = 0;
    this.pitchOffset = 0.05;
    this.mode = 'third';
    // Top-down state: persistent across mode switches so the view comes back
    // exactly as the user left it last time they were in top-down.
    this.topHeight = TOP_DEFAULT_HEIGHT;

    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._currentLook = new THREE.Vector3();

    this._wireWheelZoom();
    this.snap();
  }

  // Cycle: third → first → top → third. The HUD toast in main.js shows
  // a friendly name; we expose `modeLabel` to keep the label logic in one place.
  toggleMode() {
    const next = { third: 'first', first: 'top', top: 'third' };
    this.mode = next[this.mode] || 'third';
    // Reset yaw offset when entering first-person so you start looking forward.
    // Top-down keeps its own yaw — entering it from chase should preserve any
    // orbit the user already dialed in.
    if (this.mode === 'first') this.yawOffset = 0;
    this.snap();
  }

  get modeLabel() {
    if (this.mode === 'first') return 'First-person view';
    if (this.mode === 'top') return 'Top-down view';
    return 'Chase view';
  }

  // Mouse-wheel zoom — only active in top-down mode (in chase / first-person
  // the camera doesn't have a meaningful zoom axis to map onto).
  _wireWheelZoom() {
    window.addEventListener('wheel', (e) => {
      if (this.mode !== 'top') return;
      // deltaY positive = scroll down = zoom out. Tune step so a single
      // notch is a noticeable but not jarring change.
      const step = e.deltaY > 0 ? 1.10 : 1 / 1.10;
      this.topHeight = THREE.MathUtils.clamp(
        this.topHeight * step,
        TOP_MIN_HEIGHT,
        TOP_MAX_HEIGHT,
      );
      // Prevent the page from scrolling when interacting with the canvas.
      e.preventDefault();
    }, { passive: false });
  }

  snap() {
    this._computeTargets();
    this.camera.position.copy(this._desiredPos);
    this._currentLook.copy(this._desiredLook);
    this.camera.lookAt(this._currentLook);
  }

  update(dt, input) {
    // Keyboard arrow keys: rate-based yaw/pitch. In top-down mode the up/down
    // arrows mean ZOOM rather than pitch, so we route them differently.
    this.yawOffset += input.camYaw * YAW_RATE * dt;

    if (this.mode === 'top') {
      // UP arrow = zoom in (lower altitude), DOWN = zoom out.
      // input.camPitch is +1 for UP, -1 for DOWN, so multiplier > 1 when DOWN.
      const zoomDelta = -input.camPitch;  // UP shrinks height, DOWN grows it
      const factor = Math.exp(zoomDelta * TOP_ZOOM_RATE * dt);
      this.topHeight = THREE.MathUtils.clamp(
        this.topHeight * factor,
        TOP_MIN_HEIGHT,
        TOP_MAX_HEIGHT,
      );
    } else {
      let nextPitch = this.pitchOffset + input.camPitch * PITCH_RATE * dt;

      // Touch drag: one-shot deltas in radians accumulated since last frame.
      // Only applied in chase/first — top-down has its own yaw and uses zoom for the y-axis.
      if (typeof input.consumeCamDeltas === 'function') {
        const d = input.consumeCamDeltas();
        this.yawOffset += d.yaw;
        nextPitch += d.pitch;
      }

      const [minP, maxP] = this.mode === 'first'
        ? [FPV_MIN_PITCH, FPV_MAX_PITCH]
        : [MIN_PITCH, MAX_PITCH];
      this.pitchOffset = THREE.MathUtils.clamp(nextPitch, minP, maxP);
    }

    // Top-down still consumes touch deltas for yaw — pitch deltas become zoom.
    if (this.mode === 'top' && typeof input.consumeCamDeltas === 'function') {
      const d = input.consumeCamDeltas();
      this.yawOffset += d.yaw;
      // Repurpose pitch drag as a soft zoom — a drag-down zooms out, drag-up zooms in.
      if (d.pitch !== 0) {
        const f = Math.exp(-d.pitch * 1.5);
        this.topHeight = THREE.MathUtils.clamp(this.topHeight * f, TOP_MIN_HEIGHT, TOP_MAX_HEIGHT);
      }
    }

    this._computeTargets();

    if (this.mode === 'first') {
      // No lerp in FPV — the camera is rigidly mounted on Zerble's head.
      // Lerping would lag behind sharp steering, breaking the head-cam feel.
      this.camera.position.copy(this._desiredPos);
      this._currentLook.copy(this._desiredLook);
    } else if (this.mode === 'top') {
      // Slightly looser lerp than chase so big altitude swings don't whip,
      // and slower look-lerp so the cart can travel without the camera
      // playing catch-up in a distracting way.
      this.camera.position.lerp(this._desiredPos, Math.min(1, dt * TOP_POSITION_LERP));
      this._currentLook.lerp(this._desiredLook, Math.min(1, dt * TOP_LOOK_LERP));
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
    if (this.mode === 'top') {
      this._computeTopDown();
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

  _computeTopDown() {
    // Camera sits above Zerble at this.topHeight. Tilt slightly off vertical
    // so the world has depth — at 90° straight down everything looks like a
    // map screen and you can't tell what's in front of you. The tilt direction
    // follows yawOffset so the user can orbit around Zerble.
    const z = this.zerble.position;
    const yaw = this.zerble.heading + this.yawOffset;
    // Tilt offsets the camera horizontally in the OPPOSITE direction of where
    // it's looking — so it sits a bit behind/north/whatever and tilts forward
    // toward Zerble.
    const tiltOffsetHoriz = this.topHeight * Math.sin(TOP_TILT);
    this._desiredPos.set(
      z.x - Math.sin(yaw) * tiltOffsetHoriz,
      z.y + this.topHeight * Math.cos(TOP_TILT),
      z.z - Math.cos(yaw) * tiltOffsetHoriz,
    );
    // Look directly at Zerble.
    this._desiredLook.set(z.x, z.y + 0.5, z.z);
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
