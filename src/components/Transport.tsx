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

  const goLabel = mode === "composer" ? (hasKey ? "Compose!" : "New take") : hasKey ? "Let them jam!" : "New take";

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
        title={playing ? "Stop" : "Play"}
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
          <span>
            unpacking instruments… {loading.map((l) => `${l.instrument} ${l.total ? Math.round((l.loaded / l.total) * 100) : 0}%`).join(" · ")}
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
  if (!takes.length) return null;
  return (
    <div>
      <div className="mb-1 font-[family-name:var(--font-script)] text-xl font-bold">Takes</div>
      <ol className="space-y-1">
        {takes.map((t, i) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => select(t.id)}
              className={`w-full rounded px-2 py-1 text-left text-[15px] hover:bg-[rgba(226,169,59,0.25)] ${current?.id === t.id ? "bg-[rgba(226,169,59,0.4)]" : ""}`}
            >
              <span className="mr-1 text-ink-soft">#{takes.length - i}</span>
              {t.label}
              <span className="ml-1 text-xs text-ink-soft">
                {new Date(t.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {t.score.critic?.scores.length ? ` · judge ${t.score.critic.scores.find((x) => x.candidate === t.score.critic!.chosen)?.score ?? ""}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
