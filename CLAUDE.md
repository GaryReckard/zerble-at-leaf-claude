# CLAUDE.md — Zerble at the Festival

Agent-facing notes for working in this repo. Read this first; then dip into the
docs/code in the order below as the task demands.

## What this project is

A no-build browser game. Drive a mustachioed cart through a procedural festival.
Plain ES modules + importmap, three.js from a CDN, Web Audio for everything you
hear. No bundler. No transpiler. No framework. ~25 hand-rolled source files in
`src/`.

Live deploy: GA4 is wired (G-CY1FNMY8H8) and analytics calls go through
`src/analytics.js`. Treat the production deploy as observed by real players.

## Required reading (in order)

1. **[README.md](README.md)** — premise, controls, the player-facing pitch.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — the canonical walkthrough. Render
   pipeline, world chunks/forests/lakes, registry, collision model, crowd AI,
   audio synthesis, perf tiers. If a question is "how does X work," it's
   probably already in here.
3. **[ROADMAP.md](ROADMAP.md)** — what's queued. Check before proposing new
   work to see if Gary has already considered (and parked) it.
4. **[CHANGELOG.md](CHANGELOG.md)** — what shipped, dated. The "why" of recent
   commits lives here, more than in `git log`.
5. **[.claude/scratch-notes.md](.claude/scratch-notes.md)** — Gary's original
   reading notes. Useful as a quick index of "what's in each file."

## Operating principle: build the harness, then the feature

You (the agent) must be able to **iterate, render, and verify in seconds, not
minutes.** Booting the game and chasing the camera around to find a puppet you
just edited is a failure mode. Every model and every system in this repo
should have a fluid, low-friction way to look at it in isolation. If it
doesn't, **building that surface comes before the feature work** — extending
the harness is part of the task, not a separate ticket.

The full doctrine, with the specific maintenance steps when you add a new
model, lives in **[.claude/rules/sandbox-and-testing.md](.claude/rules/sandbox-and-testing.md)** — read it before
adding anything to `src/models/`.

## Run + verify

```
python3 .claude/serve_nocache.py 8765
```

Two entry points:

| URL | When to use it |
|---|---|
| `http://127.0.0.1:8765/sandbox.html?entity=<name>` | **Default for any model/visual change.** Isolated viewer, deep-linkable, time-of-day slider, "Hit it" SFX button, free-orbit camera. Don't try to verify a model edit in the main game — verify it here. |
| `http://127.0.0.1:8765/` | The full game. Use when the change is emergent (world streaming, collision, chunk generation, crowd AI behavior) and not visible at the entity level. **Also load the main game any time the edit touches a code path the sandbox doesn't exercise** (e.g. `chunks.js`, `crowd.js`, `world.js`, `main.js`) — sandbox-only verification can pass while the game itself crashes at boot. |

The dev server sends `no-store` so module edits land on reload — `python3 -m
http.server` won't, because Chrome heuristic-caches module bodies.

**Verification with Claude Preview MCP** — `preview_start`,
`preview_console_logs`, `preview_screenshot`. Background tabs run the main
loop on `setTimeout(16ms)` rather than RAF specifically so the preview MCP
(which keeps `document.hidden`) keeps ticking. Never tell Gary to "go check
it" — verify and share proof. For visual work, take a screenshot at two ToD
presets (Noon + Midnight) since emissive/lighting interactions only show up
across the cycle.

Force a perf tier with `?perf=low|mid|high`. Bugs that only show on low (e.g.
the Safari module-namespace-freeze that took down `litFallback.js`) are easy
to miss otherwise — test the lower tiers when touching materials, shaders, or
boot order.

### Smoke-test before declaring done

A task isn't "done" because the sandbox renders the entity. The sandbox is
*one* code path — `chunks.js`, world generation, and game-only systems (NPC
crowd, audio bus wiring, registry chunkKey lifecycle, etc.) only run when
the main app boots. **Before marking any task complete, load
`http://127.0.0.1:8765/` and confirm:**

1. The title card appears (no JS error at module load).
2. Clicking "Let's go ZERBLIN'!" boots the world (no JS error during world
   generation — `buildWorld → ChunkManager.update → _generate → theme
   builder` is the longest call chain in the codebase and is where the
   real bugs hide).
3. Check `preview_console_logs` after a couple seconds of running — any
   uncaught `TypeError` / `ReferenceError` / shader-compile failure shows
   up here even when the canvas is rendering something.

