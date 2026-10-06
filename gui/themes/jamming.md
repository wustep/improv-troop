# Jamming

The active theme, “Sketchbook”. Return to the [theme index](../themes.md). The source of truth is the `:root` block in `src/app/globals.css`; this page explains it and records the alternatives that were tried. If the two disagree, the CSS wins.

Jamming is a page in a sketchbook: warm paper, one ink, a handful of coloured pencils, and rough.js line work around every control. The theme uses the shared Graphical vocabulary (`--neutral-*`, `--color-*`, `--size-*`/`--line-*`, `--space-*`, `--radius-*`, `--border-*`, `--shadow-*`, `--motion-*`) with Jamming's own values. **Light mode only:** the drawn artwork (animals, instruments, VexFlow notation) carries its own ink and fur colours, so a dark mode would need the art redrawn, not just new tokens.

## Fonts

The kit's Untitled reference names GT Standard M and Geist Mono. Jamming does not use them. It keeps its own faces, loaded with `next/font/google` in `src/app/layout.tsx`:

| Role | Family | Weights |
| --- | --- | --- |
| `ui`, `editorial` | Patrick Hand (`--font-hand`), fallback `"Comic Sans MS", system-ui, sans-serif` | regular 400 · medium 400 · heavy 700 (synthesized) |
| `brand` | Caveat (`--font-script`), fallback `"Comic Sans MS", cursive` | regular 500 · medium 500 · heavy 700 |
| `data` | `ui-monospace, SFMono-Regular, Menlo, monospace` (debug panel only) | 400 · 500 · 700 |

## Foundations

| Group | Tokens |
| --- | --- |
| Neutrals (paper → ink) | 1 `#fffdf6` · 2 `#f6f0e1` (canvas) · 3 `#efe6d0` · 4 `#e4d9be` · 5 `#c9bea6` · 6 `#9a94a0` · 7 `#5b5666` (muted text) · 8 `#46424f` · 9 `#2c2a35` (ink) · 10 `#1d1b23` |
| Palette | 1 `#c8463c` red (primary action, leader, error) · 2 `#e2a93b` yellow (selection, progress) · 3 `#3b5bab` blue (focus, chord symbols) · 4 `#4f8a3a` green (play) · 5 `#5a4a9e` purple (trades) · 6 `#fff3a8` sticky note |
| Status | success = color-4, warning = color-2, error = color-1 |
| Translucency | 20% by default. Authored: color-2 **40%** (the highlighter), neutral-1 **60%** (paper laid over the page), neutral-9 **8%** (a pencil wash for hover and hairlines) |
| Text steps (size / line) | xxs 11/14 · xs 12/16 · s 14/20 · m 15/22 (body) · l 20/24 (field labels) · xl 26/30 (section headings) · xxl clamp(48–60px)/1 (wordmark). Letter spacing 0 throughout |
| Spacing | zero 0 · xxs 4 · xs 8 · s 12 · m 16 · l 20 · xl 32 · xxl 48 |
| Radius | zero 0 · xs 3 · s 6 · m 9 · l 14 · xl 20 · full |
| Border | none 0 · s 1px · m 1.5px · l 2px, in ink (`--border-default-color` = neutral-9) |
| Shadow (box type) | s `2px 2px 0` ink 12% · m `3px 3px 0` ink 14% · l `4px 5px 0` ink 16%: paper lifted off the page, never blurred |
| Motion | small 140ms `cubic-bezier(0.2, 0.8, 0.2, 1)` · large 260ms `cubic-bezier(0.2, 0.9, 0.3, 1.3)` (a little overshoot for things that pop onto the stage) · popup scale 0.96 · press distance 1px |
| Focus | `2px dashed` color-3, offset 2px |

### Jamming extensions

| Token | Default | Meaning |
| --- | --- | --- |
| `--sketch-roughness` | 1.3 | rough.js roughness for every drawn outline (`src/components/ui/rough.tsx`) |
| `--sketch-bowing` | 1.2 | rough.js bowing |
| `--sketch-hachure-gap` | 4.5 | spacing of hover hatching |

Rough outlines take their stroke widths from `--border-s/m/l` (`RoughStyle.weight`). Artwork keeps the older aliases `--ink`, `--ink-soft`, `--paper` and `--pencil-*`, which now resolve to the tokens above.

## Tailwind bridge

`@theme inline` in `globals.css` maps Tailwind namespaces onto the tokens and clears Tailwind's defaults (`--color-*`, `--text-*`, `--font-*`, `--font-weight-*`, `--radius-*`, `--shadow-*`, `--ease-*`). So `p-m`, `gap-xs`, `text-s` (size + line height + tracking), `font-brand`, `font-heavy`, `rounded-xs`, `ease-small`, `text-ink-soft` and `text-on-accent` resolve to tokens, and stock utilities such as `text-sm` or `bg-white` produce nothing. For a token with no utility, use `bg-(--color-2-transparent)` or `duration-(--motion-duration)`. Tailwind's numeric spacing still works for structural sizes (stage offsets that clear the bunting, `h-14` for the play button, grid tracks).

## Shared roles

| Role | Where | Treatment |
| --- | --- | --- |
| Section heading | `.type-section`: Band talk, Takes, The chart | brand heavy, xl |
| Field label | `.type-label`: panel fields, player names, notes | brand heavy, l |
| Quiet text action | `.text-action`: “peek under the hood”, “fold it up”, “show” | muted text, dotted underline, small motion to ink on hover |
| Pick row / toggle | `.pick` + `data-selected`: takes, instrument picker, debug tabs, invite, mute | hover: neutral-9-transparent wash; selected: color-2-transparent highlighter |
| Rough button | `RoughButton` tones | **plain**: hover is a color-2 hatch, selected is a color-2-transparent wash under a border-l outline (no hatch lines through the label). **primary / go**: solid color-1 / color-4 wash, on-accent label, border-l. **quiet**: neutral washes |
| Pinned paper | `.director-card`, `.sticky-note`, `.bubble` | neutral-1 or color-6 fill, edge as `--border-shadow-m` (box-shadow, no native border), shadow-s/m |
| Underlined field | `.sketch-select`, `.sketch-input` | inset bottom edge in ink at border-m; focus turns it into a color-3 border-l |

