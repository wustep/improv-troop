import { velFor, type BarCtx } from "../context";
import { ENDINGS } from "../ending";
import { DRUM } from "../instruments";
import { parseDrumGrid } from "../notation";
import { hashString } from "../rng";
import type { NoteEvent } from "../types";

type Grid = { base: string; light?: string; peak?: string };

export const GROOVES: Record<string, Record<number, Grid>> = {
  swing: {
    4: {
      base: "rd:x...x.x.x...x.x. ph:....x.......x... bd:g...g...g...g...",
      light: "rd:x...x.x.x...x.x. ph:....x.......x...",
      peak: "rd:X...x.x.X...x.x. ph:....x.......x... bd:g...g...g...g...",
    },
    3: {
      base: "rd:x...x.x.x... ph:....x...x... bd:g...........",
      light: "rd:x...x.x.x... ph:....x...x...",
    },
  },
  bossa: {
    4: {
      base: "hh:x.x.x.x.x.x.x.x. bd:x.....x.x.....x.",
      light: "hh:g.g.g.g.g.g.g.g. bd:x.......x.......",
      peak: "hh:x.x.x.x.x.x.x.x. bd:x.....x.x.....x.",
    },
    3: { base: "hh:x.x.x.x.x.x. bd:x.....x....." },
  },
  funk: {
    4: {
      base: "hh:x.x.x.x.x.x.x.x. sd:....X..g.g..X..g",
      light: "hh:x.x.x.x.x.x.x.x. sd:....X.......X...",
      peak: "hh:xxXxxxXxxxXxxxXx sd:....X..g.g..X..g cr:x...............",
    },
    3: { base: "hh:x.x.x.x.x.x. sd:....X....... bd:x.....x.x..." },
  },
  pop: {
    4: {
      base: "hh:x.x.x.x.x.x.x.x. sd:....X.......X... bd:x.....x.x.......",
      light: "hh:x...x...x...x... sd:....x.......x... bd:x.......x.......",
      peak: "hh:x.x.x.x.x.x.x.x. sd:....X.......X... bd:x.....x.x.x..... cr:x...............",
    },
    3: { base: "hh:x.x.x.x.x.x. sd:....x...x... bd:x..........." },
  },
  neworleans: {
    4: {
      base: "sd:X.gx.gx.g.X.x.g. ph:....x.......x... bd:x.....x.x.......",
      light: "sd:x...g.x...g.x.g. bd:x.......x.......",
      peak: "sd:X.gxXgx.gxX.xXgx ph:....x.......x... bd:x.....x.x.....x. cr:x...............",
    },
    3: { base: "sd:X.gx.gx.g.x. bd:x.....x....." },
  },
  minimal: {
    4: {
      base: "sh:gxgxgxgxgxgxgxgx bd:x...............",
      light: "hh:g.g.g.g.g.g.g.g.",
      // the pulse thickens, but never turns into a backbeat
      peak: "sh:xxgxxxgxxxgxxxgx bd:x.......x.......",
    },
    3: { base: "sh:gxgxgxgxgxgx bd:x..........." },
  },
  baroque: {
    4: {
      base: "lt:x.......x.......",
      light: "lt:x...............",
      peak: "lt:x.......x....... tamb:....x.......x...",
    },
    3: { base: "lt:x..........." },
  },
  ambient: {
    4: {
      base: "rd:g.g.g.g.g.g.g.g.",
      // a soft mallet swell into the next bar rather than silence
      light: "rd:........g.g.g.g.",
      peak: "rd:g.g.g.g.x.x.x.x. ft:x...............",
    },
    3: { base: "rd:g.g.g.g.g.g." },
  },
};

export const FUNK_KICKS = ["bd:x.....x.x.x.....", "bd:x..x..x...x...x.", "bd:x.x....x..x.x..."].map((s) => s.slice(0, 19));

function gridFor(ctx: BarCtx, which: "base" | "light" | "peak"): string {
  const style = GROOVES[ctx.style.id] ?? GROOVES.swing;
  const g = style[ctx.beats] ?? style[4];
  let text = (which === "light" ? g.light : which === "peak" ? g.peak : undefined) ?? g.base;
  if (ctx.beats !== 4 && !style[ctx.beats]) {
    // cut a 4/4 grid down to the meter
    text = text
      .split(/\s+/)
      .map((lane) => {
        const [k, v] = lane.split(":");
        return v ? `${k}:${v.slice(0, ctx.beats * 4)}` : lane;
      })
      .join(" ");
  }
  if (ctx.style.id === "funk" && ctx.beats === 4) {
    text += " " + FUNK_KICKS[hashString(`${ctx.seed}:${ctx.section.start}`) % FUNK_KICKS.length];
  }
  if (ctx.style.id === "bossa" && ctx.beats === 4) {
    text += ctx.bar % 2 === 0 ? " rim:x.....x.....x..." : " rim:....x.....x.....";
  }
  return text;
}

