import { INSTRUMENTS } from "@/music/instruments";
import type { NoteEvent, Score } from "@/music/types";

// Pure timing helpers. Charts are written on a straight grid; swing is applied here at
// playback time so notation and timing stay independent.

const EPS = 1e-6;

/** Seconds for a span of beats at a tempo (quarter-note bpm). */
export function beatToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

function clampSwing(swing: number): number {
  if (!Number.isFinite(swing)) return 0.5;
  return Math.min(0.75, Math.max(0.5, swing));
}

function isNear(x: number, y: number) {
  return Math.abs(x - y) < 1e-4;
}

/** True when a position inside the beat sits on a triplet/sextuplet grid but not the 16th grid. */
function isTripletPosition(f: number): boolean {
  const onSixth = isNear(f * 6, Math.round(f * 6));
  const onSixteenth = isNear(f * 4, Math.round(f * 4));
  return onSixth && !onSixteenth;
}

/**
 * Map a straight-grid beat position to its swung position.
 *
 * Inside each beat the first half [0, 0.5] stretches to [0, swing] and the second half
 * [0.5, 1] compresses to [swing, 1]. So the offbeat 8th lands at `swing`, 16ths move
 * proportionally, downbeats never move, and triplet positions are left alone.
 * `swing` is the fraction of the beat given to the first 8th (0.5 = straight).
 */
export function applyFeel(start: number, swing: number): number {
  const s = clampSwing(swing);
  if (s <= 0.5 + EPS) return start;
  const beat = Math.floor(start + EPS);
  const f = start - beat;
  if (f < EPS || isNear(f, 1)) return start;
  if (isTripletPosition(f)) return start;
  const swung = f <= 0.5 ? (f / 0.5) * s : s + ((f - 0.5) / 0.5) * (1 - s);
  return beat + swung;
}

/** Inverse of applyFeel (for mapping a heard position back onto the straight grid). */
export function removeFeel(position: number, swing: number): number {
  const s = clampSwing(swing);
  if (s <= 0.5 + EPS) return position;
  const beat = Math.floor(position + EPS);
  const g = position - beat;
  if (g < EPS) return position;
  const straight = g <= s ? (g / s) * 0.5 : 0.5 + ((g - s) / (1 - s)) * 0.5;
  return beat + straight;
}

/** Swung start/end of a note, in beats. Duration is derived from the swung end so legato lines stay legato. */
export function feelSpan(start: number, dur: number, swing: number): { start: number; end: number } {
  const a = applyFeel(start, swing);
  const b = applyFeel(start + Math.max(0, dur), swing);
  return { start: a, end: Math.max(a, b) };
}

/** Deterministic 32-bit hash → [0, 1). Used for repeatable humanisation. */
export function hash01(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = typeof p === "number" ? p.toFixed(4) : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Symmetric deterministic jitter in [-amount, amount]. */
export function jitter(amount: number, ...parts: Array<string | number>): number {
  return (hash01(...parts) * 2 - 1) * amount;
}

// ─── Pocket: where each player sits against the beat ────────────────────────
// A band doesn't play dead on the grid. In swing the bass sits a hair on top of the beat and
// a soloist lays back; in funk the backbeat comes a touch late; baroque and minimalism are
// played straight down the middle. Offsets in seconds, shared by audio and animation so the
// motion still lands with the sound.

type PocketRole = "bass" | "chordal" | "lead" | "support";
const POCKET: Record<string, Partial<Record<PocketRole, number>>> = {
  swing: { bass: -0.006, chordal: 0.006, lead: 0.016, support: 0.008 },
  neworleans: { chordal: 0.004, lead: 0.012, support: 0.006 },
  funk: { bass: -0.002, lead: 0.008 },
  bossa: { chordal: 0.006, lead: 0.014, support: 0.006 },
  ambient: { chordal: 0.01, lead: 0.02, support: 0.012 },
};

/** Seconds a note sits behind (+) or ahead of (−) the grid, for this style and player. */
export function pocketSec(
  style: string,
  fn: "rhythm" | "bass" | "chordal" | "melodic",
  pitch: number,
  art: string | undefined,
  featured: boolean,
  tempo: number,
): number {
  const p = POCKET[style];
  if (!p) return 0;
  // the funk backbeat drags a little; the rest of the kit is the clock
  if (fn === "rhythm") return style === "funk" && pitch === 38 && art !== "ghost" ? 0.012 * tempoScale(tempo) : 0;
  const role: PocketRole = fn === "bass" ? "bass" : featured ? "lead" : fn === "chordal" ? "chordal" : "support";
  return (p[role] ?? 0) * tempoScale(tempo);
}

/** A player's pocket for every note of theirs in a chart (their role can change bar to bar). */
export function pocketOf(score: Score, memberId: string): (n: NoteEvent) => number {
  const m = score.members.find((x) => x.id === memberId);
  const fn = m ? INSTRUMENTS[m.instrument]?.fn : undefined;
  const style = score.frame?.style;
  const beats = score.frame?.meter?.beats || 4;
  if (!fn || !style || !POCKET[style]) return () => 0;
  return (n) => {
    const role = score.plan?.[Math.floor(n.start / beats + 1e-9)]?.roles[memberId];
    const featured = role === "lead" || role === "solo" || role === "trade";
    return pocketSec(style, role === "bass" ? "bass" : fn, n.pitch, n.art, featured, score.frame.tempo);
  };
}

/** Lay-back shrinks at fast tempos (there's less room behind the beat). */
function tempoScale(tempo: number) {
  return Math.min(1.2, Math.max(0.6, 120 / Math.max(40, tempo)));
}

// ─── Tempo map: a ritardando into the ending ────────────────────────────────

export interface TempoMap {
  /** Seconds per beat in tempo. */
  spb: number;
  rit?: { from: number; to: number; slow: number };
}

/** Seconds per beat at a beat. */
export function spbAt(m: TempoMap, beat: number): number {
  const r = m.rit;
  if (!r || beat <= r.from) return m.spb;
  const x = Math.min(1, (beat - r.from) / Math.max(1e-6, r.to - r.from));
  return m.spb * (1 + (r.slow - 1) * x);
}

/** Seconds from beat 0 to `beat` (negative beats, the count-in, are in tempo). */
export function secAt(m: TempoMap, beat: number): number {
  const r = m.rit;
  if (!r || beat <= r.from) return beat * m.spb;
  const L = Math.max(1e-6, r.to - r.from);
  const k = r.slow - 1;
  const inRit = Math.min(beat, r.to) - r.from;
  let s = r.from * m.spb + m.spb * (inRit + (k * inRit * inRit) / (2 * L));
  if (beat > r.to) s += (beat - r.to) * m.spb * r.slow;
  return s;
}

/** The beat at `sec` seconds from beat 0 (inverse of secAt). */
export function beatAt(m: TempoMap, sec: number): number {
  const r = m.rit;
  if (!r || sec <= r.from * m.spb) return sec / m.spb;
  const L = Math.max(1e-6, r.to - r.from);
  const k = r.slow - 1;
  const atTo = secAt(m, r.to);
  if (sec >= atTo) return r.to + (sec - atTo) / (m.spb * r.slow);
  // spb·(u + k·u²/2L) = sec − from·spb, solved for u ≥ 0
  const c = sec / m.spb - r.from;
  if (k <= 1e-9) return r.from + c;
  const a = k / (2 * L);
  return r.from + (-1 + Math.sqrt(1 + 4 * a * c)) / (2 * a);
}
