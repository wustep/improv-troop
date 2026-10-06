import { harmAt, velFor, type BarCtx } from "../context";
import { holdable, nearestIn, stepIn, stepsBetween, type Harm } from "../harmony";
import { parseCell } from "../motif";
import { mod, SCALES } from "../theory";
import type { NoteEvent, StyleId } from "../types";

// Improvised lines are planned a phrase at a time, the way a player thinks: where the
// phrase starts (often a pickup), how it moves (a contour), where it lands (a chord tone
// on a strong beat, held), and the breath after it. Rhythm comes from whole-beat units so
// triplets and 16ths never get spliced into the middle of each other; pitch comes from a
// skeleton of chord tones on the beats, joined by scale steps, approach notes and
// enclosures. The next phrase often answers the last one's rhythm.

type Shape = "arch" | "rise" | "fall" | "valley" | "wave";

interface PhraseStyle {
  /** Rhythm units (one or two beats each) by density: sparse, normal, dense. */
  units: [string[], string[], string[]];
  /** Unit used to start a phrase on the offbeat. */
  pickupUnit: string;
  /** Phrase body length in beats before the landing note. */
  length: [number, number];
  /** Landing note length in beats. */
  landing: [number, number];
  /** Rest after a phrase, in beats. */
  breath: [number, number];
  pickup: number;
  /** Chance the landing arrives an 8th early (on the "and"), tied over the beat. */
  anticipate: number;
  /** Chance a phrase reuses the last phrase's rhythm; and of that, its pitches (riff / sequence). */
  echo: number;
  pitchEcho: number;
  /** Diatonic steps a pitch echo moves by (a sequence). */
  sequence: number[];
  shapes: Shape[];
  /** Contour span in semitones [normal, dense]. */
  span: [number, number];
  chromatic: number;
  /** Chance a gap between beat notes is crossed by chord tones instead of scale steps. */
  arpeggio: number;
  staccato: number;
  /** Land on 3rds and 7ths. */
  guide: boolean;
  /** Fill notes come from the chord's pentatonic. */
  pentatonic?: boolean;
  /** Units for a solo's climax: runs of the style's fastest notes (a fourth density tier). */
  runs?: string[];
}

