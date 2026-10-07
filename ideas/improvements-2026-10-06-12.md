# Quality pass — Jamming — 2026-10-06 (loop 12, real models continued)

> This loop went after the weak spots left by loop 11. Each one was measured on the gateway with `pnpm eval:gateway` or a replay of the exact production request, then fixed and measured again.
> Starting commit: 709a397. Ending: 2008bb8. Tests 307 → 313. Spend: about $1.50 (Haiku 4.5, Sonnet 5.5, Gemini 2.5/3.8 Flash, GPT-5.4 mini, Sonnet 4.6).

| Weakness | Measured | Fix |
|---|---|---|
| Haiku count-off fell back to text | Real request replayed 8×. With thinking: structured 2/8, about 3,500 output tokens each. Without: 8/8, about 330 tokens. | Models can be marked `noThinkingWithSchema`; Haiku's schema calls drop thinking. Gemini 2.5/3.8, GPT-5.4 mini and Sonnet 4.6 were checked and are fine (a687b5b). Final sweep: 14 of 14 takes fully structured. |
| Gemini 2.5 Flash funk 16ths | Runs of 16ths miscounted (15 or 11 steps); comping written as `Bb9/16` (MIDI 130) | Busy 16th bars are requested as comma-separated beats and fitted beat by beat. Over-high 6/7/9 names from compers are read as chords (d412e40). Composer bars short or long at realize went from 1 and 6 (2 seeds) to 0, 0 and 21 (3 seeds). Still noisy. |
| Bandmates talk every phrase in stock words | 18 lines offered per take, mostly "pocket/motif/locked" | `TalkGate`: at most 2 lines a phrase, an accompanist every other phrase, filler and repeats dropped. 5–6 lines kept per take (21d1456). Lines capped at 120 characters for phones (139f467). |
| Leader names chords not in the chart | "step into C7" over Cm7 | Chord names in talk are checked: a wrong quality becomes the chart's chord, a sentence about an invented chord is dropped (21d1456). |
| Harness cost when director ≠ player | Sonnet priced as Haiku | Each call is priced at its own model (b4af256). |

Also:
- On a standard, a director numbering the melody its own way ("@tune 5") no longer logs 77 repairs, and is told those bars are fixed (e4de2bc, 87b7b50).
- An accent written before a note is now read (2008bb8).

## Still weak
- Gemini 2.5 Flash and GPT-5.4 mini still miscount, especially in funk; the squeeze, recount and padding hide most of it. Gemini 3.8 Flash is the clean, cheap choice.
- With 16 bars and 4-bar phrases, the band talk bunches into the first half.
- e4de2bc broke the build for one commit; 87b7b50 fixed it.
