import {
  DrumMachine,
  ElectricPiano,
  Mallet,
  Sampler,
  Soundfont,
  SplendidGrandPiano,
  type Scheduler,
  type Smplr,
  type SmplrPreset,
} from "smplr";
import type { InstrumentId } from "@/music/types";
import { DRUM } from "@/music/instruments";
import { CountingStorage } from "./storage";

// One open sampled instrument per animal. Each instrument has a fallback chain; the first
// pack that actually delivers samples wins. Packs are swappable without touching the engine.

export type PianoPack = "salamander" | "splendid" | "soundfont" | "wurlitzer" | "cp80";
export type DrumKit = "acoustic" | "lm2";
export type Room = "dry" | "club" | "hall";

/** How the band sounds in this browser: the piano and drum samples, the room, the count-in. */
export interface Sounds {
  piano: PianoPack;
  drums: DrumKit;
  room: Room;
  /** A bar of clicks before a take from the top. */
  countIn: boolean;
}

export const DEFAULT_SOUNDS: Sounds = { piano: "salamander", drums: "acoustic", room: "club", countIn: true };

export const PIANO_PACKS: PianoPack[] = ["salamander", "splendid", "soundfont", "wurlitzer", "cp80"];
export const DRUM_KITS: DrumKit[] = ["acoustic", "lm2"];
export const ROOMS: Room[] = ["dry", "club", "hall"];

/** Each instrument's reverb send (REVERB_SEND) is scaled by the room. */
export const ROOM_SEND: Record<Room, number> = { dry: 0.3, club: 1, hall: 2.2 };

/** A saved or shared value read back as a sound we have (anything else is the default). */
export function readSounds(raw: unknown, legacyPiano?: unknown): Sounds {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Sounds, unknown>>;
  const piano = o.piano ?? legacyPiano;
  return {
    piano: PIANO_PACKS.includes(piano as PianoPack) ? (piano as PianoPack) : DEFAULT_SOUNDS.piano,
    drums: DRUM_KITS.includes(o.drums as DrumKit) ? (o.drums as DrumKit) : DEFAULT_SOUNDS.drums,
    room: ROOMS.includes(o.room as Room) ? (o.room as Room) : DEFAULT_SOUNDS.room,
    countIn: typeof o.countIn === "boolean" ? o.countIn : DEFAULT_SOUNDS.countIn,
  };
}

export interface PackContext {
  ctx: AudioContext;
  destination: AudioNode;
  scheduler: Scheduler;
  storage: CountingStorage;
  volume: number;
  pan: number;
  onProgress: (loaded: number, total: number) => void;
  /** Notes we expect to play (only some packs use it). */
  notes?: number[];
}

export interface PackSpec {
  pack: string;
  create(p: PackContext): Smplr;
  /** Rebuild/extend sample set for new notes without a new instance (Salamander). */
  extend?: (inst: Smplr, notes: number[], failedUrls: Set<string>) => Promise<void>;
}

// ─── Salamander Grand Piano (Tone.js hosted, CC-BY 3.0, Alexander Holm) ──────

export const SALAMANDER_BASE = "https://tonejs.github.io/audio/salamander";

interface SalSample {
  name: string;
  midi: number;
}

export const SALAMANDER_SAMPLES: SalSample[] = (() => {
  const out: SalSample[] = [{ name: "A0", midi: 21 }];
  for (let oct = 1; oct <= 7; oct++) {
    const c = 12 * (oct + 1);
    out.push({ name: `C${oct}`, midi: c });
    out.push({ name: `Ds${oct}`, midi: c + 3 });
    out.push({ name: `Fs${oct}`, midi: c + 6 });
    out.push({ name: `A${oct}`, midi: c + 9 });
  }
  out.push({ name: "C8", midi: 108 });
  return out;
})();

function nearestSalamander(note: number): SalSample {
  let best = SALAMANDER_SAMPLES[0];
  for (const s of SALAMANDER_SAMPLES) {
    if (Math.abs(s.midi - note) < Math.abs(best.midi - note)) best = s;
  }
  return best;
}

