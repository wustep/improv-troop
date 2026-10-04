import { chordAt, chordSpans, velFor, type BarCtx } from "../context";
import { parseCell, realizeMotifBar } from "../motif";
import {
  chordPcs,
  diatonicIndex,
  fold,
  fromDiatonicIndex,
  guideTonePcs,
  mod,
  nearestPc,
  pcOf,
  scalePcs,
  SCALES,
  scaleStep,
  snapToPcs,
  type Chord,
} from "../theory";
import type { NoteEvent } from "../types";

function lineScale(ctx: BarCtx, c: Chord): number[] {
  const root = c.root;
  const at = (ints: readonly number[], r = root) => ints.map((i) => mod(r + i, 12));
  switch (ctx.style.line.flavor) {
    case "bebop":
      if (c.quality === "dom") return at(SCALES.bebopDominant);
      return scalePcs(c);
    case "pentatonic": {
      const minorish = c.quality === "min7" || c.quality === "min" || c.quality === "dom";
      return minorish ? at(SCALES.minorPentatonic) : at(SCALES.majorPentatonic);
    }
    case "blues": {
      const tonic = pcOf(ctx.key.tonic);
      return ctx.key.mode === "minor" || ctx.rng.chance(0.5)
        ? at(SCALES.blues, tonic)
        : [...new Set([...at(SCALES.majorPentatonic, tonic), mod(tonic + 3, 12)])];
    }
    case "arpeggio":
      return chordPcs(c);
    case "lydian":
      return c.quality === "maj7" || c.quality === "maj" || c.quality === "6" ? at(SCALES.lydian) : scalePcs(c);
    case "diatonic":
    default:
      return scalePcs(c);
  }
}

/** Assemble a rhythm for one bar from the style's cells, honouring breath and density. */
function lineRhythm(ctx: BarCtx, density: number): { start: number; dur: number }[] {
  const prior = ctx.style.line;
  const out: { start: number; dur: number }[] = [];
  let t = 0;
  // phrase starts often sit off the beat
  if (ctx.mem.sinceRest === 0 && ctx.rng.chance(prior.offbeatStarts)) t = ctx.style.line.density > 2.5 ? 0.25 : 0.5;
  let guard = 0;
  while (t < ctx.beats - 1e-6 && guard++ < 64) {
    // breathe
    const maxPhrase = ctx.rng.int(prior.phrase[0], prior.phrase[1]);
    const breath = ctx.inst.breath ?? 99;
    if (ctx.mem.sinceRest >= Math.min(maxPhrase, breath)) {
      const rest = Math.min(ctx.beats - t, ctx.rng.pick([1, 1.5, 2]));
      t += rest;
      ctx.mem.sinceRest = 0;
      continue;
    }
    const cell = parseCell(ctx.rng.pick(prior.cells));
    // thin out at low density: turn some notes into rests
    for (const c of cell) {
      if (t >= ctx.beats - 1e-6) break;
      const dur = Math.min(c.dur, ctx.beats - t);
      const thin = density < prior.density && ctx.rng.chance(1 - density / prior.density);
      if (!c.rest && !thin) out.push({ start: t, dur });
      t += dur;
      ctx.mem.sinceRest = c.rest ? 0 : ctx.mem.sinceRest + dur;
    }
  }
  return out;
}

/** A short phrase that lands on a long note — for phrase and section endings. */
function cadenceRhythm(ctx: BarCtx): { start: number; dur: number }[] {
  const options =
    ctx.beats === 3
      ? [[1, 2], [0.5, 0.5, 2]]
      : ctx.style.line.density > 2
        ? [[0.5, 0.5, 1, 2], [0.5, 0.5, 0.5, 0.5, 2], [1.5, 0.5, 2]]
        : [[1, 1, 2], [1.5, 0.5, 2], [2, 2]];
  const durs = ctx.rng.pick(options);
  const out: { start: number; dur: number }[] = [];
  let t = 0;
  for (const d of durs) {
    out.push({ start: t, dur: d });
    t += d;
  }
  ctx.mem.sinceRest = 0;
  return out;
}

/**
 * Improvised line: chord tones on strong beats, scale steps and chromatic
 * approaches between, momentum-driven contour, phrase breathing.
 * Args: dense | sparse | run | long | blues
 */
