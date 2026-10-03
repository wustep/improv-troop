import { chordSpans, velFor, type BarCtx } from "./context";
import { DRUM } from "./instruments";
import { parseMotifOps, realizeMotifBar } from "./motif";
import { looksLikeDrumGrid, parseDrumGrid, parseNotes } from "./notation";
import * as bass from "./patterns/bass";
import * as comp from "./patterns/comp";
import * as drums from "./patterns/drums";
import * as lines from "./patterns/lines";
import { voiceChord } from "./patterns/voicing";
import type { NoteEvent } from "./types";

// The vocabulary planners use for each bar. Models see DIRECTIVE_HELP verbatim.

export const DIRECTIVE_HELP = `Each bar of each player's part is ONE of:
- explicit notes: "E4/8 G4/8 Bb4/4 r/4 [C4 E4 G4]/4" (pitch/duration; 1 2 4 8 16; "." dotted; "t" triplet; "r" rest; [..] chord; "~" tie; ">" accent; "'" staccato). Durations must add up to the bar.
- drum grid (drums only): "rd:x...x.x.x...x.x. ph:....x.......x... sd:..g.......X..... bd:x.......x......." lanes bd sd hh oh ph rd cr t1 t2 ft rim sh tamb cb; x hit, X accent, g ghost, . rest; 16 steps = 16ths in 4/4 (12 in 3/4).
- a directive the band's engine realizes in style:
  @motif [up N|down N|seq N|invert|retro|aug|dim|frag N|displace 0.5|ornament|rhythm] [bar2]  — the shared motif or a transform of it ("bar2" = 2nd bar of a 2-bar statement)
  @line [dense|sparse|run|long]  — improvise a line over the changes
  @walk @two @bossa @funk @baroque @pedal  — bass patterns
  @comp [sparse|busy] @stride @arp @prelude @continuo @pad @shimmer @hits  — chordal patterns
  @guide @harmony @canon @riff @counter @fill  — supporting lines (guide tones, 3rds under the lead, imitation, backing riff)
  @groove [light|peak] @solo @fill  — drums
  @end  — final chord / last note
  @rest  — tacet`;

export interface DirectiveResult {
  notes: NoteEvent[];
  issues: string[];
  kind: "notes" | "grid" | "directive" | "rest";
}

function parseDirective(text: string): { name: string; args: string[] } {
  const [head, ...args] = text.trim().slice(1).split(/\s+/);
  return { name: (head ?? "").toLowerCase(), args };
}

function pianoSoloLeftHand(ctx: BarCtx): NoteEvent[] {
  // sparse shells under a piano solo
  const out: NoteEvent[] = [];
  const vel = velFor(ctx, 0.45);
  for (const s of chordSpans(ctx)) {
    const v = voiceChord(s.chord, "shell", 43, 62, ctx.mem.lastVoicing);
    const pos = s.start + (ctx.style.swing > 0.55 && ctx.rng.chance(0.5) ? 0.5 : 0);
    for (const p of v) out.push({ pitch: p, start: pos, dur: Math.min(1.2, s.end - pos), vel });
  }
  return out;
}

