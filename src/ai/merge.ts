import { INSTRUMENTS } from "@/music/instruments";
import { motifFromText } from "@/music/motif";
import { looksLikeDrumGrid, notesToText, parseDrumGrid, parseNotes, spellChordSymbols, squeezeBar } from "@/music/notation";
import { isFeaturedRole } from "@/music/realize";
import { fold, keyPrefersFlats } from "@/music/theory";
import type { BarPlan, Dynamic, Frame, InstrumentFunction, Member, Motif, NoteEvent, Role, Texture } from "@/music/types";
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

const OCTAVE_WORDS = ["", "an octave", "two octaves"];

/**
 * The single octave shift (in octaves, -2..2) that puts the most pitches inside [lo, hi].
 * Moving a whole line keeps its shape; folding note by note breaks it mid-phrase.
 * Shifts only when that strictly fits more notes; ties go to the smaller move.
 */
export function registerShift(pitches: number[], lo: number, hi: number): number {
  const fits = (k: number) => pitches.filter((p) => p + 12 * k >= lo && p + 12 * k <= hi).length;
  let best = 0;
  let bestFit = fits(0);
  for (const k of [-1, 1, -2, 2]) {
    const f = fits(k);
    if (f > bestFit) {
      best = k;
      bestFit = f;
    }
  }
  return best;
}

