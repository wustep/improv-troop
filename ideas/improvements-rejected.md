# Rejected improvement ideas

<!-- Consulted AFTER fresh generation so it can't bias new ideas. Don't re-propose these. -->

- **callLLM abort handling** — abortable backoff sleep, AbortError on cancel, remove acquire() listener, guard res.json() _(rejected 2026-10-06)_
- **Takes persistence: one cap, quota-aware save, shape-checked load** — unify 12-vs-8 take limits, warn on quota, validate on load _(rejected 2026-10-06)_
- **Shared note-shaping for audio and animation** — one shapeNote() in feel.ts used by engine.ts and frames.ts _(rejected 2026-10-06)_
- **Skip no-op SVG writes in sprite Bag** — cache last attribute values in rigs/types.ts Bag _(rejected 2026-10-06)_
- **FormMap as keyboard scrubber** — single role=slider, pointer seek, translateX playhead _(rejected 2026-10-06)_
- **Sheet follow-scroll visibility/restore** — "back to the band" pill when follow is off _(rejected 2026-10-06)_
- **ARIA semantics on chip groups and RoughButton** — opt-in aria-pressed, radiogroups, labels, slider valuetext _(rejected 2026-10-06)_
- **Export MIDI** — type-1 SMF writer with per-take download _(rejected 2026-10-06)_
- **Loop a section for practice** — bar-range looping via FormMap/Transport _(rejected 2026-10-06)_
- **Visible seed: again / re-roll / variation** — seed chip with regenerate actions _(rejected 2026-10-06)_
- **Direct unit tests for reharm.ts and ending.ts** — invariant tests for reharm and endings _(rejected 2026-10-06)_
- **Cross-style invariant sweep over generateLocal** — matrix test of styles × standards × lengths × seeds _(rejected 2026-10-06)_
- **Seeded golden snapshots for the engine** — per-style digest snapshots _(rejected 2026-10-06)_
- **Real AGENTS.md architecture notes + play-through guide** — module map, data flow, determinism rules, __jamming usage _(rejected 2026-10-06)_
- **The sheet's tempo marking goes stale after a tempo change** — Include tempo in the signature, or draw the marking outside the cached SVG _(rejected 2026-10-06)_
- **Validate persisted settings on hydrate** — Pull out `sanitizeSettings` from `decodeShare` and use it in both places _(rejected 2026-10-06)_
- **One shared frame clock instead of 6+ rAF loops** — Add `src/audio/clock.ts`: one rAF with subscribers _(rejected 2026-10-06)_
- **Keep Play within reach on phones** — A sticky compact transport once the inline one scrolls out of view _(rejected 2026-10-06)_
- **Honor reduced motion everywhere, not just bubbles** — Zero the motion tokens in the media query and use `behavior: "auto"` for the sheet scroll _(rejected 2026-10-06)_
- **Stop hiding affordances behind hover** — Show them on `(hover: none)` and on focus-within. Add undo for delete _(rejected 2026-10-06)_
- **Cut screen-reader noise in the transport status line** — A hidden polite region that announces milestones only, with a fixed label on the share button _(rejected 2026-10-06)_
- **Visible focus ring on the sheet scroller** — Remove it and use a negative offset if the ring gets clipped _(rejected 2026-10-06)_
- **Record and download audio** — Tap the compressor into a MediaStreamDestination and record with MediaRecorder until `onEnded` _(rejected 2026-10-06)_
- **"Surprise me": random band and style** — A 🎲 that picks a sensible seeded band and a style or standard, then sketches _(rejected 2026-10-06)_
- **Solo-listen one player** — A `soloListen(id)` toggle on the name tag _(rejected 2026-10-06)_
- **Reopen the last take on reload** — Remember the selected take id and restore it _(rejected 2026-10-06)_
- **Run `next build` in CI** — Add a build step with `.next/cache` cached _(rejected 2026-10-06)_
- **Store persistence tests** — Stubbed-localStorage tests covering corrupt JSON and unknown values _(rejected 2026-10-06)_
- **A pure track/cursor module for the audio scheduler, with tests** — Extract them into `src/audio/tracks.ts` and test them _(rejected 2026-10-06)_
