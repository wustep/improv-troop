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

## Round 2: the page, at 1300 and 390 px

Used: a fresh load, a mock improviser run (key `mock`), the settings panel, Brains & sounds, the debug panel and the chart, at 1300 px and a true 390 px. (The test browser runs at 90% zoom, so its "390" window was really 433 CSS px; that looked like horizontal overflow and wasn't.)

Ranked: (1) the chart box cut a system in half at its bottom edge, with no sign it scrolls; the desktop settings column did the same, (2) the form strip's short sections read "I…" and "Out H…" on a phone, (3) "peek under the hood" on a phone opened the panel out of sight, so the tap seemed to do nothing.

- `useScrollMore` marks a scroll box while there's more below its fold, and `.scroll-more` fades the bottom edge: the chart, and the sticky settings column on desktop. At the true bottom the fade goes.
- A form-strip label that won't fit falls back to its first word ("Out Head" → "Out"), then to nothing. The section's colour and portraits still say which it is, and the full name is the tooltip and the accessible name.
- Opening the debug panel scrolls it into view (nearest, so nothing moves on desktop).

Checked and fine: Brains & sounds at 390 px, the fixed mini transport (screenshots of a smooth scroll misplace it), the space under the footer (a full-page capture artifact).

Still rough: the mock band's every spotlight reply is "Bruno, answer me!", so in mock runs Bruno says it to himself. Nothing stops a real model addressing itself either.
