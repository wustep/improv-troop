"use client";

import { useEffect, useState } from "react";
import { troopAudio, type LoadState } from "@/audio/engine";
import { INSTRUMENTS } from "@/music/instruments";
import { canShare, shareUrl } from "@/state/share";
import { canThink, useTroop } from "@/state/store";
import { openBrains } from "./ControlPanel";
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
  const playSketchInstead = useTroop((s) => s.playSketchInstead);
  const gen = useTroop((s) => s.gen);
  const mode = useTroop((s) => s.settings.mode);
  const bestOf = useTroop((s) => s.settings.bestOf);
  const set = useTroop((s) => s.setSettings);
  const hasKey = useTroop(canThink);
  const current = useTroop((s) => s.current);
  const isSketch = useTroop((s) => s.isSketch);
  const audioError = useTroop((s) => s.audioError);
  const loads = useLoadStates();
  const loading = loads.filter((l) => !l.ready && !l.error);
  const failed = loads.filter((l) => l.error);
  // over every instrument, counting finished and failed ones as done, so the bar only grows
  const loadPct = loads.length ? Math.round((loads.reduce((s, l) => s + (l.ready || l.error ? 1 : l.total ? l.loaded / l.total : 0), 0) / loads.length) * 100) : 100;
  const members = useTroop((s) => s.members);
  const retryLoads = () => {
    const { members, sounds } = useTroop.getState();
    void troopAudio.prepare(members, { sounds });
  };

  const goLabel = hasKey ? (mode === "composer" ? "Compose!" : "Let them jam!") : "Sketch a new take";

  // Space toggles play/stop (unless typing, or pressing a button reached by keyboard).
  // A button focused by a mouse click would otherwise be clicked again by Space.
  useEffect(() => {
    let pointed: Element | null = null; // the button the pointer last pressed
    const onPointer = (e: PointerEvent) => {
      pointed = (e.target as HTMLElement | null)?.closest("button") ?? null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") {
        if (e.key === "Tab") pointed = null;
        return;
      }
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const button = t?.closest("button");
      if (t && (t.closest("input, textarea, select, [contenteditable]") || (button && button !== pointed))) return;
      e.preventDefault();
      button?.blur(); // so the key's release can't click it either
      if (useTroop.getState().playing) useTroop.getState().stop();
      else void useTroop.getState().play();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // on a phone the stage fills the screen: once the transport scrolls away, a dock keeps it in reach
  const [rowRef, setRowRef] = useState<HTMLDivElement | null>(null);
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    if (!rowRef) return;
    const io = new IntersectionObserver(([e]) => setOffscreen(!e.isIntersecting), { threshold: 0 });
    io.observe(rowRef);
    return () => io.disconnect();
  }, [rowRef]);

  return (
    <div ref={setRowRef} className="flex flex-wrap items-center gap-s">
      {offscreen && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-s bg-(--neutral-1) px-m py-xs shadow-[var(--border-shadow-m),var(--shadow-m)] lg:hidden" role="region" aria-label="Transport">
          <RoughButton
            seed="dock-play"
            shape="ellipse"
            tone="go"
            className="h-11 w-11 shrink-0 text-l text-on-accent"
            onClick={() => (playing ? stop() : void play())}
            disabled={!current}
            aria-label={playing ? "Stop" : "Play"}
          >
            {playing ? "■" : "▶"}
          </RoughButton>
          <span className="min-w-0 flex-1 truncate text-s text-ink-soft">
            {gen.running ? gen.status : current ? current.title : ""}
          </span>
          {gen.running ? (
            <RoughButton seed="dock-cancel" tone="quiet" className="shrink-0 px-s py-xxs font-brand text-l font-heavy" onClick={cancel}>
              stop thinking
            </RoughButton>
          ) : (
            <RoughButton seed="dock-go" tone="primary" className="shrink-0 px-s py-xxs font-brand text-l font-heavy text-on-accent" onClick={() => void generate()}>
              {goLabel}
            </RoughButton>
          )}
        </div>
      )}
      <RoughButton
        seed="play"
        shape="ellipse"
        tone="go"
        className="h-14 w-14 text-xl text-on-accent"
        onClick={() => (playing ? stop() : void play())}
        disabled={!current}
        aria-label={playing ? "Stop" : "Play"}
        title={playing ? "Stop (space)" : "Play (space)"}
      >
        {playing ? "■" : "▶"}
      </RoughButton>

      {gen.running ? (
        <RoughButton seed="cancel" tone="quiet" className="px-m py-xs font-brand text-xl font-heavy" onClick={cancel}>
          stop thinking
        </RoughButton>
      ) : (
        <RoughButton
          seed="go"
          tone="primary"
          className="px-l py-xs font-brand text-xl font-heavy text-on-accent"
          onClick={() => void generate()}
          title={hasKey ? "Ask the band (calls the model)" : "Add an AI Gateway or Anthropic key in “Brains & sounds” to let the animals think — until then they play from their sketchbook."}
        >
          {goLabel}
        </RoughButton>
      )}

      {!hasKey && !gen.running && (
        <button type="button" className="text-action text-s" onClick={openBrains}>
          add an AI key
        </button>
      )}

      {mode === "composer" && hasKey && (
        <label className="flex cursor-pointer items-center gap-xs text-m" title="Write 4 candidate charts and let a judge pick the most distinctive">
          <input type="checkbox" className="sketch-check" checked={bestOf > 1} onChange={(e) => set({ bestOf: e.target.checked ? 4 : 1 })} />
          best of 4
        </label>
      )}

      <div className="min-w-0 flex-1 basis-60 text-m text-ink-soft" aria-live="polite">
        {gen.running ? (
          <span>{gen.status}</span>
        ) : gen.error ? (
          <span role="alert" className="flex flex-wrap items-baseline gap-x-s">
            <span className="text-ink">
              <span aria-hidden className="text-(--error)">✗ </span>The band lost the thread: {gen.error}
            </span>
            {/key/i.test(gen.error) ? (
              <button type="button" className="text-action" onClick={openBrains}>
                {/pick a Claude model/.test(gen.error) ? "pick a model" : "check the key"}
              </button>
            ) : (
              <button type="button" className="text-action" onClick={() => void generate()}>
                try again
              </button>
            )}
            <button type="button" className="text-action" onClick={playSketchInstead}>
              play the sketch instead
            </button>
          </span>
        ) : audioError ? (
          <span role="alert" className="flex flex-wrap items-baseline gap-x-s">
            <span className="text-ink">
              <span aria-hidden className="text-(--error)">✗ </span>No sound: {audioError}.
            </span>
            <button type="button" className="text-action" onClick={() => void play()}>
              press play again
            </button>
          </span>
        ) : loading.length ? (
          <span className="flex items-center gap-xs">
            <span>unpacking instruments…</span>
            <span
              role="progressbar"
              aria-label="Unpacking instruments"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={loadPct}
              className="relative inline-block h-2.5 w-28 overflow-hidden rounded-full shadow-[inset_0_0_0_var(--border-m)_var(--border-default-color)]"
            >
              <span className="absolute inset-y-0 left-0 bg-(--color-2)" style={{ width: `${loadPct}%` }} />
            </span>
            <span className="text-xs" title={loading.map((l) => l.instrument).join(", ")}>
              {loads.length - loading.length - failed.length} of {loads.length} ready
            </span>
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
        {failed.length > 0 && !loading.length && !gen.running && (
          <span role="alert" className="flex flex-wrap items-baseline gap-x-s">
            <span className="text-ink">
              <span aria-hidden className="text-(--error)">
                ✗{" "}
              </span>
              {failed.map((l) => `${members.find((m) => m.id === l.memberId)?.name ?? l.memberId}'s ${INSTRUMENTS[l.instrument].name.toLowerCase()}`).join(", ")}{" "}
              didn&apos;t load, so {failed.length > 1 ? "they play" : "it plays"} silent.
            </span>
            <button type="button" className="text-action" onClick={retryLoads}>
              try again
            </button>
          </span>
        )}
      </div>
      <ShareLink />
    </div>
  );
}

