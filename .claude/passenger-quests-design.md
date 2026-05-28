# Passenger quests — design doc

> Status: design only, not yet implemented. Tracked in ROADMAP under
> "Gameplay verbs".

The hook: an NPC boards Zerble's cart with a small icon over their head
showing where they want to go. The player drives them there, gets a smile
burst + a thumbs-up wave, and the world's procedural POIs become quest
destinations without any new world-building. The cart turns from "vehicle"
into "ride share", which is exactly the chill-festival vibe.

This doc captures the full design so anyone (agent or human) can pick it up
and build it without re-deriving the choices.

## Player experience (one paragraph)

A festival-goer flags Zerble down, hops in the back, and floats a small
thought-bubble icon above their head — a tent, a stage, a food truck. The
player drives toward the destination, watching the icon brighten as they
get warmer. The passenger occasionally toasts a hint ("I can smell the
food trucks from here!"). Within 25m of the destination Zerble stops, the
passenger hops out, raises both arms in a thumbs-up, and a small burst of
smiles spawns around them. They wave and walk off into the crowd. The
player can already feel the next quest queuing up.

## Destinations (re-use existing registry POIs)

All destinations come from `registry.entries` — no new world content
needed. Filter to these kinds:

| Registry kind   | Reads to the player as      |
|-----------------|-----------------------------|
| `stage_front`   | "the main stage" / "a side stage" |
| `tent_stage`    | "the big tent"              |
| `drum_circle`   | "the drum circle in the trees" |
| `food_plaza` *  | "the food trucks"           |
| `vendor_row` *  | "the vendor row"            |
| `beach`         | "the beach by the lake"     |
| `campsite`      | "my camp"                   |
| `hammock`       | "the hammocks"              |
| `arch`          | "the front gate"            |

\* `food_plaza` and `vendor_row` may need their truck/shack/stand
attractors aggregated under a single virtual "plaza" anchor so the icon
points at the cluster's center, not one truck at the edge.

## Picking a destination at board-time

When a passenger boards (`crowd._tickBoarding` → `'riding'` transition):

1. Snapshot the boarding world position.
2. Iterate `registry.entries`; keep only ones whose `kind` is in the
   destination table above.
3. Filter to candidates **80-300m** from the boarding spot.
   - Below 80m feels trivial.
   - Above 300m feels like a chore.
4. Bias the random pick by inverse distance — closer destinations are
   slightly more likely than far ones, so the player gets a fast first
   quest and a longer one later.
5. **Reject any destination inside a lake outline.** Use `isPointInLake`
   — already exported from `lakes.js`. Defensive; shouldn't fire often.
6. Stash on the NPC: `npc.quest = { destX, destZ, kind, startDist }`.

If no candidate exists (passenger boarded out in a grove with nothing
nearby), they're just a normal rider with no quest. The cart's normal
ride duration handles their dismount.

## Signaling the destination — the thought bubble

A small **billboard sprite** anchored above the passenger's head with a
pre-baked icon for the destination kind. Always faces the camera.

- One `THREE.Sprite` per active questing NPC. Pooled — there are at
  most `MAX_PASSENGERS = 4` quests active at once.
- One `CanvasTexture` per icon kind, pre-rendered at module load (~30
  lines of canvas-drawing per icon — tent, stage, food, vendor, etc.).
  All textures share an atlas if we want to be tidy.
- Material: `SpriteMaterial` with `transparent: true`, `depthTest: false`
  so the icon doesn't get clipped by foreground bubbles.
- Z-offset 0.4m above the head, scaled to ~0.8m wide so it reads
  clearly at chase-camera distance.

The icon kind comes straight from `npc.quest.kind`.

## "Are we there yet" — the indicator stack

Layer three cues. Each is independently optional, but together they cover
players who want clarity AND players who want vibes.

### 1. HUD compass strip (the direct one)

A row of icon+distance widgets at the top of the screen, one per active
quest:

```
[🎪 240m]  [🥨 85m]
```

- Pure DOM/SVG, no three.js cost.
- Arrow tip rotates to point in the destination's direction relative to
  Zerble's heading (recomputed each frame, dirt cheap).
- Color ramps from grey (far) to warm yellow to bright pink (close).
- Click/tap a widget = camera briefly pans toward that destination (nice
  to have, not required).
- Toggleable in settings for players who prefer pure hot/cold.

### 2. Icon brightness ramp (the subtle one)

The thought-bubble icon's emissive intensity rises with proximity:

| Distance       | Icon look                |
|----------------|--------------------------|
| > 200m         | dim, ~50% opacity        |
| 100m           | full opacity, slight glow|
| 25m            | pulsing bright           |
| at destination | brief flash, then despawn |

Works even with the compass disabled.

### 3. Audio cue — passenger humming (the gentle one)

Short sin-based "mm-hmm" tones at random intervals, gain proportional to
`1 - distance / startDist`. Subtle. The player only notices when they're
close. Synth in `sound.js` — same pattern as the existing fire-crackle
bed; ~15 lines.

### 4. Toast lines (the texture)

The passenger occasionally fires a toast via `HUD.toast()`:

| Trigger                                  | Sample line                          |
|------------------------------------------|--------------------------------------|
| Within 80m of a `drum_circle`            | "I hear drums..."                    |
| Within 50m of a `food_plaza`             | "I can smell the food trucks!"       |
| Within 30m of any destination            | "Almost there!"                      |
| Driving past within 25m, then leaving    | "Hey! You missed it!"                |
| Zerble idle > 5s with passenger boarded  | "Hellooo? Where we going?"           |
| Smile delivered                          | "Thanks for the ride!"               |
| 60s elapsed, still far                   | "Eh, I'll just walk from here." (dismount, no reward) |
| Random ambient (every ~15s)              | "This way!" / "Almost!" / "Closer!"  |

Pull from a per-destination-kind weighted line bank so the food-plaza
passenger says food things, the drum-circle passenger says drum things.
Keep the bank small — 4-6 lines per kind is plenty.

## Arrival + reward

Trigger condition: Zerble within `ARRIVE_RADIUS = 25m` of `quest.dest`
AND `|zerble.speed| < 2 m/s`.

1. Passenger transitions to `disembarking` (existing crowd state).
2. After dismount, override their idle pose for 2s with both arms
   raised in a thumbs-up gesture. Just a temporary rotation override on
   the arm `InstancedMesh` matrices.
3. **Smile burst** — spawn 5-10 smile pickups around the dismount
   position via `Smiles.spawn(pos)`. Uses the existing smile pool.
4. HUD toast — pick one of:
   - "Thanks for the ride!"
   - "That was rad!"
   - "Far out!"
   - "Cheers, friend!"
5. If the **token currency** from the meta-progression brainstorm is
   shipped: +1 festival token.
6. Despawn the thought-bubble sprite.
7. The dropped-off passenger waves at Zerble as they walk away.

## Failure / opt-out (chill, never punishing)

| Situation                              | Behavior                            |
|----------------------------------------|-------------------------------------|
| Took >90s                              | "Eh, I'll just walk." Dismount, no reward. |
| Honked + scattered the passenger       | Existing scatter logic (already shipped) clears their seat slot. Quest cancels. |
| Drove past, then drove far away        | Passenger toasts disappointment. Smile bonus halves; quest still active. |
| Cart hit something hard mid-ride       | Existing collision handling. Quest unaffected. |
| Player just chills with passenger      | Allowed. No timer pressure. |

No fail penalty beyond the missed bonus. The game is a vibe.

## Multi-passenger logistics

Max passengers = 4 (existing `MAX_PASSENGERS`). When >1 has a quest:

- The compass strip shows one widget per active quest.
- Arrival check runs per-passenger — drop off one without affecting the
  others.
- Different destinations mean optimal route is non-trivial: "which is
  closer? food trucks first, then drum circle." Emergent depth without
  any tutorial.
- The thought-bubble sprites stack vertically above the cart if
  multiple riders share its space, or each rider's own seat shows their
  own sprite (whichever reads cleaner — try both).

## Implementation sketch — minimal viable loop

If shipping a v1 quickly:

1. **Pick destination at board-time** (`crowd.js`, ~30 lines): filter
   registry, bias-by-distance random pick, stash on `npc.quest`.
2. **Thought-bubble sprite** above the passenger's head while boarded
   (`crowd.js` + a small `models/questIcon.js`): one CanvasTexture per
   destination kind, atlased.
3. **Arrival detection** in `crowd._tickRiding` (~10 lines): if within
   ARRIVE_RADIUS and parked, transition to disembarking with a
   `wasQuest: true` flag.
4. **Thumbs-up + smile burst** in the disembark path (~20 lines).
5. **Toast** on arrival via `HUD.toast`.

That's the whole loop in ~90 lines. Cost: a handful of small
allocations per quest, no perf budget impact at MAX_PASSENGERS=4.

The compass strip, multi-passenger UI, hot/cold humming, and the per-kind
toast lines are layer-2 polish — ship them after the loop feels good.

## Build order (recommended)

1. **Destination pick + thought bubble icon** — the hook. Players see
   what the passenger wants the moment they board.
2. **Arrival detection + thumbs-up + smile burst** — the payoff. The
   loop is fun-complete with just these two layers.
3. **Toast clues** — the texture. The "smell the food trucks" lines
   are the most charming part; they make the festival feel alive.
4. **Compass strip / distance widget** — the QoL. Players will ask
   for it. Build it once the loop is verified fun.
5. **Per-passenger multi-quest UI** — the depth. Defer until #1-4
   feel great.
6. **Streaks / tip jar** — the meta. Pure polish layer.

Total estimated effort for the full feature: ~2 solid days of work.
Minimum viable loop (#1-2): ~half a day.

## Open questions (decide before building)

- **Compass on by default or off?** I lean ON — accessibility-friendly,
  players who want hot/cold can toggle off.
- **Should questless riders still board?** Yes — keeps boarding feeling
  generous. Quest is a *layered* mechanic on top of normal rides.
- **Should kids ever request a ride?** Kids are gaggle-pool, not crowd
  pool — different code path. Skip for v1. Later: gaggle leader can
  request, gaggle follows on foot.
- **Tokens or just smiles for the reward?** Start with smiles only.
  Add tokens if the meta-progression "festival pass" lands later.
- **How rare?** Maybe 30% of boarders have a quest, 70% are normal
  riders. Tune from there.

## What this design deliberately avoids

- **Timed missions.** No countdown clocks. Wrong vibe.
- **Forced quest acceptance.** Passenger requests are emergent, never
  modal pop-ups.
- **Fail-state penalties.** Worst case is "no bonus." Never lose
  progress.
- **Cutscenes / dialogue trees.** Toasts only. Stay synthesized.
- **Required tutorial.** Players will figure out the loop the first
  time the icon brightens as they drive toward it.
