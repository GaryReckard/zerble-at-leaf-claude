# Star Power — design doc

> Status: design only, not yet implemented. Tracked in ROADMAP under
> "Gameplay verbs".

The hook: a rare floating glowing star hidden somewhere in the world.
Catch it and for ~15 seconds Zerble enters a "star power" mode — invincible
to collisions, polygons cycling through a silvery rainbow, fun fast music
overrides whatever's playing, and every NPC nearby falls in love with you
and starts spawning smiles. Pure Mario-invincibility energy applied to a
chill festival game.

This doc captures the design before any code is written so any
agent/human can build it without re-deriving the choices.

## Player experience (one paragraph)

You're driving along, you notice a faint twinkle in the distance — a
small spinning star floating ~1.5m above the grass, slowly rotating with
a soft halo. You steer toward it, the cart contacts it, the world
EXPLODES into rainbow. A jaunty up-tempo loop kicks in, the music ducks,
Zerble's cart and driver shimmer through metallic rainbow hues, and
suddenly nothing can stop you. NPCs you pass burst into smiles —
everyone within ~25m starts spawning smile pickups continuously. You can
plow through food trucks, brass bands, parade puppets, every hard
collider without a scratch. After 15 seconds the rainbow fades, the music
returns to ambient, and you're back to normal — but your smile counter
has jumped by a couple hundred points.

## Triggering — finding the star

### Spawn rules

- **One active star in the world at a time.** Never two simultaneously
  (would dilute the rarity / break the music swap).
- **Cooldown after pickup:** ~3 minutes before the next star can spawn.
  Long enough that you feel lucky when you find one.
- **Spawn location:** pick a deterministic-but-hidden spot in a chunk
  near the player's exploration ring (200-400m from current position).
  Eligible chunk themes: `grove`, `open_lawn`, `drum_circle`. Skip
  stages and food/vendor chunks — too visible to be a "find".
- **Lifetime:** the star persists until collected OR until the chunk
  containing it unloads. If it unloads, another can roll for a
  different chunk.
- **Visual hint:** a subtle pillar of light extends ~8m up from the
  star's position (thin emissive cylinder, alphaTest). Players notice
  the pillar from across the festival without it spoiling the exact
  spot.

### Star mesh

- `THREE.IcosahedronGeometry(0.5, 1)` — small 5-pointed star feel.
- Emissive material with `emissiveIntensity = 2.5`, hue cycling
  per-frame between gold and silver (driven by a shared uniform —
  cheap).
- Floats ~1.5m above ground.
- Y-rotation continuous: `rotation.y += dt * 1.5`.
- Slight vertical bob: `position.y = baseY + sin(t * 2) * 0.15`.
- Soft `PointLight` attached (high tier only, gated by
  `PERF.contextLights`) so it lights nearby grass at night.

### Pickup detection

- Per-frame distance check: cart vs star.
- Trigger radius: `(cart_radius + 0.8m) ≈ 2.7m`.
- On contact: despawn the star + dispatch `StarPower.trigger()`.

## During — the 15-second buff

### Duration + state machine

```
idle → arming (0.2s flash) → active (14.6s) → fading (0.4s ramp out) → idle
```

`StarPower.update(dt)` ticks the state. Mirror the Trip module's
pattern: an `_envelope` value that ramps 0→1 on entry, holds 1, ramps
1→0 on exit. Every visual effect reads the envelope.

### Visual — Zerble's polygons in silvery rainbow

The hard part. Need to recolor every visible piece of Zerble's cart
group + driver + passengers in a continuously-cycling rainbow without
recompiling materials every frame.

**Approach:** add an `onBeforeCompile` shader patch ONCE at module load
to all cart materials. Patch reads two uniforms:
- `uStarPowerEnv` — 0..1 envelope from `StarPower._envelope`
- `uStarPowerHue` — current hue 0..1, advances at ~0.6Hz

