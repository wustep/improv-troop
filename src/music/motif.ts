import { dynamicLift, harmAt, type BarCtx } from "./context";
import { fitOctave, holdable, nearestIn } from "./harmony";
import { notesToText, parseNotes, splitBars } from "./notation";
import type { Rng } from "./rng";
import type { StyleDef } from "./styles";
import {
  chordPcs,
  diatonicIndex,
  fromDiatonicIndex,
  keyPrefersFlats,
  keyScale,
  mod,
  nearestPc,
  parseChord,
  pcOf,
  snapToPcs,
} from "./theory";
import type { KeySig, Motif, MotifTransform, NoteEvent } from "./types";

// The motif is the band's shared idea: the leader states a short cell, solos are
// transforms of it, everyone else comps. Without it, styles collapse into the same texture.

export interface MotifOp {
  op: MotifTransform;
  n?: number;
}

/** Parse rhythm-cell text like "r/8 8 8 4" into [{dur, rest}] (bare numbers are durations). */
export function parseCell(cell: string): { dur: number; rest: boolean }[] {
  return cell
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const rest = tok.startsWith("r");
      const spec = tok.replace(/^r\/?/, "");
      const m = /^(1|2|4|8|16|32)(\.?)(t?)$/.exec(spec);
      if (!m) return { dur: 1, rest };
      let d = 4 / parseInt(m[1], 10);
      if (m[2]) d *= 1.5;
      if (m[3]) d *= 2 / 3;
      return { dur: d, rest };
    });
}

export function motifFromText(text: string, beats: number, chord: string, description?: string): Motif {
  const bars = splitBars(text);
  const notes: NoteEvent[] = [];
  let offset = 0;
  for (const b of bars) {
    const r = parseNotes(b, bars.length > 1 ? beats : Math.max(beats, 4 * 2));
    for (const n of r.notes) notes.push({ ...n, start: n.start + offset });
    offset += bars.length > 1 ? beats : Math.ceil(r.covered);
  }
  const end = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const length = bars.length > 1 ? offset : Math.max(1, Math.ceil(end));
  return { notes, length: Math.min(length, beats * 2), chord, text, description };
}

/** Make a fresh motif in the style's idiom over the first chord of the chart. */
export function generateMotif(
  style: StyleDef,
  key: KeySig,
  firstChord: string,
  beats: number,
  range: [number, number],
  rng: Rng,
): Motif {
  const cellText = rng.pick(style.motifCells);
  let cell = parseCell(cellText);
  // fit to at most one bar (two for slow styles)
  const maxLen = style.id === "ambient" ? beats * 2 : beats;
  const fitted: typeof cell = [];
  let t = 0;
  for (const c of cell) {
    if (t + c.dur > maxLen + 1e-6) break;
    fitted.push(c);
    t += c.dur;
  }
  cell = fitted.length ? fitted : [{ dur: 1, rest: false }];

  const contour = rng.pick(style.contours);
  const scale = keyScale(key);
  const chord = parseChord(firstChord);
  const center = Math.round((range[0] + range[1]) / 2);
  const startTone = rng.pick([1, 2, 0].map((i) => chord.tones[i] ?? 0));
  const start = nearestPc(mod(chord.root + startTone, 12), center);
  const startIdx = diatonicIndex(start, scale);

  const notes: NoteEvent[] = [];
  let pos = 0;
  let k = 0;
  let prev: number | null = null;
  const chordTones = chordPcs(chord);
  for (const c of cell) {
    if (!c.rest) {
      const step = contour[k % contour.length] + (k >= contour.length ? Math.floor(k / contour.length) : 0);
      let p = fromDiatonicIndex(startIdx + step, scale);
      // strong beats lean on chord tones — resolving in the direction the contour is moving
      if (Math.abs(pos - Math.round(pos)) < 1e-6 && k > 0 && !chordTones.includes(mod(p, 12)) && rng.chance(0.6)) {
        const dir = prev === null ? -1 : Math.sign(p - prev) || -1;
        let q = p;
        for (let i = 0; i < 3 && !chordTones.includes(mod(q, 12)); i++) q += dir;
        p = chordTones.includes(mod(q, 12)) ? q : snapToPcs(p, chordTones);
      }
      notes.push({ pitch: p, start: pos, dur: c.dur * 0.95, vel: k === 0 ? 0.85 : 0.78 });
      prev = p;
      k++;
    }
    pos += c.dur;
  }
  // move the whole cell by octaves into the player's range (never fold single notes: that makes jagged leaps)
  if (notes.length) {
    const lo = Math.min(...notes.map((n) => n.pitch));
    const hi = Math.max(...notes.map((n) => n.pitch));
    const mid = (lo + hi) / 2;
    let shift = Math.round((center - mid) / 12) * 12;
    while (lo + shift < range[0] && hi + shift + 12 <= range[1] + 2) shift += 12;
    while (hi + shift > range[1] && lo + shift - 12 >= range[0] - 2) shift -= 12;
    for (const n of notes) n.pitch += shift;
  }
  const flats = keyPrefersFlats(key);
  const text = notesToText(notes, Math.max(beats, Math.ceil(pos)), flats);
  return { notes, length: Math.ceil(pos - 1e-6) || beats, chord: firstChord, text, description: `${cellText} · contour ${contour.join(",")}` };
}

