"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AnimalId, InstrumentId, MemberFrameState, NoteEvent } from "@/music/types";
import { ANIMALS, ANIMAL_LIST, DRUM, INSTRUMENTS, INSTRUMENT_LIST } from "@/music/instruments";
import { AnimalSprite, type SpriteHandle } from "@/art/AnimalSprite";
import type { Pt } from "@/art/affine";
import { AnimalPortrait } from "@/art/AnimalPortrait";
import { InstrumentIcon } from "@/art/InstrumentIcon";
import { glitchesOf, type Glitch } from "@/art/glitch";
import { DoodleDefs } from "@/art/DoodleDefs";

const BPM = 108;
const BARS = 64;

// ─── A tiny fake sequencer so we can watch the rig respond to real pitches ────

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const CHORDS = [
  [50, 53, 57, 60], // Dm7
  [43, 47, 50, 53], // G7
  [48, 52, 55, 59], // Cmaj7
  [45, 49, 52, 55], // A7
];
const SCALE = [0, 2, 4, 5, 7, 9, 11];

function fakePart(inst: InstrumentId, seed: number): NoteEvent[] {
  const r = rng(seed * 7919 + 13);
  const notes: NoteEvent[] = [];
  const def = INSTRUMENTS[inst];
  for (let bar = 0; bar < BARS; bar++) {
    const b0 = bar * 4;
    const ch = CHORDS[bar % 4];
    if (inst === "drums") {
      // a fill bar hands both sticks to the drums: the ride stops for it and no hat opens over it
      const fill = bar % 4 === 3;
      for (const beat of [0, 1, 1.66, 2, 3, 3.66]) if (!fill || beat < 2.5) notes.push({ pitch: DRUM.ride, start: b0 + beat, dur: 0.25, vel: beat % 1 ? 0.5 : 0.75 });
      notes.push({ pitch: DRUM.hatPedal, start: b0 + 1, dur: 0.25, vel: 0.6 });
      notes.push({ pitch: DRUM.hatPedal, start: b0 + 3, dur: 0.25, vel: 0.6 });
      notes.push({ pitch: DRUM.kick, start: b0, dur: 0.25, vel: 0.8 });
      if (r() < 0.6) notes.push({ pitch: DRUM.snare, start: b0 + 2.66, dur: 0.25, vel: 0.5 });
      if (bar % 4 === 0) notes.push({ pitch: DRUM.crash, start: b0, dur: 1, vel: 0.9 });
      if (fill) {
        const toms = [DRUM.snare, DRUM.snare, DRUM.highTom, DRUM.highTom, DRUM.midTom, DRUM.floorTom];
        toms.forEach((p, i) => notes.push({ pitch: p, start: b0 + 2.5 + i * 0.25, dur: 0.25, vel: 0.8 }));
      }
      if (bar % 2 === 1 && !fill) notes.push({ pitch: DRUM.hatOpen, start: b0 + 3.5, dur: 0.5, vel: 0.6 });
      continue;
    }
    if (inst === "bass") {
      const lo = def.sweet[0];
      const root = ch[0] - 12 >= lo ? ch[0] - 12 : ch[0];
      const line = [root, root + 4, root + 7, root + 5 + (r() < 0.5 ? 0 : 1)];
      line.forEach((p, i) => notes.push({ pitch: p, start: b0 + i, dur: 0.9, vel: 0.75 }));
      continue;
    }
    if (inst === "cello") {
      // 4-bar cycle: two bars of arco melody (long + moving notes), a bar of pizz
      // walking, a bar of pizz double-stops.
      const phase = bar % 4;
      const root = ch[0] - 12;
      if (phase === 0) {
        notes.push({ pitch: root + 12, start: b0, dur: 2, vel: 0.65 });
        notes.push({ pitch: root + 16, start: b0 + 2, dur: 1, vel: 0.7 });
        notes.push({ pitch: root + 19, start: b0 + 3, dur: 1, vel: 0.75 });
      } else if (phase === 1) {
        [24, 23, 21, 19, 17, 16].forEach((d, i) => notes.push({ pitch: root + d, start: b0 + i * 0.5, dur: 0.5, vel: 0.7 }));
        notes.push({ pitch: root + 16, start: b0 + 3, dur: 1, vel: 0.9 });
      } else if (phase === 2) {
        [root, root + 7, root + 4, root + 5].forEach((p, i) => notes.push({ pitch: p, start: b0 + i, dur: 0.9, vel: 0.75, art: "pizz" }));
      } else {
        for (const at of [0, 1.5, 2.5]) {
          notes.push({ pitch: root + 4, start: b0 + at, dur: 0.5, vel: 0.7, art: "pizz" });
          notes.push({ pitch: root + 10, start: b0 + at, dur: 0.5, vel: 0.7, art: "pizz" });
        }
      }
      continue;
    }
    if (inst === "violin" && bar % 8 === 7) {
      [0, 1, 2, 3].forEach((i) => notes.push({ pitch: ch[i] + 12, start: b0 + i, dur: 0.5, vel: 0.7, art: "pizz" }));
      continue;
    }
    if (inst === "piano" || inst === "guitar" || inst === "vibes") {
      const off = inst === "vibes" ? 12 : inst === "guitar" ? 0 : 0;
      for (const at of [0, 1.5, 2.5]) for (const p of ch) notes.push({ pitch: p + off + (inst === "piano" ? 0 : 0), start: b0 + at, dur: at === 0 ? 1.4 : 0.8, vel: 0.6 });
      if (inst === "piano") {
        // right-hand melody running over the chords
        for (let i = 0; i < 8; i++) {
          if (r() < 0.25) continue;
          const deg = Math.floor(r() * 10);
          const p = 72 + SCALE[deg % 7] + (deg >= 7 ? 12 : 0);
          notes.push({ pitch: p, start: b0 + i * 0.5, dur: 0.45, vel: 0.7 });
        }
      }
      if (inst === "vibes") {
        for (let i = 0; i < 4; i++) {
          const p = 72 + SCALE[Math.floor(r() * 7)];
          notes.push({ pitch: p, start: b0 + 0.5 + i, dur: 0.4, vel: 0.7 });
        }
      }
      continue;
    }
    // melodic: phrases of 8ths with breaths and some long notes
    if (bar % 4 === 3) continue; // breathe / rest bar
    const [lo, hi] = def.sweet;
    let p = lo + Math.floor((hi - lo) * (0.3 + 0.4 * r()));
    let beat = 0;
    while (beat < 4) {
      const long = r() < 0.18;
      const dur = long ? 1.5 : 0.5;
      p += Math.floor(r() * 7) - 3;
      p = Math.max(lo, Math.min(hi, p));
      notes.push({ pitch: p, start: b0 + beat, dur: dur * 0.95, vel: 0.7 });
      beat += dur;
    }
  }
  return notes.sort((a, b) => a.start - b.start);
}

