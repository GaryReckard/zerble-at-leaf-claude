// World registry: every "thing in the world" with a footprint, collider, or attractor.
// Crowd AI queries this for avoidance and points-of-interest. The collision system
// queries it for hard colliders.

import * as THREE from 'three';

let nextId = 1;

export class Registry {
  constructor() {
    this.entries = new Map(); // id -> entry
    this.byKind = new Map(); // kind -> Set<id>
  }

  // Add an entry. Returns its id.
  // entry = {
  //   kind: 'stage' | 'tent' | 'truck' | 'tree' | 'lamppost' | 'arch' | 'puppet' | ...
  //   position: Vector3,
  //   footprint: number,        // radius NPCs should stay outside of
  //   collider?: { radius, damage } // optional hard collider for Zerble
  //   attractor?: { radius, weight } // optional "crowds congregate here" zone
  //   chunkKey?: string         // optional, used to unload with chunks
  // }
  add(entry) {
    const id = nextId++;
    entry.id = id;
    if (!entry.position) entry.position = new THREE.Vector3();
    this.entries.set(id, entry);
    if (!this.byKind.has(entry.kind)) this.byKind.set(entry.kind, new Set());
    this.byKind.get(entry.kind).add(id);
    return id;
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.byKind.get(entry.kind)?.delete(id);
  }

  byChunk(chunkKey) {
    const out = [];
    for (const e of this.entries.values()) {
      if (e.chunkKey === chunkKey) out.push(e);
    }
    return out;
  }

  removeChunk(chunkKey) {
    for (const e of [...this.entries.values()]) {
      if (e.chunkKey === chunkKey) this.remove(e.id);
    }
  }

  // ---- Queries ----

  // All hard colliders Zerble can run into.
  *colliders() {
    for (const e of this.entries.values()) {
      if (e.collider) yield { position: e.position, radius: e.collider.radius, damage: e.collider.damage, kind: e.kind };
    }
  }

  // Avoidance footprints for NPCs (things they should walk around).
  *footprints() {
    for (const e of this.entries.values()) {
      if (e.footprint > 0) yield { position: e.position, radius: e.footprint, kind: e.kind };
    }
  }

  // Attractors — POIs where crowds tend to congregate.
  *attractors() {
    for (const e of this.entries.values()) {
      if (e.attractor) yield { position: e.position, radius: e.attractor.radius, weight: e.attractor.weight, kind: e.kind };
    }
  }

  // Nearest attractor to a position (for "what should I walk toward")
  pickAttractor(rng) {
    const ats = [...this.attractors()];
    if (ats.length === 0) return null;
    // Weighted random
    const totalW = ats.reduce((s, a) => s + a.weight, 0);
    let r = rng() * totalW;
    for (const a of ats) {
      r -= a.weight;
      if (r <= 0) return a;
    }
    return ats[ats.length - 1];
  }

  // Quick lookup: are there any building footprints within `radius` of pos?
  // Returns the closest one, or null. Excludes the 'tree' kind by default.
  closestBuilding(pos, radius, excludeKinds = new Set(['tree'])) {
    let best = null;
    let bestDist = Infinity;
    for (const e of this.entries.values()) {
      if (!e.footprint || excludeKinds.has(e.kind)) continue;
      const dx = e.position.x - pos.x;
      const dz = e.position.z - pos.z;
      const d = Math.hypot(dx, dz) - e.footprint;
      if (d < radius && d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }
}

// One shared registry for the whole game.
export const registry = new Registry();
