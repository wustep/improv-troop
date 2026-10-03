// Hand-made scores for the sheet lab. Not used by the app.

import type { BarPlan, ChordChange, Member, NoteEvent, Role, Score, Section } from "../music/types";
import { DRUM } from "../music/instruments";
import { parseChord, chordPcs, nearestPc } from "../music/theory";

const BB_CHANGES_4: string[][] = [
  ["Bbmaj7"],
  ["Gm7"],
  ["Cm7"],
  ["F7"],
  ["Dm7", "G7b9"],
  ["Cm7", "F7"],
  ["Bbmaj7"],
  ["Am7b5", "D7"],
  ["Gm7"],
  ["C7"],
  ["Cm7"],
  ["F7sus"],
  ["Ebmaj7"],
  ["Eb m6"],
  ["Bbmaj7/D", "Db dim7"],
  ["Cm7", "F7"],
];

const WALTZ_CHANGES: string[][] = [
  ["Dm7"],
  ["G7"],
  ["Cmaj7"],
  ["A7"],
  ["Dm7"],
  ["G7"],
  ["Em7"],
  ["A7b9"],
  ["Dm7"],
  ["G7"],
  ["Cmaj7"],
  ["Fmaj7"],
  ["Bm7b5"],
  ["E7"],
  ["Am7"],
  ["A7"],
];

function chordsFor(rows: string[][], bpb: number): ChordChange[][] {
  return rows.map((cs) => cs.map((symbol, i) => ({ symbol: symbol.replace(" ", ""), beat: i === 0 ? 0 : Math.floor(bpb / 2) })));
}

function fourMembers(): Member[] {
  return [
    { id: "fox", animal: "fox", name: "Rusty", instrument: "trumpet" },
    { id: "bear", animal: "bear", name: "Bruno", instrument: "piano" },
    { id: "frog", animal: "frog", name: "Lily", instrument: "bass" },
    { id: "owl", animal: "owl", name: "Hoot", instrument: "drums" },
  ];
}

function baseScore(id: string, title: string, members: Member[], bars: number, bpb: number, chords: ChordChange[][], tonic: string, mode: "major" | "minor", swing: number, tempo: number): Score {
  const sections: Section[] = [
    { name: "Head", kind: "head", start: 0, length: Math.min(8, bars) },
    ...(bars > 8 ? [{ name: "Solo · Rusty", kind: "solo" as const, start: 8, length: Math.min(4, bars - 8), featured: ["fox"] }] : []),
    ...(bars > 12 ? [{ name: "Out", kind: "out" as const, start: 12, length: bars - 12 }] : []),
  ];
  const plan: BarPlan[] = chords.slice(0, bars).map((c, index) => ({
    index,
    section: sections.find((s) => index >= s.start && index < s.start + s.length)?.name ?? "",
    chords: c,
    roles: Object.fromEntries(members.map((m) => [m.id, "comp" as Role])),
    texture: "groove",
    dynamic: "mf",
  }));
  return {
    id,
    title,
    createdAt: 0,
    settings: {
      mode: "composer",
      style: "swing",
      bars,
      tempo,
      key: { tonic, mode },
      meter: { beats: bpb },
      standard: null,
      leaderId: members[0]?.id ?? "",
      soloists: [],
      bestOf: 1,
      seed: 1,
      directorModel: "",
      playerModel: "",
      phraseBars: 4,
    },
    members,
    frame: {
      bars,
      meter: { beats: bpb },
      tempo,
      key: { tonic, mode },
      style: "swing",
      standard: null,
      sections,
      chords: chords.slice(0, bars),
      leaderId: members[0]?.id ?? "",
      slots: chords.slice(0, bars).map(() => ({})),
    },
    plan,
    motif: { notes: [], length: 4, chord: chords[0]?.[0]?.symbol ?? "C", text: "" },
    swing,
    parts: Object.fromEntries(members.map((m) => [m.id, [] as NoteEvent[]])),
    chat: [],
    engine: "local",
    notes: [],
  };
}

function chordAt(chords: ChordChange[][], bar: number, beat: number) {
  const cs = chords[bar] ?? [{ beat: 0, symbol: "C" }];
  let cur = cs[0];
  for (const c of cs) if (c.beat <= beat) cur = c;
  return parseChord(cur.symbol);
}

