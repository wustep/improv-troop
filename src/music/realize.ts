import { DYNAMIC_ENERGY, newMemory, type BarCtx, type PlayerMemory } from "./context";
import { realizeDirective } from "./directives";
import { styleDynamic } from "./ending";
import { ensemble } from "./ensemble";
import { sectionAt } from "./form";
import { buildHarmony, type Harmony } from "./harmony";
import { DRUM, INSTRUMENTS } from "./instruments";
import { makeRng } from "./rng";
import { STYLES } from "./styles";
import { keyScale, parseChord } from "./theory";
import type { BarPlan, Frame, Member, Motif, NoteEvent, Role } from "./types";

export interface RealizeIssue {
  bar: number; // 0-based
  member: string;
  detail: string;
}

export interface RealizeResult {
  parts: Record<string, NoteEvent[]>;
  issues: RealizeIssue[];
  ms: number;
  /** Featured line per bar (relative to bar start), for listeners. */
  featuredByBar: Map<number, NoteEvent[]>;
}

const FEATURED: Role[] = ["lead", "solo", "trade"];

/**
 * Mix by role: whoever carries the tune sits on top. Comping and the rhythm section
 * sit a little under; sustained counter-lines and pads further under (long tones
 * add up fast).
 */
const ROLE_MIX: Record<Role, number> = {
  lead: 1.08,
  solo: 1.08,
  trade: 1,
  bass: 0.92,
  groove: 0.84,
  comp: 0.82,
  fill: 0.9,
  counter: 0.6,
  pad: 0.55,
  rest: 1,
};

export function isFeaturedRole(r: Role | undefined) {
  return !!r && FEATURED.includes(r);
}

/** The chart's harmony in context, from the plan's chords (falling back to the frame's). */
export function harmonyOf(frame: Frame, plan: BarPlan[]): Harmony {
  const chords = Array.from({ length: frame.bars }, (_, i) => plan[i]?.chords ?? frame.chords[i]);
  return buildHarmony(chords, frame.meter.beats, frame.key, frame.style);
}

const directiveName = (d: string | undefined) => (d && d.startsWith("@") ? d.slice(1).split(/\s+/)[0].toLowerCase() : "");
const LINE_LIKE = new Set(["line", "solo", "counter", "answer"]);

/**
 * Where a player's run of improvised-line bars ends (absolute beat): phrases may cross
 * bar lines inside the run but never run into a different kind of bar, past the end of
 * the section, or across a 4-bar group.
 */
export function lineRunEnd(frame: Frame, plan: BarPlan[], memberId: string, bar: number): number {
  const beats = frame.meter.beats;
  const d = plan[bar]?.directives?.[memberId];
  const name = directiveName(d);
  if (!LINE_LIKE.has(name) || /\b(long|run)\b/.test(d ?? "")) return (bar + 1) * beats;
  // a run is bars with the same instruction. How busy it is ("sparse", "dense") isn't a change of
  // plan: a solo's lines flow across those bars, and each new phrase takes the density of the
  // bar it starts in, so a build reads as one breath getting longer rather than bar-sized bits.
  const norm = (x: string | undefined) =>
    (x ?? "").trim().replace(/^@(solo|answer)\b/, "@line").replace(/\b(sparse|dense)\b/g, "").replace(/\s+/g, " ").trim();
  const sec = sectionAt(frame, bar);
  let b = bar;
  while (b + 1 < frame.bars && b + 1 < sec.start + sec.length && (b + 1 - sec.start) % 4 !== 0) {
    if (norm(plan[b + 1]?.directives?.[memberId]) !== norm(d)) break;
    b++;
  }
  return (b + 1) * beats;
}

/**
 * Arrangement textures that change who plays, not how: in stop-time the rhythm section hits
 * the downbeat together and leaves the rest of the bar to the soloist (the hi-hat foot keeps
 * time); in a breakdown the chords and backing lines drop out and bass and drums carry on.
 */