/** Samples needed to cover `notes` (nearest root per note). All samples when notes is empty/undefined. */
export function salamanderSubset(notes?: number[]): SalSample[] {
  if (!notes || notes.length === 0) return SALAMANDER_SAMPLES;
  const picked = new Map<string, SalSample>();
  for (const n of notes) {
    if (!Number.isFinite(n)) continue;
    const s = nearestSalamander(Math.round(n));
    picked.set(s.name, s);
  }
  // Always keep a low, middle and high anchor so stray notes don't pitch-shift absurdly.
  for (const anchor of [36, 60, 84]) {
    const s = nearestSalamander(anchor);
    picked.set(s.name, s);
  }
  return [...picked.values()].sort((a, b) => a.midi - b.midi);
}

/** Spread key ranges so every MIDI key maps to its nearest loaded sample. */
export function salamanderPreset(samples: SalSample[]): SmplrPreset {
  const sorted = [...samples].sort((a, b) => a.midi - b.midi);
  const regions = sorted.map((s, i) => {
    const lo = i === 0 ? 0 : Math.floor((sorted[i - 1].midi + s.midi) / 2) + 1;
    const hi = i === sorted.length - 1 ? 127 : Math.floor((s.midi + sorted[i + 1].midi) / 2);
    return { sample: s.name, keyRange: [lo, hi] as [number, number], pitch: s.midi };
  });
  return {
    meta: {
      name: "Salamander Grand Piano",
      license: "CC-BY 3.0",
      source: "https://tonejs.github.io/audio/salamander/",
    },
    samples: { baseUrl: SALAMANDER_BASE, formats: ["ogg", "mp3"] },
    defaults: { ampRelease: 0.7 },
    groups: [{ regions }],
  };
}

const salamanderLoaded = new WeakMap<Smplr, Set<string>>();

const salamander: PackSpec = {
  pack: "salamander",
  create(p) {
    const subset = salamanderSubset(p.notes);
    const inst = Sampler(p.ctx, {
      preset: salamanderPreset(subset),
      destination: p.destination,
      scheduler: p.scheduler,
      storage: p.storage,
      volume: p.volume,
      pan: p.pan,
      onLoadProgress: ({ loaded, total }) => p.onProgress(loaded, total),
    });
    salamanderLoaded.set(inst, new Set(subset.map((s) => s.name)));
    return inst;
  },
  async extend(inst, notes, failedUrls) {
    const have = salamanderLoaded.get(inst) ?? new Set<string>();
    const want = salamanderSubset(notes);
    const missing = want.filter((s) => !have.has(s.name));
    const failed = (s: SalSample) => [...failedUrls].some((u) => u.includes(`/${s.name}.`));
    const union = SALAMANDER_SAMPLES.filter((s) => (have.has(s.name) || want.includes(s)) && !failed(s));
    const anyFailedLoaded = [...have].some((n) => failed({ name: n, midi: 0 }));
    if (missing.length === 0 && !anyFailedLoaded) return;
    const sampler = inst as Smplr & { reload?: (p: SmplrPreset) => Promise<void> };
    if (typeof sampler.reload !== "function" || union.length === 0) return;
    await sampler.reload(salamanderPreset(union));
    salamanderLoaded.set(inst, new Set(union.map((s) => s.name)));
  },
};

const splendid: PackSpec = {
  pack: "splendid",
  create(p) {
    return SplendidGrandPiano(p.ctx, {
      destination: p.destination,
      scheduler: p.scheduler,
      storage: p.storage,
      volume: p.volume,
      pan: p.pan,
      decayTime: 0.6,
      // One velocity layer (MP) and only the roots we need keeps the download sane;
      // other notes/velocities fall back to the nearest loaded sample.
      notesToLoad: {
        velocityRange: [70, 84],
        ...(p.notes && p.notes.length ? { notes: p.notes } : {}),
        fallback: "nearest",
      },
      onLoadProgress: ({ loaded, total }) => p.onProgress(loaded, total),
    } as Parameters<typeof SplendidGrandPiano>[1]);
  },
};

function soundfont(name: string, kit: "MusyngKite" | "FluidR3_GM"): PackSpec {
  return {
    pack: `${kit === "MusyngKite" ? "musyngkite" : "fluidr3"}:${name}`,
    create(p) {
      return Soundfont(p.ctx, {
        instrument: name,
        kit,
        destination: p.destination,
        scheduler: p.scheduler,
        storage: p.storage,
        volume: p.volume,
        pan: p.pan,
        onLoadProgress: ({ loaded, total }) => p.onProgress(loaded, total),
      });
    },
  };
}