function scale(notes: NoteEvent[], ctx: BarCtx, base = 0.8): NoteEvent[] {
  const v = velFor(ctx, base);
  return notes.map((n) => ({ ...n, vel: Math.min(1, n.vel * v * 1.25) }));
}

/** Swing snare comping: a couple of soft offbeat hits, a "bomb" at high energy. */
function swingComping(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const n = ctx.energy > 0.7 ? 2 : ctx.energy > 0.45 ? 1 : 0;
  // talk back in the soloist's gaps, not on top of them
  const lead = ctx.featured.map((x) => x.start);
  const all = [0.5, 1.5, 2.5, 3.5, 2 + 2 / 3, 1 + 2 / 3].filter((s) => s < ctx.beats);
  const open = all.filter((s) => !lead.some((o) => Math.abs(o - s) < 0.35));
  const slots = open.length ? open : all;
  for (let i = 0; i < n; i++) {
    const pos = ctx.rng.pick(slots);
    out.push({ pitch: DRUM.snare, start: pos, dur: 0.2, vel: 0.3 + ctx.rng.next() * 0.2, art: "ghost" });
  }
  if (ctx.energy > 0.8 && ctx.rng.chance(0.3)) out.push({ pitch: DRUM.kick, start: ctx.rng.pick([1.5, 3.5].filter((s) => s < ctx.beats)), dur: 0.2, vel: 0.85, art: "accent" });
  return out;
}

/**
 * Funk and bossa drummers play the bass line with the kick: the kick lands where the bass
 * does (its real notes, not ghosts), always on the one, never on top of the backbeat.
 */
function lockKickToBass(notes: NoteEvent[], bass: NoteEvent[], beats: number): NoteEvent[] {
  // (a bossa cross-stick is the clave, not a backbeat: the kick can sit under it)
  const backbeats = notes.filter((n) => n.pitch === DRUM.snare && n.art !== "ghost").map((n) => n.start);
  const vel = notes.find((n) => n.pitch === DRUM.kick)?.vel ?? 0.8;
  const onBackbeat = (t: number) => backbeats.some((b) => Math.abs(b - t) < 0.05);
  const kicks = [...new Set(bass.filter((b) => b.art !== "ghost" && b.vel > 0.3 && b.start < beats - 1e-6 && !onBackbeat(b.start)).map((b) => +b.start.toFixed(3)))]
    // the strongest positions first: on the beat, then on the 8th, then 16ths; at most five
    .sort((a, b) => (a % 1 === 0 ? 0 : a % 0.5 === 0 ? 1 : 2) - (b % 1 === 0 ? 0 : b % 0.5 === 0 ? 1 : 2) || a - b)
    .slice(0, 5);
  if (!kicks.includes(0)) kicks.push(0);
  return [...notes.filter((n) => n.pitch !== DRUM.kick), ...kicks.map((t) => ({ pitch: DRUM.kick, start: t, dur: 0.2, vel: t === 0 ? vel : vel * 0.9 }))];
}

/** The classic run: snare into the toms, high to low, getting louder. */
function fill(ctx: BarCtx, beats: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  const start = ctx.beats - beats;
  const triplet = ctx.style.id === "swing" || ctx.style.id === "neworleans";
  const step = triplet ? 1 / 3 : 0.25;
  const voices = [DRUM.snare, DRUM.snare, DRUM.highTom, DRUM.midTom, DRUM.floorTom];
  const count = Math.round(beats / step);
  for (let i = 0; i < count; i++) {
    if (ctx.energy < 0.5 && i % 2 === 1) continue;
    const t = start + i * step;
    const v = voices[Math.min(voices.length - 1, Math.floor((i / count) * voices.length))];
    out.push({ pitch: v, start: t, dur: step, vel: 0.5 + (i / count) * 0.4, art: i === count - 1 ? "accent" : undefined });
  }
  out.push({ pitch: DRUM.kick, start, dur: 0.2, vel: 0.7 });
  return out;
}

