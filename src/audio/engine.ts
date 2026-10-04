import { DrumMachine, Reverb, Scheduler, type Smplr } from "smplr";
import type { InstrumentId, Member, NoteEvent, Score } from "@/music/types";
import { INSTRUMENTS } from "@/music/instruments";
import { applyFeel, beatToSeconds, jitter } from "./feel";
import {
  DECAYING,
  DEFAULT_VOLUME,
  REVERB_SEND,
  lm2Sample,
  packChain,
  pizzChain,
  PIZZ_VOLUME,
  type PackSpec,
  type PianoPack,
} from "./packs";
import { CountingStorage } from "./storage";

// Playback engine: smplr sampled instruments driven by our own lookahead scheduler on the
// AudioContext clock. Charts are straight-grid; swing + humanisation happen here.

export type LoadState = {
  memberId: string;
  instrument: InstrumentId;
  loaded: number;
  total: number;
  ready: boolean;
  error?: string;
  pack: string;
};

export type TransportState = "stopped" | "loading" | "playing";

export interface PlaybackStats {
  scheduled: number;
  late: number;
  dropped: number;
  perMember: Record<string, number>;
  failedInstruments: string[];
  startedAt: number | null;
}

interface InstEntry {
  key: string;
  instrument: InstrumentId;
  pianoPack: PianoPack;
  chain: PackSpec[];
  spec: PackSpec | null;
  inst: Smplr | null;
  storage: CountingStorage | null;
  loaded: number;
  total: number;
  ready: boolean;
  failed: boolean;
  error?: string;
  pack: string;
  /** Resolves when ready or definitively failed. Never rejects. */
  done: Promise<void>;
  notes: Set<number>;
}

interface Track {
  memberId: string;
  instrument: InstrumentId;
  entryKey: string;
  notes: NoteEvent[];
  cursor: number;
  /** Start beat of the last scheduled note (for updateScore re-sync). */
  lastStart: number;
  lastOpenHat: number;
}

type SmplrNote = Exclude<Parameters<Smplr["start"]>[0], string | number>;

const LOOKAHEAD_SEC = 0.15;
const LOOKAHEAD_HIDDEN_SEC = 1.5;
const TICK_MS = 25;
const START_DELAY_SEC = 0.12;
const READY_WAIT_MS = 8000;
const END_TAIL_SEC = 0.8;
const PAN_WIDTH = 0.65;

const sortedCache = new WeakMap<NoteEvent[], NoteEvent[]>();
function sortedNotes(notes: NoteEvent[] | undefined): NoteEvent[] {
  if (!notes) return [];
  const hit = sortedCache.get(notes);
  if (hit) return hit;
  const out = notes
    .filter((n) => n && Number.isFinite(n.start) && Number.isFinite(n.pitch))
    .slice()
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  sortedCache.set(notes, out);
  return out;
}

/** First index whose start >= beat. */
function lowerBound(notes: NoteEvent[], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < beat - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose start > beat. */
function upperBound(notes: NoteEvent[], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start <= beat + 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

function beatsPerBar(score: Score): number {
  return score.frame?.meter?.beats ?? score.settings?.meter?.beats ?? 4;
}

function tempoOf(score: Score): number {
  const t = score.frame?.tempo ?? score.settings?.tempo ?? 120;
  return clamp(Number.isFinite(t) ? t : 120, 30, 320);
}

/** Last beat that holds sound (or the chart's length, whichever is later). */
function endBeatOf(score: Score): number {
  const bars = score.frame?.bars ?? score.plan?.length ?? 0;
  let end = bars * beatsPerBar(score);
  for (const notes of Object.values(score.parts ?? {})) {
    for (const n of notes) end = Math.max(end, n.start + Math.max(0, n.dur));
  }
  return end;
}

/** Pitches each member plays — handy as `prepare(..., { notesHint })`. */
/** Pitches each member will need. Plucked notes on bowed strings go under "<id>|pizz". */
export function notesHintFromScore(score: Score): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [id, notes] of Object.entries(score.parts ?? {})) {
    out[id] = [...new Set(notes.filter((n) => n.art !== "pizz").map((n) => n.pitch))];
    const pizz = notes.filter((n) => n.art === "pizz");
    if (pizz.length) out[`${id}|pizz`] = [...new Set(pizz.map((n) => n.pitch))];
  }
  return out;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof AudioContext !== "undefined";
}