function arrange(notes: NoteEvent[], ctx: BarCtx): NoteEvent[] {
  if (isFeaturedRole(ctx.role) || ctx.lastBar) return notes;
  const fn = ctx.member.instrument === "drums" ? "rhythm" : ctx.role === "bass" ? "bass" : ctx.inst.fn;
  if (ctx.texture === "breakdown") return fn === "chordal" || fn === "melodic" ? [] : notes;
  if (ctx.texture !== "stoptime") return notes;
  if (fn === "melodic") return [];
  if (fn === "rhythm") {
    return [
      { pitch: DRUM.kick, start: 0, dur: 0.25, vel: 0.85, art: "accent" },
      { pitch: DRUM.crash, start: 0, dur: 0.5, vel: 0.7 },
      ...[1, 3].filter((b) => b < ctx.beats).map((b) => ({ pitch: DRUM.hatPedal, start: b, dur: 0.25, vel: 0.45 })),
    ];
  }
  // the first thing this player struck, moved onto the one, short and together
  const first = notes.length ? Math.min(...notes.map((n) => n.start)) : null;
  if (first === null) return [];
  return notes.filter((n) => Math.abs(n.start - first) < 1e-6).map((n) => ({ ...n, start: 0, dur: 0.5, art: "accent" as const }));
}

export interface RealizeOptions {
  frame: Frame;
  members: Member[];
  plan: BarPlan[];
  motif: Motif;
  seed: number;
  /** Only realize these bars (others are left empty); for incremental improv. */
  bars?: number[];
  memories?: Map<string, PlayerMemory>;
  /** Notes already realized for the featured players (incremental improv). */
  priorFeatured?: Map<number, NoteEvent[]>;
  /** Only realize (member, bar) pairs that pass this filter. */
  filter?: (memberId: string, bar: number) => boolean;
}

/** Realize one bar for one member. Exposed for the improviser pipeline. */
export function makeBarCtx(
  o: RealizeOptions,
  member: Member,
  bar: number,
  mem: PlayerMemory,
  featured: NoteEvent[],
  featuredPrev: NoteEvent[],
  played: Map<number, NoteEvent[]> = new Map(),
  bassLine: NoteEvent[] | null = null,
): BarCtx {
  const { frame, plan, members, motif, seed } = o;
  const style = STYLES[frame.style];
  const beats = frame.meter.beats;
  const bp = plan[bar];
  const section = sectionAt(frame, bar);
  const chords = (bp?.chords ?? frame.chords[bar]).map((c) => ({ beat: c.beat, chord: parseChord(c.symbol) }));
  const nextBar = frame.chords[Math.min(bar + 1, frame.bars - 1)];
  const prevBar = frame.chords[Math.max(bar - 1, 0)];
  const barInSection = bar - section.start;
  const dynamic = styleDynamic(frame.style, bp?.dynamic ?? "mf", bar === frame.bars - 1);
  const has = (fn: string) => members.some((m) => INSTRUMENTS[m.instrument].fn === fn && m.id !== member.id);
  const someoneOnBass = members.some((m) => m.id !== member.id && (INSTRUMENTS[m.instrument].fn === "bass" || bp?.roles[m.id] === "bass"));
  // players of the same kind given the same directive this bar split the voices / interlock instead of doubling
  const mine = directiveName(bp?.directives?.[member.id]);
  const kind = (m: Member) => (INSTRUMENTS[m.instrument].fn === "chordal" ? "chordal" : "other");
  const peers = members.filter((m) => !isFeaturedRole(bp?.roles[m.id]) && directiveName(bp?.directives?.[m.id]) === mine && kind(m) === kind(member));
  const peerIndex = Math.max(0, peers.findIndex((m) => m.id === member.id));
  return {
    bar,
    beats,
    start: bar * beats,
    chords,
    next: parseChord(nextBar[0].symbol),
    prev: parseChord(prevBar[prevBar.length - 1].symbol),
    key: frame.key,
    standard: frame.standard,
    keyPcs: keyScale(frame.key),
    style,
    section,
    barInSection,
    phraseEnd: (barInSection + 1) % 4 === 0 || bar === section.start + section.length - 1,
    sectionStart: barInSection === 0,
    sectionEnd: bar === section.start + section.length - 1,
    firstBar: bar === 0,
    lastBar: bar === frame.bars - 1,
    dynamic,
    energy: DYNAMIC_ENERGY[dynamic],
    texture: bp?.texture ?? "groove",
    role: bp?.roles[member.id] ?? "comp",
    member,
    inst: INSTRUMENTS[member.instrument],
    rng: makeRng(seed).fork(`${member.id}:${bar}`),
    mem,
    motif,
    featured,
    featuredPrev,
    hasBass: someoneOnBass,
    hasDrums: has("rhythm"),
    hasChordal: has("chordal"),
    args: [],
    seed,
    harmony: harmonyOf(frame, plan),
    runEnd: lineRunEnd(frame, plan, member.id, bar),
    peerIndex,
    peerCount: Math.max(1, peers.length),
    playedIn: (b: number) => played.get(b) ?? null,
    energyIn: (b: number) => DYNAMIC_ENERGY[styleDynamic(frame.style, plan[b]?.dynamic ?? "mf", b === frame.bars - 1)],
    bassLine,
  };
}

