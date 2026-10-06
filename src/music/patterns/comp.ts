import { chordAt, chordSpans, harmAt, velFor, type BarCtx } from "../context";
import type { Harm } from "../harmony";
import { hashString } from "../rng";
import { fold, mod, nearestPc, pitchesIn } from "../theory";
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

/**
 * Where to voice a chord: the instrument's comping range, kept under the melody that's
 * sounding around `pos` (a pianist voices below the tune, not on top of it).
 */
function voiceRange(ctx: BarCtx, pos?: number): [number, number] {
  const [lo, top] = compRange(ctx);
  if (!ctx.featured.length || ctx.role === "solo" || ctx.role === "lead") return [lo, top];
  const near = pos === undefined ? ctx.featured : ctx.featured.filter((n) => n.start + n.dur > pos - 0.25 && n.start < pos + 1.5);
  const tune = near.length ? near : ctx.featured;
  const low = Math.min(...tune.map((n) => n.pitch));
  if (low - 1 < 55) return [lo, top]; // a low solo: stay put rather than comp in the basement
  const hi = Math.min(top, low - 1);
  // room under the tune, but not down in the bassist's register
  const floor = Math.max(ctx.hasBass ? 48 : 43, Math.min(lo, hi - 15));
  // not enough room for a real voicing under it: comp in the usual place (lighter, see listen)
  if (hi - floor < 10) return compRange(ctx);
  return [floor, hi];
}

function voiceIn(ctx: BarCtx, h: Harm, fam: VoicingFamily, [lo, hi]: [number, number]): number[] {
  const v = voiceChord(h.chord, fam, lo, hi, ctx.mem.lastVoicing, h);
  ctx.mem.lastVoicing = v;
  return v;
}

function voice(ctx: BarCtx, h: Harm, fam = family(ctx), pos?: number): number[] {
  const [lo, hi] = voiceRange(ctx, pos);
  const v = voiceChord(h.chord, fam, lo, hi, ctx.mem.lastVoicing, h);
  ctx.mem.lastVoicing = v;
  return v;
}

