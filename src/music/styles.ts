import type { InstrumentFunction, SectionKind, StyleId } from "./types";

// Seven distinct characters. Distinctness comes from texture priors (what each
// function in the band actually does), not from the style's name. Prompts quote
// `texture`, never just the label.

export interface LinePrior {
  /** Average notes per beat for improvised lines. */
  density: number;
  /** Rhythm cells (compact durations, "r" prefix = rest) a line is assembled from. */
  cells: string[];
  /** 0..1 chance of chromatic approach / enclosure into target tones. */
  chromatic: number;
  /** 0..1 chance of a leap instead of a step. */
  leap: number;
  /** Typical phrase length in beats before a breath. */
  phrase: [number, number];
  /** Scale flavour for lines over dominant/minor chords. */
  flavor: "bebop" | "diatonic" | "pentatonic" | "blues" | "arpeggio" | "lydian";
  /** Prefer starting phrases off the beat. */
  offbeatStarts: number;
  /** Probability a note is shortened (staccato). */
  staccato: number;
}

export interface StyleDef {
  id: StyleId;
  name: string;
  blurb: string;
  /** Concrete description of each function's texture — what prompts quote. */
  texture: string;
  /** Swing ratio at 120 bpm (0.5 = straight); see swingAt for other tempos. */
  swing: number;
  tempo: { min: number; max: number; default: number };
  key: { tonic: string; mode: "major" | "minor" };
  /** Roman-numeral progressions per mode, one entry per bar ("ii7 V7" = two chords in a bar). */
  progressions: { major: string[][]; minor: string[][] };
  /** Default directive per function per section kind. */
  section: Record<SectionKind, Partial<Record<InstrumentFunction | "melodic-support", string>>>;
  line: LinePrior;
  /** Motif rhythm cells (compact durations; motif pitches are generated). */
  motifCells: string[];
  /** Motif contour templates (diatonic steps relative to the first note). */
  contours: number[][];
  /** Everyone keeps playing during solos (collective improvisation). */
  collective: boolean;
  /** Drum fill density 0..1 */
  fills: number;
  /** Comp voicing family. */
  voicing: "rootless" | "triad" | "open" | "quartal" | "shell";
  /** Feel label for the sheet. */
  feelLabel: string;
}

