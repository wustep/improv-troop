import type { BarPlan, Member, NoteEvent, Score } from "@/music/types";
import { DRUM } from "@/music/instruments";

// A tiny hand-written 4-bar blues fragment in F for exercising the engine.

const members: Member[] = [
  { id: "bear", animal: "bear", name: "Bruno", instrument: "piano" },
  { id: "frog", animal: "frog", name: "Lily", instrument: "bass" },
  { id: "owl", animal: "owl", name: "Hoot", instrument: "drums" },
  { id: "fox", animal: "fox", name: "Rusty", instrument: "trumpet" },
];

const chords = ["F7", "Bb7", "F7", "C7"];
const voicings: Record<string, number[]> = {
  F7: [57, 62, 63, 67],
  Bb7: [56, 60, 62, 67],
  C7: [58, 62, 64, 69],
};

const n = (pitch: number, start: number, dur: number, vel = 0.7, art?: NoteEvent["art"]): NoteEvent => ({
  pitch,
  start,
  dur,
  vel,
  ...(art ? { art } : {}),
});

function piano(): NoteEvent[] {
  const out: NoteEvent[] = [];
  chords.forEach((c, bar) => {
    const b = bar * 4;
    for (const p of voicings[c]) {
      out.push(n(p, b, 0.75, 0.55)); // Charleston: beat 1…
      out.push(n(p, b + 1.5, 0.5, 0.62, "accent")); // …and the "and" of 2
    }
  });
  return out;
}

function bass(): NoteEvent[] {
  const lines = [
    [41, 45, 48, 45],
    [46, 50, 53, 42],
    [41, 45, 48, 47],
    [48, 46, 45, 43],
  ];
  return lines.flatMap((line, bar) => line.map((p, i) => n(p, bar * 4 + i, 0.95, i === 0 ? 0.8 : 0.68)));
}

function drums(): NoteEvent[] {
  const out: NoteEvent[] = [n(DRUM.crash, 0, 1, 0.75)];
  for (let bar = 0; bar < 4; bar++) {
    const b = bar * 4;
    for (const t of [0, 1, 1.5, 2, 3, 3.5]) out.push(n(DRUM.ride, b + t, 0.5, t % 1 === 0 ? 0.7 : 0.5));
    out.push(n(DRUM.hatPedal, b + 1, 0.5, 0.6));
    out.push(n(DRUM.hatPedal, b + 3, 0.5, 0.6));
    for (let q = 0; q < 4; q++) out.push(n(DRUM.kick, b + q, 0.5, 0.22));
  }
  out.push(n(DRUM.snare, 6.5, 0.5, 0.3, "ghost"));
  out.push(n(DRUM.snare, 15.5, 0.5, 0.9, "accent"));
  out.push(n(DRUM.highTom, 14.5, 0.5, 0.6));
  out.push(n(DRUM.lowTom, 15, 0.5, 0.65));
  return out;
}

function trumpet(): NoteEvent[] {
  return [
    n(72, 0.5, 0.5, 0.7),
    n(74, 1, 0.5, 0.72),
    n(77, 1.5, 1, 0.8, "accent"),
    n(75, 2.5, 0.5, 0.68),
    n(74, 3, 1, 0.7),
    n(74, 4.5, 0.5, 0.66),
    n(72, 5, 0.5, 0.68),
    n(68, 5.5, 0.5, 0.7),
    n(65, 6, 1.5, 0.74),
    n(72, 8.5, 0.5, 0.7),
    n(74, 9, 0.5, 0.72),
    n(77, 9.5, 1, 0.82, "accent"),
    n(80, 10.5, 0.5, 0.75),
    n(79, 11, 1, 0.72),
    n(76, 12.5, 0.5, 0.7),
    n(74, 13, 0.5, 0.7),
    n(72, 13.5, 0.5, 0.72, "staccato"),
    n(70, 14, 2, 0.75),
  ];
}

const plan: BarPlan[] = chords.map((c, i) => ({
  index: i,
  section: "Head",
  chords: [{ beat: 0, symbol: c }],
  roles: { bear: "comp", frog: "bass", owl: "groove", fox: "lead" },
  texture: "groove",
  dynamic: "mf",
}));

export const AUDIO_FIXTURE: Score = {
  id: "audio-fixture",
  title: "Lab blues in F",
  createdAt: 0,
  settings: {
    mode: "composer",
    style: "swing",
    bars: 4,
    tempo: 132,
    key: { tonic: "F", mode: "major" },
    meter: { beats: 4 },
    standard: null,
    leaderId: "fox",
    soloists: [],
    bestOf: 1,
    seed: 1,
    directorModel: "",
    playerModel: "",
    phraseBars: 4,
  },
  members,
  frame: {
    bars: 4,
    meter: { beats: 4 },
    tempo: 132,
    key: { tonic: "F", mode: "major" },
    style: "swing",
    standard: null,
    sections: [{ name: "Head", kind: "head", start: 0, length: 4 }],
    chords: chords.map((c) => [{ beat: 0, symbol: c }]),
    leaderId: "fox",
    slots: chords.map(() => ({ fox: "lead" })),
  },
  plan,
  motif: {
    notes: [n(72, 0.5, 0.5), n(74, 1, 0.5), n(77, 1.5, 1)],
    length: 4,
    chord: "F7",
    text: "r/8 C5/8 D5/8 F5/4 r/4.",
  },
  swing: 0.62,
  parts: { bear: piano(), frog: bass(), owl: drums(), fox: trumpet() },
  chat: [],
  engine: "local",
  notes: ["hand-written audio lab fixture"],
};