// D. Smolken's 1958 Rubner double bass (royalty-free). The full pizz set is ~180 files; we
// build our own preset from the mezzo layer with two round-robins (~20 files, ~1.6 MB).
export const SMOLKEN_BASE = "https://smpldsnds.github.io/sfzinstruments-dsmolken-double-bass";
const SMOLKEN_ROOTS: Array<[string, number]> = [
  ["c1", 24],
  ["eb1", 27],
  ["g1", 31],
  ["d2", 38],
  ["f2", 41],
  ["a2", 45],
  ["c3", 48],
  ["e3", 52],
  ["g3", 55],
  ["a3", 57],
];

export function smolkenPreset(): SmplrPreset {
  const regions: SmplrPreset["groups"][number]["regions"] = [];
  SMOLKEN_ROOTS.forEach(([name, midi], i) => {
    const lo = i === 0 ? 0 : Math.floor((SMOLKEN_ROOTS[i - 1][1] + midi) / 2) + 1;
    const hi = i === SMOLKEN_ROOTS.length - 1 ? 127 : Math.floor((midi + SMOLKEN_ROOTS[i + 1][1]) / 2);
    ["a", "b"].forEach((rr, k) => {
      regions.push({ sample: `pizz/pizz_${name}_m${rr}`, keyRange: [lo, hi], pitch: midi, seqPosition: k + 1 });
    });
  });
  return {
    meta: { name: "Smolken double bass (pizz, mezzo)", license: "royalty-free", source: SMOLKEN_BASE },
    samples: { baseUrl: SMOLKEN_BASE, formats: ["ogg", "m4a"] },
    defaults: { ampRelease: 0.3 },
    groups: [{ seqLength: 2, regions }],
  };
}

const smolkenPizz: PackSpec = {
  pack: "smolken:pizzicato",
  create(p) {
    return Sampler(p.ctx, {
      preset: smolkenPreset(),
      destination: p.destination,
      scheduler: p.scheduler,
      storage: p.storage,
      volume: p.volume,
      pan: p.pan,
      onLoadProgress: ({ loaded, total }) => p.onProgress(loaded, total),
    });
  },
};

const lm2: PackSpec = {
  pack: "lm-2",
  create(p) {
    return DrumMachine(p.ctx, {
      instrument: "LM-2",
      destination: p.destination,
      scheduler: p.scheduler,
      storage: p.storage,
      volume: p.volume,
      pan: p.pan,
      onLoadProgress: ({ loaded, total }) => p.onProgress(loaded, total),
    } as Parameters<typeof DrumMachine>[1]);
  },
};

const vibes: PackSpec = {
  pack: "vcsl:vibraphone-soft",
  create(p) {
    return Mallet(p.ctx, {
      instrument: "Vibraphone - Soft Mallets",
      destination: p.destination,
      scheduler: p.scheduler,
      storage: p.storage,
      volume: p.volume,
      pan: p.pan,
      onLoadProgress: ({ loaded, total }) => p.onProgress(loaded, total),
    } as Parameters<typeof Mallet>[1]);
  },
};

// ─── Electric pianos (Greg Sullivan, CC-BY 3.0) ──────────────────────────────

// Their samples are normalized, ~15 dB hotter than Salamander's (measured at C4, mezzo): this
// is the piano's level-matched volume brought down by that much.
export const EPIANO_VOLUME = 45;

function epiano(name: "WurlitzerEP200" | "CP80", pack: string): PackSpec {
  return {
    pack,
    create(p) {
      return ElectricPiano(p.ctx, {
        instrument: name,
        destination: p.destination,
        storage: p.storage,
        volume: EPIANO_VOLUME,
        pan: p.pan,
        onLoadProgress: ({ loaded, total }) => p.onProgress(loaded, total),
      });
    },
  };
}

// ─── Acoustic kit (Versilian Community Sample Library, CC0) ─────────────────
// Built from VCSL's kick, snare, toms, hi-hat and two suspended cymbals played with a stick
// (one rides, one crashes): velocity layers, two round-robins where VCSL has them, and the
// open hat choked by the closed and pedal hat. Keyed by General MIDI drum note, like the parts.

