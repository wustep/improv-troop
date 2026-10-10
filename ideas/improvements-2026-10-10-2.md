# Improvements, 2026-10-10 (2): how the animals move

Starting from 2314ec7 (393 tests), ending at 407. No model calls: the dev server ran with `IMPROV_TROOP_SERVER_KEY= AI_GATEWAY_API_KEY= ANTHROPIC_API_KEY=` and the key dialog's check (`/api/key`) was stubbed in the browser when testing a save.

Before and after frames, clips, and side-by-side comparison GIFs are in `/tmp/jamming-anim/` (not in the repo).

## How it was looked at

- **The art lab's real-take mode.** The lab could only play its own phrases at 108 bpm. It now plays a real take from the local engine in any style, tempo and seed (`?style=funk&tempo=120&seed=4`, or the music/tempo/seed controls), with the soloist's take generated with them soloing. It also shows the frame rate it draws at. `rigTake()` (`src/art/rigs/take.ts`) builds those takes for both the lab and the rig tests.
- **Frame by frame and next glitch** on both line-ups (all twelve instruments) in all eight styles, the tempo extremes (swing 240, New Orleans 200, ambient 56), and soloing or not. After the fixes I also put each instrument on all nine animals at once (every mouth height) for swing, funk at 120 and ambient at 56.
- **At full speed:** filmstrips of each musician, the cheer, ears and tails, and the real stage playing a heuristic take.
- **Two throwaway measurements** (deleted afterwards) drove each rig through real takes at 60 fps. One measured each paw's distance from its shoulder and how far it went past the far shoulder. The other counted fast reversals and the biggest change of velocity between frames.

## The glitch check now catches reach and arms across the chest

`src/art/glitch.ts` adds two kinds to `crossed` and `jump`:

- **reach:** a paw farther than 88 px from its shoulder. The shoulders are 58 apart and a resting arm hangs about 45.
- **across:** a paw more than 8 px past the *far* shoulder, at chest height (from 45 above the shoulders to 25 below). Lower down, an arm crossing the body is how some instruments are played: a bassist's pizz, a guitarist's strum, the sax's lower stack. Higher up, it's a reach over the head.

Both are measured against the shoulders **where the body has put them**. Body motion moved into `src/art/motion.ts`, and the rig tests drive the same `Motion` the sprite does, so a vibist who has walked left isn't flagged for playing in front of themselves. The lab, the 60 fps rig sweep (now with swing at 240 and ambient at 56 too) and `glitch.test.ts` all use the same rule.

What it found (frames per take with a glitch, the old code):

| | found | fixed by |
|---|---|---|
| Bass, every style | reach + across on nearly every frame: the stopping hand up past the head for the nut (125 px), the pizz arm across the chest | A bass a frog can reach: nut at eye level, leaning back toward the player (scale 1.12 → 0.94, tilt 5° → 2°). Open strings leave the stopping hand where it is (it went to the nut for every open G). The paw sits just below the stopping finger. Pizz at the end of the fingerboard, the arm coming down across the belly. |
| Trumpet, every style | across on half or more of the frames (all of them in baroque): the left hand crossed under the chin to the valve casing | The left hand cradles the leadpipe by the first slide. |
| Trombone, funk and ambient | reach: 6th–7th position and the lowered rest pose (98 px, hand below the floor) | The 7th position sits at the end of the arm (8.5 px a position, not 10.5), and the slide closes to first when the horn is lowered, as players rest it. |
| Vibes, swing | across: both paws on a close pair at the low end, the far arm across the body | Four-mallet technique: a close pair at either end goes to one paw's two mallets. The player walks along the bars toward the mallets (up to 26 px, the feet stepping as they go) and leans the rest of the way. The pianist slides along the bench the same way (up to 12). |
| Violin | a few reach frames once the body swayed | Brought in a little (and open strings keep the hand in position, as on the bass). |
| Flute (lab sweep only, frog, minimal) | across: the upper arm just past the far shoulder | The upper hand sits by the embouchure keys. |

After the fixes, the rig sweep and every lab sweep are clean.

## Body motion (`src/art/motion.ts`)

