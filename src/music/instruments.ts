import type { AnimalId, InstrumentFunction, InstrumentId, Member } from "./types";

export interface InstrumentDef {
  id: InstrumentId;
  name: string;
  fn: InstrumentFunction;
  /** Sounding range (MIDI). */
  range: [number, number];
  /** Comfortable range for lines. */
  sweet: [number, number];
  clef: "treble" | "bass" | "grand" | "percussion";
  /** Semitones added when notating (guitar/bass/tenor sax are written an octave above sounding). */
  notationShift: number;
  /** Can play chords. */
  poly: boolean;
  /** Sustains (wind/bowed) vs decays (struck/plucked). */
  sustain: boolean;
  /** Breath limit in beats for wind players (phrases get rests). */
  breath?: number;
  /** Can take the bass chair when the band has no bassist (cello). */
  bassCapable?: boolean;
  /** Bowed string: plays arco by default and pizzicato when asked. */
  bowed?: boolean;
  /** Where solos and melodies live, when that differs from the comfortable accompaniment range. */
  solo?: [number, number];
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  piano: { id: "piano", name: "Piano", fn: "chordal", range: [21, 108], sweet: [48, 84], clef: "grand", notationShift: 0, poly: true, sustain: false },
  bass: { id: "bass", name: "Upright Bass", fn: "bass", range: [28, 67], sweet: [31, 55], solo: [36, 62], clef: "bass", notationShift: 12, poly: false, sustain: false },
  drums: { id: "drums", name: "Drums", fn: "rhythm", range: [35, 81], sweet: [35, 81], clef: "percussion", notationShift: 0, poly: true, sustain: false },
  trumpet: { id: "trumpet", name: "Trumpet", fn: "melodic", range: [54, 84], sweet: [58, 79], clef: "treble", notationShift: 0, poly: false, sustain: true, breath: 8 },
  sax: { id: "sax", name: "Tenor Sax", fn: "melodic", range: [44, 75], sweet: [48, 72], clef: "treble", notationShift: 12, poly: false, sustain: true, breath: 8 },
  trombone: { id: "trombone", name: "Trombone", fn: "melodic", range: [40, 72], sweet: [43, 67], solo: [48, 70], clef: "bass", notationShift: 0, poly: false, sustain: true, breath: 8 },
  clarinet: { id: "clarinet", name: "Clarinet", fn: "melodic", range: [50, 91], sweet: [55, 84], clef: "treble", notationShift: 0, poly: false, sustain: true, breath: 8 },
  flute: { id: "flute", name: "Flute", fn: "melodic", range: [60, 96], sweet: [64, 91], clef: "treble", notationShift: 0, poly: false, sustain: true, breath: 7 },
  violin: { id: "violin", name: "Violin", fn: "melodic", range: [55, 100], sweet: [60, 91], clef: "treble", notationShift: 0, poly: false, sustain: true, bowed: true },
  // Cello: a tenor voice first (countermelodies, pads, pizz comping, solos up into tenor clef),
  // and the bass chair only when nobody else holds it.
  cello: { id: "cello", name: "Cello", fn: "melodic", range: [36, 81], sweet: [43, 72], clef: "bass", notationShift: 0, poly: true, sustain: true, bassCapable: true, bowed: true, solo: [50, 77] },
  guitar: { id: "guitar", name: "Guitar", fn: "chordal", range: [40, 84], sweet: [48, 76], clef: "treble", notationShift: 12, poly: true, sustain: false },
  vibes: { id: "vibes", name: "Vibraphone", fn: "chordal", range: [53, 89], sweet: [60, 84], clef: "treble", notationShift: 0, poly: true, sustain: false },
};

export const INSTRUMENT_LIST: InstrumentId[] = [
  "piano",
  "bass",
  "drums",
  "trumpet",
  "sax",
  "trombone",
  "clarinet",
  "flute",
  "violin",
  "cello",
  "guitar",
  "vibes",
];

export interface AnimalDef {
  id: AnimalId;
  name: string; // default stage name
  species: string;
  /** Main crayon color and the lighter fill. */
  ink: string;
  fill: string;
  /** Instrument they reach for by default. */
  defaultInstrument: InstrumentId;
  /** Personality used for improviser-mode prompts. */
  persona: string;
}

