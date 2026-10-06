import type { Harm } from "../harmony";
import { mod, type Chord } from "../theory";

export type VoicingFamily = "rootless" | "triad" | "open" | "quartal" | "shell";

function rootlessForms(c: Chord): number[][] {
  const alt9 = c.tensions.includes(13) ? 13 : c.tensions.includes(15) ? 15 : 14;
  switch (c.quality) {
    case "maj7":
      return [
        [4, 7, 11, 14],
        [11, 14, 16, 19],
      ];
    case "6":
    case "maj":
      return [
        [4, 7, 9, 14],
        [9, 14, 16, 19],
      ];
    case "min7":
    case "min":
      return [
        [3, 7, 10, 14],
        [10, 14, 15, 19],
      ];
    case "m6":
      return [
        [3, 7, 9, 14],
        [9, 14, 15, 19],
      ];
    case "minMaj7":
      return [[3, 7, 11, 14]];
    case "dom":
      return [
        [4, 9, 10, alt9],
        [10, alt9, 16, 21],
      ];
    case "sus":
      return [
        [5, 7, 10, 14],
        [10, 14, 17, 19],
      ];
    case "m7b5":
      return [
        [3, 6, 10, 12],
        [10, 12, 15, 18],
      ];
    case "dim7":
    case "dim":
      return [[3, 6, 9, 12]];
    case "aug":
      return [[4, 8, 10, 14]];
    case "power":
      return [[0, 7, 12]];
  }
}

/**
 * Open, fourth-based voicings that belong to the chord (a blind stack of perfect 4ths
 * from the 3rd put b6/b9/b5 on a minor 7th). Intervals above the root.
 */
function quartalForms(c: Chord): number[][] {
  switch (c.quality) {
    case "min7":
    case "min":
    case "m6":
    case "minMaj7":
      // "So What": 11 b7 b3 5, and b3 5 b7 9
      return [
        [5, 10, 15, 19],
        [3, 7, 10, 14],
        [10, 14, 17, 19],
      ];
    case "maj7":
    case "maj":
    case "6":
      // 3 6 9 5, and 9 5 1 3 — open and airy, no root-heavy 7th rub
      return [
        [4, 9, 14, 19],
        [2, 7, 12, 16],
        [7, 11, 14, 16],
      ];
    case "sus":
      return [
        [5, 10, 14, 19],
        [0, 5, 10, 14],
      ];
    case "dom":
      return [
        [4, 10, 14, 21],
        [10, 16, 21, 26],
      ];
    case "m7b5":
      return [[0, 6, 10, 15]];
    case "aug":
      return [[4, 8, 10, 14]];
    case "power":
      return [[0, 7, 12, 19]];
    default:
      return rootlessForms(c);
  }
}

function triadTones(c: Chord): number[] {
  return c.tones.slice(0, 3);
}

function candidates(c: Chord, fam: VoicingFamily): number[][] {
  switch (fam) {
    case "rootless":
      return rootlessForms(c);
    case "triad": {
      const t = triadTones(c);
      // three inversions
      return [
        [t[0], t[1], t[2]],
        [t[1], t[2], t[0] + 12],
        [t[2], t[0] + 12, t[1] + 12],
      ];
    }
    case "open": {
      const forms = rootlessForms(c);
      // drop-2 of each rootless form
      return forms.map((f) => {
        const s = [...f].sort((a, b) => a - b);
        if (s.length < 4) return s;
        const dropped = s[2] - 12;
        return [dropped, s[0], s[1], s[3]].sort((a, b) => a - b);
      });
    }
    case "quartal":
      return quartalForms(c);
    case "shell": {
      const third = c.tones[1] ?? 4;
      const seventh = c.tones[3] ?? (c.quality === "maj" ? 9 : 7);
      return [
        [third, seventh, 14],
        [seventh - 12, third, 14 - 12 + 12],
        [third, seventh],
      ];
    }
  }
}

