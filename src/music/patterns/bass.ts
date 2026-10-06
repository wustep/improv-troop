import { chordAt, chordSpans, harmAt, velFor, type BarCtx } from "../context";
import { diatonicIndex, fold, mod, nearestPc, scaleStep, pcOf, type Chord } from "../theory";
import { hashString } from "../rng";
import type { NoteEvent } from "../types";
import { bassNote } from "./voicing";

function range(ctx: BarCtx): [number, number] {
  // bass register even if a cello/trombone/piano covers it
  const [lo, hi] = ctx.inst.range;
  return [Math.max(lo, 28), Math.min(hi, 52)];
}

const HOME = 38; // around D2: where a walking line feels at home

function root(ctx: BarCtx, c: Chord, near: number | null): number {
  const [lo, hi] = range(ctx);
  const target = near === null ? HOME : Math.round(near * 0.55 + HOME * 0.45);
  return bassNote(c, lo, hi, target);
}

// The chord's own fifth and seventh, from its root and quality (a b5 over m7b5 and dim,
// a major 7th over maj7), never from a slash bass: over G7/B the fifth is still D.
const fifthPc = (c: Chord) => mod(c.root + (c.tones[2] ?? 7), 12);
const seventhPc = (c: Chord) => mod(c.root + (c.tones[3] ?? 10), 12);

/** The nearest pitch of class `pc` above `base`, dropped an octave if it would pass `hi`. */
function above(base: number, pc: number, hi: number): number {
  let p = base + (mod(pc - base, 12) || 12);
  if (p > hi) p -= 12;
  return p;
}

function approach(ctx: BarCtx, from: number, target: number, nextScale: number[]): number {
  const r = ctx.rng.next();
  let p: number;
  if (r < 0.45) p = target + (from > target ? 1 : -1); // chromatic from the side we're coming from
  else if (r < 0.7) p = target + (ctx.rng.chance(0.5) ? 1 : -1);
  else if (r < 0.9) p = target + 7 > range(ctx)[1] ? target - 5 : target + 7; // fifth above/below
  else p = scaleStep(target, from > target ? 1 : -1, nextScale);
  // never sit on the note we're already on: that stalls the walk
  if (p === from) p = target + (from > target ? 1 : -1);
  if (p === from) p = target - (from > target ? 1 : -1);
  return p;
}

/** Swing walking bass: chord tone on 1, scale/chord motion, approach note into the next chord. */
export function walk(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const [lo, hi] = range(ctx);
  let prev = ctx.mem.lastPitch ?? lo + 10;
  const vel = velFor(ctx, 0.78);
  for (let b = 0; b < ctx.beats; b++) {
    const c = chordAt(ctx, b);
    const changeHere = ctx.chords.some((x) => Math.abs(x.beat - b) < 1e-6);
    const lastBeatBeforeChange =
      b === ctx.beats - 1 || ctx.chords.some((x) => Math.abs(x.beat - (b + 1)) < 1e-6);
    let p: number;
    const hm = harmAt(ctx, b);
    if (changeHere) {
      p = root(ctx, c, prev);
      if (b === 0 && !ctx.firstBar && ctx.prev.symbol === c.symbol && ctx.rng.chance(0.35)) {
        // same chord as last bar: start on 3rd or 5th instead
        p = nearestPc(mod(c.root + (ctx.rng.chance(0.5) ? c.tones[1] : c.tones[2]), 12), prev);
      }
    } else if (lastBeatBeforeChange) {
      const nh = ctx.harmony.at(ctx.start + b + 1);
      const target = root(ctx, nh.chord, prev);
      p = approach(ctx, prev, target, nh.scale);
    } else {
      const dir = prev > (lo + hi) / 2 + 5 ? -1 : prev < lo + 5 ? 1 : ctx.mem.direction;
      p = ctx.rng.chance(0.55) ? scaleStep(prev, dir, hm.scale) : nearestPc(ctx.rng.pick(hm.tones), prev + dir * 3);
      if (p === prev) p = scaleStep(prev, dir, hm.scale);
      ctx.mem.direction = dir as 1 | -1;
    }
    p = fold(p, lo, hi);
    const accent = b % 2 === 1 ? 0.06 : 0;
    out.push({ pitch: p, start: b, dur: 1, vel: vel + accent });
    // occasional swung skip note at high energy
    if (ctx.energy > 0.7 && b === 2 && ctx.rng.chance(0.2)) {
      out[out.length - 1].dur = 2 / 3;
      out.push({ pitch: p, start: b + 2 / 3, dur: 1 / 3, vel: vel * 0.55, art: "ghost" });
    }
    prev = p;
  }
  ctx.mem.lastPitch = prev;
  return out;
}

