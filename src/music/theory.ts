import type { KeySig } from "./types";

// ─── Pitch names ─────────────────────────────────────────────────────────────

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

/** "Bb" -> 10, "F#" -> 6. Returns NaN for junk. */
export function pcOf(name: string): number {
  const m = /^([A-Ga-g])([#b]*)/.exec(name.trim());
  if (!m) return NaN;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === "#" ? 1 : -1;
  return mod(pc, 12);
}

/** "C4" -> 60, "Bb3" -> 58, "F#5" -> 78. Returns null for junk. */
export function parsePitch(s: string): number | null {
  const m = /^([A-Ga-g])([#b]{0,2})(-?\d)$/.exec(s.trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === "#" ? 1 : -1;
  const oct = parseInt(m[3], 10);
  return (oct + 1) * 12 + pc;
}

/** Does this key prefer flats when spelling accidentals? */
export function keyPrefersFlats(key: KeySig | string): boolean {
  const tonic = typeof key === "string" ? key : key.tonic;
  const minor = typeof key === "string" ? false : key.mode === "minor";
  const pc = pcOf(tonic);
  // Relative major decides.
  const majorPc = minor ? mod(pc + 3, 12) : pc;
  if (tonic.includes("b")) return true;
  if (tonic.includes("#")) return false;
  // F, Bb, Eb, Ab, Db, Gb majors use flats
  return [5, 10, 3, 8, 1, 6].includes(majorPc);
}

export function pitchName(midi: number, flats = false): string {
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[mod(midi, 12)]}${Math.floor(midi / 12) - 1}`;
}

export function pcName(pc: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod(pc, 12)];
}

// ─── Scales ──────────────────────────────────────────────────────────────────

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  altered: [0, 1, 3, 4, 6, 8, 10],
  halfWhole: [0, 1, 3, 4, 6, 7, 9, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  bebopDominant: [0, 2, 4, 5, 7, 9, 10, 11],
  blues: [0, 3, 5, 6, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  lydianDominant: [0, 2, 4, 6, 7, 9, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

export function keyScale(key: KeySig): number[] {
  const root = pcOf(key.tonic);
  const s = key.mode === "minor" ? SCALES.aeolian : SCALES.major;
  return s.map((i) => mod(root + i, 12));
}

// ─── Chords ──────────────────────────────────────────────────────────────────

export type ChordQuality =
  | "maj"
  | "min"
  | "dom"
  | "maj7"
  | "min7"
  | "m7b5"
  | "dim"
  | "dim7"
  | "aug"
  | "sus"
  | "minMaj7"
  | "6"
  | "m6"
  | "power";

export interface Chord {
  symbol: string;
  root: number; // pc
  bass: number; // pc (slash chords)
  quality: ChordQuality;
  /** Intervals above root of the core chord tones (root, 3rd, 5th, 7th...). */
  tones: number[];
  /** Tensions (9, 11, 13, alterations) as intervals above root. */
  tensions: number[];
  /** A sensible chord-scale (intervals above root). */
  scale: number[];
}

const chordCache = new Map<string, Chord>();

/**
 * Parse a lead-sheet chord symbol. Tolerant: unknown suffixes degrade to the nearest
 * triad/seventh rather than failing.
 */
export function parseChord(symbol: string): Chord {
  const key = symbol.trim();
  const cached = chordCache.get(key);
  if (cached) return cached;

  const m = /^([A-Ga-g][#b]?)(.*?)(?:\/([A-Ga-g][#b]?))?$/.exec(key);
  if (!m) {
    const c = parseChord("C");
    chordCache.set(key, c);
    return c;
  }
  const root = pcOf(m[1]);
  const bass = m[3] ? pcOf(m[3]) : root;
  const q = m[2]
    .replace(/Δ/g, "maj")
    .replace(/ø/g, "m7b5")
    .replace(/°/g, "dim")
    .replace(/–/g, "m")
    .replace(/^-/, "m")
    .replace(/min/g, "m")
    .replace(/Maj|MA|M(?=7|9|13)/g, "maj")
    .replace(/[()]/g, "");

  let quality: ChordQuality = "maj";
  let tones: number[] = [0, 4, 7];
  let scale: number[] = [...SCALES.major];
  const tensions: number[] = [];

  const has = (s: string) => q.includes(s);
  if (/^m7b5|^m7-5|^half/.test(q)) {
    quality = "m7b5";
    tones = [0, 3, 6, 10];
    scale = [...SCALES.locrian];
  } else if (/^dim7|^o7/.test(q)) {
    quality = "dim7";
    tones = [0, 3, 6, 9];
    scale = [0, 2, 3, 5, 6, 8, 9, 11];
  } else if (/^dim|^o/.test(q)) {
    quality = "dim";
    tones = [0, 3, 6];
    scale = [0, 2, 3, 5, 6, 8, 9, 11];
  } else if (/^mmaj7|^mmaj|^m\/maj/.test(q)) {
    quality = "minMaj7";
    tones = [0, 3, 7, 11];
    scale = [...SCALES.melodicMinor];
  } else if (/^m6/.test(q)) {
    quality = "m6";
    tones = [0, 3, 7, 9];
    scale = [...SCALES.dorian];
  } else if (/^m(?!aj)/.test(q)) {
    if (/^m(7|9|11|13)/.test(q)) {
      quality = "min7";
      tones = [0, 3, 7, 10];
    } else {
      quality = "min";
      tones = [0, 3, 7];
    }
    scale = [...SCALES.dorian];
    if (has("9")) tensions.push(14);
    if (has("11")) tensions.push(17);
  } else if (/^maj/.test(q)) {
    quality = "maj7";
    tones = [0, 4, 7, 11];
    scale = has("#11") ? [...SCALES.lydian] : [...SCALES.major];
    if (has("9") || has("13")) tensions.push(14);
    if (has("#11")) tensions.push(18);
  } else if (/^aug|^\+/.test(q)) {
    quality = "aug";
    tones = has("7") ? [0, 4, 8, 10] : [0, 4, 8];
    scale = [...SCALES.wholeTone];
  } else if (/^sus|^7sus|^9sus|^13sus/.test(q)) {
    quality = "sus";
    tones = has("7") || has("9") || has("13") ? [0, 5, 7, 10] : [0, 5, 7];
    scale = [...SCALES.mixolydian];
  } else if (/^6|^69/.test(q)) {
    quality = "6";
    tones = [0, 4, 7, 9];
    scale = [...SCALES.major];
  } else if (/^5$/.test(q)) {
    quality = "power";
    tones = [0, 7];
    scale = [...SCALES.mixolydian];
  } else if (/^(7|9|11|13)/.test(q)) {
    quality = "dom";
    tones = [0, 4, 7, 10];
    if (has("alt")) {
      scale = [...SCALES.altered];
      tensions.push(13, 15, 20);
    } else if (has("b9") || has("#9")) {
      scale = [...SCALES.halfWhole];
      if (has("b9")) tensions.push(13);
      if (has("#9")) tensions.push(15);
    } else if (has("#11")) {
      scale = [...SCALES.lydianDominant];
      tensions.push(18);
    } else if (has("b13")) {
      scale = [...SCALES.phrygianDominant];
      tensions.push(20);
    } else {
      scale = [...SCALES.mixolydian];
      if (has("9") || has("13")) tensions.push(14);
      if (has("13")) tensions.push(21);
    }
    if (has("sus")) {
      quality = "sus";
      tones = [0, 5, 7, 10];
    }
  } else if (has("sus")) {
    quality = "sus";
    tones = [0, 5, 7];
    scale = [...SCALES.mixolydian];
  } else if (has("add9") || has("2")) {
    tensions.push(14);
  }

  const chord: Chord = { symbol: key, root, bass, quality, tones, tensions, scale };
  chordCache.set(key, chord);
  return chord;
}

export function chordPcs(c: Chord): number[] {
  return c.tones.map((t) => mod(c.root + t, 12));
}

export function scalePcs(c: Chord): number[] {
  return c.scale.map((t) => mod(c.root + t, 12));
}

/** Guide tones: 3rd and 7th (or 6th / 5th fallback). */
export function guideTonePcs(c: Chord): number[] {
  const third = c.tones.find((t) => t === 3 || t === 4 || t === 5) ?? 4;
  const seventh = c.tones.find((t) => t === 9 || t === 10 || t === 11) ?? 7;
  return [mod(c.root + third, 12), mod(c.root + seventh, 12)];
}

// ─── Pitch helpers ───────────────────────────────────────────────────────────

/** Nearest MIDI pitch with the given pitch class to `near`. */
export function nearestPc(pc: number, near: number): number {
  const base = near - mod(near - pc, 12);
  const up = base + 12;
  return near - base <= up - near ? base : up;
}

/** All MIDI pitches in [lo, hi] whose pitch class is in pcs. */
export function pitchesIn(pcs: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) if (pcs.includes(mod(p, 12))) out.push(p);
  return out;
}

/** Snap a pitch to the nearest member of pcs (ties go down). */
export function snapToPcs(p: number, pcs: number[]): number {
  if (pcs.includes(mod(p, 12))) return p;
  for (let d = 1; d < 12; d++) {
    if (pcs.includes(mod(p - d, 12))) return p - d;
    if (pcs.includes(mod(p + d, 12))) return p + d;
  }
  return p;
}

/** Move into [lo, hi] by octaves. */
export function fold(p: number, lo: number, hi: number): number {
  let x = p;
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  if (x < lo) x = lo; // range narrower than an octave
  return x;
}

/** Step `steps` positions along a scale (list of pcs) from pitch p (p snapped first). */
export function scaleStep(p: number, steps: number, pcs: number[]): number {
  let cur = snapToPcs(p, pcs);
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    cur += dir;
    while (!pcs.includes(mod(cur, 12))) cur += dir;
  }
  return cur;
}

/** Diatonic index of a pitch within a scale: (octave*len + degree), snapping if needed. */
export function diatonicIndex(p: number, pcs: number[]): number {
  const sorted = [...pcs].sort((a, b) => a - b);
  const s = snapToPcs(p, sorted);
  const oct = Math.floor(s / 12);
  const deg = sorted.indexOf(mod(s, 12));
  return oct * sorted.length + Math.max(0, deg);
}

export function fromDiatonicIndex(idx: number, pcs: number[]): number {
  const sorted = [...pcs].sort((a, b) => a - b);
  const n = sorted.length;
  const oct = Math.floor(idx / n);
  const deg = mod(idx, n);
  return oct * 12 + sorted[deg];
}

export function transposeChordSymbol(symbol: string, semis: number, flats: boolean): string {
  const m = /^([A-Ga-g][#b]?)(.*?)(?:\/([A-Ga-g][#b]?))?$/.exec(symbol.trim());
  if (!m) return symbol;
  const root = pcName(pcOf(m[1]) + semis, flats);
  const bass = m[3] ? "/" + pcName(pcOf(m[3]) + semis, flats) : "";
  return root + m[2] + bass;
}

/**
 * Roman-numeral-ish degree progression to chord symbols in a key.
 * Tokens like "ii7", "V7", "Imaj7", "vi7", "bVII7", "iv", "V7/ii".
 */
export function romanToChord(token: string, key: KeySig): string {
  const flats = keyPrefersFlats(key);
  const tonic = pcOf(key.tonic);
  const m = /^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/.exec(token);
  if (!m) return token;
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const deg = numerals.indexOf(m[2].toUpperCase());
  const majorSteps = [0, 2, 4, 5, 7, 9, 11];
  const minorSteps = [0, 2, 3, 5, 7, 8, 10];
  // accidentals are relative to the major scale (bIII, bVI, bVII), plain numerals follow the mode
  const steps = m[1] || key.mode !== "minor" ? majorSteps : minorSteps;
  let pc = tonic + steps[deg];
  if (m[1] === "b") pc -= 1;
  if (m[1] === "#") pc += 1;
  const lower = m[2] === m[2].toLowerCase();
  let suffix = m[3];
  if (lower && !suffix.startsWith("m") && !suffix.startsWith("dim") && !suffix.startsWith("ø")) {
    suffix = "m" + suffix;
  }
  if (suffix.startsWith("ø")) suffix = "m7b5" + suffix.slice(1);
  return pcName(pc, flats) + suffix;
}