export function line(ctx: BarCtx): NoteEvent[] {
  const prior = ctx.style.line;
  let density = prior.density * (0.6 + ctx.energy * 0.6);
  if (ctx.args.includes("dense") || ctx.args.includes("run")) density *= 1.4;
  if (ctx.args.includes("sparse") || ctx.args.includes("long")) density *= 0.55;
  if (ctx.texture === "sparse") density *= 0.7;
  if (ctx.texture === "peak") density *= 1.2;

  const featured = ctx.role === "solo" || ctx.role === "lead";
  let rhythm = ctx.args.includes("long") ? cadenceRhythm(ctx) : lineRhythm(ctx, density);
  // "leave space" means a short answer, not a silent bar in the middle of a solo
  if (featured && rhythm.length === 0) {
    const cell = ctx.beats === 3 ? [{ start: 1, dur: 0.5 }, { start: 1.5, dur: 1.5 }] : [{ start: 1.5, dur: 0.5 }, { start: 2, dur: 0.5 }, { start: 2.5, dur: 1.5 }];
    rhythm = cell;
    ctx.mem.sinceRest = 0;
  }
  const [lo, hi] = featured ? (ctx.inst.solo ?? ctx.inst.sweet) : ctx.inst.sweet;
  const out: NoteEvent[] = [];
  let p = ctx.mem.lastPitch ?? Math.round((lo + hi) / 2);
  // stepping into the spotlight from an accompaniment register: start where solos live
  if (featured && (p < lo || p > hi)) p = Math.round(lo + (hi - lo) * 0.4);
  const vel = velFor(ctx, 0.8);
  // solos climb over their section
  const arc = ctx.section.length > 1 ? ctx.barInSection / (ctx.section.length - 1) : 0.5;
  const targetCenter = lo + (hi - lo) * (0.35 + 0.35 * arc);

  for (let i = 0; i < rhythm.length; i++) {
    const { start, dur } = rhythm[i];
    const c = chordAt(ctx, start);
    const pcs = lineScale(ctx, c);
    const strong = Math.abs(start - Math.round(start)) < 1e-6 && (ctx.beats === 3 || Math.round(start) % 2 === 0 || prior.density < 2.5);
    // momentum, re-aimed now and then toward the arc's center (which climbs through a solo)
    const bias = Math.max(-0.45, Math.min(0.45, (targetCenter - p) / 10));
    if (p > hi - 3) ctx.mem.direction = -1;
    else if (p < lo + 3) ctx.mem.direction = 1;
    else if (ctx.rng.chance(0.3)) ctx.mem.direction = ctx.rng.chance(0.5 + bias) ? 1 : -1;
    const dir = ctx.mem.direction;

    let next: number;
    if (strong) {
      const tones = chordPcs(c);
      const favored = ctx.style.line.flavor === "bebop" ? guideTonePcs(c) : tones;
      const pool = ctx.rng.chance(0.65) ? favored : tones;
      next = nearestPc(ctx.rng.pick(pool), p + dir * 2);
    } else if (ctx.rng.chance(prior.leap)) {
      const steps = dir * ctx.rng.int(2, ctx.style.line.flavor === "arpeggio" ? 2 : 4);
      next = fromDiatonicIndex(diatonicIndex(p, pcs) + steps, pcs);
    } else {
      next = fromDiatonicIndex(diatonicIndex(p, pcs) + dir, pcs);
    }

    // chromatic approach into the next strong-beat target
    const nextNote = rhythm[i + 1];
    if (nextNote && prior.chromatic > 0 && dur <= 0.5 && ctx.rng.chance(prior.chromatic)) {
      const nextChord = chordAt(ctx, nextNote.start);
      const target = nearestPc(ctx.rng.pick(guideTonePcs(nextChord)), next);
      next = target + (ctx.rng.chance(0.5) ? 1 : -1);
    }
    if (next === p && ctx.style.id !== "funk" && ctx.style.id !== "minimal") next = fromDiatonicIndex(diatonicIndex(p, pcs) + dir, pcs);
    // bounce off the edges of the register instead of sinking or squeaking — and land the
    // bounced note back on the harmony (a mirrored interval can fall between the cracks)
    if (next < lo || next > hi) {
      next = next < lo ? p + (p - next) : p - (next - p);
      next = snapToPcs(next, strong ? chordPcs(c) : pcs);
    }
    next = fold(next, Math.max(ctx.inst.range[0], lo - 2), Math.min(ctx.inst.range[1], hi + 2));

    const lastOfPhrase = !nextNote || nextNote.start - (start + dur) > 0.4;
    if (lastOfPhrase) next = snapToPcs(next, chordPcs(c)); // end phrases on chord tones
    const staccato = ctx.rng.chance(prior.staccato);
    out.push({
      pitch: next,
      start,
      dur,
      vel: vel * (start % 1 === 0.5 && ctx.style.swing > 0.55 ? 1.06 : 1) * (0.92 + ctx.rng.next() * 0.12),
      art: staccato ? "staccato" : undefined,
    });
    p = next;
  }
  // Consonance guard: passing colours (bebop passing tones, blue notes) are for short,
  // weak-beat notes. Anything held or on a strong beat sits in the chord or its scale.
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    const strongBeat = Math.abs(n.start - Math.round(n.start)) < 1e-6;
    if (!strongBeat && n.dur < 0.75) continue;
    const c = chordAt(ctx, n.start);
    const ok = new Set([...chordPcs(c), ...scalePcs(c), ...c.tensions.map((t) => mod(c.root + t, 12))]);
    if (c.quality === "dom") ok.delete(mod(c.root + 11, 12)); // the bebop major 7th is only ever passing
    if (ok.has(mod(n.pitch, 12))) continue;
    out[i] = { ...n, pitch: snapToPcs(n.pitch, chordPcs(c)) };
  }
  if (out.length) p = out[out.length - 1].pitch;
  ctx.mem.lastPitch = p;
  return out;
}