/** Two-feel: root on 1, fifth on 3 (or the second chord), optional pickup. */
export function two(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const [lo, hi] = range(ctx);
  let prev = ctx.mem.lastPitch ?? lo + 8;
  const vel = velFor(ctx, 0.8);
  const spans = chordSpans(ctx);
  const half = ctx.beats === 3 ? 3 : 2;
  for (let b = 0; b < ctx.beats; b += half) {
    const c = chordAt(ctx, b);
    const isChange = spans.some((s) => Math.abs(s.start - b) < 1e-6);
    let p = isChange && b > 0 ? root(ctx, c, prev) : b === 0 ? root(ctx, c, prev) : nearestPc(fifthPc(c), prev);
    p = fold(p, lo, hi);
    const pickup = b + half === ctx.beats && ctx.rng.chance(ctx.style.id === "neworleans" ? 0.55 : 0.3);
    out.push({ pitch: p, start: b, dur: pickup ? half - 0.5 : half, vel });
    if (pickup) {
      const nh = ctx.harmony.at(ctx.start + ctx.beats);
      const target = root(ctx, nh.chord, p);
      out.push({ pitch: fold(approach(ctx, p, target, nh.scale), lo, hi), start: ctx.beats - 0.5, dur: 0.5, vel: vel * 0.8 });
    }
    prev = p;
  }
  ctx.mem.lastPitch = prev;
  return out;
}

/** Bossa: root (dotted quarter) + fifth on &2, anticipating the next chord on &4. */
export function bossa(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const [lo, hi] = range(ctx);
  const prev = ctx.mem.lastPitch ?? lo + 8;
  const vel = velFor(ctx, 0.72);
  if (ctx.beats === 3) {
    const r = root(ctx, chordAt(ctx, 0), prev);
    out.push({ pitch: r, start: 0, dur: 1.5, vel });
    out.push({ pitch: fold(above(r, fifthPc(chordAt(ctx, 0)), hi), lo, hi), start: 1.5, dur: 1.5, vel: vel * 0.85 });
    ctx.mem.lastPitch = r;
    return out;
  }
  const c1 = chordAt(ctx, 0);
  const c2 = chordAt(ctx, 2);
  const r1 = root(ctx, c1, prev);
  const f1 = fold(above(r1, fifthPc(c1), hi), lo, hi);
  const r2 = c2.symbol !== c1.symbol ? root(ctx, c2, r1) : r1;
  const f2 = c2.symbol !== c1.symbol ? fold(above(r2, fifthPc(c2), hi), lo, hi) : f1;
  out.push({ pitch: r1, start: 0, dur: 1.5, vel });
  out.push({ pitch: f1, start: 1.5, dur: 0.5, vel: vel * 0.8 });
  out.push({ pitch: r2, start: 2, dur: 1.5, vel: vel * 0.95 });
  out.push({ pitch: f2, start: 3.5, dur: 0.5, vel: vel * 0.8 });
  ctx.mem.lastPitch = r2;
  return out;
}

