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
  const stripRef = useRef<HTMLDivElement>(null);
  const total = score.frame.bars;
  const beats = score.frame.meter.beats;
  const sections = score.frame.sections;

  useEffect(() => {
    let raf = 0;
    let lastSec = -2;
    const loop = () => {
      const el = headRef.current;
      const beat = playing ? troopAudio.getBeat() : -Infinity;
      const on = Number.isFinite(beat) && beat >= 0;
      if (el) {
        if (on) {
          el.style.opacity = "1";
          el.style.left = `${Math.min(100, (beat / (total * beats)) * 100)}%`;
        } else el.style.opacity = "0";
      }
      // the section being played is lit, so you can tell whose solo it is from across the room
      const bar = on ? Math.min(total - 1, Math.floor(beat / beats)) : -1;
      const sec = bar < 0 ? -1 : sections.findIndex((s) => bar >= s.start && bar < s.start + s.length);
      if (sec !== lastSec && stripRef.current) {
        lastSec = sec;
        stripRef.current.toggleAttribute("data-playing", sec >= 0);
        [...stripRef.current.querySelectorAll<HTMLElement>("[data-sec]")].forEach((n, i) => n.toggleAttribute("data-now", i === sec));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, beats, sections]);

  // A section name that won't fit falls back to its first word ("Out Head" → "Out"), then to
  // nothing: on a phone "I…" and "Out H…" read as broken. The colour and portraits still say
  // which section it is, and the full name is its tooltip.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const fit = () => {
      for (const el of strip.querySelectorAll<HTMLElement>("[data-label]")) {
        const full = el.dataset.label!;
        for (const text of [full, full.split(" ")[0], ""]) {
          el.textContent = text;
          if (el.scrollWidth <= el.clientWidth + 1) break;
        }
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [sections]);

  const nameOf = (id: string) => score.members.find((m) => m.id === id);
  const auto = new Set(autopilotBars);

  return (
    <div className="relative mt-xs select-none" aria-label="Form of the tune">
      <div ref={stripRef} className="form-strip relative flex h-12 w-full overflow-hidden rounded-[var(--radius-s)_var(--radius-m)_var(--radius-s)_var(--radius-m)]">
        {score.frame.sections.map((s, si) => {
          const who = s.featured?.map(nameOf).filter(Boolean) ?? [];
          return (
            <div
              key={s.start}
              data-sec
              className={`form-sec relative flex min-w-0 flex-col ${si > 0 ? "shadow-[inset_var(--border-m)_0_0_0_var(--border-default-color)]" : ""}`}
              style={{ width: `${(s.length / total) * 100}%`, background: KIND_FILL[s.kind] ?? "transparent" }}
            >
              <div className="pointer-events-none flex items-center gap-xxs overflow-hidden whitespace-nowrap px-xs text-s" title={s.name}>
                {who.slice(0, 2).map((m) => (
                  <AnimalPortrait key={m!.id} animal={m!.animal} size={16} />
                ))}
                <span className="min-w-0 flex-1 overflow-hidden pr-xs font-brand text-m font-heavy" data-label={s.name.replace(/^Solo · /, "")} aria-label={s.name}>
                  {s.name.replace(/^Solo · /, "")}
                </span>
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