function fillParts(score: Score) {
  const bpb = score.frame.meter.beats;
  const bars = score.frame.bars;
  const chords = score.frame.chords;
  for (const m of score.members) {
    const out: NoteEvent[] = [];
    if (m.instrument === "bass") {
      let last = 43;
      for (let b = 0; b < bars; b++) {
        for (let k = 0; k < bpb; k++) {
          const ch = chordAt(chords, b, k);
          const pcs = chordPcs(ch);
          const target = k === 0 ? ch.root : pcs[(k * 2) % pcs.length];
          let p = nearestPc(target, last + (k % 2 ? 2 : -1));
          if (p < 31) p += 12;
          if (p > 55) p -= 12;
          out.push({ pitch: p, start: b * bpb + k, dur: 1, vel: 0.8 });
          last = p;
        }
      }
    } else if (m.instrument === "piano") {
      for (let b = 0; b < bars; b++) {
        const cs = chords[b] ?? [];
        for (const c of cs) {
          const ch = parseChord(c.symbol);
          const pcs = chordPcs(ch);
          const voicing = pcs.slice(1).map((pc) => nearestPc(pc, 62)).sort((a, z) => a - z);
          const t = b * bpb + c.beat + (b % 2 === 1 ? 1.5 : 0);
          const len = b % 4 === 3 ? 0.5 : bpb === 3 ? 1 : 1.5;
          out.push(...voicing.map((p) => ({ pitch: p, start: t, dur: len, vel: 0.6 })));
          out.push({ pitch: nearestPc(ch.root, 45), start: b * bpb + c.beat, dur: bpb === 3 ? 3 : 2, vel: 0.6 });
        }
      }
    } else if (m.instrument === "drums") {
      for (let b = 0; b < bars; b++) {
        const base = b * bpb;
        if (bpb === 4) {
          for (const t of [0, 1, 1 + 2 / 3, 2, 3, 3 + 2 / 3]) out.push({ pitch: DRUM.ride, start: base + t, dur: t % 1 ? 1 / 3 : 2 / 3, vel: 0.6 });
          out.push({ pitch: DRUM.hatPedal, start: base + 1, dur: 1, vel: 0.5 }, { pitch: DRUM.hatPedal, start: base + 3, dur: 1, vel: 0.5 });
          out.push({ pitch: DRUM.kick, start: base, dur: 1, vel: 0.5 });
          if (b % 4 === 3) {
            out.push({ pitch: DRUM.snare, start: base + 2.5, dur: 0.5, vel: 0.8, art: "accent" }, { pitch: DRUM.highTom, start: base + 3, dur: 0.5, vel: 0.8 }, { pitch: DRUM.floorTom, start: base + 3.5, dur: 0.5, vel: 0.8 });
          }
          if (b % 4 === 0) out.push({ pitch: DRUM.crash, start: base, dur: 1, vel: 0.9 });
        } else {
          for (let k = 0; k < 3; k++) out.push({ pitch: DRUM.ride, start: base + k, dur: 1, vel: 0.6 });
          out.push({ pitch: DRUM.kick, start: base, dur: 1, vel: 0.5 }, { pitch: DRUM.hatPedal, start: base + 1, dur: 1, vel: 0.4 }, { pitch: DRUM.hatPedal, start: base + 2, dur: 1, vel: 0.4 });
        }
      }
    } else {
      // Melody: motif + triplets + a note tied over the bar line + rests.
      const phrase: [number, number, number][] = bpb === 4
        ? [
            [74, 0, 0.5], [72, 0.5, 0.5], [70, 1, 1], [65, 2, 1.5], [67, 3.5, 2.5], // tie into next bar
            [69, 6, 2 / 3], [70, 6 + 2 / 3, 2 / 3], [72, 6 + 4 / 3, 2 / 3], [74, 8, 0.25], [75, 8.25, 0.25], [77, 8.5, 1.5], [82, 10, 2],
            [79, 13, 0.75], [77, 13.75, 0.25], [75, 14, 1], [74, 15, 1],
          ]
        : [
            [74, 0, 1], [76, 1, 2], [77, 3, 1], [79, 4, 2], [81, 6, 1 / 3], [79, 6 + 1 / 3, 1 / 3], [77, 6 + 2 / 3, 1 / 3], [76, 7, 2], [74, 9, 3],
          ];
      const len = bpb * 4;
      for (let rep = 0; rep * len < bars * bpb; rep++) {
        if (rep === 2) continue; // let the band breathe
        for (const [p, s, d] of phrase) {
          const start = rep * len + s;
          if (start < bars * bpb) out.push({ pitch: p - (rep === 3 ? 2 : 0), start, dur: d, vel: 0.8 });
        }
      }
    }
    score.parts[m.id] = out;
  }
  return score;
}

export function fixtureSwing(): Score {
  return fillParts(baseScore("fixture-swing", "Doodle Blues for Hoot", fourMembers(), 16, 4, chordsFor(BB_CHANGES_4, 4), "Bb", "major", 0.64, 152));
}

export function fixtureWaltz(): Score {
  return fillParts(baseScore("fixture-waltz", "Penguin Waltz", fourMembers(), 16, 3, chordsFor(WALTZ_CHANGES, 3), "C", "major", 0.5, 132));
}

export function fixtureSix(): Score {
  const members: Member[] = [
    ...fourMembers(),
    { id: "cat", animal: "cat", name: "Mochi", instrument: "sax" },
    { id: "bunny", animal: "bunny", name: "Clover", instrument: "violin" },
  ];
  const s = baseScore("fixture-six", "Six of Us", members, 32, 4, chordsFor([...BB_CHANGES_4, ...BB_CHANGES_4], 4), "G", "minor", 0.6, 168);
  fillParts(s);
  s.parts.cat = s.parts.fox.map((n) => ({ ...n, pitch: n.pitch - 9, start: n.start + 0.5 }));
  s.parts.bunny = s.parts.fox.map((n) => ({ ...n, pitch: n.pitch + 5, dur: n.dur * 2 }));
  return s;
}

export function fixtureDrumsOnly(): Score {
  const s = baseScore("fixture-drums", "Hoot Alone", [{ id: "owl", animal: "owl", name: "Hoot", instrument: "drums" }], 8, 4, chordsFor(BB_CHANGES_4, 4), "F", "major", 0.5, 110);
  return fillParts(s);
}

export function fixtureEmpty(): Score {
  return baseScore("fixture-empty", "Tacet", fourMembers(), 8, 4, chordsFor(BB_CHANGES_4, 4), "E", "major", 0.5, 120);
}
