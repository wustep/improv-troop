import { sectionAt } from "./form";
import { INSTRUMENTS } from "./instruments";
import type { Rng } from "./rng";
import { STYLES, type StyleDef } from "./styles";
import type { BarPlan, Dynamic, Frame, Member, Motif, Role, Section, Texture } from "./types";

// Level 1 (local): fill roles, textures, dynamics and per-bar directives inside
// the locked frame. The model planners produce the same shape.

const SOLO_OPENERS = ["@motif invert", "@motif up 2", "@motif rhythm", "@motif displace 0.5", "@motif frag 3", "@motif retro", "@motif aug"];

function dynamicFor(style: StyleDef, frame: Frame, bar: number, s: Section): Dynamic {
  const prog = frame.bars > 1 ? bar / (frame.bars - 1) : 0;
  const inSec = s.length > 1 ? (bar - s.start) / (s.length - 1) : 0;
  if (style.id === "minimal") {
    // one long swell across the piece
    const lv: Dynamic[] = ["pp", "p", "mp", "mf", "f", "f", "mf"];
    return lv[Math.min(lv.length - 1, Math.floor(prog * lv.length))];
  }
  if (style.id === "ambient") return prog < 0.3 ? "p" : prog < 0.75 ? "mp" : "p";
  if (style.id === "baroque") return s.kind === "solo" ? "mp" : "f"; // terraced
  switch (s.kind) {
    case "intro":
      return "mp";
    case "head":
      return bar === 0 ? "mf" : "mf";
    case "solo":
      return inSec < 0.4 ? "mf" : inSec < 0.8 ? "f" : "f";
    case "trade":
      return "f";
    case "out":
      return inSec > 0.7 ? "ff" : "f";
    default:
      return "mf";
  }
}

function textureFor(style: StyleDef, frame: Frame, bar: number, s: Section, isLastSolo: boolean): Texture {
  if (style.id === "minimal") return "ostinato";
  if (style.id === "ambient") return "sparse";
  const inSec = bar - s.start;
  if (bar === frame.bars - 1) return "tutti";
  if (s.kind === "solo") {
    if (inSec === 0) return "sparse";
    if (isLastSolo && inSec >= s.length - 2) return "peak";
    if (inSec >= s.length - 2) return "build";
    return "groove";
  }
  if (s.kind === "out") return inSec >= s.length - 2 ? "peak" : "tutti";
  if (s.kind === "trade") return "groove";
  return "groove";
}

/** Lead directives across a head of `len` bars for a motif of `motifBars` bars. */
export function headLine(style: StyleDef, len: number, motifBars: number, rng: Rng, out = false): string[] {
  const res: string[] = [];
  const answer = rng.pick(["@motif up 2", "@motif up 3", "@motif down 1", "@motif invert"]);
  for (let i = 0; i < len; i++) {
    const inPhrase = i % 4;
    const phraseIdx = Math.floor(i / 4);
    if (style.id === "minimal") {
      const cycle = ["@motif", "@motif", "@motif ornament", "@motif displace 0.5"];
      res.push(cycle[i % cycle.length]);
      continue;
    }
    if (motifBars >= 2) {
      const pair = Math.floor(inPhrase / 2);
      const second = inPhrase % 2 === 1;
      const base = pair === 0 ? "@motif" : phraseIdx % 2 === 0 ? answer : "@motif";
      if (pair === 1 && inPhrase === 3 && i === len - 1) res.push(out ? "@motif bar2" : "@line long");
      else res.push(second ? `${base} bar2` : base);
      continue;
    }
    if (style.id === "baroque") {
      const cycle = ["@motif", "@motif seq -1", "@motif seq -1 bar2", "@line run"];
      res.push(cycle[inPhrase]);
      continue;
    }
    const cycle =
      phraseIdx % 2 === 0
        ? ["@motif", answer, "@motif", "@line long"]
        : ["@motif rhythm", "@motif up 4", "@motif frag 3", "@line long"];
    res.push(cycle[inPhrase]);
  }
  return res;
}