Inject into the fragment shader after `<color_fragment>` (same hook the
crowd's tie-dye system uses):

```glsl
if (uStarPowerEnv > 0.01) {
  // Convert diffuse to HSV, override hue with uStarPowerHue, keep
  // value high (~bright), drop saturation to ~0.4 for silvery feel.
  vec3 hsv = rgb2hsv(diffuseColor.rgb);
  hsv.x = uStarPowerHue;
  hsv.y = mix(hsv.y, 0.4, uStarPowerEnv);
  hsv.z = mix(hsv.z, 1.0, uStarPowerEnv * 0.5);
  vec3 rainbow = hsv2rgb(hsv);
  diffuseColor.rgb = mix(diffuseColor.rgb, rainbow, uStarPowerEnv);
}
```

Affected materials:
- Zerble cart body, roof, seats, wheels, bumper LEDs
- Driver (head, shades, hat)
- Mustache
- Passengers riding along (they get the buff too — they're with you)
- Bubbles? Optional — bubbles already have their own variety system;
  could leave them out or have them inherit the rainbow.

**Caveats:**
- Materials must be patched at module load (not at pickup time) so the
  shader is compiled with the uniform present. Use `customProgramCacheKey`
  to avoid the program cache reusing a non-patched program.
- `rgb2hsv` / `hsv2rgb` helpers go in a shared GLSL include — already
  written in `trip.js`'s fragment shader.

### Visual — environment flair

Cheap layer-on effects during `active`:

- **Bubble emit boosted** to ~2.5× normal rate (existing speed-based
  emit + a star-power multiplier in `bubbles.update`).
- **Star burst confetti** at the moment of pickup: 20 small
  star-shaped sprites burst outward from Zerble for ~0.5s. Same
  particle pool as bubble-pop confetti (when that ships).
- **HUD vignette** during the buff: a subtle warm-gold edge gradient
  via CSS on `#hud` — pure DOM, zero three.js cost.
- **Trail behind Zerble**: same emissive ring trail from the "boost
  streaks" roadmap entry, but rainbow-cycling instead of white. Pool
  of ~12, ~0.6s fade.

### Audio — fast jaunty loop

- **Duck stage music + MIDI** to ~0.15 gain via the existing
  `Sound.setMusicDuck` (already used by MIDI player on toggle).
- **Spawn a procedural star-power loop** through the music bus:
  - Style key: `'starpower'` in the existing music engine vocabulary.
  - Tempo: 160 BPM (vs default 90-120).
  - Voices: bright triangle lead + chip-tune square bass + busy hi-hat
    pattern. Same synthesis primitives the jam/brass/drum styles use.
  - Loop length: 4 bars; the 15s buff covers ~6 bar-passes.
- Cross-fade in over 0.2s, cross-fade out over 0.4s. Stage music
  un-ducks on the way out.

### Mechanics — ghost mode + love magnet

**Ghost mode:**
- The whole collision system is **bypassed entirely** while
  `StarPower.isActive()`. Not "bounces without damage", not
  "obliterates NPCs" — Zerble simply phases through everything like a
  rainbow phantom. Food trucks, brass bands, stages, puppets, kids,
  wooks, lake edges, tent poles — all of it. Drive unencumbered.
- Implementation: the main collision resolver in `main.js` (the
  function that walks `registry.colliders()` + the world-roaming
  obstacle lists and applies bounce + damage) short-circuits when
  `StarPower.isActive()`. One early-return at the top.
- Soft NPCs (the `person` and `kid` and `hula_hoop` kinds that
  currently do gentle scatter) also skip — Zerble just glides through.
- No impact sound, no scatter, no damage. Subtle "whoosh" SFX when
  the cart passes within ~2m of a collidable thing is a nice touch,
  but optional — the music + rainbow already sell the moment.
- **Lake escape on buff end:** when the buff fades, if Zerble's
  position is inside a lake outline, call the existing
  `projectOutOfLake(zerble.x, zerble.z, 4)` and teleport the cart to
  the shore + face it outward. Avoids "buff ended, now I'm trapped in
  the lake and the collider ring is shoving me around" jankiness.
- NPC scatter that the cart caused mid-buff (none, since collision is
  off) — there's nothing to restore on end.

**Love magnet:**
- Per-frame during `active`, find every NPC within `LOVE_RADIUS =
  25m` of Zerble.
- Bump their `happiness` to threshold instantly.
- Spawn a smile pickup at their position with a per-NPC cooldown
  (~1.5s) so a single NPC doesn't fire ten smiles per frame.
- Override their state to `'watching'` (Zerble) for 3s after each
  love-touch — they stop and stare.

Net effect: driving through a crowd during star power = a torrent of
smiles cascading off everyone you pass.

## Visual on the star itself before pickup

The star drifts subtly, rotates, and pulses. Distinctive enough that
once a player has seen one, they know to chase it next time. Same
emissive-with-bloom treatment that stage lights and hula-hoop rings get,
so the existing bloom pass handles its glow at zero extra cost.

Pillar of light:
- Thin cylinder geometry, ~0.4m radius, ~10m tall.
- Material: emissive gold, `transparent: true, opacity: 0.4,
  depthWrite: false`.
- Visible from 200m+ at night, ~80m by day.
- Pulses softly in opacity (sin envelope).

## Failure / edge cases

| Situation                                | Behavior                            |
|------------------------------------------|-------------------------------------|
| Player triggers star power while already on a trip | Trip immediately comes-down (smooth fade). Star power takes priority — you can't be tripping AND star-powered, the visuals would fight. |
| Star power triggered while honking       | Honk completes normally. No interaction. |
| Player crosses chunk boundary while buffed | Buff persists. Bound to Zerble, not the chunk. |
| Star picked up while a passenger has an active quest | Buff applies normally. Quest completes early if you fly through the destination during the buff. |
| Adaptive quality kicks in during star power | Visual effects degrade gracefully — bloom may turn off, rainbow shader still works. Music chain unaffected. |
| Player dies (health → 0) right as star pickup happens | Star pickup wins. The just-fatal damage is absorbed; player gets the buff. Generous, but generosity = vibe. |

## Implementation sketch — minimal viable loop

**New module `src/starPower.js`:**
- `StarPower.init({ scene, zerble, bubbles, crowd, sound, hud })`
- `StarPower.spawn(x, z)` — drops a star at a position
- `StarPower.trigger()` — kicks off the 15s buff
- `StarPower.update(dt)` — advances state, updates uniforms, runs
  love-magnet pass
- `StarPower._envelope`, `StarPower._hue` — module-state values
- Module-level shared uniforms object (`STAR_UNIFORMS`) for the shader
  patch to reference

**Modifications:**
- `main.js`: import + init + per-frame `StarPower.update(dt)`.
- `zerble.js`: at module load, walk Zerble's child materials and
  attach the `onBeforeCompile` patch + the shared `customProgramCacheKey`.
- `crowd.js`: in `_updateNpc`, check `StarPower.isActive()`; if true
  and the NPC is within LOVE_RADIUS, fire the smile pickup.
- `main.js`: the main collision resolver (the function that walks
  `registry.colliders()` + global obstacle lists each frame) early-
  returns when `StarPower.isActive()`. One line. This is the entire
  "ghost mode" implementation.
- `sound.js`: add a `'starpower'` style to the music engine vocabulary
  (~30 lines reusing existing synthesis primitives).
- `chunks.js`: per-chunk roll for whether a star spawns in that
  chunk (rare; chunk theme gate from the table above).

**Total estimated effort: ~1.5 solid days** — most of the time is in
the shader patch + audio loop. The state machine itself is ~100 lines.

## Build order (recommended)

1. **Star mesh + pillar + spawn rule** — visible target on the
   ground. Players can find it before any buff behavior exists.
2. **Pickup detection + buff state machine** — the 15s timer, the
   `_envelope` ramp, the trigger.
3. **Ghost mode** — collision resolver early-return when
   `StarPower.isActive()`. Drive through everything. One-line gate.
4. **Rainbow shader patch** — the visual signature. After this lands
   the buff actually FEELS like Mario.
5. **Love magnet smile burst** — the gameplay payoff (big score
   jumps).
6. **Music swap + bubble emit boost + HUD vignette** — the audio
   layer + finishing polish.
7. **Lake-escape on buff end** — `projectOutOfLake` safety pop if
   Zerble's still in the water when the rainbow fades.

Steps 1-4 make the feature shippable. 5-7 are layer-2 polish that
makes it sing.

## Open questions (decide before building)

- **How rare is "rare"?** I lean: ~5% chance per eligible chunk-build
  + the 3min cooldown. Tune from playtesting.
- **Should the cart leave a permanent ghost-trail during the buff?**
  Cool idea but might bloat. Defer.
- **Audio: a single 'starpower' loop or a few variants?** Start with
  one. Add 2-3 if it gets old.
- **Bubble varieties during star power:** mix in ALL unlocked
  varieties at higher emit, or override with rainbow bubbles only?
  Mixing is more chaotic + ties to the bubble-varieties roadmap entry.
- **Multiplayer-future:** if multiplayer ever ships, the star is a
  contested pickup — only one player gets the buff. Not relevant now,
  but worth noting so the design doesn't paint itself into a corner.
- **Score tracking:** does star-power count toward "smiles earned"
  for the personal-best stat? I lean yes — it's still effort to find
  the star.

## What this design deliberately avoids

- **Score multipliers that stack across stars.** One star = one buff.
  Stacking would invite exploitation.
- **A visible "where is the next star" indicator.** The hunt IS the
  game. The pillar of light is enough.
- **Permanent unlocks tied to stars.** Stars are episodic, not
  progression. Save the progression for the bubble-variety system.
- **Time extensions or upgrades.** Keep the buff a fixed 15s. Knowable.
- **Modal pickup UI / cutscene.** The buff just starts. Visuals + audio
  tell the player.
- **Punishing the player for missing one.** Stars expire when their
  chunk unloads. No "you missed it forever" feeling — another one
  rolls eventually.
