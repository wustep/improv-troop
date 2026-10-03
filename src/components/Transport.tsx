"use client";

import { useEffect, useState } from "react";
import { troopAudio, type LoadState } from "@/audio/engine";
import { useTroop } from "@/state/store";
import { RoughButton } from "./ui/rough";

function useLoadStates() {
  const [states, setStates] = useState<LoadState[]>([]);
  useEffect(() => troopAudio.onLoad(setStates), []);
  return states;
}

export function Transport() {
  const playing = useTroop((s) => s.playing);
  const play = useTroop((s) => s.play);
  const stop = useTroop((s) => s.stop);
  const generate = useTroop((s) => s.generate);
  const cancel = useTroop((s) => s.cancel);
  const gen = useTroop((s) => s.gen);
  const mode = useTroop((s) => s.settings.mode);
  const bestOf = useTroop((s) => s.settings.bestOf);
  const set = useTroop((s) => s.setSettings);
  const hasKey = useTroop((s) => !!s.apiKey);
  const current = useTroop((s) => s.current);
  const isSketch = useTroop((s) => s.isSketch);
  const loads = useLoadStates();
  const loading = loads.filter((l) => !l.ready && !l.error);

  const goLabel = hasKey ? (mode === "composer" ? "Compose!" : "Let them jam!") : "Sketch a new take";

  // Space toggles play/stop (unless typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || t.closest("button"))) return;
      e.preventDefault();
      if (useTroop.getState().playing) useTroop.getState().stop();
      else void useTroop.getState().play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <RoughButton
        seed="play"
        shape="ellipse"
        tone="go"
        className="h-14 w-14 text-2xl text-white"
        onClick={() => (playing ? stop() : void play())}
        disabled={!current}
        aria-label={playing ? "Stop" : "Play"}
        title={playing ? "Stop (space)" : "Play (space)"}
      >
        {playing ? "■" : "▶"}
      </RoughButton>

      {gen.running ? (
        <RoughButton seed="cancel" tone="quiet" className="px-4 py-2 font-[family-name:var(--font-script)] text-2xl font-bold" onClick={cancel}>
          stop thinking
        </RoughButton>
      ) : (
        <RoughButton
          seed="go"
          tone="primary"
          className="px-5 py-2 font-[family-name:var(--font-script)] text-2xl font-bold text-white"
          onClick={() => void generate()}
          title={hasKey ? "Ask the band (calls the model)" : "Add an AI Gateway key in “Brains & sounds” to let the animals think — until then they play from their sketchbook."}
        >
          {goLabel}
        </RoughButton>
      )}

      {mode === "composer" && (
        <label className="flex cursor-pointer items-center gap-1.5 text-[15px]" title="Write 4 candidate charts and let a judge pick the most distinctive">
          <input type="checkbox" className="sketch-check" checked={bestOf > 1} onChange={(e) => set({ bestOf: e.target.checked ? 4 : 1 })} />
          best of 4
        </label>
      )}

      <div className="min-w-0 flex-1 text-[15px] leading-snug text-ink-soft" aria-live="polite">
        {gen.running ? (
          <span>{gen.status}</span>
        ) : gen.error ? (
          <span className="text-[var(--pencil-red)]">{gen.error}</span>
        ) : loading.length ? (
          <span className="flex items-center gap-2">
            <span>unpacking instruments…</span>
            <span className="relative inline-block h-2.5 w-28 overflow-hidden rounded-full border-[1.5px] border-[var(--ink)]" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 bg-[var(--pencil-yellow)]"
                style={{ width: `${Math.round((loading.reduce((s, l) => s + (l.total ? l.loaded / l.total : 0), 0) / loading.length) * 100)}%` }}
              />
            </span>
            <span className="text-xs">{loading.map((l) => l.instrument).join(", ")}</span>
          </span>
        ) : current ? (
          <span>
            {isSketch ? "sketch" : current.engine === "ai" ? "take" : "sketch take"}: <b className="text-ink">{current.title}</b> — {current.frame.bars} bars, {current.frame.key.tonic} {current.frame.key.mode}, {current.frame.tempo} bpm
            {current.critic && current.critic.scores.length > 0 && (
              <>
                {" "}
                · judge: {current.critic.scores.find((x) => x.candidate === current.critic!.chosen)?.score ?? "?"}/10
              </>
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Takes() {
  const takes = useTroop((s) => s.takes);
  const current = useTroop((s) => s.current);
  const select = useTroop((s) => s.selectTake);
  const remove = useTroop((s) => s.deleteTake);
  if (!takes.length) return null;
  return (
    <div>
      <div className="mb-1 font-[family-name:var(--font-script)] text-xl font-bold">Takes</div>
      <ol className="space-y-1">
        {takes.map((t, i) => (
          <li key={t.id} className="group flex items-start gap-1">
            <button
              type="button"
              onClick={() => select(t.id)}
              className={`min-w-0 flex-1 rounded px-2 py-1 text-left text-[15px] hover:bg-[rgba(226,169,59,0.25)] ${current?.id === t.id ? "bg-[rgba(226,169,59,0.4)]" : ""}`}
            >
              <span className="mr-1 text-ink-soft">#{takes.length - i}</span>
              {t.label}
              <span className="ml-1 text-xs text-ink-soft">
                {new Date(t.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {t.score.critic?.scores.length ? ` · judge ${t.score.critic.scores.find((x) => x.candidate === t.score.critic!.chosen)?.score ?? ""}` : ""}
              </span>
            </button>
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="px-1 pt-1 text-ink-soft opacity-0 hover:text-[var(--pencil-red)] focus:opacity-100 group-hover:opacity-100"
              aria-label={`Delete take ${takes.length - i}`}
              title="Delete this take"
            >
              ×
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
