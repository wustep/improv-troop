import { chordSpans, harmAt, velFor, type BarCtx } from "../context";
import { fitOctave, holdable, nearestIn, stepIn, type Harm } from "../harmony";
import { realizeMotifBar } from "../motif";
import { fold, mod, nearestPc, parseChord } from "../theory";
import type { NoteEvent } from "../types";
import { cadenceLine, phraseLine, runLine, type LineOpts } from "./phrase";

/**
 * Improvised line. Args: dense | sparse | run | long.
 * "long" is a cadence (lands on a held chord tone mid-bar); "run" is a scalar flourish.
 */
export function line(ctx: BarCtx, opts: LineOpts = {}): NoteEvent[] {
  if (ctx.args.includes("long")) return cadenceLine(ctx, opts);
  if (ctx.args.includes("run")) return runLine(ctx, opts);
  return phraseLine(ctx, opts);
}

/** Solo bar: opens with a motif transform, then improvises. */
export function soloBar(ctx: BarCtx): NoteEvent[] {
  return line(ctx);
}

/**
 * Pick the held tone for this player: the first takes the nearest guide tone, the others
 * the other guide tone, then the 5th, a color, the root — so a section of pads spells the
 * chord instead of doubling one note.
 */
function guideFor(ctx: BarCtx, h: Harm, prev: number): number {
  if (ctx.peerCount <= 1 || ctx.peerIndex === 0) {
    const opts = h.guides.map((pc) => nearestPc(pc, prev));
    opts.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
    return opts[0];
  }
  const fifth = h.tones.find((pc) => mod(pc - h.chord.root, 12) === 7 || mod(pc - h.chord.root, 12) === 6);
  const ranked = [...new Set([...h.guides, ...(fifth !== undefined ? [fifth] : []), ...h.colors, h.chord.root])];
  const first = h.guides.map((pc) => nearestPc(pc, prev)).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0];
  const pick = ranked.filter((pc) => pc !== mod(first, 12))[(ctx.peerIndex - 1) % Math.max(1, ranked.length - 1)];
  return nearestPc(pick ?? h.guides[1] ?? h.chord.root, prev);
}

/** Guide-tone line: 3rds and 7ths, voice-led, one per chord. */
export function guide(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const [lo, hi] = ctx.inst.sweet;
  const center = lo + (hi - lo) * (0.4 - 0.12 * ctx.peerIndex);
  const vel = velFor(ctx, 0.55);
  for (const s of chordSpans(ctx)) {
    const h = harmAt(ctx, s.start);
    const prev = ctx.mem.lastGuide ?? Math.round(center);
    const p = fold(guideFor(ctx, h, prev), lo, hi);
    out.push({ pitch: p, start: s.start, dur: (s.end - s.start) * 0.95, vel, art: "legato" });
    ctx.mem.lastGuide = p;
  }
  return avoidLead(ctx, out);
}

/** Melodic pad: long chord tones (strings / horns in ambient & bossa). */
export function melodicPad(ctx: BarCtx): NoteEvent[] {
  const out = guide(ctx);
  return out.map((n) => ({ ...n, dur: Math.max(n.dur, 0.5), vel: n.vel * 0.85 }));
}

/** Supporting notes step out of the lead's register (an octave down) when they'd sit on top of it. */
function avoidLead(ctx: BarCtx, notes: NoteEvent[]): NoteEvent[] {
  if (!ctx.featured.length) return notes;
  const leadLow = Math.min(...ctx.featured.map((n) => n.pitch));
  const leadAvg = ctx.featured.reduce((s, n) => s + n.pitch, 0) / ctx.featured.length;
  return notes.map((n) => {
    if ((Math.abs(n.pitch - leadAvg) < 4 || n.pitch > leadLow) && n.pitch - 12 >= ctx.inst.range[0]) return { ...n, pitch: n.pitch - 12 };
    return n;
  });
}

/**
 * Harmony under the featured line: each note gets a partner a 3rd below (a second voice a
 * 6th below; a cello a 10th below), chosen from the chord in context so held notes sound,
 * and the voice moves when the melody moves instead of sticking on one note.
 */
