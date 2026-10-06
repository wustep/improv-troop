// How each style ends a tune. Everything used to end the same way: a loud chord held under a
// cymbal roll. A funk band stops dead on the one, bossa slows and fades, a baroque piece
// broadens into its final cadence.

import type { Dynamic, Frame, Score, StyleId } from "./types";

export type EndingKind =
  /** A held final chord, cymbal roll swelling under it (a big band ending). */
  | "ring"
  /** Everyone hits the downbeat together, short, and stops. */
  | "button"
  /** Soft, the final chord left to ring away. */
  | "fade"
  /** A broad final cadence: the last chord held, no cymbals. */
  | "cadence";

export interface Ending {
  kind: EndingKind;
  /** Ritardando: how much slower the last beat before the final chord is (1 = in tempo)... */
  slow: number;
  /** ...over this many bars before the final bar. */
  ritBars: number;
}

export const ENDINGS: Record<StyleId, Ending> = {
  swing: { kind: "ring", slow: 1.12, ritBars: 1 },
  neworleans: { kind: "ring", slow: 1.1, ritBars: 1 },
  funk: { kind: "button", slow: 1, ritBars: 0 },
  bossa: { kind: "fade", slow: 1.18, ritBars: 2 },
  minimal: { kind: "button", slow: 1, ritBars: 0 },
  baroque: { kind: "cadence", slow: 1.35, ritBars: 2 },
  ambient: { kind: "fade", slow: 1.25, ritBars: 2 },
};

/** The ritardando into a chart's final bar, in beats, or undefined when it stays in tempo. */
export function ritFor(frame: Frame): Score["rit"] {
  const e = ENDINGS[frame.style];
  if (!e || e.slow <= 1 || e.ritBars <= 0 || frame.bars < e.ritBars + 2) return undefined;
  const beats = frame.meter.beats;
  const to = (frame.bars - 1) * beats;
  return { from: to - e.ritBars * beats, to, slow: e.slow };
}

const LOUDNESS: Dynamic[] = ["pp", "p", "mp", "mf", "f", "ff"];

/**
 * A dynamic the style allows, whoever planned it (the engine or a model): bossa nova never
 * gets past mezzo-forte, and a fading ending is soft.
 */
export function styleDynamic(style: StyleId, d: Dynamic, lastBar: boolean): Dynamic {
  if (lastBar && ENDINGS[style]?.kind === "fade") return LOUDNESS.indexOf(d) < LOUDNESS.indexOf("p") ? d : "p";
  if (style === "bossa" && LOUDNESS.indexOf(d) > LOUDNESS.indexOf("mf")) return "mf";
  return d;
}
