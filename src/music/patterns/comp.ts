import { chordAt, chordSpans, velFor, type BarCtx } from "../context";
import { hashString } from "../rng";
import { chordPcs, fold, guideTonePcs, mod, nearestPc, pitchesIn, type Chord } from "../theory";
import type { NoteEvent } from "../types";
import { strideBass } from "./bass";
import { bassNote, voiceChord, type VoicingFamily } from "./voicing";

function compRange(ctx: BarCtx): [number, number] {
  switch (ctx.inst.id) {
    case "guitar":
      return [50, 76];
    case "vibes":
      return [57, 84];
    case "cello":
      return [41, 69];
    case "piano":
      return [50, 77];
    default:
      return [Math.max(ctx.inst.range[0], 48), Math.min(ctx.inst.range[1], 79)];
  }
}

function family(ctx: BarCtx): VoicingFamily {
  if (ctx.inst.id === "guitar" && ctx.style.voicing === "rootless") return "shell";
  return ctx.style.voicing;
}

function voice(ctx: BarCtx, c: Chord, fam = family(ctx)): number[] {
  const [lo, hi] = compRange(ctx);
  const v = voiceChord(c, fam, lo, hi, ctx.mem.lastVoicing);
  ctx.mem.lastVoicing = v;
  return v;
}

function chordHit(pitches: number[], start: number, dur: number, vel: number, art?: NoteEvent["art"]): NoteEvent[] {
  return pitches.map((p, i) => ({ pitch: p, start, dur, vel: vel * (i === pitches.length - 1 ? 1.05 : 0.95), art }));
}

/** Left-hand root when the pianist has no bassist to lean on. */
function leftHand(ctx: BarCtx, start: number, dur: number, vel: number): NoteEvent[] {
  if (ctx.hasBass || ctx.inst.id !== "piano") return [];
  const c = chordAt(ctx, start);
  return [{ pitch: bassNote(c, 36, 50, null), start, dur, vel: vel * 0.9 }];
}

type Hit = { pos: number; dur: number; next?: boolean };

const SWING_CELLS: Hit[][] = [
  [
    { pos: 0, dur: 0.5 },
    { pos: 1.5, dur: 0.5 },
  ],
  [
    { pos: 1.5, dur: 0.5 },
    { pos: 3.5, dur: 0.5, next: true },
  ],
  [
    { pos: 0.5, dur: 0.5 },
    { pos: 2.5, dur: 0.5 },
  ],
  [
    { pos: 0, dur: 1.5 },
    { pos: 2.5, dur: 0.5 },
  ],
  [{ pos: 3.5, dur: 0.5, next: true }],
  [
    { pos: 1, dur: 0.5 },
    { pos: 2.5, dur: 0.5 },
  ],
];

const BOSSA_BARS: Hit[][] = [
  [
    { pos: 0, dur: 1 },
    { pos: 1.5, dur: 1 },
    { pos: 3, dur: 0.5 },
  ],
  [
    { pos: 0.5, dur: 1 },
    { pos: 2, dur: 0.5 },
    { pos: 2.5, dur: 1 },
  ],
];

const FUNK_CELLS: Hit[][] = [
  [
    { pos: 0.5, dur: 0.25 },
    { pos: 0.75, dur: 0.25 },
    { pos: 2.5, dur: 0.25 },
    { pos: 3.25, dur: 0.25 },
  ],
  [
    { pos: 0.25, dur: 0.25 },
    { pos: 1.5, dur: 0.25 },
    { pos: 1.75, dur: 0.25 },
    { pos: 3.5, dur: 0.25 },
  ],
  [
    { pos: 1, dur: 0.25 },
    { pos: 1.75, dur: 0.25 },
    { pos: 3, dur: 0.25 },
    { pos: 3.75, dur: 0.25 },
  ],
];

function playHits(ctx: BarCtx, hits: Hit[], fam?: VoicingFamily, art?: NoteEvent["art"]): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, ctx.style.id === "funk" ? 0.7 : 0.6);
  for (const h of hits) {
    if (h.pos >= ctx.beats) continue;
    const c = h.next ? ctx.next : chordAt(ctx, h.pos);
    const v = voice(ctx, c, fam);
    const dur = Math.min(h.dur, ctx.beats - h.pos);
    out.push(...chordHit(v, h.pos, dur, vel * (h.pos % 1 === 0.5 ? 1.05 : 1), art));
    if (h.pos === 0 || ctx.chords.some((x) => x.beat === h.pos)) out.push(...leftHand(ctx, h.pos, Math.max(dur, 1), vel));
  }
  return out;
}