## Conversion record

| Before | After | Status |
| --- | --- | --- |
| `--paper`, `--ink`, `--ink-soft`, `--pencil-*` literals | neutrals 2/9/7 and color-1…5; old names kept as artwork aliases | mapped |
| `rgba(226,169,59,.15–.55)` hovers and selections in five components | `.pick` hover (pencil wash) and selected (highlighter); selection is an explicit `data-selected`, so a muted player (`aria-pressed`) doesn't look selected | mapped |
| `rgba(44,42,53,.06–.45)` dividers, panels, hovers | neutral-9-transparent, `.rule-top`, neutral-5/6 | mapped |
| `text-[15px]`, `text-[13px]`, `text-sm/lg/xl/2xl/3xl/5xl/6xl`, `leading-*` | the seven text steps. Band talk, Takes and The chart were 20/20/30px; all are now the xl section heading | mapped |
| Tailwind numeric spacing on component padding and gaps | named spacing (`p-m`, `gap-xs`, …); 2px/6px/10px insets rounded onto the scale | mapped |
| Native `border` on bubble, director card, sticky note, form strip, inputs, slider thumb, progress bar | composed box-shadow edges with `border: 0` | mapped |
| Hatched red/green primary buttons with white labels | solid washes under the rough outline: the label passes contrast | mapped (deliberate change) |
| `duration-100/300`, `260ms ease`, bubble 220ms overshoot | small / large motion tokens | mapped |
| Dark debug-tab pill | `.pick` highlighter, consistent with every other selection | mapped |
| Animal, instrument and notation colours (`src/art/**`, `instruments.ts`, `sheet/render.ts`) | unchanged | intentional exception: artwork and stable per-animal encodings |
| Form-strip section colours | `color-mix` of palette tokens; encoding unchanged (head yellow, solo blue, trade purple, intro/vamp green, tag red) | mapped (domain encoding preserved) |
| Bar dividers in the form strip | 1px **dotted** native border in neutral-5 | intentional exception: a dotted line can't be drawn with box-shadow |
| Playhead and score-highlight smoothing (`120ms ease`) in `SheetMusic.tsx` | unchanged | intentional exception: follows the audio clock, not UI motion |
| `/art-lab`, `/sheet-lab`, `/audio-lab` test benches | only the utilities the theme reset removed were remapped | out of scope |

## Configurations

Three configurations were compared against the same tokens. Each one only overrides `:root` values; no component code changes. To try one, paste its block after the `:root` block in `globals.css`.

### Sketchbook (default)

Medium-loose line work (roughness 1.3), standard density, a highlighter for selection, a small overshoot on stage pop-ins. Chosen because its line quality matches the animal drawings: the controls look drawn by the same hand as the band. It's also the closest to the app as it was, so the conversion refines the page rather than redecorating it.

### Fair copy (alternative)

A tidier, denser notebook: nearly straight lines, thinner strokes, tighter spacing, quicker motion with no overshoot. It reads as more of a tool and fits more controls above the fold. It wasn't chosen because the near-ruled boxes sit awkwardly next to the loose, crayon-shaded animals.

```css
:root {
  --sketch-roughness: 0.55;
  --sketch-bowing: 0.4;
  --sketch-hachure-gap: 5.5;
  --border-m: 1.25px;
  --border-l: 1.75px;
  --space-xxs: 3px;
  --space-xs: 6px;
  --space-s: 10px;
  --space-m: 14px;
  --space-l: 18px;
  --space-xl: 28px;
  --radius-l: 10px;
  --radius-xl: 14px;
  --shadow-s: 1px 1px 0 0 color-mix(in srgb, var(--neutral-9) 10%, transparent);
  --shadow-m: 2px 2px 0 0 color-mix(in srgb, var(--neutral-9) 12%, transparent);
  --motion-duration: 110ms;
  --motion-large-duration: 200ms;
  --motion-large-easing: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

### Crayon box (alternative)

Looser and warmer: chunky double strokes, roomier spacing, slightly warmer pencils and paper, red-tinted shadows, bouncier pop-ins. It's playful and feels made for kids. It wasn't chosen because the heavier outlines compete with the artwork, and the roomier panel wraps chip rows (“32 bars” drops to its own line at desktop width).

```css
:root {
  --sketch-roughness: 2;
  --sketch-bowing: 1.8;
  --sketch-hachure-gap: 3.5;
  --border-m: 1.8px;
  --border-l: 2.5px;
  --neutral-2: #f8eedb;
  --neutral-3: #f1e3c8;
  --color-1: #d0644f;
  --color-2: #eab54c;
  --color-3: #4f6fb8;
  --color-4: #5f9a48;
  --color-5: #7360b0;
  --space-xs: 10px;
  --space-s: 14px;
  --space-m: 20px;
  --space-l: 24px;
  --space-xl: 36px;
  --radius-l: 18px;
  --radius-xl: 24px;
  --shadow-s: 3px 3px 0 0 color-mix(in srgb, var(--color-1) 18%, transparent);
  --shadow-m: 4px 4px 0 0 color-mix(in srgb, var(--color-1) 18%, transparent);
  --motion-large-duration: 320ms;
  --motion-large-easing: cubic-bezier(0.3, 1.5, 0.4, 1);
}
```