/** Read transform words; anything not understood is collected in `unknown` (if given). */
export function parseMotifOps(args: string[], unknown?: string[]): MotifOp[] {
  const ops: MotifOp[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    const num = (d: number) => {
      const v = parseFloat(args[i + 1]);
      if (!Number.isNaN(v)) {
        i++;
        return v;
      }
      const inline = /(-?\d+(?:\.\d+)?)$/.exec(a);
      return inline ? parseFloat(inline[1]) : d;
    };
    if (a.startsWith("up") || a.startsWith("transpose")) ops.push({ op: "transpose", n: num(2) });
    else if (a.startsWith("down")) ops.push({ op: "transpose", n: -Math.abs(num(2)) });
    else if (a.startsWith("seq")) ops.push({ op: "sequence", n: num(-1) });
    else if (a.startsWith("inv")) ops.push({ op: "invert" });
    else if (a.startsWith("retro")) ops.push({ op: "retrograde" });
    else if (a.startsWith("aug")) ops.push({ op: "augment" });
    else if (a.startsWith("dim")) ops.push({ op: "diminish" });
    else if (a.startsWith("frag")) ops.push({ op: "fragment", n: num(0) });
    else if (a.startsWith("disp") || a.startsWith("phase")) ops.push({ op: "displace", n: num(0.5) });
    else if (a.startsWith("orn")) ops.push({ op: "ornament" });
    else if (a.startsWith("rhy")) ops.push({ op: "rhythm" });
    else if (a === "state") ops.push({ op: "state" });
    else unknown?.push(args[i]);
  }
  return ops;
}

/**
 * Apply transforms to the motif and return notes relative to the statement start,
 * still in the motif's register (fitting to a bar happens in realizeMotifBar).
 */