/**
 * Comping listens: stay out of the soloist's busy beats and answer in their gaps.
 * (Only when someone else is featured in this bar.)
 */
function listen(ctx: BarCtx, cell: Hit[]): Hit[] {
  if (!ctx.featured.length || ctx.role === "solo" || ctx.role === "lead") return cell;
  const onsets = ctx.featured.map((n) => n.start);
  const busyAt = (pos: number) => onsets.some((o) => Math.abs(o - pos) < 0.3);
  const lastOnset = Math.max(...onsets);
  let out = cell.filter((h, i) => i === 0 || !busyAt(h.pos));
  if (onsets.length >= 6) out = out.slice(0, 2); // a busy line wants space
  // the soloist left the back of the bar open: answer them there
  if (lastOnset < ctx.beats - 1.5 && !out.some((h) => h.pos > lastOnset + 0.5)) {
    const pos = lastOnset + 1 <= ctx.beats - 0.5 ? Math.ceil((lastOnset + 0.75) * 2) / 2 : ctx.beats - 0.5;
    out = [...out, { pos, dur: 0.5 }, ...(pos + 1 < ctx.beats ? [{ pos: pos + 1, dur: 0.5 }] : [])];
  }
  return out.filter((h, i, a) => h.pos < ctx.beats && a.findIndex((x) => x.pos === h.pos) === i).sort((a, b) => a.pos - b.pos);
}

/** Style-aware comping. Args: "sparse", "busy". */
export function comp(ctx: BarCtx): NoteEvent[] {
  const sparse = ctx.args.includes("sparse") || ctx.texture === "sparse";
  const busy = ctx.args.includes("busy") || ctx.texture === "peak";
  const pickCell = <T,>(cells: T[]) => cells[hashString(`${ctx.seed}:${ctx.member.id}:${ctx.bar}`) % cells.length];

  switch (ctx.style.id) {
    case "bossa":
      return playHits(ctx, ctx.beats === 3 ? [{ pos: 0, dur: 1 }, { pos: 1.5, dur: 1 }] : BOSSA_BARS[ctx.bar % 2]);
    case "funk": {
      const cell = pickCell(FUNK_CELLS);
      const hits = sparse ? cell.slice(0, 2) : cell;
      return playHits(ctx, hits, "shell", "staccato");
    }
    case "neworleans":
      return stride(ctx);
    case "minimal":
      return arp(ctx);
    case "baroque":
      return prelude(ctx);
    case "ambient":
      return pad(ctx);
    case "swing":
    default: {
      if (ctx.beats === 3) {
        return playHits(ctx, sparse ? [{ pos: 1, dur: 0.5 }] : [{ pos: 1, dur: 0.5 }, { pos: 2, dur: 0.5 }]);
      }
      let cell = pickCell(SWING_CELLS);
      if (sparse && cell.length > 1 && ctx.rng.chance(0.5)) cell = [cell[0]];
      if (busy && ctx.rng.chance(0.5)) cell = [...cell, ...pickCell(SWING_CELLS.slice(4))].filter((h, i, a) => a.findIndex((x) => x.pos === h.pos) === i);
      cell = listen(ctx, cell);
      // a chord change mid-bar must be acknowledged
      if (ctx.chords.length > 1 && !cell.some((h) => h.pos >= ctx.chords[1].beat - 0.5 && h.pos < ctx.beats)) {
        cell = [...cell, { pos: ctx.chords[1].beat, dur: 0.5 }];
      }
      return playHits(ctx, cell);
    }
  }
}

/**
 * Cello pizzicato comping: plucked double-stops (guide tones, sometimes root + fifth)
 * in the style's comping rhythm, low in the tenor register so they sit under the lead.
 */