export const VCSL_BASE = "https://smpldsnds.github.io/sgossner-vcsl";
const IDIO = "Idiophones/Struck Idiophones";
const MEMB = "Membranophones/Struck Membranophones";

type KitLayer = { file: string; vel?: [number, number]; rr?: number; trim: number };
interface KitPiece {
  keys: number[];
  /** The note the samples sound at (toms are retuned from it); defaults to each key. */
  pitch?: number;
  layers: KitLayer[];
  group?: number;
  offBy?: number;
  release?: number;
}

/**
 * Velocity layers splitting 1..127, from soft to hard, each with `rr` round-robins. `peaks` is
 * each layer's measured peak (dBFS): VCSL records its layers at their natural level (a snare's
 * softest tap peaks 27 dB under its hardest), and smplr scales by velocity on top of that, so
 * each layer is trimmed onto a gentle curve, -13 dB for the softest up to -1 dB for the hardest
 * (a single-layer piece sits at -3, like the LinnDrum the drum parts were balanced on).
 */
function layers(peaks: number[], file: (layer: number, rr: number) => string, rr = 2): KitLayer[] {
  const n = peaks.length;
  const out: KitLayer[] = [];
  peaks.forEach((peak, i) => {
    const vel: [number, number] = [i === 0 ? 1 : Math.round((127 * i) / n) + 1, Math.round((127 * (i + 1)) / n)];
    const target = n === 1 ? -3 : -13 + (12 * i) / (n - 1);
    const trim = Math.round(Math.min(24, target - peak) * 10) / 10;
    for (let k = 1; k <= rr; k++) out.push({ file: file(i, k), vel: n > 1 ? vel : undefined, rr: rr > 1 ? k : undefined, trim });
  });
  return out;
}

const HAT = `${IDIO}/Hi-Hat Cymbal`;
const RIDE = `${IDIO}/Suspended Cymbal 2/susCymb2_hit`;
const CRASH = `${IDIO}/Suspended Cymbal 1/susCymb1_hit`;
const HIGH_TOM = (i: number, k: number) => `${MEMB}/Tom 1/Stick/TomH_HitS_v${i + 2}_rr${k}_Mid`;
const LOW_TOM = (i: number, k: number) => `${MEMB}/Tom 2/Stick/TomL_HitS_v${i + 2}_rr${k}_Mid`;

// peaks measured in the browser from the decoded samples (round-robins sit within 2 dB)
export const ACOUSTIC_KIT: KitPiece[] = [
  { keys: [35, 36], pitch: 36, layers: layers([-22.3, -16.9, -9.8, -4.6], (i, k) => `${MEMB}/Bass Drum 1/BDrumNew_hit_v${[2, 3, 5, 7][i]}_rr${k}_Sum`) },
  { keys: [38, 40], pitch: 38, layers: layers([-29.6, -21.8, -7, -2.8], (i, k) => `${MEMB}/Snare Drum, Modern 1/Snare2_HitSN_v${[3, 5, 7, 9][i]}_rr${k}_Mid`) },
  { keys: [37], layers: layers([-21.2], (_, k) => `${MEMB}/Snare Drum, Modern 2/Snare3M_Xstick_v2_rr${k}_Mid`) },
  { keys: [39], layers: layers([-0.5], (_, k) => `${IDIO}/Claps/Clap_rr${k}`) },
  { keys: [42], group: 1, layers: layers([-36.3, -24.1, -13.7, -8.3], (i, k) => `${HAT}/HiHat_HitC_v${i + 1}_rr${k}_Mid`) },
  { keys: [44], group: 1, layers: layers([-21.7], (_, k) => `${HAT}/HiHat_Close_rr${k}_Mid`) },
  { keys: [46], offBy: 1, release: 0.08, layers: layers([-10.4], (_, k) => `${HAT}/HiHat_HitO_rr${k}_Mid`) },
  { keys: [51, 59], pitch: 51, release: 1.2, layers: layers([-32.5, -18.8, -18.1], (i) => `${RIDE}_stick_${["pp1", "mp1", "mf1"][i]}`, 1) },
  { keys: [53], release: 1.2, layers: layers([-16.9, -12.5], (i) => `${RIDE}_bell_${["p1", "f1"][i]}`, 1) },
  { keys: [49, 57], pitch: 49, release: 1.5, layers: layers([-34.1, -25.3, -15.5], (i) => `${CRASH}_stick_${["pp1", "mp1", "f1"][i]}`, 1) },
  // the rack toms are VCSL's high tom, the floor toms its low one, each retuned a little
  { keys: [48, 50], pitch: 50, layers: layers([-26.3, -16, -9.6], HIGH_TOM) },
  { keys: [47], pitch: 49, layers: layers([-26.3, -16, -9.6], HIGH_TOM) },
  { keys: [41, 43, 45], pitch: 45, layers: layers([-24.6, -13.8, -8.6], LOW_TOM) },
  { keys: [54], layers: layers([-28.2, -17.3], (i) => `${IDIO}/Tambourine 1/Tamb1_Hit_v${i + 1}_rr1_Mid`, 1) },
  { keys: [56], layers: layers([-24.6, -18.3], (i) => `${IDIO}/Cowbells/Cowbell1_Hit_v${i + 2}_rr1_Mid`, 1) },
  { keys: [69, 70], pitch: 70, layers: layers([-29], (_, k) => `${IDIO}/Shaker, Small/Mid_Shaker_Slap_rr${k}`) },
  { keys: [62], layers: layers([-26.8], (_, k) => `${MEMB}/Conga/Conga_HitFM_v1_rr${k}_Sum`) },
  { keys: [63], layers: layers([-34.3, -20.8, -16.3], (i) => `${MEMB}/Conga/Conga_HitN_v${i + 1}_rr1_Sum`, 1) },
  { keys: [64], layers: layers([-58, -30.2, -24.8], (i) => `${MEMB}/Conga/Tumba_HitN_v${i + 1}_rr1_Sum`, 1) },
];