export function harmony(ctx: BarCtx): NoteEvent[] {
  if (!ctx.featured.length) return ctx.inst.id === "cello" ? celloCounter(ctx) : guide(ctx);
  const vel = velFor(ctx, 0.6);
  const cello = ctx.inst.id === "cello";
  const want = ctx.peerIndex % 2 === 1 ? 8.5 : 3.5; // semitones below: a 3rd, or a 6th
  const raw: NoteEvent[] = [];
  let prev: number | null = null;
  let prevLead: number | null = null;
  for (const n of ctx.featured) {
    const h = harmAt(ctx, n.start);
    const held = n.dur >= 0.75 || Math.abs(n.start - Math.round(n.start)) < 1e-6;
    let best = n.pitch - Math.round(want);
    let bestCost = Infinity;
    for (let d = 3; d <= 9; d++) {
      const p = n.pitch - d;
      const pc = mod(p, 12);
      if (!h.scale.includes(pc)) continue;
      if (held && !holdable(h, pc, ctx.style.id)) continue;
      let cost = Math.abs(d - want);
      if (d === 6) cost += 3; // no tritones against the tune
      if (prev !== null && prevLead !== null) {
        const leadMove = Math.sign(n.pitch - prevLead);
        const move = Math.sign(p - prev);
        if (leadMove !== 0 && move === 0) cost += 4; // stuck while the tune moves
        if (leadMove !== 0 && move === -leadMove) cost += 1.5;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = p;
      }
    }
    raw.push({ ...n, pitch: best, vel, art: n.dur >= 1 ? ("legato" as const) : undefined });
    prev = best;
    prevLead = n.pitch;
  }
  // one octave choice for the whole bar keeps the line a line
  const [lo, hi] = cello ? [45, 66] : [ctx.inst.range[0], Math.min(ctx.inst.range[1], Math.min(...ctx.featured.map((n) => n.pitch)) - 1)];
  return fitOctave(raw, lo, Math.max(lo + 14, hi), ctx.mem.lastPitch);
}

/**
 * Cello countermelody: voice-led guide tones held while the lead is busy, moving
 * stepwise toward the next chord in the lead's gaps.
 */
