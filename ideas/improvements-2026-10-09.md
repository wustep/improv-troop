# Improvement loop 14 — Jamming — 2026-10-09

> Starting commit: d148301 (329 tests). Five passes, each committed and pushed after `pnpm check`. Ending: 0c4fac1 (340 tests). Gateway spend: about $0.05 (two Gemini 2.5 Flash funk composer takes, seed 11).
> Each pass began with a short ranked list. Items are cross-checked against `improvements-rejected.md`: "Hairpins into dynamic changes" was rejected, and the phrase shaping here works within a bar, not between dynamics.

## Pass 1: the music (d093cc0)

Ranked: (1) heads and written lines play at one velocity, (2) a model drum grid can ask for three sticks, (3) a sanity check of the famous charts, (4) comping voice leading.

| Change | Evidence |
|---|---|
| `shapePhrase`: written notes, `@tune` melodies and motif statements lift the bar's high point and swung upbeats, lean on long notes, and ease a short last note. Deterministic. | Before: a swing head played every note at 0.84 (0.92 at f). After: 0.81–0.90, with the peak on the high note. |
| `playableKit`: a written drum grid keeps at most two stick hits at once, and the hat stays shut under a rack tom. The art lab's fill bar drops the ride and the open hat. | The art-lab fake part crossed the owl's arms. The engine's own grooves had 0 conflicts across 8 styles × 3 seeds. |
| All the Things You Are, bar 20: F#m7 | A subagent audited all 50 charts. Form lengths, melody bar counts, every melody note against its chord: all fine. |

Not changed: the comping top-voice jumps flagged by the first stats run turned out to be the piano's own solo line, not comping. The minimalist bass's 28% root-on-change is a deliberate tonic pedal. The audit's "3/4 two-chord bars split 1.5 + 1.5" was wrong: `form.ts` already splits them 2 + 1. Only the comment in standards.ts said otherwise, and it's fixed.

## Pass 2: sounds (f2416c9)

Ranked: (1) a real acoustic kit for a mostly-jazz band (the LinnDrum swings like a drum machine), (2) an electric piano for funk, pop and soul, (3) a page of sources and licenses.

| Change | Evidence |
|---|---|
| Acoustic kit from VCSL (CC0), the new default: 66 samples, velocity layers, round-robins, open-hat choke. Each layer is trimmed onto one curve from its measured peak. | VCSL layers span up to 28 dB (snare −29.6 to −2.8 dBFS). The LinnDrum's samples peak near 0 dBFS. In a played take: 0 dropped, 0 late. |
| Wurlitzer EP200 and Yamaha CP80 (Greg Sullivan, CC BY 3.0) as piano options, at `EPIANO_VOLUME` 45 | Their samples are normalized about 16 dB RMS hotter than Salamander at C4. |
| `docs/SOUNDS.md`: every sample set, its source and license. The credit line names the new sets. | |

## Pass 3: settings (9090fa4)

Ranked: (1) swing feel, (2) room, (3) count-in. All three were already in the engine and just not exposed.

- **Swing** (Swing and New Orleans only): light, medium or hard. It's a playback dial like tempo, applied in place, and kept in share links. Swing now also follows tempo changes.
- **Room**: dry, club or hall. It scales the reverb sends and is heard at once.
- **Count me in**: a checkbox.
- Room and count-in sit beside the piano sound and drum kit under Brains & sounds, saved as one `sounds` setting. An old saved `pianoPack` still reads back.

## Pass 4: polish (40b9d07)

Ranked by using the app at 390px and 1300px: playing Autumn Leaves, Blue Bossa and Ipanema, a first load, a bad key.

- At 390px Rusty's trumpet bell went 36px past its slot and through the stage frame. Two-across slots are now 84% wide.
- A failed run's error stayed on screen after a new sketch or a new key. It now clears.
- The hosted CP80 is missing three oggs and one Wurlitzer ogg won't decode, which left silent keys. Each gap now fetches the same note one layer over (`EPIANO_GAPS`). Many m4a twins don't decode in Chromium, so switching format was no fix.
- Checked and fine: the sheet re-lays out on resize (it's debounced), the loading line ("unpacking instruments… 5 of 6 ready"), the error recovery actions.

## Pass 5: the model path (0c4fac1)

- A funk or pop melodic part that writes eight 16ths as a whole bar plays the lick twice instead of padding it with two beats of rest. The first eval take had 9 padded Rusty bars.
- Checked: the drum lanes at 14–15 steps are dropped trailing rests, and padding them to 16ths is right. The director's `@comp` for a soloist is already corrected by `enforceSlots`, and neither take showed it.

## Still weak
- Haven't listened to any of it: levels are from measurements, not by ear. The acoustic kit's ride is a suspended cymbal played with a stick (VCSL has no ride), and it uses a single sample per layer.
- The swing soloist's half-bar 16th runs are still padded, because "eight 8ths miscounted" and "a lick then a breath" can't be told apart.
- Gemini 2.5 Flash bass and comping grooves still come in at three beats more often than not (56 loops in one take). They're played, but they aren't what was written.
- The CP80 and Wurlitzer depend on upstream hosting. A new gap would play silence until it's added to `EPIANO_GAPS`.