/** Solo bar: opens with a motif transform, then improvises. */
export function soloBar(ctx: BarCtx): NoteEvent[] {
  return line(ctx);
}

/** Guide-tone line: 3rds and 7ths, voice-led, one per chord. */
export function guide(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const [lo, hi] = ctx.inst.sweet;
  const center = lo + (hi - lo) * 0.4;
  const vel = velFor(ctx, 0.55);
  for (const s of chordSpans(ctx)) {
    const prev = ctx.mem.lastGuide ?? Math.round(center);
    const options = guideTonePcs(s.chord).map((pc) => nearestPc(pc, prev));
    let p = options.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
    p = fold(p, lo, hi);
    out.push({ pitch: p, start: s.start, dur: (s.end - s.start) * 0.95, vel, art: "legato" });
    ctx.mem.lastGuide = p;
  }
  // stay out of the lead's way: if the lead is busy in this register, drop an octave
  return avoidLead(ctx, out);
}

/** Melodic pad: long chord tones (strings / horns in ambient & bossa). */
export function melodicPad(ctx: BarCtx): NoteEvent[] {
  const out = guide(ctx);
  return out.map((n) => ({ ...n, dur: Math.max(n.dur, 0.5), vel: n.vel * 0.85 }));
}

function avoidLead(ctx: BarCtx, notes: NoteEvent[]): NoteEvent[] {
  if (!ctx.featured.length) return notes;
  const leadAvg = ctx.featured.reduce((s, n) => s + n.pitch, 0) / ctx.featured.length;
  return notes.map((n) => {
    if (Math.abs(n.pitch - leadAvg) < 4 && n.pitch - 12 >= ctx.inst.range[0]) return { ...n, pitch: n.pitch - 12 };
    return n;
  });
}

/** Parallel 3rds/6ths under the featured line (a cello sits a 10th below). Falls back to guide tones. */
export function harmony(ctx: BarCtx): NoteEvent[] {
  if (!ctx.featured.length) return ctx.inst.id === "cello" ? celloCounter(ctx) : guide(ctx);
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.6);
  const cello = ctx.inst.id === "cello";
  for (const n of ctx.featured) {
    const c = chordAt(ctx, n.start);
    const pcs = scalePcs(c);
    let p = fromDiatonicIndex(diatonicIndex(n.pitch, pcs) - 2, pcs); // a third below
    if (p < ctx.inst.range[0] + 2) p = fromDiatonicIndex(diatonicIndex(n.pitch, pcs) + 5, pcs) - 12; // sixth below
    if (cello) while (p > 64 && p - 12 >= 45) p -= 12; // tenor register: a tenth under the lead
    p = fold(p, ctx.inst.range[0], ctx.inst.range[1]);
    out.push({ ...n, pitch: p, vel, art: n.dur >= 1 ? "legato" : undefined });
  }
  return out;
}

