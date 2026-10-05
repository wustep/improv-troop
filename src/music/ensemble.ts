import { holdable, nearestIn, type Harm, type Harmony } from "./harmony";
import { INSTRUMENTS } from "./instruments";
import { keyPrefersFlats, mod, pitchName } from "./theory";
import type { BarPlan, Frame, Member, NoteEvent, Role } from "./types";

// The band listening to itself, after the notes are written. Each player's generator
// knows its own chord, but only the ensemble knows that a held note rings on into the
// next chord, that the pianist's top voice is sitting on the melody, or that two horns
// picked the same pad note. Applies to model-written notes too.

export interface EnsembleInput {
  frame: Frame;
  plan: BarPlan[];
  members: Member[];
  harmony: Harmony;
  /** Notes realized in this pass, absolute (fixed in place). */
  parts: Record<string, NoteEvent[]>;
  bars: Set<number>;
  /** Per bar: the featured player and their notes (absolute). */
  lead: Map<number, { id: string; notes: NoteEvent[] }>;
}

export interface EnsembleFix {
  bar: number;
  member: string;
  detail: string;
}

const EPS = 1e-6;
const SUPPORT: Role[] = ["comp", "pad", "counter", "fill"];

function spanAfter(h: Harmony, from: Harm, until: number): Harm[] {
  const out: Harm[] = [];
  for (const s of h.spans) if (s.start > from.start + EPS && s.start < until - EPS) out.push(s);
  return out;
}

/** The chord a note is heard against: struck just before a change and held into it, it belongs to the new chord. */
export function homeOf(h: Harmony, n: NoteEvent): Harm {
  const at = h.at(n.start);
  const nxt = h.spans.find((s) => s.start > n.start + EPS && s.start <= n.start + 0.5 + EPS);
  if (nxt && n.start + n.dur - nxt.start >= 0.5) return nxt;
  return at;
}

/** Pitches other voices sustain (>= 1 beat overlap) against a note. */
function sustainedAgainst(parts: Record<string, NoteEvent[]>, ids: string[], n: NoteEvent): number[] {
  const out: number[] = [];
  for (const id of ids) {
    for (const x of parts[id] ?? []) {
      if (x === n || x.dur < 1) continue;
      if (Math.min(x.start + x.dur, n.start + n.dur) - Math.max(x.start, n.start) >= 1) out.push(x.pitch);
    }
  }
  return out;
}

/** The nearest chord tone (or color) to `p` that neither doubles nor rubs against any of `others`. */
function freePitch(p: number, others: number[], home: Harm, style: Frame["style"], lo: number, hi: number, below = false): number | null {
  const steps = below ? [-1, -2, -3, -4, -5, -6, -7, 1, 2, 3] : [-1, 1, -2, 2, -3, 3, -4, 4, -5, 5];
  for (const d of steps) {
    const q = p + d;
    if (q < lo || q > hi || !holdable(home, mod(q, 12), style)) continue;
    if (others.some((o) => o === q || Math.abs(o - q) === 1 || Math.abs(o - q) === 13)) continue;
    return q;
  }
  return null;
}