type FillShape = (ctx: BarCtx, start: number, len: number, step: number) => NoteEvent[];

const hit = (pitch: number, start: number, vel: number, art?: NoteEvent["art"]): NoteEvent => ({ pitch, start, dur: 0.2, vel, art });

/**
 * The other things a drummer says at the end of a phrase. Each fills the last `len` beats;
 * `step` is the subdivision (triplets in swing and New Orleans, 16ths otherwise).
 */
const FILL_SHAPES: Record<string, FillShape> = {
  run: (ctx, _start, len) => fill(ctx, len),
  // set-up: snare on the last beat, kick on its last partial, kicking the band into the one
  setup: (_ctx, start, len, step) => {
    const last = start + len - 1;
    return [hit(DRUM.snare, last, 0.7, "accent"), hit(DRUM.snare, last + step, 0.35, "ghost"), hit(DRUM.kick, last + 1 - step, 0.85, "accent")];
  },
  // drag: soft grace strokes leading into an accented snare on the last partial
  drag: (_ctx, start, len, step) => {
    const last = start + len - 1;
    const out = [hit(DRUM.kick, last, 0.6)];
    for (let t = last + step; t < last + 1 - step - 1e-6; t += step) out.push(hit(DRUM.snare, t, 0.3, "ghost"));
    out.push(hit(DRUM.snare, last + 1 - step, 0.9, "accent"), hit(DRUM.floorTom, last + 1 - step, 0.6));
    return out;
  },
  // the toms talk back: floor tom and kick on the beat, snare and high tom answering between
  toms: (_ctx, start, len, step) => {
    const out: NoteEvent[] = [];
    for (let b = start; b < start + len - 1e-6; b++) {
      out.push(hit(DRUM.floorTom, b, 0.75, "accent"), hit(DRUM.kick, b, 0.7));
      out.push(hit(DRUM.snare, b + 1 - step, 0.6));
      if (step < 0.3) out.push(hit(DRUM.highTom, b + 0.5, 0.55));
    }
    out.push(hit(DRUM.snare, start + len - step, 0.9, "accent"));
    return out;
  },
  // New Orleans press roll: a buzz of soft strokes swelling into an accent on the "and"
  press: (_ctx, start, len) => {
    const out: NoteEvent[] = [];
    const end = start + len - 0.5;
    for (let t = start; t < end - 1e-6; t += 1 / 6) out.push(hit(DRUM.snare, t, 0.25 + ((t - start) / len) * 0.35, "ghost"));
    out.push(hit(DRUM.snare, end, 0.9, "accent"), hit(DRUM.kick, end, 0.75));
    return out;
  },
  // funk: 16th ghosts on the snare, a backbeat-loud crack on the last 8th
  ghosts: (_ctx, start, len) => {
    const out: NoteEvent[] = [];
    for (let t = start; t < start + len - 0.5 - 1e-6; t += 0.25) out.push(hit(DRUM.snare, t, t % 1 === 0 ? 0.55 : 0.28, t % 1 === 0 ? undefined : "ghost"));
    out.push(hit(DRUM.snare, start + len - 0.5, 0.95, "accent"), hit(DRUM.highTom, start + len - 0.25, 0.7), hit(DRUM.kick, start + len - 0.25, 0.7));
    return out;
  },
  // funk: hats stay on, one opens up on the last "and" and the snare snaps under it
  hats: (_ctx, start, len) => {
    const out: NoteEvent[] = [];
    for (let t = start; t < start + len - 1e-6; t += 0.25) {
      const open = Math.abs(t - (start + len - 0.5)) < 1e-6;
      out.push(hit(open ? DRUM.hatOpen : DRUM.hatClosed, t, open ? 0.8 : 0.45, open ? "accent" : undefined));
    }
    out.push(hit(DRUM.snare, start + len - 1, 0.85, "accent"), hit(DRUM.kick, start + len - 0.75, 0.7));
    return out;
  },
  // bossa: a quiet cross-stick pickup into the next bar
  rim: (_ctx, start, len) => [hit(DRUM.stick, start + len - 1, 0.55), hit(DRUM.stick, start + len - 0.5, 0.7, "accent")],
};

