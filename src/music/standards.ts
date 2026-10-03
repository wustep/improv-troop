import type { KeySig, StyleId } from "./types";

// Chord changes only (progressions aren't copyrightable); melodies are included
// only for public-domain tunes. Everything else gets a motif from the band.

export interface Standard {
  id: string;
  name: string;
  key: KeySig;
  meter: number;
  /** One entry per bar; several chords in a bar are space-separated and split the bar evenly. */
  bars: string[];
  /** Section letters per bar group, e.g. [["A", 8], ["A", 8], ["B", 8], ["A", 8]]. */
  form: [string, number][];
  style: StyleId;
  tempo: number;
  /** Public-domain head motif in compact notation (bars separated by |), if any. */
  motif?: string;
  note: string;
}

export const STANDARDS: Standard[] = [
  {
    id: "f-blues",
    name: "Jazz Blues in F",
    key: { tonic: "F", mode: "major" },
    meter: 4,
    bars: ["F7", "Bb7", "F7", "Cm7 F7", "Bb7", "Bdim7", "F7", "D7", "Gm7", "C7", "F7 D7", "Gm7 C7"],
    form: [["Blues", 12]],
    style: "swing",
    tempo: 150,
    note: "12-bar jazz blues — the session tune.",
  },
  {
    id: "minor-blues",
    name: "Minor Blues in C",
    key: { tonic: "C", mode: "minor" },
    meter: 4,
    bars: ["Cm7", "Cm7", "Cm7", "Cm7", "Fm7", "Fm7", "Cm7", "Cm7", "Ab7", "G7", "Cm7", "G7"],
    form: [["Blues", 12]],
    style: "swing",
    tempo: 140,
    note: "Dark 12-bar minor blues.",
  },
  {
    id: "rhythm-changes",
    name: "Rhythm Changes",
    key: { tonic: "Bb", mode: "major" },
    meter: 4,
    bars: [
      "Bbmaj7 G7", "Cm7 F7", "Dm7 G7", "Cm7 F7", "Fm7 Bb7", "Ebmaj7 Ebm7", "Dm7 G7", "Cm7 F7",
      "Bbmaj7 G7", "Cm7 F7", "Dm7 G7", "Cm7 F7", "Fm7 Bb7", "Ebmaj7 Ebm7", "Cm7 F7", "Bb6",
      "D7", "D7", "G7", "G7", "C7", "C7", "F7", "F7",
      "Bbmaj7 G7", "Cm7 F7", "Dm7 G7", "Cm7 F7", "Fm7 Bb7", "Ebmaj7 Ebm7", "Cm7 F7", "Bb6",
    ],
    form: [["A", 8], ["A", 8], ["B", 8], ["A", 8]],
    style: "swing",
    tempo: 200,
    note: "AABA, I Got Rhythm changes.",
  },
  {
    id: "autumn",
    name: "Autumn Leaves (changes)",
    key: { tonic: "G", mode: "minor" },
    meter: 4,
    bars: [
      "Cm7", "F7", "Bbmaj7", "Ebmaj7", "Am7b5", "D7", "Gm6", "Gm6",
      "Cm7", "F7", "Bbmaj7", "Ebmaj7", "Am7b5", "D7", "Gm6", "Gm6",
      "Am7b5", "D7b9", "Gm6", "Gm6", "Cm7", "F7", "Bbmaj7", "Ebmaj7",
      "Am7b5", "D7b9", "Gm7 C7", "Fm7 Bb7", "Am7b5", "D7b9", "Gm6", "Gm6",
    ],
    form: [["A", 8], ["A", 8], ["B", 8], ["C", 8]],
    style: "swing",
    tempo: 132,
    note: "Circle-of-fourths ii–V–I in major and minor.",
  },
  {
    id: "blue-bossa",
    name: "Blue Bossa (changes)",
    key: { tonic: "C", mode: "minor" },
    meter: 4,
    bars: ["Cm7", "Cm7", "Fm7", "Fm7", "Dm7b5", "G7", "Cm7", "Cm7", "Ebm7", "Ab7", "Dbmaj7", "Dbmaj7", "Dm7b5", "G7", "Cm7", "Dm7b5 G7"],
    form: [["A", 8], ["B", 8]],
    style: "bossa",
    tempo: 130,
    note: "16 bars, minor with a lift to Db.",
  },
  {
    id: "so-what",
    name: "Modal (So What changes)",
    key: { tonic: "D", mode: "minor" },
    meter: 4,
    bars: [
      ...Array(16).fill("Dm7"),
      ...Array(8).fill("Ebm7"),
      ...Array(8).fill("Dm7"),
    ],
    form: [["A", 8], ["A", 8], ["B", 8], ["A", 8]],
    style: "swing",
    tempo: 136,
    note: "AABA, D dorian then up a half step.",
  },
  {
    id: "giant-steps",
    name: "Giant Steps (changes)",
    key: { tonic: "B", mode: "major" },
    meter: 4,
    bars: [
      "Bmaj7 D7", "Gmaj7 Bb7", "Ebmaj7", "Am7 D7", "Gmaj7 Bb7", "Ebmaj7 F#7", "Bmaj7", "Fm7 Bb7",
      "Ebmaj7", "Am7 D7", "Gmaj7", "C#m7 F#7", "Bmaj7", "Fm7 Bb7", "Ebmaj7", "C#m7 F#7",
    ],
    form: [["A", 16]],
    style: "swing",
    tempo: 180,
    note: "Coltrane changes: three tonal centers a major 3rd apart.",
  },
  {
    id: "saints",
    name: "When the Saints Go Marching In",
    key: { tonic: "F", mode: "major" },
    meter: 4,
    bars: ["F", "F", "F", "F", "F", "F", "C7", "C7", "F", "F7", "Bb", "Bbm", "F", "C7", "F", "F"],
    form: [["A", 16]],
    style: "neworleans",
    tempo: 150,
    motif: "r/4 F4/4 A4/4 Bb4/4 | C5/1",
    note: "Public-domain parade tune.",
  },
  {
    id: "canon",
    name: "Canon in D (progression)",
    key: { tonic: "D", mode: "major" },
    meter: 4,
    bars: ["D A", "Bm F#m", "G D", "G A", "D A", "Bm F#m", "G D", "G A"],
    form: [["Ground", 8]],
    style: "baroque",
    tempo: 84,
    motif: "F#5/4 E5/4 D5/4 C#5/4 | B4/4 A4/4 B4/4 C#5/4",
    note: "Pachelbel's ground bass, public domain.",
  },
  {
    id: "greensleeves",
    name: "Greensleeves",
    key: { tonic: "A", mode: "minor" },
    meter: 3,
    bars: ["Am", "G", "Am", "E", "Am", "G", "Am E", "Am", "C", "G", "Am", "E", "C", "G", "Am E", "Am"],
    form: [["A", 8], ["B", 8]],
    style: "baroque",
    tempo: 104,
    motif: "C5/2 D5/4 | E5/4. F5/8 E5/4",
    note: "Traditional English tune in 3/4, public domain.",
  },
  {
    id: "dorian-vamp",
    name: "Two-Chord Dorian Vamp",
    key: { tonic: "Bb", mode: "minor" },
    meter: 4,
    bars: ["Bbm7", "Eb7", "Bbm7", "Eb7", "Bbm7", "Eb7", "Bbm7", "Eb7"],
    form: [["Vamp", 8]],
    style: "funk",
    tempo: 100,
    note: "i7–IV7 vamp for grooving.",
  },
];

export function getStandard(id: string | null): Standard | null {
  if (!id) return null;
  return STANDARDS.find((s) => s.id === id) ?? null;
}
