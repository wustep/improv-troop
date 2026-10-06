import { ENDINGS } from "./ending";
import { sectionAt } from "./form";
import { ANIMALS, INSTRUMENTS, SOLO_OPENERS } from "./instruments";
import type { Rng } from "./rng";
import { getStandard } from "./standards";
import { CELLO_TEXTURE, STYLES, type StyleDef } from "./styles";
import type { BarPlan, Dynamic, Frame, Member, Motif, Role, Section, Texture } from "./types";

// Level 1 (local): fill roles, textures, dynamics and per-bar directives inside
// the locked frame. The model planners produce the same shape.

/** How this player opens up the motif: any way at all, tilted toward the ones they like. */
function openerFor(m: Member, rng: Rng): string {
  const likes = ANIMALS[m.animal]?.taste.openers ?? {};
  return rng.weighted([...SOLO_OPENERS], SOLO_OPENERS.map((o) => 1 + (likes[o] ?? 0)));
}

const LOUDNESS: Dynamic[] = ["pp", "p", "mp", "mf", "f", "ff"];

/** The bars a style's ending slows down over (the ritardando), not counting the final bar. */
function inRit(style: StyleDef, frame: Frame, bar: number): boolean {
  const e = ENDINGS[style.id];
  return e.ritBars > 0 && e.slow > 1 && bar < frame.bars - 1 && bar >= frame.bars - 1 - e.ritBars;
}

function dynamicFor(style: StyleDef, frame: Frame, bar: number, s: Section): Dynamic {
  const kind = ENDINGS[style.id].kind;
  // a fading ending is soft whatever came before it, and eases down through the ritardando
  if (bar === frame.bars - 1 && kind === "fade") return "p";
  if (kind === "fade" && inRit(style, frame, bar)) return "mp";
  const d = arcDynamic(style, frame, bar, s);
  // bossa nova is intimate: it builds, but never past mezzo-forte
  if (style.id === "bossa") return LOUDNESS[Math.max(0, Math.min(LOUDNESS.indexOf(d) - 1, LOUDNESS.indexOf("mf")))];
  return d;
}

function arcDynamic(style: StyleDef, frame: Frame, bar: number, s: Section): Dynamic {
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
    // a later solo in a long chart opens with an arrangement change: stop-time behind a swing
    // or New Orleans soloist, a bass-and-drums breakdown under a funk one
    const laterSolo = frame.sections.some((x) => x.kind === "solo" && x.start < s.start);
    if (laterSolo && s.length >= 8 && inSec < 2) {
      if (style.id === "swing" || style.id === "neworleans") return "stoptime";
      if (style.id === "funk") return "breakdown";
    }
    if (inSec === 0) return "sparse";
    if (isLastSolo && inSec >= s.length - 2) return "peak";
    if (inSec >= s.length - 2) return "build";
    return "groove";
  }
  // the out head climbs to the end, except where the style ends by slowing down: a fade
  // thins out through its ritardando, a cadence broadens with everyone in
  const ending = ENDINGS[style.id].kind;
  if ((ending === "fade" || ending === "cadence") && inRit(style, frame, bar)) return ending === "fade" ? "sparse" : "tutti";
  if (s.kind === "out") return inSec >= s.length - 2 ? "peak" : "tutti";
  if (s.kind === "trade") return "groove";
  return "groove";
}

/**
 * Where each bar sits in the tune: a section letter and the bar's offset in it. Standards
 * use their form (A A B A); a free chart's head and out head are the same "tune".
 */
function tunePlace(frame: Frame, bar: number): { letter: string; offset: number } | null {
  const s = sectionAt(frame, bar);
  if (s.kind !== "head" && s.kind !== "out") return null;
  const std = getStandard(frame.standard);
  if (!std) return { letter: "tune", offset: bar - s.start };
  const formLen = std.bars.length;
  let pos = bar % formLen;
  for (const [letter, len] of std.form) {
    if (pos < len) return { letter, offset: pos };
    pos -= len;
  }
  return null;
}

/**
 * The earlier bar whose melody this lead bar repeats: same letter, same place in it, same
 * changes through the bar. That's how a tune comes back — the second A, the out head. (A bar
 * whose changes moved, like a cadence bar that adds its V7, gets its own line instead.)
 */
function sameChords(a: Frame["chords"][number], b: Frame["chords"][number]): boolean {
  return a.length === b.length && a.every((c, i) => c.symbol === b[i].symbol && Math.abs(c.beat - b[i].beat) < 1e-6);
}

export function melodySource(frame: Frame, bar: number): number | null {
  const here = tunePlace(frame, bar);
  if (!here) return null;
  for (let b = 0; b < bar; b++) {
    const there = tunePlace(frame, b);
    if (!there || there.letter !== here.letter || there.offset !== here.offset) continue;
    if (!sameChords(frame.chords[b], frame.chords[bar])) continue;
    if (frame.slots[b]?.[frame.leaderId] !== "lead") continue;
    return b;
  }
  return null;
}