/** Small fills (a beat) at phrase ends; big ones (two beats) into a new section. */
const FILL_VOCAB: Record<string, { small: string[]; big: string[] }> = {
  swing: { small: ["run", "setup", "drag"], big: ["run", "toms"] },
  neworleans: { small: ["run", "press", "drag"], big: ["press", "toms", "run"] },
  funk: { small: ["ghosts", "hats", "run"], big: ["ghosts", "toms", "run"] },
  bossa: { small: ["rim", "run"], big: ["rim", "run"] },
  pop: { small: ["setup", "run"], big: ["toms", "run"] },
};

/** Pick a fill shape for this style and length, never the same one twice in a row. */
function pickFill(ctx: BarCtx, len: number): NoteEvent[] {
  const vocab = FILL_VOCAB[ctx.style.id] ?? { small: ["run", "setup"], big: ["run", "toms"] };
  const pool = len >= 2 ? vocab.big : vocab.small;
  const fresh = pool.filter((n) => n !== ctx.mem.lastFill);
  const name = ctx.rng.pick(fresh.length ? fresh : pool);
  ctx.mem.lastFill = name;
  const step = ctx.style.id === "swing" || ctx.style.id === "neworleans" ? 1 / 3 : 0.25;
  const start = ctx.beats - len;
  return FILL_SHAPES[name](ctx, start, len, step).filter((n) => n.start >= start - 1e-6 && n.start < ctx.beats - 1e-6);
}

/**
 * Ambient drums don't keep time, they breathe: a soft cymbal bloom where the harmony moves (or
 * every other bar), a mallet roll swelling into it from the bar before, and now and then a
 * low mallet tom. Never the same tick every bar.
 */
function ambientKit(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const changes = ctx.chords[0].chord.symbol !== ctx.prev.symbol;
  const bloomHere = ctx.firstBar ? false : changes || ctx.barInSection % 2 === 0;
  const bloomNext = !ctx.lastBar && (ctx.next.symbol !== ctx.chords[ctx.chords.length - 1].chord.symbol || ctx.barInSection % 2 === 1);
  if (bloomHere) out.push({ pitch: DRUM.crash, start: 0, dur: ctx.beats, vel: 0.22 + ctx.energy * 0.12 });
  if (bloomNext && ctx.rng.chance(ctx.texture === "sparse" ? 0.5 : 0.8)) {
    // a mallet roll on the ride, swelling over the last beats into the bloom
    const from = ctx.beats - (ctx.energy > 0.5 ? 2 : 1);
    for (let t = from; t < ctx.beats - 1e-6; t += 0.25) out.push({ pitch: DRUM.ride, start: t, dur: 0.25, vel: 0.06 + ((t - from) / (ctx.beats - from)) * 0.24 });
  }
  if (ctx.rng.chance(0.25)) out.push({ pitch: DRUM.floorTom, start: ctx.rng.pick([1, 1.5, 2].filter((x) => x < ctx.beats)), dur: 1, vel: 0.2 });
  return out;
}

export function groove(ctx: BarCtx): NoteEvent[] {
  if (ctx.style.id === "ambient") return scale(ambientKit(ctx), ctx);
  const which = ctx.args.includes("light") || ctx.texture === "sparse" || ctx.texture === "breakdown"
    ? "light"
    : ctx.args.includes("peak") || ctx.texture === "peak"
      ? "peak"
      : "base";
  let notes = parseDrumGrid(gridFor(ctx, which), ctx.beats).notes;
  if (ctx.style.id === "swing") notes.push(...swingComping(ctx));
  if ((ctx.style.id === "funk" || ctx.style.id === "bossa" || ctx.style.id === "pop") && ctx.bassLine?.length) notes = lockKickToBass(notes, ctx.bassLine, ctx.beats);

  // section downbeat crash (a minimalist pulse never breaks for one; a bossa drummer only
  // touches a cymbal, softly)
  if (ctx.sectionStart && !ctx.firstBar && ctx.style.id !== "baroque" && ctx.style.id !== "minimal") {
    const soft = ctx.style.id === "bossa";
    notes = notes.filter((n) => !(n.start === 0 && (n.pitch === DRUM.ride || n.pitch === DRUM.hatClosed)));
    notes.push({ pitch: DRUM.crash, start: 0, dur: 1, vel: soft ? 0.4 : 0.85, art: soft ? undefined : "accent" });
    if (!soft) notes.push({ pitch: DRUM.kick, start: 0, dur: 0.2, vel: 0.8 });
  }

  // phrase-end fills
  const wantsFill =
    ctx.style.fills > 0 &&
    !ctx.lastBar &&
    (ctx.sectionEnd ? ctx.rng.chance(0.85) : ctx.phraseEnd && ctx.rng.chance(ctx.style.fills * (0.5 + ctx.energy)));
  if (wantsFill) {
    const len = ctx.sectionEnd && ctx.energy > 0.6 ? 2 : 1;
    const cut = ctx.beats - len;
    notes = notes.filter((n) => n.start < cut || n.pitch === DRUM.hatPedal);
    notes.push(...pickFill(ctx, len));
  }

  return scale(notes, ctx);
}