function stateAt(notes: NoteEvent[], beat: number, playing: boolean, featured: boolean, lookX: number): MemberFrameState {
  const spb = 60 / BPM;
  const active: MemberFrameState["active"] = [];
  const recent: MemberFrameState["recent"] = [];
  let nextOnsetIn = Infinity;
  let nextPitch: number | null = null;
  // binary search for first note starting after beat
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start <= beat) lo = mid + 1;
    else hi = mid;
  }
  if (lo < notes.length) {
    nextOnsetIn = (notes[lo].start - beat) * spb;
    nextPitch = notes[lo].pitch;
  }
  const upcoming: NonNullable<MemberFrameState["upcoming"]> = [];
  for (let i = lo; i < notes.length && (notes[i].start - beat) * spb <= 0.6; i++) {
    upcoming.push({ pitch: notes[i].pitch, vel: notes[i].vel, inSec: (notes[i].start - beat) * spb, art: notes[i].art });
  }
  for (let i = lo - 1; i >= 0 && beat - notes[i].start < 8; i--) {
    const n = notes[i];
    const age = (beat - n.start) * spb;
    if (recent.length < 6) recent.push({ pitch: n.pitch, vel: n.vel, age, art: n.art });
    if (beat < n.start + n.dur) active.push({ pitch: n.pitch, vel: n.vel, age, progress: (beat - n.start) / n.dur, durSec: n.dur * spb, art: n.art });
  }
  const phase = beat - Math.floor(beat);
  const silentFor = recent[0] ? recent[0].age : Infinity;
  return {
    playing,
    beat,
    beatPhase: phase,
    bpm: BPM,
    beatsPerBar: 4,
    active,
    recent,
    nextOnsetIn,
    nextPitch,
    upcoming,
    role: silentFor > 1.5 && nextOnsetIn > 1.5 ? "rest" : featured ? "solo" : "comp",
    energy: 0.6,
    featured,
    lookX,
  };
}

const DEFAULT_INSTRUMENTS: InstrumentId[] = ANIMAL_LIST.map((a) => ANIMALS[a].defaultInstrument);

export default function ArtLabPage() {
  return (
    <Suspense>
      <ArtLab />
    </Suspense>
  );
}

const FPS = 60;
const SPB = 60 / BPM;
const FRAME_BEATS = 1 / FPS / SPB;
const END = BARS * 4;
/** Frames replayed before a seek, so smoothed motion arrives settled rather than from rest. */
const PREROLL_SEC = 1.5;

function fmt(beat: number) {
  const bar = Math.floor(beat / 4) + 1;
  return `bar ${bar} · beat ${((beat % 4) + 1).toFixed(2)} · frame ${Math.round(beat / FRAME_BEATS)}`;
}