/** Lead directives across a head of `len` bars for a motif of `motifBars` bars. */
export function headLine(style: StyleDef, len: number, motifBars: number, rng: Rng, out = false, blues = false): string[] {
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
  // a blues head is A A B: the first line again over the IV chord, then the answer
  if (blues && len >= 12) for (let i = 4; i < 8; i++) res[i] = res[i - 4];
  return res;
}

/** Who holds the bass chair: a bassist, else a bass-capable player (cello), else nobody. */
export function bassChairOf(members: Member[]): string | null {
  const bassist = members.find((m) => INSTRUMENTS[m.instrument].fn === "bass");
  if (bassist) return bassist.id;
  return members.find((m) => INSTRUMENTS[m.instrument].bassCapable)?.id ?? null;
}

export function planLocal(frame: Frame, members: Member[], motif: Motif, rng: Rng): BarPlan[] {
  const style = STYLES[frame.style];
  const motifBars = Math.max(1, Math.ceil(motif.length / frame.meter.beats - 1e-6));
  const plan: BarPlan[] = [];
  const soloSections = frame.sections.filter((s) => s.kind === "solo" || s.kind === "trade");
  const lastSolo = soloSections[soloSections.length - 1];
  const melodic = members.filter((m) => INSTRUMENTS[m.instrument].fn === "melodic");
  const bassChair = bassChairOf(members);

  // per-section lead lines
  const leadLines = new Map<Section, string[]>();
  const std = getStandard(frame.standard);
  const blues = !!std?.form.some(([letter]) => letter === "Blues");
  for (const s of frame.sections) {
    if (s.kind === "head" || s.kind === "out") leadLines.set(s, headLine(style, s.length, motifBars, rng.fork(s.start), s.kind === "out", blues));
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
      // a cellist covering for a missing bassist plays the bass part
      const fn = m.id === bassChair ? "bass" : INSTRUMENTS[m.instrument].fn;
      const slot = slots[m.id];
      if (lastBar) {
        roles[m.id] = slot ?? (fn === "rhythm" ? "groove" : fn === "bass" ? "bass" : fn === "chordal" ? "comp" : "pad");
        directives[m.id] = "@end";
        continue;
      }
      if (slot === "lead") {
        roles[m.id] = "lead";
        // a standard with a written melody: the leader plays the tune itself
        if (std?.melody) {
          directives[m.id] = `@tune ${(bar % std.bars.length) + 1}`;
          continue;
        }
        const src = melodySource(frame, bar);
        directives[m.id] = src !== null ? `@head ${src + 1}` : (leadLines.get(s)?.[inSec] ?? "@motif");
        continue;
      }
      if (slot === "solo") {
        roles[m.id] = "solo";
        const turnStart = s.kind === "trade" ? inSec % (s.turn ?? 2) === 0 : inSec === 0;
        // a solo is a story: state a transform, leave space, build, climax, hand off
        const last = inSec === s.length - 1;
        // taking over from another soloist: usually pick up what they just played and answer it
        const prevSec = s.start > 0 ? sectionAt(frame, s.start - 1) : null;
        const handoff = s.kind === "solo" && inSec === 0 && prevSec?.kind === "solo" && !prevSec.featured?.includes(m.id);
        const taste = ANIMALS[m.animal]?.taste;
        if (turnStart) directives[m.id] = handoff && brng.chance(taste?.answers ?? 0.7) ? "@answer" : openerFor(m, brng);
        else if (s.kind === "trade") directives[m.id] = "@line";
        else if (last) directives[m.id] = isLastSolo ? "@line dense" : "@line long";
        else if (inSec === s.length - 2 && s.length >= 4) directives[m.id] = "@line dense";
        else if (inSec === 1) directives[m.id] = "@line sparse";
        else if (inSec === Math.floor(s.length / 2) && s.length >= 6) directives[m.id] = "@motif frag 3 up 4";
        // in character: some players leave more space, some can't help a flurry
        else if (taste?.density && inSec % 3 === 2) directives[m.id] = taste.density < 0 ? "@line sparse" : "@line run";
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
      if (fn === "melodic" && m.instrument === "cello") {
        d = CELLO_TEXTURE[style.id][s.kind] ?? "@counter";
      } else if (fn === "melodic") {
        d = (leaderPlaying ? table["melodic-support"] : undefined) ?? table.melodic ?? "@rest";
        // shout riffs behind the last soloist
        if (s.kind === "solo" && isLastSolo && inSec >= s.length - 2 && melodic.length >= 2 && (style.id === "swing" || style.id === "funk")) d = "@riff";
      } else {
        d = table[fn] ?? "@rest";
        // swing: the head goes in two, and the bass starts walking on its last bar, lifting into the solos
        if (fn === "bass" && style.id === "swing" && s.kind === "head" && s.length >= 8 && d === "@walk" && inSec < s.length - 1) d = "@two";
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
