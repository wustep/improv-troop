// Core contract for the troop. Everything (local engine, AI pipelines, audio,
// sheet music, animation rig) speaks in these types.
//
// Time is measured in beats (quarter notes) from the start of the chart.
// Bars are 0-indexed internally and 1-indexed anywhere a human or model sees them.

export type InstrumentId =
  | "piano"
  | "bass"
  | "drums"
  | "trumpet"
  | "sax"
  | "trombone"
  | "clarinet"
  | "flute"
  | "violin"
  | "cello"
  | "guitar"
  | "vibes";

export type AnimalId =
  | "bear"
  | "fox"
  | "bunny"
  | "frog"
  | "owl"
  | "cat"
  | "elephant"
  | "penguin";

export type StyleId =
  | "swing"
  | "bossa"
  | "funk"
  | "neworleans"
  | "minimal"
  | "baroque"
  | "ambient";

export type Mode = "improviser" | "composer";

/** What a player is doing in a bar. Locked slots (lead/solo) come from the frame. */
export type Role =
  | "lead" // states / restates the motif (the head)
  | "solo" // improvises on transforms of the motif
  | "comp" // chordal accompaniment
  | "bass" // bass line
  | "groove" // drums keeping time
  | "counter" // counter-line / guide tones / riff under the lead
  | "pad" // sustained harmony
  | "fill" // short fill at a phrase end
  | "trade" // trading short phrases (drums or horns)
  | "rest";

export type Dynamic = "pp" | "p" | "mp" | "mf" | "f" | "ff";

/** Instrument family decides default role and which patterns apply. */
export type InstrumentFunction = "rhythm" | "bass" | "chordal" | "melodic";

export interface Member {
  id: string;
  animal: AnimalId;
  name: string;
  instrument: InstrumentId;
}

export interface NoteEvent {
  /** MIDI pitch. For drums, General MIDI percussion numbers (36 kick, 38 snare, 42 hat, 51 ride...). */
  pitch: number;
  /** Absolute start in beats (straight grid; swing is applied at playback). */
  start: number;
  /** Duration in beats. */
  dur: number;
  /** Velocity 0..1 */
  vel: number;
  art?: "accent" | "staccato" | "ghost" | "legato";
}

export interface ChordChange {
  /** Beat offset within the bar (0 = downbeat). */
  beat: number;
  /** Chord symbol, e.g. "Cm7", "F7b9", "Bbmaj7", "G7/B". */
  symbol: string;
}

export type SectionKind = "intro" | "head" | "solo" | "trade" | "vamp" | "out" | "tag";

export interface Section {
  name: string; // "Head", "Solo · Fox", "Out chorus"
  kind: SectionKind;
  start: number; // bar index
  length: number; // bars
  /** For solo/trade sections: who is featured. */
  featured?: string[];
}

export type Texture =
  | "sparse"
  | "groove"
  | "build"
  | "peak"
  | "breakdown"
  | "tutti"
  | "stoptime"
  | "ostinato";

export interface BarPlan {
  index: number;
  section: string;
  chords: ChordChange[];
  roles: Record<string, Role>;
  texture: Texture;
  dynamic: Dynamic;
  /** Short human note shown in the debug view, e.g. "Fox answers the motif a 3rd up". */
  cue?: string;
}

/** A short melodic cell everybody refers back to. Stored as concrete notes relative to beat 0. */
export interface Motif {
  notes: NoteEvent[]; // start relative to motif start
  /** Length in beats (may include trailing rest). */
  length: number;
  /** Chord the motif was written over (for re-harmonising transforms). */
  chord: string;
  /** Compact text form, as the model or generator wrote it. */
  text: string;
  description?: string;
}

export type MotifTransform =
  | "state"
  | "transpose"
  | "sequence"
  | "invert"
  | "retrograde"
  | "augment"
  | "diminish"
  | "fragment"
  | "displace"
  | "ornament"
  | "rhythm";

export interface ChatMessage {
  id: string;
  from: string; // member id, or "director" / "critic" / "system"
  to?: string; // member id or "band"
  text: string;
  /** Bar where this was "said" during playback (speech bubble timing). */
  bar?: number;
  phase: "setup" | "count-off" | "jam" | "review";
}

export interface CriticScore {
  candidate: number;
  score: number; // 0..10
  distinctiveness: number;
  coherence: number;
  notes: string;
}

export interface KeySig {
  tonic: string; // "C", "Bb", "F#"
  mode: "major" | "minor";
}

export interface Meter {
  beats: number; // beats per bar (4 or 3)
}

export interface TroopSettings {
  mode: Mode;
  style: StyleId;
  bars: number; // locked length
  tempo: number;
  key: KeySig;
  meter: Meter;
  standard: string | null; // id from standards.ts
  leaderId: string;
  soloists: string[]; // member ids in solo order
  bestOf: number; // composer critic candidates (1 = off)
  seed: number;
  directorModel: string;
  playerModel: string;
  phraseBars: number; // improviser: bars per conversational round
}

/** The locked, code-built skeleton: length, form, harmony, and lead/solo slots. */
export interface Frame {
  bars: number;
  meter: Meter;
  tempo: number;
  key: KeySig;
  style: StyleId;
  standard: string | null;
  sections: Section[];
  chords: ChordChange[][]; // per bar
  leaderId: string;
  /** Locked role per bar per member for lead/solo/trade slots; others decided by planner. */
  slots: Record<string, Role>[];
}

/** One generated, playable chart. */
export interface Score {
  id: string;
  title: string;
  createdAt: number;
  settings: TroopSettings;
  members: Member[];
  frame: Frame;
  plan: BarPlan[];
  motif: Motif;
  swing: number; // 0.5 straight .. 0.68 hard swing (fraction of the beat given to the first 8th)
  parts: Record<string, NoteEvent[]>;
  chat: ChatMessage[];
  engine: "local" | "ai";
  critic?: { scores: CriticScore[]; chosen: number; summary: string };
  /** Free-form generation notes visible in debug. */
  notes: string[];
}

// ─── Animation contract ──────────────────────────────────────────────────────

export interface ActiveNote {
  pitch: number;
  vel: number;
  /** Seconds since onset. */
  age: number;
  /** 0..1 progress through the note's duration. */
  progress: number;
  /** Duration in seconds. */
  durSec: number;
}

export interface OnsetInfo {
  pitch: number;
  vel: number;
  /** Seconds since onset. */
  age: number;
}

/** Computed every animation frame for each member and handed to their sprite. */
export interface MemberFrameState {
  playing: boolean; // transport running
  beat: number; // absolute beat (float), negative during count-in
  beatPhase: number; // 0..1 inside current beat
  bpm: number;
  beatsPerBar: number;
  /** Notes sounding right now. */
  active: ActiveNote[];
  /** Most recent onsets, newest first (up to ~6), including ones that have ended. */
  recent: OnsetInfo[];
  /** Seconds until the next onset for this member (Infinity if none). Lets the rig anticipate (lift a stick, take a breath). */
  nextOnsetIn: number;
  nextPitch: number | null;
  role: Role;
  /** 0..1 loudness of the current bar. */
  energy: number;
  /** True during this member's solo/lead slot. */
  featured: boolean;
}