export function pizz(ctx: BarCtx): NoteEvent[] {
  const sparse = ctx.args.includes("sparse") || ctx.texture === "sparse";
  const busy = ctx.args.includes("busy") || ctx.texture === "peak";
  const pick = <T,>(cells: T[]) => cells[hashString(`${ctx.seed}:${ctx.member.id}:pizz:${ctx.bar}`) % cells.length];
  let hits: Hit[];
  switch (ctx.style.id) {
    case "bossa":
      hits = ctx.beats === 3 ? [{ pos: 0, dur: 1 }, { pos: 1.5, dur: 1 }] : BOSSA_BARS[(ctx.bar + 1) % 2];
      break;
    case "funk":
      hits = pick(FUNK_CELLS);
      break;
    case "neworleans":
      hits = ctx.beats === 3 ? [{ pos: 0, dur: 1 }] : [{ pos: 0, dur: 1 }, { pos: 2, dur: 1 }];
      break;
    default:
      hits = ctx.beats === 3 ? [{ pos: 0, dur: 1 }, { pos: 2, dur: 1 }] : sparse ? [{ pos: 0, dur: 1 }, { pos: 2, dur: 1 }] : pick(SWING_CELLS);
  }
  if (sparse && hits.length > 2) hits = hits.slice(0, 2);
  if (busy && ctx.style.id === "swing" && ctx.beats === 4) hits = [...hits, { pos: 3.5, dur: 0.5, next: true }].filter((h, i, a) => a.findIndex((x) => x.pos === h.pos) === i);
  const vel = velFor(ctx, 0.62);
  const out: NoteEvent[] = [];
  let prev = ctx.mem.lastVoicing;
  for (const h of hits) {
    if (h.pos >= ctx.beats) continue;
    const c = h.next ? ctx.next : chordAt(ctx, h.pos);
    // guide-tone double-stop voice-led from the last one; root + fifth on downbeats now and then
    const g = guideTonePcs(c);
    const center = prev?.length ? prev[0] : 52;
    let pair = [nearestPc(g[0], center), 0];
    pair[1] = nearestPc(g[1], pair[0] + 5);
    if (pair[1] - pair[0] > 9) pair[1] -= 12;
    if (pair[1] <= pair[0]) pair[1] += 12;
    if (h.pos === 0 && ctx.rng.chance(0.25)) {
      const r = bassNote(c, 43, 55, null);
      pair = [r, r + 7];
    }
    pair = pair.map((p) => fold(p, 43, 69)).sort((a, b) => a - b);
    prev = pair;
    const dur = Math.min(h.dur, 0.5, ctx.beats - h.pos);
    for (const p of pair) out.push({ pitch: p, start: h.pos, dur, vel: vel * (h.pos % 1 ? 1.05 : 1), art: "pizz" });
  }
  ctx.mem.lastVoicing = prev;
  return out;
}

/** Stride / oom-pah: low root on 1 and 3, chord on 2 and 4. */
export function stride(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.62);
  const bassPart = ctx.inst.id === "piano" ? strideBass(ctx) : [];
  if (ctx.hasBass) bassPart.forEach((n) => (n.vel *= 0.7));
  out.push(...bassPart);
  const offs = ctx.beats === 3 ? [1, 2] : [1, 3];
  for (const b of offs) {
    const c = chordAt(ctx, b);
    const [lo, hi] = compRange(ctx);
    const v = voiceChord(c, "triad", Math.max(lo, 55), hi, ctx.mem.lastVoicing);
    ctx.mem.lastVoicing = v;
    out.push(...chordHit(v, b, 0.5, vel, "staccato"));
  }
  return out;
}

/** Minimalist broken-chord ostinato in 8ths; the cell changes one note at a time. */
export function arp(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.55);
  const steps = ctx.beats * 2;
  const [lo, hi] = compRange(ctx);
  if (!ctx.mem.arpCell) {
    const base = [0, 1, 2, 1, 0, 1, 2, 3];
    ctx.mem.arpCell = base.slice(0, steps);
    ctx.mem.arpChangedAt = ctx.bar;
  } else if (ctx.bar - ctx.mem.arpChangedAt >= 2) {
    // additive process: change one cell index
    const cell = [...ctx.mem.arpCell];
    const i = ctx.rng.int(0, cell.length - 1);
    cell[i] = (cell[i] + ctx.rng.pick([1, 2, 3])) % 4;
    ctx.mem.arpCell = cell;
    ctx.mem.arpChangedAt = ctx.bar;
  }
  const cell = ctx.mem.arpCell;
  for (let i = 0; i < steps; i++) {
    const t = i / 2;
    const c = chordAt(ctx, t);
    const v = voiceChord(c, "triad", Math.max(lo, 55), Math.min(hi + 5, 84), ctx.mem.lastVoicing);
    const tones = [...v, v[0] + 12];
    const p = tones[cell[i % cell.length] % tones.length];
    out.push({ pitch: p, start: t, dur: 0.5, vel: vel * (i % 2 === 0 ? 1 : 0.85) });
    if (i === 0) ctx.mem.lastVoicing = v;
  }
  out.push(...leftHand(ctx, 0, ctx.beats, vel));
  return out;
}