- **In time.** The head nods like a bouncing ball: a quick turn at the bottom, landing on the beat, with hang time between beats. The old `(1 − phase)³` bob jumped by its full amplitude at every beat. The body bounces from the knees and the head follows about 50 ms behind. Above 150 bpm the nod goes half-time (a whole bar in three), so a fast swing isn't frantic. Weight shifts foot to foot over the bar (on 1 and 3) and the head counter-tilts. The tapping foot lifts through the back half of the beat and comes down on it (the old tap jumped up on the beat).
- **Feet stay planted.** Dips (a pianist into a chord, a bassist's pull) squash the body about its feet. They used to translate the whole character, pushing the feet into the floor.
- **Idle ↔ playing.** One eased blend: into the groove in about 0.3 s, out of it in about 0.7 s, so the last nods trail off when a take stops. Idle has slow breaths, an occasional weight shift and a look along the line. The horns come up and go down in one eased arc (`damp`), not an exponential lurch.
- **Reactions.** The bow (1.4 s) rises a little, bends from the waist, holds, and comes back up past level, finishing in a grin. The listeners' nod is two soft dips. The cheer crouches, hops (11 px), lands in a squash, hops smaller and settles, with a grin, a wagging tail and perked ears.
- **Ears and tails** are separate parts with pivots (`AnimalArt.ears`, `.tail`) driven by damped springs. They lag the head's bounce, perk toward the soloist, droop a little in soft passages and twitch now and then. Bunny and sheep ears are floppy, the elephant's flap, the fox's bushy tail swings behind the sway, and the cat's curl and the sheep's puff wiggle. The portraits draw the ears too.
- **Gaze.** The eyes make saccades: they jump to where the paws work and hold there, instead of drifting with every move. When glancing at the soloist the eyes go first and the head follows. A blink comes with each new glance and each reaction, and blinks shut quickly and open slower.
- **Expressions.** A soloist reaching the top of their range lifts their brows. The grin replaces the mouth for a cheer and the end of a bow.

`motion.test.ts` checks that the bounce lands on the beat without a jump, the foot is down on the beat, the pulse goes half-time when fast, and the head never jumps between idle and playing. It also checks that the feet stay on the floor while the body bounces, the cheer crouches, leaves the ground twice and comes back to rest, the bow rises before it goes down, and the spring overshoots, settles and holds still on a paused frame.

## Hands ease in and out (`glide`, `damp`)

An exponential ease starts at full speed, so a hand shifting up a neck covered 15–21 px in its first frame. Peak frame-to-frame change of a paw's velocity, before → after (fast reversals per minute in brackets):

| | before | after |
|---|---|---|
| piano | 20.8 (34.5/min) | 13.3 (0.4/min) |
| bass | 14.1 | 4.1 |
| cello | 21.5 | 5.5 |
| violin | 15.1 | 5.7 |
| guitar (fret hand and strum) | 17.7 | 10.8 (the strum, which is fast) |
| trombone | 15.8 | 3.4 |
| trumpet | 9.1 | 4.3 |
| flute | 6.5 | 4.7 |
| sax, clarinet | 7.8, 7.7 | 8.7, 8.7 (the fingering paw now works with key changes) |
| vibes | 20.1 | 17.0 (a mallet reversing at the bar) |
| drums | 24.5 | 21.3 (a stick reversing at the head) |

`glide()` travels like a limb: it accelerates at a set rate, cruises, and brakes in time to land (braking computed a frame at a time, so it doesn't stop dead). `damp()` is a critically damped spring for softer moves. Both live in `rigs/types.ts`. A new rig test keeps every paw's velocity change under 14 px per frame, with drums 24 and vibes 20 because a stick or mallet really does reverse at the head.

## Technique, instrument by instrument

- **Piano.** Each stroke comes down into the keys and lands on the note, stays down while it's held, and rebounds after; legato is a smaller lift. The old press snapped 7 px down *after* the lift had already landed, which was the 34 reversals a minute. Long jumps arc over the keys, the wrist rolls into strokes, and the hands glide. The sustain pedal is legato: up for an instant as each new chord lands, then straight back down.
- **Drums.** The hand glides from drum to drum, lifted in an arc while it travels, and the stroke rides on top exactly, so the stick still lands on every onset (the >98% test holds).
- **Violin, cello.** The bow bites and eases into each change (`bowCurve`) instead of moving at one speed and reversing at full tilt. The wrist bends at the frog and opens toward the tip, with the elbow following, and vibrato widens in after the note speaks. Arco ↔ pizz eases, and shifts along the neck glide.
- **Bass, guitar.** Shifts glide. On the bass, open strings don't move the hand.
- **Trombone.** The slide sets off for the next note as this one ends and lands with it.
- **Trumpet.** The valves travel down and spring back; they used to teleport 4 px.
- **All winds.** The horn gives a little on each tongued attack. The fingering paw works when the keys or valves change, so a run looks fingered.
- **Vibes.** A long damper pedal near the floor, worked by the right foot wherever the player stands: down while notes ring, up to stop them, and lifted at each new chord.

## Frame rate

Measured with headed Chrome, timing every frame interval and every `requestAnimationFrame` callback over 6 s, on the art lab (nine 240 px sprites at full speed) and the stage playing a heuristic take. The before and after were interleaved, three runs each, with the baseline commit served from a worktree.

| | before | after |
|---|---|---|
| dev build, lab / stage, 1× CPU | 60 / 60 fps | 60 / 60 fps |
| dev build, stage, 4× CPU throttle | 60 | 60 |
| dev build, lab, 4× CPU throttle | 52.8–53.3 | 50.6–51.0 |
| **production build**, lab and stage, 1× and 4× | 60 everywhere | 60 everywhere |
| sprite script per frame (rAF median, stage, 1×) | 1.4–1.6 ms | 1.4–1.6 ms |

In the production build at 4×, main-thread time on the lab rose about 5% (script +7, style +10, layout +5 ms per second). That's well under 0.1 ms a frame unthrottled, and no frames were dropped. The dev-build dip is React's development overhead amplifying it. Freezing the new ear and tail motion didn't change it, so it isn't their repaint.

## Welcome dialog leftovers

- Closing after a save returns focus to what opened the dialog. If that's gone (the "add an AI key" link disappears once there's a key) or was nowhere (a first visit), focus goes to the band's main button (`data-after-key`). Checked in Chrome both ways.
- "sk-ant-" broke at its hyphen at 390 px. Key prefixes stay on one line in the hint and in the problem messages (`keepPrefixes`), and copying still gives real hyphens.

## Caveats and next ideas

- The comparison clips use the lab's own phrases, since the old lab had no real-take mode. Style-mode clips exist only for the after.
- `REACH_PX` (88) and the chest band were chosen by eye against these drawings. A much taller or shorter animal would want them scaled.
- The vibist's feet step while walking but the legs aren't drawn, so a long walk still slides a little. The piano and drum feet are drawn by their rigs and stay put while the body slides or leans.
- The guitar strum (10.8 px/frame) and the drum and vibes strokes are fast on purpose. The snap test allows them; if they ever look harsh, a strum could ease out more.
- Not done: arms raised in the cheer (the paws stay on the instruments), and breath marks you can see for winds beyond the inhale and cheeks.
