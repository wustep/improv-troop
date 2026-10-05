import { mod, parseChord, pcOf, type Chord } from "./theory";
import type { ChordChange, KeySig, StyleId } from "./types";

// What every note in a bar is allowed to be, decided once per chart from the chords in
// context: the key, where each chord is going, and the style. A generic chord-scale per
// quality gets the common cases wrong (B natural in a D-minor baroque bass, a natural 13
// on a V7 that resolves to a minor chord, the tonic blues scale over a secondary dominant).

export interface Harm {
  chord: Chord;
  /** Absolute span in beats: [start, end). */
  start: number;
  end: number;
  /** Chord-scale pitch classes in context. */
  scale: number[];
  /** Chord tones. */
  tones: number[];
  /** 3rd and 7th (the notes that say what the chord is). */
  guides: number[];
  /** Tensions that can be held over this chord in this style (9ths, 11 on minor, #11, 13...). */
  colors: number[];
  /** Chord tones plus colors: safe on a strong beat or held. */
  stable: number[];
  /** Avoid notes: scale tones a half step above a chord tone (the 4th over a major 3rd, a b9 over the root). Passing only, never held. */
  avoid: number[];
  /** Blue notes this style can bend through over this chord (short notes, or the held #9 on a dominant). */
  blue: number[];
}

const JAZZ: StyleId[] = ["swing", "bossa", "funk", "neworleans"];
const BLUESY: StyleId[] = ["swing", "funk", "neworleans"];
const MINORISH = new Set(["min", "min7", "m6", "minMaj7", "m7b5", "dim", "dim7"]);

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const PHRYG_DOM = [0, 1, 4, 5, 7, 8, 10];
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10];
const MEL_MINOR = [0, 2, 3, 5, 7, 9, 11];