export function acousticKitPreset(): SmplrPreset {
  const groups: SmplrPreset["groups"] = [];
  for (const piece of ACOUSTIC_KIT) {
    const seq = piece.layers.some((l) => l.rr !== undefined);
    for (const key of piece.keys) {
      groups.push({
        seqLength: seq ? 2 : undefined,
        group: piece.group,
        offBy: piece.offBy,
        ampRelease: piece.release,
        regions: piece.layers.map((l) => ({
          sample: encodeURI(l.file),
          keyRange: [key, key] as [number, number],
          pitch: piece.pitch ?? key,
          velRange: l.vel,
          seqPosition: seq ? l.rr : undefined,
          volume: l.trim,
        })),
      });
    }
  }
  return {
    meta: { name: "VCSL acoustic kit", license: "CC0 1.0", source: "https://github.com/sgossner/VCSL" },
    samples: { baseUrl: VCSL_BASE, formats: ["ogg", "m4a"] },
    defaults: { ampRelease: 0.4 },
    groups,
  };
}

const acousticKit: PackSpec = {
  pack: "vcsl:acoustic-kit",
  create(p) {
    return Sampler(p.ctx, {
      preset: acousticKitPreset(),
      destination: p.destination,
      scheduler: p.scheduler,
      storage: p.storage,
      volume: p.volume,
      pan: p.pan,
      onLoadProgress: ({ loaded, total }) => p.onProgress(loaded, total),
    });
  },
};

/** Level-matched volume for the pizzicato voice (that pack runs ~3 dB quieter than arco). */
export const PIZZ_VOLUME = 121;

/** Plucked voice for bowed strings (cello/violin pizzicato). */
export function pizzChain(): PackSpec[] {
  return [soundfont("pizzicato_strings", "MusyngKite"), soundfont("pizzicato_strings", "FluidR3_GM")];
}

