import { DRUM } from "./instruments";
import { parsePitch, pitchName } from "./theory";
import type { NoteEvent } from "./types";

// Compact text grammar shared by the local engine, the models, and the debug view.
//
//   Notes:   C4/4  Eb5/8.  r/8  [C4 E4 G4]/2  F#4/16  G4/8t  A4/4~ A4/8
//            pitch/duration; durations 1 2 4 8 16 32, "." dotted, "t" triplet,
//            "~" ties into the next note of the same pitch. Omitted duration repeats
//            the previous one. Suffixes: ">" accent, "'" staccato, "?" ghost.
//   Bars:    "C4/4 D4/4 E4/2 | F4/1" — "|" separates bars.
//   Drums:   "hh:x.x.x.x.x.x.x.x sd:....x.......x... bd:x.......x.x....."
//            one lane per instrument; any number of steps spread evenly over the bar
//            (16 = 16ths in 4/4, 12 = 8th-note triplets). x hit, X accent, g ghost,
//            o open hat, . or - rest.
//   Directives: "@walk", "@motif invert", "@line dense", ... (see directives.ts)

export interface ParseResult {
  notes: NoteEvent[]; // start relative to the bar start
  errors: string[];
  /** Beats the text actually covered (before padding/truncation). */
  covered: number;
}

const DUR_RE = /^(1|2|4|8|16|32)(\.{0,2})(t?)$/;

export function durationBeats(spec: string): number | null {
  const m = DUR_RE.exec(spec);
  if (!m) return null;
  let d = 4 / parseInt(m[1], 10);
  if (m[2] === ".") d *= 1.5;
  if (m[2] === "..") d *= 1.75;
  if (m[3] === "t") d *= 2 / 3;
  return d;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s|,/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "[") {
      const close = text.indexOf("]", i);
      if (close < 0) {
        out.push(text.slice(i));
        break;
      }
      // include the duration that follows the bracket
      let j = close + 1;
      while (j < text.length && !/\s|,/.test(text[j])) j++;
      out.push(text.slice(i, j));
      i = j;
      continue;
    }
    let j = i;
    while (j < text.length && !/\s|,/.test(text[j])) j++;
    out.push(text.slice(i, j));
    i = j;
  }
  return out;
}

/** Parse one bar of note text. Pads with rest / truncates to `beats`. */
export function parseNotes(text: string, beats: number): ParseResult {
  const errors: string[] = [];
  const notes: NoteEvent[] = [];
  let t = 0;
  let lastDur = 1;
  const pendingTies = new Map<number, NoteEvent>();

  for (const tok of tokenize(text)) {
    if (tok === "|") continue;
    let body = tok;
    let art: NoteEvent["art"] | undefined;
    let tie = false;
    // suffixes, in any order
    for (;;) {
      const last = body[body.length - 1];
      if (last === "~") tie = true;
      else if (last === ">") art = "accent";
      else if (last === "'") art = "staccato";
      else if (last === "?") art = "ghost";
      else break;
      body = body.slice(0, -1);
    }

    let pitchPart = body;
    let durPart: string | null = null;
    const slash = body.lastIndexOf("/");
    if (slash > 0) {
      pitchPart = body.slice(0, slash);
      durPart = body.slice(slash + 1);
    }
    let dur = lastDur;
    if (durPart !== null) {
      const d = durationBeats(durPart);
      if (d === null) {
        errors.push(`bad duration "${durPart}" in "${tok}"`);
      } else {
        dur = d;
      }
    }
    lastDur = dur;

    let pitches: number[] = [];
    let isRest = false;
    if (/^[rR]$/.test(pitchPart) || pitchPart === "-") {
      isRest = true;
    } else if (pitchPart.startsWith("[")) {
      const inner = pitchPart.replace(/^\[|\]$/g, "").trim();
      for (const p of inner.split(/[\s+]+/)) {
        if (!p) continue;
        const midi = parsePitch(p);
        if (midi === null) errors.push(`bad pitch "${p}" in chord "${tok}"`);
        else pitches.push(midi);
      }
      if (pitches.length === 0) isRest = true;
    } else {
      const midi = parsePitch(pitchPart);
      if (midi === null) {
        errors.push(`bad token "${tok}"`);
        isRest = true;
      } else pitches = [midi];
    }

    if (t >= beats - 1e-6) {
      errors.push(`overflow: "${tok}" past end of bar`);
      t += dur;
      continue;
    }
    const room = beats - t;
    const d = Math.min(dur, room);
    if (dur > room + 1e-6) errors.push(`"${tok}" truncated at bar end`);

    if (!isRest) {
      const nextTies = new Map<number, NoteEvent>();
      for (const p of pitches) {
        const prev = pendingTies.get(p);
        if (prev && Math.abs(prev.start + prev.dur - t) < 1e-6) {
          prev.dur += d;
          if (tie) nextTies.set(p, prev);
          continue;
        }
        const n: NoteEvent = { pitch: p, start: t, dur: d, vel: 0.8 };
        if (art) n.art = art;
        notes.push(n);
        if (tie) nextTies.set(p, n);
      }
      pendingTies.clear();
      for (const [k, v] of nextTies) pendingTies.set(k, v);
    } else {
      pendingTies.clear();
    }
    t += dur;
  }
  return { notes, errors, covered: t };
}