function featuredOf(plan: BarPlan, members: Member[]): string | null {
  for (const m of members) if (isFeaturedRole(plan.roles[m.id]) && m.instrument !== "drums") return m.id;
  return null;
}

/** The melody of a featured part: the top note at each onset (a pianist's left hand isn't the tune). */
export function topLine(notes: NoteEvent[]): NoteEvent[] {
  const byOnset = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const k = Math.round(n.start * 96);
    byOnset.set(k, [...(byOnset.get(k) ?? []), n]);
  }
  const out: NoteEvent[] = [];
  for (const group of byOnset.values()) {
    const top = group.reduce((a, b) => (b.pitch > a.pitch ? b : a));
    // a low chord on its own is the left hand comping, not the tune
    if (group.length >= 2 && top.pitch < 62) continue;
    out.push(top);
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Velocities above 0.8 ease toward 1 instead of clipping at it, so a fortissimo out head keeps
 * its accents and phrase shape rather than every note landing on the ceiling.
 */
export function softCeiling(v: number): number {
  if (!Number.isFinite(v)) return 0.7;
  if (v <= 0.8) return v;
  return 0.8 + 0.2 * Math.tanh((v - 0.8) / 0.2);
}

/** Monophonic cleanup, range folding, and breathing for one part. */
export function finishPart(member: Member, notes: NoteEvent[]): NoteEvent[] {
  const inst = INSTRUMENTS[member.instrument];
  let out = notes
    .filter((n) => Number.isFinite(n.pitch) && Number.isFinite(n.start) && n.dur > 0)
    .map((n) => {
      let p = Math.round(n.pitch);
      if (inst.fn !== "rhythm") {
        while (p < inst.range[0]) p += 12;
        while (p > inst.range[1]) p -= 12;
      }
      return { ...n, pitch: p, dur: Math.max(0.05, n.dur), vel: Math.max(0.05, softCeiling(n.vel)) };
    })
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);

  if (!inst.poly) {
    const mono: NoteEvent[] = [];
    for (const n of out) {
      const prev = mono[mono.length - 1];
      if (prev && Math.abs(prev.start - n.start) < 1e-6) continue; // keep the top note
      if (prev && prev.start + prev.dur > n.start - 0.02) prev.dur = Math.max(0.05, n.start - prev.start - 0.02);
      mono.push({ ...n });
    }
    out = mono;
  }
  // de-duplicate identical drum hits, keeping the louder (a fill's closing accent over its ghost)
  if (inst.fn === "rhythm") {
    const kept = new Map<string, NoteEvent>();
    for (const n of out) {
      const k = `${n.pitch}:${Math.round(n.start * 48)}`;
      const had = kept.get(k);
      if (!had || n.vel > had.vel) kept.set(k, n);
    }
    const keep = new Set(kept.values());
    out = out.filter((n) => keep.has(n));
  }
  return out;
}