/** Baroque prelude figuration: held bass + inner voice, 16th arpeggio above (per half bar). */
export function prelude(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.55);
  const groupLen = ctx.beats === 3 ? 1 : 2;
  for (let g = 0; g < ctx.beats; g += groupLen) {
    const c = chordAt(ctx, g);
    const bass = ctx.inst.id === "piano" ? bassNote(c, 43, 55, ctx.mem.lastPitch) : null;
    const v = voiceChord(c, "triad", 60, 79, ctx.mem.lastVoicing);
    ctx.mem.lastVoicing = v;
    if (bass !== null) {
      out.push({ pitch: bass, start: g, dur: groupLen, vel: vel * 0.95 });
      ctx.mem.lastPitch = bass;
    }
    const inner = nearestPc(mod(c.root + (c.tones[1] ?? 4), 12), 57);
    if (ctx.inst.id === "piano") out.push({ pitch: inner, start: g + 0.25, dur: groupLen - 0.25, vel: vel * 0.8 });
    const fig = [v[0], v[1], v[2], v[0] + 12, v[2], v[1]];
    const start = ctx.inst.id === "piano" ? 0.5 : 0;
    for (let i = 0; start + i * 0.25 < groupLen - 1e-6; i++) {
      out.push({ pitch: fig[i % fig.length], start: g + start + i * 0.25, dur: 0.25, vel: vel * (i % 2 === 0 ? 0.95 : 0.8) });
    }
  }
  return out;
}

/** Continuo: block chords on strong beats with the bass doubled. */
export function continuo(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.55);
  const step = ctx.beats === 3 ? 1 : 2;
  for (let b = 0; b < ctx.beats; b += step) {
    const c = chordAt(ctx, b);
    const v = voice(ctx, c, "triad");
    out.push(...chordHit(v, b, step, vel));
    out.push(...leftHand(ctx, b, step, vel));
  }
  return out;
}

/** Sustained pad voicing per chord. */
export function pad(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.45);
  for (const s of chordSpans(ctx)) {
    const v = voice(ctx, s.chord, ctx.style.voicing === "rootless" ? "open" : ctx.style.voicing);
    out.push(...chordHit(v, s.start, s.end - s.start, vel, "legato"));
    if (!ctx.hasBass && ctx.inst.id === "piano") out.push(...leftHand(ctx, s.start, s.end - s.start, vel));
  }
  return out;
}

/** Ambient shimmer: a few high bell tones (chord tones + tensions) with space. */
export function shimmer(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.42);
  const c = chordAt(ctx, 0);
  const pcs = [...chordPcs(c), ...c.tensions.map((t) => mod(c.root + t, 12)), mod(c.root + 14, 12)];
  const pool = pitchesIn(pcs, 67, 88);
  const count = ctx.rng.int(1, ctx.energy > 0.6 ? 4 : 2);
  const slots = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].filter((x) => x < ctx.beats);
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    const pos = ctx.rng.pick(slots);
    if (used.has(pos)) continue;
    used.add(pos);
    const p = ctx.rng.pick(pool);
    out.push({ pitch: p, start: pos, dur: Math.max(1, ctx.beats - pos), vel: vel * (0.8 + ctx.rng.next() * 0.3) });
  }
  // a soft low pad underneath
  if (ctx.inst.id === "piano") {
    const v = voiceChord(c, "quartal", 50, 70, ctx.mem.lastVoicing);
    ctx.mem.lastVoicing = v;
    out.push(...chordHit(v, 0, ctx.beats, vel * 0.7, "legato"));
  }
  return out;
}

/** Stop-time hits: tutti chord on 1 (and &2 at high energy). */
export function hits(ctx: BarCtx): NoteEvent[] {
  const pos = ctx.energy > 0.7 && ctx.beats === 4 ? [0, 1.5] : [0];
  return playHits(
    ctx,
    pos.map((p) => ({ pos: p, dur: 0.5 })),
    undefined,
    "accent",
  );
}

/** Final chord, held through the bar. */
export function endChord(ctx: BarCtx): NoteEvent[] {
  const c = chordAt(ctx, 0);
  const [lo, hi] = compRange(ctx);
  const fam = ctx.style.voicing === "rootless" ? "open" : ctx.style.voicing;
  const v = voiceChord(c, fam, lo, hi, ctx.mem.lastVoicing);
  const vel = velFor(ctx, 0.7);
  const out = chordHit(v, 0, ctx.beats, vel, "legato");
  if (ctx.inst.id === "piano") {
    out.push({ pitch: bassNote(c, 31, 45, null), start: 0, dur: ctx.beats, vel });
    out.push({ pitch: fold(v[v.length - 1] + 12, 60, 96), start: 0, dur: ctx.beats, vel: vel * 0.9 });
  }
  return out;
}