/** Split "a | b | c" into bar texts. */
export function splitBars(text: string): string[] {
  return text.split("|").map((s) => s.trim());
}

// ─── Drum grids ──────────────────────────────────────────────────────────────

const LANES: Record<string, number> = {
  bd: DRUM.kick,
  kick: DRUM.kick,
  k: DRUM.kick,
  sd: DRUM.snare,
  snare: DRUM.snare,
  s: DRUM.snare,
  hh: DRUM.hatClosed,
  hat: DRUM.hatClosed,
  h: DRUM.hatClosed,
  oh: DRUM.hatOpen,
  ph: DRUM.hatPedal,
  hp: DRUM.hatPedal,
  rd: DRUM.ride,
  ride: DRUM.ride,
  r: DRUM.ride,
  bell: DRUM.rideBell,
  cr: DRUM.crash,
  crash: DRUM.crash,
  c: DRUM.crash,
  t1: DRUM.highTom,
  t2: DRUM.midTom,
  t3: DRUM.floorTom,
  ft: DRUM.floorTom,
  lt: DRUM.lowTom,
  rim: DRUM.stick,
  st: DRUM.stick,
  stick: DRUM.stick,
  cb: DRUM.cowbell,
  tamb: DRUM.tambourine,
  tb: DRUM.tambourine,
  sh: DRUM.shaker,
  cp: DRUM.clap,
  clap: DRUM.clap,
  cg: DRUM.congaHi,
  cgl: DRUM.congaLo,
};

const LANE_NAME: Record<number, string> = {
  [DRUM.kick]: "bd",
  [DRUM.snare]: "sd",
  [DRUM.hatClosed]: "hh",
  [DRUM.hatOpen]: "oh",
  [DRUM.hatPedal]: "ph",
  [DRUM.ride]: "rd",
  [DRUM.rideBell]: "bell",
  [DRUM.crash]: "cr",
  [DRUM.highTom]: "t1",
  [DRUM.midTom]: "t2",
  [DRUM.lowTom]: "lt",
  [DRUM.floorTom]: "ft",
  [DRUM.stick]: "rim",
  [DRUM.cowbell]: "cb",
  [DRUM.tambourine]: "tamb",
  [DRUM.shaker]: "sh",
  [DRUM.clap]: "cp",
  [DRUM.congaHi]: "cg",
  [DRUM.congaLo]: "cgl",
};

export function looksLikeDrumGrid(text: string): boolean {
  return /(^|\s)[a-z0-9]{1,5}:[xXgo.\-|]+/.test(text);
}