const FUNK_TEMPLATES: { pos: number; deg: "R" | "8" | "5" | "b7" | "ap" | "g"; dur: number }[][] = [
  [
    { pos: 0, deg: "R", dur: 0.5 },
    { pos: 0.75, deg: "g", dur: 0.25 },
    { pos: 1.5, deg: "R", dur: 0.25 },
    { pos: 1.75, deg: "8", dur: 0.25 },
    { pos: 2.5, deg: "b7", dur: 0.5 },
    { pos: 3.25, deg: "5", dur: 0.25 },
    { pos: 3.75, deg: "ap", dur: 0.25 },
  ],
  [
    { pos: 0, deg: "R", dur: 0.75 },
    { pos: 1, deg: "g", dur: 0.25 },
    { pos: 1.25, deg: "R", dur: 0.25 },
    { pos: 2, deg: "8", dur: 0.25 },
    { pos: 2.5, deg: "R", dur: 0.25 },
    { pos: 3, deg: "5", dur: 0.5 },
    { pos: 3.5, deg: "b7", dur: 0.5 },
  ],
  [
    { pos: 0, deg: "R", dur: 0.25 },
    { pos: 0.5, deg: "R", dur: 0.25 },
    { pos: 0.75, deg: "8", dur: 0.25 },
    { pos: 1.5, deg: "g", dur: 0.25 },
    { pos: 2.25, deg: "5", dur: 0.25 },
    { pos: 2.75, deg: "b7", dur: 0.25 },
    { pos: 3.5, deg: "ap", dur: 0.5 },
  ],
];

/** Funk: syncopated 16th riff, hard on the one, octave pops and ghosts. */
export function funk(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const [lo, hi] = range(ctx);
  const prev = ctx.mem.lastPitch ?? lo + 6;
  const vel = velFor(ctx, 0.85);
  // keep the same riff through a section (riffs repeat), vary at section starts
  const tIdx = hashString(`${ctx.member.id}:${ctx.section.start}:${ctx.seed}`) % FUNK_TEMPLATES.length;
  const tpl = FUNK_TEMPLATES[tIdx];
  let last = prev;
  for (const n of tpl) {
    if (n.pos >= ctx.beats) continue;
    const c = chordAt(ctx, n.pos);
    const r = root(ctx, c, prev);
    let p = r;
    if (n.deg === "8") p = r + 12 <= hi + 12 ? r + 12 : r;
    if (n.deg === "5") p = fold(above(r, fifthPc(c), hi + 7), lo, hi + 7);
    if (n.deg === "b7") p = fold(above(r, seventhPc(c), hi + 10), lo, hi + 10);
    if (n.deg === "ap") p = root(ctx, ctx.next, r) - 1;
    if (n.deg === "g") p = r;
    out.push({
      pitch: p,
      start: n.pos,
      dur: n.dur,
      vel: n.deg === "g" ? vel * 0.35 : n.pos === 0 ? Math.min(1, vel * 1.15) : vel,
      art: n.deg === "g" ? "ghost" : n.pos === 0 ? "accent" : "staccato",
    });
    last = r;
  }
  ctx.mem.lastPitch = last;
  return out;
}

/**
 * Baroque walking 8ths: each chord starts on its root (or third), then the line
 * travels by step toward the next chord's root and arrives a step away — with the
 * occasional octave leap on a strong 8th to keep it moving, like a continuo bass.
 */
