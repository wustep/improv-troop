"use client";

import { useEffect, useRef } from "react";
import { AnimalPortrait } from "@/art/AnimalPortrait";
import { troopAudio } from "@/audio/engine";
import type { Score } from "@/music/types";

const hatch = (rgb: string, a = 0.32) =>
  `repeating-linear-gradient(-38deg, rgba(${rgb},${a}) 0 1.6px, transparent 1.6px 6px), rgba(${rgb},0.08)`;

/** Crayon hatching per section kind. */
const KIND_FILL: Record<string, string> = {
  head: hatch("226,169,59"),
  out: hatch("226,169,59"),
  solo: hatch("59,91,171", 0.24),
  trade: hatch("90,74,158", 0.26),
  intro: hatch("79,138,58", 0.24),
  vamp: hatch("79,138,58", 0.24),
  tag: hatch("200,70,60", 0.24),
};

/**
 * The locked form as a strip: sections sized by bars, a live playhead, click a bar to
 * play from it. While the band is still improvising, unplayed bars are hatched.
 */
export function FormMap({
  score,
  playing,
  readyBars,
  autopilotBars,
  onSeek,
}: {
  score: Score;
  playing: boolean;
  readyBars: number | null;
  autopilotBars: number[];
  onSeek: (bar: number) => void;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const total = score.frame.bars;
  const beats = score.frame.meter.beats;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = headRef.current;
      if (el) {
        const beat = playing ? troopAudio.getBeat() : -Infinity;
        if (Number.isFinite(beat) && beat >= 0) {
          el.style.opacity = "1";
          el.style.left = `${Math.min(100, (beat / (total * beats)) * 100)}%`;
        } else el.style.opacity = "0";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, beats]);

  const nameOf = (id: string) => score.members.find((m) => m.id === id);
  const auto = new Set(autopilotBars);

  return (
    <div className="relative mt-2 select-none" aria-label="Form of the tune">
      <div className="flex h-12 w-full overflow-hidden rounded-[6px_9px_7px_10px] border-[1.6px] border-[var(--ink)]">
        {score.frame.sections.map((s, si) => {
          const who = s.featured?.map(nameOf).filter(Boolean) ?? [];
          return (
            <div
              key={s.start}
              className={`relative flex min-w-0 flex-col ${si > 0 ? "border-l-[1.6px] border-[var(--ink)]" : ""}`}
              style={{ width: `${(s.length / total) * 100}%`, background: KIND_FILL[s.kind] ?? "transparent" }}
            >
              <div className="pointer-events-none flex items-center gap-1 overflow-hidden whitespace-nowrap px-1.5 text-[13px] leading-normal">
                {who.slice(0, 2).map((m) => (
                  <AnimalPortrait key={m!.id} animal={m!.animal} size={16} />
                ))}
                <span className="truncate pr-1.5 font-[family-name:var(--font-script)] text-[15px] font-bold">{s.name.replace(/^Solo · /, "")}</span>
              </div>
              <div className="flex flex-1">
                {Array.from({ length: s.length }, (_, i) => {
                  const bar = s.start + i;
                  const pending = readyBars !== null && bar >= readyBars;
                  return (
                    <button
                      key={bar}
                      type="button"
                      disabled={pending}
                      onClick={() => onSeek(bar)}
                      title={pending ? `bar ${bar + 1}: the band is still thinking` : `play from bar ${bar + 1}${auto.has(bar) ? " (they vamped this on autopilot)" : ""}`}
                      aria-label={`Play from bar ${bar + 1}`}
                      className={`relative flex-1 hover:bg-[rgba(44,42,53,0.08)] disabled:cursor-wait ${i > 0 ? "border-l border-dotted border-[rgba(44,42,53,0.25)]" : ""} ${pending ? "form-pending" : ""}`}
                    >
                      {auto.has(bar) && <span className="absolute inset-x-0 bottom-0 text-center text-[10px] leading-none text-ink-soft">~</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={headRef} className="pointer-events-none absolute -top-1 bottom-[-4px] w-[3px] -translate-x-1/2 rounded bg-[var(--pencil-red)] opacity-0" />
    </div>
  );
}
