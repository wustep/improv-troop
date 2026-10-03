"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimalSprite, IDLE_STATE, type SpriteHandle } from "@/art/AnimalSprite";
import { troopAudio } from "@/audio/engine";
import { ANIMALS, INSTRUMENTS } from "@/music/instruments";
import { useDebug } from "@/state/debug";
import { useTroop } from "@/state/store";
import { FrameComputer } from "./stage/frames";
import { RoughBox } from "./ui/rough";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Stage() {
  const score = useTroop((s) => s.current);
  const members = useTroop((s) => s.members);
  const playing = useTroop((s) => s.playing);
  const chat = useTroop((s) => s.chat);
  const genRunning = useTroop((s) => s.gen.running);
  const genMode = useTroop((s) => s.gen.mode);
  const calls = useDebug((s) => s.calls);
  const runId = useTroop((s) => s.gen.runId);
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const sprites = useRef(new Map<string, SpriteHandle | null>());
  const spots = useRef(new Map<string, HTMLDivElement | null>());
  const labelRef = useRef<HTMLDivElement>(null);
  const chordRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState(-1);

  // the band on stage is the chart's band when one is loaded (so sketches and takes match what you hear)
  const band = score?.members.length ? score.members : members;
  const n = Math.max(1, band.length);
  const spriteW = Math.max(118, Math.min(220, (width - 24) / n - 8));

  const computer = useMemo(() => (score ? new FrameComputer(score) : null), [score]);

  // per-frame animation: read the audio clock, hand each sprite its state
  useEffect(() => {
    let raf = 0;
    let lastBar = -2;
    const loop = () => {
      const isPlaying = troopAudio.isPlaying() && playing;
      const beat = isPlaying ? troopAudio.getBeat() : -Infinity;
      const spb = troopAudio.getSecondsPerBeat() || 0.5;
      for (const m of band) {
        const h = sprites.current.get(m.id);
        if (!h) continue;
        const st = computer && Number.isFinite(beat) ? computer.compute(m.id, beat, true, spb) : { ...IDLE_STATE, bpm: score?.frame.tempo ?? 100 };
        h.update(st);
        const spot = spots.current.get(m.id);
        if (spot) spot.style.opacity = st.featured && Number.isFinite(beat) && beat >= 0 ? "1" : "0";
      }
      if (score && Number.isFinite(beat)) {
        const beats = score.frame.meter.beats;
        const b = beat < 0 ? -1 : Math.min(score.frame.bars - 1, Math.floor(beat / beats));
        if (b !== lastBar) {
          lastBar = b;
          setBar(b);
          if (labelRef.current) {
            labelRef.current.textContent =
              b < 0 ? "count-in…" : `${score.plan[b]?.section ?? ""} · bar ${b + 1}/${score.frame.bars}`;
          }
        }
        if (chordRef.current && b >= 0) {
          const inBar = beat - b * beats;
          const chords = score.frame.chords[b] ?? [];
          let sym = chords[0]?.symbol ?? "";
          for (const c of chords) if (c.beat <= inBar + 1e-6) sym = c.symbol;
          if (chordRef.current.textContent !== sym) chordRef.current.textContent = sym;
        }
      } else if (lastBar !== -2) {
        lastBar = -2;
        setBar(-1);
        if (labelRef.current) labelRef.current.textContent = "";
        if (chordRef.current) chordRef.current.textContent = "";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [band, computer, playing, score]);

  // speech bubbles: during the count-off show the latest line per player; while playing, lines appear at their bar
  const bubbles = useMemo(() => {
    const out: Record<string, string> = {};
    const msgs = chat.length ? chat : (score?.chat ?? []);
    if (playing && bar >= 0) {
      for (const c of msgs) if (c.bar !== undefined && c.bar <= bar && c.bar >= bar - 1 && c.phase === "jam") out[c.from] = c.text;
    } else if (genRunning) {
      for (const c of msgs) out[c.from] = c.text;
    }
    return out;
  }, [chat, score, playing, bar, genRunning]);

  const thinking = useMemo(() => {
    const s = new Set<string>();
    for (const c of calls) if (c.status === "pending" && c.runId === runId) s.add(c.agent);
    return s;
  }, [calls, runId]);

  const directorNote = useMemo(() => {
    const msgs = chat.length ? chat : (score?.chat ?? []);
    const d = msgs.filter((c) => c.from === "director" && (c.bar === undefined || c.bar <= Math.max(0, bar)));
    return d.length ? d[d.length - 1].text : null;
  }, [chat, score, bar]);

  return (
    <RoughBox seed="stage" rough={{ strokeWidth: 2 }} className="stage-paper w-full px-3 pb-2 pt-3">
      <div ref={wrapRef} className="relative">
        <div className="flex min-h-7 items-baseline justify-between gap-3 px-2 font-[family-name:var(--font-script)] text-ink-soft">
          <div ref={labelRef} className="truncate text-xl" aria-live="off" />
          <div ref={chordRef} className="text-2xl font-bold text-[var(--pencil-blue)]" aria-label="current chord" />
        </div>

        {(genMode === "composer" || score?.engine === "ai") && (directorNote || thinking.has("director") || thinking.has("critic")) && (
          <div className="director-card absolute right-2 top-9 z-20 max-w-[16rem] rotate-[1.5deg] px-3 py-2 text-sm leading-snug">
            <div className="font-[family-name:var(--font-script)] text-base font-bold">
              {thinking.has("critic") ? "the judge is listening…" : thinking.has("director") ? "director is writing…" : "director's note"}
            </div>
            {directorNote && !thinking.has("director") && <div>{directorNote}</div>}
          </div>
        )}

        <div className="relative flex items-end justify-center gap-2 pt-16">
          {band.map((m, i) => {
            const inst = INSTRUMENTS[m.instrument];
            const bubble = bubbles[m.id];
            const isThinking = thinking.has(m.id);
            return (
              <div key={`${m.id}:${m.instrument}`} className="relative flex flex-col items-center" style={{ width: spriteW }}>
                <div
                  ref={(el) => {
                    spots.current.set(m.id, el);
                  }}
                  className="spotlight pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2"
                  style={{ width: spriteW * 1.15, height: spriteW * 1.3, opacity: 0 }}
                />
                {(bubble || isThinking) && (
                  <div
                    className={`bubble absolute z-10 ${i >= n / 2 ? "right-2" : "left-2"} max-w-[15rem] px-3 py-1.5 text-[15px] leading-snug`}
                    style={{ bottom: spriteW * 1.04 }}
                  >
                    {bubble && !isThinking ? bubble : <span className="thinking-dots" aria-label={`${m.name} is thinking`}><i>.</i><i>.</i><i>.</i></span>}
                  </div>
                )}
                <AnimalSprite
                  ref={(h) => {
                    sprites.current.set(m.id, h);
                  }}
                  animal={m.animal}
                  instrument={m.instrument}
                  size={spriteW}
                />
                <div className="-mt-1 text-center leading-tight">
                  <div className="font-[family-name:var(--font-script)] text-xl font-bold" style={{ color: ANIMALS[m.animal].ink }}>
                    {m.name}
                    {score?.frame.leaderId === m.id && <span className="ml-1 text-sm text-[var(--pencil-red)]">★</span>}
                  </div>
                  <div className="text-sm text-ink-soft">{inst.name}</div>
                </div>
              </div>
            );
          })}
        </div>
        <svg className="pointer-events-none absolute bottom-10 left-0 h-6 w-full" preserveAspectRatio="none" viewBox="0 0 100 10" aria-hidden>
          <path d="M0 6 Q 25 3 50 5 T 100 5" stroke="var(--ink)" strokeOpacity="0.35" strokeWidth="0.4" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </RoughBox>
  );
}