export function transformMotif(motif: Motif, ops: MotifOp[], key: KeySig, rng: Rng, style: StyleDef): NoteEvent[] {
  const scale = keyScale(key);
  let notes = motif.notes.map((n) => ({ ...n }));
  let length = motif.length;
  for (const { op, n } of ops) {
    if (!notes.length) break;
    switch (op) {
      case "transpose": {
        const steps = Math.round(n ?? 2);
        notes = notes.map((x) => ({ ...x, pitch: fromDiatonicIndex(diatonicIndex(x.pitch, scale) + steps, scale) }));
        break;
      }
      case "invert": {
        const pivot = diatonicIndex(notes[0].pitch, scale);
        notes = notes.map((x) => ({ ...x, pitch: fromDiatonicIndex(2 * pivot - diatonicIndex(x.pitch, scale), scale) }));
        break;
      }
      case "retrograde": {
        const end = length;
        notes = notes
          .map((x) => ({ ...x, start: Math.max(0, end - (x.start + x.dur / 0.95)) }))
          .sort((a, b) => a.start - b.start);
        break;
      }
      case "augment":
        notes = notes.map((x) => ({ ...x, start: x.start * 2, dur: x.dur * 2 }));
        length *= 2;
        break;
      case "diminish":
        notes = notes.map((x) => ({ ...x, start: x.start / 2, dur: x.dur / 2 }));
        length /= 2;
        break;
      case "fragment": {
        const k = n && n > 0 ? Math.round(n) : Math.max(2, Math.ceil(notes.length / 2));
        notes = notes.slice(0, k);
        const end = notes[notes.length - 1];
        length = Math.ceil(end.start + end.dur);
        break;
      }
      case "sequence": {
        const steps = Math.round(n ?? -1);
        const copy = notes.map((x) => ({
          ...x,
          start: x.start + length,
          pitch: fromDiatonicIndex(diatonicIndex(x.pitch, scale) + steps, scale),
        }));
        notes = [...notes, ...copy];
        length *= 2;
        break;
      }
      case "displace": {
        const d = n ?? 0.5;
        notes = notes.map((x) => ({ ...x, start: x.start + d }));
        length += d;
        break;
      }
      case "ornament": {
        const out: NoteEvent[] = [];
        for (const x of notes) {
          if (x.dur >= 0.5 && rng.chance(0.5)) {
            const g = Math.min(0.25, x.dur / 2);
            const nb = fromDiatonicIndex(diatonicIndex(x.pitch, scale) + 1, scale);
            out.push({ ...x, pitch: nb, dur: g * 0.9 });
            out.push({ ...x, start: x.start + g, dur: x.dur - g });
          } else out.push(x);
        }
        notes = out;
        break;
      }
      case "rhythm": {
        const cell = parseCell(rng.pick(style.motifCells)).filter((c) => !c.rest);
        let t = 0;
        notes = notes.map((x, i) => {
          const c = cell[i % cell.length];
          const nn = { ...x, start: t, dur: c.dur * 0.95 };
          t += c.dur;
          return nn;
        });
        length = Math.ceil(t);
        break;
      }
      case "state":
        break;
    }
  }
  return notes;
}

/**
 * Realize a motif statement into one bar. `barOffset` selects which bar of a
 * multi-bar statement this is (0 = first bar). Every note is fitted to the harmony in
 * context: anything held, on the downbeat, or ending the statement lands on a chord tone
 * (or a color the style can hold); shorter notes stay in the chord's scale, moving in the
 * direction the motif was moving so the contour survives.
 */
export function realizeMotifBar(ctx: BarCtx, ops: MotifOp[], barOffset = 0): NoteEvent[] {
  const raw = transformMotif(ctx.motif, ops, ctx.key, ctx.rng, ctx.style);
  const lo = barOffset * ctx.beats;
  const hi = lo + ctx.beats;
  const shift = motifOctave(ctx, raw);
  const inBar = raw.filter((n) => n.start >= lo - 1e-6 && n.start < hi - 1e-6);
  // the motif keeps its own accents, at the bar's dynamic (as written, at mf)
  const lift = dynamicLift(ctx.energy);
  const out: NoteEvent[] = [];
  let prevRaw: number | null = null;
  let prevOut: number | null = null;
  inBar.forEach((n, i) => {
    const start = n.start - lo;
    let p = n.pitch + shift;
    const h = harmAt(ctx, start);
    const pc = mod(p, 12);
    const dir = (prevRaw === null ? 0 : Math.sign(n.pitch - prevRaw)) as 1 | -1 | 0;
    const onBeat = Math.abs(start - Math.round(start)) < 1e-6;
    const structural = n.dur >= 0.7 || Math.abs(start) < 1e-6 || (onBeat && n.dur >= 0.45) || i === inBar.length - 1;
    if (structural && !holdable(h, pc, ctx.style.id)) {
      p = nearestIn(p, h.stable, dir || -1);
    } else if (!h.scale.includes(pc) && !h.blue.includes(pc)) {
      // chromatic notes survive only as passing tones between two notes a whole step apart
      const next = inBar[i + 1];
      const passing = prevOut !== null && next && Math.abs(next.pitch + shift - prevOut) === 2 && Math.abs(p - prevOut) === 1 && n.dur <= 0.5;
      if (!passing) p = nearestIn(p, h.scale, dir);
    } else if (h.avoid.includes(pc) && n.dur >= 0.45) {
      p = nearestIn(p, h.stable, dir || -1);
    }
    // keep repeated pitches only where the motif repeats
    if (prevOut !== null && p === prevOut && prevRaw !== null && n.pitch !== prevRaw) {
      p = scaleStepAway(p, n.pitch - prevRaw, structural ? h.stable : h.scale);
    }
    out.push({ ...n, start, dur: Math.min(n.dur, ctx.beats - start), pitch: p, vel: Math.min(1, n.vel * lift) });
    prevRaw = n.pitch;
    prevOut = p;
  });
  // a note or two just past the instrument's edge bends back onto the chord; a whole statement
  // out of range moves by octaves (into the solo register for a featured player)
  const [rlo, rhi] = ctx.inst.range;
  const over = out.reduce((s, n) => s + Math.max(0, rlo - n.pitch) + Math.max(0, n.pitch - rhi), 0);
  let fitted = out;
  if (over > 0 && over <= 3) {
    fitted = out.map((n) => {
      if (n.pitch >= rlo && n.pitch <= rhi) return n;
      const h = harmAt(ctx, n.start);
      const edge = n.pitch < rlo ? rlo : rhi;
      return { ...n, pitch: nearestIn(edge, h.stable, n.pitch < rlo ? 1 : -1, 4) };
    });
  } else if (over > 0) {
    const featured = ctx.role === "solo" || ctx.role === "lead";
    const [lo2, hi2] = featured ? (ctx.inst.solo ?? ctx.inst.sweet) : ctx.inst.range;
    fitted = fitOctave(out, Math.max(rlo, lo2 - 3), Math.min(rhi, hi2 + 3), featured ? (lo2 + hi2) / 2 : ctx.mem.lastPitch);
  }
  if (fitted.length) ctx.mem.lastPitch = fitted[fitted.length - 1].pitch;
  return fitted;
}