/** Copy a link that replays this take (local takes only: they're rebuilt from settings and seed). */
function ShareLink() {
  const current = useTroop((s) => s.current);
  const running = useTroop((s) => s.gen.running);
  // the note belongs to the take it was about, so switching takes clears it
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);
  if (running || !canShare(current)) return null;
  const say = (text: string) => setNote({ id: current.id, text });

  const share = async () => {
    const url = shareUrl(current, location.href);
    try {
      if (navigator.share && matchMedia("(hover: none)").matches) {
        await navigator.share({ title: `Jamming · ${current.title}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      say("link copied");
    } catch (e) {
      if ((e as Error).name !== "AbortError") say("couldn't copy the link");
    }
  };

  return (
    <button type="button" className="text-action text-m" onClick={() => void share()} title="Copy a link that plays this take again">
      <span aria-live="polite">{note?.id === current.id ? note.text : "share this take"}</span>
    </button>
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
      <h2 className="type-section mb-xs">Takes</h2>
      <ol className="space-y-xxs">
        {takes.map((t, i) => (
          <li key={t.id} className="group flex items-start gap-xxs">
            <button
              type="button"
              onClick={() => select(t.id)}
              aria-current={current?.id === t.id}
              data-selected={current?.id === t.id}
              className="pick min-w-0 flex-1 px-xs py-xxs text-left text-m"
            >
              <span className="mr-xxs text-ink-soft">#{takes.length - i}</span>
              {t.label}
              <span className="ml-xxs text-xs text-ink-soft">
                {new Date(t.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {t.score.critic?.scores.length ? ` · judge ${t.score.critic.scores.find((x) => x.candidate === t.score.critic!.chosen)?.score ?? ""}` : ""}
              </span>
            </button>
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="px-xxs pt-xxs text-ink-soft opacity-0 transition-colors duration-(--motion-duration) hover:text-(--color-1) focus:opacity-100 group-hover:opacity-100"
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
