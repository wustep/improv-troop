import { DRUM } from "./instruments";
import { chordPcs, mod, parseChord, parsePitch, pitchName } from "./theory";
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
    // a mark standing on its own ("F5/4 >") belongs to the note before it
    if (/^[>'?]+$/.test(tok)) {
      const last = notes[notes.length - 1];
      if (last) last.art = tok.endsWith(">") ? "accent" : tok.endsWith("'") ? "staccato" : "ghost";
      continue;
    }
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
    // marks written before the duration ("Bb1>/16")
    const early = /[>'?]+$/.exec(pitchPart);
    if (early) {
      pitchPart = pitchPart.slice(0, early.index);
      art ??= early[0].endsWith(">") ? "accent" : early[0].endsWith("'") ? "staccato" : "ghost";
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

// ─── Salvaging model-written bars ────────────────────────────────────────────

const SPEC: [number, string][] = [
  [4, "1"],
  [3, "2."],
  [2, "2"],
  [1.5, "4."],
  [1, "4"],
  [0.75, "8."],
  [0.5, "8"],
  [0.25, "16"],
];
const specFor = (beats: number) => SPEC.find(([b]) => Math.abs(b - beats) < 1e-6)?.[1];

/**
 * A bar the writer over-filled (models miscount their beats) squeezed back into the bar with
 * every pitch kept: rests go first, then the longest notes give up the difference, the last
 * note (the landing) last of all. Cutting at the barline instead loses exactly the notes a
 * phrase was aiming for. Null when the bar fits already, is more than half again too long,
 * or won't squeeze exactly; triplets are left as written.
 */
export function squeezeBar(text: string, beats: number): string | null {
  type Item = { pitch: string; dur: number; suffix: string; rest: boolean; locked: boolean };
  const items: Item[] = [];
  let lastDur = 1;
  for (const tok of tokenize(text)) {
    if (tok === "|") continue;
    const suffix = /[~>'?]*$/.exec(tok)![0];
    const body = tok.slice(0, tok.length - suffix.length);
    const slash = body.lastIndexOf("/");
    const pitch = slash > 0 ? body.slice(0, slash) : body;
    const spec = slash > 0 ? body.slice(slash + 1) : null;
    const dur = spec === null ? lastDur : durationBeats(spec);
    if (dur === null) return null;
    lastDur = dur;
    items.push({ pitch, dur, suffix, rest: /^[rR-]$/.test(pitch), locked: !!spec?.endsWith("t") || (spec === null && !specFor(dur)) });
  }
  const total = () => items.reduce((a, it) => a + it.dur, 0);
  if (total() <= beats + 1e-6 || total() > beats * 1.5 + 1e-6) return null;
  for (let guard = 0; guard < 32; guard++) {
    const excess = total() - beats;
    if (excess < 1e-6) break;
    const open = items.filter((it) => !it.locked);
    // a rest that the excess covers goes; a longer one gives up the excess
    const rest = open.filter((it) => it.rest).sort((a, b) => b.dur - a.dur);
    const gone = rest.find((it) => it.dur <= excess + 1e-6);
    if (gone) {
      items.splice(items.indexOf(gone), 1);
      continue;
    }
    const trim = rest.find((it) => specFor(it.dur - excess));
    if (trim) {
      trim.dur -= excess;
      continue;
    }
    // the longest note that can give up the whole excess, else halve the longest and look
    // again; the last note (where the phrase lands) only when nothing else can give
    const notes = open.filter((it) => !it.rest).sort((a, b) => b.dur - a.dur || items.indexOf(a) - items.indexOf(b));
    const landing = items[items.length - 1];
    const give = (pool: Item[]) => {
      const whole = pool.find((it) => specFor(it.dur - excess) && it.dur - excess >= 0.5 - 1e-6) ?? pool.find((it) => specFor(it.dur - excess));
      if (whole) return ((whole.dur -= excess), true);
      const half = pool.find((it) => it.dur >= 0.5 - 1e-6 && specFor(it.dur / 2));
      if (half) return ((half.dur /= 2), true);
      return false;
    };
    if (!give(notes.filter((it) => it !== landing)) && !give(notes)) return null;
  }
  const short = beats - total();
  if (short < -1e-6) return null;
  if (short > 1e-6) {
    const spec = specFor(short);
    if (!spec) return null;
    items.push({ pitch: "r", dur: short, suffix: "", rest: true, locked: false });
  }
  return items.map((it) => `${it.pitch}/${specFor(it.dur) ?? durSpecOf(it.dur)}${it.suffix}`).join(" ");
}

function durSpecOf(beats: number): string {
  // triplets kept as written
  for (const [b, s] of SPEC) if (Math.abs((b * 2) / 3 - beats) < 1e-6) return `${s}t`;
  return "4";
}

const pcOfName = (name: string) => parsePitch(`${name}4`)!;

const CHORD_SYMBOL = /^([A-G][#b]?)(m|maj|min|dim|aug|sus|add|ø|°|\+|-|6|7|9|11|13)[A-Za-z0-9#b+°ø()]*(\/[A-G][#b]?)?$/;

/**
 * Chord symbols written where notes belong ("Gm7/4", "[Cm7 C4 Eb4]/8", "Cm2/4"): models
 * comping from a lead sheet do this. A bassist gets the root, anyone else the chord's tones
 * stacked up from `low` (a bassist's root beside the note before); inside a bracket the symbol just goes when real pitches are there.
 * "Cm2" (a minor-chord letter with an octave) is read as the pitch C2, and "[Bb D F A]" (no
 * octaves) is stacked up from `low`.
 */
export function spellChordSymbols(text: string, low: number, bassist: boolean): { text: string; fixed: number } {
  let fixed = 0;
  let prev: number | null = null;
  const voice = (sym: string): string => {
    const c = parseChord(sym);
    let root = low + mod(c.root - low, 12);
    // a bassist's root goes next to the note before it
    if (bassist && prev !== null && Math.abs(root + 12 - prev) < Math.abs(root - prev)) root += 12;
    if (bassist) return pitchName(root, true);
    const pcs = chordPcs(c).slice(0, 4);
    const out: number[] = [];
    let p = root;
    for (const pc of pcs) {
      while (mod(p, 12) !== pc) p++;
      out.push(p);
    }
    return `[${out.map((x) => pitchName(x, true)).join(" ")}]`;
  };
  const one = (word: string): string | null => {
    if (parsePitch(word) !== null) return null;
    const octave = /^([A-G][#b]?)m([0-5])$/.exec(word);
    if (octave) return `${octave[1]}${octave[2]}`;
    return CHORD_SYMBOL.test(word) ? voice(word) : null;
  };
  const out = tokenize(text).map((tok) => {
    const suffix = /[~>'?]*$/.exec(tok)![0];
    const body = tok.slice(0, tok.length - suffix.length);
    const slash = body.lastIndexOf("/");
    // "/" also marks a slash chord ("C7/E"); a duration is digits
    const durAt = /\/(1|2|4|8|16|32)\.{0,2}t?$/.test(body) ? slash : -1;
    const head = durAt > 0 ? body.slice(0, durAt) : body;
    const tail = durAt > 0 ? body.slice(durAt) : "";
    const p = parsePitch(head);
    if (p !== null) prev = p;
    if (head.startsWith("[")) {
      const words = head.replace(/^\[|\]$/g, "").trim().split(/\s+/).filter(Boolean);
      const pitches = words.filter((w) => parsePitch(w) !== null);
      if (pitches.length === words.length) return tok;
      fixed++;
      // "[Bb D F A]": note names without octaves, stacked up from the bottom
      if (!pitches.length && words.every((w) => /^[A-G][#b]?$/.test(w))) {
        let p = low - 1;
        const stack = words.map((w) => {
          p++;
          while (mod(p, 12) !== mod(pcOfName(w), 12)) p++;
          return pitchName(p, true);
        });
        return `[${stack.join(" ")}]${tail}${suffix}`;
      }
      if (pitches.length) return `[${pitches.join(" ")}]${tail}${suffix}`;
      const sym = words.map(one).find(Boolean);
      return sym ? `${sym}${tail}${suffix}` : tok;
    }
    const spelled = one(head);
    if (!spelled) return tok;
    fixed++;
    prev = parsePitch(spelled) ?? prev;
    return `${spelled}${tail}${suffix}`;
  });
  return { text: fixed ? out.join(" ") : text, fixed };
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
  return /(^|\s)[a-z0-9]{1,5}:[xXgo.\-|~_]+/.test(text);
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
    let steps = m[2].replace(/\|/g, "");
    if (!steps.length) continue;
    // A lane a step or two off the 16th grid is a miscount, not a new subdivision: spread
    // as written it would drift against the band all bar. Pad or trim it to 16ths.
    const sixteenths = Math.round(beats * 4);
    const subdivision = [1, 2, 3, 4, 6, 8].some((k) => steps.length === Math.round(beats * k));
    if (!subdivision && Math.abs(steps.length - sixteenths) <= 2) {
      errors.push(`${name}: ${steps.length} steps, read as 16ths`);
      steps = steps.length < sixteenths ? steps.padEnd(sixteenths, ".") : steps.slice(0, sixteenths);
    }
    const stepBeats = beats / steps.length;
    for (let i = 0; i < steps.length; i++) {
      const ch = steps[i];
      // "~" (let it ring) and "_" are read as space: the kit's hits ring on their own
      if (ch === "." || ch === "-" || ch === "~" || ch === "_") continue;
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

// Every value the parser reads, longest first.
const VALUES: [number, string][] = [
  [4, "1"],
  [3, "2."],
  [2, "2"],
  [1.5, "4."],
  [4 / 3, "2t"],
  [1, "4"],
  [0.75, "8."],
  [2 / 3, "4t"],
  [0.5, "8"],
  [1 / 3, "8t"],
  [0.25, "16"],
  [1 / 6, "16t"],
  [0.125, "32"],
  [1 / 12, "32t"],
];
const EPS = 1e-3;

/** The note value nearest `d` that still ends by `room` (so the next onset and the bar line stay put). */
function durName(d: number, room: number): string {
  const fits = VALUES.filter(([v]) => v <= room + EPS);
  if (!fits.length) return VALUES[VALUES.length - 1][1];
  let best = fits[0];
  for (const x of fits) if (Math.abs(x[0] - d) < Math.abs(best[0] - d)) best = x;
  return best[1];
}

/** Rests that fill a gap exactly (fewest tokens), so later onsets land where they were; greedy if nothing fits. */
function restsFor(gap: number): string[] {
  if (gap <= EPS) return [];
  const search = (g: number, from: number, depth: number): string[] | null => {
    if (Math.abs(g) <= EPS) return [];
    if (depth === 0) return null;
    for (let i = from; i < VALUES.length; i++) {
      const [v, name] = VALUES[i];
      if (v > g + EPS) continue;
      const rest = search(g - v, i, depth - 1);
      if (rest) return [`r/${name}`, ...rest];
    }
    return null;
  };
  for (let depth = 1; depth <= 5; depth++) {
    const exact = search(gap, 0, depth);
    if (exact) return exact;
  }
  const out: string[] = [];
  let g = gap;
  while (g > 0.1 && out.length < 16) {
    const v = VALUES.find(([d]) => d <= g + EPS);
    if (!v) break;
    out.push(`r/${v[1]}`);
    g -= v[0];
  }
  return out;
}

function durValue(name: string): number {
  return durationBeats(name) ?? 1;
}

/**
 * Notes (relative to bar start) to compact text. Onsets on a 1/24-beat grid (any value the text
 * can spell) and pitches come back exactly; lengths are rounded to a note value. Off-grid onsets
 * (rubato) land on the nearest spellable spot.
 */
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
    const room = Math.min(groups[i + 1]?.start ?? beats, beats) - g.start;
    const name = durName(Math.min(g.dur, room), room);
    const p =
      g.pitches.length === 1
        ? pitchName(g.pitches[0], flats)
        : `[${g.pitches.map((x) => pitchName(x, flats)).join(" ")}]`;
    out.push(`${p}/${name}`);
    t = g.start + durValue(name);
  }
  out.push(...restsFor(beats - t));
  return out.join(" ");
}
