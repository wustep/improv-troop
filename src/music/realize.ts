import { DYNAMIC_ENERGY, newMemory, type BarCtx, type PlayerMemory } from "./context";
import { realizeDirective } from "./directives";
import { sectionAt } from "./form";
import { INSTRUMENTS } from "./instruments";
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

export function isFeaturedRole(r: Role | undefined) {
  return !!r && FEATURED.includes(r);
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
  const has = (fn: string) => members.some((m) => INSTRUMENTS[m.instrument].fn === fn && m.id !== member.id);
  const someoneOnBass = members.some((m) => m.id !== member.id && (INSTRUMENTS[m.instrument].fn === "bass" || bp?.roles[m.id] === "bass"));
  return {
    bar,
    beats,
    start: bar * beats,
    chords,
    next: parseChord(nextBar[0].symbol),
    prev: parseChord(prevBar[prevBar.length - 1].symbol),
    key: frame.key,
    keyPcs: keyScale(frame.key),
    style,
    section,
    barInSection,
    phraseEnd: (barInSection + 1) % 4 === 0 || bar === section.start + section.length - 1,
    sectionStart: barInSection === 0,
    sectionEnd: bar === section.start + section.length - 1,
    firstBar: bar === 0,
    lastBar: bar === frame.bars - 1,
    dynamic: bp?.dynamic ?? "mf",
    energy: DYNAMIC_ENERGY[bp?.dynamic ?? "mf"],
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
  };
}

function featuredOf(plan: BarPlan, members: Member[]): string | null {
  for (const m of members) if (isFeaturedRole(plan.roles[m.id]) && m.instrument !== "drums") return m.id;
  return null;
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
      return { ...n, pitch: p, dur: Math.max(0.05, n.dur), vel: Math.max(0.05, Math.min(1, n.vel)) };
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
  // de-duplicate identical drum hits
  if (inst.fn === "rhythm") {
    const seen = new Set<string>();
    out = out.filter((n) => {
      const k = `${n.pitch}:${Math.round(n.start * 48)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
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
    const featured = featuredByBar.get(bar) ?? [];
    const prev = [
      ...(featuredByBar.get(bar - 2) ?? []).map((n) => ({ ...n, start: n.start - 2 * beats })),
      ...(featuredByBar.get(bar - 1) ?? []).map((n) => ({ ...n, start: n.start - beats })),
    ];
    const ctx = makeBarCtx(o, m, bar, memOf(m.id), featured, prev);
    let res;
    try {
      res = realizeDirective(ctx, directive);
    } catch (e) {
      res = { notes: [], issues: [`engine error: ${(e as Error).message}`], kind: "rest" as const };
    }
    for (const i of res.issues) issues.push({ bar, member: m.id, detail: i });
    const rel = res.notes.filter((n) => n.start >= -1e-6 && n.start < beats - 1e-6);
    if (rel.length < res.notes.length) issues.push({ bar, member: m.id, detail: `${res.notes.length - rel.length} notes outside the bar dropped` });
    if (res.kind !== "rest" && rel.length === 0 && directive !== "@rest") {
      // silence where the plan asked for sound is fine for rests, suspicious otherwise
    }
    for (const n of rel) parts[m.id].push({ ...n, start: n.start + bar * beats, dur: Math.min(n.dur, beats * 2) });
    return rel;
  };

  // pass 1: featured players (others listen to them)
  for (const bar of bars) {
    const bp = plan[bar];
    const fid = bp ? featuredOf(bp, members) : null;
    for (const m of members) {
      if (!isFeaturedRole(bp?.roles[m.id])) continue;
      if (o.filter && !o.filter(m.id, bar)) continue;
      const rel = run(m, bar);
      if (m.id === fid) featuredByBar.set(bar, rel);
    }
  }
  // pass 2: everyone else
  for (const bar of bars) {
    const bp = plan[bar];
    for (const m of members) {
      if (isFeaturedRole(bp?.roles[m.id])) continue;
      if (o.filter && !o.filter(m.id, bar)) continue;
      run(m, bar);
    }
  }

  for (const m of members) parts[m.id] = finishPart(m, parts[m.id]);
  return { parts, issues, ms: performance.now() - t0, featuredByBar };
}