export class TroopAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private reverb: ReturnType<typeof Reverb> | null = null;
  private scheduler: ReturnType<typeof Scheduler> | null = null;
  private entries = new Map<string, InstEntry>();
  private memberEntry = new Map<string, string>();
  private memberPan = new Map<string, number>();
  private currentMembers: Member[] = [];
  private loadListeners = new Set<(s: LoadState[]) => void>();
  private endListeners = new Set<() => void>();
  private muted = new Set<string>();
  private masterVolume = 0.85;
  private pianoPack: PianoPack = "salamander";

  private click: Smplr | null = null;
  private clickReady: Promise<void> | null = null;

  private state: TransportState = "stopped";
  private playToken = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private score: Score | null = null;
  private tracks: Track[] = [];
  private spb = 0.5;
  private t0 = 0; // ctx time of beat 0 (current loop iteration)
  private prevT0 = 0; // previous iteration (for getBeat right at a loop seam)
  private startBeat = 0;
  private endBeat = 0;
  private loop = false;
  private clicks: { time: number; accent: boolean }[] = [];
  private stats: PlaybackStats = this.freshStats();

  // ─── Context ───────────────────────────────────────────────────────────────

  private ensureContext(): AudioContext | null {
    if (!isBrowser()) return null;
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    compressor.connect(analyser);
    this.analyser = analyser;
    this.levelBuf = new Float32Array(analyser.fftSize);
    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    master.connect(compressor);
    this.master = master;
    this.compressor = compressor;
    try {
      this.reverb = Reverb(ctx);
      this.reverb.connect(master);
    } catch (err) {
      console.warn("[audio] reverb unavailable", err);
      this.reverb = null;
    }
    // Large lookahead so every note we hand smplr is dispatched synchronously; we own timing.
    this.scheduler = Scheduler(ctx, { lookaheadMs: 4000, intervalMs: 50 });
    this.entries.clear();
    this.click = null;
    this.clickReady = null;
    return ctx;
  }

  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      if (ctx.state !== "running") await ctx.resume();
      // iOS: play a silent buffer inside the gesture.
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    } catch (err) {
      console.warn("[audio] unlock failed", err);
    }
    this.ensureClick();
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  // ─── Loading ───────────────────────────────────────────────────────────────

  async prepare(
    members: Member[],
    opts?: { pianoPack?: PianoPack; notesHint?: Record<string, number[]> },
  ): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (opts?.pianoPack) this.pianoPack = opts.pianoPack;
    this.currentMembers = members.slice();
    this.assignEntries(members);
    this.ensureClick();

    const waits: Promise<void>[] = [];
    for (const m of members) {
      const key = this.memberEntry.get(m.id);
      if (!key) continue;
      const hint = opts?.notesHint?.[m.id];
      const entry = this.getEntry(key, m.instrument, hint);
      // bowed strings that pluck in this chart also need a pizzicato voice
      const pizzHint = opts?.notesHint?.[`${m.id}|pizz`];
      if (INSTRUMENTS[m.instrument]?.bowed && pizzHint?.length) {
        const pz = this.getEntry(`${key}|pizz`, m.instrument, pizzHint, pizzChain());
        waits.push(pz.done);
      }
      const pan = this.memberPan.get(m.id) ?? 0;
      if (entry.inst) {
        try {
          entry.inst.output.pan = pan;
        } catch {
          /* disposed */
        }
      }
      if (hint && hint.length && entry.spec?.extend && entry.inst && entry.ready) {
        const fresh = hint.filter((n) => !entry.notes.has(n));
        if (fresh.length) {
          for (const n of fresh) entry.notes.add(n);
          const inst = entry.inst;
          const storage = entry.storage;
          waits.push(
            entry.spec
              .extend(inst, [...entry.notes], storage?.failedUrls ?? new Set())
              .catch((err) => console.warn("[audio] extend failed", err)),
          );
        }
      }
      waits.push(entry.done);
    }
    this.emitLoad();
    await Promise.all(waits);
    this.emitLoad();
  }

  /** Map members → instrument-instance keys. Duplicate instruments get their own instance (own pan). */
  private assignEntries(members: Member[]) {
    const seen = new Map<InstrumentId, number>();
    const n = members.length;
    members.forEach((m, i) => {
      const k = seen.get(m.instrument) ?? 0;
      seen.set(m.instrument, k + 1);
      const pack = m.instrument === "piano" ? this.pianoPack : "default";
      this.memberEntry.set(m.id, `${m.instrument}:${pack}#${k}`);
      const fn = INSTRUMENTS[m.instrument]?.fn;
      const spread = n > 1 ? -1 + (2 * i) / (n - 1) : 0;
      const width = fn === "bass" || fn === "rhythm" ? PAN_WIDTH * 0.35 : PAN_WIDTH;
      this.memberPan.set(m.id, spread * width);
    });
  }

  private getEntry(key: string, instrument: InstrumentId, hint?: number[], chain?: PackSpec[]): InstEntry {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const entry: InstEntry = {
      key,
      instrument,
      pianoPack: this.pianoPack,
      chain: chain ?? packChain(instrument, this.pianoPack),
      spec: null,
      inst: null,
      storage: null,
      loaded: 0,
      total: 0,
      ready: false,
      failed: false,
      pack: "",
      done: Promise.resolve(),
      notes: new Set(hint ?? []),
    };
    this.entries.set(key, entry);
    entry.done = this.loadEntry(entry, hint);
    return entry;
  }

  private async loadEntry(entry: InstEntry, hint?: number[]): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.scheduler) return;
    const errors: string[] = [];
    for (const spec of entry.chain) {
      const storage = new CountingStorage();
      entry.spec = spec;
      entry.pack = spec.pack;
      entry.storage = storage;
      entry.loaded = 0;
      entry.total = 0;
      this.emitLoad();
      let inst: Smplr | null = null;
      try {
        inst = spec.create({
          ctx,
          destination: this.master,
          scheduler: this.scheduler,
          storage,
          volume: entry.key.endsWith("|pizz") ? PIZZ_VOLUME : DEFAULT_VOLUME[entry.instrument],
          pan: 0,
          notes: hint,
          onProgress: (loaded, total) => {
            entry.loaded = loaded;
            entry.total = total;
            this.emitLoad();
          },
        });
        await inst.ready;
        if (storage.ok === 0 && storage.failed > 0) {
          throw new Error(`no samples loaded (${storage.failed} failed)`);
        }
        if (spec.extend && storage.failed > 0) {
          // Rebuild without the samples that failed so their keys fall back to neighbours.
          await spec.extend(inst, [...entry.notes], storage.failedUrls).catch(() => undefined);
        }
        if (this.reverb) {
          try {
            inst.output.addEffect("reverb", this.reverb, REVERB_SEND[entry.instrument]);
          } catch {
            /* ignore */
          }
        }
        entry.inst = inst;
        entry.ready = true;
        entry.failed = false;
        entry.error = errors.length ? errors.join("; ") : undefined;
        if (entry.total === 0) {
          entry.total = Math.max(1, storage.ok);
          entry.loaded = entry.total;
        }
        // Apply the pan of whichever member currently owns this entry.
        for (const [memberId, key] of this.memberEntry) {
          if (key === entry.key || `${key}|pizz` === entry.key) inst.output.pan = this.memberPan.get(memberId) ?? 0;
        }
        this.emitLoad();
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${spec.pack}: ${msg}`);
        console.warn(`[audio] ${entry.instrument} pack ${spec.pack} failed, trying next`, err);
        try {
          inst?.dispose();
        } catch {
          /* ignore */
        }
      }
    }
    entry.failed = true;
    entry.ready = false;
    entry.error = errors.join("; ") || "no pack available";
    this.emitLoad();
  }

  private ensureClick() {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.clickReady) return;
    try {
      const click = DrumMachine(ctx, {
        instrument: "LM-2",
        destination: this.master,
        scheduler: this.scheduler ?? undefined,
        storage: new CountingStorage(),
        volume: 90,
        notesToLoad: { notes: ["stick-h", "stick-m"] },
      } as Parameters<typeof DrumMachine>[1]);
      this.click = click;
      this.clickReady = click.ready.catch((err) => {
        console.warn("[audio] count-in sticks unavailable", err);
        this.click = null;
      });
    } catch (err) {
      console.warn("[audio] count-in sticks unavailable", err);
      this.clickReady = Promise.resolve();
    }
  }

  onLoad(cb: (states: LoadState[]) => void): () => void {
    this.loadListeners.add(cb);
    cb(this.getLoadStates());
    return () => {
      this.loadListeners.delete(cb);
    };
  }

  getLoadStates(): LoadState[] {
    return this.currentMembers.map((m) => {
      const key = this.memberEntry.get(m.id);
      const e = key ? this.entries.get(key) : undefined;
      return {
        memberId: m.id,
        instrument: m.instrument,
        loaded: e?.loaded ?? 0,
        total: e?.total ?? 0,
        ready: e?.ready ?? false,
        error: e?.failed ? e.error : undefined,
        pack: e?.pack ?? "",
      };
    });
  }

  private emitLoad() {
    if (this.loadListeners.size === 0) return;
    const states = this.getLoadStates();
    for (const cb of this.loadListeners) {
      try {
        cb(states);
      } catch (err) {
        console.warn("[audio] onLoad listener failed", err);
      }
    }
  }

  // ─── Transport ─────────────────────────────────────────────────────────────

  play(score: Score, opts?: { fromBar?: number; countIn?: boolean; loop?: boolean }): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.halt(false);
    const token = ++this.playToken;
    this.state = "loading";
    this.score = score;
    void this.startWhenReady(score, opts ?? {}, token).catch((err) => {
      console.error("[audio] play failed", err);
      if (token === this.playToken) this.halt(false);
    });
  }

  private async startWhenReady(
    score: Score,
    opts: { fromBar?: number; countIn?: boolean; loop?: boolean },
    token: number,
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        /* needs a gesture; we'll still schedule */
      }
    }
    // Make sure the members' instruments exist (reuses cache), then wait a bounded time.
    const members = score.members ?? [];
    const ready = this.prepare(members, { notesHint: notesHintFromScore(score) });
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), READY_WAIT_MS));
    const result = await Promise.race([ready.then(() => "ok" as const), timeout]);
    if (token !== this.playToken) return;
    if (result === "timeout") {
      const slow = this.getLoadStates().filter((s) => !s.ready).map((s) => `${s.memberId}:${s.instrument}`);
      console.warn("[audio] starting before all instruments loaded:", slow.join(", "));
    }
    if (this.clickReady) {
      await Promise.race([this.clickReady, new Promise((r) => setTimeout(r, 1500))]);
      if (token !== this.playToken) return;
    }

    const bpb = beatsPerBar(score);
    const fromBar = clamp(Math.floor(opts.fromBar ?? 0), 0, Math.max(0, (score.frame?.bars ?? 1) - 1));
    const countIn = opts.countIn ?? fromBar === 0;
    this.spb = beatToSeconds(1, tempoOf(score));
    this.startBeat = fromBar * bpb;
    this.endBeat = endBeatOf(score);
    this.loop = !!opts.loop;
    const leadIn = START_DELAY_SEC + (countIn ? bpb * this.spb : 0);
    this.t0 = ctx.currentTime + leadIn - this.startBeat * this.spb;
    this.prevT0 = this.t0;
    this.clicks = [];
    if (countIn) {
      for (let i = 0; i < bpb; i++) {
        this.clicks.push({ time: this.t0 + (this.startBeat - bpb + i) * this.spb, accent: i === 0 });
      }
    }
    this.buildTracks(score, this.startBeat);
    this.stats = this.freshStats();
    this.stats.startedAt = ctx.currentTime;
    this.stats.failedInstruments = this.getLoadStates()
      .filter((s) => s.error)
      .map((s) => `${s.memberId}:${s.instrument} (${s.error})`);
    if (this.stats.failedInstruments.length) {
      console.warn("[audio] instruments unavailable:", this.stats.failedInstruments.join(", "));
    }
    this.state = "playing";
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private buildTracks(score: Score, fromBeat: number) {
    this.tracks = (score.members ?? []).map((m) => {
      const notes = sortedNotes(score.parts?.[m.id]);
      return {
        memberId: m.id,
        instrument: m.instrument,
        entryKey: this.memberEntry.get(m.id) ?? "",
        notes,
        cursor: lowerBound(notes, fromBeat),
        lastStart: -Infinity,
        lastOpenHat: -Infinity,
      };
    });
  }

  updateScore(score: Score): void {
    const prev = this.score;
    this.score = score;
    if (this.state !== "playing" || !prev) return;
    this.endBeat = endBeatOf(score);
    const byId = new Map(this.tracks.map((t) => [t.memberId, t]));
    this.tracks = (score.members ?? []).map((m) => {
      const old = byId.get(m.id);
      const notes = sortedNotes(score.parts?.[m.id]);
      const lastStart = old?.lastStart ?? -Infinity;
      // Resume after whatever was already handed to the instruments.
      const cursor =
        lastStart === -Infinity
          ? lowerBound(notes, Math.max(this.startBeat, this.currentRawBeat()))
          : upperBound(notes, lastStart);
      return {
        memberId: m.id,
        instrument: m.instrument,
        entryKey: this.memberEntry.get(m.id) ?? old?.entryKey ?? "",
        notes,
        cursor,
        lastStart,
        lastOpenHat: old?.lastOpenHat ?? -Infinity,
      };
    });
  }

  stop(): void {
    this.halt(false);
  }

  private halt(fireEnded: boolean) {
    this.playToken++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasPlaying = this.state === "playing";
    this.state = "stopped";
    this.tracks = [];
    this.clicks = [];
    for (const e of this.entries.values()) {
      try {
        e.inst?.stop();
      } catch {
        /* ignore */
      }
    }
    try {
      this.click?.stop();
    } catch {
      /* ignore */
    }
    if (fireEnded && wasPlaying) {
      for (const cb of this.endListeners) {
        try {
          cb();
        } catch (err) {
          console.warn("[audio] onEnded listener failed", err);
        }
      }
    }
  }

  isPlaying(): boolean {
    return this.state === "playing" || this.state === "loading";
  }

  getState(): TransportState {
    return this.state;
  }

  private currentRawBeat(): number {
    const ctx = this.ctx;
    if (!ctx) return -Infinity;
    const now = ctx.currentTime;
    const base = now >= this.t0 || this.t0 === this.prevT0 ? this.t0 : this.prevT0;
    return (now - base) / this.spb;
  }

  getBeat(): number {
    const ctx = this.ctx;
    if (!ctx || this.state !== "playing") return -Infinity;
    const latency = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
    const now = ctx.currentTime - latency;
    const base = now >= this.t0 || this.t0 === this.prevT0 ? this.t0 : this.prevT0;
    return (now - base) / this.spb;
  }

  getSecondsPerBeat(): number {
    return this.spb;
  }

  onEnded(cb: () => void): () => void {
    this.endListeners.add(cb);
    return () => {
      this.endListeners.delete(cb);
    };
  }

  setMute(memberId: string, muted: boolean): void {
    if (muted) this.muted.add(memberId);
    else this.muted.delete(memberId);
    if (muted) {
      const key = this.memberEntry.get(memberId);
      const e = key ? this.entries.get(key) : undefined;
      try {
        e?.inst?.stop();
      } catch {
        /* ignore */
      }
    }
  }

  isMuted(memberId: string): boolean {
    return this.muted.has(memberId);
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp(Number.isFinite(v) ? v : 0.85, 0, 1);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02);
    }
  }

  /** RMS of the master output right now (0..~1). Cheap enough to call every frame. */
  getOutputLevel(): number {
    const a = this.analyser;
    const buf = this.levelBuf;
    if (!a || !buf) return 0;
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  getStats(): PlaybackStats {
    return { ...this.stats, perMember: { ...this.stats.perMember } };
  }

  private freshStats(): PlaybackStats {
    return { scheduled: 0, late: 0, dropped: 0, perMember: {}, failedInstruments: [], startedAt: null };
  }

  private lookahead() {
    return typeof document !== "undefined" && document.hidden ? LOOKAHEAD_HIDDEN_SEC : LOOKAHEAD_SEC;
  }

  // ─── Scheduler ─────────────────────────────────────────────────────────────

  private tick() {
    try {
      this.tickInner();
    } catch (err) {
      console.warn("[audio] scheduler tick failed", err);
    }
  }

  private tickInner() {
    const ctx = this.ctx;
    const score = this.score;
    if (!ctx || !score || this.state !== "playing") return;
    const now = ctx.currentTime;
    const horizon = now + this.lookahead();

    // Count-in sticks.
    while (this.clicks.length && this.clicks[0].time < horizon) {
      const c = this.clicks.shift()!;
      if (c.time < now - 0.05) continue;
      try {
        this.click?.start({
          note: c.accent ? "stick-h" : "stick-m",
          velocity: c.accent ? 110 : 80,
          time: Math.max(c.time, now),
        });
      } catch {
        /* ignore */
      }
    }

    const swing = Number.isFinite(score.swing) ? score.swing : 0.5;
    for (const track of this.tracks) {
      const notes = track.notes;
      while (track.cursor < notes.length) {
        const note = notes[track.cursor];
        if (this.loop && note.start >= this.loopEndBeat()) {
          track.cursor = notes.length;
          break;
        }
        // Decide on the un-humanised time so chords are never split across ticks.
        const when = this.t0 + applyFeel(note.start, swing) * this.spb;
        if (when >= horizon) break;
        track.cursor++;
        track.lastStart = note.start;
        this.scheduleNote(track, note, when, swing, now);
      }
    }

    // Loop: once every track has handed over the last iteration, queue the next one.
    if (this.loop) {
      const loopEnd = this.t0 + this.loopEndBeat() * this.spb;
      if (horizon >= loopEnd && this.tracks.every((t) => t.cursor >= t.notes.length || t.notes[t.cursor].start >= this.loopEndBeat())) {
        const span = (this.loopEndBeat() - this.startBeat) * this.spb;
        this.prevT0 = this.t0;
        this.t0 += span;
        for (const t of this.tracks) {
          t.cursor = lowerBound(t.notes, this.startBeat);
          t.lastStart = -Infinity;
        }
      }
      return;
    }

    const endTime = this.t0 + this.endBeat * this.spb + END_TAIL_SEC;
    if (now >= endTime) this.halt(true);
  }

  private loopEndBeat() {
    const score = this.score;
    if (!score) return this.endBeat;
    const bars = score.frame?.bars ?? 0;
    return bars > 0 ? bars * beatsPerBar(score) : this.endBeat;
  }

  private scheduleNote(track: Track, note: NoteEvent, when: number, swing: number, now: number) {
    if (this.muted.has(track.memberId)) return;
    // plucked notes on a bowed string use the pizzicato voice when it's loaded
    const pizz = note.art === "pizz" ? this.entries.get(`${track.entryKey}|pizz`) : undefined;
    const entry = pizz?.ready ? pizz : this.entries.get(track.entryKey);
    const inst = entry?.inst;
    if (!inst || !entry.ready) {
      this.stats.dropped++;
      return;
    }
    const isDrum = track.instrument === "drums";
    const id = track.memberId;

    // Humanise (deterministic per note).
    const tight = isDrum && (note.pitch === 36 || note.pitch === 38 || note.pitch === 37);
    const timingAmt = isDrum ? (tight ? 0.002 : 0.005) : 0.008;
    let time = when + jitter(timingAmt, id, note.start, note.pitch, "t");
    if (time < now) {
      if (now - time > 0.08) {
        this.stats.late++;
        this.stats.dropped++;
        return;
      }
      this.stats.late++;
      time = now + 0.005;
    }

    let vel = clamp(Number.isFinite(note.vel) ? note.vel : 0.7, 0, 1);
    if (note.art === "accent") vel = Math.min(1, vel * 1.12 + 0.08);
    if (note.art === "ghost") vel *= 0.45;
    vel *= 1 + jitter(0.06, id, note.start, note.pitch, "v");
    vel = clamp(vel, 0.02, 1);

    try {
      if (isDrum) {
        const sample = lm2Sample(note.pitch, vel, note.art);
        if (!sample) {
          this.stats.dropped++;
          return;
        }
        // Closed/pedal hat chokes a ringing open hat.
        if ((note.pitch === 42 || note.pitch === 44) && track.lastOpenHat < time) {
          inst.stop({ stopId: "hhopen", time });
        }
        if (note.pitch === 46) track.lastOpenHat = time;
        inst.start({ note: sample, velocity: Math.round(1 + vel * 126), time });
      } else {
        const span = applyFeel(note.start + Math.max(0.01, note.dur), swing) - applyFeel(note.start, swing);
        let dur = Math.max(0.03, span * this.spb);
        if (note.art === "staccato") dur *= 0.5;
        if (note.art === "pizz") dur = Math.min(dur, 0.9);
        if (note.art === "legato") dur *= 1.06;
        if (DECAYING[track.instrument]) dur += 0.05;
        const range = INSTRUMENTS[track.instrument]?.range;
        let pitch = Math.round(note.pitch);
        if (range) {
          while (pitch < range[0] - 12) pitch += 12;
          while (pitch > range[1] + 12) pitch -= 12;
        }
        const midiVel = Math.round(1 + vel * 126);
        const event: SmplrNote = { note: pitch, velocity: midiVel, time, duration: dur };
        if (track.instrument === "piano" && entry.pack === "salamander") {
          // Soft piano notes are darker, not just quieter.
          event.lpfCutoffHz = 1800 + Math.pow(vel, 1.4) * 14000;
        }
        inst.start(event);
      }
      this.stats.scheduled++;
      this.stats.perMember[id] = (this.stats.perMember[id] ?? 0) + 1;
    } catch (err) {
      this.stats.dropped++;
      console.warn("[audio] note failed", err);
    }
  }
}

/** Shared engine. The constructor touches no browser APIs, so importing this during SSR is safe;
 * the AudioContext is created lazily on the first unlock/prepare/play. */
export const troopAudio: TroopAudio = new TroopAudio();

export type { PianoPack };