/**
 * Cello countermelody: voice-led guide tones held while the lead is busy, moving
 * stepwise toward the next chord (or answering with a motif fragment) in the lead's gaps.
 */
export function celloCounter(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  // the countermelody is the cello's voice in the band: under the lead, but heard
  const vel = velFor(ctx, 0.74);
  const lo = 45;
  const hi = 66;
  // beats where the lead is moving (onsets within the beat)
  const busy = new Set<number>();
  for (const n of ctx.featured) {
    for (let b = Math.floor(n.start); b < Math.min(ctx.beats, n.start + n.dur); b++) busy.add(b);
  }
  const spans = chordSpans(ctx);
  for (let si = 0; si < spans.length; si++) {
    const s = spans[si];
    const prev = ctx.mem.lastGuide ?? 55;
    const opts = guideTonePcs(s.chord).map((pc) => fold(nearestPc(pc, prev), lo, hi));
    const target = opts.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
    const len = s.end - s.start;
    const nextChord = spans[si + 1]?.chord ?? ctx.next;
    const nextTarget = fold(nearestPc(guideTonePcs(nextChord)[0], target), lo, hi);
    const gapStart = [...Array(Math.floor(len)).keys()].map((i) => s.start + i).find((b) => b >= s.start + 1 && !busy.has(b));
    if (len >= 2 && gapStart !== undefined && nextTarget !== target) {
      // hold, then walk toward the next chord's guide tone in the gap
      const hold = gapStart - s.start;
      out.push({ pitch: target, start: s.start, dur: hold, vel, art: "legato" });
      const pcs = scalePcs(s.chord);
      const dir = Math.sign(nextTarget - target);
      let p = target;
      for (let t = gapStart; t < s.end - 1e-6; t += 1) {
        p = fromDiatonicIndex(diatonicIndex(p, pcs) + dir, pcs);
        if ((dir > 0 && p >= nextTarget) || (dir < 0 && p <= nextTarget)) p = nextTarget + (dir > 0 ? -1 : 1);
        out.push({ pitch: fold(p, lo, hi), start: t, dur: Math.min(1, s.end - t), vel: vel * 0.92 });
      }
      ctx.mem.lastGuide = p;
    } else if (len >= 4) {
      // lead never pauses: move in half notes, guide tone then the other guide tone (or a step)
      const other = opts.find((o) => o !== target) ?? scaleStep(target, target > 55 ? -1 : 1, scalePcs(s.chord));
      const second = Math.abs(other - target) <= 4 ? other : scaleStep(target, other > target ? 1 : -1, scalePcs(s.chord));
      out.push({ pitch: target, start: s.start, dur: len / 2, vel, art: "legato" });
      out.push({ pitch: fold(second, lo, hi), start: s.start + len / 2, dur: len / 2, vel: vel * 0.94, art: "legato" });
      ctx.mem.lastGuide = second;
    } else {
      out.push({ pitch: target, start: s.start, dur: len, vel, art: "legato" });
      ctx.mem.lastGuide = target;
    }
  }
  return out;
}

/** Bowed pad: guide tones, with an open-fifth drone double-stop in slow, spacious styles. */
export function celloPad(ctx: BarCtx): NoteEvent[] {
  const out = melodicPad(ctx);
  if (ctx.style.id === "ambient" || ctx.style.id === "minimal") {
    for (const s of chordSpans(ctx)) {
      const r = fold(nearestPc(s.chord.root, 43), 36, 50);
      out.push({ pitch: r, start: s.start, dur: s.end - s.start, vel: velFor(ctx, 0.42), art: "legato" });
      out.push({ pitch: r + 7, start: s.start, dur: s.end - s.start, vel: velFor(ctx, 0.38), art: "legato" });
    }
  }
  return out;
}

/** Canon: imitate the featured line two beats later, a 4th or octave lower. */
export function canon(ctx: BarCtx): NoteEvent[] {
  const delay = ctx.beats === 3 ? 3 : 2;
  const src = [...ctx.featuredPrev, ...ctx.featured]
    .map((n) => ({ ...n, start: n.start + delay }))
    .filter((n) => n.start >= 0 && n.start < ctx.beats);
  if (!src.length) return guide(ctx);
  const pcs = ctx.keyPcs;
  const [lo, hi] = ctx.inst.range;
  const vel = velFor(ctx, 0.62);
  return src.map((n) => {
    let p = fromDiatonicIndex(diatonicIndex(n.pitch, pcs) - 3, pcs); // a 4th below
    p = fold(p, lo, hi);
    return { ...n, pitch: p, vel, dur: Math.min(n.dur, ctx.beats - n.start) };
  });
}

