# Quality pass — Jamming — 2026-10-06 (loop 11, real models)

> First round run against real models through the Vercel AI Gateway (server key from `.env.local`). Each change came from a failure a real model showed, was fixed, re-measured, tested and pushed on its own.
> Starting commit: 38f080c. Ending: 4c8f19c. Tests 293 → 307.

## How it was measured (71ef7e3, 369a0c5)
`pnpm eval:gateway` runs the composer and improviser through the `/api/llm` route on real models and scores each take with the app's own validators: repairs by kind, realize issues, structured-output rate, tokens and a rough cost.
- **Models:** Claude Haiku 4.5, Gemini 2.5 Flash, GPT-5.4 mini, Gemini 3.8 Flash, plus Sonnet 5.5 as director. Styles: swing, funk, bossa, pop, New Orleans, minimal, baroque, ambient, and the F blues standard.
- **Spend:** about $2.50 in total.

## What real models broke, and the fixes
| Finding | Fix |
|---|---|
| Bars of 5–6 beats cut at the barline, losing the landing note (all models) | Squeeze rests, then long notes, keeping every pitch (8ce8e6b). Composer: one recount call with each bar's count (4ad320c). The prompt counts beats out loud (acd16f2). |
| Chord symbols written as notes: `Gm7/4`, `[Cm7 C4 Eb4]`, `Cm2/4`, `[Bb D F A]` | Spelled out: the root for a bassist, the chord's tones for anyone else (8ce8e6b, acd16f2) |
| Haiku's count-off cut off mid-JSON: thinking used up the 1200-token budget | Reasoning gets its own room on top of the budget. A cut-off reply is now logged (acd16f2). |
| Director wrote `@comp` for the pianist's own solo and `@motif` for the horn under it | A by-id table of who is featured in which bars (acd16f2) |
| `"@motif invert \| @line sparse"` for a range; `@head 1` counted from the head | Ranges are split bar by bar, and returning heads keep the code's bar (acd16f2) |
| `@motif D5/8 …`, `Bb1>/16`, `F5/4 >`, `… @end`, half-bar bass riffs | Written parts are played, accents are read, and riffs repeat to fill the bar (6353042) |
| `@end [chord]/1` replaced the band ending | `@end` stays the band's ending (cb6cfa8) |
| Ambient: placeholder drum lanes, `@arco` on upright bass; `D5 /8~` | Placeholder lanes skipped, a bowed bass plays a pedal, and a split duration is joined back to its note (341cec0, 4ad320c) |
| Judge chose "candidate 1" in 10 of 12 takes | Plans are numbered in the order shown and mapped back. The re-run chose by content (d211129). |
| Server key worked in the route, but the UI still played local sketches | `GET /api/llm` reports `serverKey` (never the key) and the UI follows it (816fdcf) |
| Speech cut mid-word; every reply started "Got it—" | Speech is trimmed at a sentence (44ac5c3). Replies are in each player's own voice (4c8f19c). |

## Still weak
- Haiku's structured count-off sometimes returns "No output generated" (once every 2–3 runs). The text fallback recovers, at the cost of one extra call.
- Gemini 2.5 Flash still miscounts funk 16ths, and a recount often misses again. Those bars are squeezed or padded.
- Bandmates talk every phrase and reuse the same words ("pocket", "motif").
- The leader sometimes names chords that aren't in the chart.
- The harness cost estimate uses the player model's price, so a separate director's cost is under-counted.
