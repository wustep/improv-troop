import { chordSpans, dynamicLift, harmAt, velFor, type BarCtx } from "./context";
import { holdable, nearestIn } from "./harmony";
import { keyPrefersFlats, mod, pitchName } from "./theory";
import { ENDINGS } from "./ending";
import { getStandard, tuneBar } from "./standards";
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
  @motif [up N|down N|seq N|invert|retro|aug|dim|frag N|displace 0.5|ornament|rhythm] [bar2]  — the shared motif or a transform of it (up/down/seq count scale steps: 7 = an octave; "bar2" = 2nd bar of a 2-bar statement)
  @head N  — play again exactly what the leader played in bar N (how a tune comes back: repeated A sections, the out head)
  @tune N  — play bar N of the standard's written melody, as written (the tune itself; only on standards that have one)
  @line [dense|sparse|run|long]  — improvise a line over the changes
  @answer  — open a solo by answering the previous soloist's last phrase (its rhythm, your register), then carry on
  @walk @two @bossa @funk @baroque @pedal  — bass patterns
  @comp [sparse|busy] @stride @arp @prelude @continuo @pad @shimmer @hits  — chordal patterns
  @pizz [sparse|busy] @arco  — bowed strings: plucked double-stop comping / sustained bowed tones
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

/**
 * Written notes (usually from a model) get one rehearsal pass: a held note (a dotted 8th
 * or longer) that clashes with the chord under it — outside the chord and the colors this
 * style can hold, like a major 7th over a dominant or the 4th held over a major chord —
 * bends to the nearest chord tone in the direction the line was moving. Passing tones,
 * chromatic runs and the blues #9 stay as written.
 */
function rehearse(ctx: BarCtx, notes: NoteEvent[], issues: string[]): NoteEvent[] {
  if (ctx.inst.fn === "rhythm") return notes;
  const flats = keyPrefersFlats(ctx.key);
  let prev: number | null = ctx.mem.lastPitch;
  return notes.map((n) => {
    // only notes long enough to be heard as harmony; short chromatic notes (even on the
    // beat, like bebop enclosures) are left alone
    const held = n.dur >= 0.75;
    const from = prev;
    prev = n.pitch;
    if (!held) return n;
    const h = harmAt(ctx, n.start);
    const pc = mod(n.pitch, 12);
    // a short-ish scale tone that isn't an avoid note is fine; anything held long must be holdable
    const inScale = h.scale.includes(pc) && !h.avoid.includes(pc);
    if (holdable(h, pc, ctx.style.id) || (inScale && n.dur < 1.5)) return n;
    const dir = (from === null ? -1 : Math.sign(n.pitch - from) || -1) as 1 | -1;
    const fixed = nearestIn(n.pitch, h.tones, dir);
    issues.push(`held ${pitchName(n.pitch, flats)} clashed with ${h.chord.symbol}; played ${pitchName(fixed, flats)}`);
    prev = fixed;
    return { ...n, pitch: fixed };
  });
}

/** Bowed strings pluck these patterns. */
const PLUCKED = new Set(["walk", "two", "bossa", "funk", "pizz"]);

export function realizeDirective(ctx: BarCtx, text: string): DirectiveResult {
  const res = realizeRaw(ctx, text);
  if (ctx.inst.bowed && res.kind === "directive") {
    const name = text.trim().slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
    // funk cellists pluck their solos too
    const plucked = PLUCKED.has(name) || (ctx.style.id === "funk" && (name === "line" || name === "motif" || name === "riff"));
    if (plucked) res.notes = res.notes.map((n) => ({ ...n, art: "pizz" as const, dur: Math.min(n.dur, 1) }));
  }
  return res;
}

