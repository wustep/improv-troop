import { velFor, type BarCtx } from "../context";
import { DRUM } from "../instruments";
import { parseDrumGrid } from "../notation";
import { hashString } from "../rng";
import type { NoteEvent } from "../types";

type Grid = { base: string; light?: string; peak?: string };

const GROOVES: Record<string, Record<number, Grid>> = {
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
  neworleans: {
    4: {
      base: "sd:X.gx.gx.g.X.x.g ph:....x.......x... bd:x.....x.x.......",
      light: "sd:x...g.x...g.x.g. bd:x.......x.......",
      peak: "sd:X.gxXgx.gxX.xXgx ph:....x.......x... bd:x.....x.x.....x. cr:x...............",
    },
    3: { base: "sd:X.gx.gx.g.x. bd:x.....x....." },
  },
  minimal: {
    4: {
      base: "sh:gxgxgxgxgxgxgxgx bd:x...............",
      light: "hh:g.g.g.g.g.g.g.g.",
      peak: "sh:gxgxgxgxgxgxgxgx rim:x...x...x...x... bd:x.......x.......",
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

const FUNK_KICKS = ["bd:x.....x.x.x.....", "bd:x..x..x...x...x.", "bd:x.x....x..x.x..."].map((s) => s.slice(0, 19));

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

export function groove(ctx: BarCtx): NoteEvent[] {
  const which = ctx.args.includes("light") || ctx.texture === "sparse" || ctx.texture === "breakdown"
    ? "light"
    : ctx.args.includes("peak") || ctx.texture === "peak"
      ? "peak"
      : "base";
  let notes = parseDrumGrid(gridFor(ctx, which), ctx.beats).notes;
  if (ctx.style.id === "swing") notes.push(...swingComping(ctx));

  // section downbeat crash
  if (ctx.sectionStart && !ctx.firstBar && ctx.style.id !== "baroque") {
    notes = notes.filter((n) => !(n.start === 0 && (n.pitch === DRUM.ride || n.pitch === DRUM.hatClosed)));
    notes.push({ pitch: DRUM.crash, start: 0, dur: 1, vel: ctx.style.id === "ambient" ? 0.45 : 0.85, art: "accent" });
    notes.push({ pitch: DRUM.kick, start: 0, dur: 0.2, vel: 0.8 });
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
    notes.push(...fill(ctx, len));
  }

  // ambient: cymbal swell (velocity ramps up across the bar)
  if (ctx.style.id === "ambient") {
    notes = notes.map((n) => (n.pitch === DRUM.ride ? { ...n, vel: 0.15 + (n.start / ctx.beats) * 0.35 } : n));
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
  const out: NoteEvent[] = [
    { pitch: DRUM.crash, start: 0, dur: ctx.beats, vel: v, art: "accent" },
    { pitch: DRUM.kick, start: 0, dur: 0.3, vel: v },
  ];
  if (ctx.style.id !== "baroque" && ctx.style.id !== "minimal") {
    // soft cymbal roll swelling into the release
    for (let t = 1; t < ctx.beats - 0.5; t += 0.25) out.push({ pitch: DRUM.ride, start: t, dur: 0.25, vel: 0.15 + (t / ctx.beats) * 0.3, art: "ghost" });
  } else {
    out[0] = { pitch: DRUM.lowTom, start: 0, dur: 0.5, vel: v };
  }
  return out;
}