/** The chord's scale (intervals above its root) given the key, the next chord and the style. */
export function contextScale(c: Chord, next: Chord | null, key: KeySig, style: StyleId): number[] {
  // a symbol that spells its own colour (G7b9, C7alt, Fmaj7#11) is taken at its word
  const suffix = c.symbol.replace(/^[A-Ga-g][#b]?/, "").replace(/m7b5|m7-5/, "");
  if (/alt|b9|#9|#11|b13|#5|\+/.test(suffix)) return c.scale;

  const tonic = pcOf(key.tonic);
  const keyPcs = (key.mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : IONIAN).map((i) => mod(tonic + i, 12));
  const inKey = (iv: number) => keyPcs.includes(mod(c.root + iv, 12));
  const pick = (opts: number[], fallback: number) => opts.find(inKey) ?? fallback;
  const toFourthUp = !!next && mod(next.root - c.root, 12) === 5 && next.symbol !== c.symbol;
  const nextMinor = !!next && MINORISH.has(next.quality);
  const jazz = JAZZ.includes(style);

  switch (c.quality) {
    case "dom":
      // a dominant resolving to a minor chord borrows that chord's key: b9 and b13
      if (toFourthUp && nextMinor) return PHRYG_DOM;
      return MIXO;
    case "min7":
    case "min": {
      if (toFourthUp && next?.quality === "dom") return DORIAN; // ii–V
      if (jazz && c.quality === "min7") return inKey(1) && !inKey(2) ? PHRYGIAN : DORIAN;
      // everywhere else the key decides (aeolian on i, dorian on iv in minor, phrygian on iii)
      return [0, pick([2, 1], 2), 3, 5, 7, pick([9, 8], 9), 10];
    }
    case "m7b5":
      return LOCRIAN;
    case "maj7":
    case "maj":
    case "6": {
      // the key decides ionian vs lydian (IV), and for a plain triad, the 7th (bVII in minor is mixolydian)
      const fourth = pick([5, 6], 5);
      const seventh = c.quality === "maj" ? pick([11, 10], 11) : 11;
      return [0, 2, 4, fourth, 7, 9, seventh];
    }
    case "sus":
      return MIXO;
    case "m6":
    case "minMaj7":
      return MEL_MINOR;
    case "power":
      return inKey(3) ? DORIAN : MIXO;
    default:
      return c.scale;
  }
}

/** Tensions that can be held over the chord: what a pianist would put in the voicing. */
function colorsFor(c: Chord, scale: number[], style: StyleId): number[] {
  // counterpoint holds only chord tones; everything else is a passing or suspended note
  if (style === "baroque") return [];
  const has = (iv: number) => scale.includes(iv);
  const out: number[] = [];
  switch (c.quality) {
    case "maj7":
    case "6":
    case "maj":
      if (has(2)) out.push(2);
      if (has(6)) out.push(6); // lydian #11
      if (has(9)) out.push(9);
      break;
    case "dom":
      if (has(2)) out.push(2);
      if (has(1) && JAZZ.includes(style)) out.push(1);
      if (has(9)) out.push(9);
      if (has(8) && JAZZ.includes(style)) out.push(8);
      if (has(6)) out.push(6);
      break;
    case "min7":
    case "min":
    case "m6":
    case "minMaj7":
      if (has(2)) out.push(2);
      out.push(5);
      if (has(9) && JAZZ.includes(style) && c.quality !== "min") out.push(9);
      break;
    case "m7b5":
      out.push(5, 8);
      break;
    case "sus":
      out.push(2, 9);
      break;
    case "dim7":
    case "dim":
      out.push(2, 5, 8, 11);
      break;
  }
  return out;
}

function blueFor(c: Chord, style: StyleId): number[] {
  if (!BLUESY.includes(style)) return [];
  const major3 = c.tones.includes(4);
  if (c.quality === "dom" || (major3 && style === "neworleans")) return [3, 6].map((i) => mod(c.root + i, 12));
  if (c.quality === "min7" || c.quality === "min") return [6].map((i) => mod(c.root + i, 12));
  return [];
}

export function harmFor(c: Chord, next: Chord | null, key: KeySig, style: StyleId, start: number, end: number): Harm {
  const scaleIv = contextScale(c, next, key, style);
  const at = (ivs: number[]) => [...new Set(ivs.map((i) => mod(c.root + i, 12)))];
  const tones = at(c.tones);
  const third = c.tones.find((t) => t === 3 || t === 4 || t === 5) ?? 4;
  const seventh = c.tones.find((t) => t === 9 || t === 10 || t === 11);
  const guides = at(seventh !== undefined ? [third, seventh] : [third, 7]);
  const colors = at(colorsFor(c, scaleIv, style)).filter((pc) => !tones.includes(pc));
  const scale = [...new Set([...at(scaleIv), ...tones])].sort((a, b) => a - b);
  const stable = [...tones, ...colors];
  const avoid = scale.filter((pc) => !stable.includes(pc) && tones.some((t) => mod(pc - t, 12) === 1));
  return { chord: c, start, end, scale, tones, guides, colors, stable, avoid, blue: blueFor(c, style).filter((pc) => !tones.includes(pc)) };
}

/** Every chord span of a chart, in order, with lookups by absolute beat. */
export interface Harmony {
  spans: Harm[];
  beats: number;
  at(abs: number): Harm;
}

const cache = new Map<string, Harmony>();

export function buildHarmony(chords: ChordChange[][], beats: number, key: KeySig, style: StyleId): Harmony {
  const sig = `${key.tonic}${key.mode}|${style}|${beats}|${chords.map((b) => b.map((c) => `${c.beat}:${c.symbol}`).join(",")).join("|")}`;
  const hit = cache.get(sig);
  if (hit) return hit;
  const flat: { start: number; chord: Chord }[] = [];
  chords.forEach((bar, i) => {
    for (const c of bar) flat.push({ start: i * beats + c.beat, chord: parseChord(c.symbol) });
  });
  const total = chords.length * beats;
  const spans = flat.map((x, i) => {
    const next = flat[i + 1]?.chord ?? null;
    return harmFor(x.chord, next, key, style, x.start, flat[i + 1]?.start ?? total);
  });
  const byBar: number[] = [];
  let j = 0;
  for (let b = 0; b < chords.length; b++) {
    while (j + 1 < spans.length && spans[j + 1].start <= b * beats + 1e-6) j++;
    byBar.push(j);
  }
  const at = (abs: number): Harm => {
    if (!spans.length) return harmFor(parseChord("C"), null, key, style, 0, total);
    const bar = Math.max(0, Math.min(chords.length - 1, Math.floor(abs / beats + 1e-9)));
    let k = byBar[bar] ?? 0;
    while (k + 1 < spans.length && spans[k + 1].start <= abs + 1e-6) k++;
    while (k > 0 && spans[k].start > abs + 1e-6) k--;
    return spans[k];
  };
  const h: Harmony = { spans, beats, at };
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  cache.set(sig, h);
  return h;
}

// ─── Pitch choices against a Harm ────────────────────────────────────────────

/** Nearest pitch to `p` whose class is in pcs; `dir` breaks ties (and prefers that side within `reach`). */
export function nearestIn(p: number, pcs: number[], dir: 1 | -1 | 0 = 0, reach = 2): number {
  if (!pcs.length) return p;
  if (dir !== 0) {
    for (let d = 0; d <= reach; d++) if (pcs.includes(mod(p + dir * d, 12))) return p + dir * d;
  }
  for (let d = 0; d < 12; d++) {
    const down = pcs.includes(mod(p - d, 12));
    const up = pcs.includes(mod(p + d, 12));
    if (down && up) return dir > 0 ? p + d : p - d;
    if (down) return p - d;
    if (up) return p + d;
  }
  return p;
}

/** Step `n` scale degrees from p along pcs (p is snapped first). */
export function stepIn(p: number, n: number, pcs: number[]): number {
  let cur = nearestIn(p, pcs);
  const dir = Math.sign(n);
  for (let i = 0; i < Math.abs(n); i++) {
    cur += dir;
    let guard = 0;
    while (!pcs.includes(mod(cur, 12)) && guard++ < 12) cur += dir;
  }
  return cur;
}

/** Number of scale steps between two pitches (signed), counting along pcs. */
export function stepsBetween(a: number, b: number, pcs: number[]): number {
  if (a === b) return 0;
  const dir = b > a ? 1 : -1;
  let n = 0;
  for (let p = a + dir; dir > 0 ? p <= b : p >= b; p += dir) if (pcs.includes(mod(p, 12))) n++;
  return n * dir;
}

/** Is this pitch class safe to hold over the harm (chord tone, color, or the blues #9 on a dominant)? */
export function holdable(h: Harm, pc: number, style: StyleId): boolean {
  if (h.stable.includes(pc)) return true;
  return BLUESY.includes(style) && h.chord.quality === "dom" && pc === mod(h.chord.root + 3, 12);
}

/** Shift a group of notes by whole octaves so it sits in [lo, hi] (closest to `near` when given). */
export function fitOctave<T extends { pitch: number }>(notes: T[], lo: number, hi: number, near?: number | null): T[] {
  if (!notes.length) return notes;
  const ps = notes.map((n) => n.pitch);
  const min = Math.min(...ps);
  const max = Math.max(...ps);
  const mid = (min + max) / 2;
  let best = 0;
  let bestCost = Infinity;
  for (let k = -4; k <= 4; k++) {
    const s = k * 12;
    const out = Math.max(0, lo - (min + s)) + Math.max(0, max + s - hi);
    const ref = near ?? (lo + hi) / 2;
    const cost = out * 10 + Math.abs(mid + s - ref) * 0.5 + (near !== undefined && near !== null ? Math.abs(ps[0] + s - near) * 0.5 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = s;
    }
  }
  return notes.map((n) => {
    let p = n.pitch + best;
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    return { ...n, pitch: p };
  });
}
