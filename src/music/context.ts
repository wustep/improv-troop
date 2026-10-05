import type { Harm, Harmony } from "./harmony";
import type { InstrumentDef } from "./instruments";
import type { Rng } from "./rng";
import type { StyleDef } from "./styles";
import { parseChord, type Chord } from "./theory";
import type { Dynamic, KeySig, Member, Motif, NoteEvent, Role, Section, Texture } from "./types";

/** Mutable per-player memory so lines and voicings connect across bars. */
export interface PlayerMemory {
  lastPitch: number | null;
  lastVoicing: number[] | null;
  /** Beats played since the last real rest (for breathing). */
  sinceRest: number;
  direction: 1 | -1;
  arpCell: number[] | null;
  arpChangedAt: number;
  riff: NoteEvent[] | null;
  lastGuide: number | null;
  /** The phrase being played (absolute starts) and the beat where it and its breath end. */
  phrase: { notes: NoteEvent[]; until: number; bar: number } | null;
  /** Rhythm of the last phrase (onsets relative to its start), for answering it. */
  lastRhythm: { start: number; dur: number; pitch?: number }[] | null;
  /** Contour of the last phrase, so the next one can answer in the other direction. */
  lastShape: string | null;
  /** Density tier of the last phrase (an answer matches the call's density). */
  lastTier: number | null;
}

export function newMemory(): PlayerMemory {
  return {
    lastPitch: null,
    lastVoicing: null,
    sinceRest: 0,
    direction: 1,
    arpCell: null,
    arpChangedAt: -99,
    riff: null,
    lastGuide: null,
    phrase: null,
    lastRhythm: null,
    lastShape: null,
    lastTier: null,
  };
}

export interface BarCtx {
  bar: number;
  beats: number;
  /** Absolute start beat of this bar. */
  start: number;
  chords: { beat: number; chord: Chord }[];
  next: Chord;
  prev: Chord;
  key: KeySig;
  keyPcs: number[];
  style: StyleDef;
  section: Section;
  barInSection: number;
  phraseEnd: boolean;
  sectionStart: boolean;
  sectionEnd: boolean;
  firstBar: boolean;
  lastBar: boolean;
  dynamic: Dynamic;
  energy: number;
  texture: Texture;
  role: Role;
  member: Member;
  inst: InstrumentDef;
  rng: Rng;
  mem: PlayerMemory;
  motif: Motif;
  /** Featured player's notes in this bar (relative to bar start). */
  featured: NoteEvent[];
  /** Featured notes of the previous two bars, relative to this bar's start (negative starts). */
  featuredPrev: NoteEvent[];
  hasBass: boolean;
  hasDrums: boolean;
  hasChordal: boolean;
  args: string[];
  /** Take-level seed (stable across bars). */
  seed: number;
  /** The chart's harmony in context. */
  harmony: Harmony;
  /** Absolute beat where this player's current run of improvised-line bars ends (phrases stop there). */
  runEnd: number;
  /** Among players given the same directive this bar: which one this is, and how many (split voices, interlock). */
  peerIndex: number;
  peerCount: number;
  /** What the featured player played in an earlier bar (relative to that bar), for replaying the head. */
  playedIn(bar: number): NoteEvent[] | null;
}

/** Context harmony at a beat inside the bar. */
export function harmAt(ctx: BarCtx, beat: number): Harm {
  return ctx.harmony.at(ctx.start + beat);
}

export function chordAt(ctx: BarCtx, beat: number): Chord {
  let c = ctx.chords[0]?.chord ?? parseChord("C");
  for (const x of ctx.chords) if (x.beat <= beat + 1e-6) c = x.chord;
  return c;
}

/** Spans of each chord in the bar: [start, end). */
export function chordSpans(ctx: BarCtx): { start: number; end: number; chord: Chord }[] {
  return ctx.chords.map((c, i) => ({
    start: c.beat,
    end: ctx.chords[i + 1]?.beat ?? ctx.beats,
    chord: c.chord,
  }));
}

export const DYNAMIC_ENERGY: Record<Dynamic, number> = {
  pp: 0.15,
  p: 0.3,
  mp: 0.45,
  mf: 0.6,
  f: 0.78,
  ff: 0.95,
};

export function velFor(ctx: BarCtx, base = 0.75): number {
  return Math.max(0.12, Math.min(1, base * (0.55 + ctx.energy * 0.6)));
}