/** The harmony a hit belongs to (an anticipation belongs to the next bar's chord). */
function harmOf(ctx: BarCtx, pos: number, next?: boolean): Harm {
  return next ? ctx.harmony.at(ctx.start + ctx.beats) : harmAt(ctx, pos);
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

// Jazz waltz: the "1 (2 3)" lilt, with the same variety as 4/4 comping.
const WALTZ_CELLS: Hit[][] = [
  [
    { pos: 1, dur: 0.5 },
    { pos: 2, dur: 0.5 },
  ],
  [{ pos: 0, dur: 1.5 }],
  [
    { pos: 0, dur: 0.5 },
    { pos: 1.5, dur: 0.5 },
  ],
  [{ pos: 1.5, dur: 0.5 }],
  [
    { pos: 1, dur: 1 },
    { pos: 2.5, dur: 0.5, next: true },
  ],
  [
    { pos: 0.5, dur: 0.5 },
    { pos: 2, dur: 0.5 },
  ],
];

/** Funk guitar sits up high: a 9th "grip" (3, 7, 9, 13) above the bass and keys. */
const FUNK_RANGE: [number, number] = [58, 79];

function playHits(ctx: BarCtx, hits: Hit[], fam?: VoicingFamily, art?: NoteEvent["art"], range?: [number, number]): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, ctx.style.id === "funk" ? 0.7 : 0.6);
  for (const h of hits) {
    if (h.pos >= ctx.beats) continue;
    const v = range ? voiceIn(ctx, harmOf(ctx, h.pos, h.next), fam ?? family(ctx), range) : voice(ctx, harmOf(ctx, h.pos, h.next), fam, h.pos);
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

/**
 * A second chordal player doesn't double the first: lighter shells, fewer hits, placed where
 * the first comper isn't (vibes over piano, guitar with keys).
 */
function secondComper(ctx: BarCtx, hits: Hit[]): Hit[] {
  if (ctx.peerIndex < 1 || hits.length <= 1) return hits;
  return hits.filter((_, i) => (i + ctx.bar + ctx.peerIndex) % 2 === 1);
}

/** Style-aware comping. Args: "sparse", "busy". */
export function comp(ctx: BarCtx): NoteEvent[] {
  if (ctx.peerIndex >= 1 && !["minimal", "baroque", "ambient", "neworleans"].includes(ctx.style.id)) {
    // the second comper: lighter and fewer, in the spaces of the first
    return compCore(ctx, true).map((n) => ({ ...n, vel: n.vel * 0.85 }));
  }
  return compCore(ctx, false);
}

function compCore(ctx: BarCtx, second: boolean): NoteEvent[] {
  const sparse = ctx.args.includes("sparse") || ctx.texture === "sparse";
  const busy = ctx.args.includes("busy") || ctx.texture === "peak";
  // the second comper takes a different cell than the first
  const pickCell = <T,>(cells: T[]) => cells[(hashString(`${ctx.seed}:${ctx.member.id}:${ctx.bar}`) + (second ? 1 : 0)) % cells.length];
  const play = (hits: Hit[], fam?: VoicingFamily, art?: NoteEvent["art"]) => playHits(ctx, second ? secondComper(ctx, hits) : hits, second ? "shell" : fam, art);

  switch (ctx.style.id) {
    case "bossa":
      return play(ctx.beats === 3 ? [{ pos: 0, dur: 1 }, { pos: 1.5, dur: 1 }] : BOSSA_BARS[(ctx.bar + (second ? 1 : 0)) % 2]);
    case "funk": {
      // a funk part is a riff: the same cell through the section (like the bass), a variation
      // at phrase ends, and the hits that would land on the bassist's notes step aside
      const sectionCell = (n: number) => FUNK_CELLS[(hashString(`${ctx.seed}:${ctx.member.id}:${ctx.section.start}`) + n + (second ? 1 : 0)) % FUNK_CELLS.length];
      let hits = sectionCell(ctx.phraseEnd ? 1 : 0);
      const bassAt = (pos: number) => (ctx.bassLine ?? []).some((n) => n.art !== "ghost" && Math.abs(n.start - pos) < 0.1);
      const clear = hits.filter((h) => !bassAt(h.pos));
      if (clear.length >= 2) hits = clear;
      if (sparse) hits = hits.slice(0, 2);
      return playHits(ctx, second ? secondComper(ctx, hits) : hits, second ? "shell" : "rootless", "staccato", FUNK_RANGE);
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
      let cell = pickCell(ctx.beats === 3 ? WALTZ_CELLS : SWING_CELLS);
      if (sparse && cell.length > 1 && ctx.rng.chance(0.5)) cell = [cell[0]];
      if (busy && ctx.rng.chance(0.5)) cell = [...cell, ...pickCell((ctx.beats === 3 ? WALTZ_CELLS : SWING_CELLS).slice(4))].filter((h, i, a) => a.findIndex((x) => x.pos === h.pos) === i);
      cell = listen(ctx, cell);
      // a chord change mid-bar must be acknowledged
      if (ctx.chords.length > 1 && !cell.some((h) => h.pos >= ctx.chords[1].beat - 0.5 && h.pos < ctx.beats)) {
        cell = [...cell, { pos: ctx.chords[1].beat, dur: 0.5 }];
      }
      return play(cell);
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
  const vel = velFor(ctx, 0.78);
  const out: NoteEvent[] = [];
  let prev = ctx.mem.lastVoicing;
  for (const h of hits) {
    if (h.pos >= ctx.beats) continue;
    const hm = harmOf(ctx, h.pos, h.next);
    const c = hm.chord;
    // guide-tone double-stop voice-led from the last one; root + fifth on downbeats now and then
    const g = hm.guides;
    const center = prev?.length ? prev[0] : 52;
    let pair = [nearestPc(g[0], center), 0];
    pair[1] = nearestPc(g[1], pair[0] + 5);
    if (pair[1] - pair[0] > 9) pair[1] -= 12;
    if (pair[1] <= pair[0]) pair[1] += 12;
    if (h.pos === 0 && ctx.rng.chance(0.25)) {
      const r = bassNote(c, 43, 55, null);
      pair = [r, r + (c.tones[2] ?? 7)]; // the chord's own fifth (a b5 over m7b5 and dim)
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
    const hm = harmAt(ctx, b);
    const [lo, hi] = voiceRange(ctx, b);
    const v = voiceChord(hm.chord, "triad", Math.max(Math.min(lo + 5, hi - 11), 48), hi, ctx.mem.lastVoicing, hm);
    ctx.mem.lastVoicing = v;
    out.push(...chordHit(v, b, 0.5, vel, "staccato"));
  }
  return out;
}

/**
 * Minimalist ostinato; the cell changes one note at a time (additive process). Players
 * sharing it interlock instead of doubling: the first plays broken-chord 8ths in the
 * middle, the second a 3-note cell on the offbeats up high (it phases against the bar),
 * the third a 3+3+2 pulse underneath. Horns and strings rock between two chord tones.
 */
export function arp(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.55);
  const melodic = ctx.inst.fn === "melodic";
  const variant = melodic ? 3 : ctx.peerIndex % 3;
  const regs: [number, number][] = [[55, 79], [64, 86], [45, 67], [ctx.inst.sweet[0] + 3, ctx.inst.sweet[1] - 3]];
  let [lo, hi] = regs[variant];
  lo = Math.max(lo, ctx.inst.range[0]);
  hi = Math.min(hi, ctx.inst.range[1]);
  // the ostinato is planned under the tune, so nothing has to be pulled out of it later
  if (ctx.featured.length && ctx.role !== "lead" && ctx.role !== "solo") {
    const tune = Math.min(...ctx.featured.map((n) => n.pitch));
    if (tune - 1 >= ctx.inst.range[0] + 12) hi = Math.min(hi, tune - 1);
  }
  if (hi - lo < 14) lo = Math.max(ctx.inst.range[0], hi - 14);
  const cells = [[0, 1, 2, 1, 0, 1, 2, 3], [2, 0, 1], [0, 2, 1], [0, 1]];
  if (!ctx.mem.arpCell) {
    ctx.mem.arpCell = cells[variant].slice(0, variant === 0 ? ctx.beats * 2 : undefined);
    ctx.mem.arpChangedAt = ctx.bar;
  } else if (ctx.bar - ctx.mem.arpChangedAt >= 2) {
    const cell = [...ctx.mem.arpCell];
    const i = ctx.rng.int(0, cell.length - 1);
    cell[i] = (cell[i] + ctx.rng.pick([1, 2, 3])) % 4;
    ctx.mem.arpCell = cell;
    ctx.mem.arpChangedAt = ctx.bar;
  }
  const cell = ctx.mem.arpCell;
  const eighths = Array.from({ length: ctx.beats * 2 }, (_, i) => i / 2);
  const grid =
    variant === 0 ? eighths : variant === 1 ? eighths.filter((t) => t % 1 !== 0 || t > 0) : variant === 2 ? (ctx.beats === 4 ? [0, 1.5, 3] : [0, 1.5]) : Array.from({ length: ctx.beats }, (_, i) => i);
  grid.forEach((t, gi) => {
    const hm = harmAt(ctx, t);
    const v = voiceChord(hm.chord, "triad", lo, hi, ctx.mem.lastVoicing, hm);
    const tones = v[0] + 12 <= hi + 5 ? [...v, v[0] + 12] : v;
    // the cell keeps cycling across bar lines, so a 3-note cell phases against the bar
    const k = variant === 1 ? Math.round((ctx.start + t) * 2) : gi;
    const p = tones[cell[k % cell.length] % tones.length];
    const nextT = grid[gi + 1] ?? ctx.beats;
    const dur = variant === 0 || variant === 1 ? 0.5 : nextT - t;
    out.push({ pitch: p, start: t, dur, vel: vel * (variant === 1 ? 0.85 : 1) * (t % 1 === 0 ? 1 : 0.88), art: variant >= 2 ? "legato" : undefined });
    if (gi === 0) ctx.mem.lastVoicing = v;
  });
  out.push(...leftHand(ctx, 0, ctx.beats, vel));
  return out;
}

/**
 * Baroque prelude figuration: held bass + inner voice, 16th arpeggio above (per half bar).
 * With a bassist in the band the left hand leaves the bass to them and keeps the tenor.
 */
export function prelude(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.55);
  const groupLen = ctx.beats === 3 ? 1 : 2;
  for (let g = 0; g < ctx.beats; g += groupLen) {
    const hm = harmAt(ctx, g);
    const c = hm.chord;
    const bass = ctx.inst.id === "piano" && !ctx.hasBass ? bassNote(c, 43, 55, ctx.mem.lastPitch) : null;
    const v = voiceChord(c, "triad", 60, 79, ctx.mem.lastVoicing, hm);
    ctx.mem.lastVoicing = v;
    if (bass !== null) {
      out.push({ pitch: bass, start: g, dur: groupLen, vel: vel * 0.95 });
      ctx.mem.lastPitch = bass;
    }
    const inner = nearestPc(mod(c.root + (c.tones[1] ?? 4), 12), 57);
    const innerAt = bass === null ? 0 : 0.25;
    if (ctx.inst.id === "piano") out.push({ pitch: inner, start: g + innerAt, dur: groupLen - innerAt, vel: vel * 0.8 });
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
    const v = voice(ctx, harmAt(ctx, b), "triad", b);
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
    // the chord carried over from last bar is still ringing: let it float rather than re-strike
    if (s.start === 0 && ctx.mem.padHeldUntil > ctx.start + 1e-6 && s.chord.symbol === ctx.prev.symbol) continue;
    // the harmony doesn't move at the barline: hold through into the next bar (one bar at most)
    const holdOver = s.end >= ctx.beats - 1e-6 && !ctx.lastBar && ctx.next.symbol === s.chord.symbol && !(s.start === 0 && ctx.mem.padHeldUntil > ctx.start + 1e-6);
    const dur = s.end - s.start + (holdOver ? ctx.beats : 0);
    // a second chordal pad thins to a shell instead of doubling the first player's voicing
    const fam = ctx.peerIndex >= 1 ? "shell" : ctx.style.voicing === "rootless" ? "open" : ctx.style.voicing;
    const v = voice(ctx, harmAt(ctx, s.start), fam, s.start);
    out.push(...chordHit(v, s.start, dur, vel * (ctx.peerIndex >= 1 ? 0.8 : 1), "legato"));
    if (!ctx.hasBass && ctx.inst.id === "piano") out.push(...leftHand(ctx, s.start, dur, vel));
    ctx.mem.padHeldUntil = holdOver ? ctx.start + ctx.beats * 2 : -1;
  }
  return out;
}

/** Ambient shimmer: a few high bell tones (chord tones + tensions) with space. */
export function shimmer(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.42);
  const hm = harmAt(ctx, 0);
  const c = hm.chord;
  // bells ring high, but under the tune when someone is carrying it
  let [blo, bhi] = [67, 88];
  if (ctx.featured.length) {
    const tune = Math.min(...ctx.featured.map((n) => n.pitch));
    if (tune - 1 >= 62) [blo, bhi] = [Math.max(55, tune - 19), tune - 1];
  }
  const pool = pitchesIn(hm.stable, blo, bhi);
  const count = ctx.rng.int(1, ctx.energy > 0.6 ? 4 : 2);
  const slots = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].filter((x) => x < ctx.beats);
  const used = new Set<number>();
  for (let i = 0; i < count; i++) used.add(ctx.rng.pick(slots));
  // the bells make a slow line: mostly 4ths and 5ths from the last one, rarely the same note again
  const leapWeight = (p: number) => {
    const last = ctx.mem.lastPitch;
    if (last === null || last < blo - 12 || last > bhi + 12) return 1;
    const iv = Math.abs(p - last);
    return iv === 5 || iv === 7 ? 8 : iv === 0 ? 0.2 : iv <= 12 ? 1 : 0.3;
  };
  for (const pos of pool.length ? [...used].sort((a, b) => a - b) : []) {
    const p = ctx.rng.weighted(pool, pool.map(leapWeight));
    ctx.mem.lastPitch = p;
    out.push({ pitch: p, start: pos, dur: Math.max(1, ctx.beats - pos), vel: vel * (0.8 + ctx.rng.next() * 0.3) });
  }
  // a soft low pad underneath
  if (ctx.inst.id === "piano") {
    const v = voiceChord(c, "quartal", 50, 70, ctx.mem.lastVoicing, hm);
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
  const hm = harmAt(ctx, 0);
  const c = hm.chord;
  const [lo, hi] = compRange(ctx);
  const fam = ctx.style.voicing === "rootless" ? "open" : ctx.style.voicing;
  const v = voiceChord(c, fam, lo, hi, ctx.mem.lastVoicing, hm);
  const vel = velFor(ctx, 0.7);
  const out = chordHit(v, 0, ctx.beats, vel, "legato");
  if (ctx.inst.id === "piano") {
    out.push({ pitch: bassNote(c, 31, 45, null), start: 0, dur: ctx.beats, vel });
    out.push({ pitch: fold(v[v.length - 1] + 12, 60, 96), start: 0, dur: ctx.beats, vel: vel * 0.9 });
  }
  return out;
}