/** Fallback chain per instrument, best first. */
export function packChain(instrument: InstrumentId, sounds: Sounds = DEFAULT_SOUNDS): PackSpec[] {
  switch (instrument) {
    case "piano": {
      const sf = soundfont("acoustic_grand_piano", "MusyngKite");
      if (sounds.piano === "soundfont") return [sf, soundfont("acoustic_grand_piano", "FluidR3_GM")];
      if (sounds.piano === "splendid") return [splendid, sf];
      if (sounds.piano === "wurlitzer") return [epiano("WurlitzerEP200", "gs:wurlitzer"), soundfont("electric_piano_1", "MusyngKite"), sf];
      if (sounds.piano === "cp80") return [epiano("CP80", "gs:cp80"), soundfont("electric_grand_piano", "MusyngKite"), sf];
      return [salamander, splendid, sf];
    }
    case "bass":
      return [smolkenPizz, soundfont("acoustic_bass", "MusyngKite"), soundfont("acoustic_bass", "FluidR3_GM")];
    case "drums":
      return sounds.drums === "lm2" ? [lm2] : [acousticKit, lm2];
    case "vibes":
      return [vibes, soundfont("vibraphone", "MusyngKite"), soundfont("vibraphone", "FluidR3_GM")];
    default: {
      const name = SOUNDFONT_NAME[instrument];
      return [soundfont(name, "MusyngKite"), soundfont(name, "FluidR3_GM")];
    }
  }
}

const SOUNDFONT_NAME: Record<InstrumentId, string> = {
  piano: "acoustic_grand_piano",
  bass: "acoustic_bass",
  drums: "synth_drum",
  trumpet: "trumpet",
  sax: "tenor_sax",
  trombone: "trombone",
  clarinet: "clarinet",
  flute: "flute",
  violin: "violin",
  cello: "cello",
  guitar: "acoustic_guitar_nylon",
  vibes: "vibraphone",
};

/**
 * Default instrument volume (smplr 0..127), level-matched: each pack was measured playing
 * the same line at the same velocity in the browser and brought to ~−31 dB RMS (the sample
 * packs differ by up to 9 dB out of the box — the VCSL vibraphone and the clarinet/sax
 * soundfonts are hot, the violin is quiet). Musical balance (melody on top) is done by
 * role in the engine, not here.
 */
export const DEFAULT_VOLUME: Record<InstrumentId, number> = {
  piano: 106,
  bass: 111,
  drums: 80,
  trumpet: 93,
  sax: 79,
  trombone: 106,
  clarinet: 78,
  flute: 87,
  violin: 114,
  cello: 102,
  guitar: 104,
  vibes: 63,
};

/** Reverb send per instrument. */
export const REVERB_SEND: Record<InstrumentId, number> = {
  piano: 0.16,
  bass: 0.05,
  drums: 0.08,
  trumpet: 0.18,
  sax: 0.18,
  trombone: 0.16,
  clarinet: 0.18,
  flute: 0.2,
  violin: 0.2,
  cello: 0.16,
  guitar: 0.14,
  vibes: 0.2,
};

/** Instruments whose notes decay on their own; they get a little extra ring. */
export const DECAYING: Partial<Record<InstrumentId, true>> = {
  piano: true,
  vibes: true,
  guitar: true,
  bass: true,
};

// ─── Drums: General MIDI → LM-2 sample names ────────────────────────────────

const LM2_MAP: Record<number, string> = {
  [DRUM.kick]: "kick",
  35: "kick-alt",
  [DRUM.stick]: "stick-m",
  [DRUM.snare]: "snare-m",
  40: "snare-h",
  [DRUM.clap]: "clap",
  [DRUM.hatClosed]: "hhclosed",
  [DRUM.hatPedal]: "hhclosed-short",
  [DRUM.hatOpen]: "hhopen",
  [DRUM.crash]: "crash",
  57: "crash",
  [DRUM.ride]: "ride",
  [DRUM.rideBell]: "ride",
  59: "ride",
  [DRUM.highTom]: "tom-hh",
  48: "tom-h",
  [DRUM.midTom]: "tom-m",
  [DRUM.lowTom]: "tom-l",
  [DRUM.floorTom]: "tom-ll",
  41: "tom-ll",
  [DRUM.tambourine]: "tambourine",
  [DRUM.cowbell]: "cowbell",
  69: "cabasa",
  [DRUM.shaker]: "cabasa",
  62: "conga-h",
  [DRUM.congaHi]: "conga-h",
  [DRUM.congaLo]: "conga-l",
};

export function lm2Sample(pitch: number, vel: number, art?: string): string | null {
  const name = LM2_MAP[pitch];
  if (!name) return null;
  if (name === "snare-m") {
    if (art === "accent" || vel >= 0.85) return "snare-h";
    if (art === "ghost" || vel < 0.35) return "snare-l";
  }
  if (name === "stick-m" && (art === "accent" || vel >= 0.85)) return "stick-h";
  return name;
}
