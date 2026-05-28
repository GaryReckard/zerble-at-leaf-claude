# Update CHANGELOG (and ROADMAP) before committing

The repo has two docs that together tell the project's story:
[CHANGELOG.md](../../CHANGELOG.md) — what shipped, dated.
[ROADMAP.md](../../ROADMAP.md) — what's queued, plus the parked "we talked
about it" list.

**Every commit that ships user-visible behavior must update CHANGELOG first.**
If the change was on ROADMAP, also remove it from there as part of the same
commit. Don't batch changelog updates across multiple commits; the diff and
the entry should travel together.

## When to update CHANGELOG

Update if the change affects:

- Gameplay or feel (a new entity, new behavior, tuning)
- Player-visible UI or audio
- Performance (any of the three shipped passes set the bar)
- Mobile / iOS behavior
- Dev workflow (a new debug hotkey, a new sandbox entity, the dev server)

**Skip** the changelog if the change is:

- Internal refactor with no observable behavior change
- Comment-only or formatting
- A doc edit (CHANGELOG itself, README, ROADMAP, ARCHITECTURE, CLAUDE.md)
- Fixing a typo in code

When in doubt, write the entry — undercoverage is the bigger risk.

## How to write the entry

Match the existing voice. Look at the top of CHANGELOG before drafting; the
style is dense, specific, and explains *why* not just *what*. Bad entries
read like commit subject lines; good entries read like a developer
explaining the change to a teammate who wasn't in the room.

**Structure:**

```
## YYYY-MM-DD            (today's date, or extend the existing day if it's today)

### Added | Changed | Fixed | Performance     (group by kind)
- **One-line headline.** Then a sentence or two with the specifics — the
  numbers that moved, the file/system involved, the *why*. Cite the
  triggering ticket or thread if relevant.
```

**Date handling:** use today's actual date, in `YYYY-MM-DD`. If the current
top section is already today's date, append under it (same `Added` / `Changed`
/ `Fixed` / `Performance` heading) — don't open a new dated block for the
same day. Today's date is available in the CLAUDE.md system context.

**Sections, in this order:**
1. `### Added` — new features, new entities, new files, new behavior.
2. `### Changed` — tuning, balance, UX shifts, refactors with observable effect.
3. `### Fixed` — bugs squashed (root cause if non-obvious, not just symptom).
4. `### Performance` — anything that moved a number in the HUD budget panel.

If a single commit spans multiple kinds, write multiple sub-bullets under the
appropriate sections. Sub-headings (`### Added — MIDI player + trip warp`)
are used for big multi-bullet thematic landings; a single bullet doesn't
need one.

**Tone:**
- Past tense, declarative. "Added X." not "Adding X."
- Specifics over abstractions. Numbers, file names, the *because*.
- Bold the headline of each bullet so a scanner can skim.

Example of the bar to clear (lifted from the existing changelog):

> **Music: less repetitive across all stages.** Every music generator (jam,
> brass, second-line, drum-circle) now rotates through 2–3 melody/rhythm
> variants instead of looping a single 16-step pattern forever. Lead voices
> have an 8–12% chance to drop notes so the soloist breathes a little (tuned
> down from a heavier 18–28% first pass — too many rests sounded weird).

## ROADMAP — remove what shipped, keep what's parked

ROADMAP has two kinds of entries:

1. **Queued work** — something Gary plans to do. When it ships, **delete the
   entry** from ROADMAP as part of the commit that adds it to CHANGELOG.
2. **Parked work** — "we talked about it, haven't done it yet" + "Out of
   scope (worth flagging)." These stay. Don't delete them just because they
   feel old.

If the commit completes part of a multi-part roadmap item, trim the bullet
to reflect what's left, don't delete the whole thing. Example: ROADMAP
listed "Material pooling in older models (puppet.js, foodTruck.js,
tent.js)"; when puppet + foodTruck pooling landed, the bullet was reduced to
mention only the remaining one.

**Adding to ROADMAP** is also fine in the same commit, if the work surfaced
a new follow-up that isn't worth doing right now. CHANGELOG documents what
shipped; ROADMAP documents what's next. They're complementary.

## The commit-time checklist

Before running `git commit`:

1. **Did this change affect player-visible behavior, perf, or dev workflow?**
   If yes → CHANGELOG update is required.
2. **Was this on ROADMAP?** If yes → remove the bullet, or trim it if partial.
3. **Did the work surface a follow-up worth tracking?** If yes → add to ROADMAP.
4. **Stage the doc updates with the code** — `git add CHANGELOG.md ROADMAP.md`
   alongside the source changes. One commit, one coherent story.

The commit message is *not* a substitute for CHANGELOG. Commit messages are
for `git log`; CHANGELOG is for humans reading the project later.

## When Gary asks you to commit

If Gary says "commit this" without explicitly mentioning the changelog, you
still write the entry. Don't wait to be told — the rule above stands. If the
change is borderline (refactor with arguably-zero player-visible effect),
ask once: "this looks internal-only — skip the changelog?" Better to confirm
than to silently skip.