/**
 * A voicing's tensions follow the harmony in context: a V7 headed for a minor chord
 * takes its b9 and b13, a iii chord drops the b9 it can't hold.
 */
function fitTensions(form: number[], c: Chord, harm?: Harm): number[] {
  if (!harm) return form;
  const ok = (iv: number) => harm.stable.includes(mod(c.root + iv, 12));
  const isTone = (iv: number) => c.tones.includes(mod(iv, 12));
  return form.map((iv) => {
    if (ok(iv)) return iv;
    for (const d of [-1, 1]) if (ok(iv + d) && !isTone(iv + d)) return iv + d;
    for (let d = 1; d <= 3; d++) if (isTone(iv - d)) return iv - d;
    return iv;
  });
}

/**
 * Low-interval limits: close intervals turn to mud low in the keyboard (a 2nd under about
 * E3, a 3rd under about C3). The cost of each one that sits too low.
 */
function muddiness(v: number[]): number {
  let cost = 0;
  for (let i = 1; i < v.length; i++) {
    const gap = v[i] - v[i - 1];
    const low = v[i - 1];
    if (gap <= 2 && low < 52) cost += 8 + (52 - low);
    else if (gap <= 4 && low < 46) cost += 6 + (46 - low);
  }
  return cost;
}

/**
 * Pick a voicing for a chord inside [lo, hi] that moves least from `prev`.
 * Returns ascending MIDI pitches.
 */
export function voiceChord(
  c: Chord,
  fam: VoicingFamily,
  lo: number,
  hi: number,
  prev: number[] | null,
  harm?: Harm,
): number[] {
  const center = prev?.length ? prev.reduce((s, p) => s + p, 0) / prev.length : (lo + hi) / 2;
  let best: number[] | null = null;
  let bestScore = Infinity;
  // the asked-for shape first; if it can't fit the room (a comp squeezed under the tune),
  // a closer shape of the same chord rather than a bare triad
  const order: VoicingFamily[] = [fam, ...(["rootless", "shell", "triad"] as VoicingFamily[]).filter((f) => f !== fam)];
  for (const f of order) {
    const forms = candidates(c, f).map((x) => [...new Set(fitTensions(x, c, harm))]);
    for (const form of forms) {
      for (let oct = 1; oct <= 7; oct++) {
        const base = oct * 12 + c.root;
        const v = form.map((i) => base + i).sort((a, b) => a - b);
        if (v[0] < lo || v[v.length - 1] > hi) continue;
        let score = 0;
        if (prev?.length) {
          const n = Math.min(v.length, prev.length);
          for (let i = 0; i < n; i++) score += Math.abs(v[i] - prev[i]);
          score += Math.abs(v.length - prev.length) * 2;
        }
        const mid = v.reduce((s, p) => s + p, 0) / v.length;
        score += Math.abs(mid - center) * 0.5 + Math.abs(mid - (lo + hi) / 2) * 0.25;
        // a fuller voicing wins when it fits (a bare 3rd-and-7th is the fallback, not the sound)
        score += Math.max(0, 3 - v.length) * 3;
        score += muddiness(v);
        if (score < bestScore) {
          bestScore = score;
          best = v;
        }
      }
    }
    if (best) return best;
  }
  // nothing fits: a close triad as high as the room allows, never below it
  const t = triadTones(c);
  let root = hi - mod(hi - c.root, 12);
  while (root + t[t.length - 1] > hi && root - 12 + t[0] >= lo) root -= 12;
  return t.map((i) => root + i).map((p) => (p < lo ? p + 12 : p)).sort((a, b) => a - b);
}

/** Root (or slash bass) of the chord in a bass register near `near`. */
export function bassNote(c: Chord, lo: number, hi: number, near: number | null): number {
  const pc = c.bass;
  let best = lo;
  let bestD = Infinity;
  for (let p = lo; p <= hi; p++) {
    if (mod(p, 12) !== pc) continue;
    const d = near === null ? Math.abs(p - (lo + 7)) : Math.abs(p - near);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
