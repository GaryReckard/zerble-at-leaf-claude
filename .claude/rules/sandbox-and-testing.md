# Sandbox-first verification — build the harness, then the feature

> **Operating principle:** before you touch a model or system, make sure there's
> a fluid, low-friction way to verify it without booting the full game and
> hunting it down with the camera. If there isn't, **build that first.** This
> is the agent contract for this project — you are expected to be able to
> iterate, render, and verify your work in seconds, not minutes.

The cost of "I'll just drive to where the puppet parade spawns and try to bump
into it" compounds every iteration. Multiply that by an AI agent making 5–10
tweaks per change and the project grinds to a halt. The sandbox solves this.
Keep it solving it.

## The sandbox is the primary verification surface

`sandbox.html` is a deep-linkable, isolated entity viewer. Open
`http://127.0.0.1:8765/sandbox.html?entity=<name>` and you get just that
entity, on a plain ground plane, with a free-orbit camera and a
time-of-day slider. No driving. No procedural festival. No camera wrestling.

Already wired up:

- **Dropdown of every entity** in `src/models/` + the carts, lakes, particle
  systems, drum-circle figures, campsite props. Carts and NPCs get a mock
  `update()` driver so they animate.
- **Deep-linkable URL** — `?entity=<key>` selects on load and the dropdown
  `replaceState`s the URL when you switch. **Use this in agent workflows** so
  you can re-open the exact same view across iterations and after restarts.
- **Time-of-day slider + Morning/Noon/Dusk/Midnight presets.** Verify
  emissive ramps, nightness-gated lights, and dusk fog colors without
  waiting for the in-game cycle to come round.
- **Audio panel** with master/music/SFX sliders and a per-entity "Hit it"
  button that fires the collision SFX for that kind. Stages and drum-circles
  auto-attach their music when selected.
- **Camera presets** — 1–6 snap to canonical angles, R resets, L toggles the
  ground plane.
- **`window.__sandbox`** exposes `{ scene, camera, currentEntity }` for
  `preview_eval` introspection.

## Required when you add a new model

If you add a file to `src/models/`, the change is **not done** until you also:

1. **Add it to `sandbox.html`'s importmap `models` array** (the list near the
   top of the file). Without this, the dev cache-buster won't decorate the
   URL with `?v=` and your edits won't reload locally.
2. **Add an `<option>` to the entity `<select>`** in the right `<optgroup>`
   (Festival props / People / Camping / Forest / Particles / Drum circle).
3. **Add a `case '<key>':` to the `loadEntity()` switch** that calls your
   `buildX()` function, adds the group to the scene, and (if animated) sets
   `updateFn` so the per-frame ticker runs.
4. **If it has a collision kind**, add it to `ENTITY_HIT_KIND` so the "Hit
   it" button surfaces.
5. **If it plays music** (stage, drum circle), add it to
   `ENTITY_MUSIC_STYLE`.
6. **Also add it to `index.html`'s importmap `models` array** — same
   cache-buster reason, separately maintained list. Forgetting this is a
   common footgun.

Then verify by opening `?entity=<your-key>` and confirming the model loads,
animates, and looks right at all four ToD presets.

## The agent verification loop

For a model/visual change, this is the canonical iteration:

```
1. Edit src/models/foo.js
2. preview_start (or reload if already running)
3. preview_screenshot on /sandbox.html?entity=foo
4. Look at the screenshot. Did it land?
   - Yes → next change.
   - No → repeat step 1.
```

Compare to the *bad* loop you must avoid:

```
1. Edit src/models/foo.js
2. Reload the game
3. Drive Zerble across multiple chunks looking for a foo
4. Wrestle the chase camera to see foo from the right angle
5. Realize you can't really see what changed because there are 14 other
   things in frame
6. Frustration; declare done without verifying
```

Build the sandbox view first. Iterate fast. Trust your eyes via screenshots.

## When the sandbox isn't enough — extend it, don't bypass it

Sometimes a model needs context — a tent only looks right next to other
tents; a kid only reads as a kid in a gaggle. The answer is **not** "load the
whole game." The answer is to add a *composite* entity to the sandbox:

- `puppet_lineup` (3 puppets) — exists because a single puppet looked weird in
  isolation.
- `campsite_small / medium / large` — three pre-built configurations.
- `leaf_drum_circle_day` and `leaf_drum_circle_night` — same circle, two ToD
  presets, so you can compare side-by-side without sliding.
- `lake_with_beach` — lake + beach combo so beach proportions read against
  the water.

If you're tempted to "just check it in-game because the sandbox can't show
this," **stop and add the composite sandbox view first.** Future-you (and
future-agent) will thank you.

## What goes in the sandbox vs. what doesn't

In:
- Anything in `src/models/`.
- World-roaming entities (carts, NPCs, puppet parades, brass band) with mock
  drivers so they animate.
- Particle/feedback systems (smiles, bubbles, hearts).
- Composite scenes that exist purely as visual diff targets (`puppet_lineup`,
  `campsite_medium`).

Out:
- The chunk system, world streaming, and player collision — these are
  emergent behaviors of the running game, not entity-level rendering. Verify
  them in the running game (preview the main app), but only after the
  primitive entities are sandbox-verified.
- The Trip post-process pass and Wook trip system — gated behind a hidden
  interaction; don't surface in the sandbox.

## Smell test before declaring done

Before you say "the change is in," ask yourself:

1. **Can the next agent open one URL and see exactly this change?** If no,
   the sandbox surface is incomplete.
2. **Did I screenshot the before and after?** If no, you don't actually know
   the change landed.
3. **Did I check at least two ToD presets?** Materials behave wildly
   differently at noon vs midnight; emissive that looks subtle at dusk can
   blow out at midnight.
4. **If the entity has a collision kind, did I press "Hit it"?** SFX
   regressions are silent (literally) without this.

If you answer "no" to any of these and the question is *easy to answer with
the sandbox*, go answer it. The whole point is that verification is cheap
here — use that.