const PHRASE: Record<StyleId, PhraseStyle> = {
  swing: {
    runs: ["8t 8t 8t", "8 8", "16 16 16 16", "8t 8t 8t"],
    units: [
      ["4", "r/8 8", "2", "4", "8 8"],
      ["8 8", "8 8", "8 8", "8 8", "4", "r/8 8", "8t 8t 8t"],
      ["8 8", "8 8", "8 8", "8t 8t 8t", "8 8"],
    ],
    pickupUnit: "r/8 8",
    length: [4, 8],
    landing: [1, 2],
    breath: [0.5, 2],
    pickup: 0.65,
    anticipate: 0.35,
    echo: 0.3,
    pitchEcho: 0.25,
    sequence: [-1, 1, 2],
    shapes: ["arch", "fall", "wave", "fall", "rise", "valley"],
    span: [7, 12],
    chromatic: 0.45,
    arpeggio: 0.25,
    staccato: 0.1,
    guide: true,
  },
  bossa: {
    runs: ["8 8", "8 8", "16 16 8"],
    units: [
      ["4", "2", "4", "r/8 8"],
      ["4", "8 8", "r/8 8", "4", "4. 8", "4"],
      ["8 8", "8 8", "4", "r/8 8"],
    ],
    pickupUnit: "r/8 8",
    length: [3, 7],
    landing: [1.5, 3],
    breath: [1, 2],
    pickup: 0.4,
    anticipate: 0.45,
    echo: 0.4,
    pitchEcho: 0.35,
    sequence: [-1, -2, 1],
    shapes: ["fall", "arch", "valley", "wave", "fall"],
    span: [5, 9],
    chromatic: 0.1,
    arpeggio: 0.3,
    staccato: 0.03,
    guide: true,
  },
  funk: {
    runs: ["16 16 16 16", "16 16 8", "16 16 16 16"],
    units: [
      ["8 r/8", "r/16 16 r/8", "16 16 r/8", "r/4"],
      ["16 16 r/8", "r/16 16 16 16", "8 r/8", "16 r/16 8", "r/8 16 16", "8 16 16"],
      ["16 16 16 16", "16 16 r/8", "r/16 16 16 16", "8 16 16"],
    ],
    pickupUnit: "r/16 16 16 16",
    length: [1.5, 3.5],
    landing: [0.25, 1],
    breath: [0.5, 1.5],
    pickup: 0.5,
    anticipate: 0.4,
    echo: 0.6,
    pitchEcho: 0.6,
    sequence: [0, 0, 2],
    shapes: ["wave", "valley", "arch"],
    span: [3, 7],
    chromatic: 0.1,
    arpeggio: 0.2,
    staccato: 0.55,
    guide: false,
    pentatonic: true,
  },
  pop: {
    runs: ["8 8", "16 16 8", "8 8"],
    // a singable line: short cells, mostly steps, the same rhythm answered (a hook)
    units: [
      ["4", "2", "4", "r/8 8"],
      ["8 8", "4", "r/8 8", "4. 8", "4"],
      ["8 8", "8 8", "4", "r/8 8"],
    ],
    pickupUnit: "r/8 8",
    length: [3, 7],
    landing: [1, 2],
    breath: [1, 2],
    pickup: 0.45,
    anticipate: 0.5,
    echo: 0.6,
    pitchEcho: 0.5,
    sequence: [0, -1, 1],
    shapes: ["arch", "fall", "wave", "arch"],
    span: [5, 9],
    chromatic: 0.03,
    arpeggio: 0.3,
    staccato: 0.05,
    guide: false,
    pentatonic: true,
  },
  neworleans: {
    runs: ["8t 8t 8t", "8 8", "8t 8t 8t"],
    units: [
      ["4", "4", "8 8", "r/8 8"],
      ["8 8", "4", "8 8", "r/8 8", "4t 4t 4t"],
      ["8 8", "8 8", "8t 8t 8t", "4"],
    ],
    pickupUnit: "r/8 8",
    length: [2, 6],
    landing: [1, 2],
    breath: [0.5, 1.5],
    pickup: 0.5,
    anticipate: 0.4,
    echo: 0.45,
    pitchEcho: 0.4,
    sequence: [0, 1, -1],
    shapes: ["arch", "fall", "wave"],
    span: [5, 9],
    chromatic: 0.2,
    arpeggio: 0.35,
    staccato: 0.12,
    guide: false,
  },
  minimal: {
    units: [["8 8"], ["8 8"], ["8 8"]],
    pickupUnit: "r/8 8",
    length: [6, 14],
    landing: [0.5, 1],
    breath: [0, 1],
    pickup: 0,
    anticipate: 0,
    echo: 0.85,
    pitchEcho: 0.8,
    sequence: [0],
    shapes: ["wave", "arch"],
    span: [5, 7],
    chromatic: 0,
    arpeggio: 0.7,
    staccato: 0.05,
    guide: false,
  },
  baroque: {
    units: [
      ["8 8", "4", "8 8"],
      ["16 16 16 16", "8 8", "16 16 8", "8 16 16"],
      ["16 16 16 16", "16 16 16 16", "8 16 16"],
    ],
    pickupUnit: "r/16 16 16 16",
    length: [6, 14],
    landing: [1, 2],
    breath: [0, 0.5],
    pickup: 0.15,
    anticipate: 0,
    echo: 0.55,
    pitchEcho: 0.7,
    sequence: [-1, -1, 1],
    shapes: ["fall", "rise", "arch", "wave"],
    span: [7, 12],
    chromatic: 0.05,
    arpeggio: 0.35,
    staccato: 0.08,
    guide: false,
  },
  ambient: {
    units: [["2", "4", "2"], ["4", "2", "4"], ["4", "8 8", "4"]],
    pickupUnit: "r/8 8",
    length: [2, 6],
    landing: [2, 4],
    breath: [2, 4],
    pickup: 0.2,
    anticipate: 0,
    echo: 0.3,
    pitchEcho: 0.2,
    sequence: [1, -1],
    shapes: ["arch", "fall", "valley"],
    span: [5, 9],
    chromatic: 0,
    arpeggio: 0.6,
    staccato: 0,
    guide: false,
  },
};

const SHAPE: Record<Shape, (x: number) => number> = {
  arch: (x) => Math.sin(Math.PI * x),
  rise: (x) => (x < 0.8 ? x / 0.8 : 1 - (x - 0.8) * 1.5),
  fall: (x) => -x,
  valley: (x) => -Math.sin(Math.PI * x),
  wave: (x) => 0.6 * Math.sin(2 * Math.PI * x),
};