/** Riff: a short fragment of the motif repeated as a backing figure, fitted to the chord. */
export function riff(ctx: BarCtx): NoteEvent[] {
  if (!ctx.mem.riff) {
    const m = ctx.motif.notes;
    const frag = m.slice(0, Math.min(4, m.length));
    const t0 = frag[0]?.start ?? 0;
    // place the riff in the back half of the bar (call-and-response with the lead)
    const offset = ctx.beats === 3 ? 1 : 2;
    ctx.mem.riff = frag
      .map((n) => ({ ...n, start: n.start - t0 + offset }))
      .filter((n) => n.start < ctx.beats)
      .map((n) => ({ ...n, dur: Math.min(n.dur, ctx.beats - n.start) }));
  }
  const [lo, hi] = ctx.inst.sweet;
  const vel = velFor(ctx, 0.66);
  const out: NoteEvent[] = [];
  let shift = 0;
  const first = ctx.mem.riff[0];
  if (first) {
    const c = chordAt(ctx, first.start);
    const target = nearestPc(c.root, first.pitch);
    shift = target - nearestPc(pcOf(ctx.motif.chord), first.pitch);
    if (Math.abs(shift) > 6) shift -= Math.sign(shift) * 12;
  }
  const lowRegister = (lo + hi) / 2 - 5;
  for (const n of ctx.mem.riff) {
    const c = chordAt(ctx, n.start);
    let p = n.pitch + shift;
    p = snapToPcs(p, lineScale(ctx, c));
    while (p > lowRegister + 12) p -= 12;
    p = fold(p, lo, hi);
    out.push({ ...n, pitch: p, vel, art: ctx.style.id === "funk" ? "staccato" : n.art });
  }
  return out;
}

/** Collective counter-line (New Orleans): busy above (clarinet/flute/violin) or smeary below. */
export function counter(ctx: BarCtx): NoteEvent[] {
  const high = ["clarinet", "flute", "violin"].includes(ctx.inst.id);
  if (high) {
    const notes = line({ ...ctx, energy: ctx.energy * 0.8 });
    return notes.map((n) => ({ ...n, vel: n.vel * 0.7 }));
  }
  if (ctx.inst.fn === "melodic" && ctx.rng.chance(0.5)) return riff(ctx);
  return guide(ctx);
}

/** A short pickup run into the next bar. */
export function melodicFill(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const target = nearestPc(ctx.next.root, ctx.mem.lastPitch ?? (ctx.inst.sweet[0] + ctx.inst.sweet[1]) / 2);
  const pcs = scalePcs(ctx.next);
  const n = ctx.style.line.density > 2 ? 4 : 2;
  const step = ctx.style.line.density > 2 ? 0.25 : 0.5;
  let p = fromDiatonicIndex(diatonicIndex(target, pcs) - n, pcs);
  const vel = velFor(ctx, 0.75);
  for (let i = 0; i < n; i++) {
    out.push({ pitch: fold(p, ctx.inst.range[0], ctx.inst.range[1]), start: ctx.beats - (n - i) * step, dur: step * 0.9, vel });
    p = fromDiatonicIndex(diatonicIndex(p, pcs) + 1, pcs);
  }
  ctx.mem.lastPitch = p;
  return out;
}

/** Melodic final note: a chord tone held through the last bar. */
export function endNote(ctx: BarCtx): NoteEvent[] {
  const c = chordAt(ctx, 0);
  const near = ctx.mem.lastPitch ?? (ctx.inst.sweet[0] + ctx.inst.sweet[1]) / 2;
  const pc = ctx.role === "lead" ? c.root : ctx.rng.pick(chordPcs(c));
  const p = fold(nearestPc(pc, near), ctx.inst.range[0], ctx.inst.range[1]);
  return [{ pitch: p, start: 0, dur: ctx.beats, vel: velFor(ctx, 0.75), art: "legato" }];
}

export { realizeMotifBar };
