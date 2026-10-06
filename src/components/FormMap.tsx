"use client";

import { useEffect, useRef } from "react";
import { AnimalPortrait } from "@/art/AnimalPortrait";
import { troopAudio } from "@/audio/engine";
import type { Score } from "@/music/types";

const hatch = (color: string, strength = 32) =>
  `repeating-linear-gradient(-38deg, color-mix(in srgb, var(${color}) ${strength}%, transparent) 0 1.6px, transparent 1.6px 6px), color-mix(in srgb, var(${color}) 8%, transparent)`;

/** Crayon hatching per section kind (a stable encoding: head yellow, solo blue, trade purple…). */
const KIND_FILL: Record<string, string> = {
  head: hatch("--color-2"),
  out: hatch("--color-2"),
  solo: hatch("--color-3", 24),
  trade: hatch("--color-5", 26),
  intro: hatch("--color-4", 24),
  vamp: hatch("--color-4", 24),
  tag: hatch("--color-1", 24),
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
    <div className="relative mt-xs select-none" aria-label="Form of the tune">
      <div className="relative flex h-12 w-full overflow-hidden rounded-[var(--radius-s)_var(--radius-m)_var(--radius-s)_var(--radius-m)]">
        {score.frame.sections.map((s, si) => {
          const who = s.featured?.map(nameOf).filter(Boolean) ?? [];
          return (
            <div
              key={s.start}
              className={`relative flex min-w-0 flex-col ${si > 0 ? "shadow-[inset_var(--border-m)_0_0_0_var(--border-default-color)]" : ""}`}
              style={{ width: `${(s.length / total) * 100}%`, background: KIND_FILL[s.kind] ?? "transparent" }}
            >
              <div className="pointer-events-none flex items-center gap-xxs overflow-hidden whitespace-nowrap px-xs text-s">
                {who.slice(0, 2).map((m) => (
                  <AnimalPortrait key={m!.id} animal={m!.animal} size={16} />
                ))}
                <span className="truncate pr-xs font-brand text-m font-heavy">{s.name.replace(/^Solo · /, "")}</span>
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
                      className={`relative flex-1 transition-colors duration-(--motion-duration) hover:bg-(--neutral-9-transparent) disabled:cursor-wait ${i > 0 ? "border-l border-dotted border-(--neutral-5)" : ""} ${pending ? "form-pending" : ""}`}
                    >
                      {auto.has(bar) && <span className="absolute inset-x-0 bottom-0 text-center text-xxs text-ink-soft">~</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {/* the outline sits over the section fills */}
        <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-s)_var(--radius-m)_var(--radius-s)_var(--radius-m)] shadow-[inset_0_0_0_var(--border-m)_var(--border-default-color)]" />
      </div>
      <div ref={headRef} className="pointer-events-none absolute -top-xxs -bottom-xxs w-[3px] -translate-x-1/2 rounded-full bg-(--color-1) opacity-0" />
    </div>
  );
}
