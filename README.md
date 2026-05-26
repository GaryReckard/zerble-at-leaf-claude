# Zerble at the Festival

> A bubble adventure.

Drive a smiling, mustachioed golf cart through a procedural festival. Trail bubbles past dancing crowds, drum circles, food trucks, brass bands, and giant puppet parades. Collect smiles. Don't run over the kids.

```
   ____  _ _   _              _
  |__  /| | | | |            | |
    / / | | |_| |__   ___    | |__   __ _ ___
   / /  | |  _  |/ _ \   _   | '_ \ / _` / __|
  / /___| | | | |  __/  (_)  | |_) | (_| \__ \
 /_____/|_|_| |_|\___|       |_.__/ \__,_|___/   ZERBLE
                                                     at FESTIVAL
```

## Premise

You are Zerble — a 6-wheeled, glow-eyed festival cart with bubble-blowing breath. The festival sprawls procedurally in every direction: main stage at the origin, side stages, vendor rows, food plazas, drum circles, hammock groves, lakes, forests, and mountains on the horizon.

The crowd is watching. Glide past them. Let your bubbles drift. They will smile — and smiles fly to you like tiny suns.

## Features

- **An infinite festival.** Chunks generate around you as you drive. Every chunk picks a theme — main stage, food plaza, vendor row, drum circle, grove, lawn — laid out deterministically from its grid coordinates, so the world feels designed but never runs out.
- **A living crowd.** NPCs have personalities (curiosity, skittishness, social, talkative). They wander, watch, approach, panic, and ride along. Make eye contact, blow bubbles past them, they smile.
- **A real day/night cycle.** Dawn → noon → dusk → midnight, on a tunable loop. Stage lights and tiki torches kick in after sundown. The sky shifts. The drum circles get louder when the dark settles.
- **Procedural sound.** No audio files. The engine drone, collision thuds, bicycle bell, clown horn, brass band, drum circles, and crackling campfires are all synthesized at runtime in Web Audio.
- **Forests, lakes, mountains.** Drive into the woods and find a clearing with a fire. Drive to the shore and find a canoe. Drive far enough and the hills rise around you in autumn color.
- **Find Lurleen.** Somewhere out there is a second cart with pink puffy lips, raffia hair, and a basket of flowers. She is shy. Get close and the air fills with hearts.
- **Don't hit anything.** Puppet parades, brass bands, gaggles of kids, food trucks, craft tents, the stage, lampposts, trees, drum circles, the lake edge. They will dock your smiles.
- **Works on a phone.** Virtual thumbstick, drag-to-orbit camera, honk and boost buttons. Tested in iOS Safari with the URL bar doing its thing.

## Controls

### Keyboard

| Keys | Action |
|---|---|
| `W` `A` `S` `D` | Drive Zerble |
| `← ↑ → ↓` | Orbit / tilt camera |
| `Shift` | Boost |
| `Space` | Honk! (random — bell or clown horn) |
| `B` / `H` | Specific honk — bicycle bell / clown horn |
| `V` | Cycle camera — chase / first-person / top-down |
| `↑` / `↓` (top-down) | Zoom in / out (or mouse wheel) |
| `I` / `O` | Eye glow brighter / dimmer |

### Touch

- Left thumbstick — drive
- Drag anywhere else — orbit / tilt camera
- Boost / Honk / Cam buttons — bottom right

## Play it

Open `index.html` in any modern browser. That's it — no install, no build step.

To run a local dev server (recommended, so ES modules load with `file://` blocked):

```
python3 .claude/serve_nocache.py 8765
```

Then visit `http://127.0.0.1:8765`.

## Tech

- Plain ES modules + an importmap. No bundler, no transpiler.
- [three.js](https://threejs.org) for rendering (loaded via CDN through the importmap).
- Web Audio API for everything you hear.
- Vanilla DOM for the HUD.
- ~25 source files, all hand-rolled, all hot-editable.

## Performance tiers

The game sniffs your device at boot and picks `low` / `mid` / `high` — adjusting pixel ratio, shadow quality, post-processing, crowd density, and draw distance. Force a tier by appending `?perf=low` (or `mid` / `high`) to the URL.

## Tips

- Honking makes a ring. NPCs inside the ring snap their heads toward you and a few will smile. Use it.
- Bubbles drift on a slow wandering wind. A long trail of them past a group will rack up more smiles than driving straight through.
- You can knock smiles off your total by ramming people. The crowd panics. Don't.
- If you find Lurleen, drive slow.

## Credits

Built by Gary, with Claude as co-pilot. For every weird, wonderful person who has ever danced near a fire at a festival.

## License

Personal project. License TBD — for now, please ask before redistributing.