export function realizeDirective(ctx: BarCtx, text: string): DirectiveResult {
  const t = (text ?? "").trim();
  const fn = ctx.inst.fn;
  if (!t || t === "@rest" || t === "rest" || /^r(\/1)?$/i.test(t)) return { notes: [], issues: [], kind: "rest" };

  if (!t.startsWith("@")) {
    if (looksLikeDrumGrid(t)) {
      if (fn !== "rhythm") return { ...realizeDirective(ctx, "@line"), issues: ["drum grid given to a pitched player; improvised instead"] };
      const r = parseDrumGrid(t, ctx.beats);
      return { notes: r.notes.map((n) => ({ ...n, vel: n.vel * velFor(ctx, 1) })), issues: r.errors, kind: "grid" };
    }
    if (fn === "rhythm") {
      return { ...realizeDirective(ctx, "@groove"), issues: ["pitched notes given to drums; grooved instead"] };
    }
    const r = parseNotes(t, ctx.beats);
    const issues = [...r.errors];
    if (r.covered < ctx.beats - 1e-6) issues.push(`bar short by ${(ctx.beats - r.covered).toFixed(2)} beats (padded with rest)`);
    const vel = velFor(ctx, 0.8);
    const notes = r.notes.map((n) => ({
      ...n,
      vel: n.art === "ghost" ? vel * 0.4 : n.art === "accent" ? Math.min(1, vel * 1.2) : vel,
    }));
    if (notes.length) ctx.mem.lastPitch = notes[notes.length - 1].pitch;
    return { notes, issues, kind: "notes" };
  }

  const { name, args } = parseDirective(t);
  const c = { ...ctx, args };
  const issues: string[] = [];
  const done = (notes: NoteEvent[]): DirectiveResult => ({ notes, issues, kind: "directive" });

  // ── drums ──
  if (fn === "rhythm") {
    switch (name) {
      case "solo":
      case "trade":
      case "motif":
      case "line":
        return done(drums.drumSolo(c));
      case "end":
        return done(drums.endDrums(c));
      case "fill":
        return done(drums.groove({ ...c, phraseEnd: true, sectionEnd: true }));
      case "hits":
        return done([
          { pitch: DRUM.crash, start: 0, dur: 1, vel: velFor(c, 0.9), art: "accent" },
          { pitch: DRUM.kick, start: 0, dur: 0.2, vel: velFor(c, 0.9) },
        ]);
      case "groove":
        return done(drums.groove(c));
      default:
        issues.push(`@${name} isn't a drum directive; grooving`);
        return done(drums.groove(c));
    }
  }

  switch (name) {
    case "motif": {
      const bar2 = args.find((a) => /^bar\d$/i.test(a));
      const offset = bar2 ? parseInt(bar2.slice(3), 10) - 1 : 0;
      const notes = realizeMotifBar(c, parseMotifOps(args.filter((a) => a !== bar2)), offset);
      if (ctx.inst.id === "piano") notes.push(...pianoSoloLeftHand(c));
      return done(notes);
    }
    case "line":
    case "solo": {
      const notes = lines.line(c);
      if (ctx.inst.id === "piano") notes.push(...pianoSoloLeftHand(c));
      return done(notes);
    }
    case "walk":
      return done(bass.walk(c));
    case "two":
      return done(bass.two(c));
    case "bossa":
      return done(fn === "chordal" ? comp.comp(c) : bass.bossa(c));
    case "funk":
      return done(fn === "chordal" ? comp.comp(c) : bass.funk(c));
    case "baroque":
      return done(bass.baroque(c));
    case "pedal":
      return done(bass.pedal(c));
    case "groove":
      if (fn === "bass") return realizeDirective(ctx, ctx.style.section.head.bass ?? "@walk");
      if (fn === "chordal") return done(comp.comp(c));
      return done(lines.riff(c));
    case "comp":
      if (fn === "bass") return realizeDirective(ctx, ctx.style.section.head.bass ?? "@walk");
      if (fn === "melodic") return done(lines.guide(c));
      return done(comp.comp(c));
    case "stride":
      return done(fn === "melodic" ? lines.guide(c) : comp.stride(c));
    case "arp":
      return done(comp.arp(c));
    case "prelude":
      return done(fn === "melodic" ? lines.line(c) : comp.prelude(c));
    case "continuo":
      return done(fn === "melodic" ? lines.guide(c) : comp.continuo(c));
    case "pad":
      if (fn === "chordal") return done(comp.pad(c));
      if (fn === "bass") return done(bass.pedal(c));
      return done(lines.melodicPad(c));
    case "shimmer":
      return done(fn === "chordal" ? comp.shimmer(c) : lines.melodicPad(c));
    case "hits":
      if (fn === "chordal") return done(comp.hits(c));
      return done(lines.guide(c).slice(0, 1).map((n) => ({ ...n, dur: 0.35, art: "accent" as const })));
    case "guide":
      return done(lines.guide(c));
    case "harmony":
      return done(lines.harmony(c));
    case "canon":
      return done(lines.canon(c));
    case "riff":
      return done(lines.riff(c));
    case "counter":
      return done(lines.counter(c));
    case "fill":
      return done(lines.melodicFill(c));
    case "end":
      if (fn === "chordal") return done(comp.endChord(c));
      if (fn === "bass") return done(bass.pedal({ ...c, style: { ...c.style, id: "ambient" } }));
      return done(lines.endNote(c));
    default:
      issues.push(`unknown directive @${name}; using the style default`);
      if (fn === "bass") return realizeDirective(ctx, ctx.style.section.head.bass ?? "@walk");
      if (fn === "chordal") return done(comp.comp(c));
      return done(lines.line(c));
  }
}
