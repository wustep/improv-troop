// Note expansion: absolute-beat NoteEvents → per-bar notation tokens.
// Pure and DOM-free so it can be unit tested and run before VexFlow loads.

import type { KeySig, NoteEvent } from "../music/types";
import { DRUM } from "../music/instruments";
import { keyPrefersFlats, mod, pcOf } from "../music/theory";

/** Ticks per beat. 12 = lcm(16th grid = 3, 8th-triplet grid = 4). */
export const TPB = 12;

export type VexDur = "w" | "h" | "q" | "8" | "16";

export interface Token {
  kind: "note" | "rest";
  /** Start in ticks relative to the bar. */
  start: number;
  /** Real (sounding) length in ticks. */
  ticks: number;
  dur: VexDur;
  dots: 0 | 1;
  /** Part of an 8th-note-triplet beat (3:2). */
  triplet: boolean;
  /** Beat index inside the bar (for tuplet grouping). */
  beat: number;
  /** Written MIDI pitches, ascending (empty for rests). */
  pitches: number[];
  /** Tie every pitch into the next token of this stream. */
  tieNext: boolean;
  /** Continuation of a tie from the previous token. */
  tiedFrom: boolean;
  /** Whole-bar rest (drawn centred, any meter). */
  fullBar?: boolean;
  art?: NoteEvent["art"];
}

export interface BarTokens {
  bar: number;
  tokens: Token[];
}

export interface ExpandOptions {
  bars: number;
  beatsPerBar: number;
  /** Semitones added to every pitch (notation shift). Ignored for drums. */
  shift?: number;
  /**
   * Drum notation: a hit is written as lasting until the next hit (within its beat), the way
   * drum parts are read, instead of as a 16th note followed by rests.
   */
  percussion?: boolean;
}

const TICKS_TO_DUR: Record<number, [VexDur, 0 | 1]> = {
  48: ["w", 0],
  36: ["h", 1],
  24: ["h", 0],
  18: ["q", 1],
  12: ["q", 0],
  9: ["8", 1],
  6: ["8", 0],
  3: ["16", 0],
};

const EPS = 1e-6;

interface Group {
  start: number;
  end: number;
  pitches: Set<number>;
  art?: NoteEvent["art"];
}

/**
 * Which beats (absolute index) want an 8th-triplet grid. Onsets vote; note ends only
 * count in beats with no interior onsets (a triplet quarter followed by a rest).
 */
function findTripletBeats(onsets: number[], ends: number[]): Set<number> {
  const trip = new Map<number, number>();
  const bin = new Map<number, number>();
  const classify = (t: number): "trip" | "bin" | "edge" => {
    const b = Math.floor(t + EPS);
    const f = t - b;
    const d16 = Math.abs(f * 4 - Math.round(f * 4)) / 4;
    const d3 = Math.abs(f * 3 - Math.round(f * 3)) / 3;
    const r3 = Math.round(f * 3);
    if (r3 > 0 && r3 < 3 && d3 < 0.06 && d3 + 0.01 < d16) return "trip";
    const r4 = Math.round(f * 4);
    return r4 > 0 && r4 < 4 ? "bin" : "edge";
  };
  for (const t of onsets) {
    const b = Math.floor(t + EPS);
    const c = classify(t);
    if (c === "trip") trip.set(b, (trip.get(b) ?? 0) + 1);
    else if (c === "bin") bin.set(b, (bin.get(b) ?? 0) + 1);
  }
  const out = new Set<number>();
  for (const [b, n] of trip) if (n > (bin.get(b) ?? 0)) out.add(b);
  for (const t of ends) {
    const b = Math.floor(t + EPS);
    if (out.has(b) || trip.has(b) || bin.has(b)) continue;
    if (classify(t) === "trip") out.add(b);
  }
  return out;
}

function quantize(t: number, triplets: Set<number>): number {
  const b = Math.floor(t + EPS);
  const unit = triplets.has(b) ? 4 : 3;
  return Math.round((t * TPB) / unit) * unit;
}

/**
 * Expand one notation stream (a single stave voice) into bar tokens.
 * Simultaneous onsets merge into chords; a chord lasts min(longest note, next onset).
 */
