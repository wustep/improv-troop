import { INSTRUMENTS } from "@/music/instruments";
import { motifFromText } from "@/music/motif";
import { looksLikeDrumGrid, parseNotes } from "@/music/notation";
import { isFeaturedRole } from "@/music/realize";
import { fold } from "@/music/theory";
import type { BarPlan, Dynamic, Frame, Member, Motif, Role, Texture } from "@/music/types";
import { asRecord, asString, parseBarRange } from "./json";

const TEXTURES: Texture[] = ["sparse", "groove", "build", "peak", "breakdown", "tutti", "stoptime", "ostinato"];
const DYNAMICS: Dynamic[] = ["pp", "p", "mp", "mf", "f", "ff"];

export function asTexture(v: unknown): Texture | undefined {
  const s = asString(v)?.toLowerCase().trim();
  return TEXTURES.find((t) => t === s);
}

export function asDynamic(v: unknown): Dynamic | undefined {
  const s = asString(v)?.toLowerCase().trim();
  return DYNAMICS.find((d) => d === s);
}

/** Match a model-written member key ("fox", "Rusty", "rusty the fox") to a member id. */
export function resolveMember(key: string, members: Member[]): Member | undefined {
  const k = key.toLowerCase().trim();
  return (
    members.find((m) => m.id.toLowerCase() === k) ??
    members.find((m) => m.name.toLowerCase() === k) ??
    members.find((m) => k.includes(m.name.toLowerCase()) || k.includes(m.id.toLowerCase()))
  );
}

/** Validate one bar's content for one member. Returns the cleaned text or null (fall back). */
export function validateBarText(text: string, member: Member, beats: number, repairs: string[], where: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const fn = INSTRUMENTS[member.instrument].fn;
  if (t.startsWith("@")) return t.split("\n")[0].slice(0, 80);
  if (looksLikeDrumGrid(t)) {
    if (fn !== "rhythm") {
      repairs.push(`${where}: drum grid for ${member.name} ignored`);
      return null;
    }
    return t;
  }
  if (fn === "rhythm") {
    repairs.push(`${where}: notes for drums ignored`);
    return null;
  }
  // a multi-bar string in one cell: keep the first bar
  const first = t.split("|")[0].trim();
  const r = parseNotes(first, beats);
  if (!r.notes.length && !/^(r\/\S+\s*)+$/.test(first)) {
    repairs.push(`${where}: unreadable notes "${first.slice(0, 40)}" (${r.errors[0] ?? "empty"})`);
    return null;
  }
  if (r.errors.length) repairs.push(`${where}: ${r.errors.slice(0, 2).join("; ")}`);
  if (r.covered < beats - 1e-6) repairs.push(`${where}: short bar padded with rest`);
  return first;
}

/** Leader motif from model text; validated into the leader's range, 1–2 bars, 2–16 notes. */
export function validateMotif(text: unknown, idea: unknown, frame: Frame, leader: Member | undefined, repairs: string[]): Motif | null {
  const t = asString(text, 300);
  if (!t) {
    repairs.push("no motif given");
    return null;
  }
  const bars = t.split("|").slice(0, 2).join(" | ");
  const m = motifFromText(bars, frame.meter.beats, frame.chords[0][0].symbol, asString(idea, 80));
  if (m.notes.length < 2) {
    repairs.push(`motif "${t.slice(0, 40)}" has too few notes`);
    return null;
  }
  if (m.notes.length > 16) m.notes = m.notes.slice(0, 16);
  if (leader) {
    const inst = INSTRUMENTS[leader.instrument];
    if (inst.fn !== "rhythm") {
      const out = m.notes.some((n) => n.pitch < inst.range[0] || n.pitch > inst.range[1]);
      if (out) {
        repairs.push("motif folded into the leader's range");
        m.notes = m.notes.map((n) => ({ ...n, pitch: fold(n.pitch, inst.range[0], inst.range[1]) }));
      }
    }
  }
  return m;
}

function defaultFeaturedDirective(role: Role, member: Member): string {
  if (member.instrument === "drums") return "@solo";
  return role === "lead" ? "@motif" : "@line";
}

function roleFromDirective(d: string, member: Member, locked: Role | undefined): Role {
  if (locked) return locked;
  const fn = INSTRUMENTS[member.instrument].fn;
  if (d === "@rest") return "rest";
  if (fn === "rhythm") return d.startsWith("@fill") ? "fill" : "groove";
  if (fn === "bass") return "bass";
  if (fn === "chordal") return "comp";
  if (d.startsWith("@pad")) return "pad";
  if (d.startsWith("@fill")) return "fill";
  return "counter";
}

