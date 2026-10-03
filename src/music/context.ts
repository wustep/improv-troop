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