export function baroque(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const [lo, hi] = range(ctx);
  const vel = velFor(ctx, 0.7);
  let p = ctx.mem.lastPitch ?? lo + 12;
  const spans = chordSpans(ctx);
  for (let si = 0; si < spans.length; si++) {
    const s = spans[si];
    const steps = Math.round((s.end - s.start) * 2);
    const nextChord = spans[si + 1]?.chord ?? ctx.next;
    let start = root(ctx, s.chord, p);
    if (ctx.rng.chance(0.2) && steps >= 4) start = fold(nearestPc(mod(s.chord.root + s.chord.tones[1], 12), start), lo, hi);
    const goal = root(ctx, nextChord, start);
    const pcs = harmAt(ctx, s.start).scale;
    // go the way that reaches the goal; if it's the same note, take a scenic arch
    let dir: 1 | -1 = goal > start ? 1 : goal < start ? -1 : start > (lo + hi) / 2 ? -1 : 1;
    p = start;
    for (let i = 0; i < steps; i++) {
      const t = s.start + i / 2;
      if (i > 0) {
        const remaining = steps - i;
        const dist = Math.abs(diatonicIndex(goal, pcs) - diatonicIndex(p, pcs));
        if (i === steps - 1 && remaining === 1) {
          // arrive a step (or chromatic half step) from the goal
          p = ctx.rng.chance(0.3) ? goal + (p > goal ? 1 : -1) : scaleStep(goal, p > goal ? 1 : -1, pcs);
        } else if (i % 2 === 0 && ctx.rng.chance(0.18) && p + dir * 12 >= lo && p + dir * 12 <= hi) {
          p += dir * 12; // octave leap, then keep walking back toward the goal
          dir = (goal > p ? 1 : -1) as 1 | -1;
        } else {
          // turn around if we'd overshoot or if the goal is closer the other way
          if (dist >= remaining && dist > 0) dir = (goal > p ? 1 : -1) as 1 | -1;
          if (p + dir * 2 > hi || p + dir * 2 < lo) dir = (dir * -1) as 1 | -1;
          p = scaleStep(p, dir, pcs);
        }
      }
      p = fold(p, lo, hi);
      out.push({ pitch: p, start: t, dur: 0.5, vel: vel + (i % 2 === 0 ? 0.05 : 0) });
    }
  }
  ctx.mem.lastPitch = p;
  return out;
}

/** Pedal / drone: tonic (or root) held, optionally pulsing for minimalism. */
export function pedal(ctx: BarCtx): NoteEvent[] {
  const [lo, hi] = range(ctx);
  const vel = velFor(ctx, 0.65);
  const pulse = ctx.style.id === "minimal";
  const c = chordAt(ctx, 0);
  // ambient: follow the root; minimal: tonic pedal unless the chord moves far away
  const pc = ctx.style.id === "minimal" ? pcOf(ctx.key.tonic) : c.bass;
  const p = fold(nearestPc(pc, ctx.mem.lastPitch ?? lo + 7), lo, hi);
  ctx.mem.lastPitch = p;
  if (pulse) {
    const out: NoteEvent[] = [];
    for (let i = 0; i < ctx.beats * 2; i++) {
      out.push({ pitch: i % 4 === 2 ? Math.min(p + 12, hi + 12) : p, start: i / 2, dur: 0.5, vel: vel * (i % 2 === 0 ? 1 : 0.8) });
    }
    return out;
  }
  // ambient: tie across the bar, re-strike on chord changes
  return chordSpans(ctx).map((s) => ({
    pitch: fold(nearestPc(s.chord.bass, p), lo, hi),
    start: s.start,
    dur: s.end - s.start,
    vel,
  }));
}

/** Stride left hand used when a pianist covers the bass. */
export function strideBass(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.72);
  const step = ctx.beats === 3 ? 3 : 2;
  for (let b = 0; b < ctx.beats; b += step) {
    const c = chordAt(ctx, b);
    const r = bassNote(c, 36, 50, ctx.mem.lastPitch);
    const alt = b > 0 && ctx.chords.every((x) => x.beat !== b) ? fold(above(r, fifthPc(c), 52), 36, 52) : r;
    out.push({ pitch: alt, start: b, dur: 1, vel });
    if (ctx.rng.chance(0.4) && alt - 12 >= 28) out.push({ pitch: alt - 12, start: b, dur: 1, vel: vel * 0.8 });
  }
  return out;
}
