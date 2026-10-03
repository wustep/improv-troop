// Score → notation model (staves, expanded bars, row geometry). DOM-free.

import type { ChordChange, Score } from "../music/types";
import { INSTRUMENTS } from "../music/instruments";
import { expandPart, keySpec, spellingTable, type BarTokens } from "./expand";

export const BARS_PER_ROW = 4;
export const LABEL_W = 70;
/** y of the first stave's top line inside a row. */
export const ROW_TOP = 96;
/** Distance between top lines of consecutive staves. */
export const STAFF_GAP = 96;
/** Distance between the two staves of a grand staff. */
export const GRAND_GAP = 82;
export const STAFF_H = 40;
export const ROW_BOTTOM = 46;
export const MIN_ROW_WIDTH = 720;

const ABBR: Record<string, string> = {
  piano: "Pno.",
  bass: "Bass",
  drums: "Dr.",
  trumpet: "Tpt.",
  sax: "T. Sx.",
  trombone: "Tbn.",
  clarinet: "Cl.",
  flute: "Fl.",
  violin: "Vln.",
  cello: "Vc.",
  guitar: "Gtr.",
  vibes: "Vib.",
};

export type ClefName = "treble" | "bass" | "tenor" | "percussion";

export interface StaffSpec {
  memberId: string;
  name: string;
  abbr: string;
  clef: ClefName;
  /** Per-row clef (cello reads tenor clef for high systems). Falls back to `clef`. */
  rowClef?: ClefName[];
  /** Bowing marks ("pizz." / "arco") per bar: token index → text. */
  marks?: Map<number, { k: number; text: string }[]>;
  drums: boolean;
  bars: BarTokens[];
  /** Grand staff: "top" is braced to the next staff. */
  grand?: "top" | "bottom";
}

export interface SheetModel {
  scoreId: string;
  title: string;
  bars: number;
  bpb: number;
  keySpec: string;
  spelling: { letter: number; alter: number }[];
  staffs: StaffSpec[];
  chords: ChordChange[][];
  sectionStarts: Map<number, string>;
  tempo: number;
  feel: string;
  rows: number;
  rowHeight: number;
  /** Top-line y of each staff within a row. */
  staffY: number[];
  expandMs: number;
}

/** Cellists switch to tenor clef when a system sits high; decide per row (4 bars). */
function tenorRows(bars: BarTokens[], nBars: number): ClefName[] {
  const rows: ClefName[] = [];
  for (let r = 0; r * BARS_PER_ROW < nBars; r++) {
    const pitches = bars
      .slice(r * BARS_PER_ROW, (r + 1) * BARS_PER_ROW)
      .flatMap((b) => b.tokens.filter((t) => t.kind === "note").flatMap((t) => t.pitches));
    if (pitches.length < 3) {
      rows.push("bass");
      continue;
    }
    // choose the clef that needs fewer ledger lines (bass staff G2–A3, tenor staff D3–E4)
    const ledgers = (lo: number, hi: number) =>
      pitches.reduce((sum, p) => sum + (p > hi ? Math.ceil((p - hi) / 3.5) : p < lo ? Math.ceil((lo - p) / 3.5) : 0), 0);
    const bassCost = ledgers(41, 59);
    const tenorCost = ledgers(48, 66);
    rows.push(tenorCost < bassCost * 0.7 ? "tenor" : "bass");
  }
  return rows;
}

/** "pizz." / "arco" wherever a bowed string changes how it's playing. */
function bowingMarks(bars: BarTokens[]): Map<number, { k: number; text: string }[]> {
  const out = new Map<number, { k: number; text: string }[]>();
  let state: "arco" | "pizz" = "arco";
  for (const b of bars) {
    b.tokens.forEach((t, k) => {
      if (t.kind !== "note" || t.tiedFrom) return;
      const s = t.art === "pizz" ? "pizz" : "arco";
      if (s !== state) {
        state = s;
        const list = out.get(b.bar) ?? [];
        list.push({ k, text: s === "pizz" ? "pizz." : "arco" });
        out.set(b.bar, list);
      }
    });
  }
  return out;
}

export function buildModel(score: Score): SheetModel {
  const t0 = performance.now();
  const bpb = Math.max(2, Math.min(7, Math.round(score.frame?.meter?.beats ?? score.settings?.meter?.beats ?? 4)));
  const bars = Math.max(1, Math.round(score.frame?.bars ?? score.settings?.bars ?? 8));
  const key = score.settings?.key ?? score.frame?.key ?? { tonic: "C", mode: "major" as const };

  const staffs: StaffSpec[] = [];
  for (const m of score.members) {
    const inst = INSTRUMENTS[m.instrument] ?? INSTRUMENTS.piano;
    const notes = score.parts?.[m.id] ?? [];
    const abbr = ABBR[m.instrument] ?? inst.name;
    if (inst.clef === "grand") {
      staffs.push({
        memberId: m.id,
        name: m.name,
        abbr,
        clef: "treble",
        drums: false,
        grand: "top",
        bars: expandPart(notes.filter((n) => n.pitch >= 60), { bars, beatsPerBar: bpb }),
      });
      staffs.push({
        memberId: m.id,
        name: m.name,
        abbr,
        clef: "bass",
        drums: false,
        grand: "bottom",
        bars: expandPart(notes.filter((n) => n.pitch < 60), { bars, beatsPerBar: bpb }),
      });
    } else if (inst.clef === "percussion") {
      staffs.push({ memberId: m.id, name: m.name, abbr, clef: "percussion", drums: true, bars: expandPart(notes, { bars, beatsPerBar: bpb }) });
    } else {
      const expanded = expandPart(notes, { bars, beatsPerBar: bpb, shift: inst.notationShift });
      staffs.push({
        memberId: m.id,
        name: m.name,
        abbr,
        clef: inst.clef,
        drums: false,
        bars: expanded,
        ...(m.instrument === "cello" ? { rowClef: tenorRows(expanded, bars) } : {}),
        ...(inst.bowed ? { marks: bowingMarks(expanded) } : {}),
      });
    }
  }

  const staffY: number[] = [];
  // Drum stems + tuplet numbers reach high; give chord symbols room above them.
  let y = ROW_TOP + (staffs[0]?.drums ? 24 : 0);
  staffs.forEach((s, i) => {
    if (i > 0) y += staffs[i - 1].grand === "top" ? GRAND_GAP : STAFF_GAP;
    staffY.push(y);
  });
  const rowHeight = (staffs.length ? y + STAFF_H : ROW_TOP) + ROW_BOTTOM;

  const chords: ChordChange[][] = [];
  for (let b = 0; b < bars; b++) {
    const fromPlan = score.plan?.[b]?.chords;
    chords.push((fromPlan && fromPlan.length ? fromPlan : score.frame?.chords?.[b]) ?? []);
  }
  const sectionStarts = new Map<number, string>();
  for (const s of score.frame?.sections ?? []) {
    if (s.start >= 0 && s.start < bars && s.name) sectionStarts.set(s.start, s.name);
  }

  const swing = score.swing ?? 0.5;
  const feel = swing > 0.55 ? "Swing" : "Straight";
  return {
    scoreId: score.id,
    title: score.title,
    bars,
    bpb,
    keySpec: keySpec(key),
    spelling: spellingTable(key),
    staffs,
    chords,
    sectionStarts,
    tempo: Math.round(score.frame?.tempo ?? score.settings?.tempo ?? 120),
    feel,
    rows: Math.ceil(bars / BARS_PER_ROW),
    rowHeight,
    staffY,
    expandMs: performance.now() - t0,
  };
}