function realizeRaw(ctx: BarCtx, text: string): DirectiveResult {
  const t = (text ?? "").trim();
  // a cellist covering the bass chair speaks the bass vocabulary
  const fn = ctx.role === "bass" && ctx.inst.bassCapable ? "bass" : ctx.inst.fn;
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
    const notes = rehearse(
      ctx,
      r.notes.map((n) => ({
        ...n,
        // an accent is marked, not pre-boosted: the audio engine lifts every accent once
        vel: n.art === "ghost" ? vel * 0.4 : vel,
      })),
      issues,
    );
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
      case "answer":
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
    case "head": {
      // the tune comes back: replay the leader's notes from that bar
      const src = parseInt(args[0] ?? "", 10) - 1;
      const played = Number.isFinite(src) && src >= 0 && src < ctx.bar ? ctx.playedIn(src) : null;
      if (played?.length) {
        // the same notes, at this bar's dynamic (an out head can be louder or softer than the head)
        const lift = dynamicLift(ctx.energy, ctx.energyIn(src));
        const notes = played.map((n) => ({ ...n, vel: Math.min(1, n.vel * lift) }));
        ctx.mem.lastPitch = notes[notes.length - 1].pitch;
        ctx.mem.phrase = null;
        return done(notes);
      }
      issues.push(`@head ${args[0] ?? ""}: nothing to replay; stating the motif`);
      return done(realizeMotifBar(c, []));
    }
    case "tune": {
      // the standard's written melody, as written (in this key, in this player's register)
      const std = getStandard(ctx.standard);
      const [slo, shi] = ctx.inst.solo ?? ctx.inst.sweet;
      const notes = std ? tuneBar(std, parseInt(args[0] ?? "", 10) - 1, ctx.key.tonic, ctx.beats, (slo + shi) / 2, ctx.inst.range) : null;
      if (!notes) {
        issues.push(`@tune ${args[0] ?? ""}: no written melody here; stating the motif`);
        return done(realizeMotifBar(c, []));
      }
      const vel = velFor(ctx, 0.8);
      const out = notes.map((n) => ({ ...n, vel: n.art === "ghost" ? vel * 0.4 : vel, written: true as const }));
      if (out.length) ctx.mem.lastPitch = out[out.length - 1].pitch;
      ctx.mem.phrase = null;
      return done(out);
    }
    case "motif": {
      // "bar2" or "bar 2": which bar of a multi-bar statement
      const words = args.flatMap((a, i) => (/^bar$/i.test(a) && /^\d$/.test(args[i + 1] ?? "") ? [] : /^\d$/.test(a) && /^bar$/i.test(args[i - 1] ?? "") ? [`bar${a}`] : [a]));
      const bar2 = words.find((a) => /^bar\d$/i.test(a));
      const unknown: string[] = [];
      const ops = parseMotifOps(words.filter((a) => a !== bar2), unknown);
      if (unknown.length) issues.push(`@motif: ignored "${unknown.join(" ")}"`);
      let offset = bar2 ? parseInt(bar2.slice(3), 10) - 1 : 0;
      let notes = realizeMotifBar(c, ops, offset);
      // a bar the statement doesn't have (bar2 of a one-bar motif): play its last bar instead.
      // (A bar the statement has but leaves silent stays silent.)
      const statementBeats = ctx.motif.length * (ops.some((o) => o.op === "augment") ? 2 : 1);
      while (!notes.length && offset > 0 && offset * ctx.beats >= statementBeats - 1e-6) {
        offset--;
        issues.push(`@motif ${bar2}: the statement has no bar ${offset + 2}; playing bar ${offset + 1}`);
        notes = realizeMotifBar(c, ops, offset);
      }
      if (ctx.inst.id === "piano") notes.push(...pianoSoloLeftHand(c));
      return done(notes);
    }
    case "answer": {
      const notes = lines.answer(c);
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
      if (ctx.inst.id === "cello") return done(comp.pizz(c));
      if (fn === "melodic") return done(lines.guide(c));
      return done(comp.comp(c));
    case "pizz":
      if (fn === "bass") return realizeDirective(ctx, ctx.style.section.head.bass ?? "@walk");
      if (ctx.inst.bowed || fn === "melodic") return done(comp.pizz(c));
      return done(comp.comp(c));
    case "arco":
      return done(ctx.inst.id === "cello" ? lines.celloPad(c) : lines.melodicPad(c));
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
      if (ctx.inst.id === "cello") return done(lines.celloPad(c));
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
      return done(ctx.inst.id === "cello" ? lines.celloCounter(c) : lines.counter(c));
    case "fill":
      return done(lines.melodicFill(c));
    case "end": {
      const held = fn === "chordal" ? comp.endChord(c) : fn === "bass" ? bass.pedal({ ...c, style: { ...c.style, id: "ambient" } }) : lines.endNote(c);
      // a button ending: everyone hits the downbeat together, short and accented, and stops
      if (ENDINGS[c.style.id]?.kind === "button") {
        return done(held.filter((n) => n.start < 1e-6).map((n) => ({ ...n, dur: Math.min(n.dur, 0.5), art: "accent" as const })));
      }
      return done(held);
    }
    default:
      issues.push(`unknown directive @${name}; using the style default`);
      if (fn === "bass") return realizeDirective(ctx, ctx.style.section.head.bass ?? "@walk");
      if (fn === "chordal") return done(comp.comp(c));
      return done(lines.line(c));
  }
}
