# Jamming

A band of hand-drawn animals that improvise music together. Pick the players, hand them instruments, choose a style (or a standard), and press play. Every movement on stage follows the notes actually being played.

Live: https://jamming-wustep.vercel.app

## How it works

- **Locked frame.** Code decides the length, form, chord changes, and who leads or solos, before any model is involved. Planners only fill in what happens inside that frame.
- **Shared motif.** The leader states a short cell. Solos are transforms of it (inverted, sequenced, displaced, fragmented), and everyone else comps in the style's texture.
- **The tune comes back.** A repeated A section and the out head replay what the leader played the first time, over the same changes, whether the engine or a model wrote it.
- **Phrases, and a band that listens.** Lines are planned a phrase at a time: a pickup, a direction, a landing on a chord tone, a breath. Harmony is read in context (the key, and where each chord is going). After the notes are written, the band checks itself: held notes belong to the chord they ring over, comping sits under the melody, and pads spell the chord instead of doubling it.
- **Seven styles** are defined by texture priors (what each instrument actually does), not by name: swing, bossa nova, funk, New Orleans, minimalist, baroque, and ambient.
- **Two modes**, using your own [Vercel AI Gateway](https://vercel.com/ai-gateway) key (every model) or [Anthropic API key](https://console.anthropic.com/settings/keys) (Claude models only):
  - **Improviser:** the leader counts off with a motif and a plan. Bandmates reply, then trade phrases. In each round the featured player goes first and the band answers what it heard. Playback starts after the first phrase.
  - **Composer:** a director writes the chart. "Best of 4" drafts four charts and a judge picks the most distinctive. Featured parts are then written note by note.
- **Without a key** the band plays from its own engine, and models are only called when you press the big button.
- **Sound:** sampled instruments via [smplr](https://github.com/danigb/smplr): Salamander Grand piano (with fallbacks) or a Wurlitzer or CP80 electric piano, the Smolken double bass, an acoustic drum kit built from VCSL (or a LinnDrum), the VCSL vibraphone, and MusyngKite soundfonts, including pizzicato strings. Sources and licenses are listed in [docs/SOUNDS.md](docs/SOUNDS.md).
- **Sheet music:** [VexFlow](https://www.vexflow.com/) charts with follow-scroll. The cello switches to tenor clef for high passages, and pizz./arco changes are marked.
- **Under the hood:** the debug panel shows every model call (prompt, raw reply, repairs, timings), the plan, the judge's scores, and instrument loading.

## The band

Bruno (bear), Lily (frog), Hoot (owl), Rusty (fox), Mochi (cat), Clover (rabbit), Tuck (elephant), Pip (penguin) and Olive (sheep). Each has a default instrument, and any of them can play any of the 12 instruments. Olive the cellist plays countermelodies, bowed pads, and pizzicato comping. She takes over the bass line only when the band has no bassist.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:3000  (/art-lab, /sheet-lab, /audio-lab are test benches)
pnpm test
```

In development, the key `mock` (in either key field) answers with a canned band so you can try the model flows offline.

### Keys

The band can think through the Vercel AI Gateway (every model in the pickers) or straight to Anthropic (Claude models only, via `@ai-sdk/anthropic`). Keys come from two places:

- **The browser.** “Brains & sounds” has an *AI Gateway key* field and an *Anthropic API key* field. Each is saved only in that browser's `localStorage`, sent with each model request to `/api/llm` (over HTTPS when deployed), used for that call and dropped. The server never logs or stores it. *clear* next to a field removes it from the browser.
- **The server.** Set in `.env.local` (see [.env.example](.env.example)). Anyone who can reach the server then spends these keys, so leave them unset on a public deployment.
  - `IMPROV_TROOP_SERVER_KEY`: a Vercel AI Gateway key.
  - `ANTHROPIC_API_KEY`: an Anthropic key, for Claude models.

For each call, the first of these that applies is used:

1. the visitor's AI Gateway key, for any model
2. the visitor's Anthropic key, for a Claude model
3. the server's `IMPROV_TROOP_SERVER_KEY`, for any model
4. the server's `ANTHROPIC_API_KEY`, for a Claude model

So a visitor's own key always beats one the server lends, and at the same level the gateway beats a direct Anthropic key. With only Anthropic keys, GPT and Gemini models are greyed out in the pickers, and a run that still names one stops before calling anything, with a message saying to pick a Claude model. A rejected key is reported as the visitor's or the server's, by provider. The route never falls back to ambient credentials such as Vercel OIDC.

### Real-model runs

`pnpm eval:gateway` plays the composer and improviser on real models through the same route and scores each take with the app's own validators (repairs by kind, realize issues, structured-output rate, tokens, a rough cost). It uses the server keys above (`IMPROV_TROOP_SERVER_KEY`, or `ANTHROPIC_API_KEY` for Claude models) and spends credits, so it isn't part of `pnpm test`.

```bash
EVAL_MODELS=google/gemini-3.8-flash,anthropic/claude-haiku-4.5 \
EVAL_STYLES=swing,funk EVAL_MODES=composer EVAL_OUT=/tmp/takes pnpm eval:gateway
# also: EVAL_DIRECTOR (a separate director model), EVAL_STANDARD, EVAL_BARS, EVAL_SEED
```