export function ensemble(o: EnsembleInput): EnsembleFix[] {
  const { frame, plan, members, harmony, parts, bars } = o;
  const beats = frame.meter.beats;
  const style = frame.style;
  const flats = keyPrefersFlats(frame.key);
  const fixes: EnsembleFix[] = [];
  const barOf = (t: number) => Math.floor(t / beats + EPS);
  const strongRel = beats === 4 ? [0, 2] : [0];
  const note = (bar: number, member: string, detail: string) => fixes.push({ bar, member, detail });

  // ── 1. Held notes belong to the harmony they sound over ──
  for (const m of members) {
    const inst = INSTRUMENTS[m.instrument];
    if (inst.fn === "rhythm") continue;
    const notes = parts[m.id];
    if (!notes?.length) continue;
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const mono = !inst.poly;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const bar = barOf(n.start);
      if (!bars.has(bar)) continue;
      const home = homeOf(harmony, n);
      const pc = mod(n.pitch, 12);
      const rel = n.start - bar * beats;
      const downbeat = Math.abs(rel) < EPS;
      const strong = strongRel.some((s) => Math.abs(rel - s) < EPS);
      const exposed = n.dur >= 0.75 || (downbeat && n.dur >= 0.45);
      if (exposed && !holdable(home, pc, style)) {
        let ok = false;
        if (mono) {
          // a passing or approach note: it moves by step (or half step) to a note that belongs
          const nxt = notes.slice(i + 1).find((x) => x.start >= n.start + n.dur - 0.06);
          const joined = nxt && nxt.start - (n.start + n.dur) < 0.3;
          const stepTo = joined && Math.abs(nxt!.pitch - n.pitch) <= 2 && holdable(homeOf(harmony, nxt!), mod(nxt!.pitch, 12), style);
          const inScale = home.scale.includes(pc) || home.blue.includes(pc);
          if (stepTo && n.dur <= 1.05 + EPS && (!strong || inScale || Math.abs(nxt!.pitch - n.pitch) === 1)) ok = true;
        }
        if (!ok && home.scale.includes(pc) && !home.avoid.includes(pc) && n.dur < 1.5 && !strong) ok = true;
        if (!ok) {
          const prev = mono ? notes[i - 1]?.pitch : undefined;
          const dir = (prev === undefined ? -1 : Math.sign(n.pitch - prev) || -1) as 1 | -1;
          const fixed = nearestIn(n.pitch, home.tones, dir, 2);
          note(bar, m.id, `held ${pitchName(n.pitch, flats)} over ${home.chord.symbol} bent to ${pitchName(fixed, flats)}`);
          n.pitch = fixed;
        }
      }
      // ringing on into a chord it doesn't belong to: let go at the change
      for (const s of spanAfter(harmony, home, n.start + n.dur - 0.4)) {
        if (holdable(s, mod(n.pitch, 12), style)) continue;
        const cut = s.start - n.start - 0.02;
        if (cut >= 0.2) {
          n.dur = cut;
          note(bar, m.id, `${pitchName(n.pitch, flats)} released at the change to ${s.chord.symbol}`);
        }
        break;
      }
    }
  }

  // ── 2. The melody stays on top and unclouded ──
  const leadIds = new Set([...o.lead.values()].map((l) => l.id));
  /** Melody notes a supporting note sounds against. */
  const melodyAgainst = (n: NoteEvent, self: string): NoteEvent[] => {
    const out: NoteEvent[] = [];
    const bar = barOf(n.start);
    for (const b of [bar, bar + 1]) {
      const lead = o.lead.get(b);
      if (!lead || lead.id === self) continue;
      for (const L of lead.notes) if (Math.min(n.start + n.dur, L.start + L.dur) - Math.max(n.start, L.start) >= 0.3) out.push(L);
    }
    return out;
  };
  /** Highest a supporting note may sit: under the tune, when the tune leaves room. */
  const ceilingFor = (m: Member, n: NoteEvent): number => {
    const inst = INSTRUMENTS[m.instrument];
    const tune = melodyAgainst(n, m.id).filter((L) => L.pitch >= 55 && L.pitch - 1 >= inst.range[0] + 7);
    return inst.poly && tune.length ? Math.min(...tune.map((L) => L.pitch)) - 1 : inst.range[1];
  };
  const rubsLead = (p: number, L: NoteEvent) => {
    const below = L.pitch - p;
    return below === -1 || below === -13 || (below > 0 && below % 12 === 1 && below < 26);
  };
  for (const m of members) {
    const inst = INSTRUMENTS[m.instrument];
    if (inst.fn === "rhythm" || inst.fn === "bass") continue;
    const notes = parts[m.id];
    if (!notes?.length) continue;
    const remove = new Set<NoteEvent>();
    for (const n of notes) {
      const bar = barOf(n.start);
      if (!bars.has(bar)) continue;
      const role = plan[bar]?.roles[m.id];
      if (!role || role === "bass" || !SUPPORT.includes(role)) continue;
      const chordal = inst.poly && (role === "comp" || role === "pad");
      // every melody note this one sounds against (the tune may move on while it rings)
      const against: NoteEvent[] = [];
      for (const b of [bar, bar + 1]) {
        const lead = o.lead.get(b);
        if (!lead || lead.id === m.id) continue;
        for (const L of lead.notes) {
          const overlap = Math.min(n.start + n.dur, L.start + L.dur) - Math.max(n.start, L.start);
          if (overlap >= 0.3 && L.dur >= 0.4) against.push(L);
        }
      }
      if (!against.length) continue;
      // comping stays under the tune wherever there's room for it (not under a low dip of the line)
      const over = against.filter((L) => chordal && L.pitch >= 55 && L.pitch - 1 >= inst.range[0] + 7);
      const floor = over.length ? Math.min(...over.map((L) => L.pitch)) : Infinity;
      const clouds = (p: number, L: NoteEvent) => rubsLead(p, L) || L.pitch === p || (over.includes(L) && p >= L.pitch);
      const bad = (p: number) => against.some((L) => clouds(p, L));
      if (!bad(n.pitch)) continue;
      // a struck chord lets go when the tune moves onto it
      const firstBad = against.filter((L) => clouds(n.pitch, L)).sort((a, b) => a.start - b.start)[0];
      if (firstBad && firstBad.start - n.start >= 0.5 - EPS) {
        n.dur = firstBad.start - n.start - 0.02;
        note(bar, m.id, `let go of ${pitchName(n.pitch, flats)} as the melody arrived on ${pitchName(firstBad.pitch, flats)}`);
        continue;
      }
      const hit = notes.filter((x) => Math.abs(x.start - n.start) < EPS && !remove.has(x));
      if (chordal && hit.length >= 3) {
        remove.add(n);
        note(bar, m.id, `dropped ${pitchName(n.pitch, flats)} from the voicing (clouding the melody's ${pitchName(firstBad?.pitch ?? floor, flats)})`);
        continue;
      }
      // move it down to a chord tone under the melody that doesn't rub
      const home = homeOf(harmony, n);
      let p = Math.min(n.pitch, floor - 1);
      let found: number | null = null;
      for (let k = 0; k < 14 && p >= inst.range[0]; k++, p--) {
        if (holdable(home, mod(p, 12), style) && !bad(p)) {
          found = p;
          break;
        }
      }
      if (found !== null && found !== n.pitch) {
        note(bar, m.id, `moved ${pitchName(n.pitch, flats)} under the melody to ${pitchName(found, flats)}`);
        n.pitch = found;
      } else if (found === null && chordal) {
        remove.add(n);
      }
    }
    if (remove.size) parts[m.id] = notes.filter((x) => !remove.has(x));
  }

  // ── 3. Supporting voices don't double each other (or the melody) in unison ──
  const support = members.filter((m) => INSTRUMENTS[m.instrument].fn !== "rhythm" && INSTRUMENTS[m.instrument].fn !== "bass");
  for (let a = 0; a < support.length; a++) {
    for (let b = a + 1; b < support.length; b++) {
      const A = support[a];
      const B = support[b];
      for (const n of parts[B.id] ?? []) {
        if (n.dur < 1) continue;
        const bar = barOf(n.start);
        if (!bars.has(bar)) continue;
        const roleB = plan[bar]?.roles[B.id];
        if (!roleB || !SUPPORT.includes(roleB) || (leadIds.has(B.id) && o.lead.get(bar)?.id === B.id)) continue;
        const twin = (parts[A.id] ?? []).find((x) => x.pitch === n.pitch && x.dur >= 1 && Math.min(x.start + x.dur, n.start + n.dur) - Math.max(x.start, n.start) >= 1);
        if (!twin) continue;
        const home = homeOf(harmony, n);
        const others = [...sustainedAgainst(parts, support.map((x) => x.id).filter((id) => id !== B.id), n), ...melodyAgainst(n, B.id).map((L) => L.pitch)];
        const alt = freePitch(n.pitch, others, home, style, INSTRUMENTS[B.instrument].range[0], ceilingFor(B, n), true);
        if (alt !== null) {
          note(bar, B.id, `split from ${A.name}'s ${pitchName(n.pitch, flats)} to ${pitchName(alt, flats)}`);
          n.pitch = alt;
        }
      }
    }
  }

  // ── 4. Sustained supporting voices don't rub a half step against each other (or the bass) ──
  const voices = [...members.filter((m) => INSTRUMENTS[m.instrument].fn === "bass" || plan.some((bp) => bp.roles[m.id] === "bass")), ...support];
  for (let a = 0; a < voices.length; a++) {
    for (let b = a + 1; b < voices.length; b++) {
      const A = voices[a];
      const B = voices[b];
      if (A.id === B.id || INSTRUMENTS[B.instrument].fn === "bass") continue;
      const instB = INSTRUMENTS[B.instrument];
      for (const n of parts[B.id] ?? []) {
        if (n.dur < 1) continue;
        const bar = barOf(n.start);
        if (!bars.has(bar) || o.lead.get(bar)?.id === B.id) continue;
        const roleB = plan[bar]?.roles[B.id];
        if (!roleB || !SUPPORT.includes(roleB)) continue;
        const sounding = (parts[A.id] ?? []).filter((x) => x.dur >= 1 && Math.min(x.start + x.dur, n.start + n.dur) - Math.max(x.start, n.start) >= 1);
        const rubs = (p: number) => sounding.some((x) => Math.abs(x.pitch - p) === 1 || Math.abs(x.pitch - p) === 13);
        if (!rubs(n.pitch)) continue;
        const home = homeOf(harmony, n);
        const others = [...sustainedAgainst(parts, voices.map((x) => x.id).filter((id) => id !== B.id), n), ...melodyAgainst(n, B.id).map((L) => L.pitch)];
        const fixed = freePitch(n.pitch, others, home, style, instB.range[0], ceilingFor(B, n));
        if (fixed !== null) {
          note(bar, B.id, `${pitchName(n.pitch, flats)} rubbed against ${A.name}; moved to ${pitchName(fixed, flats)}`);
          n.pitch = fixed;
        }
      }
    }
  }

  // tidy: a poly part may now hold the same pitch twice at one onset
  for (const m of members) {
    const ns = parts[m.id];
    if (!ns || !INSTRUMENTS[m.instrument].poly || INSTRUMENTS[m.instrument].fn === "rhythm") continue;
    const seen = new Set<string>();
    parts[m.id] = ns.filter((n) => {
      const k = `${n.pitch}:${Math.round(n.start * 96)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return fixes;
}
