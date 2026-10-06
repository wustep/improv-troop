// Reharmonization with each style's taste. A free chart's tune comes from a short list of
// progressions, so takes kept landing on the same changes, and every solo chorus repeated
// them exactly. Here the tune gets a light touch (so each take has its own changes) and solo
// choruses get freer as they go, the way a rhythm section opens a tune up. The out head is
// copied from the tune, so the melody comes back over its own changes.

import type { Rng } from "./rng";
import { keyPrefersFlats, mod, parseChord, pcName, pcOf } from "./theory";
import type { KeySig, StyleId } from "./types";

interface Taste {
  /** Split a bar-long dominant into its ii–V. */
  iiV: number;
  /** A dominant resolving down a fifth becomes the dominant a tritone away. */
  tritone: number;
  /** A minor chord resolving down a fifth becomes a dominant (vi7 → VI7). */
  secondary: number;
  /** A tonic bar walking up to ii passes through #I diminished. */
  passingDim: number;
  /** Extensions the style colors chords with. */
  color: number;
}

const TASTE: Partial<Record<StyleId, Taste>> = {
  swing: { iiV: 0.6, tritone: 0.45, secondary: 0.5, passingDim: 0.4, color: 0.5 },
  bossa: { iiV: 0.5, tritone: 0.4, secondary: 0.2, passingDim: 0, color: 0.8 },
  funk: { iiV: 0, tritone: 0, secondary: 0, passingDim: 0, color: 0.7 },
  neworleans: { iiV: 0, tritone: 0, secondary: 0.6, passingDim: 0.5, color: 0.3 },
  baroque: { iiV: 0, tritone: 0, secondary: 0.4, passingDim: 0, color: 0 },
};

type Sym = { root: number; q: string; text: string };

function info(text: string): Sym {
  const c = parseChord(text);
  return { root: c.root, q: c.quality, text };
}

const isDom = (s: Sym) => s.q === "dom";
const isMinor = (s: Sym) => s.q === "min7" || s.q === "min" || s.q === "m6";

/** The style's color for a chord (a 9th, a 13th, a ♭9 into minor), or the chord unchanged. */
function colorOf(style: StyleId, s: Sym, next: Sym | null, flats: boolean): string {
  const r = pcName(s.root, flats);
  const intoMinor = !!next && isMinor(next) && mod(next.root - s.root, 12) === 5;
  if (style === "bossa") {
    if (s.q === "maj7") return `${r}maj9`;
    if (s.q === "min7") return `${r}m9`;
    if (isDom(s)) return intoMinor ? `${r}7b9` : `${r}13`;
  }
  if (style === "funk") {
    if (isDom(s)) return `${r}9`;
    if (s.q === "min7") return `${r}m9`;
  }
  if (style === "swing") {
    if (s.q === "maj7") return `${r}6`;
    if (isDom(s) && intoMinor) return `${r}7b9`;
    if (isDom(s)) return `${r}13`;
  }
  if (style === "neworleans" && s.q === "maj") return `${r}6`;
  return s.text;
}

/**
 * Reharmonize bars [from, to) of `bars` (each a space-separated bar of chord symbols), with a
 * strength per bar (0 = leave it, 1 = the style's full appetite). Never touches the bars after
 * `to`; reads them to see where a chord is going.
 */
export function reharmonize(
  bars: string[],
  from: number,
  to: number,
  strength: (bar: number) => number,
  key: KeySig,
  style: StyleId,
  rng: Rng,
): string[] {
  const taste = TASTE[style];
  if (!taste) return bars;
  const flats = keyPrefersFlats(key);
  const orig = bars.map((b) => b.split(/\s+/).filter(Boolean));
  const out = orig.map((b) => [...b]);
  const tonic = mod(pcOf(key.tonic), 12);
  const firstOf = (i: number): Sym | null => (orig[i]?.[0] ? info(orig[i][0]) : null);

  for (let i = from; i < Math.min(to, bars.length); i++) {
    const k = Math.max(0, Math.min(1, strength(i)));
    if (k <= 0) continue;
    const chance = (p: number) => p > 0 && rng.next() < p * k;
    const syms = orig[i].map(info);
    const next = firstOf(i + 1);
    const prevLast = orig[i - 1]?.length ? info(orig[i - 1][orig[i - 1].length - 1]) : null;
    let bar = [...orig[i]];

    if (syms.length === 1) {
      const s = syms[0];
      const resolves = !!next && mod(next.root - s.root, 12) === 5;
      // a bar of V7 → its ii and the V (unless the ii was just played)
      if (isDom(s) && resolves && !(prevLast && mod(prevLast.root - s.root, 12) === 7) && chance(taste.iiV)) {
        const ii = pcName(mod(s.root + 7, 12), flats) + (next && isMinor(next) ? "m7b5" : "m7");
        bar = [ii, s.text];
      } else if (isMinor(s) && resolves && s.root !== tonic && chance(taste.secondary)) {
        // vi7 → VI7, iii7 → III7: a secondary dominant pulling into the next chord
        bar = [`${pcName(s.root, flats)}7`];
      } else if ((s.q === "maj7" || s.q === "maj" || s.q === "6") && s.root === tonic && next && isMinor(next) && mod(next.root - s.root, 12) === 2 && chance(taste.passingDim)) {
        // I → #Idim7 → ii: the bass walks up a half step at a time
        bar = [s.text, `${pcName(mod(s.root + 1, 12), flats)}dim7`];
      }
    }
    // the dominant at the end of the bar → its tritone substitute, sliding down into the next chord
    const lastSym = info(bar[bar.length - 1]);
    if (isDom(lastSym) && next && mod(next.root - lastSym.root, 12) === 5 && chance(taste.tritone)) {
      bar[bar.length - 1] = `${pcName(mod(lastSym.root + 6, 12), flats)}7`;
    }
    // colors
    bar = bar.map((t, j) => {
      const s = info(t);
      const after = j + 1 < bar.length ? info(bar[j + 1]) : next;
      return chance(taste.color) ? colorOf(style, s, after, flats) : t;
    });
    out[i] = bar;
  }
  return out.map((b) => b.join(" "));
}