export function planLocal(frame: Frame, members: Member[], motif: Motif, rng: Rng): BarPlan[] {
  const style = STYLES[frame.style];
  const motifBars = Math.max(1, Math.ceil(motif.length / frame.meter.beats - 1e-6));
  const plan: BarPlan[] = [];
  const soloSections = frame.sections.filter((s) => s.kind === "solo" || s.kind === "trade");
  const lastSolo = soloSections[soloSections.length - 1];
  const melodic = members.filter((m) => INSTRUMENTS[m.instrument].fn === "melodic");

  // per-section lead lines
  const leadLines = new Map<Section, string[]>();
  for (const s of frame.sections) {
    if (s.kind === "head" || s.kind === "out") leadLines.set(s, headLine(style, s.length, motifBars, rng.fork(s.start), s.kind === "out"));
  }

  for (let bar = 0; bar < frame.bars; bar++) {
    const s = sectionAt(frame, bar);
    const inSec = bar - s.start;
    const slots = frame.slots[bar] ?? {};
    const isLastSolo = s === lastSolo;
    const roles: Record<string, Role> = {};
    const directives: Record<string, string> = {};
    const brng = rng.fork(`plan:${bar}`);
    const lastBar = bar === frame.bars - 1;

    for (const m of members) {
      const fn = INSTRUMENTS[m.instrument].fn;
      const slot = slots[m.id];
      if (lastBar) {
        roles[m.id] = slot ?? (fn === "rhythm" ? "groove" : fn === "bass" ? "bass" : fn === "chordal" ? "comp" : "pad");
        directives[m.id] = "@end";
        continue;
      }
      if (slot === "lead") {
        roles[m.id] = "lead";
        directives[m.id] = leadLines.get(s)?.[inSec] ?? "@motif";
        continue;
      }
      if (slot === "solo") {
        roles[m.id] = "solo";
        const turnStart = s.kind === "trade" ? inSec % 4 === 0 : inSec === 0;
        if (turnStart) directives[m.id] = brng.pick(SOLO_OPENERS);
        else if (s.kind !== "trade" && inSec === Math.floor(s.length / 2) && s.length >= 4) directives[m.id] = "@motif frag 3 up 4";
        else if (inSec >= s.length - 1 && isLastSolo) directives[m.id] = "@line dense";
        else directives[m.id] = "@line";
        continue;
      }
      if (slot === "trade") {
        roles[m.id] = "trade";
        directives[m.id] = "@solo";
        continue;
      }
      if (slot === "rest") {
        roles[m.id] = "rest";
        directives[m.id] = "@rest";
        continue;
      }
      const table = style.section[s.kind] ?? style.section.head;
      const leaderPlaying = s.kind === "head" || s.kind === "out";
      let d: string | undefined;
      if (fn === "melodic") {
        d = (leaderPlaying ? table["melodic-support"] : undefined) ?? table.melodic ?? "@rest";
        // shout riffs behind the last soloist
        if (s.kind === "solo" && isLastSolo && inSec >= s.length - 2 && melodic.length >= 2 && (style.id === "swing" || style.id === "funk")) d = "@riff";
      } else {
        d = table[fn] ?? "@rest";
      }
      if (fn === "rhythm" && bar === 0 && !d.includes("light") && d.startsWith("@groove") && style.id !== "funk") d = "@groove light";
      directives[m.id] = d;
      roles[m.id] =
        d === "@rest"
          ? "rest"
          : fn === "rhythm"
            ? "groove"
            : fn === "bass"
              ? "bass"
              : fn === "chordal"
                ? "comp"
                : d.startsWith("@pad")
                  ? "pad"
                  : "counter";
    }

    plan.push({
      index: bar,
      section: s.name,
      chords: frame.chords[bar],
      roles,
      texture: textureFor(style, frame, bar, s, isLastSolo),
      dynamic: dynamicFor(style, frame, bar, s),
      directives,
    });
  }
  return plan;
}