export function realize(o: RealizeOptions): RealizeResult {
  const t0 = performance.now();
  const { frame, members, plan } = o;
  const beats = frame.meter.beats;
  const parts: Record<string, NoteEvent[]> = {};
  const issues: RealizeIssue[] = [];
  const memories = o.memories ?? new Map<string, PlayerMemory>();
  const memOf = (id: string) => {
    if (!memories.has(id)) memories.set(id, newMemory());
    return memories.get(id)!;
  };
  for (const m of members) parts[m.id] = [];
  const bars = o.bars ?? Array.from({ length: frame.bars }, (_, i) => i);

  // featured notes per bar, relative to bar start
  const featuredByBar = o.priorFeatured ?? new Map<number, NoteEvent[]>();

  const run = (m: Member, bar: number) => {
    const bp = plan[bar];
    const directive = bp?.directives?.[m.id] ?? "@rest";
    const featured = topLine(featuredByBar.get(bar) ?? []);
    const prev = [
      ...topLine(featuredByBar.get(bar - 2) ?? []).map((n) => ({ ...n, start: n.start - 2 * beats })),
      ...topLine(featuredByBar.get(bar - 1) ?? []).map((n) => ({ ...n, start: n.start - beats })),
    ];
    const ctx = makeBarCtx(o, m, bar, memOf(m.id), featured, prev, featuredByBar, bassByBar.get(bar) ?? null);
    let res;
    try {
      res = realizeDirective(ctx, directive);
    } catch (e) {
      res = { notes: [], issues: [`engine error: ${(e as Error).message}`], kind: "rest" as const };
    }
    for (const i of res.issues) issues.push({ bar, member: m.id, detail: i });
    const inside = res.notes.filter((n) => n.start >= -1e-6 && n.start < beats - 1e-6);
    const rel = arrange(inside, ctx);
    if (inside.length < res.notes.length) issues.push({ bar, member: m.id, detail: `${res.notes.length - inside.length} notes outside the bar dropped` });
    if (res.kind !== "rest" && rel.length === 0 && directive !== "@rest") {
      // silence where the plan asked for sound is fine for rests, suspicious otherwise
    }
    // behind a soloist the band plays under them, not just less: a touch softer too
    const underSolo = (ctx.section.kind === "solo" || ctx.section.kind === "trade") && !isFeaturedRole(ctx.role);
    const mix = (ROLE_MIX[ctx.role] ?? 1) * (underSolo ? 0.88 : 1);
    for (const n of rel) parts[m.id].push({ ...n, start: n.start + bar * beats, dur: Math.min(n.dur, beats * 2), vel: n.vel * mix });
    if (ctx.role === "bass") bassByBar.set(bar, rel);
    return rel;
  };
  const bassByBar = new Map<number, NoteEvent[]>();

  // pass 1: featured players (others listen to them)
  const featuredHere = new Map<number, string>();
  for (const bar of bars) {
    const bp = plan[bar];
    const fid = bp ? featuredOf(bp, members) : null;
    for (const m of members) {
      if (!isFeaturedRole(bp?.roles[m.id])) continue;
      if (o.filter && !o.filter(m.id, bar)) continue;
      const rel = run(m, bar);
      if (m.id === fid) {
        featuredByBar.set(bar, rel);
        featuredHere.set(bar, m.id);
      }
    }
  }
  // pass 2: everyone else, the bass first so the drummer can lock to it
  for (const bar of bars) {
    const bp = plan[bar];
    for (const m of [...members].sort((a, b) => Number(bp?.roles[b.id] === "bass") - Number(bp?.roles[a.id] === "bass"))) {
      if (isFeaturedRole(bp?.roles[m.id])) continue;
      if (o.filter && !o.filter(m.id, bar)) continue;
      run(m, bar);
    }
  }

  for (const m of members) parts[m.id] = finishPart(m, parts[m.id]);

  // the band listens to itself: held notes against the harmony, the melody on top, no unison pads
  const barSet = new Set(bars);
  const lead = new Map<number, { id: string; notes: NoteEvent[] }>();
  for (const bar of bars) {
    const bp = plan[bar];
    const fid = bp ? featuredOf(bp, members) : null;
    const rel = featuredByBar.get(bar);
    if (fid && rel) {
      const notes = featuredHere.has(bar) ? parts[fid].filter((n) => Math.floor(n.start / beats + 1e-9) === bar) : rel.map((n) => ({ ...n, start: n.start + bar * beats }));
      lead.set(bar, { id: fid, notes: INSTRUMENTS[members.find((m) => m.id === fid)!.instrument].poly ? topLine(notes) : notes });
    }
  }
  const fixes = ensemble({ frame, plan, members, harmony: harmonyOf(frame, plan), parts, bars: barSet, lead });
  for (const f of fixes) issues.push({ bar: f.bar, member: f.member, detail: `ensemble: ${f.detail}` });
  // the featured line as finally played is what listeners (and a replayed head) hear
  for (const [bar, id] of featuredHere) {
    featuredByBar.set(
      bar,
      parts[id].filter((n) => Math.floor(n.start / beats + 1e-9) === bar).map((n) => ({ ...n, start: n.start - bar * beats })),
    );
  }
  // hold the last chord a little longer than written (a fermata) so endings breathe
  const lastStart = (frame.bars - 1) * beats;
  if (bars.includes(frame.bars - 1)) {
    for (const m of members) {
      for (const n of parts[m.id]) {
        if (n.start >= lastStart - 1e-6 && n.dur >= beats * 0.9) n.dur = beats * 1.6;
      }
    }
  }
  return { parts, issues, ms: performance.now() - t0, featuredByBar };
}