Sandbox-pass + game-fail has happened multiple times when an edit touched
chunks/crowd/world but the sandbox case for that entity used a different
constructor path (e.g. `buildCampChair` returns `{ group, color,
footprint }` — the model sandbox cases extract `.group`, the chunks code
forgot to). Always verify the full pipeline.

## The non-obvious things that will bite you

These are tripwires that are not derivable from reading any single file.

### 1. No bundler. Don't add one.

Tempting, but it breaks the "open `index.html` and it just works" property and
adds a moving piece this project explicitly avoids. See ROADMAP "Out of scope."
If you create a new source module, **add it to the importmap list in
*both* `index.html` and `sandbox.html`** (each has its own `mods` or `models`
array near the top). Without those, the dev cache-buster won't apply `?v=…`
and edits won't reload on local dev. Updating one and forgetting the other is
the most common variant of this footgun.

### 2. ES module namespaces are frozen — patch via the shim, not after import.

`src/threeShim.js` is the `'three'` importmap entry. It re-exports real three.js
with a tier-aware `MeshStandardMaterial` override. **Do not** try to monkey-patch
`THREE.X = Y` after importing `* as THREE` — Safari mobile (and any spec-strict
runtime) throws "Cannot assign to property of [object Module]" and the boot
sequence dies. The shim is the proper override path. See the file header in
`threeShim.js` for the full story; this is the kind of footgun you'll only learn
the hard way otherwise.

### 3. iOS audio must initialize inside a user gesture, synchronously.

`Sound.init()` runs on the title-card start-button tap. **Do not** insert
`await`, `setTimeout`, or any async hop between the tap and `Sound.init()` —
iOS Safari requires the AudioContext to be created+resumed synchronously
inside the gesture, or it sticks in `suspended` forever and the game ships
silent on mobile. There's a multi-stage unlock (sync resume → 1-sample
buffer-source → 100ms silent WAV via `<audio>` element) — keep all three.

### 4. Determinism is load-bearing.

`rng.js`'s `hash2(cx, cz)` + `mulberry32` seeds drive every chunk's theme, prop
placement, lake position, forest contents. Changing salt values or hash inputs
**regenerates existing chunks differently** — fine for greenfield, painful for
anyone playing across the change. If you need to add randomness inside an
existing system, salt it with a fresh constant rather than reordering or
adjusting an existing `rng()` call.

### 5. Three lifecycle systems own world content. They are not transactional.

- **Chunks** (80m grid) lazy-load, never unload once created. Entries register
  with `chunkKey`. On chunk unload, the registry drops everything tagged with
  that key.
- **Forests** (3x3 chunk blocks) pin to the chunk grid.
- **Lakes** (320m macrocell) load/unload by player distance. **Lakes
  deliberately omit `chunkKey`** so their colliders survive when a host chunk
  unloads. If you accidentally tag a lake entry with a chunkKey, it will
  vanish mid-game when its host chunk happens to drop out.

### 6. Shared resources are tagged. Don't dispose them.

Module-level pooled materials and geometries (`SHACK_MATS`, `STRING_BULB_GEO`,
`SUPPLY_CAN_GEO`, the campsite `matFor` cache, NPC `buildSimpleNPC` pool, torch
+ chair pools, food-truck pool) carry `userData.shared = true`. Chunk/lake
disposal walks **skip** entries with that flag. If you build a new pooled
resource, tag it `userData.shared = true` or the next chunk unload will free
geometry/materials that other chunks still reference and shader recompiles will
storm.

### 7. InstancedMesh writes need `instanceMatrix.needsUpdate = true`.

Easy to forget when refactoring crowd or bubbles. If a new InstancedMesh user
"looks frozen," that's the cause.

### 8. `nightness` is global state, polled every frame.

Sky shader, sun/hemi lights, fog, stage light show, drum-circle voices, fire
crackle, eye glow, star opacity, lampposts, tiki torches — they all read
`getTimeOfDay().nightness` independently. Don't try to centralize it; the
poll-everywhere pattern is intentional and cheap.

### 9. Per-tier shadow + material rules.

Low tier: shadows off, Lambert swap on. Mid/high tier: shadows on, Standard
materials. The `castShadow = true` count is audited — there's a perf budget.
**Don't reflexively add `castShadow = true`** to new meshes; only large/visible
objects need it. See `.claude/perf-audit-plan.md` for the cut list, and
[.claude/rules/performance.md](.claude/rules/performance.md) for the full
audit-priority order, allocation-vs-steady-state model, and footgun list
that drove the three shipped perf passes.

