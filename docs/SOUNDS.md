# Sounds: sources and licenses

Every sound the band plays is a free sample set, streamed through [smplr](https://github.com/danigb/smplr) (MIT) from the hosts listed below. Nothing is bundled in this repository. The count-in click is the LinnDrum's side-stick. When a pack fails to load, the instrument falls back to the next one in its chain (`packChain` in `src/audio/packs.ts`).

| Sound | Used for | Source | License |
| --- | --- | --- | --- |
| Salamander Grand Piano | piano (default) | Alexander Holm, hosted by [Tone.js](https://tonejs.github.io/audio/salamander/) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Splendid Grand Piano | piano option, Salamander fallback | Akai, via [sfzinstruments/SplendidGrandPiano](https://github.com/sfzinstruments/SplendidGrandPiano) | Public domain (released by Akai in 2000) |
| Wurlitzer EP200, Yamaha CP80 | piano options (electric) | Greg Sullivan, via [sfzinstruments/GregSullivan.E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Acoustic drum kit | drums (default) | Kick, snare, cross-stick, toms, hi-hat, two suspended cymbals (ride and crash), claps, tambourine, cowbell, shaker and congas from the [Versilian Community Sample Library](https://github.com/sgossner/VCSL) (Sam Gossner), hosted at smpldsnds.github.io/sgossner-vcsl | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| LinnDrum (LM-2) | drum kit option, acoustic kit fallback, count-in click | [smpldsnds/drum-machines](https://github.com/smpldsnds/drum-machines) | Public domain, per that repository |
| Double bass, pizzicato | bass | D. Smolken's 1958 Rubner bass, via [sfzinstruments/dsmolken.double-bass](https://github.com/sfzinstruments/dsmolken.double-bass) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Vibraphone, soft mallets | vibes | [VCSL](https://github.com/sgossner/VCSL) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| MusyngKite soundfont | horns, strings, guitar, pizzicato, fallbacks | [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| FluidR3 GM soundfont | last-resort fallbacks | [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/) |

The credit line at the bottom of the app names each set, which covers the attribution the CC BY sets ask for.

## Levels

The packs differ by up to 16 dB out of the box, so each one is level-matched:

- Per-instrument volumes (`DEFAULT_VOLUME`) were measured in the browser playing the same line.
- The electric pianos are normalized about 15 dB hotter than Salamander (C4, mezzo), so they play at `EPIANO_VOLUME`.
- VCSL records its drum layers at their natural level: a snare's softest tap peaks 27 dB under its hardest. smplr also scales by velocity, so each layer is trimmed onto one curve, from −13 dBFS for the softest layer up to −1 dBFS for the hardest. The peaks were measured from the decoded samples and are written next to each piece in `ACOUSTIC_KIT`.

## Gaps in the hosted sets

The hosted CP80 is missing three oggs (`057-A3-F`, `065-F4-PP`, `080-G#5-MP`), and the Wurlitzer's `ab6mp.ogg` won't decode. smplr plays silence for a region with no sample. The m4a twins aren't a reliable stand-in, because many of them don't decode in Chromium. So `EPIANO_GAPS` fetches the same note one velocity layer over instead.

## Adding a sound

Only add samples with a license that allows free use and redistribution: CC0, public domain, CC BY or CC BY-SA. Add the set to this table and to the credit line in `src/app/page.tsx`. Level-match it against the pack it sits beside before you make it a default.
