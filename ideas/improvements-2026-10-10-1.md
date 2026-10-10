# Improvements, 2026-10-10: a real Anthropic key, three-beat grooves, director's rounds

Starting from 49cf3fb (364 tests). First session with a real Anthropic key: `ANTHROPIC_API_KEY` in `.env.local`, used only on the server, always with `IMPROV_TROOP_SERVER_KEY` and `AI_GATEWAY_API_KEY` blanked on the command line. The key never went into the browser, a log, or a screenshot. Total real spend about **$2.02** at list price (1.47M input and 107k output tokens over ~685 calls, almost all Haiku 4.5), against a $3 cap.

## Part A: the direct Claude path, end to end

**Server key only** (`next dev` with both gateway keys blank):

- `GET /api/llm` reports `serverKey: false, serverAnthropicKey: true`; the UI says "This server lends the band an Anthropic key for Claude models."
- All nine Claude models in the picker answer straight from Anthropic under their dashed ids (`claude-sonnet-5-5`, `claude-fable-5-1`, …). Fable 5 used up a 10-token test budget thinking before it answered; with the app's real budgets that's fine.
- Structured output works on Haiku 4.5 and Sonnet 5.5 (`structured: true`).
- GPT and Gemini are disabled in both pickers (13 options). A GPT model left over in saved settings stops the run before any call, with "GPT-5.4 mini needs an AI Gateway key… pick a Claude model". The route returns the same message as a 400.
- A 16-bar Improviser jam with Haiku leading and playing: 16 calls, 39,491 tokens, 37 s, about $0.05.

**Browser key, no server keys.** As instructed, the real key stayed server-side; the browser path was checked with a fake key:

- The field is a password input. The key is saved in `localStorage` (`improv-troop:v1`) and sent in each `/api/llm` POST body as `anthropicKey`, with `key: ""` (a body field, not a header, and never in the URL).
- An obviously fake `sk-ant-…` key got a real 401 from Anthropic in 242 ms, with no retry. The message read "Anthropic rejected your Anthropic key — check it in “Brains & sounds”", with a "check the key" link. Neither the console nor the dev server log contained the key.
- "clear" removes it from storage and the field, re-enables the GPT/Gemini options, clears the stale error, and the button falls back to "Sketch a new take" plus "add an AI key".
- No key anywhere: the route answers 401 "Add an AI Gateway or Anthropic key in “Brains & sounds” to let the band think."
- Route tests already covered a browser key going to Anthropic (`x-api-key`, dashed id) and a 401 that doesn't echo the key. Added: a visitor's Anthropic key wins over a server gateway key for Claude.
- Worth knowing: Playwright's accessibility snapshot prints a password field's value in plain text. Never automate a real key into that field.

**Bug fixed (92ca0ad).** A key problem read "✗ The band lost the thread: Rusty couldn't call the tune: Anthropic rejected your Anthropic key …", and a GPT model blocked up front also read as "the band lost the thread". Key problems now show their own message (`runErrorText` in `src/ai/keys.ts`, tested); other failures keep the lead-in.

## Part B: three-beat grooves (b657be3)

The eval now counts, per take, how many accompanying bars (bass and chordal, not featured) the models wrote out as notes, and how many came in short (looped to the barline, padded, gap kept in a beat), at half or a quarter of the bar (repeated), or long (squeezed). `EVAL_SEEDS` runs several seeds.

On Haiku the "three-beat" groove is real but smaller than with Gemini 2.5 Flash. Long bars were the bigger problem. The two causes, read from the raw strings:

- notes counted instead of beats: `D3/4 Db3/8 C3/8 D3/4` (four notes, three beats), `Bb3/4 r/4 G3/8 F3/8`
- funk comma groups holding two beats (`Bb2/8 r/8 Bb3/8 r/8` as one "beat"), or a 3-beat groove written twice in one bar

Improviser, Haiku 4.5 for everyone, funk/bossa/swing/pop × seeds 11 and 12 (8 takes each):

| | bars written | miscounted | short | half | long | $ / take |
|---|---|---|---|---|---|---|
| before | 168 | 42 (25.0%) | 12 | 2 | 28 | 0.066 |
| a "count beats, not notes" hint | 142 | 28 (19.7%) | 17 | 2 | 9 | 0.066 |
| **count first** (kept) | 150 | 25 (16.7%) | 10 | 0 | 15 | 0.071 |