function scaleStepAway(p: number, interval: number, pcs: number[]): number {
  const dir = Math.sign(interval) || 1;
  let q = p + dir;
  while (!pcs.includes(mod(q, 12))) q += dir;
  return q;
}

/**
 * Which octave to play a motif statement in. A head restates the motif in its own
 * register (so statements don't jump octaves bar to bar); a soloist plays it near
 * where they are, as long as it stays inside their solo range.
 */
function motifOctave(ctx: BarCtx, raw: NoteEvent[]): number {
  if (!raw.length) return 0;
  const featured = ctx.role === "solo" || ctx.role === "lead";
  const range = featured ? (ctx.inst.solo ?? ctx.inst.sweet) : ctx.inst.sweet;
  const center = raw.reduce((s, n) => s + n.pitch, 0) / raw.length;
  const lo = Math.min(...raw.map((n) => n.pitch));
  const hi = Math.max(...raw.map((n) => n.pitch));
  const own = ctx.motif.notes.length ? ctx.motif.notes.reduce((s, n) => s + n.pitch, 0) / ctx.motif.notes.length : center;
  const last = ctx.mem.lastPitch;
  const ref =
    ctx.role === "solo" && last !== null && last >= range[0] && last <= range[1]
      ? last
      : ctx.role === "lead" || !featured
        ? own
        : (range[0] + range[1]) / 2;
  let best = 0;
  let bestCost = Infinity;
  for (const shift of [-24, -12, 0, 12, 24]) {
    const out = Math.max(0, range[0] - (lo + shift)) + Math.max(0, hi + shift - range[1]);
    const cost = out * 8 + Math.abs(center + shift - ref) + Math.abs(shift) * 0.05;
    if (cost < bestCost) {
      bestCost = cost;
      best = shift;
    }
  }
  return best;
}

export function motifPitchCenter(m: Motif): number {
  if (!m.notes.length) return 67;
  return m.notes.reduce((s, n) => s + n.pitch, 0) / m.notes.length;
}

export function transposeMotif(m: Motif, semis: number, key: KeySig): Motif {
  const notes = m.notes.map((n) => ({ ...n, pitch: n.pitch + semis }));
  const flats = keyPrefersFlats(key);
  return { ...m, notes, text: notesToText(notes, Math.max(4, m.length), flats) };
}

export function keyTonicPc(key: KeySig) {
  return pcOf(key.tonic);
}