/** Move every pitch in note text by whole octaves, leaving durations, ties and accents alone. */
export function shiftOctaves(text: string, octaves: number): string {
  if (!octaves) return text;
  return text.replace(/(^|[\s,[~])([A-Ga-g][#b]{0,2})(-?\d)(?=[/\s,\]~>'?]|$)/g, (_, pre, name, oct) => `${pre}${name}${parseInt(oct, 10) + octaves}`);
}

const fmtBeats = (b: number) => String(Math.round(b * 100) / 100);

function movedWords(octaves: number): string {
  return `${octaves < 0 ? "down" : "up"} ${OCTAVE_WORDS[Math.abs(octaves)]}`;
}

// What each kind of player can be told to do while someone else is featured.
const ACCOMPANIMENT: Record<InstrumentFunction, RegExp> = {
  rhythm: /^@(groove)$/,
  bass: /^@(walk|two|bossa|funk|baroque|pedal|pump|groove)$/,
  chordal: /^@(comp|pulse|stride|arp|prelude|continuo|pad|shimmer|bossa|funk|groove|guide)$/,
  melodic: /^@(guide|harmony|canon|riff|counter|pad|arp|comp|shimmer)$/,
};
// cellos also pluck and bow
const CELLO_EXTRA = /^@(pizz|arco)$/;
// anyone can rest, fill, hit with the band, end, or bring the tune back
const ANYONE = /^@(rest|end|fill|hits|head|tune)$/;
// what a featured player can play in their own bars (the last bar can also @end)
// where written notes start: a pitch, a rest, or a chord
const WRITTEN_START = /^([A-G][#b]{0,2}-?\d|[rR]\/|\[)/;
const FEATURED_VOCAB = /^@(motif|line|answer|solo|trade|head|tune|fill|rest|end)$/;

/**
 * Is this an accompaniment directive this player can play? A cello covering the bass chair
 * speaks the bass vocabulary. Featured directives (@motif, @line, @solo...) never are.
 */
export function accompanimentFits(directive: string, member: Member, role?: Role): boolean {
  const head = directive.trim().split(/\s+/)[0];
  const inst = INSTRUMENTS[member.instrument];
  const fn = role === "bass" && inst.bassCapable ? "bass" : inst.fn;
  return ACCOMPANIMENT[fn].test(head) || (member.instrument === "cello" && CELLO_EXTRA.test(head));
}

/**
 * Validate one bar's content for one member. Returns the cleaned text or null (fall back).
 * With a role, a directive for an accompanying player must be one they can play, and a
 * featured player's must be a featured part (not comping or a pattern under someone else).
 */
export function validateBarText(text: string, member: Member, beats: number, repairs: string[], where: string, role?: Role): string | null {
  let t = text.trim();
  if (!t) return null;
  const fn = INSTRUMENTS[member.instrument].fn;
  if (t.startsWith("@")) {
    // "@motif D5/8 F5/8 ...", "@groove light rd:x...": the part written out after a directive is
    // what the player meant (the directive would ignore it). Use it when it reads cleanly.
    const words = t.split("\n")[0].split(/\s+/);
    const at = words.findIndex((w, i) => i > 0 && (WRITTEN_START.test(w) || /^[a-z0-9]{1,5}:[xXgo.\-|]/.test(w)));
    if (at > 0) {
      const written = words.slice(at).join(" ");
      const grid = looksLikeDrumGrid(written);
      const readable = grid ? fn === "rhythm" && !parseDrumGrid(written, beats).errors.length : fn !== "rhythm" && !parseNotes(written.split("|")[0], beats).errors.some((e) => /^bad/.test(e));
      if (readable) {
        repairs.push(`${where}: ${words[0]} with the part written out; played as written`);
        return validateBarText(written, member, beats, repairs, where, role);
      }
      t = words.slice(0, at).join(" ");
    }
    const d = t.split("\n")[0].slice(0, 80);
    if (role && !isFeaturedRole(role) && !ANYONE.test(d.split(/\s+/)[0]) && !accompanimentFits(d, member, role)) {
      repairs.push(`${where}: ${d.split(/\s+/)[0]} isn't something ${member.name} plays while accompanying; kept the plan`);
      return null;
    }
    if (isFeaturedRole(role) && !FEATURED_VOCAB.test(d.split(/\s+/)[0])) {
      repairs.push(`${where}: ${d.split(/\s+/)[0]} isn't a featured part; ${member.name} keeps the plan`);
      return null;
    }
    return d;
  }
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
  // a multi-bar string in one cell: keep the first bar; a directive tacked on the end ("... @end") goes
  let first = t.split("|")[0].replace(/\s@\w[^]*$/, "").trim();
  const inst = INSTRUMENTS[member.instrument];
  const spelled = spellChordSymbols(first, fn === "bass" || role === "bass" ? inst.sweet[0] : Math.max(inst.sweet[0], 55), fn === "bass" || role === "bass");
  if (spelled.fixed) {
    repairs.push(`${where}: chord symbols written as notes, spelled out`);
    first = spelled.text;
  }
  let r = parseNotes(first, beats);
  if (r.covered > beats + 1e-6) {
    const squeezed = squeezeBar(first, beats);
    if (squeezed) {
      repairs.push(`${where}: ${fmtBeats(r.covered)} beats in a ${fmtBeats(beats)}-beat bar, squeezed to fit`);
      first = squeezed;
      r = parseNotes(first, beats);
    }
  }
  if (!r.notes.length && !/^(r\/\S+\s*)+$/.test(first)) {
    repairs.push(`${where}: unreadable notes "${first.slice(0, 40)}" (${r.errors[0] ?? "empty"})`);
    return null;
  }
  // a bass or comping figure that fills half (or a quarter) of the bar is a riff: it goes round again
  const accompanying = role ? !isFeaturedRole(role) : fn !== "melodic";
  const times = beats / r.covered;
  if (accompanying && fn !== "melodic" && !r.errors.length && r.covered > 0 && times > 1.5 && Math.abs(times - Math.round(times)) < 1e-6) {
    repairs.push(`${where}: a ${fmtBeats(r.covered)}-beat figure, repeated to fill the bar`);
    first = Array.from({ length: Math.round(times) }, () => first).join(" ");
    r = parseNotes(first, beats);
  }
  if (r.errors.length) repairs.push(`${where}: ${r.errors.slice(0, 2).join("; ")}`);
  if (r.covered < beats - 1e-6) repairs.push(`${where}: short bar padded with rest`);
  const k = registerShift(r.notes.map((n) => n.pitch), inst.range[0], inst.range[1]);
  if (k) {
    repairs.push(`${where}: moved ${movedWords(k)} to sit in the ${inst.name.toLowerCase()}'s range`);
    return shiftOctaves(first, k);
  }
  return first;
}

/** Write motif notes back as text, a bar per "|". */
export function motifText(notes: NoteEvent[], length: number, beats: number, flats: boolean): string {
  const bars = Math.max(1, Math.ceil(length / beats - 1e-6));
  if (bars === 1) return notesToText(notes, Math.max(beats, length), flats);
  return Array.from({ length: bars }, (_, b) =>
    notesToText(
      notes.filter((n) => n.start >= b * beats - 1e-6 && n.start < (b + 1) * beats - 1e-6).map((n) => ({ ...n, start: n.start - b * beats, dur: Math.min(n.dur, (b + 1) * beats - n.start) })),
      beats,
      flats,
    ),
  ).join(" | ");
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
  let changed = false;
  if (m.notes.length > 16) {
    m.notes = m.notes.slice(0, 16);
    const end = m.notes.reduce((x, n) => Math.max(x, n.start + n.dur), 0);
    m.length = Math.min(m.length, Math.max(1, Math.ceil(end)));
    changed = true;
  }
  if (leader) {
    const inst = INSTRUMENTS[leader.instrument];
    if (inst.fn !== "rhythm") {
      const k = registerShift(m.notes.map((n) => n.pitch), inst.range[0], inst.range[1]);
      if (k) {
        repairs.push(`motif moved ${movedWords(k)} into the leader's range`);
        m.notes = m.notes.map((n) => ({ ...n, pitch: n.pitch + 12 * k }));
        changed = true;
      }
      const out = m.notes.some((n) => n.pitch < inst.range[0] || n.pitch > inst.range[1]);
      if (out) {
        repairs.push("motif folded into the leader's range");
        m.notes = m.notes.map((n) => ({ ...n, pitch: fold(n.pitch, inst.range[0], inst.range[1]) }));
        changed = true;
      }
    }
  }
  // everyone after the count-off reads the motif as text: it has to say what will be played
  if (changed) m.text = motifText(m.notes, m.length, frame.meter.beats, keyPrefersFlats(frame.key));
  return m;
}

/** The directive a member plays most while accompanying (ties go to the earliest), or null. */
export function usualDirective(plan: BarPlan[], memberId: string): string | null {
  const counts = new Map<string, number>();
  for (const bp of plan) {
    const d = bp.directives?.[memberId];
    if (!d || d === "@rest" || d === "@end" || isFeaturedRole(bp.roles[memberId])) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [d, n] of counts) if (best === null || n > counts.get(best)!) best = d;
  return best;
}

/**
 * A bandmate's go-to directive swaps in for their usual one, and only that: bars the
 * arrangement shaped (a head in two, a light intro, a peak out-chorus, shout riffs) keep their part.
 */
export function applyDefault(plan: BarPlan[], memberId: string, directive: string): number {
  const usual = usualDirective(plan, memberId);
  if (!usual) return 0;
  let n = 0;
  for (const bp of plan) {
    if (bp.directives?.[memberId] !== usual || isFeaturedRole(bp.roles[memberId])) continue;
    bp.directives = { ...bp.directives, [memberId]: directive };
    n++;
  }
  return n;
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
    for (const [at, b1] of bars.entries()) {
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
        let text = asString(v, 600);
        if (!text) continue;
        // a range written bar by bar ("bars": "7-8", "@motif invert | @line sparse"): each bar its own
        const each = text.split("|").map((x) => x.trim()).filter(Boolean);
        if (bars.length > 1 && each.length > 1) text = each[Math.min(at, each.length - 1)];
        // the out head (and a repeated A) comes back to the melody: those bars stay locked, to
        // the bar the code chose (models count "@head 1" from the head, not the chart)
        const locked = base[i]?.directives?.[m.id];
        if (locked && /^@(head|tune)\b/.test(locked) && text.trim().replace(/[\s,.;]+$/, "") !== locked) {
          repairs.push(`bar ${b1} ${m.name}: kept ${locked} (the tune comes back to the melody here)`);
          continue;
        }
        const role = frame.slots[i]?.[m.id] ?? base[i]?.roles[m.id];
        const clean = validateBarText(text, m, frame.meter.beats, repairs, `bar ${b1} ${m.name}`, role);
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
        // an ending or a band hit in the middle of a solo isn't a solo either
        const ending = /^@(end|hits)\b/.test(d) && bp.index !== frame.bars - 1;
        const accompaniment = ending || /^@(walk|two|bossa|funk|baroque|pedal|pump|comp|pulse|pizz|arco|stride|arp|prelude|continuo|pad|shimmer|groove|guide|harmony|canon|riff|counter|rest)\b/.test(d);
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