export const ANIMALS: Record<AnimalId, AnimalDef> = {
  bear: { id: "bear", name: "Bruno", species: "bear", ink: "#6b3f22", fill: "#c98d5a", defaultInstrument: "piano", persona: "warm, patient, thinks in voicings; likes to set the table for others" },
  frog: { id: "frog", name: "Lily", species: "frog", ink: "#2f6b2a", fill: "#8cc56a", defaultInstrument: "bass", persona: "steady, dry humour, locks to the drummer, rarely shows off" },
  owl: { id: "owl", name: "Hoot", species: "owl", ink: "#3d3486", fill: "#7d71c9", defaultInstrument: "drums", persona: "watchful timekeeper, cues the band with fills, loves a good hit" },
  fox: { id: "fox", name: "Rusty", species: "fox", ink: "#b0461b", fill: "#f0954f", defaultInstrument: "trumpet", persona: "bold, bright ideas, plays the motif loud and proud" },
  cat: { id: "cat", name: "Mochi", species: "cat", ink: "#4a5568", fill: "#a9b4c2", defaultInstrument: "sax", persona: "cool, bluesy, leaves space, answers phrases sideways" },
  bunny: { id: "bunny", name: "Clover", species: "rabbit", ink: "#b0546f", fill: "#f4c4cf", defaultInstrument: "violin", persona: "lyrical, quick, sings long lines, loves a sequence" },
  elephant: { id: "elephant", name: "Tuck", species: "elephant", ink: "#4f6b7d", fill: "#a8c3d2", defaultInstrument: "trombone", persona: "big-hearted, plays riffs and pads, a good listener" },
  penguin: { id: "penguin", name: "Pip", species: "penguin", ink: "#22303c", fill: "#54697a", defaultInstrument: "vibes", persona: "precise, sparkly, plays shimmering patterns, a bit nerdy" },
  sheep: { id: "sheep", name: "Olive", species: "sheep", ink: "#5a4636", fill: "#d9c7a3", defaultInstrument: "cello", persona: "gentle and lyrical, lives in the tenor register; sings long bowed lines and sneaky countermelodies, and plucks a warm pizzicato when the groove needs it" },
};

export const ANIMAL_LIST: AnimalId[] = ["bear", "frog", "owl", "fox", "cat", "bunny", "elephant", "penguin", "sheep"];

export function defaultMembers(): Member[] {
  return (["bear", "frog", "owl", "fox"] as AnimalId[]).map((a) => ({
    id: a,
    animal: a,
    name: ANIMALS[a].name,
    instrument: ANIMALS[a].defaultInstrument,
  }));
}

export function fnOf(m: Member): InstrumentFunction {
  return INSTRUMENTS[m.instrument].fn;
}

// General MIDI percussion numbers we use.
export const DRUM = {
  kick: 36,
  stick: 37,
  snare: 38,
  clap: 39,
  floorTom: 43,
  hatClosed: 42,
  hatPedal: 44,
  lowTom: 45,
  hatOpen: 46,
  midTom: 47,
  highTom: 50,
  crash: 49,
  ride: 51,
  rideBell: 53,
  tambourine: 54,
  cowbell: 56,
  shaker: 70,
  congaHi: 63,
  congaLo: 64,
} as const;

export type DrumPiece = "kick" | "snare" | "hat" | "ride" | "crash" | "tom" | "aux";

export function drumPiece(pitch: number): DrumPiece {
  switch (pitch) {
    case DRUM.kick:
      return "kick";
    case DRUM.snare:
    case DRUM.stick:
    case DRUM.clap:
      return "snare";
    case DRUM.hatClosed:
    case DRUM.hatPedal:
    case DRUM.hatOpen:
      return "hat";
    case DRUM.ride:
    case DRUM.rideBell:
      return "ride";
    case DRUM.crash:
      return "crash";
    case DRUM.floorTom:
    case DRUM.lowTom:
    case DRUM.midTom:
    case DRUM.highTom:
      return "tom";
    default:
      return "aux";
  }
}
