import { parseNotes } from "./notation";
import { mod, pcOf } from "./theory";
import type { KeySig, NoteEvent, StyleId } from "./types";

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
  /**
   * The written melody, one entry per bar in compact notation, in the standard's key (public
   * domain tunes only). The leader plays it as written on the head and the head out.
   */
  melody?: string[];
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
      "Am7b5", "D7b9", "Gm7 C7", "Fm7 Bb7", "Ebmaj7", "Am7b5 D7b9", "Gm6", "Gm6",
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
    bars: ["F", "F", "F", "F", "F", "F", "C7", "C7", "F", "F7", "Bb", "Bbm", "F", "F C7", "F", "F"],
    form: [["A", 16]],
    style: "neworleans",
    tempo: 150,
    motif: "r/4 F4/4 A4/4 Bb4/4 | C5/1",
    // "Oh when the saints | go marching in | ..." (the pickups end the bar before)
    melody: [
      "C5/1",
      "r/4 F4/4 A4/4 Bb4/4",
      "C5/1",
      "r/4 F4/4 A4/4 Bb4/4",
      "C5/2 A4/2",
      "F4/2 A4/2",
      "G4/1",
      "r/4 A4/4 A4/4 G4/4",
      "F4/2. F4/4",
      "A4/4 C5/4 C5/4 Bb4/4",
      "Bb4/1",
      "r/4 F4/4 A4/4 Bb4/4",
      "C5/2 A4/2",
      "F4/2 G4/2",
      "F4/1",
      "r/4 F4/4 A4/4 Bb4/4",
    ],
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
    // harmonized to the melody: the verse, then the "Greensleeves was all my joy" chorus
    bars: ["Am", "C", "G", "Em", "Am", "Am", "E", "Am", "C", "G", "G", "Em", "Am", "E", "Am", "Am"],
    form: [["A", 8], ["B", 8]],
    style: "baroque",
    tempo: 104,
    motif: "C5/2 D5/4 | E5/4. F5/8 E5/4",
    melody: [
      "C5/2 D5/4",
      "E5/4. F5/8 E5/4",
      "D5/2 B4/4",
      "G4/4. A4/8 B4/4",
      "C5/2 A4/4",
      "A4/4. G#4/8 A4/4",
      "B4/2 G#4/4",
      "E4/2.",
      "G5/2.",
      "G5/4. F#5/8 E5/4",
      "D5/2 B4/4",
      "G4/4. A4/8 B4/4",
      "C5/4. B4/8 A4/4",
      "G#4/4. F#4/8 G#4/4",
      "A4/2.",
      "r/2 A4/4",
    ],
    note: "Traditional English tune in 3/4, public domain.",
  },
  {
    id: "ode-to-joy",
    name: "Ode to Joy",
    key: { tonic: "C", mode: "major" },
    meter: 4,
    bars: ["C", "G", "C", "C G", "C", "G", "C", "G C", "G", "G C", "G", "C G", "C", "G", "C", "G C"],
    form: [["A", 4], ["A", 4], ["B", 4], ["A", 4]],
    style: "baroque",
    tempo: 108,
    motif: "E5/4 E5/4 F5/4 G5/4 | G5/4 F5/4 E5/4 D5/4",
    melody: [
      "E5/4 E5/4 F5/4 G5/4",
      "G5/4 F5/4 E5/4 D5/4",
      "C5/4 C5/4 D5/4 E5/4",
      "E5/4. D5/8 D5/2",
      "E5/4 E5/4 F5/4 G5/4",
      "G5/4 F5/4 E5/4 D5/4",
      "C5/4 C5/4 D5/4 E5/4",
      "D5/4. C5/8 C5/2",
      "D5/4 D5/4 E5/4 C5/4",
      "D5/4 E5/8 F5/8 E5/4 C5/4",
      "D5/4 E5/8 F5/8 E5/4 D5/4",
      "C5/4 D5/4 G4/2",
      "E5/4 E5/4 F5/4 G5/4",
      "G5/4 F5/4 E5/4 D5/4",
      "C5/4 C5/4 D5/4 E5/4",
      "D5/4. C5/8 C5/2",
    ],
    note: "Beethoven's tune from the Ninth, public domain.",
  },
  {
    id: "jingle-bells",
    name: "Jingle Bells",
    key: { tonic: "C", mode: "major" },
    meter: 4,
    bars: ["C", "C", "C", "C", "F", "F C", "D9", "G7", "C", "C", "C", "C", "F", "F C", "G7", "C"],
    form: [["A", 8], ["A", 8]],
    style: "swing",
    tempo: 168,
    motif: "E5/4 E5/4 E5/2 | E5/4 E5/4 E5/2",
    melody: [
      "E5/4 E5/4 E5/2",
      "E5/4 E5/4 E5/2",
      "E5/4 G5/4 C5/4. D5/8",
      "E5/1",
      "F5/4 F5/4 F5/4. F5/8",
      "F5/4 E5/4 E5/4 E5/8 E5/8",
      "E5/4 D5/4 D5/4 E5/4",
      "D5/2 G5/2",
      "E5/4 E5/4 E5/2",
      "E5/4 E5/4 E5/2",
      "E5/4 G5/4 C5/4. D5/8",
      "E5/1",
      "F5/4 F5/4 F5/4. F5/8",
      "F5/4 E5/4 E5/4 E5/8 E5/8",
      "G5/4 G5/4 F5/4 D5/4",
      "C5/1",
    ],
    note: "James Lord Pierpont's sleigh song (1857), the chorus, public domain.",
  },
  {
    id: "twinkle",
    name: "Twinkle, Twinkle (Ah vous dirai-je)",
    key: { tonic: "C", mode: "major" },
    meter: 4,
    bars: ["C", "F C", "F C", "G C", "C G7", "C G", "C G7", "C G", "C", "F C", "F C", "G C"],
    form: [["A", 4], ["B", 4], ["A", 4]],
    style: "baroque",
    tempo: 100,
    motif: "C5/4 C5/4 G5/4 G5/4 | A5/4 A5/4 G5/2",
    melody: [
      "C5/4 C5/4 G5/4 G5/4",
      "A5/4 A5/4 G5/2",
      "F5/4 F5/4 E5/4 E5/4",
      "D5/4 D5/4 C5/2",
      "G5/4 G5/4 F5/4 F5/4",
      "E5/4 E5/4 D5/2",
      "G5/4 G5/4 F5/4 F5/4",
      "E5/4 E5/4 D5/2",
      "C5/4 C5/4 G5/4 G5/4",
      "A5/4 A5/4 G5/2",
      "F5/4 F5/4 E5/4 E5/4",
      "D5/4 D5/4 C5/2",
    ],
    note: "The French tune Mozart wrote his variations on, public domain.",
  },
  {
    id: "frere-jacques",
    name: "Frère Jacques",
    key: { tonic: "F", mode: "major" },
    meter: 4,
    // "ding, dang, dong": F C F under F C F
    bars: ["F", "F", "F", "F", "F", "F", "F C7 F F", "F C7 F F"],
    form: [["A", 8]],
    style: "baroque",
    tempo: 104,
    motif: "F4/4 G4/4 A4/4 F4/4 | F4/4 G4/4 A4/4 F4/4",
    melody: [
      "F4/4 G4/4 A4/4 F4/4",
      "F4/4 G4/4 A4/4 F4/4",
      "A4/4 Bb4/4 C5/2",
      "A4/4 Bb4/4 C5/2",
      "C5/8 D5/8 C5/8 Bb4/8 A4/4 F4/4",
      "C5/8 D5/8 C5/8 Bb4/8 A4/4 F4/4",
      "F4/4 C4/4 F4/2",
      "F4/4 C4/4 F4/2",
    ],
    note: "The round, public domain: the band's imitation turns it into a canon.",
  },
  {
    id: "amazing-grace",
    name: "Amazing Grace",
    key: { tonic: "G", mode: "major" },
    meter: 3,
    bars: ["G", "G7", "C", "G", "G", "Em D", "D", "D7", "G", "G7", "C", "G", "G", "Em D7", "G", "G"],
    form: [["A", 8], ["A", 8]],
    style: "neworleans",
    tempo: 76,
    motif: "G4/2 B4/8 G4/8 | B4/2 A4/4",
    melody: [
      "G4/2 B4/8 G4/8",
      "B4/2 A4/4",
      "G4/2 E4/4",
      "D4/2 D4/4",
      "G4/2 B4/8 G4/8",
      "B4/2 A4/4",
      "D5/2.",
      "D5/2 B4/4",
      "D5/2 B4/8 G4/8",
      "B4/2 A4/4",
      "G4/2 E4/4",
      "D4/2 D4/4",
      "G4/2 B4/8 G4/8",
      "B4/2 A4/4",
      "G4/2.",
      "G4/2 D4/4",
    ],
    note: "The hymn, played slow the New Orleans way, public domain.",
  },
  {
    id: "four-chords",
    name: "Four-Chord Song (I–V–vi–IV)",
    key: { tonic: "C", mode: "major" },
    meter: 4,
    bars: ["C", "G", "Am", "F", "C", "G", "Am", "F"],
    form: [["A", 8]],
    style: "pop",
    tempo: 104,
    note: "The progression under half the pop songs you know.",
  },
  {
    id: "doo-wop",
    name: "Doo-Wop Changes (I–vi–IV–V)",
    key: { tonic: "Bb", mode: "major" },
    meter: 4,
    bars: ["Bb", "Gm", "Eb", "F", "Bb", "Gm", "Eb", "F"],
    form: [["A", 8]],
    style: "pop",
    tempo: 92,
    note: "The 1950s ballad turnaround.",
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

/** Semitones from a standard's own key to the key it's played in (the nearer way round). */
export function standardShift(std: Standard, tonic: string): number {
  const semis = mod(pcOf(tonic) - pcOf(std.key.tonic), 12);
  return semis > 6 ? semis - 12 : semis;
}

const tuneOctave = new Map<string, number>();

/**
 * One bar of a standard's written melody (form bar `index`), in `tonic` and moved by whole
 * octaves so the tune as a whole sits around `center` and inside [lo, hi]. The octave is
 * decided once for the whole tune, so the melody never jumps register mid-phrase.
 */
export function tuneBar(std: Standard, index: number, tonic: string, beats: number, center: number, [lo, hi]: [number, number]): NoteEvent[] | null {
  const text = std.melody?.[mod(index, std.bars.length)];
  if (!text) return null;
  const semis = standardShift(std, tonic);
  const key = `${std.id}:${semis}:${center}:${lo}:${hi}`;
  let oct = tuneOctave.get(key);
  if (oct === undefined) {
    const all = (std.melody ?? []).flatMap((b) => parseNotes(b, beats).notes.map((n) => n.pitch + semis));
    const mean = all.reduce((sum, p) => sum + p, 0) / Math.max(1, all.length);
    oct = Math.round((center - mean) / 12) * 12;
    const min = Math.min(...all) + oct;
    const max = Math.max(...all) + oct;
    if (max > hi && min - 12 >= lo) oct -= 12;
    else if (min < lo && max + 12 <= hi) oct += 12;
    tuneOctave.set(key, oct);
  }
  return parseNotes(text, beats).notes.map((n) => ({ ...n, pitch: n.pitch + semis + oct }));
}