export function expandPart(notes: NoteEvent[], opts: ExpandOptions): BarTokens[] {
  const { bars, beatsPerBar } = opts;
  const shift = opts.shift ?? 0;
  const barTicks = beatsPerBar * TPB;
  const total = bars * barTicks;
  const totalBeats = bars * beatsPerBar;

  const live = notes.filter(
    (n) =>
      Number.isFinite(n.start) &&
      Number.isFinite(n.dur) &&
      Number.isFinite(n.pitch) &&
      n.start < totalBeats - EPS &&
      n.start + Math.max(n.dur, 0) > -EPS,
  );

  const triplets = findTripletBeats(
    live.map((n) => Math.max(0, n.start)),
    live.map((n) => Math.min(totalBeats, n.start + Math.max(n.dur, 0))),
  );

  // Group by quantised onset.
  const groups = new Map<number, Group>();
  for (const n of live) {
    let s = quantize(Math.max(0, n.start), triplets);
    let e = quantize(Math.min(totalBeats, n.start + Math.max(n.dur, 0)), triplets);
    if (s >= total) continue;
    if (e <= s) {
      const unit = triplets.has(Math.floor(s / TPB)) ? 4 : 3;
      e = s + unit;
    }
    e = Math.min(e, total);
    s = Math.max(0, s);
    const g = groups.get(s);
    const p = Math.round(n.pitch + shift);
    if (g) {
      g.pitches.add(p);
      g.end = Math.max(g.end, e);
      if (n.art === "accent") g.art = "accent";
    } else {
      groups.set(s, { start: s, end: e, pitches: new Set([p]), art: n.art });
    }
  }

  const onsets = [...groups.values()].sort((a, b) => a.start - b.start);
  if (opts.percussion)
    onsets.forEach((g, i) => {
      const beatEnd = (Math.floor(g.start / TPB) + 1) * TPB;
      g.end = Math.max(g.end, Math.min(onsets[i + 1]?.start ?? total, beatEnd));
    });
  // Segments covering [0, total).
  interface Seg {
    s: number;
    e: number;
    pitches: number[];
    art?: NoteEvent["art"];
  }
  const segs: Seg[] = [];
  let cursor = 0;
  for (let i = 0; i < onsets.length; i++) {
    const g = onsets[i];
    const next = i + 1 < onsets.length ? onsets[i + 1].start : total;
    const end = Math.min(g.end, next, total);
    if (g.start > cursor) segs.push({ s: cursor, e: g.start, pitches: [] });
    if (end > g.start) {
      segs.push({ s: g.start, e: end, pitches: [...g.pitches].sort((a, b) => a - b), art: g.art });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < total) segs.push({ s: cursor, e: total, pitches: [] });

  // Quarter-note triplets: two triplet beats whose boundaries all sit on the 8-tick grid.
  const bounds = new Set<number>();
  for (const sg of segs) bounds.add(sg.s).add(sg.e);
  const qwins = new Set<number>();
  for (let b = 0; b < bars; b++) {
    for (let k = 0; k + 1 < beatsPerBar; k++) {
      const abs = b * beatsPerBar + k;
      if (beatsPerBar === 4 && k % 2 === 1) continue;
      if (!triplets.has(abs) || !triplets.has(abs + 1)) continue;
      const w0 = abs * TPB;
      let ok = true;
      let genuine = false;
      for (const x of bounds) {
        if (x <= w0 || x >= w0 + 2 * TPB) continue;
        if ((x - w0) % 8 !== 0) ok = false;
        else if ((x - w0) % TPB !== 0) genuine = true;
      }
      if (ok && genuine) {
        qwins.add(abs);
        k++; // windows don't overlap
      }
    }
  }

  const out: BarTokens[] = Array.from({ length: bars }, (_, bar) => ({ bar, tokens: [] }));

  for (const seg of segs) {
    const isRest = seg.pitches.length === 0;
    const pieces: Token[] = [];
    let s = seg.s;
    while (s < seg.e) {
      const bar = Math.floor(s / barTicks);
      const barStart = bar * barTicks;
      const e = Math.min(seg.e, barStart + barTicks);
      const local = splitInBar(s - barStart, e - barStart, beatsPerBar, triplets, qwins, bar, isRest);
      for (const t of local) {
        pieces.push({
          kind: isRest ? "rest" : "note",
          start: t.start,
          ticks: t.ticks,
          dur: t.dur,
          dots: t.dots,
          triplet: t.triplet,
          beat: t.group ?? Math.floor(t.start / TPB),
          pitches: seg.pitches,
          tieNext: false,
          tiedFrom: false,
          art: undefined,
        });
        out[bar].tokens.push(pieces[pieces.length - 1]);
      }
      s = e;
    }
    if (!isRest && pieces.length) {
      pieces[0].art = seg.art;
      for (let i = 0; i < pieces.length - 1; i++) {
        pieces[i].tieNext = true;
        pieces[i + 1].tiedFrom = true;
      }
    }
  }

  // Whole-bar rests.
  for (const b of out) {
    if (b.tokens.length > 0 && b.tokens.every((t) => t.kind === "rest")) {
      b.tokens = [
        {
          kind: "rest",
          start: 0,
          ticks: barTicks,
          dur: "w",
          dots: 0,
          triplet: false,
          beat: 0,
          pitches: [],
          tieNext: false,
          tiedFrom: false,
          fullBar: true,
        },
      ];
    }
  }
  return out;
}

interface LocalTok {
  start: number;
  ticks: number;
  dur: VexDur;
  dots: 0 | 1;
  triplet: boolean;
  /** Tuplet group (beat index of the window start) for quarter-note triplets. */
  group?: number;
}

/** Split [s, e) (bar-relative ticks) into notatable values. */
function splitInBar(
  s: number,
  e: number,
  bpb: number,
  triplets: Set<number>,
  qwins: Set<number>,
  bar: number,
  rest: boolean,
): LocalTok[] {
  const out: LocalTok[] = [];
  // Cut at the edges of every triplet beat / window so each tuplet group is self-contained.
  const cuts: number[] = [s];
  const winOf = (k: number) => (qwins.has(bar * bpb + k) ? k : qwins.has(bar * bpb + k - 1) ? k - 1 : -1);
  for (let k = 0; k < bpb; k++) {
    if (!triplets.has(bar * bpb + k)) continue;
    const w = winOf(k);
    const edges = w >= 0 ? [w * TPB, (w + 2) * TPB] : [k * TPB, (k + 1) * TPB];
    for (const c of edges) if (c > s && c < e) cuts.push(c);
  }
  cuts.push(e);
  const uniq = [...new Set(cuts)].sort((a, b) => a - b);
  for (let i = 0; i < uniq.length - 1; i++) {
    const a = uniq[i];
    const b = uniq[i + 1];
    const beat = Math.floor(a / TPB);
    const w = triplets.has(bar * bpb + beat) ? winOf(beat) : -1;
    if (w >= 0) {
      out.push(...quarterTripletTokens(a, b, w));
    } else if (triplets.has(bar * bpb + beat) && !(a % TPB === 0 && b - a === TPB)) {
      out.push(...tripletTokens(a, b));
    } else {
      out.push(...binaryTokens(a, b, bpb, rest));
    }
  }
  return out;
}

function quarterTripletTokens(s: number, e: number, group: number): LocalTok[] {
  const out: LocalTok[] = [];
  let p = s;
  while (p < e) {
    const r = e - p;
    const d = r >= 16 ? 16 : r >= 8 ? 8 : r;
    out.push({ start: p, ticks: d, dur: d === 16 ? "h" : d === 8 ? "q" : "8", dots: 0, triplet: true, group });
    p += d;
  }
  return out;
}

function tripletTokens(s: number, e: number): LocalTok[] {
  const out: LocalTok[] = [];
  let p = s;
  while (p < e) {
    const r = e - p;
    if (r >= 8) {
      out.push({ start: p, ticks: 8, dur: "q", dots: 0, triplet: true });
      p += 8;
    } else if (r >= 4) {
      out.push({ start: p, ticks: 4, dur: "8", dots: 0, triplet: true });
      p += 4;
    } else {
      // Off-grid leftover (shouldn't happen): absorb as a 16th-ish sliver.
      out.push({ start: p, ticks: r, dur: "16", dots: 0, triplet: false });
      p = e;
    }
  }
  return out;
}

function allowedOnBeat(k: number, bpb: number, rest: boolean): number[] {
  const c: number[] = [];
  if (k === 0 && bpb >= 4 && !rest) c.push(48);
  if (k === 0 && bpb === 4 && rest) c.push(48);
  if (k === 0 && bpb >= 3 && !rest) c.push(36);
  const evenOk = bpb !== 4 || k % 2 === 0;
  if (k + 2 <= bpb && evenOk) {
    c.push(24);
    if (!rest) c.push(18);
  }
  c.push(12);
  return c;
}

function binaryTokens(s0: number, e: number, bpb: number, rest: boolean): LocalTok[] {
  const out: LocalTok[] = [];
  const push = (start: number, ticks: number) => {
    const d = TICKS_TO_DUR[ticks];
    if (d) out.push({ start, ticks, dur: d[0], dots: d[1], triplet: false });
    else out.push({ start, ticks, dur: "16", dots: 0, triplet: false });
  };
  let s = s0;
  while (s < e) {
    const pos = s % TPB;
    if (pos !== 0) {
      const segEnd = Math.min(e, s - pos + TPB);
      let p = s;
      while (p < segEnd) {
        const r = segEnd - p;
        const pp = p % TPB;
        let d: number;
        if (!rest && r >= 9 && pp === 3) d = 9;
        else if (r >= 6 && (pp === 0 || pp === 3 || pp === 6)) d = 6;
        else if (r >= 3) d = 3;
        else d = r;
        push(p, d);
        p += d;
      }
      s = segEnd;
      continue;
    }
    const r = e - s;
    if (r < TPB) {
      let d: number;
      if (!rest && r >= 9) d = 9;
      else if (r >= 6) d = 6;
      else if (r >= 3) d = 3;
      else d = r;
      push(s, d);
      s += d;
      continue;
    }
    const k = s / TPB;
    const d = allowedOnBeat(k, bpb, rest).find((c) => c <= r) ?? TPB;
    push(s, d);
    s += d;
  }
  return out;
}

// ─── Spelling ────────────────────────────────────────────────────────────────

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

export interface Spelled {
  /** VexFlow key, e.g. "bb/4". */
  key: string;
  letter: string;
  alter: number;
  octave: number;
}

/** Map of pitch class → spelled name for a key (diatonic + sensible chromatic choices). */
export function spellingTable(key: KeySig): { letter: number; alter: number }[] {
  const tonicPc = pcOf(key.tonic);
  const tonicLetter = Math.max(0, LETTERS.indexOf(key.tonic.trim().charAt(0).toUpperCase()));
  const steps = key.mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const table: ({ letter: number; alter: number } | null)[] = Array(12).fill(null);
  const diatonic: { letter: number; pc: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const letter = (tonicLetter + i) % 7;
    const pc = mod(tonicPc + steps[i], 12);
    let alter = pc - LETTER_PC[letter];
    if (alter > 6) alter -= 12;
    if (alter < -6) alter += 12;
    table[pc] = { letter, alter };
    diatonic.push({ letter, pc });
  }
  const flats = keyPrefersFlats(key);
  for (let pc = 0; pc < 12; pc++) {
    if (table[pc]) continue;
    const off = mod(pc - tonicPc, 12);
    const below = diatonic.find((d) => d.pc === mod(pc - 1, 12));
    const above = diatonic.find((d) => d.pc === mod(pc + 1, 12));
    // Minor: raised 3/6/7 and #4 are sharps, b2 is flat.
    // Major: #4 sharp, blue notes (b3, b6, b7) flat, b2/#1 follows the key's flavour.
    let useSharp = key.mode === "minor" ? [4, 6, 9, 11].includes(off) : off === 6 || (off === 1 && !flats);
    if (!below) useSharp = false;
    if (!above) useSharp = true;
    const ref = useSharp ? below! : above!;
    const letter = ref.letter;
    let alter = pc - LETTER_PC[letter];
    if (alter > 6) alter -= 12;
    if (alter < -6) alter += 12;
    table[pc] = { letter, alter };
  }
  return table as { letter: number; alter: number }[];
}

export function spell(midi: number, table: { letter: number; alter: number }[]): Spelled {
  const { letter, alter } = table[mod(midi, 12)];
  const octave = Math.floor((midi - alter) / 12) - 1;
  const acc = alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
  return { key: `${LETTERS[letter].toLowerCase()}${acc}/${octave}`, letter: LETTERS[letter], alter, octave };
}

/** VexFlow key-signature spec for a KeySig ("Bb", "Gm", "F#"...). */
export function keySpec(key: KeySig): string {
  const pc = pcOf(key.tonic);
  const flats = keyPrefersFlats(key);
  if (key.mode === "minor") {
    const names = ["Cm", flats ? "Dbm" : "C#m", "Dm", flats ? "Ebm" : "D#m", "Em", "Fm", "F#m", "Gm", flats ? "Abm" : "G#m", "Am", flats ? "Bbm" : "A#m", "Bm"];
    const n = names[Number.isFinite(pc) ? pc : 0];
    // VexFlow lacks Dbm; fall back to enharmonic.
    return n === "Dbm" ? "C#m" : n;
  }
  const names = ["C", flats ? "Db" : "C#", "D", flats ? "Eb" : "D#", "E", "F", flats ? "Gb" : "F#", "G", flats ? "Ab" : "G#", "A", flats ? "Bb" : "A#", "B"];
  const n = names[Number.isFinite(pc) ? pc : 0];
  return n === "D#" ? "Eb" : n === "G#" ? "Ab" : n === "A#" ? "Bb" : n;
}

// ─── Drums ───────────────────────────────────────────────────────────────────

/** Percussion-clef position (treble-equivalent) and notehead for a GM drum number. */
export function drumKey(pitch: number): string {
  switch (pitch) {
    case 35:
    case DRUM.kick:
      return "f/4";
    case DRUM.snare:
    case 40:
      return "c/5";
    case DRUM.stick:
      return "c/5/x";
    case DRUM.clap:
      return "c/5/x";
    case DRUM.hatClosed:
      return "g/5/x";
    case DRUM.hatOpen:
      return "g/5/cx";
    case DRUM.hatPedal:
      return "d/4/x";
    case DRUM.ride:
    case 59:
      return "f/5/x";
    case DRUM.rideBell:
      return "f/5/d";
    case DRUM.crash:
    case 57:
      return "a/5/x";
    case DRUM.highTom:
    case 48:
      return "e/5";
    case DRUM.midTom:
    case DRUM.lowTom:
      return "d/5";
    case DRUM.floorTom:
    case 41:
      return "a/4";
    case DRUM.tambourine:
    case DRUM.shaker:
    case 69:
      return "b/5/x";
    case DRUM.cowbell:
      return "b/5/tu";
    case DRUM.congaHi:
    case 62:
      return "e/4";
    case DRUM.congaLo:
      return "d/4";
    default:
      return "b/5/x";
  }
}

/** Order drum keys bottom-to-top so VexFlow is happy with chord layout. */
export function drumKeys(pitches: number[]): string[] {
  const order = "cdefgab";
  const keys = [...new Set(pitches.map(drumKey))];
  const val = (k: string) => {
    const [l, o] = k.split("/");
    return parseInt(o, 10) * 7 + order.indexOf(l.charAt(0));
  };
  return keys.sort((a, b) => val(a) - val(b));
}

// ─── Chord symbols ───────────────────────────────────────────────────────────

export interface ChordText {
  root: string;
  /** Normal-size quality right after the root ("m"). */
  main: string;
  /** Superscript extensions ("7", "Δ7", "ø7", "7(♭9)"). */
  sup: string;
  bass: string;
}

const pretty = (s: string) => s.replace(/b/g, "♭").replace(/#/g, "♯");

export function chordText(symbol: string): ChordText {
  const m = /^\s*([A-Ga-g])([#b]?)(.*?)(?:\/([A-Ga-g][#b]?))?\s*$/.exec(symbol);
  if (!m) return { root: symbol, main: "", sup: "", bass: "" };
  const root = m[1].toUpperCase() + pretty(m[2]);
  let q = m[3] ?? "";
  const bass = m[4] ? m[4].charAt(0).toUpperCase() + pretty(m[4].slice(1)) : "";
  let main = "";
  let sup = "";
  if (/^(m7b5|m7-5|ø)/.test(q)) {
    sup = "ø7" + pretty(q.replace(/^(m7b5|m7-5|ø7?)/, ""));
  } else if (/^(dim7|o7|°7)/.test(q)) {
    sup = "°7" + pretty(q.replace(/^(dim7|o7|°7)/, ""));
  } else if (/^(dim|o|°)/.test(q)) {
    sup = "°" + pretty(q.replace(/^(dim|o|°)/, ""));
  } else if (/^(maj|Maj|MA|M(?=7|9|13)|Δ)/.test(q)) {
    sup = "Δ" + pretty(q.replace(/^(maj|Maj|MA|M|Δ)/, ""));
  } else if (/^(m|min|-)(?!aj)/.test(q)) {
    main = "m";
    q = q.replace(/^(min|m|-)/, "");
    sup = pretty(q.replace(/^maj/, "Δ"));
  } else if (/^(aug|\+)/.test(q)) {
    main = "+";
    sup = pretty(q.replace(/^(aug|\+)/, ""));
  } else {
    sup = pretty(q);
  }
  sup = sup.replace(/\((.*)\)/, "($1)");
  return { root, main, sup, bass };
}