/**
 * Merge a model's bar entries ({bar|bars, texture, dynamic, cue, parts}) onto a
 * baseline plan. Anything missing or invalid keeps the baseline; locked slots are enforced.
 */
export function mergePlan(
  base: BarPlan[],
  entries: unknown,
  frame: Frame,
  members: Member[],
  repairs: string[],
  opts: { onlyMembers?: string[]; onlyBars?: number[] } = {},
): BarPlan[] {
  const plan = base.map((b) => ({ ...b, roles: { ...b.roles }, directives: { ...(b.directives ?? {}) } }));
  const covered = new Set<number>();
  const list = Array.isArray(entries) ? entries : [];
  if (!Array.isArray(entries)) repairs.push("plan had no bars array; kept the local plan");

  for (const raw of list) {
    const e = asRecord(raw);
    const bars = parseBarRange(e.bars ?? e.bar);
    if (!bars.length) {
      repairs.push(`entry without a bar number skipped`);
      continue;
    }
    for (const b1 of bars) {
      const i = b1 - 1;
      if (i < 0 || i >= frame.bars) {
        repairs.push(`bar ${b1} is outside the ${frame.bars}-bar frame; ignored (length is locked)`);
        continue;
      }
      if (opts.onlyBars && !opts.onlyBars.includes(i)) continue;
      covered.add(i);
      const bp = plan[i];
      const tex = asTexture(e.texture);
      const dyn = asDynamic(e.dynamic);
      if (tex) bp.texture = tex;
      if (dyn) bp.dynamic = dyn;
      const cue = asString(e.cue, 120);
      if (cue) bp.cue = cue;
      const parts = asRecord(e.parts ?? e.players ?? e.directives);
      for (const [k, v] of Object.entries(parts)) {
        const m = resolveMember(k, members);
        if (!m) {
          repairs.push(`bar ${b1}: unknown player "${k}"`);
          continue;
        }
        if (opts.onlyMembers && !opts.onlyMembers.includes(m.id)) continue;
        const text = asString(v, 600);
        if (!text) continue;
        // the out head (and a repeated A) comes back to the melody: those bars stay locked
        const locked = base[i]?.directives?.[m.id];
        if (locked?.startsWith("@head") && !text.trim().startsWith("@head")) {
          repairs.push(`bar ${b1} ${m.name}: kept ${locked} (the tune comes back to the melody here)`);
          continue;
        }
        const clean = validateBarText(text, m, frame.meter.beats, repairs, `bar ${b1} ${m.name}`);
        if (clean) bp.directives[m.id] = clean;
      }
    }
  }

  if (list.length && !opts.onlyBars) {
    const missing = plan.map((_, i) => i).filter((i) => !covered.has(i));
    if (missing.length) repairs.push(`bars ${missing.map((i) => i + 1).join(",")} not planned; kept the local plan there`);
  }
  return enforceSlots(plan, frame, members, repairs);
}

/** Featured players must play in their slots; roles follow the directives. */
export function enforceSlots(plan: BarPlan[], frame: Frame, members: Member[], repairs: string[]): BarPlan[] {
  for (const bp of plan) {
    const slots = frame.slots[bp.index] ?? {};
    for (const m of members) {
      const locked = slots[m.id];
      let d = bp.directives?.[m.id] ?? "@rest";
      if (isFeaturedRole(locked)) {
        const accompaniment = /^@(walk|two|bossa|funk|baroque|pedal|comp|pizz|arco|stride|arp|prelude|continuo|pad|shimmer|groove|guide|harmony|canon|riff|counter|rest)\b/.test(d);
        if (accompaniment && !(m.instrument === "drums" && locked === "groove")) {
          const fix = defaultFeaturedDirective(locked!, m);
          repairs.push(`bar ${bp.index + 1}: ${m.name} is featured (${locked}) but was given ${d}; playing ${fix}`);
          d = fix;
        }
      }
      if (locked === "rest" && d !== "@rest") d = "@rest";
      bp.directives = { ...(bp.directives ?? {}), [m.id]: d };
      bp.roles[m.id] = roleFromDirective(d, m, locked);
    }
  }
  return plan;
}