export function celloCounter(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.74);
  const lo = 45;
  const hi = 66;
  const busy = new Set<number>();
  for (const n of ctx.featured) {
    for (let b = Math.floor(n.start); b < Math.min(ctx.beats, n.start + n.dur); b++) busy.add(b);
  }
  const spans = chordSpans(ctx);
  for (let si = 0; si < spans.length; si++) {
    const s = spans[si];
    const h = harmAt(ctx, s.start);
    const prev = ctx.mem.lastGuide ?? 55;
    const target = fold(guideFor(ctx, h, prev), lo, hi);
    const len = s.end - s.start;
    const nh = spans[si + 1] ? harmAt(ctx, spans[si + 1].start) : ctx.harmony.at(ctx.start + ctx.beats);
    const nextTarget = fold(nearestPc(nh.guides[0], target), lo, hi);
    const gapStart = [...Array(Math.floor(len)).keys()].map((i) => s.start + i).find((b) => b >= s.start + 1 && !busy.has(b));
    if (len >= 2 && gapStart !== undefined && nextTarget !== target) {
      // hold, then walk toward the next chord's guide tone in the gap
      out.push({ pitch: target, start: s.start, dur: gapStart - s.start, vel, art: "legato" });
      const dir = Math.sign(nextTarget - target);
      let p = target;
      for (let t = gapStart; t < s.end - 1e-6; t += 1) {
        p = stepIn(p, dir, h.scale);
        if ((dir > 0 && p >= nextTarget) || (dir < 0 && p <= nextTarget)) p = nextTarget + (dir > 0 ? -1 : 1);
        out.push({ pitch: fold(p, lo, hi), start: t, dur: Math.min(1, s.end - t), vel: vel * 0.92 });
      }
      ctx.mem.lastGuide = p;
    } else if (len >= 4) {
      // the lead never pauses: move in half notes, one guide tone to the other
      const other = h.guides.map((pc) => nearestPc(pc, target)).find((p) => p !== target && Math.abs(p - target) <= 5) ?? stepIn(target, target > 55 ? -1 : 1, h.stable);
      out.push({ pitch: target, start: s.start, dur: len / 2, vel, art: "legato" });
      out.push({ pitch: fold(other, lo, hi), start: s.start + len / 2, dur: len / 2, vel: vel * 0.94, art: "legato" });
      ctx.mem.lastGuide = other;
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

/** Canon: imitate the featured line two beats later, a 4th (or an octave) lower. */
export function canon(ctx: BarCtx): NoteEvent[] {
  const delay = ctx.beats === 3 ? 3 : 2;
  const src = [...ctx.featuredPrev, ...ctx.featured]
    .map((n) => ({ ...n, start: n.start + delay }))
    .filter((n) => n.start >= 0 && n.start < ctx.beats);
  if (!src.length) return guide(ctx);
  const vel = velFor(ctx, 0.62);
  const down = ctx.peerIndex % 2 === 1 ? 7 : 3; // a second imitating voice answers an octave below
  const raw = src.map((n) => {
    const h = harmAt(ctx, n.start);
    let p = stepIn(n.pitch, -down, ctx.keyPcs);
    // strict imitation can land on a clash under the new harmony: held or strong-beat notes
    // bend to the chord, passing notes stay as written
    const strongBeat = Math.abs(n.start - Math.round(n.start)) < 1e-6;
    if ((strongBeat || n.dur >= 0.75) && !holdable(h, mod(p, 12), ctx.style.id)) p = nearestIn(p, h.stable, -1);
    else if (!h.scale.includes(mod(p, 12))) p = nearestIn(p, h.scale);
    return { ...n, pitch: p, vel, dur: Math.min(n.dur, ctx.beats - n.start) };
  });
  return fitOctave(raw, ctx.inst.range[0], ctx.inst.range[1], ctx.mem.lastPitch);
}

/** Riff: a short fragment of the motif as a backing figure, moved to each chord as a whole. */
export function riff(ctx: BarCtx): NoteEvent[] {
  if (!ctx.mem.riff) {
    const m = ctx.motif.notes;
    const frag = m.slice(0, Math.min(4, m.length));
    const t0 = frag[0]?.start ?? 0;
    // the riff answers in the back half of the bar (call-and-response with the lead)
    const offset = ctx.beats === 3 ? 1 : 2;
    ctx.mem.riff = frag
      .map((n) => ({ ...n, start: n.start - t0 + offset }))
      .filter((n) => n.start < ctx.beats)
      .map((n) => ({ ...n, dur: Math.min(n.dur, ctx.beats - n.start) }));
  }
  const riffNotes = ctx.mem.riff;
  if (!riffNotes.length) return [];
  const [lo, hi] = ctx.inst.sweet;
  const vel = velFor(ctx, 0.66);
  // move the figure to the chord: root motion from the motif's chord to this one
  const h0 = harmAt(ctx, riffNotes[0].start);
  const from = parseChord(ctx.motif.chord || h0.chord.symbol).root;
  let shift = mod(h0.chord.root - from, 12);
  if (shift > 6) shift -= 12;
  const raw: NoteEvent[] = [];
  let prev: number | null = null;
  for (const n of riffNotes) {
    const h = harmAt(ctx, n.start);
    let p = n.pitch + shift;
    const strong = n.dur >= 0.75 || Math.abs(n.start - Math.round(n.start)) < 1e-6;
    const dir = (prev === null ? 0 : Math.sign(p - prev)) as 1 | -1 | 0;
    if (strong && !holdable(h, mod(p, 12), ctx.style.id)) p = nearestIn(p, h.stable, dir);
    else if (!h.scale.includes(mod(p, 12)) && !h.blue.includes(mod(p, 12))) p = nearestIn(p, h.scale, dir);
    // a second horn harmonizes the riff a 3rd below rather than doubling it
    if (ctx.peerIndex % 2 === 1) {
      p = stepIn(p, -2, h.scale);
      if (strong && !holdable(h, mod(p, 12), ctx.style.id)) p = nearestIn(p, h.stable, -1);
    }
    raw.push({ ...n, pitch: p, vel, art: ctx.style.id === "funk" ? "staccato" : n.art });
    prev = p;
  }
  // backing figures sit in the lower half of the player's register, under the lead
  const leadLow = ctx.featured.length ? Math.min(...ctx.featured.map((n) => n.pitch)) : hi;
  const top = Math.max(lo + 14, Math.min(hi, leadLow - 1, Math.round((lo + hi) / 2) + 5));
  return fitOctave(raw, lo, top, ctx.mem.lastPitch ?? Math.round((lo + top) / 2));
}

/** Collective counter-line (New Orleans): busy above (clarinet/flute/violin), riffs or smears below. */
export function counter(ctx: BarCtx): NoteEvent[] {
  const high = ["clarinet", "flute", "violin"].includes(ctx.inst.id);
  const leadOnsets = ctx.featured.map((n) => ctx.start + n.start);
  if (high) {
    // an obligato above the lead, quieter, holding where the lead moves
    const leadTop = ctx.featured.length ? Math.max(...ctx.featured.map((n) => n.pitch)) : ctx.inst.sweet[0] + 7;
    const lo = Math.max(ctx.inst.sweet[0], Math.min(leadTop + 1, ctx.inst.sweet[1] - 12));
    return line(ctx, { lo, hi: ctx.inst.sweet[1], density: 0.8, vel: 0.72, avoid: leadOnsets });
  }
  if (ctx.inst.fn === "melodic" && ctx.peerIndex % 2 === 0 && ctx.rng.chance(0.5)) return riff(ctx);
  // trombone-style: long tones and slides under the lead
  const lo = ctx.inst.sweet[0];
  const leadLow = ctx.featured.length ? Math.min(...ctx.featured.map((n) => n.pitch)) : ctx.inst.sweet[1];
  const hi = Math.max(lo + 12, Math.min(ctx.inst.sweet[1], leadLow - 3));
  return line(ctx, { lo, hi, density: 0.55, vel: 0.7, avoid: leadOnsets });
}

/** A short pickup run into the next bar. */
export function melodicFill(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const nh = ctx.harmony.at(ctx.start + ctx.beats);
  const target = nearestIn(ctx.mem.lastPitch ?? (ctx.inst.sweet[0] + ctx.inst.sweet[1]) / 2, nh.tones);
  const n = ctx.style.line.density > 2 ? 4 : 2;
  const step = ctx.style.line.density > 2 ? 0.25 : 0.5;
  const h = harmAt(ctx, ctx.beats - n * step);
  let p = stepIn(target, -n, h.scale);
  const vel = velFor(ctx, 0.75);
  for (let i = 0; i < n; i++) {
    out.push({ pitch: fold(p, ctx.inst.range[0], ctx.inst.range[1]), start: ctx.beats - (n - i) * step, dur: step * 0.9, vel });
    p = stepIn(p, 1, h.scale);
  }
  ctx.mem.lastPitch = p;
  return out;
}

/** Melodic final note: the lead takes the root; everyone else a different chord tone. */
export function endNote(ctx: BarCtx): NoteEvent[] {
  const h = harmAt(ctx, 0);
  const mid = (ctx.inst.sweet[0] + ctx.inst.sweet[1]) / 2;
  const last = ctx.mem.lastPitch ?? mid;
  const others = [h.tones[1], h.tones[2], h.tones[3] ?? h.tones[0]].filter((x) => x !== undefined);
  const lead = ctx.role === "lead";
  const pc = lead ? h.chord.root : others[ctx.peerIndex % others.length];
  // the tune ends on top: the leader resolves up to the tonic rather than dropping under the band
  const near = lead ? Math.max(last + 2, mid - 2) : last;
  const p = fold(nearestPc(pc, near), ctx.inst.range[0], ctx.inst.range[1]);
  return [{ pitch: p, start: 0, dur: ctx.beats, vel: velFor(ctx, 0.75), art: "legato" }];
}

export { realizeMotifBar };
