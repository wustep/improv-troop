import {
  DrumMachine,
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

export type PianoPack = "salamander" | "splendid" | "soundfont";

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

/** Fallback chain per instrument, best first. */
export function packChain(instrument: InstrumentId, pianoPack: PianoPack = "salamander"): PackSpec[] {
  switch (instrument) {
    case "piano": {
      const sf = soundfont("acoustic_grand_piano", "MusyngKite");
      if (pianoPack === "soundfont") return [sf, soundfont("acoustic_grand_piano", "FluidR3_GM")];
      if (pianoPack === "splendid") return [splendid, sf];
      return [salamander, splendid, sf];
    }
    case "bass":
      return [smolkenPizz, soundfont("acoustic_bass", "MusyngKite"), soundfont("acoustic_bass", "FluidR3_GM")];
    case "drums":
      return [lm2];
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

/** Default instrument volume (smplr 0..127) so drums/bass don't swamp the melody. */
export const DEFAULT_VOLUME: Record<InstrumentId, number> = {
  piano: 100,
  bass: 108,
  drums: 84,
  trumpet: 92,
  sax: 100,
  trombone: 98,
  clarinet: 100,
  flute: 100,
  violin: 98,
  cello: 102,
  guitar: 104,
  vibes: 102,
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
