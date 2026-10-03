// Real(ish) instrument mechanics so the animation matches the pitches played.

/** Bb trumpet valve combination for a SOUNDING pitch. [v1, v2, v3] pressed. */
export function trumpetValves(sounding: number): [boolean, boolean, boolean] {
  const written = sounding + 2;
  const table: Record<number, string> = {
    54: "123", 55: "13", 56: "23", 57: "12", 58: "1", 59: "2",
    60: "", 61: "123", 62: "13", 63: "23", 64: "12", 65: "1", 66: "2",
    67: "", 68: "23", 69: "12", 70: "1", 71: "2",
    72: "", 73: "12", 74: "1", 75: "2", 76: "", 77: "1", 78: "2",
    79: "", 80: "23", 81: "12", 82: "1", 83: "2", 84: "",
    85: "12", 86: "1", 87: "2", 88: "",
  };
  let combo = table[written];
  if (combo === undefined) {
    // Harmonic-series fallback: lowest valve combination from the nearest open partial above.
    const partials = [48, 60, 67, 72, 76, 79, 82, 84, 86, 88, 91];
    const combos = ["", "2", "1", "12", "23", "13", "123"];
    combo = "";
    for (const p of partials) {
      const d = p - written;
      if (d >= 0 && d <= 6) {
        combo = combos[d];
        break;
      }
    }
  }
  return [combo.includes("1"), combo.includes("2"), combo.includes("3")];
}

/** Tenor trombone slide position 1..7 for a sounding pitch. */
export function tromboneSlide(p: number): number {
  const partials = [34, 46, 53, 58, 62, 65, 68, 70, 72, 74, 77];
  let best = 1;
  let bestPos = 99;
  for (const part of partials) {
    const pos = part - p + 1;
    if (pos >= 1 && pos <= 7 && pos < bestPos) {
      bestPos = pos;
      best = pos;
    }
  }
  return bestPos === 99 ? 1 : best;
}

/**
 * Woodwind "closed holes" by WRITTEN pitch class (sax/flute style fingering).
 * Returns [L1, L2, L3, R1, R2, R3] closed flags plus pinky + octave/register.
 */
export interface WoodwindFingering {
  holes: [boolean, boolean, boolean, boolean, boolean, boolean];
  pinky: boolean;
  octave: boolean;
}

const SAX_PC: Record<number, string> = {
  // pc of written pitch → closed holes
  0: "010000", // C (middle finger alone)
  1: "000000", // C# open
  2: "111111", // D
  3: "111111p", // Eb (+ pinky)
  4: "111110", // E
  5: "111100", // F
  6: "111010", // F# (forked)
  7: "111000", // G
  8: "111000p", // G# (+ pinky)
  9: "110000", // A
  10: "100100", // Bb (side/bis approximated)
  11: "100000", // B
};

export function woodwind(written: number, octaveFrom = 74): WoodwindFingering {
  const pc = ((written % 12) + 12) % 12;
  const s = SAX_PC[pc];
  const h = [...s.slice(0, 6)].map((c) => c === "1") as WoodwindFingering["holes"];
  // Below the low D, low notes close everything + pinky.
  const low = written < 62;
  return {
    holes: low ? [true, true, true, true, true, true] : h,
    pinky: s.includes("p") || low,
    octave: written >= octaveFrom,
  };
}

/** Clarinet: overblows a twelfth. Written pitch, Bb clarinet. */
export function clarinet(written: number): WoodwindFingering {
  const register = written >= 71; // clarion
  const base = register ? written - 19 : written; // chalumeau equivalent
  // Chalumeau: E3 (52) all closed → Bb4 (70) almost open; more closed = lower.
  const span = Math.max(0, Math.min(1, (base - 52) / 18));
  const closed = Math.round(6 * (1 - span));
  const holes = [0, 1, 2, 3, 4, 5].map((i) => i < closed) as WoodwindFingering["holes"];
  return { holes, pinky: base < 55, octave: register };
}

export interface StringPos {
  string: number; // 0 = lowest
  semis: number; // semitones above open string
}

/** Choose a string: highest open string at or below the pitch. */
export function stringFor(p: number, open: number[]): StringPos {
  let s = 0;
  for (let i = 0; i < open.length; i++) if (open[i] <= p) s = i;
  return { string: s, semis: Math.max(0, p - open[s]) };
}

/** Fraction of the way from nut to bridge for a stopped note (equal temperament). */
export const stopFrac = (semis: number) => 1 - Math.pow(2, -semis / 12);

export const OPEN = {
  violin: [55, 62, 69, 76],
  cello: [36, 43, 50, 57],
  bass: [28, 33, 38, 43],
  guitar: [40, 45, 50, 55, 59, 64],
};

/** Keyboard x-position in white-key units for any MIDI pitch (C-based). */
const KEYPOS = [0, 0.55, 1, 1.6, 2, 3, 3.5, 4, 4.55, 5, 5.6, 6];
export function keyUnits(p: number): number {
  const oct = Math.floor(p / 12);
  return oct * 7 + KEYPOS[((p % 12) + 12) % 12];
}
export const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