### 10. Per-tier perf budgets surfaced in the HUD.

Backtick (`` ` ``) opens the debug overlay. It shows live draws, triangles,
geometry/texture/heap counts against per-tier budgets (low 80 draws / 150k
tris, mid 200/400k, high 400/1.2M). After a change that adds geometry or
draws, glance at the panel before declaring done.

## Conventions

### Style

- **No comments unless the *why* is non-obvious.** The codebase has many
  comments that explain a constraint, a workaround, or a spec quirk
  (threeShim.js header, iOS audio init, the `chunkKey` lake-omission, the
  hidden-tab `setTimeout` swap). Match that bar. Don't narrate what the code
  does.
- **Models live in `src/models/`** and return a `THREE.Group` anchored at
  `(0, 0, 0)`. Callers position/rotate. Animated parts attach an updater
  closure or expose an `anim` object; a central per-frame updater in `main.js`
  walks the animatables lists. `zerble.js` and `lurleen.js` stay in `src/`
  (not `models/`) because they carry physics + state.
- **A new model is not done until it has a sandbox entry.** Add it to
  `sandbox.html`'s `models` importmap array, the entity `<select>`, the
  `loadEntity()` switch, and (if relevant) `ENTITY_HIT_KIND` /
  `ENTITY_MUSIC_STYLE`. This is what makes future iteration cheap. See
  [.claude/rules/sandbox-and-testing.md](.claude/rules/sandbox-and-testing.md)
  for the full checklist and the "extend the harness before bypassing it"
  doctrine.
- **Registry entries**: `kind`, `position`, `footprint`, optional `collider`,
  optional `attractor`, optional `chunkKey`. See `registry.js` header comment.
- **InstancedMesh + pooling** before per-instance allocation. Variant-bucket
  if instances diverge.

### Tone for player-facing copy

Indie-game-on-GitHub vibe. **Do not reveal** the Wook trip system, the `t`
debug menu, the `?perf=` URL flag, or any other Easter eggs in the README or
title card. Internally, they're documented. Externally, players discover them.

The title card and README are calibrated; if you touch them, keep "Bring the
bubbles, collect the smiles" and the warm-festival-evening tone.

## Skills available in this repo

`.claude/skills/threejs-*` — ten three.js skill packs (fundamentals, geometry,
materials, textures, lighting, animation, interaction, loaders,
postprocessing, shaders). When the task is graphics/perf work, load the
relevant skill before guessing. The two perf-pass plan docs
(`.claude/perf-audit-plan.md`, `.claude/perf-pass-2-plan.md`) demonstrate the
expected workflow: skill → audit → priority-ordered plan → ship + log results.

## Project-specific rules

See `.claude/rules/`:

- [sandbox-and-testing.md](.claude/rules/sandbox-and-testing.md) — **read
  before adding to `src/models/`.** The sandbox-first verification doctrine,
  the new-model checklist (importmap + dropdown + loadEntity switch + hit kind
  + music style), and the "extend the harness before bypassing it" principle.
- [performance.md](.claude/rules/performance.md) — **read before touching
  graphics code or proposing a perf change.** The audit-priority order
  (shadows → disposal → post-process → instancing → pooling → AA → textures),
  allocation-vs-steady-state mental model, the heuristics distilled from the
  [r/threejs `skk0f3` thread](https://www.reddit.com/r/threejs/comments/skk0f3/how_to_optimize_project_for_lowend_computers/)
  that drove perf passes 1–3, and the explicit footgun list (no
  `THREE.X = Y` after import, no disposal without `userData.shared` check,
  no reflexive `castShadow = true`).
- [changelog-and-roadmap.md](.claude/rules/changelog-and-roadmap.md) —
  **read before committing.** Every user-visible change updates CHANGELOG
  first; if it was on ROADMAP, remove the bullet in the same commit. Voice,
  date handling, when to skip, and the commit-time checklist.
- [no-build.md](.claude/rules/no-build.md) — the no-bundler stance and the
  importmap maintenance rule (both `index.html` *and* `sandbox.html`).
- [perf-pooling.md](.claude/rules/perf-pooling.md) — the `userData.shared`
  convention and the dispose-safe pattern for new pooled resources.