function shapeRange(s: Shape): [number, number] {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i <= 20; i++) {
    const v = SHAPE[s](i / 20);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

export interface LineOpts {
  /** Register for the line. */
  lo?: number;
  hi?: number;
  /** Multiplies the density (0.5 sparse … 1.5 dense). */
  density?: number;
  /** Velocity scale for supporting lines. */
  vel?: number;
  /** Rhythm the phrase steers clear of (onsets of the featured line, absolute). */
  avoid?: number[];
}

interface Slot {
  start: number; // absolute
  dur: number;
}

const EPS = 1e-6;
const strongIn = (beats: number) => (beats === 3 ? [0] : beats === 4 ? [0, 2] : [0]);

function isStrong(ctx: BarCtx, abs: number): boolean {
  const beats = ctx.beats;
  const rel = mod(abs, beats);
  return strongIn(beats).some((s) => Math.abs(rel - s) < EPS);
}

function tierOf(ctx: BarCtx, opts: LineOpts): number {
  let d = (opts.density ?? 1) * (0.6 + ctx.energy * 0.6);
  if (ctx.args.includes("dense") || ctx.args.includes("run")) d *= 1.45;
  if (ctx.args.includes("sparse")) d *= 0.6;
  if (ctx.texture === "sparse") d *= 0.8;
  // a solo is a story: each phrase gets busier the further into the solo it starts
  if (ctx.role === "solo" && ctx.section.length >= 4) d *= 0.75 + 0.6 * ((ctx.barInSection + 0.5) / ctx.section.length);
  if (ctx.texture === "build") d *= 1.1;
  // stop-time and breakdowns clear the floor for the soloist: fill it
  if ((ctx.texture === "stoptime" || ctx.texture === "breakdown") && ctx.role === "solo") d *= 1.3;
  if (ctx.texture === "peak") d *= 1.2;
  // a climax (a dense bar late in a solo, at a peak) gets the fourth tier: runs
  return d < 0.62 ? 0 : d < 1.12 ? 1 : d < 1.75 ? 2 : 3;
}

/** Plan the rhythm of one phrase starting at `t0`, finishing (landing included) by `end`. */
function phraseRhythm(ctx: BarCtx, ps: PhraseStyle, t0: number, end: number, tier: number, opts: { landAt?: number; landDur?: number; units?: string[]; avoid?: number[] }) {
  const rng = ctx.rng;
  const breathMax = ctx.inst.breath ?? 99;
  // phrases start on the style's grid: 8ths, or 16ths where the style lives on them
  const grid = ps.units[2].some((u) => u.includes("16")) ? 0.25 : 0.5;
  const q = (x: number) => Math.max(grid, Math.round(x / grid) * grid);
  // a busier player lands shorter and breathes quicker; a sparse one lets it ring
  const ease = tier === 3 ? 0.3 : tier === 2 ? 0.45 : tier === 0 ? 1.8 : 1;
  const breathAfter = (landEnd: number) => {
    const b = q((ps.breath[0] + rng.next() * (ps.breath[1] - ps.breath[0])) * ease) - (ps.breath[0] === 0 && rng.chance(0.5) ? grid : 0);
    // the breath belongs to this run of bars: the next instruction starts fresh
    return Math.min(Math.ceil((landEnd + Math.max(0, b)) / grid - EPS) * grid, Math.max(landEnd, end));
  };

  // ── an answer: the last phrase's whole rhythm again, landing included ──
  const prev = ctx.mem.lastRhythm;
  if (!opts.units && opts.landAt === undefined && prev && prev.length >= 3 && ctx.mem.lastTier === tier && rng.chance(ps.echo)) {
    const r0 = prev[0].start;
    const lastR = prev[prev.length - 1];
    let best: number | null = null;
    for (let B = Math.floor(t0 + EPS); B <= Math.floor(t0 + EPS) + 1; B++) {
      if (B + r0 < t0 - EPS || B + lastR.start + Math.min(lastR.dur, 0.5) > end + EPS) continue;
      if (best === null || isStrong(ctx, B + lastR.start)) best = B;
      if (isStrong(ctx, B + lastR.start)) break;
    }
    if (best !== null) {
      const slots = prev.map((r) => ({ start: best! + r.start, dur: r.dur }));
      const land = slots[slots.length - 1];
      land.dur = Math.max(0.25, Math.min(land.dur, end - land.start));
      return { slots, until: breathAfter(land.start + land.dur), usedEcho: true, anticipate: false };
    }
  }

  // ── landing ──
  let landAt: number;
  if (opts.landAt !== undefined) landAt = opts.landAt;
  else {
    const scale = tier === 0 ? 0.55 : tier === 3 ? 1.6 : tier === 2 ? 1.3 : 1;
    const want = Math.min(breathMax - 1, rng.int(Math.round(ps.length[0] * scale), Math.round(ps.length[1] * scale)));
    const cands: number[] = [];
    for (let b = Math.ceil(t0 + 1); b <= end - Math.min(ps.landing[0], 0.5) + EPS; b++) if (isStrong(ctx, b)) cands.push(b);
    if (!cands.length) landAt = Math.max(Math.ceil(t0), Math.floor(end - 0.5));
    else landAt = cands.reduce((a, b) => (Math.abs(b - (t0 + want)) < Math.abs(a - (t0 + want)) ? b : a));
  }
  const anticipate = opts.landAt === undefined && landAt - 0.5 > t0 + 1 && rng.chance(ps.anticipate);
  const landOnset = anticipate ? landAt - 0.5 : landAt;

  // ── body ──
  const slots: Slot[] = [];
  let t = t0;
  let i = 0;
  let guard = 0;
  while (t < landOnset - EPS && guard++ < 64) {
    const room = landOnset - t;
    const frac = t - Math.floor(t + EPS);
    let cell: { dur: number; rest: boolean }[];
    if (frac > EPS) {
      // finish a partial beat (after an odd start) with straight subdivisions
      cell = [];
      for (let x = 0; x < Math.min(room, 1 - frac) - EPS; x += grid) cell.push({ dur: Math.min(grid, room - x), rest: false });
    } else if (i === 0 && rng.chance(ps.pickup)) {
      cell = parseCell(ps.pickupUnit);
    } else {
      const lvl = Math.max(0, Math.min(3, tier - (i === 0 ? 1 : 0)));
      const units = lvl === 3 ? (ps.runs ?? ps.units[2]) : ps.units[lvl];
      const options = (opts.units ?? units).map(parseCell).filter((c) => c.reduce((s, x) => s + x.dur, 0) <= room + EPS);
      cell = options.length ? rng.pick(options) : [{ dur: Math.min(room, grid), rest: false }];
    }
    for (const c of cell) {
      if (t >= landOnset - EPS) break;
      const d = Math.min(c.dur, landOnset - t);
      if (!c.rest) slots.push({ start: t, dur: d });
      t += d;
    }
    i++;
  }
  // a counter-line keeps out of the featured player's way: where they attack, it holds
  if (opts.avoid?.length) {
    for (let k = slots.length - 1; k > 0; k--) {
      if (opts.avoid.some((o) => Math.abs(o - slots[k].start) < 0.1) && ctx.rng.chance(0.7)) {
        slots[k - 1].dur = slots[k].start + slots[k].dur - slots[k - 1].start;
        slots.splice(k, 1);
      }
    }
  }
  const landDur = opts.landDur ?? Math.min(end - landOnset, q((ps.landing[0] + rng.next() * (ps.landing[1] - ps.landing[0])) * (tier >= 2 ? 0.7 : 1)) + (anticipate ? 0.5 : 0));
  slots.push({ start: landOnset, dur: Math.max(0.25, landDur) });
  const landEnd = landOnset + Math.max(0.25, landDur);
  return { slots, until: opts.landDur !== undefined ? landEnd : breathAfter(landEnd), usedEcho: false, anticipate };
}

/** Fill pitch classes between beat notes. */
function fillPcs(ctx: BarCtx, ps: PhraseStyle, h: Harm): number[] {
  if (ps.pentatonic) {
    const c = h.chord;
    const minorish = c.quality !== "maj7" && c.quality !== "maj" && c.quality !== "6";
    const pent = (minorish ? SCALES.minorPentatonic : SCALES.majorPentatonic).map((i) => mod(c.root + i, 12));
    return [...new Set([...pent, ...h.tones])];
  }
  return h.scale;
}

/** Pitches a phrase can land on / put on a beat, with a preference weight (lower = better). */
function structuralPool(ctx: BarCtx, ps: PhraseStyle, h: Harm, landing: boolean, final: boolean): Map<number, number> {
  const pool = new Map<number, number>();
  const root = h.chord.root;
  if (final) {
    pool.set(root, 0);
    for (const t of h.tones) if (t !== root) pool.set(t, 1.5);
    return pool;
  }
  for (const pc of h.stable) pool.set(pc, h.tones.includes(pc) ? 1 : 2);
  for (const g of h.guides) if (ps.guide) pool.set(g, 0);
  if (landing) {
    // land on the 3rd, 5th (or 7th); the root sounds final, colors sound unfinished (except in ambient/bossa)
    pool.set(root, 2.5);
    if (ctx.style.id !== "ambient" && ctx.style.id !== "bossa") for (const c of h.colors) pool.delete(c);
    if (!pool.size) pool.set(root, 0);
  } else if ((ctx.style.id === "funk" || ctx.style.id === "neworleans") && h.chord.tones.includes(4)) {
    // the blue b3 against a major 3rd can sit on a beat; other blue notes only pass
    const b3 = mod(root + 3, 12);
    if (h.blue.includes(b3)) pool.set(b3, 2);
  }
  return pool;
}

function choosePitch(pool: Map<number, number>, target: number, prev: number | null, lo: number, hi: number, jitter: () => number): number {
  let best = Math.round(target);
  let bestCost = Infinity;
  for (let p = lo; p <= hi; p++) {
    const w = pool.get(mod(p, 12));
    if (w === undefined) continue;
    let cost = Math.abs(p - target) + w * 1.2 + jitter();
    if (prev !== null) {
      const iv = Math.abs(p - prev);
      if (iv > 7) cost += (iv - 7) * 0.9;
      if (iv === 6) cost += 3; // a melodic tritone is awkward
      if (iv === 0) cost += 6;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = p;
    }
  }
  return best;
}

/** Plan one phrase: rhythm, contour, skeleton, fills. Returns absolute-time notes. */
export function planPhrase(
  ctx: BarCtx,
  t0: number,
  end: number,
  opts: LineOpts & { landAt?: number; landDur?: number; units?: string[]; shape?: Shape; final?: boolean; spanScale?: number } = {},
): { notes: NoteEvent[]; until: number } {
  const ps = PHRASE[ctx.style.id];
  const rng = ctx.rng;
  const tier = tierOf(ctx, opts);
  const { slots, until, usedEcho } = phraseRhythm(ctx, ps, t0, end, tier, opts);
  if (!slots.length) return { notes: [], until };
  const featured = ctx.role === "solo" || ctx.role === "lead";
  const [lo, hi] = [opts.lo ?? (featured ? (ctx.inst.solo ?? ctx.inst.sweet)[0] : ctx.inst.sweet[0]), opts.hi ?? (featured ? (ctx.inst.solo ?? ctx.inst.sweet)[1] : ctx.inst.sweet[1])];

  // ── where the phrase sits: solos climb across their section ──
  const secStart = ctx.section.start * ctx.beats;
  const secLen = Math.max(1, ctx.section.length * ctx.beats);
  const arc = Math.max(0, Math.min(1, (t0 - secStart) / secLen));
  const center = lo + (hi - lo) * (featured ? 0.3 + 0.4 * arc : 0.45);
  const last = ctx.mem.lastPitch;
  let start = last !== null && last >= lo - 2 && last <= hi + 2 ? last * 0.45 + center * 0.55 : center;

  // ── contour ──
  const endsSection = Math.abs(end - (ctx.section.start + ctx.section.length) * ctx.beats) < 1;
  let shape: Shape = opts.shape ?? rng.pick(ps.shapes.filter((s) => s !== ctx.mem.lastShape).length ? ps.shapes.filter((s) => s !== ctx.mem.lastShape) : ps.shapes);
  if (!opts.shape) {
    // a solo builds: in its back half, phrases climb or arch toward the top
    if (featured && arc > 0.45 && arc < 0.85 && (shape === "fall" || shape === "valley") && rng.chance(0.6)) shape = rng.chance(0.5) ? "rise" : "arch";
    if (start > hi - 5 && (shape === "rise" || shape === "arch")) shape = rng.chance(0.5) ? "fall" : "valley";
    if (start < lo + 5 && (shape === "fall" || shape === "valley")) shape = rng.chance(0.5) ? "rise" : "arch";
    if (featured && endsSection && until >= end - 1) shape = "fall";
  }
  let span = (tier >= 2 ? ps.span[1] : ps.span[0]) * (opts.spanScale ?? 1) * (featured ? 1 + 0.4 * Math.sin(Math.PI * Math.min(1, arc * 1.3)) : 0.8);
  // a short phrase can't cover an octave without leaping around: the contour scales with its notes
  span = Math.min(span, 2 + slots.length * 2.2);
  const [smin, smax] = shapeRange(shape);
  // keep the whole contour inside the register
  if (start + span * smax > hi - 1) start = hi - 1 - span * smax;
  if (start + span * smin < lo + 1) start = lo + 1 - span * smin;
  if (start + span * smax > hi - 1) span = Math.max(2, (hi - lo - 2) / Math.max(0.1, smax - smin));
  const t1 = slots[slots.length - 1].start;
  const drift = (center - start) * 0.8;
  const height = (s: number) => {
    const x = t1 > t0 ? (s - t0) / (t1 - t0) : 0;
    return start + span * SHAPE[shape](x) + drift * x;
  };

  // ── pitches ──
  const n = slots.length;
  const harmOf = (i: number) => {
    const s = slots[i];
    // an anticipated landing belongs to the chord it ties into
    if (i === n - 1 && s.dur > 0.5 && Math.abs(s.start - Math.round(s.start)) > EPS) return ctx.harmony.at(s.start + 0.5);
    return ctx.harmony.at(s.start);
  };
  const isSkeleton = (i: number) => {
    const s = slots[i];
    return i === 0 || i === n - 1 || Math.abs(s.start - Math.round(s.start)) < EPS || s.dur >= 0.75;
  };
  const pitches: number[] = new Array(n).fill(NaN);
  const jitter = () => rng.next() * 1.5;

  const prevPhrase = ctx.mem.lastRhythm;
  const echoPitches = usedEcho && prevPhrase && prevPhrase.every((r) => r.pitch !== undefined) && rng.chance(ps.pitchEcho);
  if (echoPitches) {
    // a riff or a sequence: the last phrase's notes again, moved along the scale and refit to the chords
    const steps = rng.pick(ps.sequence);
    for (let i = 0; i < n; i++) {
      // an echo replays the last phrase slot for slot
      const src = prevPhrase![Math.min(i, prevPhrase!.length - 1)];
      const h = harmOf(i);
      let p = stepIn(src.pitch!, steps, h.scale);
      if (isSkeleton(i) && !holdable(h, mod(p, 12), ctx.style.id)) p = nearestIn(p, h.stable, Math.sign(p - (pitches[i - 1] ?? p)) as 1 | -1 | 0);
      else if (!h.scale.includes(mod(p, 12))) p = nearestIn(p, h.scale);
      pitches[i] = p;
    }
    const mid = pitches.reduce((s, p) => s + p, 0) / n;
    const shift = mid > hi - 2 ? -12 : mid < lo + 2 ? 12 : 0;
    for (let i = 0; i < n; i++) pitches[i] += shift;
  } else {
    // skeleton: chord tones on the beats, following the contour
    let prevSk: number | null = last !== null ? Math.round(start) : null;
    for (let i = 0; i < n; i++) {
      if (!isSkeleton(i)) continue;
      const h = harmOf(i);
      const landing = i === n - 1;
      const pool = structuralPool(ctx, ps, h, landing, landing && !!opts.final);
      const p = choosePitch(pool, height(slots[i].start), prevSk, Math.max(lo, ctx.inst.range[0]), Math.min(hi, ctx.inst.range[1]), jitter);
      pitches[i] = p;
      prevSk = p;
    }
    // fills: steps (or chord tones) from one skeleton note toward the next, with approaches
    let a = 0;
    for (let b = 1; b < n; b++) {
      if (Number.isNaN(pitches[b])) continue;
      const k = b - a - 1;
      let cur = pitches[a];
      const goal = pitches[b];
      for (let j = 1; j <= k; j++) {
        const i = a + j;
        const h = harmOf(i);
        const pcs = rng.chance(ps.arpeggio) ? [...new Set([...h.tones, ...h.colors])] : fillPcs(ctx, ps, h);
        const remaining = k - j + 1; // fill notes left, this one included
        const toGoal = stepsBetween(cur, goal, pcs);
        const steps = Math.abs(toGoal);
        const dir = (Math.sign(toGoal) || (Math.sign(height(slots[i].start) - cur) || 1)) as 1 | -1;
        // the fills cover all but the last step: the beat note arrives on its beat, not a note early
        let next: number;
        if (steps - 1 > remaining) next = stepIn(cur, dir * Math.ceil((steps - 1) / remaining), pcs);
        else if (steps - 1 === remaining) next = stepIn(cur, dir, pcs);
        else if (steps === 0) next = stepIn(cur, rng.chance(0.5) ? 1 : -1, pcs); // neighbor note
        else if (remaining === 1) {
          // one note to spare before the goal: a chromatic approach (in styles that use them),
          // otherwise the goal's scale neighbour from the far side — a little turn into it
          if (ps.chromatic >= 0.1) {
            next = goal + (cur > goal ? 1 : -1);
            if (next === cur) next = goal + (cur > goal ? -1 : 1);
          } else {
            next = stepIn(goal, cur > goal ? -1 : 1, pcs);
            if (next === cur) next = stepIn(goal, cur > goal ? 1 : -1, pcs);
          }
        } else if (remaining - (steps - 1) >= 2 && rng.chance(0.5)) next = stepIn(cur, -dir, pcs); // a turn
        else {
          next = stepIn(cur, dir, pcs);
          if (next === goal) next = stepIn(cur, -dir, pcs);
        }
        // approach the beat note chromatically, or enclose it
        const short = slots[i].dur <= 0.5 + EPS;
        if (j === k && short && rng.chance(ps.chromatic)) {
          next = goal + (cur > goal ? 1 : -1);
          if (k >= 2 && rng.chance(0.4)) {
            pitches[i - 1] = stepIn(goal, cur > goal ? -1 : 1, harmOf(i - 1).scale);
          }
        }
        pitches[i] = next;
        cur = next;
      }
      a = b;
    }
  }

  // ── sound: dynamics follow the contour, the peak gets the accent ──
  const base = velFor(ctx, 0.8) * (opts.vel ?? 1);
  const top = Math.max(...pitches);
  const bottom = Math.min(...pitches);
  const notes: NoteEvent[] = slots.map((s, i) => {
    const lift = top > bottom ? (pitches[i] - bottom) / (top - bottom) : 0.5;
    const offbeat = Math.abs(s.start - Math.round(s.start) - 0.5) < EPS && ctx.style.swing > 0.55;
    let vel = base * (0.9 + 0.14 * lift) * (offbeat ? 1.05 : 1) * (0.96 + rng.next() * 0.08);
    let art: NoteEvent["art"];
    const landing = i === n - 1;
    if (pitches[i] === top && !landing && ["swing", "funk", "neworleans"].includes(ctx.style.id) && n > 3) art = "accent";
    else if (!landing && rng.chance(ps.staccato)) art = "staccato";
    else if (!landing && ctx.style.id === "swing" && s.dur <= 0.5 && lift < 0.25 && rng.chance(0.25)) {
      art = "ghost";
      vel *= 0.8;
    } else if (landing && ctx.inst.sustain) art = "legato";
    // staccato is an articulation (the player shortens it), not a different written length
    return { pitch: Math.round(pitches[i]), start: s.start, dur: Math.max(0.1, s.dur), vel, art };
  });

  // remembered from the beat its first note falls in, so an answer can start on any beat
  const origin = Math.floor(slots[0].start + EPS);
  if (slots.length >= 3) {
    ctx.mem.lastRhythm = slots.map((s, i) => ({ start: s.start - origin, dur: s.dur, pitch: notes[i].pitch }));
    ctx.mem.lastTier = tier;
  }
  ctx.mem.lastShape = shape;
  return { notes, until };
}

/**
 * An improvised line for one bar: continues the phrase in progress, then plans new phrases
 * (each with a pickup, a contour, a landing and a breath) until the bar is full.
 */
export function phraseLine(ctx: BarCtx, opts: LineOpts = {}): NoteEvent[] {
  const barStart = ctx.start;
  const barEnd = barStart + ctx.beats;
  const mem = ctx.mem;
  const out: NoteEvent[] = [];
  const emit = (notes: NoteEvent[]) => {
    for (const n of notes) if (n.start >= barStart - EPS && n.start < barEnd - EPS) out.push({ ...n, start: n.start - barStart });
  };
  let t = barStart;
  const tier = tierOf(ctx, opts);
  const continuing = mem.phrase && mem.phrase.bar === ctx.bar - 1 && mem.phrase.until > barStart + EPS;
  if (continuing && tier < (mem.phrase!.tier ?? tier)) {
    // this bar asks for less than the phrase running into it (a sparse bar after a busy
    // opener): let the phrase land on the downbeat, then leave the space the bar asked for
    const landing = mem.phrase!.notes.filter((n) => n.start < barStart + 1 - EPS);
    emit(landing.map((n) => (n.start >= barStart - EPS ? { ...n, dur: Math.min(n.dur, barStart + 1.5 - n.start) } : n)));
    t = barStart + (ctx.beats === 3 ? 1.5 : 2);
    mem.phrase = null;
  } else if (continuing) {
    emit(mem.phrase!.notes);
    t = mem.phrase!.until;
    mem.phrase!.bar = ctx.bar;
  } else {
    mem.phrase = null;
  }
  const end = Math.max(barEnd, Math.min(ctx.runEnd, barEnd + ctx.beats * 3));
  let guard = 0;
  while (t < barEnd - EPS && guard++ < 8) {
    if (ctx.runEnd - t < 1 - EPS) break;
    const plan = planPhrase(ctx, t, Math.min(end, ctx.runEnd), { ...opts, final: ctx.lastBar });
    mem.phrase = { notes: plan.notes, until: plan.until, bar: ctx.bar, tier };
    emit(plan.notes);
    if (plan.until <= t + EPS) break;
    t = plan.until;
  }
  // a featured bar should never go silent in the middle of a solo: answer briefly
  const featured = ctx.role === "solo" || ctx.role === "lead";
  if (featured && !out.length && ctx.runEnd - barStart >= ctx.beats - EPS) {
    const at = barStart + (ctx.beats === 3 ? 1 : 1.5);
    const plan = planPhrase(ctx, at, barEnd, { ...opts, landAt: barStart + ctx.beats - 1, landDur: 1 });
    mem.phrase = { notes: plan.notes, until: barEnd, bar: ctx.bar };
    emit(plan.notes);
  }
  if (ctx.args.includes("sparse") && out.length > ctx.beats - 1) thinOut(out, ctx.beats - 1);
  if (out.length) mem.lastPitch = out[out.length - 1].pitch;
  return out;
}

/**
 * A sparse bar leaves space: past one note a beat, the offbeats in the middle of the line go
 * (the first note and the landing stay) and the notes before them ring on into the gap, so
 * the bar reads as a few longer notes rather than a stream of 8ths.
 */
function thinOut(notes: NoteEvent[], beats: number): void {
  notes.sort((a, b) => a.start - b.start);
  for (let i = notes.length - 2; i > 0 && notes.length > beats; i--) {
    if (Math.abs(notes[i].start - Math.round(notes[i].start)) < EPS) continue;
    const prev = notes[i - 1];
    prev.dur = Math.max(prev.dur, notes[i].start + notes[i].dur - prev.start);
    notes.splice(i, 1);
  }
}

/** A cadence inside one bar: a short phrase that lands on a long chord tone on beat 3 (beat 2 in 3/4). */
export function cadenceLine(ctx: BarCtx, opts: LineOpts = {}): NoteEvent[] {
  const barStart = ctx.start;
  const land = barStart + (ctx.beats === 3 ? 1 : 2);
  const plan = planPhrase(ctx, barStart, barStart + ctx.beats, { ...opts, landAt: land, landDur: barStart + ctx.beats - land - 0.05, final: ctx.lastBar || ctx.sectionEnd });
  ctx.mem.phrase = { notes: plan.notes, until: barStart + ctx.beats, bar: ctx.bar };
  const out = plan.notes.map((n) => ({ ...n, start: n.start - barStart }));
  if (out.length) ctx.mem.lastPitch = out[out.length - 1].pitch;
  return out;
}

/** A scalar run through the bar (baroque spinning-out, or a dense flourish): straight up or down the scale. */
export function runLine(ctx: BarCtx, opts: LineOpts = {}): NoteEvent[] {
  const sixteenths = ctx.style.id === "baroque" || ctx.style.id === "funk" || ctx.style.line.density >= 2;
  const step = sixteenths ? 0.25 : 0.5;
  const featured = ctx.role === "solo" || ctx.role === "lead";
  const [lo, hi] = [opts.lo ?? (featured ? (ctx.inst.solo ?? ctx.inst.sweet)[0] : ctx.inst.sweet[0]), opts.hi ?? (featured ? (ctx.inst.solo ?? ctx.inst.sweet)[1] : ctx.inst.sweet[1])];
  const n = Math.round(ctx.beats / step);
  let p = ctx.mem.lastPitch !== null && ctx.mem.lastPitch >= lo && ctx.mem.lastPitch <= hi ? ctx.mem.lastPitch : Math.round((lo + hi) / 2);
  // run toward the side with more room
  let dir: 1 | -1 = hi - p >= p - lo ? 1 : -1;
  const vel = velFor(ctx, 0.8) * (opts.vel ?? 1);
  const out: NoteEvent[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * step;
    const h = harmAt(ctx, t);
    if (i === 0) p = nearestIn(p, h.tones);
    else {
      if (p + dir * 2 > hi || p + dir * 2 < lo) dir = (-dir) as 1 | -1;
      p = stepIn(p, dir, h.scale);
    }
    // beat notes that land on an avoid note slip to the neighbouring chord tone
    if (i > 0 && Math.abs(t - Math.round(t)) < EPS && !h.scale.includes(mod(p, 12))) p = nearestIn(p, h.scale, dir);
    out.push({ pitch: p, start: t, dur: step, vel: vel * (Math.abs(t - Math.round(t)) < EPS ? 1.04 : 0.94) });
  }
  // the last note of the run is the arrival: a chord tone
  const last = out[out.length - 1];
  const hl = harmAt(ctx, last.start);
  if (!hl.tones.includes(mod(last.pitch, 12))) last.pitch = nearestIn(last.pitch, hl.tones, dir);
  ctx.mem.phrase = null;
  ctx.mem.lastPitch = last.pitch;
  return out;
}
