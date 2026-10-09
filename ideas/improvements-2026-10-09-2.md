# Improvements, 2026-10-09 (second set)

Rounds after direct Anthropic keys (40f992c). Each round started from using the app or the art lab, with a ranked list, and shipped the top items.

## Round 1: instruments, frame by frame

Ranked: (1) no way to inspect a pose frame by frame (paused showed the idle pose, not the playing one), (2) arms that cross or paws that teleport, measured over real takes for all 12 instruments, (3) the clarinet's lower arm reaching across the chest.

**Art lab scrubber.** Paused now holds the *playing* pose at that beat (`&stopped=1` for the band at rest). A sticky bar has back/forward a frame (← →, `,` `.`), a beat (shift + arrows), a scrub slider, a bar · beat · frame readout, and **next glitch** (`g`), which steps forward until a sprite's arms cross or a paw jumps, stops there, and names it under the sprite. Seeking replays the 1.5 s before the target at 60 fps, so eased motion arrives where it would have been. For this, `SpriteHandle.update` takes an optional clock and `hands()` reports where the paws were drawn. Blinks are pseudo-random from the time, so a replayed frame blinks the same.

**Glitches found and fixed** (the measurement drove each rig through generated takes at 60 fps, 7 styles, soloing and comping):

| Rig | What happened | Fix |
|---|---|---|
| Drums (funk) | A crash and a closed hat on the same beat are both left-hand pieces, so the right hand reached across the kit for the hat: crossed sticks, a 63 px jump. | A hat stroke under a crash is covered by the crashing hand (it's inaudible under the crash). |
| Violin, cello | A long note that would run off the bow restarted the stroke at the other end: the bow arm teleported up to 55 px. | `nextStroke`: alternate direction, use only the bow that's left; with almost none left, go the way there's room. |
| Cello | In a triple-stop the bow followed the first note; when the shortest one ended it switched to another at a different progress and jumped 28 px. | The bow follows the longest note of a chord (`longestOf`). |
| Bass | An octave shift moved the fretting hand 40 px in one frame. | `slewTo`: eased, and capped at a hand's speed. |
| Vibes | A parked outer mallet popped up in one frame; a mallet moving between the accidental and natural rows snapped 17 px. | Both eased with `slewTo`; the mallet still lands on every bar (the existing test). |
| Clarinet | The bell angled toward the screen-right arm, so on high notes (bell lifted) the lower paw sat level with the far shoulder, the arm straight across the chest. | The bell angles the other way; each arm reaches its own side. |

`src/art/glitch.ts` holds the rule both the lab and a new test use: shoulder-to-paw lines that intersect away from the shoulders (a sax held at the side passes in front of the other shoulder, which is fine), or a paw moving more than 25 px in a 60 fps frame. The test runs every instrument through swing, funk, baroque and ambient, soloing and comping: zero glitches.

Still rough: the glitch rule doesn't catch an arm stretched straight across the chest (the old clarinet), and reach isn't checked (the bass, trumpet and violin reach up to 125 px from the shoulder by design). `engine.test.ts` has two tests near the 5 s limit that time out when the machine is busy.
