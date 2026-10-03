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
