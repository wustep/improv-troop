# Improvements, 2026-10-09 (third set): director's rounds

Starting from 9f404ac (362 tests). Everything measured in a production build (`pnpm build && pnpm start`) with both server keys blanked; no model was called and no key was used. I can't listen, so music and mix judgements are from recordings measured in the browser, not by ear.

## How I chose

Used the app as a listener would: first load, play, stop, the chart, a phone, the debug panel's audio counters, then the takes list. Measured instead of guessing: frame times, main-thread time per second (Chrome's own counters over CDP), bytes on load, and, once round 3 made it possible, the band recorded part by part.

Ranked plan, revised after each round:

1. **The page ran at 30 fps while playing**: the main thread was busy ~1 s of every second, which is jank, battery, and audio scheduling at risk. (Round 1)
2. **1.1 MB of script on first load** to engrave a chart in two fonts: slow on a phone. (Round 2)
3. **A take could only be kept as a link** that needs the app: no way to keep or send the music itself. (Round 3)
4. **Model takes silently dropped** from the list, and two touch-screen rough edges. (Round 4)
5. Mix balance: measured, left alone (see below).

## Round 1: 60 fps while playing (def3268)

The page ran at 30 fps with the band playing: 1,004 ms of main-thread work per second, almost none of it script (0.5 ms per frame) or layout. It was paint: every animation frame on the stage re-walked the chart's thousands of VexFlow glyphs. Hiding the stage or the chart each brought back 60 fps; CSS containment on the stage, compositing layers and the chart's blend mode made no difference.

Chart rows now use `content-visibility: auto`, so rows below the fold or scrolled out of the box are skipped. Rows have a fixed height, so nothing shifts. Production build, 1300 px: playing went from 1,004 to 193 ms/s and 30 to 60 fps; at 390 px, 160–195 ms/s at 60 fps. The chart still renders every row when scrolled to.

Along the way: a stale production server kept serving the old build after a rebuild (`pkill` missed it), which produced one misleading measurement; the numbers above are from clean before/after builds of the same script.

## Round 2: VexFlow's core and two fonts (b5f8705)

The full VexFlow entry inlines six engraving fonts as base64 to use Petaluma and Petaluma Script. The page loads `vexflow/core` and those two as `public/fonts/*.woff2` (SIL OFL, extracted from VexFlow's own bundle; noted in docs/SOUNDS.md), and fetches the full entry only if they fail. Script transferred on load: 978 KB to 393 KB, plus 271 KB of font files. The engraving is unchanged.

The two "standards form" tests generated every note of every standard's take to check its form and last chord, and timed out whenever the machine was busy (they blocked a commit this round). They check the frame alone now; the suite went from ~15 s to ~7 s.

## Round 3: save a take as audio (b9439a1)

"save as audio" sits by "share this take". It plays the take from the top and records the band off the end of the mix (after the compressor, so the file is what the speakers play) with `MediaRecorder`: Opus in WebM, or AAC in MP4 on Safari. It starts on the downbeat (no count-in clicks), keeps 1.5 s for the room to ring out, and names the file after the take. Stop throws it away ("stopped, nothing saved"). Real time, because the samplers are live; an offline render would mean a second audio engine.

Checked in a production build: an 8-bar take saved 15.5 s of stereo Opus, music from the first second, peaking at −5 dB, tail to −72 dB; cancelling mid-take saved nothing.

## Round 4: takes and touch (fc5db14)

- The list keeps twelve takes and dropped the oldest even when it was a model take, which cost credits and can't be made again. The oldest local sketch goes first (it comes back from settings and seed); only a list of model takes loses its oldest.
- On a touch screen a take's delete button never appeared (hover only); it shows where there's no hover. The band's remove buttons went from 18 px wide to 32 × 32.

## Measured and left alone: the mix

Using round 3's recorder, I recorded each player of a swing sketch alone and measured loudness while sounding, K-weighted like LUFS: trumpet −23.1, piano −25.6, drums −27.1, bass −28.6 (the whole band −20.7). The packs were level-matched on unweighted RMS, which flatters a bass, and the bass does sit 5.5 below the lead. That's on the quiet side of a combo mix but not out of it, the piano figure includes its solo, and a level change made without listening could easily be worse. Left for someone with ears; the script approach (mute all but one, save as audio, decode, weight) is the way to check a change.

Also checked and fine: playback scheduled 422 notes with 0 late and 0 dropped; Space already toggles play; every control has an accessible name.

## Still rough

- The mix balance above, unheard.
- Recording is real time: a 64-bar take takes as long to save as to play.
- A 200 Hz high-pass meant to model a phone speaker barely moved the bass's loudness in my measurement, so that figure isn't trustworthy yet.
- The full VexFlow entry is still in the build as the fallback chunk (fetched only if the font files fail).