The hint traded long bars for short ones (Haiku copied the example atoms), so it wasn't kept. What shipped: an accompanying bassist or comper fills in a `count` for each bar ahead of its notes, the beats of every note and rest summed ("1 + ½ + ½ + 1 + 1 = 4"). The JSON schema puts `count` before `bars`, so the sum is written first.

Paired by style and seed, 5 of 8 takes improved, 2 were level and 1 got slightly worse. Outside funk the rate fell from 14.8% to 6.1%, and short plus half-bar grooves fell from 14 to 10. Funk's 16th grooves are still miscounted about half the time: Haiku copies the example sum instead of computing one ("¼ ¼ ¼ ¼ + ½ ½ + 1 = 4", which is 3). Gemini 2.5 Flash, where the issue was first seen, wasn't re-measured; that needs a gateway key.

## Part C: director's rounds

Ranked plan after Parts A and B, each item measured before deciding:

1. **The first sound waits on three model rounds in a row.** This is what everyone hears first. (Round 2)
2. **No idea what a jam costs** when it's your own key. (Round 1)
3. ~~A groove written twice in one bar gets squeezed~~: measured at 5 of 140 squeezed bars (3.6%). Not worth a special repair.
4. ~~A directive and notes in one cell~~ (`@comp sparse, r/4 […]`): 8 of 1,392 cells, already played as written. Left alone.
5. ~~The bandmates' replies hold up the first phrase~~: on a closer look they run alongside the leader's head (2.0 s against 2.4 s), so there was little to gain.

### Round 1: what a take cost (08acc72)

Each model carries its list price from the gateway catalog (checked 2026-10-10). The debug panel's run summary adds "≈ $0.05" next to the tokens, hidden when no tokens were reported (the mock). The eval uses the same prices; its old table had Sonnet 5.5 at $3/$15 and Opus 5.5 at $5/$25, where the catalog says $2/$10 and $4/$20. The README gives measured costs: a 16-bar Improviser take on Haiku is about 23 calls, $0.06–0.08; a Composer take about $0.03.

### Round 2: the band writes the opening phrase while the leader does (871dcf1)

With the default Sonnet 5.5 leader, the first phrase was ready after the count-off (6.0 s), then the leader's head (2.4 s), then the band answering it (3.3 s). The opening phrase is an intro or the head, the motif the leader just counted off, so the band now starts at the count-off, listening to the head as the motif lays it out. It still settles after the leader's bars and the replies are in. Later phrases are unchanged: the band hears each solo before answering.

Same config, swing, seed 11: first phrase ready 2.9 s after the count-off instead of 5.7 s (7.6 s from the click instead of 11.7 s), with no failed calls and a similar share of bars written by the models (42 vs 46 of 64). The mock jam in the browser plays as before.

## Commits

- 92ca0ad A key problem says what to fix, without "the band lost the thread"
- b657be3 Bass and comping add up each bar's beats before writing it
- 08acc72 The debug panel says roughly what a take cost
- 871dcf1 The band writes the opening phrase while the leader does: first sound sooner

374 tests, up from 364.

## Should production get `ANTHROPIC_API_KEY`?

Not as things stand. The route has no per-visitor limit, and a lent key serves every Claude model in the picker, including Fable 5.1 at $10/$50 per million tokens. A default jam is $0.06–0.08, but a visitor picking Fable or Opus for both pickers could spend 5–10× that per take, and a script could drain a $40 key in an afternoon. If a public demo is the goal, do these first:

1. restrict the server's key to Haiku 4.5 (and maybe Sonnet 5.5 for the leader)
2. put a monthly spend limit on that key's workspace in the Anthropic Console
3. ideally, add a per-IP daily cap in the route

Then a lent key is a reasonable way to let people hear the band without bringing a key.

## Still rough

- Funk 16th grooves: about half of Haiku's written-out funk bass and comping bars still miscount. They're repaired (squeezed or looped), not written right.
- Gemini 2.5 Flash's three-beat grooves weren't re-measured after the count-first change.
- The first sound still waits on the count-off itself (4.7–6.0 s on Sonnet 5.5 or Haiku), and the app plays nothing meanwhile.
- The cost estimate is list price; cached input and the provider's own billing aren't modelled.
- From earlier sets: the mix balance (unheard), real-time recording.