export const STYLES: Record<StyleId, StyleDef> = {
  swing: {
    id: "swing",
    name: "Swing",
    blurb: "Walking bass, ride cymbal, bebop lines",
    texture:
      "Swung 8ths. Bass walks quarter notes, chord tones on 1 and chromatic approach notes into each new chord. Drums: ride cymbal spang-a-lang (1, 2, &2, 3, 4, &4), hi-hat foot on 2 and 4, feathered kick, sparse snare comping. Piano/guitar/vibes comp short syncopated rootless voicings (Charleston: 1 and &2, anticipations into the next chord). Melody/solo lines are 8th-note bebop phrases that start off the beat, land on 3rds and 7ths on strong beats, use enclosures, and breathe between phrases.",
    swing: 0.66,
    tempo: { min: 90, max: 240, default: 160 },
    key: { tonic: "Bb", mode: "major" },
    progressions: {
      major: [
        ["Imaj7", "vi7", "ii7", "V7", "Imaj7", "VI7", "ii7", "V7"],
        ["ii7", "V7", "Imaj7", "Imaj7", "ii7", "V7", "iii7 VI7", "ii7 V7"],
        ["Imaj7", "IV7", "iii7", "VI7", "ii7", "V7", "Imaj7 vi7", "ii7 V7"],
      ],
      minor: [
        ["i7", "iv7", "ii7b5", "V7", "i7", "VI7", "ii7b5", "V7"],
        ["i7", "i7", "iv7", "iv7", "bVI7", "V7", "i7", "ii7b5 V7"],
      ],
    },
    section: {
      intro: { bass: "@two", chordal: "@comp sparse", rhythm: "@groove light", melodic: "@rest" },
      head: { bass: "@walk", chordal: "@comp", rhythm: "@groove", melodic: "@guide", "melodic-support": "@guide" },
      solo: { bass: "@walk", chordal: "@comp sparse", rhythm: "@groove", melodic: "@rest", "melodic-support": "@rest" },
      trade: { bass: "@walk", chordal: "@comp sparse", rhythm: "@groove", melodic: "@rest" },
      vamp: { bass: "@walk", chordal: "@comp", rhythm: "@groove", melodic: "@riff" },
      out: { bass: "@walk", chordal: "@comp", rhythm: "@groove peak", melodic: "@guide", "melodic-support": "@harmony" },
      // the tag: the turnaround again (and again), everyone in, before the last chord
      tag: { bass: "@walk", chordal: "@comp", rhythm: "@groove peak", melodic: "@riff", "melodic-support": "@riff" },
    },
    line: {
      density: 2,
      cells: ["8 8 8 8", "8 8 8 8 8 8 8 8", "r/8 8 8 8 4", "8t 8t 8t 8 8", "4 8 8", "8 8 4 r/4", "8. 16 8 8"],
      chromatic: 0.4,
      leap: 0.22,
      phrase: [5, 10],
      flavor: "bebop",
      offbeatStarts: 0.65,
      staccato: 0.2,
    },
    motifCells: ["r/8 8 8 8 4 4", "8 8 4 r/8 8 4", "4 8 8 4. 8", "r/4 8 8 8 8 4"],
    contours: [
      [0, 1, 2, 4, 3],
      [0, -1, 1, 3, 2],
      [0, 2, 4, 3, 1],
      [0, 3, 2, 1, -1],
    ],
    collective: false,
    fills: 0.5,
    voicing: "rootless",
    feelLabel: "Swing",
  },
  bossa: {
    id: "bossa",
    name: "Bossa Nova",
    blurb: "Straight 8ths, clave rim, syncopated chords",
    texture:
      "Straight 8ths, relaxed. Bass plays root on 1 and fifth on the 'and' of 2 (dotted-quarter + 8th), anticipating chord changes. Drums: cross-stick rim on the 2-bar bossa clave, closed hi-hat 8ths, soft kick on 1 and &2. Guitar/piano comp a 2-bar syncopated pattern of soft 4-note voicings with 9ths, chords pushed ahead of the beat. Melody is lyrical and conversational: quarter notes and tied syncopations, long notes at phrase ends, stepwise with occasional 6th leaps.",
    swing: 0.5,
    tempo: { min: 100, max: 150, default: 128 },
    key: { tonic: "C", mode: "minor" },
    progressions: {
      major: [
        ["Imaj7", "Imaj7", "II7", "II7", "ii7", "V7", "Imaj7", "V7"],
        ["Imaj7", "vi7", "ii7", "V7", "iii7", "VI7", "ii7", "V7"],
      ],
      minor: [
        ["i7", "i7", "iv7", "iv7", "ii7b5", "V7", "i7", "i7"],
        ["i7", "iv7", "bVII7", "bIIImaj7", "bVImaj7", "ii7b5", "V7", "i7"],
      ],
    },
    section: {
      intro: { bass: "@bossa", chordal: "@comp", rhythm: "@groove light", melodic: "@rest" },
      head: { bass: "@bossa", chordal: "@comp", rhythm: "@groove", melodic: "@pad", "melodic-support": "@pad" },
      solo: { bass: "@bossa", chordal: "@comp", rhythm: "@groove", melodic: "@rest" },
      trade: { bass: "@bossa", chordal: "@comp", rhythm: "@groove", melodic: "@rest" },
      vamp: { bass: "@bossa", chordal: "@comp", rhythm: "@groove", melodic: "@pad" },
      out: { bass: "@bossa", chordal: "@comp", rhythm: "@groove", melodic: "@harmony", "melodic-support": "@harmony" },
      tag: { bass: "@end", chordal: "@end", rhythm: "@end", melodic: "@end" },
    },
    line: {
      density: 1.1,
      cells: ["4 4 4 4", "4. 8 2", "8 4 8 4 4", "2 4 4", "r/8 8 4 4 4", "4 8 8 2"],
      chromatic: 0.1,
      leap: 0.3,
      phrase: [6, 12],
      flavor: "diatonic",
      offbeatStarts: 0.4,
      staccato: 0.05,
    },
    motifCells: ["4. 8 4 4", "8 4 8 4 4", "4 4 4. 8", "2 8 8 4"],
    contours: [
      [0, -1, -2, 2],
      [0, 1, 0, -2],
      [0, 2, 1, -1],
      [0, 5, 4, 2],
    ],
    collective: false,
    fills: 0.15,
    voicing: "open",
    feelLabel: "Bossa (straight 8ths)",
  },
  funk: {
    id: "funk",
    name: "Funk",
    blurb: "16th grooves, stabs, the one",
    texture:
      "Straight 16ths, tight. Bass: syncopated 16th riff that hits hard on beat 1, octave pops and ghosted dead notes, rests on the beat. Drums: 16th hi-hats, snare backbeat on 2 and 4 with ghost notes, syncopated kick. Keys/guitar: short choppy 16th stabs of dominant 9th chords on offbeats, lots of space. Horns: short punchy riffs and stabs, pentatonic/blues, repeated notes, call-and-response; solos are rhythmic and riff-based rather than long scales.",
    swing: 0.5,
    tempo: { min: 85, max: 120, default: 102 },
    key: { tonic: "E", mode: "minor" },
    progressions: {
      major: [
        ["I7", "I7", "IV7", "I7", "bVII7", "IV7", "I7", "V7"],
        ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7"],
      ],
      minor: [
        ["i7", "i7", "i7", "i7", "IV7", "IV7", "i7", "i7"],
        ["i7", "i7", "bVII7", "IV7", "i7", "i7", "bVI7", "V7"],
      ],
    },
    section: {
      intro: { bass: "@funk", chordal: "@rest", rhythm: "@groove", melodic: "@rest" },
      head: { bass: "@funk", chordal: "@comp", rhythm: "@groove", melodic: "@riff", "melodic-support": "@riff" },
      solo: { bass: "@funk", chordal: "@comp", rhythm: "@groove", melodic: "@rest" },
      trade: { bass: "@funk", chordal: "@comp", rhythm: "@groove", melodic: "@rest" },
      vamp: { bass: "@funk", chordal: "@comp", rhythm: "@groove", melodic: "@riff" },
      out: { bass: "@funk", chordal: "@comp", rhythm: "@groove peak", melodic: "@riff", "melodic-support": "@riff" },
      tag: { bass: "@end", chordal: "@end", rhythm: "@end", melodic: "@end" },
    },
    line: {
      density: 2.2,
      cells: ["16 16 r/8 16 16 r/8", "8 16 16 r/8 8", "r/16 16 16 16 8 8", "8 8 r/8 8", "16 16 16 16 r/4", "8. 16 r/4"],
      chromatic: 0.12,
      leap: 0.35,
      phrase: [2, 6],
      flavor: "pentatonic",
      offbeatStarts: 0.6,
      staccato: 0.55,
    },
    motifCells: ["16 16 r/8 16 16 8 r/4 4", "8 16 16 r/8 8 r/4 8 8", "r/16 16 16 16 8 8 r/2"],
    contours: [
      [0, 0, 2, 0, -1, 0],
      [0, 3, 2, 0, 0],
      [0, -1, 0, 3, 4],
    ],
    collective: false,
    fills: 0.35,
    voicing: "shell",
    feelLabel: "Funk (straight 16ths)",
  },
  pop: {
    id: "pop",
    name: "Pop",
    blurb: "Backbeat, pumping 8ths, a hook you can sing",
    texture:
      "Straight 8ths with a backbeat. Drums: closed hi-hat 8ths, kick on 1 and the and of 2 (and 3), snare cracks on 2 and 4, a crash at the top of sections. Bass: pumping root 8ths, an octave or the fifth to move, locked with the kick. Keys/guitar: block triads in the middle of the keyboard, pulsing 8ths or on the beats, simple and diatonic. Melody: a singable hook: short repeated rhythmic cells, mostly stepwise, pentatonic and diatonic, landing on chord tones, phrases that answer each other (call and response), no bebop chromaticism. Supporting horns or strings play a 3rd under the lead or a sustained pad, like backing vocals.",
    swing: 0.5,
    tempo: { min: 70, max: 140, default: 100 },
    key: { tonic: "C", mode: "major" },
    progressions: {
      major: [
        ["I", "V", "vi", "IV", "I", "V", "vi", "IV"],
        ["vi", "IV", "I", "V", "vi", "IV", "I", "V"],
        ["I", "vi", "IV", "V", "I", "vi", "IV", "V"],
        ["I", "IV", "vi", "V", "I", "IV", "V", "I"],
      ],
      minor: [
        ["i", "VI", "III", "VII", "i", "VI", "III", "VII"],
        ["i", "iv", "VI", "V", "i", "iv", "VI", "V"],
      ],
    },
    section: {
      intro: { bass: "@pump", chordal: "@pulse sparse", rhythm: "@groove light", melodic: "@rest" },
      head: { bass: "@pump", chordal: "@pulse", rhythm: "@groove", melodic: "@pad", "melodic-support": "@harmony" },
      solo: { bass: "@pump", chordal: "@pulse", rhythm: "@groove", melodic: "@rest", "melodic-support": "@rest" },
      trade: { bass: "@pump", chordal: "@pulse", rhythm: "@groove", melodic: "@rest" },
      vamp: { bass: "@pump", chordal: "@pulse", rhythm: "@groove", melodic: "@pad" },
      out: { bass: "@pump", chordal: "@pulse busy", rhythm: "@groove peak", melodic: "@pad", "melodic-support": "@harmony" },
      tag: { bass: "@end", chordal: "@end", rhythm: "@end", melodic: "@end" },
    },
    line: {
      density: 1.3,
      cells: ["8 8 4 4 4", "4 8 8 2", "r/8 8 8 8 4 4", "4. 8 4 4", "8 8 8 8 2", "r/4 8 8 4 4"],
      chromatic: 0.03,
      leap: 0.2,
      phrase: [4, 8],
      flavor: "pentatonic",
      offbeatStarts: 0.35,
      staccato: 0.06,
    },
    motifCells: ["8 8 4 8 8 4 r/4 4 2", "4 8 8 4 4 r/2 4 4", "r/8 8 8 8 4 4 2 r/2", "4. 8 4 4 2 r/2"],
    contours: [
      [0, 0, 1, 2, 1, 0],
      [2, 2, 1, 0, 1, 0],
      [0, 1, 2, 2, 1, -1],
      [0, 0, 0, 2, 1, 0],
    ],
    collective: false,
    fills: 0.3,
    voicing: "triad",
    feelLabel: "Pop (straight 8ths)",
  },
  neworleans: {
    id: "neworleans",
    name: "New Orleans",
    blurb: "Second-line strut, everybody at once",
    texture:
      "Loose two-beat strut with a light swing. Bass/tuba-style: root on 1 and fifth on 3, pickup on the 'and' of 4. Drums: second-line snare with rolls and accents on the 'and's, bass drum on 1 and &2. Piano plays stride/oom-pah: low root on 1 and 3, chord on 2 and 4. Collective improvisation: while the lead plays, the other horns weave counter-lines and riffs (clarinet noodles above, trombone smears below). Blue notes, syncopated repeated-note riffs, call-and-response.",
    swing: 0.6,
    tempo: { min: 90, max: 200, default: 132 },
    key: { tonic: "F", mode: "major" },
    progressions: {
      major: [
        ["I", "I", "I", "I", "I", "I", "V7", "V7"],
        ["I", "I7", "IV", "iv", "I", "V7", "I", "I"],
        ["I", "VI7", "II7", "V7", "I", "VI7", "II7 V7", "I"],
      ],
      minor: [
        ["i", "i", "iv", "iv", "i", "V7", "i", "V7"],
        ["i", "iv", "i", "V7", "i", "iv", "V7", "i"],
      ],
    },
    section: {
      intro: { bass: "@two", chordal: "@stride", rhythm: "@groove", melodic: "@riff" },
      head: { bass: "@two", chordal: "@stride", rhythm: "@groove", melodic: "@counter", "melodic-support": "@counter" },
      solo: { bass: "@two", chordal: "@stride", rhythm: "@groove", melodic: "@riff", "melodic-support": "@riff" },
      trade: { bass: "@two", chordal: "@stride", rhythm: "@groove", melodic: "@riff" },
      vamp: { bass: "@two", chordal: "@stride", rhythm: "@groove", melodic: "@riff" },
      out: { bass: "@two", chordal: "@stride", rhythm: "@groove peak", melodic: "@counter", "melodic-support": "@counter" },
      tag: { bass: "@two", chordal: "@stride", rhythm: "@groove peak", melodic: "@counter", "melodic-support": "@counter" },
    },
    line: {
      density: 1.6,
      cells: ["8 8 4 8 8", "4 8 8 4 4", "8 4 8 4", "4t 4t 4t 4", "r/8 8 8 8 4"],
      chromatic: 0.2,
      leap: 0.25,
      phrase: [4, 8],
      flavor: "blues",
      offbeatStarts: 0.5,
      staccato: 0.15,
    },
    motifCells: ["8 4 8 4 4", "4 8 8 4 r/4", "r/8 8 8 4 8 4"],
    contours: [
      [0, 2, 0, 2, 4],
      [0, 0, 1, 2, 0],
      [0, -2, 0, 2],
    ],
    collective: true,
    fills: 0.45,
    voicing: "triad",
    feelLabel: "Two-beat strut",
  },
  minimal: {
    id: "minimal",
    name: "Minimalist",
    blurb: "Interlocking ostinati, slow change",
    texture:
      "Straight, steady 8th-note pulse. Keys/vibes play repeating broken-chord ostinati (the same 1-bar cell repeated, changing one note at a time). Bass holds long pedal tones or a slow repeated octave pulse. Drums (if any) only a quiet even pulse — shaker/closed hat 8ths, no backbeat. Melodic players repeat the motif and change it additively (add or drop one note per repetition) or phase it against the pulse by an 8th. Harmony changes slowly; dynamics swell gradually over many bars rather than in sections.",
    swing: 0.5,
    tempo: { min: 100, max: 160, default: 132 },
    key: { tonic: "A", mode: "minor" },
    progressions: {
      major: [
        ["I", "I", "vi", "vi", "IV", "IV", "V", "V"],
        ["Imaj7", "Imaj7", "IVmaj7", "IVmaj7", "Imaj7", "Imaj7", "vi7", "vi7"],
      ],
      minor: [
        ["i", "i", "VI", "VI", "III", "III", "VII", "VII"],
        ["i", "VI", "III", "VII", "i", "VI", "iv", "V"],
      ],
    },
    section: {
      intro: { bass: "@pedal", chordal: "@arp", rhythm: "@groove light", melodic: "@rest" },
      head: { bass: "@pedal", chordal: "@arp", rhythm: "@groove", melodic: "@riff", "melodic-support": "@arp" },
      solo: { bass: "@pedal", chordal: "@arp", rhythm: "@groove", melodic: "@arp", "melodic-support": "@arp" },
      trade: { bass: "@pedal", chordal: "@arp", rhythm: "@groove", melodic: "@arp" },
      vamp: { bass: "@pedal", chordal: "@arp", rhythm: "@groove", melodic: "@arp" },
      out: { bass: "@pedal", chordal: "@arp", rhythm: "@groove peak", melodic: "@riff", "melodic-support": "@arp" },
      tag: { bass: "@end", chordal: "@end", rhythm: "@end", melodic: "@end" },
    },
    line: {
      density: 2,
      cells: ["8 8 8 8 8 8 8 8", "8 8 8 8 4 4", "4 8 8 4 8 8"],
      chromatic: 0,
      leap: 0.55,
      phrase: [8, 16],
      flavor: "arpeggio",
      offbeatStarts: 0,
      staccato: 0.1,
    },
    motifCells: ["8 8 8 8 8 8 8 8", "8 8 8 8 8 8 4", "4 8 8 8 8 4"],
    contours: [
      [0, 2, 4, 2, 0, 2, 4, 2],
      [0, 4, 2, 4, 0, 4, 2, 4],
      [0, 2, 4, 7, 4, 2],
    ],
    collective: true,
    fills: 0,
    voicing: "triad",
    feelLabel: "Straight 8ths, steady",
  },
  baroque: {
    id: "baroque",
    name: "Baroque",
    blurb: "Running counterpoint, sequences",
    texture:
      "Straight, motoric. Continuous running 16th or 8th notes in the lead, built by spinning the motif out in sequences (repeat it a step lower each half-bar). Bass walks in steady 8ths, mostly stepwise with octave leaps, outlining the harmony. Keys play broken-chord figuration (a bass note then arpeggio 16ths, like a prelude) or block continuo chords. Other melodic voices imitate the motif a few beats later (canon) or move in parallel 3rds/6ths. Drums, if present, play only timpani-like toms on strong beats. Cadences are clear: V–I with a held final note.",
    swing: 0.5,
    tempo: { min: 70, max: 130, default: 96 },
    key: { tonic: "D", mode: "minor" },
    progressions: {
      major: [
        ["I", "V", "vi", "iii", "IV", "I", "IV", "V7"],
        ["I", "IV", "V", "I", "vi", "ii", "V7", "I"],
      ],
      minor: [
        ["i", "iv", "VII", "III", "VI", "ii7b5", "V7", "i"],
        ["i", "V7", "i", "iv", "VII7", "III", "V7", "i"],
      ],
    },
    section: {
      intro: { bass: "@baroque", chordal: "@prelude", rhythm: "@rest", melodic: "@rest" },
      head: { bass: "@baroque", chordal: "@prelude", rhythm: "@groove light", melodic: "@canon", "melodic-support": "@harmony" },
      solo: { bass: "@baroque", chordal: "@continuo", rhythm: "@groove light", melodic: "@guide", "melodic-support": "@guide" },
      trade: { bass: "@baroque", chordal: "@continuo", rhythm: "@groove light", melodic: "@canon" },
      vamp: { bass: "@baroque", chordal: "@prelude", rhythm: "@groove light", melodic: "@guide" },
      out: { bass: "@baroque", chordal: "@prelude", rhythm: "@groove", melodic: "@canon", "melodic-support": "@harmony" },
      tag: { bass: "@end", chordal: "@end", rhythm: "@end", melodic: "@end" },
    },
    line: {
      density: 3.2,
      cells: ["16 16 16 16 16 16 16 16", "16 16 16 16 8 8", "8 8 16 16 16 16", "8 8 8 8"],
      chromatic: 0.05,
      leap: 0.3,
      phrase: [8, 16],
      flavor: "diatonic",
      offbeatStarts: 0.1,
      staccato: 0.1,
    },
    motifCells: ["16 16 16 16 8 8 4 4", "8 16 16 8 8 4 4", "16 16 8 16 16 8 2"],
    contours: [
      [0, 1, 2, 0, 4, 3, 2, 1],
      [0, -1, 0, 2, 4, 3, 1],
      [0, 2, 1, 3, 2, 4, 0],
    ],
    collective: true,
    fills: 0,
    voicing: "triad",
    feelLabel: "Allegro",
  },
  ambient: {
    id: "ambient",
    name: "Ambient",
    blurb: "Long tones, open space, swells",
    texture:
      "Slow, floating, mostly rubato-feeling over a soft pulse. Long sustained tones (half and whole notes) that overlap; harmony in open voicings with added 9ths and suspended 4ths. Bass holds low roots for whole bars or rests. Drums only cymbal swells, soft mallet toms, no groove. Keys/vibes play sparse high bell-like single notes and slow arpeggios with lots of space. Melody is a few long notes, leaps of 4ths and 5ths, echoing the motif slowly; players answer each other with one or two notes rather than runs.",
    swing: 0.5,
    tempo: { min: 56, max: 90, default: 72 },
    key: { tonic: "D", mode: "major" },
    progressions: {
      major: [
        ["Imaj7", "Imaj7", "IVmaj7", "IVmaj7", "vi7", "vi7", "IVmaj7", "Vsus"],
        ["Isus", "Isus", "bVIImaj7", "bVIImaj7", "IVmaj7", "IVmaj7", "Isus", "Isus"],
        ["vi9", "IVmaj7", "Imaj7", "Vsus", "vi9", "IVmaj7", "ii7", "Vsus"],
      ],
      minor: [
        ["i9", "i9", "bVImaj7", "bVImaj7", "iv9", "iv9", "bVIImaj7", "Vsus"],
        ["i9", "bIIImaj7", "bVImaj7", "bVIImaj7", "i9", "iv9", "bVImaj7", "Vsus"],
      ],
    },
    section: {
      intro: { bass: "@pedal", chordal: "@pad", rhythm: "@groove light", melodic: "@rest" },
      head: { bass: "@pedal", chordal: "@shimmer", rhythm: "@groove", melodic: "@pad", "melodic-support": "@pad" },
      solo: { bass: "@pedal", chordal: "@pad", rhythm: "@groove", melodic: "@rest", "melodic-support": "@pad" },
      trade: { bass: "@pedal", chordal: "@pad", rhythm: "@groove", melodic: "@pad" },
      vamp: { bass: "@pedal", chordal: "@shimmer", rhythm: "@groove", melodic: "@pad" },
      out: { bass: "@pedal", chordal: "@shimmer", rhythm: "@groove", melodic: "@pad", "melodic-support": "@pad" },
      tag: { bass: "@end", chordal: "@end", rhythm: "@end", melodic: "@end" },
    },
    line: {
      density: 0.45,
      cells: ["2 2", "1", "2. 4", "4 2.", "r/2 2", "r/4 4 2"],
      chromatic: 0,
      leap: 0.6,
      phrase: [6, 12],
      flavor: "lydian",
      offbeatStarts: 0.2,
      staccato: 0,
    },
    motifCells: ["2 4 4", "2. 4", "4 4 2", "2 2"],
    contours: [
      [0, 4, 3],
      [0, -3, 1],
      [0, 3, 2, 4],
    ],
    collective: true,
    fills: 0,
    voicing: "quartal",
    feelLabel: "Floating",
  },
};