/** Drum solo / trade: the motif's rhythm orchestrated around the kit, plus fills. */
export function drumSolo(ctx: BarCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  const m = ctx.motif.notes;
  const pitches = m.map((n) => n.pitch);
  const lo = Math.min(...pitches, 60);
  const hi = Math.max(...pitches, 61);
  const map = (p: number) => {
    const r = (p - lo) / Math.max(1, hi - lo);
    return r > 0.75 ? DRUM.highTom : r > 0.5 ? DRUM.snare : r > 0.25 ? DRUM.midTom : DRUM.floorTom;
  };
  const motifLen = Math.max(1, ctx.motif.length);
  const shift = ctx.barInSection % 2 === 1 ? 0.5 : 0; // displace on alternate bars
  for (let rep = 0; rep * motifLen < ctx.beats; rep++) {
    for (const n of m) {
      const t = rep * motifLen + n.start + shift;
      if (t >= ctx.beats) continue;
      out.push({ pitch: map(n.pitch), start: t, dur: 0.2, vel: 0.65 + ctx.rng.next() * 0.3, art: n === m[0] ? "accent" : undefined });
      if (ctx.rng.chance(0.5)) out.push({ pitch: DRUM.kick, start: t, dur: 0.2, vel: 0.7 });
    }
  }
  // fill the last beat with a run
  out.push(...fill(ctx, 1).filter((n) => n.start >= ctx.beats - 1));
  out.push({ pitch: DRUM.hatPedal, start: 1, dur: 0.2, vel: 0.5 }, { pitch: DRUM.hatPedal, start: 3 % ctx.beats, dur: 0.2, vel: 0.5 });
  return scale(out, ctx, 0.9);
}

export function endDrums(ctx: BarCtx): NoteEvent[] {
  const v = velFor(ctx, 0.9);
  switch (ENDINGS[ctx.style.id]?.kind ?? "ring") {
    case "button":
      // the whole kit on the one, then silence (a minimalist just stops: one click and the kick)
      if (ctx.style.id === "minimal") return [{ pitch: DRUM.stick, start: 0, dur: 0.5, vel: v }, { pitch: DRUM.kick, start: 0, dur: 0.5, vel: v * 0.8 }];
      return [
        { pitch: DRUM.crash, start: 0, dur: 0.5, vel: v, art: "accent" },
        { pitch: DRUM.kick, start: 0, dur: 0.5, vel: v },
        { pitch: DRUM.snare, start: 0, dur: 0.5, vel: v, art: "accent" },
      ];
    case "fade": {
      // no crash: a soft cymbal touch on the chord, then a whisper of a roll as it dies away
      const out: NoteEvent[] = [
        { pitch: DRUM.ride, start: 0, dur: 1, vel: v * 0.45 },
        { pitch: DRUM.kick, start: 0, dur: 0.5, vel: v * 0.4 },
      ];
      for (let t = 1; t < ctx.beats - 0.5; t += 0.25) out.push({ pitch: DRUM.ride, start: t, dur: 0.25, vel: 0.12 * (1 - t / ctx.beats), art: "ghost" });
      return out;
    }
    case "cadence":
      // a single low drum under the final chord
      return [{ pitch: DRUM.lowTom, start: 0, dur: 0.5, vel: v }];
    default: {
      // a big ending: crash and kick, cymbal roll swelling under the held chord
      const out: NoteEvent[] = [
        { pitch: DRUM.crash, start: 0, dur: ctx.beats, vel: v, art: "accent" },
        { pitch: DRUM.kick, start: 0, dur: 0.5, vel: v },
      ];
      for (let t = 1; t < ctx.beats - 0.5; t += 0.25) out.push({ pitch: DRUM.ride, start: t, dur: 0.25, vel: 0.15 + (t / ctx.beats) * 0.3, art: "ghost" });
      return out;
    }
  }
}