export function parseDrumGrid(text: string, beats: number): ParseResult {
  const errors: string[] = [];
  const notes: NoteEvent[] = [];
  const lanes = text.trim().split(/[\s;,]+/).filter(Boolean);
  for (const lane of lanes) {
    const m = /^([a-zA-Z0-9]+):(.+)$/.exec(lane);
    if (!m) {
      errors.push(`bad drum lane "${lane}"`);
      continue;
    }
    const name = m[1].toLowerCase();
    let pitch = LANES[name];
    if (pitch === undefined) {
      errors.push(`unknown drum "${name}"`);
      continue;
    }
    const steps = m[2].replace(/\|/g, "");
    if (!steps.length) continue;
    const stepBeats = beats / steps.length;
    for (let i = 0; i < steps.length; i++) {
      const ch = steps[i];
      if (ch === "." || ch === "-") continue;
      let vel = 0.75;
      let art: NoteEvent["art"] | undefined;
      let p = pitch;
      if (ch === "X") {
        vel = 1;
        art = "accent";
      } else if (ch === "g") {
        vel = 0.3;
        art = "ghost";
      } else if (ch === "o") {
        if (pitch === DRUM.hatClosed) p = DRUM.hatOpen;
      } else if (ch !== "x") {
        errors.push(`bad step "${ch}" in ${name}`);
        continue;
      }
      const n: NoteEvent = { pitch: p, start: i * stepBeats, dur: Math.min(stepBeats, 0.25), vel };
      if (art) n.art = art;
      notes.push(n);
    }
    pitch = 0;
  }
  return { notes, errors, covered: beats };
}

/** Render drum notes (relative to bar) back to grid text (16 steps per 4/4 bar). */
export function drumsToGrid(notes: NoteEvent[], beats: number): string {
  const steps = beats * 4;
  const lanes = new Map<string, string[]>();
  for (const n of notes) {
    const name = LANE_NAME[n.pitch] ?? "sd";
    if (!lanes.has(name)) lanes.set(name, Array(steps).fill("."));
    const i = Math.round(n.start * 4);
    if (i >= 0 && i < steps) {
      lanes.get(name)![i] = n.art === "accent" ? "X" : n.art === "ghost" ? "g" : "x";
    }
  }
  return [...lanes.entries()].map(([k, v]) => `${k}:${v.join("")}`).join(" ");
}

// ─── Serialisation (notes -> text) ───────────────────────────────────────────

const DUR_NAMES: [number, string][] = [
  [4, "1"],
  [3, "2."],
  [2, "2"],
  [1.5, "4."],
  [1, "4"],
  [0.75, "8."],
  [0.5, "8"],
  [1 / 3, "8t"],
  [0.25, "16"],
  [2 / 3, "4t"],
];

function durName(d: number): string {
  let best = DUR_NAMES[0];
  for (const x of DUR_NAMES) if (Math.abs(x[0] - d) < Math.abs(best[0] - d)) best = x;
  return best[1];
}

const REST_VALUES: [number, string][] = [
  [4, "1"],
  [3, "2."],
  [2, "2"],
  [1.5, "4."],
  [1, "4"],
  [0.75, "8."],
  [0.5, "8"],
  [0.25, "16"],
  [1 / 3, "8t"],
];

/** Greedy rest decomposition of a gap (never overshoots). */
function restsFor(gap: number): string[] {
  const out: string[] = [];
  let g = gap;
  let guard = 0;
  while (g > 0.1 && guard++ < 16) {
    const v = REST_VALUES.find(([d]) => d <= g + 1e-3);
    if (!v) break;
    out.push(`r/${v[1]}`);
    g -= v[0];
  }
  return out;
}

function durValue(name: string): number {
  return durationBeats(name) ?? 1;
}

/** Notes (relative to bar start) to compact text. Approximate; for prompts and debug. */
export function notesToText(notes: NoteEvent[], beats: number, flats = true): string {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const groups: { start: number; dur: number; pitches: number[] }[] = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.start - n.start) < 1e-3) {
      g.pitches.push(n.pitch);
      g.dur = Math.max(g.dur, n.dur);
    } else groups.push({ start: n.start, dur: n.dur, pitches: [n.pitch] });
  }
  const out: string[] = [];
  let t = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.start > t + 1e-3) out.push(...restsFor(g.start - t));
    const next = groups[i + 1]?.start ?? beats;
    const d = Math.min(g.dur, next - g.start, beats - g.start);
    const name = durName(Math.max(d, 0.25));
    const p =
      g.pitches.length === 1
        ? pitchName(g.pitches[0], flats)
        : `[${g.pitches.map((x) => pitchName(x, flats)).join(" ")}]`;
    out.push(`${p}/${name}`);
    t = g.start + durValue(name);
  }
  if (beats - t > 0.1) out.push(...restsFor(beats - t));
  return out.join(" ");
}