export const STYLE_LIST: StyleId[] = ["swing", "bossa", "funk", "pop", "neworleans", "minimal", "baroque", "ambient"];

/**
 * What a cellist does in each style when someone else holds the bass chair: tenor
 * countermelodies, bowed pads, pizzicato double-stop comping, imitation. (With no bassist,
 * the cello takes the style's bass pattern instead — see planner.)
 */
export const CELLO_TEXTURE: Record<StyleId, Partial<Record<SectionKind, string>>> = {
  swing: { intro: "@rest", head: "@counter", solo: "@pizz sparse", trade: "@pizz sparse", vamp: "@pizz", out: "@harmony", tag: "@pizz busy" },
  bossa: { intro: "@pad", head: "@pad", solo: "@pizz", trade: "@pizz", vamp: "@pad", out: "@harmony", tag: "@end" },
  funk: { intro: "@rest", head: "@riff", solo: "@pizz busy", trade: "@pizz", vamp: "@riff", out: "@riff", tag: "@end" },
  pop: { intro: "@rest", head: "@pad", solo: "@pizz", trade: "@pizz", vamp: "@pad", out: "@harmony", tag: "@end" },
  neworleans: { intro: "@riff", head: "@counter", solo: "@riff", trade: "@riff", vamp: "@riff", out: "@counter", tag: "@counter" },
  minimal: { intro: "@arp", head: "@arp", solo: "@arp", trade: "@arp", vamp: "@arp", out: "@arp", tag: "@end" },
  baroque: { intro: "@rest", head: "@canon", solo: "@counter", trade: "@canon", vamp: "@counter", out: "@canon", tag: "@end" },
  ambient: { intro: "@pad", head: "@pad", solo: "@pad", trade: "@pad", vamp: "@pad", out: "@pad", tag: "@end" },
};

/**
 * The style's swing ratio at a tempo. Swing flattens as it speeds up: near a triplet at a
 * ballad, close to even 8ths at a burning tempo. `swing` in the style is its ratio at 120 bpm.
 */
export function swingAt(style: StyleDef, tempo: number): number {
  if (style.swing <= 0.5) return style.swing;
  const r = style.swing - (tempo - 120) * 0.0006;
  return Math.round(Math.min(0.68, Math.max(0.55, r)) * 1000) / 1000;
}