function ArtLab() {
  // ?speed=0.25&beat=12&inst=guitar,cello&paused=1&row=1&feat=3 for deterministic screenshots:
  // paused holds the playing pose at that beat (add &stopped=1 for the band at rest)
  const q = useSearchParams();
  const row = !!q.get("row");
  const [playing, setPlaying] = useState(() => !q.get("paused"));
  const [stopped, setStopped] = useState(() => !!q.get("stopped"));
  const [insts, setInsts] = useState<InstrumentId[]>(() => {
    const list = (q.get("inst") ?? "").split(",").filter((x): x is InstrumentId => (INSTRUMENT_LIST as string[]).includes(x));
    return [...list, ...DEFAULT_INSTRUMENTS.slice(list.length)].slice(0, ANIMAL_LIST.length);
  });
  const [featured, setFeatured] = useState<number>(() => (q.get("feat") !== null ? Number(q.get("feat")) : 3));
  const [speed, setSpeed] = useState(() => Number(q.get("speed")) || 1);
  const sprites = useRef<(SpriteHandle | null)[]>([]);
  const parts = useMemo(() => insts.map((i, k) => fakePart(i, k + 1)), [insts]);
  // the lab's own clock: the sprites see beat × seconds-per-beat as time, so a frame replays exactly
  const startBeat = Number(q.get("beat")) || 0;
  const clock = useRef<{ beat: number; last: number; seekTo: number | null }>({ beat: startBeat, last: 0, seekTo: startBeat });
  const prevHands = useRef<(Record<"L" | "R", Pt> | null)[]>([]);
  const [readout, setReadout] = useState({ beat: startBeat, glitches: [] as Glitch[][] });

  /** Draw every sprite at `beat`; `step` says the previous frame was one frame before (for jump checks). */
  const draw = useCallback(
    (beat: number, opts: { reset?: boolean; step?: boolean } = {}) => {
      const glitches: Glitch[][] = [];
      parts.forEach((notes, i) => {
        const sp = sprites.current[i];
        if (!sp) return;
        const look = featured < 0 || featured === i ? 0 : Math.max(-1, Math.min(1, (featured - i) / 4));
        const s = stateAt(notes, beat, true, featured === i, look);
        sp.update(stopped ? { ...s, playing: false, active: [], nextOnsetIn: Infinity, nextPitch: null, upcoming: [] } : s, { t: 10 + beat * SPB, reset: opts.reset });
        const h = sp.hands();
        glitches[i] = glitchesOf(h, opts.step ? prevHands.current[i] : null, sp.shoulders());
        prevHands.current[i] = h;
      });
      return glitches;
    },
    [parts, featured, stopped],
  );

  /** Jump to a beat, replaying the frames just before it so eased motion is where it would be. */
  const seek = useCallback(
    (beat: number) => {
      const target = Math.max(0, Math.min(END - FRAME_BEATS, beat));
      const from = Math.max(0, target - PREROLL_SEC / SPB);
      draw(from, { reset: true });
      let b = from;
      while (b + FRAME_BEATS < target) draw((b += FRAME_BEATS), { step: true });
      const glitches = draw(target, { step: true });
      clock.current.beat = target;
      setReadout({ beat: target, glitches });
    },
    [draw],
  );

  const stepFrames = useCallback(
    (n: number) => {
      setPlaying(false);
      const c = clock.current;
      if (n < 0) return seek(c.beat + n * FRAME_BEATS);
      let glitches: Glitch[][] = [];
      for (let k = 0; k < n; k++) glitches = draw((c.beat = Math.min(END - FRAME_BEATS, c.beat + FRAME_BEATS)), { step: true });
      setReadout({ beat: c.beat, glitches });
    },
    [draw, seek],
  );

  /** Step forward until some sprite shows a glitch (up to 16 bars), and stop on that frame. */
  const nextGlitch = useCallback(() => {
    setPlaying(false);
    const c = clock.current;
    const limit = Math.min(END - FRAME_BEATS, c.beat + 64);
    let glitches: Glitch[][] = [];
    while (c.beat < limit) {
      glitches = draw((c.beat += FRAME_BEATS), { step: true });
      if (glitches.some((g) => g?.length)) break;
    }
    setReadout({ beat: c.beat, glitches });
  }, [draw]);

  useEffect(() => {
    let raf = 0;
    let shown = -1;
    const loop = (now: number) => {
      const c = clock.current;
      const dt = c.last ? Math.min(0.1, (now - c.last) / 1000) : 0;
      c.last = now;
      if (c.seekTo !== null) {
        seek(c.seekTo);
        c.seekTo = null;
      } else if (playing) {
        const next = c.beat + (dt / SPB) * speed;
        if (next >= END) seek(0);
        else {
          c.beat = next;
          draw(next);
        }
      } else draw(c.beat); // paused: hold this exact frame (the sprites would otherwise drift to idle)
      // the readout follows playback a few times a second, not every frame
      if (playing && Math.abs(c.beat - shown) > 0.25) {
        shown = c.beat;
        setReadout((r) => ({ ...r, beat: c.beat }));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, seek, playing, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("select, input[type=text]")) return;
      if (e.key === "ArrowRight" || e.key === ".") stepFrames(e.shiftKey ? Math.round(1 / FRAME_BEATS) : 1);
      else if (e.key === "ArrowLeft" || e.key === ",") stepFrames(e.shiftKey ? -Math.round(1 / FRAME_BEATS) : -1);
      else if (e.key === " ") setPlaying((p) => !p);
      else if (e.key === "g") nextGlitch();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepFrames, nextGlitch]);

  const btn = "rounded-xs px-s py-xxs text-l shadow-[inset_0_0_0_var(--border-l)_var(--border-default-color)]";

  return (
    <main className="min-h-screen p-6" style={{ background: "var(--cte-canvas)" }}>
      <DoodleDefs />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="font-brand text-xxl font-heavy">
          Art lab
        </h1>
        <button className={btn} onClick={() => setPlaying((p) => !p)} data-testid="toggle">
          {playing ? "Pause" : "Play"}
        </button>
        <label className="text-l">
          speed{" "}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[0.1, 0.25, 0.5, 1, 1.5].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <label className="text-l">
          <input type="checkbox" checked={stopped} onChange={(e) => setStopped(e.target.checked)} /> band stopped
        </label>
        <div className="flex gap-2">
          {ANIMAL_LIST.map((a) => (
            <AnimalPortrait key={a} animal={a} size={44} />
          ))}
        </div>
        <div className="flex gap-1">
          {INSTRUMENT_LIST.map((i) => (
            <InstrumentIcon key={i} instrument={i} size={34} />
          ))}
        </div>
      </div>
      {/* frame by frame: step, scrub, or run to the next frame where a pose looks wrong */}
      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 py-xs" style={{ background: "var(--cte-canvas)" }} aria-label="Frame scrubber">
        <button className={btn} onClick={() => stepFrames(-Math.round(1 / FRAME_BEATS))} title="Back a beat (shift + ←)">
          ⏮ beat
        </button>
        <button className={btn} onClick={() => stepFrames(-1)} title="Back a frame (← or ,)">
          ◀ frame
        </button>
        <button className={btn} onClick={() => stepFrames(1)} title="Forward a frame (→ or .)" data-testid="frame-next">
          frame ▶
        </button>
        <button className={btn} onClick={() => stepFrames(Math.round(1 / FRAME_BEATS))} title="Forward a beat (shift + →)">
          beat ⏭
        </button>
        <button className={btn} onClick={nextGlitch} title="Step until a pose looks wrong: crossed arms, or a paw jumping (g)" data-testid="next-glitch">
          next glitch
        </button>
        <button className={btn} onClick={() => sprites.current.forEach((sp) => sp?.cheer())} title="What the band does when a take plays to its end" data-testid="cheer">
          cheer
        </button>
        <input
          type="range"
          className="min-w-[12rem] flex-1"
          min={0}
          max={END}
          step={FRAME_BEATS}
          value={readout.beat}
          onChange={(e) => {
            setPlaying(false);
            seek(Number(e.target.value));
          }}
          aria-label="Scrub"
        />
        <span className="text-m tabular-nums" data-testid="readout">
          {fmt(readout.beat)}
        </span>
      </div>
      <div className={row ? "flex items-end justify-center gap-1" : "grid grid-cols-2 gap-6 md:grid-cols-3"}>
        {ANIMAL_LIST.map((a: AnimalId, i) => (
          <div key={a} className="flex flex-col items-center" data-testid={`cell-${a}`}>
            <AnimalSprite
              ref={(h) => {
                sprites.current[i] = h;
              }}
              animal={a}
              instrument={insts[i]}
              name={ANIMALS[a].name}
              size={row ? 136 : 240}
            />
            <div className="mt-1 flex items-center gap-2">
              <select
                value={insts[i]}
                onChange={(e) => {
                  const next = [...insts];
                  next[i] = e.target.value as InstrumentId;
                  setInsts(next);
                }}
              >
                {INSTRUMENT_LIST.map((x) => (
                  <option key={x} value={x}>
                    {INSTRUMENTS[x].name}
                  </option>
                ))}
              </select>
              <label className="text-s">
                <input type="radio" name="feat" checked={featured === i} onChange={() => setFeatured(i)} /> solo
              </label>
              {!playing && readout.glitches[i]?.length ? (
                <span className="text-s text-(--error)" data-testid={`glitch-${a}`}>
                  {readout.glitches[i].join(", ")}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
